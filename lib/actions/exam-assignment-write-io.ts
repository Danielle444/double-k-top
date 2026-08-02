/**
 * EXAM EX-ASG-IO1 — the ADMIN-SCOPED stored ExamAssignment WRITES: the real
 * bindings for CREATE and REMOVAL, and nothing else.
 *
 * SERVER-ONLY BY DECLARATION. `import "server-only"` — the repository
 * convention, already used by the exam read and the sibling exam write bindings
 * in this directory — turns an accidental import from a `"use client"` module
 * into a BUILD ERROR. That matters independently of everything else here: this
 * module binds admin authorization, the course-lifecycle policy and Prisma
 * writes.
 *
 * DELIBERATELY NOT A `"use server"` MODULE. Everything exported from a
 * `"use server"` file becomes a PUBLICLY CALLABLE Server Action with a stable
 * network id — and these WRITE. `createExamAssignment` and
 * `deleteExamAssignment` are ORDINARY server functions. The Server Actions, the
 * route, the page and the admin UI that will eventually call them are a LATER,
 * separately reviewed slice; NOTHING in `app/` or `components/` calls this
 * today, and this slice adds no page, route, form or capability.
 *
 * ===========================================================================
 * DIVISION OF LABOUR
 * ===========================================================================
 * Inside the exam slice (all pure, all DB-free, all already committed):
 *   the assignment input core   — the three submitted fields, the non-blank
 *                                 rule, the unconditional horse rule and the
 *                                 fail-closed no-coercion rule
 *   the create orchestration    — the CREATE order, PD-1, PD-2 and the outcomes
 *   the delete orchestration    — the REMOVAL order and the outcomes
 * And here:
 *   this module — the REAL admin, policy, Prisma and error-classification
 *   bindings, and nothing else.
 *
 * (Those are named WITHOUT a module path on purpose: the committed containment
 * suites forbid a path-shaped reference to an unwired exam core from anywhere
 * outside `lib/exam`, and a comment is source text like any other.)
 *
 * The orchestration is NOT reimplemented here. This file contains no ordering
 * decision, no validation, no policy table, no role decision and no outcome code
 * of its own: it hands each committed pure core its effects and its error
 * classifiers, and returns the core's result unchanged.
 *
 * The admin boundary, the lifecycle gate, the two typed error classifiers and
 * the ExamPlan lookup are each declared ONCE and shared by both operations — so
 * the two can never drift into different trust boundaries.
 *
 * ===========================================================================
 * WHAT THE CALLER MAY SUPPLY
 * ===========================================================================
 * Create: a REQUESTED `courseOfferingId` and a RAW, untrusted input object.
 * Remove: a REQUESTED `courseOfferingId` and a RAW, untrusted assignment id.
 *
 * There is no parameter — and no readable field of either raw value — for a
 * `role`, an `orderIndex`, a `planId`, a `sessionId` chosen outside the plan, an
 * admin id or a transaction handle. Not "ignored": absent from every signature
 * and from every type the committed cores accept, so no future caller can pass
 * one.
 *
 * `role` in particular is never supplied and never derived from input. It stays
 * the single literal the committed create core fixes, and this module's write
 * dependency simply forwards `value.role` — whose TYPE is that one literal, so
 * no other value is expressible at the boundary.
 *
 * The requested offering id is a REQUEST, not a grant: `requireAdminCourseOffering`
 * runs `requireAdmin()` FIRST (redirecting an unauthenticated or non-admin
 * caller) and only then looks up exactly that offering, and ONLY the DB-verified
 * id it returns reaches the ExamPlan query and the eligibility query. The plan id
 * is therefore always server-derived, and every session verification, order
 * aggregate, scoped assignment read and write is scoped by it.
 *
 * ===========================================================================
 * THE COURSE-LIFECYCLE GATE — A TEMPORARY, DELIBERATE REUSE
 * ===========================================================================
 * The gate is the existing `SCHEDULE_DRAFT_CONFIGURATION` operation, which the
 * committed policy allows for PLANNED and ACTIVE offerings and denies for
 * ARCHIVED ones — exactly the required behaviour for configuring an exam plan's
 * assignments, and exactly what the committed exam definition-write and
 * session-write bindings already use, so the three cannot drift into different
 * trust boundaries.
 *
 * This is a reuse of a course-LIFECYCLE classification, NOT of a capability. No
 * new `CourseOfferingOperation` is introduced, the committed policy core is not
 * edited, and NO capability is consulted: there is no `EXAMS` capability (no
 * catalog key, no row, no reader), and no other module's capability is borrowed —
 * an exam write must not silently inherit another module's product decisions, and
 * a placeholder check that always passes reads as enforcement to the next person
 * who edits this file.
 *
 * ===========================================================================
 * ELIGIBILITY IS ONE FAIL-CLOSED STATEMENT
 * ===========================================================================
 * A trainee may be assigned only if the SERVER can see an ACTIVE
 * `CourseEnrollment` for them under the VERIFIED offering AND the trainee is
 * active. Both conditions live in ONE `where` clause, so there is no window
 * between "is she enrolled?" and "is she active?" in which a caller could be
 * granted something neither answer supports, and no application-side comparison
 * a later edit could quietly remove.
 *
 * A `Student.id` belonging to ANOTHER course therefore resolves to `null` and is
 * refused, indistinguishably from an unknown id — the committed core's
 * `trainee_not_eligible`. That is deliberate: a distinguishable answer would turn
 * this write path into an existence oracle over every other course's roster.
 *
 * COMBINED TRAINEES: `isPrimary` is NOT consulted, and is not even selected. A
 * trainee taking two courses has an ACTIVE enrolment in each, and either one
 * makes her assignable in ITS OWN offering. Reading `isPrimary` here would refuse
 * a legitimate combined trainee in her secondary course for no product reason.
 *
 * The statement selects ONE column, `studentId`, and returns only the id the
 * SERVER matched — which is what the committed core forwards to the write. No
 * identity number, enrolment id, group, membership, horse, phone or parent
 * contact is read, because none of them can change the answer and a value this
 * module never reads is a value it cannot leak.
 *
 * ===========================================================================
 * BEGINNER TEACHING PRACTICE IS NEVER WRITTEN HERE
 * ===========================================================================
 * Beginner exam rows are a LIVE PROJECTION of Teaching Practice and are never
 * stored as `ExamAssignment`s. Nothing in this module imports, reads or writes a
 * Teaching-Practice model, a beginner child or a parent contact, and no
 * dependency exposed to the committed cores could reach one. The exclusion is
 * structural, not a rule someone has to remember.
 *
 * ===========================================================================
 * THE ORDER POSITION: MAX + 1, IN ONE TRANSACTION, AND ITS HONEST LIMIT
 * ===========================================================================
 * The create assigns `orderIndex` itself, inside a single interactive
 * transaction: one `aggregate` for the current MAX within the session, then one
 * `create` at MAX + 1 (or 0 for the first row). The aggregate is a MAX and never
 * a COUNT — a count would silently REUSE a position after any removal, putting
 * two people at the same place in the running order.
 *
 * CONCURRENCY LIMITATION, STATED HONESTLY: two concurrent creates for DIFFERENT
 * trainees on the same session may receive the SAME `orderIndex`. The schema
 * declares no unique constraint on `(sessionId, orderIndex)` and an ordinary
 * transaction does not serialize the read-max/insert pair. This is TOLERATED,
 * not prevented, and it is safe because downstream ordering uses the ASSIGNMENT
 * ID as the final tie-break, so equal positions stay stably ordered rather than
 * reshuffling between reads. Nothing here claims uniqueness: no unique index, no
 * `SERIALIZABLE` isolation, no row lock, no retry and no order compaction is
 * added, and adding one would be a separate approved change.
 *
 * (The SAME-trainee case is a different matter entirely, and it IS prevented —
 * by the database's own unique key, classified below.)
 *
 * ===========================================================================
 * THE REMOVAL DELETES EXACTLY THE ROW THE SCOPED READ APPROVED
 * ===========================================================================
 * The target is located with a PLAN-SCOPED `findFirst`, and the `delete` is then
 * issued against the id THAT READ RETURNED — never the raw submitted value. A
 * `deleteMany` is deliberately not used: the target is a primary key, `delete`
 * is the exact-one-row statement for it, and `deleteMany` would silently report
 * "0 removed" where a genuine disappearance should surface.
 *
 * So a `P2025` — the row vanished between the verification and the write —
 * PROPAGATES rather than being laundered into "not found". The caller was not
 * wrong about the row; the world changed underneath them, and a "not found"
 * would misdescribe it.
 *
 * Nothing is reordered or compacted afterwards, no session count is updated, and
 * no application-side cascade is performed. A gap in the order sequence is not a
 * defect: every reader sorts BY the position and never assumes the positions are
 * contiguous.
 *
 * ===========================================================================
 * ADMIN ONLY
 * ===========================================================================
 * There is no instructor and no trainee write path in this module: no actor
 * helper for either role is imported, and the only authorization binding is the
 * admin course-context resolver. An instructor- or trainee-authored assignment
 * would be a different product decision requiring its own review.
 *
 * ===========================================================================
 * NO DATE, NO PUBLICATION, NO NOTIFICATION
 * ===========================================================================
 * Not one statement here reads or writes a calendar value, so this module needs
 * no date helper and carries no timezone decision. The single ExamPlan query
 * selects the plan's id and nothing else, so these operations cannot see,
 * require or change a publication state, and no notification, message or push
 * surface is imported. No grade, score or evaluation exists to write — the Exams
 * area models none.
 */
