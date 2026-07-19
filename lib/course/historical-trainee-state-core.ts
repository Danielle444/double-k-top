/**
 * MULTI-COURSE W6D3-HOTFIX - PURE historical group/horse resolution "as of a
 * date".
 *
 * PURE by construction: no Prisma, no DB, no clock, no env, no "use server". It
 * answers, for an already-loaded set of a trainee's effective-dated
 * GroupMembership / TraineeHorseAssignment intervals and an explicit historical
 * date `asOf`, which group and which horse were EFFECTIVE on that date — using
 * the repository's single half-open interval rule [effectiveFrom, effectiveTo).
 *
 * WHY: historical readers (past duty weeks, completed feedback/riding history)
 * were joining to the CURRENT `Student.groupName`/`subgroupNumber`/horse mirror,
 * so changing a trainee's current group/horse retroactively relabelled past
 * records. The authoritative dated history is intact (the group/horse writers
 * close the prior interval and open a new one from today); only the readers were
 * wrong. This core is the shared resolver those readers now use instead of the
 * current mirror.
 *
 * FAIL CLOSED (locked, section C/D/F): there is DELIBERATELY NO current-Student
 * fallback here. When no interval covers `asOf`, or more than one does, or a
 * covering group cannot be mapped, this returns a typed `ok:false` — the reader
 * shows a safe unknown/omits the derived label, and NEVER substitutes the
 * current mirror. Reuses the frozen half-open test + group mapping from
 * ./enrollment-view so there is exactly one interval convention in the codebase.
 */

import {
  isMembershipCurrentAt,
  resolveGroupFromMembership,
  type RawMembership,
} from "./enrollment-view";

// ============================================================================
// GROUP
// ============================================================================

/** The historical group effective on a date: parent name + optional subgroup. */
export interface HistoricalGroup {
  groupName: string;
  subgroupNumber: number | null;
}

export type HistoricalGroupResult =
  | { ok: true; value: HistoricalGroup }
  | {
      ok: false;
      kind:
        | "NO_COVERING_MEMBERSHIP"
        | "MULTIPLE_COVERING_MEMBERSHIPS"
        | "MALFORMED_SUBGROUP"
        | "MISSING_PARENT_GROUP";
    };

/**
 * Resolve the group effective at `asOf` from a trainee's enrollment-scoped
 * GroupMembership intervals. Requires EXACTLY ONE covering interval (half-open),
 * then maps its CourseGroup to (parent groupName, subgroup number). Zero / many
 * covering intervals, and an unmappable covering group, all fail closed — never
 * the current Student mirror.
 */
export function resolveHistoricalGroup(
  memberships: readonly RawMembership[],
  asOf: Date,
): HistoricalGroupResult {
  const covering = memberships.filter((m) => isMembershipCurrentAt(m, asOf));
  if (covering.length === 0) {
    return { ok: false, kind: "NO_COVERING_MEMBERSHIP" };
  }
  if (covering.length > 1) {
    return { ok: false, kind: "MULTIPLE_COVERING_MEMBERSHIPS" };
  }
  const resolution = resolveGroupFromMembership(covering[0].courseGroup);
  if (!resolution.ok) {
    return { ok: false, kind: resolution.kind };
  }
  return {
    ok: true,
    value: { groupName: resolution.groupName, subgroupNumber: resolution.subgroupNumber },
  };
}

// ============================================================================
// HORSE
// ============================================================================

/** One effective-dated horse interval (TraineeHorseAssignment), Prisma shape. */
export interface HorseIntervalRow {
  effectiveFrom: Date;
  effectiveTo: Date | null;
  hasPrivateHorse: boolean;
  privateHorseName: string | null;
  assignedHorseName: string | null;
}

/** The three horse cache fields effective on a date (shape of HorseInfoInput). */
export interface HistoricalHorse {
  hasPrivateHorse: boolean;
  privateHorseName: string | null;
  assignedHorseName: string | null;
}

export type HistoricalHorseResult =
  | { ok: true; value: HistoricalHorse }
  | { ok: false; kind: "NO_COVERING_INTERVAL" | "MULTIPLE_COVERING_INTERVALS" };

/**
 * Resolve the horse state effective at `asOf` from a trainee's dated
 * TraineeHorseAssignment intervals. Requires EXACTLY ONE covering interval
 * (same half-open rule as group). Zero / many covering intervals fail closed —
 * never the current Student horse mirror.
 */
export function resolveHistoricalHorse(
  intervals: readonly HorseIntervalRow[],
  asOf: Date,
): HistoricalHorseResult {
  const covering = intervals.filter((r) => isMembershipCurrentAt(r, asOf));
  if (covering.length === 0) {
    return { ok: false, kind: "NO_COVERING_INTERVAL" };
  }
  if (covering.length > 1) {
    return { ok: false, kind: "MULTIPLE_COVERING_INTERVALS" };
  }
  const row = covering[0];
  return {
    ok: true,
    value: {
      hasPrivateHorse: row.hasPrivateHorse,
      privateHorseName: row.privateHorseName,
      assignedHorseName: row.assignedHorseName,
    },
  };
}
