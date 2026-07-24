/**
 * URGENT LEVEL 2 ACCESS - SLICE L2-0: PURE decision core for ACTOR-AWARE course
 * offering resolution (trainee and instructor).
 *
 * PURE by construction: no Prisma, no DB, no clock, no randomness, no env, no
 * auth/session/cookie read. It receives an already-authenticated actor id plus
 * already-fetched rows and either returns the stable CurrentCourseOffering view
 * or throws a typed error. The whole contract is unit-testable without a
 * database (see actor-course-offering-core.test.ts).
 *
 * The two audiences have DIFFERENT course-context models, on purpose:
 *  - TRAINEE: context is DERIVED from enrollment data. Exactly one ACTIVE
 *    CourseEnrollment into an ACTIVE CourseOffering, or it fails closed - with
 *    the ONE temporary, injected exception described below.
 *  - INSTRUCTOR: context is REQUESTED, not derived. The caller must state an
 *    explicit courseOfferingId, and the server checks it against a temporary
 *    explicit allowed-offerings policy. There is no instructor-id allow-list and
 *    no per-instructor offering assignment.
 *
 * Both resolvers FAIL CLOSED. Neither ever falls back to another offering, and
 * neither infers course context from a trainee's group/subgroup, a name, an
 * identity number, a date window, a course level, an offering name, schedule
 * contents, a status ordering, the "current" offering, or a cookie.
 *
 * TEMPORARY DUAL-ENROLLMENT COMPATIBILITY EXCEPTION (launch-scoped)
 * ----------------------------------------------------------------
 * Once Level 2 is ACTIVE a combined trainee holds TWO eligible enrollments, and
 * the "exactly one" invariant above would close every trainee module that is not
 * course-selectable (duties, course materials, messages/tasks, weekly feedback,
 * Teaching Practice, completion) - an unacceptable Level 1 regression.
 *
 * So resolveTraineeCourseOfferingFromRows accepts an OPTIONAL, INJECTED
 * LegacyOfferingCompatibility. When (and only when) it is supplied, the eligible
 * offering rows are passed through the already-tested pure filter
 * selectLegacyCompatibleActiveRows, whose entire contract is: the EXACT distinct
 * two-id set {Level 1, Level 2} narrows to the Level 1 ROW; every other shape (0
 * rows, 1 row, 3+ rows, an unknown pair, a known id beside an unknown third, a
 * duplicate) passes through UNCHANGED and therefore still fails closed.
 *
 * Hard properties of this exception:
 *  - It is OPT-IN. Omit the parameter and behavior is byte-identical to the
 *    pre-exception resolver, so this core still fails closed by default.
 *  - This file holds NO hardcoded offering id. The pair is supplied by the IO
 *    binding (actor-course-offering.ts), which is the only place the constants
 *    live, so the core stays testable with arbitrary fake pairs.
 *  - The id handed onward is the MATCHED ROW's - a row that came from THIS
 *    trainee's own ACTIVE enrollments into ACTIVE offerings. The configured
 *    Level 1 constant is used ONLY as an equality predicate against those rows;
 *    it is never a lookup key, never a substitute for a missing row, and never
 *    itself returned. A trainee not enrolled in Level 1 cannot reach Level 1.
 *  - It adds NO new inference: no level comparison, no date window, no offering
 *    name, no activity year, no status ordering, no first-row pick, no
 *    isPrimary, no cookie, no client-selected value. Only exact id-set equality.
 *  - The SELECTION path (selectTraineeCourseOfferingFromRows, used by schedule
 *    and contacts) is a separate function and does NOT call into this one, so it
 *    neither inherits nor is widened by this exception.
 * Removal criteria live in temporary-level2-compatibility.ts.
 *
 * NOTHING here is wired into an existing reader in this slice: schedule and
 * contact call sites still use the legacy resolver.
 */
