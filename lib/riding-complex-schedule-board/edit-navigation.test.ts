// Pure unit tests for the schedule-board edit-navigation decisions. Run:
//   npx tsx --test lib/riding-complex-schedule-board/edit-navigation.test.ts
//
// These tests are pure and DB-free: no Prisma, no server actions, no React,
// no network, no clock, no randomness. Every input is a fixed literal.

import test from "node:test";
import assert from "node:assert/strict";

import {
  showsBoardEditControl,
  boardEditTargetExists,
  resolveScheduleEditReturn,
  type EditNavBlockShape,
} from "./edit-navigation";

test("edit control is visible only for an editable actor with a routable id", () => {
  // Editable actor, real id -> shown.
  assert.equal(showsBoardEditControl(true, "block-1"), true);
  // Read-only viewer -> never shown, even with a real id.
  assert.equal(showsBoardEditControl(false, "block-1"), false);
  // Editable actor but no stable id to route to -> not shown.
  assert.equal(showsBoardEditControl(true, null), false);
  assert.equal(showsBoardEditControl(true, undefined), false);
  assert.equal(showsBoardEditControl(true, ""), false);
});

const blocks: EditNavBlockShape[] = [
  { id: "b1", stations: [{ id: "s1" }, { id: "s2" }] },
  { id: "b2", stations: [] },
];

test("stale reference: missing block or station is detected safely", () => {
  // Existing block, no station requested -> present.
  assert.equal(boardEditTargetExists(blocks, "b1", null), true);
  // Existing block + existing station -> present.
  assert.equal(boardEditTargetExists(blocks, "b1", "s2"), true);
  // Existing block but station gone -> missing.
  assert.equal(boardEditTargetExists(blocks, "b1", "sX"), false);
  // Block gone entirely -> missing (with or without a station).
  assert.equal(boardEditTargetExists(blocks, "bX", null), false);
  assert.equal(boardEditTargetExists(blocks, "bX", "s1"), false);
  // Block with no stations, station requested -> missing.
  assert.equal(boardEditTargetExists(blocks, "b2", "s1"), false);
});

test("board-origin station edit returns to the board focused on the station", () => {
  assert.deepEqual(resolveScheduleEditReturn("board", { blockId: "b1", stationId: "s2" }), {
    kind: "board",
    focusBlockId: "b1",
    focusStationId: "s2",
  });
});

test("board-origin block edit returns to the board focused on the block (no station)", () => {
  assert.deepEqual(resolveScheduleEditReturn("board", { blockId: "b1", stationId: null }), {
    kind: "board",
    focusBlockId: "b1",
    focusStationId: null,
  });
});

test("list-origin returns the pass-through marker so existing list behavior is kept", () => {
  assert.deepEqual(resolveScheduleEditReturn("list", { blockId: "b1", stationId: "s2" }), { kind: "list" });
  assert.deepEqual(resolveScheduleEditReturn("list", { blockId: "b1", stationId: null }), { kind: "list" });
});
