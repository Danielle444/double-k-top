/**
 * EXAM EX-S5B-3 — the PURE orchestration of ONE ExamDefinition REMOVAL.
 *
 * PURE by construction: no Prisma, no DB, no transaction, no clock, no
 * randomness, no env, no auth/session/cookie, no filesystem, no network, no
 * Next, no `server-only`, no `"use server"`. Every effect this operation needs
 * arrives through the injected `DeleteExamDefinitionDeps`.
 *
 * WHAT THIS ANSWERS (and only this):
 *  - in which EXACT order must a definition removal authorize, gate, resolve,
 *    locate, check usage and delete?
 *  - and which stable, non-echoing outcome describes each way it can fail?
 *
 * ===========================================================================
 * HARD DELETE ONLY, AND ONLY WHEN UNUSED
 * ===========================================================================
 * There is NO archive field on `ExamDefinition` and none is introduced: this
 * slice changes no schema. Removal is therefore a real delete, and it is
 * permitted ONLY for a definition that no `ExamSession` refers to.
 *
 * That restriction is protected TWICE, on purpose:
 *
 *  1. A PRE-CHECK counts the sessions of that plan+definition. A non-zero count
 *     refuses with `definition_in_use` and performs NO delete at all. This is
 *     what produces a sentence a manager can act on ("this exam already has
 *     sessions") instead of a database error;
 *
 *  2. A RACE GUARD classifies the foreign-key restriction the database raises if
 *     a session is created in the window between the count and the delete. The
 *     pre-check is a diagnostic, NOT the protection; the database constraint is
 *     the protection, and this module's job is to translate its refusal into the
 *     same stable code rather than to let it surface raw.
 *
 * Neither guard can be defeated by the caller: a session count is not a
 * parameter, and no dependency here can create, move or delete a session.
 *
 * ===========================================================================
 * THE CALLER SUPPLIES A REQUEST, NEVER A GRANT
 * ===========================================================================
 * The only three arguments are a REQUESTED `courseOfferingId`, a `definitionId`
 * and an optimistic-concurrency token. There is no parameter for a `planId`, a
 * `kind`, an `orderIndex`, an actor id, a session count, a publication option or
 * a transaction handle.
 *
 * `planId` is derived SERVER-SIDE from the DB-verified offering id, and the
 * definition is located, counted and deleted UNDER that plan. A definition id
 * belonging to a different plan is INDISTINGUISHABLE from one that does not
 * exist: both are `definition_not_found`.
 *
 * ===========================================================================
 * THE LOCKED ORDER
 * ===========================================================================
 *   1. requireCourseContext(requested id)     — admin + exact-offering boundary
 *   2. assertConfigurationAllowed(status)     — course-lifecycle gate
 *   3. findExamPlanByCourseOfferingId(id)     — VERIFIED id only
 *   4. no plan                                -> plan_not_found
 *   5. findDefinitionForDelete(plan.id, id)   — SERVER plan id only
 *   6. missing / foreign plan                 -> definition_not_found
 *   7. the concurrency token                  -> invalid_input when unusable
 *   8. countSessionsForDefinition(plan.id, id)
 *   9. count > 0                              -> definition_in_use, NO delete
 *  10. deleteDefinitionIfCurrent(plan.id, id, token)
 *  11. nothing matched                        -> stale_write
 *  12. narrow success DTO
 *
 * ===========================================================================
 * DELETING FROM A PUBLISHED PLAN IS ALLOWED
 * ===========================================================================
 * This module never reads a plan's publication state, so a published plan cannot
 * block the removal of an UNUSED definition — and an unused definition is, by
 * definition, one no published session refers to. No `publishedAt` is touched
 * and no notification is sent, because no dependency exists that could do
 * either.
 *
 * ===========================================================================
 * ONLY FOUR KNOWN FAILURES ARE CLASSIFIED — EVERYTHING ELSE PROPAGATES
 * ===========================================================================
 * Three injected predicates may convert a THROW into a refusal (the course
 * not-found, the lifecycle denial and the session foreign-key restriction), and
 * one dependency reports a non-throwing refusal by returning `false`. Every
 * other throw leaves this module unchanged, and a `NEXT_REDIRECT` from the
 * authorization boundary reaches the framework untouched.
 */
import { isExamDefinitionVersionToken } from "./update-exam-definition-core";

// ===========================================================================
// The injected boundary
// ===========================================================================

/**
 * The course context a removal may act on, AFTER the boundary verified it.
 * Deliberately two fields, for the reasons the sibling edit core documents.
 */
