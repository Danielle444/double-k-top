"use client";

/**
 * FEEDING-BOARD Stage 5A - the shared per-horse feeding-round status control.
 *
 * PRESENTATIONAL ONLY. It calls no Server Action, performs no IO, holds no
 * state, and knows nothing about permissions: the board owns the write, and the
 * Stage 4 Server Actions remain the real authorization boundary. `disabled` here
 * is a UI affordance, never a security decision.
 *
 * NO DERIVATION IS DUPLICATED. `statusControlMode` and `displayProgressState`
 * arrive already computed by the pure Stage 2 core (lib/feeding/feeding-board-core)
 * through the Stage 4 overview DTO; this component only decides which OPTIONS to
 * offer for a mode it is told, and which one to mark as selected. It never
 * inspects meal content, never re-derives a mode, and never normalises a stale
 * stored state.
 *
 * EXPLICIT TARGET STATES, NEVER A TOGGLE. Every option names the state it will
 * write. There is no "advance"/"next" affordance, so a double tap, a retry and
 * two tablets pressing the same option all converge on the same value instead of
 * racing a counter forward.
 *
 * NEVER COLOUR ALONE. Each option carries a text label AND a glyph, both taken
 * from the same vocabulary the pure core publishes. Colour (repository tokens
 * only - no hard-coded hex) is reinforcement; selection is additionally conveyed
 * by aria-checked, a bold label and a filled background, all of which survive
 * grayscale and colour-blindness.
 */
import type {
  FeedingProgressState,
  FeedingStatusControlMode,
} from "@/lib/feeding/feeding-board-core";

/** One selectable option: the state to write, its label and its glyph. */
export interface FeedingStatusControlOption {
  readonly state: FeedingProgressState;
  readonly label: string;
  readonly glyph: string;
}

// Labels/glyphs mirror the vocabulary of the pure core. COMPLETE deliberately
// reads differently per mode: a horse with concentrate says what was actually
// given, a hay-only horse just says it is done.
const PENDING_OPTION: FeedingStatusControlOption = {
  state: "PENDING",
  label: "לא סומן",
  glyph: "○",
};
const HAY_DONE_OPTION: FeedingStatusControlOption = {
  state: "HAY_DONE",
  label: "חציר הושלם",
  glyph: "◐",
};
const COMPLETE_WITH_CONCENTRATE_OPTION: FeedingStatusControlOption = {
  state: "COMPLETE",
  label: "חציר + מזון מרוכז",
  glyph: "✓",
};
const COMPLETE_ONLY_OPTION: FeedingStatusControlOption = {
  state: "COMPLETE",
  label: "הושלם",
  glyph: "✓",
};

const HAY_AND_CONCENTRATE_OPTIONS: readonly FeedingStatusControlOption[] = Object.freeze([
  PENDING_OPTION,
  HAY_DONE_OPTION,
  COMPLETE_WITH_CONCENTRATE_OPTION,
]);

// completeOnly NEVER offers HAY_DONE: a horse with no concentrate content has no
// meaningful half-step, and offering one would let a tap claim a stage that does
// not exist for that horse.
const COMPLETE_ONLY_OPTIONS: readonly FeedingStatusControlOption[] = Object.freeze([
  PENDING_OPTION,
  COMPLETE_ONLY_OPTION,
]);

/**
 * The options for a mode. PURE and exported so the option sets can be asserted
 * directly rather than only through rendered markup.
 */
export function resolveFeedingStatusControlOptions(
  mode: FeedingStatusControlMode,
): readonly FeedingStatusControlOption[] {
  return mode === "hayAndConcentrate" ? HAY_AND_CONCENTRATE_OPTIONS : COMPLETE_ONLY_OPTIONS;
}

/**
 * Whether a tap may become a write. PURE, and the single guard the click handler
 * uses, so the rule is unit-testable without a DOM:
 *
 *  - `disabled` (a read-only viewer) never writes;
 *  - `isSaving` never writes, so a second tap during an in-flight write for this
 *    horse cannot queue a duplicate action;
 *  - re-selecting the state already shown is a no-op rather than a redundant
 *    write that would re-stamp the audit trail with a new actor and time.
 */
