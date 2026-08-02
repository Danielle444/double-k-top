/**
 * A4 — home-page shortcut to the existing trainee Beginner Teaching-Practice
 * section ("התנסויות מתחילים"), mirroring the established convention of
 * trainee-exams-home-shortcut.contract.test.ts for the exams shortcut.
 *
 * StudentClient.tsx cannot be imported in node:test (it pulls its
 * `server-only` chain), so this asserts the wiring at the source level.
 *
 * Run with:
 *   npx tsx --test app/student/trainee-teaching-practice-home-shortcut.contract.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

test('the trainee home quick-actions grid carries a "התנסויות מתחילים" shortcut', () => {
  const src = readSource("./StudentClient.tsx");
  const start = src.indexOf("const STUDENT_QUICK_ACTIONS");
  assert.notEqual(start, -1, "STUDENT_QUICK_ACTIONS must still exist");
  const block = src.slice(start, src.indexOf("];", start));
  assert.match(
    block,
    /\{\s*id:\s*"teachingPractice",\s*label:\s*"התנסויות מתחילים"\s*\}/,
    "the home quick-actions array must include the teachingPractice shortcut, labelled התנסויות מתחילים",
  );
});

test("the home shortcut reuses the existing quick-action rendering and tab-switch mechanism, not a new one", () => {
  const src = readSource("./StudentClient.tsx");
  const idx = src.indexOf("{visibleQuickActions.map((action) => (");
  assert.notEqual(idx, -1, "the shared quick-actions renderer must still exist");
  assert.ok(
    src.includes("onClick={() => setActiveTab(action.id)}"),
    "quick actions must still switch tabs via the existing setActiveTab mechanism",
  );
});

test("the teachingPractice entry still appears in the trainee 'עוד' menu (STUDENT_MORE_ITEMS), unchanged", () => {
  const src = readSource("./StudentClient.tsx");
  const start = src.indexOf("const STUDENT_MORE_ITEMS");
  const block = src.slice(start, src.indexOf("];", start));
  assert.match(block, /\{\s*id:\s*"teachingPractice",\s*label:\s*"התנסויות מתחילים"\s*\}/);
});

test("the shortcut opens the existing, unwritten StudentTeachingPracticeSection - no new route, no new destination", () => {
  const src = readSource("./StudentClient.tsx");
  assert.ok(
    src.includes(
      '{activeTab === "teachingPractice" && <StudentTeachingPracticeSection studentId={session.id} />}',
    ),
    "the teachingPractice tab body must be unchanged - the shortcut adds navigation, not a new destination",
  );
});

test("the home teachingPractice shortcut is filtered through the SAME trainee nav-visibility rule as every other quick action", () => {
  const src = readSource("./StudentClient.tsx");
  assert.match(
    src,
    /const visibleQuickActions = courseOptionsLoading\s*\?\s*restrictToLoadingSafe\(STUDENT_QUICK_ACTIONS\)\s*:\s*filterTraineeNavEntries\(STUDENT_QUICK_ACTIONS, eligibleCourseOptions, serverUnlockedNavIds\);/,
    "STUDENT_QUICK_ACTIONS (now including teachingPractice) must still go through filterTraineeNavEntries unchanged",
  );
});

test("teachingPractice's existing visibility gating (hidden for Level-2-only trainees) is untouched", () => {
  const nav = readSource("./trainee-nav-visibility.ts");
  const list = nav.slice(
    nav.indexOf("const LEVEL2_ONLY_VISIBLE_NAV_IDS"),
    nav.indexOf("];", nav.indexOf("const LEVEL2_ONLY_VISIBLE_NAV_IDS")),
  );
  assert.equal(
    list.includes('"teachingPractice"'),
    false,
    "teachingPractice must stay OFF the Level-2-only allow-list, exactly like the existing 'עוד' menu entry - this task must not change permissions",
  );
});

test("no instructor or admin home surface was touched by this trainee-only addition", () => {
  // Scoped to the instructor/admin HOME shortcut files specifically (not all
  // of app/instructor - InstructorExamsSection.tsx is legitimately touched by
  // the separate general/all-view fix in this same working tree).
  const diff = spawnSync(
    "git",
    [
      "diff",
      "--name-only",
      "HEAD",
      "--",
      "app/instructor/InstructorClient.tsx",
      "app/admin",
    ],
    { cwd: fileURLToPath(new URL("../..", import.meta.url)), encoding: "utf8" },
  );
  assert.equal(diff.status, 0, "git diff failed");
  assert.equal(
    (diff.stdout ?? "").trim(),
    "",
    "this trainee-only home-shortcut addition must not touch the instructor home shortcuts file or any admin file",
  );
});
