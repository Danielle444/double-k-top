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
 * SLICE IUS-3A adds a second suite at the bottom of this file for the pure
 * CHRONOLOGICAL SEGMENT core that fixes the interleaving bug (one offering may
 * now contribute several blocks per day, so a day of L1 08:00 / L2 10:00 /
 * L2 12:00 / L1 14:00 finally renders in that order), plus its inter-segment
 * gap presentation helper. Both suites live here because both functions live in
 * one module; the IUS-2D suite above is the currently-wired one and is untouched.
 *
 * Run with: npx tsx --test lib/course/unified-instructor-day-grouping-core.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  groupUnifiedInstructorItemsByDayAndOffering,
  groupUnifiedInstructorItemsByDaySegmentAndOffering,
  resolveUnifiedInstructorScheduleGapPresentation,
  type UnifiedInstructorGroupableItem,
  type UnifiedInstructorSegmentableItem,
  type UnifiedInstructorSegmentedScheduleDay,
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

// ===========================================================================
// IUS-3A - CHRONOLOGICAL SEGMENTS
//
// The day/offering core above buckets a WHOLE DAY into at most one block per
// offering, so an interleaved day renders every item of one course and then
// every item of the other. The segment core below splits each day at real
// chronological boundaries instead, letting one offering contribute several
// blocks per day - while still never putting two offerings in one block (and
// therefore never in one ScheduleTimeGrid).
//
// Same DB-free discipline as above: no Prisma, no DB, no clock, no randomness,
// no React - every input is a plain fake item array.
// ===========================================================================

interface FakeSegmentItem extends UnifiedInstructorSegmentableItem {
  readonly id: string;
}

/** A Level 1 (off-1) item by default; 08:00-09:00 unless overridden. */
function segItem(overrides: Partial<FakeSegmentItem> & { id: string }): FakeSegmentItem {
  return {
    dateKey: "2026-08-02",
    dayLabel: "יום ראשון",
    dateLabel: "2.8",
    startTime: "08:00",
    endTime: "09:00",
    sourceCourseOfferingId: "off-1",
    sourceCourseLabel: "רמה 1",
    sourceCourseLevel: 1,
    ...overrides,
  };
}

/** The same, as the OTHER offering (off-2, Level 2). */
function segItem2(overrides: Partial<FakeSegmentItem> & { id: string }): FakeSegmentItem {
  return segItem({
    sourceCourseOfferingId: "off-2",
    sourceCourseLabel: "רמה 2",
    sourceCourseLevel: 2,
    ...overrides,
  });
}

/** Every item id, segment by segment and block by block - what most assertions below compare. */
function segShape(days: readonly UnifiedInstructorSegmentedScheduleDay<FakeSegmentItem>[]) {
  return days.map((day) =>
    day.segments.map((segment) =>
      segment.blocks.map((block) => [block.sourceCourseOfferingId, block.items.map((i) => i.id)]),
    ),
  );
}

/** The geometry the unified view is configured with (IUS-2F's own locked numbers). */
const GAP_CONFIG = { thresholdMinutes: 60, compressedSlotCount: 2, slotMinutes: 15 } as const;

// ---------------------------------------------------------------------------
// (S1) The bug this slice exists to fix.
// ---------------------------------------------------------------------------

test("IUS-3A: an interleaved day is emitted in TRUE global chronological order", () => {
  // The reported case: L1 08:00, L2 10:00, L2 12:00, L1 14:00. The day/offering
  // core above can only produce [L1 08:00, L1 14:00], [L2 10:00, L2 12:00].
  const days = groupUnifiedInstructorItemsByDaySegmentAndOffering([
    segItem({ id: "l1-08", startTime: "08:00", endTime: "09:00" }),
    segItem2({ id: "l2-10", startTime: "10:00", endTime: "11:00" }),
    segItem2({ id: "l2-12", startTime: "12:00", endTime: "13:00" }),
    segItem({ id: "l1-14", startTime: "14:00", endTime: "15:00" }),
  ]);

  assert.equal(days.length, 1);
  assert.deepEqual(segShape(days), [
    [[["off-1", ["l1-08"]]], [["off-2", ["l2-10"]]], [["off-2", ["l2-12"]]], [["off-1", ["l1-14"]]]],
  ]);
  assert.deepEqual(
    days[0].segments.map((s) => s.startTime),
    ["08:00", "10:00", "12:00", "14:00"],
  );
  // ...and the three one-hour holes between them are real, internal gaps.
  assert.deepEqual(
    days[0].segments.map((s) => s.gapBefore?.realDurationMinutes ?? null),
    [null, 60, 60, 60],
  );
});

