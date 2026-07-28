/**
 * L2-RIDING-UI - the PURE core deciding WHICH RIDING MODES THE ADMIN UI MAY
 * OFFER for a given course level.
 *
 * PURE by construction: no Prisma, no DB, no clock, no env, no cookies, no
 * next/headers, no React, and deliberately NO "use server". It decides from a
 * single already-resolved number (or null) and nothing else, so the whole rule is
 * unit-testable without a database (see riding-mode-availability.test.ts).
 *
 * WHY THIS EXISTS
 * ---------------
 * Level 2 currently supports COMPLEX riding planning only - the simple
 * ("רשימת סוסים רגילה") flow is a backlog item that was never designed for it.
 * Until it is, the admin UI must not OFFER to create one for a Level 2 week,
 * because a simple list is created lazily by the horse-list editor's own first
 * save: the only way to keep the row from ever being written is to keep the entry
 * point from being rendered.
 *
 * THIS IS A UI-ONLY PRODUCT RESTRICTION, NOT AN AUTHORIZATION BOUNDARY.
 * Every server action, reader and writer behind simple mode is untouched and
 * still works; nothing here is a security control and nothing here may be
 * mistaken for one. Existing rows are never converted, hidden or deleted.
 *
 * THE LEVEL MUST COME FROM CourseOffering.level
 * ---------------------------------------------
 * The caller resolves it from the week's OWN CourseOffering relation
 * (WeeklySchedule.courseOfferingId -> CourseOffering.level), which is the same
 * authoritative ownership edge every other course-scoped riding reader uses (see
 * riding-slots.ts's lesson->weeklySchedule->courseOfferingId resolution). It is
 * NEVER derived from the schedule item's title, its groupName, whichever course
 * happens to be selected elsewhere in the admin session, or a hardcoded offering
 * id - each of those has already produced a wrong-course bug in this app.
 *
 * NULL IS "UNKNOWN", AND UNKNOWN MEANS UNCHANGED
 * ----------------------------------------------
 * WeeklySchedule.courseOfferingId is still NULLABLE and deliberately
 * un-backfilled: every week that predates the CourseOffering spine carries NULL,
 * and all of those are Level 1. Level 2 weeks, by contrast, can only be created
 * through the offering-scoped route (/admin/courses/[courseOfferingId]/schedule),
 * which always writes the FK - so a Level 2 week always has a level to read.
 *
 * The restriction therefore applies ONLY on a POSITIVE, proven `level === 2`.
 * A null/unknown level leaves the UI exactly as it is today, which is the
 * required behavior: Level 1 must not change in any way. Failing CLOSED here
 * would instead strip the simple option from every legacy Level 1 week, which is
 * the far worse outcome for a restriction that guards a product gap rather than
 * a privacy or authorization boundary.
 *
 * EXACTLY LEVEL 2, NOT ">= 2"
 * ---------------------------
 * The locked product rule is about Level 2, the only level besides 1 that exists
 * today. A future Level 3 is not silently covered by this: whether it supports
 * simple riding is its own product decision, and this core must be revisited
 * (with its test) rather than quietly assuming the answer.
 */

/**
 * The single Hebrew explanation shown next to the mode-selection UI of a Level 2
 * riding slot. Exported so the component and its contract test share one exact
 * string and can never drift.
 */
export const LEVEL_2_COMPLEX_ONLY_NOTE = "רמה 2 תומכת כרגע במערכת רכיבות מורכבת בלבד";

/**
 * What the mode-selection UI may offer for one riding slot.
 *
 * `canCreateComplex` is present and always true today - not because complex is
 * unconditional forever, but so the component reads its two options from the SAME
 * decision instead of gating one on this core and leaving the other implicit.
 *
 * `complexOnlyNote` is null when there is nothing to explain, so the component
 * renders the note if and only if a restriction is actually in force - it never
 * appears on Level 1, and never on an unknown level.
 */
export interface RidingModeAvailability {
  readonly canCreateSimple: boolean;
  readonly canCreateComplex: boolean;
  readonly complexOnlyNote: string | null;
}

const UNRESTRICTED: RidingModeAvailability = {
  canCreateSimple: true,
  canCreateComplex: true,
  complexOnlyNote: null,
};

const LEVEL_2_COMPLEX_ONLY: RidingModeAvailability = {
  canCreateSimple: false,
  canCreateComplex: true,
  complexOnlyNote: LEVEL_2_COMPLEX_ONLY_NOTE,
};

/**
 * Decide which riding modes the admin UI may offer, from the owning
 * CourseOffering's level.
 *
 * A strict `=== 2` comparison against a number: a string "2" arriving from a
 * loosened payload, a NaN, or an undefined from an older cached prop must all
 * fall through to UNRESTRICTED (today's behavior) rather than accidentally
 * restricting a Level 1 week.
 */
export function resolveRidingModeAvailability(
  courseLevel: number | null | undefined,
): RidingModeAvailability {
  return courseLevel === 2 ? LEVEL_2_COMPLEX_ONLY : UNRESTRICTED;
}

/**
 * Whether an ALREADY-EXISTING simple horse list on this slot should be presented
 * as a preserved legacy state rather than a normal, offerable mode.
 *
 * Deliberately does NOT hide or disable the existing editor. A Level 2 slot that
 * somehow already carries a RidingSlotHorseList row (none is expected in
 * production, since the creation path is what this restriction removes) must stay
 * fully readable and editable - silently orphaning real data is worse than the
 * inconsistency it would paper over. This flag only drives the extra sentence
 * that explains why no NEW simple list can be started here.
 */
export function isPreservedLegacySimpleMode(
  courseLevel: number | null | undefined,
  hasExistingSimpleList: boolean,
): boolean {
  return hasExistingSimpleList && !resolveRidingModeAvailability(courseLevel).canCreateSimple;
}
