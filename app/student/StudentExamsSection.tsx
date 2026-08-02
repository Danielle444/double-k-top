"use client";

import { useEffect, useMemo, useState } from "react";
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
// EX-EXAM-TP-CARDS — the SAME existing reader/DTO the trainee Teaching-
// Practice screen ("ההתנסויות שלי") already calls, reused verbatim: no new
// reader, no new Server Action, no duplicated data. Identity, course
// resolution, the TEACHING_PRACTICE capability gate and the published/
// participant filters all live inside this ONE call, exactly as they do for
// that screen - see its own file header for the full contract.
import { listMyTeachingPracticeLessonsForTrainee } from "@/lib/actions/teaching-practice-student";
// EX-EXAM-TP-SAME-PARENT-TRACKS — the SAME existing "מבנה קבוע" reader
// "ההתנסויות שלי"'s own popup already calls, reused verbatim, for the SAME
// reason it does there: a child currently assigned to a fixed-structure slot
// can have no published GENERATED lesson of their own yet, so they would be
// entirely invisible to (and their same-parent match undiscoverable from)
// `myTeachingPracticeLessons` alone - see the file header (EX-EXAM-TP-SAME-PARENT-TRACKS)
// for the full contract. Bound through the SAME authorization dependency
// (`TRAINEE_TEACHING_PRACTICE_DEPS`) as the lessons reader - identical
// session/course/capability gates, not re-implemented.
import { listPublishedTeachingPracticeTracksForTrainee } from "@/lib/actions/teaching-practice-student";
import type {
  TeachingPracticeTraineeLessonRow,
  TeachingPracticeTraineeTrackRow,
} from "@/lib/actions/teaching-practice-student";
// The SAME shared card "ההתנסויות שלי" renders, extracted so both screens
// render the identical component - never a second, visually-similar copy.
import { TeachingPracticeLessonCard } from "@/lib/components/TeachingPracticeLessonCard";
// The SAME shared same-parent popup "ההתנסויות שלי" renders, and the SAME
// pure detection rule - reused, not re-implemented, so the badge/popup this
// screen shows can never disagree with the original screen's.
import {
  buildSameParentPopupRows,
  TeachingPracticeSameParentPopup,
} from "@/lib/components/TeachingPracticeSameParentPopup";
import {
  buildSameParentOtherNamesByChildId,
  type SameParentChildInput,
} from "@/lib/teaching-practice-same-parent";
// The PURE merge/filter core behind "לו״ז שלי" - see its own file header.
// This screen holds no comparator or date rule of its own; it only calls in.
import {
  buildSelfViewEntries,
  collectBeginnerExamDates,
  filterBeginnerLessonsForExamDays,
} from "@/app/student/trainee-exam-self-view-core";
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
 * LIVE BEGINNER ROWS, IN "לפי תאריך" (EX-BEGINNER-EXAM-UI)
 * ===========================================================================
 * A beginner row is a LIVE projection of a Teaching-Practice lesson. It has no
 * stored exam assignment at all, so handing it to the wave/examinee renderer
 * above produced an empty block. "לפי תאריך" ROUTES on the contract's own
 * `source` field: a beginner row would go to `lib/components/ExamBeginnerRows`,
 * the shared compact beginner presentation, and NEVER into the advanced
 * renderer — but `filteredRows` below excludes every beginner row before that
 * routing is ever reached (EX-C2-0-SUSPEND-UI), so this branch stays in place
 * as dead code rather than a reachable path. "לפי תאריך" deliberately shows NO
 * Teaching-Practice detail of any kind — real cards or the old live
 * projection — see EX-EXAM-TP-CARDS below for where the real detail now lives.
 *
 * ===========================================================================
 * REAL BEGINNER TEACHING-PRACTICE CARDS, IN "לו״ז שלי" ONLY (EX-EXAM-TP-CARDS)
 * ===========================================================================
 * "לו״ז שלי" no longer shows a live re-projection of Teaching-Practice data
 * (EX-BEGINNER-EXAM-UI) or a static placeholder (EX-C2-0-SUSPEND-UI, now
 * fully removed). It shows the trainee's REAL "ההתנסויות שלי" cards, via the
 * SAME shared `TeachingPracticeLessonCard` component and the SAME
 * `listMyTeachingPracticeLessonsForTrainee()` reader that screen already
 * calls — reused verbatim, never a second copy and never duplicated data.
 * That reader is its OWN authorization boundary (signed session, resolved
 * course, TEACHING_PRACTICE capability, published lessons, real participant
 * match by `traineeId`) and is not re-implemented or re-checked here.
 *
 * Loaded ONCE on mount, in its own effect beside the exam-schedule one below —
 * never per-date, never re-fetched on a mode/date-tab change. Narrowed to
 * BEGINNER practice types (LUNGE excluded) on the dates this trainee's OWN
 * exam contract already marks as beginner exam days (`view.myRows` rows whose
 * `source` is `"BEGINNER"` — a set the contract already computed, not a new
 * date rule invented here), then merged chronologically with the advanced
 * rows below by (date, startTime, stable original order) — see
 * `buildSelfViewEntries`. A Teaching-Practice lesson is rendered as the real
 * card, in its correct chronological slot, and NEVER as an exam row.
 *
 * ===========================================================================
 * THE SAME-PARENT INDICATOR/POPUP IS THE SAME FEATURE, REAL (EX-EXAM-TP-SAME-PARENT)
 * ===========================================================================
 * "ההתנסויות שלי"'s "אותו הורה" badge and popup are fully reproduced here —
 * not a placeholder, not a no-op. Both are built from `myTeachingPracticeLessons`,
 * the trainee's FULL authorized Teaching-Practice result already loaded once
 * above (never the date-filtered `beginnerLessonsForSelfView`, so a same-parent
 * relation is found even when the OTHER matching child's only lesson falls
 * outside a beginner exam day, exactly as "ההתנסויות שלי"'s own badge is built
 * from that screen's full `myLessons`, not its currently-displayed subset).
 * `examSameParentOtherNamesByChildId` uses the SAME exported
 * `buildSameParentOtherNamesByChildId`, keyed by real `childId` — never a
 * display name. The popup reuses the SAME `buildSameParentPopupRows` and the
 * SAME `TeachingPracticeSameParentPopup` component "ההתנסויות שלי" mounts.
 *
 * ===========================================================================
 * WHY TRACKS ARE READ TOO (EX-EXAM-TP-SAME-PARENT-TRACKS)
 * ===========================================================================
 * `tracks` ("מבנה קבוע") is NOT redundant with `lessons`: a child can be
 * CURRENTLY assigned to a fixed-structure slot with no PUBLISHED generated
 * lesson of their own yet (the very "empty/incomplete popup" bug
 * "ההתנסויות שלי"'s own popup was fixed for — see `handleOpenSameParentPopup`
 * there). Such a child is invisible to, and their same-parent match
 * undiscoverable from, `lessons` alone. Proven with representative non-empty
 * track fixtures in `lib/components/TeachingPracticeSameParentPopup.test.ts`.
 *
 * So `tracks` is read here too, via `listPublishedTeachingPracticeTracksForTrainee` -
 * the SAME reader "ההתנסויות שלי" calls, bound through the SAME authorization
 * dependency as the lessons reader (identical session/course/capability
 * gates). LAZILY, on the FIRST popup open, exactly like "ההתנסויות שלי"'s
 * own `handleOpenSameParentPopup` — loaded ONCE and cached, never per-click
 * and never per-date: a trainee who never opens the popup never fetches it.
 * The popup shows "טוען..." for the one open that has to wait on it, exactly
 * the SAME loading state "ההתנסויות שלי" shows.
 *
 * WHAT REMAINS DELIBERATELY NARROWER, AND WHY THAT IS NOT "REDUCED": `lessons`
 * here is `myTeachingPracticeLessons` (this trainee's OWN participant
 * lessons), never `allLessons` (every trainee's published lessons) — a prior,
 * explicit product decision (EX-EXAM-TP-CARDS) to reuse only the ONE reader
 * this screen already needed for the cards themselves, never a second,
 * roster-wide read. `tracks` is ALSO roster-wide by construction (there is no
 * "my tracks" reader), so reading it does not violate that same boundary -
 * it is a single existing, already-capability-gated read, not a new,
 * differently-scoped one.
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
  const [mode, setMode] = useState<DayMode>("self");
  const [view, setView] = useState<TraineeExamScheduleView | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  // The DATE sub-tab inside "לפי תאריך", over the schedule already in hand. It
  // issues no request and can name no row the server did not send. `null` means
  // "no explicit choice yet", which resolves to the EARLIEST date below — it is
  // never rendered as "no date selected".
  const [navDate, setNavDate] = useState<string | null>(null);
  // EX-EXAM-TP-CARDS — the trainee's own real beginner Teaching-Practice
  // lessons, for "לו״ז שלי" only. `null` = not yet loaded (never rendered as
  // "no lessons"); `[]` = loaded, genuinely none (including every denial the
  // reader fails closed to - no session, no capability, nothing published).
  const [myTeachingPracticeLessons, setMyTeachingPracticeLessons] = useState<
    TeachingPracticeTraineeLessonRow[] | null
  >(null);

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

  // EX-EXAM-TP-CARDS — the SAME single load "ההתנסויות שלי" already performs,
  // called ONCE on mount in its OWN effect (empty deps, exactly like the exam
  // schedule effect above): no per-date request, no re-fetch on a mode/date-tab
  // change. A rejection fails closed to an empty list rather than surfacing a
  // second error state on this screen - the worst case is simply no real card,
  // never a broken exam schedule.
  useEffect(() => {
    let cancelled = false;
    // The reader's `studentId` parameter is RETAINED on its signature for
    // caller compatibility only and is DELIBERATELY DISCARDED inside it (see
    // teaching-practice-student.ts's own file header) - identity comes from
    // the signed session server-side. This screen holds no student id at all
    // (EX-TRAINEE-ID-CONTAINMENT), so the empty string passed here is inert
    // by construction, never read, and never could identify anyone.
    listMyTeachingPracticeLessonsForTrainee("")
      .then((result) => {
        if (cancelled) return;
        setMyTeachingPracticeLessons(result);
      })
      .catch(() => {
        if (cancelled) return;
        setMyTeachingPracticeLessons([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const allRows = view === null ? [] : view.allRows;
  const myRows = view === null ? [] : view.myRows;
  // "לו״ז שלי" ONLY. Real Teaching-Practice lessons on this trainee's own
  // beginner exam days, narrowed to BEGINNER practice types - see
  // {@link collectBeginnerExamDates} and {@link filterBeginnerLessonsForExamDays}.
  const beginnerExamDates = collectBeginnerExamDates(myRows);
  const beginnerLessonsForSelfView = filterBeginnerLessonsForExamDays(
    myTeachingPracticeLessons ?? [],
    beginnerExamDates,
  );
  // The advanced rows "לו״ז שלי" has always shown - a live beginner exam row
  // is never rendered as an exam row (unchanged from EX-C2-0-SUSPEND-UI); it
  // is now replaced by the real card above instead of being dropped silently.
  const myAdvancedRows = myRows.filter((row) => !isBeginnerExamRow(row));
  const selfViewEntries = buildSelfViewEntries(myAdvancedRows, beginnerLessonsForSelfView);

  // EX-EXAM-TP-SAME-PARENT — the badge map, from the trainee's FULL
  // Teaching-Practice result (`myTeachingPracticeLessons`, already loaded
  // above), never the date-narrowed `beginnerLessonsForSelfView`. Same
  // convention as "ההתנסויות שלי"'s own `mineSameParentOtherNamesByChildId`:
  // deduped by childId first, keyed by real id, never by display name.
  const examSameParentOtherNamesByChildId = useMemo(() => {
    const uniqueChildren = new Map<string, SameParentChildInput>();
    for (const lesson of myTeachingPracticeLessons ?? []) {
      for (const c of lesson.children) {
        if (!uniqueChildren.has(c.childId)) {
          uniqueChildren.set(c.childId, {
            id: c.childId,
            displayName: `${c.firstName}${c.lastName ? ` ${c.lastName}` : ""}`,
            parentName: c.parentName,
            parentPhone: c.parentPhone,
          });
        }
      }
    }
    return buildSameParentOtherNamesByChildId([...uniqueChildren.values()]);
  }, [myTeachingPracticeLessons]);

  // EX-EXAM-TP-SAME-PARENT — the popup state.
  const [samePopupChildId, setSamePopupChildId] = useState<string | null>(null);
  // EX-EXAM-TP-SAME-PARENT-TRACKS — see the file header. `null` = not yet
  // loaded (the popup shows "טוען..." while this trainee's FIRST popup open
  // is still in flight); `[]` = loaded, genuinely none.
  const [tracks, setTracks] = useState<TeachingPracticeTraineeTrackRow[] | null>(null);

  function handleOpenSameParentPopup(childId: string) {
    setSamePopupChildId(childId);
    // Loaded ONCE, lazily, on the FIRST open - exactly like "ההתנסויות
    // שלי"'s own `handleOpenSameParentPopup`. A no-op on every open after
    // the first (and for every trainee who never opens the popup at all,
    // this reader is never called).
    if (tracks === null) {
      // Same discarded/inert `studentId` argument, same reason, as the
      // lessons load above.
      listPublishedTeachingPracticeTracksForTrainee("")
        .then((result) => {
          setTracks(result);
        })
        .catch(() => {
          setTracks([]);
        });
    }
  }

  function handleCloseSameParentPopup() {
    setSamePopupChildId(null);
  }

  const samePopupRows = useMemo(() => {
    if (!samePopupChildId) return null;
    // Wait for tracks to resolve before computing final rows - otherwise a
    // fixed-structure-only match could briefly show as "no rows found" just
    // because the popup opened before the load settled. The SAME guard
    // "ההתנסויות שלי"'s own popup uses for the same reason.
    if (tracks === null) return null;
    return buildSameParentPopupRows(samePopupChildId, myTeachingPracticeLessons ?? [], tracks);
  }, [samePopupChildId, myTeachingPracticeLessons, tracks]);
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
  }).filter((entry) => !isBeginnerExamRow(entry));
  const groups = groupRowsByDate(sortExamRowsByStartTime(filteredRows));
  const scheduleIsEmpty = view !== null && view.allRows.length === 0;
  // Each view answers for itself: the personal view by its own rows, the date
  // view by the rows its selected date left standing.
  const showEmpty =
    view !== null &&
    !loading &&
    !failed &&
    (mode === "self" ? selfViewEntries.length === 0 : groups.length === 0);
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
        selfViewEntries.map((entry) => {
          // EX-EXAM-TP-CARDS — a real Teaching-Practice lesson, rendered by the
          // SAME shared card "ההתנסויות שלי" uses, in its correct chronological
          // slot. It is never turned into (or handed to) the exam-row renderer
          // below. The same-parent badge/popup IS wired here, real - see the
          // file header (EX-EXAM-TP-SAME-PARENT).
          if (entry.kind === "practice") {
            return (
              <TeachingPracticeLessonCard
                key={`practice:${entry.lesson.id}`}
                lesson={entry.lesson}
                sameParentOtherNamesByChildId={examSameParentOtherNamesByChildId}
                onOpenSameParentPopup={handleOpenSameParentPopup}
              />
            );
          }
          const row = entry.row;
          const place = row.arena ?? row.location;
          const roleLabel = row.selfRole === null ? null : SELF_ROLE_LABELS[row.selfRole];
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

              {/* selfViewEntries never carries a beginner row (see
                  myAdvancedRows above), so this is always a STORED block's own
                  personal detail. */}
              <ExamPersonalAssignmentDetail assignments={row.assignments} />
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

      <TeachingPracticeSameParentPopup
        open={samePopupChildId !== null}
        onClose={handleCloseSameParentPopup}
        rows={samePopupRows}
      />
    </div>
  );
}
