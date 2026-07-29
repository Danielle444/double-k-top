/**
 * EXAM EX-S5B-2 — the PURE orchestration of ONE ExamDefinition CREATE.
 *
 * PURE by construction: no Prisma, no DB, no transaction, no clock, no
 * randomness, no env, no auth/session/cookie, no filesystem, no network, no
 * Next, no `server-only`, no `"use server"`. Every effect this operation needs
 * arrives through the injected `CreateExamDefinitionDeps`, so the ORDER in which
 * authorization, lifecycle gating, plan resolution, validation and the write
 * happen is stated once, here, and is testable without a database.
 *
 * WHAT THIS ANSWERS (and only this):
 *  - in which EXACT order must a definition create authorize, gate, resolve,
 *    validate and write?
 *  - and which stable, non-echoing outcome describes each way it can fail?
 *
 * WHAT THIS DELIBERATELY DOES NOT DO:
 *  - it OWNS NO INPUT RULE. Every rule about a definition's shape belongs to the
 *    committed `normalizeExamDefinitionCreateInput` (which itself delegates to
 *    the committed domain validator), and this module CALLS it. In particular
 *    the refusal of `BEGINNER_INSTRUCTION` — beginner exams are a LIVE Teaching
 *    Practice projection and must never become a stored definition — is enforced
 *    THERE, and is not restated here where it could drift;
 *  - it OWNS NO POLICY TABLE. Which offering statuses may be configured is the
 *    committed course operation policy's decision, reached through
 *    `assertConfigurationAllowed`;
 *  - it CREATES NO PLAN. A definition may be created only under an ExamPlan that
 *    ALREADY EXISTS. There is no dependency capable of creating or upserting a
 *    plan, so lazy plan creation is not merely unimplemented — it is
 *    unrepresentable. A missing plan is an ordinary refusal (`plan_not_found`);
 *  - it PERFORMS NO IO and knows nothing of Prisma, a transaction client, a row
 *    or a query. `createDefinitionAtNextOrder` is an opaque promise;
 *  - it does NOT edit, rename, re-kind, delete, archive, reorder or publish
 *    anything, and it sends no notification. Those are later slices.
 *
 * ===========================================================================
 * THE CALLER SUPPLIES A REQUEST, NEVER A GRANT
 * ===========================================================================
 * The only two arguments are a REQUESTED `courseOfferingId` and a RAW,
 * untrusted input object. There is no parameter — and no readable field of the
 * raw object — through which a caller could supply a `planId`, a `definitionId`,
 * an `orderIndex`, an actor id, a publication option or a transaction handle.
 *
 * `planId` in particular is derived SERVER-SIDE from the DB-verified offering id
 * that `requireCourseContext` returned, never from the request. The requested id
 * is used for exactly one thing — asking the course boundary to verify it — and
 * is never read again afterwards, so a caller cannot steer the plan lookup at
 * one offering while being authorized for another.
 *
 * `orderIndex` is assigned entirely inside `createDefinitionAtNextOrder`. This
 * module never computes, reads, defaults or forwards one; the committed input
 * normalizer does not even model the field.
 *
 * ===========================================================================
 * THE LOCKED ORDER, AND WHY EACH STEP PRECEDES THE NEXT
 * ===========================================================================
 *   1. requireCourseContext(requested id)   — admin + exact-offering boundary
 *   2. assertConfigurationAllowed(status)   — course-lifecycle gate
 *   3. findExamPlanByCourseOfferingId(id)   — VERIFIED id only
 *   4. no plan                              -> plan_not_found
 *   5. normalizeExamDefinitionCreateInput   — the committed input rules
 *   6. invalid                              -> invalid_input + stable issues
 *   7. createDefinitionAtNextOrder(plan.id) — the single write
 *   8. narrow success DTO
 *
 * The consequences are the point:
 *  - NOTHING is validated for a course the actor may not access, so validation
 *    diagnostics can never be used as an oracle over another course;
 *  - NO plan lookup happens before authorization, so the existence of a plan
 *    cannot be probed by an unauthorized caller;
 *  - NO write dependency runs when validation fails, so a rejected submission
 *    cannot leave a partial row or consume an order position;
 *  - the lifecycle gate runs BEFORE the plan lookup, so an ARCHIVED offering is
 *    refused without any exam query at all.
 *
 * ===========================================================================
 * ONLY THREE KNOWN FAILURES ARE CLASSIFIED — EVERYTHING ELSE PROPAGATES
 * ===========================================================================
 * Exactly three injected predicates may convert a thrown error into a refusal:
 * the course not-found, the lifecycle denial and the definition-name uniqueness
 * conflict. Every other throw — an infrastructure fault, a programming error, a
 * plan-query failure, an unexpected write failure — LEAVES THIS MODULE
 * UNCHANGED.
 *
 * There is no `unexpected` code and no catch-all `catch`. That is deliberate: a
 * generic failure code would let a real defect render as an ordinary,
 * unremarkable form error that nobody investigates.
 *
 * CRITICALLY, `requireAdmin()` denies by REDIRECTING (a Next `NEXT_REDIRECT`
 * throw). Because each classifier is asked about one specific error shape and
 * anything unrecognized is re-thrown, a redirect passes straight through and the
 * framework still performs it. A redirect must never be translated into a
 * refusal — an admin who is simply not logged in would then see "not found"
 * instead of the login page.
 */
