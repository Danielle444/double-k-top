/**
 * MULTI-COURSE W5B1 / LEVEL 2 SLICE C0-B - focused tests for the enrollment-backed,
 * COURSE-SCOPED student contact directory (lib/actions/contacts.ts ->
 * getStudentContacts).
 *
 * These exercise the dependency-injected orchestration `loadStudentContactsWithDeps`
 * with plain fakes, so no Next.js cookies and no live Prisma are needed. They lock
 * the contract:
 *  - authorization is preserved exactly (getCurrentInstructor -> mayAccess -> []);
 *  - a trainee / anonymous caller (null instructor actor) gets [];
 *  - course context is EXPLICITLY REQUESTED and re-validated server-side: a
 *    missing/blank or disallowed offering denies with [], while a configured but
 *    UNAVAILABLE offering fails loudly;
 *  - every downstream read receives the RESOLVED offering id, never the requested
 *    string (the cross-course guarantee);
 *  - the roster instant is the locked max(now, startDate) policy;
 *  - the roster source is the enrollment DAL, mapped to the EXACT StudentContactRow
 *    shape in the reviewed W5B0 order;
 *  - membership anomalies and duplicate ids FAIL LOUDLY at the chosen instant and
 *    never fall back to the legacy global roster.
 *
 * Uses the existing `tsx` + node:test approach. Run with:
 *   npx tsx --test lib/actions/contacts.student-directory.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// The dependency-injected orchestration is imported from the NON-"use server"
// core module (never from ./contacts), so these pure tests never pull in
// Next.js cookie/session code or Prisma. The public server actions
// getStudentContacts / getInstructorContacts still come from ./contacts.
import {
  loadStudentContactsWithDeps,
  resolveRosterAsOf,
  type StudentContactsDeps,
} from "./contacts-student-directory";
import {
  getStudentContacts,
  getInstructorContacts,
  type StudentContactRow,
} from "./contacts";
import type {
  EnrolledTraineeView,
  EnrollmentRosterResult,
  EnrollmentMembershipAnomaly,
} from "@/lib/course/enrollment-view";
import {
  MissingInstructorCourseOfferingIdError,
  InstructorCourseOfferingNotAllowedError,
  InstructorCourseOfferingUnavailableError,
} from "@/lib/course/actor-course-offering-core";
import { CAPABILITY_KEYS, type CapabilityKey } from "@/lib/course/capabilities/capability-keys";
import type { EffectiveCapabilityStatus } from "@/lib/course/capabilities/effective-capability-core";

const AS_OF = new Date("2026-07-19T12:00:00.000Z");

// The requested id and the resolved id are deliberately DIFFERENT everywhere in
// this suite. The requested string is what a client could influence; the resolved
// id is what the server proved. Every downstream assertion below checks the
// RESOLVED one, so any code path that leaked the requested string through would
// fail loudly instead of coincidentally passing.
const REQUESTED_OFFERING_ID = "offering-REQUESTED";
const RESOLVED_OFFERING_ID = "offering-RESOLVED";

/** A start date safely BEFORE AS_OF: the already-started (Level 1-like) case. */
const STARTED_START_DATE = new Date("2026-01-05T00:00:00.000Z");

// --- fixtures ---------------------------------------------------------------

function traineeView(
  id: string,
  groupName: string | null,
  subgroupNumber: number | null,
  lastName: string,
  phone: string | null = null,
): EnrolledTraineeView {
  return {
    id,
    fullName: `full ${id}`,
    lastName,
    phone,
    groupName,
    subgroupNumber,
    enrollmentStatus: "ACTIVE",
    isPrimary: false,
  };
}

function roster(
  rows: EnrolledTraineeView[],
  anomalies: EnrollmentMembershipAnomaly[] = [],
): EnrollmentRosterResult {
  return { rows, anomalies };
}

