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

// ---------------------------------------------------------------------------
// IUS-3A - CHRONOLOGICAL SEGMENTS
//
// Added ALONGSIDE the day/offering core above, which stays exported and wired
// exactly as today: this slice is pure core only and changes no UI and no
// runtime behaviour. A later slice moves the view over and removes the old
// function.
//
// THE BUG THIS EXISTS TO FIX
// --------------------------
// The core above buckets a WHOLE DAY into at most one block per offering, so an
// offering's 08:00 item and its 14:00 item are forced into one contiguous
// vertical block and the other offering can only be rendered entirely before or
// entirely after both. A day of L1 08:00, L2 10:00, L2 12:00, L1 14:00
// therefore renders 08:00, 14:00, 10:00, 12:00. The merged list handed in is
// already in correct global order (mergeUnifiedInstructorScheduleSources sorts
// it once, globally) - the order is destroyed by the BUCKET GRANULARITY, not by
// any comparator. Sorting the blocks differently cannot fix it: with k
// offerings there are only k block positions, while an interleaved day needs
// one position per alternation.
//
// The fix is to let ONE OFFERING CONTRIBUTE SEVERAL BLOCKS PER DAY, split at
// chronological segment boundaries. The safety invariant is unchanged and in
// fact stronger: one ScheduleTimeGrid still receives at most one offering's
// items, and now at most one segment's as well. No mixed-offering grid is ever
// produced by this core.
//
// WHY THE CONNECTIVITY RULE LOOKS THE WAY IT DOES
// -----------------------------------------------
// Two items are in the same segment when they STRICTLY OVERLAP in time (any
// offering), OR when they belong to the SAME offering and TOUCH.
//
//  - Strict overlap makes every segment's union a contiguous interval and makes
//    two different segments' unions non-overlapping, so segments carry a TOTAL
//    chronological order and reading them top to bottom is monotone.
//  - Because any two SIMULTANEOUS items are therefore always in the same
//    segment, group א and group ב items at the same time can never be split
//    across two grids: ScheduleTimeGrid's side-by-side columns and its
//    "שתי הקבוצות" merge stay structurally safe.
//  - Same-offering TOUCHING must connect because coalesceAdjacentSameActivity
//    (lib/schedule-grouping) merges same-group same-title items on
//    `prev.endTime === next.startTime`. Splitting such a run across two grids
//    would render ONE activity as two half-cards.
//  - Cross-offering touching deliberately does NOT connect - that boundary is
//    exactly the split this slice exists to produce (L1 ends 09:00, L2 starts
//    09:00 renders as two adjacent segments with a zero-length gap, which is
//    the true relationship).
//
// WHAT THIS CANNOT DO
// -------------------
// Items that genuinely overlap cannot be linearized in a stacked layout by any
// model. A Level 1 item spanning 08:00-14:00 and a Level 2 item at 10:00-11:00
// stay in ONE segment, stacked, exactly as they render today; the existing
// cross-offering overlap metadata (computed upstream by the merge core) is what
// communicates that, not this core.
// ---------------------------------------------------------------------------

/**
 * What the segment core needs on top of {@link UnifiedInstructorGroupableItem}:
 * the item's own end, because segmentation is an INTERVAL model rather than a
 * start-time model. Deliberately a separate, extending interface rather than a
 * new required field on the existing one, so the currently-wired
 * {@link groupUnifiedInstructorItemsByDayAndOffering} keeps its contract
 * byte-for-byte.
 */
export interface UnifiedInstructorSegmentableItem extends UnifiedInstructorGroupableItem {
  readonly endTime: string;
}

/**
 * One contributing CourseOffering's items within ONE chronological segment of
 * ONE day - the exact unit handed to a single ScheduleTimeGrid.
 *
 * `key` exists because an offering may now appear MANY times in one day, so
 * `sourceCourseOfferingId` alone is no longer a unique React key.
 */
export interface UnifiedInstructorSegmentBlock<T> {
  readonly key: string;
  readonly sourceCourseOfferingId: string;
  readonly sourceCourseLabel: string;
  readonly sourceCourseLevel: number;
  readonly items: readonly T[];
}

