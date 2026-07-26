// RC-B1 - focused unit tests for the pure copy-preview projection core
// (buildComplexCopyPreview in ./copy-preview). DB-free and IO-free: it
// exercises only the pure function against explicit sanitized payloads.
//
// Run: npx tsx --test lib/riding-complex-template/copy-preview.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildComplexCopyPreview,
  COMPLEX_COPY_RESET_CODES,
} from "./copy-preview";
import type {
  DestinationBlockCreate,
  DestinationPairCreate,
  DestinationPlanCreate,
  DestinationStationCreate,
} from "./types";

function pair(overrides: Partial<DestinationPairCreate> = {}): DestinationPairCreate {
  return {
    trainee1Id: null,
    trainee2Id: null,
    horseName: null,
    note: null,
    sortOrder: 0,
    ...overrides,
  };
}

function station(overrides: Partial<DestinationStationCreate> = {}): DestinationStationCreate {
  return {
    instructorId: null,
    arena: null,
    sortOrder: 0,
    pairs: [],
    ...overrides,
  };
}

function block(overrides: Partial<DestinationBlockCreate> = {}): DestinationBlockCreate {
  return {
    startTime: "08:00",
    endTime: "09:00",
    sortOrder: 0,
    stations: [],
    ...overrides,
  };
}

function plan(blocks: DestinationBlockCreate[]): DestinationPlanCreate {
  return { blocks };
}

// 1. Empty sanitized plan -> zero counts and empty frozen collections.
test("an empty plan yields zero counts and empty frozen blocks", () => {
  const preview = buildComplexCopyPreview(plan([]));
  assert.equal(preview.blockCount, 0);
  assert.equal(preview.stationCount, 0);
  assert.equal(preview.pairCount, 0);
  assert.equal(preview.traineeCount, 0);
  assert.equal(preview.instructorCount, 0);
  assert.equal(preview.horseAssignmentCount, 0);
  assert.deepEqual(preview.blocks, []);
  assert.ok(Object.isFrozen(preview.blocks));
  assert.deepEqual(preview.resetSummary, COMPLEX_COPY_RESET_CODES);
});

// 2. Multiple blocks/stations/pairs aggregate correctly.
test("multiple blocks/stations/pairs aggregate correctly", () => {
  const preview = buildComplexCopyPreview(
    plan([
      block({
        startTime: "08:00",
        endTime: "09:00",
        stations: [
          station({ instructorId: "i1", arena: "A", pairs: [pair({ trainee1Id: "t1", horseName: "h1" })] }),
          station({ instructorId: "i2", arena: "B", pairs: [pair({ trainee1Id: "t2", trainee2Id: "t3" })] }),
        ],
      }),
      block({
        startTime: "10:00",
        endTime: "11:00",
        stations: [station({ instructorId: "i3", pairs: [pair({ trainee1Id: "t4", horseName: "h2" })] })],
      }),
    ])
  );
  assert.equal(preview.blockCount, 2);
  assert.equal(preview.stationCount, 3);
  assert.equal(preview.pairCount, 3);
  assert.equal(preview.traineeCount, 4); // t1,t2,t3,t4
  assert.equal(preview.instructorCount, 3); // i1,i2,i3
  assert.equal(preview.horseAssignmentCount, 2); // h1,h2

  const [b1, b2] = preview.blocks;
  assert.equal(b1.stationCount, 2);
  assert.equal(b1.pairCount, 2);
  assert.equal(b1.traineeCount, 3);
  assert.equal(b1.instructorCount, 2);
  assert.equal(b1.horseAssignmentCount, 1);
  assert.equal(b2.stationCount, 1);
  assert.equal(b2.traineeCount, 1);
  assert.equal(b2.horseAssignmentCount, 1);
});

// 3. A pair with two trainees counts two assignments.
test("a pair with two distinct trainees contributes two to the trainee count", () => {
  const preview = buildComplexCopyPreview(
    plan([block({ stations: [station({ pairs: [pair({ trainee1Id: "t1", trainee2Id: "t2" })] })] })])
  );
  assert.equal(preview.pairCount, 1);
  assert.equal(preview.traineeCount, 2);
  assert.deepEqual(preview.blocks[0].stations[0].traineeIds, ["t1", "t2"]);
});

// 4. A trainee repeated in different placements is deduplicated in the total.
test("a trainee reused across placements is counted once in the plan total", () => {
  const preview = buildComplexCopyPreview(
    plan([
      block({ stations: [station({ pairs: [pair({ trainee1Id: "t1" })] })] }),
      block({ stations: [station({ pairs: [pair({ trainee1Id: "t1" })] })] }),
    ])
  );
  assert.equal(preview.pairCount, 2);
  assert.equal(preview.traineeCount, 1);
  // Each block still reports its own local (deduped) count of 1.
  assert.equal(preview.blocks[0].traineeCount, 1);
  assert.equal(preview.blocks[1].traineeCount, 1);
});

