/**
 * MULTI-COURSE (dormant foundation, Slice 3) - SERVER wrappers for the
 * non-authoritative admin CourseOffering convenience cookie.
 *
 * SERVER-ONLY BY CONSTRUCTION - this module imports `cookies` from
 * "next/headers", which cannot be bundled into client code. Following the repo
 * convention (see lib/auth/session.ts), the `server-only` package is NOT imported
 * (it is not a project dependency); server-only-ness is enforced by the
 * next/headers import.
 *
 * These wrappers are DELIBERATELY THIN: every decision (name, normalization,
 * attributes, the redirect candidate) lives in the PURE core
 * (admin-course-cookie-core.ts). The concrete functions only obtain the request
 * cookie store via `await cookies()` and delegate to an injectable
 * store-orchestration seam, which the DB-free/browser-free test exercises with a
 * fake store (the concrete `cookies()` path is never invoked in tests).
 *
 * THE COOKIE IS CONVENIENCE STATE, NEVER AUTHORIZATION:
 *   - it only remembers the admin's last explicitly selected CourseOffering id;
 *   - a forged or stale value must never grant access;
 *   - the authoritative course scope is the explicit URL id, re-validated at the
 *     destination page by requireAdminCourseOffering(id).
 *
 * It touches ONLY `dk_admin_course`. It never reads, writes or clears any
 * identity/session cookie (the NextAuth cookies or the instructor/trainee
 * session cookies) and never inspects the auth session. Course context stays
 * OUTSIDE the identity session.
 *
 * DORMANT: no runtime consumer imports this slice; nothing is wired.
 */
import { cookies } from "next/headers";
import { getCourseOfferingById } from "./offering-by-id";
import type { CourseOfferingView } from "./offering-by-id-core";
import {
  ADMIN_COURSE_COOKIE_NAME,
  normalizeAdminCourseCookieValue,
  buildAdminCourseCookieAttributes,
  buildAdminCourseCookieClearAttributes,
  resolveRememberedAdminCourseForRedirectWithDeps,
  InvalidAdminCourseCookieValueError,
  type AdminCourseCookieAttributes,
  type RememberedAdminCourseRedirectDeps,
} from "./admin-course-cookie-core";

/** Whether the process is running in production. Read at call time only. */
function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * The minimal shape of a cookie store this module needs. It is a structural
 * subset of Next's request cookie store (`ReadonlyRequestCookies` /
 * mutable request cookies): a `get` by name and a `set(name, value, attrs)`.
 * Modelling only this narrow surface keeps the store-orchestration seams
 * unit-testable with a plain fake object.
 */
export interface AdminCourseCookieReader {
  get(name: string): { value: string } | undefined;
}
export interface AdminCourseCookieWriter {
  set(name: string, value: string, attributes: AdminCourseCookieAttributes): void;
}

// --- Injectable store-orchestration seams (pure over an injected store) -------

/**
 * Read the remembered offering id from a cookie store: accesses ONLY
 * `dk_admin_course`, normalizes it through the pure core, and returns
 * `string | null`. It loads no CourseOffering data, calls no requireAdmin, and
 * touches no identity cookie.
 */
export function readRememberedAdminCourseOfferingIdFromStore(
  store: AdminCourseCookieReader,
): string | null {
  const raw = store.get(ADMIN_COURSE_COOKIE_NAME)?.value;
  return normalizeAdminCourseCookieValue(raw);
}

/**
 * Set the remembered offering id on a cookie store. Normalizes the explicit id
 * and, on invalid input, throws the typed generic InvalidAdminCourseCookieValueError
 * (no reflection). Writes exactly ONE cookie - `dk_admin_course` - with the
 * approved attributes. It does NOT claim the id is authorized; a future caller
 * must have validated the explicit selection first.
 */
export function setRememberedAdminCourseOfferingIdOnStore(
  store: AdminCourseCookieWriter,
  courseOfferingId: string,
  opts: { isProduction: boolean },
): void {
  const normalized = normalizeAdminCourseCookieValue(courseOfferingId);
  if (normalized === null) {
    throw new InvalidAdminCourseCookieValueError();
  }
  store.set(
    ADMIN_COURSE_COOKIE_NAME,
    normalized,
    buildAdminCourseCookieAttributes({ isProduction: opts.isProduction }),
  );
}

/**
 * Clear the remembered offering cookie on a cookie store by overwriting
 * `dk_admin_course` with an empty value and maxAge 0 at the SAME path (/admin),
 * mirroring the repo's set-based clear convention (see lib/auth/session.ts). It
 * never touches the NextAuth or instructor/trainee session cookies, nor any
 * other cookie.
 */
export function clearRememberedAdminCourseOfferingIdOnStore(
  store: AdminCourseCookieWriter,
  opts: { isProduction: boolean },
): void {
  store.set(
    ADMIN_COURSE_COOKIE_NAME,
    "",
    buildAdminCourseCookieClearAttributes({ isProduction: opts.isProduction }),
  );
}

/**
 * Choose a candidate redirect offering from a cookie store: reads ONLY
 * `dk_admin_course` and delegates to the pure core resolver with the injected
 * exact-id lookup. This is NOT authorization - it only confirms the remembered
 * offering still exists and returns its narrow view (or null). It never selects
 * another offering, authorizes an actor, or performs a write.
 */
export async function resolveRememberedAdminCourseForRedirectFromStore(
  store: AdminCourseCookieReader,
  deps: RememberedAdminCourseRedirectDeps,
): Promise<CourseOfferingView | null> {
  const raw = store.get(ADMIN_COURSE_COOKIE_NAME)?.value;
  return resolveRememberedAdminCourseForRedirectWithDeps(raw, deps);
}

// --- Concrete next/headers wrappers (thin; delegate to the seams above) -------

/**
 * Read and normalize the remembered admin CourseOffering id from the request
 * cookies, or null. Does NOT load offering data, call requireAdmin, authorize
 * access, or read/modify any identity cookie.
 */
export async function readRememberedAdminCourseOfferingId(): Promise<string | null> {
  const store = await cookies();
  return readRememberedAdminCourseOfferingIdFromStore(store);
}

/**
 * Remember an explicit admin CourseOffering id (convenience only). Throws the
 * typed generic error on invalid input. Intended to be called ONLY after a
 * future caller has validated the explicit selection - setting the cookie makes
 * no authorization claim.
 */
export async function setRememberedAdminCourseOfferingId(
  courseOfferingId: string,
): Promise<void> {
  const store = await cookies();
  setRememberedAdminCourseOfferingIdOnStore(store, courseOfferingId, {
    isProduction: isProduction(),
  });
}

/** Clear the remembered admin CourseOffering convenience cookie. */
export async function clearRememberedAdminCourseOfferingId(): Promise<void> {
  const store = await cookies();
  clearRememberedAdminCourseOfferingIdOnStore(store, {
    isProduction: isProduction(),
  });
}

/**
 * Resolve a candidate redirect offering from the remembered convenience cookie,
 * binding the committed Slice 1 exact-id reader. Returns the narrow offering
 * view or null. A future generic admin route must still requireAdmin(), use this
 * only to pick a candidate URL, redirect to an explicit URL, and let the
 * destination independently run requireAdminCourseOffering(id).
 */
export async function resolveRememberedAdminCourseForRedirect(): Promise<CourseOfferingView | null> {
  const store = await cookies();
  return resolveRememberedAdminCourseForRedirectFromStore(store, {
    getCourseOfferingById,
  });
}
