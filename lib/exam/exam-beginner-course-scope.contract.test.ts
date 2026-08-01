/**
 * EXAM EX-BEGINNER-EXAM-READ — the END-TO-END contract of the Level-1 beginner
 * containment rule.
 *
 * It drives the REAL pure loader and the REAL role readers over an in-memory
 * Teaching-Practice fixture, so what is asserted is what the shipped read
 * pipeline does, not what a mock was told to say. Only the IO seam is faked.
 *
 * THE PRODUCT RULE UNDER TEST:
 *
 *     Beginner teaching-practice exams exist ONLY for Level 1. A Level-2 exam
 *     plan returns NO beginner entries, whatever source dates it holds.
 *
 * WHAT IS DELIBERATELY *NOT* ASSERTED AS A CHANGE: the beginner detail contract
 * itself. Admin, instructor and trainee keep the SAME committed DTO with the
 * SAME fields, including the child's full name, parent name and parent phone.
 * That is the locked product decision, and the tests below PIN it so a future
 * edit cannot quietly narrow it in the name of this slice.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  loadExamPlan,
  type ExamPlanLoadDeps,
  type ExamPlanLoadOptions,
  type ExamPlanPayload,
} from "./exam-plan-loader-core";
import {
  adminExamPlanLoadOptions,
  instructorExamPlanLoadOptions,
  readAdminExamPlanWithDeps,
  readInstructorExamPlanWithDeps,
  readTraineeExamDayWithDeps,
  traineeExamPlanLoadOptions,
  type AdminExamReadDeps,
  type InstructorExamReadDeps,
  type TraineeExamReadDeps,
} from "./exam-read-scope-core";
import { BEGINNER_SOURCE_COURSE_LEVEL } from "./exam-beginner-course-scope-core";
import type { TeachingPracticeExamLessonRow } from "./exam-tp-source-adapter-core";
import type { StoredExamDefinitionRow, StoredExamSessionRow } from "./exam-stored-adapter-core";

// ===========================================================================
// Fixture
// ===========================================================================

const L1_OFFERING = "off-level-1";
const L2_OFFERING = "off-level-2";
const PLAN_L1 = "plan-l1";
const PLAN_L2 = "plan-l2";
const PUBLISHED_AT = 1_760_000_000_000;

/** The plan's ONE configured source date. */
const SOURCE_DATE = "2026-08-11";
/** A real Teaching-Practice date the plan did NOT configure. */
const UNRELATED_DATE = "2026-08-12";

const TEACHER = "stu-teacher";
const ASSISTANT = "stu-assistant";

function lesson(over: Partial<TeachingPracticeExamLessonRow> = {}): TeachingPracticeExamLessonRow {
  return {
    id: "les-1",
    practiceType: "BEGINNER_GROUP",
    date: SOURCE_DATE,
    startTime: "16:00",
    endTime: "17:00",
    createdAt: "2026-07-01T09:00:00.000Z",
    groupName: "קבוצה א",
    location: "אולם",
    notes: "הערת שיעור",
    isPublished: true,
    roleLabelOverrides: null,
    responsibleInstructorId: "ins-1",
    responsibleInstructorName: "מדריכה אחראית",
    participants: [
      {
        id: "par-1",
        traineeId: TEACHER,
        traineeName: "חניכה מלמדת",
        role: "LEAD_INSTRUCTOR",
        isManualOverride: false,
        createdAt: "2026-07-01T09:00:00.000Z",
      },
      {
        id: "par-2",
        traineeId: ASSISTANT,
        traineeName: "חניכה עוזרת",
        role: "ASSISTANT_INSTRUCTOR",
        isManualOverride: false,
        createdAt: "2026-07-01T09:01:00.000Z",
      },
    ],
    childAssignments: [
      {
        id: "cha-1",
        childId: "child-1",
        childName: "ילד א",
        childAge: 9,
        childGender: "M",
        childNotes: "הערת ילד",
        parentName: "הורה א",
        parentPhone: "050-0000000",
        horseName: "סוסון",
        equipmentNotes: "אוכף קטן",
        isAbsent: false,
      },
    ],
    ...over,
  };
}

/** Every Teaching-Practice lesson that EXISTS, across both dates. */
function allLessons(): TeachingPracticeExamLessonRow[] {
  return [
    lesson(),
    lesson({ id: "les-unrelated", date: UNRELATED_DATE, startTime: "18:00", endTime: "19:00" }),
  ];
}

