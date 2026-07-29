/**
 * EXAM EX-S5A-1 — executable tests for the PURE stored-block adapter core
 * (exam-stored-adapter-core.ts).
 *
 * Run with: npx tsx --test lib/exam/exam-stored-adapter-core.test.ts
 * PURE: no Prisma, no DB, no clock, no randomness, no auth, no cookie, no env.
 *
 * SCOPE OF PROOF: that `ExamDefinition` is the ONLY source of kind, duration and
 * parallel capacity; that a session whose definition is missing, duplicated or
 * not storable is EXCLUDED with an observable issue rather than guessed at; that
 * every derived time comes from the committed timetable cores and nothing is
 * ever fabricated or fallen back to; that the personal-slot detail matches the
 * contract `exam-trainee-view-core` consumes; that the conflict input cannot
 * drift from the projection row; that `ProjectionSession` is NOT widened; and
 * that the output is frozen, deterministic and free of PII in its diagnostics.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildStoredExamBlockDetailLookup,
  composeStoredExamBlocks,
  STORED_EXAM_ADAPTER_MESSAGES,
  type StoredExamAdapterIssue,
  type StoredExamAdapterIssueCode,
  type StoredExamAssignmentRow,
  type StoredExamBreakRow,
  type StoredExamDefinitionRow,
  type StoredExamSessionRow,
} from "./exam-stored-adapter-core";
import { projectGeneralSchedule } from "./exam-schedule-projection-core";
import { projectTraineeExamDay } from "./exam-trainee-view-core";
import { projectByExamDefinition } from "./exam-group-projection-core";

const CORE_PATH = join(import.meta.dirname, "exam-stored-adapter-core.ts");
const CORE_SOURCE = readFileSync(CORE_PATH, "utf8");

/**
 * The core's source with its comments removed. The structural guards must assert
 * on CODE, not on the prose documenting the very rules they enforce — the file
 * legitimately explains why the deprecated columns are excluded, and a naive
 * text scan would fire on every explanation.
 */
const CORE_CODE = CORE_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const PROJECTION_SOURCE = readFileSync(
  join(import.meta.dirname, "exam-schedule-projection-core.ts"),
  "utf8",
);

// ===========================================================================
// Fixtures
// ===========================================================================

function def(over: Partial<StoredExamDefinitionRow> = {}): StoredExamDefinitionRow {
  return {
    id: "def-riding",
    name: "רכיבה",
    kind: "INTERFACE_RIDING",
    durationMinutes: 20,
    parallelCapacity: 2,
    requiresInstructedTrainee: false,
    requiresLessonTopic: false,
    requiresDiscipline: false,
    orderIndex: 0,
    ...over,
  };
}

function assignment(
  over: Partial<StoredExamAssignmentRow> = {},
): StoredExamAssignmentRow {
  return {
    id: "A1",
    studentId: "stu-1",
    role: "EXAMINEE",
    orderIndex: 0,
    horseName: "סוסה",
    instructionTopic: null,
    discipline: null,
    pairingIndex: null,
    notes: null,
    ...over,
  };
}

function brk(over: Partial<StoredExamBreakRow> = {}): StoredExamBreakRow {
  return { id: "B1", afterWaveIndex: 0, durationMinutes: 15, label: null, ...over };
}

function sessionRow(over: Partial<StoredExamSessionRow> = {}): StoredExamSessionRow {
  return {
    id: "X1",
    definitionId: "def-riding",
    date: "2026-08-02",
    startTime: "09:00",
    endTime: "10:00",
    orderIndex: 0,
    arena: "מגרש 1",
    title: "מחזור א",
    notes: "הערה תפעולית",
    individualPublishedAt: null,
    updatedAt: 1000,
    assignments: [],
    breaks: [],
    supervisorInstructorIds: [],
    ...over,
  };
}

/** Three examinees in explicit wave order. */
function threeExaminees(): StoredExamAssignmentRow[] {
  return [
    assignment({ id: "A1", studentId: "stu-1", orderIndex: 0 }),
    assignment({ id: "A2", studentId: "stu-2", orderIndex: 1 }),
    assignment({ id: "A3", studentId: "stu-3", orderIndex: 2 }),
  ];
}

function codes(issues: readonly StoredExamAdapterIssue[]): StoredExamAdapterIssueCode[] {
  return issues.map((i) => i.code);
}

/** A deterministic, randomness-free permutation. */
function rotate<T>(items: readonly T[], by: number): T[] {
  const out = [...items];
  const shift = ((by % out.length) + out.length) % out.length;
  return [...out.slice(shift), ...out.slice(0, shift)];
}

// ===========================================================================
// 1. The happy path
// ===========================================================================

