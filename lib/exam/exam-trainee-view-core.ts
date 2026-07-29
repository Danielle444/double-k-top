/**
 * EXAM EX-S4D — PURE trainee exam-day view core: "לו״ז כולל" and "לו״ז שלי".
 *
 * PURE by construction: no Prisma, no DB, no Next, no clock (`Date.now`/`new
 * Date`), no randomness, no env, no auth/session/cookie, no filesystem, no
 * network. Deterministic; never mutates its inputs.
 *
 * WHAT THIS ANSWERS (and only this): for ONE exact date and ONE authoritative
 * viewer student id — which exam rows does a trainee see, which of them are the
 * trainee's own, and at exactly what personal time does the trainee's own row
 * start and end?
 *
 * ===========================================================================
 * ONE PROJECTION, TWO VIEWS
 * ===========================================================================
 * `allRows` is the authoritative day payload. `myRows` is LITERALLY
 * `allRows.filter(row => row.isSelf)` — the same row objects, in the same
 * order, never a second payload, never a second projection model, never a
 * separate query shape. "לו״ז שלי" is therefore a FILTER of "לו״ז כולל" by
 * construction and cannot drift from it. Adding a parallel personal model would
 * create the second source of truth this module exists to prevent; do not.
 *
 * ===========================================================================
 * IDENTITY IS AUTHORITATIVE
 * ===========================================================================
 * `viewerStudentId` is the SERVER-DERIVED student id. This pure core receives it
 * as a parameter and never resolves it itself. Matching is by that id and by
 * nothing else — never by display name, trainee name, exam title, definition
 * name, array position or assignment id. There is deliberately no name field
 * anywhere in this module's input or output.
 *
 * A `null`, blank or whitespace-only viewer id marks NOBODY: every row comes
 * back with `isSelf: false`, `myRows` is empty, and nothing throws. It is never
 * treated as "match everything" and never as an error to recover from.
 *
 * ===========================================================================
 * FAIL CLOSED — NEVER A GUESSED PERSONAL TIME
 * ===========================================================================
 * A trainee acts on the time this view shows. So a row whose personal time
 * cannot be established EXACTLY is EXCLUDED and reported, never rendered with a
 * substituted time. Specifically, a personal start/end is NEVER taken from:
 *   - the block's own `startTime`/`endTime` (a stored block interval is the
 *     whole block, not one trainee's slot inside it);
 *   - `derivedBlockEndTime` (the block end, again not a personal end);
 *   - another slot in the same block;
 *   - a default, a midpoint, `00:00`, or an empty string.
 *
 * An UNRESOLVED stored block is hidden outright: its timetable could not be
 * computed, so no exact personal time exists for anyone in it. Surfacing that
 * to the manager is an admin/instructor concern and is NOT this slice.
 *
 * ===========================================================================
 * VISIBILITY IS THE CALLER'S JOB
 * ===========================================================================
 * This core assumes it is handed ONLY rows the trainee is already allowed to
 * see. Publication, plan publication, the EXAMS capability and course
 * enrollment are S5/S7 concerns and are deliberately absent here. What this core
 * still enforces is structural: other dates, unresolved rows and malformed rows
 * never reach trainee output.
 *
 * ===========================================================================
 * WHAT IS DELIBERATELY ABSENT
 * ===========================================================================
 * No UI text, colours, icons, labels or route state. No conflict detection (the
 * conflict core is not imported). No child, contact, phone or instructor
 * payload. No trainee names. `ProjectionSession` is NOT widened — the stored
 * slot detail arrives as a SIBLING lookup keyed by `sessionId`, precisely so the
 * compact row every list view holds in memory stays compact.
 */
import type { ProjectionSession } from "./exam-schedule-projection-core";

// ===========================================================================
// Roles
// ===========================================================================

/**
 * The two ways a trainee occupies an exam row. Declared locally as a plain
 * string union rather than imported from Prisma: this core is Prisma-free by
 * contract, and the persisted enum is the reader's problem, not the view's.
 */
export type TraineeExamRole = "EXAMINEE" | "INSTRUCTED_TRAINEE";

const TRAINEE_EXAM_ROLES: readonly TraineeExamRole[] = Object.freeze([
  "EXAMINEE",
  "INSTRUCTED_TRAINEE",
]);

// ===========================================================================
// Input — the sibling stored-block detail
// ===========================================================================

/**
 * ONE trainee's exact slot inside a stored exam block, as produced by the block
 * timetable core and persisted-nowhere. This is the ONLY authoritative source of
 * a stored personal start/end time.
 *
 * `studentId` is nullable because an assignment row may legitimately not be
 * bound to a student yet; such a slot simply matches no viewer.
 */
