// ADMIN-WRITE-AUDIENCE - DB-free CONTRACT/source test for the admin/instructor
// candidate-audience split on the two WRITE paths confirmed to still be
// misrouted after RS-SEC-1ADMIN-CAND (which fixed only the READ paths):
//
//   1. saveRidingSlotHorseListInternal (lib/actions/riding-slot-horses.ts) -
//      unconditionally called the INSTRUCTOR-gated buildHorseCandidates, so a
//      pure admin session (no signed instructor cookie) resolved an empty
//      roster and every real studentId in the payload hit STUDENT_NOT_IN_ROSTER
//      before any write.
//   2. createComplexPlanInternal (lib/actions/riding-slot-complex.ts) - same
//      root cause, worse consequence: the empty roster silently drops every
//      trainee pair when copying a template (resolveTrainees returns null for
//      every pair), so the action returns { success: true } with zero pairs
//      and no warning.
//
// Both are fixed by branching on actor.instructorId (server-constructed only:
// null iff the actor came from requireAdmin()/adminActor(), never
// client-suppliable) to the existing admin-audience buildHorseCandidatesForAdmin
// for the admin case, leaving the instructor case (and every AsAdmin/AsInstructor
// wrapper signature) completely unchanged.
//
// This file runs no Prisma and opens no DB: it statically inspects the two
// touched action modules' source, same convention as
// riding-slot-admin-candidate-audience.contract.test.ts and
// riding-complex-template-create.contract.test.ts (which this codebase already
// uses for admin/instructor "use server" readers/writers that cannot be
// imported directly here without pulling in Prisma / next/headers / next/cache).
//
// Run: npx tsx --test lib/actions/riding-slot-admin-write-audience.contract.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function read(relPath: string): string {
  return readFileSync(fileURLToPath(new URL(relPath, import.meta.url)), "utf8");
}

const ridingSlotHorsesRaw = read("./riding-slot-horses.ts");
const ridingSlotHorsesSrc = stripComments(ridingSlotHorsesRaw);
const ridingSlotComplexRaw = read("./riding-slot-complex.ts");
const ridingSlotComplexSrc = stripComments(ridingSlotComplexRaw);

// Slice a region between two markers, same helper convention as the sibling
// contract test files.
function region(src: string, startMarker: string, endMarker: string): string {
  const start = src.indexOf(startMarker);
  assert.ok(start > -1, `start marker not found: ${startMarker}`);
  const end = src.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `end marker not found: ${endMarker} (after ${startMarker})`);
  return src.slice(start, end);
}

// ===========================================================================
// 1) saveRidingSlotHorseListInternal (simple horse-list save)
// ===========================================================================

function saveInternalRegion(): string {
  return region(
    ridingSlotHorsesSrc,
    "async function saveRidingSlotHorseListInternal(",
    "export async function saveRidingSlotHorseListAsAdmin("
  );
}

test("saveRidingSlotHorseListInternal stays module-private (no client bypass of either audience gate)", () => {
  assert.ok(
    !/export\s+(async\s+)?function\s+saveRidingSlotHorseListInternal/.test(ridingSlotHorsesSrc),
    "saveRidingSlotHorseListInternal must never be exported"
  );
});

test("saveRidingSlotHorseListInternal branches on actor.instructorId: null -> buildHorseCandidatesForAdmin, else -> buildHorseCandidates", () => {
  const r = saveInternalRegion();
  assert.ok(r.includes("actor.instructorId === null"), "must branch on the server-constructed actor.instructorId field");
  const branchIdx = r.indexOf("actor.instructorId === null");
  const adminCallIdx = r.indexOf("buildHorseCandidatesForAdmin(data.ridingSlotId)");
  const instructorCallIdx = r.indexOf("buildHorseCandidates(data.ridingSlotId)");
  assert.ok(adminCallIdx > -1, "admin-audience candidate builder call not found");
  assert.ok(instructorCallIdx > -1, "instructor-audience candidate builder call not found");
  assert.ok(branchIdx < adminCallIdx, "the actor.instructorId check must precede the admin-audience call");
  assert.ok(branchIdx < instructorCallIdx, "the actor.instructorId check must precede the instructor-audience call");
});

