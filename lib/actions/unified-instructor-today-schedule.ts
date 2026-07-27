"use server";

/**
 * UNIFIED INSTRUCTOR SCHEDULE - SLICE IUS-2B: the "הלו״ז המשולב שלי" reader for
 * the instructor HOME ("today") surface - this instructor's OWN items for
 * today, unioned across every course offering they may address.
 *
 * WHY A SEPARATE ACTION FROM THE WEEKLY ONE
 * -----------------------------------------
 * The weekly reader is anchored to a SELECTED WEEK's date range and resolves,
 * per offering, which of ITS real WeeklySchedule rows overlap that range. The
 * today surface has no selected week at all: the server picks whichever week of
 * each offering covers today, from its own clock, inside the already-committed
 * getTodayScheduleForInstructor. Reusing the weekly action here would mean
 * manufacturing a fake single-day range and, worse, re-deriving week ids on the
 * client - so this thin sibling calls the EXISTING today reader per offering
 * instead. No fake WeeklySchedule id is ever constructed.
 *
 * THIN BY DESIGN. It performs NO authorization of its own and adds NO Prisma
 * query at all: it fans out over listInstructorContactCourseOptions() and, per
 * offering, calls the EXISTING, unchanged, already-tested
 * getTodayScheduleForInstructor - so every existing gate (session identity,
 * resolveInstructorCourseOffering against the allow-list, SCHEDULE=ENABLED, the
 * offering-scoped week query, and the SERVER-SIDE choice of "today") is reused
 * verbatim and can never drift from the single-course path. The merge itself is
 * the committed pure core, shared with the weekly view.
 *
 * TAKES NO ARGUMENTS AT ALL. No instructorId, no courseOfferingId, no date and
 * no filter. "Today" is derived server-side by the existing reader's own clock,
 * exactly as the per-course today card already does - the client sends nothing.
 *
 * MINE-ONLY BY DEFINITION. Like the weekly unified view, this is the
 * instructor's OWN schedule, not every instructor's timetable merged. The
 * filter is fixed server-side to the existing "mine" value and is deliberately
 * not a parameter, so a client cannot request "all" through this action. "mine"
 * keeps its established meaning verbatim (isInstructorMatch/isMealItem inside
 * the existing reader, driven by the SESSION-derived instructor's own name
 * columns); no matching helper is duplicated here.
 *
 * Trainee readers are untouched: this file imports neither the trainee unified
 * actions/cores nor combined-participation-visibility-core.
 */
import { listInstructorContactCourseOptions } from "./instructor-course-options";
import {
  getTodayScheduleForInstructor,
  type InstructorScheduleFilter,
  type InstructorScheduleItem,
} from "./instructor-schedule-course-scoped";
import { isInstructorScheduleDenial } from "@/lib/course/instructor-schedule-scope-core";
import {
  isInstructorEligibleForUnifiedSchedule,
  mergeUnifiedInstructorScheduleSources,
  type UnifiedInstructorScheduleItemView,
  type UnifiedInstructorScheduleSource,
} from "@/lib/course/unified-instructor-schedule-core";

/**
 * The ONE filter every unified instructor read uses, fixed here and never
 * accepted from a caller - the same value and the same rationale as the weekly
 * unified reader's.
 */
const UNIFIED_INSTRUCTOR_TODAY_FILTER: InstructorScheduleFilter = "mine";

export interface UnifiedInstructorTodayScheduleResult {
  /** false when fewer than two offerings are addressable - the client must not render the unified list. */
  eligible: boolean;
  items: UnifiedInstructorScheduleItemView<InstructorScheduleItem>[];
}

/** The single, uniform "not eligible / nothing to show" result. */
function emptyUnifiedInstructorTodayScheduleResult(): UnifiedInstructorTodayScheduleResult {
  return { eligible: false, items: [] };
}

/**
 * The instructor's OWN chronological schedule for TODAY, across every course
 * offering they may address.
 *
 * Each offering's contribution is already narrowed to today by the existing
 * reader (which picks the covering week of THAT course from the server clock
 * and then narrows items to that same single day), so no range filtering is
 * needed here - only the source tagging, coverage/overlap rules and the single
 * global chronological sort performed by the shared pure core.
 */
export async function getUnifiedTodayScheduleForInstructor(): Promise<UnifiedInstructorTodayScheduleResult> {
  // Session-derived and allow-listed server-side. It THROWS for an anonymous,
  // wrong-audience or INACTIVE caller rather than returning [] - a fail-closed
  // outcome, deliberately left to propagate so no merged list is served.
  const options = await listInstructorContactCourseOptions();
  if (!isInstructorEligibleForUnifiedSchedule(options.length)) {
    return emptyUnifiedInstructorTodayScheduleResult();
  }

  // Each offering is fetched independently and MUST NOT be allowed to sink
  // another offering's already-valid contribution. A narrow, typed instructor
  // course-context denial costs only this ONE offering's items; anything else -
  // a Prisma/DB fault, a configured-but-missing offering, a defect - is NOT a
  // denial and is rethrown, failing the WHOLE request closed rather than
  // silently serving a partial merged schedule that looks complete.
  const sources: UnifiedInstructorScheduleSource<InstructorScheduleItem>[] = await Promise.all(
    options.map(async (option) => {
      // Display-only tagging metadata. Identity is the offering ID; the label is
      // the server-composed menu label and is never parsed back into an
      // identity, and the level is the menu's DB-backed CourseOffering.level.
      const offering = { id: option.id, label: option.label, level: option.level };
      try {
        // The EXISTING, unchanged today reader - it re-authorizes this exact
        // offering independently and derives "today" from the SERVER clock only
        // after all its gates pass. No week id and no date are sent.
        const result = await getTodayScheduleForInstructor(
          option.id,
          UNIFIED_INSTRUCTOR_TODAY_FILTER,
        );
        return { offering, items: result.items };
      } catch (error) {
        if (isInstructorScheduleDenial(error)) {
          return { offering, items: [] as InstructorScheduleItem[] };
        }
        throw error;
      }
    }),
  );

  // Source-tag, apply the published-Level-2 coverage/hide rule, compute
  // cross-offering overlap metadata, and sort the whole set once - all in the
  // committed pure core shared with the weekly unified view, never
  // reimplemented inline here.
  return { eligible: true, items: mergeUnifiedInstructorScheduleSources(sources) };
}