// ---------------------------------------------------------------------------
// (S2) Segment boundaries: overlap, containment, touching.
// ---------------------------------------------------------------------------

test("strictly overlapping items from two offerings stay in ONE segment", () => {
  const days = groupUnifiedInstructorItemsByDaySegmentAndOffering([
    segItem({ id: "a", startTime: "08:00", endTime: "09:00" }),
    segItem2({ id: "b", startTime: "08:30", endTime: "09:30" }),
  ]);
  assert.equal(days[0].segments.length, 1);
  assert.deepEqual(segShape(days), [[[["off-1", ["a"]], ["off-2", ["b"]]]]]);
});

test("a long Level 1 item CONTAINING a Level 2 item stays in one segment - overlap is not linearizable", () => {
  const days = groupUnifiedInstructorItemsByDaySegmentAndOffering([
    segItem({ id: "l1-long", startTime: "08:00", endTime: "14:00" }),
    segItem2({ id: "l2", startTime: "10:00", endTime: "11:00" }),
  ]);
  assert.equal(days[0].segments.length, 1, "this case is deliberately NOT split");
  assert.equal(days[0].segments[0].blocks.length, 2);
  assert.equal(days[0].segments[0].startTime, "08:00");
  assert.equal(days[0].segments[0].endTime, "14:00");
});

test("SAME-offering touching items are never split - adjacent-activity coalescing is preserved", () => {
  // coalesceAdjacentSameActivity merges these two into ONE card, which is only
  // possible while they reach the SAME grid.
  const days = groupUnifiedInstructorItemsByDaySegmentAndOffering([
    segItem({ id: "ride-1", startTime: "08:00", endTime: "09:00" }),
    segItem({ id: "ride-2", startTime: "09:00", endTime: "10:00" }),
  ]);
  assert.equal(days[0].segments.length, 1);
  assert.deepEqual(segShape(days), [[[["off-1", ["ride-1", "ride-2"]]]]]);
});

test("a same-offering touching CHAIN stays whole across several links", () => {
  const days = groupUnifiedInstructorItemsByDaySegmentAndOffering([
    segItem({ id: "r1", startTime: "08:00", endTime: "09:00" }),
    segItem({ id: "r2", startTime: "09:00", endTime: "10:00" }),
    segItem({ id: "r3", startTime: "10:00", endTime: "11:00" }),
  ]);
  assert.equal(days[0].segments.length, 1);
  assert.deepEqual(days[0].segments[0].blocks[0].items.map((i) => i.id), ["r1", "r2", "r3"]);
});

test("CROSS-offering touching items become two adjacent segments with a zero-length gap", () => {
  const days = groupUnifiedInstructorItemsByDaySegmentAndOffering([
    segItem({ id: "l1", startTime: "08:00", endTime: "09:00" }),
    segItem2({ id: "l2", startTime: "09:00", endTime: "10:00" }),
  ]);
  assert.equal(days[0].segments.length, 2);
  assert.deepEqual(segShape(days), [[[["off-1", ["l1"]]], [["off-2", ["l2"]]]]]);
  assert.deepEqual(days[0].segments[1].gapBefore, {
    realStartTime: "09:00",
    realEndTime: "09:00",
    realDurationMinutes: 0,
  });
});

