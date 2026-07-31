/**
 * EXAM EX-SUP-IO1 — the ADMIN supervisor READS: the eligible-instructor picker
 * and the stored-supervisor list, bound to real effects.
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
 * network id. `readEligibleExamSupervisorsForAdmin` and
 * `readAdminExamSupervisors` are ORDINARY async server functions. The Server
 * Actions, the route, the page and the admin UI that will eventually call them
 * are a LATER, separately reviewed slice; NOTHING in `app/` or `components/`
 * calls this today, and this slice adds no page, route, form or capability.
 *
 * ===========================================================================
 * A READ, AND ONLY A READ
 * ===========================================================================
 * Every database statement here is a single `findUnique` / `findMany`. No
 * mutating Prisma method, no raw SQL and no transaction appears anywhere in this
 * file — not one such method name is even spelled in it — and none may be added:
 * the supervisor WRITE surface is a separate, separately reviewed module, and
 * this one must never gain the ability to change the staffing it displays.
 *
 * ===========================================================================
 * DIVISION OF LABOUR
 * ===========================================================================
 * The two total orders, the published shapes, the unreadable-name placeholder,
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
 * no parameter for a `planId`, a `sessionId`, an `instructorId`, a supervisor
 * id, a date, an actor id, a page size, a cursor or a filter.
 *
 * `requireAdminCourseOffering` runs `requireAdmin()` FIRST — redirecting an
 * unauthenticated or non-admin caller before any offering is looked up, so an
 * anonymous caller cannot probe which offering ids exist — and only the
 * DB-VERIFIED id it returns reaches a query. The stored-supervisor read is
 * scoped by the plan id derived from that verified offering id.
 *
 * ===========================================================================
 * THE PICKER IS NOT COURSE-SCOPED, AND THAT IS STATED RATHER THAN HIDDEN
 * ===========================================================================
 * The eligible-instructor query is scoped by `isActive: true` and by NOTHING
 * ELSE. This database has NO relation between an `Instructor` and a
 * `CourseOffering`, so there is no fact the server could scope it by, and this
 * module does not invent one: no enrolment, no course capability, no course
 * group, no Teaching Practice, no riding-schedule presence, no borrowed
 * capability from another module and no new permission column.
 *
 * The consequence is real: the picker lists EVERY active instructor, not the
 * instructors of this course. That is exactly the rule the committed write
 * binding enforces, so the picker cannot offer a choice the write would refuse —
 * but it is a limitation, not a design, and it must be revisited together with
 * the write rule the moment the schema can express course-scoped staffing.
 *
 * The offering id is still REQUIRED here: it is what the admin boundary and the
 * lifecycle gate act on, and it is the seam a course-scoped query will use.
 *
 * ===========================================================================
 * THE COURSE-LIFECYCLE GATE IS THE *READ* GATE
 * ===========================================================================
 * The gate is the existing `HISTORICAL_READ` operation, which the committed
 * policy allows for PLANNED, ACTIVE and ARCHIVED offerings — and which is
 * DEFAULT-DENY for any status the policy does not classify.
 *
 * That is deliberately NOT the `SCHEDULE_DRAFT_CONFIGURATION` gate the
 * supervisor WRITES use: an ARCHIVED offering's staffing remains readable
 * history while it may no longer be changed, and borrowing the write gate here
 * would quietly make that history unreadable.
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
 * The ONE absence these functions report is the honest one: a database with no
 * active instructor, and an offering with no exam plan or no stored supervisor.
 * Each is the core's frozen empty view, and none is a refusal. The no-plan case
 * is the ONLY reason the stored list short-circuits, and it costs no further
 * query.
 *
 * ===========================================================================
 * THE STORED LIST IS HISTORY, READ IN ONE STATEMENT
 * ===========================================================================
 * The stored read answers "who IS recorded?", and it applies NO activity filter,
 * NO current-eligibility filter, NO course-assignment filter, NO capability or
 * permission filter and NO schedule-participation filter. An instructor who is
 * later deactivated MUST still appear on the sessions they were recorded on — a
 * row that silently disappeared would leave a session looking unstaffed and
 * would make a stale plan impossible to correct.
 *
 * It is ONE `findMany` for EVERY session of the plan, scoped by a WHERE-clause
 * relation filter. There is no loop around a query and no per-session statement:
 * a plan with forty sessions costs the same two statements as a plan with one.
 *
 * ===========================================================================
 * NARROW SELECTS — NOTHING TO STRIP EVER LEAVES THE DATABASE
 * ===========================================================================
 * The instructor query selects the id and the full name. The plan query selects
 * the plan's id. The stored query selects two of its own columns plus the
 * instructor's full name.
 *
 * NOT selected anywhere, and therefore not leakable by any later mapper: the
 * instructor's identity number, phone, email, activity flag, creation and
 * modification timestamps, and every `canXxx` permission column; and
 * `Instructor.id` on the STORED path specifically — the list DISPLAYS who is
 * recorded, and the removal path already identifies its target by the SUPERVISOR
 * id. No trainee, parent, guardian or child record is read, no Teaching-Practice
 * model, no beginner child, no assignment, no break and no signed form, and NO
 * relation is `include`d anywhere. The Exams area models no evaluation at all.
 *
 * ===========================================================================
 * NO DATE CONVERSION EXISTS HERE
 * ===========================================================================
 * Not one selected column is a calendar value or an instant, so this module
 * needs no date helper and carries no timezone decision. Every value it hands
 * the pure core is already a string.
 */
import "server-only";

