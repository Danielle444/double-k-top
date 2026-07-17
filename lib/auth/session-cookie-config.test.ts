/**
 * Executable tests for the pure session-cookie configuration layer
 * (Stage 0A-1b).
 *
 * Uses the existing `tsx` runner with Node built-ins `node:test` and
 * `node:assert/strict`. No test framework is installed. Run with:
 *   npx tsx --test lib/auth/session-cookie-config.test.ts
 *
 * These tests are PURE: they never import next/headers or session.ts. The
 * round-trip section exercises the config → crypto seam directly by supplying
 * an explicit secret, mirroring the pure-crypto test idiom.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  SESSION_MAX_AGE_SECONDS,
  SESSION_COOKIE_NAMES,
  cookieNameForAudience,
  buildSessionCookieAttributes,
  buildSessionSigningInput,
} from "./session-cookie-config";
import { signSessionToken, verifySessionToken } from "./session-crypto";
import { parseSessionSecret } from "./session-secret-validation";

// 1. cookie names are distinct and non-colliding
test("cookie names are distinct and non-colliding", () => {
  assert.equal(SESSION_COOKIE_NAMES.instructor, "dk_sess_instructor");
  assert.equal(SESSION_COOKIE_NAMES.trainee, "dk_sess_trainee");
  assert.notEqual(
    SESSION_COOKIE_NAMES.instructor,
    SESSION_COOKIE_NAMES.trainee,
  );
});

// 2. cookieNameForAudience returns the right name per audience
test("cookieNameForAudience maps each audience correctly", () => {
  assert.equal(cookieNameForAudience("instructor"), "dk_sess_instructor");
  assert.equal(cookieNameForAudience("trainee"), "dk_sess_trainee");
});

// 3. the single lifetime constant is exactly 30 days
test("SESSION_MAX_AGE_SECONDS is exactly 30 days in seconds", () => {
  assert.equal(SESSION_MAX_AGE_SECONDS, 2_592_000);
  assert.equal(SESSION_MAX_AGE_SECONDS, 30 * 24 * 60 * 60);
});

// 4. attributes for issuing a cookie in production
test("buildSessionCookieAttributes for issue in production", () => {
  const attrs = buildSessionCookieAttributes({
    isProduction: true,
    maxAgeSeconds: SESSION_MAX_AGE_SECONDS,
  });
  assert.equal(attrs.httpOnly, true);
  assert.equal(attrs.sameSite, "lax");
  assert.equal(attrs.path, "/");
  assert.equal(attrs.secure, true);
  assert.equal(attrs.maxAge, 2_592_000);
});

// 5. attributes outside production relax `secure` only
test("buildSessionCookieAttributes for issue outside production", () => {
  const attrs = buildSessionCookieAttributes({
    isProduction: false,
    maxAgeSeconds: SESSION_MAX_AGE_SECONDS,
  });
  assert.equal(attrs.secure, false);
  assert.equal(attrs.httpOnly, true);
  assert.equal(attrs.sameSite, "lax");
  assert.equal(attrs.path, "/");
  assert.equal(attrs.maxAge, 2_592_000);
});

// 6. attributes for clearing a cookie use maxAge 0, `secure` still follows env
test("buildSessionCookieAttributes for clear uses maxAge 0", () => {
  const prod = buildSessionCookieAttributes({
    isProduction: true,
    maxAgeSeconds: 0,
  });
  assert.equal(prod.maxAge, 0);
  assert.equal(prod.secure, true);
  assert.equal(prod.httpOnly, true);
  assert.equal(prod.sameSite, "lax");
  assert.equal(prod.path, "/");

  const dev = buildSessionCookieAttributes({
    isProduction: false,
    maxAgeSeconds: 0,
  });
  assert.equal(dev.maxAge, 0);
  assert.equal(dev.secure, false);
});

// 7. signing input computes expiresAt from the single lifetime constant
test("buildSessionSigningInput derives expiresAt and passes fields through", () => {
  const issuedAtSeconds = 1_700_000_000;
  const signingInput = buildSessionSigningInput({
    audience: "instructor",
    subject: "instructor-123",
    issuedAtSeconds,
    sessionId: "sess-abc",
  });
  assert.equal(signingInput.audience, "instructor");
  assert.equal(signingInput.subject, "instructor-123");
  assert.equal(signingInput.sessionId, "sess-abc");
  assert.equal(signingInput.issuedAt, issuedAtSeconds);
  assert.equal(signingInput.expiresAt, issuedAtSeconds + 2_592_000);
  assert.equal(
    signingInput.expiresAt,
    signingInput.issuedAt + SESSION_MAX_AGE_SECONDS,
  );
});

// 8. pure config → crypto seam round trip with an explicit secret
test("config → crypto seam round trips for the matching audience", async () => {
  const secret = parseSessionSecret(
    "stage-0a-1b-cookie-config-round-trip-secret-00",
  );
  assert.ok(secret);
  const issuedAtSeconds = Math.floor(Date.now() / 1000);
  const signingInput = buildSessionSigningInput({
    audience: "trainee",
    subject: "student-789",
    issuedAtSeconds,
    sessionId: "sess-seam",
  });
  const token = await signSessionToken(signingInput, secret);
  const result = await verifySessionToken(token, "trainee", secret);
  assert.ok(result);
  assert.equal(result.audience, "trainee");
  assert.equal(result.subject, "student-789");
  assert.equal(result.sessionId, "sess-seam");
  assert.equal(result.issuedAt, issuedAtSeconds);
  assert.equal(result.expiresAt, issuedAtSeconds + SESSION_MAX_AGE_SECONDS);
});

// 9. wrong expected audience fails closed
test("config → crypto seam rejects the wrong expected audience", async () => {
  const secret = parseSessionSecret(
    "stage-0a-1b-cookie-config-round-trip-secret-00",
  );
  assert.ok(secret);
  const issuedAtSeconds = Math.floor(Date.now() / 1000);
  const signingInput = buildSessionSigningInput({
    audience: "instructor",
    subject: "instructor-123",
    issuedAtSeconds,
    sessionId: "sess-seam-2",
  });
  const token = await signSessionToken(signingInput, secret);
  assert.equal(await verifySessionToken(token, "trainee", secret), null);
});

// 10. an already-expired signing input (past issuedAt) fails closed
test("config → crypto seam rejects an already-expired token", async () => {
  const secret = parseSessionSecret(
    "stage-0a-1b-cookie-config-round-trip-secret-00",
  );
  assert.ok(secret);
  // issuedAt far enough in the past that issuedAt + 30 days is already behind
  // us, so exp has already passed.
  const issuedAtSeconds =
    Math.floor(Date.now() / 1000) - (SESSION_MAX_AGE_SECONDS + 3600);
  const signingInput = buildSessionSigningInput({
    audience: "instructor",
    subject: "instructor-123",
    issuedAtSeconds,
    sessionId: "sess-seam-3",
  });
  const token = await signSessionToken(signingInput, secret);
  assert.equal(await verifySessionToken(token, "instructor", secret), null);
});
