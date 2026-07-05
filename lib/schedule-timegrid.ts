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

export interface TimeGridLayout<T> {
  totalSlots: number;
  slotMinutes: number;
  // Minutes since midnight for this day's own earliest item - lets the
  // renderer compute real clock-time labels for the time column, aligned to
  // the same rows the items are placed in.
  dayStartMinutes: number;
  positions: TimeGridPosition<T>[];
}

function timeToMinutes(t: string): number {
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
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
export function buildTimeGridLayout<T extends GroupableScheduleItem>(
  rawItems: T[],
  slotMinutes = 15
): TimeGridLayout<T> {
  if (rawItems.length === 0) {
    return { totalSlots: 0, slotMinutes, dayStartMinutes: 0, positions: [] };
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

  return {
    totalSlots,
    slotMinutes,
    dayStartMinutes: dayStart,
    positions: groupOverlappingByColumn(rawPositions),
  };
}
