// Pure unit tests for the whole-pair selection decision (Stage 3D.1). Run:
//   npx tsx --test lib/riding-complex-schedule-board/pair-selection-decision.test.ts
//
// Pure and DB-free: no Prisma, server actions, React, network, clock, or random.
// Fixed literals per test so command shapes, same-station suppression, cross-block
// behaviour, and fail-closed ordering can be asserted precisely.

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPairPlacementIndex,
  type PairPlacementPlanInput,
} from "./pair-placement-index";
import {
  decidePairSelection,
  type PairSelectionDestination,
  type PairSelectionQuery,
} from "./pair-selection-decision";

const VERSION = 7;

// b1: s1 holds p1, p2; s2 holds p3 (empty station s2e too). b2: s4 holds p4.
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
      {
        id: "b2",
        stations: [{ id: "s4", pairs: [{ id: "p4" }] }],
      },
    ],
  };
}

function query(
  plan: PairPlacementPlanInput,
  sourcePairId: string,
  destination: PairSelectionDestination,
  expectedVersion = VERSION
): PairSelectionQuery {
  return { index: buildPairPlacementIndex(plan), sourcePairId, destination, expectedVersion };
}

// ---- MOVE (station destination) -------------------------------------------

test("move to a different station in the SAME block -> MOVE_PAIR_PROPOSAL", () => {
  const decision = decidePairSelection(query(basePlan(), "p1", { kind: "station", stationId: "s2" }));
  assert.deepEqual(decision, {
    kind: "MOVE_PAIR_PROPOSAL",
    command: { op: "MOVE_PAIR", expectedVersion: VERSION, sourcePairId: "p1", destinationStationId: "s2" },
  });
});

test("move CROSS-BLOCK -> MOVE_PAIR_PROPOSAL with the same command shape (no block id)", () => {
  const decision = decidePairSelection(query(basePlan(), "p1", { kind: "station", stationId: "s4" }));
  assert.equal(decision.kind, "MOVE_PAIR_PROPOSAL");
  if (decision.kind === "MOVE_PAIR_PROPOSAL") {
    assert.deepEqual(Object.keys(decision.command).sort(), [
      "destinationStationId",
      "expectedVersion",
      "op",
      "sourcePairId",
    ]);
    assert.equal(decision.command.destinationStationId, "s4");
    // No block id in the command - Stage 3A resolves placement authoritatively.
    assert.equal("blockId" in decision.command, false);
  }
});

test("move into an EMPTY station is allowed -> MOVE_PAIR_PROPOSAL", () => {
  const decision = decidePairSelection(query(basePlan(), "p1", { kind: "station", stationId: "s2e" }));
  assert.equal(decision.kind, "MOVE_PAIR_PROPOSAL");
});

test("moving the ONLY pair out of its source station is allowed", () => {
  const decision = decidePairSelection(query(basePlan(), "p3", { kind: "station", stationId: "s1" }));
  assert.deepEqual(decision, {
    kind: "MOVE_PAIR_PROPOSAL",
    command: { op: "MOVE_PAIR", expectedVersion: VERSION, sourcePairId: "p3", destinationStationId: "s1" },
  });
});

test("same-station move -> SAME_STATION, no command", () => {
  const decision = decidePairSelection(query(basePlan(), "p1", { kind: "station", stationId: "s1" }));
  assert.deepEqual(decision, { kind: "SAME_STATION" });
  assert.equal("command" in decision, false);
});

// ---- SWAP (pair destination) ----------------------------------------------

test("swap with a pair in a DIFFERENT station of the same block -> SWAP_PAIRS_PROPOSAL", () => {
  const decision = decidePairSelection(query(basePlan(), "p1", { kind: "pair", pairId: "p3" }));
  assert.deepEqual(decision, {
    kind: "SWAP_PAIRS_PROPOSAL",
    command: { op: "SWAP_PAIRS", expectedVersion: VERSION, aPairId: "p1", bPairId: "p3" },
  });
});

test("swap CROSS-BLOCK -> SWAP_PAIRS_PROPOSAL with the same command shape (no block id)", () => {
  const decision = decidePairSelection(query(basePlan(), "p1", { kind: "pair", pairId: "p4" }));
  assert.equal(decision.kind, "SWAP_PAIRS_PROPOSAL");
  if (decision.kind === "SWAP_PAIRS_PROPOSAL") {
    assert.deepEqual(Object.keys(decision.command).sort(), ["aPairId", "bPairId", "expectedVersion", "op"]);
    assert.equal(decision.command.aPairId, "p1");
    assert.equal(decision.command.bPairId, "p4");
    assert.equal("blockId" in decision.command, false);
  }
});

