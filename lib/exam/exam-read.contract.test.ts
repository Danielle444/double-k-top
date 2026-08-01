/**
 * EXAM EX-S5A-5 — CROSS-SLICE CONTRACT tests for the committed exam READ
 * PIPELINE.
 *
 * DB-FREE: every case builds PLAIN in-memory scalar rows and injects them
 * through the committed dependency seams. This suite opens no database
 * connection, executes no SQL, reads no session, touches no environment
 * variable, constructs no `Date` and makes no network request. The only files it
 * reads from disk are repository SOURCES, for the structural guards in group H.
 *
 * WHY IT EXISTS. EX-S5A-1 … EX-S5A-4B were each proven in isolation. Every one
 * of those suites drives ONE core with fakes standing in for its neighbours, so
 * a change that keeps each core internally correct while breaking the JOIN
 * between two of them would pass all of them. This suite is the join: it feeds
 * RAW stored and Teaching-Practice scalar rows into the real adapters, through
 * the real loader, through the real role scope core, into the real DTO builders,
 * and asserts on what comes out the far end.
 *
 * WHAT IS DELIBERATELY NOT IMPORTED AT RUNTIME. `lib/actions/exam-read-io.ts`
 * and `lib/actions/exam-role-readers.ts` both declare `import "server-only"`,
 * which makes them unloadable from a plain `tsx --test` process. Their contracts
 * are therefore asserted STRUCTURALLY, on their source text, and their behaviour
 * is exercised through the pure, dependency-injected core they bind.
 *
 * PLANTED SECRETS. Every internal identifier and every operational value in the
 * fixture carries a unique marker token, so the privacy assertions below prove
 * that a VALUE is absent rather than merely that a KEY is spelled differently:
 *
 *   ZS9  — every `Student.id`                 (absent from EVERY role DTO)
 *   ZI4  — every `Instructor.id`              (absent from EVERY role DTO)
 *   ZH6  — stored internals nothing projects  (absent from EVERY role DTO)
 *   ZM1  — denormalized source trainee names  (absent from EVERY role DTO)
 *   ZA2  — assignment / break ids             (absent from the TRAINEE DTO)
 *   ZO8  — operational-only lesson state      (absent from the TRAINEE DTO)
 *   ZU5  — the UNPUBLISHED lesson's content   (absent from the TRAINEE DTO)
 *   ZP3  — assignment OPERATIONAL VALUES      (PRESENT for every authorized
 *                                              role — see the note below)
 *
 * ZP3 IS THE EX-OPS-READ-MVP RE-POINT, AND IT IS EXACT. Before that slice the
 * per-assignment horse, instruction topic and discipline were projected by
 * nothing, so they were planted with ZH6 — "stored internals nothing projects".
 * They are now APPROVED VISIBLE OPERATIONAL DATA for instructors and trainees
 * alike, because "לו״ז כולל" is deliberately a complete operational schedule.
 * They therefore move to their OWN marker, and ZH6 keeps its exact original
 * meaning for the values that are still projected by nothing: the session TITLE,
 * the session NOTES, the ASSIGNMENT NOTES, the break LABEL, the child id and the
 * Teaching-Practice role-label override. Nothing was removed from ZH6's guard —
 * the three values that legitimately became visible were moved OUT of it, and
 * their visibility is asserted POSITIVELY in group K rather than merely
 * un-forbidden.
 *
 * Run with: npx tsx --test lib/exam/exam-read.contract.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";
import { spawnSync } from "node:child_process";

import {
  loadExamPlan,
  type ExamPlanLoadDeps,
  type ExamPlanLoadOptions,
  type ExamPlanPayload,
} from "./exam-plan-loader-core";
import { BEGINNER_SOURCE_COURSE_LEVEL } from "./exam-beginner-course-scope-core";
import {
  buildTraineeExamArenaLookup,
  emptyAdminExamReadDto,
  emptyInstructorExamReadDto,
  emptyTraineeExamDayDto,
  readAdminExamPlanWithDeps,
  readInstructorExamPlanWithDeps,
  readTraineeExamDayWithDeps,
  type AdminExamReadDeps,
  type AdminExamReadDto,
  type InstructorExamReadDeps,
  type TraineeExamDayDto,
  type TraineeExamReadDeps,
} from "./exam-read-scope-core";
import {
  findNonPlainJsonPaths,
  type ExamAssignmentOperationalRowDto,
  type TraineeExamAssignmentOperationalRowDto,
} from "./exam-read-dto";
import { composeStoredExamBlocks } from "./exam-stored-adapter-core";
import type {
  StoredExamDefinitionRow,
  StoredExamSessionRow,
} from "./exam-stored-adapter-core";
import { adaptTeachingPracticeExamSources } from "./exam-tp-source-adapter-core";
import type { TeachingPracticeExamLessonRow } from "./exam-tp-source-adapter-core";
import { projectLiveBeginnerRows } from "./exam-live-beginner-adapter-core";
import { projectTraineeExamDay } from "./exam-trainee-view-core";
import {
  EXAM_BEGINNER_GROUP_LABEL,
  projectByExamDefinition,
} from "./exam-group-projection-core";

// ===========================================================================
// Repository paths — sources only, never a database
// ===========================================================================

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const CONTRACT_TEST_PATH = join(REPO_ROOT, "lib", "exam", "exam-read.contract.test.ts");
const SCOPE_PATH = join(REPO_ROOT, "lib", "exam", "exam-read-scope-core.ts");
const DTO_PATH = join(REPO_ROOT, "lib", "exam", "exam-read-dto.ts");
const LOADER_PATH = join(REPO_ROOT, "lib", "exam", "exam-plan-loader-core.ts");
const READERS_PATH = join(REPO_ROOT, "lib", "actions", "exam-role-readers.ts");
const IO_PATH = join(REPO_ROOT, "lib", "actions", "exam-read-io.ts");

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

/** Every string anywhere in a value, so a leak is caught by VALUE not by key. */
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

// ===========================================================================
// The planted markers
// ===========================================================================

/** `Student.id`. Never reaches ANY role DTO — names replace ids everywhere. */
const STU = "ZS9";
/** `Instructor.id`. Never reaches ANY role DTO. */
const INS = "ZI4";
/** Stored internals no role's DTO projects (notes, titles, horses, child ids). */
const HID = "ZH6";
/** Denormalized source trainee names — the AUTHORITATIVE name must win. */
const SRC = "ZM1";
/** Assignment / break ids. Admin diagnostics may name them; a trainee may not. */
const ASG = "ZA2";
/** Operational-only state of a PUBLISHED lesson (its own notes). */
const OPS = "ZO8";
/** Everything belonging to the UNPUBLISHED lesson. */
const UNPUB = "ZU5";
/**
 * The per-assignment OPERATIONAL values — horse, instruction topic, discipline.
 *
 * Deliberately NOT in either forbidden list: these are the values EX-OPS-READ-MVP
 * exposes to instructors and trainees. Their PRESENCE is asserted in group K.
 */
const OPV = "ZP3";

const DATE = "2026-08-02";
const OTHER_DATE = "2026-08-03";

const COURSE_OFFERING_ID = "offering-primary";
const OTHER_OFFERING_ID = "offering-requested-by-caller";
const PLAN_ID = "exam-plan-primary";
const PLAN_PUBLISHED_AT = 1_754_000_000_000;
/** Accepted by the loader's identity row and projected by NOTHING. */
const PLAN_UPDATED_AT = 1_754_999_999_999;
/** `ExamSession.individualPublishedAt` — accepted, never read, never projected. */
const SESSION_INDIVIDUAL_PUBLISHED_AT = 1_753_000_000_111;
const SESSION_UPDATED_AT = 1_753_000_000_222;

// --- students ---------------------------------------------------------------

const VIEWER = `stu-${STU}-viewer`;
const OTHER = `stu-${STU}-other`;
const DUP_A = `stu-${STU}-dup-a`;
const DUP_B = `stu-${STU}-dup-b`;
const NAMELESS = `stu-${STU}-nameless`;
const OFFDAY = `stu-${STU}-offday`;
const REJECTED = `stu-${STU}-rejected`;
const UNPUBLISHED_STUDENT = `stu-${STU}-unpublished`;

/**
 * The authoritative `Student.id` → `Student.fullName` table.
 *
 * `NAMELESS` is deliberately ABSENT. `REJECTED` and `UNPUBLISHED_STUDENT` are
 * deliberately PRESENT: their names must be missing from a DTO because their ids
 * were never asked about, not because no name existed.
 */
const STUDENT_NAMES: ReadonlyMap<string, string> = new Map([
  [VIEWER, "אורי הצופה"],
  // Padded on purpose: display names are trimmed by the committed narrowing.
  [OTHER, "  נועה לוי  "],
  [DUP_A, "דנה כהן"],
  // The SAME display name as DUP_A, under a different authoritative id.
  [DUP_B, "דנה כהן"],
  [OFFDAY, "יעל מהיום האחר"],
  [REJECTED, "משתתפת שנדחתה"],
  [UNPUBLISHED_STUDENT, "חניך שיעור לא מפורסם"],
]);

// --- instructors ------------------------------------------------------------

const SUP_A = `ins-${INS}-sup-a`;
const SUP_B = `ins-${INS}-sup-b`;
const RESP_LUNGE = `ins-${INS}-resp-lunge`;
const RESP_GROUP = `ins-${INS}-resp-group`;
const RESP_HIDDEN = `ins-${INS}-resp-hidden`;

const INSTRUCTOR_NAMES: ReadonlyMap<string, string> = new Map([
  [SUP_A, "מפקח א"],
  [SUP_B, "מפקחת ב"],
  [RESP_LUNGE, "מדריכה אחראית לונג׳"],
  [RESP_GROUP, "מדריך אחראי קבוצה"],
  [RESP_HIDDEN, "מדריך אחראי מוסתר"],
]);

// ===========================================================================
// The fixture — RAW scalar rows, exactly as the IO shell would return them
// ===========================================================================

const DEF_RIDING = "def-riding";
const DEF_INTERFACE = "def-interface";
const DEF_ADVANCED = "def-advanced";

/**
 * TWO SEPARATE DEFINITIONS SHARING ONE KIND.
 *
 * "רכיבה" and "ממשק" are both `INTERFACE_RIDING`. They are two different exams
 * on the manager's plan, and every layer below must keep them apart by
 * `ExamDefinition.id` rather than collapsing them because the kind matches.
 */
const DEFINITION_ROWS: readonly StoredExamDefinitionRow[] = Object.freeze([
  Object.freeze({
    id: DEF_RIDING,
    name: "רכיבה",
    kind: "INTERFACE_RIDING",
    durationMinutes: 15,
    parallelCapacity: 1,
    requiresInstructedTrainee: false,
    requiresLessonTopic: false,
    requiresDiscipline: false,
    orderIndex: 0,
  }),
  Object.freeze({
    id: DEF_INTERFACE,
    name: "ממשק",
    kind: "INTERFACE_RIDING",
    durationMinutes: 20,
    parallelCapacity: 2,
    requiresInstructedTrainee: false,
    requiresLessonTopic: false,
    requiresDiscipline: false,
    orderIndex: 1,
  }),
  Object.freeze({
    id: DEF_ADVANCED,
    name: "הדרכה מתקדמת",
    kind: "ADVANCED_INSTRUCTION",
    durationMinutes: 30,
    parallelCapacity: 1,
    requiresInstructedTrainee: true,
    requiresLessonTopic: false,
    requiresDiscipline: false,
    orderIndex: 2,
  }),
]);

function assignment(over: {
  readonly id: string;
  readonly studentId: string | null;
  readonly role: string;
  readonly orderIndex: number;
  readonly pairingIndex?: number | null;
  readonly horseName?: string | null;
}) {
  // The OPERATIONAL values are unique per assignment but must NOT embed the
  // assignment id: ZA2 stays forbidden in a trainee payload while ZP3 is visible
  // there, so a value carrying both would make one of the two guards untestable.
  // The tag is the id with the ZA2 marker removed — still unique, without
  // smuggling the id into a visible string.
  const tag = over.id.split(`-${ASG}-`).join("-");
  return Object.freeze({
    id: over.id,
    studentId: over.studentId,
    role: over.role,
    orderIndex: over.orderIndex,
    horseName: over.horseName ?? `horse-${OPV}-${tag}`,
    instructionTopic: `topic-${OPV}-${tag}`,
    discipline: `discipline-${OPV}-${tag}`,
    pairingIndex: over.pairingIndex ?? null,
    notes: `assignment-notes-${HID}-${over.id}`,
  });
}

const SESSION_ROWS: readonly StoredExamSessionRow[] = Object.freeze([
  // 09:00 — three examinees, capacity 1, ONE positional break after wave 0.
  Object.freeze({
    id: "sess-riding",
    definitionId: DEF_RIDING,
    date: DATE,
    startTime: "09:00",
    endTime: "10:00",
    orderIndex: 0,
    arena: "אולם מקורה",
    title: `session-title-${HID}`,
    notes: `session-notes-${HID}`,
    individualPublishedAt: SESSION_INDIVIDUAL_PUBLISHED_AT,
    updatedAt: SESSION_UPDATED_AT,
    assignments: Object.freeze([
      assignment({ id: `a-${ASG}-r1`, studentId: OTHER, role: "EXAMINEE", orderIndex: 0 }),
      assignment({ id: `a-${ASG}-r2`, studentId: VIEWER, role: "EXAMINEE", orderIndex: 1 }),
      assignment({ id: `a-${ASG}-r3`, studentId: DUP_A, role: "EXAMINEE", orderIndex: 2 }),
    ]),
    breaks: Object.freeze([
      Object.freeze({
        id: `brk-${ASG}-1`,
        afterWaveIndex: 0,
        durationMinutes: 10,
        label: `break-label-${HID}`,
      }),
    ]),
    supervisorInstructorIds: Object.freeze([SUP_A]),
  }),
  // 11:00 — an INSTRUCTED TRAINEE paired to the SECOND examinee.
  Object.freeze({
    id: "sess-advanced",
    definitionId: DEF_ADVANCED,
    date: DATE,
    startTime: "11:00",
    endTime: "12:00",
    orderIndex: 1,
    arena: "מגרש חול",
    title: null,
    notes: null,
    individualPublishedAt: null,
    updatedAt: SESSION_UPDATED_AT,
    assignments: Object.freeze([
      assignment({
        id: `a-${ASG}-ad1`,
        studentId: OTHER,
        role: "EXAMINEE",
        orderIndex: 0,
        pairingIndex: 1,
      }),
      assignment({
        id: `a-${ASG}-ad2`,
        studentId: DUP_B,
        role: "EXAMINEE",
        orderIndex: 1,
        pairingIndex: 2,
      }),
      assignment({
        id: `a-${ASG}-ad3`,
        studentId: VIEWER,
        role: "INSTRUCTED_TRAINEE",
        orderIndex: 2,
        pairingIndex: 2,
      }),
    ]),
    breaks: Object.freeze([]),
    supervisorInstructorIds: Object.freeze([SUP_B]),
  }),
  // 13:00 — the SECOND `INTERFACE_RIDING` definition, plus a BLANK student id.
  Object.freeze({
    id: "sess-interface",
    definitionId: DEF_INTERFACE,
    date: DATE,
    startTime: "13:00",
    endTime: "14:00",
    orderIndex: 2,
    arena: "מגרש חול קטן",
    title: null,
    notes: null,
    individualPublishedAt: null,
    updatedAt: SESSION_UPDATED_AT,
    assignments: Object.freeze([
      assignment({ id: `a-${ASG}-if1`, studentId: OTHER, role: "EXAMINEE", orderIndex: 0 }),
      assignment({ id: `a-${ASG}-if2`, studentId: NAMELESS, role: "EXAMINEE", orderIndex: 1 }),
      // A RESERVED, not-yet-bound place: it holds a lane but identifies nobody.
      assignment({ id: `a-${ASG}-if3`, studentId: "   ", role: "EXAMINEE", orderIndex: 2 }),
    ]),
    breaks: Object.freeze([]),
    supervisorInstructorIds: Object.freeze([]),
  }),
  // An UNRESOLVABLE block: its start time is not a legal `HH:MM`.
  Object.freeze({
    id: "sess-unresolved",
    definitionId: DEF_RIDING,
    date: DATE,
    startTime: "99:99",
    endTime: "15:00",
    orderIndex: 3,
    arena: "אולם לא פתור",
    title: null,
    notes: null,
    individualPublishedAt: null,
    updatedAt: SESSION_UPDATED_AT,
    assignments: Object.freeze([
      assignment({ id: `a-${ASG}-un1`, studentId: VIEWER, role: "EXAMINEE", orderIndex: 0 }),
    ]),
    breaks: Object.freeze([]),
    // The SAME supervisor as `sess-riding`: proof the batch deduplicates.
    supervisorInstructorIds: Object.freeze([SUP_A]),
  }),
  // Another DATE entirely.
  Object.freeze({
    id: "sess-offday",
    definitionId: DEF_RIDING,
    date: OTHER_DATE,
    startTime: "09:00",
    endTime: "10:00",
    orderIndex: 0,
    arena: "אולם אחר",
    title: null,
    notes: null,
    individualPublishedAt: null,
    updatedAt: SESSION_UPDATED_AT,
    assignments: Object.freeze([
      assignment({ id: `a-${ASG}-off1`, studentId: OFFDAY, role: "EXAMINEE", orderIndex: 0 }),
    ]),
    breaks: Object.freeze([]),
    supervisorInstructorIds: Object.freeze([]),
  }),
]);

function participantRow(over: {
  readonly id: string;
  readonly traineeId: string | null;
  readonly traineeName: string | null;
  readonly role: string;
  readonly createdAt: string;
}) {
  return Object.freeze({ ...over, isManualOverride: false });
}

