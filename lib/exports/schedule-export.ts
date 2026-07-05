import { prisma } from "@/lib/prisma";
import { dateKey, enumerateDateKeys, parseDateKey } from "@/lib/dates";

export interface ExportStudentRow {
  id: string;
  fullName: string;
  groupName: string | null;
  subgroupNumber: number | null;
}

export interface ExportCell {
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

  const [students, assignments, noDutyDates] = await Promise.all([
    prisma.student.findMany({
      where: { isActive: true },
      orderBy: [{ groupName: "asc" }, { subgroupNumber: "asc" }, { lastName: "asc" }],
      select: { id: true, fullName: true, groupName: true, subgroupNumber: true },
    }),
    prisma.dutyAssignment.findMany({
      where: { date: { gte: startDate, lte: endDate } },
      include: { dutyType: true },
    }),
    prisma.noDutyDate.findMany({ where: { date: { gte: startDate, lte: endDate } } }),
  ]);

  const cellByStudentAndDate = new Map<string, Map<string, ExportCell>>();
  for (const a of assignments) {
    const dk = dateKey(a.date);
    if (!cellByStudentAndDate.has(a.studentId)) {
      cellByStudentAndDate.set(a.studentId, new Map());
    }
    cellByStudentAndDate.get(a.studentId)!.set(dk, {
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
    orderBy: [
      { student: { groupName: "asc" } },
      { student: { subgroupNumber: "asc" } },
      { student: { lastName: "asc" } },
    ],
  });

  return {
    title,
    rows: assignments.map((a) => ({
      studentName: a.student.fullName,
      groupName: a.student.groupName,
      subgroupNumber: a.student.subgroupNumber,
      dutyTypeName: a.dutyType.name,
      isCompleted: a.isCompleted,
      isPublished: a.isPublished,
    })),
  };
}
