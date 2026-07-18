/**
 * Executable tests for the pure interval resolver (Stage GH1A).
 *
 * Uses the existing `tsx` runner with Node built-ins `node:test` and
 * `node:assert/strict`. No test framework is installed. Run with:
 *   npx tsx --test lib/trainee-history/interval-resolver.test.ts
 *
 * PURE: no Prisma, no DB, no Next.js runtime, no clock, no randomness. All
 * fixtures are fixed plain-data literals with date-only YYYY-MM-DD keys.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveIntervalAtDate,
  isValidDateKey,
  compareDateKeys,
  type IntervalRow,
} from "./interval-resolver";

function row(
  id: string,
  effectiveFrom: string,
  effectiveTo: string | null,
  value: string,
): IntervalRow<string> {
  return { id, effectiveFrom, effectiveTo, value };
}

// A contiguous, non-overlapping, open-ended-last history.
const CONTIGUOUS: IntervalRow<string>[] = [
  row("a", "2026-01-01", "2026-02-01", "A"),
  row("b", "2026-02-01", "2026-03-01", "B"),
  row("c", "2026-03-01", null, "C"),
];

// A history with an intentional gap in February (no row covers Feb).
const GAPPED: IntervalRow<string>[] = [
  row("a", "2026-01-01", "2026-02-01", "A"),
  row("c", "2026-03-01", null, "C"),
];

// --- isValidDateKey / compareDateKeys sanity (date-only, no timezone) ---

test("isValidDateKey accepts real dates and rejects malformed / invalid ones", () => {
  assert.equal(isValidDateKey("2026-01-01"), true);
  assert.equal(isValidDateKey("2024-02-29"), true); // leap day
  assert.equal(isValidDateKey("2026-02-29"), false); // not a leap year
  assert.equal(isValidDateKey("2026-13-01"), false); // bad month
  assert.equal(isValidDateKey("2026-00-10"), false); // bad month
  assert.equal(isValidDateKey("2026-01-32"), false); // bad day
  assert.equal(isValidDateKey("2026-1-1"), false); // not zero-padded
  assert.equal(isValidDateKey("20260101"), false);
  assert.equal(isValidDateKey(20260101 as unknown), false);
});

test("compareDateKeys orders date-only keys chronologically", () => {
  assert.equal(compareDateKeys("2026-01-01", "2026-02-01") < 0, true);
  assert.equal(compareDateKeys("2026-03-01", "2026-02-01") > 0, true);
  assert.equal(compareDateKeys("2026-02-01", "2026-02-01"), 0);
});

// --- resolver behaviour ---

// 1. event on effectiveFrom belongs to that row.
test("date equal to a row's effectiveFrom resolves to that row", () => {
  const resolved = resolveIntervalAtDate(CONTIGUOUS, "2026-02-01");
  assert.ok(resolved);
  assert.equal(resolved.id, "b");
});

// 2. event before the first effectiveFrom resolves to null.
test("date before the first effectiveFrom resolves to null", () => {
  assert.equal(resolveIntervalAtDate(CONTIGUOUS, "2025-12-31"), null);
});

// 3. event strictly inside an interval resolves to that interval.
test("date inside an interval resolves to that interval", () => {
  const resolved = resolveIntervalAtDate(CONTIGUOUS, "2026-02-15");
  assert.ok(resolved);
  assert.equal(resolved.id, "b");
});

// 4a. event on effectiveTo returns the NEXT row (exclusive upper bound).
test("date equal to a row's effectiveTo resolves to the next row", () => {
  // 2026-02-01 is a.effectiveTo (exclusive) and b.effectiveFrom (inclusive).
  const resolved = resolveIntervalAtDate(CONTIGUOUS, "2026-02-01");
  assert.ok(resolved);
  assert.equal(resolved.id, "b");
});

// 4b. event on effectiveTo returns null when no next row starts there (gap).
test("date equal to a closed row's effectiveTo resolves to null across a gap", () => {
  // 2026-02-01 is a.effectiveTo but no row starts on 2026-02-01 in GAPPED.
  assert.equal(resolveIntervalAtDate(GAPPED, "2026-02-01"), null);
});

// 5. open-ended row covers all dates at/after its effectiveFrom.
test("an open-ended row covers dates far into the future", () => {
  const resolved = resolveIntervalAtDate(CONTIGUOUS, "2027-06-01");
  assert.ok(resolved);
  assert.equal(resolved.id, "c");
});

// 6. intentional gap resolves to null.
test("a date inside an intentional gap resolves to null", () => {
  assert.equal(resolveIntervalAtDate(GAPPED, "2026-02-15"), null);
});

// 7. unsorted input still resolves deterministically to the covering row.
test("unsorted input resolves deterministically", () => {
  const shuffled = [CONTIGUOUS[2], CONTIGUOUS[0], CONTIGUOUS[1]];
  const inside = resolveIntervalAtDate(shuffled, "2026-02-15");
  assert.ok(inside);
  assert.equal(inside.id, "b");
  const onBoundary = resolveIntervalAtDate(shuffled, "2026-03-01");
  assert.ok(onBoundary);
  assert.equal(onBoundary.id, "c");
});

// 8. resolving never mutates the input array or its rows.
test("resolving does not mutate the input", () => {
  const snapshot = JSON.parse(JSON.stringify(CONTIGUOUS));
  resolveIntervalAtDate(CONTIGUOUS, "2026-02-15");
  resolveIntervalAtDate(CONTIGUOUS, "2026-02-01");
  resolveIntervalAtDate(CONTIGUOUS, "2025-01-01");
  assert.deepEqual(CONTIGUOUS, snapshot);
});

// 9. malformed query date throws (defensive; programmer error).
test("a malformed query date throws", () => {
  assert.throws(() => resolveIntervalAtDate(CONTIGUOUS, "2026-13-01"));
});

// 10. empty history resolves to null.
test("empty history resolves to null", () => {
  assert.equal(resolveIntervalAtDate([], "2026-02-01"), null);
});
