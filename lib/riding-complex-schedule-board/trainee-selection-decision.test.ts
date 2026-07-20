// Pure unit tests for the trainee-selection decision core (Stage 3C.1). Run:
//   npx tsx --test lib/riding-complex-schedule-board/trainee-selection-decision.test.ts
//
// Pure and DB-free: no Prisma, server actions, React, network, clock, or random.

import test from "node:test";
import assert from "node:assert/strict";

import { buildTraineePlacementIndex, type PlacementPlanInput } from "./placement-index";
import { decideTraineeSelection, type TraineeSelectionQuery } from "./trainee-selection-decision";

// b1/s1: p1 (occ1 seat1, occ2 seat2), p2 (occ3 seat1, empty seat2), p3 (empty).
// b2/s2: p4 (occ1 seat1) - same occ1 in another block (must read as free in b1).
function basePlan(): PlacementPlanInput {
  return {
    blocks: [
      {
        id: "b1",
        stations: [
          {
            id: "s1",
            pairs: [
              { id: "p1", trainee1Id: "occ1", trainee2Id: "occ2" },
              { id: "p2", trainee1Id: "occ3", trainee2Id: null },
              { id: "p3", trainee1Id: null, trainee2Id: null },
            ],
          },
        ],
      },
      {
        id: "b2",
        stations: [{ id: "s2", pairs: [{ id: "p4", trainee1Id: "occ1", trainee2Id: null }] }],
      },
    ],
  };
}

function query(overrides: Partial<TraineeSelectionQuery>): TraineeSelectionQuery {
  return {
    index: buildTraineePlacementIndex(basePlan()),
    blockId: "b1",
    candidateTraineeId: "free1",
    destinationPairId: "p3",
    destinationSlot: 1,
    expectedVersion: 7,
    ...overrides,
  };
}

const snapshot = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

test("free candidate -> LOCAL_SELECTION", () => {
  const decision = decideTraineeSelection(query({ candidateTraineeId: "free1" }));
  assert.deepEqual(decision, { kind: "LOCAL_SELECTION", traineeId: "free1" });
});

test("occupied candidate + empty destination -> exact MOVE_TRAINEE command", () => {
  // occ3 sits in p2/seat1; destination p3/seat1 is empty -> MOVE.
  const decision = decideTraineeSelection(
    query({ candidateTraineeId: "occ3", destinationPairId: "p3", destinationSlot: 1 })
  );
  assert.deepEqual(decision, {
    kind: "MOVE_PROPOSAL",
    command: {
      op: "MOVE_TRAINEE",
      expectedVersion: 7,
      source: { pairId: "p2", slot: "trainee1" },
      destination: { pairId: "p3", slot: "trainee1" },
    },
  });
});

test("occupied candidate + occupied destination -> exact SWAP_TRAINEES command", () => {
  // occ3 sits in p2/seat1; destination p1/seat1 holds occ1 -> SWAP.
  const decision = decideTraineeSelection(
    query({ candidateTraineeId: "occ3", destinationPairId: "p1", destinationSlot: 1 })
  );
  assert.deepEqual(decision, {
    kind: "SWAP_PROPOSAL",
    command: {
      op: "SWAP_TRAINEES",
      expectedVersion: 7,
      a: { pairId: "p2", slot: "trainee1" },
      b: { pairId: "p1", slot: "trainee1" },
    },
  });
});

test("choosing the seat's current trainee -> NO_CHANGE (never a self-swap)", () => {
  const decision = decideTraineeSelection(
    query({ candidateTraineeId: "occ1", destinationPairId: "p1", destinationSlot: 1 })
  );
  assert.deepEqual(decision, { kind: "NO_CHANGE" });
});

test("a trainee already inside the destination pair -> NO_CHANGE (within-pair)", () => {
  // occ2 sits in p1/seat2; targeting p1/seat1 would be a useless within-pair move.
  const decision = decideTraineeSelection(
    query({ candidateTraineeId: "occ2", destinationPairId: "p1", destinationSlot: 1 })
  );
  assert.deepEqual(decision, { kind: "NO_CHANGE" });
});

test("occupied candidate in CREATE mode -> UNAVAILABLE / CREATE_MODE", () => {
  const decision = decideTraineeSelection(
    query({ candidateTraineeId: "occ3", destinationPairId: null })
  );
  assert.deepEqual(decision, { kind: "UNAVAILABLE", reason: "CREATE_MODE" });
});

test("free candidate in CREATE mode remains a local selection", () => {
  const decision = decideTraineeSelection(query({ candidateTraineeId: "free1", destinationPairId: null }));
  assert.deepEqual(decision, { kind: "LOCAL_SELECTION", traineeId: "free1" });
});

