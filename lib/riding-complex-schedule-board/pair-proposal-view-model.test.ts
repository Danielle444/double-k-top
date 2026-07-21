// Pure unit tests for the pair proposal view model (Stage 3D.1). Run:
//   npx tsx --test lib/riding-complex-schedule-board/pair-proposal-view-model.test.ts
//
// Pure and DB-free: no Prisma, server actions, React, network, clock, or random.
// Asserts the strict four accepted shapes, before/after direction, mandatory notes,
// the time-change cue, safe fallbacks, and that NO id/version/op/note ever leaks
// into a display string.

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPairProposalViewModel,
  type PairProposalDisplayLabels,
  type PairProposalInput,
  type PairProposalViewModel,
} from "./pair-proposal-view-model";

// A distinctive version that can never appear as a substring of the digit-bearing
// time labels below, so a leak check for it is unambiguous.
const SECRET_VERSION = 271828;
const MOVE_COMMAND = {
  op: "MOVE_PAIR" as const,
  expectedVersion: SECRET_VERSION,
  sourcePairId: "pair-src-id",
  destinationStationId: "station-dest-id",
};
const SWAP_COMMAND = {
  op: "SWAP_PAIRS" as const,
  expectedVersion: SECRET_VERSION,
  aPairId: "pair-a-id",
  bPairId: "pair-b-id",
};

const MOVE_LABELS: PairProposalDisplayLabels = {
  sourcePairLabel: "דנה + יעל",
  sourceTimeLabel: "08:00–08:45",
  destinationTimeLabel: "08:00–08:45",
  sourceStationLabel: "מגרש הרכיבה",
  destinationStationLabel: "מגרש הקפיצות",
  sourceHorseLabel: "ברק",
  timeChanged: false,
};

const SWAP_LABELS: PairProposalDisplayLabels = {
  sourcePairLabel: "דנה + יעל",
  destinationPairLabel: "נועה + תמר",
  sourceTimeLabel: "08:00–08:45",
  destinationTimeLabel: "09:00–09:45",
  sourceStationLabel: "מגרש הרכיבה",
  destinationStationLabel: "מגרש הקפיצות",
  sourceHorseLabel: "ברק",
  destinationHorseLabel: "כוכב",
  timeChanged: true,
};

/** Recursively collect every string value inside a view model. */
function allStrings(vm: PairProposalViewModel): string[] {
  const out: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === "string") out.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  // Deliberately exclude `command` - it is the non-display carrier.
  walk({ ...vm, command: undefined });
  return out;
}

// ---- Accepted shapes ------------------------------------------------------

test("accepts a bare MOVE_PAIR command", () => {
  const vm = buildPairProposalViewModel(MOVE_COMMAND, MOVE_LABELS);
  assert.notEqual(vm, null);
  assert.equal(vm?.kind, "pair-move");
  assert.equal(vm?.title, "העברת זוג");
});

test("accepts a bare SWAP_PAIRS command", () => {
  const vm = buildPairProposalViewModel(SWAP_COMMAND, SWAP_LABELS);
  assert.notEqual(vm, null);
  assert.equal(vm?.kind, "pair-swap");
  assert.equal(vm?.title, "החלפת זוגות");
});

test("accepts a wrapped pair-move proposal", () => {
  const vm = buildPairProposalViewModel({ kind: "pair-move", command: MOVE_COMMAND }, MOVE_LABELS);
  assert.equal(vm?.kind, "pair-move");
});

test("accepts a wrapped pair-swap proposal", () => {
  const vm = buildPairProposalViewModel({ kind: "pair-swap", command: SWAP_COMMAND }, SWAP_LABELS);
  assert.equal(vm?.kind, "pair-swap");
});

// ---- Rejected shapes ------------------------------------------------------

