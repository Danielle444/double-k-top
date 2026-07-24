/**
 * SECURITY / LEVEL 2 SLICE L2-C1: the PURE core for TRAINEE MODULE CONTAINMENT.
 *
 * PURE by construction: no Prisma, no DB, no clock, no randomness, no env, no
 * cookies, no next/headers, no React. It decides authorization from explicitly
 * supplied arguments only, so the whole containment contract is unit-testable
 * without a database (see trainee-module-containment-core.test.ts).
 *
 * WHY THIS EXISTS
 * ---------------
 * Several trainee-facing readers "authenticated" a caller by accepting a
 * client-supplied studentId, re-reading that Student row and checking only the
 * GLOBAL Student.isActive flag. That is not authentication: searchStudents() is
 * unauthenticated by design (it powers the login screen) and returns real
 * student ids, so any caller - including an anonymous one - could supply a valid
 * id. This core replaces that pattern with a server-derived actor plus a
 * per-offering capability gate.
 *
 * WHAT THIS OWNS
 * --------------
 *  1. Trainee course-context denial CLASSIFICATION (which failures mean "no
 *     single trustworthy trainee context" and must answer with the uniform empty
 *     result, versus real defects that must propagate).
 *  2. The POSITIVE capability predicate (=== "ENABLED"), parameterised by
 *     CapabilityKey.
 *  3. The dependency-injected authorization ORDER: actor -> offering ->
 *     capability -> data.
 *  4. The uniform, freshly-built empty-array denial result.
 *
 * HARD RULES BAKED IN HERE
 * ------------------------
 *  - The trainee course context is ALWAYS server-resolved. There is deliberately
 *    NO parameter anywhere in this module through which a caller could supply a
 *    courseOfferingId or a trainee id for the trainee audience.
 *  - Nothing here infers an offering from a group name, subgroup, course name,
 *    level, date window, module contents, or a cookie. There is NO Level 1
 *    fallback and no "current offering" heuristic - resolveCurrentCourseOffering
 *    is deliberately not reachable from this module.
 *  - A missing capability row (effective DISABLED under CAP-1), READ_ONLY, a
 *    retired catalog entry, a malformed status and a partial/absent map ALL deny.
 *  - The data loader is invoked ONLY after every gate has passed, so no module
 *    row is ever fetched for an unauthorized caller.
 *  - Every denial produces the SAME empty result, so "denied", "nothing there"
 *    and "belongs to another course" are indistinguishable to the caller and no
 *    trainee, offering, lesson or child record can be probed for existence.
 *
 * Structural precedent: lib/course/course-scoped-week-options-core.ts (slice
 * S1A). This module is the generalised, capability-parameterised sibling of that
 * schedule-specific core; the two are deliberately kept separate because S1A is
 * an active workstream whose files must not be edited here.
 */
import {
  NoTraineeCourseOfferingError,
  AmbiguousTraineeCourseOfferingError,
} from "./actor-course-offering-core";
import { UnauthenticatedActorError } from "@/lib/auth/actor-types";
import type { CapabilityKey } from "./capabilities/capability-keys";
import type { EffectiveCapabilityStatus } from "./capabilities/effective-capability-core";

// ---------------------------------------------------------------------------
// Capability keys owned by this containment core
// ---------------------------------------------------------------------------

/**
 * The single capability key that authorizes any trainee Teaching Practice
 * reading. It is an EXISTING canonical key (capability-keys.ts) - this slice
 * invents no new key.
 */
export const TRAINEE_TEACHING_PRACTICE_CAPABILITY_KEY: CapabilityKey = "TEACHING_PRACTICE";

// ---------------------------------------------------------------------------
// Course-context denial
// ---------------------------------------------------------------------------

/**
 * The failures that mean "this caller has no single, trustworthy trainee course
 * context" and must therefore be answered with the uniform empty result rather
 * than an error:
 *
 *  - UnauthenticatedActorError            - anonymous / expired / wrong-audience
 *                                           / inactive trainee session;
 *  - NoTraineeCourseOfferingError         - zero eligible enrollments (including
 *                                           a PLANNED-only offering, which is
 *                                           exactly the pre-launch Level 2
 *                                           state);
 *  - AmbiguousTraineeCourseOfferingError  - more than one eligible enrollment.
 *
 * Everything else (Prisma failure, capability-reader failure, programming error,
 * a defect in the resolver) is NOT a denial and must propagate unchanged - a
 * broken dependency must never be silently reported to a trainee as "there is
 * nothing here".
 *
 * This mirrors the classifier in lib/course/course-scoped-week-options-core.ts.
 * It is re-stated here rather than imported because that module belongs to the
 * active S1A workstream and must not be touched by this slice.
 */
export function isTraineeCourseContextDenial(error: unknown): boolean {
  return (
    error instanceof UnauthenticatedActorError ||
    error instanceof NoTraineeCourseOfferingError ||
    error instanceof AmbiguousTraineeCourseOfferingError
  );
}

// ---------------------------------------------------------------------------
// Capability predicate
// ---------------------------------------------------------------------------

