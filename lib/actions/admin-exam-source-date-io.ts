/**
 * EXAM EX-ADMIN-SRCDATE — the REAL admin, course-lifecycle and Prisma bindings
 * for the ONE manager operation that REPLACES an exam plan's Teaching-Practice
 * source-date selection.
 *
 * SERVER-ONLY BY DECLARATION. `import "server-only"` — the repository convention
 * already used by the exam read, plan-write, definition-write, session-write and
 * publication-write bindings in this directory — turns an accidental import from
 * a client module into a BUILD ERROR. That matters on its own terms here: this
 * module binds admin authorization, the course lifecycle policy and a Prisma
 * WRITE.
 *
 * DELIBERATELY NOT A `"use server"` MODULE. Everything exported from a
 * `"use server"` file becomes a PUBLICLY CALLABLE Server Action with a stable
 * network id — and this one WRITES. `replaceExamSourceDates` is an ORDINARY
 * server function; the route's Server Action is the only thing that calls it.
 *
 * ===========================================================================
 * WHY THIS WRITER EXISTS AT ALL
 * ===========================================================================
 * Beginner exams are a LIVE PROJECTION of Teaching Practice, and the exam module
 * stores exactly ONE beginner fact: which Teaching-Practice DATES this plan runs
 * as exam days. Nothing in the product could write that fact — the plan,
 * definition, session, assignment, pairing and publication writers all
 * deliberately refuse to touch it — so every plan held an empty selection, and
 * an empty selection makes the read pipeline project NO beginner rows. Beginner
 * exams were therefore invisible on every screen, by construction.
 *
 * This binding is the missing half. It writes DATE ROWS AND NOTHING ELSE:
 *
 *  - it CREATES NO Teaching-Practice data. No lesson, participant, child, horse,
 *    contact or note is written, copied, snapshotted or duplicated anywhere. It
 *    reads Teaching Practice for ONE purpose — to confirm that a submitted date
 *    actually holds a lesson — and it reads only the DATE column to do it;
 *  - it INFERS NO DATE. There is no "all course dates" arm, no weekday rule and
 *    no range expansion: a date is stored because the manager submitted that
 *    exact token, which is the product rule the schema records;
 *  - it accepts NO Teaching-Practice id. The only client-supplied values it can
 *    see are `YYYY-MM-DD` tokens.
 *
 * ===========================================================================
 * DIVISION OF LABOUR
 * ===========================================================================
 * The pure core owns EVERY decision: the order in which the boundary, the
 * lifecycle gate, the containment level, the plan lookup, the practice probe and
 * the write happen; which submissions are refused and with which closed codes;
 * that duplicates collapse; that an empty selection is legal; and that an
 * unchanged submission writes nothing.
 *
 * This module owns NONE of that. It contains no ordering decision, no validation
 * table, no level rule and no outcome code of its own: it hands the core its
 * effects and its two error classifiers, and returns the core's frozen result
 * unchanged.
 *
 * (The core is named WITHOUT a module path in this prose on purpose: the
 * committed containment suites forbid a path-shaped reference to an unwired exam
 * core from outside `lib/exam`, and a comment is source text like any other.)
 *
 * ===========================================================================
 * THE REPLACEMENT IS ATOMIC, AND IT IS ONE STATEMENT PAIR IN ONE TRANSACTION
 * ===========================================================================
 * `$transaction([deleteMany, createMany])` — the delete and the insert commit
 * together or not at all. A plan can therefore never be observed holding a
 * half-written selection, which matters more here than anywhere else in the exam
 * module: a partially-applied selection is indistinguishable, to every reader and
 * to the manager, from a deliberate one.
 *
 * NO RAW SQL. Both statements are ordinary Prisma model calls, scoped by the
 * `planId` the module itself looked up from the VERIFIED offering — never by a
 * value that came off the wire.
 */
import "server-only";

