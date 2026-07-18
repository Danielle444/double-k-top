/**
 * Executable tests for the pure contact-directory audience gates
 * (Stage 0A3 — secure contacts self-access).
 *
 * Uses the existing `tsx` runner with Node built-ins `node:test` and
 * `node:assert/strict`. No test framework is installed. Run with:
 *   npx tsx --test lib/auth/contact-directory-access.test.ts
 *
 * These tests are PURE: they exercise only ./contact-directory-access (no
 * next/headers, no Prisma, no cookies). They lock the security properties the
 * wired contact actions depend on:
 *  - the STUDENT directory (trainee PII) is instructor-only;
 *  - the INSTRUCTOR directory is open to either audience;
 *  - an anonymous caller (all ids absent/empty) passes NEITHER gate;
 *  - the audiences cannot be interchanged (a trainee id never opens the
 *    student directory).
 *
 * The complementary facts that (a) getCurrentInstructor()/getCurrentTrainee()
 * already return null for a missing/invalid/wrong-audience/inactive session and
 * (b) a wrong-audience cookie collapses to null are covered by actor-core.test
 * and session tests, and are NOT duplicated here.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  mayAccessStudentContactDirectory,
  mayAccessInstructorContactDirectory,
} from "./contact-directory-access";

const INSTRUCTOR = "instructor-123";
const TRAINEE = "trainee-456";

// --- student contact directory (instructor-only) ---------------------------

test("student directory: a present instructor actor may access", () => {
  assert.equal(mayAccessStudentContactDirectory(INSTRUCTOR), true);
});

test("student directory: absent instructor actor (null/undefined/empty) is denied", () => {
  assert.equal(mayAccessStudentContactDirectory(null), false);
  assert.equal(mayAccessStudentContactDirectory(undefined), false);
  assert.equal(mayAccessStudentContactDirectory(""), false);
});

// Audience isolation: the student directory gate keys ONLY on an instructor
// actor id. There is no trainee parameter, so a valid trainee identity can
// never open the trainee-PII directory - the wrong-audience case is denied.
test("student directory: no trainee-shaped access exists (instructor-only gate)", () => {
  // The only way to pass is a present instructor id; a trainee session yields a
  // null instructor id upstream, which is denied here.
  assert.equal(mayAccessStudentContactDirectory(null), false);
});

// --- instructor contact directory (either audience) ------------------------

test("instructor directory: a present instructor actor may access", () => {
  assert.equal(mayAccessInstructorContactDirectory(INSTRUCTOR, null), true);
});

test("instructor directory: a present trainee actor may access", () => {
  assert.equal(mayAccessInstructorContactDirectory(null, TRAINEE), true);
});

test("instructor directory: both audiences present still grants (OR gate)", () => {
  assert.equal(mayAccessInstructorContactDirectory(INSTRUCTOR, TRAINEE), true);
});

test("instructor directory: anonymous (both ids absent/empty) is denied", () => {
  assert.equal(mayAccessInstructorContactDirectory(null, null), false);
  assert.equal(mayAccessInstructorContactDirectory(undefined, undefined), false);
  assert.equal(mayAccessInstructorContactDirectory("", ""), false);
});

// --- no anonymous access to any directory ----------------------------------

// The single most important property: with no trustworthy actor of any
// audience, neither directory returns access, so no unauthenticated caller can
// ever reach names or phone numbers through either gate.
test("no anonymous access: both gates deny when every actor id is absent", () => {
  assert.equal(mayAccessStudentContactDirectory(null), false);
  assert.equal(mayAccessInstructorContactDirectory(null, null), false);
});