const DEFINITION: StoredExamDefinitionRow = {
  id: "def-1",
  name: "מבחן רכיבה",
  kind: "INTERFACE_RIDING",
  durationMinutes: 20,
  parallelCapacity: 1,
  requiresInstructedTrainee: false,
  requiresLessonTopic: false,
  requiresDiscipline: false,
  orderIndex: 0,
};

const STORED_SESSION: StoredExamSessionRow = {
  id: "ses-1",
  definitionId: DEFINITION.id,
  date: SOURCE_DATE,
  startTime: "09:00",
  endTime: null,
  orderIndex: 0,
  arena: "מגרש",
  title: null,
  notes: null,
  individualPublishedAt: null,
  updatedAt: PUBLISHED_AT,
  assignments: [],
  breaks: [],
  supervisorInstructorIds: [],
};

interface Counts {
  plan: number;
  definitions: number;
  sessions: number;
  sourceDates: number;
  lessons: number;
  lessonDateArgs: string[][];
}

function makeCounts(): Counts {
  return { plan: 0, definitions: 0, sessions: 0, sourceDates: 0, lessons: 0, lessonDateArgs: [] };
}

/**
 * The IO seam, backed by the in-memory fixture.
 *
 * `sourceDates` is what the PLAN configured; `lessons` is every Teaching-Practice
 * lesson that exists. The fake performs the same `date IN (...)` filter the real
 * query does, so "only configured dates match" is proven against real filtering
 * rather than against a fixture that was handed the answer.
 */
function ioDeps(
  counts: Counts,
  over: {
    readonly planId?: string;
    readonly sourceDates?: readonly string[];
    readonly lessons?: readonly TeachingPracticeExamLessonRow[];
    readonly publishedAt?: number | null;
  } = {},
): ExamPlanLoadDeps {
  const lessons = over.lessons ?? allLessons();
  return {
    async fetchPlanByCourseOfferingId(courseOfferingId) {
      counts.plan += 1;
      return {
        id: over.planId ?? (courseOfferingId === L2_OFFERING ? PLAN_L2 : PLAN_L1),
        publishedAt: over.publishedAt === undefined ? PUBLISHED_AT : over.publishedAt,
        updatedAt: PUBLISHED_AT,
      };
    },
    async fetchDefinitionsByPlanId() {
      counts.definitions += 1;
      return [DEFINITION];
    },
    async fetchSessionsByPlanId() {
      counts.sessions += 1;
      return [STORED_SESSION];
    },
    async fetchSourceDatesByPlanId() {
      counts.sourceDates += 1;
      return (over.sourceDates ?? [SOURCE_DATE]).map((date) => ({ date }));
    },
    async fetchTeachingPracticeLessonsByDates(dates) {
      counts.lessons += 1;
      counts.lessonDateArgs.push([...dates]);
      return lessons.filter((row) => dates.includes(row.date));
    },
  };
}

function load(
  courseOfferingId: string,
  options: ExamPlanLoadOptions,
  counts: Counts,
  over: Parameters<typeof ioDeps>[1] = {},
): Promise<ExamPlanPayload> {
  return loadExamPlan({ courseOfferingId, options }, ioDeps(counts, over));
}

const NAMES = new Map<string, string>([
  [TEACHER, "חניכה מלמדת"],
  [ASSISTANT, "חניכה עוזרת"],
]);

function adminDeps(counts: Counts, level: number, offeringId: string): AdminExamReadDeps {
  return {
    requireAdminCourseOffering: async () => ({ id: offeringId, level }),
    loadPlan: (input) => loadExamPlan(input, ioDeps(counts)),
    fetchStudentDisplayNames: async () => NAMES,
    fetchInstructorDisplayNames: async () => new Map([["ins-1", "מדריכה אחראית"]]),
  };
}

function instructorDeps(counts: Counts, level: number, offeringId: string): InstructorExamReadDeps {
  return {
    requireInstructorId: async () => "ins-self",
    resolveInstructorCourseOffering: async () => ({ id: offeringId, level }),
    isCourseContextDenial: () => false,
    loadPlan: (input) => loadExamPlan(input, ioDeps(counts)),
    fetchStudentDisplayNames: async () => NAMES,
    fetchInstructorDisplayNames: async () => new Map([["ins-1", "מדריכה אחראית"]]),
  };
}

