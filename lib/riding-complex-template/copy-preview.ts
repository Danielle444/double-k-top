// RC-B1 - pure copy-preview projection for the complex-plan template workflow.
//
// PURE by construction: the ONLY import is the sibling plain-data `types`
// module (type-only). No Prisma, no DB, no next/headers, no auth/session/
// cookies, no env, NO hidden clock (`Date.now()` / argless `new Date()`), no
// random, no `localeCompare`, no locale/timezone. Every value in the output is
// derived solely from the explicit sanitized copy payload passed in.
//
// PURPOSE: given the ALREADY-SANITIZED destination copy payload produced by
// `copyPlanForTemplate` (a DestinationPlanCreate tree of blocks -> stations ->
// pairs, carrying only allow-listed content fields), produce a deterministic,
// read-only view-model a manager can inspect BEFORE confirming a copy. This
// stage performs no DB lookup, no source selection, no copy, no mutation, and
// no UI rendering - it only projects counts + a structural summary + a stable
// reset summary from the payload it is handed.
//
// The input is the sanitized payload by design, so the forbidden fields are
// already structurally absent: DestinationPlanCreate/Block/Station/Pair carry
// no database ids, no source ids, no timestamps, no version/sourceVersion, no
// publication/snapshot rows, and no feedback/attendance/completion/history. The
// preview therefore cannot leak any of them - it only re-projects the four
// content fields per pair (trainee1Id/trainee2Id/horseName/note; `note` IS part
// of the sanitized planning payload, see copy-plan.ts) plus station arena/
// instructorId and block start/end times, with regenerated aggregate counts.
//
// COUNTING (locked):
//  - blockCount/stationCount/pairCount are raw structural counts.
//  - traineeCount is the number of DISTINCT non-empty trainee ids in scope (a
//    pair with two different trainees contributes two; the same trainee reused
//    across placements is counted once). Computed at station, block, and plan
//    scope from the distinct union - never by summing child counts (a trainee
//    or instructor may span more than one station/block).
//  - instructorCount is the number of DISTINCT non-empty station instructorIds
//    in scope.
//  - horseAssignmentCount is the number of pairs carrying a non-empty horseName.
//  - a null OR empty-string trainee/instructor/horse value is "unassigned" and
//    never counted.
//
// SAFETY: existing sanitized structural order is preserved (never re-sorted);
// inputs are never mutated; the returned object, every nested object, and every
// array are frozen; the same logical input yields identical output; malformed/
// missing arrays and null elements fail safely (skipped), matching the
// defensive style of copy-plan.ts - never throwing.

import type {
  DestinationBlockCreate,
  DestinationPlanCreate,
  DestinationStationCreate,
} from "./types";

/**
 * A stable, machine-readable code for one class of source data the copy
 * deliberately does NOT carry over. UI maps these to prose; the pure core never
 * hardcodes final UI wording.
 */
export type CopyResetCode =
  | "PUBLICATION_STATE"
  | "FEEDBACK"
  | "ATTENDANCE"
  | "COMPLETION_HISTORY"
  | "SOURCE_IDENTIFIERS"
  | "SOURCE_SCHEDULE_IDENTITY"
  | "STALE_VERSION_METADATA";

/**
 * The full, fixed reset summary - always present and identical regardless of
 * payload content, because a copy NEVER carries any of these over. Frozen and
 * shared so every preview reports the exact same stable set.
 */
export const COMPLEX_COPY_RESET_CODES: readonly CopyResetCode[] = Object.freeze([
  "PUBLICATION_STATE",
  "FEEDBACK",
  "ATTENDANCE",
  "COMPLETION_HISTORY",
  "SOURCE_IDENTIFIERS",
  "SOURCE_SCHEDULE_IDENTITY",
  "STALE_VERSION_METADATA",
]);

/** Preview of one sanitized pair/placement - planning-safe content fields only. */
export interface ComplexCopyPairPreview {
  readonly trainee1Id: string | null;
  readonly trainee2Id: string | null;
  readonly horseName: string | null;
  readonly note: string | null;
}

/** Preview of one sanitized station within a block. */
export interface ComplexCopyStationPreview {
  readonly arena: string | null;
  readonly instructorId: string | null;
  readonly pairCount: number;
  /** Distinct non-empty trainee ids in this station, in structural order. */
  readonly traineeIds: readonly string[];
  /** Non-empty horse names in this station, in structural order. */
  readonly horseNames: readonly string[];
  /** = horseNames.length (pairs carrying a horse). */
  readonly horseAssignmentCount: number;
  readonly pairs: readonly ComplexCopyPairPreview[];
}

/** Preview of one sanitized time block. */
export interface ComplexCopyBlockPreview {
  readonly startTime: string;
  readonly endTime: string;
  readonly stationCount: number;
  readonly pairCount: number;
  /** Distinct non-empty trainee ids across this block's stations. */
  readonly traineeCount: number;
  /** Distinct non-empty instructor ids across this block's stations. */
  readonly instructorCount: number;
  readonly horseAssignmentCount: number;
  readonly stations: readonly ComplexCopyStationPreview[];
}

