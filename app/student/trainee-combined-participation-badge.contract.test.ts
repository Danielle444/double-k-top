/**
 * FINAL LAUNCH HOTFIX (Issue 2) - contract tests for the trainee
 * combined-participation ("משולב") card badge.
 *
 * DISPLAY-ONLY. This slice adds combinedParticipation to the TRAINEE schedule
 * projection/result and renders a badge on the trainee card, and leaves the
 * instructor/admin readers untouched.
 *
 * UPDATED FOR SLICE 2: visibility filtering (dual trainee + Level 2 selected +
 * combinedParticipation === false -> hidden) is now wired into
 * getScheduleForStudent. That filtering is proven DB-free against the pure
 * core in combined-participation-visibility-core.test.ts and its wiring/order
 * is proven in student-schedule.course-scope.test.ts; THIS file keeps proving
 * only what it always proved - the badge wording/rendering contract and that
 * combinedParticipation still reaches the client verbatim on every SURVIVING
 * item (the Slice 2 filter removes whole items, it never rewrites this field).
 *
 * WHY SOURCE-CONTRACT, NOT AN IMPORTED UNIT TEST
 * ----------------------------------------------
 * lib/actions/student-schedule.ts is a "use server" module (Prisma + next/cache)
 * and app/student/ScheduleSection.tsx transitively imports it, so neither can be
 * imported into a plain `tsx --test` process. This uses the repository's
 * established SOURCE-CONTRACT pattern (same as student-schedule.course-scope.test.ts).
 *
 * Run with:
 *   npx tsx --test app/student/trainee-combined-participation-badge.contract.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function readSource(relative: string): string {
  // Normalise CRLF -> LF so column-0 brace / newline anchors below are stable on
  // Windows working trees.
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

const READER = readSource("../../lib/actions/student-schedule.ts");
const SECTION = readSource("./ScheduleSection.tsx");

/** Extract getScheduleForStudent from its signature to its column-0 closing brace. */
function readerFunction(): string {
  const start = READER.indexOf("export async function getScheduleForStudent(");
  assert.notEqual(start, -1, "expected getScheduleForStudent");
  const end = READER.indexOf("\n}\n", start);
  assert.ok(end > start, "expected the function to close");
  return READER.slice(start, end);
}

// ---------------------------------------------------------------------------
// (7) getScheduleForStudent returns combinedParticipation (verbatim tri-state).
// ---------------------------------------------------------------------------

test("the trainee item view carries a boolean|null combinedParticipation field", () => {
  assert.match(
    READER,
    /combinedParticipation:\s*boolean\s*\|\s*null;/,
    "ScheduleItemView must expose combinedParticipation as boolean | null",
  );
});

test("getScheduleForStudent projects combinedParticipation verbatim from the item", () => {
  const fn = readerFunction();
  assert.ok(
    fn.includes("combinedParticipation: i.combinedParticipation,"),
    "the mapper must pass the DB tri-state straight through",
  );
});

// ---------------------------------------------------------------------------
// (8) The group/day item filter stays independent of combinedParticipation -
// SLICE 2's visibility rule is a SEPARATE step, never folded into this predicate.
// ---------------------------------------------------------------------------

test("the group/day item filter never consults combinedParticipation", () => {
  const fn = readerFunction();
  // Isolate the single group/day-filter predicate and prove it only ever tests
  // the group filter and the day key - never the combined-participation field.
  // The Slice 2 hide rule is applied afterwards, as its own separate step (see
  // the next test) - it must never be folded into this predicate.
  const filterStart = fn.indexOf("weekItems.filter((i) => {");
  assert.notEqual(filterStart, -1, "expected the item filter predicate");
  const filterEnd = fn.indexOf("});", filterStart);
  const predicate = fn.slice(filterStart, filterEnd);
  assert.ok(!predicate.includes("combinedParticipation"), "the filter must not branch on combinedParticipation");
  assert.ok(predicate.includes("groupFilter"), "the filter still keys on the group filter");
  assert.ok(predicate.includes("dayKey"), "the filter still keys on the day");
});

