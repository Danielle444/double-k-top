/**
 * Executable tests for the pure interval WRITE/DELETE planners (Stage GH1A).
 *
 * Uses the existing `tsx` runner with Node built-ins `node:test` and
 * `node:assert/strict`. No test framework is installed. Run with:
 *   npx tsx --test lib/trainee-history/interval-update.test.ts
 *
 * PURE: no Prisma, no DB, no Next.js runtime, no clock, no randomness. All
 * fixtures are fixed plain-data literals with date-only YYYY-MM-DD keys.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  planIntervalWrite,
  planIntervalDelete,
  validateIntervalRows,
  type IntervalPlan,
  type IntervalPlanResult,
  type IntervalWriteInput,
} from "./interval-update";
import type { IntervalRow } from "./interval-resolver";

function row(
  id: string,
  effectiveFrom: string,
  effectiveTo: string | null,
  value: string,
): IntervalRow<string> {
  return { id, effectiveFrom, effectiveTo, value };
}

function planOf(res: IntervalPlanResult<string>): IntervalPlan<string> {
  assert.ok(res.ok, "expected ok:true plan result");
  return res.plan;
}

function errorsOf(res: IntervalPlanResult<string>): { code: string }[] {
  assert.equal(res.ok, false);
  if (res.ok) {
    throw new Error("unreachable");
  }
  return res.errors;
}

function hasErrorCode(res: IntervalPlanResult<string>, code: string): boolean {
  return errorsOf(res).some((e) => e.code === code);
}

function write(value: string, effectiveFrom: string, newId = "new"): IntervalWriteInput<string> {
  return { effectiveFrom, value, newId };
}

// A contiguous, open-ended-last history reused across cases.
const CONTIGUOUS: IntervalRow<string>[] = [
  row("a", "2026-01-01", "2026-02-01", "A"),
  row("b", "2026-02-01", "2026-03-01", "B"),
  row("c", "2026-03-01", null, "C"),
];

// =========================== WRITE PLAN ==================================

// A. First-ever row: insert [F, null].
test("write: first-ever row inserts an open-ended row", () => {
  const plan = planOf(planIntervalWrite<string>([], write("X", "2026-01-01", "n1")));
  assert.equal(plan.operations.length, 1);
  assert.deepEqual(plan.operations[0], {
    type: "insert",
    row: row("n1", "2026-01-01", null, "X"),
  });
  assert.deepEqual(plan.resultingRows, [row("n1", "2026-01-01", null, "X")]);
});

// B. Same-effectiveFrom correction: update value, preserve effectiveTo, no dup.
test("write: same-date correction updates value and preserves effectiveTo", () => {
  const plan = planOf(planIntervalWrite(CONTIGUOUS, write("B2", "2026-02-01", "ignored")));
  assert.equal(plan.operations.length, 1);
  assert.deepEqual(plan.operations[0], {
    type: "update",
    id: "b",
    row: row("b", "2026-02-01", "2026-03-01", "B2"),
  });
  // No duplicate; neighbours a and c unchanged.
  assert.equal(plan.resultingRows.length, 3);
  assert.deepEqual(plan.resultingRows[0], row("a", "2026-01-01", "2026-02-01", "A"));
  assert.deepEqual(plan.resultingRows[2], row("c", "2026-03-01", null, "C"));
});

// C. Append after the current open-ended last row.
test("write: append after last closes the open-ended row and opens a new one", () => {
  const rows = [row("a", "2026-01-01", null, "A")];
  const plan = planOf(planIntervalWrite(rows, write("B", "2026-04-01", "n1")));
  assert.deepEqual(plan.operations, [
    { type: "update", id: "a", row: row("a", "2026-01-01", "2026-04-01", "A") },
    { type: "insert", row: row("n1", "2026-04-01", null, "B") },
  ]);
});

// D. Insert between existing rows.
test("write: insert between splits the containing row and bounds the new row", () => {
  const rows = [
    row("a", "2026-01-01", "2026-03-01", "A"),
    row("b", "2026-03-01", null, "B"),
  ];
  const plan = planOf(planIntervalWrite(rows, write("M", "2026-02-01", "n1")));
  assert.deepEqual(plan.operations, [
    { type: "update", id: "a", row: row("a", "2026-01-01", "2026-02-01", "A") },
    { type: "insert", row: row("n1", "2026-02-01", "2026-03-01", "M") },
  ]);
  // next row unchanged.
  assert.deepEqual(plan.resultingRows[2], row("b", "2026-03-01", null, "B"));
});

// E. Insert before the first row: no invented prehistory, no overlap.
test("write: insert before the first row bounds the new row by the first start", () => {
  const rows = [row("a", "2026-02-01", null, "A")];
  const plan = planOf(planIntervalWrite(rows, write("Z", "2026-01-01", "n1")));
  assert.deepEqual(plan.operations, [
    { type: "insert", row: row("n1", "2026-01-01", "2026-02-01", "Z") },
  ]);
  // a is unchanged (no prev update).
  assert.deepEqual(plan.resultingRows[1], row("a", "2026-02-01", null, "A"));
});

// F. Multiple future rows: only immediate boundary + inserted row change.
test("write: with multiple future rows only the containing row and new row change", () => {
  const plan = planOf(planIntervalWrite(CONTIGUOUS, write("M", "2026-02-15", "n1")));
  assert.deepEqual(plan.operations, [
    { type: "update", id: "b", row: row("b", "2026-02-01", "2026-02-15", "B") },
    { type: "insert", row: row("n1", "2026-02-15", "2026-03-01", "M") },
  ]);
  // a and c untouched.
  assert.deepEqual(plan.resultingRows[0], row("a", "2026-01-01", "2026-02-01", "A"));
  assert.deepEqual(
    plan.resultingRows.find((r) => r.id === "c"),
    row("c", "2026-03-01", null, "C"),
  );
});

// G. Gap: F inside an intentional gap does not extend the previous row.
test("write: inserting inside an intentional gap never extends the previous row", () => {
  const rows = [
    row("a", "2026-01-01", "2026-02-01", "A"),
    row("c", "2026-04-01", null, "C"),
  ];
  const plan = planOf(planIntervalWrite(rows, write("M", "2026-03-01", "n1")));
  assert.deepEqual(plan.operations, [
    { type: "insert", row: row("n1", "2026-03-01", "2026-04-01", "M") },
  ]);
  // a keeps its original (gap 02-01..03-01 preserved), c unchanged.
  assert.deepEqual(plan.resultingRows[0], row("a", "2026-01-01", "2026-02-01", "A"));
  assert.deepEqual(plan.resultingRows[2], row("c", "2026-04-01", null, "C"));
});

// H. Zero-width / inverted EXISTING row is rejected.
test("write: an inverted existing row is rejected (zero-width/inverted)", () => {
  const rows = [row("a", "2026-03-01", "2026-01-01", "A")];
  const res = planIntervalWrite(rows, write("X", "2026-05-01"));
  assert.ok(hasErrorCode(res, "NON_POSITIVE_INTERVAL"));
});

// I-a. Duplicate effectiveFrom in existing input is rejected.
test("write: duplicate effectiveFrom in existing input is rejected", () => {
  const rows = [
    row("a", "2026-01-01", "2026-02-01", "A"),
    row("b", "2026-01-01", null, "B"),
  ];
  const res = planIntervalWrite(rows, write("X", "2026-05-01"));
  assert.ok(hasErrorCode(res, "DUPLICATE_EFFECTIVE_FROM"));
});

// I-b. Overlapping existing rows are rejected.
test("write: overlapping existing rows are rejected", () => {
  const rows = [
    row("a", "2026-01-01", "2026-03-01", "A"),
    row("b", "2026-02-01", null, "B"),
  ];
  const res = planIntervalWrite(rows, write("X", "2026-05-01"));
  assert.ok(hasErrorCode(res, "OVERLAPPING_INTERVALS"));
});

// I-c. Two open-ended rows are rejected.
test("write: two open-ended existing rows are rejected", () => {
  const rows = [
    row("a", "2026-01-01", null, "A"),
    row("b", "2026-02-01", null, "B"),
  ];
  const res = planIntervalWrite(rows, write("X", "2026-05-01"));
  assert.ok(hasErrorCode(res, "MULTIPLE_OPEN_ENDED"));
});

// I-d. An open-ended row followed by a future row is rejected.
test("write: an open-ended row followed by a later row is rejected", () => {
  const rows = [
    row("a", "2026-01-01", null, "A"),
    row("b", "2026-02-01", "2026-03-01", "B"),
  ];
  const res = planIntervalWrite(rows, write("X", "2026-05-01"));
  assert.ok(hasErrorCode(res, "OPEN_ENDED_NOT_LAST"));
});

// Invalid input effectiveFrom is rejected.
test("write: a malformed input effectiveFrom is rejected", () => {
  const res = planIntervalWrite(CONTIGUOUS, write("X", "2026-13-01"));
  assert.ok(hasErrorCode(res, "INVALID_INPUT_DATE_KEY"));
});

// Deterministic operation order (update before insert) and order-independence.
test("write: operation order is deterministic and independent of input order", () => {
  const shuffled = [CONTIGUOUS[2], CONTIGUOUS[0], CONTIGUOUS[1]];
  const planA = planOf(planIntervalWrite(CONTIGUOUS, write("M", "2026-02-15", "n1")));
  const planB = planOf(planIntervalWrite(shuffled, write("M", "2026-02-15", "n1")));
  assert.equal(planA.operations[0].type, "update");
  assert.equal(planA.operations[1].type, "insert");
  assert.deepEqual(planA.operations, planB.operations);
  assert.deepEqual(planA.resultingRows, planB.resultingRows);
});

// Input remains unmodified.
test("write: planning does not mutate the input rows", () => {
  const snapshot = JSON.parse(JSON.stringify(CONTIGUOUS));
  planIntervalWrite(CONTIGUOUS, write("M", "2026-02-15", "n1"));
  planIntervalWrite(CONTIGUOUS, write("B2", "2026-02-01", "n2"));
  assert.deepEqual(CONTIGUOUS, snapshot);
});

// =========================== DELETE PLAN =================================

// Delete a middle row reconnects the previous boundary to the next start.
test("delete: middle row reconnects previous.effectiveTo to next.effectiveFrom", () => {
  const plan = planOf(planIntervalDelete(CONTIGUOUS, { by: "id", id: "b" }));
  assert.deepEqual(plan.operations, [
    { type: "update", id: "a", row: row("a", "2026-01-01", "2026-03-01", "A") },
    { type: "delete", id: "b" },
  ]);
  assert.deepEqual(plan.resultingRows, [
    row("a", "2026-01-01", "2026-03-01", "A"),
    row("c", "2026-03-01", null, "C"),
  ]);
});

// Delete the first row: next unchanged; no invented prehistory.
test("delete: first row leaves the next row unchanged (no invented prehistory)", () => {
  const plan = planOf(planIntervalDelete(CONTIGUOUS, { by: "id", id: "a" }));
  assert.deepEqual(plan.operations, [{ type: "delete", id: "a" }]);
  assert.deepEqual(plan.resultingRows, [
    row("b", "2026-02-01", "2026-03-01", "B"),
    row("c", "2026-03-01", null, "C"),
  ]);
});

// Delete the last row reopens the previous row (effectiveTo becomes null).
test("delete: last row reopens the previous row to open-ended", () => {
  const plan = planOf(planIntervalDelete(CONTIGUOUS, { by: "effectiveFrom", effectiveFrom: "2026-03-01" }));
  assert.deepEqual(plan.operations, [
    { type: "update", id: "b", row: row("b", "2026-02-01", null, "B") },
    { type: "delete", id: "c" },
  ]);
});

// Delete the only row yields an empty plan.
test("delete: the only row yields an empty resulting set", () => {
  const rows = [row("a", "2026-01-01", null, "A")];
  const plan = planOf(planIntervalDelete(rows, { by: "id", id: "a" }));
  assert.deepEqual(plan.operations, [{ type: "delete", id: "a" }]);
  assert.deepEqual(plan.resultingRows, []);
});

// Deleting an unknown target yields a structured error (no invented return).
test("delete: unknown target yields a structured UNKNOWN_TARGET error", () => {
  const byId = planIntervalDelete(CONTIGUOUS, { by: "id", id: "zzz" });
  assert.ok(hasErrorCode(byId, "UNKNOWN_TARGET"));
  const byDate = planIntervalDelete(CONTIGUOUS, { by: "effectiveFrom", effectiveFrom: "2030-01-01" });
  assert.ok(hasErrorCode(byDate, "UNKNOWN_TARGET"));
});

// Delete rejects invalid existing input.
test("delete: invalid existing input is rejected", () => {
  const rows = [
    row("a", "2026-01-01", "2026-03-01", "A"),
    row("b", "2026-02-01", null, "B"),
  ];
  const res = planIntervalDelete(rows, { by: "id", id: "a" });
  assert.ok(hasErrorCode(res, "OVERLAPPING_INTERVALS"));
});

// Delete does not mutate the input rows.
test("delete: planning does not mutate the input rows", () => {
  const snapshot = JSON.parse(JSON.stringify(CONTIGUOUS));
  planIntervalDelete(CONTIGUOUS, { by: "id", id: "b" });
  planIntervalDelete(CONTIGUOUS, { by: "id", id: "c" });
  assert.deepEqual(CONTIGUOUS, snapshot);
});

// =========================== INVARIANTS =================================

// Resulting rows after a write are internally valid (no overlaps etc.).
test("invariants: write resulting rows pass validateIntervalRows", () => {
  const plan = planOf(planIntervalWrite(CONTIGUOUS, write("M", "2026-02-15", "n1")));
  assert.deepEqual(validateIntervalRows(plan.resultingRows), []);
});

// Resulting rows after a delete are internally valid.
test("invariants: delete resulting rows pass validateIntervalRows", () => {
  const plan = planOf(planIntervalDelete(CONTIGUOUS, { by: "id", id: "b" }));
  assert.deepEqual(validateIntervalRows(plan.resultingRows), []);
});

// A valid contiguous history has unique effectiveFrom, one open-ended row,
// no overlaps, and every closed interval has effectiveTo > effectiveFrom.
test("invariants: a well-formed history reports no errors", () => {
  assert.deepEqual(validateIntervalRows(CONTIGUOUS), []);
  const froms = CONTIGUOUS.map((r) => r.effectiveFrom);
  assert.equal(new Set(froms).size, froms.length); // unique effectiveFrom
  assert.equal(CONTIGUOUS.filter((r) => r.effectiveTo === null).length, 1); // one open row
  for (const r of CONTIGUOUS) {
    if (r.effectiveTo !== null) {
      assert.equal(r.effectiveFrom < r.effectiveTo, true); // closed => positive
    }
  }
});

// An intentional gap is legal and reports no invariant errors.
test("invariants: an intentional gap is legal", () => {
  const gapped = [
    row("a", "2026-01-01", "2026-02-01", "A"),
    row("c", "2026-03-01", null, "C"),
  ];
  assert.deepEqual(validateIntervalRows(gapped), []);
});
