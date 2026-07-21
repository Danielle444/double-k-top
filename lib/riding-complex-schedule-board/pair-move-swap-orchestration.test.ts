// Pure unit tests for the whole-pair Move/Swap UI orchestration (Stage 3D.2). Run:
//   npx tsx --test lib/riding-complex-schedule-board/pair-move-swap-orchestration.test.ts
//
// Pure and DB-free: no Prisma, server actions, React, network, clock, or random.
// Proves the orchestration composes the committed Stage 3D.1 cores correctly:
// every rejected/suppressed decision yields NO proposal input and NO command, the
// exact committed command flows through unchanged, the derived labels reuse only
// caller-supplied visible names (never an id, never a note), the time-change cue is
// STRUCTURAL (block identity, not a time-string compare), and the built view model
// leaks no id/version/op/note into any display string.
//
// These are PURE data tests. They do NOT prove any React interaction behaviour
// (source selection, target highlighting, modal wiring) - that is verified
// manually in the implementation report, per the repo's lack of a TSX test stack.

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPairPlacementIndex,
  type PairPlacementIndex,
  type PairPlacementPlanInput,
} from "./pair-placement-index";
import {
  decidePairSelection,
  type PairSelectionDestination,
} from "./pair-selection-decision";
import {
  buildPairProposalViewModel,
  type PairProposalViewModel,
} from "./pair-proposal-view-model";
import {
  buildPairMoveSwapProposalLabels,
  pairDecisionToProposalInput,
  type PairMoveSwapLabelInputs,
} from "./pair-move-swap-orchestration";

const VERSION = 7;

// b1 (08:00-08:45): s1 [p1, p2], s2 [p3], s2e (empty).
// b2 (09:00-09:45): s4 [p4].
// b3 (08:00-08:45): s5 [p5]  <- SAME displayed time as b1 but a DIFFERENT block.
function basePlan(): PairPlacementPlanInput {
  return {
    blocks: [
      {
        id: "b1",
        stations: [
          { id: "s1", pairs: [{ id: "p1" }, { id: "p2" }] },
          { id: "s2", pairs: [{ id: "p3" }] },
          { id: "s2e", pairs: [] },
        ],
      },
      { id: "b2", stations: [{ id: "s4", pairs: [{ id: "p4" }] }] },
      { id: "b3", stations: [{ id: "s5", pairs: [{ id: "p5" }] }] },
    ],
  };
}

// Already-visible display maps (keyed by the SAME structural ids). Distinct,
// human-visible strings so a leak of any raw id is unambiguous. p3/p5 have no horse.
const PAIR_LABELS = new Map<string, string>([
  ["p1", "דנה + יעל"],
  ["p2", "נועה + תמר"],
  ["p3", "מאיה"],
  ["p4", "רוני + עדן"],
  ["p5", "קרן"],
]);
const STATION_LABELS = new Map<string, string>([
  ["s1", "רון · מגרש הרכיבה"],
  ["s2", "שיר · מגרש הקפיצות"],
  ["s2e", "גיל · מגרש הלונג'"],
  ["s4", "טל · מגרש חיצוני"],
  ["s5", "אורי · מגרש מקורה"],
]);
const BLOCK_TIME_LABELS = new Map<string, string>([
  ["b1", "08:00–08:45"],
  ["b2", "09:00–09:45"],
  ["b3", "08:00–08:45"],
]);
const PAIR_HORSE_LABELS = new Map<string, string>([
  ["p1", "ברק"],
  ["p2", "כוכב"],
  ["p4", "רעם"],
]);

function labelInputs(index: PairPlacementIndex): PairMoveSwapLabelInputs {
  return {
    index,
    pairLabels: PAIR_LABELS,
    stationLabels: STATION_LABELS,
    blockTimeLabels: BLOCK_TIME_LABELS,
    pairHorseLabels: PAIR_HORSE_LABELS,
  };
}

// Every internal id that must never surface in a command or a display string.
const FORBIDDEN_IDS = [
  "b1", "b2", "b3", "s1", "s2", "s2e", "s4", "s5",
  "p1", "p2", "p3", "p4", "p5",
];

/** Recursively collect every string inside the view model EXCEPT the non-display
 *  `command` carrier. */
function allDisplayStrings(vm: PairProposalViewModel): string[] {
  const out: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === "string") out.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk({ ...vm, command: undefined });
  return out;
}

