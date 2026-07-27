"use server";

/**
 * UNIFIED INSTRUCTOR SCHEDULE - SLICE IUS-2: the week/day navigation reader for
 * the instructor "הלו״ז המשולב שלי" sub-view - the merged week-option list (and
 * its own default selected week) across every course offering an authenticated
 * ACTIVE instructor may address.
 *
 * THIN BY DESIGN. Every decision (eligibility cardinality, the dedup-by-actual-
 * date-range merge, the default-week pick) lives in an ALREADY COMMITTED pure
 * core. This file performs NO authorization of its own and adds NO Prisma query
 * at all: it fans out over listInstructorContactCourseOptions() and, per
 * offering, calls the EXISTING, unchanged, already-tested
 * getInstructorWeekSelection - so every existing gate (session identity, the
 * allow-listed offering policy, SCHEDULE=ENABLED, the offering-scoped week
 * query, and the deliberate inclusion of UNPUBLISHED weeks) is reused verbatim
 * and can never drift from the single-course path.
 *
 * TAKES NO ARGUMENTS AT ALL. No instructorId, no courseOfferingId, no
 * eligibility flag. Which offerings are read comes ONLY from the server's own
 * session-derived, allow-listed menu, so no client value can widen scope.
 *
 * ELIGIBILITY IS BLANKET BY POLICY, NOT BY PER-INSTRUCTOR DATA. Under the
 * current temporary two-offering access model
 * (INSTRUCTOR_ALLOWED_COURSE_OFFERING_IDS) every active instructor may address
 * both offerings, so every active instructor is eligible here. That is the
 * approved launch behaviour; per-instructor course permissions are deliberately
 * NOT introduced by this slice. Content is still gated per offering by
 * SCHEDULE=ENABLED, so a non-enabled offering simply contributes nothing.
 *
 * Trainee readers are untouched: this file imports neither the trainee unified
 * actions nor any trainee core, and none of them imports this file.
 */
import { listInstructorContactCourseOptions } from "./instructor-course-options";
import { getInstructorWeekSelection } from "./instructor-schedule-course-scoped";
import { isInstructorScheduleDenial } from "@/lib/course/instructor-schedule-scope-core";
import { pickDefaultWeekId } from "@/lib/course/course-scoped-week-options-core";
import { isInstructorEligibleForUnifiedSchedule } from "@/lib/course/unified-instructor-schedule-core";
import {
  mergeUnifiedInstructorWeekOptions,
  type UnifiedInstructorWeekOption,
  type UnifiedInstructorWeekOptionsSource,
} from "@/lib/course/unified-instructor-week-options-core";
import { todayDateKey } from "@/lib/dates";

export interface UnifiedInstructorWeekOptionsResult {
  /** false when fewer than two offerings are addressable - the client must not render the unified picker. */
  eligible: boolean;
  weeks: UnifiedInstructorWeekOption[];
  defaultWeekId: string | null;
}

/** The single, uniform "not eligible / nothing to show" result. */
function emptyUnifiedInstructorWeekOptionsResult(): UnifiedInstructorWeekOptionsResult {
  return { eligible: false, weeks: [], defaultWeekId: null };
}

/**
 * The instructor's combined week-option list, merged across every offering they
 * may address, plus that merged list's own default selected week.
 */
export async function getUnifiedInstructorWeekOptions(): Promise<UnifiedInstructorWeekOptionsResult> {
  // Session-derived and allow-listed server-side. It THROWS for an anonymous,
  // wrong-audience or INACTIVE caller rather than returning [] - that is a
  // fail-closed outcome and is deliberately left to propagate, so an
  // unauthorized caller receives no data and no merged week list at all.
  const options = await listInstructorContactCourseOptions();
  if (!isInstructorEligibleForUnifiedSchedule(options.length)) {
    return emptyUnifiedInstructorWeekOptionsResult();
  }

  // Each offering is fetched independently and MUST NOT be allowed to sink
  // another offering's already-valid contribution. A narrow, typed instructor
  // course-context denial (unauthorized, outside the temporary policy, or this
  // offering's SCHEDULE capability not ENABLED - the last of which
  // getInstructorWeekSelection already collapses to an empty selection
  // internally) costs only this ONE offering's weeks. Anything else - a
  // Prisma/DB fault, a configured-but-missing offering, a defect - is NOT a
  // denial and is deliberately rethrown, failing the WHOLE Promise.all closed
  // rather than silently serving a partial or inconsistent merged week list.
  const sources: UnifiedInstructorWeekOptionsSource[] = await Promise.all(
    options.map(async (option) => {
      try {
        // The EXISTING, course-scoped, capability-gated week list - never a new query.
        const selection = await getInstructorWeekSelection(option.id);
        return { offeringId: option.id, weeks: selection.weeks };
      } catch (error) {
        if (isInstructorScheduleDenial(error)) {
          return { offeringId: option.id, weeks: [] as UnifiedInstructorWeekOption[] };
        }
        throw error;
      }
    }),
  );

  // Dedup by ACTUAL date range (never by name), then the SAME committed
  // default-week pick the single-course picker already uses, applied to the
  // merged list rather than to any one offering's.
  const weeks = mergeUnifiedInstructorWeekOptions(sources);
  return { eligible: true, weeks, defaultWeekId: pickDefaultWeekId(weeks, todayDateKey()) };
}
