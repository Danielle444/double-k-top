/**
 * P-MATERIALS M2A - focused tests for the PURE course-material audience
 * validation + reconciliation core.
 *
 * DB-free and IO-free by construction (the module under test is pure). Uses the
 * existing `tsx` + node:test approach. Run with:
 *   npx tsx --test lib/course/material-audience-reconcile-core.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  MaterialAudienceInputError,
  normalizeMaterialAudienceOfferingIds,
  reconcileMaterialAudiences,
  type MaterialAudienceRow,
} from "@/lib/course/material-audience-reconcile-core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Assert a thunk throws a MaterialAudienceInputError with the given code/index. */
function assertInputError(
  fn: () => unknown,
  code: MaterialAudienceInputError["code"],
  index?: number,
): void {
  assert.throws(
    fn,
    (error: unknown) => {
      assert.ok(error instanceof MaterialAudienceInputError, "must be a typed domain error");
      assert.equal(error.code, code, `code must be ${code}`);
      if (index !== undefined) {
        assert.equal(error.index, index, `index must be ${index}`);
      }
      return true;
    },
  );
}

/** A stable pair of ids the value-preservation tests can reason about exactly. */
const A = "cmoffering0000000000000a";
const B = "cmoffering0000000000000b";
const C = "cmoffering0000000000000c";

// ===========================================================================
// normalizeMaterialAudienceOfferingIds
// ===========================================================================

// 1
test("non-array input rejects with NOT_ARRAY", () => {
  for (const bad of [undefined, null, "abc", 42, {}, { length: 1 }, new Set([A])]) {
    assertInputError(() => normalizeMaterialAudienceOfferingIds(bad as unknown), "NOT_ARRAY");
  }
});

// 2
test("empty array rejects with EMPTY_SELECTION", () => {
  assertInputError(() => normalizeMaterialAudienceOfferingIds([]), "EMPTY_SELECTION");
});

// 3
test("blank string rejects with INVALID_ID and reports the index", () => {
  assertInputError(() => normalizeMaterialAudienceOfferingIds([A, "", B]), "INVALID_ID", 1);
});

// 4
test("whitespace-only string rejects with INVALID_ID", () => {
  assertInputError(() => normalizeMaterialAudienceOfferingIds([A, "   "]), "INVALID_ID", 1);
  assertInputError(() => normalizeMaterialAudienceOfferingIds(["\t\n "]), "INVALID_ID", 0);
});

// 5
test("non-string item rejects with INVALID_ID and the index", () => {
  assertInputError(() => normalizeMaterialAudienceOfferingIds([A, 7]), "INVALID_ID", 1);
  assertInputError(() => normalizeMaterialAudienceOfferingIds([null, A]), "INVALID_ID", 0);
  assertInputError(() => normalizeMaterialAudienceOfferingIds([A, B, {}]), "INVALID_ID", 2);
});

// 6
test("accepted ids are not trimmed or rewritten", () => {
  // An id with surrounding whitespace is NON-BLANK, so it is accepted and MUST
  // survive byte-for-byte - the pure core never trims a value it keeps.
  const padded = `  ${A}  `;
  const result = normalizeMaterialAudienceOfferingIds([padded, B]);
  assert.deepEqual([...result], [padded, B]);
  assert.equal(result[0], padded, "the accepted value must be kept exactly as supplied");
});

// 7
test("exact duplicates deduplicate in first-seen order", () => {
  const result = normalizeMaterialAudienceOfferingIds([B, A, B, C, A]);
  assert.deepEqual([...result], [B, A, C]);
});

// 8
test("a valid normalized result is frozen", () => {
  const result = normalizeMaterialAudienceOfferingIds([A, B]);
  assert.ok(Object.isFrozen(result), "the returned array must be frozen");
  assert.throws(() => {
    (result as string[]).push(C);
  });
});

test("distinct-but-similar ids are NOT collapsed (case / substring are significant)", () => {
  const upper = A.toUpperCase();
  const result = normalizeMaterialAudienceOfferingIds([A, upper]);
  assert.deepEqual([...result], [A, upper], "case-different ids are different ids");
});

test("normalization does not mutate its input array", () => {
  const input = [B, A, B];
  const snapshot = [...input];
  normalizeMaterialAudienceOfferingIds(input);
  assert.deepEqual(input, snapshot, "the input array must be untouched");
});

// ===========================================================================
// reconcileMaterialAudiences
// ===========================================================================

