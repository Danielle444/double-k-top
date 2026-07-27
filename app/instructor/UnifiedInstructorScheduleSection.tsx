"use client";

/**
 * UNIFIED INSTRUCTOR SCHEDULE - SLICE IUS-2 / IUS-2B: the "הלו״ז המשולב שלי"
 * combined chronological sub-view, in two modes:
 *
 *  - mode="week":  a selected week, with its own merged week/day picker.
 *  - mode="today": today only, with no picker at all - the server derives the
 *                  day from its own clock, exactly as the per-course today card
 *                  already does.
 *
 * MINE-ONLY BY DEFINITION (IUS-2B). "הלו״ז המשולב שלי" is THIS instructor's own
 * items unioned across every permitted offering - never every instructor's
 * timetable merged. There is deliberately NO "כל הלו״ז / השיעורים שלי" toggle
 * here and no filter is ever sent: both unified actions fix the filter
 * server-side, so "all" is not requestable through them at all. (The per-course
 * view keeps its own toggle, unchanged - that view is explicitly about one
 * course's whole timetable.)
 *
 * Calls ONLY the unified readers - no course offering id, no instructor id, no
 * filter, no eligibility flag. Every item's time/title/location/note/instructor/
 * riding-click-through/compact-details-modal behaviour - and its Level 2 "משולב"
 * badge - is reused verbatim from the EXISTING InstructorScheduleCard; no card,
 * no server logic and no filtering is duplicated here.
 *
 * IUS-2D - REAL TIMETABLE LAYOUT, ONE GRID PER OFFERING. The first cut rendered
 * a flat stacked list, which lost two things the per-course view has always had:
 * Level 1's simultaneous group א / group ב activities SIDE BY SIDE (plus its
 * full-width "שתי הקבוצות" blocks), and the per-day header on a multi-day week.
 * Both are restored by rendering through the EXISTING, untouched
 * ScheduleTimeGrid - but strictly ONE GRID PER (day, source CourseOffering):
 *
 *   the grid and lib/schedule-grouping beneath it pair/span/coalesce purely by
 *   groupName + cleaned title + adjacent times, with NO offering awareness, and
 *   their merge helpers keep only the FIRST item's fields. A grid fed two
 *   offerings could therefore fabricate one merged card carrying the wrong
 *   sourceCourseOfferingId / sourceCourseLabel / sourceCourseLevel /
 *   combinedParticipation / overlap metadata.
 *
 * The day/offering split is decided by the PURE core
 * (groupUnifiedInstructorItemsByDayAndOffering), which also owns the deterministic
 * day and block order; this file only renders it. Item order inside a block is
 * still the merge core's - nothing is re-sorted here.
 *
 * ALL STATE IS COMPONENT-LOCAL. No localStorage, no cookie, no React context,
 * no module-level mutable variable, and nothing is persisted or restored across
 * mounts - the same screen-local convention the per-course schedule surfaces
 * already follow.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { WeekDayPicker } from "@/lib/components/WeekDayPicker";
import { ScheduleTimeGrid } from "@/lib/components/ScheduleTimeGrid";
import { getDefaultDayFilter, getLocalDateKey, todayDateKey } from "@/lib/dates";
import type { WeeklyRidingActivity } from "@/lib/actions/riding-slots";
import {
  getUnifiedInstructorWeekOptions,
  type UnifiedInstructorWeekOptionsResult,
} from "@/lib/actions/unified-instructor-week-options";
import { getUnifiedScheduleForInstructor } from "@/lib/actions/unified-instructor-schedule";
import { getUnifiedTodayScheduleForInstructor } from "@/lib/actions/unified-instructor-today-schedule";
import type { InstructorScheduleItem } from "@/lib/actions/instructor-schedule-course-scoped";
import type { UnifiedInstructorScheduleItemView } from "@/lib/course/unified-instructor-schedule-core";
import { groupUnifiedInstructorItemsByDayAndOffering } from "@/lib/course/unified-instructor-day-grouping-core";
import { resolveActivityForScheduleCardId } from "@/app/instructor/instructor-riding-schedule-map-core";
import { InstructorScheduleCard, isItemActiveNow } from "./InstructorScheduleSection";

type UnifiedItem = UnifiedInstructorScheduleItemView<InstructorScheduleItem>;

// Shown when a unified reader rejects with a non-denial error (an infra/DB
// hiccup, or an unauthorized caller whose options read threw) - never a
// permanent "טוען..." and never the raw server error.
const UNIFIED_SCHEDULE_LOAD_ERROR_MESSAGE = "לא ניתן לטעון כרגע את הלו״ז. נסו לרענן את העמוד.";

// eligible: false is the uniform server outcome when fewer than two offerings
// are addressable - an expected access outcome, distinct from an error.
const UNIFIED_SCHEDULE_DENIED_MESSAGE = "הלו״ז המשולב אינו זמין עבורך כרגע";

// IUS-2F - long-gap compression, enabled ONLY here. A mine-only merged list is
// the one schedule surface where two of the same instructor's own assignments
// are routinely hours apart, and rendering that emptiness fully proportionally
// (44px per 15 minutes on mobile) pushes the afternoon off the screen. Anything
// over an hour collapses to a two-row labelled band; up to and including an
// hour stays fully proportional. The surrounding cards keep their real times,
// and the band names the real range it stands for, so nothing ever reads as
// "these are back to back". Module-level so the object identity is stable
// across the every-60s `now` tick and the grid's layout memo holds.
//
// Deliberately NOT passed by the per-course instructor view, the trainee view
// or the admin editors: those show a whole course's timetable, where an empty
// stretch is real shared information rather than one person's idle time.
const UNIFIED_COMPACT_LONG_GAPS = {
  thresholdMinutes: 60,
  compressedSlotCount: 2,
  label: "הפסקה בלו״ז שלי",
} as const;

type WeeksState =
  | { status: "loading" }
  | { status: "denied" }
  | { status: "error" }
  | { status: "loaded"; weeks: UnifiedInstructorWeekOptionsResult["weeks"] };

type ItemsState =
  | { status: "loading" }
  | { status: "denied" }
  | { status: "error" }
  | { status: "loaded"; items: UnifiedItem[] };

export function UnifiedInstructorScheduleSection({
  mode,
  todayKey,
  onScheduleRangeChange,
  resolveRidingActivity,
  onOpenRidingActivity,
}: {
  // "week": browse a merged week with the picker below.
  // "today": today only - no picker, no week id, no date sent to the server.
  mode: "week" | "today";
  // Today mode only, and used ONLY to report the riding-activity range upward -
  // never sent to a reader, which derives today server-side.
  todayKey?: string;
  // Reports the shown date range (never a course) upward, exactly as the
  // per-course surfaces already do, so the shared riding-activity map keeps
  // working without this view holding any course state.
  onScheduleRangeChange: (range: { start: string; end: string } | null) => void;
  resolveRidingActivity?: (scheduleItemId: string) => WeeklyRidingActivity | null;
  onOpenRidingActivity?: (activity: WeeklyRidingActivity) => void;
}) {
  const isToday = mode === "today";

  const [weeksState, setWeeksState] = useState<WeeksState>({ status: "loading" });
  const [selectedWeekId, setSelectedWeekId] = useState<string | null>(null);
  const [dayFilter, setDayFilter] = useState<string | "all">("all");
  const [itemsState, setItemsState] = useState<ItemsState>({ status: "loading" });
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);

  // Week options are a WEEK-MODE concern only: today mode has no picker, so it
  // never issues this request at all.
  useEffect(() => {
    if (isToday) return;
    let cancelled = false;
    getUnifiedInstructorWeekOptions()
      .then((result) => {
        if (cancelled) return;
        if (!result.eligible) {
          setWeeksState({ status: "denied" });
          return;
        }
        setWeeksState({ status: "loaded", weeks: result.weeks });
        setSelectedWeekId(result.defaultWeekId);
        const defaultWeek = result.weeks.find((w) => w.id === result.defaultWeekId) ?? null;
        setDayFilter(getDefaultDayFilter(defaultWeek, getLocalDateKey()));
      })
      .catch(() => {
        // Fail closed: no weeks, no selection, and no schedule request is issued.
        if (!cancelled) setWeeksState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [isToday]);

  // Memoised so its identity changes only when the loaded week list actually
  // does - a fresh [] every render would defeat the useCallback below.
  const weeks = useMemo(
    () => (weeksState.status === "loaded" ? weeksState.weeks : []),
    [weeksState],
  );
  const selectedWeek = weeks.find((w) => w.id === selectedWeekId) ?? null;
  const rangeStart = isToday ? (todayKey ?? null) : (selectedWeek?.startDate ?? null);
  const rangeEnd = isToday ? (todayKey ?? null) : (selectedWeek?.endDate ?? null);

  // Publish the shown range upward, and CLEAR it on unmount - which is what
  // leaving this sub-view causes - so the shared riding-activity map can never
  // resolve a card against a stale range.
  useEffect(() => {
    onScheduleRangeChange(rangeStart && rangeEnd ? { start: rangeStart, end: rangeEnd } : null);
    return () => onScheduleRangeChange(null);
  }, [rangeStart, rangeEnd, onScheduleRangeChange]);

  useEffect(() => {
    // Week mode requests nothing until a merged week is selected. Today mode has
    // nothing to wait for - the server picks the day itself.
    if (!isToday && (!rangeStart || !rangeEnd)) return;
    let cancelled = false;
    // Reset to the loading state on every change so a slow or failed request
    // never leaves the previous list frozen on screen.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItemsState({ status: "loading" });
    // No filter argument exists on either action - both are mine-only,
    // server-side. Today sends no date at all.
    const request = isToday
      ? getUnifiedTodayScheduleForInstructor()
      : getUnifiedScheduleForInstructor(rangeStart!, rangeEnd!, dayFilter);
    request
      .then((result) => {
        if (cancelled) return;
        if (!result.eligible) {
          setItemsState({ status: "denied" });
          return;
        }
        setItemsState({ status: "loaded", items: result.items });
      })
      .catch(() => {
        if (!cancelled) setItemsState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [isToday, rangeStart, rangeEnd, dayFilter]);

  const handleSelectWeek = useCallback(
    (id: string) => {
      setSelectedWeekId(id);
      const week = weeks.find((w) => w.id === id) ?? null;
      setDayFilter(getDefaultDayFilter(week, getLocalDateKey()));
    },
    [weeks],
  );

  // IUS-2D - the day -> source-offering split, decided entirely by the pure core.
  // Memoised so a grid's own layout memo keeps a stable `items` identity across
  // the every-60s `now` tick; the per-block copy exists only because
  // ScheduleTimeGrid's prop is a mutable T[] while the core (correctly) returns
  // frozen arrays - the grid itself is untouched by this slice.
  const days = useMemo(() => {
    if (itemsState.status !== "loaded") return [];
    return groupUnifiedInstructorItemsByDayAndOffering(itemsState.items).map((day) => ({
      ...day,
      blocks: day.blocks.map((block) => ({ ...block, items: [...block.items] })),
    }));
  }, [itemsState]);

  // Same "(היום)" convention as the per-course section: the LOCAL day key, used
  // for a marker only - it is never sent to a reader and never filters anything.
  const todayMarkerKey = todayDateKey();

  const itemsPanel = (
    <div className="rounded-2xl border border-border bg-card p-5">
      <h2 className="mb-4 text-xl font-bold text-card-foreground">
        {isToday ? 'הלו"ז המשולב שלי להיום' : 'הלו"ז המשולב שלי'}
      </h2>

      {itemsState.status === "loading" ? (
        <p className="text-base text-muted-foreground">טוען...</p>
      ) : itemsState.status === "denied" ? (
        <p className="text-base text-card-foreground">{UNIFIED_SCHEDULE_DENIED_MESSAGE}</p>
      ) : itemsState.status === "error" ? (
        <p className="text-base text-muted-foreground">{UNIFIED_SCHEDULE_LOAD_ERROR_MESSAGE}</p>
      ) : itemsState.items.length === 0 ? (
        <p className="text-base text-muted-foreground">אין פריטים להצגה</p>
      ) : (
        <div className="flex flex-col gap-5">
          {days.map((day) => (
            <div key={day.dateKey} className="flex flex-col gap-2">
              {/* The same sticky day header the per-course section renders -
                  restored here so a multi-day week is divided by day again. */}
              <div className="sticky top-0 z-10 rounded-lg bg-secondary px-3 py-2 text-base font-bold text-secondary-foreground">
                {day.dayLabel} · {day.dateLabel}
                {day.dateKey === todayMarkerKey && <span className="mr-2 text-sm font-normal">(היום)</span>}
              </div>
              {day.blocks.map((block) => (
                <div key={block.sourceCourseOfferingId} className="flex flex-col gap-1.5">
                  {/* Only when this day genuinely has more than one contributing
                      course: with a single block the source is already on every
                      card's badge, and an extra heading would make the merged
                      view look unlike the per-course one for no gain. */}
                  {day.blocks.length > 1 && (
                    <p className="text-sm font-semibold text-muted-foreground">
                      {block.sourceCourseLabel}
                    </p>
                  )}
                  {/* ONE offering per grid - see this file's header. Level 1
                      group א / group ב therefore lay out side by side exactly as
                      in the per-course view, and no card can ever be merged
                      across courses. */}
                  <ScheduleTimeGrid
                    items={block.items}
                    // IUS-2F - both modes render through this one grid element,
                    // so weekly and Today compress identically by construction.
                    compactLongGaps={UNIFIED_COMPACT_LONG_GAPS}
                    renderCard={(item) => (
                      <InstructorScheduleCard
                        item={item}
                        active={isItemActiveNow(item, now)}
                        compact
                        // item.id may be a "+"-joined composite of atomic
                        // ScheduleItem ids (merged/coalesced cards); the activity
                        // map is keyed by atomic ids, so resolve through the
                        // composite-aware helper rather than looking the
                        // composite up directly.
                        ridingActivity={resolveActivityForScheduleCardId(resolveRidingActivity, item.id)}
                        onOpenRidingActivity={onOpenRidingActivity}
                        // IUS-3 - this item's OWN source offering level, tagged
                        // by the merge core. Per item, not per view: a merged
                        // list mixes Level 1 and Level 2 blocks, and only the
                        // Level 2 ones may carry the "משולב" badge. The shared
                        // card renders it; this view never duplicates the
                        // wording or the rule.
                        courseLevel={item.sourceCourseLevel}
                        extraBadges={
                          <>
                            {/* Always-visible source-course badge - the whole
                                point of the merged list is knowing which course
                                an item came from, so it is never hidden behind
                                the compact-details dialog. */}
                            <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
                              {item.sourceCourseLabel}
                            </span>
                            {/* Minimal cross-offering overlap indicator: a
                                visible badge only, never conflict resolution and
                                never a link to the other course. */}
                            {item.overlappingSourceCourseOfferingIds.length > 0 && (
                              <span className="rounded-full bg-warning-muted px-2 py-0.5 text-xs font-medium text-warning">
                                חפיפה בלו&quot;ז
                              </span>
                            )}
                          </>
                        }
                      />
                    )}
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // Today mode has no week picker at all - the server owns the day.
  if (isToday) {
    return <div className="flex flex-col gap-4">{itemsPanel}</div>;
  }

  return (
    <div className="flex flex-col gap-4">
      {weeksState.status === "loading" ? (
        <p className="text-base text-muted-foreground">טוען...</p>
      ) : weeksState.status === "denied" ? (
        <p className="rounded-2xl border border-border bg-card p-5 text-base text-card-foreground">
          {UNIFIED_SCHEDULE_DENIED_MESSAGE}
        </p>
      ) : weeksState.status === "error" ? (
        <p className="rounded-2xl border border-border bg-card p-5 text-base text-muted-foreground">
          {UNIFIED_SCHEDULE_LOAD_ERROR_MESSAGE}
        </p>
      ) : (
        <>
          <WeekDayPicker
            weeks={weeks}
            selectedWeekId={selectedWeekId}
            onSelectWeek={handleSelectWeek}
            dayFilter={dayFilter}
            onSelectDay={setDayFilter}
          />
          {itemsPanel}
        </>
      )}
    </div>
  );
}
