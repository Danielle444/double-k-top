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
  // IUS-3B - render this cell across BOTH group columns.
  //
  // ALWAYS true for column "both", which is byte-for-byte the pre-IUS-3B
  // behaviour ("שתי הקבוצות" already spanned both columns). For "a"/"b" it is
  // true only when options.expandUnopposedGroupItems was passed AND the
  // OPPOSITE group column is unoccupied for every row this cell covers - see
  // resolveTimeGridFullWidth. With the option absent this field therefore
  // equals `column === "both"` and the rendered geometry is unchanged.
  //
  // Deliberately a SEPARATE field rather than rewriting `column` to "both":
  // `column` stays the item's real group, so widening a card never falsifies
  // (or loses) the group identity the card's own badge and colour still show.
  fullWidth: boolean;
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
  // IUS-3B - OPT-IN. Absent/false (the default) = the pre-IUS-3B behaviour, byte
  // for byte: a group א / group ב cell always occupies exactly its own half of
  // the two-column grid, even when the other column is completely empty.
  //
  // WHY THIS IS OPT-IN RATHER THAN ALWAYS ON. An empty group column means two
  // different things depending on the surface. In a WHOLE-TIMETABLE view (the
  // admin week, the trainee "שתי הקבוצות" view, the per-course instructor "כל
  // הלו״ז" filter) an empty group-ב column at 07:00 is TRUE INFORMATION - group
  // ב genuinely has nothing then - and a stable column identity down the day is
  // how those views are read. In a MINE-ONLY / FILTERED view the same blank half
  // can never be filled at all (the counterpart item was filtered out
  // server-side, or the instructor simply is not assigned to it), so it carries
  // no information and only costs half the row's width. Only such a view may
  // pass this.
  readonly expandUnopposedGroupItems?: boolean;
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

// A positioned cell BEFORE the full-width decision has been taken. Exists only
// so the decision has exactly one producer (buildTimeGridLayout, via
// resolveTimeGridFullWidth) and can never be silently defaulted somewhere else.
type PositionedCell<T> = Omit<TimeGridPosition<T>, "fullWidth">;

// IUS-3B - the minimum ONE POSITIONED CELL needs for the full-width decision.
// Deliberately not the item and not the layout: the decision is purely about
// which group column a cell is in and which rows it covers, so it is testable
// without building a whole day.
export interface TimeGridFullWidthCandidate {
  readonly column: TimeGridColumn;
  readonly startSlotIndex: number;
  readonly rowSpan: number;
}

