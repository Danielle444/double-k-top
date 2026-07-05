// A "subgroup" is really (groupName, subgroupNumber) together - subgroupNumber
// alone is not unique across groups (e.g. group א and group ב can each have
// their own "subgroup 1"). Shared by the scheduler (lib/scheduler.ts) and the
// diagnostics module (lib/schedule-diagnostics.ts) so both agree on identity.

export function subgroupKey(groupName: string | null, subgroupNumber: number): string {
  return `${groupName ?? ""}|${subgroupNumber}`;
}

export function formatSubgroupLabel(groupName: string | null, subgroupNumber: number): string {
  return groupName ? `${groupName}/${subgroupNumber}` : `${subgroupNumber}`;
}
