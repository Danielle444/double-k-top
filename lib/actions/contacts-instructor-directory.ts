/**
 * LEVEL 2 CONTACTS SLICE C1A - PURE, dependency-injected orchestration for the
 * instructor contact directory.
 *
 * Like its sibling ./contacts-student-directory, this is deliberately NOT a
 * "use server" module: it is a plain server-side library, so nothing here is
 * registered as a Server Action. It carries the testable orchestration (audience
 * gate -> trainee course context -> CONTACTS capability -> directory read) that
 * the public server action in ./contacts imports and wires to real dependencies.
 *
 * NO runtime side effects at import time, and NO Prisma / next-cookies / actor
 * DAL import: every impure capability (session actors, trainee offering
 * resolver, capability reader, instructor list) is passed in via
 * {@link InstructorContactsDeps}. The only runtime imports are PURE modules -
 * the audience-gate predicate and the two typed trainee-course-context errors.
 * InstructorContactRow is an erased `import type` whose single source of truth
 * stays ./contacts, so that type-only edge creates no runtime circular import.
 *
 * WHY THE TWO AUDIENCES DIVERGE HERE
 * ----------------------------------
 * This directory is read by BOTH audiences (see ./contacts):
 *
 *  - TRAINEE: course context is DERIVED server-side from enrollment via the
 *    committed resolveTraineeCourseOffering() (no arguments - the student id
 *    comes from the signed session), and the CONTACTS capability of THAT EXACT
 *    offering must be ENABLED. No client value participates.
 *
 *  - INSTRUCTOR: UNCHANGED, and deliberately NOT course-scoped in this slice.
 *    There is no explicit instructor course context anywhere in the UI yet (no
 *    route param, no page state, no selector, no bound action context), and
 *    course context is never inferred. Adding a selector is a separate,
 *    approved-on-its-own UI slice; inventing one here - or silently reusing the
 *    trainee/current-offering resolver for instructors - is exactly the Level 1
 *    fallback this launch forbids. Until that slice lands, the instructor branch
 *    keeps its pre-existing behavior (authenticated ACTIVE instructor -> the
 *    active-instructor directory) so the riding-slots roster picker and the
 *    instructor contacts tab are untouched.
 *
 * FAIL-CLOSED CONTRACT: no offering is ever guessed, no Level 1 fallback exists,
 * and nothing here reads Student.groupName, subgroupNumber, dates, an offering's
 * level/name, a cookie, or a client-supplied offering id.
 */
import { mayAccessInstructorContactDirectory } from "@/lib/auth/contact-directory-access";
import {
  NoTraineeCourseOfferingError,
  AmbiguousTraineeCourseOfferingError,
} from "@/lib/course/actor-course-offering-core";
import type { CapabilityKey } from "@/lib/course/capabilities/capability-keys";
import type { EffectiveCapabilityStatus } from "@/lib/course/capabilities/effective-capability-core";
import type { InstructorContactRow } from "./contacts";

/**
 * Is this failure "the authenticated trainee has no single resolvable course
 * context" (rather than an infrastructure fault)?
 *
 * The two typed cases - zero eligible enrollments (which includes a
 * PLANNED-only / inactive-enrollment trainee) and more than one eligible
 * enrollment - are AUTHORIZATION outcomes: the trainee cannot state which course
 * they are in, so they get no directory. They are translated into the same
 * empty-array denial the audience gate already uses, which is the safest
 * existing contacts convention and keeps the client contract identical to every
 * other denial.
 *
 * Everything else - a Prisma failure, a capability-reader failure, an
 * incomplete/undated offering, a session fault - is NOT a denial and propagates
 * unchanged, exactly as in the student directory. Failing loudly on a real
 * defect is deliberate: it must never be laundered into "this trainee simply has
 * no contacts".
 */
function isTraineeCourseContextDenial(error: unknown): boolean {
  return (
    error instanceof NoTraineeCourseOfferingError ||
    error instanceof AmbiguousTraineeCourseOfferingError
  );
}

/**
 * Injectable dependencies for {@link loadInstructorContactsWithDeps}. Only the
 * narrow surface the orchestration needs is described; the concrete wiring (real
 * session actors, real committed trainee resolver, real capability reader, real
 * Prisma directory query) is assembled inside getInstructorContacts in
 * ./contacts.
 *
 * `resolveTraineeCourseOffering` takes NO arguments by design - there is no
 * parameter through which a caller could supply an offering id.
 */
export interface InstructorContactsDeps {
  getCurrentInstructor: () => Promise<{ id: string } | null>;
  getCurrentTrainee: () => Promise<{ id: string } | null>;
  resolveTraineeCourseOffering: () => Promise<{ id: string }>;
  getEffectiveCapabilities: (
    courseOfferingId: string,
  ) => Promise<Record<CapabilityKey, EffectiveCapabilityStatus>>;
  listActiveInstructors: () => Promise<InstructorContactRow[]>;
}

/**
 * Dependency-injected orchestration for the instructor contact directory, shared
 * by the real getInstructorContacts action (in ./contacts) and its focused
 * tests.
 *
 * Order is deliberate and fail-closed at every step:
 *  1. derive both audiences server-side (instructor first; the trainee lookup is
 *     skipped when an instructor is already present - unchanged);
 *  2. deny with [] unless a trustworthy actor of a permitted audience exists;
 *  3. INSTRUCTOR audience -> unchanged directory read (see the module note on
 *     why this is not course-scoped yet);
 *  4. TRAINEE audience -> resolve THEIR offering from enrollment, read that
 *     exact offering's effective capabilities, and require CONTACTS to be
 *     ENABLED before any directory read.
 *
 * The capability test is `!== "ENABLED"`, not `=== "DISABLED"`: for this launch
 * the trainee-facing directory is served only on a positively ENABLED CONTACTS
 * capability, so a missing row (which resolves to the effective DISABLED default
 * under CAP-1), a retired catalog entry, a malformed status, and READ_ONLY all
 * deny. That is intentionally stricter than the student directory's read-only
 * tolerance.
 */
export async function loadInstructorContactsWithDeps(
  deps: InstructorContactsDeps,
): Promise<InstructorContactRow[]> {
  const instructor = await deps.getCurrentInstructor();
  const trainee = instructor === null ? await deps.getCurrentTrainee() : null;
  if (!mayAccessInstructorContactDirectory(instructor?.id, trainee?.id)) {
    return [];
  }

  // INSTRUCTOR audience: pre-existing behavior, preserved byte-for-byte. No
  // offering is resolved and no capability is consulted, because no explicit
  // instructor course context exists to consult one for.
  if (instructor !== null) {
    return deps.listActiveInstructors();
  }

  // TRAINEE audience: course context is server-derived, never client-supplied.
  let courseOfferingId: string;
  try {
    courseOfferingId = (await deps.resolveTraineeCourseOffering()).id;
  } catch (error) {
    if (isTraineeCourseContextDenial(error)) {
      return [];
    }
    throw error;
  }

  // Capability of THAT EXACT offering. A reader failure propagates and never
  // falls open to the directory.
  const capabilities = await deps.getEffectiveCapabilities(courseOfferingId);
  if (capabilities.CONTACTS !== "ENABLED") {
    return [];
  }

  return deps.listActiveInstructors();
}
