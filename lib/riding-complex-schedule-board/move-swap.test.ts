// Pure unit tests for the complex-plan Move/Swap core (Stage 3A). Run:
//   npx tsx --test lib/riding-complex-schedule-board/move-swap.test.ts
//
// These tests are pure and DB-free: no Prisma, no server actions, no React, no
// network, no clock, no randomness. Every input is a fixed literal built fresh
// per test so mutation and determinism can be asserted precisely.

import test from "node:test";
import assert from "node:assert/strict";

import {
  applyComplexPlanMoveSwap,
  type ComplexPlanInput,
  type ComplexPlanMoveSwapCommand,
  type ComplexPlanMoveSwapReason,
  type ComplexPlanMoveSwapSuccess,
} from "./move-swap";

// ---------------------------------------------------------------------------
// Fixtures & helpers.
// ---------------------------------------------------------------------------

// A representative plan. version 3. Two blocks:
//   b1 / s1 (instr i1): p1 (stu1, stu2, "Bella"), p2 (stu3, -, "Comet")
//   b1 / s2 (instr i2): p3 (stu4, -, -)
//   b2 / s3 (instr i3): p4 (stu5, -, "Bella")
// The two "Bella" horses live in DIFFERENT blocks, so the base plan is valid.
function basePlan(): ComplexPlanInput {
  return {
    id: "plan-1",
    version: 3,
    blocks: [
      {
        id: "b1",
        stations: [
          {
            id: "s1",
            instructorId: "i1",
            arena: "Arena-A",
            sortOrder: 0,
            pairs: [
              { id: "p1", trainee1Id: "stu1", trainee2Id: "stu2", horseName: "Bella", note: "note-1", sortOrder: 0 },
              { id: "p2", trainee1Id: "stu3", trainee2Id: null, horseName: "Comet", note: null, sortOrder: 1 },
            ],
          },
          {
            id: "s2",
            instructorId: "i2",
            arena: "Arena-B",
            sortOrder: 1,
            pairs: [
              { id: "p3", trainee1Id: "stu4", trainee2Id: null, horseName: null, note: null, sortOrder: 0 },
            ],
          },
        ],
      },
      {
        id: "b2",
        stations: [
          {
            id: "s3",
            instructorId: "i3",
            arena: "Arena-C",
            sortOrder: 0,
            pairs: [
              { id: "p4", trainee1Id: "stu5", trainee2Id: null, horseName: "Bella", note: null, sortOrder: 0 },
            ],
          },
        ],
      },
    ],
  };
}

const snapshot = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

const ALL_REASONS: readonly ComplexPlanMoveSwapReason[] = [
  "INVALID_COMMAND",
  "MALFORMED_PLAN",
  "STALE_PLAN",
  "STALE_REFERENCE",
  "DESTINATION_OCCUPIED",
  "NOTHING_TO_MOVE",
  "NO_CHANGE",
  "SAME_POSITION",
  "SAME_STATION",
  "SAME_PAIR",
  "INVALID_PAIR_POSITION",
  "DUPLICATE_TRAINEE_IN_BLOCK",
  "DUPLICATE_HORSE_IN_BLOCK",
  "DUPLICATE_INSTRUCTOR_IN_BLOCK",
  "SAME_TRAINEE_TWICE_IN_PAIR",
];

function expectSuccess(result: ReturnType<typeof applyComplexPlanMoveSwap>): ComplexPlanMoveSwapSuccess {
  assert.equal(result.ok, true, `expected success, got ${result.ok === false ? result.reason : "?"}`);
  if (result.ok !== true) throw new Error("unreachable");
  return result;
}

function expectFailure(
  result: ReturnType<typeof applyComplexPlanMoveSwap>,
  reason: ComplexPlanMoveSwapReason
): void {
  assert.equal(result.ok, false);
  if (result.ok !== false) throw new Error("unreachable");
  assert.equal(result.reason, reason);
  // A failure never carries a proposed plan.
  assert.equal("nextPlan" in result, false);
}

function findPair(plan: ComplexPlanInput, pairId: string) {
  for (const block of plan.blocks) {
    for (const station of block.stations) {
      for (const pair of station.pairs) {
        if (pair.id === pairId) return { block, station, pair };
      }
    }
  }
  return null;
}

