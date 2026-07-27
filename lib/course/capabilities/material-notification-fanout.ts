/**
 * P-MATERIALS M3B-0 - the INTERNAL IO for MATERIAL_ADDED notification fan-out.
 *
 * WHY THIS MODULE EXISTS (architectural containment):
 *
 * lib/actions/notifications.ts carries a "use server" directive, so EVERY async
 * export in it is compiled into a publicly dispatchable Server Action endpoint -
 * reachable by a direct POST, not only through the application's UI, and even
 * when no Client Component imports it. That is a documented Next.js property,
 * not a build accident (see node_modules/next/dist/docs/01-app/02-guides/
 * data-security.md: "even if a Server Action or utility function is not imported
 * elsewhere in your code, it can still be called externally").
 *
 * This module deliberately holds NO "use server" directive of its own. Its
 * exports are ordinary async helpers, NOT Server Actions, so they mint no public
 * endpoint and cannot be invoked directly by a client. It is SERVER-ONLY BY
 * CONSUMPTION: imported only by the "use server" boundary in
 * lib/actions/notifications.ts and by the admin FILE upload Route Handler, never
 * by a client component. The precedent is lib/course/material-audience-write.ts,
 * which is server-only in exactly the same way and for the same reason.
 *
 * AUTHORIZATION IS NOT DUPLICATED HERE. The admin gate lives ONCE, on the
 * exported Server Action boundary (createMaterialAddedNotifications), and the
 * FILE upload Route Handler performs its own equivalent fail-closed admin check
 * before any upload or database write. A second requireAdmin() inside this
 * module would be a second authorization path free to drift from the first, and
 * would drag a redirect-throwing guard into a fetch()-invoked Route Handler
 * where a redirect corrupts the JSON response contract. Callers authorize;
 * this module fans out.
 *
 * SCOPE OF M3B-0: this is an auth-gate hardening stage only. The instructor
 * fan-out body below was MOVED here verbatim from lib/actions/notifications.ts -
 * not rewritten, not reordered, not extended. Recipients, payload, title, body,
 * relatedId and the new-material-only call sites are all unchanged. The
 * audience-scoped TRAINEE fan-out is still deferred to M3B and the pure M3A
 * recipient core remains entirely unwired (this module must not import it).
 */
import { prisma } from "@/lib/prisma";
import type { CourseMaterialVisibilityValue } from "@/lib/actions/materials";

// Called from createLinkMaterial (lib/actions/materials.ts) via the authorized
// createMaterialAddedNotifications boundary, and directly from the file upload
// route - in both cases only when a brand-new CourseMaterial row is created,
// never on update/replace of an existing one. Fans recipients out at creation
// time (one Notification row per currently-active instructor in scope),
// mirroring how MessageTaskRecipient already materializes recipients for
// MessageTask, so a later roster change never retroactively adds/removes
// notifications for an already-added material.
export async function fanOutMaterialAddedNotifications(params: {
  materialId: string;
  title: string;
  visibility: CourseMaterialVisibilityValue;
}): Promise<void> {
  const notificationTitle = "נוסף חומר קורס חדש";

  // P-MATERIALS M2B - TRAINEE (STUDENT) MATERIAL_ADDED notifications are
  // TEMPORARILY SUPPRESSED. The previous branch fanned this notification out to
  // EVERY active student via a global Student.isActive query, so a material
  // scoped (from M2B onward) to only some offerings still leaked its title (in
  // `body`) to trainees who cannot see it - e.g. a Level-1 material notified
  // Level-2-only trainees. The course-scoped trainee fanout is restored in M3
  // via the already-built lib/course/capabilities/material-notification-recipient-core.ts
  // (deliberately NOT deleted). Until then NO student notification is created.
  // Instructor notifications below are unchanged.

  if (params.visibility === "INSTRUCTORS" || params.visibility === "BOTH") {
    const instructors = await prisma.instructor.findMany({
      where: { isActive: true },
      select: { id: true },
    });
    if (instructors.length > 0) {
      await prisma.notification.createMany({
        data: instructors.map((i) => ({
          type: "MATERIAL_ADDED" as const,
          recipientRole: "INSTRUCTOR" as const,
          instructorId: i.id,
          relatedId: params.materialId,
          title: notificationTitle,
          body: params.title,
        })),
      });
    }
  }
}