test("rejects wrong-resource, unknown, mismatched, and malformed inputs -> null", () => {
  const rejects: unknown[] = [
    null,
    undefined,
    42,
    "MOVE_PAIR",
    [],
    [MOVE_COMMAND],
    {},
    { op: "MOVE_HORSE", expectedVersion: 1, sourcePairId: "a", destinationPairId: "b" }, // wrong resource
    { op: "MOVE_TRAINEE", expectedVersion: 1 }, // wrong resource
    { op: "MOVE_INSTRUCTOR", expectedVersion: 1, sourceStationId: "a", destinationStationId: "b" },
    { op: "BOGUS", expectedVersion: 1, sourcePairId: "a", destinationStationId: "b" }, // unknown op
    { op: "MOVE_PAIR", expectedVersion: 1.5, sourcePairId: "a", destinationStationId: "b" }, // bad version
    { op: "MOVE_PAIR", sourcePairId: "a", destinationStationId: "b" }, // missing version
    { op: "MOVE_PAIR", expectedVersion: 1, sourcePairId: "", destinationStationId: "b" }, // blank id
    { op: "MOVE_PAIR", expectedVersion: 1, sourcePairId: "a" }, // missing dest station
    { op: "SWAP_PAIRS", expectedVersion: 1, aPairId: "a" }, // missing bPairId
    { kind: "pair-move", command: SWAP_COMMAND }, // kind/op mismatch
    { kind: "pair-swap", command: MOVE_COMMAND }, // kind/op mismatch
    { kind: "horse-move", command: MOVE_COMMAND }, // unknown wrapped kind
    { kind: "pair-move", command: null }, // shapeless wrapped command
  ];
  for (const bad of rejects) {
    assert.doesNotThrow(() => {
      assert.equal(buildPairProposalViewModel(bad as PairProposalInput, MOVE_LABELS), null);
    });
  }
});

// ---- Move: before/after direction -----------------------------------------

test("move: the pair sits at source before and destination after", () => {
  const vm = buildPairProposalViewModel(MOVE_COMMAND, MOVE_LABELS);
  assert.ok(vm);
  assert.equal(vm.before.heading, "לפני ההעברה");
  assert.equal(vm.after.heading, "אחרי ההעברה");
  assert.equal(vm.before.rows.length, 1);
  assert.equal(vm.after.rows.length, 1);
  assert.deepEqual(vm.before.rows[0], {
    pairLabel: "דנה + יעל",
    stationLabel: "מגרש הרכיבה",
    timeLabel: "08:00–08:45",
    horseLabel: "ברק",
  });
  assert.deepEqual(vm.after.rows[0], {
    pairLabel: "דנה + יעל",
    stationLabel: "מגרש הקפיצות",
    timeLabel: "08:00–08:45",
    horseLabel: "ברק",
  });
});

test("move: mandatory whole-pair and stationary coach/arena notes are present", () => {
  const vm = buildPairProposalViewModel(MOVE_COMMAND, MOVE_LABELS);
  assert.deepEqual(vm?.notes, [
    "החניכים, הסוס וההערה יעברו יחד.",
    "המאמן/ת והמגרש נשארים בתחנות.",
  ]);
});

// ---- Swap: before/after reversal ------------------------------------------

test("swap: pairs occupy each other's context after the swap", () => {
  const vm = buildPairProposalViewModel(SWAP_COMMAND, SWAP_LABELS);
  assert.ok(vm);
  assert.equal(vm.before.heading, "לפני ההחלפה");
  assert.equal(vm.after.heading, "אחרי ההחלפה");
  // Before: A at source, B at destination.
  assert.deepEqual(vm.before.rows, [
    { pairLabel: "דנה + יעל", stationLabel: "מגרש הרכיבה", timeLabel: "08:00–08:45", horseLabel: "ברק" },
    { pairLabel: "נועה + תמר", stationLabel: "מגרש הקפיצות", timeLabel: "09:00–09:45", horseLabel: "כוכב" },
  ]);
  // After: A at destination, B at source (reversed contexts; pair+horse travel).
  assert.deepEqual(vm.after.rows, [
    { pairLabel: "דנה + יעל", stationLabel: "מגרש הקפיצות", timeLabel: "09:00–09:45", horseLabel: "ברק" },
    { pairLabel: "נועה + תמר", stationLabel: "מגרש הרכיבה", timeLabel: "08:00–08:45", horseLabel: "כוכב" },
  ]);
});

test("swap: mandatory whole-pair and stationary coach/arena notes are present", () => {
  const vm = buildPairProposalViewModel(SWAP_COMMAND, SWAP_LABELS);
  assert.deepEqual(vm?.notes, [
    "הזוגות עוברים בשלמותם — החניכים, הסוס וההערה.",
    "המאמנים והמגרשים נשארים בתחנות.",
  ]);
});

// ---- Time-change cue ------------------------------------------------------

test("same-time move: no time-change notice (null)", () => {
  const vm = buildPairProposalViewModel(MOVE_COMMAND, { ...MOVE_LABELS, timeChanged: false });
  assert.equal(vm?.timeChangeNotice, null);
});

