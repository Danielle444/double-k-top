/**
 * EXAM EX-S5A-4A — executable tests for the PURE role-specific exam DTO
 * narrowing (exam-read-dto.ts).
 *
 * DB-FREE: every case builds plain in-memory fixtures. This suite opens no
 * database connection, executes no SQL, reads no session and constructs no
 * `Date`. The only files it reads from disk are repository SOURCES, for the
 * structural guards at the end.
 *
 * SCOPE OF PROOF: that "לו״ז שלי" is LITERALLY "לו״ז כולל" filtered by `isSelf`
 * and shares its row objects; that no foreign `Student.id`, viewer id,
 * assignment id, stored slot, conflict input or `EX-*` diagnostic can reach a
 * trainee; that participant COUNTS stay authoritative while NAMES are
 * best-effort, order-preserving and duplicate-preserving; that beginner child
 * and parent-contact detail attaches by EXACT session id and fails closed
 * otherwise; that every DTO is plain, frozen, deterministic JSON; and that this
 * module performs no authorization and remains unwired.
 *
 * The forbidden identifiers the structural guards search for are assembled from
 * SPLIT LITERALS on purpose: `exam-no-feedback-guard.test.ts` scans every file
 * in `lib/exam` for exact tokens, and the repository's own import guards look
 * for module specifiers — spelling one out here would make this suite trip them.
 *
 * Run with: npx tsx --test lib/exam/exam-read-dto.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";

import {
  buildAdminExamReadDto,
  buildInstructorExamReadDto,
  buildTraineeExamDayDto,
  findNonPlainJsonPaths,
  isPlainJsonDto,
  TRAINEE_SELF_ROW_LABEL,
  type ExamDisplayNameLookup,
  type TraineeExamDayRowDto,
  type TraineeExamSessionDisplayDetail,
} from "./exam-read-dto";
import { adaptTeachingPracticeExamSources } from "./exam-tp-source-adapter-core";
import { projectLiveBeginnerRows } from "./exam-live-beginner-adapter-core";
import { projectTraineeExamDay, type StoredExamBlockDetail } from "./exam-trainee-view-core";
import type {
  StoredExamAssignmentOperationalRow,
  StoredExamBlockOperationalDetail,
} from "./exam-stored-adapter-core";
import {
  projectGeneralSchedule,
  type ProjectionSession,
} from "./exam-schedule-projection-core";
import type { BeginnerDetail } from "./exam-live-beginner-adapter-core";
import type { ExamPlanPayload } from "./exam-plan-loader-core";
import type { ConflictSession } from "./exam-conflict-core";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const DTO_PATH = join(REPO_ROOT, "lib", "exam", "exam-read-dto.ts");
const DTO_TEST_PATH = join(REPO_ROOT, "lib", "exam", "exam-read-dto.test.ts");
const PROJECTION_PATH = join(REPO_ROOT, "lib", "exam", "exam-schedule-projection-core.ts");
const DTO_SOURCE = readFileSync(DTO_PATH, "utf8");

/** The module source with comments stripped: guards must assert on CODE. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const DTO_CODE = stripComments(DTO_SOURCE);
/** The comment PROSE, with the leading `//` / `*` decoration removed. */
const DTO_COMMENTS = DTO_SOURCE.split("\n")
  .filter((line) => /^\s*(\/\/|\*|\/\*)/.test(line))
  .map((line) => line.replace(/^\s*(\/\*+|\/\/|\*+)\s?/, ""))
  .join("\n");

// ===========================================================================
// Planted secrets — unique tokens that must never appear where forbidden
// ===========================================================================

const SELF_ID = "SECRET-STUDENT-SELF-7f3";
const OTHER_ID = "SECRET-STUDENT-OTHER-a91";
const DUP_A_ID = "SECRET-STUDENT-DUPA-b22";
const DUP_B_ID = "SECRET-STUDENT-DUPB-c33";
const UNKNOWN_ID = "SECRET-STUDENT-UNKNOWN-d44";
const INSTRUCTED_ID = "SECRET-STUDENT-INSTRUCTED-e55";
const ASSIGNMENT_ID = "SECRET-ASSIGNMENT-f66";
const INSTRUCTOR_ID = "SECRET-INSTRUCTOR-g77";
const UNKNOWN_INSTRUCTOR_ID = "SECRET-INSTRUCTOR-UNKNOWN-h88";
const EXAMINER_SET_ID = "SECRET-EXAMINERSET-i99";
const HORSE_SECRET = "SECRET-CONFLICT-HORSE-j10";
const LESSON_NOTES = "SECRET-LESSON-NOTES-k11";
const FILTERED_CHILD = "SECRET-FILTERED-CHILD-l12";
const FILTERED_PHONE = "SECRET-FILTERED-PHONE-m13";
const MISMATCHED_CHILD = "SECRET-MISMATCHED-CHILD-n14";
const CHILD_ID = "SECRET-CHILD-o15";
const PARTICIPANT_ID = "SECRET-PARTICIPANT-p16";
const REJECTED_TRAINEE_ID = "SECRET-REJECTED-TRAINEE-q17";
const REJECTED_TRAINEE_NAME = "SECRET-REJECTED-NAME-r18";
const REJECTED_PARTICIPANT_ID = "SECRET-REJECTED-PARTICIPANT-s19";
const ARENA_MISMATCH = "SECRET-ARENA-MISMATCH-t20";
const ARENA_GHOST = "SECRET-ARENA-GHOST-u21";
const ARENA_UNRELATED = "SECRET-ARENA-UNRELATED-v22";
/** A horse on an assignment detail keyed to one session and declaring another. */
const MISMATCHED_HORSE = "SECRET-HORSE-MISMATCH-w23";
/** A horse on a stored assignment list a BEGINNER row must never consume. */
const GHOST_HORSE = "SECRET-HORSE-GHOST-x24";

/** A parent phone with deliberately awkward spacing — it must survive verbatim. */
const RAW_PARENT_PHONE = " 050-123 4567 ";

const DATE = "2026-08-10";

const NAMES: ExamDisplayNameLookup = {
  studentNames: new Map([
    [SELF_ID, "אני חניך"],
    [OTHER_ID, "אורי לוי"],
    [DUP_A_ID, "דנה כהן"],
    [DUP_B_ID, "דנה כהן"],
    [INSTRUCTED_ID, "נועה ברק"],
    // Nameable ON PURPOSE: if a rejected participant ever leaked, it would leak
    // as a NAME, so this makes the filtering test meaningful rather than vacuous.
    [REJECTED_TRAINEE_ID, REJECTED_TRAINEE_NAME],
    // UNKNOWN_ID is deliberately ABSENT.
  ]),
  instructorNames: new Map([
    [INSTRUCTOR_ID, "מדריכה רות"],
    // UNKNOWN_INSTRUCTOR_ID is deliberately ABSENT.
  ]),
};

// ===========================================================================
// Fixtures
// ===========================================================================

function storedSession(over: Partial<ProjectionSession> = {}): ProjectionSession {
  return {
    sessionId: "s1",
    kind: "INTERFACE_RIDING",
    beginnerFormat: null,
    date: DATE,
    startTime: "09:00",
    endTime: "10:00",
    orderIndex: 0,
    examineeStudentIds: [SELF_ID, OTHER_ID, UNKNOWN_ID],
    instructedTraineeStudentIds: [],
    beginnerChildCount: 0,
    definitionId: "d1",
    definitionName: "מבחן ממשק",
    derivedBlockEndTime: "10:30",
    timetableStatus: "OK",
    ...over,
  };
}

function beginnerSession(over: Partial<ProjectionSession> = {}): ProjectionSession {
  return {
    sessionId: "tp:l1",
    kind: "BEGINNER_INSTRUCTION",
    beginnerFormat: "LUNGE",
    date: DATE,
    startTime: "11:00",
    endTime: "12:00",
    orderIndex: 0,
    examineeStudentIds: [OTHER_ID, DUP_A_ID, DUP_B_ID],
    instructedTraineeStudentIds: [],
    beginnerChildCount: 1,
    timetableStatus: "NOT_APPLICABLE",
    ...over,
  };
}

function storedDetail(
  sessionId: string,
  slots: readonly {
    assignmentId: string;
    studentId: string | null;
    role: "EXAMINEE" | "INSTRUCTED_TRAINEE";
    startTime: string;
    endTime: string;
  }[],
): StoredExamBlockDetail {
  return { source: "STORED", sessionId, slots };
}

/** One PROJECTED live participant, exactly as the committed live adapter emits
 * it — projection-only by construction, so it carries no `isProjected` flag. */
function participant(
  participantId: string,
  traineeId: string,
  traineeName: string,
): BeginnerDetail["participants"][number] {
  return {
    participantId,
    traineeId,
    traineeName,
    sourcePracticeRole: "LEAD_INSTRUCTOR",
    isManualOverride: false,
    isSelf: false,
  };
}

/**
 * One participant the Teaching-Practice source adapter HELD BACK. It exists in
 * that adapter's operational detail only; the cast reproduces the shape here
 * without editing a committed contract.
 */
function rejectedParticipant(): BeginnerDetail["participants"][number] {
  return {
    participantId: REJECTED_PARTICIPANT_ID,
    traineeId: REJECTED_TRAINEE_ID,
    traineeName: REJECTED_TRAINEE_NAME,
    sourcePracticeRole: "NOT_A_REAL_ROLE",
    isManualOverride: false,
    createdAt: "2026-07-01T09:00:00.000Z",
    isProjected: false,
  } as unknown as BeginnerDetail["participants"][number];
}

