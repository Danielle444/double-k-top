// RIDING-COMPLEX-SCHEDULE-BOARD (Stage 3C.1 - proposal view model) - pure,
// DB-free.
//
// Two small pure mappers for the future Move/Swap confirmation UI (Stage 3C.2):
//
//   1. buildProposalViewModel - turns a prepared MOVE/SWAP proposal plus the
//      CALLER-SUPPLIED, already-visible display labels (trainee names, station
//      labels) into safe Hebrew confirmation copy: a title, "before"/"after"
//      descriptions, and confirm/cancel labels. It invents no data and reads no
//      names off the command.
//
//   2. decideProposalActionResult - turns the server action's result into a
//      closed UI directive: on success reload the authoritative plan, close the
//      pair dialog, and return to the board; on a stale outcome reload but never
//      auto-retry; on any other failure keep the proposal open (or report a safe
//      failure) and never auto-replay the command.
//
// PRIVACY (enforced by tests): NO blockId, stationId, pairId, traineeId,
// ridingSlotId, or plan id ever appears in a rendered string. Internal command
// references survive ONLY in the separate, non-display `command` field so Stage
// 3C.2 can still execute the confirmed proposal. No notes, feedback, audit, or
// publication data is touched.
//
// PURITY / DORMANCY: imports the committed pure command TYPES only (`import
// type`, zero runtime dependency); no Prisma/actions/React/auth/cookies/env/
// server import; no runtime code imports this file in this stage. Deterministic,
// non-mutating, and returns frozen results.

import type { ComplexPlanMoveSwapCommand } from "./move-swap";

type MoveTraineeCommand = Extract<ComplexPlanMoveSwapCommand, { op: "MOVE_TRAINEE" }>;
type SwapTraineesCommand = Extract<ComplexPlanMoveSwapCommand, { op: "SWAP_TRAINEES" }>;

// ---------------------------------------------------------------------------
// (1) Proposal display copy.
// ---------------------------------------------------------------------------

/** A prepared trainee Move/Swap proposal (the kind + the exact committed command
 *  produced by the decision core). `command` is the ONLY carrier of internal ids
 *  and is never reflected into display copy. */
export type ProposalInput =
  | { readonly kind: "move"; readonly command: MoveTraineeCommand }
  | { readonly kind: "swap"; readonly command: SwapTraineesCommand };

/**
 * Safe, already-visible display labels supplied by the caller. Every field is
 * optional/nullable; a missing (or whitespace-only) value falls back to a
 * generic Hebrew label. These are the ONLY sources of names in the output.
 */
export interface ProposalDisplayLabels {
  /** The trainee being moved/swapped. */
  readonly candidateTraineeName?: string | null;
  /** The trainee currently in the destination seat (swap only). */
  readonly occupantTraineeName?: string | null;
  /** A label for where the candidate currently sits. */
  readonly sourceStationLabel?: string | null;
  /** A label for where the candidate is moving to. */
  readonly destinationStationLabel?: string | null;
}

/** The safe confirmation view model. `command` is a NON-DISPLAY field. */
export interface ProposalViewModel {
  readonly kind: "move" | "swap";
  readonly title: string;
  readonly before: string;
  readonly after: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  /** Non-display: retained solely so Stage 3C.2 can execute the confirmed
   *  proposal. May contain internal ids; never rendered. */
  readonly command: MoveTraineeCommand | SwapTraineesCommand;
}

const TRAINEE_FALLBACK = "חניכ/ה";
const OCCUPANT_FALLBACK = "חניכ/ה אחר/ת";
const SOURCE_STATION_FALLBACK = "העמדה הנוכחית";
const DEST_STATION_FALLBACK = "העמדה הנבחרת";
const CANCEL_LABEL = "ביטול";

/** A caller label if it is a non-blank string, else the generic fallback. */
function safeLabel(value: string | null | undefined, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value : fallback;
}

/**
 * Build safe Hebrew confirmation copy for a Move/Swap proposal. Pure and
 * deterministic; returns a frozen view model. Only the supplied display labels
 * (or their generic fallbacks) appear in the copy - never any id from `command`.
 */
