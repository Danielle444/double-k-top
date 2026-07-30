/**
 * EXAM EX-SUP-C1 — the PURE orchestration of ONE stored ExamSessionSupervisor
 * CREATE.
 *
 * PURE by construction: no Prisma, no DB, no transaction, no clock, no
 * randomness, no env, no auth/session/cookie, no permission, no filesystem, no
 * network, no Next, no `server-only`, no `"use server"`. Every effect this
 * operation needs arrives through the injected `CreateExamSupervisorDeps`, so the
 * ORDER in which authorization, lifecycle gating, plan resolution, input
 * validation, session verification, eligibility verification and the write happen
 * is stated once, here, and is testable without a database.
 *
 * WHAT THIS ANSWERS (and only this):
 *  - in which EXACT order must a supervisor create authorize, gate, resolve,
 *    validate, verify and write?
 *  - and which stable, non-echoing outcome describes each way it can fail?
 *
 * WHAT THIS DELIBERATELY DOES NOT DO:
 *  - it OWNS NO INPUT RULE. Every rule about a submitted pair's shape belongs to
 *    the sibling `normalizeExamSupervisorCreateInput`, and this module CALLS it.
 *    The two accepted fields, the non-blank rule, the trim rule and the
 *    fail-closed no-coercion rule are all enforced THERE, and are not restated
 *    here where they could drift;
 *  - it OWNS NO POLICY TABLE. Which offering statuses may be configured is the
 *    committed course operation policy's decision, reached through
 *    `assertConfigurationAllowed`;
 *  - it DECIDES NO ELIGIBILITY — see the section below;
 *  - it GRANTS NOTHING and CHECKS NOTHING — see the section below;
 *  - it CREATES NO PLAN and NO SESSION. A supervisor may be recorded only against
 *    a session that ALREADY EXISTS, under a plan that ALREADY EXISTS. There is no
 *    dependency capable of creating either, so lazy creation is not merely
 *    unimplemented — it is unrepresentable;
 *  - it PERFORMS NO IO and knows nothing of a transaction client, a row or a
 *    query. `createSupervisor` is an opaque promise;
 *  - it ORDERS NOTHING. The supervisors of a session are an unordered set with no
 *    position column, so no position is computed, forwarded or returned, and no
 *    reorder operation exists anywhere in this slice;
 *  - it does NOT edit, publish or notify, it writes no session, break or
 *    assignment, and it deletes nothing. Those are other slices, and no
 *    dependency here could reach one.
 *
 * ===========================================================================
 * A STORED SUPERVISOR IS AN OPERATIONAL RELATIONSHIP, NOT AN ACCESS DECISION
 * ===========================================================================
 * Creating this row records WHO IS RUNNING an exam session. It confers nothing.
 *
 * Nothing in this module reads, resolves, grants or checks any permission of any
 * kind; there is no such dependency in the injected boundary, so consulting one
 * is unrepresentable rather than merely absent. Whatever a future reading surface
 * chooses to do with the relationship is decided THERE, by a module that can see
 * an actor.
 *
 * The "responsible instructor" of a live Teaching Practice lesson is a DIFFERENT
 * concept in a different subsystem, and nothing here models, mirrors or consults
 * it.
 *
 * ===========================================================================
 * ELIGIBILITY IS AN INJECTED ANSWER, NEVER A RULE OF THIS MODULE
 * ===========================================================================
 * This database has NO relation between an Instructor and a CourseOffering. There
 * is therefore no fact a pure module could read to decide who may supervise a
 * given course's exam session — any rule written here would be an invention.
 *
 * So the question is asked, never answered: `findEligibleInstructor` receives the
 * VERIFIED offering id and the submitted instructor id and returns either the
 * instructor id the binding vouches for, or `null`. HOW eligibility is proven —
 * an active roster, a course-scoped teaching relation, an explicit allow-list, or
 * simply "the instructor exists and is active" — is entirely the binding's
 * decision, and changing it must not require touching this file.
 *
 * The id the dependency RETURNS, not the submitted one, is what reaches the
 * write.
 *
 * ===========================================================================
 * THE CALLER SUPPLIES A REQUEST, NEVER A GRANT
 * ===========================================================================
 * The only two arguments are a REQUESTED `courseOfferingId` and a RAW, untrusted
 * input object. There is no parameter — and no readable field of the raw object —
 * through which a caller could supply a `planId`, an actor id or a transaction
 * handle.
 *
 * `planId` is derived SERVER-SIDE from the DB-verified offering id that
 * `requireCourseContext` returned, never from the request. The requested id is
 * used for exactly one thing — asking the course boundary to verify it — and is
 * never read again afterwards, so a caller cannot steer the plan lookup at one
 * offering while being authorized for another.
 *
 * ===========================================================================
 * THE LOCKED ORDER, AND WHY EACH STEP PRECEDES THE NEXT
 * ===========================================================================
 *   1. requireCourseContext(requested id)          — admin + exact-offering gate
 *   2. assertConfigurationAllowed(status)           — course-lifecycle gate
 *   3. findExamPlanByCourseOfferingId(verified id)  — VERIFIED id only
 *   4. no plan                                      -> plan_not_found
 *   5. normalizeExamSupervisorCreateInput           — the sibling's input rules
 *   6. invalid                                      -> invalid_input + issues
 *   7. findSessionForPlan(plan.id, sessionId)       — PLAN-SCOPED verification
 *   8. no session                                   -> session_not_found
 *   9. findEligibleInstructor(verified offering)    — OFFERING-SCOPED question
 *  10. not eligible                                 -> instructor_not_eligible
 *  11. createSupervisor(session.id, instructor.id)  — the single write
 *  12. narrow success DTO
 *
 * The consequences are the point:
 *  - NOTHING is validated for a course the actor may not access, so validation
 *    diagnostics can never be used as an oracle over another course;
 *  - NO plan lookup happens before authorization, so the existence of a plan
 *    cannot be probed by an unauthorized caller;
 *  - NO session lookup happens for an invalid submission, so a malformed request
 *    cannot be used to probe which session ids exist;
 *  - NO instructor lookup happens for an unknown session, so the instructor list
 *    cannot be probed through a failed create;
 *  - NO write dependency runs when any verification fails, so a rejected
 *    submission leaves no partial row;
 *  - the lifecycle gate runs BEFORE the plan lookup, so an ARCHIVED offering is
 *    refused without any exam query at all.
 *
 * ===========================================================================
 * A FOREIGN SESSION AND A MISSING ONE ARE THE SAME ANSWER
 * ===========================================================================
 * `findSessionForPlan` is asked for a session under the SERVER-RESOLVED plan. A
 * session that does not exist, and one that exists under ANOTHER plan, both come
 * back as `null` and both produce `session_not_found`. The two are therefore
 * indistinguishable to the caller, which is deliberate: a distinguishable answer
 * would turn this write path into an existence oracle over every other course's
 * exam schedule.
 *
 * The scoping is what makes that true, not a comparison this module performs.
 * There is no dependency that can read a session WITHOUT a plan id, so a
 * cross-plan create is unreachable rather than merely rejected. An id belonging
 * to some other, non-stored identifier space simply resolves to nothing here and
 * receives the same ordinary refusal.
 *
 * The same holds for the instructor: `findEligibleInstructor` is asked under the
 * VERIFIED offering id, so an instructor the binding does not vouch for in this
 * course resolves to `null` and is refused as `instructor_not_eligible`.
 *
 * ===========================================================================
 * ONLY THREE KNOWN FAILURES ARE CLASSIFIED — EVERYTHING ELSE PROPAGATES
 * ===========================================================================
 * Exactly three injected predicates may convert a thrown error into a refusal:
 * the course not-found, the lifecycle denial and the uniqueness violation. Every
 * other throw — an infrastructure fault, a programming error, a plan-query
 * failure, a session-query failure, an eligibility-query failure — LEAVES THIS
 * MODULE UNCHANGED.
 *
 * The uniqueness classifier is NOT dead code: the table carries a real unique key
 * over `(sessionId, instructorId)`, so naming the same instructor on the same
 * session twice — whether by a double submit or by two managers at once — is a
 * reachable, ordinary outcome, and `already_supervising` is its stable name. It
 * is classified at the WRITE, not pre-checked by a read, because a
 * read-then-write would reintroduce exactly the race the unique key exists to
 * close.
 *
 * There is no `unexpected` code and no catch-all `catch`. That is deliberate: a
 * generic failure code would let a real defect render as an ordinary,
 * unremarkable form error that nobody investigates.
 *
 * CRITICALLY, the real admin boundary denies by REDIRECTING (a framework
 * `NEXT_REDIRECT` throw). Because each classifier is asked about one specific
 * error shape and anything unrecognized is re-thrown, a redirect passes straight
 * through and the framework still performs it. A redirect must never be
 * translated into a refusal — an admin who is simply not logged in would then see
 * "not found" instead of the login page.
 */
