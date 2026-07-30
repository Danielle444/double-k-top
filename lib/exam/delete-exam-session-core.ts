/**
 * EXAM EX-SES-S3 — the PURE orchestration of ONE stored ExamSession REMOVAL.
 *
 * PURE by construction: no Prisma, no DB, no transaction, no clock, no
 * randomness, no env, no auth/session/cookie, no capability, no filesystem, no
 * network, no Next, no `server-only`, no `"use server"`. Every effect this
 * operation needs arrives through the injected `DeleteExamSessionDeps`.
 *
 * WHAT THIS ANSWERS (and only this):
 *  - in which EXACT order must a stored-session removal authorize, gate,
 *    resolve, locate, check usage and delete?
 *  - and which stable, non-echoing outcome describes each way it can fail?
 *
 * ===========================================================================
 * HARD DELETE ONLY, AND ONLY WHEN NOBODY IS ASSIGNED
 * ===========================================================================
 * There is NO archive field on `ExamSession` and none is introduced: this slice
 * changes no schema. Removal is therefore a real delete, and it is permitted
 * ONLY for a session that has ZERO assignments.
 *
 * THE COUNT IS A DIAGNOSTIC; THE DELETE STATEMENT IS THE PROTECTION. This is the
 * important difference from the committed DEFINITION removal, which leans on an
 * `ON DELETE RESTRICT` foreign key to refuse the race. Here there is no such
 * constraint: `ExamAssignment.session` is declared `ON DELETE CASCADE`, so a
 * database left to itself would happily delete a session together with every
 * assignment on it.
 *
 * So the guarantee is not asked of the count. `deleteSessionIfCurrent` is
 * contractually required to make "this session still has no assignments" a
 * CONDITION OF THE DELETE STATEMENT, evaluated atomically with the version check
 * — so an assignment that appears between the count and the delete makes the
 * statement match NOTHING, and the destructive write simply does not happen.
 *
 * The consequences are stated rather than implied:
 *  - a session with assignments is refused EARLY with `session_has_assignments`,
 *    with no delete attempted at all — that is what the count buys: a sentence a
 *    manager can act on;
 *  - an assignment appearing after that count no longer decides anything: the
 *    guarded statement removes nothing, and the operation FAILS CLOSED;
 *  - a zero delete count is therefore ambiguous — the row moved, the row was
 *    already removed, or someone was assigned — and is resolved by narrow
 *    authoritative RE-READS, never by retrying the delete. `deleteSessionIfCurrent`
 *    is invoked exactly once in this module, on every path;
 *  - there is deliberately NO foreign-key classifier. A `P2003` classifier would
 *    be dead code — no inbound reference to `ExamSession` from an assignment,
 *    break or supervisor is declared `Restrict`, so that error cannot be raised
 *    by this delete — and dead error handling is worse than none: a future edit
 *    could start relying on a branch nobody has ever executed.
 *
 * WHAT REMAINS OPEN, STATED HONESTLY. The condition and the delete are now one
 * statement, so no APPLICATION-level window remains. What no lock-free approach
 * can close is the database's own: under READ COMMITTED the statement's
 * assignment sub-condition is evaluated against a snapshot, so an assignment
 * INSERT that commits concurrently with this very statement may not be visible
 * to it. Narrowing that further would need row locking, SERIALIZABLE isolation
 * or a database-level rule — each a separate approved change, and none of them
 * is performed or claimed here.
 *
 * Neither guard is something a caller can defeat: an assignment count is not a
 * parameter, and no dependency here can create, move or delete an assignment.
 *
 * ===========================================================================
 * BREAKS AND SUPERVISORS ARE NOT BLOCKERS, AND ARE NOT DELETED BY THIS MODULE
 * ===========================================================================
 * `ExamSessionBreak`, `ExamSessionSupervisor` and `ExamBeginnerChild` all
 * reference the session with `ON DELETE CASCADE`, and they are intentionally NOT
 * counted, NOT refused and NOT deleted here.
 *
 * They are not blockers because they are session CONFIGURATION, not people's
 * commitments: a break is a gap in a schedule and a supervisor row is a staffing
 * note, and neither is data a manager would be surprised to lose along with the
 * session they explicitly asked to remove. An assignment, by contrast, is a
 * trainee's place in an exam.
 *
 * They are not deleted BY THIS MODULE because the database already removes them
 * atomically with the row. There is no dependency here that could delete a
 * break, a supervisor or a beginner child, so this operation cannot issue a
 * cascade of its own, cannot half-perform one, and cannot leave orphans behind.
 *
 * ===========================================================================
 * THE CALLER SUPPLIES A REQUEST, NEVER A GRANT
 * ===========================================================================
 * The only three arguments are a REQUESTED `courseOfferingId`, a `sessionId` and
 * an optimistic-concurrency token. There is no parameter for a `planId`, an
 * `orderIndex`, an actor id, an assignment count, a publication option or a
 * transaction handle.
 *
 * `planId` is derived SERVER-SIDE from the DB-verified offering id, and the
 * session is located, counted and deleted UNDER that plan. A session id
 * belonging to a different plan is INDISTINGUISHABLE from one that does not
 * exist: both are `session_not_found`, and neither reveals that some other
 * course holds it.
 *
 * ===========================================================================
 * THE LOCKED ORDER
 * ===========================================================================
 *   1. requireCourseContext(requested id)     — admin + exact-offering boundary
 *   2. assertConfigurationAllowed(status)     — course-lifecycle gate
 *   3. findExamPlanByCourseOfferingId(id)     — VERIFIED id only
 *   4. no plan                                -> plan_not_found
 *   5. findSessionForDelete(plan.id, id)      — SERVER plan id only
 *   6. missing / foreign plan                 -> session_not_found
 *   7. the concurrency token                  -> invalid_input when unusable
 *   8. countAssignmentsForSession(row id)     — the early diagnostic
 *   9. count > 0                              -> session_has_assignments,
 *                                                and ZERO delete calls
 *  10. deleteSessionIfCurrent(plan.id, row id, token)
 *      — the version AND the no-assignments condition, atomically, in ONE
 *        statement
 *  11. nothing matched                        -> re-read, then classify as
 *                                                session_has_assignments or
 *                                                stale_write; never retry
 *  12. narrow success DTO
 *
 * ===========================================================================
 * DELETING FROM A PUBLISHED PLAN IS ALLOWED
 * ===========================================================================
 * This module never reads a plan's publication state — the resolved plan carries
 * an id and nothing else — so a published plan cannot block, alter or branch the
 * removal. No `publishedAt` and no per-session `individualPublishedAt` is read
 * or written, and no notification is sent, because no dependency exists that
 * could do any of those. Warning a manager that trainees can already see the
 * session they are removing is a UI concern for a later, separately reviewed
 * slice.
 *
 * ===========================================================================
 * ONLY TWO KNOWN FAILURES ARE CLASSIFIED — EVERYTHING ELSE PROPAGATES
 * ===========================================================================
 * Exactly two injected predicates may convert a THROW into a refusal (the course
 * not-found and the lifecycle denial), and one dependency reports a non-throwing
 * refusal by returning `false`. Every other throw leaves this module unchanged.
 *
 * In particular there is NO `P2025` classifier. "Record not found" is not an
 * error this operation can receive — the bound write is a conditional
 * `deleteMany`, which reports a count of zero rather than throwing — and a
 * classifier for it would silently convert a real defect into an ordinary
 * refusal. The stale-write answer comes from that count, and from nothing else.
 *
 * There is no `unexpected` code and no catch-all `catch`, and a `NEXT_REDIRECT`
 * from the authorization boundary reaches the framework untouched.
 */