// Exhaustive all-ENABLED effective map, written as an explicit object literal
// annotated Record<CapabilityKey, EffectiveCapabilityStatus>. TypeScript rejects
// this literal at COMPILE TIME if any canonical key is missing, so it is a
// genuinely exhaustive fixture with NO `as any` / partial / suppressing cast (an
// Object.fromEntries build over CAPABILITY_KEYS does not type-check here: its
// index-signature result is not assignable to the specific-key Record — TS2740).
// This mirrors the app's own exhaustive-per-key pattern (INITIAL_CAPABILITY_LABELS).
// The "fixture is exhaustive over CAPABILITY_KEYS" test below is the runtime
// tripwire that keeps this literal in lock-step with the canonical key set.
const ALL_ENABLED_CAPABILITIES: Record<CapabilityKey, EffectiveCapabilityStatus> = {
  SCHEDULE: "ENABLED",
  CONTACTS: "ENABLED",
  MESSAGES: "ENABLED",
  ATTENDANCE: "ENABLED",
  DUTIES: "ENABLED",
  RIDING: "ENABLED",
  PROGRESS_RIDING: "ENABLED",
  RIDING_HORSE_ASSIGNMENTS: "ENABLED",
  ADVANCED_INSTRUCTION: "ENABLED",
  TEACHING_PRACTICE: "ENABLED",
  COURSE_MATERIALS: "ENABLED",
};

// Every capability defaults to ENABLED so the pre-existing tests keep exercising
// their prior behaviour unchanged; each capability test overrides only the single
// key it exercises (e.g. { CONTACTS: "DISABLED" }).
function effectiveCapabilities(
  overrides: Partial<Record<CapabilityKey, EffectiveCapabilityStatus>> = {},
): Record<CapabilityKey, EffectiveCapabilityStatus> {
  return { ...ALL_ENABLED_CAPABILITIES, ...overrides };
}

function makeDeps(overrides: Partial<StudentContactsDeps> = {}): StudentContactsDeps {
  return {
    getCurrentInstructor: async () => ({ id: "instructor-1" }),
    resolveInstructorCourseOffering: async () => ({
      id: RESOLVED_OFFERING_ID,
      startDate: STARTED_START_DATE,
    }),
    getEffectiveCapabilities: async () => effectiveCapabilities(),
    getCurrentCourseEnrollmentRoster: async () => roster([]),
    now: () => AS_OF,
    ...overrides,
  };
}

const CONTACT_ROW_KEYS = [
  "fullName",
  "groupName",
  "id",
  "lastName",
  "phone",
  "subgroupNumber",
].sort();

// --- authorized mapping -----------------------------------------------------

test("authorized: maps the enrollment roster to StudentContactRow-compatible rows", async () => {
  const rows = await loadStudentContactsWithDeps(
    REQUESTED_OFFERING_ID,
    makeDeps({
      getCurrentCourseEnrollmentRoster: async () =>
        roster([
          traineeView("s1", "א", 1, "אבן", "050-1111111"),
          traineeView("s2", "ב", 2, "כהן", null),
        ]),
    }),
  );
  assert.deepEqual(rows, [
    { id: "s1", fullName: "full s1", lastName: "אבן", groupName: "א", subgroupNumber: 1, phone: "050-1111111" },
    { id: "s2", fullName: "full s2", lastName: "כהן", groupName: "ב", subgroupNumber: 2, phone: null },
  ]);
});

test("authorized: output rows carry EXACTLY the six contract keys (no extras)", async () => {
  const rows = await loadStudentContactsWithDeps(
    REQUESTED_OFFERING_ID,
    makeDeps({
      getCurrentCourseEnrollmentRoster: async () =>
        roster([traineeView("s1", "א", null, "אבן")]),
    }),
  );
  assert.equal(rows.length, 1);
  assert.deepEqual(Object.keys(rows[0]).sort(), CONTACT_ROW_KEYS);
});

