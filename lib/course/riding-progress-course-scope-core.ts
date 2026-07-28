/**
 * RIDING PROGRESS COURSE SCOPE - SLICE S1: the PURE, DB-free write-time decision
 * core for scoping a StudentRidingProgressFeedback row to exactly one
 * CourseOffering.
 *
 * WHY THIS EXISTS
 * ---------------
 * The trainee riding-progress journal (StudentRidingProgressFeedback) is a
 * standalone per-trainee journal with no course dimension at all: for a trainee
 * enrolled in BOTH a Level 1 and a Level 2 offering, every entry lands in one
 * undifferentiated pile. This core supplies the single decision - "which course
 * does this new entry belong to?" - that both the admin writer and the
 * instructor writer will consume, so the two can never drift into two different
 * answers for the same trainee.
 *
 * PURE BY CONSTRUCTION: no Prisma, no DB, no clock, no randomness, no env, no
 * session/cookie/header read. It receives the SUBJECT trainee's already-fetched
 * enrollment rows and returns a decision. The whole contract is unit-testable
 * without a database (see riding-progress-course-scope-core.test.ts).
 *
 * THE SUBJECT IS THE TRAINEE, NOT THE ACTOR
 * -----------------------------------------
 * The rows passed in are the rows of the trainee the feedback is ABOUT, never
 * of the admin/instructor writing it. Course eligibility is therefore a property
 * of the subject alone: no actor - however they authenticated, and whatever they
 * claim - can widen the set of courses an entry may be filed under. That is what
 * makes this core's guarantee independent of the separately-tracked
 * client-supplied-instructor-identity weakness in the instructor writer.
 *
 * NOTHING IS EVER INFERRED
 * ------------------------
 * This module is deliberately incapable of deriving a course any other way: it
 * accepts no date, no group, no subgroup, no topic/title, no offering name, no
 * level constant, no cookie and no offering id constant of its own. There is no
 * fallback of ANY kind - no "first row" pick, no isPrimary tie-break (that is
 * not a database-enforced invariant - see the CourseEnrollment model comment),
 * no level-1 default. An undecidable case REFUSES; it never guesses.
 *
 * COURSE IS IMMUTABLE AFTER CREATION (locked product decision)
 * -----------------------------------------------------------
 * There is exactly ONE resolver here and it is named for the create path:
 * {@link resolveRidingProgressCourseOfferingIdForCreate}. The ABSENCE of an
 * update/re-file resolver is the contract, not an omission - the update writers
 * must not accept, clear or change a row's course, so an omitted field can never
 * null out or silently re-scope a correctly-filed row, and a legacy unscoped row
 * can never be silently claimed for a course by being edited. A mis-filed entry
 * is deleted and recreated by an admin. The test file asserts this absence.
 *
 * UNWIRED IN THIS SLICE: no schema column, no migration, no action, no component
 * and no script imports this module yet.
 */
import { eligibleTraineeOfferingsFromRows } from "./trainee-course-selection-core";
import type { TraineeEnrollmentOfferingRow } from "./actor-course-offering-core";
import type { CourseOfferingRow } from "./current-offering-core";

/**
 * One selectable course as it is offered to the admin/instructor writing the
 * entry. `id` is the stable primary key the client sends back; `label` is
 * composed on the server from the DB-backed level and name.
 *
 * There is deliberately no selected/default/isCurrent marker: appearing here
 * means only "this entry MAY be filed under this course". A client's pick is
 * re-validated against this same eligible set on submit (see
 * {@link resolveRidingProgressCourseOfferingIdForCreate}), so the menu itself
 * authorizes nothing.
 */
export interface RidingProgressCourseOption {
  readonly id: string;
  readonly level: number;
  readonly label: string;
}

/**
 * What the write surface must do, given the subject trainee's eligible courses.
 *
 * A discriminated union rather than a nullable option so every consumer is
 * forced to handle all three states explicitly - in particular "none", which
 * must BLOCK the save rather than fall through to an unscoped write.
 */
