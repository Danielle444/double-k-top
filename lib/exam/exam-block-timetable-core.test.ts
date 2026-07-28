/**
 * EXAM EX-C2 — executable tests for the PURE exam-block timetable core
 * (exam-block-timetable-core.ts).
 *
 * Run with: npx tsx --test lib/exam/exam-block-timetable-core.test.ts
 * PURE: no Prisma, no DB, no clock, no randomness, no env. The only file read
 * is this module's own SOURCE TEXT, by the purity guard at the bottom.
 *
 * SCOPE OF PROOF: wave formation from ordering + parallel capacity; positional
 * breaks; the incomplete final wave; the empty draft; every fail-closed input
 * rule; the midnight rule including its exact boundary; instructed-trainee slot
 * inheritance; and the structural promises (no input mutation, determinism,
 * deeply frozen output, exhaustive messages, no IO in the module).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  computeExamBlockTimetable,
  resolveInstructedTraineeSlots,
  EXAM_TIMETABLE_ISSUE_MESSAGES,
  EXAM_TIMETABLE_WARNING_MESSAGES,
  type ExamBlockTimetableInput,
  type TimetableBreak,
  type TimetableExaminee,
} from "./exam-block-timetable-core";

// --- fixtures ---------------------------------------------------------------

/** `n` examinees `a1..an`, already in the manager's intended order. */
function examinees(n: number): TimetableExaminee[] {
  return Array.from({ length: n }, (_, i) => ({
    assignmentId: `a${i + 1}`,
    orderIndex: i,
  }));
}

function input(over: Partial<ExamBlockTimetableInput> = {}): ExamBlockTimetableInput {
  return {
    blockStartTime: "09:00",
    durationMinutes: 15,
    parallelCapacity: 2,
    examinees: examinees(6),
    ...over,
  };
}

function brk(
  breakId: string,
  afterWaveIndex: number,
  durationMinutes: number,
): TimetableBreak {
  return { breakId, afterWaveIndex, durationMinutes };
}

/** Compact `[start, end, ids...]` view of each wave, for readable assertions. */
function waveShape(t: ReturnType<typeof computeExamBlockTimetable>) {
  return t.waves.map((w) => [w.startTime, w.endTime, ...w.assignmentIds]);
}

function codes(t: ReturnType<typeof computeExamBlockTimetable>): string[] {
  return t.issues.map((i) => i.code);
}

function warnCodes(t: ReturnType<typeof computeExamBlockTimetable>): string[] {
  return t.warnings.map((w) => w.code);
}

/** Every blocking result must be EMPTY — never a partial timetable. */
function assertNoPartialTimetable(t: ReturnType<typeof computeExamBlockTimetable>): void {
  assert.equal(t.ok, false);
  assert.deepEqual(t.slots, []);
  assert.deepEqual(t.waves, []);
  assert.equal(t.blockEndTime, null);
  assert.equal(t.waveCount, 0);
  assert.deepEqual(t.warnings, []);
}

// ===========================================================================
// The canonical worked example
// ===========================================================================

test("15 minutes, capacity 2, six examinees — the locked worked example", () => {
  const t = computeExamBlockTimetable(input());

  assert.equal(t.ok, true);
  assert.deepEqual(t.issues, []);
  assert.deepEqual(t.warnings, []);
  assert.equal(t.waveCount, 3);
  assert.equal(t.blockEndTime, "09:45");
  assert.deepEqual(waveShape(t), [
    ["09:00", "09:15", "a1", "a2"],
    ["09:15", "09:30", "a3", "a4"],
    ["09:30", "09:45", "a5", "a6"],
  ]);

  // Every examinee gets exactly one slot, and wave members share their times.
  assert.equal(t.slots.length, 6);
  assert.deepEqual(
    t.slots.map((s) => [s.assignmentId, s.waveIndex, s.positionInWave, s.startTime, s.endTime]),
    [
      ["a1", 0, 0, "09:00", "09:15"],
      ["a2", 0, 1, "09:00", "09:15"],
      ["a3", 1, 0, "09:15", "09:30"],
      ["a4", 1, 1, "09:15", "09:30"],
      ["a5", 2, 0, "09:30", "09:45"],
      ["a6", 2, 1, "09:30", "09:45"],
    ],
  );
});

