/**
 * EXAM EX-S5B-3 — the PURE orchestration of ONE ExamDefinition EDIT.
 *
 * PURE by construction: no Prisma, no DB, no transaction, no clock, no
 * randomness, no env, no auth/session/cookie, no filesystem, no network, no
 * Next, no `server-only`, no `"use server"`. Every effect this operation needs
 * arrives through the injected `UpdateExamDefinitionDeps`, so the ORDER in which
 * authorization, lifecycle gating, plan resolution, existence, validation and
 * the conditional write happen is stated once, here, and is testable without a
 * database.
 *
 * WHAT THIS ANSWERS (and only this):
 *  - in which EXACT order must a definition edit authorize, gate, resolve,
 *    locate, validate and write?
 *  - which edit is a NO-OP, and what does a no-op cost?
 *  - and which stable, non-echoing outcome describes each way it can fail?
 *
 * WHAT THIS DELIBERATELY DOES NOT DO:
 *  - it OWNS NO INPUT RULE. Every rule about a definition's shape belongs to the
 *    committed `normalizeExamDefinitionEditInput` (which itself delegates to the
 *    committed domain validator), and this module CALLS it;
 *  - it OWNS NO POLICY TABLE. Which offering statuses may be configured is the
 *    committed course operation policy's decision, reached through
 *    `assertConfigurationAllowed`;
 *  - it CREATES NOTHING and DELETES NOTHING. No dependency can create a plan, a
 *    definition or a session, and none can remove one — the removal path is its
 *    own pure core;
 *  - it does NOT reorder, publish, unpublish or archive anything, and it sends
 *    no notification. There is no dependency through which it could.
 *
 * ===========================================================================
 * KIND IS IMMUTABLE, STRUCTURALLY
 * ===========================================================================
 * `kind` selects which field rules apply to every block ever built from a
 * definition, so changing it would retroactively invalidate stored assignments
 * against rules the domain core already enforces.
 *
 * Three independent facts enforce that here, and none of them is a convention
 * someone must remember:
 *  - the public signature has NO kind parameter;
 *  - the AUTHORITATIVE kind — the one read back from the stored row — is what is
 *    handed to the committed edit normalizer, so validation is always performed
 *    against the kind the database actually holds;
 *  - the normalized edit payload the write dependency receives has NO `kind`
 *    field at all, so a kind cannot be written even by mistake.
 *
 * A raw object that CARRIES a `kind` property is refused by the committed
 * normalizer with `EX-DEF-KIND-NOT-EDITABLE` rather than silently ignored, so a
 * submitted `BEGINNER_INSTRUCTION` can never be "accepted" and quietly dropped.
 *
 * ===========================================================================
 * THE CALLER SUPPLIES A REQUEST, NEVER A GRANT
 * ===========================================================================
 * The only four arguments are a REQUESTED `courseOfferingId`, a `definitionId`,
 * an optimistic-concurrency token and a RAW, untrusted input object. There is no
 * parameter — and no readable field of the raw object — through which a caller
 * could supply a `planId`, a `kind`, an `orderIndex`, an actor id, a session
 * count, a publication option or a transaction handle.
 *
 * `planId` is derived SERVER-SIDE from the DB-verified offering id that
 * `requireCourseContext` returned. The requested offering id is used for exactly
 * one thing — asking the course boundary to verify it — and is never read again,
 * so a caller cannot steer the plan lookup at one offering while being
 * authorized for another.
 *
 * The definition is then located UNDER THAT SERVER-RESOLVED PLAN. A definition
 * id that belongs to a different plan is therefore INDISTINGUISHABLE from one
 * that does not exist: both are `definition_not_found`, and neither reveals that
 * some other course holds it.
 *
 * ===========================================================================
 * THE LOCKED ORDER, AND WHY EACH STEP PRECEDES THE NEXT
 * ===========================================================================
 *   1. requireCourseContext(requested id)    — admin + exact-offering boundary
 *   2. assertConfigurationAllowed(status)    — course-lifecycle gate
 *   3. findExamPlanByCourseOfferingId(id)    — VERIFIED id only
 *   4. no plan                               -> plan_not_found
 *   5. findDefinitionForUpdate(plan.id, id)  — SERVER plan id only
 *   6. missing / foreign plan                -> definition_not_found
 *   7. the concurrency token                 -> invalid_input when unusable
 *   8. normalizeExamDefinitionEditInput(raw, AUTHORITATIVE kind)
 *   9. invalid                               -> invalid_input + stable issues
 *  10. compare against the authoritative row
 *  11. equal                                 -> success, changed:false, NO write
 *  12. updateDefinitionIfCurrent(plan.id, id, token, value)
 *  13. nothing matched                       -> stale_write
 *  14. narrow success DTO, changed:true
 *
 * The consequences are the point:
 *  - NOTHING is validated for a course the actor may not access, so validation
 *    diagnostics can never be used as an oracle over another course;
 *  - NO exam query happens before authorization and the lifecycle gate, so an
 *    ARCHIVED offering costs zero exam reads;
 *  - the kind used for validation is READ, never submitted;
 *  - no write dependency runs when validation fails or when nothing changed.
 *
 * ===========================================================================
 * EDITING A PUBLISHED PLAN IS ALLOWED
 * ===========================================================================
 * This module never reads a plan's publication state — `ResolvedExamPlanForUpdate`
 * carries an id and nothing else — so a published plan cannot block, alter or
 * branch the edit. No unpublish is required, no `publishedAt` is touched, and no
 * notification is sent, because no dependency exists that could do any of those.
 * Warning a manager that a duration change affects a plan trainees can already
 * see is a UI concern for a later, separately reviewed slice.
 *
 * ===========================================================================
 * ONLY FOUR KNOWN FAILURES ARE CLASSIFIED — EVERYTHING ELSE PROPAGATES
 * ===========================================================================
 * Exactly three injected predicates may convert a THROW into a refusal (the
 * course not-found, the lifecycle denial and the definition-name uniqueness
 * conflict), and one dependency may report a non-throwing refusal by returning
 * `null` (nothing matched the conditional write). Every other throw — an
 * infrastructure fault, a programming error, an unexpected read failure —
 * LEAVES THIS MODULE UNCHANGED.
 *
 * There is no `unexpected` code and no catch-all `catch`: a generic failure code
 * would let a real defect render as an ordinary form error nobody investigates.
 *
 * CRITICALLY, the admin boundary denies by REDIRECTING (a Next `NEXT_REDIRECT`
 * throw). Because each classifier is asked about one specific error shape and
 * anything unrecognized is re-thrown, a redirect passes straight through and the
 * framework still performs it.
 */