test("a valid stored block yields an OK projection, detail and conflict input", () => {
  const result = composeStoredExamBlocks(
    [sessionRow({ assignments: threeExaminees(), supervisorInstructorIds: ["ins-1"] })],
    [def()],
  );

  assert.equal(result.issues.length, 0, "no top-level issues");
  assert.equal(result.blocks.length, 1);

  const block = result.blocks[0];
  assert.deepEqual(block.session, {
    sessionId: "X1",
    kind: "INTERFACE_RIDING",
    beginnerFormat: null,
    date: "2026-08-02",
    startTime: "09:00",
    endTime: "10:00",
    orderIndex: 0,
    examineeStudentIds: ["stu-1", "stu-2", "stu-3"],
    instructedTraineeStudentIds: [],
    beginnerChildCount: 0,
    definitionId: "def-riding",
    definitionName: "רכיבה",
    // capacity 2, duration 20 ⇒ wave 0 = 09:00-09:20, wave 1 = 09:20-09:40.
    derivedBlockEndTime: "09:40",
    timetableStatus: "OK",
  });

  assert.notEqual(block.detail, null);
  assert.equal(block.detail?.source, "STORED");
  assert.equal(block.detail?.sessionId, "X1");
  assert.deepEqual(block.detail?.slots, [
    {
      assignmentId: "A1",
      studentId: "stu-1",
      role: "EXAMINEE",
      startTime: "09:00",
      endTime: "09:20",
    },
    {
      assignmentId: "A2",
      studentId: "stu-2",
      role: "EXAMINEE",
      startTime: "09:00",
      endTime: "09:20",
    },
    {
      assignmentId: "A3",
      studentId: "stu-3",
      role: "EXAMINEE",
      startTime: "09:20",
      endTime: "09:40",
    },
  ]);

  const conflict = block.conflictSession;
  assert.equal(conflict.sessionId, "X1");
  assert.equal(conflict.source, "STORED");
  assert.equal(conflict.definitionId, "def-riding");
  assert.equal(conflict.timetableStatus, "OK");
  assert.deepEqual(conflict.interval, {
    date: "2026-08-02",
    start: "09:00",
    end: "09:40",
  });
  assert.deepEqual(conflict.supervisorIds, ["ins-1"]);
  assert.equal(conflict.arenaId, "מגרש 1");
  assert.equal(conflict.examinerSetId, null);
  assert.equal(conflict.capacity, null, "legacy capacity is never used with a definition");
  assert.deepEqual(conflict.horseIds, [], "legacy session-level horses stay empty");
  assert.equal(conflict.responsibleInstructorId, null);
  assert.equal(conflict.assignments.length, 3);
  assert.deepEqual(conflict.assignments[0], {
    role: "EXAMINEE",
    participant: { kind: "INTERNAL", studentId: "stu-1" },
    assignmentId: "A1",
    horse: "סוסה",
    pairingIndex: null,
  });
  assert.deepEqual(conflict.slots, [
    { assignmentId: "A1", startTime: "09:00", endTime: "09:20" },
    { assignmentId: "A2", startTime: "09:00", endTime: "09:20" },
    { assignmentId: "A3", startTime: "09:20", endTime: "09:40" },
  ]);
});

// ===========================================================================
// 2-4. Definition is the only identity and the only behavioural source
// ===========================================================================

test("kind comes from the ExamDefinition", () => {
  const result = composeStoredExamBlocks(
    [sessionRow({ assignments: threeExaminees() })],
    [def({ kind: "ADVANCED_INSTRUCTION" })],
  );
  assert.equal(result.blocks[0].session.kind, "ADVANCED_INSTRUCTION");
  // The deprecated ExamSession.kind is not even representable in the input.
  assert.equal(
    Object.prototype.hasOwnProperty.call(sessionRow(), "kind"),
    false,
    "the session row contract carries no kind column",
  );
});

test("durationMinutes and parallelCapacity come only from the ExamDefinition", () => {
  const rows = [sessionRow({ assignments: threeExaminees() })];

  const short = composeStoredExamBlocks(rows, [
    def({ durationMinutes: 20, parallelCapacity: 3 }),
  ]);
  // capacity 3 ⇒ one wave of 20 minutes.
  assert.equal(short.blocks[0].session.derivedBlockEndTime, "09:20");

  const long = composeStoredExamBlocks(rows, [
    def({ durationMinutes: 30, parallelCapacity: 1 }),
  ]);
  // capacity 1 ⇒ three waves of 30 minutes.
  assert.equal(long.blocks[0].session.derivedBlockEndTime, "10:30");
  assert.deepEqual(
    long.blocks[0].detail?.slots.map((s) => [s.assignmentId, s.startTime, s.endTime]),
    [
      ["A1", "09:00", "09:30"],
      ["A2", "09:30", "10:00"],
      ["A3", "10:00", "10:30"],
    ],
  );
});

test("two definitions sharing a kind retain distinct definition ids and names", () => {
  const result = composeStoredExamBlocks(
    [
      sessionRow({ id: "X1", definitionId: "def-riding", assignments: [assignment()] }),
      sessionRow({
        id: "X2",
        definitionId: "def-interface",
        startTime: "11:00",
        assignments: [assignment({ id: "A9", studentId: "stu-9" })],
      }),
    ],
    [
      def({ id: "def-riding", name: "רכיבה", kind: "INTERFACE_RIDING" }),
      def({ id: "def-interface", name: "ממשק", kind: "INTERFACE_RIDING" }),
    ],
  );

  assert.equal(result.issues.length, 0);
  assert.deepEqual(
    result.blocks.map((b) => [b.session.definitionId, b.session.definitionName]),
    [
      ["def-riding", "רכיבה"],
      ["def-interface", "ממשק"],
    ],
  );

  // And they stay two exams downstream, despite the shared kind.
  const grouped = projectByExamDefinition(result.blocks.map((b) => b.session));
  assert.equal(grouped.issues.length, 0);
  assert.deepEqual(
    grouped.groups.map((g) => g.label).sort(),
    ["ממשק", "רכיבה"],
  );
});

// ===========================================================================
// 5-6. Definition resolution failures
// ===========================================================================

