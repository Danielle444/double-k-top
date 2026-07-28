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
 * SCOPE OF M3B-0 (historical): that stage was auth-gate hardening only. The
 * instructor fan-out body was MOVED here verbatim from
 * lib/actions/notifications.ts, and the audience-scoped TRAINEE fan-out was
 * deferred.
 *
 * P-MATERIALS M3B - THE PERSISTED MATERIAL IS NOW AUTHORITATIVE
 * -------------------------------------------------------------
 * M3B-0 fixed WHO may reach this fan-out. It did not make WHAT the caller says
 * authoritative: `title` and `visibility` arrived as parameters, so a direct POST
 * to the Server Action boundary could select the audience and dictate the
 * delivered text with values matching no material at all.
 *
 * This module now re-reads the persisted CourseMaterial ONCE, by id, through
 * ./material-notification-trainee-recipients, and every decision below is taken
 * from that snapshot:
 *
 *   - an unknown materialId fans out to NOBODY (no instructor row, no trainee row);
 *   - a persisted isActive === false fans out to NOBODY;
 *   - the INSTRUCTOR branch is gated on the PERSISTED visibility;
 *   - the TRAINEE branch is gated on the PERSISTED visibility and scoped to the
 *     PERSISTED audience offerings;
 *   - every notification `body` is the PERSISTED title.
 *
 * `params.title` and `params.visibility` are consequently NO LONGER AUTHORITATIVE
 * and are deliberately not read. They are retained ONLY to keep the public Server
 * Action signature byte-identical for its two committed admin call sites; a
 * signature change is a broader API refactor that is explicitly out of this
 * slice. A forged value in either field cannot widen, narrow or alter the
 * fan-out.
 *
 * The INSTRUCTOR RECIPIENT QUERY itself is unchanged (every currently-active
 * instructor); only its gate and its body text moved to the persisted row, which
 * is the security correction this slice exists to make.
 *
 * RECIPIENT RESOLUTION IS DELEGATED, NOT RESTATED. This module holds no audience
 * query, no capability key, no lifecycle comparison and no deduplication: the
 * trainee recipient set arrives already resolved and already deduplicated from
 * the approved shell, which itself delegates every decision to the pure,
 * DB-free-tested ./material-notification-recipient-core.
 */
import { prisma } from "@/lib/prisma";
import { loadMaterialNotificationSnapshot } from "./material-notification-trainee-recipients";
import type { CourseMaterialVisibilityValue } from "@/lib/actions/materials";

// Called from createLinkMaterial (lib/actions/materials.ts) via the authorized
// createMaterialAddedNotifications boundary, and directly from the file upload
// route - in both cases only when a brand-new CourseMaterial row is created,
// never on update/replace of an existing one. Fans recipients out at creation
// time (one Notification row per currently-active instructor in scope, and one
// per eligible trainee of the material's persisted audience), mirroring how
// MessageTaskRecipient already materializes recipients for MessageTask, so a
// later roster, audience or capability change never retroactively adds/removes
// notifications for an already-added material.
export async function fanOutMaterialAddedNotifications(params: {
  materialId: string;
  // NOT AUTHORITATIVE - see the module docstring. Retained only to preserve the
  // committed Server Action signature; the persisted row supplies both values.
  title: string;
  visibility: CourseMaterialVisibilityValue;
}): Promise<void> {
  const notificationTitle = "נוסף חומר קורס חדש";

  // ONE read of the persisted material, shared by BOTH branches below. An
  // unknown id yields null and refuses the entire fan-out - it never falls back
  // to the caller's parameters.
  const material = await loadMaterialNotificationSnapshot(params.materialId);
  if (material === null) return;
  if (material.isActive !== true) return;

  // P-MATERIALS M3B - the TRAINEE branch, restored and course-scoped. It replaces
  // the pre-M2B global Student.isActive query that leaked a material's title, via
  // `body`, to every active trainee including those whose course cannot see the
  // material at all. Recipients arrive already resolved and already deduplicated
  // from the persisted audience, so a trainee reachable through two eligible
  // offerings still receives exactly ONE notification, and no client-supplied
  // recipient list exists anywhere on this path.
  if (material.traineeRecipientIds.length > 0) {
    await prisma.notification.createMany({
      data: material.traineeRecipientIds.map((studentId) => ({
        type: "MATERIAL_ADDED" as const,
        recipientRole: "STUDENT" as const,
        studentId,
        relatedId: material.materialId,
        title: notificationTitle,
        body: material.title,
      })),
    });
  }

  if (material.visibility === "INSTRUCTORS" || material.visibility === "BOTH") {
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
          relatedId: material.materialId,
          title: notificationTitle,
          body: material.title,
        })),
      });
    }
  }
}