import type { ExamKind } from "./exam-domain-core";
import {
  normalizeExamDefinitionEditInput,
  type ExamDefinitionWriteInputIssueCode,
  type NormalizedExamDefinitionEdit,
} from "./exam-definition-write-core";

export type { NormalizedExamDefinitionEdit } from "./exam-definition-write-core";

// ===========================================================================
// The concurrency token
// ===========================================================================

/**
 * The optimistic-concurrency token is EPOCH MILLISECONDS, as a plain number.
 *
 * Not a `Date`: a Date is not JSON, does not survive a form round trip, and
 * would drag a mutable, timezone-shaped object through a pure core and across
 * the network boundary. The conversion to whatever the database compares
 * happens exactly once, in the IO layer, and no `Date` appears in any signature
 * or result of this module.
 *
 * A token is usable only when it is literally a finite, non-negative integer
 * number. A numeric STRING is refused rather than coerced — `Number("")` is `0`
 * and `Number(" 1 ")` is `1`, so coercion here would silently manufacture a
 * token the client never sent and compare it against a stored row.
 */
export function isExamDefinitionVersionToken(value: unknown): boolean {
  // `Number.isInteger` already rejects non-numbers, NaN, Infinity and
  // fractions; the sign check rejects a negative instant, which no stored
  // `updatedAt` in this system can be.
  return Number.isInteger(value) && (value as number) >= 0;
}

