/**
 * UNIFIED INSTRUCTOR SCHEDULE - SLICE IUS-2D: DB-free tests for the pure
 * day/offering grouping core behind the unified instructor view's restored
 * Level 1 parallel-group layout.
 *
 * No Prisma, no DB, no clock, no randomness, no React - every input is a plain
 * fake item array. Covers: day grouping and ascending day order, one block per
 * CONTRIBUTING offering (never an empty block), block ordering by earliest
 * startTime with its two tie-breaks, verbatim item order inside a block, label/
 * level attachment, no cross-offering leakage, no input mutation and
 * determinism under input reordering.
 *
 * Run with: npx tsx --test lib/course/unified-instructor-day-grouping-core.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  groupUnifiedInstructorItemsByDayAndOffering,
  type UnifiedInstructorGroupableItem,
} from "./unified-instructor-day-grouping-core";

interface FakeItem extends UnifiedInstructorGroupableItem {
  readonly id: string;
}

function item(overrides: Partial<FakeItem> & { id: string }): FakeItem {
  return {
    dateKey: "2026-08-02",
    dayLabel: "יום ראשון",
    dateLabel: "2.8",
    startTime: "08:00",
    sourceCourseOfferingId: "off-1",
    sourceCourseLabel: "רמה 1",
    sourceCourseLevel: 1,
    ...overrides,
  };
}

/** Every item id in a day, block by block - the shape most assertions below compare. */
function shape(days: readonly { blocks: readonly { sourceCourseOfferingId: string; items: readonly FakeItem[] }[] }[]) {
  return days.map((day) => day.blocks.map((block) => [block.sourceCourseOfferingId, block.items.map((i) => i.id)]));
}

// ---------------------------------------------------------------------------
// (1)(2) Day grouping and ascending day order.
// ---------------------------------------------------------------------------

test("groups items by day", () => {
  const days = groupUnifiedInstructorItemsByDayAndOffering([
    item({ id: "a", dateKey: "2026-08-02" }),
    item({ id: "b", dateKey: "2026-08-03" }),
    item({ id: "c", dateKey: "2026-08-02", startTime: "09:00" }),
  ]);
  assert.equal(days.length, 2);
  assert.deepEqual(
    days.map((d) => d.dateKey),
    ["2026-08-02", "2026-08-03"],
  );
  assert.deepEqual(days[0].blocks[0].items.map((i) => i.id), ["a", "c"]);
  assert.deepEqual(days[1].blocks[0].items.map((i) => i.id), ["b"]);
});

test("days are sorted ascending by dateKey regardless of input order", () => {
  const days = groupUnifiedInstructorItemsByDayAndOffering([
    item({ id: "c", dateKey: "2026-08-05" }),
    item({ id: "a", dateKey: "2026-08-01" }),
    item({ id: "b", dateKey: "2026-08-03" }),
  ]);
  assert.deepEqual(
    days.map((d) => d.dateKey),
    ["2026-08-01", "2026-08-03", "2026-08-05"],
  );
});

test("a day carries its OWN dayLabel and dateLabel, taken from its items", () => {
  const days = groupUnifiedInstructorItemsByDayAndOffering([
    item({ id: "a", dateKey: "2026-08-02", dayLabel: "יום ראשון", dateLabel: "2.8" }),
    item({ id: "b", dateKey: "2026-08-03", dayLabel: "יום שני", dateLabel: "3.8" }),
  ]);
  assert.equal(days[0].dayLabel, "יום ראשון");
  assert.equal(days[0].dateLabel, "2.8");
  assert.equal(days[1].dayLabel, "יום שני");
  assert.equal(days[1].dateLabel, "3.8");
});

test("an empty input produces no days at all", () => {
  assert.deepEqual(groupUnifiedInstructorItemsByDayAndOffering([]), []);
});

// ---------------------------------------------------------------------------
// (3)(4)(5)(6) One block per CONTRIBUTING offering; never an empty block.
// ---------------------------------------------------------------------------

test("a day with a single offering produces exactly one block", () => {
  const days = groupUnifiedInstructorItemsByDayAndOffering([
    item({ id: "a" }),
    item({ id: "b", startTime: "10:00" }),
  ]);
  assert.equal(days.length, 1);
  assert.equal(days[0].blocks.length, 1);
  assert.equal(days[0].blocks[0].sourceCourseOfferingId, "off-1");
});

test("two offerings on one day produce two separate blocks", () => {
  const days = groupUnifiedInstructorItemsByDayAndOffering([
    item({ id: "a1" }),
    item({ id: "b1", startTime: "10:00", sourceCourseOfferingId: "off-2", sourceCourseLabel: "רמה 2", sourceCourseLevel: 2 }),
    item({ id: "a2", startTime: "12:00" }),
  ]);
  assert.equal(days[0].blocks.length, 2);
  assert.deepEqual(shape(days), [[["off-1", ["a1", "a2"]], ["off-2", ["b1"]]]]);
});

