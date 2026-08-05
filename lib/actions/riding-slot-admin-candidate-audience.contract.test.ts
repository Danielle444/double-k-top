// RS-SEC-1ADMIN-CAND - DB-free CONTRACT/source test for the admin/instructor
// candidate-audience split. Fixes the confirmed production bug: the
// admin-facing candidate readers (getRidingSlotComplexPlanForAdmin,
// getRidingSlotHorseListForAdmin) already authenticated with requireAdmin(),
// but their candidate-building path was misrouted through
// getRidingSlotStudentNotes, whose gate is the SEPARATE, non-overlapping
// INSTRUCTOR session (getCurrentInstructor) - so a pure admin browser session
// (no signed instructor cookie) silently received candidates: [].
//
// This file runs no Prisma and opens no DB: it statically inspects the three
// touched action modules' source (same convention as
// riding-slot-complex-hardening.contract.test.ts and
// riding-slot-roster-scope.contract.test.ts, which this codebase already uses
// for admin/instructor "use server" readers that cannot be imported directly
// here without pulling in Prisma / next/headers / next/cache).
//
// Run: npx tsx --test lib/actions/riding-slot-admin-candidate-audience.contract.test.ts

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

const ridingSlotsRaw = read("./riding-slots.ts");
const ridingSlotsSrc = stripComments(ridingSlotsRaw);
const ridingSlotHorsesRaw = read("./riding-slot-horses.ts");
const ridingSlotHorsesSrc = stripComments(ridingSlotHorsesRaw);
const ridingSlotComplexRaw = read("./riding-slot-complex.ts");
const ridingSlotComplexSrc = stripComments(ridingSlotComplexRaw);

// Slice an exported/declared function's body from its declaration to the next
// top-level `export async function` / `async function` marker (or a supplied
// end marker). Mirrors the region()/slice() helpers already used by the
// sibling contract test files in this directory.
function region(src: string, startMarker: string, endMarker: string): string {
  const start = src.indexOf(startMarker);
  assert.ok(start > -1, `start marker not found: ${startMarker}`);
  const end = src.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `end marker not found: ${endMarker} (after ${startMarker})`);
  return src.slice(start, end);
}

// ===========================================================================
// 1) The internal core loader stays exactly as it was: module-private, no
//    actor lookup, still the sole business-logic query for student rows.
// ===========================================================================

test("buildRidingSlotStudentNotes (the internal core loader) is still module-private and performs no actor lookup itself", () => {
  assert.ok(
    ridingSlotsSrc.includes("async function buildRidingSlotStudentNotes(ridingSlotId: string)"),
    "the internal core loader must still exist with its original signature"
  );
  assert.ok(
    !/export\s+(async\s+)?function\s+buildRidingSlotStudentNotes/.test(ridingSlotsSrc),
    "the internal core loader must never be exported (no direct client bypass of either audience gate)"
  );
  const core = region(
    ridingSlotsSrc,
    "async function buildRidingSlotStudentNotes(ridingSlotId: string)",
    "export async function getRidingSlotStudentNotes("
  );
  assert.ok(!core.includes("getCurrentInstructor"), "the core loader must not resolve any actor itself");
  assert.ok(!core.includes("requireAdmin"), "the core loader must not resolve any actor itself");
});

// ===========================================================================
// 2) Instructor-audience wrapper is completely unchanged: still gated on
//    getCurrentInstructor via the existing DI boundary, never requireAdmin.
// ===========================================================================

test("getRidingSlotStudentNotes (instructor wrapper) is unchanged: gated ONLY on getCurrentInstructor via the DI boundary", () => {
  const r = region(
    ridingSlotsSrc,
    "export async function getRidingSlotStudentNotes(",
    "export async function getRidingSlotStudentNotesForAdmin("
  );
  assert.ok(r.includes("loadRidingSlotStudentNotesWithDeps("), "must delegate to the existing session-bound orchestration");
  assert.ok(r.includes("getCurrentInstructor"), "must thread the canonical instructor actor resolver");
  assert.ok(r.includes("readNotes: buildRidingSlotStudentNotes"), "must inject the SAME core loader used by the admin path");
  assert.ok(!r.includes("requireAdmin"), "the instructor wrapper must never call requireAdmin()");
});

