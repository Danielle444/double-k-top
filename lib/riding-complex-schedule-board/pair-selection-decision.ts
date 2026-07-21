// RIDING-COMPLEX-SCHEDULE-BOARD (Stage 3D.1 - pair-selection decision) - pure,
// DB-free.
//
// The single deciding function behind choosing where to move a WHOLE PAIR in the
// schedule-board editor. Given the plan-wide pair placement index
// (pair-placement-index.ts), a picked SOURCE pair, a picked DESTINATION (either a
// station or another pair), and the loaded plan version, it returns a CLOSED
// decision telling the future UI exactly what to do - WITHOUT the UI re-implementing
// any routing rule:
//
//   - MOVE_PAIR_PROPOSAL . the destination is a (different) STATION -> an atomic
//       MOVE_PAIR command (the exact committed Stage 3A shape) is prepared for
//       one-tap confirmation. The whole pair (trainee1 + trainee2 + horseName +
//       note) travels; instructor/arena/station metadata do not.
//   - SWAP_PAIRS_PROPOSAL. the destination is another PAIR in a DIFFERENT station
//       -> an atomic SWAP_PAIRS command is prepared.
//   - NO_CHANGE ......... the destination pair IS the source pair (same-pair).
//   - SAME_STATION ...... a Move onto the pair's own station, or a Swap with a pair
//       in the SAME station. Stage 3D deliberately does NOT support same-station
//       Move/Swap: it must NEVER produce a command.
//   - STALE_TARGET ...... the source pair, destination station, or destination pair
//       vanished from the loaded plan (a background refresh moved on).
//   - AMBIGUOUS ......... the source or destination resolves ambiguously (a
//       duplicated/poisoned id) -> fail closed, never guess.
//   - UNAVAILABLE ....... malformed input (UNRESOLVED). Fail closed.
//
// Cross-block Move/Swap inside the SAME loaded plan IS allowed and uses the EXACT
// same command shapes; the command carries NO block ids because Stage 3A resolves
// placement authoritatively from the pair/station ids. Cross-plan / cross-ridingSlot
// movement is not representable here and never produced.
//
// PURITY / DORMANCY: no import of Prisma, actions, React, auth, cookies, env, or any
// server module. It imports the committed pure Move/Swap COMMAND TYPES only
// (`import type`, zero runtime dependency) and the pure pair-placement-index
// resolvers (a sibling dormant module). No runtime code imports this file in this
// stage. Deterministic and non-mutating; every returned decision (and any command it
// carries) is frozen. No command is produced from a malformed, same-station,
// same-pair, stale, ambiguous, or unavailable decision, and no command ever carries
// trainee, horse, note, instructor, arena, display, or block data.

import type { ComplexPlanMoveSwapCommand } from "./move-swap";
import {
  resolvePairPlacement,
  resolveStationPlacement,
  type PairPlacementIndex,
} from "./pair-placement-index";

/** The exact committed MOVE_PAIR command shape (Stage 3A core). */
export type MovePairCommand = Extract<ComplexPlanMoveSwapCommand, { op: "MOVE_PAIR" }>;
/** The exact committed SWAP_PAIRS command shape (Stage 3A core). */
export type SwapPairsCommand = Extract<ComplexPlanMoveSwapCommand, { op: "SWAP_PAIRS" }>;

/** Why a choice could not be honoured (stable, non-PII reason). */
export type PairSelectionUnavailableReason =
  // Malformed / missing decision input. Fail closed rather than guess.
  | "UNRESOLVED";

/**
 * The chosen destination: either a station (a Move target) or another pair (a Swap
 * target). Nothing else is representable.
 */
export type PairSelectionDestination =
  | { readonly kind: "station"; readonly stationId: string }
  | { readonly kind: "pair"; readonly pairId: string };

/** The closed decision union. */
export type PairSelectionDecision =
  | { readonly kind: "MOVE_PAIR_PROPOSAL"; readonly command: MovePairCommand }
  | { readonly kind: "SWAP_PAIRS_PROPOSAL"; readonly command: SwapPairsCommand }
  | { readonly kind: "NO_CHANGE" }
  | { readonly kind: "SAME_STATION" }
  | { readonly kind: "STALE_TARGET" }
  | { readonly kind: "AMBIGUOUS" }
  | { readonly kind: "UNAVAILABLE"; readonly reason: PairSelectionUnavailableReason };

/** The inputs of one whole-pair placement choice. */
export interface PairSelectionQuery {
  /** Plan-wide pair placement index built from the SAME loaded plan snapshot. */
  readonly index: PairPlacementIndex;
  /** The source pair the user is moving. */
  readonly sourcePairId: string;
  /** Where the user dropped it: a station (Move) or another pair (Swap). */
  readonly destination: PairSelectionDestination;
  /** The loaded plan's version, threaded verbatim into any proposed command. */
  readonly expectedVersion: number;
}