test("the roster read (either branch) happens before the STUDENT_NOT_IN_ROSTER check and before the transaction opens", () => {
  const r = saveInternalRegion();
  const adminCallIdx = r.indexOf("buildHorseCandidatesForAdmin(data.ridingSlotId)");
  const instructorCallIdx = r.indexOf("buildHorseCandidates(data.ridingSlotId)");
  const rosterCheckIdx = r.indexOf("STUDENT_NOT_IN_ROSTER");
  const txOpenIdx = r.indexOf("prisma.$transaction");
  assert.ok(rosterCheckIdx > -1 && txOpenIdx > -1);
  assert.ok(adminCallIdx < rosterCheckIdx, "admin-audience roster read must precede the roster-membership check");
  assert.ok(instructorCallIdx < rosterCheckIdx, "instructor-audience roster read must precede the roster-membership check");
  assert.ok(adminCallIdx < txOpenIdx, "admin-audience roster read must precede the transaction open");
  assert.ok(instructorCallIdx < txOpenIdx, "instructor-audience roster read must precede the transaction open");
});

test("saveRidingSlotHorseListAsAdmin still calls requireAdmin() and constructs instructorId: null when delegating to the internal core", () => {
  const r = region(
    ridingSlotHorsesSrc,
    "export async function saveRidingSlotHorseListAsAdmin(",
    "export async function saveRidingSlotHorseListAsInstructor("
  );
  const requireAdminIdx = r.indexOf("requireAdmin()");
  const instructorIdIdx = r.indexOf("instructorId: null");
  const delegateIdx = r.indexOf("saveRidingSlotHorseListInternal(input,");
  assert.ok(requireAdminIdx > -1, "must call requireAdmin()");
  assert.ok(instructorIdIdx > -1, "must construct the actor with instructorId: null");
  assert.ok(delegateIdx > -1, "must delegate to the internal core");
  assert.ok(requireAdminIdx < delegateIdx, "requireAdmin() must run before the internal core is called");
  // instructorId: null is part of the same actor object literal passed as the
  // internal core's second argument, so it sits textually AFTER the call
  // expression opens - just confirm it is inside the same call, not before it.
  assert.ok(instructorIdIdx > delegateIdx, "instructorId: null must be part of the actor object passed to the internal core");
});

test("saveRidingSlotHorseListAsInstructor is completely unchanged: still re-reads isActive/canEditRidingNotes by instructorId, then constructs instructorId: instructor.id", () => {
  const start = ridingSlotHorsesSrc.indexOf("export async function saveRidingSlotHorseListAsInstructor(");
  assert.ok(start > -1, "saveRidingSlotHorseListAsInstructor not found");
  const r = ridingSlotHorsesSrc.slice(start);
  assert.ok(r.includes("prisma.instructor.findUnique({ where: { id: instructorId } })"), "must still re-read Instructor by the passed instructorId");
  assert.ok(r.includes("instructor.isActive"), "must still require isActive");
  assert.ok(r.includes("instructor.canEditRidingNotes"), "must still require canEditRidingNotes");
  assert.ok(r.includes("instructorId: instructor.id"), "must construct the actor with the DB-verified instructor id");
  assert.ok(!r.includes("requireAdmin"), "the instructor wrapper must never call requireAdmin()");
});

// ===========================================================================
// 2) createComplexPlanInternal (complex-plan create / template copy)
// ===========================================================================

function createInternalRegion(): string {
  const start = ridingSlotComplexSrc.indexOf("async function createComplexPlanInternal(");
  const end = ridingSlotComplexSrc.indexOf("export async function createRidingSlotComplexPlanAsAdmin(");
  assert.ok(start > -1, "createComplexPlanInternal not found");
  assert.ok(end > start, "createComplexPlanInternal end marker not found");
  return ridingSlotComplexSrc.slice(start, end);
}

test("createComplexPlanInternal stays module-private (no client bypass of either audience gate)", () => {
  assert.ok(
    !/export\s+(async\s+)?function\s+createComplexPlanInternal/.test(ridingSlotComplexSrc),
    "createComplexPlanInternal must never be exported"
  );
});