export function canSubmitFeedingStatusChange(input: {
  readonly disabled: boolean;
  readonly isSaving: boolean;
  readonly currentState: FeedingProgressState;
  readonly nextState: FeedingProgressState;
}): boolean {
  if (input.disabled || input.isSaving) return false;
  return input.nextState !== input.currentState;
}

/**
 * Whether an ASYNCHRONOUS mark result may still be applied to the board. PURE,
 * and exported so the rule is unit-testable without a DOM or a clock.
 *
 * THE RACE IT CLOSES: a per-horse mark can still be in flight when "clear all"
 * succeeds and resets every row. Without this check the late result - success OR
 * rollback - would patch that horse back to a PRE-CLEAR state, displaying a horse
 * as fed on a board that was just reset. That is precisely the false-completion
 * this feature exists to prevent.
 *
 * The board bumps a generation counter on every successful clear, and each mark
 * records the generation it started in. EXACT EQUALITY, deliberately: any
 * inequality - and any non-comparable value such as NaN - discards the result,
 * which fails safe (the board keeps the authoritative post-clear PENDING it
 * already displays) rather than resurrecting a stale mark.
 *
 * This never cancels the Server Action itself; the write has already happened or
 * already failed. Only its now-outdated LOCAL effect is ignored.
 */
export function shouldApplyFeedingMarkResult(input: {
  readonly startedGeneration: number;
  readonly currentGeneration: number;
}): boolean {
  return input.startedGeneration === input.currentGeneration;
}

// Repository colour tokens only. The selected option is ALSO bold and filled, so
// none of this is load-bearing for a grayscale or colour-blind reader.
const SELECTED_CLASS: Readonly<Record<FeedingProgressState, string>> = {
  PENDING: "border-muted-foreground bg-muted text-muted-foreground",
  HAY_DONE: "border-warning bg-warning-muted text-warning",
  COMPLETE: "border-success bg-success-muted text-success",
};

const UNSELECTED_CLASS = "border-border bg-card text-muted-foreground";

export interface HorseFeedingStatusControlProps {
  horseName: string;
  statusControlMode: FeedingStatusControlMode;
  /** The option to show as selected - already normalised by the Stage 2 core. */
  displayProgressState: FeedingProgressState;
  /** Read-only affordance (no edit permission). NOT the authorization boundary. */
  disabled: boolean;
  /** A write for THIS horse is in flight. */
  isSaving: boolean;
  onChange: (targetState: FeedingProgressState) => void;
}

export function HorseFeedingStatusControl({
  horseName,
  statusControlMode,
  displayProgressState,
  disabled,
  isSaving,
  onChange,
}: HorseFeedingStatusControlProps) {
  const options = resolveFeedingStatusControlOptions(statusControlMode);
  // While saving, every option is inert - not just the one that was tapped - so
  // a horse can never have two competing writes in flight.
  const isInert = disabled || isSaving;

  return (
    <div className="flex flex-col gap-1">
      {/* The saving indicator is a SIBLING of the group, not a child: a
          radiogroup's children should be radios and nothing else. */}
      <div
        role="radiogroup"
        aria-label={`סטטוס האכלה - ${horseName}`}
        className="flex flex-wrap items-center gap-2"
      >
        {options.map((option) => {
          const isSelected = option.state === displayProgressState;
          return (
            <button
              key={option.state}
              type="button"
              role="radio"
              aria-checked={isSelected}
              aria-label={`${option.label} - ${horseName}`}
              disabled={isInert}
              onClick={() => {
                if (
                  !canSubmitFeedingStatusChange({
                    disabled,
                    isSaving,
                    currentState: displayProgressState,
                    nextState: option.state,
                  })
                ) {
                  return;
                }
                onChange(option.state);
              }}
              className={`flex min-h-11 items-center gap-1.5 rounded-lg border-2 px-3 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                isSelected
                  ? `font-bold ${SELECTED_CLASS[option.state]}`
                  : `font-medium ${UNSELECTED_CLASS}`
              }`}
            >
              <span aria-hidden="true">{option.glyph}</span>
              <span>{option.label}</span>
            </button>
          );
        })}
      </div>
      {isSaving && (
        <span className="text-xs text-muted-foreground" role="status">
          שומר...
        </span>
      )}
    </div>
  );
}
