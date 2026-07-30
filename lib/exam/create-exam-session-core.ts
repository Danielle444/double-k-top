/**
 * EXAM EX-SES-S2 — the PURE orchestration of ONE stored ExamSession CREATE.
 *
 * PURE by construction: no Prisma, no DB, no transaction, no clock, no
 * randomness, no env, no auth/session/cookie, no capability, no filesystem, no
 * network, no Next, no `server-only`, no `"use server"`. Every effect this
 * operation needs arrives through the injected `CreateExamSessionDeps`, so the
 * ORDER in which authorization, lifecycle gating, plan resolution, input
 * validation, definition verification and the write happen is stated once, here,
 * and is testable without a database.
 *
 * WHAT THIS ANSWERS (and only this):
 *  - in which EXACT order must a stored-session create authorize, gate, resolve,
 *    validate, verify and write?
 *  - and which stable, non-echoing outcome describes each way it can fail?
 *
 * WHAT THIS DELIBERATELY DOES NOT DO:
 *  - it OWNS NO INPUT RULE. Every rule about a submitted session's shape belongs
 *    to the committed `normalizeExamSessionCreateInput`, and this module CALLS
 *    it. The six accepted fields, the real-calendar date rule, the exact `HH:mm`
 *    rule, the fail-closed optional-text rule and the fixed diagnostic order are
 *    all enforced THERE, and are not restated here where they could drift;
 *  - it OWNS NO POLICY TABLE. Which offering statuses may be configured is the
 *    committed course operation policy's decision, reached through
 *    `assertConfigurationAllowed`;
 *  - it CREATES NO PLAN. A session may be created only under an ExamPlan that
 *    ALREADY EXISTS. There is no dependency capable of creating or upserting a
 *    plan, so lazy plan creation is not merely unimplemented — it is
 *    unrepresentable. A missing plan is an ordinary refusal (`plan_not_found`);
 *  - it PERFORMS NO IO and knows nothing of Prisma, a transaction client, a row,
 *    a query or a calendar type. `createSessionAtNextOrder` is an opaque promise;
 *  - it DERIVES NOTHING. No end time, no wave layout, no personal slot, no
 *    capacity, no conflict and no timetable is computed, and none is an input:
 *    those are projections over a stored row plus its definition;
 *  - it does NOT edit, delete, reorder, publish or copy anything, it writes no
 *    assignment, break or supervisor, and it sends no notification. Those are
 *    later slices, and no dependency here could reach one.
 *
 * ===========================================================================
 * THE CALLER SUPPLIES A REQUEST, NEVER A GRANT
 * ===========================================================================
 * The only two arguments are a REQUESTED `courseOfferingId` and a RAW, untrusted
 * input object. There is no parameter — and no readable field of the raw object —
 * through which a caller could supply a `planId`, a `sessionId`, an `orderIndex`,
 * an actor id, a publication option or a transaction handle.
 *
 * `planId` in particular is derived SERVER-SIDE from the DB-verified offering id
 * that `requireCourseContext` returned, never from the request. The requested id
 * is used for exactly one thing — asking the course boundary to verify it — and
 * is never read again afterwards, so a caller cannot steer the plan lookup at one
 * offering while being authorized for another.
 *
 * `orderIndex` is assigned entirely inside `createSessionAtNextOrder`. This
 * module never computes, reads, defaults or forwards one; the committed input
 * normalizer does not even model the field.
 *
 * ===========================================================================
 * THE LOCKED ORDER, AND WHY EACH STEP PRECEDES THE NEXT
 * ===========================================================================
 *   1. requireCourseContext(requested id)   — admin + exact-offering boundary
 *   2. assertConfigurationAllowed(status)    — course-lifecycle gate
 *   3. findExamPlanByCourseOfferingId(id)    — VERIFIED id only
 *   4. no plan                               -> plan_not_found
 *   5. normalizeExamSessionCreateInput       — the committed input rules
 *   6. invalid                               -> invalid_input + stable issues
 *   7. findDefinitionForPlan(plan.id, def)   — PLAN-SCOPED verification
 *   8. no definition                         -> definition_not_found
 *   9. createSessionAtNextOrder(plan.id)     — the single write
 *  10. narrow success DTO
 *
 * The consequences are the point:
 *  - NOTHING is validated for a course the actor may not access, so validation
 *    diagnostics can never be used as an oracle over another course;
 *  - NO plan lookup happens before authorization, so the existence of a plan
 *    cannot be probed by an unauthorized caller;
 *  - NO definition lookup happens for an invalid submission, so a malformed
 *    request cannot be used to probe which definition ids exist;
 *  - NO write dependency runs when validation or verification fails, so a
 *    rejected submission can leave no partial row and consume no order position;
 *  - the lifecycle gate runs BEFORE the plan lookup, so an ARCHIVED offering is
 *    refused without any exam query at all.
 *
 * ===========================================================================
 * A FOREIGN DEFINITION AND A MISSING ONE ARE THE SAME ANSWER
 * ===========================================================================
 * `findDefinitionForPlan` is asked for a definition under the SERVER-RESOLVED
 * plan. A definition that does not exist, and one that exists under ANOTHER
 * plan, both come back as `null` and both produce `definition_not_found`. The two
 * are therefore indistinguishable to the caller, which is deliberate: a
 * distinguishable answer would turn this write path into an existence oracle over
 * every other course's exam configuration.
 *
 * The scoping is what makes that true, not a comparison this module performs.
 * There is no dependency that can read a definition WITHOUT a plan id, so a
 * cross-plan create is unreachable rather than merely rejected.
 *
 * ===========================================================================
 * BEGINNER SESSIONS, AND WHY NO KIND IS INSPECTED HERE
 * ===========================================================================
 * Beginner exams are a LIVE Teaching Practice projection and must never become a
 * stored row. That rule belongs to the committed domain core, which sees the
 * definition's authoritative kind; this slice's verification dependency returns
 * the definition's id and NOTHING ELSE, so this module cannot inspect a kind and
 * does not pretend to. A second, half-informed copy of the rule here could only
 * guess, and a guess that said "allowed" would be worse than no check at all.
 *
 * The consequence is stated plainly rather than hidden: this slice does not
 * itself refuse a session whose definition is of the live beginner kind. Adding
 * that refusal means giving the verification dependency the definition's kind and
 * binding the committed domain validator, which is a separate approved change.
 *
 * ===========================================================================
 * ONLY TWO KNOWN FAILURES ARE CLASSIFIED — EVERYTHING ELSE PROPAGATES
 * ===========================================================================
 * Exactly two injected predicates may convert a thrown error into a refusal: the
 * course not-found and the lifecycle denial. Every other throw — an
 * infrastructure fault, a programming error, a plan-query failure, a
 * definition-query failure, an unexpected write failure — LEAVES THIS MODULE
 * UNCHANGED.
 *
 * There is deliberately NO duplicate classifier. The stored session table's only
 * unique key is the beginner-copy idempotency key on
 * `(planId, sourceTeachingPracticeLessonId)`, and this slice never writes that
 * column, so the value is null, Postgres treats each null as distinct, and no
 * uniqueness violation is reachable from this operation. A classifier for a
 * conflict that cannot happen would be dead code that a future edit could
 * silently start relying on.
 *
 * There is likewise no classifier for the composite foreign key to the
 * definition. The plan-scoped verification above is what makes the key
 * satisfiable; if a manager DELETES that definition in the instant between the
 * verification and the write, the database refuses and that refusal propagates as
 * an unexpected error rather than being laundered into `definition_not_found`.
 * That is the honest outcome: the caller was not wrong about the definition, the
 * world changed underneath them, and a "not found" would misdescribe it.
 *
 * There is no `unexpected` code and no catch-all `catch`. That is deliberate: a
 * generic failure code would let a real defect render as an ordinary,
 * unremarkable form error that nobody investigates.
 *
 * CRITICALLY, the real admin boundary denies by REDIRECTING (a Next
 * `NEXT_REDIRECT` throw). Because each classifier is asked about one specific
 * error shape and anything unrecognized is re-thrown, a redirect passes straight
 * through and the framework still performs it. A redirect must never be
 * translated into a refusal — an admin who is simply not logged in would then see
 * "not found" instead of the login page.
 *
 * ===========================================================================
 * NO CALENDAR TYPE CROSSES THIS BOUNDARY
 * ===========================================================================
 * The committed normalizer produces `date` as a validated `YYYY-MM-DD` STRING,
 * and this module forwards that payload untouched. Nothing here constructs,
 * parses, compares or formats a calendar value, and no dependency signature and
 * no result field carries one. The single conversion to the database's date type
 * belongs to the server-only write binding, where the repository's existing
 * date-key helper performs it exactly once — putting it here would drag a
 * timezone decision into a pure core and would make this module untestable
 * without one.
 */
