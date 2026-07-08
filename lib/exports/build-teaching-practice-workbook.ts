import { Workbook, type Worksheet } from "exceljs";
import { ROLE_LABELS, type TeachingPracticeTypeValue } from "@/lib/teaching-practice-rotation";
import type { TeachingPracticeLessonDetail } from "@/lib/actions/teaching-practice";

const HEADER_FILL = {
  type: "pattern" as const,
  pattern: "solid" as const,
  fgColor: { argb: "FFDCEEF7" },
};

const COLUMN_HEADERS = [
  "שעה",
  "חניך",
  "תפקיד",
  "שם הילד",
  "גיל",
  "מין",
  "סוס",
  "ציוד",
  "שם ההורה",
  "טלפון הורה",
  "הערות",
  "סטטוס",
];
const COLUMN_WIDTHS = [12, 18, 15, 16, 6, 6, 14, 20, 16, 13, 30, 9];
// 1-based column indices (סוס, ציוד, הערות) - the only free-text fields long
// enough to need wrapping rather than truncation/overflow.
const WRAP_COLUMNS = new Set([7, 8, 11]);

const PRACTICE_TYPE_ORDER: TeachingPracticeTypeValue[] = ["LUNGE", "BEGINNER_PRIVATE", "BEGINNER_GROUP"];
const PRACTICE_TYPE_SECTION_TITLES: Record<TeachingPracticeTypeValue, string> = {
  LUNGE: "לונג׳",
  BEGINNER_PRIVATE: "שיעורים פרטניים",
  BEGINNER_GROUP: "שיעורים קבוצתיים",
};

// exceljs's bundled .d.ts declares its own local Buffer type that doesn't
// structurally match Node's real (generic) Buffer type - same workaround
// already used in lib/exports/build-schedule-workbook.ts and
// lib/actions/student-import.ts. Wrapping in a plain Uint8Array sidesteps
// the type conflict and is what NextResponse bodies expect anyway.
async function workbookToBytes(workbook: Workbook): Promise<Uint8Array> {
  const raw = await workbook.xlsx.writeBuffer();
  return new Uint8Array(raw as unknown as ArrayBuffer);
}

function writeRow(sheet: Worksheet, rowIndex: number, values: (string | number)[]) {
  const row = sheet.getRow(rowIndex);
  values.forEach((value, i) => {
    const col = i + 1;
    const cell = row.getCell(col);
    cell.value = value;
    cell.alignment = { horizontal: "right", vertical: "top", wrapText: WRAP_COLUMNS.has(col) };
  });
}

// One row per (trainee, child) pairing for this lesson - mirrors the
// generated-lessons table's own row-group logic (see LessonTableRow in
// TeachingPracticeManager.tsx) but repeats shared values across every row
// instead of using rowSpan, since Excel rows can't merge cleanly with the
// per-lesson section/sort structure below. LUNGE/BEGINNER_PRIVATE normally
// share one child between both trainee rows, so that child's fields are
// repeated on each row rather than index-paired (which would leave the
// second trainee's row blank); BEGINNER_GROUP's 3 trainees/3 children pair
// 1:1, same as on screen.
function buildRowsForLesson(lesson: TeachingPracticeLessonDetail): (string | number)[][] {
  const timeRange = `${lesson.startTime}-${lesson.endTime}`;
  const status = lesson.isPublished ? "פורסם" : "טיוטה";
  const notes = lesson.notes ?? "—";

  const sharedChildColumn = lesson.practiceType !== "BEGINNER_GROUP" && lesson.childAssignments.length <= 1;
  const soleChild = lesson.childAssignments[0] ?? null;
  const rowCount = sharedChildColumn
    ? Math.max(lesson.participants.length, 1)
    : Math.max(lesson.participants.length, lesson.childAssignments.length, 1);

  const rows: (string | number)[][] = [];
  for (let i = 0; i < rowCount; i++) {
    const participant = lesson.participants[i] ?? null;
    const child = sharedChildColumn ? soleChild : (lesson.childAssignments[i] ?? null);
    rows.push([
      timeRange,
      participant?.traineeName ?? "—",
      participant ? (lesson.roleLabelOverrides?.[participant.role] ?? ROLE_LABELS[participant.role]) : "—",
      child?.childFullName ?? "—",
      child?.childAge ?? "—",
      child?.childGender ?? "—",
      child?.horseName ?? "—",
      child?.equipmentNotes ?? "—",
      child?.parentName ?? "—",
      child?.parentPhone ?? "—",
      notes,
      status,
    ]);
  }
  return rows;
}

// One sheet for the whole selected date - section header rows by
// practiceType (in the same לונג׳/פרטני/קבוצתי order the tab shows),
// lessons sorted by start time within each section, and only the sections
// that actually have lessons that date.
export async function buildTeachingPracticeDayWorkbook(
  lessons: TeachingPracticeLessonDetail[],
  title: string
): Promise<Uint8Array> {
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet("התנסויות מתחילים", { views: [{ rightToLeft: true }] });

  COLUMN_WIDTHS.forEach((width, i) => {
    sheet.getColumn(i + 1).width = width;
  });

  let rowIndex = 1;

  sheet.mergeCells(rowIndex, 1, rowIndex, COLUMN_HEADERS.length);
  const titleCell = sheet.getCell(rowIndex, 1);
  titleCell.value = title;
  titleCell.font = { bold: true, size: 14 };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  sheet.getRow(rowIndex).height = 26;
  rowIndex += 2;

  for (const practiceType of PRACTICE_TYPE_ORDER) {
    const lessonsForType = lessons
      .filter((l) => l.practiceType === practiceType)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
    if (lessonsForType.length === 0) continue;

    const sectionCell = sheet.getCell(rowIndex, 1);
    sectionCell.value = PRACTICE_TYPE_SECTION_TITLES[practiceType];
    sectionCell.font = { bold: true, size: 13 };
    rowIndex += 1;

    const headerRow = sheet.getRow(rowIndex);
    COLUMN_HEADERS.forEach((label, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = label;
      cell.font = { bold: true };
      cell.fill = HEADER_FILL;
      cell.alignment = { horizontal: "center", vertical: "middle" };
    });
    rowIndex += 1;

    for (const lesson of lessonsForType) {
      for (const values of buildRowsForLesson(lesson)) {
        writeRow(sheet, rowIndex, values);
        rowIndex += 1;
      }
    }
    rowIndex += 1;
  }

  if (lessons.length === 0) {
    sheet.getCell(rowIndex, 1).value = "אין שיעורים בתאריך זה";
  }

  return workbookToBytes(workbook);
}
