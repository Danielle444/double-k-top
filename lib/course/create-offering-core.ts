/**
 * MULTI-COURSE W9A-2 - PURE validation core for creating one PLANNED
 * CourseOffering under an EXISTING ActivityYear.
 *
 * PURE by construction: no Prisma, no DB, no clock, no randomness, no auth, no
 * cookie, no env, no IO. It validates and normalizes the raw server-received
 * FormData values and returns either a normalized value object or a stable,
 * non-PII error code, so the whole input contract is unit-testable without a
 * database (see create-offering-core.test.ts).
 *
 * SCOPE: it validates ONLY the fields needed to create a single CourseOffering
 * row (existing ActivityYear id, name, level, optional dates). It deliberately
 * does NOT decide the offering status (the IO layer hard-codes "PLANNED"), never
 * verifies ActivityYear existence (a DB read done by the IO layer), and never
 * touches capabilities, groups, enrollments or any other record.
 */

/** Stable, non-PII validation error codes (never echo raw input to the client). */
export type CreateOfferingValidationErrorCode =
  | "activity_year_required"
  | "name_required"
  | "level_invalid"
  | "date_invalid"
  | "date_range_invalid";

/**
 * The single offering-name rule, extracted so the rename slice
 * (rename-offering-core.ts) enforces EXACTLY the same normalization as creation
 * instead of duplicating a second, drift-prone copy. The rule is intentionally
 * minimal and mirrors the repository's existing convention for offering names:
 * a name is the trimmed string, required to be non-empty, with NO maximum-length
 * bound (this module has never imposed one - see the create-course-group-core.ts
 * note that entity-name length is otherwise unbounded here). A non-string,
 * absent, empty or whitespace-only value fails as "name_required".
 */
export type OfferingNameErrorCode = "name_required";

export type ValidateOfferingNameResult =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: OfferingNameErrorCode };

export function validateOfferingName(value: unknown): ValidateOfferingNameResult {
  const name = asTrimmedString(value);
  if (name === null || name === "") {
    return { ok: false, error: "name_required" };
  }
  return { ok: true, value: name };
}

/** The normalized, validated creation input the IO layer will persist. */
export interface ValidatedNewOffering {
  readonly activityYearId: string;
  readonly name: string;
  readonly level: number;
  readonly startDate: Date | null;
  readonly endDate: Date | null;
}

/** Raw, untrusted values as received from FormData (each may be a non-string). */
export interface RawNewOfferingInput {
  readonly activityYearId: unknown;
  readonly name: unknown;
  readonly level: unknown;
  readonly startDate: unknown;
  readonly endDate: unknown;
}

/** Discriminated validation result: a normalized value, or a stable error code. */
export type ValidateNewOfferingResult =
  | { readonly ok: true; readonly value: ValidatedNewOffering }
  | { readonly ok: false; readonly error: CreateOfferingValidationErrorCode };

/** Trim a runtime value to a string, or null when it is not a string. */
function asTrimmedString(value: unknown): string | null {
  return typeof value === "string" ? value.trim() : null;
}

/** Level must be a bare positive integer: only digits, no sign, no decimal. */
const LEVEL_PATTERN = /^[0-9]+$/;

function parseLevel(value: unknown): number | null {
  const text = asTrimmedString(value);
  if (text === null || text === "") {
    return null;
  }
  if (!LEVEL_PATTERN.test(text)) {
    return null; // rejects "1.5", "-1", "+1", "1e2", "abc"
  }
  const level = Number(text);
  if (!Number.isInteger(level) || level <= 0) {
    return null;
  }
  return level;
}

/** An optional calendar date accepted only as an exact YYYY-MM-DD string. */
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

type OptionalDateResult =
  | { readonly ok: true; readonly date: Date | null }
  | { readonly ok: false };

/**
 * Parse an optional date. Absent/empty -> null (valid). A present value must be
 * a real YYYY-MM-DD date; anything else (wrong format, non-string, or an
 * impossible calendar date such as 2026-02-30) is a hard validation error. The
 * date is built at UTC midnight so it never drifts across a timezone and the
 * function stays pure (no local clock/zone dependency).
 */
function parseOptionalDate(value: unknown): OptionalDateResult {
  if (value === null || value === undefined) {
    return { ok: true, date: null };
  }
  if (typeof value !== "string") {
    return { ok: false };
  }
  const text = value.trim();
  if (text === "") {
    return { ok: true, date: null };
  }
  const match = DATE_PATTERN.exec(text);
  if (match === null) {
    return { ok: false };
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  // Round-trip check rejects impossible dates (e.g. month 13, day 30 in Feb).
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return { ok: false };
  }
  return { ok: true, date };
}

/**
 * Validate and normalize the raw creation input. Returns a normalized value on
 * success or a stable error code on the FIRST failed rule, in a fixed order:
 * activity year id -> name -> level -> dates -> date range. Never throws, never
 * reflects raw input.
 */
export function validateNewOfferingInput(
  input: RawNewOfferingInput,
): ValidateNewOfferingResult {
  const activityYearId = asTrimmedString(input.activityYearId);
  if (activityYearId === null || activityYearId === "") {
    return { ok: false, error: "activity_year_required" };
  }

  const nameResult = validateOfferingName(input.name);
  if (!nameResult.ok) {
    return { ok: false, error: nameResult.error };
  }
  const name = nameResult.value;

  const level = parseLevel(input.level);
  if (level === null) {
    return { ok: false, error: "level_invalid" };
  }

  const start = parseOptionalDate(input.startDate);
  if (!start.ok) {
    return { ok: false, error: "date_invalid" };
  }
  const end = parseOptionalDate(input.endDate);
  if (!end.ok) {
    return { ok: false, error: "date_invalid" };
  }

  if (start.date !== null && end.date !== null && start.date.getTime() > end.date.getTime()) {
    return { ok: false, error: "date_range_invalid" };
  }

  return {
    ok: true,
    value: {
      activityYearId,
      name,
      level,
      startDate: start.date,
      endDate: end.date,
    },
  };
}
