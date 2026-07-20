// RIDING-COMPLEX-SCHEDULE-BOARD (Stage 3C.1 - trainee-selection decision) -
// pure, DB-free.
//
// The single deciding function behind clicking a trainee in the schedule-board
// pair selector. Given the block-scoped placement index (placement-index.ts), a
// candidate trainee, a destination pair+slot, and the loaded plan version, it
// returns a CLOSED decision telling the future UI (Stage 3C.2) exactly what to
// do - WITHOUT the UI re-implementing any business rule:
//
//   - LOCAL_SELECTION . the candidate is free here -> a normal check-box toggle.
//   - MOVE_PROPOSAL ... the candidate sits elsewhere in this block and the target
//       seat is empty -> an atomic MOVE_TRAINEE command (the exact committed
//       Stage 3A shape) is prepared for one-tap confirmation.
//   - SWAP_PROPOSAL ... the candidate sits elsewhere and the target seat is held
//       -> an atomic SWAP_TRAINEES command is prepared.
//   - NO_CHANGE ....... choosing the seat's current trainee, or a trainee already
//       inside the destination pair -> nothing to do (never a self-swap).
//   - AMBIGUOUS ....... the candidate appears twice in this block -> fail closed.
//   - UNAVAILABLE ..... the click cannot be honoured (CREATE_MODE - occupied
//       trainee while the pair is not yet saved; INVALID_PAIR_POSITION - seat 2
//       while seat 1 is empty; UNRESOLVED - malformed input).
//   - STALE_TARGET .... the destination pair vanished from the loaded plan.
//
// FULL-SELECTOR POLICY this enables (Stage 3C.2, no new logic there):
//   - free row click  -> LOCAL_SELECTION -> normal check-box add to selectedIds;
//   - occupied row click -> exactly one MOVE/SWAP proposal;
//   - an occupied row NEVER enters selectedIds (it never yields LOCAL_SELECTION);
//   - free and occupied selections are never combined into one atomic command
//     (an occupied click short-circuits to a single proposal instead).
//
// PURITY / DORMANCY: no import of Prisma, actions, React, auth, cookies, env, or
// any server module. It imports the committed pure Move/Swap COMMAND TYPES only
// (`import type`, zero runtime dependency) and the pure placement-index resolvers
// (a sibling dormant module). No runtime code imports this file in this stage.
// Deterministic and non-mutating; every returned decision (and any command it
// carries) is frozen.

import type { ComplexPlanMoveSwapCommand } from "./move-swap";
import {
  resolvePairOccupants,
  resolveTraineePlacement,
  type TraineePlacementIndex,
  type TraineeSlot,
} from "./placement-index";

/** The exact committed MOVE_TRAINEE command shape (Stage 3A core). */
export type MoveTraineeCommand = Extract<ComplexPlanMoveSwapCommand, { op: "MOVE_TRAINEE" }>;
/** The exact committed SWAP_TRAINEES command shape (Stage 3A core). */
export type SwapTraineesCommand = Extract<ComplexPlanMoveSwapCommand, { op: "SWAP_TRAINEES" }>;

/** Why a click could not be honoured (stable, non-PII reason). */
export type TraineeSelectionUnavailableReason =
  // The destination pair is not yet saved (pairId === null): an occupied trainee
  // has no persisted destination to move into. Do NOT auto-save then propose.
  | "CREATE_MODE"
  // Filling seat 2 while seat 1 is empty. Never silently promoted/canonicalized.
  | "INVALID_PAIR_POSITION"
  // Malformed / missing decision input. Fail closed rather than guess.
  | "UNRESOLVED";

/** The closed decision union. */
export type TraineeSelectionDecision =
  | { readonly kind: "LOCAL_SELECTION"; readonly traineeId: string }
  | { readonly kind: "MOVE_PROPOSAL"; readonly command: MoveTraineeCommand }
  | { readonly kind: "SWAP_PROPOSAL"; readonly command: SwapTraineesCommand }
  | { readonly kind: "NO_CHANGE" }
  | { readonly kind: "AMBIGUOUS" }
  | { readonly kind: "UNAVAILABLE"; readonly reason: TraineeSelectionUnavailableReason }
  | { readonly kind: "STALE_TARGET" };

/** The inputs of one selector click. */
export interface TraineeSelectionQuery {
  /** Block-scoped placement index built from the SAME loaded plan snapshot. */
  readonly index: TraineePlacementIndex;
  /** The block the destination pair lives in. */
  readonly blockId: string;
  /** The trainee whose row was clicked. */
  readonly candidateTraineeId: string;
  /** The destination pair id, or null in CREATE mode (pair not yet saved). */
  readonly destinationPairId: string | null;
  /** Which seat of the destination pair the click targets. */
  readonly destinationSlot: TraineeSlot;
  /** The loaded plan's version, threaded verbatim into any proposed command. */
  readonly expectedVersion: number;
}

// ---------------------------------------------------------------------------
// Frozen singletons / builders.
// ---------------------------------------------------------------------------

