"use server";

/**
 * LEVEL 2 MATERIALS ENTRY POINT - the server-derived boolean that tells the
 * trainee client whether the "חומרי קורס" NAVIGATION ENTRY should be offered.
 *
 * WHY THIS EXISTS
 * ---------------
 * The trainee navigation currently decides Level-2-only visibility from a
 * hard-coded allow-list keyed on the offering LEVEL (app/student/trainee-nav-
 * visibility.ts, an explicitly temporary launch rule). That list predates
 * COURSE_MATERIALS being enabled for Level 2, so a Level-2-only trainee lost the
 * entry point even with an ACTIVE enrollment, an ACTIVE offering, an ENABLED
 * capability and an assigned audience row. This action replaces the guess for
 * that ONE entry with the real, server-side capability decision.
 *
 * NAVIGATION ONLY - THIS IS NOT THE CONTENT GATE. A `true` here unlocks a menu
 * button, nothing else. getStudentMaterials (lib/actions/materials.ts) remains
 * the sole authority over which material rows a trainee may actually read, and
 * it re-derives this same scope independently on every call. A wrong `true` here
 * can therefore only produce an empty materials screen, never a leak.
 *
 * NO SECOND CAPABILITY RESOLVER. The whole decision is delegated to the SHARED
 * resolveTraineeEnabledMaterialsOfferingIdsWithDeps, the exact function
 * getStudentMaterials uses, with the exact same enrollment projection and the
 * exact same effective-capability read. The only difference is that this caller
 * stops at "is the enabled set non-empty" and never touches a CourseMaterial row,
 * an audience row or a signed storage URL.
 *
 * The trainee is ALWAYS session-derived: this action takes no parameters, so
 * there is no studentId and no courseOfferingId a caller could supply. There is
 * no Level 1 fallback, no single-offering collapse, and no inference from course
 * name, level, date window, group or the client's selected course.
 */
import { prisma } from "@/lib/prisma";
import { requireCurrentTrainee } from "@/lib/auth/actor";
import { getEffectiveCapabilities } from "@/lib/course/capabilities/offering-capabilities";
import type { CapabilityKey } from "@/lib/course/capabilities/capability-keys";
import { resolveTraineeEnabledMaterialsOfferingIdsWithDeps } from "@/lib/course/trainee-materials-offering-scope-core";

/**
 * The single capability that authorizes any trainee course-material surface -
 * the SAME canonical key the content reader uses, typed as CapabilityKey so a
 * typo is a compile error. No unrelated capability is reused.
 */
const TRAINEE_COURSE_MATERIALS_CAPABILITY_KEY: CapabilityKey = "COURSE_MATERIALS";

/**
 * Does the authenticated trainee have at least ONE active enrollment into an
 * ACTIVE CourseOffering whose effective COURSE_MATERIALS capability is ENABLED?
 *
 * True for a Level-1-only, a Level-2-only and a dual-enrolled trainee alike -
 * one matching offering is enough, and every offering is evaluated on its own
 * capability row. A missing capability row stays effectively DISABLED (CAP-1),
 * READ_ONLY denies, and a retired catalog entry denies.
 *
 * Denials (anonymous, expired, wrong-audience, inactive trainee, no enrollment,
 * nothing enabled) all return `false` indistinguishably. Infrastructure failures
 * (Prisma, capability reader) PROPAGATE rather than being laundered into
 * `false` - the client decides what a rejection means for navigation, and this
 * action must not silently report a broken database as "no access".
 */
export async function hasAnyActiveEnabledCourseMaterialsOffering(): Promise<boolean> {
  const enabledOfferingIds = await resolveTraineeEnabledMaterialsOfferingIdsWithDeps({
    requireTraineeId: async () => (await requireCurrentTrainee()).id,
    loadEnrollments: async (traineeId) => {
      const rows = await prisma.courseEnrollment.findMany({
        where: { studentId: traineeId },
        select: {
          courseOfferingId: true,
          status: true,
          courseOffering: { select: { status: true } },
        },
      });
      return rows.map((r) => ({
        courseOfferingId: r.courseOfferingId,
        enrollmentStatus: r.status,
        offeringStatus: r.courseOffering.status,
      }));
    },
    isMaterialsCapabilityEnabled: async (courseOfferingId) => {
      const capabilities = await getEffectiveCapabilities(courseOfferingId);
      return capabilities[TRAINEE_COURSE_MATERIALS_CAPABILITY_KEY] === "ENABLED";
    },
  });

  return enabledOfferingIds.length > 0;
}