test("the incomplete final wave is valid and is never padded", () => {
  const t = computeExamBlockTimetable(input({ examinees: examinees(5) }));

  assert.equal(t.ok, true);
  assert.equal(t.waveCount, 3);
  assert.equal(t.blockEndTime, "09:45");
  assert.deepEqual(waveShape(t), [
    ["09:00", "09:15", "a1", "a2"],
    ["09:15", "09:30", "a3", "a4"],
    ["09:30", "09:45", "a5"],
  ]);
  // The short wave keeps the same duration as a full one.
  assert.equal(t.slots.length, 5);
});

test("capacity 1 is strictly sequential", () => {
  const t = computeExamBlockTimetable(
    input({ blockStartTime: "08:00", durationMinutes: 20, parallelCapacity: 1, examinees: examinees(3) }),
  );

  assert.equal(t.waveCount, 3);
  assert.deepEqual(waveShape(t), [
    ["08:00", "08:20", "a1"],
    ["08:20", "08:40", "a2"],
    ["08:40", "09:00", "a3"],
  ]);
  assert.equal(t.blockEndTime, "09:00");
});

test("capacity greater than the examinee count yields a single wave", () => {
  const t = computeExamBlockTimetable(input({ parallelCapacity: 10, examinees: examinees(3) }));

  assert.equal(t.waveCount, 1);
  assert.deepEqual(waveShape(t), [["09:00", "09:15", "a1", "a2", "a3"]]);
  assert.equal(t.blockEndTime, "09:15");
});

// ===========================================================================
// Ordering
// ===========================================================================

test("examinees are ordered by orderIndex, not by array position", () => {
  const t = computeExamBlockTimetable(
    input({
      parallelCapacity: 1,
      examinees: [
        { assignmentId: "a1", orderIndex: 2 },
        { assignmentId: "a2", orderIndex: 0 },
        { assignmentId: "a3", orderIndex: 1 },
      ],
    }),
  );

  assert.deepEqual(
    t.slots.map((s) => s.assignmentId),
    ["a2", "a3", "a1"],
  );
});

test("assignmentId is the tie-break for equal orderIndex", () => {
  const t = computeExamBlockTimetable(
    input({
      parallelCapacity: 1,
      examinees: [
        { assignmentId: "c", orderIndex: 0 },
        { assignmentId: "a", orderIndex: 0 },
        { assignmentId: "b", orderIndex: 0 },
      ],
    }),
  );

  assert.deepEqual(
    t.slots.map((s) => s.assignmentId),
    ["a", "b", "c"],
  );
});

test("reordering changes allocation but never the derivation rules", () => {
  const before = computeExamBlockTimetable(input({ examinees: examinees(6) }));
  const after = computeExamBlockTimetable(
    input({
      examinees: [
        { assignmentId: "a1", orderIndex: 5 },
        { assignmentId: "a2", orderIndex: 1 },
        { assignmentId: "a3", orderIndex: 2 },
        { assignmentId: "a4", orderIndex: 3 },
        { assignmentId: "a5", orderIndex: 4 },
        { assignmentId: "a6", orderIndex: 0 },
      ],
    }),
  );

  // Identical wave boundaries and block end...
  assert.deepEqual(
    before.waves.map((w) => [w.startTime, w.endTime]),
    after.waves.map((w) => [w.startTime, w.endTime]),
  );
  assert.equal(before.blockEndTime, after.blockEndTime);
  assert.equal(before.waveCount, after.waveCount);
  // ...but a different occupant order: a6 leads and a1 is last.
  assert.deepEqual(after.waves[0].assignmentIds, ["a6", "a2"]);
  assert.deepEqual(after.waves[2].assignmentIds, ["a5", "a1"]);
});

// ===========================================================================
// Breaks
// ===========================================================================