import { isExamSessionVersionToken } from "./update-exam-session-core";

// ===========================================================================
// The injected boundary
// ===========================================================================

/**
 * The course context a removal may act on, AFTER the boundary verified it.
 * Deliberately two fields, for the reasons the sibling edit core documents.
 */
export interface VerifiedExamSessionCourseContext {
  readonly courseOfferingId: string;
  readonly status: string;
}

/** The plan the session must live under: its id and nothing else. */
export interface ResolvedExamPlanForSessionDelete {
  readonly id: string;
}

/**
 * The stored session, read back under the server-resolved plan.
 *
 * TWO fields only. A removal does not need the definition, the date, the start
 * time, the arena, the title, the notes or the order position — and reading them
 * would put data in a place that has no use for it. `id` is the server-verified
 * target of everything that follows; `updatedAt` is carried because a caller may
 * want to know the row it matched, and is deliberately NOT compared here,
 * because the conditional delete compares it atomically.
 */
export interface ExistingExamSessionForDelete {
  readonly id: string;
  /** Epoch milliseconds. */
  readonly updatedAt: number;
}

/**
 * The complete injected boundary.
 *
 * Note what is ABSENT and therefore unrepresentable: there is no dependency that
 * can create or upsert a plan, create, edit or reorder a definition or a
 * session, write or DELETE an assignment, a break, a supervisor or a beginner
 * child, publish anything, send a notification, resolve a capability, or read
 * another course. The assignment dependency is a COUNT and cannot mutate
 * anything, so this operation is structurally incapable of performing a cascade
 * of its own.
 *
 * The two predicates take `unknown` and return a boolean: this module never
 * inspects, unwraps, logs or echoes a raw error.
 */
