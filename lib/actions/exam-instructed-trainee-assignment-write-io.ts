/**
 * EXAM EX-ASG-IT1 — the ADMIN-SCOPED stored INSTRUCTED_TRAINEE assignment CREATE:
 * the real binding, and nothing else.
 *
 * SERVER-ONLY BY DECLARATION. `import "server-only"` — the repository
 * convention, already used by the exam read and the sibling exam write bindings
 * in this directory — turns an accidental import from a `"use client"` module
 * into a BUILD ERROR. That matters independently of everything else here: this
 * module binds admin authorization, the course-lifecycle policy and a Prisma
 * write.
 *
 * DELIBERATELY NOT A `"use server"` MODULE. Everything exported from a
 * `"use server"` file becomes a PUBLICLY CALLABLE Server Action with a stable
 * network id — and this WRITES. The exported function is an ORDINARY server
 * function. The Server Action, the route, the page and the admin UI that will
 * eventually call it are a LATER, separately reviewed slice; NOTHING anywhere
 * calls this today, and this slice adds no page, route, form, component or
 * capability.
 *
 * ===========================================================================
 * DIVISION OF LABOUR
 * ===========================================================================
 * In the exam slice (pure, DB-free): the CREATE order, the two submitted fields,
 * the fixed role, the fail-closed definition gate, the role-blind conflict
 * meaning and every outcome code.
 *
 * And here: the REAL admin, policy, Prisma and error-classification bindings, and
 * nothing else.
 *
 * (That core is named WITHOUT a module path in this prose on purpose: the
 * committed containment suites forbid a path-shaped reference to an unwired exam
 * core from anywhere outside `lib/exam`, and a comment is source text like any
 * other. The import statement below is the single, unavoidable exception.)
 *
 * The orchestration is NOT reimplemented here. This file contains no ordering
 * decision, no validation, no policy table, no role decision and no outcome code
 * of its own: it hands the pure core its effects and its error classifiers, and
 * returns the core's result unchanged.
 *
 * ===========================================================================
 * WHAT THE CALLER MAY SUPPLY
 * ===========================================================================
 * A REQUESTED `courseOfferingId` and a RAW, untrusted input object, from which
 * the pure core reads EXACTLY `sessionId` and `studentId`.
 *
 * There is no parameter — and no readable field of the raw value — for a `role`,
 * a `horseName`, an `orderIndex`, a `pairingIndex`, a `planId`, an admin id or a
 * transaction handle. Not "ignored": absent from the signature and from every
 * type the pure core accepts, so no future caller can pass one.
 *
 * `role` in particular is never supplied and never derived from input. It stays
 * the single literal the pure core fixes, and this module's write dependency
 * simply forwards `value.role` — whose TYPE is that one literal, so no other
 * value is expressible at the boundary.
 *
 * `horseName` is not written and cannot be: this role carries no horse, the pure
 * core's payload has no field for one, and the create statement below names no
 * such column.
 *
 * The requested offering id is a REQUEST, not a grant: `requireAdminCourseOffering`
 * runs `requireAdmin()` FIRST (redirecting an unauthenticated or non-admin
 * caller) and only then looks up exactly that offering, and ONLY the DB-verified
 * id it returns reaches the ExamPlan query and the eligibility query. The plan id
 * is therefore always server-derived, and the session verification, the order
 * aggregate and the write are scoped by it.
 *
 * ===========================================================================
 * THE COURSE-LIFECYCLE GATE — A TEMPORARY, DELIBERATE REUSE
 * ===========================================================================
 * The gate is the existing `SCHEDULE_DRAFT_CONFIGURATION` operation, which the
 * committed policy allows for PLANNED and ACTIVE offerings and denies for
 * ARCHIVED ones — exactly the required behaviour for configuring an exam plan's
 * assignments, and exactly what the committed exam definition-write,
 * session-write and assignment-write bindings already use, so they cannot drift
 * into different trust boundaries. The policy table is consulted, never copied.
 *
 * This is a reuse of a course-LIFECYCLE classification, NOT of a capability. No
 * new `CourseOfferingOperation` is introduced, the committed policy core is not
 * edited, and NO capability is consulted: there is no EXAMS capability (no
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
 * granted something neither answer supports, and no application-side comparison a
 * later edit could quietly remove.
 *
 * A `Student.id` belonging to ANOTHER course therefore resolves to `null` and is
 * refused, indistinguishably from an unknown id — the pure core's
 * `trainee_not_eligible`. That is deliberate: a distinguishable answer would turn
 * this write path into an existence oracle over every other course's roster.
 *
 * COMBINED TRAINEES: `isPrimary` is NOT consulted, and is not even selected. A
 * trainee taking two courses has an ACTIVE enrolment in each, and either one
 * makes her assignable in ITS OWN offering. Reading `isPrimary` here would refuse
 * a legitimate combined trainee in her secondary course for no product reason.
 *
 * The statement selects ONE column, `studentId`, and returns only the id the
 * SERVER matched — which is what the pure core forwards to the write. No identity
 * number, enrolment id, group, membership, horse, phone or parent contact is
 * read, because none of them can change the answer and a value this module never
 * reads is a value it cannot leak. There is NO direct `Student` query: the
 * enrolment IS the scope, and querying the student table directly would answer a
 * question about a person rather than about this course.
 *
 * ===========================================================================
 * BEGINNER TEACHING PRACTICE IS NEVER WRITTEN HERE
 * ===========================================================================
 * Beginner exam rows are a LIVE PROJECTION of Teaching Practice and are never
 * stored as `ExamAssignment`s. Nothing in this module imports, reads or writes a
 * Teaching-Practice model, a beginner child or a parent contact, and no
 * dependency exposed to the pure core could reach one. The exclusion is
 * structural, not a rule someone has to remember.
 *
 * ===========================================================================
 * THE ORDER POSITION: MAX + 1, IN ONE TRANSACTION, AND ITS HONEST LIMIT
 * ===========================================================================
 * The create assigns `orderIndex` itself, inside a single interactive
 * transaction: one `aggregate` for the current MAX within the session, then one
 * `create` at MAX + 1 (or 0 for the first row). The aggregate is a MAX and never
 * a COUNT — a count would silently REUSE a position after any removal, putting
 * two people at the same place in the stored order.
 *
 * CONCURRENCY LIMITATION, STATED HONESTLY: two concurrent creates on the same
 * session may calculate the SAME `orderIndex`. The schema declares no unique
 * constraint on `(sessionId, orderIndex)` and an ordinary transaction does not
 * serialize the read-max/insert pair.
 *
 * This is TOLERATED, not prevented, and it is safe here for three reasons:
 *  - `orderIndex` is not a uniqueness key, so equal values violate nothing;
 *  - this role's downstream projection does not use `orderIndex` to order
 *    examinee waves — an instructed trainee is not a wave participant;
 *  - the assignment ID remains the deterministic tie-break, so equal positions
 *    stay stably ordered rather than reshuffling between reads.
 *
 * Nothing here claims uniqueness: no unique index, no `SERIALIZABLE` isolation,
 * no row lock, no advisory lock, no retry, no count-based allocation and no order
 * compaction is added, and adding one would be a separate approved change.
 *
 * (The SAME-student case is a different matter entirely, and it IS prevented — by
 * the database's own unique key, classified below.)
 *
 * ===========================================================================
 * NO PRE-CHECK, AND NO MAXIMUM-ONE RULE
 * ===========================================================================
 * A session may hold SEVERAL instructed trainees, provided they are different
 * students. There is deliberately no "does this session already have one?" read,
 * no count and no maximum-one refusal — that would be a product invention, and a
 * read-then-write would reintroduce exactly the race the unique key closes.
 *
 * ===========================================================================
 * NO pairingIndex, NO DATE, NO PUBLICATION, NO NOTIFICATION
 * ===========================================================================
 * `pairingIndex` is NOT written by this slice; the pure core's header states the
 * consequence honestly (an instructed trainee in a multi-examinee session may
 * receive no derived personal time and may be excluded from slot-grained conflict
 * checks). No column for it is named below, and no undefined placeholder is
 * written for it or for `instructionTopic`, `discipline`, `sourcePracticeRole`,
 * `notes` or `horseName` — an explicit `undefined` is still a mention, and a
 * mention is what a later edit turns into a value.
 *
 * Not one statement here reads or writes a calendar value, so this module needs
 * no date helper and carries no timezone decision. The single ExamPlan query
 * selects the plan's id and nothing else, so this operation cannot see, require
 * or change a publication state, and no notification, message or push surface is
 * imported. No grade, score or evaluation exists to write — the Exams area models
 * none. There is no read export, no delete export and no update export: this
 * module creates, and that is all it can do.
 *
 * ===========================================================================
 * ADMIN ONLY
 * ===========================================================================
 * There is no instructor and no trainee write path in this module: no actor
 * helper for either role is imported, and the only authorization binding is the
 * admin course-context resolver. An instructor- or trainee-authored assignment
 * would be a different product decision requiring its own review.
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
  createExamInstructedTraineeAssignmentWithDeps,
  type CreateExamInstructedTraineeAssignmentResult,
  type CreatedExamInstructedTraineeAssignmentRecord,
  type EligibleExamInstructedTrainee,
  type NewInstructedTraineeAssignment,
  type VerifiedExamSessionForInstructedTraineeCreate,
} from "@/lib/exam/create-exam-instructed-trainee-assignment-core";

export type { CreateExamInstructedTraineeAssignmentResult } from "@/lib/exam/create-exam-instructed-trainee-assignment-core";

// ===========================================================================
// The trust boundary
// ===========================================================================

/**
 * Admin + exact offering.
 *
 * `requireAdmin()` runs inside `requireAdminCourseOffering` BEFORE the offering
 * is looked up, so an unauthenticated caller is redirected rather than told
 * whether an offering id exists. Only `id` and `status` are carried forward: the
 * name, level, ActivityYear and dates of the offering are none of this
 * operation's business, and the RAW requested id is used at this boundary and
 * nowhere else.
 */
