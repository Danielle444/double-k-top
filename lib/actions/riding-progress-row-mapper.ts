/**
 * RIDING PROGRESS COURSE SCOPE - S4: the shared row DTO, the Prisma course
 * projection and the row mapper for the riding-progress journal.
 *
 * Server-only helper module, deliberately NOT "use server" - a "use server"
 * module may only export async functions, so the select constant and the
 * synchronous mapper below cannot live in the action files themselves. Same
 * convention as ./trainee-progress-instructor-access.ts: imported by the action
 * modules, never directly callable as a Server Action.
 *
 * WHY SHARED: the admin reader and the instructor reader must return a
 * byte-identical row shape. A projection that differed by audience would be a
 * correctness bug (the same trainee's journal would carry different course
 * identity depending on who opened it), so there is exactly ONE select and ONE
 * mapper and both audiences import them.
 */
import { dateKey } from "@/lib/dates";
import {
  buildRidingProgressCourseProjection,
  type RidingProgressCourseProjection,
} from "@/lib/course/riding-progress-journal-view-core";

export interface StudentRidingProgressFeedbackRow {
  id: string;
  studentId: string;
  date: string;
  ratingHalfPoints: number | null;
  feedback: string | null;
  horseName: string | null;
  topic: string | null;
  createdByName: string | null;
  updatedByName: string | null;
  // Null for admin-created rows, an Instructor id for instructor-created
  // rows - exposed so the shared trainee-progress detail view can show
  // edit/delete controls only on rows the acting instructor themself
  // created (the "view all, edit own" rule). Admin's own UI ignores this
  // field entirely (admin may edit/delete any row, unchanged).
  createdByInstructorId: string | null;
  // S4 - the course this entry belongs to, or null for a legacy row written
  // before the journal had a course dimension. NEVER inferred: null stays null
  // and renders as the neutral unscoped label, never as Level 1.
  courseOffering: RidingProgressCourseProjection | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * The UPDATE payload. Deliberately carries NO courseOfferingId: the course is
 * immutable after creation in this release, so an update physically cannot
 * accept, clear or replace it. A mis-filed entry is deleted and recreated.
 */
export interface StudentRidingProgressFeedbackInput {
  date: string;
  ratingHalfPoints: number | null;
  feedback: string | null;
  horseName: string | null;
  topic: string | null;
}

/**
 * The CREATE payload - the update payload PLUS an optional requested course.
 *
 * Optional because a trainee with exactly one eligible course is resolved
 * server-side; a dual-enrolled trainee must state one or the create is refused.
 * The value is a REQUEST, re-validated server-side against the subject trainee's
 * own eligible offerings - never trusted as given.
 */
export interface StudentRidingProgressFeedbackCreateInput extends StudentRidingProgressFeedbackInput {
  courseOfferingId?: string | null;
}

/** The exact offering columns every riding-progress reader projects. */
export const RIDING_PROGRESS_COURSE_SELECT = {
  courseOffering: { select: { id: true, name: true, level: true } },
} as const;

/** Map one Prisma row (with the course relation projected) to the shared DTO. */
export function toRidingProgressRow(row: {
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
  courseOffering: { id: string; name: string; level: number } | null;
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
    courseOffering: buildRidingProgressCourseProjection(row.courseOffering),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