test("same-station swap -> SAME_STATION, no command", () => {
  // p1 and p2 are both in s1.
  const decision = decidePairSelection(query(basePlan(), "p1", { kind: "pair", pairId: "p2" }));
  assert.deepEqual(decision, { kind: "SAME_STATION" });
  assert.equal("command" in decision, false);
});

test("same-pair selection -> NO_CHANGE, no command", () => {
  const decision = decidePairSelection(query(basePlan(), "p1", { kind: "pair", pairId: "p1" }));
  assert.deepEqual(decision, { kind: "NO_CHANGE" });
  assert.equal("command" in decision, false);
});

// ---- STALE / AMBIGUOUS ----------------------------------------------------

test("a stale (vanished) source pair -> STALE_TARGET", () => {
  const decision = decidePairSelection(query(basePlan(), "ghost", { kind: "station", stationId: "s2" }));
  assert.deepEqual(decision, { kind: "STALE_TARGET" });
});

test("a stale destination station -> STALE_TARGET", () => {
  const decision = decidePairSelection(query(basePlan(), "p1", { kind: "station", stationId: "ghost" }));
  assert.deepEqual(decision, { kind: "STALE_TARGET" });
});

test("a stale destination pair -> STALE_TARGET", () => {
  const decision = decidePairSelection(query(basePlan(), "p1", { kind: "pair", pairId: "ghost" }));
  assert.deepEqual(decision, { kind: "STALE_TARGET" });
});

test("an ambiguous SOURCE pair (duplicate id) -> AMBIGUOUS", () => {
  const plan: PairPlacementPlanInput = {
    blocks: [
      {
        id: "b1",
        stations: [
          { id: "s1", pairs: [{ id: "dup" }] },
          { id: "s2", pairs: [{ id: "dup" }, { id: "p3" }] },
        ],
      },
    ],
  };
  const decision = decidePairSelection(query(plan, "dup", { kind: "station", stationId: "s2" }));
  assert.deepEqual(decision, { kind: "AMBIGUOUS" });
});

test("an ambiguous destination STATION (duplicate id) -> AMBIGUOUS", () => {
  const plan: PairPlacementPlanInput = {
    blocks: [
      { id: "b1", stations: [{ id: "src", pairs: [{ id: "p1" }] }] },
      { id: "b2", stations: [{ id: "dupStation", pairs: [{ id: "p2" }] }] },
      { id: "b3", stations: [{ id: "dupStation", pairs: [{ id: "p3" }] }] },
    ],
  };
  const decision = decidePairSelection(query(plan, "p1", { kind: "station", stationId: "dupStation" }));
  assert.deepEqual(decision, { kind: "AMBIGUOUS" });
});

test("an ambiguous destination PAIR (duplicate id) -> AMBIGUOUS", () => {
  const plan: PairPlacementPlanInput = {
    blocks: [
      { id: "b1", stations: [{ id: "s1", pairs: [{ id: "p1" }] }] },
      { id: "b2", stations: [{ id: "s2", pairs: [{ id: "dup" }] }] },
      { id: "b3", stations: [{ id: "s3", pairs: [{ id: "dup" }] }] },
    ],
  };
  const decision = decidePairSelection(query(plan, "p1", { kind: "pair", pairId: "dup" }));
  assert.deepEqual(decision, { kind: "AMBIGUOUS" });
});

test("a SOURCE pair under a duplicated station id -> AMBIGUOUS, no command", () => {
  // dupStation appears under two blocks; p1 sits under the first occurrence. Its
  // station/time context is ambiguous, so the whole choice fails closed - even with
  // a perfectly valid unique destination station.
  const plan: PairPlacementPlanInput = {
    blocks: [
      { id: "b1", stations: [{ id: "dupStation", pairs: [{ id: "p1" }] }] },
      { id: "b2", stations: [{ id: "dupStation", pairs: [{ id: "p2" }] }] },
      { id: "b3", stations: [{ id: "dest", pairs: [] }] },
    ],
  };
  const decision = decidePairSelection(query(plan, "p1", { kind: "station", stationId: "dest" }));
  assert.deepEqual(decision, { kind: "AMBIGUOUS" });
  assert.equal("command" in decision, false);
});

