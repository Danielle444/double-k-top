/**
 * EXAM PLAN P2 — the REAL admin, course-lifecycle and Prisma bindings for the ONE
 * explicit, IDEMPOTENT ExamPlan CREATE whose order and outcomes the committed P1
 * pure core already fixes.
 *
 * SERVER-ONLY BY DECLARATION. `import "server-only"` — the repository convention,
 * already used by the exam read and definition-write bindings in this directory —
 * turns an accidental import from a client module into a BUILD ERROR. That matters
 * on its own terms here: this module binds admin authorization, the course
 * lifecycle policy and a Prisma WRITE.
 *
 * DELIBERATELY NOT A `"use server"` MODULE. Everything exported from a
 * `"use server"` file becomes a PUBLICLY CALLABLE Server Action with a stable
 * network id — and this one WRITES a row. `createExamPlan` is an ORDINARY server
 * function. The Server Action, the route and the admin UI that eventually call it
 * are a LATER, separately reviewed slice; nothing in `app/` calls this today, and
 * no exam route or page exists.
 *
 * ===========================================================================
 * DIVISION OF LABOUR
 * ===========================================================================
 * The committed pure core owns EVERY decision: the order in which authorization,
 * the lifecycle gate, the existence check and the write happen; that an
 * already-existing plan is a SUCCESS rather than a refusal; that the concurrent
 * loser's unique-constraint violation is re-read rather than surfaced; that a
 * re-read finding nothing is the one honest refusal; and that the create is never
 * retried.
 *
 * This module owns NONE of that. It contains no ordering decision, no validation,
 * no policy table, no idempotence rule and no outcome code of its own: it hands
 * the core its effects and its error classifiers, and returns the core's frozen
 * result unchanged.
 *
 * (The core is named WITHOUT a module path in this prose on purpose: the committed
 * EX-C1 containment suite forbids a path-shaped reference to an unwired exam core
 * from anywhere outside `lib/exam`, and a comment is source text like any other.)
 *
 * ===========================================================================
 * WHAT THE CALLER MAY SUPPLY
 * ===========================================================================
 * A REQUESTED `courseOfferingId`, and nothing else. There is no parameter — and
 * no object field — for a `planId`, a `publishedAt`, a source date, a definition,
 * a session, an admin id, a `created` flag or a transaction handle. Not "ignored":
 * ABSENT from the signature, so no future caller can pass one.
 *
 * A plan id is something this operation PRODUCES, never something it accepts: a
 * caller-supplied id would let one offering's plan be attached to another
 * offering, which the unique index alone would not catch.
 *
 * The requested id is a REQUEST, not a grant. `requireAdminCourseOffering` runs
 * `requireAdmin()` FIRST — redirecting an unauthenticated or non-admin caller —
 * and only THEN looks up exactly that offering. Only the DB-VERIFIED id it
 * returns reaches the plan lookup, the create and the conflict re-read, so a
 * caller cannot be authorized for one offering while the write lands on another,
 * and plan EXISTENCE cannot be probed by an unauthorized caller: "does this
 * offering have exams yet?" is unanswerable without passing the admin boundary,
 * because no Prisma statement in this module runs before it.
 *
 * ===========================================================================
 * THE COURSE-LIFECYCLE GATE — A TEMPORARY, DELIBERATE REUSE
 * ===========================================================================
 * The gate is the existing `SCHEDULE_DRAFT_CONFIGURATION` operation, which the
 * committed policy allows for PLANNED and ACTIVE offerings and denies for ARCHIVED
 * ones — exactly the required behaviour for bringing an exam plan into existence,
 * and exactly the gate the committed definition-write bindings already use, so the
 * two cannot drift.
 *
 * This is a reuse of a course-LIFECYCLE classification, NOT of a capability. No
 * new `CourseOfferingOperation` is introduced, the committed policy core is not
 * edited, and NO capability is consulted: there is no EXAMS capability (no catalog
 * key, no row, no reader), and `SCHEDULE` / `TEACHING_PRACTICE` are NOT borrowed —
 * an exam write must not silently inherit another module's product decisions, and
 * a placeholder check that always passes reads as enforcement to the next person
 * who edits this file.
 *
 * A dedicated exam-configuration lifecycle operation MAY be worth introducing so
 * exam configuration can diverge from schedule drafting; that is a separate
 * architecture slice and is NOT introduced here.
 *
 * ===========================================================================
 * THE PRISMA SURFACE — TWO STATEMENTS, ONE MODEL, ONE COLUMN
 * ===========================================================================
 *   1. ONE `examPlan.findUnique` by the VERIFIED offering id, selecting `id`;
 *   2. ONE `examPlan.create` writing `courseOfferingId` and NOTHING else,
 *      selecting `id`.
 *
 * The lookup is the same function on both of its uses — the pre-check and the
 * conflict re-read — because they are the same question asked twice; it is a pure
 * read and writes nothing, which is what makes calling it twice safe.
 *
 * There is deliberately NO `upsert`, `update` or `updateMany` on the plan. An
 * upsert would make "create" capable of silently overwriting an existing plan's
 * columns — including `publishedAt` — which is precisely the behaviour the
 * explicit find/create split exists to prevent, and it would also erase the
 * distinction the caller is told about (`created`).
 *
 * No transaction is opened. The two statements are deliberately NOT atomic: the
 * unique index on `courseOfferingId` — not a transaction, and not the pre-check —
 * is what makes a duplicate plan impossible, and the core translates the resulting
 * conflict into the already-exists outcome. A transaction would add cost and
 * suggest a guarantee that the index already provides.
 *
 * Nothing else is read or written: no `publishedAt`, no source date, no
 * definition, no session, no assignment, no offering column, no enrollment, no
 * person row. No raw SQL, no client escape hatch, no revalidation, no
 * notification, no push surface.
 *
 * ===========================================================================
 * ERRORS: THREE SHAPES CLASSIFIED, EVERYTHING ELSE PROPAGATES
 * ===========================================================================
 * Exactly three classifiers are bound, and each answers one narrow question:
 * the project's typed offering not-found and the committed policy's typed
 * lifecycle denial, both matched BY IDENTITY, and the committed pure
 * offering-uniqueness classifier.
 *
 * That last one is BOUND, not re-implemented: recognizing the plan's
 * one-per-offering violation is a rule with edge cases (the field-array form, the
 * index-name form, a target naming only the primary key, unreadable metadata), it
 * is proven at runtime by the core's DB-free suite, and duplicating it next to
 * Prisma would create a second source of truth that could drift. Deliberately it
 * is also structural rather than an `instanceof` on a generated error class: under
 * the project's pg adapter a known request error does not reliably arrive as that
 * class, so an identity check would silently stop recognizing the conflict.
 *
 * An UNRELATED unique violation is therefore not classified and PROPAGATES, as
 * does every unexpected Prisma failure: there is no catch-all `catch` and no
 * generic failure code anywhere in this slice, because a generic code would let a
 * real defect render as an ordinary form error that nobody investigates.
 *
 * CRITICALLY, the admin boundary denies by REDIRECTING (a Next `NEXT_REDIRECT`
 * throw). Nothing here inspects, catches or translates it: neither `instanceof`
 * matches it, and the uniqueness classifier requires a P-code that a redirect —
 * which carries a `digest` — does not have. So the redirect reaches the framework
 * untouched and is still performed. A redirect must never become a refusal: an
 * admin who is simply not logged in would then see "not found" instead of the
 * login page.
 *
 * ===========================================================================
 * ADMIN ONLY
 * ===========================================================================
 * There is no instructor and no trainee path in this module: no actor helper for
 * either role is imported, and the only authorization binding is the admin
 * course-context resolver. An instructor- or trainee-created exam plan would be a
 * different product decision requiring its own review.
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
  createExamPlanWithDeps,
  isExamPlanOfferingConflictError,
  type CreateExamPlanResult,
} from "@/lib/exam/create-exam-plan-core";

export type { CreateExamPlanResult } from "@/lib/exam/create-exam-plan-core";

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
 * Find the plan of ONE VERIFIED offering — the module's only read.
 *
 * `findUnique` on the `@unique` offering column, selecting the id ALONE. No
 * publication state, no timestamps, no offering relation, no definitions, no
 * sessions, no source dates: the operation must not be able to make a decision
 * from data it should not have read, and in particular must not branch on whether
 * an existing plan is published, because "already exists" is the same answer
 * either way.
 *
 * ONE function serves both the pre-check and the conflict re-read, because they
 * ask the identical question. It writes nothing, which is what makes the second
 * call safe.
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
 * The SINGLE write: bring ONE EMPTY, UNPUBLISHED plan into existence for the
 * VERIFIED offering.
 *
 * `data` carries exactly ONE column — the server-verified `courseOfferingId`.
 * `id`, `createdAt` and `updatedAt` are database defaults, and `publishedAt` is
 * left NULL by the schema rather than by a value written here: this create is
 * structurally incapable of publishing anything, because the field appears nowhere
 * in the payload and no dependency of the core exposes it. A new plan is EMPTY —
 * no definition, no session, no source date and no nested write of any kind, so
 * there is no seeded, defaulted or hardcoded exam name anywhere in this slice.
 *
 * `select` is the id alone, so no stored row, no `Date` and no publication state
 * ever leaves this function — the result the caller receives is the core's frozen,
 * JSON-safe DTO.
 *
 * Called AT MOST ONCE per invocation, by the core's contract: there is no retry
 * loop here and none there, so a flapping database can never be turned into a
 * write storm. On the losing side of a race the unique index raises the conflict
 * that the bound classifier recognizes, and the core re-reads instead of writing
 * again.
 */
