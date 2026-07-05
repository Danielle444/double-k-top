import { Workbook } from "exceljs";
import { formatHebrewDate, formatHebrewWeekday, parseDateKey } from "@/lib/dates";
import {
  buildDutyColorMap,
  getCoverageWarningColor,
  getNoDutyColor,
  getOverfilledWarningColor,
  type DutyColor,
} from "@/lib/duty-colors";
import { computeCoverageByDate } from "@/lib/schedule-coverage";
import type { CoverageStatus, ScheduleDiagnostics } from "@/lib/schedule-diagnostics";
import type { FairnessReport } from "@/lib/schedule-fairness";
import type {
  ExportCell,
  ScheduleGridExport,
  ScheduleDayExport,
} from "@/lib/exports/schedule-export";

const HIGH_REPETITION_THRESHOLD = 3;

const HEADER_FILL = {
  type: "pattern" as const,
  pattern: "solid" as const,
  fgColor: { argb: "FFDCEEF7" },
};

// exceljs wants ARGB (8 hex chars, alpha first); the shared palette only
// deals in plain web hex (#RRGGBB), so the "FF" (fully opaque) prefix is
// added only here, at the Excel-specific edge.
function toArgbFill(color: DutyColor) {
  return {
    type: "pattern" as const,
    pattern: "solid" as const,
    fgColor: { argb: `FF${color.background.replace("#", "")}` },
  };
}

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

function statusFill(status: CoverageStatus) {
  if (status === "חסר") return toArgbFill(getCoverageWarningColor());
  if (status === "עודף") return toArgbFill(getOverfilledWarningColor());
  return undefined;
}

// A read-only report over already-generated assignments - never generates,
// deletes, or modifies anything. Added as a second sheet on the grid export
// so the manager can spot coverage problems without leaving Excel.
function addDiagnosticsSheet(workbook: Workbook, diagnostics: ScheduleDiagnostics) {
  const sheet = workbook.addWorksheet("בדיקת שיבוץ", {
    views: [{ rightToLeft: true }],
  });
  sheet.getColumn(1).width = 14;
  sheet.getColumn(2).width = 26;
  sheet.getColumn(3).width = 16;
  sheet.getColumn(4).width = 12;
  sheet.getColumn(5).width = 12;
  sheet.getColumn(6).width = 12;

  let row = 1;

  function sectionTitle(text: string) {
    const cell = sheet.getCell(row, 1);
    cell.value = text;
    cell.font = { bold: true, size: 13 };
    row += 2;
  }

  function headerRow(labels: string[]) {
    labels.forEach((label, i) => {
      const cell = sheet.getRow(row).getCell(i + 1);
      cell.value = label;
      cell.font = { bold: true };
      cell.fill = HEADER_FILL;
      cell.alignment = { horizontal: "center", vertical: "middle" };
    });
    row += 1;
  }

  // --- Section A: per-date coverage ---
  sectionTitle("א. סיכום כיסוי לפי תאריך");
  headerRow(["תאריך", "משובצים", "פעילים", "סטטוס"]);
  for (const c of diagnostics.dateCoverage) {
    const r = sheet.getRow(row);
    r.getCell(1).value = formatHebrewDate(parseDateKey(c.dateKey));
    r.getCell(2).value = c.assignedCount;
    r.getCell(3).value = c.activeStudentCount;
    r.getCell(4).value = c.isNoDuty ? "אין תורנויות" : c.isShort ? "חסר" : "תקין";
    if (!c.isNoDuty && c.isShort) {
      const fill = toArgbFill(getCoverageWarningColor());
      for (let col = 1; col <= 4; col++) r.getCell(col).fill = fill;
    }
    row += 1;
  }
  row += 2;

  // --- Section B: per date + duty type ---
  sectionTitle("ב. כיסוי לפי תאריך וסוג תורנות");
  headerRow(["תאריך", "סוג תורנות", "סוג הקצאה", "משובצים", "צפוי", "סטטוס"]);
  for (const d of diagnostics.dutyTypeCoverage) {
    const r = sheet.getRow(row);
    r.getCell(1).value = formatHebrewDate(parseDateKey(d.dateKey));
    r.getCell(2).value = d.dutyTypeName;
    r.getCell(3).value = d.allocationMode === "ONE_PER_SUBGROUP" ? "אחד לתת-קבוצה" : "כמות קבועה";
    r.getCell(4).value = d.assignedCount;
    r.getCell(5).value = d.expectedCount;
    r.getCell(6).value = d.status;
    const fill = statusFill(d.status);
    if (fill) for (let col = 1; col <= 6; col++) r.getCell(col).fill = fill;
    row += 1;
  }
  row += 2;

  // --- Section C: ONE_PER_SUBGROUP breakdown ---
  sectionTitle("ג. כיסוי תת-קבוצות (אחד לתת-קבוצה)");
  headerRow(["תאריך", "סוג תורנות", "קבוצה", "תת-קבוצה", "משובצים", "סטטוס"]);
  for (const s of diagnostics.subgroupCoverage) {
    const r = sheet.getRow(row);
    r.getCell(1).value = formatHebrewDate(parseDateKey(s.dateKey));
    r.getCell(2).value = s.dutyTypeName;
    r.getCell(3).value = s.groupName ?? "";
    r.getCell(4).value = s.subgroupNumber;
    r.getCell(5).value = s.assignedCount;
    r.getCell(6).value = s.status;
    const fill = statusFill(s.status);
    if (fill) for (let col = 1; col <= 6; col++) r.getCell(col).fill = fill;
    row += 1;
  }
}

