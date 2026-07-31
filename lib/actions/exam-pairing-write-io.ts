/**
 * EX-PAIR-BE-MVP — the REAL admin, course-lifecycle and Prisma bindings for the
 * ONE manager operation that PAIRS an instructed trainee with an examinee of the
 * same exam session, or UNPAIRS them.
 *
 * SERVER-ONLY BY DECLARATION. `import "server-only"` — the repository convention,
 * already used by the exam read, plan-write, definition-write, session-write,
 * assignment-write and publication-write bindings in this directory — turns an
 * accidental import from a `"use client"` module into a BUILD ERROR. That matters
 * on its own terms here: this module binds admin authorization, the course
 * lifecycle policy and a Prisma WRITE.
 *
 * DELIBERATELY NOT A `"use server"` MODULE. Everything exported from a
 * `"use server"` file becomes a PUBLICLY CALLABLE Server Action with a stable
 * network id — and this one WRITES. `setExamInstructedTraineePairing` is an
 * ORDINARY server function. The Server Action, the route and the admin control
 * that eventually call it are a LATER, separately reviewed slice; NOTHING
 * anywhere calls this today, and this slice adds no page, route, form, component
 * or capability.
 *
 * ===========================================================================
 * DIVISION OF LABOUR
 * ===========================================================================
 * The pure core owns EVERY decision: the order in which authorization, the
 * lifecycle gate, plan resolution, assignment verification and the write happen;
 * which roles may be paired; that both rows must share one session; when an
 * index is REUSED and when one is ALLOCATED; that an ambiguous index fails
 * closed; that a no-op writes nothing; that a zero write count is a stale write
 * and is never retried; and every outcome code.
 *
 * This module owns NONE of that. It contains no ordering decision, no validation,
 * no policy table, no allocation rule and no outcome code of its own: it hands
 * the core its effects and its error classifiers, and returns the core's frozen
 * result unchanged.
 *
 * (That core is named WITHOUT a module path in this prose on purpose: the
 * committed containment suites forbid a path-shaped reference to an unwired exam
 * core from anywhere outside the exam directory, and a comment is source text
 * like any other. The import statement below is the single, unavoidable
 * exception.)
 *
 * ===========================================================================
 * WHAT THE CALLER MAY SUPPLY
 * ===========================================================================
 * A REQUESTED `courseOfferingId`, the id of the INSTRUCTED-TRAINEE assignment,
 * and either the id of the EXAMINEE assignment or `null` to unpair.
 *
 * THE ABSENT PARAMETER IS THE POINT: there is NO `pairingIndex` parameter, and
 * no object field anywhere in this slice through which one could arrive. A
 * client never chooses the number — it is read from the examinee's own stored
 * row or allocated by the pure core from rows the SERVER read. There is likewise
 * no parameter for a `sessionId`, a `planId`, a `studentId`, a trainee or
 * examinee name, a timestamp, an actor id or a transaction handle. Not
 * "ignored": ABSENT from the signature and from every type the pure core
 * accepts, so no future caller can pass one.
 *
 * The session is DERIVED from the instructed-trainee row the server resolved,
 * and the plan is DERIVED from the DB-verified offering. The requested offering
 * id is a REQUEST, not a grant: `requireAdminCourseOffering` runs `requireAdmin()`
 * FIRST — redirecting an unauthenticated or non-admin caller — and only THEN
 * looks up exactly that offering. Only the DB-VERIFIED id it returns reaches the
 * plan lookup, and every assignment read and every write below is scoped by the
 * plan id derived from it, so neither assignment existence nor pairing state can
 * be probed by an unauthorized caller: no Prisma statement in this module runs
 * before the admin boundary.
 *
 * ===========================================================================
 * THE COURSE-LIFECYCLE GATE — A TEMPORARY, DELIBERATE REUSE
 * ===========================================================================
 * The gate is the existing `SCHEDULE_DRAFT_CONFIGURATION` operation, which the
 * committed policy allows for PLANNED and ACTIVE offerings and denies for
 * ARCHIVED ones — exactly the required behaviour for configuring an exam plan's
 * assignments, and exactly what the committed exam definition-write,
 * session-write, assignment-write and publication-write bindings already use, so
 * the exam module's write surfaces cannot drift into different trust boundaries.
 * The policy table is consulted, never copied.
 *
 * This is a reuse of a course-LIFECYCLE classification, NOT of a capability. No
 * new `CourseOfferingOperation` is introduced, the committed policy core is not
 * edited, and NO capability is consulted: there is no EXAMS capability (no
 * catalog key, no row, no reader), and no other module's capability is borrowed —
 * an exam write must not silently inherit another module's product decisions, and
 * a placeholder check that always passes reads as enforcement to the next person
 * who edits this file.
 *
 * ===========================================================================
 * THE PRISMA SURFACE — FOUR READ SHAPES, ONE COLUMN EVER WRITTEN
 * ===========================================================================
 *   1. ONE `examPlan.findUnique` by the VERIFIED offering id, selecting `id`;
 *   2. ONE `examAssignment.findFirst` per assignment id, scoped by the RELATION
 *      to the server-resolved plan, selecting four columns;
 *   3. ONE `examAssignment.findMany` for the session's EXAMINEE rows, selecting
 *      two columns;
 *   4. the writes: `examAssignment.updateMany` statements whose `data` names
 *      EXACTLY ONE column — `pairingIndex` — and nothing else.
 *
 * `orderIndex` IS NEVER WRITTEN AND NEVER READ. It is not selected by any
 * statement here, it appears in no `data` payload, and it is not the pairing
 * label: the two are different columns with different meanings, and this slice
 * touches only one of them. `studentId`, `role`, `horseName`, `instructionTopic`,
 * `discipline`, `notes`, `sourcePracticeRole`, `sessionId`, `createdAt` and
 * `updatedAt` are likewise absent from every `data` payload; `role` and
 * `sessionId` appear ONLY in `where` clauses, as conditions.
 *
 * WHY `updateMany` AND NOT `update`. Every write carries MORE conditions than a
 * primary key — the row's id, its session, its role, the plan it belongs to, and
 * the pairing state the decision was made from — and only the `*Many` form
 * accepts a non-unique filter. A blind `update({ where: { id } })` would silently
 * overwrite a concurrent pairing and would be neither plan- nor role-scoped; a
 * read-then-compare in application code would be racy. `count === 0` therefore
 * means exactly one thing: the row is no longer what this call decided from, and
 * the pure core turns that into the stale-write refusal.
 *
 * THE PAIRING WRITE IS ONE INTERACTIVE TRANSACTION, and it is the only place two
 * rows are touched. Inside it, in order: no OTHER examinee of the session may
 * hold the chosen index; the examinee row must still hold the expected state
 * (and is UPDATED only when the index is being allocated); and the instructed row
 * must still hold the index the decision was made from. Any failed condition
 * THROWS a module-private sentinel, which rolls the whole transaction back — so a
 * half-written pair cannot survive — and is translated to `false` outside, which
 * the pure core reports as a stale write.
 *
 * THE UNPAIR WRITE IS ONE STATEMENT and needs no transaction: it clears
 * `pairingIndex` on the INSTRUCTED row alone, conditional on the exact index it
 * still holds. There is no statement anywhere in this module that can clear an
 * EXAMINEE's index — an examinee's label may still be held by other instructed
 * trainees, and clearing it would unpair people this request never named.
 *
 * There is deliberately NO `create`, NO `upsert`, NO `delete` and NO `deleteMany`
 * of any kind, so pairing can neither bring a row into existence nor remove one.
 * No raw SQL, no `$executeRaw`, no `$queryRaw`, no client escape hatch, no
 * revalidation, no notification and no push surface. No `ExamPlan`, `ExamSession`,
 * `ExamDefinition`, `ExamSessionSupervisor`, `ExamSessionBreak`,
 * `ExamBeginnerChild`, `Student`, `CourseEnrollment` or `CourseOffering` row is
 * written by any statement here, and no publication column is read or written.
 *
 * ===========================================================================
 * THE HONEST LIMIT OF THE UNIQUENESS RULE
 * ===========================================================================
 * "Two examinees of one session never share a pairing index" is enforced by the
 * pure core over the rows this module read, and re-checked inside the
 * transaction immediately before the write. The schema declares NO unique
 * constraint over `(sessionId, pairingIndex)` — adding one would be a migration,
 * which this slice must not make — so two transactions that allocate at exactly
 * the same instant can still, in principle, choose the same number.
 *
 * That window is narrow and is stated rather than papered over: no unique index,
 * no `SERIALIZABLE` isolation, no row lock, no advisory lock and no retry loop is
 * added here, and adding one would be a separate approved change. What IS
 * guaranteed is that no write ever proceeds from a view of the rows that has
 * already changed, and that a failed condition writes nothing at all.
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
 * The ONE `catch` in this module is asked about a MODULE-PRIVATE sentinel class
 * that nothing outside this file can construct or throw, and it re-throws
 * anything else unchanged. There is no unique-constraint classifier and none is
 * needed: this module writes a nullable, non-unique column and issues no insert,
 * so a `P2002` cannot arise from it; `updateMany` reports a count rather than
 * throwing when nothing matches, so there is no `P2025` either.
 *
 * CRITICALLY, the admin boundary denies by REDIRECTING (a Next `NEXT_REDIRECT`
 * throw). Nothing here inspects, catches or translates it: neither `instanceof`
 * matches it, and the sentinel `catch` re-throws it, so the redirect reaches the
 * framework untouched and is still performed. A redirect must never become a
 * refusal — an admin who is simply not logged in would then see "not found"
 * instead of the login page.
 *
 * ===========================================================================
 * ADMIN ONLY
 * ===========================================================================
 * There is no instructor and no trainee path in this module: no actor helper for
 * either role is imported, and the only authorization binding is the admin
 * course-context resolver. An instructor- or trainee-authored pairing would be a
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
  setExamInstructedTraineePairingWithDeps,
  type ExamPairingAssignmentFacts,
  type ExamPairingExamineeFacts,
  type ExamPairingWriteCommand,
  type ExamUnpairWriteCommand,
  type ResolvedExamPairingPlan,
  type SetExamInstructedTraineePairingResult,
} from "@/lib/exam/exam-pairing-write-core";

export type {
  ExamPairingStatus,
  SetExamInstructedTraineePairingResult,
} from "@/lib/exam/exam-pairing-write-core";

/**
 * The two roles this module names in `where` clauses, and nowhere else. They are
 * CONDITIONS, never payload: no statement below writes a role, and the generated
 * enum type is what checks these literals against the database vocabulary.
 */
