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
  resolveHistoricalGroupInOffering,
  resolveHistoricalHorse,
  type HistoricalGroupResult,
  type HistoricalHorseResult,
  type HorseIntervalRow,
  type OfferingScopedMembership,
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

// ============================================================================
// L2-RH1 - OFFERING-AWARE loader (additive; the loader above is UNCHANGED)
// ============================================================================

/**
 * L2-RH1 - resolver over pre-loaded intervals where the GROUP lookup takes the
 * record's OWN CourseOffering as an explicit argument.
 *
 * `horseAt` is deliberately IDENTICAL to the loader above: TraineeHorseAssignment
 * is keyed by the stable studentId (that is its interval key today), so horse
 * resolution is unchanged by this slice. Enrollment-scoping the horse history is
 * a separate, later change and is explicitly NOT attempted here.
 */
export interface HistoricalTraineeStateByOfferingResolver {
  /**
   * Group effective for `studentId` on `date` WITHIN `courseOfferingId`, or a
   * typed fail-closed result. A null/unknown offering fails closed and is never
   * coerced to any particular offering.
   */
  groupAt(
    studentId: string,
    date: Date,
    courseOfferingId: string | null,
  ): HistoricalGroupResult;
  /** Horse effective for `studentId` on `date`, or a typed fail-closed result. */
  horseAt(studentId: string, date: Date): HistoricalHorseResult;
}

const NO_MEMBERSHIP_IN_OFFERING: HistoricalGroupResult = {
  ok: false,
  kind: "NO_COVERING_MEMBERSHIP",
};

/**
 * L2-RH1 - batch-load historical state where group history spans an EXPLICIT SET
 * of CourseOfferings instead of a single server-resolved "current" one.
 *
 * WHY THIS EXISTS SEPARATELY: `loadHistoricalTraineeState` above resolves group
 * history through `resolveCurrentCourseOffering()`, a singleton resolver that -
 * with a Level 1 and a Level 2 offering both ACTIVE - answers Level 1. Any reader
 * whose records span more than one offering (riding history is the first) must
 * scope each record by the offering that record ACTUALLY belongs to. That loader,
 * its signature, its behaviour and all of its existing call sites are deliberately
 * left untouched; this is a strictly additive second path.
 *
 * NEVER calls `resolveCurrentCourseOffering()`, imports nothing from the
 * temporary Level 2 compatibility module, hardcodes no offering id, and infers
 * nothing from a course level, name, status, date window or group name. The
 * offering ids are supplied by the caller, read from the records themselves.
 *
 * QUERY COST - BOUNDED, NEVER N+1: at most TWO findMany calls in total,
 * regardless of how many trainees, offerings or records are passed:
 *   1. one enrollment+membership read filtered by (studentId IN, courseOfferingId IN);
 *   2. one horse-interval read filtered by (studentId IN).
 * Both input lists are de-duplicated here, so a caller may pass raw per-record
 * arrays. `null` offering ids are dropped from the query filter (they can never
 * match a row) while still failing closed at lookup time.
 *
 * Enrollment `status` is deliberately NOT filtered, exactly like the loader
 * above: a trainee whose enrollment later went INACTIVE must still have their
 * historical group resolve for records written while it was active.
 *
 * Zero unnecessary reads: an empty trainee list issues NO query at all, and an
 * empty (or all-null) offering list skips the enrollment query specifically.
 */
export async function loadHistoricalTraineeStateForOfferings(
  studentIds: readonly string[],
  courseOfferingIds: readonly (string | null)[],
): Promise<HistoricalTraineeStateByOfferingResolver> {
  const uniqueStudentIds = [...new Set(studentIds)].filter((id) => id.length > 0);
  if (uniqueStudentIds.length === 0) {
    return {
      groupAt: () => NO_MEMBERSHIP_IN_OFFERING,
      horseAt: () => ({ ok: false, kind: "NO_COVERING_INTERVAL" }),
    };
  }

  const uniqueOfferingIds = [...new Set(courseOfferingIds)].filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );

  // Group history, offering-scoped. Each membership carries the offering of its
  // own enrollment, so the pure resolver can select by exact offering identity.
  const membershipsByStudent = new Map<string, OfferingScopedMembership[]>();
  if (uniqueOfferingIds.length > 0) {
    const enrollments = await prisma.courseEnrollment.findMany({
      where: {
        studentId: { in: uniqueStudentIds },
        courseOfferingId: { in: uniqueOfferingIds },
      },
      select: {
        studentId: true,
        courseOfferingId: true,
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
      const scoped = enrollment.memberships.map((membership) => ({
        ...membership,
        courseOfferingId: enrollment.courseOfferingId,
      }));
      const existing = membershipsByStudent.get(enrollment.studentId);
      // A dual-enrolled trainee has one enrollment row per offering, so their
      // memberships accumulate across rows rather than overwriting.
      if (existing) existing.push(...scoped);
      else membershipsByStudent.set(enrollment.studentId, scoped);
    }
  }

  // Horse history is keyed by the stable studentId - unchanged from the loader
  // above, and loaded independently of any offering.
  const horseByStudent = new Map<string, HorseIntervalRow[]>();
  const horseRows = await prisma.traineeHorseAssignment.findMany({
    where: { studentId: { in: uniqueStudentIds } },
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
    groupAt(studentId, date, courseOfferingId) {
      return resolveHistoricalGroupInOffering(
        membershipsByStudent.get(studentId) ?? [],
        date,
        courseOfferingId,
      );
    },
    horseAt(studentId, date) {
      return resolveHistoricalHorse(horseByStudent.get(studentId) ?? [], date);
    },
  };
}
