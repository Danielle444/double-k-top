/**
 * EXAM EX-ASG-IT1 — the PURE orchestration of ONE stored INSTRUCTED_TRAINEE
 * assignment CREATE.
 *
 * PURE by construction: no Prisma, no DB, no transaction, no clock, no
 * randomness, no env, no auth/session/cookie, no capability, no filesystem, no
 * network, no Next, no `server-only`, no `"use server"`. Every effect this
 * operation needs arrives through the injected
 * `CreateExamInstructedTraineeAssignmentDeps`, so the ORDER in which
 * authorization, lifecycle gating, plan resolution, input validation, session
 * verification, definition verification, eligibility verification and the write
 * happen is stated once, here, and is testable without a database.
 *
 * WHAT THIS ANSWERS (and only this):
 *  - in which EXACT order must an INSTRUCTED_TRAINEE assignment create authorize,
 *    gate, resolve, validate, verify and write?
 *  - and which stable, non-echoing outcome describes each way it can fail?
 *
 * WHAT THIS DELIBERATELY DOES NOT DO:
 *  - it OWNS NO POLICY TABLE. Which offering statuses may be configured is the
 *    committed course operation policy's decision, reached through
 *    `assertConfigurationAllowed`;
 *  - it CREATES NO PLAN and NO SESSION. An assignment may be created only under a
 *    session that ALREADY EXISTS, under a plan that ALREADY EXISTS. There is no
 *    dependency capable of creating either, so lazy creation is not merely
 *    unimplemented — it is unrepresentable;
 *  - it PERFORMS NO IO and knows nothing of a transaction client, a row or a
 *    query. `createAssignmentAtNextOrder` is an opaque promise;
 *  - it DERIVES NOTHING. No wave layout, no personal slot, no end time, no break,
 *    no conflict and no timetable is computed, and none is an input;
 *  - it does NOT edit, delete, reorder or publish anything, it writes no session,
 *    break or supervisor, and it sends no notification. Those are other slices,
 *    and no dependency here could reach one.
 *
 * ===========================================================================
 * THE CALLER SUPPLIES A REQUEST, NEVER A GRANT
 * ===========================================================================
 * The only two arguments are a REQUESTED `courseOfferingId` and a RAW, untrusted
 * input object. There is no parameter — and no readable field of the raw object —
 * through which a caller could supply a `role`, an `orderIndex`, a `planId`, a
 * `pairingIndex`, an actor id or a transaction handle.
 *
 * `planId` is derived SERVER-SIDE from the DB-verified offering id that
 * `requireCourseContext` returned, never from the request. The requested id is
 * used for exactly one thing — asking the course boundary to verify it — and is
 * never read again afterwards, so a caller cannot steer the plan lookup at one
 * offering while being authorized for another.
 *
 * `role` is HARDCODED to `INSTRUCTED_TRAINEE` inside this module and is typed as
 * that single literal all the way into the write dependency. It is not a
 * parameter, not a field of any input type, and not a value any caller can
 * influence. This slice creates instructed trainees and nothing else.
 *
 * ===========================================================================
 * EXACTLY TWO SUBMITTED FIELDS, AND NO HORSE
 * ===========================================================================
 * A submission carries EXACTLY `sessionId` and `studentId`. Nothing else is
 * sought — not `role`, not `orderIndex`, not `pairingIndex`, not `planId`, not
 * `definitionId`, not `courseOfferingId`, not `instructionTopic`, not
 * `discipline` and not `notes` — so none of them can enter a payload, not because
 * it is stripped, but because it is never read.
 *
 * `horseName` is deliberately among them. An INSTRUCTED TRAINEE is the person
 * BEING INSTRUCTED in an advanced-instruction block; the horse is the examinee's
 * concern, not theirs. This slice therefore does not accept, normalize, default
 * or write a horse name, and there is no field of any type here through which one
 * could arrive.
 *
 * That is why this module normalizes its own two fields rather than calling the
 * shared create normalizer: that normalizer demands a horse UNCONDITIONALLY, and
 * a horse is exactly what this role must not carry. What IS shared — and shared
 * on purpose, so the Hebrew text cannot drift into a second copy — is the issue
 * factory and its two existing codes. No new code is added to the shared module.
 *
 * ===========================================================================
 * THE LOCKED ORDER, AND WHY EACH STEP PRECEDES THE NEXT
 * ===========================================================================
 *   1. requireCourseContext(requested id)     — admin + exact-offering boundary
 *   2. assertConfigurationAllowed(status)      — course-lifecycle gate
 *   3. findExamPlanByCourseOfferingId(id)      — VERIFIED id only
 *   4. no plan                                 -> plan_not_found
 *   5. normalize the raw input                 — the two fields, trimmed
 *   6. invalid                                 -> invalid_input + stable issues
 *   7. findSessionForPlan(plan.id, sessionId)  — PLAN-SCOPED verification
 *   8. no session                              -> session_not_found
 *   9. the definition must REQUIRE this role   -> otherwise refuse, query nothing
 *  10. findEligibleTrainee(verified offering)  — OFFERING-SCOPED verification
 *  11. not eligible                            -> trainee_not_eligible
 *  12. createAssignmentAtNextOrder(session.id) — the single write
 *  13. narrow success DTO
 *
 * The consequences are the point:
 *  - NOTHING is validated for a course the actor may not access, so validation
 *    diagnostics can never be used as an oracle over another course;
 *  - NO plan lookup happens before authorization, so the existence of a plan
 *    cannot be probed by an unauthorized caller;
 *  - NO session lookup happens for an invalid submission, so a malformed request
 *    cannot be used to probe which session ids exist;
 *  - NO trainee lookup happens for an unknown session or a definition that does
 *    not want this role, so the roster cannot be probed through a failed create;
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
 * cross-plan create is unreachable rather than merely rejected.
 *
 * The same holds for the trainee: `findEligibleTrainee` is asked under the
 * VERIFIED offering id, so a `Student.id` from another course resolves to `null`
 * and is refused as `trainee_not_eligible`. The eligible id the dependency
 * returns — not the submitted one — is what reaches the write.
 *
 * ===========================================================================
 * THE DEFINITION MUST ACTUALLY WANT THIS ROLE
 * ===========================================================================
 * The write is permitted ONLY when the session's definition declares
 * `requiresInstructedTrainee === true`. A definition that does not ask for a
 * second person has no place for one, and a row created under it would be an
 * assignment the definition itself cannot explain.
 *
 * The check FAILS CLOSED: anything that is not literally `true` refuses. `false`,
 * `null`, `undefined` and any defensive value a future binding might produce are
 * all read as "this definition does not want an instructed trainee", because the
 * permissive reading is precisely the one that would persist a row nobody asked
 * for.
 *
 * `requiresLessonTopic` and `requiresDiscipline` are NOT consulted and are not
 * even modelled here. Those flags describe demands on the EXAMINEE's assignment —
 * what the examinee must teach, and in which discipline — and an instructed
 * trainee carries neither field. Refusing this role because the examinee's row
 * needs a topic would block exactly the blocks this role exists to complete. The
 * definition's kind is likewise not modelled: `requiresInstructedTrainee` is the
 * one authoritative statement about whether this role belongs, and a second,
 * kind-shaped opinion here could only drift away from it.
 *
 * ===========================================================================
 * MORE THAN ONE INSTRUCTED TRAINEE IS ALLOWED; THE SAME PERSON TWICE IS NOT
 * ===========================================================================
 * A session may hold SEVERAL instructed trainees, provided they are different
 * students. There is no maximum-one rule here, no pre-check that counts existing
 * rows, and no dependency capable of performing one — a count-then-write would be
 * both a product invention and a race.
 *
 * What IS prevented is the same student appearing twice in one session, and it is
 * prevented by the database's own unique key over `(sessionId, studentId)`.
 *
 * `assignment_conflict` therefore means: the Student ALREADY HAS AN ASSIGNMENT IN
 * THIS SESSION, REGARDLESS OF ROLE. That deliberately INCLUDES the case where
 * they are already the EXAMINEE of the very same session — a person cannot both
 * sit the exam and be taught in it. The unique key is ROLE-BLIND on purpose, and
 * so is this refusal: the code does not say which role the existing row holds, and
 * must not, because that would turn a failed create into a read of another row.
 *
 * ===========================================================================
 * KNOWN LIMITATION: THIS SLICE WRITES NO `pairingIndex`
 * ===========================================================================
 * `pairingIndex` is what pairs an instructed trainee with ONE specific examinee
 * inside a session, and this slice does not write it. It is not an input, not a
 * field of any type here, and no dependency exposes one.
 *
 * The consequence, stated honestly rather than discovered later:
 *  - for a session with EXACTLY ONE examinee, the existing projection logic has
 *    only one candidate to pair with and may still infer the instructed trainee's
 *    slot and personal time;
 *  - for a session with MULTIPLE examinees, there is nothing to say WHICH one this
 *    trainee accompanies. Such a trainee may therefore receive NO derived personal
 *    time and may be EXCLUDED from slot-grained conflict checks.
 *
 * That is an accepted temporary limitation of this slice, not a defect of the
 * projection. Pairing is a separate future slice, and guessing a pairing here —
 * "the first examinee", say — would silently produce a schedule nobody authored.
 *
 * `orderIndex` is still allocated (MAX + 1, inside the write dependency) so the
 * row has a stable storage and display position. It does NOT define examinee wave
 * ordering for this role, and nothing here reads it back.
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
  type ExamAssignmentWriteInputIssue,
} from "./exam-assignment-write-core";
// TYPE-ONLY, and erased at compile time, so the module's purity is unaffected:
// it exists solely so the fixed role below is checked against the committed role
// vocabulary rather than being a stale string literal of its own.
import type { ExamAssignmentRole } from "./exam-domain-core";

export type { ExamAssignmentWriteInputIssue } from "./exam-assignment-write-core";

/**
 * The ONLY role this slice writes, fixed here and never derived from input.
 *
 * Typed as the committed union member so a future rename of the role vocabulary
 * cannot leave a stale string literal behind in this file.
 */
