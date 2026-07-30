/**
 * EXAM EX-SUP-C1 — PURE input normalization for the stored ExamSessionSupervisor
 * WRITE path.
 *
 * PURE by construction: no Prisma, no DB, no transaction, no clock, no
 * randomness, no env, no auth/session/cookie, no permission, no filesystem, no
 * network, no Next, no `server-only`, no `"use server"`. This module has NO
 * IMPORTS AT ALL, so its purity is a property of the file rather than a promise
 * about a dependency. Every export is a total, deterministic function of its
 * arguments and never mutates its inputs.
 *
 * WHAT THIS ANSWERS (and only this):
 *  - given a RAW, untrusted, form-like object, what is the exact normalized
 *    payload a supervisor-create writer may act on?
 *  - given a RAW, untrusted target value, what is the exact normalized id a
 *    supervisor-delete writer may resolve?
 *  - and if either answer is "none", which stable diagnostics explain why?
 *
 * WHAT THIS DELIBERATELY DOES NOT DO:
 *  - it PERFORMS NO IO and knows nothing of a row, a query or a database. It
 *    never sees a plan, a course offering, an actor or a timestamp;
 *  - it AUTHORIZES NOTHING, and it GRANTS NOTHING. There is no admin check, no
 *    offering boundary and no lifecycle gate here. See the section on what a
 *    stored supervisor is and is not;
 *  - it RESOLVES NOTHING. `sessionId`, `instructorId` and `supervisorId` are
 *    OPAQUE tokens. Whether that session exists under the acting course's plan,
 *    whether that instructor may supervise there, and whether that supervisor row
 *    exists are questions only a layer that can see the plan and the offering is
 *    able to answer;
 *  - it DECIDES NO ELIGIBILITY. There is no Instructor-to-CourseOffering relation
 *    in this database at all, so no pure module could decide who is allowed to
 *    supervise. That decision belongs entirely to an injected dependency in the
 *    orchestration layer, which is the only place that can see the data it would
 *    need;
 *  - it invents NO write outcome. There is no not-found, stale-write, duplicate
 *    or policy code here: those describe a database and an authorization boundary
 *    this module cannot see.
 *
 * ===========================================================================
 * A STORED SUPERVISOR IS AN OPERATIONAL RELATIONSHIP, NOT A GRANT
 * ===========================================================================
 * `ExamSessionSupervisor` records WHO IS RUNNING a given exam session. That is a
 * scheduling fact — the same sort of fact as which trainee is assigned to it.
 *
 * It is NOT a permission, and creating one grants nobody anything. Nothing in
 * this slice reads, checks or confers access, and nothing here consults any
 * permission of any kind. Whatever a future reading surface decides to do with
 * the relationship, that decision is made THERE, by a module that can see an
 * actor — never here, and never as a side effect of a write.
 *
 * ===========================================================================
 * EXACTLY TWO FIELDS ON CREATE, AND WHAT THE WRITE LAYER SUPPLIES INSTEAD
 * ===========================================================================
 * A create submission carries EXACTLY two fields:
 *
 *     sessionId, instructorId
 *
 * Everything else the stored row needs is SERVER-SUPPLIED and is deliberately
 * absent from every type in this file, so a caller cannot smuggle one in:
 *
 *     planId            — derived server-side from the verified offering
 *     courseOfferingId  — the authorization boundary's verified id
 *
 * And these are simply NOT COLUMNS OF THE TABLE, so no slice could ever write
 * one: the row is `(id, sessionId, instructorId, createdAt)` and nothing more.
 * There is no position, no rank, no responsibility marker and no category:
 *
 *     orderIndex, isPrimary, isResponsible, a supervisor category
 *
 * None of the above is filtered out. They are UNREPRESENTABLE: no normalized
 * payload has a field for any of them, so no writer handed one of these payloads
 * has a channel through which a client-chosen plan, position or marker could
 * arrive.
 *
 * ===========================================================================
 * THE SET IS UNORDERED, AND THAT IS A SCHEMA FACT
 * ===========================================================================
 * The supervisors of one session are an UNORDERED SET. The table carries no
 * position column, so there is nothing to reorder, no "first" supervisor and no
 * default to pick. This module therefore models no ordering, and the sibling
 * orchestration cores expose no reorder operation — not because one is
 * unimplemented, but because the data has no order to express.
 *
 * The uniqueness of `(sessionId, instructorId)` is what makes the set a set, and
 * it is enforced by the database rather than guessed at here: this module cannot
 * see the stored rows, so it cannot know whether a pair already exists.
 *
 * ===========================================================================
 * WHY A DELETE TAKES ONLY A SUPERVISOR ID
 * ===========================================================================
 * The delete normalizer accepts the RAW TARGET VALUE and nothing else — no
 * session id, no instructor id, no pair.
 *
 * A stored supervisor row has its own stable primary key, and the orchestration
 * layer resolves that key under the SERVER-RESOLVED plan before deleting it. A
 * submitted session id would add nothing to that resolution and would give a
 * caller a second, redundant handle on the lookup; a submitted pair would invite
 * a writer to delete "whatever currently matches" rather than the exact row the
 * scoped read approved.
 *
 * ===========================================================================
 * NO BOUNDS, NO COERCION, NO CASE FOLDING
 * ===========================================================================
 * There is NO maximum length for any field: no such bound is approved, and every
 * value here is an opaque identifier whose shape is not this module's business.
 *
 * Nothing is coerced. A number, a boolean, an array, a plain object, a file-like
 * upload value and a function are all REFUSED rather than stringified — there is
 * no `String(...)` anywhere in this file, because one would happily store
 * `"[object Object]"` as an identifier.
 *
 * Every accepted string is preserved BYTE-FOR-BYTE except for `trim()`. There is
 * no unicode normalization, no case folding and no locale-aware comparison
 * anywhere, so every identifier keeps its exact case and every character.
 */