function beginnerDetail(over: Partial<BeginnerDetail> = {}): BeginnerDetail {
  return {
    sessionId: "tp:l1",
    lessonId: "l1",
    beginnerFormat: "LUNGE",
    practiceType: "LUNGE",
    date: DATE,
    startTime: "11:00",
    endTime: "12:00",
    orderIndex: 0,
    groupName: "א",
    location: "מגרש 2",
    notes: LESSON_NOTES,
    isPublished: true,
    roleLabelOverrides: null,
    responsibleInstructorId: INSTRUCTOR_ID,
    responsibleInstructorName: "שם מהמקור",
    isSelf: false,
    participants: [
      participant(PARTICIPANT_ID, OTHER_ID, "אורי לוי"),
      participant("p-dupa", DUP_A_ID, "דנה כהן"),
      participant("p-dupb", DUP_B_ID, "דנה כהן"),
    ],
    children: [
      {
        childAssignmentId: "ca-1",
        childId: CHILD_ID,
        fullName: "ילד א",
        age: 8,
        gender: "F",
        childNotes: "רגישה לרעש",
        parentName: "הורה א",
        parentPhone: RAW_PARENT_PHONE,
        horseName: "סוסון",
        equipmentNotes: "קסדה קטנה",
        isAbsent: false,
      },
    ],
    ...over,
  };
}

/** The stored blocks of the day, plus the two extra stored rows. */
const S1 = storedSession();
const S2 = storedSession({
  sessionId: "s2",
  startTime: "10:45",
  endTime: "11:15",
  derivedBlockEndTime: "11:20",
  orderIndex: 1,
  // SAME kind, DIFFERENT definition — the identity must not collapse.
  definitionId: "d2",
  definitionName: "מבחן ממשק מתקדם",
  examineeStudentIds: [OTHER_ID],
  instructedTraineeStudentIds: [INSTRUCTED_ID],
});
/** Hidden from trainees by the committed core; visible to admin/instructor. */
const S3_UNRESOLVED = storedSession({
  sessionId: "s3",
  startTime: "15:00",
  orderIndex: 2,
  definitionId: "d1",
  derivedBlockEndTime: null,
  timetableStatus: "UNRESOLVED",
  examineeStudentIds: [OTHER_ID],
});

const B1 = beginnerSession();
const B2 = beginnerSession({
  sessionId: "tp:l2",
  beginnerFormat: "BEGINNER_GROUP",
  startTime: "12:00",
  endTime: "13:00",
  orderIndex: 1,
  examineeStudentIds: [SELF_ID],
  beginnerChildCount: 0,
});
/** A beginner row whose sibling detail is MISSING entirely. */
const B3_NO_DETAIL = beginnerSession({
  sessionId: "tp:l3",
  startTime: "13:00",
  endTime: "14:00",
  orderIndex: 2,
  examineeStudentIds: [OTHER_ID],
  beginnerChildCount: 0,
});
/** A beginner row whose detail declares a DIFFERENT session id. */
const B4_MISMATCH = beginnerSession({
  sessionId: "tp:l4",
  startTime: "14:00",
  endTime: "15:00",
  orderIndex: 3,
  examineeStudentIds: [OTHER_ID],
  beginnerChildCount: 0,
});

/** A beginner row whose detail mixes PROJECTED and HELD-BACK participants. */
const B5_MIXED = beginnerSession({
  sessionId: "tp:l5",
  startTime: "16:00",
  endTime: "17:00",
  orderIndex: 4,
  // What the committed adapters emit: the rejected participant contributes NO
  // examinee identity, so it is absent from this list by construction.
  examineeStudentIds: [OTHER_ID, DUP_A_ID, DUP_B_ID, UNKNOWN_ID],
  beginnerChildCount: 0,
});

const SESSIONS: readonly ProjectionSession[] = [
  S1,
  S2,
  S3_UNRESOLVED,
  B1,
  B2,
  B3_NO_DETAIL,
  B4_MISMATCH,
  B5_MIXED,
];

const STORED_DETAILS = new Map<string, StoredExamBlockDetail>([
  [
    "s1",
    storedDetail("s1", [
      { assignmentId: ASSIGNMENT_ID, studentId: SELF_ID, role: "EXAMINEE", startTime: "09:00", endTime: "09:20" },
      { assignmentId: "a-other", studentId: OTHER_ID, role: "EXAMINEE", startTime: "09:20", endTime: "09:40" },
      { assignmentId: "a-unknown", studentId: UNKNOWN_ID, role: "EXAMINEE", startTime: "09:40", endTime: "10:00" },
    ]),
  ],
  [
    "s2",
    storedDetail("s2", [
      { assignmentId: "a-s2-1", studentId: OTHER_ID, role: "EXAMINEE", startTime: "10:45", endTime: "11:05" },
      { assignmentId: "a-s2-2", studentId: INSTRUCTED_ID, role: "INSTRUCTED_TRAINEE", startTime: "10:45", endTime: "11:05" },
    ]),
  ],
]);

// ===========================================================================
// EX-OPS-READ-MVP — the ASSIGNMENT-LEVEL operational sibling
// ===========================================================================

function operationalRow(over: {
  readonly assignmentId?: string | null;
  readonly studentId: string | null;
  readonly role: "EXAMINEE" | "INSTRUCTED_TRAINEE";
  readonly horseName?: string | null;
  readonly instructionTopic?: string | null;
  readonly discipline?: string | null;
  readonly personalStartTime?: string | null;
  readonly personalEndTime?: string | null;
  readonly pairedStudentIds?: readonly string[];
}): StoredExamAssignmentOperationalRow {
  return {
    assignmentId: over.assignmentId ?? null,
    studentId: over.studentId,
    role: over.role,
    horseName: over.horseName ?? null,
    instructionTopic: over.instructionTopic ?? null,
    discipline: over.discipline ?? null,
    personalStartTime: over.personalStartTime ?? null,
    personalEndTime: over.personalEndTime ?? null,
    pairedStudentIds: over.pairedStudentIds ?? [],
  };
}

/**
 * The sibling assignment lookup. It deliberately also holds a MISMATCHED entry,
 * a BEGINNER key and an unrelated key, so the attachment rules are tested
 * against a lookup wider than the rows being narrowed.
 */
const ASSIGNMENT_DETAILS = new Map<string, StoredExamBlockOperationalDetail>([
  [
    "s1",
    {
      source: "STORED",
      sessionId: "s1",
      assignments: [
        operationalRow({
          assignmentId: ASSIGNMENT_ID,
          studentId: SELF_ID,
          role: "EXAMINEE",
          horseName: "סוסה כחולה",
          instructionTopic: "עצירה",
          discipline: "אילוף",
          personalStartTime: "09:00",
          personalEndTime: "09:20",
        }),
        operationalRow({
          assignmentId: "a-unknown",
          // An id with NO resolvable name: the row must survive nameless.
          studentId: UNKNOWN_ID,
          role: "EXAMINEE",
          horseName: "סוס אלמוני",
          personalStartTime: "09:40",
          personalEndTime: "10:00",
        }),
      ],
    },
  ],
  [
    "s2",
    {
      source: "STORED",
      sessionId: "s2",
      assignments: [
        operationalRow({
          assignmentId: "a-s2-1",
          studentId: OTHER_ID,
          role: "EXAMINEE",
          horseName: "סוס ירוק",
          instructionTopic: "מעברים",
          discipline: "קפיצה",
          personalStartTime: "10:45",
          personalEndTime: "11:05",
          pairedStudentIds: [INSTRUCTED_ID],
        }),
        operationalRow({
          assignmentId: "a-s2-2",
          studentId: INSTRUCTED_ID,
          role: "INSTRUCTED_TRAINEE",
          // INHERITED by the committed adapter, never stored on this row.
          instructionTopic: "מעברים",
          discipline: "קפיצה",
          personalStartTime: "10:45",
          personalEndTime: "11:05",
          pairedStudentIds: [OTHER_ID],
        }),
      ],
    },
  ],
  [
    // An UNRESOLVED block: real people, real horse, NO personal time at all.
    "s3",
    {
      source: "STORED",
      sessionId: "s3",
      assignments: [
        operationalRow({
          assignmentId: "a-s3-1",
          studentId: OTHER_ID,
          role: "EXAMINEE",
          horseName: "סוס ללא שעה",
        }),
      ],
    },
  ],
  [
    // Keyed to `s-mismatch` but DECLARING another session: it must fail closed.
    "s-mismatch",
    {
      source: "STORED",
      sessionId: "s-something-else",
      assignments: [
        operationalRow({ studentId: SELF_ID, role: "EXAMINEE", horseName: MISMATCHED_HORSE }),
      ],
    },
  ],
  [
    // A beginner row must never consume a stored assignment list.
    "tp:l1",
    {
      source: "STORED",
      sessionId: "tp:l1",
      assignments: [
        operationalRow({ studentId: SELF_ID, role: "EXAMINEE", horseName: GHOST_HORSE }),
      ],
    },
  ],
]);

