/**
 * EXAM EX-ADMIN-WORKSPACE-UX — the two admin exam-workspace WRITES, bound to real
 * effects: EDIT one stored examinee's horse, instruction topic and discipline,
 * and MOVE one stored examinee one position within its own session.
 *
 * SERVER-ONLY BY DECLARATION. `import "server-only"` — the repository
 * convention, already used by every exam read and write binding in this
 * directory — turns an accidental import from a `"use client"` module into a
 * BUILD ERROR. That matters independently of everything else here: this module
 * holds the database client, the admin authorization boundary and the
 * course-lifecycle policy.
 *
 * DELIBERATELY NOT A `"use server"` MODULE. Everything exported from a
 * `"use server"` file becomes a PUBLICLY CALLABLE Server Action with a stable
 * network id. `updateExamAssignmentDetails` and `moveExamAssignment` are
 * ORDINARY async server functions; the route's Server Actions call them.
 *
 * ===========================================================================
 * DIVISION OF LABOUR
 * ===========================================================================
 * The input normalization, the permutation, the refusal set, the no-op rule and
 * the whole decision ORDER live in the pure, DB-free core of this slice, proven
 * by its own runtime suite. (It is named WITHOUT a module path on purpose: the
 * committed containment suites forbid a path-shaped reference to an unwired exam
 * core from anywhere outside `lib/exam`, and a comment is source text like any
 * other.)
 *
 * And here: the REAL admin, policy and database bindings, and nothing else. This
 * module decides no order, invents no outcome and restates no rule.
 *
 * ===========================================================================
 * WHY THESE TWO OPERATIONS EXIST AT ALL
 * ===========================================================================
 * Every other verb the admin exam workspace performs already has a committed
 * writer, and each one is REUSED rather than re-implemented: creating an
 * examinee, creating an instructed trainee, removing either, pairing an
 * instructed trainee with an examinee, and publishing or unpublishing the plan.
 *
 * These two had none. An assignment was write-once — the only way to correct a
 * horse was to delete the row and recreate it, which also destroyed its pairing
 * and its position — and `orderIndex` was assigned at creation and never
 * changeable afterwards. Both gaps are documented in the committed cores' own
 * headers as work a later flow would have to add. This is that flow, and it adds
 * nothing beyond them: no schema change, no migration, no new capability, no new
 * course operation, no notification, no publication rule and no second role.
 *
 * ===========================================================================
 * THE COURSE-LIFECYCLE GATE IS THE *WRITE* GATE
 * ===========================================================================
 * Both operations gate on `SCHEDULE_DRAFT_CONFIGURATION`, exactly as every other
 * committed exam write does — never on `HISTORICAL_READ`, which is the READ
 * gate and would let an ARCHIVED offering's roster be edited.
 *
 * No new `CourseOfferingOperation` is introduced, the committed policy core is
 * not edited, and NO capability is consulted.
 *
 * ===========================================================================
 * A DENIAL IS NEVER A SILENT SUCCESS
 * ===========================================================================
 * Only two failures are classified — the typed "that offering does not exist"
 * and the typed lifecycle denial. Every other error propagates with its identity
 * intact, including the authorization boundary's redirect and any infrastructure
 * fault, so a real defect is never laundered into a form error.
 *
 * ===========================================================================
 * KNOWN, STATED CONCURRENCY LIMITS
 * ===========================================================================
 * The EDIT carries NO version token and is therefore LAST-WRITE-WINS. That is a
 * decision rather than an oversight: publishing a version stamp would mean
 * widening the committed admin assignment reader, which this slice deliberately
 * leaves untouched, and the surface is a single-manager configuration screen.
 * Two managers editing the same examinee at the same moment will see the later
 * save win, silently. The committed delete path already makes the same trade.
 *
 * The MOVE rewrites a whole session's positions in ONE transaction, so it is
 * atomic against itself. Two managers moving different examinees of the SAME
 * session at the same moment will each renumber from the order they read, and
 * the later transaction wins outright; no interleaving can produce a duplicated
 * or missing position, because each transaction writes the complete set.
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
  setExamExamineeInstructedTraineeWithDeps,
  type ExamReplacementAssignmentFacts,
  type ExamReplacementClear,
  type SetExamExamineeInstructedTraineeResult,
} from "@/lib/exam/admin-exam-examinee-pairing-core";
import type {
  ExamPairingDecision,
  ExamPairingExamineeFacts,
  ExamPairingInstructedTraineeFacts,
} from "@/lib/exam/exam-pairing-write-core";
import {
  updateExamAssignmentDetailsWithDeps,
  moveExamAssignmentWithDeps,
  type ExistingExamAssignmentForEdit,
  type MovableExamAssignmentRow,
  type MoveExamAssignmentResult,
  type UpdateExamAssignmentDetailsResult,
} from "@/lib/exam/admin-exam-workspace-edit-core";

export type { SetExamExamineeInstructedTraineeResult } from "@/lib/exam/admin-exam-examinee-pairing-core";

export type {
  MoveExamAssignmentResult,
  UpdateExamAssignmentDetailsResult,
} from "@/lib/exam/admin-exam-workspace-edit-core";

// ===========================================================================
// The trust boundary
// ===========================================================================

/**
 * Admin + exact offering.
 *
 * `requireAdmin()` runs inside `requireAdminCourseOffering` BEFORE the offering
 * is looked up, so an unauthenticated caller is redirected rather than told
 * whether an offering id exists. Only `id` and `status` are carried forward, and
 * the RAW requested id is used at this boundary and nowhere else.
 */
