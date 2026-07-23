/**
 * MULTI-COURSE W9A-4 - PURE validation core for creating one NUMBERED subgroup
 * CourseGroup under an existing top-level group of an explicitly scoped
 * CourseOffering.
 *
 * PURE by construction: no Prisma, no DB, no clock, no randomness, no auth, no
 * cookie, no env, no IO. It validates and normalizes the single raw
 * server-received subgroup-number value and returns either a normalized value
 * object or a stable, non-PII error code, so the whole input contract is
 * unit-testable without a database (see create-course-subgroup-core.test.ts).
 *
 * COMPATIBILITY CONSTRAINT (not a new product rule): subgroups are NUMBERED
 * groups. Trainee creation resolves a subgroup with String(positiveInteger)
 * (lib/course/create-trainee-enrollment-core.ts) and the roster reader accepts
 * ONLY a canonical positive-integer subgroup name (lib/course/enrollment-view.ts
 * parseSubgroupName, /^[1-9][0-9]*$/). An arbitrary-text subgroup would be
 * unassignable and would surface roster anomalies. Therefore the admin enters a
 * positive integer and the STORED CourseGroup.name is its canonical decimal
 * string, e.g. "1", "2", "12".
 *
 * NUMERIC SAFETY: normalization does NOT use String(Number(raw)) - that can lose
 * precision or emit scientific notation for very large digit strings. Instead the
 * value must be an ASCII decimal-digit string that parses to a SAFE, positive
 * integer (Number.isSafeInteger), and the canonical name is String(parsed). A
 * safe positive integer always prints as plain decimal digits, never Infinity,
 * NaN, scientific notation, or an imprecise integer.
 *
 * SCOPE: it validates ONLY the subgroup number. It never decides the offering,
 * the parent (resolved by the IO layer via a compound offering-scoped top-level
 * lookup, never derived from input), the status gate, or uniqueness (a DB
 * concern).
 */

/** Stable, non-PII validation error code (never echo raw input to the client). */
export type CreateCourseSubgroupValidationErrorCode = "subgroup_invalid";

/** The normalized, validated subgroup name the IO layer will persist. */
export interface ValidatedNewCourseSubgroup {
  /** Canonical positive-integer decimal string, e.g. "1", "2", "12". */
  readonly name: string;
}

/** Raw, untrusted value as received from FormData (may be a non-string). */
export interface RawNewCourseSubgroupInput {
  readonly subgroupNumber: unknown;
}

/** Discriminated validation result: a normalized value, or a stable error code. */
export type ValidateNewCourseSubgroupResult =
  | { readonly ok: true; readonly value: ValidatedNewCourseSubgroup }
  | { readonly ok: false; readonly error: CreateCourseSubgroupValidationErrorCode };

/**
 * Validate and normalize the raw subgroup-number input. Returns the canonical
 * decimal string on success or "subgroup_invalid" otherwise. Never throws, never
 * reflects raw input.
 *
 * Contract (fixed order):
 *   1. require a string input (a non-string -> subgroup_invalid);
 *   2. trim it;
 *   3. require ASCII decimal digits only (/^[0-9]+$/) - rejects blank, sign,
 *      decimal point, scientific notation, and any non-digit;
 *   4. parse as a number;
 *   5. require Number.isSafeInteger(parsed) - rejects values above
 *      Number.MAX_SAFE_INTEGER, which cannot be stored precisely;
 *   6. require parsed > 0 - rejects "0", "000", etc.;
 *   7. return String(parsed) - the canonical decimal string, which normalizes
 *      leading zeros ("01" -> "1", "00012" -> "12").
 */
export function validateNewCourseSubgroupInput(
  input: RawNewCourseSubgroupInput,
): ValidateNewCourseSubgroupResult {
  const raw = input.subgroupNumber;
  if (typeof raw !== "string") {
    return { ok: false, error: "subgroup_invalid" };
  }
  const trimmed = raw.trim();
  if (!/^[0-9]+$/.test(trimmed)) {
    return { ok: false, error: "subgroup_invalid" };
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return { ok: false, error: "subgroup_invalid" };
  }
  return { ok: true, value: { name: String(parsed) } };
}
