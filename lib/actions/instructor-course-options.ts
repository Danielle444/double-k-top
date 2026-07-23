"use server";

/**
 * URGENT LEVEL 2 ACCESS - SLICE C0-A: server binding for the INSTRUCTOR CONTACT
 * course-options menu.
 *
 * This is a THIN binding by design: every decision (allow-list membership,
 * label composition, ordering, omission of a missing offering) lives in the PURE
 * core (@/lib/course/instructor-offering-options-core), which is where the
 * DB-free tests exercise the query shape and the authorization ordering. This
 * file only supplies the real session guard, the real temporary policy, and the
 * real Prisma query.
 *
 * THE MENU IS NOT AUTHORIZATION. Returning an option means only "an instructor
 * may ASK for this course context". It grants no module and no contact row: the
 * selected id is a REQUEST that every later read must independently re-validate
 * server-side via resolveInstructorCourseOffering(...). Nothing here loads a
 * roster, a contact, or a schedule.
 *
 * The actor is ALWAYS derived server-side from the signed session and no
 * client-supplied instructor or offering id is trusted or even accepted (this
 * reader takes no arguments at all). requireCurrentInstructor() is the FIRST
 * awaited operation, so an anonymous, wrong-audience or INACTIVE caller can
 * never probe which offerings exist or read their names.
 *
 * UN-WIRED IN THIS SLICE (C0-A): no component, action or route imports this
 * module yet, no UI changes, and no contacts action is touched. Wiring the
 * selector and repointing getStudentContacts is the separate C0-B slice.
 */
import { prisma } from "@/lib/prisma";
import { requireCurrentInstructor } from "@/lib/auth/actor";
import { listInstructorContactCourseOptionsWithDeps } from "@/lib/course/instructor-offering-options-core";
import { INSTRUCTOR_ALLOWED_COURSE_OFFERING_IDS } from "@/lib/course/temporary-level2-compatibility";

export type { InstructorCourseOptionView } from "@/lib/course/instructor-offering-options-core";

/**
 * List the course offerings an authenticated ACTIVE instructor may address,
 * as server-composed display options.
 *
 * The candidate set is EXACTLY the temporary policy's two verified ids - queried
 * by explicit id-set, never by status, name, level, date window or ActivityYear.
 * An allowed id with no matching row is omitted rather than fabricated, so an
 * empty list is a legitimate fail-closed outcome (nothing is selectable) rather
 * than a reason to fall back to another offering.
 *
 * The temporary policy ids stay SERVER-ONLY: only the resulting narrow view
 * (id + server-composed label + level + status) leaves this module, and it
 * carries no selected/default marker - there is deliberately no default course.
 */
export async function listInstructorContactCourseOptions() {
  return listInstructorContactCourseOptionsWithDeps({
    requireActiveInstructor: requireCurrentInstructor,
    allowedOfferingIds: INSTRUCTOR_ALLOWED_COURSE_OFFERING_IDS,
    fetchOfferingRows: ({ where, select }) =>
      prisma.courseOffering.findMany({ where, select }),
  });
}
