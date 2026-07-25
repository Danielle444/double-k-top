// L2-RIDING-ROSTER - pure, DB-free candidate scoping for a course-offering-scoped
// (Level 2+) riding slot roster.
//
// Context: buildRidingSlotStudentNotes (lib/actions/riding-slots.ts) resolves the
// "relevant trainees" for a riding slot. For Level 1 it scopes by the legacy
// Student.groupName/subgroupNumber columns (preserved exactly - those columns
// still mirror the L1 parent group). For Level 2 the parent group ("ג") lives
// ONLY in the effective-dated GroupMembership spine (CourseEnrollment ->
// GroupMembership -> CourseGroup), never in Student.groupName, so the legacy
// filter matches zero rows. This helper does the Level 2 selection instead:
// given the offering's ACTIVE-enrollment roster (each row already carrying its
// GroupMembership-derived parent group + subgroup, resolved AS-OF the
// ScheduleItem date by getCurrentCourseEnrollmentRoster) and the slot's own
// assignment-split filters, it selects which trainees are relevant - mirroring
// the Level 1 OR-filter semantics exactly, but matching against the
// GroupMembership-derived group/subgroup rather than the Student columns.
//
// Pure: no Prisma, no clock, no I/O. The roster and the complex-plan trainee ids
// are fetched by the caller and passed in, so every branch here is unit-testable
// without a database. Never reads Student.groupName - the caller must not pass
// legacy Student columns in as roster rows.

/** One assignment-derived split filter (group and/or subgroup, null = wildcard). */
export interface RidingRosterFilter {
  groupName: string | null;
  subgroupNumber: number | null;
}

/**
 * One offering-roster row, already resolved to its GroupMembership-derived
 * parent group name + subgroup number (NEVER the legacy Student.groupName).
 */
export interface RidingRosterCandidateRow {
  studentId: string;
  groupName: string | null;
  subgroupNumber: number | null;
}

export interface RidingRosterScope {
  /**
   * Student ids to load: every roster row matching ANY split filter, UNION the
   * slot's own complex-plan station trainees. Deduped, stable insertion order
   * (roster matches first, then any complex-only trainee). isActive filtering is
   * applied later by the caller's Student IN query.
   */
  candidateStudentIds: string[];
  /**
   * studentId -> GroupMembership-derived group/subgroup, for EVERY roster row -
   * so a matched trainee's returned row exposes the parent group ("ג") and
   * subgroup from GroupMembership, never the legacy Student columns. A
   * complex-only trainee absent from the offering roster (a rare membership
   * anomaly) simply has no entry here, and the caller falls back gracefully.
   */
  groupByStudentId: Map<string, { groupName: string | null; subgroupNumber: number | null }>;
}

// A null filter field is a wildcard, matching the Level 1 query's behaviour where
// a null groupName/subgroupNumber contributes no constraint for that field.
function rowMatchesFilter(row: RidingRosterCandidateRow, filter: RidingRosterFilter): boolean {
  if (filter.groupName !== null && row.groupName !== filter.groupName) return false;
  if (filter.subgroupNumber !== null && row.subgroupNumber !== filter.subgroupNumber) return false;
  return true;
}

/**
 * Select the Level 2 candidate roster. Mirrors the Level 1
 * `OR: [...splitFilters, { id: { in: complexTraineeIds } }]` union: a roster row
 * is included when it matches any split filter, and every complex-plan station
 * trainee is unioned in regardless of the split (so cross-subgroup station-mates
 * remain reachable, exactly as in Level 1).
 */
export function selectRidingRosterCandidates(
  rosterRows: RidingRosterCandidateRow[],
  filters: RidingRosterFilter[],
  complexTraineeIds: string[],
): RidingRosterScope {
  const groupByStudentId = new Map<
    string,
    { groupName: string | null; subgroupNumber: number | null }
  >();
  for (const row of rosterRows) {
    // The roster is offering-scoped and enrollment-deduped upstream (one ACTIVE
    // enrollment per student per offering), so a dual-enrolled trainee appears
    // exactly once here; last-write is therefore harmless.
    groupByStudentId.set(row.studentId, {
      groupName: row.groupName,
      subgroupNumber: row.subgroupNumber,
    });
  }

  const complexSet = new Set(complexTraineeIds);
  const ids: string[] = [];
  const seen = new Set<string>();
  const push = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  };

  for (const row of rosterRows) {
    if (complexSet.has(row.studentId) || filters.some((f) => rowMatchesFilter(row, f))) {
      push(row.studentId);
    }
  }
  // Union in every complex-plan trainee, even one absent from the roster (a rare
  // membership anomaly) - matching Level 1's unconditional complex-id OR clause.
  for (const id of complexTraineeIds) push(id);

  return { candidateStudentIds: ids, groupByStudentId };
}
