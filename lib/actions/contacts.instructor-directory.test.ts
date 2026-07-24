/**
 * LEVEL 2 CONTACTS SLICE C1A - focused tests for the course-authorized trainee
 * view of the instructor contact directory
 * (lib/actions/contacts.ts -> getInstructorContacts).
 *
 * These exercise the dependency-injected orchestration
 * `loadInstructorContactsWithDeps` with plain fakes, so no Next.js cookies and
 * no live Prisma are needed. They lock the C1A contract:
 *  - the audience gate is preserved exactly (instructor OR trainee, else []);
 *  - the INSTRUCTOR half is unchanged and never resolves an offering;
 *  - the TRAINEE half resolves its own offering server-side through the
 *    committed no-argument resolver, then requires CONTACTS === "ENABLED" for
 *    that exact offering before any directory read;
 *  - every "no single resolvable course context" case (PLANNED-only / zero /
 *    two eligible enrollments) denies with [], while real defects propagate;
 *  - the returned fields and the no-arg action signature are unchanged.
 *
 * Uses the existing `tsx` + node:test approach. Run with:
 *   npx tsx --test lib/actions/contacts.instructor-directory.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// The dependency-injected orchestration is imported from the NON-"use server"
// core module (never from ./contacts), so these pure tests never pull in
// Next.js cookie/session code or Prisma for the behavioural assertions. The
// public server action getInstructorContacts still comes from ./contacts and is
// used only for the signature assertion.
import {
  loadInstructorContactsWithDeps,
  type InstructorContactsDeps,
} from "./contacts-instructor-directory";
import { getInstructorContacts, type InstructorContactRow } from "./contacts";
import {
  NoTraineeCourseOfferingError,
  AmbiguousTraineeCourseOfferingError,
} from "@/lib/course/actor-course-offering-core";
import { CAPABILITY_KEYS, type CapabilityKey } from "@/lib/course/capabilities/capability-keys";
import {
  resolveEffectiveCapabilitiesFromRows,
  type EffectiveCapabilityStatus,
} from "@/lib/course/capabilities/effective-capability-core";

// The two verified launch offerings, referenced by id only. Nothing in the code
// under test infers anything from a level, a name or a date - these constants
// exist purely so the Level 1 / Level 2 cases are distinguishable in assertions.
const LEVEL_1_OFFERING_ID = "cmrqngqhn00017gcndjixzrh0";
const LEVEL_2_OFFERING_ID = "cmrxk58vc0000lscnfm54bpze";

// --- fixtures ---------------------------------------------------------------

const ACTIVE_INSTRUCTORS: InstructorContactRow[] = [
  { id: "i1", fullName: "אבי מדריך", phone: "050-1111111" },
  { id: "i2", fullName: "בת מדריכה", phone: null },
];

// Exhaustive all-ENABLED effective map (same compile-time-checked literal
// pattern as contacts.student-directory.test.ts; the exhaustiveness tripwire
// below keeps it in lock-step with CAPABILITY_KEYS).
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

/** A trainee actor with no instructor actor - the C1A path under test. */
function traineeDeps(overrides: Partial<InstructorContactsDeps> = {}): InstructorContactsDeps {
  return {
    getCurrentInstructor: async () => null,
    getCurrentTrainee: async () => ({ id: "student-1" }),
    resolveTraineeCourseOffering: async () => ({ id: LEVEL_1_OFFERING_ID }),
    getEffectiveCapabilities: async () => effectiveCapabilities(),
    listActiveInstructors: async () => ACTIVE_INSTRUCTORS,
    ...overrides,
  };
}

const INSTRUCTOR_ROW_KEYS = ["fullName", "id", "phone"].sort();

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

/** The body of getInstructorContacts as written in the "use server" module. */
function instructorContactsActionSource(): string {
  const src = readSource("./contacts.ts");
  const start = src.indexOf("export async function getInstructorContacts");
  assert.ok(start >= 0, "getInstructorContacts must still be declared in contacts.ts");
  return src.slice(start);
}

// --- trainee audience: authorized ------------------------------------------

