import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildScheduleItemActivityMap,
  type ScheduleMappableActivity,
} from "./instructor-riding-schedule-map-core";

// Tiny factory for a configured activity (has a RidingSlot) carrying the given
// schedule-item ids. Kept intentionally minimal - the core only reads
// scheduleItemIds + ridingSlot, nothing else, and no trainee/PII field exists
// on this shape.
function activity(slotId: string, scheduleItemIds: string[]): ScheduleMappableActivity {
  return { ridingSlot: { id: slotId }, scheduleItemIds };
}

test("one activity / one id maps that id to the activity", () => {
  const a = activity("slot-1", ["si-1"]);
  const map = buildScheduleItemActivityMap([a]);
  assert.equal(map.size, 1);
  assert.equal(map.get("si-1"), a);
});

test("a merged activity with multiple ids maps every id to the same activity", () => {
  const a = activity("slot-1", ["si-1", "si-2", "si-3"]);
  const map = buildScheduleItemActivityMap([a]);
  assert.equal(map.size, 3);
  assert.equal(map.get("si-1"), a);
  assert.equal(map.get("si-2"), a);
  assert.equal(map.get("si-3"), a);
});

test("multiple activities each map their own ids", () => {
  const a = activity("slot-1", ["si-1", "si-2"]);
  const b = activity("slot-2", ["si-3"]);
  const c = activity("slot-3", ["si-4", "si-5"]);
  const map = buildScheduleItemActivityMap([a, b, c]);
  assert.equal(map.get("si-1"), a);
  assert.equal(map.get("si-2"), a);
  assert.equal(map.get("si-3"), b);
  assert.equal(map.get("si-4"), c);
  assert.equal(map.get("si-5"), c);
  assert.equal(map.size, 5);
});

test("an unlinked id is absent from the map", () => {
  const a = activity("slot-1", ["si-1"]);
  const map = buildScheduleItemActivityMap([a]);
  assert.equal(map.has("si-unknown"), false);
  assert.equal(map.get("si-unknown"), undefined);
});

test("an empty id list contributes nothing", () => {
  const a = activity("slot-1", []);
  const b = activity("slot-2", ["si-1"]);
  const map = buildScheduleItemActivityMap([a, b]);
  assert.equal(map.size, 1);
  assert.equal(map.get("si-1"), b);
});

test("null / empty / whitespace / non-string ids are ignored safely", () => {
  const a = activity("slot-1", [
    "  si-1  ", // trimmed to a real id
    "",
    "   ",
    // deliberately malformed runtime values the type would not normally allow
    null as unknown as string,
    undefined as unknown as string,
    42 as unknown as string,
  ]);
  const map = buildScheduleItemActivityMap([a]);
  assert.equal(map.size, 1);
  assert.equal(map.get("si-1"), a);
  assert.equal(map.has(""), false);
});

test("an unconfigured activity (no ridingSlot) never enters the map", () => {
  const unconfigured: ScheduleMappableActivity = { ridingSlot: null, scheduleItemIds: ["si-1"] };
  const map = buildScheduleItemActivityMap([unconfigured]);
  assert.equal(map.size, 0);
  assert.equal(map.has("si-1"), false);
});

test("a duplicate id across two different activities fails closed (absent)", () => {
  const a = activity("slot-1", ["si-shared", "si-a"]);
  const b = activity("slot-2", ["si-shared", "si-b"]);
  const map = buildScheduleItemActivityMap([a, b]);
  // The contested id is deterministically absent - never guessed.
  assert.equal(map.has("si-shared"), false);
  // The non-contested ids of both activities still resolve normally.
  assert.equal(map.get("si-a"), a);
  assert.equal(map.get("si-b"), b);
});

test("a collision poisons the id even if a third activity later claims it", () => {
  const a = activity("slot-1", ["si-shared"]);
  const b = activity("slot-2", ["si-shared"]);
  const c = activity("slot-3", ["si-shared"]);
  const map = buildScheduleItemActivityMap([a, b, c]);
  assert.equal(map.has("si-shared"), false);
});

test("the same id repeated inside one activity is idempotent, not a collision", () => {
  const a = activity("slot-1", ["si-1", "si-1", "si-1"]);
  const map = buildScheduleItemActivityMap([a]);
  assert.equal(map.size, 1);
  assert.equal(map.get("si-1"), a);
});

test("output is independent of activity input order where no collision exists", () => {
  const a = activity("slot-1", ["si-1", "si-2"]);
  const b = activity("slot-2", ["si-3"]);
  const c = activity("slot-3", ["si-4"]);

  const forward = buildScheduleItemActivityMap([a, b, c]);
  const reversed = buildScheduleItemActivityMap([c, b, a]);

  for (const id of ["si-1", "si-2", "si-3", "si-4"]) {
    assert.equal(forward.get(id), reversed.get(id));
  }
  assert.equal(forward.size, reversed.size);
});

test("the input activities and their id arrays are not mutated", () => {
  const idsA = ["si-1", "si-2"];
  const idsB = ["si-1"]; // collides with a on si-1
  const a = activity("slot-1", idsA);
  const b = activity("slot-2", idsB);
  const input = [a, b];

  buildScheduleItemActivityMap(input);

  assert.deepEqual(idsA, ["si-1", "si-2"]);
  assert.deepEqual(idsB, ["si-1"]);
  assert.deepEqual(a, { ridingSlot: { id: "slot-1" }, scheduleItemIds: ["si-1", "si-2"] });
  assert.deepEqual(b, { ridingSlot: { id: "slot-2" }, scheduleItemIds: ["si-1"] });
  assert.equal(input.length, 2);
});
