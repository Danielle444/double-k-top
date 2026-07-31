"use client";

import { useEffect, useState } from "react";
import { InstructorScheduleCourseSelector } from "@/app/instructor/InstructorScheduleCourseSelector";
import { ExamAssignmentRows } from "@/lib/components/ExamAssignmentRows";
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
 */

const LOADING_TEXT = "טוען לוח מבחנים...";
const ERROR_TEXT = "לא ניתן לטעון כרגע את לוח המבחנים.";
const EMPTY_TEXT = "אין עדיין לוח מבחנים לקורס זה.";
const NO_COURSE_TEXT = "יש לבחור קורס כדי לראות את לוח המבחנים";

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

export function InstructorExamsSection() {
  const [selectedOfferingId, setSelectedOfferingId] = useState<string | null>(null);
  const [view, setView] = useState<InstructorExamScheduleView | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (selectedOfferingId === null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
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

  const groups = view === null ? [] : groupRowsByDate(view.rows);
  const hasPlan = view !== null && view.planId !== null && groups.length > 0;

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

          {groups.map((group) => (
            <div key={group.date} className="flex flex-col gap-2">
              <p className="text-base font-bold text-card-foreground">
                {formatHebrewWeekday(parseDateKey(group.date))} ·{" "}
                {formatHebrewDate(parseDateKey(group.date))}
              </p>

              {group.rows.map((row) => {
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

                    <div className="mt-2 flex flex-col gap-1">
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
                      <PeopleLine
                        label="משגיחים"
                        names={row.supervisorNames}
                        count={row.supervisorCount}
                      />
                    </div>

                    {/* The block's COMPLETE operational schedule, verbatim and
                        in the contract's own order. An empty list renders
                        nothing, so a beginner row and a block with no stored
                        assignment stay exactly as they were. */}
                    <ExamAssignmentRows assignments={row.assignments} />

                    {statusLabel !== null && (
                      <p className="mt-2 text-xs text-muted-foreground">{statusLabel}</p>
                    )}

                    {messages.map((message) => (
                      <p key={message} className="mt-1 text-xs text-warning">
                        {message}
                      </p>
                    ))}
                  </div>
                );
              })}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
