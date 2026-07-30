/**
 * EXAM EX-ASG-C1 — PURE input normalization for the stored ExamAssignment WRITE
 * path.
 *
 * PURE by construction: no Prisma, no DB, no transaction, no clock, no
 * randomness, no env, no auth/session/cookie, no capability, no filesystem, no
 * network, no Next, no `server-only`, no `"use server"`. This module has NO
 * IMPORTS AT ALL, so its purity is a property of the file rather than a promise
 * about a dependency. Every export is a total, deterministic function of its
 * arguments and never mutates its inputs.
 *
 * WHAT THIS ANSWERS (and only this):
 *  - given a RAW, untrusted, form-like object, what is the exact normalized
 *    payload a future examinee-assignment writer may act on?
 *  - and if the answer is "none", which stable diagnostics explain why?
 *
 * WHAT THIS DELIBERATELY DOES NOT DO:
 *  - it PERFORMS NO IO and knows nothing of a row, a query or a database. It
 *    never sees a plan, a course offering, an actor or a timestamp;
 *  - it AUTHORIZES NOTHING. There is no admin check, no offering boundary and no
 *    lifecycle gate here. A caller holding a normalized payload has been granted
 *    NOTHING — the orchestration layer owns every one of those decisions;
 *  - it RESOLVES NOTHING. `sessionId` and `studentId` are OPAQUE tokens. Whether
 *    that session exists under the acting course's plan, and whether that
 *    trainee is enrolled in it, are questions only a layer that can see the plan
 *    and the offering is able to answer;
 *  - it DECIDES NO ROLE. The role of the row this payload will become is fixed
 *    by the operation, not by a submission — see the section below;
 *  - it DECIDES NOTHING about ordering. `orderIndex` is not an input field and is
 *    never returned, so no ordering strategy is expressed, assumed or implied
 *    anywhere in this file;
 *  - it invents NO write outcome. There is no not-found, stale-write, duplicate
 *    or policy code here: those describe a database and an authorization
 *    boundary this module cannot see.
 *
 * ===========================================================================
 * EXACTLY THREE FIELDS, AND WHAT THE WRITE LAYER SUPPLIES INSTEAD
 * ===========================================================================
 * A submission carries EXACTLY three fields:
 *
 *     sessionId, studentId, horseName
 *
 * Everything else a stored row needs is SERVER-SUPPLIED or SERVER-FIXED and is
 * deliberately absent from every type in this file, so a caller cannot smuggle
 * one in:
 *
 *     role              — fixed by the operation (this slice writes examinees)
 *     orderIndex        — assigned by the write layer
 *     planId            — derived server-side from the verified offering
 *     courseOfferingId  — the authorization boundary's verified id
 *
 * And these columns of the row are simply NOT WRITTEN by this slice at all:
 *
 *     instructionTopic, discipline, pairingIndex, sourcePracticeRole, notes
 *
 * None of the above is filtered out. They are UNREPRESENTABLE: no normalized
 * payload has a field for any of them, so no writer handed one of these payloads
 * has a channel through which a client-chosen role, order or plan could arrive,
 * and no partially-populated row can be produced from this input.
 *
 * `instructionTopic` and `discipline` deserve their own note. Some definitions
 * DEMAND those values, and a submission has no way to supply one here. That is
 * the point: this slice does not implement those definitions, and the
 * orchestration layer REFUSES such a definition outright rather than writing a
 * row that would be missing a field its definition requires. A field this module
 * cannot model is a field the write can never half-populate.
 *
 * ===========================================================================
 * UNKNOWN KEYS ARE EXCLUDED BY CONSTRUCTION
 * ===========================================================================
 * Only the three named fields are ever read. Nothing here looks for `id`,
 * `role`, `orderIndex`, `planId`, `courseOfferingId`, `definitionId`,
 * `instructionTopic`, `discipline`, `pairingIndex`, `sourcePracticeRole`,
 * `notes`, `createdAt` or `updatedAt` — so none of them can enter a result, not
 * because it is stripped, but because it is never sought.
 *
 * That is the same posture the committed session and definition write cores
 * take, and for the same reason: exclusion states the locked rule exactly,
 * whereas a refusal code would describe a request nobody can make through any
 * surface this module serves.
 *
 * ===========================================================================
 * THE HORSE IS REQUIRED HERE, UNCONDITIONALLY
 * ===========================================================================
 * `horseName` is a REQUIRED non-blank string on every submission this module
 * accepts, and a whitespace-only value is refused rather than collapsed to
 * nothing.
 *
 * The definition-aware rule — WHICH assignments must carry a horse — is owned by
 * the committed `isHorseRequiredFor`, which needs the definition's kind and the
 * row's role and is therefore consulted by the orchestration layer, where both
 * are visible. This module's unconditional rule is strictly STRONGER than that
 * one for the role this slice writes, so an accepted payload can never violate
 * it. A second, definition-blind copy of the kind table here could only guess,
 * and a guess that said "no horse needed" would persist an incomplete row.
 *
 * ===========================================================================
 * NO BOUNDS, NO COERCION, NO CASE FOLDING
 * ===========================================================================
 * There is NO maximum length for any field: no such bound is approved, and an
 * unapproved ceiling would silently reject a legitimate horse name.
 *
 * Nothing is coerced. A number, a boolean, an array, a plain object, a
 * file-like upload value and a function are all REFUSED rather than
 * stringified — there is no `String(...)` anywhere in this file, because one
 * would happily store `"[object Object]"` as a horse name.
 *
 * Every accepted string is preserved BYTE-FOR-BYTE except for `trim()`. There is
 * no `normalize()`, no `toLowerCase()` and no locale-aware comparison anywhere,
 * so Hebrew and every other script survive normalization unchanged, and the two
 * opaque ids keep their exact case.
 */

