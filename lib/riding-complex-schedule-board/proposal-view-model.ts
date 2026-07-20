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
 *
 * A POSITION label identifies a PAIR/seat, not the trainee - e.g. "זוג עם {other
 * trainee}" (optionally with coach/arena/time context). It must never be merely a
 * repeat of the moving trainee's own name; the caller (the orchestration) builds
 * it from the pair's OTHER occupant + safe station context.
 */
export interface ProposalDisplayLabels {
  /** The trainee being moved/swapped. */
  readonly candidateTraineeName?: string | null;
  /** The trainee currently in the destination seat (swap only). */
  readonly occupantTraineeName?: string | null;
  /** A POSITION label for the pair the candidate currently sits in. */
  readonly sourcePositionLabel?: string | null;
  /** A POSITION label for the pair the candidate is moving/swapping into. */
  readonly destinationPositionLabel?: string | null;
}

/** One placement line: a heading (a trainee name, or "השיבוץ של {name}") and the
 *  position detail (a pair/position label). Never carries an id. */
export interface ProposalPlacementRow {
  readonly heading: string;
  readonly detail: string;
}

/** The structured, immediately-understandable confirmation body for a trainee
 *  Move/Swap: a labeled "before" block, a labeled "after" block, and the mandatory
 *  domain note that horses/notes stay with their pairs. Rendered as headings +
 *  cards - NEVER as a dense "name — label | name — label" sentence. */
export interface ProposalSections {
  readonly beforeHeading: string;
  readonly afterHeading: string;
  readonly beforeRows: readonly ProposalPlacementRow[];
  readonly afterRows: readonly ProposalPlacementRow[];
  /** Mandatory: a trainee-only Move/Swap changes seats only. */
  readonly stableNote: string;
}

/** The safe confirmation view model. `command` is a NON-DISPLAY field. `sections`
 *  is the structured presentation the renderer prefers; `before`/`after` are kept
 *  as a flat, pipe-free fallback/accessibility summary. */
export interface ProposalViewModel {
  readonly kind: "move" | "swap";
  readonly title: string;
  readonly before: string;
  readonly after: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  readonly sections: ProposalSections;
  /** Non-display: retained solely so Stage 3C.2 can execute the confirmed
   *  proposal. May contain internal ids; never rendered. */
  readonly command: MoveTraineeCommand | SwapTraineesCommand;
}

const TRAINEE_FALLBACK = "חניכ/ה";
const OCCUPANT_FALLBACK = "חניכ/ה אחר/ת";
const SOURCE_POSITION_FALLBACK = "הזוג הנוכחי";
const DEST_POSITION_FALLBACK = "הזוג הנבחר";
const CANCEL_LABEL = "ביטול";
// Essential domain copy: the trainee Move/Swap command changes trainee SEATS only.
const STABLE_NOTE = "הסוסים וההערות נשארים עם הזוגים ואינם עוברים עם החניכים.";

/** A caller label if it is a non-blank string, else the generic fallback. */
function safeLabel(value: string | null | undefined, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value : fallback;
}

function row(heading: string, detail: string): ProposalPlacementRow {
  return Object.freeze({ heading, detail });
}

/**
 * Build safe Hebrew confirmation copy for a trainee Move/Swap proposal. Pure and
 * deterministic; returns a deeply-frozen view model. Only the supplied display
 * labels (or their generic fallbacks) appear in the copy - never any id, version,
 * op, or slot token from `command`. The structured `sections` are the primary
 * presentation (headings + one card per trainee); `before`/`after` remain as a
 * flat, PIPE-FREE fallback line. Both MOVE and SWAP always carry the mandatory
 * "horses and notes stay with their pairs" note.
 */
export function buildProposalViewModel(
  proposal: ProposalInput,
  labels: ProposalDisplayLabels
): ProposalViewModel {
  const candidate = safeLabel(labels.candidateTraineeName, TRAINEE_FALLBACK);
  const sourcePosition = safeLabel(labels.sourcePositionLabel, SOURCE_POSITION_FALLBACK);
  const destinationPosition = safeLabel(labels.destinationPositionLabel, DEST_POSITION_FALLBACK);

  if (proposal.kind === "move") {
    return Object.freeze({
      kind: "move",
      title: "העברת חניך/ה",
      before: `${candidate}: ${sourcePosition}`,
      after: `השיבוץ של ${candidate}: ${destinationPosition}`,
      confirmLabel: "אישור העברה",
      cancelLabel: CANCEL_LABEL,
      sections: Object.freeze({
        beforeHeading: "לפני ההעברה",
        afterHeading: "אחרי ההעברה",
        beforeRows: Object.freeze([row(candidate, sourcePosition)]),
        afterRows: Object.freeze([row(`השיבוץ של ${candidate}`, destinationPosition)]),
        stableNote: STABLE_NOTE,
      }),
      command: proposal.command,
    });
  }

  const occupant = safeLabel(labels.occupantTraineeName, OCCUPANT_FALLBACK);
  return Object.freeze({
    kind: "swap",
    title: "החלפת חניכים",
    before: `${candidate}: ${sourcePosition}; ${occupant}: ${destinationPosition}`,
    after: `השיבוץ של ${candidate}: ${destinationPosition}; השיבוץ של ${occupant}: ${sourcePosition}`,
    confirmLabel: "אישור החלפה",
    cancelLabel: CANCEL_LABEL,
    sections: Object.freeze({
      beforeHeading: "לפני ההחלפה",
      afterHeading: "אחרי ההחלפה",
      // Before: each trainee at their CURRENT pair. After: they exchange - the
      // candidate takes the destination position, the occupant takes the source.
      beforeRows: Object.freeze([row(candidate, sourcePosition), row(occupant, destinationPosition)]),
      afterRows: Object.freeze([
        row(`השיבוץ של ${candidate}`, destinationPosition),
        row(`השיבוץ של ${occupant}`, sourcePosition),
      ]),
      stableNote: STABLE_NOTE,
    }),
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
