/**
 * EXAM EX-S5B-2 / EX-S5B-3 / EX-S5B-4 — the ADMIN-SCOPED ExamDefinition WRITES:
 * real bindings for CREATE, EDIT, safe REMOVAL and atomic REORDER.
 *
 * SERVER-ONLY BY DECLARATION. `import "server-only"` — the repository convention,
 * already used by the exam read bindings in this directory — turns an accidental
 * import from a client module into a BUILD ERROR. That matters independently of
 * everything else here: this module binds admin authorization, the
 * course-lifecycle policy and Prisma writes.
 *
 * DELIBERATELY NOT A `"use server"` MODULE. Everything exported from a
 * `"use server"` file becomes a PUBLICLY CALLABLE Server Action with a stable
 * network id — and these WRITE. `createExamDefinition`, `updateExamDefinition`,
 * `deleteExamDefinition` and `reorderExamDefinitions` are ORDINARY server
 * functions. The Server Actions, the route and the admin UI that eventually call
 * them are a LATER, separately reviewed slice; nothing in `app/` calls this
 * today, and no exam route or page exists.
 *
 * ===========================================================================
 * DIVISION OF LABOUR
 * ===========================================================================
 * Inside the exam slice (all pure, all DB-free):
 *   exam-definition-validation-core — the DOMAIN rules
 *   exam-definition-write-core      — INPUT normalization
 *   create-exam-definition-core     — the CREATE order + outcomes
 *   update-exam-definition-core     — the EDIT order + outcomes
 *   delete-exam-definition-core     — the REMOVAL order + outcomes
 *   reorder-exam-definitions-core   — the REORDER order + outcomes, and what
 *                                     "the same order" and "the same set" mean
 * And here:
 *   this module — the REAL admin, policy and Prisma bindings, and nothing else.
 *
 * (Those are named WITHOUT a module path on purpose: the committed EX-C1
 * containment suite forbids a path-shaped reference to an unwired exam core from
 * anywhere outside `lib/exam`, and a comment is source text like any other.)
 *
 * The orchestration is NOT reimplemented here. This file contains no ordering
 * decision, no validation, no policy table, no no-op rule and no outcome code of
 * its own: it hands each committed pure core its effects and its error
 * classifiers, and returns the core's result unchanged.
 *
 * The admin boundary, the lifecycle gate, the two typed error classifiers and
 * the ExamPlan lookup are each declared ONCE and shared by all four
 * operations — so the four can never drift into different trust boundaries.
 *
 * ===========================================================================
 * WHAT THE CALLER MAY SUPPLY
 * ===========================================================================
 * Create:  a REQUESTED `courseOfferingId` and a RAW input object.
 * Edit:    the same, plus a `definitionId` and an optimistic-concurrency token.
 * Remove:  a REQUESTED `courseOfferingId`, a `definitionId` and that token.
 * Reorder: a REQUESTED `courseOfferingId` and TWO raw id lists — the new order,
 *          and the order the caller believed was current.
 *
 * There is no parameter for a `planId`, a `kind`, an `orderIndex`, an admin id,
 * a session count, a publication option or a transaction handle — not "ignored",
 * but absent from every signature, so no future caller can pass one.
 *
 * The requested offering id is a REQUEST, not a grant: `requireAdminCourseOffering`
 * runs `requireAdmin()` FIRST (redirecting an unauthenticated or non-admin
 * caller) and only then looks up exactly that offering, and ONLY the DB-verified
 * id it returns reaches the ExamPlan query. The plan id is therefore always
 * server-derived, and every definition read, count and write is scoped by it.
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
 * PUBLICATION IS NOT CONSULTED
 * ===========================================================================
 * The single ExamPlan query selects the plan's id and nothing else, so no
 * operation here can see, require or change a publication state. Editing and
 * removing are permitted on a draft plan and a published one alike; a manager
 * warning about a published plan is a UI concern for a later slice. No
 * `publishedAt` is written, and no notification surface is imported.
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
import {
  updateExamDefinitionWithDeps,
  type ExistingExamDefinitionForUpdate,
  type NormalizedExamDefinitionEdit,
  type UpdateExamDefinitionResult,
  type UpdatedExamDefinitionRecord,
} from "@/lib/exam/update-exam-definition-core";
import {
  deleteExamDefinitionWithDeps,
  isExamDefinitionInUseError,
  type DeleteExamDefinitionResult,
} from "@/lib/exam/delete-exam-definition-core";
import {
  isCurrentExamDefinitionIdOrder,
  isExactExamDefinitionIdPermutation,
  reorderExamDefinitionsWithDeps,
  type ReorderExamDefinitionsAtomicOutcome,
  type ReorderExamDefinitionsResult,
} from "@/lib/exam/reorder-exam-definitions-core";

export type { CreateExamDefinitionResult } from "@/lib/exam/create-exam-definition-core";
export type { UpdateExamDefinitionResult } from "@/lib/exam/update-exam-definition-core";
export type { DeleteExamDefinitionResult } from "@/lib/exam/delete-exam-definition-core";
export type { ReorderExamDefinitionsResult } from "@/lib/exam/reorder-exam-definitions-core";

// ===========================================================================
// The shared trust boundary — declared ONCE, bound by all three operations
// ===========================================================================

/**
 * Admin + exact offering.
 *
 * `requireAdmin()` runs inside `requireAdminCourseOffering` BEFORE the offering
 * is looked up, so an unauthenticated caller is redirected rather than told
 * whether an offering id exists. Only `id` and `status` are carried forward: the
 * name, level, ActivityYear and dates of the offering are none of these
 * operations' business.
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
// The Prisma bindings
// ===========================================================================

/**
 * The ONLY ExamPlan query in this module: one narrow lookup by the VERIFIED
 * offering id, selecting the id alone. No publication state, no source dates, no
 * sessions, no definitions, no offering relation, no timestamps — and no upsert,
 * because a plan is never created here.
 *
 * Shared by all three operations rather than repeated per operation, so no
 * future edit can widen it for one of them alone.
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
 * Read ONE definition, scoped by BOTH the server-resolved plan and the requested
 * definition id.
 *
 * `findFirst` with both keys — never `findUnique({ where: { id } })` — so a
 * definition of ANOTHER plan reads as `null` rather than being found and then
 * rejected by a check someone could later remove. It is the plan scope, not a
 * comparison, that makes a cross-plan edit unreachable.
 *
 * `kind` is selected because it DRIVES validation and can never be written; the
 * six editable fields because the no-op rule is defined against them; `updatedAt`
 * because it is this operation's version token. No relation, no `planId`, no
 * `orderIndex`, no `createdAt` — and `updatedAt` is converted to epoch
 * milliseconds HERE, so no `Date` ever reaches a pure core or a result.
 *
 * Shared by the edit and the removal: the removal needs a strict subset of these
 * fields, and one reader is cheaper to keep correct than two.
 */
