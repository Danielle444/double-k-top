// Fix 3, Stage 1 - copy-plan sanitizer for the dormant complex-plan template
// core.
//
// PURE by construction: the ONLY import is the sibling plain-data `types`
// module. No Prisma, no DB, no next/headers, no auth/session/cookies, no env,
// NO clock, no random. Every value in the output is derived solely from the
// explicit source tree and the two explicit `ReadonlySet`s passed in.
//
// PURPOSE: turn a source live complex-plan tree into FRESH nested destination
// create values, copying ONLY an allow-list of content fields and sanitizing
// references against the destination's active instructors and trainee roster.
// This is the pure heart of "copy a previous plan as a template"; the eventual
// DB write / all-or-nothing rollback (product decision E) lives elsewhere.
//
// ALLOW-LIST (everything else is dropped by construction - source ids,
// timestamps, version, actor/audit identity, publication/snapshot fields, and
// any feedback/attendance/completion fields never appear in the output):
//  - block:   startTime, endTime  (+ regenerated sortOrder)
//  - station: arena, instructorId (retained only if active) (+ sortOrder)
//  - pair:    horseName, note, sanitized trainee1Id/trainee2Id (+ sortOrder)
//
// SANITIZATION (product decisions A/C/D honoured upstream; here we implement C):
//  - instructorId kept only if in `activeInstructorIds`, else null.
//  - A trainee position is kept only if its id is a real string in
//    `destinationRosterTraineeIds`.
//  - trainee1 valid + trainee2 invalid    -> keep trainee1 only.
//  - trainee1 invalid + trainee2 valid    -> promote trainee2 into slot 1.
//  - neither valid                        -> drop the pair entirely.
//  - both resolve to the SAME trainee      -> keep one position only (no dupes).
//  - horseName/note preserved for retained pairs.
//  - sortOrder regenerated sequentially from 0 at every level (blocks within
//    the plan, stations within a block, pairs within a station AFTER
//    filtering/collapse).
//  - Empty blocks/stations present in the source structure are preserved.
//  - Source objects and both Sets are never mutated; deterministic; never
//    throws for ordinary null/missing optional references.

import type {
  DestinationBlockCreate,
  DestinationPairCreate,
  DestinationPlanCreate,
  DestinationStationCreate,
  SourcePlanBlock,
  SourcePlanPair,
  SourcePlanStation,
  SourcePlanTree,
} from "./types";

/** Coerce any value to a preserved string, or null for non-strings. */
function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** A required time string is preserved verbatim; a non-string collapses to "". */
function asTimeString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Resolve the two trainee positions of a source pair against the destination
 * roster, applying the collapse rules. Returns the sanitized
 * `{ trainee1Id, trainee2Id }` for the retained pair, or null when the pair
 * should be dropped (neither position resolves to a rostered trainee).
 */
function resolveTrainees(
  pair: SourcePlanPair,
  roster: ReadonlySet<string>
): { readonly trainee1Id: string; readonly trainee2Id: string | null } | null {
  const raw1 = pair.trainee1Id;
  const raw2 = pair.trainee2Id;
  const t1 = typeof raw1 === "string" && roster.has(raw1) ? raw1 : null;
  const t2 = typeof raw2 === "string" && roster.has(raw2) ? raw2 : null;

  if (t1 !== null && t2 !== null) {
    // Both valid; collapse an accidental duplicate to a single position.
    if (t1 === t2) {
      return { trainee1Id: t1, trainee2Id: null };
    }
    return { trainee1Id: t1, trainee2Id: t2 };
  }
  if (t1 !== null) {
    return { trainee1Id: t1, trainee2Id: null };
  }
  if (t2 !== null) {
    // Promote the sole valid trainee into position 1.
    return { trainee1Id: t2, trainee2Id: null };
  }
  return null;
}

function copyStation(
  station: SourcePlanStation,
  sortOrder: number,
  activeInstructorIds: ReadonlySet<string>,
  roster: ReadonlySet<string>
): DestinationStationCreate {
  const rawInstructorId = station.instructorId;
  const instructorId =
    typeof rawInstructorId === "string" && activeInstructorIds.has(rawInstructorId)
      ? rawInstructorId
      : null;

  const sourcePairs = Array.isArray(station.pairs) ? station.pairs : [];
  const pairs: DestinationPairCreate[] = [];
  for (const sourcePair of sourcePairs) {
    if (!sourcePair) {
      continue;
    }
    const resolved = resolveTrainees(sourcePair, roster);
    if (resolved === null) {
      // Neither trainee is rostered - drop the pair.
      continue;
    }
    pairs.push(
      Object.freeze({
        trainee1Id: resolved.trainee1Id,
        trainee2Id: resolved.trainee2Id,
        horseName: asNullableString(sourcePair.horseName),
        note: asNullableString(sourcePair.note),
        // Regenerated sequentially AFTER filtering/collapse.
        sortOrder: pairs.length,
      })
    );
  }

  return Object.freeze({
    instructorId,
    arena: asNullableString(station.arena),
    sortOrder,
    pairs: Object.freeze(pairs),
  });
}

function copyBlock(
  block: SourcePlanBlock,
  sortOrder: number,
  activeInstructorIds: ReadonlySet<string>,
  roster: ReadonlySet<string>
): DestinationBlockCreate {
  const sourceStations = Array.isArray(block.stations) ? block.stations : [];
  const stations: DestinationStationCreate[] = [];
  for (const sourceStation of sourceStations) {
    if (!sourceStation) {
      continue;
    }
    // Stations are preserved even when they end up with zero retained pairs -
    // only pairs with no valid trainee are dropped, never the station itself.
    stations.push(copyStation(sourceStation, stations.length, activeInstructorIds, roster));
  }

  return Object.freeze({
    startTime: asTimeString(block.startTime),
    endTime: asTimeString(block.endTime),
    sortOrder,
    stations: Object.freeze(stations),
  });
}

/**
 * Sanitize a source live complex-plan tree into fresh destination create
 * values. Pure, deterministic, non-mutating. The returned tree carries ONLY
 * allow-listed content fields plus regenerated sortOrders; no source ids,
 * timestamps, versions, audit, publication, or feedback fields can appear.
 */
export function copyPlanForTemplate(
  source: SourcePlanTree,
  activeInstructorIds: ReadonlySet<string>,
  destinationRosterTraineeIds: ReadonlySet<string>
): DestinationPlanCreate {
  const sourceBlocks =
    source && Array.isArray(source.blocks) ? source.blocks : [];
  const blocks: DestinationBlockCreate[] = [];
  for (const sourceBlock of sourceBlocks) {
    if (!sourceBlock) {
      continue;
    }
    // Empty blocks (zero stations) are preserved as part of the structure.
    blocks.push(copyBlock(sourceBlock, blocks.length, activeInstructorIds, destinationRosterTraineeIds));
  }

  return Object.freeze({ blocks: Object.freeze(blocks) });
}