test("two pairs under different rows sharing one station id -> AMBIGUOUS, never a false SAME_STATION swap", () => {
  // p1 and p2 live in two PHYSICALLY DIFFERENT station rows that happen to share the
  // id "dupStation". A naive same-station compare would read them as co-located and
  // emit SAME_STATION (or, worse, a SWAP_PAIRS command); poisoning both pairs to
  // AMBIGUOUS forecloses that guess before any command is constructed.
  const plan: PairPlacementPlanInput = {
    blocks: [
      { id: "b1", stations: [{ id: "dupStation", pairs: [{ id: "p1" }] }] },
      { id: "b2", stations: [{ id: "dupStation", pairs: [{ id: "p2" }] }] },
    ],
  };
  const decision = decidePairSelection(query(plan, "p1", { kind: "pair", pairId: "p2" }));
  assert.deepEqual(decision, { kind: "AMBIGUOUS" });
  assert.notEqual(decision.kind, "SAME_STATION");
  assert.notEqual(decision.kind, "SWAP_PAIRS_PROPOSAL");
  assert.equal("command" in decision, false);
});

// ---- Malformed input ------------------------------------------------------

test("malformed input / version -> UNAVAILABLE(UNRESOLVED), never throws", () => {
  const index = buildPairPlacementIndex(basePlan());
  const badQueries: unknown[] = [
    null,
    undefined,
    42,
    {},
    { index, sourcePairId: "p1", destination: { kind: "station", stationId: "s2" } }, // missing version
    { index, sourcePairId: "p1", destination: { kind: "station", stationId: "s2" }, expectedVersion: 1.5 },
    { index, sourcePairId: "", destination: { kind: "station", stationId: "s2" }, expectedVersion: VERSION },
    { index, sourcePairId: "p1", destination: null, expectedVersion: VERSION },
    { index, sourcePairId: "p1", destination: { kind: "station" }, expectedVersion: VERSION }, // no stationId
    { index, sourcePairId: "p1", destination: { kind: "pair" }, expectedVersion: VERSION }, // no pairId
    { index, sourcePairId: "p1", destination: { kind: "bogus", stationId: "s2" }, expectedVersion: VERSION },
    { index: {}, sourcePairId: "p1", destination: { kind: "station", stationId: "s2" }, expectedVersion: VERSION },
  ];
  for (const bad of badQueries) {
    assert.doesNotThrow(() => {
      const decision = decidePairSelection(bad as PairSelectionQuery);
      assert.deepEqual(decision, { kind: "UNAVAILABLE", reason: "UNRESOLVED" });
    });
  }
});

// ---- Command shape / version fidelity -------------------------------------

test("commands thread the EXACT expectedVersion and carry no pair contents or block ids", () => {
  const move = decidePairSelection(query(basePlan(), "p1", { kind: "station", stationId: "s4" }, 99));
  assert.equal(move.kind, "MOVE_PAIR_PROPOSAL");
  if (move.kind === "MOVE_PAIR_PROPOSAL") {
    assert.equal(move.command.expectedVersion, 99);
    assert.deepEqual(Object.keys(move.command).sort(), [
      "destinationStationId",
      "expectedVersion",
      "op",
      "sourcePairId",
    ]);
  }
  const swap = decidePairSelection(query(basePlan(), "p1", { kind: "pair", pairId: "p4" }, 99));
  assert.equal(swap.kind, "SWAP_PAIRS_PROPOSAL");
  if (swap.kind === "SWAP_PAIRS_PROPOSAL") {
    assert.equal(swap.command.expectedVersion, 99);
    assert.deepEqual(Object.keys(swap.command).sort(), ["aPairId", "bPairId", "expectedVersion", "op"]);
  }
});

test("decisions and their commands are frozen (non-mutating)", () => {
  const move = decidePairSelection(query(basePlan(), "p1", { kind: "station", stationId: "s2" }));
  assert.equal(Object.isFrozen(move), true);
  if (move.kind === "MOVE_PAIR_PROPOSAL") assert.equal(Object.isFrozen(move.command), true);
  const swap = decidePairSelection(query(basePlan(), "p1", { kind: "pair", pairId: "p3" }));
  assert.equal(Object.isFrozen(swap), true);
  if (swap.kind === "SWAP_PAIRS_PROPOSAL") assert.equal(Object.isFrozen(swap.command), true);
  const noChange = decidePairSelection(query(basePlan(), "p1", { kind: "pair", pairId: "p1" }));
  assert.equal(Object.isFrozen(noChange), true);
});

test("the query is only read (not mutated)", () => {
  const q = query(basePlan(), "p1", { kind: "station", stationId: "s2" });
  const before = JSON.stringify({ sourcePairId: q.sourcePairId, destination: q.destination, expectedVersion: q.expectedVersion });
  decidePairSelection(q);
  const after = JSON.stringify({ sourcePairId: q.sourcePairId, destination: q.destination, expectedVersion: q.expectedVersion });
  assert.equal(after, before);
});
