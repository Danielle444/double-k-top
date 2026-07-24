/**
 * TEMPORARY LAUNCH HOTFIX (dual Level 2) - contract tests for the "default a
 * dual-enrolled trainee viewing a Level 2 offering to BOTH groups + show a
 * temporary notice" behaviour across app/student/StudentClient.tsx and
 * app/student/ScheduleSection.tsx.
 *
 * WHY SOURCE-CONTRACT, NOT AN IMPORTED UNIT TEST
 * ----------------------------------------------
 * Neither component can be imported here: StudentClient transitively pulls in
 * "server-only" (attendance notice -> capability chain) and ScheduleSection pulls
 * in the "use server" student-schedule module, both unresolvable outside the Next
 * bundler and throwing at import in node:test. Extracting the pure classifier into
 * its own module would add a THIRD production file, which this hotfix's scope
 * forbids. So - exactly like trainee-client-course-selection.contract.test.ts -
 * these lock the behaviour by asserting the components' SOURCE, the sanctioned
 * pattern for these components in this codebase.
 *
 * Run with:
 *   npx tsx --test app/student/dual-level2-both-groups.contract.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

const CLIENT = readSource("./StudentClient.tsx");
const SECTION = readSource("./ScheduleSection.tsx");

/** Isolate the isDualTraineeViewingLevel2 helper body from the client source. */
function classifierBody(): string {
  const start = CLIENT.indexOf("export function isDualTraineeViewingLevel2");
  assert.notEqual(start, -1, "expected the isDualTraineeViewingLevel2 helper");
  // The next top-level export after it is pickTraineeCourseSelection.
  const end = CLIENT.indexOf("export function pickTraineeCourseSelection");
  assert.ok(end > start, "expected pickTraineeCourseSelection after the classifier");
  return CLIENT.slice(start, end);
}

// ---------------------------------------------------------------------------
// (1) dual trainee + Level 2 defaults groupFilter to "both".
// ---------------------------------------------------------------------------

test("dual + Level 2 is classified true, and true means the group filter defaults to both", () => {
  const body = classifierBody();
  // "dual" == two or more eligible options; the selected option must be Level 2.
  assert.match(body, /options\.length\s*<\s*2\)\s*return\s*false;/, "fewer than two options is never dual");
  assert.match(
    body,
    /return\s+selected\s*!==\s*undefined\s*&&\s*selected\.level\s*===\s*2;/,
    "dual is true only when the SELECTED option's server level is 2",
  );
  // The flag drives ScheduleSection's default: dualLevel2 -> "both".
  assert.ok(
    SECTION.includes('useState<GroupFilter>(dualLevel2 ? "both" : "mine")'),
    "the initial group filter must be both when dualLevel2 is true",
  );
  assert.ok(
    SECTION.includes('setGroupFilter(dualLevel2 ? "both" : "mine");'),
    "the re-apply effect must set both when dualLevel2 is true",
  );
});

// ---------------------------------------------------------------------------
// (2) dual trainee + Level 1 keeps existing behavior (default "mine").
// ---------------------------------------------------------------------------

test("a Level 1 selection is not dual-Level-2, so the default stays mine", () => {
  const body = classifierBody();
  // A non-2 level fails the `=== 2` guard -> false -> the "mine" branch is used.
  assert.ok(!/selected\.level\s*===\s*1/.test(body), "the classifier must not special-case level 1");
  assert.ok(
    SECTION.includes('setGroupFilter(dualLevel2 ? "both" : "mine");'),
    "when the flag is false (Level 1) the default reverts to mine",
  );
  // The effect keys on the flag alone, so flipping Level 2 -> Level 1 re-applies mine.
  assert.match(SECTION, /\}, \[dualLevel2\]\);/, "the default re-applies whenever the dual-Level-2 flag changes");
});

// ---------------------------------------------------------------------------
// (3) single-course Level 1 remains unchanged.
// ---------------------------------------------------------------------------

test("a single course is never classified dual, and the prop defaults false", () => {
  const body = classifierBody();
  assert.match(body, /options\.length\s*<\s*2\)\s*return\s*false;/, "one option -> not dual");
  // The prop defaults to false, so every mount that omits it (and every
  // single-course/Level-1 view) keeps the ordinary "mine" behaviour.
  assert.ok(SECTION.includes("dualLevel2 = false,"), "dualLevel2 must default to false");
});

// ---------------------------------------------------------------------------
// (4) Level-2-only trainee is not incorrectly classified as dual.
// ---------------------------------------------------------------------------

