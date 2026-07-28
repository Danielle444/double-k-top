"use server";

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/require-admin";
import type { ActionResult } from "@/lib/actions/students";
import {
  RIDING_PROGRESS_COURSE_SELECT,
  toRidingProgressRow,
  type StudentRidingProgressFeedbackCreateInput,
  type StudentRidingProgressFeedbackInput,
  type StudentRidingProgressFeedbackRow,
} from "@/lib/actions/riding-progress-row-mapper";
import {
  getRidingProgressCourseChoiceForSubject,
  resolveRidingProgressCourseForCreate,
} from "@/lib/course/riding-progress-course-scope";
import {
  ridingProgressCourseRefusalMessage,
  type RidingProgressCourseChoice,
} from "@/lib/course/riding-progress-course-scope-core";

// Admin-only, read/create/update surface for manager-entered riding
// progress feedback - a standalone journal per trainee, NOT per scheduled
// session, and NOT related to ScheduleItem/RidingSlot/RidingLessonNote (see
// StudentRidingProgressFeedback's own schema comment). Never touches
// RidingLessonNote or any Teaching Practice/weekly feedback model. No
// instructor/student variant in this stage - admin-only.

// S4 - the row DTO, the create/update payload types, the course projection and
// the row mapper live in ./riding-progress-row-mapper (a non-"use server"
// module: a "use server" file may only export async functions, so neither the
// select constant nor the synchronous mapper could live here).
//
// These MUST be `export type { ... } from "<module>"` re-exports, NOT bare
// `export type { X }` of a local import binding: inside a "use server" file
// Turbopack's server-action transform treats a bare local type re-export as a
// runtime export and emits registerServerReference for it, crashing the module
// at evaluation. The from-clause form is erased at build time (same hazard and
// same fix as lib/actions/trainee-course-selection.ts).
export type {
  StudentRidingProgressFeedbackRow,
  StudentRidingProgressFeedbackInput,
  StudentRidingProgressFeedbackCreateInput,
} from "@/lib/actions/riding-progress-row-mapper";

const toRow = toRidingProgressRow;

// Same rating range/half-point convention as RidingLessonNote/
// TeachingPracticeFeedback (2-10, i.e. 1.0-5.0 in 0.5 steps) - validated
// here in the action layer, not the schema, same as those two.
function isValidRatingHalfPoints(value: number | null): boolean {
  return value === null || (Number.isInteger(value) && value >= 2 && value <= 10);
}

// A row must carry a real rating or real feedback text - never allowed to
// be saved completely empty, same "meaningful content" guard convention as
// hasMeaningfulTeachingPracticeFeedback, duplicated here (not imported)
// since that helper's name ties it to Teaching Practice specifically and
// this is an unrelated feature that happens to share the same shape.
function hasMeaningfulContent(ratingHalfPoints: number | null, feedback: string | null): boolean {
  return ratingHalfPoints !== null || (feedback?.trim() ?? "") !== "";
}

export async function listStudentRidingProgressFeedbackForAdmin(
  studentId: string
): Promise<StudentRidingProgressFeedbackRow[] | null> {
  await requireAdmin();

  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student) return null;

  const rows = await prisma.studentRidingProgressFeedback.findMany({
    where: { studentId },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    include: RIDING_PROGRESS_COURSE_SELECT,
  });

  return rows.map(toRow);
}

/**
 * S4 - the course options the admin's create form must offer for this trainee.
 * A menu, not an authorization: create re-resolves independently.
 */
export async function getRidingProgressCourseChoiceForAdmin(
  studentId: string
): Promise<RidingProgressCourseChoice | null> {
  await requireAdmin();

  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student) return null;

  return getRidingProgressCourseChoiceForSubject(studentId);
}