const BEGINNER_DETAILS = new Map<string, BeginnerDetail>([
  ["tp:l1", beginnerDetail()],
  [
    "tp:l2",
    beginnerDetail({
      sessionId: "tp:l2",
      lessonId: "l2",
      beginnerFormat: "BEGINNER_GROUP",
      practiceType: "BEGINNER_GROUP",
      startTime: "12:00",
      endTime: "13:00",
      participants: [],
      children: [],
      responsibleInstructorId: UNKNOWN_INSTRUCTOR_ID,
      responsibleInstructorName: "מדריך ללא טבלה",
    }),
  ],
  // tp:l3 is deliberately ABSENT — nothing may be attached to it.
  [
    // Keyed to tp:l4, but DECLARING another session: it must fail closed.
    "tp:l4",
    beginnerDetail({
      sessionId: "tp:SOMETHING-ELSE",
      lessonId: "l4",
      children: [
        {
          childAssignmentId: "ca-mismatch",
          childId: CHILD_ID,
          fullName: MISMATCHED_CHILD,
          age: 9,
          gender: "M",
          childNotes: null,
          parentName: null,
          parentPhone: FILTERED_PHONE,
          horseName: null,
          equipmentNotes: null,
          isAbsent: false,
        },
      ],
    }),
  ],
  [
    "tp:l5",
    beginnerDetail({
      sessionId: "tp:l5",
      lessonId: "l5",
      startTime: "16:00",
      endTime: "17:00",
      children: [],
      // The held-back row sits in the MIDDLE, so filtering it out also proves
      // the surrounding order is preserved.
      participants: [
        participant("p-m1", OTHER_ID, "אורי לוי"),
        rejectedParticipant(),
        participant("p-m2", DUP_A_ID, "דנה כהן"),
        participant("p-m3", DUP_B_ID, "דנה כהן"),
        participant("p-m4", UNKNOWN_ID, "שם שאינו בטבלה"),
      ],
    }),
  ],
  [
    // A row that is not on this day at all — a filtered/unseen detail.
    "tp:filtered",
    beginnerDetail({
      sessionId: "tp:filtered",
      lessonId: "l-filtered",
      date: "2026-09-01",
      children: [
        {
          childAssignmentId: "ca-filtered",
          childId: CHILD_ID,
          fullName: FILTERED_CHILD,
          age: 7,
          gender: "F",
          childNotes: null,
          parentName: null,
          parentPhone: FILTERED_PHONE,
          horseName: null,
          equipmentNotes: null,
          isAbsent: false,
        },
      ],
    }),
  ],
]);

function conflictSession(sessionId: string, over: Partial<ConflictSession> = {}): ConflictSession {
  return {
    sessionId,
    interval: { date: DATE, start: "09:00", end: "10:30" },
    assignments: [],
    supervisorIds: [INSTRUCTOR_ID, UNKNOWN_INSTRUCTOR_ID],
    examinerSetId: EXAMINER_SET_ID,
    horseIds: [HORSE_SECRET],
    arenaId: "מגרש 1",
    capacity: null,
    expectsStaffing: false,
    ...over,
  };
}

function payload(over: Partial<ExamPlanPayload> = {}): ExamPlanPayload {
  return {
    planId: "plan-1",
    publishedAt: 1_700_000_000_000,
    sessions: SESSIONS,
    storedDetails: STORED_DETAILS,
    storedAssignmentDetails: ASSIGNMENT_DETAILS,
    beginnerDetails: BEGINNER_DETAILS,
    conflictSessions: [
      conflictSession("s1"),
      conflictSession("s2", { arenaId: null, supervisorIds: [] }),
      conflictSession("s3"),
    ],
    sourceDates: [DATE],
    diagnostics: {
      storedAdapterIssues: [
        {
          code: "EX-ADP-DEFINITION-MISSING",
          message: "לא נמצאה הגדרת בחינה למפגש",
          sessionId: "s9",
          definitionId: "d9",
          assignmentId: null,
        },
      ],
      storedBlockDiagnostics: [
        {
          sessionId: "s1",
          definitionId: "d1",
          timetableIssues: [],
          timetableWarnings: [
            { code: "EX-CALC-EMPTY-BLOCK", message: "בלוק ריק", details: ["EMPTY"] },
          ],
          definitionIssues: [
            {
              code: "EX-DEF-TRAINEE-REQUIRED",
              message: "חובה לשבץ חניך לכל שיבוץ",
              assignmentId: "a-x",
            },
          ],
          adapterIssues: [],
        },
      ],
      teachingPracticeSourceIssues: [
        {
          code: "EX-TP-ADP-LESSON-ID-REQUIRED",
          message: "לשיעור חסר מזהה",
          lessonId: null,
          participantId: null,
          childAssignmentId: null,
        },
      ],
      beginnerRejections: [{ lessonId: "l-bad", reason: "UNMAPPED_PRACTICE_TYPE" }],
      loaderIssues: [
        {
          code: "EX-LOAD-SOURCE-DATE-INVALID",
          message: "תאריך מקור אינו תקין",
          sessionId: null,
          lessonId: null,
        },
      ],
    },
    ...over,
  };
}

/**
 * The NARROW stored display sibling: arena and nothing else. It deliberately
 * also holds a beginner key and an unrelated key, so the attachment rules are
 * tested against a lookup that is wider than the rows being narrowed.
 */
const SESSION_DISPLAY = new Map<string, TraineeExamSessionDisplayDetail>([
  // Untrimmed on purpose.
  ["s1", { sessionId: "s1", arena: "  מגרש 1  " }],
  // Keyed to s2 but DECLARING another session: it must fail closed.
  ["s2", { sessionId: "s-something-else", arena: ARENA_MISMATCH }],
  // A beginner row must never consume a stored arena.
  ["tp:l1", { sessionId: "tp:l1", arena: ARENA_GHOST }],
  ["s-unrelated", { sessionId: "s-unrelated", arena: ARENA_UNRELATED }],
]);

/** The committed trainee projection for the viewing trainee. */
function traineeProjection(viewer: string | null = SELF_ID) {
  return projectTraineeExamDay(SESSIONS, STORED_DETAILS, DATE, viewer);
}

function traineeDto(viewer: string | null = SELF_ID) {
  return buildTraineeExamDayDto(
    traineeProjection(viewer),
    BEGINNER_DETAILS,
    SESSION_DISPLAY,
    NAMES,
    ASSIGNMENT_DETAILS,
  );
}

function rowById(rows: readonly TraineeExamDayRowDto[], sessionId: string): TraineeExamDayRowDto {
  const row = rows.find((r) => r.sessionId === sessionId);
  assert.ok(row !== undefined, `expected a row for ${sessionId}`);
  return row;
}

/** A stable snapshot of everything the builders are handed. */
function inputSnapshot(): string {
  return JSON.stringify({
    sessions: SESSIONS,
    storedDetails: [...STORED_DETAILS.entries()],
    beginnerDetails: [...BEGINNER_DETAILS.entries()],
    names: {
      students: [...NAMES.studentNames.entries()],
      instructors: [...NAMES.instructorNames.entries()],
    },
  });
}

// ===========================================================================
// 1–3. The one projection, two views
// ===========================================================================

test("allRows carries every valid projected day row, in the projection's order", () => {
  const projection = traineeProjection();
  const dto = traineeDto();

  assert.deepEqual(
    dto.allRows.map((r) => r.sessionId),
    projection.allRows.map((r) => r.session.sessionId),
  );
  // The unresolved stored row was hidden upstream and is not re-introduced.
  assert.equal(dto.allRows.some((r) => r.sessionId === "s3"), false);
});

test("myRows is LITERALLY allRows.filter(isSelf)", () => {
  const dto = traineeDto();
  assert.deepEqual(dto.myRows, dto.allRows.filter((row) => row.isSelf));
  assert.deepEqual(dto.myRows.map((r) => r.sessionId), ["s1", "tp:l2"]);
});

test("myRows shares row OBJECT REFERENCES with allRows", () => {
  const dto = traineeDto();
  assert.ok(dto.myRows.length > 0);
  for (const row of dto.myRows) {
    assert.ok(
      dto.allRows.some((candidate) => candidate === row),
      "a personal row is not the same object as its full-view row",
    );
  }
});

test("a null viewer marks nobody: myRows is empty and no row claims self", () => {
  const dto = traineeDto(null);
  assert.deepEqual(dto.myRows, []);
  assert.equal(dto.allRows.every((r) => r.isSelf === false && r.selfLabel === null), true);
});

// ===========================================================================
// 4–5. Personal times
// ===========================================================================

test("a self stored row preserves the EXACT personal start and end", () => {
  const row = rowById(traineeDto().allRows, "s1");
  assert.equal(row.isSelf, true);
  assert.equal(row.selfLabel, TRAINEE_SELF_ROW_LABEL);
  assert.equal(row.selfRole, "EXAMINEE");
  assert.equal(row.selfStartTime, "09:00");
  assert.equal(row.selfEndTime, "09:20");
  // ...and never the block interval.
  assert.notEqual(row.selfEndTime, row.displayEndTime);
});

test("a non-self stored row carries null self state", () => {
  const row = rowById(traineeDto().allRows, "s2");
  assert.equal(row.isSelf, false);
  assert.equal(row.selfLabel, null);
  assert.equal(row.selfRole, null);
  assert.equal(row.selfStartTime, null);
  assert.equal(row.selfEndTime, null);
});

