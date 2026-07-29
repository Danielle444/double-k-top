/**
 * EXAM EX-SES-S1 — PURE input normalization for the stored ExamSession WRITE path.
 *
 * PURE by construction: no Prisma, no DB, no transaction, no clock, no
 * randomness, no env, no auth/session/cookie, no capability, no filesystem, no
 * network, no Next, no `server-only`, no `"use server"`. Every export is a
 * total, deterministic function of its arguments and never mutates its inputs.
 * The only runtime dependencies are two committed, import-free, `Date`-free
 * primitives (see "WHY THESE TWO HELPERS" below).
 *
 * WHAT THIS ANSWERS (and only this):
 *  - given a RAW, untrusted, form-like object, what is the exact normalized
 *    payload a future ExamSession writer may act on?
 *  - and if the answer is "none", which stable diagnostics explain why?
 *
 * WHAT THIS DELIBERATELY DOES NOT DO:
 *  - it PERFORMS NO IO and knows nothing of Prisma, a transaction client, a row
 *    or a query. It never sees a plan, a course offering, a session id, an
 *    actor, a timestamp or a database;
 *  - it AUTHORIZES NOTHING. There is no admin check, no offering boundary and no
 *    lifecycle gate here. A caller holding a normalized payload has been granted
 *    NOTHING — the future write layer owns every one of those decisions;
 *  - it decides NOTHING about ordering. `orderIndex` is not an input field and
 *    is never returned, so no ordering strategy is expressed, assumed or implied
 *    anywhere in this file;
 *  - it resolves NO DEFINITION. `definitionId` is normalized as an OPAQUE
 *    token. Whether that definition exists, belongs to the plan being written,
 *    or is of a storable kind is a question only the write layer — which can see
 *    the plan — is able to answer;
 *  - it computes NO DERIVED VALUE: no end time, no waves, no personal slots, no
 *    timetable duration, no conflicts, no capacity. Those are projections over a
 *    stored row plus its definition, and none of them is an input;
 *  - it invents NO write outcome. There is no not-found, stale-write, duplicate,
 *    conflict or policy code here: those describe a database and an
 *    authorization boundary this module cannot see;
 *  - it touches NO assignment, break, supervisor, publication or notification.
 *    Those are later slices, and no field of any of them is representable here.
 *
 * ===========================================================================
 * BEGINNER_INSTRUCTION IS NOT ACCEPTED OR REPRESENTED HERE
 * ===========================================================================
 * Beginner exams are a LIVE Teaching Practice projection and must never become
 * a stored row (see `prisma/schema.prisma`, model `ExamSession`, EX-C2-0). This
 * module does not accept, model, mention or check a `kind` AT ALL: kind is a
 * property of the ExamDefinition, not of a submitted session, and the only kind
 * that can ever apply to a stored row is the one the AUTHORITATIVE definition
 * carries under the plan.
 *
 * So the beginner refusal is not weakened here — it is simply not this module's
 * question. The future writer resolves the definition under the plan and the
 * committed domain core (`validateStoredExamSession` /
 * `EX-DOM-BEGINNER-SESSION-FORBIDDEN`) enforces the rule where the definition is
 * actually visible. A second, definition-blind copy of that rule here could only
 * guess, and a guess that says "allowed" would be worse than no check.
 *
 * ===========================================================================
 * THE SIX FIELDS, AND WHAT THE WRITE LAYER SUPPLIES INSTEAD
 * ===========================================================================
 * A submission carries EXACTLY six fields, on both create and edit:
 *
 *     definitionId, date, startTime, arena, title, notes
 *
 * Everything else a stored row needs is SERVER-SUPPLIED and is deliberately
 * absent from every type in this file, so a caller cannot smuggle one in:
 *
 *     courseOfferingId  — the authorization boundary's verified id
 *     planId            — derived server-side from that verified offering
 *     sessionId         — the route/target of an edit, never a submitted field
 *     orderIndex        — assigned by the write layer
 *     expectedUpdatedAt — the edit's stale-write token
 *
 * These are not filtered out. They are UNREPRESENTABLE: no normalized payload
 * has a field for any of them, so no writer handed one of these payloads has a
 * channel through which a client-chosen plan, order or staleness token could
 * arrive.
 *
 * ===========================================================================
 * UNKNOWN AND DEPRECATED KEYS ARE EXCLUDED BY CONSTRUCTION
 * ===========================================================================
 * Only the six named fields are ever read. Nothing here looks for `id`,
 * `planId`, `courseOfferingId`, `orderIndex`, `kind`, `phase`,
 * `beginnerFormat`, `endTime`, `capacity`, `interfaceSessionId`,
 * `sourceTeachingPracticeLessonId`, `copiedAt`, `roleLabelOverrides`,
 * `individualPublishedAt`, `createdAt`, `updatedAt`, `assignments`, `breaks`,
 * `supervisors` or `sourcePracticeRole` — so none of them can enter a result,
 * not because it is stripped, but because it is never sought.
 *
 * That is the same posture the committed `exam-definition-write-core` takes, and
 * for the same reason: exclusion states the locked rule exactly, whereas a
 * refusal code would describe a request nobody can make through any surface this
 * module serves. Several of those columns are additionally documented in the
 * schema as DEPRECATED AND UNWRITTEN (`kind`, `phase`, `beginnerFormat`,
 * `capacity`, `interfaceSessionId`); a write path that could set them would
 * quietly resurrect an abandoned model.
 *
 * `endTime` deserves its own note: it is DERIVED from the definition's duration
 * and the session's wave layout, never submitted. Accepting one would let a
 * manager's stale guess overwrite a computed truth.
 *
 * ===========================================================================
 * WHY THESE TWO HELPERS, AND WHY NO THIRD COPY OF A CALENDAR
 * ===========================================================================
 * `isValidHHMM` comes from `./exam-overlap-core`, which is ALREADY the exam
 * slice's single time primitive — `exam-block-timetable-core`,
 * `exam-schedule-projection-core` and `exam-tp-source-adapter-core` all import
 * their `HH:mm` handling from it. It is import-free, `Date`-free, anchored, and
 * accepts ONLY zero-padded 00:00–23:59.
 *
 * `isValidDateKey` comes from `../trainee-history/interval-resolver`. That is a
 * cross-directory import, which the exam pure cores otherwise avoid, and it is a
 * deliberate, narrow choice rather than an oversight:
 *  - the module is a GENERIC date-key primitive with ZERO imports of its own, no
 *    `Date` construction, no clock and no IO, so importing it cannot introduce
 *    impurity — a fact this slice's own test proves TRANSITIVELY rather than
 *    assuming;
 *  - it already validates REAL calendar dates including leap years, which is
 *    exactly the rule this slice needs and is a UNIVERSAL fact, not an exam
 *    domain rule this module would be entitled to own;
 *  - the same reuse is already COMMITTED convention for pure cores in another
 *    directory: `lib/course/create-trainee-enrollment-core.ts`,
 *    `lib/course/horse-cache-parity.ts` and
 *    `lib/course/horse-enrollment-backfill-plan.ts` all import this very module
 *    by relative path;
 *  - the repository already contains FOUR copies of the leap-year algorithm. A
 *    fifth, written here, would be a rule this module restates and is then free
 *    to drift from.
 *
 * Note that the exam slice's EXISTING date checks are shape-only regexes, so
 * `2026-02-31` passes them. This module is stricter ON PURPOSE: a read-side view
 * selector that accepts an impossible date merely shows nothing, but a WRITE that
 * accepts one would persist a date no calendar has.
 *
 * ===========================================================================
 * NO BOUNDS, NO COERCION, NO CASE FOLDING
 * ===========================================================================
 * There is NO maximum length for `definitionId`, `arena`, `title` or `notes`,
 * and NO earliest or latest permitted date: no such bound is approved, and an
 * unapproved ceiling would silently reject a legitimate exam.
 *
 * Nothing is coerced. A numeric `startTime`, a `Date`-valued `date` and a
 * numeric `arena` are all REFUSED rather than stringified — a `String(value)`
 * here would happily store `"[object Object]"` as an arena name.
 *
 * Every accepted string is preserved BYTE-FOR-BYTE except for `trim()`. There is
 * no `normalize()`, no `toLowerCase()` and no locale-aware comparison anywhere,
 * so Hebrew and every other script survive normalization unchanged, and
 * `definitionId` keeps its exact case.
 */
