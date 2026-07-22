/**
 * ATT-4V — focused tests for the PURE instructor ATTENDANCE navigation-visibility
 * core (instructor-attendance-nav-core.ts).
 *
 * PURE: no Prisma, no DB, no cookies, no env, no React render. The visibility
 * reducer is exercised with plain injected access fixtures / a throwing resolver;
 * the item filter is exercised over navigation arrays shaped like the two real
 * instructor sources (the "עוד" menu and the "today" quick-nav grid).
 *
 * Uses the existing `tsx` + node:test approach. Run with:
 *   npx tsx --test lib/course/capabilities/instructor-attendance-nav-core.test.ts
 *
 * Contract locked here:
 *  - canView (NOT canRead / canWrite / the status string) governs visibility;
 *  - ENABLED and READ_ONLY show the entry (READ_ONLY shows it despite canWrite=false);
 *  - DISABLED and every fail-closed denial (DENIED_MISSING_CONTEXT /
 *    DENIED_UNKNOWN_STATUS) hide it;
 *  - a resolver REJECTION (missing/ambiguous offering, infrastructure failure)
 *    fails closed to hidden and is never propagated or converted into visible;
 *  - no client-supplied offering identity is accepted (the resolver is a
 *    parameterless injected dependency; the reducer takes only `deps`);
 *  - the filter removes only the attendance entry, preserves every other item and
 *    the exact ordering, and never leaves a duplicate.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveInstructorAttendanceNavVisibilityWithDeps,
  filterInstructorAttendanceNavItems,
  ATTENDANCE_NAV_ID,
  type InstructorAttendanceNavVisibilityDeps,
} from "./instructor-attendance-nav-core";
import type { AttendanceCapabilityAccess } from "./attendance-capability-policy-core";

// --- access fixtures (the exact shapes the ATT-1 policy / ATT-2 resolver emit) --

function enabledAccess(): AttendanceCapabilityAccess {
  return { status: "ENABLED", canView: true, canRead: true, canWrite: true, reason: "ENABLED" };
}
function readOnlyAccess(): AttendanceCapabilityAccess {
  return { status: "READ_ONLY", canView: true, canRead: true, canWrite: false, reason: "READ_ONLY" };
}
function disabledAccess(): AttendanceCapabilityAccess {
  return { status: "DISABLED", canView: false, canRead: false, canWrite: false, reason: "DISABLED" };
}
function deniedMissingContextAccess(): AttendanceCapabilityAccess {
  return { status: null, canView: false, canRead: false, canWrite: false, reason: "DENIED_MISSING_CONTEXT" };
}
function deniedUnknownStatusAccess(): AttendanceCapabilityAccess {
  return { status: null, canView: false, canRead: false, canWrite: false, reason: "DENIED_UNKNOWN_STATUS" };
}

// --- nav fixtures (shaped like the two real instructor sources) --------------

type NavItem = { id: string; label: string };

// Mirrors INSTRUCTOR_MORE_ITEMS: attendance sits among unrelated items.
function moreItemsFixture(): NavItem[] {
  return [
    { id: "horses", label: "סוסים" },
    { id: "profile", label: "פרופיל" },
    { id: "attendance", label: "נוכחות" },
    { id: "messages", label: "הודעות ומשימות" },
    { id: "contacts", label: "אנשי קשר" },
    { id: "materials", label: "חומרי קורס" },
    { id: "notifications", label: "עדכונים" },
    { id: "teachingPractice", label: "התנסויות מתחילים" },
    { id: "help", label: "עזרה" },
  ];
}

// Mirrors the combined "today" quick-nav grid (activity + info shortcuts).
function homeShortcutsFixture(): NavItem[] {
  return [
    { id: "riding", label: "רכיבות" },
    { id: "schedule", label: 'לו"ז' },
    { id: "duties", label: "תורנויות" },
    { id: "horses", label: "סוסים" },
    { id: "teachingPractice", label: "התנסויות מתחילים" },
    { id: "messages", label: "הודעות ומשימות" },
    { id: "contacts", label: "אנשי קשר" },
    { id: "materials", label: "חומרי קורס" },
    { id: "attendance", label: "נוכחות" },
    { id: "profile", label: "פרופיל" },
  ];
}

const ids = (items: NavItem[]) => items.map((i) => i.id);

// ===========================================================================
// Visibility reducer — canView governs, fail-closed on denial and rejection
// ===========================================================================

test("visibility: ENABLED resolves to visible (canView=true)", async () => {
  const deps: InstructorAttendanceNavVisibilityDeps = {
    resolveAttendanceAccess: async () => enabledAccess(),
  };
  assert.equal(await resolveInstructorAttendanceNavVisibilityWithDeps(deps), true);
});

test("visibility: READ_ONLY resolves to visible despite canWrite=false", async () => {
  const deps: InstructorAttendanceNavVisibilityDeps = {
    resolveAttendanceAccess: async () => readOnlyAccess(),
  };
  assert.equal(
    await resolveInstructorAttendanceNavVisibilityWithDeps(deps),
    true,
    "READ_ONLY (canView=true) must not be hidden merely because canWrite is false",
  );
});

test("visibility: DISABLED resolves to hidden (canView=false)", async () => {
  const deps: InstructorAttendanceNavVisibilityDeps = {
    resolveAttendanceAccess: async () => disabledAccess(),
  };
  assert.equal(await resolveInstructorAttendanceNavVisibilityWithDeps(deps), false);
});

test("visibility: DENIED_MISSING_CONTEXT / DENIED_UNKNOWN_STATUS resolve to hidden", async () => {
  for (const access of [deniedMissingContextAccess(), deniedUnknownStatusAccess()]) {
    const deps: InstructorAttendanceNavVisibilityDeps = {
      resolveAttendanceAccess: async () => access,
    };
    assert.equal(
      await resolveInstructorAttendanceNavVisibilityWithDeps(deps),
      false,
      `${access.reason} must fail closed to hidden`,
    );
  }
});

test("visibility: a rejecting resolver (missing/ambiguous offering, infra failure) fails closed to hidden — never propagates", async () => {
  const boom = new Error("current offering / capability loader failed");
  const deps: InstructorAttendanceNavVisibilityDeps = {
    resolveAttendanceAccess: async () => {
      throw boom;
    },
  };
  // Must NOT throw (would 500 the surrounding instructor layout) and must NOT
  // become visible; the failure is converted into omission for this one item.
  const visible = await resolveInstructorAttendanceNavVisibilityWithDeps(deps);
  assert.equal(visible, false, "an unresolved capability never advertises attendance");
});

test("visibility: canView is authoritative — a permissive canRead/canWrite cannot force visibility", async () => {
  // A (contrived) malformed access whose canView is false but canRead/canWrite
  // are true must still hide: only canView is consulted.
  const deps: InstructorAttendanceNavVisibilityDeps = {
    resolveAttendanceAccess: async () =>
      ({ status: null, canView: false, canRead: true, canWrite: true, reason: "DENIED_UNKNOWN_STATUS" } as AttendanceCapabilityAccess),
  };
  assert.equal(await resolveInstructorAttendanceNavVisibilityWithDeps(deps), false);
});

test("visibility: no client-supplied offering identity is accepted (parameterless injected resolver)", async () => {
  let observedArgs: unknown[] | null = null;
  const deps: InstructorAttendanceNavVisibilityDeps = {
    resolveAttendanceAccess: async (...args: unknown[]) => {
      observedArgs = args;
      return enabledAccess();
    },
  };
  await resolveInstructorAttendanceNavVisibilityWithDeps(deps);
  assert.deepEqual(observedArgs, [], "the resolver is invoked with no offering id / actor / client value");
  // Compile-time + runtime guarantee: the reducer's arity is (deps) only — there
  // is no courseOfferingId (or any client identity) parameter.
  assert.equal(resolveInstructorAttendanceNavVisibilityWithDeps.length, 1);
});

// ===========================================================================
// Item filter — hide exactly the attendance entry, preserve everything else
// ===========================================================================

test('filter: canView=true keeps the "עוד" menu attendance entry exactly once, order preserved', () => {
  const items = moreItemsFixture();
  const result = filterInstructorAttendanceNavItems(items, true);
  assert.equal(result, items, "true returns the original array reference unchanged");
  assert.deepEqual(ids(result), ids(moreItemsFixture()), "ordering is preserved");
  assert.equal(result.filter((i) => i.id === ATTENDANCE_NAV_ID).length, 1, "attendance present exactly once");
  const attendance = result.find((i) => i.id === ATTENDANCE_NAV_ID);
  assert.equal(attendance?.label, "נוכחות", "the attendance label is preserved");
});

test('filter: canView=false removes attendance from the "עוד" menu, all unrelated items and order unchanged', () => {
  const result = filterInstructorAttendanceNavItems(moreItemsFixture(), false);
  assert.equal(result.some((i) => i.id === ATTENDANCE_NAV_ID), false, "attendance entry is absent");
  assert.deepEqual(
    ids(result),
    ["horses", "profile", "messages", "contacts", "materials", "notifications", "teachingPractice", "help"],
    "every other item remains in the same relative order",
  );
});

test("filter: canView=true keeps the home quick-nav attendance shortcut once, order preserved", () => {
  const items = homeShortcutsFixture();
  const result = filterInstructorAttendanceNavItems(items, true);
  assert.deepEqual(ids(result), ids(homeShortcutsFixture()));
  assert.equal(result.filter((i) => i.id === ATTENDANCE_NAV_ID).length, 1);
});

test("filter: canView=false removes attendance from the home quick-nav grid, others unchanged", () => {
  const result = filterInstructorAttendanceNavItems(homeShortcutsFixture(), false);
  assert.equal(result.some((i) => i.id === ATTENDANCE_NAV_ID), false);
  assert.deepEqual(
    ids(result),
    ["riding", "schedule", "duties", "horses", "teachingPractice", "messages", "contacts", "materials", "profile"],
  );
});

test("filter: attendance never survives twice — a doubly-composed attendance entry is fully removed", () => {
  const doubled: NavItem[] = [
    { id: "profile", label: "פרופיל" },
    { id: "attendance", label: "נוכחות" },
    { id: "help", label: "עזרה" },
    { id: "attendance", label: "נוכחות" },
  ];
  const hidden = filterInstructorAttendanceNavItems(doubled, false);
  assert.equal(hidden.some((i) => i.id === ATTENDANCE_NAV_ID), false, "no attendance entry remains");
  assert.deepEqual(ids(hidden), ["profile", "help"]);
});

test("filter: an array with no attendance entry is returned unchanged in both modes", () => {
  const noAttendance: NavItem[] = [
    { id: "horses", label: "סוסים" },
    { id: "help", label: "עזרה" },
  ];
  assert.deepEqual(ids(filterInstructorAttendanceNavItems(noAttendance, true)), ["horses", "help"]);
  assert.deepEqual(ids(filterInstructorAttendanceNavItems(noAttendance, false)), ["horses", "help"]);
});
