"use client";

import { useEffect, useMemo, useRef } from "react";
import { Button } from "@/lib/components/Button";
import {
  projectScheduleBoard,
  type ScheduleBoardPlanInput,
  type ScheduleBoardCandidateInput,
  type ScheduleBoardStationVM,
} from "@/lib/riding-complex-schedule-board/project";
import { showsBoardEditControl } from "@/lib/riding-complex-schedule-board/edit-navigation";

// RIDING-COMPLEX-SCHEDULE-BOARD - schedule-style overview of a whole complex
// riding plan. This component renders ONLY; it owns no draft state, holds no
// save logic, and issues no query or server action of its own. It reshapes the
// already-loaded plan tree via the pure projectScheduleBoard core (see that
// file) and lays the result out as time-block sections with coach-station
// lanes, so the entire plan is visible at once.
//
// Edit access (additive, permission-gated): when the parent passes canEdit
// plus onEditBlock/onEditStation, each block/station card gains a labeled edit
// control. Clicking it does NOT mutate anything here - it calls back with the
// card's source block/station id so the parent opens its EXISTING, trusted
// block/station editor (one draft authority, one write path). A read-only
// viewer (canEdit false, or no callbacks) sees no edit control. The source ids
// used by those callbacks come from the projection's internal blockId/stationId
// fields and are used ONLY in the click handlers/focus ref - never rendered
// into text, attributes, accessible labels, or React keys.
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
  onEdit,
  focusRef,
}: {
  station: ScheduleBoardStationVM;
  // Provided only when the station may be edited; undefined for a read-only
  // viewer or a station without a routable id (see showsBoardEditControl).
  onEdit?: () => void;
  focusRef?: (el: HTMLDivElement | null) => void;
}) {
  return (
    <div ref={focusRef} className="flex flex-col gap-2 rounded-xl border-2 border-border bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <h4 className="text-base font-bold text-card-foreground">
          {station.instructorName ?? "לא הוגדר מאמן"}
        </h4>
        <div className="flex items-center gap-1.5">
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {station.pairs.length} זוגות
          </span>
          {onEdit && (
            <Button
              variant="secondary"
              className="!px-2 !py-1 !text-xs"
              onClick={onEdit}
              aria-label={`עריכת תחנה של ${station.instructorName ?? "מאמן שלא הוגדר"}`}
            >
              עריכה
            </Button>
          )}
        </div>
      </div>
      <p className="text-sm text-card-foreground">מגרש: {station.arena ?? "לא הוגדר מגרש"}</p>
      {station.pairs.length === 0 ? (
        <p className="text-sm text-muted-foreground">אין זוגות בתחנה זו</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {station.pairs.map((pair) => (
            <div key={pair.key} className="rounded-lg bg-muted/50 p-2 text-xs">
              <p className="font-medium text-card-foreground">
                {pair.traineeNames.length > 0 ? pair.traineeNames.join(" + ") : "לא נבחרו חניכים"}
              </p>
              <p className="text-muted-foreground">סוס: {pair.horseName ?? "לא הוגדר סוס"}</p>
              {pair.note && <p className="text-muted-foreground">הערה: {pair.note}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ComplexPlanScheduleBoard({
  plan,
  candidates,
  canEdit = false,
  onEditBlock,
  onEditStation,
  focusBlockId = null,
  focusStationId = null,
}: {
  plan: ScheduleBoardPlanInput;
  candidates: readonly ScheduleBoardCandidateInput[];
  // Edit access is fully additive and opt-in: without canEdit + the callbacks
  // the board renders exactly as before (read-only). No control here ever
  // mutates - the callbacks hand the source id to the parent's existing editor.
  canEdit?: boolean;
  onEditBlock?: (blockId: string) => void;
  onEditStation?: (blockId: string, stationId: string) => void;
  // After returning from an editor the parent asks the board to bring the
  // just-edited card back into view. Matched against the internal
  // blockId/stationId (never rendered); a station focus wins over a block one.
  focusBlockId?: string | null;
  focusStationId?: string | null;
}) {
  const board = useMemo(() => projectScheduleBoard(plan, candidates), [plan, candidates]);

  const focusRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!focusBlockId && !focusStationId) return;
    focusRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [focusBlockId, focusStationId]);

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
        const canEditBlock = showsBoardEditControl(canEdit, block.blockId) && Boolean(onEditBlock);
        // A block-level focus only applies when there is no more specific
        // station focus (a station edit brings its own card, and its block,
        // into view). blockId is compared internally and never rendered.
        const isFocusedBlock =
          !focusStationId && Boolean(focusBlockId) && block.blockId === focusBlockId;
        return (
          <section key={block.key} className="flex flex-col gap-2">
            <div
              ref={isFocusedBlock ? focusRef : undefined}
              className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center gap-2 bg-background px-1 py-1"
            >
              <h3 className="text-base font-bold text-card-foreground">
                {block.startTime}–{block.endTime}
              </h3>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {block.stations.length} תחנות
              </span>
              {canEditBlock && block.blockId && (
                <Button
                  variant="secondary"
                  className="!px-2 !py-1 !text-xs"
                  onClick={() => onEditBlock?.(block.blockId as string)}
                  aria-label={`עריכת שעות של טווח ${block.startTime}–${block.endTime}`}
                >
                  עריכת שעות
                </Button>
              )}
            </div>
            {block.stations.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                אין תחנות בטווח זה
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {block.stations.map((station) => {
                  const canEditStation =
                    showsBoardEditControl(canEdit, station.stationId) &&
                    Boolean(onEditStation) &&
                    Boolean(block.blockId);
                  const isFocusedStation =
                    Boolean(focusStationId) && station.stationId === focusStationId;
                  return (
                    <StationLane
                      key={station.key}
                      station={station}
                      onEdit={
                        canEditStation
                          ? () => onEditStation?.(block.blockId as string, station.stationId as string)
                          : undefined
                      }
                      focusRef={
                        isFocusedStation
                          ? (el) => {
                              focusRef.current = el;
                            }
                          : undefined
                      }
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