import { isValidHHMM } from "./exam-overlap-core";
import { isValidDateKey } from "../trainee-history/interval-resolver";

// ===========================================================================
// Codes + messages
// ===========================================================================

/**
 * Every diagnostic this module can produce.
 *
 * Six codes for six fields. There is deliberately no code for a forbidden,
 * unknown or deprecated key (those are excluded by construction, per the header),
 * no code describing a database outcome, and no code describing an assignment,
 * break, supervisor, publication or ordering decision.
 */
export type ExamSessionWriteInputIssueCode =
  | "EX-SES-DEFINITION-REQUIRED"
  | "EX-SES-DATE-INVALID"
  | "EX-SES-START-TIME-INVALID"
  | "EX-SES-ARENA-INVALID"
  | "EX-SES-TITLE-INVALID"
  | "EX-SES-NOTES-INVALID";

/**
 * The message table. Stable Hebrew, one message per code, and deliberately
 * NON-ECHOING: no message contains a placeholder, a submitted value, a field
 * path, an id or a count, so a diagnostic can never reflect what the client sent
 * back to the client.
 *
 * The messages are also deliberately VAGUE ABOUT WHY in the "invalid" cases. A
 * message that distinguished "not a string" from "wrongly formatted" would be an
 * oracle over the exact validator, and buys a manager nothing: the correction is
 * the same either way.
 */
