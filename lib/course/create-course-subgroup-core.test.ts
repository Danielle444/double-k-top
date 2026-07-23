/**
 * MULTI-COURSE W9A-4 - executable tests for the PURE create-course-subgroup
 * validation/normalization core.
 *
 * Run with: npx tsx --test lib/course/create-course-subgroup-core.test.ts
 * PURE: no Prisma, no DB, no clock, no randomness.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { validateNewCourseSubgroupInput } from "./create-course-subgroup-core";

/** Assert a raw value normalizes to the given canonical decimal string. */
function accepts(raw: unknown, expected: string): void {
  assert.deepEqual(validateNewCourseSubgroupInput({ subgroupNumber: raw }), {
    ok: true,
    value: { name: expected },
  });
}

/** Assert a raw value is rejected as subgroup_invalid (never coerced/stored). */
function rejects(raw: unknown): void {
  assert.deepEqual(validateNewCourseSubgroupInput({ subgroupNumber: raw }), {
    ok: false,
    error: "subgroup_invalid",
  });
}

test('"1" -> "1" and "2" -> "2"', () => {
  accepts("1", "1");
  accepts("2", "2");
});

test('leading zeros normalize: "01" -> "1", "00012" -> "12"', () => {
  accepts("01", "1");
  accepts("00012", "12");
});

test("surrounding whitespace is trimmed before validation", () => {
  accepts("  5  ", "5");
});

test("Number.MAX_SAFE_INTEGER is accepted and stored as plain decimal digits", () => {
  const max = String(Number.MAX_SAFE_INTEGER); // "9007199254740991"
  const result = validateNewCourseSubgroupInput({ subgroupNumber: max });
  assert.ok(result.ok);
  assert.equal(result.value.name, max);
  // Never scientific notation / Infinity / NaN.
  assert.match(result.value.name, /^[1-9][0-9]*$/);
});

test("a value greater than Number.MAX_SAFE_INTEGER is rejected", () => {
  // 9007199254740992 === 2^53 is representable but NOT a safe integer.
  rejects("9007199254740992");
  // A much larger digit string that cannot be represented precisely.
  rejects("99999999999999999999");
});

test('"0" and "000" are rejected', () => {
  rejects("0");
  rejects("000");
});

test("negatives and signs are rejected", () => {
  rejects("-1");
  rejects("+1");
});

test("decimals and scientific notation are rejected", () => {
  rejects("1.5");
  rejects("1e3");
});

test("letters and mixed non-digits are rejected", () => {
  rejects("abc");
  rejects("1a");
  rejects("a1");
});

test("empty and whitespace-only input is rejected", () => {
  rejects("");
  rejects("   ");
});

test("missing / non-string input is rejected", () => {
  rejects(undefined);
  rejects(null);
  rejects(123);
  rejects(1);
  rejects({});
  rejects(["1"]);
  rejects(true);
});
