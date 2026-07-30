/**
 * EXAM — PURE admin schedule GROUPING/PRESENTATION core for STORED exam sessions.
 *
 * PURE by construction: no Prisma, no DB, no transaction, no Next, no
 * `server-only`, no `"use server"`, no auth/session/cookie, no capability, no
 * clock (`Date.now` / `new Date`), no randomness, no env, no filesystem, no
 * network, no `Intl`, no `localeCompare`. Every export is a total, deterministic
 * function of its arguments and never mutates its inputs. The only runtime
 * dependencies are two committed, import-free, `Date`-free primitives (see "WHY
 * THESE TWO HELPERS" below).
 *
 * WHAT THIS ANSWERS (and only this): given ONE flat list of ALREADY-READ,
 * ALREADY-AUTHORIZED stored exam-session rows, which calendar DAY does each row
 * belong to, in what order are those days and their rows shown, and what does
 * the day heading read?
 *
 * ===========================================================================
 * WHY THIS EXISTS BESIDE THE COMMITTED EXAM PROJECTIONS
 * ===========================================================================
 * Two exam cores already group sessions, and NEITHER answers this question:
 *
 *  - `exam-schedule-projection-core` (EX-C1/EX-S4B) projects ONE date
 *    (`projectByDate`) or ONE `ExamKind`, over a merged stored + LIVE beginner
 *    row shape carrying `endTime`, examinee/instructed id arrays and timetable
 *    status. Its within-date order is `startTime` FIRST and `orderIndex` second.
 *  - `exam-group-projection-core` (EX-S4C) groups by `ExamDefinition.id` — one
 *    card per EXAM across all its dates. That is the "לפי מבחן" axis.
 *
 * This core is the DAY axis of the admin schedule screen: every day the plan
 * occupies, each holding the sessions of that day in the MANAGER'S OWN
 * `orderIndex` order — which is the order the admin write path assigns per plan
 * and date, so it must lead, with `startTime` as the first tie-break. That
 * ordering is deliberately DIFFERENT from the projection core's, so this is not
 * a narrow extension of it: reusing that comparator would silently re-order a
 * manager's hand-sequenced day whenever two sessions' clock times disagree with
 * their intended sequence.
 *
 * It also consumes a DIFFERENT, narrower row: the admin list row (definition
 * identity + occurrence + `assignmentCount` + `updatedAt`), with NO `endTime`,
 * no student ids and no beginner fields. Neither committed core accepts it, and
 * widening either to do so would drag live-beginner and timetable concerns into
 * a screen that shows stored rows only.
 *
 * Both committed cores are left COMPLETELY UNTOUCHED by this slice: nothing here
 * imports, wraps, re-exports or re-shapes them.
 *
 * ===========================================================================
 * WHAT THIS DELIBERATELY DOES NOT DO
 * ===========================================================================
 *  - it PERFORMS NO IO. It never sees Prisma, a query, a plan, a course
 *    offering, an actor or a request;
 *  - it AUTHORIZES NOTHING and gates nothing. A caller holding a grouped result
 *    has been granted NOTHING; scoping happened before these rows existed;
 *  - it CREATES, EDITS AND DELETES NOTHING, and models no write input;
 *  - it derives NO `endTime`, no waves, no slots, no capacity and no conflicts.
 *    A block's end comes from the definition's duration and its wave layout, and
 *    NONE of those is an input here, so any end computed in this file would be a
 *    fabrication;
 *  - it groups by DAY only. Definition grouping is EX-S4C's and is not repeated;
 *  - it knows nothing of assignments beyond an opaque COUNT, and nothing at all
 *    of breaks, supervisors, publication, source dates or capabilities. A row's
 *    publication state is not an input, so a draft and a published session are —
 *    correctly — indistinguishable here;
 *  - it HIDES NOTHING. A session with `assignmentCount: 0` is a real scheduled
 *    session the manager must see in order to staff it, so it is grouped and
 *    ordered exactly like any other.
 *
 * ===========================================================================
 * WHY THESE TWO HELPERS, AND WHY NO THIRD COPY OF A CALENDAR
 * ===========================================================================
 * `isValidHHMM` comes from `./exam-overlap-core`, the exam slice's single time
 * primitive (already the source of `HH:mm` handling for the block timetable,
 * schedule projection, TP source adapter and session write cores). It is
 * import-free, `Date`-free and accepts ONLY zero-padded 00:00–23:59.
 *
 * `isValidDateKey` comes from `../trainee-history/interval-resolver` — the same
 * narrow, deliberate cross-directory reuse `exam-session-write-core` already
 * committed, for the same reasons: that module has ZERO imports, constructs no
 * `Date`, reads no clock, and already validates REAL calendar dates including
 * leap years. Restating the leap-year rule here would add a sixth copy of it to
 * this repository, free to drift from the other five.
 *
 * ===========================================================================
 * DAY LABELS ARE COMPUTED FROM THE DATE KEY, WITHOUT A `Date`
 * ===========================================================================
 * Everywhere else in this repository `dayLabel` / `dateLabel` are produced by
 * `formatHebrewWeekday` / `formatHebrewDate` (lib/dates.ts) in the READER, and
 * the pure grouping core downstream (`lib/course/unified-instructor-day-grouping-core`)
 * simply carries them through from its items. That is not available here: the
 * approved input row carries a `dateKey` and NO labels, so this core must derive
 * them or the admin screen has no day heading.
 *
 * They are derived ARITHMETICALLY — a `YYYY-MM-DD` token is split into three
 * integers and run through the standard days-from-civil formula — so:
 *  - no `Date` is constructed, hence no local/UTC shift can move a session to
 *    the neighbouring day (the exact bug lib/dates.ts's UTC pinning exists to
 *    prevent);
 *  - no `Intl` is involved, hence the label cannot vary with a machine's ICU
 *    build between a developer laptop, CI and the server.
 *
 * The two label tables reproduce, BYTE FOR BYTE, what `formatHebrewWeekday` and
 * `formatHebrewDate` render for the same day ("יום ראשון", "2 באוגוסט 2026"), so
 * this screen reads identically to every other Hebrew date in the product. The
 * weekday wording also matches the existing `WEEKDAY_LABELS` + "יום " convention
 * used by the Teaching-Practice modules.
 *
 * ===========================================================================
 * ONE RESULT: ALL DAYS, OR NO DAYS
 * ===========================================================================
 * Validation is ALL-OR-NOTHING. Any malformed row, or any duplicate
 * `sessionId`, fails the WHOLE call: `{ ok: false, issues }` with no days at all.
 *
 * The alternative — dropping bad rows and rendering the rest — is wrong for a
 * MANAGEMENT schedule. A silently shortened exam day looks exactly like a
 * correctly short one, and a manager would staff and publish from it. Refusing
 * the screen is loud, recoverable, and cannot mislead. Two rows sharing a
 * `sessionId` are likewise never collapsed, de-duplicated or "last one wins":
 * that would erase a real, editable session from the manager's view.
 *
 * Nothing here throws for ordinary malformed input — every diagnostic is a
 * value. (A caller passing something that is not an array at all is reported the
 * same way rather than crashing a page.)
 */
