/**
 * EXAM EX-S5A-2 — tests for the PURE Teaching-Practice source adapter core.
 *
 * DB-FREE: every case builds plain scalar rows in memory. This suite opens no
 * database connection, executes no SQL, reads no session and constructs no
 * `Date`. The only file it reads from disk is the adapter's own SOURCE, for the
 * structural guards at the end.
 *
 * Run with: npx tsx --test lib/exam/exam-tp-source-adapter-core.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type {
  TeachingPracticeExamChildAssignmentRow,
  TeachingPracticeExamLessonRow,
  TeachingPracticeExamParticipantRow,
} from "./exam-tp-source-adapter-core";
import {
  TEACHING_PRACTICE_SOURCE_ADAPTER_MESSAGES,
  adaptTeachingPracticeExamSources,
} from "./exam-tp-source-adapter-core";
import { projectLiveBeginnerRows } from "./exam-live-beginner-adapter-core";
import { projectGeneralSchedule } from "./exam-schedule-projection-core";
import { projectByExamDefinition } from "./exam-group-projection-core";

// ===========================================================================
// Fixtures
// ===========================================================================

function participant(
  over: Partial<TeachingPracticeExamParticipantRow> = {},
): TeachingPracticeExamParticipantRow {
  return {
    id: "p1",
    traineeId: "s1",
    traineeName: "חניך א",
    role: "LEAD_INSTRUCTOR",
    isManualOverride: false,
    createdAt: "2026-07-01T08:00:00.000Z",
    ...over,
  };
}

function childAssignment(
  over: Partial<TeachingPracticeExamChildAssignmentRow> = {},
): TeachingPracticeExamChildAssignmentRow {
  return {
    id: "ca1",
    childId: "c1",
    childName: "ילד א",
    childAge: 9,
    childGender: "F",
    childNotes: "רגיש לרעש",
    parentName: "הורה א",
    parentPhone: "050-1234567",
    horseName: "סוסון",
    equipmentNotes: "קסדה קטנה",
    isAbsent: false,
    ...over,
  };
}

function lesson(over: Partial<TeachingPracticeExamLessonRow> = {}): TeachingPracticeExamLessonRow {
  return {
    id: "l1",
    practiceType: "LUNGE",
    date: "2026-08-02",
    startTime: "09:00",
    endTime: "10:00",
    createdAt: "2026-07-01T07:00:00.000Z",
    groupName: "א",
    location: "מגרש 1",
    notes: "הערת שיעור",
    isPublished: true,
    roleLabelOverrides: null,
    responsibleInstructorId: "i1",
    responsibleInstructorName: "מדריכה א",
    participants: [participant()],
    childAssignments: [childAssignment()],
    ...over,
  };
}

function codes(result: ReturnType<typeof adaptTeachingPracticeExamSources>): string[] {
  return result.issues.map((i) => i.code);
}

const SOURCE_PATH = join(import.meta.dirname, "exam-tp-source-adapter-core.ts");

/** The adapter's own SOURCE TEXT, for the structural guards. */
function readSource(): string {
  return readFileSync(SOURCE_PATH, "utf8");
}

/** A deterministic, seed-free shuffle: reverse plus a rotation. No randomness. */
function shuffled<T>(items: readonly T[]): T[] {
  const reversed = [...items].reverse();
  return [...reversed.slice(1), reversed[0]];
}

// ===========================================================================
// 1-4 — practice type / beginner format
// ===========================================================================

test("a valid LUNGE lesson adapts successfully", () => {
  const result = adaptTeachingPracticeExamSources([lesson({ practiceType: "LUNGE" })]);
  assert.equal(result.lessons.length, 1);
  assert.equal(result.details.length, 1);
  assert.deepEqual(result.issues, []);
  assert.equal(result.lessons[0].lessonId, "l1");
  assert.equal(result.lessons[0].practiceType, "LUNGE");
});

test("a valid BEGINNER_GROUP lesson adapts successfully", () => {
  const result = adaptTeachingPracticeExamSources([
    lesson({ id: "l2", practiceType: "BEGINNER_GROUP" }),
  ]);
  assert.equal(result.lessons.length, 1);
  assert.equal(result.lessons[0].practiceType, "BEGINNER_GROUP");
  assert.deepEqual(result.issues, []);
});

test("an unsupported practice type is excluded and reported", () => {
  const result = adaptTeachingPracticeExamSources([
    lesson({ id: "lx", practiceType: "ADVANCED_LESSON" }),
  ]);
  assert.deepEqual(result.lessons, []);
  assert.deepEqual(result.details, []);
  assert.deepEqual(codes(result), ["EX-TP-ADP-PRACTICE-TYPE-UNSUPPORTED"]);
  assert.equal(result.issues[0].lessonId, "lx");
});

