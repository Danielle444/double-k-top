/**
 * EXAM EX-S5B-2 — the ADMIN-SCOPED ExamDefinition CREATE: real bindings.
 *
 * SERVER-ONLY BY DECLARATION. `import "server-only"` — the repository convention,
 * already used by the exam read bindings in this directory — turns an accidental
 * import from a client module into a BUILD ERROR. That matters independently of
 * everything else here: this module binds admin authorization, the
 * course-lifecycle policy and a Prisma write.
 *
 * DELIBERATELY NOT A `"use server"` MODULE. Everything exported from a
 * `"use server"` file becomes a PUBLICLY CALLABLE Server Action with a stable
 * network id — and this one WRITES. `createExamDefinition` is an ORDINARY server
 * function. The Server Action, the route and the admin UI that eventually call it
 * are a LATER, separately reviewed slice; nothing in `app/` calls this today, and
 * no exam route or page exists.
 *
 * ===========================================================================
 * DIVISION OF LABOUR
 * ===========================================================================
 * Inside the exam slice (all pure, all DB-free):
 *   exam-definition-validation-core — the DOMAIN rules
 *   exam-definition-write-core      — INPUT normalization
 *   create-exam-definition-core     — the ORDER + the outcomes
 * And here:
 *   this module — the REAL admin, policy and Prisma bindings, and nothing else.
 *
 * (Those three are named WITHOUT a module path on purpose: the committed EX-C1
 * containment suite forbids a path-shaped reference to an unwired exam core from
 * anywhere outside `lib/exam`, and a comment is source text like any other.)
 *
 * The orchestration is NOT reimplemented here. This file contains no ordering
 * decision, no validation, no policy table and no outcome code of its own: it
 * hands the committed pure core four effects and three error classifiers, and
 * returns the core's result unchanged.
 *
 * ===========================================================================
 * WHAT THE CALLER MAY SUPPLY
 * ===========================================================================
 * Exactly a REQUESTED `courseOfferingId` and a RAW input object. There is no
 * parameter for a `planId`, a `definitionId`, an `orderIndex`, an admin id, a
 * publication option or a transaction handle — not "ignored", but absent from the
 * signature, so no future caller can pass one.
 *
 * The requested offering id is a REQUEST, not a grant: `requireAdminCourseOffering`
 * runs `requireAdmin()` FIRST (redirecting an unauthenticated or non-admin
 * caller) and only then looks up exactly that offering, and ONLY the DB-verified
 * id it returns reaches the ExamPlan query. The plan id is therefore always
 * server-derived.
 *
 * ===========================================================================
 * THE COURSE-LIFECYCLE GATE — A TEMPORARY, DELIBERATE REUSE
 * ===========================================================================
 * The gate is the existing `SCHEDULE_DRAFT_CONFIGURATION` operation, which the
 * committed policy allows for PLANNED and ACTIVE offerings and denies for
 * ARCHIVED ones — exactly the required behaviour for configuring an exam plan's
 * definitions.
 *
 * This is a reuse of a course-LIFECYCLE classification, NOT of a capability. No
 * new `CourseOfferingOperation` is introduced, `operation-policy-core.ts` is not
 * edited, and NO capability is consulted: there is no `EXAMS` capability (no
 * catalog key, no row, no reader), and `SCHEDULE` / `TEACHING_PRACTICE` are NOT
 * borrowed — an exam write must not silently inherit another module's product
 * decisions, and a placeholder check that always passes reads as enforcement to
 * the next person who edits this file.
 *
 * A dedicated `EXAM_CONFIGURATION` lifecycle operation MAY be worth introducing
 * so exam configuration can diverge from schedule drafting; that is a separate
 * architecture slice and is NOT introduced here.
 *
 * ===========================================================================
 * ADMIN ONLY
 * ===========================================================================
 * There is no instructor and no trainee write path in this module: no actor
 * helper for either role is imported, and the only authorization binding is the
 * admin course-context resolver. An instructor- or trainee-authored definition
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
  createExamDefinitionWithDeps,
  isExamDefinitionDuplicateNameError,
  type CreateExamDefinitionResult,
  type NormalizedExamDefinitionCreate,
} from "@/lib/exam/create-exam-definition-core";

export type { CreateExamDefinitionResult } from "@/lib/exam/create-exam-definition-core";

/**
 * Append ONE definition to the plan of ONE course offering, assigning the next
 * order position inside a single transaction.
 *
 * CONCURRENCY LIMITATION, STATED HONESTLY: concurrent creates may temporarily
 * receive EQUAL `orderIndex` values, because the schema declares no unique
 * constraint on `(planId, orderIndex)` and an ordinary transaction does not
 * serialize the read-max/insert pair. This is TOLERATED, not prevented: readers
 * sort deterministically by `orderIndex` and then `id`, so equal positions stay
 * stably ordered, and the later reorder slice normalizes indexes. Nothing here
 * claims uniqueness — no unique index, no serializable isolation, no retry and no
 * module-level lock is added, and adding one is a separate approved change.
 *
 * The aggregate and the create run on the SAME transaction client. Only
 * `ExamDefinition` is written: no ExamPlan create/update/upsert, no session, no
 * assignment, no notification, and no second row of any kind.
 */
