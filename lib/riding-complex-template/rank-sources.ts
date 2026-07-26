// RC-B0 - day-part-aware previous-source ranking core for the complex-plan
// template workflow.
//
// PURE by construction: the ONLY import is the sibling plain-data `types`
// module. No Prisma, no DB, no next/headers, no auth/session/cookies, no env,
// NO hidden clock (`Date.now()` / argless `new Date()`), no random, no
// `localeCompare`, no locale/timezone. Every answer is derived solely from the
// explicit destination + candidate descriptors passed in.
//
// PURPOSE: from a set of candidate previous slots, return
//  - `recommended`: the single best SAME-day-part, same-offering, same-group,
//    strictly-earlier source (or null), and
//  - `compatible`: every source eligible for MANUAL selection (same offering,
//    same group, strictly earlier, >= 1 block) - INCLUDING other-day-part ones,
//    which are deliberately never auto-recommended.
//
// This encodes the real operational pattern: a morning session recommends the
// closest previous morning session; an afternoon session the closest previous
// afternoon session; the immediately previous CHRONOLOGICAL session is NOT
// auto-selected when its day-part differs (it stays available for manual pick).
//
// CONTRACT (locked):
//  Compatibility (drives `compatible`, and is a precondition for `recommended`):
//   - candidate is well-formed (see isWellFormedCandidate);
//   - candidate.slotId !== destination.slotId;
//   - candidate.resolvedGroup === destination.resolvedGroup  (EXACT equality);
//   - candidate.anchorDateKey < destination.anchorDateKey     (STRICTLY earlier);
//   - candidate.courseOfferingId === destination.courseOfferingId
//       (null matches null ONLY; null is NEVER a level; L1/L2 never mix);
//   - candidate.blockCount >= 1 (enforced inside well-formedness).
//  Ordering: `compatible` is returned best-first and INPUT-ORDER-INDEPENDENT:
//   most-recent anchorDateKey, then latest startTime, then largest slotId - the
//   SAME opaque-string tie-break `select-source.ts` uses (valid zero-padded date
//   keys sort chronologically; startTime/slotId sort lexicographically).
//  Recommendation:
//   - destination.dayPart must be a real day-part ("בוקר" or "אחה\"צ"), never "";
//   - only compatible candidates whose dayPart === destination.dayPart qualify;
//   - among those, the best under the same tie-break wins;
//   - if none qualifies -> `recommended` is null; an other-day-part candidate is
//     never auto-recommended (though it still appears in `compatible`).
//  Safety:
//   - malformed candidates and a malformed destination are handled by EXCLUSION,
//     never by throwing;
//   - inputs are never mutated; output does not depend on input order;
//   - the returned object, its `compatible` array, and every candidate in the
//     result are frozen fresh copies that never alias a caller-owned input.