import {
  normalizeExamSupervisorCreateInput,
  type ExamSupervisorWriteInputIssue,
} from "./exam-supervisor-write-core";

export type {
  ExamSupervisorWriteInputIssue,
  NormalizedExamSupervisorCreate,
} from "./exam-supervisor-write-core";

// ===========================================================================
// The injected boundary
// ===========================================================================

/**
 * The course context a create may act on, AFTER the boundary verified it.
 *
 * Deliberately TWO fields. It is not the project's admin course context and not a
 * CourseOffering row: a name, a level, an activity year or a calendar value would
 * be data this operation has no business reading, and a generated database type
 * here would end this module's purity.
 *
 * `courseOfferingId` is the DB-VERIFIED id — the one the boundary confirmed
 * exists — and is the ONLY id that reaches the plan lookup and the eligibility
 * question. `status` is a plain `string` rather than the generated enum for the
 * same purity reason; the committed policy the gate consults is default-deny, so
 * an unrecognized status is refused rather than waved through.
 */
export interface VerifiedExamSupervisorCourseContext {
  readonly courseOfferingId: string;
  readonly status: string;
}

/**
 * The plan the target session must live under: its id and nothing else.
 *
 * No publication state, no sessions, no definitions, no offering relation, no
 * timestamps. A create does not need to know whether the plan is published, and
 * must not be able to make a decision from data it should not have read.
 */
