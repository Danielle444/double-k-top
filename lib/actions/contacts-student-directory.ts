/**
 * MULTI-COURSE W5B1 / LEVEL 2 CONTACTS SLICE C0-B - PURE, dependency-injected
 * orchestration for the student contact directory.
 *
 * This module is deliberately NOT a "use server" module: it is a plain
 * server-side library, so nothing here is registered as a Server Action. It
 * carries the testable orchestration (auth ordering + explicit course
 * authorization + enrollment-backed roster source + mapping/anomaly/duplicate
 * guards) that the public server action in ./contacts imports and wires to real
 * dependencies.
 *
 * NO runtime side effects at import time, and NO Prisma / next-cookies import:
 * every impure capability (session actor, offering resolver, capability reader,
 * enrollment DAL, clock) is passed in via {@link StudentContactsDeps}. The only
 * runtime imports are PURE modules - the audience-gate predicate and the two
 * typed instructor-course-context errors. StudentContactRow and
 * EnrollmentRosterResult are erased `import type`s (the former's single source of
 * truth is ./contacts), so the type-only edge back to ./contacts creates no
 * runtime circular import.
 *
 * C0-B: COURSE CONTEXT IS EXPLICITLY REQUESTED, NEVER INFERRED
 * ------------------------------------------------------------
 * The caller must state which course it means as a REQUIRED courseOfferingId,
 * which is a REQUEST and never a grant: it is re-validated server-side by the
 * injected resolveInstructorCourseOffering (audience gate -> temporary
 * allowed-offerings policy -> exact-id existence check). Every downstream read
 * then uses the RESOLVED offering's id, never the requested string. There is no
 * singleton resolver, no Level 1 fallback, no optional parameter, no default
 * course, and no inference from a date, level, name, status or cookie.
 */
import { mayAccessStudentContactDirectory } from "@/lib/auth/contact-directory-access";
import {
  MissingInstructorCourseOfferingIdError,
  InstructorCourseOfferingNotAllowedError,
} from "@/lib/course/actor-course-offering-core";
import type { EnrollmentRosterResult } from "@/lib/course/current-enrollments";
import type { CapabilityKey } from "@/lib/course/capabilities/capability-keys";
import type { EffectiveCapabilityStatus } from "@/lib/course/capabilities/effective-capability-core";
import type { StudentContactRow } from "./contacts";

/**
 * Structural, PII-free failure raised when the enrollment-backed roster cannot
 * be served as-is. This never degrades to the legacy global Student roster: a
 * membership anomaly or duplicate id is a real data defect, so it propagates in
 * the same general manner as an underlying Prisma failure (and, like those,
 * carries no phone/name/identityNumber — only anomaly kinds and counts).
 */
export class StudentContactsRosterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudentContactsRosterError";
  }
}

/**
 * PURE mapping from the reviewed W5B0 enrollment roster to the EXACT
 * StudentContactRow[] contract, preserving the W5B0 ordering (rows arrive
 * pre-sorted by compareTraineeView; we never re-sort). Structural defects fail
 * loudly rather than silently returning the legacy roster:
 *  - ANY membership anomaly (no/multiple current membership, malformed subgroup,
 *    missing parent group) -> throw; do NOT drop the row and do NOT fall back.
 *  - a duplicate student id -> throw; never let it pass silently.
 * Only the six contract fields are copied out; enrollmentStatus/isPrimary and
 * every other relation stay behind.
 */
