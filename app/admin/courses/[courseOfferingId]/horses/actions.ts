"use server";

/**
 * LEVEL 2 DEFAULT HORSE - the course-scoped write action for a Level-2-ONLY
 * trainee's persistent default horse.
 *
 * This is a SEPARATE, deliberately narrow writer from the global admin horse
 * action (lib/actions/horses.ts). The global action routes through the
 * enrollment-scoped, three-way-parity write service, which resolves the current
 * offering to Level 1 and requires an ACTIVE Level 1 enrollment plus an existing
 * current history interval — so it can neither address nor first-write a
 * Level-2-only trainee. This action instead writes ONLY the Student
 * compatibility horse columns (the authoritative runtime source both riding
 * flows read via getHorseDisplayInfo), which is safe precisely because a
 * Level-2-only trainee shares those columns with no other course context.
 *
 * HARD SERVER-SIDE GUARDS (never trust the client):
 *   1. requireAdminCourseOffering() authorizes the admin AND re-validates the
 *      route offering by exact id (no cookie, no singleton, no fallback).
 *   2. The trainee's editability is re-derived from their ACTIVE-enrollment
 *      offering-id set via the single pure authority isDefaultHorseEditable:
 *      editable IFF actively enrolled in EXACTLY this offering and no other. A
 *      dual-enrolled trainee is rejected here — no Level 2 action may mutate a
 *      dual trainee's Level 1 horse/group/subgroup.
 *   3. The submitted triple is canonicalized by the shared normalizeHorse
 *      (empty/whitespace names collapse to null; contradictory states rejected).
 *
 * It writes NO group/subgroup field, touches NO other course, and performs no
 * TraineeHorseAssignment/CourseEnrollment-cache write (those are unread at
 * runtime for this path; keeping the write Student-only avoids creating a
 * partial 2-of-3 cache state).
 */

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import type { ActionResult } from "@/lib/actions/students";
import {
  requireAdminCourseOffering,
  CourseOfferingNotFoundError,
  type AdminCourseContext,
} from "@/lib/course/admin-course-context";
import { isDefaultHorseEditable } from "@/lib/course/level2-default-horse-core";
import { normalizeHorse } from "@/lib/trainee-history/normalize-horse";

/** The three raw cache fields the modal submits. */
export interface Level2DefaultHorseInput {
  hasPrivateHorse: boolean;
  privateHorseName: string | null;
  assignedHorseName: string | null;
}

/**
 * Set a Level-2-only trainee's persistent default horse for the given offering.
 * courseOfferingId is the route-bound offering (bound by the page via
 * .bind(null, context.id)); studentId + data are the client's submitted values.
 */
export async function updateLevel2OnlyTraineeDefaultHorse(
  courseOfferingId: string,
  studentId: string,
  data: Level2DefaultHorseInput,
): Promise<ActionResult> {
  // 1. Admin authorization first, then exact-id offering re-validation. A typed
  //    not-found collapses to a safe generic error (never reflects the id);
  //    auth redirects and unexpected errors propagate.
  let context: AdminCourseContext;
  try {
    context = await requireAdminCourseOffering(courseOfferingId);
  } catch (err) {
    if (err instanceof CourseOfferingNotFoundError) {
      return { success: false, error: "הקורס לא נמצא" };
    }
    throw err;
  }

  // 2. Re-derive the trainee's ACTIVE-enrollment offering-id set SERVER-SIDE and
  //    enforce the single editability authority. Never trusts a client flag.
  const activeEnrollments = await prisma.courseEnrollment.findMany({
    where: { studentId, status: "ACTIVE" },
    select: { courseOfferingId: true },
  });
  const activeOfferingIds = new Set(activeEnrollments.map((e) => e.courseOfferingId));
  if (!isDefaultHorseEditable(activeOfferingIds, context.id)) {
    // Covers both "not actively enrolled here" and "dual-enrolled elsewhere".
    return {
      success: false,
      error: "לא ניתן לערוך סוס ברירת מחדל עבור חניך/ה זה/זו בקורס זה",
    };
  }

  // Defensive: a globally deactivated Student is never edited here.
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { isActive: true },
  });
  if (!student || !student.isActive) {
    return { success: false, error: "חניך/ה לא נמצא/ה" };
  }

  // 3. Canonicalize the submitted triple (empty/whitespace -> null; contradictory
  //    -> rejected) via the shared normalizer.
  const normalized = normalizeHorse({
    assignedHorseName: data.assignedHorseName,
    hasPrivateHorse: data.hasPrivateHorse,
    privateHorseName: data.privateHorseName,
  });
  if (!normalized.ok) {
    return { success: false, error: "מצב סוס לא תקין" };
  }

  // Student-only write: the authoritative runtime horse source. No group/subgroup
  // field is touched; no other course is affected.
  await prisma.student.update({
    where: { id: studentId },
    data: {
      assignedHorseName: normalized.value.assignedHorseName,
      hasPrivateHorse: normalized.value.hasPrivateHorse,
      privateHorseName: normalized.value.privateHorseName,
    },
  });

  revalidatePath(`/admin/courses/${encodeURIComponent(context.id)}/horses`);
  return { success: true };
}
