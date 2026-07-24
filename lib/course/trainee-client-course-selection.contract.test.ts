/**
 * SINGLE-COURSE TRAINEE LOADING HOTFIX - contract tests for the trainee course
 * SELECTION + async-robustness behaviour in app/student/StudentClient.tsx.
 *
 * WHY SOURCE-CONTRACT, NOT AN IMPORTED UNIT TEST
 * ----------------------------------------------
 * StudentClient.tsx cannot be imported here: it transitively pulls in
 * "server-only" (via the attendance notice -> current-attendance-capability
 * chain), which is unresolvable outside the Next bundler and throws at import in
 * node:test. Extracting the pure decision into its own module would add a NEW
 * production file, which this hotfix's scope forbids. So - exactly like the
 * existing StudentClient checks in trainee-course-selection-core.test.ts - these
 * lock the behaviour by asserting the component's SOURCE, which is the sanctioned
 * pattern for this component in this codebase.
 *
 * Run with:
 *   npx tsx --test lib/course/trainee-client-course-selection.contract.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

const SRC = readSource("../../app/student/StudentClient.tsx");

/** Isolate the pickTraineeCourseSelection function body from the source. */
function selectionHelperBody(): string {
  const start = SRC.indexOf("export function pickTraineeCourseSelection");
  assert.notEqual(start, -1, "expected the pickTraineeCourseSelection helper");
  // The next top-level `export function` is StudentClient itself.
  const end = SRC.indexOf("export function StudentClient");
  assert.ok(end > start, "expected StudentClient after the helper");
  return SRC.slice(start, end);
}

/** Isolate the course-options effect (the listTraineeCourseOptions load). */
function optionsEffectBody(): string {
  const start = SRC.indexOf("listTraineeCourseOptions()");
  assert.notEqual(start, -1, "expected the listTraineeCourseOptions load");
  // End at the schedule effect's unique call form (not the top-of-file import).
  const end = SRC.indexOf("getWeeklyScheduleSelectionForTrainee(selectedCourseOfferingId)");
  assert.ok(end > start, "expected the schedule effect after the options effect");
  return SRC.slice(start, end);
}

/** Isolate the weekly-schedule effect (the getWeeklyScheduleSelectionForTrainee load). */
function scheduleEffectBody(): string {
  // The reference inside the schedule effect - not the import at the top.
  const call = SRC.indexOf("getWeeklyScheduleSelectionForTrainee(selectedCourseOfferingId)");
  assert.notEqual(call, -1, "expected the schedule load call");
  // Grab a generous window that covers the .then and .catch of this effect.
  return SRC.slice(call, call + 1400);
}

// ---------------------------------------------------------------------------
// (1)(2)(3)(4) Selection cardinality: 1 auto-selects, 2+ never auto-picks,
// a valid prior selection is preserved, an invalid one resets to null.
// ---------------------------------------------------------------------------

test("exactly one option auto-selects that exact server-returned id", () => {
  const body = selectionHelperBody();
  assert.match(
    body,
    /if\s*\(\s*options\.length\s*===\s*1\s*\)\s*return\s*options\[0\]\.id;/,
    "a single option must auto-select options[0].id",
  );
});

test("two-or-more options never auto-pick a course (no options[0] fallback)", () => {
  const body = selectionHelperBody();
  // options[0] may appear ONLY in the length===1 branch. Any second occurrence
  // would be a first-row fallback for the multi-course case, which is forbidden.
  const occurrences = body.match(/options\[0\]/g) ?? [];
  assert.equal(occurrences.length, 1, "options[0] must be used only for the single-course case");
  assert.match(
    body,
    /if\s*\(\s*options\.length\s*>\s*1\s*\)/,
    "there must be an explicit two-or-more branch",
  );
});

test("an existing valid selection is preserved and an invalid one resets to null", () => {
  const body = selectionHelperBody();
  assert.match(
    body,
    /previous\s*!==\s*null\s*&&\s*options\.some\(\(o\)\s*=>\s*o\.id\s*===\s*previous\)\s*\?\s*previous\s*:\s*null/,
    "the multi-course branch must keep a still-valid previous, else null",
  );
});

test("zero options selects null", () => {
  const body = selectionHelperBody();
  // The final fall-through (0 options) returns null.
  assert.match(body, /return\s*null;\s*}\s*$/, "zero options must fall through to null");
});

// ---------------------------------------------------------------------------
// (5)(6) Options load always ends loading: success sets a non-null list;
// a non-denial rejection falls back to [] + null instead of staying null.
// ---------------------------------------------------------------------------

test("the options effect uses the pure selection helper and never a raw options[0]", () => {
  const body = optionsEffectBody();
  assert.ok(
    body.includes("pickTraineeCourseSelection(previous, options)"),
    "the options effect must delegate selection to the pure helper",
  );
  assert.ok(!body.includes("options[0]"), "the effect must not reach for options[0] itself");
});

