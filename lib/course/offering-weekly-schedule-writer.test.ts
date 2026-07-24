/**
 * MULTI-COURSE Schedule Slice W-S2A - DB-free IO-boundary tests for
 * commitOfferingWeeklyScheduleWithDeps.
 *
 * No Prisma, no DB: the offering resolver, the week-owner reader and the commit
 * are injected as fakes that RECORD their calls, so these tests prove the whole
 * write boundary - gate ordering, the three fail-closed denials, create-time
 * ownership, and re-import ownership preservation - without a live database.
 *
 * Run with: npx tsx --test lib/course/offering-weekly-schedule-writer.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { CourseOfferingStatus } from "@/app/generated/prisma/client";
import {
  commitOfferingWeeklyScheduleWithDeps,
  type CommitOfferingWeekInput,
  type OfferingWeekCommitPlan,
  type OfferingWeekWriterDeps,
} from "./offering-weekly-schedule-writer";
import type { WeekOwnerRow } from "./offering-weekly-schedule-writer-core";
import { CourseOfferingNotFoundError } from "./admin-course-context";

const OFFERING_ID = "cmrxk58vc0000lscnfm54bpze"; // Level 2 (PLANNED)
const OTHER_OFFERING_ID = "cmrqngqhn00017gcndjixzrh0"; // Level 1 (ACTIVE)
const WEEK_ID = "week-l2-1";
const NEW_WEEK_ID = "week-created";

function validInput(overrides: Partial<CommitOfferingWeekInput> = {}): CommitOfferingWeekInput {
  return {
    courseOfferingId: OFFERING_ID,
    name: 'לו"ז שבוע 1',
    startDate: "2026-07-26",
    endDate: "2026-07-31",
    uploadedFileName: "week1.xlsx",
    items: [
      { dateKey: "2026-07-26", startTime: "08:00", endTime: "09:30", title: "רכיבה" },
      { dateKey: "2026-07-27", startTime: "08:00", endTime: "09:30", title: "רכיבה" },
      { dateKey: null, startTime: "", endTime: "", title: "שורה ללא תאריך" },
    ],
    ...overrides,
  };
}

interface Recorder {
  deps: OfferingWeekWriterDeps;
  resolveCalls: string[];
  fetchCalls: string[];
  commitCalls: OfferingWeekCommitPlan[];
}

function makeDeps(
  opts: {
    status?: CourseOfferingStatus;
    resolveThrows?: unknown;
    weekOwner?: WeekOwnerRow | null;
    commitReturns?: string;
  } = {},
): Recorder {
  const resolveCalls: string[] = [];
  const fetchCalls: string[] = [];
  const commitCalls: OfferingWeekCommitPlan[] = [];

  const deps: OfferingWeekWriterDeps = {
    resolveOffering: async (id) => {
      resolveCalls.push(id);
      if (opts.resolveThrows !== undefined) {
        throw opts.resolveThrows;
      }
      return { id: OFFERING_ID, status: opts.status ?? "PLANNED" };
    },
    fetchWeekOwner: async (weeklyScheduleId) => {
      fetchCalls.push(weeklyScheduleId);
      return opts.weekOwner === undefined ? null : opts.weekOwner;
    },
    commit: async (plan) => {
      commitCalls.push(plan);
      return plan.mode === "create" ? (opts.commitReturns ?? NEW_WEEK_ID) : plan.weeklyScheduleId;
    },
  };

  return { deps, resolveCalls, fetchCalls, commitCalls };
}

/** Assert nothing beyond the named gates was reached. */
function assertNoWrite(r: Recorder) {
  assert.equal(r.commitCalls.length, 0, "no commit may occur");
}

// ===========================================================================
// 1. Invalid input short-circuits BEFORE any dependency is touched
// ===========================================================================

test("invalid input: no offering resolution, no policy check, no fetch, no commit", async () => {
  const cases: Array<[Partial<CommitOfferingWeekInput>, string]> = [
    [{ name: "   " }, "name_required"],
    [{ startDate: "" }, "dates_required"],
    [{ endDate: null }, "dates_required"],
    [{ startDate: "26/07/2026" }, "invalid_date"],
    [{ endDate: "2026-02-30" }, "invalid_date"],
    [{ items: "[]" }, "invalid_items"],
  ];

  for (const [overrides, expected] of cases) {
    const r = makeDeps();
    const result = await commitOfferingWeeklyScheduleWithDeps(validInput(overrides), r.deps);
    assert.deepEqual(result, { success: false, error: expected });
    assert.deepEqual(r.resolveCalls, [], `${expected}: offering must not be resolved`);
    assert.deepEqual(r.fetchCalls, [], `${expected}: no week may be fetched`);
    assertNoWrite(r);
  }
});