test("the practice-type mapping comes ONLY from the committed mapping core", () => {
  // The three tokens the committed table maps are the three that survive; every
  // other token — including a plausible near-miss and a prototype key — is
  // rejected, and no token is ever coerced to a beginner format.
  for (const practiceType of ["LUNGE", "BEGINNER_PRIVATE", "BEGINNER_GROUP"]) {
    const ok = adaptTeachingPracticeExamSources([lesson({ practiceType })]);
    assert.equal(ok.lessons.length, 1, `${practiceType} must be accepted`);
  }
  for (const practiceType of ["lunge", "BEGINNER", "constructor", "toString", "__proto__", ""]) {
    const bad = adaptTeachingPracticeExamSources([lesson({ practiceType })]);
    assert.deepEqual(bad.lessons, [], `${practiceType} must be rejected`);
    assert.deepEqual(codes(bad), ["EX-TP-ADP-PRACTICE-TYPE-UNSUPPORTED"]);
  }

  // The adapter declares no mapping table of its own.
  const source = readSource();
  assert.equal(source.includes("BEGINNER_PRIVATE"), false);
  assert.match(source, /mapPracticeTypeToBeginnerFormat/);
});

// ===========================================================================
// 5-9 — lesson identity, date and time
// ===========================================================================

test("a blank lesson id is excluded and reported", () => {
  for (const id of ["", "   "]) {
    const result = adaptTeachingPracticeExamSources([lesson({ id })]);
    assert.deepEqual(result.lessons, []);
    assert.deepEqual(codes(result), ["EX-TP-ADP-LESSON-ID-REQUIRED"]);
    assert.equal(result.issues[0].lessonId, null, "an illegible id is never echoed back");
  }
});

test("an invalid date token is excluded and reported", () => {
  for (const date of ["2026-8-2", "02/08/2026", "", "2026-08-02T00:00:00.000Z"]) {
    const result = adaptTeachingPracticeExamSources([lesson({ date })]);
    assert.deepEqual(result.lessons, [], `${date} must be rejected`);
    assert.deepEqual(codes(result), ["EX-TP-ADP-DATE-INVALID"]);
  }
});

test("an invalid start time is excluded and reported", () => {
  for (const startTime of ["9:00", "24:00", "09:60", "", "morning"]) {
    const result = adaptTeachingPracticeExamSources([lesson({ startTime })]);
    assert.deepEqual(result.lessons, [], `${startTime} must be rejected`);
    assert.deepEqual(codes(result), ["EX-TP-ADP-TIME-INVALID"]);
  }
});

test("an invalid end time is excluded and reported", () => {
  for (const endTime of ["10:0", "25:00", "10:75", ""]) {
    const result = adaptTeachingPracticeExamSources([lesson({ endTime })]);
    assert.deepEqual(result.lessons, [], `${endTime} must be rejected`);
    assert.deepEqual(codes(result), ["EX-TP-ADP-TIME-INVALID"]);
  }
});

test("endTime <= startTime is excluded and reported as a RANGE defect", () => {
  const zero = adaptTeachingPracticeExamSources([
    lesson({ startTime: "09:00", endTime: "09:00" }),
  ]);
  assert.deepEqual(zero.lessons, []);
  assert.deepEqual(codes(zero), ["EX-TP-ADP-TIME-RANGE-INVALID"]);

  const inverted = adaptTeachingPracticeExamSources([
    lesson({ startTime: "10:00", endTime: "09:00" }),
  ]);
  assert.deepEqual(inverted.lessons, []);
  assert.deepEqual(codes(inverted), ["EX-TP-ADP-TIME-RANGE-INVALID"]);
});

test("a lesson with several defects reports exactly ONE stable reason", () => {
  const result = adaptTeachingPracticeExamSources([
    lesson({ id: "", date: "nope", startTime: "99:99", practiceType: "NOPE" }),
  ]);
  assert.deepEqual(codes(result), ["EX-TP-ADP-LESSON-ID-REQUIRED"]);
});

// ===========================================================================
// 10-13 — deterministic ordering
// ===========================================================================

test("createdAt participates in the deterministic lesson ordering", () => {
  const rows = [
    lesson({ id: "b", createdAt: "2026-07-01T09:00:00.000Z" }),
    lesson({ id: "a", createdAt: "2026-07-01T08:00:00.000Z" }),
  ];
  const result = adaptTeachingPracticeExamSources(rows);
  assert.deepEqual(
    result.lessons.map((l) => l.lessonId),
    ["a", "b"],
    "same date and start — createdAt decides",
  );
});