// ===========================================================================
// The injected boundary
// ===========================================================================

/**
 * The course context an edit may act on, AFTER the boundary verified it.
 *
 * Deliberately TWO fields: a name, a level, an ActivityYear or a date would be
 * data this operation has no business reading, and a Prisma type here would end
 * this module's purity. `status` is a plain `string` for the same reason; the
 * committed policy the gate consults is default-deny, so an unrecognized status
 * is refused rather than waved through.
 */
export interface VerifiedExamDefinitionCourseContext {
  readonly courseOfferingId: string;
  readonly status: string;
}

/**
 * The plan the definition must live under: its id and nothing else.
 *
 * No `publishedAt`, no source dates, no sessions, no definitions, no offering
 * relation, no timestamps — an edit must not be able to make a decision from
 * data it should not have read, and publication in particular must not gate it.
 */
export interface ResolvedExamPlanForUpdate {
  readonly id: string;
}

/**
 * The AUTHORITATIVE stored definition, read back under the server-resolved plan.
 *
 * `kind` is here because it DRIVES validation and can never be written; the six
 * editable fields are here because a no-op is defined against them; `updatedAt`
 * is here because it is what a successful no-op reports back. Nothing else — no
 * plan id, no order position, no `createdAt`, no relation.
 */
export interface ExistingExamDefinitionForUpdate {
  readonly id: string;
  readonly kind: ExamKind;
  readonly name: string;
  readonly durationMinutes: number;
  readonly parallelCapacity: number;
  readonly requiresInstructedTrainee: boolean;
  readonly requiresLessonTopic: boolean;
  readonly requiresDiscipline: boolean;
  /** Epoch milliseconds. */
  readonly updatedAt: number;
}

/**
 * What the conditional write reports back: the id it matched and the NEW version
 * token. Never the row, never the stored name, never a Date.
 */
export interface UpdatedExamDefinitionRecord {
  readonly id: string;
  /** Epoch milliseconds. */
  readonly updatedAt: number;
}

/**
 * The complete injected boundary.
 *
 * Note what is ABSENT and therefore unrepresentable: there is no dependency that
 * can create or upsert a plan, create or delete a definition, reorder
 * definitions, write a session or an assignment, publish or unpublish anything,
 * send a notification, resolve a capability, or read another course. The
 * operation is structurally incapable of doing anything but rewriting six fields
 * of one definition of one already-existing plan.
 *
 * The three predicates take `unknown` and return a boolean: this module never
 * inspects, unwraps, logs or echoes a raw error, so no database detail and no
 * submitted value can leak into a result through them.
 */
export interface UpdateExamDefinitionDeps {
  /**
   * Authorize the actor and verify the REQUESTED offering exists. May throw the
   * project's typed not-found, and may REDIRECT for an unauthenticated or
   * non-admin caller — the redirect must reach the framework untouched.
   */
  requireCourseContext(
    requestedCourseOfferingId: string,
  ): Promise<VerifiedExamDefinitionCourseContext>;

  /** Gate the mutation on the VERIFIED offering status. Throws to deny. */
  assertConfigurationAllowed(status: string): void;

  /** Find the plan of the VERIFIED offering. `null` means "no plan exists". */
  findExamPlanByCourseOfferingId(
    verifiedCourseOfferingId: string,
  ): Promise<ResolvedExamPlanForUpdate | null>;

  /**
   * Read the definition UNDER the given plan. `null` means "no such definition
   * in this plan" — which deliberately covers both "does not exist" and
   * "belongs to another plan".
   */
  findDefinitionForUpdate(
    planId: string,
    definitionId: string,
  ): Promise<ExistingExamDefinitionForUpdate | null>;

