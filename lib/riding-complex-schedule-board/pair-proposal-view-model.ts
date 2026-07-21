// RIDING-COMPLEX-SCHEDULE-BOARD (Stage 3D.1 - pair proposal view model) - pure,
// DB-free.
//
// A small, STRICT, pure builder for the future whole-pair Move/Swap confirmation
// UI. It turns a prepared MOVE_PAIR / SWAP_PAIRS proposal (a decision from the
// pair-selection core, or the exact committed pair command) plus CALLER-SUPPLIED,
// already-visible display labels (pair labels, station labels, time-range labels,
// optional horse labels) into safe structured Hebrew confirmation copy: a title,
// a "before" section, an "after" section, stable reassurance notes, and - when the
// pair crosses to a different time range - a prominent time-change notice.
//
// It invents no data and reads NO ids/names off the command. The internal command
// survives ONLY in a separate, non-display `command` field so the future caller can
// still execute the confirmed proposal. The command is NEVER stringified or
// interpolated, and no raw blockId/stationId/pairId/traineeId/version/op ever enters
// any display string.
//
// STRICT INPUT CONTRACT / FAILURE CHANNEL: the builder returns
// `PairProposalViewModel | null`. It renders copy ONLY for a structurally valid pair
// proposal - a bare `MOVE_PAIR`/`SWAP_PAIRS` command, or a wrapped
// `{kind:"pair-move", command.op:"MOVE_PAIR"}` / `{kind:"pair-swap",
// command.op:"SWAP_PAIRS"}` whose kind and op AGREE. Every other runtime value
// (unknown op; a trainee/horse/instructor command; an unknown wrapped kind; a
// kind/op mismatch; null/undefined/array/primitive/shapeless object; a missing/
// non-integer expectedVersion; a missing/blank required id) yields `null` - NEVER
// misleading copy, and NEVER a silent Move->Swap reinterpretation. It does not throw
// for malformed runtime input. This is the minimum structural validation needed to
// render the correct proposal safely; it does NOT re-run Stage 3A business validation
// (block scope, occupancy, duplicates) - the pure core already owns that.
//
// PRIVACY (enforced by tests): NO blockId, stationId, pairId, traineeId, plan id,
// version, or op - and no internal command field - ever appears in a rendered string.
// Caller labels are treated purely as display labels; generic Hebrew fallbacks are
// used when a label is absent/blank. No note content is displayed, and no instructor
// or arena is invented. A horse line appears ONLY when a horse label is supplied.
//
// PURITY / DORMANCY: imports the committed pure command TYPES only (`import type`,
// zero runtime dependency); no Prisma/actions/React/auth/cookies/env/server import;
// no runtime code imports this file in this stage. Deterministic, non-mutating, and
// returns deeply frozen results.

import type { ComplexPlanMoveSwapCommand } from "./move-swap";

type MovePairCommand = Extract<ComplexPlanMoveSwapCommand, { op: "MOVE_PAIR" }>;
type SwapPairsCommand = Extract<ComplexPlanMoveSwapCommand, { op: "SWAP_PAIRS" }>;

// ---------------------------------------------------------------------------
// Input: a prepared pair proposal (wrapped decision) OR the bare committed command.
// `command` is the ONLY carrier of internal ids and is never reflected into copy.
// ---------------------------------------------------------------------------

/** A prepared pair Move/Swap proposal, either wrapped or as the bare command. */
export type PairProposalInput =
  | { readonly kind: "pair-move"; readonly command: MovePairCommand }
  | { readonly kind: "pair-swap"; readonly command: SwapPairsCommand }
  | MovePairCommand
  | SwapPairsCommand;

/**
 * Safe, already-visible display labels supplied by the caller. Every label field is
 * optional/nullable; a missing (or whitespace-only) value falls back to a generic
 * Hebrew label - EXCEPT the horse labels, which have NO fallback (a missing horse
 * label simply omits the horse line; a horse is never invented). `timeChanged` is a
 * pure display flag: true when the pair crosses into a different time range.
 */
export interface PairProposalDisplayLabels {
  /** The pair being moved/selected (Pair A). */
  readonly sourcePairLabel?: string | null;
  /** The pair being swapped with (Pair B) - swap only. */
  readonly destinationPairLabel?: string | null;
  /** The source pair's current time-range label. */
  readonly sourceTimeLabel?: string | null;
  /** The destination time-range label. */
  readonly destinationTimeLabel?: string | null;
  /** The source station's label. */
  readonly sourceStationLabel?: string | null;
  /** The destination station's label. */
  readonly destinationStationLabel?: string | null;
  /** The source pair's horse (optional; omitted from copy when absent). */
  readonly sourceHorseLabel?: string | null;
  /** The destination pair's horse (optional; swap only; omitted when absent). */
  readonly destinationHorseLabel?: string | null;
  /** True when the pair moves to a different time range (drives the notice). */
  readonly timeChanged: boolean;
}

// ---------------------------------------------------------------------------
// Output: strict structured sections. Every string is display-only.
// ---------------------------------------------------------------------------

