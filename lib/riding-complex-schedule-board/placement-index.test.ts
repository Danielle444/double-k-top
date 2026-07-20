// Pure unit tests for the block-scoped trainee placement index (Stage 3C.1). Run:
//   npx tsx --test lib/riding-complex-schedule-board/placement-index.test.ts
//
// Pure and DB-free: no Prisma, server actions, React, network, clock, or random.
// Every input is a fixed literal built fresh per test so mutation, determinism,
// block-scoping, and fail-closed behaviour can be asserted precisely.

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTraineePlacementIndex,
  resolvePairOccupants,
  resolveTraineePlacement,
  type PlacementPlanInput,
} from "./placement-index";

// Two blocks. In b1: s1 has p1 (stu1 seat1, stu2 seat2) and p2 (stu3 seat1,
// empty seat2). s2 has p3 (empty). In b2: s3 has p4 (stu1 seat1) - the SAME
// stu1, in another block, which must NOT count as occupied in b1.
function basePlan(): PlacementPlanInput {
  return {
    blocks: [
      {
        id: "b1",
        stations: [
          {
            id: "s1",
            pairs: [
              { id: "p1", trainee1Id: "stu1", trainee2Id: "stu2" },
              { id: "p2", trainee1Id: "stu3", trainee2Id: null },
            ],
          },
          { id: "s2", pairs: [{ id: "p3", trainee1Id: null, trainee2Id: null }] },
        ],
      },
      {
        id: "b2",
        stations: [{ id: "s3", pairs: [{ id: "p4", trainee1Id: "stu1", trainee2Id: null }] }],
      },
    ],
  };
}

const snapshot = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

test("resolves a trainee in slot 1", () => {
  const index = buildTraineePlacementIndex(basePlan());
  const placement = resolveTraineePlacement(index, "b1", "stu1");
  assert.deepEqual(placement, {
    status: "OCCUPIED",
    at: { blockId: "b1", stationId: "s1", pairId: "p1", slot: 1 },
  });
});

test("resolves a trainee in slot 2", () => {
  const index = buildTraineePlacementIndex(basePlan());
  const placement = resolveTraineePlacement(index, "b1", "stu2");
  assert.deepEqual(placement, {
    status: "OCCUPIED",
    at: { blockId: "b1", stationId: "s1", pairId: "p1", slot: 2 },
  });
});

test("a free trainee resolves FREE", () => {
  const index = buildTraineePlacementIndex(basePlan());
  assert.deepEqual(resolveTraineePlacement(index, "b1", "nobody"), { status: "FREE" });
});

test("the same trainee in another block is not occupied here (block-scoped)", () => {
  const index = buildTraineePlacementIndex(basePlan());
  // stu1 is in b1/p1 and (separately) in b2/p4. Querying b2 finds its b2 seat,
  // querying b1 finds its b1 seat - neither leaks across.
  assert.deepEqual(resolveTraineePlacement(index, "b2", "stu1"), {
    status: "OCCUPIED",
    at: { blockId: "b2", stationId: "s3", pairId: "p4", slot: 1 },
  });
  // stu2 lives only in b1 -> FREE in b2.
  assert.deepEqual(resolveTraineePlacement(index, "b2", "stu2"), { status: "FREE" });
});

test("a duplicate trainee inside one block resolves AMBIGUOUS", () => {
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
            ],
          },
        ],
      },
    ],
  };
  const index = buildTraineePlacementIndex(plan);
  assert.deepEqual(resolveTraineePlacement(index, "b1", "dup"), { status: "AMBIGUOUS" });
});

test("resolves the occupants of a pair, and null for a missing/other-block pair", () => {
  const index = buildTraineePlacementIndex(basePlan());
  assert.deepEqual(resolvePairOccupants(index, "b1", "p1"), { trainee1Id: "stu1", trainee2Id: "stu2" });
  assert.deepEqual(resolvePairOccupants(index, "b1", "p2"), { trainee1Id: "stu3", trainee2Id: null });
  assert.deepEqual(resolvePairOccupants(index, "b1", "p3"), { trainee1Id: null, trainee2Id: null });
  // p4 lives in b2, so it is not resolvable within b1.
  assert.equal(resolvePairOccupants(index, "b1", "p4"), null);
  assert.equal(resolvePairOccupants(index, "b1", "missing"), null);
  assert.equal(resolvePairOccupants(index, "missingBlock", "p1"), null);
});

test("a duplicated pair id inside one block resolves to null occupants", () => {
  const plan: PlacementPlanInput = {
    blocks: [
      {
        id: "b1",
        stations: [
          { id: "s1", pairs: [{ id: "dupPair", trainee1Id: "a", trainee2Id: null }] },
          { id: "s2", pairs: [{ id: "dupPair", trainee1Id: "b", trainee2Id: null }] },
        ],
      },
    ],
  };
  const index = buildTraineePlacementIndex(plan);
  assert.equal(resolvePairOccupants(index, "b1", "dupPair"), null);
});

test("malformed / null / sparse input fails closed without throwing", () => {
  const malformed: unknown[] = [
    null,
    undefined,
    {},
    { blocks: null },
    { blocks: "nope" },
    { blocks: [null, 42, "x"] },
    { blocks: [{ id: "b1", stations: null }] },
    { blocks: [{ id: null, stations: [] }] },
    { blocks: [{ id: "b1", stations: [null, { id: null, pairs: [] }] }] },
    { blocks: [{ id: "b1", stations: [{ id: "s1", pairs: [null, 7, { id: null }] }] }] },
    { blocks: [{ id: "b1", stations: [{ id: "s1", pairs: [{ id: "p", trainee1Id: 5, trainee2Id: {} }] }] }] },
  ];
  for (const input of malformed) {
    assert.doesNotThrow(() => {
      const index = buildTraineePlacementIndex(input as PlacementPlanInput);
      // Every lookup on a degenerate index is safe and non-occupying.
      assert.deepEqual(resolveTraineePlacement(index, "b1", "stu1"), { status: "FREE" });
      assert.equal(resolvePairOccupants(index, "b1", "definitely-missing"), null);
    });
  }
});

