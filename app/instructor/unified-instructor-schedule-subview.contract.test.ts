/**
 * UNIFIED INSTRUCTOR SCHEDULE - SLICE IUS-2: SOURCE-CONTRACT tests for the
 * instructor schedule tab's two sub-views.
 *
 * These components transitively import "use server" modules (Prisma +
 * next/headers), so they cannot be imported into a plain `tsx --test` process.
 * This uses the repository's established SOURCE-CONTRACT pattern (same
 * technique as instructor-schedule-independence.test.ts and
 * app/student/unified-schedule-subview.contract.test.ts) to assert STRUCTURAL
 * properties a behavioural test cannot easily reach:
 *
 *  1. the unified view is a chronological STACKED list, never ScheduleTimeGrid;
 *  2. it reuses the EXISTING InstructorScheduleCard and shows source-course +
 *     overlap badges through the new extraBadges slot;
 *  3. it calls ONLY the unified readers, with no identity and no course id;
 *  4. the sub-view toggle is screen-local and stays OUT of InstructorClient;
 *  5. the existing per-course branch (selector + keyed week browser) is intact;
 *  6. no persistence, no context, no module-level mutable state anywhere.
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

// ---------------------------------------------------------------------------
// (13) Stacked list, never ScheduleTimeGrid.
// ---------------------------------------------------------------------------

test("the unified view never uses ScheduleTimeGrid", () => {
  const body = code(UNIFIED);
  assert.equal(
    /ScheduleTimeGrid/.test(body),
    false,
    "the grid's single-course group-א/group-ב column model cannot represent two offerings",
  );
});

test("the unified view renders a chronological stacked list", () => {
  const body = code(UNIFIED);
  assert.match(body, /<div className="flex flex-col gap-3">/, "expected a stacked list container");
  assert.match(body, /itemsState\.items\.map\(\(item\) =>/, "expected a flat map over the merged items");
});

test("the unified view never re-sorts or re-groups - the pure core already ordered the items", () => {
  const body = code(UNIFIED);
  assert.equal(/\.sort\(/.test(body), false, "ordering belongs to mergeUnifiedInstructorScheduleSources");
  assert.equal(/groupedByDay|new Map</.test(body), false, "the unified list must not regroup by day");
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

test("cards keep a stable, collision-free key across offerings", () => {
  // Two offerings can legitimately contribute items; keying on the offering id
  // plus the item id keeps React keys unique even in pathological data.
  assert.match(code(UNIFIED), /key=\{`\$\{item\.sourceCourseOfferingId\}:\$\{item\.id\}`\}/);
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
  assert.match(outer, /const \[subView, setSubView\] = useState<ScheduleSubView>\("unified"\)/);
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