function assertNoIds(strings: string[]): void {
  const joined = strings.join("§");
  for (const id of FORBIDDEN_IDS) {
    assert.equal(joined.includes(id), false, `a display string leaked id "${id}"`);
  }
}

/** Drive a decision through the core exactly as the editor does. */
function decide(plan: PairPlacementPlanInput, sourcePairId: string, destination: PairSelectionDestination) {
  const index = buildPairPlacementIndex(plan);
  return { index, decision: decidePairSelection({ index, sourcePairId, destination, expectedVersion: VERSION }) };
}

// ===========================================================================
// (1) Valid MOVE
// ===========================================================================

test("MOVE: different station, same block -> proposal input + same-time labels, no notice", () => {
  const { index, decision } = decide(basePlan(), "p1", { kind: "station", stationId: "s2" });
  assert.equal(decision.kind, "MOVE_PAIR_PROPOSAL");
  const proposal = pairDecisionToProposalInput(decision);
  assert.ok(proposal && proposal.kind === "pair-move");
  const labels = buildPairMoveSwapProposalLabels(decision.kind === "MOVE_PAIR_PROPOSAL" ? decision.command : (null as never), labelInputs(index));
  assert.ok(labels);
  assert.equal(labels.timeChanged, false);
  const vm = buildPairProposalViewModel(proposal, labels);
  assert.ok(vm);
  assert.equal(vm.title, "העברת זוג");
  assert.deepEqual(vm.before.rows[0], {
    pairLabel: "דנה + יעל",
    stationLabel: "רון · מגרש הרכיבה",
    timeLabel: "08:00–08:45",
    horseLabel: "ברק",
  });
  assert.deepEqual(vm.after.rows[0], {
    pairLabel: "דנה + יעל",
    stationLabel: "שיר · מגרש הקפיצות",
    timeLabel: "08:00–08:45",
    horseLabel: "ברק",
  });
  assert.equal(vm.timeChangeNotice, null);
  assertNoIds(allDisplayStrings(vm));
});

test("MOVE: cross-block -> timeChanged true + prominent move time notice", () => {
  const { index, decision } = decide(basePlan(), "p1", { kind: "station", stationId: "s4" });
  assert.equal(decision.kind, "MOVE_PAIR_PROPOSAL");
  assert.ok(decision.kind === "MOVE_PAIR_PROPOSAL");
  const labels = buildPairMoveSwapProposalLabels(decision.command, labelInputs(index));
  assert.ok(labels);
  assert.equal(labels.timeChanged, true);
  const vm = buildPairProposalViewModel({ kind: "pair-move", command: decision.command }, labels);
  assert.equal(vm?.timeChangeNotice, "שימו לב: הזוג עובר לטווח זמן אחר.");
  assert.equal(vm?.after.rows[0].timeLabel, "09:00–09:45");
});

test("MOVE: into an EMPTY destination station is allowed", () => {
  const { index, decision } = decide(basePlan(), "p1", { kind: "station", stationId: "s2e" });
  assert.ok(decision.kind === "MOVE_PAIR_PROPOSAL");
  const labels = buildPairMoveSwapProposalLabels(decision.command, labelInputs(index));
  const vm = buildPairProposalViewModel({ kind: "pair-move", command: decision.command }, labels!);
  assert.equal(vm?.after.rows[0].stationLabel, "גיל · מגרש הלונג'");
});

test("MOVE: moving the ONLY pair out of its source station is allowed", () => {
  const { index, decision } = decide(basePlan(), "p3", { kind: "station", stationId: "s1" });
  assert.ok(decision.kind === "MOVE_PAIR_PROPOSAL");
  const labels = buildPairMoveSwapProposalLabels(decision.command, labelInputs(index));
  assert.ok(labels);
  assert.equal(labels.sourceStationLabel, "שיר · מגרש הקפיצות");
  assert.equal(labels.destinationStationLabel, "רון · מגרש הרכיבה");
  // p3 has no horse -> no horse line in the move rows.
  const vm = buildPairProposalViewModel({ kind: "pair-move", command: decision.command }, labels);
  assert.equal(vm?.before.rows[0].horseLabel, null);
  assert.equal(vm?.after.rows[0].horseLabel, null);
});

// ===========================================================================
// (2) Valid SWAP
// ===========================================================================