test("a positional break shifts every later wave and nothing before it", () => {
  const t = computeExamBlockTimetable(input({ breaks: [brk("b1", 0, 30)] }));

  assert.equal(t.ok, true);
  assert.deepEqual(t.warnings, []);
  assert.deepEqual(waveShape(t), [
    ["09:00", "09:15", "a1", "a2"],
    ["09:45", "10:00", "a3", "a4"],
    ["10:00", "10:15", "a5", "a6"],
  ]);
  assert.equal(t.blockEndTime, "10:15");
});

test("multiple breaks after different waves each shift their successors", () => {
  const t = computeExamBlockTimetable(input({ breaks: [brk("b1", 0, 30), brk("b2", 1, 15)] }));

  assert.deepEqual(waveShape(t), [
    ["09:00", "09:15", "a1", "a2"],
    ["09:45", "10:00", "a3", "a4"],
    ["10:15", "10:30", "a5", "a6"],
  ]);
  assert.equal(t.blockEndTime, "10:30");
});

test("two breaks after the same wave sum their durations", () => {
  const summed = computeExamBlockTimetable(input({ breaks: [brk("b1", 0, 10), brk("b2", 0, 20)] }));
  const single = computeExamBlockTimetable(input({ breaks: [brk("b1", 0, 30)] }));

  assert.deepEqual(waveShape(summed), waveShape(single));
  assert.equal(summed.blockEndTime, "10:15");
});

test("a break after the final wave is an orphan warning and shifts nothing", () => {
  const withOrphan = computeExamBlockTimetable(input({ breaks: [brk("b1", 2, 45)] }));
  const without = computeExamBlockTimetable(input());

  assert.equal(withOrphan.ok, true);
  assert.deepEqual(warnCodes(withOrphan), ["EX-CALC-BREAK-ORPHAN"]);
  assert.deepEqual(withOrphan.warnings[0].details, ["b1"]);
  // Times are byte-identical to the break-free block: it changed nothing.
  assert.deepEqual(waveShape(withOrphan), waveShape(without));
  assert.equal(withOrphan.blockEndTime, without.blockEndTime);
});

test("a break beyond the final wave is also an orphan, never silently dropped", () => {
  const t = computeExamBlockTimetable(input({ breaks: [brk("b1", 9, 45)] }));

  assert.equal(t.ok, true);
  assert.deepEqual(warnCodes(t), ["EX-CALC-BREAK-ORPHAN"]);
  assert.equal(t.blockEndTime, "09:45");
});

test("orphan warnings are reported in the input order of breaks", () => {
  const t = computeExamBlockTimetable(input({ breaks: [brk("b2", 5, 10), brk("b1", 4, 10)] }));

  assert.deepEqual(
    t.warnings.map((w) => w.details[0]),
    ["b2", "b1"],
  );
});

// ===========================================================================
// The empty draft
// ===========================================================================

test("zero examinees is a valid draft with no waves and no end", () => {
  const t = computeExamBlockTimetable(input({ examinees: [] }));

  assert.equal(t.ok, true);
  assert.deepEqual(t.issues, []);
  assert.deepEqual(t.slots, []);
  assert.deepEqual(t.waves, []);
  assert.equal(t.blockEndTime, null);
  assert.equal(t.waveCount, 0);
  assert.deepEqual(warnCodes(t), ["EX-CALC-EMPTY-BLOCK"]);
});

test("in an empty draft every break is orphaned, after the empty-block warning", () => {
  const t = computeExamBlockTimetable(input({ examinees: [], breaks: [brk("b1", 0, 30)] }));

  assert.equal(t.ok, true);
  assert.deepEqual(warnCodes(t), ["EX-CALC-EMPTY-BLOCK", "EX-CALC-BREAK-ORPHAN"]);
});

// ===========================================================================
// Fail-closed input validation
// ===========================================================================

test("an invalid block start fails closed", () => {
  for (const bad of ["9:00", "24:00", "09:60", "0900", "", "  ", null, undefined, 900]) {
    const t = computeExamBlockTimetable(input({ blockStartTime: bad as string }));
    assert.deepEqual(codes(t), ["EX-CALC-INVALID-START"], String(bad));
    assertNoPartialTimetable(t);
  }
});

