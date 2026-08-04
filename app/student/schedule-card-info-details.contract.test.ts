/**
 * SCHEDULE CARD INFO DETAILS - contract tests for the compact/grid ("both"
 * view) card's on-demand details dialog.
 *
 * Compact cards render inside a fixed-height, duration-proportional grid
 * cell (see lib/schedule-timegrid.ts / lib/components/ScheduleTimeGrid.tsx,
 * untouched by this change) and cannot safely show every field inline for a
 * short session. Instead of clamping/truncating content into unreadable
 * fragments, a compact card that has ANY secondary detail (location, note,
 * riding info, riding assignment) shows a real, labelled info button; the
 * full detail set - the SAME authorized ScheduleItemView fields already held
 * by the card, nothing else - opens in the shared Modal component
 * (lib/components/Modal.tsx, already used elsewhere in the trainee UI, e.g.
 * StudentTeachingPracticeSection.tsx). A compact card with only the
 * essentials (time/title/badges) never gets an info button. The full
 * ("מלא") list view has no height constraint and keeps rendering every
 * field inline, exactly as before - no info button there.
 *
 * WHY SOURCE-CONTRACT, NOT AN IMPORTED UNIT TEST
 * ----------------------------------------------
 * app/student/ScheduleSection.tsx transitively imports lib/actions/student-schedule.ts,
 * a "use server" module (Prisma + next/cache), so it cannot be imported into a
 * plain `tsx --test` process. This uses the repository's established
 * SOURCE-CONTRACT pattern (see schedule-session-note.contract.test.ts).
 *
 * Run with:
 *   npx tsx --test app/student/schedule-card-info-details.contract.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

const SECTION = readSource("./ScheduleSection.tsx");

function realItemBranch(): string {
  const start = SECTION.indexOf("const ridingPresentation = resolveStudentRidingPresentation(item);");
  const end = SECTION.indexOf("function ScheduleSection(");
  assert.notEqual(start, -1);
  assert.ok(end > start);
  return SECTION.slice(start, end);
}

function placeholderBranch(): string {
  const start = SECTION.indexOf("if (item.isCombinedParticipationPlaceholder)");
  const end = SECTION.indexOf("const ridingPresentation = resolveStudentRidingPresentation(item);");
  assert.notEqual(start, -1);
  assert.ok(end > start);
  return SECTION.slice(start, end);
}

// ---------------------------------------------------------------------------
// Reuses the app's existing Modal, no new UI library.
// ---------------------------------------------------------------------------

test("the card reuses the shared Modal component, not a bespoke dialog implementation", () => {
  assert.match(SECTION, /import\s*\{\s*Modal\s*\}\s*from\s*"@\/lib\/components\/Modal";/);
  assert.ok(SECTION.includes("<Modal"), "expected the shared Modal to be rendered");
});

// ---------------------------------------------------------------------------
// Deterministic trigger rule - no DOM/height measurement.
// ---------------------------------------------------------------------------

test("hasSecondaryDetails is a deterministic boolean over already-authorized fields, not a DOM/height measurement", () => {
  const branch = realItemBranch();
  assert.ok(
    branch.includes("Boolean(location) || Boolean(note) || hasRidingInfo || hasComplexPlan"),
    "expected a pure boolean rule, not any ref/measurement-based overflow detection",
  );
  assert.ok(!/getBoundingClientRect|ResizeObserver|scrollHeight|offsetHeight/.test(SECTION), "must not use fragile DOM measurement");
});

test("the info button renders only when compact AND a secondary detail exists", () => {
  const branch = realItemBranch();
  assert.ok(
    branch.includes("{compact && hasSecondaryDetails && (") && branch.includes('aria-label="מידע נוסף על הסשן"'),
    "expected the info button gated on both compact and hasSecondaryDetails",
  );
});

test("a compact card with only basic content (no secondary details) renders no info button - hasSecondaryDetails covers exactly location/note/riding-info/complex-plan", () => {
  const branch = realItemBranch();
  const declIdx = branch.indexOf("const hasSecondaryDetails =");
  assert.notEqual(declIdx, -1);
  const decl = branch.slice(declIdx, branch.indexOf(";", declIdx) + 1);
  assert.ok(decl.includes("location"));
  assert.ok(decl.includes("note"));
  assert.ok(decl.includes("hasRidingInfo"));
  assert.ok(decl.includes("hasComplexPlan"));
});

// ---------------------------------------------------------------------------
// The details dialog contains the full authorized detail set: location,
// instructor, note, riding assignment, horse, partner.
// ---------------------------------------------------------------------------

test("detailsContent (rendered inside the dialog for compact, inline for full) includes location, note, and generic riding info (instructor/arena/subgroup)", () => {
  const branch = realItemBranch();
  const start = branch.indexOf("const detailsContent = (");
  assert.notEqual(start, -1);
  const detailsSrc = branch.slice(start, branch.indexOf("return (", start));
  assert.ok(detailsSrc.includes("מיקום: {location}"), "expected location in the shared details content");
  assert.ok(detailsSrc.includes("הערה לסשן"), "expected the session note in the shared details content");
  assert.ok(detailsSrc.includes("מאמן/ת: {item.ridingInfo.instructorName}"), "expected instructor name in the shared details content");
  assert.ok(detailsSrc.includes("מגרש: {item.ridingInfo.arena}"), "expected arena in the shared details content");
});

test("the riding assignment (horse, partner) reaches the details content via the existing ComplexRidingPlanSection - no new/duplicated data source", () => {
  const branch = realItemBranch();
  const start = branch.indexOf("const detailsContent = (");
  assert.notEqual(start, -1);
  const detailsSrc = branch.slice(start, branch.indexOf("return (", start));
  assert.ok(
    detailsSrc.includes("<ComplexRidingPlanSection"),
    "expected the existing riding-assignment component (own-assignment lines include coach/arena/partner/horse) inside detailsContent",
  );
});

test("detailsContent is built once and referenced both inline (full view) and inside the dialog (compact view) - never duplicated", () => {
  const branch = realItemBranch();
  const occurrences = branch.match(/const detailsContent = \(/g) ?? [];
  assert.equal(occurrences.length, 1, "detailsContent must be declared exactly once");
  assert.ok(branch.includes("{!compact && detailsContent}"), "expected detailsContent rendered inline for full view");
  assert.ok(branch.includes(">{detailsContent}</div>"), "expected detailsContent reused (not re-declared) inside the dialog body");
});

// ---------------------------------------------------------------------------
// Full view: unchanged, inline, no info icon.
// ---------------------------------------------------------------------------

test("full view still renders location, note, and riding info inline, with no info button gating them", () => {
  const branch = realItemBranch();
  assert.ok(branch.includes("{!compact && detailsContent}"));
  assert.ok(!/compact \?\s*"[^"]*truncate/.test(branch), "full view content must not be truncated");
  assert.ok(!/compact \?\s*"[^"]*line-clamp/.test(branch) || branch.includes("line-clamp-2"), "only the title may still clamp in compact mode");
});

test("the full/expanded list view (groupFilter !== \"both\") never passes compact, so it never shows the info button", () => {
  assert.ok(
    /<ScheduleCard\s+key=\{item\.id\}\s+item=\{item\}\s+active=\{isItemActiveNow\(item, now\)\}\s+studentId=\{studentId\}\s*\/>/.test(SECTION),
    "expected the 'mine' list view's ScheduleCard call to omit the compact prop entirely",
  );
});

// ---------------------------------------------------------------------------
// The Level-1-time placeholder never gets an info control and never reveals
// hidden Level 2 detail.
// ---------------------------------------------------------------------------

test("the placeholder branch renders no info button and no dialog", () => {
  const branch = placeholderBranch();
  assert.ok(!branch.includes("aria-label=\"מידע נוסף על הסשן\""), "the placeholder must never show an info control");
  assert.ok(!branch.includes("<Modal"), "the placeholder must never render a details dialog");
  assert.ok(!branch.includes("hasSecondaryDetails"), "the placeholder branch is untouched by the secondary-details rule");
});

test("the placeholder branch still renders only its own fixed time/title/description, nothing from item.location/ridingInfo/publishedComplexRidingPlan", () => {
  const branch = placeholderBranch();
  assert.ok(!/item\.location|item\.ridingInfo|item\.publishedComplexRidingPlan/.test(branch), "the placeholder must never reference hidden real-item fields");
});

// ---------------------------------------------------------------------------
// Accessibility.
// ---------------------------------------------------------------------------

test("the info control is a real, keyboard-accessible button with the required Hebrew aria-label", () => {
  const branch = realItemBranch();
  const btnStart = branch.indexOf("<button");
  assert.notEqual(btnStart, -1);
  const btn = branch.slice(btnStart, branch.indexOf(">", branch.indexOf("aria-label", btnStart)) + 1);
  assert.ok(btn.includes('type="button"'), "must be a real <button type=\"button\">, not a div/span with an onClick");
  assert.ok(btn.includes('aria-label="מידע נוסף על הסשן"'), "expected the required Hebrew aria-label");
});

test("the info button click does not propagate past the card", () => {
  const branch = realItemBranch();
  const btnStart = branch.indexOf("<button");
  const btnEnd = branch.indexOf("</button>", btnStart);
  const btn = branch.slice(btnStart, btnEnd);
  assert.ok(btn.includes("e.stopPropagation()"), "expected stopPropagation on the info button's click handler");
});

test("the dialog has clear close behaviour via the shared Modal's onClose contract", () => {
  const branch = realItemBranch();
  assert.ok(branch.includes("onClose={() => setShowDetails(false)}"), "expected the dialog to wire a close handler back to local state");
});

// ---------------------------------------------------------------------------
// MOBILE VIEWPORT OVERFLOW FIX - the dialog body (location/note/riding-info,
// and, when expanded, the full block->station->pair complex-riding plan) can
// grow taller than a phone viewport. It must scroll INSIDE the dialog rather
// than push the dialog itself past the screen edge.
// ---------------------------------------------------------------------------

function detailsDialogBodyMarkup(): string {
  const branch = realItemBranch();
  const modalStart = branch.indexOf("<Modal");
  assert.notEqual(modalStart, -1, "expected the details dialog's <Modal> element");
  const modalEnd = branch.indexOf("</Modal>", modalStart);
  assert.ok(modalEnd > modalStart);
  return branch.slice(modalStart, modalEnd);
}

test("the dialog body wrapper has a viewport-relative max-height (not a hardcoded pixel height)", () => {
  const body = detailsDialogBodyMarkup();
  assert.match(
    body,
    /max-h-\[\d+(?:dv|v)h\]/,
    "expected a dvh/vh-relative max-height on the dialog body wrapper, not a fixed px height",
  );
  assert.ok(!/max-h-\[\d+px\]/.test(body), "must not use a hardcoded pixel max-height");
});

test("the dialog body wrapper scrolls internally instead of letting content overflow the dialog", () => {
  const body = detailsDialogBodyMarkup();
  assert.ok(body.includes("overflow-y-auto"), "expected overflow-y-auto on the height-constrained body wrapper");
  assert.match(body, /className="[^"]*max-h-\[\d+(?:dv|v)h\][^"]*overflow-y-auto[^"]*"/, "expected the max-height and overflow-y-auto on the SAME element, so the constraint and the scroll region are the same box");
});

test("the close control (rendered by the shared Modal's header) sits outside the scrollable body - only {detailsContent} is wrapped for scrolling", () => {
  const branch = realItemBranch();
  const modalStart = branch.indexOf("<Modal");
  const childrenStart = branch.indexOf(">", branch.indexOf("title={", modalStart)) + 1;
  const childrenMarkup = branch.slice(childrenStart, branch.indexOf("</Modal>", modalStart));
  assert.ok(
    /^\s*<div className="[^"]*overflow-y-auto[^"]*">\{detailsContent\}<\/div>\s*$/.test(childrenMarkup),
    "expected the Modal's children to be exactly the scrollable wrapper around detailsContent - the close button lives in Modal's own header, outside children entirely",
  );
});

test("no content is hidden or truncated by the overflow fix - the body wrapper adds no truncate/line-clamp/hidden classes", () => {
  const body = detailsDialogBodyMarkup();
  assert.ok(!/\btruncate\b/.test(body), "the scroll wrapper must not truncate text");
  assert.ok(!/\bline-clamp-/.test(body), "the scroll wrapper must not clamp lines");
  assert.ok(!/\bhidden\b/.test(body), "the scroll wrapper must not hide content");
});

test("the overflow fix applies unconditionally (no breakpoint prefix), so mobile and desktop share the same safe, scrollable dialog - nothing desktop-only was removed", () => {
  const body = detailsDialogBodyMarkup();
  assert.ok(
    !/\b(?:sm|md|lg|xl|2xl):(?:max-h-|overflow-)/.test(body),
    "expected the max-height/overflow-y-auto to apply at every breakpoint, not gated behind a responsive prefix",
  );
});

test("only this dialog's call site changed - the shared Modal component's size variants are untouched", () => {
  const modalSource = readSource("../../lib/components/Modal.tsx");
  assert.ok(modalSource.includes('size?: "md" | "large" | "wide" | "xl";'), "expected Modal's size union to be exactly as before");
  assert.ok(
    modalSource.includes(
      '"w-full max-w-md rounded-xl bg-card p-6 shadow-xl print:w-auto print:max-w-none print:rounded-none print:p-0 print:shadow-none"',
    ),
    "expected the default 'md' panel classes to be byte-identical - this fix must not touch the shared component",
  );
});
