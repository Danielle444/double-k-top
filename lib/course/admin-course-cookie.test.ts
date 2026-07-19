/**
 * MULTI-COURSE (dormant foundation, Slice 3) - executable tests for the SERVER
 * admin CourseOffering convenience-cookie wrappers.
 *
 * Run with: npx tsx --test lib/course/admin-course-cookie.test.ts
 *
 * DB-FREE and BROWSER-FREE: the injectable store-orchestration seams are
 * exercised through a FAKE cookie store and an injected exact-id lookup. The
 * concrete `cookies()` next/headers path is deliberately never invoked here (it
 * requires a live request context), matching the repo's approach of testing the
 * injectable orchestration rather than mocking next/headers.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { CourseOfferingView } from "./offering-by-id-core";
import type { AdminCourseCookieAttributes } from "./admin-course-cookie-core";
import { InvalidAdminCourseCookieValueError } from "./admin-course-cookie-core";
import {
  readRememberedAdminCourseOfferingIdFromStore,
  setRememberedAdminCourseOfferingIdOnStore,
  clearRememberedAdminCourseOfferingIdOnStore,
  resolveRememberedAdminCourseForRedirectFromStore,
} from "./admin-course-cookie";

const CUID_LIKE = "cmr6pj73o000reccntxj563gs";

interface RecordedSet {
  name: string;
  value: string;
  attributes: AdminCourseCookieAttributes;
}

/**
 * A minimal fake of Next's request cookie store. Records every name read and
 * every cookie written so tests can assert the wrappers touch ONLY
 * `dk_admin_course`.
 */
class FakeCookieStore {
  readonly gets: string[] = [];
  readonly sets: RecordedSet[] = [];
  private readonly values = new Map<string, string>();

  constructor(seed: Record<string, string> = {}) {
    for (const [name, value] of Object.entries(seed)) {
      this.values.set(name, value);
    }
  }

  get(name: string): { value: string } | undefined {
    this.gets.push(name);
    const value = this.values.get(name);
    return value === undefined ? undefined : { value };
  }

  set(name: string, value: string, attributes: AdminCourseCookieAttributes): void {
    this.sets.push({ name, value, attributes });
    this.values.set(name, value);
  }
}

function offering(over: Partial<CourseOfferingView> = {}): CourseOfferingView {
  return {
    id: CUID_LIKE,
    activityYearId: "year-1",
    name: "קורס מדריכים ומאמנים – רמה 1",
    level: 1,
    startDate: new Date("2026-07-05T00:00:00.000Z"),
    endDate: new Date("2026-07-31T00:00:00.000Z"),
    status: "ACTIVE",
    ...over,
  };
}

// --- 1. read accesses only dk_admin_course -----------------------------------

test("read accesses ONLY dk_admin_course and returns its normalized value", () => {
  const store = new FakeCookieStore({
    dk_admin_course: CUID_LIKE,
    dk_sess_instructor: "should-never-be-read",
    dk_sess_trainee: "should-never-be-read",
  });
  const id = readRememberedAdminCourseOfferingIdFromStore(store);
  assert.equal(id, CUID_LIKE);
  assert.deepEqual(store.gets, ["dk_admin_course"]);
  assert.equal(store.sets.length, 0, "read performs no write");
});

// --- 2. invalid stored value returns null ------------------------------------

test("an invalid stored value normalizes to null", () => {
  const store = new FakeCookieStore({ dk_admin_course: "   " });
  assert.equal(readRememberedAdminCourseOfferingIdFromStore(store), null);
});

test("a missing cookie returns null", () => {
  const store = new FakeCookieStore({});
  assert.equal(readRememberedAdminCourseOfferingIdFromStore(store), null);
  assert.deepEqual(store.gets, ["dk_admin_course"]);
});

// --- 3. set writes exactly one cookie with the approved attributes -----------

