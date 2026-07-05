"use client";

import { useMemo, type ReactNode } from "react";
import { buildTimeGridLayout } from "@/lib/schedule-timegrid";
import type { GroupableScheduleItem } from "@/lib/schedule-grouping";

// Fixed height per time slot in pixels - a real table row, not a floating
// element. No auto, no minmax: a cell spanning N slots is always exactly
// N x SLOT_PX tall, so duration and visual height stay exactly proportional
// (a 90-minute cell is always exactly 1.5x a 60-minute one).
const SLOT_PX = 32;

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
export function ScheduleTimeGrid<T extends GroupableScheduleItem>({
  items,
  renderCard,
  slotMinutes = 15,
}: {
  items: T[];
  renderCard: (item: T) => ReactNode;
  slotMinutes?: number;
}) {
  const { totalSlots, positions } = useMemo(
    () => buildTimeGridLayout(items, slotMinutes),
    [items, slotMinutes]
  );

  if (positions.length === 0) return null;

  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: "1fr 1fr",
        gridTemplateRows: `repeat(${totalSlots}, ${SLOT_PX}px)`,
      }}
    >
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