test("the trainee card renders no client-side item filter of any kind", () => {
  assert.ok(!/items\.filter\(/.test(SECTION), "the card must not filter items client-side");
});

// ---------------------------------------------------------------------------
// (4)(5)(6) Badge wording: false -> "ללא משולב", true -> "עם משולב", null -> none.
// ---------------------------------------------------------------------------

test("the badge label helper maps the tri-state to the exact wording", () => {
  // Pure, exhaustive mapping - null yields no badge, the two booleans yield the
  // exact business wording.
  assert.match(SECTION, /function combinedParticipationBadgeLabel\(value: boolean \| null\): string \| null/, "expected the pure label helper");
  assert.match(SECTION, /if\s*\(value === null\)\s*return null;/, "null must produce no label (no badge)");
  assert.match(
    SECTION,
    /return value \? "עם משולב" : "ללא משולב";/,
    "true -> עם משולב, false -> ללא משולב",
  );
});

test("the card renders the badge only when the label is non-null", () => {
  assert.ok(
    SECTION.includes("combinedParticipationBadgeLabel(item.combinedParticipation)"),
    "the card must derive the label from the item's tri-state",
  );
  assert.ok(
    SECTION.includes("if (combinedLabel === null) return null;"),
    "a null label must render no badge element at all",
  );
  // The wording is produced ONLY by the shared helper's single return statement -
  // the JSX renders {combinedLabel}, never a second inline copy of the strings.
  assert.equal(
    (SECTION.match(/return value \? "עם משולב" : "ללא משולב";/g) ?? []).length,
    1,
    "the exact wording lives in one place (the helper return)",
  );
});

// ---------------------------------------------------------------------------
// (9)(10) Slice 2 filtering is wired as its own step, after the group/day
// filter and before the riding-slot batch fetch; combinedParticipation still
// reaches the client verbatim on every item that survives it; the pre-existing
// authorization/resolver wiring is untouched.
// ---------------------------------------------------------------------------

test("Slice 2 filtering runs as a separate step, between the group/day filter and the riding-slot batch fetch", () => {
  const fn = readerFunction();
  assert.ok(
    fn.includes("filterTraineeScheduleItemsForCombinedParticipation(groupFilteredItems,"),
    "the Slice 2 filter must be applied to the already group/day-filtered list",
  );
  const groupDayFilter = requiredIndex(fn, "weekItems.filter((i) => {", "group/day filter");
  const slice2Filter = requiredIndex(
    fn,
    "filterTraineeScheduleItemsForCombinedParticipation(groupFilteredItems,",
    "Slice 2 filter call",
  );
  const ridingSlotBatch = requiredIndex(
    fn,
    "getPublishedComplexRidingPlansForStudentInternal(",
    "riding-slot batch fetch",
  );
  assert.ok(groupDayFilter < slice2Filter, "group/day filtering must precede the Slice 2 hide rule");
  assert.ok(slice2Filter < ridingSlotBatch, "Slice 2 filtering must precede the riding-slot batch fetch");
});

test("the dual-enrollment lookup only runs for a Level 2 selected offering, never unconditionally", () => {
  const fn = readerFunction();
  assert.match(
    fn,
    /offeringLevel === COMBINED_PARTICIPATION_HIDDEN_LEVEL\s*\n?\s*\?\s*await isTraineeDualEnrolledForSelectedOffering\(authorization\.courseOfferingId\)\s*\n?\s*:\s*false/,
    "the dual-enrollment fetch must be gated on the resolved offering's level",
  );
  // Exactly one dual-enrollment call per request - no loop over items.
  assert.equal(
    (fn.match(/isTraineeDualEnrolledForSelectedOffering\(/g) ?? []).length,
    1,
    "the dual-enrollment helper must be called at most once, never per item",
  );
});

test("combinedParticipation still reaches the client verbatim on every surviving item", () => {
  const fn = readerFunction();
  assert.equal(
    (fn.match(/i\.combinedParticipation/g) ?? []).length,
    1,
    "combinedParticipation is read exactly once (the projection value) - Slice 2 filters whole items, it never rewrites this field",
  );
  assert.ok(!/where:\s*\{[^}]*combinedParticipation/.test(fn), "combinedParticipation is never a Prisma query filter");
});

test("the pre-existing authorization/resolver wiring is untouched by Slice 2", () => {
  const fn = readerFunction();
  assert.ok(
    fn.includes("authorizeTraineeWeekReadWithDeps(weeklyScheduleId, {"),
    "the course-scoped authorization gate is untouched",
  );
  assert.ok(
    fn.includes("resolveTraineeSelectedCourseOffering(requestedCourseOfferingId)"),
    "the offering resolver wiring is untouched",
  );
});

function requiredIndex(haystack: string, needle: string, label: string): number {
  const i = haystack.indexOf(needle);
  assert.notEqual(i, -1, `${label}: expected to find \`${needle}\``);
  return i;
}
