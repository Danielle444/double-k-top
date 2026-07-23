"use server";

/**
 * MULTI-COURSE W9A-3 - the single admin action for creating one TOP-LEVEL
 * CourseGroup under an explicitly scoped CourseOffering.
 *
 * Ordering is a hard safety contract:
 *   1. requireAdmin() FIRST - authorize before any read or write;
 *   2. extract and reject a missing/non-string/empty courseOfferingId (the
 *      explicit route scope is the ONLY course context - never a cookie, the
 *      ACTIVE offering, resolveCurrentCourseOffering, the roster or the name);
 *   3. hand the exact id + raw name to the create-course-group IO, which
 *      re-validates the admin + exact offering, gates the write by status via
 *      OFFERING_STRUCTURE_UPDATE, validates the name, and performs the single
 *      prisma.courseGroup.create with parentGroupId hard-coded null;
 *   4. on failure, redirect back to the explicit groups page carrying only a
 *      stable, non-PII error code (an invalid offering scope routes to the safe
 *      courses list instead of reflecting an unvalidated id in a groups URL);
 *   5. on success, revalidate exactly this groups page and redirect back with a
 *      stable created flag.
 * redirect() signals via NEXT_REDIRECT, so every branch sits outside any
 * try/catch and propagates. This action creates NOTHING but one top-level
 * CourseGroup.
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createCourseGroup } from "@/lib/course/create-course-group";
import {
  createCourseSubgroup,
  type CreateCourseSubgroupErrorCode,
} from "@/lib/course/create-course-subgroup";

export async function createCourseGroupAction(formData: FormData): Promise<void> {
  await requireAdmin();

  const candidate = formData.get("courseOfferingId");
  // Fail closed on a missing / non-string / empty explicit scope - no lookup, no
  // reflection; route to the safe courses list rather than a groups URL.
  if (typeof candidate !== "string" || candidate.trim().length === 0) {
    redirect("/admin/courses?error=invalid");
  }

  const result = await createCourseGroup(candidate, { name: formData.get("name") });

  const groupsPath = `/admin/courses/${encodeURIComponent(candidate)}/groups`;

  if (!result.success) {
    if (result.error === "offering_not_found") {
      // The explicit id did not resolve to a real offering; do not build a
      // groups URL from it - fall back to the safe courses list.
      redirect("/admin/courses?error=invalid");
    }
    // For a validated offering (name/duplicate/policy errors), return to its
    // groups page with only a stable code.
    redirect(`${groupsPath}?error=${encodeURIComponent(result.error)}`);
  }

  // Success: revalidate exactly this groups page so the new group appears.
  revalidatePath(groupsPath);
  redirect(`${groupsPath}?created=1`);
}

/**
 * MULTI-COURSE W9A-4 - the single admin action for creating one numbered subgroup
 * beneath one existing TOP-LEVEL CourseGroup of an explicitly scoped
 * CourseOffering.
 *
 * Same hard safety contract as createCourseGroupAction:
 *   1. requireAdmin() FIRST - authorize before any read or write;
 *   2. extract and reject a missing/non-string/empty courseOfferingId (the
 *      explicit route scope is the ONLY course context) and, likewise, a
 *      missing/non-string/empty parentGroupId boundary value;
 *   3. hand the exact offering id + exact parent id + raw subgroup number to the
 *      create-course-subgroup IO, which re-validates the admin + exact offering,
 *      gates the write by OFFERING_STRUCTURE_UPDATE (PLANNED only), validates the
 *      number, proves the parent with one compound offering-scoped top-level-only
 *      lookup, and performs the single prisma.courseGroup.create;
 *   4. on failure, redirect back to the explicit groups page carrying only a
 *      stable, non-PII error code (an invalid offering scope routes to the safe
 *      courses list instead of reflecting an unvalidated id in a groups URL);
 *   5. on success, revalidate exactly this groups page and redirect back with the
 *      same stable created flag W9A-3 uses.
 * This action creates NOTHING but one subgroup CourseGroup.
 */

/**
 * Map the writer's internal result codes onto the stable, subgroup-specific
 * ?error= query codes the groups page understands. offering_not_found is handled
 * separately (it routes to the safe courses list, never a groups URL). The
 * subgroup-specific codes keep the W9A-3 top-level messages untouched while
 * giving subgroup failures their own accurate Hebrew wording.
 */
const SUBGROUP_ERROR_QUERY: Record<
  Exclude<CreateCourseSubgroupErrorCode, "offering_not_found">,
  string
> = {
  operation_not_allowed: "subgroup_operation_not_allowed",
  invalid_parent: "invalid_parent",
  subgroup_invalid: "subgroup_invalid",
  duplicate_name: "subgroup_duplicate_name",
  unexpected: "unexpected",
};

export async function createCourseSubgroupAction(formData: FormData): Promise<void> {
  await requireAdmin();

  const candidate = formData.get("courseOfferingId");
  // Fail closed on a missing / non-string / empty explicit scope - no lookup, no
  // reflection; route to the safe courses list rather than a groups URL.
  if (typeof candidate !== "string" || candidate.trim().length === 0) {
    redirect("/admin/courses?error=invalid");
  }

  const parentCandidate = formData.get("parentGroupId");
  // Fail closed on a missing / non-string / empty parent boundary value. At this
  // point `candidate` is only proven to be a non-empty string - the offering has
  // NOT yet been resolved by requireAdminCourseOffering (that happens inside
  // createCourseSubgroup) - so it must not be reflected into a groups URL. Route
  // to the safe courses list rather than building a groups path from an
  // unvalidated offering id.
  if (typeof parentCandidate !== "string" || parentCandidate.trim().length === 0) {
    redirect("/admin/courses?error=invalid");
  }

  // Both boundary identifiers have now passed action-level validation, so it is
  // safe to build the explicit groups path used for the writer's failure/success
  // redirects (the writer still re-validates the exact offering itself).
  const groupsPath = `/admin/courses/${encodeURIComponent(candidate)}/groups`;

  const result = await createCourseSubgroup(candidate, parentCandidate, {
    subgroupNumber: formData.get("subgroupNumber"),
  });

  if (!result.success) {
    if (result.error === "offering_not_found") {
      // The explicit id did not resolve to a real offering; do not build a
      // groups URL from it - fall back to the safe courses list.
      redirect("/admin/courses?error=invalid");
    }
    // For a validated offering (parent/number/duplicate/policy errors), return to
    // its groups page with only a stable, subgroup-specific code.
    redirect(`${groupsPath}?error=${encodeURIComponent(SUBGROUP_ERROR_QUERY[result.error])}`);
  }

  // Success: revalidate exactly this groups page so the new subgroup appears.
  revalidatePath(groupsPath);
  redirect(`${groupsPath}?created=1`);
}