// 5. An instructor repeated across stations is deduplicated in the total.
test("an instructor reused across stations is counted once in the plan total", () => {
  const preview = buildComplexCopyPreview(
    plan([
      block({
        stations: [
          station({ instructorId: "i1", pairs: [pair({ trainee1Id: "t1" })] }),
          station({ instructorId: "i1", pairs: [pair({ trainee1Id: "t2" })] }),
        ],
      }),
    ])
  );
  assert.equal(preview.stationCount, 2);
  assert.equal(preview.instructorCount, 1);
  assert.equal(preview.blocks[0].instructorCount, 1);
});

// 6. Empty trainee slots are not counted.
test("null/empty trainee slots are not counted", () => {
  const preview = buildComplexCopyPreview(
    plan([
      block({
        stations: [
          station({ pairs: [pair({ trainee1Id: "t1", trainee2Id: null }), pair({ trainee1Id: "", trainee2Id: "" })] }),
        ],
      }),
    ])
  );
  assert.equal(preview.pairCount, 2);
  assert.equal(preview.traineeCount, 1); // only t1
  assert.deepEqual(preview.blocks[0].stations[0].traineeIds, ["t1"]);
});

// 7. Empty instructor ids are not counted.
test("null/empty instructor ids are not counted", () => {
  const preview = buildComplexCopyPreview(
    plan([
      block({
        stations: [
          station({ instructorId: null, pairs: [pair({ trainee1Id: "t1" })] }),
          station({ instructorId: "", pairs: [pair({ trainee1Id: "t2" })] }),
        ],
      }),
    ])
  );
  assert.equal(preview.instructorCount, 0);
  assert.equal(preview.blocks[0].stations[0].instructorId, null);
  assert.equal(preview.blocks[0].stations[1].instructorId, null);
});

// 8. Empty horse names are not counted.
test("null/empty horse names are not counted", () => {
  const preview = buildComplexCopyPreview(
    plan([
      block({
        stations: [
          station({ pairs: [pair({ trainee1Id: "t1", horseName: null }), pair({ trainee1Id: "t2", horseName: "" })] }),
        ],
      }),
    ])
  );
  assert.equal(preview.horseAssignmentCount, 0);
  assert.deepEqual(preview.blocks[0].stations[0].horseNames, []);
});

// 9. Structural order is preserved (never re-sorted).
test("structural order of blocks, stations, and pairs is preserved", () => {
  const preview = buildComplexCopyPreview(
    plan([
      block({
        startTime: "10:00",
        stations: [
          station({ arena: "Z", pairs: [pair({ trainee1Id: "tb" }), pair({ trainee1Id: "ta" })] }),
          station({ arena: "A" }),
        ],
      }),
      block({ startTime: "08:00" }),
    ])
  );
  assert.deepEqual(preview.blocks.map((b) => b.startTime), ["10:00", "08:00"]);
  assert.deepEqual(preview.blocks[0].stations.map((s) => s.arena), ["Z", "A"]);
  assert.deepEqual(preview.blocks[0].stations[0].traineeIds, ["tb", "ta"]);
});

// 10. Reset summary is always present and correct.
test("the reset summary is always present and complete", () => {
  const expected = [
    "PUBLICATION_STATE",
    "FEEDBACK",
    "ATTENDANCE",
    "COMPLETION_HISTORY",
    "SOURCE_IDENTIFIERS",
    "SOURCE_SCHEDULE_IDENTITY",
    "STALE_VERSION_METADATA",
  ];
  const empty = buildComplexCopyPreview(plan([]));
  const full = buildComplexCopyPreview(
    plan([block({ stations: [station({ instructorId: "i1", pairs: [pair({ trainee1Id: "t1" })] })] })])
  );
  assert.deepEqual(empty.resetSummary, expected);
  assert.deepEqual(full.resetSummary, expected);
  assert.ok(Object.isFrozen(empty.resetSummary));
});

// 11. Inputs are not mutated.
test("inputs are never mutated (including deeply frozen inputs)", () => {
  const input = plan([
    block({ stations: [station({ instructorId: "i1", pairs: [pair({ trainee1Id: "t1", horseName: "h1" })] })] }),
  ]);
  const snapshot = JSON.stringify(input);
  buildComplexCopyPreview(input);
  assert.equal(JSON.stringify(input), snapshot);

  const frozen = Object.freeze({
    blocks: Object.freeze([
      Object.freeze({
        startTime: "08:00",
        endTime: "09:00",
        sortOrder: 0,
        stations: Object.freeze([
          Object.freeze({
            instructorId: "i1",
            arena: "A",
            sortOrder: 0,
            pairs: Object.freeze([Object.freeze(pair({ trainee1Id: "t1" }))]),
          }),
        ]),
      }),
    ]),
  }) as DestinationPlanCreate;
  assert.doesNotThrow(() => buildComplexCopyPreview(frozen));
});

