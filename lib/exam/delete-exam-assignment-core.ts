/**
 * EXAM EX-ASG-C1 — the PURE orchestration of ONE stored ExamAssignment REMOVAL.
 *
 * PURE by construction: no Prisma, no DB, no transaction, no clock, no
 * randomness, no env, no auth/session/cookie, no capability, no filesystem, no
 * network, no Next, no `server-only`, no `"use server"`. Every effect this
 * operation needs arrives through the injected `DeleteExamAssignmentDeps`, so the
 * ORDER in which authorization, lifecycle gating, plan resolution, target
 * validation, plan-scoped verification and the removal happen is stated once,
 * here, and is testable without a database.
 *
 * WHAT THIS ANSWERS (and only this):
 *  - in which EXACT order must an assignment removal authorize, gate, resolve,
 *    verify and delete?
 *  - and which stable, non-echoing outcome describes each way it can fail?
 *
 * WHAT THIS DELIBERATELY DOES NOT DO:
 *  - it PERFORMS NO IO and knows nothing of a transaction client, a row or a
 *    query. `deleteAssignmentById` is an opaque promise;
 *  - it OWNS NO POLICY TABLE. Which offering statuses may be configured is the
 *    committed course operation policy's decision, reached through
 *    `assertConfigurationAllowed`;
 *  - it REMOVES NOTHING ELSE. There is no dependency that can delete a session, a
 *    plan, a definition, a break or a supervisor, and none that can delete more
 *    than the one row it verified. A cascade of its own is unrepresentable;
 *  - it REORDERS NOTHING. The surviving assignments keep the order positions they
 *    already have, and no dependency here could renumber them. A gap in the
 *    sequence is not a defect: the reading side orders BY the position and never
 *    assumes the positions are contiguous;
 *  - it CONSULTS NO CAPACITY, no wave layout, no personal slot, no end time and
 *    no timetable, and it sends no notification.
 *
 * ===========================================================================
 * THE CALLER SUPPLIES A REQUEST, NEVER A GRANT
 * ===========================================================================
 * The only two arguments are a REQUESTED `courseOfferingId` and a RAW, untrusted
 * `assignmentId`. There is no parameter through which a caller could supply a
 * `planId`, a `sessionId`, an actor id or a transaction handle.
 *
 * `planId` is derived SERVER-SIDE from the DB-verified offering id that
 * `requireCourseContext` returned. The requested offering id is used for exactly
 * one thing — asking the course boundary to verify it — and is never read again,
 * so a caller cannot steer the plan lookup at one offering while being authorized
 * for another.
 *
 * ===========================================================================
 * THE LOCKED ORDER
 * ===========================================================================
 *   1. requireCourseContext(requested id)          — admin + offering boundary
 *   2. assertConfigurationAllowed(status)           — course-lifecycle gate
 *   3. findExamPlanByCourseOfferingId(verified id)  — VERIFIED id only
 *   4. no plan                                      -> plan_not_found
 *   5. normalize the target id                      -> invalid_input if malformed
 *   6. findAssignmentForPlan(plan.id, id)           — PLAN-SCOPED verification
 *   7. no assignment                                -> assignment_not_found
 *   8. deleteAssignmentById(verified id)            — the single write
 *   9. narrow success
 *
 * A missing assignment and one belonging to ANOTHER course's plan both come back
 * as `null` and both produce `assignment_not_found`, so this path is not an
 * existence oracle over another course's exam data. The scoping is what makes
 * that true, not a comparison this module performs: there is no dependency that
 * can read an assignment WITHOUT a plan id, so a cross-plan removal is
 * unreachable rather than merely rejected.
 *
 * The id handed to the delete is the one the SCOPED READ returned, never the
 * submitted one, so the write cannot target a row the verification did not
 * approve.
 *
 * ===========================================================================
 * WHY THERE IS NO VERSION TOKEN IN THIS SLICE
 * ===========================================================================
 * A removal here takes NO `expectedUpdatedAt`, and that is a decision rather than
 * an omission:
 *
 *  - assignments are IMMUTABLE in this slice. The approved write surface creates
 *    one and removes one; there is no operation that edits a stored assignment's
 *    trainee, horse or position, so there is no in-place change a stale view
 *    could be unaware of;
 *  - a SURVIVING id still identifies THE SAME ROW. The identifier is a stable
 *    primary key, it is never reused, and nothing this slice can do makes an id
 *    point at a different assignment than the one the manager was looking at. A
 *    token would therefore be compared against a value that cannot have changed;
 *  - a MISSING row is already an honest refusal. If another manager removed it
 *    first, the scoped read returns nothing and the answer is
 *    `assignment_not_found` — the correct description of "it is already gone",
 *    and a strictly more useful one than a generic staleness code;
 *  - the destructive scope is ONE row that the caller explicitly named. There is
 *    no field they could be overwriting unseen.
 *
 * WHAT THIS MEANS FOR THE FUTURE, stated plainly so nobody has to rediscover it:
 * the moment an assignment UPDATE flow exists, this reasoning stops holding for
 * that flow, and it will need its own stale-write protection — a version token
 * compared atomically inside the write, exactly as the committed session edit
 * path does. Adding an update later WITHOUT that protection would silently
 * reintroduce the lost-update problem this note exists to flag.
 *
 * ===========================================================================
 * ONLY TWO KNOWN FAILURES ARE CLASSIFIED — EVERYTHING ELSE PROPAGATES
 * ===========================================================================
 * Exactly two injected predicates may convert a thrown error into a refusal: the
 * course not-found and the lifecycle denial. Every other throw — an
 * infrastructure fault, a programming error, a plan-query failure, an
 * assignment-query failure, an unexpected delete failure — LEAVES THIS MODULE
 * UNCHANGED.
 *
 * There is deliberately NO uniqueness classifier (a removal creates nothing) and
 * NO not-found classifier at the delete. If the row disappears between the
 * verification and the write, the database's own complaint propagates as an
 * unexpected error rather than being laundered into `assignment_not_found`: the
 * caller was not wrong about the row, the world changed underneath them, and a
 * "not found" would misdescribe it.
 *
 * There is no `unexpected` code and no catch-all `catch`. That is deliberate: a
 * generic failure code would let a real defect render as an ordinary,
 * unremarkable form error that nobody investigates.
 *
 * CRITICALLY, the real admin boundary denies by REDIRECTING (a framework
 * `NEXT_REDIRECT` throw). Because each classifier is asked about one specific
 * error shape and anything unrecognized is re-thrown, a redirect passes straight
 * through and the framework still performs it.
 */