function createDefinitionAtNextOrder(
  planId: string,
  value: NormalizedExamDefinitionCreate,
): Promise<{ id: string; orderIndex: number }> {
  return prisma.$transaction(async (tx) => {
    const aggregate = await tx.examDefinition.aggregate({
      where: { planId },
      _max: { orderIndex: true },
    });

    // 0 for the first definition of a plan; max + 1 afterwards. Never
    // caller-supplied, and never derived from a COUNT — a count would silently
    // reuse a position after any future gap.
    const nextOrderIndex =
      aggregate._max.orderIndex === null ? 0 : aggregate._max.orderIndex + 1;

    return tx.examDefinition.create({
      data: {
        // The SERVER-RESOLVED plan id, from the verified offering's plan.
        planId,
        // Exactly the seven normalized fields the committed core produced.
        name: value.name,
        kind: value.kind,
        durationMinutes: value.durationMinutes,
        parallelCapacity: value.parallelCapacity,
        requiresInstructedTrainee: value.requiresInstructedTrainee,
        requiresLessonTopic: value.requiresLessonTopic,
        requiresDiscipline: value.requiresDiscipline,
        // Server-assigned.
        orderIndex: nextOrderIndex,
      },
      // Narrow on purpose: the caller learns the new id and its position, and no
      // stored row, name or timestamp ever leaves this function.
      select: { id: true, orderIndex: true },
    });
  });
}

/**
 * Create exactly ONE ExamDefinition under an EXISTING ExamPlan.
 *
 * Order (the committed pure core's contract, bound here to real effects):
 *   1. `requireAdminCourseOffering(courseOfferingId)` — admin first, then the
 *      exact offering; a redirect for a non-admin caller propagates untouched;
 *   2. `assertCourseOperationAllowed(status, "SCHEDULE_DRAFT_CONFIGURATION")`;
 *   3. ONE `prisma.examPlan.findUnique` on the VERIFIED offering id;
 *   4. no plan -> `plan_not_found` (never an upsert);
 *   5. the committed input normalizer;
 *   6. invalid -> `invalid_input` with the committed issues, and NO write;
 *   7. ONE transaction: one aggregate + one create.
 *
 * Only three failures are classified — the offering not-found, the lifecycle
 * denial and the name-uniqueness conflict. Every other error propagates
 * unchanged, so a real defect is never laundered into a form error, and the
 * authorization redirect is never swallowed: neither `instanceof` check matches
 * a `NEXT_REDIRECT` throw, and the duplicate classifier requires a P2002 code
 * that a redirect does not carry.
 */
export async function createExamDefinition(
  courseOfferingId: string,
  rawInput: unknown,
): Promise<CreateExamDefinitionResult> {
  return createExamDefinitionWithDeps(courseOfferingId, rawInput, {
    // 1. Admin + exact offering. Only `id` and `status` are carried forward: the
    //    name, level, ActivityYear and dates of the offering are none of this
    //    operation's business.
    requireCourseContext: async (requestedCourseOfferingId) => {
      const context = await requireAdminCourseOffering(requestedCourseOfferingId);
      return { courseOfferingId: context.id, status: context.status };
    },

    // 2. The lifecycle gate. The cast restores the generated enum that the pure
    //    core deliberately widened to `string`; it is safe because the committed
    //    policy is DEFAULT-DENY — an unrecognized status is refused, never
    //    allowed.
    assertConfigurationAllowed: (status) =>
      assertCourseOperationAllowed(
        status as CourseOfferingStatus,
        "SCHEDULE_DRAFT_CONFIGURATION",
      ),

    // 3. The ONLY ExamPlan query in this module: one narrow lookup by the
    //    VERIFIED offering id, selecting the id alone. No publication state, no
    //    source dates, no sessions, no definitions, no offering relation, no
    //    timestamps — and no upsert, because a plan is never created here.
    findExamPlanByCourseOfferingId: (verifiedCourseOfferingId) =>
      prisma.examPlan.findUnique({
        where: { courseOfferingId: verifiedCourseOfferingId },
        select: { id: true },
      }),

    // 4. The single write.
    createDefinitionAtNextOrder,

    // 5. The three classifiers. Each recognizes ONE specific shape; anything
    //    else is re-thrown by the pure core.
    isCourseNotFoundError: (error) => error instanceof CourseOfferingNotFoundError,
    isOperationNotAllowedError: (error) =>
      error instanceof CourseOperationNotPermittedError,
    isDuplicateNameError: isExamDefinitionDuplicateNameError,
  });
}
