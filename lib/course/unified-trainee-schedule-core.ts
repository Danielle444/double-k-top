/**
 * UNIFIED TRAINEE SCHEDULE - SLICE U0: PURE decision core for "הלו״ז שלי", the
 * combined chronological view across a dual-enrolled trainee's own eligible
 * course offerings.
 *
 * PURE by construction: no Prisma, no DB, no clock, no randomness, no env, no
 * auth/session/cookie read. It only decides eligibility, matches a day key
 * against already-fetched week ranges, and tags/merges/sorts already-fetched,
 * already-authorized item lists - so the whole contract is unit-testable
 * without a database (see unified-trainee-schedule-core.test.ts).
 *
 * WHAT THIS OWNS
 * --------------
 *  - The eligibility gate for the unified view itself: a trainee needs 2+
 *    eligible course offerings (the SAME definition StudentClient.tsx already
 *    uses for `dualEnrolled`, computed from the SAME listTraineeCourseOptions()
 *    result) or there is nothing to unify and the view must not be offered at
 *    all - single- and zero-course trainees alike.
 *  - Which published week (of an offering's own already-fetched week list)
 *    covers one specific calendar day.
 *  - The group filter each offering's own real-item read should use: "both"
 *    for a Level 2 offering (the existing launch-hotfix default - a Level 2
 *    trainee's Student.group compatibility fields still describe Level 1),
 *    "mine" for every other level (the unchanged Level 1 default).
 *  - Tagging each already-mapped item with its source offering, excluding the
 *    neutral Level 1-time placeholder, hiding a Level 1 item fully covered by
 *    a single visible Level 2 item (a partial overlap keeps both items and
 *    their mutual overlap metadata), and merging + chronologically sorting
 *    every eligible offering's contribution for the day into one list.
 *
 * WHAT THIS DELIBERATELY DOES NOT OWN
 * ------------------------------------
 *  - Authorization, capability gating, or the ScheduleItem read/mapping
 *    pipeline itself. The orchestration in
 *    lib/actions/unified-trainee-schedule.ts calls the EXISTING, unchanged,
 *    already-tested getWeeklyScheduleSelectionForTrainee and
 *    getScheduleForStudent (lib/actions/weekly-schedule.ts,
 *    lib/actions/student-schedule.ts) once per eligible offering - so every
 *    existing security/visibility rule (SCHEDULE capability gate,
 *    week-ownership re-check, publication gate, combined-participation hide
 *    rule, riding-info visibility, complex-plan suppression) is reused
 *    verbatim. This core never reimplements any of that, and can therefore
 *    never drift from the single-course path.
 */
import { COMBINED_PARTICIPATION_HIDDEN_LEVEL } from "./combined-participation-visibility-core";

/** The minimum number of eligible course offerings before "הלו״ז שלי" exists at all. */
export const UNIFIED_SCHEDULE_MINIMUM_ELIGIBLE_OFFERINGS = 2;

/**
 * Is this trainee eligible for the unified view at all? Single-course (or
 * zero-course) trainees have nothing to unify - this is the SAME cardinality
 * StudentClient.tsx already computes as `dualEnrolled`, from the SAME
 * listTraineeCourseOptions() result, so the two can never drift apart.
 */
export function isTraineeEligibleForUnifiedSchedule(eligibleOfferingCount: number): boolean {
  return eligibleOfferingCount >= UNIFIED_SCHEDULE_MINIMUM_ELIGIBLE_OFFERINGS;
}

/**
 * The group filter to request for one offering's own real-item read.
 *
 * Level 2's "both" default is the existing launch-hotfix accommodation (a
 * Level 2 trainee's Student.group compatibility fields still describe Level
 * 1 - see ScheduleSection.tsx's own viewingLevel2 handling); every other
 * level keeps the ordinary "mine" default. This is DATA, not a new rule - it
 * mirrors exactly what ScheduleSection already defaults to per course, reusing
 * the same COMBINED_PARTICIPATION_HIDDEN_LEVEL constant rather than a second,
 * drifting "2" literal.
 */
export function unifiedScheduleGroupFilterForOfferingLevel(level: number): "mine" | "both" {
  return level === COMBINED_PARTICIPATION_HIDDEN_LEVEL ? "both" : "mine";
}

/** The minimum an already-fetched week option needs for the day-range match below. */
export interface UnifiedScheduleWeekRange {
  readonly id: string;
  readonly startDate: string;
  readonly endDate: string;
}

/**
 * Which of an offering's own already-fetched (published, capability-gated)
 * weeks covers this exact calendar day, if any. Returns null when none does -
 * that offering simply contributes nothing for this day (no week uploaded
 * yet, or the trainee's SCHEDULE capability for that offering isn't enabled -
 * both already collapse to an empty/non-matching week list upstream,
 * indistinguishably, exactly as every other trainee schedule denial does).
 */
export function findUnifiedScheduleWeekForDay<T extends UnifiedScheduleWeekRange>(
  weeks: readonly T[],
  dayKey: string,
): T | null {
  return weeks.find((w) => w.startDate <= dayKey && dayKey <= w.endDate) ?? null;
}