// ===========================================================================
// The injected boundary
// ===========================================================================

/**
 * The course context a removal may act on, AFTER the boundary verified it.
 *
 * Deliberately TWO fields, for the reasons the sibling create core documents:
 * anything more would be data this operation has no business reading, and a
 * generated database type here would end this module's purity.
 */
export interface VerifiedExamAssignmentCourseContext {
  readonly courseOfferingId: string;
  readonly status: string;
}

/** The plan the assignment must ultimately hang under: its id and nothing else. */
export interface ResolvedExamPlanForAssignmentDelete {
  readonly id: string;
}

/**
 * The stored assignment, read back under the server-resolved plan.
 *
 * ONE field. A removal does not need the trainee, the horse, the role, the order
 * position, the session or any timestamp — and reading them would put personal
 * data in a place that has no use for it. `id` is the server-verified target of
 * the write that follows.
 */
export interface ExistingExamAssignmentForDelete {
  readonly id: string;
}

/**
 * The complete injected boundary.
 *
 * Note what is ABSENT and therefore unrepresentable: there is no dependency that
 * can create or upsert anything, edit anything, reorder anything, delete a
 * session, a plan, a definition, a break or a supervisor, publish anything, send
 * a notification, resolve a capability, or read another course.
 *
 * The two predicates take `unknown` and return a boolean: this module never
 * inspects, unwraps, logs or echoes a raw error, so no database detail and no
 * submitted value can leak into a result through them.
 */
export interface DeleteExamAssignmentDeps {
  /**
   * Authorize the actor and verify the REQUESTED offering exists. May throw the
   * project's typed not-found, and may REDIRECT for an unauthenticated or
   * non-admin caller — the redirect must reach the framework untouched.
   */
  requireCourseContext(
    requestedCourseOfferingId: string,
  ): Promise<VerifiedExamAssignmentCourseContext>;

  /** Gate the mutation on the VERIFIED offering status. Throws to deny. */
  assertConfigurationAllowed(status: string): void;

  /** Find the plan of the VERIFIED offering. `null` means "no plan exists". */
  findExamPlanByCourseOfferingId(
    verifiedCourseOfferingId: string,
  ): Promise<ResolvedExamPlanForAssignmentDelete | null>;

  /**
   * Read the assignment UNDER the given plan. The plan id is the SERVER-RESOLVED
   * one, and there is no variant of this dependency that omits it. `null`
   * deliberately covers both "does not exist" and "belongs to another plan".
   */
  findAssignmentForPlan(
    planId: string,
    assignmentId: string,
  ): Promise<ExistingExamAssignmentForDelete | null>;

  /**
   * The SINGLE write: remove exactly the row whose id the scoped read returned.
   * Removes nothing else, and reports nothing back.
   */
  deleteAssignmentById(assignmentId: string): Promise<void>;

