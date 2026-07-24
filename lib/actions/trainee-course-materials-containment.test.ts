/**
 * SECURITY / LEVEL 2 SLICE L2-M1C - focused tests for TRAINEE COURSE MATERIAL
 * containment.
 *
 * Two halves, both DB-free and storage-free:
 *
 *  1. BEHAVIOURAL - the committed pure containment core
 *     (@/lib/course/trainee-module-containment-core) exercised with the
 *     COURSE_MATERIALS key and with the REAL production capability maps of the
 *     Level 1 and Level 2 offerings, against plain fakes. This locks:
 *     session-derived identity, positive-ENABLED gating, "no material row is
 *     read and no URL is signed before authorization", uniform empty denials,
 *     and infrastructure-error propagation. The material loader fake records
 *     BOTH the Prisma read and the signing step, so an ordering regression in
 *     the core is caught here rather than in production.
 *
 *  2. STRUCTURAL - source assertions over the wired production file
 *     (materials.ts). A behavioural test over the core cannot prove that the
 *     Server Action actually routes through it, that signing stayed downstream
 *     of the gate, or that the instructor/admin surfaces were left alone, so
 *     these pin the wiring itself.
 *
 * Uses the existing `tsx` + node:test approach. Run with:
 *   npx tsx --test lib/actions/trainee-course-materials-containment.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  authorizeTraineeModuleWithDeps,
  isTraineeCapabilityEnabled,
  loadAuthorizedTraineeModuleRowsWithDeps,
  type TraineeModuleContextDeps,
} from "@/lib/course/trainee-module-containment-core";
import {
  AmbiguousTraineeCourseOfferingError,
  NoTraineeCourseOfferingError,
} from "@/lib/course/actor-course-offering-core";
import { UnauthenticatedActorError } from "@/lib/auth/actor-types";
import { CAPABILITY_KEYS, type CapabilityKey } from "@/lib/course/capabilities/capability-keys";
import type { EffectiveCapabilityStatus } from "@/lib/course/capabilities/effective-capability-core";

// The two REAL production offering ids, so the Level 1 / Level 2 cases below
// describe the actual launch state rather than invented placeholders.
const LEVEL_1_OFFERING_ID = "cmrqngqhn00017gcndjixzrh0";
const LEVEL_2_OFFERING_ID = "cmrxk58vc0000lscnfm54bpze";

const SESSION_TRAINEE_ID = "trainee-from-signed-session";

/** The single capability key this slice enforces. */
const MATERIALS_KEY: CapabilityKey = "COURSE_MATERIALS";

type CapabilityMap = Record<CapabilityKey, EffectiveCapabilityStatus>;

/**
 * A full, exhaustive capability map with every key DISABLED except overrides.
 * Derived from the canonical CAPABILITY_KEYS tuple rather than written by hand,
 * so a future key cannot silently leave this map partial (a partial map DENIES,
 * which would make these tests pass for the wrong reason).
 */
function capabilities(overrides: Partial<CapabilityMap> = {}): CapabilityMap {
  const base = Object.fromEntries(
    CAPABILITY_KEYS.map((key) => [key, "DISABLED" as EffectiveCapabilityStatus]),
  ) as CapabilityMap;
  return { ...base, ...overrides };
}

/**
 * The REAL Level 1 production ROWS as of this slice, plus the COURSE_MATERIALS
 * row L2-M1B is provisioning (Level 1 preset intent = ENABLED). Deliberately
 * expressed as the exact set of rows that EXIST rather than "everything is
 * ENABLED": this constant must keep describing the database, not the code.
 *
 * NOTE: this fixture is the Level 1 regression baseline and is only true once
 * L2-M1B has created the Level 1 COURSE_MATERIALS row. That data slice is the
 * deployment gate for this code slice - shipping the gate first would blank the
 * Level 1 materials page.
 */
