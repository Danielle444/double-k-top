// R1-RIDING-HISTORY-COURSE - pure, DB-free course identity + display label for a
// riding/instruction history row (RidingLessonNote-derived rows only).
//
// WHY A CORE: the same identity has to be produced once on the server (the
// history reader in lib/actions/riding-slots.ts) and rendered by two separate
// client components (lib/components/RidingHistoryList.tsx for the admin screen
// and the instructor history modal, lib/components/TraineeProgressDetail.tsx for
// the trainee-progress timeline). Keeping both the fail-closed resolution rule
// and the label wording here means the three call sites can never drift into
// three different answers for the same row.
//
// AUTHORITATIVE SOURCE - the caller MUST pass the CourseOffering reached through
// the lesson's OWN schedule spine:
//   RidingLessonNote -> RidingSlot -> linked ScheduleItem -> WeeklySchedule ->
//   CourseOffering
// This module is deliberately incapable of inferring a course any other way: it
// accepts no date, no title, no group name, no session/selected course, no
// offering id constant and no resolver. It never calls the singleton
// current-offering resolver, never imports the temporary Level 2 compatibility
// module, and hardcodes no offering id - so a mis-scoped caller fails closed to
// "unscoped" instead of silently being labelled Level 1. (Those helper names are
// deliberately not written out verbatim anywhere in this file: the repo's
// forbidden-derivation contract tests scan raw source, comments included.)
//
// FAIL CLOSED: a legacy week with courseOfferingId = NULL (and therefore no
// joined offering) yields all-null identity, which renders as the neutral
// RIDING_HISTORY_COURSE_UNSCOPED_LABEL - never a fabricated level and never a
// guess at either course.

/** The additive course identity carried by one riding-history row. */
export interface RidingHistoryCourseIdentity {
  courseOfferingId: string | null;
  courseName: string | null;
  courseLevel: number | null;
}

/**
 * Shown when a row has no authoritative course identity (a legacy NULL-scoped
 * week). Deliberately NOT "רמה 1" and not a course name - the row is displayed,
 * it is simply not attributed.
 */
export const RIDING_HISTORY_COURSE_UNSCOPED_LABEL = "ללא שיוך קורס";

/** The single input shape: the offering joined off the lesson's own week. */
export interface RidingHistoryCourseOfferingInput {
  id: string;
  name: string;
  level: number;
}

const UNSCOPED: RidingHistoryCourseIdentity = {
  courseOfferingId: null,
  courseName: null,
  courseLevel: null,
};

/**
 * Map the lesson's own joined CourseOffering to row identity.
 *
 * All three fields come from the SAME joined offering, so they are always
 * consistent: either the row is fully attributed or it is fully unattributed.
 * A missing/null offering (legacy NULL-scoped week) returns all-null rather
 * than partial identity, and the id is never emitted without its level (which
 * is what the badge is derived from).
 *
 * Takes exactly ONE argument by design - there is no date/title/group/session
 * parameter it could accidentally infer a course from.
 */
export function resolveRidingHistoryCourseIdentity(
  courseOffering: RidingHistoryCourseOfferingInput | null | undefined,
): RidingHistoryCourseIdentity {
  if (!courseOffering) return UNSCOPED;
  if (typeof courseOffering.id !== "string" || courseOffering.id.length === 0) return UNSCOPED;
  if (!Number.isInteger(courseOffering.level)) return UNSCOPED;
  return {
    courseOfferingId: courseOffering.id,
    courseName: courseOffering.name,
    courseLevel: courseOffering.level,
  };
}

/**
 * The compact badge text for a row's identity: "רמה 1" / "רמה 2" / "רמה {n}"
 * for any future level, and RIDING_HISTORY_COURSE_UNSCOPED_LABEL when identity
 * is missing.
 *
 * Derived from `courseLevel` ONLY - never from courseName. The offering name is
 * admin-editable free text (@@unique([activityYearId, name]) is its identity,
 * not its content), so parsing a level out of it would break the badge the
 * moment a course is renamed. The full name is available to callers separately
 * as secondary context (e.g. a tooltip), never as the level source.
 *
 * `courseOfferingId` present but `courseLevel` absent is unreachable against the
 * current schema (CourseOffering.level is a required Int) - the guard exists so
 * this function can never fabricate a level for a partially-identified row.
 */
export function formatRidingHistoryCourseLabel(identity: RidingHistoryCourseIdentity): string {
  if (identity.courseOfferingId === null) return RIDING_HISTORY_COURSE_UNSCOPED_LABEL;
  if (identity.courseLevel === null || !Number.isInteger(identity.courseLevel)) {
    return RIDING_HISTORY_COURSE_UNSCOPED_LABEL;
  }
  return `רמה ${identity.courseLevel}`;
}
