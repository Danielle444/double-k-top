/**
 * L2-RIDING-UI - unit tests for the PURE riding-mode availability core.
 *
 * Imports the core directly: it has no Prisma, no "use server", no React and no
 * IO of any kind, so it runs under a plain `tsx --test` process.
 *
 * Run with:
 *   npx tsx --test "app/admin/weekly-schedule/[id]/riding-mode-availability.test.ts"
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  LEVEL_2_COMPLEX_ONLY_NOTE,
  isPreservedLegacySimpleMode,
  resolveRidingModeAvailability,
} from "./riding-mode-availability";

// ---------------------------------------------------------------------------
// Level 1 - completely unchanged. Both modes offerable, nothing explained.
// ---------------------------------------------------------------------------

test("Level 1 still offers BOTH simple and complex, with no restriction note", () => {
  const a = resolveRidingModeAvailability(1);
  assert.equal(a.canCreateSimple, true);
  assert.equal(a.canCreateComplex, true);
  assert.equal(a.complexOnlyNote, null);
});

// ---------------------------------------------------------------------------
// Level 2 - complex only.
// ---------------------------------------------------------------------------

test("Level 2 offers complex only - simple creation is not available", () => {
  const a = resolveRidingModeAvailability(2);
  assert.equal(a.canCreateSimple, false);
  assert.equal(a.canCreateComplex, true);
});

test("Level 2 carries exactly the locked Hebrew explanation", () => {
  assert.equal(
    resolveRidingModeAvailability(2).complexOnlyNote,
    "רמה 2 תומכת כרגע במערכת רכיבות מורכבת בלבד",
  );
  assert.equal(LEVEL_2_COMPLEX_ONLY_NOTE, "רמה 2 תומכת כרגע במערכת רכיבות מורכבת בלבד");
});

test("Level 2 never disables complex creation - the restriction removes ONE option, not the mode picker", () => {
  assert.equal(resolveRidingModeAvailability(2).canCreateComplex, true);
});

// ---------------------------------------------------------------------------
// Unknown level - today's behavior, not a fail-closed restriction.
//
// Every legacy week carries courseOfferingId = NULL and is Level 1; restricting
// on null would silently strip simple mode from all of them.
// ---------------------------------------------------------------------------

test("a null level (legacy week, no CourseOffering) leaves the UI exactly as it is today", () => {
  const a = resolveRidingModeAvailability(null);
  assert.equal(a.canCreateSimple, true);
  assert.equal(a.canCreateComplex, true);
  assert.equal(a.complexOnlyNote, null);
});

test("an undefined level behaves identically to null", () => {
  assert.deepEqual(resolveRidingModeAvailability(undefined), resolveRidingModeAvailability(null));
});

// ---------------------------------------------------------------------------
// The comparison is strict and exact.
// ---------------------------------------------------------------------------

test("the restriction is keyed on the NUMBER 2 - a loosened string \"2\" must not restrict a week", () => {
  const loosened = resolveRidingModeAvailability("2" as unknown as number);
  assert.equal(loosened.canCreateSimple, true);
  assert.equal(loosened.complexOnlyNote, null);
});

test("NaN and other non-2 levels are unrestricted", () => {
  for (const level of [0, 1, 3, 10, -1, Number.NaN]) {
    const a = resolveRidingModeAvailability(level);
    assert.equal(a.canCreateSimple, true, `level ${level} must stay unrestricted`);
    assert.equal(a.complexOnlyNote, null, `level ${level} must show no note`);
  }
});

test("Level 3 is NOT silently covered - it is a separate future product decision", () => {
  assert.equal(resolveRidingModeAvailability(3).canCreateSimple, true);
});

// ---------------------------------------------------------------------------
// Existing data is preserved, never hidden.
// ---------------------------------------------------------------------------

test("a Level 2 slot that ALREADY has a simple list is flagged as preserved legacy, not blocked", () => {
  assert.equal(isPreservedLegacySimpleMode(2, true), true);
});

test("no legacy flag when the Level 2 slot has no existing simple list", () => {
  assert.equal(isPreservedLegacySimpleMode(2, false), false);
});

test("Level 1 and unknown-level slots never show the legacy-simple explanation", () => {
  assert.equal(isPreservedLegacySimpleMode(1, true), false);
  assert.equal(isPreservedLegacySimpleMode(null, true), false);
});

// ---------------------------------------------------------------------------
// The core itself is a pure function of its single input.
// ---------------------------------------------------------------------------

test("resolving the same level twice returns an identical decision (no hidden state)", () => {
  assert.deepEqual(resolveRidingModeAvailability(2), resolveRidingModeAvailability(2));
  assert.deepEqual(resolveRidingModeAvailability(1), resolveRidingModeAvailability(1));
});
