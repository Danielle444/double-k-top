"use server";

/**
 * ACTIVE-RENAME - the single admin action for renaming one existing
 * CourseOffering (changing ONLY its name).
 *
 * Ordering is a hard safety contract:
 *   1. requireAdmin() FIRST - authorize before any read or write;
 *   2. the offering id is a SERVER-BOUND argument taken from the validated course
 *      route (the page binds context.id via .bind), NEVER a client-submitted form
 *      field - so a client cannot retarget the rename at another route's offering.
 *      The rename IO still independently re-validates the admin + exact offering
 *      via requireAdminCourseOffering;
 *   3. hand the bound id + the raw expectedCurrentName + raw new name to the
 *      rename IO, which validates, gates the write by OFFERING_METADATA_UPDATE
 *      (PLANNED/ACTIVE only), and performs the single atomic conditional update
 *      of ONLY the name column;
 *   4. on failure, redirect back to this exact course shell carrying only a
 *      stable, non-PII error code (never the raw submitted values); an invalid
 *      offering scope routes to the safe courses list instead;
 *   5. on success (including a same-name no-op), revalidate this course shell AND
 *      the courses list so the new name appears in the course header, the course
 *      switcher and the courses-list card, then redirect back with a stable flag.
 * redirect() signals via NEXT_REDIRECT, so every branch sits outside any
 * try/catch and propagates. This action changes NOTHING but one offering's name.
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { renameCourseOffering } from "@/lib/course/rename-offering";

export async function renameCourseOfferingAction(
  courseOfferingId: string,
  formData: FormData,
): Promise<void> {
  await requireAdmin();

  const result = await renameCourseOffering({
    // Server-bound route id - not read from the client form.
    courseOfferingId,
    expectedCurrentName: formData.get("expectedCurrentName"),
    name: formData.get("name"),
  });

  const shellPath = `/admin/courses/${encodeURIComponent(courseOfferingId)}`;

  if (!result.success) {
    if (result.error === "offering_not_found") {
      // The bound id did not resolve to a real offering; do not build a shell URL
      // from it - fall back to the safe courses list.
      redirect("/admin/courses?error=invalid");
    }
    // For a validated offering (name/duplicate/stale/policy errors), return to
    // its shell with only a stable code.
    redirect(`${shellPath}?error=${encodeURIComponent(result.error)}`);
  }

  // Success (including no-op): revalidate the shell (header + this page) and the
  // courses list (switcher options + list cards) so the new name is reflected.
  revalidatePath(shellPath);
  revalidatePath("/admin/courses");
  redirect(`${shellPath}?renamed=1`);
}
