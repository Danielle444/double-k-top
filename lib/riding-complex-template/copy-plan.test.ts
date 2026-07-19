// Pure unit tests for copyPlanForTemplate. Run: npx tsx --test lib/riding-complex-template/copy-plan.test.ts
//
// Pure and DB-free: no Prisma, no network, no clock, no randomness.

import test from "node:test";
import assert from "node:assert/strict";

import { copyPlanForTemplate } from "./copy-plan";
import type { DestinationPlanCreate, SourcePlanTree } from "./types";

const ACTIVE = new Set(["coach-1", "coach-2"]);
const ROSTER = new Set(["t-1", "t-2", "t-3", "t-4"]);

// Recursively collect every own property key that appears anywhere in a value.
function allKeys(value: unknown, acc: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const el of value) allKeys(el, acc);
  } else if (value && typeof value === "object") {
    for (const key of Object.keys(value)) {
      acc.add(key);
      allKeys((value as Record<string, unknown>)[key], acc);
    }
  }
  return acc;
}

const ALLOWED_KEYS = new Set([
  "blocks",
  "startTime",
  "endTime",
  "sortOrder",
  "stations",
  "instructorId",
  "arena",
  "pairs",
  "trainee1Id",
  "trainee2Id",
  "horseName",
  "note",
]);

test("a complete block/station/pair tree is copied by the allow-list", () => {
  const source: SourcePlanTree = {
    blocks: [
      {
        startTime: "09:00",
        endTime: "09:45",
        stations: [
          {
            instructorId: "coach-1",
            arena: "Arena 1",
            pairs: [{ trainee1Id: "t-1", trainee2Id: "t-2", horseName: "Bella", note: "warm up" }],
          },
        ],
      },
    ],
  };
  const out = copyPlanForTemplate(source, ACTIVE, ROSTER);
  assert.equal(out.blocks.length, 1);
  const block = out.blocks[0];
  assert.equal(block.startTime, "09:00");
  assert.equal(block.endTime, "09:45");
  assert.equal(block.sortOrder, 0);
  const station = block.stations[0];
  assert.equal(station.instructorId, "coach-1");
  assert.equal(station.arena, "Arena 1");
  const pair = station.pairs[0];
  assert.equal(pair.trainee1Id, "t-1");
  assert.equal(pair.trainee2Id, "t-2");
  assert.equal(pair.horseName, "Bella");
  assert.equal(pair.note, "warm up");
});

test("an active instructor is retained; an inactive/missing one is nulled", () => {
  const source: SourcePlanTree = {
    blocks: [
      {
        startTime: "09:00",
        endTime: "10:00",
        stations: [
          { instructorId: "coach-2", arena: "A", pairs: [] },
          { instructorId: "coach-999", arena: "B", pairs: [] },
          { instructorId: null, arena: "C", pairs: [] },
        ],
      },
    ],
  };
  const stations = copyPlanForTemplate(source, ACTIVE, ROSTER).blocks[0].stations;
  assert.equal(stations[0].instructorId, "coach-2");
  assert.equal(stations[1].instructorId, null);
  assert.equal(stations[2].instructorId, null);
});

test("only-trainee2-valid is promoted into position 1", () => {
  const source: SourcePlanTree = {
    blocks: [{ startTime: "09:00", endTime: "10:00", stations: [{ instructorId: "coach-1", arena: "A", pairs: [{ trainee1Id: "ghost", trainee2Id: "t-3", horseName: "H", note: null }] }] }],
  };
  const pair = copyPlanForTemplate(source, ACTIVE, ROSTER).blocks[0].stations[0].pairs[0];
  assert.equal(pair.trainee1Id, "t-3");
  assert.equal(pair.trainee2Id, null);
  assert.equal(pair.horseName, "H");
});

test("only-trainee1-valid is retained; the invalid trainee2 is nulled", () => {
  const source: SourcePlanTree = {
    blocks: [{ startTime: "09:00", endTime: "10:00", stations: [{ instructorId: "coach-1", arena: "A", pairs: [{ trainee1Id: "t-2", trainee2Id: "ghost", horseName: "H", note: "n" }] }] }],
  };
  const pair = copyPlanForTemplate(source, ACTIVE, ROSTER).blocks[0].stations[0].pairs[0];
  assert.equal(pair.trainee1Id, "t-2");
  assert.equal(pair.trainee2Id, null);
});