/** One pair, described purely by display labels at one context. `horseLabel` is
 *  null (line omitted) when no horse label was supplied - never invented. */
export interface PairProposalRow {
  readonly pairLabel: string;
  readonly stationLabel: string;
  readonly timeLabel: string;
  readonly horseLabel: string | null;
}

/** A "before" or "after" section: a heading plus one row per described pair. */
export interface PairProposalSection {
  readonly heading: string;
  readonly rows: readonly PairProposalRow[];
}

/** The safe structured confirmation view model. `command` is a NON-DISPLAY field. */
export interface PairProposalViewModel {
  readonly kind: "pair-move" | "pair-swap";
  readonly title: string;
  readonly before: PairProposalSection;
  readonly after: PairProposalSection;
  /** Stable reassurance notes (whole-pair travels; coach/arena stay). */
  readonly notes: readonly string[];
  /** A prominent time-change notice when the pair crosses time ranges, else null. */
  readonly timeChangeNotice: string | null;
  /** Non-display: retained solely so the future caller can execute the confirmed
   *  proposal. May contain internal ids; never rendered. */
  readonly command: MovePairCommand | SwapPairsCommand;
}

// ---------------------------------------------------------------------------
// Fixed Hebrew copy + generic fallbacks.
// ---------------------------------------------------------------------------

const SOURCE_PAIR_FALLBACK = "הזוג הנבחר";
const DEST_PAIR_FALLBACK = "הזוג השני";
const SOURCE_STATION_FALLBACK = "התחנה הנוכחית";
const DEST_STATION_FALLBACK = "התחנה הנבחרת";
const SOURCE_TIME_FALLBACK = "טווח הזמן הנוכחי";
const DEST_TIME_FALLBACK = "טווח הזמן הנבחר";

const MOVE_TITLE = "העברת זוג";
const MOVE_BEFORE_HEADING = "לפני ההעברה";
const MOVE_AFTER_HEADING = "אחרי ההעברה";
const MOVE_NOTES: readonly string[] = Object.freeze([
  "החניכים, הסוס וההערה יעברו יחד.",
  "המאמן/ת והמגרש נשארים בתחנות.",
]);
const MOVE_TIME_NOTICE = "שימו לב: הזוג עובר לטווח זמן אחר.";

const SWAP_TITLE = "החלפת זוגות";
const SWAP_BEFORE_HEADING = "לפני ההחלפה";
const SWAP_AFTER_HEADING = "אחרי ההחלפה";
const SWAP_NOTES: readonly string[] = Object.freeze([
  "הזוגות עוברים בשלמותם — החניכים, הסוס וההערה.",
  "המאמנים והמגרשים נשארים בתחנות.",
]);
const SWAP_TIME_NOTICE = "שימו לב: הזוגות מחליפים גם את טווחי הזמן.";

/** A caller label if it is a non-blank string, else the generic fallback. */
function safeLabel(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value : fallback;
}

/** An optional caller label: the non-blank string, else null (line omitted). No
 *  fallback - a horse is never invented. */