import {
  resolveCurrentCourseOfferingFromRows,
  type CourseOfferingRow,
  type CurrentCourseOffering,
} from "./current-offering-core";
import {
  mapOfferingByIdRowToView,
  type CourseOfferingByIdRow,
  type CourseOfferingView,
} from "./offering-by-id-core";
// The TEMPORARY dual-enrollment exception delegates its entire decision to this
// already-committed, already-tested pure filter. Importing the FILTER (which
// takes the pair as data) rather than the CONSTANTS is what keeps this core free
// of hardcoded offering ids.
import {
  selectLegacyCompatibleActiveRows,
  type LegacyOfferingCompatibility,
} from "./legacy-offering-compatibility-core";
import type { CourseEnrollmentStatus } from "@/app/generated/prisma/client";

// ---------------------------------------------------------------------------
// Trainee
// ---------------------------------------------------------------------------

/**
 * One fetched CourseEnrollment row for the authenticated trainee, carrying its
 * own status AND the full status-bearing offering row.
 *
 * `enrollmentStatus` and `offering.status` are BOTH re-checked by the core even
 * though the query is expected to filter on them: the fetch filter and the
 * decision are independent defenses, so a future query edit cannot silently
 * widen who resolves to a course.
 *
 * isPrimary is deliberately ABSENT from this row type. "Exactly one primary
 * enrollment per student" is an action-layer invariant, NOT a database
 * constraint (see the CourseEnrollment model comment), so isPrimary must not be
 * used to break a tie at launch - two eligible enrollments fail closed instead.
 */
export interface TraineeEnrollmentOfferingRow {
  readonly enrollmentId: string;
  readonly enrollmentStatus: CourseEnrollmentStatus;
  readonly offering: CourseOfferingRow;
}

/**
 * The authenticated trainee has NO enrollment that grants a course context:
 * zero ACTIVE enrollments, or none of them into an ACTIVE offering (e.g. only a
 * PLANNED offering, or only INACTIVE enrollments).
 */
export class NoTraineeCourseOfferingError extends Error {
  readonly studentId: string;
  constructor(studentId: string) {
    super(
      `Trainee ${studentId} has no ACTIVE CourseEnrollment into an ACTIVE ` +
        `CourseOffering; course context cannot be resolved and is never guessed.`,
    );
    this.name = "NoTraineeCourseOfferingError";
    this.studentId = studentId;
  }
}

/**
 * The authenticated trainee has MORE THAN ONE eligible enrollment. The launch
 * invariant is "exactly one", so this fails closed rather than choosing.
 * Carries only safe public cuids for diagnostics (never PII).
 */
export class AmbiguousTraineeCourseOfferingError extends Error {
  readonly studentId: string;
  readonly offeringIds: string[];
  constructor(studentId: string, offeringIds: string[]) {
    super(
      `Trainee ${studentId} has ${offeringIds.length} ACTIVE enrollments into ` +
        `ACTIVE offerings (ids: ${offeringIds.join(", ")}). The trainee course ` +
        `resolver refuses to choose one; isPrimary is not a database-enforced ` +
        `tie-breaker and is deliberately ignored.`,
    );
    this.name = "AmbiguousTraineeCourseOfferingError";
    this.studentId = studentId;
    this.offeringIds = offeringIds;
  }
}

