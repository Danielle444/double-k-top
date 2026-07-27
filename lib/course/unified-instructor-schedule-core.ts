/**
 * UNIFIED INSTRUCTOR SCHEDULE - SLICE IUS0: PURE decision core for the
 * instructor "הלו״ז המשולב שלי" combined view, merging an instructor's own
 * relevant schedule items across BOTH active course offerings into one
 * chronological list.
 *
 * PURE by construction: no Prisma, no DB, no clock, no randomness, no env, no
 * auth/session/cookie read. It only tags/merges/sorts already-fetched,
 * already-authorized item lists and computes cross-offering overlap/coverage
 * metadata - so the whole contract is unit-testable without a database (see
 * unified-instructor-schedule-core.test.ts).
 *
 * WHY A DEDICATED INSTRUCTOR CORE (NOT THE TRAINEE ONE)
 * -----------------------------------------------------
 * The trainee unified core (unified-trainee-schedule-core.ts) is DELIBERATELY
 * not reused here. Two of its rules are trainee-only and would be WRONG for an
 * instructor listing:
 *
 *  1. Placeholder exclusion. The trainee core drops the combined-participation
 *     Level 1-time placeholder. The instructor schedule has no such placeholder
 *     concept at all, so there is nothing to exclude - and importing the
 *     combined-participation core (whose own header says "instructor readers -
 *     never call this core at all") would be a category error.
 *
 *  2. Publication and coverage. The instructor reader intentionally shows
 *     UNPUBLISHED weeks/items (that is the deliberate divergence from the
 *     trainee published-only reader, and it MUST be preserved). But an
 *     unpublished Level 2 item is a draft; it must NEVER hide a Level 1 item,
 *     even when it fully covers it. So this core carries `isPublished` per item
 *     and hides a Level 1 item only under a SINGLE, PUBLISHED, fully-covering
 *     Level 2 item. The trainee core has no such publication gate.
 *
 * WHAT THIS OWNS
 * --------------
 *  - Tagging each already-mapped, already-authorized item with its source
 *    offering (id / label / level).
 *  - Cross-offering overlap metadata (a partial overlap keeps both items and
 *    marks both).
 *  - The full-coverage hide rule: a visible Level 1 item is dropped only when a
 *    SINGLE PUBLISHED Level 2 item, same date, fully covers its entire time
 *    range.
 *  - Merging + stable chronological sort of every offering's contribution.
 *
 * WHAT THIS DELIBERATELY DOES NOT OWN
 * ------------------------------------
 *  - Authorization, capability gating, the "mine"/"all" free-text name filter,
 *    the ScheduleItem read/mapping pipeline, or which offerings are eligible.
 *    A later orchestration slice (IUS1) fans out over the EXISTING, unchanged
 *    instructor readers once per offering - so every existing gate (identity,
 *    allow-listed offering, SCHEDULE capability, unpublished visibility) is
 *    reused verbatim and can never drift from the single-course path.
 */

/** The Level values the coverage-hide rule discriminates on. Local, not shared with the trainee core. */
const UNIFIED_INSTRUCTOR_LEVEL_1 = 1;
const UNIFIED_INSTRUCTOR_LEVEL_2 = 2;

/** The minimum number of eligible course offerings before the unified instructor view exists at all. */
export const UNIFIED_INSTRUCTOR_SCHEDULE_MINIMUM_ELIGIBLE_OFFERINGS = 2;

/**
 * Is this instructor eligible for the unified view at all? With fewer than two
 * addressable offerings there is nothing to unify and the subview must not be
 * offered - mirroring the trainee `dualEnrolled` cardinality, but computed from
 * the instructor's own addressable-offering count by the caller.
 */
export function isInstructorEligibleForUnifiedSchedule(eligibleOfferingCount: number): boolean {
  return eligibleOfferingCount >= UNIFIED_INSTRUCTOR_SCHEDULE_MINIMUM_ELIGIBLE_OFFERINGS;
}

/** The source-offering tag every unified item carries. Display-only, never re-authorizes anything. */
export interface UnifiedInstructorScheduleSourceTag {
  readonly sourceCourseOfferingId: string;
  readonly sourceCourseLabel: string;
  readonly sourceCourseLevel: number;
}