  /**
   * The SINGLE write: rewrite the six editable fields of that definition ONLY IF
   * its stored version still equals `expectedUpdatedAt`. `null` means nothing
   * matched — the row moved under us, or vanished — and is the ONLY way a stale
   * write is reported.
   */
  updateDefinitionIfCurrent(
    planId: string,
    definitionId: string,
    expectedUpdatedAt: number,
    value: NormalizedExamDefinitionEdit,
  ): Promise<UpdatedExamDefinitionRecord | null>;

  /** Is this throw "the requested offering does not exist"? */
  isCourseNotFoundError(error: unknown): boolean;

  /** Is this throw "the offering's lifecycle forbids this operation"? */
  isOperationNotAllowedError(error: unknown): boolean;

  /** Is this throw the definition-name uniqueness conflict? */
  isDuplicateNameError(error: unknown): boolean;
}

// ===========================================================================
// Diagnostics
// ===========================================================================

/**
 * The ONE code this module owns.
 *
 * Every other diagnostic it can return is a committed code produced by the
 * committed edit normalizer. This one describes a request whose CONCURRENCY
 * TOKEN is unusable rather than a definition whose content is invalid, so no
 * committed code covers it — and it is deliberately a separate code rather than
 * a reuse of the stale-write refusal, because "your form is malformed" and
 * "someone else edited this row" call for different manager actions.
 */
export type UpdateExamDefinitionOwnIssueCode = "EX-DEF-VERSION-INVALID";

/** Every code an edit result can carry. */
export type UpdateExamDefinitionIssueCode =
  | ExamDefinitionWriteInputIssueCode
  | UpdateExamDefinitionOwnIssueCode;

/**
 * One diagnostic. Deliberately carries ONLY a stable code and its message: no
 * submitted value, no field path, no raw object and no id, so a diagnostic can
 * never echo what the client sent back to the client.
 */
export interface UpdateExamDefinitionIssue {
  readonly code: UpdateExamDefinitionIssueCode;
  readonly message: string;
}

/** The message table for the code this module owns. */
export const UPDATE_EXAM_DEFINITION_MESSAGES: Readonly<
  Record<UpdateExamDefinitionOwnIssueCode, string>
> = Object.freeze({
  "EX-DEF-VERSION-INVALID": "בקשת העריכה אינה תקינה. יש לרענן את הדף ולנסות שוב",
});

// ===========================================================================
// The result model
// ===========================================================================

/**
 * The failure codes that need no diagnostics: each is fully described by the
 * code itself.
 */
export type UpdateExamDefinitionRefusalCode =
  | "offering_not_found"
  | "operation_not_allowed"
  | "plan_not_found"
  | "definition_not_found"
  | "duplicate_name"
  | "stale_write";

/**
 * A discriminated, JSON-safe, frozen result.
 *
 * FOUR arms. The two success arms differ only in `changed`, which is a LITERAL
 * on each so a caller can narrow on it; `issues` EXISTS ONLY on `invalid_input`,
 * so no property is ever present-but-`undefined` and the JSON round trip is
 * exact.
 *
 * Nothing in any arm is a Date, Map, Set, BigInt, Error or class instance, and
 * nothing carries a plan id, a course offering id, an actor id, a session count,
 * a raw error, a database detail or the submitted name.
 *
 * There is deliberately no `unexpected`, `definition_in_use`, `archived`,
 * `reorder_conflict` or `plan_published` code: the first would hide defects, and
 * the rest describe operations this slice does not perform.
 */
export type UpdateExamDefinitionResult =
  | {
      readonly ok: true;
      readonly definitionId: string;
      readonly changed: true;
      readonly updatedAt: number;
    }
  | {
      readonly ok: true;
      readonly definitionId: string;
      readonly changed: false;
      readonly updatedAt: number;
    }
  | {
      readonly ok: false;
      readonly code: "invalid_input";
      readonly issues: readonly UpdateExamDefinitionIssue[];
    }
  | {
      readonly ok: false;
      readonly code: UpdateExamDefinitionRefusalCode;
    };