test("authorized: null phone stays null; null subgroup stays null", async () => {
  const rows = await loadStudentContactsWithDeps(
    REQUESTED_OFFERING_ID,
    makeDeps({
      getCurrentCourseEnrollmentRoster: async () =>
        roster([traineeView("s1", "א", null, "אבן", null)]),
    }),
  );
  assert.equal(rows[0].phone, null);
  assert.equal(rows[0].subgroupNumber, null);
});

test("authorized: ordering is taken from the W5B0 roster and never re-sorted", async () => {
  // Rows arrive already sorted by compareTraineeView; the mapping must preserve
  // that exact order (here s2 before s1, deliberately not alphabetical by id).
  const rows = await loadStudentContactsWithDeps(
    REQUESTED_OFFERING_ID,
    makeDeps({
      getCurrentCourseEnrollmentRoster: async () =>
        roster([traineeView("s2", "א", 1, "אבן"), traineeView("s1", "ב", 1, "כהן")]),
    }),
  );
  assert.deepEqual(rows.map((r: StudentContactRow) => r.id), ["s2", "s1"]);
});

// --- explicit course context (C0-B) -----------------------------------------

test("the REQUESTED id is handed to the resolver verbatim (never pre-trimmed or rewritten)", async () => {
  let received: string | null = null;
  await loadStudentContactsWithDeps(
    "  offering-with-spaces  ",
    makeDeps({
      resolveInstructorCourseOffering: async (requestedId) => {
        received = requestedId;
        return { id: RESOLVED_OFFERING_ID, startDate: STARTED_START_DATE };
      },
    }),
  );
  // Normalization/rejection is the resolver's job, not this orchestration's.
  assert.equal(received, "  offering-with-spaces  ");
});

test("downstream reads receive the RESOLVED id, never the requested id", async () => {
  let capsOfferingId: string | null = null;
  let rosterOfferingId: string | null = null;
  await loadStudentContactsWithDeps(
    REQUESTED_OFFERING_ID,
    makeDeps({
      getEffectiveCapabilities: async (offeringId) => {
        capsOfferingId = offeringId;
        return effectiveCapabilities();
      },
      getCurrentCourseEnrollmentRoster: async (offeringId) => {
        rosterOfferingId = offeringId;
        return roster([]);
      },
    }),
  );
  assert.equal(capsOfferingId, RESOLVED_OFFERING_ID);
  assert.equal(rosterOfferingId, RESOLVED_OFFERING_ID);
  assert.notEqual(capsOfferingId, REQUESTED_OFFERING_ID);
  assert.notEqual(rosterOfferingId, REQUESTED_OFFERING_ID);
});

test("a MISSING/blank offering id denies with [] and reads nothing", async () => {
  let capsCalled = false;
  let rosterCalled = false;
  const rows = await loadStudentContactsWithDeps(
    "",
    makeDeps({
      resolveInstructorCourseOffering: async () => {
        throw new MissingInstructorCourseOfferingIdError();
      },
      getEffectiveCapabilities: async () => {
        capsCalled = true;
        return effectiveCapabilities();
      },
      getCurrentCourseEnrollmentRoster: async () => {
        rosterCalled = true;
        return roster([]);
      },
    }),
  );
  assert.deepEqual(rows, []);
  assert.equal(capsCalled, false, "must not read capabilities without a course context");
  assert.equal(rosterCalled, false, "must not read the roster without a course context");
});

test("a DISALLOWED offering id denies with [] (never substitutes another offering)", async () => {
  let rosterCalled = false;
  const rows = await loadStudentContactsWithDeps(
    "offering-not-in-policy",
    makeDeps({
      resolveInstructorCourseOffering: async () => {
        throw new InstructorCourseOfferingNotAllowedError("offering-not-in-policy");
      },
      getCurrentCourseEnrollmentRoster: async () => {
        rosterCalled = true;
        return roster([traineeView("s1", "א", 1, "אבן", "050-1111111")]);
      },
    }),
  );
  assert.deepEqual(rows, []);
  assert.equal(rosterCalled, false, "a refused course must never reach a PII read");
});