function traineeDeps(counts: Counts, level: number, offeringId: string): TraineeExamReadDeps {
  return {
    requireTraineeId: async () => TEACHER,
    resolveTraineeCourseOffering: async () => ({ id: offeringId, level }),
    isCourseContextDenial: () => false,
    loadPlan: (input) => loadExamPlan(input, ioDeps(counts)),
    fetchStudentDisplayNames: async () => NAMES,
  };
}

const BEGINNER_SESSION_ID = "tp:les-1";

// ===========================================================================
// A. Level 1 receives the matching beginner entries
// ===========================================================================

test("A1. a LEVEL 1 plan projects the Teaching-Practice lesson as a beginner row", async () => {
  const counts = makeCounts();
  const payload = await load(L1_OFFERING, adminExamPlanLoadOptions(1), counts);

  const beginner = payload.sessions.filter((s) => s.kind === "BEGINNER_INSTRUCTION");
  assert.equal(beginner.length, 1);
  assert.equal(beginner[0].sessionId, BEGINNER_SESSION_ID);
  assert.equal(beginner[0].date, SOURCE_DATE);
  assert.equal(beginner[0].startTime, "16:00");
  assert.equal(beginner[0].endTime, "17:00");
  assert.equal(beginner[0].beginnerFormat, "BEGINNER_GROUP");
  assert.equal(payload.beginnerDetails.has(BEGINNER_SESSION_ID), true);
});

test("A2. the group/private FORMAT comes from the live practice type, not a guess", async () => {
  for (const [practiceType, format] of [
    ["BEGINNER_GROUP", "BEGINNER_GROUP"],
    ["BEGINNER_PRIVATE", "BEGINNER_PRIVATE"],
    ["LUNGE", "LUNGE"],
  ] as const) {
    const counts = makeCounts();
    const payload = await load(L1_OFFERING, adminExamPlanLoadOptions(1), counts, {
      lessons: [lesson({ practiceType })],
    });
    const row = payload.sessions.find((s) => s.kind === "BEGINNER_INSTRUCTION");
    assert.equal(row?.beginnerFormat, format);
  }
});

test("A3. teacher and assistant both reach the detail, each keeping its SOURCE role", async () => {
  const counts = makeCounts();
  const payload = await load(L1_OFFERING, adminExamPlanLoadOptions(1), counts);
  const detail = payload.beginnerDetails.get(BEGINNER_SESSION_ID);

  assert.equal(detail?.participants.length, 2);
  assert.deepEqual(
    detail?.participants.map((p) => [p.traineeId, p.sourcePracticeRole]),
    [
      [TEACHER, "LEAD_INSTRUCTOR"],
      [ASSISTANT, "ASSISTANT_INSTRUCTOR"],
    ],
  );
});

test("A4. horse and place travel with the row", async () => {
  const counts = makeCounts();
  const payload = await load(L1_OFFERING, adminExamPlanLoadOptions(1), counts);
  const detail = payload.beginnerDetails.get(BEGINNER_SESSION_ID);

  assert.equal(detail?.location, "אולם");
  assert.equal(detail?.groupName, "קבוצה א");
  assert.equal(detail?.children[0]?.horseName, "סוסון");
});

test("A5. a Teaching-Practice EDIT appears on the next read — TP stays the source of truth", async () => {
  const before = await load(L1_OFFERING, adminExamPlanLoadOptions(1), makeCounts());
  assert.equal(before.beginnerDetails.get(BEGINNER_SESSION_ID)?.location, "אולם");

  // The SAME lesson id, edited in Teaching Practice. Nothing is copied,
  // invalidated or resynchronised: the next read simply reads again.
  const after = await load(L1_OFFERING, adminExamPlanLoadOptions(1), makeCounts(), {
    lessons: [lesson({ location: "מגרש חול", startTime: "16:30", endTime: "17:30" })],
  });
  const detail = after.beginnerDetails.get(BEGINNER_SESSION_ID);
  assert.equal(detail?.location, "מגרש חול");
  assert.equal(detail?.startTime, "16:30");
  assert.equal(detail?.endTime, "17:30");
});

// ===========================================================================
// B. Level 2 ALWAYS receives no beginner entries
// ===========================================================================

