// Shared by the Excel export and the admin schedule grid: how many distinct
// students have an assignment on each date, out of how many active
// students there are in total. Used to surface a manager-facing coverage
// warning when a non-no-duty date leaves some students unassigned - this
// never changes what the scheduler does, only how existing results are
// summarized for display.

export interface DateCoverage {
  dateKey: string;
  assignedCount: number;
  activeStudentCount: number;
  isNoDuty: boolean;
  // Only meaningful when !isNoDuty - a no-duty date is expected to have
  // zero assignments, so it's never "short."
  isShort: boolean;
}

export function computeCoverageByDate(
  dateKeys: string[],
  activeStudentCount: number,
  cellByStudentAndDate: Map<string, Map<string, unknown>>,
  noDutyDateKeys: Set<string>
): Map<string, DateCoverage> {
  const assignedCounts = new Map<string, number>();
  for (const dk of dateKeys) assignedCounts.set(dk, 0);

  for (const perDate of cellByStudentAndDate.values()) {
    for (const dk of perDate.keys()) {
      if (assignedCounts.has(dk)) {
        assignedCounts.set(dk, (assignedCounts.get(dk) ?? 0) + 1);
      }
    }
  }

  const result = new Map<string, DateCoverage>();
  for (const dk of dateKeys) {
    const assignedCount = assignedCounts.get(dk) ?? 0;
    const isNoDuty = noDutyDateKeys.has(dk);
    result.set(dk, {
      dateKey: dk,
      assignedCount,
      activeStudentCount,
      isNoDuty,
      isShort: !isNoDuty && assignedCount < activeStudentCount,
    });
  }
  return result;
}