import {
  normalizeExamDefinitionCreateInput,
  type ExamDefinitionWriteInputIssue,
  type NormalizedExamDefinitionCreate,
} from "./exam-definition-write-core";

export type {
  ExamDefinitionWriteInputIssue,
  NormalizedExamDefinitionCreate,
} from "./exam-definition-write-core";

// ===========================================================================
// The injected boundary
// ===========================================================================

/**
 * The course context a create may act on, AFTER the boundary verified it.
 *
 * Deliberately TWO fields. It is not the project's `AdminCourseContext` and not
 * a CourseOffering row: a name, a level, an ActivityYear or a date would be data
 * this operation has no business reading, and a Prisma type here would end this
 * module's purity.
 *
 * `courseOfferingId` is the DB-VERIFIED id — the one the boundary confirmed
 * exists — and is the ONLY id that reaches the plan lookup. `status` is a plain
 * `string` rather than the generated enum for the same purity reason; the
 * committed policy the gate consults is default-deny, so an unrecognized status
 * is refused rather than waved through.
 */
export interface VerifiedExamDefinitionCourseContext {
  readonly courseOfferingId: string;
  readonly status: string;
}

/**
 * The plan a definition will hang under: its id and nothing else.
 *
 * No `publishedAt`, no source dates, no sessions, no existing definitions, no
 * offering relation, no timestamps. A create does not need to know whether the
 * plan is published (publication is a separate, later decision) and must not be
 * able to make a decision from data it should not have read.
 */
export interface ResolvedExamPlanForCreate {
  readonly id: string;
}

/**
 * What the write reports back: the new id and the order position the SERVER
 * assigned. Never the row, never the name it stored, never a timestamp.
 */
export interface CreatedExamDefinitionRecord {
  readonly id: string;
  readonly orderIndex: number;
}

/**
 * The complete injected boundary.
 *
 * Note what is ABSENT and therefore unrepresentable: there is no dependency that
 * can create or upsert an ExamPlan, update or delete a definition, reorder
 * definitions, write a session or an assignment, publish anything, send a
 * notification, resolve a capability, or read another course. The operation is
 * structurally incapable of doing anything but appending one definition to one
 * already-existing plan.
 *
 * The three predicates take `unknown` and return a boolean: this module never
 * inspects, unwraps, logs or echoes a raw error, so no database detail and no
 * submitted value can leak into a result through them.
 */