test("a missing definition produces no block and a stable issue", () => {
  const result = composeStoredExamBlocks(
    [sessionRow({ definitionId: "def-gone", assignments: threeExaminees() })],
    [def()],
  );

  assert.deepEqual(result.blocks, []);
  assert.equal(result.issues.length, 1);
  assert.deepEqual(result.issues[0], {
    code: "EX-ADP-DEFINITION-MISSING",
    message: STORED_EXAM_ADAPTER_MESSAGES["EX-ADP-DEFINITION-MISSING"],
    sessionId: "X1",
    definitionId: "def-gone",
    assignmentId: null,
  });
});

test("a duplicate definition id excludes the affected session and never picks one", () => {
  const result = composeStoredExamBlocks(
    [
      sessionRow({ id: "X1", definitionId: "dupe", assignments: threeExaminees() }),
      sessionRow({
        id: "X2",
        definitionId: "def-ok",
        startTime: "11:00",
        assignments: [assignment({ id: "A9", studentId: "stu-9" })],
      }),
    ],
    [
      def({ id: "dupe", name: "ראשון", durationMinutes: 10 }),
      def({ id: "dupe", name: "שני", durationMinutes: 90 }),
      def({ id: "def-ok", name: "תקין" }),
    ],
  );

  // The unaffected session still projects; the ambiguous one does not.
  assert.deepEqual(
    result.blocks.map((b) => b.session.sessionId),
    ["X2"],
  );
  // One plan-level issue for the duplicated id, one for the excluded session.
  assert.deepEqual(codes(result.issues), [
    "EX-ADP-DEFINITION-DUPLICATE",
    "EX-ADP-DEFINITION-DUPLICATE",
  ]);
  assert.deepEqual(
    result.issues.map((i) => i.sessionId),
    [null, "X1"],
  );
  // Neither competing definition was applied: no block carries either name.
  const names = result.blocks.map((b) => b.session.definitionName);
  assert.equal(names.includes("ראשון"), false);
  assert.equal(names.includes("שני"), false);
});

test("a definition whose kind is not storable excludes the session", () => {
  const result = composeStoredExamBlocks(
    [sessionRow({ assignments: threeExaminees() })],
    [def({ kind: "BEGINNER_INSTRUCTION" })],
  );
  assert.deepEqual(result.blocks, []);
  assert.deepEqual(codes(result.issues), ["EX-ADP-DEFINITION-KIND-NOT-STORABLE"]);

  const bogus = composeStoredExamBlocks(
    [sessionRow({ assignments: threeExaminees() })],
    [def({ kind: "NOT_A_KIND" })],
  );
  assert.deepEqual(bogus.blocks, []);
  assert.deepEqual(codes(bogus.issues), ["EX-ADP-DEFINITION-KIND-NOT-STORABLE"]);
});

test("a session with no legible id is excluded with an issue, never dropped silently", () => {
  const result = composeStoredExamBlocks(
    [sessionRow({ id: "   ", assignments: threeExaminees() })],
    [def()],
  );
  assert.deepEqual(result.blocks, []);
  assert.deepEqual(codes(result.issues), ["EX-ADP-SESSION-ID-REQUIRED"]);
});

// ===========================================================================
// 7. Roles
// ===========================================================================

test("an unknown assignment role is excluded and reported, never coerced", () => {
  const result = composeStoredExamBlocks(
    [
      sessionRow({
        assignments: [
          assignment({ id: "A1", studentId: "stu-1", orderIndex: 0 }),
          assignment({ id: "A2", studentId: "stu-bad", role: "DEMO_RIDER", orderIndex: 1 }),
          assignment({ id: "A3", studentId: "stu-proto", role: "toString", orderIndex: 2 }),
        ],
      }),
    ],
    [def({ parallelCapacity: 1 })],
  );

  const block = result.blocks[0];
  assert.deepEqual(block.session.examineeStudentIds, ["stu-1"]);
  assert.deepEqual(block.session.instructedTraineeStudentIds, []);
  // One lane only ⇒ the rejected rows never became examinees.
  assert.equal(block.session.derivedBlockEndTime, "09:20");
  assert.deepEqual(block.detail?.slots.map((s) => s.assignmentId), ["A1"]);
  assert.deepEqual(codes(block.adapterIssues), [
    "EX-ADP-ROLE-INVALID",
    "EX-ADP-ROLE-INVALID",
  ]);
  assert.deepEqual(
    block.adapterIssues.map((i) => i.assignmentId),
    ["A2", "A3"],
  );
  // Per-block diagnostics are not repeated at the top level.
  assert.deepEqual(result.issues, []);
});

test("an assignment with no legible id is reported and carries no personal slot", () => {
  const result = composeStoredExamBlocks(
    [
      sessionRow({
        assignments: [
          assignment({ id: "A1", studentId: "stu-1", orderIndex: 0, pairingIndex: 0 }),
          assignment({
            id: "  ",
            studentId: "stu-2",
            role: "INSTRUCTED_TRAINEE",
            orderIndex: 1,
            pairingIndex: 0,
          }),
        ],
      }),
    ],
    [def({ kind: "ADVANCED_INSTRUCTION" })],
  );

  const block = result.blocks[0];
  assert.deepEqual(codes(block.adapterIssues), ["EX-ADP-ASSIGNMENT-ID-REQUIRED"]);
  // The declaration stands...
  assert.deepEqual(block.session.instructedTraineeStudentIds, ["stu-2"]);
  // ...but no slot is fabricated for it.
  assert.deepEqual(block.detail?.slots.map((s) => s.assignmentId), ["A1"]);
});

// ===========================================================================
// 8-9. Ordering and breaks
// ===========================================================================

