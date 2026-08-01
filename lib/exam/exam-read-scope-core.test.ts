/**
 * EXAM EX-S5A-4B — executable tests for the PURE role scope core
 * (exam-read-scope-core.ts) and the structural contract of its real bindings.
 *
 * DB-FREE: every case builds plain in-memory fixtures and injects fakes. This
 * suite opens no database connection, executes no SQL, reads no session, touches
 * no environment variable and constructs no `Date`. The only files it reads from
 * disk are repository SOURCES, for the structural guards at the end.
 *
 * SCOPE OF PROOF: that identity is resolved BEFORE course authorization, that
 * course authorization completes BEFORE any plan or name query, that each role's
 * publication options are constants of the module rather than caller input, that
 * a denial is indistinguishable from an empty plan, that infrastructure failures
 * propagate instead of becoming empty screens, that display names are resolved
 * in ONE batch per entity per read regardless of size, that a trainee reader
 * cannot issue an instructor query at all, and that nothing but a narrowed DTO
 * is ever returned.
 *
 * The forbidden module specifiers the structural guards search for are assembled
 * from SPLIT LITERALS on purpose: `exam-no-feedback-guard.test.ts` scans every
 * file in `lib/exam` for exact tokens, and the sibling caller allow-list guards
 * scan for exact call sites — spelling one out here would make this suite trip
 * them.
 *
 * Run with: npx tsx --test lib/exam/exam-read-scope-core.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";

import {
  adminExamPlanLoadOptions,
  instructorExamPlanLoadOptions,
  buildTraineeExamArenaLookup,
  collectExamInstructorDisplayIds,
  collectExamStudentDisplayIds,
  emptyAdminExamReadDto,
  emptyInstructorExamReadDto,
  emptyTraineeExamDayDto,
  normalizeSelectedExamDate,
  readAdminExamPlanWithDeps,
  readInstructorExamPlanWithDeps,
  readTraineeExamDayWithDeps,
  readTraineeExamScheduleWithDeps,
  traineeExamPlanLoadOptions,
  type AdminExamReadDeps,
  type InstructorExamReadDeps,
  type TraineeExamReadDeps,
} from "./exam-read-scope-core";
import {
  findNonPlainJsonPaths,
  isPlainJsonDto,
  type TraineeExamDayRowDto,
} from "./exam-read-dto";
import type { ExamPlanLoadInput, ExamPlanPayload } from "./exam-plan-loader-core";
import type { ProjectionSession } from "./exam-schedule-projection-core";
import type { BeginnerDetail } from "./exam-live-beginner-adapter-core";
import type { StoredExamBlockDetail } from "./exam-trainee-view-core";
import type { ConflictSession } from "./exam-conflict-core";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const SCOPE_PATH = join(REPO_ROOT, "lib", "exam", "exam-read-scope-core.ts");
const SCOPE_TEST_PATH = join(REPO_ROOT, "lib", "exam", "exam-read-scope-core.test.ts");
const READERS_PATH = join(REPO_ROOT, "lib", "actions", "exam-role-readers.ts");
const IO_PATH = join(REPO_ROOT, "lib", "actions", "exam-read-io.ts");
const DTO_PATH = join(REPO_ROOT, "lib", "exam", "exam-read-dto.ts");
const LOADER_PATH = join(REPO_ROOT, "lib", "exam", "exam-plan-loader-core.ts");

const DATE = "2026-08-02";
const OTHER_DATE = "2026-08-03";

// ===========================================================================
// Fixtures — plain in-memory data, no database anywhere
// ===========================================================================

function storedSession(over: Partial<ProjectionSession> = {}): ProjectionSession {
  return Object.freeze({
    sessionId: "s1",
    kind: "ADVANCED_INSTRUCTION",
    beginnerFormat: null,
    date: DATE,
    startTime: "09:00",
    endTime: "10:00",
    orderIndex: 0,
    examineeStudentIds: ["stu-1"],
    instructedTraineeStudentIds: ["stu-3"],
    beginnerChildCount: 0,
    definitionId: "def-1",
    definitionName: "מבחן מתקדמים",
    derivedBlockEndTime: "10:00",
    timetableStatus: "OK",
    ...over,
  }) as ProjectionSession;
}

function beginnerSession(over: Partial<ProjectionSession> = {}): ProjectionSession {
  return Object.freeze({
    sessionId: "tp:l1",
    kind: "BEGINNER_INSTRUCTION",
    beginnerFormat: "BEGINNER_GROUP",
    date: DATE,
    startTime: "11:00",
    endTime: "12:00",
    orderIndex: 1,
    examineeStudentIds: ["stu-2"],
    instructedTraineeStudentIds: [],
    beginnerChildCount: 1,
    definitionId: null,
    definitionName: null,
    derivedBlockEndTime: null,
    timetableStatus: "NOT_APPLICABLE",
    ...over,
  }) as ProjectionSession;
}

function storedDetail(sessionId: string, studentId: string): StoredExamBlockDetail {
  return Object.freeze({
    source: "STORED",
    sessionId,
    slots: Object.freeze([
      Object.freeze({
        assignmentId: `${sessionId}-a1`,
        studentId,
        role: "EXAMINEE",
        startTime: "09:00",
        endTime: "09:20",
      }),
    ]),
  }) as StoredExamBlockDetail;
}

function participant(traineeId: string, over: Record<string, unknown> = {}) {
  return {
    participantId: `p-${traineeId}`,
    traineeId,
    traineeName: `שם מקור ${traineeId}`,
    sourcePracticeRole: "BEGINNER_INSTRUCTOR",
    isManualOverride: false,
    isSelf: false,
    ...over,
  };
}

function beginnerDetail(over: Record<string, unknown> = {}): BeginnerDetail {
  return {
    sessionId: "tp:l1",
    lessonId: "l1",
    beginnerFormat: "BEGINNER_GROUP",
    practiceType: "BEGINNER_GROUP",
    date: DATE,
    startTime: "11:00",
    endTime: "12:00",
    orderIndex: 1,
    groupName: "א",
    location: "אולם",
    notes: null,
    isPublished: true,
    roleLabelOverrides: null,
    responsibleInstructorId: "ins-9",
    responsibleInstructorName: "שם מדריכה מהמקור",
    participants: [participant("stu-2")],
    children: [
      {
        childAssignmentId: "ca-1",
        childId: "c-1",
        fullName: "ילד",
        age: 8,
        gender: null,
        childNotes: null,
        parentName: "הורה",
        parentPhone: "050-0000000",
        horseName: null,
        equipmentNotes: null,
        isAbsent: false,
      },
    ],
    isSelf: false,
    ...over,
  } as unknown as BeginnerDetail;
}

function conflictSession(
  sessionId: string,
  over: Record<string, unknown> = {},
): ConflictSession {
  return {
    sessionId,
    interval: { date: DATE, start: "09:00", end: "10:00" },
    assignments: [],
    supervisorIds: ["ins-1"],
    examinerSetId: null,
    horseIds: [],
    arenaId: "אולם רכיבה",
    capacity: null,
    expectsStaffing: false,
    ...over,
  } as unknown as ConflictSession;
}

function makePayload(over: Partial<ExamPlanPayload> = {}): ExamPlanPayload {
  return {
    planId: "plan-1",
    publishedAt: 1000,
    sessions: [],
    storedDetails: new Map<string, StoredExamBlockDetail>(),
    beginnerDetails: new Map<string, BeginnerDetail>(),
    conflictSessions: [],
    sourceDates: [],
    diagnostics: {
      storedAdapterIssues: [],
      storedBlockDiagnostics: [],
      teachingPracticeSourceIssues: [],
      beginnerRejections: [],
      loaderIssues: [],
    },
    ...over,
  } as ExamPlanPayload;
}

/** The ordinary populated payload: one stored block plus one live beginner row. */
function populatedPayload(): ExamPlanPayload {
  return makePayload({
    sessions: [storedSession(), beginnerSession()],
    storedDetails: new Map([["s1", storedDetail("s1", "stu-1")]]),
    beginnerDetails: new Map([["tp:l1", beginnerDetail()]]),
    conflictSessions: [conflictSession("s1")],
    sourceDates: [DATE],
  });
}

// ===========================================================================
// Spies
// ===========================================================================

interface Spies {
  readonly order: string[];
  readonly adminRequests: string[];
  readonly instructorRequests: string[];
  identityCalls: number;
  courseCalls: number;
  readonly loadInputs: ExamPlanLoadInput[];
  readonly studentIdBatches: (readonly string[])[];
  readonly instructorIdBatches: (readonly string[])[];
}

function makeSpies(): Spies {
  return {
    order: [],
    adminRequests: [],
    instructorRequests: [],
    identityCalls: 0,
    courseCalls: 0,
    loadInputs: [],
    studentIdBatches: [],
    instructorIdBatches: [],
  };
}

function nameMap(entries: readonly (readonly [string, string])[]): ReadonlyMap<string, string> {
  return new Map(entries.map(([id, name]) => [id, name]));
}

/**
 * EX-TRAINEE-ID-CONTAINMENT — locating a TRAINEE row without an internal id.
 *
 * The trainee contract no longer carries `sessionId`: it was `ExamSession.id`
 * for a stored block and the synthetic `tp:<lessonId>` for a live beginner row,
 * both database primary keys, and neither was ever rendered. These tests locate
 * a row the way a READER does — by a value that is actually on it.
 *
 * `s1` and `s-mid` share a start time and belong to DIFFERENT payloads that no
 * single DTO ever holds together, so the lookup stays unambiguous. `tp:other` is
 * mapped to a time NO fixture uses, so an "is-absent" assertion still names a
 * row that genuinely is not there.
 */
const TRAINEE_ROW_START_TIMES: Readonly<Record<string, string>> = Object.freeze({
  s1: "09:00",
  "tp:l1": "11:00",
  "s-first": "07:30",
  "tp:early": "08:00",
  "s-late": "14:00",
  "tp:other": "23:59",
});

/** The trainee row corresponding to a fixture id, or `undefined`. */
function traineeRow(
  rows: readonly TraineeExamDayRowDto[],
  fixtureId: string,
): TraineeExamDayRowDto | undefined {
  const startTime = TRAINEE_ROW_START_TIMES[fixtureId];
  assert.ok(startTime !== undefined, `unknown fixture row ${fixtureId}`);
  return rows.find((row) => row.startTime === startTime);
}