function createExamPlanForCourseOffering(
  verifiedCourseOfferingId: string,
): Promise<{ id: string }> {
  return prisma.examPlan.create({
    data: {
      courseOfferingId: verifiedCourseOfferingId,
    },
    select: {
      id: true,
    },
  });
}

// ===========================================================================
// The operation
// ===========================================================================

/**
 * Ensure exactly ONE empty, unpublished ExamPlan exists for one authorized,
 * lifecycle-permitted course offering, and report whether THIS call created it.
 *
 * Order (the committed pure core's contract, bound here to real effects):
 *   1. `requireAdminCourseOffering(courseOfferingId)` — admin FIRST, then the
 *      exact offering; a redirect for a non-admin caller propagates untouched;
 *   2. `assertCourseOperationAllowed(status, "SCHEDULE_DRAFT_CONFIGURATION")` on
 *      the VERIFIED status, BEFORE any exam query;
 *   3. ONE `examPlan.findUnique` on the VERIFIED offering id;
 *   4. a plan already exists -> `{ ok: true, planId, created: false }`, with ZERO
 *      create calls and nothing on that plan touched;
 *   5. otherwise ONE `examPlan.create`, and `created: true`;
 *   6. the offering-uniqueness violation -> ONE re-read, reported as
 *      `created: false`; the create is NOT retried;
 *   7. the re-read finding nothing -> the honest `plan_conflict` refusal.
 *
 * This function decides none of that. It builds the dependency bundle and returns
 * the core's result unchanged.
 */
export async function createExamPlan(
  courseOfferingId: string,
): Promise<CreateExamPlanResult> {
  return createExamPlanWithDeps(courseOfferingId, {
    requireCourseContext,
    assertConfigurationAllowed,
    findExamPlanByCourseOfferingId,
    createExamPlanForCourseOffering,
    isCourseNotFoundError,
    isOperationNotAllowedError,
    isPlanCourseOfferingUniqueConflict: isExamPlanOfferingConflictError,
  });
}