export interface VerifiedExamDefinitionCourseContext {
  readonly courseOfferingId: string;
  readonly status: string;
}

/** The plan the definition must live under: its id and nothing else. */
export interface ResolvedExamPlanForDelete {
  readonly id: string;
}

/**
 * The stored definition, read back under the server-resolved plan.
 *
 * TWO fields only. A removal does not need the name, the kind, the duration, the
 * capacity, the flags or the order position — and reading them would put data in
 * a place that has no use for it. `updatedAt` is carried because a caller may
 * want to know the row it matched; it is deliberately NOT compared here, because
 * the conditional delete compares it atomically.
 */
export interface ExistingExamDefinitionForDelete {
  readonly id: string;
  /** Epoch milliseconds. */
  readonly updatedAt: number;
}

/**
 * The complete injected boundary.
 *
 * Note what is ABSENT and therefore unrepresentable: there is no dependency that
 * can create or upsert a plan, create or edit a definition, reorder definitions,
 * write or delete a session or an assignment, publish anything, send a
 * notification, resolve a capability, or read another course.
 *
 * The three predicates take `unknown` and return a boolean: this module never
 * inspects, unwraps, logs or echoes a raw error.
 */
export interface DeleteExamDefinitionDeps {
  /**
   * Authorize the actor and verify the REQUESTED offering exists. May throw the
   * project's typed not-found, and may REDIRECT for an unauthenticated or
   * non-admin caller.
   */
  requireCourseContext(
    requestedCourseOfferingId: string,
  ): Promise<VerifiedExamDefinitionCourseContext>;

  /** Gate the mutation on the VERIFIED offering status. Throws to deny. */
  assertConfigurationAllowed(status: string): void;

  /** Find the plan of the VERIFIED offering. `null` means "no plan exists". */
  findExamPlanByCourseOfferingId(
    verifiedCourseOfferingId: string,
  ): Promise<ResolvedExamPlanForDelete | null>;

  /**
   * Read the definition UNDER the given plan. `null` deliberately covers both
   * "does not exist" and "belongs to another plan".
   */
  findDefinitionForDelete(
    planId: string,
    definitionId: string,
  ): Promise<ExistingExamDefinitionForDelete | null>;

  /**
   * How many sessions of THIS plan refer to THIS definition. Scoped by both, so
   * a cross-plan row can neither be counted nor missed.
   */
  countSessionsForDefinition(planId: string, definitionId: string): Promise<number>;

  /**
   * The SINGLE write: remove that definition ONLY IF its stored version still
   * equals `expectedUpdatedAt`. `false` means nothing matched — the row moved
   * under us, or was already removed — and is the ONLY way a stale write is
   * reported.
   */
  deleteDefinitionIfCurrent(
    planId: string,
    definitionId: string,
    expectedUpdatedAt: number,
  ): Promise<boolean>;

  /** Is this throw "the requested offering does not exist"? */
  isCourseNotFoundError(error: unknown): boolean;

  /** Is this throw "the offering's lifecycle forbids this operation"? */
  isOperationNotAllowedError(error: unknown): boolean;

  /** Is this throw the session foreign-key restriction on this definition? */
  isDefinitionInUseForeignKeyError(error: unknown): boolean;
}

// ===========================================================================
// The result model
// ===========================================================================

/**
 * Every way a removal can be refused. Each is fully described by the code
 * itself, so no arm carries diagnostics: unlike an edit, a removal submits no
 * fields, so there is nothing a per-field issue list could describe.
 *
 * There is deliberately no `unexpected`, `archived`, `duplicate_name`,
 * `reorder_conflict` or `plan_published` code.
 */
export type DeleteExamDefinitionRefusalCode =
  | "offering_not_found"
  | "operation_not_allowed"
  | "plan_not_found"
  | "definition_not_found"
  | "invalid_input"
  | "definition_in_use"
  | "stale_write";

/**
 * A discriminated, JSON-safe, frozen result.
 *
 * Nothing in either arm is a Date, Map, Set, BigInt, Error or class instance,
 * and nothing carries a plan id, a course offering id, an actor id, a session
 * count, a raw error, a database detail or the removed name. In particular the
 * SUCCESS arm reports only the id the caller already had — there is no archive
 * state, because there is no archive.
 */
export type DeleteExamDefinitionResult =
  | {
      readonly ok: true;
      readonly definitionId: string;
    }
  | {
      readonly ok: false;
      readonly code: DeleteExamDefinitionRefusalCode;
    };

