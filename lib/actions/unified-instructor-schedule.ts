"use server";

/**
 * UNIFIED INSTRUCTOR SCHEDULE - SLICE IUS-2: the "הלו״ז המשולב שלי" combined
 * chronological reader, merging an instructor's schedule across EVERY course
 * offering they may address into one list.
 *
 * THIN BY DESIGN. Every decision (eligibility cardinality, selected-range ->
 * per-offering week resolution, range narrowing, source tagging, the
 * published-Level-2 coverage/hide rule, cross-offering overlap metadata, and
 * the single global chronological sort) lives in the ALREADY COMMITTED pure
 * core lib/course/unified-instructor-schedule-core.ts. This file performs NO
 * authorization of its own and adds NO Prisma query at all: it fans out over
 * listInstructorContactCourseOptions() and, per offering, calls the EXISTING,
 * unchanged, already-tested getInstructorWeekSelection +
 * getCourseScopedScheduleForInstructor exactly as the per-course browser
 * already does - so every existing gate (session identity,
 * resolveInstructorCourseOffering against the allow-list, SCHEDULE=ENABLED, the
 * COMPOSITE week-ownership where, the "mine"/meal filter, and the deliberate
 * inclusion of UNPUBLISHED weeks) is reused verbatim and can never drift from
 * the single-course path.
 *
 * TAKES NO IDENTITY AND NO COURSE CONTEXT FROM THE CLIENT. No instructorId, no
 * courseOfferingId, no eligibility flag. The only parameters are a selected
 * date range, a day narrowing and the existing mine/all filter - none of which
 * can widen scope: which offerings are read comes ONLY from the server's own
 * session-derived, allow-listed menu, and every per-offering read
 * independently re-authorizes that offering.
 *
 * WHY A RANGE PLUS A DAY. The merged week picker keeps exactly ONE real
 * WeeklySchedule id per date range, so it cannot name the OTHER offering's
 * week. The range is therefore the shared coordinate: each offering resolves
 * its OWN real weeks that overlap it (never an exact-boundary match, which
 * would drop a whole offering whose weeks differ by a day), and `dayKey`
 * narrows inside them exactly as the per-course reader already does.
 *
 * Trainee readers are untouched: this file imports neither the trainee unified
 * actions/cores nor combined-participation-visibility-core (whose own header
 * states instructor readers must never call it), and none of them imports this
 * file.
 */
import { listInstructorContactCourseOptions } from "./instructor-course-options";
import {
  getCourseScopedScheduleForInstructor,
  getInstructorWeekSelection,
  type InstructorScheduleFilter,
  type InstructorScheduleItem,
} from "./instructor-schedule-course-scoped";
import { isInstructorScheduleDenial } from "@/lib/course/instructor-schedule-scope-core";
import {
  filterUnifiedInstructorItemsToRange,
  findUnifiedInstructorWeeksForRange,
  isInstructorEligibleForUnifiedSchedule,
  mergeUnifiedInstructorScheduleSources,
  type UnifiedInstructorScheduleItemView,
  type UnifiedInstructorScheduleSource,
} from "@/lib/course/unified-instructor-schedule-core";

export interface UnifiedInstructorScheduleResult {
  /** false when fewer than two offerings are addressable - the client must not render the unified list. */
  eligible: boolean;
  items: UnifiedInstructorScheduleItemView<InstructorScheduleItem>[];
}

/** The single, uniform "not eligible / nothing to show" result. */
function emptyUnifiedInstructorScheduleResult(): UnifiedInstructorScheduleResult {
  return { eligible: false, items: [] };
}

/**
 * The instructor's combined, chronological schedule for one selected inclusive
 * date range, across every course offering they may address.
 *
 * `dayKey` is either a plain date key inside the range or "all" for the whole
 * range - the same two values the per-course browser's day picker already
 * produces, passed straight through to the existing reader.
 */
export async function getUnifiedScheduleForInstructor(
  rangeStart: string,
  rangeEnd: string,
  dayKey: string | "all",
  filter: InstructorScheduleFilter,
): Promise<UnifiedInstructorScheduleResult> {
  // Session-derived and allow-listed server-side. It THROWS for an anonymous,
  // wrong-audience or INACTIVE caller rather than returning [] - a fail-closed
  // outcome, deliberately left to propagate so no merged list is served.
  const options = await listInstructorContactCourseOptions();
  if (!isInstructorEligibleForUnifiedSchedule(options.length)) {
    return emptyUnifiedInstructorScheduleResult();
  }

  // Each offering is fetched independently and MUST NOT be allowed to sink
  // another offering's already-valid contribution. A narrow, typed instructor
  // course-context denial costs only this ONE offering's items; anything else -
  // a Prisma/DB fault, a configured-but-missing offering, a defect - is NOT a
  // denial and is rethrown, failing the WHOLE request closed rather than
  // silently serving a partial merged schedule that looks complete.
  const sources: UnifiedInstructorScheduleSource<InstructorScheduleItem>[] = await Promise.all(
    options.map(async (option) => {
      // Display-only tagging metadata. Identity is the offering ID; the label
      // is the server-composed menu label and is never parsed back into an
      // identity, and the level is the menu's DB-backed CourseOffering.level.
      const offering = { id: option.id, label: option.label, level: option.level };
      try {
        // The EXISTING, course-scoped, capability-gated week list - never a new query.
        const selection = await getInstructorWeekSelection(option.id);
        // THIS offering's own real weeks intersecting the selected range. Never
        // the merged picker's id, which may belong to the other offering.
        const weeks = findUnifiedInstructorWeeksForRange(selection.weeks, rangeStart, rangeEnd);
        if (weeks.length === 0) {
          return { offering, items: [] as InstructorScheduleItem[] };
        }

        // The EXISTING, unchanged reader per matched week - it re-authorizes
        // this exact offering/week pair independently, exactly as a per-course
        // request would, and applies the same "mine"/meal and day filtering.
        const perWeek = await Promise.all(
          weeks.map((week) =>
            getCourseScopedScheduleForInstructor(option.id, week.id, dayKey, filter),
          ),
        );
        // A matched week merely OVERLAPS the range, so it can carry items on
        // days outside it - narrow before merging.
        const items = filterUnifiedInstructorItemsToRange(
          perWeek.flatMap((result) => result.items),
          rangeStart,
          rangeEnd,
        );
        return { offering, items };
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
  // committed pure core, never reimplemented inline here.
  return { eligible: true, items: mergeUnifiedInstructorScheduleSources(sources) };
}