import { isValidHHMM } from "./exam-overlap-core";
import { isValidDateKey } from "../trainee-history/interval-resolver";

// ===========================================================================
// Input
// ===========================================================================

/**
 * ONE stored exam session as the admin schedule screen needs it.
 *
 * Every field is a PLAIN JSON scalar. `updatedAt` is epoch MILLISECONDS, never a
 * `Date` — matching the committed admin read DTO convention (`row.updatedAt.getTime()`
 * at the IO boundary), so no `Date` ever crosses into a pure core or a client
 * component.
 *
 * `definitionKind` is an OPAQUE display token here. Whether a kind is storable,
 * beginner-forbidden or otherwise legal is the domain core's question, asked
 * where the definition and the plan are visible; a presentation core that
 * re-judged it could only guess, and a wrong "allowed" would be worse than no
 * check.
 *
 * There is deliberately no `endTime`, no `courseOfferingId`, no `planId`, no
 * publication field, no assignment payload and no student identity: none of them
 * is needed to group by day, and an unused field on a list row is a field a
 * later edit will start trusting.
 */
export interface GroupableAdminExamSession {
  readonly sessionId: string;
  readonly definitionId: string;
  readonly definitionName: string;
  readonly definitionKind: string;
  /** Opaque calendar day, `YYYY-MM-DD`. */
  readonly dateKey: string;
  /** Zero-padded `HH:MM`, 00:00–23:59. */
  readonly startTime: string;
  readonly arena: string | null;
  readonly title: string | null;
  readonly notes: string | null;
  /** The manager's sequence within its day. Non-negative safe integer. */
  readonly orderIndex: number;
  /** Epoch milliseconds. Non-negative safe integer. */
  readonly updatedAt: number;
  /** How many assignments the session holds. Non-negative safe integer. */
  readonly assignmentCount: number;
}