function refuse(code: DeleteExamDefinitionRefusalCode): DeleteExamDefinitionResult {
  return Object.freeze({ ok: false as const, code });
}

function succeed(definitionId: string): DeleteExamDefinitionResult {
  return Object.freeze({ ok: true as const, definitionId });
}

// ===========================================================================
// The session foreign-key classifier (pure, Prisma-free)
// ===========================================================================

/**
 * The database constraint behind `ExamSession(planId, definitionId) ->
 * ExamDefinition(planId, id)`, declared `ON DELETE RESTRICT`. Named here as a
 * STRING so this module can recognize the restriction without importing Prisma
 * or the generated client.
 */
const EXAM_SESSION_DEFINITION_CONSTRAINT = "exam_sessions_planId_definitionId_fkey";

/** The referencing column, as it appears in a field-shaped constraint report. */
const EXAM_SESSION_DEFINITION_FIELD = "definitionId";

/**
 * Recognize the foreign-key restriction (P2003) raised when a definition is
 * deleted while a session still refers to it — structurally, and WITHOUT
 * importing Prisma. Lives in this pure core, following the project's existing
 * convention for the duplicate-name classifier, precisely so it can be proven at
 * runtime by a DB-free test instead of only inspected as source text.
 *
 * IT IS NOT A BARE P2003 CHECK. When the driver reports readable constraint
 * metadata this function VERIFIES it names the session reference, so an
 * unrelated foreign-key failure — for instance the definition's own
 * `planId -> exam_plans` key — is correctly NOT classified and propagates.
 *
 * Several metadata shapes are read, because the shape depends on the driver:
 *   - `meta.field_name`                      — the query engine's legacy string;
 *   - `meta.constraint`                      — a string, `{ index }`, or
 *                                              `{ fields }`;
 *   - `meta.driverAdapterError.cause.constraint` — the same, one level in, which
 *     is where the pg driver adapter this project uses places it.
 *
 * WHY THE FALLBACK IS SAFE. When no constraint metadata is readable at all (for
 * instance `{ foreignKey: true }`, which carries no name), the error is
 * attributed to the session restriction. The bound write is a single
 * `deleteMany` against `exam_definitions`, and `exam_sessions` holds the ONLY
 * foreign key in the database that references that table — a DELETE cannot
 * violate the definition's own outbound key. So a P2003 raised by that statement
 * IS the session restriction. This mirrors the established fallback convention
 * of the committed duplicate-name classifiers.
 *
 * It is deliberately narrow in the other direction too: a non-object, a
 * different Prisma code — `P2025` in particular, which means "record not found"
 * and must NEVER read as "in use" — and a framework redirect (which carries a
 * `digest`, not a `code`) are all rejected. The offending value is never
 * inspected beyond these fields, copied or echoed.
 */
export function isExamDefinitionInUseError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  if ((error as { code?: unknown }).code !== "P2003") {
    return false;
  }

  const tokens = readConstraintTokens(error);

  // Unreadable/absent metadata: attributed to the session restriction for the
  // reason documented above.
  if (tokens === null) {
    return true;
  }

  return tokens.some(namesTheSessionReference);
}

/**
 * Extract whatever names the violated constraint, from whichever shape the
 * driver produced. `null` means "nothing readable was reported" — which is a
 * different answer from "something was reported and it was not ours".
 */
function readConstraintTokens(error: unknown): string[] | null {
  const meta = (error as { meta?: unknown }).meta;
  if (typeof meta !== "object" || meta === null) {
    return null;
  }

  const fieldName = (meta as { field_name?: unknown }).field_name;
  if (typeof fieldName === "string") {
    return [fieldName];
  }

  const direct = tokensOfConstraint((meta as { constraint?: unknown }).constraint);
  if (direct !== null) {
    return direct;
  }

  const adapterError = (meta as { driverAdapterError?: unknown }).driverAdapterError;
  if (typeof adapterError === "object" && adapterError !== null) {
    const cause = (adapterError as { cause?: unknown }).cause;
    if (typeof cause === "object" && cause !== null) {
      return tokensOfConstraint((cause as { constraint?: unknown }).constraint);
    }
  }

  return null;
}

