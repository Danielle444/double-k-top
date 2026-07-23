/**
 * MULTI-COURSE W9A-3 - PURE validation core for creating one TOP-LEVEL
 * CourseGroup under an explicitly scoped CourseOffering.
 *
 * PURE by construction: no Prisma, no DB, no clock, no randomness, no auth, no
 * cookie, no env, no IO. It validates and normalizes the single raw
 * server-received group-name value and returns either a normalized value object
 * or a stable, non-PII error code, so the whole input contract is unit-testable
 * without a database (see create-course-group-core.test.ts).
 *
 * SCOPE: it validates ONLY the group name. It never decides the offering, the
 * parent (top-level groups always have parentGroupId=null - decided by the IO
 * layer, never derived from input), the status gate, or uniqueness (a DB
 * concern). Group names are FREE TEXT: "א"/"ב" and any other name are accepted
 * equally; there is NO A/B preset and no name is special-cased here.
 */

/**
 * Maximum accepted group-name length (trimmed, in JS string length units).
 *
 * Bound rationale: the repository has NO existing string-length convention for
 * entity names (e.g. CourseOffering.name in create-offering-core.ts is bounded
 * only by non-emptiness). Rather than introduce a broad validation framework,
 * this slice adds the smallest local rule: a single generous upper bound of 100
 * characters. It comfortably fits short names ("א", "ב") and descriptive labels
 * while rejecting unbounded/abusive input. This is a documented local choice,
 * not a global product rule.
 */
export const MAX_GROUP_NAME_LENGTH = 100;

/** Stable, non-PII validation error codes (never echo raw input to the client). */
export type CreateCourseGroupValidationErrorCode = "name_required" | "name_too_long";

/** The normalized, validated group name the IO layer will persist. */
export interface ValidatedNewCourseGroup {
  readonly name: string;
}

/** Raw, untrusted value as received from FormData (may be a non-string). */
export interface RawNewCourseGroupInput {
  readonly name: unknown;
}

/** Discriminated validation result: a normalized value, or a stable error code. */
export type ValidateNewCourseGroupResult =
  | { readonly ok: true; readonly value: ValidatedNewCourseGroup }
  | { readonly ok: false; readonly error: CreateCourseGroupValidationErrorCode };

/**
 * Validate and normalize the raw group-name input. Returns a normalized value on
 * success or a stable error code on the FIRST failed rule, in a fixed order:
 * present-and-non-empty -> length. Never throws, never reflects raw input.
 *
 *   - a non-string, absent, empty or whitespace-only name -> "name_required";
 *   - a trimmed name longer than MAX_GROUP_NAME_LENGTH -> "name_too_long";
 *   - otherwise the trimmed name is returned verbatim (free text, no A/B preset).
 */
export function validateNewCourseGroupInput(
  input: RawNewCourseGroupInput,
): ValidateNewCourseGroupResult {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (name === "") {
    return { ok: false, error: "name_required" };
  }
  if (name.length > MAX_GROUP_NAME_LENGTH) {
    return { ok: false, error: "name_too_long" };
  }
  return { ok: true, value: { name } };
}