export function toStudentContactRows(roster: EnrollmentRosterResult): StudentContactRow[] {
  if (roster.anomalies.length > 0) {
    const kinds = [...new Set(roster.anomalies.map((a) => a.kind))].sort().join(", ");
    throw new StudentContactsRosterError(
      `enrollment-backed student roster has ${roster.anomalies.length} membership ` +
        `anomaly/anomalies (kinds: ${kinds}); refusing to serve the student contact ` +
        `directory rather than degrade to the legacy global roster.`,
    );
  }
  const seen = new Set<string>();
  const rows: StudentContactRow[] = [];
  for (const trainee of roster.rows) {
    if (seen.has(trainee.id)) {
      throw new StudentContactsRosterError(
        "enrollment-backed student roster contains a duplicate student id; refusing " +
          "to serve the student contact directory rather than emit duplicate rows.",
      );
    }
    seen.add(trainee.id);
    rows.push({
      id: trainee.id,
      fullName: trainee.fullName,
      lastName: trainee.lastName,
      groupName: trainee.groupName,
      subgroupNumber: trainee.subgroupNumber,
      phone: trainee.phone,
    });
  }
  return rows;
}

/**
 * Is this failure "the request did not name a course context this audience may
 * address" (rather than an infrastructure fault or a real data defect)?
 *
 * The two typed cases - a missing/blank offering id and an id outside the
 * temporary instructor policy - are AUTHORIZATION outcomes, so they are
 * translated into the same empty-array denial the audience gate already uses.
 * That keeps the client contract identical to every other denial and never
 * reveals which offerings exist.
 *
 * InstructorCourseOfferingUnavailableError is DELIBERATELY EXCLUDED: an id that
 * passed the allow-list but has no matching row means the configured offering is
 * missing from the database, which is a real defect and must fail loudly rather
 * than be laundered into "this course simply has no trainees". Everything else -
 * a session fault, a Prisma failure, a capability-reader failure - likewise
 * propagates unchanged, exactly as in the sibling instructor directory.
 */
function isInstructorCourseContextDenial(error: unknown): boolean {
  return (
    error instanceof MissingInstructorCourseOfferingIdError ||
    error instanceof InstructorCourseOfferingNotAllowedError
  );
}

/**
 * The resolved, SERVER-VERIFIED course context this orchestration consumes.
 *
 * `startDate` is `Date | null` because that is the committed contract of the
 * offering view (schema: `@db.Date` optional - a PLANNED offering may legitimately
 * be undated, and the view never fabricates a date). It is used ONLY by
 * {@link resolveRosterAsOf}; nothing here infers course identity from it.
 */
export interface ResolvedContactsOffering {
  id: string;
  startDate: Date | null;
}

/**
 * The roster instant for the instructor student directory: `max(now, startDate)`.
 *
 * WHY THIS EXISTS (locked C0-B policy, this surface ONLY). The enrollment writer
 * creates each opening GroupMembership with `effectiveFrom = offering.startDate`.
 * For a FUTURE-dated PLANNED offering that interval has not begun at `now`, so a
 * roster resolved "current at today" would classify every prepared trainee as
 * NO_CURRENT_MEMBERSHIP and the mapping below would refuse to serve the whole
 * directory. Reading a future offering at its own start date lets an instructor
 * PREVIEW the roster prepared for it.
 *
 * Deliberate boundaries:
 *  - an ALREADY-STARTED offering (startDate <= now) uses `now`, so Level 1 is
 *    bit-for-bit unaffected;
 *  - a NULL startDate falls back to `now` - no date is ever fabricated;
 *  - this shifts only the QUESTION ASKED of the roster ("current at when?"). It
 *    does NOT backdate any membership, does not weaken anomaly handling, and does
 *    not suppress a genuine NO_CURRENT_MEMBERSHIP / MULTIPLE_CURRENT_MEMBERSHIPS
 *    / malformed / duplicate defect AT the chosen instant;
 *  - it applies to this directory only - never to trainee actor resolution,
 *    login, schedule, attendance, duties, riding, or any other module.
 */
export function resolveRosterAsOf(offering: ResolvedContactsOffering, now: Date): Date {
  return offering.startDate !== null && offering.startDate.getTime() > now.getTime()
    ? offering.startDate
    : now;
}

