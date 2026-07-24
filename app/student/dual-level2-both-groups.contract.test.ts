/**
 * TEMPORARY LAUNCH HOTFIX (Level 2 group view) - contract tests for the trainee
 * schedule group-filter behaviour on a Level 2 offering, across
 * app/student/StudentClient.tsx and app/student/ScheduleSection.tsx.
 *
 * Business rule locked here:
 *  - ANY trainee viewing a Level 2 offering defaults the group filter to "both"
 *    and does not auto-revert to "mine" while Level 2 stays selected.
 *  - A Level-2-ONLY trainee (Level 2 is their sole eligible course) has the
 *    mine/both controls HIDDEN and sees the full "both" schedule.
 *  - A DUAL trainee viewing Level 2 keeps the manual controls visible.
 *  - Every Level 1 view is unchanged: default "mine", controls shown.
 *  - NO trainee-facing notice/banner about the internal combinedParticipation
 *    implementation is shown.
 *
 * WHY SOURCE-CONTRACT: neither component can be imported here (StudentClient pulls
 * in "server-only"; ScheduleSection pulls in the "use server" student-schedule
 * module), so - like trainee-client-course-selection.contract.test.ts - these lock
 * the behaviour by asserting the components' SOURCE.
 *
 * Run with:
 *   npx tsx --test app/student/dual-level2-both-groups.contract.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

const CLIENT = readSource("./StudentClient.tsx");
const SECTION = readSource("./ScheduleSection.tsx");
const SELECTOR = readSource("./TraineeCourseSelector.tsx");

/** Isolate the isSelectedOfferingLevel2 helper body from the client source. */
function classifierBody(): string {
  const start = CLIENT.indexOf("export function isSelectedOfferingLevel2");
  assert.notEqual(start, -1, "expected the isSelectedOfferingLevel2 helper");
  const end = CLIENT.indexOf("export function pickTraineeCourseSelection");
  assert.ok(end > start, "expected pickTraineeCourseSelection after the classifier");
  return CLIENT.slice(start, end);
}

// ---------------------------------------------------------------------------
// The classifier: "is the SELECTED course Level 2", from server metadata only.
// ---------------------------------------------------------------------------

test("viewingLevel2 is true only when the selected option's server level is 2", () => {
  const body = classifierBody();
  assert.match(body, /const selected = options\.find\(\(o\) => o\.id === selectedId\);/, "selection by id");
  assert.match(body, /return selected !== undefined && selected\.level === 2;/, "level 2 check on the selected option");
  // It is NOT gated on the option COUNT (any Level 2 view qualifies, dual or not).
  assert.ok(!/options\.length/.test(body), "the level check must be independent of the option count");
});

test("the flag is derived from server option metadata, never a hardcoded id/level", () => {
  assert.ok(CLIENT.includes("const eligibleCourseOptions = courseOptions ?? [];"), "reads the server options list");
  assert.ok(
    CLIENT.includes("const viewingLevel2 = isSelectedOfferingLevel2(eligibleCourseOptions, selectedCourseOfferingId);"),
    "viewingLevel2 comes from the selected server option",
  );
  assert.ok(
    CLIENT.includes("const dualEnrolled = eligibleCourseOptions.length >= 2;"),
    "dualEnrolled is the eligible-option count",
  );
  for (const src of [CLIENT, SECTION]) {
    assert.ok(!/["']c[a-z0-9]{24,}["']/.test(src), "no hardcoded cuid offering id");
    assert.ok(!/\.level\s*===\s*1/.test(src), "must not special-case level 1");
  }
});

// ---------------------------------------------------------------------------
// (proof) one eligible Level 2 -> auto-selected, groupFilter="both", controls hidden.
// ---------------------------------------------------------------------------

test("a Level 2 view defaults the group filter to both and re-applies on flag change", () => {
  assert.ok(
    SECTION.includes('useState<GroupFilter>(viewingLevel2 ? "both" : "mine")'),
    "initial group filter is both on a Level 2 view",
  );
  assert.ok(SECTION.includes('setGroupFilter(viewingLevel2 ? "both" : "mine");'), "the effect re-applies the default");
  assert.match(SECTION, /\}, \[viewingLevel2\]\);/, "the default re-applies only when the Level 2 flag changes");
});