import "server-only";

import type { CourseOfferingStatus } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  requireAdminCourseOffering,
  CourseOfferingNotFoundError,
} from "@/lib/course/admin-course-context";
import {
  assertCourseOperationAllowed,
  CourseOperationNotPermittedError,
} from "@/lib/course/operation-policy-core";
import {
  createExamAssignmentWithDeps,
  type CreateExamAssignmentResult,
  type CreatedExamAssignmentRecord,
  type EligibleExamTrainee,
  type NewExamineeAssignment,
  type VerifiedExamSessionForAssignmentCreate,
} from "@/lib/exam/create-exam-assignment-core";
import {
  deleteExamAssignmentWithDeps,
  type DeleteExamAssignmentResult,
  type ExistingExamAssignmentForDelete,
} from "@/lib/exam/delete-exam-assignment-core";

export type { CreateExamAssignmentResult } from "@/lib/exam/create-exam-assignment-core";
export type { DeleteExamAssignmentResult } from "@/lib/exam/delete-exam-assignment-core";

// ===========================================================================
// The trust boundary
// ===========================================================================

/**
 * Admin + exact offering.
 *
 * `requireAdmin()` runs inside `requireAdminCourseOffering` BEFORE the offering
 * is looked up, so an unauthenticated caller is redirected rather than told
 * whether an offering id exists. Only `id` and `status` are carried forward: the
 * name, level, ActivityYear and dates of the offering are none of these
 * operations' business, and the RAW requested id is used at this boundary and
 * nowhere else.
 */