const NO_CHANGE: TraineeSelectionDecision = Object.freeze({ kind: "NO_CHANGE" });
const AMBIGUOUS: TraineeSelectionDecision = Object.freeze({ kind: "AMBIGUOUS" });
const STALE_TARGET: TraineeSelectionDecision = Object.freeze({ kind: "STALE_TARGET" });

function unavailable(reason: TraineeSelectionUnavailableReason): TraineeSelectionDecision {
  return Object.freeze({ kind: "UNAVAILABLE", reason });
}

function localSelection(traineeId: string): TraineeSelectionDecision {
  return Object.freeze({ kind: "LOCAL_SELECTION", traineeId });
}

function slotName(slot: TraineeSlot): "trainee1" | "trainee2" {
  return slot === 1 ? "trainee1" : "trainee2";
}

function isPresent(value: string | null): value is string {
  return typeof value === "string" && value.length > 0;
}

// ---------------------------------------------------------------------------
// Decision.
// ---------------------------------------------------------------------------

/**
 * Decide what a single trainee-row click means. Pure, deterministic, and
 * non-mutating: the query and index are only read; the returned decision (and
 * any command it carries) is frozen. Never throws - malformed input fails closed
 * as UNAVAILABLE / UNRESOLVED. No command is produced on any failure, no-op, or
 * local-selection result.
 */
export function decideTraineeSelection(query: TraineeSelectionQuery): TraineeSelectionDecision {
  // (0) Fail-closed input validation. A malformed shape never guesses a result.
  if (query === null || typeof query !== "object") return unavailable("UNRESOLVED");
  const { index, blockId, candidateTraineeId, destinationPairId, destinationSlot, expectedVersion } = query;
  if (index === null || typeof index !== "object" || !(index.blocks instanceof Map)) {
    return unavailable("UNRESOLVED");
  }
  if (!isPresent(blockId)) return unavailable("UNRESOLVED");
  if (!isPresent(candidateTraineeId)) return unavailable("UNRESOLVED");
  if (destinationSlot !== 1 && destinationSlot !== 2) return unavailable("UNRESOLVED");
  if (!Number.isInteger(expectedVersion)) return unavailable("UNRESOLVED");
  if (destinationPairId !== null && !isPresent(destinationPairId)) return unavailable("UNRESOLVED");

  // (1) Where does the candidate currently sit IN THIS BLOCK?
  const placement = resolveTraineePlacement(index, blockId, candidateTraineeId);
  if (placement.status === "AMBIGUOUS") return AMBIGUOUS;

  // (2) CREATE mode: no persisted destination pair. A free candidate may still be
  // a local check-box selection; an occupied one is UNAVAILABLE (never auto-save
  // then propose).
  if (destinationPairId === null) {
    return placement.status === "OCCUPIED" ? unavailable("CREATE_MODE") : localSelection(candidateTraineeId);
  }

  // (3) Existing destination pair - it must still be resolvable in the loaded
  // plan, else the target vanished under a background refresh.
  const dest = resolvePairOccupants(index, blockId, destinationPairId);
  if (dest === null) return STALE_TARGET;

  const destSlotOccupant = destinationSlot === 1 ? dest.trainee1Id : dest.trainee2Id;

  // (4) NO_CHANGE: the candidate already holds the target seat, or already sits
  // somewhere inside this very pair (a within-pair move is useless). Checked
  // before the position guard so re-picking an already-placed trainee is a clean
  // no-op rather than an error - and a self-swap is never produced.
  if (isPresent(destSlotOccupant) && destSlotOccupant === candidateTraineeId) return NO_CHANGE;
  if (placement.status === "OCCUPIED" && placement.at.pairId === destinationPairId) return NO_CHANGE;

  // (5) INVALID_PAIR_POSITION: seat 2 while seat 1 is empty is never allowed
  // (matches the committed core; not silently promoted to seat 1).
  if (destinationSlot === 2 && !isPresent(dest.trainee1Id)) return unavailable("INVALID_PAIR_POSITION");

  // (6) Free candidate -> a normal local check-box selection.
  if (placement.status === "FREE") return localSelection(candidateTraineeId);

  // (7) Occupied elsewhere in this block -> an explicit atomic proposal carrying
  // the exact committed Stage 3A command (no extra fields, exact expectedVersion).
  const source = { pairId: placement.at.pairId, slot: slotName(placement.at.slot) } as const;
  const destination = { pairId: destinationPairId, slot: slotName(destinationSlot) } as const;

  if (!isPresent(destSlotOccupant)) {
    const command: MoveTraineeCommand = Object.freeze({
      op: "MOVE_TRAINEE",
      expectedVersion,
      source: Object.freeze({ ...source }),
      destination: Object.freeze({ ...destination }),
    });
    return Object.freeze({ kind: "MOVE_PROPOSAL", command });
  }

  const command: SwapTraineesCommand = Object.freeze({
    op: "SWAP_TRAINEES",
    expectedVersion,
    a: Object.freeze({ ...source }),
    b: Object.freeze({ ...destination }),
  });
  return Object.freeze({ kind: "SWAP_PROPOSAL", command });
}
