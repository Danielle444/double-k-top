/**
 * URGENT LEVEL 2 ACCESS - SLICE L2-0: server-side IO bindings for ACTOR-AWARE
 * course offering resolution.
 *
 * SERVER-ONLY BY CONSTRUCTION: transitively imports next/headers via the Actor
 * DAL (@/lib/auth/actor), which cannot be bundled into client code. Following
 * the repo convention the `server-only` package is not imported.
 *
 * These are THIN bindings by design: every decision (cardinality, status gating,
 * explicit-id authorization, existence verification) lives in the PURE core
 * (actor-course-offering-core.ts), which is where the DB-free tests exercise the
 * query shapes and the failure contract. This file only supplies the real
 * session reader, the real temporary policy, and the real Prisma queries.
 *
 * The actor is ALWAYS derived server-side from the signed session. The trainee
 * resolver takes NO arguments at all. The instructor resolver takes ONLY an
 * explicit courseOfferingId, which is authorized server-side against the
 * temporary policy - it is a request, never a grant. No client-supplied student
 * or instructor id is trusted or even accepted, and nothing about the login,
 * session or cookie format changes.
 *
 * UN-WIRED IN THIS SLICE: no existing schedule, contact, navigation or UI reader
 * imports this module yet. Migrating those call sites is a later slice.
 */
import { prisma } from "@/lib/prisma";
import { requireCurrentTrainee, requireCurrentInstructor } from "@/lib/auth/actor";
import {
  resolveTraineeCourseOfferingWithDeps,
  resolveInstructorCourseOfferingWithDeps,
  type TraineeEnrollmentQuery,
  type TraineeEnrollmentOfferingRow,
} from "./actor-course-offering-core";
// LEVEL 2 SLICE L2-DUAL - the narrower SCHEDULE/CONTACTS selection core. It is a
// SECOND path alongside the committed single-course resolver below, never a
// replacement for it.
import {
  resolveTraineeSelectedCourseOfferingWithDeps,
  listTraineeCourseOptionsWithDeps,
  type TraineeCourseOptionView,
} from "./trainee-course-selection-core";
import type { CurrentCourseOffering } from "./current-offering-core";
import type { CourseOfferingView } from "./offering-by-id-core";
import {
  isInstructorAllowedCourseOfferingId,
  LEVEL_1_COURSE_OFFERING_ID,
  LEVEL_2_COURSE_OFFERING_ID,
} from "./temporary-level2-compatibility";

export {
  NoTraineeCourseOfferingError,
  AmbiguousTraineeCourseOfferingError,
  MissingInstructorCourseOfferingIdError,
  InstructorCourseOfferingNotAllowedError,
  InstructorCourseOfferingUnavailableError,
  resolveTraineeCourseOfferingWithDeps,
  resolveInstructorCourseOfferingWithDeps,
  type TraineeEnrollmentOfferingRow,
  type TraineeEnrollmentQuery,
  type TraineeCourseOfferingDeps,
  type InstructorCourseOfferingDeps,
} from "./actor-course-offering-core";

export {
  selectTraineeCourseOfferingFromRows,
  buildTraineeCourseOptions,
  resolveTraineeSelectedCourseOfferingWithDeps,
  listTraineeCourseOptionsWithDeps,
  type TraineeCourseOptionView,
  type TraineeCourseSelectionDeps,
} from "./trainee-course-selection-core";

/** The exact offering columns every actor-aware fetch projects. */
const OFFERING_SELECT = {
  id: true,
  activityYearId: true,
  name: true,
  level: true,
  startDate: true,
  endDate: true,
  status: true,
} as const;

/**
 * The TEMPORARY dual-enrollment compatibility pair, supplied as DATA to the pure
 * core (which holds no offering id of its own).
 *
 * This is the ONLY place the two constants meet the trainee resolver. They act
 * purely as an equality predicate over the trainee's own already-fetched
 * eligible rows: the resolver returns the MATCHED ROW, so neither constant is
 * ever a lookup key, a substitute for a missing row, or itself returned. A
 * trainee with no ACTIVE Level 1 enrollment cannot be resolved to Level 1 by it.
 *
 * Deliberately NOT applied to resolveTraineeSelectedCourseOffering below:
 * schedule and contacts express a dual trainee's course by EXPLICIT
 * server-validated selection and must never fall back to Level 1.
 */
const TRAINEE_DUAL_ENROLLMENT_COMPATIBILITY = {
  level1OfferingId: LEVEL_1_COURSE_OFFERING_ID,
  level2OfferingId: LEVEL_2_COURSE_OFFERING_ID,
} as const;