async function requireCourseContext(
  requestedCourseOfferingId: string,
): Promise<{ courseOfferingId: string; status: string }> {
  const context = await requireAdminCourseOffering(requestedCourseOfferingId);
  return { courseOfferingId: context.id, status: context.status };
}

/**
 * The lifecycle gate. The cast restores the generated enum that the pure cores
 * deliberately widened to `string`; it is safe because the committed policy is
 * DEFAULT-DENY — an unrecognized status is refused, never allowed.
 */
function assertConfigurationAllowed(status: string): void {
  assertCourseOperationAllowed(
    status as CourseOfferingStatus,
    "SCHEDULE_DRAFT_CONFIGURATION",
  );
}

/** Is this throw the project's typed "that offering does not exist"? */
function isCourseNotFoundError(error: unknown): boolean {
  return error instanceof CourseOfferingNotFoundError;
}

/** Is this throw the committed policy's typed lifecycle denial? */
function isOperationNotAllowedError(error: unknown): boolean {
  return error instanceof CourseOperationNotPermittedError;
}

// ===========================================================================
// The assignment-conflict classifier
// ===========================================================================

/**
 * The ONE remaining unique index over `(sessionId, studentId)` on
 * `exam_assignments`. Named here as a STRING so the classifier can recognize the
 * conflict structurally, without importing a Prisma error class.
 *
 * EX-ASG-MULTIPLICITY renamed and NARROWED it. It is now the hand-written PARTIAL
 * index `UNIQUE ("sessionId", "studentId") WHERE "role" = 'EXAMINEE'`, so its
 * generated name no longer describes it and a stable one is chosen in the
 * migration instead. See prisma/schema.prisma's model comment.
 */