test("cross-time move: a prominent time-change notice", () => {
  const vm = buildPairProposalViewModel(MOVE_COMMAND, { ...MOVE_LABELS, timeChanged: true });
  assert.equal(vm?.timeChangeNotice, "שימו לב: הזוג עובר לטווח זמן אחר.");
});

test("cross-time swap: the swap-specific time notice", () => {
  const vm = buildPairProposalViewModel(SWAP_COMMAND, { ...SWAP_LABELS, timeChanged: true });
  assert.equal(vm?.timeChangeNotice, "שימו לב: הזוגות מחליפים גם את טווחי הזמן.");
});

test("same-time swap: no time-change notice (null)", () => {
  const vm = buildPairProposalViewModel(SWAP_COMMAND, { ...SWAP_LABELS, timeChanged: false });
  assert.equal(vm?.timeChangeNotice, null);
});

// ---- Fallbacks & horse omission -------------------------------------------

test("blank/missing labels fall back to safe generics", () => {
  const vm = buildPairProposalViewModel(SWAP_COMMAND, { timeChanged: false });
  assert.ok(vm);
  assert.deepEqual(vm.before.rows, [
    { pairLabel: "הזוג הנבחר", stationLabel: "התחנה הנוכחית", timeLabel: "טווח הזמן הנוכחי", horseLabel: null },
    { pairLabel: "הזוג השני", stationLabel: "התחנה הנבחרת", timeLabel: "טווח הזמן הנבחר", horseLabel: null },
  ]);
});

test("horse line is shown ONLY when a horse label is supplied", () => {
  const withHorse = buildPairProposalViewModel(MOVE_COMMAND, { ...MOVE_LABELS, sourceHorseLabel: "ברק" });
  assert.equal(withHorse?.before.rows[0].horseLabel, "ברק");
  const noHorse = buildPairProposalViewModel(MOVE_COMMAND, { ...MOVE_LABELS, sourceHorseLabel: "   " });
  assert.equal(noHorse?.before.rows[0].horseLabel, null);
  const absentHorse = buildPairProposalViewModel(MOVE_COMMAND, { ...MOVE_LABELS, sourceHorseLabel: undefined });
  assert.equal(absentHorse?.before.rows[0].horseLabel, null);
});

// ---- Privacy: no ids/version/op/note in display ---------------------------

test("no id/version/op ever appears in any display string; command retained unchanged", () => {
  const vm = buildPairProposalViewModel(MOVE_COMMAND, MOVE_LABELS);
  assert.ok(vm);
  const strings = allStrings(vm).join("");
  for (const secret of ["pair-src-id", "station-dest-id", "MOVE_PAIR", String(SECRET_VERSION)]) {
    assert.equal(strings.includes(secret), false, `secret leaked: ${secret}`);
  }
  // The command is retained verbatim (caller-owned reference, unfrozen, unmutated).
  assert.equal(vm.command, MOVE_COMMAND);
  assert.equal(Object.isFrozen(MOVE_COMMAND), false);
});

test("swap: no id/version/op leaks and the command is retained", () => {
  const vm = buildPairProposalViewModel(SWAP_COMMAND, SWAP_LABELS);
  assert.ok(vm);
  const strings = allStrings(vm).join("");
  for (const secret of ["pair-a-id", "pair-b-id", "SWAP_PAIRS", String(SECRET_VERSION)]) {
    assert.equal(strings.includes(secret), false, `secret leaked: ${secret}`);
  }
  assert.equal(vm.command, SWAP_COMMAND);
});

// ---- Frozen / non-mutating ------------------------------------------------

test("the returned view model is deeply frozen", () => {
  const vm = buildPairProposalViewModel(SWAP_COMMAND, SWAP_LABELS);
  assert.ok(vm);
  assert.equal(Object.isFrozen(vm), true);
  assert.equal(Object.isFrozen(vm.before), true);
  assert.equal(Object.isFrozen(vm.after), true);
  assert.equal(Object.isFrozen(vm.before.rows), true);
  assert.equal(Object.isFrozen(vm.before.rows[0]), true);
  assert.equal(Object.isFrozen(vm.notes), true);
});

test("labels are only read (not mutated)", () => {
  const labels: PairProposalDisplayLabels = { ...SWAP_LABELS };
  const before = JSON.stringify(labels);
  buildPairProposalViewModel(SWAP_COMMAND, labels);
  assert.equal(JSON.stringify(labels), before);
});
