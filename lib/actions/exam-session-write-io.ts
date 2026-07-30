/**
 * EXAM EX-SES-S2 / EX-SES-S3 — the ADMIN-SCOPED stored ExamSession WRITES: the
 * real bindings for CREATE, EDIT and safe REMOVAL, and nothing else.
 *
 * SERVER-ONLY BY DECLARATION. `import "server-only"` — the repository convention,
 * already used by the exam read and definition-write bindings — turns an
 * accidental import from a client module into a BUILD ERROR. That matters
 * independently of everything else here: this module binds admin authorization,
 * the course-lifecycle policy and Prisma writes.
 *
 * DELIBERATELY NOT A `"use server"` MODULE. Everything exported from a
 * `"use server"` file becomes a PUBLICLY CALLABLE Server Action with a stable
 * network id — and these WRITE. `createExamSession`, `updateExamSession` and
 * `deleteExamSession` are ORDINARY server functions. The Server Actions, the
 * route and the admin UI that eventually call them are a LATER, separately
 * reviewed slice; nothing in `app/` calls this today, and no exam route or page
 * exists.
 *
 * ===========================================================================
 * DIVISION OF LABOUR
 * ===========================================================================
 * Inside the exam slice (all pure, all DB-free):
 *   exam-session-write-core   — INPUT normalization: the six submitted fields,
 *                               the real-calendar date rule, the exact `HH:mm`
 *                               rule, the fail-closed optional-text rule
 *   create-exam-session-core  — the CREATE order + outcomes
 *   update-exam-session-core  — the EDIT order + outcomes, the no-op rule and
 *                               the definition-change gate
 *   delete-exam-session-core  — the REMOVAL order + outcomes, and the
 *                               assignment pre-check
 * And here:
 *   this module — the REAL admin, policy, date-conversion and Prisma bindings,
 *   and nothing else.
 *
 * (Those are named WITHOUT a module path on purpose: the committed containment
 * suites forbid a path-shaped reference to an unwired exam core from anywhere
 * outside `lib/exam`, and a comment is source text like any other.)
 *
 * The orchestration is NOT reimplemented here. This file contains no ordering
 * decision, no validation, no policy table, no no-op rule and no outcome code of
 * its own: it hands each committed pure core its effects and its error
 * classifiers, and returns the core's result unchanged.
 *
 * The admin boundary, the lifecycle gate, the two typed error classifiers and
 * the ExamPlan lookup are each declared ONCE and shared by all three operations —
 * so the three can never drift into different trust boundaries.
 *
 * ===========================================================================
 * WHAT THE CALLER MAY SUPPLY
 * ===========================================================================
 * Create: a REQUESTED `courseOfferingId` and a RAW input object.
 * Edit:   the same, plus a `sessionId` and an optimistic-concurrency token.
 * Remove: a REQUESTED `courseOfferingId`, a `sessionId` and that token.
 *
 * There is no parameter for a `planId`, an `orderIndex`, a `kind`, an `endTime`,
 * an assignment count, a publication option, an admin id or a transaction handle
 * — not "ignored", but absent from every signature, so no future caller can pass
 * one.
 *
 * The requested offering id is a REQUEST, not a grant: `requireAdminCourseOffering`
 * runs `requireAdmin()` FIRST (redirecting an unauthenticated or non-admin
 * caller) and only then looks up exactly that offering, and ONLY the DB-verified
 * id it returns reaches the ExamPlan query. The plan id is therefore always
 * server-derived, and every session read, definition verification, order
 * aggregate and write is scoped by it.
 *
 * ===========================================================================
 * THE TWO CONDITIONAL WRITES, AND WHAT `updateMany` / `deleteMany` BUY
 * ===========================================================================
 * The edit and the removal each carry THREE conditions — the session id, the
 * SERVER plan id and the expected version — and only the `*Many` forms accept a
 * non-unique filter. A blind `update({ where: { id } })` or `delete(...)` would
 * silently overwrite another manager's concurrent change and would not be
 * plan-scoped; a read-then-write comparison in application code would be racy.
 * `count === 0` therefore means exactly one thing: the row is no longer what the
 * caller thought, and the pure cores turn that into the stale-write refusal.
 *
 * The epoch-millisecond token is converted to the database's instant type in
 * those two `where` clauses and nowhere else. Millisecond precision is exact on
 * both sides, so the value a reader handed out round-trips to the same instant.
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
 * The single ExamPlan query selects the plan's id and nothing else, so these
 * operations cannot see, require or change a publication state. Creating,
 * editing and removing a session are permitted on a draft plan and a published
 * one alike; a manager warning about a published plan is a UI concern for a later
 * slice. No `publishedAt` and no per-session `individualPublishedAt` is read or
 * written, and no notification, message or push surface is imported.
 *
 * ===========================================================================
 * THE ASSIGNMENT GUARD LIVES INSIDE THE WRITE STATEMENTS
 * ===========================================================================
 * `ExamAssignment` is READ in exactly one statement of this file — a `count` —
 * and is otherwise never created, edited, moved or deleted here, nor is any
 * break, supervisor or beginner child.
 *
 * Because `ExamAssignment.session` is `ON DELETE CASCADE` and NOT `Restrict`,
 * the database will not refuse a destructive write on this module's behalf. So
 * the two writes that must not run on an assigned session carry the condition
 * THEMSELVES, as a `assignments: { none: {} }` relation filter that Prisma
 * compiles into a `NOT EXISTS` sub-condition of the statement:
 *
 *   - the conditional UPDATE, for a definition change only;
 *   - the conditional DELETE, always.
 *
 * The pure cores' `count` therefore buys an early, actionable refusal — not the
 * guarantee. An assignment that appears after that count makes the guarded
 * statement match zero rows, and the cores classify that zero by re-reading
 * rather than by retrying.
 *
 * An ORDINARY edit carries no such condition: correcting the date, time, arena,
 * title or notes of a session people are assigned to stays permitted.
 *
 * The cascade itself is still the DATABASE's. `ExamAssignment`,
 * `ExamSessionBreak`, `ExamSessionSupervisor` and `ExamBeginnerChild` all
 * reference the session with `ON DELETE CASCADE`, and this module deliberately
 * issues no delete of its own for any of them: an application-side cascade would
 * be a second, non-atomic implementation of a rule the schema already states,
 * and a half-completed one would leave the session standing with its children
 * gone.
 *
 * There is still no foreign-key classifier in this slice — a `P2003` cannot be
 * raised by these statements — and no lock, retry or isolation-level override is
 * introduced. What the relation filters remove is the APPLICATION-level
 * check-then-act window. The narrower database-level one remains and is stated
 * rather than glossed: under READ COMMITTED a statement's sub-condition is
 * evaluated against a snapshot, so an assignment INSERT committing concurrently
 * with the guarded statement may not be visible to it. Only row locking,
 * SERIALIZABLE isolation or a database-level rule could close that, each a
 * separate approved change, and none is performed or claimed here.
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
 * THE DATE CONVERSIONS — ONE PER DIRECTION, BOTH THROUGH THE SHARED HELPERS
 * ===========================================================================
 * The pure cores carry `date` as a validated `YYYY-MM-DD` string and never a
 * calendar object, in BOTH directions: what is written, and what is read back
 * for the edit's no-op comparison. So this module performs exactly two
 * conversions, each in one place:
 *
 *   IN   `parseDateKey(value.date)`  — the `YYYY-MM-DD` key -> the `@db.Date`
 *        column's instant. Used by the create's transaction (for both the order
 *        aggregate's filter and the create's column, so the row is ordered
 *        within exactly the day it is stored on) and by the edit's conditional
 *        update;
 *   OUT  `dateKey(row.date)`         — the stored instant -> the `YYYY-MM-DD`
 *        key the pure core compares as a plain string.
 *
 * Both are the repository's existing helpers, and they are exact inverses of one
 * another: `parseDateKey` anchors at `T00:00:00.000Z` and `dateKey` slices the
 * ISO string, so a date read out and written back is byte-identical. They are the
 * same pair the exam read shell uses, so the day boundary a session is written at
 * is the identical UTC convention every reader queries with. A locally-written
 * variant, or a conversion inside a pure core, would each be a way for a calendar
 * date to shift by a day depending on where the code ran — and keeping both HERE
 * is what keeps the pure cores free of a timezone decision they have no way to
 * make correctly.
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
import {
  createExamSessionWithDeps,
  type CreateExamSessionResult,
  type NormalizedExamSessionCreate,
} from "@/lib/exam/create-exam-session-core";
import {
  updateExamSessionWithDeps,
  type ExistingExamSessionForUpdate,
  type NormalizedExamSessionEdit,
  type UpdateExamSessionResult,
  type UpdatedExamSessionRecord,
} from "@/lib/exam/update-exam-session-core";
import {
  deleteExamSessionWithDeps,
  type DeleteExamSessionResult,
} from "@/lib/exam/delete-exam-session-core";

export type { CreateExamSessionResult } from "@/lib/exam/create-exam-session-core";
export type { UpdateExamSessionResult } from "@/lib/exam/update-exam-session-core";
export type { DeleteExamSessionResult } from "@/lib/exam/delete-exam-session-core";

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
 *
 * Shared by all three operations rather than repeated per operation, so no future
 * edit can widen it for one of them alone.
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
 * Verify a submitted definition exists, scoped by BOTH the server-resolved plan
 * and the submitted definition id.
 *
 * Shared by the create and the edit. The edit reaches it ONLY when the submitted
 * definition differs from the stored one — an unchanged definition is already
 * known to satisfy the composite foreign key, so re-verifying it would be a query
 * whose answer cannot change any decision.
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

/**
 * Read ONE session, scoped by BOTH the server-resolved plan and the requested
 * session id.
 *
 * `findFirst` with both keys — never `findUnique({ where: { id } })` — so a
 * session of ANOTHER plan reads as `null` rather than being found and then
 * rejected by a check someone could later remove. It is the plan scope, not a
 * comparison, that makes a cross-plan edit or removal unreachable, and it is why
 * the pure cores can report a foreign session and a missing one identically.
 *
 * The select is EXACTLY the six mutable values plus `id` and `updatedAt`: the six
 * because the edit's no-op rule is defined against them, `id` because it is the
 * server-verified target of everything that follows, `updatedAt` because it is
 * this operation's version token. No `planId`, no `orderIndex`, no `kind`, no
 * `endTime`, no `createdAt`, no relation and no assignment — a value this module
 * does not read is a value it cannot leak into a result.
 *
 * The two conversions to the pure cores' plain types happen HERE: the stored
 * `@db.Date` becomes a `YYYY-MM-DD` key, and the stored instant becomes epoch
 * milliseconds. No calendar object ever reaches a pure core or a result.
 *
 * Shared by the edit and the removal: the removal needs a strict subset of these
 * fields (`id` and `updatedAt`), and one reader is cheaper to keep correct than
 * two. The removal simply never looks at the rest.
 */