test("set writes exactly one cookie: dk_admin_course with approved attributes", () => {
  const store = new FakeCookieStore({});
  setRememberedAdminCourseOfferingIdOnStore(store, CUID_LIKE, { isProduction: true });
  assert.equal(store.sets.length, 1);
  const [written] = store.sets;
  assert.equal(written.name, "dk_admin_course");
  assert.equal(written.value, CUID_LIKE);
  assert.deepEqual(written.attributes, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/admin",
    maxAge: 2_592_000,
  });
  assert.ok(!("domain" in written.attributes), "no Domain attribute");
});

test("set outside production relaxes only `secure`", () => {
  const store = new FakeCookieStore({});
  setRememberedAdminCourseOfferingIdOnStore(store, CUID_LIKE, { isProduction: false });
  assert.equal(store.sets[0].attributes.secure, false);
  assert.equal(store.sets[0].attributes.path, "/admin");
  assert.equal(store.sets[0].attributes.maxAge, 2_592_000);
});

test("set rejects invalid input with the typed error and writes NOTHING", () => {
  const store = new FakeCookieStore({});
  assert.throws(
    () => setRememberedAdminCourseOfferingIdOnStore(store, "   ", { isProduction: true }),
    (err: unknown) => {
      assert.ok(err instanceof InvalidAdminCourseCookieValueError);
      assert.equal(err.message, "Invalid admin course selection.");
      assert.doesNotMatch(err.message, /\s{3}/); // does not echo the whitespace input
      return true;
    },
  );
  assert.equal(store.sets.length, 0, "no cookie is written on invalid input");
});

// --- 4. clear targets only dk_admin_course at /admin -------------------------

test("clear overwrites only dk_admin_course at /admin with maxAge 0", () => {
  const store = new FakeCookieStore({ dk_admin_course: CUID_LIKE });
  clearRememberedAdminCourseOfferingIdOnStore(store, { isProduction: true });
  assert.equal(store.sets.length, 1);
  const [cleared] = store.sets;
  assert.equal(cleared.name, "dk_admin_course");
  assert.equal(cleared.value, "");
  assert.equal(cleared.attributes.path, "/admin");
  assert.equal(cleared.attributes.maxAge, 0);
  assert.equal(cleared.attributes.secure, true);
});

// --- 5. no identity cookie name appears in the implementation ----------------

test("the wrapper and core implementations name no identity/session cookie", () => {
  const forbidden = [
    "dk_sess_instructor",
    "dk_sess_trainee",
    "next-auth",
    "authjs",
    "__Secure-",
    "__Host-",
  ];
  for (const rel of ["./admin-course-cookie.ts", "./admin-course-cookie-core.ts"]) {
    const source = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
    for (const name of forbidden) {
      assert.ok(
        !source.includes(name),
        `${rel} must not reference the identity cookie name "${name}"`,
      );
    }
    // The only cookie name it may reference is dk_admin_course.
    assert.ok(source.includes("dk_admin_course"));
  }
});

// --- 6. redirect resolver uses the exact-id seam; no authorization/write ------

test("redirect resolver uses the injected exact-id lookup and performs no write", async () => {
  const lookedUp: string[] = [];
  const view = offering();
  const store = new FakeCookieStore({ dk_admin_course: CUID_LIKE });
  const result = await resolveRememberedAdminCourseForRedirectFromStore(store, {
    getCourseOfferingById: async (id: string) => {
      lookedUp.push(id);
      return id === CUID_LIKE ? view : null;
    },
  });
  assert.deepEqual(result, view);
  assert.deepEqual(lookedUp, [CUID_LIKE], "exactly one exact-id lookup");
  assert.deepEqual(store.gets, ["dk_admin_course"], "reads only dk_admin_course");
  assert.equal(store.sets.length, 0, "redirect resolution performs no write");
});

test("redirect resolver returns null for a malformed cookie without any lookup", async () => {
  const lookedUp: string[] = [];
  const store = new FakeCookieStore({ dk_admin_course: "   " });
  const result = await resolveRememberedAdminCourseForRedirectFromStore(store, {
    getCourseOfferingById: async (id: string) => {
      lookedUp.push(id);
      return offering();
    },
  });
  assert.equal(result, null);
  assert.deepEqual(lookedUp, [], "no lookup for a malformed cookie");
  assert.equal(store.sets.length, 0);
});