// ===========================================================================
// Issues
// ===========================================================================

/**
 * Every diagnostic this core can produce. The code STRINGS are the contract and
 * must not be renamed once consumed downstream.
 *
 * There is no code describing a database outcome, an authorization failure, a
 * conflict, a capacity problem or a publication state: none of those is visible
 * from here.
 */
export type AdminExamScheduleGroupingIssueCode =
  | "EX-ASG-INPUT-NOT-A-LIST"
  | "EX-ASG-ROW-INVALID"
  | "EX-ASG-SESSION-ID-INVALID"
  | "EX-ASG-SESSION-ID-DUPLICATE"
  | "EX-ASG-DEFINITION-ID-INVALID"
  | "EX-ASG-DEFINITION-NAME-INVALID"
  | "EX-ASG-DEFINITION-KIND-INVALID"
  | "EX-ASG-DATE-INVALID"
  | "EX-ASG-START-TIME-INVALID"
  | "EX-ASG-ARENA-INVALID"
  | "EX-ASG-TITLE-INVALID"
  | "EX-ASG-NOTES-INVALID"
  | "EX-ASG-ORDER-INDEX-INVALID"
  | "EX-ASG-UPDATED-AT-INVALID"
  | "EX-ASG-ASSIGNMENT-COUNT-INVALID";

/**
 * The authoritative code → Hebrew message table. The exhaustive
 * `Record<AdminExamScheduleGroupingIssueCode, string>` annotation forces every
 * code — present or future — to carry a message or this file will not compile.
 *
 * The messages are deliberately NON-ECHOING: none contains a placeholder, a
 * submitted value, a name, a title, a note or a count, so a diagnostic can never
 * turn into a data channel.
 */
export const ADMIN_EXAM_SCHEDULE_GROUPING_MESSAGES: Readonly<
  Record<AdminExamScheduleGroupingIssueCode, string>
> = Object.freeze({
  "EX-ASG-INPUT-NOT-A-LIST": "רשימת מפגשי הבחינה אינה תקינה",
  "EX-ASG-ROW-INVALID": "רשומת מפגש בחינה אינה תקינה",
  "EX-ASG-SESSION-ID-INVALID": "למפגש בחינה חסר מזהה תקין",
  "EX-ASG-SESSION-ID-DUPLICATE": "אותו מזהה מפגש בחינה הופיע יותר מפעם אחת",
  "EX-ASG-DEFINITION-ID-INVALID": "למפגש בחינה חסר מזהה הגדרת בחינה תקין",
  "EX-ASG-DEFINITION-NAME-INVALID": "למפגש בחינה חסר שם הגדרת בחינה תקין",
  "EX-ASG-DEFINITION-KIND-INVALID": "למפגש בחינה חסר סוג בחינה תקין",
  "EX-ASG-DATE-INVALID": "תאריך מפגש הבחינה אינו תקין",
  "EX-ASG-START-TIME-INVALID": "שעת ההתחלה של מפגש הבחינה אינה תקינה (HH:MM)",
  "EX-ASG-ARENA-INVALID": "שדה המגרש של מפגש הבחינה אינו תקין",
  "EX-ASG-TITLE-INVALID": "שדה הכותרת של מפגש הבחינה אינו תקין",
  "EX-ASG-NOTES-INVALID": "שדה ההערות של מפגש הבחינה אינו תקין",
  "EX-ASG-ORDER-INDEX-INVALID": "סדר ההצגה של מפגש הבחינה אינו תקין",
  "EX-ASG-UPDATED-AT-INVALID": "חותמת העדכון של מפגש הבחינה אינה תקינה",
  "EX-ASG-ASSIGNMENT-COUNT-INVALID": "מספר השיבוצים של מפגש הבחינה אינו תקין",
});

/**
 * One diagnostic.
 *
 * `index` is the row's position in the INPUT list, so a row whose id is itself
 * unreadable stays observable. `sessionId` is echoed ONLY when it is a usable
 * string, and is `null` otherwise — never a guessed or synthesized id.
 *
 * Deliberately NO name, title, note, arena or count: an issue list is
 * diagnostic, not a PII or content channel.
 */