// ---------------------------------------------------------------------------
// Frozen singletons / builders.
// ---------------------------------------------------------------------------

const NO_CHANGE: PairSelectionDecision = Object.freeze({ kind: "NO_CHANGE" });
const SAME_STATION: PairSelectionDecision = Object.freeze({ kind: "SAME_STATION" });
const STALE_TARGET: PairSelectionDecision = Object.freeze({ kind: "STALE_TARGET" });
const AMBIGUOUS: PairSelectionDecision = Object.freeze({ kind: "AMBIGUOUS" });
const UNRESOLVED: PairSelectionDecision = Object.freeze({ kind: "UNAVAILABLE", reason: "UNRESOLVED" });

/** A present, non-empty string id (rejects missing/blank/non-string). */
function isPresentId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** A plain (non-array) object narrowed to a string-keyed record, else null. */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** Validate the caller-picked destination into a clean discriminated value, or
 *  null when it is not exactly a { kind:"station" } / { kind:"pair" } with a
 *  present id. */
function readDestination(value: unknown): PairSelectionDestination | null {
  const record = asRecord(value);
  if (record === null) return null;
  if (record.kind === "station" && isPresentId(record.stationId)) {
    return { kind: "station", stationId: record.stationId };
  }
  if (record.kind === "pair" && isPresentId(record.pairId)) {
    return { kind: "pair", pairId: record.pairId };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Decision.
// ---------------------------------------------------------------------------

/**
 * Decide what a single whole-pair placement choice means. Pure, deterministic, and
 * non-mutating: the query and index are only read; the returned decision (and any
 * command it carries) is frozen. Never throws - malformed input fails closed as
 * UNAVAILABLE / UNRESOLVED. The fail-closed order is exactly:
 *   (1) validate input/index/source/destination/version;
 *   (2) resolve the source pair (AMBIGUOUS -> AMBIGUOUS, MISSING -> STALE_TARGET);
 *   (3) STATION destination: ambiguous -> AMBIGUOUS, missing -> STALE_TARGET,
 *       same station -> SAME_STATION, else -> MOVE_PAIR_PROPOSAL;
 *   (4) PAIR destination: same pair -> NO_CHANGE, ambiguous -> AMBIGUOUS, missing
 *       -> STALE_TARGET, same station -> SAME_STATION, else -> SWAP_PAIRS_PROPOSAL.
 */
export function decidePairSelection(query: PairSelectionQuery): PairSelectionDecision {
  // (1) Fail-closed input validation. A malformed shape never guesses a result.
  if (query === null || typeof query !== "object") return UNRESOLVED;
  const { index, sourcePairId, destination, expectedVersion } = query;
  if (
    index === null ||
    typeof index !== "object" ||
    !(index.pairs instanceof Map) ||
    !(index.stations instanceof Map)
  ) {
    return UNRESOLVED;
  }
  if (!isPresentId(sourcePairId)) return UNRESOLVED;
  if (!Number.isInteger(expectedVersion)) return UNRESOLVED;
  const dest = readDestination(destination);
  if (dest === null) return UNRESOLVED;

  // (2) Resolve the source pair. It must be unambiguous and still present.
  const source = resolvePairPlacement(index, sourcePairId);
  if (source.status === "AMBIGUOUS") return AMBIGUOUS;
  if (source.status === "MISSING") return STALE_TARGET;
  const sourceStationId = source.stationId;

  // (3) STATION destination -> a Move.
  if (dest.kind === "station") {
    const target = resolveStationPlacement(index, dest.stationId);
    if (target.status === "AMBIGUOUS") return AMBIGUOUS;
    if (target.status === "MISSING") return STALE_TARGET;
    if (target.stationId === sourceStationId) return SAME_STATION;
    const command: MovePairCommand = Object.freeze({
      op: "MOVE_PAIR",
      expectedVersion,
      sourcePairId,
      destinationStationId: target.stationId,
    });
    return Object.freeze({ kind: "MOVE_PAIR_PROPOSAL", command });
  }

  // (4) PAIR destination -> a Swap.
  // Same pair is a pure string compare (before resolving) -> nothing to do.
  if (dest.pairId === sourcePairId) return NO_CHANGE;
  const target = resolvePairPlacement(index, dest.pairId);
  if (target.status === "AMBIGUOUS") return AMBIGUOUS;
  if (target.status === "MISSING") return STALE_TARGET;
  // Same-station swap is unavailable in Stage 3D: it must never produce a command.
  if (target.stationId === sourceStationId) return SAME_STATION;
  const command: SwapPairsCommand = Object.freeze({
    op: "SWAP_PAIRS",
    expectedVersion,
    aPairId: sourcePairId,
    bPairId: target.pairId,
  });
  return Object.freeze({ kind: "SWAP_PAIRS_PROPOSAL", command });
}
