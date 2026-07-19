// Pure, dependency-free decision for the small numeric Teaching Practice
// rating badge shown beside a beginner trainee. Deliberately has NO imports at
// all - no React, Next, Prisma, auth, env, clock, random, cookies, or server
// actions - so it can be unit-tested in isolation and reused by the
// presentational badge in TeachingPracticeManager.tsx without dragging any of
// that in. It intentionally does NOT import any riding-domain types; it works
// only from the minimum plain values passed in.
//
// Defense-in-depth only: the server already redacts a participant's whole
// feedback view for unauthorized callers (see
// applyTeachingPracticeFeedbackVisibility), so an unauthorized caller never
// even receives a ratingHalfPoints to feed in here. This gate independently
// refuses to render a badge unless the client also agrees it is permitted -
// the server redaction remains authoritative.
//
// Fail closed by construction: `visible` is true only for an
// explicitly-permitted role, an exact beginner practice type, and a valid
// in-range integer rating. Every other input (LUNGE, unknown type, unknown
// role, missing permission, null/NaN/out-of-range/non-integer rating) hides
// the badge. Deterministic and non-mutating: the same input always yields an
// equal decision and no argument is ever written to.

export type TeachingPracticeRatingBadgeRole = "admin" | "instructor" | "unknown";

export interface TeachingPracticeRatingBadgeInput {
  // The viewer's role. Only "admin" and "instructor" can ever be permitted;
  // "unknown" (or any unexpected runtime value) always fails closed.
  role: TeachingPracticeRatingBadgeRole;
  // The instructor feedback-edit capability. Only the exact boolean `true`
  // grants an instructor visibility - see isPermittedRole.
  canEditTeachingPracticeFeedback: boolean;
  // The row's actual lesson practice type. Only the two beginner types get a
  // badge; LUNGE and anything else never do. Kept as a plain string so this
  // core does not depend on the teaching-practice enum type.
  practiceType: string;
  // The stored rating in half-points (2..10 == 1.0..5.0), or null/absent.
  ratingHalfPoints: number | null | undefined;
}

export interface TeachingPracticeRatingBadgeDecision {
  readonly visible: boolean;
  // The value to render (e.g. "3", "3.5", "4", "4.5") when visible; null when
  // hidden. This is the rating value only - never an id or free-text feedback.
  readonly displayValue: string | null;
}

// Single shared frozen "no badge" result - returned for every hidden case so
// no caller can accidentally mutate a per-call object into a visible one.
const HIDDEN: TeachingPracticeRatingBadgeDecision = Object.freeze({
  visible: false,
  displayValue: null,
});

// Exactly the two beginner practice types are eligible. LUNGE and any unknown
// type are absent, so they hide the badge.
const BADGE_PRACTICE_TYPES: ReadonlySet<string> = new Set(["BEGINNER_PRIVATE", "BEGINNER_GROUP"]);

// 1.0-5.0 in 0.5 steps stored as ratingHalfPoints 2-10 - same convention as
// FEEDBACK_RATING_OPTIONS / RidingLessonNote.ratingHalfPoints. Anything outside
// this integer range (null, undefined, NaN, 1, 11, 4.5, "8", ...) is invalid.
const MIN_RATING_HALF_POINTS = 2;
const MAX_RATING_HALF_POINTS = 10;

function isPermittedRole(role: TeachingPracticeRatingBadgeRole, canEditTeachingPracticeFeedback: boolean): boolean {
  if (role === "admin") return true;
  // Strict identity - only the exact boolean `true` reveals it for an
  // instructor; false / undefined / null / any other runtime value fails
  // closed. An unknown/missing role never reaches here as permitted.
  if (role === "instructor") return canEditTeachingPracticeFeedback === true;
  return false;
}

function isValidRatingHalfPoints(ratingHalfPoints: number | null | undefined): ratingHalfPoints is number {
  return (
    typeof ratingHalfPoints === "number" &&
    Number.isInteger(ratingHalfPoints) &&
    ratingHalfPoints >= MIN_RATING_HALF_POINTS &&
    ratingHalfPoints <= MAX_RATING_HALF_POINTS
  );
}

export function decideTeachingPracticeRatingBadge(
  input: TeachingPracticeRatingBadgeInput
): TeachingPracticeRatingBadgeDecision {
  if (!isPermittedRole(input.role, input.canEditTeachingPracticeFeedback)) return HIDDEN;
  if (!BADGE_PRACTICE_TYPES.has(input.practiceType)) return HIDDEN;
  if (!isValidRatingHalfPoints(input.ratingHalfPoints)) return HIDDEN;
  return Object.freeze({
    visible: true,
    // Half-points -> display value: 8 -> "4", 9 -> "4.5". Number#toString
    // renders whole and half values exactly as "4" / "4.5".
    displayValue: String(input.ratingHalfPoints / 2),
  });
}
