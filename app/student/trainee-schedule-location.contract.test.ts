/**
 * Contract tests for the trainee schedule card's location row.
 *
 * The pure trim/empty-guard logic is proven directly, with real execution,
 * in lib/schedule-location.test.ts. THIS file proves the WIRING: that
 * ScheduleSection.tsx renders a real item's location through that shared
 * helper (never a raw truthy check on the untrimmed field), that the
 * Level-1-time combined-participation placeholder never renders a location
 * row at all, and that the surrounding card content (title, badges, active
 * indicator) is untouched by this change.
 *
 * WHY SOURCE-CONTRACT, NOT AN IMPORTED UNIT TEST
 * ----------------------------------------------
 * app/student/ScheduleSection.tsx transitively imports lib/actions/student-schedule.ts,
 * a "use server" module (Prisma + next/cache), so it cannot be imported into a
 * plain `tsx --test` process. This uses the repository's established
 * SOURCE-CONTRACT pattern (see trainee-combined-participation-badge.contract.test.ts).
 *
 * Run with:
 *   npx tsx --test app/student/trainee-schedule-location.contract.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function readSource(relative: string): string {
  // Normalise CRLF -> LF so column-0 substring anchors below are stable on
  // Windows working trees.
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

const SECTION = readSource("./ScheduleSection.tsx");

// ---------------------------------------------------------------------------
// Real items render location via the shared trim-aware helper.
// ---------------------------------------------------------------------------

test("the card imports the shared location label helper", () => {
  assert.match(
    SECTION,
    /import\s*\{\s*formatScheduleLocationLabel\s*\}\s*from\s*"@\/lib\/schedule-location";/,
    "expected ScheduleSection.tsx to import formatScheduleLocationLabel from the shared pure module",
  );
});

test("the real-item branch derives the location line from the helper, not a raw truthy check", () => {
  assert.ok(
    SECTION.includes("const location = formatScheduleLocationLabel(item.location);"),
    "expected the real-item render to call formatScheduleLocationLabel(item.location)",
  );
  assert.ok(
    !/\{item\.location &&/.test(SECTION),
    "the old raw truthy check on item.location must be gone - a whitespace-only value would render an empty label",
  );
});

test("the location paragraph renders the derived label, with the מיקום label text", () => {
  const helperCallIdx = SECTION.indexOf("const location = formatScheduleLocationLabel(item.location);");
  assert.notEqual(helperCallIdx, -1);
  const nearby = SECTION.slice(helperCallIdx, helperCallIdx + 400);
  assert.ok(nearby.includes("if (!location) return null;"), "expected a null guard before rendering");
  assert.ok(nearby.includes("מיקום: {location}"), "expected the מיקום label to render the trimmed value");
});

// ---------------------------------------------------------------------------
// The Level-1-time combined-participation placeholder never renders location.
// ---------------------------------------------------------------------------

test("the placeholder branch never references location in any form", () => {
  const branchIdx = SECTION.indexOf("if (item.isCombinedParticipationPlaceholder)");
  const ridingPresentationIdx = SECTION.indexOf("const ridingPresentation = resolveStudentRidingPresentation(item);");
  assert.notEqual(branchIdx, -1, "expected the placeholder branch");
  assert.notEqual(ridingPresentationIdx, -1, "expected the riding presentation computation");
  const branch = SECTION.slice(branchIdx, ridingPresentationIdx);
  assert.ok(
    !branch.includes("location") && !branch.includes("מיקום"),
    "the placeholder branch (זמן עם לו״ז רמה 1) must stay neutral and never render a location row",
  );
});

// ---------------------------------------------------------------------------
// Surrounding card content is unaffected by this change.
// ---------------------------------------------------------------------------

test("the group badge, combined-participation badge, title, and active indicator still render", () => {
  assert.ok(SECTION.includes('{item.groupName ? `קבוצה ${item.groupName}` : "שתי הקבוצות"}'));
  assert.ok(SECTION.includes("combinedParticipationBadgeLabel(item.combinedParticipation)"));
  assert.ok(SECTION.includes("{ridingPresentation.title}"));
  assert.ok(SECTION.includes('מתקיים עכשיו'));
});

test("the start/end time header is still rendered for both real items and placeholders", () => {
  const matches = SECTION.match(/\{item\.startTime\}-\{item\.endTime\}/g) ?? [];
  assert.equal(matches.length, 2, "expected the time header once in the placeholder branch and once in the real-item branch");
});