test("examinees follow the timetable core's (orderIndex, assignmentId) rule", () => {
  const result = composeStoredExamBlocks(
    [
      sessionRow({
        // Supplied in an order that contradicts both keys.
        assignments: [
          assignment({ id: "A3", studentId: "stu-3", orderIndex: 2 }),
          assignment({ id: "A1", studentId: "stu-1", orderIndex: 0 }),
          assignment({ id: "A2", studentId: "stu-2", orderIndex: 1 }),
        ],
      }),
    ],
    [def({ parallelCapacity: 1 })],
  );

  assert.deepEqual(
    result.blocks[0].detail?.slots.map((s) => [s.assignmentId, s.startTime]),
    [
      ["A1", "09:00"],
      ["A2", "09:20"],
      ["A3", "09:40"],
    ],
  );
});

test("a shared orderIndex is broken by assignmentId, deterministically", () => {
  const result = composeStoredExamBlocks(
    [
      sessionRow({
        assignments: [
          assignment({ id: "B", studentId: "stu-b", orderIndex: 5 }),
          assignment({ id: "A", studentId: "stu-a", orderIndex: 5 }),
        ],
      }),
    ],
    [def({ parallelCapacity: 1 })],
  );
  assert.deepEqual(
    result.blocks[0].detail?.slots.map((s) => [s.assignmentId, s.startTime]),
    [
      ["A", "09:00"],
      ["B", "09:20"],
    ],
  );
});

test("breaks are positional and shift every later personal time", () => {
  const withoutBreak = composeStoredExamBlocks(
    [sessionRow({ assignments: threeExaminees() })],
    [def({ parallelCapacity: 1 })],
  );
  const withBreak = composeStoredExamBlocks(
    [
      sessionRow({
        assignments: threeExaminees(),
        breaks: [brk({ id: "B1", afterWaveIndex: 0, durationMinutes: 15 })],
      }),
    ],
    [def({ parallelCapacity: 1 })],
  );

  assert.deepEqual(
    withoutBreak.blocks[0].detail?.slots.map((s) => s.startTime),
    ["09:00", "09:20", "09:40"],
  );
  assert.deepEqual(
    withBreak.blocks[0].detail?.slots.map((s) => s.startTime),
    ["09:00", "09:35", "09:55"],
  );
  assert.equal(withBreak.blocks[0].session.derivedBlockEndTime, "10:15");
});

// ===========================================================================
// 10-13. Instructed-trainee inheritance
// ===========================================================================

function advancedWithInstructed(
  instructedPairing: number | null,
  examineePairings: readonly [number | null, number | null],
): StoredExamSessionRow {
  return sessionRow({
    assignments: [
      assignment({
        id: "A1",
        studentId: "stu-1",
        orderIndex: 0,
        pairingIndex: examineePairings[0],
      }),
      assignment({
        id: "A2",
        studentId: "stu-2",
        orderIndex: 1,
        pairingIndex: examineePairings[1],
      }),
      assignment({
        id: "T1",
        studentId: "stu-t",
        role: "INSTRUCTED_TRAINEE",
        orderIndex: 2,
        horseName: null,
        pairingIndex: instructedPairing,
      }),
    ],
  });
}

test("an instructed trainee inherits the paired examinee's exact interval", () => {
  const result = composeStoredExamBlocks(
    [advancedWithInstructed(1, [0, 1])],
    [def({ kind: "ADVANCED_INSTRUCTION", parallelCapacity: 1 })],
  );

  const slots = result.blocks[0].detail?.slots ?? [];
  const examinee = slots.find((s) => s.assignmentId === "A2");
  const instructed = slots.find((s) => s.assignmentId === "T1");
  assert.deepEqual(
    [instructed?.startTime, instructed?.endTime],
    [examinee?.startTime, examinee?.endTime],
  );
  assert.deepEqual([instructed?.startTime, instructed?.endTime], ["09:20", "09:40"]);
  assert.equal(instructed?.role, "INSTRUCTED_TRAINEE");
  assert.equal(instructed?.studentId, "stu-t");
});

test("an instructed trainee consumes no lane", () => {
  const result = composeStoredExamBlocks(
    [advancedWithInstructed(1, [0, 1])],
    [def({ kind: "ADVANCED_INSTRUCTION", parallelCapacity: 1 })],
  );
  // Two examinees at capacity 1 ⇒ two waves of 20 minutes. A third lane would
  // have pushed the block end to 10:00.
  assert.equal(result.blocks[0].session.derivedBlockEndTime, "09:40");
  assert.deepEqual(result.blocks[0].session.examineeStudentIds, ["stu-1", "stu-2"]);
  assert.deepEqual(result.blocks[0].session.instructedTraineeStudentIds, ["stu-t"]);
});

test("an unmatched pairing creates no instructed slot", () => {
  const result = composeStoredExamBlocks(
    [advancedWithInstructed(9, [0, 1])],
    [def({ kind: "ADVANCED_INSTRUCTION", parallelCapacity: 1 })],
  );
  const block = result.blocks[0];
  assert.deepEqual(block.detail?.slots.map((s) => s.assignmentId), ["A1", "A2"]);
  // The declaration is preserved so the trainee view core can report it.
  assert.deepEqual(block.session.instructedTraineeStudentIds, ["stu-t"]);
});

test("an ambiguous pairing invents no instructed slot", () => {
  const result = composeStoredExamBlocks(
    [advancedWithInstructed(1, [1, 1])],
    [def({ kind: "ADVANCED_INSTRUCTION", parallelCapacity: 1 })],
  );
  const block = result.blocks[0];
  assert.deepEqual(block.detail?.slots.map((s) => s.assignmentId), ["A1", "A2"]);
  assert.deepEqual(block.session.instructedTraineeStudentIds, ["stu-t"]);
});

