"use client";

import { useEffect, useState } from "react";
import { InstructorScheduleCourseSelector } from "@/app/instructor/InstructorScheduleCourseSelector";
import { ExamAssignmentRows } from "@/lib/components/ExamAssignmentRows";
import { ExamBeginnerRows } from "@/lib/components/ExamBeginnerRows";
import {
  ExamScheduleNav,
  type ExamScheduleNavMode,
} from "@/lib/components/ExamScheduleNav";
import {
  filterExamRows,
  isBeginnerExamRow,
  listExamDates,
  listExamDefinitionNames,
  sortExamRowsByStartTime,
} from "@/lib/components/exam-schedule-view-core";
import {
  getInstructorExamSchedule,
  type InstructorExamScheduleView,
} from "@/lib/actions/instructor-exam-schedule";
import { formatHebrewDate, formatHebrewWeekday, parseDateKey } from "@/lib/dates";

/**
 * EX-INST-VIEW-MVP — the instructor "מבחנים" screen.
 *
 * READ-ONLY BY CONSTRUCTION. There is no form, no input, no submit, no
 * publish/unpublish control, no supervisor control and no pairing control in
 * this file, and none may be added here: every exam WRITE surface is its own
 * separately reviewed slice. The only thing this component does is ASK for one
 * course offering's exam schedule and lay the returned contract out.
 *
 * IT AUTHORIZES NOTHING. The selected course id is a REQUEST: the single Server
 * Action it calls hands that id to the committed instructor exam reader, which
 * proves an ACTIVE instructor session from the signed cookie and re-authorizes
 * the offering server-side before any query runs. A denial comes back as the
 * uniform EMPTY contract, which renders exactly like a course that genuinely has
 * no plan — so nothing on this screen reveals whether an offering exists.
 *
 * THE COURSE PICKER IS THE EXISTING ONE. It mounts the shared
 * InstructorScheduleCourseSelector rather than introducing a second menu: that
 * component owns the server-composed option list, selects nothing by itself, and
 * knows no offering id of its own. The SELECTION is screen-local, exactly as it
 * is for the schedule surfaces — this screen cannot move theirs and they cannot
 * move this one.
 *
 * ===========================================================================
 * PRIVACY: ONLY APPROVED DISPLAY VALUES ARE RENDERED
 * ===========================================================================
 * The contract this screen receives is already role-narrowed server-side, but
 * narrowing is not licence to print everything in it. Rendered here: the date,
 * the exam definition's name, the start time, the calculated end time, the
 * arena or lesson location, the examinee / instructed-trainee / supervisor
 * DISPLAY NAMES with their authoritative counts, the timetable status, and the
 * canonical Hebrew operational messages.
 *
 * NOT rendered, deliberately: the plan id, any session/definition/assignment/
 * lesson id, any student or instructor id, any national id, e-mail or phone
 * number, any beginner child's name or PARENT CONTACT detail, and any raw
 * diagnostics object. `sessionId` appears in this file for exactly two purposes
 * — as a React list key, which never reaches the DOM, and as the exact key used
 * to attach a block's own operational messages — and is never placed in a
 * rendered position. There is no `JSON.stringify` and no generic object
 * renderer, so a field that is not spelled out below cannot appear on screen.
 *
 * ===========================================================================
 * THE COMPLETE OPERATIONAL SCHEDULE (EX-ROLE-OP-UI-MVP)
 * ===========================================================================
 * The read pipeline now hands every visible block its assignment-level rows —
 * who is in it, in which role, at exactly which minutes, on which horse, on
 * which topic and discipline, and paired with whom. They are rendered by the ONE
 * shared renderer, `lib/components/ExamAssignmentRows`, which the trainee screen
 * mounts too: the contract is the same for both roles, so the layout is one file
 * rather than two copies that could drift apart.
 *
 * NOTHING ABOUT THEM IS DECIDED HERE. This screen passes `row.assignments`
 * straight through, in the order it arrived. There is no pairing rule, no
 * timetable arithmetic and no sort in this file or in that renderer — every one
 * of those values arrives already decided by the committed cores.
 *
 * STILL NOT CARRIED, and therefore still not stubbed here: any grade, any
 * feedback and any rating. None is labelled "—" or given an empty row, because
 * inventing a placeholder would tell an instructor that a value exists and is
 * blank, when in truth this read does not carry it at all.
 *
 * ===========================================================================
 * CONNECTED VIEWS (EX-ROLE-SCHEDULE-REDESIGN)
 * ===========================================================================
 * The screen offers three views of ONE loaded schedule: the general לו״ז כללי,
 * a view per exam type, and a view per date. They are NOT three reads. The
 * course's schedule is fetched exactly once, and the shared navigation bar
 * narrows the array already in hand — so a view can only ever show FEWER rows
 * than the general one, never a row the server withheld, and switching views
 * issues no request at all. The option lists themselves are derived from the
 * loaded rows by the pure view core, so a view exists only when there is data
 * behind it.
 *
 * THE PARTICIPANT SUMMARY IS NOT PRINTED TWICE. A block whose operational rows
 * are rendered below already names every examinee and every instructed trainee,
 * in their waves and with their horses; repeating those same names in a summary
 * line above them is noise that makes a schedule longer without making it say
 * anything more. The summary therefore survives ONLY on a STORED block that
 * carries no operational rows, where it is the only place those names appear at
 * all. Supervisors are never in the operational rows, so their line always
 * stands.
 *
 * ===========================================================================
 * THE GENERAL/ALL VIEW IS A TIMETABLE, NOT A ROSTER (EX-INST-GENERAL-OVERVIEW-ONLY)
 * ===========================================================================
 * `לו״ז כללי` (navMode === "all") mirrors the admin general view: date, time,
 * exam type/name and arena/location only. No examinee, no instructed trainee, no
 * supervisor, no assignment, no horse, no topic and no self/role marker is
 * rendered while it is open — that detail is exclusive to the by-type and
 * by-date views, which are otherwise byte-for-byte unchanged. This is a VIEW-
 * LAYER filter of rows already loaded and already authorized; no reader, DTO or
 * query is touched, and switching to a grouped view issues no request.
 *
 * ===========================================================================
 * LIVE BEGINNER ROWS ARE A SECOND KIND OF ROW (EX-BEGINNER-EXAM-UI)
 * ===========================================================================
 * A beginner row is a LIVE projection of a Teaching-Practice lesson: no stored
 * exam assignment, no exam definition, no computed timetable. Handing one to the
 * wave/examinee renderer above therefore produced an empty block — which is
 * exactly why beginner entries were invisible on this screen even when the
 * server sent them, and why the advanced participant summary above them was
 * calling a beginner lesson's people "נבחנים", a role nobody assigned them.
 *
 * The screen now ROUTES on the contract's own `source` field: a beginner row
 * goes to `lib/components/ExamBeginnerRows`, the shared compact beginner
 * presentation the trainee screen mounts too, and NEVER into the advanced
 * renderer. It is shown in the SAME date/type navigation and interleaved
 * chronologically with the advanced blocks by block start time, because an
 * instructor runs one day, not two schedules.
 *
 * IT STAYS READ-ONLY. Teaching Practice remains the authoritative source: there
 * is no beginner writer, no lesson edit control and no second request here — the
 * detail rendered is the one this screen already fetched.
 */