test("an UNAVAILABLE configured offering propagates (a real defect, never laundered into [])", async () => {
  let rosterCalled = false;
  await assert.rejects(
    () =>
      loadStudentContactsWithDeps(
        REQUESTED_OFFERING_ID,
        makeDeps({
          resolveInstructorCourseOffering: async () => {
            throw new InstructorCourseOfferingUnavailableError(REQUESTED_OFFERING_ID, "missing");
          },
          getCurrentCourseEnrollmentRoster: async () => {
            rosterCalled = true;
            return roster([]);
          },
        }),
      ),
    /unavailable \(missing\)/,
  );
  assert.equal(rosterCalled, false);
});

test("a NON-denial resolver failure propagates (never laundered into [])", async () => {
  await assert.rejects(
    () =>
      loadStudentContactsWithDeps(
        REQUESTED_OFFERING_ID,
        makeDeps({
          resolveInstructorCourseOffering: async () => {
            throw new Error("simulated Prisma failure");
          },
        }),
      ),
    /simulated Prisma failure/,
  );
});

test("strict call order: actor -> offering -> capability -> roster", async () => {
  const calls: string[] = [];
  await loadStudentContactsWithDeps(
    REQUESTED_OFFERING_ID,
    makeDeps({
      getCurrentInstructor: async () => {
        calls.push("actor");
        return { id: "instructor-1" };
      },
      resolveInstructorCourseOffering: async () => {
        calls.push("offering");
        return { id: RESOLVED_OFFERING_ID, startDate: STARTED_START_DATE };
      },
      getEffectiveCapabilities: async () => {
        calls.push("capability");
        return effectiveCapabilities();
      },
      getCurrentCourseEnrollmentRoster: async () => {
        calls.push("roster");
        return roster([]);
      },
    }),
  );
  assert.deepEqual(calls, ["actor", "offering", "capability", "roster"]);
});

// --- locked rosterAsOf policy: max(now, startDate) --------------------------

test("rosterAsOf: a FUTURE PLANNED offering is previewed at its startDate", async () => {
  const now = new Date("2026-07-25T00:00:00.000Z");
  const startDate = new Date("2026-07-26T00:00:00.000Z");
  let rosterAsOf: Date | null = null;
  await loadStudentContactsWithDeps(
    REQUESTED_OFFERING_ID,
    makeDeps({
      now: () => now,
      resolveInstructorCourseOffering: async () => ({ id: RESOLVED_OFFERING_ID, startDate }),
      getCurrentCourseEnrollmentRoster: async (_offeringId, options) => {
        rosterAsOf = options.asOf;
        return roster([]);
      },
    }),
  );
  assert.equal(rosterAsOf, startDate);
});

test("rosterAsOf: an ALREADY-STARTED offering uses now (Level 1 unchanged)", async () => {
  const now = new Date("2026-07-25T00:00:00.000Z");
  const startDate = new Date("2026-01-05T00:00:00.000Z");
  let rosterAsOf: Date | null = null;
  await loadStudentContactsWithDeps(
    REQUESTED_OFFERING_ID,
    makeDeps({
      now: () => now,
      resolveInstructorCourseOffering: async () => ({ id: RESOLVED_OFFERING_ID, startDate }),
      getCurrentCourseEnrollmentRoster: async (_offeringId, options) => {
        rosterAsOf = options.asOf;
        return roster([]);
      },
    }),
  );
  assert.equal(rosterAsOf, now);
});

test("rosterAsOf: a NULL startDate falls back to now (no date is ever fabricated)", async () => {
  const now = new Date("2026-07-25T00:00:00.000Z");
  let rosterAsOf: Date | null = null;
  await loadStudentContactsWithDeps(
    REQUESTED_OFFERING_ID,
    makeDeps({
      now: () => now,
      resolveInstructorCourseOffering: async () => ({
        id: RESOLVED_OFFERING_ID,
        startDate: null,
      }),
      getCurrentCourseEnrollmentRoster: async (_offeringId, options) => {
        rosterAsOf = options.asOf;
        return roster([]);
      },
    }),
  );
  assert.equal(rosterAsOf, now);
});