async function findSessionForPlan(
  planId: string,
  sessionId: string,
): Promise<ExistingExamSessionForUpdate | null> {
  const row = await prisma.examSession.findFirst({
    where: { id: sessionId, planId },
    select: {
      id: true,
      definitionId: true,
      date: true,
      startTime: true,
      arena: true,
      title: true,
      notes: true,
      updatedAt: true,
    },
  });

  if (row === null) {
    return null;
  }
  return {
    id: row.id,
    definitionId: row.definitionId,
    date: dateKey(row.date),
    startTime: row.startTime,
    arena: row.arena,
    title: row.title,
    notes: row.notes,
    updatedAt: row.updatedAt.getTime(),
  };
}

/**
 * How many assignments belong to THIS session.
 *
 * The id is the STORED row's, already resolved under the server plan, so no
 * further scope is available or needed: `ExamAssignment.sessionId` is the whole
 * relation, and a session belongs to exactly one plan.
 *
 * This is the ONLY `ExamAssignment` statement in the module, and it is a read.
 * It is what refuses a definition change on a session people are already
 * assigned to, and what refuses the removal of such a session — and, as the
 * header states, for the removal it is the only protection there is, because the
 * assignment reference is `ON DELETE CASCADE`.
 */
function countAssignmentsForSession(sessionId: string): Promise<number> {
  return prisma.examAssignment.count({
    where: { sessionId },
  });
}

