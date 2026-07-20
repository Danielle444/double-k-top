// RIDING-COMPLEX-SCHEDULE-BOARD (Stage 3C.2 - trainee Move/Swap UI orchestration)
// - pure, DB-free.
//
// The smallest extractable orchestration glue between the schedule-board pair
// editor's two trainee-selection surfaces (the searchable TraineePicker
// dropdowns and the full-list ContextualPairPicker) and the committed Stage 3C.1
// decision core. It exists so the React component never re-implements a business
// rule: it hands raw click inputs here and receives a closed decision / a ready
// proposal input / safe display labels back.
//
// It composes ONLY the already-committed pure cores:
//   - decideTraineeSelection (trainee-selection-decision.ts) - the single deciding
//     function; this module never re-derives free/occupied/move/swap logic;
//   - resolvePairOccupants (placement-index.ts) - to pick a destination seat for
//     the slot-less full-list gesture, and to resolve a swap's occupant name;
//   - buildProposalViewModel's ProposalInput / ProposalDisplayLabels shapes
//     (proposal-view-model.ts, type-only) - so the component builds the exact
//     confirmation view model with no duplicated copy.
//
// PURITY / DORMANCY: no import of Prisma, actions, React, auth, cookies, env, or
// any server module. Imports the committed pure cores' runtime resolvers and
// their types only. Deterministic and non-mutating; every returned object is
// plain data. NO id ever appears in the display labels it produces (only
// caller-supplied, already-visible names / station labels), matching the Stage
// 3C.1 proposal-view-model privacy contract.

import {
  resolvePairOccupants,
  resolveTraineePlacement,
  type PairOccupants,
  type TraineePlacementIndex,
  type TraineeSlot,
} from "./placement-index";
import {
  decideTraineeSelection,
  type TraineeSelectionDecision,
} from "./trainee-selection-decision";
import type { ProposalDisplayLabels, ProposalInput } from "./proposal-view-model";

// ---------------------------------------------------------------------------
// (1) Empty-seat resolution for the SLOT-LESS full-list selector.
// ---------------------------------------------------------------------------

/**
 * Which EMPTY destination seat a full-list "bring this trainee into the pair"
 * gesture should fill when the click resolves to a MOVE:
 *   - both seats empty  -> seat 1 (the unique valid first position);
 *   - otherwise         -> seat 2.
 * It is NEVER used to pick between two OCCUPIED seats: a destination pair whose
 * BOTH seats are held is refused UPSTREAM (EXPLICIT_SLOT_REQUIRED) before this is
 * consulted, so it never silently targets an occupant. A malformed pair (seat 1
 * empty while seat 2 is held) resolves to seat 2 so the decision core fails
 * closed (INVALID_PAIR_POSITION) rather than canonicalizing into the empty seat
 * 1. Pure and deterministic.
 */
export function resolveFullListDestinationSlot(occupants: PairOccupants): TraineeSlot {
  return occupants.trainee1Id === null && occupants.trainee2Id === null ? 1 : 2;
}

// ---------------------------------------------------------------------------
// (2) Full-list click -> decision. Free / own-pair / ambiguous candidates and
// every MOVE into an EMPTY seat delegate to the ONE committed decision core; the
// component maps LOCAL_SELECTION / NO_CHANGE to a checkbox toggle and the MOVE
// proposal to a confirmation, so occupied candidates never enter the checkbox
// selection. The single new orchestration outcome is EXPLICIT_SLOT_REQUIRED:
// clicking an occupied trainee onto a pair whose BOTH seats are held would need a
// swap, and the full-list gesture carries no seat - so no command is produced and
// the user is asked to pick via the explicit חניך 1 / חניך 2 dropdowns.
// ---------------------------------------------------------------------------

export interface FullListClickInput {
  readonly index: TraineePlacementIndex;
  readonly blockId: string;
  readonly candidateTraineeId: string;
  /** The destination pair id, or null in CREATE mode (pair not yet saved). */
  readonly destinationPairId: string | null;
  readonly expectedVersion: number;
}

/**
 * The full-list click decision: the committed Stage 3C.1 decision, plus one
 * orchestration-only refusal, EXPLICIT_SLOT_REQUIRED, raised when an occupied
 * trainee is clicked onto a destination pair whose BOTH seats are held. This adds
 * NO variant to the Stage 3C.1 / Stage 3A types and produces NO command; it is a
 * non-action decision meaning "an explicit destination seat is required".
 */