test("a Level-2-only trainee (one option) is not classified as dual", () => {
  const body = classifierBody();
  // Classification requires TWO+ options; a lone Level 2 option returns false at
  // the length guard before `level === 2` is ever consulted.
  assert.match(body, /if\s*\(options\.length\s*<\s*2\)\s*return\s*false;/, "the count guard precedes the level check");
  const lengthIdx = body.indexOf("options.length < 2");
  const levelIdx = body.indexOf("selected.level === 2");
  assert.ok(lengthIdx !== -1 && levelIdx !== -1 && lengthIdx < levelIdx, "the count guard must come first");
});

// ---------------------------------------------------------------------------
// (5) notice appears only for dual + Level 2.
// ---------------------------------------------------------------------------

test("the temporary notice renders only under the dualLevel2 flag, with the exact text", () => {
  assert.ok(
    SECTION.includes(
      "לתשומת לב: הלו״ז מוצג כרגע בשתי הקבוצות וללא סינון לפי משולב.",
    ),
    "expected the exact temporary launch-guidance notice text",
  );
  // The only render guard for that notice is the dualLevel2 flag.
  const noticeIdx = SECTION.indexOf("לתשומת לב:");
  const guardIdx = SECTION.lastIndexOf("{dualLevel2 && (", noticeIdx);
  assert.ok(guardIdx !== -1 && guardIdx < noticeIdx, "the notice must be gated on {dualLevel2 && (");
  // It must NOT claim the combined/משולב filter is active - it says the opposite.
  assert.ok(SECTION.includes("וללא סינון לפי משולב"), "the notice must state the combined filter is NOT applied");
});

test("the flag itself is derived from server-returned option metadata only", () => {
  assert.ok(
    CLIENT.includes("isDualTraineeViewingLevel2(") &&
      CLIENT.includes("courseOptions ?? []") &&
      CLIENT.includes("selectedCourseOfferingId,"),
    "the flag must come from the server course options + current selection, not a hardcoded id",
  );
  // No hardcoded cuid offering id and no Level 1/2 id constant anywhere in either file.
  for (const src of [CLIENT, SECTION]) {
    assert.ok(!/["']c[a-z0-9]{24,}["']/.test(src), "no hardcoded cuid offering id");
    assert.ok(!src.includes("LEVEL_2_COURSE_OFFERING_ID"), "no baked-in Level 2 offering id");
  }
});

// ---------------------------------------------------------------------------
// (6) manual group-filter controls still work.
// ---------------------------------------------------------------------------

test("the manual mine/both toggle buttons remain and still set the filter directly", () => {
  assert.ok(SECTION.includes('onClick={() => setGroupFilter("mine")}'), "the 'mine' button must remain");
  assert.ok(SECTION.includes('onClick={() => setGroupFilter("both")}'), "the 'both' button must remain");
  // The re-apply effect keys ONLY on the flag, so a manual toggle (flag unchanged)
  // is never overwritten by the effect.
  assert.match(SECTION, /\}, \[dualLevel2\]\);/, "the effect must not re-run on a manual toggle");
});

// ---------------------------------------------------------------------------
// (7) no schedule items are filtered by combinedParticipation.
// ---------------------------------------------------------------------------

test("no client-side combinedParticipation filtering is introduced", () => {
  // The word may appear in explanatory prose, but no combinedParticipation VALUE
  // may be read, called, or used to filter items in either client file.
  for (const src of [CLIENT, SECTION]) {
    assert.ok(!/\.combinedParticipation/.test(src), "no combinedParticipation property access");
    assert.ok(!/combinedParticipation\s*[:(]/.test(src), "no combinedParticipation field/call use");
  }
  // The server read keeps its exact pre-existing 5-argument shape - groupFilter is
  // still forwarded straight through, with no extra item filtering added around it.
  assert.ok(
    SECTION.includes(
      "getScheduleForStudent(studentId, weeklyScheduleId, dayFilter, groupFilter, courseOfferingId)",
    ),
    "the schedule read signature must be unchanged (no new filtering argument)",
  );
  // "both" still renders every item - no client-side item filter guards the grid.
  assert.ok(!/items\.filter\(/.test(SECTION), "the schedule must not filter items client-side");
});

// ---------------------------------------------------------------------------
// (8) no server / shared resolver change: the fix is client-render only.
// ---------------------------------------------------------------------------

test("both mounts forward the flag and the change stays inside the two client files", () => {
  const mounts = CLIENT.match(/dualLevel2=\{dualLevel2ScheduleView\}/g) ?? [];
  assert.equal(mounts.length, 2, "both ScheduleSection mounts must receive the flag");
  // The client still only calls the existing server actions - no new server action,
  // resolver, or capability is referenced by this hotfix.
  assert.ok(
    !CLIENT.includes("listTraineeCourseOptions(") || CLIENT.includes("listTraineeCourseOptions()"),
    "no new argument is threaded into the course-options resolver",
  );
  // The classifier is a pure client function - it reads no server module.
  const body = classifierBody();
  assert.ok(!/await|async|prisma|fetch/i.test(body), "the classifier must be pure and synchronous");
});
