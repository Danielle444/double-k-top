/**
 * LEVEL 2 SLICE L2-DUAL - PURE decision core for TRAINEE COURSE SELECTION across
 * a trainee's OWN eligible course offerings.
 *
 * PURE by construction: no Prisma, no DB, no clock, no randomness, no env, no
 * auth/session/cookie read. It receives an already-authenticated student id plus
 * already-fetched enrollment rows and either returns the stable
 * CurrentCourseOffering view / an options menu, or throws a typed error. The whole
 * contract is unit-testable without a database (see
 * trainee-course-selection-core.test.ts).
 *
 * WHY THIS EXISTS - AND WHAT IT DELIBERATELY SUPERSEDES
 * ----------------------------------------------------
 * resolveTraineeCourseOfferingFromRows (actor-course-offering-core.ts) requires
 * EXACTLY ONE eligible enrollment and fails closed on two. That is still the
 * correct contract for every trainee module, and it is NOT changed here: duties,
 * course materials, messages/tasks, weekly feedback and Teaching Practice all keep
 * injecting the committed no-argument resolveTraineeCourseOffering(), so a
 * dual-enrolled trainee stays fail-closed (uniform empty) on all of them.
 *
 * This core adds a SECOND, NARROWER path used by exactly two modules - the weekly
 * SCHEDULE and the instructor/CONTACT directory - in which the caller may STATE
 * which of their own courses they mean.
 *
 * THE REQUESTED ID IS A REQUEST, NEVER AN AUTHORITY
 * ------------------------------------------------
 * A client-supplied courseOfferingId is only ever used as an EXACT-EQUALITY
 * PREDICATE against the set of offerings that the authenticated trainee's own
 * ACTIVE CourseEnrollments into ACTIVE CourseOfferings already resolved to. It is
 * never used as a lookup key, never forwarded to a query, and never returned. The
 * value handed onward is the id of the matched ROW (the server's own copy), so a
 * requested value can only ever SELECT FROM an already-authorized set - it can
 * never widen it, and it cannot pass through this core unmatched.
 *
 * HARD RULES BAKED IN HERE
 * ------------------------
 *  - Eligibility is re-checked here (enrollment ACTIVE *and* offering ACTIVE) even
 *    though the query filters on both, so a future query edit cannot silently
 *    widen who resolves to a course.
 *  - NO fallback of any kind: no Level 1 constant, no "current" offering, no
 *    first-row pick, no isPrimary tie-break (it is not a database-enforced
 *    invariant - see the CourseEnrollment model comment), no date-window / course
 *    level / offering name inference, no cookie.
 *  - Every denial reuses the two EXISTING trainee course-context error types, so
 *    the three consuming orchestrations translate them into their pre-existing
 *    uniform empty result with no change to their denial predicates. Unknown,
 *    malformed, outside-roster, inactive-enrollment, PLANNED-offering and
 *    inactive-offering requests are therefore INDISTINGUISHABLE to the caller.
 */
import {
  resolveCurrentCourseOfferingFromRows,
  type CourseOfferingRow,
  type CurrentCourseOffering,
} from "./current-offering-core";
import {
  NoTraineeCourseOfferingError,
  AmbiguousTraineeCourseOfferingError,
  type TraineeEnrollmentOfferingRow,
  type TraineeEnrollmentQuery,
} from "./actor-course-offering-core";

/**
 * One selectable course as it is handed to the trainee client. `label` is composed
 * on the SERVER from the DB-backed level and name, and `id` is the stable primary
 * key the client sends back.
 *
 * There is deliberately no selected/default/isCurrent marker: appearing in this
 * list means only "this trainee may ASK for this course context for schedule and
 * contacts". It grants no module and authorizes no read - every consuming action
 * re-resolves the id independently (see
 * {@link selectTraineeCourseOfferingFromRows}).
 */
export interface TraineeCourseOptionView {
  readonly id: string;
  readonly label: string;
  readonly level: number;
}

/**
 * Compose the Hebrew display label from the DB-backed level and name. The name is
 * used verbatim (only trimmed for the emptiness check); a blank name yields the
 * level alone rather than a dangling separator.
 *
 * Deliberately NOT shared with composeInstructorCourseOptionLabel: the two
 * audiences' menus are separate contracts throughout this codebase and must stay
 * free to diverge. This is presentation only - nothing downstream may parse a
 * label back into a course identity.
 */