async function requireCourseContext(
  requestedCourseOfferingId: string,
): Promise<{ courseOfferingId: string; status: string }> {
  const context = await requireAdminCourseOffering(requestedCourseOfferingId);
  return { courseOfferingId: context.id, status: context.status };
}

/**
 * The lifecycle gate. The cast restores the generated enum that the pure core
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
 * The database index behind `@@unique([sessionId, studentId])` on
 * `exam_assignments`. Named here as a STRING so the classifier can recognize the
 * conflict structurally, without importing a Prisma error class.
 */
const EXAM_ASSIGNMENT_CONFLICT_INDEX = "exam_assignments_sessionId_studentId_key";

/**
 * Recognize the Prisma unique-constraint violation (`P2002`) that means "that
 * student ALREADY HAS AN ASSIGNMENT IN THAT SESSION", and nothing else.
 *
 * ROLE-BLIND, exactly like the key it recognizes. It fires whether the existing
 * row is another INSTRUCTED_TRAINEE entry for the same person or the session's
 * EXAMINEE — a person cannot both sit the exam and be taught in it. The refusal
 * the pure core produces does not say which, and must not: naming the other row's
 * role would turn a failed create into a read of that row.
 *
 * This is a PRIVATE, LOCAL classifier. The sibling examinee binding declares its
 * own; that one is private to that module and is deliberately neither imported
 * nor edited here, so neither slice can silently change the other's conflict
 * semantics.
 *
 * DELIBERATELY NARROW IN BOTH DIRECTIONS:
 *  - a non-object and a `null` are rejected;
 *  - any Prisma code other than `P2002` is rejected;
 *  - the field-array form must name BOTH `sessionId` AND `studentId`. Requiring
 *    both is what makes an unrelated composite key — one that happens to share a
 *    single column name — fail to match, so a future statement violating some
 *    other unique index is never reported to a manager as "already assigned". A
 *    target naming only one of them returns `false`;
 *  - the index-name form must EQUAL the exact index above. A prefix, a suffix or
 *    any other partial match returns `false`;
 *  - a framework redirect carries a `digest` and no `code`, so an unauthenticated
 *    admin's redirect can never be laundered into a form error;
 *  - `P2025` is not classified here at all — this operation deletes nothing.
 *
 * WHY THE UNREADABLE-METADATA FALLBACK IS SAFE, and it is the established
 * convention in the committed course and exam create bindings: the bound
 * transaction writes exactly ONE model, `ExamAssignment`, whose only unique keys
 * are the primary key — a freshly generated cuid that cannot realistically
 * collide — and this very `(sessionId, studentId)` pair. A `P2002` from that
 * transaction whose target cannot be read is therefore this conflict.
 *
 * The offending error is never inspected beyond these two shapes, never
 * unwrapped, never logged and never echoed, so no database detail and no
 * submitted value can leak into a result through it.
 */
