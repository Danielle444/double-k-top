/**
 * EXAM EX-S5A-2 — PURE Teaching-Practice source adapter core.
 *
 * PURE by construction: no Prisma, no generated Prisma type, no DB, no Next, no
 * React, no clock (`Date.now` / `new Date`), no randomness, no env, no
 * auth/session/cookie, no filesystem, no network, no `"use server"`.
 * Deterministic; never mutates its inputs; never throws for malformed runtime
 * input; every returned value is frozen.
 *
 * WHAT THIS ANSWERS (and only this): given the PLAIN SCALAR rows of the
 * Teaching-Practice lessons that the plan's selected source dates already
 * yielded, which of them are USABLE as live beginner exam input, and what is
 * their operational sibling detail?
 *
 *   - `lessons` — the compact source rows, shaped EXACTLY as the committed
 *                 `LiveBeginnerLessonSource` contract, ready to hand straight to
 *                 `projectLiveBeginnerRows` with no further shaping;
 *   - `details` — the SIBLING operational payload (children, parent contacts,
 *                 raw participant rows, display names) keyed by `lessonId`;
 *   - `issues`  — the fail-closed diagnostics behind every exclusion.
 *
 * ===========================================================================
 * LIVE PROJECTION — NOTHING IS COPIED, NOTHING IS STORED
 * ===========================================================================
 * Beginner exam rows are a LIVE PROJECTION of Teaching Practice. This adapter
 * performs no IO, so it cannot write back to Teaching Practice even in
 * principle, and it produces NOTHING to persist: its output is a per-request
 * value. There is no snapshot, no fingerprint, no staleness comparison and no
 * cache. A Teaching-Practice edit is reflected by calling it again with freshly
 * read input.
 *
 * ===========================================================================
 * WHAT IS DELIBERATELY ABSENT
 * ===========================================================================
 *  - NO database access, and no query shape. Loading the rows is EX-S5A-3.
 *  - NO role, publication, capability or course-scoping logic. That is EX-S5A-4;
 *    this core knows nothing about who is asking. It carries `isPublished` as
 *    DATA and never filters on it, so admin, instructor and trainee readers all
 *    consume the SAME output and apply their own gate above it.
 *  - NO viewer, no `isSelf` and no self-matching of any kind. Self-assignment is
 *    owned by the committed live adapter, on authoritative student ids only.
 *  - NO projection row and no synthetic live session id. Both belong to the
 *    committed live adapter, which is the ONLY place a live beginner row is
 *    built; re-deriving either here would create the second source of truth the
 *    module exists to prevent.
 *  - NO practice-type → format table. The committed
 *    `mapPracticeTypeToBeginnerFormat` is the only mapping, used here purely as
 *    a REJECTION PREDICATE; the format itself is derived once, downstream.
 *  - NO feedback, rating, grade, score or result — not nulled, not optional:
 *    ABSENT. The Exams area is scheduling and operational information only, and
 *    the EX-S5A-3 loader must use its own narrow select so nothing of the kind
 *    ever leaves the database. `exam-no-feedback-guard.test.ts` enforces this
 *    across the whole exam slice.
 *
 * ===========================================================================
 * ONE AUTHORITATIVE REJECTION LAYER PER ROW
 * ===========================================================================
 * The committed live adapter also rejects an unmapped practice type and an
 * illegible lesson id. That is NOT duplicated reporting: a row this adapter
 * excludes never reaches the live adapter, so exactly ONE diagnostic fires for
 * it — this one, which is the upstream layer and the one that can also see the
 * date/time defects the live adapter does not inspect. The live adapter's own
 * rejections remain a silent inner defence for output produced here, and stay
 * meaningful for any other caller.
 *
 * At most ONE exclusion issue is emitted per lesson, in the fixed order
 * id → date → time → range → practice type, so a thoroughly malformed row
 * produces one legible reason rather than a pile.
 *
 * ===========================================================================
 * OPAQUE TOKENS — NO CALENDAR, NO TIMEZONE
 * ===========================================================================
 * `date` arrives as an ALREADY-NORMALIZED `YYYY-MM-DD` token and `createdAt` as
 * an already-normalized sortable token. This core accepts no `Date`, constructs
 * no `Date`, and performs no timezone or calendar arithmetic — the loader
 * converts once and this core compares opaque strings, exactly as every other
 * exam core does. `HH:MM` parsing is not reimplemented: it comes from the
 * committed `exam-overlap-core`.
 */
