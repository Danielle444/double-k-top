/**
 * Pure session-secret validation (Stage 0A-1b).
 *
 * PURITY CONTRACT — this module MUST remain free of runtime/environment
 * coupling. It MUST NEVER read process.env, MUST NEVER log, and MUST NEVER
 * throw. The candidate secret is always supplied explicitly by the caller as a
 * string (or undefined). It only validates and encodes that value, returning a
 * usable HMAC key or null.
 *
 * Importing this module never touches the environment, so it is safe to import
 * with SESSION_SECRET unset.
 *
 * See COURSE-ARCHITECTURE-HANDOFF.md — Stage 0A / AUTH-BLOCKER-1/2.
 */

/** HS256 requires a key of at least 256 bits (32 bytes). */
const MINIMUM_SECRET_BYTES = 32;

/**
 * Validate and encode a candidate session secret.
 *
 * Returns the UTF-8-encoded key as a Uint8Array when the value is a non-empty
 * string of at least {@link MINIMUM_SECRET_BYTES} bytes; otherwise null.
 * Length is measured in BYTES (multibyte UTF-8 counts by encoded length, not
 * character count). Never reads process.env, never logs, never throws.
 *
 * @param value The raw secret candidate (e.g. from a caller that read env).
 */
export function parseSessionSecret(value: string | undefined): Uint8Array | null {
  if (value === undefined) {
    return null;
  }
  if (value.trim() === "") {
    return null;
  }
  const encoded = new TextEncoder().encode(value);
  if (encoded.byteLength < MINIMUM_SECRET_BYTES) {
    return null;
  }
  return encoded;
}
