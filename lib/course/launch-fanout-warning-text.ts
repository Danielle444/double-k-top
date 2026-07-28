/**
 * LAUNCH-WARNING - the exact user-facing text for the temporary Level 2 launch
 * warning shown before a new message/task is sent and before a new course
 * material that notifies trainees is created.
 *
 * The MESSAGE warning is still an accidental-send warning only, not course-scoped
 * containment: that fan-out remains global. Remove it once message/task
 * notification fan-out is wired to the roster-authoritative course-scoped
 * resolvers.
 *
 * The MATERIAL warning is no longer that. P-MATERIALS M3B wired material
 * notifications to the persisted-audience resolver, so the text below states who
 * WILL be notified instead of warning that the wrong people might be. It stays as
 * a pre-send confirmation because the instructor side is still a wide fan-out.
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
 * that make the fan-out reach trainees at all. An INSTRUCTORS-only material
 * creates no trainee notification and must never show this.
 *
 * P-MATERIALS M3B - REWRITTEN, AND NO LONGER A LEAK WARNING. The previous copy
 * told the admin that a material notification still reached every active trainee
 * in the system, with no real course separation. That was true of the pre-M2B
 * global fan-out and it is now false: M3B resolves trainee recipients strictly
 * from the material's persisted CourseOffering audiences, and only for offerings
 * whose course-materials capability actually resolves as available, collapsing a
 * trainee matched by several selected courses to a single notification.
 *
 * What survives is a plain, accurate STATEMENT OF EFFECT rather than a caution
 * about a defect - it tells the admin exactly who is about to be notified. The
 * one genuinely wide fan-out that remains is the INSTRUCTOR side (every active
 * instructor, whenever the persisted visibility includes instructors), so that
 * disclosure is kept explicit rather than dropped along with the leak language.
 */
export const MATERIAL_FANOUT_WARNING_TEXT =
  "לאחר יצירת החומר תישלח התראה לחניכים הפעילים בקורסים שנבחרו בלבד, ורק אם חומרי הקורס זמינים עבורם. אם נבחרה חשיפה למדריכים, תישלח התראה גם לכל המדריכים הפעילים.";

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
