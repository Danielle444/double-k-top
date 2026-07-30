/**
 * EXAM EX-SES-S2 — the ADMIN-SCOPED stored ExamSession WRITE: the real bindings
 * for CREATE, and nothing else.
 *
 * SERVER-ONLY BY DECLARATION. `import "server-only"` — the repository convention,
 * already used by the exam read and definition-write bindings — turns an
 * accidental import from a client module into a BUILD ERROR. That matters
 * independently of everything else here: this module binds admin authorization,
 * the course-lifecycle policy and a Prisma write.
 *
 * DELIBERATELY NOT A `"use server"` MODULE. Everything exported from a
 * `"use server"` file becomes a PUBLICLY CALLABLE Server Action with a stable
 * network id — and this WRITES. `createExamSession` is an ORDINARY server
 * function. The Server Action, the route and the admin UI that eventually call it
 * are a LATER, separately reviewed slice; nothing in `app/` calls this today, and
 * no exam route or page exists.
 *
 * ===========================================================================
 * DIVISION OF LABOUR
 * ===========================================================================
 * Inside the exam slice (all pure, all DB-free):
 *   exam-session-write-core   — INPUT normalization: the six submitted fields,
 *                               the real-calendar date rule, the exact `HH:mm`
 *                               rule, the fail-closed optional-text rule
 *   create-exam-session-core  — the CREATE order + outcomes
 * And here:
 *   this module — the REAL admin, policy, date-conversion and Prisma bindings,
 *   and nothing else.
 *
 * (Those are named WITHOUT a module path on purpose: the committed containment
 * suites forbid a path-shaped reference to an unwired exam core from anywhere
 * outside `lib/exam`, and a comment is source text like any other.)
 *
 * The orchestration is NOT reimplemented here. This file contains no ordering
 * decision, no validation, no policy table and no outcome code of its own: it
 * hands the committed pure core its effects and its error classifiers, and
 * returns the core's result unchanged.
 *
 * ===========================================================================
 * WHAT THE CALLER MAY SUPPLY
 * ===========================================================================
 * A REQUESTED `courseOfferingId` and a RAW input object. That is the whole
 * surface.
 *
 * There is no parameter for a `planId`, a `sessionId`, an `orderIndex`, a `kind`,
 * an `endTime`, a publication option, an admin id or a transaction handle — not
 * "ignored", but absent from the signature, so no future caller can pass one.
 *
 * The requested offering id is a REQUEST, not a grant: `requireAdminCourseOffering`
 * runs `requireAdmin()` FIRST (redirecting an unauthenticated or non-admin
 * caller) and only then looks up exactly that offering, and ONLY the DB-verified
 * id it returns reaches the ExamPlan query. The plan id is therefore always
 * server-derived, and the definition verification, the order aggregate and the
 * write are all scoped by it.
 *
 * ===========================================================================
 * THE COURSE-LIFECYCLE GATE — A TEMPORARY, DELIBERATE REUSE
 * ===========================================================================
 * The gate is the existing `SCHEDULE_DRAFT_CONFIGURATION` operation, which the
 * committed policy allows for PLANNED and ACTIVE offerings and denies for
 * ARCHIVED ones — exactly the required behaviour for configuring an exam plan's
 * sessions, and exactly what the committed definition-write binding already uses,
 * so the two cannot drift into different trust boundaries.
 *
 * This is a reuse of a course-LIFECYCLE classification, NOT of a capability. No
 * new `CourseOfferingOperation` is introduced, the committed policy core is not
 * edited, and NO capability is consulted: there is no `EXAMS` capability (no
 * catalog key, no row, no reader), and no other module's capability is borrowed —
 * an exam write must not silently inherit another module's product decisions, and
 * a placeholder check that always passes reads as enforcement to the next person
 * who edits this file.
 *
 * A dedicated `EXAM_CONFIGURATION` lifecycle operation MAY be worth introducing
 * so exam configuration can diverge from schedule drafting; that is a separate
 * architecture slice and is NOT introduced here.
 *
 * ===========================================================================
 * PUBLICATION IS NOT CONSULTED, AND NOTHING IS ANNOUNCED
 * ===========================================================================
 * The single ExamPlan query selects the plan's id and nothing else, so this
 * operation cannot see, require or change a publication state. Creating a session
 * is permitted on a draft plan and a published one alike; a manager warning about
 * a published plan is a UI concern for a later slice. No `publishedAt` and no
 * per-session `individualPublishedAt` is written, and no notification, message or
 * push surface is imported.
 *
 * ===========================================================================
 * ADMIN ONLY
 * ===========================================================================
 * There is no instructor and no trainee write path in this module: no actor
 * helper for either role is imported, and the only authorization binding is the
 * admin course-context resolver. An instructor- or trainee-authored session would
 * be a different product decision requiring its own review.
 *
 * ===========================================================================
 * THE SINGLE DATE CONVERSION
 * ===========================================================================
 * The pure core carries `date` as a validated `YYYY-MM-DD` string and never a
 * calendar object. The conversion to the `@db.Date` column's type happens EXACTLY
 * ONCE, in one statement of the write binding below, through the repository's
 * existing `parseDateKey` helper — the same helper the exam read shell uses, so
 * the day boundary a session is written at is the identical UTC convention every
 * reader queries with. A second conversion, a locally-written variant, or a
 * conversion inside the pure core would each be a way for a calendar date to
 * shift by a day depending on where the code ran.
 *
 * The converted value is used for BOTH statements of the transaction — the order
 * aggregate's filter and the create's column — so the row is ordered within
 * exactly the day it is stored on. Keeping the conversion HERE is also what keeps
 * the pure core free of a timezone decision it has no way to make correctly.
 */
