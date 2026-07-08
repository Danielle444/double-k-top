// Pure schedule-conflict math for the "בדיקת שיבוץ" quality check - no DB
// access, no "use server". Kept separate from lib/actions/teaching-practice.ts
// so the comparison logic is easy to read/verify on its own, same convention
// as lib/teaching-practice-rotation.ts.

export const MIN_TEACHING_PRACTICE_GAP_MINUTES = 15;

export type TeachingPracticeScheduleWarningKind = "overlap" | "short_gap" | "dense";

export interface TeachingPracticeScheduleWarning {
  kind: TeachingPracticeScheduleWarningKind;
  // Minutes between the previous entry's endTime and this entry's startTime.
  // Negative means overlap (the two lessons share that many minutes). Null
  // for "dense" - that warning describes a whole run of 3+ entries, not one
  // pairwise gap, so no single gap value applies to it.
  gapMinutes: number | null;
}

export interface TeachingPracticeTimelineEntryInput {
  lessonId: string;
  date: string; // dateKey "YYYY-MM-DD"
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM"
}

// Returns null for an unparsable time rather than throwing, so a malformed
// row is simply skipped by the comparison below instead of crashing the
// whole read-only check.
export function parseTimeToMinutes(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function sortTeachingPracticeTimeline<T extends TeachingPracticeTimelineEntryInput>(entries: T[]): T[] {
  return [...entries].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return (parseTimeToMinutes(a.startTime) ?? 0) - (parseTimeToMinutes(b.startTime) ?? 0);
  });
}

// Sorts the given entries and attaches warnings to each entry by comparing it
// against the immediately preceding entry - but only when both fall on the
// same date; a gap between lessons on different dates is never meaningful
// and is intentionally never compared. After the pairwise pass, also marks
// every entry inside a run of 3+ consecutive same-date entries whose
// adjoining gaps are all overlap/short_gap with an additional "dense"
// warning (see attachDenseWarnings).
export function attachTeachingPracticeScheduleWarnings<T extends TeachingPracticeTimelineEntryInput>(
  entries: T[]
): (T & { warnings: TeachingPracticeScheduleWarning[] })[] {
  const sorted = sortTeachingPracticeTimeline(entries);

  const withPairwiseWarnings = sorted.map((entry, index) => {
    const warnings: TeachingPracticeScheduleWarning[] = [];
    const prev = index > 0 ? sorted[index - 1] : null;

    if (prev && prev.date === entry.date) {
      const prevEnd = parseTimeToMinutes(prev.endTime);
      const nextStart = parseTimeToMinutes(entry.startTime);
      if (prevEnd != null && nextStart != null) {
        const gapMinutes = nextStart - prevEnd;
        if (gapMinutes < 0) {
          warnings.push({ kind: "overlap", gapMinutes });
        } else if (gapMinutes < MIN_TEACHING_PRACTICE_GAP_MINUTES) {
          warnings.push({ kind: "short_gap", gapMinutes });
        }
      }
    }

    return { ...entry, warnings };
  });

  attachDenseWarnings(withPairwiseWarnings);

  return withPairwiseWarnings;
}

// A "tight edge" is a consecutive pair that already got an overlap/short_gap
// warning above. A run of 2+ consecutive tight edges spans 3+ entries -
// exactly the "3+ assignments in one day with tight consecutive gaps" rule -
// so every entry in such a run gets a "dense" warning added on top of
// whatever pairwise warning it already carries. Mutates the entries'
// warnings arrays in place (they were just built fresh by the caller above,
// so this is safe and avoids a second full array copy).
function attachDenseWarnings(entries: { warnings: TeachingPracticeScheduleWarning[] }[]): void {
  let runStart = 0;
  let tightEdgeCount = 0;

  const flushRun = (runEndExclusive: number) => {
    if (tightEdgeCount >= 2) {
      for (let i = runStart; i < runEndExclusive; i++) {
        entries[i].warnings.push({ kind: "dense", gapMinutes: null });
      }
    }
  };

  for (let i = 1; i < entries.length; i++) {
    const isTightEdge = entries[i].warnings.some((w) => w.kind === "overlap" || w.kind === "short_gap");
    if (isTightEdge) {
      tightEdgeCount++;
    } else {
      flushRun(i);
      runStart = i;
      tightEdgeCount = 0;
    }
  }
  flushRun(entries.length);
}
