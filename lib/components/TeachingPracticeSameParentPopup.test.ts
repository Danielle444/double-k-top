/**
 * REAL behavioral tests for the shared "אותו הורה / איש קשר" popup's PURE
 * row-building logic.
 *
 * `TeachingPracticeSameParentPopup.tsx` has no `server-only` dependency (its
 * imports are the pure same-parent detector, plain date formatters, and the
 * generic `Modal`/`TeachingPracticeLessonCard` client components, none of
 * which touch a Server Action module) - so unlike the section screens,
 * `buildSameParentPopupRows` is imported and called DIRECTLY here, with real
 * inputs and real assertions on the real return values.
 *
 * Run with:
 *   npx tsx --test lib/components/TeachingPracticeSameParentPopup.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildSameParentPopupRows } from "./TeachingPracticeSameParentPopup";
import type { TeachingPracticeTraineeLessonRow } from "@/lib/actions/teaching-practice-student";
import type { TeachingPracticeTraineeTrackRow } from "@/lib/actions/teaching-practice-student";

function child(overrides = {}) {
  return {
    childId: "c1",
    firstName: "נועה",
    lastName: null,
    age: 6,
    gender: "נקבה",
    horseName: null,
    equipmentNotes: null,
    parentName: "דנה כהן",
    parentPhone: "050-1234567",
    ...overrides,
  };
}

function lesson(overrides = {}): TeachingPracticeTraineeLessonRow {
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
    children: [child()],
    ...overrides,
  } as unknown as TeachingPracticeTraineeLessonRow;
}

test("buildSameParentPopupRows: finds no rows for a childId with no match anywhere", () => {
  const rows = buildSameParentPopupRows("missing-child", [lesson()], []);
  assert.deepEqual(rows, []);
});

test("buildSameParentPopupRows: returns the target child's own row even with no sibling match", () => {
  const rows = buildSameParentPopupRows("c1", [lesson()], []);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].childFullName, "נועה");
  assert.equal(rows[0].parentName, "דנה כהן");
  assert.equal(rows[0].parentPhone, "050-1234567");
});

test("buildSameParentPopupRows: returns BOTH children sharing the same normalized parent name+phone", () => {
  const lessons = [
    lesson({
      id: "L1",
      children: [child({ childId: "c1", firstName: "נועה" })],
    }),
    lesson({
      id: "L2",
      date: "2026-08-11",
      startTime: "10:00",
      children: [child({ childId: "c2", firstName: "איתן", parentName: "דנה כהן", parentPhone: "050-1234567" })],
    }),
  ];
  const rows = buildSameParentPopupRows("c1", lessons, []);
  assert.deepEqual(
    rows.map((r) => r.childFullName).sort(),
    ["איתן", "נועה"],
  );
});

test("buildSameParentPopupRows: two children with DIFFERENT parents never match", () => {
  const lessons = [
    lesson({ id: "L1", children: [child({ childId: "c1", parentName: "דנה כהן", parentPhone: "0501111111" })] }),
    lesson({
      id: "L2",
      children: [child({ childId: "c2", firstName: "אחר", parentName: "משה לוי", parentPhone: "0502222222" })],
    }),
  ];
  const rows = buildSameParentPopupRows("c1", lessons, []);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].childFullName, "נועה");
});

test("buildSameParentPopupRows: a phone match is normalized (dashes/spaces/parens ignored)", () => {
  const lessons = [
    lesson({ id: "L1", children: [child({ childId: "c1", parentPhone: "050-123-4567" })] }),
    lesson({
      id: "L2",
      children: [child({ childId: "c2", firstName: "אחר", parentPhone: "(050) 1234567" })],
    }),
  ];
  const rows = buildSameParentPopupRows("c1", lessons, []);
  assert.equal(rows.length, 2);
});

test("buildSameParentPopupRows: also finds the target and matches inside tracks (fixed structure)", () => {
  const track = {
    id: "track-1",
    practiceType: "BEGINNER_PRIVATE",
    groupName: "ב",
    defaultStartTime: "16:00",
    defaultEndTime: "17:00",
    defaultLocation: null,
    groupTrackId: null,
    trainees: [],
    children: [child({ childId: "c1" })],
  } as unknown as TeachingPracticeTraineeTrackRow;
  const rows = buildSameParentPopupRows("c1", [], [track]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sourceLabel, "מבנה קבוע");
  assert.equal(rows[0].date, null, "a fixed-structure row has no concrete date");
});

test("buildSameParentPopupRows: sorts dated rows chronologically before fixed-structure rows", () => {
  const track = {
    id: "track-1",
    practiceType: "BEGINNER_PRIVATE",
    groupName: "א",
    defaultStartTime: "08:00",
    defaultEndTime: "09:00",
    defaultLocation: null,
    groupTrackId: null,
    trainees: [],
    children: [child({ childId: "c2", firstName: "אחר", parentName: "דנה כהן", parentPhone: "050-1234567" })],
  } as unknown as TeachingPracticeTraineeTrackRow;
  const rows = buildSameParentPopupRows(
    "c1",
    [lesson({ id: "L2", date: "2026-08-20", startTime: "12:00", children: [child({ childId: "c1" })] })],
    [track],
  );
  assert.deepEqual(
    rows.map((r) => r.sourceLabel),
    ["שיעור בתאריך", "מבנה קבוע"],
  );
});

test("buildSameParentPopupRows: an empty lessons+tracks input (e.g. a screen with no fixed-structure data) yields no rows, never throws", () => {
  assert.deepEqual(buildSameParentPopupRows("c1", [], []), []);
});