// ===========================================================================
// Codes + messages
// ===========================================================================

/**
 * Every diagnostic this module can produce.
 *
 * Three codes for three fields across two operations. There is deliberately no
 * code for a forbidden or unknown key (those are excluded by construction, per
 * the header), no code describing a database outcome, and no code describing a
 * position, a responsibility or an eligibility decision.
 */
export type ExamSupervisorWriteInputIssueCode =
  | "EX-SUP-IN-SESSION-REQUIRED"
  | "EX-SUP-IN-INSTRUCTOR-REQUIRED"
  | "EX-SUP-IN-SUPERVISOR-REQUIRED";

/**
 * The message table. Stable Hebrew, one message per code, and deliberately
 * NON-ECHOING: no message contains a placeholder, a submitted value, a field
 * path, an id or a count, so a diagnostic can never reflect what the client sent
 * back to the client.
 *
 * The messages are also deliberately VAGUE ABOUT WHY. A message that
 * distinguished "not a string" from "blank" would be an oracle over the exact
 * validator and buys a manager nothing: the correction is the same either way.
 */
export const EXAM_SUPERVISOR_WRITE_INPUT_MESSAGES: Readonly<
  Record<ExamSupervisorWriteInputIssueCode, string>
> = Object.freeze({
  "EX-SUP-IN-SESSION-REQUIRED": "חובה לבחור מפגש מבחן",
  "EX-SUP-IN-INSTRUCTOR-REQUIRED": "חובה לבחור מדריך",
  "EX-SUP-IN-SUPERVISOR-REQUIRED": "חובה לבחור שיוך מדריך להסרה",
});

/**
 * One diagnostic. Carries ONLY a stable code and its message: no submitted
 * value, no field path, no raw object, no id and no index.
 */
export interface ExamSupervisorWriteInputIssue {
  readonly code: ExamSupervisorWriteInputIssueCode;
  readonly message: string;
}

/**
 * Build one frozen diagnostic from its code.
 *
 * Exported so that the orchestration layer can express a refusal in EXACTLY
 * these terms without restating a message. A second copy of the Hebrew text
 * elsewhere is a copy free to drift.
 */
