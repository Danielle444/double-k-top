"use client";

import { useState } from "react";
import type { WeeklyRidingActivity } from "@/lib/actions/riding-slots";
import { InstructorScheduleCourseSelector } from "./InstructorScheduleCourseSelector";
import { InstructorScheduleWeekBrowser } from "./InstructorScheduleWeekBrowser";

/**
 * LEVEL 2 SLICE S2A: the instructor SCHEDULE TAB's course selector.
 *
 * SCREEN-LOCAL BY DESIGN. This selection belongs to the schedule tab and nothing
 * else - it is not app-wide state, is not shared with the today card, the
 * contacts tab, duties, riding or any other tab, is not persisted (no
 * localStorage, no cookie, no database), and is not restored across mounts. It
 * is intentional UX that each screen that can show more than one course chooses
 * its own, independently.
 *
 * This component owns EXACTLY ONE piece of state - `selectedOfferingId` - and
 * deliberately nothing derived from it. Everything derived (week list, selected
 * week, selected day, loaded items, reported riding range) lives in
 * InstructorScheduleWeekBrowser, mounted with key={selectedOfferingId}, so a
 * course switch REMOUNTS it and no stale week/day/item data can survive into the
 * next course.
 *
 * NO DEFAULT SELECTION is a hard rule: `selectedOfferingId` starts null, nothing
 * auto-selects (not even when exactly one option exists), and NO schedule or week
 * request is issued until an instructor picks a course.
 */
export function InstructorCourseScopedScheduleSection({
  onScheduleRangeChange,
  resolveRidingActivity,
  onOpenRidingActivity,
}: {
  onScheduleRangeChange: (range: { start: string; end: string } | null) => void;
  resolveRidingActivity?: (scheduleItemId: string) => WeeklyRidingActivity | null;
  onOpenRidingActivity?: (activity: WeeklyRidingActivity) => void;
}) {
  const [selectedOfferingId, setSelectedOfferingId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <InstructorScheduleCourseSelector
        selectedOfferingId={selectedOfferingId}
        onSelectOffering={setSelectedOfferingId}
      />

      {selectedOfferingId === null ? (
        <p className="rounded-2xl border border-border bg-card p-5 text-base text-muted-foreground">
          יש לבחור קורס כדי לראות את הלו&quot;ז
        </p>
      ) : (
        <InstructorScheduleWeekBrowser
          key={selectedOfferingId}
          courseOfferingId={selectedOfferingId}
          onScheduleRangeChange={onScheduleRangeChange}
          resolveRidingActivity={resolveRidingActivity}
          onOpenRidingActivity={onOpenRidingActivity}
        />
      )}
    </div>
  );
}
