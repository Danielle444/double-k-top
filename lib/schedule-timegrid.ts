import { cleanScheduleTitle } from "@/lib/schedule-title";
import {
  coalesceAdjacentSameActivity,
  mergeSameActivityItems,
  type GroupableScheduleItem,
} from "@/lib/schedule-grouping";

// Which column a positioned cell renders in - group א and group ב get their
// own column; anything else (including groupName: null / "שתי הקבוצות")
// spans both, since there are only ever two real group columns.
export type TimeGridColumn = "a" | "b" | "both";

export interface TimeGridPosition<T> {
  // Usually a single item. Length > 1 only when two or more items in the
  // same column genuinely overlap in time (a data-quality case, not
  // something the coalescing/merge steps produce) - rather than let them
  // silently cover each other, they share one timetable cell and the
  // renderer stacks them inside it.
  items: T[];
  column: TimeGridColumn;
  startSlotIndex: number;
  rowSpan: number;
}

// IUS-2F - one long, entirely empty stretch BETWEEN two occupied stretches,
// rendered as a short fixed-height band instead of its full proportional
// height. NOT a schedule item and deliberately not shaped like one: it carries
// no title/location/instructor/course and can never be fed back into the item
// pipeline. It keeps the REAL clock times and the REAL duration it stands for,
// so the renderer can say exactly what was compressed away.
export interface TimeGridCompressedGap {
  // Derived from the real clock times it replaces, so the same day always
  // yields the same key regardless of input ordering.
  readonly id: string;
  readonly realStartTime: string;
  readonly realEndTime: string;
  readonly realDurationMinutes: number;
  // Coordinates on the COMPRESSED axis - i.e. where the band itself sits.
  readonly startSlotIndex: number;
  readonly rowSpan: number;
}

export interface CompactLongGapsConfig {
  // A gap is compressed only when its real duration is STRICTLY greater than
  // this (so an exactly-threshold gap stays fully proportional).
  readonly thresholdMinutes: number;
  // Fixed height, in normal slot rows, that a compressed gap collapses to.
  readonly compressedSlotCount: number;
}

export interface BuildTimeGridLayoutOptions {
  readonly slotMinutes?: number;
  // Absent (the default) = the pre-IUS-2F behaviour, byte for byte: every gap
  // stays fully proportional and compressedGaps comes back empty.
  readonly compactLongGaps?: CompactLongGapsConfig;
}

export interface TimeGridLayout<T> {
  totalSlots: number;
  slotMinutes: number;
  // Minutes since midnight for this day's own earliest item - lets the
  // renderer compute real clock-time labels for the time column, aligned to
  // the same rows the items are placed in. NOTE: row index -> clock time is a
  // linear mapping ONLY while compressedGaps is empty; once a gap is
  // compressed the axis is deliberately non-linear and each item's own
  // startTime/endTime strings remain the authoritative times.
  dayStartMinutes: number;
  positions: TimeGridPosition<T>[];
  // Always present; empty unless compactLongGaps was passed AND a qualifying
  // gap was found. Returned SEPARATELY from positions - a gap is never a
  // synthetic item.
  compressedGaps: TimeGridCompressedGap[];
}

