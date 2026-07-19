// Pure unit tests for resolveAnchor. Run: npx tsx --test lib/riding-complex-template/resolve-anchor.test.ts
//
// These tests are pure and DB-free: no Prisma, no network, no clock, no
// randomness. Every descriptor is a fixed literal.

import test from "node:test";
import assert from "node:assert/strict";

import { resolveAnchor } from "./resolve-anchor";
import type { LinkedScheduleItemDescriptor } from "./types";

function item(
  overrides: Partial<LinkedScheduleItemDescriptor> = {}
): LinkedScheduleItemDescriptor {
  return {
    id: "i1",
    dateKey: "2026-07-19",
    startTime: "09:00",
    groupName: "A",
    ...overrides,
  };
}

test("empty item list -> ineligible NO_SCHEDULE_ITEMS", () => {
  const result = resolveAnchor([]);
  assert.equal(result.eligible, false);
  assert.equal(result.eligible === false && result.reason, "NO_SCHEDULE_ITEMS");
});

test("a null element fails closed as NO_SCHEDULE_ITEMS (no throw)", () => {
  let result: ReturnType<typeof resolveAnchor> | undefined;
  assert.doesNotThrow(() => {
    result = resolveAnchor([null as unknown as LinkedScheduleItemDescriptor]);
  });
  assert.equal(result?.eligible, false);
  assert.equal(result?.eligible === false && result.reason, "NO_SCHEDULE_ITEMS");
});

test("an undefined element fails closed as NO_SCHEDULE_ITEMS (no throw)", () => {
  let result: ReturnType<typeof resolveAnchor> | undefined;
  assert.doesNotThrow(() => {
    result = resolveAnchor([undefined as unknown as LinkedScheduleItemDescriptor]);
  });
  assert.equal(result?.eligible, false);
  assert.equal(result?.eligible === false && result.reason, "NO_SCHEDULE_ITEMS");
});

test("a sparse array with a missing element fails closed as NO_SCHEDULE_ITEMS (no throw)", () => {
  // A genuine hole: index 1 is never assigned, so `length` is 3 but the middle
  // element is absent. Must not throw and must reuse NO_SCHEDULE_ITEMS.
  const sparse: LinkedScheduleItemDescriptor[] = [item({ id: "a" })];
  sparse[2] = item({ id: "c" }); // leaves index 1 as a sparse hole
  let result: ReturnType<typeof resolveAnchor> | undefined;
  assert.doesNotThrow(() => {
    result = resolveAnchor(sparse);
  });
  assert.equal(result?.eligible, false);
  assert.equal(result?.eligible === false && result.reason, "NO_SCHEDULE_ITEMS");
});

test("one valid item -> eligible with its date, group and start time", () => {
  const result = resolveAnchor([item({ id: "x", dateKey: "2026-07-10", startTime: "08:30", groupName: "B" })]);
  assert.equal(result.eligible, true);
  if (result.eligible) {
    assert.equal(result.anchorDateKey, "2026-07-10");
    assert.equal(result.resolvedGroup, "B");
    assert.equal(result.startTime.value, "08:30");
    assert.equal(result.startTime.anchorItemId, "x");
  }
});

test("multiple same-group items -> eligible with that shared group", () => {
  const result = resolveAnchor([
    item({ id: "a", groupName: "A" }),
    item({ id: "b", groupName: "A" }),
    item({ id: "c", groupName: "A" }),
  ]);
  assert.equal(result.eligible, true);
  assert.equal(result.eligible && result.resolvedGroup, "A");
});

test("earliest valid date is selected as the anchor date", () => {
  const result = resolveAnchor([
    item({ id: "late", dateKey: "2026-07-20", startTime: "07:00" }),
    item({ id: "early", dateKey: "2026-07-05", startTime: "10:00" }),
    item({ id: "mid", dateKey: "2026-07-12", startTime: "06:00" }),
  ]);
  assert.equal(result.eligible, true);
  if (result.eligible) {
    assert.equal(result.anchorDateKey, "2026-07-05");
    // Start-time metadata reflects the item ON the anchor date, not the
    // globally-earliest start time (06:00 belongs to a later date).
    assert.equal(result.startTime.value, "10:00");
    assert.equal(result.startTime.anchorItemId, "early");
  }
});

