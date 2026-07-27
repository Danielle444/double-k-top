/**
 * TRAINEE COURSE MATERIAL containment - SLICE L2-M1C, UPDATED for P-MATERIALS M2C.
 *
 * The L2-M1C reader was a single-offering capability gate over the GLOBAL library
 * (resolveTraineeCourseOffering + loadAuthorizedTraineeModuleRowsWithDeps). M2C
 * REPLACES it with a UNION-of-active-enabled-offerings reader scoped by the
 * per-material audience join. This file is deliberately rewritten to pin the NEW
 * contract - the old single-offering assertions are not merely deleted; each is
 * replaced by its union-scoped successor, and the untouched-surface guarantees
 * (instructor reader, admin gates, M2B writer paths, upload route) are kept.
 *
 * STRUCTURAL by design: a behavioural test cannot prove the Server Action routes
 * through the union scope core, that the audience filter and signing stayed in
 * the right place, or that the instructor/admin/writer surfaces were left alone.
 * The union DECISION and orchestration are covered behaviourally in
 * trainee-materials-offering-scope-core.test.ts.
 *
 * Uses the existing `tsx` + node:test approach. Run with:
 *   npx tsx --test lib/actions/trainee-course-materials-containment.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MATERIALS_FILE = "./materials.ts";

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

/**
 * Source with block and line comments removed, so the forbidden-identifier
 * assertions test what the module actually DOES, not what its documentation may
 * legitimately mention (the reader's comment explains WHY the single-offering
 * resolver is excluded; naming it in prose must not count as using it).
 */