export interface DeleteExamSessionDeps {
  /**
   * Authorize the actor and verify the REQUESTED offering exists. May throw the
   * project's typed not-found, and may REDIRECT for an unauthenticated or
   * non-admin caller.
   */
  requireCourseContext(
    requestedCourseOfferingId: string,
  ): Promise<VerifiedExamSessionCourseContext>;

  /** Gate the mutation on the VERIFIED offering status. Throws to deny. */
  assertConfigurationAllowed(status: string): void;

  /** Find the plan of the VERIFIED offering. `null` means "no plan exists". */
  findExamPlanByCourseOfferingId(
    verifiedCourseOfferingId: string,
  ): Promise<ResolvedExamPlanForSessionDelete | null>;

  /**
   * Read the session UNDER the given plan. `null` deliberately covers both
   * "does not exist" and "belongs to another plan".
   */
  findSessionForDelete(
    planId: string,
    sessionId: string,
  ): Promise<ExistingExamSessionForDelete | null>;

  /**
   * How many assignments belong to THIS session. The id is the STORED row's, so
   * the count can neither miss a row nor include another session's.
   *
   * Called twice at most: once as the early diagnostic, and — if the guarded
   * delete then matches nothing — once more to classify why. Never as a decision
   * this module makes INSTEAD of the delete's own atomic condition.
   */
  countAssignmentsForSession(sessionId: string): Promise<number>;

  /**
   * The SINGLE write: remove that session ONLY IF its stored version still
   * equals `expectedUpdatedAt` AND it still has NO ASSIGNMENTS at delete time.
   *
   * Both conditions are contractually the STATEMENT's, not the caller's: an
   * implementation that checked the assignment state separately and then deleted
   * would reintroduce exactly the check-then-act race this signature exists to
   * remove. There is no flag — an unassigned session is the only kind this
   * operation may ever remove, so the condition is unconditional.
   *
   * `false` means nothing matched: the row moved, the row was already removed,
   * or an assignment appeared. Which of those it was is not this dependency's to
   * say — the caller re-reads to find out, and never retries.
   */
  deleteSessionIfCurrent(
    planId: string,
    sessionId: string,
    expectedUpdatedAt: number,
  ): Promise<boolean>;

  /** Is this throw "the requested offering does not exist"? */
  isCourseNotFoundError(error: unknown): boolean;

  /** Is this throw "the offering's lifecycle forbids this operation"? */
  isOperationNotAllowedError(error: unknown): boolean;
}

// ===========================================================================
// The result model
// ===========================================================================

/**
 * Every way a removal can be refused. Each is fully described by the code
 * itself, so no arm carries diagnostics: unlike an edit, a removal submits no
 * fields, so there is nothing a per-field issue list could describe.
 *
 * There is deliberately no `unexpected`, `archived`, `definition_not_found`,
 * `conflict` or `plan_published` code.
 */
export type DeleteExamSessionRefusalCode =
  | "invalid_input"
  | "offering_not_found"
  | "operation_not_allowed"
  | "plan_not_found"
  | "session_not_found"
  | "session_has_assignments"
  | "stale_write";

/**
 * A discriminated, JSON-safe, frozen result.
 *
 * Nothing in either arm is a calendar value, Map, Set, BigInt, Error or class
 * instance, and nothing carries a plan id, a course offering id, a definition
 * id, an assignment count, an actor id, a raw error, a database detail or any
 * stored value. In particular the SUCCESS arm reports only the id the caller
 * already had — there is no archive state, because there is no archive.
 */
export type DeleteExamSessionResult =
  | {
      readonly ok: true;
      readonly sessionId: string;
    }
  | {
      readonly ok: false;
      readonly code: DeleteExamSessionRefusalCode;
    };

function refuse(code: DeleteExamSessionRefusalCode): DeleteExamSessionResult {
  return Object.freeze({ ok: false as const, code });
}

function succeed(sessionId: string): DeleteExamSessionResult {
  return Object.freeze({ ok: true as const, sessionId });
}

// ===========================================================================
// The orchestration
// ===========================================================================

/**
 * Remove exactly ONE unassigned stored ExamSession from the plan of one
 * authorized, lifecycle-permitted course offering.
 *
 * The order is the safety contract, and it is enforced by construction. Each
 * `try` wraps EXACTLY ONE dependency call and asks EXACTLY ONE classifier;
 * nothing is caught broadly, and an unrecognized error is re-thrown with its
 * identity intact — including a `NEXT_REDIRECT`.
 */