test("B1. a LEVEL 2 plan projects NO beginner row", async () => {
  const counts = makeCounts();
  const payload = await load(L2_OFFERING, adminExamPlanLoadOptions(2), counts);

  assert.deepEqual(payload.sessions.filter((s) => s.kind === "BEGINNER_INSTRUCTION"), []);
  assert.deepEqual([...payload.beginnerDetails.keys()], []);
  assert.deepEqual([...payload.sourceDates], []);
});

test("B2. a LEVEL 2 plan reads NO Teaching-Practice row AT ALL — not even to discard it", async () => {
  const counts = makeCounts();
  await load(L2_OFFERING, adminExamPlanLoadOptions(2), counts);

  // The strong form of the containment: the source-date query is not issued, so
  // the lesson query cannot be issued either. Nothing is fetched-then-stripped.
  assert.equal(counts.sourceDates, 0, "a Level 2 plan must not read its source dates");
  assert.equal(counts.lessons, 0, "a Level 2 plan must not read a Teaching-Practice lesson");
  assert.deepEqual(counts.lessonDateArgs, []);
});

test("B3. a LEVEL 2 plan that HAS configured source dates still returns nothing", async () => {
  const counts = makeCounts();
  const payload = await load(L2_OFFERING, adminExamPlanLoadOptions(2), counts, {
    planId: PLAN_L2,
    sourceDates: [SOURCE_DATE, UNRELATED_DATE],
  });

  assert.deepEqual([...payload.beginnerDetails.keys()], []);
  assert.equal(counts.lessons, 0);
});

test("B4. a Level 2 plan STILL loads its own stored exam blocks — only beginner is gated", async () => {
  const counts = makeCounts();
  const payload = await load(L2_OFFERING, adminExamPlanLoadOptions(2), counts);

  assert.equal(counts.definitions, 1);
  assert.equal(counts.sessions, 1);
  assert.equal(payload.sessions.length, 1);
  assert.equal(payload.sessions[0].sessionId, STORED_SESSION.id);
});

test("B5. EVERY non-Level-1 level, and an unstatable one, reads no beginner row", async () => {
  for (const level of [0, 2, 3, 9, -1, Number.NaN, undefined, null, "1"]) {
    const counts = makeCounts();
    const payload = await load(L2_OFFERING, adminExamPlanLoadOptions(level), counts);
    assert.deepEqual(
      [...payload.beginnerDetails.keys()],
      [],
      `level ${String(level)} must read no beginner row`,
    );
    assert.equal(counts.lessons, 0, `level ${String(level)} must issue no lesson query`);
  }
});

test("B6. a MALFORMED options object reads no beginner row — the gate fails closed", async () => {
  const counts = makeCounts();
  const payload = await load(L1_OFFERING, {} as ExamPlanLoadOptions, counts);
  assert.deepEqual([...payload.beginnerDetails.keys()], []);
  assert.equal(counts.lessons, 0);
});

// ===========================================================================
// C. Date scoping — the plan's CONFIGURED dates, and nothing else
// ===========================================================================

test("C1. only the plan's CONFIGURED source dates are queried", async () => {
  const counts = makeCounts();
  await load(L1_OFFERING, adminExamPlanLoadOptions(1), counts);
  assert.deepEqual(counts.lessonDateArgs, [[SOURCE_DATE]]);
});

test("C2. a real lesson on an UNCONFIGURED date is never projected", async () => {
  const counts = makeCounts();
  const payload = await load(L1_OFFERING, adminExamPlanLoadOptions(1), counts);

  const ids = [...payload.beginnerDetails.keys()];
  assert.deepEqual(ids, [BEGINNER_SESSION_ID]);
  assert.equal(ids.includes("tp:les-unrelated"), false);
  assert.equal(
    payload.sessions.some((s) => s.date === UNRELATED_DATE),
    false,
    "an unconfigured date must contribute no row",
  );
});

test("C3. configuring the second date brings ONLY that date's lesson in as well", async () => {
  const counts = makeCounts();
  const payload = await load(L1_OFFERING, adminExamPlanLoadOptions(1), counts, {
    sourceDates: [SOURCE_DATE, UNRELATED_DATE],
  });
  assert.deepEqual([...payload.beginnerDetails.keys()].sort(), [
    BEGINNER_SESSION_ID,
    "tp:les-unrelated",
  ]);
});

test("C4. a plan with NO configured date issues no lesson query and projects nothing", async () => {
  const counts = makeCounts();
  const payload = await load(L1_OFFERING, adminExamPlanLoadOptions(1), counts, { sourceDates: [] });

  assert.equal(counts.sourceDates, 1, "a Level 1 plan still ASKS which dates it configured");
  assert.equal(counts.lessons, 0, "but an empty answer queries no lesson");
  assert.deepEqual([...payload.beginnerDetails.keys()], []);
});