test("SWAP: pairs in different stations, same block -> reversed after rows, no notice", () => {
  const { index, decision } = decide(basePlan(), "p1", { kind: "pair", pairId: "p3" });
  assert.equal(decision.kind, "SWAP_PAIRS_PROPOSAL");
  assert.ok(decision.kind === "SWAP_PAIRS_PROPOSAL");
  const proposal = pairDecisionToProposalInput(decision);
  assert.ok(proposal && proposal.kind === "pair-swap");
  const labels = buildPairMoveSwapProposalLabels(decision.command, labelInputs(index));
  assert.ok(labels);
  assert.equal(labels.timeChanged, false);
  const vm = buildPairProposalViewModel(proposal, labels);
  assert.ok(vm);
  assert.equal(vm.title, "החלפת זוגות");
  // Before: A at source, B at destination.
  assert.deepEqual(vm.before.rows, [
    { pairLabel: "דנה + יעל", stationLabel: "רון · מגרש הרכיבה", timeLabel: "08:00–08:45", horseLabel: "ברק" },
    { pairLabel: "מאיה", stationLabel: "שיר · מגרש הקפיצות", timeLabel: "08:00–08:45", horseLabel: null },
  ]);
  // After: A at destination, B at source (contexts reversed; pair+horse travel).
  assert.deepEqual(vm.after.rows, [
    { pairLabel: "דנה + יעל", stationLabel: "שיר · מגרש הקפיצות", timeLabel: "08:00–08:45", horseLabel: "ברק" },
    { pairLabel: "מאיה", stationLabel: "רון · מגרש הרכיבה", timeLabel: "08:00–08:45", horseLabel: null },
  ]);
  assert.equal(vm.timeChangeNotice, null);
  assertNoIds(allDisplayStrings(vm));
});

test("SWAP: cross-block -> timeChanged true + swap-specific time notice", () => {
  const { index, decision } = decide(basePlan(), "p1", { kind: "pair", pairId: "p4" });
  assert.ok(decision.kind === "SWAP_PAIRS_PROPOSAL");
  const labels = buildPairMoveSwapProposalLabels(decision.command, labelInputs(index));
  assert.ok(labels);
  assert.equal(labels.timeChanged, true);
  const vm = buildPairProposalViewModel({ kind: "pair-swap", command: decision.command }, labels);
  assert.equal(vm?.timeChangeNotice, "שימו לב: הזוגות מחליפים גם את טווחי הזמן.");
  assert.equal(vm?.after.rows[1].horseLabel, "רעם"); // p4's horse stays with p4.
});

// ===========================================================================
// (3) Rejected / suppressed decisions -> NO proposal input, NO command
// ===========================================================================

test("same pair -> NO_CHANGE, no proposal input", () => {
  const { decision } = decide(basePlan(), "p1", { kind: "pair", pairId: "p1" });
  assert.equal(decision.kind, "NO_CHANGE");
  assert.equal(pairDecisionToProposalInput(decision), null);
});

test("same-station MOVE -> SAME_STATION, no proposal input", () => {
  const { decision } = decide(basePlan(), "p1", { kind: "station", stationId: "s1" });
  assert.equal(decision.kind, "SAME_STATION");
  assert.equal(pairDecisionToProposalInput(decision), null);
});

test("same-station SWAP -> SAME_STATION, no proposal input", () => {
  const { decision } = decide(basePlan(), "p1", { kind: "pair", pairId: "p2" });
  assert.equal(decision.kind, "SAME_STATION");
  assert.equal(pairDecisionToProposalInput(decision), null);
});

test("a duplicated station poisons its nested pairs -> AMBIGUOUS, no proposal input", () => {
  const plan: PairPlacementPlanInput = {
    blocks: [
      { id: "b1", stations: [{ id: "dupStation", pairs: [{ id: "p1" }] }] },
      { id: "b2", stations: [{ id: "dupStation", pairs: [{ id: "p2" }] }] },
      { id: "b3", stations: [{ id: "dest", pairs: [] }] },
    ],
  };
  const { decision } = decide(plan, "p1", { kind: "station", stationId: "dest" });
  assert.equal(decision.kind, "AMBIGUOUS");
  assert.equal(pairDecisionToProposalInput(decision), null);
});

