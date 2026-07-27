/**
 * IUS-2E: PURE decision core for the instructor per-course schedule surfaces'
 * AUTOMATIC default CourseOffering selection.
 *
 * PURE by construction: no Prisma, no DB, no React, no clock, no randomness, no
 * env, no auth/session/cookie read, and no import of the temporary compatibility
 * module. It only picks one id out of an already-fetched, already-authorized,
 * server-composed option list - so the whole contract is unit-testable without a
 * database (see instructor-default-schedule-offering-core.test.ts).
 *
 * WHAT THIS IS - AND IS NOT
 * -------------------------
 * This picks a DEFAULT SELECTION, not an authorization. The option list it
 * consumes is the server-composed menu from listInstructorContactCourseOptions,
 * whose own core states plainly that appearing in it grants nothing: every later
 * schedule read independently re-validates the chosen id server-side (identity ->
 * resolveInstructorCourseOffering against the allow-list -> SCHEDULE=ENABLED ->
 * an offering-scoped query). Pre-selecting an option therefore only decides which
 * id is REQUESTED FIRST; it can never widen what an instructor may see.
 *
 * HARD RULES BAKED IN HERE
 * ------------------------
 *  - LEVEL COMES FROM THE SERVER. The Level 1 test is `option.level === 1` on the
 *    DB-backed CourseOffering.level the menu already carries. Nothing here reads,
 *    parses or pattern-matches a label, a course name, a status, a date window or
 *    an id prefix to decide what "Level 1" means.
 *  - NO ID IS EVER MANUFACTURED. Every returned value is an id that was present in
 *    the input list. There is no hardcoded offering id in this module.
 *  - TOTALLY DETERMINISTIC. When more than one candidate qualifies, the LOWEST id
 *    wins (string comparison on a unique primary key), so the result is identical
 *    under any input ordering and independent of sort stability. This mirrors the
 *    id tie-break the menu's own comparator already uses
 *    (compareInstructorCourseOptions in instructor-offering-options-core).
 *  - AN EMPTY LIST IS A LEGITIMATE OUTCOME. It yields null - "select nothing" -
 *    and is never a reason to fabricate or substitute an offering. The caller
 *    keeps its existing empty state.
 */

/**
 * The CourseOffering.level the per-course schedule surfaces prefer when nothing
 * has been chosen yet. A level VALUE, deliberately not an offering id: the
 * concrete Level 1 offering is discovered from the server-returned menu on every
 * call, never pinned here.
 */
export const INSTRUCTOR_DEFAULT_OFFERING_LEVEL = 1;

/**
 * The EXACT fields this core consumes from one already-fetched option. A
 * structural subset of InstructorCourseOptionView (which also carries `label` and
 * `status`), declared narrowly on purpose: `label` must never participate in the
 * decision, and a narrower input makes that unrepresentable rather than merely
 * discouraged.
 */
export interface InstructorDefaultOfferingCandidate {
  readonly id: string;
  readonly level: number;
}

/**
 * Pick the offering id a per-course instructor schedule surface should select
 * automatically when it has no selection yet.
 *
 * Rules, in order:
 *  1. No options at all -> null. The caller leaves its selection null and renders
 *     its existing "nothing selectable / nothing selected" state unchanged.
 *  2. One or more options whose `level` equals {@link INSTRUCTOR_DEFAULT_OFFERING_LEVEL}
 *     -> the LOWEST id among THOSE.
 *  3. Otherwise (Level 1 is not available to this instructor) -> the LOWEST id
 *     among ALL options, i.e. the first eligible option under the same total
 *     order.
 *
 * Never throws, never mutates the input array or any option object, and never
 * returns an id that was not in the input.
 */
export function pickInstructorDefaultOfferingId(
  options: readonly InstructorDefaultOfferingCandidate[],
): string | null {
  if (options.length === 0) {
    return null;
  }

  const levelOne = options.filter(
    (option) => option.level === INSTRUCTOR_DEFAULT_OFFERING_LEVEL,
  );
  const pool = levelOne.length > 0 ? levelOne : options;

  return pool.reduce(
    (lowest, option) => (option.id < lowest ? option.id : lowest),
    pool[0].id,
  );
}
