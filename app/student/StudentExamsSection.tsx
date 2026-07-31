"use client";

import { useEffect, useState } from "react";
import { ExamAssignmentRows } from "@/lib/components/ExamAssignmentRows";
import { ExamPersonalAssignmentDetail } from "@/lib/components/ExamPersonalAssignmentDetail";
import { ExamScheduleNav, type ExamScheduleNavMode } from "@/lib/components/ExamScheduleNav";
import {
  filterExamRows,
  listExamDates,
  listExamDefinitionNames,
} from "@/lib/components/exam-schedule-view-core";
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
 * ===========================================================================
 * THE TWO VIEWS ARE DELIBERATELY NOT THE SAME LAYOUT (EX-ROLE-SCHEDULE-REDESIGN)
 * ===========================================================================
 * "לו״ז כולם" stays the COMPLETE block schedule, now with compact navigation
 * over the day already in hand: everything, by exam type, or by date. Those are
 * NOT three reads — the day is fetched once and the shared navigation bar
 * narrows the array in the browser, so a view can only ever show FEWER rows than
 * "everything", never a row the server withheld.
 *
 * "לו״ז שלי" IS A DIFFERENT, MUCH SHORTER SCREEN. It used to render the entire
 * all-participants structure with the viewer's row merely ringed inside it,
 * which meant a trainee looking for their own horse read everyone else's first.
 * It now renders only the rows that are the viewer's, and inside each only what
 * that trainee must act on: the exam name, the date and time, the place, their
 * role, their exact personal window, and — when the contract identifies their
 * own assignment unambiguously — their horse, topic, discipline and the ONE
 * person on the other side of the lesson. No wave, no other examinee, no
 * participant summary.
 *
 * "MINE" IS STILL THE SERVER'S ANSWER. Which rows appear is `view.myRows`, which
 * the committed trainee core computed server-side from the SIGNED SESSION and
 * handed over as the boolean `isSelf`; the row keeps its ring, its "השיבוץ שלי"
 * label, its role and its exact personal window. The viewer's own assignment
 * DETAIL is located by those same server-derived markers through the pure core,
 * which refuses to answer when they do not identify exactly one row — so a
 * parallel pair can never show a rider someone else's horse. NO NAME IS EVER
 * COMPARED to find "mine": the screen holds no name of the viewer to compare
 * with, and adding an id to the contract just to highlight a line is exactly
 * what the contract refuses.
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
/**
 * Shown ONLY inside "לו״ז כולם", when the day IS visible and holds rows but the
 * chosen exam type or date holds none of them. Like {@link NO_SELF_TEXT} it says
 * nothing about publication, so it can never stand in for {@link EMPTY_TEXT}.
 */
const NO_MATCHING_ROWS_TEXT = "אין מבחנים בתצוגה שנבחרה.";

