// Fix 3, Stage 1 - previous-source selector for the dormant complex-plan
// template core.
//
// PURE by construction: the ONLY import is the sibling plain-data `types`
// module. No Prisma, no DB, no next/headers, no auth/session/cookies, no env,
// NO hidden clock, no random, no `localeCompare`, no timezone. The answer is
// derived solely from the explicit destination + candidate descriptors.
//
// PURPOSE: from a set of candidate previous slots (same group, all strictly
// earlier), pick the single best template source, or null when none qualifies.
// This encodes product decision B (a source is eligible when it has at least
// one block) and the "previous session" selection - deliberately WITHOUT any
// weekday inference and WITHOUT a lookback-day limit.
//
// CONTRACT (locked):
//  - Exclude the destination slot itself (same slotId).
//  - Same group only, by EXACT non-null string equality.
//  - The source date must be STRICTLY earlier than the destination date;
//    same-day and future candidates are excluded.
//  - `blockCount >= 1` is required (an integer >= 1).
//  - Published/unpublished state is NOT part of the input by design.
//  - Among the survivors: choose the most recent date; break ties by the
//    latest start time; break remaining ties by the largest slotId.
//  - Malformed candidates are ignored (never throw).
//  - Returns null when nothing qualifies.
//  - Input order does not affect the result; inputs are never mutated.

import type {
  DestinationSlotDescriptor,
  SourceCandidateDescriptor,
} from "./types";

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Strict `YYYY-MM-DD` calendar validity - purely structural, no `Date`. */
function isValidDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_KEY_PATTERN.test(value)) {
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * True only for a structurally sound candidate: real slotId, valid anchor date,
 * string startTime, non-empty group, and an integer `blockCount >= 1`. Anything
 * malformed is simply ignored by the selector (never throws).
 */
function isWellFormedCandidate(candidate: SourceCandidateDescriptor): boolean {
  return (
    isNonEmptyString(candidate.slotId) &&
    isValidDateKey(candidate.anchorDateKey) &&
    typeof candidate.startTime === "string" &&
    isNonEmptyString(candidate.resolvedGroup) &&
    typeof candidate.blockCount === "number" &&
    Number.isInteger(candidate.blockCount) &&
    candidate.blockCount >= 1
  );
}

/**
 * Return true if `a` is a strictly better source than `b` under the tie-break
 * order: most recent anchor date, then latest startTime, then largest slotId.
 * All three are compared as opaque strings (valid date keys sort
 * chronologically; startTime/slotId sort lexicographically).
 */
function beats(a: SourceCandidateDescriptor, b: SourceCandidateDescriptor): boolean {
  if (a.anchorDateKey !== b.anchorDateKey) {
    return a.anchorDateKey > b.anchorDateKey;
  }
  if (a.startTime !== b.startTime) {
    return a.startTime > b.startTime;
  }
  return a.slotId > b.slotId;
}

/**
 * Select the best previous-plan source for `destination`, or null if none
 * qualifies. Pure, deterministic, input-order-independent, non-mutating.
 */
export function selectPreviousSource(
  destination: DestinationSlotDescriptor,
  candidates: readonly SourceCandidateDescriptor[]
): SourceCandidateDescriptor | null {
  // A malformed destination can never anchor a selection - fail closed to null
  // rather than throw.
  if (
    !destination ||
    !isNonEmptyString(destination.slotId) ||
    !isValidDateKey(destination.anchorDateKey) ||
    !isNonEmptyString(destination.resolvedGroup)
  ) {
    return null;
  }
  if (!Array.isArray(candidates)) {
    return null;
  }

  let best: SourceCandidateDescriptor | null = null;
  for (const candidate of candidates) {
    if (!candidate || !isWellFormedCandidate(candidate)) {
      continue;
    }
    // Never select the destination slot itself.
    if (candidate.slotId === destination.slotId) {
      continue;
    }
    // Same group only, exact string equality.
    if (candidate.resolvedGroup !== destination.resolvedGroup) {
      continue;
    }
    // Strictly earlier date only - same-day and future are excluded.
    if (!(candidate.anchorDateKey < destination.anchorDateKey)) {
      continue;
    }
    if (best === null || beats(candidate, best)) {
      best = candidate;
    }
  }

  if (best === null) {
    return null;
  }
  // Return a fresh frozen copy so the result never aliases a caller-owned
  // input object.
  return Object.freeze({
    slotId: best.slotId,
    anchorDateKey: best.anchorDateKey,
    startTime: best.startTime,
    resolvedGroup: best.resolvedGroup,
    blockCount: best.blockCount,
  });
}