async function findDefinitionForPlan(
  planId: string,
  definitionId: string,
): Promise<ExistingExamDefinitionForUpdate | null> {
  const row = await prisma.examDefinition.findFirst({
    where: { id: definitionId, planId },
    select: {
      id: true,
      kind: true,
      name: true,
      durationMinutes: true,
      parallelCapacity: true,
      requiresInstructedTrainee: true,
      requiresLessonTopic: true,
      requiresDiscipline: true,
      updatedAt: true,
    },
  });

  if (row === null) {
    return null;
  }
  return { ...row, updatedAt: row.updatedAt.getTime() };
}

/**
 * The CONDITIONAL edit: rewrite six fields ONLY IF the stored version still
 * equals the token the caller was shown.
 *
 * `updateMany` rather than `update`, because the where clause carries THREE
 * conditions — the id, the SERVER plan and the expected version — and only
 * `updateMany` accepts a non-unique filter. A blind `update({ where: { id } })`
 * would silently overwrite another manager's concurrent edit and would not be
 * plan-scoped; a read-then-write comparison in application code would be racy.
 * `count === 0` therefore means exactly one thing: the row is no longer what the
 * caller thought, and the pure core turns that into the stale-write refusal.
 *
 * `data` carries exactly the six editable fields. `kind`, `orderIndex` and
 * `planId` are absent — and unreachable, because the normalized edit payload the
 * committed core produces has no such fields.
 *
 * The epoch-millisecond token is converted to the database's instant type HERE
 * and nowhere else. Millisecond precision is exact on both sides, so the value
 * a reader handed out round-trips to the same instant.
 *
 * The post-write read selects the id and the NEW version and nothing more. If
 * the row vanished in the moment between the two statements the result is
 * `null`, which the pure core reports as a stale write — the honest answer, and
 * the one that tells the manager to reload.
 */