const ROLE_INSTRUCTED_TRAINEE = "INSTRUCTED_TRAINEE";
const ROLE_EXAMINEE = "EXAMINEE";

// ===========================================================================
// The trust boundary
// ===========================================================================

/**
 * Admin + exact offering.
 *
 * `requireAdmin()` runs inside `requireAdminCourseOffering` BEFORE the offering
 * is looked up, so an unauthenticated caller is redirected rather than told
 * whether an offering id exists. Only `id` and `status` are carried forward: the
 * name, level, ActivityYear and dates of the offering are none of this
 * operation's business, and the RAW requested id is used at this boundary and
 * nowhere else.
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

/**
 * The module-private abort signal for the pairing transaction.
 *
 * Thrown ONLY inside the transaction callback, and ONLY when a condition the
 * decision depended on no longer holds. Throwing — rather than returning a flag —
 * is what makes the rollback the database's job: a partially applied pair cannot
 * survive a failed later condition.
 *
 * It is not exported, so nothing outside this file can construct or throw one,
 * which is what makes the single `catch` below unable to swallow a foreign error.
 */
class ExamPairingConditionFailed extends Error {}

// ===========================================================================
// The Prisma bindings
// ===========================================================================

/**
 * The ONLY ExamPlan query in this module: one narrow lookup by the VERIFIED
 * offering id, selecting the id alone. No publication state, no source dates, no
 * sessions, no definitions, no offering relation, no timestamps — and no upsert,
 * because a plan is never created by a write to its contents.
 *
 * `ExamPlan.courseOfferingId` is `@unique`, so `findUnique` here is a single
 * indexed lookup on a key that is already the whole scope.
 */