/**
 * Positive-ENABLED test, deliberately `!== "ENABLED"` rather than
 * `=== "DISABLED"`: a missing capability row (effective DISABLED under CAP-1), a
 * retired catalog entry, a malformed status and READ_ONLY all DENY. A module is
 * served only on a positively ENABLED capability for the exact resolved
 * offering. A partial, empty, null or undefined map denies rather than throwing,
 * so a malformed capability payload can never widen access.
 */
export function isTraineeCapabilityEnabled(
  capabilityKey: CapabilityKey,
  capabilities: Partial<Record<CapabilityKey, EffectiveCapabilityStatus>> | null | undefined,
): boolean {
  if (!capabilities) return false;
  return capabilities[capabilityKey] === "ENABLED";
}

// ---------------------------------------------------------------------------
// Uniform denial result
// ---------------------------------------------------------------------------

/**
 * The uniform "you get nothing" row result. Built FRESH on every call (never a
 * shared frozen singleton) so no caller can mutate another caller's result, and
 * so an accidental in-place push by one consumer can never leak into another.
 */
export function emptyTraineeModuleRows<TRow>(): TRow[] {
  return [];
}

// ---------------------------------------------------------------------------
// Dependency-injected authorization
// ---------------------------------------------------------------------------

/**
 * The trainee course-context dependencies.
 *
 * `requireTraineeId` is the server-derived actor step: it resolves the trainee
 * id from the SIGNED SESSION and throws UnauthenticatedActorError when there is
 * no trustworthy trainee. `resolveTraineeCourseOffering` takes NO arguments by
 * design - there is no parameter through which any caller could supply an
 * offering id, and the student id it uses comes from the signed session inside
 * the real binding.
 */
export interface TraineeModuleContextDeps {
  requireTraineeId: () => Promise<string>;
  resolveTraineeCourseOffering: () => Promise<{ id: string }>;
  getEffectiveCapabilities: (
    courseOfferingId: string,
  ) => Promise<Record<CapabilityKey, EffectiveCapabilityStatus>>;
}

/**
 * What an AUTHORIZED caller carries onward. `traineeId` is SESSION-DERIVED and
 * is the only trustworthy trainee identity: it, never a client-supplied
 * argument, must drive every self-specific filter or "is this me?" flag.
 */
export interface AuthorizedTraineeModuleContext {
  traineeId: string;
  courseOfferingId: string;
}

/** The result of the module gate - authorized carries the verified context. */
export type TraineeModuleAuthorization =
  | { authorized: false }
  | { authorized: true; context: AuthorizedTraineeModuleContext };

/** The single, uniform denial value for the module gate. */
const TRAINEE_MODULE_DENIED: TraineeModuleAuthorization = Object.freeze({
  authorized: false as const,
});

/**
 * The module authorization gate.
 *
 * Order is deliberate and fail-closed at every step:
 *  1. derive the trainee from the signed session (denial -> denied; any other
 *     error propagates);
 *  2. resolve THAT trainee's own offering server-side (denial -> denied; any
 *     other error propagates);
 *  3. read THAT EXACT offering's effective capabilities and require
 *     `capabilityKey` to be positively ENABLED.
 *
 * Every failure returns the SAME denial value, so unauthenticated,
 * no-such-course, ambiguous-course and capability-disabled are indistinguishable
 * to the caller. Only an authorized result carries the session-derived trainee
 * id and the resolved offering id onward.
 */
export async function authorizeTraineeModuleWithDeps(
  capabilityKey: CapabilityKey,
  deps: TraineeModuleContextDeps,
): Promise<TraineeModuleAuthorization> {
  let traineeId: string;
  let courseOfferingId: string;
  try {
    traineeId = await deps.requireTraineeId();
    courseOfferingId = (await deps.resolveTraineeCourseOffering()).id;
  } catch (error) {
    if (isTraineeCourseContextDenial(error)) {
      return TRAINEE_MODULE_DENIED;
    }
    throw error;
  }

  const capabilities = await deps.getEffectiveCapabilities(courseOfferingId);
  if (!isTraineeCapabilityEnabled(capabilityKey, capabilities)) {
    return TRAINEE_MODULE_DENIED;
  }

  return { authorized: true, context: { traineeId, courseOfferingId } };
}

/**
 * Authorize, then - and ONLY then - load the module's rows.
 *
 * This is the shape every contained trainee reader should use, because it makes
 * "no data fetch before authorization passes" structural rather than a rule each
 * call site has to remember: `loadRows` is unreachable unless
 * {@link authorizeTraineeModuleWithDeps} authorized the caller, and it receives
 * the SESSION-DERIVED trainee id so no call site needs (or is handed) the
 * client-supplied one.
 *
 * A denial yields the uniform fresh empty array. A `loadRows` failure propagates
 * unchanged - a broken data read is a defect, not a denial.
 */
export async function loadAuthorizedTraineeModuleRowsWithDeps<TRow>(
  capabilityKey: CapabilityKey,
  deps: TraineeModuleContextDeps,
  loadRows: (context: AuthorizedTraineeModuleContext) => Promise<TRow[]>,
): Promise<TRow[]> {
  const authorization = await authorizeTraineeModuleWithDeps(capabilityKey, deps);
  if (!authorization.authorized) {
    return emptyTraineeModuleRows<TRow>();
  }
  return loadRows(authorization.context);
}
