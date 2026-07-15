"use server";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/app/generated/prisma/client";
import { requireAdmin } from "@/lib/auth/require-admin";
import { dateKey } from "@/lib/dates";
import type { ActionResult } from "@/lib/actions/students";
import {
  PRESENTATION_BASE_SCORE,
  PRESENTATION_CATEGORY_KEYS,
  defaultPresentationCategoryScores,
  isValidPresentationCategoryScoreValue,
  sumPresentationCategoryScores,
  type PresentationCategoryKey,
  type PresentationCategoryScores,
} from "@/lib/presentation-rubric";

// Admin-only, read/create/update surface for manager-entered פרזנטציה
// progress feedback - a standalone journal per trainee, same non-per-session
// pattern as lib/actions/student-riding-progress-feedback.ts and
// lib/actions/student-lunge-progress-feedback.ts (NOT per-session, no
// relation to ScheduleItem/RidingSlot/TeachingPracticeLesson). No
// instructor/student variant in this stage - admin-only.
//
// Scoring mirrors the actual uploaded presentation exam form - see
// lib/presentation-rubric.ts for the 10 fixed category keys/labels and the
// -1/-0.5/0/+0.5/+1 per-category scale, and StudentPresentationProgressFeedback's
// own schema comment for why this is a fixed rubric, not the generic
// ratingHalfPoints (1.0-5.0) convention every sibling progress model uses.

export type { PresentationCategoryScores } from "@/lib/presentation-rubric";

export interface StudentPresentationProgressFeedbackRow {
  id: string;
  studentId: string;
  date: string;
  baseScore: number;
  categoryScores: PresentationCategoryScores;
  finalScore: number;
  feedback: string | null;
  topic: string | null;
  presentationType: string | null;
  createdByName: string | null;
  updatedByName: string | null;
  // Same "view all, edit own" purpose as StudentRidingProgressFeedbackRow's
  // own createdByInstructorId field - see that file's own comment.
  createdByInstructorId: string | null;
  createdAt: string;
  updatedAt: string;
}

// Defensive runtime parse of the stored JSONB value for READS - never
// trusts it matches PresentationCategoryScores just because that's the TS
// type; any key that isn't one of the 10 fixed categories is ignored, and
// any category missing or holding an invalid value falls back to 0. Same
// "don't crash on bad historical data" posture as the rest of this app's
// JSON-ish fields - this only runs on data already written by
// sanitizeCategoryScores below, so it should never actually need to correct
// anything, but a read path must never throw on a malformed row (e.g. from
// a manual DB edit).
function parseCategoryScores(value: unknown): PresentationCategoryScores {
  const scores = defaultPresentationCategoryScores();
  if (value === null || typeof value !== "object" || Array.isArray(value)) return scores;
  const record = value as Record<string, unknown>;
  for (const key of PRESENTATION_CATEGORY_KEYS) {
    const candidate = record[key];
    if (isValidPresentationCategoryScoreValue(candidate)) {
      scores[key] = candidate;
    }
  }
  return scores;
}

