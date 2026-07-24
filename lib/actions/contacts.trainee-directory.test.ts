/**
 * LEVEL 2 CONTACTS SLICE C1B - focused tests for the RESTORED, COURSE-SCOPED
 * trainee-facing fellow-trainee contact directory (lib/actions/contacts.ts ->
 * getTraineeStudentContacts).
 *
 * These exercise the dependency-injected orchestration
 * `loadTraineeStudentContactsWithDeps` with plain fakes, so no Next.js cookies and
 * no live Prisma are needed. They lock the regression-fix contract:
 *  - an authenticated TRAINEE actor sees the roster of THEIR resolved course;
 *  - an anonymous/absent trainee gets [];
 *  - course context is SERVER-RESOLVED: a no-course / ambiguous-dual trainee
 *    fails CLOSED to [] (never a guess, never a Level 1 fallback);
 *  - CONTACTS must be positively ENABLED (READ_ONLY / DISABLED deny);
 *  - every downstream read receives the RESOLVED offering id (cross-course
 *    guarantee) and the roster is scoped to it;
 *  - rows carry ONLY { id, fullName, phone } - no identity number, group,
 *    subgroup, lastName or any other field leaks to a trainee;
 *  - the instructor directory action is untouched.
 *
 * Run with:
 *   npx tsx --test lib/actions/contacts.trainee-directory.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  loadTraineeStudentContactsWithDeps,
  type TraineeStudentContactsDeps,
} from "./contacts-student-directory";
import { getTraineeStudentContacts, getStudentContacts } from "./contacts";
import type {
  EnrolledTraineeView,
  EnrollmentRosterResult,
  EnrollmentMembershipAnomaly,
} from "@/lib/course/enrollment-view";
import {
  NoTraineeCourseOfferingError,
  AmbiguousTraineeCourseOfferingError,
} from "@/lib/course/actor-course-offering-core";
import { type CapabilityKey } from "@/lib/course/capabilities/capability-keys";
import type { EffectiveCapabilityStatus } from "@/lib/course/capabilities/effective-capability-core";

const AS_OF = new Date("2026-07-24T12:00:00.000Z");
const RESOLVED_OFFERING_ID = "offering-RESOLVED";
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

function effectiveCapabilities(
  overrides: Partial<Record<CapabilityKey, EffectiveCapabilityStatus>> = {},
): Record<CapabilityKey, EffectiveCapabilityStatus> {
  return { ...ALL_ENABLED_CAPABILITIES, ...overrides };
}

function makeDeps(
  overrides: Partial<TraineeStudentContactsDeps> = {},
): TraineeStudentContactsDeps {
  return {
    getCurrentTrainee: async () => ({ id: "trainee-1" }),
    resolveTraineeCourseOffering: async () => ({
      id: RESOLVED_OFFERING_ID,
      startDate: STARTED_START_DATE,
    }),
    getEffectiveCapabilities: async () => effectiveCapabilities(),
    getCurrentCourseEnrollmentRoster: async () => roster([]),
    now: () => AS_OF,
    ...overrides,
  };
}

const TRAINEE_ROW_KEYS = ["fullName", "id", "phone"].sort();

// --- authorized, course-scoped mapping --------------------------------------

test("authorized single-course trainee: returns name + phone rows for their course", async () => {
  const rows = await loadTraineeStudentContactsWithDeps(
    makeDeps({
      getCurrentCourseEnrollmentRoster: async () =>
        roster([
          traineeView("s1", "א", 1, "אבן", "050-1111111"),
          traineeView("s2", "ב", 2, "כהן", "050-2222222"),
        ]),
    }),
  );
  assert.deepEqual(rows, [
    { id: "s1", fullName: "full s1", phone: "050-1111111" },
    { id: "s2", fullName: "full s2", phone: "050-2222222" },
  ]);
});

test("returned rows carry EXACTLY { id, fullName, phone } - no group/subgroup/lastName/identity leak", async () => {
  const rows = await loadTraineeStudentContactsWithDeps(
    makeDeps({
      getCurrentCourseEnrollmentRoster: async () =>
        roster([traineeView("s1", "א", 3, "אבן", "050-1111111")]),
    }),
  );
  assert.equal(rows.length, 1);
  assert.deepEqual(Object.keys(rows[0]).sort(), TRAINEE_ROW_KEYS);
  // Explicitly assert the instructor-only grouping fields are absent.
  const leaked = rows[0] as unknown as Record<string, unknown>;
  assert.equal("groupName" in leaked, false);
  assert.equal("subgroupNumber" in leaked, false);
  assert.equal("lastName" in leaked, false);
});

test("a non-empty phone renders; a null phone stays null (broken-link guard is the client's job)", async () => {
  const rows = await loadTraineeStudentContactsWithDeps(
    makeDeps({
      getCurrentCourseEnrollmentRoster: async () =>
        roster([
          traineeView("s1", "א", 1, "אבן", "050-1111111"),
          traineeView("s2", "א", 1, "בר", null),
        ]),
    }),
  );
  assert.equal(rows[0].phone, "050-1111111");
  assert.equal(rows[1].phone, null);
});

// --- course containment / cross-course guarantee ----------------------------

test("cross-course guarantee: the roster is read for the RESOLVED offering id only", async () => {
  const rosterCalls: string[] = [];
  await loadTraineeStudentContactsWithDeps(
    makeDeps({
      resolveTraineeCourseOffering: async () => ({
        id: RESOLVED_OFFERING_ID,
        startDate: STARTED_START_DATE,
      }),
      getCurrentCourseEnrollmentRoster: async (id) => {
        rosterCalls.push(id);
        return roster([traineeView("s1", "א", 1, "אבן", "050-1111111")]);
      },
    }),
  );
  assert.deepEqual(rosterCalls, [RESOLVED_OFFERING_ID]);
});

test("capability is checked for the RESOLVED offering id", async () => {
  const capCalls: string[] = [];
  await loadTraineeStudentContactsWithDeps(
    makeDeps({
      getEffectiveCapabilities: async (id) => {
        capCalls.push(id);
        return effectiveCapabilities();
      },
    }),
  );
  assert.deepEqual(capCalls, [RESOLVED_OFFERING_ID]);
});

// A dual trainee viewing Level 1 vs Level 2 is modeled by the resolver returning
// the DIFFERENT resolved offering; the roster always follows the resolved id, so
// there is never cross-course bleed between the two.
test("dual trainee: whichever course the resolver returns is the only one read", async () => {
  const seen: string[] = [];
  const readFor = async (resolvedId: string) => {
    seen.length = 0;
    await loadTraineeStudentContactsWithDeps(
      makeDeps({
        resolveTraineeCourseOffering: async () => ({ id: resolvedId, startDate: STARTED_START_DATE }),
        getCurrentCourseEnrollmentRoster: async (id) => {
          seen.push(id);
          return roster([]);
        },
      }),
    );
    return [...seen];
  };
  assert.deepEqual(await readFor("offering-LEVEL-1"), ["offering-LEVEL-1"]);
  assert.deepEqual(await readFor("offering-LEVEL-2"), ["offering-LEVEL-2"]);
});

// --- fail-closed denials ----------------------------------------------------

test("anonymous / absent trainee actor -> [] (no offering, capability or roster read)", async () => {
  let touched = false;
  const rows = await loadTraineeStudentContactsWithDeps(
    makeDeps({
      getCurrentTrainee: async () => null,
      resolveTraineeCourseOffering: async () => {
        touched = true;
        return { id: RESOLVED_OFFERING_ID, startDate: STARTED_START_DATE };
      },
    }),
  );
  assert.deepEqual(rows, []);
  assert.equal(touched, false);
});

test("empty-string trainee id is not honored -> []", async () => {
  const rows = await loadTraineeStudentContactsWithDeps(
    makeDeps({ getCurrentTrainee: async () => ({ id: "" }) }),
  );
  assert.deepEqual(rows, []);
});

test("ambiguous dual trainee with no selected course -> [] (fail closed, no roster read)", async () => {
  let rosterRead = false;
  const rows = await loadTraineeStudentContactsWithDeps(
    makeDeps({
      resolveTraineeCourseOffering: async () => {
        throw new AmbiguousTraineeCourseOfferingError("trainee-1", ["o1", "o2"]);
      },
      getCurrentCourseEnrollmentRoster: async () => {
        rosterRead = true;
        return roster([traineeView("s1", "א", 1, "אבן", "050-1111111")]);
      },
    }),
  );
  assert.deepEqual(rows, []);
  assert.equal(rosterRead, false);
});

test("trainee with no resolvable course -> []", async () => {
  const rows = await loadTraineeStudentContactsWithDeps(
    makeDeps({
      resolveTraineeCourseOffering: async () => {
        throw new NoTraineeCourseOfferingError("trainee-1");
      },
    }),
  );
  assert.deepEqual(rows, []);
});

test("a NON-denial resolver failure PROPAGATES (never laundered into an empty directory)", async () => {
  await assert.rejects(
    loadTraineeStudentContactsWithDeps(
      makeDeps({
        resolveTraineeCourseOffering: async () => {
          throw new Error("prisma exploded");
        },
      }),
    ),
    /prisma exploded/,
  );
});

test("CONTACTS DISABLED -> [] (no roster read)", async () => {
  let rosterRead = false;
  const rows = await loadTraineeStudentContactsWithDeps(
    makeDeps({
      getEffectiveCapabilities: async () => effectiveCapabilities({ CONTACTS: "DISABLED" }),
      getCurrentCourseEnrollmentRoster: async () => {
        rosterRead = true;
        return roster([traineeView("s1", "א", 1, "אבן", "050-1111111")]);
      },
    }),
  );
  assert.deepEqual(rows, []);
  assert.equal(rosterRead, false);
});

test("CONTACTS READ_ONLY -> [] (trainee directory needs positively ENABLED)", async () => {
  const rows = await loadTraineeStudentContactsWithDeps(
    makeDeps({
      getEffectiveCapabilities: async () => effectiveCapabilities({ CONTACTS: "READ_ONLY" }),
      getCurrentCourseEnrollmentRoster: async () =>
        roster([traineeView("s1", "א", 1, "אבן", "050-1111111")]),
    }),
  );
  assert.deepEqual(rows, []);
});

test("a membership anomaly fails LOUDLY (never a degraded/global roster)", async () => {
  const anomaly: EnrollmentMembershipAnomaly = {
    enrollmentId: "e1",
    studentId: "s1",
    kind: "NO_CURRENT_MEMBERSHIP",
    currentMembershipCount: 0,
  };
  await assert.rejects(
    loadTraineeStudentContactsWithDeps(
      makeDeps({
        getCurrentCourseEnrollmentRoster: async () => roster([], [anomaly]),
      }),
    ),
    /refusing to serve/,
  );
});

// --- public wiring (source-level, mirrors contacts.instructor-directory.test.ts) --

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

test("getTraineeStudentContacts is exported and accepts at most the requested course id", () => {
  assert.equal(typeof getTraineeStudentContacts, "function");
  // At most one parameter (the OPTIONAL requested offering id); it never takes a
  // studentId or membership claim.
  assert.ok(getTraineeStudentContacts.length <= 1);
});

test("the trainee action binds the REQUESTED id through resolveTraineeSelectedCourseOffering only", () => {
  const src = readSource("./contacts.ts");
  const start = src.indexOf("export async function getTraineeStudentContacts");
  assert.ok(start >= 0, "getTraineeStudentContacts must be declared in contacts.ts");
  const body = src.slice(start, start + 900);
  assert.match(body, /resolveTraineeSelectedCourseOffering\(requestedCourseOfferingId\)/);
  assert.match(body, /loadTraineeStudentContactsWithDeps/);
});

test("the shared ContactsSection mounts the trainee panel via getTraineeStudentContacts", () => {
  const src = readSource("../components/ContactsSection.tsx");
  assert.match(src, /getTraineeStudentContacts/);
  assert.match(src, /TraineeStudentContactsPanel/);
  // The trainee branch no longer renders the old static empty panel.
  assert.equal(src.includes("אין חניכים להצגה"), false);
});

test("the instructor student directory action is UNCHANGED (still one required course id)", () => {
  assert.equal(typeof getStudentContacts, "function");
  assert.equal(getStudentContacts.length, 1);
});