test("rosterAsOf: startDate EXACTLY equal to now uses now (strict > only)", () => {
  const now = new Date("2026-07-25T00:00:00.000Z");
  const sameInstant = new Date("2026-07-25T00:00:00.000Z");
  const chosen = resolveRosterAsOf({ id: RESOLVED_OFFERING_ID, startDate: sameInstant }, now);
  assert.equal(chosen, now, "a non-future startDate must not displace now");
});

test("rosterAsOf: the pure policy is exactly max(now, startDate)", () => {
  const now = new Date("2026-07-25T00:00:00.000Z");
  const future = new Date("2026-07-26T00:00:00.000Z");
  const past = new Date("2026-07-24T00:00:00.000Z");
  assert.equal(resolveRosterAsOf({ id: "o", startDate: future }, now), future);
  assert.equal(resolveRosterAsOf({ id: "o", startDate: past }, now), now);
  assert.equal(resolveRosterAsOf({ id: "o", startDate: null }, now), now);
});

test("rosterAsOf: a genuine anomaly AT the previewed instant still throws", async () => {
  // The policy shifts only the instant the roster is resolved at - it must NOT
  // soften anomaly handling. A trainee still broken at the offering's own start
  // date fails loudly exactly as at any other instant.
  const now = new Date("2026-07-25T00:00:00.000Z");
  const startDate = new Date("2026-07-26T00:00:00.000Z");
  const anomaly: EnrollmentMembershipAnomaly = {
    enrollmentId: "e9",
    studentId: "s9",
    kind: "NO_CURRENT_MEMBERSHIP",
    currentMembershipCount: 0,
  };
  await assert.rejects(
    () =>
      loadStudentContactsWithDeps(
        REQUESTED_OFFERING_ID,
        makeDeps({
          now: () => now,
          resolveInstructorCourseOffering: async () => ({ id: RESOLVED_OFFERING_ID, startDate }),
          getCurrentCourseEnrollmentRoster: async (_offeringId, options) => {
            assert.equal(options.asOf, startDate, "must be asked at the previewed instant");
            return roster([], [anomaly]);
          },
        }),
      ),
    /NO_CURRENT_MEMBERSHIP/,
  );
});

// --- authorization preserved ------------------------------------------------

test("unauthorized: a null instructor actor returns [] without touching the roster", async () => {
  let resolverCalled = false;
  let rosterCalled = false;
  const rows = await loadStudentContactsWithDeps(
    REQUESTED_OFFERING_ID,
    makeDeps({
      getCurrentInstructor: async () => null,
      resolveInstructorCourseOffering: async () => {
        resolverCalled = true;
        return { id: RESOLVED_OFFERING_ID, startDate: STARTED_START_DATE };
      },
      getCurrentCourseEnrollmentRoster: async () => {
        rosterCalled = true;
        return roster([]);
      },
    }),
  );
  assert.deepEqual(rows, []);
  assert.equal(resolverCalled, false, "must not resolve an offering when unauthorized");
  assert.equal(rosterCalled, false, "must not read the roster when unauthorized");
});

test("trainee/anonymous: instructor-only gate yields [] (no student PII)", async () => {
  // A trainee or anonymous session collapses to a null instructor actor upstream;
  // the student directory gate is instructor-only, so access is denied with [].
  // Supplying a perfectly valid offering id does not help.
  const rows = await loadStudentContactsWithDeps(
    REQUESTED_OFFERING_ID,
    makeDeps({ getCurrentInstructor: async () => null }),
  );
  assert.deepEqual(rows, []);
});

// --- failures never fall back to the legacy global roster -------------------