test("two same-offering runs chained through the OTHER offering's overlap stay in one segment", () => {
  const days = groupUnifiedInstructorItemsByDaySegmentAndOffering([
    segItem({ id: "a1", startTime: "08:00", endTime: "10:00" }),
    segItem2({ id: "b1", startTime: "09:30", endTime: "11:30" }),
    segItem({ id: "a2", startTime: "11:00", endTime: "13:00" }),
  ]);
  assert.equal(days[0].segments.length, 1);
  assert.deepEqual(segShape(days), [[[["off-1", ["a1", "a2"]], ["off-2", ["b1"]]]]]);
});

test("simultaneous items of one offering always share a block, even with a third offering at the same time", () => {
  // The group א / group ב case: both must reach the SAME grid or the side-by-side
  // columns and the "שתי הקבוצות" merge are lost.
  const days = groupUnifiedInstructorItemsByDaySegmentAndOffering([
    segItem({ id: "group-a", startTime: "10:00", endTime: "11:00" }),
    segItem2({ id: "other-course", startTime: "10:00", endTime: "11:00" }),
    segItem({ id: "group-b", startTime: "10:00", endTime: "11:00" }),
  ]);
  assert.equal(days[0].segments.length, 1);
  assert.deepEqual(segShape(days), [[[["off-1", ["group-a", "group-b"]], ["off-2", ["other-course"]]]]]);
});

test("an item is never split across segments and never duplicated", () => {
  const input = [
    segItem({ id: "a", startTime: "08:00", endTime: "09:00" }),
    segItem2({ id: "b", startTime: "10:00", endTime: "11:00" }),
    segItem({ id: "c", startTime: "10:30", endTime: "12:00" }),
    segItem({ id: "d", dateKey: "2026-08-03", startTime: "08:00", endTime: "09:00" }),
  ];
  const emitted = groupUnifiedInstructorItemsByDaySegmentAndOffering(input).flatMap((day) =>
    day.segments.flatMap((s) => s.blocks.flatMap((b) => b.items.map((i) => i.id))),
  );
  assert.deepEqual([...emitted].sort(), ["a", "b", "c", "d"]);
  assert.equal(emitted.length, input.length);
});

// ---------------------------------------------------------------------------
// (S3) No block ever mixes offerings - the structural safety invariant.
// ---------------------------------------------------------------------------

test("no block ever contains an item from another offering, in any segment", () => {
  const days = groupUnifiedInstructorItemsByDaySegmentAndOffering([
    segItem({ id: "a1", startTime: "08:00", endTime: "09:00" }),
    segItem2({ id: "b1", startTime: "08:30", endTime: "09:30" }),
    segItem2({ id: "b2", startTime: "12:00", endTime: "13:00" }),
    segItem({ id: "a2", startTime: "12:30", endTime: "14:00" }),
  ]);
  for (const day of days) {
    for (const segment of day.segments) {
      assert.ok(segment.blocks.length > 0, "a segment must contribute at least one block");
      for (const block of segment.blocks) {
        assert.ok(block.items.length > 0, "a block must contribute at least one item");
        for (const blockItem of block.items) {
          assert.equal(blockItem.sourceCourseOfferingId, block.sourceCourseOfferingId);
        }
        assert.equal(
          segment.blocks.filter((b) => b.sourceCourseOfferingId === block.sourceCourseOfferingId).length,
          1,
          "an offering appears at most once per segment",
        );
      }
    }
  }
});

test("each block's label and level come from its OWN offering's items", () => {
  const days = groupUnifiedInstructorItemsByDaySegmentAndOffering([
    segItem({ id: "a", startTime: "08:00", endTime: "09:00" }),
    segItem2({ id: "b", startTime: "08:30", endTime: "09:30" }),
  ]);
  const [level1, level2] = days[0].segments[0].blocks;
  assert.deepEqual(
    { id: level1.sourceCourseOfferingId, label: level1.sourceCourseLabel, level: level1.sourceCourseLevel },
    { id: "off-1", label: "רמה 1", level: 1 },
  );
  assert.deepEqual(
    { id: level2.sourceCourseOfferingId, label: level2.sourceCourseLabel, level: level2.sourceCourseLevel },
    { id: "off-2", label: "רמה 2", level: 2 },
  );
});

