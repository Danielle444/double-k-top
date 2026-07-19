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
//
// STAGE 2 - cross-pair trainee dedup, scoped to a whole BLOCK (across every one
// of its stations), applied in deterministic source order AFTER roster
// filtering/collapse:
//  - A trainee may appear at most once anywhere in one copied block.
//  - A position whose trainee was already used earlier in the same block is
//    removed; if only the second position survives it is promoted to trainee1;
//    if neither survives the pair is dropped. Never the same trainee in both
//    positions.
//  - Pair sortOrder still regenerates sequentially (per station) AFTER this.
//
// TRUST BOUNDARY (Stage 2): only TRAINEE uniqueness is re-enforced here, as
// defence-in-depth - a copy source is not guaranteed to have passed save-time
// validation (legacy rows, repair scripts, or a future template-of-a-template),
// so a source could carry the same trainee in two pairs. HORSE-name and
// INSTRUCTOR block-uniqueness are deliberately NOT re-deduped: those invariants
// are maintained on the persisted source by saveComplexStationInternal
// (DUPLICATE_HORSE_IN_BLOCK / DUPLICATE_INSTRUCTOR_IN_BLOCK) and are trusted
// here; re-deduping them would risk silently dropping legitimately-distinct
// content and is out of Stage-2 scope.

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

/**
 * Stage 2 - apply BLOCK-scoped cross-pair trainee dedup to an already
 * within-pair-sanitized `{ trainee1Id, trainee2Id }`. Any position whose
 * trainee was already used earlier in THIS block is removed; if only the second
 * position survives it is promoted into position 1; if neither survives the
 * pair is dropped (null). Never returns the same trainee in both positions
 * (the input already guarantees trainee1Id !== trainee2Id). `usedInBlock` is
 * only READ here - the caller records the retained ids after a pair is kept.
 */
function dedupAgainstBlock(
  resolved: { readonly trainee1Id: string; readonly trainee2Id: string | null },
  usedInBlock: ReadonlySet<string>
): { readonly trainee1Id: string; readonly trainee2Id: string | null } | null {
  const first = usedInBlock.has(resolved.trainee1Id) ? null : resolved.trainee1Id;
  const rawSecond = resolved.trainee2Id;
  const second = rawSecond !== null && !usedInBlock.has(rawSecond) ? rawSecond : null;

  if (first === null && second === null) {
    return null;
  }
  if (first === null) {
    // Only the second position survived - promote it into position 1.
    return { trainee1Id: second as string, trainee2Id: null };
  }
  return { trainee1Id: first, trainee2Id: second };
}

function copyStation(
  station: SourcePlanStation,
  sortOrder: number,
  activeInstructorIds: ReadonlySet<string>,
  roster: ReadonlySet<string>,
  usedInBlock: Set<string>
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
    // Stage 2 - a trainee may appear at most once anywhere in the block.
    const deduped = dedupAgainstBlock(resolved, usedInBlock);
    if (deduped === null) {
      // Every surviving trainee was already used earlier in this block.
      continue;
    }
    usedInBlock.add(deduped.trainee1Id);
    if (deduped.trainee2Id !== null) {
      usedInBlock.add(deduped.trainee2Id);
    }
    pairs.push(
      Object.freeze({
        trainee1Id: deduped.trainee1Id,
        trainee2Id: deduped.trainee2Id,
        horseName: asNullableString(sourcePair.horseName),
        note: asNullableString(sourcePair.note),
        // Regenerated sequentially AFTER filtering/collapse/dedup.
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
  // Stage 2 - trainee dedup is scoped to the WHOLE block (across all of its
  // stations), so the used-set lives here and is threaded through every station
  // in deterministic source order. Fresh per block: the same trainee may
  // legitimately reappear in a different block.
  const usedInBlock = new Set<string>();
  for (const sourceStation of sourceStations) {
    if (!sourceStation) {
      continue;
    }
    // Stations are preserved even when they end up with zero retained pairs -
    // only pairs with no valid trainee (or an already-used one) are dropped,
    // never the station itself.
    stations.push(copyStation(sourceStation, stations.length, activeInstructorIds, roster, usedInBlock));
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
