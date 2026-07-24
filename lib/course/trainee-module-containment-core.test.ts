/**
 * SECURITY / LEVEL 2 SLICE L2-C1 - focused tests for the PURE trainee module
 * containment core (./trainee-module-containment-core) and for the containment
 * contract of the three trainee-facing Teaching Practice readers.
 *
 * Everything here runs against plain fakes: no Next.js cookies, no live Prisma,
 * no React. They lock the L2-C1 contract:
 *  - identity is SESSION-DERIVED; a client-supplied studentId is never identity
 *    and can never select another trainee's data;
 *  - the resolved offering's TEACHING_PRACTICE capability must be positively
 *    ENABLED, so a row-absent capability (the current Level 2 state) yields [];
 *  - every "no single resolvable trainee course context" case denies with the
 *    uniform empty result, while real defects (capability reader / data reader /
 *    programming errors) propagate;
 *  - no Teaching Practice data is fetched before authorization passes.
 *
 * Uses the existing `tsx` + node:test approach. Run with:
 *   npx tsx --test lib/course/trainee-module-containment-core.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  TRAINEE_TEACHING_PRACTICE_CAPABILITY_KEY,
  authorizeTraineeModuleWithDeps,
  emptyTraineeModuleRows,
  isTraineeCapabilityEnabled,
  isTraineeCourseContextDenial,
  loadAuthorizedTraineeModuleRowsWithDeps,
  type TraineeModuleContextDeps,
} from "./trainee-module-containment-core";
import {
  AmbiguousTraineeCourseOfferingError,
  NoTraineeCourseOfferingError,
} from "./actor-course-offering-core";
import { UnauthenticatedActorError } from "@/lib/auth/actor-types";
import type { CapabilityKey } from "./capabilities/capability-keys";
import type { EffectiveCapabilityStatus } from "./capabilities/effective-capability-core";

// The two REAL production offering ids, so the Level 1 / Level 2 cases below
// describe the actual launch state rather than invented placeholders.
const LEVEL_1_OFFERING_ID = "cmrqngqhn00017gcndjixzrh0";
const LEVEL_2_OFFERING_ID = "cmrxk58vc0000lscnfm54bpze";

const SESSION_TRAINEE_ID = "trainee-from-signed-session";
/** The id an attacker would put in the client-supplied `studentId` argument. */
const OTHER_TRAINEE_ID = "some-other-trainee";

type CapabilityMap = Record<CapabilityKey, EffectiveCapabilityStatus>;

/** A full, exhaustive capability map with every key DISABLED except overrides. */
function capabilities(overrides: Partial<CapabilityMap> = {}): CapabilityMap {
  return {
    SCHEDULE: "DISABLED",
    CONTACTS: "DISABLED",
    MESSAGES: "DISABLED",
    ATTENDANCE: "DISABLED",
    DUTIES: "DISABLED",
    RIDING: "DISABLED",
    PROGRESS_RIDING: "DISABLED",
    RIDING_HORSE_ASSIGNMENTS: "DISABLED",
    ADVANCED_INSTRUCTION: "DISABLED",
    TEACHING_PRACTICE: "DISABLED",
    ...overrides,
  };
}

interface DepsSpy {
  deps: TraineeModuleContextDeps;
  calls: string[];
}

function makeDeps(options: {
  traineeId?: string;
  requireTraineeIdError?: unknown;
  offeringId?: string;
  resolveOfferingError?: unknown;
  capabilityMap?: Partial<CapabilityMap> | null;
  capabilityError?: unknown;
}): DepsSpy {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      requireTraineeId: async () => {
        calls.push("actor");
        if (options.requireTraineeIdError !== undefined) throw options.requireTraineeIdError;
        return options.traineeId ?? SESSION_TRAINEE_ID;
      },
      resolveTraineeCourseOffering: async () => {
        calls.push("offering");
        if (options.resolveOfferingError !== undefined) throw options.resolveOfferingError;
        return { id: options.offeringId ?? LEVEL_1_OFFERING_ID };
      },
      getEffectiveCapabilities: async (courseOfferingId: string) => {
        calls.push(`capabilities:${courseOfferingId}`);
        if (options.capabilityError !== undefined) throw options.capabilityError;
        return (options.capabilityMap ?? capabilities()) as CapabilityMap;
      },
    },
  };
}