async function requireCourseContext(
  requestedCourseOfferingId: string,
): Promise<{ courseOfferingId: string; status: string }> {
  const context = await requireAdminCourseOffering(requestedCourseOfferingId);
  return { courseOfferingId: context.id, status: context.status };
}

/**
 * The lifecycle WRITE gate. The cast restores the generated enum that the pure
 * core deliberately widened to `string`; it is safe because the committed policy
 * is DEFAULT-DENY — an unrecognized status is refused, never allowed.
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
// The database bindings
// ===========================================================================

/**
 * The plan of ONE course offering, by its VERIFIED id, or `null`.
 *
 * `ExamPlan.courseOfferingId` is `@unique`, so this is a single indexed lookup.
 * It selects the id and NOTHING else, and there is no upsert — a plan is never
 * created by a write to its contents.
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
 * Read ONE assignment for the EDIT, scoped by the SERVER-RESOLVED plan through
 * the session relation, together with the two DEFINITION requirements the pure
 * core is entitled to act on.
 *
 * `findFirst` with the relation filter — never `findUnique({ where: { id } })` —
 * so an assignment under ANOTHER course's plan reads as `null` rather than being
 * found and then rejected by a comparison someone could later remove.
 *
 * NOT selected, and therefore not leakable by any later mapper: `studentId` and
 * every `Student` column, `orderIndex`, `pairingIndex`, `sourcePracticeRole`,
 * `notes`, `createdAt`, `updatedAt`, and every session column but the two
 * definition flags and the session id the relation filter already implies.
 */
async function findAssignmentForPlan(
  planId: string,
  assignmentId: string,
): Promise<ExistingExamAssignmentForEdit | null> {
  const row = await prisma.examAssignment.findFirst({
    where: { id: assignmentId, session: { planId } },
    select: {
      id: true,
      sessionId: true,
      role: true,
      horseName: true,
      instructionTopic: true,
      discipline: true,
      session: {
        select: {
          definition: {
            select: { requiresLessonTopic: true, requiresDiscipline: true },
          },
        },
      },
    },
  });

  if (row === null) {
    return null;
  }
  return {
    assignmentId: row.id,
    sessionId: row.sessionId,
    role: row.role,
    horseName: row.horseName,
    instructionTopic: row.instructionTopic,
    discipline: row.discipline,
    requiresLessonTopic: row.session.definition.requiresLessonTopic,
    requiresDiscipline: row.session.definition.requiresDiscipline,
  };
}

/**
 * Write the three detail columns of ONE assignment, by the id the plan-scoped
 * read RETURNED — never the submitted one.
 *
 * `update` and not `updateMany`: the target is a primary key the server itself
 * resolved, and a row that disappeared between the read and the write throws
 * `P2025`, which propagates rather than being reported as a quiet success.
 *
 * EXACTLY three columns are named in `data`. `sessionId`, `studentId`, `role`,
 * `orderIndex`, `pairingIndex`, `sourcePracticeRole` and `notes` are absent —
 * and unreachable, because the pure core's payload has no field for any of them.
 * `updatedAt` is left to the database.
 */
