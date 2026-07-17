/**
 * Session-cookie runtime wrappers (Stage 0A-1b).
 *
 * SERVER-ONLY BY CONSTRUCTION — this module imports `cookies` from
 * "next/headers", which is server-only and cannot be bundled into client code.
 * Following the repo convention (see lib/teaching-practice-full-sync-core.ts),
 * the `server-only` package is NOT imported: it is not a dependency of this
 * project and no other file uses it. Server-only-ness here is enforced by the
 * next/headers import, not by a marker package.
 *
 * This module is the ONLY reader of process.env.SESSION_SECRET, and it reads it
 * (and NODE_ENV) ONLY inside invoked functions — never at import time — so the
 * module loads cleanly regardless of environment configuration.
 *
 * It is intentionally UN-WIRED in Stage 0A-1b: no existing file imports it. It
 * exists so a later stage can wire login/logout/actor-derivation onto a tested
 * cookie surface. All exports are typed to IssuableSessionAudience so the
 * reserved `tablet` audience is unrepresentable here.
 *
 * See COURSE-ARCHITECTURE-HANDOFF.md — Stage 0A / AUTH-BLOCKER-1/2.
 */

import { cookies } from "next/headers";
import { signSessionToken, verifySessionToken } from "./session-crypto";
import { parseSessionSecret } from "./session-secret-validation";
import {
  cookieNameForAudience,
  buildSessionCookieAttributes,
  buildSessionSigningInput,
  SESSION_MAX_AGE_SECONDS,
} from "./session-cookie-config";
import type {
  IssuableSessionAudience,
  VerifiedSession,
} from "./session-types";

/** Whether the process is running in production. Read at call time. */
function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Resolve the HMAC secret from the environment. Read at call time, inside this
 * function only — never at import. Returns null when the secret is missing or
 * too weak (parseSessionSecret fails closed).
 */
function resolveSecret(): Uint8Array | null {
  return parseSessionSecret(process.env.SESSION_SECRET);
}

/** Input required to issue a session cookie for an issuable audience. */
export interface IssueSessionInput {
  audience: IssuableSessionAudience;
  subject: string;
}

/**
 * Issue (set) a signed httpOnly session cookie for the given audience/subject.
 *
 * Fails closed with a generic error if no usable secret is configured — the
 * error message intentionally omits any secret or token detail. On success a
 * fresh session id and issued-at timestamp are minted server-side.
 */
export async function issueSessionCookie(
  input: IssueSessionInput,
): Promise<void> {
  const secret = resolveSecret();
  if (secret === null) {
    throw new Error("session secret unavailable");
  }
  const issuedAtSeconds = Math.floor(Date.now() / 1000);
  const sessionId = crypto.randomUUID();
  const signingInput = buildSessionSigningInput({
    audience: input.audience,
    subject: input.subject,
    issuedAtSeconds,
    sessionId,
  });
  const token = await signSessionToken(signingInput, secret);
  const attributes = buildSessionCookieAttributes({
    isProduction: isProduction(),
    maxAgeSeconds: SESSION_MAX_AGE_SECONDS,
  });
  const store = await cookies();
  store.set(cookieNameForAudience(input.audience), token, attributes);
}

/**
 * Read and verify the session cookie for the given audience. Returns the
 * verified session, or null for any failure (no cookie, no/weak secret, or a
 * token that fails verification — verifySessionToken already returns null on
 * every invalid case).
 */
export async function readSessionCookie(
  audience: IssuableSessionAudience,
): Promise<VerifiedSession | null> {
  const store = await cookies();
  const value = store.get(cookieNameForAudience(audience))?.value;
  if (!value) {
    return null;
  }
  const secret = resolveSecret();
  if (secret === null) {
    return null;
  }
  return await verifySessionToken(value, audience, secret);
}

/**
 * Clear the session cookie for the given audience by overwriting it with an
 * empty value and maxAge 0. Uses set(...) (never cookies().delete(...)) so the
 * exact same attributes are re-emitted. Needs no secret and is idempotent.
 */
export async function clearSessionCookie(
  audience: IssuableSessionAudience,
): Promise<void> {
  const attributes = buildSessionCookieAttributes({
    isProduction: isProduction(),
    maxAgeSeconds: 0,
  });
  const store = await cookies();
  store.set(cookieNameForAudience(audience), "", attributes);
}
