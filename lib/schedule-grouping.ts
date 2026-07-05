import { cleanScheduleTitle } from "@/lib/schedule-title";

// Shared by the instructor and student schedule views: any schedule item
// with at least these fields can be grouped by same-time-slot group pairs.
export interface GroupableScheduleItem {
  id: string;
  startTime: string;
  endTime: string;
  title: string;
  groupName: string | null;
  instructorName: string | null;
  location: string | null;
  description: string | null;
}

export type ScheduleSlot<T extends GroupableScheduleItem> =
  | { kind: "single"; item: T }
  | { kind: "merged"; item: T }
  | { kind: "pair"; items: [T, T] }
  // One group has a single activity spanning the exact combined time range of
  // several consecutive activities in the other group (e.g. one group's
  // 10:00-12:00 "Riding" against the other group's 10:00-11:00 + 11:00-12:00
  // two shorter activities). groupA/groupB are always in that fixed order
  // (matching "pair"'s [groupA, groupB] convention) - exactly one of the two
  // arrays has length 1 (the spanning activity), the other has length >= 2.
  | { kind: "span"; groupA: T[]; groupB: T[] };

function mergeUnique(a: string | null, b: string | null): string | null {
  const values = Array.from(
    new Set([a, b].filter((v): v is string => !!v && v.trim().length > 0))
  );
  return values.length > 0 ? values.join(" / ") : null;
}

// Combines two same-time, opposite-group items (א + ב) into one synthetic
// "שתי הקבוצות" item (groupName: null already renders that way) - display
// only, nothing is written back to the DB.
function mergeSameActivityItems<T extends GroupableScheduleItem>(a: T, b: T): T {
  return {
    ...a,
    id: `${a.id}+${b.id}`,
    groupName: null,
    instructorName: mergeUnique(a.instructorName, b.instructorName),
    location: mergeUnique(a.location, b.location),
    description: mergeUnique(a.description, b.description),
  };
}

// A source Excel timetable is a grid of fixed time-slot rows, so one group's
// single continuous activity that happens to cross the other group's shorter
// activity boundaries gets stored as multiple consecutive rows (same group,
// same title, contiguous times) rather than one row spanning the full range.
// This combines those back into one item before any cross-group comparison,
// so the rest of the logic (and the final display) sees it as what it really
// is: one activity. Display-only - nothing is written back to the DB.
function mergeContiguousSameActivity<T extends GroupableScheduleItem>(a: T, b: T): T {
  return {
    ...a,
    id: `${a.id}+${b.id}`,
    endTime: b.endTime,
    instructorName: mergeUnique(a.instructorName, b.instructorName),
    location: mergeUnique(a.location, b.location),
    description: mergeUnique(a.description, b.description),
  };
}

// Merges adjacent items within the same group (including groupName: null)
// only when the cleaned title matches AND the previous item's endTime
// exactly equals the next item's startTime - never across a time gap, and
// never across different activities.
function coalesceAdjacentSameActivity<T extends GroupableScheduleItem>(items: T[]): T[] {
  const byGroup = new Map<string, T[]>();
  for (const item of items) {
    const key = item.groupName ?? "";
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key)!.push(item);
  }

  const result: T[] = [];
  for (const group of byGroup.values()) {
    const sorted = [...group].sort((a, b) => a.startTime.localeCompare(b.startTime));
    let i = 0;
    while (i < sorted.length) {
      let current = sorted[i];
      let next = i + 1;
      while (
        next < sorted.length &&
        sorted[next].startTime === current.endTime &&
        cleanScheduleTitle(sorted[next].title) === cleanScheduleTitle(current.title)
      ) {
        current = mergeContiguousSameActivity(current, sorted[next]);
        next++;
      }
      result.push(current);
      i = next;
    }
  }
  return result;
}

