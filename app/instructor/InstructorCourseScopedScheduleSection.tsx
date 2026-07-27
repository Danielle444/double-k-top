"use client";

import { useCallback, useRef, useState } from "react";
import type { WeeklyRidingActivity } from "@/lib/actions/riding-slots";
import type { InstructorCourseOptionView } from "@/lib/actions/instructor-course-options";
import { pickInstructorDefaultOfferingId } from "@/lib/course/instructor-default-schedule-offering-core";
import { InstructorScheduleCourseSelector } from "./InstructorScheduleCourseSelector";
import { InstructorScheduleWeekBrowser } from "./InstructorScheduleWeekBrowser";
import { UnifiedInstructorScheduleSection } from "./UnifiedInstructorScheduleSection";

/**
 * IUS-2 - the schedule tab's two sub-views.
 *
 * IUS-2E - the default is now PER INSTRUCTOR rather than the same for everyone:
 * an instructor who holds the riding-notes edit permission opens on "unified"
 * (they are the ones teaching across both offerings, for whom one merged
 * schedule is the point), everyone else opens on "byCourse". Both sub-views stay
 * available to EVERY instructor one tap away - this decides only which one is
 * shown first. A server-side `eligible: false` still makes the unified branch
 * degrade to its own denial message rather than to a broken screen.
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
 * IUS-2E - THE "NO DEFAULT SELECTION" RULE IS NARROWED, NOT REMOVED, and only
 * for this schedule surface. `selectedOfferingId` still starts null and nothing
 * is ever selected from a label, a name or a hardcoded id; what changed is that
 * when this screen lands in per-course mode it asks the PURE core
 * (pickInstructorDefaultOfferingId) to pick a Level 1 offering ONCE, out of the
 * server-composed option list, so an instructor who never sees the merged view is
 * not left staring at an empty "choose a course" prompt. The selection is applied
 * at most once per mount and never overrides a manual choice (see the latch
 * below). THE CONTACTS SELECTOR IS NOT AFFECTED - it is a different component
 * (InstructorCourseScopedContactsSection), which this file does not import and
 * which keeps the original hard rule.
 *
 * Selecting a course automatically is NOT an authorization change: the menu never
 * was authorization, and every schedule read still re-validates the chosen id
 * server-side (identity -> allow-listed offering -> SCHEDULE=ENABLED ->
 * offering-scoped query).
 */
export function InstructorCourseScopedScheduleSection({
  canEditRidingNotes,
  onScheduleRangeChange,
  resolveRidingActivity,
  onOpenRidingActivity,
}: {
  // IUS-2E - the SERVER-derived riding-notes edit permission (app/instructor/
  // page.tsx, from the signed session's Actor DAL row). Read ONCE, at mount, to
  // choose which sub-view opens first. It is never re-derived here, never
  // compared against a role or a course, and gates nothing: both sub-views stay
  // available regardless of its value, and every riding-note write is authorized
  // independently server-side.
  canEditRidingNotes: boolean;
  onScheduleRangeChange: (range: { start: string; end: string } | null) => void;
  resolveRidingActivity?: (scheduleItemId: string) => WeeklyRidingActivity | null;
  onOpenRidingActivity?: (activity: WeeklyRidingActivity) => void;
}) {
  const [selectedOfferingId, setSelectedOfferingId] = useState<string | null>(null);
  // IUS-2 - screen-local sub-view choice, exactly like the course selection
  // beside it: not app-wide state, not shared with any other tab, not persisted
  // (no localStorage, no cookie, no database) and not restored across mounts.
  // It lives HERE and never in InstructorClient.
  //
  // IUS-2D restored the "unified" default for everyone once the unified view
  // regained its per-(day, offering) ScheduleTimeGrid layout. IUS-2E makes that
  // default CONDITIONAL on the server-derived riding-notes permission.
  //
  // Evaluated SYNCHRONOUSLY, in the lazy initializer, from a prop that is already
  // present in the first server render - so there is no async gap, no mode flash,
  // and the unified view is never mounted-then-unmounted for an instructor who
  // should have started on "byCourse". There is deliberately NO effect anywhere in
  // this file that writes `subView`: the initializer runs once per mount and the
  // toggle buttons are the only other writer, so a manual choice can never be
  // re-overridden by a rerender.
  const [subView, setSubView] = useState<ScheduleSubView>(
    canEditRidingNotes ? "unified" : "byCourse",
  );

  // IUS-2E - one-shot latch for the automatic course default. A ref, not state:
  // flipping it must never itself cause a render, and it must survive every
  // rerender of this component. Combined with the `prev ?? ...` guard below this
  // makes the automatic selection idempotent - it can fire at most once, and only
  // while nothing is selected.
  const autoSelectedRef = useRef(false);

  const handleOptionsLoaded = useCallback((options: InstructorCourseOptionView[]) => {
    if (autoSelectedRef.current) return;
    autoSelectedRef.current = true;
    // `prev ?? ...` is the second, independent guard: if the instructor already
    // picked a course (or the options arrived after a manual pick), their choice
    // is kept verbatim and the computed default is discarded. A null result -
    // an empty menu - leaves the selection null and the existing empty state
    // renders unchanged.
    setSelectedOfferingId((prev) => prev ?? pickInstructorDefaultOfferingId(options));
  }, []);

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
          mode="week"
          onScheduleRangeChange={onScheduleRangeChange}
          resolveRidingActivity={resolveRidingActivity}
          onOpenRidingActivity={onOpenRidingActivity}
        />
      ) : (
        <>
          <InstructorScheduleCourseSelector
            selectedOfferingId={selectedOfferingId}
            onSelectOffering={setSelectedOfferingId}
            onOptionsLoaded={handleOptionsLoaded}
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