import "server-only";

import type { CourseOfferingStatus } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { parseDateKey } from "@/lib/dates";
import {
  requireAdminCourseOffering,
  CourseOfferingNotFoundError,
} from "@/lib/course/admin-course-context";
import {
  assertCourseOperationAllowed,
  CourseOperationNotPermittedError,
} from "@/lib/course/operation-policy-core";
import {
  createExamSessionWithDeps,
  type CreateExamSessionResult,
  type NormalizedExamSessionCreate,
} from "@/lib/exam/create-exam-session-core";

export type { CreateExamSessionResult } from "@/lib/exam/create-exam-session-core";

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
 * business.
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
// The Prisma bindings
// ===========================================================================

/**
 * The ONLY ExamPlan query in this module: one narrow lookup by the VERIFIED
 * offering id, selecting the id alone. No publication state, no source dates, no
 * sessions, no definitions, no offering relation, no timestamps — and no upsert,
 * because a plan is never created here.
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
 * Verify the submitted definition exists, scoped by BOTH the server-resolved plan
 * and the submitted definition id.
 *
 * `findFirst` with both keys — never `findUnique({ where: { id } })` — so a
 * definition of ANOTHER plan reads as `null` rather than being found and then
 * rejected by a check someone could later remove. It is the plan scope, not a
 * comparison, that makes a cross-plan session unreachable, and it is why the pure
 * core can report a foreign definition and a missing one identically.
 *
 * `select: { id: true }` and nothing else. The definition's name, kind, duration
 * and capacity are all deliberately unread: this operation makes no decision from
 * them, and a value it cannot see is a value it cannot leak into a result. (The
 * consequence — that this slice does not itself refuse a session under a live
 * beginner definition — is documented honestly in the pure core.)
 */
function findDefinitionForPlan(
  planId: string,
  definitionId: string,
): Promise<{ id: string } | null> {
  return prisma.examDefinition.findFirst({
    where: { id: definitionId, planId },
    select: { id: true },
  });
}

