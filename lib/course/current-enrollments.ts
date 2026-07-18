/**
 * MULTI-COURSE W5B0 - server-side IO loader for a single offering's ACTIVE
 * enrollment-backed trainee roster.
 *
 * Server-side only: reads through the shared Prisma client. All mapping,
 * current-membership resolution, ordering, and anomaly detection live in the
 * PURE module enrollment-view.ts; this file is only the narrow query + a single
 * `asOf` capture. It reads NO horse fields in this stage.
 *
 * NOTE (W5B0 scope): NOT wired into any runtime consumer yet.
 */
import { prisma } from "@/lib/prisma";
import { buildEnrollmentRoster, type EnrollmentRosterResult } from "./enrollment-view";

export type { EnrollmentRosterResult } from "./enrollment-view";

/**
 * Load the ACTIVE enrollment-backed roster for one offering, resolved at `asOf`
 * (defaults to the current server time). Filters CourseEnrollment by
 * courseOfferingId + status ACTIVE and selects only the fields needed for
 * trainee-roster parity (no horse fields).
 *
 * All memberships per enrollment are fetched (not pre-filtered to
 * effectiveTo:null): the half-open [effectiveFrom, effectiveTo) validity at
 * `asOf` is decided purely in enrollment-view, so a future or stale membership
 * is surfaced as an anomaly rather than silently trusted. See the interval
 * convention documented in enrollment-view.ts.
 */
export async function getCurrentCourseEnrollmentRoster(
  courseOfferingId: string,
  options?: { asOf?: Date },
): Promise<EnrollmentRosterResult> {
  const asOf = options?.asOf ?? new Date();

  const enrollments = await prisma.courseEnrollment.findMany({
    where: { courseOfferingId, status: "ACTIVE" },
    select: {
      id: true,
      status: true,
      isPrimary: true,
      student: {
        select: { id: true, fullName: true, lastName: true, phone: true },
      },
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

  return buildEnrollmentRoster(enrollments, asOf);
}
