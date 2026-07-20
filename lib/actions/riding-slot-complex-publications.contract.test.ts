// RIDING-COMPLEX-PUBLICATION - DB-free CONTRACT/source test for the complex-plan
// unpublish authorization architecture. Runs no Prisma and opens no DB: it
// statically inspects the source of the publication action module and the
// editor component, asserting the invariants the approved product contract
// requires:
//   - an instructor may unpublish under exactly the publish/republish tier
//     (server Instructor re-read: isActive && canEditRidingNotes);
//   - admin and instructor wrappers share ONE internal unpublish mutation
//     (no copied second mutation path);
//   - the shared internal stays module-private (never exported as a "use
//     server" endpoint and never referenced by the client), so no admin or
//     instructor client can reach the unauthorized mutation directly;
//   - the admin wrapper authorizes (requireAdmin) BEFORE it delegates, with no
//     delegate-first path;
//   - no client permission boolean is trusted;
//   - the admin path/return contract is unchanged;
//   - the UI routes instructor unpublish through the instructor action and
//     keeps the existing dirty/pending disable.
//
// Run: npx tsx --test lib/actions/riding-slot-complex-publications.contract.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Strip block and line comments so the invariants below are checked against
// real CODE only, never the (deliberately prose-y) contract comments - which
// legitimately name instructor, canEditRidingNotes, deleteMany, etc. Neither
// source file contains `//` inside a string or regex literal in the inspected
// regions, so this naive strip is safe here.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const actionSrc = stripComments(
  readFileSync(fileURLToPath(new URL("./riding-slot-complex-publications.ts", import.meta.url)), "utf8")
);
const editorSrc = stripComments(
  readFileSync(fileURLToPath(new URL("../components/RidingComplexPlanEditor.tsx", import.meta.url)), "utf8")
);

// Slice [startMarker, endMarker) out of a source string, asserting both markers
// exist and are ordered.
function region(src: string, startMarker: string, endMarker: string): string {
  const start = src.indexOf(startMarker);
  assert.ok(start > -1, `start marker not found: ${startMarker}`);
  const end = src.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `end marker not found after start: ${endMarker}`);
  return src.slice(start, end);
}

const internalRegion = () =>
  region(
    actionSrc,
    "async function unpublishComplexRidingPlanInternal",
    "export async function unpublishComplexRidingPlanAsAdmin"
  );
const adminRegion = () =>
  region(
    actionSrc,
    "export async function unpublishComplexRidingPlanAsAdmin",
    "export async function unpublishComplexRidingPlanAsInstructor"
  );
const instructorRegion = () =>
  region(
    actionSrc,
    "export async function unpublishComplexRidingPlanAsInstructor",
    // Comments are stripped above, so the region ends at the first code token of
    // the following (trainee-scoped read) section, not its section comment.
    "export interface PublishedComplexRidingPlanPairForStudent"
  );

test("there is exactly ONE unpublish mutation in the whole module (no copied path)", () => {
  const matches = actionSrc.match(/ridingSlotComplexPublication\.deleteMany/g) ?? [];
  assert.equal(matches.length, 1, "the publication-removing deleteMany must exist in exactly one place");
  // ...and that one place is the shared internal, not either wrapper.
  assert.ok(
    internalRegion().includes("ridingSlotComplexPublication.deleteMany"),
    "the single unpublish mutation must live in unpublishComplexRidingPlanInternal"
  );
  assert.ok(!adminRegion().includes(".deleteMany"), "admin wrapper must not carry its own mutation");
  assert.ok(!instructorRegion().includes(".deleteMany"), "instructor wrapper must not carry its own mutation");
});

test("both wrappers delegate to the same shared internal unpublish", () => {
  assert.ok(
    adminRegion().includes("return unpublishComplexRidingPlanInternal("),
    "admin wrapper must call the shared internal"
  );
  assert.ok(
    instructorRegion().includes("return unpublishComplexRidingPlanInternal("),
    "instructor wrapper must call the shared internal"
  );
});

test("admin wrapper authorizes with requireAdmin(); the shared internal does not", () => {
  assert.ok(adminRegion().includes("await requireAdmin()"), "admin wrapper must still call requireAdmin()");
  // The internal must be auth-agnostic so the instructor path is NOT accidentally
  // gated behind admin, and so admin behavior stays exactly as before.
  assert.ok(!internalRegion().includes("requireAdmin"), "the shared internal must not call requireAdmin");
});

test("the shared internal mutation stays module-private (no client-callable bypass)", () => {
  // The declaration exists but as a bare (non-exported) async function: an
  // unexported function in a "use server" module is NOT a callable server-action
  // endpoint, so it can never be invoked directly by any client.
  assert.ok(
    actionSrc.includes("async function unpublishComplexRidingPlanInternal"),
    "the shared internal must be declared as an async function"
  );
  // Never exported by declaration (export async/function/const/let/var/class).
  assert.ok(
    !/export\s+(?:async\s+function|function|const|let|var|class)\s+unpublishComplexRidingPlanInternal\b/.test(
      actionSrc
    ),
    "unpublishComplexRidingPlanInternal must never be exported as a declaration"
  );
  // Never re-exported through any `export { ... }` / `export { ... } from` list.
  assert.ok(
    !/export\s*\{[^}]*\bunpublishComplexRidingPlanInternal\b[^}]*\}/.test(actionSrc),
    "unpublishComplexRidingPlanInternal must never appear in an export list"
  );
  // The client editor imports/calls only the two authorizing wrappers - it can
  // never reach the internal by name (it is not exported to import in the first
  // place, and is referenced nowhere in the component).
  assert.ok(
    !editorSrc.includes("unpublishComplexRidingPlanInternal"),
    "the client component must never reference the shared internal mutation"
  );
});

