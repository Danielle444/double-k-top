// RIDING-COMPLEX-SCHEDULE-BOARD (Stage 3C.1 - placement index) - pure, DB-free.
//
// A deterministic, BLOCK-SCOPED index of where every trainee is currently placed
// inside one already-loaded complex riding plan, plus a resolver for the current
// occupants of one pair. It exists so the trainee selector (Stage 3C.2) can tell
// a FREE trainee (safe to check-box locally) from an OCCUPIED one (which must
// instead become an explicit Move/Swap proposal) without re-deriving that logic
// in the UI.
//
// This module performs NO Prisma/DB/action/auth/React/env/cookie/clock/random/
// revalidation work and imports nothing. It is DORMANT: no runtime code imports
// it in this stage. It reads only its narrow, structural input descriptor.
//
// SCOPE / SEMANTICS (mirrors the committed Stage 3A Move/Swap core):
//  - Uniqueness is BLOCK-scoped. The SAME trainee appearing in a DIFFERENT block
//    does NOT count as occupied in the block being queried (repeated scheduling
//    across blocks is legitimate). Only the queried block's rows are consulted.
//  - A trainee that appears MORE THAN ONCE inside the SAME block resolves to
//    AMBIGUOUS - never to an arbitrarily-chosen occurrence. The caller must fail
//    closed rather than guess which occurrence to move.
//  - This index concerns TRAINEE PLACEMENT ONLY. No names, horses, instructors,
//    notes, feedback, publication, audit fields, Prisma types, or UI types.
//
// FAIL-CLOSED / PURITY: malformed, null, or sparse rows are skipped and NEVER
// throw - a malformed pair contributes nothing (neither trainee occupancy nor a
// pair-occupants entry), so it can never masquerade as a resolvable placement.
// Caller-owned inputs are only READ - never mutated or frozen. The returned index
// and the small result objects it hands back ARE frozen (the committed core's
// defence-in-depth convention), so a consumer can never mutate the index.

// ---------------------------------------------------------------------------
// Narrow, readonly input descriptor (the smallest slice of a loaded plan needed
// to place trainees). Deliberately excludes every field unrelated to trainee
// placement.
// ---------------------------------------------------------------------------

/** One pair: its stable id and the two trainee seats. */
export interface PlacementPairInput {
  readonly id: string;
  readonly trainee1Id: string | null;
  readonly trainee2Id: string | null;
}

/** One station: its stable id and ordered pairs. */
export interface PlacementStationInput {
  readonly id: string;
  readonly pairs: readonly PlacementPairInput[];
}

/** One time block: its stable id and ordered stations. */
export interface PlacementBlockInput {
  readonly id: string;
  readonly stations: readonly PlacementStationInput[];
}

/** The loaded plan reduced to its blocks (no version/id needed for placement). */
export interface PlacementPlanInput {
  readonly blocks: readonly PlacementBlockInput[];
}

// ---------------------------------------------------------------------------
// Result shapes.
// ---------------------------------------------------------------------------

/** Which seat of a pair a trainee sits in (1 = trainee1, 2 = trainee2). */
export type TraineeSlot = 1 | 2;

/** The concrete position of an OCCUPIED trainee within the queried block. */
export interface TraineeOccupancy {
  readonly blockId: string;
  readonly stationId: string;
  readonly pairId: string;
  readonly slot: TraineeSlot;
}

/**
 * The placement of one trainee within ONE block:
 *  - FREE ...... the trainee holds no seat in this block (it may still be placed
 *      in another block - that does not count here).
 *  - OCCUPIED .. the trainee holds exactly one seat in this block, at `at`.
 *  - AMBIGUOUS . the trainee holds more than one seat in this block; the caller
 *      must fail closed rather than pick an occurrence.
 */
export type TraineePlacement =
  | { readonly status: "FREE" }
  | { readonly status: "OCCUPIED"; readonly at: TraineeOccupancy }
  | { readonly status: "AMBIGUOUS" };

/** The two trainee seats of one pair, as currently stored. */
export interface PairOccupants {
  readonly trainee1Id: string | null;
  readonly trainee2Id: string | null;
}

// ---------------------------------------------------------------------------
// Opaque index handle. Treat as opaque - resolve only through the exported
// functions below. (Its internal maps are never exposed for mutation and are
// never mutated after `buildTraineePlacementIndex` returns.)
// ---------------------------------------------------------------------------

/** Marks a within-block duplicate (trainee seat or pair id) as unresolvable. */
const AMBIGUOUS: unique symbol = Symbol("ambiguous");
type Ambiguous = typeof AMBIGUOUS;

interface BlockIndex {
  /** traineeId -> its single occupancy, or AMBIGUOUS when duplicated in-block. */
  readonly trainees: Map<string, TraineeOccupancy | Ambiguous>;
  /** pairId -> its occupants, or AMBIGUOUS when the pair id repeats in-block. */
  readonly pairs: Map<string, PairOccupants | Ambiguous>;
}

export interface TraineePlacementIndex {
  readonly blocks: Map<string, BlockIndex>;
}

// ---------------------------------------------------------------------------
// Small defensive readers (a malformed value fails closed; nothing throws).
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

/** A required, non-empty string id (rejects "" and non-strings). */
function readId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * STRICT trainee-seat read, matching the committed Stage 3A core's
 * readNullableString contract (a non-null, non-string seat is MALFORMED, never
 * silently normalized to an empty seat):
 *  - null / undefined / blank ("") string -> a valid EMPTY seat (value: null);
 *  - a non-empty string -> a valid trainee id;
 *  - any non-null, non-string runtime value -> malformed (ok: false).
 */