function findExamPlanByCourseOfferingId(
  verifiedCourseOfferingId: string,
): Promise<ResolvedExamPairingPlan | null> {
  return prisma.examPlan.findUnique({
    where: { courseOfferingId: verifiedCourseOfferingId },
    select: { id: true },
  });
}

/**
 * Verify ONE assignment EXISTS UNDER THE SERVER-RESOLVED PLAN, and report the
 * four facts the pure core is entitled to act on.
 *
 * `findFirst` with the plan RELATION filter — never `findUnique({ where: { id } })`
 * — so an assignment of ANOTHER plan reads as `null` rather than being found and
 * then rejected by a comparison someone could later remove. It is the plan scope,
 * not a check, that makes a cross-plan pairing unreachable, and it is why the
 * pure core can report a foreign assignment and a missing one identically.
 *
 * The select is EXACTLY four columns. NOT selected, and therefore not leakable by
 * any later mapper: `studentId`, `horseName`, `instructionTopic`, `discipline`,
 * `notes`, `sourcePracticeRole`, `createdAt`, `updatedAt` — and `orderIndex`,
 * which this slice must never read, write or confuse with the pairing label. No
 * student, session, definition or plan relation is included, so no name, date or
 * publication state can reach the decision.
 */
async function findAssignmentForPlan(
  planId: string,
  assignmentId: string,
): Promise<ExamPairingAssignmentFacts | null> {
  const row = await prisma.examAssignment.findFirst({
    where: { id: assignmentId, session: { planId } },
    select: { id: true, sessionId: true, role: true, pairingIndex: true },
  });

  if (row === null) {
    return null;
  }
  return {
    assignmentId: row.id,
    sessionId: row.sessionId,
    role: row.role,
    pairingIndex: row.pairingIndex,
  };
}

