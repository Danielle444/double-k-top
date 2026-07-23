/**
 * MULTI-COURSE W9A-4 - server-side IO for creating exactly ONE numbered subgroup
 * CourseGroup beneath an existing TOP-LEVEL group of an EXPLICITLY scoped,
 * admin-validated CourseOffering.
 *
 * The single write boundary is `prisma.courseGroup.create`. The offering is
 * NEVER inferred from resolveCurrentCourseOffering, the ACTIVE offering, a
 * cookie, the student roster or a group name: it is the exact id passed by the
 * caller, re-validated through requireAdminCourseOffering (admin-authorization-
 * first, exact-id lookup, no fallback). The parent is resolved by ONE compound,
 * offering-scoped, top-level-only lookup; its `parentGroupId IS NULL` predicate
 * is the depth-3 prevention guard (a subgroup can never become the parent).
 *
 * Ordering (hard safety contract, no write before validation + gating + parent
 * proof):
 *   1. resolve EXACTLY the requested offering context (admin authorized upstream
 *      and again inside requireAdminCourseOffering);
 *   2. gate the mutation by the offering's status via the pure default-deny
 *      operation policy under OFFERING_STRUCTURE_UPDATE (allowed only for
 *      PLANNED; rejected for ACTIVE and ARCHIVED) - BEFORE any parent lookup;
 *   3. validate/normalize the submitted subgroup number (pure core);
 *   4. resolve the top-level parent with the compound offering-scoped lookup;
 *   5. write exactly one subgroup CourseGroup.
 *
 * The validation decision lives in the PURE core (create-course-subgroup-core.ts).
 * The IO orchestration is dependency-injected (createCourseSubgroupWithDeps) so a
 * DB-free test can prove the write boundary without a live database (see
 * create-course-subgroup.test.ts); the thin createCourseSubgroup wrapper binds
 * the real Prisma client and the real admin/offering resolver.
 */
import type { CourseOfferingStatus } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  requireAdminCourseOffering,
  CourseOfferingNotFoundError,
} from "./admin-course-context";
import {
  assertCourseOperationAllowed,
  CourseOperationNotPermittedError,
} from "./operation-policy-core";
import {
  validateNewCourseSubgroupInput,
  type CreateCourseSubgroupValidationErrorCode,
  type RawNewCourseSubgroupInput,
} from "./create-course-subgroup-core";

/** The full result error surface: validation code plus IO outcomes. */
export type CreateCourseSubgroupErrorCode =
  | CreateCourseSubgroupValidationErrorCode
  | "offering_not_found"
  | "operation_not_allowed"
  | "invalid_parent"
  | "duplicate_name"
  | "unexpected";

/** Discriminated result: the new subgroup id, or a stable non-PII error code. */
export type CreateCourseSubgroupResult =
  | { readonly success: true; readonly id: string }
  | { readonly success: false; readonly error: CreateCourseSubgroupErrorCode };

/** The exact data the single subgroup CourseGroup write receives. */
export interface NewCourseSubgroupWriteData {
  readonly courseOfferingId: string;
  readonly parentGroupId: string;
  readonly name: string;
}

/** The narrow, validated offering context this operation needs (id + status). */
export interface ResolvedOfferingForSubgroup {
  readonly id: string;
  readonly status: CourseOfferingStatus;
}

/**
 * Injected boundary. `resolveOffering` re-validates the admin + the EXACT
 * offering id (and throws CourseOfferingNotFoundError for an invalid/nonexistent
 * id); `resolveTopLevelParent` performs the SOLE compound parent proof (matches
 * id AND offering AND parentGroupId=null, else null); `createSubgroup` is the
 * SOLE write. There is deliberately NO dependency capable of creating an
 * offering, capability, enrollment, membership, student, top-level group or any
 * operational record - the operation is structurally incapable of writing
 * anything but one subgroup CourseGroup.
 */
export interface CreateCourseSubgroupDeps {
  resolveOffering: (courseOfferingId: string) => Promise<ResolvedOfferingForSubgroup>;
  resolveTopLevelParent: (
    courseOfferingId: string,
    parentGroupId: string,
  ) => Promise<{ id: string } | null>;
  createSubgroup: (data: NewCourseSubgroupWriteData) => Promise<{ id: string }>;
}

