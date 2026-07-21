// RIDING-COMPLEX-SCHEDULE-BOARD (Stage 3D.1 - pair placement index) - pure,
// DB-free.
//
// A deterministic, PLAN-WIDE structural index of where each stable PAIR and each
// stable STATION sits inside one already-loaded complex riding plan. It exists so
// the future whole-pair Move/Swap selector (a later stage) can resolve a picked
// source pair and a picked destination (a station or another pair) to a confident
// block/station location - or fail closed - WITHOUT re-deriving that routing in
// the UI.
//
// This module performs NO Prisma/DB/action/auth/React/env/cookie/clock/random/
// revalidation work and imports nothing. It is DORMANT: no runtime code imports
// it in this stage. It reads only its narrow, structural input descriptor.
//
// SCOPE / SEMANTICS:
//  - The index is PLAN-WIDE, not block-scoped: a MOVE_PAIR/SWAP_PAIRS may cross
//    blocks inside the SAME loaded plan, so every pair/station id must route to
//    exactly one location across the whole tree. Uniqueness is therefore enforced
//    across the WHOLE plan here (unlike the block-scoped horse/instructor indexes).
//  - A stable PAIR id maps to exactly one { block, station, pair }. A stable
//    STATION id maps to exactly one { block, station }. EMPTY stations are indexed
//    and remain resolvable (they are valid, empty Move destinations).
//  - This index carries STRUCTURAL IDS ONLY. It copies NO pair contents - no
//    trainee ids, horse name, note, sortOrder, instructor, arena, names, feedback,
//    publication, audit, Prisma, or UI data. Only block/station/pair ids travel.
//
// FAIL-CLOSED / DUPLICATE POLICY (never guess an ambiguous target):
//  - A duplicate STATION id ANYWHERE in the plan POISONS that station identity and
//    ALL of its nested routing: the station id itself resolves AMBIGUOUS (never an
//    arbitrarily-chosen occurrence), AND every pair under ANY occurrence of that
//    duplicated station id also resolves AMBIGUOUS. A uniquely-identified pair under
//    a duplicated station is NOT confidently placed - its station/time context is
//    ambiguous - so it must fail closed rather than expose a guessed location. Two
//    physically different stations sharing one id are NEVER merged into a usable
//    target.
//  - A duplicate PAIR id ANYWHERE in the plan -> that pair id resolves AMBIGUOUS.
//  - A duplicate BLOCK id POISONS that block identity and ALL of its nested
//    routing: every station and pair under ANY occurrence of a duplicated block id
//    resolves AMBIGUOUS (its containing block is unresolvable, so no confident
//    blockId can be returned). Two duplicate blocks are NEVER merged into a usable
//    target.
//  - Malformed rows/ids fail closed: a malformed block/station/pair row (or one
//    with a missing/blank/non-string id) is SKIPPED and contributes nothing. In
//    particular a malformed station never becomes a resolvable (valid empty)
//    destination, and pairs beneath a malformed (unroutable) station are skipped
//    too.
//  - null / sparse blocks, stations, or pairs arrays NEVER throw.
//
// PURITY: caller-owned inputs are only READ - never mutated or frozen. The returned
// index and every small result object it hands back ARE frozen (defence-in-depth,
// matching the committed core convention). Deterministic: same input -> same index.

// ---------------------------------------------------------------------------
// Narrow, readonly input descriptor (the smallest slice of a loaded plan needed
// to route pairs and stations). Deliberately excludes every field unrelated to
// structural placement - no version, trainees, horse, note, sortOrder, instructor,
// or arena.
// ---------------------------------------------------------------------------

/** One pair: its stable id only (contents never travel through this index). */
export interface PairPlacementPairInput {
  readonly id: string;
}

/** One station: its stable id and its ordered pairs (may be empty). */
export interface PairPlacementStationInput {
  readonly id: string;
  readonly pairs: readonly PairPlacementPairInput[];
}

/** One time block: its stable id and ordered stations. */
export interface PairPlacementBlockInput {
  readonly id: string;
  readonly stations: readonly PairPlacementStationInput[];
}

/** The loaded plan reduced to its blocks (no version/id needed for placement). */
export interface PairPlacementPlanInput {
  readonly blocks: readonly PairPlacementBlockInput[];
}

// ---------------------------------------------------------------------------
// Result shapes. FOUND carries a confident full path; MISSING and AMBIGUOUS carry
// no ids at all.
// ---------------------------------------------------------------------------