test("C5. EMPTY Teaching-Practice data on a configured date is an ordinary empty read", async () => {
  const counts = makeCounts();
  const payload = await load(L1_OFFERING, adminExamPlanLoadOptions(1), counts, { lessons: [] });

  assert.equal(counts.lessons, 1);
  assert.deepEqual([...payload.beginnerDetails.keys()], []);
  assert.deepEqual(payload.diagnostics.beginnerRejections, []);
});

test("C6. a malformed lesson FAILS SAFE: it is rejected and reported, the good row survives", async () => {
  const counts = makeCounts();
  const payload = await load(L1_OFFERING, adminExamPlanLoadOptions(1), counts, {
    lessons: [lesson(), lesson({ id: "les-bad", practiceType: "NOT_A_TYPE" })],
  });

  // The good row survives; the malformed one is held back by the SOURCE adapter
  // (which is where an unsupported practice type is caught) and stays observable
  // as a non-PII diagnostic rather than being silently defaulted to a format.
  assert.deepEqual([...payload.beginnerDetails.keys()], [BEGINNER_SESSION_ID]);
  const issues = payload.diagnostics.teachingPracticeSourceIssues.filter(
    (issue) => issue.lessonId === "les-bad",
  );
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, "EX-TP-ADP-PRACTICE-TYPE-UNSUPPORTED");
});

test("C7. a lesson with a MISSING id is rejected without poisoning the good row", async () => {
  const counts = makeCounts();
  const payload = await load(L1_OFFERING, adminExamPlanLoadOptions(1), counts, {
    lessons: [lesson(), lesson({ id: "   " })],
  });

  assert.deepEqual([...payload.beginnerDetails.keys()], [BEGINNER_SESSION_ID]);
  assert.equal(
    payload.diagnostics.teachingPracticeSourceIssues.some(
      (issue) => issue.code === "EX-TP-ADP-LESSON-ID-REQUIRED",
    ),
    true,
  );
});

// ===========================================================================
// D. Cross-course containment
// ===========================================================================

test("D1. two plans sharing ONE source date cannot both read it — only Level 1 can", async () => {
  const l1Counts = makeCounts();
  const l2Counts = makeCounts();

  // The exact overlap the schema cannot prevent: both plans configured the SAME
  // Teaching-Practice date.
  const shared = { sourceDates: [SOURCE_DATE] };
  const l1 = await load(L1_OFFERING, adminExamPlanLoadOptions(1), l1Counts, shared);
  const l2 = await load(L2_OFFERING, adminExamPlanLoadOptions(2), l2Counts, shared);

  assert.deepEqual([...l1.beginnerDetails.keys()], [BEGINNER_SESSION_ID]);
  assert.deepEqual([...l2.beginnerDetails.keys()], []);
  // The Level-2 read never touched the lesson table, so no trainee, child or
  // parent contact of the Level-1 course was loaded under the Level-2 plan.
  assert.equal(l2Counts.lessons, 0);
});

test("D2. the LEVEL decides, never the offering id or the plan id", async () => {
  // The SAME offering id read at two levels: only the level changes the outcome.
  const asL1 = await load(L2_OFFERING, adminExamPlanLoadOptions(1), makeCounts());
  const asL2 = await load(L2_OFFERING, adminExamPlanLoadOptions(2), makeCounts());

  assert.equal(asL1.beginnerDetails.size, 1);
  assert.equal(asL2.beginnerDetails.size, 0);
});

// ===========================================================================
// E. The three role readers
// ===========================================================================

test("E1. ADMIN: Level 1 receives the committed beginner detail DTO, unchanged", async () => {
  const counts = makeCounts();
  const dto = await readAdminExamPlanWithDeps(L1_OFFERING, adminDeps(counts, 1, L1_OFFERING));

  const row = dto.rows.find((r) => r.source === "BEGINNER");
  assert.ok(row, "the admin must see the beginner row");
  assert.equal(row.sessionId, BEGINNER_SESSION_ID);
  assert.equal(row.beginner?.lessonId, "les-1");
  assert.equal(row.beginner?.beginnerFormat, "BEGINNER_GROUP");
  assert.equal(row.beginner?.location, "אולם");
  assert.equal(row.beginner?.practiceType, "BEGINNER_GROUP");
  assert.deepEqual(row.beginner?.participantNames, ["חניכה מלמדת", "חניכה עוזרת"]);
  // The LOCKED contract: child and parent contact are present for every role.
  assert.equal(row.beginner?.children[0]?.fullName, "ילד א");
  assert.equal(row.beginner?.children[0]?.parentName, "הורה א");
  assert.equal(row.beginner?.children[0]?.parentPhone, "050-0000000");
  assert.equal(row.beginner?.children[0]?.horseName, "סוסון");
});