test("a Level-2-only view (Level 2 and not dual) hides the mine/both controls", () => {
  assert.ok(
    SECTION.includes("const showGroupControls = !(viewingLevel2 && !dualEnrolled);"),
    "controls are hidden exactly for a Level-2-only view",
  );
  assert.ok(SECTION.includes("{showGroupControls && ("), "the controls block is gated on showGroupControls");
  // A single eligible course auto-selects upstream (unchanged pickTraineeCourseSelection),
  // and the selector itself renders nothing for one course.
  assert.ok(CLIENT.includes("if (options.length === 1) return options[0].id;"), "one course auto-selects");
  assert.ok(SELECTOR.includes("if (options.length <= 1) return null;"), "the selector hides for a single course");
});

// ---------------------------------------------------------------------------
// (proof) dual + selected Level 2 -> groupFilter="both", controls shown.
// ---------------------------------------------------------------------------

test("a dual Level 2 view keeps the manual controls (showGroupControls stays true)", () => {
  // showGroupControls = !(viewingLevel2 && !dualEnrolled); dualEnrolled=true makes
  // the inner term false, so controls are shown.
  assert.ok(SECTION.includes('onClick={() => setGroupFilter("mine")}'), "the 'mine' control remains");
  assert.ok(SECTION.includes('onClick={() => setGroupFilter("both")}'), "the 'both' control remains");
});

// ---------------------------------------------------------------------------
// (proof) selected Level 1 -> groupFilter="mine", controls unchanged.
// ---------------------------------------------------------------------------

test("a Level 1 view keeps mine as the default and keeps its controls", () => {
  // viewingLevel2 is false for Level 1, so the default is mine and
  // showGroupControls = !(false && ...) = true.
  assert.ok(SECTION.includes('setGroupFilter(viewingLevel2 ? "both" : "mine");'), "false flag -> mine default");
  assert.ok(SECTION.includes("const showGroupControls = !(viewingLevel2 && !dualEnrolled);"), "controls shown on Level 1");
  // The props default false, so any mount omitting them keeps Level 1 behaviour.
  assert.ok(SECTION.includes("viewingLevel2 = false,"), "viewingLevel2 defaults false");
  assert.ok(SECTION.includes("dualEnrolled = false,"), "dualEnrolled defaults false");
});

// ---------------------------------------------------------------------------
// (proof) both mounts forward BOTH flags -> one shared selected-course state.
// ---------------------------------------------------------------------------

test("both ScheduleSection mounts forward the same server-derived flags", () => {
  assert.equal((CLIENT.match(/viewingLevel2=\{viewingLevel2\}/g) ?? []).length, 2, "both mounts pass viewingLevel2");
  assert.equal((CLIENT.match(/dualEnrolled=\{dualEnrolled\}/g) ?? []).length, 2, "both mounts pass dualEnrolled");
  // No duplicate selected-course state: one selection setter feeds every consumer,
  // and the group-filter state lives only inside ScheduleSection, not the client.
  assert.ok(
    CLIENT.includes("const [selectedCourseOfferingId, setSelectedCourseOfferingId] = useState<string | null>(null);"),
    "exactly one selected-course state, owned by the client",
  );
  assert.ok(!CLIENT.includes("useState<GroupFilter>"), "the client owns no duplicate group-filter state");
});

// ---------------------------------------------------------------------------
// (proof) the internal-implementation notice/banner is removed entirely.
// ---------------------------------------------------------------------------

test("no combinedParticipation notice or replacement banner is shown to trainees", () => {
  for (const src of [CLIENT, SECTION]) {
    assert.ok(!src.includes("לתשומת לב: הלו״ז מוצג כרגע בשתי הקבוצות וללא סינון לפי משולב."), "the old notice is gone");
    assert.ok(!src.includes("וללא סינון לפי משולב"), "no residual combined-implementation guidance");
  }
});

// ---------------------------------------------------------------------------
// (proof) no client-side item filtering by combinedParticipation.
// ---------------------------------------------------------------------------

test("no client-side item filtering is introduced", () => {
  // combinedParticipation may be READ for display, but never used to filter items.
  for (const src of [CLIENT, SECTION]) {
    assert.ok(!/filter\([^)]*combinedParticipation/.test(src), "combinedParticipation is never a filter input");
  }
  assert.ok(!/items\.filter\(/.test(SECTION), "the schedule must not filter items client-side");
});