test("admin wrapper authorizes BEFORE it delegates (no delegate-first path)", () => {
  const admin = adminRegion();
  const requireIdx = admin.indexOf("await requireAdmin()");
  const delegateIdx = admin.indexOf("unpublishComplexRidingPlanInternal(");
  assert.ok(requireIdx > -1, "admin wrapper must call requireAdmin()");
  assert.ok(delegateIdx > -1, "admin wrapper must delegate to the shared internal");
  assert.ok(requireIdx < delegateIdx, "requireAdmin() must run before delegation to the internal");
  // Exactly one requireAdmin and exactly one delegation, so there is no second,
  // delegate-first branch hiding elsewhere in the admin wrapper.
  assert.equal(
    (admin.match(/await requireAdmin\(\)/g) ?? []).length,
    1,
    "admin wrapper must authorize exactly once"
  );
  assert.equal(
    (admin.match(/unpublishComplexRidingPlanInternal\(/g) ?? []).length,
    1,
    "admin wrapper must delegate to the internal exactly once"
  );
});

test("instructor unpublish re-fetches Instructor and requires isActive && canEditRidingNotes", () => {
  const body = instructorRegion();
  assert.ok(
    /prisma\.instructor\.findUnique\(\{\s*where:\s*\{\s*id:\s*instructorId\s*\}\s*\}\)/.test(body),
    "instructor wrapper must re-read Instructor from the DB by id"
  );
  assert.ok(
    body.includes("!instructor || !instructor.isActive || !instructor.canEditRidingNotes"),
    "instructor wrapper must deny unless the fresh Instructor is active and canEditRidingNotes"
  );
});

test("instructor unpublish uses exactly the same guard as instructor publish", () => {
  const publishInstructor = region(
    actionSrc,
    "export async function publishComplexRidingPlanAsInstructor",
    // Comments stripped: end at the first code token of the unpublish section.
    "export interface UnpublishComplexRidingPlanResult"
  );
  const guard = "!instructor || !instructor.isActive || !instructor.canEditRidingNotes";
  assert.ok(publishInstructor.includes(guard), "publish-instructor guard baseline changed unexpectedly");
  assert.ok(instructorRegion().includes(guard), "unpublish-instructor must reuse the publish tier verbatim");
});

test("instructor unpublish trusts no client permission boolean", () => {
  const body = instructorRegion();
  // Signature is exactly (instructorId, ridingSlotId) - no canEdit/permission arg
  // is accepted, so authorization can only come from the DB re-read above.
  assert.ok(
    /unpublishComplexRidingPlanAsInstructor\(\s*instructorId:\s*string,\s*ridingSlotId:\s*string\s*\)/.test(body),
    "instructor wrapper must accept only (instructorId, ridingSlotId)"
  );
  // \bcanEdit\b matches a standalone client flag but NOT the legitimate
  // server field instructor.canEditRidingNotes (no word boundary before "Riding").
  assert.ok(!/\bcanEdit\b/.test(body), "instructor wrapper must never reference a client canEdit flag");
});

test("admin unpublish return contract is preserved (idempotent alreadyUnpublished)", () => {
  const internal = internalRegion();
  // The friendly idempotent contract still lives in the shared internal that the
  // admin wrapper calls: nothing-to-remove -> success:true, alreadyUnpublished.
  assert.ok(internal.includes("alreadyUnpublished: true"), "empty-id / no-plan idempotent success preserved");
  assert.ok(
    internal.includes("alreadyUnpublished: deleted.count === 0"),
    "already-unpublished-vs-removed distinction preserved"
  );
});

// ---- UI wiring (RidingComplexPlanEditor.tsx) --------------------------------

test("UI capability gate uses canUnpublishComplexPlan(admin || canEdit), not admin-only", () => {
  assert.ok(
    editorSrc.includes('canUnpublish={canUnpublishComplexPlan(actor.type === "admin", canEdit)}'),
    "PublicationStatusPanel canUnpublish must be the shared admin-or-editable-instructor capability"
  );
});

test("UI routes instructor unpublish through the instructor action, admin through the admin action", () => {
  const routing = region(editorSrc, "function unpublishComplexPlan(", "type LoadStatus");
  assert.ok(
    routing.includes("unpublishComplexRidingPlanAsAdmin(ridingSlotId)"),
    "admin branch must call the admin action"
  );
  assert.ok(
    routing.includes("unpublishComplexRidingPlanAsInstructor(actor.instructorId, ridingSlotId)"),
    "instructor branch must call the instructor action"
  );
  // The confirm handler must go through the actor router, never the admin action directly.
  const confirmBody = region(editorSrc, "function handleConfirmUnpublish()", "const plan = editing?.plan");
  assert.ok(
    confirmBody.includes("await unpublishComplexPlan(actor, ridingSlotId)"),
    "confirm must route via unpublishComplexPlan(actor, ...)"
  );
  assert.ok(
    !confirmBody.includes("unpublishComplexRidingPlanAsAdmin"),
    "confirm must not call the admin action directly"
  );
});

test("UI preserves the dirty/pending disable on the Unpublish control", () => {
  // The panel is fed the same blockedByEdit (inlineEditActive) signal, and the
  // Unpublish button disables on it - unchanged from the admin-only version.
  assert.ok(editorSrc.includes("blockedByEdit={inlineEditActive}"), "panel must receive the dirty/pending signal");
  const panel = region(editorSrc, "function PublicationStatusPanel(", "function PublishConfirmModal(");
  assert.ok(
    panel.includes("onClick={onOpenUnpublish}") && panel.includes("disabled={blockedByEdit}"),
    "the Unpublish control must be disabled while a draft/pending action is active"
  );
});