test("an invalid per-trainee duration fails closed", () => {
  for (const bad of [0, -15, 12.5, NaN, Infinity, -Infinity, null, undefined, "15"]) {
    const t = computeExamBlockTimetable(input({ durationMinutes: bad as number }));
    assert.deepEqual(codes(t), ["EX-CALC-INVALID-DURATION"], String(bad));
    assertNoPartialTimetable(t);
  }
});

test("an invalid parallel capacity fails closed", () => {
  for (const bad of [0, -2, 2.5, NaN, Infinity, null, undefined, "2"]) {
    const t = computeExamBlockTimetable(input({ parallelCapacity: bad as number }));
    assert.deepEqual(codes(t), ["EX-CALC-INVALID-CAPACITY"], String(bad));
    assertNoPartialTimetable(t);
  }
});

test("an invalid orderIndex fails closed and names the assignment", () => {
  for (const bad of [1.5, NaN, Infinity, null, undefined, "0"]) {
    const t = computeExamBlockTimetable(
      input({ examinees: [{ assignmentId: "a1", orderIndex: bad as number }] }),
    );
    assert.deepEqual(codes(t), ["EX-CALC-INVALID-ORDER"], String(bad));
    assert.deepEqual(t.issues[0].details, ["a1"]);
    assertNoPartialTimetable(t);
  }
});

test("a blank assignmentId is an ordering error — it is the tie-break key", () => {
  for (const bad of ["", "   ", null, undefined, 7]) {
    const t = computeExamBlockTimetable(
      input({ examinees: [{ assignmentId: bad as string, orderIndex: 0 }] }),
    );
    assert.deepEqual(codes(t), ["EX-CALC-INVALID-ORDER"], String(bad));
    // No id to attribute it to, so details stay empty rather than inventing one.
    assert.deepEqual(t.issues[0].details, []);
    assertNoPartialTimetable(t);
  }
});

test("an invalid break fails closed", () => {
  const cases: TimetableBreak[] = [
    brk("b1", -1, 30),
    brk("b1", 1.5, 30),
    brk("b1", NaN, 30),
    brk("b1", 0, -30),
    brk("b1", 0, 12.5),
    brk("b1", 0, Infinity),
    { breakId: "b1", afterWaveIndex: 0, durationMinutes: "30" as unknown as number },
    { breakId: "", afterWaveIndex: 0, durationMinutes: 30 },
  ];
  for (const bad of cases) {
    const t = computeExamBlockTimetable(input({ breaks: [bad] }));
    assert.deepEqual(codes(t), ["EX-CALC-INVALID-BREAK"], JSON.stringify(bad));
    assertNoPartialTimetable(t);
  }
});

test("a duplicated examinee fails closed, once per duplicated id", () => {
  const t = computeExamBlockTimetable(
    input({
      examinees: [
        { assignmentId: "a1", orderIndex: 0 },
        { assignmentId: "a1", orderIndex: 1 },
        { assignmentId: "a1", orderIndex: 2 },
        { assignmentId: "a2", orderIndex: 3 },
      ],
    }),
  );

  assert.deepEqual(codes(t), ["EX-CALC-DUPLICATE-EXAMINEE"]);
  assert.deepEqual(t.issues[0].details, ["a1"]);
  assertNoPartialTimetable(t);
});

test("multiple input errors are all reported, in the documented stable order", () => {
  const t = computeExamBlockTimetable({
    blockStartTime: "nope",
    durationMinutes: 0,
    parallelCapacity: -1,
    examinees: [
      { assignmentId: "a1", orderIndex: 1.5 },
      { assignmentId: "a2", orderIndex: 0 },
      { assignmentId: "a2", orderIndex: 1 },
    ],
    breaks: [brk("b1", -1, 30)],
  });

  assert.deepEqual(codes(t), [
    "EX-CALC-INVALID-START",
    "EX-CALC-INVALID-DURATION",
    "EX-CALC-INVALID-CAPACITY",
    "EX-CALC-INVALID-ORDER",
    "EX-CALC-DUPLICATE-EXAMINEE",
    "EX-CALC-INVALID-BREAK",
  ]);
  assertNoPartialTimetable(t);
});

