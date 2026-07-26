/**
 * UNIFIED INSTRUCTOR SCHEDULE - week-picker merge: the PURE core that merges an
 * instructor's per-offering week option lists into ONE chronological week list
 * for the unified "הלו״ז המשולב שלי" sub-view's week/day navigation.
 *
 * PURE by construction: no Prisma, no DB, no clock, no randomness, no env, no
 * cookies, no next/headers, no React - so the merge/dedup/sort contract is
 * unit-testable without a database (see
 * unified-instructor-week-options-core.test.ts).
 *
 * WHY A DEDICATED INSTRUCTOR CORE
 * -------------------------------
 * This is a deliberate clone of the trainee week-merge logic
 * (unified-trainee-week-options-core.ts), NOT a shared import. The logic is
 * tiny and the two paths must be free to diverge (e.g. the instructor reader
 * intentionally includes unpublished weeks, unlike the trainee one) without any
 * risk of a shared refactor silently changing trainee behavior. When in doubt,
 * clone the small pure logic to avoid regression.
 *
 * WHAT THIS OWNS
 * --------------
 *  - Merging N already-fetched, already-authorized, per-offering week option
 *    lists into ONE list, deduped by ACTUAL (startDate, endDate) equality -
 *    never by name/label, so two offerings that happen to share a label but
 *    cover different date ranges are never collapsed, and two offerings that
 *    publish the identical date range never produce duplicate day-picker
 *    buttons. The first-encountered entry (by input order) wins and keeps its
 *    own REAL WeeklySchedule id - this function never synthesizes a fake id.
 *  - Sorting the merged list ascending by startDate (plain string comparison;
 *    startDate is already a date-key string, never a Date object).
 *
 * WHAT THIS DELIBERATELY DOES NOT OWN
 * ------------------------------------
 *  - Which offerings are eligible, session/actor resolution, capability gating,
 *    or the per-offering week fetch itself - all of that lives in a later
 *    orchestration slice (IUS1), which calls the EXISTING, unchanged instructor
 *    week reader per offering.
 *  - Picking the default selected week - that is the EXISTING, unchanged
 *    default-week selection applied by the caller to this function's OUTPUT.
 */

/** The client-facing week-option shape (a real WeeklySchedule projected for the picker). */
export interface UnifiedInstructorWeekOption {
  readonly id: string;
  readonly name: string;
  readonly startDate: string;
  readonly endDate: string;
}

/** One eligible offering's own already-fetched, already-authorized week option list. */
export interface UnifiedInstructorWeekOptionsSource {
  readonly offeringId: string;
  readonly weeks: readonly UnifiedInstructorWeekOption[];
}

/**
 * Merge every eligible offering's own week list into one chronological,
 * deduplicated list for the unified week/day picker.
 *
 * Dedup key is the ACTUAL date range (`startDate` + `endDate`), never `name`:
 * two offerings could coincidentally label a week identically while covering
 * different ranges (must NOT collapse), and conversely if two offerings publish
 * a week over the identical range, only ONE entry must reach the picker so its
 * day buttons are never duplicated.
 *
 * When two entries share the same date range, the FIRST-ENCOUNTERED one (by
 * input order) wins, and its `id` (a real WeeklySchedule.id) is what survives;
 * this function never synthesizes a fake id.
 *
 * No mutation of inputs, no I/O, no clock read - only string comparison of
 * already-fetched date keys.
 */
export function mergeUnifiedInstructorWeekOptions(
  perOfferingWeeks: readonly UnifiedInstructorWeekOptionsSource[],
): UnifiedInstructorWeekOption[] {
  const byDateRange = new Map<string, UnifiedInstructorWeekOption>();
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
