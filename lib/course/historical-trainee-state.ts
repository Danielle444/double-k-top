/**
 * MULTI-COURSE W6D3-HOTFIX - BATCHED server loader for historical group/horse
 * resolution.
 *
 * Server-side library (NOT "use server", NOT a Server Action): a plain reader
 * used by historical duty/feedback screens. It loads, in a BOUNDED number of
 * queries (never N+1), the effective-dated GroupMembership and
 * TraineeHorseAssignment intervals for a set of trainees, and returns a resolver
 * that answers group/horse "as of a date" via the PURE core
 * ./historical-trainee-state-core. There is NO current-Student fallback.
 *
 * OFFERING SCOPE: group history is enrollment-scoped, so it is loaded through
 * each trainee's CourseEnrollment in the SERVER-RESOLVED current offering. If the
 * current offering cannot be resolved (0 / ambiguous / incomplete), group
 * history is treated as unavailable (every group lookup fails closed) rather than
 * crashing the page — horse history, keyed by the stable studentId, still
 * resolves. Two findMany calls total regardless of how many trainees are passed.
 */

import { prisma } from "@/lib/prisma";
import { resolveCurrentCourseOffering } from "./current-offering";
import { isKnownCurrentOfferingError } from "./create-trainee-enrollment-core";
import type { RawMembership } from "./enrollment-view";
import {
  resolveHistoricalGroup,
  resolveHistoricalHorse,
  type HistoricalGroupResult,
  type HistoricalHorseResult,
  type HorseIntervalRow,
} from "./historical-trainee-state-core";

/** Resolver over the pre-loaded interval sets; pure lookups, no further IO. */
export interface HistoricalTraineeStateResolver {
  /** Group effective for `studentId` on `date`, or a typed fail-closed result. */
  groupAt(studentId: string, date: Date): HistoricalGroupResult;
  /** Horse effective for `studentId` on `date`, or a typed fail-closed result. */
  horseAt(studentId: string, date: Date): HistoricalHorseResult;
}

const OFFERING_UNRESOLVED: HistoricalGroupResult = {
  ok: false,
  kind: "NO_COVERING_MEMBERSHIP",
};

/**
 * Batch-load the historical state for `studentIds`. Deduplicates ids and issues
 * at most two queries (enrollments+memberships, horse intervals). Safe on an
 * empty list.
 */
export async function loadHistoricalTraineeState(
  studentIds: readonly string[],
): Promise<HistoricalTraineeStateResolver> {
  const uniqueIds = [...new Set(studentIds)].filter((id) => id.length > 0);
  if (uniqueIds.length === 0) {
    return {
      groupAt: () => OFFERING_UNRESOLVED,
      horseAt: () => ({ ok: false, kind: "NO_COVERING_INTERVAL" }),
    };
  }

  // Group history is enrollment-scoped: resolve the current offering, then load
  // each trainee's memberships through their enrollment in that offering. A
  // failed offering resolution degrades to "group unavailable", never a crash.
  const membershipsByStudent = new Map<string, RawMembership[]>();
  let offeringUnavailable = false;
  try {
    const offering = await resolveCurrentCourseOffering();
    const enrollments = await prisma.courseEnrollment.findMany({
      where: { studentId: { in: uniqueIds }, courseOfferingId: offering.id },
      select: {
        studentId: true,
        memberships: {
          select: {
            effectiveFrom: true,
            effectiveTo: true,
            courseGroup: {
              select: {
                name: true,
                parentGroupId: true,
                parentGroup: { select: { name: true } },
              },
            },
          },
        },
      },
    });
    for (const enrollment of enrollments) {
      membershipsByStudent.set(enrollment.studentId, enrollment.memberships);
    }
  } catch (err) {
    if (!isKnownCurrentOfferingError(err)) {
      throw err;
    }
    offeringUnavailable = true;
  }

  // Horse history is keyed by the stable studentId (TraineeHorseAssignment's
  // interval key), so it is loaded independent of offering resolution.
  const horseByStudent = new Map<string, HorseIntervalRow[]>();
  const horseRows = await prisma.traineeHorseAssignment.findMany({
    where: { studentId: { in: uniqueIds } },
    select: {
      studentId: true,
      effectiveFrom: true,
      effectiveTo: true,
      hasPrivateHorse: true,
      privateHorseName: true,
      assignedHorseName: true,
    },
  });
  for (const row of horseRows) {
    const list = horseByStudent.get(row.studentId);
    const interval: HorseIntervalRow = {
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
      hasPrivateHorse: row.hasPrivateHorse,
      privateHorseName: row.privateHorseName,
      assignedHorseName: row.assignedHorseName,
    };
    if (list) {
      list.push(interval);
    } else {
      horseByStudent.set(row.studentId, [interval]);
    }
  }

  return {
    groupAt(studentId, date) {
      if (offeringUnavailable) {
        return OFFERING_UNRESOLVED;
      }
      return resolveHistoricalGroup(membershipsByStudent.get(studentId) ?? [], date);
    },
    horseAt(studentId, date) {
      return resolveHistoricalHorse(horseByStudent.get(studentId) ?? [], date);
    },
  };
}