type SeatRead = { ok: true; value: string | null } | { ok: false };

function readSeat(value: unknown): SeatRead {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (typeof value === "string") return { ok: true, value: value.length > 0 ? value : null };
  return { ok: false };
}

// ---------------------------------------------------------------------------
// Build.
// ---------------------------------------------------------------------------

/** Record one trainee occurrence into a block, escalating to AMBIGUOUS on any
 *  second occurrence of the same trainee within that block. */
function addOccurrence(block: BlockIndex, traineeId: string, occ: TraineeOccupancy): void {
  const existing = block.trainees.get(traineeId);
  if (existing === undefined) {
    block.trainees.set(traineeId, occ);
  } else {
    block.trainees.set(traineeId, AMBIGUOUS);
  }
}

/**
 * Build a block-scoped trainee placement index from a loaded plan descriptor.
 * Pure, deterministic, non-mutating, and NEVER throws: malformed / null / sparse
 * blocks, stations, or pairs are skipped and contribute nothing. The returned
 * index (and every object it later hands back) is frozen.
 */
export function buildTraineePlacementIndex(plan: PlacementPlanInput): TraineePlacementIndex {
  const blocks = new Map<string, BlockIndex>();
  const planRecord = asRecord(plan);
  const rawBlocks = planRecord && Array.isArray(planRecord.blocks) ? planRecord.blocks : [];

  for (const rawBlock of rawBlocks) {
    const blockRecord = asRecord(rawBlock);
    if (!blockRecord) continue;
    const blockId = readId(blockRecord.id);
    if (blockId === null) continue;
    // A repeated block id is itself ambiguous; merge into the first block index
    // so every seen occurrence still counts toward in-block duplicate detection.
    let block = blocks.get(blockId);
    if (block === undefined) {
      block = { trainees: new Map(), pairs: new Map() };
      blocks.set(blockId, block);
    }
    const rawStations = Array.isArray(blockRecord.stations) ? blockRecord.stations : [];

    for (const rawStation of rawStations) {
      const stationRecord = asRecord(rawStation);
      if (!stationRecord) continue;
      const stationId = readId(stationRecord.id);
      if (stationId === null) continue;
      const rawPairs = Array.isArray(stationRecord.pairs) ? stationRecord.pairs : [];

      for (const rawPair of rawPairs) {
        const pairRecord = asRecord(rawPair);
        if (!pairRecord) continue;
        const pairId = readId(pairRecord.id);
        if (pairId === null) continue;

        const t1 = readSeat(pairRecord.trainee1Id);
        const t2 = readSeat(pairRecord.trainee2Id);
        // A malformed seat corrupts the whole pair: register NOTHING - no empty
        // destination and no trainee placements - so the pair fails closed on
        // resolution (resolvePairOccupants -> null -> STALE_TARGET) and can never
        // be silently normalized into an actionable move/swap target.
        if (!t1.ok || !t2.ok) continue;
        const trainee1Id = t1.value;
        const trainee2Id = t2.value;

        // Pair occupants (for destination-slot resolution). A repeated pair id in
        // one block is unresolvable -> AMBIGUOUS (resolves to null later).
        if (block.pairs.has(pairId)) {
          block.pairs.set(pairId, AMBIGUOUS);
        } else {
          block.pairs.set(pairId, Object.freeze({ trainee1Id, trainee2Id }));
        }

        if (trainee1Id !== null) {
          addOccurrence(block, trainee1Id, Object.freeze({ blockId, stationId, pairId, slot: 1 }));
        }
        if (trainee2Id !== null) {
          addOccurrence(block, trainee2Id, Object.freeze({ blockId, stationId, pairId, slot: 2 }));
        }
      }
    }
  }

  return Object.freeze({ blocks });
}

// ---------------------------------------------------------------------------
// Resolve.
// ---------------------------------------------------------------------------

const FREE: TraineePlacement = Object.freeze({ status: "FREE" });
const AMBIGUOUS_PLACEMENT: TraineePlacement = Object.freeze({ status: "AMBIGUOUS" });

/**
 * Resolve where `traineeId` sits within `blockId`:
 *  - FREE when it holds no seat in that block (or the block/trainee is unknown);
 *  - OCCUPIED with its single position; or
 *  - AMBIGUOUS when it holds more than one seat in that block.
 * Block-scoped: a placement in any OTHER block never influences this answer.
 */
export function resolveTraineePlacement(
  index: TraineePlacementIndex,
  blockId: string,
  traineeId: string
): TraineePlacement {
  const block = index.blocks.get(blockId);
  if (block === undefined) return FREE;
  const entry = block.trainees.get(traineeId);
  if (entry === undefined) return FREE;
  if (entry === AMBIGUOUS) return AMBIGUOUS_PLACEMENT;
  return Object.freeze({ status: "OCCUPIED", at: entry });
}

/**
 * Resolve the current occupants of `pairId` within `blockId`, or null when the
 * pair is not found in that block or its id is ambiguously duplicated there. A
 * null answer means "no confident destination pair" - the caller treats it as a
 * stale/vanished target.
 */
export function resolvePairOccupants(
  index: TraineePlacementIndex,
  blockId: string,
  pairId: string
): PairOccupants | null {
  const block = index.blocks.get(blockId);
  if (block === undefined) return null;
  const entry = block.pairs.get(pairId);
  if (entry === undefined || entry === AMBIGUOUS) return null;
  return entry;
}
