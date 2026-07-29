/**
 * EXAM EX-S5B-1 — PURE input normalization for the ExamDefinition WRITE path.
 *
 * PURE by construction: no Prisma, no DB, no clock, no randomness, no env, no
 * auth/session/cookie, no filesystem, no network, no Next. Every export is a
 * total, deterministic function of its arguments and never mutates its inputs.
 * The only runtime dependency is the sibling PURE validation core.
 *
 * WHAT THIS ANSWERS (and only this):
 *  - given a RAW, untrusted, form-like object, what is the exact normalized
 *    payload a future ExamDefinition writer may act on?
 *  - and if the answer is "none", which stable diagnostics explain why?
 *
 * WHAT THIS DELIBERATELY DOES NOT DO:
 *  - it OWNS NO DOMAIN RULE. Every rule about a definition's shape — the
 *    non-empty name, the storable kind, the positive-integer duration and
 *    capacity, and the `requires*` applicability restrictions — belongs to the
 *    committed `validateExamDefinition`, and this module CALLS it rather than
 *    restating it. A second copy of any of those rules here would be free to
 *    drift from the copy that the rest of the module already trusts;
 *  - it performs NO IO, NO authorization and NO database work. It never sees a
 *    plan, a course offering, a definition id, an actor, a timestamp or a row;
 *  - it decides NOTHING about ordering. `orderIndex` is not an input field and
 *    is never returned — the future write layer assigns it, and no ordering
 *    strategy is expressed, assumed or implied anywhere in this file;
 *  - it invents NO write outcome. There is no duplicate-name, stale-write,
 *    plan-not-found or policy code here: those describe a database and an
 *    authorization boundary this module cannot see.
 *
 * ===========================================================================
 * WHY THE RAW CANDIDATE IS HANDED STRAIGHT TO THE COMMITTED VALIDATOR
 * ===========================================================================
 * `validateExamDefinition` is TOTAL over runtime-invalid input BY DESIGN: its
 * `isPositiveInteger` rejects non-numbers, non-integers, NaN, Infinity and
 * numeric strings; its `isStorableExamKind` rejects non-strings, unknown
 * tokens, inherited prototype keys and BEGINNER_INSTRUCTION; its `isEnabled`
 * honours only a literal `true`.
 *
 * So this module does NOT pre-screen those values. It normalizes only what is
 * genuinely a normalization (trimming the name, collapsing a flag to a strict
 * boolean, dropping unknown keys) and passes the rest through UNTOUCHED and
 * UNCOERCED. A `"30"` stays the string `"30"` and is rejected by the rule that
 * owns numbers — it is never quietly turned into `30`.
 *
 * ===========================================================================
 * KIND IS CREATE-ONLY
 * ===========================================================================
 * `kind` selects which field rules apply to every block ever built from a
 * definition, so changing it after the fact would retroactively invalidate
 * stored assignments against rules `exam-domain-core` already enforces. It is
 * therefore supplied at CREATE and is not writable afterwards.
 *
 * The edit normalizer expresses that structurally: its normalized payload has
 * NO `kind` field at all, and the authoritative kind arrives as a SEPARATE
 * server-supplied argument that the raw object cannot reach. A raw object that
 * carries a `kind` property is REJECTED with `EX-DEF-KIND-NOT-EDITABLE` rather
 * than silently ignored — silence would let a manager watch a kind change be
 * "accepted" and never take effect, which is worse than a refusal.
 *
 * ===========================================================================
 * UNKNOWN KEYS
 * ===========================================================================
 * Only the named fields are ever read, so `id`, `planId`, `courseOfferingId`,
 * `orderIndex`, `createdAt`, `updatedAt`, `publishedAt`, session counts and
 * actor ids cannot enter a normalized payload — not because they are filtered
 * out, but because nothing here looks for them.
 *
 * `kind` on an EDIT is the ONE exception that is actively rejected, for the
 * reason above. `orderIndex` is deliberately NOT rejected on either path: it is
 * not a field a manager can submit through any surface this module serves, so a
 * refusal would describe a request nobody can make, while exclusion states the
 * locked rule exactly — the write layer assigns order, the client never does.
 *
 * ===========================================================================
 * NO BOUNDS, NO CASE FOLDING
 * ===========================================================================
 * There is NO maximum name length, NO maximum duration and NO maximum capacity
 * in this slice: no such bound is approved, and an unapproved ceiling would
 * silently reject a legitimate configuration.
 *
 * The name is preserved BYTE-FOR-BYTE except for `trim()`. There is no
 * `normalize()`, no `toLowerCase()`, no `localeCompare` and no
 * case-insensitive comparison of any kind — Hebrew and every other script
 * survive normalization unchanged, and duplicate detection is not this module's
 * concern.
 */