function toRow(row: {
  id: string;
  studentId: string;
  date: Date;
  baseScore: number;
  categoryScores: unknown;
  finalScore: Prisma.Decimal;
  feedback: string | null;
  topic: string | null;
  presentationType: string | null;
  createdByName: string | null;
  updatedByName: string | null;
  createdByInstructorId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): StudentPresentationProgressFeedbackRow {
  return {
    id: row.id,
    studentId: row.studentId,
    date: dateKey(row.date),
    baseScore: row.baseScore,
    categoryScores: parseCategoryScores(row.categoryScores),
    // Safe to convert to a plain JS number: every legal finalScore is
    // baseScore (an integer) plus a sum of ten values each in
    // {-1,-0.5,0,0.5,1}, so it always lands on a .0/.5 boundary well within
    // double-precision exactness - never a value where float rounding could
    // matter. Converting here (rather than passing Prisma.Decimal to the
    // client) also avoids passing a non-plain class instance across the
    // server action boundary.
    finalScore: row.finalScore.toNumber(),
    feedback: row.feedback,
    topic: row.topic,
    presentationType: row.presentationType,
    createdByName: row.createdByName,
    updatedByName: row.updatedByName,
    createdByInstructorId: row.createdByInstructorId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Validates the client-submitted category scores against the fixed rubric:
// - Any key that isn't one of the 10 known PRESENTATION_CATEGORY_KEYS is
//   rejected outright (returns null) - never silently dropped, since an
//   unknown key means either a client bug or a stale/incompatible caller.
// - A present key's value must be exactly one of the 5 legal values
//   (isValidPresentationCategoryScoreValue) - never an arbitrary
//   number/string.
// - A MISSING known key is normalized to 0 rather than rejected (documented
//   choice - the admin UI always submits all 10 keys with a 0 default, so
//   this only matters for a hypothetical partial caller, and treating
//   "not scored" as 0 is a safe, unsurprising default that matches what the
//   UI already shows before the admin touches anything).
function sanitizeCategoryScores(input: unknown): PresentationCategoryScores | null {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;

  const knownKeys = new Set<string>(PRESENTATION_CATEGORY_KEYS);
  for (const key of Object.keys(record)) {
    if (!knownKeys.has(key)) return null;
  }

  const scores = defaultPresentationCategoryScores();
  for (const key of PRESENTATION_CATEGORY_KEYS) {
    if (key in record) {
      const value = record[key];
      if (!isValidPresentationCategoryScoreValue(value)) return null;
      scores[key as PresentationCategoryKey] = value;
    }
  }
  return scores;
}

// The one, authoritative score formula - PRESENTATION_BASE_SCORE plus the
// sum of all 10 (already-sanitized) category values. Always computed
// server-side; the client's own live preview (TraineeProgressClient.tsx)
// mirrors this formula for display only and is never trusted as input.
// Mathematically always in [60, 80] given a validly sanitized input (10
// categories x [-1, 1]), so no separate min/max range check is needed here.
function computeFinalScore(categoryScores: PresentationCategoryScores): number {
  return PRESENTATION_BASE_SCORE + sumPresentationCategoryScores(categoryScores);
}

// A row must carry at least one real piece of content - never allowed to be
// saved completely untouched. baseScore/finalScore always exist (every row
// has a score by construction) so they don't count on their own; an
// all-zero rubric with no text is treated the same as "nothing entered
// yet," same spirit as every sibling progress model's own meaningful-content
// guard.
function hasMeaningfulContent(input: {
  feedback: string | null;
  topic: string | null;
  presentationType: string | null;
  categoryScores: PresentationCategoryScores;
}): boolean {
  return (
    input.feedback !== null ||
    input.topic !== null ||
    input.presentationType !== null ||
    PRESENTATION_CATEGORY_KEYS.some((key) => input.categoryScores[key] !== 0)
  );
}

export async function listStudentPresentationProgressFeedbackForAdmin(
  studentId: string
): Promise<StudentPresentationProgressFeedbackRow[] | null> {
  await requireAdmin();

  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student) return null;

  const rows = await prisma.studentPresentationProgressFeedback.findMany({
    where: { studentId },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });

  return rows.map(toRow);
}

export interface StudentPresentationProgressFeedbackInput {
  date: string;
  feedback: string | null;
  topic: string | null;
  presentationType: string | null;
  categoryScores: PresentationCategoryScores;
}

export async function createStudentPresentationProgressFeedbackAsAdmin(
  studentId: string,
  input: StudentPresentationProgressFeedbackInput
): Promise<ActionResult> {
  const admin = await requireAdmin();

  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student) return { success: false, error: "חניך/ה לא נמצא/ה" };

  const date = new Date(input.date);
  if (Number.isNaN(date.getTime())) {
    return { success: false, error: "תאריך לא תקין" };
  }

  const categoryScores = sanitizeCategoryScores(input.categoryScores);
  if (categoryScores === null) {
    return { success: false, error: "ניקוד קטגוריה לא תקין - יש לבחור ערך מהרשימה עבור כל קטגוריה" };
  }

  const feedback = input.feedback?.trim() || null;
  const topic = input.topic?.trim() || null;
  const presentationType = input.presentationType?.trim() || null;

  if (!hasMeaningfulContent({ feedback, topic, presentationType, categoryScores })) {
    return { success: false, error: "יש להזין משוב, נושא, סוג פרזנטציה או ניקוד בקטגוריה כלשהי" };
  }

  const adminName = admin.name ?? admin.email;

  await prisma.studentPresentationProgressFeedback.create({
    data: {
      studentId,
      date,
      baseScore: PRESENTATION_BASE_SCORE,
      categoryScores: categoryScores as unknown as Prisma.InputJsonValue,
      finalScore: computeFinalScore(categoryScores),
      feedback,
      topic,
      presentationType,
      createdByName: adminName,
      updatedByName: adminName,
    },
  });

  return { success: true };
}

export async function updateStudentPresentationProgressFeedbackAsAdmin(
  id: string,
  input: StudentPresentationProgressFeedbackInput
): Promise<ActionResult> {
  const admin = await requireAdmin();

  const existing = await prisma.studentPresentationProgressFeedback.findUnique({ where: { id } });
  if (!existing) return { success: false, error: "הרשומה לא נמצאה" };

  const date = new Date(input.date);
  if (Number.isNaN(date.getTime())) {
    return { success: false, error: "תאריך לא תקין" };
  }

  const categoryScores = sanitizeCategoryScores(input.categoryScores);
  if (categoryScores === null) {
    return { success: false, error: "ניקוד קטגוריה לא תקין - יש לבחור ערך מהרשימה עבור כל קטגוריה" };
  }

  const feedback = input.feedback?.trim() || null;
  const topic = input.topic?.trim() || null;
  const presentationType = input.presentationType?.trim() || null;

  if (!hasMeaningfulContent({ feedback, topic, presentationType, categoryScores })) {
    return { success: false, error: "יש להזין משוב, נושא, סוג פרזנטציה או ניקוד בקטגוריה כלשהי" };
  }

  // createdByName is intentionally never touched here - it stays whoever
  // originally wrote the entry, even when a different admin later edits it.
  // baseScore/finalScore are always recomputed the same way create does -
  // baseScore is never client-controlled (always the current
  // PRESENTATION_BASE_SCORE constant), finalScore is always freshly derived
  // from this update's own categoryScores, never carried over from the
  // previous row.
  await prisma.studentPresentationProgressFeedback.update({
    where: { id },
    data: {
      date,
      baseScore: PRESENTATION_BASE_SCORE,
      categoryScores: categoryScores as unknown as Prisma.InputJsonValue,
      finalScore: computeFinalScore(categoryScores),
      feedback,
      topic,
      presentationType,
      updatedByName: admin.name ?? admin.email,
    },
  });

  return { success: true };
}

// Hard delete - no soft-delete flag on this model, no cascade concerns
// beyond this one row (StudentPresentationProgressFeedback has no child
// records of its own). Never touches Student or any other model.
export async function deleteStudentPresentationProgressFeedbackAsAdmin(id: string): Promise<ActionResult> {
  await requireAdmin();

  const existing = await prisma.studentPresentationProgressFeedback.findUnique({ where: { id } });
  if (!existing) return { success: false, error: "הרשומה לא נמצאה" };

  await prisma.studentPresentationProgressFeedback.delete({ where: { id } });

  return { success: true };
}