export type RidingProgressCourseChoice =
  /** No eligible course at all - creation must be blocked. */
  | { readonly kind: "none" }
  /** Exactly one eligible course - selected server-side, no picker is shown. */
  | { readonly kind: "auto"; readonly option: RidingProgressCourseOption }
  /** Two or more - the writer must state which one; the server never picks. */
  | { readonly kind: "choose"; readonly options: readonly RidingProgressCourseOption[] };

/** Why a create was refused. */
export type RidingProgressCourseRefusalReason =
  /** The subject trainee has no ACTIVE enrollment into an ACTIVE offering. */
  | "NO_ELIGIBLE_COURSE"
  /** Two or more eligible courses and the writer stated none of them. */
  | "COURSE_CHOICE_REQUIRED"
  /** A course was stated, but it is not one of the subject's eligible courses. */
  | "COURSE_NOT_ELIGIBLE";

/**
 * The Hebrew message per refusal reason, owned here so the admin writer and the
 * instructor writer cannot report the same refusal in two different wordings.
 *
 * DELIBERATELY DISTINGUISHABLE, unlike the trainee-facing course-context
 * resolvers - which collapse every denial into one indistinguishable outcome so
 * a trainee cannot probe which offerings exist. Here the reader is an admin or
 * an instructor who already holds trainee-progress access and is already being
 * shown this trainee's course list in the picker, so a specific reason leaks
 * nothing they cannot already see and is the difference between a fixable error
 * and a mysterious one.
 */
export const RIDING_PROGRESS_COURSE_REFUSAL_MESSAGES: Readonly<
  Record<RidingProgressCourseRefusalReason, string>
> = {
  NO_ELIGIBLE_COURSE: "לא נמצא קורס פעיל לחניך/ה זה/זו - לא ניתן להזין משוב רכיבה",
  COURSE_CHOICE_REQUIRED: "יש לבחור קורס עבור משוב הרכיבה",
  COURSE_NOT_ELIGIBLE: "הקורס שנבחר אינו זמין לחניך/ה זה/זו",
};

/** The outcome of validating a create. */
export type RidingProgressCourseResolution =
  | { readonly ok: true; readonly courseOfferingId: string }
  | { readonly ok: false; readonly reason: RidingProgressCourseRefusalReason };

/**
 * Compose the picker label from the DB-backed level and name. A blank name
 * yields the level alone rather than a dangling separator.
 *
 * Deliberately NOT shared with the trainee menu's label composer or the
 * instructor menu's: this repo keeps each audience's menu wording as its own
 * contract, free to diverge. It is also deliberately RICHER than the per-row
 * course badge on the journal itself (which is the compact "רמה N"): a picker
 * has to disambiguate between two concrete courses at the moment of choosing,
 * whereas a badge only has to attribute an already-filed row.
 *
 * Presentation only - nothing may ever parse a label back into a course
 * identity.
 */
export function composeRidingProgressCourseOptionLabel(level: number, name: string): string {
  const trimmed = typeof name === "string" ? name.trim() : "";
  return trimmed.length === 0 ? `רמה ${level}` : `רמה ${level} · ${trimmed}`;
}

function toOption(offering: CourseOfferingRow): RidingProgressCourseOption {
  return {
    id: offering.id,
    level: offering.level,
    label: composeRidingProgressCourseOptionLabel(offering.level, offering.name),
  };
}

/**
 * The subject trainee's eligible courses, as options.
 *
 * Eligibility is NOT redefined here: it delegates to the committed
 * eligibleTraineeOfferingsFromRows, which is the single definition already
 * shared by the trainee course menu and the trainee course selection decision.
 * Reusing it means a change to what "eligible" means can never apply to some
 * course-scoped surfaces and not others. It yields, in one pass:
 *   - ACTIVE CourseEnrollment AND ACTIVE CourseOffering only (so an INACTIVE
 *     enrollment, and a PLANNED or ARCHIVED offering, are never options);
 *   - DISTINCT offerings - two enrollments into one offering is one course;
 *   - a deterministic order (level ascending, then offering id ascending) that
 *     does not depend on the input row order or on sort stability.
 *
 * Dates are deliberately NOT part of eligibility: entering an entry for an
 * earlier date is a normal, expected use, and filtering the choices by the
 * feedback date would be exactly the date-derived course inference this feature
 * exists to eliminate.
 */
