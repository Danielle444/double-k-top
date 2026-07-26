/**
 * UNIFIED TRAINEE SCHEDULE - focused tests for the PURE week-picker merge
 * core (./unified-trainee-week-options-core).
 *
 * Everything here runs against plain fixtures: no Next.js cookies, no live
 * Prisma, no React.
 *
 * Run with:
 *   npx tsx --test lib/course/unified-trainee-week-options-core.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  mergeUnifiedTraineeWeekOptions,
  type UnifiedTraineeWeekOptionsSource,
  type WeekOption,
} from "./unified-trainee-week-options-core";

function week(id: string, name: string, startDate: string, endDate: string): WeekOption {
  return { id, name, startDate, endDate };
}

test("empty input yields an empty list", () => {
  assert.deepEqual(mergeUnifiedTraineeWeekOptions([]), []);
});

test("empty input also covers offerings that each contributed zero weeks", () => {
  const sources: UnifiedTraineeWeekOptionsSource[] = [
    { offeringId: "o1", weeks: [] },
    { offeringId: "o2", weeks: [] },
  ];
  assert.deepEqual(mergeUnifiedTraineeWeekOptions(sources), []);
});

test("a single offering's weeks pass through, sorted by startDate", () => {
  const w1 = week("w1", "שבוע 1", "2026-08-03", "2026-08-07");
  const w2 = week("w2", "שבוע 2", "2026-07-27", "2026-07-31");
  const sources: UnifiedTraineeWeekOptionsSource[] = [{ offeringId: "o1", weeks: [w1, w2] }];
  assert.deepEqual(mergeUnifiedTraineeWeekOptions(sources), [w2, w1]);
});

test("two offerings with disjoint ranges are merged and sorted together", () => {
  const l1w1 = week("l1-w1", "שבוע 1", "2026-07-27", "2026-07-31");
  const l2w1 = week("l2-w1", "שבוע א", "2026-08-03", "2026-08-07");
  const sources: UnifiedTraineeWeekOptionsSource[] = [
    { offeringId: "l1", weeks: [l1w1] },
    { offeringId: "l2", weeks: [l2w1] },
  ];
  assert.deepEqual(mergeUnifiedTraineeWeekOptions(sources), [l1w1, l2w1]);
});

test("two offerings publishing the IDENTICAL date range dedupe to exactly one entry (no duplicate day buttons)", () => {
  const l1w1 = week("l1-w1", "שבוע 1", "2026-07-27", "2026-07-31");
  const l2w1 = week("l2-w1", "שבוע א", "2026-07-27", "2026-07-31");
  const sources: UnifiedTraineeWeekOptionsSource[] = [
    { offeringId: "l1", weeks: [l1w1] },
    { offeringId: "l2", weeks: [l2w1] },
  ];
  const merged = mergeUnifiedTraineeWeekOptions(sources);
  assert.equal(merged.length, 1);
  // First-encountered (by input order) wins - the l1 offering's own id, never a synthesized one.
  assert.equal(merged[0].id, "l1-w1");
});

test("a shared label but DIFFERENT date ranges is never collapsed (dedup is by date range, not name)", () => {
  const l1w1 = week("l1-w1", "שבוע 1", "2026-07-27", "2026-07-31");
  const l2w1 = week("l2-w1", "שבוע 1", "2026-08-03", "2026-08-07");
  const sources: UnifiedTraineeWeekOptionsSource[] = [
    { offeringId: "l1", weeks: [l1w1] },
    { offeringId: "l2", weeks: [l2w1] },
  ];
  const merged = mergeUnifiedTraineeWeekOptions(sources);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged, [l1w1, l2w1]);
});

test("two offerings with overlapping-but-not-identical ranges are both kept, sorted", () => {
  const l1w1 = week("l1-w1", "שבוע 1", "2026-07-27", "2026-08-02");
  const l2w1 = week("l2-w1", "שבוע א", "2026-07-30", "2026-08-05");
  const sources: UnifiedTraineeWeekOptionsSource[] = [
    { offeringId: "l1", weeks: [l1w1] },
    { offeringId: "l2", weeks: [l2w1] },
  ];
  const merged = mergeUnifiedTraineeWeekOptions(sources);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged, [l1w1, l2w1]);
});

test("every surviving option keeps its own REAL WeeklySchedule id - never a synthesized id", () => {
  const l1w1 = week("real-weekly-schedule-id-1", "שבוע 1", "2026-07-27", "2026-07-31");
  const sources: UnifiedTraineeWeekOptionsSource[] = [{ offeringId: "l1", weeks: [l1w1] }];
  const merged = mergeUnifiedTraineeWeekOptions(sources);
  assert.equal(merged[0].id, "real-weekly-schedule-id-1");
});

test("does not mutate the input arrays/objects", () => {
  const w1 = week("w1", "שבוע 1", "2026-07-27", "2026-07-31");
  const sources: UnifiedTraineeWeekOptionsSource[] = [{ offeringId: "l1", weeks: [w1] }];
  const snapshot = JSON.stringify(sources);
  mergeUnifiedTraineeWeekOptions(sources);
  assert.equal(JSON.stringify(sources), snapshot);
});
