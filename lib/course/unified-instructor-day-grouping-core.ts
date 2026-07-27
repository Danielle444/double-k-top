/**
 * UNIFIED INSTRUCTOR SCHEDULE - SLICE IUS-2D: PURE day/offering grouping core
 * for the instructor "הלו״ז המשולב שלי" combined view.
 *
 * PURE by construction: no React, no Prisma/DB, no clock, no randomness, no env,
 * no server-action import, no auth/session read. It only regroups an
 * already-merged, already-authorized, already-ordered unified item list into the
 * day -> source-offering blocks the presentation layer renders - so the whole
 * contract is unit-testable without a database (see
 * unified-instructor-day-grouping-core.test.ts).
 *
 * WHY THE PER-OFFERING SPLIT EXISTS
 * ---------------------------------
 * The unified view renders each block through the EXISTING ScheduleTimeGrid, so
 * Level 1 keeps its real timetable layout: simultaneous group א / group ב
 * activities sit SIDE BY SIDE in two columns, and a "שתי הקבוצות" block spans
 * both - exactly as the per-course view already shows them. A flat stacked list
 * cannot express that.
 *
 * But ScheduleTimeGrid (and the lib/schedule-grouping helpers beneath it) group,
 * pair, span and COALESCE items purely by groupName / cleaned title / adjacent
 * times. They have NO offering awareness whatsoever. Handing one grid items from
 * two different CourseOfferings would therefore let it:
 *
 *  - merge a Level 1 item with a Level 2 item into one synthetic "שתי הקבוצות"
 *    card (same time, same cleaned title, opposite groups), or coalesce two
 *    contiguous same-title items across offerings into one longer card;
 *  - and, because the merge helpers build the survivor with `{...a}`, keep only
 *    the FIRST item's `sourceCourseOfferingId`, `sourceCourseLabel`,
 *    `sourceCourseLevel`, `combinedParticipation` and
 *    `overlappingSourceCourseOfferingIds` - silently attributing one course's
 *    session, source badge, Level 2 "משולב" badge and overlap badge to the other
 *    course.
 *
 * That is a fabricated card carrying the WRONG course identity, which is exactly
 * what this view exists to make unambiguous. So the rule is structural, not
 * stylistic: ONE GRID NEVER RECEIVES MORE THAN ONE OFFERING'S ITEMS. This core
 * enforces that split, and the grid itself stays completely untouched.
 *
 * WHAT THIS DELIBERATELY DOES NOT OWN
 * -----------------------------------
 * Authorization, capability gating, eligibility, the union across offerings, the
 * coverage-hide rule, overlap metadata and the chronological ordering all belong
 * to the committed reader + merge core (unified-instructor-schedule-core). This
 * core adds no item, drops no item, changes no field and re-sorts nothing within
 * a block: item order inside every block is preserved EXACTLY as received.
 */

/** The minimum an item needs to be grouped by day and by source offering. */
export interface UnifiedInstructorGroupableItem {
  readonly dateKey: string;
  readonly dayLabel: string;
  readonly dateLabel: string;
  readonly startTime: string;
  readonly sourceCourseOfferingId: string;
  readonly sourceCourseLabel: string;
  readonly sourceCourseLevel: number;
}

/**
 * One contributing CourseOffering's items within ONE day - the exact unit that
 * is handed to a single ScheduleTimeGrid.
 */
export interface UnifiedInstructorDayBlock<T> {
  readonly sourceCourseOfferingId: string;
  readonly sourceCourseLabel: string;
  readonly sourceCourseLevel: number;
  readonly items: readonly T[];
}

/** One day of the unified list, split into its contributing offerings. */
export interface UnifiedInstructorScheduleDay<T> {
  readonly dateKey: string;
  readonly dayLabel: string;
  readonly dateLabel: string;
  readonly blocks: readonly UnifiedInstructorDayBlock<T>[];
}