export interface AdminExamScheduleGroupingIssue {
  readonly code: AdminExamScheduleGroupingIssueCode;
  readonly message: string;
  readonly index: number;
  readonly sessionId: string | null;
}

// ===========================================================================
// Output
// ===========================================================================

/**
 * One session as the admin day list renders it.
 *
 * These are the input row's own values, carried through verbatim, MINUS
 * `dateKey`: the day owns the date, and a second copy on every session is a
 * second thing to keep in step.
 *
 * No derived session-level value is added. The only derivations this core is
 * entitled to make are the day's two LABELS (see the header); an end time, a
 * duration, a wave, a slot, a capacity reading or a "has assignments" flag would
 * each either fabricate data this row cannot know or restate a one-token check
 * the view can make for itself.
 *
 * `arena` / `title` / `notes` stay EXACTLY as given, including `null`. They are
 * not trimmed and blank is not collapsed: normalization is the WRITE path's job
 * (`exam-session-write-core` already trims and nulls blanks before storing), and
 * a read-side core that silently re-normalized would hide a stored value the
 * manager is looking at from the manager who could fix it.
 */
export interface GroupedAdminExamSession {
  readonly sessionId: string;
  readonly definitionId: string;
  readonly definitionName: string;
  readonly definitionKind: string;
  readonly startTime: string;
  readonly arena: string | null;
  readonly title: string | null;
  readonly notes: string | null;
  readonly orderIndex: number;
  readonly updatedAt: number;
  readonly assignmentCount: number;
}

/** One calendar day of the admin exam schedule. Never empty. */
export interface AdminExamScheduleDay {
  /** Opaque calendar day, `YYYY-MM-DD`, exactly as the rows carried it. */
  readonly dateKey: string;
  /** e.g. `"יום ראשון"`. */
  readonly dayLabel: string;
  /** e.g. `"2 באוגוסט 2026"`. */
  readonly dateLabel: string;
  readonly sessions: readonly GroupedAdminExamSession[];
}

/**
 * A discriminated, JSON-safe result.
 *
 * The success arm carries NO `issues` key and the failure arm carries NO `days`
 * key, so no property is ever present-but-`undefined` and
 * `JSON.parse(JSON.stringify(result))` deep-equals the result itself. Nothing in
 * either arm is a `Date`, `Map`, `Set`, `BigInt`, `Error` or class instance.
 */
export type AdminExamScheduleGroupingResult =
  | { readonly ok: true; readonly days: readonly AdminExamScheduleDay[] }
  | { readonly ok: false; readonly issues: readonly AdminExamScheduleGroupingIssue[] };

// ===========================================================================
// Hebrew labels — tables + Date-free calendar arithmetic
// ===========================================================================

/**
 * Sunday-first weekday labels, byte-identical to `formatHebrewWeekday`
 * (`Intl.DateTimeFormat("he-IL", { weekday: "long" })`) and to the existing
 * `WEEKDAY_LABELS` + "יום " convention in the Teaching-Practice modules.
 */
const HEBREW_WEEKDAY_LABELS: readonly string[] = Object.freeze([
  "יום ראשון",
  "יום שני",
  "יום שלישי",
  "יום רביעי",
  "יום חמישי",
  "יום שישי",
  "יום שבת",
]);

/**
 * Month labels WITH the Hebrew "ב" prefix the long form takes, byte-identical to
 * `formatHebrewDate` (`Intl.DateTimeFormat("he-IL", { day: "numeric", month:
 * "long", year: "numeric" })`), which renders `2026-08-02` as "2 באוגוסט 2026".
 */
const HEBREW_MONTH_LABELS: readonly string[] = Object.freeze([
  "בינואר",
  "בפברואר",
  "במרץ",
  "באפריל",
  "במאי",
  "ביוני",
  "ביולי",
  "באוגוסט",
  "בספטמבר",
  "באוקטובר",
  "בנובמבר",
  "בדצמבר",
]);

/**
 * Days since 1970-01-01 for a proleptic-Gregorian y/m/d — the standard
 * days-from-civil algorithm, integer arithmetic only.
 *
 * No `Date`, no epoch millisecond, no timezone and no clock: the result depends
 * on the three integers and nothing else, so it is identical on every machine.
 * Only ever called with an ALREADY-VALIDATED `YYYY-MM-DD`, so no range guard is
 * restated here.
 */
