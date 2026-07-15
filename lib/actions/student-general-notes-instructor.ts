"use server";

import { prisma } from "@/lib/prisma";
import type { ActionResult } from "@/lib/actions/students";
import type { StudentGeneralNoteRow } from "@/lib/actions/student-general-notes";
import { requireInstructorWithTraineeProgressAccess } from "@/lib/actions/trainee-progress-instructor-access";

// Instructor/coach surface for StudentGeneralNote - the trainee-progress
// counterpart to lib/actions/student-general-notes.ts's admin-only actions.
// That admin file is completely unmodified by this file and keeps seeing
// every row (admin- and instructor-authored alike).
//
// Unlike the riding/lunge/presentation progress-journal instructor actions
// (each gated to canEditRidingNotes specifically, edit restricted to the
// acting instructor's own rows), general notes are product-specced
// differently: ANY active instructor who can reach the trainee-progress page
// at all (canEditRidingNotes OR canEditTeachingPracticeFeedback) may view
// every note for the trainee, add a new one, and edit ANY existing note -
// there is no per-row ownership restriction here, since a general note is
// shared trainee context every authorized instructor should be able to keep
// current, not a personal journal entry. createdByName/updatedByName are
// still always stamped from the freshly-fetched instructor's own fullName
// (never a client-supplied value) so authorship is always accurate and an
// instructor can never write a note that appears to have been authored by
// an admin.
//
// Delete is deliberately NOT exposed here - stays admin-only for now (see
// this stage's implementation report for the smallest-safe-deletion-rule
// note flagged for a future stage).

// Newest first - same ordering as getStudentGeneralNotesAsAdmin.
export async function listStudentGeneralNotesForInstructor(
  instructorId: string,
  studentId: string
): Promise<StudentGeneralNoteRow[] | null> {
  const instructor = await requireInstructorWithTraineeProgressAccess(instructorId);
  if (!instructor) return null;

  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student) return null;

  const rows = await prisma.studentGeneralNote.findMany({
    where: { studentId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });

  return rows.map((row) => ({
    id: row.id,
    studentId: row.studentId,
    content: row.content,
    createdByName: row.createdByName,
    updatedByName: row.updatedByName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function createStudentGeneralNoteAsInstructor(
  instructorId: string,
  studentId: string,
  content: string
): Promise<ActionResult> {
  const instructor = await requireInstructorWithTraineeProgressAccess(instructorId);
  if (!instructor) return { success: false, error: "אין הרשאה להוסיף הערה כללית" };

  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student) return { success: false, error: "חניך/ה לא נמצא/ה" };

  const trimmed = content.trim();
  if (!trimmed) return { success: false, error: "יש להזין תוכן להערה" };

  await prisma.studentGeneralNote.create({
    data: {
      studentId,
      content: trimmed,
      createdByName: instructor.fullName,
      updatedByName: instructor.fullName,
      createdByInstructorId: instructor.id,
      updatedByInstructorId: instructor.id,
    },
  });

  return { success: true };
}

// No ownership check on `existing` - by product design, any instructor with
// page access may edit any note (see this file's own header comment).
// createdByName/createdByInstructorId/createdAt are intentionally never
// touched here - same "preserve original author" convention as the admin
// action and every sibling progress-feedback action.
export async function updateStudentGeneralNoteAsInstructor(
  instructorId: string,
  noteId: string,
  content: string
): Promise<ActionResult> {
  const instructor = await requireInstructorWithTraineeProgressAccess(instructorId);
  if (!instructor) return { success: false, error: "אין הרשאה לערוך הערה כללית" };

  const existing = await prisma.studentGeneralNote.findUnique({ where: { id: noteId } });
  if (!existing) return { success: false, error: "ההערה לא נמצאה" };

  const trimmed = content.trim();
  if (!trimmed) return { success: false, error: "יש להזין תוכן להערה" };

  await prisma.studentGeneralNote.update({
    where: { id: noteId },
    data: {
      content: trimmed,
      updatedByName: instructor.fullName,
      updatedByInstructorId: instructor.id,
    },
  });

  return { success: true };
}