test("a pair with neither trainee valid is dropped", () => {
  const source: SourcePlanTree = {
    blocks: [
      {
        startTime: "09:00",
        endTime: "10:00",
        stations: [
          {
            instructorId: "coach-1",
            arena: "A",
            pairs: [
              { trainee1Id: "ghost1", trainee2Id: "ghost2", horseName: "H", note: "n" },
              { trainee1Id: "t-1", trainee2Id: null, horseName: "K", note: null },
            ],
          },
        ],
      },
    ],
  };
  const pairs = copyPlanForTemplate(source, ACTIVE, ROSTER).blocks[0].stations[0].pairs;
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].trainee1Id, "t-1");
  assert.equal(pairs[0].sortOrder, 0);
});

test("the same trainee in both positions is collapsed to one, never duplicated", () => {
  const source: SourcePlanTree = {
    blocks: [{ startTime: "09:00", endTime: "10:00", stations: [{ instructorId: "coach-1", arena: "A", pairs: [{ trainee1Id: "t-4", trainee2Id: "t-4", horseName: "H", note: "n" }] }] }],
  };
  const pair = copyPlanForTemplate(source, ACTIVE, ROSTER).blocks[0].stations[0].pairs[0];
  assert.equal(pair.trainee1Id, "t-4");
  assert.equal(pair.trainee2Id, null);
});

test("horseName and note are preserved for a retained pair (including null/empty)", () => {
  const source: SourcePlanTree = {
    blocks: [
      {
        startTime: "09:00",
        endTime: "10:00",
        stations: [
          {
            instructorId: "coach-1",
            arena: "A",
            pairs: [
              { trainee1Id: "t-1", trainee2Id: "t-2", horseName: "", note: "keep me" },
              { trainee1Id: "t-3", trainee2Id: null, horseName: null, note: undefined },
            ],
          },
        ],
      },
    ],
  };
  const pairs = copyPlanForTemplate(source, ACTIVE, ROSTER).blocks[0].stations[0].pairs;
  assert.equal(pairs[0].horseName, "");
  assert.equal(pairs[0].note, "keep me");
  assert.equal(pairs[1].horseName, null);
  assert.equal(pairs[1].note, null);
});

test("sortOrder is regenerated sequentially at block, station and pair levels", () => {
  const source: SourcePlanTree = {
    blocks: [
      {
        startTime: "09:00",
        endTime: "10:00",
        stations: [
          {
            instructorId: "coach-1",
            arena: "A",
            pairs: [
              { trainee1Id: "ghost", trainee2Id: "ghost2", horseName: "x", note: null }, // dropped
              { trainee1Id: "t-1", trainee2Id: null, horseName: "a", note: null },
              { trainee1Id: "t-2", trainee2Id: null, horseName: "b", note: null },
            ],
          },
          { instructorId: "coach-2", arena: "B", pairs: [{ trainee1Id: "t-3", trainee2Id: null, horseName: "c", note: null }] },
        ],
      },
      { startTime: "10:00", endTime: "11:00", stations: [{ instructorId: null, arena: "C", pairs: [] }] },
    ],
  };
  const out = copyPlanForTemplate(source, ACTIVE, ROSTER);
  assert.deepEqual(out.blocks.map((b) => b.sortOrder), [0, 1]);
  assert.deepEqual(out.blocks[0].stations.map((s) => s.sortOrder), [0, 1]);
  // The dropped pair does not leave a gap: retained pairs are 0,1.
  assert.deepEqual(out.blocks[0].stations[0].pairs.map((p) => p.sortOrder), [0, 1]);
  assert.deepEqual(out.blocks[0].stations[1].pairs.map((p) => p.sortOrder), [0]);
});

test("no forbidden keys appear anywhere in the output", () => {
  const source: SourcePlanTree = {
    blocks: [{ startTime: "09:00", endTime: "10:00", stations: [{ instructorId: "coach-1", arena: "A", pairs: [{ trainee1Id: "t-1", trainee2Id: "t-2", horseName: "H", note: "n" }] }] }],
  };
  const out = copyPlanForTemplate(source, ACTIVE, ROSTER);
  for (const key of allKeys(out)) {
    assert.equal(ALLOWED_KEYS.has(key), true, `unexpected key '${key}' in output`);
  }
});