/**
 * Decide the authenticated trainee's course offering from their fetched
 * enrollment rows.
 *
 *  - keeps ONLY rows whose enrollment is ACTIVE and whose offering is ACTIVE;
 *  - 0 eligible  -> NoTraineeCourseOfferingError (fail closed);
 *  - >1 eligible -> AmbiguousTraineeCourseOfferingError (fail closed, no
 *    isPrimary tie-break, no lowest-level / earliest-date / first-row pick),
 *    UNLESS the temporary injected compatibility narrows the set (below);
 *  - exactly 1   -> the stable CurrentCourseOffering view.
 *
 * `legacyDualEnrollmentCompatibility` is the OPTIONAL, launch-scoped exception
 * documented in this file's header. Omitted (the default) means the resolver is
 * byte-identical to its pre-exception self. Supplied, the ELIGIBLE offering rows
 * - never the raw input rows - are narrowed by selectLegacyCompatibleActiveRows,
 * which rewrites exactly one shape: the distinct pair {Level 1, Level 2} becomes
 * the Level 1 ROW. Anything else is returned untouched and still fails closed
 * below, so the exception cannot generalize.
 *
 * Note the ORDER: eligibility (ACTIVE enrollment + ACTIVE offering) is applied
 * FIRST and is never relaxed. An INACTIVE enrollment or a non-ACTIVE offering is
 * therefore already gone before the filter runs and can never form the pair - a
 * dual-enrolled trainee whose Level 2 enrollment is INACTIVE simply has one
 * eligible row and takes the ordinary single-row path.
 *
 * The single-row mapping (and the missing-dates check that produces
 * IncompleteCourseOfferingError) is delegated to the existing pure cardinality
 * core so the returned view model is byte-identical to the legacy resolver's.
 */
export function resolveTraineeCourseOfferingFromRows(
  studentId: string,
  rows: readonly TraineeEnrollmentOfferingRow[],
  legacyDualEnrollmentCompatibility?: LegacyOfferingCompatibility,
): CurrentCourseOffering {
  const eligible = rows.filter(
    (r) => r.enrollmentStatus === "ACTIVE" && r.offering.status === "ACTIVE",
  );

  if (eligible.length === 0) {
    throw new NoTraineeCourseOfferingError(studentId);
  }

  // Every row here is one the trainee themselves holds an ACTIVE enrollment
  // into, so whichever row survives the narrowing below is the trainee's own.
  const eligibleOfferings = eligible.map((r) => r.offering);
  const decidable =
    legacyDualEnrollmentCompatibility === undefined
      ? eligibleOfferings
      : selectLegacyCompatibleActiveRows(eligibleOfferings, legacyDualEnrollmentCompatibility);

  if (decidable.length > 1) {
    throw new AmbiguousTraineeCourseOfferingError(
      studentId,
      decidable.map((o) => o.id),
    );
  }
  // Exactly one row: reuse the shared mapper so completeness (dates) is enforced
  // identically. The zero/many branches of that core are unreachable here - the
  // cardinality was already decided above, and the filter never empties a
  // non-empty set.
  return resolveCurrentCourseOfferingFromRows([decidable[0]]);
}

// ---------------------------------------------------------------------------
// Instructor
// ---------------------------------------------------------------------------

/**
 * TEMPORARY instructor course-context policy, INJECTED so this core never
 * imports the compatibility module and stays testable with arbitrary fake
 * policies.
 *
 * There is deliberately NO instructor id in this policy: instructors are not
 * assigned to an offering and no instructor-id allow-list exists. The policy
 * answers exactly one question - "is this EXPLICITLY REQUESTED offering id one
 * the instructor audience is allowed to address?".
 */
export interface InstructorOfferingAccessPolicy {
  readonly isAllowedOfferingId: (courseOfferingId: string) => boolean;
}

/**
 * The request did not state which offering it means (missing/blank
 * courseOfferingId). Course context is NEVER inferred - not from the
 * instructor's name or identity number, not from dates, not from a course
 * level, not from an offering name, not from schedule contents, not from the
 * "current" offering, and not from a cookie - so this fails closed.
 */
export class MissingInstructorCourseOfferingIdError extends Error {
  constructor() {
    super(
      "No explicit courseOfferingId was supplied; instructor course context is " +
        "never inferred from instructor identity, dates, level, offering name, " +
        "schedule contents, the current offering, or cookies.",
    );
    this.name = "MissingInstructorCourseOfferingIdError";
  }
}

/**
 * The explicitly requested offering is outside the temporary instructor policy.
 * Fails closed: the resolver NEVER substitutes an allowed offering for a
 * disallowed request.
 */