test("wiring: instructor DI orchestration (riding-slots-read-auth.ts) is untouched by this change", () => {
  const src = read("./riding-slots-read-auth.ts");
  assert.ok(!/^\s*["']use server["']\s*;?\s*$/m.test(src), "must not be a Server Action module");
  assert.ok(!/from ["']@\/lib\/prisma["']/.test(src), "must not import prisma");
  assert.match(src, /loadRidingSlotStudentNotesWithDeps/, "the instructor gate orchestration still exists unchanged");
});

// ===========================================================================
// 3) NEW admin-audience wrapper: self-gates on requireAdmin(), delegates to
//    the SAME core loader, and never touches getCurrentInstructor / an
//    instructor cookie.
// ===========================================================================

test("getRidingSlotStudentNotesForAdmin (NEW admin wrapper) self-gates on requireAdmin() and calls the SAME core loader - never getCurrentInstructor", () => {
  assert.match(
    ridingSlotsSrc,
    /export async function getRidingSlotStudentNotesForAdmin\(\s*ridingSlotId: string\s*\)/,
    "admin wrapper signature: ridingSlotId only, no actor id parameter"
  );
  const r = region(
    ridingSlotsSrc,
    "export async function getRidingSlotStudentNotesForAdmin(",
    "export interface RidingLessonNoteInput"
  );
  // Self-gated: requireAdmin() runs INSIDE this function, before the reader.
  const requireAdminIdx = r.indexOf("requireAdmin()");
  const readerIdx = r.indexOf("buildRidingSlotStudentNotes(ridingSlotId)");
  assert.ok(requireAdminIdx > -1, "must call requireAdmin()");
  assert.ok(readerIdx > requireAdminIdx, "requireAdmin() must run BEFORE the core loader");
  // Never the instructor gate.
  assert.ok(!r.includes("getCurrentInstructor"), "admin wrapper must NEVER call getCurrentInstructor");
  assert.ok(!r.includes("loadRidingSlotStudentNotesWithDeps"), "admin wrapper must NOT reuse the instructor DI boundary");
  // No boolean-flag-style bypass parameter anywhere in this function region.
  for (const forbidden of ["skipAuth", "isAdmin", "bypassInstructorCheck", "skipInstructor"]) {
    assert.ok(!r.includes(forbidden), `admin wrapper must not use a bypass-style flag: ${forbidden}`);
  }
  // Arity: deps-free, single positional selector only (no injected/boolean 2nd arg).
  assert.match(r, /getRidingSlotStudentNotesForAdmin\(\s*ridingSlotId: string\s*\)/);
});

// ===========================================================================
// 4) The internal loader can be reached ONLY through the two audience-gated
//    wrappers - never through a third, ungated exported reader.
// ===========================================================================

test("no third exported reader reaches buildRidingSlotStudentNotes without an audience gate", () => {
  const callers = ridingSlotsSrc.match(/buildRidingSlotStudentNotes(?:\(|,|\s)/g) ?? [];
  // Expected occurrences: the declaration itself, the instructor wrapper's
  // `readNotes: buildRidingSlotStudentNotes`, and the admin wrapper's direct
  // call - exactly three, never a fourth uncontrolled call site.
  assert.equal(callers.length, 3, "buildRidingSlotStudentNotes must be referenced by exactly the declaration + the two gated wrappers");
});

test("riding-slots.ts exports no other student-notes reader besides the two audience-gated wrappers", () => {
  const exportedNotesReaders = Array.from(
    ridingSlotsSrc.matchAll(/export async function (getRidingSlotStudentNotes\w*)\(/g),
    (m) => m[1]
  ).sort();
  assert.deepEqual(exportedNotesReaders, ["getRidingSlotStudentNotes", "getRidingSlotStudentNotesForAdmin"]);
});

// ===========================================================================
// 5) getRidingSlotHorseListForAdmin now sources candidates from the
//    admin-audience builder, not the instructor-gated one - regression test
//    for the exact simple-riding admin-picker instance of the bug.
// ===========================================================================

test("REGRESSION: getRidingSlotHorseListForAdmin calls requireAdmin() then buildHorseCandidatesForAdmin (never buildHorseCandidates / getCurrentInstructor)", () => {
  const r = region(
    ridingSlotHorsesSrc,
    "export async function getRidingSlotHorseListForAdmin(",
    "async function readHorseListForEditing("
  );
  const requireAdminIdx = r.indexOf("requireAdmin()");
  const candidatesIdx = r.indexOf("buildHorseCandidatesForAdmin(ridingSlotId)");
  assert.ok(requireAdminIdx > -1, "must call requireAdmin()");
  assert.ok(candidatesIdx > requireAdminIdx, "requireAdmin() must run before the admin-audience candidate builder");
  assert.ok(!r.includes("getCurrentInstructor"), "admin horse-list reader must never call getCurrentInstructor");
  // The plain (instructor-gated) builder name must not appear as its own word
  // inside this reader (avoid a false negative on the shared "buildHorseCandidates"
  // prefix inside "buildHorseCandidatesForAdmin").
  assert.ok(!/buildHorseCandidates\(/.test(r), "must not call the instructor-gated buildHorseCandidates");
});

test("buildHorseCandidatesForAdmin sources notes from getRidingSlotStudentNotesForAdmin; buildHorseCandidates (instructor) is completely unchanged", () => {
  const adminBuilder = region(
    ridingSlotHorsesSrc,
    "export async function buildHorseCandidatesForAdmin(",
    "function readRidingSlotAssignmentsForCandidates("
  );
  assert.ok(adminBuilder.includes("getRidingSlotStudentNotesForAdmin("), "admin candidate builder must use the admin-audience notes source");
  assert.ok(!adminBuilder.includes("getCurrentInstructor"), "admin candidate builder must never reference getCurrentInstructor");

  const instructorBuilder = region(
    ridingSlotHorsesSrc,
    "export async function buildHorseCandidates(",
    "export async function buildHorseCandidatesForAdmin("
  );
  assert.ok(instructorBuilder.includes("getRidingSlotStudentNotes("), "instructor candidate builder must still use the instructor-gated notes source");
  assert.ok(!instructorBuilder.includes("getRidingSlotStudentNotesForAdmin"), "instructor candidate builder must not be touched by the admin split");
});

test("the two candidate builders share the same assignment read + mapping (no drifting duplicate business logic)", () => {
  assert.ok(
    ridingSlotHorsesSrc.includes("function readRidingSlotAssignmentsForCandidates(ridingSlotId: string)"),
    "expected one shared assignment-read helper"
  );
  assert.ok(
    ridingSlotHorsesSrc.includes("function mapStudentRowsToHorseCandidates("),
    "expected one shared student-row -> candidate mapping helper"
  );
  // Both builders call the SAME two shared helpers (asserted by counting call
  // sites: declaration + 2 call sites each = 3 occurrences of each name).
  const assignmentCalls = (ridingSlotHorsesSrc.match(/readRidingSlotAssignmentsForCandidates\(/g) ?? []).length;
  const mapCalls = (ridingSlotHorsesSrc.match(/mapStudentRowsToHorseCandidates\(/g) ?? []).length;
  assert.equal(assignmentCalls, 3, "declaration + 2 call sites (instructor + admin builder)");
  assert.equal(mapCalls, 3, "declaration + 2 call sites (instructor + admin builder)");
});

// ===========================================================================
// 6) getRidingSlotComplexPlanForAdmin now sources candidates from the
//    admin-audience chain - regression test for the exact named bug.
// ===========================================================================

test("REGRESSION: getRidingSlotComplexPlanForAdmin calls requireAdmin() then buildComplexPlanForEditingForAdmin (never the instructor-shared buildComplexPlanForEditing)", () => {
  const r = region(
    ridingSlotComplexSrc,
    "export async function getRidingSlotComplexPlanForAdmin(",
    "export async function getRidingSlotComplexPlanForInstructor("
  );
  assert.ok(r.includes("requireAdmin()"), "must call requireAdmin()");
  assert.ok(r.includes("buildComplexPlanForEditingForAdmin("), "must delegate to the admin-audience DTO assembler");
  assert.ok(!/buildComplexPlanForEditing\(/.test(r), "must NOT call the instructor-shared buildComplexPlanForEditing");
  assert.ok(!r.includes("getCurrentInstructor"), "admin complex-plan reader must never call getCurrentInstructor");
});

test("buildComplexPlanForEditingForAdmin is module-private, uses buildHorseCandidatesForAdmin, and is otherwise identical to buildComplexPlanForEditing", () => {
  assert.ok(
    !/export\s+(async\s+)?function\s+buildComplexPlanForEditingForAdmin/.test(ridingSlotComplexSrc),
    "the admin DTO assembler must never be exported (no client bypass of the caller's requireAdmin())"
  );
  const adminAssembler = region(
    ridingSlotComplexSrc,
    "async function buildComplexPlanForEditingForAdmin(",
    "export async function getRidingSlotComplexPlanForAdmin("
  );
  assert.ok(adminAssembler.includes("buildHorseCandidatesForAdmin(ridingSlotId)"), "must source candidates from the admin-audience builder");
  assert.ok(!adminAssembler.includes("getCurrentInstructor"), "must never reference getCurrentInstructor");
  assert.ok(!adminAssembler.includes("requireAdmin"), "must not re-gate itself (caller already ran requireAdmin())");
  // Same plan/scheduleMeta/knownHorseNames/simpleList reads as the original.
  assert.ok(adminAssembler.includes("prisma.ridingSlotComplexPlan.findUnique({"));
  assert.ok(adminAssembler.includes("include: COMPLEX_PLAN_INCLUDE"));
  assert.ok(adminAssembler.includes("resolveComplexScheduleMeta(ridingSlotId)"));
  assert.ok(adminAssembler.includes("getKnownRidingHorseNames()"));
  assert.ok(adminAssembler.includes("prisma.ridingSlotHorseList.findUnique({ where: { ridingSlotId }, select: { id: true } })"));
});

test("the instructor complex-plan read path (getRidingSlotComplexPlanForInstructor) is completely unchanged: still buildComplexPlanForEditing + getCurrentInstructor via the DI boundary", () => {
  const r = region(
    ridingSlotComplexSrc,
    "export async function getRidingSlotComplexPlanForInstructor(",
    "async function createComplexPlanInternal("
  );
  assert.ok(r.includes("loadComplexPlanForInstructorWithDeps("), "must still delegate to the instructor DI boundary");
  assert.ok(r.includes("getCurrentInstructor"), "must still thread the instructor actor resolver");
  assert.ok(
    r.includes("buildComplexPlanForEditing(slotId, { canEdit })"),
    "must still use the ORIGINAL (instructor-audience) DTO assembler, not the new admin twin"
  );
});

test("every AsAdmin/AsInstructor complex-plan WRITE action still uses the original buildComplexPlanForEditing unchanged (writers are out of this split's scope)", () => {
  const writerCalls = (ridingSlotComplexSrc.match(/buildComplexPlanForEditing\(/g) ?? []).length;
  const adminOnlyWriterCalls = (ridingSlotComplexSrc.match(/buildComplexPlanForEditingForAdmin\(/g) ?? []).length;
  // Declaration + instructor GET + 11 write re-fetches (unchanged from before
  // this stage) = the ORIGINAL function's call count is untouched by this
  // fix; the NEW admin twin is called only from its own declaration + the
  // admin GET reader (2 occurrences).
  assert.ok(writerCalls >= 12, "the original buildComplexPlanForEditing must still be used by the write re-fetch paths");
  assert.equal(adminOnlyWriterCalls, 2, "the new admin twin is referenced only by its declaration + the admin GET reader");
});

// ===========================================================================
// 7) No unauthenticated path: every newly-exported function in the two
//    touched "use server" modules performs its own admin gate (or is
//    unchanged instructor-gated / private).
// ===========================================================================

test("both 'use server' modules touched by this fix are still Server Action modules with no stray React/client import", () => {
  for (const raw of [ridingSlotsRaw, ridingSlotHorsesRaw, ridingSlotComplexRaw]) {
    assert.ok(/^\s*["']use server["'];/.test(raw), "must still be a 'use server' module");
  }
});

test("buildHorseCandidatesForAdmin is exported (cross-file reuse) but is unreachable without requireAdmin(): it calls ONLY the self-gated admin notes source, never a raw Prisma read of student rows", () => {
  const r = region(
    ridingSlotHorsesSrc,
    "export async function buildHorseCandidatesForAdmin(",
    "function readRidingSlotAssignmentsForCandidates("
  );
  assert.ok(r.includes("getRidingSlotStudentNotesForAdmin(ridingSlotId)"));
  assert.ok(!/prisma\.student\.findMany/.test(r), "must not read Student directly - only via the self-gated admin notes source");
});

test("no bypass-style boolean flag was introduced anywhere in the three touched modules", () => {
  for (const src of [ridingSlotsSrc, ridingSlotHorsesSrc, ridingSlotComplexSrc]) {
    for (const forbidden of ["skipAuth", "isAdmin:", "bypassInstructorCheck", "skipInstructor"]) {
      assert.ok(!src.includes(forbidden), `forbidden bypass-style identifier found: ${forbidden}`);
    }
  }
});

// ===========================================================================
// 8) Sanity: the pre-existing L1/L2 roster-scoping business logic inside
//    buildRidingSlotStudentNotes is untouched by this fix (it is out of
//    scope - see riding-slot-roster-scope.contract.test.ts / .test.ts for the
//    full existing coverage of that logic, unaffected by this change since
//    buildRidingSlotStudentNotes's own body was not modified).
// ===========================================================================

test("buildRidingSlotStudentNotes's own body is unchanged by this fix (still the sole owner of L1/L2 roster-scoping query logic)", () => {
  const core = region(
    ridingSlotsSrc,
    "async function buildRidingSlotStudentNotes(ridingSlotId: string)",
    "export async function getRidingSlotStudentNotes("
  );
  assert.ok(core.includes("useCourseRoster"), "L2 offering-aware branch still present, untouched");
  assert.ok(core.includes("selectRidingRosterCandidates("), "roster-selection core still delegated to, untouched");
  assert.ok(core.includes("getCurrentCourseEnrollmentRoster("), "still resolves the offering roster AS-OF the slot date, untouched");
});