const EXAM_ASSIGNMENT_CONFLICT_INDEX = "exam_assignments_examinee_session_student_key";

/**
 * Recognize the Prisma unique-constraint violation (`P2002`) that means "that
 * trainee is ALREADY an EXAMINEE of that session", and nothing else.
 *
 * This is the ONE reachable, ordinary conflict of the create path: a double
 * submit, or two managers assigning the same person at once. It is classified AT
 * THE WRITE rather than pre-checked by a read, because a read-then-write would
 * reintroduce exactly the race the unique key exists to close.
 *
 * IT IS STILL FULLY REACHABLE HERE, and that is the point of the narrowed key:
 * this slice's role is the fixed literal `EXAMINEE`, the one role the partial
 * predicate still covers, because nobody sits the same session's exam twice. What
 * the narrowing removed is the refusal of a SECOND row in ANOTHER role — one
 * trainee may now be this session's examinee and ALSO an instructed trainee
 * taught by a different examinee of it — and that case never reaches this
 * predicate, because it is no longer a database violation at all.
 *
 * DELIBERATELY NARROW IN BOTH DIRECTIONS:
 *  - a non-object and a `null` are rejected;
 *  - any Prisma code other than `P2002` is rejected;
 *  - the field-array form must name BOTH `sessionId` AND `studentId`. Requiring
 *    both is what makes an unrelated composite key — one that happens to share a
 *    single column name — fail to match, so a future statement violating some
 *    other unique index is never reported to a manager as "already assigned";
 *  - the index-name form must equal the exact index above, not merely contain a
 *    fragment of it. The OLD, dropped index name is deliberately NOT accepted: an
 *    error naming it would mean the migration has not been applied, which is a
 *    deployment fault to surface rather than a manager-facing form error to
 *    absorb;
 *  - a framework redirect carries a `digest` and no `code`, so an unauthenticated
 *    admin's redirect can never be laundered into a form error.
 *
 * WHY THE UNREADABLE-METADATA FALLBACK IS STILL SAFE — and the argument got
 * SIMPLER, not harder, because FEWER distinct constraints can now fire. The bound
 * transaction writes exactly ONE model, `ExamAssignment`, which after
 * EX-ASG-MULTIPLICITY carries exactly TWO unique keys: the primary key — a freshly
 * generated cuid that cannot realistically collide — and the EXAMINEE-only partial
 * index above, which is precisely the key this slice's inserts are subject to. A
 * `P2002` from that transaction whose target cannot be read is therefore this
 * conflict, and there is no third key it could belong to.
 *
 * The offending error is never inspected beyond these two shapes, never
 * unwrapped, never logged and never echoed, so no database detail and no
 * submitted value can leak into a result through it.
 */
function isExamAssignmentConflictError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  if ((error as { code?: unknown }).code !== "P2002") {
    return false;
  }

  const target = (error as { meta?: { target?: unknown } }).meta?.target;

  // Prisma's field-array form, e.g. ["sessionId", "studentId"]. BOTH are
  // required — a target naming only one of them is a different key.
  if (Array.isArray(target)) {
    const tokens = target.filter((entry): entry is string => typeof entry === "string");
    return tokens.includes("sessionId") && tokens.includes("studentId");
  }

  // Prisma's index-name form, matched EXACTLY.
  if (typeof target === "string") {
    return target === EXAM_ASSIGNMENT_CONFLICT_INDEX;
  }

  // Unreadable/absent metadata: attributed to this conflict for the reason
  // documented above.
  return true;
}

// ===========================================================================
// The Prisma bindings
// ===========================================================================