test("a valid pair id with a non-string trainee1Id fails closed (strict seat)", () => {
  const plan: PlacementPlanInput = {
    blocks: [
      {
        id: "b1",
        stations: [
          {
            id: "s1",
            pairs: [
              // Valid pair id, but a corrupt (non-string, non-null) seat 1.
              { id: "corrupt", trainee1Id: 5 as unknown as string, trainee2Id: "keep2" },
              { id: "p2", trainee1Id: "stu9", trainee2Id: null },
            ],
          },
        ],
      },
    ],
  };
  const index = buildTraineePlacementIndex(plan);
  // The corrupt pair registers no destination and no placements.
  assert.equal(resolvePairOccupants(index, "b1", "corrupt"), null);
  assert.deepEqual(resolveTraineePlacement(index, "b1", "keep2"), { status: "FREE" });
  // A valid sibling pair still resolves normally.
  assert.deepEqual(resolveTraineePlacement(index, "b1", "stu9"), {
    status: "OCCUPIED",
    at: { blockId: "b1", stationId: "s1", pairId: "p2", slot: 1 },
  });
});

test("a valid pair id with a non-string trainee2Id fails closed (strict seat)", () => {
  const plan: PlacementPlanInput = {
    blocks: [
      {
        id: "b1",
        stations: [
          {
            id: "s1",
            pairs: [{ id: "corrupt", trainee1Id: "keep1", trainee2Id: {} as unknown as string }],
          },
        ],
      },
    ],
  };
  const index = buildTraineePlacementIndex(plan);
  assert.equal(resolvePairOccupants(index, "b1", "corrupt"), null);
  assert.deepEqual(resolveTraineePlacement(index, "b1", "keep1"), { status: "FREE" });
});

test("a corrupt-seat pair build is non-mutating and never throws", () => {
  const plan: PlacementPlanInput = {
    blocks: [
      {
        id: "b1",
        stations: [{ id: "s1", pairs: [{ id: "corrupt", trainee1Id: 7 as unknown as string, trainee2Id: null }] }],
      },
    ],
  };
  const before = snapshot(plan);
  assert.doesNotThrow(() => buildTraineePlacementIndex(plan));
  assert.deepEqual(snapshot(plan), before, "corrupt input must not be mutated");
});

test("a duplicate block id does not select an arbitrary placement (AMBIGUOUS)", () => {
  // The same block id appears twice, each placing `stu` in a different pair.
  // Merged in-block, `stu` is duplicated -> AMBIGUOUS, never an arbitrary pick.
  const plan: PlacementPlanInput = {
    blocks: [
      { id: "b1", stations: [{ id: "s1", pairs: [{ id: "p1", trainee1Id: "stu", trainee2Id: null }] }] },
      { id: "b1", stations: [{ id: "s2", pairs: [{ id: "p2", trainee1Id: "stu", trainee2Id: null }] }] },
    ],
  };
  const index = buildTraineePlacementIndex(plan);
  assert.deepEqual(resolveTraineePlacement(index, "b1", "stu"), { status: "AMBIGUOUS" });
});

test("a malformed pair contributes no placement, valid siblings still resolve", () => {
  const plan: PlacementPlanInput = {
    blocks: [
      {
        id: "b1",
        stations: [
          {
            id: "s1",
            pairs: [
              // Malformed (non-string id + non-string seat) -> skipped entirely.
              { id: 0 as unknown as string, trainee1Id: 5 as unknown as string, trainee2Id: null },
              { id: "p2", trainee1Id: "stu9", trainee2Id: null },
            ],
          },
        ],
      },
    ],
  };
  const index = buildTraineePlacementIndex(plan);
  assert.deepEqual(resolveTraineePlacement(index, "b1", "stu9"), {
    status: "OCCUPIED",
    at: { blockId: "b1", stationId: "s1", pairId: "p2", slot: 1 },
  });
});

test("deterministic and non-mutating: input is untouched, output is stable", () => {
  const plan = basePlan();
  const before = snapshot(plan);
  const a = buildTraineePlacementIndex(plan);
  const b = buildTraineePlacementIndex(plan);
  assert.deepEqual(snapshot(plan), before, "input must not be mutated");
  assert.deepEqual(resolveTraineePlacement(a, "b1", "stu1"), resolveTraineePlacement(b, "b1", "stu1"));
});

test("the input plan is not frozen (caller-owned), the results are frozen", () => {
  const plan = basePlan();
  const index = buildTraineePlacementIndex(plan);
  assert.equal(Object.isFrozen(plan), false, "caller input must not be frozen");
  assert.equal(Object.isFrozen(index), true);
  const placement = resolveTraineePlacement(index, "b1", "stu1");
  assert.equal(Object.isFrozen(placement), true);
  const occupants = resolvePairOccupants(index, "b1", "p1");
  assert.equal(Object.isFrozen(occupants), true);
});

test("carries no names/PII beyond structural ids (index holds only positions)", () => {
  // The index deliberately stores only ids/positions. Confirm the occupancy
  // result exposes exactly the four positional keys and nothing name-like.
  const index = buildTraineePlacementIndex(basePlan());
  const placement = resolveTraineePlacement(index, "b1", "stu1");
  assert.equal(placement.status, "OCCUPIED");
  if (placement.status === "OCCUPIED") {
    assert.deepEqual(Object.keys(placement.at).sort(), ["blockId", "pairId", "slot", "stationId"]);
  }
});