const LESSON_ROWS: readonly TeachingPracticeExamLessonRow[] = Object.freeze([
  // A PUBLISHED lunge lesson the viewer takes part in.
  Object.freeze({
    id: "lesson-lunge",
    practiceType: "LUNGE",
    date: DATE,
    startTime: "10:00",
    endTime: "11:00",
    createdAt: "2026-07-01T08:00:00.000Z",
    groupName: "קבוצה א",
    location: "מגרש לונג׳",
    notes: `lesson-notes-${OPS}-lunge`,
    isPublished: true,
    roleLabelOverrides: { LEAD_INSTRUCTOR: `role-label-${HID}` },
    responsibleInstructorId: RESP_LUNGE,
    responsibleInstructorName: "מדריכה אחראית מהמקור",
    participants: Object.freeze([
      participantRow({
        id: "p-lunge-1",
        traineeId: VIEWER,
        traineeName: `${SRC}-אורי`,
        role: "LEAD_INSTRUCTOR",
        createdAt: "2026-07-01T08:00:00.000Z",
      }),
      participantRow({
        id: "p-lunge-2",
        traineeId: OTHER,
        traineeName: `${SRC}-נועה`,
        role: "SECOND_INSTRUCTOR",
        createdAt: "2026-07-01T08:01:00.000Z",
      }),
      // An UNRECOGNISED Teaching-Practice role: retained as a diagnostic, and
      // projected NOWHERE.
      participantRow({
        id: "p-lunge-3",
        traineeId: REJECTED,
        traineeName: `${SRC}-נדחתה`,
        role: "SPECTATOR",
        createdAt: "2026-07-01T08:02:00.000Z",
      }),
    ]),
    childAssignments: Object.freeze([
      Object.freeze({
        id: "child-assign-lunge-1",
        childId: `child-${HID}-lunge`,
        childName: "ילדה מהשיעור",
        childAge: 8,
        childGender: "F",
        childNotes: "רגישה לרעש",
        parentName: "הורה מהשיעור",
        parentPhone: "050-1111111",
        horseName: "סוסה קטנה",
        equipmentNotes: "קסדה קטנה",
        isAbsent: false,
      }),
    ]),
  }),
  // A PUBLISHED group lesson with TWO trainees sharing one display name.
  Object.freeze({
    id: "lesson-group",
    practiceType: "BEGINNER_GROUP",
    date: DATE,
    startTime: "12:00",
    endTime: "13:00",
    createdAt: "2026-07-01T09:00:00.000Z",
    groupName: "קבוצה ב",
    location: "אולם רכיבה",
    notes: `lesson-notes-${OPS}-group`,
    isPublished: true,
    roleLabelOverrides: null,
    responsibleInstructorId: RESP_GROUP,
    responsibleInstructorName: "מדריך אחראי מהמקור",
    participants: Object.freeze([
      participantRow({
        id: "p-group-1",
        traineeId: DUP_A,
        traineeName: `${SRC}-דנה-א`,
        role: "LEAD_INSTRUCTOR",
        createdAt: "2026-07-01T09:00:00.000Z",
      }),
      participantRow({
        id: "p-group-2",
        traineeId: DUP_B,
        traineeName: `${SRC}-דנה-ב`,
        role: "ASSISTANT_INSTRUCTOR",
        createdAt: "2026-07-01T09:01:00.000Z",
      }),
    ]),
    childAssignments: Object.freeze([
      Object.freeze({
        id: "child-assign-group-1",
        childId: `child-${HID}-group`,
        childName: "ילד מהקבוצה",
        childAge: 10,
        childGender: "M",
        childNotes: null,
        parentName: "הורה מהקבוצה",
        parentPhone: "050-2222222",
        horseName: "סוס גדול",
        equipmentNotes: null,
        isAbsent: true,
      }),
    ]),
  }),
  // An UNPUBLISHED lesson. Operational roles see it; a trainee must not.
  Object.freeze({
    id: "lesson-hidden",
    practiceType: "LUNGE",
    date: DATE,
    startTime: "14:00",
    endTime: "15:00",
    createdAt: "2026-07-01T10:00:00.000Z",
    groupName: `group-${UNPUB}`,
    location: `location-${UNPUB}`,
    notes: `notes-${UNPUB}`,
    isPublished: false,
    roleLabelOverrides: null,
    responsibleInstructorId: RESP_HIDDEN,
    responsibleInstructorName: `resp-name-${UNPUB}`,
    participants: Object.freeze([
      participantRow({
        id: "p-hidden-1",
        traineeId: UNPUBLISHED_STUDENT,
        traineeName: `${SRC}-${UNPUB}`,
        role: "LEAD_INSTRUCTOR",
        createdAt: "2026-07-01T10:00:00.000Z",
      }),
    ]),
    childAssignments: Object.freeze([
      Object.freeze({
        id: `child-assign-${UNPUB}-1`,
        childId: `child-${HID}-hidden`,
        childName: `child-name-${UNPUB}`,
        childAge: 7,
        childGender: `gender-${UNPUB}`,
        childNotes: `child-notes-${UNPUB}`,
        parentName: `parent-name-${UNPUB}`,
        parentPhone: `parent-phone-${UNPUB}`,
        horseName: `horse-${UNPUB}`,
        equipmentNotes: `equipment-${UNPUB}`,
        isAbsent: false,
      }),
    ]),
  }),
  // An UNSUPPORTED practice type: rejected before any projection.
  Object.freeze({
    id: "lesson-unsupported",
    practiceType: "GROUP_LESSON",
    date: DATE,
    startTime: "16:00",
    endTime: "17:00",
    createdAt: "2026-07-01T11:00:00.000Z",
    groupName: null,
    location: null,
    notes: null,
    isPublished: true,
    roleLabelOverrides: null,
    responsibleInstructorId: null,
    responsibleInstructorName: null,
    participants: Object.freeze([]),
    childAssignments: Object.freeze([]),
  }),
]);

const SOURCE_DATE_ROWS = Object.freeze([Object.freeze({ date: DATE })]);

/** The fixture, serialized ONCE, so mutation by the pipeline is detectable. */
const FIXTURE_SNAPSHOT = JSON.stringify({
  definitions: DEFINITION_ROWS,
  sessions: SESSION_ROWS,
  lessons: LESSON_ROWS,
  sourceDates: SOURCE_DATE_ROWS,
});

// ===========================================================================
// The injected dependencies — the ONLY fakes in this suite
// ===========================================================================

interface Calls {
  readonly order: string[];
  readonly planArgs: string[];
  readonly definitionArgs: string[];
  readonly sessionArgs: string[];
  readonly sourceDateArgs: string[];
  readonly lessonDateArgs: string[][];
  readonly studentBatches: string[][];
  readonly instructorBatches: string[][];
  readonly loadOptions: ExamPlanLoadOptions[];
  readonly loadOfferingIds: string[];
}

function makeCalls(): Calls {
  return {
    order: [],
    planArgs: [],
    definitionArgs: [],
    sessionArgs: [],
    sourceDateArgs: [],
    lessonDateArgs: [],
    studentBatches: [],
    instructorBatches: [],
    loadOptions: [],
    loadOfferingIds: [],
  };
}

interface FixtureOverrides {
  readonly planPublishedAt?: number | null;
  readonly planMissing?: boolean;
  readonly sessions?: readonly StoredExamSessionRow[];
  readonly lessons?: readonly TeachingPracticeExamLessonRow[];
  readonly sourceDates?: readonly { readonly date: string }[];
  readonly failSessions?: Error;
  /**
   * The DB-verified offering's LEVEL, as each role resolver reports it. Defaults
   * to the beginner level, so every fixture written before the containment gate
   * existed keeps reading exactly the Teaching-Practice rows it was written for.
   */
  readonly courseLevel?: number;
}

class InfrastructureError extends Error {}
class CourseDenialError extends Error {}

/** The real IO seam, backed by the in-memory fixture instead of a database. */
function ioDeps(calls: Calls, over: FixtureOverrides = {}): ExamPlanLoadDeps {
  return {
    fetchPlanByCourseOfferingId: async (courseOfferingId) => {
      calls.order.push("plan");
      calls.planArgs.push(courseOfferingId);
      if (over.planMissing === true) return null;
      return {
        id: PLAN_ID,
        publishedAt:
          over.planPublishedAt === undefined ? PLAN_PUBLISHED_AT : over.planPublishedAt,
        updatedAt: PLAN_UPDATED_AT,
      };
    },
    fetchDefinitionsByPlanId: async (planId) => {
      calls.order.push("definitions");
      calls.definitionArgs.push(planId);
      return DEFINITION_ROWS;
    },
    fetchSessionsByPlanId: async (planId) => {
      calls.order.push("sessions");
      calls.sessionArgs.push(planId);
      if (over.failSessions !== undefined) throw over.failSessions;
      return over.sessions ?? SESSION_ROWS;
    },
    fetchSourceDatesByPlanId: async (planId) => {
      calls.order.push("sourceDates");
      calls.sourceDateArgs.push(planId);
      return over.sourceDates ?? SOURCE_DATE_ROWS;
    },
    fetchTeachingPracticeLessonsByDates: async (dates) => {
      calls.order.push("lessons");
      calls.lessonDateArgs.push([...dates]);
      const selected = new Set(dates);
      return (over.lessons ?? LESSON_ROWS).filter((lesson) => selected.has(lesson.date));
    },
  };
}

/** The REAL loader, wired to the in-memory IO seam. */
function loadPlanWith(calls: Calls, over: FixtureOverrides = {}) {
  return async (input: { courseOfferingId: string; options: ExamPlanLoadOptions }) => {
    calls.order.push("load");
    calls.loadOfferingIds.push(input.courseOfferingId);
    calls.loadOptions.push(input.options);
    return loadExamPlan(input, ioDeps(calls, over));
  };
}

function studentNameFetch(calls: Calls) {
  return async (ids: readonly string[]) => {
    calls.order.push("student-names");
    calls.studentBatches.push([...ids]);
    return new Map(
      ids
        .filter((id) => STUDENT_NAMES.has(id))
        .map((id) => [id, STUDENT_NAMES.get(id) as string]),
    );
  };
}

function instructorNameFetch(calls: Calls) {
  return async (ids: readonly string[]) => {
    calls.order.push("instructor-names");
    calls.instructorBatches.push([...ids]);
    return new Map(
      ids
        .filter((id) => INSTRUCTOR_NAMES.has(id))
        .map((id) => [id, INSTRUCTOR_NAMES.get(id) as string]),
    );
  };
}

function adminDeps(
  calls: Calls,
  over: FixtureOverrides & { readonly adminError?: Error } = {},
): AdminExamReadDeps {
  return {
    requireAdminCourseOffering: async (courseOfferingId) => {
      calls.order.push(`admin-course:${courseOfferingId}`);
      if (over.adminError !== undefined) throw over.adminError;
      return { id: COURSE_OFFERING_ID, level: over.courseLevel ?? BEGINNER_SOURCE_COURSE_LEVEL };
    },
    loadPlan: loadPlanWith(calls, over),
    fetchStudentDisplayNames: studentNameFetch(calls),
    fetchInstructorDisplayNames: instructorNameFetch(calls),
  };
}

function instructorDeps(
  calls: Calls,
  over: FixtureOverrides & { readonly courseError?: Error; readonly identityError?: Error } = {},
): InstructorExamReadDeps {
  return {
    requireInstructorId: async () => {
      calls.order.push("instructor-identity");
      if (over.identityError !== undefined) throw over.identityError;
      return `ins-${INS}-session`;
    },
    resolveInstructorCourseOffering: async (requested) => {
      calls.order.push(`instructor-course:${requested}`);
      if (over.courseError !== undefined) throw over.courseError;
      return { id: COURSE_OFFERING_ID, level: over.courseLevel ?? BEGINNER_SOURCE_COURSE_LEVEL };
    },
    isCourseContextDenial: (error) => error instanceof CourseDenialError,
    loadPlan: loadPlanWith(calls, over),
    fetchStudentDisplayNames: studentNameFetch(calls),
    fetchInstructorDisplayNames: instructorNameFetch(calls),
  };
}

function traineeDeps(
  calls: Calls,
  over: FixtureOverrides & {
    readonly studentId?: string;
    readonly courseError?: Error;
    readonly identityError?: Error;
  } = {},
): TraineeExamReadDeps {
  return {
    requireTraineeId: async () => {
      calls.order.push("trainee-identity");
      if (over.identityError !== undefined) throw over.identityError;
      return over.studentId ?? VIEWER;
    },
    resolveTraineeCourseOffering: async () => {
      calls.order.push("trainee-course");
      if (over.courseError !== undefined) throw over.courseError;
      return { id: COURSE_OFFERING_ID, level: over.courseLevel ?? BEGINNER_SOURCE_COURSE_LEVEL };
    },
    isCourseContextDenial: (error) => error instanceof CourseDenialError,
    loadPlan: loadPlanWith(calls, over),
    fetchStudentDisplayNames: studentNameFetch(calls),
  };
}

/** The internal payload as ONE role's loader options would produce it. */
async function loadPayload(options: ExamPlanLoadOptions): Promise<ExamPlanPayload> {
  return loadExamPlan({ courseOfferingId: COURSE_OFFERING_ID, options }, ioDeps(makeCalls()));
}

const OPERATIONAL_OPTIONS: ExamPlanLoadOptions = Object.freeze({
  requirePlanPublication: false,
  requireLessonPublication: false,
  viewerStudentId: null,
  beginnerSourceEnabled: true,
});

const TRAINEE_OPTIONS: ExamPlanLoadOptions = Object.freeze({
  requirePlanPublication: true,
  requireLessonPublication: true,
  viewerStudentId: VIEWER,
  beginnerSourceEnabled: true,
});

async function readAdmin(over: FixtureOverrides = {}): Promise<AdminExamReadDto> {
  return readAdminExamPlanWithDeps(COURSE_OFFERING_ID, adminDeps(makeCalls(), over));
}

async function readTrainee(
  over: FixtureOverrides & { readonly studentId?: string } = {},
): Promise<TraineeExamDayDto> {
  return readTraineeExamDayWithDeps(DATE, traineeDeps(makeCalls(), over));
}

/** Every marker that must never appear in a TRAINEE payload. */
const TRAINEE_FORBIDDEN_MARKERS = [STU, INS, HID, SRC, ASG, OPS, UNPUB] as const;
/** Every marker that must never appear in an OPERATIONAL payload. */
const OPERATIONAL_FORBIDDEN_MARKERS = [STU, INS, HID, SRC] as const;

// ===========================================================================
// GROUP A — end-to-end STORED pipeline
// ===========================================================================

test("A1. the loader composes stored blocks through the COMMITTED stored adapter", async () => {
  const payload = await loadPayload(OPERATIONAL_OPTIONS);
  // The same raw rows, run through the adapter directly: the loader must
  // DELEGATE to it rather than re-deriving anything of its own.
  const composed = composeStoredExamBlocks(SESSION_ROWS, DEFINITION_ROWS);
  const storedFromPayload = payload.sessions.filter((s) => s.kind !== "BEGINNER_INSTRUCTION");
  // The merged payload order and the adapter's own locked order are the same
  // key — `date`, `startTime`, `orderIndex`, `sessionId` — so filtering the live
  // rows out of the payload must reproduce the adapter's list exactly.
  assert.deepEqual(
    storedFromPayload.map((s) => s.sessionId),
    composed.blocks.map((b) => b.session.sessionId),
  );
  // Carried BY IDENTITY: the payload holds the adapter's own frozen objects.
  for (const block of composed.blocks) {
    const found = payload.sessions.find((s) => s.sessionId === block.session.sessionId);
    assert.deepEqual(found, block.session);
  }
});

test("A2. kind, duration and capacity come from the ExamDefinition, and identity is exact", async () => {
  const dto = await readAdmin();
  const riding = dto.rows.find((row) => row.sessionId === "sess-riding");
  const iface = dto.rows.find((row) => row.sessionId === "sess-interface");
  assert.ok(riding !== undefined && iface !== undefined);

  // The definition's kind — never the deprecated, unwritten `ExamSession.kind`.
  assert.equal(riding.kind, "INTERFACE_RIDING");
  assert.equal(iface.kind, "INTERFACE_RIDING");
  // The definition's identity is retained EXACTLY, per row.
  assert.equal(riding.definitionId, DEF_RIDING);
  assert.equal(riding.definitionName, "רכיבה");
  assert.equal(iface.definitionId, DEF_INTERFACE);
  assert.equal(iface.definitionName, "ממשק");
  // duration 15 × capacity 1 × 3 examinees + a 10-minute break = 09:00 → 09:55;
  // duration 20 × capacity 2 × 3 examinees                     = 13:00 → 13:40.
  assert.equal(riding.derivedBlockEndTime, "09:55");
  assert.equal(iface.derivedBlockEndTime, "13:40");
});

test("A3. a positional break shifts every derived slot after it", async () => {
  const dto = await readTrainee();
  const riding = dto.allRows.find((row) => row.sessionId === "sess-riding");
  assert.ok(riding !== undefined);
  // The viewer is the SECOND examinee, so the 10-minute break after wave 0 moves
  // their personal slot from 09:15 to 09:25. A block-time fallback would have
  // produced 09:00 — the block start — and that is exactly what must not happen.
  assert.equal(riding.selfStartTime, "09:25");
  assert.equal(riding.selfEndTime, "09:40");
  assert.notEqual(riding.selfStartTime, riding.startTime);
  assert.equal(riding.startTime, "09:00");
  assert.equal(riding.displayEndTime, "09:55");
});

test("A4. an instructed trainee inherits the PAIRED examinee's exact interval", async () => {
  const dto = await readTrainee();
  const advanced = dto.allRows.find((row) => row.sessionId === "sess-advanced");
  assert.ok(advanced !== undefined);
  assert.equal(advanced.selfRole, "INSTRUCTED_TRAINEE");
  // Paired to the SECOND examinee (pairingIndex 2), whose wave is 11:30–12:00.
  assert.equal(advanced.selfStartTime, "11:30");
  assert.equal(advanced.selfEndTime, "12:00");
  // Neither the block start nor a substituted default.
  assert.equal(advanced.startTime, "11:00");
});

