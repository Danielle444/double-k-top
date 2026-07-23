/**
 * MULTI-COURSE (enrollment slice E2) - offering-scoped reader for the EXISTING
 * Students who may be selected for enrollment into ONE exact CourseOffering.
 *
 * This reader powers a FUTURE controlled one-at-a-time admin enrollment form. It
 * is a READ-ONLY data access: it never creates, updates, or deletes anything, and
 * it queries ONLY the Student table (with an exact-offering enrollment-existence
 * relation filter) - never group memberships, horse assignments, schedules,
 * duties, or capabilities.
 *
 * OFFERING SCOPING: the offering is ALWAYS the exact id supplied by the caller.
 * This module NEVER resolves the ACTIVE singleton (resolveCurrentCourseOffering),
 * NEVER reads a selected-course cookie, and NEVER identifies an offering by name
 * or level. The id is normalized with the committed Slice-1 primitive
 * (normalizeOfferingId); an empty/whitespace/invalid id fails closed to an EMPTY
 * list (no query issued), matching getCourseOfferingById's fail-closed-on-invalid
 * convention.
 *
 * SELECTION RULES (verified against the schema):
 *   - Student.isActive === true (globally active only, this first slice).
 *   - EXCLUDE any Student that already has a CourseEnrollment for THIS EXACT
 *     offering. The exclusion is status-AGNOSTIC on purpose: the enrollment table
 *     has @@unique([studentId, courseOfferingId]), so even an INACTIVE prior row
 *     would block a second enrollment - therefore ANY existing row for the target
 *     offering makes the Student non-selectable.
 *   - Dual enrollment IS supported: a Student enrolled in ANOTHER offering (incl.
 *     the ACTIVE Level 1 offering) stays selectable as long as they have no
 *     enrollment in the exact target offering. The filter is keyed ONLY to
 *     courseOfferingId - never to enrollment status, isPrimary, groupName,
 *     subgroupNumber, or current membership.
 *
 * TRUST BOUNDARY: this is admin-only infrastructure. It performs NO requireAdmin()
 * itself - the FUTURE server page/action must call requireAdmin() and validate
 * the exact offering route (requireAdminCourseOffering) BEFORE using this reader.
 * Keeping auth in the page/action mirrors the existing dormant-reader layering
 * (offering-by-id.ts / course-group-tree.ts), which likewise authorize nowhere.
 */
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/app/generated/prisma/client";
import { normalizeOfferingId } from "./offering-by-id-core";

/** The minimal, privacy-narrow item a future admin select + verification needs. */
export interface EnrollableTrainee {
  readonly id: string;
  readonly fullName: string;
  readonly identityNumber: string;
}

/**
 * The EXACT, minimal field selection. Declared once (`as const`) so Prisma
 * narrows the query result to exactly EnrollableTrainee and so a test can assert
 * that NO extra personal data (phone / horse / groupName / notes / health) is
 * ever requested.
 */
export const ENROLLABLE_TRAINEE_SELECT = {
  id: true,
  fullName: true,
  identityNumber: true,
} as const;

/**
 * The exact query the reader issues, constructed once and passed to the injected
 * fetcher. Its shape is what a DB-free test asserts to prove the offering-scoped
 * exclusion, the active-only filter, the minimal select, and the deterministic
 * order - without a live database.
 */
export interface EnrollableTraineesQuery {
  readonly where: Prisma.StudentWhereInput;
  readonly orderBy: Prisma.StudentOrderByWithRelationInput[];
  readonly select: typeof ENROLLABLE_TRAINEE_SELECT;
}

/**
 * Build the offering-scoped enrollable-trainees query for an ALREADY-NORMALIZED
 * offering id (PURE; no IO). Encodes the two selection rules directly:
 *   isActive: true  AND  courseEnrollments: { none: { courseOfferingId } }.
 * The `none` filter carries NO status/isPrimary key, so ANY existing enrollment
 * row for the exact offering excludes the Student (the unique-constraint rule).
 * Ordering is deterministic: fullName ascending, id as the stable tie-breaker.
 */
export function buildEnrollableTraineesQuery(courseOfferingId: string): EnrollableTraineesQuery {
  return {
    where: {
      isActive: true,
      courseEnrollments: { none: { courseOfferingId } },
    },
    orderBy: [{ fullName: "asc" }, { id: "asc" }],
    select: ENROLLABLE_TRAINEE_SELECT,
  };
}

/**
 * Injected boundary. `fetchEnrollableTrainees` receives the built, offering-scoped
 * query and returns the matching rows. There is deliberately NO dependency
 * capable of writing anything, and no dependency that reads group memberships,
 * horse assignments, or any other domain - the operation is structurally a single
 * Student read.
 */
export interface EnrollableTraineesDeps {
  fetchEnrollableTrainees: (query: EnrollableTraineesQuery) => Promise<EnrollableTrainee[]>;
}

/**
 * DB-free DI orchestration: normalize the exact offering id (empty/invalid ->
 * EMPTY list, no fetch), build the offering-scoped query, and delegate the single
 * read to the injected fetcher. No offering is ever inferred; the normalized id is
 * the sole scope.
 */
export async function listEnrollableTraineesWithDeps(
  courseOfferingId: string,
  deps: EnrollableTraineesDeps,
): Promise<EnrollableTrainee[]> {
  const normalized = normalizeOfferingId(courseOfferingId);
  if (normalized === null) {
    return [];
  }
  const query = buildEnrollableTraineesQuery(normalized);
  return deps.fetchEnrollableTrainees(query);
}

/**
 * Thin wrapper binding the real Prisma client. Issues exactly one
 * `prisma.student.findMany` with the offering-scoped where, the minimal select,
 * and the deterministic order. Reads ONLY Student; performs no write and touches
 * no other table.
 */
export async function listEnrollableTrainees(
  courseOfferingId: string,
): Promise<EnrollableTrainee[]> {
  return listEnrollableTraineesWithDeps(courseOfferingId, {
    fetchEnrollableTrainees: (query) =>
      prisma.student.findMany({
        where: query.where,
        orderBy: query.orderBy,
        select: query.select,
      }),
  });
}