/**
 * The cross-offering overlap metadata every unified item carries.
 *
 * `overlappingSourceCourseOfferingIds` names WHICH other offering(s) an item's
 * time range genuinely intersects, distinct and sorted so the value is
 * deterministic regardless of scan order; empty when this item has no
 * cross-offering overlap. Display-only - it never hides, merges, or reorders
 * any item.
 */
export interface UnifiedInstructorScheduleOverlapTag {
  readonly overlappingSourceCourseOfferingIds: readonly string[];
}

/** The offering identity + label an already-authorized item list is tagged with. */
export interface UnifiedInstructorScheduleSourceOffering {
  readonly id: string;
  readonly label: string;
  readonly level: number;
}

/**
 * The minimal shape the overlap/coverage/sort steps below need from an item.
 * `isPublished` is carried so the coverage-hide rule can require the COVERING
 * Level 2 item to be published; overlap detection deliberately ignores it (an
 * unpublished item is still shown to the instructor and still marks overlaps).
 */
export interface UnifiedInstructorScheduleComparable {
  readonly dateKey: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly isPublished: boolean;
}

/** An item after source-tagging, before overlap metadata is computed. */
export type SourceTaggedUnifiedInstructorScheduleItem<T> = T & UnifiedInstructorScheduleSourceTag;

/** The full external contract: an already-authorized item, source-tagged AND overlap-tagged. */
export type UnifiedInstructorScheduleItemView<T> = T &
  UnifiedInstructorScheduleSourceTag &
  UnifiedInstructorScheduleOverlapTag;

/** Tags already-authorized items with their source offering, without dropping existing fields. */
export function tagUnifiedInstructorScheduleItems<T>(
  items: readonly T[],
  offering: UnifiedInstructorScheduleSourceOffering,
): SourceTaggedUnifiedInstructorScheduleItem<T>[] {
  return items.map((item) => ({
    ...item,
    sourceCourseOfferingId: offering.id,
    sourceCourseLabel: offering.label,
    sourceCourseLevel: offering.level,
  }));
}

/** Parses a "H:MM" / "HH:MM" (optionally with trailing text) time into minutes since midnight. */
function timeStringToMinutesOfDay(time: string): number {
  const match = time.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * The locked overlap rule: strict interval intersection, never touching
 * boundaries. `10:00-11:00` and `11:00-12:00` do NOT overlap (11:00 < 11:00 is
 * false); `10:00-11:00` and `10:30-11:30` DO.
 */
function timeRangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  const aStartMin = timeStringToMinutesOfDay(aStart);
  const aEndMin = timeStringToMinutesOfDay(aEnd);
  const bStartMin = timeStringToMinutesOfDay(bStart);
  const bEndMin = timeStringToMinutesOfDay(bEnd);
  return aStartMin < bEndMin && bStartMin < aEndMin;
}

/**
 * Computes `overlappingSourceCourseOfferingIds` for every item against every
 * OTHER item in the same already-tagged set.
 *
 * Locked rule, applied pairwise: same `dateKey`, DIFFERENT
 * `sourceCourseOfferingId`, and a strict time-range intersection
 * (`startA < endB && startB < endA`). Same-offering overlaps are never flagged
 * (that is a within-course data-quality concern, out of scope for this
 * cross-offering signal). Publication is deliberately ignored - an unpublished
 * item is still shown to the instructor and still participates in the overlap
 * warning. Never merges, hides, or reorders anything. Deterministic regardless
 * of input order: comparison is by object identity, and each item's own result
 * set is deduplicated and sorted before being returned.
 */
export function computeInstructorCrossCourseOverlaps<
  T extends UnifiedInstructorScheduleSourceTag & {
    readonly dateKey: string;
    readonly startTime: string;
    readonly endTime: string;
  },
>(items: readonly T[]): (T & UnifiedInstructorScheduleOverlapTag)[] {
  return items.map((item) => {
    const overlappingIds = new Set<string>();
    for (const other of items) {
      if (other === item) continue;
      if (other.sourceCourseOfferingId === item.sourceCourseOfferingId) continue;
      if (other.dateKey !== item.dateKey) continue;
      if (!timeRangesOverlap(item.startTime, item.endTime, other.startTime, other.endTime)) continue;
      overlappingIds.add(other.sourceCourseOfferingId);
    }
    return {
      ...item,
      overlappingSourceCourseOfferingIds: Array.from(overlappingIds).sort(),
    };
  });
}