async function updateAssignmentDetails(
  assignmentId: string,
  details: {
    readonly horseName: string;
    readonly instructionTopic: string | null;
    readonly discipline: string | null;
  },
): Promise<void> {
  await prisma.examAssignment.update({
    where: { id: assignmentId },
    data: {
      horseName: details.horseName,
      instructionTopic: details.instructionTopic,
      discipline: details.discipline,
    },
    select: { id: true },
  });
}

/**
 * Read WHICH SESSION one assignment belongs to, scoped by the SERVER-RESOLVED
 * plan. One column, and the plan scope is the WHERE clause rather than a later
 * comparison.
 */
function findAssignmentSessionForPlan(
  planId: string,
  assignmentId: string,
): Promise<{ sessionId: string } | null> {
  return prisma.examAssignment.findFirst({
    where: { id: assignmentId, session: { planId } },
    select: { sessionId: true },
  });
}

/**
 * Every row of ONE session, in the SAME total order the committed admin reader
 * imposes — `orderIndex`, then `id`.
 *
 * The id tie-break is necessary rather than decorative: the committed create
 * binding documents that two concurrent creates on one session may share an
 * `orderIndex`, so `orderIndex` alone is not a total order and the permutation
 * this feeds would not be stable between two reads.
 *
 * Two columns are selected. No trainee, no horse, no topic, no discipline and no
 * pairing: a permutation needs identity and eligibility and nothing else.
 */
async function listSessionAssignmentsInOrder(
  sessionId: string,
): Promise<MovableExamAssignmentRow[]> {
  const rows = await prisma.examAssignment.findMany({
    where: { sessionId },
    select: { id: true, role: true },
    orderBy: [{ orderIndex: "asc" }, { id: "asc" }],
  });
  return rows.map((row) => ({ assignmentId: row.id, role: row.role }));
}

/**
 * Write `0..n-1` onto the given assignment ids, in ONE transaction.
 *
 * ATOMIC BY CONSTRUCTION: every statement is part of one `$transaction`, so a
 * failure anywhere rolls the whole renumbering back and the session keeps the
 * order it had. A partially renumbered session — two rows at position 3, nobody
 * at position 1 — is therefore unreachable.
 *
 * Each statement is an `updateMany` scoped by BOTH the assignment id AND the
 * session id. The session condition is redundant against a correct permutation
 * and is kept anyway: it means a row that was moved to another session between
 * the read and the write is simply not matched, rather than being renumbered
 * into a session it no longer belongs to.
 *
 * ONE column is written. Nothing else about any row is touched.
 */
async function renumberSessionAssignments(
  sessionId: string,
  orderedAssignmentIds: readonly string[],
): Promise<void> {
  await prisma.$transaction(
    orderedAssignmentIds.map((assignmentId, position) =>
      prisma.examAssignment.updateMany({
        where: { id: assignmentId, sessionId },
        data: { orderIndex: position },
      }),
    ),
  );
}

// ===========================================================================
// 1. The EDIT
// ===========================================================================

/**
 * Update the horse, the instruction topic and the discipline of ONE stored
 * EXAMINEE assignment in the plan of one authorized, lifecycle-permitted course
 * offering.
 *
 * The whole decision order is the pure core's contract; this function supplies
 * the effects and nothing else. It writes no second row, sends no notification,
 * records no history, publishes nothing and reads no capability.
 */
export function updateExamAssignmentDetails(
  courseOfferingId: string,
  rawInput: unknown,
): Promise<UpdateExamAssignmentDetailsResult> {
  return updateExamAssignmentDetailsWithDeps(courseOfferingId, rawInput, {
    requireCourseContext,
    assertConfigurationAllowed,
    findExamPlanByCourseOfferingId,
    findAssignmentForPlan,
    updateAssignmentDetails,
    isCourseNotFoundError,
    isOperationNotAllowedError,
  });
}

// ===========================================================================
// 2. The MOVE
// ===========================================================================

/**
 * Move ONE stored EXAMINEE one position up or down within its own exam session.
 *
 * The session is never submitted — it is read from the target row — so this can
 * never move a person between sessions, and never renumbers a session the
 * manager did not name.
 */
