/**
 * EXAM EX-ASG-C1 — the PURE orchestration of ONE stored EXAMINEE assignment
 * CREATE.
 *
 * PURE by construction: no Prisma, no DB, no transaction, no clock, no
 * randomness, no env, no auth/session/cookie, no capability, no filesystem, no
 * network, no Next, no `server-only`, no `"use server"`. Every effect this
 * operation needs arrives through the injected `CreateExamAssignmentDeps`, so the
 * ORDER in which authorization, lifecycle gating, plan resolution, input
 * validation, session verification, definition verification, eligibility
 * verification and the write happen is stated once, here, and is testable
 * without a database.
 *
 * WHAT THIS ANSWERS (and only this):
 *  - in which EXACT order must an examinee-assignment create authorize, gate,
 *    resolve, validate, verify and write?
 *  - and which stable, non-echoing outcome describes each way it can fail?
 *
 * WHAT THIS DELIBERATELY DOES NOT DO:
 *  - it OWNS NO INPUT RULE. Every rule about a submitted assignment's shape
 *    belongs to the sibling `normalizeExamAssignmentCreateInput`, and this module
 *    CALLS it. The three accepted fields, the non-blank rule, the trim rule and
 *    the fail-closed no-coercion rule are all enforced THERE, and are not
 *    restated here where they could drift;
 *  - it OWNS NO HORSE RULE. WHICH assignments must carry a horse is the committed
 *    `isHorseRequiredFor`'s decision, and this module consults it with the
 *    definition's authoritative kind. No kind table and no role table is
 *    reproduced here;
 *  - it OWNS NO POLICY TABLE. Which offering statuses may be configured is the
 *    committed course operation policy's decision, reached through
 *    `assertConfigurationAllowed`;
 *  - it CREATES NO PLAN and NO SESSION. An assignment may be created only under a
 *    session that ALREADY EXISTS, under a plan that ALREADY EXISTS. There is no
 *    dependency capable of creating either, so lazy creation is not merely
 *    unimplemented — it is unrepresentable;
 *  - it PERFORMS NO IO and knows nothing of a transaction client, a row or a
 *    query. `createAssignmentAtNextOrder` is an opaque promise;
 *  - it DERIVES NOTHING and ENFORCES NO CAPACITY. No wave layout, no personal
 *    slot, no end time, no break, no conflict and no timetable is computed, and
 *    none is an input — see the capacity section below;
 *  - it does NOT edit, delete, reorder or publish anything, it writes no session,
 *    break or supervisor, and it sends no notification. Those are other slices,
 *    and no dependency here could reach one.
 *
 * ===========================================================================
 * THE CALLER SUPPLIES A REQUEST, NEVER A GRANT
 * ===========================================================================
 * The only two arguments are a REQUESTED `courseOfferingId` and a RAW, untrusted
 * input object. There is no parameter — and no readable field of the raw object —
 * through which a caller could supply a `role`, an `orderIndex`, a `planId`, an
 * actor id or a transaction handle.
 *
 * `planId` is derived SERVER-SIDE from the DB-verified offering id that
 * `requireCourseContext` returned, never from the request. The requested id is
 * used for exactly one thing — asking the course boundary to verify it — and is
 * never read again afterwards, so a caller cannot steer the plan lookup at one
 * offering while being authorized for another.
 *
 * `role` is HARDCODED to `EXAMINEE` inside this module and is typed as that
 * single literal all the way into the write dependency. It is not a parameter,
 * not a field of any input type, and not a value any caller can influence. This
 * slice creates examinees and nothing else.
 *
 * `orderIndex` is assigned entirely inside `createAssignmentAtNextOrder`. This
 * module never computes, reads, defaults or forwards one; the sibling input
 * normalizer does not even model the field.
 *
 * ===========================================================================
 * THE LOCKED ORDER, AND WHY EACH STEP PRECEDES THE NEXT
 * ===========================================================================
 *   1. requireCourseContext(requested id)     — admin + exact-offering boundary
 *   2. assertConfigurationAllowed(status)      — course-lifecycle gate
 *   3. findExamPlanByCourseOfferingId(id)      — VERIFIED id only
 *   4. no plan                                 -> plan_not_found
 *   5. normalizeExamAssignmentCreateInput      — the sibling's input rules
 *   6. invalid                                 -> invalid_input + stable issues
 *   7. findSessionForPlan(plan.id, sessionId)  — PLAN-SCOPED verification
 *   8. no session                              -> session_not_found
 *   9. the horse requirement, against the definition's authoritative kind
 *  10. the definition's unsupported demands    -> refuse, write nothing
 *  11. findEligibleTrainee(verified offering)  — OFFERING-SCOPED verification
 *  12. not eligible                            -> trainee_not_eligible
 *  13. createAssignmentAtNextOrder(session.id) — the single write
 *  14. narrow success DTO
 *
 * The consequences are the point:
 *  - NOTHING is validated for a course the actor may not access, so validation
 *    diagnostics can never be used as an oracle over another course;
 *  - NO plan lookup happens before authorization, so the existence of a plan
 *    cannot be probed by an unauthorized caller;
 *  - NO session lookup happens for an invalid submission, so a malformed request
 *    cannot be used to probe which session ids exist;
 *  - NO trainee lookup happens for an unknown session or an unsupported
 *    definition, so the roster cannot be probed through a failed create;
 *  - NO write dependency runs when any verification fails, so a rejected
 *    submission leaves no partial row and consumes no order position;
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
 * The same holds for the trainee: `findEligibleTrainee` is asked under the
 * VERIFIED offering id, so a `Student.id` from another course resolves to `null`
 * and is refused as `trainee_not_eligible`. The eligible id the dependency
 * returns — not the submitted one — is what reaches the write.
 *
 * ===========================================================================
 * PD-1: AN UNSUPPORTED DEFINITION IS REFUSED, NOT HALF-WRITTEN
 * ===========================================================================
 * A definition may DEMAND a lesson topic or a discipline on its examinee
 * assignments. This slice's input model has no field for either, so a row created
 * under such a definition would be missing a value its own definition requires,
 * and the committed conformance validator would report that row as invalid the
 * moment anybody looked at it.
 *
 * The locked decision is therefore to REFUSE the whole operation with
 * `definition_requires_unsupported_fields` and write NOTHING. A partial row that
 * a manager must later discover and repair is worse than an honest refusal at the
 * point of submission, and silently dropping the demand would be worse still.
 *
 * The check FAILS CLOSED: anything that is not literally `false` is treated as a
 * demand. A malformed flag arriving from a future binding must not be read as
 * "no requirement" — that is precisely the reading that would produce the
 * incomplete row this refusal exists to prevent.
 *
 * ===========================================================================
 * PD-2: A DEFINITION THAT ALSO NEEDS A SECOND PERSON IS STILL CREATABLE
 * ===========================================================================
 * `requiresInstructedTrainee` does NOT block creating the examinee row. That flag
 * says the block must ALSO carry an assignment in the other role, which is a
 * different row, written by a different operation that does not exist yet.
 *
 * Refusing the examinee here would make such a block unbuildable: neither row
 * could ever be created first. The examinee is written now, the block is
 * incomplete until the second role is implemented, and the committed conformance
 * validator is what reports it as incomplete in the meantime — which is exactly
 * what a validator is for. Nothing here pretends the block is finished.
 *
 * ===========================================================================
 * NO CAPACITY RULE IS APPLIED, AND THAT IS NOT AN OVERSIGHT
 * ===========================================================================
 * `parallelCapacity` is a PER-WAVE figure: it says how many examinees run at the
 * same time, not how many may be assigned to a session. A session with more
 * assignments than its capacity simply runs in more waves, and the derived
 * timetable — a projection over the stored rows — is what expresses that.
 *
 * So no dependency here exposes a capacity, a duration, a wave, a slot, an end
 * time or a break, and none of them is consulted. Treating capacity as a hard
 * limit would refuse legitimate schedules that the reading side already renders
 * correctly.
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
 * The uniqueness classifier is NOT dead code here, unlike on the session create
 * path: the assignment table carries a real unique key over `(sessionId,
 * studentId)`, so assigning the same trainee to the same session twice — whether
 * by a double submit or by two managers at once — is a reachable, ordinary
 * outcome, and `assignment_conflict` is its stable name. It is classified at the
 * WRITE, not pre-checked by a read, because a read-then-write would reintroduce
 * exactly the race the unique key exists to close.
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
  makeExamAssignmentWriteInputIssue,
  normalizeExamAssignmentCreateInput,
  type ExamAssignmentWriteInputIssue,
} from "./exam-assignment-write-core";
import { isHorseRequiredFor } from "./exam-definition-validation-core";
import type { ExamAssignmentRole, ExamKind } from "./exam-domain-core";

export type {
  ExamAssignmentWriteInputIssue,
  NormalizedExamAssignmentCreate,
} from "./exam-assignment-write-core";

/**
 * The ONLY role this slice writes, fixed here and never derived from input.
 *
 * Typed as the committed union member so a future rename of the role vocabulary
 * cannot leave a stale string literal behind in this file.
 */
