/**
 * COMBINED PARTICIPATION - SLICE IUS-3: DB-free tests for the PURE instructor
 * "משולב" badge label helper.
 *
 * No Prisma, no DB, no clock, no React - the helper takes two plain values.
 * Covers the FULL (courseLevel x tri-state) matrix, the fail-closed behaviour
 * for every non-Level-2 level, determinism, purity, and the locked wording.
 *
 * Run with:
 *   npx tsx --test lib/course/instructor-combined-participation-badge-core.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  INSTRUCTOR_COMBINED_PARTICIPATION_BADGE_LEVEL,
  INSTRUCTOR_COMBINED_PARTICIPATION_WITH_LABEL,
  INSTRUCTOR_COMBINED_PARTICIPATION_WITHOUT_LABEL,
  instructorCombinedParticipationBadgeLabel,
} from "./instructor-combined-participation-badge-core";

const TRI_STATE: (boolean | null)[] = [true, false, null];

// ---------------------------------------------------------------------------
// The locked constants
// ---------------------------------------------------------------------------

test("the badge level is 2 - a CourseOffering.level, never an offering id", () => {
  assert.equal(INSTRUCTOR_COMBINED_PARTICIPATION_BADGE_LEVEL, 2);
  assert.equal(typeof INSTRUCTOR_COMBINED_PARTICIPATION_BADGE_LEVEL, "number");
});

test("the wording is exactly the trainee card's, character for character", () => {
  assert.equal(INSTRUCTOR_COMBINED_PARTICIPATION_WITH_LABEL, "עם משולב");
  assert.equal(INSTRUCTOR_COMBINED_PARTICIPATION_WITHOUT_LABEL, "ללא משולב");
});

// ---------------------------------------------------------------------------
// Level 0 - the fail-closed "unknown level" a denial reports
// ---------------------------------------------------------------------------

test("level 0 (fail-closed unknown) yields NO badge for any tri-state value", () => {
  for (const value of TRI_STATE) {
    assert.equal(
      instructorCombinedParticipationBadgeLabel(0, value),
      null,
      `level 0 + ${String(value)} must produce no badge`,
    );
  }
});

// ---------------------------------------------------------------------------
// Level 1 - must remain completely unchanged
// ---------------------------------------------------------------------------

test("level 1 yields NO badge for any tri-state value, even an explicit true/false", () => {
  for (const value of TRI_STATE) {
    assert.equal(
      instructorCombinedParticipationBadgeLabel(1, value),
      null,
      `level 1 + ${String(value)} must produce no badge`,
    );
  }
});

test("the level gate is checked FIRST - a Level 1 item with stored data still shows nothing", () => {
  // Level 1 rows can legitimately carry a value (the Excel "משולב" column is
  // parsed for every week), so the gate must not depend on the value at all.
  assert.equal(instructorCombinedParticipationBadgeLabel(1, true), null);
  assert.equal(instructorCombinedParticipationBadgeLabel(1, false), null);
});

// ---------------------------------------------------------------------------
// Level 2 - the only level that renders a badge
// ---------------------------------------------------------------------------

test("level 2 + true -> עם משולב", () => {
  assert.equal(instructorCombinedParticipationBadgeLabel(2, true), "עם משולב");
});

test("level 2 + false -> ללא משולב", () => {
  assert.equal(instructorCombinedParticipationBadgeLabel(2, false), "ללא משולב");
});

test("level 2 + null -> NO badge (null is not a third business state)", () => {
  assert.equal(instructorCombinedParticipationBadgeLabel(2, null), null);
});

test("level 2 distinguishes false from null - they must never collapse together", () => {
  const explicitlyWithout = instructorCombinedParticipationBadgeLabel(2, false);
  const notStated = instructorCombinedParticipationBadgeLabel(2, null);
  assert.equal(explicitlyWithout, "ללא משולב");
  assert.equal(notStated, null);
  assert.notEqual(explicitlyWithout, notStated);
});

// ---------------------------------------------------------------------------
// Any other level - fail closed
// ---------------------------------------------------------------------------

test("level 3 yields NO badge for any tri-state value", () => {
  for (const value of TRI_STATE) {
    assert.equal(
      instructorCombinedParticipationBadgeLabel(3, value),
      null,
      `level 3 + ${String(value)} must produce no badge`,
    );
  }
});

test("every level except 2 fails closed across the whole matrix", () => {
  for (const level of [-1, 0, 1, 3, 4, 10, 99]) {
    for (const value of TRI_STATE) {
      assert.equal(
        instructorCombinedParticipationBadgeLabel(level, value),
        null,
        `level ${level} + ${String(value)} must produce no badge`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Totality, determinism, purity
// ---------------------------------------------------------------------------

test("no ordinary numeric level throws - the helper is total", () => {
  for (const level of [-1, 0, 1, 2, 3, 100]) {
    for (const value of TRI_STATE) {
      assert.doesNotThrow(() => instructorCombinedParticipationBadgeLabel(level, value));
    }
  }
});

test("output is deterministic - repeated calls with the same inputs agree", () => {
  for (const level of [0, 1, 2, 3]) {
    for (const value of TRI_STATE) {
      const first = instructorCombinedParticipationBadgeLabel(level, value);
      for (let i = 0; i < 5; i++) {
        assert.equal(instructorCombinedParticipationBadgeLabel(level, value), first);
      }
    }
  }
});

test("the helper mutates nothing it is given and reads no ambient state", () => {
  // Primitives cannot be mutated in place, so purity is proven by the caller's
  // own values surviving unchanged plus the exhaustive determinism above.
  let level = 2;
  let value: boolean | null = false;
  const label = instructorCombinedParticipationBadgeLabel(level, value);
  assert.equal(label, "ללא משולב");
  assert.equal(level, 2);
  assert.equal(value, false);
  // Re-reading after an unrelated reassignment must not change earlier results.
  level = 1;
  value = true;
  assert.equal(label, "ללא משולב");
  assert.equal(instructorCombinedParticipationBadgeLabel(level, value), null);
});

test("the returned value is only ever one of the two labels or null", () => {
  const allowed = new Set<string | null>([
    INSTRUCTOR_COMBINED_PARTICIPATION_WITH_LABEL,
    INSTRUCTOR_COMBINED_PARTICIPATION_WITHOUT_LABEL,
    null,
  ]);
  for (const level of [-1, 0, 1, 2, 3, 7]) {
    for (const value of TRI_STATE) {
      assert.ok(
        allowed.has(instructorCombinedParticipationBadgeLabel(level, value)),
        `unexpected output for level ${level} + ${String(value)}`,
      );
    }
  }
});
