"use client";

import { useEffect, useState } from "react";
import { ExamAssignmentRows } from "@/lib/components/ExamAssignmentRows";
import { ExamBeginnerRows } from "@/lib/components/ExamBeginnerRows";
import { ExamDateTabs } from "@/lib/components/ExamDateTabs";
import { ExamPersonalAssignmentDetail } from "@/lib/components/ExamPersonalAssignmentDetail";
import {
  earliestExamDate,
  filterExamRows,
  isBeginnerExamRow,
  listExamDates,
  sortExamRowsByStartTime,
} from "@/lib/components/exam-schedule-view-core";
import {
  getTraineeExamSchedule,
  type TraineeExamScheduleView,
} from "@/lib/actions/trainee-exam-schedule";
import { formatHebrewDate, formatHebrewWeekday, parseDateKey } from "@/lib/dates";

/**
 * EX-TRAINEE-VIEW-MVP — the trainee "מבחנים" screen.
 *
 * READ-ONLY BY CONSTRUCTION. There is no form, no input, no submit, no publish
 * control, no supervisor control and no pairing control in this file, and none
 * may be added here: every exam WRITE surface is its own separately reviewed
 * slice. The only controls on the screen are which of the TWO views is open and,
 * inside the date view, which DATE of the already-fetched schedule is showing.
 *
 * THE SCHEDULE IS FETCHED ONCE (EX-TRAINEE-MULTIDAY-READ). The screen used to
 * hold a native date picker and re-read the server for every day a trainee
 * looked at, which made the date sub-tabs a list of exactly one date — the day
 * that had just been fetched. The committed reader now returns the trainee's
 * WHOLE published schedule in one load, so the picker is gone and the sub-tabs
 * are the plan's real dates. Choosing one narrows rows already in hand and
 * issues NO request.
 *
 * IT AUTHORIZES NOTHING, AND IT NAMES NOBODY. The single Server Action it calls
 * takes NO ARGUMENT AT ALL: the trainee's identity comes from the signed session
 * and their course from the committed non-selectable resolver, both server-side.
 * No student id, course id, plan id or date is derived, held or sent from the
 * browser, and there is no second course picker here for the same reason — this
 * screen has no course to pick. Removing the date argument makes that guarantee
 * strictly stronger than it was: there is no longer any caller-supplied value at
 * all.
 *
 * PUBLICATION IS FAIL-CLOSED UPSTREAM. An unpublished plan and an unpublished
 * lesson never reach this component at all; they arrive as the same EMPTY
 * contract as a denial. So the empty state is deliberately ONE neutral sentence
 * that does not say whether a schedule is missing, still a draft, or simply not
 * this trainee's to see. There is no draft toggle and no publication timestamp
 * on this screen.
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
 * number, and any diagnostic. There is no `JSON.stringify` and no generic object
 * renderer, so a field that is not spelled out below cannot appear on screen.
 *
 * NO INTERNAL IDENTIFIER IS EVEN AVAILABLE TO THIS SCREEN
 * (EX-TRAINEE-ID-CONTAINMENT). The trainee contract no longer carries one. The
 * row's `sessionId` and the beginner block's `sessionId`, `lessonId` and
 * `childAssignmentId` are GONE from the DTO — every one was a database primary
 * key, none was ever rendered, and the single mechanical use was a React list
 * key. That key is now the POSITIONAL `rowKey` the read layer assigns, which
 * addresses a position in a list this screen already holds and can be used to
 * query nothing. Nothing was substituted for the removed ids.
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
 * "לפי תאריך" is deliberately a COMPLETE operational schedule, not a
 * privacy-narrowed list of names: every visible STORED block renders its
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
 * LIVE BEGINNER ROWS ARE A SECOND KIND OF ROW (EX-BEGINNER-EXAM-UI)
 * ===========================================================================
 * A beginner row is a LIVE projection of a Teaching-Practice lesson. It has no
 * stored exam assignment at all, so handing it to the wave/examinee renderer
 * above produced an empty block — which is precisely why beginner entries were
 * invisible on this screen even when the server sent them.
 *
 * Both views therefore ROUTE on the contract's own `source` field: a beginner
 * row goes to `lib/components/ExamBeginnerRows`, the shared compact beginner
 * presentation, and NEVER into the advanced renderer. Its people are the
 * lesson's PARTICIPANTS — this screen invents no `EXAMINEE` and no
 * `INSTRUCTED_TRAINEE` to make them fit, and it does not print the advanced
 * participant summary over them either.
 *
 * THE COMMITTED VISIBILITY DECISION IS PRESERVED. Child, parent and phone detail
 * is carried to trainees by the read layer on purpose; this screen neither
 * widens it nor quietly hides it. Lesson notes and lesson publication state are
 * NOT on the trainee contract and are not requested here.
 *
 * ===========================================================================
 * THE TWO VIEWS ARE DELIBERATELY NOT THE SAME LAYOUT (EX-TRAINEE-DATE-NAV)
 * ===========================================================================
 * A TRAINEE HAS EXACTLY TWO VIEWS: "לפי תאריך" and "לו״ז שלי". The general
 * schedule and the by-exam-type schedule are GONE from this screen — a trainee
 * navigates a schedule by the day they are riding on, and an exam-type tab was
 * an axis nobody asked a trainee to think in. Neither label is rendered here and
 * neither control exists.
 *
 * "לפי תאריך" is the COMPLETE block schedule, narrowed to ONE date at a time by
 * compact sub-tabs — one per REAL date of the trainee's published plan. Those
 * are NOT further reads: the whole schedule is fetched once and the sub-tabs
 * narrow the array in the browser, so a selection can only ever show FEWER rows
 * than the contract carries, never a row the server withheld, and no date is
 * offered that the publication gates did not already clear. The selection
 * DEFAULTS SAFELY to the EARLIEST date the contract carries, so the screen never
 * opens on a date that holds nothing, and inside it blocks run by start time
 * ascending with the server's own order as the tie-break — live beginner rows
 * and stored blocks interleaved by that one rule.
 *
 * "לו״ז שלי" IS A DIFFERENT, MUCH SHORTER SCREEN. It used to render the entire
 * all-participants structure with the viewer's row merely ringed inside it,
 * which meant a trainee looking for their own horse read everyone else's first.
 * It renders only the rows that are the viewer's, and inside each only what
 * that trainee must act on: the exam name, the date and time, the place, their
 * role, their exact personal window, and — when the contract identifies their
 * own assignment unambiguously — their horse, topic, discipline and the ONE
 * person on the other side of the lesson. No wave, no other examinee, no
 * participant summary.
 *
 * "MINE" IS THE SERVER'S ANSWER, AT BOTH LEVELS. Which ROWS appear is
 * `view.myRows`, which the committed trainee core computed server-side from the
 * SIGNED SESSION and handed over as the row-level boolean `isSelf`; the row
 * keeps its ring, its "השיבוץ שלי" label, its role and its exact personal
 * window. Which ASSIGNMENT inside a row is the viewer's is the read layer's
 * answer too — the trainee contract marks it with an assignment-level `isSelf`,
 * decided by exact student-id equality against that same proven identity, with
 * the id never leaving the server. The screen passes the array through and reads
 * that one boolean.
 *
 * NO NAME IS EVER COMPARED to find "mine", and no role, time, horse, topic,
 * discipline, pairing or array position is used to guess it either. The screen
 * holds no name and no id of the viewer to compare with, and none was added to
 * the contract: `isSelf` is a boolean, not an identifier.
 *
 * STILL NOT CARRIED, and therefore still not stubbed here: any grade, any
 * feedback and any rating.
 */