/** The source-offering tag every unified item carries. Display-only, never re-authorizes anything. */
export interface UnifiedScheduleSourceTag {
  readonly sourceCourseOfferingId: string;
  readonly sourceCourseLabel: string;
  readonly sourceCourseLevel: number;
}

/**
 * The cross-course overlap metadata every unified item carries.
 *
 * `overlappingSourceCourseOfferingIds` (over a bare `hasCrossCourseOverlap`
 * boolean) is the chosen shape: it names WHICH other offering(s) an item's
 * time range genuinely intersects, not just whether one exists. A later
 * slice's overlap indicator (U3) needs to say "overlaps with your Level 2
 * session", which a boolean alone cannot express without a second lookup, and
 * the richer shape still trivially degrades to a boolean via `.length > 0`
 * wherever only that is needed. Distinct and sorted so the value is
 * deterministic regardless of scan order or how many overlapping items came
 * from the same other offering; empty when this item has no cross-course
 * overlap. Display-only - it never hides, merges, or reorders any item.
 */
export interface UnifiedScheduleOverlapTag {
  readonly overlappingSourceCourseOfferingIds: readonly string[];
}

/** The offering identity + label an already-authorized item list is tagged with. */
export interface UnifiedScheduleSourceOffering {
  readonly id: string;
  readonly label: string;
  readonly level: number;
}

/** The minimal shape the merge/sort/placeholder-exclusion below needs from an item. */
export interface UnifiedScheduleMergeableItem {
  readonly dateKey: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly isCombinedParticipationPlaceholder: boolean;
}

/** An item after source-tagging, before overlap metadata is computed. */
export type SourceTaggedUnifiedScheduleItem<T> = T & UnifiedScheduleSourceTag;

/** The full external contract: an already-authorized item, source-tagged AND overlap-tagged. */
export type UnifiedScheduleItemView<T> = T & UnifiedScheduleSourceTag & UnifiedScheduleOverlapTag;

/**
 * Real items only. The neutral Level 1-time placeholder
 * (isCombinedParticipationPlaceholder === true) exists so the LEVEL 2 tab,
 * viewed alone, still shows something in a hidden-item gap; in the unified
 * view the real Level 1 item it points at is already shown directly in the
 * very same list, so the placeholder would be redundant, confusing noise. It
 * is unconditionally filtered out here - the unified reader never returns one.
 */
export function excludeUnifiedSchedulePlaceholders<T extends { isCombinedParticipationPlaceholder: boolean }>(
  items: readonly T[],
): T[] {
  return items.filter((item) => !item.isCombinedParticipationPlaceholder);
}