// A read-only fairness matrix over already-generated assignments - never
// generates, deletes, or modifies anything.
function addFairnessSheet(workbook: Workbook, report: FairnessReport) {
  const sheet = workbook.addWorksheet("סיכום לפי חניך", {
    views: [{ rightToLeft: true, state: "frozen", xSplit: 3, ySplit: 2 }],
  });

  const fixedHeaders = ["שם מלא", "קבוצה", "תת-קבוצה"];
  const dutyHeaders = report.dutyTypes.map((d) => d.name);
  const headers = [...fixedHeaders, ...dutyHeaders, "סה\"כ"];

  sheet.getColumn(1).width = 22;
  sheet.getColumn(2).width = 10;
  sheet.getColumn(3).width = 12;
  for (let i = 0; i < report.dutyTypes.length; i++) {
    sheet.getColumn(4 + i).width = 16;
  }
  sheet.getColumn(4 + report.dutyTypes.length).width = 10;

  addTitleRow(sheet, "סיכום לפי חניך", headers.length);

  const headerRow = sheet.getRow(2);
  headers.forEach((h, i) => {
    const c = headerRow.getCell(i + 1);
    c.value = h;
    c.font = { bold: true };
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    c.fill = HEADER_FILL;
  });
  headerRow.height = 32;

  let rowIndex = 3;
  const warningFill = toArgbFill(getCoverageWarningColor());
  for (const student of report.students) {
    const row = sheet.getRow(rowIndex);
    row.getCell(1).value = student.fullName;
    row.getCell(1).alignment = { horizontal: "right", vertical: "middle" };
    row.getCell(2).value = student.groupName ?? "";
    row.getCell(3).value = student.subgroupNumber ?? "";
    row.getCell(2).alignment = { horizontal: "center", vertical: "middle" };
    row.getCell(3).alignment = { horizontal: "center", vertical: "middle" };

    report.dutyTypes.forEach((dt, i) => {
      const count = student.countByDutyType.get(dt.id) ?? 0;
      const c = row.getCell(4 + i);
      c.value = count > 0 ? count : "";
      c.alignment = { horizontal: "center", vertical: "middle" };
      if (count >= HIGH_REPETITION_THRESHOLD) c.fill = warningFill;
    });

    const totalCell = row.getCell(4 + report.dutyTypes.length);
    totalCell.value = student.total;
    totalCell.font = { bold: true };
    totalCell.alignment = { horizontal: "center", vertical: "middle" };

    rowIndex++;
  }
}

export async function buildScheduleGridWorkbook(
  data: ScheduleGridExport,
  diagnostics: ScheduleDiagnostics,
  fairness: FairnessReport
): Promise<Uint8Array> {
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet("שיבוץ תורנויות", {
    views: [{ rightToLeft: true, state: "frozen", ySplit: 2 }],
  });

  const colorMap = buildDutyColorMap(data.dutyTypeIds);
  const coverageByDate = computeCoverageByDate(
    data.dateKeys,
    data.students.length,
    data.cellByStudentAndDate,
    data.noDutyDateKeys
  );

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
      const isNoDuty = data.noDutyDateKeys.has(dk);
      const c = row.getCell(4 + i);
      c.value = gridCellText(cell, isNoDuty);
      c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      if (cell) {
        const color = colorMap.get(cell.dutyTypeId);
        if (color) c.fill = toArgbFill(color);
      } else if (isNoDuty) {
        c.fill = toArgbFill(getNoDutyColor());
      }
    }
    rowIndex++;
  }

  // Coverage summary row: per date, how many students actually got a duty
  // out of how many active students exist. Highlighted when a non-no-duty
  // date came up short, so a shortfall (e.g. from a group-blocking
  // constraint) is visible at a glance instead of only showing up as blank
  // cells scattered through the grid.
  rowIndex += 1;
  const summaryRow = sheet.getRow(rowIndex);
  const summaryLabelCell = summaryRow.getCell(1);
  summaryLabelCell.value = "כיסוי (משובצים / סה\"כ פעילים)";
  summaryLabelCell.font = { bold: true };
  summaryLabelCell.alignment = { horizontal: "right", vertical: "middle", wrapText: true };
  sheet.mergeCells(rowIndex, 1, rowIndex, 3);

  for (let i = 0; i < data.dateKeys.length; i++) {
    const dk = data.dateKeys[i];
    const coverage = coverageByDate.get(dk);
    const c = summaryRow.getCell(4 + i);
    if (!coverage) continue;
    c.value = coverage.isNoDuty
      ? "אין תורנויות"
      : `${coverage.assignedCount}/${coverage.activeStudentCount}`;
    c.font = { bold: true };
    c.alignment = { horizontal: "center", vertical: "middle" };
    if (coverage.isShort) {
      c.fill = toArgbFill(getCoverageWarningColor());
    }
  }
  summaryRow.height = 24;

  addDiagnosticsSheet(workbook, diagnostics);
  addFairnessSheet(workbook, fairness);

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
