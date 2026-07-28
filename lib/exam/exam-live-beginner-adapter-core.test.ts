/**
 * EXAM EX-C2-0 — tests for the PURE live beginner-exam adapter.
 *
 * DB-FREE: no Prisma, no database, no network, no filesystem, no clock.
 *
 * The fixtures mirror the REAL approved source dates (2026-08-02 / 2026-08-03),
 * where several lessons genuinely share a start time — which is exactly what
 * makes the derived `orderIndex` load-bearing rather than cosmetic.
 *
 * Run with: npx tsx --test lib/exam/exam-live-beginner-adapter-core.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  LIVE_BEGINNER_SESSION_ID_PREFIX,
  buildLiveBeginnerSessionId,
  isLiveBeginnerSessionId,
  projectLiveBeginnerRows,
  type LiveBeginnerChildSource,
  type LiveBeginnerLessonSource,
  type LiveBeginnerParticipantSource,
} from "./exam-live-beginner-adapter-core";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function participant(
  over: Partial<LiveBeginnerParticipantSource> = {},
): LiveBeginnerParticipantSource {
  return {
    participantId: "p1",
    traineeId: "student-1",
    traineeName: "אביב בדש",
    role: "LEAD_INSTRUCTOR",
    isManualOverride: false,
    createdAt: "2026-07-01T10:00:00.000Z",
    ...over,
  };
}

function child(over: Partial<LiveBeginnerChildSource> = {}): LiveBeginnerChildSource {
  return {
    childAssignmentId: "ca1",
    childId: "c1",
    fullName: "אדווה דודקביץ'",
    age: 8,
    gender: "F",
    childNotes: "רגישה לרעש",
    parentName: "הורה א",
    parentPhone: "050-1234567",
    horseName: "לונה",
    equipmentNotes: "אוכף קטן",
    isAbsent: false,
    ...over,
  };
}

function lesson(over: Partial<LiveBeginnerLessonSource> = {}): LiveBeginnerLessonSource {
  return {
    lessonId: "lesson-1",
    practiceType: "LUNGE",
    date: "2026-08-02",
    startTime: "16:00",
    endTime: "16:30",
    createdAt: "2026-07-01T09:00:00.000Z",
    groupName: "א",
    location: "מקורה",
    notes: "הערת שיעור",
    isPublished: true,
    roleLabelOverrides: { LEAD_INSTRUCTOR: "מדריך 1" },
    responsibleInstructorId: "inst-1",
    responsibleInstructorName: "ליאור רז חת",
    participants: [participant()],
    children: [child()],
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Deterministic orderIndex
// ---------------------------------------------------------------------------

test("orderIndex is derived deterministically when start times tie", () => {
  const lessons = [
    lesson({ lessonId: "a", startTime: "16:00", createdAt: "2026-07-01T09:00:00.000Z" }),
    lesson({ lessonId: "b", startTime: "16:00", createdAt: "2026-07-01T08:00:00.000Z" }),
    lesson({ lessonId: "c", startTime: "16:00", createdAt: "2026-07-01T08:00:00.000Z" }),
    lesson({ lessonId: "d", startTime: "16:30" }),
  ];
  const { rows } = projectLiveBeginnerRows({ lessons, viewerTraineeId: null });

  // createdAt breaks the startTime tie; lessonId breaks the createdAt tie.
  assert.deepEqual(
    rows.map((r) => [r.detail.lessonId, r.session.orderIndex]),
    [
      ["b", 0],
      ["c", 1],
      ["a", 2],
      ["d", 3],
    ],
  );
});

test("input order does not affect the output", () => {
  const base = [
    lesson({ lessonId: "a", startTime: "16:00", createdAt: "2026-07-01T09:00:00.000Z" }),
    lesson({ lessonId: "b", startTime: "16:00", createdAt: "2026-07-01T08:00:00.000Z" }),
    lesson({ lessonId: "c", startTime: "17:30", practiceType: "BEGINNER_GROUP" }),
  ];
  const forward = projectLiveBeginnerRows({ lessons: base, viewerTraineeId: null });
  const reversed = projectLiveBeginnerRows({
    lessons: [...base].reverse(),
    viewerTraineeId: null,
  });

  assert.deepEqual(
    forward.rows.map((r) => r.session),
    reversed.rows.map((r) => r.session),
  );
});

test("orderIndex restarts at 0 on each date", () => {
  const lessons = [
    lesson({ lessonId: "d2-a", date: "2026-08-03", startTime: "16:00" }),
    lesson({ lessonId: "d2-b", date: "2026-08-03", startTime: "16:30" }),
    lesson({ lessonId: "d1-a", date: "2026-08-02", startTime: "16:00" }),
    lesson({ lessonId: "d1-b", date: "2026-08-02", startTime: "16:30" }),
  ];
  const { rows } = projectLiveBeginnerRows({ lessons, viewerTraineeId: null });

  assert.deepEqual(
    rows.map((r) => [r.session.date, r.detail.lessonId, r.session.orderIndex]),
    [
      ["2026-08-02", "d1-a", 0],
      ["2026-08-02", "d1-b", 1],
      ["2026-08-03", "d2-a", 0],
      ["2026-08-03", "d2-b", 1],
    ],
  );
});

// ---------------------------------------------------------------------------
// Synthetic session id
// ---------------------------------------------------------------------------

test("sessionId is namespaced as tp:<lessonId>", () => {
  const { rows } = projectLiveBeginnerRows({
    lessons: [lesson({ lessonId: "lesson-42" })],
    viewerTraineeId: null,
  });
  assert.equal(rows[0].session.sessionId, "tp:lesson-42");
  assert.equal(rows[0].detail.sessionId, "tp:lesson-42");
  assert.equal(LIVE_BEGINNER_SESSION_ID_PREFIX, "tp:");
  assert.equal(buildLiveBeginnerSessionId("x"), "tp:x");
});

test("synthetic ids never collide with cuid-shaped stored ExamSession ids", () => {
  // Cuid-SHAPED fixtures (fabricated, never a real id): lowercase alphanumeric
  // and colon-free, so the two id namespaces are disjoint in both directions.
  // ASSEMBLED AT RUNTIME so this file contains no cuid-shaped literal - the
  // exam slice forbids one outright (see exam-schema-structure.test.ts).
  const storedIds = ["c" + "x".repeat(24), "c" + "y".repeat(24)];
  assert.equal(storedIds[0].length, 25, "sanity: cuid-shaped fixture");
  const { rows } = projectLiveBeginnerRows({
    lessons: storedIds.map((id) => lesson({ lessonId: id })),
    viewerTraineeId: null,
  });

  for (const row of rows) {
    assert.equal(isLiveBeginnerSessionId(row.session.sessionId), true);
    assert.equal(storedIds.includes(row.session.sessionId), false);
  }
  for (const id of storedIds) {
    assert.equal(isLiveBeginnerSessionId(id), false);
    assert.equal(id.includes(":"), false);
  }
});

// ---------------------------------------------------------------------------
// Rejection
// ---------------------------------------------------------------------------

test("an unmapped practice type is rejected, never defaulted", () => {
  const { rows, rejected } = projectLiveBeginnerRows({
    lessons: [
      lesson({ lessonId: "ok" }),
      lesson({ lessonId: "bad", practiceType: "ADVANCED_GROUP" }),
      lesson({ lessonId: "proto", practiceType: "__proto__" }),
    ],
    viewerTraineeId: null,
  });

  assert.deepEqual(
    rows.map((r) => r.detail.lessonId),
    ["ok"],
  );
  assert.deepEqual(rejected, [
    { lessonId: "bad", reason: "UNMAPPED_PRACTICE_TYPE" },
    { lessonId: "proto", reason: "UNMAPPED_PRACTICE_TYPE" },
  ]);
});

test("a lesson with no usable id is rejected", () => {
  const { rows, rejected } = projectLiveBeginnerRows({
    lessons: [lesson({ lessonId: "   " })],
    viewerTraineeId: null,
  });
  assert.equal(rows.length, 0);
  assert.deepEqual(rejected, [{ lessonId: "", reason: "INVALID_LESSON_ID" }]);
});

// ---------------------------------------------------------------------------
// Participants — every one is an examinee
// ---------------------------------------------------------------------------

test("every participant becomes an examinee, EVALUATOR included", () => {
  const { rows } = projectLiveBeginnerRows({
    lessons: [
      lesson({
        participants: [
          participant({ participantId: "p1", traineeId: "s1", role: "LEAD_INSTRUCTOR" }),
          participant({ participantId: "p2", traineeId: "s2", role: "SECOND_INSTRUCTOR" }),
          participant({ participantId: "p3", traineeId: "s3", role: "EVALUATOR" }),
        ],
      }),
    ],
    viewerTraineeId: null,
  });

  assert.deepEqual([...rows[0].session.examineeStudentIds], ["s1", "s2", "s3"]);
  const evaluator = rows[0].detail.participants.find((p) => p.traineeId === "s3");
  assert.equal(evaluator?.sourcePracticeRole, "EVALUATOR", "original role preserved verbatim");
});

test("instructedTraineeStudentIds is always empty", () => {
  const { rows } = projectLiveBeginnerRows({
    lessons: [
      lesson({
        participants: [
          participant({ participantId: "p1", traineeId: "s1" }),
          participant({ participantId: "p2", traineeId: "s2", role: "EVALUATOR" }),
        ],
      }),
    ],
    viewerTraineeId: null,
  });
  assert.deepEqual([...rows[0].session.instructedTraineeStudentIds], []);
});

test("beginnerChildCount equals the number of child assignments", () => {
  const { rows } = projectLiveBeginnerRows({
    lessons: [
      lesson({
        children: [
          child({ childAssignmentId: "ca1", childId: "c1", fullName: "אור" }),
          child({ childAssignmentId: "ca2", childId: "c2", fullName: "בר" }),
          child({ childAssignmentId: "ca3", childId: "c3", fullName: "גל" }),
        ],
      }),
      lesson({ lessonId: "empty", startTime: "18:00", children: [] }),
    ],
    viewerTraineeId: null,
  });

  assert.equal(rows[0].session.beginnerChildCount, 3);
  assert.equal(rows[0].detail.children.length, 3);
  assert.equal(rows[1].session.beginnerChildCount, 0);
});

// ---------------------------------------------------------------------------
// Self-assignment — authoritative ids only
// ---------------------------------------------------------------------------

test("the viewer's participant row is marked by authoritative id", () => {
  const { rows } = projectLiveBeginnerRows({
    lessons: [
      lesson({
        participants: [
          participant({ participantId: "p1", traineeId: "s1", traineeName: "אביב בדש" }),
          participant({ participantId: "p2", traineeId: "s2", traineeName: "אגם מכלוף" }),
        ],
      }),
    ],
    viewerTraineeId: "s2",
  });

  assert.equal(rows[0].detail.isSelf, true);
  assert.deepEqual(
    rows[0].detail.participants.map((p) => [p.traineeId, p.isSelf]),
    [
      ["s1", false],
      ["s2", true],
    ],
  );
});

test("a viewer who does not participate is not marked", () => {
  const { rows } = projectLiveBeginnerRows({
    lessons: [lesson({ participants: [participant({ traineeId: "s1" })] })],
    viewerTraineeId: "s-other",
  });
  assert.equal(rows[0].detail.isSelf, false);
  assert.equal(rows[0].detail.participants.every((p) => p.isSelf === false), true);
});

test("matching never falls back to display names", () => {
  const { rows } = projectLiveBeginnerRows({
    lessons: [
      lesson({ participants: [participant({ traineeId: "s1", traineeName: "אביב בדש" })] }),
    ],
    // A NAME passed where an id belongs must match nobody.
    viewerTraineeId: "אביב בדש",
  });
  assert.equal(rows[0].detail.isSelf, false);
});

test("a null or blank viewer marks nobody", () => {
  for (const viewerTraineeId of [null, "", "   "]) {
    const { rows } = projectLiveBeginnerRows({
      lessons: [
        lesson({
          participants: [
            participant({ participantId: "p1", traineeId: "s1" }),
            participant({ participantId: "p2", traineeId: "s2" }),
          ],
        }),
      ],
      viewerTraineeId,
    });
    assert.equal(rows[0].detail.isSelf, false);
    assert.equal(rows[0].detail.participants.some((p) => p.isSelf), false);
  }
});

// ---------------------------------------------------------------------------
// Operational payload
// ---------------------------------------------------------------------------

test("parent contacts are projected verbatim, including nulls", () => {
  const { rows } = projectLiveBeginnerRows({
    lessons: [
      lesson({
        children: [
          child({
            childAssignmentId: "ca1",
            fullName: "א",
            parentName: "הורה א",
            parentPhone: "050-1234567",
          }),
          child({
            childAssignmentId: "ca2",
            fullName: "ב",
            parentName: null,
            parentPhone: null,
          }),
        ],
      }),
    ],
    viewerTraineeId: null,
  });

  assert.deepEqual(
    rows[0].detail.children.map((c) => [c.parentName, c.parentPhone]),
    [
      ["הורה א", "050-1234567"],
      [null, null],
    ],
  );
});

test("child notes, horse, equipment and absence are projected", () => {
  const { rows } = projectLiveBeginnerRows({
    lessons: [
      lesson({
        children: [
          child({
            childNotes: "רגישה לרעש",
            horseName: "לונה",
            equipmentNotes: "אוכף קטן",
            isAbsent: true,
            age: 9,
            gender: "F",
          }),
        ],
      }),
    ],
    viewerTraineeId: null,
  });

  const projected = rows[0].detail.children[0];
  assert.equal(projected.childNotes, "רגישה לרעש");
  assert.equal(projected.horseName, "לונה");
  assert.equal(projected.equipmentNotes, "אוכף קטן");
  assert.equal(projected.isAbsent, true);
  assert.equal(projected.age, 9);
  assert.equal(projected.gender, "F");
});

test("lesson notes, location, instructor, group and publication are projected", () => {
  const { rows } = projectLiveBeginnerRows({
    lessons: [lesson()],
    viewerTraineeId: null,
  });
  const detail = rows[0].detail;

  assert.equal(detail.notes, "הערת שיעור");
  assert.equal(detail.location, "מקורה");
  assert.equal(detail.groupName, "א");
  assert.equal(detail.responsibleInstructorId, "inst-1");
  assert.equal(detail.responsibleInstructorName, "ליאור רז חת");
  assert.equal(detail.isPublished, true);
  assert.equal(detail.practiceType, "LUNGE");
  assert.equal(detail.beginnerFormat, "LUNGE");
  assert.equal(detail.startTime, "16:00");
  assert.equal(detail.endTime, "16:30");
});

test("roleLabelOverrides are projected, own keys only", () => {
  const { rows } = projectLiveBeginnerRows({
    lessons: [
      lesson({ roleLabelOverrides: { LEAD_INSTRUCTOR: "מדריך 1", EVALUATOR: "מעריך" } }),
      lesson({ lessonId: "none", startTime: "17:00", roleLabelOverrides: null }),
    ],
    viewerTraineeId: null,
  });

  assert.deepEqual(rows[0].detail.roleLabelOverrides, {
    LEAD_INSTRUCTOR: "מדריך 1",
    EVALUATOR: "מעריך",
  });
  assert.equal(Object.isFrozen(rows[0].detail.roleLabelOverrides), true);
  assert.equal(rows[1].detail.roleLabelOverrides, null);
});

test("the session row is shaped exactly like a stored ExamSession projection", () => {
  const { rows } = projectLiveBeginnerRows({
    lessons: [lesson()],
    viewerTraineeId: null,
  });
  assert.deepEqual(Object.keys(rows[0].session).sort(), [
    "beginnerChildCount",
    "beginnerFormat",
    "date",
    "endTime",
    "examineeStudentIds",
    "instructedTraineeStudentIds",
    "kind",
    "orderIndex",
    "sessionId",
    "startTime",
  ]);
  assert.equal(rows[0].session.kind, "BEGINNER_INSTRUCTION");
});

// ---------------------------------------------------------------------------
// Feedback / grades must not exist
// ---------------------------------------------------------------------------

test("no projected object carries a feedback, rating or grade key", () => {
  const { rows } = projectLiveBeginnerRows({
    lessons: [lesson()],
    viewerTraineeId: "student-1",
  });

  const forbidden = ["feedback", "rating", "ratinghalfpoints", "grade", "score", "canviewfeedback"];
  const seen: string[] = [];
  const walk = (value: unknown): void => {
    if (value === null || typeof value !== "object") return;
    for (const key of Object.keys(value as Record<string, unknown>)) {
      seen.push(key);
      walk((value as Record<string, unknown>)[key]);
    }
  };
  walk(rows);

  assert.ok(seen.length > 0, "sanity: the walk visited keys");
  for (const key of seen) {
    assert.equal(
      forbidden.includes(key.toLowerCase()),
      false,
      `forbidden key present in projection: ${key}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Purity
// ---------------------------------------------------------------------------

test("inputs are never mutated", () => {
  const participants = [
    participant({ participantId: "p2", traineeId: "s2", createdAt: "2026-07-02T00:00:00.000Z" }),
    participant({ participantId: "p1", traineeId: "s1", createdAt: "2026-07-01T00:00:00.000Z" }),
  ];
  const children = [
    child({ childAssignmentId: "ca2", fullName: "ב" }),
    child({ childAssignmentId: "ca1", fullName: "א" }),
  ];
  const overrides = { LEAD_INSTRUCTOR: "מדריך 1" };
  const lessons = [
    lesson({ lessonId: "z", startTime: "18:00", participants, children, roleLabelOverrides: overrides }),
    lesson({ lessonId: "a", startTime: "16:00" }),
  ];
  const snapshot = JSON.parse(JSON.stringify(lessons));

  projectLiveBeginnerRows({ lessons, viewerTraineeId: "s1" });

  assert.deepEqual(JSON.parse(JSON.stringify(lessons)), snapshot);
  assert.deepEqual(lessons.map((l) => l.lessonId), ["z", "a"], "input array not re-sorted");
  assert.deepEqual(participants.map((p) => p.participantId), ["p2", "p1"]);
  assert.deepEqual(children.map((c) => c.childAssignmentId), ["ca2", "ca1"]);
  assert.equal(Object.isFrozen(overrides), false, "the caller's object is not frozen in place");
});

test("outputs are frozen at every level", () => {
  const projection = projectLiveBeginnerRows({
    lessons: [lesson({ practiceType: "NOPE", lessonId: "bad" }), lesson()],
    viewerTraineeId: "student-1",
  });

  assert.equal(Object.isFrozen(projection), true);
  assert.equal(Object.isFrozen(projection.rows), true);
  assert.equal(Object.isFrozen(projection.rejected), true);
  assert.equal(Object.isFrozen(projection.rejected[0]), true);

  const row = projection.rows[0];
  assert.equal(Object.isFrozen(row), true);
  assert.equal(Object.isFrozen(row.session), true);
  assert.equal(Object.isFrozen(row.session.examineeStudentIds), true);
  assert.equal(Object.isFrozen(row.session.instructedTraineeStudentIds), true);
  assert.equal(Object.isFrozen(row.detail), true);
  assert.equal(Object.isFrozen(row.detail.participants), true);
  assert.equal(Object.isFrozen(row.detail.participants[0]), true);
  assert.equal(Object.isFrozen(row.detail.children), true);
  assert.equal(Object.isFrozen(row.detail.children[0]), true);
});

test("an empty input yields empty, frozen results", () => {
  const projection = projectLiveBeginnerRows({ lessons: [], viewerTraineeId: null });
  assert.deepEqual(projection.rows, []);
  assert.deepEqual(projection.rejected, []);
  assert.equal(Object.isFrozen(projection.rows), true);
});
