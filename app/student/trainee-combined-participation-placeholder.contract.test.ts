/**
 * COMBINED PARTICIPATION - SLICE 2.1: contract tests for the compact
 * Level-1-time placeholder that replaces each hidden Level 2 ScheduleItem for
 * a dual-enrolled trainee.
 *
 * The pure collapsing/wording logic is proven DB-free in
 * combined-participation-visibility-core.test.ts. THIS file proves the
 * wiring: that lib/actions/student-schedule.ts builds placeholders from the
 * same pure core (never re-implementing the redaction inline), that the
 * mapped ScheduleItemView hardcodes every real-item content field to a safe
 * default, and that ScheduleSection.tsx renders the placeholder through its
 * own branch - never the riding-title/complex-plan pipeline a real item
 * goes through.
 *
 * SOURCE-CONTRACT pattern (see trainee-combined-participation-badge.contract.test.ts
 * for why): lib/actions/student-schedule.ts is "use server" and
 * ScheduleSection.tsx transitively imports it, so neither can be imported into
 * a plain `tsx --test` process here.
 *
 * Run with:
 *   npx tsx --test app/student/trainee-combined-participation-placeholder.contract.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function readSource(relative: string): string {
  // Normalise CRLF -> LF so column-0 / substring anchors below are stable on
  // Windows working trees.
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

const CORE = readSource("../../lib/course/combined-participation-visibility-core.ts");
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
// The reader builds placeholders via the pure core, from the same input the
// existing Slice 2 filter uses - never a second, ad hoc hide check.
// ---------------------------------------------------------------------------

test("the reader imports the placeholder builder from the pure core", () => {
  assert.ok(
    READER.includes(
      'buildHiddenCombinedParticipationPlaceholders,\n} from "@/lib/course/combined-participation-visibility-core";'
    ) || READER.includes("buildHiddenCombinedParticipationPlaceholders"),
    "expected the reader to import buildHiddenCombinedParticipationPlaceholders from the pure core"
  );
});

test("the reader builds hidden placeholders from the same group/day-filtered list the visibility filter uses", () => {
  const fn = readerFunction();
  assert.ok(
    fn.includes("buildHiddenCombinedParticipationPlaceholders(groupFilteredItems,"),
    "the placeholder builder must run over groupFilteredItems - the exact same input as filterTraineeScheduleItemsForCombinedParticipation"
  );
});

test("a placeholder view-model hardcodes every real-item content field to a safe default, never sourced from a hidden item", () => {
  const fn = readerFunction();
  const mapStart = fn.indexOf("hiddenPlaceholders.map((p) => (");
  assert.notEqual(mapStart, -1, "expected the placeholder mapping step");
  const mapEnd = fn.indexOf("}));", mapStart);
  assert.ok(mapEnd > mapStart, "expected the placeholder mapper to close");
  const mapper = fn.slice(mapStart, mapEnd);
  assert.ok(mapper.includes("groupName: null"), "placeholder must never carry a hidden item's group - fixed to null");
  assert.ok(!mapper.includes("p.groupName"), "the placeholder object from the pure core has no groupName to copy - the mapper must never read one");
  assert.ok(mapper.includes("instructorName: null"), "placeholder must never carry an instructor name");
  assert.ok(mapper.includes("location: null"), "placeholder must never carry a location");
  assert.ok(mapper.includes("ridingInfo: null"), "placeholder must never carry riding info");
  assert.ok(mapper.includes("publishedComplexRidingPlan: null"), "placeholder must never carry a complex riding plan");
  assert.ok(mapper.includes("combinedParticipation: null"), "placeholder must never carry the real tri-state badge value");
  assert.ok(mapper.includes("isCombinedParticipationPlaceholder: true"), "placeholder must be flagged for the client");
  assert.ok(
    !/\bi\./.test(mapper),
    "the placeholder mapper must never read a raw ScheduleItem field (it maps from the placeholder object `p`, not `i`)"
  );
});

test("the pure core's placeholder shape carries no groupName field", () => {
  const shapeStart = CORE.indexOf("export interface CombinedParticipationHiddenPlaceholder");
  assert.notEqual(shapeStart, -1, "expected the placeholder interface");
  const shapeEnd = CORE.indexOf("}", shapeStart);
  const shape = CORE.slice(shapeStart, shapeEnd);
  assert.ok(!shape.includes("groupName"), "the placeholder interface must not declare a groupName field");
});

test("the placeholder builder buckets by day only, never by group - merging must not depend on the hidden item's group", () => {
  const buildFnStart = CORE.indexOf("export function buildHiddenCombinedParticipationPlaceholders");
  assert.notEqual(buildFnStart, -1);
  const buildFn = CORE.slice(buildFnStart);
  assert.ok(buildFn.includes("const bucketKey = dateKey(item.date);"), "the bucket key must be the date only, not date+group");
  assert.ok(!/groupName/.test(buildFn), "the builder itself must never reference groupName");
});

test("real items are explicitly flagged as non-placeholder", () => {
  const fn = readerFunction();
  assert.ok(fn.includes("isCombinedParticipationPlaceholder: false,"), "every real item view must set the discriminant to false");
});

test("ScheduleItemView exposes the placeholder discriminant as a required boolean", () => {
  assert.match(READER, /isCombinedParticipationPlaceholder:\s*boolean;/);
});

// ---------------------------------------------------------------------------
// The pure core never sources the fixed wording from a source item's fields.
// ---------------------------------------------------------------------------

test("the core placeholder builder assigns title/description ONLY from the fixed constants", () => {
  const buildFnStart = CORE.indexOf("export function buildHiddenCombinedParticipationPlaceholders");
  assert.notEqual(buildFnStart, -1, "expected buildHiddenCombinedParticipationPlaceholders");
  const buildFn = CORE.slice(buildFnStart);
  assert.ok(buildFn.includes("title: COMBINED_PARTICIPATION_PLACEHOLDER_TITLE,"));
  assert.ok(buildFn.includes("description: COMBINED_PARTICIPATION_PLACEHOLDER_DESCRIPTION,"));
});

// ---------------------------------------------------------------------------
// The trainee card renders the placeholder through its own compact branch,
// before the riding-title/complex-plan pipeline a real item goes through.
// ---------------------------------------------------------------------------

test("the trainee card branches on the placeholder discriminant BEFORE computing riding presentation", () => {
  const branchIdx = SECTION.indexOf("if (item.isCombinedParticipationPlaceholder)");
  const ridingPresentationIdx = SECTION.indexOf("const ridingPresentation = resolveStudentRidingPresentation(item);");
  assert.notEqual(branchIdx, -1, "expected the placeholder branch");
  assert.notEqual(ridingPresentationIdx, -1, "expected the riding presentation computation");
  assert.ok(branchIdx < ridingPresentationIdx, "the placeholder branch must return before the riding-title pipeline runs");
});

test("the placeholder branch renders both fixed lines and nothing from a real item's fields", () => {
  const branchIdx = SECTION.indexOf("if (item.isCombinedParticipationPlaceholder)");
  const ridingPresentationIdx = SECTION.indexOf("const ridingPresentation = resolveStudentRidingPresentation(item);");
  const branch = SECTION.slice(branchIdx, ridingPresentationIdx);
  assert.ok(branch.includes("{item.title}"), "expected the title line to render");
  assert.ok(branch.includes("{item.description}"), "expected the description line to render");
  assert.ok(
    !branch.includes("item.location") && !branch.includes("item.ridingInfo") && !branch.includes("item.publishedComplexRidingPlan"),
    "the placeholder branch must not render any real-item-only field"
  );
});
