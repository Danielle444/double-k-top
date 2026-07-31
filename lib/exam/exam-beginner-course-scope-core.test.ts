/**
 * EXAM EX-BEGINNER-EXAM-READ — tests for the PURE beginner course-scope
 * predicate.
 *
 * The predicate is one comparison, so these tests are almost entirely about the
 * FAIL-CLOSED edge: everything that is not exactly the integer 1 must disable
 * beginner reading, because the thing on the other side of a `true` here is
 * another course's children and parent contacts.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  BEGINNER_SOURCE_COURSE_LEVEL,
  isBeginnerSourceCourseLevel,
} from "./exam-beginner-course-scope-core";

const MODULE_REL = join("lib", "exam", "exam-beginner-course-scope-core.ts");
const MODULE_ABS = join(process.cwd(), MODULE_REL);

test("the beginner source level is Level 1", () => {
  assert.equal(BEGINNER_SOURCE_COURSE_LEVEL, 1);
});

test("Level 1 — and ONLY Level 1 — may read beginner rows", () => {
  assert.equal(isBeginnerSourceCourseLevel(1), true);
  for (const level of [0, 2, 3, 4, 10, -1, -2]) {
    assert.equal(
      isBeginnerSourceCourseLevel(level),
      false,
      `level ${level} must not read beginner rows`,
    );
  }
});

test("Level 2 is refused explicitly — the product rule this slice exists for", () => {
  assert.equal(isBeginnerSourceCourseLevel(2), false);
});

test("an absent, null or undefined level FAILS CLOSED", () => {
  assert.equal(isBeginnerSourceCourseLevel(undefined), false);
  assert.equal(isBeginnerSourceCourseLevel(null), false);
});

test("a non-number level FAILS CLOSED, including a numeric STRING", () => {
  for (const value of ["1", " 1 ", "1.0", "one", true, false, {}, [], [1], () => 1]) {
    assert.equal(
      isBeginnerSourceCourseLevel(value),
      false,
      `${JSON.stringify(String(value))} must not read beginner rows`,
    );
  }
});

test("NaN, Infinity and a non-integer FAIL CLOSED", () => {
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1.5, 0.999999, 1.0000001]) {
    assert.equal(isBeginnerSourceCourseLevel(value), false, `${value} must not read beginner rows`);
  }
});

test("a BOXED Number(1) fails closed — identity is the primitive, not a wrapper", () => {
  assert.equal(isBeginnerSourceCourseLevel(new Number(1)), false);
});

test("1.0 IS 1 in JavaScript and is accepted — this is not a bug, it is the same value", () => {
  assert.equal(isBeginnerSourceCourseLevel(1.0), true);
});

test("the predicate is deterministic and mutates nothing", () => {
  const input = { level: 1 };
  const before = JSON.stringify(input);
  for (let i = 0; i < 5; i += 1) {
    assert.equal(isBeginnerSourceCourseLevel(input.level), true);
  }
  assert.equal(JSON.stringify(input), before);
});

test("the module is PURE: no database, auth, clock, env, network or IO", () => {
  assert.ok(existsSync(MODULE_ABS), `expected ${MODULE_REL} to exist`);
  const source = readFileSync(MODULE_ABS, "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  for (const token of [
    // Split literals on purpose: exam-no-feedback-guard.test.ts scans every file
    // in lib/exam for these exact strings, so spelling one out would trip it.
    "pris" + "ma",
    "@/lib/" + "prisma",
    "@prisma" + "/client",
    "server-only",
    "use server",
    "use client",
    "next/",
    "cookies",
    "session",
    "process.env",
    "Date.now",
    "new Date",
    "Math.random",
    "fetch(",
    "node:fs",
  ]) {
    assert.equal(code.includes(token), false, `the predicate must not reference ${token}`);
  }
  // It has no imports at all — nothing to drift, nothing to mock.
  assert.equal(/^\s*import\s/m.test(code), false, "the predicate must import nothing");
});

test("no course-offering ID is hardcoded — the rule is a LEVEL, not an id", () => {
  const source = readFileSync(MODULE_ABS, "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  // A cuid is 25 chars starting with `c`; no string literal of that shape may
  // appear, and neither may any of the launch offering-id constants.
  assert.equal(/["'`]c[a-z0-9]{20,}["'`]/i.test(code), false, "a cuid literal is hardcoded");
  for (const token of ["LEVEL_1_COURSE_OFFERING_ID", "LEVEL_2_COURSE_OFFERING_ID", "courseOfferingId"]) {
    assert.equal(code.includes(token), false, `the predicate must not reference ${token}`);
  }
});
