// RIDING-COMPLEX-SCHEDULE-BOARD - DB-free CONTRACT/source test for the
// whole-plan delete ("return this riding session to a normal session")
// authorization architecture. Runs no Prisma and opens no DB: it statically
// inspects the source of the complex-plan action module and the editor
// component, asserting the invariants the approved product contract requires:
//   - admins are allowed (requireAdmin wrapper);
//   - an authorized instructor is allowed under EXACTLY the create/manage tier
//     (server Instructor re-read: isActive && canEditRidingNotes);
//   - an unauthorized instructor is denied server-side (generic NO_PERMISSION);
//   - admin and instructor wrappers share ONE internal destructive delete
//     mutation (advisory lock + transaction + cascade), never a copied second
//     path, so the destructive core is shared rather than duplicated;
//   - the shared internal stays module-private (never exported as a "use server"
//     endpoint and never referenced by the client), so no client can reach the
//     unauthorized mutation directly;
//   - the admin wrapper authorizes (requireAdmin) BEFORE it delegates;
//   - no client permission boolean is trusted;
//   - the UI capability gate is the admin-or-authorized-instructor capability
//     (canReturnComplexPlanToNormal), not actor.type alone, and the correct
//     admin/instructor delete action is selected.
//
// Run: npx tsx --test lib/actions/riding-slot-complex-plan-delete.contract.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Strip block and line comments so the invariants below are checked against real
// CODE only, never the (deliberately prose-y) contract comments - which
// legitimately name instructor, canEditRidingNotes, requireAdmin, etc. Neither
// source file contains `//` inside a string or regex literal in the inspected
// regions, so this naive strip is safe here.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const actionSrc = stripComments(
  readFileSync(fileURLToPath(new URL("./riding-slot-complex.ts", import.meta.url)), "utf8")
);
const editorSrc = stripComments(
  readFileSync(fileURLToPath(new URL("../components/RidingComplexPlanEditor.tsx", import.meta.url)), "utf8")
);

// Slice [startMarker, endMarker) out of a source string, asserting both markers
// exist and are ordered. When endMarker is omitted, slices to the end of the
// source (used for the instructor wrapper, which is the last function).
function region(src: string, startMarker: string, endMarker?: string): string {
  const start = src.indexOf(startMarker);
  assert.ok(start > -1, `start marker not found: ${startMarker}`);
  if (endMarker === undefined) return src.slice(start);
  const end = src.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `end marker not found after start: ${endMarker}`);
  return src.slice(start, end);
}

const internalRegion = () =>
  region(
    actionSrc,
    "async function deleteRidingSlotComplexPlanInternal",
    "export async function deleteRidingSlotComplexPlanAsAdmin"
  );
const adminRegion = () =>
  region(
    actionSrc,
    "export async function deleteRidingSlotComplexPlanAsAdmin",
    "export async function deleteRidingSlotComplexPlanAsInstructor"
  );
const instructorRegion = () =>
  region(actionSrc, "export async function deleteRidingSlotComplexPlanAsInstructor");

test("the destructive delete mutation lives ONLY in the shared internal, not in either wrapper", () => {
  const internal = internalRegion();
  // The two hallmarks of the whole-plan delete (per-slot advisory lock + the
  // actual plan delete) both live in the shared internal.
  assert.ok(internal.includes("pg_advisory_xact_lock"), "the advisory lock must live in the shared internal");
  assert.ok(
    internal.includes("ridingSlotComplexPlan.delete("),
    "the plan delete must live in the shared internal"
  );
  // Neither wrapper carries its own destructive path - they only authorize and
  // delegate, so the two trust tiers can never drift into two delete behaviors.
  for (const [name, body] of [
    ["admin", adminRegion()],
    ["instructor", instructorRegion()],
  ] as const) {
    assert.ok(!body.includes("pg_advisory_xact_lock"), `${name} wrapper must not carry its own advisory lock`);
    assert.ok(
      !body.includes("ridingSlotComplexPlan.delete("),
      `${name} wrapper must not carry its own plan delete`
    );
  }
});

test("both wrappers delegate to the same shared internal delete", () => {
  assert.ok(
    adminRegion().includes("return deleteRidingSlotComplexPlanInternal("),
    "admin wrapper must call the shared internal"
  );
  // RS-SEC-1I-CP: the instructor wrapper delegates to the same shared internal
  // from inside the signed-session boundary's onAuthorized callback (an arrow
  // body, not a bare `return`), so scope the check to the call itself.
  assert.ok(
    instructorRegion().includes("deleteRidingSlotComplexPlanInternal("),
    "instructor wrapper must call the shared internal"
  );
});

test("admin wrapper authorizes with requireAdmin() BEFORE it delegates; the shared internal does not", () => {
  const admin = adminRegion();
  const requireIdx = admin.indexOf("await requireAdmin()");
  const delegateIdx = admin.indexOf("deleteRidingSlotComplexPlanInternal(");
  assert.ok(requireIdx > -1, "admin wrapper must call requireAdmin()");
  assert.ok(delegateIdx > -1, "admin wrapper must delegate to the shared internal");
  assert.ok(requireIdx < delegateIdx, "requireAdmin() must run before delegation to the internal");
  // The internal must be auth-agnostic so the instructor path is NOT accidentally
  // gated behind admin, and admin behavior stays exactly as before.
  assert.ok(!internalRegion().includes("requireAdmin"), "the shared internal must not call requireAdmin");
});