/**
 * Is `item` (a Level 1 item) fully covered, on the SAME date, by `other` (a
 * PUBLISHED Level 2 item)?
 *
 * Two guards beyond coverage geometry:
 *  - `other` must be Level 2 (only a Level 2 item may ever hide a Level 1 item);
 *  - `other` must be PUBLISHED. This is the locked instructor rule: instructors
 *    intentionally see unpublished (draft) items, but a draft Level 2 item must
 *    never conceal a Level 1 item. An unpublished Level 2 item that fully covers
 *    a Level 1 item leaves both visible.
 *
 * Coverage, not overlap: `other.start <= item.start && other.end >= item.end`,
 * using `<=`/`>=` so an identical range counts as covering. Touching boundaries
 * can never satisfy this (the two inequalities cannot both hold from touching
 * alone).
 */
function isFullyCoveredByPublishedLevel2Item(
  item: { readonly dateKey: string; readonly startTime: string; readonly endTime: string },
  other: {
    readonly sourceCourseLevel: number;
    readonly isPublished: boolean;
    readonly dateKey: string;
    readonly startTime: string;
    readonly endTime: string;
  },
): boolean {
  if (other.sourceCourseLevel !== UNIFIED_INSTRUCTOR_LEVEL_2) return false;
  if (!other.isPublished) return false;
  if (other.dateKey !== item.dateKey) return false;
  return (
    timeStringToMinutesOfDay(other.startTime) <= timeStringToMinutesOfDay(item.startTime) &&
    timeStringToMinutesOfDay(other.endTime) >= timeStringToMinutesOfDay(item.endTime)
  );
}

/**
 * The locked full-coverage hide rule: a visible Level 1 item is dropped only
 * when a SINGLE other item already in this same already-tagged set is a
 * PUBLISHED Level 2 item, same date, that fully covers its entire time range
 * (see {@link isFullyCoveredByPublishedLevel2Item}).
 *
 *  - Only a PUBLISHED Level 2 item may hide. An unpublished Level 2 item never
 *    hides, even with identical/covering times.
 *  - Level 2 items are never removed by this function, in either direction - a
 *    Level 1 item that fully covers a Level 2 item leaves both untouched.
 *  - Multiple Level 2 items never combine into synthetic coverage: each
 *    candidate `other` is checked independently against the FULL Level 1 range,
 *    so two adjacent Level 2 items that only jointly span a Level 1 item do not
 *    hide it - neither one alone covers the full range.
 *  - Only items already present in `items` can cover anything: a denied or
 *    unauthorized offering contributes no items upstream, so it can never
 *    suppress a Level 1 item here.
 *  - A partially-overlapping (not fully covered) pair is left completely
 *    untouched - both items pass through, and their mutual overlap metadata is
 *    computed unchanged by {@link computeInstructorCrossCourseOverlaps}
 *    afterward.
 */
export function hideLevel1ItemsFullyCoveredByPublishedLevel2<
  T extends UnifiedInstructorScheduleSourceTag & {
    readonly dateKey: string;
    readonly startTime: string;
    readonly endTime: string;
    readonly isPublished: boolean;
  },
>(items: readonly T[]): T[] {
  return items.filter((item) => {
    if (item.sourceCourseLevel !== UNIFIED_INSTRUCTOR_LEVEL_1) return true;
    return !items.some((other) => other !== item && isFullyCoveredByPublishedLevel2Item(item, other));
  });
}

// ---------------------------------------------------------------------------
// IUS-2: selected-range -> per-offering week resolution
//
// Each offering owns its OWN WeeklySchedule rows, so the unified week picker's
// merged entry (which keeps exactly ONE real id per date range - see
// unified-instructor-week-options-core) cannot address the other offering's
// week. These two helpers close that gap WITHOUT inventing an id: the caller
// re-reads each offering's own week list and asks which of ITS real weeks
// intersect the selected range.
// ---------------------------------------------------------------------------

/** The minimum an already-fetched week option needs for the range match below. */
export interface UnifiedInstructorWeekRange {
  readonly id: string;
  readonly startDate: string;
  readonly endDate: string;
}

