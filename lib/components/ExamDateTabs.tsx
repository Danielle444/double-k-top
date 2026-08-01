"use client";

/**
 * EX-TRAINEE-DATE-NAV — the compact DATE sub-tabs of the trainee exam schedule.
 *
 * ===========================================================================
 * IT NAVIGATES DATA ALREADY IN HAND
 * ===========================================================================
 * Every date it offers is derived from the rows the screen has ALREADY loaded
 * and the server has ALREADY authorized, and choosing one only narrows what is
 * shown. It issues NO REQUEST, holds no state of its own, names no course, no
 * plan, no session and no person, and has no way to ask for a row the server did
 * not send — so moving between dates can neither widen a read nor reveal draft
 * or out-of-scope data.
 *
 * IT IS FULLY CONTROLLED. The selection lives in the screen that mounts it, so
 * this file has no `useState`, no `useEffect` and no memory between renders.
 *
 * ===========================================================================
 * WHY IT IS NOT THE SHARED `ExamScheduleNav`
 * ===========================================================================
 * That bar offers three CONNECTED VIEWS — a general one, by exam type, and by
 * date — and lets the active chip be re-clicked to clear the selection back to
 * "everything". A trainee is deliberately offered neither: there is no general
 * view and no by-exam-type view on the trainee screen any more, and "no date
 * selected" is not a state a date-only schedule can be in. The instructor screen
 * keeps that bar unchanged; this is a strictly smaller control, not a fork of it.
 *
 * SELECTING IS THEREFORE TOTAL: clicking a chip always names a date, and
 * clicking the active chip re-selects the same date rather than clearing it. The
 * screen can never end up showing nothing because a reader tapped twice.
 *
 * READ-ONLY BY CONSTRUCTION: the only elements are `type="button"` controls whose
 * handlers call the caller's setter and nothing else. There is no form, no
 * input, no select, no Server Action and no write.
 */
import { formatHebrewDate, parseDateKey } from "@/lib/dates";

const SELECTED_CLASS = "border-primary bg-primary text-primary-foreground";
const UNSELECTED_CLASS = "border-border bg-card text-card-foreground";

/**
 * One date per chip, in the order the caller gives them, each labelled for a
 * reader rather than as the raw `YYYY-MM-DD` token the server keys on.
 *
 * An EMPTY list renders nothing at all — not an empty bar and not an "no dates"
 * claim. Whether that means "nothing is published", "nothing is yours" or
 * "nothing on this day" is the screen's sentence to choose, and a control that
 * guessed would answer a publication question it knows nothing about.
 */
export function ExamDateTabs({
  dates,
  selectedDate,
  onSelectDate,
}: {
  readonly dates: readonly string[];
  readonly selectedDate: string | null;
  readonly onSelectDate: (date: string) => void;
}) {
  if (dates.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {dates.map((date) => (
        <button
          key={date}
          type="button"
          onClick={() => onSelectDate(date)}
          className={`rounded-xl border px-3 py-2 text-xs font-semibold ${
            selectedDate === date ? SELECTED_CLASS : UNSELECTED_CLASS
          }`}
        >
          {formatHebrewDate(parseDateKey(date))}
        </button>
      ))}
    </div>
  );
}