/** A stand-in for the real Prisma read, recording whether it ran at all. */
function makeLoader<TRow>(rows: TRow[]) {
  const seen: { traineeId: string; courseOfferingId: string }[] = [];
  return {
    seen,
    load: async (context: { traineeId: string; courseOfferingId: string }) => {
      seen.push(context);
      return rows;
    },
  };
}

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

/**
 * Source with block and line comments removed.
 *
 * The forbidden-identifier assertions below must test what the module actually
 * DOES, not what its documentation is allowed to mention: both files explain at
 * length why resolveCurrentCourseOffering and a client courseOfferingId are
 * excluded, and naming them in prose must not be mistaken for using them. A real
 * reference in code still fails these checks.
 */
function readCode(relative: string): string {
  return readSource(relative)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

// ---------------------------------------------------------------------------
// Denial classification
// ---------------------------------------------------------------------------

test("only the three no-trustworthy-context failures are denials", () => {
  assert.equal(isTraineeCourseContextDenial(new UnauthenticatedActorError()), true);
  assert.equal(isTraineeCourseContextDenial(new NoTraineeCourseOfferingError("s1")), true);
  assert.equal(
    isTraineeCourseContextDenial(new AmbiguousTraineeCourseOfferingError("s1", ["a", "b"])),
    true,
  );

  // Real defects are NOT denials - they must reach the caller as errors.
  assert.equal(isTraineeCourseContextDenial(new Error("connection reset")), false);
  assert.equal(isTraineeCourseContextDenial(new TypeError("undefined is not a function")), false);
  assert.equal(isTraineeCourseContextDenial(null), false);
  assert.equal(isTraineeCourseContextDenial(undefined), false);
  assert.equal(isTraineeCourseContextDenial("NoTraineeCourseOfferingError"), false);
  // Name-alike impostor: classification is by CLASS, never by message/name text.
  assert.equal(isTraineeCourseContextDenial({ name: "UnauthenticatedActorError" }), false);
});

// ---------------------------------------------------------------------------
// Capability predicate
// ---------------------------------------------------------------------------

test("the capability predicate is positively ENABLED and denies everything else", () => {
  const key = TRAINEE_TEACHING_PRACTICE_CAPABILITY_KEY;
  assert.equal(key, "TEACHING_PRACTICE");

  assert.equal(isTraineeCapabilityEnabled(key, capabilities({ TEACHING_PRACTICE: "ENABLED" })), true);

  // READ_ONLY is NOT enough for this module.
  assert.equal(
    isTraineeCapabilityEnabled(key, capabilities({ TEACHING_PRACTICE: "READ_ONLY" })),
    false,
  );
  assert.equal(
    isTraineeCapabilityEnabled(key, capabilities({ TEACHING_PRACTICE: "DISABLED" })),
    false,
  );
  // Row-absent / partial / empty / malformed / nullish maps all deny.
  assert.equal(isTraineeCapabilityEnabled(key, { SCHEDULE: "ENABLED" }), false);
  assert.equal(isTraineeCapabilityEnabled(key, {}), false);
  assert.equal(isTraineeCapabilityEnabled(key, null), false);
  assert.equal(isTraineeCapabilityEnabled(key, undefined), false);
  assert.equal(
    isTraineeCapabilityEnabled(key, {
      TEACHING_PRACTICE: "enabled" as unknown as EffectiveCapabilityStatus,
    }),
    false,
  );
  assert.equal(
    isTraineeCapabilityEnabled(key, {
      TEACHING_PRACTICE: true as unknown as EffectiveCapabilityStatus,
    }),
    false,
  );

  // Another key being ENABLED never authorizes this module.
  assert.equal(isTraineeCapabilityEnabled(key, capabilities({ SCHEDULE: "ENABLED" })), false);
});

test("the empty denial result is a fresh array every time", () => {
  const a = emptyTraineeModuleRows<string>();
  const b = emptyTraineeModuleRows<string>();
  // Deliberately length checks rather than assert.deepEqual(a, []): the node
  // typings narrow the asserted value to the literal type, which would make the
  // mutation below a type error and defeat the point of this test.
  assert.equal(a.length, 0);
  assert.equal(b.length, 0);
  assert.notEqual(a, b, "denials must not share one mutable array instance");
  a.push("mutated");
  assert.equal(emptyTraineeModuleRows<string>().length, 0);
});

// ---------------------------------------------------------------------------
// Denials - every one yields the SAME empty result, and never reads data
// ---------------------------------------------------------------------------

const DENIAL_CASES: Array<[string, Parameters<typeof makeDeps>[0]]> = [
  ["unauthenticated actor", { requireTraineeIdError: new UnauthenticatedActorError() }],
  [
    "expired / missing session",
    { requireTraineeIdError: new UnauthenticatedActorError("No authenticated trainee") },
  ],
  ["zero eligible offering", { resolveOfferingError: new NoTraineeCourseOfferingError("s1") }],
  [
    "ambiguous eligible offering",
    { resolveOfferingError: new AmbiguousTraineeCourseOfferingError("s1", ["a", "b"]) },
  ],
  [
    "Level 2: capability row absent",
    { offeringId: LEVEL_2_OFFERING_ID, capabilityMap: { SCHEDULE: "ENABLED", CONTACTS: "ENABLED" } },
  ],
  ["capability DISABLED", { capabilityMap: capabilities({ TEACHING_PRACTICE: "DISABLED" }) }],
  ["capability READ_ONLY", { capabilityMap: capabilities({ TEACHING_PRACTICE: "READ_ONLY" }) }],
  ["malformed capability map", { capabilityMap: {} }],
  ["null capability map", { capabilityMap: null }],
];

for (const [label, options] of DENIAL_CASES) {
  test(`denied: ${label} -> uniform empty result, data reader never called`, async () => {
    const { deps } = makeDeps(options);
    const loader = makeLoader([{ id: "secret-lesson" }]);

    const rows = await loadAuthorizedTraineeModuleRowsWithDeps(
      TRAINEE_TEACHING_PRACTICE_CAPABILITY_KEY,
      deps,
      loader.load,
    );

    assert.deepEqual(rows, [], "every denial must return the same empty result");
    assert.equal(loader.seen.length, 0, "no Teaching Practice data may be read when denied");
  });
}

test("every denial is indistinguishable from every other denial", async () => {
  const results = await Promise.all(
    DENIAL_CASES.map(async ([, options]) =>
      loadAuthorizedTraineeModuleRowsWithDeps(
        TRAINEE_TEACHING_PRACTICE_CAPABILITY_KEY,
        makeDeps(options).deps,
        makeLoader([{ id: "secret-lesson" }]).load,
      ),
    ),
  );
  for (const rows of results) {
    assert.deepEqual(rows, []);
  }
});

test("the authorization gate itself returns the uniform denial shape", async () => {
  for (const [, options] of DENIAL_CASES) {
    const authorization = await authorizeTraineeModuleWithDeps(
      TRAINEE_TEACHING_PRACTICE_CAPABILITY_KEY,
      makeDeps(options).deps,
    );
    assert.deepEqual(authorization, { authorized: false });
  }
});

// ---------------------------------------------------------------------------
// Gate ORDER - nothing downstream runs once a gate denies
// ---------------------------------------------------------------------------

test("order is actor -> offering -> capability -> data", async () => {
  const { deps, calls } = makeDeps({
    capabilityMap: capabilities({ TEACHING_PRACTICE: "ENABLED" }),
  });
  const loader = makeLoader([{ id: "lesson-1" }]);

  await loadAuthorizedTraineeModuleRowsWithDeps(
    TRAINEE_TEACHING_PRACTICE_CAPABILITY_KEY,
    deps,
    loader.load,
  );

  assert.deepEqual(calls, ["actor", "offering", `capabilities:${LEVEL_1_OFFERING_ID}`]);
});

test("a failed actor gate stops before the offering and capability reads", async () => {
  const { deps, calls } = makeDeps({
    requireTraineeIdError: new UnauthenticatedActorError(),
  });
  await loadAuthorizedTraineeModuleRowsWithDeps(
    TRAINEE_TEACHING_PRACTICE_CAPABILITY_KEY,
    deps,
    makeLoader([]).load,
  );
  assert.deepEqual(calls, ["actor"], "an anonymous caller must not reach any course read");
});

test("capabilities are read for the RESOLVED offering id only", async () => {
  const { deps, calls } = makeDeps({
    offeringId: LEVEL_2_OFFERING_ID,
    capabilityMap: capabilities({ TEACHING_PRACTICE: "ENABLED" }),
  });
  await loadAuthorizedTraineeModuleRowsWithDeps(
    TRAINEE_TEACHING_PRACTICE_CAPABILITY_KEY,
    deps,
    makeLoader([]).load,
  );
  assert.ok(
    calls.includes(`capabilities:${LEVEL_2_OFFERING_ID}`),
    "the capability read must use the server-resolved offering, never another one",
  );
  assert.ok(!calls.includes(`capabilities:${LEVEL_1_OFFERING_ID}`), "no Level 1 fallback");
});

// ---------------------------------------------------------------------------
// The allowed path - Level 1 regression
// ---------------------------------------------------------------------------

test("Level 1 + TEACHING_PRACTICE ENABLED returns the loader's rows unchanged", async () => {
  const rows = [{ id: "lesson-1" }, { id: "lesson-2" }];
  const { deps } = makeDeps({
    offeringId: LEVEL_1_OFFERING_ID,
    capabilityMap: capabilities({ TEACHING_PRACTICE: "ENABLED" }),
  });
  const loader = makeLoader(rows);

  const result = await loadAuthorizedTraineeModuleRowsWithDeps(
    TRAINEE_TEACHING_PRACTICE_CAPABILITY_KEY,
    deps,
    loader.load,
  );

  assert.deepEqual(result, rows, "an authorized Level 1 trainee still sees the same data");
  assert.equal(loader.seen.length, 1);
  assert.deepEqual(loader.seen[0], {
    traineeId: SESSION_TRAINEE_ID,
    courseOfferingId: LEVEL_1_OFFERING_ID,
  });
});

test("the loader receives the SESSION-derived trainee id, never a client one", async () => {
  const { deps } = makeDeps({
    traineeId: SESSION_TRAINEE_ID,
    capabilityMap: capabilities({ TEACHING_PRACTICE: "ENABLED" }),
  });
  const loader = makeLoader([]);

  await loadAuthorizedTraineeModuleRowsWithDeps(
    TRAINEE_TEACHING_PRACTICE_CAPABILITY_KEY,
    deps,
    loader.load,
  );

  assert.equal(loader.seen[0].traineeId, SESSION_TRAINEE_ID);
  assert.notEqual(
    loader.seen[0].traineeId,
    OTHER_TRAINEE_ID,
    "self-specific filtering must never be driven by a client-supplied id",
  );
});

// ---------------------------------------------------------------------------
// Real defects PROPAGATE - they are never converted into a denial
// ---------------------------------------------------------------------------

test("a capability reader failure propagates", async () => {
  const { deps } = makeDeps({ capabilityError: new Error("capability read failed") });
  await assert.rejects(
    () =>
      loadAuthorizedTraineeModuleRowsWithDeps(
        TRAINEE_TEACHING_PRACTICE_CAPABILITY_KEY,
        deps,
        makeLoader([]).load,
      ),
    /capability read failed/,
  );
});

test("a data reader (Prisma) failure propagates", async () => {
  const { deps } = makeDeps({ capabilityMap: capabilities({ TEACHING_PRACTICE: "ENABLED" }) });
  await assert.rejects(
    () =>
      loadAuthorizedTraineeModuleRowsWithDeps(
        TRAINEE_TEACHING_PRACTICE_CAPABILITY_KEY,
        deps,
        async () => {
          throw new Error("prisma connection reset");
        },
      ),
    /prisma connection reset/,
  );
});

test("an unexpected actor/offering resolver failure propagates", async () => {
  for (const options of [
    { requireTraineeIdError: new Error("session store unreachable") },
    { resolveOfferingError: new Error("enrollment query failed") },
  ]) {
    await assert.rejects(
      () =>
        loadAuthorizedTraineeModuleRowsWithDeps(
          TRAINEE_TEACHING_PRACTICE_CAPABILITY_KEY,
          makeDeps(options).deps,
          makeLoader([]).load,
        ),
      /session store unreachable|enrollment query failed/,
    );
  }
});

// ---------------------------------------------------------------------------
// Purity of this core
// ---------------------------------------------------------------------------

test("the containment core imports nothing impure", () => {
  const src = readCode("./trainee-module-containment-core.ts");
  const valueImports = [
    ...src.matchAll(/^\s*import\s+(?!type\b)[\s\S]*?from\s*["']([^"']+)["']/gm),
  ].map((m) => m[1]);
  const bareImports = [...src.matchAll(/^\s*import\s+["']([^"']+)["']/gm)].map((m) => m[1]);
  const runtimeSpecifiers = [...valueImports, ...bareImports];

  assert.deepEqual(runtimeSpecifiers, [
    "./actor-course-offering-core",
    "@/lib/auth/actor-types",
  ]);
  for (const spec of runtimeSpecifiers) {
    assert.ok(
      !/next\/(headers|cookies)|prisma|auth\/(actor|session)$/.test(spec),
      `core module must not import ${spec}`,
    );
  }
  assert.ok(
    !src.includes("resolveCurrentCourseOffering"),
    "the core must not reference the legacy singleton resolver",
  );
});

// ---------------------------------------------------------------------------
// The wired Teaching Practice readers - containment contract
// ---------------------------------------------------------------------------

/** The three trainee-facing readers this slice contains. */
const TEACHING_PRACTICE_READERS = [
  "listPublishedTeachingPracticeTracksForTrainee",
  "listMyTeachingPracticeLessonsForTrainee",
  "listPublishedTeachingPracticeLessonsForTrainee",
];

/** The source of one exported action, from its declaration to the next one. */
function actionSource(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}`);
  assert.ok(start >= 0, `${name} must still be declared in teaching-practice-student.ts`);
  const rest = src.slice(start + 1);
  const next = rest.indexOf("\nexport async function ");
  return next >= 0 ? rest.slice(0, next) : rest;
}

test("all three trainee Teaching Practice readers are guarded", () => {
  const src = readSource("../actions/teaching-practice-student.ts");
  for (const name of TEACHING_PRACTICE_READERS) {
    const body = actionSource(src, name);
    assert.ok(
      body.includes("loadAuthorizedTraineeModuleRowsWithDeps"),
      `${name} must route through the containment gate`,
    );
    assert.ok(
      body.includes("TRAINEE_TEACHING_PRACTICE_CAPABILITY_KEY"),
      `${name} must require the TEACHING_PRACTICE capability`,
    );
  }
});

test("the readers no longer authorize on Student.isActive or a client id", () => {
  const src = readCode("../actions/teaching-practice-student.ts");

  assert.ok(
    !src.includes("getActiveTraineeOrNull"),
    "the isActive-only pseudo-authentication helper must be gone",
  );
  assert.ok(
    !/prisma\.student\./.test(src),
    "the readers must not re-read a client-supplied Student row as authentication",
  );

  for (const name of TEACHING_PRACTICE_READERS) {
    const body = actionSource(src, name);
    // The parameter is still accepted (caller compatibility) but explicitly
    // discarded, and never used as a query filter or an identity comparison.
    assert.ok(body.includes("void studentId;"), `${name} must explicitly discard studentId`);
    assert.ok(
      !/traineeId:\s*studentId|=== studentId|toTraineeLessonRow\([^)]*studentId/.test(body),
      `${name} must not use the client-supplied studentId as identity`,
    );
  }
});

test("the readers use the session-derived trainee id for self-specific filtering", () => {
  const src = readSource("../actions/teaching-practice-student.ts");

  // "My lessons" must filter participants by the session id.
  assert.ok(
    /participants:\s*\{\s*some:\s*\{\s*traineeId\s*\}/.test(src),
    "listMy... must filter by the session-derived traineeId",
  );
  // isSelf / viewer mapping must come from the session id too.
  assert.ok(
    src.includes("isSelf: t.traineeId === traineeId"),
    "track rows must compute isSelf from the session-derived traineeId",
  );
  assert.ok(
    src.includes("toTraineeLessonRow(lesson, traineeId)"),
    "lesson rows must be mapped against the session-derived traineeId",
  );
});

test("the readers take no courseOfferingId and use no Level 1 fallback", () => {
  const src = readCode("../actions/teaching-practice-student.ts");
  assert.ok(
    !src.includes("resolveCurrentCourseOffering"),
    "no legacy singleton resolver (it returns Level 1 for the known ACTIVE pair)",
  );
  assert.ok(
    !/courseOfferingId\s*:/.test(src) && !src.includes("courseOfferingId,"),
    "no courseOfferingId may be accepted or threaded by a trainee reader",
  );
  assert.ok(
    src.includes("resolveTraineeCourseOffering"),
    "course context must come from the no-argument trainee resolver",
  );
  // No inference paths.
  for (const forbidden of ["groupName:", "level:", "startDate:", "findFirst"]) {
    assert.ok(
      !src.includes(`courseOffering.${forbidden}`),
      `offering must never be inferred via ${forbidden}`,
    );
  }
});

test("the trainee Teaching Practice UI still calls the readers unchanged", () => {
  // L2-C1 is server-side only: the signatures were preserved precisely so this
  // client component needs no edit. If a future slice drops the parameter, that
  // component must change in the same slice.
  const ui = readSource("../../app/student/StudentTeachingPracticeSection.tsx");
  for (const name of TEACHING_PRACTICE_READERS) {
    assert.ok(ui.includes(name), `${name} must still be called by the trainee UI`);
  }
});
