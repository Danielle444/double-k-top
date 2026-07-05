import { Workbook } from "exceljs";
import { formatHebrewDate, formatHebrewWeekday, parseDateKey } from "@/lib/dates";
import type {
  ExportCell,
  ScheduleGridExport,
  ScheduleDayExport,
} from "@/lib/exports/schedule-export";

const HEADER_FILL = {
  type: "pattern" as const,
  pattern: "solid" as const,
  fgColor: { argb: "FFDCEEF7" },
};

// exceljs's bundled .d.ts declares its own local `Buffer` type that doesn't
// structurally match Node's real (generic) Buffer type - same mismatch
// already worked around on the read side in lib/actions/weekly-schedule.ts.
// Wrapping in a plain Uint8Array sidesteps the type conflict entirely and
// is what Response/NextResponse bodies expect anyway.
async function workbookToBytes(workbook: Workbook): Promise<Uint8Array> {
  const raw = await workbook.xlsx.writeBuffer();
  return new Uint8Array(raw as unknown as ArrayBuffer);
}

function gridCellText(cell: ExportCell | undefined, isNoDuty: boolean): string {
  if (!cell) return isNoDuty ? "אין תורנויות ביום זה" : "";
  const lines = [cell.dutyTypeName];
  if (!cell.isPublished) lines.push("(טיוטה)");
  if (cell.isCompleted) lines.push("✓ בוצע");
  return lines.join("\n");
}

function addTitleRow(sheet: import("exceljs").Worksheet, title: string, columnCount: number) {
  sheet.mergeCells(1, 1, 1, columnCount);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = title;
  titleCell.font = { bold: true, size: 14 };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  sheet.getRow(1).height = 26;
}

export async function buildScheduleGridWorkbook(data: ScheduleGridExport): Promise<Uint8Array> {
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet("שיבוץ תורנויות", {
    views: [{ rightToLeft: true, state: "frozen", ySplit: 2 }],
  });

  const fixedHeaders = ["שם מלא", "קבוצה", "תת-קבוצה"];
  const dayHeaders = data.dateKeys.map(
    (dk) => `${formatHebrewWeekday(parseDateKey(dk))}\n${formatHebrewDate(parseDateKey(dk))}`
  );
  const headers = [...fixedHeaders, ...dayHeaders];

  sheet.getColumn(1).width = 22;
  sheet.getColumn(2).width = 10;
  sheet.getColumn(3).width = 12;
  for (let i = 0; i < data.dateKeys.length; i++) {
    sheet.getColumn(4 + i).width = 20;
  }

  addTitleRow(sheet, data.title, headers.length);

  const headerRow = sheet.getRow(2);
  headers.forEach((h, i) => {
    const c = headerRow.getCell(i + 1);
    c.value = h;
    c.font = { bold: true };
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    c.fill = HEADER_FILL;
  });
  headerRow.height = 34;

  let rowIndex = 3;
  for (const student of data.students) {
    const row = sheet.getRow(rowIndex);
    row.getCell(1).value = student.fullName;
    row.getCell(1).alignment = { horizontal: "right", vertical: "middle" };
    row.getCell(2).value = student.groupName ?? "";
    row.getCell(3).value = student.subgroupNumber ?? "";
    row.getCell(2).alignment = { horizontal: "center", vertical: "middle" };
    row.getCell(3).alignment = { horizontal: "center", vertical: "middle" };

    for (let i = 0; i < data.dateKeys.length; i++) {
      const dk = data.dateKeys[i];
      const cell = data.cellByStudentAndDate.get(student.id)?.get(dk);
      const c = row.getCell(4 + i);
      c.value = gridCellText(cell, data.noDutyDateKeys.has(dk));
      c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    }
    rowIndex++;
  }

  return workbookToBytes(workbook);
}

export async function buildScheduleDayWorkbook(data: ScheduleDayExport): Promise<Uint8Array> {
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet("תורנויות יום", {
    views: [{ rightToLeft: true, state: "frozen", ySplit: 2 }],
  });

  const headers = ["שם מלא", "קבוצה", "תת-קבוצה", "סוג תורנות", "ביצוע", "פרסום"];
  sheet.getColumn(1).width = 22;
  sheet.getColumn(2).width = 10;
  sheet.getColumn(3).width = 12;
  sheet.getColumn(4).width = 26;
  sheet.getColumn(5).width = 12;
  sheet.getColumn(6).width = 12;

  addTitleRow(sheet, data.title, headers.length);

  const headerRow = sheet.getRow(2);
  headers.forEach((h, i) => {
    const c = headerRow.getCell(i + 1);
    c.value = h;
    c.font = { bold: true };
    c.alignment = { horizontal: "center", vertical: "middle" };
    c.fill = HEADER_FILL;
  });

  if (data.rows.length === 0) {
    sheet.mergeCells(3, 1, 3, headers.length);
    const emptyCell = sheet.getCell(3, 1);
    emptyCell.value = "אין שיבוצים ליום זה";
    emptyCell.alignment = { horizontal: "center", vertical: "middle" };
  }

  let rowIndex = 3;
  for (const row of data.rows) {
    const r = sheet.getRow(rowIndex);
    r.getCell(1).value = row.studentName;
    r.getCell(1).alignment = { horizontal: "right", vertical: "middle" };
    r.getCell(2).value = row.groupName ?? "";
    r.getCell(3).value = row.subgroupNumber ?? "";
    r.getCell(4).value = row.dutyTypeName;
    r.getCell(5).value = row.isCompleted ? "בוצע" : "טרם בוצע";
    r.getCell(6).value = row.isPublished ? "פורסם" : "טיוטה";
    for (let col = 2; col <= 6; col++) {
      r.getCell(col).alignment = { horizontal: "center", vertical: "middle" };
    }
    rowIndex++;
  }

  return workbookToBytes(workbook);
}