// ===========================================================================
// 14-15. Participant edge cases
// ===========================================================================

test("duplicate student ids survive as duplicate detail slots", () => {
  const result = composeStoredExamBlocks(
    [
      sessionRow({
        assignments: [
          assignment({ id: "A1", studentId: "stu-dup", orderIndex: 0 }),
          assignment({ id: "A2", studentId: "stu-dup", orderIndex: 1 }),
        ],
      }),
    ],
    [def({ parallelCapacity: 1 })],
  );

  const block = result.blocks[0];
  assert.deepEqual(block.session.examineeStudentIds, ["stu-dup", "stu-dup"]);
  assert.equal(
    block.detail?.slots.filter((s) => s.studentId === "stu-dup").length,
    2,
    "both slots are preserved so EX-TRN-DUPLICATE-STUDENT-SLOT can fire",
  );

  // Proof that the downstream core does exactly that.
  const trainee = projectTraineeExamDay(
    [block.session],
    buildStoredExamBlockDetailLookup(result.blocks),
    "2026-08-02",
    "stu-dup",
  );
  assert.deepEqual(
    trainee.issues.map((i) => i.code),
    ["EX-TRN-DUPLICATE-STUDENT-SLOT"],
  );
  assert.deepEqual(trainee.allRows, []);
});

test("a null-studentId examinee holds a lane but appears in no participant array", () => {
  const result = composeStoredExamBlocks(
    [
      sessionRow({
        assignments: [
          assignment({ id: "A1", studentId: null, orderIndex: 0 }),
          assignment({ id: "A2", studentId: "stu-2", orderIndex: 1 }),
        ],
      }),
    ],
    [def({ parallelCapacity: 1 })],
  );

  const block = result.blocks[0];
  // Two lanes ⇒ two waves, so the reserved place really did occupy one.
  assert.equal(block.session.derivedBlockEndTime, "09:40");
  assert.deepEqual(block.session.examineeStudentIds, ["stu-2"]);
  assert.deepEqual(block.detail?.slots, [
    {
      assignmentId: "A1",
      studentId: null,
      role: "EXAMINEE",
      startTime: "09:00",
      endTime: "09:20",
    },
    {
      assignmentId: "A2",
      studentId: "stu-2",
      role: "EXAMINEE",
      startTime: "09:20",
      endTime: "09:40",
    },
  ]);
  // It identifies nobody, so it takes part in no conflict.
  assert.deepEqual(
    block.conflictSession.assignments.map((a) => a.assignmentId),
    ["A2"],
  );
});

// ===========================================================================
// 16-19. Timetable status
// ===========================================================================

test("an unresolved timetable yields UNRESOLVED, no derived end and no detail", () => {
  const result = composeStoredExamBlocks(
    [sessionRow({ startTime: "9:00", assignments: threeExaminees() })],
    [def()],
  );

  const block = result.blocks[0];
  assert.equal(block.session.timetableStatus, "UNRESOLVED");
  assert.equal(block.session.derivedBlockEndTime, null);
  assert.equal(block.detail, null);
  assert.deepEqual(
    block.timetableIssues.map((i) => i.code),
    ["EX-CALC-INVALID-START"],
  );
  assert.equal(block.conflictSession.timetableStatus, "UNRESOLVED");
  assert.deepEqual(block.conflictSession.slots, []);
});

test("a zero-examinee block may be OK with a null derived block end", () => {
  const result = composeStoredExamBlocks([sessionRow({ assignments: [] })], [def()]);

  const block = result.blocks[0];
  assert.equal(block.session.timetableStatus, "OK");
  assert.equal(block.session.derivedBlockEndTime, null);
  assert.notEqual(block.detail, null, "an empty block still has usable (empty) detail");
  assert.deepEqual(block.detail?.slots, []);
  assert.deepEqual(
    block.timetableWarnings.map((w) => w.code),
    ["EX-CALC-EMPTY-BLOCK"],
  );
});

test("a null stored endTime becomes an empty string that is never a fallback", () => {
  const ok = composeStoredExamBlocks(
    [sessionRow({ endTime: null, assignments: threeExaminees() })],
    [def()],
  ).blocks[0];
  assert.equal(ok.session.endTime, "");
  assert.equal(ok.session.derivedBlockEndTime, "09:40");
  // The projection core measures the block by its DERIVED end, never by "".
  assert.deepEqual(projectGeneralSchedule([ok.session]).map((r) => r.lastEndTime), [
    "09:40",
  ]);
  // ...and no personal slot ever carries the placeholder.
  assert.equal(
    ok.detail?.slots.some((s) => s.endTime === "" || s.startTime === ""),
    false,
  );

  // The stored endTime is NOT a fallback for an unresolved block either: the row
  // below carries a perfectly good stored 10:00 and still contributes zero.
  const unresolved = composeStoredExamBlocks(
    [sessionRow({ startTime: "9:00", endTime: "10:00", assignments: threeExaminees() })],
    [def()],
  ).blocks[0];
  const summary = projectGeneralSchedule([unresolved.session]);
  assert.equal(summary[0].lastEndTime, null);
  assert.equal(summary[0].totalDurationMinutes, 0);
  assert.equal(summary[0].operationalSpanMinutes, 0);
});