test("displayEndTime matches the committed end-time rule in every case", () => {
  // Parity proof: for a single-session kind, the general schedule's `lastEndTime`
  // IS that core's private `effectiveEndTime`.
  const cases: readonly ProjectionSession[] = [
    storedSession({ timetableStatus: "OK", derivedBlockEndTime: "10:30" }),
    storedSession({ timetableStatus: "OK", derivedBlockEndTime: null }),
    storedSession({ timetableStatus: "UNRESOLVED", derivedBlockEndTime: null }),
    beginnerSession(),
    // A pre-S4B row: no status at all, so its own endTime is authoritative.
    { ...storedSession(), timetableStatus: undefined, derivedBlockEndTime: undefined },
  ];
  for (const session of cases) {
    const expected = projectGeneralSchedule([session])[0]?.lastEndTime ?? null;
    const dto = buildAdminExamReadDto(payload({ sessions: [session] }), NAMES);
    assert.equal(dto.rows[0]?.displayEndTime, expected, `mismatch for ${session.sessionId}`);
  }
});

// ===========================================================================
// 6–11. Display names
// ===========================================================================

test("examinee names resolve from studentNames, in source order", () => {
  const row = rowById(traineeDto().allRows, "s1");
  assert.deepEqual(row.examineeNames, ["אני חניך", "אורי לוי"]);
});

test("instructed-trainee names resolve from studentNames", () => {
  const row = rowById(traineeDto().allRows, "s2");
  assert.deepEqual(row.instructedTraineeNames, ["נועה ברק"]);
  assert.equal(row.instructedTraineeCount, 1);
});

test("an unresolved id yields NO name and is never emitted as one", () => {
  const dto = traineeDto();
  const row = rowById(dto.allRows, "s1");
  assert.equal(row.examineeNames.includes(UNKNOWN_ID), false);
  assert.equal(JSON.stringify(dto).includes(UNKNOWN_ID), false);
});

test("counts stay authoritative when a name is missing", () => {
  const row = rowById(traineeDto().allRows, "s1");
  assert.equal(row.examineeCount, 3);
  assert.equal(row.examineeNames.length, 2);
});

test("duplicate display names stay duplicated, and order is preserved", () => {
  const row = rowById(traineeDto().allRows, "tp:l1");
  // OTHER, DUP_A, DUP_B — the last two genuinely share a full name.
  assert.deepEqual(row.examineeNames, ["אורי לוי", "דנה כהן", "דנה כהן"]);
  assert.equal(row.examineeCount, 3);
});

test("a blank participant id is neither named nor counted", () => {
  const session = storedSession({ sessionId: "s-blank", examineeStudentIds: [SELF_ID, "   ", ""] });
  const dto = buildAdminExamReadDto(payload({ sessions: [session] }), NAMES);
  assert.equal(dto.rows[0]?.examineeCount, 1);
  assert.deepEqual(dto.rows[0]?.examineeNames, ["אני חניך"]);
});

test("an unusable name lookup resolves nothing and never invents a name", () => {
  const dto = buildTraineeExamDayDto(
    traineeProjection(),
    BEGINNER_DETAILS,
    SESSION_DISPLAY,
    null,
    ASSIGNMENT_DETAILS,
  );
  const row = rowById(dto.allRows, "s1");
  assert.deepEqual(row.examineeNames, []);
  assert.equal(row.examineeCount, 3);
  assert.equal(JSON.stringify(dto).includes(SELF_ID), false);
});

// ===========================================================================
// 12–19. Trainee privacy guards (planted secrets)
// ===========================================================================

test("no student id, viewer id or assignment id appears in the serialized trainee DTO", () => {
  const json = JSON.stringify(traineeDto());
  for (const secret of [
    SELF_ID,
    OTHER_ID,
    DUP_A_ID,
    DUP_B_ID,
    UNKNOWN_ID,
    INSTRUCTED_ID,
    ASSIGNMENT_ID,
    INSTRUCTOR_ID,
    UNKNOWN_INSTRUCTOR_ID,
    CHILD_ID,
    PARTICIPANT_ID,
  ]) {
    assert.equal(json.includes(secret), false, `the trainee DTO leaked ${secret}`);
  }
  for (const key of [
    "viewerStudentId",
    "examineeStudentIds",
    "instructedTraineeStudentIds",
    "storedDetails",
    "slots",
    "assignmentId",
    "traineeId",
    "childId",
    "responsibleInstructorId",
    "roleLabelOverrides",
  ]) {
    assert.equal(json.includes(`"${key}"`), false, `the trainee DTO carries a ${key} field`);
  }
});

test("no conflict input reaches the trainee DTO", () => {
  const json = JSON.stringify(traineeDto());
  for (const secret of [EXAMINER_SET_ID, HORSE_SECRET]) {
    assert.equal(json.includes(secret), false, `the trainee DTO leaked ${secret}`);
  }
  for (const key of ["examinerSetId", "supervisorIds", "horseIds", "interval", "expectsStaffing", "capacity"]) {
    assert.equal(json.includes(`"${key}"`), false, `the trainee DTO carries a ${key} field`);
  }
  // Structurally impossible: the builder is never handed the conflict input.
  assert.equal(/buildTraineeExamDayDto\([^)]*conflict/i.test(DTO_CODE), false);
});

test("no diagnostic, issue list or EX-* code reaches the trainee DTO", () => {
  const json = JSON.stringify(traineeDto());
  assert.equal(/EX-[A-Z]/.test(json), false, "an EX-* code reached the trainee DTO");
  for (const key of ["diagnostics", "issues", "narrowingIssues", "code", "message"]) {
    assert.equal(json.includes(`"${key}"`), false, `the trainee DTO carries a ${key} field`);
  }
});

test("no unapproved notes and no publication state reach the trainee DTO", () => {
  const json = JSON.stringify(traineeDto());
  // The LESSON's own notes are operational, not trainee data.
  assert.equal(json.includes(LESSON_NOTES), false);
  for (const key of ["notes", "individualPublishedAt", "isPublished", "publishedAt", "updatedAt", "practiceType"]) {
    assert.equal(json.includes(`"${key}"`), false, `the trainee DTO carries a ${key} field`);
  }
  // ...while the APPROVED child-level notes are present.
  assert.ok(json.includes("childNotes"));
  assert.ok(json.includes("equipmentNotes"));
});

test("no trainee field name carries a student-id or instructor-id suffix", () => {
  const offenders: string[] = [];
  const walk = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => walk(entry, `${path}[${index}]`));
      return;
    }
    if (value === null || typeof value !== "object") return;
    for (const key of Object.keys(value as Record<string, unknown>)) {
      if (/(studentIds?|instructorIds?|viewerStudentId)$/i.test(key)) {
        offenders.push(`${path}.${key}`);
      }
      walk((value as Record<string, unknown>)[key], `${path}.${key}`);
    }
  };
  walk(JSON.parse(JSON.stringify(traineeDto())), "$");
  assert.deepEqual(offenders, []);
});

// ===========================================================================
// 20–26. Beginner detail attachment
// ===========================================================================

test("beginner detail attaches ONLY by exact session id", () => {
  const dto = traineeDto();
  const row = rowById(dto.allRows, "tp:l1");
  assert.ok(row.beginner !== null);
  assert.equal(row.beginner.sessionId, "tp:l1");
  assert.equal(row.beginner.lessonId, "l1");
  // A stored row never consults the beginner lookup.
  assert.equal(rowById(dto.allRows, "s1").beginner, null);
});

test("a MISSING beginner detail attaches nothing at all", () => {
  const row = rowById(traineeDto().allRows, "tp:l3");
  assert.equal(row.beginner, null);
  assert.equal(row.location, null);
  // The compact row itself survives.
  assert.equal(row.sessionId, "tp:l3");
  assert.equal(row.startTime, "13:00");
});

test("a MISMATCHED beginner detail fails closed", () => {
  const dto = traineeDto();
  const row = rowById(dto.allRows, "tp:l4");
  assert.equal(row.beginner, null);
  const json = JSON.stringify(dto);
  assert.equal(json.includes(MISMATCHED_CHILD), false);
  assert.equal(json.includes(FILTERED_PHONE), false);
});

test("a filtered / unseen beginner detail can never appear", () => {
  const json = JSON.stringify(traineeDto());
  assert.equal(json.includes(FILTERED_CHILD), false);
  assert.equal(json.includes("tp:filtered"), false);
});

test("the trainee beginner detail carries the approved child and parent fields", () => {
  const row = rowById(traineeDto().allRows, "tp:l1");
  assert.ok(row.beginner !== null);
  assert.deepEqual(row.beginner.children, [
    {
      childAssignmentId: "ca-1",
      fullName: "ילד א",
      age: 8,
      gender: "F",
      childNotes: "רגישה לרעש",
      parentName: "הורה א",
      parentPhone: RAW_PARENT_PHONE,
      horseName: "סוסון",
      equipmentNotes: "קסדה קטנה",
      isAbsent: false,
    },
  ]);
  assert.equal(row.beginner.groupName, "א");
  assert.equal(row.beginner.location, "מגרש 2");
  assert.equal(row.location, "מגרש 2");
});

test("the raw parent phone survives verbatim and is never linkified", () => {
  const row = rowById(traineeDto().allRows, "tp:l1");
  assert.equal(row.beginner?.children[0]?.parentPhone, RAW_PARENT_PHONE);
  const json = JSON.stringify(traineeDto());
  assert.equal(/tel:|wa\.me|whatsapp/i.test(json), false);
  // ...and the module itself builds no such link.
  assert.equal(/tel:|wa\.me|whatsapp/i.test(DTO_CODE), false);
});

