/**
 * EXAM EX-S5B-5A — the ADMIN ExamDefinition LIST read: the real bindings.
 *
 * SERVER-ONLY BY DECLARATION. `import "server-only"` — the repository convention,
 * already used by the exam read and write bindings in this directory — turns an
 * accidental import from a `"use client"` module into a BUILD ERROR. That matters
 * independently of everything else here: this module holds the database client,
 * the admin authorization boundary and the course-lifecycle policy.
 *
 * DELIBERATELY NOT A `"use server"` MODULE. Everything exported from a
 * `"use server"` file becomes a PUBLICLY CALLABLE Server Action with a stable
 * network id. `readExamDefinitionsForAdmin` is an ORDINARY async server
 * function. The Server Action, the route, the page and the admin UI that will
 * eventually call it are a LATER, separately reviewed slice; nothing in `app/`
 * calls this today, and no exam route or page exists.
 *
 * ===========================================================================
 * DIVISION OF LABOUR
 * ===========================================================================
 * The ORDER, the plan-absent view, the count join, the deterministic sort and
 * the shape of the result all live in the pure, dependency-injected core of this
 * slice — `exam-definition-admin-read-core`, proven by a DB-free suite. (It is
 * named WITHOUT a module path on purpose: the committed containment suite
 * forbids a path-shaped reference to an unwired exam core from outside
 * `lib/exam`, and a comment is source text like any other.)
 *
 * And here: the REAL admin, policy and database bindings, and nothing else. This
 * file contains no ordering decision, no join rule, no normalization and no
 * outcome of its own — it hands the core its effects and returns the core's
 * result unchanged.
 *
 * ===========================================================================
 * A READ, AND ONLY A READ
 * ===========================================================================
 * Every database statement here is a single `findUnique` / `findMany` /
 * `groupBy`. There is no `create`, `update`, `upsert`, `delete`, `deleteMany`,
 * `updateMany`, `createMany`, `$executeRaw`, `$queryRaw` or transaction anywhere
 * in this file, and none may be added: the exam WRITE surface is a separate,
 * already-authorized slice, and this module must never gain the ability to
 * change what it displays.
 *
 * ===========================================================================
 * THE CALLER SUPPLIES A REQUEST, NEVER A GRANT
 * ===========================================================================
 * The single parameter is a REQUESTED `courseOfferingId`. There is no parameter
 * for a `planId`, a `definitionId`, an actor id, a page size or a filter.
 *
 * `requireAdminCourseOffering` runs `requireAdmin()` FIRST — redirecting an
 * unauthenticated or non-admin caller before any offering is looked up, so an
 * anonymous caller cannot probe which offering ids exist — and only the
 * DB-VERIFIED id it returns reaches the ExamPlan query. The plan id is therefore
 * always server-derived, and the definition read and the usage count are scoped
 * by it.
 *
 * ===========================================================================
 * THE COURSE-LIFECYCLE GATE IS THE *READ* GATE
 * ===========================================================================
 * The gate is the existing `HISTORICAL_READ` operation, which the committed
 * policy allows for PLANNED, ACTIVE and ARCHIVED offerings — and which is
 * DEFAULT-DENY for any status the policy does not classify.
 *
 * That is the correct classification for this surface, and it is deliberately
 * NOT the `SCHEDULE_DRAFT_CONFIGURATION` gate the definition WRITES use: an
 * ARCHIVED offering's exam configuration remains readable history while its
 * definitions may no longer be edited, and borrowing the write gate here would
 * quietly make that history unreadable.
 *
 * No new `CourseOfferingOperation` is introduced, `operation-policy-core.ts` is
 * not edited, and NO capability is consulted: there is no `EXAMS` capability (no
 * catalog key, no row, no reader), and `SCHEDULE` / `TEACHING_PRACTICE` are NOT
 * borrowed — an exam read must not silently inherit another module's product
 * decisions, and a placeholder check that always passes reads as enforcement to
 * the next person who edits this file.
 *
 * ===========================================================================
 * NARROW SELECTS — NOTHING TO STRIP EVER LEAVES THE DATABASE
 * ===========================================================================
 * The plan query selects its id and its publication instant. The definition
 * query selects exactly the ten columns the view declares. The usage query
 * selects NO column at all — it is a grouped COUNT.
 *
 * No session row, assignment, student, instructor, Teaching-Practice lesson,
 * source-lesson detail, child, parent contact or `ExamBeginnerChild` is read,
 * and no relation is included anywhere. A column that is never selected cannot
 * be leaked by a later mapper, which is stronger than a rule someone must
 * remember. The Exams area models no grade, score or evaluation at all.
 *
 * ===========================================================================
 * ONE BATCHED COUNT — NEVER ONE PER DEFINITION
 * ===========================================================================
 * Usage is read as a single `groupBy` over BOTH key columns — matching the
 * composite foreign key `ExamSession(planId, definitionId) ->
 * ExamDefinition(planId, id)` — filtered by the server-resolved plan. There is
 * exactly one such statement, it is not inside a loop or a per-row callback, and
 * the pure core indexes its groups in memory. A definition with no group is
 * reported as zero by the core.
 *
 * ===========================================================================
 * DATES BECOME NUMBERS HERE, AND NOWHERE ELSE
 * ===========================================================================
 * `DateTime` stamps are converted to EPOCH MILLISECONDS in this file — the only
 * place in the slice that touches a `Date` — so no `Date` ever reaches the pure
 * core or the returned view.
 */
