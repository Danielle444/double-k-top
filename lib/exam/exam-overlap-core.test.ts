/**
 * EXAM X0 — executable tests for the PURE time-overlap core
 * (exam-overlap-core.ts).
 *
 * Run with: npx tsx --test lib/exam/exam-overlap-core.test.ts
 * PURE: no Prisma, no DB, no clock, no randomness, no env.
 *
 * SCOPE OF PROOF: strict interval overlap; containment; identical intervals;
 * touching boundaries are NOT overlap; different dates are NOT overlap; and
 * malformed HH:MM / date input fails closed to "no overlap".
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  isValidHHMM,
  parseHHMM,
  isValidExamTimeInterval,
  intervalsOverlap,
  type ExamTimeInterval,
} from "./exam-overlap-core";

const D = "2026-07-26";
function iv(start: string, end: string, date = D): ExamTimeInterval {
  return { date, start, end };
}

// --- HH:MM parsing ---------------------------------------------------------

test("parseHHMM parses valid times to minutes since midnight", () => {
  assert.equal(parseHHMM("00:00"), 0);
  assert.equal(parseHHMM("09:30"), 570);
  assert.equal(parseHHMM("23:59"), 1439);
});

test("parseHHMM / isValidHHMM reject malformed times", () => {
  for (const bad of ["24:00", "9:30", "09:60", "0930", "", "aa:bb", null, undefined, 930]) {
    assert.equal(parseHHMM(bad), null, String(bad));
    assert.equal(isValidHHMM(bad), false, String(bad));
  }
});

test("isValidExamTimeInterval requires a well-formed date and positive duration", () => {
  assert.equal(isValidExamTimeInterval(iv("09:00", "10:00")), true);
  assert.equal(isValidExamTimeInterval(iv("10:00", "10:00")), false, "zero length");
  assert.equal(isValidExamTimeInterval(iv("11:00", "10:00")), false, "inverted");
  assert.equal(isValidExamTimeInterval(iv("09:00", "10:00", "2026/07/26")), false, "bad date");
});

// --- overlap ---------------------------------------------------------------

test("partially overlapping intervals on the same date overlap", () => {
  assert.equal(intervalsOverlap(iv("09:00", "10:00"), iv("09:30", "10:30")), true);
  // order-independent
  assert.equal(intervalsOverlap(iv("09:30", "10:30"), iv("09:00", "10:00")), true);
});

test("containment (one interval inside another) is overlap", () => {
  assert.equal(intervalsOverlap(iv("09:00", "12:00"), iv("10:00", "11:00")), true);
  assert.equal(intervalsOverlap(iv("10:00", "11:00"), iv("09:00", "12:00")), true);
});

test("identical intervals overlap", () => {
  assert.equal(intervalsOverlap(iv("09:00", "10:00"), iv("09:00", "10:00")), true);
});

test("touching boundaries are NOT overlap", () => {
  // a ends exactly when b starts
  assert.equal(intervalsOverlap(iv("09:00", "10:00"), iv("10:00", "11:00")), false);
  // and the reverse
  assert.equal(intervalsOverlap(iv("10:00", "11:00"), iv("09:00", "10:00")), false);
});

test("different dates are NOT overlap even at identical clock times", () => {
  assert.equal(
    intervalsOverlap(iv("09:00", "10:00", "2026-07-26"), iv("09:00", "10:00", "2026-07-27")),
    false,
  );
});

test("malformed input fails closed to no overlap", () => {
  assert.equal(intervalsOverlap(iv("09:00", "10:00"), iv("bad", "10:30")), false);
  assert.equal(intervalsOverlap(iv("10:00", "09:00"), iv("09:30", "10:30")), false, "inverted a");
  assert.equal(
    intervalsOverlap(iv("09:00", "10:00", "not-a-date"), iv("09:30", "10:30", "not-a-date")),
    false,
  );
});

test("intervalsOverlap does not mutate its inputs", () => {
  const a = iv("09:00", "10:00");
  const b = iv("09:30", "10:30");
  const aCopy = { ...a };
  const bCopy = { ...b };
  intervalsOverlap(a, b);
  assert.deepEqual(a, aCopy);
  assert.deepEqual(b, bCopy);
});
