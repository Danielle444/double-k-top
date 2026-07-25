/**
 * TRAINEE DUTIES WEEK VISIBILITY FIX - wiring tests.
 *
 * The BEHAVIOURAL contract of the shared loader (SCHEDULE unchanged, DUTIES
 * gated, contained empty on denial) is proven against fakes in
 * lib/course/course-scoped-week-options-core.test.ts, and the dual -> Level 1
 * resolution is proven in lib/course/actor-course-offering-core.test.ts
 * ("exception: the exact {L1, L2} pair resolves to the Level 1 offering").
 *
 * This file is STRUCTURAL: a "use server" action and a "use client" component
 * cannot be imported into node:test, so these source assertions pin the wiring
 * that ties those proven pieces together - that the duty action binds the
 * no-argument (dual -> Level 1) resolver with the DUTIES capability and accepts
 * no client course id, and that the trainee Duties tab is driven by an
 * independent duty-week state, guarded for Level-2-only trainees, and never
 * reset by a schedule-course switch.
 *
 * Run with:  npx tsx --test lib/actions/duty-week-visibility.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

/** Source with block and line comments removed - assertions test code, not prose. */
function readCode(relative: string): string {
  return readSource(relative)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const weeklyScheduleCode = readCode("./weekly-schedule.ts");
const studentClientCode = readCode("../../app/student/StudentClient.tsx");

/** The body of getDutyWeekSelectionForTrainee, up to its closing return call. */
function dutyActionBody(): string {
  const m = weeklyScheduleCode.match(
    /export async function getDutyWeekSelectionForTrainee\([\s\S]*?\n\}/,
  );
  assert.ok(m, "getDutyWeekSelectionForTrainee must exist in weekly-schedule.ts");
  return m![0];
}

// ===========================================================================
// The server action: getDutyWeekSelectionForTrainee
// ===========================================================================

test("getDutyWeekSelectionForTrainee accepts NO argument (no client course id for duties)", () => {
  assert.match(
    weeklyScheduleCode,
    /export async function getDutyWeekSelectionForTrainee\(\):\s*Promise<WeeklyScheduleSelection>/,
    "the duty week action must take no parameters and return the compact selection shape",
  );
});

test("the duty action binds the no-argument dual->Level 1 resolver, not the selectable one", () => {
  const body = dutyActionBody();
  // The committed no-argument resolver (carries the launch dual->Level 1 compat).
  assert.match(body, /resolveTraineeCourseOffering,/);
  // NOT the schedule/contacts selection resolver, and no requested id anywhere.
  assert.ok(
    !body.includes("resolveTraineeSelectedCourseOffering"),
    "duties must not follow the selectable schedule course resolver",
  );
  assert.ok(
    !body.includes("requestedCourseOfferingId"),
    "duties must not accept or thread a client-requested course id",
  );
});

test("the duty action requires the DUTIES capability and reuses the shared loader", () => {
  const body = dutyActionBody();
  assert.match(body, /loadTraineeWeeklyScheduleSelectionWithDeps\(\{/);
  assert.match(body, /requiredCapability:\s*TRAINEE_DUTIES_CAPABILITY_KEY/);
  assert.match(body, /getEffectiveCapabilities,/);
  assert.match(body, /prisma\.weeklySchedule\.findMany\(query\)/);
  assert.match(body, /todayDateKey,/);
  // No hand-rolled where clause; the query shape comes only from the pure core.
  assert.ok(!body.includes("where:"), "the action must not build its own where clause");
});

test("the duty action introduces no new auth/session mechanism", () => {
  const body = dutyActionBody();
  // Identity/offering come only from the session-derived resolver - no admin
  // gate, no direct cookie/session read, no raw SQL.
  assert.ok(!body.includes("requireAdmin"));
  assert.ok(!body.includes("cookies("));
  assert.ok(!body.includes("$queryRaw") && !body.includes("$executeRaw"));
});

// ===========================================================================
// The client: independent duty-week state, guarded, schedule-switch-immune
// ===========================================================================

test("StudentClient imports and calls the duty week action", () => {
  assert.match(studentClientCode, /getDutyWeekSelectionForTrainee/);
  assert.match(studentClientCode, /getDutyWeekSelectionForTrainee\(\)/);
});

test("the Duties tab is driven by the SEPARATE duty-week state, not the schedule weeks", () => {
  // The three separate state hooks exist.
  assert.match(studentClientCode, /const \[dutyWeeks, setDutyWeeks\] = useState/);
  assert.match(studentClientCode, /const \[dutySelectedWeekId, setDutySelectedWeekId\] = useState/);
  assert.match(studentClientCode, /const \[dutyDayFilter, setDutyDayFilter\] = useState/);

  // The duties tab block wires the picker and section to the duty state.
  const dutiesBlock = studentClientCode.match(
    /activeTab === "duties" &&[\s\S]*?<DutiesSection[\s\S]*?\/>/,
  );
  assert.ok(dutiesBlock, "the duties tab block must exist");
  const block = dutiesBlock![0];
  assert.match(block, /weeks=\{dutyWeeks\}/);
  assert.match(block, /selectedWeekId=\{dutySelectedWeekId\}/);
  assert.match(block, /startDateKey=\{dutyRangeStart\}/);
  assert.match(block, /endDateKey=\{dutyRangeEnd\}/);
  // It must NOT fall back to the schedule week state.
  assert.ok(!block.includes("weeks={weeks}"), "duties must not use the schedule weeks");
  assert.ok(
    !block.includes("selectedWeekId={selectedWeekId}"),
    "duties must not use the schedule selectedWeekId",
  );
});

test("the Duties content block is guarded by !isLevel2OnlyTrainee (defense in depth)", () => {
  assert.match(
    studentClientCode,
    /activeTab === "duties" &&\s*!courseOptionsLoading &&\s*!isLevel2OnlyTrainee\(eligibleCourseOptions\)/,
    "the duties content must render nothing for a Level-2-only (or still-loading) trainee",
  );
});

test("the duty-week effect depends only on [session], so a schedule-course switch never resets it", () => {
  // Isolate the effect that loads the duty weeks.
  const effect = studentClientCode.match(
    /getDutyWeekSelectionForTrainee\(\)[\s\S]*?\}, \[[^\]]*\]\);/,
  );
  assert.ok(effect, "the duty-week effect must exist");
  const effectSrc = effect![0];
  // Its dependency array is exactly [session] - NOT keyed on the selected course.
  assert.match(effectSrc, /\}, \[session\]\);/);
  assert.ok(
    !effectSrc.includes("selectedCourseOfferingId"),
    "the duty-week effect must not depend on the selected schedule course",
  );
});

test("the schedule effect is unchanged: still keyed on selectedCourseOfferingId, and never touches duty state", () => {
  const scheduleEffect = studentClientCode.match(
    /getWeeklyScheduleSelectionForTrainee\(selectedCourseOfferingId\)[\s\S]*?\}, \[session, courseOptions, selectedCourseOfferingId\]\);/,
  );
  assert.ok(scheduleEffect, "the schedule effect must still be keyed on the selected course");
  const src = scheduleEffect![0];
  // The schedule path must not write any duty-week state.
  assert.ok(!src.includes("setDutyWeeks"));
  assert.ok(!src.includes("setDutySelectedWeekId"));
  assert.ok(!src.includes("setDutyDayFilter"));
});
