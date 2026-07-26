"use server";

/**
 * UNIFIED TRAINEE SCHEDULE - week/day navigation reader for "הלו״ז שלי": the
 * merged week-option list (and its own default selected week) across a
 * dual-enrolled trainee's own eligible course offerings.
 *
 * THIN BY DESIGN, mirroring lib/actions/unified-trainee-schedule.ts exactly
 * for its eligibility gate, offering fan-out and per-offering denial
 * handling - see that file's own comment for the full rationale, restated
 * only where this reader differs: it returns the trainee's merged week
 * OPTIONS for the WeekDayPicker, never a single day's schedule items.
 *
 * Takes NO courseOfferingId and NO dual flag from the client: which
 * offerings are read comes ONLY from the trainee's own session-derived
 * eligible set (listTraineeCourseOptions). Single- or zero-course trainees
 * get `{ eligible: false, weeks: [], defaultWeekId: null }` - the SAME
 * cardinality gate getUnifiedScheduleForTrainee already applies, re-enforced
 * again here, server-side.
 *
 * Every per-offering week list comes from the EXISTING, unchanged, already
 * course-scoped and capability-gated getWeeklyScheduleSelectionForTrainee -
 * no new Prisma query is added here. The merge itself (dedup by actual date
 * range, sort) lives in the pure core (unified-trainee-week-options-core.ts)
 * so it is never reimplemented inline and can be unit-tested without a
 * database.
 */
import { listTraineeCourseOptions } from "./trainee-course-selection";
import { getWeeklyScheduleSelectionForTrainee } from "./weekly-schedule";
import {
  isTraineeCourseContextDenial,
  pickDefaultWeekId,
} from "@/lib/course/course-scoped-week-options-core";
import { isTraineeEligibleForUnifiedSchedule } from "@/lib/course/unified-trainee-schedule-core";
import {
  mergeUnifiedTraineeWeekOptions,
  type UnifiedTraineeWeekOptionsSource,
  type WeekOption,
} from "@/lib/course/unified-trainee-week-options-core";
import { todayDateKey } from "@/lib/dates";

export interface UnifiedWeekOptionsResult {
  /** false for a single-/zero-course trainee - the client must not render the unified week picker at all. */
  eligible: boolean;
  weeks: WeekOption[];
  defaultWeekId: string | null;
}

/** The single, uniform "not eligible / nothing to show" result. */
function emptyUnifiedWeekOptionsResult(): UnifiedWeekOptionsResult {
  return { eligible: false, weeks: [], defaultWeekId: null };
}

/**
 * The trainee's combined week-option list (and its own default selected
 * week), merged across every course offering they are eligible for.
 */
export async function getUnifiedWeekOptionsForTrainee(): Promise<UnifiedWeekOptionsResult> {
  // listTraineeCourseOptions() is itself session-derived and already fails
  // closed to [] for an unauthenticated/course-less trainee - no separate
  // denial handling is needed here.
  const options = await listTraineeCourseOptions();
  if (!isTraineeEligibleForUnifiedSchedule(options.length)) {
    return emptyUnifiedWeekOptionsResult();
  }

  // Each offering is fetched independently and MUST NOT be allowed to sink
  // another offering's already-valid contribution - the SAME shape as
  // getUnifiedScheduleForTrainee's own per-offering fan-out. A narrow, typed
  // trainee course-context denial (SCHEDULE disabled, no published week,
  // this trainee's enrollment into THIS specific offering changing between
  // the eligible-offerings fetch above and this offering's own
  // re-resolution a moment later) costs only this ONE offering's
  // contribution. Anything else - a Prisma/DB failure, a defect - is NOT a
  // denial and is deliberately rethrown, which fails the WHOLE Promise.all
  // (and therefore the whole unified request) closed, rather than silently
  // serving a partial or inconsistent merged week list.
  const sources: UnifiedTraineeWeekOptionsSource[] = await Promise.all(
    options.map(async (option) => {
      try {
        // Reuses the EXISTING, course-scoped, capability-gated week list -
        // never a new query.
        const selection = await getWeeklyScheduleSelectionForTrainee(option.id);
        return { offeringId: option.id, weeks: selection.weeks };
      } catch (error) {
        if (isTraineeCourseContextDenial(error)) {
          return { offeringId: option.id, weeks: [] as WeekOption[] };
        }
        throw error;
      }
    }),
  );

  const weeks = mergeUnifiedTraineeWeekOptions(sources);
  return { eligible: true, weeks, defaultWeekId: pickDefaultWeekId(weeks, todayDateKey()) };
}