test("invalid input short-circuits even for a re-import request", async () => {
  const r = makeDeps({ weekOwner: { id: WEEK_ID, courseOfferingId: OFFERING_ID } });
  const result = await commitOfferingWeeklyScheduleWithDeps(
    validInput({ name: "", weeklyScheduleId: WEEK_ID }),
    r.deps,
  );
  assert.deepEqual(result, { success: false, error: "name_required" });
  assert.deepEqual(r.resolveCalls, []);
  assert.deepEqual(r.fetchCalls, []);
  assertNoWrite(r);
});

// ===========================================================================
// 2. Offering resolution
// ===========================================================================

test("offering not found -> offering_not_found, with no fetch and no commit", async () => {
  const r = makeDeps({ resolveThrows: new CourseOfferingNotFoundError("nope") });
  const result = await commitOfferingWeeklyScheduleWithDeps(
    validInput({ weeklyScheduleId: WEEK_ID }),
    r.deps,
  );
  assert.deepEqual(result, { success: false, error: "offering_not_found" });
  assert.deepEqual(r.resolveCalls, [OFFERING_ID]);
  assert.deepEqual(r.fetchCalls, [], "the week must not be probed for an unresolved offering");
  assertNoWrite(r);
});

test("a non-not-found resolver error propagates untouched (never masked as a denial)", async () => {
  const boom = new Error("database is down");
  const r = makeDeps({ resolveThrows: boom });
  await assert.rejects(
    () => commitOfferingWeeklyScheduleWithDeps(validInput(), r.deps),
    /database is down/,
  );
  assertNoWrite(r);
});

// ===========================================================================
// 3. Status policy - SCHEDULE_DRAFT_CONFIGURATION
// ===========================================================================

test("ARCHIVED offering -> operation_not_allowed, with no fetch and no commit", async () => {
  const r = makeDeps({ status: "ARCHIVED", weekOwner: { id: WEEK_ID, courseOfferingId: OFFERING_ID } });
  const result = await commitOfferingWeeklyScheduleWithDeps(
    validInput({ weeklyScheduleId: WEEK_ID }),
    r.deps,
  );
  assert.deepEqual(result, { success: false, error: "operation_not_allowed" });
  assert.deepEqual(r.resolveCalls, [OFFERING_ID]);
  assert.deepEqual(r.fetchCalls, [], "policy is checked BEFORE the week is fetched");
  assertNoWrite(r);
});

test("PLANNED offering is allowed - a Level 2 week can be drafted before the course is ACTIVE", async () => {
  const r = makeDeps({ status: "PLANNED" });
  const result = await commitOfferingWeeklyScheduleWithDeps(validInput(), r.deps);
  assert.deepEqual(result, {
    success: true,
    weeklyScheduleId: NEW_WEEK_ID,
    savedCount: 2,
    skippedCount: 1,
  });
  assert.equal(r.commitCalls.length, 1);
});

test("ACTIVE offering is allowed", async () => {
  const r = makeDeps({ status: "ACTIVE" });
  const result = await commitOfferingWeeklyScheduleWithDeps(validInput(), r.deps);
  assert.equal(result.success, true);
  assert.equal(r.commitCalls.length, 1);
});

// ===========================================================================
// 4. Re-import ownership - three denials, one indistinguishable result
// ===========================================================================

const WEEK_NOT_FOUND = { success: false, error: "week_not_found" } as const;

test("re-import of a missing week -> week_not_found", async () => {
  const r = makeDeps({ weekOwner: null });
  const result = await commitOfferingWeeklyScheduleWithDeps(
    validInput({ weeklyScheduleId: WEEK_ID }),
    r.deps,
  );
  assert.deepEqual(result, WEEK_NOT_FOUND);
  assert.deepEqual(r.fetchCalls, [WEEK_ID]);
  assertNoWrite(r);
});

test("re-import of a NULL-scoped legacy week -> week_not_found (never adopted)", async () => {
  const r = makeDeps({ weekOwner: { id: WEEK_ID, courseOfferingId: null } });
  const result = await commitOfferingWeeklyScheduleWithDeps(
    validInput({ weeklyScheduleId: WEEK_ID }),
    r.deps,
  );
  assert.deepEqual(result, WEEK_NOT_FOUND);
  assertNoWrite(r);
});

