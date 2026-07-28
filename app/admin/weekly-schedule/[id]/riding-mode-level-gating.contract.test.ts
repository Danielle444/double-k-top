/**
 * L2-RIDING-UI - contract tests for how the Level 2 "complex only" restriction
 * is WIRED through the admin riding UI.
 *
 * WHY SOURCE-CONTRACT, NOT AN IMPORTED UNIT TEST
 * ----------------------------------------------
 * RidingSlotModal.tsx and both of its callers transitively import "use server"
 * modules (lib/actions/riding-slots.ts, riding-slot-horses.ts,
 * riding-slot-complex.ts), so they cannot be imported into a plain `tsx --test`
 * process. This mirrors the repository's established SOURCE-CONTRACT pattern
 * (see schedule-card-actions-menu.contract.test.ts next door). The DECISION
 * itself is covered by real unit tests in riding-mode-availability.test.ts; this
 * file covers the wiring the unit tests cannot see.
 *
 * Run with:
 *   npx tsx --test "app/admin/weekly-schedule/[id]/riding-mode-level-gating.contract.test.ts"
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LEVEL_2_COMPLEX_ONLY_NOTE } from "./riding-mode-availability";

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

// The core's own documentation NAMES the heuristics and dependencies it refuses
// to use ("never from the title, its groupName", "no Prisma, no React"). Purity
// assertions must therefore read the CODE, not the prose that explains it.
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const MODAL = readSource("./RidingSlotModal.tsx");
const CORE = readSource("./riding-mode-availability.ts");
const CORE_CODE = stripComments(CORE);
const DETAIL_CLIENT = readSource("./WeeklyScheduleDetailClient.tsx");
const DETAIL_PAGE = readSource("./page.tsx");
const RIDING_CLIENT = readSource("./riding/WeeklyRidingClient.tsx");
const RIDING_PAGE = readSource("./riding/page.tsx");

function modeSectionSource(): string {
  const start = MODAL.indexOf('<p className="mb-2 text-sm font-semibold text-card-foreground">מצב רכיבה</p>');
  assert.notEqual(start, -1, "expected the מצב רכיבה section");
  const end = MODAL.indexOf("<div className=\"flex shrink-0 justify-end\">", start);
  assert.ok(end > start, "expected the modal footer after the mode section");
  return MODAL.slice(start, end);
}

// ---------------------------------------------------------------------------
// The gate is driven by the shared pure core, not by an inline condition.
// ---------------------------------------------------------------------------

test("the modal takes its mode availability from the shared pure core", () => {
  assert.match(
    MODAL,
    /import\s*\{[\s\S]*?resolveRidingModeAvailability[\s\S]*?\}\s*from\s*"@\/app\/admin\/weekly-schedule\/\[id\]\/riding-mode-availability";/,
  );
  assert.match(MODAL, /const modeAvailability = resolveRidingModeAvailability\(courseLevel\);/);
});

// ---------------------------------------------------------------------------
// AUTHORITATIVE LEVEL SOURCE - CourseOffering.level off the week's own FK.
// ---------------------------------------------------------------------------

test("both admin riding routes read the level from the week's OWN CourseOffering relation", () => {
  for (const [name, page] of [
    ["page.tsx", DETAIL_PAGE],
    ["riding/page.tsx", RIDING_PAGE],
  ] as const) {
    assert.match(
      page,
      /courseOffering:\s*\{\s*select:\s*\{\s*level:\s*true\s*\}\s*\}/,
      `${name} must select CourseOffering.level`,
    );
    assert.match(
      page,
      /week\.courseOffering\?\.level \?\? null/,
      `${name} must pass the offering's level down, null when unscoped`,
    );
  }
});

test("the level reaches the modal as a prop from each route - never re-derived inside the modal", () => {
  assert.match(DETAIL_CLIENT, /courseLevel=\{week\.courseLevel\}/);
  assert.match(RIDING_CLIENT, /courseLevel=\{courseLevel\}/);
  // The modal accepts it and does no lookup of its own.
  assert.match(MODAL, /courseLevel: number \| null;/);
  assert.ok(
    !/getCurrentCourse|resolveCurrentCourse|courseOffering\.findUnique|prisma/.test(MODAL),
    "the modal must not resolve a course itself",
  );
});

test("no hardcoded CourseOffering id anywhere in the gating path", () => {
  for (const [name, src] of [
    ["core", CORE],
    ["modal", MODAL],
    ["detail client", DETAIL_CLIENT],
    ["detail page", DETAIL_PAGE],
    ["riding client", RIDING_CLIENT],
    ["riding page", RIDING_PAGE],
  ] as const) {
    // cuid()-shaped literals are how a CourseOffering id would be pinned.
    assert.ok(
      !/["'`]c[a-z0-9]{20,}["'`]/.test(src),
      `${name} must not contain a hardcoded offering id`,
    );
  }
});

test("the decision uses NO title, groupName or globally-selected-course heuristic", () => {
  assert.ok(
    !/title|groupName|selectedCourse|currentCourse/.test(CORE_CODE),
    "the core must decide from the level alone",
  );
  const section = modeSectionSource();
  assert.ok(
    !/scheduleItemInfo\.(title|groupName)/.test(section),
    "the mode section must not branch on the item's title or group",
  );
});

// ---------------------------------------------------------------------------
// LEVEL 2 - the simple entry point is not rendered at all.
// ---------------------------------------------------------------------------

test("the 'רשימת סוסים רגילה' creation button is rendered only when simple creation is allowed", () => {
  const section = modeSectionSource();
  assert.match(
    section,
    /\{modeAvailability\.canCreateSimple && \(\s*<Button variant="secondary" onClick=\{handleChooseSimple\}>\s*רשימת סוסים רגילה/,
  );
});

test("the complex creation button survives the restriction", () => {
  const section = modeSectionSource();
  assert.match(section, /\{modeAvailability\.canCreateComplex && \(/);
  assert.ok(section.includes("תכנון רכיבה מורכבת — בלוקים ושיבוצים"));
  assert.ok(section.includes("onClick={handleChooseComplex}"));
});

test("opening an EXISTING complex plan stays available at every level", () => {
  const section = modeSectionSource();
  const complexBranch = section.slice(section.indexOf('{mode === "complex" && ('));
  assert.ok(complexBranch.includes("פתיחת תכנון רכיבה מורכבת"));
  assert.ok(
    !complexBranch.includes("modeAvailability"),
    "the existing-complex editor entry must not be gated",
  );
});

// ---------------------------------------------------------------------------
// EXISTING DATA - never hidden, deleted or converted.
// ---------------------------------------------------------------------------

test("an existing simple horse list stays openable for editing at every level", () => {
  const section = modeSectionSource();
  const simpleBranch = section.slice(
    section.indexOf('{mode === "simple" && ('),
    section.indexOf('{mode === "complex" && ('),
  );
  assert.ok(simpleBranch.includes("הגדרת סוסים לאיכוף"));
  assert.ok(simpleBranch.includes("onClick={() => setShowHorseListEditor(true)}"));
  assert.ok(
    !/canCreateSimple/.test(simpleBranch),
    "the existing-list editor button must not be gated on the CREATION flag",
  );
});

test("a Level 2 slot with an existing simple list gets an explanation, not a dead end", () => {
  const section = modeSectionSource();
  assert.match(section, /isPreservedLegacySimpleMode\(courseLevel, true\)/);
  assert.ok(section.includes("הרשימה הקיימת נשמרת"));
});

test("nothing in the gating path deletes, converts or migrates riding data", () => {
  for (const [name, src] of [
    ["core", CORE],
    ["modal", MODAL],
    ["riding client", RIDING_CLIENT],
  ] as const) {
    assert.ok(
      !/deleteRidingSlotHorseList|convertRidingSlot|migrateRidingSlot/.test(src),
      `${name} must not delete or convert riding data`,
    );
  }
});

// ---------------------------------------------------------------------------
// THE NOTE - one string, only where it is relevant.
// ---------------------------------------------------------------------------

test("the Hebrew explanation is the single shared constant, rendered from the core's decision", () => {
  assert.equal(LEVEL_2_COMPLEX_ONLY_NOTE, "רמה 2 תומכת כרגע במערכת רכיבות מורכבת בלבד");
  assert.match(modeSectionSource(), /\{modeAvailability\.complexOnlyNote\}/);
});

test("the note is not duplicated as a literal anywhere in the UI, and never rendered globally", () => {
  for (const [name, src] of [
    ["modal", MODAL],
    ["detail client", DETAIL_CLIENT],
    ["riding client", RIDING_CLIENT],
    ["detail page", DETAIL_PAGE],
    ["riding page", RIDING_PAGE],
  ] as const) {
    assert.ok(
      !src.includes(LEVEL_2_COMPLEX_ONLY_NOTE),
      `${name} must not inline the note text - it comes from the core`,
    );
  }
});

test("the note renders only next to the mode selection, and only while a mode is still selectable", () => {
  assert.match(
    MODAL,
    /\{modeAvailability\.complexOnlyNote && \(mode === "none" \|\| mode === "simple"\) && \(/,
  );
  // Exactly one render site.
  assert.equal(MODAL.split("modeAvailability.complexOnlyNote").length - 1, 2);
});

// ---------------------------------------------------------------------------
// MOBILE / TABLET - the note and the button row keep the existing responsive
// primitives (wrapping flex rows inside the modal's own scroll container).
// ---------------------------------------------------------------------------

test("the mode buttons still wrap, and the note is a full-width block that cannot overflow", () => {
  const section = modeSectionSource();
  assert.match(section, /<div className="flex flex-wrap gap-2">/);
  assert.match(section, /className="mb-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground"/);
  assert.ok(
    !/w-\[\d|min-w-\[\d|whitespace-nowrap/.test(section),
    "no fixed/minimum width or nowrap that could break a narrow screen",
  );
});

// ---------------------------------------------------------------------------
// UI-ONLY - no server action, capability or auth involvement.
// ---------------------------------------------------------------------------

test("the core is pure - no 'use server', no Prisma, no React, no IO", () => {
  assert.ok(!CORE_CODE.includes("use server"));
  assert.ok(!/prisma|PrismaClient|next\/headers|cookies\(|react/i.test(CORE_CODE));
  // No imports at all - it depends on nothing.
  assert.ok(!/^import\s/m.test(CORE_CODE));
});

test("the restriction is not a capability or auth check", () => {
  assert.ok(!/capabilit|requireAdmin|getCurrent|session/i.test(CORE_CODE));
});

test("the modal's server-action imports are unchanged by the restriction", () => {
  for (const imported of [
    "getRidingSlotForScheduleItem",
    "createOrGetRidingSlot",
    "getRidingSlotHorseListForAdmin",
    "getRidingSlotComplexPlanForAdmin",
    "createRidingSlotComplexPlanAsAdmin",
  ]) {
    assert.ok(MODAL.includes(imported), `${imported} must still be imported`);
  }
  // The horse-list editor itself is still mounted - it is what an existing
  // Level 2 list would be edited through.
  assert.match(MODAL, /<RidingHorseListEditor/);
});
