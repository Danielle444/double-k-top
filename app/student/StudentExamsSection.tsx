"use client";

import { useEffect, useState } from "react";
import { ExamAssignmentRows } from "@/lib/components/ExamAssignmentRows";
import {
  getTraineeExamDaySchedule,
  type TraineeExamScheduleView,
} from "@/lib/actions/trainee-exam-schedule";
import { formatHebrewDate, formatHebrewWeekday, getLocalDateKey, parseDateKey } from "@/lib/dates";

/**
 * EX-TRAINEE-VIEW-MVP — the trainee "מבחנים" screen.
 *
 * READ-ONLY BY CONSTRUCTION. There is no form, no submit, no publish control, no
 * supervisor control and no pairing control in this file, and none may be added
 * here: every exam WRITE surface is its own separately reviewed slice. The one
 * control on the screen is the DAY the trainee is looking at, plus a switch
 * between the two views of that same already-fetched day.
 *
 * IT AUTHORIZES NOTHING, AND IT NAMES NOBODY. The single Server Action it calls
 * takes a DATE and nothing else: the trainee's identity comes from the signed
 * session and their course from the committed non-selectable resolver, both
 * server-side. No student id and no course id is derived, held or sent from the
 * browser, and there is no second course picker here for the same reason — this
 * screen has no course to pick.
 *
 * PUBLICATION IS FAIL-CLOSED UPSTREAM. An unpublished plan and an unpublished
 * lesson never reach this component at all; they arrive as the same EMPTY day as
 * a denial or an unusable date. So the empty state is deliberately ONE neutral
 * sentence that does not say whether a schedule is missing, still a draft, or
 * simply not this trainee's to see. There is no draft toggle and no publication
 * timestamp on this screen.
 *
 * ===========================================================================
 * PRIVACY: ONLY APPROVED DISPLAY VALUES ARE RENDERED
 * ===========================================================================
 * The contract this screen receives is already role-narrowed server-side, but
 * narrowing is not licence to print everything in it. Rendered here: the date,
 * the exam definition's name, the block start and end time, the arena or lesson
 * location, the viewer's own row label, role and EXACT personal start and end
 * time, and the examinee / instructed-trainee DISPLAY NAMES with their
 * authoritative counts.
 *
 * NOT rendered, deliberately: any session, definition, assignment, lesson, plan
 * or course id, any student or instructor id, any national id, e-mail or phone
 * number, the live beginner detail with its children and PARENT CONTACT values,
 * and any diagnostic. `sessionId` appears in this file for exactly one purpose —
 * as a React list key, which never reaches the DOM — and is never placed in a
 * rendered position. There is no `JSON.stringify` and no generic object
 * renderer, so a field that is not spelled out below cannot appear on screen.
 *
 * ===========================================================================
 * A PERSONAL TIME IS NEVER INVENTED
 * ===========================================================================
 * The viewer's personal start and end are shown ONLY when the contract carries
 * them. They are never replaced by the block start, by a derived block end, by a
 * default duration or by anyone else's time: a trainee reading "you ride at
 * 09:00" must be reading a real assignment, not a layout convenience. When the
 * personal start is absent the personal-time line is simply not rendered.
 *
 * ===========================================================================
 * THE COMPLETE OPERATIONAL SCHEDULE (EX-ROLE-OP-UI-MVP)
 * ===========================================================================
 * "לו״ז כולם" is deliberately a COMPLETE operational schedule, not a
 * privacy-narrowed list of names: every visible block now renders its
 * assignment-level rows — who is in it, in which role, at exactly which minutes,
 * on which horse, on which topic and discipline, and paired with whom. A trainee
 * needs all of it to act on the day, and the read layer already decided that
 * these are approved display values for BOTH roles. They are rendered by the ONE
 * shared renderer, `lib/components/ExamAssignmentRows`, which the instructor
 * screen mounts too, so the two screens cannot drift apart.
 *
 * WHAT THAT DOES **NOT** WIDEN. The rows carry display names and operational
 * values only. No national id, e-mail address, phone number, parent detail,
 * contact detail, note or internal id is in them, none is rendered, and none is
 * even representable in the renderer's prop type.
 *
 * "לו״ז שלי" IS STILL THE SAME FILTER IT WAS: `view.myRows`, which the committed
 * trainee core computed server-side from the SIGNED SESSION and handed over as
 * the boolean `isSelf`. The viewer's own row keeps its existing ring, its
 * "השיבוץ שלי" label, its role and its exact personal window; the assignment
 * rows are shown BENEATH that, so the viewer's horse, topic, discipline and
 * partner are on their own block. NO NAME IS EVER COMPARED to find "mine" — the
 * screen holds no name of the viewer to compare with, and adding an id to the
 * contract just to highlight a line is exactly what the contract refuses.
 *
 * STILL NOT CARRIED, and therefore still not stubbed here: any grade, any
 * feedback and any rating.
 */