import type {
  LiveBeginnerChildSource,
  LiveBeginnerLessonSource,
  LiveBeginnerParticipantSource,
} from "./exam-live-beginner-adapter-core";
import { mapPracticeTypeToBeginnerFormat } from "./exam-beginner-format-core";
import { isValidHHMM, parseHHMM } from "./exam-overlap-core";

// ===========================================================================
// Adapter issue codes + Hebrew messages
// ===========================================================================

/**
 * Stable, non-PII adapter issue codes. The code STRINGS are the contract and
 * must not be renamed once consumed downstream.
 *
 * Every code EXCEPT `EX-TP-ADP-PARTICIPANT-TRAINEE-DUPLICATE` is EXCLUSIONARY:
 * the subject row did not reach the live projection. The duplicate code is
 * deliberately REPORT-ONLY — see the participant policy below.
 */
export type TeachingPracticeSourceAdapterIssueCode =
  /** A lesson row carries no legible id, so nothing can be keyed to it. */
  | "EX-TP-ADP-LESSON-ID-REQUIRED"
  /** The lesson's date is not a `YYYY-MM-DD` token. */
  | "EX-TP-ADP-DATE-INVALID"
  /** The lesson's start or end is not a legal `HH:MM`. */
  | "EX-TP-ADP-TIME-INVALID"
  /** Both endpoints are legal `HH:MM` but the end is not later than the start. */
  | "EX-TP-ADP-TIME-RANGE-INVALID"
  /** The practice type maps to no beginner format. */
  | "EX-TP-ADP-PRACTICE-TYPE-UNSUPPORTED"
  /** A participant row carries no legible id, so nothing can be keyed to it. */
  | "EX-TP-ADP-PARTICIPANT-ID-REQUIRED"
  /** A participant carries a role token the Teaching-Practice domain does not define. */
  | "EX-TP-ADP-PARTICIPANT-ROLE-INVALID"
  /** REPORT-ONLY: the same trainee is assigned twice to one lesson. */
  | "EX-TP-ADP-PARTICIPANT-TRAINEE-DUPLICATE"
  /** A child assignment carries no legible id, so nothing can be keyed to it. */
  | "EX-TP-ADP-CHILD-ASSIGNMENT-ID-REQUIRED";

/**
 * The authoritative code → Hebrew message table. The exhaustive
 * `Record<TeachingPracticeSourceAdapterIssueCode, string>` annotation forces
 * every code — present or future — to carry a message or this file will not
 * compile.
 */
export const TEACHING_PRACTICE_SOURCE_ADAPTER_MESSAGES: Readonly<
  Record<TeachingPracticeSourceAdapterIssueCode, string>
> = Object.freeze({
  "EX-TP-ADP-LESSON-ID-REQUIRED":
    "לשיעור התנסות חסר מזהה — לא ניתן להציג אותו כשורת בחינת מתחילים",
  "EX-TP-ADP-DATE-INVALID":
    "תאריך שיעור ההתנסות אינו תקין — השיעור אינו נכלל בבחינות",
  "EX-TP-ADP-TIME-INVALID":
    "שעת ההתחלה או שעת הסיום של שיעור ההתנסות אינה תקינה — השיעור אינו נכלל בבחינות",
  "EX-TP-ADP-TIME-RANGE-INVALID":
    "שעת הסיום של שיעור ההתנסות אינה מאוחרת משעת ההתחלה — השיעור אינו נכלל בבחינות",
  "EX-TP-ADP-PRACTICE-TYPE-UNSUPPORTED":
    "סוג ההתנסות אינו נתמך כמתכונת בחינת מדריך מתחילים — השיעור אינו נכלל בבחינות",
  "EX-TP-ADP-PARTICIPANT-ID-REQUIRED":
    "למשתתף בשיעור ההתנסות חסר מזהה — המשתתף אינו נכלל",
  "EX-TP-ADP-PARTICIPANT-ROLE-INVALID":
    "תפקיד המשתתף בשיעור ההתנסות אינו תקין — המשתתף אינו נכלל ברשימת הנבחנים",
  "EX-TP-ADP-PARTICIPANT-TRAINEE-DUPLICATE":
    "אותו חניך משובץ יותר מפעם אחת באותו שיעור התנסות — השיבוצים נשמרו לבדיקה",
  "EX-TP-ADP-CHILD-ASSIGNMENT-ID-REQUIRED":
    "לשיבוץ ילד בשיעור ההתנסות חסר מזהה — השיבוץ אינו נכלל",
});

