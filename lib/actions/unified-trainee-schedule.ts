"use server";

/**
 * UNIFIED TRAINEE SCHEDULE - SLICE U0: the "הלו״ז שלי" combined chronological
 * reader for a dual-enrolled trainee.
 *
 * THIN BY DESIGN. Every decision (eligibility, day-to-week matching, group
 * filter per offering level, placeholder exclusion, tagging/merging/sorting)
 * lives in the PURE core (lib/course/unified-trainee-schedule-core.ts). This
 * file performs NO authorization of its own and adds NO new Prisma query: it
 * fans out over the trainee's own eligible offerings
 * (listTraineeCourseOptions - session-derived, never a client id) and, for
 * each one, calls the EXISTING, unchanged, already-tested
 * getWeeklyScheduleSelectionForTrainee + getScheduleForStudent exactly as
 * ScheduleSection.tsx already does per course - so every existing
 * security/visibility rule (SCHEDULE capability gate, week-ownership
 * re-check, publication gate, combined-participation hide rule, riding-info
 * visibility, complex-plan suppression) is reused verbatim, never
 * reimplemented, and can never drift from the single-course path.
 *
 * Takes NO courseOfferingId and NO dual flag from the client: which
 * offerings are read comes ONLY from the trainee's own session-derived
 * eligible set. Single- or zero-course trainees get
 * `{ eligible: false, items: [] }` - the SAME cardinality gate
 * StudentClient.tsx already computes as `dualEnrolled`, enforced again here
 * server-side (defense in depth, never client-trusted).
 *
 * Admin and instructor readers are untouched - this file imports neither of
 * their modules, and neither of them imports this file. This is SLICE U0
 * ONLY: no tab, no UI, no client mount site exists yet.
 */
import { requireCurrentTrainee } from "@/lib/auth/actor";
import { listTraineeCourseOptions } from "./trainee-course-selection";
import { getWeeklyScheduleSelectionForTrainee } from "./weekly-schedule";
import { getScheduleForStudent, type ScheduleItemView, type GroupFilter } from "./student-schedule";
import { isTraineeCourseContextDenial } from "@/lib/course/course-scoped-week-options-core";
import {
  isTraineeEligibleForUnifiedSchedule,
  unifiedScheduleGroupFilterForOfferingLevel,
  findUnifiedScheduleWeekForDay,
  mergeUnifiedScheduleSources,
  type UnifiedScheduleItemView,
  type UnifiedScheduleSource,
} from "@/lib/course/unified-trainee-schedule-core";

export interface UnifiedScheduleResult {
  /** false for a single-/zero-course trainee - the client must not render the unified tab at all. */
  eligible: boolean;
  items: UnifiedScheduleItemView<ScheduleItemView>[];
}

/** The single, uniform "not eligible / nothing to show" result. */
function emptyUnifiedScheduleResult(): UnifiedScheduleResult {
  return { eligible: false, items: [] };
}

/**
 * The trainee's combined, chronological, real-items-only schedule for one
 * specific calendar day, across every course they are eligible for.
 *
 * `dayKey` is a plain date key (e.g. "2026-07-26"), never "all" - the unified
 * view is always anchored to one specific day, matching the "today" home
 * surface and the day picker's own single-day selection.
 */
export async function getUnifiedScheduleForTrainee(dayKey: string): Promise<UnifiedScheduleResult> {
  // listTraineeCourseOptions() is itself session-derived and already fails
  // closed to [] for an unauthenticated/course-less trainee - no separate
  // denial handling is needed here.
  const options = await listTraineeCourseOptions();
  if (!isTraineeEligibleForUnifiedSchedule(options.length)) {
    return emptyUnifiedScheduleResult();
  }

  // The REAL session-derived trainee id - never a client-supplied value.
  // Every existing per-course reader accepts a `studentId` only as a legacy
  // display-filter value (see student-schedule.ts's own comment on
  // getScheduleForStudent); this is the one caller that supplies the
  // session's own id instead of a client-stored one.
  const trainee = await requireCurrentTrainee();

  // Each offering is fetched independently and MUST NOT be allowed to sink
  // another offering's already-valid contribution.
  //
  // In the common path, none of "SCHEDULE disabled for this offering", "no
  // published week covers this day", or "a published week has no items this
  // day" ever throws at all: getWeeklyScheduleSelectionForTrainee and
  // getScheduleForStudent already collapse every one of those to a graceful
  // empty result internally (see loadTraineeWeeklyScheduleSelectionWithDeps /
  // authorizeTraineeWeekReadWithDeps in course-scoped-week-options-core.ts),
  // so findUnifiedScheduleWeekForDay simply returns null or result.items is
  // simply [] - no special-casing is needed for those three cases here.
  //
  // The narrow catch below is defense-in-depth for the one path that COULD
  // still throw past those internal gates: a genuine trainee course-context
  // denial (e.g. a race where this trainee's enrollment into THIS specific
  // offering changes between the eligible-offerings fetch above and this
  // offering's own re-resolution a moment later). That is still an expected
  // "not available for this offering" outcome, so it costs only this ONE
  // offering's contribution. Anything else - a Prisma/DB failure, a defect -
  // is NOT a denial and is deliberately rethrown, which fails the WHOLE
  // Promise.all (and therefore the whole unified request) closed, rather than
  // silently serving a partial or inconsistent merged view.
  const sources: UnifiedScheduleSource<ScheduleItemView>[] = await Promise.all(
    options.map(async (option) => {
      try {
        // Reuses the EXISTING, course-scoped, capability-gated week list -
        // never a new query.
        const selection = await getWeeklyScheduleSelectionForTrainee(option.id);
        const week = findUnifiedScheduleWeekForDay(selection.weeks, dayKey);
        if (!week) {
          return { offering: option, items: [] as ScheduleItemView[] };
        }

        const groupFilter: GroupFilter = unifiedScheduleGroupFilterForOfferingLevel(option.level);
        // The EXISTING, unchanged, already-tested reader - re-authorizes this
        // exact offering/week pair independently, exactly as a per-course tab
        // request would.
        const result = await getScheduleForStudent(trainee.id, week.id, dayKey, groupFilter, option.id);
        return { offering: option, items: result.items };
      } catch (error) {
        if (isTraineeCourseContextDenial(error)) {
          return { offering: option, items: [] as ScheduleItemView[] };
        }
        throw error;
      }
    }),
  );

  return { eligible: true, items: mergeUnifiedScheduleSources(sources) };
}