/** The full copy preview for one sanitized destination plan payload. */
export interface ComplexCopyPreview {
  readonly blockCount: number;
  readonly stationCount: number;
  readonly pairCount: number;
  /** Distinct non-empty trainee ids across the whole plan. */
  readonly traineeCount: number;
  /** Distinct non-empty instructor ids across the whole plan. */
  readonly instructorCount: number;
  readonly horseAssignmentCount: number;
  readonly blocks: readonly ComplexCopyBlockPreview[];
  readonly resetSummary: readonly CopyResetCode[];
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Preserve first-seen order while removing duplicate ids. */
function dedupeInOrder(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

function buildStationPreview(station: DestinationStationCreate): ComplexCopyStationPreview {
  const pairsInput = Array.isArray(station.pairs) ? station.pairs : [];
  const pairs: ComplexCopyPairPreview[] = [];
  const rawTraineeIds: string[] = [];
  const horseNames: string[] = [];

  for (const pair of pairsInput) {
    if (!pair) {
      continue;
    }
    const trainee1Id = isNonEmptyString(pair.trainee1Id) ? pair.trainee1Id : null;
    const trainee2Id = isNonEmptyString(pair.trainee2Id) ? pair.trainee2Id : null;
    const horseName = isNonEmptyString(pair.horseName) ? pair.horseName : null;
    const note = isNonEmptyString(pair.note) ? pair.note : null;
    if (trainee1Id !== null) {
      rawTraineeIds.push(trainee1Id);
    }
    if (trainee2Id !== null) {
      rawTraineeIds.push(trainee2Id);
    }
    if (horseName !== null) {
      horseNames.push(horseName);
    }
    pairs.push(Object.freeze({ trainee1Id, trainee2Id, horseName, note }));
  }

  return Object.freeze({
    arena: isNonEmptyString(station.arena) ? station.arena : null,
    instructorId: isNonEmptyString(station.instructorId) ? station.instructorId : null,
    pairCount: pairs.length,
    traineeIds: Object.freeze(dedupeInOrder(rawTraineeIds)),
    horseNames: Object.freeze(horseNames.slice()),
    horseAssignmentCount: horseNames.length,
    pairs: Object.freeze(pairs),
  });
}

function buildBlockPreview(block: DestinationBlockCreate): ComplexCopyBlockPreview {
  const stationsInput = Array.isArray(block.stations) ? block.stations : [];
  const stations: ComplexCopyStationPreview[] = [];
  const traineeSet = new Set<string>();
  const instructorSet = new Set<string>();
  let pairCount = 0;
  let horseAssignmentCount = 0;

  for (const station of stationsInput) {
    if (!station) {
      continue;
    }
    const stationPreview = buildStationPreview(station);
    stations.push(stationPreview);
    pairCount += stationPreview.pairCount;
    horseAssignmentCount += stationPreview.horseAssignmentCount;
    for (const traineeId of stationPreview.traineeIds) {
      traineeSet.add(traineeId);
    }
    if (stationPreview.instructorId !== null) {
      instructorSet.add(stationPreview.instructorId);
    }
  }

  return Object.freeze({
    startTime: typeof block.startTime === "string" ? block.startTime : "",
    endTime: typeof block.endTime === "string" ? block.endTime : "",
    stationCount: stations.length,
    pairCount,
    traineeCount: traineeSet.size,
    instructorCount: instructorSet.size,
    horseAssignmentCount,
    stations: Object.freeze(stations),
  });
}

/**
 * Project a sanitized destination copy payload into a deterministic, frozen
 * preview view-model. Pure, non-mutating, order-preserving. A malformed or
 * missing `blocks` array (and any null block/station/pair element) is handled by
 * exclusion, never by throwing. The reset summary is always the full fixed set.
 */
export function buildComplexCopyPreview(plan: DestinationPlanCreate): ComplexCopyPreview {
  const blocksInput = plan && Array.isArray(plan.blocks) ? plan.blocks : [];
  const blocks: ComplexCopyBlockPreview[] = [];
  const traineeSet = new Set<string>();
  const instructorSet = new Set<string>();
  let stationCount = 0;
  let pairCount = 0;
  let horseAssignmentCount = 0;

  for (const block of blocksInput) {
    if (!block) {
      continue;
    }
    const blockPreview = buildBlockPreview(block);
    blocks.push(blockPreview);
    stationCount += blockPreview.stationCount;
    pairCount += blockPreview.pairCount;
    horseAssignmentCount += blockPreview.horseAssignmentCount;
    // Distinct plan-wide counts are re-derived from station data (never summed
    // from block counts) so a trainee/instructor spanning two blocks is counted
    // once.
    for (const station of blockPreview.stations) {
      for (const traineeId of station.traineeIds) {
        traineeSet.add(traineeId);
      }
      if (station.instructorId !== null) {
        instructorSet.add(station.instructorId);
      }
    }
  }

  return Object.freeze({
    blockCount: blocks.length,
    stationCount,
    pairCount,
    traineeCount: traineeSet.size,
    instructorCount: instructorSet.size,
    horseAssignmentCount,
    blocks: Object.freeze(blocks),
    resetSummary: COMPLEX_COPY_RESET_CODES,
  });
}
