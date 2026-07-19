/**
 * MULTI-COURSE (dormant foundation, Slice 3) - executable tests for the PURE
 * admin CourseOffering convenience-cookie core.
 *
 * Run with: npx tsx --test lib/course/admin-course-cookie-core.test.ts
 * PURE: no Prisma, no DB, no next/headers, no cookies(), no auth, no env, no
 * clock, no randomness. The redirect resolver is exercised through an injected
 * fake lookup, so no real browser or database is ever touched.
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { CourseOfferingView } from "./offering-by-id-core";
import {
  ADMIN_COURSE_COOKIE_NAME,
  ADMIN_COURSE_COOKIE_PATH,
  ADMIN_COURSE_COOKIE_MAX_AGE_SECONDS,
  ADMIN_COURSE_COOKIE_MAX_VALUE_LENGTH,
  normalizeAdminCourseCookieValue,
  buildAdminCourseCookieAttributes,
  buildAdminCourseCookieClearAttributes,
  resolveRememberedAdminCourseForRedirectWithDeps,
  InvalidAdminCourseCookieValueError,
  type RememberedAdminCourseRedirectDeps,
} from "./admin-course-cookie-core";

// A conservative, CUID-like id that is NOT any specific production id.
const CUID_LIKE = "cmr6pj73o000reccntxj563gs";

/** Build a string with an embedded control character, without a literal one in source. */
function withControlChar(code: number): string {
  return `ab${String.fromCharCode(code)}cd`;
}

function offering(over: Partial<CourseOfferingView> = {}): CourseOfferingView {
  return {
    id: CUID_LIKE,
    activityYearId: "year-1",
    name: "קורס מדריכים ומאמנים – רמה 1",
    level: 1,
    startDate: new Date("2026-07-05T00:00:00.000Z"),
    endDate: new Date("2026-07-31T00:00:00.000Z"),
    status: "PLANNED",
    ...over,
  };
}

/** A counting fake for the injected exact-id lookup. */
function makeLookup(table: Map<string, CourseOfferingView>): {
  deps: RememberedAdminCourseRedirectDeps;
  lookedUp: string[];
} {
  const lookedUp: string[] = [];
  const deps: RememberedAdminCourseRedirectDeps = {
    getCourseOfferingById: async (id: string) => {
      lookedUp.push(id);
      return table.get(id) ?? null;
    },
  };
  return { deps, lookedUp };
}

// --- A. constants ------------------------------------------------------------

test("cookie name is exactly dk_admin_course", () => {
  assert.equal(ADMIN_COURSE_COOKIE_NAME, "dk_admin_course");
});

test("cookie path is exactly /admin (never /)", () => {
  assert.equal(ADMIN_COURSE_COOKIE_PATH, "/admin");
  assert.notEqual(ADMIN_COURSE_COOKIE_PATH, "/");
});

test("max age is exactly 30 days in seconds", () => {
  assert.equal(ADMIN_COURSE_COOKIE_MAX_AGE_SECONDS, 2_592_000);
  assert.equal(ADMIN_COURSE_COOKIE_MAX_AGE_SECONDS, 30 * 24 * 60 * 60);
});

// --- B. normalization --------------------------------------------------------

test("a valid conservative CUID-like id is accepted unchanged", () => {
  assert.equal(normalizeAdminCourseCookieValue(CUID_LIKE), CUID_LIKE);
});

test("empty string is invalid (null)", () => {
  assert.equal(normalizeAdminCourseCookieValue(""), null);
});

test("whitespace-only value is invalid (null)", () => {
  assert.equal(normalizeAdminCourseCookieValue("   "), null);
  assert.equal(normalizeAdminCourseCookieValue("\t\n "), null);
});

test("leading/trailing whitespace is malformed, not silently trimmed (null)", () => {
  assert.equal(normalizeAdminCourseCookieValue(` ${CUID_LIKE}`), null);
  assert.equal(normalizeAdminCourseCookieValue(`${CUID_LIKE} `), null);
  assert.equal(normalizeAdminCourseCookieValue(`\t${CUID_LIKE}\n`), null);
});

test("non-string runtime values are invalid (null)", () => {
  const cases: unknown[] = [
    undefined,
    null,
    123,
    true,
    {},
    [],
    Symbol("x"),
    () => CUID_LIKE,
  ];
  for (const value of cases) {
    assert.equal(normalizeAdminCourseCookieValue(value), null);
  }
});

test("values containing control characters are invalid (null)", () => {
  for (const code of [0x00, 0x09, 0x0a, 0x0d, 0x1f, 0x7f, 0x9f]) {
    assert.equal(
      normalizeAdminCourseCookieValue(withControlChar(code)),
      null,
      `control char 0x${code.toString(16)} must be rejected`,
    );
  }
});

test("an excessively long value is invalid (null); a value at the max length is accepted", () => {
  const tooLong = "a".repeat(ADMIN_COURSE_COOKIE_MAX_VALUE_LENGTH + 1);
  assert.equal(normalizeAdminCourseCookieValue(tooLong), null);

  const atMax = "a".repeat(ADMIN_COURSE_COOKIE_MAX_VALUE_LENGTH);
  assert.equal(normalizeAdminCourseCookieValue(atMax), atMax);
});

// --- C. set attributes -------------------------------------------------------

