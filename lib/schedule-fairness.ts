import { prisma } from "@/lib/prisma";
import { loadHistoricalTraineeState } from "@/lib/course/historical-trainee-state";

export interface StudentDutyCounts {
  studentId: string;
  fullName: string;
  groupName: string | null;
  subgroupNumber: number | null;
  countByDutyType: Map<string, number>;
  total: number;
}

export interface FairnessReport {
  dutyTypes: { id: string; name: string }[];
  students: StudentDutyCounts[];
  averageTotal: number;
}

// Nulls-last Hebrew-aware ordering (matches the prior DB group ordering) applied
// after resolving the effective-dated group.
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

// Read-only - counts already-generated assignments in the range, grouped by
// student and duty type. Never generates, deletes, or modifies anything.
export async function buildFairnessReport(startDate: Date, endDate: Date): Promise<FairnessReport> {
  const [students, dutyTypes, assignments] = await Promise.all([
    prisma.student.findMany({
      where: { isActive: true },
      select: { id: true, fullName: true, lastName: true },
    }),
    prisma.dutyType.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.dutyAssignment.findMany({
      where: { date: { gte: startDate, lte: endDate } },
      select: { studentId: true, dutyTypeId: true },
    }),
  ]);

  const countsByStudent = new Map<string, Map<string, number>>();
  for (const a of assignments) {
    if (!countsByStudent.has(a.studentId)) countsByStudent.set(a.studentId, new Map());
    const m = countsByStudent.get(a.studentId)!;
    m.set(a.dutyTypeId, (m.get(a.dutyTypeId) ?? 0) + 1);
  }

  // W6D3-HOTFIX: the per-student group label/ordering must reflect the effective-
  // dated group, not the current Student mirror. This is a per-student aggregate
  // over a date range, so group is resolved AS OF the report's endDate (the state
  // at the end of the reported window); the duty COUNTS themselves are group-
  // independent and unchanged. Fail closed to null (no current-mirror fallback),
  // then re-sort by the resolved group.
  const historical = await loadHistoricalTraineeState(students.map((s) => s.id));
  const students_: StudentDutyCounts[] = students
    .map((s) => {
      const countByDutyType = countsByStudent.get(s.id) ?? new Map<string, number>();
      const total = [...countByDutyType.values()].reduce((sum, n) => sum + n, 0);
      const group = historical.groupAt(s.id, endDate);
      return {
        studentId: s.id,
        fullName: s.fullName,
        lastName: s.lastName,
        groupName: group.ok ? group.value.groupName : null,
        subgroupNumber: group.ok ? group.value.subgroupNumber : null,
        countByDutyType,
        total,
      };
    })
    .sort(
      (a, b) =>
        compareGroupName(a.groupName, b.groupName) ||
        compareSubgroupNumber(a.subgroupNumber, b.subgroupNumber) ||
        a.lastName.localeCompare(b.lastName, "he"),
    )
    .map(
      ({ studentId, fullName, groupName, subgroupNumber, countByDutyType, total }): StudentDutyCounts => ({
        studentId,
        fullName,
        groupName,
        subgroupNumber,
        countByDutyType,
        total,
      }),
    );

  const averageTotal =
    students_.length > 0 ? students_.reduce((sum, s) => sum + s.total, 0) / students_.length : 0;

  return { dutyTypes: dutyTypes.map((d) => ({ id: d.id, name: d.name })), students: students_, averageTotal };
}

export interface FairnessWarning {
  studentId: string;
  fullName: string;
  message: string;
}

// Thresholds are intentionally simple, adjustable heuristics, not policy:
// "3 or more of the same duty" and "total noticeably off the range average"
// (2 assignments away from average) are what surface as outliers below.
const SAME_DUTY_REPEAT_THRESHOLD = 3;
const TOTAL_DEVIATION_THRESHOLD = 2;

export function computeFairnessWarnings(report: FairnessReport): FairnessWarning[] {
  const warnings: FairnessWarning[] = [];
  const dutyTypeNameById = new Map(report.dutyTypes.map((d) => [d.id, d.name]));

  for (const student of report.students) {
    for (const [dutyTypeId, count] of student.countByDutyType) {
      if (count >= SAME_DUTY_REPEAT_THRESHOLD) {
        warnings.push({
          studentId: student.studentId,
          fullName: student.fullName,
          message: `${student.fullName}: קיבל/ה את התורנות "${
            dutyTypeNameById.get(dutyTypeId) ?? ""
          }" ${count} פעמים`,
        });
      }
    }

    if (report.averageTotal > 0) {
      const deviation = student.total - report.averageTotal;
      if (deviation >= TOTAL_DEVIATION_THRESHOLD) {
        warnings.push({
          studentId: student.studentId,
          fullName: student.fullName,
          message: `${student.fullName}: סה"כ תורנויות (${student.total}) גבוה משמעותית מהממוצע (${report.averageTotal.toFixed(1)})`,
        });
      } else if (deviation <= -TOTAL_DEVIATION_THRESHOLD) {
        warnings.push({
          studentId: student.studentId,
          fullName: student.fullName,
          message: `${student.fullName}: סה"כ תורנויות (${student.total}) נמוך משמעותית מהממוצע (${report.averageTotal.toFixed(1)})`,
        });
      }
    }
  }

  return warnings;
}