/**
 * The ONLY ExamPlan query in this module: one narrow lookup by the VERIFIED
 * offering id, selecting the id alone. No publication state, no source dates, no
 * sessions, no definitions, no offering relation, no timestamps — and no upsert,
 * because a plan is never created by a write to its contents.
 *
 * `ExamPlan.courseOfferingId` is `@unique`, so `findUnique` here is a single
 * indexed lookup on a key that is already the whole scope; there is nothing a
 * `findFirst` could additionally constrain.
 *
 * Shared by both operations rather than repeated per operation, so no future
 * edit can widen it for one of them alone.
 */
function findExamPlanByCourseOfferingId(
  verifiedCourseOfferingId: string,
): Promise<{ id: string } | null> {
  return prisma.examPlan.findUnique({
    where: { courseOfferingId: verifiedCourseOfferingId },
    select: { id: true },
  });
}

/**
 * Verify the submitted session EXISTS UNDER THE SERVER-RESOLVED PLAN, and report
 * the four DEFINITION-DERIVED facts the committed create core is entitled to act
 * on.
 *
 * `findFirst` with BOTH keys — never `findUnique({ where: { id } })` — so a
 * session of ANOTHER plan reads as `null` rather than being found and then
 * rejected by a comparison someone could later remove. It is the plan scope, not
 * a check, that makes a cross-plan create unreachable, and it is why the pure
 * core can report a foreign session and a missing one identically.
 *
 * The select is EXACTLY the session's id plus four columns of its definition.
 * NOT selected, and therefore not leakable by any later mapper: the assignments
 * relation, any assignment count, the definition's parallel capacity and
 * duration, the session's date, start time, end time, arena, title, notes, order
 * position, publication stamp, every deprecated column the table still carries,
 * and every Teaching-Practice relation. The committed core makes no decision from
 * any of them — the capacity most pointedly of all, which is a PER-WAVE figure
 * and not a maximum, so extra examinees create extra waves rather than a refusal.
 */
async function findSessionForPlan(
  planId: string,
  sessionId: string,
): Promise<VerifiedExamSessionForAssignmentCreate | null> {
  const row = await prisma.examSession.findFirst({
    where: { id: sessionId, planId },
    select: {
      id: true,
      definition: {
        select: {
          kind: true,
          requiresLessonTopic: true,
          requiresDiscipline: true,
          requiresInstructedTrainee: true,
        },
      },
    },
  });

  if (row === null) {
    return null;
  }
  return {
    id: row.id,
    definitionKind: row.definition.kind,
    requiresLessonTopic: row.definition.requiresLessonTopic,
    requiresDiscipline: row.definition.requiresDiscipline,
    requiresInstructedTrainee: row.definition.requiresInstructedTrainee,
  };
}

/**
 * Verify the submitted trainee is assignable IN THE VERIFIED OFFERING — ONE
 * fail-closed statement, as the header explains.
 *
 * `findFirst` and not `findUnique`: the scope is the enrolment's
 * `(courseOfferingId, studentId)` pair PLUS two status conditions, which is not
 * a unique key, and a `findUnique` by student id would find a trainee of another
 * course and then rely on a comparison someone could later remove.
 *
 * ONE column is selected, and the id the SERVER matched — never the submitted
 * one — is what the committed core forwards to the write. `isPrimary` is not
 * read, so a combined trainee stays assignable in every offering she is actively
 * enrolled in.
 */
async function findEligibleTrainee(
  verifiedCourseOfferingId: string,
  studentId: string,
): Promise<EligibleExamTrainee | null> {
  const row = await prisma.courseEnrollment.findFirst({
    where: {
      courseOfferingId: verifiedCourseOfferingId,
      studentId,
      status: "ACTIVE",
      student: { isActive: true },
    },
    select: { studentId: true },
  });

  if (row === null) {
    return null;
  }
  return { studentId: row.studentId };
}