test("createComplexPlanInternal branches on actor.instructorId: null -> buildHorseCandidatesForAdmin, else -> buildHorseCandidates", () => {
  const r = createInternalRegion();
  assert.ok(r.includes("actor.instructorId === null"), "must branch on the server-constructed actor.instructorId field");
  const branchIdx = r.indexOf("actor.instructorId === null");
  const adminCallIdx = r.indexOf("buildHorseCandidatesForAdmin(ridingSlotId)");
  const instructorCallIdx = r.indexOf("buildHorseCandidates(ridingSlotId)");
  assert.ok(adminCallIdx > -1, "admin-audience candidate builder call not found");
  assert.ok(instructorCallIdx > -1, "instructor-audience candidate builder call not found");
  assert.ok(branchIdx < adminCallIdx, "the actor.instructorId check must precede the admin-audience call");
  assert.ok(branchIdx < instructorCallIdx, "the actor.instructorId check must precede the instructor-audience call");
});

test("the roster read (either branch) happens before prisma.$transaction opens (tested invariant, never moved inside)", () => {
  const r = createInternalRegion();
  const adminCallIdx = r.indexOf("buildHorseCandidatesForAdmin(ridingSlotId)");
  const instructorCallIdx = r.indexOf("buildHorseCandidates(ridingSlotId)");
  const txOpenIdx = r.indexOf("prisma.$transaction");
  assert.ok(txOpenIdx > -1, "prisma.$transaction not found");
  assert.ok(adminCallIdx < txOpenIdx, "admin-audience roster read must precede the transaction open");
  assert.ok(instructorCallIdx < txOpenIdx, "instructor-audience roster read must precede the transaction open");

  // Neither builder may be called from inside the tx callback.
  const txCallbackIdx = r.indexOf("async (tx) =>");
  assert.ok(txCallbackIdx > -1, "tx callback opener not found");
  const tail = r.slice(txCallbackIdx);
  assert.ok(!tail.includes("buildHorseCandidates("), "buildHorseCandidates must never be called inside the tx callback");
  assert.ok(!tail.includes("buildHorseCandidatesForAdmin("), "buildHorseCandidatesForAdmin must never be called inside the tx callback");
});

test("createRidingSlotComplexPlanAsAdmin still calls requireAdmin() before delegating to the internal core, constructing the actor via adminActor(admin) (instructorId: null)", () => {
  const r = region(
    ridingSlotComplexSrc,
    "export async function createRidingSlotComplexPlanAsAdmin(",
    "export async function createRidingSlotComplexPlanAsInstructor("
  );
  const requireAdminIdx = r.indexOf("requireAdmin()");
  const adminActorIdx = r.indexOf("adminActor(admin)");
  const delegateIdx = r.indexOf("createComplexPlanInternal(ridingSlotId,");
  assert.ok(requireAdminIdx > -1, "must call requireAdmin()");
  assert.ok(adminActorIdx > -1, "must construct the actor via adminActor(admin) (instructorId: null)");
  assert.ok(delegateIdx > -1, "must delegate to the internal core");
  assert.ok(requireAdminIdx < delegateIdx, "requireAdmin() must run before the internal core is called");
  // adminActor(admin) is the internal core's second argument, so it sits
  // textually AFTER the call expression opens - confirm it is part of the
  // same call, not before it.
  assert.ok(adminActorIdx > delegateIdx, "adminActor(admin) must be the actor argument passed to the internal core");
});

test("createRidingSlotComplexPlanAsInstructor is completely unchanged: still routes through runComplexPlanInstructorWrite -> getCurrentInstructor + canEditRidingNotes, constructs instructorActor(actor)", () => {
  const r = region(
    ridingSlotComplexSrc,
    "export async function createRidingSlotComplexPlanAsInstructor(",
    "async function saveComplexPlanTitleInternal("
  );
  assert.ok(r.includes("runComplexPlanInstructorWrite({"), "must still delegate to the instructor write-authorization boundary");
  assert.ok(r.includes("getCurrentInstructor,"), "must still thread the canonical instructor actor resolver");
  assert.ok(r.includes("instructorActor(actor)"), "must construct the actor via instructorActor(actor) (instructorId: actor.id)");
  assert.ok(!r.includes("requireAdmin"), "the instructor wrapper must never call requireAdmin()");
});