const ROLE_EXAMINEE = "EXAMINEE" satisfies ExamAssignmentRole;

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
 * lookup. `status` is a plain `string` rather than the generated enum for the
 * same purity reason; the committed policy the gate consults is default-deny, so
 * an unrecognized status is refused rather than waved through.
 */
export interface VerifiedExamAssignmentCourseContext {
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
export interface ResolvedExamPlanForAssignmentCreate {
  readonly id: string;
}

/**
 * The verification result for the submitted session: its id, and the four
 * DEFINITION-DERIVED facts this operation is entitled to act on.
 *
 * Deliberately NOT the session row and NOT the definition row. There is no date,
 * no start time, no title, no field name, no order position, no capacity, no
 * duration, no wave layout and no assignment list — a field this module cannot
 * read is a decision it cannot quietly start making, and a name echoed into a
 * diagnostic would leak another course's configuration if the scoping ever
 * regressed.
 *
 * `definitionKind` is the AUTHORITATIVE kind carried by the definition the
 * session hangs off, never a value a client supplied. It exists here for exactly
 * one purpose: to let the committed horse rule be consulted with real data.
 */
export interface VerifiedExamSessionForAssignmentCreate {
  readonly id: string;
  readonly definitionKind: ExamKind;
  readonly requiresLessonTopic: boolean;
  readonly requiresDiscipline: boolean;
  readonly requiresInstructedTrainee: boolean;
}

/**
 * The eligibility verdict for the submitted trainee: the id of the trainee the
 * VERIFIED offering actually contains, and nothing else.
 *
 * No name, no group, no phone number, no parent contact and no enrolment record.
 * A create needs to know only that this person may be assigned in this course;
 * every other fact about them would be personal data this operation has no reason
 * to hold.
 */
export interface EligibleExamTrainee {
  readonly studentId: string;
}

/**
 * The payload of the single write.
 *
 * `role` is typed as the single literal `"EXAMINEE"`, so no other value is even
 * expressible at this boundary, and no widening of the input model could smuggle
 * one through. There is no `orderIndex`, no `instructionTopic`, no `discipline`,
 * no `pairingIndex` and no `notes`: the first is the write's own decision and the
 * rest are not written by this slice at all.
 */
export interface NewExamineeAssignment {
  readonly studentId: string;
  readonly role: "EXAMINEE";
  readonly horseName: string;
}

/**
 * What the write reports back: the new assignment id and the order position the
 * SERVER assigned. Never the row, never a timestamp.
 */
export interface CreatedExamAssignmentRecord {
  readonly id: string;
  readonly orderIndex: number;
}

/**
 * The complete injected boundary.
 *
 * Note what is ABSENT and therefore unrepresentable: there is no dependency that
 * can create or upsert a plan or a session, edit or delete anything, reorder
 * anything, write a break, a supervisor or a second role, publish anything, send
 * a notification, resolve a capability, count anything, read a capacity or a
 * timetable, or read another course. The operation is structurally incapable of
 * doing anything but appending one examinee to one already-existing session.
 *
 * The three predicates take `unknown` and return a boolean: this module never
 * inspects, unwraps, logs or echoes a raw error, so no database detail and no
 * submitted value can leak into a result through them.
 */
export interface CreateExamAssignmentDeps {
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
  ): Promise<ResolvedExamPlanForAssignmentCreate | null>;