export function moveExamAssignment(
  courseOfferingId: string,
  assignmentId: unknown,
  direction: unknown,
): Promise<MoveExamAssignmentResult> {
  return moveExamAssignmentWithDeps(courseOfferingId, assignmentId, direction, {
    requireCourseContext,
    assertConfigurationAllowed,
    findExamPlanByCourseOfferingId,
    findAssignmentSessionForPlan,
    listSessionAssignmentsInOrder,
    renumberSessionAssignments,
    isCourseNotFoundError,
    isOperationNotAllowedError,
  });
}

// ===========================================================================
// 3. The ATOMIC instructed-trainee replacement
// ===========================================================================

/**
 * The replacement's private ABORT signal — a class declared here and exported
 * nowhere.
 *
 * A replacement writes TWO rows, so a failed condition must UNDO whatever has
 * already been written in the same transaction. Throwing from inside
 * `$transaction` is what rolls it back; catching that one class OUTSIDE turns it
 * into an ordinary `false`, which the pure orchestration reports as a stale
 * write. Any OTHER error keeps its identity and propagates.
 */
class ExamReplacementConditionFailed extends Error {}

/**
 * Read ONE assignment for the replacement, scoped by the SERVER-RESOLVED plan
 * through the session relation.
 *
 * `findFirst` with the relation filter — never `findUnique({ where: { id } })` —
 * so an assignment under ANOTHER course's plan reads as `null` rather than being
 * found and then rejected by a comparison someone could later remove.
 *
 * FOUR columns. No `studentId`, no name, no horse, no topic, no discipline and
 * no timestamp: a pairing decision needs identity, session, role and the index,
 * and reading a person's details for it would put personal data in a place with
 * no use for one.
 */
async function findReplacementAssignmentForPlan(
  planId: string,
  assignmentId: string,
): Promise<ExamReplacementAssignmentFacts | null> {
  const row = await prisma.examAssignment.findFirst({
    where: { id: assignmentId, session: { planId } },
    select: { id: true, sessionId: true, role: true, pairingIndex: true },
  });
  if (row === null) return null;
  return {
    assignmentId: row.id,
    sessionId: row.sessionId,
    role: row.role,
    pairingIndex: row.pairingIndex,
  };
}

/** Every EXAMINEE row of one session — the allocation and ambiguity input. */
async function listReplacementSessionExaminees(
  sessionId: string,
): Promise<readonly ExamPairingExamineeFacts[]> {
  const rows = await prisma.examAssignment.findMany({
    where: { sessionId, role: "EXAMINEE" },
    select: { id: true, pairingIndex: true },
  });
  return rows.map((row) => ({ assignmentId: row.id, pairingIndex: row.pairingIndex }));
}

/** Every INSTRUCTED_TRAINEE row of one session, the edited one included. */
async function listReplacementSessionInstructedTrainees(
  sessionId: string,
): Promise<readonly ExamPairingInstructedTraineeFacts[]> {
  const rows = await prisma.examAssignment.findMany({
    where: { sessionId, role: "INSTRUCTED_TRAINEE" },
    select: { id: true, pairingIndex: true },
  });
  return rows.map((row) => ({ assignmentId: row.id, pairingIndex: row.pairingIndex }));
}

/**
 * Apply the WHOLE switch in ONE transaction.
 *
 * ATOMIC BY CONSTRUCTION, and that is the entire reason this function exists: a
 * replacement clears the trainee that held the examinee and writes the new one,
 * and BOTH statements are part of one `$transaction`. There is therefore no
 * moment at which the examinee is COMMITTED as teaching nobody — a reader either
 * sees the old partner or the new one, never neither.
 *
 * EVERY statement is CONDITIONAL on the exact state the pure decision was made
 * from:
 *
 *   - the clear applies only while the old trainee still holds the exact index
 *     the decision saw;
 *   - the examinee row is claimed by an UPDATE, conditional on still holding the
 *     index the decision expected — which is what serializes two managers
 *     switching the same examinee at once;
 *   - the new trainee's row is written only while it still holds what it held.
 *
 * A failed condition throws the private abort above, the transaction rolls back,
 * and the caller reports a stale write. Nothing is ever half-applied.
 *
 * ONE column is written on each row. No role, no session, no student, no horse,
 * no topic and no discipline is touched.
 */
