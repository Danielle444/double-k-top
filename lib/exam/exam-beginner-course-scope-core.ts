/**
 * EXAM EX-BEGINNER-EXAM-READ — the PURE "may this course offering read beginner
 * Teaching-Practice entries at all?" predicate.
 *
 * PURE by construction: no Prisma, no DB, no Next, no clock (`Date.now`/`new
 * Date`), no randomness, no env, no auth/session/cookie, no filesystem, no
 * network, and no imports at all. Deterministic; never mutates its inputs.
 *
 * WHAT THIS ANSWERS (and only this): given a course offering's LEVEL, may the
 * exam read pipeline project beginner Teaching-Practice rows for it?
 *
 * ===========================================================================
 * WHY A LEVEL PREDICATE AND NOT A DATA RELATION
 * ===========================================================================
 * `TeachingPracticeLesson` has NO `courseOfferingId`, and neither does
 * `TeachingPracticeTrack`: a lesson is not course-scoped in the database, so the
 * ONLY thing binding a lesson to a plan is that plan's explicit
 * `ExamTeachingPracticeSourceDate` selection. Two plans that select the SAME
 * date would therefore read the SAME lessons.
 *
 * The committed product rule closes that hole WITHOUT a schema change, a
 * migration, a per-plan lesson allow-list or a new lesson→course relation:
 *
 *     BEGINNER TEACHING-PRACTICE EXAMS EXIST ONLY FOR LEVEL 1.
 *
 * Level 2 has no beginner teaching-practice exams at all, so a Level-2 plan must
 * read NO beginner rows regardless of which dates it has selected. With at most
 * ONE offering able to project beginner rows, a shared source date can no longer
 * put one course's trainees, children or parent contacts under another course's
 * exam plan — the overlap is unreachable rather than merely unlikely.
 *
 * THIS IS A CONTAINMENT RULE, NOT AN AUTHORIZATION RULE. It decides WHICH ROWS
 * EXIST for an offering, never WHO may read them: every audience gate, capability
 * check and publication gate is unchanged and lives elsewhere. Admin, instructor
 * and trainee readers all pass through this same predicate and all receive the
 * SAME beginner detail contract for a Level-1 offering — no field is redacted,
 * split or narrowed by audience here.
 *
 * FAIL CLOSED: the level must be EXACTLY the integer 1. A missing level, `null`,
 * `undefined`, `NaN`, `Infinity`, a non-integer, a numeric string and any other
 * level all disable beginner reading. A caller that cannot state the level gets
 * no beginner rows rather than somebody else's.
 */

/**
 * The ONE course level whose Teaching-Practice lessons are beginner exam
 * entries. Stated once, here, so the rule cannot drift between the three role
 * readers — and so a future product change is a single-line edit with a single
 * test to update.
 *
 * It is a LEVEL, deliberately, not a `CourseOffering.id`: an id would break the
 * moment a new activity year creates a fresh Level-1 offering, and hardcoding
 * one would make this module a second, silently-stale source of course identity.
 */
export const BEGINNER_SOURCE_COURSE_LEVEL = 1;

/**
 * May an offering at this level project beginner Teaching-Practice rows?
 *
 * `unknown` rather than `number` on purpose: this predicate is the boundary that
 * a malformed, absent or wrongly-typed level meets, and a `number` parameter
 * would push that check onto every caller instead. `Number.isInteger` rejects
 * `NaN`, `Infinity` and `1.0000001` alike, and the strict equality that follows
 * rejects `"1"`, `true` and a boxed `Number`.
 */
export function isBeginnerSourceCourseLevel(courseLevel: unknown): boolean {
  if (typeof courseLevel !== "number") return false;
  if (!Number.isInteger(courseLevel)) return false;
  return courseLevel === BEGINNER_SOURCE_COURSE_LEVEL;
}