// ===========================================================================
// The midnight rule
// ===========================================================================

test("a block whose last wave crosses midnight fails closed", () => {
  const t = computeExamBlockTimetable(
    input({
      blockStartTime: "23:00",
      durationMinutes: 30,
      parallelCapacity: 1,
      examinees: examinees(3),
    }),
  );

  assert.deepEqual(codes(t), ["EX-CALC-MIDNIGHT"]);
  assertNoPartialTimetable(t);
});

test("an end of exactly 24:00 is rejected — it is unrepresentable as HH:MM", () => {
  const t = computeExamBlockTimetable(
    input({
      blockStartTime: "23:00",
      durationMinutes: 60,
      parallelCapacity: 1,
      examinees: examinees(1),
    }),
  );

  assert.deepEqual(codes(t), ["EX-CALC-MIDNIGHT"]);
  assertNoPartialTimetable(t);
});

test("an end of 23:59 is accepted — the boundary is exact, not approximate", () => {
  const t = computeExamBlockTimetable(
    input({
      blockStartTime: "23:00",
      durationMinutes: 59,
      parallelCapacity: 1,
      examinees: examinees(1),
    }),
  );

  assert.equal(t.ok, true);
  assert.equal(t.blockEndTime, "23:59");
});

test("a break can itself push the block past midnight, and is rejected the same way", () => {
  const base = {
    blockStartTime: "22:00",
    durationMinutes: 30,
    parallelCapacity: 1,
    examinees: examinees(2),
  };

  // Without the break the block ends comfortably at 23:00.
  const fine = computeExamBlockTimetable(input(base));
  assert.equal(fine.ok, true);
  assert.equal(fine.blockEndTime, "23:00");

  // The break alone is what crosses midnight.
  const crossing = computeExamBlockTimetable(input({ ...base, breaks: [brk("b1", 0, 120)] }));
  assert.deepEqual(codes(crossing), ["EX-CALC-MIDNIGHT"]);
  assertNoPartialTimetable(crossing);
});

// ===========================================================================
// Instructed-trainee inheritance
// ===========================================================================

test("a paired instructed trainee inherits the examinee's exact slot", () => {
  const t = computeExamBlockTimetable(
    input({ parallelCapacity: 2, examinees: examinees(4) }),
  );
  const inherited = resolveInstructedTraineeSlots(
    t,
    [
      { assignmentId: "a1", pairingIndex: 1 },
      { assignmentId: "a2", pairingIndex: 2 },
      { assignmentId: "a3", pairingIndex: 3 },
      { assignmentId: "a4", pairingIndex: 4 },
    ],
    [
      { assignmentId: "i3", pairingIndex: 3 },
      { assignmentId: "i1", pairingIndex: 1 },
    ],
  );

  assert.deepEqual(
    inherited.map((s) => [s.assignmentId, s.waveIndex, s.startTime, s.endTime]),
    [
      // Input order is preserved; a3 sits in wave 1 and a1 in wave 0.
      ["i3", 1, "09:15", "09:30"],
      ["i1", 0, "09:00", "09:15"],
    ],
  );
});

test("with exactly one examinee an unpaired instructed trainee inherits it", () => {
  const t = computeExamBlockTimetable(input({ examinees: examinees(1) }));
  const inherited = resolveInstructedTraineeSlots(
    t,
    [{ assignmentId: "a1", pairingIndex: null }],
    [{ assignmentId: "i1", pairingIndex: null }],
  );

  assert.deepEqual(
    inherited.map((s) => [s.assignmentId, s.startTime, s.endTime]),
    [["i1", "09:00", "09:15"]],
  );
});