import {
  normalizeExamSessionCreateInput,
  type ExamSessionWriteInputIssue,
  type NormalizedExamSessionCreate,
} from "./exam-session-write-core";

export type {
  ExamSessionWriteInputIssue,
  NormalizedExamSessionCreate,
} from "./exam-session-write-core";

// ===========================================================================
// The injected boundary
// ===========================================================================

/**
 * The course context a create may act on, AFTER the boundary verified it.
 *
 * Deliberately TWO fields. It is not the project's `AdminCourseContext` and not a
 * CourseOffering row: a name, a level, an ActivityYear or a date would be data
 * this operation has no business reading, and a generated Prisma type here would
 * end this module's purity.
 *
 * `courseOfferingId` is the DB-VERIFIED id — the one the boundary confirmed
 * exists — and is the ONLY id that reaches the plan lookup. `status` is a plain
 * `string` rather than the generated enum for the same purity reason; the
 * committed policy the gate consults is default-deny, so an unrecognized status
 * is refused rather than waved through.
 */
export interface VerifiedExamSessionCourseContext {
  readonly courseOfferingId: string;
  readonly status: string;
}

/**
 * The plan a session will hang under: its id and nothing else.
 *
 * No `publishedAt`, no source dates, no existing sessions, no definitions, no
 * offering relation, no timestamps. A create does not need to know whether the
 * plan is published (publication is a separate, later decision) and must not be
 * able to make a decision from data it should not have read.
 */