test("a duplicated destination pair -> AMBIGUOUS, no proposal input", () => {
  const plan: PairPlacementPlanInput = {
    blocks: [
      { id: "b1", stations: [{ id: "s1", pairs: [{ id: "p1" }] }] },
      { id: "b2", stations: [{ id: "s2", pairs: [{ id: "dup" }] }] },
      { id: "b3", stations: [{ id: "s3", pairs: [{ id: "dup" }] }] },
    ],
  };
  const { decision } = decide(plan, "p1", { kind: "pair", pairId: "dup" });
  assert.equal(decision.kind, "AMBIGUOUS");
  assert.equal(pairDecisionToProposalInput(decision), null);
});

test("a stale destination station -> STALE_TARGET, no proposal input", () => {
  const { decision } = decide(basePlan(), "p1", { kind: "station", stationId: "ghost" });
  assert.equal(decision.kind, "STALE_TARGET");
  assert.equal(pairDecisionToProposalInput(decision), null);
});

test("a stale destination pair -> STALE_TARGET, no proposal input", () => {
  const { decision } = decide(basePlan(), "p1", { kind: "pair", pairId: "ghost" });
  assert.equal(decision.kind, "STALE_TARGET");
  assert.equal(pairDecisionToProposalInput(decision), null);
});

test("malformed input -> UNAVAILABLE, no proposal input", () => {
  const index = buildPairPlacementIndex(basePlan());
  const decision = decidePairSelection({
    index,
    sourcePairId: "",
    destination: { kind: "station", stationId: "s2" },
    expectedVersion: VERSION,
  });
  assert.equal(decision.kind, "UNAVAILABLE");
  assert.equal(pairDecisionToProposalInput(decision), null);
});

test("no rejected decision ever yields a proposal input", () => {
  const rejects = [
    decide(basePlan(), "p1", { kind: "pair", pairId: "p1" }).decision, // NO_CHANGE
    decide(basePlan(), "p1", { kind: "station", stationId: "s1" }).decision, // SAME_STATION
    decide(basePlan(), "p1", { kind: "pair", pairId: "p2" }).decision, // SAME_STATION
    decide(basePlan(), "p1", { kind: "station", stationId: "ghost" }).decision, // STALE
    decide(basePlan(), "p1", { kind: "pair", pairId: "ghost" }).decision, // STALE
  ];
  for (const decision of rejects) {
    const proposal = pairDecisionToProposalInput(decision);
    assert.equal(proposal, null);
    // and it carries no command field of its own.
    assert.equal("command" in decision, false);
  }
});

// ===========================================================================
// (4) Exact command shapes flow through UNCHANGED
// ===========================================================================

test("MOVE_PAIR command has exactly its 4 keys, exact version, and passes through unchanged", () => {
  const { decision } = decide(basePlan(), "p1", { kind: "station", stationId: "s4" });
  assert.ok(decision.kind === "MOVE_PAIR_PROPOSAL");
  const proposal = pairDecisionToProposalInput(decision);
  assert.ok(proposal && proposal.kind === "pair-move");
  assert.deepEqual(Object.keys(proposal.command).sort(), [
    "destinationStationId",
    "expectedVersion",
    "op",
    "sourcePairId",
  ]);
  assert.equal(proposal.command.expectedVersion, VERSION);
  assert.equal(proposal.command.op, "MOVE_PAIR");
  assert.equal(proposal.command.sourcePairId, "p1");
  assert.equal(proposal.command.destinationStationId, "s4");
  // The exact committed object flows through - same reference, not a copy.
  assert.equal(proposal.command, decision.command);
});

test("SWAP_PAIRS command has exactly its 4 keys, exact version, and passes through unchanged", () => {
  const { decision } = decide(basePlan(), "p1", { kind: "pair", pairId: "p4" });
  assert.ok(decision.kind === "SWAP_PAIRS_PROPOSAL");
  const proposal = pairDecisionToProposalInput(decision);
  assert.ok(proposal && proposal.kind === "pair-swap");
  assert.deepEqual(Object.keys(proposal.command).sort(), ["aPairId", "bPairId", "expectedVersion", "op"]);
  assert.equal(proposal.command.expectedVersion, VERSION);
  assert.equal(proposal.command.aPairId, "p1");
  assert.equal(proposal.command.bPairId, "p4");
  assert.equal(proposal.command, decision.command);
});