/** True only for a Prisma unique-constraint violation (P2002), structurally. */
function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/**
 * Create one numbered subgroup. Order (fail-closed): resolve the exact offering
 * -> gate by status policy -> validate the number -> resolve the top-level
 * parent -> write. No write occurs before the offering is validated, the
 * operation is gated, the number is valid AND the parent is proven top-level in
 * that exact offering.
 *
 * A missing/invalid offering surfaces as "offering_not_found"; a status that
 * forbids OFFERING_STRUCTURE_UPDATE (ACTIVE/ARCHIVED) surfaces as
 * "operation_not_allowed", both BEFORE the parent lookup. An invalid subgroup
 * number surfaces as "subgroup_invalid" BEFORE the parent lookup. A parent that
 * is missing, nonexistent, from another offering, or itself a subgroup collapses
 * to a single "invalid_parent" (the compound lookup returns null for all of
 * them, so which case occurred is never revealed). The subgroup uniqueness
 * violation (schema @@unique on courseOfferingId + parentGroupId + name) surfaces
 * as P2002 -> "duplicate_name"; any other write failure collapses to
 * "unexpected" without exposing raw database details or the submitted number.
 */
export async function createCourseSubgroupWithDeps(
  courseOfferingId: string,
  parentGroupId: string,
  input: RawNewCourseSubgroupInput,
  deps: CreateCourseSubgroupDeps,
): Promise<CreateCourseSubgroupResult> {
  // 1. Resolve EXACTLY the requested offering. A typed not-found (invalid /
  //    whitespace / nonexistent id) fails closed; auth redirects and other
  //    errors propagate untouched.
  let offering: ResolvedOfferingForSubgroup;
  try {
    offering = await deps.resolveOffering(courseOfferingId);
  } catch (error) {
    if (error instanceof CourseOfferingNotFoundError) {
      return { success: false, error: "offering_not_found" };
    }
    throw error;
  }

  // 2. Gate by the offering's status via the pure default-deny policy, BEFORE any
  //    parent lookup. Structural subgroup creation is OFFERING_STRUCTURE_UPDATE
  //    (true only for PLANNED).
  try {
    assertCourseOperationAllowed(offering.status, "OFFERING_STRUCTURE_UPDATE");
  } catch (error) {
    if (error instanceof CourseOperationNotPermittedError) {
      return { success: false, error: "operation_not_allowed" };
    }
    throw error;
  }

  // 3. Validate/normalize the subgroup number, BEFORE any parent lookup or write.
  const validated = validateNewCourseSubgroupInput(input);
  if (!validated.ok) {
    return { success: false, error: validated.error };
  }

  // 4. Prove the parent with ONE compound, offering-scoped, top-level-only
  //    lookup. A null result (missing / nonexistent / other-offering / itself a
  //    subgroup) collapses to invalid_parent. The offering id is the VALIDATED
  //    context id; the parent id is the submitted boundary value.
  const parent = await deps.resolveTopLevelParent(offering.id, parentGroupId);
  if (parent === null) {
    return { success: false, error: "invalid_parent" };
  }

  // 5. Single write. courseOfferingId is the VALIDATED context id; parentGroupId
  //    is the PROVEN top-level parent id; name is the canonical subgroup number.
  try {
    const created = await deps.createSubgroup({
      courseOfferingId: offering.id,
      parentGroupId: parent.id,
      name: validated.value.name,
    });
    return { success: true, id: created.id };
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      return { success: false, error: "duplicate_name" };
    }
    return { success: false, error: "unexpected" };
  }
}

/**
 * Thin wrapper binding the real dependencies. `resolveOffering` re-validates the
 * admin and the exact offering via requireAdminCourseOffering (returning only its
 * id + status); `resolveTopLevelParent` issues the single compound lookup with
 * the `parentGroupId: null` depth guard; the only write is
 * prisma.courseGroup.create with the proven parent id.
 */
export async function createCourseSubgroup(
  courseOfferingId: string,
  parentGroupId: string,
  input: RawNewCourseSubgroupInput,
): Promise<CreateCourseSubgroupResult> {
  return createCourseSubgroupWithDeps(courseOfferingId, parentGroupId, input, {
    resolveOffering: async (id) => {
      const context = await requireAdminCourseOffering(id);
      return { id: context.id, status: context.status };
    },
    resolveTopLevelParent: (offeringId, parentId) =>
      prisma.courseGroup.findFirst({
        where: { id: parentId, courseOfferingId: offeringId, parentGroupId: null },
        select: { id: true },
      }),
    createSubgroup: ({ courseOfferingId: offeringId, parentGroupId: parentId, name }) =>
      prisma.courseGroup.create({
        data: { courseOfferingId: offeringId, parentGroupId: parentId, name },
        select: { id: true },
      }),
  });
}
