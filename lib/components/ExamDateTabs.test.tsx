/**
 * EX-TRAINEE-DATE-NAV — REAL RENDER TESTS for the trainee date sub-tabs.
 *
 * The component's only import is `@/lib/dates`, a pure formatting module, so it
 * renders with react-dom/server in a plain `tsx --test` process. Its handler is
 * exercised through the prop, because what matters about it is that it only ever
 * hands a DATE back to the screen that owns the selection.
 *
 * NO DATABASE, NO NETWORK, NO SERVER ACTION is touched by this file.
 *
 * Run with:
 *   npx tsx --test lib/components/ExamDateTabs.test.tsx
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { ExamDateTabs } from "./ExamDateTabs";
import { earliestExamDate } from "./exam-schedule-view-core";

const SOURCE = readFileSync(
  fileURLToPath(new URL("./ExamDateTabs.tsx", import.meta.url)),
  "utf8",
);

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const SOURCE_CODE = stripComments(SOURCE);

const DATES = ["2026-08-01", "2026-08-02", "2026-08-03"];

function render(props: {
  dates?: readonly string[];
  selectedDate?: string | null;
  onSelectDate?: (date: string) => void;
} = {}): string {
  return renderToStaticMarkup(
    <ExamDateTabs
      dates={props.dates ?? DATES}
      selectedDate={props.selectedDate ?? null}
      onSelectDate={props.onSelectDate ?? (() => {})}
    />,
  );
}

/** How many times `needle` occurs in `haystack`. */
function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

// ===========================================================================
// 1. One compact sub-tab per available date
// ===========================================================================

test("1. every available date gets exactly one compact button", () => {
  const html = render();
  assert.equal(count(html, "<button"), DATES.length, "there is not one button per date");
  assert.equal(count(html, 'type="button"'), DATES.length, "a button is form-wired");
});

test("1b. the dates appear in the order the screen gave them", () => {
  // Rendered for a reader, so the raw token is not what is compared — the day
  // numbers on the Hebrew labels are, and they must run 1, 2, 3.
  const html = render();
  const dayNumbers = [...html.matchAll(/>(\d{1,2}) ב/g)].map(([, day]) => day);
  assert.deepEqual(dayNumbers, ["1", "2", "3"], "the dates were reordered or reformatted");
});

test("1c. the raw YYYY-MM-DD token is never put on screen", () => {
  const html = render();
  for (const date of DATES) {
    assert.equal(html.includes(date), false, `the raw token ${date} was rendered`);
  }
});

// ===========================================================================
// 2. The selection
// ===========================================================================

test("2. exactly one chip carries the selected styling", () => {
  const html = render({ selectedDate: "2026-08-02" });
  assert.equal(count(html, "bg-primary"), 1, "the selection is not exactly one chip");
});

test("2b. the EARLIEST date is what a screen defaults to, and it selects one chip", () => {
  // The default itself belongs to the pure core; what this proves is that the
  // value it produces lands on exactly one chip here.
  const earliest = earliestExamDate(["2026-08-03", "2026-08-01", "2026-08-02"]);
  assert.equal(earliest, "2026-08-01");
  const html = render({ selectedDate: earliest });
  assert.equal(count(html, "bg-primary"), 1);
});

test("2c. a selection outside the list highlights nothing rather than throwing", () => {
  const html = render({ selectedDate: "2026-12-25" });
  assert.equal(count(html, "bg-primary"), 0);
  assert.equal(count(html, "<button"), DATES.length, "the dates disappeared");
});

test("2d. choosing a date hands THAT DATE back, and nothing else", () => {
  // A static render cannot click, so the handler shape is asserted on the source:
  // it passes the chip's own date straight to the caller's setter. There is no
  // `null` branch — unlike the shared three-view bar, this control cannot clear
  // its selection, because "no date" is not a state a date-only schedule has.
  assert.ok(
    SOURCE_CODE.includes("onClick={() => onSelectDate(date)}"),
    "the chip does not hand its own date back",
  );
  assert.equal(
    /onSelectDate\([^)]*null/.test(SOURCE_CODE),
    false,
    "a chip can clear the selection back to no date",
  );
  const seen: string[] = [];
  renderToStaticMarkup(
    <ExamDateTabs dates={DATES} selectedDate={DATES[0]} onSelectDate={(date) => seen.push(date)} />,
  );
  // Nothing fires during a render: the bar has no state and no effect.
  assert.deepEqual(seen, []);
  for (const token of ["useState", "useEffect", "useRef", "useReducer"]) {
    assert.equal(SOURCE_CODE.includes(token), false, `the bar holds ${token}`);
  }
});

// ===========================================================================
// 3. Empty and incomplete data
// ===========================================================================

test("3. NO dates renders nothing at all — not an empty bar, not a claim", () => {
  const html = render({ dates: [] });
  assert.equal(html, "", "an empty date list rendered something");
});

test("3b. it makes no empty-state or publication claim of its own", () => {
  for (const token of ["אין", "ריק", "טיוטה", "פורסם"]) {
    assert.equal(SOURCE_CODE.includes(token), false, `the bar claims ${token}`);
  }
});

// ===========================================================================
// 4. It navigates, it does not read
// ===========================================================================

test("4. the bar issues no request and names no server module", () => {
  const specifiers = [...SOURCE_CODE.matchAll(/from\s+"([^"]+)"/g)].map(([, value]) => value);
  assert.deepEqual([...new Set(specifiers)], ["@/lib/dates"]);
  for (const token of [
    "use server",
    "prisma",
    "fetch(",
    "getTraineeExamDaySchedule",
    "getInstructorExamSchedule",
    "exam-role-readers",
    "exam-read-dto",
    "exam-read-scope-core",
    "courseOfferingId",
    "studentId",
    "sessionId",
    "planId",
    "isPublished",
    "publishedAt",
  ]) {
    assert.equal(SOURCE_CODE.includes(token), false, `the bar reaches ${token}`);
  }
});

test("4b. no form, no input and no write control exists", () => {
  for (const token of ["<form", "<input", "<select", "<textarea", "onSubmit", "FormData", "action="]) {
    assert.equal(SOURCE_CODE.includes(token), false, `the bar adds ${token}`);
  }
  assert.equal(render().includes("name="), false, "a control is form-wired");
});

test("4c. the layout wraps, so a long exam period stays on a phone screen", () => {
  assert.ok(SOURCE_CODE.includes("flex-wrap"), "the bar does not wrap");
  for (const token of ["<table", "overflow-x", "min-w-["]) {
    assert.equal(SOURCE_CODE.includes(token), false, `the layout uses ${token}`);
  }
});

// ===========================================================================
// 5. It is NOT the shared three-view bar
// ===========================================================================

test("5. no general or by-exam-type control is rendered or even named", () => {
  const html = render();
  for (const label of ["לו״ז כללי", "לפי סוג מבחן", "הכל", "לו״ז כולם"]) {
    assert.equal(html.includes(label), false, `the bar renders ${label}`);
    assert.equal(SOURCE_CODE.includes(label), false, `the bar names ${label}`);
  }
  // ...and it holds no MODE at all: date is the only axis it has.
  for (const token of ["definitionName", "ExamScheduleNavMode", 'mode ===', "onSelectMode"]) {
    assert.equal(SOURCE_CODE.includes(token), false, `the bar carries ${token}`);
  }
});
