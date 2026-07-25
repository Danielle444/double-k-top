/**
 * COMBINED PARTICIPATION - SLICE 2: server-side IO binding for TRAINEE
 * dual-enrollment derivation on the schedule read.
 *
 * SERVER-ONLY BY CONSTRUCTION: transitively imports next/headers via the Actor
 * DAL (@/lib/auth/actor), which cannot be bundled into client code. Following
 * the repo convention the `server-only` package is not imported.
 *
 * A THIN binding by design: every decision (eligibility, dedup, the "other than
 * the selected offering" predicate, the exact query shape) lives in the PURE
 * cores (combined-participation-visibility-core.ts +
 * trainee-course-selection-core.ts), where the DB-free tests exercise it. This
 * file only supplies the real session reader and the real Prisma query - it
 * adds no filter, no ordering and no id of its own.
 *
 * The committed resolvers in actor-course-offering.ts are deliberately NOT
 * modified: this is a SEPARATE, narrower read used by the schedule item
 * visibility rule only. It answers one boolean and never resolves, substitutes
 * or returns a course context.
 */
import { prisma } from "@/lib/prisma";
import { requireCurrentTrainee } from "@/lib/auth/actor";
import type {
  TraineeEnrollmentQuery,
  TraineeEnrollmentOfferingRow,
} from "./actor-course-offering-core";
import { resolveTraineeDualEnrollmentWithDeps } from "./combined-participation-visibility-core";

/**
 * The exact offering columns the enrollment fetch projects - the same shape the
 * actor-aware resolvers use, so TraineeEnrollmentOfferingRow is satisfied
 * without inventing a second row contract.
 */
const OFFERING_SELECT = {
  id: true,
  activityYearId: true,
  name: true,
  level: true,
  startDate: true,
  endDate: true,
  status: true,
} as const;

/**
 * The one enrollment fetch this binding performs. The query object is built by
 * the pure core and passed through verbatim - no filter, ordering or id is
 * added here, so the database scope is exactly what the tested core decided.
 */
async function fetchTraineeEnrollmentRows({
  take,
  where,
}: TraineeEnrollmentQuery): Promise<TraineeEnrollmentOfferingRow[]> {
  const rows = await prisma.courseEnrollment.findMany({
    take,
    where,
    select: {
      id: true,
      status: true,
      courseOffering: { select: OFFERING_SELECT },
    },
  });
  return rows.map((r) => ({
    enrollmentId: r.id,
    enrollmentStatus: r.status,
    offering: r.courseOffering,
  }));
}

/**
 * Is the AUTHENTICATED trainee dual-enrolled relative to the given
 * SERVER-RESOLVED offering id?
 *
 * The trainee id comes from the signed session, never from the caller - there
 * is no student-id parameter and no dual-flag parameter at all.
 * `selectedCourseOfferingId` must be the server's own already-resolved offering
 * id (the schedule reader passes the id returned by
 * resolveTraineeSelectedCourseOffering, never the raw request value); it never
 * reaches the query and is only compared against the trainee's own rows.
 * Exactly ONE constant query is issued per call.
 */
export async function isTraineeDualEnrolledForSelectedOffering(
  selectedCourseOfferingId: string,
): Promise<boolean> {
  return resolveTraineeDualEnrollmentWithDeps(selectedCourseOfferingId, {
    requireTraineeId: async () => (await requireCurrentTrainee()).id,
    fetchTraineeEnrollmentRows,
  });
}