export function buildProposalViewModel(
  proposal: ProposalInput,
  labels: ProposalDisplayLabels
): ProposalViewModel {
  const candidate = safeLabel(labels.candidateTraineeName, TRAINEE_FALLBACK);
  const source = safeLabel(labels.sourceStationLabel, SOURCE_STATION_FALLBACK);
  const destination = safeLabel(labels.destinationStationLabel, DEST_STATION_FALLBACK);

  if (proposal.kind === "move") {
    return Object.freeze({
      kind: "move",
      title: "העברת חניכ/ה",
      before: `כעת: ${candidate} — ${source}`,
      after: `לאחר האישור: ${candidate} — ${destination}`,
      confirmLabel: "אישור העברה",
      cancelLabel: CANCEL_LABEL,
      command: proposal.command,
    });
  }

  const occupant = safeLabel(labels.occupantTraineeName, OCCUPANT_FALLBACK);
  return Object.freeze({
    kind: "swap",
    title: "החלפת חניכים",
    before: `כעת: ${candidate} — ${source} | ${occupant} — ${destination}`,
    after: `לאחר האישור: ${candidate} — ${destination} | ${occupant} — ${source}`,
    confirmLabel: "אישור החלפה",
    cancelLabel: CANCEL_LABEL,
    command: proposal.command,
  });
}

// ---------------------------------------------------------------------------
// (2) Action-result -> UI directive.
// ---------------------------------------------------------------------------

/** The narrow slice of the server action's result this mapper reads. Typed with
 *  a plain string reason so this module never imports the server action. */
export interface ProposalActionResultInput {
  readonly success: boolean;
  readonly reason?: string | null;
}

export type ProposalActionOutcome = "APPLIED" | "STALE_RELOAD" | "FAILED";

/** What the UI should do next. `retry` is ALWAYS false: a Move/Swap command is
 *  never auto-replayed (a re-attempt is a fresh, explicit user action). */
export interface ProposalActionDirective {
  readonly outcome: ProposalActionOutcome;
  readonly reloadPlan: boolean;
  readonly closeDialog: boolean;
  readonly returnToBoard: boolean;
  readonly keepProposalOpen: boolean;
  readonly retry: false;
}

// Outcomes meaning "the plan you acted on no longer matches" - reload the
// authoritative plan instead of retrying. STALE_PLAN / STALE_REFERENCE come from
// the pure core; PLAN_NOT_FOUND is the action-layer equivalent (the plan row
// vanished). A reload here also discards the now-stale proposal.
const STALE_RELOAD_REASONS: ReadonlySet<string> = new Set([
  "STALE_PLAN",
  "STALE_REFERENCE",
  "PLAN_NOT_FOUND",
]);

const APPLIED: ProposalActionDirective = Object.freeze({
  outcome: "APPLIED",
  reloadPlan: true,
  closeDialog: true,
  returnToBoard: true,
  keepProposalOpen: false,
  retry: false,
});

const STALE_RELOAD: ProposalActionDirective = Object.freeze({
  outcome: "STALE_RELOAD",
  reloadPlan: true,
  closeDialog: true,
  returnToBoard: true,
  keepProposalOpen: false,
  retry: false,
});

const FAILED: ProposalActionDirective = Object.freeze({
  outcome: "FAILED",
  reloadPlan: false,
  closeDialog: false,
  returnToBoard: false,
  keepProposalOpen: true,
  retry: false,
});

/**
 * Map a Move/Swap action result to the UI directive. Pure, deterministic, and
 * fail-closed: only a strict `success === true` is treated as applied; a
 * recognised stale reason reloads (never retries); everything else keeps the
 * proposal open. Never auto-replays the command. Returns a frozen directive.
 */
export function decideProposalActionResult(result: ProposalActionResultInput): ProposalActionDirective {
  if (result !== null && typeof result === "object" && result.success === true) {
    return APPLIED;
  }
  const reason = result !== null && typeof result === "object" && typeof result.reason === "string" ? result.reason : null;
  if (reason !== null && STALE_RELOAD_REASONS.has(reason)) {
    return STALE_RELOAD;
  }
  return FAILED;
}