test("publication/feedback/audit-shaped extra source properties cannot enter the output", () => {
  // The source objects carry a pile of forbidden extra properties; none may
  // survive into the sanitized create tree.
  const source = {
    blocks: [
      {
        id: "block-id",
        planId: "plan-id",
        createdAt: "2026-01-01",
        updatedAt: "2026-01-02",
        version: 9,
        startTime: "09:00",
        endTime: "10:00",
        stations: [
          {
            id: "station-id",
            blockId: "block-id",
            createdAt: "x",
            instructorId: "coach-1",
            arena: "A",
            pairs: [
              {
                id: "pair-id",
                stationId: "station-id",
                createdAt: "y",
                updatedAt: "z",
                ratingHalfPoints: 8,
                attended: true,
                completedAt: "w",
                publicationId: "pub-id",
                trainee1Id: "t-1",
                trainee2Id: "t-2",
                horseName: "H",
                note: "n",
              },
            ],
          },
        ],
      },
    ],
  } as unknown as SourcePlanTree;
  const out = copyPlanForTemplate(source, ACTIVE, ROSTER);
  const keys = allKeys(out);
  for (const forbidden of ["id", "planId", "blockId", "stationId", "publicationId", "createdAt", "updatedAt", "version", "ratingHalfPoints", "attended", "completedAt"]) {
    assert.equal(keys.has(forbidden), false, `forbidden key '${forbidden}' leaked into output`);
  }
});

test("empty structures are handled and preserved", () => {
  const empty: SourcePlanTree = { blocks: [] };
  assert.deepEqual(copyPlanForTemplate(empty, ACTIVE, ROSTER), { blocks: [] });

  const emptyBlock: SourcePlanTree = { blocks: [{ startTime: "09:00", endTime: "10:00", stations: [] }] };
  const out = copyPlanForTemplate(emptyBlock, ACTIVE, ROSTER);
  assert.equal(out.blocks.length, 1);
  assert.deepEqual(out.blocks[0].stations, []);

  const emptyStation: SourcePlanTree = { blocks: [{ startTime: "09:00", endTime: "10:00", stations: [{ instructorId: "coach-1", arena: "A", pairs: [] }] }] };
  const out2 = copyPlanForTemplate(emptyStation, ACTIVE, ROSTER);
  assert.deepEqual(out2.blocks[0].stations[0].pairs, []);
});

test("missing optional references do not throw and resolve to null", () => {
  const source = {
    blocks: [
      {
        startTime: "09:00",
        endTime: "10:00",
        stations: [{ arena: undefined, pairs: [{ horseName: undefined, note: undefined }] }],
      },
    ],
  } as unknown as SourcePlanTree;
  const out = copyPlanForTemplate(source, ACTIVE, ROSTER);
  const station = out.blocks[0].stations[0];
  assert.equal(station.instructorId, null);
  assert.equal(station.arena, null);
  // The pair has no valid trainee, so it is dropped.
  assert.deepEqual(station.pairs, []);
});

test("source objects and both Sets are not mutated", () => {
  const source: SourcePlanTree = {
    blocks: [{ startTime: "09:00", endTime: "10:00", stations: [{ instructorId: "coach-1", arena: "A", pairs: [{ trainee1Id: "t-1", trainee2Id: "ghost", horseName: "H", note: "n" }] }] }],
  };
  const sourceSnapshot = JSON.parse(JSON.stringify(source));
  const active = new Set(ACTIVE);
  const roster = new Set(ROSTER);
  copyPlanForTemplate(source, active, roster);
  assert.deepEqual(source, sourceSnapshot);
  assert.deepEqual([...active].sort(), [...ACTIVE].sort());
  assert.deepEqual([...roster].sort(), [...ROSTER].sort());
});

test("deterministic: identical input yields deep-equal output twice", () => {
  const source: SourcePlanTree = {
    blocks: [{ startTime: "09:00", endTime: "10:00", stations: [{ instructorId: "coach-1", arena: "A", pairs: [{ trainee1Id: "t-1", trainee2Id: "t-2", horseName: "H", note: "n" }] }] }],
  };
  const a: DestinationPlanCreate = copyPlanForTemplate(source, ACTIVE, ROSTER);
  const b: DestinationPlanCreate = copyPlanForTemplate(source, ACTIVE, ROSTER);
  assert.deepEqual(a, b);
});
