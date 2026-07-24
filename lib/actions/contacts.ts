"use server";

import { prisma } from "@/lib/prisma";
import { getCurrentInstructor, getCurrentTrainee } from "@/lib/auth/actor";
import {
  resolveTraineeSelectedCourseOffering,
  resolveInstructorCourseOffering,
} from "@/lib/course/actor-course-offering";
import { getCurrentCourseEnrollmentRoster } from "@/lib/course/current-enrollments";
import { getEffectiveCapabilities } from "@/lib/course/capabilities/offering-capabilities";
import {
  loadStudentContactsWithDeps,
  loadTraineeStudentContactsWithDeps,
} from "./contacts-student-directory";
import { loadInstructorContactsWithDeps } from "./contacts-instructor-directory";

// StudentContactRow is declared directly in this module (as it was before W5B1)
// and is the single source of truth for the public contract. It is a type-only
// export, erased at compile time, so the file-level "use server" server-actions
// loader never emits a runtime reference to it. The pure orchestration module
// consumes it via a type-only `import type`, so there is no runtime cycle.
export interface StudentContactRow {
  id: string;
  fullName: string;
  lastName: string;
  groupName: string | null;
  subgroupNumber: number | null;
  phone: string | null;
}

// Audience-gated (Stage 0A3) + enrollment-backed (Multi-Course W5B1) +
// course-scoped (LEVEL 2 SLICE C0-B): the STUDENT contact directory carries
// trainee PII (names + phone numbers), so it is served ONLY to an authenticated
// instructor derived server-side from the signed session via
// getCurrentInstructor(). A missing/invalid/wrong-audience/inactive session
// yields a null actor (see actor-core deriveInstructorActor), and a trainee
// cookie can never satisfy this gate, so no anonymous or trainee caller receives
// any student data.
//
// C0-B makes the course context EXPLICIT and REQUIRED. `courseOfferingId` is a
// REQUEST, never a grant: it is re-validated server-side by
// resolveInstructorCourseOffering, which applies the audience gate again, checks
// the id against the temporary allowed-offerings policy, and proves the offering
// exists as exactly that id. Only the RESOLVED offering's id then reaches the
// capability read and the roster read, so a request can never address an
// offering the server did not verify. There is deliberately NO optional
// parameter, NO default course, NO resolveCurrentCourseOffering, and NO Level 1
// fallback: an unstated or disallowed course yields [] rather than a guess.
//
// The roster is the enrollment-backed DAL (never prisma.student.findMany), read
// at the locked max(now, offering.startDate) instant so a future-dated PLANNED
// offering can be PREVIEWED (see resolveRosterAsOf), and mapped to the same
// StudentContactRow[] contract in the same reviewed W5B0 ordering. Structural
// failures (a configured-but-missing offering, membership anomalies, malformed
// subgroup, duplicate id, capability-reader or DAL failure) fail loudly.
export async function getStudentContacts(
  courseOfferingId: string,
): Promise<StudentContactRow[]> {
  return loadStudentContactsWithDeps(courseOfferingId, {
    getCurrentInstructor,
    resolveInstructorCourseOffering,
    getEffectiveCapabilities,
    getCurrentCourseEnrollmentRoster,
    now: () => new Date(),
  });
}

// LEVEL 2 CONTACTS SLICE C1B: the narrow, trainee-visible fellow-trainee contact
// row. Deliberately just full name + phone (id is a stable React key, not PII).
// It is a SEPARATE, smaller contract than the instructor-facing StudentContactRow
// (which also carries lastName/groupName/subgroupNumber for its grouped view), so
// no group/subgroup/lastName or any other field is ever emitted to a trainee.
export interface TraineeContactRow {
  id: string;
  fullName: string;
  phone: string | null;
}