test("a membership anomaly throws and does NOT fall back to a legacy roster", async () => {
  const anomaly: EnrollmentMembershipAnomaly = {
    enrollmentId: "e9",
    studentId: "s9",
    kind: "NO_CURRENT_MEMBERSHIP",
    currentMembershipCount: 0,
  };
  await assert.rejects(
    () =>
      loadStudentContactsWithDeps(
        REQUESTED_OFFERING_ID,
        makeDeps({
          getCurrentCourseEnrollmentRoster: async () =>
            roster([traineeView("s1", "א", 1, "אבן")], [anomaly]),
        }),
      ),
    /membership\s+anomaly/,
  );
});

test("a malformed-subgroup anomaly throws (never degrades to the global roster)", async () => {
  const anomaly: EnrollmentMembershipAnomaly = {
    enrollmentId: "e1",
    studentId: "s1",
    kind: "MALFORMED_SUBGROUP",
    currentMembershipCount: 1,
  };
  await assert.rejects(
    () =>
      loadStudentContactsWithDeps(
        REQUESTED_OFFERING_ID,
        makeDeps({ getCurrentCourseEnrollmentRoster: async () => roster([], [anomaly]) }),
      ),
    /MALFORMED_SUBGROUP/,
  );
});

test("a duplicate student id does NOT pass silently (throws)", async () => {
  await assert.rejects(
    () =>
      loadStudentContactsWithDeps(
        REQUESTED_OFFERING_ID,
        makeDeps({
          getCurrentCourseEnrollmentRoster: async () =>
            roster([traineeView("s1", "א", 1, "אבן"), traineeView("s1", "א", 1, "אבן")]),
        }),
      ),
    /duplicate student id/,
  );
});

test("a DAL failure propagates (not swallowed into [])", async () => {
  await assert.rejects(
    () =>
      loadStudentContactsWithDeps(
        REQUESTED_OFFERING_ID,
        makeDeps({
          getCurrentCourseEnrollmentRoster: async () => {
            throw new Error("simulated Prisma failure");
          },
        }),
      ),
    /simulated Prisma failure/,
  );
});

// --- capability enforcement (Multi-Course Stage 2: CONTACTS) ----------------

test("fixture: the default capability map is exhaustive over CAPABILITY_KEYS", () => {
  // Runtime tripwire tying the compile-time-checked literal to the canonical key
  // set: if a capability key is ever added/removed, this fails until the fixture
  // is updated, so the "exhaustive map" guarantee cannot silently drift.
  assert.deepEqual(Object.keys(ALL_ENABLED_CAPABILITIES).sort(), [...CAPABILITY_KEYS].sort());
  for (const key of CAPABILITY_KEYS) {
    assert.equal(ALL_ENABLED_CAPABILITIES[key], "ENABLED");
  }
});

test("capability: unauthorized actor returns [] and calls neither resolver, caps, nor roster", async () => {
  let resolverCalled = false;
  let capsCalled = false;
  let rosterCalled = false;
  const rows = await loadStudentContactsWithDeps(
    REQUESTED_OFFERING_ID,
    makeDeps({
      getCurrentInstructor: async () => null,
      resolveInstructorCourseOffering: async () => {
        resolverCalled = true;
        return { id: RESOLVED_OFFERING_ID, startDate: STARTED_START_DATE };
      },
      getEffectiveCapabilities: async () => {
        capsCalled = true;
        return effectiveCapabilities();
      },
      getCurrentCourseEnrollmentRoster: async () => {
        rosterCalled = true;
        return roster([]);
      },
    }),
  );
  assert.deepEqual(rows, []);
  assert.equal(resolverCalled, false, "must not resolve an offering when unauthorized");
  assert.equal(capsCalled, false, "must not read capabilities when unauthorized");
  assert.equal(rosterCalled, false, "must not read the roster when unauthorized");
});