import type { ExamKind } from "./exam-domain-core";
import {
  validateExamDefinition,
  type ExamDefinitionInput,
  type ExamDefinitionIssueCode,
} from "./exam-definition-validation-core";

// ===========================================================================
// Codes + messages
// ===========================================================================

/**
 * The ONE code this module owns.
 *
 * Every other diagnostic it can return is a committed `EX-DEF-*` code produced
 * by `validateExamDefinition`; this one describes a request whose SHAPE is
 * unsafe rather than a definition whose CONTENT is invalid, so no committed
 * code covers it.
 */
export type ExamDefinitionWriteInputOwnIssueCode = "EX-DEF-KIND-NOT-EDITABLE";

/**
 * Every code a write-input result can carry: the committed validation core's
 * full code union plus the one code above.
 *
 * The committed union is referenced WHOLE rather than narrowed to the
 * definition-shape subset, so this module never maintains a second copy of a
 * code list that would need editing every time the validation core gains a
 * code. In practice `validateExamDefinition` emits only its shape codes, so the
 * conformance codes — which describe assignments, not definitions — are
 * representable here but never produced.
 */
export type ExamDefinitionWriteInputIssueCode =
  | ExamDefinitionIssueCode
  | ExamDefinitionWriteInputOwnIssueCode;

/**
 * The message table for the code this module owns. Delegated issues carry the
 * committed core's own message verbatim and are never re-worded here.
 */
export const EXAM_DEFINITION_WRITE_INPUT_MESSAGES: Readonly<
  Record<ExamDefinitionWriteInputOwnIssueCode, string>
> = Object.freeze({
  "EX-DEF-KIND-NOT-EDITABLE": "לא ניתן לשנות את סוג הבחינה לאחר יצירת ההגדרה",
});

/**
 * One diagnostic. Deliberately carries ONLY a stable code and its message: no
 * submitted value, no field path, no raw object and no id, so a diagnostic can
 * never echo what the client sent back to the client.
 *
 * There is no `assignmentId` here (unlike the committed `ExamDefinitionIssue`):
 * a write INPUT describes a definition, and no assignment exists at this stage.
 */
export interface ExamDefinitionWriteInputIssue {
  readonly code: ExamDefinitionWriteInputIssueCode;
  readonly message: string;
}

// ===========================================================================
// Result
// ===========================================================================

/**
 * A discriminated, JSON-safe result.
 *
 * The success arm carries NO `issues` key and the failure arm carries NO
 * `value` key, so no property is ever present-but-undefined and
 * `JSON.parse(JSON.stringify(result))` deep-equals the result itself. Nothing
 * in either arm is a Date, Map, Set, BigInt, Error or class instance.
 */
export type ExamDefinitionWriteInputResult<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly issues: readonly ExamDefinitionWriteInputIssue[] };

/**
 * The normalized CREATE payload — exactly the seven fields a definition is
 * created from. It carries no id, no plan, no course, no order and no
 * timestamp: those belong to the write layer, which supplies them itself.
 */
export interface NormalizedExamDefinitionCreate {
  readonly name: string;
  readonly kind: ExamKind;
  readonly durationMinutes: number;
  readonly parallelCapacity: number;
  readonly requiresInstructedTrainee: boolean;
  readonly requiresLessonTopic: boolean;
  readonly requiresDiscipline: boolean;
}

/**
 * The normalized EDIT payload — the same fields MINUS `kind`.
 *
 * The absence of `kind` is the enforcement, not a convention: a writer handed
 * this type has no field through which a kind could be written, so kind
 * immutability cannot be undone by a future caller mistake.
 */
export interface NormalizedExamDefinitionEdit {
  readonly name: string;
  readonly durationMinutes: number;
  readonly parallelCapacity: number;
  readonly requiresInstructedTrainee: boolean;
  readonly requiresLessonTopic: boolean;
  readonly requiresDiscipline: boolean;
}

