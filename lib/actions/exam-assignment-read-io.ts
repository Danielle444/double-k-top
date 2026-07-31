/**
 * EXAM EX-ASG-IO1 — the ADMIN assignment READS: the eligible-trainee picker and
 * the stored-assignment list, bound to real effects.
 *
 * SERVER-ONLY BY DECLARATION. `import "server-only"` — the repository
 * convention, already used by the exam read and write bindings in this
 * directory — turns an accidental import from a `"use client"` module into a
 * BUILD ERROR. That matters independently of everything else here: this module
 * holds the database client, the admin authorization boundary and the
 * course-lifecycle policy.
 *
 * DELIBERATELY NOT A `"use server"` MODULE. Everything exported from a
 * `"use server"` file becomes a PUBLICLY CALLABLE Server Action with a stable
 * network id. `readEligibleExamTraineesForAdmin` and `readAdminExamAssignments`
 * are ORDINARY async server functions. The Server Actions, the route, the page
 * and the admin UI that will eventually call them are a LATER, separately
 * reviewed slice; NOTHING in `app/` or `components/` calls this today, and this
 * slice adds no page, route, form or capability.
 *
 * ===========================================================================
 * A READ, AND ONLY A READ
 * ===========================================================================
 * Every database statement here is a single `findUnique` / `findMany`. There is
 * no `create`, `update`, `upsert`, `delete`, `deleteMany`, `updateMany`,
 * `createMany`, `aggregate`, `groupBy`, `$executeRaw`, `$queryRaw` or
 * transaction anywhere in this file, and none may be added: the assignment WRITE
 * surface is a separate, separately reviewed module, and this one must never
 * gain the ability to change the roster it displays.
 *
 * ===========================================================================
 * DIVISION OF LABOUR
 * ===========================================================================
 * The two total orders, the published shapes, the missing-trainee placeholder,
 * the deep freeze and the empty views all live in the pure, DB-free read-shaping
 * core of this slice, proven by its own runtime suite. (It is named WITHOUT a
 * module path on purpose: the committed containment suites forbid a path-shaped
 * reference to an unwired exam core from anywhere outside `lib/exam`, and a
 * comment is source text like any other.)
 *
 * And here: the REAL admin, policy and database bindings, and nothing else.
 * This file decides no order, builds no row and invents no outcome — it reads,
 * maps each row into the core's narrow input shape, and returns the core's view
 * unchanged.
 *
 * ===========================================================================
 * THE CALLER SUPPLIES A REQUEST, NEVER A GRANT
 * ===========================================================================
 * Each function's SINGLE parameter is a REQUESTED `courseOfferingId`. There is
 * no parameter for a `planId`, a `sessionId`, a `studentId`, an assignment id, a
 * role, a date, an actor id, a page size, a cursor or a filter.
 *
 * `requireAdminCourseOffering` runs `requireAdmin()` FIRST — redirecting an
 * unauthenticated or non-admin caller before any offering is looked up, so an
 * anonymous caller cannot probe which offering ids exist — and only the
 * DB-VERIFIED id it returns reaches a query. The enrolment read is scoped by
 * that verified offering id; the assignment read is scoped by the plan id
 * derived from it.
 *
 * ===========================================================================
 * THE COURSE-LIFECYCLE GATE IS THE *READ* GATE
 * ===========================================================================
 * The gate is the existing `HISTORICAL_READ` operation, which the committed
 * policy allows for PLANNED, ACTIVE and ARCHIVED offerings — and which is
 * DEFAULT-DENY for any status the policy does not classify.
 *
 * That is deliberately NOT the `SCHEDULE_DRAFT_CONFIGURATION` gate the
 * assignment WRITES use: an ARCHIVED offering's exam roster remains readable
 * history while its assignments may no longer be changed, and borrowing the
 * write gate here would quietly make that history unreadable.
 *
 * No new `CourseOfferingOperation` is introduced, the committed policy core is
 * not edited, and NO capability is consulted: there is no `EXAMS` capability (no
 * catalog key, no row, no reader), and no other module's capability is borrowed.
 *
 * ===========================================================================
 * A DENIAL IS NEVER AN EMPTY LIST
 * ===========================================================================
 * Nothing is caught here. The typed "that offering does not exist", the typed
 * lifecycle denial, an infrastructure failure and the authorization boundary's
 * redirect all propagate with their identity intact. "You may not see this" and
 * "there is nothing here" are different sentences, and the surface that
 * eventually renders these views is the layer that decides how to say each one.
 *
 * The ONE absence these functions do report is the honest one: an offering whose
 * roster is empty, and an offering with no exam plan or no assignments. Each is
 * the core's frozen empty view, and neither is a refusal.
 *
 * ===========================================================================
 * THE TWO READS HAVE DIFFERENT SCOPES, ON PURPOSE
 * ===========================================================================
 * The ELIGIBLE read answers "who may I assign right now?", so it constrains the
 * enrolment to `ACTIVE` and the trainee to `isActive`. Those are exactly the two
 * conditions the committed write path re-verifies before it writes a row, so the
 * picker cannot offer a choice the write would refuse. `isPrimary` is NOT read
 * and NOT selected: a combined trainee has an ACTIVE enrolment in each of her
 * courses, and either one makes her assignable in ITS OWN offering.
 *
 * The ASSIGNMENT read answers "who IS assigned?", and it is HISTORY. It applies
 * NO activity filter, NO enrolment filter and NO role filter, and it does not
 * join `CourseEnrollment` at all. A trainee who is later deactivated, or who
 * leaves the course, MUST still appear on the sessions she was assigned to —
 * a row that silently disappeared would leave a session looking emptier than it
 * is, and would make a stale schedule impossible to correct.
 *
 * ===========================================================================
 * NARROW SELECTS — NOTHING TO STRIP EVER LEAVES THE DATABASE
 * ===========================================================================
 * The enrolment query selects the trainee's id and full name. The plan query
 * selects the plan's id. The assignment query selects seven of its own columns
 * plus the trainee's full name.
 *
 * TWO of those seven are the DETAIL values the detailed create writer stores on an
 * examinee's row. They are the assignment's OWN columns — free text a manager
 * typed about the exam, not a fact about a person — so reading them widens what
 * this list can describe without widening WHOSE data it can reach: not one
 * additional `Student` column, not one additional relation, and not one additional
 * statement came with them.
 *
 * NOT selected anywhere, and therefore not leakable by any later mapper: the
 * trainee's identity number, phone, activity flag, group, subgroup, horse
 * fields and every parent, guardian or child contact; the enrolment's id,
 * status, `isPrimary`, dates and horse cache; the assignment's `pairingIndex`,
 * `sourcePracticeRole`, `notes`, `createdAt` and `updatedAt`; and `Student.id` on
 * the assignment path specifically — the list DISPLAYS who is assigned, and the
 * removal path already identifies its target by the ASSIGNMENT id. No
 * Teaching-Practice model, no beginner child, no supervisor, no break and no
 * signed form is read, and NO relation is `include`d anywhere. The Exams area
 * models no grade, score or evaluation at all.
 *
 * ===========================================================================
 * NO DATE CONVERSION EXISTS HERE
 * ===========================================================================
 * Not one selected column is a calendar value or an instant, so this module
 * needs no date helper and carries no timezone decision. Every value it hands
 * the pure core is already a string, a number or `null`.
 */