test("re-import of another course's week -> week_not_found (no ownership change)", async () => {
  const r = makeDeps({ weekOwner: { id: WEEK_ID, courseOfferingId: OTHER_OFFERING_ID } });
  const result = await commitOfferingWeeklyScheduleWithDeps(
    validInput({ weeklyScheduleId: WEEK_ID }),
    r.deps,
  );
  assert.deepEqual(result, WEEK_NOT_FOUND);
  assertNoWrite(r);
});

test("all three ownership denials return the IDENTICAL result value", async () => {
  const owners: Array<WeekOwnerRow | null> = [
    null,
    { id: WEEK_ID, courseOfferingId: null },
    { id: WEEK_ID, courseOfferingId: OTHER_OFFERING_ID },
  ];
  const results = [];
  for (const weekOwner of owners) {
    const r = makeDeps({ weekOwner });
    results.push(
      await commitOfferingWeeklyScheduleWithDeps(
        validInput({ weeklyScheduleId: WEEK_ID }),
        r.deps,
      ),
    );
  }
  for (const result of results) {
    assert.deepEqual(result, results[0]);
    assert.deepEqual(result, WEEK_NOT_FOUND);
  }
});

test("a non-string weeklyScheduleId is a failed re-import, never a silent create", async () => {
  for (const bad of [42, {}, true, ["x"]]) {
    const r = makeDeps();
    const result = await commitOfferingWeeklyScheduleWithDeps(
      validInput({ weeklyScheduleId: bad }),
      r.deps,
    );
    assert.deepEqual(result, WEEK_NOT_FOUND, `expected week_not_found for ${JSON.stringify(bad)}`);
    assert.deepEqual(r.fetchCalls, [], "an unusable id is never looked up");
    assertNoWrite(r);
  }
});

test("a padded week id is looked up verbatim and misses (no trimming)", async () => {
  const r = makeDeps({ weekOwner: null });
  const result = await commitOfferingWeeklyScheduleWithDeps(
    validInput({ weeklyScheduleId: ` ${WEEK_ID} ` }),
    r.deps,
  );
  assert.deepEqual(result, WEEK_NOT_FOUND);
  assert.deepEqual(r.fetchCalls, [` ${WEEK_ID} `]);
});

// ===========================================================================
// 5. Create - the offering id is always the SERVER-RESOLVED one
// ===========================================================================

test("create commit carries the server-resolved courseOfferingId", async () => {
  const r = makeDeps({ status: "PLANNED" });
  await commitOfferingWeeklyScheduleWithDeps(validInput(), r.deps);

  assert.equal(r.commitCalls.length, 1);
  const plan = r.commitCalls[0];
  assert.equal(plan.mode, "create");
  assert.ok(plan.mode === "create");
  assert.equal(plan.createData.courseOfferingId, OFFERING_ID);
  assert.notEqual(plan.createData.courseOfferingId, "");
  assert.deepEqual(Object.keys(plan.createData).sort(), [
    "courseOfferingId",
    "endDate",
    "name",
    "startDate",
    "uploadedFileName",
  ]);
});

test("create ignores a caller-supplied offering id in favour of the resolved one", async () => {
  // The fake resolver always returns OFFERING_ID regardless of what was asked
  // for - proving the create payload is built from the RESOLVED offering, not
  // from the raw input argument.
  const r = makeDeps({ status: "ACTIVE" });
  await commitOfferingWeeklyScheduleWithDeps(
    validInput({ courseOfferingId: OTHER_OFFERING_ID }),
    r.deps,
  );
  assert.deepEqual(r.resolveCalls, [OTHER_OFFERING_ID]);
  const plan = r.commitCalls[0];
  assert.ok(plan.mode === "create");
  assert.equal(plan.createData.courseOfferingId, OFFERING_ID);
});

test("an empty items array still creates the week, with zero counts", async () => {
  const r = makeDeps();
  const result = await commitOfferingWeeklyScheduleWithDeps(validInput({ items: [] }), r.deps);
  assert.deepEqual(result, {
    success: true,
    weeklyScheduleId: NEW_WEEK_ID,
    savedCount: 0,
    skippedCount: 0,
  });
  const plan = r.commitCalls[0];
  assert.ok(plan.mode === "create");
  assert.deepEqual(plan.items, []);
});

// ===========================================================================
// 6. Re-import - ownership is preserved, never rewritten
// ===========================================================================