const ROLE_INSTRUCTED_TRAINEE = "INSTRUCTED_TRAINEE" satisfies ExamAssignmentRole;

// ===========================================================================
// The submitted input
// ===========================================================================

/**
 * The normalized CREATE payload — exactly the two submitted fields, both plain
 * non-blank strings and never `null` or `undefined`, so the shape is stable,
 * JSON-round-trippable and unambiguous to a writer.
 *
 * Note what is absent: no `horseName`, no `role`, no `orderIndex`, no
 * `pairingIndex`, no `planId`, no `courseOfferingId`, no `definitionId`, no
 * `instructionTopic`, no `discipline` and no `notes`.
 */
export interface NormalizedExamInstructedTraineeAssignmentCreate {
  readonly sessionId: string;
  readonly studentId: string;
}

/**
 * Read one OWN property of a raw value, or `undefined`.
 *
 * Own-property only: a raw object inherits `toString`, `constructor` and friends
 * from its prototype, and reading those as if the client had sent them would turn
 * prototype members into submitted data.
 *
 * A non-object `source` — `null`, `undefined`, a string, a number, an array, a
 * function, a Symbol — is not a special case: every field simply reads as absent,
 * and the ordinary diagnostics then explain what is missing.
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
 * object, a function, a Symbol, a file-like upload value — and a string that is
 * empty or whitespace-only.
 *
 * NO COERCION AND NO PROBING. The value's own `toString`, `name`, `valueOf` or
 * any other member is never read, so a file-like object cannot contribute a
 * filename to the database through this path. There is no `String(...)` anywhere
 * in this module, because one would happily store `"[object Object]"` as an id.
 *
 * Every accepted string is preserved BYTE-FOR-BYTE except for `trim()`: no
 * `normalize()`, no `toLowerCase()` and no locale-aware comparison, so the two
 * opaque ids keep their exact case.
 */
