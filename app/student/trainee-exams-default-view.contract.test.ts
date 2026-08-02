/**
 * A1 — the trainee "מבחנים" screen must default to "לו״ז שלי", not "לפי
 * תאריך", while still letting an explicit tap on "לפי תאריך" (or back to
 * "לו״ז שלי") override that default for the rest of the mounted session.
 *
 * StudentExamsSection.tsx cannot be rendered in node:test (no DOM/testing-
 * library in this project, and the component's data comes from a `use server`
 * module that pulls `server-only` - see the sibling
 * StudentExamsSectionBeginnerPlaceholder.test.tsx's own note), so this checks
 * the wiring at the source level, the same established convention.
 *
 * Run with:
 *   npx tsx --test app/student/trainee-exams-default-view.contract.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

const SRC = readSource("./StudentExamsSection.tsx");

test('1. the mode state defaults to "self" ("לו״ז שלי"), not "date"', () => {
  assert.ok(
    SRC.includes('const [mode, setMode] = useState<DayMode>("self");'),
    'the initial mode must be "self"',
  );
  assert.equal(
    SRC.includes('useState<DayMode>("date")'),
    false,
    'no code path may still default the mode to "date"',
  );
});

test("2. an explicit tap on either view button still overrides the default, via the ONE existing toggle mechanism", () => {
  assert.ok(SRC.includes('onClick={() => setMode("date")}'), '"לפי תאריך" must still switch mode to "date"');
  assert.ok(SRC.includes('onClick={() => setMode("self")}'), '"לו״ז שלי" must still switch mode to "self"');
  // setMode is called from EXACTLY these two explicit user actions and the
  // one useState initializer - nothing else in the file can silently reset
  // the mode back to a default once the trainee has picked one.
  assert.equal((SRC.match(/setMode\(/g) ?? []).length, 2, "setMode must be called from exactly the two toggle buttons");
});

test("3. the date sub-tabs and the two-view toggle are otherwise unchanged by this default flip", () => {
  assert.ok(SRC.includes('const DATE_MODE_LABEL = "לפי תאריך";'));
  assert.ok(SRC.includes('const SELF_MODE_LABEL = "לו״ז שלי";'));
  assert.ok(
    SRC.includes("<ExamDateTabs dates={dates} selectedDate={activeDate} onSelectDate={setNavDate} />"),
    "the date sub-tabs inside לפי תאריך must still exist",
  );
});

test("4. instructor and admin defaults are untouched by this trainee-only change", () => {
  const INSTRUCTOR = readSource("../instructor/InstructorExamsSection.tsx");
  assert.equal(
    INSTRUCTOR.includes('useState<ExamScheduleNavMode>("all")') ||
      INSTRUCTOR.includes('const [navMode, setNavMode] = useState<ExamScheduleNavMode>("all");'),
    true,
    "the instructor general/all default must remain unchanged",
  );
});
