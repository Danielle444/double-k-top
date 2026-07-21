// Pure unit tests for the plan-wide pair placement index (Stage 3D.1). Run:
//   npx tsx --test lib/riding-complex-schedule-board/pair-placement-index.test.ts
//
// Pure and DB-free: no Prisma, server actions, React, network, clock, or random.
// Every input is a fixed literal built fresh per test so mutation, determinism,
// plan-wide routing, and fail-closed behaviour can be asserted precisely.

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPairPlacementIndex,
  resolvePairPlacement,
  resolveStationPlacement,
  type PairPlacementPlanInput,
} from "./pair-placement-index";

// Two blocks. b1: s1 holds p1, p2; s2 holds p3. s3 is EMPTY. b2: s4 holds p4.
function basePlan(): PairPlacementPlanInput {
  return {
    blocks: [
      {
        id: "b1",
        stations: [
          { id: "s1", pairs: [{ id: "p1" }, { id: "p2" }] },
          { id: "s2", pairs: [{ id: "p3" }] },
          { id: "s3", pairs: [] },
        ],
      },
      {
        id: "b2",
        stations: [{ id: "s4", pairs: [{ id: "p4" }] }],
      },
    ],
  };
}

const snapshot = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

test("resolves a pair to its exact block/station/pair", () => {
  const index = buildPairPlacementIndex(basePlan());
  assert.deepEqual(resolvePairPlacement(index, "p1"), {
    status: "FOUND",
    blockId: "b1",
    stationId: "s1",
    pairId: "p1",
  });
  assert.deepEqual(resolvePairPlacement(index, "p3"), {
    status: "FOUND",
    blockId: "b1",
    stationId: "s2",
    pairId: "p3",
  });
  // Cross-block: p4 lives in b2/s4.
  assert.deepEqual(resolvePairPlacement(index, "p4"), {
    status: "FOUND",
    blockId: "b2",
    stationId: "s4",
    pairId: "p4",
  });
});

test("resolves a station - including an EMPTY station - to its block", () => {
  const index = buildPairPlacementIndex(basePlan());
  assert.deepEqual(resolveStationPlacement(index, "s1"), { status: "FOUND", blockId: "b1", stationId: "s1" });
  // Empty station s3 is still a resolvable (valid, empty) destination.
  assert.deepEqual(resolveStationPlacement(index, "s3"), { status: "FOUND", blockId: "b1", stationId: "s3" });
  assert.deepEqual(resolveStationPlacement(index, "s4"), { status: "FOUND", blockId: "b2", stationId: "s4" });
});

test("a missing pair/station resolves MISSING", () => {
  const index = buildPairPlacementIndex(basePlan());
  assert.deepEqual(resolvePairPlacement(index, "nope"), { status: "MISSING" });
  assert.deepEqual(resolveStationPlacement(index, "nope"), { status: "MISSING" });
});

test("multiple normal blocks/stations/pairs each route independently", () => {
  const index = buildPairPlacementIndex(basePlan());
  for (const [pairId, blockId, stationId] of [
    ["p1", "b1", "s1"],
    ["p2", "b1", "s1"],
    ["p3", "b1", "s2"],
    ["p4", "b2", "s4"],
  ] as const) {
    assert.deepEqual(resolvePairPlacement(index, pairId), { status: "FOUND", blockId, stationId, pairId });
  }
});

test("a duplicate pair id anywhere in the plan resolves AMBIGUOUS", () => {
  const plan: PairPlacementPlanInput = {
    blocks: [
      {
        id: "b1",
        stations: [
          { id: "s1", pairs: [{ id: "dup" }] },
          { id: "s2", pairs: [{ id: "dup" }] },
        ],
      },
    ],
  };
  const index = buildPairPlacementIndex(plan);
  assert.deepEqual(resolvePairPlacement(index, "dup"), { status: "AMBIGUOUS" });
  // A non-duplicated sibling in the same plan still routes.
  assert.deepEqual(resolveStationPlacement(index, "s1"), { status: "FOUND", blockId: "b1", stationId: "s1" });
});

test("a duplicate pair id ACROSS blocks resolves AMBIGUOUS", () => {
  const plan: PairPlacementPlanInput = {
    blocks: [
      { id: "b1", stations: [{ id: "s1", pairs: [{ id: "dup" }] }] },
      { id: "b2", stations: [{ id: "s2", pairs: [{ id: "dup" }] }] },
    ],
  };
  const index = buildPairPlacementIndex(plan);
  assert.deepEqual(resolvePairPlacement(index, "dup"), { status: "AMBIGUOUS" });
});

