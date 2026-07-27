/**
 * IUS-2F - SOURCE-CONTRACT tests for the shared timetable grid's new OPT-IN
 * long-gap compression.
 *
 * ScheduleTimeGrid is a "use client" component whose consumers transitively
 * import "use server" modules (Prisma + next/headers), so it cannot be rendered
 * in a plain `tsx --test` process. This uses the repository's established
 * SOURCE-CONTRACT pattern (same technique as
 * app/instructor/unified-instructor-schedule-subview.contract.test.ts) to lock
 * the structural properties the behavioural core tests in
 * lib/schedule-timegrid.test.ts cannot reach:
 *
 *   - the prop exists, is optional, and defaults to OFF;
 *   - exactly ONE consumer opts in - the unified mine-only instructor schedule;
 *   - a compressed gap is rendered from its own list, spanning both columns,
 *     and is never turned into a schedule card;
 *   - the band is inert: no click, no key handler, no button role, no dialog.
 *
 * Run with:
 *   npx tsx --test lib/components/ScheduleTimeGrid.contract.test.ts
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

const GRID = "lib/components/ScheduleTimeGrid.tsx";
const CORE = "lib/schedule-timegrid.ts";
const UNIFIED = "app/instructor/UnifiedInstructorScheduleSection.tsx";

// Every file that renders the shared grid today. The unified mine-only
// instructor view is the ONLY one allowed to opt in.
const OTHER_CONSUMERS = [
  "app/instructor/InstructorScheduleSection.tsx",
  "app/student/ScheduleSection.tsx",
  "app/admin/weekly-schedule/[id]/WeeklyScheduleDetailClient.tsx",
];

const GAP_LABEL = "הפסקה בלו״ז שלי";

// ---------------------------------------------------------------------------
// (1)(2)(3) The prop exists, is optional, and is off by default.
// ---------------------------------------------------------------------------

test("ScheduleTimeGrid accepts an OPTIONAL compact-gap prop", () => {
  const body = code(GRID);
  assert.match(body, /compactLongGaps\?: \{/, "the prop must be optional");
  assert.match(body, /readonly thresholdMinutes: number;/);
  assert.match(body, /readonly compressedSlotCount: number;/);
  assert.match(body, /readonly label: string;/);
});

test("the compact-gap prop has NO default value - absent means off", () => {
  const body = code(GRID);
  // slotMinutes keeps its default; compactLongGaps deliberately has none.
  assert.match(body, /slotMinutes = 15,/);
  assert.match(body, /^\s*compactLongGaps,$/m, "destructured with no default");
  assert.equal(/compactLongGaps = /.test(body), false, "a default would silently enable it");
  // Nothing is passed down to the core unless BOTH values are present.
  assert.match(
    body.replace(/\s+/g, " "),
    /compactLongGaps: thresholdMinutes !== undefined && compressedSlotCount !== undefined \? \{ thresholdMinutes, compressedSlotCount \} : undefined,/,
  );
});

test("the core treats an absent config as the pre-IUS-2F layout", () => {
  const body = code(CORE);
  assert.match(body, /export interface BuildTimeGridLayoutOptions \{/);
  assert.match(body, /readonly compactLongGaps\?: CompactLongGapsConfig;/);
  assert.match(body, /function normalizeCompactLongGaps\(/);
  assert.match(body, /if \(!config\) return null;/, "no config must normalize to null (off)");
});

test("existing callers are NOT required to pass the prop", () => {
  for (const file of OTHER_CONSUMERS) {
    const body = code(file);
    assert.match(body, /<ScheduleTimeGrid/, `${file} should still render the shared grid`);
    assert.equal(/compactLongGaps/.test(body), false, `${file} must not opt in to gap compression`);
  }
  // The legacy positional slotMinutes call shape is still supported, so no
  // consumer is forced to migrate to the options object.
  assert.match(
    code(CORE),
    /optionsOrSlotMinutes: number \| BuildTimeGridLayoutOptions = 15/,
  );
});

// ---------------------------------------------------------------------------
// (4)(5)(9) Gap markers are their own thing - never a schedule card.
// ---------------------------------------------------------------------------

test("gap markers render from their OWN list, separately from schedule items", () => {
  const body = code(GRID);
  assert.match(body, /const \{ totalSlots, positions, compressedGaps \} = useMemo\(/);
  assert.match(body, /compressedGaps\.map\(\(gap\) => \(/, "gaps have their own map");
  assert.match(body, /positions\.map\(\(\{ items: cellItems/, "items keep their own map");
  const gapMap = body.indexOf("compressedGaps.map((gap) => (");
  const itemMap = body.indexOf("positions.map(({ items: cellItems");
  assert.notEqual(gapMap, -1);
  assert.notEqual(itemMap, -1);
  assert.notEqual(gapMap, itemMap, "the two lists must never be the same map");
});

test("no fake schedule item / card is fabricated for a gap", () => {
  const body = code(GRID);
  // renderCard is invoked exactly once, from inside the ITEM map.
  assert.equal(body.match(/renderCard\(/g)?.length, 1, "renderCard is called only for real items");
  const gapMap = body.indexOf("compressedGaps.map((gap) => (");
  const render = body.indexOf("renderCard(item)");
  assert.ok(render > gapMap, "sanity: the two blocks are distinct");
  const gapBlock = body.slice(gapMap, body.indexOf("positions.map(({ items: cellItems"));
  assert.equal(/renderCard|InstructorScheduleCard|item\./.test(gapBlock), false,
    "a gap band must carry no card, no title, no location, no instructor and no course");

  // The pure core returns markers as their own typed DTO, not as items.
  const core = code(CORE);
  assert.match(core, /export interface TimeGridCompressedGap \{/);
  assert.match(core, /compressedGaps: TimeGridCompressedGap\[\];/);
  assert.equal(/GroupableScheduleItem>\s*\{[\s\S]*?compressedGaps: T\[\]/.test(core), false,
    "a gap must never be typed as a schedule item");
});

test("gap markers span BOTH group columns and use the compressed coordinates", () => {
  const body = code(GRID).replace(/\s+/g, " ");
  assert.match(body, /gridColumn: "1 \/ span 2", gridRow: `\$\{gap\.startSlotIndex \+ 1\} \/ span \$\{gap\.rowSpan\}`/);
});

// ---------------------------------------------------------------------------
// (6)(7)(8) Wording, real times, and inertness.
// ---------------------------------------------------------------------------

test("the band shows the caller's Hebrew label and the REAL time range", () => {
  const body = code(GRID);
  assert.match(body, /\{compactLongGaps\.label\}/, "the visible label comes from the prop");
  assert.match(body, /\{gap\.realStartTime\}–\{gap\.realEndTime\}/,
    "the real range must be visible, since the surrounding card times stay authoritative");
  assert.match(
    body.replace(/\s+/g, " "),
    /aria-label=\{`\$\{compactLongGaps\.label\}, \$\{gap\.realStartTime\} עד \$\{gap\.realEndTime\}, \$\{formatTimeGridGapDurationLabel\(gap\.realDurationMinutes\)\}`\}/,
    "the accessible name must carry the label, both real times and the real duration",
  );
  // Not colour alone: an explicit dashed border plus wording.
  assert.match(body, /border border-dashed border-border/);
});

test("the band is completely non-interactive", () => {
  const gapBlock = code(GRID).slice(
    code(GRID).indexOf("compressedGaps.map((gap) => ("),
    code(GRID).indexOf("positions.map(({ items: cellItems"),
  );
  assert.equal(/onClick|onKeyDown|onKeyUp|onKeyPress|tabIndex|role="button"|<button/.test(gapBlock), false,
    "a compressed gap is informational only - no click, no keyboard, no button");
  assert.equal(/hover:|cursor-pointer|Modal|Dialog/.test(gapBlock), false,
    "no hover affordance and no details modal");
  assert.match(gapBlock, /role="note"/, "a non-interactive role that can host the aria-label");
});

// ---------------------------------------------------------------------------
// (10)(11) Exactly one opt-in: the unified mine-only instructor schedule.
// ---------------------------------------------------------------------------

test("UnifiedInstructorScheduleSection passes the locked 60 / 2 / label config", () => {
  const body = code(UNIFIED);
  assert.match(body, /const UNIFIED_COMPACT_LONG_GAPS = \{/);
  assert.match(body, /thresholdMinutes: 60,/);
  assert.match(body, /compressedSlotCount: 2,/);
  assert.ok(body.includes(`label: "${GAP_LABEL}",`), "expected the locked Hebrew label");
  assert.match(body, /\} as const;/, "a module-level constant keeps the prop identity stable");
  assert.match(body, /compactLongGaps=\{UNIFIED_COMPACT_LONG_GAPS\}/);
});

test("the prop is passed on the SHARED grid element, so week and today both compress", () => {
  const body = code(UNIFIED);
  assert.equal(body.match(/<ScheduleTimeGrid/g)?.length, 1,
    "one grid element serves both modes - see the unified subview contract");
  assert.equal(body.match(/compactLongGaps=/g)?.length, 1);
  // Nothing branches the config on mode.
  assert.equal(/isToday \?[^\n]*compactLongGaps|compactLongGaps[^\n]*isToday/.test(body), false,
    "week and today must not be able to diverge");
  assert.match(body, /mode: "week" \| "today";/);
});

// ---------------------------------------------------------------------------
// (12)(13) Per-course, trainee and admin surfaces are untouched.
// ---------------------------------------------------------------------------

test("no other surface anywhere in the app mentions the compact-gap prop", () => {
  const body = code(GRID);
  assert.match(body, /compactLongGaps/, "sanity: the grid itself declares it");
  for (const file of [...OTHER_CONSUMERS, "app/instructor/InstructorCourseScopedScheduleSection.tsx",
    "app/instructor/InstructorTodayScheduleCard.tsx", "app/instructor/InstructorClient.tsx",
    "app/student/UnifiedScheduleSection.tsx",
    "app/admin/courses/[courseOfferingId]/schedule/[weeklyScheduleId]/OfferingWeekEditorClient.tsx"]) {
    assert.equal(/compactLongGaps|הפסקה בלו/.test(code(file)), false,
      `${file} must be untouched by IUS-2F`);
  }
});

// ---------------------------------------------------------------------------
// (16)(17) No server, no data, no new source of schedule items.
// ---------------------------------------------------------------------------

test("IUS-2F is layout-only - no reader, no action, no DB, no clock", () => {
  for (const file of [GRID, CORE]) {
    const body = code(file);
    assert.equal(/@\/lib\/actions\/|prisma|next\/headers|"use server"/.test(body), false,
      `${file} must not reach the server`);
    assert.equal(/new Date\(|Date\.now\(|Math\.random\(/.test(body), false,
      `${file} must stay deterministic`);
  }
  // The grid still receives ONLY the items its caller already had.
  assert.match(code(GRID), /items: T\[\];/);
  assert.equal(/fetch\(|instructorId|studentId/.test(code(GRID)), false,
    "the grid must not introduce any data source of its own");
});