function daysFromCivil(year: number, month: number, day: number): number {
  const shiftedYear = month <= 2 ? year - 1 : year;
  const era = Math.floor(shiftedYear / 400);
  const yearOfEra = shiftedYear - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

/**
 * Weekday index for a valid date key, Sunday = 0.
 *
 * 1970-01-01 (day 0) was a THURSDAY, i.e. index 4, which is what the `+ 11`
 * encodes; the extra `+ 7` inside it keeps the modulus non-negative for dates
 * before 1970, so the function stays total.
 */
function weekdayIndex(year: number, month: number, day: number): number {
  return ((daysFromCivil(year, month, day) % 7) + 11) % 7;
}

/** The two day headings for a valid `YYYY-MM-DD`. Never reads a clock. */
function dayLabels(dateKeyToken: string): { dayLabel: string; dateLabel: string } {
  const year = Number(dateKeyToken.slice(0, 4));
  const month = Number(dateKeyToken.slice(5, 7));
  const day = Number(dateKeyToken.slice(8, 10));
  return {
    dayLabel: HEBREW_WEEKDAY_LABELS[weekdayIndex(year, month, day)],
    // `day` is numeric, not zero-padded — exactly what `day: "numeric"` renders.
    dateLabel: `${day} ${HEBREW_MONTH_LABELS[month - 1]} ${year}`,
  };
}

// ===========================================================================
// Field helpers
// ===========================================================================

/**
 * Read one OWN property of a raw value, or `undefined`.
 *
 * Own-property only: a raw object inherits `toString`, `constructor` and friends
 * from its prototype, and reading those as if they were row data would turn
 * prototype members into schedule content.
 */
function readField(source: unknown, key: string): unknown {
  if (typeof source !== "object" || source === null) return undefined;
  if (!Object.prototype.hasOwnProperty.call(source, key)) return undefined;
  return (source as Record<string, unknown>)[key];
}

/** A non-blank string, or `null`. NO COERCION: a number is refused, not stringified. */
function requiredString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.trim().length > 0 ? value : null;
}

/**
 * Optional text: `string` or `null`, and NOTHING else.
 *
 * `undefined`, a number, a boolean, an array, an object or a function all FAIL
 * CLOSED rather than degrading to `null` — a row that reached this core with a
 * non-string in a text column is a defect upstream, and rendering it as "empty"
 * would hide that defect behind a plausible-looking screen. The value is
 * returned untouched (see `GroupedAdminExamSession`: no trimming, no blank
 * collapsing).
 */
function optionalText(value: unknown): { ok: true; value: string | null } | { ok: false } {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false };
  return { ok: true, value };
}

/**
 * A non-negative safe integer.
 *
 * Rejects `NaN`, `Infinity`, negatives, fractions, values beyond
 * `Number.MAX_SAFE_INTEGER`, numeric strings and every non-number — no coercion
 * anywhere. `-0` passes (it IS zero) and is normalized to `0` at the point of
 * use, so no `-0` can reach the output or JSON.
 */
function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

// ===========================================================================
// Comparators
// ===========================================================================

/**
 * Plain code-point string comparison. Deliberately NOT `localeCompare` and not
 * `Intl.Collator`: a locale-aware order can differ between a developer machine,
 * CI and the server, and a schedule that renders in two different orders is a
 * bug report nobody can reproduce. The trade-off is that `definitionName` ties
 * break by code point rather than by Hebrew alphabetical order — it is a
 * TIE-BREAK, reached only when `orderIndex` and `startTime` are both equal, and
 * determinism matters more there than collation.
 */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The locked within-day order: `orderIndex`, `startTime`, `definitionName`,
 * `sessionId`.
 *
 * `orderIndex` LEADS. It is the manager's own sequence, assigned per plan and
 * date by the committed session writer, and on an exam day the intended sequence
 * routinely disagrees with the clock (two blocks share a start time, or a later
 * block is meant to be read first). Sorting by `startTime` first — as the
 * separate EX-C1 projection does for its own views — would silently re-sequence
 * that. `sessionId` is the final deterministic tie-break, so the order is TOTAL
 * and cannot depend on input order.
 */
function compareWithinDay(a: GroupedAdminExamSession, b: GroupedAdminExamSession): number {
  return (
    a.orderIndex - b.orderIndex ||
    cmp(a.startTime, b.startTime) ||
    cmp(a.definitionName, b.definitionName) ||
    cmp(a.sessionId, b.sessionId)
  );
}