test("the lesson id is the final ordering tie-break", () => {
  const same = { date: "2026-08-02", startTime: "09:00", createdAt: "2026-07-01T08:00:00.000Z" };
  const result = adaptTeachingPracticeExamSources([
    lesson({ id: "l3", ...same }),
    lesson({ id: "l1", ...same }),
    lesson({ id: "l2", ...same }),
  ]);
  assert.deepEqual(
    result.lessons.map((l) => l.lessonId),
    ["l1", "l2", "l3"],
  );
  assert.deepEqual(
    result.details.map((d) => d.lessonId),
    ["l1", "l2", "l3"],
    "details stay index-aligned with lessons",
  );
});

test("shuffled input produces an identical result", () => {
  const rows = [
    lesson({ id: "l1", date: "2026-08-03", startTime: "09:00" }),
    lesson({ id: "l2", date: "2026-08-02", startTime: "11:00", endTime: "12:00" }),
    lesson({ id: "l3", date: "2026-08-02", startTime: "09:00", practiceType: "BEGINNER_GROUP" }),
    lesson({ id: "l4", date: "2026-08-02", startTime: "09:00", createdAt: "2026-07-01T06:00:00.000Z" }),
    lesson({ id: "bad1", practiceType: "NOPE" }),
    lesson({ id: "bad2", date: "nope" }),
  ];
  const a = adaptTeachingPracticeExamSources(rows);
  const b = adaptTeachingPracticeExamSources(shuffled(rows));
  assert.deepEqual(b, a);
  assert.deepEqual(
    a.lessons.map((l) => l.lessonId),
    // (date, startTime, createdAt, lessonId) — never the caller's array order.
    ["l4", "l3", "l2", "l1"],
  );
  // Issues are ordered by (lessonId, code, …), never by arrival.
  assert.deepEqual(codes(a), ["EX-TP-ADP-PRACTICE-TYPE-UNSUPPORTED", "EX-TP-ADP-DATE-INVALID"]);
});

test("participant order is createdAt then participant id", () => {
  const result = adaptTeachingPracticeExamSources([
    lesson({
      participants: [
        participant({ id: "p3", traineeId: "s3", createdAt: "2026-07-01T09:00:00.000Z" }),
        participant({ id: "p2", traineeId: "s2", createdAt: "2026-07-01T08:00:00.000Z" }),
        participant({ id: "p1", traineeId: "s1", createdAt: "2026-07-01T08:00:00.000Z" }),
      ],
    }),
  ]);
  assert.deepEqual(
    result.lessons[0].participants.map((p) => p.participantId),
    ["p1", "p2", "p3"],
  );
  assert.deepEqual(
    result.details[0].participants.map((p) => p.participantId),
    ["p1", "p2", "p3"],
  );
});

// ===========================================================================
// 14-17 — participant identity
// ===========================================================================

test("a valid participant trainee id is preserved", () => {
  const result = adaptTeachingPracticeExamSources([
    lesson({ participants: [participant({ id: "p1", traineeId: " s9 " })] }),
  ]);
  assert.equal(result.lessons[0].participants[0].traineeId, "s9");
  assert.equal(result.details[0].participants[0].traineeId, "s9");
});

test("a null/blank trainee id is never inferred from the trainee name", () => {
  for (const traineeId of [null, "", "   "]) {
    const result = adaptTeachingPracticeExamSources([
      lesson({
        participants: [participant({ id: "p1", traineeId, traineeName: "חניך ללא מזהה" })],
      }),
    ]);
    // Detail keeps the AUTHORITATIVE absence...
    assert.equal(result.details[0].participants[0].traineeId, null);
    assert.equal(result.details[0].participants[0].traineeName, "חניך ללא מזהה");
    // ...and the compact source carries the fail-closed empty identity, which
    // the committed projection drops from the examinee set entirely.
    assert.equal(result.lessons[0].participants[0].traineeId, "");
    const projected = projectLiveBeginnerRows({
      lessons: result.lessons,
      viewerTraineeId: null,
    });
    assert.deepEqual(projected.rows[0].session.examineeStudentIds, []);
  }
});