test("re-import of an owned week commits an update payload with NO courseOfferingId key", async () => {
  const r = makeDeps({ weekOwner: { id: WEEK_ID, courseOfferingId: OFFERING_ID } });
  const result = await commitOfferingWeeklyScheduleWithDeps(
    validInput({ weeklyScheduleId: WEEK_ID, name: "שבוע מעודכן" }),
    r.deps,
  );

  assert.deepEqual(result, {
    success: true,
    weeklyScheduleId: WEEK_ID,
    savedCount: 2,
    skippedCount: 1,
  });
  assert.deepEqual(r.fetchCalls, [WEEK_ID]);

  const plan = r.commitCalls[0];
  assert.equal(plan.mode, "reimport");
  assert.ok(plan.mode === "reimport");
  assert.equal(plan.weeklyScheduleId, WEEK_ID);
  assert.equal("courseOfferingId" in plan.updateData, false);
  assert.deepEqual(Object.keys(plan.updateData).sort(), [
    "endDate",
    "name",
    "startDate",
    "uploadedFileName",
  ]);
  assert.equal("createData" in plan, false);
});

test("re-import writes the STORED week id, not the caller's string", async () => {
  // The stored row's id is canonical; the fake returns a different id than the
  // one requested to prove the plan targets the stored value.
  const r = makeDeps({ weekOwner: { id: "canonical-week-id", courseOfferingId: OFFERING_ID } });
  const result = await commitOfferingWeeklyScheduleWithDeps(
    validInput({ weeklyScheduleId: WEEK_ID }),
    r.deps,
  );
  assert.ok(result.success);
  assert.equal(result.weeklyScheduleId, "canonical-week-id");
  const plan = r.commitCalls[0];
  assert.ok(plan.mode === "reimport");
  assert.equal(plan.weeklyScheduleId, "canonical-week-id");
});

// ===========================================================================
// 7. Structural guarantees on every commit payload
// ===========================================================================

test("no isPublished value can enter any commit payload", async () => {
  const cases: Array<Partial<CommitOfferingWeekInput>> = [
    {},
    { weeklyScheduleId: WEEK_ID },
  ];
  for (const overrides of cases) {
    const r = makeDeps({ weekOwner: { id: WEEK_ID, courseOfferingId: OFFERING_ID } });
    // A hostile caller injecting extra fields must not reach the payload.
    const hostile = {
      ...validInput(overrides),
      isPublished: true,
      courseOfferingId: OFFERING_ID,
    } as CommitOfferingWeekInput;
    await commitOfferingWeeklyScheduleWithDeps(hostile, r.deps);

    const plan = r.commitCalls[0];
    const payload = plan.mode === "create" ? plan.createData : plan.updateData;
    assert.equal("isPublished" in payload, false);
    assert.equal(JSON.stringify(plan).includes("isPublished"), false);
    for (const item of plan.items) {
      assert.equal("isPublished" in item, false);
      assert.equal("courseOfferingId" in item, false);
      assert.equal("weeklyScheduleId" in item, false);
    }
  }
});

test("the dependency surface is exactly three members (no day-plan/duty/publish/enrollment writer)", async () => {
  const r = makeDeps();
  assert.deepEqual(Object.keys(r.deps).sort(), [
    "commit",
    "fetchWeekOwner",
    "resolveOffering",
  ]);
});

test("saved/skipped counts are preserved end to end on both paths", async () => {
  const items = [
    { dateKey: "2026-08-09", startTime: "08:00", endTime: "09:00", title: "a" },
    { dateKey: "2026-08-10", startTime: "08:00", endTime: "09:00", title: "b" },
    { dateKey: "2026-08-11", startTime: "08:00", endTime: "09:00", title: "c" },
    { dateKey: "bad", startTime: "", endTime: "", title: "d" },
    { dateKey: null, startTime: "", endTime: "", title: "e" },
  ];

  const created = makeDeps();
  const createResult = await commitOfferingWeeklyScheduleWithDeps(
    validInput({ items }),
    created.deps,
  );
  assert.deepEqual(createResult, {
    success: true,
    weeklyScheduleId: NEW_WEEK_ID,
    savedCount: 3,
    skippedCount: 2,
  });
  assert.equal(created.commitCalls[0].items.length, 3);

  const reimported = makeDeps({ weekOwner: { id: WEEK_ID, courseOfferingId: OFFERING_ID } });
  const reimportResult = await commitOfferingWeeklyScheduleWithDeps(
    validInput({ items, weeklyScheduleId: WEEK_ID }),
    reimported.deps,
  );
  assert.deepEqual(reimportResult, {
    success: true,
    weeklyScheduleId: WEEK_ID,
    savedCount: 3,
    skippedCount: 2,
  });
  assert.equal(reimported.commitCalls[0].items.length, 3);
});