export interface ResolvedExamPlanForSupervisorCreate {
  readonly id: string;
}

/**
 * The verification result for the submitted session: its id, and nothing else.
 *
 * Deliberately NOT the session row. There is no date, no start time, no title, no
 * field name, no position, no capacity and no definition — a field this module
 * cannot read is a decision it cannot quietly start making, and a name echoed
 * into a diagnostic would leak another course's configuration if the scoping ever
 * regressed.
 *
 * `id` is the SERVER-VERIFIED target of the write that follows.
 */
export interface VerifiedExamSessionForSupervisorCreate {
  readonly id: string;
}

/**
 * The eligibility verdict for the submitted instructor: the id of the instructor
 * the binding vouches for IN THE VERIFIED OFFERING, and nothing else.
 *
 * No name, no phone number, no activity flag and no relation. A create needs to
 * know only that this person may supervise here; every other fact about them
 * would be personal data this operation has no reason to hold.
 */
export interface EligibleExamSupervisorInstructor {
  readonly instructorId: string;
}

/**
 * What the write reports back: the new supervisor id. Never the row, never a
 * timestamp, and never a position — the table has none.
 */
export interface CreatedExamSupervisorRecord {
  readonly id: string;
}

/**
 * The complete injected boundary.
 *
 * Note what is ABSENT and therefore unrepresentable: there is no dependency that
 * can create or upsert a plan or a session, edit or delete anything, order
 * anything, write a break, an assignment or a second relationship, publish
 * anything, send a notification, resolve a permission, count anything, or read
 * another course. The operation is structurally incapable of doing anything but
 * recording one instructor against one already-existing session.
 *
 * The three predicates take `unknown` and return a boolean: this module never
 * inspects, unwraps, logs or echoes a raw error, so no database detail and no
 * submitted value can leak into a result through them.
 */
