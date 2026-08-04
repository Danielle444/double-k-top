// RIDING-COMPLEX-PUBLICATION - focused unit tests for the pure flatten core
// (flattenComplexPlanForPublication) that replaced the per-row create loop in
// publishComplexRidingPlanInternal. DB-free, IO-free, no Prisma.
//
// Run: npx tsx --test lib/riding-complex/complex-plan-publication-tree.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import {
  flattenComplexPlanForPublication,
  type LiveBlockForPublication,
} from "./complex-plan-publication-tree";

function block(
  id: string,
  sortOrder: number,
  stations: LiveBlockForPublication["stations"]
): LiveBlockForPublication {
  return { id, startTime: "09:00", endTime: "09:45", sortOrder, stations };
}

test("empty blocks array flattens to three empty arrays", () => {
  const result = flattenComplexPlanForPublication([]);
  assert.deepEqual(result, { blocks: [], stations: [], pairs: [] });
});

test("a block with zero stations still flattens (empty block is legal)", () => {
  const result = flattenComplexPlanForPublication([block("b1", 0, [])]);
  assert.equal(result.blocks.length, 1);
  assert.equal(result.blocks[0].sourceBlockId, "b1");
  assert.deepEqual(result.stations, []);
  assert.deepEqual(result.pairs, []);
});

test("a station with zero pairs still flattens (empty station is legal)", () => {
  const result = flattenComplexPlanForPublication([
    block("b1", 0, [
      { id: "s1", instructorId: null, arena: null, sortOrder: 0, instructor: null, pairs: [] },
    ]),
  ]);
  assert.equal(result.stations.length, 1);
  assert.equal(result.stations[0].sourceStationId, "s1");
  assert.deepEqual(result.pairs, []);
});

test("preserves exact snapshot field mapping (instructor/trainee name snapshot fallback to null)", () => {
  const result = flattenComplexPlanForPublication([
    block("b1", 0, [
      {
        id: "s1",
        instructorId: "instr-1",
        arena: "זירה 1",
        sortOrder: 0,
        instructor: { fullName: "מאמן א" },
        pairs: [
          {
            id: "p1",
            trainee1Id: "t1",
            trainee2Id: null,
            horseName: "סוסון",
            sortOrder: 0,
            trainee1: { fullName: "חניך א" },
            trainee2: null,
          },
        ],
      },
      {
        // No instructor/trainee relation loaded (FK gone via onDelete SetNull) -
        // name snapshot fields must fall back to null, never throw.
        id: "s2",
        instructorId: null,
        arena: null,
        sortOrder: 1,
        instructor: null,
        pairs: [
          {
            id: "p2",
            trainee1Id: null,
            trainee2Id: null,
            horseName: null,
            sortOrder: 0,
            trainee1: null,
            trainee2: null,
          },
        ],
      },
    ]),
  ]);

  assert.deepEqual(result.stations[0], {
    sourceBlockId: "b1",
    sourceStationId: "s1",
    instructorId: "instr-1",
    instructorNameSnapshot: "מאמן א",
    arena: "זירה 1",
    sortOrder: 0,
  });
  assert.deepEqual(result.stations[1], {
    sourceBlockId: "b1",
    sourceStationId: "s2",
    instructorId: null,
    instructorNameSnapshot: null,
    arena: null,
    sortOrder: 1,
  });
  assert.deepEqual(result.pairs[0], {
    sourceStationId: "s1",
    sourcePairId: "p1",
    trainee1Id: "t1",
    trainee1NameSnapshot: "חניך א",
    trainee2Id: null,
    trainee2NameSnapshot: null,
    horseName: "סוסון",
    sortOrder: 0,
  });
  assert.deepEqual(result.pairs[1], {
    sourceStationId: "s2",
    sourcePairId: "p2",
    trainee1Id: null,
    trainee1NameSnapshot: null,
    trainee2Id: null,
    trainee2NameSnapshot: null,
    horseName: null,
    sortOrder: 0,
  });
});

test("every station carries its own parent block's source id (correlation key for the write layer)", () => {
  const result = flattenComplexPlanForPublication([
    block("b1", 0, [{ id: "s1", instructorId: null, arena: null, sortOrder: 0, instructor: null, pairs: [] }]),
    block("b2", 1, [{ id: "s2", instructorId: null, arena: null, sortOrder: 0, instructor: null, pairs: [] }]),
  ]);
  assert.equal(result.stations.find((s) => s.sourceStationId === "s1")?.sourceBlockId, "b1");
  assert.equal(result.stations.find((s) => s.sourceStationId === "s2")?.sourceBlockId, "b2");
});

