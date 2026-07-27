/**
 * COMBINED PARTICIPATION - SLICE IUS-3: the PURE label helper for the INSTRUCTOR
 * card's "משולב" badge.
 *
 * PURE by construction: no React, no Prisma, no DB, no clock, no randomness, no
 * env, no cookies, no server-action import. It maps two already-known values to
 * a string or null, so the whole wording contract is unit-testable without a
 * database or a renderer (see instructor-combined-participation-badge-core.test.ts).
 *
 * DISPLAY-ONLY - THE HARD RULE
 * ----------------------------
 * This helper produces a LABEL and nothing else. It never filters, hides,
 * reorders or removes a schedule item; it never writes, normalises or changes
 * the stored ScheduleItem.combinedParticipation value; and no caller may branch
 * on its result for anything but rendering a pill. An item whose badge is null
 * is still fully visible - null means "render no badge", never "hide the card".
 *
 * courseLevel MUST BE SERVER-RESOLVED
 * -----------------------------------
 * `courseLevel` is the DB-backed CourseOffering.level of the offering the item
 * was actually read from - `InstructorScheduleResult.courseLevel` for the
 * per-course view, `sourceCourseLevel` for a unified item. It must NEVER be
 * inferred from a course name, an offering id constant, an item title, a week
 * name, a date window, or any other free text: those are all editable content
 * and would silently re-point the rule at the wrong course. Any level other
 * than 2 - including the fail-closed 0 that a denial reports - yields no badge.
 *
 * NOT TRAINEE VISIBILITY LOGIC
 * ----------------------------
 * This is a small instructor-specific PRESENTATION helper. It deliberately does
 * NOT import ./combined-participation-visibility-core, whose own header states
 * that instructor readers must never call it: that core decides which items a
 * DUAL-ENROLLED TRAINEE may see (hiding `false` items behind a placeholder),
 * which is a completely different concern from labelling a block for staff.
 * Sharing the two would let a trainee visibility change silently alter what
 * instructors see, and vice versa. The wording below is intentionally the same
 * as the trainee card's so the two audiences read one vocabulary, but it is an
 * independent copy by design.
 */

/**
 * The single course level whose blocks carry this badge. A LEVEL number backed
 * by CourseOffering.level - deliberately NOT an offering id, so no data
 * reshuffle can re-point the rule, and no hardcoded cuid lives here.
 */
export const INSTRUCTOR_COMBINED_PARTICIPATION_BADGE_LEVEL = 2;

/** The session runs WITH combined participation. Matches the trainee card verbatim. */
export const INSTRUCTOR_COMBINED_PARTICIPATION_WITH_LABEL = "עם משולב";

/** The session runs WITHOUT combined participation. Matches the trainee card verbatim. */
export const INSTRUCTOR_COMBINED_PARTICIPATION_WITHOUT_LABEL = "ללא משולב";

/**
 * The badge label for one instructor schedule block, or null for no badge.
 *
 * Exhaustive, total and deterministic - the same inputs always yield the same
 * output, nothing is mutated, and no ordinary numeric level throws:
 *
 *  - courseLevel !== 2      -> null. Level 1 blocks are unchanged, and an
 *    unknown level (0 from a denial's fail-closed result, or any future level)
 *    fails CLOSED rather than opting into Level-2-only presentation.
 *  - value === null         -> null. "Not stated" is not a third business
 *    state: it is fail-open for combined trainees, and inventing wording for it
 *    would assert something the data does not say. Exactly the trainee card's
 *    behaviour.
 *  - value === true         -> "עם משולב"
 *  - value === false        -> "ללא משולב"
 *
 * The level is checked FIRST, so a Level 1 block can never render a badge no
 * matter what its stored tri-state happens to hold.
 */
export function instructorCombinedParticipationBadgeLabel(
  courseLevel: number,
  value: boolean | null,
): string | null {
  if (courseLevel !== INSTRUCTOR_COMBINED_PARTICIPATION_BADGE_LEVEL) return null;
  if (value === null) return null;
  return value
    ? INSTRUCTOR_COMBINED_PARTICIPATION_WITH_LABEL
    : INSTRUCTOR_COMBINED_PARTICIPATION_WITHOUT_LABEL;
}