const LOADING_TEXT = "טוען לוח מבחנים...";
const ERROR_TEXT = "לא ניתן לטעון כרגע את לוח המבחנים.";
/**
 * The ONE sentence that touches publication, and it is now about the SCHEDULE
 * rather than about a chosen day — because the screen no longer chooses one. It
 * still says nothing about WHY there is nothing to show: missing, still a draft
 * and not-this-trainee's are deliberately indistinguishable.
 */
const EMPTY_TEXT = "עדיין לא פורסם לוח מבחנים.";
/**
 * Shown ONLY when the schedule itself is published and visible but holds no row
 * of the viewer's own. It says nothing about publication, so it cannot be read
 * as an answer to "is there a schedule" — that question is EMPTY_TEXT's alone.
 */
const NO_SELF_TEXT = "אין לך שיבוץ למבחן.";
/**
 * Shown ONLY inside "לפי תאריך", when the schedule IS visible and holds rows but
 * the selected date holds none of them. Like {@link NO_SELF_TEXT} it says
 * nothing about publication, so it can never stand in for {@link EMPTY_TEXT}.
 */
const NO_MATCHING_ROWS_TEXT = "אין מבחנים בתצוגה שנבחרה.";

/**
 * THE TWO TRAINEE VIEWS, and the only two. There is deliberately no general
 * schedule label and no by-exam-type label anywhere in this file — not in code
 * and not in a comment — so neither can be rendered and neither can be revived
 * by uncommenting: a trainee is offered a date and their own schedule, and
 * nothing else.
 */
