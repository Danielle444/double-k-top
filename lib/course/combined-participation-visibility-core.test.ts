/**
 * COMBINED PARTICIPATION - SLICE 2: DB-free tests for the pure trainee
 * schedule-item visibility core.
 *
 * No Prisma, no DB, no clock, no randomness - every dependency is a fake row
 * array or an injected function. Covers: the locked hide rule itself, dual
 * derivation from enrollment rows (including the anti-inflation cases -
 * inactive enrollment, non-ACTIVE offering, duplicate rows), the DI
 * orchestration's identity source and query shape (proving no client value can
 * influence the result and exactly one enrollment fetch is issued), and that
 * badge data survives the filter untouched.
 *
 * Run with: npx tsx --test lib/course/combined-participation-visibility-core.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  COMBINED_PARTICIPATION_HIDDEN_LEVEL,
  COMBINED_PARTICIPATION_PLACEHOLDER_DESCRIPTION,
  COMBINED_PARTICIPATION_PLACEHOLDER_TITLE,
  buildHiddenCombinedParticipationPlaceholders,
  filterTraineeScheduleItemsForCombinedParticipation,
  isTraineeDualEnrolledFromRows,
  resolveTraineeDualEnrollmentWithDeps,
  shouldHideCombinedParticipationItems,
} from "./combined-participation-visibility-core";
import type { TraineeEnrollmentOfferingRow } from "./actor-course-offering-core";
import type { CourseOfferingRow } from "./current-offering-core";
import { TRAINEE_COURSE_SELECTION_TAKE } from "./trainee-course-selection-core";

const L1 = "cmrqngqhn00017gcndjixzrh0";
const L2 = "cmrxk58vc0000lscnfm54bpze";

function offering(id: string, overrides: Partial<CourseOfferingRow> = {}): CourseOfferingRow {
  return {
    id,
    activityYearId: "year-1",
    name: "קורס",
    level: id === L2 ? 2 : 1,
    startDate: new Date("2026-07-05T00:00:00.000Z"),
    endDate: new Date("2026-07-31T00:00:00.000Z"),
    status: "ACTIVE",
    ...overrides,
  };
}

function enrollment(
  overrides: Partial<TraineeEnrollmentOfferingRow> = {},
): TraineeEnrollmentOfferingRow {
  return {
    enrollmentId: "enr-1",
    enrollmentStatus: "ACTIVE",
    offering: offering(L1),
    ...overrides,
  };
}

function dualRows(): TraineeEnrollmentOfferingRow[] {
  return [
    enrollment({ enrollmentId: "enr-l1", offering: offering(L1) }),
    enrollment({ enrollmentId: "enr-l2", offering: offering(L2) }),
  ];
}

interface FakeItem {
  id: string;
  combinedParticipation: boolean | null;
}

function item(id: string, combinedParticipation: boolean | null): FakeItem {
  return { id, combinedParticipation };
}

// ---------------------------------------------------------------------------
// isTraineeDualEnrolledFromRows - eligibility, dedup, anti-inflation
// ---------------------------------------------------------------------------

test("a Level-2-only trainee (single eligible offering) is NOT dual", () => {
  assert.equal(isTraineeDualEnrolledFromRows([enrollment({ offering: offering(L2) })], L2), false);
});

test("a Level-1-only trainee is NOT dual relative to L1", () => {
  assert.equal(isTraineeDualEnrolledFromRows([enrollment({ offering: offering(L1) })], L1), false);
});

test("an enrollment in both L1 and L2 IS dual relative to either selected offering", () => {
  assert.equal(isTraineeDualEnrolledFromRows(dualRows(), L2), true);
  assert.equal(isTraineeDualEnrolledFromRows(dualRows(), L1), true);
});

test("(6) an INACTIVE enrollment does not count toward dual status", () => {
  const rows = [
    enrollment({ enrollmentId: "enr-l1", offering: offering(L1) }),
    enrollment({ enrollmentId: "enr-l2", enrollmentStatus: "INACTIVE", offering: offering(L2) }),
  ];
  assert.equal(isTraineeDualEnrolledFromRows(rows, L2), false);
});

test("(7) a PLANNED offering does not count toward dual status", () => {
  const rows = [
    enrollment({ enrollmentId: "enr-l1", offering: offering(L1) }),
    enrollment({ enrollmentId: "enr-l2", offering: offering(L2, { status: "PLANNED" }) }),
  ];
  assert.equal(isTraineeDualEnrolledFromRows(rows, L2), false);
});

test("(7) an ARCHIVED offering does not count toward dual status", () => {
  const rows = [
    enrollment({ enrollmentId: "enr-l1", offering: offering(L1) }),
    enrollment({ enrollmentId: "enr-l2", offering: offering(L2, { status: "ARCHIVED" }) }),
  ];
  assert.equal(isTraineeDualEnrolledFromRows(rows, L2), false);
});

test("(8) duplicate ACTIVE rows into the SAME offering do not inflate dual status", () => {
  const rows = [
    enrollment({ enrollmentId: "enr-l1-a", offering: offering(L1) }),
    enrollment({ enrollmentId: "enr-l1-b", offering: offering(L1) }),
  ];
  // Two rows, one distinct offering, which equals the selected offering -> not dual.
  assert.equal(isTraineeDualEnrolledFromRows(rows, L1), false);
});

test("a blank selected offering id is never dual (defensive, never widens)", () => {
  assert.equal(isTraineeDualEnrolledFromRows(dualRows(), ""), false);
});

// ---------------------------------------------------------------------------
// shouldHideCombinedParticipationItems - the locked rule's applicability gate
// ---------------------------------------------------------------------------

test("the hide rule applies ONLY for dual + Level 2 selected", () => {
  assert.equal(
    shouldHideCombinedParticipationItems({ offeringLevel: COMBINED_PARTICIPATION_HIDDEN_LEVEL, isDualEnrolled: true }),
    true,
  );
  assert.equal(
    shouldHideCombinedParticipationItems({ offeringLevel: COMBINED_PARTICIPATION_HIDDEN_LEVEL, isDualEnrolled: false }),
    false,
    "Level-2-only (not dual) is exempt",
  );
  assert.equal(
    shouldHideCombinedParticipationItems({ offeringLevel: 1, isDualEnrolled: true }),
    false,
    "(5) Level 1 selected is exempt even for a dual trainee",
  );
  assert.equal(
    shouldHideCombinedParticipationItems({ offeringLevel: 1, isDualEnrolled: false }),
    false,
  );
});

// ---------------------------------------------------------------------------
// filterTraineeScheduleItemsForCombinedParticipation - the locked rule itself
// ---------------------------------------------------------------------------

test("(1) dual + L2 + false -> hidden", () => {
  const items = [item("a", false), item("b", true), item("c", null)];
  const result = filterTraineeScheduleItemsForCombinedParticipation(items, {
    offeringLevel: 2,
    isDualEnrolled: true,
  });
  assert.deepEqual(result.map((i) => i.id), ["b", "c"]);
});

test("(2) dual + L2 + true -> shown", () => {
  const items = [item("a", true)];
  const result = filterTraineeScheduleItemsForCombinedParticipation(items, {
    offeringLevel: 2,
    isDualEnrolled: true,
  });
  assert.deepEqual(result, items);
});

test("(3) dual + L2 + null -> shown", () => {
  const items = [item("a", null)];
  const result = filterTraineeScheduleItemsForCombinedParticipation(items, {
    offeringLevel: 2,
    isDualEnrolled: true,
  });
  assert.deepEqual(result, items);
});

test("(4) Level-2-only (not dual) + false -> shown (rule never applies)", () => {
  const items = [item("a", false), item("b", true), item("c", null)];
  const result = filterTraineeScheduleItemsForCombinedParticipation(items, {
    offeringLevel: 2,
    isDualEnrolled: false,
  });
  assert.deepEqual(result, items);
});

test("(5) Level 1 selected + false -> shown, list identical to input (unchanged behaviour)", () => {
  const items = [item("a", false), item("b", true), item("c", null)];
  const result = filterTraineeScheduleItemsForCombinedParticipation(items, {
    offeringLevel: 1,
    isDualEnrolled: true,
  });
  assert.deepEqual(result, items);
});

test("(12) surviving items keep their combinedParticipation value verbatim (badge data untouched)", () => {
  const items = [item("a", true), item("b", null)];
  const result = filterTraineeScheduleItemsForCombinedParticipation(items, {
    offeringLevel: 2,
    isDualEnrolled: true,
  });
  assert.deepEqual(result, items);
  // Reference equality per surviving item - the filter never rebuilds/mutates.
  assert.equal(result[0], items[0]);
  assert.equal(result[1], items[1]);
});

test("the filter never mutates the input array", () => {
  const items = [item("a", false), item("b", true)];
  const snapshot = [...items];
  filterTraineeScheduleItemsForCombinedParticipation(items, { offeringLevel: 2, isDualEnrolled: true });
  assert.deepEqual(items, snapshot);
});

// ---------------------------------------------------------------------------
// resolveTraineeDualEnrollmentWithDeps - identity source + query shape (DI)
// ---------------------------------------------------------------------------

test("(9) the trainee id comes ONLY from the injected session dependency - no parameter accepts one", () => {
  let requireTraineeIdCalls = 0;
  const deps = {
    requireTraineeId: async () => {
      requireTraineeIdCalls++;
      return "session-trainee";
    },
    fetchTraineeEnrollmentRows: async () => dualRows(),
  };
  // The function signature itself has no room for a client-supplied identity or
  // dual flag - only a selected offering id and the deps.
  return resolveTraineeDualEnrollmentWithDeps(L2, deps).then((isDual) => {
    assert.equal(isDual, true);
    assert.equal(requireTraineeIdCalls, 1, "identity resolved exactly once");
  });
});

test("(10) exactly ONE enrollment fetch is issued per call - no N+1", () => {
  let fetchCalls = 0;
  const deps = {
    requireTraineeId: async () => "session-trainee",
    fetchTraineeEnrollmentRows: async () => {
      fetchCalls++;
      return dualRows();
    },
  };
  return resolveTraineeDualEnrollmentWithDeps(L2, deps).then(() => {
    assert.equal(fetchCalls, 1);
  });
});

test("the enrollment query is scoped to the session trainee, ACTIVE status, ACTIVE offering - same shape as course selection", () => {
  let capturedQuery: unknown = null;
  const deps = {
    requireTraineeId: async () => "session-trainee",
    fetchTraineeEnrollmentRows: async (query: unknown) => {
      capturedQuery = query;
      return dualRows();
    },
  };
  return resolveTraineeDualEnrollmentWithDeps(L2, deps).then(() => {
    assert.deepEqual(capturedQuery, {
      take: TRAINEE_COURSE_SELECTION_TAKE,
      where: {
        studentId: "session-trainee",
        status: "ACTIVE",
        courseOffering: { status: "ACTIVE" },
      },
    });
  });
});

test("the selected offering id never reaches the enrollment query", () => {
  let capturedQuery: unknown = null;
  const deps = {
    requireTraineeId: async () => "session-trainee",
    fetchTraineeEnrollmentRows: async (query: unknown) => {
      capturedQuery = query;
      return dualRows();
    },
  };
  return resolveTraineeDualEnrollmentWithDeps(L2, deps).then(() => {
    assert.ok(!JSON.stringify(capturedQuery).includes(L2), "the offering id must not appear in the query");
  });
});

// ---------------------------------------------------------------------------
// SLICE 2.1 - buildHiddenCombinedParticipationPlaceholders
// ---------------------------------------------------------------------------

interface FakeScheduleRow {
  id: string;
  date: Date;
  startTime: string;
  endTime: string;
  groupName: string | null;
  combinedParticipation: boolean | null;
}

function row(overrides: Partial<FakeScheduleRow> = {}): FakeScheduleRow {
  return {
    id: "item-1",
    date: new Date("2026-07-05T00:00:00.000Z"),
    startTime: "09:00",
    endTime: "10:00",
    groupName: null,
    combinedParticipation: false,
    ...overrides,
  };
}

test("the fixed placeholder wording matches the required product copy exactly", () => {
  assert.equal(COMBINED_PARTICIPATION_PLACEHOLDER_TITLE, "זמן עם לו״ז רמה 1");
  assert.equal(COMBINED_PARTICIPATION_PLACEHOLDER_DESCRIPTION, "יש לעבור ללוח רמה 1 לפרטים");
});

test("(SLICE 2.1 - 1) dual + L2 + hidden item -> exactly one placeholder with the fixed neutral wording", () => {
  const items = [row({ id: "a" })];
  const placeholders = buildHiddenCombinedParticipationPlaceholders(items, {
    offeringLevel: COMBINED_PARTICIPATION_HIDDEN_LEVEL,
    isDualEnrolled: true,
  });
  assert.equal(placeholders.length, 1);
  assert.equal(placeholders[0].title, COMBINED_PARTICIPATION_PLACEHOLDER_TITLE);
  assert.equal(placeholders[0].description, COMBINED_PARTICIPATION_PLACEHOLDER_DESCRIPTION);
  assert.equal(placeholders[0].startTime, "09:00");
  assert.equal(placeholders[0].endTime, "10:00");
});

test("(SLICE 2.1 - 2) dual + L2 + true/null -> no placeholders (item is shown for real, never replaced)", () => {
  const items = [row({ id: "a", combinedParticipation: true }), row({ id: "b", combinedParticipation: null })];
  const placeholders = buildHiddenCombinedParticipationPlaceholders(items, {
    offeringLevel: COMBINED_PARTICIPATION_HIDDEN_LEVEL,
    isDualEnrolled: true,
  });
  assert.deepEqual(placeholders, []);
});

test("(SLICE 2.1 - 3) Level-2-only (not dual) -> no placeholders even when combinedParticipation is false", () => {
  const items = [row({ combinedParticipation: false })];
  const placeholders = buildHiddenCombinedParticipationPlaceholders(items, {
    offeringLevel: COMBINED_PARTICIPATION_HIDDEN_LEVEL,
    isDualEnrolled: false,
  });
  assert.deepEqual(placeholders, []);
});

test("(SLICE 2.1 - 4) Level 1 selected -> no placeholders", () => {
  const items = [row({ combinedParticipation: false })];
  const placeholders = buildHiddenCombinedParticipationPlaceholders(items, {
    offeringLevel: 1,
    isDualEnrolled: true,
  });
  assert.deepEqual(placeholders, []);
});

test("(SLICE 2.1 - 5) touching hidden items in the same day+group collapse into one placeholder spanning the full range", () => {
  const items = [
    row({ id: "a", startTime: "09:00", endTime: "10:00" }),
    row({ id: "b", startTime: "10:00", endTime: "11:00" }),
  ];
  const placeholders = buildHiddenCombinedParticipationPlaceholders(items, {
    offeringLevel: 2,
    isDualEnrolled: true,
  });
  assert.equal(placeholders.length, 1);
  assert.equal(placeholders[0].startTime, "09:00");
  assert.equal(placeholders[0].endTime, "11:00");
});

test("(SLICE 2.1 - 6) overlapping hidden items collapse to the union of their ranges", () => {
  const items = [
    row({ id: "a", startTime: "09:00", endTime: "10:30" }),
    row({ id: "b", startTime: "10:00", endTime: "11:00" }),
  ];
  const placeholders = buildHiddenCombinedParticipationPlaceholders(items, {
    offeringLevel: 2,
    isDualEnrolled: true,
  });
  assert.equal(placeholders.length, 1);
  assert.equal(placeholders[0].startTime, "09:00");
  assert.equal(placeholders[0].endTime, "11:00");
});

test("(SLICE 2.1 - 7) a real time gap between hidden items produces two separate placeholders", () => {
  const items = [
    row({ id: "a", startTime: "09:00", endTime: "10:00" }),
    row({ id: "b", startTime: "12:00", endTime: "13:00" }),
  ];
  const placeholders = buildHiddenCombinedParticipationPlaceholders(items, {
    offeringLevel: 2,
    isDualEnrolled: true,
  });
  assert.equal(placeholders.length, 2);
});

test("(SLICE 2.1 - 8) same-time hidden items from DIFFERENT groups collapse into ONE placeholder, never one per group", () => {
  const items = [
    row({ id: "a", groupName: "א", startTime: "09:00", endTime: "10:00" }),
    row({ id: "b", groupName: "ב", startTime: "09:00", endTime: "10:00" }),
  ];
  const placeholders = buildHiddenCombinedParticipationPlaceholders(items, {
    offeringLevel: 2,
    isDualEnrolled: true,
  });
  assert.equal(placeholders.length, 1, "one merged placeholder, not one per source group");
  assert.equal(placeholders[0].startTime, "09:00");
  assert.equal(placeholders[0].endTime, "10:00");
});

test("(SLICE 2.1 - 8b) overlapping/touching hidden items across three different groups still collapse into ONE placeholder spanning the union", () => {
  const items = [
    row({ id: "a", groupName: "א", startTime: "09:00", endTime: "10:00" }),
    row({ id: "b", groupName: "ב", startTime: "10:00", endTime: "11:00" }),
    row({ id: "c", groupName: null, startTime: "09:30", endTime: "10:30" }),
  ];
  const placeholders = buildHiddenCombinedParticipationPlaceholders(items, {
    offeringLevel: 2,
    isDualEnrolled: true,
  });
  assert.equal(placeholders.length, 1);
  assert.equal(placeholders[0].startTime, "09:00");
  assert.equal(placeholders[0].endTime, "11:00");
});

test("(SLICE 2.1 - 8c) a genuine time gap keeps hidden items separate even when their groups differ", () => {
  const items = [
    row({ id: "a", groupName: "א", startTime: "09:00", endTime: "10:00" }),
    row({ id: "b", groupName: "ב", startTime: "12:00", endTime: "13:00" }),
  ];
  const placeholders = buildHiddenCombinedParticipationPlaceholders(items, {
    offeringLevel: 2,
    isDualEnrolled: true,
  });
  assert.equal(placeholders.length, 2, "a real time gap still separates placeholders, regardless of group");
});

test("(SLICE 2.1 - 8d) no hidden groupName reaches the client - a placeholder carries no groupName property at all", () => {
  const items = [row({ id: "a", groupName: "א" }), row({ id: "b", groupName: "ב", startTime: "09:00", endTime: "10:00" })];
  const placeholders = buildHiddenCombinedParticipationPlaceholders(items, {
    offeringLevel: 2,
    isDualEnrolled: true,
  });
  assert.equal(placeholders.length, 1);
  assert.ok(!("groupName" in placeholders[0]), "a placeholder must not expose a groupName field at all");
});

test("(SLICE 2.1 - 9) different days never merge into one placeholder", () => {
  const items = [
    row({ id: "a", date: new Date("2026-07-05T00:00:00.000Z") }),
    row({ id: "b", date: new Date("2026-07-06T00:00:00.000Z") }),
  ];
  const placeholders = buildHiddenCombinedParticipationPlaceholders(items, {
    offeringLevel: 2,
    isDualEnrolled: true,
  });
  assert.equal(placeholders.length, 2);
});

test("(SLICE 2.1 - 10) a placeholder exposes only the safe field set - no room for a hidden item's group, title, description, location, instructor, notes, horse or participant data", () => {
  const items = [row({ id: "secret-session-id", groupName: "א" })];
  const placeholders = buildHiddenCombinedParticipationPlaceholders(items, {
    offeringLevel: 2,
    isDualEnrolled: true,
  });
  assert.deepEqual(
    Object.keys(placeholders[0]).sort(),
    ["dateKey", "dateLabel", "dayLabel", "description", "endTime", "id", "startTime", "title"].sort(),
  );
});

test("(SLICE 2.1 - 11) a placeholder's id is built only from source ids, never from any content field", () => {
  const items = [row({ id: "row-a" }), row({ id: "row-b", startTime: "10:00", endTime: "11:00" })];
  const placeholders = buildHiddenCombinedParticipationPlaceholders(items, {
    offeringLevel: 2,
    isDualEnrolled: true,
  });
  assert.equal(placeholders.length, 1);
  assert.equal(placeholders[0].id, "combined-participation-placeholder:row-a+row-b");
});