// ---------------------------------------------------------------------------
// (S4) Block ordering inside a segment, and its two tie-breaks.
// ---------------------------------------------------------------------------

test("blocks inside a segment are ordered by their earliest start", () => {
  const days = groupUnifiedInstructorItemsByDaySegmentAndOffering([
    segItem({ id: "late", startTime: "08:30", endTime: "10:00" }),
    segItem2({ id: "early", startTime: "08:00", endTime: "09:30" }),
  ]);
  assert.deepEqual(
    days[0].segments[0].blocks.map((b) => b.sourceCourseOfferingId),
    ["off-2", "off-1"],
  );
});

test("equal earliest start tie-breaks on sourceCourseLevel", () => {
  const days = groupUnifiedInstructorItemsByDaySegmentAndOffering([
    // Level 2 is listed first AND has the alphabetically smaller offering id, so
    // only the level tie-break can put Level 1 ahead of it.
    segItem({ id: "l2", startTime: "08:00", endTime: "09:00", sourceCourseOfferingId: "aaa", sourceCourseLevel: 2 }),
    segItem({ id: "l1", startTime: "08:00", endTime: "09:00", sourceCourseOfferingId: "zzz", sourceCourseLevel: 1 }),
  ]);
  assert.deepEqual(
    days[0].segments[0].blocks.map((b) => b.sourceCourseLevel),
    [1, 2],
  );
});

test("equal earliest start AND equal level tie-break on sourceCourseOfferingId", () => {
  const days = groupUnifiedInstructorItemsByDaySegmentAndOffering([
    segItem({ id: "z", startTime: "08:00", endTime: "09:00", sourceCourseOfferingId: "off-z" }),
    segItem({ id: "a", startTime: "08:00", endTime: "09:00", sourceCourseOfferingId: "off-a" }),
  ]);
  assert.deepEqual(
    days[0].segments[0].blocks.map((b) => b.sourceCourseOfferingId),
    ["off-a", "off-z"],
  );
});

test("item order inside a block is preserved exactly as received", () => {
  // Deliberately NOT chronological, and overlapping so both land in one block:
  // the merge core owns item order, this core must never re-sort within a block.
  const days = groupUnifiedInstructorItemsByDaySegmentAndOffering([
    segItem({ id: "second-in-input", startTime: "09:00", endTime: "11:00" }),
    segItem({ id: "first-in-input", startTime: "08:00", endTime: "10:00" }),
  ]);
  assert.deepEqual(days[0].segments[0].blocks[0].items.map((i) => i.id), [
    "second-in-input",
    "first-in-input",
  ]);
});

// ---------------------------------------------------------------------------
// (S5) Days, day labels and the day-level heading flag.
// ---------------------------------------------------------------------------

test("days are grouped and sorted ascending, with their OWN labels", () => {
  const days = groupUnifiedInstructorItemsByDaySegmentAndOffering([
    segItem({ id: "c", dateKey: "2026-08-05", dayLabel: "יום רביעי", dateLabel: "5.8" }),
    segItem({ id: "a", dateKey: "2026-08-01", dayLabel: "יום שבת", dateLabel: "1.8" }),
    segItem({ id: "b", dateKey: "2026-08-03", dayLabel: "יום שני", dateLabel: "3.8" }),
  ]);
  assert.deepEqual(days.map((d) => d.dateKey), ["2026-08-01", "2026-08-03", "2026-08-05"]);
  assert.deepEqual(days.map((d) => d.dayLabel), ["יום שבת", "יום שני", "יום רביעי"]);
  assert.deepEqual(days.map((d) => d.dateLabel), ["1.8", "3.8", "5.8"]);
});

test("an empty input produces no days at all", () => {
  assert.deepEqual(groupUnifiedInstructorItemsByDaySegmentAndOffering([]), []);
});