test("a duplicate station id POISONS the station AND every pair nested under it", () => {
  // The same station id appears under two different blocks. Its own resolution is
  // AMBIGUOUS, and each uniquely-identified pair under EITHER occurrence is also
  // AMBIGUOUS: a pair under a duplicated station has no confident station/time
  // context, so it must fail closed rather than expose a guessed location. A pair in
  // an unrelated, uniquely-identified station still routes normally.
  const plan: PairPlacementPlanInput = {
    blocks: [
      {
        id: "b1",
        stations: [
          { id: "dupStation", pairs: [{ id: "p1" }] },
          { id: "cleanStation", pairs: [{ id: "pClean" }] },
        ],
      },
      { id: "b2", stations: [{ id: "dupStation", pairs: [{ id: "p2" }] }] },
    ],
  };
  const index = buildPairPlacementIndex(plan);
  assert.deepEqual(resolveStationPlacement(index, "dupStation"), { status: "AMBIGUOUS" });
  // Every pair under every occurrence of the duplicated station is AMBIGUOUS - the
  // pair under the FIRST occurrence (p1) as well as the second (p2).
  assert.deepEqual(resolvePairPlacement(index, "p1"), { status: "AMBIGUOUS" });
  assert.deepEqual(resolvePairPlacement(index, "p2"), { status: "AMBIGUOUS" });
  // Control: an unrelated unique station and its pair remain usable.
  assert.deepEqual(resolveStationPlacement(index, "cleanStation"), {
    status: "FOUND",
    blockId: "b1",
    stationId: "cleanStation",
  });
  assert.deepEqual(resolvePairPlacement(index, "pClean"), {
    status: "FOUND",
    blockId: "b1",
    stationId: "cleanStation",
    pairId: "pClean",
  });
});

test("a duplicate block id POISONS all of its nested station/pair routing", () => {
  // The same block id appears twice. Every station/pair under either occurrence is
  // unroutable (its containing block is ambiguous) -> AMBIGUOUS. A pair/station in a
  // DIFFERENT, non-duplicated block still routes normally.
  const plan: PairPlacementPlanInput = {
    blocks: [
      { id: "dupBlock", stations: [{ id: "s1", pairs: [{ id: "p1" }] }] },
      { id: "dupBlock", stations: [{ id: "s2", pairs: [{ id: "p2" }] }] },
      { id: "b3", stations: [{ id: "s3", pairs: [{ id: "p3" }] }] },
    ],
  };
  const index = buildPairPlacementIndex(plan);
  assert.deepEqual(resolvePairPlacement(index, "p1"), { status: "AMBIGUOUS" });
  assert.deepEqual(resolvePairPlacement(index, "p2"), { status: "AMBIGUOUS" });
  assert.deepEqual(resolveStationPlacement(index, "s1"), { status: "AMBIGUOUS" });
  assert.deepEqual(resolveStationPlacement(index, "s2"), { status: "AMBIGUOUS" });
  // The clean block is untouched.
  assert.deepEqual(resolvePairPlacement(index, "p3"), {
    status: "FOUND",
    blockId: "b3",
    stationId: "s3",
    pairId: "p3",
  });
  assert.deepEqual(resolveStationPlacement(index, "s3"), { status: "FOUND", blockId: "b3", stationId: "s3" });
});

test("a poisoned block never merges into a usable target even for a unique id", () => {
  // A station id that appears ONLY under a poisoned block is still AMBIGUOUS - the
  // duplicated block never collapses into a single usable target.
  const plan: PairPlacementPlanInput = {
    blocks: [
      { id: "dupBlock", stations: [{ id: "onlyHere", pairs: [{ id: "onlyPair" }] }] },
      { id: "dupBlock", stations: [] },
    ],
  };
  const index = buildPairPlacementIndex(plan);
  assert.deepEqual(resolveStationPlacement(index, "onlyHere"), { status: "AMBIGUOUS" });
  assert.deepEqual(resolvePairPlacement(index, "onlyPair"), { status: "AMBIGUOUS" });
});