// ===========================================================================
// 3) adminActor / instructorActor / ComplexPlanActor / HorseListActor shapes
//    are unchanged (this fix only reads the existing instructorId field, it
//    does not introduce a new actor shape or a new field).
// ===========================================================================

test("adminActor still sets instructorId: null; instructorActor still sets instructorId to the real instructor id", () => {
  assert.ok(ridingSlotComplexSrc.includes("instructorId: null,"), "adminActor must still construct instructorId: null");
  const instructorActorFn = region(
    ridingSlotComplexSrc,
    "function instructorActor(instructor:",
    "function actorWriteFields("
  );
  assert.ok(instructorActorFn.includes("instructorId: instructor.id"), "instructorActor must still construct instructorId: instructor.id");
});

// ===========================================================================
// 4) No unauthenticated writer / bypass-style flag introduced.
// ===========================================================================

test("no bypass-style boolean flag was introduced in either touched write path", () => {
  for (const src of [ridingSlotHorsesSrc, ridingSlotComplexSrc]) {
    for (const forbidden of ["skipAuth", "isAdmin:", "bypassInstructorCheck", "skipInstructor", "trustedCaller"]) {
      assert.ok(!src.includes(forbidden), `forbidden bypass-style identifier found: ${forbidden}`);
    }
  }
});

test("riding-slot-horses.ts still exports exactly the two audience-gated simple-list save writers", () => {
  const exportedSaveWriters = Array.from(
    ridingSlotHorsesSrc.matchAll(/export async function (saveRidingSlotHorseList\w*)\(/g),
    (m) => m[1]
  ).sort();
  assert.deepEqual(exportedSaveWriters, ["saveRidingSlotHorseListAsAdmin", "saveRidingSlotHorseListAsInstructor"]);
});

test("riding-slot-complex.ts still exports exactly the two audience-gated complex-plan create writers", () => {
  const exportedCreateWriters = Array.from(
    ridingSlotComplexSrc.matchAll(/export async function (createRidingSlotComplexPlan\w*)\(/g),
    (m) => m[1]
  ).sort();
  assert.deepEqual(exportedCreateWriters, ["createRidingSlotComplexPlanAsAdmin", "createRidingSlotComplexPlanAsInstructor"]);
});

test("both touched 'use server' modules are still Server Action modules with no stray client import", () => {
  for (const raw of [ridingSlotHorsesRaw, ridingSlotComplexRaw]) {
    assert.ok(/^\s*["']use server["'];/.test(raw), "must still be a 'use server' module");
  }
});

// ===========================================================================
// 5) Scope containment: no other write action in either file references
//    buildHorseCandidatesForAdmin (only the two fixed internal cores do) -
//    guards against this fix silently spreading beyond its approved scope.
// ===========================================================================

test("scope containment: buildHorseCandidatesForAdmin is referenced from exactly the expected call sites in riding-slot-horses.ts", () => {
  // Declaration + the pre-existing admin GET reader (getRidingSlotHorseListForAdmin)
  // + the NEW saveRidingSlotHorseListInternal call site added by this fix = 3.
  const count = (ridingSlotHorsesSrc.match(/buildHorseCandidatesForAdmin\(/g) ?? []).length;
  assert.equal(count, 3, "unexpected number of buildHorseCandidatesForAdmin references in riding-slot-horses.ts");
});

test("scope containment: buildHorseCandidatesForAdmin is CALLED from exactly the expected call sites in riding-slot-complex.ts (import excluded)", () => {
  // buildComplexPlanForEditingForAdmin's own pre-existing call + the NEW
  // createComplexPlanInternal call site added by this fix = 2 (the cross-file
  // import statement itself has no trailing "(" so it is deliberately excluded
  // here - see the next test for the total identifier count including the import).
  const count = (ridingSlotComplexSrc.match(/buildHorseCandidatesForAdmin\(/g) ?? []).length;
  assert.equal(count, 2, "unexpected number of buildHorseCandidatesForAdmin call sites in riding-slot-complex.ts");
});