export interface ResolvedExamPlanForSessionCreate {
  readonly id: string;
}

/**
 * The verification result for the submitted definition: its id, and nothing
 * else.
 *
 * No `kind`, no `name`, no duration, no capacity, no `planId`, no `orderIndex`
 * and no timestamp. The narrowness is the safety property — see the header on
 * beginner sessions: a field this module cannot read is a decision it cannot
 * quietly start making, and a name or kind echoed into a diagnostic would leak
 * another course's configuration if the scoping ever regressed.
 */
export interface VerifiedExamDefinitionForSessionCreate {
  readonly id: string;
}

/**
 * What the write reports back: the new session id and the order position the
 * SERVER assigned. Never the row, never the date it stored, never a timestamp.
 */
export interface CreatedExamSessionRecord {
  readonly id: string;
  readonly orderIndex: number;
}

/**
 * The complete injected boundary.
 *
 * Note what is ABSENT and therefore unrepresentable: there is no dependency that
 * can create or upsert an ExamPlan, create or edit a definition, update or delete
 * a session, reorder sessions, write an assignment, a break or a supervisor,
 * publish anything, send a notification, resolve a capability, or read another
 * course. The operation is structurally incapable of doing anything but appending
 * one session to one already-existing plan.
 *
 * The two predicates take `unknown` and return a boolean: this module never
 * inspects, unwraps, logs or echoes a raw error, so no database detail and no
 * submitted value can leak into a result through them.
 */
export interface CreateExamSessionDeps {
  /**
   * Authorize the actor and verify the REQUESTED offering exists. May throw the
   * project's typed not-found, and may REDIRECT for an unauthenticated or
   * non-admin caller — the redirect must reach the framework untouched.
   */
  requireCourseContext(
    requestedCourseOfferingId: string,
  ): Promise<VerifiedExamSessionCourseContext>;

  /** Gate the mutation on the VERIFIED offering status. Throws to deny. */
  assertConfigurationAllowed(status: string): void;

  /** Find the plan of the VERIFIED offering. `null` means "no plan exists". */
  findExamPlanByCourseOfferingId(
    verifiedCourseOfferingId: string,
  ): Promise<ResolvedExamPlanForSessionCreate | null>;

  /**
   * Verify the submitted definition EXISTS UNDER THE GIVEN PLAN.
   *
   * The plan id is the SERVER-RESOLVED one, and there is no variant of this
   * dependency that omits it. `null` means "no such definition under this plan"
   * and covers both a definition that does not exist and one belonging to another
   * plan — the caller may not learn which.
   */
  findDefinitionForPlan(
    planId: string,
    definitionId: string,
  ): Promise<VerifiedExamDefinitionForSessionCreate | null>;

  /**
   * The SINGLE write: append one session to the given plan, assigning the next
   * order position itself. The plan id is the SERVER-RESOLVED one.
   */
  createSessionAtNextOrder(
    planId: string,
    value: NormalizedExamSessionCreate,
  ): Promise<CreatedExamSessionRecord>;

  /** Is this throw "the requested offering does not exist"? */
  isCourseNotFoundError(error: unknown): boolean;