/**
 * One adapter issue.
 *
 * Carries ONLY stable identifiers, and never a trainee id, a trainee name, a
 * child name, a parent name, a phone number, a horse name or a note. An issue
 * list is a diagnostic channel, never a PII channel — the same rule the stored
 * adapter, the trainee-view core and the grouping core already hold themselves
 * to. Note in particular that the DUPLICATE issue reports the PARTICIPANT id,
 * never the trainee id it duplicates.
 *
 * A field is `null` when it does not apply, or when the underlying value was
 * itself illegible (a blank lesson id cannot be echoed back).
 */
export interface TeachingPracticeSourceAdapterIssue {
  readonly code: TeachingPracticeSourceAdapterIssueCode;
  readonly message: string;
  readonly lessonId: string | null;
  readonly participantId: string | null;
  readonly childAssignmentId: string | null;
}

// ===========================================================================
// Input — PRISMA-NEUTRAL scalar rows
// ===========================================================================

/**
 * One `TeachingPracticeParticipant` row joined to its trainee's display name.
 *
 * `role` is a plain `string` RUNTIME TOKEN rather than an enum: the value
 * arrives from a database enum column, and this adapter is the boundary that
 * proves it is a role the Teaching-Practice domain defines. `traineeId` and
 * `traineeName` are independently nullable — a row may legitimately hold a
 * display name with no authoritative identity, and the identity is NEVER
 * derived from the name.
 */
export interface TeachingPracticeExamParticipantRow {
  readonly id: string;
  readonly traineeId: string | null;
  readonly traineeName: string | null;
  readonly role: string;
  readonly isManualOverride: boolean;
  /** Opaque sortable creation token. Ordering only; never parsed as a date. */
  readonly createdAt: string;
}

/**
 * One `TeachingPracticeChildAssignment` row joined to its child.
 *
 * Every contact field is carried RAW. This core never normalizes, reformats or
 * validates a phone number, never builds a dial or messaging link (the guard in
 * the sibling suite forbids the tokens outright, so they are not even named
 * here), and never
 * merges or infers siblings from a shared parent contact.
 */
export interface TeachingPracticeExamChildAssignmentRow {
  readonly id: string;
  readonly childId: string | null;
  readonly childName: string | null;
  readonly childAge: number | null;
  readonly childGender: string | null;
  readonly childNotes: string | null;
  readonly parentName: string | null;
  readonly parentPhone: string | null;
  readonly horseName: string | null;
  readonly equipmentNotes: string | null;
  readonly isAbsent: boolean;
}

/**
 * One `TeachingPracticeLesson` row plus its bounded children, as read for the
 * exam projection.
 *
 * `roleLabelOverrides` is typed `unknown` because it is an unvalidated JSON
 * column: this adapter is the boundary that turns it into the typed shape the
 * committed live contract declares, failing closed to `null` for anything else.
 *
 * `isPublished` is carried as DATA. It is NEVER a filter here — see the
 * publication note in the file header.
 */
