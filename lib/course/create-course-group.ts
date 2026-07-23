/**
 * MULTI-COURSE W9A-3 - server-side IO for creating exactly ONE TOP-LEVEL
 * CourseGroup under an EXPLICITLY scoped, admin-validated CourseOffering.
 *
 * The single write boundary is `prisma.courseGroup.create`. The offering is
 * NEVER inferred from resolveCurrentCourseOffering, the ACTIVE offering, a
 * cookie, the student roster or the group name: it is the exact id passed by the
 * caller, re-validated through requireAdminCourseOffering (admin-authorization-
 * first, exact-id lookup, no fallback). parentGroupId is ALWAYS null - this
 * slice creates top-level groups only (subgroups are the deferred W9A-4 slice).
 *
 * Ordering (hard safety contract, no write before validation + gating):
 *   1. resolve EXACTLY the requested offering context (admin authorized upstream
 *      and again inside requireAdminCourseOffering);
 *   2. gate the mutation by the offering's status via the pure default-deny
 *      operation policy under OFFERING_STRUCTURE_UPDATE (allowed only for
 *      PLANNED; rejected for ACTIVE and ARCHIVED);
 *   3. validate/normalize the submitted group name (pure core);
 *   4. write exactly one top-level CourseGroup.
 *
 * The validation decision lives in the PURE core (create-course-group-core.ts).
 * The IO orchestration is dependency-injected (createCourseGroupWithDeps) so a
 * DB-free test can prove the write boundary without a live database (see
 * create-course-group.test.ts); the thin createCourseGroup wrapper binds the
 * real Prisma client and the real admin/offering resolver.
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
  validateNewCourseGroupInput,
  type CreateCourseGroupValidationErrorCode,
  type RawNewCourseGroupInput,
} from "./create-course-group-core";

/** The full result error surface: validation codes plus IO outcomes. */
export type CreateCourseGroupErrorCode =
  | CreateCourseGroupValidationErrorCode
  | "offering_not_found"
  | "operation_not_allowed"
  | "duplicate_name"
  | "unexpected";

/** Discriminated result: the new group id, or a stable non-PII error code. */
export type CreateCourseGroupResult =
  | { readonly success: true; readonly id: string }
  | { readonly success: false; readonly error: CreateCourseGroupErrorCode };

/** The exact data the single top-level CourseGroup write receives. */
export interface NewCourseGroupWriteData {
  readonly courseOfferingId: string;
  readonly parentGroupId: null;
  readonly name: string;
}

/** The narrow, validated offering context this operation needs (id + status). */
export interface ResolvedOfferingForGroup {
  readonly id: string;
  readonly status: CourseOfferingStatus;
}

/**
 * Injected boundary. `resolveOffering` re-validates the admin + the EXACT
 * offering id (and throws CourseOfferingNotFoundError for an invalid/nonexistent
 * id); `createGroup` is the SOLE write. There is deliberately NO dependency
 * capable of creating an offering, capability, enrollment, membership, student,
 * subgroup or any operational record - the operation is structurally incapable
 * of writing anything but one top-level CourseGroup.
 */
export interface CreateCourseGroupDeps {
  resolveOffering: (courseOfferingId: string) => Promise<ResolvedOfferingForGroup>;
  createGroup: (data: NewCourseGroupWriteData) => Promise<{ id: string }>;
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
 * Create one top-level CourseGroup. Order (fail-closed): resolve the exact
 * offering -> gate by status policy -> validate the name -> write. No write
 * occurs before both the offering is validated and the operation is gated.
 *
 * A missing/invalid offering surfaces as "offering_not_found"; a status that
 * forbids OFFERING_STRUCTURE_UPDATE (ACTIVE/ARCHIVED) surfaces as
 * "operation_not_allowed", both BEFORE any write. The top-level uniqueness
 * violation (schema @@unique AND the hand-written partial unique index
 * course_groups_offering_top_level_name_unique that closes the NULL-distinct
 * gap) surfaces as P2002 -> "duplicate_name"; any other write failure collapses
 * to "unexpected" without exposing raw database details or the submitted name.
 */
export async function createCourseGroupWithDeps(
  courseOfferingId: string,
  input: RawNewCourseGroupInput,
  deps: CreateCourseGroupDeps,
): Promise<CreateCourseGroupResult> {
  // 1. Resolve EXACTLY the requested offering. A typed not-found (invalid /
  //    whitespace / nonexistent id) fails closed; auth redirects and other
  //    errors propagate untouched.
  let offering: ResolvedOfferingForGroup;
  try {
    offering = await deps.resolveOffering(courseOfferingId);
  } catch (error) {
    if (error instanceof CourseOfferingNotFoundError) {
      return { success: false, error: "offering_not_found" };
    }
    throw error;
  }

  // 2. Gate by the offering's status via the pure default-deny policy. Structural
  //    group creation is OFFERING_STRUCTURE_UPDATE (true only for PLANNED).
  try {
    assertCourseOperationAllowed(offering.status, "OFFERING_STRUCTURE_UPDATE");
  } catch (error) {
    if (error instanceof CourseOperationNotPermittedError) {
      return { success: false, error: "operation_not_allowed" };
    }
    throw error;
  }

  // 3. Validate/normalize the name only after the context is validated and gated.
  const validated = validateNewCourseGroupInput(input);
  if (!validated.ok) {
    return { success: false, error: validated.error };
  }

  // 4. Single write. parentGroupId is ALWAYS null (top-level only); the offering
  //    id is the VALIDATED context id, never the raw caller value.
  try {
    const created = await deps.createGroup({
      courseOfferingId: offering.id,
      parentGroupId: null,
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
 * id + status); the only write is prisma.courseGroup.create with parentGroupId
 * hard-coded null.
 */
export async function createCourseGroup(
  courseOfferingId: string,
  input: RawNewCourseGroupInput,
): Promise<CreateCourseGroupResult> {
  return createCourseGroupWithDeps(courseOfferingId, input, {
    resolveOffering: async (id) => {
      const context = await requireAdminCourseOffering(id);
      return { id: context.id, status: context.status };
    },
    createGroup: ({ courseOfferingId: offeringId, parentGroupId, name }) =>
      prisma.courseGroup.create({
        data: { courseOfferingId: offeringId, parentGroupId, name },
        select: { id: true },
      }),
  });
}
