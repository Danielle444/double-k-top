/**
 * MULTI-COURSE W8A-2 - shared, side-effect-free read + write orchestration for
 * the enrollment-scoped horse backfill.
 *
 * This module exists so the SINGLE implementation of the backfill's read/plan/
 * write logic is reused by BOTH runners without duplication:
 *   - scripts/backfill-horse-enrollment.ts           (DRY-RUN default; APPLY is
 *                                                      REFUSED against production)
 *   - scripts/backfill-horse-enrollment.prod-apply.ts (guarded production-only
 *                                                      APPLY entrypoint)
 *
 * It has NO top-level execution (importing it never connects to a DB, never
 * writes, never reads argv/env), so both a runner and a test can import it
 * safely. ALL matching/interval/cache/anomaly business rules live in the PURE,
 * unit-tested module lib/course/horse-enrollment-backfill-plan.ts; this module
 * only performs the I/O that reads rows and turns a plan into writes.
 *
 * WHAT IT WRITES (and NOTHING ELSE):
 *   - TraineeHorseAssignment.courseEnrollmentId  (the FK link)
 *   - CourseEnrollment.hasPrivateHorse / privateHorseName / assignedHorseName
 * It NEVER creates/deletes history rows, NEVER changes effectiveFrom/effectiveTo
 * /studentId/horse values on a history row, and NEVER writes Student.
 */
import type { PrismaClient } from "../app/generated/prisma/client";
import { resolveCurrentCourseOffering } from "../lib/course/current-offering";
import { israelDateKeyFromInstant, utcMidnightToDateKey } from "../lib/trainee-history/israel-date";
import type { DateKey } from "../lib/trainee-history/interval-resolver";
import {
  buildHorseEnrollmentPlan,
  type EnrollmentInput,
  type HorseAssignmentInput,
  type HorseEnrollmentBackfillPlan,
} from "../lib/course/horse-enrollment-backfill-plan";

type Prisma = PrismaClient;

/** A read + built plan, ready to inspect (dry-run) or apply. */
export interface HorseEnrollmentReadResult {
  offeringId: string;
  asOf: DateKey;
  plan: HorseEnrollmentBackfillPlan;
}

/**
 * Read-only: resolve the single current CourseOffering, fetch its enrollments +
 * ALL horse history rows, and build the pure plan. Performs SELECTs only.
 *
 * `now` is a trusted explicit instant; the single captured asOf is the Israel-
 * local calendar day of that instant (the day whose "current" horse we resolve).
 * The current open history interval covers today, so asOf resolves it.
 */
export async function readHorseEnrollmentPlan(
  prisma: Prisma,
  now: Date,
): Promise<HorseEnrollmentReadResult> {
  const offering = await resolveCurrentCourseOffering();
  const asOf = israelDateKeyFromInstant(now);

  const enrollmentRows = await prisma.courseEnrollment.findMany({
    where: { courseOfferingId: offering.id },
    select: {
      id: true,
      studentId: true,
      hasPrivateHorse: true,
      privateHorseName: true,
      assignedHorseName: true,
    },
  });
  const enrollments: EnrollmentInput[] = enrollmentRows.map((e) => ({
    id: e.id,
    studentId: e.studentId,
    hasPrivateHorse: e.hasPrivateHorse,
    privateHorseName: e.privateHorseName,
    assignedHorseName: e.assignedHorseName,
  }));

  // ALL history rows: an orphan row for a student with no current enrollment
  // must surface as a zero-enrollment anomaly rather than be silently skipped.
  const assignmentRows = await prisma.traineeHorseAssignment.findMany({
    select: {
      id: true,
      studentId: true,
      courseEnrollmentId: true,
      assignedHorseName: true,
      hasPrivateHorse: true,
      privateHorseName: true,
      effectiveFrom: true,
      effectiveTo: true,
    },
  });
  const horseAssignments: HorseAssignmentInput[] = assignmentRows.map((a) => ({
    id: a.id,
    studentId: a.studentId,
    courseEnrollmentId: a.courseEnrollmentId,
    assignedHorseName: a.assignedHorseName,
    hasPrivateHorse: a.hasPrivateHorse,
    privateHorseName: a.privateHorseName,
    effectiveFrom: utcMidnightToDateKey(a.effectiveFrom),
    effectiveTo: a.effectiveTo === null ? null : utcMidnightToDateKey(a.effectiveTo),
  }));

  const plan = buildHorseEnrollmentPlan({
    currentOfferingId: offering.id,
    asOf,
    enrollments,
    horseAssignments,
  });

  return { offeringId: offering.id, asOf, plan };
}

/** Structured outcome of an apply, for callers that verify afterwards. */
export interface ApplyHorseResult {
  linkUpdates: number;
  cacheUpdates: number;
}

/**
 * APPLY: perform the plan's writes in ONE transaction. Refuses to write at all
 * unless the plan is fully appliable (zero anomalies). Idempotent: a plan built
 * against an already-correct state has zero updates and this is a no-op.
 *
 * The write set is bounded (<= one FK update per history row + one cache update
 * per enrollment), so a single transaction with a generous timeout is safe -
 * either every allowed field lands or none does.
 */
export async function applyHorseEnrollmentBackfill(
  prisma: Prisma,
  plan: HorseEnrollmentBackfillPlan,
): Promise<ApplyHorseResult> {
  if (!plan.canApply) {
    throw new Error(
      `refusing to apply: plan has ${plan.summary.anomalyTotal} anomaly(ies) (fail-closed).`,
    );
  }

  const result = await prisma.$transaction(
    async (tx) => {
      let linkUpdates = 0;
      let cacheUpdates = 0;
      for (const row of plan.rows) {
        if (row.linkNeedsUpdate) {
          // ONLY the FK is written; studentId/horse/effective dates untouched.
          await tx.traineeHorseAssignment.update({
            where: { id: row.traineeHorseAssignmentId },
            data: { courseEnrollmentId: row.courseEnrollmentId },
          });
          linkUpdates++;
        }
        if (row.isCacheSource && row.cacheNeedsUpdate) {
          // ONLY the three cache fields are written; never Student, never the
          // history row's own horse values.
          await tx.courseEnrollment.update({
            where: { id: row.courseEnrollmentId },
            data: {
              hasPrivateHorse: row.targetHasPrivateHorse,
              privateHorseName: row.targetPrivateHorseName,
              assignedHorseName: row.targetAssignedHorseName,
            },
          });
          cacheUpdates++;
        }
      }
      return { linkUpdates, cacheUpdates };
    },
    { timeout: 60000 },
  );

  return result;
}