test("Level 1 trainee + CONTACTS ENABLED -> the active-instructor directory", async () => {
  let capsOfferingId: string | null = null;
  const rows = await loadInstructorContactsWithDeps(
    traineeDeps({
      resolveTraineeCourseOffering: async () => ({ id: LEVEL_1_OFFERING_ID }),
      getEffectiveCapabilities: async (offeringId) => {
        capsOfferingId = offeringId;
        return effectiveCapabilities({ CONTACTS: "ENABLED" });
      },
    }),
  );
  // The capability lookup receives EXACTLY the server-resolved offering id.
  assert.equal(capsOfferingId, LEVEL_1_OFFERING_ID);
  assert.deepEqual(rows, ACTIVE_INSTRUCTORS);
});

test("Level 2 trainee + CONTACTS ENABLED -> the same active-instructor directory", async () => {
  // Temporary launch policy: every active instructor is relevant to BOTH
  // offerings, so the visible roster is identical - only the authorization path
  // differs. No Level 1 fallback is involved: the Level 2 id is what is checked.
  let capsOfferingId: string | null = null;
  const rows = await loadInstructorContactsWithDeps(
    traineeDeps({
      resolveTraineeCourseOffering: async () => ({ id: LEVEL_2_OFFERING_ID }),
      getEffectiveCapabilities: async (offeringId) => {
        capsOfferingId = offeringId;
        return effectiveCapabilities({ CONTACTS: "ENABLED" });
      },
    }),
  );
  assert.equal(capsOfferingId, LEVEL_2_OFFERING_ID);
  assert.notEqual(capsOfferingId, LEVEL_1_OFFERING_ID);
  assert.deepEqual(rows, ACTIVE_INSTRUCTORS);
});

test("authorized trainee rows carry EXACTLY the three existing contract keys", async () => {
  const rows = await loadInstructorContactsWithDeps(traineeDeps());
  assert.equal(rows.length, 2);
  assert.deepEqual(Object.keys(rows[0]).sort(), INSTRUCTOR_ROW_KEYS);
  assert.equal(rows[1].phone, null, "a null phone stays null");
});

test("strict trainee call order: actor -> offering -> capability -> directory", async () => {
  const calls: string[] = [];
  await loadInstructorContactsWithDeps(
    traineeDeps({
      getCurrentTrainee: async () => {
        calls.push("actor");
        return { id: "student-1" };
      },
      resolveTraineeCourseOffering: async () => {
        calls.push("offering");
        return { id: LEVEL_2_OFFERING_ID };
      },
      getEffectiveCapabilities: async () => {
        calls.push("capability");
        return effectiveCapabilities();
      },
      listActiveInstructors: async () => {
        calls.push("directory");
        return ACTIVE_INSTRUCTORS;
      },
    }),
  );
  assert.deepEqual(calls, ["actor", "offering", "capability", "directory"]);
});

// --- trainee audience: course context fails closed --------------------------

test("PLANNED-only enrollment -> denied with [] and no directory read", async () => {
  // A PLANNED-only (or otherwise non-ACTIVE) enrollment yields zero ELIGIBLE
  // rows in the committed resolver, which throws NoTraineeCourseOfferingError.
  let capsCalled = false;
  let directoryCalled = false;
  const rows = await loadInstructorContactsWithDeps(
    traineeDeps({
      resolveTraineeCourseOffering: async () => {
        throw new NoTraineeCourseOfferingError("student-1");
      },
      getEffectiveCapabilities: async () => {
        capsCalled = true;
        return effectiveCapabilities();
      },
      listActiveInstructors: async () => {
        directoryCalled = true;
        return ACTIVE_INSTRUCTORS;
      },
    }),
  );
  assert.deepEqual(rows, []);
  assert.equal(capsCalled, false, "must not read capabilities without a course context");
  assert.equal(directoryCalled, false, "must not read the directory without a course context");
});

test("zero eligible enrollments -> denied with []", async () => {
  const rows = await loadInstructorContactsWithDeps(
    traineeDeps({
      resolveTraineeCourseOffering: async () => {
        throw new NoTraineeCourseOfferingError("student-1");
      },
    }),
  );
  assert.deepEqual(rows, []);
});

