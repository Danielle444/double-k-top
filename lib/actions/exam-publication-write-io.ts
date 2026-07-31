/**
 * EX-PUB-BE-MVP — the REAL admin, course-lifecycle, clock and Prisma bindings for
 * the ONE manager action that PUBLISHES or UNPUBLISHES an ExamPlan.
 *
 * SERVER-ONLY BY DECLARATION. `import "server-only"` — the repository convention,
 * already used by the exam read, plan-write, definition-write and session-write
 * bindings in this directory — turns an accidental import from a client module
 * into a BUILD ERROR. That matters on its own terms here: this module binds admin
 * authorization, the course lifecycle policy, the server clock and a Prisma WRITE.
 *
 * DELIBERATELY NOT A `"use server"` MODULE. Everything exported from a
 * `"use server"` file becomes a PUBLICLY CALLABLE Server Action with a stable
 * network id — and this one WRITES. `setExamPlanPublication` is an ORDINARY
 * server function. The Server Action, the route and the admin button that
 * eventually call it are a LATER, separately reviewed slice; nothing in `app/`
 * calls this today.
 *
 * ===========================================================================
 * DIVISION OF LABOUR
 * ===========================================================================
 * The pure core owns EVERY decision: the order in which authorization, the
 * lifecycle gate, the operation check, the plan lookup and the write happen; that
 * an already-published plan is a SUCCESS rather than a refusal; that a re-publish
 * never moves the stored timestamp; that a zero write count is a stale write and
 * is never retried; and that only two typed errors are classified.
 *
 * This module owns NONE of that. It contains no ordering decision, no validation,
 * no policy table, no no-op rule and no outcome code of its own: it hands the core
 * its effects and its error classifiers, and returns the core's frozen result
 * unchanged.
 *
 * (The core is named WITHOUT a module path in this prose on purpose: the committed
 * containment suites forbid a path-shaped reference to an unwired exam core from
 * anywhere outside `lib/exam`, and a comment is source text like any other.)
 *
 * ===========================================================================
 * WHAT THE CALLER MAY SUPPLY
 * ===========================================================================
 * A REQUESTED `courseOfferingId` and a requested operation. There is no
 * parameter — and no object field — for a `planId`, a `publishedAt`, a clock, an
 * `individualPublishedAt`, a session id, an admin id or a transaction handle. Not
 * "ignored": ABSENT from the signature, so no future caller can pass one.
 *
 * THE TIMESTAMP IS THE POINT. `Date.now()` is read HERE, in one place, and handed
 * to the core as an epoch-millisecond number. A future Server Action reading
 * FormData therefore has no field through which a client could decide when a plan
 * was published — the parameter does not exist to be ignored.
 *
 * The `operation` parameter is typed as the core's two-value union AND re-checked
 * at runtime by the core's fail-closed predicate, because a `"use server"` caller
 * receives whatever the network sent and a TypeScript annotation is erased.
 *
 * The requested offering id is a REQUEST, not a grant. `requireAdminCourseOffering`
 * runs `requireAdmin()` FIRST — redirecting an unauthenticated or non-admin
 * caller — and only THEN looks up exactly that offering. Only the DB-VERIFIED id
 * it returns reaches the plan lookup and the write, so a caller cannot be
 * authorized for one offering while the write lands on another, and neither plan
 * EXISTENCE nor PUBLICATION STATE can be probed by an unauthorized caller:
 * no Prisma statement in this module runs before the admin boundary.
 *
 * ===========================================================================
 * THE COURSE-LIFECYCLE GATE — A TEMPORARY, DELIBERATE REUSE
 * ===========================================================================
 * The gate is the existing `SCHEDULE_DRAFT_CONFIGURATION` operation, which the
 * committed policy allows for PLANNED and ACTIVE offerings and denies for ARCHIVED
 * ones — and which is exactly the gate the committed exam plan-write,
 * definition-write and session-write bindings already use, so the exam module's
 * write surfaces cannot drift into different trust boundaries.
 *
 * A DELIBERATE CHOICE WORTH RE-EXAMINING, AND STATED SO IT IS NOT MISTAKEN FOR AN
 * OVERSIGHT: the policy also has a `SCHEDULE_PUBLICATION` operation, which is
 * denied for PLANNED offerings, and exam-plan publication is arguably a
 * publication rather than a draft configuration. Choosing it here would mean a
 * PLANNED offering could configure exams but never make them visible, which is a
 * PRODUCT decision, not a refactor. This MVP keeps the exam module on ONE gate and
 * flags the question rather than settling it unilaterally.
 *
 * This is a reuse of a course-LIFECYCLE classification, NOT of a capability. No
 * new `CourseOfferingOperation` is introduced, the committed policy core is not
 * edited, and NO capability is consulted: there is no EXAMS capability (no catalog
 * key, no row, no reader), and no other module's capability is borrowed — an exam
 * write must not silently inherit another module's product decisions, and a
 * placeholder check that always passes reads as enforcement to the next person who
 * edits this file.
 *
 * ===========================================================================
 * THE PRISMA SURFACE — TWO STATEMENTS, ONE MODEL, ONE COLUMN
 * ===========================================================================
 *   1. ONE `examPlan.findUnique` by the VERIFIED offering id, selecting `id` and
 *      `publishedAt` and nothing else;
 *   2. ONE CONDITIONAL `examPlan.updateMany` writing `publishedAt` and nothing
 *      else — and only when the pure core says the state actually changes.
 *
 * WHY `updateMany` AND NOT `update`. The write carries THREE conditions — the
 * server-resolved plan id, the VERIFIED offering id, and the expected publication
 * state — and only the `*Many` form accepts a non-unique filter. A blind
 * `update({ where: { id } })` would silently overwrite another manager's
 * concurrent publish or unpublish and would not be offering-scoped; a
 * read-then-compare in application code would be racy. `count === 0` therefore
 * means exactly one thing: the row is no longer what this call decided from, and
 * the pure core turns that into the stale-write refusal.
 *
 * THE EXPECTED-STATE PREDICATE IS EXACT. Publishing matches only a row whose
 * `publishedAt` IS NULL; unpublishing matches only a row whose `publishedAt`
 * equals the precise instant that was read. Millisecond precision is exact on both
 * sides, so the value read out round-trips to the same instant. A newer
 * publication timestamp can therefore never be silently overwritten.
 *
 * A NO-OP ISSUES NO STATEMENT AT ALL: the core returns before the write
 * dependency is reached, so an already-published plan is not re-stamped and an
 * already-unpublished one is not touched.
 *
 * There is deliberately NO `upsert` and NO `create`: publishing must never bring a
 * plan into existence. There is no `delete` of any kind. No transaction is opened
 * — the operation is ONE conditional statement, and a transaction would add cost
 * while suggesting a guarantee the condition already provides. There is no second
 * query after a successful write: the core already knows the instant it stored,
 * and re-reading it would only widen the window in which a stale value could be
 * reported.
 *
 * Nothing else is read or written: no `individualPublishedAt`, no session, no
 * definition, no assignment, no supervisor, no break, no source date, no offering
 * column, no enrollment, no person row. No raw SQL, no client escape hatch, no
 * revalidation, no notification, no push surface.
 *
 * ===========================================================================
 * ERRORS: TWO SHAPES CLASSIFIED, EVERYTHING ELSE PROPAGATES
 * ===========================================================================
 * Exactly two classifiers are bound — the project's typed offering not-found and
 * the committed policy's typed lifecycle denial, both matched BY IDENTITY. Every
 * unexpected Prisma failure propagates: there is no catch-all `catch` and no
 * generic failure code anywhere in this slice, because a generic code would let a
 * real defect render as an ordinary form error that nobody investigates.
 *
 * There is no unique-constraint classifier here, and none is needed: this module
 * writes a nullable, non-unique column and issues no insert, so a `P2002` cannot
 * arise from it. `updateMany` reports a count rather than throwing when nothing
 * matches, so there is no `P2025` to classify either.
 *
 * CRITICALLY, the admin boundary denies by REDIRECTING (a Next `NEXT_REDIRECT`
 * throw). Nothing here inspects, catches or translates it: neither `instanceof`
 * matches it, so the redirect reaches the framework untouched and is still
 * performed. A redirect must never become a refusal: an admin who is simply not
 * logged in would then see "not found" instead of the login page.
 *
 * ===========================================================================
 * ADMIN ONLY
 * ===========================================================================
 * There is no instructor and no trainee path in this module: no actor helper for
 * either role is imported, and the only authorization binding is the admin
 * course-context resolver. An instructor- or trainee-triggered publication would
 * be a different product decision requiring its own review.
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
  setExamPlanPublicationWithDeps,
  type ExamPlanPublicationRow,
  type ExamPublicationOperation,
  type SetExamPlanPublicationResult,
} from "@/lib/exam/exam-publication-write-core";

export type {
  ExamPublicationOperation,
  SetExamPlanPublicationResult,
} from "@/lib/exam/exam-publication-write-core";

// ===========================================================================
// The trust boundary
// ===========================================================================

/**
 * Admin + exact offering.
 *
 * `requireAdmin()` runs inside `requireAdminCourseOffering` BEFORE the offering is
 * looked up, so an unauthenticated caller is redirected rather than told whether
 * an offering id exists. Only `id` and `status` are carried forward: the name,
 * level, ActivityYear and dates of the offering are none of this operation's
 * business, and the narrowing is what keeps them out of the pure core.
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
 * DEFAULT-DENY — an unrecognized status is refused, never waved through.
 */