test("E2. INSTRUCTOR: Level 1 receives the SAME beginner detail contract", async () => {
  const counts = makeCounts();
  const dto = await readInstructorExamPlanWithDeps(
    L1_OFFERING,
    instructorDeps(counts, 1, L1_OFFERING),
  );

  const row = dto.rows.find((r) => r.source === "BEGINNER");
  assert.ok(row, "the instructor must see the beginner row");
  assert.equal(row.beginner?.children[0]?.parentPhone, "050-0000000");
  assert.deepEqual(row.beginner?.participantNames, ["חניכה מלמדת", "חניכה עוזרת"]);
});

test("E3. TRAINEE: Level 1 receives the committed trainee beginner detail", async () => {
  const counts = makeCounts();
  const dto = await readTraineeExamDayWithDeps(SOURCE_DATE, traineeDeps(counts, 1, L1_OFFERING));

  const row = dto.allRows.find((r) => r.source === "BEGINNER");
  assert.ok(row, "the trainee must see the beginner row");
  assert.equal(row.beginner?.location, "אולם");
  assert.equal(row.beginner?.children[0]?.fullName, "ילד א");
  assert.equal(row.beginner?.children[0]?.parentPhone, "050-0000000");
  // The viewer teaches this lesson, so it is their own row.
  assert.equal(row.isSelf, true);
  assert.equal(dto.myRows.includes(row), true);
});

test("E4. ADMIN at LEVEL 2 receives no beginner row", async () => {
  const counts = makeCounts();
  const dto = await readAdminExamPlanWithDeps(L2_OFFERING, adminDeps(counts, 2, L2_OFFERING));

  assert.deepEqual(dto.rows.filter((r) => r.source === "BEGINNER"), []);
  assert.equal(counts.lessons, 0);
});

test("E5. INSTRUCTOR at LEVEL 2 receives no beginner row", async () => {
  const counts = makeCounts();
  const dto = await readInstructorExamPlanWithDeps(
    L2_OFFERING,
    instructorDeps(counts, 2, L2_OFFERING),
  );

  assert.deepEqual(dto.rows.filter((r) => r.source === "BEGINNER"), []);
  assert.equal(counts.lessons, 0);
});

test("E6. TRAINEE at LEVEL 2 receives no beginner row", async () => {
  const counts = makeCounts();
  const dto = await readTraineeExamDayWithDeps(SOURCE_DATE, traineeDeps(counts, 2, L2_OFFERING));

  assert.deepEqual(dto.allRows.filter((r) => r.source === "BEGINNER"), []);
  assert.deepEqual(dto.myRows.filter((r) => r.source === "BEGINNER"), []);
  assert.equal(counts.lessons, 0);
});

test("E7. each reader forwards the RESOLVED offering's level — never a default", async () => {
  // The guard against the one silent failure this design could have: a reader
  // that forgets to pass the level would read no beginner row at Level 1.
  for (const level of [1, 2]) {
    const enabled = level === BEGINNER_SOURCE_COURSE_LEVEL;

    const adminInputs: ExamPlanLoadOptions[] = [];
    await readAdminExamPlanWithDeps(L1_OFFERING, {
      ...adminDeps(makeCounts(), level, L1_OFFERING),
      loadPlan: async (input) => {
        adminInputs.push(input.options);
        return loadExamPlan(input, ioDeps(makeCounts()));
      },
    });
    assert.equal(adminInputs[0].beginnerSourceEnabled, enabled);

    const instructorInputs: ExamPlanLoadOptions[] = [];
    await readInstructorExamPlanWithDeps(L1_OFFERING, {
      ...instructorDeps(makeCounts(), level, L1_OFFERING),
      loadPlan: async (input) => {
        instructorInputs.push(input.options);
        return loadExamPlan(input, ioDeps(makeCounts()));
      },
    });
    assert.equal(instructorInputs[0].beginnerSourceEnabled, enabled);

    const traineeInputs: ExamPlanLoadOptions[] = [];
    await readTraineeExamDayWithDeps(SOURCE_DATE, {
      ...traineeDeps(makeCounts(), level, L1_OFFERING),
      loadPlan: async (input) => {
        traineeInputs.push(input.options);
        return loadExamPlan(input, ioDeps(makeCounts()));
      },
    });
    assert.equal(traineeInputs[0].beginnerSourceEnabled, enabled);
  }
});

