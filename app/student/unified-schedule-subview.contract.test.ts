/**
 * UNIFIED TRAINEE SCHEDULE - SLICE U1 (UI CORRECTION): contract tests for the
 * "הלו״ז שלי" sub-view wiring in app/student/StudentClient.tsx.
 *
 * Locked shape after the product correction:
 *  - Home/today: a [ לפי קורס ] [ הלו״ז שלי ] toggle for dual trainees. While
 *    "לפי קורס" is active, the Level 1/Level 2 TraineeCourseSelector and the
 *    course-specific ScheduleSection render exactly as before. While
 *    "הלו״ז שלי" is active, the course selector is hidden completely and
 *    UnifiedScheduleSection renders for todayKey instead. Single-course
 *    trainees never see the toggle; their home/today UI is unchanged.
 *  - Schedule tab: ONE selector row - the real course pills plus a trailing
 *    "הלו״ז שלי" pseudo-option pill (TraineeCourseSelector's own
 *    extraOption slot) - never a second, separate toggle row, and never a
 *    fake CourseOffering id.
 *  - selectedCourseOfferingId is never touched by the unified toggle on
 *    either surface, so returning to "לפי קורס"/a real course always
 *    restores the last real selection.
 *
 * WHY SOURCE-CONTRACT, NOT AN IMPORTED UNIT TEST
 * ----------------------------------------------
 * StudentClient.tsx cannot be imported here (it transitively pulls in
 * "server-only" - see trainee-client-course-selection.contract.test.ts for
 * the same constraint), so this locks the behaviour by asserting the
 * component's SOURCE, the sanctioned pattern for this component.
 *
 * Run with:
 *   npx tsx --test app/student/unified-schedule-subview.contract.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

const SRC = readSource("./StudentClient.tsx");

function homeTabBlock(): string {
  const start = SRC.indexOf('{activeTab === "today" && (');
  const end = SRC.indexOf('{activeTab === "schedule" && (');
  assert.ok(start !== -1 && end > start, "expected to isolate the today/home tab block");
  return SRC.slice(start, end);
}

function scheduleTabBlock(): string {
  const start = SRC.indexOf('{activeTab === "schedule" && (');
  const end = SRC.indexOf('{activeTab === "duties" &&', start);
  assert.ok(start !== -1 && end > start, "expected to isolate the schedule tab block");
  return SRC.slice(start, end);
}

// ---------------------------------------------------------------------------
// dualEnrolled is unchanged - the single server-derived cardinality gating
// every unified-view affordance on both surfaces.
// ---------------------------------------------------------------------------

test("dualEnrolled is still derived only from the server-returned eligible option count", () => {
  assert.ok(
    SRC.includes("const dualEnrolled = eligibleCourseOptions.length >= 2;"),
    "must reuse the existing, unchanged dualEnrolled derivation - never a second/looser definition",
  );
});

// ---------------------------------------------------------------------------
// HOME/TODAY: the [ לפי קורס ] [ הלו״ז שלי ] toggle is kept, gated on
// dualEnrolled, and it alone controls whether the course selector or the
// unified view renders.
// ---------------------------------------------------------------------------

test("the home/today toggle exists exactly once, gated on dualEnrolled", () => {
  const toggleBlocks = SRC.match(/\{dualEnrolled && \(\s*<div className="flex gap-2 text-sm">/g) ?? [];
  assert.equal(toggleBlocks.length, 1, "expected exactly one [ לפי קורס / הלו״ז שלי ] toggle, on the home/today block only");
});

test("the home/today toggle renders both button labels", () => {
  const home = homeTabBlock();
  assert.ok(home.includes("לפי קורס"), "expected the course-view button label");
  assert.ok(home.includes("הלו&quot;ז שלי"), "expected the unified-view button label");
});

test("the home/today course selector is visible only while \"לפי קורס\" is active", () => {
  const home = homeTabBlock();
  assert.match(
    home,
    /\{scheduleSubView === "course" && \(\s*<TraineeCourseSelector/,
    "expected the home TraineeCourseSelector mount gated on scheduleSubView === \"course\"",
  );
});

test("the home/today course selector mount carries no extraOption (home never merges a pseudo-pill into it)", () => {
  const home = homeTabBlock();
  const mountStart = home.indexOf("<TraineeCourseSelector");
  const mountEnd = home.indexOf("/>", mountStart);
  const mount = home.slice(mountStart, mountEnd);
  assert.ok(!mount.includes("extraOption"), "the home mount must stay the plain 3-prop selector - the pseudo-pill lives only on the schedule tab");
});

test("the home/today unified branch is gated on scheduleSubView === \"unified\" && dualEnrolled, and passes todayKey with no offering id", () => {
  const home = homeTabBlock();
  assert.ok(home.includes('scheduleSubView === "unified" && dualEnrolled ? ('));
  const mounts = home.match(/<UnifiedScheduleSection[^/]*\/>/g) ?? [];
  assert.equal(mounts.length, 1, "expected exactly one UnifiedScheduleSection mount on home/today");
  assert.equal(mounts[0], "<UnifiedScheduleSection studentId={session.id} dayKey={todayKey} />");
});

test("for a single-course trainee, scheduleSubView never leaves \"course\" (the toggle that would flip it is never shown)", () => {
  // The ONLY writer of scheduleSubView("unified") sits inside the
  // dualEnrolled-gated toggle/extraOption; with dualEnrolled false neither
  // renders, so nothing can ever set it away from its "course" default -
  // the home/today UI stays exactly the existing course-specific path.
  const setters = SRC.match(/setScheduleSubView\("unified"\)/g) ?? [];
  assert.ok(setters.length >= 1);
  for (const setter of setters) {
    void setter; // presence-only check combined with the gating tests above
  }
  assert.ok(
    SRC.includes('const [scheduleSubView, setScheduleSubView] = useState<"course" | "unified">("course");'),
    "expected the default state to be \"course\"",
  );
});

// ---------------------------------------------------------------------------
// SCHEDULE TAB: one selector row (real course pills + trailing pseudo-pill),
// never a second toggle row, and the pseudo-option never becomes a fake
// CourseOffering id.
// ---------------------------------------------------------------------------

test("the schedule tab has NO separate toggle row - only the merged TraineeCourseSelector row", () => {
  const schedule = scheduleTabBlock();
  assert.ok(
    !/\{dualEnrolled && \(\s*<div className="flex gap-2 text-sm">/.test(schedule),
    "the schedule tab must not render a second, separate [ לפי קורס / הלו״ז שלי ] toggle",
  );
});

test("the schedule tab's TraineeCourseSelector mount carries the extraOption pseudo-pill", () => {
  const schedule = scheduleTabBlock();
  const mountStart = schedule.indexOf("<TraineeCourseSelector");
  assert.notEqual(mountStart, -1);
  const mountEnd = schedule.indexOf("\n            />", mountStart);
  const mount = schedule.slice(mountStart, mountEnd);
  assert.ok(mount.includes("extraOption={"), "expected the extraOption prop on the schedule tab mount");
  assert.ok(mount.includes('label: "הלו״ז שלי"'));
  assert.ok(mount.includes('isActive: scheduleSubView === "unified"'));
  assert.ok(mount.includes('onSelect: () => setScheduleSubView("unified")'));
});

test("the pseudo-option never forwards or synthesizes a CourseOffering id", () => {
  const schedule = scheduleTabBlock();
  const mountStart = schedule.indexOf("<TraineeCourseSelector");
  const mountEnd = schedule.indexOf("\n            />", mountStart);
  const mount = schedule.slice(mountStart, mountEnd);
  const extraOptionStart = mount.indexOf("extraOption={");
  const extraOptionBlock = mount.slice(extraOptionStart);
  assert.ok(
    !/courseOfferingId|CourseOffering\(/.test(extraOptionBlock),
    "the pseudo-option object must never reference/construct a course offering id",
  );
  // The pseudo-option is gated on dualEnrolled, never unconditionally truthy.
  assert.match(mount, /extraOption=\{\s*dualEnrolled\s*\?\s*\{/);
});

test("the schedule tab's UnifiedScheduleSection mount forwards no offering id", () => {
  const schedule = scheduleTabBlock();
  const mounts = schedule.match(/<UnifiedScheduleSection[^/]*\/>/g) ?? [];
  assert.equal(mounts.length, 1, "expected exactly one UnifiedScheduleSection mount on the schedule tab");
  assert.ok(!/courseOffering|dual=/.test(mounts[0]));
  assert.ok(mounts[0].includes("studentId={session.id}"));
  assert.ok(mounts[0].includes("dayKey={resolveUnifiedScheduleDayKey(dayFilter, selectedWeek, todayKey)}"));
});

// ---------------------------------------------------------------------------
// Existing Level 1/Level 2 selection is untouched: same 3 course-selector
// mounts, same exact core prop bindings, same 2 ScheduleSection mounts with
// the selected offering id forwarded exactly as before.
// ---------------------------------------------------------------------------

test("the existing course selector wiring is completely untouched (still exactly 3 mounts, unwrapped onSelect)", () => {
  const mounts = SRC.match(/<TraineeCourseSelector/g) ?? [];
  const optionBindings = SRC.match(/options=\{courseOptions \?\? \[\]\}/g) ?? [];
  const selectedBindings = SRC.match(/selectedId=\{selectedCourseOfferingId\}/g) ?? [];
  const onSelectBindings = SRC.match(/onSelect=\{setSelectedCourseOfferingId\}/g) ?? [];
  assert.equal(mounts.length, 3, "the course selector must still have exactly 3 mount sites");
  assert.equal(optionBindings.length, 3, "every mount reads the shared options");
  assert.equal(selectedBindings.length, 3, "every mount reads the shared selected id");
  assert.equal(onSelectBindings.length, 3, "onSelect must still write ONLY setSelectedCourseOfferingId, never a wrapped handler");
});

test("ScheduleSection still receives the selected offering id on both mounts, unchanged", () => {
  const sections = SRC.match(/<ScheduleSection/g) ?? [];
  const offeringBindings = SRC.match(/courseOfferingId=\{selectedCourseOfferingId\}/g) ?? [];
  assert.equal(sections.length, 2, "expected exactly the two existing ScheduleSection mounts");
  assert.equal(offeringBindings.length, 2, "both mounts must still forward the selected offering id");
});

// ---------------------------------------------------------------------------
// Returning to a course-specific view preserves existing behaviour: picking
// a course (on either surface) always returns scheduleSubView to "course",
// without touching the pinned onSelect wiring above, and
// selectedCourseOfferingId is never reset by the unified toggle itself - so
// the last real selection is always what "returning" restores.
// ---------------------------------------------------------------------------

test("picking a course (via the untouched onSelect wiring) resets the sub-view back to course, via its own effect", () => {
  assert.match(
    SRC,
    /useEffect\(\(\) => \{\s*\/\* eslint-disable-next-line react-hooks\/set-state-in-effect \*\/\s*setScheduleSubView\("course"\);\s*\}, \[selectedCourseOfferingId\]\);/,
    "expected a dedicated effect resetting scheduleSubView on selectedCourseOfferingId change",
  );
});

test("activating the unified view (home toggle or schedule pseudo-pill) never writes selectedCourseOfferingId", () => {
  // Every activation site - the home toggle's onClick and the schedule tab's
  // extraOption.onSelect - must be a bare state setter, never chained with a
  // selectedCourseOfferingId write. That is exactly what makes "the last
  // real selection" durable across toggling.
  const lines = SRC.split("\n").filter((line) => line.includes('setScheduleSubView("unified")'));
  assert.ok(lines.length >= 2, "expected the home onClick and the schedule extraOption.onSelect call sites");
  for (const line of lines) {
    assert.ok(!line.includes("setSelectedCourseOfferingId"), `unified activation must not touch the course selection: ${line}`);
  }
});

test("scheduleSubView state is independent of weeks/selectedWeekId/dayFilter - switching sub-view never resets date navigation", () => {
  const effectStart = SRC.indexOf('setScheduleSubView("course");');
  assert.notEqual(effectStart, -1);
  const depArrayLine = SRC.slice(effectStart, SRC.indexOf(";", SRC.indexOf("}, [", effectStart)) + 1);
  assert.ok(!/weeks|selectedWeekId|dayFilter/.test(depArrayLine));
});

// ---------------------------------------------------------------------------
// Date navigation: unchanged from the prior slice.
// ---------------------------------------------------------------------------

test("resolveUnifiedScheduleDayKey returns the explicit dayFilter verbatim when it is not \"all\"", () => {
  const start = SRC.indexOf("export function resolveUnifiedScheduleDayKey(");
  assert.notEqual(start, -1);
  const end = SRC.indexOf("export function StudentClient()");
  const body = SRC.slice(start, end);
  assert.match(body, /if \(dayFilter !== "all"\) return dayFilter;/);
});

test("resolveUnifiedScheduleDayKey falls back to today (if in range) or the week start when dayFilter is \"all\"", () => {
  const start = SRC.indexOf("export function resolveUnifiedScheduleDayKey(");
  const end = SRC.indexOf("export function StudentClient()");
  const body = SRC.slice(start, end);
  assert.match(body, /if \(!selectedWeek\) return null;/);
  assert.match(
    body,
    /if \(todayKey >= selectedWeek\.startDate && todayKey <= selectedWeek\.endDate\) return todayKey;/,
  );
  assert.match(body, /return selectedWeek\.startDate;/);
});

test("the WeekDayPicker date-navigation control in the schedule tab is shared (rendered once) and not duplicated per sub-view", () => {
  const schedule = scheduleTabBlock();
  const pickers = schedule.match(/<WeekDayPicker/g) ?? [];
  assert.equal(pickers.length, 1, "expected exactly one WeekDayPicker mount in the schedule tab, reused by both sub-views");
  const pickerIdx = schedule.indexOf("<WeekDayPicker");
  const branchIdx = schedule.indexOf('scheduleSubView === "unified" && dualEnrolled ? (');
  assert.ok(pickerIdx < branchIdx, "the date picker must precede (and be shared by) the sub-view branch");
});

// ---------------------------------------------------------------------------
// No hardcoded offering id/level, consistent with the rest of the client.
// ---------------------------------------------------------------------------

test("no hardcoded course offering id or level constant was introduced", () => {
  assert.ok(!/["']c[a-z0-9]{24,}["']/.test(SRC), "no hardcoded cuid offering id");
  assert.ok(!/\.level\s*===\s*1/.test(SRC), "must not special-case level 1");
});