async function updateDefinitionIfCurrent(
  planId: string,
  definitionId: string,
  expectedUpdatedAt: number,
  value: NormalizedExamDefinitionEdit,
): Promise<UpdatedExamDefinitionRecord | null> {
  const written = await prisma.examDefinition.updateMany({
    where: {
      id: definitionId,
      planId,
      updatedAt: new Date(expectedUpdatedAt),
    },
    data: {
      name: value.name,
      durationMinutes: value.durationMinutes,
      parallelCapacity: value.parallelCapacity,
      requiresInstructedTrainee: value.requiresInstructedTrainee,
      requiresLessonTopic: value.requiresLessonTopic,
      requiresDiscipline: value.requiresDiscipline,
    },
  });

  if (written.count === 0) {
    return null;
  }

  const row = await prisma.examDefinition.findFirst({
    where: { id: definitionId, planId },
    select: { id: true, updatedAt: true },
  });

  if (row === null) {
    return null;
  }
  return { id: row.id, updatedAt: row.updatedAt.getTime() };
}

/**
 * How many sessions of THIS plan refer to THIS definition.
 *
 * Filtered by BOTH columns, matching the composite foreign key
 * `ExamSession(planId, definitionId) -> ExamDefinition(planId, id)`, so the
 * count can neither miss a row nor include one from another plan. This is the
 * ONLY ExamSession statement in the module, and it is a read.
 */
function countSessionsForDefinition(
  planId: string,
  definitionId: string,
): Promise<number> {
  return prisma.examSession.count({
    where: { planId, definitionId },
  });
}

/**
 * The CONDITIONAL removal: delete ONLY IF the stored version still equals the
 * token the caller was shown.
 *
 * `deleteMany` rather than `delete`, for the same three reasons the conditional
 * edit uses `updateMany`: the filter is not unique, a blind delete by id would
 * not be plan-scoped, and the version check must happen inside the statement.
 * `count === 0` means the row is no longer what the caller thought.
 *
 * The definition's session foreign key is `ON DELETE RESTRICT`, so if a session
 * appears between the pure core's count and this statement the database refuses;
 * that refusal is classified by the committed pure classifier and reported as
 * the same in-use code.
 */
async function deleteDefinitionIfCurrent(
  planId: string,
  definitionId: string,
  expectedUpdatedAt: number,
): Promise<boolean> {
  const removed = await prisma.examDefinition.deleteMany({
    where: {
      id: definitionId,
      planId,
      updatedAt: new Date(expectedUpdatedAt),
    },
  });
  return removed.count > 0;
}

/**
 * The reorder's private ABORT signal — a class declared here, exported nowhere,
 * and constructed in exactly one function.
 *
 * A reorder rewrites several rows, so its refusals must UNDO whatever has
 * already been written. Returning a value from the transaction callback commits;
 * throwing rolls back. So every refusal the callback can decide — a stale
 * expected sequence, a submission that is not an exact permutation, and a row
 * that moved between the read and its own update — throws this, and the wrapper
 * below turns it back into the single `conflict` outcome the pure core knows.
 *
 * It is a distinct class rather than a string or a flag so the wrapper's
 * `instanceof` can never match a Prisma error, an application error or a
 * framework redirect, and it is private so nothing outside this file can
 * fabricate one.
 */