test("hasMultipleOfferings is a DAY-level flag over distinct offerings", () => {
  const days = groupUnifiedInstructorItemsByDaySegmentAndOffering([
    // A day with two offerings, alternating - every segment has ONE block, so a
    // per-segment rule would wrongly hide the course label on all of them.
    segItem({ id: "a1", dateKey: "2026-08-02", startTime: "08:00", endTime: "09:00" }),
    segItem2({ id: "b1", dateKey: "2026-08-02", startTime: "10:00", endTime: "11:00" }),
    // ...and a single-offering day, which must look like the per-course layout.
    segItem({ id: "a2", dateKey: "2026-08-03", startTime: "08:00", endTime: "09:00" }),
    segItem({ id: "a3", dateKey: "2026-08-03", startTime: "12:00", endTime: "13:00" }),
  ]);
  assert.equal(days[0].hasMultipleOfferings, true);
  assert.ok(days[0].segments.every((s) => s.blocks.length === 1), "sanity: every segment has one block");
  assert.equal(days[1].hasMultipleOfferings, false);
});

// ---------------------------------------------------------------------------
// (S6) Gap metadata.
// ---------------------------------------------------------------------------

test("a day's FIRST segment has no gap, and a day boundary is never a gap", () => {
  const days = groupUnifiedInstructorItemsByDaySegmentAndOffering([
    segItem({ id: "a", dateKey: "2026-08-02", startTime: "08:00", endTime: "09:00" }),
    segItem({ id: "b", dateKey: "2026-08-02", startTime: "12:00", endTime: "13:00" }),
    segItem({ id: "c", dateKey: "2026-08-03", startTime: "08:00", endTime: "09:00" }),
  ]);
  assert.equal(days[0].segments[0].gapBefore, null);
  assert.notEqual(days[0].segments[1].gapBefore, null);
  assert.equal(days[1].segments[0].gapBefore, null, "the next day must not inherit a gap");
});

test("a gap carries the surrounding items' OWN time strings and the real duration", () => {
  const days = groupUnifiedInstructorItemsByDaySegmentAndOffering([
    segItem({ id: "a", startTime: "08:00", endTime: "09:00" }),
    segItem2({ id: "b", startTime: "10:00", endTime: "11:00" }),
  ]);
  assert.deepEqual(days[0].segments[1].gapBefore, {
    realStartTime: "09:00",
    realEndTime: "10:00",
    realDurationMinutes: 60,
  });
});

test("a gap measures from the LATEST end of the previous segment, not its first item", () => {
  const days = groupUnifiedInstructorItemsByDaySegmentAndOffering([
    segItem({ id: "short", startTime: "08:00", endTime: "08:30" }),
    segItem2({ id: "long", startTime: "08:15", endTime: "11:00" }),
    segItem({ id: "after", startTime: "13:00", endTime: "14:00" }),
  ]);
  assert.equal(days[0].segments.length, 2);
  assert.deepEqual(days[0].segments[1].gapBefore, {
    realStartTime: "11:00",
    realEndTime: "13:00",
    realDurationMinutes: 120,
  });
});

test("a segment's own startTime and endTime come from its own items", () => {
  const days = groupUnifiedInstructorItemsByDaySegmentAndOffering([
    segItem({ id: "a", startTime: "08:00", endTime: "08:30" }),
    segItem2({ id: "b", startTime: "08:15", endTime: "11:00" }),
  ]);
  assert.equal(days[0].segments[0].startTime, "08:00");
  assert.equal(days[0].segments[0].endTime, "11:00");
});

// ---------------------------------------------------------------------------
// (S7) Keys - an offering may now appear many times in one day.
// ---------------------------------------------------------------------------