const LOADING_TEXT = "טוען לוח מבחנים...";
const ERROR_TEXT = "לא ניתן לטעון כרגע את לוח המבחנים.";
const EMPTY_TEXT = "אין עדיין לוח מבחנים לקורס זה.";
const NO_COURSE_TEXT = "יש לבחור קורס כדי לראות את לוח המבחנים";
/**
 * Shown ONLY when the course HAS a schedule and the CHOSEN VIEW holds none of
 * it. It says nothing about whether a plan exists, so it can never stand in for
 * {@link EMPTY_TEXT} — that question is that sentence's alone.
 */
const NO_MATCHING_ROWS_TEXT = "אין מבחנים בתצוגה שנבחרה.";

/**
 * EX-C2-0-SUSPEND-UI — TEMPORARY static placeholder dates.
 *
 * The live BEGINNER Teaching-Practice projection is suspended from THIS screen
 * only, for these two fixed dates. Nothing upstream (reader/adapter/DTO) is
 * touched, and nothing here is a permanent product rule.
 */
const BEGINNER_PLACEHOLDER_DATE_A = "2026-08-02";
const BEGINNER_PLACEHOLDER_DATE_B = "2026-08-03";

type ExamRow = InstructorExamScheduleView["rows"][number];

/** The Hebrew label for a block's timetable state. Absent state shows nothing. */
const TIMETABLE_STATUS_LABELS: Record<string, string> = {
  OK: "הלוח חושב",
  UNRESOLVED: "לא ניתן לחשב את הלוח",
  NOT_APPLICABLE: "אין לוח מחושב",
};