function refuse(code: UpdateExamDefinitionRefusalCode): UpdateExamDefinitionResult {
  return Object.freeze({ ok: false as const, code });
}

function refuseInput(
  issues: readonly UpdateExamDefinitionIssue[],
): UpdateExamDefinitionResult {
  return Object.freeze({
    ok: false as const,
    code: "invalid_input" as const,
    // A fresh frozen copy: the result must not alias an array a caller could
    // later mutate, and the committed core's own issue ORDER is preserved
    // exactly so a form can render diagnostics in a stable sequence.
    issues: Object.freeze([...issues]),
  });
}

function refuseVersionToken(): UpdateExamDefinitionResult {
  return refuseInput([
    Object.freeze({
      code: "EX-DEF-VERSION-INVALID" as const,
      message: UPDATE_EXAM_DEFINITION_MESSAGES["EX-DEF-VERSION-INVALID"],
    }),
  ]);
}

function succeedChanged(updated: UpdatedExamDefinitionRecord): UpdateExamDefinitionResult {
  return Object.freeze({
    ok: true as const,
    definitionId: updated.id,
    changed: true as const,
    updatedAt: updated.updatedAt,
  });
}

function succeedUnchanged(
  existing: ExistingExamDefinitionForUpdate,
): UpdateExamDefinitionResult {
  return Object.freeze({
    ok: true as const,
    definitionId: existing.id,
    changed: false as const,
    // The AUTHORITATIVE version, unchanged — so a form that re-submits keeps a
    // token the database will still recognize.
    updatedAt: existing.updatedAt,
  });
}

// ===========================================================================
// The no-op rule
// ===========================================================================

/**
 * Is this normalized edit exactly what the stored row already holds?
 *
 * All SIX editable fields are compared, and only those six. `kind` is not
 * compared, because it is not editable and comparing it would suggest it could
 * differ; `orderIndex`, `planId`, `createdAt` and `updatedAt` are not compared,
 * because they are not editable either.
 *
 * The name comparison is EXACT and case-SENSITIVE — the same rule the database's
 * `@@unique([planId, name])` key enforces. "רכיבה" and "רכיבה " differ only
 * after trimming, and the committed normalizer already trimmed; anything still
 * different after that is a real rename.
 *
 * WHY A NO-OP IGNORES A STALE TOKEN. A no-op is decided against the
 * AUTHORITATIVE row, read AFTER authorization, the lifecycle gate and the plan
 * resolution — not against the values the browser was showing. So "the token is
 * old" and "the row already says exactly this" can both be true, and in that
 * case there is nothing to protect: no write is attempted, no other manager's
 * change is overwritten, and the reported version is the CURRENT one. Refusing
 * with `stale_write` would demand a reload that changes nothing. The token is
 * still REQUIRED to be well-formed, because a malformed one means the request
 * itself is malformed.
 */
function isUnchanged(
  existing: ExistingExamDefinitionForUpdate,
  value: NormalizedExamDefinitionEdit,
): boolean {
  return (
    existing.name === value.name &&
    existing.durationMinutes === value.durationMinutes &&
    existing.parallelCapacity === value.parallelCapacity &&
    existing.requiresInstructedTrainee === value.requiresInstructedTrainee &&
    existing.requiresLessonTopic === value.requiresLessonTopic &&
    existing.requiresDiscipline === value.requiresDiscipline
  );
}

// ===========================================================================
// The orchestration
// ===========================================================================

