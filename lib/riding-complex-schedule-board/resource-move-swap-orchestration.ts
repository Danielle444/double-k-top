// RIDING-COMPLEX-SCHEDULE-BOARD (Stage 3C.3c - resource Move/Swap UI
// orchestration) - pure, DB-free.
//
// The smallest extractable UI decisions that the schedule-board editor needs to
// wire HORSE and INSTRUCTOR Move/Swap (Stage 3C.3a/3C.3b) - and to retrofit the
// same dirty-draft protection onto the committed TRAINEE Move/Swap (Stage 3C.2) -
// WITHOUT the React component re-implementing a business rule. It contains only:
//
//   1. Dirty-draft comparisons. A Move/Swap success reloads the authoritative
//      plan and discards the current inline draft, so it must NEVER silently drop
//      an unrelated unsaved edit. For each resource these helpers answer one
//      question: "does the draft differ from the authoritative loaded row in any
//      field OTHER than the one this Move/Swap intends to change?" If so the
//      caller blocks the proposal and asks the user to save or cancel first.
//
//   2. The explicit horse-commit gate. Horse is free text; an occupancy check
//      must run ONLY on an explicit commit gesture (a quick-horse button, a
//      suggestion click, Enter, or an exact-occupied blur) - never on every
//      keystroke. shouldProcessHorseCommit encodes the one non-obvious rule: a
//      blur commits only when the trimmed value exactly matches a horse already
//      occupying a pair in the block (so arbitrary typing never triggers a
//      proposal, and an Enter immediately followed by a blur cannot double-fire).
//
// It composes the committed pure normalizers ONLY (horseStore / horseKey), and
// re-implements NO placement, decision, or command logic - the committed cores
// (decide{Trainee,Horse,Instructor}Selection, the placement indexes, the Stage 3A
// Move/Swap core) remain the sole owners of that. Every comparison here mirrors
// the SAVE normalization the editor's payload builders use, so a representation-
// only difference the writer would collapse (e.g. a case/whitespace-equivalent
// horse) is never mistaken for a dirty edit.
//
// NORMALIZATION (matches inline-edit.ts payload builders + the Stage 3A contract):
//   - nullable ids / note / arena: blank ("") -> null, otherwise verbatim (the
//     exact `field || null` the pair/station payload builders apply; no trim);
//   - horse: horseStore - trim, whitespace-only -> null, case PRESERVED (the
//     committed horse identity); horseKey for the occupancy uniqueness key.
//
// PURITY: no import of Prisma, actions, React, auth, cookies, env, clock, random,
// or any server module. Imports the committed pure horse normalizers only.
// Deterministic and non-mutating; reads its inputs and returns plain booleans /
// values - it never freezes or mutates a caller's object.

import { horseKey, horseStore } from "./horse-placement-index";

// ---------------------------------------------------------------------------
// Shared normalization (SAVE semantics). Blank -> null, else verbatim. This is
// the exact `value || null` the pair/station payload builders apply to nullable
// ids, notes, and arenas - deliberately NOT trimmed, so it collapses only a truly
// empty field and treats any non-empty value as a real (blockable) difference.
// ---------------------------------------------------------------------------