function normalizeRequiredText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Normalize and validate the RAW submission: EXACTLY `sessionId` and
 * `studentId`.
 *
 * EVERY applicable issue is reported, not only the first, and the ORDER is FIXED
 * — session, then student — so a form can render diagnostics in a stable sequence
 * regardless of the raw object's key order.
 *
 * Never throws, and never mutates `rawInput`; a frozen raw object is fine.
 */
function normalizeInput(
  rawInput: unknown,
):
  | { readonly ok: true; readonly value: NormalizedExamInstructedTraineeAssignmentCreate }
  | { readonly ok: false; readonly issues: readonly ExamAssignmentWriteInputIssue[] } {
  const issues: ExamAssignmentWriteInputIssue[] = [];

  const sessionId = normalizeRequiredText(readField(rawInput, "sessionId"));
  if (sessionId === null) {
    issues.push(makeExamAssignmentWriteInputIssue("EX-ASG-IN-SESSION-REQUIRED"));
  }

  const studentId = normalizeRequiredText(readField(rawInput, "studentId"));
  if (studentId === null) {
    issues.push(makeExamAssignmentWriteInputIssue("EX-ASG-IN-STUDENT-REQUIRED"));
  }

  if (issues.length > 0) {
    return Object.freeze({ ok: false as const, issues: Object.freeze([...issues]) });
  }

  // Reached ONLY when both fields validated, which is what proves the two
  // narrowing assertions below. They restate that proof for the type system and
  // widen nothing at runtime.
  return Object.freeze({
    ok: true as const,
    value: Object.freeze({
      sessionId: sessionId as string,
      studentId: studentId as string,
    }),
  });
}

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
export interface VerifiedExamInstructedTraineeCourseContext {
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
export interface ResolvedExamPlanForInstructedTraineeCreate {
  readonly id: string;
}

/**
 * The verification result for the submitted session: its id, and the ONE
 * definition-derived fact this operation is entitled to act on.
 *
 * Deliberately NOT the session row and NOT the definition row. There is no date,
 * no start time, no title, no order position, no capacity, no duration, no kind,
 * no `requiresLessonTopic`, no `requiresDiscipline` and no assignment list — a
 * field this module cannot read is a decision it cannot quietly start making, and
 * a name echoed into a diagnostic would leak another course's configuration if
 * the scoping ever regressed.
 *
 * The flag is typed to admit `null` and `undefined` so the FAIL-CLOSED reading is
 * expressible rather than merely asserted: a future binding that cannot produce a
 * real boolean must refuse, not proceed.
 */
export interface VerifiedExamSessionForInstructedTraineeCreate {
  readonly id: string;
  readonly requiresInstructedTrainee: boolean | null | undefined;
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
export interface EligibleExamInstructedTrainee {
  readonly studentId: string;
}

/**
 * The payload of the single write.
 *
 * `role` is typed as the single literal `"INSTRUCTED_TRAINEE"`, so no other value
 * is even expressible at this boundary, and no widening of the input model could
 * smuggle one through.
 *
 * There is no `horseName` (this role carries none), no `orderIndex` (the write's
 * own decision), and no `pairingIndex`, `instructionTopic`, `discipline` or
 * `notes` — the first is a future slice and the rest are not written by this
 * slice at all.
 */
export interface NewInstructedTraineeAssignment {
  readonly studentId: string;
  readonly role: "INSTRUCTED_TRAINEE";
}

/**
 * What the write reports back: the new assignment id and the order position the
 * SERVER assigned. Never the row, never a timestamp.
 */
export interface CreatedExamInstructedTraineeAssignmentRecord {
  readonly id: string;
  readonly orderIndex: number;
}

/**
 * The complete injected boundary.
 *
 * Note what is ABSENT and therefore unrepresentable: there is no dependency that
 * can create or upsert a plan or a session, edit or delete anything, reorder
 * anything, count existing assignments, write a break, a supervisor or a horse,
 * publish anything, send a notification, resolve a capability, read a capacity or
 * a timetable, or read another course. The operation is structurally incapable of
 * doing anything but appending one instructed trainee to one already-existing
 * session.
 *
 * The three predicates take `unknown` and return a boolean: this module never
 * inspects, unwraps, logs or echoes a raw error, so no database detail and no
 * submitted value can leak into a result through them.
 */
export interface CreateExamInstructedTraineeAssignmentDeps {
  /**
   * Authorize the actor and verify the REQUESTED offering exists. May throw the
   * project's typed not-found, and may REDIRECT for an unauthenticated or
   * non-admin caller — the redirect must reach the framework untouched.
   */
  readonly requireCourseContext: (
    requestedCourseOfferingId: string,
  ) => Promise<VerifiedExamInstructedTraineeCourseContext>;