/** Tags already-real items (callers exclude placeholders first) with their source offering. */
export function tagUnifiedScheduleItems<T>(
  items: readonly T[],
  offering: UnifiedScheduleSourceOffering,
): SourceTaggedUnifiedScheduleItem<T>[] {
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

/** The minimal shape the overlap computation below needs, beyond the source tag. */
export interface UnifiedScheduleOverlapComparable {
  readonly dateKey: string;
  readonly startTime: string;
  readonly endTime: string;
}

/**
 * Computes `overlappingSourceCourseOfferingIds` for every item against every
 * OTHER item in the same already-tagged set.
 *
 * Locked rule, applied pairwise: same `dateKey`, DIFFERENT
 * `sourceCourseOfferingId`, and a strict time-range intersection
 * (`startA < endB && startB < endA`). Same-offering overlaps are never
 * flagged here (that is a within-course data-quality concern
 * ScheduleTimeGrid already renders separately - see its own
 * groupOverlappingByColumn - and is out of scope for this cross-course
 * signal). Never merges, hides, or reorders anything - purely additive
 * metadata. Deterministic regardless of input order: comparison is by object
 * identity (never array position), and each item's own result set is
 * deduplicated and sorted before being returned.
 */
export function computeCrossCourseOverlaps<
  T extends UnifiedScheduleSourceTag & UnifiedScheduleOverlapComparable,
>(items: readonly T[]): (T & UnifiedScheduleOverlapTag)[] {
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
 * Level 2 item)? Coverage, not overlap: `other.start <= item.start &&
 * other.end >= item.end`. Deliberately does NOT reuse {@link timeRangesOverlap}
 * - that predicate answers "do these ranges intersect at all", which a
 * partial overlap also satisfies; this one answers the strictly narrower
 * "does the other range fully contain this one", using `<=`/`>=` so an
 * identical range counts as covering. Touching boundaries can never satisfy
 * this (a range that only touches item's start or end cannot also reach past
 * the other end while starting after/ending before this one - the two
 * inequalities cannot both hold from touching alone).
 */
function isFullyCoveredByLevel2Item(
  item: { readonly dateKey: string; readonly startTime: string; readonly endTime: string },
  other: {
    readonly sourceCourseLevel: number;
    readonly dateKey: string;
    readonly startTime: string;
    readonly endTime: string;
  },
): boolean {
  if (other.sourceCourseLevel !== COMBINED_PARTICIPATION_HIDDEN_LEVEL) return false;
  if (other.dateKey !== item.dateKey) return false;
  return (
    timeStringToMinutesOfDay(other.startTime) <= timeStringToMinutesOfDay(item.startTime) &&
    timeStringToMinutesOfDay(other.endTime) >= timeStringToMinutesOfDay(item.endTime)
  );
}

/**
 * The locked full-coverage hide rule: a visible Level 1 item is dropped from
 * the unified view only when a SINGLE other item already in this same
 * already-tagged set is Level 2, same date, and fully covers its entire time
 * range (see {@link isFullyCoveredByLevel2Item}). Level 2 items are never
 * removed by this function, in either direction - a Level 1 item that fully
 * covers a Level 2 item leaves both untouched, since the rule only ever hides
 * Level 1.
 *
 * Multiple Level 2 items are never combined into synthetic coverage: each
 * candidate `other` is checked independently against the FULL Level 1 range,
 * so two adjacent Level 2 items that only jointly span a Level 1 item (e.g.
 * 09:00-10:00 and 10:00-11:00 against a 09:00-11:00 Level 1 item) do not hide
 * it - neither one alone covers the full range.
 *
 * Only items already present in `items` can cover anything: a denied,
 * unpublished, or placeholder-excluded Level 2 item never reaches this
 * function's input in the first place (placeholders are dropped, and
 * unauthorized offerings contribute no items, upstream in
 * {@link mergeUnifiedScheduleSources}), so it can never suppress a Level 1
 * item here.
 *
 * A partially-overlapping (not fully covered) Level 1/Level 2 pair is left
 * completely untouched by this function - both items pass through, and their
 * mutual overlap metadata is computed unchanged by
 * {@link computeCrossCourseOverlaps} afterward.
 */
export function hideLevel1ItemsFullyCoveredByLevel2<
  T extends UnifiedScheduleSourceTag & UnifiedScheduleOverlapComparable,
>(items: readonly T[]): T[] {
  return items.filter((item) => {
    if (item.sourceCourseLevel !== 1) return true;
    return !items.some((other) => other !== item && isFullyCoveredByLevel2Item(item, other));
  });
}

/** Chronological sort - the same comparator every other trainee schedule view already uses. */
export function sortUnifiedScheduleItems<T extends { dateKey: string; startTime: string; endTime: string }>(
  items: readonly T[],
): T[] {
  return [...items].sort(
    (a, b) =>
      a.dateKey.localeCompare(b.dateKey) ||
      a.startTime.localeCompare(b.startTime) ||
      a.endTime.localeCompare(b.endTime),
  );
}

/** One eligible offering's own already-authorized, already-mapped real+placeholder item list. */
export interface UnifiedScheduleSource<T extends UnifiedScheduleMergeableItem> {
  readonly offering: UnifiedScheduleSourceOffering;
  readonly items: readonly T[];
}

/**
 * Merge every eligible offering's contribution for one day into one
 * chronological, placeholder-free, source-tagged, coverage-filtered,
 * overlap-tagged unified list.
 *
 * Order is deliberate:
 *  1. placeholders are excluded from EACH source BEFORE tagging (so a
 *     placeholder can never carry a misleading source label or participate
 *     in overlap/coverage detection);
 *  2. every remaining real item across every source is tagged with its
 *     source offering;
 *  3. a Level 1 item FULLY covered by a single visible Level 2 item is
 *     dropped (hideLevel1ItemsFullyCoveredByLevel2) - this must run over the
 *     FULL merged, tagged set (a Level 1 item can only be covered by a Level
 *     2 item from a DIFFERENT offering, which is only knowable once every
 *     source's items are tagged and combined) and BEFORE overlap is computed,
 *     so a hidden item can never contribute stale overlap metadata to its
 *     survivors;
 *  4. cross-course overlap is computed over the SURVIVING set only - a
 *     partially-overlapping pair that both survive keeps its full mutual
 *     overlap metadata unchanged, while a fully-covered Level 1 item's own
 *     removal means the covering Level 2 item's overlap list no longer names
 *     it;
 *  5. the result is sorted together as one set - never sorted within a
 *     source first and concatenated afterward, which would only interleave
 *     correctly by coincidence.
 */
export function mergeUnifiedScheduleSources<
  T extends UnifiedScheduleMergeableItem & UnifiedScheduleOverlapComparable,
>(sources: readonly UnifiedScheduleSource<T>[]): UnifiedScheduleItemView<T>[] {
  const tagged = sources.flatMap(({ offering, items }) =>
    tagUnifiedScheduleItems(excludeUnifiedSchedulePlaceholders(items), offering),
  );
  const visible = hideLevel1ItemsFullyCoveredByLevel2(tagged);
  const withOverlaps = computeCrossCourseOverlaps(visible);
  return sortUnifiedScheduleItems(withOverlaps);
}