test("capability: ENABLED passes the trusted offering.id to caps + roster and returns the full roster", async () => {
  let capsOfferingId: string | null = null;
  let rosterOfferingId: string | null = null;
  let rosterAsOf: Date | null = null;
  const rows = await loadStudentContactsWithDeps(
    REQUESTED_OFFERING_ID,
    makeDeps({
      now: () => AS_OF,
      getEffectiveCapabilities: async (offeringId) => {
        capsOfferingId = offeringId;
        return effectiveCapabilities({ CONTACTS: "ENABLED" });
      },
      getCurrentCourseEnrollmentRoster: async (offeringId, options) => {
        rosterOfferingId = offeringId;
        rosterAsOf = options.asOf;
        return roster([
          traineeView("s1", "א", 1, "אבן", "050-1111111"),
          traineeView("s2", "ב", 2, "כהן", null),
        ]);
      },
    }),
  );
  // The capability lookup and the roster read both receive EXACTLY the trusted
  // resolved offering id; the offering has already started, so asOf is now.
  assert.equal(capsOfferingId, RESOLVED_OFFERING_ID);
  assert.equal(rosterOfferingId, RESOLVED_OFFERING_ID);
  assert.equal(rosterAsOf, AS_OF);
  assert.deepEqual(rows, [
    { id: "s1", fullName: "full s1", lastName: "אבן", groupName: "א", subgroupNumber: 1, phone: "050-1111111" },
    { id: "s2", fullName: "full s2", lastName: "כהן", groupName: "ב", subgroupNumber: 2, phone: null },
  ]);
});

test("capability: READ_ONLY behaves exactly like ENABLED (roster served, not blocked)", async () => {
  let rosterCalled = false;
  const rows = await loadStudentContactsWithDeps(
    REQUESTED_OFFERING_ID,
    makeDeps({
      getEffectiveCapabilities: async () => effectiveCapabilities({ CONTACTS: "READ_ONLY" }),
      getCurrentCourseEnrollmentRoster: async () => {
        rosterCalled = true;
        return roster([traineeView("s1", "א", 1, "אבן")]);
      },
    }),
  );
  assert.equal(rosterCalled, true, "READ_ONLY must NOT be blocked on a read-only surface");
  assert.deepEqual(rows.map((r: StudentContactRow) => r.id), ["s1"]);
});

test("capability: DISABLED returns [] and never reads the roster", async () => {
  let rosterCalled = false;
  const rows = await loadStudentContactsWithDeps(
    REQUESTED_OFFERING_ID,
    makeDeps({
      getEffectiveCapabilities: async () => effectiveCapabilities({ CONTACTS: "DISABLED" }),
      getCurrentCourseEnrollmentRoster: async () => {
        rosterCalled = true;
        return roster([traineeView("s1", "א", 1, "אבן", "050-1111111")]);
      },
    }),
  );
  assert.deepEqual(rows, []);
  assert.equal(rosterCalled, false, "DISABLED must block before any roster / PII read");
});

test("capability: an offering-resolution failure propagates before caps or roster", async () => {
  let capsCalled = false;
  let rosterCalled = false;
  await assert.rejects(
    () =>
      loadStudentContactsWithDeps(
        REQUESTED_OFFERING_ID,
        makeDeps({
          resolveInstructorCourseOffering: async () => {
            throw new InstructorCourseOfferingUnavailableError(
              REQUESTED_OFFERING_ID,
              "id-mismatch",
            );
          },
          getEffectiveCapabilities: async () => {
            capsCalled = true;
            return effectiveCapabilities();
          },
          getCurrentCourseEnrollmentRoster: async () => {
            rosterCalled = true;
            return roster([]);
          },
        }),
      ),
    /unavailable \(id-mismatch\)/,
  );
  assert.equal(capsCalled, false, "offering failure must abort before the capability lookup");
  assert.equal(rosterCalled, false, "offering failure must abort before any roster read");
});

test("capability: a capability-reader failure propagates and never falls open to the roster", async () => {
  let rosterCalled = false;
  await assert.rejects(
    () =>
      loadStudentContactsWithDeps(
        REQUESTED_OFFERING_ID,
        makeDeps({
          getEffectiveCapabilities: async () => {
            throw new Error("simulated capability-reader failure");
          },
          getCurrentCourseEnrollmentRoster: async () => {
            rosterCalled = true;
            return roster([traineeView("s1", "א", 1, "אבן")]);
          },
        }),
      ),
    /simulated capability-reader failure/,
  );
  assert.equal(rosterCalled, false, "a capability-reader failure must not fail open to the roster");
});