/** The fixture ids of these trainee rows, in order — for list assertions. */
function traineeRowIds(rows: readonly TraineeExamDayRowDto[]): string[] {
  return rows.map((row) => {
    const match = Object.entries(TRAINEE_ROW_START_TIMES).find(
      ([, startTime]) => startTime === row.startTime,
    );
    return match === undefined ? `unmapped:${row.startTime}` : match[0];
  });
}

function adminDeps(
  spies: Spies,
  options: {
    readonly verifiedId?: string;
    readonly payload?: ExamPlanPayload;
    readonly requireAdminCourseOffering?: (
      id: string,
    ) => Promise<{ readonly id: string; readonly level: number }>;
    /** The DB-verified offering's level. Defaults to the beginner level. */
    readonly courseLevel?: number;
    readonly studentNames?: ReadonlyMap<string, string>;
    readonly instructorNames?: ReadonlyMap<string, string>;
    readonly onStudentNames?: () => Promise<ReadonlyMap<string, string>>;
  } = {},
): AdminExamReadDeps {
  return {
    requireAdminCourseOffering:
      options.requireAdminCourseOffering ??
      (async (id: string) => {
        spies.order.push("admin-course");
        spies.adminRequests.push(id);
        spies.courseCalls += 1;
        return { id: options.verifiedId ?? "offering-verified", level: options.courseLevel ?? 1 };
      }),
    loadPlan: async (input) => {
      spies.order.push("load");
      spies.loadInputs.push(input);
      return options.payload ?? populatedPayload();
    },
    fetchStudentDisplayNames: async (ids) => {
      spies.order.push("student-names");
      spies.studentIdBatches.push(ids);
      if (options.onStudentNames !== undefined) return options.onStudentNames();
      return options.studentNames ?? nameMap([]);
    },
    fetchInstructorDisplayNames: async (ids) => {
      spies.order.push("instructor-names");
      spies.instructorIdBatches.push(ids);
      return options.instructorNames ?? nameMap([]);
    },
  };
}

function instructorDeps(
  spies: Spies,
  options: {
    readonly verifiedId?: string;
    readonly payload?: ExamPlanPayload;
    readonly identityError?: unknown;
    readonly courseError?: unknown;
    readonly isDenial?: (error: unknown) => boolean;
    /** The DB-verified offering's level. Defaults to the beginner level. */
    readonly courseLevel?: number;
    readonly studentNames?: ReadonlyMap<string, string>;
    readonly instructorNames?: ReadonlyMap<string, string>;
  } = {},
): InstructorExamReadDeps {
  return {
    requireInstructorId: async () => {
      spies.order.push("instructor-identity");
      spies.identityCalls += 1;
      if (options.identityError !== undefined) throw options.identityError;
      return "ins-self";
    },
    resolveInstructorCourseOffering: async (requested) => {
      spies.order.push("instructor-course");
      spies.instructorRequests.push(requested);
      spies.courseCalls += 1;
      if (options.courseError !== undefined) throw options.courseError;
      return { id: options.verifiedId ?? "offering-verified", level: options.courseLevel ?? 1 };
    },
    isCourseContextDenial: options.isDenial ?? ((error) => error instanceof DenialError),
    loadPlan: async (input) => {
      spies.order.push("load");
      spies.loadInputs.push(input);
      return options.payload ?? populatedPayload();
    },
    fetchStudentDisplayNames: async (ids) => {
      spies.order.push("student-names");
      spies.studentIdBatches.push(ids);
      return options.studentNames ?? nameMap([]);
    },
    fetchInstructorDisplayNames: async (ids) => {
      spies.order.push("instructor-names");
      spies.instructorIdBatches.push(ids);
      return options.instructorNames ?? nameMap([]);
    },
  };
}

/**
 * The trainee deps PLUS an instructor-name spy the contract does not declare.
 *
 * The extra property is deliberate: it proves the trainee reader issues no
 * instructor lookup even when one is physically present on the object it was
 * handed — the contract's omission is not the only thing keeping the count at
 * zero.
 */
function traineeDeps(
  spies: Spies,
  options: {
    readonly studentId?: string;
    readonly verifiedId?: string;
    readonly payload?: ExamPlanPayload;
    readonly identityError?: unknown;
    readonly courseError?: unknown;
    readonly isDenial?: (error: unknown) => boolean;
    /** The DB-verified offering's level. Defaults to the beginner level. */
    readonly courseLevel?: number;
    readonly studentNames?: ReadonlyMap<string, string>;
    readonly onStudentNames?: () => Promise<ReadonlyMap<string, string>>;
  } = {},
): TraineeExamReadDeps {
  const deps = {
    requireTraineeId: async () => {
      spies.order.push("trainee-identity");
      spies.identityCalls += 1;
      if (options.identityError !== undefined) throw options.identityError;
      return options.studentId ?? "stu-1";
    },
    resolveTraineeCourseOffering: async () => {
      spies.order.push("trainee-course");
      spies.courseCalls += 1;
      if (options.courseError !== undefined) throw options.courseError;
      return { id: options.verifiedId ?? "offering-verified", level: options.courseLevel ?? 1 };
    },
    isCourseContextDenial: options.isDenial ?? ((error: unknown) => error instanceof DenialError),
    loadPlan: async (input: ExamPlanLoadInput) => {
      spies.order.push("load");
      spies.loadInputs.push(input);
      return options.payload ?? populatedPayload();
    },
    fetchStudentDisplayNames: async (ids: readonly string[]) => {
      spies.order.push("student-names");
      spies.studentIdBatches.push(ids);
      if (options.onStudentNames !== undefined) return options.onStudentNames();
      return options.studentNames ?? nameMap([]);
    },
    // NOT part of TraineeExamReadDeps — present only so its call count can be
    // asserted to be zero.
    fetchInstructorDisplayNames: async (ids: readonly string[]) => {
      spies.order.push("instructor-names");
      spies.instructorIdBatches.push(ids);
      return nameMap([]);
    },
  };
  return deps;
}

/** A typed "this caller has no course context" failure, for the fake predicate. */
class DenialError extends Error {
  constructor() {
    super("denied");
    this.name = "DenialError";
  }
}

/** An INFRASTRUCTURE failure. Never a denial, must always propagate. */
class InfrastructureError extends Error {
  constructor(message = "database exploded") {
    super(message);
    this.name = "InfrastructureError";
  }
}

/** Every string value anywhere in a returned DTO. */
function deepStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value);
    return out;
  }
  if (value === null || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    value.forEach((entry) => deepStrings(entry, out));
    return out;
  }
  Object.values(value as Record<string, unknown>).forEach((entry) => deepStrings(entry, out));
  return out;
}