test("an unknown participant role is excluded from the authoritative input and reported", () => {
  const result = adaptTeachingPracticeExamSources([
    lesson({
      participants: [
        participant({ id: "p1", traineeId: "s1", role: "LEAD_INSTRUCTOR" }),
        participant({ id: "p2", traineeId: "s2", role: "SPECTATOR" }),
        participant({ id: "p3", traineeId: "s3", role: "__proto__" }),
      ],
    }),
  ]);

  // Excluded from the compact source — so never an examinee, and never
  // defaulted to a trainee role.
  assert.deepEqual(
    result.lessons[0].participants.map((p) => p.participantId),
    ["p1"],
  );
  const projected = projectLiveBeginnerRows({ lessons: result.lessons, viewerTraineeId: null });
  assert.deepEqual(projected.rows[0].session.examineeStudentIds, ["s1"]);

  // Retained as evidence in the sibling detail, with the raw token verbatim.
  assert.deepEqual(
    result.details[0].participants.map((p) => [p.participantId, p.isProjected]),
    [
      ["p1", true],
      ["p2", false],
      ["p3", false],
    ],
  );
  assert.equal(result.details[0].participants[1].sourcePracticeRole, "SPECTATOR");

  assert.deepEqual(codes(result), [
    "EX-TP-ADP-PARTICIPANT-ROLE-INVALID",
    "EX-TP-ADP-PARTICIPANT-ROLE-INVALID",
  ]);
  assert.deepEqual(
    result.issues.map((i) => i.participantId),
    ["p2", "p3"],
  );
});

test("all four Teaching-Practice roles are recognised, EVALUATOR included", () => {
  const roles = ["LEAD_INSTRUCTOR", "SECOND_INSTRUCTOR", "ASSISTANT_INSTRUCTOR", "EVALUATOR"];
  const result = adaptTeachingPracticeExamSources([
    lesson({
      participants: roles.map((role, index) =>
        participant({ id: `p${index}`, traineeId: `s${index}`, role }),
      ),
    }),
  ]);
  assert.equal(result.lessons[0].participants.length, 4);
  assert.deepEqual(result.issues, []);
});

test("a blank participant id is excluded from BOTH payloads and reported", () => {
  const result = adaptTeachingPracticeExamSources([
    lesson({
      participants: [
        participant({ id: "  ", traineeId: "s2" }),
        participant({ id: "p1", traineeId: "s1" }),
      ],
    }),
  ]);
  assert.deepEqual(
    result.lessons[0].participants.map((p) => p.participantId),
    ["p1"],
  );
  assert.deepEqual(
    result.details[0].participants.map((p) => p.participantId),
    ["p1"],
  );
  assert.deepEqual(codes(result), ["EX-TP-ADP-PARTICIPANT-ID-REQUIRED"]);
  assert.equal(result.issues[0].participantId, null);
});

test("duplicate trainee ids are preserved verbatim and REPORTED, never deduplicated", () => {
  const result = adaptTeachingPracticeExamSources([
    lesson({
      participants: [
        participant({ id: "p1", traineeId: "s1", createdAt: "2026-07-01T08:00:00.000Z" }),
        participant({ id: "p2", traineeId: "s1", createdAt: "2026-07-01T09:00:00.000Z" }),
      ],
    }),
  ]);

  // Nothing is merged or dropped: the evidence survives into the projection.
  assert.deepEqual(
    result.lessons[0].participants.map((p) => p.traineeId),
    ["s1", "s1"],
  );
  const projected = projectLiveBeginnerRows({ lessons: result.lessons, viewerTraineeId: null });
  assert.deepEqual(projected.rows[0].session.examineeStudentIds, ["s1", "s1"]);

  // ...and the duplication is reported report-only, naming the PARTICIPANT.
  assert.deepEqual(codes(result), ["EX-TP-ADP-PARTICIPANT-TRAINEE-DUPLICATE"]);
  assert.equal(result.issues[0].participantId, "p2");
  assert.equal(result.issues[0].lessonId, "l1");
});

test("participants are never matched or merged by display name", () => {
  const result = adaptTeachingPracticeExamSources([
    lesson({
      participants: [
        participant({ id: "p1", traineeId: "s1", traineeName: "שם זהה" }),
        participant({ id: "p2", traineeId: "s2", traineeName: "שם זהה" }),
      ],
    }),
  ]);
  assert.equal(result.lessons[0].participants.length, 2);
  assert.deepEqual(result.issues, [], "identical names are not a duplication");
});

// ===========================================================================
// 18-20 — responsible instructor
// ===========================================================================

test("responsibleInstructorId is preserved and never derived from the name", () => {
  const result = adaptTeachingPracticeExamSources([
    lesson({ responsibleInstructorId: " i7 ", responsibleInstructorName: "מדריכה ב" }),
  ]);
  assert.equal(result.lessons[0].responsibleInstructorId, "i7");
  assert.equal(result.details[0].responsibleInstructorId, "i7");
});

test("a blank responsibleInstructorId becomes null and the name is not promoted", () => {
  for (const responsibleInstructorId of [null, "", "   "]) {
    const result = adaptTeachingPracticeExamSources([
      lesson({ responsibleInstructorId, responsibleInstructorName: "מדריכה ג" }),
    ]);
    assert.equal(result.lessons[0].responsibleInstructorId, null);
    assert.equal(result.details[0].responsibleInstructorId, null);
    assert.equal(result.details[0].responsibleInstructorName, "מדריכה ג");
  }
});

