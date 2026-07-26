/**
 * UNIFIED TRAINEE SCHEDULE - week-picker merge: the PURE core that merges a
 * dual-enrolled trainee's own per-offering week option lists into ONE
 * chronological week list for the "הלו״ז שלי" (unified) sub-view's
 * WeekDayPicker.
 *
 * PURE by construction: no Prisma, no DB, no clock, no randomness, no env, no
 * cookies, no next/headers, no React - so the merge/dedup/sort contract is
 * unit-testable without a database (see
 * unified-trainee-week-options-core.test.ts).
 *
 * WHAT THIS OWNS
 * --------------
 *  - Merging N already-fetched, already-authorized, per-offering week option
 *    lists (see WeekOption - the exact shape
 *    lib/course/course-scoped-week-options-core.ts's TraineeWeekOption
 *    already uses: `{ id, name, startDate, endDate }`) into ONE list,
 *    deduped by ACTUAL (startDate, endDate) equality - never by name/label,
 *    so two offerings that happen to share a label but cover different date
 *    ranges are never collapsed, and two offerings that publish the
 *    identical date range never produce duplicate day-picker buttons.
 *  - Sorting the merged list ascending by startDate (plain string
 *    comparison - the caller's WeekOption.startDate is already a date key,
 *    never a Date object, so there is nothing to parse or construct here).
 *
 * WHAT THIS DELIBERATELY DOES NOT OWN
 * ------------------------------------
 *  - Which offerings are eligible, session/actor resolution, capability
 *    gating, or the per-offering week fetch itself - all of that lives in the
 *    orchestration (lib/actions/unified-trainee-week-options.ts), which calls
 *    the EXISTING listTraineeCourseOptions + getWeeklyScheduleSelectionForTrainee
 *    per offering, exactly as the sibling unified schedule-item reader
 *    (lib/actions/unified-trainee-schedule.ts) already does.
 *  - Picking the default selected week - that is the EXISTING, unchanged
 *    pickDefaultWeekId (course-scoped-week-options-core.ts), applied by the
 *    caller to this function's OUTPUT.
 */
import type { TraineeWeekOption } from "./course-scoped-week-options-core";

/** The client-facing week-option shape - identical to TraineeWeekOption / WeekDayPicker's WeekOption. */
export type WeekOption = TraineeWeekOption;

/** One eligible offering's own already-fetched, already-authorized week option list. */
export interface UnifiedTraineeWeekOptionsSource {
  readonly offeringId: string;
  readonly weeks: readonly WeekOption[];
}

/**
 * Merge every eligible offering's own published week list into one
 * chronological, deduplicated list for the unified week/day picker.
 *
 * Dedup key is the ACTUAL date range (`startDate` + `endDate`), never
 * `name`: two offerings could coincidentally label a week identically while
 * covering different ranges (must NOT collapse), and conversely if two
 * offerings publish a week over the identical range, only ONE entry must
 * reach the picker so its day buttons are never duplicated.
 *
 * When two entries share the same date range, the FIRST-ENCOUNTERED one (by
 * input order - offerings in the order the caller passed them, e.g. the
 * order listTraineeCourseOptions() returns) wins, and its `id` (a real
 * WeeklySchedule.id) is what survives; this function never synthesizes a
 * fake id.
 *
 * No mutation of inputs, no I/O, no clock read - only string comparison of
 * already-fetched date keys.
 */
export function mergeUnifiedTraineeWeekOptions(
  perOfferingWeeks: readonly UnifiedTraineeWeekOptionsSource[],
): WeekOption[] {
  const byDateRange = new Map<string, WeekOption>();
  for (const { weeks } of perOfferingWeeks) {
    for (const week of weeks) {
      const key = `${week.startDate}|${week.endDate}`;
      if (!byDateRange.has(key)) {
        byDateRange.set(key, week);
      }
    }
  }
  return Array.from(byDateRange.values()).sort((a, b) => a.startDate.localeCompare(b.startDate));
}