class ExamDefinitionReorderConflict extends Error {}

/**
 * Rewrite the positions of ALL of one plan's definitions, atomically.
 *
 * ONE interactive transaction does the whole operation: the authoritative read,
 * both validations and every write. Reading the current order OUTSIDE the
 * transaction would make the stale check advisory — another manager could add,
 * remove or move a definition in the gap, and the reorder would happily write a
 * set that no longer exists.
 *
 * THE READ. `findMany` over `planId`, selecting `id` and `orderIndex` and
 * nothing else, ordered by `orderIndex` then `id`. That tie-break is not
 * decoration: the sibling create documents that concurrent appends may produce
 * EQUAL `orderIndex` values, so `orderIndex` alone is not a total order, and the
 * sequence the stale token is compared against has to be the same one every
 * reader sees.
 *
 * BOTH CHECKS BEFORE ANY WRITE. The expected sequence must equal the current one
 * exactly, and the submitted list must be an exact permutation of it. Both are
 * the committed pure predicates, so the rule is proven by a DB-free test rather
 * than re-derived next to Prisma. A duplicate, a missing id, an extra id, an
 * unknown id and an id belonging to ANOTHER plan all fail the same check and
 * produce the same refusal — and no query is ever made against another plan to
 * find out which it was.
 *
 * THE NO-OP. If the submitted order already IS the current order, the callback
 * returns without issuing a single write. It deliberately does NOT normalize
 * gaps in that case: "the order you sent is the order that is stored" is the
 * locked answer, and rewriting rows nobody asked to move would be a surprise.
 *
 * THE WRITES. Only rows whose stored `orderIndex` differs from their new
 * position are written, each by an `updateMany` scoped by BOTH the id and the
 * SERVER plan id, and each writing `orderIndex` and nothing else. After a
 * changed reorder every row's `orderIndex` equals its position, so the positions
 * are contiguous `0..n-1`.
 *
 * NO OFFSET DANCE. The schema declares no unique constraint on
 * `(planId, orderIndex)`, so two rows may hold the same position mid-loop
 * without the database objecting. That is why there are no temporary negative
 * indexes, no two-phase shuffle, no `P2002` handling and no retry: none of them
 * would be doing anything. Nothing here CLAIMS the schema enforces unique
 * positions — it does not, and no index is added by this slice.
 *
 * A `count` other than 1 means the row was removed or re-planned mid-loop; that
 * throws, so the partial rewrite is rolled back and the caller is told to
 * reload. There is no partial success.
 *
 * CONCURRENCY LIMITATION, STATED HONESTLY: two managers reordering the same plan
 * at the same instant are serialized by the stale-sequence check, not by a lock
 * or by SERIALIZABLE isolation — the loser sees `conflict` and reloads. A
 * concurrent CREATE that lands between this read and its commit can still leave
 * the appended row sharing a position with an existing one, exactly as the
 * create binding documents; the next reorder normalizes it.
 */