test("two eligible enrollments -> denied with [] (never picks one)", async () => {
  let directoryCalled = false;
  const rows = await loadInstructorContactsWithDeps(
    traineeDeps({
      resolveTraineeCourseOffering: async () => {
        throw new AmbiguousTraineeCourseOfferingError("student-1", [
          LEVEL_1_OFFERING_ID,
          LEVEL_2_OFFERING_ID,
        ]);
      },
      listActiveInstructors: async () => {
        directoryCalled = true;
        return ACTIVE_INSTRUCTORS;
      },
    }),
  );
  assert.deepEqual(rows, []);
  assert.equal(directoryCalled, false, "ambiguity must never resolve to a directory read");
});

test("a NON-denial resolver failure propagates (never laundered into [])", async () => {
  let directoryCalled = false;
  await assert.rejects(
    () =>
      loadInstructorContactsWithDeps(
        traineeDeps({
          resolveTraineeCourseOffering: async () => {
            throw new Error("simulated Prisma failure");
          },
          listActiveInstructors: async () => {
            directoryCalled = true;
            return ACTIVE_INSTRUCTORS;
          },
        }),
      ),
    /simulated Prisma failure/,
  );
  assert.equal(directoryCalled, false, "a fault must not fail open to the directory");
});

// --- trainee audience: capability enforcement -------------------------------

test("fixture: the default capability map is exhaustive over CAPABILITY_KEYS", () => {
  assert.deepEqual(Object.keys(ALL_ENABLED_CAPABILITIES).sort(), [...CAPABILITY_KEYS].sort());
  for (const key of CAPABILITY_KEYS) {
    assert.equal(ALL_ENABLED_CAPABILITIES[key], "ENABLED");
  }
});

test("a MISSING CONTACTS row (the Level 2 launch state) -> fail closed with []", async () => {
  // Built with the REAL pure capability resolver from zero offering rows plus a
  // fully active catalog, so this asserts the genuine CAP-1 missing-row default
  // rather than a hand-written "DISABLED" fixture. This is exactly the state of
  // the Level 2 offering until the separate production-data step creates
  // Level 2 / CONTACTS / ENABLED.
  const { effective } = resolveEffectiveCapabilitiesFromRows(
    [],
    CAPABILITY_KEYS.map((key) => ({ key, isActive: true })),
  );
  assert.equal(effective.CONTACTS, "DISABLED", "missing row must resolve to DISABLED");

  let directoryCalled = false;
  const rows = await loadInstructorContactsWithDeps(
    traineeDeps({
      resolveTraineeCourseOffering: async () => ({ id: LEVEL_2_OFFERING_ID }),
      getEffectiveCapabilities: async () => effective,
      listActiveInstructors: async () => {
        directoryCalled = true;
        return ACTIVE_INSTRUCTORS;
      },
    }),
  );
  assert.deepEqual(rows, []);
  assert.equal(directoryCalled, false, "a missing capability row must block the directory read");
});

test("CONTACTS effectively DISABLED -> [] and never reads the directory", async () => {
  let directoryCalled = false;
  const rows = await loadInstructorContactsWithDeps(
    traineeDeps({
      getEffectiveCapabilities: async () => effectiveCapabilities({ CONTACTS: "DISABLED" }),
      listActiveInstructors: async () => {
        directoryCalled = true;
        return ACTIVE_INSTRUCTORS;
      },
    }),
  );
  assert.deepEqual(rows, []);
  assert.equal(directoryCalled, false, "DISABLED must block before any directory read");
});

test("CONTACTS READ_ONLY -> [] (this surface requires a positively ENABLED capability)", async () => {
  // Deliberately STRICTER than the student directory, which tolerates READ_ONLY.
  // Recorded here so the divergence is a locked decision, not an accident.
  const rows = await loadInstructorContactsWithDeps(
    traineeDeps({
      getEffectiveCapabilities: async () => effectiveCapabilities({ CONTACTS: "READ_ONLY" }),
    }),
  );
  assert.deepEqual(rows, []);
});