test("segment and block keys are deterministic and unique within a day", () => {
  const days = groupUnifiedInstructorItemsByDaySegmentAndOffering([
    segItem({ id: "l1-08", startTime: "08:00", endTime: "09:00" }),
    segItem2({ id: "l2-10", startTime: "10:00", endTime: "11:00" }),
    segItem2({ id: "l2-12", startTime: "12:00", endTime: "13:00" }),
    segItem({ id: "l1-14", startTime: "14:00", endTime: "15:00" }),
  ]);
  assert.deepEqual(
    days[0].segments.map((s) => s.key),
    ["2026-08-02#0", "2026-08-02#1", "2026-08-02#2", "2026-08-02#3"],
  );
  const blockKeys = days[0].segments.flatMap((s) => s.blocks.map((b) => b.key));
  assert.deepEqual(blockKeys, ["0:off-1", "1:off-2", "2:off-2", "3:off-1"]);
  assert.equal(new Set(blockKeys).size, blockKeys.length, "the same offering repeats - keys must differ");
});

// ---------------------------------------------------------------------------
// (S8) Determinism, no mutation, frozen output.
// ---------------------------------------------------------------------------

test("output is deterministic under input reordering", () => {
  const items = [
    segItem({ id: "a1", dateKey: "2026-08-03", startTime: "08:00", endTime: "09:00" }),
    segItem2({ id: "b1", dateKey: "2026-08-03", startTime: "10:00", endTime: "11:00" }),
    segItem({ id: "a2", dateKey: "2026-08-03", startTime: "12:00", endTime: "13:00" }),
    segItem({ id: "c1", dateKey: "2026-08-02", startTime: "11:00", endTime: "12:00" }),
  ];
  // Reordering only ACROSS days/segments - within-block order is contractually
  // input order, so reordering two items of one block legitimately differs.
  const reordered = [items[3], items[2], items[1], items[0]];
  assert.deepEqual(
    segShape(groupUnifiedInstructorItemsByDaySegmentAndOffering(reordered)),
    segShape(groupUnifiedInstructorItemsByDaySegmentAndOffering(items)),
  );
  assert.deepEqual(
    groupUnifiedInstructorItemsByDaySegmentAndOffering(reordered).map((d) => d.dateKey),
    groupUnifiedInstructorItemsByDaySegmentAndOffering(items).map((d) => d.dateKey),
  );
});

test("the input array and its items are not mutated", () => {
  const input = [
    segItem2({ id: "b", startTime: "10:00", endTime: "11:00" }),
    segItem({ id: "a", startTime: "08:00", endTime: "09:00" }),
  ];
  const before = JSON.parse(JSON.stringify(input));
  const inputOrder = input.map((i) => i.id);
  groupUnifiedInstructorItemsByDaySegmentAndOffering(input);
  assert.deepEqual(JSON.parse(JSON.stringify(input)), before, "item fields must be untouched");
  assert.deepEqual(input.map((i) => i.id), inputOrder, "the input array must not be reordered");
  assert.equal(Object.isFrozen(input[0]), false, "input item objects must not be frozen by this core");
});

test("the returned days, segments, gaps, blocks and item arrays are frozen", () => {
  const days = groupUnifiedInstructorItemsByDaySegmentAndOffering([
    segItem({ id: "a", startTime: "08:00", endTime: "09:00" }),
    segItem({ id: "b", startTime: "12:00", endTime: "13:00" }),
  ]);
  assert.ok(Object.isFrozen(days));
  assert.ok(Object.isFrozen(days[0]));
  assert.ok(Object.isFrozen(days[0].segments));
  assert.ok(Object.isFrozen(days[0].segments[0]));
  assert.ok(Object.isFrozen(days[0].segments[0].blocks));
  assert.ok(Object.isFrozen(days[0].segments[0].blocks[0]));
  assert.ok(Object.isFrozen(days[0].segments[0].blocks[0].items));
  assert.ok(Object.isFrozen(days[0].segments[1].gapBefore));
});

// ---------------------------------------------------------------------------
// (S9) Degraded data must never crash, invert a segment or produce a negative gap.
// ---------------------------------------------------------------------------