/**
 * Append ONE examinee to ONE already-existing session, assigning the next order
 * position within THAT SESSION inside a single interactive transaction.
 *
 * THE ORDER SCOPE is the session alone, which is the whole relation: an
 * assignment belongs to exactly one session, and a session to exactly one plan.
 *
 * THE AGGREGATE IS A MAX, NEVER A COUNT, and the concurrency limitation is
 * stated honestly in the header rather than papered over: two concurrent creates
 * for different trainees may receive the same position, the schema does not make
 * `(sessionId, orderIndex)` unique, and this is tolerated because downstream
 * ordering breaks the tie on the assignment id. No retry, no lock, no
 * `SERIALIZABLE` isolation, no unique rule and no compaction is introduced.
 *
 * The aggregate and the create run on the SAME transaction client. Only
 * `ExamAssignment` is written: no plan, session, definition, break, supervisor,
 * beginner child or notification, and no second row of any kind.
 *
 * The written columns are EXACTLY the five below. `instructionTopic`,
 * `discipline`, `pairingIndex`, `notes`, `sourcePracticeRole`, `planId` and
 * `courseOfferingId` are absent — and UNREACHABLE, because the committed core's
 * payload has no field for any of them and the last two are not columns of this
 * table at all. `id`, `createdAt` and `updatedAt` are left to the database.
 *
 * `role` is `value.role`, whose TYPE is the single literal the committed core
 * fixes. It is not derived here, not defaulted here and not expressible as
 * anything else.
 */
function createAssignmentAtNextOrder(
  sessionId: string,
  value: NewExamineeAssignment,
): Promise<CreatedExamAssignmentRecord> {
  return prisma.$transaction(async (tx) => {
    const aggregate = await tx.examAssignment.aggregate({
      where: { sessionId },
      _max: { orderIndex: true },
    });

    // 0 for the first assignment of a session; MAX + 1 afterwards. Never
    // caller-supplied, and never a COUNT.
    const nextOrderIndex =
      aggregate._max.orderIndex === null ? 0 : aggregate._max.orderIndex + 1;

    return tx.examAssignment.create({
      data: {
        // The SERVER-VERIFIED session id, from the plan-scoped read.
        sessionId,
        // The SERVER-VERIFIED trainee id, from the eligibility statement.
        studentId: value.studentId,
        // The committed core's fixed role literal.
        role: value.role,
        horseName: value.horseName,
        // ...and the server-assigned position.
        orderIndex: nextOrderIndex,
      },
      // Narrow on purpose: the caller learns the new id and its position, and no
      // stored row, trainee, horse or timestamp ever leaves this function.
      select: { id: true, orderIndex: true },
    });
  });
}

/**
 * Read ONE assignment, scoped by the SERVER-RESOLVED plan through the session
 * relation.
 *
 * `findFirst` with the relation filter — never `findUnique({ where: { id } })` —
 * so an assignment under ANOTHER course's plan reads as `null` rather than being
 * found and then rejected by a comparison someone could later remove. The
 * relation filter is a WHERE condition and not an `include`, so no `ExamSession`
 * row is materialized by it.
 *
 * ONE column is selected. A removal does not need the trainee, the horse, the
 * role, the position or the session, and reading them would put personal data in
 * a place that has no use for it. The id this returns is the ONLY value the
 * delete below may target.
 */
function findAssignmentForPlan(
  planId: string,
  assignmentId: string,
): Promise<ExistingExamAssignmentForDelete | null> {
  return prisma.examAssignment.findFirst({
    where: { id: assignmentId, session: { planId } },
    select: { id: true },
  });
}

/**
 * The SINGLE removal: delete exactly the row whose id the PLAN-SCOPED read
 * returned.
 *
 * `delete` and NOT `deleteMany`: the filter is the primary key, so the statement
 * removes exactly one row or raises `P2025`. That throw PROPAGATES — the
 * committed core classifies nothing at this step — because "the row vanished
 * between the verification and the write" is a genuinely different sentence from
 * "there is no such row", and reporting the second would tell a manager they
 * were wrong when they were not.
 *
 * `select` keeps the statement's payload narrow; the value is deliberately
 * discarded, because the core's success arm reports no id and echoing a
 * server-verified id back would confirm which ids exist.
 *
 * Nothing else is removed, no surviving row is renumbered or compacted, no count
 * is updated and no application-side cascade is performed.
 */
async function deleteAssignmentById(assignmentId: string): Promise<void> {
  await prisma.examAssignment.delete({
    where: { id: assignmentId },
    select: { id: true },
  });
}

// ===========================================================================
// 1. Create
// ===========================================================================

