"use server";

import { prisma } from "@/lib/prisma";
import { dateKey } from "@/lib/dates";
import type { ActionResult } from "@/lib/actions/students";
import type {
  StudentRidingProgressFeedbackInput,
  StudentRidingProgressFeedbackRow,
} from "@/lib/actions/student-riding-progress-feedback";
import { getCurrentInstructor } from "@/lib/auth/actor";
import { canAccessTraineeProgress } from "@/lib/trainee-progress-permissions";

// Instructor/coach read/create/update/delete surface for
// StudentRidingProgressFeedback - the trainee-progress-journal counterpart
// to lib/actions/student-riding-progress-feedback.ts's admin-only actions.
// That admin file is completely unmodified by this file and keeps seeing
// every row (admin- and instructor-created alike) regardless of who wrote
// it. Never touches RidingLessonNote - the existing "הדרכת מתקדמים"
// instructor flow (upsertRidingLessonNoteAsInstructor), which happens to be
// gated by the same canEditRidingNotes flag but is otherwise a completely
// separate model/screen.
//
// Permission (Stage I1 product decision): deliberately reuses
// Instructor.canEditRidingNotes - admin UI label "עריכת הערות רכיבה" - as
// the gate for this journal, rather than a dedicated permission. This is
// intentional and temporary, not an oversight: canEditRidingNotes today
// also gates RidingLessonNote edits, so an instructor granted that flag now
// additionally gets create/edit/delete access to this trainee-progress
// journal (and the לונג׳/פרזנטציה journals in the two sibling instructor
// action files) with no separate admin action required. Revisit with a
// dedicated permission once real usage shows whether that's actually fine.
//
// Ownership: every row created here gets createdByInstructorId set to the
// acting instructor's id (and createdByName to their fullName, same
// denormalized-snapshot convention every model in this app already uses).
// Update is only permitted when row.createdByInstructorId matches the acting
// instructor - an instructor can never touch another instructor's or an
// admin's row (admin-created rows always have createdByInstructorId = null,
// which never equals a real instructor id). There is deliberately NO
// instructor delete action: deletion of a progress-feedback row stays
// manager-only, unchanged by this slice.
//
// AUTH-RPF-1 - SECURITY CONTRACT (why the helper below replaced the old one)
// ------------------------------------------------------------------------
// Every action in this file previously took a CLIENT-SUPPLIED instructorId and
// re-read the instructor row BY THAT ID, evaluating isActive/canEditRidingNotes
// on whatever identity the caller claimed. There was no session read anywhere in
// this file, so an unauthenticated caller could invoke these Server Actions with
// any active instructor's id: borrowing that instructor's permission, writing
// journal rows about any trainee, and stamping the persisted authorship
// (createdByName/createdByInstructorId) with the borrowed instructor's name.
// The ownership check on update was equally hollow - it compared the stored id
// against the CLAIMED id, so a caller who named the row's author could edit it.
//
// Identity now comes ONLY from the signed session via the canonical Actor DAL
// (getCurrentInstructor). There is no instructorId parameter on any action here.
// A missing, invalid, expired, wrong-audience, subject-mismatched or INACTIVE
// instructor session yields a null actor (the DAL returns null in every one of
// those cases) and the call fails closed before any Prisma read or write. The
// studentId/id arguments remain, because they name the SUBJECT of the feedback
// and the row being edited - never the actor.
//
// Deliberately NOT changed by this slice: the sibling לונג׳/פרזנטציה instructor
// journals and the general-notes/Teaching-Practice instructor actions still take
// a client-supplied instructorId and carry the identical weakness. They are
// out of scope here by explicit instruction and remain to be fixed separately.

/**
 * The acting instructor for a riding-progress WRITE, or null.
 *
 * Fail-closed at two independent steps: no trustworthy session actor at all, or
 * an actor lacking canEditRidingNotes. Callers must treat null as "no permission"
 * and must not fall back to any other identity.
 */
async function requireActingInstructorForRidingProgressWrite() {
  const actor = await getCurrentInstructor();
  if (!actor || !actor.canEditRidingNotes) {
    return null;
  }
  return actor;
}

/**
 * The acting instructor for the trainee-progress DETAIL VIEW read, or null.
 *
 * Wider than the write gate on purpose (canEditRidingNotes OR
 * canEditTeachingPracticeFeedback, via the shared pure predicate): viewing the
 * section is part of the full-page-access grant, while create/update stay gated
 * to canEditRidingNotes. Same OR-permission the previous DB-by-client-id helper
 * applied - only the identity source changed.
 */
async function requireActingInstructorForTraineeProgressView() {
  const actor = await getCurrentInstructor();
  if (!actor || !canAccessTraineeProgress(actor)) {
    return null;
  }
  return actor;
}

// Duplicated from lib/actions/student-riding-progress-feedback.ts rather
// than imported - see this stage's implementation report for the
// duplication-vs-extraction decision.
function isValidRatingHalfPoints(value: number | null): boolean {
  return value === null || (Number.isInteger(value) && value >= 2 && value <= 10);
}