test("no empty block and no empty day is ever produced", () => {
  const days = groupUnifiedInstructorItemsByDayAndOffering([
    item({ id: "a", dateKey: "2026-08-02" }),
    item({ id: "b", dateKey: "2026-08-04", sourceCourseOfferingId: "off-2" }),
  ]);
  for (const day of days) {
    assert.ok(day.blocks.length > 0, "a day must contribute at least one block");
    for (const block of day.blocks) {
      assert.ok(block.items.length > 0, "a block must contribute at least one item");
    }
  }
});

test("an offering that contributes on one day only appears on that day", () => {
  const days = groupUnifiedInstructorItemsByDayAndOffering([
    item({ id: "a", dateKey: "2026-08-02" }),
    item({ id: "b", dateKey: "2026-08-02", sourceCourseOfferingId: "off-2" }),
    item({ id: "c", dateKey: "2026-08-03" }),
  ]);
  assert.equal(days[0].blocks.length, 2);
  assert.equal(days[1].blocks.length, 1);
  assert.equal(days[1].blocks[0].sourceCourseOfferingId, "off-1");
});

// ---------------------------------------------------------------------------
// (7)(8)(9) Block ordering and its tie-breaks.
// ---------------------------------------------------------------------------

test("blocks are ordered by the earliest startTime in the block", () => {
  const days = groupUnifiedInstructorItemsByDayAndOffering([
    item({ id: "late", startTime: "14:00", sourceCourseOfferingId: "off-1" }),
    item({ id: "early", startTime: "08:00", sourceCourseOfferingId: "off-2", sourceCourseLevel: 2 }),
  ]);
  assert.deepEqual(
    days[0].blocks.map((b) => b.sourceCourseOfferingId),
    ["off-2", "off-1"],
  );
});

test("the earliest startTime is computed over ALL items, not just the first one seen", () => {
  const days = groupUnifiedInstructorItemsByDayAndOffering([
    item({ id: "a-late", startTime: "16:00", sourceCourseOfferingId: "off-1" }),
    item({ id: "b", startTime: "09:00", sourceCourseOfferingId: "off-2", sourceCourseLevel: 2 }),
    item({ id: "a-early", startTime: "07:00", sourceCourseOfferingId: "off-1" }),
  ]);
  assert.deepEqual(
    days[0].blocks.map((b) => b.sourceCourseOfferingId),
    ["off-1", "off-2"],
  );
});

test("equal earliest startTime tie-breaks on sourceCourseLevel", () => {
  const days = groupUnifiedInstructorItemsByDayAndOffering([
    // The Level 2 block is listed first and has the alphabetically smaller id,
    // so ONLY the level tie-break can put the Level 1 block ahead of it.
    item({ id: "l2", startTime: "08:00", sourceCourseOfferingId: "aaa", sourceCourseLevel: 2 }),
    item({ id: "l1", startTime: "08:00", sourceCourseOfferingId: "zzz", sourceCourseLevel: 1 }),
  ]);
  assert.deepEqual(
    days[0].blocks.map((b) => b.sourceCourseLevel),
    [1, 2],
  );
});

test("equal earliest startTime AND equal level tie-break on sourceCourseOfferingId", () => {
  const days = groupUnifiedInstructorItemsByDayAndOffering([
    item({ id: "z", startTime: "08:00", sourceCourseOfferingId: "off-z", sourceCourseLevel: 1 }),
    item({ id: "a", startTime: "08:00", sourceCourseOfferingId: "off-a", sourceCourseLevel: 1 }),
  ]);
  assert.deepEqual(
    days[0].blocks.map((b) => b.sourceCourseOfferingId),
    ["off-a", "off-z"],
  );
});

// ---------------------------------------------------------------------------
// (10) Item order inside a block is preserved verbatim.
// ---------------------------------------------------------------------------

test("item order inside a block is preserved exactly as received", () => {
  // Deliberately NOT chronological: the merge core owns ordering, this core
  // must never re-sort within a block.
  const days = groupUnifiedInstructorItemsByDayAndOffering([
    item({ id: "third", startTime: "12:00" }),
    item({ id: "first", startTime: "08:00" }),
    item({ id: "second", startTime: "10:00" }),
  ]);
  assert.deepEqual(days[0].blocks[0].items.map((i) => i.id), ["third", "first", "second"]);
});

test("interleaved offerings keep each block's own relative item order", () => {
  const days = groupUnifiedInstructorItemsByDayAndOffering([
    item({ id: "a1", startTime: "08:00" }),
    item({ id: "b1", startTime: "08:30", sourceCourseOfferingId: "off-2", sourceCourseLevel: 2 }),
    item({ id: "a2", startTime: "09:00" }),
    item({ id: "b2", startTime: "09:30", sourceCourseOfferingId: "off-2", sourceCourseLevel: 2 }),
  ]);
  assert.deepEqual(shape(days), [[["off-1", ["a1", "a2"]], ["off-2", ["b1", "b2"]]]]);
});

// ---------------------------------------------------------------------------
// (13)(14) Labels/levels stay with their own offering; no item leaks.
// ---------------------------------------------------------------------------

