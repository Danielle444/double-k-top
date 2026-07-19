/**
 * MULTI-COURSE (dormant foundation, Slice 3) - PURE core for the non-authoritative
 * admin CourseOffering convenience cookie.
 *
 * PURE by construction: no Prisma client, no DB, no next/headers, no cookies(),
 * no auth/session, no env, no clock, no randomness, no singleton resolver. It
 * only computes the cookie name/attributes, normalizes a raw cookie value, and -
 * through an INJECTED exact-id lookup - decides which remembered offering a
 * future generic admin route might redirect to. The whole contract is unit
 * testable without a database (see admin-course-cookie-core.test.ts).
 *
 * WHAT THIS COOKIE IS NOT:
 *   - It is NEVER authorization. A forged or stale value must never grant access.
 *   - It is NEVER the final data-scoping authority. The authoritative course
 *     scope is the explicit URL `courseOfferingId`, re-validated server-side by
 *     requireAdminCourseOffering(id) at the destination page.
 *   - It stores ONLY one normalized CourseOffering id string - never admin
 *     identity, capabilities, status, name/level, group, horse, enrollment,
 *     permissions, timestamps, JSON, signed identity data or secrets.
 *   - It never selects "the current offering" and never falls back to the
 *     first/newest/only ACTIVE offering.
 *
 * DORMANT: no runtime consumer imports this slice; nothing is wired.
 */
import type { CourseOfferingView } from "./offering-by-id-core";

/**
 * The exact convenience-cookie name. Exposed as the single source of truth so no
 * string literal for this cookie is duplicated anywhere. It is deliberately
 * distinct from every identity/session cookie name.
 */
export const ADMIN_COURSE_COOKIE_NAME = "dk_admin_course";

/**
 * The cookie path. Scoped to `/admin` on purpose - the convenience state is only
 * meaningful under the admin surface and must never be sent on `/` (which would
 * broaden its exposure to instructor/trainee and public routes).
 */
export const ADMIN_COURSE_COOKIE_PATH = "/admin";

/** The cookie lifetime: 30 days in seconds (30 * 24 * 60 * 60). */
export const ADMIN_COURSE_COOKIE_MAX_AGE_SECONDS = 2_592_000;

/**
 * A conservative maximum accepted value length. Comfortably larger than any CUID
 * this project generates (~24-25 chars) WITHOUT hard-coding a specific id or
 * assuming an exact length, yet small enough to reject absurd/oversized cookie
 * payloads. The value is only ever an id, so anything longer is malformed.
 */
export const ADMIN_COURSE_COOKIE_MAX_VALUE_LENGTH = 64;

/**
 * Control characters (C0 range, DEL, and C1 range) that must never appear in a
 * legitimate id. Their presence marks the value as malformed - it fails closed
 * to null rather than being silently sanitized. Written with \u escapes so the
 * source itself contains no literal control bytes.
 */
const CONTROL_CHARACTERS = new RegExp("[\u0000-\u001F\u007F-\u009F]");

/**
 * The exact cookie attributes for the convenience cookie. Locked to httpOnly +
 * sameSite=lax + path=/admin with NO Domain attribute; `secure` follows the
 * environment and `maxAge` follows the caller (30 days for set, 0 for clear).
 * The absence of a `domain` field is intentional and part of the contract.
 */
export interface AdminCourseCookieAttributes {
  readonly httpOnly: true;
  readonly sameSite: "lax";
  readonly secure: boolean;
  readonly path: typeof ADMIN_COURSE_COOKIE_PATH;
  readonly maxAge: number;
}

/**
 * Normalize a raw cookie value into a usable id, or null when it is malformed.
 *
 * Fail-closed rules (never throws for ordinary invalid input):
 *   - non-string runtime input            -> null;
 *   - empty string                        -> null;
 *   - whitespace-only                     -> null;
 *   - surrounding whitespace on a value   -> null (treated as malformed, NOT
 *                                            silently trimmed into a different id);
 *   - contains any control character      -> null;
 *   - longer than the conservative max    -> null.
 *
 * A surviving value is returned UNCHANGED so it can be used as an exact
 * primary-key lookup. The normalizer never queries a database and never needs to
 * know a specific production id.
 */