/**
 * Which of ONE offering's own already-fetched (already authorized,
 * capability-gated) weeks intersect the selected inclusive range.
 *
 * OVERLAP, DELIBERATELY NOT EXACT-RANGE EQUALITY. Level 1 and Level 2 weeks are
 * separate rows and are not guaranteed to share identical start/end dates (one
 * course may run Sun-Thu while the other runs Sun-Fri). Matching on equality
 * would silently contribute ZERO items for a whole offering whenever its week
 * boundaries differ by even a day - the exact failure this view exists to
 * prevent. Overlap is inclusive on BOTH ends: a week that shares only its last
 * day with the range still matches, because that day's items are genuinely
 * inside the selected range.
 *
 * Returns EVERY match, not just the first: a selected range can legitimately
 * straddle two of an offering's weeks, and dropping the second would hide real
 * items. Order is total and input-order-independent (startDate, then endDate,
 * then the real id as a unique tie-break), so the fan-out below is
 * deterministic. Only real WeeklySchedule ids are ever returned - this function
 * never synthesizes one - and neither the input array nor its items are
 * mutated (`filter` already allocates, so the `sort` is on a fresh array).
 */
export function findUnifiedInstructorWeeksForRange<T extends UnifiedInstructorWeekRange>(
  weeks: readonly T[],
  rangeStart: string,
  rangeEnd: string,
): T[] {
  return weeks
    .filter((week) => week.startDate <= rangeEnd && rangeStart <= week.endDate)
    .sort(
      (a, b) =>
        a.startDate.localeCompare(b.startDate) ||
        a.endDate.localeCompare(b.endDate) ||
        a.id.localeCompare(b.id),
    );
}

/**
 * Narrow an offering's contributed items to the selected inclusive range.
 *
 * Required because {@link findUnifiedInstructorWeeksForRange} matches a week
 * that merely OVERLAPS the range: such a week legitimately carries items on
 * days outside it, and those must not leak into the merged list. Inclusive on
 * both ends, order preserved exactly as received (the merge sorts later, once,
 * over the whole set), no mutation.
 */
export function filterUnifiedInstructorItemsToRange<T extends { readonly dateKey: string }>(
  items: readonly T[],
  rangeStart: string,
  rangeEnd: string,
): T[] {
  return items.filter((item) => rangeStart <= item.dateKey && item.dateKey <= rangeEnd);
}

/** Stable chronological sort - by dateKey, then startTime, then endTime. */
export function sortUnifiedInstructorScheduleItems<
  T extends { dateKey: string; startTime: string; endTime: string },
>(items: readonly T[]): T[] {
  return [...items].sort(
    (a, b) =>
      a.dateKey.localeCompare(b.dateKey) ||
      a.startTime.localeCompare(b.startTime) ||
      a.endTime.localeCompare(b.endTime),
  );
}

/** One eligible offering's own already-authorized, already-mapped item list. */
export interface UnifiedInstructorScheduleSource<T extends UnifiedInstructorScheduleComparable> {
  readonly offering: UnifiedInstructorScheduleSourceOffering;
  readonly items: readonly T[];
}

/**
 * Merge every eligible offering's contribution into one chronological,
 * source-tagged, coverage-filtered, overlap-tagged unified list.
 *
 * Order is deliberate:
 *  1. every item across every source is tagged with its source offering (the
 *    instructor path has no placeholder to exclude first);
 *  2. a Level 1 item FULLY covered by a single PUBLISHED Level 2 item is
 *    dropped - this runs over the FULL merged, tagged set (a Level 1 item can
 *    only be covered by a Level 2 item from a DIFFERENT offering, knowable only
 *    once every source is combined) and BEFORE overlap is computed, so a hidden
 *    item can never contribute stale overlap metadata to its survivors;
 *  3. cross-offering overlap is computed over the SURVIVING set only;
 *  4. the result is sorted together as one set - never per-source then
 *    concatenated, which would only interleave correctly by coincidence.
 *
 * Input arrays and item objects are never mutated.
 */
export function mergeUnifiedInstructorScheduleSources<
  T extends UnifiedInstructorScheduleComparable,
>(sources: readonly UnifiedInstructorScheduleSource<T>[]): UnifiedInstructorScheduleItemView<T>[] {
  const tagged = sources.flatMap(({ offering, items }) =>
    tagUnifiedInstructorScheduleItems(items, offering),
  );
  const visible = hideLevel1ItemsFullyCoveredByPublishedLevel2(tagged);
  const withOverlaps = computeInstructorCrossCourseOverlaps(visible);
  return sortUnifiedInstructorScheduleItems(withOverlaps);
}
