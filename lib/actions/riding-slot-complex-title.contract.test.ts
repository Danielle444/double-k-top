// RC-A2 - DB-free CONTRACT/source test for the complex-session title writer and
// the publication title-snapshot behavior. Runs no Prisma and opens no DB (the
// repo's DATABASE_URL reaches production, and the RC-A2 deployment gate forbids
// exercising any live title/titleSnapshot path): it statically inspects the two
// writer/snapshot modules and asserts the invariants the RC-A2 contract requires.
// Same convention as riding-complex-template-create.contract.test.ts.
//
// Run: npx tsx --test lib/actions/riding-slot-complex-title.contract.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Strip block + line comments so invariants are checked against real CODE only,
// never the (deliberately prose-y) contract comments - which legitimately name
// title, titleSnapshot, "תרגול הדרכה", version, etc.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const writerSrc = stripComments(
  readFileSync(fileURLToPath(new URL("./riding-slot-complex.ts", import.meta.url)), "utf8")
);
const pubSrc = stripComments(
  readFileSync(fileURLToPath(new URL("./riding-slot-complex-publications.ts", import.meta.url)), "utf8")
);

function slice(src: string, startMarker: string, endMarker: string): string {
  const start = src.indexOf(startMarker);
  assert.ok(start > -1, `start marker not found: ${startMarker}`);
  const end = src.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `end marker not found after start: ${endMarker}`);
  return src.slice(start, end);
}

// The title writer internal body only.
function titleInternalRegion(): string {
  return slice(
    writerSrc,
    "async function saveComplexPlanTitleInternal",
    "export async function saveRidingSlotComplexPlanTitleAsAdmin"
  );
}

// The publish internal body only (never unpublish or the readers).
function publishRegion(): string {
  return slice(
    pubSrc,
    "async function publishComplexRidingPlanInternal",
    "export async function publishComplexRidingPlanAsAdmin"
  );
}

function unpublishRegion(): string {
  return slice(
    pubSrc,
    "async function unpublishComplexRidingPlanInternal",
    "export async function unpublishComplexRidingPlanAsAdmin"
  );
}

// The complex-plan create/copy internal (must remain title-free in RC-A2).
function createRegion(): string {
  return slice(
    writerSrc,
    "async function createComplexPlanInternal",
    "export async function createRidingSlotComplexPlanAsAdmin"
  );
}

// --- validation delegated to the RC-A0 core -------------------------------

test("the title writer delegates validation to the RC-A0 core and never duplicates its rules", () => {
  const region = titleInternalRegion();
  assert.ok(region.includes("validateComplexSessionTitle("), "must call the RC-A0 core");
  assert.ok(region.includes("titleValidation.message"), "must surface the core's stable message on rejection");
  // No duplicated trim / max-length / newline logic in the writer.
  assert.ok(!region.includes(".trim("), "must not re-implement trim");
  assert.ok(!region.includes("60"), "must not re-implement the max-length rule");
  assert.ok(!/[\\][rn]/.test(region), "must not re-implement a newline/CR check");
});

// --- optimistic concurrency + no-op / version-bump ------------------------

test("the title writer takes the advisory lock and checks version before any mutation", () => {
  const region = titleInternalRegion();
  const lock = region.indexOf("pg_advisory_xact_lock");
  const versionCheck = region.indexOf("plan.version !== data.expectedVersion");
  const update = region.indexOf("ridingSlotComplexPlan.updateMany(");
  assert.ok(lock > -1, "advisory lock missing");
  assert.ok(versionCheck > -1, "version check missing");
  assert.ok(update > -1, "conditional update missing");
  assert.ok(lock < versionCheck, "lock must precede the version check");
  assert.ok(versionCheck < update, "version check must precede the update");
});

test("a no-op (unchanged normalized title) returns before the update - no version bump", () => {
  const region = titleInternalRegion();
  const noop = region.indexOf("plan.title === normalizedTitle");
  const update = region.indexOf("ridingSlotComplexPlan.updateMany(");
  assert.ok(noop > -1, "no-op guard missing");
  assert.ok(noop < update, "the no-op guard must short-circuit BEFORE the update/version bump");
});

test("a changed title folds title + version increment into ONE version-guarded update", () => {
  const region = titleInternalRegion();
  const update = slice(region, "ridingSlotComplexPlan.updateMany(", "StalePlanRollback");
  assert.ok(update.includes("id: plan.id"), "update must target the resolved plan id");
  assert.ok(update.includes("version: data.expectedVersion"), "update must be guarded by expectedVersion");
  assert.ok(update.includes("title: normalizedTitle"), "update must write the normalized title");
  assert.ok(update.includes("version: { increment: 1 }"), "update must increment the version");
  assert.ok(region.includes("actorData"), "update must carry dual-actor audit fields");
});

test("the title writer maps a lost update and lock timeout to the existing stable outcomes", () => {
  const region = titleInternalRegion();
  assert.ok(region.includes("StalePlanRollback"), "must fail closed via StalePlanRollback");
  assert.ok(region.includes("STALE_PLAN"), "must map to the stable STALE_PLAN copy");
  assert.ok(region.includes("P2028") && region.includes("LOCK_TIMEOUT"), "must map P2028 to LOCK_TIMEOUT");
});

// --- source-of-truth: title only on the plan ------------------------------

