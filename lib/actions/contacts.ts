"use server";

import { prisma } from "@/lib/prisma";
import { getCurrentInstructor, getCurrentTrainee } from "@/lib/auth/actor";
import {
  resolveTraineeCourseOffering,
  resolveInstructorCourseOffering,
} from "@/lib/course/actor-course-offering";
import { getCurrentCourseEnrollmentRoster } from "@/lib/course/current-enrollments";
import { getEffectiveCapabilities } from "@/lib/course/capabilities/offering-capabilities";
import { loadStudentContactsWithDeps } from "./contacts-student-directory";
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
// anonymous caller receives any instructor data. The no-arg signature is
// unchanged (no client-supplied id is trusted or accepted), callers need no
// edits, and the ordering + InstructorContactRow[] output shape are preserved.
//
// LEVEL 2 SLICE C1A course-authorizes the TRAINEE half only: the trainee's own
// offering is resolved server-side through the committed, no-argument
// resolveTraineeCourseOffering() (enrollment-derived, never client-supplied,
// never resolveCurrentCourseOffering, never a Level 1 fallback), and that exact
// offering's CONTACTS capability must be ENABLED before any directory read. The
// INSTRUCTOR half is deliberately unchanged - there is no explicit instructor
// course context in the UI yet and course context is never inferred; see the
// contacts-instructor-directory module note. Which instructors are returned is
// unchanged for both audiences (the temporary launch policy is that every active
// instructor is relevant to both offerings), as are the returned fields.
export async function getInstructorContacts(): Promise<InstructorContactRow[]> {
  return loadInstructorContactsWithDeps({
    getCurrentInstructor,
    getCurrentTrainee,
    resolveTraineeCourseOffering,
    getEffectiveCapabilities,
    listActiveInstructors: () =>
      prisma.instructor.findMany({
        where: { isActive: true },
        orderBy: { fullName: "asc" },
        select: { id: true, fullName: true, phone: true },
      }),
  });
}