export class InstructorCourseOfferingNotAllowedError extends Error {
  readonly offeringId: string;
  constructor(offeringId: string) {
    super(
      `CourseOffering ${offeringId} is not one of the offerings the instructor ` +
        `audience may address; the request is refused and no other offering is ` +
        `substituted.`,
    );
    this.name = "InstructorCourseOfferingNotAllowedError";
    this.offeringId = offeringId;
  }
}

/**
 * The requested (and allowed) offering does not exist, or the fetch returned a
 * different row than was asked for. Fails closed - never falls back.
 */
export class InstructorCourseOfferingUnavailableError extends Error {
  readonly offeringId: string;
  readonly reason: "missing" | "id-mismatch";
  constructor(offeringId: string, reason: "missing" | "id-mismatch") {
    super(
      `The requested CourseOffering (${offeringId}) is unavailable (${reason}); ` +
        `instructor course context fails closed and never falls back to another ` +
        `offering.`,
    );
    this.name = "InstructorCourseOfferingUnavailableError";
    this.offeringId = offeringId;
    this.reason = reason;
  }
}

/**
 * Authorize an EXPLICITLY REQUESTED offering id for the instructor audience.
 *
 * Blank/non-string -> MissingInstructorCourseOfferingIdError (the caller must
 * state which course it means). Outside the policy ->
 * InstructorCourseOfferingNotAllowedError. Otherwise the id is returned
 * UNCHANGED, so it can be used as an exact primary-key lookup.
 *
 * This is a pure check: it does NOT prove the offering exists. The caller must
 * verify that too (see assertInstructorCourseOfferingExists).
 */
export function authorizeInstructorCourseOfferingId(
  requestedCourseOfferingId: string,
  policy: InstructorOfferingAccessPolicy,
): string {
  if (
    typeof requestedCourseOfferingId !== "string" ||
    requestedCourseOfferingId.length === 0
  ) {
    throw new MissingInstructorCourseOfferingIdError();
  }
  if (!policy.isAllowedOfferingId(requestedCourseOfferingId)) {
    throw new InstructorCourseOfferingNotAllowedError(requestedCourseOfferingId);
  }
  return requestedCourseOfferingId;
}

/**
 * Verify the authorized offering actually EXISTS and is the exact row that was
 * asked for, then map it to the stable by-id view.
 *
 * Status is deliberately NOT gated here. The instructor policy is "these two
 * offerings are addressable", and the Level 2 offering is NOT being made ACTIVE
 * by this slice, so requiring ACTIVE would deny the very access being launched.
 * Dates are likewise passed through as Date | null - a PLANNED offering may
 * legitimately be undated (schema: @db.Date optional) and this view never
 * invents one. Any status/date requirement belongs to the individual
 * course-scoped reader, not to this identity check.
 */
export function assertInstructorCourseOfferingExists(
  offeringId: string,
  row: CourseOfferingByIdRow | null,
): CourseOfferingView {
  if (row === null) {
    throw new InstructorCourseOfferingUnavailableError(offeringId, "missing");
  }
  if (row.id !== offeringId) {
    throw new InstructorCourseOfferingUnavailableError(offeringId, "id-mismatch");
  }
  return mapOfferingByIdRowToView(row);
}

// ---------------------------------------------------------------------------
// Dependency-injected orchestration
//
// These live in the PURE core (not in the IO wrapper) on purpose: they perform
// no IO themselves, only sequence injected boundaries. Keeping them here lets
// the DB-free tests exercise the exact query shapes and the fail-closed wiring
// without importing the Prisma client or the next/headers-backed Actor DAL.
// ---------------------------------------------------------------------------

/**
 * The exact query the trainee resolver issues. Filtered to the authenticated
 * student's ACTIVE enrollments into ACTIVE offerings; take:3 so "more than one"
 * is detectable (and reportable) without counting the whole table.
 */
export interface TraineeEnrollmentQuery {
  readonly take: number;
  readonly where: {
    readonly studentId: string;
    readonly status: "ACTIVE";
    readonly courseOffering: { readonly status: "ACTIVE" };
  };
}

