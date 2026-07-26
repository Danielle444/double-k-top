// RC-A0 - pure validation / normalization / resolution core for the custom
// display title of ONE complex-riding session (a RidingSlotComplexPlan). The
// named object is the whole session - never a trainee, pair, block, station,
// horse, or a ScheduleItem mirror.
//
// PURE by construction: NO imports at all. No Prisma, no DB, no next/headers,
// no React, no auth/session/cookies, no env, NO clock (`Date.now()` / argless
// `new Date()`), no random, no `localeCompare`, no locale/timezone. Every result
// is derived solely from the explicit arguments.
//
// This stage adds NO schema, persistence, publication write, reader, or UI. It
// only decides (a) whether a manager-entered title is valid and its normalized
// form, and (b) the effective display title for a LIVE or PUBLISHED surface,
// given a caller-supplied generated fallback. The core NEVER hardcodes the
// Level 1/Level 2 rule or the "תרגול הדרכה" fallback - the caller supplies the
// fallback - and it NEVER imports student presentation logic.

/** Maximum normalized title length (inclusive). */
export const COMPLEX_SESSION_TITLE_MAX_LENGTH = 60;

/** Stable machine-readable validation error codes. */
export type ComplexSessionTitleErrorCode = "TITLE_TOO_LONG" | "TITLE_MULTILINE";

/** Hebrew, UI-ready messages for each validation error code. */
export const COMPLEX_SESSION_TITLE_MESSAGES: Readonly<
  Record<ComplexSessionTitleErrorCode, string>
> = Object.freeze({
  TITLE_TOO_LONG: "שם הרכיבה המורכבת יכול להכיל עד 60 תווים",
  TITLE_MULTILINE: "שם הרכיבה המורכבת חייב להופיע בשורה אחת",
});

/**
 * The discriminated validation result. `ok: true` carries the normalized value
 * (a trimmed non-empty string, or null for a cleared/empty title); `ok: false`
 * carries a stable code plus a Hebrew message. Overlong input is NEVER silently
 * truncated - it is rejected.
 */
export type ComplexSessionTitleValidationResult =
  | { readonly ok: true; readonly value: string | null }
  | {
      readonly ok: false;
      readonly code: ComplexSessionTitleErrorCode;
      readonly message: string;
    };

/** Which surface a title is being resolved for - LIVE plan vs PUBLISHED snapshot. */
export type ComplexSessionTitleSurface = "LIVE" | "PUBLISHED";

// Shared frozen "cleared title" result (null/undefined/empty/whitespace-only).
const VALID_NULL: ComplexSessionTitleValidationResult = Object.freeze({
  ok: true as const,
  value: null,
});

// A single-line title carries no CR or LF. `.trim()` already removes leading/
// trailing whitespace (including newlines at the ends), so this only catches an
// EMBEDDED line break.
const LINE_BREAK_PATTERN = /[\r\n]/;

/**
 * Validate and normalize a manager-entered complex-session title.
 *
 * - null / undefined / empty / whitespace-only -> `{ ok: true, value: null }`.
 * - trims leading/trailing whitespace; a valid title is preserved trimmed.
 * - an embedded CR/LF -> `{ ok: false, code: "TITLE_MULTILINE" }`.
 * - a normalized length > 60 -> `{ ok: false, code: "TITLE_TOO_LONG" }`.
 *
 * Pure, deterministic, non-mutating, never throws; the returned object is frozen.
 * Multiline is checked before length so a multiline value is always reported as
 * multiline regardless of length.
 */
export function validateComplexSessionTitle(
  input: string | null | undefined
): ComplexSessionTitleValidationResult {
  if (input === null || input === undefined) {
    return VALID_NULL;
  }

  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return VALID_NULL;
  }
  if (LINE_BREAK_PATTERN.test(trimmed)) {
    return Object.freeze({
      ok: false as const,
      code: "TITLE_MULTILINE" as const,
      message: COMPLEX_SESSION_TITLE_MESSAGES.TITLE_MULTILINE,
    });
  }
  if (trimmed.length > COMPLEX_SESSION_TITLE_MAX_LENGTH) {
    return Object.freeze({
      ok: false as const,
      code: "TITLE_TOO_LONG" as const,
      message: COMPLEX_SESSION_TITLE_MESSAGES.TITLE_TOO_LONG,
    });
  }
  return Object.freeze({ ok: true as const, value: trimmed });
}

/**
 * Resolve the effective display title for one complex session.
 *
 * Precedence, per surface (there is NO cross-surface mixing):
 *  - LIVE:      a valid, non-empty normalized `liveTitle`, else `generatedFallback`.
 *  - PUBLISHED: a valid, non-empty normalized `publishedTitleSnapshot`, else
 *               `generatedFallback`.
 *
 * A PUBLISHED surface NEVER reads `liveTitle`; a LIVE surface NEVER reads
 * `publishedTitleSnapshot`. A stored value that is malformed (legacy/corrupt:
 * overlong or multiline) fails safely to `generatedFallback` - the core never
 * throws and never exposes multiline or overlong text. `generatedFallback` is
 * returned verbatim (the caller owns it, e.g. "תרגול הדרכה").
 */
export function resolveComplexSessionTitle(params: {
  readonly surface: ComplexSessionTitleSurface;
  readonly liveTitle?: string | null;
  readonly publishedTitleSnapshot?: string | null;
  readonly generatedFallback: string;
}): string {
  const stored =
    params.surface === "PUBLISHED" ? params.publishedTitleSnapshot : params.liveTitle;
  const validation = validateComplexSessionTitle(stored);
  if (validation.ok && validation.value !== null) {
    return validation.value;
  }
  return params.generatedFallback;
}