// ===========================================================================
// Codes + messages
// ===========================================================================

/**
 * Every diagnostic this module can produce.
 *
 * Three codes for three fields. There is deliberately no code for a forbidden or
 * unknown key (those are excluded by construction, per the header), no code
 * describing a database outcome, and no code describing a role, an ordering or a
 * definition decision.
 */
export type ExamAssignmentWriteInputIssueCode =
  | "EX-ASG-IN-SESSION-REQUIRED"
  | "EX-ASG-IN-STUDENT-REQUIRED"
  | "EX-ASG-IN-HORSE-REQUIRED";

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
export const EXAM_ASSIGNMENT_WRITE_INPUT_MESSAGES: Readonly<
  Record<ExamAssignmentWriteInputIssueCode, string>
> = Object.freeze({
  "EX-ASG-IN-SESSION-REQUIRED": "חובה לבחור מפגש מבחן",
  "EX-ASG-IN-STUDENT-REQUIRED": "חובה לבחור חניך",
  "EX-ASG-IN-HORSE-REQUIRED": "חובה לציין סוס עבור הנבחן",
});

/**
 * One diagnostic. Carries ONLY a stable code and its message: no submitted
 * value, no field path, no raw object, no id and no index.
 */
export interface ExamAssignmentWriteInputIssue {
  readonly code: ExamAssignmentWriteInputIssueCode;
  readonly message: string;
}

/**
 * Build one frozen diagnostic from its code.
 *
 * Exported so that the orchestration layer can express a refusal in EXACTLY
 * these terms without restating a message. A second copy of the Hebrew text
 * elsewhere is a copy free to drift.
 */
export function makeExamAssignmentWriteInputIssue(
  code: ExamAssignmentWriteInputIssueCode,
): ExamAssignmentWriteInputIssue {
  return Object.freeze({ code, message: EXAM_ASSIGNMENT_WRITE_INPUT_MESSAGES[code] });
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
export type ExamAssignmentWriteInputResult<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | {
      readonly ok: false;
      readonly issues: readonly ExamAssignmentWriteInputIssue[];
    };

/**
 * The normalized CREATE payload — exactly the three submitted fields, all of
 * them plain non-blank strings and never `null` or `undefined`, so the shape is
 * stable, JSON-round-trippable and unambiguous to a writer.
 *
 * Note once more what is absent: no `role`, no `orderIndex`, no `planId`, no
 * `courseOfferingId`, no `definitionId`, no `instructionTopic`, no `discipline`,
 * no `pairingIndex` and no `notes`.
 */
export interface NormalizedExamAssignmentCreate {
  readonly sessionId: string;
  readonly studentId: string;
  readonly horseName: string;
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
// The normalization
// ===========================================================================

/**
 * Normalize and validate a RAW examinee-assignment CREATE submission.
 *
 * EVERY applicable issue is reported, not only the first: a submission with no
 * trainee AND no horse has two problems, and hiding one behind the other would
 * cost the manager a second round-trip to discover it.
 *
 * The issue ORDER is FIXED and matches the field order of the payload —
 * sessionId, studentId, horseName — so a form can render diagnostics in a stable
 * sequence and a test can assert on it. The order does not depend on the raw
 * object's key order, on which fields are present, or on anything else.
 *
 * On success the payload is a FROZEN plain object holding exactly the three
 * fields. This function grants NOTHING: a successful result means only "these
 * three values are well-formed". Whether the session exists under the acting
 * course's plan, whether the trainee is enrolled there, whether the definition
 * even permits this operation, and whether the resulting row collides with an
 * existing one are ALL questions for the orchestration and write layers.
 *
 * Never throws. Never mutates `rawInput`; a frozen raw object is fine, because
 * nothing is ever written back to it.
 */
export function normalizeExamAssignmentCreateInput(
  rawInput: unknown,
): ExamAssignmentWriteInputResult<NormalizedExamAssignmentCreate> {
  const issues: ExamAssignmentWriteInputIssue[] = [];

  const sessionId = normalizeRequiredText(readField(rawInput, "sessionId"));
  if (sessionId === null) {
    issues.push(makeExamAssignmentWriteInputIssue("EX-ASG-IN-SESSION-REQUIRED"));
  }

  const studentId = normalizeRequiredText(readField(rawInput, "studentId"));
  if (studentId === null) {
    issues.push(makeExamAssignmentWriteInputIssue("EX-ASG-IN-STUDENT-REQUIRED"));
  }

  const horseName = normalizeRequiredText(readField(rawInput, "horseName"));
  if (horseName === null) {
    issues.push(makeExamAssignmentWriteInputIssue("EX-ASG-IN-HORSE-REQUIRED"));
  }

  if (issues.length > 0) {
    return Object.freeze({
      ok: false as const,
      issues: Object.freeze([...issues]),
    });
  }

  // Reached ONLY when all three fields validated, which is what proves the three
  // narrowing assertions below. They restate that proof for the type system and
  // widen nothing at runtime.
  return Object.freeze({
    ok: true as const,
    value: Object.freeze({
      sessionId: sessionId as string,
      studentId: studentId as string,
      horseName: horseName as string,
    }),
  });
}