export const EXAM_SESSION_WRITE_INPUT_MESSAGES: Readonly<
  Record<ExamSessionWriteInputIssueCode, string>
> = Object.freeze({
  "EX-SES-DEFINITION-REQUIRED": "יש לבחור הגדרת בחינה",
  "EX-SES-DATE-INVALID": "תאריך הבחינה אינו תקין",
  "EX-SES-START-TIME-INVALID": "שעת ההתחלה אינה תקינה (HH:MM)",
  "EX-SES-ARENA-INVALID": "שדה הזירה אינו תקין",
  "EX-SES-TITLE-INVALID": "שדה הכותרת אינו תקין",
  "EX-SES-NOTES-INVALID": "שדה ההערות אינו תקין",
});

/**
 * One diagnostic. Carries ONLY a stable code and its message: no submitted
 * value, no field path, no raw object, no id and no index.
 */
export interface ExamSessionWriteInputIssue {
  readonly code: ExamSessionWriteInputIssueCode;
  readonly message: string;
}

// ===========================================================================
// Result
// ===========================================================================

/**
 * A discriminated, JSON-safe result.
 *
 * The success arm carries NO `issues` key and the failure arm carries NO `value`
 * key, so no property is ever present-but-`undefined` and
 * `JSON.parse(JSON.stringify(result))` deep-equals the result itself. Nothing in
 * either arm is a Date, Map, Set, BigInt, Error or class instance.
 */
export type ExamSessionWriteInputResult<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly issues: readonly ExamSessionWriteInputIssue[] };

/**
 * The normalized CREATE payload — exactly the six submitted fields.
 *
 * `date` and `startTime` are plain validated STRINGS, never `Date` objects: the
 * `DateKey -> Date` conversion for the `@db.Date` column belongs to the
 * server-only write binding, and doing it here would drag a timezone decision
 * into a pure core.
 *
 * The three optional text fields are `string | null` and NEVER `undefined`, so
 * the shape is stable, JSON-round-trippable, and unambiguous to a writer:
 * `null` means "store nothing here".
 */
export interface NormalizedExamSessionCreate {
  readonly definitionId: string;
  readonly date: string;
  readonly startTime: string;
  readonly arena: string | null;
  readonly title: string | null;
  readonly notes: string | null;
}

/**
 * The normalized EDIT payload.
 *
 * Structurally identical to the create payload TODAY, and a SEPARATE type on
 * purpose. Create and edit are distinct operations whose accepted-field sets are
 * free to diverge in a later slice; a shared alias would make that divergence a
 * breaking edit to both paths at once, and would let a writer built for one
 * operation silently accept the other's payload as if it had been reviewed.
 *
 * Note what is absent, exactly as on create: no `sessionId` and no
 * `expectedUpdatedAt`. The target of an edit and its stale-write token are the
 * write layer's, never a client's.
 */
export interface NormalizedExamSessionEdit {
  readonly definitionId: string;
  readonly date: string;
  readonly startTime: string;
  readonly arena: string | null;
  readonly title: string | null;
  readonly notes: string | null;
}

// ===========================================================================
// Field helpers
// ===========================================================================

/**
 * Read one OWN property of a raw value, or `undefined`.
 *
 * Own-property only: a raw object inherits `toString`, `constructor` and friends
 * from its prototype, and reading those as if the client had sent them would turn
 * prototype members into submitted data.
 *
 * A non-object `source` — `null`, `undefined`, a string, a number, an array —
 * is not a special case: every field simply reads as absent, and the ordinary
 * diagnostics then explain what is missing.
 */