/**
 * Where one candidate PAIR sits within the plan:
 *  - FOUND ..... exactly one location, at { blockId, stationId, pairId };
 *  - MISSING ... no pair with that id exists (or the id/input was malformed);
 *  - AMBIGUOUS . the pair id is duplicated in the plan, or its containing station
 *      id is duplicated (poisoned), or its containing block id is duplicated
 *      (poisoned) - the caller must fail closed, never guess.
 */
export type PairPlacement =
  | { readonly status: "FOUND"; readonly blockId: string; readonly stationId: string; readonly pairId: string }
  | { readonly status: "MISSING" }
  | { readonly status: "AMBIGUOUS" };

/**
 * Where one candidate STATION sits within the plan:
 *  - FOUND ..... exactly one location, at { blockId, stationId };
 *  - MISSING ... no station with that id exists (or the id/input was malformed);
 *  - AMBIGUOUS . the station id is duplicated in the plan, or its containing block
 *      id is duplicated (poisoned).
 */
export type StationPlacement =
  | { readonly status: "FOUND"; readonly blockId: string; readonly stationId: string }
  | { readonly status: "MISSING" }
  | { readonly status: "AMBIGUOUS" };

// ---------------------------------------------------------------------------
// Opaque index handle. Treat as opaque - resolve only through the exported
// functions below. Its internal maps are never exposed for mutation and are never
// mutated after `buildPairPlacementIndex` returns.
// ---------------------------------------------------------------------------

/** Marks a duplicated (station or pair) id as unresolvable. */
const AMBIGUOUS: unique symbol = Symbol("ambiguous");
type Ambiguous = typeof AMBIGUOUS;

/** The stored single location of one station. */
interface StationEntry {
  readonly blockId: string;
  readonly stationId: string;
}

/** The stored single location of one pair. */
interface PairEntry {
  readonly blockId: string;
  readonly stationId: string;
  readonly pairId: string;
}

export interface PairPlacementIndex {
  /** stationId -> its single location, or AMBIGUOUS when duplicated/poisoned. */
  readonly stations: Map<string, StationEntry | Ambiguous>;
  /** pairId -> its single location, or AMBIGUOUS when duplicated/poisoned. */
  readonly pairs: Map<string, PairEntry | Ambiguous>;
}

// ---------------------------------------------------------------------------
// Small defensive readers (a malformed value fails closed; nothing throws).
// ---------------------------------------------------------------------------

/** A plain (non-array) object narrowed to a string-keyed record, else null. */
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

/** An array value or an empty array (a null/sparse/non-array never throws). */
function readArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

// ---------------------------------------------------------------------------
// Build.
// ---------------------------------------------------------------------------

/**
 * Build a plan-wide pair/station placement index from a loaded plan descriptor.
 * Pure, deterministic, non-mutating, and NEVER throws: malformed / null / sparse
 * blocks, stations, or pairs are skipped and contribute nothing. Duplicate pair ids
 * anywhere resolve AMBIGUOUS; a duplicate station id poisons that station AND all of
 * its nested pairs to AMBIGUOUS; a duplicate block id poisons all of its nested
 * station/pair routing to AMBIGUOUS. The returned index (and every location object
 * it later hands back) is frozen.
 */