/**
 * The entirely empty stretch between two consecutive segments of one day.
 *
 * NOT a schedule item, and never shaped like one: it carries no title, no
 * location, no instructor and no course, and can never be fed back into the
 * item pipeline. Times are the surrounding items' OWN HH:mm strings, so nothing
 * is reformatted, invented or timezone-converted.
 *
 * `realDurationMinutes` is >= 0. Zero means the two segments TOUCH exactly
 * (a cross-offering hand-over) - real adjacency, which the renderer should show
 * as adjacency and never as a break.
 */
export interface UnifiedInstructorScheduleGap {
  readonly realStartTime: string;
  readonly realEndTime: string;
  readonly realDurationMinutes: number;
}

/** One chronological segment of a day, split into its contributing offerings. */
export interface UnifiedInstructorScheduleSegment<T> {
  readonly key: string;
  readonly startTime: string;
  readonly endTime: string;
  /** null for a day's FIRST segment - a day boundary is never a gap. */
  readonly gapBefore: UnifiedInstructorScheduleGap | null;
  readonly blocks: readonly UnifiedInstructorSegmentBlock<T>[];
}

/** One day of the unified list, split into chronological segments. */
export interface UnifiedInstructorSegmentedScheduleDay<T> {
  readonly dateKey: string;
  readonly dayLabel: string;
  readonly dateLabel: string;
  /**
   * Whether this DAY has more than one contributing offering. The source-course
   * heading rule is day-level on purpose: judging it per segment would hide the
   * label on every single-offering segment of an alternating day, which is
   * exactly where the reader most needs it.
   */
  readonly hasMultipleOfferings: boolean;
  readonly segments: readonly UnifiedInstructorScheduleSegment<T>[];
}

/**
 * Minutes since midnight for a "H:MM" / "HH:MM" (optionally with trailing text)
 * time. Byte-for-byte the tolerance the surrounding schedule modules already
 * have (lib/schedule-timegrid.ts, unified-instructor-schedule-core.ts): an
 * unparseable time degrades to 0 rather than throwing, so bad data can never
 * crash a schedule screen.
 */