import "server-only";

import type { CourseOfferingStatus } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdminCourseOffering } from "@/lib/course/admin-course-context";
import { assertCourseOperationAllowed } from "@/lib/course/operation-policy-core";
import {
  buildAdminExamAssignmentListView,
  buildEligibleExamTraineeListView,
  emptyAdminExamAssignmentListView,
  type AdminExamAssignmentListView,
  type EligibleExamTraineeListView,
} from "@/lib/exam/admin-exam-assignment-read-core";

export type {
  AdminExamAssignmentListView,
  AdminExamAssignmentRow,
  EligibleExamTraineeListView,
  EligibleExamTraineeOption,
} from "@/lib/exam/admin-exam-assignment-read-core";

// ===========================================================================
// The trust boundary
// ===========================================================================

/**
 * Admin + exact offering.
 *
 * `requireAdmin()` runs inside `requireAdminCourseOffering` BEFORE the offering
 * is looked up, so an unauthenticated caller is redirected rather than told
 * whether an offering id exists. Only `id` and `status` are carried forward: the
 * name, level, ActivityYear and dates of the offering are none of these reads'
 * business, and the RAW requested id is used at this boundary and nowhere else.
 *
 * Shared by BOTH reads rather than declared twice, so the two can never drift
 * into different trust boundaries.
 */
async function requireCourseContext(
  requestedCourseOfferingId: string,
): Promise<{ courseOfferingId: string; status: string }> {
  const context = await requireAdminCourseOffering(requestedCourseOfferingId);
  return { courseOfferingId: context.id, status: context.status };
}

/**
 * The lifecycle READ gate. The cast restores the generated enum; it is safe
 * because the committed policy is DEFAULT-DENY — an unrecognized status is
 * refused, never allowed.
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
 * It selects the id and NOTHING else: no publication state, no source dates, no
 * sessions, no definitions and no offering relation. There is no upsert — a plan
 * is never created by a read.
 */
function findExamPlanByCourseOfferingId(
  verifiedCourseOfferingId: string,
): Promise<{ id: string } | null> {
  return prisma.examPlan.findUnique({
    where: { courseOfferingId: verifiedCourseOfferingId },
    select: { id: true },
  });
}

// ===========================================================================
// 1. The eligible-trainee picker
// ===========================================================================

