/**
 * ACTIVE-RENAME - server-side IO for renaming exactly one existing
 * CourseOffering, changing ONLY its name.
 *
 * The single write boundary is an ATOMIC CONDITIONAL update
 * (`prisma.courseOffering.updateMany`) matched on BOTH the exact id AND the
 * expected current name. The offering is NEVER inferred from
 * resolveCurrentCourseOffering, the ACTIVE offering, a cookie or the name: it is
 * the exact id passed by the caller, re-validated through
 * requireAdminCourseOffering (admin-authorization-first, exact-id lookup, no
 * fallback). Only the `name` column is ever written; status, dates, level,
 * activityYearId, capabilities, groups, enrollments, memberships and every
 * operational record are untouched.
 *
 * Ordering (hard safety contract, no write before validation + gating):
 *   1. validate/normalize the raw fields (pure core);
 *   2. resolve EXACTLY the requested offering context (admin authorized upstream
 *      and again inside requireAdminCourseOffering);
 *   3. gate the mutation by the offering's status via the pure default-deny
 *      operation policy under OFFERING_METADATA_UPDATE (allowed for PLANNED and
 *      ACTIVE; rejected for ARCHIVED);
 *   4. if the new name equals the expected current name, succeed as a NO-OP with
 *      NO write;
 *   5. otherwise perform the single atomic conditional update.
 *
 * STALE-WRITE PROTECTION: the update matches `{ id, name: expectedCurrentName }`.
 * Because the offering is already proven to exist (step 2), an update count of 0
 * means the stored name no longer equals expectedCurrentName - a concurrent
 * rename happened - which surfaces as "stale_name". There is deliberately NO
 * unguarded fallback update after a separate read: the read-modify-write is a
 * single conditional statement, so two overlapping renames can never clobber
 * each other.
 *
 * The validation decision lives in the PURE core (rename-offering-core.ts). The
 * IO orchestration is dependency-injected (renameCourseOfferingWithDeps) so a
 * DB-free test can prove the write boundary without a live database (see
 * rename-offering.test.ts); the thin renameCourseOffering wrapper binds the real
 * Prisma client and the real admin/offering resolver.
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
  validateRenameOfferingInput,
  type RenameOfferingValidationErrorCode,
  type RawRenameOfferingInput,
} from "./rename-offering-core";

/** The full result error surface: validation codes plus IO outcomes. */
export type RenameOfferingErrorCode =
  | RenameOfferingValidationErrorCode
  | "offering_not_found"
  | "operation_not_allowed"
  | "duplicate_name"
  | "stale_name"
  | "unexpected";

/**
 * Discriminated result. On success `changed` is false for a same-name no-op
 * (nothing was written) and true when the atomic conditional update renamed the
 * row.
 */
export type RenameOfferingResult =
  | { readonly success: true; readonly id: string; readonly changed: boolean }
  | { readonly success: false; readonly error: RenameOfferingErrorCode };

/** The narrow, validated offering context this operation needs (id + status). */
export interface ResolvedOfferingForRename {
  readonly id: string;
  readonly status: CourseOfferingStatus;
}

/**
 * Injected boundary. `resolveOffering` re-validates the admin + the EXACT
 * offering id (and throws CourseOfferingNotFoundError for an invalid/nonexistent
 * id); `renameOffering` is the SOLE write - an atomic conditional update matched
 * on (id, expectedCurrentName) that returns the number of rows changed. There is
 * deliberately NO dependency capable of writing status, dates, level,
 * activityYear, a capability, group, enrollment, membership or any operational
 * record - the operation is structurally incapable of writing anything but the
 * name column of one CourseOffering.
 */