export interface StoredExamAssignmentSlot {
  readonly assignmentId: string;
  readonly studentId: string | null;
  readonly role: TraineeExamRole;
  /** Zero-padded `HH:MM`. */
  readonly startTime: string;
  /** Zero-padded `HH:MM`. */
  readonly endTime: string;
}

/**
 * The slot detail of ONE stored exam block, looked up by `sessionId`.
 *
 * This is deliberately a SIBLING payload rather than a field on
 * `ProjectionSession`: the projection row is the compact object every list view
 * holds for every row of the day, and slots belong to the one row being
 * resolved.
 */
export interface StoredExamBlockDetail {
  readonly source: "STORED";
  readonly sessionId: string;
  readonly slots: readonly StoredExamAssignmentSlot[];
}

/** The sibling lookup: stored `sessionId` → its slot detail. */
export type StoredExamBlockDetailLookup = ReadonlyMap<string, StoredExamBlockDetail>;

// ===========================================================================
// Issues
// ===========================================================================

/**
 * Stable, non-PII issue codes. The code STRINGS are the contract and must not be
 * renamed once consumed downstream.
 *
 * Every one of these EXCLUDES the row from trainee output. There is no
 * "warning that still renders": a row that reaches this list is one whose
 * personal reading cannot be trusted.
 */
export type TraineeExamViewIssueCode =
  /** A stored row arrived without usable slot detail. */
  | "EX-TRN-STORED-DETAIL-REQUIRED"
  /** Two or more slots in one block claim the same student. */
  | "EX-TRN-DUPLICATE-STUDENT-SLOT"
  /** The viewer's personal interval is not a legal `HH:MM` range. */
  | "EX-TRN-INVALID-PERSONAL-TIME"
  /** The viewer's slot carries a role token that is not a legal role. */
  | "EX-TRN-INVALID-PERSONAL-ROLE"
  /** The row's participant ids and its slot detail disagree about the viewer. */
  | "EX-TRN-SELF-ASSIGNMENT-CONFLICT"
  /** A live beginner row carries stored-block-only state. */
  | "EX-TRN-BEGINNER-STATE-CONFLICT";

/**
 * The authoritative code → Hebrew message table. The exhaustive
 * `Record<TraineeExamViewIssueCode, string>` annotation forces every code —
 * present or future — to carry a message or this file will not compile.
 */
export const TRAINEE_EXAM_VIEW_MESSAGES: Readonly<
  Record<TraineeExamViewIssueCode, string>
> = Object.freeze({
  "EX-TRN-STORED-DETAIL-REQUIRED":
    "לא נמצאו פרטי שיבוץ למפגש הבחינה — לא ניתן להציג שעה אישית ולכן המפגש אינו מוצג",
  "EX-TRN-DUPLICATE-STUDENT-SLOT":
    "אותו חניך משובץ יותר מפעם אחת באותו מפגש בחינה — לא ניתן לקבוע את השעה האישית",
  "EX-TRN-INVALID-PERSONAL-TIME": "השעה האישית במפגש הבחינה אינה תקינה",
  "EX-TRN-INVALID-PERSONAL-ROLE": "התפקיד האישי במפגש הבחינה אינו תקין",
  "EX-TRN-SELF-ASSIGNMENT-CONFLICT":
    "רשימת המשובצים במפגש הבחינה אינה תואמת את פרטי השיבוץ האישי",
  "EX-TRN-BEGINNER-STATE-CONFLICT":
    "התנסות מתחילים נקראת ישירות מהתרגול המעשי ואינה יכולה לשאת נתוני בלוק בחינה שמור",
});

/**
 * One excluded row. Carries the `sessionId` so the row is observable, and
 * NOTHING else — no student id, no name, no title, no time. An issue list is a
 * diagnostic channel, never a PII channel.
 */
export interface TraineeExamViewIssue {
  readonly code: TraineeExamViewIssueCode;
  readonly message: string;
  readonly sessionId: string;
}

// ===========================================================================
// Output
// ===========================================================================

/**
 * One visible exam row for the trainee.
 *
 * `session` is the ORIGINAL `ProjectionSession` object, carried through by
 * reference — never copied, spread, re-shaped or enriched. The four remaining
 * fields are the viewer's personal reading of that row and are the ONLY thing
 * this core adds.
 *
 * When `isSelf` is `false`, `selfRole`/`selfStartTime`/`selfEndTime` are all
 * `null`. There is no partially-populated row.
 */