  /** Is this throw "the offering's lifecycle forbids this operation"? */
  isOperationNotAllowedError(error: unknown): boolean;
}

// ===========================================================================
// The result model
// ===========================================================================

/**
 * The failure codes that need no diagnostics: each is fully described by the code
 * itself.
 */
export type CreateExamSessionRefusalCode =
  | "offering_not_found"
  | "operation_not_allowed"
  | "plan_not_found"
  | "definition_not_found";

/**
 * A discriminated, JSON-safe, frozen result.
 *
 * THREE arms rather than two, so `issues` EXISTS ONLY on `invalid_input`. A
 * single failure arm with an optional `issues` would be present-but-`undefined`
 * on every other refusal, which breaks the JSON round trip the exam module's
 * results are held to and invites callers to render an empty issue list.
 *
 * The success arm carries the new session id and its assigned position, and
 * NOTHING ELSE. Nothing in any arm is a calendar value, Map, Set, BigInt, Error
 * or class instance, and nothing carries a plan id, a course offering id, a
 * definition id, a date, a start time, an actor id, a timestamp, a raw error, a
 * database detail or any submitted value — a diagnostic must never echo what the
 * client sent back to the client.
 *
 * There is deliberately no `unexpected`, `stale_write`, `session_not_found`,
 * `duplicate` or `conflict` code: the first would hide defects, and the rest
 * describe operations this slice does not perform or a conflict it cannot reach.
 */
export type CreateExamSessionResult =
  | {
      readonly ok: true;
      readonly sessionId: string;
      readonly orderIndex: number;
    }
  | {
      readonly ok: false;
      readonly code: "invalid_input";
      readonly issues: readonly ExamSessionWriteInputIssue[];
    }
  | {
      readonly ok: false;
      readonly code: CreateExamSessionRefusalCode;
    };

function refuse(code: CreateExamSessionRefusalCode): CreateExamSessionResult {
  return Object.freeze({ ok: false as const, code });
}

function refuseInput(
  issues: readonly ExamSessionWriteInputIssue[],
): CreateExamSessionResult {
  return Object.freeze({
    ok: false as const,
    code: "invalid_input" as const,
    // A fresh frozen copy: the result must not alias an array a caller could
    // later mutate, and the committed core's own issue ORDER is preserved exactly
    // so a form can render diagnostics in a stable sequence.
    issues: Object.freeze([...issues]),
  });
}

function succeed(created: CreatedExamSessionRecord): CreateExamSessionResult {
  return Object.freeze({
    ok: true as const,
    sessionId: created.id,
    orderIndex: created.orderIndex,
  });
}

// ===========================================================================
// The orchestration
// ===========================================================================

/**
 * Create exactly ONE stored ExamSession under the ALREADY-EXISTING plan of one
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
export async function createExamSessionWithDeps(
  courseOfferingId: string,
  rawInput: unknown,
  deps: CreateExamSessionDeps,
): Promise<CreateExamSessionResult> {
  // 1. Authorization + exact-offering verification FIRST. Nothing about exams,
  //    plans, definitions or the submitted input is touched before this resolves.
  let context: VerifiedExamSessionCourseContext;
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
  //    injected dependency could: plan creation is its own committed slice.
  if (!plan) {
    return refuse("plan_not_found");
  }

  // 5. Only NOW is the submitted input examined, and every rule about it belongs
  //    to the committed normalizer.
  const normalized = normalizeExamSessionCreateInput(rawInput);

  // 6. Invalid input ends the operation with the committed diagnostics verbatim.
  //    Neither the definition lookup nor the write is reached at all.
  if (!normalized.ok) {
    return refuseInput(normalized.issues);
  }

  // 7. The definition must exist UNDER THE RESOLVED PLAN. The plan id is the
  //    server's, and it is the scope — not a comparison — that makes a cross-plan
  //    create unreachable.
  const definition = await deps.findDefinitionForPlan(
    plan.id,
    normalized.value.definitionId,
  );

  // 8. A missing definition and a foreign one produce the SAME refusal, so this
  //    write path is not an existence oracle over another course's plan.
  if (!definition) {
    return refuse("definition_not_found");
  }

  // 9. The single write, against the SERVER-RESOLVED plan id and the NORMALIZED
  //    payload. The order position is assigned inside the dependency; nothing
  //    here supplies, defaults or forwards one.
  const created = await deps.createSessionAtNextOrder(plan.id, normalized.value);

  // 10. The narrow success DTO: the new session id and its assigned position,
  //     nothing else.
  return succeed(created);
}
