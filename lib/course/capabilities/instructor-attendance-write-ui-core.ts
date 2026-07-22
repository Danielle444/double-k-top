/**
 * ATT-5WUI — PURE instructor ATTENDANCE UI-access core.
 *
 * Two tiny, side-effect-free pieces that together let the instructor shell make
 * the attendance UI non-editable whenever the effective write permission is
 * false, WITHOUT any second capability load and WITHOUT leaking the capability
 * object into the browser.
 *
 *  1. {@link resolveInstructorAttendanceUiAccessWithDeps} — a dependency-injected
 *     composition that resolves the current offering's ATTENDANCE
 *     {@link AttendanceCapabilityAccess} EXACTLY ONCE and reduces it to the two
 *     (and only two) booleans the client boundary needs:
 *       - canViewAttendance = access.canView === true
 *       - canWriteAttendance = access.canWrite === true
 *     Both are derived from the SAME resolved access object — never two resolves,
 *     never an independent current-offering lookup, never separate view/write
 *     loads. The full access object, its `status`, and its internal reason codes
 *     never cross into the returned shape (and thus never reach the browser). This
 *     supersedes the ATT-4V visibility-only reducer at the instructor page
 *     boundary so that one resolution safely yields both booleans; the ATT-4V
 *     `filterInstructorAttendanceNavItems` nav filter and its canView semantics are
 *     unchanged and still consume canViewAttendance.
 *
 *     canView / canWrite are read as distinct single axes (mirroring how ATT-4V's
 *     nav reducer reads `access.canView === true`): READ_ONLY yields
 *     canViewAttendance=true, canWriteAttendance=false. The authoritative ATT-1
 *     policy only ever emits canWrite=true for ENABLED (which also has
 *     canView=true); every denied / DISABLED / malformed status the policy
 *     produces is fully false on all axes, so a permissive write can never be read
 *     out of a denied access.
 *
 *  2. {@link resolveEffectiveInstructorAttendanceEditability} — a pure reducer that
 *     combines the ACTOR permission (session.canEditAttendance) with the offering
 *     capability (canWriteAttendance) into the single editability the attendance
 *     component consumes as its existing `canEdit` prop:
 *       effectiveCanEditAttendance = actorCanEditAttendance && canWriteAttendance
 *     BOTH are required. The offering capability NEVER grants editing to a person
 *     who lacks canEditAttendance, and the actor permission is never replaced by
 *     canView / canRead / canWrite — capability can only ever REMOVE editability an
 *     actor already had, never add it.
 *
 * FAIL CLOSED. Any rejection from the injected resolver (missing / ambiguous /
 * incomplete current offering under the singleton limitation, or any
 * capability-loader / infrastructure failure) is caught and converted into
 * { canViewAttendance: false, canWriteAttendance: false } — never propagated (so
 * it can't 500 the instructor shell) and never converted into visible or editable
 * attendance. There is no fallback offering selection and no client-supplied
 * offering identity: the resolver is a PARAMETERLESS injected dependency (real
 * wiring: resolveCurrentAttendanceCapabilityAccess), so no courseOfferingId /
 * actor id / date / cookie / URL / client value can select an offering or
 * influence either boolean.
 *
 * NOT AUTHORIZATION. Hiding controls is UI gating only; ATT-3R (canRead) and
 * ATT-3W (canWrite) remain the authoritative server-side attendance read/write
 * boundaries and are untouched. The server rejection stands even when this gating
 * normally prevents the attempt.
 *
 * PURE by construction: the only imports are erased `import type`s, so this module
 * pulls in no runtime code, no Prisma, no DB, no server-only surface, and is safe
 * to import from both the instructor Server Component (for the resolver) and the
 * "use client" InstructorClient (for the pure editability reducer).
 */
import type { AttendanceCapabilityAccess } from "./attendance-capability-policy-core";

/**
 * The two booleans — and ONLY these two — that cross from the capability layer
 * into the instructor client shell. Deliberately does NOT carry the resolved
 * access object, its `status`, or any reason code.
 */
export interface InstructorAttendanceUiAccess {
  readonly canViewAttendance: boolean;
  readonly canWriteAttendance: boolean;
}

/**
 * Injectable dependency for {@link resolveInstructorAttendanceUiAccessWithDeps}.
 * `resolveAttendanceAccess` is the PARAMETERLESS, server-owned current-offering
 * ATTENDANCE capability resolver (real wiring: resolveCurrentAttendanceCapabilityAccess).
 * It accepts no courseOfferingId / actor / date / client value.
 */
export interface InstructorAttendanceUiAccessDeps {
  resolveAttendanceAccess: () => Promise<AttendanceCapabilityAccess>;
}

/**
 * Resolve the current offering's ATTENDANCE capability ONCE and reduce it to the
 * two client-boundary booleans. canViewAttendance and canWriteAttendance are both
 * derived from the SAME access object returned by a single
 * `deps.resolveAttendanceAccess()` call. A rejection fails closed to both false.
 * The access object / status / reason codes are never returned.
 */
export async function resolveInstructorAttendanceUiAccessWithDeps(
  deps: InstructorAttendanceUiAccessDeps,
): Promise<InstructorAttendanceUiAccess> {
  let access: AttendanceCapabilityAccess;
  try {
    access = await deps.resolveAttendanceAccess();
  } catch {
    // Missing/ambiguous offering or infra failure — hide AND lock, never 500.
    return { canViewAttendance: false, canWriteAttendance: false };
  }
  return {
    canViewAttendance: access.canView === true,
    canWriteAttendance: access.canWrite === true,
  };
}

/**
 * The effective instructor attendance editability: an actor may edit attendance
 * only when they carry the actor permission (session.canEditAttendance) AND the
 * current offering's ATTENDANCE capability permits writing (canWriteAttendance).
 *
 * Pure AND of the two required inputs. Strict-`true` on both so any non-boolean
 * that bypassed the type system fails closed. The actor permission is authoritative
 * and irreplaceable: capability can only remove editability, never grant it to
 * someone without canEditAttendance.
 */
export function resolveEffectiveInstructorAttendanceEditability(
  actorCanEditAttendance: boolean,
  canWriteAttendance: boolean,
): boolean {
  return actorCanEditAttendance === true && canWriteAttendance === true;
}