export function buildRidingProgressCourseOptions(
  rows: readonly TraineeEnrollmentOfferingRow[],
): RidingProgressCourseOption[] {
  return eligibleTraineeOfferingsFromRows(rows).map(toOption);
}

/**
 * Decide what the write surface must do for this subject trainee.
 *
 * Never throws: "none" is a legitimate fail-closed outcome that the caller
 * renders as a blocked save, not something this core should paper over.
 */
export function buildRidingProgressCourseChoice(
  rows: readonly TraineeEnrollmentOfferingRow[],
): RidingProgressCourseChoice {
  const options = buildRidingProgressCourseOptions(rows);
  if (options.length === 0) return { kind: "none" };
  if (options.length === 1) return { kind: "auto", option: options[0] };
  return { kind: "choose", options };
}

/**
 * Did the caller STATE a course, or omit one?
 *
 * ONLY `undefined` and `null` count as omitted - that is the path on which a
 * single-course trainee is auto-scoped server-side. ANY other value (including
 * "", a whitespace string, a number or an object arriving from an untyped
 * client) counts as STATED and must therefore match an eligible course by exact
 * equality or be refused. A malformed request is never quietly downgraded into
 * "they didn't ask", because that would let a bad value resolve to a course.
 *
 * Same rule as the committed trainee selection core, restated here rather than
 * imported: it is private there, and this core must keep its own copy under
 * test.
 */
function isCourseStated(requested: unknown): boolean {
  return requested !== undefined && requested !== null;
}

/**
 * Validate a CREATE and return the course offering id to store.
 *
 * Order is deliberate and fail-closed at every step:
 *  1. reduce the subject's rows to their eligible, distinct courses;
 *  2. none eligible -> refuse NO_ELIGIBLE_COURSE (never write unscoped);
 *  3. no course STATED:
 *       - exactly one eligible -> that course, selected server-side;
 *       - two or more         -> refuse COURSE_CHOICE_REQUIRED. The server
 *                                never picks for the writer.
 *  4. a course STATED: keep it ONLY if it exactly equals an eligible course's id
 *     (no trimming, no case folding, no prefix matching). No match -> refuse
 *     COURSE_NOT_ELIGIBLE, and NO other course is ever substituted.
 *
 * THE STATED ID IS A REQUEST, NEVER AN AUTHORITY. It is used only as an
 * equality PREDICATE against courses the subject trainee already resolved to;
 * it is never a lookup key and never reaches a query (the caller's fetch is
 * scoped by studentId alone). The value returned is the MATCHED OPTION'S id -
 * the server's own copy - so a request can only ever SELECT FROM an
 * already-eligible set, never widen it, and can never pass through unmatched.
 */
export function resolveRidingProgressCourseOfferingIdForCreate(
  requestedCourseOfferingId: string | null | undefined,
  rows: readonly TraineeEnrollmentOfferingRow[],
): RidingProgressCourseResolution {
  const options = buildRidingProgressCourseOptions(rows);

  if (options.length === 0) {
    return { ok: false, reason: "NO_ELIGIBLE_COURSE" };
  }

  if (!isCourseStated(requestedCourseOfferingId)) {
    if (options.length > 1) {
      return { ok: false, reason: "COURSE_CHOICE_REQUIRED" };
    }
    return { ok: true, courseOfferingId: options[0].id };
  }

  const matched = options.find((option) => option.id === requestedCourseOfferingId);
  if (matched === undefined) {
    return { ok: false, reason: "COURSE_NOT_ELIGIBLE" };
  }
  return { ok: true, courseOfferingId: matched.id };
}

/** The Hebrew message for a refused create, for the writers' ActionResult.error. */
export function ridingProgressCourseRefusalMessage(
  reason: RidingProgressCourseRefusalReason,
): string {
  return RIDING_PROGRESS_COURSE_REFUSAL_MESSAGES[reason];
}