// ===========================================================================
// F. Publication and instructor visibility are UNCHANGED
// ===========================================================================

test("F1. the trainee gate still requires a PUBLISHED plan", async () => {
  const counts = makeCounts();
  const payload = await load(L1_OFFERING, traineeExamPlanLoadOptions(TEACHER, 1), counts, {
    publishedAt: null,
  });

  assert.deepEqual([...payload.beginnerDetails.keys()], []);
  assert.equal(counts.lessons, 0, "an unpublished plan fetches no content at all");
});

test("F2. the trainee gate still excludes an UNPUBLISHED Teaching-Practice lesson", async () => {
  const counts = makeCounts();
  const payload = await load(L1_OFFERING, traineeExamPlanLoadOptions(TEACHER, 1), counts, {
    lessons: [lesson({ isPublished: false })],
  });
  assert.deepEqual([...payload.beginnerDetails.keys()], []);
});

test("F3. admin and instructor still read DRAFT plans and UNPUBLISHED lessons", async () => {
  for (const options of [adminExamPlanLoadOptions(1), instructorExamPlanLoadOptions(1)]) {
    const payload = await load(L1_OFFERING, options, makeCounts(), {
      publishedAt: null,
      lessons: [lesson({ isPublished: false })],
    });
    assert.equal(payload.beginnerDetails.get(BEGINNER_SESSION_ID)?.isPublished, false);
  }
});

test("F4. the instructor reading is IDENTICAL to the admin reading, as before", async () => {
  const admin = await load(L1_OFFERING, adminExamPlanLoadOptions(1), makeCounts());
  const instructor = await load(L1_OFFERING, instructorExamPlanLoadOptions(1), makeCounts());

  assert.deepEqual([...admin.beginnerDetails.keys()], [...instructor.beginnerDetails.keys()]);
  assert.deepEqual(
    admin.beginnerDetails.get(BEGINNER_SESSION_ID),
    instructor.beginnerDetails.get(BEGINNER_SESSION_ID),
  );
});

test("F5. the gate changes ONLY the beginner source — the publication booleans are untouched", () => {
  assert.deepEqual(adminExamPlanLoadOptions(1), {
    requirePlanPublication: false,
    requireLessonPublication: false,
    viewerStudentId: null,
    beginnerSourceEnabled: true,
  });
  assert.deepEqual(adminExamPlanLoadOptions(2), {
    requirePlanPublication: false,
    requireLessonPublication: false,
    viewerStudentId: null,
    beginnerSourceEnabled: false,
  });
  assert.deepEqual(traineeExamPlanLoadOptions("stu-x", 2), {
    requirePlanPublication: true,
    requireLessonPublication: true,
    viewerStudentId: "stu-x",
    beginnerSourceEnabled: false,
  });
});

// ===========================================================================
// G. Query count stays bounded
// ===========================================================================

test("G1. ONE lesson query for one lesson and for forty — never one per row", async () => {
  for (const size of [1, 5, 40]) {
    const counts = makeCounts();
    const lessons = Array.from({ length: size }, (_, i) =>
      lesson({ id: `les-${i}`, startTime: `1${i % 5}:00`, createdAt: `2026-07-0${(i % 9) + 1}T09:00:00.000Z` }),
    );
    const payload = await load(L1_OFFERING, adminExamPlanLoadOptions(1), counts, { lessons });

    assert.equal(payload.beginnerDetails.size, size);
    assert.deepEqual(
      { plan: counts.plan, definitions: counts.definitions, sessions: counts.sessions, sourceDates: counts.sourceDates, lessons: counts.lessons },
      { plan: 1, definitions: 1, sessions: 1, sourceDates: 1, lessons: 1 },
      `size ${size} must not change the query count`,
    );
  }
});

