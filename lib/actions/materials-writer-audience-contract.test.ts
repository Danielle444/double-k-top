/**
 * P-MATERIALS M2B - STRUCTURAL contract tests over the WIRED writer and
 * notification files. A behavioural test of the Server Action / Route Handler
 * would require mocking Prisma, Supabase, next/cache and the auth session; the
 * repo's established pattern (see trainee-course-materials-containment.test.ts
 * Part 2) is to pin the wiring itself by source assertion, while the actual
 * decision logic is covered behaviourally in material-audience-write.test.ts and
 * material-audience-reconcile-core.test.ts.
 *
 * This file deliberately never spells the audience model identifier, so it stays
 * outside the confinement walk in
 * prisma/m0-course-material-audience.contract.test.ts.
 *
 * Uses the existing `tsx` + node:test approach. Run with:
 *   npx tsx --test lib/actions/materials-writer-audience-contract.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

const MATERIALS = readSource("./materials.ts");
const NOTIFICATIONS = readSource("./notifications.ts");
const ROUTE = readSource("../../app/api/admin/materials/upload/route.ts");

/**
 * The source of one exported function, from its declaration up to the next
 * TOP-LEVEL declaration (mirrors the containment test's extractor so a following
 * helper is never folded into the body under test).
 */
const NEXT_TOP_LEVEL =
  /\n(?:export )?(?:async function|function|const|interface|type|enum|class) /;