test("on the anchor date, earliest start time wins; ties break by smallest id", () => {
  const result = resolveAnchor([
    item({ id: "z", dateKey: "2026-07-05", startTime: "09:00" }),
    item({ id: "a", dateKey: "2026-07-05", startTime: "09:00" }),
    item({ id: "b", dateKey: "2026-07-05", startTime: "08:00" }),
  ]);
  assert.equal(result.eligible, true);
  if (result.eligible) {
    assert.equal(result.startTime.value, "08:00");
    assert.equal(result.startTime.anchorItemId, "b");
  }
});

test("null group -> ineligible MISSING_GROUP", () => {
  const result = resolveAnchor([item({ groupName: null })]);
  assert.equal(result.eligible, false);
  assert.equal(result.eligible === false && result.reason, "MISSING_GROUP");
});

test("empty-string group -> ineligible MISSING_GROUP", () => {
  const result = resolveAnchor([item({ groupName: "" })]);
  assert.equal(result.eligible, false);
  assert.equal(result.eligible === false && result.reason, "MISSING_GROUP");
});

test("a later item with a null group also fails MISSING_GROUP", () => {
  const result = resolveAnchor([item({ id: "a", groupName: "A" }), item({ id: "b", groupName: null })]);
  assert.equal(result.eligible, false);
  assert.equal(result.eligible === false && result.reason, "MISSING_GROUP");
});

test("mismatched group names -> ineligible AMBIGUOUS_GROUP", () => {
  const result = resolveAnchor([item({ id: "a", groupName: "A" }), item({ id: "b", groupName: "B" })]);
  assert.equal(result.eligible, false);
  assert.equal(result.eligible === false && result.reason, "AMBIGUOUS_GROUP");
});

test("malformed date key -> ineligible INVALID_DATE_KEY", () => {
  for (const bad of ["2026-7-9", "2026/07/09", "20260709", "2026-13-01", "2026-02-30", "", "not-a-date"]) {
    const result = resolveAnchor([item({ dateKey: bad })]);
    assert.equal(result.eligible, false, `dateKey '${bad}' must be ineligible`);
    assert.equal(result.eligible === false && result.reason, "INVALID_DATE_KEY");
  }
});

test("group comparison is exact string equality (no trim/case normalization)", () => {
  // " A" !== "A" and "a" !== "A": both are ambiguous, never silently merged.
  assert.equal(
    resolveAnchor([item({ id: "a", groupName: "A" }), item({ id: "b", groupName: " A" })]).eligible,
    false
  );
  assert.equal(
    resolveAnchor([item({ id: "a", groupName: "A" }), item({ id: "b", groupName: "a" })]).eligible,
    false
  );
});

test("input array and its descriptors are not mutated", () => {
  const input: LinkedScheduleItemDescriptor[] = [
    item({ id: "b", dateKey: "2026-07-20", startTime: "09:00", groupName: "A" }),
    item({ id: "a", dateKey: "2026-07-05", startTime: "08:00", groupName: "A" }),
  ];
  const snapshot = JSON.parse(JSON.stringify(input));
  resolveAnchor(input);
  assert.deepEqual(input, snapshot);
});

test("deterministic and input-order-independent", () => {
  const forward = resolveAnchor([
    item({ id: "a", dateKey: "2026-07-05", startTime: "08:00", groupName: "A" }),
    item({ id: "b", dateKey: "2026-07-10", startTime: "07:00", groupName: "A" }),
  ]);
  const reversed = resolveAnchor([
    item({ id: "b", dateKey: "2026-07-10", startTime: "07:00", groupName: "A" }),
    item({ id: "a", dateKey: "2026-07-05", startTime: "08:00", groupName: "A" }),
  ]);
  assert.deepEqual(forward, reversed);
});

test("the eligible result is frozen", () => {
  const result = resolveAnchor([item()]);
  assert.equal(Object.isFrozen(result), true);
});