/**
 * The CONDITIONAL edit: rewrite the six mutable values ONLY IF the stored version
 * still equals the token the caller was shown — and, for a definition change,
 * ONLY IF the session still has no assignments at that instant.
 *
 * THE ATOMIC ASSIGNMENT CONDITION. `assignments: { none: {} }` is a relation
 * filter, so Prisma compiles it into a `NOT EXISTS` sub-condition of the UPDATE
 * statement itself. The assignment state and the row version are therefore
 * tested by the DATABASE, together, at write time — not by an application read a
 * round trip earlier. An assignment inserted after the pure core's count makes
 * this statement match zero rows instead of re-pointing a session people are
 * already assigned to.
 *
 * It is attached for EXACTLY the definition-changing case. The two `where`
 * literals are written out in full rather than assembled by spreading a
 * conditional fragment: the difference between them is the whole safety property
 * of this function, and it should be readable at a glance and greppable by a
 * guard, not hidden inside an object spread.
 *
 * An ORDINARY edit deliberately carries NO assignment condition. Correcting the
 * date, time, arena, title or notes of a session people are assigned to is a
 * normal thing for a manager to do, and refusing it would be a regression, not a
 * safety improvement.
 *
 * `data` carries exactly those six. `planId`, `orderIndex`, `kind`, `phase`,
 * `beginnerFormat`, `endTime`, `capacity`, `interfaceSessionId`,
 * `sourceTeachingPracticeLessonId`, `copiedAt`, `roleLabelOverrides`,
 * `individualPublishedAt`, `createdAt` and `updatedAt` are absent — and
 * unreachable, because the normalized edit payload the committed core produces
 * has no field for any of them. `updatedAt` in particular is written by the
 * database's `@updatedAt`, never by this statement; the only place it appears
 * here is the `where` clause, as the caller's expected version.
 *
 * `orderIndex` is deliberately NOT recomputed when the date changes: the row keeps
 * the position it held, which the pure core documents honestly, and re-ordering is
 * a separate operation.
 *
 * THE POST-READ IS OUTSIDE THE UPDATE, AND ITS SEMANTICS ARE STATED HONESTLY.
 * The two statements are not wrapped in a transaction, so the version this
 * function returns is the row's CURRENT version at the moment of the re-read —
 * NORMALLY the one this write produced, but if another manager commits an edit in
 * the gap it will be theirs. What the caller is told is therefore "here is a token
 * that was valid a moment ago", which is exactly what an optimistic token is for:
 * a later write carrying it either matches or is refused as stale. No stronger
 * claim is made, and none is needed — the write itself was still atomic and
 * still conditional. If the row vanished between the two statements the result is
 * `null`, which the pure core reports as a stale write: the honest answer, and
 * the one that tells the manager to reload.
 */