// ===========================================================================
// Helpers
// ===========================================================================

/**
 * Read one OWN property of a raw value, or `undefined`.
 *
 * Own-property only: a raw object inherits `toString`, `constructor` and
 * friends from its prototype, and reading those as if the client had sent them
 * would turn prototype members into submitted data.
 */
function readField(source: unknown, key: string): unknown {
  if (typeof source !== "object" || source === null) return undefined;
  if (!Object.prototype.hasOwnProperty.call(source, key)) return undefined;
  return (source as Record<string, unknown>)[key];
}

/** Did the raw value carry this key as an OWN property, whatever its value? */
function hasField(source: unknown, key: string): boolean {
  return (
    typeof source === "object" &&
    source !== null &&
    Object.prototype.hasOwnProperty.call(source, key)
  );
}

/**
 * Trim a submitted name to a string.
 *
 * A non-string (missing, null, number, object, array) becomes `""`, which the
 * committed core then rejects with its own name-required diagnostic — the
 * emptiness RULE stays there, and only the trimming happens here. Internal
 * whitespace and every non-ASCII character are untouched.
 */
function normalizeName(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * A flag is `true` only when the raw value is literally the boolean `true`.
 * `"true"`, `1`, `"on"` and every other truthy value normalize to `false`, so
 * no accidental string from a form can switch a requirement on.
 */
function normalizeFlag(value: unknown): boolean {
  return value === true;
}

/**
 * The un-validated candidate handed to the committed validator.
 *
 * `name` and the three flags are already normalized (that is normalization);
 * `kind`, `durationMinutes` and `parallelCapacity` are still `unknown` because
 * the rules that judge them live in the validation core and are not restated
 * here.
 */
interface ExamDefinitionCandidate {
  readonly name: string;
  readonly kind: unknown;
  readonly durationMinutes: unknown;
  readonly parallelCapacity: unknown;
  readonly requiresInstructedTrainee: boolean;
  readonly requiresLessonTopic: boolean;
  readonly requiresDiscipline: boolean;
}

/**
 * Build the candidate from raw input plus an explicitly-supplied kind.
 *
 * The kind is a PARAMETER rather than another field read from `rawInput`: it is
 * what lets the edit path bind the server's authoritative kind while the create
 * path binds the submitted one, with no branch inside this function and no way
 * for an edit to reach the raw object's kind.
 */
function buildCandidate(rawInput: unknown, kind: unknown): ExamDefinitionCandidate {
  return {
    name: normalizeName(readField(rawInput, "name")),
    kind,
    durationMinutes: readField(rawInput, "durationMinutes"),
    parallelCapacity: readField(rawInput, "parallelCapacity"),
    requiresInstructedTrainee: normalizeFlag(readField(rawInput, "requiresInstructedTrainee")),
    requiresLessonTopic: normalizeFlag(readField(rawInput, "requiresLessonTopic")),
    requiresDiscipline: normalizeFlag(readField(rawInput, "requiresDiscipline")),
  };
}

function makeIssue(
  code: ExamDefinitionWriteInputIssueCode,
  message: string,
): ExamDefinitionWriteInputIssue {
  return Object.freeze({ code, message });
}

/**
 * Run the COMMITTED validator over the candidate and adopt its diagnostics.
 *
 * The cast is the documented contract of that core, not a shortcut: it is total
 * over runtime-invalid input, which is precisely why the raw values reach it
 * untouched instead of being pre-screened by a second copy of its rules here.
 * The issue ORDER it produces is preserved exactly, and each message is carried
 * verbatim.
 */
function delegateToValidator(
  candidate: ExamDefinitionCandidate,
): readonly ExamDefinitionWriteInputIssue[] {
  const validated = validateExamDefinition(candidate as unknown as ExamDefinitionInput);
  return validated.issues.map((issue) => makeIssue(issue.code, issue.message));
}

function failure<TValue>(
  issues: readonly ExamDefinitionWriteInputIssue[],
): ExamDefinitionWriteInputResult<TValue> {
  return Object.freeze({ ok: false as const, issues: Object.freeze([...issues]) });
}

function success<TValue>(value: TValue): ExamDefinitionWriteInputResult<TValue> {
  return Object.freeze({ ok: true as const, value });
}

// ===========================================================================
// 1. Create
// ===========================================================================

/**
 * Normalize and validate a RAW create submission.
 *
 * Order: normalize what is normalizable, then delegate EVERY rule to the
 * committed validator. On success the payload is frozen and contains exactly
 * the seven create fields; on failure the issues are the validator's own, in
 * the validator's own stable order (name, kind, duration, capacity,
 * instructed-trainee applicability, lesson-topic applicability), and every
 * applicable issue is reported rather than only the first.
 *
 * A non-object `rawInput` — `null`, `undefined`, a string, a number, an array —
 * is not a special case: every field simply reads as absent and the ordinary
 * diagnostics explain what is missing.
 *
 * Never throws. Never mutates `rawInput`. A frozen `rawInput` is fine, because
 * nothing is written back to it.
 */
export function normalizeExamDefinitionCreateInput(
  rawInput: unknown,
): ExamDefinitionWriteInputResult<NormalizedExamDefinitionCreate> {
  const candidate = buildCandidate(rawInput, readField(rawInput, "kind"));

  const issues = delegateToValidator(candidate);
  if (issues.length > 0) {
    return failure(issues);
  }

  // Reached ONLY after the committed validator returned ok, which is what
  // proves `kind` is a storable ExamKind and both numbers are positive
  // integers. The assertions restate that proof for the type system; they widen
  // nothing at runtime.
  return success(
    Object.freeze({
      name: candidate.name,
      kind: candidate.kind as ExamKind,
      durationMinutes: candidate.durationMinutes as number,
      parallelCapacity: candidate.parallelCapacity as number,
      requiresInstructedTrainee: candidate.requiresInstructedTrainee,
      requiresLessonTopic: candidate.requiresLessonTopic,
      requiresDiscipline: candidate.requiresDiscipline,
    }),
  );
}

// ===========================================================================
// 2. Edit
// ===========================================================================

/**
 * Normalize and validate a RAW edit submission against the AUTHORITATIVE kind.
 *
 * `currentKind` is the kind the server already read from the stored definition.
 * It is the ONLY kind that participates: the raw object's `kind`, if any, never
 * reaches the candidate, so a submitted `BEGINNER_INSTRUCTION`, a free string
 * or a prototype-shaped token cannot override, weaken or widen it. Instead its
 * mere presence is reported as `EX-DEF-KIND-NOT-EDITABLE`.
 *
 * Issue order is stable: the kind-not-editable diagnostic first (it rejects the
 * shape of the request), then the validator's own issues in the validator's own
 * order. Both are reported together — a request that is malformed AND carries
 * an invalid duration has two problems, and hiding one behind the other would
 * cost the manager a second round-trip to discover it.
 *
 * A `currentKind` that is not storable FAILS CLOSED: it is passed to the
 * committed validator like any other, which rejects it with
 * `EX-DEF-KIND-NOT-STORABLE`. No edit is normalized against a kind the domain
 * would refuse.
 *
 * Never throws. Never mutates `rawInput`.
 */
export function normalizeExamDefinitionEditInput(
  rawInput: unknown,
  currentKind: ExamKind,
): ExamDefinitionWriteInputResult<NormalizedExamDefinitionEdit> {
  const issues: ExamDefinitionWriteInputIssue[] = [];

  if (hasField(rawInput, "kind")) {
    issues.push(
      makeIssue(
        "EX-DEF-KIND-NOT-EDITABLE",
        EXAM_DEFINITION_WRITE_INPUT_MESSAGES["EX-DEF-KIND-NOT-EDITABLE"],
      ),
    );
  }

  // The AUTHORITATIVE kind, always. The raw object's kind is never read here.
  const candidate = buildCandidate(rawInput, currentKind);
  issues.push(...delegateToValidator(candidate));

  if (issues.length > 0) {
    return failure(issues);
  }

  // No `kind` field: the normalized edit payload cannot express a kind change.
  return success(
    Object.freeze({
      name: candidate.name,
      durationMinutes: candidate.durationMinutes as number,
      parallelCapacity: candidate.parallelCapacity as number,
      requiresInstructedTrainee: candidate.requiresInstructedTrainee,
      requiresLessonTopic: candidate.requiresLessonTopic,
      requiresDiscipline: candidate.requiresDiscipline,
    }),
  );
}