  /** Is this throw "the requested offering does not exist"? */
  isCourseNotFoundError(error: unknown): boolean;

  /** Is this throw "the offering's lifecycle forbids this operation"? */
  isOperationNotAllowedError(error: unknown): boolean;
}

// ===========================================================================
// The result model
// ===========================================================================

/**
 * Every way a removal can be refused. Each is fully described by the code itself,
 * so no arm carries diagnostics: a removal submits no fields, so there is nothing
 * a per-field issue list could describe — a malformed target is a single,
 * self-explanatory `invalid_input`.
 *
 * There is deliberately no `unexpected`, `stale_write`, `archived`,
 * `session_not_found` or `conflict` code: the first would hide defects, the
 * second describes a protection this slice does not need (see the header), and
 * the rest describe lookups this operation does not perform.
 */
export type DeleteExamAssignmentRefusalCode =
  | "invalid_input"
  | "offering_not_found"
  | "operation_not_allowed"
  | "plan_not_found"
  | "assignment_not_found";

/**
 * A discriminated, JSON-safe, frozen result.
 *
 * The SUCCESS arm carries NOTHING but `ok`. There is no id to report: the caller
 * already had the one they submitted, and echoing back a server-verified id would
 * confirm which ids exist. Nothing in either arm is a calendar value, Map, Set,
 * BigInt, Error or class instance, and nothing carries a plan id, a course
 * offering id, a session id, a student id, an actor id, a timestamp, a raw error,
 * a database detail or any submitted value.
 */
export type DeleteExamAssignmentResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: DeleteExamAssignmentRefusalCode;
    };

function refuse(code: DeleteExamAssignmentRefusalCode): DeleteExamAssignmentResult {
  return Object.freeze({ ok: false as const, code });
}

function succeed(): DeleteExamAssignmentResult {
  return Object.freeze({ ok: true as const });
}

/**
 * Normalize the REQUIRED target id: trim a string, or fail.
 *
 * Returns `null` — "unusable" — for every one of: `null`, `undefined`, a
 * non-string of ANY type (a number, a boolean, an array, a plain object, a
 * function, a file-like upload value) and a string that is empty or
 * whitespace-only.
 *
 * NO COERCION AND NO PROBING: there is no `String(...)` here and the value's own
 * members are never read, so nothing can be talked into producing a target id
 * that the client did not actually send. Case and every internal character are
 * preserved exactly.
 */
function normalizeAssignmentId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// ===========================================================================
// The orchestration
// ===========================================================================

/**
 * Remove exactly ONE stored ExamAssignment from the plan of one authorized,
 * lifecycle-permitted course offering.
 *
 * The order is the safety contract, and it is enforced by construction: each
 * step's output is the next step's only input, so no step can be reordered
 * without the code failing to compile or the plan id becoming unavailable.
 *
 * Each `try` wraps EXACTLY ONE dependency call and asks EXACTLY ONE classifier.
 * Nothing is caught broadly, and an unrecognized error is re-thrown with its
 * identity intact — including a `NEXT_REDIRECT` from the authorization boundary.
 */
export async function deleteExamAssignmentWithDeps(
  courseOfferingId: string,
  assignmentId: unknown,
  deps: DeleteExamAssignmentDeps,
): Promise<DeleteExamAssignmentResult> {
  // 1. Authorization + exact-offering verification FIRST. Nothing about exams,
  //    plans or the submitted target is touched before this resolves, so a
  //    refusal here can never reveal whether an assignment exists.
  let context: VerifiedExamAssignmentCourseContext;
  try {
    context = await deps.requireCourseContext(courseOfferingId);
  } catch (error) {
    if (deps.isCourseNotFoundError(error)) {
      return refuse("offering_not_found");
    }
    throw error;
  }

  // 2. The course-lifecycle gate, on the VERIFIED status. An ARCHIVED offering is
  //    refused without a single exam query.
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

  // 4. No plan means there is no assignment of this course's to remove.
  if (!plan) {
    return refuse("plan_not_found");
  }

  // 5. The target must be well-formed before it is used to look anything up.
  const targetId = normalizeAssignmentId(assignmentId);
  if (targetId === null) {
    return refuse("invalid_input");
  }

  // 6. The assignment, located UNDER the server-resolved plan.
  const existing = await deps.findAssignmentForPlan(plan.id, targetId);

  // 7. Missing, or belonging to another plan — one indistinguishable outcome.
  if (!existing) {
    return refuse("assignment_not_found");
  }

  // 8. The single write, against the id the SCOPED READ returned. Nothing else is
  //    removed, and no surviving row is renumbered.
  await deps.deleteAssignmentById(existing.id);

  // 9. The narrow success: it is gone. No id, no count, no echo.
  return succeed();
}