test("the shared internal mutation stays module-private (no client-callable bypass)", () => {
  // Declared, but as a bare (non-exported) async function: an unexported function
  // in a "use server" module is NOT a callable server-action endpoint.
  assert.ok(
    actionSrc.includes("async function deleteRidingSlotComplexPlanInternal"),
    "the shared internal must be declared as an async function"
  );
  assert.ok(
    !/export\s+(?:async\s+function|function|const|let|var|class)\s+deleteRidingSlotComplexPlanInternal\b/.test(
      actionSrc
    ),
    "deleteRidingSlotComplexPlanInternal must never be exported as a declaration"
  );
  assert.ok(
    !/export\s*\{[^}]*\bdeleteRidingSlotComplexPlanInternal\b[^}]*\}/.test(actionSrc),
    "deleteRidingSlotComplexPlanInternal must never appear in an export list"
  );
  // The client editor imports/calls only the two authorizing wrappers.
  assert.ok(
    !editorSrc.includes("deleteRidingSlotComplexPlanInternal"),
    "the client component must never reference the shared internal mutation"
  );
});

test("RS-SEC-1I-CP: authorized instructor comes from the signed session, not a client-id re-read", () => {
  const body = instructorRegion();
  // Identity is resolved via the canonical signed-session resolver, routed
  // through the shared boundary - never a re-read of a client-supplied id.
  assert.ok(body.includes("runComplexPlanInstructorWrite("), "delete-instructor must route through the signed-session boundary");
  assert.ok(body.includes("getCurrentInstructor"), "delete-instructor must resolve identity via getCurrentInstructor");
  assert.ok(
    !body.includes("prisma.instructor.findUnique("),
    "delete-instructor must NOT re-read an Instructor by a client-supplied id"
  );
});

test("unauthorized instructor is denied server-side with the generic NO_PERMISSION contract", () => {
  const body = instructorRegion();
  // The denial branch is the boundary's `denied` result: success:false with
  // NO_PERMISSION (no id/PII). The canEditRidingNotes gate itself lives in the
  // shared boundary and is asserted behaviorally in riding-slot-complex-auth.test.ts.
  assert.ok(
    /denied:\s*\{\s*success:\s*false,\s*error:\s*NO_PERMISSION\s*\}/.test(body),
    "denied instructor must get success:false + NO_PERMISSION"
  );
});

test("instructor delete uses exactly the same signed-session boundary as instructor create/manage", () => {
  const createInstructor = region(
    actionSrc,
    "export async function createRidingSlotComplexPlanAsInstructor",
    "export async function saveRidingSlotComplexBlockAsAdmin"
  );
  const boundary = "runComplexPlanInstructorWrite(";
  assert.ok(createInstructor.includes(boundary), "create-instructor must route through the shared boundary");
  assert.ok(instructorRegion().includes(boundary), "delete-instructor must reuse the same create/manage tier boundary");
});

test("instructor delete accepts no acting instructorId and no client permission boolean", () => {
  const body = instructorRegion();
  // RS-SEC-1I-CP: signature is exactly (ridingSlotId) - no instructorId, no
  // canEdit/permission arg is accepted, so authorization can only come from the
  // signed session resolved inside the boundary.
  assert.ok(
    /deleteRidingSlotComplexPlanAsInstructor\(\s*ridingSlotId:\s*string\s*\)/.test(body),
    "instructor wrapper must accept only (ridingSlotId)"
  );
  // \bcanEdit\b matches a standalone client flag but NOT the legitimate server
  // field canEditRidingNotes (no word boundary before "Riding").
  assert.ok(!/\bcanEdit\b/.test(body), "instructor wrapper must never reference a client canEdit flag");
});

// ---- UI wiring (RidingComplexPlanEditor.tsx) --------------------------------

test("UI capability gate uses canReturnComplexPlanToNormal(admin || canEdit), not admin-only", () => {
  assert.ok(
    editorSrc.includes('canReturnComplexPlanToNormal(actor.type === "admin", canEdit) &&'),
    "recovery control must render on the shared admin-or-editable-instructor capability"
  );
  // The old actor.type-only gate for this control must be gone.
  assert.ok(
    !editorSrc.includes('actor.type === "admin" && (boardView || view.type === "blockList")'),
    "the recovery control must no longer be gated by actor.type alone"
  );
});

test("UI routes instructor delete through the instructor action, admin through the admin action", () => {
  const routing = region(editorSrc, "function deleteComplexPlan(", "type LoadStatus");
  assert.ok(
    routing.includes("deleteRidingSlotComplexPlanAsAdmin(ridingSlotId)"),
    "admin branch must call the admin delete action"
  );
  assert.ok(
    routing.includes("deleteRidingSlotComplexPlanAsInstructor(ridingSlotId)"),
    "instructor branch must call the instructor delete action with only ridingSlotId (signed-session identity)"
  );
  assert.ok(
    !routing.includes("deleteRidingSlotComplexPlanAsInstructor(actor.instructorId"),
    "instructor delete branch must not pass a client actor.instructorId"
  );
  // The confirm handler must go through the actor router, never the admin action directly.
  const confirmBody = region(
    editorSrc,
    "function handleConfirmReturnToNormal()",
    "function goToUnpublishFromRecover()"
  );
  assert.ok(
    confirmBody.includes("await deleteComplexPlan(actor, ridingSlotId)"),
    "confirm must route via deleteComplexPlan(actor, ...)"
  );
  assert.ok(
    !confirmBody.includes("deleteRidingSlotComplexPlanAsAdmin"),
    "confirm must not call the admin action directly"
  );
});