const ALL_MODE_LABEL = "לו״ז כולם";
const SELF_MODE_LABEL = "לו״ז שלי";
/** The general option inside "לו״ז כולם": no exam type and no date constraint. */
const ALL_FILTER_LABEL = "הכל";

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
  // Navigation INSIDE "לו״ז כולם", over the day already in hand. It issues no
  // request and can name no row the server did not send.
  const [navMode, setNavMode] = useState<ExamScheduleNavMode>("all");
  const [navDefinitionName, setNavDefinitionName] = useState<string | null>(null);
  const [navDate, setNavDate] = useState<string | null>(null);

  useEffect(() => {
    // A new day means the previous day's exam types and dates no longer exist:
    // the view returns to the general one rather than staying pointed at a
    // selection that is now meaningless.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNavMode("all");
    setNavDefinitionName(null);
    setNavDate(null);
    if (selectedDate === "") {
      // A cleared picker asks for no day at all.
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

  const allRows = view === null ? [] : view.allRows;
  const myRows = view === null ? [] : view.myRows;
  // The option lists are derived from THE LOADED DAY, so a view is offered only
  // when there is something behind it.
  const definitionNames = listExamDefinitionNames(allRows);
  const dates = listExamDates(allRows);
  // "הכל" is both axes unconstrained — not a third code path.
  const filteredRows = filterExamRows(allRows, {
    definitionName: navMode === "type" ? navDefinitionName : null,
    date: navMode === "date" ? navDate : null,
  });
  const groups = groupRowsByDate(filteredRows);
  const dayIsEmpty = view !== null && view.allRows.length === 0;
  // Each view answers for itself: the personal view by its own rows, the
  // everyone view by the rows its navigation left standing.
  const showEmpty =
    view !== null &&
    !loading &&
    !failed &&
    (mode === "self" ? myRows.length === 0 : groups.length === 0);
  /**
   * WHICH sentence, and never a broader claim than the one this view can make.
   * "The day is empty" is the ONLY answer that touches publication, and it is
   * reachable from both views because it is true of the whole day.
   */
  const emptyText = dayIsEmpty
    ? EMPTY_TEXT
    : mode === "self"
      ? NO_SELF_TEXT
      : NO_MATCHING_ROWS_TEXT;

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

      {/* Navigation INSIDE "לו״ז כולם" only: the personal view is already the
          shortest list on the screen and has nothing to narrow. */}
      {!loading && !failed && mode === "all" && !dayIsEmpty && (
        <ExamScheduleNav
          allLabel={ALL_FILTER_LABEL}
          mode={navMode}
          onSelectMode={setNavMode}
          definitionNames={definitionNames}
          selectedDefinitionName={navDefinitionName}
          onSelectDefinitionName={setNavDefinitionName}
          dates={dates}
          selectedDate={navDate}
          onSelectDate={setNavDate}
        />
      )}

      {showEmpty && (
        <p className="rounded-2xl border border-border bg-card p-5 text-base text-muted-foreground">
          {emptyText}
        </p>
      )}

      {/* ===================================================================
          "לו״ז שלי" — the COMPACT personal view.

          Only the viewer's own rows, and inside each only what that trainee
          must act on. It deliberately renders NO participant summary, NO wave
          and NO other examinee: the all-participants structure lives in
          "לו״ז כולם", one tap away, and reprinting it here is exactly what made
          the old personal view unreadable.
          =================================================================== */}
      {!loading &&
        !failed &&
        mode === "self" &&
        myRows.map((row) => {
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

              <p className="text-xs text-muted-foreground">
                {formatHebrewWeekday(parseDateKey(row.date))} ·{" "}
                {formatHebrewDate(parseDateKey(row.date))}
              </p>

              {row.selfLabel !== null && (
                <p className="mt-1 text-sm font-bold text-primary">
                  {row.selfLabel}
                  {roleLabel !== null && ` · ${roleLabel}`}
                </p>
              )}

              {/* The viewer's EXACT personal window, and only when the contract
                  carries it. Nothing here falls back to the block times above. */}
              {row.selfStartTime !== null && (
                <p className="text-sm font-bold text-primary">
                  השעה שלך: {row.selfStartTime}
                  {row.selfEndTime !== null && ` - ${row.selfEndTime}`}
                </p>
              )}

              {place !== null && place.trim().length > 0 && (
                <p className="mt-1 text-sm text-muted-foreground">מקום: {place}</p>
              )}

              {/* The viewer's OWN horse, topic, discipline and counterpart —
                  located by the server-derived markers alone, and rendered only
                  when they identify exactly one assignment. */}
              <ExamPersonalAssignmentDetail
                assignments={row.assignments}
                role={row.selfRole}
                startTime={row.selfStartTime}
                endTime={row.selfEndTime}
              />
            </div>
          );
        })}

      {!loading &&
        !failed &&
        mode === "all" &&
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

                  {/* The participant SUMMARY, and only where it is the only
                      place those names appear. A block with operational rows
                      names everyone below, in their waves and with their
                      horses, so printing the same names again here would be
                      pure repetition. */}
                  {row.assignments.length === 0 && (
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
                  )}

                  {/* The block's COMPLETE operational schedule, verbatim and in
                      the contract's own order — waves, examinee units and the
                      trainee each one teaches. An empty list renders nothing,
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
