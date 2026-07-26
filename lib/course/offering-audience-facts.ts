/**
 * MSG1A - server-side IO reader for one offering's authoritative audience facts:
 * the ACTIVE enrollment roster PLUS each roster trainee's effective group
 * membership in STABLE CourseGroup ids (courseGroupId + parentGroupId).
 *
 * Server-side only: it reads through the shared Prisma client and delegates all
 * roster mapping / current-membership resolution / anomaly detection to the PURE
 * enrollment-view module. It exists because getCurrentCourseEnrollmentRoster maps
 * memberships to legacy (groupName, subgroupNumber) LABELS and discards the group
 * ids, whereas MSG1A's GROUP audience must match by STABLE id - so this reader
 * additionally selects courseGroup.id / parentGroupId and emits the exact
 * EffectiveGroupMembershipEntry list the pure recipient resolver consumes.
 *
 * AUTHORITY: participation is CourseEnrollment (status ACTIVE) only; grouping is
 * GroupMembership resolved as-of. Student.groupName / Student.isActive are NEVER
 * consulted. ONE `courseEnrollment.findMany` (memberships fetched in the same
 * query) - no N+1 over trainees.
 */
import { prisma } from "@/lib/prisma";
import {
  buildEnrollmentRoster,
  isMembershipCurrentAt,
  type EnrollmentRosterResult,
} from "./enrollment-view";
import type { EffectiveGroupMembershipEntry } from "./message-recipient-scope-core";
import { normalizeOfferingId } from "./offering-by-id-core";

export interface OfferingAudienceFacts {
  courseOfferingId: string;
  roster: EnrollmentRosterResult;
  /** One entry per enrollment with exactly one current membership at asOf. */
  effectiveGroupMemberships: EffectiveGroupMembershipEntry[];
}

/**
 * Load the ACTIVE enrollment roster + stable-id effective group memberships for
 * EXACTLY the given offering id, resolved at `asOf` (default: now). An invalid id
 * fails closed to null (no query issued). A valid id with no ACTIVE enrollments
 * returns an empty roster and empty membership list - not an error.
 *
 * The membership list intentionally carries an entry ONLY for enrollments whose
 * membership is unambiguously current (exactly one current interval). Enrollments
 * with zero or multiple current memberships are surfaced in `roster.anomalies` by
 * the pure builder, and MSG1A fails closed on any roster anomaly - so an ambiguous
 * membership never silently omits or mis-groups a trainee.
 */
export async function getOfferingAudienceFacts(
  courseOfferingId: string,
  options?: { asOf?: Date },
): Promise<OfferingAudienceFacts | null> {
  const normalizedId = normalizeOfferingId(courseOfferingId);
  if (normalizedId === null) {
    return null;
  }
  const asOf = options?.asOf ?? new Date();

  const enrollments = await prisma.courseEnrollment.findMany({
    where: { courseOfferingId: normalizedId, status: "ACTIVE" },
    select: {
      id: true,
      status: true,
      isPrimary: true,
      student: { select: { id: true, fullName: true, lastName: true, phone: true } },
      memberships: {
        select: {
          effectiveFrom: true,
          effectiveTo: true,
          courseGroup: {
            select: {
              id: true,
              name: true,
              parentGroupId: true,
              parentGroup: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  const roster = buildEnrollmentRoster(enrollments, asOf);

  const effectiveGroupMemberships: EffectiveGroupMembershipEntry[] = [];
  for (const enrollment of enrollments) {
    const current = enrollment.memberships.filter((m) => isMembershipCurrentAt(m, asOf));
    if (current.length !== 1) {
      // 0 or >1 current memberships is an anomaly (already surfaced in
      // roster.anomalies). Emit no membership entry; the caller fails closed.
      continue;
    }
    const group = current[0].courseGroup;
    effectiveGroupMemberships.push({
      studentId: enrollment.student.id,
      courseGroupId: group.id,
      parentGroupId: group.parentGroupId,
    });
  }

  return { courseOfferingId: normalizedId, roster, effectiveGroupMemberships };
}
