/**
 * P-MATERIALS M2B - focused BEHAVIOURAL tests for the shared audience WRITE
 * helpers (offering authorization + audience reconciliation), exercised through
 * their dependency-injected orchestration and pure decisions with plain fakes.
 * No Prisma, no database, no storage.
 *
 * NOTE: this file deliberately never spells the audience model identifier so it
 * stays outside the confinement walk in
 * prisma/m0-course-material-audience.contract.test.ts; the real Prisma bindings
 * (assertOfferingIdsAllowed / applyMaterialAudiences) are thin wrappers over the
 * WithDeps functions covered here and are pinned structurally elsewhere.
 *
 * Uses the existing `tsx` + node:test approach. Run with:
 *   npx tsx --test lib/course/material-audience-write.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  NoCurrentActivityYearError,
  OfferingNotAllowedError,
  resolveCurrentActivityYearIdFromRows,
  assertOfferingIdsAllowedFromRows,
  assertOfferingIdsAllowedWithDeps,
  applyMaterialAudiencesWithDeps,
  type AllowedOfferingRow,
} from "@/lib/course/material-audience-write";

const YEAR = "year-current";
const OTHER_YEAR = "year-other";
const L1 = "offering-l1";
const L2 = "offering-l2";
const PLANNED_OFFERING = "offering-planned";
const ARCHIVED_OFFERING = "offering-archived";

// ===========================================================================
// resolveCurrentActivityYearIdFromRows
// ===========================================================================

test("current ActivityYear = the single distinct active-offering year", () => {
  assert.equal(
    resolveCurrentActivityYearIdFromRows([{ activityYearId: YEAR }, { activityYearId: YEAR }]),
    YEAR,
  );
});

test("zero active offerings -> NoCurrentActivityYearError (fails closed)", () => {
  assert.throws(() => resolveCurrentActivityYearIdFromRows([]), (e: unknown) => {
    assert.ok(e instanceof NoCurrentActivityYearError);
    assert.equal(e.distinctActiveYearCount, 0);
    return true;
  });
});

test("two distinct active years -> NoCurrentActivityYearError (never guesses)", () => {
  assert.throws(
    () =>
      resolveCurrentActivityYearIdFromRows([
        { activityYearId: YEAR },
        { activityYearId: OTHER_YEAR },
      ]),
    (e: unknown) => {
      assert.ok(e instanceof NoCurrentActivityYearError);
      assert.equal(e.distinctActiveYearCount, 2);
      return true;
    },
  );
});

test("blank/whitespace year ids are ignored for distinctness (cannot widen scope)", () => {
  assert.throws(
    () =>
      resolveCurrentActivityYearIdFromRows([
        { activityYearId: "  " },
        { activityYearId: "" },
      ]),
    NoCurrentActivityYearError,
  );
});

// ===========================================================================
// assertOfferingIdsAllowedFromRows
// ===========================================================================

const ROWS: AllowedOfferingRow[] = [
  { id: L1, status: "ACTIVE", activityYearId: YEAR },
  { id: L2, status: "ACTIVE", activityYearId: YEAR },
  { id: PLANNED_OFFERING, status: "PLANNED", activityYearId: YEAR },
  { id: ARCHIVED_OFFERING, status: "ARCHIVED", activityYearId: YEAR },
  { id: "offering-otheryear", status: "ACTIVE", activityYearId: OTHER_YEAR },
];

test("ACTIVE and PLANNED offerings in the current year are allowed", () => {
  assert.doesNotThrow(() =>
    assertOfferingIdsAllowedFromRows([L1, L2, PLANNED_OFFERING], YEAR, ROWS),
  );
});

test("an unknown offering id is rejected with reason not-found", () => {
  assert.throws(
    () => assertOfferingIdsAllowedFromRows([L1, "ghost"], YEAR, ROWS),
    (e: unknown) => {
      assert.ok(e instanceof OfferingNotAllowedError);
      assert.equal(e.offeringId, "ghost");
      assert.equal(e.reason, "not-found");
      return true;
    },
  );
});

test("an ARCHIVED offering is rejected", () => {
  assert.throws(
    () => assertOfferingIdsAllowedFromRows([ARCHIVED_OFFERING], YEAR, ROWS),
    (e: unknown) => {
      assert.ok(e instanceof OfferingNotAllowedError);
      assert.equal(e.offeringId, ARCHIVED_OFFERING);
      assert.equal(e.reason, "archived-or-not-selectable");
      return true;
    },
  );
});

test("an offering from another ActivityYear is rejected", () => {
  assert.throws(
    () => assertOfferingIdsAllowedFromRows(["offering-otheryear"], YEAR, ROWS),
    (e: unknown) => {
      assert.ok(e instanceof OfferingNotAllowedError);
      assert.equal(e.reason, "wrong-activity-year");
      return true;
    },
  );
});

test("a single disallowed id fails the whole set (no silent filtering)", () => {
  // L1 is valid, ARCHIVED is not: the presence of one bad id throws rather than
  // quietly keeping the good one.
  assert.throws(
    () => assertOfferingIdsAllowedFromRows([L1, ARCHIVED_OFFERING], YEAR, ROWS),
    OfferingNotAllowedError,
  );
});

// ===========================================================================
// assertOfferingIdsAllowedWithDeps (orchestration order)
// ===========================================================================

test("orchestration: derives current year, then authorizes requested ids", async () => {
  const calls: string[] = [];
  await assertOfferingIdsAllowedWithDeps([L1, PLANNED_OFFERING], {
    fetchActiveOfferingYearRows: async () => {
      calls.push("active");
      return [{ activityYearId: YEAR }, { activityYearId: YEAR }];
    },
    fetchOfferingRowsByIds: async (ids) => {
      calls.push(`byIds:${[...ids].join(",")}`);
      return ROWS.filter((r) => ids.includes(r.id));
    },
  });
  assert.deepEqual(calls, ["active", `byIds:${L1},${PLANNED_OFFERING}`]);
});

test("orchestration fails closed when no current year is resolvable", async () => {
  await assert.rejects(
    () =>
      assertOfferingIdsAllowedWithDeps([L1], {
        fetchActiveOfferingYearRows: async () => [],
        fetchOfferingRowsByIds: async () => ROWS,
      }),
    NoCurrentActivityYearError,
  );
});

// ===========================================================================
// applyMaterialAudiencesWithDeps (delete/create branching over the M2A diff)
// ===========================================================================

interface ExistingRow {
  id: string;
  courseOfferingId: string;
}

function makeAudienceWriteSpy(existing: ExistingRow[]) {
  const deleted: string[][] = [];
  const created: string[][] = [];
  return {
    deleted,
    created,
    deps: {
      loadExistingAudiences: async () => existing,
      deleteAudiences: async (ids: readonly string[]) => {
        deleted.push([...ids]);
      },
      createAudiences: async (offeringIds: readonly string[]) => {
        created.push([...offeringIds]);
      },
    },
  };
}

test("create (no existing rows) inserts every desired offering, deletes nothing", async () => {
  const spy = makeAudienceWriteSpy([]);
  await applyMaterialAudiencesWithDeps([L1, L2], spy.deps);
  assert.deepEqual(spy.created, [[L1, L2]]);
  assert.deepEqual(spy.deleted, [], "no delete call is issued when nothing is removed");
});

test("edit reconciles add + remove, leaving unchanged rows untouched", async () => {
  // existing = {L1, L2}; desired = {L1, PLANNED}. Keep L1, add PLANNED, drop L2.
  const spy = makeAudienceWriteSpy([
    { id: "row-l1", courseOfferingId: L1 },
    { id: "row-l2", courseOfferingId: L2 },
  ]);
  await applyMaterialAudiencesWithDeps([L1, PLANNED_OFFERING], spy.deps);
  assert.deepEqual(spy.deleted, [["row-l2"]]);
  assert.deepEqual(spy.created, [[PLANNED_OFFERING]]);
});

test("an unchanged desired set issues NO delete and NO create call", async () => {
  const spy = makeAudienceWriteSpy([
    { id: "row-l1", courseOfferingId: L1 },
    { id: "row-l2", courseOfferingId: L2 },
  ]);
  await applyMaterialAudiencesWithDeps([L1, L2], spy.deps);
  assert.deepEqual(spy.deleted, [], "no rows deleted");
  assert.deepEqual(spy.created, [], "no rows created");
});

test("remove-only edit deletes just the removed rows", async () => {
  const spy = makeAudienceWriteSpy([
    { id: "row-l1", courseOfferingId: L1 },
    { id: "row-l2", courseOfferingId: L2 },
  ]);
  await applyMaterialAudiencesWithDeps([L1], spy.deps);
  assert.deepEqual(spy.deleted, [["row-l2"]]);
  assert.deepEqual(spy.created, []);
});
