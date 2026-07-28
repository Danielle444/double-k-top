/**
 * RIDING PROGRESS COURSE SCOPE - S4: the server-side IO binding that feeds the
 * committed S1 decision core.
 *
 * SERVER-ONLY: imports the shared Prisma client. Deliberately NOT a "use server"
 * module - nothing here may become a directly callable Server Action; the public
 * actions in lib/actions/student-riding-progress-feedback*.ts import it.
 *
 * THIN BY DESIGN: every decision (eligibility, cardinality, exact-id
 * authorization, refusal wording) lives in the PURE, unit-tested
 * ./riding-progress-course-scope-core. This file only supplies the real query.
 * It re-implements no rule and hardcodes no offering id.
 *
 * THE SUBJECT IS THE TRAINEE, NEVER THE ACTOR
 * -------------------------------------------
 * The enrollment fetch is scoped by the SUBJECT trainee's studentId - the
 * trainee the feedback is about. The acting admin/instructor's own identity
 * never enters this query and can never widen the eligible set. That is what
 * keeps course integrity independent of the actor-identity layer.
 *
 * A client-requested courseOfferingId NEVER reaches the query: it is applied
 * afterwards by the pure core as an exact-equality predicate over rows that were
 * already scoped to this trainee, so it can only ever SELECT FROM an
 * already-eligible set - never widen it, and never act as a lookup key.
 */
import { prisma } from "@/lib/prisma";
import type { TraineeEnrollmentOfferingRow } from "./actor-course-offering-core";
import {
  buildRidingProgressCourseChoice,
  resolveRidingProgressCourseOfferingIdForCreate,
  type RidingProgressCourseChoice,
  type RidingProgressCourseResolution,
} from "./riding-progress-course-scope-core";

/**
 * How many enrollment rows the fetch reads. The full eligible set is the
 * authorization domain, so truncating could only ever DENY a course the trainee
 * genuinely holds - never grant one. 25 keeps that unreachable in practice.
 * Same bound as the committed trainee course-selection read.
 */
const RIDING_PROGRESS_ENROLLMENT_TAKE = 25;

/**
 * The SUBJECT trainee's ACTIVE enrollments into ACTIVE offerings.
 *
 * The status filters are applied here AND re-checked inside the pure core, so a
 * future edit to this query cannot silently widen who is eligible. There is
 * deliberately no date filter: a manager backdating an entry to last week must
 * still be able to file it, and filtering by the entry's date would be exactly
 * the date-derived course inference this feature exists to eliminate.
 */
async function fetchSubjectEligibleEnrollmentRows(
  studentId: string,
): Promise<TraineeEnrollmentOfferingRow[]> {
  const rows = await prisma.courseEnrollment.findMany({
    take: RIDING_PROGRESS_ENROLLMENT_TAKE,
    where: {
      studentId,
      status: "ACTIVE",
      courseOffering: { status: "ACTIVE" },
    },
    select: {
      id: true,
      status: true,
      courseOffering: {
        select: {
          id: true,
          activityYearId: true,
          name: true,
          level: true,
          startDate: true,
          endDate: true,
          status: true,
        },
      },
    },
  });
  return rows.map((row) => ({
    enrollmentId: row.id,
    enrollmentStatus: row.status,
    offering: row.courseOffering,
  }));
}

/**
 * What the write surface must do for this SUBJECT trainee: block ("none"),
 * auto-select ("auto"), or require an explicit choice ("choose").
 *
 * A MENU, NOT AN AUTHORIZATION. Returning options here grants nothing: the
 * create action independently re-resolves whatever the client sends through
 * {@link resolveRidingProgressCourseForCreate} below, against a freshly read
 * eligible set.
 */
export async function getRidingProgressCourseChoiceForSubject(
  studentId: string,
): Promise<RidingProgressCourseChoice> {
  return buildRidingProgressCourseChoice(await fetchSubjectEligibleEnrollmentRows(studentId));
}

/**
 * Resolve (and authorize) the course a NEW riding-progress row will be filed
 * under.
 *
 * Called by every create path. The returned id is the SERVER'S matched copy,
 * never the caller's string. There is deliberately no update counterpart: the
 * course is immutable after creation in this release.
 */
export async function resolveRidingProgressCourseForCreate(
  studentId: string,
  requestedCourseOfferingId: string | null | undefined,
): Promise<RidingProgressCourseResolution> {
  return resolveRidingProgressCourseOfferingIdForCreate(
    requestedCourseOfferingId,
    await fetchSubjectEligibleEnrollmentRows(studentId),
  );
}
