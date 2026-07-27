/**
 * P-MATERIALS M2D - focused tests for the admin offering-picker PURE core, plus a
 * cross-check that the picker offers EXACTLY the set the M2B writer accepts.
 *
 * DB-free. Uses the existing `tsx` + node:test approach. Run with:
 *   npx tsx --test lib/course/material-offering-picker-core.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMaterialOfferingPickerOptions,
  type MaterialOfferingPickerRow,
} from "@/lib/course/material-offering-picker-core";
import {
  assertOfferingIdsAllowedFromRows,
  OfferingNotAllowedError,
  type AllowedOfferingRow,
} from "@/lib/course/material-audience-write";

const YEAR = "year-current";
const OTHER_YEAR = "year-other";

function row(overrides: Partial<MaterialOfferingPickerRow> = {}): MaterialOfferingPickerRow {
  return { id: "off-a", name: "Level 1", level: 1, status: "ACTIVE", activityYearId: YEAR, ...overrides };
}

const NO_CAPS: ReadonlyMap<string, boolean> = new Map();

// 1
test("includes a current-year ACTIVE offering", () => {
  const opts = buildMaterialOfferingPickerOptions([row({ id: "a", status: "ACTIVE" })], YEAR, NO_CAPS);
  assert.deepEqual(opts.map((o) => o.id), ["a"]);
  assert.equal(opts[0].status, "ACTIVE");
});

// 2
test("includes a current-year PLANNED offering", () => {
  const opts = buildMaterialOfferingPickerOptions([row({ id: "p", status: "PLANNED" })], YEAR, NO_CAPS);
  assert.deepEqual(opts.map((o) => o.id), ["p"]);
});

// 3
test("excludes an ARCHIVED offering", () => {
  const opts = buildMaterialOfferingPickerOptions([row({ id: "arch", status: "ARCHIVED" })], YEAR, NO_CAPS);
  assert.deepEqual(opts, []);
});

// 4
test("excludes an offering from another ActivityYear", () => {
  const opts = buildMaterialOfferingPickerOptions(
    [row({ id: "other", activityYearId: OTHER_YEAR })],
    YEAR,
    NO_CAPS,
  );
  assert.deepEqual(opts, []);
});

// 5
test("surfaces the effective COURSE_MATERIALS enabled flag per offering", () => {
  const caps = new Map<string, boolean>([
    ["l1", true],
    ["l2", false],
  ]);
  const opts = buildMaterialOfferingPickerOptions(
    [row({ id: "l1", name: "Level 1" }), row({ id: "l2", name: "Level 2", level: 2 })],
    YEAR,
    caps,
  );
  assert.equal(opts.find((o) => o.id === "l1")?.materialsCapabilityEnabled, true);
  assert.equal(opts.find((o) => o.id === "l2")?.materialsCapabilityEnabled, false);
  // A missing capability entry is fail-closed (not enabled).
  const opts2 = buildMaterialOfferingPickerOptions([row({ id: "l3" })], YEAR, NO_CAPS);
  assert.equal(opts2[0].materialsCapabilityEnabled, false);
});

test("label is the offering NAME and never the identity (id stays the identity)", () => {
  const opts = buildMaterialOfferingPickerOptions([row({ id: "the-id", name: "רמה 1" })], YEAR, NO_CAPS);
  assert.equal(opts[0].id, "the-id");
  assert.equal(opts[0].label, "רמה 1");
});

test("deterministic order: ACTIVE before PLANNED, then level, then label, then id", () => {
  const opts = buildMaterialOfferingPickerOptions(
    [
      row({ id: "b", name: "B", level: 2, status: "ACTIVE" }),
      row({ id: "planned", name: "A", level: 1, status: "PLANNED" }),
      row({ id: "a", name: "A", level: 1, status: "ACTIVE" }),
    ],
    YEAR,
    NO_CAPS,
  );
  assert.deepEqual(opts.map((o) => o.id), ["a", "b", "planned"]);
});

test("blank id rows are dropped; result and options are frozen; input not mutated", () => {
  const rows = [row({ id: "  " }), row({ id: "ok" })];
  const snapshot = rows.map((r) => ({ ...r }));
  const opts = buildMaterialOfferingPickerOptions(rows, YEAR, NO_CAPS);
  assert.deepEqual(opts.map((o) => o.id), ["ok"]);
  assert.ok(Object.isFrozen(opts));
  assert.ok(Object.isFrozen(opts[0]));
  assert.deepEqual(rows, snapshot, "input rows untouched");
});

// ---------------------------------------------------------------------------
// AGREEMENT: the picker offers EXACTLY what the M2B writer accepts
// ---------------------------------------------------------------------------

test("picker inclusion matches the writer's allowed-offering rule exactly", () => {
  const rows: MaterialOfferingPickerRow[] = [
    row({ id: "active-current", status: "ACTIVE", activityYearId: YEAR }),
    row({ id: "planned-current", status: "PLANNED", activityYearId: YEAR }),
    row({ id: "archived-current", status: "ARCHIVED", activityYearId: YEAR }),
    row({ id: "active-other-year", status: "ACTIVE", activityYearId: OTHER_YEAR }),
  ];
  const allowedRows: AllowedOfferingRow[] = rows.map((r) => ({
    id: r.id,
    status: r.status,
    activityYearId: r.activityYearId,
  }));

  const offered = new Set(buildMaterialOfferingPickerOptions(rows, YEAR, NO_CAPS).map((o) => o.id));

  for (const r of rows) {
    let writerAccepts = true;
    try {
      assertOfferingIdsAllowedFromRows([r.id], YEAR, allowedRows);
    } catch (error) {
      assert.ok(error instanceof OfferingNotAllowedError);
      writerAccepts = false;
    }
    assert.equal(
      offered.has(r.id),
      writerAccepts,
      `${r.id}: picker offered=${offered.has(r.id)} but writer accepts=${writerAccepts}`,
    );
  }
});