export interface TeachingPracticeExamLessonRow {
  readonly id: string;
  /** Raw `TeachingPracticeType` token. Mapped by the committed format core. */
  readonly practiceType: string;
  /** Opaque calendar day, `YYYY-MM-DD`. Never a `Date`. */
  readonly date: string;
  readonly startTime: string;
  readonly endTime: string;
  /** Opaque sortable creation token. Ordering tiebreak only; never parsed. */
  readonly createdAt: string;
  readonly groupName: string | null;
  readonly location: string | null;
  /** The LESSON's own notes (a child's notes live on the child). */
  readonly notes: string | null;
  readonly isPublished: boolean;
  /** Unvalidated JSON. Normalized here; malformed values fail closed to null. */
  readonly roleLabelOverrides: unknown | null;
  readonly responsibleInstructorId: string | null;
  readonly responsibleInstructorName: string | null;
  readonly participants: readonly TeachingPracticeExamParticipantRow[];
  readonly childAssignments: readonly TeachingPracticeExamChildAssignmentRow[];
}

// ===========================================================================
// Output — the SIBLING operational detail
// ===========================================================================

/**
 * One participant row as OPERATIONAL DETAIL.
 *
 * `traineeId` is the AUTHORITATIVE identity and is `null` when the source row
 * carries none — it is never derived from, or reconciled against,
 * `traineeName`, which is DISPLAY-ONLY. `isProjected` records whether this row
 * reached the compact source: a participant whose role token is unrecognised is
 * retained here as evidence but contributes no examinee identity.
 */
export interface TeachingPracticeExamParticipantDetail {
  readonly participantId: string;
  /** Authoritative `Student.id`, or `null`. Never derived from a name. */
  readonly traineeId: string | null;
  /** Display-only. Never used to match, deduplicate or identify anybody. */
  readonly traineeName: string | null;
  /** The raw Teaching-Practice role token, verbatim. */
  readonly sourcePracticeRole: string;
  readonly isManualOverride: boolean;
  /** Opaque sortable creation token, verbatim. */
  readonly createdAt: string;
  /** False iff the role token was unrecognised, so the row was held back. */
  readonly isProjected: boolean;
}

/** One child assignment as OPERATIONAL DETAIL. Every field is carried RAW. */
export interface TeachingPracticeExamChildDetail {
  readonly childAssignmentId: string;
  readonly childId: string | null;
  readonly childName: string | null;
  readonly childAge: number | null;
  readonly childGender: string | null;
  readonly childNotes: string | null;
  readonly parentName: string | null;
  /** VERBATIM. Never normalized, and never turned into a link here. */
  readonly parentPhone: string | null;
  readonly horseName: string | null;
  readonly equipmentNotes: string | null;
  readonly isAbsent: boolean;
}

/**
 * The full operational payload of one usable source lesson — the SIBLING of the
 * compact source row, keyed by `lessonId`.
 *
 * It deliberately carries NO compact projection row, no synthetic session id, no
 * derived order index and no beginner format: those are produced downstream, by
 * the committed live adapter, from the compact source alone.
 */
export interface TeachingPracticeExamLessonDetail {
  readonly lessonId: string;
  readonly practiceType: string;
  readonly date: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly createdAt: string;
  readonly groupName: string | null;
  readonly location: string | null;
  readonly notes: string | null;
  /** Carried as DATA. The role-specific reader applies the gate, not this core. */
  readonly isPublished: boolean;
  /** The NORMALIZED overrides, or `null`. */
  readonly roleLabelOverrides: Readonly<Record<string, string>> | null;
  /** Authoritative instructor identity, or `null`. Never derived from a name. */
  readonly responsibleInstructorId: string | null;
  /** Display-only. Never used to identify or match an instructor. */
  readonly responsibleInstructorName: string | null;
  readonly participants: readonly TeachingPracticeExamParticipantDetail[];
  readonly childAssignments: readonly TeachingPracticeExamChildDetail[];
}

/**
 * The total result.
 *
 * `lessons` is exactly the committed live-beginner input contract and may be
 * handed to `projectLiveBeginnerRows` unchanged. `details[i]` describes
 * `lessons[i]` — both arrays carry the same rows in the same locked order, so a
 * caller may zip them positionally or key the detail by `lessonId`.
 */