/**
 * The canonical Hebrew operational messages for ONE block.
 *
 * Attaches by EXACT session id, exactly as the server contract keys them, and
 * takes only each diagnostic's `message` — never its code, and never the
 * session/definition/assignment ids that sit beside it.
 */
function operationalMessagesFor(
  view: InstructorExamScheduleView,
  sessionId: string,
): string[] {
  const messages: string[] = [];
  for (const block of view.diagnostics.storedBlockDiagnostics) {
    if (block.sessionId !== sessionId) continue;
    for (const issue of block.timetableIssues) messages.push(issue.message);
    for (const warning of block.timetableWarnings) messages.push(warning.message);
  }
  return messages;
}

/** Group the rows by calendar day, preserving the server's row order exactly. */
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

/**
 * EX-C2-0-SUSPEND-UI — a TEMPORARY static informational card.
 *
 * Pure static text: no fetched data, no row, no assignment, no child, no
 * parent, no phone and no id of any kind. Three fixed lines, in the same
 * outer card style already used by every other row on this screen.
 */
function BeginnerPlaceholderCard({
  title,
  dateLabel,
  timeLabel,
}: {
  title: string;
  dateLabel: string;
  timeLabel: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <p className="text-base font-bold text-card-foreground">{title}</p>
      <p className="text-xs text-muted-foreground">{dateLabel}</p>
      <p className="text-sm font-semibold text-muted-foreground">{timeLabel}</p>
    </div>
  );
}

const GENERAL_VIEW_LABEL = "לו״ז כללי";
/**
 * EX-INST-GENERAL-OVERVIEW-ONLY — the general/all view is a TIMETABLE, exactly
 * like the admin general view. It never carries an examinee, an instructed
 * trainee, a supervisor, a horse, a topic or a self/role marker; those live
 * only in the by-type and by-date views below.
 */
const GENERAL_VIEW_READ_ONLY_TEXT =
  "לו״ז כללי הוא תצוגת מבנה בלבד. לפרטי משתתפים יש לעבור ללפי תאריך או ללפי סוג מבחן.";