/** Blank ("") -> null, otherwise the value verbatim. Matches `field || null`. */
export function blankToNull(value: string | null | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

// ---------------------------------------------------------------------------
// (1) Dirty-draft comparisons.
// ---------------------------------------------------------------------------

/** One pair as loaded from the authoritative plan (nullable stored fields). */
export interface DirtyPairLoaded {
  readonly trainee1Id: string | null;
  readonly trainee2Id: string | null;
  readonly horseName: string | null;
  readonly note: string | null;
}

/** One pair's live editable draft (blank string = empty field). */
export interface DirtyPairDraft {
  readonly trainee1Id: string;
  readonly trainee2Id: string;
  readonly horseName: string;
  readonly note: string;
}

/** Which trainee seat a Move/Swap targets (the intended resource for a trainee
 *  proposal); matches the committed command's destination/`b` slot literal. */
export type TraineeTargetSlot = "trainee1" | "trainee2";

/**
 * Would confirming a TRAINEE Move/Swap silently discard an unrelated unsaved
 * edit? The targeted seat is the intended resource and is IGNORED (it may legit-
 * imately differ, and an occupied-select never mutates the draft anyway); the
 * proposal is dirty only when the OTHER trainee seat, the horse, or the note
 * differs from the authoritative loaded pair (each normalized with SAVE
 * semantics - horse trim/blank/case-insensitive, ids/note blank->null). Pure and
 * deterministic; reads both inputs, mutates neither.
 */
export function isTraineeProposalDirty(
  loaded: DirtyPairLoaded,
  draft: DirtyPairDraft,
  targetSlot: TraineeTargetSlot
): boolean {
  const otherSlotDirty =
    targetSlot === "trainee1"
      ? blankToNull(draft.trainee2Id) !== blankToNull(loaded.trainee2Id)
      : blankToNull(draft.trainee1Id) !== blankToNull(loaded.trainee1Id);
  const horseDirty = horseStore(draft.horseName) !== horseStore(loaded.horseName);
  const noteDirty = blankToNull(draft.note) !== blankToNull(loaded.note);
  return otherSlotDirty || horseDirty || noteDirty;
}

/**
 * Would confirming a HORSE Move/Swap silently discard an unrelated unsaved edit?
 * The horse is the intended resource and is IGNORED (it may differ - the user may
 * have typed/selected it before committing); the proposal is dirty only when
 * either trainee seat or the note differs from the authoritative loaded pair.
 * Pure and deterministic.
 */
export function isHorseProposalDirty(loaded: DirtyPairLoaded, draft: DirtyPairDraft): boolean {
  const trainee1Dirty = blankToNull(draft.trainee1Id) !== blankToNull(loaded.trainee1Id);
  const trainee2Dirty = blankToNull(draft.trainee2Id) !== blankToNull(loaded.trainee2Id);
  const noteDirty = blankToNull(draft.note) !== blankToNull(loaded.note);
  return trainee1Dirty || trainee2Dirty || noteDirty;
}

/**
 * Would confirming an INSTRUCTOR Move/Swap silently discard an unrelated unsaved
 * edit? The instructor is the intended resource and is IGNORED (an occupied-select
 * never mutates the draft); the proposal is dirty only when the arena differs from
 * the authoritative loaded station (blank->null, no trim - the station payload
 * builder's `arena || null` semantics). Pure and deterministic.
 */
export function isInstructorProposalDirty(loadedArena: string | null, draftArena: string): boolean {
  return blankToNull(draftArena) !== blankToNull(loadedArena);
}

// ---------------------------------------------------------------------------
// (2) Explicit horse-commit gate.
// ---------------------------------------------------------------------------

/** The four explicit horse-commit gestures. Arbitrary typing (onChange) is NOT a
 *  commit and never reaches this module - it only updates the local draft. */
export type HorseCommitSource = "quick" | "suggestion" | "enter" | "blur";

export interface HorseCommitGesture {
  readonly source: HorseCommitSource;
  /** The horse value at the moment of the gesture (raw; normalized here). */
  readonly value: string;
  /** The uniqueness keys (horseKey) of horses occupying any pair in the block. */
  readonly occupiedHorseKeys: ReadonlySet<string>;
}

/**
 * Should this horse-commit gesture run an occupancy check (i.e. reach the horse
 * decision core), or be ignored as a keystroke-level event? A quick-horse button,
 * a suggestion click, and Enter are ALWAYS explicit commits. A blur is a commit
 * ONLY when the trimmed value exactly matches a horse already occupying a pair in
 * the block - so tabbing/clicking away from arbitrary or free-text typing never
 * opens a proposal, and an Enter that already produced a proposal is not re-fired
 * by the blur that follows it (that value's key is still occupied, but the caller
 * additionally refuses a second commit while a proposal is open). Pure and
 * deterministic; the value is normalized with the committed horseKey (trim +
 * lower) so a blank or case/whitespace variant is judged identically to a save.
 */
export function shouldProcessHorseCommit(gesture: HorseCommitGesture): boolean {
  if (gesture.source !== "blur") return true;
  const key = horseKey(gesture.value);
  return key !== null && gesture.occupiedHorseKeys.has(key);
}