export type FullListTraineeDecision =
  | TraineeSelectionDecision
  | { readonly kind: "EXPLICIT_SLOT_REQUIRED" };

const EXPLICIT_SLOT_REQUIRED: FullListTraineeDecision = Object.freeze({ kind: "EXPLICIT_SLOT_REQUIRED" });

/**
 * Decide what a full-list trainee-row click means. NEVER chooses a destination
 * seat arbitrarily: a click that would require a swap against a fully occupied
 * pair returns EXPLICIT_SLOT_REQUIRED (no command); every other case resolves the
 * unique valid empty seat (or a fail-closed seat) and defers to the committed
 * decision core. Pure and deterministic.
 */
export function decideFullListTraineeClick(input: FullListClickInput): FullListTraineeDecision {
  // CREATE mode (pair not yet saved): the seat is irrelevant - the decision core
  // short-circuits on a null destination pair (occupied -> CREATE_MODE, free ->
  // LOCAL_SELECTION). Delegate with a placeholder seat.
  if (input.destinationPairId === null) {
    return decideTraineeSelection({
      index: input.index,
      blockId: input.blockId,
      candidateTraineeId: input.candidateTraineeId,
      destinationPairId: null,
      destinationSlot: 1,
      expectedVersion: input.expectedVersion,
    });
  }

  const occupants = resolvePairOccupants(input.index, input.blockId, input.destinationPairId);
  // A vanished / ambiguously-duplicated destination pair: defer to the core,
  // which reports STALE_TARGET. Seat is irrelevant.
  if (occupants === null) {
    return decideTraineeSelection({
      index: input.index,
      blockId: input.blockId,
      candidateTraineeId: input.candidateTraineeId,
      destinationPairId: input.destinationPairId,
      destinationSlot: 1,
      expectedVersion: input.expectedVersion,
    });
  }

  // Only an occupied-ELSEWHERE candidate can become a MOVE/SWAP; a free / own-pair
  // / ambiguous candidate is a checkbox toggle / no-op the seat does not affect.
  // When such a candidate is clicked onto a pair whose BOTH seats are held, a swap
  // would be required - and the full-list gesture cannot say WHICH occupant. Do
  // not guess: refuse and ask for an explicit seat, producing no command.
  const placement = resolveTraineePlacement(input.index, input.blockId, input.candidateTraineeId);
  const occupiedElsewhere =
    placement.status === "OCCUPIED" && placement.at.pairId !== input.destinationPairId;
  const bothSeatsHeld = occupants.trainee1Id !== null && occupants.trainee2Id !== null;
  if (occupiedElsewhere && bothSeatsHeld) {
    return EXPLICIT_SLOT_REQUIRED;
  }

  // Resolve the unique valid EMPTY destination seat (never a choice between two
  // occupied seats - handled above) and delegate to the ONE decision core, which
  // validates, builds any command, and fails closed on a malformed shape.
  const destinationSlot = resolveFullListDestinationSlot(occupants);
  return decideTraineeSelection({
    index: input.index,
    blockId: input.blockId,
    candidateTraineeId: input.candidateTraineeId,
    destinationPairId: input.destinationPairId,
    destinationSlot,
    expectedVersion: input.expectedVersion,
  });
}

// ---------------------------------------------------------------------------
// (3) Decision -> proposal input. Maps a MOVE/SWAP decision to the exact
// ProposalInput buildProposalViewModel consumes, carrying the committed command
// UNCHANGED. Returns null for every non-proposal decision (including
// EXPLICIT_SLOT_REQUIRED) so the caller never fabricates a command of its own.
// ---------------------------------------------------------------------------

export function decisionToProposalInput(decision: FullListTraineeDecision): ProposalInput | null {
  if (decision.kind === "MOVE_PROPOSAL") return { kind: "move", command: decision.command };
  if (decision.kind === "SWAP_PROPOSAL") return { kind: "swap", command: decision.command };
  return null;
}

// ---------------------------------------------------------------------------
// (4) Safe display labels for the confirmation view model. Reads ONLY caller-
// supplied, already-visible names (a trainee-name map) and safe per-pair station
// context strings (a pair-context map) - never an id. A POSITION label identifies
// the PAIR, not the moving trainee: it is "זוג עם {the OTHER occupant of that
// pair}" (resolved from the placement index purely to find that trainee's NAME;
// the id itself is never emitted), or "ללא בן/בת זוג" when the pair has no other
// seat filled. When the two positions would read identically (same partner name /
// both partnerless), available station/time context is appended so they stay
// distinguishable. The swap occupant's name is resolved the same way.
// ---------------------------------------------------------------------------

