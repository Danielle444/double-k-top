/**
 * Home-page shortcut to exams (instructor).
 *
 * InstructorClient.tsx cannot be imported in node:test (it pulls its
 * `server-only` chain), so this asserts the wiring at the source level, the
 * same convention the trainee equivalent
 * (trainee-exams-home-shortcut.contract.test.ts) and
 * trainee-materials-nav-entry.contract.test.ts use.
 *
 * Run with:
 *   npx tsx --test app/instructor/instructor-exams-home-shortcut.contract.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

test("the instructor home quick-nav grid carries an exams shortcut", () => {
  const src = readSource("./InstructorClient.tsx");
  const start = src.indexOf("const INSTRUCTOR_ACTIVITY_SHORTCUTS");
  assert.notEqual(start, -1, "INSTRUCTOR_ACTIVITY_SHORTCUTS must still exist");
  const block = src.slice(start, src.indexOf("];", start));
  assert.match(
    block,
    /\{\s*id:\s*"exams",\s*label:\s*"מבחנים"\s*\}/,
    "the home shortcuts array must include the exams shortcut, labelled מבחנים",
  );
});

test("homeShortcuts is built from the array carrying the exams entry, through the existing shared rendering", () => {
  const src = readSource("./InstructorClient.tsx");
  assert.match(
    src,
    /const homeShortcuts: \{ id: MainTabId; label: string \}\[\] = filterInstructorAttendanceNavItems\(\s*\[\.\.\.INSTRUCTOR_ACTIVITY_SHORTCUTS, \.\.\.INSTRUCTOR_INFO_SHORTCUTS\],\s*canViewAttendance\s*\)/,
    "homeShortcuts must still be composed from INSTRUCTOR_ACTIVITY_SHORTCUTS (now including exams) and INSTRUCTOR_INFO_SHORTCUTS",
  );
  // Rendered by the ONE existing shortcut-grid map/button - no second grid.
  const idx = src.indexOf("{homeShortcuts.map((action) => (");
  assert.notEqual(idx, -1, "the shared home shortcuts renderer must still exist");
});

test("the exams entry still appears in the instructor 'עוד' menu (INSTRUCTOR_MORE_ITEMS), unchanged", () => {
  const src = readSource("./InstructorClient.tsx");
  const start = src.indexOf("const INSTRUCTOR_MORE_ITEMS");
  const block = src.slice(start, src.indexOf("];", start));
  assert.match(block, /\{\s*id:\s*"exams",\s*label:\s*"מבחנים"\s*\}/);
});

test("navigating the exams shortcut still opens the existing, unwritten InstructorExamsSection", () => {
  const src = readSource("./InstructorClient.tsx");
  assert.ok(
    src.includes('{activeTab === "exams" && <InstructorExamsSection />}'),
    "the exams tab body must be unchanged - the shortcut adds navigation, not a new destination",
  );
});