/** Issue order: input position, then code. Total, and independent of check order. */
function compareIssues(
  a: AdminExamScheduleGroupingIssue,
  b: AdminExamScheduleGroupingIssue,
): number {
  return a.index - b.index || cmp(a.code, b.code);
}

function makeIssue(
  code: AdminExamScheduleGroupingIssueCode,
  index: number,
  sessionId: string | null,
): AdminExamScheduleGroupingIssue {
  return Object.freeze({
    code,
    message: ADMIN_EXAM_SCHEDULE_GROUPING_MESSAGES[code],
    index,
    sessionId,
  });
}

// ===========================================================================
// The grouping
// ===========================================================================

/**
 * Group ALREADY-READ, ALREADY-AUTHORIZED stored exam sessions into the admin
 * schedule's calendar days.
 *
 * Rules (all locked by admin-exam-session-grouping-core.test.ts):
 *
 *  - EVERY row is validated first. One malformed row, or one duplicate
 *    `sessionId`, fails the WHOLE call — see "ONE RESULT" in the header. Every
 *    applicable issue is reported, not just the first, so one pass shows the
 *    manager (and the log) the complete picture.
 *  - Days are grouped by EXACT `dateKey` string equality — no calendar
 *    arithmetic, no timezone math, no range or fuzzy matching — and sorted
 *    ASCENDING by it. For zero-padded `YYYY-MM-DD`, code-point order IS
 *    chronological order, so no `Date` is ever constructed.
 *  - Sessions inside a day are ordered by `orderIndex`, `startTime`,
 *    `definitionName`, `sessionId`. That order is TOTAL: two different inputs
 *    holding the same rows in a different sequence produce byte-identical output.
 *  - `dayLabel` / `dateLabel` are derived from the day's own `dateKey` by integer
 *    arithmetic, never from a clock and never through `Intl`.
 *  - NOTHING is dropped, merged, de-duplicated or hidden. A day is emitted iff at
 *    least one row carries its `dateKey`, so no empty day can be produced, and a
 *    session with zero assignments is grouped like any other.
 *
 * Never mutates the input array or any input row: rows are re-shaped into fresh
 * frozen objects and every array is freshly allocated, so a frozen input is fine
 * and an unfrozen one comes back untouched. The returned result, its day array,
 * every day, every session array, every session and every issue are FROZEN, and
 * the whole result is JSON-safe (plain objects and scalars only, no `undefined`,
 * no `Date`).
 *
 * Never throws for malformed input — including input that is not an array at all.
 */