import type { CourseOfferingStatus } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { dateKey, parseDateKey } from "@/lib/dates";
import {
  requireAdminCourseOffering,
  CourseOfferingNotFoundError,
} from "@/lib/course/admin-course-context";
import {
  assertCourseOperationAllowed,
  CourseOperationNotPermittedError,
} from "@/lib/course/operation-policy-core";
import { isBeginnerSourceCourseLevel } from "@/lib/exam/exam-beginner-course-scope-core";
import {
  replaceExamSourceDatesWithDeps,
  type ExamSourceDateCourseContext,
  type ReplaceExamSourceDatesResult,
} from "@/lib/exam/admin-exam-source-date-core";

export type {
  ReplaceExamSourceDatesReason,
  ReplaceExamSourceDatesResult,
} from "@/lib/exam/admin-exam-source-date-core";

// ===========================================================================
// The pure predicate the ADMIN SCREEN is allowed to ask
// ===========================================================================

/**
 * May an offering at this level hold beginner exams at all?
 *
 * A one-line delegation to the committed containment predicate, re-exported here
 * so the admin workspace can render the right empty state — "this course level
 * has no beginner exams" is a different fact from "no dates are selected", and a
 * screen that could not tell them apart would send a manager looking for a
 * selection that could never help.
 *
 * It is a DISPLAY question and never an enforcement: the writer below asks the
 * same committed predicate for itself, before it reads or writes anything.
 */
export function examBeginnerDatesSupportedForLevel(courseLevel: unknown): boolean {
  return isBeginnerSourceCourseLevel(courseLevel);
}

// ===========================================================================
// The trust boundary
// ===========================================================================

/**
 * Admin + exact offering.
 *
 * `requireAdmin()` runs inside `requireAdminCourseOffering` BEFORE the offering
 * is looked up, so an unauthenticated caller is redirected rather than told
 * whether an offering id exists.
 *
 * FIVE facts are carried forward and no more: the verified id, the lifecycle
 * status, the level the containment rule is decided from, and the two calendar
 * bounds a submitted date is checked against. The offering's name, ActivityYear,
 * enrolments and roster are none of this operation's business, and the narrowing
 * is what keeps them out of the pure core.
 *
 * The two `@db.Date` columns become `YYYY-MM-DD` tokens HERE, at the single IO
 * boundary — so no `Date` ever crosses into the pure core and no timezone shift
 * can move a bound to the neighbouring day.
 */
async function requireCourseContext(
  requestedCourseOfferingId: string,
): Promise<ExamSourceDateCourseContext> {
  const context = await requireAdminCourseOffering(requestedCourseOfferingId);
  return {
    courseOfferingId: context.id,
    status: context.status,
    courseLevel: context.level,
    courseStartDate: context.startDate === null ? null : dateKey(context.startDate),
    courseEndDate: context.endDate === null ? null : dateKey(context.endDate),
  };
}

/**
 * The lifecycle gate. The cast restores the generated enum that the pure policy
 * deliberately widened to `string`; it is safe because the committed policy is
 * DEFAULT-DENY — an unrecognized status is refused, never waved through.
 *
 * It is the WRITE gate and not the read gate: selecting exam dates is
 * configuration, exactly as creating a session or a definition is.
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
 * The plan of ONE verified offering, or `null`.
 *
 * `courseOfferingId` is `@unique`, so this is a point lookup. Only the id is
 * selected: the publication state, the definitions and the sessions are none of
 * this operation's business.
 */
async function findPlanIdByCourseOfferingId(courseOfferingId: string): Promise<string | null> {
  const row = await prisma.examPlan.findUnique({
    where: { courseOfferingId },
    select: { id: true },
  });
  return row === null ? null : row.id;
}

/**
 * The selection the plan holds RIGHT NOW, as `YYYY-MM-DD` tokens.
 *
 * Read for ONE purpose: so an unchanged submission can be reported as a no-op
 * instead of being written. `(planId, date)` is unique, so the ascending order is
 * total.
 */