/**
 * Edit exactly ONE ExamDefinition of the plan of one authorized,
 * lifecycle-permitted course offering.
 *
 * The order is the safety contract, and it is enforced by construction: each
 * step's output is the next step's only input, so no step can be reordered
 * without the code failing to compile or the plan id becoming unavailable.
 *
 * Each `try` wraps EXACTLY ONE dependency call and asks EXACTLY ONE classifier.
 * Nothing is caught broadly, and an unrecognized error is re-thrown with its
 * identity intact — including a `NEXT_REDIRECT` from the authorization boundary.
 *
 * Never mutates `rawInput`; a frozen raw object is fine.
 */
export async function updateExamDefinitionWithDeps(
  courseOfferingId: string,
  definitionId: string,
  expectedUpdatedAt: number,
  rawInput: unknown,
  deps: UpdateExamDefinitionDeps,
): Promise<UpdateExamDefinitionResult> {
  // 1. Authorization + exact-offering verification FIRST. Nothing about exams,
  //    plans, the definition or the submitted input is touched before this.
  let context: VerifiedExamDefinitionCourseContext;
  try {
    context = await deps.requireCourseContext(courseOfferingId);
  } catch (error) {
    if (deps.isCourseNotFoundError(error)) {
      return refuse("offering_not_found");
    }
    throw error;
  }

  // 2. The course-lifecycle gate, on the VERIFIED status. Runs before any exam
  //    query, so an ARCHIVED offering costs zero exam reads.
  try {
    deps.assertConfigurationAllowed(context.status);
  } catch (error) {
    if (deps.isOperationNotAllowedError(error)) {
      return refuse("operation_not_allowed");
    }
    throw error;
  }

  // 3. The plan of the VERIFIED offering. `courseOfferingId` — the requested,
  //    unverified value — is never read again from here on.
  const plan = await deps.findExamPlanByCourseOfferingId(context.courseOfferingId);

  // 4. No plan means no definition to edit.
  if (!plan) {
    return refuse("plan_not_found");
  }

  // 5. The definition, located UNDER the server-resolved plan. A definition of
  //    another plan simply is not found here.
  const existing = await deps.findDefinitionForUpdate(plan.id, definitionId);

  // 6. Missing, or belonging to another plan — one indistinguishable outcome.
  if (!existing) {
    return refuse("definition_not_found");
  }

  // 7. The concurrency token must be well-formed before it is compared against
  //    anything. A malformed token is a malformed request, not a conflict.
  if (!isExamDefinitionVersionToken(expectedUpdatedAt)) {
    return refuseVersionToken();
  }

  // 8. Only NOW is the submitted input examined, and against the AUTHORITATIVE
  //    kind — the raw object's own `kind`, if any, is refused by the committed
  //    normalizer and never participates.
  const normalized = normalizeExamDefinitionEditInput(rawInput, existing.kind);

  // 9. Invalid input ends the operation with the committed diagnostics verbatim.
  //    The write dependency is not reached at all.
  if (!normalized.ok) {
    return refuseInput(normalized.issues);
  }

  // 10-11. Nothing to do: report the CURRENT version and perform no write.
  if (isUnchanged(existing, normalized.value)) {
    return succeedUnchanged(existing);
  }

  // 12. The single write, against the SERVER-RESOLVED plan id, the requested
  //     definition id and the caller's version token. Whether the token still
  //     matches is the WRITE's decision, made atomically — never a decision made
  //     here from the row read in step 5, which could already be out of date.
  let updated: UpdatedExamDefinitionRecord | null;
  try {
    updated = await deps.updateDefinitionIfCurrent(
      plan.id,
      definitionId,
      expectedUpdatedAt,
      normalized.value,
    );
  } catch (error) {
    if (deps.isDuplicateNameError(error)) {
      return refuse("duplicate_name");
    }
    throw error;
  }

  // 13. Nothing matched: another manager changed (or removed) the row first.
  if (!updated) {
    return refuse("stale_write");
  }

  // 14. The narrow success DTO: the id and the NEW version token, nothing else.
  return succeedChanged(updated);
}
