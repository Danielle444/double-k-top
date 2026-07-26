/**
 * UNIFIED INSTRUCTOR SCHEDULE - SLICE IUS0: DB-free tests for the pure
 * instructor "הלו״ז המשולב שלי" decision core.
 *
 * No Prisma, no DB, no clock, no randomness - every dependency is a fake row
 * array. Covers: eligibility, source tagging, chronological sort, strict
 * cross-offering overlap (touching/cross-date/same-offering all excluded,
 * dedup, order-independence), and the PUBLISHED-only full-coverage hide rule
 * (an unpublished Level 2 item can never hide a Level 1 item; multiple Level 2
 * items never combine into synthetic coverage; Level 1 never hides Level 2).
 *
 * Run with: npx tsx --test lib/course/unified-instructor-schedule-core.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  UNIFIED_INSTRUCTOR_SCHEDULE_MINIMUM_ELIGIBLE_OFFERINGS,
  isInstructorEligibleForUnifiedSchedule,
  tagUnifiedInstructorScheduleItems,
  sortUnifiedInstructorScheduleItems,
  computeInstructorCrossCourseOverlaps,
  hideLevel1ItemsFullyCoveredByPublishedLevel2,
  mergeUnifiedInstructorScheduleSources,
  type UnifiedInstructorScheduleSourceOffering,
} from "./unified-instructor-schedule-core";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface FakeItem {
  id: string;
  dateKey: string;
  startTime: string;
  endTime: string;
  isPublished: boolean;
}

function item(
  id: string,
  dateKey: string,
  startTime: string,
  endTime: string,
  isPublished = true,
): FakeItem {
  return { id, dateKey, startTime, endTime, isPublished };
}

const L1_OFFERING: UnifiedInstructorScheduleSourceOffering = { id: "off-l1", label: "רמה 1", level: 1 };
const L2_OFFERING: UnifiedInstructorScheduleSourceOffering = { id: "off-l2", label: "רמה 2 · חורף", level: 2 };
const L3_OFFERING: UnifiedInstructorScheduleSourceOffering = { id: "off-l3", label: "רמה 3", level: 3 };

function tagged(it: FakeItem, offering: UnifiedInstructorScheduleSourceOffering) {
  return tagUnifiedInstructorScheduleItems([it], offering)[0];
}

function ids(items: readonly { id: string }[]): string[] {
  return items.map((i) => i.id).sort();
}

// ---------------------------------------------------------------------------
// isInstructorEligibleForUnifiedSchedule
// ---------------------------------------------------------------------------

test("UNIFIED_INSTRUCTOR_SCHEDULE_MINIMUM_ELIGIBLE_OFFERINGS is 2", () => {
  assert.equal(UNIFIED_INSTRUCTOR_SCHEDULE_MINIMUM_ELIGIBLE_OFFERINGS, 2);
});

test("zero or one addressable offering is NOT eligible for the unified view", () => {
  assert.equal(isInstructorEligibleForUnifiedSchedule(0), false);
  assert.equal(isInstructorEligibleForUnifiedSchedule(1), false);
});

test("two or more addressable offerings ARE eligible for the unified view", () => {
  assert.equal(isInstructorEligibleForUnifiedSchedule(2), true);
  assert.equal(isInstructorEligibleForUnifiedSchedule(3), true);
});

// ---------------------------------------------------------------------------
// tagUnifiedInstructorScheduleItems
// ---------------------------------------------------------------------------

test("tagUnifiedInstructorScheduleItems adds source fields without dropping existing ones", () => {
  const [t] = tagUnifiedInstructorScheduleItems([item("r1", "2026-07-05", "08:00", "09:00")], L2_OFFERING);
  assert.equal(t.id, "r1");
  assert.equal(t.isPublished, true);
  assert.equal(t.sourceCourseOfferingId, "off-l2");
  assert.equal(t.sourceCourseLabel, "רמה 2 · חורף");
  assert.equal(t.sourceCourseLevel, 2);
});

// ---------------------------------------------------------------------------
// sortUnifiedInstructorScheduleItems
// ---------------------------------------------------------------------------

test("sorts chronologically by dateKey, then startTime, then endTime", () => {
  const sorted = sortUnifiedInstructorScheduleItems([
    item("late", "2026-07-05", "10:00", "11:00"),
    item("early", "2026-07-05", "08:00", "09:00"),
    item("next-day", "2026-07-06", "07:00", "08:00"),
  ]);
  assert.deepEqual(sorted.map((i) => i.id), ["early", "late", "next-day"]);
});

// ---------------------------------------------------------------------------
// computeInstructorCrossCourseOverlaps
//
// Locked rule: same date, DIFFERENT sourceCourseOfferingId, strict interval
// intersection (startA < endB && startB < endA) - touching boundaries are not
// overlaps. Publication is ignored (unpublished items still mark overlaps).
// ---------------------------------------------------------------------------

test("strict overlap: genuine cross-offering overlap is flagged both ways", () => {
  const a = tagged(item("a", "2026-07-05", "10:00", "11:00"), L1_OFFERING);
  const b = tagged(item("b", "2026-07-05", "10:30", "11:30"), L2_OFFERING);
  const [ra, rb] = computeInstructorCrossCourseOverlaps([a, b]);
  assert.deepEqual(ra.overlappingSourceCourseOfferingIds, ["off-l2"]);
  assert.deepEqual(rb.overlappingSourceCourseOfferingIds, ["off-l1"]);
});

test("touching boundaries (10:00-11:00 and 11:00-12:00) are NOT an overlap", () => {
  const a = tagged(item("a", "2026-07-05", "10:00", "11:00"), L1_OFFERING);
  const b = tagged(item("b", "2026-07-05", "11:00", "12:00"), L2_OFFERING);
  const [ra, rb] = computeInstructorCrossCourseOverlaps([a, b]);
  assert.deepEqual(ra.overlappingSourceCourseOfferingIds, []);
  assert.deepEqual(rb.overlappingSourceCourseOfferingIds, []);
});

test("cross-date: identical times on DIFFERENT dates are never flagged as an overlap", () => {
  const a = tagged(item("a", "2026-07-05", "10:00", "11:00"), L1_OFFERING);
  const b = tagged(item("b", "2026-07-06", "10:00", "11:00"), L2_OFFERING);
  const [ra, rb] = computeInstructorCrossCourseOverlaps([a, b]);
  assert.deepEqual(ra.overlappingSourceCourseOfferingIds, []);
  assert.deepEqual(rb.overlappingSourceCourseOfferingIds, []);
});

test("same-offering: two overlapping items from the SAME offering receive no cross-course warning", () => {
  const a = tagged(item("a", "2026-07-05", "10:00", "11:00"), L1_OFFERING);
  const b = tagged(item("b", "2026-07-05", "10:30", "11:30"), L1_OFFERING);
  const [ra, rb] = computeInstructorCrossCourseOverlaps([a, b]);
  assert.deepEqual(ra.overlappingSourceCourseOfferingIds, []);
  assert.deepEqual(rb.overlappingSourceCourseOfferingIds, []);
});

test("no duplicate overlap ids: one item overlapping two items from the SAME other offering dedupes to one id", () => {
  const a = tagged(item("a", "2026-07-05", "10:00", "12:00"), L1_OFFERING);
  const b1 = tagged(item("b1", "2026-07-05", "10:00", "10:30"), L2_OFFERING);
  const b2 = tagged(item("b2", "2026-07-05", "11:00", "11:30"), L2_OFFERING);
  const [ra] = computeInstructorCrossCourseOverlaps([a, b1, b2]);
  assert.deepEqual(ra.overlappingSourceCourseOfferingIds, ["off-l2"]);
});

test("one item overlapping items from TWO different other offerings lists both ids, sorted", () => {
  const a = tagged(item("a", "2026-07-05", "10:00", "12:00"), L1_OFFERING);
  const b = tagged(item("b", "2026-07-05", "10:00", "10:30"), L2_OFFERING);
  const c = tagged(item("c", "2026-07-05", "11:00", "11:30"), L3_OFFERING);
  const [ra] = computeInstructorCrossCourseOverlaps([a, b, c]);
  assert.deepEqual(ra.overlappingSourceCourseOfferingIds, ["off-l2", "off-l3"]);
});

test("input order independence: overlap output is deterministic regardless of input order", () => {
  const a = tagged(item("a", "2026-07-05", "10:00", "12:00"), L1_OFFERING);
  const b = tagged(item("b", "2026-07-05", "10:00", "10:30"), L2_OFFERING);
  const c = tagged(item("c", "2026-07-05", "11:00", "11:30"), L3_OFFERING);

  const forward = computeInstructorCrossCourseOverlaps([a, b, c]);
  const reversed = computeInstructorCrossCourseOverlaps([c, b, a]);
  const shuffled = computeInstructorCrossCourseOverlaps([b, a, c]);

  for (const result of [forward, reversed, shuffled]) {
    const byId = new Map(result.map((r) => [r.id, r.overlappingSourceCourseOfferingIds]));
    assert.deepEqual(byId.get("a"), ["off-l2", "off-l3"]);
    assert.deepEqual(byId.get("b"), ["off-l1"]);
    assert.deepEqual(byId.get("c"), ["off-l1"]);
  }
});

test("an unpublished item still participates in the overlap warning (instructors see unpublished)", () => {
  const a = tagged(item("a", "2026-07-05", "10:00", "11:00", true), L1_OFFERING);
  const b = tagged(item("b", "2026-07-05", "10:30", "11:30", false), L2_OFFERING);
  const [ra, rb] = computeInstructorCrossCourseOverlaps([a, b]);
  assert.deepEqual(ra.overlappingSourceCourseOfferingIds, ["off-l2"]);
  assert.deepEqual(rb.overlappingSourceCourseOfferingIds, ["off-l1"]);
});

// ---------------------------------------------------------------------------
// hideLevel1ItemsFullyCoveredByPublishedLevel2
//
// Locked rule: a visible Level 1 item is hidden only when a SINGLE PUBLISHED
// Level 2 item, same date, fully covers it (level2Start <= level1Start &&
// level2End >= level1End). Unpublished L2, partial overlap, touching, different
// dates, and multi-item synthetic coverage all keep the Level 1 item. Level 2
// items are never removed, in either direction.
// ---------------------------------------------------------------------------

test("exact full coverage by a published Level 2 -> Level 1 hidden", () => {
  const l1 = tagged(item("l1", "2026-07-05", "10:00", "11:00"), L1_OFFERING);
  const l2 = tagged(item("l2", "2026-07-05", "10:00", "11:00", true), L2_OFFERING);
  assert.deepEqual(ids(hideLevel1ItemsFullyCoveredByPublishedLevel2([l1, l2])), ["l2"]);
});

test("published Level 2 starts earlier and ends later -> Level 1 hidden", () => {
  const l1 = tagged(item("l1", "2026-07-05", "10:00", "11:00"), L1_OFFERING);
  const l2 = tagged(item("l2", "2026-07-05", "09:30", "11:30", true), L2_OFFERING);
  assert.deepEqual(ids(hideLevel1ItemsFullyCoveredByPublishedLevel2([l1, l2])), ["l2"]);
});

test("same-start: published Level 2 starts same time and ends later -> Level 1 hidden", () => {
  const l1 = tagged(item("l1", "2026-07-05", "10:00", "11:00"), L1_OFFERING);
  const l2 = tagged(item("l2", "2026-07-05", "10:00", "11:30", true), L2_OFFERING);
  assert.deepEqual(ids(hideLevel1ItemsFullyCoveredByPublishedLevel2([l1, l2])), ["l2"]);
});

test("same-end: published Level 2 starts earlier and ends same time -> Level 1 hidden", () => {
  const l1 = tagged(item("l1", "2026-07-05", "10:00", "11:00"), L1_OFFERING);
  const l2 = tagged(item("l2", "2026-07-05", "09:30", "11:00", true), L2_OFFERING);
  assert.deepEqual(ids(hideLevel1ItemsFullyCoveredByPublishedLevel2([l1, l2])), ["l2"]);
});

test("published Level 2 can hide Level 1 (explicit)", () => {
  const l1 = tagged(item("l1", "2026-07-05", "10:00", "11:00"), L1_OFFERING);
  const l2 = tagged(item("l2", "2026-07-05", "09:00", "12:00", true), L2_OFFERING);
  assert.deepEqual(ids(hideLevel1ItemsFullyCoveredByPublishedLevel2([l1, l2])), ["l2"]);
});

test("UNPUBLISHED Level 2 cannot hide Level 1, even when it fully covers it -> keep both", () => {
  const l1 = tagged(item("l1", "2026-07-05", "10:00", "11:00"), L1_OFFERING);
  const l2 = tagged(item("l2", "2026-07-05", "09:00", "12:00", false), L2_OFFERING);
  assert.deepEqual(ids(hideLevel1ItemsFullyCoveredByPublishedLevel2([l1, l2])), ["l1", "l2"]);
});

test("partial overlap at start (published Level 2 ends before Level 1 ends) -> keep both", () => {
  const l1 = tagged(item("l1", "2026-07-05", "10:00", "11:00"), L1_OFFERING);
  const l2 = tagged(item("l2", "2026-07-05", "09:30", "10:30", true), L2_OFFERING);
  assert.deepEqual(ids(hideLevel1ItemsFullyCoveredByPublishedLevel2([l1, l2])), ["l1", "l2"]);
});

test("partial overlap at end (published Level 2 starts after Level 1 starts) -> keep both", () => {
  const l1 = tagged(item("l1", "2026-07-05", "10:00", "11:00"), L1_OFFERING);
  const l2 = tagged(item("l2", "2026-07-05", "10:30", "11:30", true), L2_OFFERING);
  assert.deepEqual(ids(hideLevel1ItemsFullyCoveredByPublishedLevel2([l1, l2])), ["l1", "l2"]);
});

test("Level 2 fully inside Level 1 (Level 1 is the wider range) -> keep both", () => {
  const l1 = tagged(item("l1", "2026-07-05", "09:00", "11:00"), L1_OFFERING);
  const l2 = tagged(item("l2", "2026-07-05", "09:30", "10:30", true), L2_OFFERING);
  assert.deepEqual(ids(hideLevel1ItemsFullyCoveredByPublishedLevel2([l1, l2])), ["l1", "l2"]);
});

test("touching boundaries (10:00-11:00 and 11:00-12:00) -> keep both, not coverage", () => {
  const l1 = tagged(item("l1", "2026-07-05", "10:00", "11:00"), L1_OFFERING);
  const l2 = tagged(item("l2", "2026-07-05", "11:00", "12:00", true), L2_OFFERING);
  assert.deepEqual(ids(hideLevel1ItemsFullyCoveredByPublishedLevel2([l1, l2])), ["l1", "l2"]);
});

test("identical times on DIFFERENT dates -> keep both", () => {
  const l1 = tagged(item("l1", "2026-07-05", "10:00", "11:00"), L1_OFFERING);
  const l2 = tagged(item("l2", "2026-07-06", "10:00", "11:00", true), L2_OFFERING);
  assert.deepEqual(ids(hideLevel1ItemsFullyCoveredByPublishedLevel2([l1, l2])), ["l1", "l2"]);
});

test("two adjacent published Level 2 items that together cover Level 1 do NOT combine -> Level 1 kept", () => {
  const l1 = tagged(item("l1", "2026-07-05", "09:00", "11:00"), L1_OFFERING);
  const l2a = tagged(item("l2a", "2026-07-05", "09:00", "10:00", true), L2_OFFERING);
  const l2b = tagged(item("l2b", "2026-07-05", "10:00", "11:00", true), L2_OFFERING);
  assert.deepEqual(ids(hideLevel1ItemsFullyCoveredByPublishedLevel2([l1, l2a, l2b])), ["l1", "l2a", "l2b"]);
});

test("Level 1 cannot hide Level 2: a wider published Level 1 item never hides a Level 2 item", () => {
  const l2 = tagged(item("l2", "2026-07-05", "10:00", "11:00", true), L2_OFFERING);
  const l1wide = tagged(item("l1wide", "2026-07-05", "09:00", "12:00", true), L1_OFFERING);
  assert.deepEqual(ids(hideLevel1ItemsFullyCoveredByPublishedLevel2([l2, l1wide])), ["l1wide", "l2"]);
});

test("Level 1 / Level 1: a wider Level 1 item never hides a narrower Level 1 item", () => {
  const narrow = tagged(item("narrow", "2026-07-05", "10:00", "11:00"), L1_OFFERING);
  const wide = tagged(item("wide", "2026-07-05", "09:00", "12:00"), L1_OFFERING);
  assert.deepEqual(ids(hideLevel1ItemsFullyCoveredByPublishedLevel2([narrow, wide])), ["narrow", "wide"]);
});

test("Level 2 / Level 2: a wider Level 2 item never hides a narrower Level 2 item", () => {
  const narrow = tagged(item("narrow", "2026-07-05", "10:00", "11:00", true), L2_OFFERING);
  const wide = tagged(item("wide", "2026-07-05", "09:00", "12:00", true), L2_OFFERING);
  assert.deepEqual(ids(hideLevel1ItemsFullyCoveredByPublishedLevel2([narrow, wide])), ["narrow", "wide"]);
});

// ---------------------------------------------------------------------------
// mergeUnifiedInstructorScheduleSources - the full pipeline
// ---------------------------------------------------------------------------

test("merges items from every source, tagged with their own offering, sorted together", () => {
  const merged = mergeUnifiedInstructorScheduleSources([
    { offering: L1_OFFERING, items: [item("l1-morning", "2026-07-05", "08:00", "09:00")] },
    { offering: L2_OFFERING, items: [item("l2-early", "2026-07-05", "07:00", "07:30")] },
  ]);
  assert.deepEqual(merged.map((i) => i.id), ["l2-early", "l1-morning"]);
  assert.equal(merged[0].sourceCourseOfferingId, "off-l2");
  assert.equal(merged[1].sourceCourseOfferingId, "off-l1");
});

test("full pipeline: a Level 1 item covered by a PUBLISHED Level 2 is removed and stale overlap metadata is cleared", () => {
  const merged = mergeUnifiedInstructorScheduleSources([
    { offering: L1_OFFERING, items: [item("l1", "2026-07-05", "10:00", "11:00")] },
    { offering: L2_OFFERING, items: [item("l2", "2026-07-05", "09:30", "11:30", true)] },
  ]);
  assert.deepEqual(ids(merged), ["l2"]);
  assert.deepEqual(merged[0].overlappingSourceCourseOfferingIds, []);
});

test("full pipeline: a Level 1 item covered by an UNPUBLISHED Level 2 stays, and both carry mutual overlap metadata", () => {
  const merged = mergeUnifiedInstructorScheduleSources([
    { offering: L1_OFFERING, items: [item("l1", "2026-07-05", "10:00", "11:00")] },
    { offering: L2_OFFERING, items: [item("l2", "2026-07-05", "09:30", "11:30", false)] },
  ]);
  assert.deepEqual(ids(merged), ["l1", "l2"]);
  const byId = new Map(merged.map((i) => [i.id, i.overlappingSourceCourseOfferingIds]));
  assert.deepEqual(byId.get("l1"), ["off-l2"]);
  assert.deepEqual(byId.get("l2"), ["off-l1"]);
});

test("full pipeline: a partial overlap preserves both items and their mutual overlap metadata", () => {
  const merged = mergeUnifiedInstructorScheduleSources([
    { offering: L1_OFFERING, items: [item("l1", "2026-07-05", "10:00", "11:00")] },
    { offering: L2_OFFERING, items: [item("l2", "2026-07-05", "10:30", "11:30", true)] },
  ]);
  assert.deepEqual(ids(merged), ["l1", "l2"]);
  const byId = new Map(merged.map((i) => [i.id, i.overlappingSourceCourseOfferingIds]));
  assert.deepEqual(byId.get("l1"), ["off-l2"]);
  assert.deepEqual(byId.get("l2"), ["off-l1"]);
});

test("an absent/empty Level 2 contribution cannot suppress Level 1", () => {
  const merged = mergeUnifiedInstructorScheduleSources([
    { offering: L1_OFFERING, items: [item("l1", "2026-07-05", "10:00", "11:00")] },
    { offering: L2_OFFERING, items: [] },
  ]);
  assert.deepEqual(ids(merged), ["l1"]);
});

test("a non-overlapping item's metadata is an empty array, not undefined/null", () => {
  const merged = mergeUnifiedInstructorScheduleSources([
    { offering: L1_OFFERING, items: [item("l1", "2026-07-05", "08:00", "09:00")] },
    { offering: L2_OFFERING, items: [item("l2", "2026-07-05", "10:00", "11:00", true)] },
  ]);
  for (const it of merged) {
    assert.deepEqual(it.overlappingSourceCourseOfferingIds, []);
  }
});

test("ordering remains deterministic after coverage filtering removes a middle item", () => {
  const merged = mergeUnifiedInstructorScheduleSources([
    {
      offering: L1_OFFERING,
      items: [
        item("l1-early", "2026-07-05", "07:00", "08:00"),
        item("l1-covered", "2026-07-05", "10:00", "11:00"),
        item("l1-late", "2026-07-05", "12:00", "13:00"),
      ],
    },
    { offering: L2_OFFERING, items: [item("l2-cover", "2026-07-05", "09:30", "11:30", true)] },
  ]);
  assert.deepEqual(merged.map((i) => i.id), ["l1-early", "l2-cover", "l1-late"]);
});

// ---------------------------------------------------------------------------
// No input mutation
// ---------------------------------------------------------------------------

test("mergeUnifiedInstructorScheduleSources does not mutate the input arrays/objects", () => {
  const sources = [
    { offering: L1_OFFERING, items: [item("l1", "2026-07-05", "10:00", "11:00")] },
    { offering: L2_OFFERING, items: [item("l2", "2026-07-05", "09:30", "11:30", true)] },
  ];
  const snapshot = JSON.stringify(sources);
  mergeUnifiedInstructorScheduleSources(sources);
  assert.equal(JSON.stringify(sources), snapshot);
});

test("computeInstructorCrossCourseOverlaps does not mutate its input items", () => {
  const a = tagged(item("a", "2026-07-05", "10:00", "11:00"), L1_OFFERING);
  const b = tagged(item("b", "2026-07-05", "10:30", "11:30"), L2_OFFERING);
  const snapshot = JSON.stringify([a, b]);
  computeInstructorCrossCourseOverlaps([a, b]);
  assert.equal(JSON.stringify([a, b]), snapshot);
});