export function buildPairPlacementIndex(plan: PairPlacementPlanInput): PairPlacementIndex {
  const stations = new Map<string, StationEntry | Ambiguous>();
  const pairs = new Map<string, PairEntry | Ambiguous>();

  const planRecord = asRecord(plan);
  const rawBlocks = planRecord ? readArray(planRecord.blocks) : [];

  // Pass 1: count valid block ids AND valid station ids plan-wide to detect
  // duplicated (poisoned) block/station identities BEFORE any nested routing is
  // recorded. Pre-counting stations is required so pairs under the FIRST occurrence
  // of a duplicated station are poisoned too - we must never encounter the second
  // occurrence later and retroactively guess which already-recorded pairs to change.
  // Malformed blocks/stations (and stations under a malformed block) contribute
  // nothing to either count.
  const blockIdCounts = new Map<string, number>();
  const stationIdCounts = new Map<string, number>();
  for (const rawBlock of rawBlocks) {
    const blockRecord = asRecord(rawBlock);
    if (!blockRecord) continue;
    const blockId = readId(blockRecord.id);
    if (blockId === null) continue;
    blockIdCounts.set(blockId, (blockIdCounts.get(blockId) ?? 0) + 1);

    for (const rawStation of readArray(blockRecord.stations)) {
      const stationRecord = asRecord(rawStation);
      if (!stationRecord) continue;
      const stationId = readId(stationRecord.id);
      // A malformed station row / invalid station id never affects valid counts.
      if (stationId === null) continue;
      stationIdCounts.set(stationId, (stationIdCounts.get(stationId) ?? 0) + 1);
    }
  }

  // Pass 2: record station/pair locations. A station is poisoned when its containing
  // block id is poisoned OR its own station id occurs more than once plan-wide; a
  // poisoned station forces itself and ALL of its pairs to AMBIGUOUS. Any other
  // in-plan duplicate (a repeated pair id) escalates to AMBIGUOUS on its second
  // occurrence.
  for (const rawBlock of rawBlocks) {
    const blockRecord = asRecord(rawBlock);
    if (!blockRecord) continue;
    const blockId = readId(blockRecord.id);
    if (blockId === null) continue;
    const blockPoisoned = (blockIdCounts.get(blockId) ?? 0) > 1;

    for (const rawStation of readArray(blockRecord.stations)) {
      const stationRecord = asRecord(rawStation);
      if (!stationRecord) continue;
      const stationId = readId(stationRecord.id);
      // A malformed station is skipped whole - it never becomes a valid empty
      // destination, and its (unroutable) pairs are skipped with it.
      if (stationId === null) continue;

      // A station whose block is poisoned, or whose own id is duplicated plan-wide,
      // is unresolvable: neither it nor any pair beneath it may expose a guessed
      // (block/station) location.
      const stationPoisoned = blockPoisoned || (stationIdCounts.get(stationId) ?? 0) > 1;

      if (stationPoisoned) {
        stations.set(stationId, AMBIGUOUS);
      } else if (stations.has(stationId)) {
        stations.set(stationId, AMBIGUOUS);
      } else {
        stations.set(stationId, Object.freeze({ blockId, stationId }));
      }

      for (const rawPair of readArray(stationRecord.pairs)) {
        const pairRecord = asRecord(rawPair);
        if (!pairRecord) continue;
        const pairId = readId(pairRecord.id);
        if (pairId === null) continue;

        if (stationPoisoned) {
          pairs.set(pairId, AMBIGUOUS);
        } else if (pairs.has(pairId)) {
          pairs.set(pairId, AMBIGUOUS);
        } else {
          pairs.set(pairId, Object.freeze({ blockId, stationId, pairId }));
        }
      }
    }
  }

  return Object.freeze({ stations, pairs });
}

// ---------------------------------------------------------------------------
// Resolve.
// ---------------------------------------------------------------------------

const PAIR_MISSING: PairPlacement = Object.freeze({ status: "MISSING" });
const PAIR_AMBIGUOUS: PairPlacement = Object.freeze({ status: "AMBIGUOUS" });
const STATION_MISSING: StationPlacement = Object.freeze({ status: "MISSING" });
const STATION_AMBIGUOUS: StationPlacement = Object.freeze({ status: "AMBIGUOUS" });

/**
 * Resolve where `pairId` sits in the plan: FOUND with its full { blockId,
 * stationId, pairId } path, MISSING when no such pair exists (or the id is
 * blank/non-string), or AMBIGUOUS when the pair id is duplicated or its block id is
 * poisoned. Frozen result; never throws.
 */
export function resolvePairPlacement(index: PairPlacementIndex, pairId: string): PairPlacement {
  if (readId(pairId) === null) return PAIR_MISSING;
  const entry = index.pairs.get(pairId);
  if (entry === undefined) return PAIR_MISSING;
  if (entry === AMBIGUOUS) return PAIR_AMBIGUOUS;
  return Object.freeze({
    status: "FOUND",
    blockId: entry.blockId,
    stationId: entry.stationId,
    pairId: entry.pairId,
  });
}

/**
 * Resolve where `stationId` sits in the plan: FOUND with its { blockId, stationId }
 * location (even when the station is empty), MISSING when no such station exists
 * (or the id is blank/non-string), or AMBIGUOUS when the station id is duplicated or
 * its block id is poisoned. Frozen result; never throws.
 */
export function resolveStationPlacement(index: PairPlacementIndex, stationId: string): StationPlacement {
  if (readId(stationId) === null) return STATION_MISSING;
  const entry = index.stations.get(stationId);
  if (entry === undefined) return STATION_MISSING;
  if (entry === AMBIGUOUS) return STATION_AMBIGUOUS;
  return Object.freeze({ status: "FOUND", blockId: entry.blockId, stationId: entry.stationId });
}