test("responsibleInstructorName stays display-only detail", () => {
  const result = adaptTeachingPracticeExamSources([
    lesson({ responsibleInstructorId: "i1", responsibleInstructorName: "מדריכה א" }),
  ]);
  const projected = projectLiveBeginnerRows({ lessons: result.lessons, viewerTraineeId: null });
  // The name never reaches the compact projection row, only its detail.
  assert.equal("responsibleInstructorName" in projected.rows[0].session, false);
  assert.equal(projected.rows[0].detail.responsibleInstructorName, "מדריכה א");
});

// ===========================================================================
// 21-24 — child / parent contact detail
// ===========================================================================

test("child assignments preserve every required raw field", () => {
  const row = childAssignment({ id: "ca9", childId: "c9", isAbsent: true });
  const result = adaptTeachingPracticeExamSources([lesson({ childAssignments: [row] })]);
  assert.deepEqual(result.details[0].childAssignments[0], {
    childAssignmentId: "ca9",
    childId: "c9",
    childName: "ילד א",
    childAge: 9,
    childGender: "F",
    childNotes: "רגיש לרעש",
    parentName: "הורה א",
    parentPhone: "050-1234567",
    horseName: "סוסון",
    equipmentNotes: "קסדה קטנה",
    isAbsent: true,
  });
});

test("child assignment order is deterministic and index-stable", () => {
  const rows = [
    childAssignment({ id: "ca3", childId: "c3", childName: "גד" }),
    childAssignment({ id: "ca1", childId: "c1", childName: "אבי" }),
    childAssignment({ id: "ca2", childId: "c2", childName: "אבי" }),
  ];
  const a = adaptTeachingPracticeExamSources([lesson({ childAssignments: rows })]);
  const b = adaptTeachingPracticeExamSources([lesson({ childAssignments: shuffled(rows) })]);
  assert.deepEqual(
    a.details[0].childAssignments.map((c) => c.childAssignmentId),
    ["ca1", "ca2", "ca3"],
  );
  assert.deepEqual(b, a);
});

test("a blank child assignment id is excluded and reported", () => {
  const result = adaptTeachingPracticeExamSources([
    lesson({
      childAssignments: [childAssignment({ id: "" }), childAssignment({ id: "ca2" })],
    }),
  ]);
  assert.deepEqual(
    result.details[0].childAssignments.map((c) => c.childAssignmentId),
    ["ca2"],
  );
  assert.equal(result.lessons[0].children.length, 1);
  assert.deepEqual(codes(result), ["EX-TP-ADP-CHILD-ASSIGNMENT-ID-REQUIRED"]);
});

test("the raw parent phone is preserved unchanged and no link is generated", () => {
  const phones = ["050-1234567", "  050 123 4567 ", "+972-50-1234567", "לא ידוע"];
  for (const parentPhone of phones) {
    const result = adaptTeachingPracticeExamSources([
      lesson({ childAssignments: [childAssignment({ parentPhone })] }),
    ]);
    assert.equal(result.details[0].childAssignments[0].parentPhone, parentPhone);
    assert.equal(result.lessons[0].children[0].parentPhone, parentPhone);
  }

  // No linkification anywhere in the adapter.
  const source = readSource();
  assert.equal(/tel:/.test(source), false);
  assert.equal(/wa\.me|whatsapp/i.test(source), false);
});

test("children are never merged or inferred from a shared parent contact", () => {
  const result = adaptTeachingPracticeExamSources([
    lesson({
      childAssignments: [
        childAssignment({ id: "ca1", childId: "c1", childName: "ילד א", parentPhone: "050-1" }),
        childAssignment({ id: "ca2", childId: "c2", childName: "ילד ב", parentPhone: "050-1" }),
      ],
    }),
  ]);
  assert.equal(result.details[0].childAssignments.length, 2);
  assert.equal(result.lessons[0].children.length, 2);
  assert.deepEqual(result.issues, []);
});

// ===========================================================================
// 25-26 — publication is DATA, never a filter
// ===========================================================================

test("isPublished is preserved without filtering", () => {
  const result = adaptTeachingPracticeExamSources([
    lesson({ id: "pub", isPublished: true }),
    lesson({ id: "unpub", isPublished: false }),
  ]);
  assert.deepEqual(
    result.lessons.map((l) => [l.lessonId, l.isPublished]),
    [
      ["pub", true],
      ["unpub", false],
    ],
  );
  assert.deepEqual(
    result.details.map((d) => d.isPublished),
    [true, false],
  );
});

