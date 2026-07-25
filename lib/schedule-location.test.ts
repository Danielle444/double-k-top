/**
 * Pure, DB-free tests for the trainee schedule-card location label helper.
 *
 * Run with:
 *   npx tsx --test lib/schedule-location.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { formatScheduleLocationLabel } from "./schedule-location";

test("a real, non-empty location is returned as-is", () => {
  assert.equal(formatScheduleLocationLabel("חדר 3"), "חדר 3");
});

test("surrounding whitespace on a real location is trimmed", () => {
  assert.equal(formatScheduleLocationLabel("  חדר 3  "), "חדר 3");
});

test("null returns null", () => {
  assert.equal(formatScheduleLocationLabel(null), null);
});

test("empty string returns null", () => {
  assert.equal(formatScheduleLocationLabel(""), null);
});

test("whitespace-only string returns null", () => {
  assert.equal(formatScheduleLocationLabel("   "), null);
  assert.equal(formatScheduleLocationLabel("\t\n "), null);
});
