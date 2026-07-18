/**
 * MULTI-COURSE W5B0 - server-side IO wrapper for the TEMPORARY singleton
 * current-offering resolver.
 *
 * Server-side only: it reads through the shared Prisma client. The cardinality
 * decision is delegated to the PURE core (current-offering-core.ts) so this
 * file stays a thin, un-tested-by-design IO shell. No arguments, no client-
 * controlled course id, no auth/session coupling: the offering is resolved
 * solely from the database's single-offering invariant.
 *
 * NOTE (W5B0 scope): this module is NOT wired into any runtime consumer yet.
 * The first pilot (getStudentContacts) is wired only in a later stage, after the
 * parity result is reviewed.
 */
import { prisma } from "@/lib/prisma";
import {
  resolveCurrentCourseOfferingFromRows,
  type CurrentCourseOffering,
} from "./current-offering-core";

export {
  NoCurrentCourseOfferingError,
  AmbiguousCourseOfferingError,
  IncompleteCourseOfferingError,
  type CurrentCourseOffering,
  type CourseOfferingRow,
} from "./current-offering-core";

/**
 * Resolve the current CourseOffering by the temporary single-offering
 * invariant. Fetches at most two rows and lets the pure core decide:
 *  - 0 rows  -> throws NoCurrentCourseOfferingError
 *  - 1 row   -> returns the stable CurrentCourseOffering view
 *  - >=2 rows -> throws AmbiguousCourseOfferingError (never picks one)
 */
export async function resolveCurrentCourseOffering(): Promise<CurrentCourseOffering> {
  const rows = await prisma.courseOffering.findMany({
    take: 2,
    select: {
      id: true,
      activityYearId: true,
      name: true,
      level: true,
      startDate: true,
      endDate: true,
      status: true,
    },
  });
  return resolveCurrentCourseOfferingFromRows(rows);
}