const LEVEL_1_PRODUCTION_CAPABILITIES: Partial<CapabilityMap> = {
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

/**
 * The REAL Level 2 production rows: ONLY SCHEDULE and CONTACTS exist.
 * COURSE_MATERIALS is row-absent, which under CAP-1 means effective DISABLED -
 * deliberately a PARTIAL map here, since that is exactly the shape the
 * effective-capability reader is fed from. Level 2 must have no row before OR
 * after L2-M1B.
 */
const LEVEL_2_PRODUCTION_CAPABILITIES: Partial<CapabilityMap> = {
  SCHEDULE: "ENABLED",
  CONTACTS: "ENABLED",
};

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

interface MaterialRow {
  id: string;
  materialType: "FILE" | "LINK";
  filePath: string | null;
  externalUrl: string | null;
  viewUrl: string | null;
  downloadUrl: string | null;
}

/** The Level 1 library the production reader would return: one FILE, one LINK. */
const LIBRARY: Omit<MaterialRow, "viewUrl" | "downloadUrl">[] = [
  { id: "file-1", materialType: "FILE", filePath: "materials/booklet.pdf", externalUrl: null },
  { id: "link-1", materialType: "LINK", filePath: null, externalUrl: "https://example.test/x" },
];

/**
 * A stand-in for getMaterialsForVisibilities: it records the Prisma read AND
 * every signing call, in order, so the tests can assert that an unauthorized
 * caller causes NEITHER. Signing happens only over already-loaded FILE rows,
 * exactly as the production helper does.
 */
function makeMaterialLoader() {
  const events: string[] = [];
  const signedPaths: string[] = [];
  return {
    events,
    signedPaths,
    load: async (context: { traineeId: string; courseOfferingId: string }): Promise<MaterialRow[]> => {
      events.push(`prisma.courseMaterial.findMany:${context.courseOfferingId}`);
      return LIBRARY.map((m) => {
        if (m.materialType !== "FILE" || !m.filePath) {
          return { ...m, viewUrl: null, downloadUrl: null };
        }
        events.push(`sign:${m.filePath}`);
        signedPaths.push(m.filePath);
        return { ...m, viewUrl: `signed://view/${m.filePath}`, downloadUrl: `signed://dl/${m.filePath}` };
      });
    },
  };
}

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

/**
 * Source with block and line comments removed. The forbidden-identifier
 * assertions below must test what the module actually DOES, not what its
 * documentation is allowed to mention: the file explains at length why
 * resolveCurrentCourseOffering and a Level 1 fallback are excluded, and naming
 * those in prose must not be mistaken for using them.
 */
function readCode(relative: string): string {
  return readSource(relative)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

// ===========================================================================
// PART 1 - BEHAVIOURAL: the containment contract for COURSE_MATERIALS
// ===========================================================================

test("COURSE_MATERIALS: only a positively ENABLED capability authorizes materials", () => {
  assert.equal(
    isTraineeCapabilityEnabled(MATERIALS_KEY, capabilities({ COURSE_MATERIALS: "ENABLED" })),
    true,
  );

  // READ_ONLY is NOT enough: the trainee materials surface is read-only already,
  // so READ_ONLY would be indistinguishable from ENABLED if it were honoured -
  // the gate stays positive-ENABLED only, which is the fail-closed choice.
  assert.equal(
    isTraineeCapabilityEnabled(MATERIALS_KEY, capabilities({ COURSE_MATERIALS: "READ_ONLY" })),
    false,
  );
  assert.equal(
    isTraineeCapabilityEnabled(MATERIALS_KEY, capabilities({ COURSE_MATERIALS: "DISABLED" })),
    false,
  );

  // Row-absent / partial / empty / malformed / nullish maps all deny.
  assert.equal(isTraineeCapabilityEnabled(MATERIALS_KEY, {}), false);
  assert.equal(isTraineeCapabilityEnabled(MATERIALS_KEY, null), false);
  assert.equal(isTraineeCapabilityEnabled(MATERIALS_KEY, undefined), false);
  assert.equal(
    isTraineeCapabilityEnabled(MATERIALS_KEY, {
      COURSE_MATERIALS: "enabled" as unknown as EffectiveCapabilityStatus,
    }),
    false,
  );
  assert.equal(
    isTraineeCapabilityEnabled(MATERIALS_KEY, {
      COURSE_MATERIALS: true as unknown as EffectiveCapabilityStatus,
    }),
    false,
  );

  // No other capability - notably the two the Level 2 narrow launch DOES
  // enable - may stand in for COURSE_MATERIALS.
  assert.equal(
    isTraineeCapabilityEnabled(MATERIALS_KEY, { SCHEDULE: "ENABLED", CONTACTS: "ENABLED" }),
    false,
  );
  for (const key of CAPABILITY_KEYS.filter((k) => k !== MATERIALS_KEY)) {
    assert.equal(
      isTraineeCapabilityEnabled(MATERIALS_KEY, capabilities({ [key]: "ENABLED" })),
      false,
      `${key} must not authorize course materials`,
    );
  }
});

test("Level 2 production capabilities have no COURSE_MATERIALS row -> effective DISABLED", () => {
  assert.equal("COURSE_MATERIALS" in LEVEL_2_PRODUCTION_CAPABILITIES, false, "the row must be absent");
  assert.equal(isTraineeCapabilityEnabled(MATERIALS_KEY, LEVEL_2_PRODUCTION_CAPABILITIES), false);
});

test("Level 1 (post L2-M1B) keeps COURSE_MATERIALS ENABLED (regression baseline)", () => {
  assert.equal(isTraineeCapabilityEnabled(MATERIALS_KEY, LEVEL_1_PRODUCTION_CAPABILITIES), true);
});

test("Level 1 trainee: materials preserved end to end, signed URLs intact", async () => {
  const { deps } = makeDeps({
    offeringId: LEVEL_1_OFFERING_ID,
    capabilityMap: LEVEL_1_PRODUCTION_CAPABILITIES,
  });
  const loader = makeMaterialLoader();

  const rows = await loadAuthorizedTraineeModuleRowsWithDeps(MATERIALS_KEY, deps, loader.load);

  assert.equal(rows.length, 2, "an authorized Level 1 trainee still sees the same rows");
  const file = rows.find((r) => r.id === "file-1")!;
  assert.equal(file.viewUrl, "signed://view/materials/booklet.pdf");
  assert.equal(file.downloadUrl, "signed://dl/materials/booklet.pdf");

  // LINK rows keep their pre-existing behaviour: never signed, externalUrl kept.
  const link = rows.find((r) => r.id === "link-1")!;
  assert.equal(link.viewUrl, null);
  assert.equal(link.downloadUrl, null);
  assert.equal(link.externalUrl, "https://example.test/x");
  assert.deepEqual(loader.signedPaths, ["materials/booklet.pdf"], "only FILE rows are signed");
});

test("Level 2 trainee: empty result, no material read, no URL signed", async () => {
  const { deps } = makeDeps({
    offeringId: LEVEL_2_OFFERING_ID,
    capabilityMap: LEVEL_2_PRODUCTION_CAPABILITIES,
  });
  const loader = makeMaterialLoader();

  const rows = await loadAuthorizedTraineeModuleRowsWithDeps(MATERIALS_KEY, deps, loader.load);

  assert.deepEqual(rows, [], "a Level 2 read must return the existing empty-array shape");
  assert.deepEqual(loader.events, [], "no CourseMaterial read and no signing may occur");
  assert.deepEqual(loader.signedPaths, []);
});

// ---------------------------------------------------------------------------
// Every denial - same empty result, nothing read, nothing signed
// ---------------------------------------------------------------------------

const DENIAL_CASES: Array<[string, Parameters<typeof makeDeps>[0]]> = [
  ["anonymous caller", { requireTraineeIdError: new UnauthenticatedActorError() }],
  [
    "expired session",
    { requireTraineeIdError: new UnauthenticatedActorError("No authenticated trainee") },
  ],
  [
    "wrong audience (instructor session on a trainee action)",
    { requireTraineeIdError: new UnauthenticatedActorError("No authenticated trainee") },
  ],
  [
    "inactive trainee",
    { requireTraineeIdError: new UnauthenticatedActorError("No authenticated trainee") },
  ],
  ["no eligible offering", { resolveOfferingError: new NoTraineeCourseOfferingError("s1") }],
  [
    "ambiguous offering",
    { resolveOfferingError: new AmbiguousTraineeCourseOfferingError("s1", ["a", "b"]) },
  ],
  [
    "Level 2: COURSE_MATERIALS row absent",
    { offeringId: LEVEL_2_OFFERING_ID, capabilityMap: LEVEL_2_PRODUCTION_CAPABILITIES },
  ],
  ["capability DISABLED", { capabilityMap: capabilities() }],
  ["capability READ_ONLY", { capabilityMap: capabilities({ COURSE_MATERIALS: "READ_ONLY" }) }],
  ["malformed / empty capability map", { capabilityMap: {} }],
  ["null capability map", { capabilityMap: null }],
];

for (const [label, options] of DENIAL_CASES) {
  test(`denied: ${label} -> empty result, no material read, no signed URL`, async () => {
    const { deps } = makeDeps(options);
    const loader = makeMaterialLoader();

    const rows = await loadAuthorizedTraineeModuleRowsWithDeps(MATERIALS_KEY, deps, loader.load);

    assert.deepEqual(rows, []);
    assert.deepEqual(loader.events, [], "no Prisma read and no storage signing when denied");

    // The gate itself must deny too, not merely the row loader.
    assert.deepEqual(await authorizeTraineeModuleWithDeps(MATERIALS_KEY, deps), {
      authorized: false,
    });
  });
}

test("every denial is indistinguishable from every other denial and from 'no materials'", async () => {
  const results = await Promise.all(
    DENIAL_CASES.map(async ([, options]) =>
      loadAuthorizedTraineeModuleRowsWithDeps(MATERIALS_KEY, makeDeps(options).deps, makeMaterialLoader().load),
    ),
  );
  for (const rows of results) assert.deepEqual(rows, []);

  // An AUTHORIZED trainee whose library is genuinely empty gets the very same
  // value, so no Level 1 material metadata (not even "some exist") leaks.
  const authorizedButEmpty = await loadAuthorizedTraineeModuleRowsWithDeps(
    MATERIALS_KEY,
    makeDeps({ capabilityMap: capabilities({ COURSE_MATERIALS: "ENABLED" }) }).deps,
    async () => [],
  );
  assert.deepEqual(authorizedButEmpty, []);
});

// ---------------------------------------------------------------------------
// Gate ORDER
// ---------------------------------------------------------------------------

test("order is actor -> offering -> capability -> material read -> signing", async () => {
  const { deps, calls } = makeDeps({
    capabilityMap: capabilities({ COURSE_MATERIALS: "ENABLED" }),
  });
  const loader = makeMaterialLoader();
  await loadAuthorizedTraineeModuleRowsWithDeps(MATERIALS_KEY, deps, loader.load);

  assert.deepEqual(calls, ["actor", "offering", `capabilities:${LEVEL_1_OFFERING_ID}`]);
  assert.deepEqual(loader.events, [
    `prisma.courseMaterial.findMany:${LEVEL_1_OFFERING_ID}`,
    "sign:materials/booklet.pdf",
  ]);
});

test("an anonymous caller stops at the actor gate", async () => {
  const { deps, calls } = makeDeps({ requireTraineeIdError: new UnauthenticatedActorError() });
  const loader = makeMaterialLoader();
  await loadAuthorizedTraineeModuleRowsWithDeps(MATERIALS_KEY, deps, loader.load);

  assert.deepEqual(calls, ["actor"], "no course or capability read for an anonymous caller");
  assert.deepEqual(loader.events, []);
});

test("capabilities are read for the RESOLVED offering only - no Level 1 fallback", async () => {
  const { deps, calls } = makeDeps({
    offeringId: LEVEL_2_OFFERING_ID,
    capabilityMap: LEVEL_2_PRODUCTION_CAPABILITIES,
  });
  await loadAuthorizedTraineeModuleRowsWithDeps(MATERIALS_KEY, deps, makeMaterialLoader().load);

  assert.ok(calls.includes(`capabilities:${LEVEL_2_OFFERING_ID}`));
  assert.ok(!calls.includes(`capabilities:${LEVEL_1_OFFERING_ID}`), "no Level 1 fallback");
});

test("the material read receives the SESSION-derived trainee id and resolved offering", async () => {
  const seen: { traineeId: string; courseOfferingId: string }[] = [];
  await loadAuthorizedTraineeModuleRowsWithDeps(
    MATERIALS_KEY,
    makeDeps({
      traineeId: SESSION_TRAINEE_ID,
      capabilityMap: capabilities({ COURSE_MATERIALS: "ENABLED" }),
    }).deps,
    async (context) => {
      seen.push(context);
      return [];
    },
  );
  assert.deepEqual(seen, [
    { traineeId: SESSION_TRAINEE_ID, courseOfferingId: LEVEL_1_OFFERING_ID },
  ]);
});

// ---------------------------------------------------------------------------
// Real defects PROPAGATE - never silently reported as "no materials"
// ---------------------------------------------------------------------------

test("infrastructure failures propagate instead of becoming an empty library", async () => {
  await assert.rejects(
    () =>
      loadAuthorizedTraineeModuleRowsWithDeps(
        MATERIALS_KEY,
        makeDeps({ capabilityError: new Error("capability read failed") }).deps,
        makeMaterialLoader().load,
      ),
    /capability read failed/,
  );

  // A Prisma failure inside the material read.
  await assert.rejects(
    () =>
      loadAuthorizedTraineeModuleRowsWithDeps(
        MATERIALS_KEY,
        makeDeps({ capabilityMap: capabilities({ COURSE_MATERIALS: "ENABLED" }) }).deps,
        async () => {
          throw new Error("prisma connection reset");
        },
      ),
    /prisma connection reset/,
  );

  // A Supabase storage failure while signing an AUTHORIZED row.
  await assert.rejects(
    () =>
      loadAuthorizedTraineeModuleRowsWithDeps(
        MATERIALS_KEY,
        makeDeps({ capabilityMap: capabilities({ COURSE_MATERIALS: "ENABLED" }) }).deps,
        async () => {
          throw new Error("storage signing unavailable");
        },
      ),
    /storage signing unavailable/,
  );

  for (const options of [
    { requireTraineeIdError: new Error("session store unreachable") },
    { resolveOfferingError: new Error("enrollment query failed") },
  ]) {
    await assert.rejects(
      () => authorizeTraineeModuleWithDeps(MATERIALS_KEY, makeDeps(options).deps),
      /session store unreachable|enrollment query failed/,
    );
  }
});

// ===========================================================================
// PART 2 - STRUCTURAL: the wired production file
// ===========================================================================

const MATERIALS_FILE = "./materials.ts";

/**
 * The source of one function, from its declaration up to the next TOP-LEVEL
 * declaration of any kind. Cutting at every top-level declaration, not just the
 * next exported function, keeps a private helper that merely FOLLOWS an action
 * from being folded into that action's body and quietly satisfying an assertion.
 */
const NEXT_TOP_LEVEL_DECLARATION =
  /\n(?:export )?(?:async function|function|const|interface|type|enum|class) /;

function functionSource(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}`);
  assert.ok(start >= 0, `${name} must still be an exported action`);
  const rest = src.slice(start + 1);
  const next = rest.search(NEXT_TOP_LEVEL_DECLARATION);
  return next >= 0 ? rest.slice(0, next) : rest;
}

test("the trainee materials action inventory is exactly what this slice contains", () => {
  const src = readSource(MATERIALS_FILE);
  const exported = [...src.matchAll(/^export async function (\w+)\(/gm)].map((m) => m[1]).sort();
  assert.deepEqual(
    exported,
    [
      "createLinkMaterial",
      "getInstructorMaterials",
      "getMaterialsForAdmin",
      "getStudentMaterials",
      "setMaterialActive",
      "updateMaterial",
    ],
    "an unexpected materials action appeared - it must be reviewed and contained too",
  );
  // getStudentMaterials is the ONLY trainee-facing one; the rest are instructor
  // or admin surfaces this slice deliberately does not touch.
});

test("getStudentMaterials routes through the COURSE_MATERIALS gate", () => {
  const src = readSource(MATERIALS_FILE);
  const body = functionSource(src, "getStudentMaterials");
  assert.ok(
    body.includes("loadAuthorizedTraineeModuleRowsWithDeps"),
    "the trainee reader must route through the committed containment gate",
  );
  assert.ok(
    body.includes("TRAINEE_COURSE_MATERIALS_CAPABILITY_KEY"),
    "the trainee reader must require the COURSE_MATERIALS capability",
  );
  assert.ok(
    /const TRAINEE_COURSE_MATERIALS_CAPABILITY_KEY: CapabilityKey = "COURSE_MATERIALS";/.test(src),
    "the key must be the canonical literal, typed as CapabilityKey",
  );
});

test("no material is read and no URL is signed before the gate passes", () => {
  const src = readCode(MATERIALS_FILE);
  const body = functionSource(src, "getStudentMaterials");

  // The reader delegates the whole data path - Prisma read AND signing - to
  // getMaterialsForVisibilities, and that call may only appear INSIDE the gate's
  // loader callback.
  const gate = body.indexOf("loadAuthorizedTraineeModuleRowsWithDeps");
  const load = body.indexOf("getMaterialsForVisibilities");
  assert.ok(gate >= 0 && load > gate, "the data load must come after the gate call");

  // Defence in depth: the action body itself must not touch Prisma or the
  // storage client directly at all.
  for (const forbidden of ["prisma.", "signFileUrls", "getSupabaseClient", "createSignedUrl"]) {
    assert.ok(!body.includes(forbidden), `getStudentMaterials must not call ${forbidden} directly`);
  }
});

test("signing is structurally downstream of the material rows, for FILE rows only", () => {
  const src = readCode(MATERIALS_FILE);
  // signFileUrls is only ever called while mapping rows that have ALREADY been
  // fetched, and it short-circuits on anything that is not a FILE with a path.
  const helper = src.slice(src.indexOf("async function signFileUrls"));
  assert.ok(
    /if \(m\.materialType !== "FILE" \|\| !m\.filePath\) return \{ viewUrl: null, downloadUrl: null \};/.test(
      helper,
    ),
    "LINK rows (and FILE rows with no path) must never be signed",
  );
  const visibilities = src.slice(src.indexOf("async function getMaterialsForVisibilities"));
  const findMany = visibilities.indexOf("prisma.courseMaterial.findMany");
  const sign = visibilities.indexOf("signFileUrls(m)");
  assert.ok(findMany >= 0 && sign > findMany, "signing must follow the row read, never precede it");
});

test("the trainee reader accepts no client input at all", () => {
  const src = readCode(MATERIALS_FILE);
  const body = functionSource(src, "getStudentMaterials");
  assert.ok(
    /export async function getStudentMaterials\(\): Promise<RoleMaterialItem\[\]>/.test(src),
    "the action must take NO parameters - no studentId, no courseOfferingId",
  );
  assert.ok(!/courseOfferingId\s*:\s*string/.test(src), "no courseOfferingId may be accepted");
  assert.ok(!/studentId/.test(body), "no client-supplied trainee id anywhere in the reader");
});

test("no legacy offering resolver, no Level 1 literal, no inference", () => {
  const src = readCode(MATERIALS_FILE);
  assert.ok(
    !src.includes("resolveCurrentCourseOffering"),
    "no legacy singleton resolver (it returns Level 1 for the known ACTIVE pair)",
  );
  assert.ok(
    src.includes("resolveTraineeCourseOffering"),
    "course context must come from the no-argument trainee resolver",
  );
  for (const literal of [LEVEL_1_OFFERING_ID, LEVEL_2_OFFERING_ID]) {
    assert.ok(!src.includes(literal), "no offering id literal may appear in the reader");
  }
  for (const forbidden of ["groupName", "subgroup", "courseLevel", "startDate", "endDate"]) {
    assert.ok(!src.includes(forbidden), `the offering must not be inferred from ${forbidden}`);
  }
});

test("the containment binding supplies only server-owned dependencies", () => {
  const src = readCode(MATERIALS_FILE);
  assert.ok(
    /requireTraineeId:\s*async \(\) => \(await requireCurrentTrainee\(\)\)\.id,/.test(src),
    "the trainee id must come from the Actor DAL, not a parameter",
  );
  assert.ok(
    /resolveTraineeCourseOffering,\s*\n\s*getEffectiveCapabilities,/.test(src),
    "the offering and capability readers must be the committed server ones",
  );
});

test("the denial shape is the pre-existing empty array", () => {
  // loadAuthorizedTraineeModuleRowsWithDeps returns a fresh [] on denial, which
  // is exactly what this action returned when no materials existed, so the
  // client component's "אין חומרי קורס זמינים כרגע." path is unchanged.
  const ui = readSource("../components/CourseMaterialsSection.tsx");
  assert.ok(ui.includes("materials.length === 0"), "the empty-state path must still exist");
  assert.ok(
    /const fetcher = role === "student" \? getStudentMaterials : getInstructorMaterials;/.test(ui),
    "the UI call shape must be unchanged - this slice is server-side only",
  );
  assert.ok(ui.includes("fetcher()"), "the action must still be called with no arguments");
});

// ---------------------------------------------------------------------------
// Untouched surfaces
// ---------------------------------------------------------------------------

test("the instructor materials path is unchanged by this slice", () => {
  const body = functionSource(readSource(MATERIALS_FILE), "getInstructorMaterials");
  assert.ok(
    body.includes('getMaterialsForVisibilities(["INSTRUCTORS", "BOTH"])'),
    "the instructor reader must still call the shared helper directly",
  );
  assert.ok(
    !body.includes("TRAINEE_COURSE_MATERIALS_CAPABILITY_KEY"),
    "the instructor path must not be routed through the trainee gate",
  );
  assert.ok(
    !body.includes("loadAuthorizedTraineeModuleRowsWithDeps"),
    "the instructor path must not be gated by this slice",
  );
});

test("the shared visibility helper still serves both roles unchanged", () => {
  const src = readSource(MATERIALS_FILE);
  const helper = src.slice(src.indexOf("async function getMaterialsForVisibilities"));
  assert.ok(
    /where: \{ isActive: true, visibility: \{ in: visibilities \} \}/.test(helper),
    "the visibility + isActive filter must be untouched",
  );
  assert.ok(
    src.includes('getMaterialsForVisibilities(["STUDENTS", "BOTH"])'),
    "the trainee visibility set must be unchanged",
  );
});

test("admin material actions keep their requireAdmin() gate", () => {
  const src = readSource(MATERIALS_FILE);
  for (const name of [
    "getMaterialsForAdmin",
    "createLinkMaterial",
    "updateMaterial",
    "setMaterialActive",
  ]) {
    assert.ok(
      functionSource(src, name).includes("await requireAdmin();"),
      `${name} must still be admin-gated`,
    );
    assert.ok(
      !functionSource(src, name).includes("TRAINEE_COURSE_MATERIALS_CAPABILITY_KEY"),
      `${name} must not be routed through the trainee gate`,
    );
  }
});

test("the admin upload route is untouched by this slice", () => {
  const route = readSource("../../app/api/admin/materials/upload/route.ts");
  assert.ok(!/\bCOURSE_MATERIALS\b/.test(route), "the upload route must not reference the key");
  assert.ok(
    !route.includes("trainee-module-containment-core"),
    "the upload route must not consume the trainee gate",
  );
});