export interface TeachingPracticeSourceAdapterResult {
  readonly lessons: readonly LiveBeginnerLessonSource[];
  readonly details: readonly TeachingPracticeExamLessonDetail[];
  readonly issues: readonly TeachingPracticeSourceAdapterIssue[];
}

// ===========================================================================
// Helpers
// ===========================================================================

/**
 * A `YYYY-MM-DD` SHAPE check. Not a calendar check — no `Date` is constructed.
 * No exam core exports one, and both `exam-overlap-core` and
 * `exam-schedule-projection-core` already keep this exact private constant; a
 * third identical shape check is the committed convention here, whereas
 * exporting one of theirs would mean editing a committed file.
 */
const DATE_TOKEN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The Teaching-Practice participant roles the domain defines. A frozen
 * own-property table so an inherited key (`__proto__`, `toString`, …) can never
 * validate as a role.
 *
 * ALL FOUR are trainee-participant roles: in a beginner lesson the trainees
 * themselves take the instructing roles, and the committed live adapter makes
 * EVERY one of them an examinee — the `EVALUATOR` included — while preserving
 * the exact original token. This set therefore gates LEGIBILITY only; it never
 * decides who is an examinee, and it is never used to infer a role from a
 * display label, a group name or a location.
 */
const PRACTICE_PARTICIPANT_ROLES: Readonly<Record<string, true>> = Object.freeze({
  LEAD_INSTRUCTOR: true,
  SECOND_INSTRUCTOR: true,
  ASSISTANT_INSTRUCTOR: true,
  EVALUATOR: true,
});

/** True only for a key the object owns directly (never an inherited/proto key). */
function hasOwn(target: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(target, key);
}

/** True iff the token is a role the Teaching-Practice domain defines. */
function isPracticeParticipantRole(value: unknown): value is string {
  return typeof value === "string" && hasOwn(PRACTICE_PARTICIPANT_ROLES, value);
}