function timeStringToMinutes(time: string): number {
  const match = time.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * One item reduced to the interval the sweep works on.
 *
 * `index` is the item's position in the INPUT array, kept so a block can restore
 * verbatim input order after the sweep has sorted by time.
 *
 * An inverted item (endTime before startTime - only reachable with bad data) is
 * clamped to zero length. Clamping here rather than anywhere else means a
 * segment can never end before it starts and a gap can never come out negative.
 * `endLabel` follows the clamp so the emitted string never contradicts the
 * minutes it stands for.
 */
interface UnifiedInstructorSegmentEntry<T> {
  readonly item: T;
  readonly index: number;
  readonly startMinutes: number;
  readonly endMinutes: number;
  readonly endLabel: string;
}

function toSegmentEntry<T extends UnifiedInstructorSegmentableItem>(
  item: T,
  index: number,
): UnifiedInstructorSegmentEntry<T> {
  const startMinutes = timeStringToMinutes(item.startTime);
  const rawEndMinutes = timeStringToMinutes(item.endTime);
  const inverted = rawEndMinutes < startMinutes;
  return {
    item,
    index,
    startMinutes,
    endMinutes: inverted ? startMinutes : rawEndMinutes,
    endLabel: inverted ? item.startTime : item.endTime,
  };
}

/**
 * The sweep: one day's entries -> its chronological segments.
 *
 * Entries are ordered by (startMinutes, endMinutes, sourceCourseOfferingId,
 * input index) - a TOTAL order, so the result cannot depend on input order.
 * An entry joins the open segment when either
 *
 *   startMinutes < segmentEnd                       (strict overlap: the segment's
 *                                                    union is contiguous, so this
 *                                                    is a real overlap with one of
 *                                                    its items), or
 *   startMinutes === this offering's own max end     (same-offering touching)
 *
 * and otherwise opens a new segment. Because a new segment only ever opens when
 * startMinutes >= segmentEnd, consecutive segments never overlap and the gap
 * between them is never negative.
 *
 * Comparison is on MINUTES, not on the raw strings the day/offering core above
 * compares: the whole model is intervals, and one comparator throughout is the
 * only way a segment boundary cannot disagree with the block order inside it.
 * For the zero-padded HH:mm the grid and the merge core already require, the two
 * comparisons are identical anyway.
 */
function sweepDayIntoSegments<T extends UnifiedInstructorSegmentableItem>(
  entries: readonly UnifiedInstructorSegmentEntry<T>[],
): UnifiedInstructorSegmentEntry<T>[][] {
  const ordered = [...entries].sort(
    (a, b) =>
      a.startMinutes - b.startMinutes ||
      a.endMinutes - b.endMinutes ||
      a.item.sourceCourseOfferingId.localeCompare(b.item.sourceCourseOfferingId) ||
      a.index - b.index,
  );

  const segments: UnifiedInstructorSegmentEntry<T>[][] = [];
  let current: UnifiedInstructorSegmentEntry<T>[] | null = null;
  let segmentEnd = 0;
  const offeringEnds = new Map<string, number>();

  for (const entry of ordered) {
    const offeringId = entry.item.sourceCourseOfferingId;
    // Read while the current segment is still open - this is the same
    // offering's max end WITHIN that segment, never across a boundary.
    const openOfferingEnd = offeringEnds.get(offeringId);
    const joins =
      current !== null &&
      (entry.startMinutes < segmentEnd ||
        (openOfferingEnd !== undefined && entry.startMinutes === openOfferingEnd));

    if (!joins) {
      current = [];
      segments.push(current);
      segmentEnd = entry.endMinutes;
      offeringEnds.clear();
    }

    current!.push(entry);
    segmentEnd = Math.max(segmentEnd, entry.endMinutes);
    const knownOfferingEnd = offeringEnds.get(offeringId);
    offeringEnds.set(
      offeringId,
      knownOfferingEnd === undefined ? entry.endMinutes : Math.max(knownOfferingEnd, entry.endMinutes),
    );
  }

  return segments;
}

/** One segment's entries -> one block per contributing offering, in display order. */
function buildSegmentBlocks<T extends UnifiedInstructorSegmentableItem>(
  segmentEntries: readonly UnifiedInstructorSegmentEntry<T>[],
  segmentIndex: number,
): UnifiedInstructorSegmentBlock<T>[] {
  const byOffering = new Map<string, UnifiedInstructorSegmentEntry<T>[]>();
  for (const entry of segmentEntries) {
    const bucket = byOffering.get(entry.item.sourceCourseOfferingId);
    if (bucket) bucket.push(entry);
    else byOffering.set(entry.item.sourceCourseOfferingId, [entry]);
  }

  return Array.from(byOffering.values())
    .map((blockEntries) => {
      const first = blockEntries[0].item;
      // Verbatim INPUT order inside a block: the merge core already ordered
      // these items and re-sorting here could only disagree with it. The sweep
      // sorted by time, so input order is restored from the kept indices.
      const items = [...blockEntries].sort((a, b) => a.index - b.index).map((entry) => entry.item);
      return {
        block: Object.freeze({
          key: `${segmentIndex}:${first.sourceCourseOfferingId}`,
          sourceCourseOfferingId: first.sourceCourseOfferingId,
          sourceCourseLabel: first.sourceCourseLabel,
          sourceCourseLevel: first.sourceCourseLevel,
          items: Object.freeze(items) as readonly T[],
        }),
        earliestStartMinutes: blockEntries.reduce(
          (earliest, entry) => Math.min(earliest, entry.startMinutes),
          blockEntries[0].startMinutes,
        ),
      };
    })
    .sort(
      (a, b) =>
        a.earliestStartMinutes - b.earliestStartMinutes ||
        a.block.sourceCourseLevel - b.block.sourceCourseLevel ||
        a.block.sourceCourseOfferingId.localeCompare(b.block.sourceCourseOfferingId),
    )
    .map((entry) => entry.block);
}

/**
 * Regroup one already-merged unified instructor item list into days, each day
 * into chronological SEGMENTS, and each segment into one block per contributing
 * CourseOffering.
 *
 * Rules (all locked by unified-instructor-day-grouping-core.test.ts):
 *
 *  - Days are grouped by `dateKey` and sorted ASCENDING by it (ISO `YYYY-MM-DD`,
 *    so lexicographic order is chronological order). A day's `dayLabel` /
 *    `dateLabel` come from its own items - never recomputed from a clock.
 *  - A day is split into segments by the connectivity rule documented at the top
 *    of this section (strict overlap, or same-offering touching). Segments are
 *    emitted in ascending time order, never overlap, and every item belongs to
 *    exactly one of them - an item is NEVER split across segments.
 *  - Every segment except a day's first carries `gapBefore`, the entirely empty
 *    stretch since the previous segment, with the surrounding items' own HH:mm
 *    strings and a duration of >= 0 minutes (0 = the two segments touch).
 *  - Inside a segment, items are grouped by `sourceCourseOfferingId`: exactly one
 *    block per offering that actually contributes there, so no empty segment and
 *    no empty block can ever be produced, and NO BLOCK EVER MIXES OFFERINGS.
 *  - A block's `sourceCourseLabel` / `sourceCourseLevel` come from that block's
 *    OWN items, so a label can never be attached to the wrong offering.
 *  - Blocks are ordered by (earliest start, sourceCourseLevel,
 *    sourceCourseOfferingId). The two tie-breaks make the order total, so the
 *    output is deterministic under any input reordering.
 *  - Item order INSIDE a block is preserved verbatim from the input.
 *  - `hasMultipleOfferings` counts DISTINCT offerings across the whole day.
 *
 * Neither the input array nor any input item object is mutated (every array is
 * freshly allocated; item objects are passed through by reference, unchanged and
 * unfrozen). The returned days, segments, gaps, blocks and block item arrays are
 * frozen, matching the read-only convention of the surrounding course cores.
 */
export function groupUnifiedInstructorItemsByDaySegmentAndOffering<
  T extends UnifiedInstructorSegmentableItem,
>(items: readonly T[]): readonly UnifiedInstructorSegmentedScheduleDay<T>[] {
  const byDay = new Map<string, UnifiedInstructorSegmentEntry<T>[]>();
  items.forEach((item, index) => {
    const entry = toSegmentEntry(item, index);
    const bucket = byDay.get(item.dateKey);
    if (bucket) bucket.push(entry);
    else byDay.set(item.dateKey, [entry]);
  });

  const days = Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dateKey, dayEntries]) => {
      const offeringIds = new Set(dayEntries.map((entry) => entry.item.sourceCourseOfferingId));

      let previousEnd: { minutes: number; label: string } | null = null;
      const segments = sweepDayIntoSegments(dayEntries).map((segmentEntries, segmentIndex) => {
        const startEntry = segmentEntries.reduce((earliest, entry) =>
          entry.startMinutes < earliest.startMinutes ? entry : earliest,
        );
        const endEntry = segmentEntries.reduce((latest, entry) =>
          entry.endMinutes > latest.endMinutes ? entry : latest,
        );

        const gapBefore: UnifiedInstructorScheduleGap | null =
          previousEnd === null
            ? null
            : Object.freeze({
                realStartTime: previousEnd.label,
                realEndTime: startEntry.item.startTime,
                realDurationMinutes: startEntry.startMinutes - previousEnd.minutes,
              });
        previousEnd = { minutes: endEntry.endMinutes, label: endEntry.endLabel };

        return Object.freeze({
          key: `${dateKey}#${segmentIndex}`,
          startTime: startEntry.item.startTime,
          endTime: endEntry.endLabel,
          gapBefore,
          blocks: Object.freeze(
            buildSegmentBlocks(segmentEntries, segmentIndex),
          ) as readonly UnifiedInstructorSegmentBlock<T>[],
        });
      });

      return Object.freeze({
        dateKey,
        dayLabel: dayEntries[0].item.dayLabel,
        dateLabel: dayEntries[0].item.dateLabel,
        hasMultipleOfferings: offeringIds.size > 1,
        segments: Object.freeze(segments) as readonly UnifiedInstructorScheduleSegment<T>[],
      });
    });

  return Object.freeze(days);
}