async function updateSessionIfCurrent(
  planId: string,
  sessionId: string,
  expectedUpdatedAt: number,
  value: NormalizedExamSessionEdit,
  requireNoAssignments: boolean,
): Promise<UpdatedExamSessionRecord | null> {
  const expectedVersion = new Date(expectedUpdatedAt);

  const written = await prisma.examSession.updateMany({
    where: requireNoAssignments
      ? {
          id: sessionId,
          planId,
          updatedAt: expectedVersion,
          // The atomic gate: the definition may move only while nobody is
          // assigned, tested inside this statement rather than before it.
          assignments: { none: {} },
        }
      : {
          id: sessionId,
          planId,
          updatedAt: expectedVersion,
        },
    data: {
      definitionId: value.definitionId,
      // The `YYYY-MM-DD` key -> the `@db.Date` column, through the repository's
      // shared helper and the same UTC convention every reader queries with.
      date: parseDateKey(value.date),
      startTime: value.startTime,
      arena: value.arena,
      title: value.title,
      notes: value.notes,
    },
  });

  if (written.count === 0) {
    return null;
  }

  const row = await prisma.examSession.findFirst({
    where: { id: sessionId, planId },
    select: { id: true, updatedAt: true },
  });

  if (row === null) {
    return null;
  }
  return { id: row.id, updatedAt: row.updatedAt.getTime() };
}

/**
 * The CONDITIONAL removal: delete ONLY IF the stored version still equals the
 * token the caller was shown AND the session still has no assignments at that
 * instant.
 *
 * `deleteMany` rather than `delete`, for the same reasons the conditional edit
 * uses `updateMany`: the filter is not unique, a blind delete by id would not be
 * plan-scoped, and both conditions must be evaluated inside the statement.
 * `count === 0` means the row is no longer one this operation may remove — and,
 * because `deleteMany` reports a count rather than throwing when nothing
 * matches, there is no `P2025` to classify and no classifier for one.
 *
 * THE ATOMIC ASSIGNMENT CONDITION IS THE POINT. Assignments cascade, so a delete
 * that ran without this filter would silently destroy them. `assignments: { none:
 * {} }` compiles to a `NOT EXISTS` sub-condition of the DELETE itself, so an
 * assignment inserted after the pure core's count makes this statement remove
 * NOTHING rather than removing a session and everyone on it. Unlike the edit,
 * there is no conditional form: an unassigned session is the only kind this
 * operation may ever remove.
 *
 * This is ONE statement, and it is never retried. The session's breaks,
 * supervisors and beginner children are removed by the database's
 * `ON DELETE CASCADE`, atomically with the row and without a second delete from
 * this module.
 */
async function deleteSessionIfCurrent(
  planId: string,
  sessionId: string,
  expectedUpdatedAt: number,
): Promise<boolean> {
  const expectedVersion = new Date(expectedUpdatedAt);

  const removed = await prisma.examSession.deleteMany({
    where: {
      id: sessionId,
      planId,
      updatedAt: expectedVersion,
      // The atomic gate: a session may be removed only while nobody is
      // assigned, tested inside this statement rather than before it.
      assignments: { none: {} },
    },
  });
  return removed.count > 0;
}