export function composeTraineeCourseOptionLabel(level: number, name: string): string {
  const trimmed = typeof name === "string" ? name.trim() : "";
  return trimmed.length === 0 ? `רמה ${level}` : `רמה ${level} · ${trimmed}`;
}

/**
 * Total, deterministic comparator: level ascending, then id ascending. The id
 * tie-breaker is a unique primary key, so the order is fully determined
 * independent of the input row order and of sort stability.
 *
 * Ordering is DISPLAY-ONLY. Being first carries no selection meaning here; the
 * client's default pick is a UX convenience drawn from this already-authorized
 * list, and it is re-validated server-side like any other request.
 */
function compareOfferingRows(a: CourseOfferingRow, b: CourseOfferingRow): number {
  if (a.level !== b.level) {
    return a.level - b.level;
  }
  if (a.id !== b.id) {
    return a.id < b.id ? -1 : 1;
  }
  return 0;
}

/**
 * THE single eligibility definition, shared by the options menu and the selection
 * decision so the two can never drift apart: a row counts iff its enrollment is
 * ACTIVE *and* its offering is ACTIVE.
 *
 * Returns the DISTINCT offerings (first occurrence of an id wins - two ACTIVE
 * enrollments into one offering is still one course), in the deterministic display
 * order above.
 */
export function eligibleTraineeOfferingsFromRows(
  rows: readonly TraineeEnrollmentOfferingRow[],
): CourseOfferingRow[] {
  const seen = new Set<string>();
  const offerings: CourseOfferingRow[] = [];

  for (const row of rows) {
    if (row.enrollmentStatus !== "ACTIVE" || row.offering.status !== "ACTIVE") {
      continue;
    }
    if (seen.has(row.offering.id)) {
      continue;
    }
    seen.add(row.offering.id);
    offerings.push(row.offering);
  }

  return offerings.sort(compareOfferingRows);
}

/**
 * Build the course-options menu for the authenticated trainee.
 *
 * Never throws: an empty menu is a legitimate fail-closed outcome (nothing is
 * selectable) and is the caller's to render, not this core's to paper over.
 */
export function buildTraineeCourseOptions(
  rows: readonly TraineeEnrollmentOfferingRow[],
): TraineeCourseOptionView[] {
  return eligibleTraineeOfferingsFromRows(rows).map((offering) => ({
    id: offering.id,
    label: composeTraineeCourseOptionLabel(offering.level, offering.name),
    level: offering.level,
  }));
}

/**
 * Did the caller STATE a course, or omit one?
 *
 * ONLY `undefined` and `null` count as "omitted" - that is the compatibility path
 * that keeps a single-course trainee working exactly as before when no id is
 * passed. ANY other value (including "", a whitespace string, a number, an object)
 * counts as STATED and must therefore match an eligible offering by exact string
 * equality or be denied. A malformed request is never quietly downgraded into
 * "they didn't ask", because that would let a bad value silently resolve to a
 * course.
 */
function isCourseRequestStated(requested: unknown): boolean {
  return requested !== undefined && requested !== null;
}

/**
 * Decide the authenticated trainee's course offering for the SCHEDULE / CONTACTS
 * path, given an optional REQUESTED offering id.
 *
 * Order is deliberate and fail-closed at every step:
 *  1. reduce the fetched rows to the trainee's own eligible, distinct offerings;
 *  2. none eligible -> NoTraineeCourseOfferingError;
 *  3. no course STATED:
 *       - exactly one eligible -> that offering (the unchanged single-course
 *         behaviour, so an omitted id is always safe);
 *       - more than one eligible -> AmbiguousTraineeCourseOfferingError. The
 *         server never picks for the caller.
 *  4. a course STATED: keep it ONLY if it exactly equals an eligible offering's id
 *     (no trimming, no case folding, no prefix matching). No match ->
 *     NoTraineeCourseOfferingError, and NO other offering is ever substituted.
 *
 * The returned view is built from the MATCHED ROW, never from the requested
 * string, and it goes through the shared cardinality mapper so its shape (and the
 * IncompleteCourseOfferingError on a dateless offering) is byte-identical to the
 * committed single-course resolver's.
 */
