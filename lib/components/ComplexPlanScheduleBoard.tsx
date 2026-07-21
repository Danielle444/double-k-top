"use client";

import { useMemo, type ReactNode } from "react";
import { Button } from "@/lib/components/Button";
import {
  projectScheduleBoard,
  type ScheduleBoardPlanInput,
  type ScheduleBoardCandidateInput,
  type ScheduleBoardStationVM,
} from "@/lib/riding-complex-schedule-board/project";
import { showsBoardEditControl } from "@/lib/riding-complex-schedule-board/edit-navigation";

// The board's fixed Hebrew fallbacks for a station's coach header and arena line.
// Shared so the whole-pair Move/Swap confirmation (Stage 3D.2) can reproduce the
// EXACT station identity the board renders, without changing any visible output.
const STATION_NO_INSTRUCTOR_LABEL = "לא הוגדר מאמן";
const STATION_NO_ARENA_LABEL = "לא הוגדר מגרש";

// The station's visible coach-name identity (its card header). A missing coach
// falls back to the same fixed label the header shows.
export function boardStationInstructorLabel(instructorName: string | null): string {
  return instructorName ?? STATION_NO_INSTRUCTOR_LABEL;
}

// A single-line station identity combining the board's already-visible coach
// header and arena line, for the Stage 3D.2 whole-pair Move/Swap confirmation
// copy. Reuses the EXACT fallback labels the board renders and adds NO new
// fallback ordering; it never emits an id or any pair content.
export function formatBoardStationLabel(instructorName: string | null, arena: string | null): string {
  const arenaPart = arena ? `מגרש ${arena}` : STATION_NO_ARENA_LABEL;
  return `${boardStationInstructorLabel(instructorName)} · ${arenaPart}`;
}

// RIDING-COMPLEX-SCHEDULE-BOARD - schedule-style overview of a whole complex
// riding plan. This component renders ONLY; it owns no draft state, holds no
// save logic, and issues no query or server action of its own. It reshapes the
// already-loaded plan tree via the pure projectScheduleBoard core (see that
// file) and lays the result out as time-block sections with coach-station
// lanes, so the entire plan is visible at once.
//
// Stage 2B inline editing (additive, permission-gated): when the parent passes
// canEdit plus the edit callbacks, each block header, station card, and pair
// row gains a labeled edit control. Clicking a control does NOT mutate anything
// here - it calls back so the PARENT (the sole draft + save owner) either opens
// an inline editor whose UI it injects via renderBlockTimeEditor /
// renderStationMetaEditor (placed here, inside the header/card), or opens its
// own pair sub-dialog. While any edit is active the parent sets editLocked,
// which hides every other edit control so only one target is ever open and an
// in-progress draft is never silently discarded. A read-only viewer (canEdit
// false, or no callbacks) sees no edit control at all. The block/station/pair
// source ids used by the callbacks come from the projection's internal
// blockId/stationId/pairId fields and are used ONLY in click handlers - never
// rendered into text, attributes, accessible labels, or React keys.
//
// Layout: time blocks stack vertically in chronological order (the primary
// structure). Within a block, stations flow as responsive cards - a single
// stacked column on mobile (no wide-table overflow), widening to lanes on
// larger screens where space permits. Hebrew RTL and the existing design
// tokens are inherited from the surrounding app; nothing here forces LTR or a
// fixed wide width. Missing optional values fall back to a clear Hebrew label,
// and empty blocks/stations render an explicit "nothing here" line rather than
// collapsing silently.