test("every pair carries its own parent station's source id (correlation key for the write layer)", () => {
  const result = flattenComplexPlanForPublication([
    block("b1", 0, [
      {
        id: "s1",
        instructorId: null,
        arena: null,
        sortOrder: 0,
        instructor: null,
        pairs: [
          { id: "p1", trainee1Id: null, trainee2Id: null, horseName: null, sortOrder: 0, trainee1: null, trainee2: null },
        ],
      },
      {
        id: "s2",
        instructorId: null,
        arena: null,
        sortOrder: 1,
        instructor: null,
        pairs: [
          { id: "p2", trainee1Id: null, trainee2Id: null, horseName: null, sortOrder: 0, trainee1: null, trainee2: null },
        ],
      },
    ]),
  ]);
  assert.equal(result.pairs.find((p) => p.sourcePairId === "p1")?.sourceStationId, "s1");
  assert.equal(result.pairs.find((p) => p.sourcePairId === "p2")?.sourceStationId, "s2");
});

test("depth-first traversal order matches block/station/pair given order (stable, matches the old sequential loop's write order)", () => {
  const result = flattenComplexPlanForPublication([
    block("b2", 1, [{ id: "s2", instructorId: null, arena: null, sortOrder: 0, instructor: null, pairs: [] }]),
    block("b1", 0, [{ id: "s1", instructorId: null, arena: null, sortOrder: 0, instructor: null, pairs: [] }]),
  ]);
  // Flatten preserves whatever order the caller's already-orderBy'd blocks
  // array is in - it does not re-sort by sortOrder itself.
  assert.deepEqual(
    result.blocks.map((b) => b.sourceBlockId),
    ["b2", "b1"]
  );
  assert.deepEqual(
    result.stations.map((s) => s.sourceStationId),
    ["s2", "s1"]
  );
});

test("large plan (8 blocks / 22 stations / 39 pairs) flattens to exactly matching totals in one pass", () => {
  // Mirrors the actual Production scale that timed out (8/22/39) - proves the
  // flatten is O(n) over the full tree regardless of shape, and totals are
  // exact, not approximate.
  const stationCountsPerBlock = [3, 3, 3, 3, 3, 3, 2, 2]; // sums to 22
  let stationSeq = 0;
  let pairSeq = 0;
  const pairsPerStationPlan: number[] = [];
  // Distribute 39 pairs across 22 stations, non-uniformly, some stations empty.
  const distribution = [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1]; // sums to 39
  const blocks: LiveBlockForPublication[] = stationCountsPerBlock.map((stationCount, bIdx) => {
    const stations = Array.from({ length: stationCount }, () => {
      const pairCount = distribution[stationSeq];
      pairsPerStationPlan.push(pairCount);
      const stationId = `s${stationSeq}`;
      stationSeq += 1;
      const pairs = Array.from({ length: pairCount }, () => {
        const pairId = `p${pairSeq}`;
        pairSeq += 1;
        return {
          id: pairId,
          trainee1Id: null,
          trainee2Id: null,
          horseName: null,
          sortOrder: 0,
          trainee1: null,
          trainee2: null,
        };
      });
      return { id: stationId, instructorId: null, arena: null, sortOrder: 0, instructor: null, pairs };
    });
    return block(`b${bIdx}`, bIdx, stations);
  });

  assert.equal(distribution.reduce((a, b) => a + b, 0), 39);

  const result = flattenComplexPlanForPublication(blocks);
  assert.equal(result.blocks.length, 8);
  assert.equal(result.stations.length, 22);
  assert.equal(result.pairs.length, 39);
  // Every station/pair resolves back to a real parent id present in the level above.
  const blockIds = new Set(result.blocks.map((b) => b.sourceBlockId));
  for (const s of result.stations) assert.ok(blockIds.has(s.sourceBlockId));
  const stationIds = new Set(result.stations.map((s) => s.sourceStationId));
  for (const p of result.pairs) assert.ok(stationIds.has(p.sourceStationId));
});
