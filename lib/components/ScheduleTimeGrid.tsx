"use client";

import { useMemo, type ReactNode } from "react";
import { buildTimeGridLayout, formatTimeGridGapDurationLabel } from "@/lib/schedule-timegrid";
import type { GroupableScheduleItem } from "@/lib/schedule-grouping";

// Layout-only: renders a day's schedule items as a real timetable - fixed
// time-slot rows and group א / group ב columns, with "שתי הקבוצות" items
// spanning both group columns. No CSS grid auto/minmax rows, no grid gap
// between rows or columns (adjacent cells are separated only by their own
// card borders plus a small inset padding on each card - never by moving
// the underlying time-proportional grid lines), and no floating/absolute
// positioning that could let one item cover another. Content is entirely up
// to the caller via renderCard, so each role (student/instructor/admin)
// keeps full control of title shortening, instructor-name visibility,
// "active now" styling, etc.
//
// IUS-2F - OPTIONAL long-gap compression. compactLongGaps is undefined by
// default, and while it is undefined this component behaves exactly as before:
// no caller is required to pass it, and every caller (per-course instructor,
// trainee, admin) deliberately does not.
//
// IUS-3A - the unified mine-only instructor schedule, once the only opt-in, no
// longer passes it either: that view now splits a day into chronological
// segments, and a hole inside ONE offering's grid is not necessarily free time
// (within a multi-offering segment the other course always fills it), so its
// band moved to the segment boundary. The mode below is deliberately KEPT
// unchanged and still contract-covered - it is the shared timetable primitive's
// behaviour, not that one view's.
//
// The fixed per-slot row height, as the CSS custom property the grid
// sizes its rows with. Exported (additively) so a caller that renders its OWN
// element on the SAME vertical scale - the unified instructor view's
// inter-segment gap, which sits BETWEEN two grids and therefore cannot inherit
// this variable from any of them - stays byte-identical to the grid instead of
// duplicating the literal and silently drifting from it at one breakpoint.
// Rendering here is unchanged: the grid still applies exactly this string.
export const SCHEDULE_TIME_GRID_SLOT_HEIGHT_CLASS = "[--slot-px:44px] sm:[--slot-px:32px]";

export function ScheduleTimeGrid<T extends GroupableScheduleItem>({
  items,
  renderCard,
  slotMinutes = 15,
  compactLongGaps,
}: {
  items: T[];
  renderCard: (item: T) => ReactNode;
  slotMinutes?: number;
  compactLongGaps?: {
    readonly thresholdMinutes: number;
    readonly compressedSlotCount: number;
    readonly label: string;
  };
}) {
  // Read as primitives so a caller passing a fresh object literal every render
  // cannot defeat the layout memo.
  const thresholdMinutes = compactLongGaps?.thresholdMinutes;
  const compressedSlotCount = compactLongGaps?.compressedSlotCount;
  const { totalSlots, positions, compressedGaps } = useMemo(
    () =>
      buildTimeGridLayout(items, {
        slotMinutes,
        compactLongGaps:
          thresholdMinutes !== undefined && compressedSlotCount !== undefined
            ? { thresholdMinutes, compressedSlotCount }
            : undefined,
      }),
    [items, slotMinutes, thresholdMinutes, compressedSlotCount]
  );

  if (positions.length === 0) return null;

  return (
    <div
      // --slot-px sets the fixed per-slot height via a CSS custom property
      // instead of a hardcoded JS constant, so the browser (not JS/window
      // measurement) can pick a different value per breakpoint - larger on
      // mobile, where the narrow columns force more text-wrapping and short
      // activities need more room to stay readable; unchanged on desktop/
      // tablet (sm: and up), where the current approved layout stays as-is.
      // Still a single fixed value at any given width, so every proportional
      // guarantee (rowSpan math, no gap, exact duration ratios) holds at
      // both sizes independently - only the overall scale differs.
      className={`grid ${SCHEDULE_TIME_GRID_SLOT_HEIGHT_CLASS}`}
      style={{
        gridTemplateColumns: "1fr 1fr",
        gridTemplateRows: `repeat(${totalSlots}, var(--slot-px))`,
      }}
    >
      {/* Compressed-gap bands. Rendered from their OWN list, never from
          positions - a gap is not an item, gets no card, and carries no
          title/location/instructor/course. Purely informational: no onClick,
          no key handler, no button role, no hover affordance and no dialog. */}
      {compactLongGaps &&
        compressedGaps.map((gap) => (
          <div
            key={gap.id}
            className="flex h-full flex-col overflow-hidden p-0.5"
            style={{
              gridColumn: "1 / span 2",
              gridRow: `${gap.startSlotIndex + 1} / span ${gap.rowSpan}`,
            }}
          >
            <div
              // aria-label replaces the inner text for assistive tech, so it
              // repeats the label AND states the real range and duration the
              // band stands for - the compressed height must never read as
              // "these two activities are adjacent".
              role="note"
              aria-label={`${compactLongGaps.label}, ${gap.realStartTime} עד ${gap.realEndTime}, ${formatTimeGridGapDurationLabel(gap.realDurationMinutes)}`}
              className="flex min-h-0 flex-1 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-lg border border-dashed border-border bg-muted px-2 text-center"
            >
              {/* Dashed border + explicit wording, not colour alone. */}
              <span className="text-xs font-semibold text-muted-foreground">
                {compactLongGaps.label}
              </span>
              <span className="text-xs text-muted-foreground" dir="ltr">
                {gap.realStartTime}–{gap.realEndTime}
              </span>
            </div>
          </div>
        ))}
      {positions.map(({ items: cellItems, column, startSlotIndex, rowSpan }) => {
        const key = cellItems.map((i) => i.id).join("+");
        return (
          <div
            key={key}
            className="flex h-full flex-col overflow-hidden"
            style={{
              gridColumn: column === "a" ? 1 : column === "b" ? 2 : "1 / span 2",
              gridRow: `${startSlotIndex + 1} / span ${rowSpan}`,
            }}
          >
            {cellItems.map((item) => (
              // renderCard returns a plain block element with no height of
              // its own (sized to its text content), so left alone it would
              // under-fill this cell instead of visually spanning the full
              // scheduled duration. [&>*]:h-full forces that one returned
              // element to stretch to 100% of its slice of the cell, without
              // needing to change any role's own card renderer. The p-0.5
              // insets the card slightly within the wrapper's own box - the
              // wrapper's outer size (and thus the grid line positions) is
              // untouched, so this only adds visual breathing room between
              // adjacent cards, never a real time gap.
              <div
                key={item.id}
                className="min-h-0 flex-1 overflow-hidden p-0.5 [&>*]:h-full"
              >
                {renderCard(item)}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