/** Injected boundary for the trainee resolver (session read + enrollment fetch). */
export interface TraineeCourseOfferingDeps {
  requireTraineeId: () => Promise<string>;
  fetchTraineeEnrollmentRows: (
    query: TraineeEnrollmentQuery,
  ) => Promise<readonly TraineeEnrollmentOfferingRow[]>;
  /**
   * OPTIONAL launch-scoped dual-enrollment compatibility (see this file's
   * header). It is DATA, not behavior: the two exact offering ids the pair
   * exception recognizes. Omitting it - which every test that does not
   * specifically exercise the exception does - keeps the resolver fully
   * fail-closed. Only the real IO binding supplies it.
   */
  legacyDualEnrollmentCompatibility?: LegacyOfferingCompatibility;
}

/**
 * Resolve the authenticated trainee's single course offering.
 *
 * Course authority is EXACTLY: one ACTIVE CourseEnrollment belonging to an
 * ACTIVE CourseOffering. Zero or more than one fails closed. Student.groupName /
 * Student.subgroupNumber are never read, isPrimary is never used as a
 * tie-breaker, and no selected-course cookie is consulted.
 *
 * The ONLY relaxation is the optional injected dual-enrollment compatibility
 * (see this file's header), which can narrow the exact {Level 1, Level 2} pair
 * to the trainee's own already-fetched Level 1 row. It is passed straight
 * through as data; this function makes no decision about it.
 *
 * take:3 is deliberately kept: two eligible rows are the most the exception can
 * ever resolve, so fetching a THIRD is what makes "the known pair plus another
 * ACTIVE offering" visible to the filter and keeps it ambiguous.
 */
export async function resolveTraineeCourseOfferingWithDeps(
  deps: TraineeCourseOfferingDeps,
): Promise<CurrentCourseOffering> {
  const studentId = await deps.requireTraineeId();
  const rows = await deps.fetchTraineeEnrollmentRows({
    take: 3,
    where: {
      studentId,
      status: "ACTIVE",
      courseOffering: { status: "ACTIVE" },
    },
  });
  return resolveTraineeCourseOfferingFromRows(
    studentId,
    rows,
    deps.legacyDualEnrollmentCompatibility,
  );
}

/**
 * Injected boundary for the instructor resolver.
 *
 * `requireActiveInstructor` exists purely to enforce "an authenticated ACTIVE
 * instructor is present" - it is expected to THROW otherwise. Its result is
 * intentionally discarded: no part of the decision is keyed by instructor
 * identity. Inactive instructors are denied inside this dependency by the
 * existing Actor DAL checks, not by any new logic here.
 */
export interface InstructorCourseOfferingDeps {
  requireActiveInstructor: () => Promise<unknown>;
  isAllowedOfferingId: (courseOfferingId: string) => boolean;
  fetchOfferingById: (offeringId: string) => Promise<CourseOfferingByIdRow | null>;
}

/**
 * Resolve an EXPLICITLY REQUESTED course offering for the instructor audience.
 *
 * Order is deliberate and fail-closed at every step:
 *  1. require an authenticated ACTIVE instructor (throws if absent/inactive);
 *  2. require an explicit courseOfferingId (never inferred);
 *  3. require that id to be inside the temporary instructor policy;
 *  4. require the offering to exist, as exactly that id.
 * Exactly ONE offering lookup is performed and no other offering is ever
 * substituted or probed.
 */
export async function resolveInstructorCourseOfferingWithDeps(
  requestedCourseOfferingId: string,
  deps: InstructorCourseOfferingDeps,
): Promise<CourseOfferingView> {
  await deps.requireActiveInstructor();
  const offeringId = authorizeInstructorCourseOfferingId(requestedCourseOfferingId, {
    isAllowedOfferingId: deps.isAllowedOfferingId,
  });
  const row = await deps.fetchOfferingById(offeringId);
  return assertInstructorCourseOfferingExists(offeringId, row);
}