function readCode(relative: string): string {
  return readSource(relative)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/**
 * The source of one function (exported OR module-private), from its declaration
 * up to the next TOP-LEVEL declaration of any kind, so a following helper is
 * never folded into the body under test.
 */
const NEXT_TOP_LEVEL_DECLARATION =
  /\n(?:export )?(?:async function|function|const|interface|type|enum|class) /;

function functionSource(src: string, name: string): string {
  const start =
    src.indexOf(`export async function ${name}`) >= 0
      ? src.indexOf(`export async function ${name}`)
      : src.indexOf(`async function ${name}`);
  assert.ok(start >= 0, `${name} must still be a function`);
  const rest = src.slice(start + 1);
  const next = rest.search(NEXT_TOP_LEVEL_DECLARATION);
  return next >= 0 ? rest.slice(0, next) : rest;
}

// The real production offering ids - asserted ABSENT from the reader code, since
// the union reader must never hardcode an offering.
const LEVEL_1_OFFERING_ID = "cmrqngqhn00017gcndjixzrh0";
const LEVEL_2_OFFERING_ID = "cmrxk58vc0000lscnfm54bpze";

// ===========================================================================
// The action inventory is unchanged by M2C
// ===========================================================================

test("the materials action inventory is exactly the expected exports", () => {
  const src = readSource(MATERIALS_FILE);
  const exported = [...src.matchAll(/^export async function (\w+)\(/gm)].map((m) => m[1]).sort();
  // getMaterialOfferingOptions is the admin picker reader added in M2D (admin-gated);
  // it is not a trainee surface. Any OTHER new export must be reviewed and, if
  // trainee-facing, contained.
  assert.deepEqual(exported, [
    "createLinkMaterial",
    "getInstructorMaterials",
    "getMaterialOfferingOptions",
    "getMaterialsForAdmin",
    "getStudentMaterials",
    "setMaterialActive",
    "updateMaterial",
  ]);
});

// ===========================================================================
// getStudentMaterials - the union reader contract
// ===========================================================================

test("getStudentMaterials routes through the union scope core (not the single-offering gate)", () => {
  const src = readSource(MATERIALS_FILE);
  const body = functionSource(src, "getStudentMaterials");
  assert.ok(
    body.includes("loadTraineeScopedMaterialsWithDeps"),
    "the trainee reader must route through the M2C union scope orchestration",
  );
  // The single-offering containment path is gone.
  assert.ok(
    !body.includes("loadAuthorizedTraineeModuleRowsWithDeps"),
    "the single-offering containment gate must no longer drive this reader",
  );
});

test("getStudentMaterials takes no client input and derives the trainee from the session", () => {
  const src = readSource(MATERIALS_FILE);
  assert.ok(
    /export async function getStudentMaterials\(\): Promise<RoleMaterialItem\[\]>/.test(src),
    "the action must take NO parameters - no studentId, no courseOfferingId",
  );
  const body = functionSource(src, "getStudentMaterials");
  assert.ok(!/studentId\s*:/.test(body.replace(/studentId: traineeId/g, "")), "no client studentId is accepted");
  assert.ok(!/courseOfferingId\s*:\s*string/.test(body), "no courseOfferingId parameter is accepted");
  assert.ok(
    body.includes("requireCurrentTrainee()"),
    "the trainee id must come from the Actor DAL, not a parameter",
  );
});

test("getStudentMaterials loads ALL of the trainee's enrollments (no single-offering resolve)", () => {
  const body = functionSource(readSource(MATERIALS_FILE), "getStudentMaterials");
  assert.ok(body.includes("prisma.courseEnrollment.findMany"), "all enrollments are loaded");
  assert.ok(body.includes("where: { studentId: traineeId }"), "scoped to the trainee, unfiltered by status");
  // It must select the offering id, the enrollment status and the offering status.
  assert.ok(body.includes("courseOfferingId: true"));
  assert.ok(body.includes("status: true"));
  assert.ok(body.includes("courseOffering: { select: { status: true } }"));
});

test("getStudentMaterials resolves COURSE_MATERIALS per offering via the effective resolver", () => {
  const src = readSource(MATERIALS_FILE);
  const body = functionSource(src, "getStudentMaterials");
  assert.ok(body.includes("getEffectiveCapabilities(courseOfferingId)"), "per-offering effective resolve");
  assert.ok(
    body.includes('[TRAINEE_COURSE_MATERIALS_CAPABILITY_KEY] === "ENABLED"'),
    "only a positively ENABLED capability enables an offering",
  );
  assert.ok(
    /const TRAINEE_COURSE_MATERIALS_CAPABILITY_KEY: CapabilityKey = "COURSE_MATERIALS";/.test(src),
    "the key must be the canonical literal, typed as CapabilityKey",
  );
});

test("the reader uses no single-offering resolver, no legacy singleton, no offering literal, no inference", () => {
  const code = readCode(MATERIALS_FILE);
  assert.ok(!code.includes("resolveTraineeCourseOffering"), "must not collapse a dual enrollment to Level 1");
  assert.ok(!code.includes("resolveCurrentCourseOffering"), "no legacy singleton resolver");
  for (const literal of [LEVEL_1_OFFERING_ID, LEVEL_2_OFFERING_ID]) {
    assert.ok(!code.includes(literal), "no offering id literal may appear in the reader");
  }
  for (const forbidden of ["groupName", "subgroup", "courseLevel", "startDate", "endDate"]) {
    assert.ok(!code.includes(forbidden), `the offering set must not be inferred from ${forbidden}`);
  }
});

// ===========================================================================
// The audience-scoped material query + signing
// ===========================================================================

test("the scoped material query filters on audiences, isActive and trainee visibility", () => {
  const src = readSource(MATERIALS_FILE);
  const helper = functionSource(src, "getTraineeScopedMaterials");
  assert.ok(helper.includes("prisma.courseMaterial.findMany"), "the scoped query reads materials");
  assert.ok(
    helper.includes("audiences: { some: { courseOfferingId: { in: [...enabledOfferingIds] } } }"),
    "visibility is scoped to the enabled offering ids through the audience join",
  );
  assert.ok(helper.includes("isActive: true"), "inactive materials stay hidden");
  assert.ok(
    helper.includes('visibility: { in: ["STUDENTS", "BOTH"] }'),
    "trainee visibility filter preserved",
  );
  assert.ok(helper.includes('orderBy: { createdAt: "desc" }'), "existing order preserved");
});

test("signing happens only inside the scoped query, downstream of the scope gate", () => {
  const src = readCode(MATERIALS_FILE);
  // The action body itself must not read materials or sign directly - it delegates
  // the data path to the loadMaterials binding, which is unreachable unless the
  // scope core resolved a non-empty enabled set.
  const body = functionSource(src, "getStudentMaterials");
  for (const forbidden of ["prisma.courseMaterial.findMany", "signFileUrls", "getSupabaseClient", "createSignedUrl"]) {
    assert.ok(!body.includes(forbidden), `getStudentMaterials must not ${forbidden} directly`);
  }
  // Inside the scoped helper, the findMany precedes signFileUrls (never before).
  const helper = functionSource(src, "getTraineeScopedMaterials");
  const findMany = helper.indexOf("prisma.courseMaterial.findMany");
  const sign = helper.indexOf("signFileUrls(m)");
  assert.ok(findMany >= 0 && sign > findMany, "signing must follow the row read");
});

test("signFileUrls still short-circuits non-FILE (and path-less) rows", () => {
  const src = readSource(MATERIALS_FILE);
  const helper = src.slice(src.indexOf("async function signFileUrls"));
  assert.ok(
    /if \(m\.materialType !== "FILE" \|\| !m\.filePath\) return \{ viewUrl: null, downloadUrl: null \};/.test(helper),
    "LINK rows (and FILE rows with no path) must never be signed",
  );
});

// ===========================================================================
// The denial shape and the UI are unchanged (server-side only slice)
// ===========================================================================

test("the denial shape is the pre-existing empty array and the UI is unchanged", () => {
  // loadTraineeScopedMaterialsWithDeps returns [] on denial / no enabled offering,
  // exactly what this action returned when no materials existed, so the client's
  // empty-state path is unchanged.
  const ui = readSource("../components/CourseMaterialsSection.tsx");
  assert.ok(ui.includes("materials.length === 0"), "the empty-state path must still exist");
  assert.ok(
    /const fetcher = role === "student" \? getStudentMaterials : getInstructorMaterials;/.test(ui),
    "the UI call shape must be unchanged - this slice is server-side only",
  );
  assert.ok(ui.includes("fetcher()"), "the action must still be called with no arguments");
});

// ===========================================================================
// Untouched surfaces - instructor reader, admin gates, M2B writers, upload route
// ===========================================================================

test("the instructor reader is unchanged and NOT routed through the trainee scope core", () => {
  const body = functionSource(readSource(MATERIALS_FILE), "getInstructorMaterials");
  assert.ok(
    body.includes('getMaterialsForVisibilities(["INSTRUCTORS", "BOTH"])'),
    "the instructor reader must still call the shared helper directly",
  );
  assert.ok(!body.includes("loadTraineeScopedMaterialsWithDeps"), "instructor path is not trainee-scoped");
  assert.ok(!body.includes("audiences"), "instructor visibility is not audience-scoped in this slice");
});

test("the shared visibility helper still serves the instructor reader unchanged", () => {
  const src = readSource(MATERIALS_FILE);
  const helper = src.slice(src.indexOf("async function getMaterialsForVisibilities"));
  assert.ok(
    /where: \{ isActive: true, visibility: \{ in: visibilities \} \}/.test(helper),
    "the shared visibility + isActive filter must be untouched",
  );
});

test("admin material actions keep their requireAdmin() gate and are not trainee-scoped", () => {
  const src = readSource(MATERIALS_FILE);
  for (const name of ["getMaterialsForAdmin", "createLinkMaterial", "updateMaterial", "setMaterialActive"]) {
    const body = functionSource(src, name);
    assert.ok(body.includes("await requireAdmin();"), `${name} must still be admin-gated`);
    assert.ok(!body.includes("loadTraineeScopedMaterialsWithDeps"), `${name} must not be trainee-scoped`);
  }
});

test("the M2B writer paths are untouched by M2C", () => {
  const src = readSource(MATERIALS_FILE);
  // create/update still persist audiences transactionally (M2B), unchanged here.
  for (const name of ["createLinkMaterial", "updateMaterial"]) {
    const body = functionSource(src, name);
    assert.ok(body.includes("applyMaterialAudiences(tx,"), `${name} keeps its M2B audience write`);
    assert.ok(body.includes("assertOfferingIdsAllowed(tx,"), `${name} keeps its M2B offering authorization`);
  }
  // setMaterialActive remains a pure soft-hide.
  assert.ok(functionSource(src, "setMaterialActive").includes("data: { isActive }"));
});

test("the admin upload route is untouched by M2C (does not consume the trainee scope core)", () => {
  const route = readSource("../../app/api/admin/materials/upload/route.ts");
  assert.ok(
    !route.includes("trainee-materials-offering-scope-core"),
    "the upload route must not consume the trainee scope core",
  );
  assert.ok(!route.includes("loadTraineeScopedMaterialsWithDeps"), "the upload route is not trainee-scoped");
});