/** The three readable constraint shapes; anything else reports `null`. */
function tokensOfConstraint(constraint: unknown): string[] | null {
  if (typeof constraint === "string") {
    return [constraint];
  }
  if (typeof constraint !== "object" || constraint === null) {
    return null;
  }

  const index = (constraint as { index?: unknown }).index;
  if (typeof index === "string") {
    return [index];
  }

  const fields = (constraint as { fields?: unknown }).fields;
  if (Array.isArray(fields)) {
    return fields.filter((entry): entry is string => typeof entry === "string");
  }

  // `{ foreignKey: true }` and friends name nothing.
  return null;
}

/**
 * Does one token name the session -> definition reference?
 *
 * The constraint name is matched by CONTAINMENT because the query engine's
 * legacy form decorates it (`"..._fkey (index)"`), while the column name is
 * matched EXACTLY so the definition's own `planId` key — whose only field token
 * is `planId` — never matches.
 */
function namesTheSessionReference(token: string): boolean {
  return (
    token.includes(EXAM_SESSION_DEFINITION_CONSTRAINT) ||
    token === EXAM_SESSION_DEFINITION_FIELD
  );
}

// ===========================================================================
// The orchestration
// ===========================================================================

/**
 * Remove exactly ONE unused ExamDefinition from the plan of one authorized,
 * lifecycle-permitted course offering.
 *
 * The order is the safety contract, and it is enforced by construction. Each
 * `try` wraps EXACTLY ONE dependency call and asks EXACTLY ONE classifier;
 * nothing is caught broadly, and an unrecognized error is re-thrown with its
 * identity intact — including a `NEXT_REDIRECT`.
 */
export async function deleteExamDefinitionWithDeps(
  courseOfferingId: string,
  definitionId: string,
  expectedUpdatedAt: number,
  deps: DeleteExamDefinitionDeps,
): Promise<DeleteExamDefinitionResult> {
  // 1. Authorization + exact-offering verification FIRST.
  let context: VerifiedExamDefinitionCourseContext;
  try {
    context = await deps.requireCourseContext(courseOfferingId);
  } catch (error) {
    if (deps.isCourseNotFoundError(error)) {
      return refuse("offering_not_found");
    }
    throw error;
  }

  // 2. The course-lifecycle gate, on the VERIFIED status. An ARCHIVED offering
  //    is refused without a single exam query.
  try {
    deps.assertConfigurationAllowed(context.status);
  } catch (error) {
    if (deps.isOperationNotAllowedError(error)) {
      return refuse("operation_not_allowed");
    }
    throw error;
  }

  // 3. The plan of the VERIFIED offering. The requested, unverified offering id
  //    is never read again from here on.
  const plan = await deps.findExamPlanByCourseOfferingId(context.courseOfferingId);

  // 4. No plan means no definition to remove.
  if (!plan) {
    return refuse("plan_not_found");
  }

  // 5. The definition, located UNDER the server-resolved plan.
  const existing = await deps.findDefinitionForDelete(plan.id, definitionId);

  // 6. Missing, or belonging to another plan — one indistinguishable outcome.
  if (!existing) {
    return refuse("definition_not_found");
  }

  // 7. The concurrency token must be well-formed before it is compared against
  //    anything, and before the usage question is even asked.
  if (!isExamDefinitionVersionToken(expectedUpdatedAt)) {
    return refuse("invalid_input");
  }

  // 8. Is anything still using it? Scoped by BOTH the server plan id and the
  //    definition id.
  const sessionCount = await deps.countSessionsForDefinition(plan.id, definitionId);

  // 9. In use: refuse with a sentence a manager can act on, and perform NO
  //    delete. The COUNT ITSELF never leaves this module — how many sessions
  //    exist is not the refusal's business.
  if (sessionCount > 0) {
    return refuse("definition_in_use");
  }

  // 10. The single write. The version check is the WRITE's decision, made
  //     atomically — never a decision made here from the row read in step 5.
  let deleted: boolean;
  try {
    deleted = await deps.deleteDefinitionIfCurrent(
      plan.id,
      definitionId,
      expectedUpdatedAt,
    );
  } catch (error) {
    // The RACE: a session was created between the count and the delete, and the
    // database refused. The same stable code as the pre-check, so the two paths
    // are indistinguishable to the caller — which is correct, because they mean
    // the same thing.
    if (deps.isDefinitionInUseForeignKeyError(error)) {
      return refuse("definition_in_use");
    }
    throw error;
  }

  // 11. Nothing matched: another manager changed or removed the row first.
  if (!deleted) {
    return refuse("stale_write");
  }

  // 12. The narrow success DTO: the id the caller already had, nothing else.
  return succeed(existing.id);
}