const DATE_MODE_LABEL = "לפי תאריך";
const SELF_MODE_LABEL = "לו״ז שלי";

type ExamRow = TraineeExamScheduleView["allRows"][number];
type DayMode = "date" | "self";

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
  const [mode, setMode] = useState<DayMode>("date");
  const [view, setView] = useState<TraineeExamScheduleView | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  // The DATE sub-tab inside "לפי תאריך", over the schedule already in hand. It
  // issues no request and can name no row the server did not send. `null` means
  // "no explicit choice yet", which resolves to the EARLIEST date below — it is
  // never rendered as "no date selected".
  const [navDate, setNavDate] = useState<string | null>(null);

  useEffect(() => {
    // ONE LOAD, ON MOUNT, AND NEVER AGAIN. The dependency list is EMPTY: no view
    // selection, no date and no state of any kind can re-enter this effect, so
    // navigating the schedule provably issues no second request.
    let cancelled = false;
    getTraineeExamSchedule()
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
  }, []);

  const allRows = view === null ? [] : view.allRows;
  const myRows = view === null ? [] : view.myRows;
  // The date sub-tabs are the REAL dates of the loaded schedule, so a date is
  // offered only when the server sent something on it — a day the publication
  // gates hid is not among them and cannot be asked for.
  const dates = listExamDates(allRows);
  /**
   * THE SELECTED DATE, chosen SAFELY.
   *
   * An explicit choice is honoured only while it is still one of the dates the
   * contract carries; anything else — no choice yet, or a choice left over from
   * a contract that no longer holds it — falls back to the EARLIEST date. There
   * is no "all dates" state to fall into, so the view can never widen itself by
   * losing its selection, and it can never point at a date that holds no rows.
   */
  const activeDate =
    navDate !== null && dates.includes(navDate) ? navDate : earliestExamDate(dates);
  // ONE date, and the exam-type axis is not merely unselected here — it does not
  // exist on this screen at all.
  const filteredRows = filterExamRows(allRows, {
    definitionName: null,
    date: activeDate,
  });
  const groups = groupRowsByDate(sortExamRowsByStartTime(filteredRows));
  const scheduleIsEmpty = view !== null && view.allRows.length === 0;
  // Each view answers for itself: the personal view by its own rows, the date
  // view by the rows its selected date left standing.
  const showEmpty =
    view !== null &&
    !loading &&
    !failed &&
    (mode === "self" ? myRows.length === 0 : groups.length === 0);
  /**
   * WHICH sentence, and never a broader claim than the one this view can make.
   * "The schedule is empty" is the ONLY answer that touches publication, and it
   * is reachable from both views because it is true of the whole contract.
   */
  const emptyText = scheduleIsEmpty
    ? EMPTY_TEXT
    : mode === "self"
      ? NO_SELF_TEXT
      : NO_MATCHING_ROWS_TEXT;

  return (
    <div className="flex flex-col gap-4">
      {/* THE TWO views of the SAME fetched schedule, and the only two. Switching
          re-filters what is already in hand and issues no request, so it can
          neither widen the read nor reveal a row the server did not send. */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setMode("date")}
          className={`rounded-xl border p-3 text-center text-sm font-semibold ${
            mode === "date"
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-card text-card-foreground"
          }`}
        >
          {DATE_MODE_LABEL}
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

      {/* The DATE sub-tabs — one per REAL date of the loaded schedule — inside
          "לפי תאריך" only: the personal view is already the shortest list on
          the screen and has nothing to narrow. */}
      {!loading && !failed && mode === "date" && !scheduleIsEmpty && (
        <ExamDateTabs dates={dates} selectedDate={activeDate} onSelectDate={setNavDate} />
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
          "לפי תאריך", one tap away, and reprinting it here is exactly what made
          the old personal view unreadable.

          A BEGINNER ROW IS HERE FOR THE SAME REASON EVERY OTHER ROW IS: the
          SERVER put it in `myRows`. `myRows` is exactly `allRows.filter(isSelf)`
          from the committed trainee core, which marked the row from the signed
          session's own student id — so relevance is the read layer's answer for
          a live Teaching-Practice lesson exactly as it is for a stored block,
          and no matching of any kind is performed in this file.

          IT SPANS EVERY DATE, and it is rendered in the SERVER's own order:
          dates ascending, then each date's rows in the projection's locked
          within-date order. It is deliberately NOT re-sorted here — the
          start-time sort belongs to a single date's rows, and applying it
          across dates would rank a 08:00 block in December above a 09:00 one
          today. Each card therefore prints its own date, because this list is
          not about one day.
          =================================================================== */}
      {!loading &&
        !failed &&
        mode === "self" &&
        myRows.map((row) => {
          const place = row.arena ?? row.location;
          // A live beginner lesson has no exam ROLE. The contract still carries
          // `selfRole` for it, and printing that label here would tell a trainee
          // they are a "נבחן" on a Teaching-Practice lesson — an advanced role
          // this screen would have invented. The row's own banner says what it
          // actually is instead.
          const roleLabel =
            isBeginnerExamRow(row) || row.selfRole === null
              ? null
              : SELF_ROLE_LABELS[row.selfRole];
          return (
            <div
              key={row.rowKey}
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

              {/* ROUTED BY THE CONTRACT'S OWN `source`.

                  A live beginner row carries an EMPTY assignment array by
                  construction, so the personal-detail renderer below has
                  nothing to find in it and would print a blank card — which is
                  exactly why beginner entries were invisible here. It gets the
                  dedicated compact beginner presentation instead, with the full
                  detail the read layer chose to carry to trainees.

                  The viewer's OWN horse, topic, discipline and counterpart on a
                  STORED block. The rows carry the SERVER's own `isSelf` marker,
                  so the whole array is handed over verbatim and the renderer
                  reads exactly one boolean to find the viewer — this screen
                  passes no marker, no role and no time to select with. */}
              {isBeginnerExamRow(row) ? (
                <ExamBeginnerRows detail={row.beginner} />
              ) : (
                <ExamPersonalAssignmentDetail assignments={row.assignments} />
              )}
            </div>
          );
        })}

      {!loading &&
        !failed &&
        mode === "date" &&
        groups.map((group) => (
          <div key={group.date} className="flex flex-col gap-2">
            <p className="text-base font-bold text-card-foreground">
              {formatHebrewWeekday(parseDateKey(group.date))} ·{" "}
              {formatHebrewDate(parseDateKey(group.date))}
            </p>

            {group.rows.map((row) => {
              const place = row.arena ?? row.location;
              // A live beginner lesson has no exam ROLE — see the same rule in
              // the personal view above.
              const roleLabel =
                isBeginnerExamRow(row) || row.selfRole === null
                  ? null
                  : SELF_ROLE_LABELS[row.selfRole];
              return (
                <div
                  key={row.rowKey}
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

                  {/* ROUTED BY THE CONTRACT'S OWN `source`, and nothing else.

                      A LIVE BEGINNER ROW gets the dedicated compact beginner
                      presentation and is NEVER handed to the advanced
                      wave/examinee renderer: it carries no stored assignment,
                      so that renderer draws nothing at all, which is exactly
                      how beginner entries came to be invisible here. It gets no
                      advanced participant summary either — a beginner lesson
                      has no "נבחנים" and no "חניכים מודרכים", and labelling its
                      people as either would be a role this screen invented.

                      A STORED BLOCK keeps both, unchanged: the participant
                      SUMMARY only where it is the only place those names
                      appear, and the block's COMPLETE operational schedule
                      verbatim and in the contract's own order — waves,
                      examinee units and the trainee each one teaches. */}
                  {isBeginnerExamRow(row) ? (
                    <ExamBeginnerRows detail={row.beginner} />
                  ) : (
                    <>
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
                      <ExamAssignmentRows assignments={row.assignments} />
                    </>
                  )}
                </div>
              );
            })}
          </div>
        ))}
    </div>
  );
}