test("with several examinees an unresolved pairing inherits nothing and never throws", () => {
  const t = computeExamBlockTimetable(input({ examinees: examinees(4) }));
  const pairs = [
    { assignmentId: "a1", pairingIndex: 1 },
    { assignmentId: "a2", pairingIndex: 1 },
    { assignmentId: "a3", pairingIndex: null },
    { assignmentId: "a4", pairingIndex: 4 },
  ];

  // Unpaired with several examinees; pairing shared by two examinees; pairing
  // matching no examinee at all.
  assert.deepEqual(
    resolveInstructedTraineeSlots(t, pairs, [{ assignmentId: "i1", pairingIndex: null }]),
    [],
  );
  assert.deepEqual(
    resolveInstructedTraineeSlots(t, pairs, [{ assignmentId: "i2", pairingIndex: 1 }]),
    [],
  );
  assert.deepEqual(
    resolveInstructedTraineeSlots(t, pairs, [{ assignmentId: "i3", pairingIndex: 99 }]),
    [],
  );
});

test("a stated-but-unmatched pairing never falls back, even with one examinee", () => {
  const t = computeExamBlockTimetable(input({ examinees: examinees(1) }));

  // The single-examinee fallback is for NO pairing at all. A pairing that names
  // nobody is a mis-pairing to surface, not an invitation to guess.
  assert.deepEqual(
    resolveInstructedTraineeSlots(
      t,
      [{ assignmentId: "a1", pairingIndex: 1 }],
      [{ assignmentId: "i1", pairingIndex: 7 }],
    ),
    [],
  );
});

test("instructed trainees consume no lane and never enter a wave", () => {
  const t = computeExamBlockTimetable(input({ parallelCapacity: 2, examinees: examinees(2) }));
  const inherited = resolveInstructedTraineeSlots(
    t,
    [
      { assignmentId: "a1", pairingIndex: 1 },
      { assignmentId: "a2", pairingIndex: 2 },
    ],
    [
      { assignmentId: "i1", pairingIndex: 1 },
      { assignmentId: "i2", pairingIndex: 2 },
    ],
  );

  // Four people, but still ONE wave of two lanes and a 15-minute block.
  assert.equal(t.waveCount, 1);
  assert.deepEqual(t.waves[0].assignmentIds, ["a1", "a2"]);
  assert.equal(t.blockEndTime, "09:15");
  assert.equal(t.slots.length, 2);
  assert.equal(inherited.length, 2);
  for (const id of ["i1", "i2"]) {
    assert.equal(t.waves.some((w) => w.assignmentIds.includes(id)), false);
    assert.equal(t.slots.some((s) => s.assignmentId === id), false);
  }
});

test("an unsuccessful timetable inherits nothing", () => {
  const t = computeExamBlockTimetable(input({ parallelCapacity: 0 }));

  assert.equal(t.ok, false);
  assert.deepEqual(
    resolveInstructedTraineeSlots(
      t,
      [{ assignmentId: "a1", pairingIndex: 1 }],
      [{ assignmentId: "i1", pairingIndex: 1 }],
    ),
    [],
  );
});

// ===========================================================================
// Structural promises
// ===========================================================================

test("the caller's input is never mutated or reordered", () => {
  const examineeList: TimetableExaminee[] = [
    { assignmentId: "a3", orderIndex: 2 },
    { assignmentId: "a1", orderIndex: 0 },
    { assignmentId: "a2", orderIndex: 1 },
  ];
  const breakList: TimetableBreak[] = [brk("b1", 0, 30)];
  const original = JSON.stringify({ examineeList, breakList });

  computeExamBlockTimetable({
    blockStartTime: "09:00",
    durationMinutes: 15,
    parallelCapacity: 1,
    examinees: examineeList,
    breaks: breakList,
  });

  assert.equal(JSON.stringify({ examineeList, breakList }), original);
  assert.equal(Object.isFrozen(examineeList), false, "caller arrays must not be frozen in place");
  assert.equal(Object.isFrozen(examineeList[0]), false);
});

test("repeated calls on the same input are deeply equal", () => {
  const shared = input({ breaks: [brk("b1", 0, 30), brk("b2", 5, 10)] });

  assert.deepEqual(computeExamBlockTimetable(shared), computeExamBlockTimetable(shared));
});

