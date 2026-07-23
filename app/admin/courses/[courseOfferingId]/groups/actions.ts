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