test("a non-integer orderIndex fails closed through the timetable core", () => {
  const result = composeStoredExamBlocks(
    [
      sessionRow({
        assignments: [
          assignment({ id: "A1", studentId: "stu-1", orderIndex: 0 }),
          assignment({ id: "A2", studentId: "stu-2", orderIndex: 1.5 }),
        ],
      }),
    ],
    [def()],
  );

  const block = result.blocks[0];
  assert.equal(block.session.timetableStatus, "UNRESOLVED");
  assert.equal(block.detail, null);
  assert.deepEqual(
    block.timetableIssues.map((i) => i.code),
    ["EX-CALC-INVALID-ORDER"],
  );
  // Nothing was coerced: the offending row was never rounded into a lane.
  assert.deepEqual(block.timetableIssues[0].details, ["A2"]);
});

// ===========================================================================
// 20. Diagnostics are diagnostics
// ===========================================================================

test("definition and horse conformance issues are retained without changing status", () => {
  const result = composeStoredExamBlocks(
    [
      sessionRow({
        assignments: [
          assignment({ id: "A1", studentId: "stu-1", horseName: null, orderIndex: 0 }),
        ],
      }),
    ],
    [def({ requiresDiscipline: true })],
  );

  const block = result.blocks[0];
  const issueCodes = block.definitionIssues.map((i) => i.code);
  assert.equal(issueCodes.includes("EX-DEF-HORSE-REQUIRED"), true);
  assert.equal(issueCodes.includes("EX-DEF-DISCIPLINE-REQUIRED"), true);
  // Diagnostic only — the block is still fully scheduled and visible.
  assert.equal(block.session.timetableStatus, "OK");
  assert.equal(block.session.derivedBlockEndTime, "09:20");
  assert.notEqual(block.detail, null);
});

test("a definition that is invalid in itself is reported without hiding the block", () => {
  const result = composeStoredExamBlocks(
    [sessionRow({ assignments: [assignment()] })],
    [def({ name: "   ", requiresLessonTopic: true })],
  );
  const codesSeen = result.blocks[0].definitionIssues.map((i) => i.code);
  assert.equal(codesSeen.includes("EX-DEF-NAME-REQUIRED"), true);
  assert.equal(codesSeen.includes("EX-DEF-TOPIC-NOT-APPLICABLE"), true);
  assert.equal(result.blocks.length, 1);
});

// ===========================================================================
// 21-23. Structural guards
// ===========================================================================

test("the source uses no deprecated exam semantics and no impure capability", () => {
  const forbidden = [
    "sourcePracticeRole",
    "interfaceSessionId",
    "interfaceSession",
    "sourceTeachingPracticeLessonId",
    "copiedAt",
    "roleLabelOverrides",
    "ExamPhase",
    "phase",
    "exam-beginner-copy-core",
    "planBeginnerExamCopy",
    "prisma",
    "Prisma",
    "use server",
    "Math.random",
    "Date.now",
    "new Date",
    "process.env",
    "next/headers",
  ];
  for (const token of forbidden) {
    assert.equal(
      CORE_CODE.includes(token),
      false,
      `the adapter source must not contain "${token}"`,
    );
  }

  // The deprecated capacity column is never read; only the definition's.
  assert.equal(CORE_CODE.includes("row.capacity"), false);
  assert.equal(CORE_CODE.includes("row.kind"), false);
  assert.equal(CORE_CODE.includes("definition.durationMinutes"), true);
  assert.equal(CORE_CODE.includes("definition.parallelCapacity"), true);

  // `beginnerFormat` appears exactly once, as the constant null a stored row
  // must carry — never as a value read from a row.
  const beginnerFormatHits = CORE_CODE.match(/beginnerFormat/g) ?? [];
  assert.equal(beginnerFormatHits.length, 1);
  assert.equal(CORE_CODE.includes("beginnerFormat: null"), true);
});

test("ProjectionSession has not been extended", () => {
  const declaration = /export interface ProjectionSession \{([\s\S]*?)\n\}/.exec(
    PROJECTION_SOURCE,
  );
  assert.notEqual(declaration, null, "the ProjectionSession declaration is still there");
  const declaredFields = [
    ...(declaration?.[1] ?? "").matchAll(/^\s*readonly (\w+)\??:/gm),
  ].map((m) => m[1]);

  const EXPECTED = [
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
  ];
  assert.deepEqual(declaredFields, EXPECTED, "the committed interface is unchanged");

  // And what the adapter actually emits carries exactly those keys.
  const result = composeStoredExamBlocks(
    [sessionRow({ assignments: threeExaminees(), breaks: [brk()] })],
    [def()],
  );
  assert.deepEqual(Object.keys(result.blocks[0].session).sort(), [...EXPECTED].sort());
});

test("no slot, detail, supervisor or self state leaks into ProjectionSession", () => {
  const result = composeStoredExamBlocks(
    [
      sessionRow({
        assignments: threeExaminees(),
        supervisorInstructorIds: ["ins-1"],
      }),
    ],
    [def()],
  );
  const keys = Object.keys(result.blocks[0].session);
  for (const forbidden of [
    "slots",
    "waves",
    "detail",
    "isSelf",
    "selfStartTime",
    "definitionOrderIndex",
    "supervisorInstructorIds",
    "assignmentIds",
    "title",
    "notes",
    "arena",
    "individualPublishedAt",
    "updatedAt",
  ]) {
    assert.equal(keys.includes(forbidden), false, `ProjectionSession must not carry ${forbidden}`);
  }
  // The serialized row exposes no personal time at all.
  assert.equal(JSON.stringify(result.blocks[0].session).includes("assignmentId"), false);
});

