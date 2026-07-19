import { test } from "node:test";
import assert from "node:assert/strict";

import {
  decideTeachingPracticeRatingBadge,
  type TeachingPracticeRatingBadgeInput,
  type TeachingPracticeRatingBadgeRole,
} from "./teaching-practice-rating-badge-core";

// A permitted, valid baseline that each test overrides one field of, so every
// assertion isolates exactly the property under test.
function baseInput(): TeachingPracticeRatingBadgeInput {
  return {
    role: "instructor",
    canEditTeachingPracticeFeedback: true,
    practiceType: "BEGINNER_PRIVATE",
    ratingHalfPoints: 8,
  };
}

test("authorized instructor + BEGINNER_PRIVATE + rating 8 -> visible '4'", () => {
  const decision = decideTeachingPracticeRatingBadge({
    role: "instructor",
    canEditTeachingPracticeFeedback: true,
    practiceType: "BEGINNER_PRIVATE",
    ratingHalfPoints: 8,
  });
  assert.equal(decision.visible, true);
  assert.equal(decision.displayValue, "4");
});

test("authorized instructor + BEGINNER_GROUP + rating 9 -> visible '4.5'", () => {
  const decision = decideTeachingPracticeRatingBadge({
    role: "instructor",
    canEditTeachingPracticeFeedback: true,
    practiceType: "BEGINNER_GROUP",
    ratingHalfPoints: 9,
  });
  assert.equal(decision.visible, true);
  assert.equal(decision.displayValue, "4.5");
});

test("unauthorized instructor (capability false) -> hidden", () => {
  const decision = decideTeachingPracticeRatingBadge({
    ...baseInput(),
    role: "instructor",
    canEditTeachingPracticeFeedback: false,
  });
  assert.equal(decision.visible, false);
  assert.equal(decision.displayValue, null);
});

test("instructor with missing/undefined permission -> hidden (fail closed)", () => {
  const missing: unknown[] = [undefined, null, 0, 1, "", "true", "false", NaN, {}, []];
  for (const cap of missing) {
    const decision = decideTeachingPracticeRatingBadge({
      ...baseInput(),
      role: "instructor",
      canEditTeachingPracticeFeedback: cap as unknown as boolean,
    });
    assert.equal(decision.visible, false, `capability ${String(cap)} must be denied`);
    assert.equal(decision.displayValue, null);
  }
});

test("admin -> visible regardless of the capability flag", () => {
  for (const cap of [true, false, undefined as unknown as boolean]) {
    const decision = decideTeachingPracticeRatingBadge({
      ...baseInput(),
      role: "admin",
      canEditTeachingPracticeFeedback: cap,
    });
    assert.equal(decision.visible, true, `admin cap ${String(cap)} must be visible`);
    assert.equal(decision.displayValue, "4");
  }
});

test("authorized instructor + LUNGE + rating 8 -> visible '4'", () => {
  const decision = decideTeachingPracticeRatingBadge({
    role: "instructor",
    canEditTeachingPracticeFeedback: true,
    practiceType: "LUNGE",
    ratingHalfPoints: 8,
  });
  assert.equal(decision.visible, true);
  assert.equal(decision.displayValue, "4");
});

test("authorized instructor + LUNGE + rating 9 -> visible '4.5'", () => {
  const decision = decideTeachingPracticeRatingBadge({
    role: "instructor",
    canEditTeachingPracticeFeedback: true,
    practiceType: "LUNGE",
    ratingHalfPoints: 9,
  });
  assert.equal(decision.visible, true);
  assert.equal(decision.displayValue, "4.5");
});

test("admin + LUNGE -> visible", () => {
  const decision = decideTeachingPracticeRatingBadge({
    role: "admin",
    canEditTeachingPracticeFeedback: false,
    practiceType: "LUNGE",
    ratingHalfPoints: 8,
  });
  assert.equal(decision.visible, true);
  assert.equal(decision.displayValue, "4");
});

test("unauthorized instructor + LUNGE -> hidden", () => {
  const decision = decideTeachingPracticeRatingBadge({
    role: "instructor",
    canEditTeachingPracticeFeedback: false,
    practiceType: "LUNGE",
    ratingHalfPoints: 8,
  });
  assert.equal(decision.visible, false);
  assert.equal(decision.displayValue, null);
});