/**
 * Append ONE session to the plan of ONE course offering, assigning the next order
 * position within its DAY inside a single transaction.
 *
 * THE DATE CONVERSION happens here, once, before the transaction opens, and the
 * resulting value is what both statements use.
 *
 * THE ORDER SCOPE is `(planId, date)`, not the plan alone: sessions are presented
 * and numbered per day, so a session created on one date must not be pushed to a
 * high position by unrelated sessions on another. The aggregate is a MAX and never
 * a COUNT — a count would silently reuse a position after any future gap.
 *
 * CONCURRENCY LIMITATION, STATED HONESTLY: concurrent creates on the SAME plan
 * and the SAME date may receive EQUAL `orderIndex` values, because the schema
 * declares no unique constraint on `(planId, date, orderIndex)` and an ordinary
 * transaction does not serialize the read-max/insert pair. This is TOLERATED, not
 * prevented: the committed readers sort deterministically by `orderIndex` and then
 * `id`, so equal positions stay stably ordered, exactly as the sibling definition
 * create documents. Nothing here claims uniqueness — no unique index, no
 * serializable isolation, no re-run and no module-level lock is added, and adding
 * one is a separate approved change.
 *
 * The aggregate and the create run on the SAME transaction client. Only
 * `ExamSession` is written: no ExamPlan create/update/upsert, no definition write,
 * no assignment, no break, no supervisor, no notification, and no second row of
 * any kind.
 *
 * The written columns are EXACTLY the eight below. Every other column of the model
 * is left to the database: `id`, `createdAt` and `updatedAt` are generated, and
 * the deprecated-and-unwritten columns, the derived end time, the copy-provenance
 * columns and the per-session publication column are absent from this payload —
 * unreachable, in fact, because the normalized value the pure core forwards has no
 * field for any of them.
 */
function createSessionAtNextOrder(
  planId: string,
  value: NormalizedExamSessionCreate,
): Promise<{ id: string; orderIndex: number }> {
  // The ONE conversion, from the pure core's validated YYYY-MM-DD string to the
  // instant the `@db.Date` column stores, using the repository's shared helper.
  const date = parseDateKey(value.date);

  return prisma.$transaction(async (tx) => {
    const aggregate = await tx.examSession.aggregate({
      where: { planId, date },
      _max: { orderIndex: true },
    });

    // 0 for the first session of a plan's day; max + 1 afterwards. Never
    // caller-supplied.
    const nextOrderIndex =
      aggregate._max.orderIndex === null ? 0 : aggregate._max.orderIndex + 1;

    return tx.examSession.create({
      data: {
        // The SERVER-RESOLVED plan id, from the verified offering's plan.
        planId,
        // The five submitted values the committed core normalized...
        definitionId: value.definitionId,
        date,
        startTime: value.startTime,
        arena: value.arena,
        title: value.title,
        notes: value.notes,
        // ...and the server-assigned position.
        orderIndex: nextOrderIndex,
      },
      // Narrow on purpose: the caller learns the new id and its position, and no
      // stored row, date, title or timestamp ever leaves this function.
      select: { id: true, orderIndex: true },
    });
  });
}

// ===========================================================================
// Create
// ===========================================================================

/**
 * Create exactly ONE stored ExamSession under an EXISTING ExamPlan.
 *
 * Order (the committed pure core's contract, bound here to real effects):
 *   1. `requireAdminCourseOffering(courseOfferingId)` — admin first, then the
 *      exact offering; a redirect for a non-admin caller propagates untouched;
 *   2. `assertCourseOperationAllowed(status, "SCHEDULE_DRAFT_CONFIGURATION")`;
 *   3. ONE `prisma.examPlan.findUnique` on the VERIFIED offering id;
 *   4. no plan -> the core's plan refusal (never an upsert);
 *   5. the committed input normalizer;
 *   6. invalid -> the core's input refusal, with NO definition query and NO write;
 *   7. ONE plan-scoped definition read; missing or foreign -> the same refusal,
 *      and NO write;
 *   8. ONE transaction: one aggregate + one create.
 *
 * Only two failures are classified — the offering not-found and the lifecycle
 * denial. Every other error propagates unchanged, so a real defect is never
 * laundered into a form error, and the authorization redirect is never swallowed:
 * neither `instanceof` check matches a `NEXT_REDIRECT` throw.
 */
export async function createExamSession(
  courseOfferingId: string,
  rawInput: unknown,
): Promise<CreateExamSessionResult> {
  return createExamSessionWithDeps(courseOfferingId, rawInput, {
    requireCourseContext,
    assertConfigurationAllowed,
    findExamPlanByCourseOfferingId,
    findDefinitionForPlan,
    createSessionAtNextOrder,
    isCourseNotFoundError,
    isOperationNotAllowedError,
  });
}