/** The module source with comments stripped: guards must assert on CODE. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/gm, "$1");
}

/** The COMMENT text only — the inverse of {@link stripComments}. */
function commentsOf(source: string): string {
  return [
    ...(source.match(/\/\*[\s\S]*?\*\//g) ?? []),
    ...(source.match(/(?:^|[^:])\/\/[^\n]*/gm) ?? []),
  ]
    .join("\n")
    .replace(/^\s*\*+/gm, " ");
}

// ===========================================================================
// 1–4. Admin ordering, verified id, locked options, DTO-only result
// ===========================================================================

test("1. admin authorization runs BEFORE the loader and before any name query", async () => {
  const spies = makeSpies();
  await readAdminExamPlanWithDeps("requested-offering", adminDeps(spies));
  assert.equal(spies.order[0], "admin-course");
  assert.equal(spies.order[1], "load");
  assert.ok(spies.order.indexOf("load") < spies.order.indexOf("student-names"));
});

test("2. admin loads the VERIFIED offering id, never the requested string", async () => {
  const spies = makeSpies();
  await readAdminExamPlanWithDeps("requested-offering", adminDeps(spies, { verifiedId: "db-id" }));
  assert.deepEqual(spies.adminRequests, ["requested-offering"]);
  assert.equal(spies.loadInputs.length, 1);
  assert.equal(spies.loadInputs[0].courseOfferingId, "db-id");
});

test("3. admin publication options are false / false / null and come from the module producer", async () => {
  const spies = makeSpies();
  await readAdminExamPlanWithDeps("o", adminDeps(spies));
  assert.deepEqual(spies.loadInputs[0].options, {
    requirePlanPublication: false,
    requireLessonPublication: false,
    viewerStudentId: null,
    // The DB-verified offering is Level 1 in this fixture, so the beginner
    // source is open. The two publication booleans are unaffected by it.
    beginnerSourceEnabled: true,
  });
  assert.deepEqual(spies.loadInputs[0].options, adminExamPlanLoadOptions(1));
  assert.ok(Object.isFrozen(adminExamPlanLoadOptions(1)));
});

test("4. admin receives a narrowed DTO, never the internal payload", async () => {
  const spies = makeSpies();
  const payload = populatedPayload();
  const dto = await readAdminExamPlanWithDeps("o", adminDeps(spies, { payload }));
  assert.equal(dto.viewerRole, "ADMIN");
  assert.notEqual(dto as unknown, payload as unknown);
  for (const key of ["storedDetails", "beginnerDetails", "conflictSessions", "sessions"]) {
    assert.equal(key in dto, false, `the admin DTO exposes ${key}`);
  }
  assert.ok(isPlainJsonDto(dto));
});

// ===========================================================================
// 5–10. Instructor ordering, verified id, locked options, uniform denial
// ===========================================================================

test("5. instructor identity runs before course resolution", async () => {
  const spies = makeSpies();
  await readInstructorExamPlanWithDeps("req", instructorDeps(spies));
  assert.equal(spies.order[0], "instructor-identity");
  assert.equal(spies.order[1], "instructor-course");
});

test("6. instructor course resolution runs before the loader", async () => {
  const spies = makeSpies();
  await readInstructorExamPlanWithDeps("req", instructorDeps(spies));
  assert.ok(spies.order.indexOf("instructor-course") < spies.order.indexOf("load"));
});

test("7. instructor loads the resolver's verified id, never the requested string", async () => {
  const spies = makeSpies();
  await readInstructorExamPlanWithDeps("req", instructorDeps(spies, { verifiedId: "db-id" }));
  assert.deepEqual(spies.instructorRequests, ["req"]);
  assert.equal(spies.loadInputs[0].courseOfferingId, "db-id");
});

test("8. instructor publication options are false / false / null", async () => {
  const spies = makeSpies();
  await readInstructorExamPlanWithDeps("req", instructorDeps(spies));
  assert.deepEqual(spies.loadInputs[0].options, {
    requirePlanPublication: false,
    requireLessonPublication: false,
    viewerStudentId: null,
    beginnerSourceEnabled: true,
  });
  assert.deepEqual(spies.loadInputs[0].options, instructorExamPlanLoadOptions(1));
});

test("9. every instructor denial produces the SAME empty DTO", async () => {
  const unauthenticated = await readInstructorExamPlanWithDeps(
    "req",
    instructorDeps(makeSpies(), { identityError: new DenialError() }),
  );
  const disallowed = await readInstructorExamPlanWithDeps(
    "req",
    instructorDeps(makeSpies(), { courseError: new DenialError() }),
  );
  const noPlan = await readInstructorExamPlanWithDeps(
    "req",
    instructorDeps(makeSpies(), { payload: makePayload({ planId: null, publishedAt: null }) }),
  );

  const empty = emptyInstructorExamReadDto();
  assert.deepEqual(unauthenticated, empty);
  assert.deepEqual(disallowed, empty);
  // A denial is indistinguishable from an offering that simply has no plan.
  assert.deepEqual(noPlan, empty);
  assert.equal(unauthenticated.planId, null);
  assert.equal(unauthenticated.isPublished, false);
  assert.equal(unauthenticated.publishedAt, null);
  assert.deepEqual(unauthenticated.rows, []);
});

test("10. a denied instructor triggers ZERO loader and ZERO name calls", async () => {
  const identityDenied = makeSpies();
  await readInstructorExamPlanWithDeps(
    "req",
    instructorDeps(identityDenied, { identityError: new DenialError() }),
  );
  assert.deepEqual(identityDenied.order, ["instructor-identity"]);
  assert.equal(identityDenied.loadInputs.length, 0);
  assert.equal(identityDenied.studentIdBatches.length, 0);
  assert.equal(identityDenied.instructorIdBatches.length, 0);
  // ...and the course resolver was never even asked, so no id was probed.
  assert.equal(identityDenied.courseCalls, 0);

  const courseDenied = makeSpies();
  await readInstructorExamPlanWithDeps(
    "req",
    instructorDeps(courseDenied, { courseError: new DenialError() }),
  );
  assert.deepEqual(courseDenied.order, ["instructor-identity", "instructor-course"]);
  assert.equal(courseDenied.loadInputs.length, 0);
  assert.equal(courseDenied.studentIdBatches.length, 0);
});

// ===========================================================================
// 11–19. Trainee ordering, resolver-owned scope, locked options, projection
// ===========================================================================

test("11. trainee identity runs before course resolution", async () => {
  const spies = makeSpies();
  await readTraineeExamDayWithDeps(DATE, traineeDeps(spies));
  assert.equal(spies.order[0], "trainee-identity");
  assert.equal(spies.order[1], "trainee-course");
  assert.ok(spies.order.indexOf("trainee-course") < spies.order.indexOf("load"));
});

test("12. the trainee resolver supplies the ONLY courseOfferingId", async () => {
  const spies = makeSpies();
  await readTraineeExamDayWithDeps(DATE, traineeDeps(spies, { verifiedId: "trainee-course-id" }));
  assert.equal(spies.loadInputs[0].courseOfferingId, "trainee-course-id");
});

test("13. the trainee reader accepts a date and nothing else", () => {
  // Arity is the contract: there is no second parameter through which a course
  // offering id, a student id, a plan id or an option could arrive.
  assert.equal(readTraineeExamDayWithDeps.length, 2); // (selectedDate, deps)
  const readersSource = readFileSync(READERS_PATH, "utf8");
  const signature = /export async function readTraineeExamDay\(\s*([^)]*)\)/.exec(
    stripComments(readersSource),
  )?.[1];
  assert.ok(signature !== undefined, "the trainee reader signature was not found");
  assert.equal(signature.replace(/\s+/g, " ").trim(), "selectedDate: string,");
});

test("14. trainee publication options are true / true / the AUTHENTICATED id", async () => {
  const spies = makeSpies();
  await readTraineeExamDayWithDeps(DATE, traineeDeps(spies, { studentId: "stu-session" }));
  assert.deepEqual(spies.loadInputs[0].options, {
    requirePlanPublication: true,
    requireLessonPublication: true,
    viewerStudentId: "stu-session",
    beginnerSourceEnabled: true,
  });
  assert.ok(Object.isFrozen(traineeExamPlanLoadOptions("x", 1)));
});

test("15. an illegible selectedDate returns empty with ZERO dependency calls", async () => {
  for (const token of ["", "   ", "2026-8-2", "2026-08-02T10:00", "yesterday", "2026-08"]) {
    const spies = makeSpies();
    const dto = await readTraineeExamDayWithDeps(token, traineeDeps(spies));
    assert.deepEqual(dto, emptyTraineeExamDayDto(), `token ${token} was not refused`);
    assert.deepEqual(spies.order, [], `token ${token} reached a dependency`);
  }
  // The documented ordering: the token is validated first because it addresses
  // no day; no content is reachable on either side of that check.
  assert.equal(normalizeSelectedExamDate(" 2026-08-02 "), "2026-08-02");
  assert.equal(normalizeSelectedExamDate("2026-8-02"), null);
});

test("16. an unpublished or missing plan yields the empty trainee DTO", async () => {
  const spies = makeSpies();
  const dto = await readTraineeExamDayWithDeps(
    DATE,
    traineeDeps(spies, { payload: makePayload({ planId: null, publishedAt: null }) }),
  );
  assert.deepEqual(dto, emptyTraineeExamDayDto());
  assert.deepEqual(dto.allRows, []);
  assert.deepEqual(dto.myRows, []);
  // No plan id and no publication state can be inferred from the result.
  assert.deepEqual(Object.keys(dto), ["allRows", "myRows"]);
});

test("17. an empty trainee payload triggers NO name lookup at all", async () => {
  const spies = makeSpies();
  await readTraineeExamDayWithDeps(
    DATE,
    traineeDeps(spies, { payload: makePayload({ planId: null, publishedAt: null }) }),
  );
  assert.deepEqual(spies.order, ["trainee-identity", "trainee-course", "load"]);
  assert.equal(spies.studentIdBatches.length, 0);
  assert.equal(spies.instructorIdBatches.length, 0);
});

test("18. the projection is asked for the EXACT date and the authenticated id", async () => {
  const spies = makeSpies();
  const payload = makePayload({
    sessions: [
      storedSession(),
      storedSession({ sessionId: "s2", date: OTHER_DATE, examineeStudentIds: ["stu-1"] }),
    ],
    storedDetails: new Map([
      ["s1", storedDetail("s1", "stu-1")],
      ["s2", storedDetail("s2", "stu-1")],
    ]),
  });
  const dto = await readTraineeExamDayWithDeps(
    DATE,
    traineeDeps(spies, { studentId: "stu-1", payload }),
  );
  // Only the selected day survives...
  assert.deepEqual(
    traineeRowIds(dto.allRows),
    ["s1"],
  );
  // ...and self-ness follows the SESSION-derived id, not a caller value.
  assert.equal(dto.allRows[0].isSelf, true);
  assert.deepEqual(dto.myRows, dto.allRows.filter((row) => row.isSelf));
  assert.equal(dto.myRows[0], dto.allRows[0], "myRows must share row identity");

  const other = makeSpies();
  const foreign = await readTraineeExamDayWithDeps(
    DATE,
    traineeDeps(other, { studentId: "stu-99", payload }),
  );
  assert.equal(foreign.allRows[0].isSelf, false);
  assert.deepEqual(foreign.myRows, []);
});

test("19. no projection issue, diagnostic or EX-* code reaches the trainee DTO", async () => {
  const spies = makeSpies();
  // A stored row with NO usable detail produces an EX-TRN-* issue upstream.
  const payload = makePayload({
    sessions: [storedSession({ sessionId: "broken" }), storedSession()],
    storedDetails: new Map([["s1", storedDetail("s1", "stu-1")]]),
  });
  const dto = await readTraineeExamDayWithDeps(
    DATE,
    traineeDeps(spies, { studentId: "stu-1", payload }),
  );
  assert.deepEqual(Object.keys(dto), ["allRows", "myRows"]);
  assert.deepEqual(
    traineeRowIds(dto.allRows),
    ["s1"],
  );
  const serialized = JSON.stringify(dto);
  for (const token of ["EX-TRN", "EX-DTO", "EX-LOAD", "EX-ADP", "issues", "diagnostics"]) {
    assert.equal(serialized.includes(token), false, `the trainee DTO carries ${token}`);
  }
});

// ===========================================================================
// 20–22. The narrow arena sibling
// ===========================================================================

test("20. the stored arena is attached to the exact session", async () => {
  const spies = makeSpies();
  const payload = makePayload({
    sessions: [storedSession()],
    storedDetails: new Map([["s1", storedDetail("s1", "stu-1")]]),
    conflictSessions: [conflictSession("s1", { arenaId: "  אולם מקורה  " })],
  });
  const dto = await readTraineeExamDayWithDeps(
    DATE,
    traineeDeps(spies, { studentId: "stu-1", payload }),
  );
  assert.equal(dto.allRows[0].arena, "אולם מקורה");
});

test("21. the arena lookup can express a session id and an arena, and nothing else", () => {
  const lookup = buildTraineeExamArenaLookup([
    conflictSession("s1", {
      supervisorIds: ["ins-secret"],
      horseIds: ["horse-secret"],
      examinerSetId: "set-secret",
      capacity: 4,
      assignments: [{ assignmentId: "a", studentId: "stu-secret" }],
    }),
  ]);
  const entry = lookup.get("s1");
  assert.ok(entry !== undefined);
  assert.deepEqual(Object.keys(entry), ["sessionId", "arena"]);
  const serialized = JSON.stringify([...lookup.values()]);
  for (const token of ["ins-secret", "horse-secret", "set-secret", "stu-secret", "interval"]) {
    assert.equal(serialized.includes(token), false, `the arena lookup carries ${token}`);
  }
  // Blank arenas are `null`, never an empty string masquerading as a place.
  assert.equal(buildTraineeExamArenaLookup([conflictSession("s2", { arenaId: "  " })]).get("s2")?.arena, null);
  assert.equal(buildTraineeExamArenaLookup([conflictSession("s3", { arenaId: null })]).get("s3")?.arena, null);
});

test("22. a duplicated stored session id fails closed — neither arena wins", async () => {
  const lookup = buildTraineeExamArenaLookup([
    conflictSession("s1", { arenaId: "אולם א" }),
    conflictSession("s1", { arenaId: "אולם ב" }),
    conflictSession("s2", { arenaId: "אולם ג" }),
  ]);
  assert.equal(lookup.has("s1"), false);
  assert.equal(lookup.get("s2")?.arena, "אולם ג");

  const spies = makeSpies();
  const dto = await readTraineeExamDayWithDeps(
    DATE,
    traineeDeps(spies, {
      studentId: "stu-1",
      payload: makePayload({
        sessions: [storedSession()],
        storedDetails: new Map([["s1", storedDetail("s1", "stu-1")]]),
        conflictSessions: [
          conflictSession("s1", { arenaId: "אולם א" }),
          conflictSession("s1", { arenaId: "אולם ב" }),
        ],
      }),
    }),
  );
  assert.equal(dto.allRows[0].arena, null);
});

// ===========================================================================
// 23–29. Batched name resolution
// ===========================================================================

test("23. student names are fetched in exactly ONE batch", async () => {
  const spies = makeSpies();
  await readAdminExamPlanWithDeps("o", adminDeps(spies));
  assert.equal(spies.studentIdBatches.length, 1);
});

test("24. instructor names are fetched in exactly ONE batch", async () => {
  const spies = makeSpies();
  await readAdminExamPlanWithDeps("o", adminDeps(spies));
  assert.equal(spies.instructorIdBatches.length, 1);
  assert.deepEqual(spies.instructorIdBatches[0], ["ins-1", "ins-9"]);
});

test("25. an empty id set issues NO name call", async () => {
  const spies = makeSpies();
  await readAdminExamPlanWithDeps(
    "o",
    adminDeps(spies, {
      payload: makePayload({
        sessions: [
          storedSession({ examineeStudentIds: [], instructedTraineeStudentIds: [], sessionId: "s1" }),
        ],
        conflictSessions: [conflictSession("s1", { supervisorIds: [] })],
      }),
    }),
  );
  assert.equal(spies.studentIdBatches.length, 0);
  assert.equal(spies.instructorIdBatches.length, 0);
  assert.deepEqual(spies.order, ["admin-course", "load"]);
});

test("26. ids are trimmed, de-blanked, deduplicated and sorted before IO", async () => {
  const spies = makeSpies();
  await readAdminExamPlanWithDeps(
    "o",
    adminDeps(spies, {
      payload: makePayload({
        sessions: [
          storedSession({
            examineeStudentIds: ["stu-b", " stu-a ", "stu-b", "", "   "],
            instructedTraineeStudentIds: ["stu-a", "stu-c"],
          }),
        ],
        conflictSessions: [
          conflictSession("s1", { supervisorIds: ["ins-2", " ins-1 ", "ins-2", ""] }),
        ],
      }),
    }),
  );
  assert.deepEqual(spies.studentIdBatches[0], ["stu-a", "stu-b", "stu-c"]);
  assert.deepEqual(spies.instructorIdBatches[0], ["ins-1", "ins-2"]);
});

test("27. names resolve by EXACT id key; the DTO emits names, never ids", async () => {
  const spies = makeSpies();
  const dto = await readAdminExamPlanWithDeps(
    "o",
    adminDeps(spies, {
      payload: makePayload({
        sessions: [storedSession({ examineeStudentIds: ["stu-1", "stu-1"], instructedTraineeStudentIds: [] })],
        conflictSessions: [conflictSession("s1", { supervisorIds: ["ins-1"] })],
      }),
      studentNames: nameMap([["stu-1", "דנה"]]),
      instructorNames: nameMap([["ins-1", "רוני"]]),
    }),
  );
  // Duplicate display names are preserved: a name is not identity.
  assert.deepEqual(dto.rows[0].examineeNames, ["דנה", "דנה"]);
  assert.equal(dto.rows[0].examineeCount, 2);
  assert.deepEqual(dto.rows[0].supervisorNames, ["רוני"]);
  const strings = deepStrings(dto);
  assert.equal(strings.includes("stu-1"), false, "a student id reached the DTO");
  assert.equal(strings.includes("ins-1"), false, "an instructor id reached the DTO");
});

test("28. an unresolved name stays absent while the count stays authoritative", async () => {
  const spies = makeSpies();
  const dto = await readAdminExamPlanWithDeps(
    "o",
    adminDeps(spies, {
      payload: makePayload({
        sessions: [
          storedSession({
            examineeStudentIds: ["stu-1", "stu-unknown", "stu-2"],
            instructedTraineeStudentIds: [],
          }),
        ],
      }),
      studentNames: nameMap([
        ["stu-1", "דנה"],
        ["stu-2", "  "],
      ]),
    }),
  );
  assert.deepEqual(dto.rows[0].examineeNames, ["דנה"]);
  assert.equal(dto.rows[0].examineeCount, 3);
  assert.equal(deepStrings(dto).includes("stu-unknown"), false);
});

test("29. 1, 5 and 40 sessions keep identical loader and name-query counts", async () => {
  for (const size of [1, 5, 40]) {
    const spies = makeSpies();
    const sessions = Array.from({ length: size }, (_unused, index) =>
      storedSession({
        sessionId: `s${index}`,
        examineeStudentIds: [`stu-${index}`],
        instructedTraineeStudentIds: [],
      }),
    );
    await readAdminExamPlanWithDeps(
      "o",
      adminDeps(spies, {
        payload: makePayload({
          sessions,
          conflictSessions: sessions.map((session) =>
            conflictSession(session.sessionId, { supervisorIds: [`ins-${session.sessionId}`] }),
          ),
        }),
      }),
    );
    assert.equal(spies.loadInputs.length, 1, `size ${size}: loader calls`);
    assert.equal(spies.studentIdBatches.length, 1, `size ${size}: student batches`);
    assert.equal(spies.instructorIdBatches.length, 1, `size ${size}: instructor batches`);
    assert.equal(spies.studentIdBatches[0].length, size);
  }

  // ...and the trainee reader stays at one loader call and one student batch.
  for (const size of [1, 5, 40]) {
    const spies = makeSpies();
    const sessions = Array.from({ length: size }, (_unused, index) =>
      storedSession({ sessionId: `s${index}`, examineeStudentIds: [`stu-${index}`] }),
    );
    await readTraineeExamDayWithDeps(
      DATE,
      traineeDeps(spies, {
        studentId: "stu-0",
        payload: makePayload({
          sessions,
          storedDetails: new Map(
            sessions.map((session, index) => [
              session.sessionId,
              storedDetail(session.sessionId, `stu-${index}`),
            ]),
          ),
        }),
      }),
    );
    assert.equal(spies.loadInputs.length, 1, `trainee size ${size}: loader calls`);
    assert.equal(spies.studentIdBatches.length, 1, `trainee size ${size}: student batches`);
    assert.equal(spies.instructorIdBatches.length, 0, `trainee size ${size}: instructor batches`);
  }
});

// ===========================================================================
// 30–33. Draft and publication visibility per role
// ===========================================================================

test("30. an admin sees a DRAFT plan", async () => {
  const spies = makeSpies();
  const dto = await readAdminExamPlanWithDeps(
    "o",
    adminDeps(spies, {
      payload: makePayload({ publishedAt: null, sessions: [storedSession()] }),
    }),
  );
  assert.equal(spies.loadInputs[0].options.requirePlanPublication, false);
  assert.equal(dto.isPublished, false);
  assert.equal(dto.rows.length, 1);
});

test("31. an instructor sees a DRAFT plan", async () => {
  const spies = makeSpies();
  const dto = await readInstructorExamPlanWithDeps(
    "req",
    instructorDeps(spies, {
      payload: makePayload({ publishedAt: null, sessions: [storedSession()] }),
    }),
  );
  assert.equal(spies.loadInputs[0].options.requirePlanPublication, false);
  assert.equal(dto.viewerRole, "INSTRUCTOR");
  assert.equal(dto.rows.length, 1);
});

test("32. a trainee can never ask for a draft plan", async () => {
  const spies = makeSpies();
  await readTraineeExamDayWithDeps(DATE, traineeDeps(spies));
  assert.equal(spies.loadInputs[0].options.requirePlanPublication, true);
  // The gate is the LOADER's, applied before any content query: the loader
  // returns the empty payload for a draft plan, so no row exists to narrow.
  const draft = makeSpies();
  const dto = await readTraineeExamDayWithDeps(
    DATE,
    traineeDeps(draft, { payload: makePayload({ planId: null, publishedAt: null }) }),
  );
  assert.deepEqual(dto, emptyTraineeExamDayDto());
});

test("33. a trainee can never ask for unpublished beginner lessons", async () => {
  const spies = makeSpies();
  await readTraineeExamDayWithDeps(DATE, traineeDeps(spies));
  assert.equal(spies.loadInputs[0].options.requireLessonPublication, true);
});

// ===========================================================================
// 34–38. What a caller may supply, and what it gets back
// ===========================================================================

test("34–36. no reader accepts options, a plan id or an actor id", () => {
  const readers = stripComments(readFileSync(READERS_PATH, "utf8"));
  const signatures = [
    ...readers.matchAll(/export async function (\w+)\(([\s\S]*?)\):/g),
  ].map(([, name, params]) => ({ name, params: params.replace(/\s+/g, " ").trim() }));
  assert.deepEqual(
    signatures.map((s) => s.name),
    // RE-POINTED by EX-ADMIN-WORKSPACE-UX (BLOCKER-1). The three ROLE readings are
    // unchanged; the fourth is ADMIN-ONLY and returns no DTO at all — it publishes
    // assignment ids and the DERIVED moments this same pipeline already computed,
    // so the admin schedule can reuse them instead of reproducing them. No shared
    // DTO gained a field and no role reading changed shape.
    //
    // RE-POINTED AGAIN by EX-TRAINEE-MULTIDAY-READ, additively: a FIFTH reader
    // returns the trainee's WHOLE published schedule in one load, so the date
    // sub-tabs can offer the plan's real dates instead of the single day that
    // had just been fetched. The day reader is KEPT beside it — it is committed
    // public API and a single-day reading stays legitimate. No shared DTO gained
    // a field: the new reader returns the SAME `TraineeExamDayDto` (asserted in
    // M13), under the SAME authorization order and the SAME locked publication
    // options (M5, M6).
    [
      "readAdminExamPlan",
      "readAdminExamWaveView",
      "readInstructorExamPlan",
      "readTraineeExamDay",
      "readTraineeExamSchedule",
    ],
  );
  for (const { name, params } of signatures) {
    for (const forbidden of [
      "planId",
      "studentId",
      "instructorId",
      "viewerStudentId",
      "requirePlanPublication",
      "requireLessonPublication",
      "options",
      "deps",
    ]) {
      assert.equal(params.includes(forbidden), false, `${name} accepts ${forbidden}`);
    }
  }
  // Indexed by NAME rather than by position: BLOCKER-1 appends a fourth reader
  // between the first and the second in source order, and a positional assertion
  // would then be describing a different function than it names.
  const paramsOf = (name: string): string =>
    signatures.find((entry) => entry.name === name)?.params ?? "";
  assert.equal(paramsOf("read" + "AdminExamPlan"), "courseOfferingId: string,");
  assert.equal(paramsOf("read" + "InstructorExamPlan"), "requestedCourseOfferingId: string,");
  assert.equal(paramsOf("read" + "TraineeExamDay"), "selectedDate: string,");
  // The FIFTH takes NOTHING AT ALL — the strongest form of this whole test's
  // claim, since there is no caller-supplied value left to inspect.
  assert.equal(paramsOf("read" + "TraineeExamSchedule"), "");
  // The fourth takes ONE course offering id and nothing else — no options, no
  // plan id, no actor id, which the loop above already re-checks by name.
  assert.equal(paramsOf("read" + "AdminExamWaveView"), "courseOfferingId: string,");
});

test("37. no returned DTO contains a Map, Set, Date or class instance", async () => {
  const admin = await readAdminExamPlanWithDeps("o", adminDeps(makeSpies()));
  const instructor = await readInstructorExamPlanWithDeps("r", instructorDeps(makeSpies()));
  const trainee = await readTraineeExamDayWithDeps(
    DATE,
    traineeDeps(makeSpies(), { studentId: "stu-1" }),
  );
  for (const [name, dto] of [
    ["admin", admin],
    ["instructor", instructor],
    ["trainee", trainee],
    ["empty admin", emptyAdminExamReadDto()],
    ["empty instructor", emptyInstructorExamReadDto()],
    ["empty trainee", emptyTraineeExamDayDto()],
  ] as const) {
    assert.deepEqual(findNonPlainJsonPaths(dto), [], `${name} is not plain JSON`);
  }
});

test("38. every returned DTO survives a JSON round trip unchanged", async () => {
  const trainee = await readTraineeExamDayWithDeps(
    DATE,
    traineeDeps(makeSpies(), { studentId: "stu-1" }),
  );
  const admin = await readAdminExamPlanWithDeps("o", adminDeps(makeSpies()));
  for (const dto of [trainee, admin, emptyTraineeExamDayDto(), emptyAdminExamReadDto()]) {
    assert.deepEqual(JSON.parse(JSON.stringify(dto)), dto);
  }
});

// ===========================================================================
// 39–41. Failures that must NOT become empty results
// ===========================================================================

test("39. an unexpected loader failure propagates for every role", async () => {
  const boom = new InfrastructureError();
  const failing = { loadPlan: async () => { throw boom; } };

  await assert.rejects(
    () => readAdminExamPlanWithDeps("o", { ...adminDeps(makeSpies()), ...failing }),
    InfrastructureError,
  );
  await assert.rejects(
    () => readInstructorExamPlanWithDeps("r", { ...instructorDeps(makeSpies()), ...failing }),
    InfrastructureError,
  );
  await assert.rejects(
    () => readTraineeExamDayWithDeps(DATE, { ...traineeDeps(makeSpies()), ...failing }),
    InfrastructureError,
  );
});

test("40. an unexpected name-lookup failure propagates", async () => {
  await assert.rejects(
    () =>
      readAdminExamPlanWithDeps(
        "o",
        adminDeps(makeSpies(), {
          onStudentNames: async () => {
            throw new InfrastructureError("name lookup down");
          },
        }),
      ),
    InfrastructureError,
  );
  await assert.rejects(
    () =>
      readTraineeExamDayWithDeps(
        DATE,
        traineeDeps(makeSpies(), {
          studentId: "stu-1",
          onStudentNames: async () => {
            throw new InfrastructureError("name lookup down");
          },
        }),
      ),
    InfrastructureError,
  );
});

test("41. ONLY a classified denial becomes an empty result", async () => {
  // The same failure shape: denied when the predicate says so, propagated when
  // it does not. Nothing else in the reader decides.
  const denied = await readInstructorExamPlanWithDeps(
    "r",
    instructorDeps(makeSpies(), {
      courseError: new InfrastructureError(),
      isDenial: (error) => error instanceof InfrastructureError,
    }),
  );
  assert.deepEqual(denied, emptyInstructorExamReadDto());

  await assert.rejects(
    () =>
      readInstructorExamPlanWithDeps(
        "r",
        instructorDeps(makeSpies(), {
          courseError: new InfrastructureError(),
          isDenial: () => false,
        }),
      ),
    InfrastructureError,
  );

  // An admin path classifies nothing at all: its helper's failures are the
  // project's existing admin conventions and must reach the surface unchanged.
  await assert.rejects(
    () =>
      readAdminExamPlanWithDeps(
        "o",
        adminDeps(makeSpies(), {
          requireAdminCourseOffering: async () => {
            throw new InfrastructureError("NEXT_REDIRECT / not found");
          },
        }),
      ),
    InfrastructureError,
  );
});

// ===========================================================================
// New 1–7. Beginner participants, and the trainee instructor-query count
// ===========================================================================

test("N1. projected beginner trainee ids join the SAME single student batch", async () => {
  const spies = makeSpies();
  const dto = await readAdminExamPlanWithDeps(
    "o",
    adminDeps(spies, {
      payload: makePayload({
        sessions: [storedSession(), beginnerSession()],
        beginnerDetails: new Map([
          ["tp:l1", beginnerDetail({ participants: [participant("stu-2"), participant("stu-7")] })],
        ]),
        conflictSessions: [conflictSession("s1", { supervisorIds: [] })],
      }),
      studentNames: nameMap([
        ["stu-1", "דנה"],
        ["stu-2", "נועה"],
        ["stu-7", "יעל"],
      ]),
    }),
  );
  assert.equal(spies.studentIdBatches.length, 1, "beginner ids must not add a second batch");
  assert.deepEqual(spies.studentIdBatches[0], ["stu-1", "stu-2", "stu-3", "stu-7"]);
  const beginnerRow = dto.rows.find((row) => row.source === "BEGINNER");
  assert.deepEqual(beginnerRow?.beginner?.participantNames, ["נועה", "יעל"]);
  assert.equal(beginnerRow?.beginner?.participantCount, 2);
  // The authoritative name won; the denormalized source copy is never identity.
  assert.equal(deepStrings(dto).includes("שם מקור stu-2"), false);
});

test("N2. a REJECTED beginner participant joins neither the batch nor the DTO", async () => {
  const spies = makeSpies();
  const dto = await readAdminExamPlanWithDeps(
    "o",
    adminDeps(spies, {
      payload: makePayload({
        sessions: [beginnerSession()],
        beginnerDetails: new Map([
          [
            "tp:l1",
            beginnerDetail({
              participants: [
                participant("stu-2", { isProjected: true }),
                participant("stu-rejected", { isProjected: false }),
              ],
            }),
          ],
        ]),
      }),
      studentNames: nameMap([["stu-2", "נועה"]]),
    }),
  );
  assert.deepEqual(spies.studentIdBatches[0], ["stu-2"]);
  assert.equal(spies.studentIdBatches[0].includes("stu-rejected"), false);
  assert.equal(dto.rows[0].beginner?.participantCount, 1);
  assert.deepEqual(dto.rows[0].beginner?.participantNames, ["נועה"]);
});

test("N3. an UNPUBLISHED beginner lesson contributes no id to a trainee batch", async () => {
  // The loader applies `requireLessonPublication` BEFORE projection, so an
  // unpublished lesson reaches the trainee payload as no session at all.
  const spies = makeSpies();
  await readTraineeExamDayWithDeps(
    DATE,
    traineeDeps(spies, {
      studentId: "stu-1",
      payload: makePayload({
        // exactly what the loader returns for a published-only trainee read
        sessions: [storedSession({ instructedTraineeStudentIds: [] })],
        storedDetails: new Map([["s1", storedDetail("s1", "stu-1")]]),
        beginnerDetails: new Map([
          ["tp:l1", beginnerDetail({ isPublished: false, participants: [participant("stu-hidden")] })],
        ]),
      }),
    }),
  );
  assert.deepEqual(spies.studentIdBatches[0], ["stu-1"]);
  assert.equal(spies.studentIdBatches[0].includes("stu-hidden"), false);
});

test("N4. an OFF-DATE beginner participant joins no trainee batch", async () => {
  const spies = makeSpies();
  const dto = await readTraineeExamDayWithDeps(
    DATE,
    traineeDeps(spies, {
      studentId: "stu-1",
      payload: makePayload({
        sessions: [
          storedSession({ instructedTraineeStudentIds: [] }),
          beginnerSession({ sessionId: "tp:other", date: OTHER_DATE }),
        ],
        storedDetails: new Map([["s1", storedDetail("s1", "stu-1")]]),
        beginnerDetails: new Map([
          ["tp:other", beginnerDetail({ sessionId: "tp:other", date: OTHER_DATE, participants: [participant("stu-offday")] })],
        ]),
      }),
    }),
  );
  assert.deepEqual(spies.studentIdBatches[0], ["stu-1"]);
  assert.equal(
    traineeRow(dto.allRows, "tp:other") !== undefined,
    false,
  );
});

test("N5. the trainee reader performs ZERO instructor-name calls", async () => {
  const spies = makeSpies();
  const dto = await readTraineeExamDayWithDeps(
    DATE,
    traineeDeps(spies, { studentId: "stu-1" }),
  );
  assert.equal(spies.instructorIdBatches.length, 0);
  assert.equal(spies.order.includes("instructor-names"), false);
  // The responsible instructor is still shown — from the committed fallback.
  const beginnerRow = dto.allRows.find((row) => row.source === "BEGINNER");
  assert.equal(beginnerRow?.beginner?.responsibleInstructorName, "שם מדריכה מהמקור");
  // ...and the id behind it never appears.
  assert.equal(deepStrings(dto).includes("ins-9"), false);
});

test("N6. admin and instructor perform AT MOST one instructor-name call", async () => {
  for (const run of [
    async (spies: Spies) => readAdminExamPlanWithDeps("o", adminDeps(spies)),
    async (spies: Spies) => readInstructorExamPlanWithDeps("r", instructorDeps(spies)),
  ]) {
    const spies = makeSpies();
    await run(spies);
    assert.equal(spies.instructorIdBatches.length, 1);
    // Supervisors AND the beginner row's responsible instructor, in ONE batch.
    assert.deepEqual(spies.instructorIdBatches[0], ["ins-1", "ins-9"]);
  }
});

test("N7. a missing trainee instructor display name stays unresolved, with no lookup", async () => {
  const spies = makeSpies();
  const dto = await readTraineeExamDayWithDeps(
    DATE,
    traineeDeps(spies, {
      studentId: "stu-1",
      payload: makePayload({
        sessions: [beginnerSession()],
        beginnerDetails: new Map([
          ["tp:l1", beginnerDetail({ responsibleInstructorName: "   " })],
        ]),
      }),
    }),
  );
  assert.equal(dto.allRows[0].beginner?.responsibleInstructorName, null);
  assert.equal(spies.instructorIdBatches.length, 0);
});

// ===========================================================================
// Privacy: what may never reach a trainee
// ===========================================================================

test("no foreign Student.id, stored slot, conflict field or payload reaches a trainee", async () => {
  const spies = makeSpies();
  const payload = makePayload({
    sessions: [storedSession(), beginnerSession()],
    storedDetails: new Map([["s1", storedDetail("s1", "stu-1")]]),
    beginnerDetails: new Map([["tp:l1", beginnerDetail()]]),
    conflictSessions: [
      conflictSession("s1", { supervisorIds: ["ins-secret"], horseIds: ["horse-secret"] }),
    ],
  });
  const dto = await readTraineeExamDayWithDeps(
    DATE,
    traineeDeps(spies, { studentId: "stu-1", payload }),
  );
  const serialized = JSON.stringify(dto);
  for (const token of [
    "stu-1",
    "stu-2",
    "stu-3",
    "ins-9",
    "ins-secret",
    "horse-secret",
    "s1-a1",
    "plan-1",
    "supervisor",
    "slots",
    "assignmentId",
    "viewerStudentId",
  ]) {
    assert.equal(serialized.includes(token), false, `the trainee DTO leaks ${token}`);
  }
  // The row is the viewer's own, so the self flags ARE present — as booleans and
  // times, never as an id to compare.
  assert.equal(dto.myRows.length, 1);
  assert.equal(dto.myRows[0].selfStartTime, "09:00");
});

test("the collectors read only the visible rows", () => {
  const sessions = [storedSession(), beginnerSession()];
  const details = new Map([["tp:l1", beginnerDetail()]]);
  assert.deepEqual(collectExamStudentDisplayIds(sessions, details), [
    "stu-1",
    "stu-2",
    "stu-3",
  ]);
  // A detail whose own sessionId disagrees is not read at all — fail closed.
  assert.deepEqual(
    collectExamStudentDisplayIds(
      [beginnerSession({ examineeStudentIds: [] })],
      new Map([["tp:l1", beginnerDetail({ sessionId: "tp:other" })]]),
    ),
    [],
  );
  // A supervisor of a session that is NOT visible is never asked about.
  assert.deepEqual(
    collectExamInstructorDisplayIds(
      [storedSession()],
      [conflictSession("s1", { supervisorIds: ["ins-1"] }), conflictSession("hidden", { supervisorIds: ["ins-hidden"] })],
      new Map(),
    ),
    ["ins-1"],
  );
  // Malformed input never throws and never widens.
  assert.deepEqual(collectExamStudentDisplayIds(null, null), []);
  assert.deepEqual(collectExamInstructorDisplayIds(undefined, undefined, undefined), []);
});

// ===========================================================================
// 42–50 + New 8–10. Structural guards
// ===========================================================================

const SCOPE_SOURCE = readFileSync(SCOPE_PATH, "utf8");
const READERS_SOURCE = readFileSync(READERS_PATH, "utf8");
const IO_SOURCE = readFileSync(IO_PATH, "utf8");
const SCOPE_CODE = stripComments(SCOPE_SOURCE);
const READERS_CODE = stripComments(READERS_SOURCE);
const IO_CODE = stripComments(IO_SOURCE);

/** Assembled from split literals so the sibling exam-slice guards stay green. */
const PRISMA_MODULE = ["@/lib", "prisma"].join("/");
const GENERATED_CLIENT = ["@prisma", "client"].join("/");
const ENV_READ = ["process", "env"].join(".");
const DB_URL = ["DATABASE", "URL"].join("_");
const LOADER_CALL = new RegExp("\\bload" + "ExamPlan\\s*\\(");
const DTO_TOKENS = new RegExp(
  ["exam-read-" + "dto", "build" + "AdminExamReadDto", "build" + "TraineeExamDayDto"].join("|"),
);

test("42. no capability of any kind is consulted", () => {
  for (const [name, code] of [
    ["exam-read-scope-core.ts", SCOPE_CODE],
    ["exam-role-readers.ts", READERS_CODE],
  ] as const) {
    for (const token of [
      "CapabilityKey",
      "getEffectiveCapabilities",
      "EffectiveCapability",
      "capability-keys",
      "TEACHING_PRACTICE",
      "SCHEDULE",
      '"EXAMS"',
      "'EXAMS'",
    ]) {
      assert.equal(code.includes(token), false, `${name} consults ${token}`);
    }
  }
  // ...and the absence is DOCUMENTED, so the next reader is not left guessing.
  const comments = commentsOf(SCOPE_SOURCE) + commentsOf(READERS_SOURCE);
  assert.ok(/EXAMS/.test(comments), "the missing EXAMS capability is undocumented");
  assert.ok(/revisit/i.test(comments), "the future revisit is undocumented");
  assert.ok(/ACTIVE instructor/i.test(comments), "the temporary boundary is undocumented");
});

test("43. no source file of this slice is a Server Action module", () => {
  for (const [name, code] of [
    ["exam-read-scope-core.ts", SCOPE_CODE],
    ["exam-role-readers.ts", READERS_CODE],
    ["exam-read-io.ts", IO_CODE],
  ] as const) {
    assert.equal(code.includes('"use server"'), false, `${name} declares use server`);
    assert.equal(code.includes("'use server'"), false, `${name} declares use server`);
  }
});

/** The side-effect marker import, split so this suite never matches itself. */
const SERVER_ONLY_IMPORT = new RegExp('import\\s+"server' + '-only";');
/** The module specifiers of this slice's two SERVER modules. */
const SERVER_MODULE_SPECIFIERS = /exam-read-io|exam-role-readers/;

test("both server modules declare server-only; the pure core deliberately does not", () => {
  // The repository's existing convention (lib/course/capabilities/
  // attendance-capability-resolver.ts, current-attendance-capability.ts): the
  // marker import turns an accidental client import into a BUILD ERROR. It is a
  // DIFFERENT guarantee from the absence of "use server", which only keeps the
  // functions off the network.
  assert.ok(SERVER_ONLY_IMPORT.test(READERS_CODE), "exam-role-readers.ts is not server-only");
  assert.ok(SERVER_ONLY_IMPORT.test(IO_CODE), "exam-read-io.ts is not server-only");

  // The PURE core must NOT declare it: it holds no session, no Prisma and no IO,
  // and the marker would make it unimportable from a plain unit test — the
  // property that lets the whole authorization order be exercised without a
  // database or a request.
  assert.equal(
    SERVER_ONLY_IMPORT.test(SCOPE_CODE),
    false,
    "the pure scope core must stay environment-neutral and directly testable",
  );
  // Its purity is what makes that safe: no auth, no Prisma, no real IO binding.
  for (const token of ["exam-read-io", "exam-role-readers", "@/lib/", "server" + "-only"]) {
    assert.equal(SCOPE_CODE.includes(token), false, `the pure core references ${token}`);
  }
});

test("no client component imports either server module", () => {
  const offenders: string[] = [];
  let clientModules = 0;
  for (const dir of ["app", "lib", "components"]) {
    const root = join(REPO_ROOT, dir);
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!/\.tsx?$/.test(entry.name)) continue;
      const path = join(entry.parentPath ?? root, entry.name);
      if (path.includes(`${sep}generated${sep}`)) continue;
      const code = stripComments(readFileSync(path, "utf8"));
      // A client module is one whose FIRST statement is the directive — which is
      // the only position where it means anything. A file that merely mentions
      // the string in prose (this slice's own headers do) is not one.
      if (!/^\s*["']use client["']\s*;?/.test(code)) continue;
      clientModules += 1;
      if (SERVER_MODULE_SPECIFIERS.test(code) || DTO_TOKENS.test(code) || LOADER_CALL.test(code)) {
        offenders.push(path.slice(REPO_ROOT.length + 1));
      }
    }
  }
  // Sanity: the clean result below is a PASS, not an empty search.
  assert.ok(clientModules > 20, `expected the app's client components, found ${clientModules}`);
  assert.deepEqual(
    offenders,
    [],
    `a client component reaches the exam server modules: ${offenders.join(", ")}`,
  );
});

test("44. no write method exists in the readers or the IO shell", () => {
  const writes = /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/;
  for (const [name, code] of [
    ["exam-role-readers.ts", READERS_CODE],
    ["exam-read-io.ts", IO_CODE],
    ["exam-read-scope-core.ts", SCOPE_CODE],
  ] as const) {
    assert.equal(writes.test(code), false, `${name} performs a write`);
    for (const token of ["$executeRaw", "$transaction", "$queryRaw"]) {
      assert.equal(code.includes(token), false, `${name} uses ${token}`);
    }
  }
});

test("the scope core is PURE: no database, auth, course, clock or env access", () => {
  for (const token of [
    PRISMA_MODULE,
    GENERATED_CLIENT,
    "app/generated",
    "next/",
    "lib/auth",
    "lib/course",
    "getCurrentInstructor",
    "requireCurrentTrainee",
    "requireAdmin(",
    "cookies(",
    ENV_READ,
    "Date.now(",
    "new Date(",
    "Math.random(",
  ]) {
    assert.equal(SCOPE_CODE.includes(token), false, `the scope core references ${token}`);
  }
  // Every import is a SIBLING pure exam core; nothing is imported from outside.
  const specifiers = [...SCOPE_CODE.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(specifiers.length > 0, "sanity: the scope core imports the committed cores");
  for (const specifier of specifiers) {
    assert.ok(specifier.startsWith("./exam-"), `the scope core imports ${specifier}`);
  }
});

test("45–46 + N10. no app/, route, page or UI file consumes this slice", () => {
  const appRoot = join(REPO_ROOT, "app");
  const offenders: string[] = [];
  if (existsSync(appRoot)) {
    for (const entry of readdirSync(appRoot, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!/\.tsx?$/.test(entry.name)) continue;
      const path = join(entry.parentPath ?? appRoot, entry.name);
      if (path.includes(`${sep}generated${sep}`)) continue;
      const code = stripComments(readFileSync(path, "utf8"));
      if (
        /exam-role-readers|exam-read-scope-core/.test(code) ||
        /\bread(Admin|Instructor)ExamPlan\s*\(|\breadTraineeExamDay\s*\(/.test(code) ||
        LOADER_CALL.test(code) ||
        DTO_TOKENS.test(code)
      ) {
        offenders.push(path.slice(REPO_ROOT.length + 1));
      }
    }
  }
    // RE-POINTED by EX-ADMIN-WORKSPACE-UX (BLOCKER-1), and NARROWED rather than
  // dropped. The claim was that NO app file consumes this pipeline, which held
  // while every surface derived its own times. The admin exams workspace no
  // longer does: it reads the committed derivation through the ONE admin-only
  // wave export, which is precisely how the admin schedule is kept identical to
  // what instructors and trainees are shown. So exactly ONE route may appear —
  // its page and its own contract suite — and any other app consumer still fails.
  const APPROVED_APP_CONSUMERS = [
    ["app", "admin", "courses", "[courseOfferingId]", "exams", "page.tsx"].join(sep),
    ["app", "admin", "courses", "[courseOfferingId]", "exams", "exam-workspace.contract.test.ts"].join(sep),
  ];
  const unapprovedAppConsumers = offenders.filter(
    (path) => !APPROVED_APP_CONSUMERS.includes(path),
  );
  assert.deepEqual(unapprovedAppConsumers, [], `EX-S5A-4B adds no app caller; found: ${offenders.join(", ")}`);
  // No exam route or page directory was created either.
  for (const dir of ["app/admin/exams", "app/instructor/exams", "app/student/exams"]) {
    assert.equal(existsSync(join(REPO_ROOT, dir)), false, `${dir} was created`);
  }
});

test("47. the cross-course source-date limitation remains documented", () => {
  for (const [name, comments] of [
    ["exam-read-scope-core.ts", commentsOf(SCOPE_SOURCE)],
    ["exam-role-readers.ts", commentsOf(READERS_SOURCE)],
  ] as const) {
    const flat = comments.replace(/\s+/g, " ");
    assert.ok(/no\s+`?courseOfferingId`?/i.test(flat), `${name}: the schema gap is undocumented`);
    assert.ok(/MUST NOT BE DEPLOYED/i.test(flat), `${name}: the deployment rule is missing`);
    assert.ok(
      /SEPARATE,? REVIEWED CONTAINMENT DECISION/i.test(flat),
      `${name}: the required decision is missing`,
    );
    assert.ok(/source date/i.test(flat), `${name}: source dates are not named`);
  }
});

test("48–49. no committed core, DTO, loader, auth or course resolver was modified", () => {
  // The committed pure cores know nothing about this slice: a change to them
  // would have had to name it.
  for (const path of [DTO_PATH, LOADER_PATH]) {
    const source = readFileSync(path, "utf8");
    assert.equal(source.includes("exam-read-scope-core"), false, `${path} was rewired`);
    assert.equal(source.includes("exam-role-readers"), false, `${path} was rewired`);
  }
  // ...and neither do the auth and course resolvers this slice CONSUMES.
  for (const relative of [
    ["lib", "auth", "actor.ts"],
    ["lib", "auth", "actor-types.ts"],
    ["lib", "course", "actor-course-offering.ts"],
    ["lib", "course", "actor-course-offering-core.ts"],
    ["lib", "course", "admin-course-context.ts"],
  ]) {
    const source = readFileSync(join(REPO_ROOT, ...relative), "utf8");
    assert.equal(/exam/i.test(source), false, `${relative.join("/")} now mentions the exam slice`);
  }
});

test("50. this suite performs no production access", () => {
  const own = stripComments(readFileSync(SCOPE_TEST_PATH, "utf8"));
  for (const token of [PRISMA_MODULE, GENERATED_CLIENT, ENV_READ, DB_URL]) {
    assert.equal(own.includes(token), false, `the suite references ${token}`);
  }
  // It reads sources and injects fakes; it never imports a module that connects.
  const specifiers = [...own.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  for (const specifier of specifiers) {
    assert.ok(
      specifier.startsWith("./exam-") || specifier.startsWith("node:"),
      `the suite imports ${specifier}`,
    );
  }
});

test("N8. the approved six-file scope is exactly what exists", () => {
  for (const path of [SCOPE_PATH, SCOPE_TEST_PATH, READERS_PATH, IO_PATH]) {
    assert.ok(existsSync(path), `missing ${path}`);
  }
  for (const path of [
    join(REPO_ROOT, "lib", "exam", "exam-plan-loader-core.test.ts"),
    join(REPO_ROOT, "lib", "exam", "exam-read-dto.test.ts"),
  ]) {
    assert.ok(existsSync(path), `missing ${path}`);
  }
});

test("N9. the loader has exactly ONE production caller, and it is the binding", () => {
  const callers: string[] = [];
  for (const dir of ["app", "lib"]) {
    const root = join(REPO_ROOT, dir);
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!/\.tsx?$/.test(entry.name)) continue;
      const path = join(entry.parentPath ?? root, entry.name);
      if (path.includes(`${sep}generated${sep}`)) continue;
      if (/\.test\.tsx?$/.test(entry.name)) continue;
      if (path === join(REPO_ROOT, "lib", "exam", "exam-plan-loader-core.ts")) continue;
      if (LOADER_CALL.test(stripComments(readFileSync(path, "utf8")))) {
        callers.push(path.slice(REPO_ROOT.length + 1));
      }
    }
  }
  assert.deepEqual(callers, [join("lib", "actions", "exam-role-readers.ts")]);
  // ...and the binding reaches the payload ONLY through the pure scope core.
  assert.ok(READERS_CODE.includes("readAdminExamPlanWithDeps"));
  assert.ok(READERS_CODE.includes("readInstructorExamPlanWithDeps"));
  assert.ok(READERS_CODE.includes("readTraineeExamDayWithDeps"));
  assert.equal(DTO_TOKENS.test(READERS_CODE), false, "the binding narrows on its own");
});

test("the IO name lookups are batched, two-column and write nothing", () => {
  // ONE query per entity, each short-circuiting on an empty id set.
  assert.ok(IO_CODE.includes("prisma.student.findMany"));
  assert.ok(IO_CODE.includes("prisma.instructor.findMany"));
  assert.equal((IO_CODE.match(/prisma\.student\./g) ?? []).length, 1);
  assert.equal((IO_CODE.match(/prisma\.instructor\./g) ?? []).length, 1);
  assert.equal((IO_CODE.match(/normalized\.length === 0/g) ?? []).length, 2);
  // The select is exactly two columns, and identity is never a name.
  assert.equal((IO_CODE.match(/select: \{ id: true, fullName: true \}/g) ?? []).length, 2);
  for (const token of [
    "nationalId",
    "email",
    "phone",
    "parentPhone",
    "authUser",
    "enrollments",
    "groupName",
    "isActive",
  ]) {
    const region = IO_CODE.slice(IO_CODE.indexOf("normalizeDisplayNameIds"));
    assert.equal(region.includes(token), false, `the name lookups select ${token}`);
  }
  // Display names are trimmed; the authoritative id is used verbatim.
  assert.ok(IO_CODE.includes("row.fullName.trim()"));
});

// ===========================================================================
// EX-TRAINEE-MULTIDAY-READ — the trainee's WHOLE schedule, in ONE load
// ===========================================================================

const THIRD_DATE = "2026-08-01";

/**
 * A plan spanning THREE dates, deliberately built OUT of chronological order so
 * nothing downstream can pass by accidentally preserving the input order.
 *
 * `THIRD_DATE` is the earliest and appears LAST; `OTHER_DATE` carries a live
 * beginner row at 08:00 and a stored block at 14:00, so the interleaving of the
 * two kinds is observable on a single date.
 */
function multiDatePayload(): ExamPlanPayload {
  return makePayload({
    sessions: [
      storedSession({ sessionId: "s-mid", date: DATE, startTime: "09:00" }),
      storedSession({ sessionId: "s-late", date: OTHER_DATE, startTime: "14:00", orderIndex: 5 }),
      beginnerSession({
        sessionId: "tp:early",
        date: OTHER_DATE,
        startTime: "08:00",
        endTime: "09:00",
        orderIndex: 1,
      }),
      storedSession({
        sessionId: "s-first",
        date: THIRD_DATE,
        startTime: "07:30",
        // Somebody ELSE's block, consistently: the participant lists and the
        // slot detail agree, so it is visible to everyone and personal to
        // nobody but stu-9.
        examineeStudentIds: ["stu-9"],
        instructedTraineeStudentIds: [],
      }),
    ],
    storedDetails: new Map([
      ["s-mid", storedDetail("s-mid", "stu-1")],
      ["s-late", storedDetail("s-late", "stu-1")],
      ["s-first", storedDetail("s-first", "stu-9")],
    ]),
    beginnerDetails: new Map([
      ["tp:early", beginnerDetail({ sessionId: "tp:early", date: OTHER_DATE })],
    ]),
    conflictSessions: [
      conflictSession("s-mid"),
      conflictSession("s-late"),
      conflictSession("s-first"),
    ],
    sourceDates: [OTHER_DATE],
  });
}

test("M1. the schedule reader takes NO argument at all, and the day reader is KEPT", () => {
  assert.equal(readTraineeExamScheduleWithDeps.length, 1); // (deps)
  assert.equal(readTraineeExamDayWithDeps.length, 2); // (selectedDate, deps)
  assert.equal(typeof readTraineeExamDayWithDeps, "function", "the day reader was removed");
});

test("M2. MULTIPLE published dates come back from ONE load", async () => {
  const spies = makeSpies();
  const dto = await readTraineeExamScheduleWithDeps(
    traineeDeps(spies, { studentId: "stu-1", payload: multiDatePayload() }),
  );
  // Every date the plan holds is represented, ascending...
  assert.deepEqual(
    [...new Set(dto.allRows.map((row) => row.date))],
    [THIRD_DATE, DATE, OTHER_DATE],
  );
  // ...and the plan was loaded EXACTLY ONCE, whatever the number of dates.
  assert.equal(spies.loadInputs.length, 1, "the reader loads once per date");
  assert.equal(spies.identityCalls, 1, "identity was resolved more than once");
  assert.equal(spies.courseCalls, 1, "the course was resolved more than once");
  // ...and the names were fetched in ONE batch, not one per date.
  assert.equal(spies.studentIdBatches.length, 1, "a name query was issued per date");
  assert.equal(
    spies.order.filter((step) => step === "instructor-names").length,
    0,
    "the trainee reader issued an instructor lookup",
  );
});

test("M3. rows are ordered by DATE ascending, then by the projection's own order", async () => {
  const spies = makeSpies();
  const dto = await readTraineeExamScheduleWithDeps(
    traineeDeps(spies, { studentId: "stu-1", payload: multiDatePayload() }),
  );
  const dates = dto.allRows.map((row) => row.date);
  assert.deepEqual([...dates].sort(), dates, "the dates are not ascending");
});

test("M4. a live beginner row and a stored block INTERLEAVE chronologically", async () => {
  const spies = makeSpies();
  const dto = await readTraineeExamScheduleWithDeps(
    traineeDeps(spies, { studentId: "stu-1", payload: multiDatePayload() }),
  );
  const onOtherDate = dto.allRows.filter((row) => row.date === OTHER_DATE);
  // 08:00 beginner BEFORE the 14:00 stored block — not a beginner section.
  assert.deepEqual(
    onOtherDate.map((row) => [row.startTime, row.source]),
    [
      ["08:00", "BEGINNER"],
      ["14:00", "STORED"],
    ],
  );
});

test("M5. the AUTHORIZATION ORDER is identical to the day reader's", async () => {
  const spies = makeSpies();
  await readTraineeExamScheduleWithDeps(traineeDeps(spies, { payload: multiDatePayload() }));
  // Identity, then the non-selectable course resolver, then the load. Never the
  // other way round, and never a load before either.
  assert.deepEqual(spies.order.slice(0, 3), ["trainee-identity", "trainee-course", "load"]);
});

test("M6. the LOCKED publication options are the day reader's, unchanged", async () => {
  const spies = makeSpies();
  await readTraineeExamScheduleWithDeps(
    traineeDeps(spies, { studentId: "stu-7", verifiedId: "offering-verified" }),
  );
  const input = spies.loadInputs[0];
  assert.equal(input.courseOfferingId, "offering-verified", "the load escaped the verified course");
  assert.equal(input.options.requirePlanPublication, true, "a draft plan became readable");
  assert.equal(input.options.requireLessonPublication, true, "a draft lesson became readable");
});

test("M7. an UNPUBLISHED plan still returns nothing at all", async () => {
  const spies = makeSpies();
  // The loader's own fail-closed answer to an unpublished plan: the empty payload.
  const dto = await readTraineeExamScheduleWithDeps(
    traineeDeps(spies, { payload: makePayload({ planId: null, publishedAt: null }) }),
  );
  assert.deepEqual(dto.allRows, []);
  assert.deepEqual(dto.myRows, []);
  // ...and it says nothing about a plan or its publication state.
  assert.deepEqual(Object.keys(dto).sort(), ["allRows", "myRows"]);
});

test("M8. every denial returns the SAME empty contract, and never throws", async () => {
  for (const options of [
    { identityError: new DenialError() },
    { courseError: new DenialError() },
    { studentId: "   " },
    { verifiedId: "   " },
  ]) {
    const spies = makeSpies();
    const dto = await readTraineeExamScheduleWithDeps(traineeDeps(spies, options));
    assert.deepEqual(dto.allRows, []);
    assert.deepEqual(dto.myRows, []);
  }
});

test("M9. a NON-denial failure propagates rather than reading as an empty schedule", async () => {
  const spies = makeSpies();
  await assert.rejects(
    () =>
      readTraineeExamScheduleWithDeps(
        traineeDeps(spies, { identityError: new Error("infrastructure"), isDenial: () => false }),
      ),
    /infrastructure/,
  );
});

test("M10. `myRows` is the SERVER's filter of `allRows`, sharing row identity", async () => {
  const spies = makeSpies();
  const dto = await readTraineeExamScheduleWithDeps(
    traineeDeps(spies, { studentId: "stu-1", payload: multiDatePayload() }),
  );
  assert.deepEqual(
    dto.myRows,
    dto.allRows.filter((row) => row.isSelf),
  );
  // The SAME objects, never a second mapping.
  for (const row of dto.myRows) {
    assert.ok(dto.allRows.includes(row), "a personal row is not an allRows row");
  }
  // The viewer is on two different dates, and the personal view keeps both.
  assert.deepEqual([...new Set(dto.myRows.map((row) => row.date))], [DATE, OTHER_DATE]);
  // ...and a row that is somebody else's is NOT theirs.
  assert.equal(
    dto.allRows.some((row) => row.date === THIRD_DATE && row.isSelf),
    false,
    "a row belonging to another trainee was marked as the viewer's",
  );
});

test("M11. `isSelf` follows the SIGNED SESSION's student id, not the request", async () => {
  const payload = multiDatePayload();
  const mine = await readTraineeExamScheduleWithDeps(
    traineeDeps(makeSpies(), { studentId: "stu-1", payload }),
  );
  const theirs = await readTraineeExamScheduleWithDeps(
    traineeDeps(makeSpies(), { studentId: "stu-9", payload }),
  );
  assert.notDeepEqual(
    mine.myRows.map((row) => row.date),
    theirs.myRows.map((row) => row.date),
  );
  // A stranger owns nothing, and the schedule itself is unchanged for them.
  const nobody = await readTraineeExamScheduleWithDeps(
    traineeDeps(makeSpies(), { studentId: "stu-nobody", payload }),
  );
  assert.deepEqual(nobody.myRows, []);
  assert.equal(nobody.allRows.length, mine.allRows.length);
});

test("M12. LEVEL 2 carries no beginner row, on any date", async () => {
  const spies = makeSpies();
  await readTraineeExamScheduleWithDeps(
    traineeDeps(spies, { courseLevel: 2, payload: multiDatePayload() }),
  );
  // The containment is the LOADER's, reached through the same locked option
  // producer: this reader states no beginner rule of its own.
  assert.equal(
    spies.loadInputs[0].options.beginnerSourceEnabled,
    false,
    "a Level 2 course asked the loader for beginner rows",
  );
  // ...and Level 1 still does.
  const level1 = makeSpies();
  await readTraineeExamScheduleWithDeps(
    traineeDeps(level1, { courseLevel: 1, payload: multiDatePayload() }),
  );
  assert.equal(level1.loadInputs[0].options.beginnerSourceEnabled, true);
});

test("M13. no id and no diagnostic is on the contract", async () => {
  const spies = makeSpies();
  const dto = await readTraineeExamScheduleWithDeps(
    traineeDeps(spies, { studentId: "stu-1", payload: multiDatePayload() }),
  );
  const serialized = JSON.stringify(dto);
  for (const token of [
    "planId",
    "studentId",
    "instructorId",
    "traineeId",
    "courseOfferingId",
    "viewerStudentId",
    "publishedAt",
    "diagnostics",
    "storedAdapterIssues",
    "loaderIssues",
  ]) {
    assert.equal(serialized.includes(token), false, `the contract carries ${token}`);
  }
  // `lessonId` and `sessionId` ARE on the committed trainee contract, and are
  // deliberately NOT asserted away here: this reader must return the very same
  // DTO the day reader returns, and narrowing it would be a second, disagreeing
  // trainee contract. That neither ever reaches a SCREEN is proven where it
  // belongs — in the beginner renderer's own suite and in the trainee section's
  // contract suite, both of which pin the exact rendered fields.
  const day = await readTraineeExamDayWithDeps(
    DATE,
    traineeDeps(makeSpies(), { studentId: "stu-1", payload: multiDatePayload() }),
  );
  assert.deepEqual(
    Object.keys(day).sort(),
    Object.keys(dto).sort(),
    "the schedule reader returns a different contract shape from the day reader",
  );
});

test("M14. the reader duplicates no timetable, pairing or ordering rule", () => {
  const body = SCOPE_CODE.slice(
    SCOPE_CODE.indexOf("export async function readTraineeExamScheduleWithDeps"),
  );
  for (const token of [
    "addMinutes",
    "parseInt",
    "pairingIndex",
    "resolvePairing",
    "derivedBlockEndTime",
    "timetableStatus",
    "new Date",
    "Date.now",
    ".sort(",
  ]) {
    assert.equal(body.includes(token), false, `the schedule reader re-implements ${token}`);
  }
  // The date list and the per-date projection are the COMMITTED cores.
  assert.ok(body.includes("listProjectionDates(payload.sessions)"));
  assert.ok(
    body.includes("projectTraineeExamDay(payload.sessions, payload.storedDetails, date, studentId)"),
  );
  assert.ok(body.includes("buildTraineeExamDayDto("));
  // Exactly ONE load call and ONE name fetch in the whole body.
  assert.equal((body.match(/deps\.loadPlan\(/g) ?? []).length, 1);
  assert.equal((body.match(/deps\.fetchStudentDisplayNames\(/g) ?? []).length, 1);
  // The plan's DECLARED source dates are deliberately not unioned in: a source
  // date with no visible row would advertise a day holding nothing.
  assert.equal(body.includes("sourceDates"), false, "the reader offers dates with no visible row");
});