const LOADING_TEXT = "טוען לוח מבחנים...";
const ERROR_TEXT = "לא ניתן לטעון כרגע את לוח המבחנים.";
const EMPTY_TEXT = "עדיין לא פורסם לוח מבחנים ליום זה.";
/**
 * Shown ONLY when the day itself is published and visible but holds no row of
 * the viewer's own. It says nothing about publication, so it cannot be read as
 * an answer to "is there a schedule" — that question is EMPTY_TEXT's alone.
 */
const NO_SELF_TEXT = "אין לך שיבוץ למבחן ביום זה.";

const ALL_MODE_LABEL = "לו״ז כולם";
const SELF_MODE_LABEL = "לו״ז שלי";

type ExamRow = TraineeExamScheduleView["allRows"][number];
type DayMode = "all" | "self";

/** The Hebrew label for the viewer's own role on a row. */
const SELF_ROLE_LABELS: Record<"EXAMINEE" | "INSTRUCTED_TRAINEE", string> = {
  EXAMINEE: "נבחן",
  INSTRUCTED_TRAINEE: "חניך מודרך",
};

/**
 * Group the rows by calendar day, preserving the server's row order exactly.
 *
 * One selected day yields one group today. It is written as a grouping anyway so
 * the day heading is always taken from the CONTRACT's own `row.date` rather than
 * from the string sitting in the picker, which the reader may legitimately have
 * refused to use.
 */
function groupRowsByDate(rows: readonly ExamRow[]): { date: string; rows: ExamRow[] }[] {
  const groups: { date: string; rows: ExamRow[] }[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last !== undefined && last.date === row.date) {
      last.rows.push(row);
      continue;
    }
    groups.push({ date: row.date, rows: [row] });
  }
  return groups;
}

/** One "label: names" line, rendered only when at least one person is on it. */
function PeopleLine({
  label,
  names,
  count,
}: {
  label: string;
  names: readonly string[];
  count: number;
}) {
  if (count === 0) return null;
  return (
    <p className="text-sm text-card-foreground">
      <span className="font-semibold">{label}: </span>
      {names.length > 0 ? names.join(", ") : `${count}`}
    </p>
  );
}

