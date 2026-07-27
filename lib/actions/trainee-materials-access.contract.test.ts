/**
 * LEVEL 2 MATERIALS ENTRY POINT - contract tests for the navigation unlock action
 * (lib/actions/trainee-materials-access.ts).
 *
 * STRUCTURAL by design, mirroring lib/actions/trainee-course-materials-
 * containment.test.ts: a behavioural test cannot prove that a Server Action takes
 * no client identity, that it delegates to the SHARED scope resolver instead of
 * growing a second capability implementation, or that it never reads a material
 * row. The scope DECISION itself is covered behaviourally (and shared with the
 * content reader) in lib/course/trainee-materials-offering-scope-core.test.ts,
 * so it is deliberately not re-tested here.
 *
 * Uses the existing `tsx` + node:test approach. Run with:
 *   npx tsx --test lib/actions/trainee-materials-access.contract.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ACCESS_FILE = "./trainee-materials-access.ts";
const MATERIALS_FILE = "./materials.ts";
const SCOPE_CORE_FILE = "../course/trainee-materials-offering-scope-core.ts";

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

/**
 * Source with block and line comments removed, so the forbidden-identifier
 * assertions test what the module actually DOES, not what its documentation
 * legitimately mentions (the header explains WHY the single-offering resolver and
 * the level allow-list are excluded; naming them in prose must not count as
 * using them).
 */