// --- surrounding contract ---------------------------------------------------

test("getStudentContacts takes exactly ONE required course offering id", () => {
  assert.equal(typeof getStudentContacts, "function");
  assert.equal(getStudentContacts.length, 1);
});

// SUPERSEDED BY L2-DUAL. This used to assert getInstructorContacts.length === 0.
// It now takes ONE optional trainee course REQUEST. That is not a widening of the
// student directory this suite covers: getStudentContacts is a different,
// instructor-only action whose own explicit course argument is unchanged, and the
// two signatures still cannot converge (asserted below and in
// contacts.instructor-directory.test.ts).
test("getInstructorContacts takes at most the one optional course request", () => {
  assert.equal(typeof getInstructorContacts, "function");
  assert.equal(getInstructorContacts.length, 1);
});

test("the action wires the INSTRUCTOR resolver and never the legacy singleton", () => {
  const src = readFileSync(
    fileURLToPath(new URL("./contacts.ts", import.meta.url)),
    "utf8",
  );
  const start = src.indexOf("export async function getStudentContacts");
  assert.ok(start >= 0, "getStudentContacts must still be declared in contacts.ts");
  const end = src.indexOf("export interface InstructorContactRow");
  assert.ok(end > start, "the InstructorContactRow declaration must still follow it");
  const action = src.slice(start, end);
  assert.match(action, /resolveInstructorCourseOffering/);
  assert.ok(
    !action.includes("resolveCurrentCourseOffering"),
    "the student-contacts path must not use the legacy singleton resolver",
  );
  assert.ok(
    !/prisma\.student\./.test(action),
    "the student directory must never read a global Student roster",
  );
  // The whole module must have dropped the legacy resolver import too.
  assert.ok(
    !src.includes("@/lib/course/current-offering"),
    "contacts.ts must no longer import the legacy singleton resolver",
  );
});

// --- module purity: no Next cookie/session or Prisma at runtime -------------

test("the core orchestration module pulls no Next.js cookie/session or Prisma code", () => {
  // Structural guard on the core module's OWN import graph: everything impure is
  // injected via StudentContactsDeps, so its only runtime (value) imports are the
  // pure audience-gate predicate and the pure typed course-context errors. A
  // type-only import (e.g. EnrollmentRosterResult) is erased and irrelevant. This
  // fails loudly if a future edit reaches for next/headers, next/cookies, Prisma,
  // or the session/actor DAL.
  const corePath = fileURLToPath(new URL("./contacts-student-directory.ts", import.meta.url));
  const src = readFileSync(corePath, "utf8");
  // [\s\S] (not [^\n]) so a MULTI-LINE value import cannot slip past this guard;
  // the lazy quantifier stops at the first `from "..."` of each import.
  const valueImports = [
    ...src.matchAll(/^\s*import\s+(?!type\b)[\s\S]*?from\s*["']([^"']+)["']/gm),
  ].map((m) => m[1]);
  const bareImports = [...src.matchAll(/^\s*import\s+["']([^"']+)["']/gm)].map((m) => m[1]);
  const runtimeSpecifiers = [...valueImports, ...bareImports];
  assert.deepEqual(runtimeSpecifiers, [
    "@/lib/auth/contact-directory-access",
    "@/lib/course/actor-course-offering-core",
  ]);
  for (const spec of runtimeSpecifiers) {
    assert.ok(
      !/next\/(headers|cookies)|prisma|auth\/(actor|session)/.test(spec),
      `core module must not import ${spec}`,
    );
  }
  assert.ok(
    !src.includes("resolveCurrentCourseOffering"),
    "the core must not reference the legacy singleton resolver",
  );
});
