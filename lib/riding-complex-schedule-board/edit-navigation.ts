// RIDING-COMPLEX-SCHEDULE-BOARD (edit access) - pure, DB-free navigation
// decisions for editing a complex riding plan FROM the schedule board.
//
// This module adds NO database query, NO server action, NO React, and NO
// draft/save logic. It only answers three small, deterministic questions the
// board-editing flow needs:
//   1. Should a block/station card show an edit control? (permission + a
//      stable identity to route to).
//   2. Does the block/station the board wants to edit still exist in the
//      current plan? (guards a stale reference after a background refresh).
//   3. After Save or Cancel of a board-opened editor, where does the editor
//      return, and which board card regains focus?
//
// The editor component remains the sole owner of every draft, every server
// action, and all view state - this file never mutates anything; it returns a
// plain decision the component applies. Inputs are duck-typed structural
// shapes (never imported from the "use server" actions module) so this file
// and its tests stay fully decoupled from server code.

// Where the block/station editor was opened from. "list" is the existing
// step-by-step hierarchy (unchanged behavior); "board" is the schedule board.
export type EditOrigin = "list" | "board";

// A minimal block shape for the stale-reference guard - only the identity
// fields are needed, structurally satisfied by RidingSlotComplexBlockRow.
export interface EditNavBlockShape {
  id: string;
  stations: readonly { id: string }[];
}

// The board-return decision. "board" carries which card to bring back into
// view (a station edit focuses the station; a block edit focuses the block).
// "list" means: not board-origin, so the component keeps its existing,
// unchanged list-view return behavior - this module deliberately does NOT
// re-implement that trusted logic.
export type ScheduleEditReturn =
  | { kind: "board"; focusBlockId: string | null; focusStationId: string | null }
  | { kind: "list" };

// A board edit control is shown only for an editable actor AND only when the
// target actually has a stable id to route to. A read-only viewer (canEdit
// false) never sees an edit control; a card without an identifiable source id
// never renders one (it could not be opened safely).
export function showsBoardEditControl(canEdit: boolean, targetId: string | null | undefined): boolean {
  return canEdit && Boolean(targetId);
}

// True only if the block (and, when a stationId is given, that station within
// it) still exists in the current plan. Used before opening a board-originated
// editor so a card that vanished from a concurrent change/refresh is handled
// safely (the caller declines to open a stale editor) rather than opening an
// editor onto a missing target.
export function boardEditTargetExists(
  blocks: readonly EditNavBlockShape[],
  blockId: string,
  stationId: string | null
): boolean {
  const block = blocks.find((b) => b.id === blockId);
  if (!block) return false;
  if (stationId === null) return true;
  return block.stations.some((s) => s.id === stationId);
}

// Resolve where a board/list editor returns after Save or Cancel. Only the
// board branch is decided here (return to the board, focused on the just-
// edited card); the list branch is passed straight through as { kind: "list" }
// so the component applies its existing, unchanged step-by-step return logic.
// A station edit focuses the station (its block scrolls into view with it); a
// block-only edit (stationId null) focuses the block.
export function resolveScheduleEditReturn(
  origin: EditOrigin,
  target: { blockId: string | null; stationId: string | null }
): ScheduleEditReturn {
  if (origin !== "board") return { kind: "list" };
  return {
    kind: "board",
    focusBlockId: target.blockId,
    focusStationId: target.stationId,
  };
}