// LEVEL 2 CONTACTS SLICE C1B — REGRESSION RESTORE of the trainee "חניכים" tab.
//
// Historically (pre-7816ff9) the trainee client mounted the same student
// directory as instructors, backed by a global, UNGATED Student roster query.
// Adding the instructor-only audience gate silently emptied the trainee tab, and
// d9dd3bb then hard-coded that empty state in the UI. This restores a trainee
// view of fellow trainees WITHOUT reviving the legacy global behaviour: it is
// bound to exactly ONE server-resolved CourseOffering.
//
// `requestedCourseOfferingId` is a REQUEST, never an authority (the SAME L2-DUAL
// contract as getInstructorContacts): it is not identity, never a lookup key, and
// never reaches a query. resolveTraineeSelectedCourseOffering derives the trainee
// from the signed session, loads only THAT trainee's ACTIVE enrollments into
// ACTIVE offerings, and keeps the request only if it exactly equals one of them;
// the RESOLVED row's id, never the caller's string, is what the CONTACTS
// capability check and the enrollment roster receive. A dual trainee who has not
// chosen a course is AMBIGUOUS and fails closed to [] (never a Level 1 fallback);
// a single-course trainee needs no request. CONTACTS must be positively ENABLED.
// The roster read and the resolver are both scoped to the resolved id, so a
// trainee can never reach another course's roster. Rows carry only
// { id, fullName, phone } — see loadTraineeStudentContactsWithDeps for the
// step-by-step fail-closed contract and the field-narrowing.
export async function getTraineeStudentContacts(
  requestedCourseOfferingId?: string | null,
): Promise<TraineeContactRow[]> {
  return loadTraineeStudentContactsWithDeps({
    getCurrentTrainee,
    resolveTraineeCourseOffering: async () => {
      const offering = await resolveTraineeSelectedCourseOffering(requestedCourseOfferingId);
      return { id: offering.id, startDate: offering.startDate };
    },
    getEffectiveCapabilities,
    getCurrentCourseEnrollmentRoster,
    now: () => new Date(),
  });
}

export interface InstructorContactRow {
  id: string;
  fullName: string;
  phone: string | null;
}

// Audience-gated (Stage 0A3): the INSTRUCTOR contact directory is shown to
// BOTH audiences - trainees (StudentInstructorContactsSection) and instructors
// (InstructorRidingSlotsSection roster picker) - so it is served to either an
// authenticated instructor OR an authenticated trainee, both derived
// server-side from the signed session. The instructor lookup is tried first and
// the trainee lookup is skipped when an instructor is already present. Only when
// no trustworthy actor of either audience exists (anonymous, invalid,
// wrong-audience, or inactive → null upstream) is access denied, so no
// anonymous caller receives any instructor data. No client-supplied ACTOR id is
// trusted or accepted, and the ordering + InstructorContactRow[] output shape are
// preserved.
//
// LEVEL 2 SLICE C1A course-authorizes the TRAINEE half only, and LEVEL 2 SLICE
// L2-DUAL lets that half say WHICH of the trainee's own courses it means.
// `requestedCourseOfferingId` is a REQUEST, never an authority: it is not
// identity, never a lookup key, and never reaches a query.
// resolveTraineeSelectedCourseOffering derives the trainee from the session,
// loads only THAT trainee's ACTIVE enrollments into ACTIVE offerings, and keeps
// the request only if it exactly equals one of them; the RESOLVED row's id, never
// the caller's string, is what the CONTACTS capability check receives. That
// capability must still be positively ENABLED before any directory read. Omitting
// the parameter preserves the previous single-course behaviour. Still never
// resolveCurrentCourseOffering and never a Level 1 fallback, and an unknown,
// malformed, outside-roster, inactive-enrollment, PLANNED or inactive requested id
// yields the same [] as every other denial.
//
// The INSTRUCTOR half is deliberately unchanged and cannot even reach the new
// parameter: loadInstructorContactsWithDeps short-circuits to the directory read
// as soon as an instructor actor is present, so the trainee resolver dependency is
// never invoked for that audience (there is still no explicit instructor course
// context in the UI, and course context is never inferred - see the
// contacts-instructor-directory module note). The instructor caller
// (InstructorRidingSlotsSection) passes no argument and is untouched. Which
// instructors are returned is unchanged for both audiences (the temporary launch
// policy is that every active instructor is relevant to both offerings), as are
// the returned fields.
export async function getInstructorContacts(
  requestedCourseOfferingId?: string | null,
): Promise<InstructorContactRow[]> {
  return loadInstructorContactsWithDeps({
    getCurrentInstructor,
    getCurrentTrainee,
    resolveTraineeCourseOffering: () =>
      resolveTraineeSelectedCourseOffering(requestedCourseOfferingId),
    getEffectiveCapabilities,
    listActiveInstructors: () =>
      prisma.instructor.findMany({
        where: { isActive: true },
        orderBy: { fullName: "asc" },
        select: { id: true, fullName: true, phone: true },
      }),
  });
}