test("the title writer mutates ONLY the plan - never block/station/pair/ScheduleItem/RidingSlot", () => {
  const region = titleInternalRegion();
  for (const forbidden of [
    "ridingSlotComplexBlock",
    "ridingSlotComplexStation",
    "ridingSlotComplexPair",
    "scheduleItem",
    "ridingSlot.update",
  ]) {
    assert.ok(!region.includes(forbidden), `title writer must not touch ${forbidden}`);
  }
  // The only plan write is the single guarded updateMany (no create/delete).
  assert.ok(!region.includes("ridingSlotComplexPlan.create("), "title writer must not create a plan");
  assert.ok(!region.includes("ridingSlotComplexPlan.delete"), "title writer must not delete a plan");
});

test("the title writer never writes titleSnapshot (that is a publish-only concern)", () => {
  assert.ok(!titleInternalRegion().includes("titleSnapshot"), "titleSnapshot must not be written by the title writer");
});

// --- authorization boundaries ---------------------------------------------

test("the admin title wrapper is gated by requireAdmin", () => {
  const region = slice(
    writerSrc,
    "export async function saveRidingSlotComplexPlanTitleAsAdmin",
    "export async function saveRidingSlotComplexPlanTitleAsInstructor"
  );
  assert.ok(region.includes("requireAdmin()"), "admin wrapper must call requireAdmin()");
});

test("the instructor title wrapper derives identity from the signed session, not a client id", () => {
  const region = slice(
    writerSrc,
    "export async function saveRidingSlotComplexPlanTitleAsInstructor",
    "const blockSaveInputSchema"
  );
  assert.ok(region.includes("runComplexPlanInstructorWrite"), "must route through the instructor write boundary");
  assert.ok(region.includes("getCurrentInstructor"), "must resolve identity from the signed session");
  assert.ok(!region.includes("instructorId"), "must not accept/read a client-supplied instructorId");
});

// --- publication snapshot --------------------------------------------------

test("publish snapshots the normalized live title into titleSnapshot on create AND update", () => {
  const region = publishRegion();
  assert.ok(region.includes("validateComplexSessionTitle(plan.title)"), "must normalize the live plan.title via RC-A0");
  const upsert = slice(region, "ridingSlotComplexPublication.upsert(", "ridingSlotComplexPublicationBlock.deleteMany");
  const create = slice(upsert, "create: {", "update: {");
  const update = upsert.slice(upsert.indexOf("update: {"));
  assert.ok(create.includes("titleSnapshot"), "create branch must set titleSnapshot (first publish)");
  assert.ok(update.includes("titleSnapshot"), "update branch must refresh titleSnapshot (republish)");
  // sourceVersion behavior preserved alongside the new snapshot.
  assert.ok(create.includes("sourceVersion: plan.version") && update.includes("sourceVersion: plan.version"),
    "sourceVersion behavior must be preserved");
});

test("titleSnapshot is written ONLY at publish - never on unpublish", () => {
  assert.ok(!unpublishRegion().includes("titleSnapshot"), "unpublish must not touch titleSnapshot");
});

// --- fallback is never persisted ------------------------------------------

test('the generated fallback "תרגול הדרכה" is never persisted by either writer', () => {
  // Checked against comment-stripped source, so a prose mention in a comment is
  // fine; only real CODE would fail this.
  assert.ok(!writerSrc.includes("תרגול הדרכה"), "writer must not persist the fallback string");
  assert.ok(!pubSrc.includes("תרגול הדרכה"), "publication writer must not persist the fallback string");
});

// --- copy behavior unchanged in RC-A2 -------------------------------------

test("RC-A2 does not add title to the complex-plan create/copy path", () => {
  assert.ok(!createRegion().includes("title"), "create/copy path must remain title-free in RC-A2");
});

// --- RC-A2b: the editing DTO exposes and maps the title -------------------

test("RC-A2b - RidingSlotComplexPlanRow exposes title: string | null", () => {
  const iface = slice(writerSrc, "export interface RidingSlotComplexPlanRow {", "}");
  assert.ok(/title:\s*string\s*\|\s*null/.test(iface), "RidingSlotComplexPlanRow must declare title: string | null");
});

test("RC-A2b - toPlanRow maps title from the Prisma plan into the returned row", () => {
  const region = slice(writerSrc, "function toPlanRow(", "}");
  assert.ok(region.includes("title: p.title"), "toPlanRow must map title: p.title");
});

test("RC-A2b - the save result can therefore return the normalized plan.title", () => {
  // The RC-A2 writer returns { success, plan: editing?.plan }, and editing.plan
  // is built by toPlanRow (buildComplexPlanForEditing -> toPlanRow). With
  // toPlanRow now mapping title, the returned plan carries the normalized title.
  const internal = titleInternalRegion();
  assert.ok(internal.includes("buildComplexPlanForEditing(data.ridingSlotId"), "writer must return the fresh editing snapshot");
  assert.ok(internal.includes("plan: editing?.plan"), "writer must return editing.plan (which now carries title)");
});

test("RC-A2b - no extra title query or alternate title source was added for the DTO", () => {
  // The DTO builder still reads via the shared include (which returns all plan
  // scalars, including title, once migrated) and never adds a title-specific
  // query/select; the title reaches the row only through toPlanRow(p.title).
  const region = slice(writerSrc, "async function buildComplexPlanForEditing(", "return {");
  assert.ok(region.includes("include: COMPLEX_PLAN_INCLUDE"), "DTO builder must keep using the shared include read");
  assert.ok(!region.includes("title"), "DTO builder must not add a title-specific query/select");
});