  /**
   * Verify the submitted session EXISTS UNDER THE GIVEN PLAN, and report the
   * definition-derived facts above.
   *
   * The plan id is the SERVER-RESOLVED one, and there is no variant of this
   * dependency that omits it. `null` means "no such session under this plan" and
   * covers both a session that does not exist and one belonging to another plan —
   * the caller may not learn which.
   */
  findSessionForPlan(
    planId: string,
    sessionId: string,
  ): Promise<VerifiedExamSessionForAssignmentCreate | null>;

  /**
   * Verify the submitted trainee is assignable IN THE VERIFIED OFFERING.
   *
   * The offering id is the boundary's, never the request's, and there is no
   * variant of this dependency that omits it. `null` means "not assignable here"
   * and covers both an unknown trainee and one enrolled in another course.
   */
  findEligibleTrainee(
    verifiedCourseOfferingId: string,
    studentId: string,
  ): Promise<EligibleExamTrainee | null>;

  /**
   * The SINGLE write: append one examinee to the given session, assigning the
   * next order position itself. The session id is the SERVER-VERIFIED one.
   */
  createAssignmentAtNextOrder(
    sessionId: string,
    value: NewExamineeAssignment,
  ): Promise<CreatedExamAssignmentRecord>;

  /** Is this throw "the requested offering does not exist"? */
  isCourseNotFoundError(error: unknown): boolean;

