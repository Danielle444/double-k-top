// RIDING-COMPLEX-SCHEDULE-BOARD (Stage 3D.2 - whole-pair Move/Swap UI
// orchestration) - pure, DB-free.
//
// The smallest extractable glue between the schedule-board's new whole-pair
// Move/Swap selection surface (a source pair row + a destination station-or-pair
// target on the board) and the committed Stage 3D.1 cores. It exists so the
// 4,000+ line editor component never re-derives a routing or label rule: the
// editor hands a prepared MOVE_PAIR/SWAP_PAIRS decision here and receives back a
// ready proposal input and the exact, id-free display labels the confirmation
// view model consumes.
//
// It composes ONLY the already-committed pure cores:
//   - resolvePairPlacement / resolveStationPlacement (pair-placement-index.ts) -
//     to resolve the source pair and the destination station/pair to their
//     confident { blockId, stationId, pairId } path, and to derive block identity
//     for the time-change cue. It NEVER re-implements placement validity or the
//     duplicate/fail-closed policy - a non-FOUND placement fails closed to null.
//   - the committed pair COMMAND types + the PairProposalInput / PairProposalDisplayLabels
//     shapes (pair-selection-decision.ts / pair-proposal-view-model.ts, type-only)
//     - so the editor builds the exact confirmation view model with no duplicated
//     copy and no hand-built command.
//
// It NEVER: constructs a MOVE_PAIR / SWAP_PAIRS command (it only READS the one the
// decision core already produced), builds a second plan index, mutates its input,
// copies pair note contents into a label, or emits a raw id as a display string.
// Every display label it returns is one the caller already showed on the board
// (a pair's visible trainee names, a station's visible header, a block's visible
// time range, a pair's visible horse) - looked up by the FOUND structural id, so
// the confirmation copy stays id-free exactly like the Stage 3C orchestration.
//
// TIME-CHANGE cue: computed STRUCTURALLY as `sourceBlockId !== destinationBlockId`
// (never by comparing rendered time-label strings), so a cross-block operation
// shows the warning even when two blocks happen to display an identical time range.
//
// PURITY / DORMANCY: no import of Prisma, actions, React, auth, cookies, env, or
// any server module. Deterministic and non-mutating; returns plain data.

import {
  resolvePairPlacement,
  resolveStationPlacement,
  type PairPlacementIndex,
} from "./pair-placement-index";
import {
  type MovePairCommand,
  type PairSelectionDecision,
  type SwapPairsCommand,
} from "./pair-selection-decision";
import type {
  PairProposalDisplayLabels,
  PairProposalInput,
} from "./pair-proposal-view-model";

// ---------------------------------------------------------------------------
// (1) Decision -> proposal input. Maps a prepared MOVE_PAIR / SWAP_PAIRS decision
// to the exact PairProposalInput buildPairProposalViewModel consumes, carrying the
// committed command UNCHANGED. Returns null for every non-proposal decision
// (NO_CHANGE / SAME_STATION / STALE_TARGET / AMBIGUOUS / UNAVAILABLE) so the caller
// never fabricates a command of its own.
// ---------------------------------------------------------------------------

// The wrapped { kind, command } members of PairProposalInput (this helper never
// returns the bare-command form), so callers keep the discriminant + command.
type WrappedPairProposalInput = Extract<PairProposalInput, { kind: "pair-move" | "pair-swap" }>;

export function pairDecisionToProposalInput(decision: PairSelectionDecision): WrappedPairProposalInput | null {
  if (decision.kind === "MOVE_PAIR_PROPOSAL") return { kind: "pair-move", command: decision.command };
  if (decision.kind === "SWAP_PAIRS_PROPOSAL") return { kind: "pair-swap", command: decision.command };
  return null;
}

// ---------------------------------------------------------------------------
// (2) Safe display labels for the confirmation view model. Reads ONLY caller-
// supplied, already-visible display maps (keyed by the SAME structural ids the
// Stage 3D.1 index resolves) - never a raw id, and never any pair note content.
// Every value is a name / station header / time range / horse the board already
// shows, or null (the view model then applies its own generic Hebrew fallback).
// ---------------------------------------------------------------------------

