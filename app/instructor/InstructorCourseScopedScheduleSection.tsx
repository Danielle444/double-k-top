"use client";

import { useState } from "react";
import type { WeeklyRidingActivity } from "@/lib/actions/riding-slots";
import { InstructorScheduleCourseSelector } from "./InstructorScheduleCourseSelector";
import { InstructorScheduleWeekBrowser } from "./InstructorScheduleWeekBrowser";
import { UnifiedInstructorScheduleSection } from "./UnifiedInstructorScheduleSection";

/**
 * IUS-2 - the schedule tab's two sub-views.
 *
 * "unified" is the DEFAULT: the whole point of the merged view is that an
 * instructor teaching across both offerings sees one schedule without having to
 * discover a toggle. The per-course view remains fully intact one tap away, and
 * a server-side `eligible: false` makes the unified branch degrade to its own
 * denial message rather than to a broken screen.
 */
type ScheduleSubView = "unified" | "byCourse";

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
  // IUS-2 - screen-local sub-view choice, exactly like the course selection
  // beside it: not app-wide state, not shared with any other tab, not persisted
  // (no localStorage, no cookie, no database) and not restored across mounts.
  // It lives HERE and never in InstructorClient.
  const [subView, setSubView] = useState<ScheduleSubView>("unified");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2 rounded-2xl border border-border bg-card p-4">
        <button
          type="button"
          onClick={() => setSubView("unified")}
          className={`rounded-full px-4 py-2 text-sm font-semibold ${
            subView === "unified"
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground"
          }`}
        >
          הלו&quot;ז המשולב שלי
        </button>
        <button
          type="button"
          onClick={() => setSubView("byCourse")}
          className={`rounded-full px-4 py-2 text-sm font-semibold ${
            subView === "byCourse"
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground"
          }`}
        >
          לפי קורס
        </button>
      </div>

      {/* Exactly ONE branch is mounted at a time. In unified mode the course
          selector and the per-course week browser are not rendered at all, so
          no per-course week or schedule request is issued; switching back
          unmounts the unified view and its own requests likewise stop. */}
      {subView === "unified" ? (
        <UnifiedInstructorScheduleSection
          onScheduleRangeChange={onScheduleRangeChange}
          resolveRidingActivity={resolveRidingActivity}
          onOpenRidingActivity={onOpenRidingActivity}
        />
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}