function findStation(plan: ComplexPlanInput, stationId: string) {
  for (const block of plan.blocks) {
    for (const station of block.stations) {
      if (station.id === stationId) return { block, station };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// General.
// ---------------------------------------------------------------------------

test("expectedVersion match succeeds; mismatch fails STALE_PLAN", () => {
  const ok = applyComplexPlanMoveSwap(basePlan(), {
    op: "MOVE_INSTRUCTOR",
    expectedVersion: 3,
    sourceStationId: "s1",
    destinationStationId: "s3", // different block, no instructor conflict? s3 has i3 -> occupied.
  });
  // s3 already has an instructor -> that specific command is DESTINATION_OCCUPIED,
  // but the version matched (we reached the op). Prove version handling with a
  // clean move instead:
  assert.equal(ok.ok, false);

  const clean = applyComplexPlanMoveSwap(basePlan(), {
    op: "MOVE_HORSE",
    expectedVersion: 3,
    sourcePairId: "p2",
    destinationPairId: "p3",
  });
  assert.equal(clean.ok, true);

  const stale = applyComplexPlanMoveSwap(basePlan(), {
    op: "MOVE_HORSE",
    expectedVersion: 2,
    sourcePairId: "p2",
    destinationPairId: "p3",
  });
  expectFailure(stale, "STALE_PLAN");
});

test("unknown operation fails INVALID_COMMAND with null operation", () => {
  const result = applyComplexPlanMoveSwap(basePlan(), {
    op: "TELEPORT",
    expectedVersion: 3,
  } as unknown as ComplexPlanMoveSwapCommand);
  assert.equal(result.ok, false);
  if (result.ok === false) {
    assert.equal(result.reason, "INVALID_COMMAND");
    assert.equal(result.operation, null);
  }
});

test("non-integer expectedVersion fails INVALID_COMMAND with known operation", () => {
  const result = applyComplexPlanMoveSwap(basePlan(), {
    op: "MOVE_HORSE",
    expectedVersion: 3.5,
    sourcePairId: "p2",
    destinationPairId: "p3",
  });
  assert.equal(result.ok, false);
  if (result.ok === false) {
    assert.equal(result.reason, "INVALID_COMMAND");
    assert.equal(result.operation, "MOVE_HORSE");
  }
});

test("malformed command shape fails INVALID_COMMAND", () => {
  for (const bad of [null, undefined, 42, "x", [], {}]) {
    const result = applyComplexPlanMoveSwap(basePlan(), bad as unknown as ComplexPlanMoveSwapCommand);
    assert.equal(result.ok, false);
    if (result.ok === false) assert.equal(result.reason, "INVALID_COMMAND");
  }
  // Known op but missing required refs.
  const missing = applyComplexPlanMoveSwap(basePlan(), {
    op: "MOVE_PAIR",
    expectedVersion: 3,
  } as unknown as ComplexPlanMoveSwapCommand);
  expectFailure(missing, "INVALID_COMMAND");
  // Bad slot value.
  const badSlot = applyComplexPlanMoveSwap(basePlan(), {
    op: "MOVE_TRAINEE",
    expectedVersion: 3,
    source: { pairId: "p1", slot: "trainee3" },
    destination: { pairId: "p3", slot: "trainee1" },
  } as unknown as ComplexPlanMoveSwapCommand);
  expectFailure(badSlot, "INVALID_COMMAND");
});

test("malformed / empty plan fails MALFORMED_PLAN", () => {
  const cmd: ComplexPlanMoveSwapCommand = {
    op: "MOVE_HORSE",
    expectedVersion: 3,
    sourcePairId: "p2",
    destinationPairId: "p3",
  };
  for (const bad of [null, undefined, 42, [], {}, { id: "x", version: 1 }]) {
    const result = applyComplexPlanMoveSwap(bad as unknown as ComplexPlanInput, cmd);
    assert.equal(result.ok, false);
    if (result.ok === false) assert.equal(result.reason, "MALFORMED_PLAN");
  }
  // Missing id.
  expectFailure(
    applyComplexPlanMoveSwap({ version: 1, blocks: [] } as unknown as ComplexPlanInput, cmd),
    "MALFORMED_PLAN"
  );
  // Non-integer version.
  expectFailure(
    applyComplexPlanMoveSwap({ id: "p", version: 1.2, blocks: [] } as unknown as ComplexPlanInput, cmd),
    "MALFORMED_PLAN"
  );
  // Non-integer pair sortOrder.
  const badSort = basePlan() as unknown as { blocks: { stations: { pairs: { sortOrder: number }[] }[] }[] };
  badSort.blocks[0].stations[0].pairs[0].sortOrder = 1.5;
  expectFailure(applyComplexPlanMoveSwap(badSort as unknown as ComplexPlanInput, cmd), "MALFORMED_PLAN");
  // Wrong type for a content field (number where string|null expected).
  const badType = basePlan() as unknown as { blocks: { stations: { pairs: { horseName: unknown }[] }[] }[] };
  badType.blocks[0].stations[0].pairs[0].horseName = 7;
  expectFailure(applyComplexPlanMoveSwap(badType as unknown as ComplexPlanInput, cmd), "MALFORMED_PLAN");
});

test("empty-but-valid plan with an empty version-matching command target fails STALE_REFERENCE not throw", () => {
  const empty: ComplexPlanInput = { id: "plan-e", version: 1, blocks: [] };
  const result = applyComplexPlanMoveSwap(empty, {
    op: "MOVE_HORSE",
    expectedVersion: 1,
    sourcePairId: "nope",
    destinationPairId: "nope2",
  });
  expectFailure(result, "STALE_REFERENCE");
});

test("duplicate block / station / pair ids fail closed MALFORMED_PLAN", () => {
  const cmd: ComplexPlanMoveSwapCommand = {
    op: "MOVE_HORSE",
    expectedVersion: 3,
    sourcePairId: "p2",
    destinationPairId: "p3",
  };
  const dupBlock = basePlan();
  (dupBlock.blocks as unknown as { id: string }[])[1].id = "b1";
  expectFailure(applyComplexPlanMoveSwap(dupBlock, cmd), "MALFORMED_PLAN");

  const dupStation = basePlan();
  (dupStation.blocks[1].stations as unknown as { id: string }[])[0].id = "s1";
  expectFailure(applyComplexPlanMoveSwap(dupStation, cmd), "MALFORMED_PLAN");

  const dupPair = basePlan();
  (dupPair.blocks[1].stations[0].pairs as unknown as { id: string }[])[0].id = "p1";
  expectFailure(applyComplexPlanMoveSwap(dupPair, cmd), "MALFORMED_PLAN");
});

test("missing source or destination reference fails STALE_REFERENCE", () => {
  expectFailure(
    applyComplexPlanMoveSwap(basePlan(), {
      op: "MOVE_HORSE",
      expectedVersion: 3,
      sourcePairId: "ghost",
      destinationPairId: "p3",
    }),
    "STALE_REFERENCE"
  );
  expectFailure(
    applyComplexPlanMoveSwap(basePlan(), {
      op: "MOVE_PAIR",
      expectedVersion: 3,
      sourcePairId: "p1",
      destinationStationId: "ghost-station",
    }),
    "STALE_REFERENCE"
  );
  expectFailure(
    applyComplexPlanMoveSwap(basePlan(), {
      op: "MOVE_INSTRUCTOR",
      expectedVersion: 3,
      sourceStationId: "ghost",
      destinationStationId: "s2",
    }),
    "STALE_REFERENCE"
  );
});

test("result is deterministic (same input + command -> deep-equal output)", () => {
  const cmd: ComplexPlanMoveSwapCommand = {
    op: "MOVE_PAIR",
    expectedVersion: 3,
    sourcePairId: "p1",
    destinationStationId: "s2",
  };
  const a = applyComplexPlanMoveSwap(basePlan(), cmd);
  const b = applyComplexPlanMoveSwap(basePlan(), cmd);
  assert.deepEqual(a, b);
});

test("input plan and command are never mutated", () => {
  const plan = basePlan();
  const planBefore = snapshot(plan);
  const cmd: ComplexPlanMoveSwapCommand = {
    op: "SWAP_PAIRS",
    expectedVersion: 3,
    aPairId: "p1",
    bPairId: "p4",
  };
  const cmdBefore = snapshot(cmd);
  const result = applyComplexPlanMoveSwap(plan, cmd);
  expectSuccess(result);
  assert.deepEqual(snapshot(plan), planBefore);
  assert.deepEqual(snapshot(cmd), cmdBefore);
});

test("failure reason codes are stable and carry no ids/names/PII", () => {
  const result = applyComplexPlanMoveSwap(basePlan(), {
    op: "MOVE_HORSE",
    expectedVersion: 3,
    sourcePairId: "SECRET-TRAINEE-NAME-123",
    destinationPairId: "p3",
  });
  assert.equal(result.ok, false);
  if (result.ok === false) {
    assert.ok(ALL_REASONS.includes(result.reason));
    assert.equal(result.reason, "STALE_REFERENCE");
    // The stable code contains none of the supplied id text.
    assert.equal(result.reason.includes("SECRET"), false);
    assert.equal(result.reason.includes("123"), false);
  }
});

test("success sets requiresVersionIncrement, keeps version unchanged, reports affected ids", () => {
  const result = expectSuccess(
    applyComplexPlanMoveSwap(basePlan(), {
      op: "MOVE_HORSE",
      expectedVersion: 3,
      sourcePairId: "p2",
      destinationPairId: "p3",
    })
  );
  assert.equal(result.requiresVersionIncrement, true);
  assert.equal(result.nextPlan.version, 3); // pure result never bumps version
  assert.deepEqual([...result.affected.pairIds].sort(), ["p2", "p3"]);
  assert.deepEqual(result.affected.blockIds, ["b1"]);
  assert.deepEqual([...result.affected.stationIds].sort(), ["s1", "s2"]);
});

test("untouched blocks are fresh deep-equal copies (deep-copy reference policy)", () => {
  const plan = basePlan();
  const result = expectSuccess(
    applyComplexPlanMoveSwap(plan, {
      op: "MOVE_TRAINEE",
      expectedVersion: 3,
      source: { pairId: "p2", slot: "trainee1" },
      destination: { pairId: "p3", slot: "trainee2" },
    })
  );
  // Block b2 was untouched by the b1-only op: deep-equal to input, but NOT the
  // same object reference (consistent full deep copy).
  const inputB2 = plan.blocks[1];
  const nextB2 = result.nextPlan.blocks.find((b) => b.id === "b2");
  assert.deepEqual(nextB2, inputB2);
  assert.notStrictEqual(nextB2, inputB2);
  // nextPlan shares no reference with the input plan at all.
  assert.notStrictEqual(result.nextPlan, plan);
  assert.notStrictEqual(result.nextPlan.blocks[0], plan.blocks[0]);
});

// ---------------------------------------------------------------------------
// MOVE_TRAINEE.
// ---------------------------------------------------------------------------

test("MOVE_TRAINEE: move into an empty slot, horse/note unchanged", () => {
  const result = expectSuccess(
    applyComplexPlanMoveSwap(basePlan(), {
      op: "MOVE_TRAINEE",
      expectedVersion: 3,
      source: { pairId: "p2", slot: "trainee1" }, // stu3
      destination: { pairId: "p3", slot: "trainee2" }, // p3 has trainee1 stu4
    })
  );
  const p2 = findPair(result.nextPlan, "p2")!.pair;
  const p3 = findPair(result.nextPlan, "p3")!.pair;
  assert.equal(p2.trainee1Id, null); // source cleared
  assert.equal(p2.horseName, "Comet"); // horse stays
  assert.equal(p3.trainee1Id, "stu4"); // untouched
  assert.equal(p3.trainee2Id, "stu3"); // received
  assert.equal(p3.horseName, null);
});

test("MOVE_TRAINEE: occupied destination rejected", () => {
  expectFailure(
    applyComplexPlanMoveSwap(basePlan(), {
      op: "MOVE_TRAINEE",
      expectedVersion: 3,
      source: { pairId: "p2", slot: "trainee1" },
      destination: { pairId: "p1", slot: "trainee1" }, // occupied by stu1
    }),
    "DESTINATION_OCCUPIED"
  );
});

test("MOVE_TRAINEE: empty source rejected NOTHING_TO_MOVE", () => {
  expectFailure(
    applyComplexPlanMoveSwap(basePlan(), {
      op: "MOVE_TRAINEE",
      expectedVersion: 3,
      source: { pairId: "p2", slot: "trainee2" }, // empty
      destination: { pairId: "p3", slot: "trainee2" },
    }),
    "NOTHING_TO_MOVE"
  );
});

test("MOVE_TRAINEE: clearing trainee1 promotes trainee2", () => {
  const result = expectSuccess(
    applyComplexPlanMoveSwap(basePlan(), {
      op: "MOVE_TRAINEE",
      expectedVersion: 3,
      source: { pairId: "p1", slot: "trainee1" }, // stu1 leaves, stu2 remains
      destination: { pairId: "p3", slot: "trainee2" },
    })
  );
  const p1 = findPair(result.nextPlan, "p1")!.pair;
  assert.equal(p1.trainee1Id, "stu2"); // promoted from trainee2
  assert.equal(p1.trainee2Id, null);
  assert.equal(p1.horseName, "Bella"); // horse/note stay put
  assert.equal(p1.note, "note-1");
});

test("MOVE_TRAINEE: moving trainee2 OUT leaves trainee1 unchanged and does not promote", () => {
  const result = expectSuccess(
    applyComplexPlanMoveSwap(basePlan(), {
      op: "MOVE_TRAINEE",
      expectedVersion: 3,
      source: { pairId: "p1", slot: "trainee2" }, // stu2 leaves
      destination: { pairId: "p3", slot: "trainee2" }, // p3 seat1 stu4 present
    })
  );
  const p1 = findPair(result.nextPlan, "p1")!.pair;
  assert.equal(p1.trainee1Id, "stu1"); // seat 1 untouched - no promotion churn
  assert.equal(p1.trainee2Id, null); // seat 2 cleared
  assert.equal(p1.horseName, "Bella"); // field-only op leaves horse/note
  const p3 = findPair(result.nextPlan, "p3")!.pair;
  assert.equal(p3.trainee1Id, "stu4");
  assert.equal(p3.trainee2Id, "stu2");
});

test("MOVE_TRAINEE: filling seat 2 while seat 1 empty -> INVALID_PAIR_POSITION", () => {
  // p2 has trainee1 stu3, trainee2 empty. Move stu4 (from p3) into p2.trainee2:
  // valid because p2.trainee1 is present. Now force the invalid variant: an
  // empty-seat-1 destination pair.
  const plan = basePlan();
  // Empty p3's trainee1 so its seat 1 is empty (repurpose for this check).
  (plan.blocks[0].stations[1].pairs[0] as unknown as { trainee1Id: string | null }).trainee1Id = null;
  const result = applyComplexPlanMoveSwap(plan, {
    op: "MOVE_TRAINEE",
    expectedVersion: 3,
    source: { pairId: "p2", slot: "trainee1" },
    destination: { pairId: "p3", slot: "trainee2" },
  });
  expectFailure(result, "INVALID_PAIR_POSITION");
});

test("MOVE_TRAINEE: same exact position -> SAME_POSITION; same pair other slot -> SAME_PAIR", () => {
  expectFailure(
    applyComplexPlanMoveSwap(basePlan(), {
      op: "MOVE_TRAINEE",
      expectedVersion: 3,
      source: { pairId: "p1", slot: "trainee1" },
      destination: { pairId: "p1", slot: "trainee1" },
    }),
    "SAME_POSITION"
  );
  expectFailure(
    applyComplexPlanMoveSwap(basePlan(), {
      op: "MOVE_TRAINEE",
      expectedVersion: 3,
      source: { pairId: "p1", slot: "trainee1" },
      destination: { pairId: "p1", slot: "trainee2" },
    }),
    "SAME_PAIR"
  );
});

test("MOVE_TRAINEE: landing a duplicate trainee in a block fails DUPLICATE_TRAINEE_IN_BLOCK", () => {
  const plan = basePlan();
  // Seed p3.trainee2 with stu3 so b1 will hold stu3 twice once we move the other
  // stu3 into a different empty seat.
  (plan.blocks[0].stations[1].pairs[0] as unknown as { trainee2Id: string | null }).trainee2Id = "stu3";
  // b1 now: p2.trainee1 = stu3, p3.trainee2 = stu3 -> already a dup, but b1 is
  // only validated because the op touches it. Move stu5 (b2) into an empty b1
  // seat to make b1 an affected block.
  const result = applyComplexPlanMoveSwap(plan, {
    op: "MOVE_TRAINEE",
    expectedVersion: 3,
    source: { pairId: "p4", slot: "trainee1" }, // stu5 from b2
    destination: { pairId: "p2", slot: "trainee2" }, // into b1
  });
  expectFailure(result, "DUPLICATE_TRAINEE_IN_BLOCK");
});

// ---------------------------------------------------------------------------
// SWAP_TRAINEES.
// ---------------------------------------------------------------------------

test("SWAP_TRAINEES: normal cross-station swap within one block", () => {
  const result = expectSuccess(
    applyComplexPlanMoveSwap(basePlan(), {
      op: "SWAP_TRAINEES",
      expectedVersion: 3,
      a: { pairId: "p2", slot: "trainee1" }, // stu3 (s1)
      b: { pairId: "p3", slot: "trainee1" }, // stu4 (s2)
    })
  );
  assert.equal(findPair(result.nextPlan, "p2")!.pair.trainee1Id, "stu4");
  assert.equal(findPair(result.nextPlan, "p3")!.pair.trainee1Id, "stu3");
});

test("SWAP_TRAINEES: cross-block swap within the same plan", () => {
  const result = expectSuccess(
    applyComplexPlanMoveSwap(basePlan(), {
      op: "SWAP_TRAINEES",
      expectedVersion: 3,
      a: { pairId: "p2", slot: "trainee1" }, // stu3 in b1
      b: { pairId: "p4", slot: "trainee1" }, // stu5 in b2
    })
  );
  assert.equal(findPair(result.nextPlan, "p2")!.pair.trainee1Id, "stu5");
  assert.equal(findPair(result.nextPlan, "p4")!.pair.trainee1Id, "stu3");
  assert.deepEqual([...result.affected.blockIds].sort(), ["b1", "b2"]);
});

test("SWAP_TRAINEES: same position fails SAME_POSITION", () => {
  expectFailure(
    applyComplexPlanMoveSwap(basePlan(), {
      op: "SWAP_TRAINEES",
      expectedVersion: 3,
      a: { pairId: "p1", slot: "trainee1" },
      b: { pairId: "p1", slot: "trainee1" },
    }),
    "SAME_POSITION"
  );
});

test("SWAP_TRAINEES: equal trainee values fail NO_CHANGE", () => {
  const plan = basePlan();
  // Make p2.trainee1 and p3.trainee1 the same student.
  (plan.blocks[0].stations[1].pairs[0] as unknown as { trainee1Id: string }).trainee1Id = "stu3";
  expectFailure(
    applyComplexPlanMoveSwap(plan, {
      op: "SWAP_TRAINEES",
      expectedVersion: 3,
      a: { pairId: "p2", slot: "trainee1" },
      b: { pairId: "p3", slot: "trainee1" },
    }),
    "NO_CHANGE"
  );
});

test("SWAP_TRAINEES: an empty slot fails NOTHING_TO_MOVE", () => {
  expectFailure(
    applyComplexPlanMoveSwap(basePlan(), {
      op: "SWAP_TRAINEES",
      expectedVersion: 3,
      a: { pairId: "p2", slot: "trainee1" }, // stu3
      b: { pairId: "p2", slot: "trainee2" }, // empty
    }),
    "NOTHING_TO_MOVE"
  );
});

test("SWAP_TRAINEES: swap that would put the same trainee twice in a pair fails", () => {
  // p1 = (stu1, stu2). Swap p1.trainee2 (stu2) with p2.trainee1 (stu3) is fine.
  // To trigger SAME_TRAINEE_TWICE_IN_PAIR: swap p1.trainee2 (stu2) with a slot
  // holding stu1. Seed p3.trainee1 = stu1.
  const plan = basePlan();
  (plan.blocks[0].stations[1].pairs[0] as unknown as { trainee1Id: string }).trainee1Id = "stu1";
  // Now b1 has stu1 in p1 and p3 -> a pre-existing dup. Swap p1.trainee2 with
  // p3.trainee1 so p1 becomes (stu1, stu1).
  const result = applyComplexPlanMoveSwap(plan, {
    op: "SWAP_TRAINEES",
    expectedVersion: 3,
    a: { pairId: "p1", slot: "trainee2" }, // stu2
    b: { pairId: "p3", slot: "trainee1" }, // stu1
  });
  expectFailure(result, "SAME_TRAINEE_TWICE_IN_PAIR");
});

// ---------------------------------------------------------------------------
// MOVE_PAIR.
// ---------------------------------------------------------------------------

test("MOVE_PAIR: same-block station move appends at destination, source may empty, order regenerated", () => {
  const result = expectSuccess(
    applyComplexPlanMoveSwap(basePlan(), {
      op: "MOVE_PAIR",
      expectedVersion: 3,
      sourcePairId: "p3", // sole pair of s2
      destinationStationId: "s1",
    })
  );
  const s1 = findStation(result.nextPlan, "s1")!.station;
  const s2 = findStation(result.nextPlan, "s2")!.station;
  assert.deepEqual(s1.pairs.map((p) => p.id), ["p1", "p2", "p3"]); // appended
  assert.deepEqual(s1.pairs.map((p) => p.sortOrder), [0, 1, 2]); // contiguous
  assert.equal(s2.pairs.length, 0); // source station emptied
});

test("MOVE_PAIR: cross-block move carries full content and preserves pair id", () => {
  const result = expectSuccess(
    applyComplexPlanMoveSwap(basePlan(), {
      op: "MOVE_PAIR",
      expectedVersion: 3,
      sourcePairId: "p2", // (stu3, -, Comet) from b1/s1
      destinationStationId: "s3", // b2
    })
  );
  const moved = findPair(result.nextPlan, "p2")!;
  assert.equal(moved.block.id, "b2");
  assert.equal(moved.station.id, "s3");
  assert.equal(moved.pair.trainee1Id, "stu3");
  assert.equal(moved.pair.horseName, "Comet");
  assert.deepEqual([...result.affected.blockIds].sort(), ["b1", "b2"]);
});

test("MOVE_PAIR: moving into the pair's own station fails SAME_STATION", () => {
  expectFailure(
    applyComplexPlanMoveSwap(basePlan(), {
      op: "MOVE_PAIR",
      expectedVersion: 3,
      sourcePairId: "p1",
      destinationStationId: "s1",
    }),
    "SAME_STATION"
  );
});

test("MOVE_PAIR: cross-block move that duplicates a horse in the destination block fails", () => {
  // p1 carries "Bella"; b2 already has "Bella" (p4). Move p1 into b2/s3.
  expectFailure(
    applyComplexPlanMoveSwap(basePlan(), {
      op: "MOVE_PAIR",
      expectedVersion: 3,
      sourcePairId: "p1",
      destinationStationId: "s3",
    }),
    "DUPLICATE_HORSE_IN_BLOCK"
  );
});

test("MOVE_PAIR: cross-block move that duplicates a trainee in the destination block fails", () => {
  const plan = basePlan();
  // Seed b2 with stu3 so moving p2 (stu3) into b2 duplicates it.
  (plan.blocks[1].stations[0].pairs[0] as unknown as { trainee2Id: string | null }).trainee2Id = "stu3";
  expectFailure(
    applyComplexPlanMoveSwap(plan, {
      op: "MOVE_PAIR",
      expectedVersion: 3,
      sourcePairId: "p2",
      destinationStationId: "s3",
    }),
    "DUPLICATE_TRAINEE_IN_BLOCK"
  );
});

// ---------------------------------------------------------------------------
// SWAP_PAIRS.
// ---------------------------------------------------------------------------

test("SWAP_PAIRS: cross-station same block exchanges placement, content travels", () => {
  const result = expectSuccess(
    applyComplexPlanMoveSwap(basePlan(), {
      op: "SWAP_PAIRS",
      expectedVersion: 3,
      aPairId: "p2", // s1 index 1
      bPairId: "p3", // s2 index 0
    })
  );
  const s1 = findStation(result.nextPlan, "s1")!.station;
  const s2 = findStation(result.nextPlan, "s2")!.station;
  assert.deepEqual(s1.pairs.map((p) => p.id), ["p1", "p3"]);
  assert.deepEqual(s2.pairs.map((p) => p.id), ["p2"]);
  assert.deepEqual(s1.pairs.map((p) => p.sortOrder), [0, 1]);
  assert.deepEqual(s2.pairs.map((p) => p.sortOrder), [0]);
  // Content travelled with the ids.
  assert.equal(findPair(result.nextPlan, "p3")!.pair.trainee1Id, "stu4");
});

test("SWAP_PAIRS: cross-block swap", () => {
  const plan = basePlan();
  // p1 and p4 both carry "Bella" in different blocks; null p4's horse so moving
  // it into b1 does not collide with p1 (that collision is covered elsewhere).
  (plan.blocks[1].stations[0].pairs[0] as unknown as { horseName: string | null }).horseName = null;
  const result = expectSuccess(
    applyComplexPlanMoveSwap(plan, {
      op: "SWAP_PAIRS",
      expectedVersion: 3,
      aPairId: "p2", // b1
      bPairId: "p4", // b2
    })
  );
  assert.equal(findPair(result.nextPlan, "p2")!.block.id, "b2");
  assert.equal(findPair(result.nextPlan, "p4")!.block.id, "b1");
});

test("SWAP_PAIRS: same-station ordering swap", () => {
  const result = expectSuccess(
    applyComplexPlanMoveSwap(basePlan(), {
      op: "SWAP_PAIRS",
      expectedVersion: 3,
      aPairId: "p1", // s1 index 0
      bPairId: "p2", // s1 index 1
    })
  );
  const s1 = findStation(result.nextPlan, "s1")!.station;
  assert.deepEqual(s1.pairs.map((p) => p.id), ["p2", "p1"]);
  assert.deepEqual(s1.pairs.map((p) => p.sortOrder), [0, 1]);
});

test("SWAP_PAIRS: same pair fails SAME_PAIR", () => {
  expectFailure(
    applyComplexPlanMoveSwap(basePlan(), {
      op: "SWAP_PAIRS",
      expectedVersion: 3,
      aPairId: "p1",
      bPairId: "p1",
    }),
    "SAME_PAIR"
  );
});

test("SWAP_PAIRS: does not mutate input", () => {
  const plan = basePlan();
  const before = snapshot(plan);
  applyComplexPlanMoveSwap(plan, { op: "SWAP_PAIRS", expectedVersion: 3, aPairId: "p1", bPairId: "p4" });
  assert.deepEqual(snapshot(plan), before);
});

// ---------------------------------------------------------------------------
// MOVE_HORSE / SWAP_HORSES.
// ---------------------------------------------------------------------------

test("MOVE_HORSE: move to an empty pair, source cleared, value normalized", () => {
  const plan = basePlan();
  // Give p2 an untrimmed horse to prove trim-on-write.
  (plan.blocks[0].stations[0].pairs[1] as unknown as { horseName: string }).horseName = "  Comet  ";
  const result = expectSuccess(
    applyComplexPlanMoveSwap(plan, {
      op: "MOVE_HORSE",
      expectedVersion: 3,
      sourcePairId: "p2",
      destinationPairId: "p3", // no horse
    })
  );
  assert.equal(findPair(result.nextPlan, "p2")!.pair.horseName, null);
  assert.equal(findPair(result.nextPlan, "p3")!.pair.horseName, "Comet"); // trimmed
});

test("MOVE_HORSE: occupied destination rejected", () => {
  expectFailure(
    applyComplexPlanMoveSwap(basePlan(), {
      op: "MOVE_HORSE",
      expectedVersion: 3,
      sourcePairId: "p2", // Comet
      destinationPairId: "p1", // Bella present
    }),
    "DESTINATION_OCCUPIED"
  );
});

test("MOVE_HORSE: blank source rejected NOTHING_TO_MOVE (whitespace-only is blank)", () => {
  const plan = basePlan();
  (plan.blocks[0].stations[1].pairs[0] as unknown as { horseName: string }).horseName = "   ";
  expectFailure(
    applyComplexPlanMoveSwap(plan, {
      op: "MOVE_HORSE",
      expectedVersion: 3,
      sourcePairId: "p3", // whitespace-only -> blank
      destinationPairId: "p2",
    }),
    "NOTHING_TO_MOVE" // p2 has a horse so DESTINATION_OCCUPIED would also apply,
    // but the blank-source guard is checked first.
  );
});

test("MOVE_HORSE: same pair fails SAME_PAIR", () => {
  expectFailure(
    applyComplexPlanMoveSwap(basePlan(), {
      op: "MOVE_HORSE",
      expectedVersion: 3,
      sourcePairId: "p1",
      destinationPairId: "p1",
    }),
    "SAME_PAIR"
  );
});

test("MOVE_HORSE: anchored by pair id, never by horse name", () => {
  // Two pairs named "Bella" exist (p1 in b1, p4 in b2). Moving p1's horse to p3
  // must move exactly p1's Bella, leaving p4 untouched.
  const result = expectSuccess(
    applyComplexPlanMoveSwap(basePlan(), {
      op: "MOVE_HORSE",
      expectedVersion: 3,
      sourcePairId: "p1",
      destinationPairId: "p3",
    })
  );
  assert.equal(findPair(result.nextPlan, "p1")!.pair.horseName, null);
  assert.equal(findPair(result.nextPlan, "p3")!.pair.horseName, "Bella");
  assert.equal(findPair(result.nextPlan, "p4")!.pair.horseName, "Bella"); // untouched
});

test("MOVE_HORSE: landing a case/whitespace duplicate in a block fails DUPLICATE_HORSE_IN_BLOCK", () => {
  const plan = basePlan();
  // p3 (empty horse) gets a horse that case-insensitively matches p1's "Bella".
  // Move p2's "  bella " into p3 -> b1 would then hold Bella twice.
  (plan.blocks[0].stations[0].pairs[1] as unknown as { horseName: string }).horseName = "  bELLa ";
  expectFailure(
    applyComplexPlanMoveSwap(plan, {
      op: "MOVE_HORSE",
      expectedVersion: 3,
      sourcePairId: "p2",
      destinationPairId: "p3",
    }),
    "DUPLICATE_HORSE_IN_BLOCK"
  );
});

test("SWAP_HORSES: swap two names", () => {
  const result = expectSuccess(
    applyComplexPlanMoveSwap(basePlan(), {
      op: "SWAP_HORSES",
      expectedVersion: 3,
      aPairId: "p1", // Bella
      bPairId: "p2", // Comet
    })
  );
  assert.equal(findPair(result.nextPlan, "p1")!.pair.horseName, "Comet");
  assert.equal(findPair(result.nextPlan, "p2")!.pair.horseName, "Bella");
});

test("SWAP_HORSES: one-null swap is a valid exchange (not normalized to MOVE_HORSE)", () => {
  const result = expectSuccess(
    applyComplexPlanMoveSwap(basePlan(), {
      op: "SWAP_HORSES",
      expectedVersion: 3,
      aPairId: "p2", // Comet
      bPairId: "p3", // null
    })
  );
  assert.equal(findPair(result.nextPlan, "p2")!.pair.horseName, null);
  assert.equal(findPair(result.nextPlan, "p3")!.pair.horseName, "Comet");
});

test("SWAP_HORSES: both absent -> NO_CHANGE; same normalized name -> NO_CHANGE", () => {
  const plan = basePlan();
  // p3 empty; clear p2 too so both empty.
  (plan.blocks[0].stations[0].pairs[1] as unknown as { horseName: string | null }).horseName = null;
  expectFailure(
    applyComplexPlanMoveSwap(plan, { op: "SWAP_HORSES", expectedVersion: 3, aPairId: "p2", bPairId: "p3" }),
    "NO_CHANGE"
  );

  const plan2 = basePlan();
  // Make p2 hold a case/space variant of p1's Bella.
  (plan2.blocks[0].stations[0].pairs[1] as unknown as { horseName: string }).horseName = "  bella ";
  expectFailure(
    applyComplexPlanMoveSwap(plan2, { op: "SWAP_HORSES", expectedVersion: 3, aPairId: "p1", bPairId: "p2" }),
    "NO_CHANGE"
  );
});

test("SWAP_HORSES: same pair fails SAME_PAIR", () => {
  expectFailure(
    applyComplexPlanMoveSwap(basePlan(), { op: "SWAP_HORSES", expectedVersion: 3, aPairId: "p1", bPairId: "p1" }),
    "SAME_PAIR"
  );
});

// ---------------------------------------------------------------------------
// MOVE_INSTRUCTOR / SWAP_INSTRUCTORS.
// ---------------------------------------------------------------------------

test("MOVE_INSTRUCTOR: move to an empty station, arena unchanged", () => {
  const plan = basePlan();
  // Empty s2's instructor so it is a valid destination.
  (plan.blocks[0].stations[1] as unknown as { instructorId: string | null }).instructorId = null;
  const result = expectSuccess(
    applyComplexPlanMoveSwap(plan, {
      op: "MOVE_INSTRUCTOR",
      expectedVersion: 3,
      sourceStationId: "s1", // i1
      destinationStationId: "s2",
    })
  );
  const s1 = findStation(result.nextPlan, "s1")!.station;
  const s2 = findStation(result.nextPlan, "s2")!.station;
  assert.equal(s1.instructorId, null);
  assert.equal(s2.instructorId, "i1");
  assert.equal(s1.arena, "Arena-A"); // arenas stay put
  assert.equal(s2.arena, "Arena-B");
});

test("MOVE_INSTRUCTOR: occupied destination rejected", () => {
  expectFailure(
    applyComplexPlanMoveSwap(basePlan(), {
      op: "MOVE_INSTRUCTOR",
      expectedVersion: 3,
      sourceStationId: "s1", // i1
      destinationStationId: "s2", // i2 present
    }),
    "DESTINATION_OCCUPIED"
  );
});

test("MOVE_INSTRUCTOR: empty source rejected NOTHING_TO_MOVE", () => {
  const plan = basePlan();
  (plan.blocks[0].stations[0] as unknown as { instructorId: string | null }).instructorId = null;
  (plan.blocks[0].stations[1] as unknown as { instructorId: string | null }).instructorId = null;
  expectFailure(
    applyComplexPlanMoveSwap(plan, {
      op: "MOVE_INSTRUCTOR",
      expectedVersion: 3,
      sourceStationId: "s1",
      destinationStationId: "s2",
    }),
    "NOTHING_TO_MOVE"
  );
});

test("MOVE_INSTRUCTOR: same station fails SAME_STATION", () => {
  expectFailure(
    applyComplexPlanMoveSwap(basePlan(), {
      op: "MOVE_INSTRUCTOR",
      expectedVersion: 3,
      sourceStationId: "s1",
      destinationStationId: "s1",
    }),
    "SAME_STATION"
  );
});

test("MOVE_INSTRUCTOR: cross-block move that duplicates an instructor in the destination block fails", () => {
  const plan = basePlan();
  // Make s3 (b2) empty and give b2 a second station already staffed by i1.
  (plan.blocks[1].stations[0] as unknown as { instructorId: string | null }).instructorId = null;
  (plan.blocks[1].stations as unknown as ComplexPlanInput["blocks"][number]["stations"][number][]).push({
    id: "s4",
    instructorId: "i1",
    arena: "Arena-D",
    sortOrder: 1,
    pairs: [],
  });
  // Move i1 from b1/s1 into b2/s3 -> b2 would then hold i1 on s3 and s4.
  expectFailure(
    applyComplexPlanMoveSwap(plan, {
      op: "MOVE_INSTRUCTOR",
      expectedVersion: 3,
      sourceStationId: "s1",
      destinationStationId: "s3",
    }),
    "DUPLICATE_INSTRUCTOR_IN_BLOCK"
  );
});

test("SWAP_INSTRUCTORS: swap two instructors, arenas unchanged", () => {
  const result = expectSuccess(
    applyComplexPlanMoveSwap(basePlan(), {
      op: "SWAP_INSTRUCTORS",
      expectedVersion: 3,
      aStationId: "s1", // i1
      bStationId: "s3", // i3, different block
    })
  );
  assert.equal(findStation(result.nextPlan, "s1")!.station.instructorId, "i3");
  assert.equal(findStation(result.nextPlan, "s3")!.station.instructorId, "i1");
  assert.equal(findStation(result.nextPlan, "s1")!.station.arena, "Arena-A");
});

test("SWAP_INSTRUCTORS: one-null swap is a valid exchange", () => {
  const plan = basePlan();
  (plan.blocks[0].stations[1] as unknown as { instructorId: string | null }).instructorId = null;
  const result = expectSuccess(
    applyComplexPlanMoveSwap(plan, {
      op: "SWAP_INSTRUCTORS",
      expectedVersion: 3,
      aStationId: "s1", // i1
      bStationId: "s2", // null
    })
  );
  assert.equal(findStation(result.nextPlan, "s1")!.station.instructorId, null);
  assert.equal(findStation(result.nextPlan, "s2")!.station.instructorId, "i1");
});

test("SWAP_INSTRUCTORS: both empty or same instructor -> NO_CHANGE", () => {
  const plan = basePlan();
  (plan.blocks[0].stations[0] as unknown as { instructorId: string | null }).instructorId = null;
  (plan.blocks[0].stations[1] as unknown as { instructorId: string | null }).instructorId = null;
  expectFailure(
    applyComplexPlanMoveSwap(plan, { op: "SWAP_INSTRUCTORS", expectedVersion: 3, aStationId: "s1", bStationId: "s2" }),
    "NO_CHANGE"
  );

  const plan2 = basePlan();
  (plan2.blocks[0].stations[1] as unknown as { instructorId: string }).instructorId = "i1"; // same as s1
  // b1 now has i1 on both stations (pre-existing dup) but the swap is a NO_CHANGE
  // and is rejected before any final validation runs.
  expectFailure(
    applyComplexPlanMoveSwap(plan2, { op: "SWAP_INSTRUCTORS", expectedVersion: 3, aStationId: "s1", bStationId: "s2" }),
    "NO_CHANGE"
  );
});

test("SWAP_INSTRUCTORS: same station fails SAME_STATION", () => {
  expectFailure(
    applyComplexPlanMoveSwap(basePlan(), {
      op: "SWAP_INSTRUCTORS",
      expectedVersion: 3,
      aStationId: "s1",
      bStationId: "s1",
    }),
    "SAME_STATION"
  );
});

// ---------------------------------------------------------------------------
// Output immutability.
// ---------------------------------------------------------------------------

test("nextPlan is deeply frozen", () => {
  const result = expectSuccess(
    applyComplexPlanMoveSwap(basePlan(), {
      op: "MOVE_HORSE",
      expectedVersion: 3,
      sourcePairId: "p2",
      destinationPairId: "p3",
    })
  );
  assert.equal(Object.isFrozen(result.nextPlan), true);
  assert.equal(Object.isFrozen(result.nextPlan.blocks), true);
  assert.equal(Object.isFrozen(result.nextPlan.blocks[0].stations[0].pairs[0]), true);
});

test("the whole success result - wrapper, affected, and its arrays - is frozen and immutable", () => {
  const result = expectSuccess(
    applyComplexPlanMoveSwap(basePlan(), {
      op: "MOVE_HORSE",
      expectedVersion: 3,
      sourcePairId: "p2",
      destinationPairId: "p3",
    })
  );
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.affected), true);
  assert.equal(Object.isFrozen(result.affected.blockIds), true);
  assert.equal(Object.isFrozen(result.affected.stationIds), true);
  assert.equal(Object.isFrozen(result.affected.pairIds), true);

  // Attempted mutation cannot change the result (frozen -> throws in strict mode).
  const asMutable = result as unknown as { requiresVersionIncrement: boolean };
  assert.throws(() => {
    asMutable.requiresVersionIncrement = false;
  });
  assert.equal(result.requiresVersionIncrement, true);
  const asArray = result.affected.pairIds as unknown as string[];
  assert.throws(() => {
    asArray.push("intruder");
  });
  assert.deepEqual([...result.affected.pairIds].sort(), ["p2", "p3"]);
});

test("failure results are frozen too", () => {
  const result = applyComplexPlanMoveSwap(basePlan(), {
    op: "MOVE_HORSE",
    expectedVersion: 2, // stale -> failure
    sourcePairId: "p2",
    destinationPairId: "p3",
  });
  assert.equal(result.ok, false);
  assert.equal(Object.isFrozen(result), true);
  const asMutable = result as unknown as { reason: string };
  assert.throws(() => {
    asMutable.reason = "SPOOFED";
  });
  if (result.ok === false) assert.equal(result.reason, "STALE_PLAN");
});

// --- Affected / global validation contract -----------------------------------

test("untouched block keeps its semantic legacy duplicate; an op on another block still succeeds", () => {
  const plan = basePlan();
  // Give block b2 a semantic (not structural) duplicate: a second station whose
  // pair reuses "Bella", so b2 already holds Bella twice. b2 stays structurally
  // valid - only its final-state uniqueness is violated.
  (plan.blocks[1].stations as unknown as ComplexPlanInput["blocks"][number]["stations"][number][]).push({
    id: "s5",
    instructorId: "i9",
    arena: "Arena-E",
    sortOrder: 1,
    pairs: [{ id: "p5", trainee1Id: "stu9", trainee2Id: null, horseName: "Bella", note: null, sortOrder: 0 }],
  });
  const b2Before = snapshot(plan.blocks[1]);
  // Operate only on block b1 (swap its two station instructors).
  const result = expectSuccess(
    applyComplexPlanMoveSwap(plan, {
      op: "SWAP_INSTRUCTORS",
      expectedVersion: 3,
      aStationId: "s1",
      bStationId: "s2",
    })
  );
  // b2 was never validated (not affected) and is carried through unchanged.
  assert.deepEqual(result.affected.blockIds, ["b1"]);
  const nextB2 = result.nextPlan.blocks.find((b) => b.id === "b2");
  assert.deepEqual(nextB2, b2Before);
});

test("a structural defect (non-integer sortOrder) in an UNTOUCHED block still fails MALFORMED_PLAN", () => {
  const plan = basePlan();
  // Structural corruption in b2 while the op targets only b1: whole-tree
  // structural validation runs first, so this fails closed regardless of scope.
  (plan.blocks[1].stations[0].pairs[0] as unknown as { sortOrder: number }).sortOrder = 1.5;
  const result = applyComplexPlanMoveSwap(plan, {
    op: "SWAP_INSTRUCTORS",
    expectedVersion: 3,
    aStationId: "s1",
    bStationId: "s2",
  });
  expectFailure(result, "MALFORMED_PLAN");
});

// A plan whose stations carry NON-CONTIGUOUS input sortOrder plus sibling pairs,
// used to lock the reindex / write-scope contract.
function gappyPlan(): ComplexPlanInput {
  return {
    id: "plan-g",
    version: 1,
    blocks: [
      {
        id: "gb1",
        stations: [
          {
            id: "gs1",
            instructorId: "gi1",
            arena: "G-A",
            sortOrder: 0,
            pairs: [
              { id: "gp1", trainee1Id: "gt1", trainee2Id: null, horseName: null, note: null, sortOrder: 0 },
              { id: "gp2", trainee1Id: "gt2", trainee2Id: null, horseName: null, note: null, sortOrder: 5 },
              { id: "gp3", trainee1Id: "gt3", trainee2Id: null, horseName: null, note: null, sortOrder: 9 },
            ],
          },
          {
            id: "gs2",
            instructorId: "gi2",
            arena: "G-B",
            sortOrder: 1,
            pairs: [
              { id: "gpa", trainee1Id: "gt4", trainee2Id: null, horseName: null, note: null, sortOrder: 3 },
            ],
          },
        ],
      },
    ],
  };
}

test("MOVE_PAIR: both affected stations are fully reindexed contiguously; siblings change but are not all in affected.pairIds", () => {
  const result = expectSuccess(
    applyComplexPlanMoveSwap(gappyPlan(), {
      op: "MOVE_PAIR",
      expectedVersion: 1,
      sourcePairId: "gp1", // leaves gs1
      destinationStationId: "gs2",
    })
  );
  const gs1 = findStation(result.nextPlan, "gs1")!.station;
  const gs2 = findStation(result.nextPlan, "gs2")!.station;
  // Source station reindexed contiguous from the gappy input.
  assert.deepEqual(gs1.pairs.map((p) => p.id), ["gp2", "gp3"]);
  assert.deepEqual(gs1.pairs.map((p) => p.sortOrder), [0, 1]);
  // Destination station reindexed contiguous after append.
  assert.deepEqual(gs2.pairs.map((p) => p.id), ["gpa", "gp1"]);
  assert.deepEqual(gs2.pairs.map((p) => p.sortOrder), [0, 1]);
  // A sibling's sortOrder change IS present in nextPlan (gp2: 5 -> 0).
  assert.equal(findPair(result.nextPlan, "gp2")!.pair.sortOrder, 0);
  // affected.stationIds is authoritative: every station Stage 3B must reproduce.
  assert.deepEqual([...result.affected.stationIds].sort(), ["gs1", "gs2"]);
  // ...but affected.pairIds does NOT enumerate reindexed siblings - only the
  // moved pair is listed, so a caller must NOT treat pairIds as the full
  // sortOrder-changed set.
  assert.deepEqual(result.affected.pairIds, ["gp1"]);
  assert.equal(result.affected.pairIds.includes("gp2"), false);
});

test("SWAP_PAIRS: both affected stations reindexed contiguously; a reindexed sibling is absent from affected.pairIds", () => {
  const result = expectSuccess(
    applyComplexPlanMoveSwap(gappyPlan(), {
      op: "SWAP_PAIRS",
      expectedVersion: 1,
      aPairId: "gp2", // gs1 index 1 (sortOrder 5)
      bPairId: "gpa", // gs2 index 0 (sortOrder 3)
    })
  );
  const gs1 = findStation(result.nextPlan, "gs1")!.station;
  const gs2 = findStation(result.nextPlan, "gs2")!.station;
  assert.deepEqual(gs1.pairs.map((p) => p.id), ["gp1", "gpa", "gp3"]);
  assert.deepEqual(gs1.pairs.map((p) => p.sortOrder), [0, 1, 2]);
  assert.deepEqual(gs2.pairs.map((p) => p.id), ["gp2"]);
  assert.deepEqual(gs2.pairs.map((p) => p.sortOrder), [0]);
  // Sibling gp3 reindexed 9 -> 2, present in nextPlan.
  assert.equal(findPair(result.nextPlan, "gp3")!.pair.sortOrder, 2);
  assert.deepEqual([...result.affected.stationIds].sort(), ["gs1", "gs2"]);
  // Swapped pairs are listed; the reindexed sibling gp3 is deliberately NOT.
  assert.deepEqual([...result.affected.pairIds].sort(), ["gp2", "gpa"]);
  assert.equal(result.affected.pairIds.includes("gp3"), false);
});

test("a hostile input with a throwing getter fails closed (MALFORMED_PLAN) without throwing", () => {
  const hostile = {
    id: "plan-h",
    version: 3,
    get blocks(): unknown {
      throw new Error("boom");
    },
  };
  let result: ReturnType<typeof applyComplexPlanMoveSwap> | undefined;
  assert.doesNotThrow(() => {
    result = applyComplexPlanMoveSwap(hostile as unknown as ComplexPlanInput, {
      op: "MOVE_HORSE",
      expectedVersion: 3,
      sourcePairId: "p2",
      destinationPairId: "p3",
    });
  });
  expectFailure(result!, "MALFORMED_PLAN");
});