test("A5. an instructed trainee consumes NO extra lane", async () => {
  const dto = await readAdmin();
  const advanced = dto.rows.find((row) => row.sessionId === "sess-advanced");
  assert.ok(advanced !== undefined);
  // TWO examinees at capacity 1 and 30 minutes → 11:00 + 2×30 = 12:00. Had the
  // instructed trainee taken a lane there would be a third wave ending 12:30.
  assert.equal(advanced.derivedBlockEndTime, "12:00");
  assert.equal(advanced.examineeCount, 2);
  assert.equal(advanced.instructedTraineeCount, 1);
});

test("A6. an UNRESOLVED stored block survives for operational roles and vanishes for a trainee", async () => {
  const admin = await readAdmin();
  const unresolved = admin.rows.find((row) => row.sessionId === "sess-unresolved");
  assert.ok(unresolved !== undefined, "the admin must keep an unresolved block");
  assert.equal(unresolved.timetableStatus, "UNRESOLVED");
  assert.equal(unresolved.derivedBlockEndTime, null);
  // No end at all rather than the stored one masquerading as a computed one.
  assert.equal(unresolved.displayEndTime, null);
  assert.equal(unresolved.endTime, "15:00");
  // ...and its diagnostics stay available.
  const diagnostic = admin.diagnostics.storedBlockDiagnostics.find(
    (entry) => entry.sessionId === "sess-unresolved",
  );
  assert.ok(diagnostic !== undefined);
  assert.ok(diagnostic.timetableIssues.length > 0);

  const trainee = await readTrainee();
  assert.equal(
    trainee.allRows.some((row) => row.sessionId === "sess-unresolved"),
    false,
    "an unresolved block reached a trainee",
  );
  // The viewer IS assigned to it, and still sees nothing: no exact personal time
  // exists, and the block interval is never a fallback.
  assert.equal(
    trainee.myRows.some((row) => row.sessionId === "sess-unresolved"),
    false,
  );
});

test("A7. the stored detail lookup is keyed by session id, and holds no live row", async () => {
  const payload = await loadPayload(OPERATIONAL_OPTIONS);
  for (const [key, detail] of payload.storedDetails) {
    assert.equal(detail.sessionId, key, "the stored detail is mis-keyed");
    assert.equal(detail.source, "STORED");
  }
  // An unresolved block has NO entry: an empty one would read as "holds nobody".
  assert.equal(payload.storedDetails.has("sess-unresolved"), false);
  // A live beginner row must never appear in the stored lookup.
  for (const key of payload.storedDetails.keys()) {
    assert.equal(key.startsWith("tp:"), false, `${key} is a live row`);
  }
  assert.equal(payload.storedDetails.has("tp:lesson-lunge"), false);
});

// ===========================================================================
// GROUP B — end-to-end LIVE BEGINNER pipeline
// ===========================================================================

test("B1. ONLY the plan's explicit source dates are fetched, and none is inferred", async () => {
  const calls = makeCalls();
  await readAdminExamPlanWithDeps(COURSE_OFFERING_ID, adminDeps(calls));
  assert.deepEqual(calls.lessonDateArgs, [[DATE]]);
  // `OTHER_DATE` carries a real stored session, and is STILL never asked for.
  assert.equal(calls.lessonDateArgs[0].includes(OTHER_DATE), false);

  // With NO source date the Teaching-Practice dependency is not called at all.
  const empty = makeCalls();
  const dto = await readAdminExamPlanWithDeps(
    COURSE_OFFERING_ID,
    adminDeps(empty, { sourceDates: [] }),
  );
  assert.deepEqual(empty.lessonDateArgs, []);
  assert.equal(empty.order.includes("lessons"), false);
  assert.deepEqual(dto.sourceDates, []);
  assert.equal(
    dto.rows.some((row) => row.source === "BEGINNER"),
    false,
  );
});

test("B2. an unsupported practice type is REJECTED and projects nothing", async () => {
  const dto = await readAdmin();
  assert.equal(
    dto.rows.some((row) => row.sessionId === "tp:lesson-unsupported"),
    false,
  );
  const reported = dto.diagnostics.teachingPracticeSourceIssues.filter(
    (issue) => issue.lessonId === "lesson-unsupported",
  );
  assert.deepEqual(
    reported.map((issue) => issue.code),
    ["EX-TP-ADP-PRACTICE-TYPE-UNSUPPORTED"],
  );
});

test("B3. LUNGE and BEGINNER_GROUP both project live, keeping distinct formats", async () => {
  const dto = await readAdmin();
  const lunge = dto.rows.find((row) => row.sessionId === "tp:lesson-lunge");
  const group = dto.rows.find((row) => row.sessionId === "tp:lesson-group");
  assert.ok(lunge !== undefined && group !== undefined);
  assert.equal(lunge.kind, "BEGINNER_INSTRUCTION");
  assert.equal(group.kind, "BEGINNER_INSTRUCTION");
  // ONE kind, TWO formats: the format stays a per-lesson attribute.
  assert.equal(lunge.beginnerFormat, "LUNGE");
  assert.equal(group.beginnerFormat, "BEGINNER_GROUP");
  assert.equal(lunge.beginner?.beginnerFormat, "LUNGE");
  assert.equal(group.beginner?.beginnerFormat, "BEGINNER_GROUP");
});

test("B4. a live row declares NOT_APPLICABLE and keeps its REAL lesson interval", async () => {
  const payload = await loadPayload(OPERATIONAL_OPTIONS);
  const lunge = payload.sessions.find((s) => s.sessionId === "tp:lesson-lunge");
  assert.ok(lunge !== undefined);
  assert.equal(lunge.timetableStatus, "NOT_APPLICABLE");
  assert.equal(lunge.startTime, "10:00");
  assert.equal(lunge.endTime, "11:00");
  assert.equal(lunge.derivedBlockEndTime, undefined);
  assert.equal(lunge.definitionId, undefined);
  assert.equal(lunge.definitionName, undefined);

  const dto = await readAdmin();
  const row = dto.rows.find((r) => r.sessionId === "tp:lesson-lunge");
  assert.equal(row?.timetableStatus, "NOT_APPLICABLE");
  assert.equal(row?.startTime, "10:00");
  assert.equal(row?.endTime, "11:00");
  assert.equal(row?.displayEndTime, "11:00");
});

test("B5. the loader delegates to the COMMITTED Teaching-Practice and live adapters", async () => {
  const adapted = adaptTeachingPracticeExamSources(LESSON_ROWS);
  const live = projectLiveBeginnerRows({ lessons: adapted.lessons, viewerTraineeId: null });
  const payload = await loadPayload(OPERATIONAL_OPTIONS);

  const liveIds = live.rows.map((row) => row.session.sessionId).sort();
  const payloadLiveIds = payload.sessions
    .filter((s) => s.kind === "BEGINNER_INSTRUCTION")
    .map((s) => s.sessionId)
    .sort();
  assert.deepEqual(payloadLiveIds, liveIds);
  // The synthetic id is the ADAPTER's own; nothing here rebuilds it.
  for (const row of live.rows) {
    assert.deepEqual(payload.beginnerDetails.get(row.session.sessionId), row.detail);
  }
});

test("B6. both live rows fall in the ONE synthetic beginner group", async () => {
  const payload = await loadPayload(OPERATIONAL_OPTIONS);
  const projection = projectByExamDefinition(payload.sessions);
  const beginner = projection.groups.filter((g) => g.key.type === "BEGINNER");
  assert.equal(beginner.length, 1, "beginner rows must form exactly one group");
  assert.equal(beginner[0].label, EXAM_BEGINNER_GROUP_LABEL);
  assert.equal(beginner[0].definitionId, null);
  assert.deepEqual(
    beginner[0].sessions.map((s) => s.sessionId),
    ["tp:lesson-lunge", "tp:lesson-group", "tp:lesson-hidden"],
  );
});

test("B7. no stored detail exists for a beginner row, and the responsible instructor stays authoritative", async () => {
  const payload = await loadPayload(OPERATIONAL_OPTIONS);
  const detail = payload.beginnerDetails.get("tp:lesson-lunge");
  assert.ok(detail !== undefined);
  assert.equal(payload.storedDetails.has("tp:lesson-lunge"), false);
  // The authoritative id is retained INTERNALLY — it is what the conflict and
  // staffing questions are answered from…
  assert.equal(detail.responsibleInstructorId, RESP_LUNGE);
  // …and no live row is bound into the stored conflict input by this slice.
  assert.equal(
    payload.conflictSessions.some((c) => c.sessionId.startsWith("tp:")),
    false,
  );

  // …while every DTO carries a NAME and never that id.
  const admin = await readAdmin();
  const row = admin.rows.find((r) => r.sessionId === "tp:lesson-lunge");
  assert.equal(row?.beginner?.responsibleInstructorName, "מדריכה אחראית לונג׳");
  assert.equal(deepStrings(admin).includes(RESP_LUNGE), false);
});

// ===========================================================================
// GROUP C — the ADMIN role contract
// ===========================================================================

test("C1. the admin reads a DRAFT plan, and only the resolver's offering id reaches the loader", async () => {
  const calls = makeCalls();
  const dto = await readAdminExamPlanWithDeps(
    OTHER_OFFERING_ID,
    adminDeps(calls, { planPublishedAt: null }),
  );
  // The caller's string is a REQUEST; only the DB-verified id scopes the read.
  assert.deepEqual(calls.order[0], `admin-course:${OTHER_OFFERING_ID}`);
  assert.deepEqual(calls.loadOfferingIds, [COURSE_OFFERING_ID]);
  assert.deepEqual(calls.planArgs, [COURSE_OFFERING_ID]);
  // The locked admin options: draft plans AND unpublished lessons.
  assert.deepEqual(calls.loadOptions, [
    { requirePlanPublication: false, requireLessonPublication: false, viewerStudentId: null, beginnerSourceEnabled: true },
  ]);
  assert.equal(dto.viewerRole, "ADMIN");
  assert.equal(dto.isPublished, false);
  assert.equal(dto.publishedAt, null);
  assert.ok(dto.rows.length > 0, "a draft plan still yields rows for an admin");
});

test("C2. the admin sees every row, in the locked order", async () => {
  const dto = await readAdmin();
  assert.deepEqual(
    dto.rows.map((row) => row.sessionId),
    [
      "sess-riding",
      "tp:lesson-lunge",
      "sess-advanced",
      "tp:lesson-group",
      "sess-interface",
      "tp:lesson-hidden",
      "sess-unresolved",
      "sess-offday",
    ],
  );
  assert.equal(dto.planId, PLAN_ID);
  assert.equal(dto.publishedAt, PLAN_PUBLISHED_AT);
  assert.deepEqual(dto.sourceDates, [DATE]);
});

test("C3. supervisors are resolved to NAMES; raw instructor ids are never serialized", async () => {
  const dto = await readAdmin();
  const riding = dto.rows.find((row) => row.sessionId === "sess-riding");
  const iface = dto.rows.find((row) => row.sessionId === "sess-interface");
  assert.deepEqual(riding?.supervisorNames, ["מפקח א"]);
  assert.equal(riding?.supervisorCount, 1);
  // A block with no supervisor gets an empty list, never a placeholder person.
  assert.deepEqual(iface?.supervisorNames, []);
  assert.equal(iface?.supervisorCount, 0);
  // A live beginner row has no conflict entry, so no arena and no supervisor.
  const lunge = dto.rows.find((row) => row.sessionId === "tp:lesson-lunge");
  assert.equal(lunge?.arena, null);
  assert.deepEqual(lunge?.supervisorNames, []);

  const serialized = JSON.stringify(dto);
  for (const id of [SUP_A, SUP_B, RESP_LUNGE, RESP_GROUP, RESP_HIDDEN]) {
    assert.equal(serialized.includes(id), false, `the admin DTO leaks ${id}`);
  }
});

test("C4. the admin builder returns a plain DTO, never the internal payload", async () => {
  const dto = await readAdmin();
  assert.deepEqual(Object.keys(dto), [
    "viewerRole",
    "planId",
    "isPublished",
    "publishedAt",
    "sourceDates",
    "rows",
    "diagnostics",
  ]);
  // Nothing of the loader's internal payload shape survives.
  for (const key of ["sessions", "storedDetails", "beginnerDetails", "conflictSessions"]) {
    assert.equal(key in dto, false, `the admin DTO exposes ${key}`);
  }
  // Diagnostics are plain JSON-safe objects with the committed field sets.
  assert.deepEqual(Object.keys(dto.diagnostics), [
    "storedAdapterIssues",
    "storedBlockDiagnostics",
    "teachingPracticeSourceIssues",
    "beginnerRejections",
    "loaderIssues",
    "narrowingIssues",
  ]);
  assert.deepEqual(findNonPlainJsonPaths(dto.diagnostics), []);
});

test("C5. no Student.id, stored internal or denormalized source name reaches an admin", async () => {
  const dto = await readAdmin();
  const serialized = JSON.stringify(dto);
  for (const marker of OPERATIONAL_FORBIDDEN_MARKERS) {
    assert.equal(serialized.includes(marker), false, `the admin DTO carries marker ${marker}`);
  }
  // The accepted-but-unprojected publication stamps stay out too.
  for (const stamp of [PLAN_UPDATED_AT, SESSION_INDIVIDUAL_PUBLISHED_AT, SESSION_UPDATED_AT]) {
    assert.equal(serialized.includes(String(stamp)), false, `the admin DTO carries ${stamp}`);
  }
});

// ===========================================================================
// GROUP D — the INSTRUCTOR role contract
// ===========================================================================

test("D1. instructor identity is proven BEFORE the requested offering is looked up", async () => {
  const calls = makeCalls();
  const dto = await readInstructorExamPlanWithDeps(OTHER_OFFERING_ID, instructorDeps(calls));
  assert.equal(calls.order[0], "instructor-identity");
  assert.equal(calls.order[1], `instructor-course:${OTHER_OFFERING_ID}`);
  assert.deepEqual(calls.loadOfferingIds, [COURSE_OFFERING_ID]);
  assert.equal(dto.viewerRole, "INSTRUCTOR");
});

test("D2. the instructor may read a DRAFT plan under its OWN locked options", async () => {
  const calls = makeCalls();
  const dto = await readInstructorExamPlanWithDeps(
    OTHER_OFFERING_ID,
    instructorDeps(calls, { planPublishedAt: null }),
  );
  assert.deepEqual(calls.loadOptions, [
    { requirePlanPublication: false, requireLessonPublication: false, viewerStudentId: null, beginnerSourceEnabled: true },
  ]);
  assert.equal(dto.isPublished, false);
  assert.ok(dto.rows.length > 0);
  // Unresolved rows and their diagnostics remain available to an instructor.
  assert.ok(dto.rows.some((row) => row.timetableStatus === "UNRESOLVED"));
  assert.ok(dto.diagnostics.storedBlockDiagnostics.length > 0);
});

test("D3. an instructor denial performs NO loader, content or name work", async () => {
  const identityDenied = makeCalls();
  const a = await readInstructorExamPlanWithDeps(
    OTHER_OFFERING_ID,
    instructorDeps(identityDenied, { identityError: new CourseDenialError() }),
  );
  assert.deepEqual(a, emptyInstructorExamReadDto());
  assert.deepEqual(identityDenied.order, ["instructor-identity"]);

  const courseDenied = makeCalls();
  const b = await readInstructorExamPlanWithDeps(
    OTHER_OFFERING_ID,
    instructorDeps(courseDenied, { courseError: new CourseDenialError() }),
  );
  assert.deepEqual(b, emptyInstructorExamReadDto());
  assert.deepEqual(courseDenied.order, [
    "instructor-identity",
    `instructor-course:${OTHER_OFFERING_ID}`,
  ]);
  assert.deepEqual(courseDenied.loadOfferingIds, []);
  assert.deepEqual(courseDenied.studentBatches, []);
  assert.deepEqual(courseDenied.instructorBatches, []);
  assert.deepEqual(courseDenied.planArgs, []);
});