test("another capability being DISABLED does not affect CONTACTS", async () => {
  const rows = await loadInstructorContactsWithDeps(
    traineeDeps({
      getEffectiveCapabilities: async () =>
        effectiveCapabilities({ SCHEDULE: "DISABLED", RIDING: "DISABLED" }),
    }),
  );
  assert.deepEqual(rows, ACTIVE_INSTRUCTORS);
});

test("a capability-reader failure propagates and never falls open", async () => {
  let directoryCalled = false;
  await assert.rejects(
    () =>
      loadInstructorContactsWithDeps(
        traineeDeps({
          getEffectiveCapabilities: async () => {
            throw new Error("simulated capability-reader failure");
          },
          listActiveInstructors: async () => {
            directoryCalled = true;
            return ACTIVE_INSTRUCTORS;
          },
        }),
      ),
    /simulated capability-reader failure/,
  );
  assert.equal(directoryCalled, false);
});

// --- audience gate preserved ------------------------------------------------

test("anonymous caller -> [] without resolving an offering or reading capabilities", async () => {
  let offeringCalled = false;
  let capsCalled = false;
  let directoryCalled = false;
  const rows = await loadInstructorContactsWithDeps(
    traineeDeps({
      getCurrentInstructor: async () => null,
      getCurrentTrainee: async () => null,
      resolveTraineeCourseOffering: async () => {
        offeringCalled = true;
        return { id: LEVEL_1_OFFERING_ID };
      },
      getEffectiveCapabilities: async () => {
        capsCalled = true;
        return effectiveCapabilities();
      },
      listActiveInstructors: async () => {
        directoryCalled = true;
        return ACTIVE_INSTRUCTORS;
      },
    }),
  );
  assert.deepEqual(rows, []);
  assert.equal(offeringCalled, false);
  assert.equal(capsCalled, false);
  assert.equal(directoryCalled, false);
});

// --- instructor audience unchanged -----------------------------------------

test("instructor audience: directory served WITHOUT resolving an offering (unchanged)", async () => {
  // C1A deliberately does not course-scope the instructor half: no explicit
  // instructor course context exists in the UI, and it is never inferred. This
  // keeps the instructor contacts tab and the riding-slots roster picker intact.
  let offeringCalled = false;
  let capsCalled = false;
  const rows = await loadInstructorContactsWithDeps(
    traineeDeps({
      getCurrentInstructor: async () => ({ id: "instructor-1" }),
      resolveTraineeCourseOffering: async () => {
        offeringCalled = true;
        return { id: LEVEL_1_OFFERING_ID };
      },
      getEffectiveCapabilities: async () => {
        capsCalled = true;
        return effectiveCapabilities();
      },
    }),
  );
  assert.deepEqual(rows, ACTIVE_INSTRUCTORS);
  assert.equal(offeringCalled, false, "instructor half must not use the TRAINEE resolver");
  assert.equal(capsCalled, false, "instructor half is unchanged in this slice");
});

test("instructor audience: the trainee session is never even read", async () => {
  let traineeRead = false;
  await loadInstructorContactsWithDeps(
    traineeDeps({
      getCurrentInstructor: async () => ({ id: "instructor-1" }),
      getCurrentTrainee: async () => {
        traineeRead = true;
        return null;
      },
    }),
  );
  assert.equal(traineeRead, false, "the pre-existing short-circuit is preserved");
});

// --- surrounding contract + structural guards -------------------------------

// SUPERSEDED BY L2-DUAL. This used to assert length === 0, i.e. "a trainee may
// never name a course". The replacement contract is that the ONE parameter is a
// REQUEST, not an authority: it carries no identity, never reaches a query, and is
// re-resolved server-side against the trainee's own ACTIVE enrollments (proved in
// lib/course/trainee-course-selection-core.test.ts). What must still hold here is
// that it is the ONLY parameter and that no ACTOR id can be supplied.
test("getInstructorContacts accepts exactly one optional course request, and no actor id", () => {
  assert.equal(typeof getInstructorContacts, "function");
  assert.equal(getInstructorContacts.length, 1);

  const source = instructorContactsActionSource();
  const params = source.slice(source.indexOf("("), source.indexOf(")"));
  assert.match(params, /requestedCourseOfferingId\?: string \| null/);
  for (const forbidden of ["studentId", "traineeId", "instructorId", "identityNumber"]) {
    assert.ok(!params.includes(forbidden), `no ${forbidden} parameter may exist`);
  }
});