/**
 * Create exactly ONE stored EXAMINEE assignment under an ALREADY-EXISTING
 * session, in the ALREADY-EXISTING plan of one authorized, lifecycle-permitted
 * course offering.
 *
 * Order (the committed pure core's contract, bound here to real effects):
 *   1. `requireAdminCourseOffering(courseOfferingId)` — admin first, then the
 *      exact offering; a redirect for a non-admin caller propagates untouched;
 *   2. `assertCourseOperationAllowed(status, "SCHEDULE_DRAFT_CONFIGURATION")`;
 *   3. ONE `prisma.examPlan.findUnique` on the VERIFIED offering id;
 *   4. no plan -> the core's plan refusal (never an upsert);
 *   5. the committed input normalizer;
 *   6. invalid -> the core's input refusal, with NO session query, NO trainee
 *      query and NO write;
 *   7. ONE plan-scoped session read; missing or foreign -> the same refusal, and
 *      NO write;
 *   8. the committed horse rule against the definition's AUTHORITATIVE kind;
 *   9. PD-1 — a definition demanding a lesson topic or a discipline is refused
 *      outright and NOTHING is written; PD-2 — `requiresInstructedTrainee` does
 *      NOT block the examinee row, because the second role is a different row
 *      written by a later operation;
 *  10. ONE offering-scoped eligibility read; not eligible -> refusal, NO write;
 *  11. ONE transaction: one MAX aggregate + one create.
 *
 * Only three failures are classified — the offering not-found, the lifecycle
 * denial and the assignment conflict. Every other error propagates unchanged, so
 * a real defect is never laundered into a form error, and the authorization
 * redirect is never swallowed: neither `instanceof` check matches a
 * `NEXT_REDIRECT` throw, and the conflict classifier requires a `P2002` code that
 * a redirect does not carry.
 */
export async function createExamAssignment(
  courseOfferingId: string,
  rawInput: unknown,
): Promise<CreateExamAssignmentResult> {
  return createExamAssignmentWithDeps(courseOfferingId, rawInput, {
    requireCourseContext,
    assertConfigurationAllowed,
    findExamPlanByCourseOfferingId,
    findSessionForPlan,
    findEligibleTrainee,
    createAssignmentAtNextOrder,
    isCourseNotFoundError,
    isOperationNotAllowedError,
    isUniqueConstraintError: isExamAssignmentConflictError,
  });
}

// ===========================================================================
// 2. Removal
// ===========================================================================

/**
 * Remove exactly ONE stored ExamAssignment from the plan of one authorized,
 * lifecycle-permitted course offering.
 *
 * Order (the committed pure core's contract, bound here to real effects):
 *   1. admin + exact offering;
 *   2. the lifecycle gate on the VERIFIED status;
 *   3. ONE `prisma.examPlan.findUnique` on the VERIFIED offering id;
 *   4. no plan -> the core's plan refusal;
 *   5. the target id is normalized; a malformed one refuses with NO query;
 *   6. ONE plan-scoped `findFirst`; missing or foreign -> the same refusal;
 *   7. ONE `delete` against the id THAT READ RETURNED.
 *
 * This is a HARD delete of ONE row. There is no archive column, this slice adds
 * none, and no schema is changed. No version token is required, and that is a
 * decision rather than an omission: assignments are immutable in this slice, a
 * surviving id still identifies the same row, and a row somebody else already
 * removed is reported honestly as not found by the scoped read. The committed
 * core documents that the moment an assignment UPDATE flow exists, that flow
 * will need its own stale-write protection.
 *
 * Only two failures are classified — the offering not-found and the lifecycle
 * denial. Every other error propagates unchanged, including the `P2025` of a row
 * that disappeared mid-operation and the authorization redirect.
 */
export async function deleteExamAssignment(
  courseOfferingId: string,
  assignmentId: unknown,
): Promise<DeleteExamAssignmentResult> {
  return deleteExamAssignmentWithDeps(courseOfferingId, assignmentId, {
    requireCourseContext,
    assertConfigurationAllowed,
    findExamPlanByCourseOfferingId,
    findAssignmentForPlan,
    deleteAssignmentById,
    isCourseNotFoundError,
    isOperationNotAllowedError,
  });
}