export async function deleteExamSessionWithDeps(
  courseOfferingId: string,
  sessionId: string,
  expectedUpdatedAt: number,
  deps: DeleteExamSessionDeps,
): Promise<DeleteExamSessionResult> {
  // 1. Authorization + exact-offering verification FIRST.
  let context: VerifiedExamSessionCourseContext;
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

  // 4. No plan means no session to remove.
  if (!plan) {
    return refuse("plan_not_found");
  }

  // 5. The session, located UNDER the server-resolved plan.
  const existing = await deps.findSessionForDelete(plan.id, sessionId);

  // 6. Missing, or belonging to another plan — one indistinguishable outcome.
  if (!existing) {
    return refuse("session_not_found");
  }

  // 7. The concurrency token must be well-formed before it is compared against
  //    anything, and before the usage question is even asked.
  if (!isExamSessionVersionToken(expectedUpdatedAt)) {
    return refuse("invalid_input");
  }

  // 8. Is anyone assigned to it? Scoped to the STORED row's id. This is the
  //    EARLY DIAGNOSTIC, not the protection.
  const assignmentCount = await deps.countAssignmentsForSession(existing.id);

  // 9. Assigned: refuse with a sentence a manager can act on, and perform NO
  //    delete. The COUNT ITSELF never leaves this module — how many trainees are
  //    assigned is not the refusal's business. Breaks and supervisors are not
  //    consulted at all: they are configuration, not commitments.
  if (assignmentCount > 0) {
    return refuse("session_has_assignments");
  }

  // 10. The single write. BOTH the version check and the no-assignments
  //     condition are the STATEMENT's decisions, made atomically — never
  //     decisions made here from the reads above, which could already be out of
  //     date. Whatever breaks, supervisors and beginner children hang off the
  //     row are removed by the database's own cascade, not by this module.
  const deleted = await deps.deleteSessionIfCurrent(
    plan.id,
    existing.id,
    expectedUpdatedAt,
  );

  // 11. Nothing matched, and the reason is genuinely ambiguous: resolve it by
  //     re-reading, never by trying the delete again.
  if (!deleted) {
    return classifyFailedDelete(plan.id, existing.id, expectedUpdatedAt, deps);
  }

  // 12. The narrow success DTO: the id the caller already had, nothing else.
  return succeed(existing.id);
}

// ===========================================================================
// Classifying a guarded delete that matched nothing
// ===========================================================================

/**
 * Why did the atomically-guarded delete remove no row?
 *
 * Reached ONLY after `deleteSessionIfCurrent` returned `false`. Nothing has been
 * removed at this point, and nothing will be: this function performs READS ONLY
 * and never re-attempts the delete. That is the whole point — a retry would hand
 * the destructive write a second chance, which is exactly what the atomic
 * condition exists to deny.
 *
 * The re-reads are narrow and ordered so that each one can actually decide
 * something, rather than being asked and then ignored:
 *
 *  - the session is GONE           -> `stale_write`. It is already removed;
 *    counting its assignments could only return zero and could not change this;
 *  - its VERSION no longer matches -> `stale_write`. Another manager committed
 *    first; that alone explains the zero match, whatever the assignment state
 *    now is;
 *  - assignments now EXIST         -> `session_has_assignments`. The row is still
 *    the one the caller was looking at, so the only remaining explanation is the
 *    condition this operation added, and it is the SAME code the early
 *    diagnostic would have produced — the two paths are indistinguishable to the
 *    caller, which is correct, because they mean the same thing;
 *  - anything else                 -> `stale_write`, the FAIL-CLOSED default.
 *
 * CONSERVATIVE UNDER FURTHER CONCURRENCY, DELIBERATELY. These reads are not in a
 * transaction with the failed delete, so a world that keeps changing underneath
 * them can produce a `stale_write` where `session_has_assignments` would have
 * been more informative, or the reverse. Both are refusals, neither removes
 * anything, and the classification only ever chooses which sentence a manager
 * reads — so being approximate here costs a word, never a row.
 */
async function classifyFailedDelete(
  planId: string,
  sessionId: string,
  expectedUpdatedAt: number,
  deps: DeleteExamSessionDeps,
): Promise<DeleteExamSessionResult> {
  const current = await deps.findSessionForDelete(planId, sessionId);
  if (!current || current.updatedAt !== expectedUpdatedAt) {
    return refuse("stale_write");
  }

  const assignmentCount = await deps.countAssignmentsForSession(sessionId);
  if (assignmentCount > 0) {
    return refuse("session_has_assignments");
  }

  return refuse("stale_write");
}
