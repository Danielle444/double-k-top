/**
 * EXAM X0 — PURE time-overlap core for exam sessions / day events.
 *
 * PURE by construction: no Prisma, no DB, no clock, no randomness, no env, no
 * IO. It NEVER reads the wall clock — every time value is supplied by the caller
 * as a plain `YYYY-MM-DD` date and `HH:MM` start/end. Deterministic; never
 * mutates its inputs.
 *
 * WHAT THIS ANSWERS (and only this): do two exam time intervals overlap?
 *  - overlap requires the SAME date;
 *  - overlap is STRICT interval overlap: `aStart < bEnd && bStart < aEnd`;
 *  - touching boundaries (a ends exactly when b starts) are NOT overlap;
 *  - any malformed input fails closed to "no overlap".
 *
 * It does NOT classify conflicts (exam-conflict-core) and knows nothing about
 * participants, horses, arenas, or publication.
 *
 * The `date` is treated as an OPAQUE calendar-day token compared by string
 * equality: this core does no timezone math and no calendar arithmetic, so it
 * introduces no clock dependency. Two intervals on different date tokens never
 * overlap here regardless of their clock times.
 */

/** A single exam time interval on one calendar day. */
export interface ExamTimeInterval {
  /** Opaque calendar day, expected `YYYY-MM-DD`. Compared by equality. */
  readonly date: string;
  /** Start clock time `HH:MM` (inclusive). */
  readonly start: string;
  /** End clock time `HH:MM` (exclusive). */
  readonly end: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** True iff `value` is a well-formed `HH:MM` (00:00–23:59). */
export function isValidHHMM(value: unknown): value is string {
  return typeof value === "string" && TIME_RE.test(value);
}

/**
 * Parse `HH:MM` to minutes since midnight, or `null` when malformed. Pure; uses
 * no `Date`. Rejects anything outside 00:00–23:59 and any non-string.
 */
export function parseHHMM(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = TIME_RE.exec(value);
  if (m === null) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * True iff the interval is structurally valid: a `YYYY-MM-DD` date, valid
 * `HH:MM` start and end, and a strictly positive duration (`start < end`). A
 * zero-length or inverted interval is not a valid schedulable interval.
 */
export function isValidExamTimeInterval(interval: ExamTimeInterval): boolean {
  if (typeof interval.date !== "string" || !DATE_RE.test(interval.date)) return false;
  const start = parseHHMM(interval.start);
  const end = parseHHMM(interval.end);
  if (start === null || end === null) return false;
  return start < end;
}

/**
 * Strict interval overlap between two exam intervals.
 *
 * Returns `true` iff both intervals are valid, fall on the SAME date, and their
 * clock ranges strictly overlap (`aStart < bEnd && bStart < aEnd`). Touching
 * boundaries are NOT overlap. Different dates are NOT overlap. Any malformed
 * input fails closed to `false`. Never mutates inputs; order-independent.
 */
export function intervalsOverlap(a: ExamTimeInterval, b: ExamTimeInterval): boolean {
  if (!isValidExamTimeInterval(a) || !isValidExamTimeInterval(b)) return false;
  if (a.date !== b.date) return false;

  const aStart = parseHHMM(a.start) as number;
  const aEnd = parseHHMM(a.end) as number;
  const bStart = parseHHMM(b.start) as number;
  const bEnd = parseHHMM(b.end) as number;

  return aStart < bEnd && bStart < aEnd;
}
