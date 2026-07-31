/**
 * TEMPORARY LAUNCH RULE (with one capability-driven exception):
 * Level-2-only navigation is derived from the single eligible option's level.
 * Replace with server-returned effective capabilities after launch.
 *
 * THE EXCEPTION - COURSE MATERIALS. The level allow-list below still governs
 * MOST Level 2 navigation, but it is a guess, and it went stale the moment
 * COURSE_MATERIALS was enabled for Level 2: a Level-2-only trainee with an ACTIVE
 * enrollment, an ACTIVE offering, an ENABLED capability and an assigned material
 * audience still lost the "חומרי קורס" entry, because nothing on this path ever
 * read a capability. Entries can now be unlocked by the caller through
 * `serverUnlockedNavIds` - a list the trainee client derives from a REAL
 * server-side capability decision (lib/actions/trainee-materials-access.ts,
 * which shares the content reader's own scope resolver). Materials is the first
 * and currently only such entry; every other Level 2 module stays on the
 * temporary level rule until it too is migrated to a server decision.
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
 *
 * ...AND WHERE THAT STOPPED BEING GOOD ENOUGH: `serverUnlockedNavIds` is the
 * escape hatch for an entry whose real answer is now known server-side. It still
 * invents no capability model HERE - this module stays pure and receives an
 * already-decided list of ids. Only the caller talks to the server. Migrating a
 * further module off the level guess means passing its id in that list too, not
 * editing the allow-list.
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
 * The nav/menu entries a Level-2-only trainee may see: the Level 2 course
 * modules (SCHEDULE via `schedule`, CONTACTS via `contacts`, and the exam
 * schedule via `exams`) plus non-course utility entries - the home dashboard
 * (`today`), the `profile`/logout screen, `help`, and the `more` container that
 * reaches contacts/profile/help/logout.
 *
 * This is an ALLOW-LIST, so it is fail-closed: any trainee nav id not listed
 * here (duties, messages/tasks, materials, teaching practice, weekly feedback,
 * notifications, and any future module) is hidden for a Level-2-only trainee
 * without needing to be enumerated. For every other trainee the list is ignored
 * and navigation is unchanged.
 *
 * WHY "exams" IS ON THE LIST (EX-ROLE-OP-UI-MVP). The exam schedule is an
 * ADVANCED-COURSE module: the Level-2-only trainee is precisely the trainee it
 * exists for, and the allow-list was hiding the one entry point to a screen the
 * server was already willing to serve them. The level rule says only what a
 * LEVEL implies, and "a Level 2 trainee may reach their exam schedule" is
 * exactly such a statement.
 *
 * IT UNLOCKS NOTHING. Reaching the screen is not being shown a schedule: the
 * committed trainee reader proves the session, resolves the trainee's own course
 * and requires a PUBLISHED plan and PUBLISHED lessons, and every denial comes
 * back as the same empty day. A Level 2 trainee whose course has no exam plan
 * therefore sees the neutral empty sentence, exactly as before - what changes is
 * only that they can now get to it.
 *
 * Deliberately NOT extended with "materials": Materials is unlocked per-trainee
 * through `serverUnlockedNavIds` on the real capability decision, so a Level 2
 * offering that does NOT enable COURSE_MATERIALS still correctly hides it. Exams
 * has no capability of its own to consult - there is no EXAMS capability - so
 * there is no server decision here to defer to, and inventing a placeholder one
 * would read as enforcement to the next reader.
 */
const LEVEL2_ONLY_VISIBLE_NAV_IDS: readonly MainTabId[] = [
  "today",
  "schedule",
  "contacts",
  "exams",
  "profile",
  "help",
  "more",
];

/**
 * Is one nav/menu entry visible for a trainee with these eligible options?
 *
 * Non-Level-2-only trainees (Level-1-only, dual, or still loading) always see
 * every entry - navigation is unchanged for them, and `serverUnlockedNavIds` is
 * then irrelevant because nothing is being hidden in the first place. A
 * Level-2-only trainee sees an entry if it is in the level allow-list above OR
 * the caller has unlocked it from a server-side capability decision.
 *
 * `serverUnlockedNavIds` is ADDITIVE ONLY - it can reveal an entry the level rule
 * would have hidden, never hide one the level rule allows, and never affect a
 * Level-1-only or dual trainee. Defaulting it to `[]` keeps every existing caller
 * byte-for-byte unchanged.
 */
export function isTraineeNavEntryVisible(
  id: MainTabId,
  options: readonly TraineeCourseOptionView[],
  serverUnlockedNavIds: readonly MainTabId[] = [],
): boolean {
  if (!isLevel2OnlyTrainee(options)) return true;
  if (LEVEL2_ONLY_VISIBLE_NAV_IDS.includes(id)) return true;
  return serverUnlockedNavIds.includes(id);
}

/**
 * Filter any list of nav/menu entries (bottom tabs, the "more" menu, the home
 * quick-action shortcuts) down to the ones visible for a trainee with these
 * eligible options, preserving order. Returns the list unchanged for every
 * non-Level-2-only trainee.
 *
 * This FILTERS and never constructs: an unlocked id that is not already in
 * `entries` cannot appear in the result, so no surface can be made to render an
 * entry it does not itself define.
 */
export function filterTraineeNavEntries<T extends { id: MainTabId }>(
  entries: readonly T[],
  options: readonly TraineeCourseOptionView[],
  serverUnlockedNavIds: readonly MainTabId[] = [],
): T[] {
  return entries.filter((entry) => isTraineeNavEntryVisible(entry.id, options, serverUnlockedNavIds));
}