function isInstructedTraineeAssignmentConflictError(error: unknown): boolean {
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
 * the ONE definition-derived fact the pure core is entitled to act on.
 *
 * `findFirst` with BOTH keys — never `findUnique({ where: { id } })` — so a
 * session of ANOTHER plan reads as `null` rather than being found and then
 * rejected by a comparison someone could later remove. It is the plan scope, not
 * a check, that makes a cross-plan create unreachable, and it is why the pure
 * core can report a foreign session and a missing one identically.
 *
 * The select is EXACTLY the session's id plus ONE column of its definition. NOT
 * selected, and therefore not leakable by any later mapper: the definition's
 * kind, `requiresLessonTopic`, `requiresDiscipline`, name, duration and parallel
 * capacity; the session's date, start time, end time, arena, title, notes, order
 * position, publication stamp and assignment count; the assignments relation;
 * every deprecated column the table still carries; and every Teaching-Practice
 * relation.
 *
 * The topic and discipline flags are the pointed omissions: they describe demands
 * on the EXAMINEE's row, an instructed trainee carries neither field, and a
 * column this module cannot read is a gate it cannot quietly start applying.
 */
async function findSessionForPlan(
  planId: string,
  sessionId: string,
): Promise<VerifiedExamSessionForInstructedTraineeCreate | null> {
  const row = await prisma.examSession.findFirst({
    where: { id: sessionId, planId },
    select: {
      id: true,
      definition: {
        select: {
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
    requiresInstructedTrainee: row.definition.requiresInstructedTrainee,
  };
}

/**
 * Verify the submitted trainee is assignable IN THE VERIFIED OFFERING — ONE
 * fail-closed statement, as the header explains.
 *
 * `findFirst` and not `findUnique`: the scope is the enrolment's
 * `(courseOfferingId, studentId)` pair PLUS two status conditions, which is not a
 * unique key, and a `findUnique` by student id would find a trainee of another
 * course and then rely on a comparison someone could later remove.
 *
 * ONE column is selected, and the id the SERVER matched — never the submitted
 * one — is what the pure core forwards to the write. `isPrimary` is not read, so
 * a combined trainee stays assignable in every offering she is actively enrolled
 * in.
 */
async function findEligibleTrainee(
  verifiedCourseOfferingId: string,
  studentId: string,
): Promise<EligibleExamInstructedTrainee | null> {
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
 * Append ONE instructed trainee to ONE already-existing session, assigning the
 * next order position within THAT SESSION inside a single interactive
 * transaction.
 *
 * THE ORDER SCOPE is the session alone, which is the whole relation: an
 * assignment belongs to exactly one session, and a session to exactly one plan.
 *
 * THE AGGREGATE IS A MAX, NEVER A COUNT, and the concurrency limitation is stated
 * honestly in the header rather than papered over: two concurrent creates may
 * calculate the same position, the schema does not make `(sessionId, orderIndex)`
 * unique, this role's projection does not use the position for wave ordering, and
 * the assignment id remains the tie-break. No retry, no lock, no advisory lock, no
 * `SERIALIZABLE` isolation, no unique rule, no count-based allocation and no
 * compaction is introduced.
 *
 * The aggregate and the create run on the SAME transaction client. Only
 * `ExamAssignment` is written: no plan, session, definition, break, supervisor,
 * beginner child or notification, and no second row of any kind.
 *
 * The written columns are EXACTLY the four below. `horseName`, `pairingIndex`,
 * `instructionTopic`, `discipline`, `sourcePracticeRole`, `notes`, `planId` and
 * `courseOfferingId` are absent — and UNREACHABLE, because the pure core's
 * payload has no field for any of them and the last two are not columns of this
 * table at all. None of them is written as an `undefined` placeholder either.
 * `id`, `createdAt` and `updatedAt` are left to the database.
 *
 * `role` is `value.role`, whose TYPE is the single literal the pure core fixes.
 * It is not derived here, not defaulted here and not expressible as anything else.
 */
function createAssignmentAtNextOrder(
  sessionId: string,
  value: NewInstructedTraineeAssignment,
): Promise<CreatedExamInstructedTraineeAssignmentRecord> {
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
        // The pure core's fixed role literal.
        role: value.role,
        // ...and the server-assigned position.
        orderIndex: nextOrderIndex,
      },
      // Narrow on purpose: the caller learns the new id and its position, and no
      // stored row, trainee or timestamp ever leaves this function.
      select: { id: true, orderIndex: true },
    });
  });
}

// ===========================================================================
// The single entry point
// ===========================================================================

/**
 * Create exactly ONE stored INSTRUCTED_TRAINEE assignment under an
 * ALREADY-EXISTING session, in the ALREADY-EXISTING plan of one authorized,
 * lifecycle-permitted course offering.
 *
 * Order (the pure core's contract, bound here to real effects):
 *   1. `requireAdminCourseOffering(courseOfferingId)` — admin first, then the
 *      exact offering; a redirect for a non-admin caller propagates untouched;
 *   2. `assertCourseOperationAllowed(status, "SCHEDULE_DRAFT_CONFIGURATION")`;
 *   3. ONE `prisma.examPlan.findUnique` on the VERIFIED offering id;
 *   4. no plan -> the core's plan refusal (never an upsert);
 *   5. the core's two-field normalization;
 *   6. invalid -> the core's input refusal, with NO session query, NO trainee
 *      query and NO write;
 *   7. ONE plan-scoped session read; missing or foreign -> the same refusal, and
 *      NO write;
 *   8. the definition must declare `requiresInstructedTrainee === true`;
 *      anything else refuses BEFORE the roster is read and writes NOTHING;
 *   9. ONE offering-scoped eligibility read; not eligible -> refusal, NO write;
 *  10. ONE transaction: one MAX aggregate + one create.
 *
 * Only three failures are classified — the offering not-found, the lifecycle
 * denial and the role-blind assignment conflict. Every other error propagates
 * unchanged, so a real defect is never laundered into a form error, and the
 * authorization redirect is never swallowed: neither `instanceof` check matches a
 * `NEXT_REDIRECT` throw, and the conflict classifier requires a `P2002` code that
 * a redirect does not carry.
 */
export async function createExamInstructedTraineeAssignment(
  courseOfferingId: string,
  rawInput: unknown,
): Promise<CreateExamInstructedTraineeAssignmentResult> {
  return createExamInstructedTraineeAssignmentWithDeps(courseOfferingId, rawInput, {
    requireCourseContext,
    assertConfigurationAllowed,
    findExamPlanByCourseOfferingId,
    findSessionForPlan,
    findEligibleTrainee,
    createAssignmentAtNextOrder,
    isCourseNotFoundError,
    isOperationNotAllowedError,
    isUniqueConstraintError: isInstructedTraineeAssignmentConflictError,
  });
}