import "server-only";

import type { CourseOfferingStatus } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdminCourseOffering } from "@/lib/course/admin-course-context";
import { assertCourseOperationAllowed } from "@/lib/course/operation-policy-core";
import {
  readExamDefinitionsForAdminWithDeps,
  type AdminExamDefinitionListView,
  type ExamDefinitionSessionCountRow,
  type ResolvedExamPlanForAdminRead,
  type StoredAdminExamDefinitionRow,
  type VerifiedExamDefinitionReadCourseContext,
} from "@/lib/exam/exam-definition-admin-read-core";

export type {
  AdminExamDefinitionListView,
  AdminExamDefinitionView,
} from "@/lib/exam/exam-definition-admin-read-core";

// ===========================================================================
// The trust boundary
// ===========================================================================

/**
 * Admin + exact offering.
 *
 * `requireAdmin()` runs inside `requireAdminCourseOffering` BEFORE the offering
 * is looked up, so an unauthenticated caller is redirected rather than told
 * whether an offering id exists. Only `id` and `status` are carried forward: the
 * name, level, ActivityYear and dates of the offering are none of this read's
 * business.
 */
async function requireCourseContext(
  requestedCourseOfferingId: string,
): Promise<VerifiedExamDefinitionReadCourseContext> {
  const context = await requireAdminCourseOffering(requestedCourseOfferingId);
  return { courseOfferingId: context.id, status: context.status };
}

/**
 * The lifecycle READ gate. The cast restores the generated enum that the pure
 * core deliberately widened to `string`; it is safe because the committed policy
 * is DEFAULT-DENY — an unrecognized status is refused, never allowed.
 */
function assertHistoricalReadAllowed(status: string): void {
  assertCourseOperationAllowed(status as CourseOfferingStatus, "HISTORICAL_READ");
}

// ===========================================================================
// The database bindings — three statements, all reads
// ===========================================================================

/**
 * The plan of ONE course offering, by its VERIFIED id, or `null`.
 *
 * `ExamPlan.courseOfferingId` is `@unique`, so this is a single indexed lookup.
 * It selects the id and the publication instant and NOTHING else: no source
 * dates, no sessions, no definitions relation, no offering relation and no
 * plan-level `createdAt`/`updatedAt`. There is no upsert — a plan is never
 * created by a read.
 */
async function findExamPlanByCourseOfferingId(
  verifiedCourseOfferingId: string,
): Promise<ResolvedExamPlanForAdminRead | null> {
  const plan = await prisma.examPlan.findUnique({
    where: { courseOfferingId: verifiedCourseOfferingId },
    select: { id: true, publishedAt: true },
  });
  if (plan === null) {
    return null;
  }
  return {
    id: plan.id,
    // Epoch ms, matching the committed publication convention. Never a `Date`.
    publishedAt: plan.publishedAt === null ? null : plan.publishedAt.getTime(),
  };
}

