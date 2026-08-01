/**
 * Home-page shortcut to exams (trainee).
 *
 * StudentClient.tsx cannot be imported in node:test (it pulls its `server-only`
 * chain - see trainee-nav-visibility.ts), so this asserts the wiring at the
 * source level, the same convention trainee-materials-nav-entry.contract.test.ts
 * and trainee-home-duties-visibility.test.ts use.
 *
 * Run with:
 *   npx tsx --test app/student/trainee-exams-home-shortcut.contract.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

test("the trainee home quick-actions grid carries an exams shortcut", () => {
  const src = readSource("./StudentClient.tsx");
  const start = src.indexOf("const STUDENT_QUICK_ACTIONS");
  assert.notEqual(start, -1, "STUDENT_QUICK_ACTIONS must still exist");
  const block = src.slice(start, src.indexOf("];", start));
  assert.match(
    block,
    /\{\s*id:\s*"exams",\s*label:\s*"מבחנים"\s*\}/,
    "the home quick-actions array must include the exams shortcut, labelled מבחנים",
  );
});

test("the home exams shortcut reuses the existing quick-action rendering, not a new one", () => {
  const src = readSource("./StudentClient.tsx");
  // The quick-actions grid renders every entry through ONE shared map/button,
  // exactly like every other shortcut (schedule, duties, messages, ...) - no
  // second grid, no bespoke card, no new route.
  const idx = src.indexOf("{visibleQuickActions.map((action) => (");
  assert.notEqual(idx, -1, "the shared quick-actions renderer must still exist");
  assert.ok(
    !src.includes("visibleQuickActions2") && !src.includes("EXAMS_QUICK_ACTION"),
    "no second/parallel shortcuts list may be introduced for exams",
  );
});

test("the home exams shortcut is filtered through the SAME trainee nav-visibility rule as every other quick action", () => {
  const src = readSource("./StudentClient.tsx");
  assert.match(
    src,
    /const visibleQuickActions = courseOptionsLoading\s*\?\s*restrictToLoadingSafe\(STUDENT_QUICK_ACTIONS\)\s*:\s*filterTraineeNavEntries\(STUDENT_QUICK_ACTIONS, eligibleCourseOptions, serverUnlockedNavIds\);/,
    "STUDENT_QUICK_ACTIONS (now including exams) must still go through filterTraineeNavEntries unchanged",
  );
});

test("exams stays on the Level-2-only allow-list, so the new home shortcut is visible to the same trainees as the existing menu entry", () => {
  const nav = readSource("./trainee-nav-visibility.ts");
  const list = nav.slice(
    nav.indexOf("const LEVEL2_ONLY_VISIBLE_NAV_IDS"),
    nav.indexOf("];", nav.indexOf("const LEVEL2_ONLY_VISIBLE_NAV_IDS")),
  );
  assert.ok(list.includes('"exams"'), "exams must remain on the Level-2-only allow-list");
});
