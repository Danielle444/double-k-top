/**
 * MULTI-COURSE (dormant foundation, Slice 5) - server-side IO wrapper for the
 * explicit-ID CourseOffering group hierarchy.
 *
 * Server-side only: reads through the shared Prisma client. All normalization,
 * mapping, ordering and anomaly classification is delegated to the PURE core
 * (course-group-tree-core.ts), so this stays a thin, un-tested-by-design IO shell.
 *
 * DORMANT: NOT wired into any route, layout, action, resolver, navigation item
 * or component. It reuses the committed Slice 1 id-normalization primitive
 * (normalizeOfferingId) and is deliberately independent of the singleton resolver
 * (current-offering.ts is NOT imported). It does not authorize an actor, read a
 * cookie, inspect the auth session, apply write-status policy, revalidate, redirect,
 * write, or fall back to another offering - authorization and context wiring are a
 * later stage's concern.
 */
import { prisma } from "@/lib/prisma";
import { normalizeOfferingId } from "./offering-by-id-core";
import { buildCourseGroupTree, type CourseGroupTreeView } from "./course-group-tree-core";

export type {
  CourseGroupTreeView,
  CourseGroupTopLevelNode,
  CourseGroupSubgroupNode,
  CourseGroupTreeAnomaly,
  CourseGroupTreeAnomalyReason,
} from "./course-group-tree-core";

/**
 * Fetch the deterministic, read-only group hierarchy for EXACTLY the given
 * CourseOffering id.
 *
 * Contract:
 *   - the id is normalized via the committed Slice 1 normalizeOfferingId;
 *   - an invalid id (empty / whitespace-only / non-string) FAILS CLOSED as null -
 *     no query is issued and no fallback offering is consulted;
 *   - a valid id issues AT MOST ONE `courseGroup.findMany` with the single
 *     indexed predicate `where: { courseOfferingId: normalizedId }` (never
 *     findFirst, never a status/year/count guess, never the singleton resolver);
 *   - a valid id with no groups returns a NON-null empty view
 *     ({ topLevel: [], anomalies: [] }) - "no groups" is not an error, only an
 *     invalid id is;
 *   - all shaping is delegated to the pure core.
 */
export async function getCourseGroupTreeByOfferingId(
  courseOfferingId: string,
): Promise<CourseGroupTreeView | null> {
  const normalizedId = normalizeOfferingId(courseOfferingId);
  if (normalizedId === null) {
    return null;
  }

  const rows = await prisma.courseGroup.findMany({
    where: { courseOfferingId: normalizedId },
    select: {
      id: true,
      name: true,
      parentGroupId: true,
    },
  });

  return buildCourseGroupTree(rows);
}