function readField(source: unknown, key: string): unknown {
  if (typeof source !== "object" || source === null) return undefined;
  if (!Object.prototype.hasOwnProperty.call(source, key)) return undefined;
  return (source as Record<string, unknown>)[key];
}

/**
 * Normalize a REQUIRED opaque identifier: trim a string, or fail.
 *
 * Returns `null` to mean "unusable" for every one of: absent, `null`,
 * `undefined`, a non-string of any type, and a string that is empty or
 * whitespace-only. All of those mean the same thing to a manager — no definition
 * was chosen — so they share one code.
 *
 * NO COERCION: a number, a boolean or an object is refused, never stringified.
 * Case and every internal character are preserved exactly.
 */
function normalizeRequiredId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * The ONE documented, deterministic policy for the three optional text fields.
 *
 * Exactly three outcomes, and no fourth:
 *   - ABSENT / `null` / `undefined`  -> `{ ok: true, value: null }`
 *     "not provided" is a legitimate submission for an optional field;
 *   - a STRING                       -> trimmed; blank or whitespace-only
 *     collapses to `null`, so `""`, `"   "` and a tab never reach the database
 *     as a meaningless non-null value. Internal whitespace and every non-ASCII
 *     character are preserved byte-for-byte;
 *   - ANYTHING ELSE                  -> `{ ok: false }`, i.e. FAIL CLOSED.
 *
 * The third branch is the deliberate part. A number, boolean, array, object,
 * `Date` or function in a free-text field is a CLIENT DEFECT, and the two
 * alternatives are both worse: coercing it would persist `"[object Object]"` or
 * `"42"` as an arena name, and silently dropping it to `null` would let a manager
 * watch a value be "accepted" and then find the field empty. A refusal is the
 * only outcome that tells the truth.
 *
 * There is NO length limit: none is approved.
 */
function normalizeOptionalText(value: unknown): { ok: true; value: string | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false };
  const trimmed = value.trim();
  return { ok: true, value: trimmed.length > 0 ? trimmed : null };
}

function makeIssue(code: ExamSessionWriteInputIssueCode): ExamSessionWriteInputIssue {
  return Object.freeze({ code, message: EXAM_SESSION_WRITE_INPUT_MESSAGES[code] });
}

// ===========================================================================
// The shared normalization
// ===========================================================================

/**
 * The six normalized fields, once validated. Private: only the two public
 * functions may turn this into a frozen, operation-specific payload.
 */
interface NormalizedExamSessionFields {
  readonly definitionId: string;
  readonly date: string;
  readonly startTime: string;
  readonly arena: string | null;
  readonly title: string | null;
  readonly notes: string | null;
}

/**
 * Normalize and validate the six submitted fields.
 *
 * EVERY applicable issue is reported, not only the first: a submission with a
 * bad date AND a bad time has two problems, and hiding one behind the other
 * would cost the manager a second round-trip to discover it.
 *
 * The issue ORDER is FIXED and matches the field order of the payload —
 * definitionId, date, startTime, arena, title, notes — so a form can render
 * diagnostics in a stable sequence and a test can assert on it. The order does
 * not depend on the raw object's key order, on which fields are present, or on
 * anything else.
 *
 * Never throws. Never mutates `rawInput`; a frozen raw object is fine, because
 * nothing is ever written back to it.
 */