/**
 * How ONE inter-segment gap should be rendered, in grid slot rows.
 *
 * `slotCount: 0` means RENDER NOTHING - the only value a zero-length gap (two
 * touching segments) can produce, because real adjacency must never be shown as
 * a break.
 */
export interface UnifiedInstructorScheduleGapPresentation {
  readonly mode: "proportional" | "compressed";
  readonly slotCount: number;
}

/** The caller's slot geometry - the same numbers the grid itself is configured with. */
export interface UnifiedInstructorScheduleGapPresentationConfig {
  readonly thresholdMinutes: number;
  readonly compressedSlotCount: number;
  readonly slotMinutes: number;
}

/**
 * Decide how much vertical space one inter-segment gap gets.
 *
 * This is IUS-2F's rule, unchanged, moved one level up. Inside a grid it can no
 * longer be applied correctly at all: a hole inside one offering's block within
 * a multi-offering segment is - by the contiguity of that segment's union -
 * ALWAYS filled by the other offering, so a "הפסקה בלו״ז שלי" band there would
 * always be false. Between segments the same band is always true, because a
 * segment boundary means nothing at all is scheduled in ANY offering.
 *
 * Rules:
 *  - <= 0 minutes  -> proportional, slotCount 0 (touching segments: render nothing).
 *  - <= threshold  -> proportional, ceil(minutes / slotMinutes) rows, so a short
 *                     break keeps its true height and can never read as adjacency.
 *  - >  threshold  -> compressed, compressedSlotCount rows.
 *  - Compression may only ever SHRINK: if the compressed band would be taller
 *    than the real proportional height, the proportional height is returned
 *    instead (the same guard buildTimeGridLayout applies with `j - i >
 *    compressedSlotCount`).
 *
 * A nonsensical config degrades to the proportional layout rather than throwing,
 * matching normalizeCompactLongGaps in lib/schedule-timegrid.ts: a bad config
 * must never produce a crashed schedule screen, and must never compress.
 */
