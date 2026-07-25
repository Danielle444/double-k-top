/**
 * UNIFIED TRAINEE SCHEDULE - SLICE U0: DB-free tests for the pure "הלו״ז שלי"
 * decision core.
 *
 * No Prisma, no DB, no clock, no randomness - every dependency is a fake row
 * array. Covers: the eligibility gate, the per-level group filter, the
 * day-to-week match, placeholder exclusion, source tagging, chronological
 * sort, and the full merge pipeline (including that placeholders are dropped
 * PER SOURCE before tagging, and that the sort is global rather than
 * per-source-then-concatenated).
 *
 * Run with: npx tsx --test lib/course/unified-trainee-schedule-core.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  UNIFIED_SCHEDULE_MINIMUM_ELIGIBLE_OFFERINGS,
  isTraineeEligibleForUnifiedSchedule,
  unifiedScheduleGroupFilterForOfferingLevel,
  findUnifiedScheduleWeekForDay,
  excludeUnifiedSchedulePlaceholders,
  tagUnifiedScheduleItems,
  sortUnifiedScheduleItems,
  mergeUnifiedScheduleSources,
  computeCrossCourseOverlaps,
  type UnifiedScheduleSourceOffering,
} from "./unified-trainee-schedule-core";

// ---------------------------------------------------------------------------
// isTraineeEligibleForUnifiedSchedule
// ---------------------------------------------------------------------------

test("UNIFIED_SCHEDULE_MINIMUM_ELIGIBLE_OFFERINGS is 2", () => {
  assert.equal(UNIFIED_SCHEDULE_MINIMUM_ELIGIBLE_OFFERINGS, 2);
});

test("zero or one eligible offering is NOT eligible for the unified view", () => {
  assert.equal(isTraineeEligibleForUnifiedSchedule(0), false);
  assert.equal(isTraineeEligibleForUnifiedSchedule(1), false);
});

test("two or more eligible offerings ARE eligible for the unified view", () => {
  assert.equal(isTraineeEligibleForUnifiedSchedule(2), true);
  assert.equal(isTraineeEligibleForUnifiedSchedule(3), true);
});

// ---------------------------------------------------------------------------
// unifiedScheduleGroupFilterForOfferingLevel
// ---------------------------------------------------------------------------

test("a Level 2 offering reads with groupFilter 'both'", () => {
  assert.equal(unifiedScheduleGroupFilterForOfferingLevel(2), "both");
});

test("a Level 1 offering (or any non-2 level) reads with groupFilter 'mine'", () => {
  assert.equal(unifiedScheduleGroupFilterForOfferingLevel(1), "mine");
  assert.equal(unifiedScheduleGroupFilterForOfferingLevel(0), "mine");
  assert.equal(unifiedScheduleGroupFilterForOfferingLevel(3), "mine");
});

// ---------------------------------------------------------------------------
// findUnifiedScheduleWeekForDay
// ---------------------------------------------------------------------------

test("finds the week whose range covers the day", () => {
  const weeks = [
    { id: "w1", startDate: "2026-07-05", endDate: "2026-07-11" },
    { id: "w2", startDate: "2026-07-12", endDate: "2026-07-18" },
  ];
  assert.equal(findUnifiedScheduleWeekForDay(weeks, "2026-07-15")?.id, "w2");
  assert.equal(findUnifiedScheduleWeekForDay(weeks, "2026-07-05")?.id, "w1");
  assert.equal(findUnifiedScheduleWeekForDay(weeks, "2026-07-11")?.id, "w1");
});

test("returns null when no week covers the day (no upload, or capability denied upstream)", () => {
  const weeks = [{ id: "w1", startDate: "2026-07-05", endDate: "2026-07-11" }];
  assert.equal(findUnifiedScheduleWeekForDay(weeks, "2026-08-01"), null);
  assert.equal(findUnifiedScheduleWeekForDay([], "2026-07-05"), null);
});

// ---------------------------------------------------------------------------
// excludeUnifiedSchedulePlaceholders / tagUnifiedScheduleItems
// ---------------------------------------------------------------------------

interface FakeItem {
  id: string;
  dateKey: string;
  startTime: string;
  endTime: string;
  isCombinedParticipationPlaceholder: boolean;
}

function realItem(id: string, dateKey: string, startTime: string, endTime: string): FakeItem {
  return { id, dateKey, startTime, endTime, isCombinedParticipationPlaceholder: false };
}

function placeholderItem(id: string, dateKey: string, startTime: string, endTime: string): FakeItem {
  return { id, dateKey, startTime, endTime, isCombinedParticipationPlaceholder: true };
}

const L1_OFFERING: UnifiedScheduleSourceOffering = { id: "off-l1", label: "רמה 1", level: 1 };
const L2_OFFERING: UnifiedScheduleSourceOffering = { id: "off-l2", label: "רמה 2 · חורף", level: 2 };

test("excludeUnifiedSchedulePlaceholders drops every placeholder item, keeps every real item", () => {
  const items = [
    realItem("r1", "2026-07-05", "08:00", "09:00"),
    placeholderItem("p1", "2026-07-05", "09:00", "10:00"),
    realItem("r2", "2026-07-05", "10:00", "11:00"),
  ];
  const result = excludeUnifiedSchedulePlaceholders(items);
  assert.deepEqual(result.map((i) => i.id), ["r1", "r2"]);
});

test("tagUnifiedScheduleItems adds the source fields without dropping existing ones", () => {
  const items = [realItem("r1", "2026-07-05", "08:00", "09:00")];
  const [tagged] = tagUnifiedScheduleItems(items, L2_OFFERING);
  assert.equal(tagged.id, "r1");
  assert.equal(tagged.sourceCourseOfferingId, "off-l2");
  assert.equal(tagged.sourceCourseLabel, "רמה 2 · חורף");
  assert.equal(tagged.sourceCourseLevel, 2);
});

// ---------------------------------------------------------------------------
// sortUnifiedScheduleItems
// ---------------------------------------------------------------------------

test("sorts chronologically by dateKey, then startTime, then endTime", () => {
  const items = [
    realItem("late", "2026-07-05", "10:00", "11:00"),
    realItem("early", "2026-07-05", "08:00", "09:00"),
    realItem("next-day", "2026-07-06", "07:00", "08:00"),
  ];
  const sorted = sortUnifiedScheduleItems(items);
  assert.deepEqual(sorted.map((i) => i.id), ["early", "late", "next-day"]);
});

// ---------------------------------------------------------------------------
// mergeUnifiedScheduleSources - the full pipeline
// ---------------------------------------------------------------------------

test("merges real items from every source, tagged with their own offering, sorted together", () => {
  const merged = mergeUnifiedScheduleSources([
    {
      offering: L1_OFFERING,
      items: [realItem("l1-morning", "2026-07-05", "08:00", "09:00")],
    },
    {
      offering: L2_OFFERING,
      items: [realItem("l2-early", "2026-07-05", "07:00", "07:30")],
    },
  ]);
  // Interleaved chronologically across sources, not concatenated source-by-source.
  assert.deepEqual(merged.map((i) => i.id), ["l2-early", "l1-morning"]);
  assert.equal(merged[0].sourceCourseOfferingId, "off-l2");
  assert.equal(merged[1].sourceCourseOfferingId, "off-l1");
});

test("placeholders are excluded per-source and never reach the merged output", () => {
  const merged = mergeUnifiedScheduleSources([
    {
      offering: L1_OFFERING,
      items: [realItem("l1-real", "2026-07-05", "08:00", "09:00")],
    },
    {
      offering: L2_OFFERING,
      items: [
        placeholderItem("l2-placeholder", "2026-07-05", "08:00", "09:00"),
        realItem("l2-real", "2026-07-05", "09:00", "10:00"),
      ],
    },
  ]);
  assert.deepEqual(
    merged.map((i) => i.id),
    ["l1-real", "l2-real"],
  );
  assert.ok(
    !merged.some((i) => i.id === "l2-placeholder"),
    "the unified view must never contain a placeholder item",
  );
});

test("an offering that contributes no items for the day disappears without error", () => {
  const merged = mergeUnifiedScheduleSources([
    { offering: L1_OFFERING, items: [] },
    { offering: L2_OFFERING, items: [realItem("l2-only", "2026-07-05", "08:00", "09:00")] },
  ]);
  assert.deepEqual(merged.map((i) => i.id), ["l2-only"]);
});

// ---------------------------------------------------------------------------
// computeCrossCourseOverlaps / mergeUnifiedScheduleSources's overlap metadata
//
// Locked rule: same date, DIFFERENT sourceCourseOfferingId, strict interval
// intersection (startA < endB && startB < endA) - touching boundaries are not
// overlaps.
// ---------------------------------------------------------------------------

const L3_OFFERING: UnifiedScheduleSourceOffering = { id: "off-l3", label: "רמה 3", level: 3 };

function tagged(item: FakeItem, offering: UnifiedScheduleSourceOffering) {
  return tagUnifiedScheduleItems([item], offering)[0];
}

test("genuine cross-offering overlap is flagged both ways", () => {
  const a = tagged(realItem("a", "2026-07-05", "10:00", "11:00"), L1_OFFERING);
  const b = tagged(realItem("b", "2026-07-05", "10:30", "11:30"), L2_OFFERING);
  const [ra, rb] = computeCrossCourseOverlaps([a, b]);
  assert.deepEqual(ra.overlappingSourceCourseOfferingIds, ["off-l2"]);
  assert.deepEqual(rb.overlappingSourceCourseOfferingIds, ["off-l1"]);
});

test("touching boundaries (10:00-11:00 and 11:00-12:00) are NOT an overlap", () => {
  const a = tagged(realItem("a", "2026-07-05", "10:00", "11:00"), L1_OFFERING);
  const b = tagged(realItem("b", "2026-07-05", "11:00", "12:00"), L2_OFFERING);
  const [ra, rb] = computeCrossCourseOverlaps([a, b]);
  assert.deepEqual(ra.overlappingSourceCourseOfferingIds, []);
  assert.deepEqual(rb.overlappingSourceCourseOfferingIds, []);
});

test("identical times on DIFFERENT dates are never flagged as an overlap", () => {
  const a = tagged(realItem("a", "2026-07-05", "10:00", "11:00"), L1_OFFERING);
  const b = tagged(realItem("b", "2026-07-06", "10:00", "11:00"), L2_OFFERING);
  const [ra, rb] = computeCrossCourseOverlaps([a, b]);
  assert.deepEqual(ra.overlappingSourceCourseOfferingIds, []);
  assert.deepEqual(rb.overlappingSourceCourseOfferingIds, []);
});

test("two overlapping items from the SAME offering receive no cross-course warning", () => {
  const a = tagged(realItem("a", "2026-07-05", "10:00", "11:00"), L1_OFFERING);
  const b = tagged(realItem("b", "2026-07-05", "10:30", "11:30"), L1_OFFERING);
  const [ra, rb] = computeCrossCourseOverlaps([a, b]);
  assert.deepEqual(ra.overlappingSourceCourseOfferingIds, []);
  assert.deepEqual(rb.overlappingSourceCourseOfferingIds, []);
});

test("one item overlapping two items from the SAME other offering dedupes to one id", () => {
  const a = tagged(realItem("a", "2026-07-05", "10:00", "12:00"), L1_OFFERING);
  const b1 = tagged(realItem("b1", "2026-07-05", "10:00", "10:30"), L2_OFFERING);
  const b2 = tagged(realItem("b2", "2026-07-05", "11:00", "11:30"), L2_OFFERING);
  const [ra] = computeCrossCourseOverlaps([a, b1, b2]);
  assert.deepEqual(ra.overlappingSourceCourseOfferingIds, ["off-l2"]);
});

test("one item overlapping items from TWO different other offerings lists both ids", () => {
  const a = tagged(realItem("a", "2026-07-05", "10:00", "12:00"), L1_OFFERING);
  const b = tagged(realItem("b", "2026-07-05", "10:00", "10:30"), L2_OFFERING);
  const c = tagged(realItem("c", "2026-07-05", "11:00", "11:30"), L3_OFFERING);
  const [ra] = computeCrossCourseOverlaps([a, b, c]);
  assert.deepEqual(ra.overlappingSourceCourseOfferingIds, ["off-l2", "off-l3"]);
});

test("overlap output is deterministic regardless of input order", () => {
  const a = tagged(realItem("a", "2026-07-05", "10:00", "12:00"), L1_OFFERING);
  const b = tagged(realItem("b", "2026-07-05", "10:00", "10:30"), L2_OFFERING);
  const c = tagged(realItem("c", "2026-07-05", "11:00", "11:30"), L3_OFFERING);

  const forward = computeCrossCourseOverlaps([a, b, c]);
  const reversed = computeCrossCourseOverlaps([c, b, a]);
  const shuffled = computeCrossCourseOverlaps([b, a, c]);

  for (const result of [forward, reversed, shuffled]) {
    const byId = new Map(result.map((r) => [r.id, r.overlappingSourceCourseOfferingIds]));
    assert.deepEqual(byId.get("a"), ["off-l2", "off-l3"]);
    assert.deepEqual(byId.get("b"), ["off-l1"]);
    assert.deepEqual(byId.get("c"), ["off-l1"]);
  }
});

test("mergeUnifiedScheduleSources attaches overlap metadata to the final merged/sorted output", () => {
  const merged = mergeUnifiedScheduleSources([
    { offering: L1_OFFERING, items: [realItem("l1", "2026-07-05", "10:00", "11:00")] },
    { offering: L2_OFFERING, items: [realItem("l2", "2026-07-05", "10:30", "11:30")] },
  ]);
  const byId = new Map(merged.map((i) => [i.id, i.overlappingSourceCourseOfferingIds]));
  assert.deepEqual(byId.get("l1"), ["off-l2"]);
  assert.deepEqual(byId.get("l2"), ["off-l1"]);
});

test("a non-overlapping item's metadata is an empty array, not undefined/null", () => {
  const merged = mergeUnifiedScheduleSources([
    { offering: L1_OFFERING, items: [realItem("l1", "2026-07-05", "08:00", "09:00")] },
    { offering: L2_OFFERING, items: [realItem("l2", "2026-07-05", "10:00", "11:00")] },
  ]);
  for (const item of merged) {
    assert.deepEqual(item.overlappingSourceCourseOfferingIds, []);
  }
});