test("an unpublished lesson remains in the role-neutral result", () => {
  const result = adaptTeachingPracticeExamSources([lesson({ isPublished: false })]);
  assert.equal(result.lessons.length, 1);
  assert.deepEqual(result.issues, []);
  const projected = projectLiveBeginnerRows({ lessons: result.lessons, viewerTraineeId: null });
  assert.equal(projected.rows.length, 1, "the gate belongs to the role reader, not here");
});

test("the output shape carries no role-specific visibility decision", () => {
  const result = adaptTeachingPracticeExamSources([lesson()]);
  const forbidden = [
    "isVisible",
    "canView",
    "visibleTo",
    "viewerTraineeId",
    "isSelf",
    "role",
    "capability",
  ];
  for (const key of forbidden) {
    assert.equal(key in result.lessons[0], false, `lesson source must not carry ${key}`);
    assert.equal(key in result.details[0], false, `detail must not carry ${key}`);
  }
  // The function itself takes no viewer and no role argument.
  assert.equal(adaptTeachingPracticeExamSources.length, 1);
});

// ===========================================================================
// 27 — roleLabelOverrides
// ===========================================================================

test("a malformed roleLabelOverrides runtime value never throws", () => {
  const malformed: unknown[] = [
    undefined,
    null,
    "string",
    42,
    true,
    [],
    ["a", "b"],
    { ok: "תפקיד", bad: 7, alsoBad: null },
    JSON.parse('{"__proto__": "polluted", "keep": "שמור"}'),
  ];
  for (const roleLabelOverrides of malformed) {
    const result = adaptTeachingPracticeExamSources([lesson({ roleLabelOverrides })]);
    assert.equal(result.lessons.length, 1);
    const value = result.lessons[0].roleLabelOverrides;
    assert.ok(value === null || typeof value === "object");
    if (value !== null) {
      for (const label of Object.values(value)) assert.equal(typeof label, "string");
      assert.equal(Object.prototype.hasOwnProperty.call(value, "__proto__"), false);
    }
  }
  // Nothing above polluted the global prototype.
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test("a well-formed roleLabelOverrides object is carried through frozen", () => {
  const result = adaptTeachingPracticeExamSources([
    lesson({ roleLabelOverrides: { LEAD_INSTRUCTOR: "מובילה" } }),
  ]);
  assert.deepEqual(result.lessons[0].roleLabelOverrides, { LEAD_INSTRUCTOR: "מובילה" });
  assert.equal(Object.isFrozen(result.lessons[0].roleLabelOverrides), true);
});

// ===========================================================================
// 28-32 — direct compatibility with the committed live adapter
// ===========================================================================

test("the resulting lesson source can be passed DIRECTLY to projectLiveBeginnerRows", () => {
  const result = adaptTeachingPracticeExamSources([
    lesson({ id: "l1", practiceType: "LUNGE" }),
    lesson({ id: "l2", practiceType: "BEGINNER_GROUP", startTime: "10:00", endTime: "11:00" }),
  ]);
  const projected = projectLiveBeginnerRows({ lessons: result.lessons, viewerTraineeId: "s1" });

  assert.equal(projected.rows.length, 2);
  assert.deepEqual(projected.rejected, [], "the adapter already excluded every unusable row");
  assert.deepEqual(
    projected.rows.map((r) => r.session.sessionId),
    ["tp:l1", "tp:l2"],
  );
  assert.deepEqual(
    projected.rows.map((r) => r.session.beginnerFormat),
    ["LUNGE", "BEGINNER_GROUP"],
  );
  assert.equal(projected.rows[0].detail.isSelf, true, "self-match is the live adapter's job");
});

test("projectLiveBeginnerRows emits timetableStatus NOT_APPLICABLE for adapter output", () => {
  const result = adaptTeachingPracticeExamSources([lesson()]);
  const projected = projectLiveBeginnerRows({ lessons: result.lessons, viewerTraineeId: null });
  assert.equal(projected.rows[0].session.timetableStatus, "NOT_APPLICABLE");
  assert.equal(projected.rows[0].session.startTime, "09:00");
  assert.equal(projected.rows[0].session.endTime, "10:00");
});

test("LUNGE and BEGINNER_GROUP group under the synthetic beginner exam, keeping the format breakdown", () => {
  const result = adaptTeachingPracticeExamSources([
    lesson({ id: "l1", practiceType: "LUNGE" }),
    lesson({ id: "l2", practiceType: "BEGINNER_GROUP", startTime: "10:00", endTime: "11:00" }),
  ]);
  const sessions = projectLiveBeginnerRows({
    lessons: result.lessons,
    viewerTraineeId: null,
  }).rows.map((r) => r.session);

  const grouped = projectByExamDefinition(sessions);
  assert.equal(grouped.groups.length, 1);
  assert.deepEqual(grouped.groups[0].key, { type: "BEGINNER" });
  assert.equal(grouped.groups[0].definitionId, null);
  assert.deepEqual(grouped.issues, []);

  const general = projectGeneralSchedule(sessions);
  const beginnerRow = general.find((r) => r.kind === "BEGINNER_INSTRUCTION");
  assert.ok(beginnerRow, "a beginner row must exist");
  // Sorted for comparison: the breakdown's own ordering is that core's contract,
  // not this adapter's — what matters here is that BOTH formats survive intact.
  assert.deepEqual(
    [...beginnerRow.formatBreakdown]
      .map((f) => [f.beginnerFormat, f.sessionCount])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    [
      ["BEGINNER_GROUP", 1],
      ["LUNGE", 1],
    ],
  );
});

test("this core creates no projection row and no synthetic live session id", () => {
  const result = adaptTeachingPracticeExamSources([lesson()]);
  assert.equal("session" in result.lessons[0], false);
  assert.equal("sessionId" in result.lessons[0], false);
  assert.equal("sessionId" in result.details[0], false);
  assert.equal("orderIndex" in result.lessons[0], false);
  assert.equal("beginnerFormat" in result.lessons[0], false);
  assert.equal("kind" in result.lessons[0], false);
  assert.equal(JSON.stringify(result).includes("tp:"), false);
});

// ===========================================================================
// 33-35 — purity, freezing, PII
// ===========================================================================

test("the inputs are never mutated", () => {
  const participants = [
    participant({ id: "p2", traineeId: "s2", createdAt: "2026-07-01T09:00:00.000Z" }),
    participant({ id: "p1", traineeId: "s1", createdAt: "2026-07-01T08:00:00.000Z" }),
  ];
  const childAssignments = [
    childAssignment({ id: "ca2", childName: "ב" }),
    childAssignment({ id: "ca1", childName: "א" }),
  ];
  const rows = [
    lesson({ id: "l2", participants, childAssignments }),
    lesson({ id: "l1", participants: [], childAssignments: [] }),
  ];
  const snapshot = JSON.parse(JSON.stringify(rows));

  adaptTeachingPracticeExamSources(rows);

  assert.deepEqual(JSON.parse(JSON.stringify(rows)), snapshot);
  assert.deepEqual(
    participants.map((p) => p.id),
    ["p2", "p1"],
    "the caller's participant array is not re-ordered in place",
  );
  assert.deepEqual(
    childAssignments.map((c) => c.id),
    ["ca2", "ca1"],
  );
  assert.deepEqual(
    rows.map((r) => r.id),
    ["l2", "l1"],
  );
});

test("the result, its nested arrays and its issues are frozen", () => {
  const result = adaptTeachingPracticeExamSources([
    lesson({
      participants: [participant({ id: "p1", role: "SPECTATOR" }), participant({ id: "p2" })],
    }),
  ]);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.lessons), true);
  assert.equal(Object.isFrozen(result.details), true);
  assert.equal(Object.isFrozen(result.issues), true);
  assert.equal(Object.isFrozen(result.lessons[0]), true);
  assert.equal(Object.isFrozen(result.lessons[0].participants), true);
  assert.equal(Object.isFrozen(result.lessons[0].participants[0]), true);
  assert.equal(Object.isFrozen(result.lessons[0].children), true);
  assert.equal(Object.isFrozen(result.lessons[0].children[0]), true);
  assert.equal(Object.isFrozen(result.details[0]), true);
  assert.equal(Object.isFrozen(result.details[0].participants), true);
  assert.equal(Object.isFrozen(result.details[0].participants[0]), true);
  assert.equal(Object.isFrozen(result.details[0].childAssignments), true);
  assert.equal(Object.isFrozen(result.details[0].childAssignments[0]), true);
  assert.equal(Object.isFrozen(result.issues[0]), true);
});