function timeToMinutes(t: string): number {
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

// Ignores a nonsensical config rather than throwing, matching this module's
// existing tolerance (timeToMinutes returns 0 for an unparseable time,
// rowSpan/totalSlots clamp with Math.max) - a bad config degrades to the
// unchanged proportional layout, never to a crashed schedule screen.
function normalizeCompactLongGaps(
  config: CompactLongGapsConfig | undefined
): CompactLongGapsConfig | null {
  if (!config) return null;
  const { thresholdMinutes, compressedSlotCount } = config;
  if (!Number.isFinite(thresholdMinutes) || thresholdMinutes <= 0) return null;
  if (!Number.isFinite(compressedSlotCount) || compressedSlotCount <= 0) return null;
  return { thresholdMinutes, compressedSlotCount: Math.max(1, Math.round(compressedSlotCount)) };
}

interface RealGap {
  readonly startSlot: number;
  readonly endSlot: number;
  readonly gap: TimeGridCompressedGap;
}

// Finds every empty stretch that may be compressed. A stretch qualifies only
// when ALL of these hold:
//   - every one of its rows is empty in BOTH group columns (a "both"/shared
//     item occupies the row exactly as a single-column item does, and group א
//     being busy while group ב is idle means the row is OCCUPIED);
//   - it has at least one occupied row before it AND at least one after it, so
//     leading/trailing empty time is out of scope (the day axis already trims
//     those away) and only genuinely internal gaps are considered;
//   - its real duration exceeds thresholdMinutes;
//   - it is actually taller than the compressed band, so compressing can only
//     ever shrink the grid, never grow it.
// Times come from the surrounding items' OWN HH:mm strings - the endTime of
// the last item before the gap and the startTime of the first item after it -
// so nothing is reformatted, invented or timezone-converted.
function findCompressibleGaps<T extends GroupableScheduleItem>(
  raw: RawPosition<T>[],
  totalSlots: number,
  config: CompactLongGapsConfig
): RealGap[] {
  const occupied = new Array<boolean>(totalSlots).fill(false);
  for (const p of raw) {
    const from = Math.max(0, p.startSlotIndex);
    const to = Math.min(totalSlots, p.startSlotIndex + p.rowSpan);
    for (let i = from; i < to; i++) occupied[i] = true;
  }

  const gaps: RealGap[] = [];
  let i = 0;
  while (i < totalSlots) {
    if (occupied[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < totalSlots && !occupied[j]) j++;

    // i > 0 => occupied[i - 1]; j < totalSlots => occupied[j]. Anything else is
    // leading or trailing empty time and is never compressed.
    const internal = i > 0 && j < totalSlots;
    if (internal) {
      let realStartTime: string | null = null;
      let realEndTime: string | null = null;
      for (const p of raw) {
        if (p.startSlotIndex + p.rowSpan === i) {
          if (realStartTime === null || timeToMinutes(p.item.endTime) > timeToMinutes(realStartTime)) {
            realStartTime = p.item.endTime;
          }
        }
        if (p.startSlotIndex === j) {
          if (realEndTime === null || timeToMinutes(p.item.startTime) < timeToMinutes(realEndTime)) {
            realEndTime = p.item.startTime;
          }
        }
      }

      if (realStartTime !== null && realEndTime !== null) {
        const realDurationMinutes = timeToMinutes(realEndTime) - timeToMinutes(realStartTime);
        if (realDurationMinutes > config.thresholdMinutes && j - i > config.compressedSlotCount) {
          gaps.push({
            startSlot: i,
            endSlot: j,
            gap: {
              id: `gap-${realStartTime}-${realEndTime}`,
              realStartTime,
              realEndTime,
              realDurationMinutes,
              // Rewritten onto the compressed axis below.
              startSlotIndex: i,
              rowSpan: config.compressedSlotCount,
            },
          });
        }
      }
    }
    i = j;
  }

  return gaps;
}

// Builds the real-row -> compressed-row boundary table. Every normal row keeps
// height 1; a compressed gap's whole run collapses onto its first row with
// height compressedSlotCount and its remaining rows to height 0. Because a gap
// is empty by definition, no item's own [start, start + span) range ever
// straddles a collapsed row, so every item's rowSpan survives unchanged and
// everything after a gap simply shifts up by (runLength - compressedSlotCount).
function buildCompressedBoundaries(
  totalSlots: number,
  gaps: RealGap[],
  compressedSlotCount: number
): number[] {
  const sizes = new Array<number>(totalSlots).fill(1);
  for (const g of gaps) {
    for (let i = g.startSlot; i < g.endSlot; i++) sizes[i] = 0;
    sizes[g.startSlot] = compressedSlotCount;
  }
  const boundary = new Array<number>(totalSlots + 1);
  boundary[0] = 0;
  for (let i = 0; i < totalSlots; i++) boundary[i + 1] = boundary[i] + sizes[i];
  return boundary;
}

// Hebrew, accessible-text only: "6 שעות", "שעה וחצי"-style precision is not
// attempted - just hours and/or minutes, so a screen reader states the real
// span the compressed band stands for.
export function formatTimeGridGapDurationLabel(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  const minutesText = rest === 1 ? "דקה אחת" : `${rest} דקות`;
  if (hours === 0) return minutesText;
  const hoursText = hours === 1 ? "שעה אחת" : hours === 2 ? "שעתיים" : `${hours} שעות`;
  return rest === 0 ? hoursText : `${hoursText} ו-${minutesText}`;
}

interface RawPosition<T> {
  item: T;
  column: TimeGridColumn;
  startSlotIndex: number;
  rowSpan: number;
}

// Groups genuinely-overlapping items within the same column into one shared
// cell (covering their combined slot range) so the renderer can stack them
// instead of placing two cells that would cover each other. Back-to-back
// items (one ends exactly where the next starts) are NOT overlapping and
// stay as separate cells - only a strict time intersection triggers this.
function groupOverlappingByColumn<T>(raw: RawPosition<T>[]): TimeGridPosition<T>[] {
  const byColumn = new Map<TimeGridColumn, RawPosition<T>[]>();
  for (const p of raw) {
    if (!byColumn.has(p.column)) byColumn.set(p.column, []);
    byColumn.get(p.column)!.push(p);
  }

  const result: TimeGridPosition<T>[] = [];
  for (const list of byColumn.values()) {
    const sorted = [...list].sort((a, b) => a.startSlotIndex - b.startSlotIndex);
    let i = 0;
    while (i < sorted.length) {
      const cluster = [sorted[i]];
      let clusterEnd = sorted[i].startSlotIndex + sorted[i].rowSpan;
      let j = i + 1;
      while (j < sorted.length && sorted[j].startSlotIndex < clusterEnd) {
        cluster.push(sorted[j]);
        clusterEnd = Math.max(clusterEnd, sorted[j].startSlotIndex + sorted[j].rowSpan);
        j++;
      }
      const clusterStart = cluster[0].startSlotIndex;
      result.push({
        items: cluster.map((c) => c.item),
        column: cluster[0].column,
        startSlotIndex: clusterStart,
        rowSpan: clusterEnd - clusterStart,
      });
      i = j;
    }
  }

  return result.sort((a, b) => a.startSlotIndex - b.startSlotIndex);
}

// Positions a single day's schedule items into fixed timetable cells (rows =
// fixed time slots, columns = group א / group ב), so overlap (exact,
// partial, one-long-vs-many-short, back-to-back) is expressed as row/column
// coordinates on a real table grid - never as floating/absolute-positioned
// elements that could visually cover one another.
//
// Pipeline (mirrors buildScheduleSlots, replacing only its final "pair into
// a flat slot list" step with table-cell coordinates):
//   1. Coalesce contiguous same-group same-title rows (reused, unchanged).
//   2. Merge exact-same-time-and-title rows across group א/ב into one
//      "שתי הקבוצות" item (reused, unchanged) - preserves the existing
//      merged-card behavior instead of two identical adjacent cards.
//   3. Position everything on the day's own [earliest start, latest end]
//      axis, split into slotMinutes-sized rows.
//   4. Detect any remaining same-column time overlap (a data-quality edge
//      case) and merge those cells into one shared, stacked cell.
//   5. IUS-2F, OPT-IN ONLY: when options.compactLongGaps is passed, collapse
//      each long entirely-empty internal stretch to a fixed short band and
//      shift everything after it up. Off by default - with no config the
//      output is identical to the pre-IUS-2F layout.
//
// The second argument accepts either a plain slotMinutes number (the original
// call shape, kept working verbatim) or the options object.
export function buildTimeGridLayout<T extends GroupableScheduleItem>(
  rawItems: T[],
  optionsOrSlotMinutes: number | BuildTimeGridLayoutOptions = 15
): TimeGridLayout<T> {
  const options: BuildTimeGridLayoutOptions =
    typeof optionsOrSlotMinutes === "number"
      ? { slotMinutes: optionsOrSlotMinutes }
      : optionsOrSlotMinutes;
  const slotMinutes = options.slotMinutes ?? 15;
  const compact = normalizeCompactLongGaps(options.compactLongGaps);

  if (rawItems.length === 0) {
    return { totalSlots: 0, slotMinutes, dayStartMinutes: 0, positions: [], compressedGaps: [] };
  }

  const coalesced = coalesceAdjacentSameActivity(rawItems);

  const consumed = new Set<string>();
  const merged: T[] = [];
  for (const item of coalesced) {
    if (consumed.has(item.id)) continue;

    if (item.groupName === "א" || item.groupName === "ב") {
      const otherGroup = item.groupName === "א" ? "ב" : "א";
      const partner = coalesced.find(
        (o) =>
          !consumed.has(o.id) &&
          o.id !== item.id &&
          o.groupName === otherGroup &&
          o.startTime === item.startTime &&
          o.endTime === item.endTime &&
          cleanScheduleTitle(o.title) === cleanScheduleTitle(item.title)
      );
      if (partner) {
        consumed.add(item.id);
        consumed.add(partner.id);
        merged.push(mergeSameActivityItems(item, partner));
        continue;
      }
    }

    consumed.add(item.id);
    merged.push(item);
  }

  const dayStart = Math.min(...merged.map((i) => timeToMinutes(i.startTime)));
  const dayEnd = Math.max(...merged.map((i) => timeToMinutes(i.endTime)));
  const totalSlots = Math.max(1, Math.ceil((dayEnd - dayStart) / slotMinutes));

  const rawPositions: RawPosition<T>[] = merged.map((item) => {
    const start = timeToMinutes(item.startTime);
    const end = timeToMinutes(item.endTime);
    const column: TimeGridColumn =
      item.groupName === "א" ? "a" : item.groupName === "ב" ? "b" : "both";
    return {
      item,
      column,
      startSlotIndex: Math.floor((start - dayStart) / slotMinutes),
      rowSpan: Math.max(1, Math.round((end - start) / slotMinutes)),
    };
  });

  const positions = groupOverlappingByColumn(rawPositions);

  // Occupancy is read off the RAW positions, i.e. the exact rows the renderer
  // will fill: groupOverlappingByColumn only fuses cells that already overlap,
  // so it can never open a hole the raw ranges did not have.
  const realGaps = compact ? findCompressibleGaps(rawPositions, totalSlots, compact) : [];
  if (!compact || realGaps.length === 0) {
    return {
      totalSlots,
      slotMinutes,
      dayStartMinutes: dayStart,
      positions,
      compressedGaps: [],
    };
  }

  const boundary = buildCompressedBoundaries(totalSlots, realGaps, compact.compressedSlotCount);
  const clamp = (slot: number) => boundary[Math.min(totalSlots, Math.max(0, slot))];

  return {
    totalSlots: boundary[totalSlots],
    slotMinutes,
    dayStartMinutes: dayStart,
    positions: positions.map((p) => {
      const start = clamp(p.startSlotIndex);
      return {
        ...p,
        startSlotIndex: start,
        rowSpan: Math.max(1, clamp(p.startSlotIndex + p.rowSpan) - start),
      };
    }),
    compressedGaps: realGaps.map(({ startSlot, gap }) => ({
      ...gap,
      startSlotIndex: boundary[startSlot],
    })),
  };
}
