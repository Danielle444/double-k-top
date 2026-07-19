import { prisma } from "@/lib/prisma";
import { dateKey, enumerateDateKeys, parseDateKey } from "@/lib/dates";
import { loadHistoricalTraineeState } from "@/lib/course/historical-trainee-state";

// Nulls-last Hebrew-aware ordering used to re-sort export rows by the
// effective-dated (not current-mirror) group they resolved to.
function compareGroupName(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a.localeCompare(b, "he");
}
function compareSubgroupNumber(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

export interface ExportStudentRow {
  id: string;
  fullName: string;
  groupName: string | null;
  subgroupNumber: number | null;
}

export interface ExportCell {
  dutyTypeId: string;
  dutyTypeName: string;
  isPublished: boolean;
  isCompleted: boolean;
}

export interface ScheduleGridExport {
  title: string;
  dateKeys: string[];
  students: ExportStudentRow[];
  cellByStudentAndDate: Map<string, Map<string, ExportCell>>;
  noDutyDateKeys: Set<string>;
  // All currently-active duty type ids - used to build a stable, unique
  // color assignment (lib/duty-colors.ts) shared with the admin grid.
  dutyTypeIds: string[];
}

// A student can have at most one duty per day (DutyAssignment has a unique
// [date, studentId] constraint), so each grid cell resolves to 0 or 1 duty -
// never a list.
export async function buildScheduleGridExport(
  startDate: Date,
  endDate: Date,
  title: string
): Promise<ScheduleGridExport> {
  const dateKeys = enumerateDateKeys(startDate, endDate);

  const [studentRows, assignments, noDutyDates, dutyTypes] = await Promise.all([
    prisma.student.findMany({
      where: { isActive: true },
      select: { id: true, fullName: true, lastName: true },
    }),
    prisma.dutyAssignment.findMany({
      where: { date: { gte: startDate, lte: endDate } },
      include: { dutyType: true },
    }),
    prisma.noDutyDate.findMany({ where: { date: { gte: startDate, lte: endDate } } }),
    prisma.dutyType.findMany({ where: { isActive: true }, select: { id: true } }),
  ]);

  // W6D3-HOTFIX: the grid's per-student group column must reflect the effective-
  // dated group, NOT the current Student mirror. A grid spans a date range and
  // shows ONE group per student, so it is resolved AS OF the export's endDate
  // (the state at the end of the exported window); the per-cell duties below are
  // unaffected. Fail closed to null (no current-mirror fallback), then re-sort by
  // the resolved group so ordering matches the labels.
  const historical = await loadHistoricalTraineeState(studentRows.map((s) => s.id));
  const students: ExportStudentRow[] = studentRows
    .map((s) => {
      const group = historical.groupAt(s.id, endDate);
      return {
        id: s.id,
        fullName: s.fullName,
        lastName: s.lastName,
        groupName: group.ok ? group.value.groupName : null,
        subgroupNumber: group.ok ? group.value.subgroupNumber : null,
      };
    })
    .sort(
      (a, b) =>
        compareGroupName(a.groupName, b.groupName) ||
        compareSubgroupNumber(a.subgroupNumber, b.subgroupNumber) ||
        a.lastName.localeCompare(b.lastName, "he"),
    )
    .map((s) => ({ id: s.id, fullName: s.fullName, groupName: s.groupName, subgroupNumber: s.subgroupNumber }));

  const cellByStudentAndDate = new Map<string, Map<string, ExportCell>>();
  for (const a of assignments) {
    const dk = dateKey(a.date);
    if (!cellByStudentAndDate.has(a.studentId)) {
      cellByStudentAndDate.set(a.studentId, new Map());
    }
    cellByStudentAndDate.get(a.studentId)!.set(dk, {
      dutyTypeId: a.dutyTypeId,
      dutyTypeName: a.dutyType.name,
      isPublished: a.isPublished,
      isCompleted: a.isCompleted,
    });
  }

  return {
    title,
    dateKeys,
    students,
    cellByStudentAndDate,
    noDutyDateKeys: new Set(noDutyDates.map((n) => dateKey(n.date))),
    dutyTypeIds: dutyTypes.map((d) => d.id),
  };
}

export interface DayExportRow {
  studentName: string;
  groupName: string | null;
  subgroupNumber: number | null;
  dutyTypeName: string;
  isCompleted: boolean;
  isPublished: boolean;
}

export interface ScheduleDayExport {
  title: string;
  rows: DayExportRow[];
}

export async function buildScheduleDayExport(
  dateKeyStr: string,
  title: string
): Promise<ScheduleDayExport> {
  const date = parseDateKey(dateKeyStr);

  const assignments = await prisma.dutyAssignment.findMany({
    where: { date },
    include: { student: true, dutyType: true },
  });

  // W6D3-HOTFIX: a day export is a single historical date, so each row's group is
  // resolved from the effective-dated GroupMembership covering that day — never
  // the current Student mirror. Fail closed to null (no fallback); then sort by
  // the resolved group (the DB group-ordering is dropped as it used the mirror).
  const historical = await loadHistoricalTraineeState(assignments.map((a) => a.studentId));
  const rows = assignments
    .map((a) => {
      const group = historical.groupAt(a.studentId, date);
      return {
        studentName: a.student.fullName,
        lastName: a.student.lastName,
        groupName: group.ok ? group.value.groupName : null,
        subgroupNumber: group.ok ? group.value.subgroupNumber : null,
        dutyTypeName: a.dutyType.name,
        isCompleted: a.isCompleted,
        isPublished: a.isPublished,
      };
    })
    .sort(
      (a, b) =>
        compareGroupName(a.groupName, b.groupName) ||
        compareSubgroupNumber(a.subgroupNumber, b.subgroupNumber) ||
        a.lastName.localeCompare(b.lastName, "he"),
    );

  return {
    title,
    rows: rows.map((r) => ({
      studentName: r.studentName,
      groupName: r.groupName,
      subgroupNumber: r.subgroupNumber,
      dutyTypeName: r.dutyTypeName,
      isCompleted: r.isCompleted,
      isPublished: r.isPublished,
    })),
  };
}