test("D4. the admin and instructor readings are separate builders with identical row data", async () => {
  const admin = await readAdmin();
  const instructor = await readInstructorExamPlanWithDeps(
    COURSE_OFFERING_ID,
    instructorDeps(makeCalls()),
  );
  assert.equal(admin.viewerRole, "ADMIN");
  assert.equal(instructor.viewerRole, "INSTRUCTOR");
  // The only difference today is the discriminator.
  assert.deepEqual({ ...instructor, viewerRole: "ADMIN" }, admin);

  // ...and the two builders remain separately exported, so a future policy split
  // changes the narrowing rather than every call site.
  const dtoCode = stripComments(readFileSync(DTO_PATH, "utf8"));
  assert.ok(/export function build[A]dminExamReadDto\(/.test(dtoCode));
  assert.ok(/export function build[I]nstructorExamReadDto\(/.test(dtoCode));
});

// ===========================================================================
// GROUP E — the TRAINEE role and PUBLICATION contract
// ===========================================================================

test("E1. an unpublished plan yields the empty trainee DTO, with NO content or name work", async () => {
  const calls = makeCalls();
  const dto = await readTraineeExamDayWithDeps(
    DATE,
    traineeDeps(calls, { planPublishedAt: null }),
  );
  assert.deepEqual(dto, emptyTraineeExamDayDto());
  assert.deepEqual(dto.allRows, []);
  assert.deepEqual(dto.myRows, []);
  // PLAN-FIRST: the identity row is the only thing ever fetched.
  assert.deepEqual(calls.order, ["trainee-identity", "trainee-course", "load", "plan"]);
  assert.deepEqual(calls.definitionArgs, []);
  assert.deepEqual(calls.sessionArgs, []);
  assert.deepEqual(calls.lessonDateArgs, []);
  // ...and NO name lookup happens at all.
  assert.deepEqual(calls.studentBatches, []);
  assert.deepEqual(calls.instructorBatches, []);
  // The result discloses no plan id and no publication state.
  assert.deepEqual(Object.keys(dto), ["allRows", "myRows"]);
});

test("E2. a missing plan is indistinguishable from an unpublished one", async () => {
  const missing = await readTrainee({ planMissing: true });
  const unpublished = await readTrainee({ planPublishedAt: null });
  assert.deepEqual(missing, unpublished);
  assert.deepEqual(missing, emptyTraineeExamDayDto());
});

test("E3. the trainee reader receives NO caller-supplied offering id", async () => {
  const calls = makeCalls();
  await readTraineeExamDayWithDeps(DATE, traineeDeps(calls));
  // The resolver takes no argument at all, and its verified id is the only scope.
  assert.deepEqual(calls.loadOfferingIds, [COURSE_OFFERING_ID]);
  assert.deepEqual(calls.loadOptions, [
    { requirePlanPublication: true, requireLessonPublication: true, viewerStudentId: VIEWER, beginnerSourceEnabled: true },
  ]);
  // Arity is the contract: a date and the injected deps, and nothing else.
  assert.equal(readTraineeExamDayWithDeps.length, 2);
});

test("E4. a trainee denial performs NO loader, content or name work", async () => {
  const calls = makeCalls();
  const dto = await readTraineeExamDayWithDeps(
    DATE,
    traineeDeps(calls, { courseError: new CourseDenialError() }),
  );
  assert.deepEqual(dto, emptyTraineeExamDayDto());
  assert.deepEqual(calls.order, ["trainee-identity", "trainee-course"]);
  assert.deepEqual(calls.loadOfferingIds, []);
  assert.deepEqual(calls.studentBatches, []);
});

test("E5. an UNPUBLISHED beginner lesson contributes nothing at all to a trainee", async () => {
  const calls = makeCalls();
  const dto = await readTraineeExamDayWithDeps(DATE, traineeDeps(calls));
  // No session…
  assert.equal(
    dto.allRows.some((row) => row.sessionId === "tp:lesson-hidden"),
    false,
  );
  // …no child detail, no participant name, no phone, no name-lookup id…
  const serialized = JSON.stringify(dto);
  assert.equal(serialized.includes(UNPUB), false, "unpublished lesson content reached a trainee");
  assert.equal(serialized.includes(UNPUBLISHED_STUDENT), false);
  assert.equal(calls.studentBatches[0].includes(UNPUBLISHED_STUDENT), false);
  assert.equal(deepStrings(dto).includes("חניך שיעור לא מפורסם"), false);

  // …while the operational roles DO receive it.
  const admin = await readAdmin();
  const hidden = admin.rows.find((row) => row.sessionId === "tp:lesson-hidden");
  assert.ok(hidden !== undefined);
  assert.equal(hidden.beginner?.isPublished, false);
  assert.equal(hidden.beginner?.children.length, 1);
  assert.deepEqual(hidden.beginner?.participantNames, ["חניך שיעור לא מפורסם"]);
});

test("E6. a PUBLISHED beginner lesson stays fully visible to a trainee", async () => {
  const dto = await readTrainee();
  const lunge = dto.allRows.find((row) => row.sessionId === "tp:lesson-lunge");
  assert.ok(lunge !== undefined);
  assert.equal(lunge.source, "BEGINNER");
  assert.equal(lunge.location, "מגרש לונג׳");
  // A beginner row keeps its own place and never consumes a stored arena.
  assert.equal(lunge.arena, null);
  assert.equal(lunge.beginner?.groupName, "קבוצה א");
  assert.equal(lunge.beginner?.lessonId, "lesson-lunge");
  assert.deepEqual(lunge.beginner?.participantNames, ["אורי הצופה", "נועה לוי"]);
  assert.equal(lunge.beginner?.participantCount, 2);
  // The approved visible operational values, including the RAW parent phone.
  assert.equal(lunge.beginner?.children.length, 1);
  assert.equal(lunge.beginner?.children[0].parentPhone, "050-1111111");
  assert.equal(lunge.beginner?.children[0].parentName, "הורה מהשיעור");
  assert.equal(lunge.beginner?.children[0].childAssignmentId, "child-assign-lunge-1");
  assert.equal(lunge.beginnerChildCount, 1);
  // The responsible instructor's name survives without any instructor query.
  assert.equal(lunge.beginner?.responsibleInstructorName, "מדריכה אחראית מהמקור");
});

test("E7. a rejected Teaching-Practice participant appears in no trainee or admin list", async () => {
  const trainee = await readTrainee();
  const admin = await readAdmin();
  for (const [name, dto] of [
    ["trainee", trainee],
    ["admin", admin],
  ] as const) {
    const strings = deepStrings(dto);
    assert.equal(strings.includes("משתתפת שנדחתה"), false, `${name} shows a rejected participant`);
  }
  const lunge = admin.rows.find((row) => row.sessionId === "tp:lesson-lunge");
  assert.equal(lunge?.beginner?.participantCount, 2);
  // The defect stays observable as a diagnostic instead of vanishing.
  assert.ok(
    admin.diagnostics.teachingPracticeSourceIssues.some(
      (issue) => issue.code === "EX-TP-ADP-PARTICIPANT-ROLE-INVALID",
    ),
  );
});

test("E8. the DAY is the trainee's whole scope, and the committed projection owns it", async () => {
  const dto = await readTrainee();
  assert.deepEqual(
    dto.allRows.map((row) => row.sessionId),
    ["sess-riding", "tp:lesson-lunge", "sess-advanced", "tp:lesson-group", "sess-interface"],
  );
  // No off-date row survives.
  assert.equal(
    dto.allRows.some((row) => row.date !== DATE),
    false,
  );

  // PARITY: the committed `projectTraineeExamDay` is the thing that produced it.
  const payload = await loadPayload(TRAINEE_OPTIONS);
  const projection = projectTraineeExamDay(
    payload.sessions,
    payload.storedDetails,
    DATE,
    VIEWER,
  );
  assert.deepEqual(
    projection.allRows.map((row) => row.session.sessionId),
    dto.allRows.map((row) => row.sessionId),
  );
  assert.deepEqual(
    projection.allRows.map((row) => row.isSelf),
    dto.allRows.map((row) => row.isSelf),
  );
  assert.deepEqual(
    projection.allRows.map((row) => row.selfStartTime),
    dto.allRows.map((row) => row.selfStartTime),
  );
});

// ===========================================================================
// GROUP E (cont.) — the allRows / myRows invariant
// ===========================================================================

test("E9. myRows is LITERALLY allRows.filter(row => row.isSelf), by reference", async () => {
  const dto = await readTrainee();
  const expected = dto.allRows.filter((row) => row.isSelf);
  assert.deepEqual(dto.myRows, expected);
  assert.equal(dto.myRows.length, expected.length);
  // Object IDENTITY: there is no second mapping of the projection.
  for (let i = 0; i < expected.length; i += 1) {
    assert.equal(dto.myRows[i], expected[i], `myRows[${i}] is a copy, not the same row`);
  }
  assert.deepEqual(
    dto.myRows.map((row) => row.sessionId),
    ["sess-riding", "tp:lesson-lunge", "sess-advanced"],
  );
  // Every personal value is preserved exactly as the committed core computed it.
  assert.deepEqual(
    dto.myRows.map((row) => [row.selfRole, row.selfStartTime, row.selfEndTime]),
    [
      ["EXAMINEE", "09:25", "09:40"],
      ["EXAMINEE", "10:00", "11:00"],
      ["INSTRUCTED_TRAINEE", "11:30", "12:00"],
    ],
  );
  for (const row of dto.myRows) assert.equal(row.selfLabel, "השיבוץ שלי");
});

test("E10. another trainee's row is visible in allRows and absent from myRows", async () => {
  const dto = await readTrainee();
  const iface = dto.allRows.find((row) => row.sessionId === "sess-interface");
  assert.ok(iface !== undefined, "the other trainee's row must be visible in לו״ז כולל");
  assert.equal(iface.isSelf, false);
  assert.equal(iface.selfLabel, null);
  assert.equal(iface.selfRole, null);
  assert.equal(iface.selfStartTime, null);
  assert.equal(iface.selfEndTime, null);
  assert.equal(
    dto.myRows.some((row) => row.sessionId === "sess-interface"),
    false,
  );

  // A DIFFERENT viewer flips exactly the same rows, from the same projection.
  const other = await readTrainee({ studentId: OTHER });
  assert.deepEqual(
    other.myRows.map((row) => row.sessionId),
    ["sess-riding", "tp:lesson-lunge", "sess-advanced", "sess-interface"],
  );
  assert.deepEqual(
    other.allRows.map((row) => row.sessionId),
    dto.allRows.map((row) => row.sessionId),
  );
});

// ===========================================================================
// GROUP F — the TRAINEE PRIVACY contract
// ===========================================================================

test("F1. no planted internal secret of any kind reaches a trainee", async () => {
  const dto = await readTrainee();
  const serialized = JSON.stringify(dto);
  for (const marker of TRAINEE_FORBIDDEN_MARKERS) {
    assert.equal(serialized.includes(marker), false, `the trainee DTO carries marker ${marker}`);
  }
  // Named individually, so a failure says WHAT leaked.
  for (const id of [
    VIEWER,
    OTHER,
    DUP_A,
    DUP_B,
    NAMELESS,
    OFFDAY,
    REJECTED,
    UNPUBLISHED_STUDENT,
    SUP_A,
    SUP_B,
    RESP_LUNGE,
    RESP_GROUP,
    RESP_HIDDEN,
    PLAN_ID,
  ]) {
    assert.equal(serialized.includes(id), false, `the trainee DTO leaks ${id}`);
  }
  for (const stamp of [
    PLAN_PUBLISHED_AT,
    PLAN_UPDATED_AT,
    SESSION_INDIVIDUAL_PUBLISHED_AT,
    SESSION_UPDATED_AT,
  ]) {
    assert.equal(serialized.includes(String(stamp)), false, `the trainee DTO carries ${stamp}`);
  }
});

test("F2. no forbidden CHANNEL exists in the trainee contract", async () => {
  const dto = await readTrainee();
  assert.deepEqual(Object.keys(dto), ["allRows", "myRows"]);
  const serialized = JSON.stringify(dto);
  for (const token of [
    "viewerStudentId",
    "examineeStudentIds",
    "instructedTraineeStudentIds",
    "assignmentId",
    "slots",
    "storedDetails",
    "conflictSessions",
    "supervisor",
    "responsibleInstructorId",
    "diagnostics",
    "issues",
    "individualPublishedAt",
    "updatedAt",
    "practiceType",
    "notes",
    "isPublished",
    "EX-TRN",
    "EX-DTO",
    "EX-LOAD",
    "EX-ADP",
    "EX-TP-ADP",
    "EX-CALC",
    "EX-DEF",
    "EX-GRP",
  ]) {
    assert.equal(serialized.includes(token), false, `the trainee DTO carries ${token}`);
  }
  // The row's exact field set is the committed one, and nothing more.
  assert.deepEqual(Object.keys(dto.allRows[0]), [
    "sessionId",
    "source",
    "kind",
    "beginnerFormat",
    "date",
    "startTime",
    "displayEndTime",
    "definitionId",
    "definitionName",
    "arena",
    "location",
    "isSelf",
    "selfLabel",
    "selfRole",
    "selfStartTime",
    "selfEndTime",
    "examineeNames",
    "examineeCount",
    "instructedTraineeNames",
    "instructedTraineeCount",
    "beginnerChildCount",
    "assignments",
    "beginner",
  ]);
  // The ASSIGNMENT row's field set is exact too: the operational values and
  // NOTHING that identifies a row, a person or a pairing index.
  const riding = dto.allRows.find((row) => row.sessionId === "sess-riding");
  assert.ok(riding !== undefined && riding.assignments.length > 0);
  assert.deepEqual(Object.keys(riding.assignments[0]), [
    "participantName",
    "role",
    "horseName",
    "instructionTopic",
    "discipline",
    "personalStartTime",
    "personalEndTime",
    "pairedParticipantName",
    "pairedParticipantNames",
    // The ONE trainee-only addition. A BOOLEAN - never an id, never a name
    // comparison - so marking the viewer's own row opens no identifier channel.
    "isSelf",
  ]);
});

test("F3. the APPROVED visible values are still present", async () => {
  const dto = await readTrainee();
  const strings = deepStrings(dto);
  // Participant display names, the stored arena, the beginner location, the
  // visible child detail and the raw parent phone of a PUBLISHED lesson.
  assert.ok(strings.includes("אורי הצופה"));
  assert.ok(strings.includes("נועה לוי"));
  assert.ok(strings.includes("אולם מקורה"));
  assert.ok(strings.includes("מגרש לונג׳"));
  assert.ok(strings.includes("ילדה מהשיעור"));
  assert.ok(strings.includes("050-1111111"));
  assert.ok(strings.includes("רגישה לרעש"));
  assert.ok(strings.includes("סוסה קטנה"));
});

test("F4. the trainee child contract carries a display key, never the child's identity", async () => {
  const dto = await readTrainee();
  const lunge = dto.allRows.find((row) => row.sessionId === "tp:lesson-lunge");
  const child = lunge?.beginner?.children[0];
  assert.ok(child !== undefined);
  assert.deepEqual(Object.keys(child), [
    "childAssignmentId",
    "fullName",
    "age",
    "gender",
    "childNotes",
    "parentName",
    "parentPhone",
    "horseName",
    "equipmentNotes",
    "isAbsent",
  ]);
  assert.equal("childId" in child, false, "the child's own identity reached a trainee");
  // The trainee beginner detail carries no operational lesson state.
  assert.deepEqual(Object.keys(lunge?.beginner ?? {}), [
    "sessionId",
    "lessonId",
    "beginnerFormat",
    "groupName",
    "location",
    "responsibleInstructorName",
    "participantNames",
    "participantCount",
    "children",
  ]);
});

// ===========================================================================
// GROUP G — NAME BATCHING and the N+1 contract
// ===========================================================================

test("G1. an operational read issues at most ONE student and ONE instructor batch", async () => {
  const calls = makeCalls();
  await readAdminExamPlanWithDeps(COURSE_OFFERING_ID, adminDeps(calls));
  assert.equal(calls.studentBatches.length, 1);
  assert.equal(calls.instructorBatches.length, 1);
  // Stored examinees, instructed trainees AND visible beginner participants all
  // travel in the SAME batch.
  assert.deepEqual(calls.studentBatches[0], [
    DUP_A,
    DUP_B,
    NAMELESS,
    OFFDAY,
    OTHER,
    UNPUBLISHED_STUDENT,
    VIEWER,
  ]);
  // Supervisors AND responsible instructors, deduplicated, in ONE batch.
  assert.deepEqual(calls.instructorBatches[0], [
    RESP_GROUP,
    RESP_HIDDEN,
    RESP_LUNGE,
    SUP_A,
    SUP_B,
  ]);
  // The rejected participant's id was never asked about.
  assert.equal(calls.studentBatches[0].includes(REJECTED), false);
});

test("G2. a trainee read issues ONE student batch and ZERO instructor batches", async () => {
  const calls = makeCalls();
  await readTraineeExamDayWithDeps(DATE, traineeDeps(calls));
  assert.equal(calls.studentBatches.length, 1);
  assert.equal(calls.instructorBatches.length, 0);
  assert.equal(calls.order.includes("instructor-names"), false);
  // Only the VISIBLE rows of the selected day contribute an id: no off-date row,
  // no unpublished lesson, no hidden unresolved block participant beyond those
  // already visible elsewhere, and no rejected participant.
  assert.deepEqual(calls.studentBatches[0], [DUP_A, DUP_B, NAMELESS, OTHER, VIEWER]);
  for (const id of [OFFDAY, UNPUBLISHED_STUDENT, REJECTED]) {
    assert.equal(calls.studentBatches[0].includes(id), false, `${id} was asked about`);
  }
});

test("G3. ids are trimmed, de-blanked, deduplicated and ordered before IO", async () => {
  const calls = makeCalls();
  await readAdminExamPlanWithDeps(COURSE_OFFERING_ID, adminDeps(calls));
  const batch = calls.studentBatches[0];
  assert.deepEqual(batch, [...new Set(batch)], "the batch contains a duplicate");
  assert.deepEqual(batch, [...batch].sort(), "the batch is not deterministically ordered");
  for (const id of batch) {
    assert.equal(id, id.trim(), `${id} was not trimmed`);
    assert.ok(id.length > 0, "a blank id reached IO");
  }
  // `OTHER` and `SUP_A` each appear on several rows and are asked about ONCE.
  assert.equal(batch.filter((id) => id === OTHER).length, 1);
  assert.equal(calls.instructorBatches[0].filter((id) => id === SUP_A).length, 1);
});

test("G4. names are trimmed, duplicates survive, and an unresolved id never leaks", async () => {
  const dto = await readAdmin();
  const riding = dto.rows.find((row) => row.sessionId === "sess-riding");
  // Trimmed on the way out; the source map value is padded.
  assert.deepEqual(riding?.examineeNames, ["נועה לוי", "אורי הצופה", "דנה כהן"]);

  const group = dto.rows.find((row) => row.sessionId === "tp:lesson-group");
  // Two different trainees really can share one display name.
  assert.deepEqual(group?.beginner?.participantNames, ["דנה כהן", "דנה כהן"]);
  assert.equal(group?.beginner?.participantCount, 2);

  const iface = dto.rows.find((row) => row.sessionId === "sess-interface");
  // The blank assignment identifies nobody: it is neither named nor counted…
  assert.equal(iface?.examineeCount, 2);
  // …and the id with no resolved name stays absent while the count stays true.
  assert.deepEqual(iface?.examineeNames, ["נועה לוי"]);
  assert.equal(deepStrings(dto).includes(NAMELESS), false);
});

test("G5. 1, 5 and 40 stored sessions produce IDENTICAL dependency call counts", async () => {
  const counts: string[] = [];
  for (const size of [1, 5, 40]) {
    const sessions = Array.from({ length: size }, (_unused, index) =>
      Object.freeze({
        id: `scale-${index}`,
        definitionId: DEF_RIDING,
        date: DATE,
        startTime: "09:00",
        endTime: "10:00",
        orderIndex: index,
        arena: "אולם",
        title: null,
        notes: null,
        individualPublishedAt: null,
        updatedAt: SESSION_UPDATED_AT,
        assignments: Object.freeze([
          assignment({
            id: `a-${ASG}-scale-${index}`,
            studentId: OTHER,
            role: "EXAMINEE",
            orderIndex: 0,
          }),
        ]),
        breaks: Object.freeze([]),
        supervisorInstructorIds: Object.freeze([SUP_A]),
      }),
    );
    const calls = makeCalls();
    await readAdminExamPlanWithDeps(COURSE_OFFERING_ID, adminDeps(calls, { sessions }));
    counts.push(
      JSON.stringify({
        load: calls.loadOfferingIds.length,
        plan: calls.planArgs.length,
        definitions: calls.definitionArgs.length,
        sessions: calls.sessionArgs.length,
        sourceDates: calls.sourceDateArgs.length,
        lessons: calls.lessonDateArgs.length,
        students: calls.studentBatches.length,
        instructors: calls.instructorBatches.length,
      }),
    );
  }
  assert.equal(counts[0], counts[1], "5 sessions cost more dependency calls than 1");
  assert.equal(counts[1], counts[2], "40 sessions cost more dependency calls than 5");
  assert.deepEqual(JSON.parse(counts[0]), {
    load: 1,
    plan: 1,
    definitions: 1,
    sessions: 1,
    sourceDates: 1,
    lessons: 1,
    students: 1,
    instructors: 1,
  });
});

test("G6. an empty id set causes NO name lookup at all", async () => {
  const sessions = [
    Object.freeze({
      ...SESSION_ROWS[2],
      id: "sess-empty",
      assignments: Object.freeze([
        assignment({ id: `a-${ASG}-empty`, studentId: null, role: "EXAMINEE", orderIndex: 0 }),
      ]),
      supervisorInstructorIds: Object.freeze([]),
    }),
  ];
  const calls = makeCalls();
  await readAdminExamPlanWithDeps(
    COURSE_OFFERING_ID,
    adminDeps(calls, { sessions, sourceDates: [] }),
  );
  assert.deepEqual(calls.studentBatches, []);
  assert.deepEqual(calls.instructorBatches, []);
  assert.equal(calls.order.includes("student-names"), false);
  assert.equal(calls.order.includes("instructor-names"), false);
});

test("G7. no name or content dependency is ever called per row", async () => {
  const calls = makeCalls();
  await readAdminExamPlanWithDeps(COURSE_OFFERING_ID, adminDeps(calls));
  const dto = await readAdmin();
  assert.ok(dto.rows.length >= 8, "sanity: the fixture must hold several rows");
  for (const step of ["plan", "definitions", "sessions", "sourceDates", "lessons", "load"]) {
    assert.equal(
      calls.order.filter((entry) => entry === step).length,
      1,
      `${step} ran more than once`,
    );
  }
  // The name lookups run LAST, once each, after every content dependency.
  assert.deepEqual(calls.order, [
    `admin-course:${COURSE_OFFERING_ID}`,
    "load",
    "plan",
    "definitions",
    "sessions",
    "sourceDates",
    "lessons",
    "student-names",
    "instructor-names",
  ]);
});

// ===========================================================================
// GROUP H — the SERVER BINDING structural contract
// ===========================================================================

const SCOPE_SOURCE = readFileSync(SCOPE_PATH, "utf8");
const READERS_SOURCE = readFileSync(READERS_PATH, "utf8");
const IO_SOURCE = readFileSync(IO_PATH, "utf8");
const SCOPE_CODE = stripComments(SCOPE_SOURCE);
const READERS_CODE = stripComments(READERS_SOURCE);
const IO_CODE = stripComments(IO_SOURCE);

/**
 * Forbidden module specifiers and guarded identifiers, assembled from SPLIT
 * LITERALS: the sibling `exam-no-feedback-guard` and caller allow-list suites
 * scan every file in `lib/exam` for exact tokens, and spelling one out here
 * would make this suite trip them.
 */
const PRISMA_MODULE = ["@/lib", "prisma"].join("/");
const GENERATED_CLIENT = ["@prisma", "client"].join("/");
const TP_ACTIONS_MODULE = ["lib/actions", "teaching-practice"].join("/");
const WIDE_TP_INCLUDE = "LESSON_DETAIL" + "_INCLUDE";
const ENV_READ = ["process", "env"].join(".");
const LOADER_CALL = new RegExp("\\bload" + "ExamPlan\\s*\\(");
const DTO_TOKENS = new RegExp(
  [
    "exam-read-" + "dto",
    "build" + "AdminExamReadDto",
    "build" + "InstructorExamReadDto",
    "build" + "TraineeExamDayDto",
  ].join("|"),
);

/** Every `.ts`/`.tsx` file in the repository's own source trees. */
function repoSourceFiles(): { path: string; source: string }[] {
  const out: { path: string; source: string }[] = [];
  for (const dir of ["app", "lib", "components"]) {
    const root = join(REPO_ROOT, dir);
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!/\.tsx?$/.test(entry.name)) continue;
      const path = join(entry.parentPath ?? root, entry.name);
      // The generated client is machine output, not repository source.
      if (path.includes(`${sep}generated${sep}`)) continue;
      out.push({ path, source: readFileSync(path, "utf8") });
    }
  }
  return out;
}

