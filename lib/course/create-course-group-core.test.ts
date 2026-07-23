/**
 * MULTI-COURSE W9A-3 - executable tests for the PURE create-course-group
 * validation core.
 *
 * Run with: npx tsx --test lib/course/create-course-group-core.test.ts
 * PURE: no Prisma, no DB, no clock, no randomness.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  validateNewCourseGroupInput,
  MAX_GROUP_NAME_LENGTH,
  type RawNewCourseGroupInput,
} from "./create-course-group-core";

function input(overrides: Partial<RawNewCourseGroupInput> = {}): RawNewCourseGroupInput {
  return { name: "קבוצה 1", ...overrides };
}

test("trims and accepts a valid name", () => {
  const result = validateNewCourseGroupInput(input({ name: "  קבוצה 1  " }));
  assert.ok(result.ok);
  assert.equal(result.value.name, "קבוצה 1");
});

test("accepts names such as א and ב without treating them as presets", () => {
  const a = validateNewCourseGroupInput(input({ name: "א" }));
  assert.ok(a.ok);
  assert.equal(a.value.name, "א");

  const b = validateNewCourseGroupInput(input({ name: " ב " }));
  assert.ok(b.ok);
  assert.equal(b.value.name, "ב");
});

test("accepts another arbitrary valid group name", () => {
  const result = validateNewCourseGroupInput(input({ name: "קבוצת בוקר" }));
  assert.ok(result.ok);
  assert.equal(result.value.name, "קבוצת בוקר");
});

test("rejects a missing (non-string) name", () => {
  const result = validateNewCourseGroupInput({ name: undefined });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.error, "name_required");
});

test("rejects an empty name", () => {
  const result = validateNewCourseGroupInput(input({ name: "" }));
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.error, "name_required");
});

test("rejects a whitespace-only name", () => {
  const result = validateNewCourseGroupInput(input({ name: "   " }));
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.error, "name_required");
});

test("accepts a name exactly at the maximum length", () => {
  const atMax = "א".repeat(MAX_GROUP_NAME_LENGTH);
  const result = validateNewCourseGroupInput(input({ name: atMax }));
  assert.ok(result.ok);
  assert.equal(result.value.name.length, MAX_GROUP_NAME_LENGTH);
});

test("rejects a name longer than the maximum length (after trimming)", () => {
  const tooLong = "א".repeat(MAX_GROUP_NAME_LENGTH + 1);
  const result = validateNewCourseGroupInput(input({ name: `  ${tooLong}  ` }));
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.error, "name_too_long");
});