/** A non-empty, trimmed identifier; otherwise absent. */
function isPresentId(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/** The trimmed id, or `null` when absent. Never derived from anything else. */
function idOrNull(v: unknown): string | null {
  return isPresentId(v) ? v.trim() : null;
}

/**
 * An opaque sortable token. A non-string normalizes to `""`, which keeps every
 * comparison total: the sort orders that use it always END in a UNIQUE key (the
 * lesson id / the participant id), so a missing token can never make the result
 * depend on input order. It is deliberately NOT an exclusion — the committed
 * live adapter uses `createdAt` as a tiebreak only and requires nothing of it.
 */
function sortToken(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Normalize the unvalidated `roleLabelOverrides` JSON into the typed shape the
 * committed live contract declares, or `null`.
 *
 * This is a PARSE of an untrusted column, not a re-implementation of the live
 * adapter's private defensive re-copy: that helper already receives the typed
 * shape and re-freezes it, and cannot be reached from here anyway. Everything
 * that is not a plain object of string values fails closed — an array, a string,
 * a number and `null` all yield `null`, non-string values are dropped, and
 * inherited keys never appear. `__proto__` is skipped explicitly rather than
 * assigned, so no prototype is ever touched. Never throws.
 */
function normalizeRoleLabelOverrides(value: unknown): Readonly<Record<string, string>> | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object") return null;
  if (Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const out: Record<string, string> = {};
  let count = 0;
  for (const key of Object.keys(source)) {
    if (!hasOwn(source, key)) continue;
    if (key === "__proto__") continue;
    const label = source[key];
    if (typeof label !== "string") continue;
    out[key] = label;
    count += 1;
  }
  return count === 0 ? null : Object.freeze(out);
}

/** Build a frozen issue, binding its canonical Hebrew message. */
function issue(
  code: TeachingPracticeSourceAdapterIssueCode,
  lessonId: string | null,
  participantId: string | null,
  childAssignmentId: string | null,
): TeachingPracticeSourceAdapterIssue {
  return Object.freeze({
    code,
    message: TEACHING_PRACTICE_SOURCE_ADAPTER_MESSAGES[code],
    lessonId,
    participantId,
    childAssignmentId,
  });
}

/**
 * The single lesson-level exclusion reason, or `null` when the lesson is usable.
 *
 * Checked in a FIXED order — id, date, time legibility, time range, practice
 * type — so a thoroughly malformed row reports one legible reason instead of a
 * pile, and so the reported reason is stable rather than dependent on which
 * check happened to run first.
 */
function lessonExclusionCode(
  row: TeachingPracticeExamLessonRow,
): TeachingPracticeSourceAdapterIssueCode | null {
  if (!isPresentId(row.id)) return "EX-TP-ADP-LESSON-ID-REQUIRED";
  if (typeof row.date !== "string" || !DATE_TOKEN.test(row.date)) {
    return "EX-TP-ADP-DATE-INVALID";
  }
  if (!isValidHHMM(row.startTime) || !isValidHHMM(row.endTime)) {
    return "EX-TP-ADP-TIME-INVALID";
  }
  const start = parseHHMM(row.startTime);
  const end = parseHHMM(row.endTime);
  if (start === null || end === null) return "EX-TP-ADP-TIME-INVALID";
  if (end <= start) return "EX-TP-ADP-TIME-RANGE-INVALID";
  // The committed mapping is the ONLY practice-type authority, and it is used
  // here purely as a predicate: the format itself is derived once, downstream.
  if (mapPracticeTypeToBeginnerFormat(row.practiceType) === null) {
    return "EX-TP-ADP-PRACTICE-TYPE-UNSUPPORTED";
  }
  return null;
}

// ===========================================================================
// The adapter
// ===========================================================================

/**
 * Adapt already-read Teaching-Practice lesson rows into the committed live
 * beginner input contract plus its sibling operational detail. Pure; never
 * mutates its inputs; deterministic regardless of input order.
 *
 * PARTICIPANT POLICY (locked):
 *  - rows are ordered by `(createdAt, participantId)` — the same total order the
 *    committed live adapter applies, so the two never disagree;
 *  - an ILLEGIBLE participant id excludes the row from BOTH payloads: nothing can
 *    be keyed to it, so retaining it would create an unaddressable ghost;
 *  - an UNRECOGNISED role token excludes the row from the compact source (so it
 *    contributes no examinee identity and is never defaulted to a trainee role)
 *    while RETAINING it in the detail with `isProjected: false`, so the defect
 *    stays visible instead of vanishing;
 *  - a BLANK trainee id is carried as `""` — the committed live adapter drops
 *    blank ids from its examinee set and its self-match compares a trimmed,
 *    non-empty viewer id, so `""` can never be counted or matched. The
 *    authoritative `null` is preserved in the detail;
 *  - DUPLICATE trainee ids are NEVER silently deduplicated. Deduplication here
 *    would hide a real source defect and would silently change the examinee
 *    count downstream, so both rows are projected VERBATIM and the duplication
 *    is REPORTED (report-only — nothing is excluded), leaving the evidence
 *    intact for the projection and for any later diagnostic.
 *
 * Participants are never matched, deduplicated or identified by name.
 */
export function adaptTeachingPracticeExamSources(
  rows: readonly TeachingPracticeExamLessonRow[],
): TeachingPracticeSourceAdapterResult {
  const issues: TeachingPracticeSourceAdapterIssue[] = [];
  const usable: TeachingPracticeExamLessonRow[] = [];

  const input = Array.isArray(rows) ? rows : [];
  for (const row of input) {
    if (row === null || typeof row !== "object") continue;
    const code = lessonExclusionCode(row);
    if (code !== null) {
      issues.push(issue(code, idOrNull(row.id), null, null));
      continue;
    }
    usable.push(row);
  }

  // Sort a COPY, on the SAME total order the committed live adapter applies:
  // (date, startTime, createdAt, lessonId). It ends in a unique key, so the
  // result cannot depend on the caller's array order.
  const ordered = [...usable].sort(
    (a, b) =>
      cmp(a.date, b.date) ||
      cmp(a.startTime, b.startTime) ||
      cmp(sortToken(a.createdAt), sortToken(b.createdAt)) ||
      cmp(a.id.trim(), b.id.trim()),
  );

  const lessons: LiveBeginnerLessonSource[] = [];
  const details: TeachingPracticeExamLessonDetail[] = [];

  for (const row of ordered) {
    const lessonId = row.id.trim();

    // --- participants ------------------------------------------------------
    const sourceParticipants = Array.isArray(row.participants) ? row.participants : [];
    const orderedParticipants = [...sourceParticipants]
      .filter((p) => p !== null && typeof p === "object")
      .sort(
        (a, b) =>
          cmp(sortToken(a.createdAt), sortToken(b.createdAt)) ||
          cmp(isPresentId(a.id) ? a.id.trim() : "", isPresentId(b.id) ? b.id.trim() : ""),
      );

    const participantSources: LiveBeginnerParticipantSource[] = [];
    const participantDetails: TeachingPracticeExamParticipantDetail[] = [];
    const seenTraineeIds = new Set<string>();

    for (const participant of orderedParticipants) {
      const participantId = idOrNull(participant.id);
      if (participantId === null) {
        issues.push(issue("EX-TP-ADP-PARTICIPANT-ID-REQUIRED", lessonId, null, null));
        continue;
      }

      const role = typeof participant.role === "string" ? participant.role : "";
      const traineeId = idOrNull(participant.traineeId);
      const traineeName =
        typeof participant.traineeName === "string" ? participant.traineeName : null;
      const isProjected = isPracticeParticipantRole(participant.role);

      if (!isProjected) {
        issues.push(
          issue("EX-TP-ADP-PARTICIPANT-ROLE-INVALID", lessonId, participantId, null),
        );
      }

      participantDetails.push(
        Object.freeze({
          participantId,
          traineeId,
          traineeName,
          sourcePracticeRole: role,
          isManualOverride: participant.isManualOverride === true,
          createdAt: sortToken(participant.createdAt),
          isProjected,
        }),
      );

      if (!isProjected) continue;

      if (traineeId !== null) {
        if (seenTraineeIds.has(traineeId)) {
          // REPORT-ONLY: nothing is excluded and nothing is merged. The issue
          // names the PARTICIPANT, never the trainee it duplicates.
          issues.push(
            issue("EX-TP-ADP-PARTICIPANT-TRAINEE-DUPLICATE", lessonId, participantId, null),
          );
        } else {
          seenTraineeIds.add(traineeId);
        }
      }

      participantSources.push(
        Object.freeze({
          participantId,
          // `""` is the fail-closed reading of "no authoritative identity": it is
          // dropped from the examinee set downstream and matches no viewer.
          traineeId: traineeId ?? "",
          traineeName: traineeName ?? "",
          role,
          isManualOverride: participant.isManualOverride === true,
          createdAt: sortToken(participant.createdAt),
        }),
      );
    }

    // --- child assignments -------------------------------------------------
    const sourceChildren = Array.isArray(row.childAssignments) ? row.childAssignments : [];
    // Ordered on the SAME total order the committed live adapter applies to its
    // projected children — (name, assignment id) — so the sibling detail and the
    // projection list a lesson's children identically. The final key is the
    // unique assignment id, so the order is total and input-independent.
    const orderedChildren = [...sourceChildren]
      .filter((c) => c !== null && typeof c === "object")
      .sort(
        (a, b) =>
          cmp(typeof a.childName === "string" ? a.childName : "",
            typeof b.childName === "string" ? b.childName : "") ||
          cmp(isPresentId(a.id) ? a.id.trim() : "", isPresentId(b.id) ? b.id.trim() : ""),
      );

    const childSources: LiveBeginnerChildSource[] = [];
    const childDetails: TeachingPracticeExamChildDetail[] = [];

    for (const child of orderedChildren) {
      const childAssignmentId = idOrNull(child.id);
      if (childAssignmentId === null) {
        issues.push(issue("EX-TP-ADP-CHILD-ASSIGNMENT-ID-REQUIRED", lessonId, null, null));
        continue;
      }

      const childId = idOrNull(child.childId);
      const childName = typeof child.childName === "string" ? child.childName : null;

      childDetails.push(
        Object.freeze({
          childAssignmentId,
          childId,
          childName,
          childAge: typeof child.childAge === "number" ? child.childAge : null,
          childGender: typeof child.childGender === "string" ? child.childGender : null,
          childNotes: typeof child.childNotes === "string" ? child.childNotes : null,
          parentName: typeof child.parentName === "string" ? child.parentName : null,
          // RAW, verbatim. No normalization, no link, no merge key.
          parentPhone: typeof child.parentPhone === "string" ? child.parentPhone : null,
          horseName: typeof child.horseName === "string" ? child.horseName : null,
          equipmentNotes:
            typeof child.equipmentNotes === "string" ? child.equipmentNotes : null,
          isAbsent: child.isAbsent === true,
        }),
      );

      childSources.push(
        Object.freeze({
          childAssignmentId,
          childId: childId ?? "",
          fullName: childName ?? "",
          age: typeof child.childAge === "number" ? child.childAge : null,
          gender: typeof child.childGender === "string" ? child.childGender : null,
          childNotes: typeof child.childNotes === "string" ? child.childNotes : null,
          parentName: typeof child.parentName === "string" ? child.parentName : null,
          parentPhone: typeof child.parentPhone === "string" ? child.parentPhone : null,
          horseName: typeof child.horseName === "string" ? child.horseName : null,
          equipmentNotes:
            typeof child.equipmentNotes === "string" ? child.equipmentNotes : null,
          isAbsent: child.isAbsent === true,
        }),
      );
    }

    const roleLabelOverrides = normalizeRoleLabelOverrides(row.roleLabelOverrides);
    const responsibleInstructorId = idOrNull(row.responsibleInstructorId);
    const responsibleInstructorName =
      typeof row.responsibleInstructorName === "string" ? row.responsibleInstructorName : null;
    const groupName = typeof row.groupName === "string" ? row.groupName : null;
    const location = typeof row.location === "string" ? row.location : null;
    const notes = typeof row.notes === "string" ? row.notes : null;
    const isPublished = row.isPublished === true;
    const createdAt = sortToken(row.createdAt);

    lessons.push(
      Object.freeze({
        lessonId,
        practiceType: row.practiceType,
        date: row.date,
        startTime: row.startTime,
        endTime: row.endTime,
        createdAt,
        groupName,
        location,
        notes,
        // Carried as DATA — never a filter here. The role-specific reader gates.
        isPublished,
        roleLabelOverrides,
        responsibleInstructorId,
        responsibleInstructorName,
        participants: Object.freeze(participantSources),
        children: Object.freeze(childSources),
      }),
    );

    details.push(
      Object.freeze({
        lessonId,
        practiceType: row.practiceType,
        date: row.date,
        startTime: row.startTime,
        endTime: row.endTime,
        createdAt,
        groupName,
        location,
        notes,
        isPublished,
        roleLabelOverrides,
        responsibleInstructorId,
        responsibleInstructorName,
        participants: Object.freeze(participantDetails),
        childAssignments: Object.freeze(childDetails),
      }),
    );
  }

  // Issues are collected in input order, so they are sorted on a total,
  // content-only key. Two issues that compare equal are byte-identical, so the
  // result is stable under a shuffled input.
  const orderedIssues = [...issues].sort(
    (a, b) =>
      cmp(a.lessonId ?? "", b.lessonId ?? "") ||
      cmp(a.code, b.code) ||
      cmp(a.participantId ?? "", b.participantId ?? "") ||
      cmp(a.childAssignmentId ?? "", b.childAssignmentId ?? ""),
  );

  return Object.freeze({
    lessons: Object.freeze(lessons),
    details: Object.freeze(details),
    issues: Object.freeze(orderedIssues),
  });
}
