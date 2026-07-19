// Pure unit tests for selectPreviousSource. Run: npx tsx --test lib/riding-complex-template/select-source.test.ts
//
// Pure and DB-free: no Prisma, no network, no clock, no randomness.

import test from "node:test";
import assert from "node:assert/strict";

import { selectPreviousSource } from "./select-source";
import type {
  DestinationSlotDescriptor,
  SourceCandidateDescriptor,
} from "./types";

const DESTINATION: DestinationSlotDescriptor = {
  slotId: "dest",
  anchorDateKey: "2026-07-19",
  resolvedGroup: "A",
};

function candidate(
  overrides: Partial<SourceCandidateDescriptor> = {}
): SourceCandidateDescriptor {
  return {
    slotId: "s1",
    anchorDateKey: "2026-07-12",
    startTime: "09:00",
    resolvedGroup: "A",
    blockCount: 2,
    ...overrides,
  };
}

test("a previous session (any weekday) is selected", () => {
  // 2026-07-12 is a Sunday, 2026-07-19 (destination) is also a Sunday, but the
  // selector never infers or requires a matching weekday.
  const result = selectPreviousSource(DESTINATION, [candidate({ slotId: "prev", anchorDateKey: "2026-07-15" })]);
  assert.equal(result?.slotId, "prev");
});

test("the closest earlier date wins", () => {
  const result = selectPreviousSource(DESTINATION, [
    candidate({ slotId: "far", anchorDateKey: "2026-07-01" }),
    candidate({ slotId: "near", anchorDateKey: "2026-07-18" }),
    candidate({ slotId: "mid", anchorDateKey: "2026-07-10" }),
  ]);
  assert.equal(result?.slotId, "near");
});

test("same-day candidate is excluded", () => {
  const result = selectPreviousSource(DESTINATION, [candidate({ slotId: "today", anchorDateKey: "2026-07-19" })]);
  assert.equal(result, null);
});

test("future candidate is excluded", () => {
  const result = selectPreviousSource(DESTINATION, [candidate({ slotId: "future", anchorDateKey: "2026-07-26" })]);
  assert.equal(result, null);
});

test("different group is excluded", () => {
  const result = selectPreviousSource(DESTINATION, [candidate({ slotId: "otherGroup", resolvedGroup: "B" })]);
  assert.equal(result, null);
});

test("the destination slot itself is excluded even if otherwise eligible", () => {
  const result = selectPreviousSource(DESTINATION, [
    candidate({ slotId: "dest", anchorDateKey: "2026-07-10" }),
  ]);
  assert.equal(result, null);
});

test("a zero-block candidate is excluded", () => {
  const result = selectPreviousSource(DESTINATION, [candidate({ slotId: "empty", blockCount: 0 })]);
  assert.equal(result, null);
});

test("a single-block candidate is eligible (blockCount >= 1)", () => {
  const result = selectPreviousSource(DESTINATION, [candidate({ slotId: "one", blockCount: 1 })]);
  assert.equal(result?.slotId, "one");
});

test("published/unpublished state is not part of the contract (no such field is read)", () => {
  // Extra publication-shaped properties on the candidate are simply ignored;
  // eligibility is unaffected by anything but the allow-listed fields.
  const withExtra = {
    ...candidate({ slotId: "unpublished" }),
    isPublished: false,
    publicationStatus: "UNPUBLISHED",
    version: 7,
  } as unknown as SourceCandidateDescriptor;
  const result = selectPreviousSource(DESTINATION, [withExtra]);
  assert.equal(result?.slotId, "unpublished");
  // And the returned object never carries those extra keys.
  assert.deepEqual(Object.keys(result ?? {}).sort(), [
    "anchorDateKey",
    "blockCount",
    "resolvedGroup",
    "slotId",
    "startTime",
  ]);
});

test("tie-break: same date -> latest startTime -> largest slotId", () => {
  const result = selectPreviousSource(DESTINATION, [
    candidate({ slotId: "aaa", anchorDateKey: "2026-07-12", startTime: "10:00" }),
    candidate({ slotId: "bbb", anchorDateKey: "2026-07-12", startTime: "10:00" }),
    candidate({ slotId: "ccc", anchorDateKey: "2026-07-12", startTime: "08:00" }),
  ]);
  // Same date: "10:00" beats "08:00"; between the two 10:00s, "bbb" > "aaa".
  assert.equal(result?.slotId, "bbb");
  assert.equal(result?.startTime, "10:00");
});

test("malformed candidates are ignored, valid ones still win", () => {
  const malformed: SourceCandidateDescriptor[] = [
    { slotId: "", anchorDateKey: "2026-07-10", startTime: "09:00", resolvedGroup: "A", blockCount: 2 },
    { slotId: "badDate", anchorDateKey: "2026-13-40", startTime: "09:00", resolvedGroup: "A", blockCount: 2 },
    { slotId: "badGroup", anchorDateKey: "2026-07-10", startTime: "09:00", resolvedGroup: "", blockCount: 2 },
    { slotId: "nanBlocks", anchorDateKey: "2026-07-10", startTime: "09:00", resolvedGroup: "A", blockCount: Number.NaN },
    { slotId: "floatBlocks", anchorDateKey: "2026-07-10", startTime: "09:00", resolvedGroup: "A", blockCount: 1.5 },
  ];
  const result = selectPreviousSource(DESTINATION, [...malformed, candidate({ slotId: "good", anchorDateKey: "2026-07-08" })]);
  assert.equal(result?.slotId, "good");
});

test("all-malformed candidate set -> null", () => {
  const result = selectPreviousSource(DESTINATION, [
    candidate({ slotId: "badDate", anchorDateKey: "nope" }),
    candidate({ slotId: "zero", blockCount: 0 }),
  ]);
  assert.equal(result, null);
});

test("input order does not change the result", () => {
  const items = [
    candidate({ slotId: "a", anchorDateKey: "2026-07-05", startTime: "07:00" }),
    candidate({ slotId: "b", anchorDateKey: "2026-07-18", startTime: "07:00" }),
    candidate({ slotId: "c", anchorDateKey: "2026-07-18", startTime: "11:00" }),
  ];
  const forward = selectPreviousSource(DESTINATION, items);
  const reversed = selectPreviousSource(DESTINATION, [...items].reverse());
  assert.deepEqual(forward, reversed);
  assert.equal(forward?.slotId, "c");
});

test("no candidates -> null", () => {
  assert.equal(selectPreviousSource(DESTINATION, []), null);
});

test("inputs are not mutated", () => {
  const items = [candidate({ slotId: "a", anchorDateKey: "2026-07-05" }), candidate({ slotId: "b", anchorDateKey: "2026-07-18" })];
  const destSnapshot = { ...DESTINATION };
  const itemsSnapshot = JSON.parse(JSON.stringify(items));
  selectPreviousSource(DESTINATION, items);
  assert.deepEqual(DESTINATION, destSnapshot);
  assert.deepEqual(items, itemsSnapshot);
});