// ===========================================================================
// 24-26. Purity, freezing, determinism
// ===========================================================================

test("the inputs are never mutated", () => {
  const definitions = [def(), def({ id: "def-other", name: "אחר" })];
  const sessions = [
    sessionRow({
      assignments: threeExaminees(),
      breaks: [brk({ afterWaveIndex: 0 })],
      supervisorInstructorIds: ["ins-1", "ins-2"],
    }),
  ];
  const definitionsCopy = structuredClone(definitions);
  const sessionsCopy = structuredClone(sessions);

  composeStoredExamBlocks(sessions, definitions);

  assert.deepEqual(definitions, definitionsCopy);
  assert.deepEqual(sessions, sessionsCopy);
  assert.equal(Object.isFrozen(sessions), false, "the caller's arrays stay extensible");
  assert.equal(Object.isFrozen(sessions[0]), false);
  assert.equal(Object.isFrozen(sessions[0].assignments), false);
});

test("every returned block, detail, conflict input and issue is frozen", () => {
  const result = composeStoredExamBlocks(
    [
      sessionRow({ assignments: threeExaminees(), supervisorInstructorIds: ["ins-1"] }),
      sessionRow({ id: "X2", definitionId: "def-gone", startTime: "11:00" }),
    ],
    [def()],
  );

  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.blocks), true);
  assert.equal(Object.isFrozen(result.issues), true);
  for (const issue of result.issues) assert.equal(Object.isFrozen(issue), true);

  const block = result.blocks[0];
  assert.equal(Object.isFrozen(block), true);
  assert.equal(Object.isFrozen(block.session), true);
  assert.equal(Object.isFrozen(block.session.examineeStudentIds), true);
  assert.equal(Object.isFrozen(block.session.instructedTraineeStudentIds), true);
  assert.equal(Object.isFrozen(block.detail), true);
  assert.equal(Object.isFrozen(block.detail?.slots), true);
  for (const slot of block.detail?.slots ?? []) assert.equal(Object.isFrozen(slot), true);
  assert.equal(Object.isFrozen(block.conflictSession), true);
  assert.equal(Object.isFrozen(block.conflictSession.interval), true);
  assert.equal(Object.isFrozen(block.conflictSession.assignments), true);
  assert.equal(Object.isFrozen(block.conflictSession.slots), true);
  assert.equal(Object.isFrozen(block.conflictSession.supervisorIds), true);
  assert.equal(Object.isFrozen(block.conflictSession.horseIds), true);
  assert.equal(Object.isFrozen(block.timetableIssues), true);
  assert.equal(Object.isFrozen(block.timetableWarnings), true);
  assert.equal(Object.isFrozen(block.definitionIssues), true);
  assert.equal(Object.isFrozen(block.adapterIssues), true);
});

test("the output is deterministic under shuffled definitions, sessions, assignments and breaks", () => {
  const definitions = [
    def({ id: "def-a", name: "א" }),
    def({ id: "def-b", name: "ב", kind: "ADVANCED_INSTRUCTION" }),
  ];
  const assignments = [
    assignment({ id: "A1", studentId: "stu-1", orderIndex: 0 }),
    assignment({ id: "A2", studentId: "stu-2", orderIndex: 1 }),
    assignment({ id: "A3", studentId: "stu-3", orderIndex: 2 }),
    assignment({ id: "A4", studentId: "stu-4", orderIndex: 3 }),
  ];
  const breaks = [
    brk({ id: "B1", afterWaveIndex: 0, durationMinutes: 10 }),
    brk({ id: "B2", afterWaveIndex: 1, durationMinutes: 5 }),
  ];
  const sessions = [
    sessionRow({ id: "X1", definitionId: "def-a", assignments, breaks }),
    sessionRow({ id: "X2", definitionId: "def-b", startTime: "12:00", assignments }),
    sessionRow({
      id: "X0",
      definitionId: "def-a",
      date: "2026-08-01",
      startTime: "08:00",
      assignments,
    }),
  ];

  const baseline = composeStoredExamBlocks(sessions, definitions);
  const shuffled = composeStoredExamBlocks(
    rotate(sessions, 2).map((s) => ({
      ...s,
      assignments: rotate(s.assignments, 3),
      breaks: rotate(s.breaks, 1),
    })),
    rotate(definitions, 1),
  );

  assert.deepEqual(shuffled, baseline);
  // And the locked block order holds regardless of the input order.
  assert.deepEqual(
    baseline.blocks.map((b) => b.session.sessionId),
    ["X0", "X1", "X2"],
  );
});

test("blocks are ordered by date, startTime, orderIndex then sessionId", () => {
  const rows = [
    sessionRow({ id: "d", date: "2026-08-03", startTime: "09:00", orderIndex: 0 }),
    sessionRow({ id: "c", date: "2026-08-02", startTime: "09:00", orderIndex: 1 }),
    sessionRow({ id: "b", date: "2026-08-02", startTime: "09:00", orderIndex: 0 }),
    sessionRow({ id: "a", date: "2026-08-02", startTime: "08:00", orderIndex: 9 }),
    sessionRow({ id: "b2", date: "2026-08-02", startTime: "09:00", orderIndex: 0 }),
  ];
  const result = composeStoredExamBlocks(rows, [def()]);
  assert.deepEqual(
    result.blocks.map((b) => b.session.sessionId),
    ["a", "b", "b2", "c", "d"],
  );
});

// ===========================================================================
// 27-28. Privacy and cross-payload identity
// ===========================================================================