function row(id: string, courseOfferingId: string): MaterialAudienceRow {
  return { id, courseOfferingId };
}

// 9
test("identical desired/existing sets yield no operations (idempotent)", () => {
  const existing = [row("r-a", A), row("r-b", B)];
  const result = reconcileMaterialAudiences([A, B], existing);
  assert.deepEqual([...result.toCreate], []);
  assert.deepEqual([...result.toDelete], []);

  // Order-independent: desired stated in the other order still no-ops.
  const reordered = reconcileMaterialAudiences([B, A], existing);
  assert.deepEqual([...reordered.toCreate], []);
  assert.deepEqual([...reordered.toDelete], []);
});

// 10
test("add-only diff", () => {
  const result = reconcileMaterialAudiences([A, B, C], [row("r-a", A)]);
  assert.deepEqual([...result.toCreate], [B, C]);
  assert.deepEqual([...result.toDelete], []);
});

test("create-from-nothing is add-only for every desired id", () => {
  const result = reconcileMaterialAudiences([A, B], []);
  assert.deepEqual([...result.toCreate], [A, B]);
  assert.deepEqual([...result.toDelete], []);
});

// 11
test("remove-only diff", () => {
  const existing = [row("r-a", A), row("r-b", B), row("r-c", C)];
  const result = reconcileMaterialAudiences([A], existing);
  assert.deepEqual([...result.toCreate], []);
  assert.deepEqual([...result.toDelete], ["r-b", "r-c"]);
});

// 12
test("mixed add/remove diff", () => {
  // desired = {A, C}; existing = {A, B}. Keep A, add C, delete B's row.
  const existing = [row("r-a", A), row("r-b", B)];
  const result = reconcileMaterialAudiences([A, C], existing);
  assert.deepEqual([...result.toCreate], [C]);
  assert.deepEqual([...result.toDelete], ["r-b"]);
});

// 13
test("unchanged existing rows are neither deleted nor recreated", () => {
  const existing = [row("r-a", A), row("r-b", B)];
  const result = reconcileMaterialAudiences([A, B, C], existing);
  assert.ok(!result.toDelete.includes("r-a"));
  assert.ok(!result.toDelete.includes("r-b"));
  assert.ok(!result.toCreate.includes(A));
  assert.ok(!result.toCreate.includes(B));
  assert.deepEqual([...result.toCreate], [C]);
});

// 14
test("duplicate existing offering rows do not duplicate delete ids", () => {
  // Two rows target the same (now-undesired) offering B; both distinct row ids
  // are deleted, but neither id appears twice.
  const existing = [row("r-b1", B), row("r-b2", B), row("r-a", A)];
  const result = reconcileMaterialAudiences([A], existing);
  assert.deepEqual([...result.toDelete], ["r-b1", "r-b2"]);
  assert.equal(new Set(result.toDelete).size, result.toDelete.length, "no duplicate delete ids");
});

test("a still-desired offering with duplicate rows is not created and not deleted", () => {
  const existing = [row("r-b1", B), row("r-b2", B)];
  const result = reconcileMaterialAudiences([B], existing);
  assert.deepEqual([...result.toCreate], [], "an already-present offering is never re-created");
  assert.deepEqual([...result.toDelete], [], "duplicate rows of a desired offering are left as-is");
});

test("a pathological same-id existing row cannot yield a duplicate delete id", () => {
  const existing = [row("dup", B), row("dup", C)];
  const result = reconcileMaterialAudiences([A], existing);
  assert.deepEqual([...result.toDelete], ["dup"], "the same row id is emitted at most once");
});

// 15
test("input order determines stable output order", () => {
  const existing = [row("r-a", A)];
  assert.deepEqual([...reconcileMaterialAudiences([C, B, A], existing).toCreate], [C, B]);
  assert.deepEqual([...reconcileMaterialAudiences([B, C, A], existing).toCreate], [B, C]);

  // toDelete follows existing-row order, independent of desired order.
  const existing2 = [row("r-c", C), row("r-b", B), row("r-a", A)];
  assert.deepEqual([...reconcileMaterialAudiences([A], existing2).toDelete], ["r-c", "r-b"]);
});

test("desired duplicates collapse first-seen in toCreate", () => {
  const result = reconcileMaterialAudiences([C, B, C, B], []);
  assert.deepEqual([...result.toCreate], [C, B]);
});