/**
 * Every EXAMINEE row of ONE session under the SERVER-RESOLVED PLAN, reduced to
 * its id and its pairing index.
 *
 * The role is a CONDITION of the statement rather than a filter applied
 * afterwards, so an instructed trainee's index can never be counted as an
 * examinee's — which is what keeps allocation and ambiguity detection scoped to
 * examinees, as the pure core's rule requires.
 *
 * The session id is the one the SERVER read off the instructed-trainee row, and
 * the plan relation is in the same `where` clause, so this read cannot reach
 * another course's session even if a session id were somehow wrong.
 *
 * TWO columns, ordered by id purely for a stable, deterministic result. No
 * `orderIndex`, no student, no name, no horse: allocation needs the numbers and
 * nothing else.
 */
async function findSessionExaminees(
  planId: string,
  sessionId: string,
): Promise<readonly ExamPairingExamineeFacts[]> {
  const rows = await prisma.examAssignment.findMany({
    where: { sessionId, role: ROLE_EXAMINEE, session: { planId } },
    select: { id: true, pairingIndex: true },
    orderBy: { id: "asc" },
  });

  return rows.map((row) => ({ assignmentId: row.id, pairingIndex: row.pairingIndex }));
}

/**
 * The ATOMIC pairing write: ONE interactive transaction, three conditions, and at
 * most two rows — each `data` payload naming EXACTLY the pairing column.
 *
 * In order, on the SAME transaction client:
 *
 *  1. NO OTHER examinee of the session may hold the chosen index. This is the
 *     last line of defence for "two examinees never share a pairing index", and
 *     it runs BEFORE anything is written, so a rival never causes a rollback of
 *     work that should not have started;
 *  2. THE EXAMINEE ROW. When the index is being ALLOCATED
 *     (`expectedExamineePairingIndex === null`) it is written here, conditional on
 *     the row still holding NO index — so two concurrent allocations cannot both
 *     succeed on the same examinee. When the index is being REUSED, the row is
 *     only COUNTED, never written: rewriting the same value would touch a row
 *     this request has no business modifying;
 *  3. THE INSTRUCTED ROW, conditional on its id, its session, its role, the plan
 *     and the exact index it held when the decision was made.
 *
 * Every condition that fails THROWS the module-private sentinel, which aborts and
 * rolls back the transaction — so the examinee can never keep an index the
 * instructed trainee did not receive — and is translated to `false` outside,
 * which the pure core reports as a stale write and NEVER retries.
 *
 * `orderIndex` is not read, not selected and not written by any statement here,
 * and neither is any other assignment column.
 */
async function pairInstructedTrainee(command: ExamPairingWriteCommand): Promise<boolean> {
  try {
    await prisma.$transaction(async (tx) => {
      // 1. No rival examinee may already own the chosen index.
      const rivals = await tx.examAssignment.count({
        where: {
          sessionId: command.sessionId,
          role: ROLE_EXAMINEE,
          pairingIndex: command.pairingIndex,
          id: { not: command.examineeAssignmentId },
          session: { planId: command.planId },
        },
      });
      if (rivals !== 0) {
        throw new ExamPairingConditionFailed();
      }

      // 2. The examinee row: allocated (written) or reused (only confirmed).
      if (command.expectedExamineePairingIndex === null) {
        const allocated = await tx.examAssignment.updateMany({
          where: {
            id: command.examineeAssignmentId,
            sessionId: command.sessionId,
            role: ROLE_EXAMINEE,
            pairingIndex: null,
            session: { planId: command.planId },
          },
          data: { pairingIndex: command.pairingIndex },
        });
        if (allocated.count !== 1) {
          throw new ExamPairingConditionFailed();
        }
      } else {
        const held = await tx.examAssignment.count({
          where: {
            id: command.examineeAssignmentId,
            sessionId: command.sessionId,
            role: ROLE_EXAMINEE,
            pairingIndex: command.expectedExamineePairingIndex,
            session: { planId: command.planId },
          },
        });
        if (held !== 1) {
          throw new ExamPairingConditionFailed();
        }
      }

      // 3. The instructed row, conditional on the state the decision used.
      const written = await tx.examAssignment.updateMany({
        where: {
          id: command.instructedAssignmentId,
          sessionId: command.sessionId,
          role: ROLE_INSTRUCTED_TRAINEE,
          pairingIndex: command.expectedInstructedPairingIndex,
          session: { planId: command.planId },
        },
        data: { pairingIndex: command.pairingIndex },
      });
      if (written.count !== 1) {
        throw new ExamPairingConditionFailed();
      }
    });
    return true;
  } catch (error) {
    // ONLY this module's own sentinel becomes a refusal. Every other throw —
    // an infrastructure fault, a programming error, a framework redirect —
    // propagates with its identity intact.
    if (error instanceof ExamPairingConditionFailed) {
      return false;
    }
    throw error;
  }
}