export interface CreateExamSupervisorDeps {
  /**
   * Authorize the actor and verify the REQUESTED offering exists. May throw the
   * project's typed not-found, and may REDIRECT for an unauthenticated or
   * non-admin caller — the redirect must reach the framework untouched.
   */
  requireCourseContext(
    requestedCourseOfferingId: string,
  ): Promise<VerifiedExamSupervisorCourseContext>;

  /** Gate the mutation on the VERIFIED offering status. Throws to deny. */
  assertConfigurationAllowed(status: string): void;

  /** Find the plan of the VERIFIED offering. `null` means "no plan exists". */
  findExamPlanByCourseOfferingId(
    verifiedCourseOfferingId: string,
  ): Promise<ResolvedExamPlanForSupervisorCreate | null>;

  /**
   * Verify the submitted session EXISTS UNDER THE GIVEN PLAN.
   *
   * The plan id is the SERVER-RESOLVED one, and there is no variant of this
   * dependency that omits it. `null` means "no such session under this plan" and
   * covers both a session that does not exist and one belonging to another plan —
   * the caller may not learn which.
   */
  findSessionForPlan(
    planId: string,
    sessionId: string,
  ): Promise<VerifiedExamSessionForSupervisorCreate | null>;

  /**
   * Ask whether the submitted instructor may supervise IN THE VERIFIED OFFERING.
   *
   * The offering id is the boundary's, never the request's, and there is no
   * variant of this dependency that omits it. `null` means "not eligible here".
   * HOW that is proven is entirely this dependency's business: no rule about
   * instructors lives in this module, because no such relation exists in the
   * schema for a pure module to reason about.
   */
  findEligibleInstructor(
    verifiedCourseOfferingId: string,
    instructorId: string,
  ): Promise<EligibleExamSupervisorInstructor | null>;

  /**
   * The SINGLE write: record the eligible instructor against the given session.
   * Both ids are the SERVER-VERIFIED ones. There is nothing else to write — the
   * stored row is the pair and its own key.
   */
  createSupervisor(
    sessionId: string,
    instructorId: string,
  ): Promise<CreatedExamSupervisorRecord>;

  /** Is this throw "the requested offering does not exist"? */
  isCourseNotFoundError(error: unknown): boolean;

  /** Is this throw "the offering's lifecycle forbids this operation"? */
  isOperationNotAllowedError(error: unknown): boolean;

  /** Is this throw "that instructor already supervises that session"? */
  isUniqueConstraintError(error: unknown): boolean;
}

// ===========================================================================
// The result model
// ===========================================================================

/**
 * The failure codes that need no diagnostics: each is fully described by the code
 * itself.
 *
 * There is deliberately no `unexpected`, `stale_write`, `session_full`,
 * `archived` or `definition_not_found` code: the first would hide defects, and
 * the rest describe a limit this operation does not enforce, a lookup it does not
 * perform, or an operation it does not carry out.
 */
export type CreateExamSupervisorRefusalCode =
  | "offering_not_found"
  | "operation_not_allowed"
  | "plan_not_found"
  | "session_not_found"
  | "instructor_not_eligible"
  | "already_supervising";

/**
 * A discriminated, JSON-safe, frozen result.
 *
 * THREE arms rather than two, so `issues` EXISTS ONLY on `invalid_input`. A
 * single failure arm with an optional `issues` would be present-but-`undefined`
 * on every other refusal, which breaks the JSON round trip the exam module's
 * results are held to and invites callers to render an empty issue list.
 *
 * The success arm carries the new supervisor id and NOTHING ELSE — no session id,
 * no instructor id, no offering id, no plan id and no position. Nothing in any arm
 * is a calendar value, Map, Set, BigInt, Error or class instance, and nothing
 * carries an actor id, a timestamp, a raw error, a database detail or any
 * submitted value — a diagnostic must never echo what the client sent back to the
 * client.
 */
