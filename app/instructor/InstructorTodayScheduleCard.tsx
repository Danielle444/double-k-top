"use client";

import { useEffect, useState } from "react";
import type { WeeklyRidingActivity } from "@/lib/actions/riding-slots";
import { InstructorScheduleCourseSelector } from "./InstructorScheduleCourseSelector";
import { InstructorScheduleSection } from "./InstructorScheduleSection";
import { UnifiedInstructorScheduleSection } from "./UnifiedInstructorScheduleSection";

/**
 * LEVEL 2 SLICE S2A: the instructor HOME ("today") card's course selector.
 * IUS-2B: plus the unified "הלו״ז המשולב שלי" today mode.
 *
 * INDEPENDENT BY DESIGN. The today card is itself a schedule surface, so it gets
 * its OWN screen-local selection - not the schedule tab's, not the contacts
 * tab's, and not any shared InstructorClient state. Picking Level 2 here does
 * not move the schedule tab, and picking Level 2 in the schedule tab does not
 * move this card. Nothing is persisted (no localStorage, no cookie, no
 * database); a refresh safely resets to the default mode.
 *
 * As on the schedule tab, the per-course branch mounts the item view with
 * key={selectedOfferingId}, so a course switch REMOUNTS it and the previously
 * loaded today items cannot survive.
 *
 * The week is chosen SERVER-SIDE in BOTH modes: nothing here sends a week id or
 * a date. The server authenticates, re-validates the requested offering(s),
 * requires SCHEDULE=ENABLED, and only then reads its own clock to find whichever
 * week covers today. There is no client-side current-week guess left here.
 *
 * IUS-2B - THREE DESTINATIONS, ONE AT A TIME. The card offers the unified
 * "הלו״ז המשולב שלי" plus the existing per-course choices (whose labels still
 * come from the shared, server-composed course selector). Exactly ONE branch is
 * mounted, so the unselected mode issues no request at all.
 *
 * The unified branch is deliberately MINE-ONLY: its reader takes no filter and
 * fixes "mine" server-side, so this card can never ask for every instructor's
 * timetable. The per-course branch keeps its existing behaviour untouched.
 */
type TodayScheduleMode = "unified" | "byCourse";
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
  // IUS-2B - screen-local mode, exactly like the course selection beside it:
  // not app-wide state, not shared with any other tab, not persisted and not
  // restored across mounts. It lives HERE and never in InstructorClient.
  //
  // IUS-2C - TEMPORARY DEFAULT. Defaults to "byCourse" only because the unified
  // view does not yet preserve the Level 1 parallel-group layout: it flattens
  // simultaneous group א / group ב blocks into one vertical list and omits the
  // per-day headers on multi-day week views. The unified view remains fully
  // available one tap away via the toggle below - nothing about it is disabled
  // or hidden. This default REVERTS TO "unified" once the Level 1
  // parallel-group layout fix lands (see the IUS-2D plan).
  const [todayMode, setTodayMode] = useState<TodayScheduleMode>("byCourse");

  // Report today's range while something is actually shown, and clear it on
  // unmount (tab switch) or deselection. The shared riding map this feeds is
  // keyed by real ScheduleItem id, so only items belonging to the week this card
  // actually rendered can ever resolve - the range alone exposes nothing.
  //
  // The unified branch reports its own range (it is handed todayKey for exactly
  // that purpose), so this effect covers the per-course branch only.
  useEffect(() => {
    if (todayMode !== "byCourse" || selectedOfferingId === null) {
      return;
    }
    onScheduleRangeChange({ start: todayKey, end: todayKey });
    return () => onScheduleRangeChange(null);
  }, [todayMode, selectedOfferingId, todayKey, onScheduleRangeChange]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2 rounded-2xl border border-border bg-card p-4">
        <button
          type="button"
          onClick={() => setTodayMode("unified")}
          className={`rounded-full px-4 py-2 text-sm font-semibold ${
            todayMode === "unified"
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground"
          }`}
        >
          הלו&quot;ז המשולב שלי
        </button>
        <button
          type="button"
          onClick={() => setTodayMode("byCourse")}
          className={`rounded-full px-4 py-2 text-sm font-semibold ${
            todayMode === "byCourse"
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground"
          }`}
        >
          לפי קורס
        </button>
      </div>

      {/* Exactly ONE branch is mounted at a time, so the unselected mode issues
          no request: in unified mode the course selector and the course-scoped
          today reader are not rendered at all, and switching back unmounts the
          unified view and stops its own request. */}
      {todayMode === "unified" ? (
        <div className="max-h-[40vh] overflow-y-auto">
          <UnifiedInstructorScheduleSection
            mode="today"
            todayKey={todayKey}
            onScheduleRangeChange={onScheduleRangeChange}
            resolveRidingActivity={resolveRidingActivity}
            onOpenRidingActivity={onOpenRidingActivity}
          />
        </div>
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}