export interface CreateExamDefinitionDeps {
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
  ): Promise<ResolvedExamPlanForCreate | null>;

  /**
   * The SINGLE write: append one definition to the given plan, assigning the
   * next order position itself. The plan id is the SERVER-RESOLVED one.
   */
  createDefinitionAtNextOrder(
    planId: string,
    value: NormalizedExamDefinitionCreate,
  ): Promise<CreatedExamDefinitionRecord>;

  /** Is this throw "the requested offering does not exist"? */
  isCourseNotFoundError(error: unknown): boolean;

  /** Is this throw "the offering's lifecycle forbids this operation"? */
  isOperationNotAllowedError(error: unknown): boolean;

  /** Is this throw the definition-name uniqueness conflict? */
  isDuplicateNameError(error: unknown): boolean;
}

// ===========================================================================
// The result model
// ===========================================================================

/**
 * The failure codes that need no diagnostics: each is fully described by the
 * code itself.
 */
export type CreateExamDefinitionRefusalCode =
  | "offering_not_found"
  | "operation_not_allowed"
  | "plan_not_found"
  | "duplicate_name";

/**
 * A discriminated, JSON-safe, frozen result.
 *
 * THREE arms rather than two, so `issues` EXISTS ONLY on `invalid_input`. A
 * single failure arm with an optional `issues` would be present-but-`undefined`
 * on every other refusal, which breaks the JSON round trip the exam module's
 * results are held to and invites callers to render an empty issue list.
 *
 * Nothing in any arm is a Date, Map, Set, BigInt, Error or class instance, and
 * nothing carries a plan id, a course offering id, an actor id, a timestamp, a
 * raw error, a database detail or the submitted name — a diagnostic must never
 * echo what the client sent back to the client.
 *
 * There is deliberately no `unexpected`, `stale_write`, `definition_not_found`,
 * `definition_in_use` or `reorder_conflict` code: the first would hide defects,
 * and the rest describe operations this slice does not perform.
 */
export type CreateExamDefinitionResult =
  | {
      readonly ok: true;
      readonly definitionId: string;
      readonly orderIndex: number;
    }
  | {
      readonly ok: false;
      readonly code: "invalid_input";
      readonly issues: readonly ExamDefinitionWriteInputIssue[];
    }
  | {
      readonly ok: false;
      readonly code: CreateExamDefinitionRefusalCode;
    };

function refuse(code: CreateExamDefinitionRefusalCode): CreateExamDefinitionResult {
  return Object.freeze({ ok: false as const, code });
}

function refuseInput(
  issues: readonly ExamDefinitionWriteInputIssue[],
): CreateExamDefinitionResult {
  return Object.freeze({
    ok: false as const,
    code: "invalid_input" as const,
    // A fresh frozen copy: the result must not alias an array a caller could
    // later mutate, and the committed core's own issue ORDER is preserved
    // exactly so a form can render diagnostics in a stable sequence.
    issues: Object.freeze([...issues]),
  });
}

function succeed(created: CreatedExamDefinitionRecord): CreateExamDefinitionResult {
  return Object.freeze({
    ok: true as const,
    definitionId: created.id,
    orderIndex: created.orderIndex,
  });
}

// ===========================================================================
// The duplicate-name classifier (pure, Prisma-free)
// ===========================================================================

/**
 * The database index name behind `@@unique([planId, name])` on
 * `exam_definitions`. Named here as a STRING so this module can recognize the
 * conflict without importing Prisma or the generated client.
 */
const EXAM_DEFINITION_NAME_INDEX = "exam_definitions_planId_name_key";