test("issue payloads carry no PII", () => {
  const PII = ["stu-secret", "SUS-PII", "TITLE-PII", "NOTES-PII", "TOPIC-PII"];
  const result = composeStoredExamBlocks(
    [
      sessionRow({
        id: "X1",
        definitionId: "def-gone",
        title: "TITLE-PII",
        notes: "NOTES-PII",
        assignments: [
          assignment({ studentId: "stu-secret", horseName: "SUS-PII" }),
        ],
      }),
      sessionRow({
        id: "X2",
        startTime: "11:00",
        title: "TITLE-PII",
        notes: "NOTES-PII",
        assignments: [
          assignment({
            id: "A9",
            studentId: "stu-secret",
            role: "NOPE",
            horseName: "SUS-PII",
            instructionTopic: "TOPIC-PII",
          }),
        ],
      }),
    ],
    [def()],
  );

  const serialized = JSON.stringify([
    result.issues,
    ...result.blocks.map((b) => b.adapterIssues),
  ]);
  for (const secret of PII) {
    assert.equal(serialized.includes(secret), false, `"${secret}" must not reach an issue`);
  }
  // The diagnostics are still genuinely useful.
  assert.equal(serialized.includes("X1"), true);
  assert.equal(serialized.includes("A9"), true);
});

test("the conflict input and the projection row share identity and status", () => {
  const result = composeStoredExamBlocks(
    [
      sessionRow({ id: "X1", assignments: threeExaminees() }),
      sessionRow({ id: "X2", startTime: "9:00", assignments: threeExaminees() }),
      sessionRow({ id: "X3", startTime: "14:00", assignments: [] }),
    ],
    [def()],
  );

  assert.equal(result.blocks.length, 3);
  for (const block of result.blocks) {
    assert.equal(block.conflictSession.sessionId, block.session.sessionId);
    assert.equal(block.conflictSession.definitionId, block.session.definitionId);
    assert.equal(block.conflictSession.timetableStatus, block.session.timetableStatus);
    assert.equal(block.conflictSession.interval.date, block.session.date);
    assert.equal(block.conflictSession.interval.start, block.session.startTime);
    assert.equal(
      block.detail === null,
      block.session.timetableStatus === "UNRESOLVED",
      "detail is absent exactly when the timetable is unresolved",
    );
  }
});

// ===========================================================================
// Downstream contract match
// ===========================================================================

test("the detail lookup is exactly what the trainee view core consumes", () => {
  const result = composeStoredExamBlocks(
    [
      sessionRow({ id: "X1", assignments: threeExaminees() }),
      // An unresolved block contributes no entry and is hidden from trainees.
      sessionRow({ id: "X2", startTime: "9:00", assignments: threeExaminees() }),
    ],
    [def({ parallelCapacity: 1 })],
  );

  const lookup = buildStoredExamBlockDetailLookup(result.blocks);
  assert.deepEqual([...lookup.keys()], ["X1"]);

  const trainee = projectTraineeExamDay(
    result.blocks.map((b) => b.session),
    lookup,
    "2026-08-02",
    "stu-3",
  );

  assert.deepEqual(trainee.issues, []);
  assert.deepEqual(
    trainee.allRows.map((r) => r.session.sessionId),
    ["X1"],
    "the unresolved block is hidden with no issue",
  );
  assert.equal(trainee.myRows.length, 1);
  assert.equal(trainee.myRows[0].selfRole, "EXAMINEE");
  // stu-3 is the third examinee at capacity 1 ⇒ 09:40-10:00, never the block's.
  assert.equal(trainee.myRows[0].selfStartTime, "09:40");
  assert.equal(trainee.myRows[0].selfEndTime, "10:00");
  assert.notEqual(trainee.myRows[0].selfStartTime, "09:00");
});

test("the adapter is total over adversarial input", () => {
  const nonsense = [
    null,
    undefined,
    123,
    "x",
    {},
    { id: "X", definitionId: "def-riding" },
  ] as unknown as readonly StoredExamSessionRow[];

  assert.doesNotThrow(() => composeStoredExamBlocks(nonsense, [def()]));
  assert.doesNotThrow(() =>
    composeStoredExamBlocks(
      undefined as unknown as readonly StoredExamSessionRow[],
      undefined as unknown as readonly StoredExamDefinitionRow[],
    ),
  );
  assert.doesNotThrow(() =>
    buildStoredExamBlockDetailLookup(
      undefined as unknown as readonly never[],
    ),
  );

  const empty = composeStoredExamBlocks([], []);
  assert.deepEqual(empty.blocks, []);
  assert.deepEqual(empty.issues, []);
});

test("every adapter issue code carries a Hebrew message", () => {
  const ALL: StoredExamAdapterIssueCode[] = [
    "EX-ADP-SESSION-ID-REQUIRED",
    "EX-ADP-DEFINITION-MISSING",
    "EX-ADP-DEFINITION-DUPLICATE",
    "EX-ADP-DEFINITION-KIND-NOT-STORABLE",
    "EX-ADP-ROLE-INVALID",
    "EX-ADP-ASSIGNMENT-ID-REQUIRED",
  ];
  assert.deepEqual(Object.keys(STORED_EXAM_ADAPTER_MESSAGES).sort(), [...ALL].sort());
  for (const code of ALL) {
    const message = STORED_EXAM_ADAPTER_MESSAGES[code];
    assert.equal(typeof message, "string");
    assert.equal(message.trim().length > 0, true, `${code} has a message`);
  }
  assert.equal(Object.isFrozen(STORED_EXAM_ADAPTER_MESSAGES), true);
});