function assertConfigurationAllowed(status: string): void {
  assertCourseOperationAllowed(
    status as CourseOfferingStatus,
    "SCHEDULE_DRAFT_CONFIGURATION",
  );
}

/**
 * The SERVER clock, in epoch milliseconds — read HERE and nowhere else, so the
 * publication instant is server-generated by construction and no caller, form
 * field or future Server Action parameter can supply one.
 */
function currentTimeMs(): number {
  return Date.now();
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
 * The module's only READ: the plan of ONE VERIFIED offering, with the single
 * column this operation exists to change.
 *
 * `findUnique` on the `@unique` offering column, selecting `id` and `publishedAt`
 * ALONE. No definitions, no sessions, no source dates, no per-session
 * `individualPublishedAt`, no `createdAt`, no `updatedAt`, no offering relation:
 * the operation must not be able to make a decision from data it should not have
 * read, and must not be able to leak one into a result.
 *
 * The ONE conversion out of the database's instant type happens here, so no
 * calendar object ever reaches the pure core.
 */
async function findPlanPublicationByCourseOfferingId(
  verifiedCourseOfferingId: string,
): Promise<ExamPlanPublicationRow | null> {
  const row = await prisma.examPlan.findUnique({
    where: { courseOfferingId: verifiedCourseOfferingId },
    select: { id: true, publishedAt: true },
  });

  if (row === null) {
    return null;
  }
  return {
    id: row.id,
    publishedAt: row.publishedAt === null ? null : row.publishedAt.getTime(),
  };
}

/**
 * The SINGLE write, and it is CONDITIONAL: store the new publication state on the
 * plan identified by BOTH the server-resolved plan id AND the VERIFIED offering
 * id, and ONLY while its stored state still equals the one the decision was made
 * from.
 *
 * `updateMany` rather than `update`, because the filter is not unique and all
 * three conditions must be evaluated inside the statement by the DATABASE — not
 * by an application read a round trip earlier. `count === 0` means the row is no
 * longer one this decision applies to, and the pure core turns that into the
 * stale-write refusal rather than retrying.
 *
 * `courseOfferingId` is in the `where` alongside `id` even though the plan id was
 * itself resolved from that offering: it makes the scope a property of the
 * STATEMENT, greppable by a guard, rather than a property of the call sequence
 * that a future edit could quietly break.
 *
 * `data` carries exactly ONE column. `id`, `courseOfferingId` and `createdAt` are
 * absent, and `updatedAt` is written by the database's `@updatedAt` rather than by
 * this statement — the only place a version column appears here is the `where`
 * clause's expected publication state.
 *
 * The two conversions INTO the database's instant type happen here, once: `null`
 * stays `null` in both the predicate and the payload, and a number becomes the
 * exact instant it names. Millisecond precision is exact on both sides, so the
 * value the read handed out round-trips to the same instant.
 *
 * Called AT MOST ONCE per invocation, by the core's contract: there is no retry
 * loop here and none there, so a flapping database can never be turned into a
 * write storm, and a newer publication timestamp can never be overwritten by an
 * older decision.
 */
async function setPublicationIfCurrent(
  verifiedCourseOfferingId: string,
  planId: string,
  expectedPublishedAt: number | null,
  nextPublishedAt: number | null,
): Promise<boolean> {
  const expected = expectedPublishedAt === null ? null : new Date(expectedPublishedAt);
  const next = nextPublishedAt === null ? null : new Date(nextPublishedAt);

  const written = await prisma.examPlan.updateMany({
    where: {
      id: planId,
      courseOfferingId: verifiedCourseOfferingId,
      publishedAt: expected,
    },
    data: {
      publishedAt: next,
    },
  });
  return written.count > 0;
}

// ===========================================================================
// The operation
// ===========================================================================

/**
 * Publish or unpublish the ExamPlan of ONE authorized, lifecycle-permitted course
 * offering.
 *
 * Order (the pure core's contract, bound here to real effects):
 *   1. `requireAdminCourseOffering(courseOfferingId)` — admin FIRST, then the
 *      exact offering; a redirect for a non-admin caller propagates untouched;
 *   2. `assertCourseOperationAllowed(status, "SCHEDULE_DRAFT_CONFIGURATION")` on
 *      the VERIFIED status, BEFORE any exam query;
 *   3. the requested operation is one of the two known ones, BEFORE any exam
 *      query;
 *   4. ONE `examPlan.findUnique` on the VERIFIED offering id, selecting `id` and
 *      `publishedAt`;
 *   5. no plan -> the core's `plan_not_found` refusal; a plan is NEVER created
 *      here;
 *   6. the pure decision, from the STORED state and the SERVER clock;
 *   7. already in the requested state -> `NO_CHANGE`, with ZERO statements issued
 *      and the stored instant left exactly where it was;
 *   8. otherwise ONE conditional `examPlan.updateMany`;
 *   9. a zero write count -> the core's `stale_write` refusal, never a retry.
 *
 * Only two failures are classified — the offering not-found and the lifecycle
 * denial. Every other error propagates unchanged, so a real defect is never
 * laundered into a form error, and the authorization redirect is never swallowed:
 * neither `instanceof` check matches a `NEXT_REDIRECT` throw.
 */
export async function setExamPlanPublication(
  courseOfferingId: string,
  operation: ExamPublicationOperation,
): Promise<SetExamPlanPublicationResult> {
  return setExamPlanPublicationWithDeps(courseOfferingId, operation, {
    requireCourseContext,
    assertConfigurationAllowed,
    now: currentTimeMs,
    findPlanPublicationByCourseOfferingId,
    setPublicationIfCurrent,
    isCourseNotFoundError,
    isOperationNotAllowedError,
  });
}