export interface PairMoveSwapLabelInputs {
  /** Plan-wide pair placement index built from the SAME loaded plan snapshot. */
  readonly index: PairPlacementIndex;
  /** pairId -> the pair's already-visible trainee-name label (never an id). */
  readonly pairLabels: ReadonlyMap<string, string>;
  /** stationId -> the station's already-visible board label (coach + arena). */
  readonly stationLabels: ReadonlyMap<string, string>;
  /** blockId -> the block's already-visible time-range label. */
  readonly blockTimeLabels: ReadonlyMap<string, string>;
  /** pairId -> the pair's already-visible horse name (present only when set). */
  readonly pairHorseLabels: ReadonlyMap<string, string>;
}

/**
 * Build the safe, id-free PairProposalDisplayLabels for a prepared whole-pair
 * MOVE_PAIR / SWAP_PAIRS command. Pure, deterministic, and non-mutating. Resolves
 * the source (and, for a swap, the destination) pair and - for a move - the
 * destination station through the committed Stage 3D.1 resolvers, then looks up
 * the already-visible labels by the FOUND structural ids. Fails CLOSED to null
 * when any endpoint no longer resolves to a confident single location (MISSING /
 * AMBIGUOUS) - the caller then refuses to open a confirmation rather than showing
 * guessed placement context. The `timeChanged` flag is STRUCTURAL: true exactly
 * when the source and destination blocks differ, never a time-string comparison.
 */
export function buildPairMoveSwapProposalLabels(
  command: MovePairCommand | SwapPairsCommand,
  inputs: PairMoveSwapLabelInputs
): PairProposalDisplayLabels | null {
  const { index, pairLabels, stationLabels, blockTimeLabels, pairHorseLabels } = inputs;

  if (command.op === "MOVE_PAIR") {
    const source = resolvePairPlacement(index, command.sourcePairId);
    if (source.status !== "FOUND") return null;
    const destination = resolveStationPlacement(index, command.destinationStationId);
    if (destination.status !== "FOUND") return null;
    return {
      sourcePairLabel: pairLabels.get(source.pairId) ?? null,
      sourceStationLabel: stationLabels.get(source.stationId) ?? null,
      sourceTimeLabel: blockTimeLabels.get(source.blockId) ?? null,
      sourceHorseLabel: pairHorseLabels.get(source.pairId) ?? null,
      destinationStationLabel: stationLabels.get(destination.stationId) ?? null,
      destinationTimeLabel: blockTimeLabels.get(destination.blockId) ?? null,
      // Structural block identity - NOT a rendered time-string comparison.
      timeChanged: source.blockId !== destination.blockId,
    };
  }

  // SWAP_PAIRS: both endpoints are pairs (in DIFFERENT stations, per the core).
  const source = resolvePairPlacement(index, command.aPairId);
  if (source.status !== "FOUND") return null;
  const destination = resolvePairPlacement(index, command.bPairId);
  if (destination.status !== "FOUND") return null;
  return {
    sourcePairLabel: pairLabels.get(source.pairId) ?? null,
    sourceStationLabel: stationLabels.get(source.stationId) ?? null,
    sourceTimeLabel: blockTimeLabels.get(source.blockId) ?? null,
    sourceHorseLabel: pairHorseLabels.get(source.pairId) ?? null,
    destinationPairLabel: pairLabels.get(destination.pairId) ?? null,
    destinationStationLabel: stationLabels.get(destination.stationId) ?? null,
    destinationTimeLabel: blockTimeLabels.get(destination.blockId) ?? null,
    destinationHorseLabel: pairHorseLabels.get(destination.pairId) ?? null,
    // Structural block identity - NOT a rendered time-string comparison.
    timeChanged: source.blockId !== destination.blockId,
  };
}