export async function createStudentRidingProgressFeedbackAsAdmin(
  studentId: string,
  input: StudentRidingProgressFeedbackCreateInput
): Promise<ActionResult> {
  const admin = await requireAdmin();

  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student) return { success: false, error: "חניך/ה לא נמצא/ה" };

  const date = new Date(input.date);
  if (Number.isNaN(date.getTime())) {
    return { success: false, error: "תאריך לא תקין" };
  }

  const ratingHalfPoints = input.ratingHalfPoints ?? null;
  if (!isValidRatingHalfPoints(ratingHalfPoints)) {
    return { success: false, error: "דירוג לא תקין" };
  }

  const feedback = input.feedback?.trim() || null;
  if (!hasMeaningfulContent(ratingHalfPoints, feedback)) {
    return { success: false, error: "יש להזין דירוג או משוב" };
  }

  const horseName = input.horseName?.trim() || null;
  const topic = input.topic?.trim() || null;
  const adminName = admin.name ?? admin.email;

  // S4 - the course is resolved from the SUBJECT trainee's own ACTIVE
  // enrollments into ACTIVE offerings, never from the admin's selected course
  // context, the entry's date, the trainee's group or an offering id constant.
  // Zero eligible -> blocked; exactly one -> auto-selected; two or more ->
  // refused unless the admin stated which. A stated id must exactly equal one of
  // that trainee's eligible offerings.
  const course = await resolveRidingProgressCourseForCreate(studentId, input.courseOfferingId);
  if (!course.ok) {
    return { success: false, error: ridingProgressCourseRefusalMessage(course.reason) };
  }

  await prisma.studentRidingProgressFeedback.create({
    data: {
      studentId,
      date,
      ratingHalfPoints,
      feedback,
      horseName,
      topic,
      courseOfferingId: course.courseOfferingId,
      createdByName: adminName,
      updatedByName: adminName,
    },
  });

  return { success: true };
}

export async function updateStudentRidingProgressFeedbackAsAdmin(
  id: string,
  input: StudentRidingProgressFeedbackInput
): Promise<ActionResult> {
  const admin = await requireAdmin();

  const existing = await prisma.studentRidingProgressFeedback.findUnique({ where: { id } });
  if (!existing) return { success: false, error: "הרשומה לא נמצאה" };

  const date = new Date(input.date);
  if (Number.isNaN(date.getTime())) {
    return { success: false, error: "תאריך לא תקין" };
  }

  const ratingHalfPoints = input.ratingHalfPoints ?? null;
  if (!isValidRatingHalfPoints(ratingHalfPoints)) {
    return { success: false, error: "דירוג לא תקין" };
  }

  const feedback = input.feedback?.trim() || null;
  if (!hasMeaningfulContent(ratingHalfPoints, feedback)) {
    return { success: false, error: "יש להזין דירוג או משוב" };
  }

  const horseName = input.horseName?.trim() || null;
  const topic = input.topic?.trim() || null;

  // createdByName is intentionally never touched here - it stays whoever
  // originally wrote the entry, even when a different admin later edits it.
  //
  // S4 - courseOfferingId is intentionally ABSENT from this data block. The
  // course is immutable after creation: a scoped row keeps its offering and a
  // legacy NULL row stays NULL, so editing text or a rating can never re-file an
  // entry or silently claim an unattributed one for a course. The input type
  // carries no course field either, so this cannot regress by accident.
  await prisma.studentRidingProgressFeedback.update({
    where: { id },
    data: {
      date,
      ratingHalfPoints,
      feedback,
      horseName,
      topic,
      updatedByName: admin.name ?? admin.email,
    },
  });

  return { success: true };
}

// Hard delete - no soft-delete flag on this model, no cascade concerns
// beyond this one row (StudentRidingProgressFeedback has no child records
// of its own). Never touches Student or any other model.
export async function deleteStudentRidingProgressFeedbackAsAdmin(id: string): Promise<ActionResult> {
  await requireAdmin();

  const existing = await prisma.studentRidingProgressFeedback.findUnique({ where: { id } });
  if (!existing) return { success: false, error: "הרשומה לא נמצאה" };

  await prisma.studentRidingProgressFeedback.delete({ where: { id } });

  return { success: true };
}