async function applyExamExamineeInstructedTraineeReplacement(command: {
  readonly clear: ExamReplacementClear | null;
  readonly pair: ExamPairingDecision | null;
  readonly examineeAssignmentId: string;
  readonly sessionId: string;
  readonly instructedTraineeAssignmentId: string | null;
}): Promise<boolean> {
  try {
    await prisma.$transaction(async (tx) => {
      // 1. RELEASE the trainee that currently holds this examinee — conditional
      //    on it still holding exactly the index the decision saw.
      if (command.clear !== null) {
        const cleared = await tx.examAssignment.updateMany({
          where: {
            id: command.clear.instructedTraineeAssignmentId,
            role: "INSTRUCTED_TRAINEE",
            pairingIndex: command.clear.expectedPairingIndex,
          },
          data: { pairingIndex: null },
        });
        if (cleared.count !== 1) throw new ExamReplacementConditionFailed();
      }

      const pair = command.pair;
      const instructedId = command.instructedTraineeAssignmentId;
      if (pair === null || instructedId === null) return;
      if (pair.kind !== "PAIR_WITH_EXISTING_INDEX" && pair.kind !== "PAIR_WITH_NEW_INDEX") {
        // A `NO_CHANGE` or `REFUSE` arm never reaches a write; the pure decision
        // has already turned both into an outcome of its own.
        return;
      }

      // 2. CLAIM the examinee row, by an UPDATE on both paths. Allocation writes
      //    the new index only while the row holds none; reuse writes the index it
      //    already holds back to itself, which takes the same row lock and is what
      //    blocks a rival transaction from claiming the same examinee.
      const claimed = await tx.examAssignment.updateMany({
        where: {
          id: command.examineeAssignmentId,
          role: "EXAMINEE",
          pairingIndex: pair.expectedExamineePairingIndex,
        },
        data: { pairingIndex: pair.pairingIndex },
      });
      if (claimed.count !== 1) throw new ExamReplacementConditionFailed();

      // 3. THE ONE-TO-ONE RULE'S LAST LINE OF DEFENCE, after the examinee row is
      //    locked: no OTHER instructed trainee of this session may hold the index.
      //    The trainee being replaced was released in step 1, inside this same
      //    transaction, so it is correctly not counted here.
      const rivals = await tx.examAssignment.count({
        where: {
          sessionId: command.sessionId,
          role: "INSTRUCTED_TRAINEE",
          pairingIndex: pair.pairingIndex,
          id: { not: instructedId },
        },
      });
      if (rivals !== 0) throw new ExamReplacementConditionFailed();

      // 4. The new trainee's row, conditional on the state the decision used.
      const written = await tx.examAssignment.updateMany({
        where: {
          id: instructedId,
          role: "INSTRUCTED_TRAINEE",
          pairingIndex: pair.expectedInstructedPairingIndex,
        },
        data: { pairingIndex: pair.pairingIndex },
      });
      if (written.count !== 1) throw new ExamReplacementConditionFailed();
    });
    return true;
  } catch (error) {
    if (error instanceof ExamReplacementConditionFailed) return false;
    throw error;
  }
}

/**
 * Set the ONE instructed trainee an examinee teaches — the atomic replacement.
 *
 * The whole decision order is the pure core's contract; this function supplies
 * the effects and nothing else. It restates no pairing rule: the roles, the
 * shared session, index reuse versus allocation, ambiguity and the one-to-one
 * rule are all the committed pairing decision's, reached through that core.
 */
export function setExamExamineeInstructedTrainee(
  courseOfferingId: string,
  examineeAssignmentId: string,
  nextInstructedTraineeAssignmentId: string | null,
): Promise<SetExamExamineeInstructedTraineeResult> {
  return setExamExamineeInstructedTraineeWithDeps(
    courseOfferingId,
    examineeAssignmentId,
    nextInstructedTraineeAssignmentId,
    {
      requireCourseContext,
      assertConfigurationAllowed,
      findExamPlanByCourseOfferingId,
      findAssignmentForPlan: findReplacementAssignmentForPlan,
      listSessionExaminees: listReplacementSessionExaminees,
      listSessionInstructedTrainees: listReplacementSessionInstructedTrainees,
      applyReplacement: applyExamExamineeInstructedTraineeReplacement,
      isCourseNotFoundError,
      isOperationNotAllowedError,
    },
  );
}