  /** Is this throw "the offering's lifecycle forbids this operation"? */
  isOperationNotAllowedError(error: unknown): boolean;

  /** Is this throw "that trainee is already assigned to that session"? */
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
 * `capacity_exceeded`, `definition_not_found` or `archived` code: the first would
 * hide defects, and the rest describe a limit this operation does not enforce, a
 * lookup it does not perform, or an operation it does not carry out.
 */
export type CreateExamAssignmentRefusalCode =
  | "offering_not_found"
  | "operation_not_allowed"
  | "plan_not_found"
  | "session_not_found"
  | "trainee_not_eligible"
  | "assignment_conflict"
  | "definition_requires_unsupported_fields";

/**
 * A discriminated, JSON-safe, frozen result.
 *
 * THREE arms rather than two, so `issues` EXISTS ONLY on `invalid_input`. A
 * single failure arm with an optional `issues` would be present-but-`undefined`
 * on every other refusal, which breaks the JSON round trip the exam module's
 * results are held to and invites callers to render an empty issue list.
 *
 * The success arm carries the new assignment id and its assigned position, and
 * NOTHING ELSE. Nothing in any arm is a calendar value, Map, Set, BigInt, Error
 * or class instance, and nothing carries a plan id, a course offering id, a
 * session id, a student id, a horse name, an actor id, a timestamp, a raw error,
 * a database detail or any submitted value — a diagnostic must never echo what
 * the client sent back to the client.
 */
export type CreateExamAssignmentResult =
  | {
      readonly ok: true;
      readonly assignmentId: string;
      readonly orderIndex: number;
    }
  | {
      readonly ok: false;
      readonly code: "invalid_input";
      readonly issues: readonly ExamAssignmentWriteInputIssue[];
    }
  | {
      readonly ok: false;
      readonly code: CreateExamAssignmentRefusalCode;
    };

function refuse(code: CreateExamAssignmentRefusalCode): CreateExamAssignmentResult {
  return Object.freeze({ ok: false as const, code });
}

function refuseInput(
  issues: readonly ExamAssignmentWriteInputIssue[],
): CreateExamAssignmentResult {
  return Object.freeze({
    ok: false as const,
    code: "invalid_input" as const,
    // A fresh frozen copy: the result must not alias an array a caller could
    // later mutate, and the sibling core's own issue ORDER is preserved exactly
    // so a form can render diagnostics in a stable sequence.
    issues: Object.freeze([...issues]),
  });
}

function succeed(created: CreatedExamAssignmentRecord): CreateExamAssignmentResult {
  return Object.freeze({
    ok: true as const,
    assignmentId: created.id,
    orderIndex: created.orderIndex,
  });
}

/**
 * Does this definition DEMAND a field this slice cannot supply?
 *
 * FAIL-CLOSED: only a literal `false` counts as "no demand". The declared
 * boundary types the flag as a boolean, and the backing column is a non-null
 * boolean with a default, so nothing else should ever arrive — but if it does,
 * refusing is the safe reading, and treating an unrecognized value as "no
 * requirement" is exactly how an incomplete row gets written.
 */
function demandsUnsupportedField(flag: boolean): boolean {
  return flag !== false;
}

// ===========================================================================
// The orchestration
// ===========================================================================

/**
 * Create exactly ONE stored EXAMINEE assignment under an ALREADY-EXISTING
 * session, in the ALREADY-EXISTING plan of one authorized,
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
export async function createExamAssignmentWithDeps(
  courseOfferingId: string,
  rawInput: unknown,
  deps: CreateExamAssignmentDeps,
): Promise<CreateExamAssignmentResult> {
  // 1. Authorization + exact-offering verification FIRST. Nothing about exams,
  //    plans, sessions, trainees or the submitted input is touched before this
  //    resolves.
  let context: VerifiedExamAssignmentCourseContext;
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

  // 4. No plan means no session to assign anybody to. This slice never creates or
  //    upserts one, and no injected dependency could.
  if (!plan) {
    return refuse("plan_not_found");
  }

  // 5. Only NOW is the submitted input examined, and every rule about it belongs
  //    to the sibling normalizer.
  const normalized = normalizeExamAssignmentCreateInput(rawInput);

  // 6. Invalid input ends the operation with the sibling's diagnostics verbatim.
  //    Neither the session lookup, the trainee lookup nor the write is reached.
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

  // 9. The committed horse rule, consulted with the definition's AUTHORITATIVE
  //    kind and this operation's fixed role. The sibling normalizer already
  //    demands a horse unconditionally, which is strictly stronger for this role,
  //    so this branch is unreachable today. It is kept as the binding to the one
  //    owner of the rule: if either side ever changes, the two cannot silently
  //    disagree, and the failure is a plain diagnostic rather than a row that is
  //    missing a field its definition requires.
  if (
    isHorseRequiredFor(session.definitionKind, ROLE_EXAMINEE) &&
    normalized.value.horseName.length === 0
  ) {
    return refuseInput([makeExamAssignmentWriteInputIssue("EX-ASG-IN-HORSE-REQUIRED")]);
  }

  // 10. PD-1. A definition demanding a lesson topic or a discipline is refused
  //     OUTRIGHT: this slice has no field for either, so the only alternatives
  //     would be a row missing a required value or a silently dropped demand.
  //     PD-2 is the deliberate contrast — `requiresInstructedTrainee` is NOT
  //     consulted here, because the second role is a different row written by a
  //     later operation, and refusing the examinee would make such a block
  //     unbuildable.
  if (
    demandsUnsupportedField(session.requiresLessonTopic) ||
    demandsUnsupportedField(session.requiresDiscipline)
  ) {
    return refuse("definition_requires_unsupported_fields");
  }

  // 11. Eligibility, scoped to the VERIFIED offering. A trainee id from another
  //     course resolves to nothing here.
  const trainee = await deps.findEligibleTrainee(
    context.courseOfferingId,
    normalized.value.studentId,
  );

  // 12. Unknown and foreign are again the same answer, for the same reason.
  if (!trainee) {
    return refuse("trainee_not_eligible");
  }

  // 13. The single write, against the SERVER-VERIFIED session id and the
  //     SERVER-VERIFIED trainee id — not the submitted ones. The role is this
  //     module's constant; the order position is assigned inside the dependency.
  //     A uniqueness violation means that trainee already occupies that session,
  //     which is an ordinary outcome and never a defect.
  let created: CreatedExamAssignmentRecord;
  try {
    created = await deps.createAssignmentAtNextOrder(session.id, {
      studentId: trainee.studentId,
      role: ROLE_EXAMINEE,
      horseName: normalized.value.horseName,
    });
  } catch (error) {
    if (deps.isUniqueConstraintError(error)) {
      return refuse("assignment_conflict");
    }
    throw error;
  }

  // 14. The narrow success DTO: the new assignment id and its assigned position,
  //     nothing else.
  return succeed(created);
}
