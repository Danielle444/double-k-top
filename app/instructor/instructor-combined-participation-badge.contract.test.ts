/**
 * COMBINED PARTICIPATION - SLICE IUS-3: SOURCE-CONTRACT tests for the
 * instructor-facing "משולב" badge.
 *
 * app/instructor/InstructorScheduleSection.tsx and
 * UnifiedInstructorScheduleSection.tsx transitively import "use server" modules
 * (Prisma + next/headers), so neither can be imported into a plain `tsx --test`
 * process. This uses the repository's established SOURCE-CONTRACT pattern (same
 * technique as instructor-schedule-card-info-details.contract.test.ts and
 * app/student/trainee-combined-participation-badge.contract.test.ts) to assert
 * the wiring the pure unit test cannot see:
 *
 *  - the wording lives ONLY in the pure core, never duplicated in a component;
 *  - both surfaces render through the ONE shared card, not two copies;
 *  - the label is derived from the SERVER-RESOLVED level plus the item's own
 *    tri-state, and from nothing else;
 *  - Level 1 cannot reach the badge, structurally;
 *  - the badge sits before extraBadges in a wrapping row, and is repeated in
 *    the details modal;
 *  - no instructor component touches the trainee visibility core.
 *
 * The (level x tri-state) matrix itself is proven DB-free in
 * lib/course/instructor-combined-participation-badge-core.test.ts.
 *
 * Run with:
 *   npx tsx --test app/instructor/instructor-combined-participation-badge.contract.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");

function source(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8").replace(/\r\n/g, "\n");
}

/** Strips block, line and JSX comments so prose about a rule can't satisfy the rule. */
function code(relativePath: string): string {
  return source(relativePath)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

const SECTION = "app/instructor/InstructorScheduleSection.tsx";
const UNIFIED = "app/instructor/UnifiedInstructorScheduleSection.tsx";
const CORE = "lib/course/instructor-combined-participation-badge-core.ts";

const WITH_LABEL = "עם משולב";
const WITHOUT_LABEL = "ללא משולב";

function cardComponentSource(): string {
  const body = code(SECTION);
  const start = body.indexOf("function InstructorScheduleCard(");
  const end = body.indexOf("export function InstructorScheduleSection(");
  assert.notEqual(start, -1, "expected the InstructorScheduleCard component");
  assert.ok(end > start);
  return body.slice(start, end);
}

// ---------------------------------------------------------------------------
// The wording lives in exactly one place.
// ---------------------------------------------------------------------------

test("the pure core owns both label strings", () => {
  const core = source(CORE);
  assert.match(core, /INSTRUCTOR_COMBINED_PARTICIPATION_WITH_LABEL = "עם משולב";/);
  assert.match(core, /INSTRUCTOR_COMBINED_PARTICIPATION_WITHOUT_LABEL = "ללא משולב";/);
});

test("neither instructor component contains a copy of the wording", () => {
  for (const file of [SECTION, UNIFIED]) {
    const body = code(file);
    assert.equal(
      body.includes(WITH_LABEL),
      false,
      `${file} must not hardcode "${WITH_LABEL}" - the pure core owns the wording`,
    );
    assert.equal(
      body.includes(WITHOUT_LABEL),
      false,
      `${file} must not hardcode "${WITHOUT_LABEL}" - the pure core owns the wording`,
    );
  }
});

test("the label mapping exists exactly once in the whole feature", () => {
  const core = source(CORE);
  assert.equal(
    (core.match(/INSTRUCTOR_COMBINED_PARTICIPATION_WITH_LABEL\s*$|INSTRUCTOR_COMBINED_PARTICIPATION_WITH_LABEL$/gm) ?? []).length >= 1,
    true,
  );
  // Only one function decides the label.
  assert.equal(
    (core.match(/export function instructorCombinedParticipationBadgeLabel\(/g) ?? []).length,
    1,
  );
});

// ---------------------------------------------------------------------------
// The section imports and uses the helper; the unified view does not re-derive.
// ---------------------------------------------------------------------------

test("InstructorScheduleSection imports instructorCombinedParticipationBadgeLabel", () => {
  assert.match(
    code(SECTION),
    /import \{ instructorCombinedParticipationBadgeLabel \} from "@\/lib\/course\/instructor-combined-participation-badge-core";/,
  );
});

test("UnifiedInstructorScheduleSection does NOT duplicate the label logic", () => {
  const body = code(UNIFIED);
  assert.equal(
    /instructorCombinedParticipationBadgeLabel/.test(body),
    false,
    "the unified view must delegate the badge entirely to the shared card",
  );
  assert.equal(
    /combinedParticipation/.test(body),
    false,
    "the unified view must not read the tri-state itself",
  );
  assert.equal(
    /combinedLabel/.test(body),
    false,
    "the unified view must not derive a label of its own",
  );
});

test("the shared InstructorScheduleCard is the single rendering path for both surfaces", () => {
  assert.match(code(SECTION), /export function InstructorScheduleCard\(/);
  assert.match(code(UNIFIED), /<InstructorScheduleCard/);
  assert.equal(
    /function \w*Card\(/.test(code(UNIFIED)),
    false,
    "the unified view must not define a card of its own",
  );
});

// ---------------------------------------------------------------------------
// The label is derived from the server-resolved level + the item's tri-state.
// ---------------------------------------------------------------------------

test("the card derives the label from courseLevel and item.combinedParticipation, and nothing else", () => {
  const card = cardComponentSource();
  assert.match(
    card,
    /const combinedLabel = instructorCombinedParticipationBadgeLabel\(\s*courseLevel,\s*item\.combinedParticipation,?\s*\);/,
  );
  // No title/name/date/week inference anywhere near the badge decision.
  assert.equal(
    /combinedLabel\s*=\s*[^;]*(item\.title|weekName|dateKey|sourceCourseLabel)/.test(card),
    false,
    "the badge must never be inferred from free text or dates",
  );
});

test("the card takes courseLevel as a required number prop", () => {
  const card = cardComponentSource();
  assert.match(card, /courseLevel: number;/);
});

test("Level 1 cannot render the badge through the helper", () => {
  // Structural proof at this layer: the component never bypasses the helper, so
  // the helper's level gate (proven exhaustively in the unit test) is the only
  // path to a badge.
  const card = cardComponentSource();
  const derivations = card.match(/instructorCombinedParticipationBadgeLabel\(/g) ?? [];
  assert.equal(derivations.length, 1, "exactly one derivation, with no alternate path");
  const renders = card.match(/\{combinedLabel\s*&&/g) ?? [];
  assert.ok(renders.length >= 1, "every render site must be guarded on the helper's own result");
});

// ---------------------------------------------------------------------------
// Placement: guarded, before extraBadges, in a wrapping row.
// ---------------------------------------------------------------------------

test("the badge renders only when the label is non-null", () => {
  const card = cardComponentSource();
  assert.ok(
    card.includes("{combinedLabel && ("),
    "a null label must render no badge element at all",
  );
  assert.ok(card.includes("{combinedLabel}"), "the pill must print the helper's own string");
});

test("the badge sits after the group badge and BEFORE extraBadges", () => {
  const card = cardComponentSource();
  const group = card.indexOf("שתי הקבוצות");
  // Search from the group badge onward: detailsContent declares its own guarded
  // `{combinedLabel && (` line earlier in the component, and that modal copy is
  // asserted separately below - here we want the BADGE-ROW occurrence.
  const badge = card.indexOf("{combinedLabel && (", group);
  const extras = card.indexOf("{extraBadges}", group);
  assert.notEqual(group, -1);
  assert.notEqual(badge, -1, "expected a guarded badge in the badge row");
  assert.notEqual(extras, -1);
  assert.ok(group < badge, "the combined badge must follow the group badge");
  assert.ok(badge < extras, "the combined badge must precede caller-supplied extras");
});

test("the badge row wraps, so extra pills never overflow on mobile", () => {
  const card = cardComponentSource();
  assert.ok(
    card.includes('<div className="flex flex-wrap items-center gap-1.5">'),
    "the badge row must be a wrapping flex row",
  );
});

test("the badge reuses the trainee card's exact visual convention and compact sizing", () => {
  const card = cardComponentSource();
  assert.ok(card.includes("rounded-full bg-secondary text-secondary-foreground"));
  // Anchor past the group badge so this inspects the BADGE-ROW pill, not the
  // modal's own guarded line (see the placement test above).
  const badgeStart = card.indexOf("{combinedLabel && (", card.indexOf("שתי הקבוצות"));
  const badgeEnd = card.indexOf("{extraBadges}", badgeStart);
  const badge = card.slice(badgeStart, badgeEnd);
  assert.ok(badge.includes('compact ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm"'));
});

// ---------------------------------------------------------------------------
// Details modal + the info-button gate.
// ---------------------------------------------------------------------------

test("the details content states the combined value explicitly", () => {
  const card = cardComponentSource();
  const start = card.indexOf("const detailsContent = (");
  const end = card.indexOf("return (", start);
  assert.notEqual(start, -1);
  const details = card.slice(start, end);
  assert.ok(details.includes("משולב: {combinedLabel}"), "expected the modal line");
  assert.ok(details.includes("{combinedLabel && ("), "the modal line must be guarded too");
});

test("hasSecondaryDetails includes Boolean(combinedLabel)", () => {
  const card = cardComponentSource();
  assert.ok(
    card.includes(
      "Boolean(location) || Boolean(note) || Boolean(item.instructorName) || Boolean(combinedLabel)",
    ),
    "a Level 2 card whose only extra fact is the combined flag must still expose the info button",
  );
});

test("the combined label is derived BEFORE hasSecondaryDetails and detailsContent use it", () => {
  const card = cardComponentSource();
  const derive = card.indexOf("const combinedLabel =");
  const gate = card.indexOf("const hasSecondaryDetails =");
  const details = card.indexOf("const detailsContent = (");
  assert.notEqual(derive, -1);
  assert.ok(derive < gate, "the label must be derived before the info-button gate");
  assert.ok(derive < details, "the label must be derived before the details content");
});

// ---------------------------------------------------------------------------
// Each surface supplies the correct server-resolved level.
// ---------------------------------------------------------------------------

test("per-course cards receive result.courseLevel", () => {
  assert.match(code(SECTION), /courseLevel=\{result\.courseLevel\}/);
});

test("unified cards receive the item's own sourceCourseLevel", () => {
  assert.match(code(UNIFIED), /courseLevel=\{item\.sourceCourseLevel\}/);
  // Per item, never one level for the whole merged list.
  assert.equal(
    /courseLevel=\{[^}]*result\./.test(code(UNIFIED)),
    false,
    "a merged list mixes levels - the level must come from each item's own source tag",
  );
});

// ---------------------------------------------------------------------------
// The locked architectural boundary.
// ---------------------------------------------------------------------------

test("no instructor component imports the trainee combined-participation visibility core", () => {
  for (const file of [SECTION, UNIFIED]) {
    assert.equal(
      /combined-participation-visibility-core/.test(code(file)),
      false,
      `${file} must never call the trainee-only visibility core`,
    );
  }
  assert.equal(
    /combined-participation-visibility-core/.test(code(CORE)),
    false,
    "the instructor badge core must stay independent of trainee visibility logic",
  );
});

test("the badge core is pure - no React, no Prisma, no clock, no server action", () => {
  const core = code(CORE);
  assert.equal(/from "react"|useState|useEffect|jsx/i.test(core), false, "must not import React");
  assert.equal(/prisma|@\/lib\/prisma/i.test(core), false, "must not touch Prisma");
  assert.equal(/Date\.now|new Date\(/.test(core), false, "must not read a clock");
  assert.equal(/"use server"|"use client"/.test(core), false, "must be a plain module");
  assert.equal(/@\/lib\/actions/.test(core), false, "must not import a server action");
});

test("the badge never becomes a filter: no instructor surface branches item visibility on it", () => {
  for (const file of [SECTION, UNIFIED]) {
    const body = code(file);
    assert.equal(
      /\.filter\([^)]*combined/i.test(body),
      false,
      `${file} must never filter items on the combined value`,
    );
  }
  const card = cardComponentSource();
  assert.equal(
    /if \(combinedLabel[^)]*\) return null/.test(card),
    false,
    "a card must never refuse to render because of its combined value",
  );
});
