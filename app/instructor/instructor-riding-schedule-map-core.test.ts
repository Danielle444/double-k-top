import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildScheduleItemActivityMap,
  resolveActivityForScheduleCardId,
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

// --- resolveActivityForScheduleCardId ---------------------------------------
// The schedule cards render a possibly "+"-joined composite id (merged/coalesced
// timegrid cards); the map above is keyed by atomic ids only. This resolver
// bridges the two, failing closed whenever the whole card does not map cleanly
// to exactly one activity.

// A lookup backed by the real atomic-keyed map - exactly what
// InstructorScheduleSection passes in (its resolveRidingActivity prop).
function lookupFor(activities: ScheduleMappableActivity[]) {
  const map = buildScheduleItemActivityMap(activities);
  return (scheduleItemId: string): ScheduleMappableActivity | null =>
    map.get(scheduleItemId) ?? null;
}

test("resolve: an atomic card id resolves normally", () => {
  const a = activity("slot-1", ["si-1"]);
  const lookup = lookupFor([a]);
  assert.equal(resolveActivityForScheduleCardId(lookup, "si-1"), a);
});

test("resolve: a two-part composite resolves to the shared activity", () => {
  const a = activity("slot-1", ["si-1", "si-2"]);
  const lookup = lookupFor([a]);
  assert.equal(resolveActivityForScheduleCardId(lookup, "si-1+si-2"), a);
});

test("resolve: a multi-part composite resolves to the shared activity", () => {
  const a = activity("slot-1", ["si-1", "si-2", "si-3"]);
  const lookup = lookupFor([a]);
  assert.equal(resolveActivityForScheduleCardId(lookup, "si-1+si-2+si-3"), a);
});

test("resolve: duplicate atomic parts resolving to the same activity are allowed", () => {
  const a = activity("slot-1", ["si-1"]);
  const lookup = lookupFor([a]);
  assert.equal(resolveActivityForScheduleCardId(lookup, "si-1+si-1+si-1"), a);
});

test("resolve: an unknown atomic id is null", () => {
  const a = activity("slot-1", ["si-1"]);
  const lookup = lookupFor([a]);
  assert.equal(resolveActivityForScheduleCardId(lookup, "si-unknown"), null);
});

test("resolve: a composite mixing a known and an unknown part fails closed to null", () => {
  const a = activity("slot-1", ["si-1"]);
  const lookup = lookupFor([a]);
  // Even though si-1 alone would resolve, the unknown si-2 poisons the whole
  // card - a configured merged activity is expected to own all of its ids.
  assert.equal(resolveActivityForScheduleCardId(lookup, "si-1+si-2"), null);
});

test("resolve: parts pointing at two different activities are null", () => {
  const a = activity("slot-1", ["si-1"]);
  const b = activity("slot-2", ["si-2"]);
  const lookup = lookupFor([a, b]);
  assert.equal(resolveActivityForScheduleCardId(lookup, "si-1+si-2"), null);
});

test("resolve: empty/whitespace parts around valid ids are ignored", () => {
  const a = activity("slot-1", ["si-1", "si-2"]);
  const lookup = lookupFor([a]);
  assert.equal(resolveActivityForScheduleCardId(lookup, "  si-1  + + si-2 "), a);
  assert.equal(resolveActivityForScheduleCardId(lookup, "+si-1+si-2+"), a);
});

test("resolve: an all-empty / whitespace-only card id is null", () => {
  const a = activity("slot-1", ["si-1"]);
  const lookup = lookupFor([a]);
  assert.equal(resolveActivityForScheduleCardId(lookup, ""), null);
  assert.equal(resolveActivityForScheduleCardId(lookup, "   "), null);
  assert.equal(resolveActivityForScheduleCardId(lookup, "+ + +"), null);
});

test("resolve: a missing lookup is null", () => {
  assert.equal(resolveActivityForScheduleCardId(undefined, "si-1"), null);
});

test("resolve: a malformed (non-string) runtime card id is null", () => {
  const a = activity("slot-1", ["si-1"]);
  const lookup = lookupFor([a]);
  assert.equal(
    resolveActivityForScheduleCardId(lookup, null as unknown as string),
    null
  );
  assert.equal(
    resolveActivityForScheduleCardId(lookup, undefined as unknown as string),
    null
  );
  assert.equal(
    resolveActivityForScheduleCardId(lookup, 42 as unknown as string),
    null
  );
});

test("resolve: neither the activities nor the map are mutated", () => {
  const a = activity("slot-1", ["si-1", "si-2"]);
  const b = activity("slot-2", ["si-3"]);
  const map = buildScheduleItemActivityMap([a, b]);
  const sizeBefore = map.size;
  const lookup = (scheduleItemId: string): ScheduleMappableActivity | null =>
    map.get(scheduleItemId) ?? null;

  resolveActivityForScheduleCardId(lookup, "si-1+si-2");
  resolveActivityForScheduleCardId(lookup, "si-1+si-3");
  resolveActivityForScheduleCardId(lookup, "si-unknown");

  assert.equal(map.size, sizeBefore);
  assert.equal(map.get("si-1"), a);
  assert.equal(map.get("si-2"), a);
  assert.equal(map.get("si-3"), b);
  assert.deepEqual(a, { ridingSlot: { id: "slot-1" }, scheduleItemIds: ["si-1", "si-2"] });
  assert.deepEqual(b, { ridingSlot: { id: "slot-2" }, scheduleItemIds: ["si-3"] });
});
