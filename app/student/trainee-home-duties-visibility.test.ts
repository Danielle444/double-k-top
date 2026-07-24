/**
 * LEVEL 2 UI CLEANUP - the home ("today") DutiesSection card must be hidden for a
 * Level-2-only trainee, reusing the SAME rule that already filters the nav /
 * quick-action entries (isLevel2OnlyTrainee) rather than a second Level 2
 * detector. Level-1-only and dual trainees must be unaffected.
 *
 * StudentClient.tsx cannot be imported in node:test (it pulls its `server-only`
 * chain - see trainee-nav-visibility.ts), so this asserts the wiring at the
 * source level, the same convention contacts.instructor-directory.test.ts uses.
 * The behavioural contract of the rule itself lives in
 * trainee-nav-visibility.test.ts.
 *
 * Run with:
 *   npx tsx --test app/student/trainee-home-duties-visibility.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

test("StudentClient gates the home DutiesSection card with isLevel2OnlyTrainee", () => {
  const src = readSource("./StudentClient.tsx");
  const idx = src.indexOf("<DutiesSection");
  assert.ok(idx >= 0, "the home DutiesSection card must still exist");

  // The DutiesSection mount must be inside a `!isLevel2OnlyTrainee(...)` guard.
  const before = src.slice(Math.max(0, idx - 220), idx);
  assert.match(before, /!isLevel2OnlyTrainee\(eligibleCourseOptions\)\s*&&/);
});

test("isLevel2OnlyTrainee is imported from the existing shared nav-visibility rule (no new detector)", () => {
  const src = readSource("./StudentClient.tsx");
  assert.match(
    src,
    /import\s*\{[^}]*isLevel2OnlyTrainee[^}]*\}\s*from\s*"@\/app\/student\/trainee-nav-visibility"/,
  );
});