/**
 * Resolve the authenticated trainee's course offering through the signed
 * session and the shared Prisma client. Takes no arguments: the student id comes
 * from the session, never from the caller.
 *
 * This is the resolver every NON-selectable trainee module uses (duties, course
 * materials, messages/tasks, weekly feedback, Teaching Practice, completion). It
 * injects the launch-scoped dual-enrollment compatibility so those Level 1
 * modules keep working for a trainee enrolled in BOTH launch offerings, instead
 * of failing closed into a uniform empty result. Every other ambiguous state
 * still fails closed - see actor-course-offering-core.ts for the exact contract.
 */
export async function resolveTraineeCourseOffering(): Promise<CurrentCourseOffering> {
  return resolveTraineeCourseOfferingWithDeps({
    requireTraineeId: async () => (await requireCurrentTrainee()).id,
    fetchTraineeEnrollmentRows: fetchTraineeEnrollmentRows,
    legacyDualEnrollmentCompatibility: TRAINEE_DUAL_ENROLLMENT_COMPATIBILITY,
  });
}

/**
 * The ONE enrollment fetch shared by every trainee course-context resolver in this
 * module. The query object is built by a pure core and passed through verbatim -
 * this binding adds no filter, no ordering and no id of its own, so the database
 * scope is exactly what the tested core decided.
 */
async function fetchTraineeEnrollmentRows({
  take,
  where,
}: TraineeEnrollmentQuery): Promise<TraineeEnrollmentOfferingRow[]> {
  const rows = await prisma.courseEnrollment.findMany({
    take,
    where,
    select: {
      id: true,
      status: true,
      courseOffering: { select: OFFERING_SELECT },
    },
  });
  return rows.map((r) => ({
    enrollmentId: r.id,
    enrollmentStatus: r.status,
    offering: r.courseOffering,
  }));
}

/**
 * LEVEL 2 SLICE L2-DUAL - resolve the authenticated trainee's course offering for
 * an OPTIONAL requested id. Used by the SCHEDULE and CONTACTS reads only.
 *
 * The student id still comes only from the signed session. `requestedCourseOfferingId`
 * is a REQUEST: it never reaches the query (which is scoped to that trainee's own
 * ACTIVE enrollments into ACTIVE offerings) and is only matched by exact equality
 * against the rows that come back. The id returned is the matched ROW's, never the
 * caller's string. Omitting it preserves the committed single-course behaviour;
 * with more than one eligible offering an omitted id fails closed rather than
 * being guessed.
 */
export async function resolveTraineeSelectedCourseOffering(
  requestedCourseOfferingId?: string | null,
): Promise<CurrentCourseOffering> {
  return resolveTraineeSelectedCourseOfferingWithDeps(requestedCourseOfferingId, {
    requireTraineeId: async () => (await requireCurrentTrainee()).id,
    fetchTraineeEnrollmentRows: fetchTraineeEnrollmentRows,
  });
}

/**
 * LEVEL 2 SLICE L2-DUAL - the courses the authenticated trainee may ask for.
 *
 * A MENU, not an authorization: it grants no module and authorizes no read. Every
 * consuming action re-resolves the chosen id independently through
 * resolveTraineeSelectedCourseOffering above. Takes no arguments at all.
 */
export async function listTraineeCourseOptions(): Promise<TraineeCourseOptionView[]> {
  return listTraineeCourseOptionsWithDeps({
    requireTraineeId: async () => (await requireCurrentTrainee()).id,
    fetchTraineeEnrollmentRows: fetchTraineeEnrollmentRows,
  });
}

/**
 * Authorize and resolve an EXPLICITLY REQUESTED course offering for the
 * authenticated instructor.
 *
 * requireCurrentInstructor() supplies the audience gate - it throws for an
 * anonymous, wrong-audience, invalid-session or INACTIVE instructor, which is
 * how inactive instructors stay denied without any new logic. Its result is
 * discarded on purpose: no instructor identity influences the decision. The
 * requested id is then checked against the temporary allowed-offerings policy
 * and verified to exist.
 *
 * Returning an offering here means ONLY "this course context is addressable by
 * an instructor". It grants no module: a Level 1 global module must not become
 * reachable in a Level 2 context on the strength of this call.
 */
export async function resolveInstructorCourseOffering(
  requestedCourseOfferingId: string,
): Promise<CourseOfferingView> {
  return resolveInstructorCourseOfferingWithDeps(requestedCourseOfferingId, {
    requireActiveInstructor: requireCurrentInstructor,
    isAllowedOfferingId: isInstructorAllowedCourseOfferingId,
    fetchOfferingById: (offeringId) =>
      prisma.courseOffering.findUnique({
        where: { id: offeringId },
        select: OFFERING_SELECT,
      }),
  });
}