function hasMeaningfulContent(ratingHalfPoints: number | null, feedback: string | null): boolean {
  return ratingHalfPoints !== null || (feedback?.trim() ?? "") !== "";
}

function toRow(row: {
  id: string;
  studentId: string;
  date: Date;
  ratingHalfPoints: number | null;
  feedback: string | null;
  horseName: string | null;
  topic: string | null;
  createdByName: string | null;
  updatedByName: string | null;
  createdByInstructorId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): StudentRidingProgressFeedbackRow {
  return {
    id: row.id,
    studentId: row.studentId,
    date: dateKey(row.date),
    ratingHalfPoints: row.ratingHalfPoints,
    feedback: row.feedback,
    horseName: row.horseName,
    topic: row.topic,
    createdByName: row.createdByName,
    updatedByName: row.updatedByName,
    createdByInstructorId: row.createdByInstructorId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Own rows only - never another instructor's or an admin's row. studentId
// is optional: omit it to list every trainee this instructor has ever
// written a row for, or pass it to scope to one trainee (the screen's
// typical use). Returns null when the instructor doesn't exist, is
// inactive, or lacks canEditRidingNotes - never a partial/empty result for
// a permission failure, so a caller can't mistake "not permitted" for
// "permitted but nothing written yet" (which is a real, valid `[]`).
export async function listStudentRidingProgressFeedbackForInstructor(
  studentId?: string
): Promise<StudentRidingProgressFeedbackRow[] | null> {
  const instructor = await requireActingInstructorForRidingProgressWrite();
  if (!instructor) return null;

  const rows = await prisma.studentRidingProgressFeedback.findMany({
    where: { createdByInstructorId: instructor.id, ...(studentId ? { studentId } : {}) },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });

  return rows.map(toRow);
}

// The shared trainee-progress detail view's counterpart to
// listStudentRidingProgressFeedbackForAdmin - EVERY row for the trainee
// (admin- and every instructor-created alike), not just this instructor's
// own, so the instructor sees the exact same "רכיבה" section content the
// manager sees (goal: "same progress information"). Gated by the wider
// trainee-progress-view gate (canEditRidingNotes OR
// canEditTeachingPracticeFeedback) rather than the narrower riding-progress
// write gate above - viewing this section is part of the full-page-access
// grant, not itself gated to the narrower riding-notes permission; only
// create/update stay gated to canEditRidingNotes. The returned
// row's createdByInstructorId lets the caller decide, per row, whether to
// show edit/delete controls for the acting instructor (never trusted to
// enforce anything on its own - update/delete below still re-check
// ownership server-side regardless of what the UI shows).
export async function listStudentRidingProgressFeedbackForInstructorView(
  studentId: string
): Promise<StudentRidingProgressFeedbackRow[] | null> {
  const instructor = await requireActingInstructorForTraineeProgressView();
  if (!instructor) return null;

  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student) return null;

  const rows = await prisma.studentRidingProgressFeedback.findMany({
    where: { studentId },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });

  return rows.map(toRow);
}

export async function createStudentRidingProgressFeedbackAsInstructor(
  studentId: string,
  input: StudentRidingProgressFeedbackInput
): Promise<ActionResult> {
  const instructor = await requireActingInstructorForRidingProgressWrite();
  if (!instructor) return { success: false, error: "אין הרשאה להזין משוב רכיבה" };

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

  await prisma.studentRidingProgressFeedback.create({
    data: {
      studentId,
      date,
      ratingHalfPoints,
      feedback,
      horseName,
      topic,
      createdByName: instructor.fullName,
      updatedByName: instructor.fullName,
      createdByInstructorId: instructor.id,
      updatedByInstructorId: instructor.id,
    },
  });

  return { success: true };
}

export async function updateStudentRidingProgressFeedbackAsInstructor(
  id: string,
  input: StudentRidingProgressFeedbackInput
): Promise<ActionResult> {
  const instructor = await requireActingInstructorForRidingProgressWrite();
  if (!instructor) return { success: false, error: "אין הרשאה לערוך משוב רכיבה" };

  // Ownership is now meaningful: `instructor.id` is the session-derived actor,
  // so this compares the row's stored author against WHO THE CALLER ACTUALLY IS,
  // not against an id they claimed.
  const existing = await prisma.studentRidingProgressFeedback.findUnique({ where: { id } });
  if (!existing) return { success: false, error: "הרשומה לא נמצאה" };
  if (existing.createdByInstructorId !== instructor.id) {
    return { success: false, error: "ניתן לערוך רק משובים שהוזנו על ידך" };
  }

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

  // createdByInstructorId/createdByName are intentionally never touched
  // here - same "preserve original author" convention as the admin action.
  await prisma.studentRidingProgressFeedback.update({
    where: { id },
    data: {
      date,
      ratingHalfPoints,
      feedback,
      horseName,
      topic,
      updatedByName: instructor.fullName,
      updatedByInstructorId: instructor.id,
    },
  });

  return { success: true };
}