export interface RenameOfferingDeps {
  resolveOffering: (courseOfferingId: string) => Promise<ResolvedOfferingForRename>;
  renameOffering: (
    courseOfferingId: string,
    expectedCurrentName: string,
    name: string,
  ) => Promise<number>;
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
 * Rename one CourseOffering's name. Order (fail-closed): validate -> resolve the
 * exact offering -> gate by status policy -> no-op short-circuit -> single atomic
 * conditional update. No write occurs before both the offering is validated and
 * the operation is gated.
 *
 * A missing/invalid offering surfaces as "offering_not_found"; a status that
 * forbids OFFERING_METADATA_UPDATE (ARCHIVED) surfaces as "operation_not_allowed",
 * both BEFORE any write. A same-name request succeeds as a no-op WITHOUT writing.
 * A unique-constraint violation on (activityYearId, name) surfaces as
 * P2002 -> "duplicate_name"; a zero-row conditional update means the current name
 * changed under us -> "stale_name"; any other write failure collapses to
 * "unexpected" without exposing raw database details or the submitted name.
 */
export async function renameCourseOfferingWithDeps(
  input: RawRenameOfferingInput,
  deps: RenameOfferingDeps,
): Promise<RenameOfferingResult> {
  // 1. Validate/normalize the raw fields first (pure, no DB). Rejects a missing
  //    id / expected name / empty new name before any read or write.
  const validated = validateRenameOfferingInput(input);
  if (!validated.ok) {
    return { success: false, error: validated.error };
  }
  const { courseOfferingId, expectedCurrentName, name, isNoOp } = validated.value;

  // 2. Resolve EXACTLY the requested offering. A typed not-found (invalid /
  //    whitespace / nonexistent id) fails closed; auth redirects and other
  //    errors propagate untouched.
  let offering: ResolvedOfferingForRename;
  try {
    offering = await deps.resolveOffering(courseOfferingId);
  } catch (error) {
    if (error instanceof CourseOfferingNotFoundError) {
      return { success: false, error: "offering_not_found" };
    }
    throw error;
  }

  // 3. Gate by the offering's status via the pure default-deny policy. A name
  //    change is OFFERING_METADATA_UPDATE (allowed for PLANNED and ACTIVE;
  //    rejected for ARCHIVED). Gated even for a no-op: an ARCHIVED offering is
  //    read-only and must never report a rename as "succeeded".
  try {
    assertCourseOperationAllowed(offering.status, "OFFERING_METADATA_UPDATE");
  } catch (error) {
    if (error instanceof CourseOperationNotPermittedError) {
      return { success: false, error: "operation_not_allowed" };
    }
    throw error;
  }

  // 4. Same-name no-op: nothing to change. Succeed WITHOUT any write.
  if (isNoOp) {
    return { success: true, id: offering.id, changed: false };
  }

  // 5. Single atomic conditional update. The offering id is the VALIDATED context
  //    id; the match requires the expected current name to STILL be present, so a
  //    concurrent rename yields a zero-row count rather than a clobber.
  let changedCount: number;
  try {
    changedCount = await deps.renameOffering(offering.id, expectedCurrentName, name);
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      return { success: false, error: "duplicate_name" };
    }
    return { success: false, error: "unexpected" };
  }

  if (changedCount === 0) {
    // The offering exists (step 2) but its name no longer equals
    // expectedCurrentName. Report stale WITHOUT any unguarded fallback write.
    return { success: false, error: "stale_name" };
  }

  return { success: true, id: offering.id, changed: true };
}

/**
 * Thin wrapper binding the real dependencies. `resolveOffering` re-validates the
 * admin and the exact offering via requireAdminCourseOffering (returning only its
 * id + status); the only write is the atomic conditional
 * prisma.courseOffering.updateMany matched on (id, expectedCurrentName), writing
 * ONLY the name column.
 */
export async function renameCourseOffering(
  input: RawRenameOfferingInput,
): Promise<RenameOfferingResult> {
  return renameCourseOfferingWithDeps(input, {
    resolveOffering: async (id) => {
      const context = await requireAdminCourseOffering(id);
      return { id: context.id, status: context.status };
    },
    renameOffering: async (courseOfferingId, expectedCurrentName, name) => {
      const result = await prisma.courseOffering.updateMany({
        where: { id: courseOfferingId, name: expectedCurrentName },
        data: { name },
      });
      return result.count;
    },
  });
}
