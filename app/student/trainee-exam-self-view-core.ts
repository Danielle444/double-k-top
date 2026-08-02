/**
 * EX-EXAM-TP-CARDS — the PURE core behind "לו״ז שלי"'s merge of the trainee's
 * advanced exam rows and their real beginner Teaching-Practice lessons.
 *
 * PURE by construction: no React, no fetch, no clock, no randomness, no IO.
 * Extracted out of `StudentExamsSection.tsx` itself (rather than defined
 * inline there) for the same reason `exam-schedule-view-core.ts` exists: the
 * screen holds no comparator, no filter and no date rule of its own to
 * disagree with a second, inline copy - every ordering/filtering decision in
 * this file is unit-testable in a plain `tsx --test` process, and the screen
 * only ever calls it.
 */
import { isBeginnerExamRow } from "@/lib/components/exam-schedule-view-core";
import type { TraineeExamScheduleView } from "@/lib/actions/trainee-exam-schedule";
import type { TeachingPracticeTraineeLessonRow } from "@/lib/actions/teaching-practice-student";

// Exported for test fixtures only (see this module's own test file) - no
// production caller needs it, since every production call site already gets
// the real, fully-shaped rows from `view.myRows`/`view.allRows`.
export type ExamRow = TraineeExamScheduleView["allRows"][number];

/**
 * ONE "לו״ז שלי" entry: either the SERVER's own exam row or a real
 * Teaching-Practice lesson, tagged so the renderer can tell them apart
 * without inspecting shape. A Teaching-Practice entry is never converted into
 * (or rendered as) an exam row - it carries its OWN lesson object, handed
 * straight to the shared `TeachingPracticeLessonCard`.
 */
export type SelfViewEntry =
  | { kind: "exam"; date: string; startTime: string; row: ExamRow }
  | {
      kind: "practice";
      date: string;
      startTime: string;
      lesson: TeachingPracticeTraineeLessonRow;
    };

/**
 * Merge the trainee's own advanced exam rows and their real beginner
 * Teaching-Practice lessons into ONE chronological list for "לו״ז שלי".
 *
 * Sorted by (1) date, (2) start time, (3) STABLE ORIGINAL ORDER as the
 * explicit tie-break - exam rows are listed before lessons in the input to
 * `entries` below, so two items sharing a date and start time keep that
 * relative order rather than depending on `Array.prototype.sort`'s stability
 * alone. Both inputs already arrive chronologically ordered from their own
 * readers (the exam contract's own date/startTime order for `examRows`,
 * `orderBy: [date, startTime, id]` for `lessons`), so this performs no
 * independent re-derivation of either list's internal order - only the ONE
 * merge across the two.
 */
export function buildSelfViewEntries(
  examRows: readonly ExamRow[],
  lessons: readonly TeachingPracticeTraineeLessonRow[],
): SelfViewEntry[] {
  const entries: SelfViewEntry[] = [
    ...examRows.map((row): SelfViewEntry => ({ kind: "exam", date: row.date, startTime: row.startTime, row })),
    ...lessons.map(
      (lesson): SelfViewEntry => ({
        kind: "practice",
        date: lesson.date,
        startTime: lesson.startTime,
        lesson,
      }),
    ),
  ];
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      if (a.entry.date !== b.entry.date) return a.entry.date < b.entry.date ? -1 : 1;
      if (a.entry.startTime !== b.entry.startTime) return a.entry.startTime < b.entry.startTime ? -1 : 1;
      return a.index - b.index;
    })
    .map(({ entry }) => entry);
}

/**
 * The dates this trainee's OWN exam contract already marks as beginner exam
 * days - `view.myRows` rows whose `source` is `"BEGINNER"`. This is NOT a new
 * date rule: it is the SAME per-trainee relevance the server already computed
 * (see `StudentExamsSection.tsx`'s own file header, EX-EXAM-TP-CARDS), read
 * out rather than re-derived.
 */
export function collectBeginnerExamDates(myRows: readonly ExamRow[]): Set<string> {
  const dates = new Set<string>();
  for (const row of myRows) {
    if (isBeginnerExamRow(row)) dates.add(row.date);
  }
  return dates;
}

/**
 * The real Teaching-Practice lessons this "לו״ז שלי" view may show: BEGINNER
 * practice types only (LUNGE excluded) on a beginner exam day (see
 * {@link collectBeginnerExamDates}). Identity/participation/publication are
 * already decided by the reader that produced `lessons` - this filters ONLY
 * on `practiceType` and `date`, never on a name.
 */
export function filterBeginnerLessonsForExamDays(
  lessons: readonly TeachingPracticeTraineeLessonRow[],
  beginnerExamDates: ReadonlySet<string>,
): TeachingPracticeTraineeLessonRow[] {
  return lessons.filter(
    (lesson) => lesson.practiceType !== "LUNGE" && beginnerExamDates.has(lesson.date),
  );
}