/**
 * The time comparator. Deliberately `localeCompare` on the raw "HH:MM" string -
 * byte-for-byte the comparator `sortUnifiedInstructorScheduleItems` in
 * unified-instructor-schedule-core already uses to order these very items. Using
 * a different (e.g. minute-parsing) comparison here could order the BLOCKS
 * differently from the ITEMS inside them, which would look like a bug on screen.
 */
function compareTimeStrings(a: string, b: string): number {
  return a.localeCompare(b);
}

/** The earliest startTime in a block, computed over ALL its items so input order cannot change it. */
function earliestStartTime<T extends { readonly startTime: string }>(items: readonly T[]): string {
  return items.reduce(
    (earliest, item) => (compareTimeStrings(item.startTime, earliest) < 0 ? item.startTime : earliest),
    items[0].startTime,
  );
}

/**
 * Regroup one already-merged unified instructor item list into days, and each
 * day into one block per contributing CourseOffering.
 *
 * Rules (all locked by unified-instructor-day-grouping-core.test.ts):
 *
 *  - Days are grouped by `dateKey` and sorted ASCENDING by it (ISO `YYYY-MM-DD`,
 *    so lexicographic order is chronological order). A day's `dayLabel` /
 *    `dateLabel` come from its own items - never recomputed from a clock.
 *  - Inside a day, items are grouped by `sourceCourseOfferingId`: exactly one
 *    block per offering that actually contributes an item to that day, so no
 *    empty day and no empty block can ever be produced.
 *  - A block's `sourceCourseLabel` / `sourceCourseLevel` come from that block's
 *    OWN items, so a label can never be attached to the wrong offering.
 *  - Blocks are ordered by (earliest startTime, sourceCourseLevel,
 *    sourceCourseOfferingId). The two tie-breaks make the order total, so the
 *    output is deterministic under any input reordering.
 *  - Item order INSIDE a block is preserved verbatim - the merge core already
 *    ordered them, and re-sorting here could only disagree with it.
 *
 * Neither the input array nor any input item object is mutated (every array is
 * freshly allocated; item objects are passed through by reference, unchanged and
 * unfrozen). The returned days, blocks and block item arrays are frozen, matching
 * the read-only convention of the surrounding course cores.
 */
export function groupUnifiedInstructorItemsByDayAndOffering<T extends UnifiedInstructorGroupableItem>(
  items: readonly T[],
): readonly UnifiedInstructorScheduleDay<T>[] {
  const byDay = new Map<string, T[]>();
  for (const item of items) {
    const bucket = byDay.get(item.dateKey);
    if (bucket) bucket.push(item);
    else byDay.set(item.dateKey, [item]);
  }

  const days = Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dateKey, dayItems]) => {
      const byOffering = new Map<string, T[]>();
      for (const item of dayItems) {
        const bucket = byOffering.get(item.sourceCourseOfferingId);
        if (bucket) bucket.push(item);
        else byOffering.set(item.sourceCourseOfferingId, [item]);
      }

      const blocks = Array.from(byOffering.values())
        .map((blockItems): UnifiedInstructorDayBlock<T> => {
          const first = blockItems[0];
          return Object.freeze({
            sourceCourseOfferingId: first.sourceCourseOfferingId,
            sourceCourseLabel: first.sourceCourseLabel,
            sourceCourseLevel: first.sourceCourseLevel,
            items: Object.freeze(blockItems) as readonly T[],
          });
        })
        .sort(
          (a, b) =>
            compareTimeStrings(earliestStartTime(a.items), earliestStartTime(b.items)) ||
            a.sourceCourseLevel - b.sourceCourseLevel ||
            a.sourceCourseOfferingId.localeCompare(b.sourceCourseOfferingId),
        );

      return Object.freeze({
        dateKey,
        dayLabel: dayItems[0].dayLabel,
        dateLabel: dayItems[0].dateLabel,
        blocks: Object.freeze(blocks) as readonly UnifiedInstructorDayBlock<T>[],
      });
    });

  return Object.freeze(days);
}