export type CreateExamSupervisorResult =
  | {
      readonly ok: true;
      readonly supervisorId: string;
    }
  | {
      readonly ok: false;
      readonly code: "invalid_input";
      readonly issues: readonly ExamSupervisorWriteInputIssue[];
    }
  | {
      readonly ok: false;
      readonly code: CreateExamSupervisorRefusalCode;
    };

function refuse(code: CreateExamSupervisorRefusalCode): CreateExamSupervisorResult {
  return Object.freeze({ ok: false as const, code });
}

function refuseInput(
  issues: readonly ExamSupervisorWriteInputIssue[],
): CreateExamSupervisorResult {
  return Object.freeze({
    ok: false as const,
    code: "invalid_input" as const,
    // A fresh frozen copy: the result must not alias an array a caller could
    // later mutate, and the sibling core's own issue ORDER is preserved exactly
    // so a form can render diagnostics in a stable sequence.
    issues: Object.freeze([...issues]),
  });
}

function succeed(created: CreatedExamSupervisorRecord): CreateExamSupervisorResult {
  return Object.freeze({ ok: true as const, supervisorId: created.id });
}

// ===========================================================================
// The orchestration
// ===========================================================================

/**
 * Record exactly ONE stored ExamSessionSupervisor against an ALREADY-EXISTING
 * session, in the ALREADY-EXISTING plan of one authorized, lifecycle-permitted
 * course offering.
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
export async function createExamSupervisorWithDeps(
  courseOfferingId: string,
  rawInput: unknown,
  deps: CreateExamSupervisorDeps,
): Promise<CreateExamSupervisorResult> {
  // 1. Authorization + exact-offering verification FIRST. Nothing about exams,
  //    plans, sessions, instructors or the submitted input is touched before this
  //    resolves.
  let context: VerifiedExamSupervisorCourseContext;
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

  // 4. No plan means no session to record anybody against. This slice never
  //    creates or upserts one, and no injected dependency could.
  if (!plan) {
    return refuse("plan_not_found");
  }

  // 5. Only NOW is the submitted input examined, and every rule about it belongs
  //    to the sibling normalizer.
  const normalized = normalizeExamSupervisorCreateInput(rawInput);

  // 6. Invalid input ends the operation with the sibling's diagnostics verbatim.
  //    Neither the session lookup, the eligibility question nor the write is
  //    reached.
  if (!normalized.ok) {
    return refuseInput(normalized.issues);
  }

  // 7. The session must exist UNDER THE RESOLVED PLAN. The plan id is the
  //    server's, and it is the scope — not a comparison — that makes a cross-plan
  //    create unreachable.
  const session = await deps.findSessionForPlan(plan.id, normalized.value.sessionId);

  // 8. A missing session and a foreign one produce the SAME refusal, so this
  //    write path is not an existence oracle over another course's schedule.
  if (!session) {
    return refuse("session_not_found");
  }

  // 9. Eligibility, ASKED under the VERIFIED offering and answered entirely by
  //    the binding. This module states no rule about who may supervise, because
  //    the schema holds no fact from which a pure module could derive one.
  const instructor = await deps.findEligibleInstructor(
    context.courseOfferingId,
    normalized.value.instructorId,
  );

  // 10. Unknown and not-vouched-for are the same answer, for the same reason.
  if (!instructor) {
    return refuse("instructor_not_eligible");
  }

  // 11. The single write, against the SERVER-VERIFIED session id and the
  //     SERVER-VOUCHED instructor id — not the submitted ones. A uniqueness
  //     violation means that instructor already supervises that session, which is
  //     an ordinary outcome and never a defect.
  let created: CreatedExamSupervisorRecord;
  try {
    created = await deps.createSupervisor(session.id, instructor.instructorId);
  } catch (error) {
    if (deps.isUniqueConstraintError(error)) {
      return refuse("already_supervising");
    }
    throw error;
  }

  // 12. The narrow success DTO: the new supervisor id, nothing else.
  return succeed(created);
}