function readCode(relative: string): string {
  return readSource(relative)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

// The real production offering ids - asserted ABSENT, since neither the unlock
// action nor the shared resolver may hardcode an offering.
const LEVEL_1_OFFERING_ID = "cmrqngqhn00017gcndjixzrh0";
const LEVEL_2_OFFERING_ID = "cmrxk58vc0000lscnfm54bpze";

// ===========================================================================
// The action surface
// ===========================================================================

test("the module is a Server Action file exporting exactly one action", () => {
  const src = readSource(ACCESS_FILE);
  assert.ok(/^"use server";/m.test(src), 'the module must be a "use server" action file');
  const exported = [...src.matchAll(/^export async function (\w+)\(/gm)].map((m) => m[1]).sort();
  assert.deepEqual(exported, ["hasAnyActiveEnabledCourseMaterialsOffering"]);
});

test("the action takes NO parameters and returns a boolean", () => {
  const src = readSource(ACCESS_FILE);
  assert.ok(
    /export async function hasAnyActiveEnabledCourseMaterialsOffering\(\): Promise<boolean>/.test(src),
    "the action must take NO parameters - no studentId, no courseOfferingId - and return Promise<boolean>",
  );
});

test("the trainee is session-derived through the Actor DAL", () => {
  const code = readCode(ACCESS_FILE);
  assert.ok(code.includes("requireCurrentTrainee()"), "the trainee id must come from the Actor DAL");
  assert.ok(
    code.includes('from "@/lib/auth/actor"'),
    "requireCurrentTrainee must come from the committed Actor DAL, not a local re-implementation",
  );
});

test("no client-supplied identity of any kind is accepted", () => {
  const code = readCode(ACCESS_FILE);
  // The only `studentId:` allowed is the Prisma WHERE built from the SESSION id.
  assert.ok(
    !/studentId\s*:/.test(code.replace(/studentId: traineeId/g, "")),
    "no client studentId is accepted",
  );
  assert.ok(!/courseOfferingId\s*:\s*string\s*\)/.test(code), "no courseOfferingId parameter is accepted");
  assert.ok(
    !/\bfunction hasAnyActiveEnabledCourseMaterialsOffering\([^)]/.test(code),
    "the action signature must stay empty",
  );
});

// ===========================================================================
// One shared capability resolver - no second implementation
// ===========================================================================

test("the action delegates to the SHARED scope resolver", () => {
  const code = readCode(ACCESS_FILE);
  assert.ok(
    code.includes("resolveTraineeEnabledMaterialsOfferingIdsWithDeps"),
    "the unlock must route through the shared trainee-materials scope resolver",
  );
  assert.ok(
    code.includes('from "@/lib/course/trainee-materials-offering-scope-core"'),
    "the resolver must be imported from the committed scope core",
  );
});

test("the action and the content reader use the SAME resolver, capability key and enrollment projection", () => {
  const access = readCode(ACCESS_FILE);
  const materials = readCode(MATERIALS_FILE);
  const core = readCode(SCOPE_CORE_FILE);

  // Same shared resolver, exported once by the core.
  assert.ok(
    core.includes("export async function resolveTraineeEnabledMaterialsOfferingIdsWithDeps"),
    "the shared resolver must live in the scope core",
  );
  assert.ok(
    materials.includes("loadTraineeScopedMaterialsWithDeps"),
    "the content reader still routes through the core orchestration",
  );

  // Same effective-capability read, same canonical key, same positive test.
  for (const src of [access, materials]) {
    assert.ok(src.includes("getEffectiveCapabilities(courseOfferingId)"), "per-offering effective resolve");
    assert.ok(
      src.includes('[TRAINEE_COURSE_MATERIALS_CAPABILITY_KEY] === "ENABLED"'),
      "only a positively ENABLED capability counts",
    );
    assert.ok(
      /const TRAINEE_COURSE_MATERIALS_CAPABILITY_KEY: CapabilityKey = "COURSE_MATERIALS";/.test(src),
      "the key must be the canonical literal, typed as CapabilityKey",
    );
    // Same enrollment projection: ALL enrollments for the session trainee.
    assert.ok(src.includes("prisma.courseEnrollment.findMany"), "all enrollments are loaded");
    assert.ok(src.includes("where: { studentId: traineeId }"), "scoped to the trainee, unfiltered by status");
    assert.ok(src.includes("courseOfferingId: true"));
    assert.ok(src.includes("courseOffering: { select: { status: true } }"));
  }
});

test("the action re-implements no scope decision of its own", () => {
  const code = readCode(ACCESS_FILE);
  assert.ok(
    !code.includes("resolveTraineeMaterialsOfferingIdsFromRows"),
    "the pure row decision must be reached only through the shared resolver",
  );
  for (const forbidden of ['=== "ACTIVE"', '!== "ACTIVE"', "PLANNED", "ARCHIVED", "INACTIVE"]) {
    assert.ok(
      !code.includes(forbidden),
      `the action must not re-implement the ${forbidden} status filtering the core owns`,
    );
  }
});

// ===========================================================================
// No fallback, no inference, no offering literal
// ===========================================================================

test("no single-offering resolver, no legacy singleton, no offering literal, no inference", () => {
  const code = readCode(ACCESS_FILE);
  assert.ok(!code.includes("resolveTraineeCourseOffering"), "must not collapse a dual enrollment to Level 1");
  assert.ok(!code.includes("resolveCurrentCourseOffering"), "no legacy singleton resolver");
  assert.ok(!code.includes("courseSettings"), "no legacy global course settings");
  for (const literal of [LEVEL_1_OFFERING_ID, LEVEL_2_OFFERING_ID]) {
    assert.ok(!code.includes(literal), "no offering id literal may appear in the unlock action");
  }
  for (const forbidden of ["groupName", "subgroup", "courseLevel", "level", "startDate", "endDate", "name"]) {
    assert.ok(
      !code.includes(forbidden),
      `access must not be inferred from ${forbidden}`,
    );
  }
});

// ===========================================================================
// The unlock reads no content
// ===========================================================================

test("the action reads NO material row, NO audience row and signs NO URL", () => {
  const code = readCode(ACCESS_FILE);
  assert.ok(!code.includes("courseMaterial"), "no CourseMaterial query");
  assert.ok(!code.includes("audience"), "no CourseMaterialAudience query");
  assert.ok(!code.includes("createSignedUrl"), "no storage URL signing");
  assert.ok(!code.includes("getSupabaseClient"), "no storage client");
  assert.ok(!code.includes("signFileUrls"), "no signing helper");
  assert.ok(
    !code.includes("loadTraineeScopedMaterialsWithDeps"),
    "the unlock must stop at the scope decision and never invoke the material load",
  );
});

test("the action only reports emptiness - it returns no offering identity to the client", () => {
  const src = readSource(ACCESS_FILE);
  assert.ok(
    src.includes("return enabledOfferingIds.length > 0;"),
    "the client learns only WHETHER any offering enables materials, never which one",
  );
  assert.ok(
    /Promise<boolean>/.test(src) && !/Promise<(string|readonly string)/.test(src),
    "the action must not widen into returning offering ids",
  );
});

// ===========================================================================
// The authoritative content gate is untouched
// ===========================================================================

test("lib/actions/materials.ts keeps its exact export inventory (the content gate is unchanged)", () => {
  const src = readSource(MATERIALS_FILE);
  const exported = [...src.matchAll(/^export async function (\w+)\(/gm)].map((m) => m[1]).sort();
  assert.deepEqual(exported, [
    "createLinkMaterial",
    "getInstructorMaterials",
    "getMaterialOfferingOptions",
    "getMaterialsForAdmin",
    "getStudentMaterials",
    "setMaterialActive",
    "updateMaterial",
  ]);
  assert.ok(
    !src.includes("hasAnyActiveEnabledCourseMaterialsOffering"),
    "the navigation unlock must NOT be added to the content-gate module",
  );
});