test("each block's label and level come from its OWN offering's items", () => {
  const days = groupUnifiedInstructorItemsByDayAndOffering([
    item({ id: "a", sourceCourseOfferingId: "off-1", sourceCourseLabel: "רמה 1", sourceCourseLevel: 1 }),
    item({
      id: "b",
      startTime: "09:00",
      sourceCourseOfferingId: "off-2",
      sourceCourseLabel: "רמה 2",
      sourceCourseLevel: 2,
    }),
  ]);
  const [level1, level2] = days[0].blocks;
  assert.deepEqual(
    { id: level1.sourceCourseOfferingId, label: level1.sourceCourseLabel, level: level1.sourceCourseLevel },
    { id: "off-1", label: "רמה 1", level: 1 },
  );
  assert.deepEqual(
    { id: level2.sourceCourseOfferingId, label: level2.sourceCourseLabel, level: level2.sourceCourseLevel },
    { id: "off-2", label: "רמה 2", level: 2 },
  );
});

test("no block ever contains an item from another offering", () => {
  const days = groupUnifiedInstructorItemsByDayAndOffering([
    item({ id: "a1", dateKey: "2026-08-02" }),
    item({ id: "b1", dateKey: "2026-08-02", sourceCourseOfferingId: "off-2", sourceCourseLevel: 2 }),
    item({ id: "a2", dateKey: "2026-08-03" }),
    item({ id: "b2", dateKey: "2026-08-03", sourceCourseOfferingId: "off-2", sourceCourseLevel: 2 }),
  ]);
  for (const day of days) {
    for (const block of day.blocks) {
      for (const blockItem of block.items) {
        assert.equal(blockItem.sourceCourseOfferingId, block.sourceCourseOfferingId);
      }
      // ...and the block appears exactly once per day.
      assert.equal(
        day.blocks.filter((b) => b.sourceCourseOfferingId === block.sourceCourseOfferingId).length,
        1,
      );
    }
  }
});

test("every input item appears exactly once in the output", () => {
  const input = [
    item({ id: "a", dateKey: "2026-08-02" }),
    item({ id: "b", dateKey: "2026-08-02", sourceCourseOfferingId: "off-2" }),
    item({ id: "c", dateKey: "2026-08-03" }),
  ];
  const emitted = groupUnifiedInstructorItemsByDayAndOffering(input).flatMap((d) =>
    d.blocks.flatMap((b) => b.items.map((i) => i.id)),
  );
  assert.deepEqual([...emitted].sort(), ["a", "b", "c"]);
  assert.equal(emitted.length, input.length);
});

// ---------------------------------------------------------------------------
// (11)(12) No mutation; deterministic output.
// ---------------------------------------------------------------------------

test("the input array and its items are not mutated", () => {
  const input = [
    item({ id: "b", startTime: "10:00", sourceCourseOfferingId: "off-2", sourceCourseLevel: 2 }),
    item({ id: "a", startTime: "08:00" }),
  ];
  const before = JSON.parse(JSON.stringify(input));
  const inputOrder = input.map((i) => i.id);
  groupUnifiedInstructorItemsByDayAndOffering(input);
  assert.deepEqual(JSON.parse(JSON.stringify(input)), before, "item fields must be untouched");
  assert.deepEqual(input.map((i) => i.id), inputOrder, "the input array must not be reordered");
  assert.equal(Object.isFrozen(input[0]), false, "input item objects must not be frozen by this core");
});

test("output is deterministic under input reordering", () => {
  const items = [
    item({ id: "a1", dateKey: "2026-08-03", startTime: "08:00" }),
    item({ id: "a2", dateKey: "2026-08-03", startTime: "09:00" }),
    item({ id: "b1", dateKey: "2026-08-03", startTime: "07:00", sourceCourseOfferingId: "off-2", sourceCourseLevel: 2 }),
    item({ id: "c1", dateKey: "2026-08-02", startTime: "11:00" }),
  ];
  // Reordering only ACROSS days/offerings - within-block order is contractually
  // input order, so reordering two items of the same block legitimately changes
  // the output and is not a determinism violation.
  const reordered = [items[3], items[2], items[0], items[1]];
  assert.deepEqual(
    shape(groupUnifiedInstructorItemsByDayAndOffering(reordered)),
    shape(groupUnifiedInstructorItemsByDayAndOffering(items)),
  );
  assert.deepEqual(
    groupUnifiedInstructorItemsByDayAndOffering(reordered).map((d) => d.dateKey),
    groupUnifiedInstructorItemsByDayAndOffering(items).map((d) => d.dateKey),
  );
});

test("the returned days, blocks and block item arrays are frozen", () => {
  const days = groupUnifiedInstructorItemsByDayAndOffering([item({ id: "a" })]);
  assert.ok(Object.isFrozen(days));
  assert.ok(Object.isFrozen(days[0]));
  assert.ok(Object.isFrozen(days[0].blocks));
  assert.ok(Object.isFrozen(days[0].blocks[0]));
  assert.ok(Object.isFrozen(days[0].blocks[0].items));
});