test("an options-load rejection ends loading (courseOptions=[], selection=null)", () => {
  const body = optionsEffectBody();
  assert.match(body, /\.catch\(\s*\(\s*\)\s*=>\s*{/, "the options load must have a catch");
  assert.ok(body.includes("setCourseOptions([])"), "rejection must set courseOptions to []");
  assert.ok(
    body.includes("setSelectedCourseOfferingId(null)"),
    "rejection must clear the selection to null",
  );
  // Guard against a state write after unmount / stale run.
  assert.ok(body.includes("if (cancelled) return;"), "the catch must respect the cancelled guard");
});

// ---------------------------------------------------------------------------
// (7)(8) Schedule load always ends loading, and a rejection clears the stale
// week so nothing older is shown and no permanent "טוען..." persists.
// ---------------------------------------------------------------------------

test("a schedule-load rejection ends loading and clears the stale week", () => {
  const body = scheduleEffectBody();
  assert.match(body, /\.catch\(\s*\(\s*\)\s*=>\s*{/, "the schedule load must have a catch");
  assert.ok(body.includes("setScheduleLoadError(true)"), "rejection must flag the error state");
  assert.ok(body.includes("setWeeks([])"), "rejection must clear weeks to [] (never leave null)");
  assert.ok(body.includes("setSelectedWeekId(null)"), "rejection must clear the stale week id");
});

test("the schedule error surfaces a contained Hebrew message, not a raw error", () => {
  assert.ok(
    SRC.includes('const SCHEDULE_LOAD_ERROR_MESSAGE = "לא ניתן לטעון כרגע את הלו״ז. נסו לרענן את העמוד."'),
    "expected the contained Hebrew schedule-error message",
  );
  // It is rendered in place of the schedule content in both schedule surfaces.
  const renders = SRC.match(/\{SCHEDULE_LOAD_ERROR_MESSAGE\}/g) ?? [];
  assert.ok(renders.length >= 2, "the message must render on both the home and schedule tabs");
  // The message is a constant, never string-built from a server error object.
  assert.ok(!/error[^)]*\.message/i.test(SRC), "no raw server error message may be rendered");
});

// ---------------------------------------------------------------------------
// (9) Stale-response protection: a superseded request cannot overwrite a newer
// course selection.
// ---------------------------------------------------------------------------

test("the schedule effect is race-guarded against stale responses", () => {
  const body = scheduleEffectBody();
  // Both the resolve and the reject paths must bail when superseded.
  const guards = body.match(/if \(cancelled\) return;/g) ?? [];
  assert.ok(guards.length >= 2, "both .then and .catch must honour the cancelled guard");
  // The effect re-runs on selection change (so the previous run's cleanup fires).
  assert.ok(
    /\}, \[session, courseOptions, selectedCourseOfferingId\]\);/.test(SRC),
    "the schedule effect must depend on selectedCourseOfferingId",
  );
  // A pending schedule request cleanup must set cancelled so a late response is dropped.
  assert.ok(body.includes("cancelled = true;"), "the effect cleanup must set cancelled");
});

test("two-or-more courses with no selection issue NO schedule request", () => {
  // The awaiting-selection guard returns before getWeeklyScheduleSelectionForTrainee.
  assert.ok(
    SRC.includes("selectedCourseOfferingId === null && courseOptions.length > 1"),
    "expected the await-explicit-selection guard for the multi-course case",
  );
  const guardIdx = SRC.indexOf("selectedCourseOfferingId === null && courseOptions.length > 1");
  const callIdx = SRC.indexOf("getWeeklyScheduleSelectionForTrainee(selectedCourseOfferingId)");
  assert.ok(guardIdx !== -1 && callIdx !== -1 && guardIdx < callIdx, "the guard must precede the request");
  // Inside the guard it clears to a non-null empty selection (no permanent spinner).
  const guardBlock = SRC.slice(guardIdx, callIdx);
  assert.ok(guardBlock.includes("setWeeks([])"), "awaiting selection must clear weeks to [] not null");
  assert.ok(guardBlock.includes("return;"), "awaiting selection must return before requesting");
});

// ---------------------------------------------------------------------------
// (10) No Level 1 / Level 2 id (or any offering id / level constant) is baked in.
// ---------------------------------------------------------------------------

test("no course offering id or level constant is hardcoded in the client", () => {
  // No cuid-shaped literal (offering ids are cuids like cmr...).
  assert.ok(!/["']c[a-z0-9]{24,}["']/.test(SRC), "no hardcoded cuid offering id");
  for (const forbidden of [
    "LEVEL_1_COURSE_OFFERING_ID",
    "LEVEL_2_COURSE_OFFERING_ID",
    "temporary-level2-compatibility",
  ]) {
    assert.ok(!SRC.includes(forbidden), `the client must not reference ${forbidden}`);
  }
  // Selection must not branch on a course level either.
  assert.ok(!/\.level\s*===\s*1/.test(SRC), "selection must not be keyed on course level");
});

// ---------------------------------------------------------------------------
// (11)(12) Dual selector wiring intact + contacts still receive the selected id.
// ---------------------------------------------------------------------------

test("the dual course selector remains wired on all approved screens", () => {
  const mounts = SRC.match(/<TraineeCourseSelector/g) ?? [];
  // Three approved mount sites: home/today, schedule, and contacts. All three
  // bind to the SAME selection state, so a pick on any screen updates the others.
  assert.equal(mounts.length, 3, "exactly the three approved mount sites remain");
  const optionBindings = SRC.match(/options=\{courseOptions \?\? \[\]\}/g) ?? [];
  const selectedBindings = SRC.match(/selectedId=\{selectedCourseOfferingId\}/g) ?? [];
  const onSelectBindings = SRC.match(/onSelect=\{setSelectedCourseOfferingId\}/g) ?? [];
  assert.equal(optionBindings.length, 3, "every mount reads the shared options");
  assert.equal(selectedBindings.length, 3, "every mount reads the shared selected id");
  assert.equal(onSelectBindings.length, 3, "every mount writes the shared selection setter");
});

test("contacts continue receiving the selected offering id", () => {
  assert.ok(
    SRC.includes("traineeCourseOfferingId={selectedCourseOfferingId}"),
    "the contacts section must still forward the selected offering id",
  );
});