export interface TraineeExamDayRow {
  readonly session: ProjectionSession;
  /** True iff the authoritative viewer id is assigned to this row. */
  readonly isSelf: boolean;
  readonly selfRole: TraineeExamRole | null;
  /** The viewer's EXACT personal start, `HH:MM`. Never the block start. */
  readonly selfStartTime: string | null;
  /** The viewer's EXACT personal end, `HH:MM`. Never the block end. */
  readonly selfEndTime: string | null;
}

/**
 * The one projection behind both trainee views.
 *
 * `myRows` holds the SAME row object references as `allRows`, filtered by
 * `isSelf`. Comparing by reference is a valid and intentional test of this
 * contract.
 */
export interface TraineeExamDayProjection {
  /** "לו״ז כולל" — every visible row of the selected date, in the locked order. */
  readonly allRows: readonly TraineeExamDayRow[];
  /** "לו״ז שלי" — exactly `allRows.filter(row => row.isSelf)`. */
  readonly myRows: readonly TraineeExamDayRow[];
  /** Every row excluded because it could not be read safely. */
  readonly issues: readonly TraineeExamViewIssue[];
}

// ===========================================================================
// Helpers
// ===========================================================================

/** The live Teaching-Practice beginner kind. Compared, never constructed. */
const BEGINNER_KIND = "BEGINNER_INSTRUCTION";

/** A zero-padded `HH:MM` in 00:00-23:59. Shape only — no `Date` is constructed. */
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function cmpNum(a: number, b: number): number {
  return a - b;
}