test("seat 2 while seat 1 is empty -> UNAVAILABLE / INVALID_PAIR_POSITION", () => {
  // p3 is empty; targeting seat 2 there leaves seat 1 empty -> invalid.
  const free = decideTraineeSelection(
    query({ candidateTraineeId: "free1", destinationPairId: "p3", destinationSlot: 2 })
  );
  assert.deepEqual(free, { kind: "UNAVAILABLE", reason: "INVALID_PAIR_POSITION" });
  // Also for an occupied candidate (never silently promoted to seat 1).
  const occupied = decideTraineeSelection(
    query({ candidateTraineeId: "occ3", destinationPairId: "p3", destinationSlot: 2 })
  );
  assert.deepEqual(occupied, { kind: "UNAVAILABLE", reason: "INVALID_PAIR_POSITION" });
});

test("free candidate into seat 2 of a pair whose seat 1 is filled -> LOCAL_SELECTION", () => {
  // p2 has seat1 = occ3; seat2 is empty -> a free trainee legitimately fills it.
  const decision = decideTraineeSelection(
    query({ candidateTraineeId: "free1", destinationPairId: "p2", destinationSlot: 2 })
  );
  assert.deepEqual(decision, { kind: "LOCAL_SELECTION", traineeId: "free1" });
});

test("ambiguous candidate (duplicated in block) -> AMBIGUOUS", () => {
  const plan: PlacementPlanInput = {
    blocks: [
      {
        id: "b1",
        stations: [
          {
            id: "s1",
            pairs: [
              { id: "p1", trainee1Id: "dup", trainee2Id: null },
              { id: "p2", trainee1Id: "dup", trainee2Id: null },
              { id: "p3", trainee1Id: null, trainee2Id: null },
            ],
          },
        ],
      },
    ],
  };
  const decision = decideTraineeSelection({
    index: buildTraineePlacementIndex(plan),
    blockId: "b1",
    candidateTraineeId: "dup",
    destinationPairId: "p3",
    destinationSlot: 1,
    expectedVersion: 1,
  });
  assert.deepEqual(decision, { kind: "AMBIGUOUS" });
});

test("stale/missing destination pair -> STALE_TARGET", () => {
  const gone = decideTraineeSelection(query({ candidateTraineeId: "occ3", destinationPairId: "ghost" }));
  assert.deepEqual(gone, { kind: "STALE_TARGET" });
  // A pair that exists only in another block is stale for this block too.
  const otherBlock = decideTraineeSelection(query({ candidateTraineeId: "occ3", destinationPairId: "p4" }));
  assert.deepEqual(otherBlock, { kind: "STALE_TARGET" });
});

// b1/s1 with a CORRUPT destination pair "corrupt" (non-string seat) alongside a
// normal occupied pair p2. The corrupt pair must never be an actionable target.
function corruptDestinationPlan(): PlacementPlanInput {
  return {
    blocks: [
      {
        id: "b1",
        stations: [
          {
            id: "s1",
            pairs: [
              { id: "p2", trainee1Id: "occ3", trainee2Id: null },
              { id: "corrupt", trainee1Id: 5 as unknown as string, trainee2Id: null },
            ],
          },
        ],
      },
    ],
  };
}

test("corrupt destination pair + occupied candidate cannot produce MOVE", () => {
  const decision = decideTraineeSelection({
    index: buildTraineePlacementIndex(corruptDestinationPlan()),
    blockId: "b1",
    candidateTraineeId: "occ3",
    destinationPairId: "corrupt",
    destinationSlot: 1,
    expectedVersion: 3,
  });
  assert.deepEqual(decision, { kind: "STALE_TARGET" });
  assert.ok(!("command" in decision), "no command on a corrupt-target result");
});

test("corrupt destination pair + free candidate cannot produce LOCAL_SELECTION", () => {
  const decision = decideTraineeSelection({
    index: buildTraineePlacementIndex(corruptDestinationPlan()),
    blockId: "b1",
    candidateTraineeId: "free1",
    destinationPairId: "corrupt",
    destinationSlot: 1,
    expectedVersion: 3,
  });
  assert.deepEqual(decision, { kind: "STALE_TARGET" });
  assert.ok(!("command" in decision), "no command on a corrupt-target result");
});

test("free candidate + missing destination pair -> STALE_TARGET", () => {
  const decision = decideTraineeSelection(query({ candidateTraineeId: "free1", destinationPairId: "ghost" }));
  assert.deepEqual(decision, { kind: "STALE_TARGET" });
  assert.ok(!("command" in decision));
});

test("AMBIGUOUS, UNAVAILABLE, NO_CHANGE, and STALE_TARGET results are frozen", () => {
  const ambiguousPlan: PlacementPlanInput = {
    blocks: [
      {
        id: "b1",
        stations: [
          {
            id: "s1",
            pairs: [
              { id: "p1", trainee1Id: "dup", trainee2Id: null },
              { id: "p2", trainee1Id: "dup", trainee2Id: null },
              { id: "p3", trainee1Id: null, trainee2Id: null },
            ],
          },
        ],
      },
    ],
  };
  const ambiguous = decideTraineeSelection({
    index: buildTraineePlacementIndex(ambiguousPlan),
    blockId: "b1",
    candidateTraineeId: "dup",
    destinationPairId: "p3",
    destinationSlot: 1,
    expectedVersion: 1,
  });
  const unavailable = decideTraineeSelection(query({ candidateTraineeId: "occ3", destinationPairId: null }));
  const noChange = decideTraineeSelection(
    query({ candidateTraineeId: "occ1", destinationPairId: "p1", destinationSlot: 1 })
  );
  const stale = decideTraineeSelection(query({ candidateTraineeId: "occ3", destinationPairId: "ghost" }));
  assert.equal(ambiguous.kind, "AMBIGUOUS");
  assert.equal(unavailable.kind, "UNAVAILABLE");
  assert.equal(noChange.kind, "NO_CHANGE");
  assert.equal(stale.kind, "STALE_TARGET");
  for (const decision of [ambiguous, unavailable, noChange, stale]) {
    assert.equal(Object.isFrozen(decision), true);
  }
});

