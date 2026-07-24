"use client";

import { useEffect, useState } from "react";
import { WeekDayPicker } from "@/lib/components/WeekDayPicker";
import { getInstructorWeekSelection, type InstructorWeekOption } from "@/lib/actions/instructor-schedule-course-scoped";
import { getDefaultDayFilter, getLocalDateKey } from "@/lib/dates";
import type { WeeklyRidingActivity } from "@/lib/actions/riding-slots";
import { InstructorScheduleSection } from "./InstructorScheduleSection";

/**
 * LEVEL 2 SLICE S2A: the schedule tab's COURSE-SCOPED week browser.
 *
 * THIS COMPONENT IS THE KEYED INNER HALF of the schedule screen. Its parent
 * (InstructorCourseScopedScheduleSection) owns ONLY the selected course id and
 * mounts this with key={selectedOfferingId}. That is the clearing mechanism:
 * every piece of course-derived state - the week list, the selected week, the
 * selected day, the loaded items and the reported riding range - lives HERE, so
 * a course switch unmounts and remounts this whole subtree and all of it returns
 * to its initial value before a single request for the new course is issued.
 * There is deliberately no manual "reset on courseOfferingId change" effect: a
 * remount is stronger, and the repo's react-hooks/set-state-in-effect rule
 * rejects the synchronous-reset alternative anyway.
 *
 * The week list is course-scoped SERVER-SIDE (getInstructorWeekSelection re-
 * validates the requested offering and requires SCHEDULE=ENABLED before running
 * a query whose only predicate is that resolved offering's id). Unpublished
 * weeks are still included, exactly as instructors have always seen them.
 */
export function InstructorScheduleWeekBrowser({
  courseOfferingId,
  onScheduleRangeChange,
  resolveRidingActivity,
  onOpenRidingActivity,
}: {
  courseOfferingId: string;
  // Reports the selected week's DATE RANGE (never the course) upward, so
  // InstructorClient's existing shared riding-activity map keeps working without
  // holding any course state. Must be a stable callback.
  onScheduleRangeChange: (range: { start: string; end: string } | null) => void;
  resolveRidingActivity?: (scheduleItemId: string) => WeeklyRidingActivity | null;
  onOpenRidingActivity?: (activity: WeeklyRidingActivity) => void;
}) {
  const [weeks, setWeeks] = useState<InstructorWeekOption[] | null>(null);
  const [selectedWeekId, setSelectedWeekId] = useState<string | null>(null);
  const [dayFilter, setDayFilter] = useState<string | "all">("all");

  useEffect(() => {
    let cancelled = false;
    getInstructorWeekSelection(courseOfferingId)
      .then((sel) => {
        if (cancelled) return;
        setWeeks(sel.weeks);
        setSelectedWeekId(sel.defaultWeekId);
        const defaultWeek = sel.weeks.find((w) => w.id === sel.defaultWeekId) ?? null;
        setDayFilter(getDefaultDayFilter(defaultWeek, getLocalDateKey()));
      })
      .catch(() => {
        // Fail closed: no weeks, no selection, no schedule request.
        if (!cancelled) setWeeks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [courseOfferingId]);

  // Publish the selected week's range upward, and CLEAR it on unmount - which is
  // exactly what a course switch causes - so the shared riding-activity map can
  // never resolve a card against the previous course's range.
  const selectedWeek = weeks?.find((w) => w.id === selectedWeekId) ?? null;
  const rangeStart = selectedWeek?.startDate ?? null;
  const rangeEnd = selectedWeek?.endDate ?? null;
  useEffect(() => {
    onScheduleRangeChange(
      rangeStart && rangeEnd ? { start: rangeStart, end: rangeEnd } : null,
    );
    return () => onScheduleRangeChange(null);
  }, [rangeStart, rangeEnd, onScheduleRangeChange]);

  return (
    <>
      {weeks === null ? (
        <p className="text-base text-muted-foreground">טוען...</p>
      ) : (
        <WeekDayPicker
          weeks={weeks}
          selectedWeekId={selectedWeekId}
          onSelectWeek={(id) => {
            setSelectedWeekId(id);
            const week = weeks.find((w) => w.id === id) ?? null;
            setDayFilter(getDefaultDayFilter(week, getLocalDateKey()));
          }}
          dayFilter={dayFilter}
          onSelectDay={setDayFilter}
        />
      )}
      {/* Bounded internal scroll - the day-group labels inside
          InstructorScheduleSection are `sticky top-0`; without this bounded box
          they'd resolve against the page's own scroll and collide with the
          shell header's own `sticky top-0 z-20`. Same fix shape as before. */}
      <div className="max-h-[calc(100vh-180px)] overflow-y-auto">
        <InstructorScheduleSection
          mode="week"
          courseOfferingId={courseOfferingId}
          weeklyScheduleId={selectedWeekId}
          dayFilter={dayFilter}
          resolveRidingActivity={resolveRidingActivity}
          onOpenRidingActivity={onOpenRidingActivity}
        />
      </div>
    </>
  );
}