test("null / invalid LUNGE rating -> hidden", () => {
  const invalid: unknown[] = [null, undefined, 0, 1, 11, 4.5, NaN, "8"];
  for (const rating of invalid) {
    const decision = decideTeachingPracticeRatingBadge({
      role: "instructor",
      canEditTeachingPracticeFeedback: true,
      practiceType: "LUNGE",
      ratingHalfPoints: rating as unknown as number,
    });
    assert.equal(decision.visible, false, `LUNGE rating ${String(rating)} must be hidden`);
    assert.equal(decision.displayValue, null);
  }
});

test("unknown practice type -> hidden", () => {
  for (const practiceType of ["", "beginner_private", "PRIVATE", "OTHER", "BEGINNER"]) {
    const decision = decideTeachingPracticeRatingBadge({ ...baseInput(), practiceType });
    assert.equal(decision.visible, false, `practiceType '${practiceType}' must be hidden`);
    assert.equal(decision.displayValue, null);
  }
});

test("null / undefined rating -> hidden", () => {
  for (const rating of [null, undefined]) {
    const decision = decideTeachingPracticeRatingBadge({ ...baseInput(), ratingHalfPoints: rating });
    assert.equal(decision.visible, false, `rating ${String(rating)} must be hidden`);
    assert.equal(decision.displayValue, null);
  }
});

test("out-of-range / non-integer rating -> hidden", () => {
  const invalid: unknown[] = [0, 1, 11, 12, -2, -1, 4.5, 3.1, NaN, Infinity, -Infinity, "8", "4"];
  for (const rating of invalid) {
    const decision = decideTeachingPracticeRatingBadge({
      ...baseInput(),
      ratingHalfPoints: rating as unknown as number,
    });
    assert.equal(decision.visible, false, `rating ${String(rating)} must be hidden`);
    assert.equal(decision.displayValue, null);
  }
});

test("every in-range integer rating renders the expected half-point value", () => {
  const expected: Record<number, string> = {
    2: "1",
    3: "1.5",
    4: "2",
    5: "2.5",
    6: "3",
    7: "3.5",
    8: "4",
    9: "4.5",
    10: "5",
  };
  for (const [halfPoints, value] of Object.entries(expected)) {
    const decision = decideTeachingPracticeRatingBadge({
      ...baseInput(),
      ratingHalfPoints: Number(halfPoints),
    });
    assert.equal(decision.visible, true, `rating ${halfPoints} must be visible`);
    assert.equal(decision.displayValue, value);
  }
});

test("unknown role -> hidden", () => {
  for (const role of ["unknown", "trainee", "", "ADMIN", "Instructor"]) {
    const decision = decideTeachingPracticeRatingBadge({
      ...baseInput(),
      role: role as unknown as TeachingPracticeRatingBadgeRole,
    });
    assert.equal(decision.visible, false, `role '${role}' must be hidden`);
    assert.equal(decision.displayValue, null);
  }
});

test("deterministic: same input yields an equal decision twice", () => {
  const input = baseInput();
  const a = decideTeachingPracticeRatingBadge(input);
  const b = decideTeachingPracticeRatingBadge(input);
  assert.deepEqual(a, b);
  assert.equal(a.visible, true);
});

test("does not mutate its input (visible case)", () => {
  const input = baseInput();
  decideTeachingPracticeRatingBadge(input);
  assert.deepEqual(input, baseInput());
});

test("does not mutate its input (hidden case)", () => {
  const input: TeachingPracticeRatingBadgeInput = { ...baseInput(), practiceType: "LUNGE" };
  decideTeachingPracticeRatingBadge(input);
  assert.deepEqual(input, { ...baseInput(), practiceType: "LUNGE" });
});

test("the returned decision is immutable (frozen)", () => {
  const decision = decideTeachingPracticeRatingBadge(baseInput());
  assert.equal(Object.isFrozen(decision), true);
  assert.throws(() => {
    // @ts-expect-error - decision is a readonly, frozen object
    decision.visible = false;
  });
});