test("G2. Level 2 costs STRICTLY FEWER queries — the gate removes two, adds none", async () => {
  const l1 = makeCounts();
  const l2 = makeCounts();
  await load(L1_OFFERING, adminExamPlanLoadOptions(1), l1);
  await load(L2_OFFERING, adminExamPlanLoadOptions(2), l2);

  assert.equal(l1.sourceDates + l1.lessons, 2);
  assert.equal(l2.sourceDates + l2.lessons, 0);
  assert.equal(l2.plan + l2.definitions + l2.sessions, 3);
});

// ===========================================================================
// H. No duplicate storage, no writer, no schema change
// ===========================================================================

const REPO_ROOT = process.cwd();

function readSource(rel: string): string {
  const abs = join(REPO_ROOT, rel);
  assert.ok(existsSync(abs), `expected ${rel} to exist`);
  return readFileSync(abs, "utf8");
}

/** Source with comments stripped — the guards below judge CODE, not prose. */
function codeOf(rel: string): string {
  return readSource(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/**
 * The Prisma client import specifier, assembled from SPLIT LITERALS.
 *
 * `exam-no-feedback-guard.test.ts` scans every file in `lib/exam` for that exact
 * string, so spelling it out here would make this suite trip that sibling guard —
 * the same convention the committed loader suite already uses.
 */
const PRISMA_IMPORT = "@/lib/" + "prisma";

const TOUCHED_PRODUCTION = [
  "lib/exam/exam-beginner-course-scope-core.ts",
  "lib/exam/exam-plan-loader-core.ts",
  "lib/exam/exam-read-scope-core.ts",
];

test("H1. no file this slice touches performs a WRITE of any kind", () => {
  // Assembled from split literals so this guard cannot match its own source.
  const writeTokens = [
    "cre" + "ate(",
    "up" + "date(",
    "up" + "sert(",
    "del" + "ete(",
    "deleteM" + "any(",
    "updateM" + "any(",
    "createM" + "any(",
    "$execute" + "Raw",
    "$trans" + "action",
  ];
  for (const rel of TOUCHED_PRODUCTION) {
    const code = codeOf(rel);
    for (const token of writeTokens) {
      assert.equal(code.includes(token), false, `${rel} performs a write: ${token}`);
    }
  }
});

test("H2. nothing beginner-shaped is STORED — the projection stays live", () => {
  for (const rel of TOUCHED_PRODUCTION) {
    const code = codeOf(rel);
    for (const token of ["ExamBeginnerChild", "copiedAt", "sourceTeachingPracticeLessonId"]) {
      assert.equal(code.includes(token), false, `${rel} reintroduces beginner storage: ${token}`);
    }
  }
});

test("H3. the containment is a PRODUCT RULE — no schema, migration or relation was added", () => {
  const scope = codeOf("lib/exam/exam-beginner-course-scope-core.ts");
  for (const token of ["pris" + "ma", "model ", "@relation", "migration"]) {
    assert.equal(scope.includes(token), false, `the predicate references ${token}`);
  }
  // The Teaching-Practice models still carry NO course binding: if one is ever
  // added, this slice's product rule stops being the only containment and this
  // guard is the reminder to revisit it.
  const schema = readSource(join("pris" + "ma", "schema." + "prisma"));
  const lessonModel = schema.slice(
    schema.indexOf("model TeachingPracticeLesson {"),
    schema.indexOf("model TeachingPracticeParticipant {"),
  );
  assert.ok(lessonModel.length > 0, "sanity: the lesson model was not found");
  assert.equal(
    /courseOfferingId/.test(lessonModel),
    false,
    "TeachingPracticeLesson gained a course binding — revisit the level rule",
  );
});

test("H4. no Teaching-Practice WRITER is reachable from the touched files", () => {
  for (const rel of TOUCHED_PRODUCTION) {
    const code = codeOf(rel);
    assert.equal(
      /from\s+["'][^"']*teaching-practice(?!-)/.test(code) &&
        !/exam-tp-source-adapter-core/.test(code),
      false,
      `${rel} imports a Teaching-Practice module directly`,
    );
  }
});

test("H5. the pure modules remain PURE — no Prisma, no session, no clock", () => {
  for (const rel of TOUCHED_PRODUCTION) {
    const code = codeOf(rel);
    for (const token of [PRISMA_IMPORT, "server-only", "use server", "Date.now(", "Math.random("]) {
      assert.equal(code.includes(token), false, `${rel} is no longer pure: ${token}`);
    }
  }
});
