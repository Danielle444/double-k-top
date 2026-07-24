/**
 * FINAL LAUNCH HOTFIX (Issue 2) - contract tests for the trainee
 * combined-participation ("משולב") card badge.
 *
 * DISPLAY-ONLY. This slice adds combinedParticipation to the TRAINEE schedule
 * projection/result and renders a badge on the trainee card. It must add NO
 * visibility filtering (Slice 2 is out of scope), hide no item, and leave the
 * instructor/admin readers untouched.
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
// (8) No item is filtered or hidden by combinedParticipation.
// ---------------------------------------------------------------------------

test("the reader's item filter never consults combinedParticipation", () => {
  const fn = readerFunction();
  // Isolate the single item-filter predicate and prove it only ever tests the
  // group filter and the day key - never the new field.
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
// (9)(10) No Slice-2 filtering, no dual-enrollment query, reader path intact.
// ---------------------------------------------------------------------------

test("no combinedParticipation visibility filtering or new dual-enrollment query is added", () => {
  const fn = readerFunction();
  // The field is READ exactly once, as the verbatim projection value; it never
  // appears in a where-clause, an early return, or a filter predicate.
  assert.equal(
    (fn.match(/i\.combinedParticipation/g) ?? []).length,
    1,
    "combinedParticipation is read exactly once (the projection value)",
  );
  assert.ok(!/where:\s*\{[^}]*combinedParticipation/.test(fn), "combinedParticipation is never a query filter");
  // The gate/authorization wiring is unchanged - still the S1A course-scoped path,
  // so Level 1 loading is unaffected.
  assert.ok(
    fn.includes("authorizeTraineeWeekReadWithDeps(weeklyScheduleId, {"),
    "the course-scoped authorization gate is untouched",
  );
  assert.ok(
    fn.includes("resolveTraineeSelectedCourseOffering(requestedCourseOfferingId)"),
    "the offering resolver wiring is untouched",
  );
});
