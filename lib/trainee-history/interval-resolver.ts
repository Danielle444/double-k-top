/**
 * Pure interval-resolution primitives for dated trainee history (Stage GH1A).
 *
 * PURE by construction: no Prisma, no DB access, no next/headers, no clock, no
 * environment access, no logging. This module only reads plain-data interval
 * rows and answers "which row covers this date?".
 *
 * INTERVAL MODEL (locked, GH1A):
 *  - Each row has `effectiveFrom` (inclusive) and `effectiveTo` (EXCLUSIVE).
 *  - `effectiveTo === null` means the row is open-ended.
 *  - Dates are DATE-ONLY `YYYY-MM-DD` keys. There is no time-of-day logic and
 *    NO implicit timezone conversion here; callers provide already-normalized
 *    date-only keys. Comparison is lexicographic, which for zero-padded ISO
 *    date-only strings is exactly chronological — avoiding JS `Date`
 *    local/UTC conversion bugs entirely.
 *  - The value payload is generic (`V`) so the same primitives serve both
 *    TraineeGroupMembership and TraineeHorseAssignment later without hard-coding
 *    any domain field.
 *
 * See COURSE-ARCHITECTURE-HANDOFF.md — GRP-3/GRP-4 (dated membership,
 * close-and-open, non-overlap, one active per enrollment) and TUX-7 horse
 * fields (compatibility-only; long-term offering-scoped history).
 */

/** A normalized date-only key in strict `YYYY-MM-DD` form. */
export type DateKey = string;

/**
 * A single half-open dated interval carrying an arbitrary value payload.
 *
 * `effectiveFrom` is inclusive; `effectiveTo` is exclusive; `effectiveTo`
 * `null` means open-ended. `value` is opaque to these primitives.
 */
export interface IntervalRow<V> {
  id: string;
  effectiveFrom: DateKey;
  effectiveTo: DateKey | null;
  value: V;
}

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Strictly validate that a value is a real `YYYY-MM-DD` calendar date-only key.
 *
 * Rejects malformed strings, out-of-range months/days, and non-strings. Leap
 * years are honoured. Purely structural — no `Date` construction, so no
 * timezone conversion occurs.
 */
export function isValidDateKey(value: unknown): value is DateKey {
  if (typeof value !== "string") {
    return false;
  }
  if (!DATE_KEY_PATTERN.test(value)) {
    return false;
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (month < 1 || month > 12) {
    return false;
  }
  let maxDay = DAYS_IN_MONTH[month - 1];
  if (month === 2 && isLeapYear(year)) {
    maxDay = 29;
  }
  return day >= 1 && day <= maxDay;
}

/**
 * Assert that `value` is a valid {@link DateKey}, throwing a descriptive Error
 * otherwise. Used defensively by primitives that require valid date-only keys.
 */
export function assertValidDateKey(value: unknown, label: string): asserts value is DateKey {
  if (!isValidDateKey(value)) {
    throw new Error(`Invalid date-only key for ${label}: ${JSON.stringify(value)} (expected YYYY-MM-DD)`);
  }
}

/**
 * Compare two valid {@link DateKey}s chronologically.
 *
 * Returns a negative number if `a` is earlier, positive if later, and 0 if
 * equal. Both arguments must be valid date-only keys (asserted). For
 * zero-padded ISO date-only strings, lexicographic order equals chronological
 * order, so no `Date` object (and no timezone conversion) is involved.
 */
export function compareDateKeys(a: DateKey, b: DateKey): number {
  assertValidDateKey(a, "compareDateKeys.a");
  assertValidDateKey(b, "compareDateKeys.b");
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

/**
 * Resolve the interval row covering `date`, or `null` when none does.
 *
 * A row covers `date` iff `effectiveFrom <= date` AND
 * (`effectiveTo === null` OR `date < effectiveTo`). Thus `date === effectiveFrom`
 * belongs to that row, while `date === effectiveTo` does NOT (it belongs to the
 * next row, or is null inside an intentional gap).
 *
 * Never mutates its inputs. Deterministic regardless of input ordering: for
 * well-formed (non-overlapping) input at most one row can match, so the result
 * is independent of array order. Never falls back to a neighbouring row.
 *
 * Throws only if `date` or a row boundary is not a valid date-only key
 * (a programmer error), never for ordinary "no coverage" cases.
 */
export function resolveIntervalAtDate<V>(
  rows: readonly IntervalRow<V>[],
  date: DateKey,
): IntervalRow<V> | null {
  assertValidDateKey(date, "date");
  for (const row of rows) {
    assertValidDateKey(row.effectiveFrom, "effectiveFrom");
    if (row.effectiveTo !== null) {
      assertValidDateKey(row.effectiveTo, "effectiveTo");
    }
    const startsOnOrBeforeDate = compareDateKeys(row.effectiveFrom, date) <= 0;
    const endsAfterDate = row.effectiveTo === null || compareDateKeys(date, row.effectiveTo) < 0;
    if (startsOnOrBeforeDate && endsAfterDate) {
      return row;
    }
  }
  return null;
}