function StationLane({
  station,
  metaEditing,
  renderMetaEditor,
  onEditMeta,
  onEditPair,
  onAddPair,
  editLocked,
  canEdit,
  pairMoveActive,
  pairMoveSourcePairId,
  isStationMoveTarget,
  onSelectStationMoveTarget,
  onStartPairMove,
  isPairMoveSwapTarget,
  onSelectPairMoveSwapTarget,
}: {
  station: ScheduleBoardStationVM;
  // True when THIS station's metadata (instructor + arena) is being edited
  // inline - the parent-injected editor replaces the static header/arena.
  metaEditing: boolean;
  renderMetaEditor?: () => ReactNode;
  // Provided only when the station's metadata may be edited (editable actor,
  // nothing else open, station has a routable id).
  onEditMeta?: () => void;
  // Provided per pair only when that pair may be edited; called with the pair's
  // source id (never rendered) so the parent opens its pair sub-dialog.
  onEditPair?: (pairId: string) => void;
  // Provided only when a pair may be added to this station; opens the parent's
  // pair dialog in CREATE mode.
  onAddPair?: () => void;
  editLocked: boolean;
  canEdit: boolean;
  // RIDING-COMPLEX-SCHEDULE-BOARD (Stage 3D.2 - whole-pair Move/Swap). All opt-in;
  // when pairMoveActive is false and the callbacks are absent the lane renders
  // exactly as before. A source pair is being moved when pairMoveActive is true.
  pairMoveActive: boolean;
  // The selected source pair id (highlighted here; never rendered as text).
  pairMoveSourcePairId: string | null;
  // Precomputed by the parent (via the Stage 3D.1 decision core): THIS station is
  // a valid whole-pair Move destination for the active source.
  isStationMoveTarget: boolean;
  // Move the active source pair INTO this station (a MOVE_PAIR target).
  onSelectStationMoveTarget?: () => void;
  // Begin a whole-pair Move/Swap from this pair row (edit mode entry).
  onStartPairMove?: (pairId: string) => void;
  // Whether a given pair in THIS station is a valid SWAP target for the source.
  isPairMoveSwapTarget?: (pairId: string) => boolean;
  // Swap the active source pair WITH this pair (a SWAP_PAIRS target).
  onSelectPairMoveSwapTarget?: (pairId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border-2 border-border bg-card p-3">
      {metaEditing ? (
        renderMetaEditor?.()
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-1.5">
            <h4 className="text-base font-bold text-card-foreground">
              {boardStationInstructorLabel(station.instructorName)}
            </h4>
            <div className="flex items-center gap-1.5">
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {station.pairs.length} זוגות
              </span>
              {/* Stage 3D.2 - the station-level whole-pair Move destination. A
                  discrete button (never the whole card); shown for every valid
                  target station INCLUDING an empty one, so no fake pair row is
                  created. */}
              {pairMoveActive && isStationMoveTarget && onSelectStationMoveTarget && (
                <Button
                  className="!px-2 !py-1 !text-xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectStationMoveTarget();
                  }}
                  aria-label={`העברת הזוג הנבחר לתחנה של ${boardStationInstructorLabel(station.instructorName)}`}
                >
                  העברה לכאן
                </Button>
              )}
              {onEditMeta && (
                <Button
                  variant="secondary"
                  className="!px-2 !py-1 !text-xs"
                  onClick={onEditMeta}
                  aria-label={`עריכת מאמן ומגרש של ${station.instructorName ?? "תחנה ללא מאמן"}`}
                >
                  עריכה
                </Button>
              )}
            </div>
          </div>
          <p className="text-sm text-card-foreground">מגרש: {station.arena ?? STATION_NO_ARENA_LABEL}</p>
        </>
      )}
      {station.pairs.length === 0 ? (
        <p className="text-sm text-muted-foreground">אין זוגות בתחנה זו</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {station.pairs.map((pair) => {
            const canEditPair =
              showsBoardEditControl(canEdit, pair.pairId) && !editLocked && Boolean(onEditPair);
            // Stage 3D.2 - the entry into a whole-pair Move/Swap. Edit-tier, and
            // only when no other operation is active. `editLocked` already
            // includes an active pair-move selection, so this button hides while
            // one is in progress (never two sources at once).
            const canStartPairMove =
              showsBoardEditControl(canEdit, pair.pairId) && !editLocked && Boolean(onStartPairMove);
            const isSource =
              pairMoveActive && pair.pairId !== null && pair.pairId === pairMoveSourcePairId;
            // A valid SWAP target: a different pair, in a different station, that the
            // Stage 3D.1 decision core accepts (parent-supplied predicate). The
            // source pair and every pair in the source station render NO target.
            const isSwapTarget =
              pairMoveActive &&
              pair.pairId !== null &&
              pair.pairId !== pairMoveSourcePairId &&
              Boolean(isPairMoveSwapTarget?.(pair.pairId)) &&
              Boolean(onSelectPairMoveSwapTarget);
            const pairName =
              pair.traineeNames.length > 0 ? pair.traineeNames.join(" ו-") : "ללא חניכים";
            return (
              <div
                key={pair.key}
                className={`flex items-start justify-between gap-2 rounded-lg p-2 text-xs ${
                  isSource ? "bg-primary/10 ring-2 ring-primary" : "bg-muted/50"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-card-foreground">
                    {pair.traineeNames.length > 0 ? pair.traineeNames.join(" + ") : "לא נבחרו חניכים"}
                  </p>
                  <p className="text-muted-foreground">סוס: {pair.horseName ?? "לא הוגדר סוס"}</p>
                  {pair.note && <p className="text-muted-foreground">הערה: {pair.note}</p>}
                  {isSource && <p className="font-semibold text-primary">הזוג שנבחר להעברה</p>}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {canEditPair && pair.pairId && (
                    <Button
                      variant="ghost"
                      className="!px-2 !py-1 !text-xs"
                      onClick={() => onEditPair?.(pair.pairId as string)}
                      aria-label={`עריכת זוג: ${pairName}`}
                    >
                      עריכת זוג
                    </Button>
                  )}
                  {canStartPairMove && pair.pairId && (
                    <Button
                      variant="secondary"
                      className="!px-2 !py-1 !text-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        onStartPairMove?.(pair.pairId as string);
                      }}
                      aria-label={`העברת זוג: ${pairName}`}
                    >
                      העברת זוג
                    </Button>
                  )}
                  {isSwapTarget && pair.pairId && (
                    <Button
                      className="!px-2 !py-1 !text-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectPairMoveSwapTarget?.(pair.pairId as string);
                      }}
                      aria-label={`החלפת הזוג הנבחר עם ${pairName}`}
                    >
                      החלפה עם זוג זה
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {onAddPair && (
        <div className="flex justify-end">
          <Button variant="secondary" className="!px-2 !py-1 !text-xs" onClick={onAddPair}>
            + הוספת זוג
          </Button>
        </div>
      )}
    </div>
  );
}

export function ComplexPlanScheduleBoard({
  plan,
  candidates,
  canEdit = false,
  editLocked = false,
  inlineBlockTimeId = null,
  renderBlockTimeEditor,
  inlineStationMetaId = null,
  renderStationMetaEditor,
  onEditBlockTime,
  onEditStationMeta,
  onEditPair,
  onAddPair,
  pairMoveActive = false,
  pairMoveSourcePairId = null,
  isPairMoveStationTarget,
  isPairMoveSwapTarget,
  onStartPairMove,
  onSelectPairMoveStationTarget,
  onSelectPairMoveSwapTarget,
}: {
  plan: ScheduleBoardPlanInput;
  candidates: readonly ScheduleBoardCandidateInput[];
  // Inline editing is fully additive and opt-in: without canEdit + the
  // callbacks the board renders exactly as before (read-only). No control here
  // ever mutates.
  canEdit?: boolean;
  // Any inline editor / pair dialog is open in the parent - hide every other
  // edit control so exactly one target is active at a time.
  editLocked?: boolean;
  // The block whose time range is being edited inline, plus the parent-injected
  // editor UI to place inside that block's header.
  inlineBlockTimeId?: string | null;
  renderBlockTimeEditor?: () => ReactNode;
  // The station whose metadata is being edited inline, plus its editor UI.
  inlineStationMetaId?: string | null;
  renderStationMetaEditor?: () => ReactNode;
  // Edit intents - the parent opens the corresponding inline editor / dialog.
  onEditBlockTime?: (blockId: string) => void;
  onEditStationMeta?: (blockId: string, stationId: string) => void;
  onEditPair?: (blockId: string, stationId: string, pairId: string) => void;
  onAddPair?: (blockId: string, stationId: string) => void;
  // RIDING-COMPLEX-SCHEDULE-BOARD (Stage 3D.2 - whole-pair Move/Swap). Fully
  // additive and opt-in: when pairMoveActive is false and these callbacks are
  // absent the board renders and behaves exactly as before. Structural placement
  // and target VALIDITY are resolved authoritatively by the PARENT through the
  // committed Stage 3D.1 cores; the board only renders the supplied predicates and
  // emits the source pair id / target station or pair id (never a business rule of
  // its own, never a reconstructed placement index).
  pairMoveActive?: boolean;
  pairMoveSourcePairId?: string | null;
  // Parent-supplied validity predicates (keyed by the same source ids the board
  // already routes) - true only for a station/pair the decision core accepts.
  isPairMoveStationTarget?: (stationId: string) => boolean;
  isPairMoveSwapTarget?: (pairId: string) => boolean;
  // Begin a whole-pair Move/Swap from a pair row; choose a Move destination
  // station; choose a Swap partner pair.
  onStartPairMove?: (pairId: string) => void;
  onSelectPairMoveStationTarget?: (stationId: string) => void;
  onSelectPairMoveSwapTarget?: (pairId: string) => void;
}) {
  const board = useMemo(() => projectScheduleBoard(plan, candidates), [plan, candidates]);

  if (board.blocks.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-border p-6 text-center">
        <p className="text-sm text-muted-foreground">עדיין לא הוגדרו טווחי שעות לתכנון זה</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto ps-1">
      {board.blocks.map((block) => {
        const blockTimeEditing = Boolean(inlineBlockTimeId) && block.blockId === inlineBlockTimeId;
        const canEditBlockTime =
          showsBoardEditControl(canEdit, block.blockId) && !editLocked && Boolean(onEditBlockTime);
        return (
          <section key={block.key} className="flex flex-col gap-2">
            <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center gap-2 bg-background px-1 py-1">
              {blockTimeEditing ? (
                renderBlockTimeEditor?.()
              ) : (
                <>
                  <h3 className="text-base font-bold text-card-foreground">
                    {block.startTime}–{block.endTime}
                  </h3>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    {block.stations.length} תחנות
                  </span>
                  {canEditBlockTime && block.blockId && (
                    <Button
                      variant="secondary"
                      className="!px-2 !py-1 !text-xs"
                      onClick={() => onEditBlockTime?.(block.blockId as string)}
                      aria-label={`עריכת שעות של טווח ${block.startTime}–${block.endTime}`}
                    >
                      עריכת שעות
                    </Button>
                  )}
                </>
              )}
            </div>
            {block.stations.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                אין תחנות בטווח זה
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {block.stations.map((station) => {
                  const metaEditing =
                    Boolean(inlineStationMetaId) && station.stationId === inlineStationMetaId;
                  const canEditMeta =
                    showsBoardEditControl(canEdit, station.stationId) &&
                    !editLocked &&
                    Boolean(onEditStationMeta) &&
                    Boolean(block.blockId);
                  const canAddPair =
                    showsBoardEditControl(canEdit, station.stationId) &&
                    !editLocked &&
                    Boolean(onAddPair) &&
                    Boolean(block.blockId);
                  // Stage 3D.2 - THIS station is a valid whole-pair Move
                  // destination when a source is selected and the parent's
                  // decision-core-backed predicate accepts it (empty stations
                  // included; the source station is excluded upstream).
                  const isStationMoveTarget =
                    pairMoveActive &&
                    Boolean(station.stationId) &&
                    Boolean(isPairMoveStationTarget?.(station.stationId as string));
                  return (
                    <StationLane
                      key={station.key}
                      station={station}
                      canEdit={canEdit}
                      editLocked={editLocked}
                      metaEditing={metaEditing}
                      renderMetaEditor={metaEditing ? renderStationMetaEditor : undefined}
                      onEditMeta={
                        canEditMeta
                          ? () => onEditStationMeta?.(block.blockId as string, station.stationId as string)
                          : undefined
                      }
                      onEditPair={
                        block.blockId && station.stationId
                          ? (pairId) => onEditPair?.(block.blockId as string, station.stationId as string, pairId)
                          : undefined
                      }
                      onAddPair={
                        canAddPair
                          ? () => onAddPair?.(block.blockId as string, station.stationId as string)
                          : undefined
                      }
                      pairMoveActive={pairMoveActive}
                      pairMoveSourcePairId={pairMoveSourcePairId}
                      isStationMoveTarget={isStationMoveTarget}
                      onSelectStationMoveTarget={
                        isStationMoveTarget
                          ? () => onSelectPairMoveStationTarget?.(station.stationId as string)
                          : undefined
                      }
                      onStartPairMove={onStartPairMove}
                      isPairMoveSwapTarget={isPairMoveSwapTarget}
                      onSelectPairMoveSwapTarget={onSelectPairMoveSwapTarget}
                    />
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