// IUS-3B - PURE decision: may each cell span BOTH group columns?
//
// Returns one boolean per input cell, in input order. Neither the array nor any
// cell is mutated.
//
// THE UNIT IS ONE CELL, MEASURED OVER ITS OWN EXACT ROW RANGE - not the whole
// grid, and not "does this day contain both groups anywhere". A cell in column
// "a" may widen exactly when NOTHING occupies column "b" on ANY row in
// [startSlotIndex, startSlotIndex + rowSpan), and symmetrically for "b". So:
//
//   - a day with only group א (or only group ב) widens every cell, which is
//     visually identical to a one-column grid WITHOUT the grid ever changing
//     its column template;
//   - simultaneous א/ב cells never widen, so genuine side-by-side survives;
//   - a PARTIAL overlap still blocks widening for BOTH cells - a card is one
//     rectangle and cannot be half-width for only part of its duration;
//   - א at 08:00 and ב at 12:00 (present in the same grid but never at the same
//     time) BOTH widen, because neither one's own rows are opposed. A per-grid
//     rule would leave both at half width with two permanently blank halves.
//
// A "both" ("שתי הקבוצות") cell already covers both columns, so it (a) always
// reports true, exactly as it renders today, and (b) marks BOTH occupancy
// columns busy - an א/ב cell must never widen into rows a shared cell holds, or
// the two would be painted over each other.
//
// FAILS SAFE, never throws: an unusable axis or a degenerate/out-of-axis row
// range falls back to `column === "both"`, i.e. exactly the current layout.
export function resolveTimeGridFullWidth(
  cells: readonly TimeGridFullWidthCandidate[],
  totalSlots: number
): boolean[] {
  if (!Number.isFinite(totalSlots) || totalSlots <= 0) {
    return cells.map((cell) => cell.column === "both");
  }

  // Clamped to the axis so a nonsensical range can never index out of bounds.
  const rowsOf = (cell: TimeGridFullWidthCandidate) => ({
    from: Math.max(0, cell.startSlotIndex),
    to: Math.min(totalSlots, cell.startSlotIndex + cell.rowSpan),
  });

  const occupiedA = new Array<boolean>(totalSlots).fill(false);
  const occupiedB = new Array<boolean>(totalSlots).fill(false);
  for (const cell of cells) {
    const { from, to } = rowsOf(cell);
    for (let row = from; row < to; row++) {
      if (cell.column === "a" || cell.column === "both") occupiedA[row] = true;
      if (cell.column === "b" || cell.column === "both") occupiedB[row] = true;
    }
  }

  return cells.map((cell) => {
    if (cell.column === "both") return true;
    const { from, to } = rowsOf(cell);
    // No measurable rows = no evidence. Keep the current half-width layout
    // rather than widening on nothing.
    if (to <= from) return false;
    // A cell only ever marks its OWN column, so reading the opposite one here
    // needs no self-exclusion.
    const opposite = cell.column === "a" ? occupiedB : occupiedA;
    for (let row = from; row < to; row++) {
      if (opposite[row]) return false;
    }
    return true;
  });
}

// Groups genuinely-overlapping items within the same column into one shared
// cell (covering their combined slot range) so the renderer can stack them
// instead of placing two cells that would cover each other. Back-to-back
// items (one ends exactly where the next starts) are NOT overlapping and
// stay as separate cells - only a strict time intersection triggers this.
function groupOverlappingByColumn<T>(raw: RawPosition<T>[]): PositionedCell<T>[] {
  const byColumn = new Map<TimeGridColumn, RawPosition<T>[]>();
  for (const p of raw) {
    if (!byColumn.has(p.column)) byColumn.set(p.column, []);
    byColumn.get(p.column)!.push(p);
  }

  const result: PositionedCell<T>[] = [];
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
//   5. Decide, per cell, whether it spans both group columns. Without
//      options.expandUnopposedGroupItems this is exactly `column === "both"`,
//      i.e. today's rule; with it, an unopposed א/ב cell may widen too (see
//      resolveTimeGridFullWidth). The COLUMN TEMPLATE is never touched - the
//      grid stays two columns and only cell spans change.
//   6. IUS-2F, OPT-IN ONLY: when options.compactLongGaps is passed, collapse
//      each long entirely-empty internal stretch to a fixed short band and
//      shift everything after it up. Off by default - with no config the
//      output is identical to the pre-IUS-2F layout.
//
// Step 5 runs BEFORE step 6 deliberately: the full-width decision is taken on
// the REAL, uncompressed axis, so a collapsed row can never be mistaken for an
// unoccupied one. Compression then only rewrites row coordinates and carries
// each cell's decision through unchanged.
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

  const cells = groupOverlappingByColumn(rawPositions);

  // IUS-3B - taken on the REAL axis, before any compression rewrite. Off by
  // default, and then byte-for-byte the previous rule: only a "שתי הקבוצות" cell
  // spans both columns.
  const fullWidthFlags = options.expandUnopposedGroupItems
    ? resolveTimeGridFullWidth(cells, totalSlots)
    : cells.map((cell) => cell.column === "both");
  const positions: TimeGridPosition<T>[] = cells.map((cell, index) => ({
    ...cell,
    fullWidth: fullWidthFlags[index],
  }));

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