/**
 * Recognize the Prisma unique-constraint violation (P2002) that corresponds to
 * the `ExamDefinition` NAME uniqueness, structurally and WITHOUT importing
 * Prisma. Lives in this pure core — following the project's existing convention
 * for `isDuplicateIdentityNumberError` — precisely so it can be proven at
 * runtime by a DB-free test instead of only inspected as source text.
 *
 * WHY THE FALLBACK IS SAFE. The bound write transaction touches exactly ONE
 * model, `ExamDefinition`, which has two unique keys: `[planId, name]` and
 * `[planId, id]`. The second is keyed on a freshly generated cuid, so it cannot
 * realistically collide; a P2002 raised by that transaction is therefore a name
 * conflict. When Prisma reports readable target metadata this function still
 * VERIFIES it — an array target of `["planId", "id"]` is correctly NOT
 * classified — and only an absent or unreadable target falls back, which is the
 * established convention in `create-trainee-enrollment-core`,
 * `create-trainee-into-offering-core` and `create-course-group`.
 *
 * It is deliberately narrow in the other direction too: a non-object, a
 * different Prisma code, and a framework redirect (which carries a `digest`, not
 * a `code`) are all rejected, so no redirect and no unrelated failure can be
 * laundered into `duplicate_name`. The offending value is never inspected,
 * copied or echoed.
 */
export function isExamDefinitionDuplicateNameError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  if ((error as { code?: unknown }).code !== "P2002") {
    return false;
  }

  const target = (error as { meta?: { target?: unknown } }).meta?.target;

  // Prisma's field-array form, e.g. ["planId", "name"].
  if (Array.isArray(target)) {
    return target.some((entry) => typeof entry === "string" && isNameTarget(entry));
  }

  // Prisma's index-name form, e.g. "exam_definitions_planId_name_key".
  if (typeof target === "string") {
    return isNameTarget(target);
  }

  // Unreadable/absent metadata: attributed to the name conflict for the reason
  // documented above.
  return true;
}

/**
 * Does one target token name the definition's name column, or the index that
 * enforces it? Checked as an exact field name OR the exact index name, so the
 * sibling `[planId, id]` key — whose tokens are `planId` and `id` — never
 * matches.
 */
function isNameTarget(token: string): boolean {
  return token === "name" || token === EXAM_DEFINITION_NAME_INDEX;
}

// ===========================================================================
// The orchestration
// ===========================================================================

/**
 * Create exactly ONE ExamDefinition under the ALREADY-EXISTING plan of one
 * authorized, lifecycle-permitted course offering.
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
export async function createExamDefinitionWithDeps(
  courseOfferingId: string,
  rawInput: unknown,
  deps: CreateExamDefinitionDeps,
): Promise<CreateExamDefinitionResult> {
  // 1. Authorization + exact-offering verification FIRST. Nothing about exams,
  //    plans or the submitted input is touched before this resolves.
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

  // 4. No plan means no create. This slice never creates or upserts one, and no
  //    injected dependency could: plan creation is its own approved slice.
  if (!plan) {
    return refuse("plan_not_found");
  }

  // 5. Only NOW is the submitted input examined, and every rule about it belongs
  //    to the committed normalizer (including the refusal of a stored
  //    BEGINNER_INSTRUCTION, which it delegates to the domain validator).
  const normalized = normalizeExamDefinitionCreateInput(rawInput);

  // 6. Invalid input ends the operation with the committed diagnostics verbatim.
  //    The write dependency is not reached at all.
  if (!normalized.ok) {
    return refuseInput(normalized.issues);
  }

  // 7. The single write, against the SERVER-RESOLVED plan id and the NORMALIZED
  //    payload. The order position is assigned inside the dependency; nothing
  //    here supplies, defaults or forwards one.
  let created: CreatedExamDefinitionRecord;
  try {
    created = await deps.createDefinitionAtNextOrder(plan.id, normalized.value);
  } catch (error) {
    if (deps.isDuplicateNameError(error)) {
      return refuse("duplicate_name");
    }
    throw error;
  }

  // 8. The narrow success DTO: the new id and the assigned position, nothing
  //    else.
  return succeed(created);
}