export function groupAdminExamSessionsByDay(
  sessions: readonly GroupableAdminExamSession[],
): AdminExamScheduleGroupingResult {
  if (!Array.isArray(sessions)) {
    return Object.freeze({
      ok: false as const,
      issues: Object.freeze([makeIssue("EX-ASG-INPUT-NOT-A-LIST", -1, null)]),
    });
  }

  const issues: AdminExamScheduleGroupingIssue[] = [];
  const accepted: { dateKey: string; session: GroupedAdminExamSession }[] = [];
  const seenSessionIds = new Set<string>();

  for (let index = 0; index < sessions.length; index += 1) {
    const raw: unknown = sessions[index];
    if (typeof raw !== "object" || raw === null) {
      issues.push(makeIssue("EX-ASG-ROW-INVALID", index, null));
      continue;
    }

    const sessionId = requiredString(readField(raw, "sessionId"));
    if (sessionId === null) {
      issues.push(makeIssue("EX-ASG-SESSION-ID-INVALID", index, null));
    } else if (seenSessionIds.has(sessionId)) {
      // Reported, never collapsed: two rows sharing an id are two rows, and
      // silently keeping one would erase a session from the manager's schedule.
      issues.push(makeIssue("EX-ASG-SESSION-ID-DUPLICATE", index, sessionId));
    } else {
      seenSessionIds.add(sessionId);
    }

    const definitionId = requiredString(readField(raw, "definitionId"));
    if (definitionId === null) {
      issues.push(makeIssue("EX-ASG-DEFINITION-ID-INVALID", index, sessionId));
    }

    const definitionName = requiredString(readField(raw, "definitionName"));
    if (definitionName === null) {
      issues.push(makeIssue("EX-ASG-DEFINITION-NAME-INVALID", index, sessionId));
    }

    const definitionKind = requiredString(readField(raw, "definitionKind"));
    if (definitionKind === null) {
      issues.push(makeIssue("EX-ASG-DEFINITION-KIND-INVALID", index, sessionId));
    }

    // The committed real-calendar validator: exact `YYYY-MM-DD`, leap years
    // honoured, `2026-02-31` refused, no `Date` constructed, no trimming.
    const rawDateKey: unknown = readField(raw, "dateKey");
    const dateKeyValid = isValidDateKey(rawDateKey);
    if (!dateKeyValid) {
      issues.push(makeIssue("EX-ASG-DATE-INVALID", index, sessionId));
    }

    // The committed exam-slice time primitive: exact zero-padded `HH:mm`, so
    // `"9:00"`, `"24:00"` and `" 09:00"` are all refused.
    const rawStartTime: unknown = readField(raw, "startTime");
    const startTimeValid = isValidHHMM(rawStartTime);
    if (!startTimeValid) {
      issues.push(makeIssue("EX-ASG-START-TIME-INVALID", index, sessionId));
    }

    const arena = optionalText(readField(raw, "arena"));
    if (!arena.ok) {
      issues.push(makeIssue("EX-ASG-ARENA-INVALID", index, sessionId));
    }

    const title = optionalText(readField(raw, "title"));
    if (!title.ok) {
      issues.push(makeIssue("EX-ASG-TITLE-INVALID", index, sessionId));
    }

    const notes = optionalText(readField(raw, "notes"));
    if (!notes.ok) {
      issues.push(makeIssue("EX-ASG-NOTES-INVALID", index, sessionId));
    }

    const rawOrderIndex: unknown = readField(raw, "orderIndex");
    if (!isNonNegativeInteger(rawOrderIndex)) {
      issues.push(makeIssue("EX-ASG-ORDER-INDEX-INVALID", index, sessionId));
    }

    const rawUpdatedAt: unknown = readField(raw, "updatedAt");
    if (!isNonNegativeInteger(rawUpdatedAt)) {
      issues.push(makeIssue("EX-ASG-UPDATED-AT-INVALID", index, sessionId));
    }

    const rawAssignmentCount: unknown = readField(raw, "assignmentCount");
    if (!isNonNegativeInteger(rawAssignmentCount)) {
      issues.push(makeIssue("EX-ASG-ASSIGNMENT-COUNT-INVALID", index, sessionId));
    }

    // Nothing is accumulated once ANY issue exists: the call has already failed,
    // and building days that will be thrown away only invites a future edit to
    // return them.
    if (issues.length > 0) continue;

    // Reached ONLY when every field of every row so far validated, which is what
    // proves the narrowing assertions below. They restate that proof for the
    // type system and widen nothing at runtime.
    accepted.push({
      dateKey: rawDateKey as string,
      session: Object.freeze({
        sessionId: sessionId as string,
        definitionId: definitionId as string,
        definitionName: definitionName as string,
        definitionKind: definitionKind as string,
        startTime: rawStartTime as string,
        arena: (arena as { value: string | null }).value,
        title: (title as { value: string | null }).value,
        notes: (notes as { value: string | null }).value,
        // `+ 0` normalizes a `-0` input so `Object.is(value, -0)` can never be
        // true in the output and `JSON.stringify` round-trips exactly.
        orderIndex: (rawOrderIndex as number) + 0,
        updatedAt: (rawUpdatedAt as number) + 0,
        assignmentCount: (rawAssignmentCount as number) + 0,
      }),
    });
  }

  if (issues.length > 0) {
    return Object.freeze({
      ok: false as const,
      issues: Object.freeze([...issues].sort(compareIssues)),
    });
  }

  const byDay = new Map<string, GroupedAdminExamSession[]>();
  for (const entry of accepted) {
    const bucket = byDay.get(entry.dateKey);
    if (bucket === undefined) byDay.set(entry.dateKey, [entry.session]);
    else bucket.push(entry.session);
  }

  const days = [...byDay.entries()]
    .sort(([a], [b]) => cmp(a, b))
    .map(([dayKey, daySessions]) => {
      const { dayLabel, dateLabel } = dayLabels(dayKey);
      return Object.freeze({
        dateKey: dayKey,
        dayLabel,
        dateLabel,
        sessions: Object.freeze([...daySessions].sort(compareWithinDay)),
      });
    });

  return Object.freeze({ ok: true as const, days: Object.freeze(days) });
}
