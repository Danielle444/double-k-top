/**
 * SCHEDULE SESSION NOTE - contract tests for the manager-authored operational
 * note on a real ScheduleItem (e.g. "what to bring", meeting instructions).
 *
 * The persisted field is ScheduleItem.description, an existing nullable
 * free-text column already writable by managers through both admin editors
 * (see lib/actions/schedule-items.ts) and already read into
 * ScheduleItemView.description for every real item an authorized trainee can
 * see (lib/actions/student-schedule.ts). This slice ONLY adds a rendering
 * line on the trainee's real-item card and relabels the two admin textareas
 * ("הערה לסשן") - no schema change, no new server action, no reader change.
 *
 * lib/actions/schedule-items.ts and lib/actions/student-schedule.ts are
 * "use server" modules that transitively import Prisma, so this file uses the
 * repository's established SOURCE-CONTRACT pattern (same as
 * trainee-combined-participation-placeholder.contract.test.ts) instead of
 * importing them directly.
 *
 * Run with:
 *   npx tsx --test app/student/schedule-session-note.contract.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

const SECTION = readSource("./ScheduleSection.tsx");
const READER = readSource("../../lib/actions/student-schedule.ts");
const WRITER = readSource("../../lib/actions/schedule-items.ts");
const OFFERING_EDITOR = readSource(
  "../admin/courses/[courseOfferingId]/schedule/[weeklyScheduleId]/OfferingWeekEditorClient.tsx"
);
const LEGACY_EDITOR = readSource("../admin/weekly-schedule/[id]/WeeklyScheduleDetailClient.tsx");

// ---------------------------------------------------------------------------
// Write path: manager-entered notes persist through the existing action.
// ---------------------------------------------------------------------------

test("createScheduleItem and updateScheduleItem persist the description field", () => {
  assert.match(WRITER, /export async function createScheduleItem[\s\S]{0,1200}?description: input\.description \|\| null,/);
  assert.match(WRITER, /export async function updateScheduleItem[\s\S]{0,1200}?description: input\.description \|\| null,/);
});

test("the two admin editors are labelled as a session note that is shown to trainees", () => {
  assert.ok(
    OFFERING_EDITOR.includes("הערה לסשן"),
    "the offering-scoped editor's description textarea must be labelled as the trainee-facing session note",
  );
  assert.ok(
    LEGACY_EDITOR.includes("הערה לסשן"),
    "the legacy editor's description textarea must be labelled as the trainee-facing session note",
  );
});

// ---------------------------------------------------------------------------
// Reader: the note reaches ScheduleItemView for real items only.
// ---------------------------------------------------------------------------

test("ScheduleItemView.description is populated verbatim for real items", () => {
  const mapStart = READER.indexOf("const realViews: ScheduleItemView[] = items.map((i) => {");
  assert.notEqual(mapStart, -1, "expected the real-item mapper");
  const mapEnd = READER.indexOf("const placeholderViews", mapStart);
  const realMapper = READER.slice(mapStart, mapEnd);
  assert.ok(realMapper.includes("description: i.description,"), "real items must carry their own description through");
});

test("the placeholder mapper never sources description from a hidden real item", () => {
  const mapStart = READER.indexOf("hiddenPlaceholders.map((p) => (");
  const mapEnd = READER.indexOf("}));", mapStart);
  const placeholderMapper = READER.slice(mapStart, mapEnd);
  assert.ok(placeholderMapper.includes("description: p.description,"), "placeholder description must come from the fixed placeholder object, not a raw item");
  assert.ok(!/\bi\.description\b/.test(placeholderMapper), "the placeholder mapper must never read a real item's description");
});

// ---------------------------------------------------------------------------
// Trainee card: renders the note for real items, never for the placeholder,
// never blank/whitespace, labelled, line-breaks preserved, no duplication.
// ---------------------------------------------------------------------------

function placeholderBranch(): string {
  const start = SECTION.indexOf("if (item.isCombinedParticipationPlaceholder)");
  const end = SECTION.indexOf("const ridingPresentation = resolveStudentRidingPresentation(item);");
  assert.notEqual(start, -1);
  assert.ok(end > start);
  return SECTION.slice(start, end);
}

function realItemBranch(): string {
  const start = SECTION.indexOf("const ridingPresentation = resolveStudentRidingPresentation(item);");
  const end = SECTION.indexOf("function ScheduleSection(");
  assert.notEqual(start, -1);
  assert.ok(end > start);
  return SECTION.slice(start, end);
}

test("the real-item branch renders the trimmed note, labelled 'הערה לסשן', only when non-empty", () => {
  const branch = realItemBranch();
  assert.ok(branch.includes("item.description?.trim() || null"), "must trim before checking/rendering, and normalize a falsy trim to null");
  assert.ok(branch.includes("{note && ("), "a falsy trimmed note must render nothing");
  assert.ok(branch.includes("הערה לסשן"), "the note must carry the required Hebrew label");
});

test("the note preserves line breaks via the codebase's established whitespace-pre-wrap convention", () => {
  const branch = realItemBranch();
  const noteBlockStart = branch.indexOf("הערה לסשן");
  const before = branch.slice(Math.max(0, noteBlockStart - 200), noteBlockStart);
  assert.ok(before.includes("whitespace-pre-wrap"), "the note paragraph must use whitespace-pre-wrap like other free-text renders in this codebase");
});

test("the combined-participation placeholder branch is untouched by this change", () => {
  const branch = placeholderBranch();
  // The placeholder's own fixed-wording line must remain the ONLY description
  // reference in that branch - it must never gain the new labelled note block.
  assert.ok(branch.includes("{item.description}"), "the placeholder still renders its own fixed description line");
  assert.ok(!branch.includes("הערה לסשן"), "the placeholder branch must never render the session-note label");
  assert.ok(!branch.includes(".trim()"), "the placeholder branch must not gain the note's trim/guard logic");
});

test("the note is never rendered inside the placeholder branch and never duplicated in the real-item branch", () => {
  const realBranch = realItemBranch();
  const occurrences = realBranch.match(/הערה לסשן/g) ?? [];
  assert.equal(occurrences.length, 1, "the note label must render exactly once per real item");
});

test("the note block sits after location and before the riding-info block, alongside the existing content fields", () => {
  const branch = realItemBranch();
  // location/note/riding-info/complex-plan are all built once as detailsContent
  // (reused verbatim inline in full view and inside the compact details dialog) -
  // so their relative order is asserted within that single JSX block, not across
  // the whole function body (which also declares hasRidingInfo/hasComplexPlan
  // earlier, ahead of any of these render fragments).
  const detailsContentIdx = branch.indexOf("const detailsContent = (");
  assert.notEqual(detailsContentIdx, -1, "expected the shared detailsContent block");
  const jsx = branch.slice(detailsContentIdx);
  const locationIdx = jsx.indexOf("מיקום:");
  const noteIdx = jsx.indexOf("הערה לסשן");
  const ridingInfoIdx = jsx.indexOf("hasRidingInfo && item.ridingInfo");
  assert.ok(locationIdx !== -1 && noteIdx !== -1 && ridingInfoIdx !== -1);
  assert.ok(locationIdx < noteIdx, "the note renders after location");
  assert.ok(noteIdx < ridingInfoIdx, "the note renders before the riding-info block");
});