import type {
  ComplexSourceDayPart,
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
 * A present, well-typed offering reference: a real string, or null for a
 * legacy/unassigned slot. `undefined` (an absent key) is deliberately NOT valid
 * - a candidate whose offering is unknown cannot be proven compatible, so it is
 * treated as malformed rather than silently matching another unknown.
 */
function isOfferingId(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

/** True for any of the three allowed day-part literals ("" included). */
function isDayPart(value: unknown): value is ComplexSourceDayPart {
  return value === "בוקר" || value === "אחה\"צ" || value === "";
}

/** A concrete day-part that may anchor a recommendation - "" never can. */
function isRecommendableDayPart(value: ComplexSourceDayPart): boolean {
  return value === "בוקר" || value === "אחה\"צ";
}

/**
 * True only for a structurally sound candidate: real slotId, valid anchor date,
 * string startTime, non-empty group, integer `blockCount >= 1`, a valid
 * day-part literal, and a present offering reference (string | null). Anything
 * malformed is simply ignored by the ranking core (never throws).
 */
function isWellFormedCandidate(candidate: SourceCandidateDescriptor): boolean {
  return (
    isNonEmptyString(candidate.slotId) &&
    isValidDateKey(candidate.anchorDateKey) &&
    typeof candidate.startTime === "string" &&
    isNonEmptyString(candidate.resolvedGroup) &&
    typeof candidate.blockCount === "number" &&
    Number.isInteger(candidate.blockCount) &&
    candidate.blockCount >= 1 &&
    isDayPart(candidate.dayPart) &&
    isOfferingId(candidate.courseOfferingId)
  );
}

/**
 * Return true if `a` is a strictly better source than `b` under the tie-break
 * order: most recent anchor date, then latest startTime, then largest slotId.
 * All three are compared as opaque strings - the exact convention
 * `select-source.ts` uses.
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

/** Stable best-first comparator built from {@link beats}. */
function compareBestFirst(a: SourceCandidateDescriptor, b: SourceCandidateDescriptor): number {
  if (beats(a, b)) {
    return -1;
  }
  if (beats(b, a)) {
    return 1;
  }
  return 0;
}

/**
 * Return a fresh frozen copy of a well-formed candidate so the result never
 * aliases a caller-owned input object. All fields (including the RC-B0 day-part
 * and offering) are copied; `dayPart`/`courseOfferingId` are guaranteed present
 * here because only well-formed candidates reach this point.
 */
function freezeCandidate(candidate: SourceCandidateDescriptor): SourceCandidateDescriptor {
  return Object.freeze({
    slotId: candidate.slotId,
    anchorDateKey: candidate.anchorDateKey,
    startTime: candidate.startTime,
    resolvedGroup: candidate.resolvedGroup,
    blockCount: candidate.blockCount,
    dayPart: candidate.dayPart,
    courseOfferingId: candidate.courseOfferingId,
  });
}

/** The frozen result of {@link rankSources}. */
export interface RankSourcesResult {
  /** The single best same-day-part source, or null when none qualifies. */
  readonly recommended: SourceCandidateDescriptor | null;
  /** Every manually-selectable source, best-first, input-order-independent. */
  readonly compatible: readonly SourceCandidateDescriptor[];
}

const EMPTY_RESULT: RankSourcesResult = Object.freeze({
  recommended: null,
  compatible: Object.freeze<SourceCandidateDescriptor[]>([]),
});

/**
 * Rank the previous-source candidates for `destination`.
 *
 * Pure, deterministic, input-order-independent, non-mutating. Returns
 * {@link RankSourcesResult}: `compatible` is every same-offering/same-group/
 * strictly-earlier source (best-first), and `recommended` is the best of those
 * whose day-part matches the destination's real day-part (or null). A malformed
 * destination yields an empty result rather than an error.
 */
export function rankSources(
  destination: DestinationSlotDescriptor,
  candidates: readonly SourceCandidateDescriptor[]
): RankSourcesResult {
  // A malformed destination can never anchor selection - fail closed to an
  // empty result rather than throw. courseOfferingId must be present (string |
  // null) so offering equality is well-defined below.
  if (
    !destination ||
    !isNonEmptyString(destination.slotId) ||
    !isValidDateKey(destination.anchorDateKey) ||
    !isNonEmptyString(destination.resolvedGroup) ||
    !isOfferingId(destination.courseOfferingId)
  ) {
    return EMPTY_RESULT;
  }
  if (!Array.isArray(candidates)) {
    return EMPTY_RESULT;
  }

  const compatible: SourceCandidateDescriptor[] = [];
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
    // Same offering only. null === null passes; null vs a real id (either way)
    // fails. null is never coalesced to a level, so L1/L2 never mix.
    if (candidate.courseOfferingId !== destination.courseOfferingId) {
      continue;
    }
    compatible.push(candidate);
  }

  // Deterministic order, independent of input order: best-first
  // (most-recent date -> latest startTime -> largest slotId).
  compatible.sort(compareBestFirst);

  // Recommendation: same-day-part only, and only when the destination itself
  // has a real (non-"") day-part. The list is already best-first, so the first
  // same-day-part entry is the best one.
  let recommended: SourceCandidateDescriptor | null = null;
  const destinationDayPart = isDayPart(destination.dayPart) ? destination.dayPart : "";
  if (isRecommendableDayPart(destinationDayPart)) {
    for (const candidate of compatible) {
      if (candidate.dayPart === destinationDayPart) {
        recommended = candidate;
        break;
      }
    }
  }

  return Object.freeze({
    recommended: recommended === null ? null : freezeCandidate(recommended),
    compatible: Object.freeze(compatible.map(freezeCandidate)),
  });
}