export function InstructorExamsSection() {
  const [selectedOfferingId, setSelectedOfferingId] = useState<string | null>(null);
  const [view, setView] = useState<InstructorExamScheduleView | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  // The connected views. All three read the SAME `view` above; none of them is a
  // second request, and none of them can name a row the server did not send.
  const [navMode, setNavMode] = useState<ExamScheduleNavMode>("all");
  const [navDefinitionName, setNavDefinitionName] = useState<string | null>(null);
  const [navDate, setNavDate] = useState<string | null>(null);

  useEffect(() => {
    // A new course means the previous course's exam types and dates no longer
    // exist: the view returns to the general one rather than staying pointed at
    // a selection that is now meaningless.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNavMode("all");
    setNavDefinitionName(null);
    setNavDate(null);
    if (selectedOfferingId === null) {
      setView(null);
      setFailed(false);
      setLoading(false);
      return;
    }
    let cancelled = false;
    // The previous course's schedule is dropped BEFORE the request goes out, so
    // no row from another course can stay on screen while this load is in
    // flight.
    setView(null);
    setFailed(false);
    setLoading(true);
    getInstructorExamSchedule(selectedOfferingId)
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
  }, [selectedOfferingId]);

  const allRows = view === null ? [] : view.rows;
  // The option lists are derived from THE LOADED ROWS, so a view is offered only
  // when there is something behind it.
  const definitionNames = listExamDefinitionNames(allRows);
  const dates = listExamDates(allRows);
  // The general view is both axes unconstrained — not a third code path.
  const visibleRows = filterExamRows(allRows, {
    definitionName: navMode === "type" ? navDefinitionName : null,
    date: navMode === "date" ? navDate : null,
  }).filter((entry) => !isBeginnerExamRow(entry));
  const groups = groupRowsByDate(visibleRows);
  // "Is there a schedule at all" is answered by the LOADED rows, never by the
  // filtered ones: a narrowed view that happens to be empty must not read as a
  // course with no exam plan.
  const hasPlan = view !== null && view.planId !== null && allRows.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <InstructorScheduleCourseSelector
        selectedOfferingId={selectedOfferingId}
        onSelectOffering={setSelectedOfferingId}
      />

      {selectedOfferingId === null && (
        <p className="rounded-2xl border border-border bg-card p-5 text-base text-muted-foreground">
          {NO_COURSE_TEXT}
        </p>
      )}

      {selectedOfferingId !== null && loading && (
        <p className="text-base text-muted-foreground">{LOADING_TEXT}</p>
      )}

      {selectedOfferingId !== null && !loading && failed && (
        <p className="rounded-2xl border border-border bg-card p-5 text-base text-muted-foreground">
          {ERROR_TEXT}
        </p>
      )}

      {selectedOfferingId !== null && !loading && !failed && !hasPlan && (
        <p className="rounded-2xl border border-border bg-card p-5 text-base text-muted-foreground">
          {EMPTY_TEXT}
        </p>
      )}

      {view !== null && hasPlan && (
        <>
          {/* Plan-level publication state. An instructor may view a DRAFT plan —
              that is the committed policy — so the screen says which one is on
              it rather than letting a draft read as a final schedule. It is a
              LABEL, not a control: nothing here publishes or unpublishes. */}
          <p className="text-sm font-semibold text-muted-foreground">
            {view.isPublished ? "לוח מבחנים מפורסם" : "לוח מבחנים בטיוטה"}
          </p>

          {/* The three connected views over the SAME loaded schedule. */}
          <ExamScheduleNav
            allLabel={GENERAL_VIEW_LABEL}
            mode={navMode}
            onSelectMode={setNavMode}
            definitionNames={definitionNames}
            selectedDefinitionName={navDefinitionName}
            onSelectDefinitionName={setNavDefinitionName}
            dates={dates}
            selectedDate={navDate}
            onSelectDate={setNavDate}
          />

          {/* EX-INST-GENERAL-OVERVIEW-ONLY — shown only in the general/all
              view, which the block below renders as structure only. */}
          {navMode === "all" && (
            <p className="text-xs leading-relaxed text-muted-foreground">
              {GENERAL_VIEW_READ_ONLY_TEXT}
            </p>
          )}

          {/* A NARROWED view with nothing in it says exactly that, and never
              borrows the "this course has no exam plan" sentence above. */}
          {groups.length === 0 && (
            <p className="rounded-2xl border border-border bg-card p-5 text-base text-muted-foreground">
              {NO_MATCHING_ROWS_TEXT}
            </p>
          )}

          {groups.map((group) => (
            <div key={group.date} className="flex flex-col gap-2">
              <p className="text-base font-bold text-card-foreground">
                {formatHebrewWeekday(parseDateKey(group.date))} ·{" "}
                {formatHebrewDate(parseDateKey(group.date))}
              </p>

              {/* CHRONOLOGICAL, across BOTH kinds of row. Live beginner rows and
                  stored blocks are ordered by the same one rule — block start
                  time ascending, with the server's own order as the tie-break —
                  so a beginner lesson sits where it actually happens in the day
                  rather than in a section of its own. */}
              {sortExamRowsByStartTime(group.rows).map((row) => {
                const place = row.arena ?? row.location;
                const statusLabel =
                  row.timetableStatus === null
                    ? null
                    : (TIMETABLE_STATUS_LABELS[row.timetableStatus] ?? null);
                const messages = operationalMessagesFor(view, row.sessionId);
                return (
                  <div
                    key={row.sessionId}
                    className="rounded-2xl border border-border bg-card p-4 shadow-sm"
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

                    {place !== null && place.trim().length > 0 && (
                      <p className="mt-1 text-sm text-muted-foreground">מקום: {place}</p>
                    )}

                    {/* EX-INST-GENERAL-OVERVIEW-ONLY — every participant-level
                        block below (names, assignments, horses, topics, self/
                        role markers) is shown ONLY in the by-type and by-date
                        views. The general/all view (navMode === "all") stops
                        at the block facts above: date, time, type and place. */}
                    {navMode !== "all" && (
                      <>
                        <div className="mt-2 flex flex-col gap-1">
                          {/* The participant SUMMARY, and only where it is the only
                              place those names appear. A block with operational
                              rows names everyone below, in their waves and with
                              their horses, so printing the same names again here
                              would be pure repetition — and a LIVE BEGINNER row has
                              no examinee and no instructed trainee at all, so
                              printing its people under those two labels would be
                              two exam roles this screen invented. */}
                          {!isBeginnerExamRow(row) && row.assignments.length === 0 && (
                            <>
                              <PeopleLine
                                label="נבחנים"
                                names={row.examineeNames}
                                count={row.examineeCount}
                              />
                              <PeopleLine
                                label="חניכים מדריכים"
                                names={row.instructedTraineeNames}
                                count={row.instructedTraineeCount}
                              />
                            </>
                          )}
                          {/* Supervisors are never in the operational rows, so their
                              line is never a duplicate and always stands. */}
                          <PeopleLine
                            label="משגיחים"
                            names={row.supervisorNames}
                            count={row.supervisorCount}
                          />
                        </div>

                        {/* ROUTED BY THE CONTRACT'S OWN `source`.

                            A LIVE BEGINNER ROW gets the dedicated compact beginner
                            presentation — its source, its format, its group, its
                            responsible instructor, its participants and the full
                            operational child detail — and is NEVER handed to the
                            advanced wave/examinee renderer, which has no stored
                            assignment to draw and would print nothing.

                            A STORED BLOCK keeps its COMPLETE operational schedule,
                            verbatim and in the contract's own order. An empty list
                            renders nothing, so a stored block with no assignment
                            stays exactly as it was. */}
                        {isBeginnerExamRow(row) ? (
                          <ExamBeginnerRows detail={row.beginner} showOperationalDetail />
                        ) : (
                          <ExamAssignmentRows assignments={row.assignments} />
                        )}

                        {/* EX-INST-GENERAL-OVERVIEW-ONLY — the computed-timetable
                            status and its operational messages are diagnostics
                            about the assignment-level rows above; they belong to
                            the SAME by-type/by-date-only guard, not the general
                            timetable-facts view. */}
                        {statusLabel !== null && (
                          <p className="mt-2 text-xs text-muted-foreground">{statusLabel}</p>
                        )}

                        {messages.map((message) => (
                          <p key={message} className="mt-1 text-xs text-warning">
                            {message}
                          </p>
                        ))}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ))}

          {/* EX-C2-0-SUSPEND-UI — TEMPORARY static informational cards, shown
              only in the "by date" view, only for the matching selected date.
              Never in the general or by-type view. Pure static text, no
              fetched data. */}
          {navMode === "date" && navDate === BEGINNER_PLACEHOLDER_DATE_A && (
            <BeginnerPlaceholderCard
              title="הדרכות מתחילים — קבוצה א"
              dateLabel="יום ראשון, 2.8.2026"
              timeLabel="16:00–19:30"
            />
          )}
          {navMode === "date" && navDate === BEGINNER_PLACEHOLDER_DATE_B && (
            <BeginnerPlaceholderCard
              title="הדרכות מתחילים — קבוצה ב"
              dateLabel="יום שני, 3.8.2026"
              timeLabel="16:00–19:30"
            />
          )}
        </>
      )}
    </div>
  );
}