// ===========================================================================
// (5) Label derivation fails CLOSED and never leaks ids/notes
// ===========================================================================

test("labels fail closed to null when the source pair no longer resolves", () => {
  const index = buildPairPlacementIndex(basePlan());
  const labels = buildPairMoveSwapProposalLabels(
    { op: "MOVE_PAIR", expectedVersion: VERSION, sourcePairId: "ghost", destinationStationId: "s2" },
    labelInputs(index)
  );
  assert.equal(labels, null);
});

test("labels fail closed to null when the destination station no longer resolves", () => {
  const index = buildPairPlacementIndex(basePlan());
  const labels = buildPairMoveSwapProposalLabels(
    { op: "MOVE_PAIR", expectedVersion: VERSION, sourcePairId: "p1", destinationStationId: "ghost" },
    labelInputs(index)
  );
  assert.equal(labels, null);
});

test("labels fail closed to null when a swap endpoint is ambiguous", () => {
  const plan: PairPlacementPlanInput = {
    blocks: [
      { id: "b1", stations: [{ id: "s1", pairs: [{ id: "p1" }] }] },
      { id: "b2", stations: [{ id: "s2", pairs: [{ id: "dup" }] }] },
      { id: "b3", stations: [{ id: "s3", pairs: [{ id: "dup" }] }] },
    ],
  };
  const index = buildPairPlacementIndex(plan);
  const labels = buildPairMoveSwapProposalLabels(
    { op: "SWAP_PAIRS", expectedVersion: VERSION, aPairId: "p1", bPairId: "dup" },
    { index, pairLabels: PAIR_LABELS, stationLabels: STATION_LABELS, blockTimeLabels: BLOCK_TIME_LABELS, pairHorseLabels: PAIR_HORSE_LABELS }
  );
  assert.equal(labels, null);
});

test("a missing label falls back to null (no id substituted)", () => {
  const index = buildPairPlacementIndex(basePlan());
  // Empty maps: every lookup misses, so every label is null (never a raw id).
  const labels = buildPairMoveSwapProposalLabels(
    { op: "MOVE_PAIR", expectedVersion: VERSION, sourcePairId: "p1", destinationStationId: "s2" },
    { index, pairLabels: new Map(), stationLabels: new Map(), blockTimeLabels: new Map(), pairHorseLabels: new Map() }
  );
  assert.ok(labels);
  assert.equal(labels.sourcePairLabel, null);
  assert.equal(labels.sourceStationLabel, null);
  assert.equal(labels.destinationStationLabel, null);
  assert.equal(labels.sourceHorseLabel, null);
});

// ===========================================================================
// (6) Time cue is STRUCTURAL (block identity), not a time-string compare
// ===========================================================================

test("same block -> timeChanged false", () => {
  const index = buildPairPlacementIndex(basePlan());
  const labels = buildPairMoveSwapProposalLabels(
    { op: "MOVE_PAIR", expectedVersion: VERSION, sourcePairId: "p1", destinationStationId: "s2" },
    labelInputs(index)
  );
  assert.equal(labels?.timeChanged, false);
});

test("different block -> timeChanged true", () => {
  const index = buildPairPlacementIndex(basePlan());
  const labels = buildPairMoveSwapProposalLabels(
    { op: "MOVE_PAIR", expectedVersion: VERSION, sourcePairId: "p1", destinationStationId: "s4" },
    labelInputs(index)
  );
  assert.equal(labels?.timeChanged, true);
});

test("different blocks with IDENTICAL displayed time strings still -> timeChanged true", () => {
  // b1 and b3 both render "08:00–08:45"; a move p1(b1) -> s5(b3) crosses blocks.
  const index = buildPairPlacementIndex(basePlan());
  const labels = buildPairMoveSwapProposalLabels(
    { op: "MOVE_PAIR", expectedVersion: VERSION, sourcePairId: "p1", destinationStationId: "s5" },
    labelInputs(index)
  );
  assert.ok(labels);
  // The two time labels are textually identical...
  assert.equal(labels.sourceTimeLabel, "08:00–08:45");
  assert.equal(labels.destinationTimeLabel, "08:00–08:45");
  // ...yet the cross-block cue is still raised.
  assert.equal(labels.timeChanged, true);
  const vm = buildPairProposalViewModel(
    { kind: "pair-move", command: { op: "MOVE_PAIR", expectedVersion: VERSION, sourcePairId: "p1", destinationStationId: "s5" } },
    labels
  );
  assert.notEqual(vm?.timeChangeNotice, null);
});