test("the responsible instructor is a display NAME, resolved by id then by source", () => {
  const dto = traineeDto();
  // Resolved through the injected lookup.
  assert.equal(rowById(dto.allRows, "tp:l1").beginner?.responsibleInstructorName, "מדריכה רות");
  // No lookup entry: the payload's own verbatim name is the fallback.
  assert.equal(rowById(dto.allRows, "tp:l2").beginner?.responsibleInstructorName, "מדריך ללא טבלה");
  assert.equal(JSON.stringify(dto).includes(INSTRUCTOR_ID), false);
});

// ===========================================================================
// Stored arena — the narrow display sibling
// ===========================================================================

test("a stored trainee row receives its arena from the exact display sibling", () => {
  const row = rowById(traineeDto().allRows, "s1");
  // Trimmed on the way out.
  assert.equal(row.arena, "מגרש 1");
  assert.ok(JSON.stringify(traineeDto()).includes("מגרש 1"));
});

test("a blank arena becomes null, never an empty string", () => {
  const dto = buildTraineeExamDayDto(
    traineeProjection(),
    BEGINNER_DETAILS,
    new Map([["s1", { sessionId: "s1", arena: "   " }]]),
    NAMES,
    ASSIGNMENT_DETAILS,
  );
  assert.equal(rowById(dto.allRows, "s1").arena, null);
});

test("a missing display entry yields arena null", () => {
  const dto = buildTraineeExamDayDto(
    traineeProjection(),
    BEGINNER_DETAILS,
    new Map(),
    NAMES,
    ASSIGNMENT_DETAILS,
  );
  assert.equal(rowById(dto.allRows, "s1").arena, null);
  // ...as does no lookup at all.
  const none = buildTraineeExamDayDto(
    traineeProjection(),
    BEGINNER_DETAILS,
    null,
    NAMES,
    ASSIGNMENT_DETAILS,
  );
  assert.equal(rowById(none.allRows, "s1").arena, null);
});

test("a display entry declaring another session fails closed", () => {
  const dto = traineeDto();
  assert.equal(rowById(dto.allRows, "s2").arena, null);
  assert.equal(JSON.stringify(dto).includes(ARENA_MISMATCH), false);
});

test("an unrelated session's arena can never attach", () => {
  const json = JSON.stringify(traineeDto());
  assert.equal(json.includes(ARENA_UNRELATED), false);
});

test("a beginner row uses its live location and never a stored arena", () => {
  const row = rowById(traineeDto().allRows, "tp:l1");
  assert.equal(row.arena, null);
  assert.equal(row.location, "מגרש 2");
  // The lookup DOES hold an entry for this beginner session; it must be ignored.
  assert.ok(SESSION_DISPLAY.has("tp:l1"));
  assert.equal(JSON.stringify(traineeDto()).includes(ARENA_GHOST), false);
});

test("the arena sibling carries an arena and nothing else", () => {
  const json = JSON.stringify(traineeDto());
  // The visible arena is present...
  assert.ok(json.includes("מגרש 1"));
  // ...while no conflict, slot, supervisor, horse, staffing or assignment value is.
  for (const secret of [EXAMINER_SET_ID, HORSE_SECRET, ASSIGNMENT_ID, INSTRUCTOR_ID, UNKNOWN_INSTRUCTOR_ID]) {
    assert.equal(json.includes(secret), false, `the trainee DTO leaked ${secret}`);
  }
  for (const key of ["supervisorNames", "supervisorCount", "slots", "interval", "expectsStaffing"]) {
    assert.equal(json.includes(`"${key}"`), false, `the trainee DTO carries ${key}`);
  }
  // The lookup itself is an INPUT: no Map survives into the returned DTO.
  assert.deepEqual(findNonPlainJsonPaths(traineeDto()), []);
});

test("the trainee builder accepts neither ConflictSession nor ExamPlanPayload", () => {
  const signature = /export function buildTraineeExamDayDto\(([\s\S]*?)\): TraineeExamDayDto/.exec(
    DTO_CODE,
  )?.[1];
  assert.ok(signature !== undefined, "signature not found");
  for (const forbidden of ["ConflictSession", "ExamPlanPayload", "conflictSessions", "storedDetails"]) {
    assert.equal(signature.includes(forbidden), false, `the trainee builder accepts ${forbidden}`);
  }
  assert.ok(signature.includes("TraineeExamSessionDisplayDetailLookup"));
});

// ===========================================================================
// Projected beginner participants only
// ===========================================================================

test("projected participants appear in the beginner names and count", () => {
  const row = rowById(traineeDto().allRows, "tp:l1");
  assert.deepEqual(row.beginner?.participantNames, ["אורי לוי", "דנה כהן", "דנה כהן"]);
  assert.equal(row.beginner?.participantCount, 3);
});

test("an isProjected:false participant appears in neither names nor count", () => {
  const dto = traineeDto();
  const row = rowById(dto.allRows, "tp:l5");
  // 4 projected of 5 source rows; the held-back one is gone from both.
  assert.equal(row.beginner?.participantCount, 4);
  assert.deepEqual(row.beginner?.participantNames, ["אורי לוי", "דנה כהן", "דנה כהן"]);
  const json = JSON.stringify(dto);
  assert.equal(json.includes(REJECTED_TRAINEE_NAME), false);
  assert.equal(json.includes(REJECTED_TRAINEE_ID), false);
  assert.equal(json.includes(REJECTED_PARTICIPANT_ID), false);
});

test("a projected participant with no resolvable name still counts", () => {
  const row = rowById(traineeDto().allRows, "tp:l5");
  // UNKNOWN_ID is projected and counted, but has no lookup entry.
  assert.equal(row.beginner?.participantCount, 4);
  assert.equal(row.beginner?.participantNames.length, 3);
  assert.equal(JSON.stringify(traineeDto()).includes(UNKNOWN_ID), false);
});

test("duplicate projected names stay duplicated, and projected order is preserved", () => {
  const row = rowById(traineeDto().allRows, "tp:l5");
  // Source order is OTHER, [held back], DUP_A, DUP_B, UNKNOWN.
  assert.deepEqual(row.beginner?.participantNames, ["אורי לוי", "דנה כהן", "דנה כהן"]);
});

test("the SAME projected-participant rule applies to trainee, admin and instructor", () => {
  const trainee = rowById(traineeDto().allRows, "tp:l5").beginner;
  const admin = buildAdminExamReadDto(payload(), NAMES).rows.find((r) => r.sessionId === "tp:l5")?.beginner;
  const instructor = buildInstructorExamReadDto(payload(), NAMES).rows.find(
    (r) => r.sessionId === "tp:l5",
  )?.beginner;
  for (const dto of [admin, instructor]) {
    assert.deepEqual(dto?.participantNames, trainee?.participantNames);
    assert.equal(dto?.participantCount, trainee?.participantCount);
  }
  for (const json of [
    JSON.stringify(buildAdminExamReadDto(payload(), NAMES)),
    JSON.stringify(buildInstructorExamReadDto(payload(), NAMES)),
  ]) {
    assert.equal(json.includes(REJECTED_TRAINEE_NAME), false);
    assert.equal(json.includes(REJECTED_TRAINEE_ID), false);
  }
});

test("the committed adapters really do hold back an invalid-role participant", () => {
  // The premise the filter rests on, asserted rather than assumed: the SOURCE
  // adapter retains the rejected row with `isProjected: false`, while the LIVE
  // adapter's participant list — the one `ExamPlanPayload` carries — is
  // projection-only by construction and so carries no flag at all.
  const adapted = adaptTeachingPracticeExamSources([
    {
      id: "l-real",
      practiceType: "LUNGE",
      date: DATE,
      startTime: "11:00",
      endTime: "12:00",
      createdAt: "2026-07-01T07:00:00.000Z",
      groupName: null,
      location: null,
      notes: null,
      isPublished: true,
      roleLabelOverrides: null,
      responsibleInstructorId: null,
      responsibleInstructorName: null,
      participants: [
        {
          id: "p-ok",
          traineeId: OTHER_ID,
          traineeName: "אורי לוי",
          role: "LEAD_INSTRUCTOR",
          isManualOverride: false,
          createdAt: "2026-07-01T08:00:00.000Z",
        },
        {
          id: REJECTED_PARTICIPANT_ID,
          traineeId: REJECTED_TRAINEE_ID,
          traineeName: REJECTED_TRAINEE_NAME,
          role: "NOT_A_REAL_ROLE",
          isManualOverride: false,
          createdAt: "2026-07-01T08:30:00.000Z",
        },
      ],
      childAssignments: [],
    },
  ]);

  // Retained as evidence in the SOURCE adapter's own operational detail...
  assert.deepEqual(
    adapted.details[0]?.participants.map((p) => [p.participantId, p.isProjected]),
    [
      ["p-ok", true],
      [REJECTED_PARTICIPANT_ID, false],
    ],
  );
  // ...and reported as a diagnostic.
  assert.ok(adapted.issues.some((i) => i.code === "EX-TP-ADP-PARTICIPANT-ROLE-INVALID"));

  // ...but ABSENT from the live projection the payload actually carries.
  const live = projectLiveBeginnerRows({ lessons: adapted.lessons, viewerTraineeId: null });
  const detail = live.rows[0]?.detail;
  assert.ok(detail !== undefined);
  assert.deepEqual(detail.participants.map((p) => p.participantId), ["p-ok"]);
  assert.equal(detail.participants.some((p) => "isProjected" in p), false);

  // End to end: the diagnostic may remain operational, while the rejected
  // participant's name and id appear in NO visible participant data.
  const session = live.rows[0]?.session;
  assert.ok(session !== undefined);
  const dto = buildAdminExamReadDto(
    payload({
      sessions: [session],
      beginnerDetails: new Map([[detail.sessionId, detail]]),
      conflictSessions: [],
      diagnostics: {
        ...payload().diagnostics,
        teachingPracticeSourceIssues: adapted.issues,
      },
    }),
    NAMES,
  );
  assert.deepEqual(dto.rows[0]?.beginner?.participantNames, ["אורי לוי"]);
  assert.equal(dto.rows[0]?.beginner?.participantCount, 1);
  assert.ok(
    dto.diagnostics.teachingPracticeSourceIssues.some(
      (i) => i.code === "EX-TP-ADP-PARTICIPANT-ROLE-INVALID",
    ),
  );
  const json = JSON.stringify(dto);
  assert.equal(json.includes(REJECTED_TRAINEE_NAME), false);
  assert.equal(json.includes(REJECTED_TRAINEE_ID), false);
  // The diagnostic names the PARTICIPANT id only — never the trainee or a name.
  assert.ok(json.includes(REJECTED_PARTICIPANT_ID));
});