function optionalLabel(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

// ---------------------------------------------------------------------------
// Strict structural normalization of the wrapped-or-bare proposal.
// ---------------------------------------------------------------------------

type NormalizedProposal =
  | { readonly kind: "pair-move"; readonly command: MovePairCommand }
  | { readonly kind: "pair-swap"; readonly command: SwapPairsCommand };

/** A plain (non-array) object narrowed to a string-keyed record, else null. */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** A present, non-empty string id (rejects missing/blank/non-string). */
function isPresentId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Exactly a structurally valid MOVE_PAIR command (op + integer version + present
 *  source pair id + present destination station id). */
function isMovePairCommand(record: Record<string, unknown>): record is MovePairCommand {
  return (
    record.op === "MOVE_PAIR" &&
    Number.isInteger(record.expectedVersion) &&
    isPresentId(record.sourcePairId) &&
    isPresentId(record.destinationStationId)
  );
}

/** Exactly a structurally valid SWAP_PAIRS command. */
function isSwapPairsCommand(record: Record<string, unknown>): record is SwapPairsCommand {
  return (
    record.op === "SWAP_PAIRS" &&
    Number.isInteger(record.expectedVersion) &&
    isPresentId(record.aPairId) &&
    isPresentId(record.bPairId)
  );
}

/**
 * Strictly normalize the wrapped-or-bare input into a discriminated { kind, command
 * }, or null when it is not exactly one of the four accepted pair shapes.
 * Fail-closed and non-throwing: an unknown op, a wrong-resource command
 * (trainee/horse/instructor), an unknown wrapped kind, a kind/op mismatch, or any
 * malformed shape returns null - never a guessed Move/Swap. Only READS the input
 * (the returned command is the caller's own object reference, unfrozen and
 * unmutated).
 */
function normalize(input: unknown): NormalizedProposal | null {
  const record = asRecord(input);
  if (record === null) return null;

  // Bare command form: carries its own `op`. A trainee/horse/instructor/unknown op
  // simply fails both guards below and returns null.
  if ("op" in record) {
    if (isMovePairCommand(record)) return { kind: "pair-move", command: record };
    if (isSwapPairsCommand(record)) return { kind: "pair-swap", command: record };
    return null;
  }

  // Wrapped form: { kind, command }. The kind and the command's op must AGREE.
  const command = asRecord(record.command);
  if (command === null) return null;
  if (record.kind === "pair-move" && isMovePairCommand(command)) {
    return { kind: "pair-move", command };
  }
  if (record.kind === "pair-swap" && isSwapPairsCommand(command)) {
    return { kind: "pair-swap", command };
  }
  return null;
}

/** Freeze one row (and return it typed). */
function freezeRow(row: PairProposalRow): PairProposalRow {
  return Object.freeze(row);
}

/** Freeze a section (heading + its rows array). */
function freezeSection(heading: string, rows: readonly PairProposalRow[]): PairProposalSection {
  return Object.freeze({ heading, rows: Object.freeze(rows.map(freezeRow)) });
}

// ---------------------------------------------------------------------------
// Build.
// ---------------------------------------------------------------------------

/**
 * Build safe structured Hebrew confirmation copy for a pair Move/Swap proposal.
 * Pure, deterministic, and non-throwing. Returns a deeply frozen view model for a
 * structurally valid pair proposal, or `null` for any invalid/mismatched input (see
 * the strict input contract in the module header) - the explicit failure channel a
 * caller uses to refuse rendering misleading copy. Only the supplied display labels
 * (or their generic fallbacks) appear in the copy - never any id from `command`,
 * which is neither stringified nor interpolated. The mandatory whole-pair and
 * stationary coach/arena notes are always included; a prominent time-change notice
 * is included only when `labels.timeChanged === true`, else `timeChangeNotice` is
 * null.
 */
export function buildPairProposalViewModel(
  proposal: PairProposalInput,
  labels: PairProposalDisplayLabels
): PairProposalViewModel | null {
  const normalized = normalize(proposal);
  if (normalized === null) return null;
  const { kind, command } = normalized;

  const labelRecord = asRecord(labels) ?? {};
  const timeChanged = labelRecord.timeChanged === true;

  const sourcePair = safeLabel(labelRecord.sourcePairLabel, SOURCE_PAIR_FALLBACK);
  const sourceStation = safeLabel(labelRecord.sourceStationLabel, SOURCE_STATION_FALLBACK);
  const destinationStation = safeLabel(labelRecord.destinationStationLabel, DEST_STATION_FALLBACK);
  const sourceTime = safeLabel(labelRecord.sourceTimeLabel, SOURCE_TIME_FALLBACK);
  const destinationTime = safeLabel(labelRecord.destinationTimeLabel, DEST_TIME_FALLBACK);
  const sourceHorse = optionalLabel(labelRecord.sourceHorseLabel);

  if (kind === "pair-move") {
    // The single moving pair, shown at its source context then its destination
    // context. Only the station + time change; pair/horse labels stay the same.
    const before = freezeSection(MOVE_BEFORE_HEADING, [
      { pairLabel: sourcePair, stationLabel: sourceStation, timeLabel: sourceTime, horseLabel: sourceHorse },
    ]);
    const after = freezeSection(MOVE_AFTER_HEADING, [
      { pairLabel: sourcePair, stationLabel: destinationStation, timeLabel: destinationTime, horseLabel: sourceHorse },
    ]);
    return Object.freeze({
      kind: "pair-move",
      title: MOVE_TITLE,
      before,
      after,
      notes: MOVE_NOTES,
      timeChangeNotice: timeChanged ? MOVE_TIME_NOTICE : null,
      command,
    });
  }

  // Swap: Pair A (source) and Pair B (destination) exchange whole. Before shows each
  // at its own context; after shows each at the OTHER's context.
  const destinationPair = safeLabel(labelRecord.destinationPairLabel, DEST_PAIR_FALLBACK);
  const destinationHorse = optionalLabel(labelRecord.destinationHorseLabel);

  const before = freezeSection(SWAP_BEFORE_HEADING, [
    { pairLabel: sourcePair, stationLabel: sourceStation, timeLabel: sourceTime, horseLabel: sourceHorse },
    { pairLabel: destinationPair, stationLabel: destinationStation, timeLabel: destinationTime, horseLabel: destinationHorse },
  ]);
  const after = freezeSection(SWAP_AFTER_HEADING, [
    { pairLabel: sourcePair, stationLabel: destinationStation, timeLabel: destinationTime, horseLabel: sourceHorse },
    { pairLabel: destinationPair, stationLabel: sourceStation, timeLabel: sourceTime, horseLabel: destinationHorse },
  ]);
  return Object.freeze({
    kind: "pair-swap",
    title: SWAP_TITLE,
    before,
    after,
    notes: SWAP_NOTES,
    timeChangeNotice: timeChanged ? SWAP_TIME_NOTICE : null,
    command,
  });
}