/**
 * The single-row unpair write: clear the INSTRUCTED row's pairing index, and only
 * while it still holds exactly the expected one.
 *
 * ONE statement, so no transaction: there is nothing to keep consistent with
 * anything else. The `where` clause carries the row id, its session, its role and
 * the plan relation, so the scope is a property of the STATEMENT — greppable by a
 * guard — rather than of the call sequence that produced its arguments.
 *
 * `data` names EXACTLY the pairing column and sets it to `null`. There is no
 * statement in this function — and none in this module — that can touch the
 * EXAMINEE's index, so an unpair provably leaves it where it was.
 */
async function unpairInstructedTrainee(
  command: ExamUnpairWriteCommand,
): Promise<boolean> {
  const cleared = await prisma.examAssignment.updateMany({
    where: {
      id: command.instructedAssignmentId,
      sessionId: command.sessionId,
      role: ROLE_INSTRUCTED_TRAINEE,
      pairingIndex: command.expectedInstructedPairingIndex,
      session: { planId: command.planId },
    },
    data: { pairingIndex: null },
  });
  return cleared.count === 1;
}

// ===========================================================================
// The single entry point
// ===========================================================================

/**
 * Pair ONE already-existing INSTRUCTED_TRAINEE assignment with ONE
 * already-existing EXAMINEE assignment of the SAME session, in the
 * already-existing plan of one authorized, lifecycle-permitted course offering —
 * or, with `examineeAssignmentId === null`, unpair it.
 *
 * Order (the pure core's contract, bound here to real effects):
 *   1. `requireAdminCourseOffering(courseOfferingId)` — admin FIRST, then the
 *      exact offering; a redirect for a non-admin caller propagates untouched;
 *   2. `assertCourseOperationAllowed(status, "SCHEDULE_DRAFT_CONFIGURATION")` on
 *      the VERIFIED status, BEFORE any exam query;
 *   3. both id arguments are re-checked at runtime, BEFORE any exam query;
 *   4. ONE `examPlan.findUnique` on the VERIFIED offering id;
 *   5. no plan -> the core's plan refusal; a plan is NEVER created here;
 *   6. ONE plan-scoped read of the instructed-trainee row; missing or foreign ->
 *      the same refusal, and NO write;
 *   7. ONE plan-scoped read of the examinee row, only when pairing;
 *   8. ONE plan-and-session-scoped read of the session's EXAMINEE rows, only when
 *      pairing;
 *   9. the pure decision — roles, session, reuse or allocation, or a refusal;
 *  10. a no-op issues ZERO statements;
 *  11. otherwise ONE conditional write: a single `updateMany` to unpair, or one
 *      transaction to pair;
 *  12. a failed condition -> the core's stale-write refusal, never a retry.
 *
 * Only two failures are classified — the offering not-found and the lifecycle
 * denial. Every other error propagates unchanged, so a real defect is never
 * laundered into a form error, and the authorization redirect is never swallowed.
 */
export async function setExamInstructedTraineePairing(
  courseOfferingId: string,
  instructedTraineeAssignmentId: string,
  examineeAssignmentId: string | null,
): Promise<SetExamInstructedTraineePairingResult> {
  return setExamInstructedTraineePairingWithDeps(
    courseOfferingId,
    instructedTraineeAssignmentId,
    examineeAssignmentId,
    {
      requireCourseContext,
      assertConfigurationAllowed,
      findExamPlanByCourseOfferingId,
      findAssignmentForPlan,
      findSessionExaminees,
      pairInstructedTrainee,
      unpairInstructedTrainee,
      isCourseNotFoundError,
      isOperationNotAllowedError,
    },
  );
}