import type { CourseOfferingStatus } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdminCourseOffering } from "@/lib/course/admin-course-context";
import { assertCourseOperationAllowed } from "@/lib/course/operation-policy-core";
import {
  buildAdminExamSupervisorListView,
  buildEligibleExamSupervisorListView,
  emptyAdminExamSupervisorListView,
  type AdminExamSupervisorListView,
  type EligibleExamSupervisorListView,
} from "@/lib/exam/admin-exam-supervisor-read-core";

export type {
  AdminExamSupervisorListView,
  AdminExamSupervisorRow,
  EligibleExamSupervisorListView,
  EligibleExamSupervisorOption,
} from "@/lib/exam/admin-exam-supervisor-read-core";

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
 * sessions, no definitions and no offering relation.
 */
function findExamPlanByCourseOfferingId(
  verifiedCourseOfferingId: string,
): Promise<{ id: string } | null> {
  return prisma.examPlan.findUnique({
    where: {
      courseOfferingId: verifiedCourseOfferingId,
    },
    select: {
      id: true,
    },
  });
}

// ===========================================================================
// 1. The eligible-instructor picker
// ===========================================================================

/**
 * Every instructor who may be recorded as a supervisor RIGHT NOW.
 *
 * Order (bound here to real effects):
 *   1. `requireAdminCourseOffering(courseOfferingId)` — admin first, then the
 *      exact offering; a redirect for a non-admin caller propagates untouched;
 *   2. `assertCourseOperationAllowed(status, "HISTORICAL_READ")`;
 *   3. ONE `prisma.instructor.findMany`;
 *   4. the pure core's total order, narrow shape and deep freeze.
 *
 * The single eligibility condition is a WHERE clause, not an application filter:
 * `isActive: true`, which is exactly what the committed write path re-verifies.
 * The header states plainly why there is no course condition to add.
 *
 * TWO columns leave the database. The identity number, phone, email, activity
 * flag, timestamps and every `canXxx` permission column are not selected, so no
 * later mapper could publish one.
 *
 * The database ORDER BY is the same order the pure core re-imposes, so the two
 * layers cannot disagree; the core's is authoritative, and it is a TOTAL order,
 * which the database's collation alone would not guarantee.
 *
 * NOTHING is classified: a denial, a redirect and an infrastructure failure all
 * propagate, and an authorized admin looking at a database with no active
 * instructor gets the core's frozen empty view — never a refusal dressed up as
 * an empty picker.
 */
export async function readEligibleExamSupervisorsForAdmin(
  courseOfferingId: string,
): Promise<EligibleExamSupervisorListView> {
  const context = await requireCourseContext(courseOfferingId);
  assertHistoricalReadAllowed(context.status);

  const rows = await prisma.instructor.findMany({
    where: {
      isActive: true,
    },
    select: {
      id: true,
      fullName: true,
    },
    orderBy: [
      {
        fullName: "asc",
      },
      {
        id: "asc",
      },
    ],
  });

  return buildEligibleExamSupervisorListView(
    rows.map((row) => ({
      instructorId: row.id,
      fullName: row.fullName,
    })),
  );
}

// ===========================================================================
// 2. The stored-supervisor list
// ===========================================================================

/**
 * Every stored ExamSessionSupervisor under ONE course offering's exam plan.
 *
 * Order (bound here to real effects):
 *   1. `requireAdminCourseOffering(courseOfferingId)` — admin first, then the
 *      exact offering; a redirect for a non-admin caller propagates untouched;
 *   2. `assertCourseOperationAllowed(status, "HISTORICAL_READ")`;
 *   3. ONE `prisma.examPlan.findUnique` on the VERIFIED offering id;
 *   4. no plan -> the core's frozen empty view, and NO further query;
 *   5. ONE `prisma.examSessionSupervisor.findMany` scoped to the SERVER-resolved
 *      plan — one statement for EVERY session, never one per session;
 *   6. the pure core's total order, narrow shape and deep freeze.
 *
 * The scope is a WHERE-clause relation FILTER on the session's plan — a join
 * condition, not an `include`, so no `ExamSession` row is materialized and no
 * session column travels on this statement. A supervisor of another course is
 * never asked for.
 *
 * THIS IS HISTORY, and it is read as such, for the reason the header gives: no
 * activity filter, no eligibility filter, no capability filter and no
 * application-side filtering of any kind.
 *
 * `Instructor.id` is deliberately NOT selected. The relation is REQUIRED in the
 * schema, so the name is always readable; the pure core still resolves an
 * unreadable one to its ONE fixed placeholder, and this binding invents no name
 * of its own.
 *
 * The database ORDER BY matches the core's total order, and the core re-imposes
 * it regardless.
 *
 * NOTHING is classified, for the reason the header states.
 */
export async function readAdminExamSupervisors(
  courseOfferingId: string,
): Promise<AdminExamSupervisorListView> {
  const context = await requireCourseContext(courseOfferingId);
  assertHistoricalReadAllowed(context.status);

  const plan = await findExamPlanByCourseOfferingId(context.courseOfferingId);

  // An offering with no exam plan has no supervisor to show. That is an honest
  // absence, not a refusal, and it costs no further query.
  if (plan === null) {
    return emptyAdminExamSupervisorListView();
  }

  const rows = await prisma.examSessionSupervisor.findMany({
    where: {
      session: {
        planId: plan.id,
      },
    },
    select: {
      id: true,
      sessionId: true,
      instructor: {
        select: {
          fullName: true,
        },
      },
    },
    orderBy: [
      {
        sessionId: "asc",
      },
      {
        instructor: {
          fullName: "asc",
        },
      },
      {
        id: "asc",
      },
    ],
  });

  return buildAdminExamSupervisorListView(
    rows.map((row) => ({
      supervisorId: row.id,
      sessionId: row.sessionId,
      instructorName: row.instructor.fullName,
    })),
  );
}