// 16
test("reconcile does not mutate either input", () => {
  const desired = [A, C];
  const existing = [row("r-a", A), row("r-b", B)];
  const desiredSnapshot = [...desired];
  const existingSnapshot = existing.map((r) => ({ ...r }));

  reconcileMaterialAudiences(desired, existing);

  assert.deepEqual(desired, desiredSnapshot, "desired input untouched");
  assert.deepEqual(existing, existingSnapshot, "existing input untouched");
});

// 17
test("the reconciliation result and both arrays are frozen", () => {
  const result = reconcileMaterialAudiences([A, C], [row("r-b", B)]);
  assert.ok(Object.isFrozen(result), "result object frozen");
  assert.ok(Object.isFrozen(result.toCreate), "toCreate frozen");
  assert.ok(Object.isFrozen(result.toDelete), "toDelete frozen");
  assert.throws(() => {
    (result.toCreate as string[]).push("x");
  });
  assert.throws(() => {
    (result.toDelete as string[]).push("x");
  });
});

// 18
test("a large desired/existing set reconciles deterministically", () => {
  const N = 200;
  const desired = Array.from({ length: N }, (_, i) => `off-${i}`);
  // existing covers the first half plus a block of stale offerings to delete.
  const existing: MaterialAudienceRow[] = [];
  for (let i = 0; i < N / 2; i++) existing.push(row(`row-${i}`, `off-${i}`));
  for (let i = 0; i < 20; i++) existing.push(row(`stale-${i}`, `gone-${i}`));

  const result = reconcileMaterialAudiences(desired, existing);

  // Second half of desired is new, in desired order.
  const expectedCreate = Array.from({ length: N / 2 }, (_, i) => `off-${i + N / 2}`);
  assert.deepEqual([...result.toCreate], expectedCreate);

  // Only the stale rows are deleted, in existing-row order.
  const expectedDelete = Array.from({ length: 20 }, (_, i) => `stale-${i}`);
  assert.deepEqual([...result.toDelete], expectedDelete);

  // Fully deterministic: the same inputs reconcile identically.
  const again = reconcileMaterialAudiences(desired, existing);
  assert.deepEqual([...again.toCreate], [...result.toCreate]);
  assert.deepEqual([...again.toDelete], [...result.toDelete]);
});

// ---------------------------------------------------------------------------
// Defensive runtime validation on reconcile (malformed bypass of normalize)
// ---------------------------------------------------------------------------

test("reconcile fails safely on non-array inputs", () => {
  assertInputError(() => reconcileMaterialAudiences(undefined as unknown as string[], []), "NOT_ARRAY");
  assertInputError(
    () => reconcileMaterialAudiences([A], undefined as unknown as MaterialAudienceRow[]),
    "NOT_ARRAY",
  );
});

test("reconcile rejects a blank/non-string desired id with its index", () => {
  assertInputError(() => reconcileMaterialAudiences([A, ""], []), "INVALID_ID", 1);
  assertInputError(
    () => reconcileMaterialAudiences([A, 5 as unknown as string], []),
    "INVALID_ID",
    1,
  );
});

test("reconcile rejects a malformed existing row with its index", () => {
  assertInputError(
    () => reconcileMaterialAudiences([A], [row("r-a", A), { id: "", courseOfferingId: B }]),
    "INVALID_ID",
    1,
  );
  assertInputError(
    () =>
      reconcileMaterialAudiences(
        [A],
        [{ id: "r-a", courseOfferingId: "" } as MaterialAudienceRow],
      ),
    "INVALID_ID",
    0,
  );
  assertInputError(
    () => reconcileMaterialAudiences([A], [null as unknown as MaterialAudienceRow]),
    "INVALID_ID",
    0,
  );
});

test("the domain error never carries the rejected value", () => {
  // A rejected (non-string) element whose stringification is a recognizable
  // marker: the PII-free error must expose only code/field/index, so the marker
  // must never surface in the message.
  const secret = { toString: () => "super-secret-offering-value" };
  try {
    normalizeMaterialAudienceOfferingIds([A, secret]);
    assert.fail("should have thrown");
  } catch (error) {
    assert.ok(error instanceof MaterialAudienceInputError);
    assert.equal(error.code, "INVALID_ID");
    assert.equal(error.index, 1);
    assert.ok(
      !error.message.includes("super-secret-offering-value"),
      "the rejected value must never appear in the message",
    );
  }
});