export function normalizeAdminCourseCookieValue(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  if (value.length === 0) {
    return null;
  }
  if (value.length > ADMIN_COURSE_COOKIE_MAX_VALUE_LENGTH) {
    return null;
  }
  // Surrounding whitespace (which includes the whitespace-only case, whose trim
  // differs from the original) is malformed - we do not trim it into a new id.
  if (value.trim() !== value) {
    return null;
  }
  if (CONTROL_CHARACTERS.test(value)) {
    return null;
  }
  return value;
}

/**
 * Build the cookie attributes for SETTING the convenience cookie. `secure`
 * mirrors production; `maxAge` is the 30-day lifetime. No Domain attribute is
 * ever emitted.
 */
export function buildAdminCourseCookieAttributes(opts: {
  isProduction: boolean;
}): AdminCourseCookieAttributes {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: opts.isProduction,
    path: ADMIN_COURSE_COOKIE_PATH,
    maxAge: ADMIN_COURSE_COOKIE_MAX_AGE_SECONDS,
  };
}

/**
 * Build the cookie attributes for CLEARING the convenience cookie: identical
 * name/path/flags but `maxAge` 0, so the browser drops it. Emitting the same
 * path (/admin) is what makes the deletion actually match the cookie that was
 * set - a mismatched path would leave a stale cookie behind.
 */
export function buildAdminCourseCookieClearAttributes(opts: {
  isProduction: boolean;
}): AdminCourseCookieAttributes {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: opts.isProduction,
    path: ADMIN_COURSE_COOKIE_PATH,
    maxAge: 0,
  };
}

/**
 * Thrown by the setter when asked to remember an invalid id. Its human-readable
 * message is generic and stable - it NEVER interpolates or reflects the supplied
 * value, so accidental serialization cannot echo arbitrary cookie input back to
 * a client. It carries only a stable, non-PII reason code as structured data.
 */
export class InvalidAdminCourseCookieValueError extends Error {
  readonly code = "INVALID_ADMIN_COURSE_COOKIE_VALUE" as const;

  constructor() {
    super("Invalid admin course selection.");
    this.name = "InvalidAdminCourseCookieValueError";
  }
}

/**
 * Injected dependency for the redirect-candidate resolver: the committed Slice 1
 * exact-id reader. Passing it in keeps this helper pure and DB-free in tests,
 * and structurally prevents it from ever reaching the singleton resolver, the
 * auth stack or a write path - it can only perform ONE exact-id lookup.
 */
export interface RememberedAdminCourseRedirectDeps {
  getCourseOfferingById: (id: string) => Promise<CourseOfferingView | null>;
}

/**
 * Validate the remembered convenience cookie ONLY well enough to choose a
 * candidate redirect target for a future generic admin route. This is NOT
 * authorization:
 *   - invalid/missing cookie           -> null, with ZERO lookups;
 *   - valid-looking but nonexistent    -> null, after exactly ONE exact lookup;
 *   - existing PLANNED/ACTIVE/ARCHIVED -> the narrow offering view (ARCHIVED is
 *                                         returned for historical continuity).
 *
 * It never selects another offering, never calls the singleton resolver, never
 * authorizes an actor or a write, and never builds a path by concatenating raw
 * input - it returns the looked-up offering view (or null) and nothing else. A
 * future route must still requireAdmin(), use this only to pick a candidate URL,
 * redirect to an explicit URL, and let the destination independently run
 * requireAdminCourseOffering(id).
 */
export async function resolveRememberedAdminCourseForRedirectWithDeps(
  rawCookieValue: unknown,
  deps: RememberedAdminCourseRedirectDeps,
): Promise<CourseOfferingView | null> {
  const normalized = normalizeAdminCourseCookieValue(rawCookieValue);
  if (normalized === null) {
    return null; // no lookup for a malformed/missing cookie
  }
  // At most one exact-id lookup; a not-found offering fails closed to null.
  return await deps.getCourseOfferingById(normalized);
}
