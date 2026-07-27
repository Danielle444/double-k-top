/**
 * INSTRUCTOR TODAY SURFACE - SLICE IUS-2B: SOURCE-CONTRACT tests for the Today
 * card's three destinations.
 *
 * app/instructor/InstructorTodayScheduleCard.tsx transitively imports "use
 * server" modules (Prisma + next/headers), so it cannot be imported into a
 * plain `tsx --test` process. This uses the repository's established
 * SOURCE-CONTRACT pattern to assert:
 *
 *  - the existing per-course options survive, still supplied by the SHARED,
 *    server-composed course selector (this slice adds no second label source);
 *  - a third destination, "הלו״ז המשולב שלי", is offered;
 *  - exactly ONE mode mounts at a time, so the unselected mode issues no request;
 *  - the unified branch sends no identity, no course id, no date and no filter;
 *  - the per-course branch is byte-for-byte the committed behaviour;
 *  - the Today selection and the new mode both stay OUT of InstructorClient.
 *
 * Run with:
 *   npx tsx --test app/instructor/instructor-today-schedule-selector.contract.test.ts
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

const TODAY_CARD = "app/instructor/InstructorTodayScheduleCard.tsx";
const SELECTOR = "app/instructor/InstructorScheduleCourseSelector.tsx";
const CLIENT = "app/instructor/InstructorClient.tsx";

// ---------------------------------------------------------------------------
// (5)(6) All three destinations.
// ---------------------------------------------------------------------------

test("the Today card still offers the existing per-course choices via the SHARED selector", () => {
  const body = code(TODAY_CARD);
  assert.match(body, /import \{ InstructorScheduleCourseSelector \} from "\.\/InstructorScheduleCourseSelector";/);
  assert.match(body, /<InstructorScheduleCourseSelector/);
  assert.match(body, /selectedOfferingId=\{selectedOfferingId\}/);
  assert.match(body, /onSelectOffering=\{setSelectedOfferingId\}/);
});

test("course option labels still come from the server-composed menu, not a new client list", () => {
  // The shared selector owns the labels; the Today card must not hardcode any
  // course name or level text of its own.
  const body = code(TODAY_CARD);
  assert.equal(/רמה 1|רמה 2|option\.label/.test(body), false,
    "the Today card must not compose course labels itself");
  assert.match(code(SELECTOR), /\{option\.label\}/, "the shared selector still renders the server label");
});

test("the Today card adds the unified destination", () => {
  const body = code(TODAY_CARD);
  assert.ok(body.includes('הלו&quot;ז המשולב שלי'), "expected the unified option label");
  assert.ok(body.includes("לפי קורס"), "expected the per-course option label");
  assert.match(body, /const \[todayMode, setTodayMode\] = useState<TodayScheduleMode>\("unified"\)/);
});

// ---------------------------------------------------------------------------
// (13) Exactly one mode mounts / requests at a time.
// ---------------------------------------------------------------------------

test("exactly one Today branch is mounted, so the other issues no request", () => {
  const body = code(TODAY_CARD);
  const branch = body.indexOf('todayMode === "unified" ? (');
  assert.notEqual(branch, -1, "expected a single exclusive branch");
  const unified = body.indexOf("<UnifiedInstructorScheduleSection");
  const selector = body.indexOf("<InstructorScheduleCourseSelector");
  const scoped = body.indexOf("<InstructorScheduleSection");
  assert.ok(branch < unified, "the unified view must live inside the unified branch");
  assert.ok(unified < selector, "the course selector must live in the later per-course branch");
  assert.ok(selector < scoped, "the course-scoped reader must live in the per-course branch");
});

test("the unified Today branch is mounted in today mode", () => {
  assert.match(code(TODAY_CARD), /<UnifiedInstructorScheduleSection\s+mode="today"/);
});

// ---------------------------------------------------------------------------
// (7)(8) No client identity, no client course id, no date, no filter.
// ---------------------------------------------------------------------------

test("the Today card passes no instructorId anywhere", () => {
  assert.equal(/instructorId/.test(code(TODAY_CARD)), false);
});

test("the unified branch receives no courseOfferingId", () => {
  const body = code(TODAY_CARD);
  const unified = body.indexOf("<UnifiedInstructorScheduleSection");
  const unifiedEnd = body.indexOf("/>", unified);
  const props = body.slice(unified, unifiedEnd);
  assert.equal(/courseOfferingId|selectedOfferingId/.test(props), false,
    "the unified view must not be handed a course context");
  assert.equal(/filter/i.test(props), false, "the unified view must not be handed a filter");
});

test("todayKey reaches the unified view for range reporting only, never a reader", () => {
  const body = code(TODAY_CARD);
  assert.match(body, /todayKey=\{todayKey\}/);
  // The card itself still never sends a date to a schedule reader.
  assert.equal(/getTodayScheduleForInstructor\(|getUnifiedTodayScheduleForInstructor\(/.test(body), false,
    "the card mounts components; it calls no reader directly");
});

// ---------------------------------------------------------------------------
// The committed per-course behaviour is untouched.
// ---------------------------------------------------------------------------

test("the per-course branch keeps its selection, remount key and unselected prompt", () => {
  const body = code(TODAY_CARD);
  assert.match(body, /const \[selectedOfferingId, setSelectedOfferingId\] = useState<string \| null>\(null\)/);
  assert.match(body, /<InstructorScheduleSection\s+key=\{selectedOfferingId\}/);
  assert.match(body, /selectedOfferingId === null \?/);
  assert.match(body, /mode="today"\s*\n\s*courseOfferingId=\{selectedOfferingId\}/);
});

test("no course-derived state leaks beside the selector", () => {
  const body = code(TODAY_CARD);
  assert.equal(/setWeeks|selectedWeekId|setDayFilter/.test(body), false);
});

// ---------------------------------------------------------------------------
// (17) InstructorClient still owns nothing.
// ---------------------------------------------------------------------------

test("InstructorClient owns no course selection and no Today mode state", () => {
  const client = code(CLIENT);
  assert.equal(/courseOfferingId|selectedOfferingId/.test(client), false,
    "InstructorClient must still hold no course state of any kind");
  assert.equal(/todayMode|TodayScheduleMode|subView|UnifiedInstructorScheduleSection/.test(client), false,
    "the unified mode must not be hoisted into InstructorClient");
});

// ---------------------------------------------------------------------------
// No persistence / no back channel.
// ---------------------------------------------------------------------------

test("the Today mode is screen-local and never persisted", () => {
  const body = code(TODAY_CARD);
  assert.equal(/localStorage|sessionStorage|document\.cookie/.test(body), false);
  assert.equal(/createContext|useContext/.test(body), false);
  assert.equal(/^let /m.test(body), false);
});
