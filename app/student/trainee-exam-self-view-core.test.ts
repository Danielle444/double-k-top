/**
 * REAL behavioral tests for the PURE core behind "לו״ז שלי"'s merge of the
 * trainee's advanced exam rows and their real beginner Teaching-Practice
 * lessons.
 *
 * Unlike the section components (which pull the `server-only` chain
 * transitively through their Server Action imports), this module has none of
 * that: its only runtime import is the pure `isBeginnerExamRow` predicate, and
 * every other import here is type-only and erased at build. It is therefore
 * imported and called DIRECTLY, with real inputs and real assertions on the
 * real return values - not a source-text regex proxy.
 *
 * Run with:
 *   npx tsx --test app/student/trainee-exam-self-view-core.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSelfViewEntries,
  collectBeginnerExamDates,
  filterBeginnerLessonsForExamDays,
  type ExamRow,
} from "./trainee-exam-self-view-core";
import type { TeachingPracticeTraineeLessonRow } from "@/lib/actions/teaching-practice-student";

// Fixture factories return only the fields these PURE functions actually
// read (date/startTime/source for exam rows; id/date/startTime/practiceType
// for lessons) - cast to the real DTO shape since these functions never
// touch any other field, so a fixture missing the rest is a faithful test
// double, not a shortcut around real behavior.
function examRow(overrides: Partial<ExamRow> = {}): ExamRow {
  return {
    rowKey: "r1",
    date: "2026-08-10",
    startTime: "09:00",
    source: "STORED",
    definitionName: "מבחן רכיבה",
    displayEndTime: null,
    arena: null,
    location: null,
    selfLabel: null,
    personalSlots: [],
    isSelf: true,
    assignments: [],
    ...overrides,
  } as unknown as ExamRow;
}

function beginnerExamRow(overrides: Partial<ExamRow> = {}): ExamRow {
  return examRow({ source: "BEGINNER", ...overrides } as Partial<ExamRow>);
}

function lesson(overrides: Partial<TeachingPracticeTraineeLessonRow> = {}): TeachingPracticeTraineeLessonRow {
  return {
    id: "lesson-1",
    date: "2026-08-10",
    startTime: "09:00",
    endTime: "10:00",
    practiceType: "BEGINNER_PRIVATE",
    groupName: "א",
    location: null,
    responsibleInstructorName: null,
    participants: [],
    children: [],
    ...overrides,
  } as unknown as TeachingPracticeTraineeLessonRow;
}

// ===========================================================================
// collectBeginnerExamDates
// ===========================================================================

test("collectBeginnerExamDates: collects only the dates of BEGINNER-source rows", () => {
  const rows = [
    examRow({ date: "2026-08-01", source: "STORED" }),
    beginnerExamRow({ date: "2026-08-02" }),
    beginnerExamRow({ date: "2026-08-03" }),
  ];
  assert.deepEqual(collectBeginnerExamDates(rows), new Set(["2026-08-02", "2026-08-03"]));
});

test("collectBeginnerExamDates: a date with only STORED rows is not included", () => {
  const rows = [examRow({ date: "2026-08-05", source: "STORED" })];
  assert.deepEqual(collectBeginnerExamDates(rows), new Set());
});

test("collectBeginnerExamDates: an empty row list yields an empty set", () => {
  assert.deepEqual(collectBeginnerExamDates([]), new Set());
});

test("collectBeginnerExamDates: duplicate dates across multiple beginner rows collapse to one entry", () => {
  const rows = [
    beginnerExamRow({ date: "2026-08-02", rowKey: "a" }),
    beginnerExamRow({ date: "2026-08-02", rowKey: "b" }),
  ];
  assert.deepEqual(collectBeginnerExamDates(rows), new Set(["2026-08-02"]));
});

// ===========================================================================
// filterBeginnerLessonsForExamDays
// ===========================================================================

test("filterBeginnerLessonsForExamDays: includes a LUNGE lesson on a relevant exam day", () => {
  const dates = new Set(["2026-08-10"]);
  const lessons = [lesson({ id: "lunge", practiceType: "LUNGE", date: "2026-08-10" })];
  assert.deepEqual(
    filterBeginnerLessonsForExamDays(lessons, dates).map((l) => l.id),
    ["lunge"],
  );
});

test("filterBeginnerLessonsForExamDays: includes BEGINNER_PRIVATE, BEGINNER_GROUP, and LUNGE together on a relevant date", () => {
  const dates = new Set(["2026-08-10"]);
  const lessons = [
    lesson({ id: "private", practiceType: "BEGINNER_PRIVATE", date: "2026-08-10" }),
    lesson({ id: "group", practiceType: "BEGINNER_GROUP", date: "2026-08-10" }),
    lesson({ id: "lunge", practiceType: "LUNGE", date: "2026-08-10" }),
  ];
  assert.deepEqual(
    filterBeginnerLessonsForExamDays(lessons, dates).map((l) => l.id),
    ["private", "group", "lunge"],
  );
});

test("filterBeginnerLessonsForExamDays: excludes a beginner lesson on a date NOT in the exam-day set", () => {
  const dates = new Set(["2026-08-10"]);
  const lessons = [lesson({ id: "elsewhere", practiceType: "BEGINNER_GROUP", date: "2026-09-01" })];
  assert.deepEqual(filterBeginnerLessonsForExamDays(lessons, dates), []);
});

test("filterBeginnerLessonsForExamDays: an empty exam-day set excludes everything", () => {
  const lessons = [lesson({ practiceType: "BEGINNER_PRIVATE", date: "2026-08-10" })];
  assert.deepEqual(filterBeginnerLessonsForExamDays(lessons, new Set()), []);
});

test("filterBeginnerLessonsForExamDays: an empty lesson list (e.g. a denied/Level-2-only trainee) yields no cards", () => {
  assert.deepEqual(filterBeginnerLessonsForExamDays([], new Set(["2026-08-10"])), []);
});

// ===========================================================================
// buildSelfViewEntries — chronological merge
// ===========================================================================

test("buildSelfViewEntries: sorts across sources by date, then start time", () => {
  const rows = [examRow({ rowKey: "later-date", date: "2026-08-12", startTime: "08:00" })];
  const lessons = [lesson({ id: "earlier-date", date: "2026-08-10", startTime: "09:00" })];
  const entries = buildSelfViewEntries(rows, lessons);
  assert.deepEqual(
    entries.map((e) => (e.kind === "exam" ? e.row.rowKey : e.lesson.id)),
    ["earlier-date", "later-date"],
  );
});

test("buildSelfViewEntries: on the same date, orders by start time regardless of source", () => {
  const rows = [examRow({ rowKey: "exam-1000", date: "2026-08-10", startTime: "10:00" })];
  const lessons = [lesson({ id: "practice-0900", date: "2026-08-10", startTime: "09:00" })];
  const entries = buildSelfViewEntries(rows, lessons);
  assert.deepEqual(entries.map((e) => e.kind), ["practice", "exam"]);
});

test("buildSelfViewEntries: a tie on (date, startTime) keeps STABLE ORIGINAL ORDER (exam rows before lessons)", () => {
  const rows = [examRow({ rowKey: "tied-exam", date: "2026-08-10", startTime: "09:00" })];
  const lessons = [lesson({ id: "tied-practice", date: "2026-08-10", startTime: "09:00" })];
  const entries = buildSelfViewEntries(rows, lessons);
  assert.deepEqual(entries.map((e) => e.kind), ["exam", "practice"]);
});

test("buildSelfViewEntries: a tie among multiple exam rows preserves their own input order", () => {
  const rows = [
    examRow({ rowKey: "first", date: "2026-08-10", startTime: "09:00" }),
    examRow({ rowKey: "second", date: "2026-08-10", startTime: "09:00" }),
  ];
  const entries = buildSelfViewEntries(rows, []);
  assert.deepEqual(
    entries.map((e) => (e.kind === "exam" ? e.row.rowKey : null)),
    ["first", "second"],
  );
});

test("buildSelfViewEntries: a Teaching-Practice lesson is tagged 'practice' and carries its own lesson object, never converted into an exam row", () => {
  const l = lesson({ id: "L1" });
  const [entry] = buildSelfViewEntries([], [l]);
  assert.equal(entry.kind, "practice");
  assert.equal(entry.lesson, l);
  assert.equal("row" in entry, false, "a practice entry must not also carry an exam row");
});

test("buildSelfViewEntries: both inputs empty yields an empty list", () => {
  assert.deepEqual(buildSelfViewEntries([], []), []);
});

test("buildSelfViewEntries: neither input array is mutated", () => {
  const rows = Object.freeze([examRow({ rowKey: "r" })]);
  const lessons = Object.freeze([lesson({ id: "l" })]);
  assert.doesNotThrow(() => buildSelfViewEntries(rows, lessons));
});