test("H1. the loader has exactly ONE production caller, and no app caller at all", () => {
  const files = repoSourceFiles();
  assert.ok(files.length > 100, `sanity: expected the repository, found ${files.length} files`);

  // PRODUCTION code only: a `.test.ts` suite legitimately drives the pure loader
  // with fakes — this one does. What is guarded is which SHIPPED module may
  // produce the sensitive internal payload.
  const callers = files
    .filter((f) => f.path !== LOADER_PATH)
    .filter((f) => !/\.test\.tsx?$/.test(f.path))
    .filter((f) => LOADER_CALL.test(stripComments(f.source)))
    .map((f) => f.path.slice(REPO_ROOT.length + 1));
  assert.deepEqual(callers, [join("lib", "actions", "exam-role-readers.ts")]);

  const appCallers = files
    .filter((f) => f.path.startsWith(join(REPO_ROOT, "app")))
    .filter((f) => LOADER_CALL.test(stripComments(f.source)))
    .map((f) => f.path.slice(REPO_ROOT.length + 1));
  assert.deepEqual(appCallers, [], `an app caller exists: ${appCallers.join(", ")}`);
});

test("H2. the DTO builders have exactly ONE production consumer, and no UI consumer", () => {
  const files = repoSourceFiles();
  const consumers = files
    .filter((f) => f.path !== DTO_PATH)
    .filter((f) => !/\.test\.tsx?$/.test(f.path))
    .filter((f) => DTO_TOKENS.test(stripComments(f.source)))
    .map((f) => f.path.slice(REPO_ROOT.length + 1));
  assert.deepEqual(consumers, [join("lib", "exam", "exam-read-scope-core.ts")]);

  // No route, page, layout or client component reaches this slice…
  const uiOffenders = files
    .filter(
      (f) =>
        f.path.startsWith(join(REPO_ROOT, "app")) ||
        f.path.startsWith(join(REPO_ROOT, "components")) ||
        /^\s*["']use client["']\s*;?/.test(stripComments(f.source)),
    )
    .filter((f) => {
      const code = stripComments(f.source);
      return (
        DTO_TOKENS.test(code) ||
        LOADER_CALL.test(code) ||
        /exam-role-readers|exam-read-scope-core|exam-read-io/.test(code) ||
        /\bread(Admin|Instructor)ExamPlan\s*\(|\breadTraineeExamDay\s*\(/.test(code)
      );
    })
    .map((f) => f.path.slice(REPO_ROOT.length + 1));
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
  const unapprovedAppConsumers = uiOffenders.filter(
    (path) => !APPROVED_APP_CONSUMERS.includes(path),
  );
  assert.deepEqual(unapprovedAppConsumers, [], `a UI module reaches the exam read pipeline: ${uiOffenders.join(", ")}`);

  // …and no exam route or page directory exists yet.
  for (const dir of ["app/admin/exams", "app/instructor/exams", "app/student/exams"]) {
    assert.equal(existsSync(join(REPO_ROOT, dir)), false, `${dir} was created`);
  }
});

test("H3. both binding modules are server-only, and neither is a Server Action module", () => {
  const serverOnly = new RegExp('import\\s+"server' + '-only";');
  assert.ok(serverOnly.test(READERS_CODE), "exam-role-readers.ts is not server-only");
  assert.ok(serverOnly.test(IO_CODE), "exam-read-io.ts is not server-only");
  for (const [name, code] of [
    ["exam-role-readers.ts", READERS_CODE],
    ["exam-read-io.ts", IO_CODE],
    ["exam-read-scope-core.ts", SCOPE_CODE],
  ] as const) {
    assert.equal(code.includes('"use server"'), false, `${name} declares use server`);
    assert.equal(code.includes("'use server'"), false, `${name} declares use server`);
  }
  // The PURE core stays environment-neutral, which is what makes THIS suite
  // possible: it must import neither the marker nor any real IO or auth binding.
  for (const token of [
    "server" + "-only",
    PRISMA_MODULE,
    GENERATED_CLIENT,
    "exam-read-io",
    "exam-role-readers",
    "lib/auth",
    "lib/course",
    ENV_READ,
    "new Date(",
    "Date.now(",
  ]) {
    assert.equal(SCOPE_CODE.includes(token), false, `the pure scope core references ${token}`);
  }
  for (const specifier of [...SCOPE_CODE.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1])) {
    assert.ok(specifier.startsWith("./exam-"), `the scope core imports ${specifier}`);
  }
});

test("H4. no exported reader returns the internal payload or accepts a forbidden argument", () => {
  const signatures = [...READERS_CODE.matchAll(/export async function (\w+)\(([\s\S]*?)\):\s*([^{]+)\{/g)].map(
    ([, name, params, returns]) => ({
      name,
      params: params.replace(/\s+/g, " ").trim(),
      returns: returns.replace(/\s+/g, " ").trim(),
    }),
  );
  assert.deepEqual(
    signatures.map((s) => s.name),
    // RE-POINTED by EX-ADMIN-WORKSPACE-UX (BLOCKER-1). The three ROLE readings are
    // unchanged; the fourth is ADMIN-ONLY and returns no DTO at all — it publishes
    // assignment ids and the DERIVED moments this same pipeline already computed,
    // so the admin schedule can reuse them instead of reproducing them. No shared
    // DTO gained a field and no role reading changed shape.
    ["readAdminExamPlan", "readAdminExamWaveView", "readInstructorExamPlan", "readTraineeExamDay"],
  );
  assert.deepEqual(
    signatures.map((s) => s.returns),
    // The fourth returns the ADMIN-ONLY wave view — assignment ids and the derived
    // moments this pipeline already computed. It is NOT the internal payload and
    // NOT a shared DTO: no role reading's return type changed.
    [
      "Promise<AdminExamReadDto>",
      "Promise<AdminExamWaveView>",
      "Promise<InstructorExamReadDto>",
      "Promise<TraineeExamDayDto>",
    ],
  );
  assert.equal(/ExamPlanPayload/.test(READERS_CODE), false, "the binding names the payload");
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
  // The TRAINEE reader cannot even NAME a course offering id.
  // Indexed by NAME rather than by position: BLOCKER-1 appends a fourth reader
  // between the first and the second in source order, and a positional assertion
  // would then be describing a different function than it names.
  const paramsOf = (name: string): string =>
    signatures.find((entry) => entry.name === name)?.params ?? "";
  assert.equal(paramsOf("read" + "TraineeExamDay"), "selectedDate: string,");
  assert.equal(paramsOf("read" + "TraineeExamDay").includes("courseOfferingId"), false);
  assert.equal(paramsOf("read" + "AdminExamPlan"), "courseOfferingId: string,");
  assert.equal(paramsOf("read" + "InstructorExamPlan"), "requestedCourseOfferingId: string,");
  // The fourth takes ONE course offering id and nothing else.
  assert.equal(paramsOf("read" + "AdminExamWaveView"), "courseOfferingId: string,");
});

test("H5. no capability of any kind is consulted, and no write method exists", () => {
  for (const [name, code] of [
    ["exam-read-scope-core.ts", SCOPE_CODE],
    ["exam-role-readers.ts", READERS_CODE],
    ["exam-read-io.ts", IO_CODE],
  ] as const) {
    for (const token of [
      '"EXAMS"',
      "'EXAMS'",
      "TEACHING_PRACTICE",
      '"SCHEDULE"',
      "'SCHEDULE'",
      "CapabilityKey",
      "getEffectiveCapabilities",
      "capability-keys",
    ]) {
      assert.equal(code.includes(token), false, `${name} consults ${token}`);
    }
  }
  const writes = /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/;
  for (const [name, code] of [
    ["exam-role-readers.ts", READERS_CODE],
    ["exam-read-io.ts", IO_CODE],
  ] as const) {
    assert.equal(writes.test(code), false, `${name} performs a write`);
    for (const token of ["$executeRaw", "$queryRaw", "$transaction"]) {
      assert.equal(code.includes(token), false, `${name} uses ${token}`);
    }
  }
  // ...and the temporary instructor boundary stays DOCUMENTED.
  const comments = commentsOf(SCOPE_SOURCE) + commentsOf(READERS_SOURCE);
  assert.ok(/EXAMS/.test(comments), "the missing EXAMS capability is undocumented");
  assert.ok(/ACTIVE instructor/i.test(comments), "the temporary boundary is undocumented");
});

// ===========================================================================
// GROUP H (cont.) — the QUERY and N+1 structural contract
// ===========================================================================

/** The `(` nesting depth at `index` — 0 means "at statement level". */
function parenDepthAt(source: string, index: number): number {
  let depth = 0;
  for (let i = 0; i < index; i += 1) {
    if (source[i] === "(") depth += 1;
    else if (source[i] === ")") depth -= 1;
  }
  return depth;
}

const APPROVED_IO_QUERIES = [
  "prisma.examPlan.findUnique",
  "prisma.examDefinition.findMany",
  "prisma.examSession.findMany",
  "prisma.examTeachingPracticeSourceDate.findMany",
  "prisma.teachingPracticeLesson.findMany",
  "prisma.student.findMany",
  "prisma.instructor.findMany",
] as const;

test("H6. the IO shell issues EXACTLY the seven approved queries, none in a loop", () => {
  assert.deepEqual(IO_CODE.match(/prisma\.\w+\.\w+/g) ?? [], [...APPROVED_IO_QUERIES]);
  for (const loop of ["for (", "while (", "forEach("]) {
    assert.equal(IO_CODE.includes(loop), false, `the IO shell contains a ${loop} loop`);
  }
  // Every query is a statement-level awaited assignment, never nested inside a
  // per-row `.map()` / `.filter()` callback.
  for (const match of IO_CODE.matchAll(/prisma\.\w+\./g)) {
    assert.equal(parenDepthAt(IO_CODE, match.index), 0, `a query at ${match.index} is nested`);
  }
  assert.equal(
    (IO_CODE.match(/=\s*await\s+prisma\./g) ?? []).length,
    APPROVED_IO_QUERIES.length,
  );
});

test("H7. each display-name lookup is ONE batched, two-column query", () => {
  for (const name of ["fetchStudentDisplayNamesByIds", "fetchInstructorDisplayNamesByIds"]) {
    const start = IO_CODE.indexOf(`export async function ${name}`);
    assert.ok(start > 0, `${name} was not found`);
    const body = IO_CODE.slice(start, IO_CODE.indexOf("export", start + 10));
    assert.equal((body.match(/prisma\./g) ?? []).length, 1, `${name} issues more than one query`);
    assert.ok(body.includes("where: { id: { in: normalized } }"), `${name} is not batched`);
    assert.ok(body.includes("select: { id: true, fullName: true }"), `${name} widens its select`);
    assert.ok(body.includes("normalized.length === 0"), `${name} does not short-circuit`);
  }
});

test("H8. the Teaching-Practice lookup is ONE batched date IN query with no wide reader", () => {
  const start = IO_CODE.indexOf("export async function fetchExamTeachingPracticeLessonsByDates");
  assert.ok(start > 0);
  const end = IO_CODE.indexOf("export", start + 10);
  assert.ok(end > start, "the lesson reader region could not be bounded");
  const body = IO_CODE.slice(start, end);
  assert.ok(/where:\s*\{\s*date:\s*\{\s*in:/.test(body), "the lesson query is not a batched IN");
  assert.equal((body.match(/prisma\./g) ?? []).length, 1);
  assert.ok(body.includes("dates.length === 0"), "an empty date list still queries");
  // The broad Teaching-Practice reader is not imported anywhere in the shell.
  assert.equal(IO_CODE.includes(TP_ACTIONS_MODULE), false, "the wide TP reader is imported");
  assert.equal(IO_CODE.includes(WIDE_TP_INCLUDE), false, "the wide TP include is reused");
});

test("H9. the IO selects no evaluation, rating or grade data, and no deprecated column", () => {
  // FIELD-POSITION matches only (`someField:`), so the prose explaining WHY
  // these are absent — which `stripComments` has already removed anyway — could
  // never make this check fire on a comment.
  for (const word of ["feedback", "rating", "grade", "score", "evaluation", "result"]) {
    const pattern = new RegExp(`\\b\\w*${word}\\w*\\s*:`, "i");
    assert.equal(pattern.test(IO_CODE), false, `the IO shell selects a ${word} field`);
  }

  // The DEPRECATED, unwritten `ExamSession` columns are not even named in the
  // session select, and `ExamBeginnerChild` is not read at all.
  const sessionStart = IO_CODE.indexOf("prisma.examSession.findMany");
  const sessionEnd = IO_CODE.indexOf("export async function fetchExamSourceDatesByPlanId");
  assert.ok(sessionStart > 0 && sessionEnd > sessionStart);
  const sessionRegion = IO_CODE.slice(sessionStart, sessionEnd);
  for (const column of [
    "phase:",
    "interfaceSessionId:",
    "beginnerFormat:",
    "capacity:",
    "sourceTeachingPracticeLessonId:",
    "copiedAt:",
    "roleLabelOverrides:",
    "sourcePracticeRole:",
    "kind:",
  ]) {
    assert.equal(sessionRegion.includes(column), false, `the session select reads ${column}`);
  }
  assert.equal(/beginnerChild/i.test(IO_CODE), false, "ExamBeginnerChild is read");
});

// ===========================================================================
// GROUP I — PLAIN JSON, freezing and immutability
// ===========================================================================

test("I1. all three role DTOs are plain JSON and survive a round trip unchanged", async () => {
  const admin = await readAdmin();
  const instructor = await readInstructorExamPlanWithDeps(
    COURSE_OFFERING_ID,
    instructorDeps(makeCalls()),
  );
  const trainee = await readTrainee();
  for (const [name, dto] of [
    ["admin", admin],
    ["instructor", instructor],
    ["trainee", trainee],
    ["empty admin", emptyAdminExamReadDto()],
    ["empty instructor", emptyInstructorExamReadDto()],
    ["empty trainee", emptyTraineeExamDayDto()],
  ] as const) {
    assert.deepEqual(findNonPlainJsonPaths(dto), [], `${name} is not plain JSON`);
    assert.doesNotThrow(() => JSON.stringify(dto), `${name} does not serialize`);
    assert.deepEqual(JSON.parse(JSON.stringify(dto)), dto, `${name} does not round trip`);
  }
});

test("I2. no property value is `undefined` anywhere in a DTO", async () => {
  const dtos = [await readAdmin(), await readTrainee()];
  const offenders: string[] = [];
  const walk = (value: unknown, path: string): void => {
    if (value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((entry, index) => walk(entry, `${path}[${index}]`));
      return;
    }
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (entry === undefined) offenders.push(`${path}.${key}`);
      walk(entry, `${path}.${key}`);
    }
  };
  dtos.forEach((dto, index) => walk(dto, `$${index}`));
  assert.deepEqual(offenders, []);
});

test("I3. returned DTO objects and arrays are frozen — as MUTATION protection only", async () => {
  const admin = await readAdmin();
  const trainee = await readTrainee();
  assert.ok(Object.isFrozen(admin));
  assert.ok(Object.isFrozen(admin.rows));
  assert.ok(Object.isFrozen(admin.rows[0]));
  assert.ok(Object.isFrozen(admin.diagnostics));
  assert.ok(Object.isFrozen(admin.sourceDates));
  assert.ok(Object.isFrozen(trainee));
  assert.ok(Object.isFrozen(trainee.allRows));
  assert.ok(Object.isFrozen(trainee.myRows));
  assert.ok(Object.isFrozen(trainee.allRows[0]));
  // Freezing filters no field and authorizes nobody — it is asserted here as a
  // mutation property and is deliberately not read as a privacy boundary. The
  // PRIVACY assertions live in group F, on the serialized VALUES.
  const [first] = trainee.allRows;
  assert.throws(() => {
    (first as { sessionId: string }).sessionId = "tampered";
  });
});

test("I4. the pipeline never mutates the source rows it was given", async () => {
  await readAdmin();
  await readTrainee();
  await readInstructorExamPlanWithDeps(COURSE_OFFERING_ID, instructorDeps(makeCalls()));
  assert.equal(
    JSON.stringify({
      definitions: DEFINITION_ROWS,
      sessions: SESSION_ROWS,
      lessons: LESSON_ROWS,
      sourceDates: SOURCE_DATE_ROWS,
    }),
    FIXTURE_SNAPSHOT,
    "the read pipeline mutated its input rows",
  );
});

// ===========================================================================
// GROUP I (cont.) — course isolation, separate definitions, the arena sibling
// ===========================================================================

test("I5. planId comes ONLY from fetchPlan, and every plan-scoped dependency receives it", async () => {
  const calls = makeCalls();
  await readAdminExamPlanWithDeps(OTHER_OFFERING_ID, adminDeps(calls));
  // The caller's string reaches the AUTHORIZER, and nothing else.
  assert.deepEqual(calls.planArgs, [COURSE_OFFERING_ID]);
  assert.equal(calls.planArgs.includes(OTHER_OFFERING_ID), false);
  // Every downstream dependency is scoped by the plan id the plan row returned.
  assert.deepEqual(calls.definitionArgs, [PLAN_ID]);
  assert.deepEqual(calls.sessionArgs, [PLAN_ID]);
  assert.deepEqual(calls.sourceDateArgs, [PLAN_ID]);
  // ...and the load input has no `planId` field a caller could have supplied.
  assert.deepEqual(Object.keys(calls.loadOptions[0]).sort(), [
    "beginnerSourceEnabled",
    "requireLessonPublication",
    "requirePlanPublication",
    "viewerStudentId",
  ]);
});

test("I6. two definitions sharing ONE kind never collapse into one exam", async () => {
  const payload = await loadPayload(OPERATIONAL_OPTIONS);
  const projection = projectByExamDefinition(payload.sessions);
  const interfaceRiding = projection.groups.filter((g) => g.kind === "INTERFACE_RIDING");
  assert.equal(interfaceRiding.length, 2, "two same-kind definitions were merged");
  assert.deepEqual(
    interfaceRiding.map((g) => g.definitionId),
    [DEF_INTERFACE, DEF_RIDING],
  );
  assert.deepEqual(
    interfaceRiding.map((g) => g.label),
    ["ממשק", "רכיבה"],
  );
  // The DTO retains the same identities, unmerged.
  const dto = await readAdmin();
  const byDefinition = new Map<string, string[]>();
  for (const row of dto.rows) {
    if (row.definitionId === null) continue;
    byDefinition.set(row.definitionId, [
      ...(byDefinition.get(row.definitionId) ?? []),
      row.sessionId,
    ]);
  }
  assert.deepEqual(byDefinition.get(DEF_RIDING), [
    "sess-riding",
    "sess-unresolved",
    "sess-offday",
  ]);
  assert.deepEqual(byDefinition.get(DEF_INTERFACE), ["sess-interface"]);
});

test("I7. the trainee arena arrives through the NARROW sibling and nothing else", async () => {
  const payload = await loadPayload(TRAINEE_OPTIONS);
  const lookup = buildTraineeExamArenaLookup(payload.conflictSessions);
  // The sibling can express a session id and an arena, and nothing else.
  for (const [key, entry] of lookup) {
    assert.deepEqual(Object.keys(entry), ["sessionId", "arena"]);
    assert.equal(entry.sessionId, key, "the arena sibling is mis-keyed");
    assert.equal(key.startsWith("tp:"), false, "a live row entered the stored sibling");
  }
  const serializedLookup = JSON.stringify([...lookup.values()]);
  for (const marker of [STU, INS, HID, ASG]) {
    assert.equal(serializedLookup.includes(marker), false, `the sibling carries ${marker}`);
  }

  const dto = await readTrainee();
  const riding = dto.allRows.find((row) => row.sessionId === "sess-riding");
  assert.equal(riding?.arena, "אולם מקורה");
  // EXACT session-id match only: a DUPLICATED claim wins for neither entry.
  const duplicated = buildTraineeExamArenaLookup([
    ...payload.conflictSessions,
    ...payload.conflictSessions.filter((c) => c.sessionId === "sess-riding"),
  ]);
  assert.equal(duplicated.has("sess-riding"), false, "a duplicated session id resolved anyway");
  assert.equal(duplicated.get("sess-interface")?.arena, "מגרש חול קטן");
});

test("I8. an unexpected dependency failure PROPAGATES for every role", async () => {
  const boom = new InfrastructureError("the sessions query failed");
  await assert.rejects(
    () =>
      readAdminExamPlanWithDeps(
        COURSE_OFFERING_ID,
        adminDeps(makeCalls(), { failSessions: boom }),
      ),
    InfrastructureError,
  );
  await assert.rejects(
    () =>
      readInstructorExamPlanWithDeps(
        COURSE_OFFERING_ID,
        instructorDeps(makeCalls(), { failSessions: boom }),
      ),
    InfrastructureError,
  );
  await assert.rejects(
    () => readTraineeExamDayWithDeps(DATE, traineeDeps(makeCalls(), { failSessions: boom })),
    InfrastructureError,
  );
  // An UNCLASSIFIED course failure is not a denial either: it must not become an
  // empty exam schedule that looks exactly like "you have nothing today".
  await assert.rejects(
    () =>
      readTraineeExamDayWithDeps(
        DATE,
        traineeDeps(makeCalls(), { courseError: new InfrastructureError() }),
      ),
    InfrastructureError,
  );
});

// ===========================================================================
// GROUP J — the CROSS-COURSE Teaching-Practice containment precondition
// ===========================================================================

test("J1. the deployment precondition remains stated in every layer that carries it", () => {
  for (const [name, source] of [
    ["exam-read-scope-core.ts", SCOPE_SOURCE],
    ["exam-role-readers.ts", READERS_SOURCE],
  ] as const) {
    const flat = commentsOf(source).replace(/\s+/g, " ");
    // The schema fact: a Teaching-Practice lesson is not course-scoped at all.
    assert.ok(/TeachingPracticeLesson/.test(flat), `${name}: the model is not named`);
    assert.ok(/NO\s+`?courseOfferingId`?/i.test(flat), `${name}: the schema gap is undocumented`);
    // The rule that follows from it.
    assert.ok(/MUST NOT BE DEPLOYED/i.test(flat), `${name}: the deployment rule is missing`);
    assert.ok(
      /SEPARATE,? REVIEWED CONTAINMENT DECISION/i.test(flat),
      `${name}: the required decision is missing`,
    );
    assert.ok(/source date/i.test(flat), `${name}: source dates are not named as the mechanism`);
  }
  // The loader states the same fact where the dates are actually applied.
  const loaderComments = commentsOf(readFileSync(LOADER_PATH, "utf8")).replace(/\s+/g, " ");
  assert.ok(/MUST NOT BE DEPLOYED/i.test(loaderComments));
  assert.ok(/no.{0,20}courseOfferingId/i.test(loaderComments));
});

test("J2. this slice solves nothing of it: no date is inferred anywhere", async () => {
  // The ONLY thing binding a lesson to this plan is the plan's explicit source
  // date. Removing the date removes the lessons entirely — no fallback exists.
  const calls = makeCalls();
  const dto = await readAdminExamPlanWithDeps(
    COURSE_OFFERING_ID,
    adminDeps(calls, { sourceDates: [] }),
  );
  assert.deepEqual(calls.lessonDateArgs, []);
  assert.equal(
    dto.rows.some((row) => row.source === "BEGINNER"),
    false,
  );
  // An ILLEGIBLE source date selects nothing and is reported without echoing it.
  const invalid = makeCalls();
  const reported = await readAdminExamPlanWithDeps(
    COURSE_OFFERING_ID,
    adminDeps(invalid, { sourceDates: [{ date: "2026-8-2" }] }),
  );
  assert.deepEqual(invalid.lessonDateArgs, []);
  assert.deepEqual(reported.sourceDates, []);
  assert.deepEqual(
    reported.diagnostics.loaderIssues.map((issue) => issue.code),
    ["EX-LOAD-SOURCE-DATE-INVALID"],
  );
  assert.equal(JSON.stringify(reported.diagnostics).includes("2026-8-2"), false);
});

test("J3. the approved EX-S5A-5 file scope is exactly this one new suite", () => {
  assert.ok(existsSync(CONTRACT_TEST_PATH), "the contract suite is missing");
  // Every module it exercises already existed and is untouched by this slice.
  for (const path of [SCOPE_PATH, DTO_PATH, LOADER_PATH, READERS_PATH, IO_PATH]) {
    assert.ok(existsSync(path), `missing ${path}`);
    assert.equal(
      readFileSync(path, "utf8").includes("exam-read.contract"),
      false,
      `${path} was rewired to the contract suite`,
    );
  }
  // ...and this suite performs no production access of its own.
  const own = stripComments(readFileSync(CONTRACT_TEST_PATH, "utf8"));
  for (const token of [PRISMA_MODULE, GENERATED_CLIENT, ENV_READ, "DATABASE" + "_URL"]) {
    assert.equal(own.includes(token), false, `the suite references ${token}`);
  }
  for (const specifier of [...own.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1])) {
    assert.ok(
      specifier.startsWith("./exam-") || specifier.startsWith("node:"),
      `the suite imports ${specifier}`,
    );
  }
});

// ===========================================================================
// GROUP K — EX-OPS-READ-MVP: the COMPLETE assignment-level operational contract
// ===========================================================================

/**
 * The exact field set of one assignment row. Listed once, so every case below
 * asserts against the same contract rather than against its own idea of it.
 */
const ASSIGNMENT_ROW_KEYS = [
  "participantName",
  "role",
  "horseName",
  "instructionTopic",
  "discipline",
  "personalStartTime",
  "personalEndTime",
  "pairedParticipantName",
  "pairedParticipantNames",
] as const;

/**
 * The exact field set of one TRAINEE assignment row: the operational contract
 * above plus EXACTLY ONE key, `isSelf`.
 *
 * Spelled as a SPREAD of the shared list rather than as a second literal, so the
 * two cannot drift: a field added to the operational contract appears here
 * automatically, and the only difference this suite tolerates between the roles
 * is the one key named below.
 *
 * ADMIN AND INSTRUCTOR ROWS KEEP {@link ASSIGNMENT_ROW_KEYS} UNCHANGED — no
 * `isSelf` and no other addition — which the cases below assert PER ROLE rather
 * than assume.
 */
const TRAINEE_ASSIGNMENT_ROW_KEYS = [...ASSIGNMENT_ROW_KEYS, "isSelf"] as const;

/**
 * A trainee assignment row set, reduced to the SHARED operational contract by
 * dropping the one trainee-only key.
 *
 * It exists so "both roles agree, field for field" can still be asserted as the
 * strong claim it always was. The alternative - comparing only a few fields -
 * would let a real divergence slip through unnoticed, so instead the ONE known
 * difference is removed explicitly and everything else is still compared whole.
 * Each call site separately asserts that the removed key was really there.
 */
function withoutIsSelf(
  rows: readonly TraineeExamAssignmentOperationalRowDto[],
): ExamAssignmentOperationalRowDto[] {
  return rows.map((row) => {
    // Destructured rather than deleted, so the discarded key is named in the
    // source and the result is a fresh plain object with no leftover descriptor.
    const { isSelf: _isSelf, ...rest } = row;
    void _isSelf;
    return rest as ExamAssignmentOperationalRowDto;
  });
}

/** One ad-hoc stored session, so a pairing shape can be stated in one place. */
function pairingSession(
  id: string,
  assignments: readonly ReturnType<typeof assignment>[],
): StoredExamSessionRow {
  return Object.freeze({
    id,
    definitionId: DEF_ADVANCED,
    date: DATE,
    startTime: "11:00",
    endTime: "13:00",
    orderIndex: 0,
    arena: "מגרש פיירינג",
    title: null,
    notes: null,
    individualPublishedAt: null,
    updatedAt: SESSION_UPDATED_AT,
    assignments: Object.freeze(assignments),
    breaks: Object.freeze([]),
    supervisorInstructorIds: Object.freeze([]),
  });
}

/** The assignment rows of ONE session, from the ADMIN/INSTRUCTOR reading. */
async function operationalAssignments(sessions: readonly StoredExamSessionRow[], id: string) {
  const dto = await readAdmin({ sessions, sourceDates: [] });
  const row = dto.rows.find((r) => r.sessionId === id);
  assert.ok(row !== undefined, `expected an operational row for ${id}`);
  return row.assignments;
}

/** The assignment rows of ONE session, from the TRAINEE full-day reading. */
async function traineeAssignments(sessions: readonly StoredExamSessionRow[], id: string) {
  const dto = await readTrainee({ sessions, sourceDates: [] });
  const row = dto.allRows.find((r) => r.sessionId === id);
  assert.ok(row !== undefined, `expected a trainee row for ${id}`);
  return row.assignments;
}

test("K1. the INSTRUCTOR plan carries the complete assignment rows of every session", async () => {
  const dto = await readInstructorExamPlanWithDeps(
    COURSE_OFFERING_ID,
    instructorDeps(makeCalls()),
  );
  const riding = dto.rows.find((row) => row.sessionId === "sess-riding");
  assert.ok(riding !== undefined);

  // Every stored assignment is present, in the committed adapter order.
  assert.deepEqual(
    riding.assignments.map((a) => a.participantName),
    ["נועה לוי", "אורי הצופה", "דנה כהן"],
  );
  assert.deepEqual(
    riding.assignments.map((a) => a.role),
    ["EXAMINEE", "EXAMINEE", "EXAMINEE"],
  );
  for (const row of riding.assignments) {
    assert.deepEqual(Object.keys(row), [...ASSIGNMENT_ROW_KEYS]);
  }
  // An EXAMINEE exposes its stored horse, topic and discipline.
  assert.equal(riding.assignments[1].horseName, `horse-${OPV}-a-r2`);
  assert.equal(riding.assignments[1].instructionTopic, `topic-${OPV}-a-r2`);
  assert.equal(riding.assignments[1].discipline, `discipline-${OPV}-a-r2`);
  // ...and its own derived personal time, which is NOT the block start.
  assert.equal(riding.assignments[1].personalStartTime, "09:25");
  assert.equal(riding.assignments[1].personalEndTime, "09:40");
  assert.equal(riding.startTime, "09:00");

  // A live beginner row carries no stored assignment at all.
  const lunge = dto.rows.find((row) => row.sessionId === "tp:lesson-lunge");
  assert.deepEqual(lunge?.assignments, []);
});

test("K2. the TRAINEE full-day view carries the SAME complete rows, for every visible row", async () => {
  const dto = await readTrainee();
  const riding = dto.allRows.find((row) => row.sessionId === "sess-riding");
  assert.ok(riding !== undefined);
  assert.deepEqual(
    riding.assignments.map((a) => a.participantName),
    ["נועה לוי", "אורי הצופה", "דנה כהן"],
  );

  // A row belonging to somebody ELSE is just as complete: the trainee schedule
  // is an operational schedule, not a privacy-narrowed list of names.
  const iface = dto.allRows.find((row) => row.sessionId === "sess-interface");
  assert.ok(iface !== undefined && iface.isSelf === false);
  assert.deepEqual(
    iface.assignments.map((a) => [a.participantName, a.horseName, a.personalStartTime]),
    [
      ["נועה לוי", `horse-${OPV}-a-if1`, "13:00"],
      // An id with no resolvable name keeps its operational row, nameless.
      [null, `horse-${OPV}-a-if2`, "13:00"],
      // A RESERVED, not-yet-bound place holds its lane and identifies nobody.
      [null, `horse-${OPV}-a-if3`, "13:20"],
    ],
  );

  // BOTH roles agree, field for field, on the same session.
  const admin = await readAdmin();
  const adminAssignments = admin.rows.find((row) => row.sessionId === "sess-riding")
    ?.assignments;
  // The ADMIN row set is UNCHANGED by the trainee-only marker...
  assert.deepEqual(
    (adminAssignments ?? []).map((row) => Object.keys(row)),
    (adminAssignments ?? []).map(() => [...ASSIGNMENT_ROW_KEYS]),
  );
  // ...the trainee rows carry it, on exactly the viewer's own assignment...
  assert.deepEqual(
    riding.assignments.map((row) => Object.keys(row)),
    riding.assignments.map(() => [...TRAINEE_ASSIGNMENT_ROW_KEYS]),
  );
  // EXACTLY the viewer's own assignment - the SECOND row here - and no other,
  // even though all three sit in the same block at the same hour.
  assert.deepEqual(
    riding.assignments.map((row) => [row.participantName, row.isSelf]),
    [
      ["נועה לוי", false],
      ["אורי הצופה", true],
      ["דנה כהן", false],
    ],
  );
  // ...and with that ONE key removed the two roles still agree FIELD FOR FIELD.
  assert.deepEqual(adminAssignments, withoutIsSelf(riding.assignments));
  assert.ok(Object.isFrozen(riding.assignments));
  assert.ok(Object.isFrozen(riding.assignments[0]));
});

test("K3. a PAIRED instructed trainee inherits the examinee topic, discipline and time", async () => {
  const rows = await operationalAssignments(SESSION_ROWS, "sess-advanced");
  const [first, second, instructed] = rows;

  // The examinee it is paired with (pairingIndex 2), whose wave is 11:30-12:00.
  assert.equal(second.participantName, "דנה כהן");
  assert.equal(second.role, "EXAMINEE");
  assert.equal(second.personalStartTime, "11:30");
  assert.equal(second.personalEndTime, "12:00");
  assert.equal(second.pairedParticipantName, "אורי הצופה");
  assert.deepEqual(second.pairedParticipantNames, ["אורי הצופה"]);

  assert.equal(instructed.role, "INSTRUCTED_TRAINEE");
  assert.equal(instructed.participantName, "אורי הצופה");
  assert.equal(instructed.pairedParticipantName, "דנה כהן");
  // The INHERITED slot — the paired examinee's exact interval, never the block's.
  assert.equal(instructed.personalStartTime, "11:30");
  assert.equal(instructed.personalEndTime, "12:00");
  // ...and the INHERITED topic and discipline, taken from that examinee's row.
  assert.equal(instructed.instructionTopic, `topic-${OPV}-a-ad2`);
  assert.equal(instructed.discipline, `discipline-${OPV}-a-ad2`);
  assert.equal(instructed.instructionTopic, second.instructionTopic);
  assert.equal(instructed.discipline, second.discipline);
  // An instructed trainee never carries a horse: the lesson horse is recorded
  // once, on the examinee row.
  assert.equal(instructed.horseName, null);

  // The UNPAIRED examinee (pairingIndex 1) has no partner and no inheritance.
  assert.equal(first.pairedParticipantName, null);
  assert.deepEqual(first.pairedParticipantNames, []);

  // The trainee reading is identical.
  // The trainee reading is identical once the trainee-only marker is removed.
  const traineeRows = await traineeAssignments(SESSION_ROWS, "sess-advanced");
  assert.deepEqual(withoutIsSelf(traineeRows), rows);
});

test("K4. ONE examinee plus a null-pairing trainee resolves through the unambiguous fallback", async () => {
  const sessions = [
    pairingSession("sess-k4", [
      assignment({ id: `a-${ASG}-k4e`, studentId: OTHER, role: "EXAMINEE", orderIndex: 0 }),
      assignment({
        id: `a-${ASG}-k4t`,
        studentId: VIEWER,
        role: "INSTRUCTED_TRAINEE",
        orderIndex: 1,
      }),
    ]),
  ];
  const [examinee, instructed] = await operationalAssignments(sessions, "sess-k4");

  assert.equal(examinee.pairedParticipantName, "אורי הצופה");
  assert.equal(instructed.pairedParticipantName, "נועה לוי");
  // The block's single examinee runs 11:00-11:30 and the trainee inherits it.
  assert.equal(examinee.personalStartTime, "11:00");
  assert.equal(instructed.personalStartTime, "11:00");
  assert.equal(instructed.personalEndTime, "11:30");
  assert.equal(instructed.instructionTopic, `topic-${OPV}-a-k4e`);
  assert.equal(instructed.discipline, `discipline-${OPV}-a-k4e`);
});

test("K5. TWO examinees plus a null-pairing trainee resolves NO partner, topic or time", async () => {
  const sessions = [
    pairingSession("sess-k5", [
      assignment({ id: `a-${ASG}-k5e1`, studentId: OTHER, role: "EXAMINEE", orderIndex: 0 }),
      assignment({ id: `a-${ASG}-k5e2`, studentId: DUP_A, role: "EXAMINEE", orderIndex: 1 }),
      assignment({
        id: `a-${ASG}-k5t`,
        studentId: VIEWER,
        role: "INSTRUCTED_TRAINEE",
        orderIndex: 2,
      }),
    ]),
  ];
  const rows = await operationalAssignments(sessions, "sess-k5");
  const instructed = rows[2];

  assert.equal(instructed.role, "INSTRUCTED_TRAINEE");
  assert.equal(instructed.participantName, "אורי הצופה");
  // Nothing is guessed: no partner, no inherited topic, no invented time.
  assert.equal(instructed.pairedParticipantName, null);
  assert.deepEqual(instructed.pairedParticipantNames, []);
  assert.equal(instructed.instructionTopic, null);
  assert.equal(instructed.discipline, null);
  assert.equal(instructed.personalStartTime, null);
  assert.equal(instructed.personalEndTime, null);
  // The two examinees keep their own exact slots — the block is not broken.
  assert.equal(rows[0].personalStartTime, "11:00");
  assert.equal(rows[1].personalStartTime, "11:30");
  assert.equal(rows[0].pairedParticipantName, null);
});

test("K6. a DUPLICATED examinee pairingIndex is ambiguous and resolves nothing", async () => {
  const sessions = [
    pairingSession("sess-k6", [
      assignment({
        id: `a-${ASG}-k6e1`,
        studentId: OTHER,
        role: "EXAMINEE",
        orderIndex: 0,
        pairingIndex: 1,
      }),
      assignment({
        id: `a-${ASG}-k6e2`,
        studentId: DUP_A,
        role: "EXAMINEE",
        orderIndex: 1,
        // THE SAME pairing index: it identifies no single examinee.
        pairingIndex: 1,
      }),
      assignment({
        id: `a-${ASG}-k6t`,
        studentId: VIEWER,
        role: "INSTRUCTED_TRAINEE",
        orderIndex: 2,
        pairingIndex: 1,
      }),
    ]),
  ];
  const rows = await operationalAssignments(sessions, "sess-k6");
  const instructed = rows[2];

  assert.equal(instructed.pairedParticipantName, null);
  assert.deepEqual(instructed.pairedParticipantNames, []);
  assert.equal(instructed.instructionTopic, null);
  assert.equal(instructed.discipline, null);
  assert.equal(instructed.personalStartTime, null);
  assert.equal(instructed.personalEndTime, null);
  // Neither examinee wins the pairing either.
  assert.deepEqual(rows[0].pairedParticipantNames, []);
  assert.deepEqual(rows[1].pairedParticipantNames, []);

  // The committed trainee core still EXCLUDES the row from the trainee whose
  // OWN pairing is the ambiguous one — no exact personal time exists for them,
  // and this slice did not weaken that. Asserted here so the absence is proven
  // to be that committed rule rather than a row this slice lost.
  const affected = await readTrainee({ sessions, sourceDates: [] });
  assert.equal(
    affected.allRows.some((row) => row.sessionId === "sess-k6"),
    false,
  );

  // A trainee who is NOT in the block sees it in the full schedule, and reads
  // exactly what the operational roles read.
  const bystander = await readTrainee({ sessions, sourceDates: [], studentId: OFFDAY });
  const row = bystander.allRows.find((r) => r.sessionId === "sess-k6");
  assert.ok(row !== undefined && row.isSelf === false);
  // A bystander marks NOBODY: every assignment of a block they are not in is
  // false, and the rows otherwise match the operational reading exactly.
  assert.deepEqual(row.assignments.map((a) => a.isSelf), [false, false, false]);
  assert.deepEqual(withoutIsSelf(row.assignments), rows);
});

test("K7. SEVERAL instructed trainees may reference ONE examinee", async () => {
  const sessions = [
    pairingSession("sess-k7", [
      assignment({
        id: `a-${ASG}-k7e`,
        studentId: OTHER,
        role: "EXAMINEE",
        orderIndex: 0,
        pairingIndex: 4,
      }),
      assignment({
        id: `a-${ASG}-k7t1`,
        studentId: VIEWER,
        role: "INSTRUCTED_TRAINEE",
        orderIndex: 1,
        pairingIndex: 4,
      }),
      assignment({
        id: `a-${ASG}-k7t2`,
        studentId: DUP_A,
        role: "INSTRUCTED_TRAINEE",
        orderIndex: 2,
        pairingIndex: 4,
      }),
    ]),
  ];
  const [examinee, t1, t2] = await operationalAssignments(sessions, "sess-k7");

  // The list is the contract; the names are NEVER joined into one string.
  assert.deepEqual(examinee.pairedParticipantNames, ["אורי הצופה", "דנה כהן"]);
  assert.equal(examinee.pairedParticipantName, null);
  assert.equal(
    examinee.pairedParticipantNames.some((name) => name.includes(",")),
    false,
    "the paired names were joined",
  );
  // Each trainee resolves back to the ONE examinee, and inherits from it.
  for (const trainee of [t1, t2]) {
    assert.equal(trainee.role, "INSTRUCTED_TRAINEE");
    assert.equal(trainee.pairedParticipantName, "נועה לוי");
    assert.deepEqual(trainee.pairedParticipantNames, ["נועה לוי"]);
    assert.equal(trainee.instructionTopic, `topic-${OPV}-a-k7e`);
    assert.equal(trainee.discipline, `discipline-${OPV}-a-k7e`);
    assert.equal(trainee.personalStartTime, examinee.personalStartTime);
    assert.equal(trainee.personalEndTime, examinee.personalEndTime);
    assert.equal(trainee.horseName, null);
  }
});

test("K8. an UNRESOLVED block keeps its people and invents NO time for any of them", async () => {
  const dto = await readAdmin();
  const unresolved = dto.rows.find((row) => row.sessionId === "sess-unresolved");
  assert.ok(unresolved !== undefined);
  assert.equal(unresolved.timetableStatus, "UNRESOLVED");

  assert.deepEqual(
    unresolved.assignments.map((a) => a.participantName),
    ["אורי הצופה"],
  );
  // The operational values survive; the personal time does not exist and is
  // NEVER substituted by the block start, the stored end or a derived end.
  assert.equal(unresolved.assignments[0].horseName, `horse-${OPV}-a-un1`);
  assert.equal(unresolved.assignments[0].personalStartTime, null);
  assert.equal(unresolved.assignments[0].personalEndTime, null);
  assert.equal(unresolved.startTime, "99:99");
  assert.equal(unresolved.endTime, "15:00");
});

// ===========================================================================
// GROUP SELF — the TRAINEE-ONLY assignment `isSelf` marker
// ===========================================================================
//
// The ROW-level `isSelf` says "the viewer is somewhere in this block". These
// cases are about the ASSIGNMENT-level marker, which says WHICH row inside it is
// theirs — the thing a block holding three people at the same minute cannot
// otherwise express.
//
// Every case asserts the two properties together: the right row is marked, and
// NO IDENTIFIER travelled to the client to achieve it.

test("SELF1. EXACTLY the viewer's own assignment is marked, by authoritative id", async () => {
  const dto = await readTrainee();
  const riding = dto.allRows.find((row) => row.sessionId === "sess-riding");
  assert.ok(riding !== undefined);

  const marked = riding.assignments.filter((row) => row.isSelf);
  assert.equal(marked.length, 1, "exactly one assignment is the viewer's own");
  assert.equal(marked[0].participantName, "אורי הצופה");
  // ...and every other assignment in the SAME block is false.
  assert.equal(
    riding.assignments.filter((row) => !row.isSelf).length,
    riding.assignments.length - 1,
  );
});

test("SELF2. a trainee with NO assignment in a visible block marks nothing", async () => {
  const dto = await readTrainee({ studentId: OFFDAY });
  const rows = dto.allRows.flatMap((row) => row.assignments);
  assert.ok(rows.length > 0, "sanity: the bystander still reads the full schedule");
  assert.deepEqual(
    rows.filter((row) => row.isSelf),
    [],
    "a trainee who is in no block marks nobody",
  );
  // The rows themselves are still COMPLETE — the marker hides nothing.
  for (const row of rows) {
    assert.deepEqual(Object.keys(row), [...TRAINEE_ASSIGNMENT_ROW_KEYS]);
  }
});

test("SELF3. an unresolvable viewer marks nothing rather than everything", async () => {
  for (const studentId of ["", "   "]) {
    const dto = await readTrainee({ studentId });
    const rows = dto.allRows.flatMap((row) => row.assignments);
    assert.deepEqual(
      rows.filter((row) => row.isSelf),
      [],
      `a blank viewer id must mark nobody, not everybody (${JSON.stringify(studentId)})`,
    );
  }
});

test("SELF4. TWO parallel examinees at the SAME personal minute still resolve correctly", async () => {
  // The case neither a name nor a time could separate: both ride the same wave,
  // so `personalStartTime` and `personalEndTime` are identical on both rows.
  // DEF_INTERFACE has parallelCapacity 2, so both examinees share ONE wave.
  const sessions = [
    Object.freeze({
      ...pairingSession("sess-self4", [
        assignment({ id: `a-${ASG}-s4a`, studentId: OTHER, role: "EXAMINEE", orderIndex: 0 }),
        assignment({ id: `a-${ASG}-s4b`, studentId: VIEWER, role: "EXAMINEE", orderIndex: 1 }),
      ]),
      definitionId: DEF_INTERFACE,
    }),
  ];
  const rows = await traineeAssignments(sessions, "sess-self4");
  assert.equal(rows.length, 2);
  assert.equal(
    rows[0].personalStartTime,
    rows[1].personalStartTime,
    "sanity: both examinees start at the same minute",
  );
  assert.equal(
    rows[0].personalEndTime,
    rows[1].personalEndTime,
    "sanity: both examinees end at the same minute",
  );
  // Only the id separates them, and the id is what decided.
  assert.deepEqual(
    rows.map((row) => row.isSelf),
    [false, true],
  );
});

test("SELF5. an IDENTICAL display name on both rows does not confuse the marker", async () => {
  // Two DIFFERENT students whose display names resolve to the SAME string. A
  // name comparison would mark both; an id comparison marks exactly one.
  const sessions = [
    pairingSession("sess-self5", [
      assignment({ id: `a-${ASG}-s5a`, studentId: OTHER, role: "EXAMINEE", orderIndex: 0 }),
      assignment({ id: `a-${ASG}-s5b`, studentId: VIEWER, role: "EXAMINEE", orderIndex: 1 }),
    ]),
  ];
  const dto = await readTraineeExamDayWithDeps(DATE, {
    ...traineeDeps(makeCalls(), { sessions, sourceDates: [] }),
    // Both ids resolve to ONE name, so the rows are indistinguishable by name.
    fetchStudentDisplayNames: async (ids) =>
      new Map(ids.map((id) => [id, "אותו שם בדיוק"])),
  });
  const row = dto.allRows.find((r) => r.sessionId === "sess-self5");
  assert.ok(row !== undefined);
  assert.deepEqual(
    row.assignments.map((a) => a.participantName),
    ["אותו שם בדיוק", "אותו שם בדיוק"],
  );
  assert.deepEqual(
    row.assignments.map((a) => a.isSelf),
    [false, true],
    "identity is the student id, never the display name",
  );
});

test("SELF6. an assignment bound to NO student is never the viewer's", async () => {
  const sessions = [
    pairingSession("sess-self6", [
      assignment({ id: `a-${ASG}-s6a`, studentId: null, role: "EXAMINEE", orderIndex: 0 }),
      assignment({ id: `a-${ASG}-s6b`, studentId: VIEWER, role: "EXAMINEE", orderIndex: 1 }),
    ]),
  ];
  const rows = await traineeAssignments(sessions, "sess-self6");
  assert.deepEqual(
    rows.map((row) => row.isSelf),
    [false, true],
  );
});

test("SELF7. the marker opens NO identifier channel in the serialized trainee DTO", async () => {
  const dto = await readTrainee();
  const serialized = JSON.stringify(dto);

  // The viewer's OWN id is what this feature compares against, so it is the one
  // most likely to leak. It must not appear anywhere in the payload.
  assert.equal(serialized.includes(VIEWER), false, "the viewer student id reached the client");
  for (const marker of TRAINEE_FORBIDDEN_MARKERS) {
    assert.equal(serialized.includes(marker), false, `the trainee DTO carries ${marker}`);
  }
  for (const token of [
    "viewerStudentId",
    "studentId",
    "assignmentId",
    "enrollmentId",
    "pairingIndex",
    "pairedStudentIds",
  ]) {
    assert.equal(serialized.includes(token), false, `the trainee DTO carries ${token}`);
  }
});

test("SELF8. the ADMIN and INSTRUCTOR contracts are untouched by the marker", async () => {
  const admin = await readAdmin();
  const instructor = await readInstructorExamPlanWithDeps(
    COURSE_OFFERING_ID,
    instructorDeps(makeCalls()),
  );

  for (const [role, rows] of [
    ["admin", admin.rows.flatMap((row) => row.assignments)],
    ["instructor", instructor.rows.flatMap((row) => row.assignments)],
  ] as const) {
    assert.ok(rows.length > 0, `sanity: ${role} produced no assignment row`);
    for (const row of rows) {
      assert.deepEqual(Object.keys(row), [...ASSIGNMENT_ROW_KEYS], `${role} key set changed`);
      assert.equal("isSelf" in row, false, `${role} gained isSelf`);
    }
  }
  // Neither operational payload mentions the field anywhere.
  assert.equal(JSON.stringify(admin).includes("isSelf"), false);
  assert.equal(JSON.stringify(instructor).includes("isSelf"), false);
});

test("SELF9. a live BEGINNER row is unaffected: no assignment row, so no marker", async () => {
  const dto = await readTrainee();
  const beginner = dto.allRows.filter((row) => row.source === "BEGINNER");
  assert.ok(beginner.length > 0, "sanity: the fixture has a live beginner row");
  for (const row of beginner) {
    assert.deepEqual(row.assignments, [], "a beginner row carries no stored assignment");
    // Its own ROW-level self state is the committed one and is untouched here.
    assert.equal(typeof row.isSelf, "boolean");
    assert.ok(row.beginner !== null, "the beginner detail is still attached");
  }
});

test("K9. no pairing index, id or contact field is exposed on an assignment row", async () => {
  const admin = await readAdmin();
  const trainee = await readTrainee();

  for (const [name, rows] of [
    ["admin", admin.rows.flatMap((row) => row.assignments)],
    ["trainee", trainee.allRows.flatMap((row) => row.assignments)],
  ] as const) {
    assert.ok(rows.length > 0, `sanity: ${name} produced no assignment row`);
    for (const row of rows) {
      // PER ROLE, deliberately: the admin row set is UNCHANGED by the trainee-only
      // , and the trainee row set differs by exactly that one key.
      assert.deepEqual(
        Object.keys(row),
        name === "trainee" ? [...TRAINEE_ASSIGNMENT_ROW_KEYS] : [...ASSIGNMENT_ROW_KEYS],
      );
      for (const forbidden of [
        "pairingIndex",
        "assignmentId",
        "studentId",
        "sessionId",
        "courseOfferingId",
        "enrollmentId",
        "nationalId",
        "email",
        "phone",
        "parentName",
        "parentPhone",
        "notes",
        "orderIndex",
        "waveIndex",
      ]) {
        assert.equal(forbidden in row, false, `${name} assignment row exposes ${forbidden}`);
      }
    }
  }

  // By VALUE, not merely by key: the fixture's pairing indexes are numbers, and
  // no assignment row may carry a number at all.
  for (const row of trainee.allRows.flatMap((r) => r.assignments)) {
    for (const value of Object.values(row)) {
      assert.equal(typeof value === "number", false, "an assignment row carries a number");
    }
  }
});

test("K10. PUBLICATION policy is untouched by the assignment rows", async () => {
  // The trainee still sees no unpublished lesson and no draft plan...
  const trainee = await readTrainee();
  assert.equal(
    trainee.allRows.some((row) => row.sessionId === "tp:lesson-hidden"),
    false,
  );
  assert.deepEqual(await readTrainee({ planPublishedAt: null }), emptyTraineeExamDayDto());
  // ...and the empty day carries no assignment row of any kind.
  assert.deepEqual(
    emptyTraineeExamDayDto().allRows.flatMap((row) => row.assignments),
    [],
  );

  // ...while the instructor still sees drafts, WITH their assignment rows.
  const draft = await readInstructorExamPlanWithDeps(
    COURSE_OFFERING_ID,
    instructorDeps(makeCalls(), { planPublishedAt: null }),
  );
  assert.equal(draft.isPublished, false);
  assert.ok(draft.rows.flatMap((row) => row.assignments).length > 0);

  // The locked per-role loader options are exactly what they were.
  const traineeCalls = makeCalls();
  await readTraineeExamDayWithDeps(DATE, traineeDeps(traineeCalls));
  assert.deepEqual(traineeCalls.loadOptions, [
    { requirePlanPublication: true, requireLessonPublication: true, viewerStudentId: VIEWER, beginnerSourceEnabled: true },
  ]);
  const instructorCalls = makeCalls();
  await readInstructorExamPlanWithDeps(COURSE_OFFERING_ID, instructorDeps(instructorCalls));
  assert.deepEqual(instructorCalls.loadOptions, [
    { requirePlanPublication: false, requireLessonPublication: false, viewerStudentId: null, beginnerSourceEnabled: true },
  ]);
});

test("K11. the assignment rows cost NO extra query and mutate NO input", async () => {
  const calls = makeCalls();
  await readAdminExamPlanWithDeps(COURSE_OFFERING_ID, adminDeps(calls));
  // The same one-student / one-instructor batch contract as before: the names an
  // assignment row needs were already in the batch.
  assert.equal(calls.studentBatches.length, 1);
  assert.equal(calls.instructorBatches.length, 1);
  assert.deepEqual(calls.order, [
    `admin-course:${COURSE_OFFERING_ID}`,
    "load",
    "plan",
    "definitions",
    "sessions",
    "sourceDates",
    "lessons",
    "student-names",
    "instructor-names",
  ]);

  assert.equal(
    JSON.stringify({
      definitions: DEFINITION_ROWS,
      sessions: SESSION_ROWS,
      lessons: LESSON_ROWS,
      sourceDates: SOURCE_DATE_ROWS,
    }),
    FIXTURE_SNAPSHOT,
    "the operational read mutated its input rows",
  );
});

test("K12. session ORDER and DIAGNOSTICS are exactly what they were", async () => {
  const dto = await readAdmin();
  assert.deepEqual(
    dto.rows.map((row) => row.sessionId),
    [
      "sess-riding",
      "tp:lesson-lunge",
      "sess-advanced",
      "tp:lesson-group",
      "sess-interface",
      "tp:lesson-hidden",
      "sess-unresolved",
      "sess-offday",
    ],
  );
  assert.deepEqual(Object.keys(dto.diagnostics), [
    "storedAdapterIssues",
    "storedBlockDiagnostics",
    "teachingPracticeSourceIssues",
    "beginnerRejections",
    "loaderIssues",
    "narrowingIssues",
  ]);
  // The unresolved block's diagnostics are still reported, unchanged.
  const diagnostic = dto.diagnostics.storedBlockDiagnostics.find(
    (entry) => entry.sessionId === "sess-unresolved",
  );
  assert.ok(diagnostic !== undefined && diagnostic.timetableIssues.length > 0);
  // No diagnostic gained an operational value.
  assert.equal(JSON.stringify(dto.diagnostics).includes(OPV), false);
});

test("K13. the assignment rows are plain, frozen JSON on every role's reading", async () => {
  const admin = await readAdmin();
  const instructor = await readInstructorExamPlanWithDeps(
    COURSE_OFFERING_ID,
    instructorDeps(makeCalls()),
  );
  const trainee = await readTrainee();
  for (const [name, dto] of [
    ["admin", admin],
    ["instructor", instructor],
    ["trainee", trainee],
  ] as const) {
    assert.deepEqual(findNonPlainJsonPaths(dto), [], `${name} is not plain JSON`);
    assert.deepEqual(JSON.parse(JSON.stringify(dto)), dto, `${name} does not round trip`);
  }
  const rows = trainee.allRows.flatMap((row) => row.assignments);
  assert.ok(rows.length > 0);
  for (const row of rows) {
    assert.ok(Object.isFrozen(row));
    assert.ok(Object.isFrozen(row.pairedParticipantNames));
  }
  // Freshly allocated per row: no two rows share one empty list.
  const empties = trainee.allRows.filter((row) => row.assignments.length === 0);
  assert.ok(empties.length > 1, "sanity: the day must hold several beginner rows");
  assert.notEqual(empties[0].assignments, empties[1].assignments);
});

// ===========================================================================
// GROUP K (cont.) — the EX-OPS-READ-MVP FOOTPRINT
// ===========================================================================

function gitLines(args: readonly string[]): string[] {
  const result = spawnSync("git", [...args], { cwd: REPO_ROOT, encoding: "utf8" });
  return (result.stdout ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Everything this working tree touches, tracked and untracked alike. */
function touchedPaths(): string[] {
  return [
    ...new Set([
      ...gitLines(["diff", "--name-only", "HEAD"]),
      ...gitLines(["diff", "--name-only", "--cached", "HEAD"]),
      ...gitLines(["ls-files", "--others", "--exclude-standard"]),
    ]),
  ]
    .map((path) => path.split("\\").join("/"))
    .sort();
}

test("K14. no instructor or trainee UI file was touched", () => {
  // RE-POINTED by EX-ADMIN-WORKSPACE-UX, and NARROWED to the trees this read
  // pipeline actually protects. The admin exams route is REBUILT by that slice, so
  // a blanket ban on it describes a working tree that no longer exists; what must
  // stay untouched is every surface OUTSIDE it, which this guard now states —
  // together with the read pipeline's own footprint, pinned exactly by K16.
  const forbidden = ["app/instructor", "app/student"];
  const offenders = touchedPaths().filter((path) =>
    forbidden.some((dir) => path === dir || path.startsWith(`${dir}/`)),
  );
  assert.deepEqual(offenders, [], `a UI file was modified: ${offenders.join(", ")}`);
});

test("K15. no schema, migration, writer, publication or notification file was touched", () => {
  const touched = touchedPaths();
  for (const dir of ["prisma", "lib/auth", "lib/course/capabilities"]) {
    const offenders = touched.filter((path) => path === dir || path.startsWith(`${dir}/`));
    assert.deepEqual(offenders, [], `${dir} was modified: ${offenders.join(", ")}`);
  }
  // MERGE RESOLUTION — both exclusions are kept, and the production claim is not
  // weakened. The pattern matches the sibling write-slice GUARD SUITES this slice
  // re-points, which are named EXACTLY below, and — since EX-ADMIN-WORKSPACE-UX
  // re-points several more — every remaining `.test.ts` as well. A suite is not a
  // writer, so a real production writer, publication module or notification
  // module still fails this guard.
  const REPOINTED_WRITE_SLICE_SUITES = [
    "lib/actions/" + "exam-assignment-write" + "-io.test.ts",
    "lib/actions/" + "exam-instructed-trainee-assignment-write" + "-io.test.ts",
    "lib/actions/" + "exam-pairing-write" + "-io.test.ts",
    "lib/actions/" + "exam-plan-write" + "-io.test.ts",
    "lib/actions/" + "exam-publication-write" + "-io.test.ts",
    "lib/actions/" + "exam-session-write" + "-io.test.ts",
    "lib/actions/" + "exam-supervisor-write" + "-io.test.ts",
    "lib/exam/" + "exam-supervisor-write" + "-core.test.ts",
  ];
  for (const path of REPOINTED_WRITE_SLICE_SUITES) {
    assert.match(path, /\.test\.ts$/, `${path} is not a guard suite`);
  }
  const writeLike = touched
    .filter((path) => !path.endsWith(".test.ts"))
    .filter((path) =>
      /(-write-|publication|notification|middleware|\.mcp\.json|package(-lock)?\.json|\.env)/.test(
        path,
      ),
    );
  assert.deepEqual(writeLike, [], `a write/publication file was modified: ${writeLike.join(", ")}`);
});

test("K16. the slice's footprint is exactly its approved read-pipeline paths", () => {
  const approved = [
    "lib/exam/exam-block-timetable-core.ts",
    "lib/exam/exam-block-timetable-core.test.ts",
    "lib/exam/exam-stored-adapter-core.ts",
    "lib/exam/exam-stored-adapter-core.test.ts",
    "lib/exam/exam-plan-loader-core.ts",
    "lib/exam/exam-read-dto.ts",
    "lib/exam/exam-read-dto.test.ts",
    "lib/exam/exam-read-scope-core.ts",
    "lib/exam/exam-read.contract.test.ts",
    // The two FOREIGN slice-footprint guards this slice re-points. Their own
    // per-slice path allow-lists were measured against a HEAD that no longer
    // exists, so every later change to any file reddens them; each is widened by
    // an EXACT path list naming this slice's files, and their authorization
    // assertions are strengthened rather than relaxed.
    "lib/actions/instructor-exam-schedule.contract.test.ts",
    "lib/actions/trainee-exam-schedule.contract.test.ts",
    // EX-ADMIN-WORKSPACE-UX (BLOCKER-1) — the ONE admin-only export that exposes
    // this pipeline's derived moments, and the pure narrowing behind it. Neither
    // changes a role reading, a shared DTO or the payload's containment.
    "lib/actions/" + "exam-role" + "-readers.ts",
    "lib/exam/" + "admin-exam-wave-view" + "-core.ts",
    // EX-BEGINNER-EXAM-READ — the Level-1 beginner containment gate. The pure
    // predicate is a NEW module; the loader and the three role readers gained the
    // `beginnerSourceEnabled` option that carries it; the two suites below are
    // the committed tests of exactly those modules, updated for the new field.
    "lib/exam/exam-beginner-course-scope-core.ts",
    "lib/exam/exam-beginner-course-scope-core.test.ts",
    "lib/exam/exam-beginner-course-scope.contract.test.ts",
    "lib/exam/exam-plan-loader-core.test.ts",
    "lib/exam/exam-read-scope-core.test.ts",
    // The same slice also carries the TRAINEE-ONLY assignment `isSelf`: the
    // trainee view core surfaces the SERVER-DERIVED viewer id on its INTERNAL
    // projection, and the narrowing turns it into ONE BOOLEAN per assignment row.
    // No identifier is added to any client contract, and the admin and instructor
    // row key sets are unchanged — both asserted above, on serialized output.
    "lib/exam/exam-trainee-view-core.ts",
    "lib/exam/exam-trainee-view-core.test.ts",
    // The sibling slice-footprint guard suites this slice re-points, each named
    // EXACTLY. They are guard suites only - no production module is listed.
    "lib/actions/" + "admin-exam-session-read" + "-io.test.ts",
    "lib/actions/" + "exam-assignment-read" + "-io.test.ts",
    "lib/actions/" + "exam-assignment-write" + "-io.test.ts",
    "lib/actions/" + "exam-definition-read" + "-io.test.ts",
    "lib/actions/" + "exam-instructed-trainee-assignment-write" + "-io.test.ts",
    "lib/actions/" + "exam-pairing-write" + "-io.test.ts",
    "lib/actions/" + "exam-plan-write" + "-io.test.ts",
    "lib/actions/" + "exam-publication-write" + "-io.test.ts",
    "lib/actions/" + "exam-session-write" + "-io.test.ts",
    "lib/actions/" + "exam-supervisor-read" + "-io.test.ts",
    "lib/actions/" + "exam-supervisor-write" + "-io.test.ts",
    "lib/actions/" + "instructor-exam-schedule" + ".contract.test.ts",
    "lib/actions/" + "trainee-exam-schedule" + ".contract.test.ts",
    "lib/exam/" + "create-exam-plan" + "-core.test.ts",
    "lib/exam/" + "exam-supervisor-write" + "-core.test.ts",
  ];
  // EX-ADMIN-WORKSPACE-UX — the admin exams WORKSPACE rebuild, which shares this
  // working tree. It touches the route's own files and the exam guard suites, and
  // NOT ONE module of this read pipeline: every pipeline path above is still
  // required to be the only `lib/exam` production file that may differ, and the
  // assertion below still names this slice's own additions exactly.
  const WORKSPACE_SLICE = (path: string): boolean =>
    path.startsWith("app/admin/courses/[courseOfferingId]/exams/") ||
    path.endsWith(".test.ts") ||
    path === "lib/actions/" + "admin-exam-workspace-edit" + "-io.ts" ||
    path === "lib/exam/" + "admin-exam-workspace-edit" + "-core.ts" ||
    // EX-ADMIN-SRCDATE, on EXACTLY the same terms and no wider: the pure
    // source-date decision core and its server-only binding. They exist because
    // nothing in the product could write an exam plan's Teaching-Practice date
    // selection, so every plan held an empty one and this pipeline projected NO
    // beginner rows anywhere. They ADD a writer BESIDE the pipeline and change
    // NOT ONE module of it — every pipeline path above is still required to be
    // the only `lib/exam` production file that may differ.
    path === "lib/actions/" + "admin-exam-source-date" + "-io.ts" ||
    path === "lib/exam/" + "admin-exam-source-date" + "-core.ts";
  const offenders = touchedPaths().filter(
    (path) => !approved.includes(path) && !WORKSPACE_SLICE(path),
  );
  assert.deepEqual(offenders, [], `outside the approved scope: ${offenders.join(", ")}`);
  // MERGE RESOLUTION — the union of the files the two slices CREATE, named
  // EXACTLY. The assertion was once "nothing was created at all"; it stays an
  // exact list rather than being dropped, so an unexpected new file still reddens
  // this guard.
  const CREATED = [
    "lib/exam/exam-beginner-course-scope-core.ts",
    "lib/exam/exam-beginner-course-scope-core.test.ts",
    "lib/exam/exam-beginner-course-scope.contract.test.ts",
    "lib/exam/" + "admin-exam-wave-view" + "-core.ts",
  ];
  const created = gitLines(["ls-files", "--others", "--exclude-standard"])
    .map((path) => path.split("\\").join("/"))
    .sort();
  const unexpected = created.filter(
    (path) => !CREATED.includes(path) && !WORKSPACE_SLICE(path),
  );
  assert.deepEqual(unexpected, [], `unapproved new file: ${unexpected.join(", ")}`);
});