  /** Gate the mutation on the VERIFIED offering status. Throws to deny. */
  readonly assertConfigurationAllowed: (status: string) => void;

  /** Find the plan of the VERIFIED offering. `null` means "no plan exists". */
  readonly findExamPlanByCourseOfferingId: (
    verifiedCourseOfferingId: string,
  ) => Promise<ResolvedExamPlanForInstructedTraineeCreate | null>;

  /**
   * Verify the submitted session EXISTS UNDER THE GIVEN PLAN, and report whether
   * its definition requires an instructed trainee.
   *
   * The plan id is the SERVER-RESOLVED one, and there is no variant of this
   * dependency that omits it. `null` means "no such session under this plan" and
   * covers both a session that does not exist and one belonging to another plan —
   * the caller may not learn which.
   */
  readonly findSessionForPlan: (
    planId: string,
    sessionId: string,
  ) => Promise<VerifiedExamSessionForInstructedTraineeCreate | null>;

  /**
   * Verify the submitted trainee is assignable IN THE VERIFIED OFFERING.
   *
   * The offering id is the boundary's, never the request's, and there is no
   * variant of this dependency that omits it. `null` means "not assignable here"
   * and covers both an unknown trainee and one enrolled in another course.
   */
  readonly findEligibleTrainee: (
    verifiedCourseOfferingId: string,
    studentId: string,
  ) => Promise<EligibleExamInstructedTrainee | null>;