export function StudentExamsSection() {
  const [selectedDate, setSelectedDate] = useState<string>(() => getLocalDateKey());
  const [mode, setMode] = useState<DayMode>("all");
  const [view, setView] = useState<TraineeExamScheduleView | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (selectedDate === "") {
      // A cleared picker asks for no day at all.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setView(null);
      setFailed(false);
      setLoading(false);
      return;
    }
    let cancelled = false;
    // The previous day's schedule is dropped BEFORE the request goes out, so no
    // row from another date can stay on screen while this load is in flight.
    setView(null);
    setFailed(false);
    setLoading(true);
    getTraineeExamDaySchedule(selectedDate)
      .then((result) => {
        if (cancelled) return;
        setView(result);
        setLoading(false);
      })
      .catch(() => {
        // Fail closed and stay generic: the underlying error may name internal
        // modules, ids or query detail, none of which belongs on a screen.
        if (cancelled) return;
        setFailed(true);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDate]);

  const visibleRows = view === null ? [] : mode === "self" ? view.myRows : view.allRows;
  const groups = groupRowsByDate(visibleRows);
  const dayIsEmpty = view !== null && view.allRows.length === 0;
  const showEmpty = view !== null && !loading && !failed && groups.length === 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <label
          htmlFor="trainee-exam-day"
          className="mb-1 block text-sm font-semibold text-muted-foreground"
        >
          תאריך
        </label>
        {/* A native day picker: it yields the exact YYYY-MM-DD token the
            committed reader expects, needs no calendar system of its own and
            loads exactly one day. */}
        <input
          id="trainee-exam-day"
          type="date"
          value={selectedDate}
          onChange={(event) => setSelectedDate(event.target.value)}
          className="w-full rounded-xl border border-border bg-background p-3 text-base text-card-foreground"
        />
      </div>

      {/* The two views of the SAME fetched day. Switching re-filters what is
          already in hand and issues no request, so it can neither widen the read
          nor reveal a row the server did not send. */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setMode("all")}
          className={`rounded-xl border p-3 text-center text-sm font-semibold ${
            mode === "all"
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-card text-card-foreground"
          }`}
        >
          {ALL_MODE_LABEL}
        </button>
        <button
          type="button"
          onClick={() => setMode("self")}
          className={`rounded-xl border p-3 text-center text-sm font-semibold ${
            mode === "self"
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-card text-card-foreground"
          }`}
        >
          {SELF_MODE_LABEL}
        </button>
      </div>

      {loading && <p className="text-base text-muted-foreground">{LOADING_TEXT}</p>}

      {!loading && failed && (
        <p className="rounded-2xl border border-border bg-card p-5 text-base text-muted-foreground">
          {ERROR_TEXT}
        </p>
      )}

      {showEmpty && (
        <p className="rounded-2xl border border-border bg-card p-5 text-base text-muted-foreground">
          {dayIsEmpty ? EMPTY_TEXT : NO_SELF_TEXT}
        </p>
      )}

      {!loading &&
        !failed &&
        groups.map((group) => (
          <div key={group.date} className="flex flex-col gap-2">
            <p className="text-base font-bold text-card-foreground">
              {formatHebrewWeekday(parseDateKey(group.date))} ·{" "}
              {formatHebrewDate(parseDateKey(group.date))}
            </p>

            {group.rows.map((row) => {
              const place = row.arena ?? row.location;
              const roleLabel = row.selfRole === null ? null : SELF_ROLE_LABELS[row.selfRole];
              return (
                <div
                  key={row.sessionId}
                  className={`rounded-2xl border bg-card p-4 shadow-sm ${
                    row.isSelf ? "border-primary ring-1 ring-primary" : "border-border"
                  }`}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-base font-bold text-card-foreground">
                      {row.definitionName ?? "מבחן"}
                    </p>
                    <p className="text-sm font-semibold text-muted-foreground">
                      {row.startTime}
                      {row.displayEndTime !== null && ` - ${row.displayEndTime}`}
                    </p>
                  </div>

                  {row.selfLabel !== null && (
                    <p className="mt-1 text-sm font-bold text-primary">
                      {row.selfLabel}
                      {roleLabel !== null && ` · ${roleLabel}`}
                    </p>
                  )}

                  {/* The viewer's EXACT personal window, and only when the
                      contract carries it. Nothing here falls back to the block
                      times above. */}
                  {row.selfStartTime !== null && (
                    <p className="text-sm font-bold text-primary">
                      השעה שלך: {row.selfStartTime}
                      {row.selfEndTime !== null && ` - ${row.selfEndTime}`}
                    </p>
                  )}

                  {place !== null && place.trim().length > 0 && (
                    <p className="mt-1 text-sm text-muted-foreground">מקום: {place}</p>
                  )}

                  <div className="mt-2 flex flex-col gap-1">
                    <PeopleLine
                      label="נבחנים"
                      names={row.examineeNames}
                      count={row.examineeCount}
                    />
                    <PeopleLine
                      label="חניכים מודרכים"
                      names={row.instructedTraineeNames}
                      count={row.instructedTraineeCount}
                    />
                  </div>

                  {/* The block's COMPLETE operational schedule, verbatim and in
                      the contract's own order. It is rendered identically in
                      both views — "לו״ז שלי" differs by which ROWS reach here,
                      never by what a row shows. An empty list renders nothing,
                      so a beginner row stays exactly as it was. */}
                  <ExamAssignmentRows assignments={row.assignments} />
                </div>
              );
            })}
          </div>
        ))}
    </div>
  );
}