async function reorderDefinitionsAtomically(
  planId: string,
  orderedDefinitionIds: readonly string[],
  expectedOrderedDefinitionIds: readonly string[],
): Promise<ReorderExamDefinitionsAtomicOutcome> {
  try {
    return await prisma.$transaction(
      async (tx): Promise<ReorderExamDefinitionsAtomicOutcome> => {
        const currentRows = await tx.examDefinition.findMany({
          where: { planId },
          select: { id: true, orderIndex: true },
          orderBy: [{ orderIndex: "asc" }, { id: "asc" }],
        });

        const currentIds = currentRows.map((row) => row.id);

        // The stale-write token, compared against the authoritative sequence
        // read one statement ago inside this same transaction.
        if (!isCurrentExamDefinitionIdOrder(expectedOrderedDefinitionIds, currentIds)) {
          throw new ExamDefinitionReorderConflict();
        }

        // The exact-set rule. Nothing has been written at this point.
        if (!isExactExamDefinitionIdPermutation(orderedDefinitionIds, currentIds)) {
          throw new ExamDefinitionReorderConflict();
        }

        // Already in this order: commit nothing.
        if (isCurrentExamDefinitionIdOrder(orderedDefinitionIds, currentIds)) {
          return { status: "unchanged", orderedDefinitionIds: currentIds };
        }

        const storedOrderIndexById = new Map<string, number>();
        for (const row of currentRows) {
          storedOrderIndexById.set(row.id, row.orderIndex);
        }

        // The already-validated rows that actually move. The loop below iterates
        // ONLY this list, and issues no read of any kind.
        const movedEntries = orderedDefinitionIds
          .map((id, orderIndex) => ({ id, orderIndex }))
          .filter((entry) => storedOrderIndexById.get(entry.id) !== entry.orderIndex);

        let updatedCount = 0;
        for (const { id, orderIndex } of movedEntries) {
          const written = await tx.examDefinition.updateMany({
            where: { id, planId },
            data: { orderIndex },
          });
          if (written.count !== 1) {
            throw new ExamDefinitionReorderConflict();
          }
          updatedCount += 1;
        }

        return {
          status: "updated",
          orderedDefinitionIds: [...orderedDefinitionIds],
          updatedCount,
        };
      },
    );
  } catch (error) {
    // The ONLY catch in this module, and it recognizes exactly one private
    // class. A Prisma failure, an application error and a framework redirect all
    // propagate with their identity intact.
    if (error instanceof ExamDefinitionReorderConflict) {
      return { status: "conflict" };
    }
    throw error;
  }
}

// ===========================================================================
// 1. Create
// ===========================================================================

/**
 * Create exactly ONE ExamDefinition under an EXISTING ExamPlan.
 *
 * Order (the committed pure core's contract, bound here to real effects):
 *   1. `requireAdminCourseOffering(courseOfferingId)` — admin first, then the
 *      exact offering; a redirect for a non-admin caller propagates untouched;
 *   2. `assertCourseOperationAllowed(status, "SCHEDULE_DRAFT_CONFIGURATION")`;
 *   3. ONE `prisma.examPlan.findUnique` on the VERIFIED offering id;
 *   4. no plan -> the core's plan refusal (never an upsert);
 *   5. the committed input normalizer;
 *   6. invalid -> the core's input refusal, and NO write;
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
    requireCourseContext,
    assertConfigurationAllowed,
    findExamPlanByCourseOfferingId,
    createDefinitionAtNextOrder,
    isCourseNotFoundError,
    isOperationNotAllowedError,
    isDuplicateNameError: isExamDefinitionDuplicateNameError,
  });
}

// ===========================================================================
// 2. Edit
// ===========================================================================

/**
 * Edit exactly ONE existing ExamDefinition.
 *
 * Order (the committed pure core's contract, bound here to real effects):
 *   1. admin + exact offering;
 *   2. the lifecycle gate on the VERIFIED status;
 *   3. ONE plan lookup on the VERIFIED offering id;
 *   4. ONE plan-scoped definition read;
 *   5. the version token, then the committed EDIT normalizer against the
 *      AUTHORITATIVE stored kind;
 *   6. a no-op performs NO write at all;
 *   7. otherwise ONE conditional `updateMany` and ONE narrow re-read.
 *
 * `kind` is immutable and is not a parameter: the stored kind drives validation,
 * and the normalized edit payload has no kind field to write. The same is true
 * of `orderIndex` — reordering is a separate, later slice.
 *
 * The duplicate-name classifier is the committed CREATE-slice one, reused
 * deliberately rather than re-implemented: the conditional update writes exactly
 * one model, and the only unique key it can violate is `@@unique([planId, name])`
 * — the sibling `[planId, id]` key cannot be violated by an update that changes
 * neither column. An unrelated P2002 is not recognized and propagates.
 */