/**
 * Injectable dependencies for {@link loadStudentContactsWithDeps}. Only the
 * narrow surface the orchestration needs is described; the concrete wiring
 * (real session actor, real actor-aware instructor offering resolver, real
 * capability reader, real enrollment DAL, real clock) is assembled inside
 * getStudentContacts in ./contacts.
 *
 * `resolveInstructorCourseOffering` takes the REQUESTED id and is expected to
 * authorize it and prove it exists, returning the trusted offering. It supplies
 * `startDate` from that SAME single lookup - no second CourseOffering query is
 * issued anywhere in this path.
 */
export interface StudentContactsDeps {
  getCurrentInstructor: () => Promise<{ id: string } | null>;
  resolveInstructorCourseOffering: (
    requestedCourseOfferingId: string,
  ) => Promise<ResolvedContactsOffering>;
  getEffectiveCapabilities: (
    courseOfferingId: string,
  ) => Promise<Record<CapabilityKey, EffectiveCapabilityStatus>>;
  getCurrentCourseEnrollmentRoster: (
    courseOfferingId: string,
    options: { asOf: Date },
  ) => Promise<EnrollmentRosterResult>;
  now: () => Date;
}

/**
 * Dependency-injected orchestration for the student contact directory, shared by
 * the real getStudentContacts action (in ./contacts) and its focused tests.
 *
 * Order is deliberate and fail-closed at every step:
 *  1. derive the actor server-side and deny with [] for any unauthorized /
 *     trainee / anonymous caller BEFORE any offering, capability or roster read
 *     (unchanged - the audience gate stays FIRST);
 *  2. re-validate the EXPLICITLY REQUESTED offering id server-side; a
 *     missing/blank or disallowed id is an authorization denial -> [];
 *  3. read the CONTACTS capability of the RESOLVED offering; only DISABLED
 *     blocks (READ_ONLY is behaviourally identical to ENABLED on this read-only
 *     surface, preserving the existing student-directory convention);
 *  4. read the enrollment-backed roster of the RESOLVED offering at the locked
 *     max(now, startDate) instant;
 *  5. map it, failing loudly on any structural defect.
 *
 * `resolved.id` - the DB-verified primary key, not the requested string - is what
 * every downstream read receives, so a request can only ever address the exact
 * offering the resolver proved. The roster source is the enrollment-backed DAL,
 * never prisma.student.findMany, and there is no Level 1 fallback. Because this
 * lives OUTSIDE the "use server" module it is not a Server Action and is never
 * exposed to the client action boundary.
 */
export async function loadStudentContactsWithDeps(
  requestedCourseOfferingId: string,
  deps: StudentContactsDeps,
): Promise<StudentContactRow[]> {
  const instructor = await deps.getCurrentInstructor();
  if (!mayAccessStudentContactDirectory(instructor?.id)) {
    return [];
  }

  // Course context is REQUESTED, then independently re-authorized server-side.
  // The requested string is never used past this point.
  let resolved: ResolvedContactsOffering;
  try {
    resolved = await deps.resolveInstructorCourseOffering(requestedCourseOfferingId);
  } catch (error) {
    if (isInstructorCourseContextDenial(error)) {
      return [];
    }
    throw error;
  }

  // Multi-Course Stage 2: enforce the CONTACTS capability of the resolved
  // offering AFTER the actor gate and AFTER trusted offering resolution, and
  // BEFORE any roster read. This is an ADDITIONAL restriction on top of the
  // existing authorization, never a replacement. A failure inside
  // getEffectiveCapabilities propagates (like the resolver/DAL failures) and
  // never falls open to serving the directory.
  const capabilities = await deps.getEffectiveCapabilities(resolved.id);
  if (capabilities.CONTACTS === "DISABLED") {
    return [];
  }

  // ONE captured clock reading drives the roster instant, so the decision cannot
  // straddle two different "now"s. See resolveRosterAsOf for the locked policy.
  const asOf = resolveRosterAsOf(resolved, deps.now());
  const roster = await deps.getCurrentCourseEnrollmentRoster(resolved.id, { asOf });
  return toStudentContactRows(roster);
}
