/**
 * Pure session-cookie configuration (Stage 0A-1b).
 *
 * PURITY CONTRACT — this module MUST remain free of runtime/environment
 * coupling. It MUST NOT import "server-only", next/headers, cookies, Prisma,
 * process.env, or any application action/component, MUST NOT read a secret or
 * environment value, MUST NOT log, and MUST NOT perform side effects at import
 * or call time. It only computes cookie names, attribute objects, and signing
 * input from explicitly supplied arguments.
 *
 * This is the SINGLE source of the session lifetime constant
 * ({@link SESSION_MAX_AGE_SECONDS}) — no other lifetime value is introduced
 * anywhere in the auth layer.
 *
 * See COURSE-ARCHITECTURE-HANDOFF.md — Stage 0A / AUTH-BLOCKER-1/2.
 */

import type {
  IssuableSessionAudience,
  SessionSigningInput,
} from "./session-types";

/**
 * The single session lifetime, in seconds. 30 days: 30 * 24 * 60 * 60.
 * This is the ONLY lifetime constant in the auth layer.
 */
export const SESSION_MAX_AGE_SECONDS = 2_592_000; // 30 * 24 * 60 * 60

/**
 * Cookie names per issuable audience. Instructor and trainee sessions live in
 * distinct, non-colliding cookies so the isolation boundary is physical.
 * `tablet` is intentionally absent — it is never issued (see session-types).
 */
export const SESSION_COOKIE_NAMES: Readonly<
  Record<IssuableSessionAudience, string>
> = {
  instructor: "dk_sess_instructor",
  trainee: "dk_sess_trainee",
};

/** Return the cookie name for an issuable audience. */
export function cookieNameForAudience(
  audience: IssuableSessionAudience,
): string {
  return SESSION_COOKIE_NAMES[audience];
}

/**
 * The exact cookie attributes the session layer sets. Locked to httpOnly +
 * sameSite=lax + path=/; `secure` follows the environment and `maxAge` follows
 * the caller (session lifetime for issue, 0 for clear).
 */
export interface SessionCookieAttributes {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  maxAge: number;
}

/**
 * Build the cookie attributes for a session cookie. `secure` mirrors
 * `isProduction` (HTTPS-only in production, relaxed locally); `maxAge` is
 * supplied explicitly by the caller so the same builder serves both issue
 * (session lifetime) and clear (0).
 */
export function buildSessionCookieAttributes(opts: {
  isProduction: boolean;
  maxAgeSeconds: number;
}): SessionCookieAttributes {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: opts.isProduction,
    path: "/",
    maxAge: opts.maxAgeSeconds,
  };
}

/**
 * Build the narrow signing input for the pure crypto layer from an audience,
 * subject, issued-at time (epoch seconds), and session id. `expiresAt` is
 * always `issuedAt + SESSION_MAX_AGE_SECONDS` — the single lifetime constant.
 */
export function buildSessionSigningInput(opts: {
  audience: IssuableSessionAudience;
  subject: string;
  issuedAtSeconds: number;
  sessionId: string;
}): SessionSigningInput {
  return {
    audience: opts.audience,
    subject: opts.subject,
    sessionId: opts.sessionId,
    issuedAt: opts.issuedAtSeconds,
    expiresAt: opts.issuedAtSeconds + SESSION_MAX_AGE_SECONDS,
  };
}