// ===========================================================================
// 27–34. Admin / instructor
// ===========================================================================

test("the admin DTO carries the operational diagnostics", () => {
  const dto = buildAdminExamReadDto(payload(), NAMES);
  assert.equal(dto.diagnostics.storedAdapterIssues[0]?.code, "EX-ADP-DEFINITION-MISSING");
  assert.equal(dto.diagnostics.storedBlockDiagnostics[0]?.timetableWarnings[0]?.code, "EX-CALC-EMPTY-BLOCK");
  assert.equal(dto.diagnostics.teachingPracticeSourceIssues[0]?.code, "EX-TP-ADP-LESSON-ID-REQUIRED");
  assert.equal(dto.diagnostics.beginnerRejections[0]?.reason, "UNMAPPED_PRACTICE_TYPE");
  assert.equal(dto.diagnostics.loaderIssues[0]?.code, "EX-LOAD-SOURCE-DATE-INVALID");
  // The narrowing's own fail-closed decisions are observable to an operator.
  assert.deepEqual(
    [...dto.diagnostics.narrowingIssues].map((i) => `${i.code}:${i.sessionId ?? ""}`).sort(),
    ["EX-DTO-BEGINNER-DETAIL-CONFLICT:tp:l4", "EX-DTO-BEGINNER-DETAIL-REQUIRED:tp:l3"],
  );
});

test("the instructor DTO carries the same operational diagnostics", () => {
  const admin = buildAdminExamReadDto(payload(), NAMES);
  const instructor = buildInstructorExamReadDto(payload(), NAMES);
  assert.deepEqual(instructor.diagnostics, admin.diagnostics);
  assert.equal(instructor.viewerRole, "INSTRUCTOR");
  assert.equal(admin.viewerRole, "ADMIN");
});