export function makeExamSupervisorWriteInputIssue(
  code: ExamSupervisorWriteInputIssueCode,
): ExamSupervisorWriteInputIssue {
  return Object.freeze({ code, message: EXAM_SUPERVISOR_WRITE_INPUT_MESSAGES[code] });
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
 * either arm is a calendar value, Map, Set, BigInt, Error or class instance.
 */
export type ExamSupervisorWriteInputResult<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | {
      readonly ok: false;
      readonly issues: readonly ExamSupervisorWriteInputIssue[];
    };

/**
 * The normalized CREATE payload — exactly the two submitted fields, both plain
 * non-blank strings and never `null` or `undefined`, so the shape is stable,
 * JSON-round-trippable and unambiguous to a writer.
 *
 * Note once more what is absent: no `planId`, no `courseOfferingId`, no position,
 * no responsibility marker and no category.
 */
export interface NormalizedExamSupervisorCreate {
  readonly sessionId: string;
  readonly instructorId: string;
}

/**
 * The normalized DELETE target — exactly the one stored-row identifier, as a
 * plain non-blank string.
 *
 * Deliberately a wrapper object rather than a bare string, so the two normalizers
 * share one result type and a future second target field could be added without
 * changing every caller's shape.
 */
export interface NormalizedExamSupervisorDelete {
  readonly supervisorId: string;
}

// ===========================================================================
// Field helpers
// ===========================================================================

/**
 * Read one OWN property of a raw value, or `undefined`.
 *
 * Own-property only: a raw object inherits `toString`, `constructor` and friends
 * from its prototype, and reading those as if the client had sent them would
 * turn prototype members into submitted data.
 *
 * A non-object `source` — `null`, `undefined`, a string, a number, an array — is
 * not a special case: every field simply reads as absent, and the ordinary
 * diagnostics then explain what is missing.
 */
function readField(source: unknown, key: string): unknown {
  if (typeof source !== "object" || source === null) return undefined;
  if (!Object.prototype.hasOwnProperty.call(source, key)) return undefined;
  return (source as Record<string, unknown>)[key];
}

/**
 * Normalize a REQUIRED text value: trim a string, or fail.
 *
 * Returns `null` to mean "unusable" for every one of: absent, `null`,
 * `undefined`, a non-string of ANY type — a number, a boolean, an array, a plain
 * object, a function, a file-like upload value — and a string that is empty or
 * whitespace-only. All of those mean the same thing to a manager: nothing was
 * chosen for that field, so they share one code per field.
 *
 * NO COERCION AND NO PROBING. The value's own `toString`, `name`, `valueOf` or
 * any other member is never read, so a file-like object cannot contribute a
 * filename to the database through this path.
 */
function normalizeRequiredText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// ===========================================================================
// The normalizations
// ===========================================================================

/**
 * Normalize and validate a RAW supervisor CREATE submission.
 *
 * EVERY applicable issue is reported, not only the first: a submission with no
 * session AND no instructor has two problems, and hiding one behind the other
 * would cost the manager a second round-trip to discover it.
 *
 * The issue ORDER is FIXED and matches the field order of the payload —
 * sessionId, then instructorId — so a form can render diagnostics in a stable
 * sequence and a test can assert on it. The order does not depend on the raw
 * object's key order, on which fields are present, or on anything else.
 *
 * On success the payload is a FROZEN plain object holding exactly the two
 * fields. This function grants NOTHING: a successful result means only "these
 * two values are well-formed". Whether the session exists under the acting
 * course's plan, whether that instructor may supervise there, and whether the
 * resulting row collides with an existing one are ALL questions for the
 * orchestration and write layers.
 *
 * Never throws. Never mutates `rawInput`; a frozen raw object is fine, because
 * nothing is ever written back to it.
 */
export function normalizeExamSupervisorCreateInput(
  rawInput: unknown,
): ExamSupervisorWriteInputResult<NormalizedExamSupervisorCreate> {
  const issues: ExamSupervisorWriteInputIssue[] = [];

  const sessionId = normalizeRequiredText(readField(rawInput, "sessionId"));
  if (sessionId === null) {
    issues.push(makeExamSupervisorWriteInputIssue("EX-SUP-IN-SESSION-REQUIRED"));
  }

  const instructorId = normalizeRequiredText(readField(rawInput, "instructorId"));
  if (instructorId === null) {
    issues.push(makeExamSupervisorWriteInputIssue("EX-SUP-IN-INSTRUCTOR-REQUIRED"));
  }

  if (issues.length > 0) {
    return Object.freeze({
      ok: false as const,
      issues: Object.freeze([...issues]),
    });
  }

  // Reached ONLY when both fields validated, which is what proves the two
  // narrowing assertions below. They restate that proof for the type system and
  // widen nothing at runtime.
  return Object.freeze({
    ok: true as const,
    value: Object.freeze({
      sessionId: sessionId as string,
      instructorId: instructorId as string,
    }),
  });
}

/**
 * Normalize and validate a RAW supervisor DELETE target.
 *
 * The argument is the TARGET VALUE ITSELF, not a form-like wrapper: the sibling
 * delete orchestration receives one `unknown` id and hands it straight here, so
 * demanding an object would make an ordinary string target permanently invalid.
 * No property of any object is read, which is why `readField` is not used here.
 *
 * Exactly one issue is possible, so the result's issue list holds at most one
 * entry and its order is trivially fixed.
 *
 * Never throws. Never mutates its argument.
 */
export function normalizeExamSupervisorDeleteInput(
  rawSupervisorId: unknown,
): ExamSupervisorWriteInputResult<NormalizedExamSupervisorDelete> {
  const supervisorId = normalizeRequiredText(rawSupervisorId);

  if (supervisorId === null) {
    return Object.freeze({
      ok: false as const,
      issues: Object.freeze([
        makeExamSupervisorWriteInputIssue("EX-SUP-IN-SUPERVISOR-REQUIRED"),
      ]),
    });
  }

  return Object.freeze({
    ok: true as const,
    value: Object.freeze({ supervisorId }),
  });
}
