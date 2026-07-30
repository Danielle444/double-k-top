/**
 * EXAM EX-SES-R1 — the ADMIN stored-ExamSession read: the real bindings.
 *
 * SERVER-ONLY BY DECLARATION. `import "server-only"` — the repository convention,
 * already used by the exam read and write bindings in this directory — turns an
 * accidental import from a `"use client"` module into a BUILD ERROR. That matters
 * independently of everything else here: this module holds the database client,
 * the admin authorization boundary and the course-lifecycle policy.
 *
 * DELIBERATELY NOT A `"use server"` MODULE. Everything exported from a
 * `"use server"` file becomes a PUBLICLY CALLABLE Server Action with a stable
 * network id. `readAdminExamSessions` is an ORDINARY async server function. The
 * Server Action, the route, the page and the admin schedule UI that will
 * eventually call it are a LATER, separately reviewed slice; nothing in `app/`
 * calls this today.
 *
 * ===========================================================================
 * WHY THIS FILE IS NAMED `admin-exam-session-read-io`
 * ===========================================================================
 * NOT for style. The committed session-WRITE suite asserts an exact DIRECTORY
 * LISTING — every file in this directory whose name begins with the write
 * slice's prefix must be exactly its own two files. A read binding sharing that
 * prefix would break a green, committed guard for a reason that has nothing to
 * do with what the guard protects. The `admin-` prefix keeps that guard exact
 * and untouched, and it is also the more honest name: this reader is bound to
 * the ADMIN boundary and to no other role.
 *
 * ===========================================================================
 * DIVISION OF LABOUR
 * ===========================================================================
 * The ORDER, the plan-absent view, the definition resolution, the assignment
 * count join, the deterministic sort, the missing-definition invariant and the
 * shape of the result all live in the pure, dependency-injected core of this
 * slice — `admin-exam-session-read-core`, proven by a DB-free suite. (It is
 * named WITHOUT a module path on purpose: the committed containment suites
 * forbid a path-shaped reference to an unwired exam core from outside
 * `lib/exam`, and a comment is source text like any other.)
 *
 * And here: the REAL admin, policy, date-conversion and database bindings, and
 * nothing else. This file contains no ordering decision, no join rule, no
 * normalization and no outcome of its own — it hands the core its effects and
 * returns the core's result unchanged.
 *
 * ===========================================================================
 * A READ, AND ONLY A READ
 * ===========================================================================
 * Every database statement here is a single `findUnique` / `findMany` /
 * `groupBy`. There is no `create`, `update`, `upsert`, `delete`, `deleteMany`,
 * `updateMany`, `createMany`, `$executeRaw`, `$queryRaw` or transaction anywhere
 * in this file, and none may be added: the exam WRITE surface is a separate,
 * already-authorized slice, and this module must never gain the ability to
 * change the schedule it displays.
 *
 * ===========================================================================
 * THE CALLER SUPPLIES A REQUEST, NEVER A GRANT
 * ===========================================================================
 * The single parameter is a REQUESTED `courseOfferingId`. There is no parameter
 * for a `planId`, a `definitionId`, a `sessionId`, a date, an actor id, a page
 * size or a filter.
 *
 * `requireAdminCourseOffering` runs `requireAdmin()` FIRST — redirecting an
 * unauthenticated or non-admin caller before any offering is looked up, so an
 * anonymous caller cannot probe which offering ids exist — and only the
 * DB-VERIFIED id it returns reaches the ExamPlan query. The plan id is therefore
 * always server-derived, and the definition read, the session read and the
 * assignment count are all scoped by it.
 *
 * ===========================================================================
 * THE COURSE-LIFECYCLE GATE IS THE *READ* GATE
 * ===========================================================================
 * The gate is the existing `HISTORICAL_READ` operation, which the committed
 * policy allows for PLANNED, ACTIVE and ARCHIVED offerings — and which is
 * DEFAULT-DENY for any status the policy does not classify.
 *
 * That is the correct classification for this surface, and it is deliberately
 * NOT the `SCHEDULE_DRAFT_CONFIGURATION` gate the session WRITES use: an
 * ARCHIVED offering's exam schedule remains readable history while its sessions
 * may no longer be edited, and borrowing the write gate here would quietly make
 * that history unreadable.
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
 * query selects six columns. The session query selects exactly the nine columns
 * the stored row declares. The assignment query selects NO column at all — it is
 * a grouped COUNT.
 *
 * In particular the session select OMITS every deprecated and out-of-scope
 * column the table still carries: the retired phase marker, the beginner format,
 * `endTime`, `capacity`, the interface-riding back-reference, the beginner-copy
 * provenance pair, the role label overrides, the per-session publication stamp
 * and `createdAt`. No assignment record, supervisor, break, beginner child,
 * student, instructor or Teaching-Practice lesson is read, and NO relation is
 * `include`d anywhere. A column that is never selected cannot be leaked by a
 * later mapper, which is stronger than a rule someone must remember. The Exams
 * area models no grade, score or evaluation at all.
 *
 * ===========================================================================
 * ONE BATCHED COUNT — NEVER ONE PER SESSION
 * ===========================================================================
 * Assignment load is read as a single `groupBy` over `sessionId`, scoped to the
 * server-resolved plan through a WHERE-clause relation FILTER — which is a join
 * condition, not an `include`, so no `ExamSession` row and no relation object is
 * materialized by it. There is exactly one such statement, it is not inside a
 * loop or a per-row callback, and the pure core indexes its groups in memory. A
 * session with no group is reported as zero by the core.
 *
 * The definitions are likewise read ONCE for the whole plan and used both as the
 * picker's options and as the map that names each session, so there is no
 * per-session definition fetch either.
 *
 * ===========================================================================
 * DATES ARE CONVERTED HERE, AND NOWHERE ELSE
 * ===========================================================================
 * Two conversions, both through the repository's shared, UTC-anchored helpers,
 * and both only in this file:
 *
 *   `DateTime` stamps -> EPOCH MILLISECONDS  (`publishedAt`, `updatedAt`)
 *   `@db.Date`        -> `YYYY-MM-DD` key    (`dateKey(row.date)`)
 *
 * `dateKey` slices the ISO string, which is why a calendar date read out here
 * matches the one `parseDateKey` wrote in the committed write binding, byte for
 * byte. Keeping the conversion HERE is what stops a locale or a server timezone
 * from shifting a stored exam date by a day — no `Date` ever reaches the pure
 * core or the returned view.
 */