/**
 * Every trainee who may be assigned in ONE course offering RIGHT NOW.
 *
 * Order (bound here to real effects):
 *   1. `requireAdminCourseOffering(courseOfferingId)` — admin first, then the
 *      exact offering; a redirect for a non-admin caller propagates untouched;
 *   2. `assertCourseOperationAllowed(status, "HISTORICAL_READ")`;
 *   3. ONE `prisma.courseEnrollment.findMany` on the VERIFIED offering id;
 *   4. the pure core's total order, narrow shape and deep freeze.
 *
 * The two eligibility conditions are a WHERE clause, not an application filter:
 * `status: "ACTIVE"` on the enrolment and `isActive: true` on the trainee, which
 * are exactly what the committed write path re-verifies. A trainee of ANOTHER
 * course is not filtered out — she is never asked for, because the enrolment
 * scope is the server-verified offering.
 *
 * The database ORDER BY is the same order the pure core re-imposes, so the two
 * layers cannot disagree; the core's is authoritative, and it is a TOTAL order,
 * which the database's collation alone would not guarantee.
 *
 * NOTHING is classified: a denial, a redirect and an infrastructure failure all
 * propagate, and an authorized admin looking at an empty roster gets the core's
 * frozen empty view — never a refusal dressed up as an empty picker.
 */
export async function readEligibleExamTraineesForAdmin(
  courseOfferingId: string,
): Promise<EligibleExamTraineeListView> {
  const context = await requireCourseContext(courseOfferingId);
  assertHistoricalReadAllowed(context.status);

  const rows = await prisma.courseEnrollment.findMany({
    where: {
      courseOfferingId: context.courseOfferingId,
      status: "ACTIVE",
      student: { isActive: true },
    },
    select: {
      studentId: true,
      student: { select: { fullName: true } },
    },
    orderBy: [{ student: { fullName: "asc" } }, { studentId: "asc" }],
  });

  return buildEligibleExamTraineeListView(
    rows.map((row) => ({
      studentId: row.studentId,
      fullName: row.student.fullName,
    })),
  );
}

// ===========================================================================
// 2. The stored-assignment list
// ===========================================================================

/**
 * Every stored ExamAssignment under ONE course offering's exam plan.
 *
 * Order (bound here to real effects):
 *   1. `requireAdminCourseOffering(courseOfferingId)` — admin first, then the
 *      exact offering; a redirect for a non-admin caller propagates untouched;
 *   2. `assertCourseOperationAllowed(status, "HISTORICAL_READ")`;
 *   3. ONE `prisma.examPlan.findUnique` on the VERIFIED offering id;
 *   4. no plan -> the core's frozen empty view, and NO further query;
 *   5. ONE `prisma.examAssignment.findMany` scoped to the SERVER-resolved plan;
 *   6. the pure core's total order, narrow shape and deep freeze.
 *
 * The scope is a WHERE-clause relation FILTER on the session's plan — a join
 * condition, not an `include`, so no `ExamSession` row is materialized and no
 * session column travels on this statement. An assignment of another course is
 * never asked for.
 *
 * THIS IS HISTORY, and it is read as such: no role filter, no activity filter,
 * no enrolment filter and no `CourseEnrollment` join. A trainee who has since
 * been deactivated or has left the offering still appears on the sessions she is
 * assigned to. An `INSTRUCTED_TRAINEE` row — which the current write surface
 * cannot produce — is likewise shown rather than hidden.
 *
 * `student` is a NULLABLE relation, so a row whose trainee link is absent maps
 * to a `null` name and the pure core resolves it to its ONE fixed placeholder.
 * `Student.id` is deliberately NOT selected.
 *
 * The database ORDER BY matches the core's total order, and the core re-imposes
 * it regardless — necessary rather than decorative, because the committed create
 * binding documents that two concurrent creates on one session may share an
 * `orderIndex`, so the id tie-break is what keeps the list stable between reads.
 *
 * NOTHING is classified, for the reason the header states.
 */
export async function readAdminExamAssignments(
  courseOfferingId: string,
): Promise<AdminExamAssignmentListView> {
  const context = await requireCourseContext(courseOfferingId);
  assertHistoricalReadAllowed(context.status);

  const plan = await findExamPlanByCourseOfferingId(context.courseOfferingId);

  // An offering with no exam plan has no assignment to show. That is an honest
  // absence, not a refusal, and it costs no further query.
  if (plan === null) {
    return emptyAdminExamAssignmentListView();
  }

  const rows = await prisma.examAssignment.findMany({
    where: { session: { planId: plan.id } },
    select: {
      id: true,
      sessionId: true,
      role: true,
      horseName: true,
      instructionTopic: true,
      discipline: true,
      orderIndex: true,
      student: { select: { fullName: true } },
    },
    orderBy: [{ sessionId: "asc" }, { orderIndex: "asc" }, { id: "asc" }],
  });

  return buildAdminExamAssignmentListView(
    rows.map((row) => ({
      assignmentId: row.id,
      sessionId: row.sessionId,
      role: row.role,
      traineeName: row.student === null ? null : row.student.fullName,
      horseName: row.horseName,
      instructionTopic: row.instructionTopic,
      discipline: row.discipline,
      orderIndex: row.orderIndex,
    })),
  );
}
