/**
 * TEMPORARY LAUNCH RULE:
 * Level-2-only navigation is derived from the single eligible option's level.
 * Replace with server-returned effective capabilities after launch.
 *
 * PURE by construction: no Prisma, no DB, no clock, no randomness, no auth, no
 * cookie, no env, no React, no runtime imports at all (both imports below are
 * type-only and erased at build). The whole rule is therefore unit-testable
 * without mounting the client or pulling its `server-only` chain (see
 * trainee-nav-visibility.test.ts) - unlike app/student/StudentClient.tsx, which
 * cannot be imported in node:test.
 *
 * SCOPE - THIS IS NAVIGATION CLEANUP ONLY, NOT AUTHORIZATION. It decides which
 * trainee nav/menu entries are shown; it unlocks nothing and guards nothing. The
 * server-side capability guards on every trainee reader remain the sole
 * authority, and direct-route protection is unchanged. This module must never be
 * consulted to decide whether a read is allowed.
 *
 * WHY LEVEL, NOT CAPABILITIES: the trainee client is only handed
 * `{ id, label, level }` per eligible option today - effective per-offering
 * capabilities are not returned client-side. Rather than invent a second
 * capability model or fetch capabilities into the menu (both out of scope for
 * this launch fix), this reuses the already server-returned `level` as an
 * explicit, temporary launch exception. It is derived from the FULL eligible
 * options set (cardinality + level), never from the currently selected course,
 * so a dual-enrolled trainee who selects a Level 2 course keeps every Level 1
 * module.
 */
import type { MainTabId } from "@/lib/components/BottomTabs";
import type { TraineeCourseOptionView } from "@/lib/course/trainee-course-selection-core";

/**
 * A trainee is "Level-2-only" iff they have EXACTLY ONE eligible course option
 * and that option's server-returned level is 2. Two-or-more eligible options
 * (dual enrollment) is never Level-2-only, regardless of which course is
 * currently selected - so switching the selected course can never hide a module
 * a dual trainee reaches through Level 1. Zero options is not Level-2-only
 * either (the length check fails), so the loading/no-course state is unchanged.
 */
export function isLevel2OnlyTrainee(options: readonly TraineeCourseOptionView[]): boolean {
  return options.length === 1 && options[0].level === 2;
}

/**
 * The nav/menu entries a Level-2-only trainee may see: the two Level 2 course
 * modules (SCHEDULE via `schedule`, CONTACTS via `contacts`) plus non-course
 * utility entries - the home dashboard (`today`), the `profile`/logout screen,
 * `help`, and the `more` container that reaches contacts/profile/help/logout.
 *
 * This is an ALLOW-LIST, so it is fail-closed: any trainee nav id not listed
 * here (duties, messages/tasks, materials, teaching practice, weekly feedback,
 * notifications, and any future module) is hidden for a Level-2-only trainee
 * without needing to be enumerated. For every other trainee the list is ignored
 * and navigation is unchanged.
 */
const LEVEL2_ONLY_VISIBLE_NAV_IDS: readonly MainTabId[] = [
  "today",
  "schedule",
  "contacts",
  "profile",
  "help",
  "more",
];

/**
 * Is one nav/menu entry visible for a trainee with these eligible options?
 *
 * Non-Level-2-only trainees (Level-1-only, dual, or still loading) always see
 * every entry - navigation is unchanged for them. A Level-2-only trainee sees an
 * entry only if it is in the allow-list above.
 */
export function isTraineeNavEntryVisible(
  id: MainTabId,
  options: readonly TraineeCourseOptionView[],
): boolean {
  if (!isLevel2OnlyTrainee(options)) return true;
  return LEVEL2_ONLY_VISIBLE_NAV_IDS.includes(id);
}

/**
 * Filter any list of nav/menu entries (bottom tabs, the "more" menu, the home
 * quick-action shortcuts) down to the ones visible for a trainee with these
 * eligible options, preserving order. Returns the list unchanged for every
 * non-Level-2-only trainee.
 */
export function filterTraineeNavEntries<T extends { id: MainTabId }>(
  entries: readonly T[],
  options: readonly TraineeCourseOptionView[],
): T[] {
  return entries.filter((entry) => isTraineeNavEntryVisible(entry.id, options));
}