test("issue payloads carry no PII of any kind", () => {
  const result = adaptTeachingPracticeExamSources([
    lesson({
      id: "l1",
      practiceType: "NOPE",
      notes: "הערה סודית",
      participants: [participant({ id: "p1", traineeId: "s1", traineeName: "חניך א", role: "X" })],
      childAssignments: [childAssignment({ id: "", childName: "ילד א" })],
    }),
    lesson({
      id: "l2",
      participants: [participant({ id: "p9", traineeId: "s9", traineeName: "חניך ט", role: "X" })],
      childAssignments: [childAssignment({ id: "", parentPhone: "050-9999999" })],
    }),
  ]);

  const serialized = JSON.stringify(result.issues);
  for (const secret of [
    "s1",
    "s9",
    "חניך א",
    "חניך ט",
    "ילד א",
    "הורה א",
    "050-9999999",
    "050-1234567",
    "סוסון",
    "הערה סודית",
    "מדריכה א",
    "i1",
  ]) {
    assert.equal(serialized.includes(secret), false, `issues must not leak ${secret}`);
  }

  // Only the five documented keys exist on an issue.
  for (const issue of result.issues) {
    assert.deepEqual(Object.keys(issue).sort(), [
      "childAssignmentId",
      "code",
      "lessonId",
      "message",
      "participantId",
    ]);
    assert.equal(
      TEACHING_PRACTICE_SOURCE_ADAPTER_MESSAGES[issue.code],
      issue.message,
      "every issue binds its canonical message",
    );
  }
});

