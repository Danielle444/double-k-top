import { prisma } from "@/lib/prisma";
import { dateKey, enumerateDateKeys } from "@/lib/dates";
import { computeCoverageByDate, type DateCoverage } from "@/lib/schedule-coverage";
import { formatSubgroupLabel, subgroupKey } from "@/lib/subgroup-identity";

export type CoverageStatus = "תקין" | "חסר" | "עודף";

function statusFor(assignedCount: number, expectedCount: number): CoverageStatus {
  if (assignedCount === expectedCount) return "תקין";
  return assignedCount < expectedCount ? "חסר" : "עודף";
}

export interface DutyTypeCoverageRow {
  dateKey: string;
  dutyTypeId: string;
  dutyTypeName: string;
  allocationMode: string;
  assignedCount: number;
  expectedCount: number;
  status: CoverageStatus;
}

export interface SubgroupCoverageRow {
  dateKey: string;
  dutyTypeId: string;
  dutyTypeName: string;
  groupName: string | null;
  subgroupNumber: number;
  label: string;
  assignedCount: number;
  status: CoverageStatus;
}

export interface ScheduleDiagnostics {
  dateCoverage: DateCoverage[];
  dutyTypeCoverage: DutyTypeCoverageRow[];
  subgroupCoverage: SubgroupCoverageRow[];
}

// Reads already-generated assignments and reports discrepancies - it never
// generates, deletes, or modifies anything. "Expected" for FIXED_COUNT duty
// types is the duty type's configured defaultRequiredCount (the nominal
// target), not the scheduler's day-specific proportional share - so a date
// with unusually low availability can show "חסר" here even though the
// scheduler correctly used a smaller target that day. Cross-check against
// the date coverage section (assigned/active) to tell the two apart.
export async function buildScheduleDiagnostics(
  startDate: Date,
  endDate: Date
): Promise<ScheduleDiagnostics> {
  const dateKeys = enumerateDateKeys(startDate, endDate);

  const [students, dutyTypes, assignments, noDutyDates] = await Promise.all([
    prisma.student.findMany({
      where: { isActive: true },
      select: { id: true, groupName: true, subgroupNumber: true },
    }),
    prisma.dutyType.findMany({ where: { isActive: true } }),
    prisma.dutyAssignment.findMany({
      where: { date: { gte: startDate, lte: endDate } },
      include: { student: true },
    }),
    prisma.noDutyDate.findMany({ where: { date: { gte: startDate, lte: endDate } } }),
  ]);

  const noDutyDateKeys = new Set(noDutyDates.map((n) => dateKey(n.date)));

  const cellByStudentAndDate = new Map<string, Map<string, true>>();
  const countByDateDuty = new Map<string, number>();
  const countByDateDutySubgroup = new Map<string, number>();

  for (const a of assignments) {
    const dk = dateKey(a.date);

    if (!cellByStudentAndDate.has(a.studentId)) cellByStudentAndDate.set(a.studentId, new Map());
    cellByStudentAndDate.get(a.studentId)!.set(dk, true);

    const ddKey = `${dk}|${a.dutyTypeId}`;
    countByDateDuty.set(ddKey, (countByDateDuty.get(ddKey) ?? 0) + 1);

    if (a.student.subgroupNumber != null) {
      const sdKey = `${dk}|${a.dutyTypeId}|${subgroupKey(a.student.groupName, a.student.subgroupNumber)}`;
      countByDateDutySubgroup.set(sdKey, (countByDateDutySubgroup.get(sdKey) ?? 0) + 1);
    }
  }

  const dateCoverageMap = computeCoverageByDate(
    dateKeys,
    students.length,
    cellByStudentAndDate,
    noDutyDateKeys
  );
  const dateCoverage = dateKeys.map((dk) => dateCoverageMap.get(dk)!);

  const activeSubgroups = new Map<
    string,
    { groupName: string | null; subgroupNumber: number; label: string }
  >();
  for (const s of students) {
    if (s.subgroupNumber == null) continue;
    const key = subgroupKey(s.groupName, s.subgroupNumber);
    if (!activeSubgroups.has(key)) {
      activeSubgroups.set(key, {
        groupName: s.groupName,
        subgroupNumber: s.subgroupNumber,
        label: formatSubgroupLabel(s.groupName, s.subgroupNumber),
      });
    }
  }

  const dutyTypeCoverage: DutyTypeCoverageRow[] = [];
  const subgroupCoverage: SubgroupCoverageRow[] = [];

  for (const dk of dateKeys) {
    if (noDutyDateKeys.has(dk)) continue;

    for (const dt of dutyTypes) {
      const assignedCount = countByDateDuty.get(`${dk}|${dt.id}`) ?? 0;
      const expectedCount =
        dt.allocationMode === "FIXED_COUNT" ? dt.defaultRequiredCount : activeSubgroups.size;

      dutyTypeCoverage.push({
        dateKey: dk,
        dutyTypeId: dt.id,
        dutyTypeName: dt.name,
        allocationMode: dt.allocationMode,
        assignedCount,
        expectedCount,
        status: statusFor(assignedCount, expectedCount),
      });

      if (dt.allocationMode === "ONE_PER_SUBGROUP") {
        for (const subgroup of activeSubgroups.values()) {
          const key = `${dk}|${dt.id}|${subgroupKey(subgroup.groupName, subgroup.subgroupNumber)}`;
          const sgAssigned = countByDateDutySubgroup.get(key) ?? 0;
          subgroupCoverage.push({
            dateKey: dk,
            dutyTypeId: dt.id,
            dutyTypeName: dt.name,
            groupName: subgroup.groupName,
            subgroupNumber: subgroup.subgroupNumber,
            label: subgroup.label,
            assignedCount: sgAssigned,
            status: statusFor(sgAssigned, 1),
          });
        }
      }
    }
  }

  return { dateCoverage, dutyTypeCoverage, subgroupCoverage };
}