export function resolveUnifiedInstructorScheduleGapPresentation(
  gap: UnifiedInstructorScheduleGap,
  config: UnifiedInstructorScheduleGapPresentationConfig,
): UnifiedInstructorScheduleGapPresentation {
  const minutes = Math.max(0, Math.round(gap.realDurationMinutes));
  if (minutes === 0) return { mode: "proportional", slotCount: 0 };

  const slotMinutes =
    Number.isFinite(config.slotMinutes) && config.slotMinutes > 0 ? config.slotMinutes : null;
  // With no usable slot size there is no proportional height to compute; one row
  // keeps the two segments visibly apart without ever claiming a duration.
  if (slotMinutes === null) return { mode: "proportional", slotCount: 1 };

  const proportionalSlotCount = Math.max(1, Math.ceil(minutes / slotMinutes));

  const thresholdUsable = Number.isFinite(config.thresholdMinutes) && config.thresholdMinutes > 0;
  const compressedUsable =
    Number.isFinite(config.compressedSlotCount) && config.compressedSlotCount > 0;
  if (!thresholdUsable || !compressedUsable) {
    return { mode: "proportional", slotCount: proportionalSlotCount };
  }

  const compressedSlotCount = Math.max(1, Math.round(config.compressedSlotCount));
  if (minutes <= config.thresholdMinutes || compressedSlotCount >= proportionalSlotCount) {
    return { mode: "proportional", slotCount: proportionalSlotCount };
  }

  return { mode: "compressed", slotCount: compressedSlotCount };
}