export function selectTraineeCourseOfferingFromRows(
  studentId: string,
  requestedCourseOfferingId: string | null | undefined,
  rows: readonly TraineeEnrollmentOfferingRow[],
): CurrentCourseOffering {
  const eligible = eligibleTraineeOfferingsFromRows(rows);

  if (eligible.length === 0) {
    throw new NoTraineeCourseOfferingError(studentId);
  }

  if (!isCourseRequestStated(requestedCourseOfferingId)) {
    if (eligible.length > 1) {
      throw new AmbiguousTraineeCourseOfferingError(
        studentId,
        eligible.map((o) => o.id),
      );
    }
    return resolveCurrentCourseOfferingFromRows([eligible[0]]);
  }

  const matched = eligible.find((o) => o.id === requestedCourseOfferingId);
  if (matched === undefined) {
    // Outside the trainee's roster, an inactive enrollment, a PLANNED or inactive
    // offering, an unknown id and a malformed value all land here and are
    // reported identically - the caller learns nothing about which held.
    throw new NoTraineeCourseOfferingError(studentId);
  }
  return resolveCurrentCourseOfferingFromRows([matched]);
}

// ---------------------------------------------------------------------------
// Dependency-injected orchestration
//
// These live in the PURE core (not in the IO wrapper) on purpose: they perform no
// IO themselves, only sequence injected boundaries. Keeping them here lets the
// DB-free tests exercise the exact query shape and the fail-closed wiring without
// importing the Prisma client or the next/headers-backed Actor DAL.
// ---------------------------------------------------------------------------

/**
 * How many enrollment rows the selection/options fetch reads.
 *
 * Larger than the committed single-course resolver's take:3, which only needs to
 * DETECT "more than one". Here the full eligible set is the authorization domain,
 * so truncating it could deny a course the trainee genuinely holds. Truncation can
 * therefore only ever DENY, never grant - but 25 keeps that unreachable in
 * practice.
 */
export const TRAINEE_COURSE_SELECTION_TAKE = 25;

/**
 * The exact query both trainee-selection reads issue. Identical in filter shape to
 * the committed single-course resolver's (the authenticated student's ACTIVE
 * enrollments into ACTIVE offerings), so eligibility is defined the same way at
 * the database and in the core.
 *
 * The requested offering id is deliberately ABSENT from this query: it must never
 * become a lookup key, only a predicate applied afterwards to rows that were
 * already scoped to this trainee.
 */
export function buildTraineeCourseSelectionQuery(studentId: string): TraineeEnrollmentQuery {
  return {
    take: TRAINEE_COURSE_SELECTION_TAKE,
    where: {
      studentId,
      status: "ACTIVE",
      courseOffering: { status: "ACTIVE" },
    },
  };
}

/** Injected boundary (session read + enrollment fetch) for both readers below. */
export interface TraineeCourseSelectionDeps {
  requireTraineeId: () => Promise<string>;
  fetchTraineeEnrollmentRows: (
    query: TraineeEnrollmentQuery,
  ) => Promise<readonly TraineeEnrollmentOfferingRow[]>;
}

/**
 * Resolve the authenticated trainee's course offering for an optional REQUESTED
 * id.
 *
 * The trainee id comes from the session dependency and is the SOLE identity
 * source; the requested id never participates in identity, never reaches the
 * query, and is only matched against rows already scoped to that trainee.
 */
export async function resolveTraineeSelectedCourseOfferingWithDeps(
  requestedCourseOfferingId: string | null | undefined,
  deps: TraineeCourseSelectionDeps,
): Promise<CurrentCourseOffering> {
  const studentId = await deps.requireTraineeId();
  const rows = await deps.fetchTraineeEnrollmentRows(buildTraineeCourseSelectionQuery(studentId));
  return selectTraineeCourseOfferingFromRows(studentId, requestedCourseOfferingId, rows);
}

/**
 * List the courses the authenticated trainee may ask for.
 *
 * Takes NO requested id - a menu is never keyed by what the caller asked for. The
 * session guard is the FIRST awaited operation, so an anonymous or wrong-audience
 * caller can never probe which offerings exist or learn their names.
 */
export async function listTraineeCourseOptionsWithDeps(
  deps: TraineeCourseSelectionDeps,
): Promise<TraineeCourseOptionView[]> {
  const studentId = await deps.requireTraineeId();
  const rows = await deps.fetchTraineeEnrollmentRows(buildTraineeCourseSelectionQuery(studentId));
  return buildTraineeCourseOptions(rows);
}