// Walks groupA/groupB (each already coalesced, sorted, and internally
// gap-free) with two pointers, matching same-start-time items and, when one
// side's item ends later than the other's, trying to find a contiguous run
// on the shorter side that exactly covers the longer item's full range. If
// no exact-covering run exists, falls back to single cards - this
// deliberately does not attempt to lay out genuinely partial/misaligned
// overlaps.
function matchGroupRuns<T extends GroupableScheduleItem>(groupA: T[], groupB: T[]): ScheduleSlot<T>[] {
  const slots: ScheduleSlot<T>[] = [];
  let i = 0;
  let j = 0;

  while (i < groupA.length && j < groupB.length) {
    const a = groupA[i];
    const b = groupB[j];

    if (a.startTime !== b.startTime) {
      if (a.startTime < b.startTime) {
        slots.push({ kind: "single", item: a });
        i++;
      } else {
        slots.push({ kind: "single", item: b });
        j++;
      }
      continue;
    }

    if (a.endTime === b.endTime) {
      const sameActivity = cleanScheduleTitle(a.title) === cleanScheduleTitle(b.title);
      slots.push(
        sameActivity
          ? { kind: "merged", item: mergeSameActivityItems(a, b) }
          : { kind: "pair", items: [a, b] }
      );
      i++;
      j++;
      continue;
    }

    const aIsShorter = a.endTime < b.endTime;
    const longItem = aIsShorter ? b : a;
    const shortArray = aIsShorter ? groupA : groupB;
    const shortStartIndex = aIsShorter ? i : j;

    const run: T[] = [shortArray[shortStartIndex]];
    let end = run[0].endTime;
    let k = shortStartIndex;
    while (end < longItem.endTime) {
      const nextItem = shortArray[k + 1];
      if (!nextItem || nextItem.startTime !== end) break;
      run.push(nextItem);
      end = nextItem.endTime;
      k++;
    }

    if (end === longItem.endTime && run.length >= 2) {
      slots.push({
        kind: "span",
        groupA: aIsShorter ? run : [longItem],
        groupB: aIsShorter ? [longItem] : run,
      });
      if (aIsShorter) {
        i = k + 1;
        j++;
      } else {
        j = k + 1;
        i++;
      }
      continue;
    }

    // No exact-covering run - fall back to the existing per-item behavior
    // for the shorter-ending side only, and retry alignment from there.
    if (aIsShorter) {
      slots.push({ kind: "single", item: a });
      i++;
    } else {
      slots.push({ kind: "single", item: b });
      j++;
    }
  }

  while (i < groupA.length) slots.push({ kind: "single", item: groupA[i++] });
  while (j < groupB.length) slots.push({ kind: "single", item: groupB[j++] });

  return slots;
}

function slotStartTime<T extends GroupableScheduleItem>(slot: ScheduleSlot<T>): string {
  if (slot.kind === "pair") return slot.items[0].startTime;
  if (slot.kind === "span") return (slot.groupA[0] ?? slot.groupB[0]).startTime;
  return slot.item.startTime;
}

// Groups same-time-slot, opposite-group (א/ב) items: identical activity ->
// one merged "שתי הקבוצות" card; different activity -> two cards meant to
// be shown side by side so it's clear at a glance the groups split for that
// slot; one long activity against several contiguous shorter activities in
// the other group -> one "span" card next to the shorter cards, stacked.
// Everything else is returned as-is, one card per item.
export function buildScheduleSlots<T extends GroupableScheduleItem>(items: T[]): ScheduleSlot<T>[] {
  const coalesced = coalesceAdjacentSameActivity(items);

  const groupA = coalesced
    .filter((i) => i.groupName === "א")
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  const groupB = coalesced
    .filter((i) => i.groupName === "ב")
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  const other = coalesced.filter((i) => i.groupName !== "א" && i.groupName !== "ב");

  const slots: ScheduleSlot<T>[] = [
    ...matchGroupRuns(groupA, groupB),
    ...other.map((item): ScheduleSlot<T> => ({ kind: "single", item })),
  ];

  // matchGroupRuns and the "other" bucket are computed independently, so the
  // combined list needs re-sorting to keep the existing chronological
  // display order.
  slots.sort((a, b) => slotStartTime(a).localeCompare(slotStartTime(b)));

  return slots;
}