function functionSource(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}`);
  assert.ok(start >= 0, `${name} must still be an exported function`);
  const rest = src.slice(start + 1);
  const next = rest.search(NEXT_TOP_LEVEL);
  return next >= 0 ? rest.slice(0, next) : rest;
}

// ===========================================================================
// Input contract - courseOfferingIds is mandatory on both create/edit inputs
// ===========================================================================

test("the create and update input types declare courseOfferingIds (runtime-mandatory)", () => {
  // The TYPE is optional on purpose (so the pre-M2D UI still compiles); the
  // "at least one" requirement is enforced at RUNTIME by the normalizer, which
  // rejects undefined/empty. Both interfaces must carry the field.
  assert.match(MATERIALS, /interface CreateLinkMaterialInput \{[\s\S]*?courseOfferingIds\?: string\[\][\s\S]*?\}/);
  assert.match(MATERIALS, /interface UpdateMaterialInput \{[\s\S]*?courseOfferingIds\?: string\[\][\s\S]*?\}/);
});

// ===========================================================================
// createLinkMaterial - normalize, tx(authorize + create + audiences), then notify
// ===========================================================================

test("createLinkMaterial normalizes ids, writes in a transaction, notifies after commit", () => {
  const body = functionSource(MATERIALS, "createLinkMaterial");
  assert.ok(body.includes("await requireAdmin();"), "requireAdmin must remain");
  assert.ok(
    body.includes("normalizeMaterialAudienceOfferingIds(input.courseOfferingIds)"),
    "offering ids must be normalized via the M2A core",
  );

  const tx = body.indexOf("prisma.$transaction");
  const authorize = body.indexOf("assertOfferingIdsAllowed(tx,");
  const create = body.indexOf("tx.courseMaterial.create");
  const audiences = body.indexOf("applyMaterialAudiences(tx,");
  const notify = body.indexOf("createMaterialAddedNotifications");

  assert.ok(tx >= 0, "the create must run inside a transaction");
  assert.ok(authorize > tx, "offering authorization must be re-checked inside the transaction");
  assert.ok(create > authorize, "the material is created after authorization");
  assert.ok(audiences > create, "audiences are written after the material, inside the tx");
  assert.ok(notify > audiences, "notifications fire only after the transaction body");
});

// ===========================================================================
// updateMaterial - normalize, existence check, tx(authorize + update + reconcile)
// ===========================================================================

test("updateMaterial normalizes ids and reconciles audiences inside a transaction", () => {
  const body = functionSource(MATERIALS, "updateMaterial");
  assert.ok(body.includes("await requireAdmin();"), "requireAdmin must remain");
  assert.ok(
    body.includes("normalizeMaterialAudienceOfferingIds(data.courseOfferingIds)"),
    "offering ids must be normalized",
  );
  const tx = body.indexOf("prisma.$transaction");
  const authorize = body.indexOf("assertOfferingIdsAllowed(tx,");
  const update = body.indexOf("tx.courseMaterial.update");
  const audiences = body.indexOf("applyMaterialAudiences(tx,");
  assert.ok(tx >= 0 && authorize > tx, "authorization inside the transaction");
  assert.ok(update > authorize && audiences > update, "update then reconcile, both in the tx");
});

// ===========================================================================
// setMaterialActive - untouched by M2B (soft hide only, no audience wiring)
// ===========================================================================

test("setMaterialActive is unchanged: admin-gated soft hide, no audience wiring", () => {
  const body = functionSource(MATERIALS, "setMaterialActive");
  assert.ok(body.includes("await requireAdmin();"), "requireAdmin must remain");
  assert.ok(body.includes("data: { isActive }"), "still a pure isActive soft-hide");
  for (const forbidden of ["applyMaterialAudiences", "normalizeMaterialAudienceOfferingIds", "$transaction"]) {
    assert.ok(!body.includes(forbidden), `setMaterialActive must not gain ${forbidden}`);
  }
});

// ===========================================================================
// Reader shapes untouched by M2B
// ===========================================================================

test("the M2B writer helpers do not leak into the trainee/instructor readers", () => {
  // The M2B invariant this pins is writer/reader ISOLATION - not which reader
  // shape is in use (that is owned by the M2C union contract in
  // trainee-course-materials-containment.test.ts). Neither reader may call a
  // writer/authorization helper.
  const student = functionSource(MATERIALS, "getStudentMaterials");
  assert.ok(!student.includes("applyMaterialAudiences"), "trainee reader must not gain a writer helper");
  assert.ok(!student.includes("assertOfferingIdsAllowed"), "trainee reader must not authorize writes");
  const instructor = functionSource(MATERIALS, "getInstructorMaterials");
  assert.ok(
    instructor.includes('getMaterialsForVisibilities(["INSTRUCTORS", "BOTH"])'),
    "instructor reader unchanged",
  );
  assert.ok(!instructor.includes("applyMaterialAudiences"), "instructor reader must not gain a writer helper");
});

// ===========================================================================
// FILE upload route
// ===========================================================================

test("the upload route keeps its admin/session check and PDF validation", () => {
  assert.ok(ROUTE.includes("prisma.adminEmail.findUnique"), "route admin lookup preserved");
  assert.ok(ROUTE.includes("!adminEmail.isActive"), "inactive admin still rejected");
  assert.ok(ROUTE.includes("isPdfBuffer(buffer)"), "PDF magic-byte check preserved");
  assert.ok(ROUTE.includes("MAX_FILE_SIZE_BYTES"), "size cap preserved");
});

test("the upload route parses courseOfferingIds from multipart before uploading", () => {
  const parse = ROUTE.indexOf('normalizeMaterialAudienceOfferingIds(formData.getAll("courseOfferingIds"))');
  const upload = ROUTE.indexOf(".upload(storagePath");
  assert.ok(parse >= 0, "offering ids parsed from repeated multipart fields");
  assert.ok(upload > parse, "a malformed/empty selection fails before any storage upload");
});

test("the upload route writes material + audiences in one transaction", () => {
  const tx = ROUTE.indexOf("prisma.$transaction");
  const authorize = ROUTE.indexOf("assertOfferingIdsAllowed(tx,");
  const audiences = ROUTE.indexOf("applyMaterialAudiences(tx,");
  assert.ok(tx >= 0, "the metadata write runs in a transaction");
  assert.ok(authorize > tx, "authorization re-checked inside the tx");
  assert.ok(audiences > tx, "audiences written inside the same tx");
  assert.ok(ROUTE.includes("tx.courseMaterial.create"), "create runs on the tx client");
  assert.ok(ROUTE.includes("tx.courseMaterial.update"), "replace runs on the tx client");
});

test("the old-file cleanup happens AFTER the successful commit, not before", () => {
  const tx = ROUTE.indexOf("prisma.$transaction");
  // The success-path removal of the superseded file must appear after the tx.
  const successCleanup = ROUTE.indexOf("existing.filePath !== storagePath", tx);
  const removeExisting = ROUTE.indexOf("remove([existing.filePath])");
  assert.ok(tx >= 0 && successCleanup > tx, "superseded-file cleanup is deferred past the commit");
  assert.ok(removeExisting > tx, "the destructive old-file removal never precedes the DB write");
});

test("the upload route still notifies only for a brand-new material", () => {
  assert.ok(ROUTE.includes("if (!existing) {"), "notification guarded to new materials");
  const guard = ROUTE.indexOf("if (!existing) {");
  const notify = ROUTE.indexOf("createMaterialAddedNotifications", guard);
  assert.ok(notify > guard, "notification is inside the new-material branch");
});

// ===========================================================================
// Notification suppression
// ===========================================================================

test("createMaterialAddedNotifications suppresses the trainee branch", () => {
  const body = functionSource(NOTIFICATIONS, "createMaterialAddedNotifications");
  assert.ok(!body.includes("prisma.student.findMany"), "no global student fanout remains");
  assert.ok(!body.includes('recipientRole: "STUDENT"'), "no STUDENT notification is created");
  assert.ok(
    /M2B[\s\S]*suppress/i.test(body),
    "an explicit comment must record that trainee notifications are temporarily suppressed",
  );
});

test("createMaterialAddedNotifications preserves the instructor branch exactly", () => {
  const body = functionSource(NOTIFICATIONS, "createMaterialAddedNotifications");
  assert.ok(body.includes('params.visibility === "INSTRUCTORS" || params.visibility === "BOTH"'));
  assert.ok(body.includes("prisma.instructor.findMany"), "instructor recipients still resolved");
  assert.ok(body.includes('recipientRole: "INSTRUCTOR"'), "instructor notifications still created");
});

test("other notification types are untouched by M2B", () => {
  // The attendance notification sync is unrelated and must remain intact.
  const body = functionSource(NOTIFICATIONS, "syncAttendanceMarkedNotification");
  assert.ok(body.includes('type: "ATTENDANCE_MARKED"'), "attendance notifications unchanged");
});

// ===========================================================================
// The pure notification-recipient core is NOT deleted (M3 will consume it)
// ===========================================================================

test("the pure material-notification-recipient core is preserved for M3", () => {
  const core = readSource("./../course/capabilities/material-notification-recipient-core.ts");
  assert.ok(core.includes("MATERIAL_NOTIFICATION_CAPABILITY_KEY"), "the M3 core must remain");
});
