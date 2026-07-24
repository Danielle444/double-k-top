/**
 * LAUNCH-WARNING - the exact user-facing text for the temporary Level 2 launch
 * warning shown before a new message/task is sent and before a new course
 * material that notifies trainees is created.
 *
 * This is an accidental-send warning only, not course-scoped containment.
 * Remove after message and material notification fanout are wired to the
 * roster-authoritative course-scoped resolvers.
 *
 * WHY THE TEXT LIVES HERE AND NOT IN THE COMPONENTS
 * -------------------------------------------------
 * Three separate screens show one of these two warnings (the admin message
 * composer, the instructor message composer, and the admin material composer).
 * Inlining the strings would put the same sentence in three files with no way to
 * prove they still agree. Keeping them here makes the wording a single source of
 * truth that the contract test IMPORTS and asserts character-for-character,
 * rather than grepping for a fragment.
 *
 * PURE by construction: a plain module with no "use client" directive, no JSX, no
 * React import, no Prisma, no next/headers, no environment access and no runtime
 * side effect at import time. That is deliberate - it is what lets a DB-free
 * node:test import it directly.
 *
 * DELIBERATELY NOT HERE: any decision about WHEN to warn. The material warning's
 * STUDENTS/BOTH condition is a property of the material being created and lives
 * with the composer that knows the chosen visibility; this module only supplies
 * words.
 */

/**
 * Shown before a brand-new message or task is sent, on BOTH the admin and the
 * instructor composer. Honest about the current global fan-out: the recipient
 * resolution behind the send is still a global active-trainee query, so a Level 1
 * send can reach a trainee who belongs to another course.
 */
export const MESSAGE_FANOUT_WARNING_TEXT =
  "כעת ההודעות והמשימות עדיין נשלחות לכל החניכים הפעילים במערכת, ללא הפרדה מלאה בין הקורסים. ההודעה עלולה להגיע גם לחניכים שאינם שייכים לקורס שאליו התכוונת.";

/**
 * Shown before a brand-new course material that will notify trainees is created -
 * i.e. only for visibility STUDENTS or BOTH, which are exactly the two values
 * that make createMaterialAddedNotifications fan out to students. An
 * INSTRUCTORS-only material creates no student notification and must never show
 * this.
 */
export const MATERIAL_FANOUT_WARNING_TEXT =
  "כעת התראות על חומר חדש עדיין נשלחות לכל החניכים הפעילים במערכת, ללא הפרדה מלאה בין הקורסים. שם החומר עלול להופיע גם לחניכים שאינם שייכים לקורס.";

/**
 * The shared cancel label. Cancel is the SAFE action on both warnings: it is
 * rendered first, styled as the secondary action, and is what the modal's ✕ and
 * backdrop resolve to.
 */
export const FANOUT_WARNING_CANCEL_LABEL = "ביטול";

/** The explicit "send anyway" confirmation for the message/task warning. */
export const MESSAGE_FANOUT_WARNING_CONFIRM_LABEL = "שליחה בכל זאת";

/** The explicit "add anyway" confirmation for the material warning. */
export const MATERIAL_FANOUT_WARNING_CONFIRM_LABEL = "הוספה בכל זאת";

/** Modal heading for the message/task warning. */
export const MESSAGE_FANOUT_WARNING_TITLE = "שימו לב לפני שליחה";

/** Modal heading for the material warning. */
export const MATERIAL_FANOUT_WARNING_TITLE = "שימו לב לפני הוספה";
