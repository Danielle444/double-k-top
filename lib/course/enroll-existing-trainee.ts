/**
 * MULTI-COURSE (enrollment slice E1) - server-side IO for offering-scoped
 * enrollment of an EXISTING trainee.
 *
 * Two layers, mirroring the create-offering.ts convention:
 *   - enrollExistingTraineeWithDeps(input, deps): the DB-free DI orchestration -
 *     normalize input, run the whole proof+write body inside ONE injected
 *     interactive transaction (deps.transaction), and map the internal
 *     AlreadyEnrolledError / any other thrown failure onto the stable result
 *     union. Unit-tested with a fake transaction (enroll-existing-trainee.test.ts).
 *   - enrollExistingTrainee(input): the thin wrapper binding the real Prisma
 *     client. It builds an {@link EnrollTxClient} over a real prisma.$transaction
 *     interactive transaction so every proof AND both writes share one atomic
 *     scope. It creates exactly TWO rows (CourseEnrollment + GroupMembership) and
 *     binds NO TraineeHorseAssignment writer (see the core module header).
 *
 * The offering is ALWAYS the exact id in `input.courseOfferingId`. This module
 * NEVER calls resolveCurrentCourseOffering(), NEVER reads a selected-course
 * cookie, and NEVER selects an offering by name/level. Authorization is NOT done
 * here: this is admin-only infrastructure and the FUTURE server action must call
 * requireAdmin() (with an admin-validated route offering id) before invoking it.
 */
import { prisma } from "@/lib/prisma";
import {
  AlreadyEnrolledError,
  runEnrollmentCreateInTx,
  normalizeEnrollInput,
  type EnrollExistingTraineeInput,
  type EnrollExistingTraineeResult,
  type EnrollTxClient,
} from "./enroll-existing-trainee-core";

export type {
  EnrollExistingTraineeInput,
  EnrollExistingTraineeResult,
  EnrollExistingTraineeErrorCode,
} from "./enroll-existing-trainee-core";

/**
 * The injected transaction boundary: runs `fn` inside one atomic transaction,
 * passing it a transaction-scoped {@link EnrollTxClient}. The real wrapper binds
 * prisma.$transaction; a test binds a fake that observes the flow without a DB.
 */
export interface EnrollExistingTraineeDeps {
  transaction: <T>(fn: (tx: EnrollTxClient) => Promise<T>) => Promise<T>;
}

/**
 * DB-free DI orchestration. Order:
 *   1. normalize/validate the input (pure) -> invalid_input, BEFORE opening a
 *      transaction;
 *   2. run the full proof+write body inside one injected transaction;
 *   3. map failures: the internal AlreadyEnrolledError (a rolled-back concurrent
 *      unique violation on the enrollment) -> already_enrolled; any OTHER thrown
 *      failure (e.g. a horse/membership write error, which also rolled the
 *      transaction back) -> unexpected. Proof failures are returned by the body
 *      itself before any write, so they arrive here as a normal result value.
 */
export async function enrollExistingTraineeWithDeps(
  input: EnrollExistingTraineeInput,
  deps: EnrollExistingTraineeDeps,
): Promise<EnrollExistingTraineeResult> {
  const normalized = normalizeEnrollInput(input);
  if (!normalized.ok) {
    return { success: false, error: "invalid_input" };
  }

  try {
    return await deps.transaction((tx) => runEnrollmentCreateInTx(tx, normalized.value));
  } catch (error) {
    if (error instanceof AlreadyEnrolledError) {
      return { success: false, error: "already_enrolled" };
    }
    // Any other failure means the interactive transaction rolled back all three
    // writes; surface a stable, non-PII code without echoing Prisma internals.
    return { success: false, error: "unexpected" };
  }
}

/**
 * Thin wrapper binding the real Prisma client. Every read AND both writes below
 * run inside a single prisma.$transaction interactive transaction, so the
 * transaction-local proofs are authoritative and any failure rolls back both
 * writes. The Prisma select shapes are kept inline so Prisma infers the exact
 * row payloads. No TraineeHorseAssignment writer is bound.
 *
 * findLeafGroup is the compound ownership+leaf proof: id AND this offering AND
 * parentGroupId NOT null (a top-level group is never a valid target).
 * findExistingEnrollment uses the (studentId, courseOfferingId) compound unique.
 */
export async function enrollExistingTrainee(
  input: EnrollExistingTraineeInput,
): Promise<EnrollExistingTraineeResult> {
  return enrollExistingTraineeWithDeps(input, {
    transaction: (fn) =>
      prisma.$transaction((tx) =>
        fn({
          findOffering: (courseOfferingId) =>
            tx.courseOffering.findUnique({
              where: { id: courseOfferingId },
              select: { id: true, status: true, startDate: true },
            }),
          findStudent: (studentId) =>
            tx.student.findUnique({
              where: { id: studentId },
              select: { id: true, isActive: true },
            }),
          findLeafGroup: (courseGroupId, courseOfferingId) =>
            tx.courseGroup.findFirst({
              where: {
                id: courseGroupId,
                courseOfferingId,
                parentGroupId: { not: null },
              },
              select: { id: true },
            }),
          findExistingEnrollment: (studentId, courseOfferingId) =>
            tx.courseEnrollment.findUnique({
              where: { studentId_courseOfferingId: { studentId, courseOfferingId } },
              select: { id: true },
            }),
          createEnrollment: (data) =>
            tx.courseEnrollment.create({ data, select: { id: true } }),
          createMembership: (data) =>
            tx.groupMembership.create({ data, select: { id: true } }),
        }),
      ),
  });
}