// ===========================================================================
// 1. Create
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

// ===========================================================================
// 2. Edit
// ===========================================================================

/**
 * Edit exactly ONE existing stored ExamSession.
 *
 * Order (the committed pure core's contract, bound here to real effects):
 *   1. `requireAdminCourseOffering(courseOfferingId)` — admin first, then the
 *      exact offering; a redirect for a non-admin caller propagates untouched;
 *   2. `assertCourseOperationAllowed(status, "SCHEDULE_DRAFT_CONFIGURATION")`;
 *   3. ONE `prisma.examPlan.findUnique` on the VERIFIED offering id;
 *   4. ONE plan-scoped session read; missing or foreign -> the core's refusal;
 *   5. the version token, then the committed EDIT normalizer;
 *   6. a no-op performs NO further query and NO write at all;
 *   7. a CHANGED definition only: ONE plan-scoped definition read, then ONE
 *      assignment count — a non-zero count refuses early with nothing written;
 *   8. otherwise ONE conditional `updateMany` — carrying the atomic
 *      no-assignments condition when, and only when, the definition changes —
 *      and ONE narrow re-read;
 *   9. a zero write count on a definition change is classified by narrow
 *      re-reads (`definition_change_not_allowed` or `stale_write`), never by
 *      retrying the update.
 *
 * The six mutable values are `definitionId`, `date`, `startTime`, `arena`,
 * `title` and `notes`. `orderIndex` is not among them and is not a parameter:
 * reordering is a separate slice. Neither is `endTime`, `kind`, `phase`,
 * `beginnerFormat`, `capacity` or any copy-provenance or publication column — the
 * normalized edit payload has no field for any of them, so none can be written
 * even by mistake.
 *
 * Only two failures are classified — the offering not-found and the lifecycle
 * denial. Every other error propagates unchanged, so a real defect is never
 * laundered into a form error, and the authorization redirect is never swallowed.
 */
export async function updateExamSession(
  courseOfferingId: string,
  sessionId: string,
  expectedUpdatedAt: number,
  rawInput: unknown,
): Promise<UpdateExamSessionResult> {
  return updateExamSessionWithDeps(
    courseOfferingId,
    sessionId,
    expectedUpdatedAt,
    rawInput,
    {
      requireCourseContext,
      assertConfigurationAllowed,
      findExamPlanByCourseOfferingId,
      findSessionForUpdate: findSessionForPlan,
      findDefinitionForPlan,
      countAssignmentsForSession,
      updateSessionIfCurrent,
      isCourseNotFoundError,
      isOperationNotAllowedError,
    },
  );
}

// ===========================================================================
// 3. Safe removal
// ===========================================================================

/**
 * Remove exactly ONE stored ExamSession — and only one nobody is assigned to.
 *
 * Order (the committed pure core's contract, bound here to real effects):
 *   1. admin + exact offering;
 *   2. the lifecycle gate on the VERIFIED status;
 *   3. ONE plan lookup on the VERIFIED offering id;
 *   4. ONE plan-scoped session read;
 *   5. the version token;
 *   6. ONE assignment count on the stored row — non-zero refuses early, with NO
 *      delete;
 *   7. otherwise ONE conditional `deleteMany`, carrying BOTH the version and the
 *      atomic no-assignments condition;
 *   8. a zero delete count is classified by narrow re-reads
 *      (`session_has_assignments` or `stale_write`), never by retrying.
 *
 * This is a HARD delete: `ExamSession` has no archive column, this slice adds
 * none, and no schema is changed. Unlike the committed definition removal there
 * is no `ON DELETE RESTRICT` to catch the race for us — assignments cascade — so
 * the statement carries its own `NOT EXISTS` condition instead. The count is the
 * early, actionable refusal; the condition is the guarantee.
 *
 * The session's breaks, supervisors and beginner children go with it, by the
 * schema's own cascade. No delete for any of them is issued from this module.
 */
export async function deleteExamSession(
  courseOfferingId: string,
  sessionId: string,
  expectedUpdatedAt: number,
): Promise<DeleteExamSessionResult> {
  return deleteExamSessionWithDeps(courseOfferingId, sessionId, expectedUpdatedAt, {
    requireCourseContext,
    assertConfigurationAllowed,
    findExamPlanByCourseOfferingId,
    findSessionForDelete: findSessionForPlan,
    countAssignmentsForSession,
    deleteSessionIfCurrent,
    isCourseNotFoundError,
    isOperationNotAllowedError,
  });
}