export interface MoveSwapLabelInputs {
  readonly index: TraineePlacementIndex;
  readonly blockId: string;
  /** The clicked trainee's already-visible display name. */
  readonly candidateTraineeName: string | null;
  /** studentId -> already-visible trainee name (never emitted as an id). */
  readonly traineeNames: ReadonlyMap<string, string>;
  /** pairId -> a safe, id-free station/time context string (coach / arena / time
   *  range), used only to DISAMBIGUATE two otherwise-identical position labels. */
  readonly pairContexts: ReadonlyMap<string, string>;
}

/** The occupant id of the OTHER seat of a pair (the one that is NOT the move/swap
 *  slot) - i.e. the partner who stays in that pair. null when unknown/empty. */
function partnerOccupantId(occupants: PairOccupants | null, slot: "trainee1" | "trainee2"): string | null {
  if (!occupants) return null;
  return slot === "trainee1" ? occupants.trainee2Id : occupants.trainee1Id;
}

/** The occupant id sitting IN the given seat (the swap occupant). */
function seatOccupantId(occupants: PairOccupants | null, slot: "trainee1" | "trainee2"): string | null {
  if (!occupants) return null;
  return slot === "trainee1" ? occupants.trainee1Id : occupants.trainee2Id;
}

/** The base position label for a pair: "זוג עם {partner name}", or "ללא בן/בת זוג"
 *  when the pair has no other occupant. null when the pair itself is unresolvable
 *  (stale/ambiguous) so the view model falls back to its generic pair label. */
function basePositionLabel(
  occupants: PairOccupants | null,
  slot: "trainee1" | "trainee2",
  traineeNames: ReadonlyMap<string, string>
): string | null {
  if (occupants === null) return null;
  const partnerId = partnerOccupantId(occupants, slot);
  const partnerName = partnerId !== null ? (traineeNames.get(partnerId) ?? null) : null;
  return partnerName !== null ? `זוג עם ${partnerName}` : "ללא בן/בת זוג";
}

/**
 * Build the safe Hebrew ProposalDisplayLabels for a prepared trainee Move/Swap
 * proposal. Pure and deterministic. Every value is a caller-supplied name / a
 * derived position label / null (the view model applies the generic fallback) -
 * NO id, version, slot, or other internal reference is ever placed in the result.
 */
export function buildMoveSwapProposalLabels(
  proposal: ProposalInput,
  inputs: MoveSwapLabelInputs
): ProposalDisplayLabels {
  // Resolve the source/destination pair refs uniformly from the command (a MOVE's
  // source/destination, a SWAP's a/b).
  const { source, destination } =
    proposal.kind === "move"
      ? { source: proposal.command.source, destination: proposal.command.destination }
      : { source: proposal.command.a, destination: proposal.command.b };

  const sourceOccupants = resolvePairOccupants(inputs.index, inputs.blockId, source.pairId);
  const destOccupants = resolvePairOccupants(inputs.index, inputs.blockId, destination.pairId);

  let sourcePositionLabel = basePositionLabel(sourceOccupants, source.slot, inputs.traineeNames);
  let destinationPositionLabel = basePositionLabel(destOccupants, destination.slot, inputs.traineeNames);

  // Disambiguate two identical, present base labels (same partner / both
  // partnerless) with whatever safe station/time context is available.
  if (sourcePositionLabel !== null && sourcePositionLabel === destinationPositionLabel) {
    const sourceContext = inputs.pairContexts.get(source.pairId) ?? null;
    const destContext = inputs.pairContexts.get(destination.pairId) ?? null;
    if (sourceContext) sourcePositionLabel = `${sourcePositionLabel}, ${sourceContext}`;
    if (destContext) destinationPositionLabel = `${destinationPositionLabel}, ${destContext}`;
  }

  // The swap occupant (the trainee currently IN the destination seat) - a name
  // only, for the second confirmation card. null / absent for a MOVE.
  let occupantTraineeName: string | null = null;
  if (proposal.kind === "swap") {
    const occupantId = seatOccupantId(destOccupants, destination.slot);
    occupantTraineeName = occupantId !== null ? (inputs.traineeNames.get(occupantId) ?? null) : null;
  }

  return {
    candidateTraineeName: inputs.candidateTraineeName ?? null,
    occupantTraineeName,
    sourcePositionLabel,
    destinationPositionLabel,
  };
}