function isPresent(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/** The trimmed id, or `null` when absent/blank. Whitespace is never identity. */
function normalizedId(v: unknown): string | null {
  return isPresent(v) ? v.trim() : null;
}

function isTraineeExamRole(v: unknown): v is TraineeExamRole {
  return typeof v === "string" && TRAINEE_EXAM_ROLES.includes(v as TraineeExamRole);
}

/**
 * A legal personal interval: both endpoints are `HH:MM` and the end is strictly
 * after the start. Because the format is zero-padded, plain string comparison is
 * chronological — no `Date`, no timezone, no arithmetic.
 */
function isValidInterval(start: unknown, end: unknown): boolean {
  return (
    typeof start === "string" &&
    typeof end === "string" &&
    HHMM.test(start) &&
    HHMM.test(end) &&
    end > start
  );
}

/**
 * Whether the authoritative viewer id appears in a participant id list. Ids are
 * compared as trimmed strings; a non-string, blank or whitespace-only entry
 * matches nothing.
 */
function includesStudent(ids: unknown, viewer: string): boolean {
  if (!Array.isArray(ids)) return false;
  for (const raw of ids) {
    if (normalizedId(raw) === viewer) return true;
  }
  return false;
}

/** Safe read from a possibly-absent, possibly-not-a-Map lookup. */
function readDetail(
  lookup: StoredExamBlockDetailLookup | null | undefined,
  sessionId: string,
): StoredExamBlockDetail | null {
  if (lookup === null || lookup === undefined) return null;
  if (typeof (lookup as { get?: unknown }).get !== "function") return null;
  const detail = lookup.get(sessionId);
  return detail === undefined || detail === null ? null : detail;
}

/**
 * The detail entry, but only when it is structurally usable for THIS row: it
 * declares itself stored, it is keyed to this session, and it carries a slot
 * array. Anything else is treated as no detail at all, and fails closed.
 */
function usableDetail(
  lookup: StoredExamBlockDetailLookup | null | undefined,
  sessionId: string,
): StoredExamBlockDetail | null {
  const detail = readDetail(lookup, sessionId);
  if (detail === null || typeof detail !== "object") return null;
  if (detail.source !== "STORED") return null;
  if (detail.sessionId !== sessionId) return null;
  if (!Array.isArray(detail.slots)) return null;
  return detail;
}

function makeIssue(
  code: TraineeExamViewIssueCode,
  sessionId: string,
): TraineeExamViewIssue {
  return Object.freeze({
    code,
    message: TRAINEE_EXAM_VIEW_MESSAGES[code],
    sessionId,
  });
}

function makeRow(
  session: ProjectionSession,
  self: {
    readonly role: TraineeExamRole;
    readonly startTime: string;
    readonly endTime: string;
  } | null,
): TraineeExamDayRow {
  return Object.freeze({
    session,
    isSelf: self !== null,
    selfRole: self === null ? null : self.role,
    selfStartTime: self === null ? null : self.startTime,
    selfEndTime: self === null ? null : self.endTime,
  });
}

/**
 * The locked within-date order: `startTime`, `orderIndex`, `sessionId` — the
 * SAME order the projection core's `projectByDate` uses. Its comparator is
 * module-private there, and that file is not modified by this slice, so it is
 * restated here and the parity is asserted by test. `orderIndex` is
 * load-bearing: exam days routinely hold several rows sharing one start time,
 * and `sessionId` is the final deterministic tiebreak, which is what makes the
 * output independent of input order.
 */
function compareRows(a: TraineeExamDayRow, b: TraineeExamDayRow): number {
  return (
    cmp(a.session.startTime, b.session.startTime) ||
    cmpNum(a.session.orderIndex, b.session.orderIndex) ||
    cmp(a.session.sessionId, b.session.sessionId)
  );
}

/** Issue order: `sessionId`, then code. Independent of input order. */
function compareIssues(a: TraineeExamViewIssue, b: TraineeExamViewIssue): number {
  return cmp(a.sessionId, b.sessionId) || cmp(a.code, b.code);
}

function freezeProjection(
  rows: readonly TraineeExamDayRow[],
  issues: readonly TraineeExamViewIssue[],
): TraineeExamDayProjection {
  const allRows = Object.freeze(rows);
  // THE invariant: the personal view is a filter of the full view, sharing row
  // object identity. Never rebuilt, never re-derived from the input.
  const myRows = Object.freeze(allRows.filter((row) => row.isSelf));
  return Object.freeze({ allRows, myRows, issues: Object.freeze(issues) });
}

// ===========================================================================
// The projection
// ===========================================================================

/**
 * Project ONE trainee's exam day: the full day, the trainee's own rows, and
 * everything that had to be excluded.
 *
 * DATE MATCHING is exact string equality on the opaque `YYYY-MM-DD` token. No
 * `Date` is constructed, no range is computed, no timezone or calendar
 * arithmetic happens anywhere in this module. A blank or non-string
 * `selectedDate` selects nothing rather than matching everything.
 *
 * ROW HANDLING, in order:
 *
 *  1. a row with no legible `sessionId` is dropped silently — it cannot even be
 *     named in an issue, so reporting it would emit an anonymous entry;
 *  2. a row on another date is dropped silently — it is not an error;
 *  3. a BEGINNER row (`kind === "BEGINNER_INSTRUCTION"`) must declare
 *     `timetableStatus: "NOT_APPLICABLE"` explicitly and carry no stored-block
 *     state at all; it is then resolved from its own live lesson interval and
 *     NEVER from the stored detail map;
 *  4. a stored row with `timetableStatus === "UNRESOLVED"` is hidden with NO
 *     issue: its timetable genuinely could not be computed, which is a known
 *     admin-side state rather than a defect of this view;
 *  5. every other stored row REQUIRES usable slot detail, whatever its
 *     `timetableStatus` — including a legacy row that carries none. Personal
 *     time comes from the viewer's own slot or the row is excluded.
 *
 * @param sessions          the flat visible rows (stored blocks and live
 *                          beginner rows together, already visibility-filtered
 *                          by the caller).
 * @param storedDetails     sibling slot detail keyed by stored `sessionId`.
 * @param selectedDate      exact `YYYY-MM-DD` token.
 * @param viewerStudentId   the SERVER-DERIVED student id, or `null` to mark
 *                          nobody. Never a client-supplied identity.
 */
export function projectTraineeExamDay(
  sessions: readonly ProjectionSession[],
  storedDetails: StoredExamBlockDetailLookup | null | undefined,
  selectedDate: string,
  viewerStudentId: string | null | undefined,
): TraineeExamDayProjection {
  const rows: TraineeExamDayRow[] = [];
  const issues: TraineeExamViewIssue[] = [];

  if (!Array.isArray(sessions) || !isPresent(selectedDate)) {
    return freezeProjection(rows, issues);
  }

  // A blank / whitespace-only / absent viewer marks NOBODY. It is never widened
  // into "everybody" and never rejected.
  const viewer = normalizedId(viewerStudentId);

  for (const session of sessions) {
    if (session === null || typeof session !== "object") continue;
    const sessionId = normalizedId(session.sessionId);
    if (sessionId === null) continue;
    if (session.date !== selectedDate) continue;

    // -------------------------------------------------------------------
    // Live beginner row — its own real lesson interval, shared by everyone
    // -------------------------------------------------------------------
    if (session.kind === BEGINNER_KIND) {
      // A live row has NO definition identity, NO timetable and NO stored slot
      // detail. Carrying any of them means the row is not what it claims to be,
      // and guessing which half is true would put a wrong time in front of a
      // trainee. The detail map is consulted for PRESENCE only, never as a time
      // source.
      //
      // `timetableStatus` must be EXPLICITLY `NOT_APPLICABLE`. Absent, null,
      // `OK`, `UNRESOLVED` and any unknown token are all excluded: the live
      // beginner adapter always emits the explicit value, so a missing one means
      // the reader payload was built wrong, and inferring the status here would
      // hide exactly that defect. There is no legacy runtime reader to be
      // compatible with.
      const contradictory =
        isPresent(session.definitionId) ||
        isPresent(session.definitionName) ||
        isPresent(session.derivedBlockEndTime) ||
        session.timetableStatus !== "NOT_APPLICABLE" ||
        readDetail(storedDetails, sessionId) !== null ||
        (Array.isArray(session.instructedTraineeStudentIds) &&
          session.instructedTraineeStudentIds.length > 0);
      if (contradictory) {
        issues.push(makeIssue("EX-TRN-BEGINNER-STATE-CONFLICT", sessionId));
        continue;
      }

      // Every participant of a live beginner lesson shares the real lesson
      // interval, so no synthetic per-trainee slot is created here — there is
      // nothing to derive.
      if (viewer !== null && includesStudent(session.examineeStudentIds, viewer)) {
        if (!isValidInterval(session.startTime, session.endTime)) {
          issues.push(makeIssue("EX-TRN-INVALID-PERSONAL-TIME", sessionId));
          continue;
        }
        rows.push(
          makeRow(session, {
            role: "EXAMINEE",
            startTime: session.startTime,
            endTime: session.endTime,
          }),
        );
        continue;
      }

      rows.push(makeRow(session, null));
      continue;
    }

    // -------------------------------------------------------------------
    // Stored block row
    // -------------------------------------------------------------------

    // No timetable means no exact personal time for ANYONE in the block, so the
    // row is hidden from trainees outright — even from a trainee whose id
    // appears in its participant lists.
    if (session.timetableStatus === "UNRESOLVED") continue;

    const detail = usableDetail(storedDetails, sessionId);
    if (detail === null) {
      issues.push(makeIssue("EX-TRN-STORED-DETAIL-REQUIRED", sessionId));
      continue;
    }

    if (viewer === null) {
      rows.push(makeRow(session, null));
      continue;
    }

    const declared =
      includesStudent(session.examineeStudentIds, viewer) ||
      includesStudent(session.instructedTraineeStudentIds, viewer);

    const matches = detail.slots.filter(
      (slot) =>
        slot !== null && typeof slot === "object" && normalizedId(slot.studentId) === viewer,
    );

    // Two slots for one student identify no single personal time, and picking
    // either one arbitrarily would be a coin flip rendered as fact.
    if (matches.length > 1) {
      issues.push(makeIssue("EX-TRN-DUPLICATE-STUDENT-SLOT", sessionId));
      continue;
    }

    const slot = matches.length === 1 ? matches[0] : null;

    if (slot === null) {
      // The row says the viewer is assigned but the detail holds no slot for
      // them. There is no personal time to show and the block interval is NOT a
      // fallback, so the row is excluded rather than quietly shown as somebody
      // else's.
      if (declared) {
        issues.push(makeIssue("EX-TRN-SELF-ASSIGNMENT-CONFLICT", sessionId));
        continue;
      }
      rows.push(makeRow(session, null));
      continue;
    }

    // The mirror contradiction: a slot claims the viewer, but the row's
    // participant lists do not. Membership is what makes a trainee assigned, so
    // this row is inconsistent and is excluded too.
    if (!declared) {
      issues.push(makeIssue("EX-TRN-SELF-ASSIGNMENT-CONFLICT", sessionId));
      continue;
    }

    if (!isTraineeExamRole(slot.role)) {
      issues.push(makeIssue("EX-TRN-INVALID-PERSONAL-ROLE", sessionId));
      continue;
    }

    if (!isValidInterval(slot.startTime, slot.endTime)) {
      issues.push(makeIssue("EX-TRN-INVALID-PERSONAL-TIME", sessionId));
      continue;
    }

    // The role and the exact personal interval come from the slot and ONLY from
    // the slot — an INSTRUCTED_TRAINEE inherits the paired examinee's interval
    // upstream, and that inherited interval arrives here already resolved.
    rows.push(
      makeRow(session, {
        role: slot.role,
        startTime: slot.startTime,
        endTime: slot.endTime,
      }),
    );
  }

  rows.sort(compareRows);
  issues.sort(compareIssues);
  return freezeProjection(rows, issues);
}