import "server-only";

import type { CourseOfferingStatus } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { dateKey } from "@/lib/dates";
import { requireAdminCourseOffering } from "@/lib/course/admin-course-context";
import { assertCourseOperationAllowed } from "@/lib/course/operation-policy-core";
import {
  readAdminExamSessionsWithDeps,
  type AdminExamSessionsView,
  type ExamSessionAssignmentCountRow,
  type ResolvedExamPlanForSessionRead,
  type StoredAdminExamSessionRow,
  type StoredExamSessionDefinitionRow,
  type VerifiedExamSessionReadCourseContext,
} from "@/lib/exam/admin-exam-session-read-core";

export type {
  AdminExamSessionsView,
  AdminExamSessionView,
  AdminExamSessionDefinitionOption,
} from "@/lib/exam/admin-exam-session-read-core";

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
): Promise<VerifiedExamSessionReadCourseContext> {
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
// The database bindings — four statements, all reads
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
): Promise<ResolvedExamPlanForSessionRead | null> {
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
 * SIX columns — narrower than the definition-management read, because this
 * surface shows a schedule, not a configuration screen: the `requires*` flags,
 * the row's version stamp and `createdAt` are not read at all. No `planId` is
 * echoed back and no `sessions` relation is included.
 */
async function findDefinitionsByPlanId(
  planId: string,
): Promise<readonly StoredExamSessionDefinitionRow[]> {
  return prisma.examDefinition.findMany({
    where: { planId },
    select: {
      id: true,
      name: true,
      kind: true,
      durationMinutes: true,
      parallelCapacity: true,
      orderIndex: true,
    },
    orderBy: [{ orderIndex: "asc" }, { id: "asc" }],
  });
}

/**
 * EVERY stored `ExamSession` of ONE plan, in ONE query, in the schedule order.
 *
 * The order is `date`, `orderIndex`, `startTime`, `id` — matching the committed
 * `@@index([planId, date, orderIndex])` and the pure core's locked total order,
 * which re-imposes it regardless so the two layers cannot disagree.
 *
 * The select is exactly the nine columns the stored row declares. Everything the
 * header lists as omitted is omitted HERE, in the select, rather than stripped
 * later: the retired phase marker, the beginner format, `endTime`, `capacity`,
 * the interface-riding back-reference, the beginner-copy provenance pair, the
 * role label overrides, the per-session publication stamp, `createdAt`, and the
 * `planId` this read already knows. No relation is included — not the
 * definition, not the assignments, not the supervisors, not the breaks, not the
 * beginner children and not the source lesson.
 */
async function findSessionsByPlanId(
  planId: string,
): Promise<readonly StoredAdminExamSessionRow[]> {
  const rows = await prisma.examSession.findMany({
    where: { planId },
    select: {
      id: true,
      definitionId: true,
      date: true,
      startTime: true,
      arena: true,
      title: true,
      notes: true,
      orderIndex: true,
      updatedAt: true,
    },
    orderBy: [
      { date: "asc" },
      { orderIndex: "asc" },
      { startTime: "asc" },
      { id: "asc" },
    ],
  });

  // The ONLY `Date` conversions of this slice, both through the repository's
  // shared UTC-anchored helpers. Nothing above this line sees a `Date`, and the
  // mapping introduces no query of its own.
  return rows.map((row) => ({
    id: row.id,
    definitionId: row.definitionId,
    dateKey: dateKey(row.date),
    startTime: row.startTime,
    arena: row.arena,
    title: row.title,
    notes: row.notes,
    orderIndex: row.orderIndex,
    updatedAt: row.updatedAt.getTime(),
  }));
}

/**
 * How many trainees are assigned to each session of THIS plan — ONE grouped,
 * batched count, and the only `ExamAssignment` statement in this module.
 *
 * Grouped by `sessionId` and scoped through a relation FILTER on the
 * server-resolved plan. That filter is a WHERE condition, not an `include`: it
 * constrains which assignment rows are counted without materializing a single
 * `ExamSession` object, so no session column travels on this statement.
 *
 * NO column of `ExamAssignment` is selected — not the student, the role, the
 * horse name, the instruction topic, the discipline, the pairing index or the
 * notes — because a count needs none of them, and this surface displays none.
 * WHO is on a session is a different read behind a different authorization
 * decision.
 *
 * `_all` is the row count of each group. A session with no assignment produces
 * NO group at all, which the pure core reports as zero.
 */
async function countAssignmentsBySessionId(
  planId: string,
): Promise<readonly ExamSessionAssignmentCountRow[]> {
  const groups = await prisma.examAssignment.groupBy({
    by: ["sessionId"],
    where: { session: { planId } },
    _count: { _all: true },
  });

  return groups.map((group) => ({
    sessionId: group.sessionId,
    assignmentCount: group._count._all,
  }));
}

// ===========================================================================
// The single entry point
// ===========================================================================

/**
 * Read EVERY stored ExamSession of ONE course offering's exam plan, for an admin.
 *
 * Order (the pure core's contract, bound here to real effects):
 *   1. `requireAdminCourseOffering(courseOfferingId)` — admin first, then the
 *      exact offering; a redirect for a non-admin caller propagates untouched;
 *   2. `assertCourseOperationAllowed(status, "HISTORICAL_READ")`;
 *   3. ONE `prisma.examPlan.findUnique` on the VERIFIED offering id;
 *   4. no plan -> the core's plan-absent view, and no further query;
 *   5. ONE `prisma.examDefinition.findMany` on the SERVER-resolved plan id;
 *   6. ONE `prisma.examSession.findMany` on the SAME server-resolved plan id;
 *   7. nothing renderable -> the empty view, and NO count query;
 *   8. ONE `prisma.examAssignment.groupBy` for the whole plan.
 *
 * NOTHING is classified: the typed offering not-found, the typed lifecycle
 * denial, an infrastructure failure and the authorization redirect all propagate
 * with their identity intact. A read must never turn a denial into an empty
 * schedule — the surface that renders this view decides how to say each sentence
 * (`notFound()` for a page, an error result for an action).
 */
export async function readAdminExamSessions(
  courseOfferingId: string,
): Promise<AdminExamSessionsView> {
  return readAdminExamSessionsWithDeps(courseOfferingId, {
    requireCourseContext,
    assertHistoricalReadAllowed,
    findExamPlanByCourseOfferingId,
    findDefinitionsByPlanId,
    findSessionsByPlanId,
    countAssignmentsBySessionId,
  });
}
