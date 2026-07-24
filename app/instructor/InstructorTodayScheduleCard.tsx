"use client";

import { useEffect, useState } from "react";
import type { WeeklyRidingActivity } from "@/lib/actions/riding-slots";
import { InstructorScheduleCourseSelector } from "./InstructorScheduleCourseSelector";
import { InstructorScheduleSection } from "./InstructorScheduleSection";

/**
 * LEVEL 2 SLICE S2A: the instructor HOME ("today") card's course selector.
 *
 * INDEPENDENT BY DESIGN. The today card is itself a schedule surface, so it gets
 * its OWN screen-local selection - not the schedule tab's, not the contacts
 * tab's, and not any shared InstructorClient state. Picking Level 2 here does
 * not move the schedule tab, and picking Level 2 in the schedule tab does not
 * move this card. Nothing is persisted (no localStorage, no cookie, no
 * database); a refresh safely resets to "no course selected".
 *
 * As on the schedule tab, this component owns EXACTLY ONE piece of state and
 * mounts the item view with key={selectedOfferingId}, so a course switch
 * REMOUNTS it and the previously loaded today items cannot survive.
 *
 * The week is chosen SERVER-SIDE: mode="today" sends no week id and no date at
 * all. The server authenticates, re-validates the requested offering, requires
 * SCHEDULE=ENABLED, and only then reads its own clock to find whichever week OF
 * THAT COURSE covers today. There is no client-side current-week guess left here.
 */
export function InstructorTodayScheduleCard({
  todayKey,
  onScheduleRangeChange,
  resolveRidingActivity,
  onOpenRidingActivity,
}: {
  // Only used to report the riding-activity range upward - never sent to the
  // schedule reader, which derives today server-side.
  todayKey: string;
  onScheduleRangeChange: (range: { start: string; end: string } | null) => void;
  resolveRidingActivity?: (scheduleItemId: string) => WeeklyRidingActivity | null;
  onOpenRidingActivity?: (activity: WeeklyRidingActivity) => void;
}) {
  const [selectedOfferingId, setSelectedOfferingId] = useState<string | null>(null);

  // Report today's range only while a course is selected, and clear it on
  // unmount (tab switch) or deselection. The shared riding map this feeds is
  // keyed by real ScheduleItem id, so only items belonging to the week this card
  // actually rendered can ever resolve - the range alone exposes nothing.
  useEffect(() => {
    if (selectedOfferingId === null) {
      onScheduleRangeChange(null);
      return;
    }
    onScheduleRangeChange({ start: todayKey, end: todayKey });
    return () => onScheduleRangeChange(null);
  }, [selectedOfferingId, todayKey, onScheduleRangeChange]);

  return (
    <div className="flex flex-col gap-4">
      <InstructorScheduleCourseSelector
        selectedOfferingId={selectedOfferingId}
        onSelectOffering={setSelectedOfferingId}
      />

      {selectedOfferingId === null ? (
        <p className="rounded-2xl border border-border bg-card p-5 text-base text-muted-foreground">
          יש לבחור קורס כדי לראות את הלו&quot;ז להיום
        </p>
      ) : (
        <div className="max-h-[40vh] overflow-y-auto">
          <InstructorScheduleSection
            key={selectedOfferingId}
            mode="today"
            courseOfferingId={selectedOfferingId}
            emptyMessage={'עדיין לא הועלה לו"ז להיום'}
            resolveRidingActivity={resolveRidingActivity}
            onOpenRidingActivity={onOpenRidingActivity}
          />
        </div>
      )}
    </div>
  );
}