test("every issue code carries a Hebrew message", () => {
  const entries = Object.entries(TEACHING_PRACTICE_SOURCE_ADAPTER_MESSAGES);
  assert.equal(entries.length, 9);
  for (const [code, message] of entries) {
    assert.match(code, /^EX-TP-ADP-[A-Z-]+$/);
    assert.match(message, /[֐-׿]/, `${code} must have a Hebrew message`);
  }
  assert.equal(Object.isFrozen(TEACHING_PRACTICE_SOURCE_ADAPTER_MESSAGES), true);
});

test("an empty input yields an empty, frozen result", () => {
  const result = adaptTeachingPracticeExamSources([]);
  assert.deepEqual(result, { lessons: [], details: [], issues: [] });
  assert.equal(Object.isFrozen(result), true);
});

// ===========================================================================
// 36-38 — structural guards on the SOURCE file
// ===========================================================================

test("the source imports no Prisma and declares no server boundary", () => {
  const source = readSource();
  // Assembled from fragments so this suite does not itself trip the exam-slice
  // no-feedback / no-Prisma guard, which scans every file in lib/exam.
  const forbidden = ["@prisma" + "/client", "@/lib" + "/prisma", "PrismaClient", "next/", "node:fs"];
  for (const token of forbidden) {
    assert.equal(source.includes(token), false, `the adapter must not reference ${token}`);
  }
  // The DIRECTIVE, not the prose: the file header legitimately explains that it
  // declares no server boundary, and a bare substring check would fire on that.
  assert.equal(/^\s*["']use server["']/m.test(source), false, "no server directive");
});

test("the source depends on no feedback, rating or broad Teaching-Practice reader", () => {
  const source = readSource();
  const forbidden = [
    "TeachingPractice" + "Feedback",
    "ratingHalf" + "Points",
    "canView" + "Feedback",
    "LESSON_DETAIL" + "_INCLUDE",
    "lib/actions/" + "teaching-practice",
  ];
  for (const token of forbidden) {
    assert.equal(source.includes(token), false, `the adapter must not reference ${token}`);
  }

  // No field position may name a result-like concept, in either payload.
  for (const pattern of [
    /\bfeedback\s*\??\s*:/i,
    /\brating\w*\s*\??\s*:/i,
    /\bgrade\w*\s*\??\s*:/i,
    /\bscore\w*\s*\??\s*:/i,
    /\bresult\w*\s*\??\s*:/i,
    /\bprogress\w*\s*\??\s*:/i,
  ]) {
    assert.equal(pattern.test(source), false, `the adapter must declare no field ${pattern}`);
  }
});

test("the source builds no projection row, no session id and no clock value", () => {
  const source = readSource();
  for (const token of [
    "ProjectionSession",
    "buildLiveBeginnerSessionId",
    "LIVE_BEGINNER_SESSION_ID_PREFIX",
  ]) {
    assert.equal(source.includes(token), false, `the adapter must not use ${token}`);
  }
  // CALL positions only: the header legitimately NAMES the clock and randomness
  // primitives it forbids, and a bare substring check would fire on that prose.
  for (const pattern of [
    /\bDate\.now\s*\(/,
    /\bnew Date\s*\(/,
    /\bMath\.random\s*\(/,
    /\bprocess\.env\b/,
  ]) {
    assert.equal(pattern.test(source), false, `the adapter must not use ${pattern}`);
  }

  // Its only runtime imports are the two committed pure cores; the live-adapter
  // import is TYPE-ONLY and erased at build.
  assert.match(source, /import type \{[\s\S]*?\} from "\.\/exam-live-beginner-adapter-core";/);
  assert.match(source, /import \{ mapPracticeTypeToBeginnerFormat \} from/);
  assert.match(source, /import \{ isValidHHMM, parseHHMM \} from/);
});