test("an unparseable time degrades to 0 minutes instead of throwing", () => {
  const days = groupUnifiedInstructorItemsByDaySegmentAndOffering([
    segItem({ id: "bad", startTime: "לא ידוע", endTime: "לא ידוע" }),
    segItem({ id: "good", startTime: "08:00", endTime: "09:00" }),
  ]);
  assert.equal(days[0].segments.length, 2);
  assert.deepEqual(days[0].segments.map((s) => s.blocks[0].items.map((i) => i.id)), [["bad"], ["good"]]);
  assert.equal(days[0].segments[1].gapBefore?.realDurationMinutes, 480);
});

test("an item whose end precedes its start is clamped - no inverted segment, no negative gap", () => {
  const days = groupUnifiedInstructorItemsByDaySegmentAndOffering([
    segItem({ id: "inverted", startTime: "10:00", endTime: "08:00" }),
    segItem({ id: "after", startTime: "12:00", endTime: "13:00" }),
  ]);
  assert.equal(days[0].segments.length, 2);
  assert.equal(days[0].segments[0].startTime, "10:00");
  assert.equal(days[0].segments[0].endTime, "10:00", "the clamped end must not contradict the start");
  assert.deepEqual(days[0].segments[1].gapBefore, {
    realStartTime: "10:00",
    realEndTime: "12:00",
    realDurationMinutes: 120,
  });
});

// ---------------------------------------------------------------------------
// (S10) Gap presentation - IUS-2F's rule, unchanged, one level up.
// ---------------------------------------------------------------------------

function gap(realDurationMinutes: number) {
  return { realStartTime: "09:00", realEndTime: "10:00", realDurationMinutes };
}

test("a zero-length gap renders NOTHING - touching segments are truly adjacent", () => {
  assert.deepEqual(resolveUnifiedInstructorScheduleGapPresentation(gap(0), GAP_CONFIG), {
    mode: "proportional",
    slotCount: 0,
  });
});

test("a short gap keeps its true proportional height", () => {
  assert.deepEqual(resolveUnifiedInstructorScheduleGapPresentation(gap(30), GAP_CONFIG), {
    mode: "proportional",
    slotCount: 2,
  });
});

test("a gap of EXACTLY the threshold stays proportional", () => {
  assert.deepEqual(resolveUnifiedInstructorScheduleGapPresentation(gap(60), GAP_CONFIG), {
    mode: "proportional",
    slotCount: 4,
  });
});

test("a gap over the threshold is compressed to the configured band height", () => {
  assert.deepEqual(resolveUnifiedInstructorScheduleGapPresentation(gap(61), GAP_CONFIG), {
    mode: "compressed",
    slotCount: 2,
  });
  assert.deepEqual(resolveUnifiedInstructorScheduleGapPresentation(gap(300), GAP_CONFIG), {
    mode: "compressed",
    slotCount: 2,
  });
});

test("compression may only ever SHRINK - a band taller than the real gap is refused", () => {
  // 90 minutes is 6 proportional rows; a 10-row band would ENLARGE it.
  assert.deepEqual(
    resolveUnifiedInstructorScheduleGapPresentation(gap(90), {
      thresholdMinutes: 60,
      compressedSlotCount: 10,
      slotMinutes: 15,
    }),
    { mode: "proportional", slotCount: 6 },
  );
});

test("a nonsensical config degrades to the proportional layout and never compresses", () => {
  for (const config of [
    { thresholdMinutes: 0, compressedSlotCount: 2, slotMinutes: 15 },
    { thresholdMinutes: Number.NaN, compressedSlotCount: 2, slotMinutes: 15 },
    { thresholdMinutes: 60, compressedSlotCount: 0, slotMinutes: 15 },
  ]) {
    assert.deepEqual(resolveUnifiedInstructorScheduleGapPresentation(gap(300), config), {
      mode: "proportional",
      slotCount: 20,
    });
  }
  // With no usable slot size there is no proportional height to compute at all.
  assert.deepEqual(
    resolveUnifiedInstructorScheduleGapPresentation(gap(300), {
      thresholdMinutes: 60,
      compressedSlotCount: 2,
      slotMinutes: 0,
    }),
    { mode: "proportional", slotCount: 1 },
  );
});