test("timeChangeNotice exists only when timeChanged is true", () => {
  const index = buildPairPlacementIndex(basePlan());
  const same = buildPairMoveSwapProposalLabels(
    { op: "MOVE_PAIR", expectedVersion: VERSION, sourcePairId: "p1", destinationStationId: "s2" },
    labelInputs(index)
  )!;
  const cross = buildPairMoveSwapProposalLabels(
    { op: "MOVE_PAIR", expectedVersion: VERSION, sourcePairId: "p1", destinationStationId: "s4" },
    labelInputs(index)
  )!;
  const cmd = (destinationStationId: string) => ({ op: "MOVE_PAIR" as const, expectedVersion: VERSION, sourcePairId: "p1", destinationStationId });
  assert.equal(buildPairProposalViewModel({ kind: "pair-move", command: cmd("s2") }, same)?.timeChangeNotice, null);
  assert.notEqual(buildPairProposalViewModel({ kind: "pair-move", command: cmd("s4") }, cross)?.timeChangeNotice, null);
});

// ===========================================================================
// (7) Proposal view model: notes, no leakage, command separate, no mutation
// ===========================================================================

test("view model carries the stable whole-pair + stationary coach/arena notes", () => {
  const index = buildPairPlacementIndex(basePlan());
  const moveLabels = buildPairMoveSwapProposalLabels(
    { op: "MOVE_PAIR", expectedVersion: VERSION, sourcePairId: "p1", destinationStationId: "s2" },
    labelInputs(index)
  )!;
  const moveVm = buildPairProposalViewModel(
    { kind: "pair-move", command: { op: "MOVE_PAIR", expectedVersion: VERSION, sourcePairId: "p1", destinationStationId: "s2" } },
    moveLabels
  );
  assert.deepEqual(moveVm?.notes, ["החניכים, הסוס וההערה יעברו יחד.", "המאמן/ת והמגרש נשארים בתחנות."]);

  const swapLabels = buildPairMoveSwapProposalLabels(
    { op: "SWAP_PAIRS", expectedVersion: VERSION, aPairId: "p1", bPairId: "p3" },
    labelInputs(index)
  )!;
  const swapVm = buildPairProposalViewModel(
    { kind: "pair-swap", command: { op: "SWAP_PAIRS", expectedVersion: VERSION, aPairId: "p1", bPairId: "p3" } },
    swapLabels
  );
  assert.deepEqual(swapVm?.notes, ["הזוגות עוברים בשלמותם — החניכים, הסוס וההערה.", "המאמנים והמגרשים נשארים בתחנות."]);
});

test("no id/version/op/note leaks into the recursively collected display strings; command kept separate", () => {
  const { index, decision } = decide(basePlan(), "p1", { kind: "pair", pairId: "p4" });
  assert.ok(decision.kind === "SWAP_PAIRS_PROPOSAL");
  const proposal = pairDecisionToProposalInput(decision)!;
  const labels = buildPairMoveSwapProposalLabels(decision.command, labelInputs(index))!;
  const vm = buildPairProposalViewModel(proposal, labels)!;
  const strings = allDisplayStrings(vm).join("§");
  for (const secret of [...FORBIDDEN_IDS, "SWAP_PAIRS", "MOVE_PAIR", String(VERSION)]) {
    assert.equal(strings.includes(secret), false, `secret leaked into display: ${secret}`);
  }
  // The command survives ONLY in the non-display carrier, unchanged.
  assert.equal(vm.command, decision.command);
});

test("orchestration does not mutate its label-map inputs", () => {
  const index = buildPairPlacementIndex(basePlan());
  const before = JSON.stringify([...PAIR_LABELS], [...STATION_LABELS] as never);
  buildPairMoveSwapProposalLabels(
    { op: "MOVE_PAIR", expectedVersion: VERSION, sourcePairId: "p1", destinationStationId: "s2" },
    labelInputs(index)
  );
  assert.equal(PAIR_LABELS.size, 5);
  assert.equal(STATION_LABELS.size, 5);
  assert.equal(BLOCK_TIME_LABELS.size, 3);
  assert.equal(before, JSON.stringify([...PAIR_LABELS], [...STATION_LABELS] as never));
});