// 12. Returned objects and arrays are frozen.
test("the returned preview and every nested object/array are frozen", () => {
  const preview = buildComplexCopyPreview(
    plan([block({ stations: [station({ instructorId: "i1", pairs: [pair({ trainee1Id: "t1", horseName: "h1" })] })] })])
  );
  assert.ok(Object.isFrozen(preview));
  assert.ok(Object.isFrozen(preview.blocks));
  assert.ok(Object.isFrozen(preview.blocks[0]));
  assert.ok(Object.isFrozen(preview.blocks[0].stations));
  assert.ok(Object.isFrozen(preview.blocks[0].stations[0]));
  assert.ok(Object.isFrozen(preview.blocks[0].stations[0].traineeIds));
  assert.ok(Object.isFrozen(preview.blocks[0].stations[0].horseNames));
  assert.ok(Object.isFrozen(preview.blocks[0].stations[0].pairs));
  assert.ok(Object.isFrozen(preview.blocks[0].stations[0].pairs[0]));
  assert.ok(Object.isFrozen(preview.resetSummary));
});

// 13. No source/database/publication/history fields leak into the preview.
test("no source/db/publication/history fields leak into the preview", () => {
  const preview = buildComplexCopyPreview(
    plan([block({ stations: [station({ instructorId: "i1", arena: "A", pairs: [pair({ trainee1Id: "t1", note: "n" })] })] })])
  );
  const forbidden = [
    "id",
    "planId",
    "blockId",
    "stationId",
    "sortOrder",
    "createdAt",
    "updatedAt",
    "version",
    "sourceVersion",
    "sourceBlockId",
    "sourceStationId",
    "sourcePairId",
    "publicationId",
    "publication",
    "firstPublishedAt",
  ];
  const planKeys = Object.keys(preview);
  const blockKeys = Object.keys(preview.blocks[0]);
  const stationKeys = Object.keys(preview.blocks[0].stations[0]);
  const pairKeys = Object.keys(preview.blocks[0].stations[0].pairs[0]);
  for (const key of forbidden) {
    assert.ok(!planKeys.includes(key), `plan leaked ${key}`);
    assert.ok(!blockKeys.includes(key), `block leaked ${key}`);
    assert.ok(!stationKeys.includes(key), `station leaked ${key}`);
    assert.ok(!pairKeys.includes(key), `pair leaked ${key}`);
  }
  // The pair preview carries exactly the four planning-safe content fields.
  assert.deepEqual(pairKeys.sort(), ["horseName", "note", "trainee1Id", "trainee2Id"]);
  assert.equal(preview.blocks[0].stations[0].pairs[0].note, "n");
});

// 14. Malformed optional arrays fail safely without throwing.
test("malformed/missing arrays and null elements fail safely", () => {
  // blocks missing entirely.
  assert.doesNotThrow(() => buildComplexCopyPreview({} as unknown as DestinationPlanCreate));
  const noBlocks = buildComplexCopyPreview({} as unknown as DestinationPlanCreate);
  assert.equal(noBlocks.blockCount, 0);
  assert.deepEqual(noBlocks.resetSummary, COMPLEX_COPY_RESET_CODES);

  // null plan.
  assert.doesNotThrow(() => buildComplexCopyPreview(null as unknown as DestinationPlanCreate));
  assert.equal(buildComplexCopyPreview(null as unknown as DestinationPlanCreate).blockCount, 0);

  // stations not an array; pairs null; null elements interspersed.
  const messy = {
    blocks: [
      null,
      { startTime: "08:00", endTime: "09:00", sortOrder: 0, stations: undefined },
      {
        startTime: "10:00",
        endTime: "11:00",
        sortOrder: 0,
        stations: [
          null,
          { instructorId: "i1", arena: null, sortOrder: 0, pairs: null },
          {
            instructorId: "i2",
            arena: "A",
            sortOrder: 0,
            pairs: [null, pair({ trainee1Id: "t1", horseName: "h1" })],
          },
        ],
      },
    ],
  } as unknown as DestinationPlanCreate;
  let preview: ReturnType<typeof buildComplexCopyPreview> | undefined;
  assert.doesNotThrow(() => {
    preview = buildComplexCopyPreview(messy);
  });
  assert.ok(preview);
  // Two well-formed blocks survive (the null block is skipped).
  assert.equal(preview!.blockCount, 2);
  assert.equal(preview!.stationCount, 2); // the two non-null stations in block 2
  assert.equal(preview!.pairCount, 1); // only the one non-null pair
  assert.equal(preview!.traineeCount, 1);
  assert.equal(preview!.instructorCount, 2); // i1 and i2
  assert.equal(preview!.horseAssignmentCount, 1);
});
