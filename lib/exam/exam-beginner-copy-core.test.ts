/**
 * EXAM EX-C1 — executable tests for the PURE beginner-exam copy planner
 * (exam-beginner-copy-core.ts).
 *
 * Run with: npx tsx --test lib/exam/exam-beginner-copy-core.test.ts
 * PURE: no Prisma, no DB, no clock, no randomness, no auth, no cookie, no env,
 * no Teaching-Practice IO.
 *
 * SCOPE OF PROOF: every copied participant becomes an EXAMINEE (EVALUATOR
 * included) while its original role is preserved as a string; children, horses,
 * equipment, absence, notes and parent/contact details are snapshotted; the
 * responsible instructor becomes a planned supervisor; role-label overrides
 * survive verbatim; ordering is deterministic and input-order independent;
 * already-copied lessons are skipped (idempotency); the date is authoritative
 * and never inferred; and the planner never mutates its inputs.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  planBeginnerExamCopy,
  mapPracticeTypeToBeginnerFormat,
  type BeginnerCopyPlanInput,
  type TeachingPracticeLessonSource,
} from "./exam-beginner-copy-core";

const DATE = "2026-08-02";

function lesson(
  over: Partial<TeachingPracticeLessonSource> = {},
): TeachingPracticeLessonSource {
  return {
    lessonId: "L1",
    practiceType: "BEGINNER_GROUP",
    date: DATE,
    startTime: "16:30",
    endTime: "17:30",
    location: "מקורה",
    notes: null,
    responsibleInstructorId: "INS-1",
    roleLabelOverrides: null,
    participants: [],
    childAssignments: [],
    ...over,
  };
}

function input(over: Partial<BeginnerCopyPlanInput> = {}): BeginnerCopyPlanInput {
  return { planId: "PLAN-1", date: DATE, lessons: [lesson()], ...over };
}

// --- practice type mapping --------------------------------------------------

test("practice types map exhaustively; unknown tokens fail closed to null", () => {
  assert.equal(mapPracticeTypeToBeginnerFormat("LUNGE"), "LUNGE");
  assert.equal(mapPracticeTypeToBeginnerFormat("BEGINNER_PRIVATE"), "BEGINNER_PRIVATE");
  assert.equal(mapPracticeTypeToBeginnerFormat("BEGINNER_GROUP"), "BEGINNER_GROUP");
  for (const bad of ["", "lunge", "THEORY", "__proto__", "toString", null, 3, {}]) {
    assert.equal(mapPracticeTypeToBeginnerFormat(bad), null, String(bad));
  }
});

// --- the locked role rule ---------------------------------------------------

test("EVERY copied participant becomes EXAMINEE, EVALUATOR included", () => {
  const plan = planBeginnerExamCopy(
    input({
      lessons: [
        lesson({
          participants: [
            { participantId: "P1", traineeId: "T1", role: "LEAD_INSTRUCTOR" },
            { participantId: "P2", traineeId: "T2", role: "SECOND_INSTRUCTOR" },
            { participantId: "P3", traineeId: "T3", role: "EVALUATOR" },
          ],
        }),
      ],
    }),
  );
  const assignments = plan.create[0].assignments;
  assert.equal(assignments.length, 3);
  for (const a of assignments) assert.equal(a.role, "EXAMINEE");
  // The EVALUATOR is present, not excluded, and keeps its original role token.
  const evaluator = assignments.find((a) => a.studentId === "T3");
  assert.ok(evaluator, "the EVALUATOR participant must be copied as an examinee");
  assert.equal(evaluator.sourcePracticeRole, "EVALUATOR");
});

test("sourcePracticeRole is an opaque string snapshot, not a validated enum", () => {
  // A future Teaching-Practice role token the exam module has never heard of
  // must still round-trip verbatim - that is the point of the string snapshot.
  const plan = planBeginnerExamCopy(
    input({
      lessons: [
        lesson({
          participants: [{ participantId: "P1", traineeId: "T1", role: "מדריך 3" }],
        }),
      ],
    }),
  );
  assert.equal(plan.create[0].assignments[0].sourcePracticeRole, "מדריך 3");
  assert.equal(plan.create[0].assignments[0].role, "EXAMINEE");
});

// --- the snapshot -----------------------------------------------------------

test("children, horses, equipment, absence and parent contact are snapshotted", () => {
  const plan = planBeginnerExamCopy(
    input({
      lessons: [
        lesson({
          childAssignments: [
            {
              childAssignmentId: "CA1",
              childId: "C1",
              fullName: "ילד א",
              age: 9,
              gender: "F",
              childNotes: "הערה",
              parentName: "הורה א",
              parentPhone: "050-0000000",
              horseName: "סוסה",
              equipmentNotes: "אוכף קטן",
              isAbsent: true,
            },
          ],
        }),
      ],
    }),
  );
  const child = plan.create[0].beginnerChildren[0];
  assert.equal(child.fullName, "ילד א");
  assert.equal(child.age, 9);
  assert.equal(child.gender, "F");
  assert.equal(child.notes, "הערה");
  assert.equal(child.parentName, "הורה א");
  assert.equal(child.parentPhone, "050-0000000");
  assert.equal(child.horseName, "סוסה");
  assert.equal(child.equipmentNotes, "אוכף קטן");
  assert.equal(child.isAbsent, true);
  assert.equal(child.sourceChildId, "C1");
  assert.equal(child.sourceChildAssignmentId, "CA1");
});

test("format, times, arena, notes, provenance and overrides are copied", () => {
  const overrides = { LEAD_INSTRUCTOR: "מדריך 1" };
  const plan = planBeginnerExamCopy(
    input({
      lessons: [
        lesson({
          practiceType: "LUNGE",
          startTime: "16:00",
          endTime: "16:30",
          location: "מקורה",
          notes: "הערת שיעור",
          roleLabelOverrides: overrides,
        }),
      ],
    }),
  );
  const s = plan.create[0];
  assert.equal(s.kind, "BEGINNER_INSTRUCTION");
  assert.equal(s.beginnerFormat, "LUNGE");
  assert.equal(s.date, DATE);
  assert.equal(s.startTime, "16:00");
  assert.equal(s.endTime, "16:30");
  assert.equal(s.arena, "מקורה"); // the single place field
  assert.equal(s.notes, "הערת שיעור");
  assert.deepEqual(s.roleLabelOverrides, overrides);
  assert.equal(s.sourceTeachingPracticeLessonId, "L1");
});

test("per-lesson roleLabelOverrides stay bound to their own source lesson", () => {
  // Production carries roleLabelOverrides on 24 of the 35 approved source
  // lessons, so several DIFFERENT override objects travel through one plan.
  // Each planned session must keep its OWN lesson's value verbatim: never
  // merged, never shared, never overwritten by a sibling, and never re-bound to
  // the wrong sourceTeachingPracticeLessonId by the deterministic sort.
  const overridesB = { LEAD_INSTRUCTOR: "מדריך 1", SECOND_INSTRUCTOR: "מדריך 2" };
  const overridesC = { EVALUATOR: "מדריך 3" };

  // Input order is deliberately NOT the output order: L-c sorts first by time,
  // and L-a/L-b share a start time so the lesson id decides.
  const lessons = [
    lesson({ lessonId: "L-b", startTime: "17:30", endTime: "18:30", roleLabelOverrides: overridesB }),
    lesson({ lessonId: "L-c", startTime: "16:00", endTime: "16:30", roleLabelOverrides: overridesC }),
    lesson({ lessonId: "L-a", startTime: "17:30", endTime: "18:30", roleLabelOverrides: null }),
  ];
  const plan = planBeginnerExamCopy(input({ lessons }));

  const bySource = new Map(
    plan.create.map((s) => [s.sourceTeachingPracticeLessonId, s.roleLabelOverrides]),
  );
  assert.equal(plan.create.length, 3);

  // Verbatim, per source lesson.
  assert.equal(bySource.get("L-a"), null);
  assert.deepEqual(bySource.get("L-b"), overridesB);
  assert.deepEqual(bySource.get("L-c"), overridesC);

  // NOT merged: neither object gained the other's keys, and neither gained the
  // union of both.
  assert.deepEqual(Object.keys(bySource.get("L-b") as object).sort(), [
    "LEAD_INSTRUCTOR",
    "SECOND_INSTRUCTOR",
  ]);
  assert.deepEqual(Object.keys(bySource.get("L-c") as object), ["EVALUATOR"]);
  assert.equal("EVALUATOR" in (bySource.get("L-b") as object), false);
  assert.equal("LEAD_INSTRUCTOR" in (bySource.get("L-c") as object), false);

  // NOT shared: the two non-null values are distinct objects, so one session's
  // overrides cannot overwrite another's.
  assert.notEqual(bySource.get("L-b"), bySource.get("L-c"));
  (bySource.get("L-b") as Record<string, string>).LEAD_INSTRUCTOR = "מוטציה";
  assert.deepEqual(bySource.get("L-c"), { EVALUATOR: "מדריך 3" });
  assert.equal(bySource.get("L-a"), null);
  // Restore so the fixture object is not left mutated for later assertions.
  overridesB.LEAD_INSTRUCTOR = "מדריך 1";

  // The deterministic sort reorders the sessions but must NOT re-bind the
  // overrides: L-c (16:00) first, then L-a and L-b (both 17:30, id tiebreak).
  assert.deepEqual(
    plan.create.map((s) => s.sourceTeachingPracticeLessonId),
    ["L-c", "L-a", "L-b"],
  );
  assert.deepEqual(
    plan.create.map((s) => s.roleLabelOverrides),
    [overridesC, null, overridesB],
  );

  // Feeding the same lessons in a different order yields the same pairing.
  const shuffled = planBeginnerExamCopy(
    input({ lessons: [lessons[2], lessons[0], lessons[1]] }),
  );
  assert.deepEqual(
    shuffled.create.map((s) => [s.sourceTeachingPracticeLessonId, s.roleLabelOverrides]),
    plan.create.map((s) => [s.sourceTeachingPracticeLessonId, s.roleLabelOverrides]),
  );
});

test("the responsible instructor becomes a planned supervisor; absent stays empty", () => {
  const withInstructor = planBeginnerExamCopy(input());
  assert.deepEqual(withInstructor.create[0].supervisorInstructorIds, ["INS-1"]);

  const without = planBeginnerExamCopy(
    input({ lessons: [lesson({ responsibleInstructorId: null })] }),
  );
  assert.deepEqual(without.create[0].supervisorInstructorIds, []);
});

// --- determinism ------------------------------------------------------------

test("session ordering is deterministic and input-order independent", () => {
  const a = lesson({ lessonId: "L-b", startTime: "16:00", endTime: "16:30" });
  const b = lesson({ lessonId: "L-a", startTime: "16:00", endTime: "16:30" });
  const c = lesson({ lessonId: "L-c", startTime: "17:30", endTime: "18:30" });

  const forward = planBeginnerExamCopy(input({ lessons: [a, b, c] }));
  const reverse = planBeginnerExamCopy(input({ lessons: [c, b, a] }));

  const ids = forward.create.map((s) => s.sourceTeachingPracticeLessonId);
  // Same start/end: the lesson id is the stable tiebreak.
  assert.deepEqual(ids, ["L-a", "L-b", "L-c"]);
  assert.deepEqual(reverse.create.map((s) => s.sourceTeachingPracticeLessonId), ids);
  assert.deepEqual(forward.create.map((s) => s.orderIndex), [0, 1, 2]);
});

test("assignment and child ordering is deterministic", () => {
  const plan = planBeginnerExamCopy(
    input({
      lessons: [
        lesson({
          participants: [
            { participantId: "P9", traineeId: "T9", role: "EVALUATOR" },
            { participantId: "P1", traineeId: "T1", role: "LEAD_INSTRUCTOR" },
          ],
          childAssignments: [
            {
              childAssignmentId: "CA2",
              childId: "C2",
              fullName: "בבב",
              age: null,
              gender: null,
              childNotes: null,
              parentName: null,
              parentPhone: null,
              horseName: null,
              equipmentNotes: null,
              isAbsent: false,
            },
            {
              childAssignmentId: "CA1",
              childId: "C1",
              fullName: "ааа",
              age: null,
              gender: null,
              childNotes: null,
              parentName: null,
              parentPhone: null,
              horseName: null,
              equipmentNotes: null,
              isAbsent: false,
            },
          ],
        }),
      ],
    }),
  );
  assert.deepEqual(plan.create[0].assignments.map((a) => a.studentId), ["T1", "T9"]);
  assert.deepEqual(plan.create[0].beginnerChildren.map((c) => c.orderIndex), [0, 1]);
});

// --- idempotency ------------------------------------------------------------

test("already-copied source lessons are skipped, never duplicated", () => {
  const lessons = [lesson({ lessonId: "L1" }), lesson({ lessonId: "L2", startTime: "17:30", endTime: "18:30" })];
  const plan = planBeginnerExamCopy(
    input({ lessons, alreadyCopiedSourceLessonIds: ["L1"] }),
  );
  assert.deepEqual(plan.skippedAlreadyCopied, ["L1"]);
  assert.deepEqual(plan.create.map((s) => s.sourceTeachingPracticeLessonId), ["L2"]);
});

test("re-planning after everything is copied creates nothing", () => {
  const lessons = [lesson({ lessonId: "L1" })];
  const plan = planBeginnerExamCopy(
    input({ lessons, alreadyCopiedSourceLessonIds: ["L1"] }),
  );
  assert.equal(plan.create.length, 0);
  assert.equal(plan.totals.sessions, 0);
  assert.deepEqual(plan.skippedAlreadyCopied, ["L1"]);
});

// --- the date is authoritative ---------------------------------------------

test("a lesson on another date is REJECTED, never silently copied", () => {
  const plan = planBeginnerExamCopy(
    input({ lessons: [lesson({ lessonId: "L1", date: "2026-08-03" })] }),
  );
  assert.equal(plan.create.length, 0);
  assert.deepEqual(plan.rejected, [
    { sourceTeachingPracticeLessonId: "L1", reason: "DATE_MISMATCH" },
  ]);
});

test("unknown practice types and invalid intervals are rejected, not guessed", () => {
  const plan = planBeginnerExamCopy(
    input({
      lessons: [
        lesson({ lessonId: "L1", practiceType: "SOMETHING_NEW" }),
        lesson({ lessonId: "L2", startTime: "18:00", endTime: "18:00" }),
        lesson({ lessonId: "L3", startTime: "25:00", endTime: "26:00" }),
      ],
    }),
  );
  assert.equal(plan.create.length, 0);
  assert.deepEqual(plan.rejected, [
    { sourceTeachingPracticeLessonId: "L1", reason: "UNKNOWN_PRACTICE_TYPE" },
    { sourceTeachingPracticeLessonId: "L2", reason: "INVALID_TIME_INTERVAL" },
    { sourceTeachingPracticeLessonId: "L3", reason: "INVALID_TIME_INTERVAL" },
  ]);
});

// --- totals + purity --------------------------------------------------------

test("totals count distinct trainees and supervisors, not row sums", () => {
  const shared = { participantId: "P1", traineeId: "T1", role: "LEAD_INSTRUCTOR" };
  const plan = planBeginnerExamCopy(
    input({
      lessons: [
        lesson({ lessonId: "L1", startTime: "16:00", endTime: "16:30", participants: [shared] }),
        // The SAME trainee and instructor appear again in a later session.
        lesson({ lessonId: "L2", startTime: "17:30", endTime: "18:00", participants: [shared] }),
      ],
    }),
  );
  assert.equal(plan.totals.sessions, 2);
  assert.equal(plan.totals.assignments, 2);
  assert.equal(plan.totals.distinctTrainees, 1);
  assert.equal(plan.totals.supervisors, 1);
});

test("planBeginnerExamCopy does not mutate its inputs", () => {
  const source = input({
    lessons: [
      lesson({
        participants: [{ participantId: "P1", traineeId: "T1", role: "EVALUATOR" }],
        childAssignments: [
          {
            childAssignmentId: "CA1",
            childId: "C1",
            fullName: "ילד",
            age: 8,
            gender: null,
            childNotes: null,
            parentName: "הורה",
            parentPhone: "050",
            horseName: "סוס",
            equipmentNotes: "ציוד",
            isAbsent: false,
          },
        ],
      }),
    ],
  });
  const snapshot = JSON.parse(JSON.stringify(source));
  planBeginnerExamCopy(source);
  assert.deepEqual(JSON.parse(JSON.stringify(source)), snapshot);
});

test("the plan is plain data only - it can never write back to Teaching Practice", () => {
  const plan = planBeginnerExamCopy(
    input({
      lessons: [
        lesson({ participants: [{ participantId: "P1", traineeId: "T1", role: "EVALUATOR" }] }),
      ],
    }),
  );
  // A structurally serializable value carries no functions/handles/connections.
  assert.deepEqual(JSON.parse(JSON.stringify(plan)).planId, "PLAN-1");
  assert.equal(typeof plan, "object");
  assert.ok(Object.isFrozen(plan));
});