test("the result is deeply frozen", () => {
  const t = computeExamBlockTimetable(input({ breaks: [brk("b1", 5, 10)] }));

  assert.equal(Object.isFrozen(t), true);
  assert.equal(Object.isFrozen(t.issues), true);
  assert.equal(Object.isFrozen(t.warnings), true);
  assert.equal(Object.isFrozen(t.slots), true);
  assert.equal(Object.isFrozen(t.waves), true);
  for (const slot of t.slots) assert.equal(Object.isFrozen(slot), true);
  for (const wave of t.waves) {
    assert.equal(Object.isFrozen(wave), true);
    assert.equal(Object.isFrozen(wave.assignmentIds), true);
  }
  for (const warning of t.warnings) {
    assert.equal(Object.isFrozen(warning), true);
    assert.equal(Object.isFrozen(warning.details), true);
  }

  const failing = computeExamBlockTimetable(input({ parallelCapacity: 0 }));
  assert.equal(Object.isFrozen(failing), true);
  assert.equal(Object.isFrozen(failing.issues), true);
  for (const issue of failing.issues) {
    assert.equal(Object.isFrozen(issue), true);
    assert.equal(Object.isFrozen(issue.details), true);
  }
});

test("inherited slots are frozen too", () => {
  const t = computeExamBlockTimetable(input({ examinees: examinees(1) }));
  const inherited = resolveInstructedTraineeSlots(
    t,
    [{ assignmentId: "a1", pairingIndex: null }],
    [{ assignmentId: "i1", pairingIndex: null }],
  );

  assert.equal(Object.isFrozen(inherited), true);
  assert.equal(Object.isFrozen(inherited[0]), true);
});

test("every code carries a non-empty Hebrew message, and there are no extras", () => {
  const issueCodes = [
    "EX-CALC-INVALID-START",
    "EX-CALC-INVALID-DURATION",
    "EX-CALC-INVALID-CAPACITY",
    "EX-CALC-INVALID-ORDER",
    "EX-CALC-INVALID-BREAK",
    "EX-CALC-DUPLICATE-EXAMINEE",
    "EX-CALC-MIDNIGHT",
  ] as const;
  const warningCodes = ["EX-CALC-EMPTY-BLOCK", "EX-CALC-BREAK-ORPHAN"] as const;

  assert.deepEqual(Object.keys(EXAM_TIMETABLE_ISSUE_MESSAGES).sort(), [...issueCodes].sort());
  assert.deepEqual(Object.keys(EXAM_TIMETABLE_WARNING_MESSAGES).sort(), [...warningCodes].sort());
  for (const code of issueCodes) {
    assert.equal(typeof EXAM_TIMETABLE_ISSUE_MESSAGES[code], "string");
    assert.ok(EXAM_TIMETABLE_ISSUE_MESSAGES[code].trim().length > 0, code);
  }
  for (const code of warningCodes) {
    assert.ok(EXAM_TIMETABLE_WARNING_MESSAGES[code].trim().length > 0, code);
  }
  assert.equal(Object.isFrozen(EXAM_TIMETABLE_ISSUE_MESSAGES), true);
  assert.equal(Object.isFrozen(EXAM_TIMETABLE_WARNING_MESSAGES), true);
});

// --- purity guard -----------------------------------------------------------

/** Strip block and line comments so documentation never trips the guard. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

test("the module is DB-free, clock-free and IO-free at the source level", () => {
  const source = readFileSync(
    join(import.meta.dirname, "exam-block-timetable-core.ts"),
    "utf8",
  );
  const code = stripComments(source);

  for (const forbidden of [
    /\bDate\b/,
    /Math\s*\.\s*random/,
    /process\s*\.\s*env/,
    /\bprisma\b/i,
    /\bfetch\s*\(/,
    /\brequire\s*\(/,
    /readFileSync/,
    /use server/,
    /\bcookies\b/,
  ]) {
    assert.equal(forbidden.test(code), false, `forbidden in core: ${forbidden}`);
  }

  // The one permitted dependency is the sibling pure overlap core.
  const imports = [...code.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(imports, ["./exam-overlap-core"]);
});
