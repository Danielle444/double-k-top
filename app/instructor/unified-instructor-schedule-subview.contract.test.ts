/**
 * UNIFIED INSTRUCTOR SCHEDULE - SLICE IUS-2 / IUS-2D: SOURCE-CONTRACT tests for
 * the instructor schedule tab's two sub-views.
 *
 * These components transitively import "use server" modules (Prisma +
 * next/headers), so they cannot be imported into a plain `tsx --test` process.
 * This uses the repository's established SOURCE-CONTRACT pattern (same
 * technique as instructor-schedule-independence.test.ts and
 * app/student/unified-schedule-subview.contract.test.ts) to assert STRUCTURAL
 * properties a behavioural test cannot easily reach:
 *
 *  1. the unified view renders through ScheduleTimeGrid, ONE grid per
 *     (day, source CourseOffering), with the grouping delegated to a pure core;
 *  2. it reuses the EXISTING InstructorScheduleCard and shows source-course +
 *     overlap badges through the new extraBadges slot;
 *  3. it calls ONLY the unified readers, with no identity and no course id;
 *  4. the sub-view toggle is screen-local and stays OUT of InstructorClient;
 *  5. the existing per-course branch (selector + keyed week browser) is intact;
 *  6. no persistence, no context, no module-level mutable state anywhere.
 *
 * WHY (1) IS THE REVERSE OF WHAT THIS FILE ORIGINALLY ASSERTED
 * -----------------------------------------------------------
 * IUS-2 shipped the unified view as a flat stacked list and this file LOCKED
 * that in ("never ScheduleTimeGrid", "one flat map", "never re-grouped"). The
 * reasoning was that one grid cannot represent two offerings - which is true,
 * and is precisely why those assertions are now obsolete rather than merely
 * relaxed. The flat list also threw away two things the per-course view has
 * always had and which the product direction requires: Level 1's simultaneous
 * group א / group ב activities side by side (and its full-width "שתי הקבוצות"
 * blocks), and the per-day header of a multi-day week. IUS-2C temporarily
 * defaulted BOTH instructor schedule surfaces away from the unified view for
 * exactly that reason.
 *
 * IUS-2D keeps the original safety property and drops only the layout
 * consequence: the view now renders MANY grids, split by day and then by source
 * offering, so NO grid ever receives more than one offering's items. That
 * closes the real hazard the old assertions were protecting against - the grid
 * and lib/schedule-grouping pair/span/coalesce with no offering awareness and
 * keep only the first item's fields, so a mixed grid could fabricate one merged
 * card carrying the wrong sourceCourseOfferingId / sourceCourseLabel /
 * sourceCourseLevel / combinedParticipation / overlap metadata. The tests below
 * therefore assert the SPLIT, not the absence of the grid. With the layout
 * restored, both temporary IUS-2C defaults revert to "unified" (asserted here
 * and in instructor-today-schedule-selector.contract.test.ts).
 *
 * Run with:
 *   npx tsx --test app/instructor/unified-instructor-schedule-subview.contract.test.ts
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

const UNIFIED = "app/instructor/UnifiedInstructorScheduleSection.tsx";
const OUTER = "app/instructor/InstructorCourseScopedScheduleSection.tsx";
const SECTION = "app/instructor/InstructorScheduleSection.tsx";
const CLIENT = "app/instructor/InstructorClient.tsx";
const WEEK_BROWSER = "app/instructor/InstructorScheduleWeekBrowser.tsx";
const TODAY_CARD = "app/instructor/InstructorTodayScheduleCard.tsx";
const GROUPING_CORE = "lib/course/unified-instructor-day-grouping-core.ts";

// ---------------------------------------------------------------------------
// IUS-2D (1) Real timetable layout: ScheduleTimeGrid, one grid per day/offering.
// (Replaces the obsolete IUS-2 "never ScheduleTimeGrid / flat list" contract -
// see this file's header for why it was reversed.)
// ---------------------------------------------------------------------------

test("the unified view renders through the EXISTING ScheduleTimeGrid", () => {
  const body = code(UNIFIED);
  assert.match(
    body,
    /import \{ ScheduleTimeGrid \} from "@\/lib\/components\/ScheduleTimeGrid";/,
    "Level 1 group א / group ב must lay out side by side, as in the per-course view",
  );
  assert.match(body, /<ScheduleTimeGrid/);
  // The grid itself is reused verbatim - the unified view never clones one.
  assert.equal(/function .*TimeGrid|gridTemplateColumns/.test(body), false,
    "the unified view must not reimplement the timetable grid");
});

test("the unified view delegates day/offering grouping to the PURE core", () => {
  const body = code(UNIFIED);
  assert.match(
    body,
    /import \{ groupUnifiedInstructorItemsByDayAndOffering \} from "@\/lib\/course\/unified-instructor-day-grouping-core";/,
  );
  assert.match(body, /groupUnifiedInstructorItemsByDayAndOffering\(itemsState\.items\)/);
  // Ordering still belongs to the cores, never to this file.
  assert.equal(/\.sort\(/.test(body), false,
    "day/block order belongs to the grouping core, item order to the merge core");
});

test("the grouping core is pure - no React, no DB, no clock, no server action", () => {
  const body = code(GROUPING_CORE);
  assert.equal(/from "react"|useMemo|prisma|next\/headers|"use server"|"use client"/.test(body), false);
  assert.equal(/new Date\(|Date\.now\(|Math\.random\(/.test(body), false);
  assert.equal(/@\/lib\/actions\//.test(body), false, "a pure core must not import a server action");
});

test("exactly one grid is rendered per day/offering block", () => {
  const body = code(UNIFIED);
  // days -> blocks -> exactly one grid, and nothing else maps into a grid.
  assert.match(body, /\{days\.map\(\(day\) => \(/, "expected an outer per-day map");
  assert.match(body, /\{day\.blocks\.map\(\(block\) => \(/, "expected an inner per-offering-block map");
  assert.equal(body.match(/<ScheduleTimeGrid/g)?.length, 1,
    "exactly one grid element exists, rendered once per block");
  const blockMap = body.indexOf("{day.blocks.map((block) => (");
  assert.ok(blockMap !== -1 && blockMap < body.indexOf("<ScheduleTimeGrid"),
    "the grid must be rendered INSIDE the per-block map");
});

test("NO grid can receive items from more than one sourceCourseOfferingId", () => {
  const body = code(UNIFIED);
  // The only value ever handed to the grid is ONE block's items, and a block is
  // single-offering by construction in the pure core (locked by its own tests).
  assert.match(body, /<ScheduleTimeGrid\s*\n\s*items=\{block\.items\}/);
  assert.equal(/items=\{itemsState\.items\}|items=\{day\./.test(body), false,
    "a whole day's or a whole week's items must never reach a single grid");
  const core = code(GROUPING_CORE);
  assert.match(core, /byOffering/, "the core splits a day by sourceCourseOfferingId");
  assert.match(core, /sourceCourseOfferingId: first\.sourceCourseOfferingId/);
});

test("cards inside the grid use compact mode", () => {
  const body = code(UNIFIED);
  assert.match(body, /renderCard=\{\(item\) => \(/);
  assert.match(body, /<InstructorScheduleCard[\s\S]*?\n\s*compact\n/,
    "grid cells are fixed-height - the card must render in compact mode");
  assert.equal(/compact=\{false\}/.test(body), false, "the pre-IUS-2D non-compact card is gone");
});

test("the sticky per-day header is restored, with the same Today marker convention", () => {
  const body = code(UNIFIED);
  assert.match(
    body,
    /className="sticky top-0 z-10 rounded-lg bg-secondary px-3 py-2 text-base font-bold text-secondary-foreground"/,
    "expected the per-course section's own sticky day-header classes",
  );
  assert.match(body, /\{day\.dayLabel\} · \{day\.dateLabel\}/);
  assert.match(body, /day\.dateKey === todayMarkerKey && <span className="mr-2 text-sm font-normal">\(היום\)<\/span>/);
  // The marker uses the shared local-day helper, never a value sent to a reader.
  assert.match(body, /const todayMarkerKey = todayDateKey\(\);/);
});

test("the source-course sub-header is conditional on a day having MORE THAN ONE block", () => {
  const body = code(UNIFIED);
  assert.match(body, /\{day\.blocks\.length > 1 && \(/,
    "a single-offering day must look like the per-course layout, with no extra heading");
  const guard = body.indexOf("{day.blocks.length > 1 && (");
  const label = body.indexOf("{block.sourceCourseLabel}");
  assert.notEqual(label, -1, "expected the block's own course label in the sub-header");
  assert.ok(guard < label, "the label must render inside the multi-block guard");
});

test("days and blocks are keyed so no card key can collide across offerings", () => {
  const body = code(UNIFIED);
  assert.match(body, /key=\{day\.dateKey\}/);
  assert.match(body, /key=\{block\.sourceCourseOfferingId\}/);
});

// ---------------------------------------------------------------------------
// (14)(15) Card reuse, source-course badge, overlap badge.
// ---------------------------------------------------------------------------

test("the unified view reuses the EXISTING instructor card rather than cloning one", () => {
  const body = code(UNIFIED);
  assert.match(body, /import \{ InstructorScheduleCard, isItemActiveNow \} from "\.\/InstructorScheduleSection";/);
  assert.match(body, /<InstructorScheduleCard/);
  assert.equal(/function .*Card\(/.test(body), false, "the unified view must not define a card of its own");
});

test("the shared card is exported and accepts the optional extraBadges slot", () => {
  const body = code(SECTION);
  assert.match(body, /export function InstructorScheduleCard\(/);
  assert.match(body, /extraBadges\?: ReactNode;/);
  // Rendered in the EXISTING badge row, after the group badge.
  const groupBadge = body.indexOf("שתי הקבוצות");
  const extras = body.indexOf("{extraBadges}");
  assert.notEqual(groupBadge, -1);
  assert.notEqual(extras, -1);
  assert.ok(groupBadge < extras, "extraBadges must render after the group badge");
});

test("the unified view shows an always-visible source-course badge", () => {
  const body = code(UNIFIED);
  assert.match(body, /\{item\.sourceCourseLabel\}/, "each card must name the offering it came from");
  assert.match(body, /extraBadges=\{/, "badges go through the shared card's extraBadges slot");
});

test("the overlap badge is wired to the merge core's own overlap metadata", () => {
  const body = code(UNIFIED);
  assert.match(body, /item\.overlappingSourceCourseOfferingIds\.length > 0 &&/);
  assert.ok(body.includes('חפיפה בלו&quot;ז'), "expected the Hebrew overlap badge text");
});

test("the Level 2 combined badge still reaches the card, per item, through courseLevel", () => {
  const body = code(UNIFIED);
  // IUS-3 - the item's OWN source offering level (never a per-view level): a
  // merged list mixes Level 1 and Level 2 blocks and only the Level 2 ones may
  // carry the "משולב" badge. The wording and the rule live in the shared card +
  // its pure helper, never here.
  assert.match(body, /courseLevel=\{item\.sourceCourseLevel\}/);
  // (The view's own title contains "המשולב", so the label text itself cannot be
  // asserted-absent here; the badge's data and its helper can.)
  assert.equal(/instructorCombinedParticipationBadgeLabel|combinedParticipation/.test(body), false,
    "the combined badge must come through InstructorScheduleCard, never be re-implemented here");
  const section = code(SECTION);
  assert.match(section, /instructorCombinedParticipationBadgeLabel\(\s*courseLevel,\s*item\.combinedParticipation,\s*\)/);
});

test("the per-course path still renders through the same card and is untouched", () => {
  const body = code(SECTION);
  assert.match(body, /getCourseScopedScheduleForInstructor\(/);
  assert.match(body, /getTodayScheduleForInstructor\(/);
  assert.match(body, /<ScheduleTimeGrid/, "the per-course view keeps its timetable grid");
  assert.equal(/instructorId/.test(body), false, "the section must not take an instructorId");
});

// ---------------------------------------------------------------------------
// (3) The unified view calls ONLY the unified readers, with no client context.
// ---------------------------------------------------------------------------

test("the unified view calls only the two unified readers", () => {
  const body = code(UNIFIED);
  assert.match(body, /getUnifiedInstructorWeekOptions\(\)/);
  assert.match(body, /getUnifiedScheduleForInstructor\(rangeStart!, rangeEnd!, dayFilter\)/);
  assert.match(body, /getUnifiedTodayScheduleForInstructor\(\)/);
  assert.equal(
    /getInstructorWeekSelection\(|getCourseScopedScheduleForInstructor\(|getTodayScheduleForInstructor\(/.test(body),
    false,
    "the unified view must not issue a per-course request of its own",
  );
});

test("the unified view takes no instructorId and no courseOfferingId prop", () => {
  const body = code(UNIFIED);
  assert.equal(/instructorId/.test(body), false);
  assert.equal(/courseOfferingId/.test(body), false);
  assert.equal(/selectedOfferingId/.test(body), false);
});

test("the unified view has all four load states", () => {
  const body = code(UNIFIED);
  for (const status of ["loading", "denied", "error", "loaded"]) {
    assert.ok(body.includes(`"${status}"`), `expected a ${status} state`);
  }
  assert.ok(body.includes("if (!result.eligible)"), "an ineligible server result must render the denied state");
});

// ---------------------------------------------------------------------------
// IUS-2B: the unified view is MINE-ONLY - the mine/all toggle is GONE.
// ---------------------------------------------------------------------------

test("the unified view has NO mine/all toggle and never sends a filter", () => {
  const body = code(UNIFIED);
  assert.equal(body.includes('כל הלו&quot;ז'), false, 'the "כל הלו״ז" toggle must be gone');
  assert.equal(body.includes("השיעורים שלי"), false, "the mine/all pair must be gone entirely");
  assert.equal(/scheduleFilter|setScheduleFilter/.test(body), false, "no filter state may remain");
  assert.equal(
    /InstructorScheduleFilter/.test(body),
    false,
    "the unified view must not even name the filter type - both actions fix it server-side",
  );
});

test("the per-course weekly view KEEPS its own mine/all filter, unchanged", () => {
  const body = code(SECTION);
  assert.ok(body.includes('setScheduleFilter("mine")'));
  assert.ok(body.includes('setScheduleFilter("all")'));
  assert.ok(body.includes("השיעורים שלי"));
  assert.ok(body.includes('כל הלו&quot;ז'));
});

// ---------------------------------------------------------------------------
// IUS-2B: the two modes of the unified section.
// ---------------------------------------------------------------------------

test("the unified section takes an explicit week/today mode", () => {
  const body = code(UNIFIED);
  assert.match(body, /mode: "week" \| "today";/);
  assert.match(body, /const isToday = mode === "today";/);
});

test("today mode issues NO week-options request and renders no week picker", () => {
  const body = code(UNIFIED);
  // The week-options effect returns early in today mode...
  assert.match(body, /if \(isToday\) return;\s*\n\s*let cancelled = false;\s*\n\s*getUnifiedInstructorWeekOptions\(\)/);
  // ...and today mode returns before the WeekDayPicker branch is reached.
  const earlyReturn = body.indexOf("if (isToday) {");
  const picker = body.indexOf("<WeekDayPicker");
  assert.notEqual(earlyReturn, -1, "expected a today-mode early return");
  assert.ok(earlyReturn < picker, "today mode must return before the week picker renders");
});

test("today mode sends no date to the server - todayKey is range-reporting only", () => {
  const body = code(UNIFIED);
  assert.match(body, /getUnifiedTodayScheduleForInstructor\(\)/, "the today reader takes no arguments");
  assert.equal(
    /getUnifiedTodayScheduleForInstructor\([^)]+\)/.test(body),
    false,
    "no value may be passed to the today reader",
  );
});

test("the weekly caller and the today caller each declare their mode", () => {
  assert.match(code(OUTER), /<UnifiedInstructorScheduleSection\s+mode="week"/);
  assert.match(code(TODAY_CARD), /<UnifiedInstructorScheduleSection\s+mode="today"/);
});

// ---------------------------------------------------------------------------
// (16) The toggle is screen-local and stays OUT of InstructorClient.
// ---------------------------------------------------------------------------

test("the sub-view toggle lives in the schedule screen, not in InstructorClient", () => {
  const outer = code(OUTER);
  // IUS-2E - the default is no longer the same for everyone: it now follows the
  // SERVER-derived riding-notes edit permission (unified for editors, byCourse
  // for everyone else). The toggle itself is unchanged and still screen-local -
  // this asserts only which sub-view opens first. The full default contract
  // lives in instructor-schedule-default-mode.contract.test.ts.
  assert.match(
    outer.replace(/\s+/g, " "),
    /const \[subView, setSubView\] = useState<ScheduleSubView>\( canEditRidingNotes \? "unified" : "byCourse", \)/,
  );
  assert.ok(outer.includes('הלו&quot;ז המשולב שלי'), "expected the unified toggle label");
  assert.ok(outer.includes("לפי קורס"), "expected the per-course toggle label");

  const client = code(CLIENT);
  assert.equal(/subView|ScheduleSubView|UnifiedInstructorScheduleSection/.test(client), false,
    "InstructorClient must hold no sub-view state and must not mount the unified view itself");
  // The committed rule this slice must not regress.
  assert.equal(/courseOfferingId|selectedOfferingId/.test(client), false,
    "InstructorClient must still hold no course state of any kind");
});

test("exactly one sub-view branch is mounted, so unified mode issues no per-course request", () => {
  const outer = code(OUTER);
  assert.match(outer, /subView === "unified" \? \(/, "expected a single exclusive branch");
  const branch = outer.indexOf('subView === "unified" ? (');
  const selector = outer.indexOf("<InstructorScheduleCourseSelector");
  const browser = outer.indexOf("<InstructorScheduleWeekBrowser");
  assert.ok(branch < selector, "the course selector must live inside the per-course branch");
  assert.ok(branch < browser, "the week browser must live inside the per-course branch");
});

// ---------------------------------------------------------------------------
// (17) The existing per-course mode remains intact.
// ---------------------------------------------------------------------------

test("the per-course branch keeps its own selection, its remount key and its unselected prompt", () => {
  const outer = code(OUTER);
  assert.match(outer, /const \[selectedOfferingId, setSelectedOfferingId\] = useState<string \| null>\(null\)/);
  assert.match(outer, /<InstructorScheduleWeekBrowser\s+key=\{selectedOfferingId\}/);
  assert.match(outer, /selectedOfferingId === null \?/);
  // Course-derived state must still live INSIDE the keyed subtree.
  assert.equal(/setWeeks|selectedWeekId|setDayFilter/.test(outer), false, "derived state must stay in the week browser");
  assert.match(code(WEEK_BROWSER), /const \[weeks, setWeeks\]/, "the week browser is untouched");
});

// ---------------------------------------------------------------------------
// (6) No persistence, no context, no module-level mutable state.
// ---------------------------------------------------------------------------

test("neither sub-view persists anything or shares state through a back channel", () => {
  for (const file of [UNIFIED, OUTER]) {
    const body = code(file);
    assert.equal(/localStorage|sessionStorage|document\.cookie/.test(body), false, `${file} persists state`);
    assert.equal(/createContext|useContext/.test(body), false, `${file} must not use context`);
    assert.equal(/^let /m.test(body), false, `${file} must not hold module-level mutable state`);
  }
});

test("the unified view is a client component that clears its reported range on unmount", () => {
  const body = source(UNIFIED);
  assert.match(body, /^"use client";/);
  assert.ok(
    code(UNIFIED).includes("return () => onScheduleRangeChange(null);"),
    "leaving the unified view must clear the shared riding-activity range",
  );
});