test("a malformed station is skipped and never becomes a valid empty destination", () => {
  const plan: PairPlacementPlanInput = {
    blocks: [
      {
        id: "b1",
        stations: [
          // No id -> malformed -> skipped whole (its pair is unroutable too).
          { id: null as unknown as string, pairs: [{ id: "orphan" }] },
          { id: "s2", pairs: [{ id: "p2" }] },
        ],
      },
    ],
  };
  const index = buildPairPlacementIndex(plan);
  // The malformed station is not a resolvable empty destination.
  assert.deepEqual(resolveStationPlacement(index, "s2"), { status: "FOUND", blockId: "b1", stationId: "s2" });
  // Its pair is unroutable -> MISSING (fail closed).
  assert.deepEqual(resolvePairPlacement(index, "orphan"), { status: "MISSING" });
  // The clean sibling still routes.
  assert.deepEqual(resolvePairPlacement(index, "p2"), {
    status: "FOUND",
    blockId: "b1",
    stationId: "s2",
    pairId: "p2",
  });
});

test("a malformed block/pair id is skipped, valid siblings still resolve", () => {
  const plan: PairPlacementPlanInput = {
    blocks: [
      // Malformed block (no id) -> skipped entirely.
      { id: 0 as unknown as string, stations: [{ id: "sx", pairs: [{ id: "px" }] }] },
      {
        id: "b2",
        stations: [
          {
            id: "s2",
            pairs: [
              { id: "" as unknown as string }, // blank pair id -> skipped
              { id: "p2" },
            ],
          },
        ],
      },
    ],
  };
  const index = buildPairPlacementIndex(plan);
  assert.deepEqual(resolveStationPlacement(index, "sx"), { status: "MISSING" });
  assert.deepEqual(resolvePairPlacement(index, "px"), { status: "MISSING" });
  assert.deepEqual(resolvePairPlacement(index, "p2"), {
    status: "FOUND",
    blockId: "b2",
    stationId: "s2",
    pairId: "p2",
  });
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
    { blocks: [{ id: "b1", stations: [null, { pairs: null }] }] },
    { blocks: [{ id: "b1", stations: [{ id: "s1", pairs: [null, 7, { id: null }] }] }] },
    { blocks: [{ id: "b1", stations: [{ id: "s1", pairs: [{ id: {} }] }] }] },
  ];
  for (const input of malformed) {
    assert.doesNotThrow(() => {
      const index = buildPairPlacementIndex(input as PairPlacementPlanInput);
      assert.deepEqual(resolvePairPlacement(index, "definitely-missing"), { status: "MISSING" });
      assert.deepEqual(resolveStationPlacement(index, "definitely-missing"), { status: "MISSING" });
    });
  }
});

test("resolving a blank/non-string id fails closed to MISSING", () => {
  const index = buildPairPlacementIndex(basePlan());
  assert.deepEqual(resolvePairPlacement(index, "" as unknown as string), { status: "MISSING" });
  assert.deepEqual(resolveStationPlacement(index, 5 as unknown as string), { status: "MISSING" });
});

test("deterministic and non-mutating: input untouched, output stable", () => {
  const plan = basePlan();
  const before = snapshot(plan);
  const a = buildPairPlacementIndex(plan);
  const b = buildPairPlacementIndex(plan);
  assert.deepEqual(snapshot(plan), before, "input must not be mutated");
  assert.deepEqual(resolvePairPlacement(a, "p1"), resolvePairPlacement(b, "p1"));
  assert.deepEqual(resolveStationPlacement(a, "s3"), resolveStationPlacement(b, "s3"));
});

test("caller-owned input is not frozen; index and results are frozen", () => {
  const plan = basePlan();
  const index = buildPairPlacementIndex(plan);
  assert.equal(Object.isFrozen(plan), false, "caller input must not be frozen");
  assert.equal(Object.isFrozen(index), true);
  const pair = resolvePairPlacement(index, "p1");
  assert.equal(Object.isFrozen(pair), true);
  const station = resolveStationPlacement(index, "s1");
  assert.equal(Object.isFrozen(station), true);
});

test("carries structural ids only - no pair contents copied", () => {
  // The descriptor deliberately has no room for trainees/horse/note; assert the
  // FOUND results expose exactly the id keys and nothing else.
  const index = buildPairPlacementIndex(basePlan());
  const pair = resolvePairPlacement(index, "p1");
  assert.equal(pair.status, "FOUND");
  if (pair.status === "FOUND") {
    assert.deepEqual(Object.keys(pair).sort(), ["blockId", "pairId", "stationId", "status"]);
  }
  const station = resolveStationPlacement(index, "s1");
  assert.equal(station.status, "FOUND");
  if (station.status === "FOUND") {
    assert.deepEqual(Object.keys(station).sort(), ["blockId", "stationId", "status"]);
  }
});