async function findStoredSourceDates(planId: string): Promise<readonly string[]> {
  const rows = await prisma.examTeachingPracticeSourceDate.findMany({
    where: { planId },
    select: { date: true },
    orderBy: { date: "asc" },
  });
  return rows.map((row) => dateKey(row.date));
}

/**
 * WHICH of these dates actually hold a Teaching-Practice lesson.
 *
 * A CLOSED question over an explicit list, never an open enumeration: the caller
 * passes the exact tokens to test, so this can never be used to discover what
 * Teaching Practice contains.
 *
 * The select is the DATE COLUMN AND NOTHING ELSE. No lesson id, participant,
 * child, horse, equipment, contact, instructor, time, format or note is read, so
 * no Teaching-Practice content can reach the exam module through this path — and
 * nothing is copied, snapshotted or duplicated by asking.
 */
async function findPracticeDates(dates: readonly string[]): Promise<readonly string[]> {
  const rows = await prisma.teachingPracticeLesson.findMany({
    where: { date: { in: dates.map((value) => parseDateKey(value)) } },
    select: { date: true },
  });
  return rows.map((row) => dateKey(row.date));
}

/**
 * The REPLACEMENT — one delete and one insert, in ONE transaction.
 *
 * Both statements are scoped by the `planId` this module looked up from the
 * VERIFIED offering, so neither can reach another course's plan even if a
 * submitted value were forged. `skipDuplicates` is belt-and-braces beside the
 * core's own deduplication and the `(planId, date)` unique index.
 *
 * An EMPTY set is a legitimate replacement: the delete runs, the insert writes
 * nothing, and the plan correctly ends up holding no beginner dates.
 */
async function replaceSourceDates(planId: string, dates: readonly string[]): Promise<void> {
  await prisma.$transaction([
    prisma.examTeachingPracticeSourceDate.deleteMany({ where: { planId } }),
    prisma.examTeachingPracticeSourceDate.createMany({
      data: dates.map((value) => ({ planId, date: parseDateKey(value) })),
      skipDuplicates: true,
    }),
  ]);
}

// ===========================================================================
// The one public operation
// ===========================================================================

/**
 * Replace the COMPLETE Teaching-Practice source-date selection of ONE course
 * offering's exam plan.
 *
 * THE ORDER is the pure core's and is restated here only as documentation:
 *
 *   1. `requireAdminCourseOffering(courseOfferingId)` — admin FIRST, then the
 *      exact offering. Only the typed not-found is classified;
 *   2. `assertCourseOperationAllowed(status, "SCHEDULE_DRAFT_CONFIGURATION")` on
 *      the VERIFIED status — the WRITE gate;
 *   3. the committed beginner-level containment predicate, BEFORE any read;
 *   4. the plan lookup — no plan is a refusal, never an implicit create;
 *   5. the Teaching-Practice date probe, over the submitted tokens only, and
 *      skipped entirely for an empty selection;
 *   6. the stored selection, for the no-op comparison;
 *   7. the pure decision;
 *   8. ONE atomic replacement, and only when the set actually changed.
 *
 * `submitted` is a list of raw values off the wire and is typed `unknown[]` for
 * exactly that reason — the core validates every token and refuses the whole
 * submission if any is unusable.
 *
 * Only two failures are classified. Every other error propagates unchanged, so a
 * real defect is never laundered into a form error and the authorization
 * redirect is never swallowed: neither `instanceof` check matches a
 * `NEXT_REDIRECT` throw.
 */
export async function replaceExamSourceDates(
  courseOfferingId: string,
  submitted: readonly unknown[],
): Promise<ReplaceExamSourceDatesResult> {
  return replaceExamSourceDatesWithDeps(courseOfferingId, submitted, {
    requireCourseContext,
    assertConfigurationAllowed,
    findPlanIdByCourseOfferingId,
    findStoredSourceDates,
    findPracticeDates,
    replaceSourceDates,
    isCourseNotFoundError,
    isOperationNotAllowedError,
  });
}
