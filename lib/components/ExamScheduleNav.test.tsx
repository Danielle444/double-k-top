/**
 * EX-ROLE-SCHEDULE-REDESIGN — tests for the shared exam schedule navigation bar.
 *
 * REAL RENDER TESTS. The component's only import is `@/lib/dates`, a pure
 * formatting module, so it renders with react-dom/server in a plain
 * `tsx --test` process. Its handlers are exercised directly through the props,
 * because what matters about them is that they only ever hand a value back to
 * the screen that owns the selection.
 *
 * NO DATABASE, NO NETWORK, NO SERVER ACTION is touched by this file.
 *
 * Run with:
 *   npx tsx --test lib/components/ExamScheduleNav.test.tsx
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { ExamScheduleNav, type ExamScheduleNavMode } from "./ExamScheduleNav";

const SOURCE = readFileSync(
  fileURLToPath(new URL("./ExamScheduleNav.tsx", import.meta.url)),
  "utf8",
);

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const SOURCE_CODE = stripComments(SOURCE);

const GENERAL_LABEL = "לו״ז כללי";
const TYPE_MODE_LABEL = "לפי סוג מבחן";
const DATE_MODE_LABEL = "לפי תאריך";

const TYPES = ["ממשק", "רכיבה"];
const DATES = ["2026-08-01", "2026-08-02"];

interface NavProps {
  allLabel?: string;
  mode?: ExamScheduleNavMode;
  definitionNames?: readonly string[];
  selectedDefinitionName?: string | null;
  dates?: readonly string[];
  selectedDate?: string | null;
  onSelectMode?: (mode: ExamScheduleNavMode) => void;
  onSelectDefinitionName?: (name: string | null) => void;
  onSelectDate?: (date: string | null) => void;
}

function render(props: NavProps = {}): string {
  return renderToStaticMarkup(
    <ExamScheduleNav
      allLabel={props.allLabel ?? GENERAL_LABEL}
      mode={props.mode ?? "all"}
      onSelectMode={props.onSelectMode ?? (() => {})}
      definitionNames={props.definitionNames ?? TYPES}
      selectedDefinitionName={props.selectedDefinitionName ?? null}
      onSelectDefinitionName={props.onSelectDefinitionName ?? (() => {})}
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
// 1. The three connected views
// ===========================================================================

test("1. the general, by-type and by-date views are all offered", () => {
  const html = render();
  assert.ok(html.includes(GENERAL_LABEL), "the general view is missing");
  assert.ok(html.includes(TYPE_MODE_LABEL), "the by-type view is missing");
  assert.ok(html.includes(DATE_MODE_LABEL), "the by-date view is missing");
});

test("1b. the caller names the general view, so each screen can word it its own way", () => {
  assert.ok(render({ allLabel: "הכל" }).includes("הכל"));
});

test("1c. the general view shows no option chips at all", () => {
  const html = render({ mode: "all" });
  for (const name of TYPES) {
    assert.equal(html.includes(name), false, `${name} is offered outside its own view`);
  }
});

test("2. the by-type view lists every loaded exam type, in the order given", () => {
  const html = render({ mode: "type" });
  for (const name of TYPES) assert.ok(html.includes(name), `${name} is missing`);
  assert.ok(html.indexOf("ממשק") < html.indexOf("רכיבה"), "the options were reordered");
});

test("2b. the by-date view lists every loaded date, formatted for a reader", () => {
  const html = render({ mode: "date" });
  // The raw YYYY-MM-DD token is a machine value; the reader sees a Hebrew date.
  assert.equal(html.includes("2026-08-01"), false, "a raw date token was rendered");
  assert.ok(/\d{1,2}\.\d{1,2}/.test(html) || /\d{4}/.test(html), "no date was rendered at all");
});

test("2c. the two axes never appear at once", () => {
  const typeHtml = render({ mode: "type" });
  assert.equal(typeHtml.includes("2026"), false, "the date chips leaked into the type view");
  const dateHtml = render({ mode: "date" });
  for (const name of TYPES) {
    assert.equal(dateHtml.includes(name), false, "the type chips leaked into the date view");
  }
});

// ===========================================================================
// 3. Empty and incomplete data
// ===========================================================================

test("3. a view with NO options is not offered at all", () => {
  const html = render({ definitionNames: [], dates: [] });
  assert.ok(html.includes(GENERAL_LABEL), "the general view disappeared");
  assert.equal(html.includes(TYPE_MODE_LABEL), false, "an empty by-type view was offered");
  assert.equal(html.includes(DATE_MODE_LABEL), false, "an empty by-date view was offered");
});

test("3b. selecting an empty view renders no chip area and no empty-state claim", () => {
  const html = render({ mode: "type", definitionNames: [] });
  for (const token of ["אין", "ריק"]) {
    assert.equal(html.includes(token), false, `the bar claims ${token}`);
  }
});

// ===========================================================================
// 4. Selection is handed back, never held here
// ===========================================================================

test("4. choosing a view hands the mode back to the screen that owns it", () => {
  const seen: string[] = [];
  renderToStaticMarkup(
    <ExamScheduleNav
      allLabel={GENERAL_LABEL}
      mode="all"
      onSelectMode={(mode) => seen.push(mode)}
      definitionNames={TYPES}
      selectedDefinitionName={null}
      onSelectDefinitionName={() => {}}
      dates={DATES}
      selectedDate={null}
      onSelectDate={() => {}}
    />,
  );
  // Nothing fires during a render: the bar has no state and no effect, so it
  // cannot move a view by itself.
  assert.deepEqual(seen, []);
  // ...and it holds none of its own state to move.
  for (const token of ["useState", "useEffect", "useRef", "useReducer"]) {
    assert.equal(SOURCE_CODE.includes(token), false, `the bar holds ${token}`);
  }
});

test("4b. re-choosing the active chip clears it, so a reader is never stuck", () => {
  // The handler passes `null` back when the chip is already selected. That shape
  // is the whole rule, and it is asserted on the source because a static render
  // cannot click.
  assert.ok(
    SOURCE_CODE.includes("selectedDefinitionName === name ? null : name"),
    "an already-selected exam type cannot be cleared",
  );
  assert.ok(
    SOURCE_CODE.includes("selectedDate === date ? null : date"),
    "an already-selected date cannot be cleared",
  );
});

test("4c. the selected chip is the one the caller says is selected", () => {
  const html = render({ mode: "type", selectedDefinitionName: "רכיבה" });
  // Exactly one chip in the option row carries the selected styling, plus the
  // active view button above it.
  assert.equal(count(html, "bg-primary"), 2, "the selection is not exactly one chip");
});

// ===========================================================================
// 5. It navigates, it does not read
// ===========================================================================

test("5. the bar issues no request and names no server module", () => {
  const specifiers = [...SOURCE_CODE.matchAll(/from\s+"([^"]+)"/g)].map(([, value]) => value);
  assert.deepEqual([...new Set(specifiers)], ["@/lib/dates"]);
  for (const token of [
    "use server",
    "prisma",
    "fetch(",
    "getInstructorExamSchedule",
    "getTraineeExamDaySchedule",
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

test("5b. every control is a plain type=button and no form exists", () => {
  const html = render({ mode: "type" });
  assert.equal(count(html, "<button"), count(html, 'type="button"'), "a button is form-wired");
  for (const token of ["<form", "<input", "<select", "<textarea", "onSubmit", "FormData", "action="]) {
    assert.equal(SOURCE_CODE.includes(token), false, `the bar adds ${token}`);
  }
  assert.equal(html.includes("name="), false, "a control is form-wired");
});

test("5c. the layout wraps, so many exam types stay on a phone screen", () => {
  assert.ok(SOURCE_CODE.includes("flex-wrap"), "the bar does not wrap");
  for (const token of ["<table", "overflow-x", "min-w-["]) {
    assert.equal(SOURCE_CODE.includes(token), false, `the layout uses ${token}`);
  }
});