function normalizeExamSessionFields(
  rawInput: unknown,
): ExamSessionWriteInputResult<NormalizedExamSessionFields> {
  const issues: ExamSessionWriteInputIssue[] = [];

  const definitionId = normalizeRequiredId(readField(rawInput, "definitionId"));
  if (definitionId === null) {
    issues.push(makeIssue("EX-SES-DEFINITION-REQUIRED"));
  }

  // The COMMITTED real-calendar validator: exact `YYYY-MM-DD`, leap years
  // honoured, `2026-02-31` refused, no `Date` constructed, no trimming (so a
  // surrounding-whitespace variant is refused), and today is never inferred.
  const rawDate = readField(rawInput, "date");
  if (!isValidDateKey(rawDate)) {
    issues.push(makeIssue("EX-SES-DATE-INVALID"));
  }

  // The COMMITTED exam-slice time primitive: exact zero-padded `HH:mm`,
  // 00:00–23:59, so `"9:00"`, `"24:00"` and `" 09:00"` are all refused.
  const rawStartTime = readField(rawInput, "startTime");
  if (!isValidHHMM(rawStartTime)) {
    issues.push(makeIssue("EX-SES-START-TIME-INVALID"));
  }

  const arena = normalizeOptionalText(readField(rawInput, "arena"));
  if (!arena.ok) {
    issues.push(makeIssue("EX-SES-ARENA-INVALID"));
  }

  const title = normalizeOptionalText(readField(rawInput, "title"));
  if (!title.ok) {
    issues.push(makeIssue("EX-SES-TITLE-INVALID"));
  }

  const notes = normalizeOptionalText(readField(rawInput, "notes"));
  if (!notes.ok) {
    issues.push(makeIssue("EX-SES-NOTES-INVALID"));
  }

  if (issues.length > 0) {
    return Object.freeze({ ok: false as const, issues: Object.freeze([...issues]) });
  }

  // Reached ONLY when every field validated, which is what proves the three
  // narrowing assertions below. They restate that proof for the type system and
  // widen nothing at runtime.
  return Object.freeze({
    ok: true as const,
    value: {
      definitionId: definitionId as string,
      date: rawDate as string,
      startTime: rawStartTime as string,
      arena: (arena as { value: string | null }).value,
      title: (title as { value: string | null }).value,
      notes: (notes as { value: string | null }).value,
    },
  });
}

// ===========================================================================
// 1. Create
// ===========================================================================

/**
 * Normalize and validate a RAW stored-session CREATE submission.
 *
 * On success the payload is a FROZEN plain object holding exactly the six
 * create fields — no plan, no offering, no order, no timestamp, no kind and no
 * derived value. On failure the issues are in the fixed order documented above.
 *
 * This function grants NOTHING. A successful result means only "these six values
 * are well-formed"; whether the definition exists, whether it belongs to the
 * plan, whether the actor may write to that course, and whether the resulting
 * row conflicts with another are ALL questions for the write layer.
 *
 * Never throws. Never mutates `rawInput`.
 */
export function normalizeExamSessionCreateInput(
  rawInput: unknown,
): ExamSessionWriteInputResult<NormalizedExamSessionCreate> {
  const normalized = normalizeExamSessionFields(rawInput);
  if (!normalized.ok) {
    return normalized;
  }

  return Object.freeze({
    ok: true as const,
    // A fresh frozen object literal rather than the shared bundle: the create
    // and edit results must not alias one another or any internal value.
    value: Object.freeze({
      definitionId: normalized.value.definitionId,
      date: normalized.value.date,
      startTime: normalized.value.startTime,
      arena: normalized.value.arena,
      title: normalized.value.title,
      notes: normalized.value.notes,
    }),
  });
}

// ===========================================================================
// 2. Edit
// ===========================================================================

/**
 * Normalize and validate a RAW stored-session EDIT submission.
 *
 * The accepted field set is identical to create's, and the validation is
 * literally the same shared routine, so an edit can never be held to a weaker
 * standard than a create — the usual source of "it was rejected on creation but
 * accepted on edit" drift.
 *
 * `definitionId` IS editable here: a manager who scheduled a session under the
 * wrong exam definition must be able to correct it. The rules that make such a
 * move legal — that the target definition exists under the SAME plan, and that
 * already-stored assignments still conform to it — are enforced by the write
 * layer and the committed domain core, which can see the plan. This module can
 * only confirm that a well-formed token was supplied.
 *
 * There is no `sessionId` and no `expectedUpdatedAt` parameter, and no field for
 * either in the result: the edit target and its stale-write token are supplied by
 * the write layer, so a client cannot redirect an edit at another row or defeat
 * staleness detection through this input.
 *
 * Never throws. Never mutates `rawInput`.
 */
export function normalizeExamSessionEditInput(
  rawInput: unknown,
): ExamSessionWriteInputResult<NormalizedExamSessionEdit> {
  const normalized = normalizeExamSessionFields(rawInput);
  if (!normalized.ok) {
    return normalized;
  }

  return Object.freeze({
    ok: true as const,
    value: Object.freeze({
      definitionId: normalized.value.definitionId,
      date: normalized.value.date,
      startTime: normalized.value.startTime,
      arena: normalized.value.arena,
      title: normalized.value.title,
      notes: normalized.value.notes,
    }),
  });
}