export async function updateExamDefinition(
  courseOfferingId: string,
  definitionId: string,
  expectedUpdatedAt: number,
  rawInput: unknown,
): Promise<UpdateExamDefinitionResult> {
  return updateExamDefinitionWithDeps(
    courseOfferingId,
    definitionId,
    expectedUpdatedAt,
    rawInput,
    {
      requireCourseContext,
      assertConfigurationAllowed,
      findExamPlanByCourseOfferingId,
      findDefinitionForUpdate: findDefinitionForPlan,
      updateDefinitionIfCurrent,
      isCourseNotFoundError,
      isOperationNotAllowedError,
      isDuplicateNameError: isExamDefinitionDuplicateNameError,
    },
  );
}

// ===========================================================================
// 3. Safe removal
// ===========================================================================

/**
 * Remove exactly ONE ExamDefinition — and only one that nothing uses.
 *
 * Order (the committed pure core's contract, bound here to real effects):
 *   1. admin + exact offering;
 *   2. the lifecycle gate on the VERIFIED status;
 *   3. ONE plan lookup on the VERIFIED offering id;
 *   4. ONE plan-scoped definition read;
 *   5. the version token;
 *   6. ONE session count on (plan, definition) — non-zero refuses with NO
 *      delete;
 *   7. otherwise ONE conditional `deleteMany`.
 *
 * This is a HARD delete: `ExamDefinition` has no archive column, this slice adds
 * none, and no schema is changed. The removal is safe because it is impossible
 * for it to orphan a session — the count refuses the ordinary case, and the
 * database's `ON DELETE RESTRICT` foreign key refuses the race, which the
 * committed pure classifier maps back to the same in-use code.
 */
export async function deleteExamDefinition(
  courseOfferingId: string,
  definitionId: string,
  expectedUpdatedAt: number,
): Promise<DeleteExamDefinitionResult> {
  return deleteExamDefinitionWithDeps(courseOfferingId, definitionId, expectedUpdatedAt, {
    requireCourseContext,
    assertConfigurationAllowed,
    findExamPlanByCourseOfferingId,
    findDefinitionForDelete: findDefinitionForPlan,
    countSessionsForDefinition,
    deleteDefinitionIfCurrent,
    isCourseNotFoundError,
    isOperationNotAllowedError,
    isDefinitionInUseForeignKeyError: isExamDefinitionInUseError,
  });
}

// ===========================================================================
// 4. Atomic reorder
// ===========================================================================

/**
 * Rewrite the order of ALL of one plan's ExamDefinitions, atomically.
 *
 * Order (the committed pure core's contract, bound here to real effects):
 *   1. admin + exact offering;
 *   2. the lifecycle gate on the VERIFIED status;
 *   3. ONE plan lookup on the VERIFIED offering id;
 *   4. no plan -> the core's plan refusal (never an upsert);
 *   5. both untrusted lists normalized — array of non-blank strings, trimmed;
 *   6. malformed -> the core's input refusal, and NO transaction at all;
 *   7. ONE transaction: one plan-scoped read, both validations, then a write for
 *      each row that actually moves.
 *
 * The caller submits the COMPLETE new order and the order they believed was
 * current. There is no `planId` parameter, no `orderIndex` parameter and no
 * per-row payload: positions are assigned by the server from the submitted
 * sequence, and the plan is the one that belongs to the verified offering.
 *
 * Neither of the two lists is trusted, and neither can name a row this operation
 * may not touch: an id outside the plan's current set fails the exact-set check
 * and refuses the whole reorder, with nothing written and no query issued
 * against any other plan.
 */
export async function reorderExamDefinitions(
  courseOfferingId: string,
  orderedDefinitionIds: unknown,
  expectedOrderedDefinitionIds: unknown,
): Promise<ReorderExamDefinitionsResult> {
  return reorderExamDefinitionsWithDeps(
    courseOfferingId,
    orderedDefinitionIds,
    expectedOrderedDefinitionIds,
    {
      requireCourseContext,
      assertConfigurationAllowed,
      findExamPlanByCourseOfferingId,
      reorderDefinitionsAtomically,
      isCourseNotFoundError,
      isOperationNotAllowedError,
    },
  );
}