test("the trainee half re-resolves the request through the SELECTION resolver", () => {
  const source = instructorContactsActionSource();
  // A bound zero-argument closure: the shared orchestration is unchanged and still
  // cannot be handed a client value directly.
  assert.match(
    source,
    /resolveTraineeCourseOffering:\s*\(\)\s*=>\s*\n?\s*resolveTraineeSelectedCourseOffering\(requestedCourseOfferingId\)/,
  );
  assert.ok(
    !source.includes("LEVEL_1_COURSE_OFFERING_ID"),
    "no Level 1 fallback may appear in the contacts action",
  );
});

test("the trainee resolver dependency takes no arguments (no id can be passed)", async () => {
  let receivedArgs: unknown[] | null = null;
  await loadInstructorContactsWithDeps(
    traineeDeps({
      resolveTraineeCourseOffering: async (...args: unknown[]) => {
        receivedArgs = args;
        return { id: LEVEL_2_OFFERING_ID };
      },
    }),
  );
  assert.deepEqual(receivedArgs, [], "the orchestration must pass no offering id");
});

test("the migrated action wires the TRAINEE resolver and never resolveCurrentCourseOffering", () => {
  const action = instructorContactsActionSource();
  assert.match(action, /resolveTraineeCourseOffering/);
  assert.ok(
    !action.includes("resolveCurrentCourseOffering"),
    "the instructor-contacts path must not use the legacy singleton resolver",
  );
});

test("the migrated action reads ONLY active instructors and no Student roster", () => {
  const action = instructorContactsActionSource();
  assert.match(action, /prisma\.instructor\.findMany/);
  assert.match(action, /isActive:\s*true/, "inactive instructors stay excluded");
  assert.ok(
    !/prisma\.student\./.test(action),
    "the instructor directory must never read a global Student roster",
  );
  for (const forbidden of ["groupName", "subgroupNumber", "startDate", "endDate", "level"]) {
    assert.ok(!action.includes(forbidden), `must not infer course context from ${forbidden}`);
  }
});

test("the core orchestration module pulls no Next.js cookie/session or Prisma code", () => {
  // Structural guard on the core module's OWN import graph: everything impure is
  // injected via InstructorContactsDeps, so its only runtime (value) imports are
  // the pure audience-gate predicate and the pure typed course-context errors.
  const src = readSource("./contacts-instructor-directory.ts");
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

test("the trainee-facing instructor-directory UI path threads only the course request", () => {
  // SUPERSEDED BY L2-DUAL. The first two cases used to assert a NO-ARGUMENT call
  // chain. The instructor-contacts tab still routes to the SAME component for both
  // audiences; what changed is that the trainee branch now forwards its requested
  // course id (and only that - never a student id, never a level or a name).
  //
  // The third case is the C0-B boundary marker: the STUDENT directory (a
  // different action, instructor-only) is course-scoped by its own explicit
  // argument. It is asserted here so that the two directories' signatures can
  // never silently converge.
  const cases: Array<[string, string]> = [
    [
      "../components/ContactsSection.tsx",
      'courseOfferingId={audience === "trainee" ? traineeCourseOfferingId : undefined}',
    ],
    [
      "../../app/student/StudentInstructorContactsSection.tsx",
      "getInstructorContacts(courseOfferingId)",
    ],
    ["../../app/instructor/InstructorContactsSection.tsx", "getStudentContacts(courseOfferingId)"],
  ];
  for (const [relative, expected] of cases) {
    assert.ok(
      readSource(relative).includes(expected),
      `${relative} must still contain ${expected}`,
    );
  }
});
