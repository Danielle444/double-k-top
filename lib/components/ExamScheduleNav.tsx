"use client";

/**
 * EX-ROLE-SCHEDULE-REDESIGN — the compact navigation bar shared by the
 * instructor and trainee exam schedules.
 *
 * ===========================================================================
 * IT NAVIGATES DATA ALREADY IN HAND
 * ===========================================================================
 * Every option it offers is derived from the rows the screen has ALREADY loaded
 * and the server has ALREADY authorized, and choosing one only narrows what is
 * shown. It issues NO REQUEST, holds no state of its own, names no course, no
 * plan, no session and no person, and has no way to ask for a row the server did
 * not send — so switching views can neither widen a read nor reveal draft or
 * out-of-scope data. That is why the general view and the filtered views are the
 * same read: they are the same array, narrowed in the browser.
 *
 * IT IS FULLY CONTROLLED. The selection lives in the screen that mounts it, so
 * the instructor screen and the trainee screen cannot move each other's view,
 * and this file has no `useState`, no `useEffect` and no memory between renders.
 *
 * READ-ONLY BY CONSTRUCTION: the only elements are `type="button"` controls whose
 * handlers call the caller's setters and nothing else. There is no form, no
 * input, no select, no Server Action, no publication concept and no write.
 */
import { formatHebrewDate, parseDateKey } from "@/lib/dates";

/**
 * The three connected views. `all` is not a third code path — it is simply both
 * axes unconstrained, which is what makes the general view and the filtered
 * views provably the same data.
 */
export type ExamScheduleNavMode = "all" | "type" | "date";

const TYPE_MODE_LABEL = "לפי סוג מבחן";
const DATE_MODE_LABEL = "לפי תאריך";

const SELECTED_CLASS = "border-primary bg-primary text-primary-foreground";
const UNSELECTED_CLASS = "border-border bg-card text-card-foreground";

/** One tab or chip. Compact by design: these sit above a schedule, not beside it. */
function NavButton({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`rounded-xl border px-3 py-2 text-xs font-semibold ${
        selected ? SELECTED_CLASS : UNSELECTED_CLASS
      }`}
    >
      {label}
    </button>
  );
}

/**
 * The navigation bar: the connected views on top, and the options of the active
 * one beneath.
 *
 * A mode whose option list is EMPTY is not offered at all — a "by exam type" tab
 * over a schedule with no named exam is a dead end, and the general view already
 * shows those rows. Selecting the active chip again clears the selection and
 * returns to everything in that mode, so the reader is never stuck inside one
 * exam type with no way back.
 */
export function ExamScheduleNav({
  allLabel,
  mode,
  onSelectMode,
  definitionNames,
  selectedDefinitionName,
  onSelectDefinitionName,
  dates,
  selectedDate,
  onSelectDate,
}: {
  readonly allLabel: string;
  readonly mode: ExamScheduleNavMode;
  readonly onSelectMode: (mode: ExamScheduleNavMode) => void;
  readonly definitionNames: readonly string[];
  readonly selectedDefinitionName: string | null;
  readonly onSelectDefinitionName: (name: string | null) => void;
  readonly dates: readonly string[];
  readonly selectedDate: string | null;
  readonly onSelectDate: (date: string | null) => void;
}) {
  const hasTypes = definitionNames.length > 0;
  const hasDates = dates.length > 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <NavButton label={allLabel} selected={mode === "all"} onSelect={() => onSelectMode("all")} />
        {hasTypes && (
          <NavButton
            label={TYPE_MODE_LABEL}
            selected={mode === "type"}
            onSelect={() => onSelectMode("type")}
          />
        )}
        {hasDates && (
          <NavButton
            label={DATE_MODE_LABEL}
            selected={mode === "date"}
            onSelect={() => onSelectMode("date")}
          />
        )}
      </div>

      {mode === "type" && hasTypes && (
        <div className="flex flex-wrap gap-2">
          {definitionNames.map((name) => (
            <NavButton
              key={name}
              label={name}
              selected={selectedDefinitionName === name}
              onSelect={() => onSelectDefinitionName(selectedDefinitionName === name ? null : name)}
            />
          ))}
        </div>
      )}

      {mode === "date" && hasDates && (
        <div className="flex flex-wrap gap-2">
          {dates.map((date) => (
            <NavButton
              key={date}
              label={formatHebrewDate(parseDateKey(date))}
              selected={selectedDate === date}
              onSelect={() => onSelectDate(selectedDate === date ? null : date)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
