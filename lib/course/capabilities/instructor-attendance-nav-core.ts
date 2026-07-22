/**
 * ATT-4V — PURE navigation-visibility core for the instructor ATTENDANCE entry
 * point. It answers exactly one question — should the instructor navigation
 * advertise attendance? — and nothing about data authorization.
 *
 * TWO tiny pieces, both pure and side-effect free:
 *
 *  1. {@link resolveInstructorAttendanceNavVisibilityWithDeps} — a
 *     dependency-injected reducer from the current CourseOffering's resolved
 *     {@link AttendanceCapabilityAccess} to a single boolean. It reads ONLY the
 *     access.canView axis (never canRead / canWrite / the raw status string) and
 *     returns nothing else: the full access object and its internal reason codes
 *     never cross into the browser. Identity is injected as a PARAMETERLESS
 *     resolver (real wiring: resolveCurrentAttendanceCapabilityAccess), so no
 *     courseOfferingId / actor id / date / cookie / URL / client value can select
 *     an offering or influence visibility.
 *
 *  2. {@link filterInstructorAttendanceNavItems} — a pure list filter that omits
 *     the attendance entry ({@link ATTENDANCE_NAV_ID}) from any instructor
 *     navigation array when visibility is false, preserving every other item and
 *     the exact original ordering. Applied at each real navigation source so the
 *     entry is truly absent from the DOM, never merely CSS-hidden.
 *
 * FAIL CLOSED. This is UI discoverability only — hiding the tab is NOT
 * authorization; ATT-3R (canRead) and ATT-3W (canWrite) remain the authoritative
 * server-side read/write boundaries and are untouched here. Because this boolean
 * is consumed by the instructor Server Component that ALSO renders the login form
 * and the rest of the instructor shell, a resolver rejection (missing/ambiguous
 * current offering under the singleton limitation, or any capability-loader /
 * infrastructure failure) must NOT propagate and 500 the whole layout, and must
 * NEVER be converted into a visible attendance entry. The visibility resolver
 * therefore catches a rejection and returns false (omission), scoped to this one
 * optional nav item — the unrelated instructor navigation still renders. Any
 * non-true canView (DISABLED, DENIED_MISSING_CONTEXT, DENIED_UNKNOWN_STATUS, a
 * malformed access) likewise hides the entry.
 *
 * SINGLETON LIMITATION (documented, not solved here): the injected resolver is
 * backed by the global single-CourseOffering current-offering resolver, so with
 * zero or multiple offerings it rejects and attendance nav fails closed to
 * hidden. An actor-aware current-offering selector must replace that global
 * resolver before simultaneous multi-offering operation goes live; that is out
 * of scope for ATT-4V.
 */
import type { AttendanceCapabilityAccess } from "./attendance-capability-policy-core";

/**
 * The stable navigation id of the instructor attendance entry point. It is the
 * MainTabId literal used by both instructor nav surfaces (the "עוד" menu and the
 * "today" quick-nav grid); kept here as a plain string constant so this pure
 * core needs no import from the "use client" BottomTabs module.
 */
export const ATTENDANCE_NAV_ID = "attendance";

/**
 * Injectable dependency for {@link resolveInstructorAttendanceNavVisibilityWithDeps}.
 * `resolveAttendanceAccess` is the PARAMETERLESS, server-owned current-offering
 * ATTENDANCE capability resolver (real wiring: resolveCurrentAttendanceCapabilityAccess).
 * It accepts no courseOfferingId / actor / date / client value.
 */
export interface InstructorAttendanceNavVisibilityDeps {
  resolveAttendanceAccess: () => Promise<AttendanceCapabilityAccess>;
}

/**
 * Reduce the current offering's ATTENDANCE capability to whether the instructor
 * navigation should show the attendance entry point.
 *
 * Returns true ONLY when the resolved access.canView is strictly true (ENABLED
 * and READ_ONLY both view; canWrite=false does NOT hide a READ_ONLY entry). A
 * resolved denial (DISABLED / DENIED_MISSING_CONTEXT / DENIED_UNKNOWN_STATUS, any
 * canView=false) and a malformed access both yield false. A REJECTION from the
 * resolver (missing/ambiguous offering or infrastructure failure) is caught and
 * yields false — fail closed to hidden — so an unresolved capability can never
 * advertise attendance and can never break the surrounding layout. canView, not
 * canRead / canWrite, governs visibility.
 */
export async function resolveInstructorAttendanceNavVisibilityWithDeps(
  deps: InstructorAttendanceNavVisibilityDeps,
): Promise<boolean> {
  let access: AttendanceCapabilityAccess;
  try {
    access = await deps.resolveAttendanceAccess();
  } catch {
    return false;
  }
  return access.canView === true;
}

/**
 * Return `items` unchanged when the attendance entry is visible, otherwise a new
 * array with EVERY attendance entry ({@link ATTENDANCE_NAV_ID}) removed and all
 * other items — and their exact order — preserved. Generic over any navigation
 * item carrying a string `id` (both the "עוד" menu items and the "today"
 * quick-nav shortcuts satisfy this). Removing all matches, not just the first,
 * keeps the entry absent even if a caller composes attendance into a list twice.
 */
export function filterInstructorAttendanceNavItems<T extends { id: string }>(
  items: T[],
  canViewAttendance: boolean,
): T[] {
  if (canViewAttendance) return items;
  return items.filter((item) => item.id !== ATTENDANCE_NAV_ID);
}