test("admin and instructor are SEPARATE exported builders", () => {
  assert.equal(typeof buildAdminExamReadDto, "function");
  assert.equal(typeof buildInstructorExamReadDto, "function");
  assert.notEqual(buildAdminExamReadDto, buildInstructorExamReadDto);
  assert.ok(/export function buildAdminExamReadDto\(/.test(DTO_CODE));
  assert.ok(/export function buildInstructorExamReadDto\(/.test(DTO_CODE));
});

test("operational DTOs return no Map or Set and never the internal payload", () => {
  const source = payload();
  const dto = buildAdminExamReadDto(source, NAMES);
  assert.deepEqual(findNonPlainJsonPaths(dto), []);
  assert.notEqual(dto as unknown, source as unknown);
  assert.notEqual(dto.rows[0] as unknown, source.sessions[0] as unknown);
  assert.notEqual(dto.diagnostics as unknown, source.diagnostics as unknown);
  const json = JSON.stringify(dto);
  for (const key of ["storedDetails", "beginnerDetails", "conflictSessions", "slots"]) {
    assert.equal(json.includes(`"${key}"`), false, `the operational DTO carries ${key}`);
  }
});

test("supervisor ids become display names and are never leaked raw", () => {
  const dto = buildAdminExamReadDto(payload(), NAMES);
  const row = dto.rows.find((r) => r.sessionId === "s1");
  assert.deepEqual(row?.supervisorNames, ["מדריכה רות"]);
  // The count stays authoritative even though only one name resolved.
  assert.equal(row?.supervisorCount, 2);
  const json = JSON.stringify(dto);
  assert.equal(json.includes(INSTRUCTOR_ID), false);
  assert.equal(json.includes(UNKNOWN_INSTRUCTOR_ID), false);
});

test("the operational DTO reads NOTHING else from the conflict input", () => {
  const json = JSON.stringify(buildAdminExamReadDto(payload(), NAMES));
  for (const secret of [EXAMINER_SET_ID, HORSE_SECRET]) {
    assert.equal(json.includes(secret), false, `the operational DTO leaked ${secret}`);
  }
  // ...only the arena display label survives.
  assert.equal(
    buildAdminExamReadDto(payload(), NAMES).rows.find((r) => r.sessionId === "s1")?.arena,
    "מגרש 1",
  );
});

test("the operational DTO keeps unresolved stored rows, with their status", () => {
  const dto = buildAdminExamReadDto(payload(), NAMES);
  const row = dto.rows.find((r) => r.sessionId === "s3");
  assert.equal(row?.timetableStatus, "UNRESOLVED");
  assert.equal(row?.displayEndTime, null);
  assert.equal(row?.derivedBlockEndTime, null);
});

test("the operational beginner detail adds the operational fields only", () => {
  const dto = buildAdminExamReadDto(payload(), NAMES);
  const row = dto.rows.find((r) => r.sessionId === "tp:l1");
  assert.equal(row?.beginner?.notes, LESSON_NOTES);
  assert.equal(row?.beginner?.isPublished, true);
  assert.equal(row?.beginner?.practiceType, "LUNGE");
  assert.equal(row?.beginner?.children[0]?.parentPhone, RAW_PARENT_PHONE);
});

test("same-kind rows keep SEPARATE definition identity", () => {
  const dto = buildAdminExamReadDto(payload(), NAMES);
  const first = dto.rows.find((r) => r.sessionId === "s1");
  const second = dto.rows.find((r) => r.sessionId === "s2");
  assert.equal(first?.kind, second?.kind);
  assert.notEqual(first?.definitionId, second?.definitionId);
  assert.deepEqual(
    [first?.definitionName, second?.definitionName],
    ["מבחן ממשק", "מבחן ממשק מתקדם"],
  );
  // The trainee contract keeps the same distinction.
  const trainee = traineeDto();
  assert.notEqual(rowById(trainee.allRows, "s1").definitionId, rowById(trainee.allRows, "s2").definitionId);
});

test("LUNGE and BEGINNER_GROUP keep their beginner-format breakdown", () => {
  const trainee = traineeDto();
  assert.equal(rowById(trainee.allRows, "tp:l1").beginnerFormat, "LUNGE");
  assert.equal(rowById(trainee.allRows, "tp:l2").beginnerFormat, "BEGINNER_GROUP");
  assert.equal(rowById(trainee.allRows, "tp:l1").beginner?.beginnerFormat, "LUNGE");
  assert.equal(rowById(trainee.allRows, "tp:l2").beginner?.beginnerFormat, "BEGINNER_GROUP");
  // Stored rows carry no beginner format at all.
  assert.equal(rowById(trainee.allRows, "s1").beginnerFormat, null);

  const admin = buildAdminExamReadDto(payload(), NAMES);
  assert.deepEqual(
    admin.rows.filter((r) => r.source === "BEGINNER").map((r) => r.beginnerFormat),
    ["LUNGE", "BEGINNER_GROUP", "LUNGE", "LUNGE", "LUNGE"],
  );
});

test("plan publication state is reported, without disclosing more", () => {
  const published = buildAdminExamReadDto(payload(), NAMES);
  assert.equal(published.isPublished, true);
  assert.equal(published.publishedAt, 1_700_000_000_000);
  const draft = buildAdminExamReadDto(payload({ publishedAt: null }), NAMES);
  assert.equal(draft.isPublished, false);
  assert.equal(draft.publishedAt, null);
});

// ===========================================================================
// 35, 39–44. Purity, plain JSON, determinism, immutability
// ===========================================================================

test("no builder performs authorization", () => {
  for (const token of [
    "requireAdmin",
    "getCurrent",
    "getSession",
    "verifySession",
    "readSession",
    "capabilit",
    "enrollment",
    "courseOffering",
    "cookie",
    "isAuthorized",
    "hasAccess",
    "isActive",
    "throw new",
  ]) {
    assert.equal(
      DTO_CODE.toLowerCase().includes(token.toLowerCase()),
      false,
      `the pure DTO module references ${token}`,
    );
  }
  // Behavioural: a builder never throws and never refuses — it only narrows.
  assert.doesNotThrow(() => buildAdminExamReadDto(payload(), NAMES));
  assert.doesNotThrow(() =>
    buildTraineeExamDayDto(
      traineeProjection(),
      BEGINNER_DETAILS,
      SESSION_DISPLAY,
      NAMES,
      ASSIGNMENT_DETAILS,
    ),
  );
});

test("every DTO is plain JSON data", () => {
  for (const dto of [
    traineeDto() as unknown,
    buildAdminExamReadDto(payload(), NAMES) as unknown,
    buildInstructorExamReadDto(payload(), NAMES) as unknown,
  ]) {
    assert.deepEqual(findNonPlainJsonPaths(dto), []);
    assert.equal(isPlainJsonDto(dto), true);
  }
});

test("the plain-JSON checker is meaningful, not vacuously true", () => {
  assert.deepEqual(findNonPlainJsonPaths({ a: new Map() }), ["$.a (Map)"]);
  assert.deepEqual(findNonPlainJsonPaths({ a: new Set() }), ["$.a (Set)"]);
  assert.deepEqual(findNonPlainJsonPaths({ a: undefined }), ["$.a (undefined)"]);
  assert.deepEqual(findNonPlainJsonPaths({ a: () => 1 }), ["$.a (function)"]);
  assert.deepEqual(findNonPlainJsonPaths({ a: BigInt(10) }), ["$.a (bigint)"]);
  assert.deepEqual(findNonPlainJsonPaths({ a: Number.NaN }), ["$.a (non-finite number)"]);
  assert.deepEqual(findNonPlainJsonPaths([{ b: Symbol("x") }]), ["$[0].b (symbol)"]);
  // A cycle is reported rather than followed, so the checker always terminates.
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.deepEqual(findNonPlainJsonPaths(cyclic), ["$.self (circular)"]);
});

test("a JSON round trip preserves every DTO exactly", () => {
  for (const dto of [
    traineeDto() as unknown,
    buildAdminExamReadDto(payload(), NAMES) as unknown,
  ]) {
    assert.deepEqual(JSON.parse(JSON.stringify(dto)), dto);
  }
});

test("output is deterministic", () => {
  assert.deepEqual(JSON.stringify(traineeDto()), JSON.stringify(traineeDto()));
  assert.deepEqual(
    JSON.stringify(buildAdminExamReadDto(payload(), NAMES)),
    JSON.stringify(buildAdminExamReadDto(payload(), NAMES)),
  );
});

test("no input is mutated", () => {
  const before = inputSnapshot();
  buildTraineeExamDayDto(
    traineeProjection(),
    BEGINNER_DETAILS,
    SESSION_DISPLAY,
    NAMES,
    ASSIGNMENT_DETAILS,
  );
  buildAdminExamReadDto(payload(), NAMES);
  buildInstructorExamReadDto(payload(), NAMES);
  assert.equal(inputSnapshot(), before);
  // The caller's own objects are never frozen behind its back.
  assert.equal(Object.isFrozen(BEGINNER_DETAILS.get("tp:l1")), false);
  assert.equal(Object.isFrozen(NAMES.studentNames), false);
});

test("returned DTOs are frozen, matching the exam-core convention", () => {
  const trainee = traineeDto();
  assert.ok(Object.isFrozen(trainee));
  assert.ok(Object.isFrozen(trainee.allRows));
  assert.ok(Object.isFrozen(trainee.myRows));
  for (const row of trainee.allRows) {
    assert.ok(Object.isFrozen(row));
    assert.ok(Object.isFrozen(row.examineeNames));
    if (row.beginner !== null) {
      assert.ok(Object.isFrozen(row.beginner));
      assert.ok(Object.isFrozen(row.beginner.children));
      for (const child of row.beginner.children) assert.ok(Object.isFrozen(child));
    }
  }
  const admin = buildAdminExamReadDto(payload(), NAMES);
  assert.ok(Object.isFrozen(admin));
  assert.ok(Object.isFrozen(admin.rows));
  assert.ok(Object.isFrozen(admin.diagnostics));
});

test("freezing is documented as MUTATION PROTECTION ONLY, never as privacy", () => {
  const flat = DTO_COMMENTS.replace(/\s+/g, " ");
  assert.ok(/MUTATION PROTECTION ONLY/i.test(flat), "the freezing note is missing");
  assert.ok(/performs no authorization/i.test(flat));
  assert.ok(/filters no field/i.test(flat));
  // ...and privacy is attributed to field omission instead.
  assert.ok(/FIELD OMISSION AND NOTHING ELSE/i.test(flat));
  // Behavioural proof that freezing is NOT what protects privacy: the internal
  // payload is frozen too, and still carries every secret.
  const source = payload();
  assert.ok(JSON.stringify(source.sessions).includes(SELF_ID));
});

// ===========================================================================
// 36–38, 45–48. Structural guards
// ===========================================================================

test("the DTO module imports no database client and declares no server action", () => {
  const forbidden = [
    "@" + "prisma/client",
    "@/lib/" + "prisma",
    "lib/" + "prisma",
    "next/" + "headers",
    "next/" + "navigation",
    "lib/actions/",
  ];
  // Asserted on CODE: the header legitimately NAMES the directives it forbids.
  for (const specifier of forbidden) {
    assert.equal(DTO_CODE.includes(specifier), false, `the DTO module imports ${specifier}`);
  }
  assert.equal(DTO_CODE.includes('"use ' + 'server"'), false);
  assert.equal(DTO_CODE.includes("'use " + "server'"), false);
  assert.equal(DTO_CODE.includes('"use ' + 'client"'), false);
  // ...and the header does state the rule it is holding itself to.
  assert.ok(DTO_COMMENTS.includes("use " + "server"));
  // Every import is from a sibling PURE exam core.
  const specifiers = [...DTO_CODE.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(specifiers.length > 0);
  for (const specifier of specifiers) {
    assert.ok(specifier?.startsWith("./exam-"), `unexpected import: ${specifier}`);
  }
});

test("the DTO module constructs no Date, clock, randomness or environment read", () => {
  for (const pattern of [/new Date\b/, /Date\.now\b/, /Math\.random\b/, /process\.env\b/]) {
    assert.equal(pattern.test(DTO_CODE), false, `the DTO module uses ${pattern}`);
  }
});

test("the module never re-exports the internal payload type", () => {
  assert.equal(/export\s+type\s+\{[^}]*ExamPlanPayload/.test(DTO_SOURCE), false);
  assert.equal(/export\s+\{[^}]*ExamPlanPayload/.test(DTO_SOURCE), false);
  assert.equal(/export\s+type\s+\w+\s*=\s*ExamPlanPayload/.test(DTO_CODE), false);
  // It is imported as a TYPE only, so nothing of it exists at runtime here.
  assert.ok(/import type \{\s*\n?\s*ExamPlanPayload/.test(DTO_SOURCE));
});

/** Every `.ts`/`.tsx` file in the repository's own source trees. */
function repoSourceFiles(): { path: string; source: string }[] {
  const files: { path: string; source: string }[] = [];
  for (const dir of ["app", "lib"]) {
    const root = join(REPO_ROOT, dir);
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!/\.tsx?$/.test(entry.name)) continue;
      const path = join(entry.parentPath ?? root, entry.name);
      if (path.includes(`${sep}generated${sep}`)) continue;
      files.push({ path, source: readFileSync(path, "utf8") });
    }
  }
  return files;
}

/**
 * The narrowing's own identifiers and the loader call site, assembled from SPLIT
 * LITERALS so these guards never match their own source.
 */
const DTO_TOKENS = new RegExp(
  [
    "exam-read-" + "dto",
    "build" + "AdminExamReadDto",
    "build" + "InstructorExamReadDto",
    "build" + "TraineeExamDayDto",
  ].join("|"),
);
const LOADER_CALL = new RegExp("\\bload" + "ExamPlan\\s*\\(");

/** The ONE production module allowed to narrow, and the ONE allowed to load. */
const APPROVED_DTO_CONSUMER = join("lib", "exam", "exam-read-scope-core.ts");
const APPROVED_LOADER_CALLER = join("lib", "actions", "exam-role-readers.ts");

test("the DTO builders have exactly ONE production consumer: the EX-S5A-4B scope core", () => {
  const files = repoSourceFiles();
  assert.ok(files.length > 100, `sanity: expected the repository, found ${files.length} files`);

  // PRODUCTION code only: a `.test.ts` suite legitimately exercises the pure
  // builders directly. What is guarded is which SHIPPED module may turn the
  // sensitive superset into something a viewer receives.
  const consumers = files
    .filter((f) => f.path !== DTO_PATH)
    .filter((f) => !/\.test\.tsx?$/.test(f.path))
    .filter((f) => DTO_TOKENS.test(stripComments(f.source)))
    .map((f) => f.path.slice(REPO_ROOT.length + 1));
  assert.deepEqual(
    consumers,
    [APPROVED_DTO_CONSUMER],
    `narrowing may happen in ONE authorized place only; found: ${consumers.join(", ")}`,
  );

  // NO app/, route, page, UI or client component consumes the narrowing module —
  // not even a test file there. A DTO reaches a page through the role readers.
  const appConsumers = files
    .filter((f) => f.path.startsWith(join(REPO_ROOT, "app")))
    .filter((f) => DTO_TOKENS.test(stripComments(f.source)))
    .map((f) => f.path.slice(REPO_ROOT.length + 1));
  assert.deepEqual(appConsumers, [], `an app consumer was added: ${appConsumers.join(", ")}`);

  // The ONLY production caller of the loader is the EX-S5A-4B binding.
  const loaderCallers = files
    .filter((f) => f.path !== join(REPO_ROOT, "lib", "exam", "exam-plan-loader-core.ts"))
    .filter((f) => !/\.test\.tsx?$/.test(f.path))
    .filter((f) => LOADER_CALL.test(stripComments(f.source)))
    .map((f) => f.path.slice(REPO_ROOT.length + 1));
  assert.deepEqual(loaderCallers, [APPROVED_LOADER_CALLER]);
});

test("the one authorized consumer returns DTOs only, and never the internal payload", () => {
  const scopeSource = readFileSync(join(REPO_ROOT, APPROVED_DTO_CONSUMER), "utf8");
  const scopeCode = stripComments(scopeSource);

  // Every exported reader's return type is a role contract...
  const returnTypes = [...scopeCode.matchAll(/export async function \w+\([\s\S]*?\): (\w+<[^>]+>)/g)]
    .map((match) => match[1]);
  assert.deepEqual(returnTypes, [
    "Promise<AdminExamReadDto>",
    "Promise<InstructorExamReadDto>",
    "Promise<TraineeExamDayDto>",
  ]);
  // ...the internal payload is NOT among them. It appears in exactly one place:
  // the injected loader contract, which is an INPUT seam (it is what makes the
  // loader replaceable in a test) and never something this module hands back.
  const payloadReturns = scopeCode.match(/Promise<ExamPlanPayload>/g) ?? [];
  assert.equal(
    payloadReturns.length,
    1,
    "the internal payload type appears outside the injected loader contract",
  );
  assert.ok(
    /export type ExamPlanLoadFn = \(\s*input: ExamPlanLoadInput,?\s*\) => Promise<ExamPlanPayload>;/.test(
      scopeCode,
    ),
    "the payload type is used somewhere other than the injected loader contract",
  );
  // ...and it is never re-exported, so no caller can even name it from here.
  assert.equal(/export\s+(?:type\s+)?\{[^}]*ExamPlanPayload/.test(scopeCode), false);
  // ...and every result is produced by a COMMITTED builder, never assembled
  // field-by-field a second time.
  for (const builder of [
    "build" + "AdminExamReadDto(",
    "build" + "InstructorExamReadDto(",
    "build" + "TraineeExamDayDto(",
  ]) {
    assert.ok(scopeCode.includes(`return ${builder}`), `the scope core bypasses ${builder}`);
  }
});

test("the approved file scope is exactly the two new files", () => {
  for (const path of [DTO_PATH, DTO_TEST_PATH]) {
    assert.ok(existsSync(path), `missing ${path}`);
  }
  // No route, page or UI was added by this slice.
  for (const dir of ["app/admin/exams", "app/instructor/exams", "app/student/exams"]) {
    assert.equal(existsSync(join(REPO_ROOT, dir)), false, `${dir} was created`);
  }
});

test("ProjectionSession was not widened by this slice", () => {
  const projectionSource = readFileSync(PROJECTION_PATH, "utf8");
  const block = /export interface ProjectionSession \{([\s\S]*?)\n\}/.exec(projectionSource)?.[1];
  assert.ok(block !== undefined, "ProjectionSession not found");
  const fields = [...block.matchAll(/^\s{2}readonly (\w+)\??:/gm)].map((m) => m[1]);
  assert.deepEqual(fields, [
    "sessionId",
    "kind",
    "beginnerFormat",
    "date",
    "startTime",
    "endTime",
    "orderIndex",
    "examineeStudentIds",
    "instructedTraineeStudentIds",
    "beginnerChildCount",
    "definitionId",
    "definitionName",
    "derivedBlockEndTime",
    "timetableStatus",
  ]);
  // The committed cores know nothing about this DTO layer.
  assert.equal(projectionSource.includes("exam-read-dto"), false);
});

// ===========================================================================
// EX-OPS-READ-MVP — the assignment-level operational rows
// ===========================================================================

test("a stored row carries the complete assignment rows for every role", () => {
  const trainee = rowById(traineeDto().allRows, "s1");
  const admin = buildAdminExamReadDto(payload(), NAMES).rows.find((r) => r.sessionId === "s1");
  assert.ok(admin !== undefined);

  assert.deepEqual(
    trainee.assignments.map((a) => [
      a.participantName,
      a.role,
      a.horseName,
      a.instructionTopic,
      a.discipline,
      a.personalStartTime,
      a.personalEndTime,
    ]),
    [
      ["אני חניך", "EXAMINEE", "סוסה כחולה", "עצירה", "אילוף", "09:00", "09:20"],
      // UNKNOWN_ID resolves to no name: the row survives, nameless.
      [null, "EXAMINEE", "סוס אלמוני", null, null, "09:40", "10:00"],
    ],
  );
  // The trainee and the operational readings are the SAME contract, apart from
  // the ONE trainee-only marker: the admin row set is unchanged, and the trainee
  // rows differ by exactly `isSelf` - a BOOLEAN, never an identifier.
  assert.deepEqual(
    admin.assignments.map((row) => Object.keys(row)),
    trainee.assignments.map((row) => Object.keys(row).filter((key) => key !== "isSelf")),
  );
  assert.deepEqual(
    admin.assignments,
    trainee.assignments.map((row) => {
      const { isSelf: _isSelf, ...rest } = row;
      void _isSelf;
      return rest;
    }),
  );
  for (const row of admin.assignments) {
    assert.equal("isSelf" in row, false, "an admin assignment row must not carry isSelf");
  }
  // ...and the unresolved student id itself is never emitted as a name.
  assert.equal(JSON.stringify(trainee.assignments).includes(UNKNOWN_ID), false);
});

test("a paired instructed trainee reads its partner, inherited topic and inherited time", () => {
  const row = rowById(traineeDto().allRows, "s2");
  const [examinee, instructed] = row.assignments;

  assert.equal(examinee.role, "EXAMINEE");
  assert.equal(examinee.pairedParticipantName, "נועה ברק");
  assert.deepEqual(examinee.pairedParticipantNames, ["נועה ברק"]);

  assert.equal(instructed.role, "INSTRUCTED_TRAINEE");
  assert.equal(instructed.participantName, "נועה ברק");
  assert.equal(instructed.pairedParticipantName, "אורי לוי");
  assert.deepEqual(instructed.pairedParticipantNames, ["אורי לוי"]);
  assert.equal(instructed.instructionTopic, "מעברים");
  assert.equal(instructed.discipline, "קפיצה");
  assert.equal(instructed.horseName, null);
  assert.equal(instructed.personalStartTime, "10:45");
  assert.equal(instructed.personalEndTime, "11:05");
});

test("an UNRESOLVED block keeps its assignment rows for an operational role only", () => {
  const admin = buildAdminExamReadDto(payload(), NAMES);
  const unresolved = admin.rows.find((r) => r.sessionId === "s3");
  assert.ok(unresolved !== undefined);
  assert.equal(unresolved.timetableStatus, "UNRESOLVED");
  assert.deepEqual(
    unresolved.assignments.map((a) => [a.participantName, a.horseName, a.personalStartTime]),
    [["אורי לוי", "סוס ללא שעה", null]],
  );
  // The committed trainee core hides the row itself, so it carries none.
  assert.equal(
    traineeDto().allRows.some((r) => r.sessionId === "s3"),
    false,
  );
});

test("the assignment detail attaches by EXACT session id and fails closed", () => {
  const dto = traineeDto();
  // Keyed to `s-mismatch` while DECLARING another session: nothing attaches, and
  // the horse it carries never appears anywhere.
  assert.equal(JSON.stringify(dto).includes(MISMATCHED_HORSE), false);
  // A BEGINNER row never consumes a stored assignment list.
  assert.deepEqual(rowById(dto.allRows, "tp:l1").assignments, []);
  assert.equal(JSON.stringify(dto).includes(GHOST_HORSE), false);

  // A missing lookup, an empty one and an unusable one all yield empty lists.
  for (const lookup of [null, undefined, new Map(), { get: 1 } as never]) {
    const none = buildTraineeExamDayDto(
      traineeProjection(),
      BEGINNER_DETAILS,
      SESSION_DISPLAY,
      NAMES,
      lookup,
    );
    assert.deepEqual(rowById(none.allRows, "s1").assignments, []);
  }
});

test("a row with no resolvable partner name exposes no partner at all", () => {
  const lookup = new Map<string, StoredExamBlockOperationalDetail>([
    [
      "s1",
      {
        source: "STORED",
        sessionId: "s1",
        assignments: [
          operationalRow({
            studentId: SELF_ID,
            role: "EXAMINEE",
            // A partner whose id is in NO name table.
            pairedStudentIds: [UNKNOWN_ID],
          }),
        ],
      },
    ],
  ]);
  const dto = buildTraineeExamDayDto(
    traineeProjection(),
    BEGINNER_DETAILS,
    SESSION_DISPLAY,
    NAMES,
    lookup,
  );
  const [row] = rowById(dto.allRows, "s1").assignments;
  assert.equal(row.pairedParticipantName, null);
  assert.deepEqual(row.pairedParticipantNames, []);
  assert.equal(JSON.stringify(dto).includes(UNKNOWN_ID), false);
});

test("the assignment rows are frozen, freshly allocated and plain JSON", () => {
  const dto = traineeDto();
  const row = rowById(dto.allRows, "s1");
  assert.ok(Object.isFrozen(row.assignments));
  assert.ok(Object.isFrozen(row.assignments[0]));
  assert.ok(Object.isFrozen(row.assignments[0].pairedParticipantNames));
  assert.deepEqual(findNonPlainJsonPaths(dto), []);
  // No two empty lists are the same object.
  const empties = dto.allRows.filter((r) => r.assignments.length === 0);
  assert.ok(empties.length > 1);
  assert.notEqual(empties[0].assignments, empties[1].assignments);
  // The caller's own lookup is never frozen behind its back.
  assert.equal(Object.isFrozen(ASSIGNMENT_DETAILS), false);
});