/**
 * EVERY `ExamDefinition` of ONE plan, in ONE query, in a deterministic order.
 *
 * `ExamDefinition` is always plan-scoped, so `planId` is the whole scope. The
 * order is `orderIndex` then `id`, because concurrent appends may share a
 * position; the pure core re-imposes the same total order regardless, so the two
 * layers cannot disagree.
 *
 * The select is exactly the ten columns the view declares: no `planId` echoed
 * back, no `createdAt`, and no `sessions` relation — the usage count is the
 * batched statement below, never an included relation.
 */
async function findDefinitionsByPlanId(
  planId: string,
): Promise<readonly StoredAdminExamDefinitionRow[]> {
  const rows = await prisma.examDefinition.findMany({
    where: { planId },
    select: {
      id: true,
      name: true,
      kind: true,
      durationMinutes: true,
      parallelCapacity: true,
      requiresInstructedTrainee: true,
      requiresLessonTopic: true,
      requiresDiscipline: true,
      orderIndex: true,
      updatedAt: true,
    },
    orderBy: [{ orderIndex: "asc" }, { id: "asc" }],
  });

  // The ONE `Date` conversion of this statement. Nothing above this line sees a
  // `Date`, and the mapping introduces no query of its own.
  return rows.map((row) => ({ ...row, updatedAt: row.updatedAt.getTime() }));
}

/**
 * How many sessions of THIS plan refer to each of its definitions — ONE grouped,
 * batched count, and the only `ExamSession` statement in this module.
 *
 * Grouped by BOTH `planId` and `definitionId`, matching the composite foreign
 * key, and filtered by the server-resolved plan: the count can neither miss a
 * row nor include one from another plan. No column of `ExamSession` is selected
 * — not its date, arena, title, notes, assignments, supervisors or publication
 * state — because a count needs none of them, and this surface displays none.
 *
 * `_all` is the row count of each group. A definition with no session produces
 * NO group at all, which the pure core reports as zero.
 */
async function countSessionsByDefinition(
  planId: string,
): Promise<readonly ExamDefinitionSessionCountRow[]> {
  const groups = await prisma.examSession.groupBy({
    by: ["planId", "definitionId"],
    where: { planId },
    _count: { _all: true },
  });

  return groups.map((group) => ({
    planId: group.planId,
    definitionId: group.definitionId,
    sessionCount: group._count._all,
  }));
}

// ===========================================================================
// The single entry point
// ===========================================================================

/**
 * Read EVERY ExamDefinition of ONE course offering's exam plan, for an admin.
 *
 * Order (the committed pure core's contract, bound here to real effects):
 *   1. `requireAdminCourseOffering(courseOfferingId)` — admin first, then the
 *      exact offering; a redirect for a non-admin caller propagates untouched;
 *   2. `assertCourseOperationAllowed(status, "HISTORICAL_READ")`;
 *   3. ONE `prisma.examPlan.findUnique` on the VERIFIED offering id;
 *   4. no plan -> the core's plan-absent view, and no further query;
 *   5. ONE `prisma.examDefinition.findMany` on the SERVER-resolved plan id;
 *   6. no definition -> the empty view, and NO count query;
 *   7. ONE `prisma.examSession.groupBy` for the whole plan.
 *
 * NOTHING is classified: the typed offering not-found, the typed lifecycle
 * denial, an infrastructure failure and the authorization redirect all propagate
 * with their identity intact. A read must never turn a denial into an empty
 * list — the surface that renders this view decides how to say each sentence
 * (`notFound()` for a page, an error result for an action).
 */
export async function readExamDefinitionsForAdmin(
  courseOfferingId: string,
): Promise<AdminExamDefinitionListView> {
  return readExamDefinitionsForAdminWithDeps(courseOfferingId, {
    requireCourseContext,
    assertHistoricalReadAllowed,
    findExamPlanByCourseOfferingId,
    findDefinitionsByPlanId,
    countSessionsByDefinition,
  });
}