test("set attributes outside production: httpOnly, lax, secure=false, path /admin, 30d, no Domain", () => {
  const attrs = buildAdminCourseCookieAttributes({ isProduction: false });
  assert.equal(attrs.httpOnly, true);
  assert.equal(attrs.sameSite, "lax");
  assert.equal(attrs.secure, false);
  assert.equal(attrs.path, "/admin");
  assert.equal(attrs.maxAge, 2_592_000);
  assert.ok(!("domain" in attrs), "no Domain attribute is emitted");
});

test("set attributes in production: secure=true (only secure changes)", () => {
  const attrs = buildAdminCourseCookieAttributes({ isProduction: true });
  assert.equal(attrs.secure, true);
  assert.equal(attrs.httpOnly, true);
  assert.equal(attrs.sameSite, "lax");
  assert.equal(attrs.path, "/admin");
  assert.equal(attrs.maxAge, 2_592_000);
  assert.ok(!("domain" in attrs));
});

// --- D. clear attributes -----------------------------------------------------

test("clear attributes target the same path /admin with maxAge 0", () => {
  const dev = buildAdminCourseCookieClearAttributes({ isProduction: false });
  assert.equal(dev.path, "/admin");
  assert.equal(dev.maxAge, 0);
  assert.equal(dev.httpOnly, true);
  assert.equal(dev.sameSite, "lax");
  assert.equal(dev.secure, false);
  assert.ok(!("domain" in dev));

  const prod = buildAdminCourseCookieClearAttributes({ isProduction: true });
  assert.equal(prod.path, "/admin");
  assert.equal(prod.maxAge, 0);
  assert.equal(prod.secure, true);
});

test("clear attributes share the set attributes' path (same cookie identity)", () => {
  const set = buildAdminCourseCookieAttributes({ isProduction: true });
  const clear = buildAdminCourseCookieClearAttributes({ isProduction: true });
  // Same path is what makes clear actually match the cookie that was set.
  assert.equal(clear.path, set.path);
  assert.equal(clear.maxAge, 0);
});

// --- E. typed invalid-value error (generic, non-reflective) ------------------

test("the typed error carries a stable code and a generic message", () => {
  const err = new InvalidAdminCourseCookieValueError();
  assert.equal(err.code, "INVALID_ADMIN_COURSE_COOKIE_VALUE");
  assert.equal(err.name, "InvalidAdminCourseCookieValueError");
  assert.equal(err.message, "Invalid admin course selection.");
  assert.ok(err instanceof Error);
});

test("the error message reflects no arbitrary input", () => {
  const arbitrary = "PWN'; DROP TABLE offerings;--   <script>";
  const err = new InvalidAdminCourseCookieValueError();
  // The message is constant; it can never echo whatever value was rejected.
  assert.doesNotMatch(err.message, /DROP TABLE/);
  assert.doesNotMatch(err.message, /script/);
  assert.ok(!err.message.includes(arbitrary));
});

// --- F. redirect candidate resolver (injected exact-id lookup) ---------------

test("missing/invalid cookie -> null with ZERO lookups", async () => {
  const { deps, lookedUp } = makeLookup(new Map([[CUID_LIKE, offering()]]));
  assert.equal(await resolveRememberedAdminCourseForRedirectWithDeps(undefined, deps), null);
  assert.equal(await resolveRememberedAdminCourseForRedirectWithDeps("", deps), null);
  assert.equal(await resolveRememberedAdminCourseForRedirectWithDeps("   ", deps), null);
  assert.equal(await resolveRememberedAdminCourseForRedirectWithDeps(` ${CUID_LIKE}`, deps), null);
  assert.equal(await resolveRememberedAdminCourseForRedirectWithDeps(42 as unknown, deps), null);
  assert.deepEqual(lookedUp, [], "a malformed/missing cookie must trigger no lookup");
});

test("valid-looking but nonexistent cookie -> null after exactly ONE exact lookup", async () => {
  const { deps, lookedUp } = makeLookup(new Map());
  const result = await resolveRememberedAdminCourseForRedirectWithDeps(CUID_LIKE, deps);
  assert.equal(result, null);
  assert.deepEqual(lookedUp, [CUID_LIKE]);
});

test("existing PLANNED / ACTIVE / ARCHIVED offerings are each returned (one lookup each)", async () => {
  for (const status of ["PLANNED", "ACTIVE", "ARCHIVED"] as const) {
    const view = offering({ status });
    const { deps, lookedUp } = makeLookup(new Map([[CUID_LIKE, view]]));
    const result = await resolveRememberedAdminCourseForRedirectWithDeps(CUID_LIKE, deps);
    assert.deepEqual(result, view);
    assert.equal(result?.status, status);
    assert.deepEqual(lookedUp, [CUID_LIKE]);
  }
});

test("resolver never falls back to another offering and never looks up twice", async () => {
  const requested = offering({ id: CUID_LIKE });
  const other = offering({ id: "other-offering-id", status: "ACTIVE" });
  const { deps, lookedUp } = makeLookup(
    new Map([
      [CUID_LIKE, requested],
      ["other-offering-id", other],
    ]),
  );
  // Cookie points at a nonexistent id: the resolver must NOT substitute `other`.
  const result = await resolveRememberedAdminCourseForRedirectWithDeps("missing-id", deps);
  assert.equal(result, null);
  assert.deepEqual(lookedUp, ["missing-id"], "exactly one exact-id lookup, no fallback");
});