  /**
   * The SINGLE write: append one instructed trainee to the given session,
   * assigning the next order position itself. The session id is the
   * SERVER-VERIFIED one.
   */
  readonly createAssignmentAtNextOrder: (
    sessionId: string,
    value: NewInstructedTraineeAssignment,
  ) => Promise<CreatedExamInstructedTraineeAssignmentRecord>;

  /** Is this throw "the requested offering does not exist"? */
  readonly isCourseNotFoundError: (error: unknown) => boolean;

  /** Is this throw "the offering's lifecycle forbids this operation"? */
  readonly isOperationNotAllowedError: (error: unknown) => boolean;

  /**
   * Is this throw "that student already has an assignment in that session"?
   *
   * ROLE-BLIND, exactly like the database key it recognizes — see the header.
   */
  readonly isUniqueConstraintError: (error: unknown) => boolean;
}

// ===========================================================================
// The result model
// ===========================================================================

/**
 * The failure codes that need no diagnostics: each is fully described by the code
 * itself.
 *
 * There is deliberately no `unexpected`, `already_instructed`,
 * `session_has_instructed_trainee`, `capacity_exceeded` or `archived` code: the
 * first would hide defects, and the rest describe a limit this operation does not
 * enforce or an operation it does not carry out.
 *
 * `assignment_conflict` is deliberately SILENT about which role the existing row
 * holds — see the header.
 */
export type CreateExamInstructedTraineeAssignmentRefusalCode =
  | "offering_not_found"
  | "operation_not_allowed"
  | "plan_not_found"
  | "session_not_found"
  | "definition_does_not_require_instructed_trainee"
  | "trainee_not_eligible"
  | "assignment_conflict";

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
 * session id, a student id, an actor id, a timestamp, a raw error, a database
 * detail or any submitted value — a diagnostic must never echo what the client
 * sent back to the client.
 */
export type CreateExamInstructedTraineeAssignmentResult =
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
      readonly code: CreateExamInstructedTraineeAssignmentRefusalCode;
    };

function refuse(
  code: CreateExamInstructedTraineeAssignmentRefusalCode,
): CreateExamInstructedTraineeAssignmentResult {
  return Object.freeze({ ok: false as const, code });
}

function refuseInput(
  issues: readonly ExamAssignmentWriteInputIssue[],
): CreateExamInstructedTraineeAssignmentResult {
  return Object.freeze({
    ok: false as const,
    code: "invalid_input" as const,
    // A fresh frozen copy: the result must not alias an array a caller could
    // later mutate, and the issue ORDER is preserved exactly so a form can render
    // diagnostics in a stable sequence.
    issues: Object.freeze([...issues]),
  });
}

function succeed(
  created: CreatedExamInstructedTraineeAssignmentRecord,
): CreateExamInstructedTraineeAssignmentResult {
  return Object.freeze({
    ok: true as const,
    assignmentId: created.id,
    orderIndex: created.orderIndex,
  });
}

// ===========================================================================
// The orchestration
// ===========================================================================

/**
 * Create exactly ONE stored INSTRUCTED_TRAINEE assignment under an
 * ALREADY-EXISTING session, in the ALREADY-EXISTING plan of one authorized,
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
export async function createExamInstructedTraineeAssignmentWithDeps(
  courseOfferingId: string,
  rawInput: unknown,
  deps: CreateExamInstructedTraineeAssignmentDeps,
): Promise<CreateExamInstructedTraineeAssignmentResult> {
  // 1. Authorization + exact-offering verification FIRST. Nothing about exams,
  //    plans, sessions, trainees or the submitted input is touched before this
  //    resolves.
  let context: VerifiedExamInstructedTraineeCourseContext;
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

  // 5. Only NOW is the submitted input examined: exactly two fields, trimmed.
  const normalized = normalizeInput(rawInput);

  // 6. Invalid input ends the operation with every applicable diagnostic. Neither
  //    the session lookup, the trainee lookup nor the write is reached.
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

  // 9. The definition must ACTUALLY REQUIRE this role. FAIL-CLOSED: anything that
  //    is not literally `true` refuses, and the refusal happens BEFORE the roster
  //    is touched, so a definition that does not want a second person cannot be
  //    used to probe who is enrolled. `requiresLessonTopic`, `requiresDiscipline`
  //    and the definition's kind are deliberately neither modelled nor consulted —
  //    see the header.
  if (session.requiresInstructedTrainee !== true) {
    return refuse("definition_does_not_require_instructed_trainee");
  }

  // 10. Eligibility, scoped to the VERIFIED offering. A trainee id from another
  //     course resolves to nothing here.
  const trainee = await deps.findEligibleTrainee(
    context.courseOfferingId,
    normalized.value.studentId,
  );

  // 11. Unknown and foreign are again the same answer, for the same reason.
  if (!trainee) {
    return refuse("trainee_not_eligible");
  }

  // 12. The single write, against the SERVER-VERIFIED session id and the
  //     SERVER-VERIFIED trainee id — not the submitted ones. The role is this
  //     module's constant; the order position is assigned inside the dependency.
  //     A uniqueness violation means that student already occupies that session in
  //     SOME role, which is an ordinary outcome and never a defect.
  let created: CreatedExamInstructedTraineeAssignmentRecord;
  try {
    created = await deps.createAssignmentAtNextOrder(session.id, {
      studentId: trainee.studentId,
      role: ROLE_INSTRUCTED_TRAINEE,
    });
  } catch (error) {
    if (deps.isUniqueConstraintError(error)) {
      return refuse("assignment_conflict");
    }
    throw error;
  }

  // 13. The narrow success DTO: the new assignment id and its assigned position,
  //     nothing else.
  return succeed(created);
}
