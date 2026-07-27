/**
 * TEMPORARY LAUNCH RULE - unit tests for the Level-2-only trainee navigation
 * visibility core (app/student/trainee-nav-visibility.ts).
 *
 * This module is PURE (type-only imports, no `server-only` chain), so unlike
 * app/student/StudentClient.tsx it can be imported and exercised directly here.
 *
 * Run with:
 *   npx tsx --test app/student/trainee-nav-visibility.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { MainTabId } from "@/lib/components/BottomTabs";
import type { TraineeCourseOptionView } from "@/lib/course/trainee-course-selection-core";
import {
  isLevel2OnlyTrainee,
  isTraineeNavEntryVisible,
  filterTraineeNavEntries,
} from "./trainee-nav-visibility";

function option(id: string, level: number): TraineeCourseOptionView {
  return { id, label: `רמה ${level}`, level };
}

// The trainee nav id universe, mirrored from StudentClient's tab lists so the
// tests below can assert the full shown/hidden split, not just a few samples.
const HOME: MainTabId = "today";
const SCHEDULE: MainTabId = "schedule";
const CONTACTS: MainTabId = "contacts";
const PROFILE: MainTabId = "profile";
const HELP: MainTabId = "help";
const MORE: MainTabId = "more";
const MATERIALS: MainTabId = "materials";
const COURSE_MODULE_IDS: MainTabId[] = [
  "duties",
  "messages",
  "materials",
  "teachingPractice",
  "weeklyFeedback",
  "notifications",
];
// The Level 2 modules still governed ONLY by the temporary level allow-list.
// "materials" is deliberately excluded: it is no longer decided by level, but by
// the server capability unlock (serverUnlockedNavIds), so it is asserted
// separately in both directions below rather than being pinned as always-hidden.
const LEVEL_RULE_ONLY_MODULE_IDS: MainTabId[] = COURSE_MODULE_IDS.filter((id) => id !== MATERIALS);

// ---------------------------------------------------------------------------
// isLevel2OnlyTrainee cardinality + level contract
// ---------------------------------------------------------------------------

test("Level-2-only iff exactly one eligible option at level 2", () => {
  assert.equal(isLevel2OnlyTrainee([option("a", 2)]), true);
});

test("a single Level 1 option is NOT Level-2-only", () => {
  assert.equal(isLevel2OnlyTrainee([option("a", 1)]), false);
});

test("two eligible options are never Level-2-only, even if one is level 2", () => {
  assert.equal(isLevel2OnlyTrainee([option("a", 1), option("b", 2)]), false);
  assert.equal(isLevel2OnlyTrainee([option("a", 2), option("b", 2)]), false);
});

test("zero options (loading / no course) is not Level-2-only", () => {
  assert.equal(isLevel2OnlyTrainee([]), false);
});

// ---------------------------------------------------------------------------
// (1)(5)(6) One Level 2 option: hide course modules, keep home/schedule/
// contacts + profile/help/more utilities.
// ---------------------------------------------------------------------------

test("Level-2-only hides every unavailable course module (no server unlock)", () => {
  const opts = [option("a", 2)];
  // With no unlock supplied, the rule is EXACTLY what it was before: every course
  // module - materials included - is hidden for a Level-2-only trainee.
  for (const id of COURSE_MODULE_IDS) {
    assert.equal(isTraineeNavEntryVisible(id, opts), false, `${id} must be hidden`);
    assert.equal(isTraineeNavEntryVisible(id, opts, []), false, `${id} must be hidden with an empty unlock`);
  }
});

test("Level-2-only keeps home, schedule and contacts visible", () => {
  const opts = [option("a", 2)];
  assert.equal(isTraineeNavEntryVisible(HOME, opts), true);
  assert.equal(isTraineeNavEntryVisible(SCHEDULE, opts), true);
  assert.equal(isTraineeNavEntryVisible(CONTACTS, opts), true);
});

test("Level-2-only keeps profile, help and the 'more' container visible", () => {
  const opts = [option("a", 2)];
  assert.equal(isTraineeNavEntryVisible(PROFILE, opts), true);
  assert.equal(isTraineeNavEntryVisible(HELP, opts), true);
  assert.equal(isTraineeNavEntryVisible(MORE, opts), true);
});

// ---------------------------------------------------------------------------
// SERVER CAPABILITY UNLOCK (serverUnlockedNavIds) - the Level 2 Course Materials
// entry point. The unlock is ADDITIVE: it may reveal an entry the level rule
// would hide, and may do nothing else.
// ---------------------------------------------------------------------------

test("Level-2-only + materials unlocked -> the materials entry becomes visible", () => {
  const opts = [option("a", 2)];
  assert.equal(isTraineeNavEntryVisible(MATERIALS, opts, [MATERIALS]), true);
});

test("unlocking materials reveals ONLY materials - every other module stays hidden", () => {
  const opts = [option("a", 2)];
  for (const id of LEVEL_RULE_ONLY_MODULE_IDS) {
    assert.equal(
      isTraineeNavEntryVisible(id, opts, [MATERIALS]),
      false,
      `${id} must stay hidden when only materials is unlocked`,
    );
  }
});

test("an empty unlock list leaves the materials entry hidden for a Level-2-only trainee", () => {
  const opts = [option("a", 2)];
  assert.equal(isTraineeNavEntryVisible(MATERIALS, opts, []), false);
  assert.equal(isTraineeNavEntryVisible(MATERIALS, opts), false, "omitted argument behaves as empty");
});

test("the unlock never HIDES an entry the level allow-list already allows", () => {
  const opts = [option("a", 2)];
  for (const id of [HOME, SCHEDULE, CONTACTS, PROFILE, HELP, MORE]) {
    assert.equal(isTraineeNavEntryVisible(id, opts, [MATERIALS]), true, `${id} must stay visible`);
    assert.equal(isTraineeNavEntryVisible(id, opts, []), true, `${id} must stay visible with no unlock`);
  }
});

test("the unlock cannot INJECT an entry the surface does not define", () => {
  const opts = [option("a", 2)];
  // "materials" is unlocked but absent from this surface's own entry list.
  const entries = [{ id: HOME }, { id: SCHEDULE }];
  const kept = filterTraineeNavEntries(entries, opts, [MATERIALS]);
  assert.deepEqual(
    kept.map((k) => k.id),
    [HOME, SCHEDULE],
    "filtering may only remove entries, never manufacture one",
  );
  assert.equal(kept.length, entries.length);
});

test("filter keeps the materials entry in place (order preserved) when unlocked", () => {
  const moreItems: { id: MainTabId; label: string }[] = [
    { id: "profile", label: "פרופיל" },
    { id: "contacts", label: "אנשי קשר" },
    { id: "materials", label: "חומרי קורס" },
    { id: "teachingPractice", label: "התנסויות מתחילים" },
    { id: "notifications", label: "עדכונים" },
    { id: "weeklyFeedback", label: "משוב שבועי" },
    { id: "help", label: "עזרה" },
  ];
  assert.deepEqual(
    filterTraineeNavEntries(moreItems, [option("a", 2)], [MATERIALS]).map((i) => i.id),
    ["profile", "contacts", "materials", "help"],
    "materials appears between contacts and help, exactly where the menu defines it",
  );
  assert.deepEqual(
    filterTraineeNavEntries(moreItems, [option("a", 2)], []).map((i) => i.id),
    ["profile", "contacts", "help"],
    "and disappears again with no unlock",
  );
});

test("an unlock id that is not a Level 2 module is still only additive", () => {
  // Defensive: unlocking several ids at once reveals exactly those ids.
  const opts = [option("a", 2)];
  const unlocked: MainTabId[] = [MATERIALS, "duties"];
  assert.equal(isTraineeNavEntryVisible(MATERIALS, opts, unlocked), true);
  assert.equal(isTraineeNavEntryVisible("duties", opts, unlocked), true);
  assert.equal(isTraineeNavEntryVisible("messages", opts, unlocked), false);
});

// ---------------------------------------------------------------------------
// (2)(3)(4) Level-1-only, dual, and dual-selecting-Level-2 are all unchanged.
// ---------------------------------------------------------------------------

test("a Level-1-only trainee is unaffected by the unlock in either direction", () => {
  const opts = [option("a", 1)];
  for (const id of [HOME, SCHEDULE, CONTACTS, PROFILE, HELP, MORE, ...COURSE_MODULE_IDS]) {
    assert.equal(isTraineeNavEntryVisible(id, opts, []), true, `${id} visible with an empty unlock`);
    assert.equal(isTraineeNavEntryVisible(id, opts, [MATERIALS]), true, `${id} visible with an unlock`);
  }
});

test("a dual trainee is unaffected by the unlock in either direction", () => {
  const opts = [option("l1", 1), option("l2", 2)];
  for (const id of [HOME, SCHEDULE, CONTACTS, PROFILE, HELP, MORE, ...COURSE_MODULE_IDS]) {
    assert.equal(isTraineeNavEntryVisible(id, opts, []), true, `${id} visible with an empty unlock`);
    assert.equal(isTraineeNavEntryVisible(id, opts, [MATERIALS]), true, `${id} visible with an unlock`);
  }
});

test("omitting the new argument is byte-for-byte the previous behaviour", () => {
  const cases: readonly TraineeCourseOptionView[][] = [
    [],
    [option("a", 1)],
    [option("a", 2)],
    [option("a", 1), option("b", 2)],
    [option("a", 2), option("b", 2)],
  ];
  const allIds: MainTabId[] = [HOME, SCHEDULE, CONTACTS, PROFILE, HELP, MORE, ...COURSE_MODULE_IDS];
  for (const opts of cases) {
    for (const id of allIds) {
      assert.equal(
        isTraineeNavEntryVisible(id, opts),
        isTraineeNavEntryVisible(id, opts, []),
        `${id} must behave identically with an omitted and an empty unlock`,
      );
    }
    assert.deepEqual(
      filterTraineeNavEntries(allIds.map((id) => ({ id })), opts),
      filterTraineeNavEntries(allIds.map((id) => ({ id })), opts, []),
    );
  }
});

test("a single Level 1 option leaves every entry visible (unchanged)", () => {
  const opts = [option("a", 1)];
  for (const id of [HOME, SCHEDULE, CONTACTS, PROFILE, HELP, MORE, ...COURSE_MODULE_IDS]) {
    assert.equal(isTraineeNavEntryVisible(id, opts), true, `${id} must stay visible`);
  }
});

test("two eligible options leave every entry visible (dual unchanged)", () => {
  const opts = [option("a", 1), option("b", 2)];
  for (const id of [HOME, SCHEDULE, CONTACTS, PROFILE, HELP, MORE, ...COURSE_MODULE_IDS]) {
    assert.equal(isTraineeNavEntryVisible(id, opts), true, `${id} must stay visible`);
  }
});

test("a dual trainee keeps Level 1 modules regardless of the selected course", () => {
  // The rule takes ONLY the eligible options, never the selected id, so there is
  // no selection input that could turn a dual trainee into Level-2-only. Every
  // module (including duties, a Level 1 module) stays visible.
  const dual = [option("l1", 1), option("l2", 2)];
  assert.equal(isLevel2OnlyTrainee(dual), false);
  const kept = filterTraineeNavEntries(
    COURSE_MODULE_IDS.map((id) => ({ id })),
    dual,
  );
  assert.deepEqual(
    kept.map((k) => k.id),
    COURSE_MODULE_IDS,
    "no Level 1 module may be dropped for a dual trainee",
  );
});

// ---------------------------------------------------------------------------
// filterTraineeNavEntries preserves order and shape.
// ---------------------------------------------------------------------------

test("filter keeps only allow-listed ids in order for a Level-2-only trainee", () => {
  const mainTabs: { id: MainTabId; label: string }[] = [
    { id: "today", label: "היום" },
    { id: "schedule", label: 'לו"ז' },
    { id: "duties", label: "תורנויות" },
    { id: "messages", label: "הודעות" },
    { id: "more", label: "עוד" },
  ];
  const kept = filterTraineeNavEntries(mainTabs, [option("a", 2)]);
  assert.deepEqual(
    kept.map((t) => t.id),
    ["today", "schedule", "more"],
    "Level-2-only bottom tabs drop duties and messages, keep order",
  );
});

test("filter returns the list unchanged for a non-Level-2-only trainee", () => {
  const items = [{ id: "duties" as MainTabId }, { id: "messages" as MainTabId }];
  assert.deepEqual(filterTraineeNavEntries(items, [option("a", 1)]), items);
  assert.deepEqual(filterTraineeNavEntries(items, [option("a", 1), option("b", 2)]), items);
});

// ---------------------------------------------------------------------------
// (7)(8) This module is nav-only: no server action, resolver, route, auth,
// cookie, DB or capability read anywhere in it. Server-side guards and
// direct-route protection are therefore provably untouched by this file.
// ---------------------------------------------------------------------------

test("the visibility module performs no server/authorization/IO work", () => {
  const src = readFileSync(
    fileURLToPath(new URL("./trainee-nav-visibility.ts", import.meta.url)),
    "utf8",
  );
  // EVERY import statement must be a type-only import (erased at build), so the
  // module pulls no runtime dependency at all - no server-only, no Prisma, no
  // capability reader, no next/headers. That is why it is importable in this
  // test, and it makes "no server action / resolver / route / auth touched"
  // structural rather than a per-name blocklist.
  const importLines = src.match(/^\s*import\b.*$/gm) ?? [];
  assert.ok(importLines.length >= 2, "expected the two type-only imports");
  for (const line of importLines) {
    assert.match(line, /^\s*import type\b/, `every import must be type-only: ${line.trim()}`);
  }
  // And no runtime require() / dynamic import() escape hatch.
  assert.ok(!/\brequire\s*\(/.test(src), "no runtime require()");
  assert.ok(!/\bimport\s*\(/.test(src), "no dynamic import()");
  assert.ok(/import type \{ MainTabId \}/.test(src), "MainTabId import must be type-only");
  assert.ok(
    /import type \{ TraineeCourseOptionView \}/.test(src),
    "TraineeCourseOptionView import must be type-only",
  );
});