test("a candidate placed only in another block is treated as free here", () => {
  // occ1 is in b1/p1, but ALSO in b2/p4. Querying b2 with occ2 (b1-only) is free,
  // and moving occ1 within b2 onto an empty seat proposes a b2-scoped MOVE.
  const decision = decideTraineeSelection(
    query({ blockId: "b2", candidateTraineeId: "occ2", destinationPairId: "p4", destinationSlot: 2 })
  );
  // p4 seat1 is occ1 (filled), seat2 empty -> occ2 is free in b2 -> LOCAL_SELECTION.
  assert.deepEqual(decision, { kind: "LOCAL_SELECTION", traineeId: "occ2" });
});

test("expectedVersion is threaded verbatim into the command", () => {
  const decision = decideTraineeSelection(
    query({ candidateTraineeId: "occ3", destinationPairId: "p3", destinationSlot: 1, expectedVersion: 512 })
  );
  assert.equal(decision.kind, "MOVE_PROPOSAL");
  if (decision.kind === "MOVE_PROPOSAL") {
    assert.equal(decision.command.expectedVersion, 512);
  }
});

test("the command carries no display labels and no extra fields", () => {
  const move = decideTraineeSelection(
    query({ candidateTraineeId: "occ3", destinationPairId: "p3", destinationSlot: 1 })
  );
  assert.equal(move.kind, "MOVE_PROPOSAL");
  if (move.kind === "MOVE_PROPOSAL") {
    assert.deepEqual(Object.keys(move.command).sort(), ["destination", "expectedVersion", "op", "source"]);
    assert.deepEqual(Object.keys(move.command.source).sort(), ["pairId", "slot"]);
    assert.deepEqual(Object.keys(move.command.destination).sort(), ["pairId", "slot"]);
  }
  const swap = decideTraineeSelection(
    query({ candidateTraineeId: "occ3", destinationPairId: "p1", destinationSlot: 1 })
  );
  assert.equal(swap.kind, "SWAP_PROPOSAL");
  if (swap.kind === "SWAP_PROPOSAL") {
    assert.deepEqual(Object.keys(swap.command).sort(), ["a", "b", "expectedVersion", "op"]);
  }
});

test("malformed input fails closed as UNAVAILABLE / UNRESOLVED (never throws)", () => {
  const index = buildTraineePlacementIndex(basePlan());
  const bad: TraineeSelectionQuery[] = [
    query({ candidateTraineeId: "" }),
    query({ blockId: "" }),
    query({ destinationSlot: 3 as unknown as 1 }),
    query({ expectedVersion: 1.5 }),
    query({ expectedVersion: NaN }),
    query({ destinationPairId: "" }),
    { ...query({}), index: null as unknown as TraineeSelectionQuery["index"] },
    { ...query({}), index: {} as unknown as TraineeSelectionQuery["index"] },
  ];
  for (const q of bad) {
    assert.doesNotThrow(() => {
      const decision = decideTraineeSelection(q);
      assert.deepEqual(decision, { kind: "UNAVAILABLE", reason: "UNRESOLVED" });
    });
  }
  // A completely non-object query also fails closed.
  assert.deepEqual(
    decideTraineeSelection(null as unknown as TraineeSelectionQuery),
    { kind: "UNAVAILABLE", reason: "UNRESOLVED" }
  );
  void index;
});

test("deterministic and non-mutating", () => {
  const plan = basePlan();
  const before = snapshot(plan);
  const index = buildTraineePlacementIndex(plan);
  const q: TraineeSelectionQuery = {
    index,
    blockId: "b1",
    candidateTraineeId: "occ3",
    destinationPairId: "p1",
    destinationSlot: 1,
    expectedVersion: 9,
  };
  const first = decideTraineeSelection(q);
  const second = decideTraineeSelection(q);
  assert.deepEqual(first, second);
  assert.deepEqual(snapshot(plan), before);
});

test("proposal decisions and their commands are frozen", () => {
  const decision = decideTraineeSelection(
    query({ candidateTraineeId: "occ3", destinationPairId: "p3", destinationSlot: 1 })
  );
  assert.equal(Object.isFrozen(decision), true);
  if (decision.kind === "MOVE_PROPOSAL") {
    assert.equal(Object.isFrozen(decision.command), true);
    assert.equal(Object.isFrozen(decision.command.source), true);
    assert.equal(Object.isFrozen(decision.command.destination), true);
  }
});
