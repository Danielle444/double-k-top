/**
 * LEVEL 2 SCHEDULE SLICE S2A - SOURCE-CONTRACT tests for the screen-local
 * instructor course selection.
 *
 * These assert STRUCTURAL properties that a behavioural test cannot easily
 * reach, by reading the component sources as text (the same technique the
 * committed student-schedule.course-scope.test.ts and
 * instructor-offering-options-core.test.ts already use):
 *
 *  1. no global course state - InstructorClient holds no offering id at all;
 *  2. the three selections (schedule tab, today card, contacts tab) are separate
 *     component-local useState hooks that cannot reach one another;
 *  3. course-derived state is cleared on switch by key={selectedOfferingId};
 *  4. no persistence - no localStorage, cookie or database anywhere in the
 *     schedule selection path;
 *  5. no global instructor schedule reader survives.
 *
 * Run with:
 *   npx tsx --test app/instructor/instructor-schedule-independence.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");

function source(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

const CLIENT = "app/instructor/InstructorClient.tsx";
const SCHEDULE_OUTER = "app/instructor/InstructorCourseScopedScheduleSection.tsx";
const SCHEDULE_INNER = "app/instructor/InstructorScheduleWeekBrowser.tsx";
const TODAY_CARD = "app/instructor/InstructorTodayScheduleCard.tsx";
const SELECTOR = "app/instructor/InstructorScheduleCourseSelector.tsx";
const SECTION = "app/instructor/InstructorScheduleSection.tsx";
const CONTACTS_OUTER = "app/instructor/InstructorCourseScopedContactsSection.tsx";
const CONTACTS_INNER = "app/instructor/InstructorContactsSection.tsx";
const LEGACY_ACTION = "lib/actions/instructor-schedule.ts";
const SCOPED_ACTION = "lib/actions/instructor-schedule-course-scoped.ts";

/** Strips block and line comments so prose about a rule can't satisfy the rule. */
function code(relativePath: string): string {
  return source(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}

// ---------------------------------------------------------------------------
// 1. No global course state
// ---------------------------------------------------------------------------

test("InstructorClient holds NO course offering state of any kind", () => {
  const body = code(CLIENT);
  assert.equal(
    /courseOfferingId/.test(body),
    false,
    "InstructorClient must not name a courseOfferingId",
  );
  assert.equal(
    /selectedOfferingId/.test(body),
    false,
    "InstructorClient must not hold a selected offering",
  );
});

test("InstructorClient holds ONLY the riding date range the schedule screens report", () => {
  const body = code(CLIENT);
  assert.match(body, /const \[scheduleRange, setScheduleRange\] = useState</);
  assert.match(body, /handleScheduleRangeChange = useCallback\(/);
  // The range is a pair of date keys - nothing course-shaped.
  assert.match(body, /\{ start: string; end: string \} \| null/);
});

// ---------------------------------------------------------------------------
// 2. Three independent, screen-local selections
// ---------------------------------------------------------------------------

test("each of the three screens owns its OWN selection hook", () => {
  for (const file of [SCHEDULE_OUTER, TODAY_CARD, CONTACTS_OUTER]) {
    assert.match(
      code(file),
      /const \[selectedOfferingId, setSelectedOfferingId\] = useState<string \| null>\(null\)/,
      `${file} must own a local, null-initialised selection`,
    );
  }
});

test("the schedule screens never import contacts, and never each other's state", () => {
  for (const file of [SCHEDULE_OUTER, SCHEDULE_INNER, TODAY_CARD, SELECTOR, SECTION]) {
    const body = source(file);
    assert.equal(
      /InstructorContactsSection|InstructorCourseScopedContactsSection|ContactsSection/.test(
        body.replace(/\/\*[\s\S]*?\*\//g, ""),
      ),
      false,
      `${file} must not reference any contacts component`,
    );
  }
  // The today card and the schedule tab are siblings: neither imports the other.
  assert.equal(/InstructorTodayScheduleCard/.test(code(SCHEDULE_OUTER)), false);
  assert.equal(/InstructorCourseScopedScheduleSection/.test(code(TODAY_CARD)), false);
});

test("no React context or module-level variable could share a selection", () => {
  for (const file of [SCHEDULE_OUTER, SCHEDULE_INNER, TODAY_CARD, SELECTOR]) {
    const body = code(file);
    assert.equal(/createContext|useContext/.test(body), false, `${file} must not use context`);
    // A module-scope `let` would outlive the component and leak across mounts.
    assert.equal(/^let /m.test(body), false, `${file} must not hold module-level state`);
  }
});

// ---------------------------------------------------------------------------
// 3. Course switch clears everything derived
// ---------------------------------------------------------------------------

test("both schedule screens mount their derived subtree with key={selectedOfferingId}", () => {
  assert.match(
    code(SCHEDULE_OUTER),
    /<InstructorScheduleWeekBrowser\s+key=\{selectedOfferingId\}/,
    "the schedule tab must remount the week browser on course switch",
  );
  assert.match(
    code(TODAY_CARD),
    /<InstructorScheduleSection\s+key=\{selectedOfferingId\}/,
    "the today card must remount the item view on course switch",
  );
});

test("all course-derived state lives INSIDE the keyed subtree, not beside the selector", () => {
  // If the outer components held weeks/day state, the key would not clear it.
  for (const file of [SCHEDULE_OUTER, TODAY_CARD]) {
    const body = code(file);
    assert.equal(/setWeeks|selectedWeekId|setDayFilter/.test(body), false, `${file} leaks derived state`);
  }
  const inner = code(SCHEDULE_INNER);
  assert.match(inner, /const \[weeks, setWeeks\]/);
  assert.match(inner, /const \[selectedWeekId, setSelectedWeekId\]/);
  assert.match(inner, /const \[dayFilter, setDayFilter\]/);
});

test("nothing is requested before a course is selected", () => {
  for (const file of [SCHEDULE_OUTER, TODAY_CARD]) {
    assert.match(
      code(file),
      /selectedOfferingId === null \?/,
      `${file} must render a prompt instead of a reader while unselected`,
    );
  }
});

// ---------------------------------------------------------------------------
// 4. No persistence
// ---------------------------------------------------------------------------

test("the schedule selection is never persisted", () => {
  for (const file of [SCHEDULE_OUTER, SCHEDULE_INNER, TODAY_CARD, SELECTOR, SECTION]) {
    const body = code(file);
    assert.equal(/localStorage|sessionStorage|document\.cookie/.test(body), false, `${file} persists selection`);
  }
});

// ---------------------------------------------------------------------------
// 5. No global instructor schedule reader survives
// ---------------------------------------------------------------------------

test("the legacy global getScheduleForInstructor is gone", () => {
  assert.equal(
    /getScheduleForInstructor/.test(code(LEGACY_ACTION)),
    false,
    "the legacy global reader must be deleted, not merely unused",
  );
});

test("every instructor schedule read goes through the course-scoped action", () => {
  const section = code(SECTION);
  assert.match(section, /from "@\/lib\/actions\/instructor-schedule-course-scoped"/);
  assert.match(section, /getCourseScopedScheduleForInstructor\(/);
  assert.match(section, /getTodayScheduleForInstructor\(/);
  // Identity is never a prop.
  assert.equal(/instructorId/.test(section), false, "the section must not take an instructorId");
});

test("the scoped actions accept no instructor id and gate in the required order", () => {
  const body = code(SCOPED_ACTION);
  assert.match(body, /requireCurrentInstructor\(\)/);
  assert.match(body, /resolveInstructorCourseOffering/);
  assert.match(body, /getEffectiveCapabilities/);
  // No exported action may take an instructorId parameter.
  assert.equal(/instructorId/.test(body), false);
});

// ---------------------------------------------------------------------------
// Contacts must be untouched by this slice
// ---------------------------------------------------------------------------

test("the contacts components still use their own selector and reader", () => {
  const outer = code(CONTACTS_OUTER);
  assert.match(outer, /listInstructorContactCourseOptions\(\)/);
  assert.match(outer, /<InstructorContactsSection\s+key=\{selectedOfferingId\}/);
  // Contacts must not have been rewired onto any schedule component.
  assert.equal(/InstructorScheduleCourseSelector/.test(outer), false);
  assert.match(code(CONTACTS_INNER), /getStudentContacts\(courseOfferingId\)/);
});
