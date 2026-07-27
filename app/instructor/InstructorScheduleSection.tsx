"use client";

import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  getCourseScopedScheduleForInstructor,
  getTodayScheduleForInstructor,
  type InstructorScheduleFilter,
  type InstructorScheduleItem,
  type InstructorScheduleResult,
} from "@/lib/actions/instructor-schedule-course-scoped";
import type { WeeklyRidingActivity } from "@/lib/actions/riding-slots";
import { todayDateKey } from "@/lib/dates";
import { cleanScheduleTitle } from "@/lib/schedule-title";
import { ScheduleTimeGrid } from "@/lib/components/ScheduleTimeGrid";
import { getScheduleGroupColorClass } from "@/lib/schedule-group-colors";
import { resolveActivityForScheduleCardId } from "@/app/instructor/instructor-riding-schedule-map-core";
import { instructorCombinedParticipationBadgeLabel } from "@/lib/course/instructor-combined-participation-badge-core";
import { Modal } from "@/lib/components/Modal";

// IUS-2 - exported so the unified sub-view reuses the SAME "מתקיים עכשיו" rule
// rather than cloning it (the trainee ScheduleSection exports its twin for the
// same reason). Behaviour is unchanged.
export function isItemActiveNow(item: InstructorScheduleItem, now: Date): boolean {
  const todayKey = now.toISOString().slice(0, 10);
  if (item.dateKey !== todayKey) return false;
  const [sh, sm] = item.startTime.split(":").map(Number);
  const [eh, em] = item.endTime.split(":").map(Number);
  if (Number.isNaN(sh) || Number.isNaN(eh)) return false;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  return nowMinutes >= sh * 60 + sm && nowMinutes < eh * 60 + em;
}

// A real component (not a plain function returning JSX) specifically so its
// own showDetails state can live here, scoped per card the same way the
// student ScheduleCard's isExpanded/showDetails state is (see that file's
// own comment for why per-item keying makes this safe with zero extra
// bookkeeping). Compact/grid cards (ScheduleTimeGrid) sit in a fixed-height,
// duration-proportional cell (see ScheduleTimeGrid.tsx / schedule-timegrid.ts,
// untouched here) with no room to show every field inline for a short
// session - so secondary details (location, session note, which instructor is
// teaching) move into this on-demand dialog, reusing the exact same
// authorized InstructorScheduleItem fields the card already holds. Riding
// assignment/horse detail already has its own, separate, richer interaction
// (the existing "צפייה בחניכים" click-through to the riding-students modal),
// left untouched and not duplicated here.
export function InstructorScheduleCard({
  item,
  active,
  compact,
  // The configured riding activity this exact card's id resolves to, or null.
  // Clickability comes ONLY from a successful id -> real-activity mapping here,
  // never from the (Hebrew) title text - so meals, duties, lessons and any
  // unconfigured riding item stay non-interactive with their styling, layout
  // and text untouched.
  ridingActivity,
  onOpenRidingActivity,
  // IUS-2 - optional caller-supplied pills rendered in the EXISTING badge row,
  // after the group badge. Used by the unified sub-view for its source-course
  // and cross-offering-overlap badges, so that view needs no card of its own.
  // Omitted by every per-course call site, which therefore renders exactly as
  // before. Presentation only: this never changes what the card reads, gates or
  // opens.
  extraBadges,
  // IUS-3 - the SERVER-RESOLVED CourseOffering.level of the offering this item
  // was read from: result.courseLevel for the per-course view,
  // item.sourceCourseLevel for a unified item. Used ONLY to decide whether the
  // Level 2 "משולב" badge renders. Never inferred here from a course name,
  // title, week or date, and never used to filter, hide or reorder anything.
  courseLevel,
}: {
  item: InstructorScheduleItem;
  active: boolean;
  compact: boolean;
  ridingActivity: WeeklyRidingActivity | null;
  onOpenRidingActivity: ((activity: WeeklyRidingActivity) => void) | undefined;
  extraBadges?: ReactNode;
  courseLevel: number;
}) {
  const [showDetails, setShowDetails] = useState(false);

  const clickable = Boolean(ridingActivity && ridingActivity.ridingSlot && onOpenRidingActivity);
  const open = clickable ? () => onOpenRidingActivity!(ridingActivity!) : undefined;

  const location = item.location;
  const note = item.description?.trim() || null;
  // IUS-3 - null for every Level 1 block and for an unstated tri-state, so the
  // badge and the modal line below simply do not render. Display-only: this
  // value never filters, hides or reorders an item.
  const combinedLabel = instructorCombinedParticipationBadgeLabel(
    courseLevel,
    item.combinedParticipation,
  );
  // Deterministic rule (no DOM/height measurement): the info control appears
  // exactly when at least one secondary detail exists beyond time/title/badges.
  // combinedLabel participates so a compact Level 2 card whose ONLY extra fact
  // is the combined flag still exposes the dialog rather than silently dropping
  // it in a short, fixed-height grid cell.
  const hasSecondaryDetails =
    Boolean(location) || Boolean(note) || Boolean(item.instructorName) || Boolean(combinedLabel);

  // Built once, rendered verbatim either inline (a hypothetical non-compact
  // caller - none exists today, every current call site passes compact=true)
  // or inside the details dialog - the same authorized fields either way,
  // never duplicated data.
  const detailsContent = (
    <>
      {location && <p className="mt-1 text-sm text-muted-foreground">מיקום: {location}</p>}
      {note && (
        <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
          <span className="font-medium text-card-foreground">הערה: </span>
          {note}
        </p>
      )}
      {item.instructorName && (
        <p className="mt-1 text-sm text-muted-foreground">מדריך/ה: {item.instructorName}</p>
      )}
      {/* IUS-3 - the same label as the header pill, repeated here so a compact
          card that pushed its badges out of view still states it explicitly. */}
      {combinedLabel && (
        <p className="mt-1 text-sm text-muted-foreground">משולב: {combinedLabel}</p>
      )}
    </>
  );

  return (
    <div
      // Interactive attributes are added ONLY for a clickable riding card, so an
      // ordinary card renders byte-for-byte as before (no role, no tabIndex, no
      // handlers). role="button" + tabIndex + Enter/Space keep the card
      // reachable and activatable by keyboard, not just pointer.
      {...(clickable
        ? {
            role: "button" as const,
            tabIndex: 0,
            onClick: open,
            onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                open?.();
              }
            },
          }
        : {})}
      className={`rounded-xl border-2 ${compact ? "p-2.5" : "p-4"} ${
        active ? "border-accent bg-secondary" : `border-border ${getScheduleGroupColorClass(item.groupName)}`
      }${clickable ? " cursor-pointer transition-colors hover:border-primary/50 active:bg-black/5" : ""}`}
    >
      <div className="mb-1 flex flex-wrap items-center justify-between gap-1.5">
        <span
          className={`font-semibold text-card-foreground ${compact ? "text-sm" : "text-base"}`}
        >
          {item.startTime}-{item.endTime}
        </span>
        {/* The group badge and any caller-supplied extras share one wrapping
            row, so extra pills wrap onto a new line on narrow screens instead
            of squeezing the time/group pair. With no extras this renders the
            same single group badge as before. */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={`rounded-full bg-muted text-muted-foreground ${
              compact ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm"
            }`}
          >
            {item.groupName ? `קבוצה ${item.groupName}` : "שתי הקבוצות"}
          </span>
          {/* IUS-3 - Level 2 combined-participation indication. Display-only,
              rendered only when the pure helper returned a label (Level 1 and
              an unstated tri-state both yield null -> no element at all). It
              hides no item and changes no stored value. */}
          {combinedLabel && (
            <span
              className={`rounded-full bg-secondary text-secondary-foreground ${
                compact ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm"
              }`}
            >
              {combinedLabel}
            </span>
          )}
          {extraBadges}
        </div>
      </div>
      <div className="flex items-start justify-between gap-2">
        <p className={`font-bold text-card-foreground ${compact ? "line-clamp-2 text-base" : "text-lg"}`}>
          {cleanScheduleTitle(item.title)}
        </p>
        {compact && hasSecondaryDetails && (
          <button
            type="button"
            onClick={(e) => {
              // This card can itself be clickable (a configured riding slot
              // opens the riding-students modal) - stop the event here so
              // opening the info dialog never also opens that modal.
              e.stopPropagation();
              setShowDetails(true);
            }}
            onKeyDown={(e) => e.stopPropagation()}
            aria-label="מידע נוסף על הסשן"
            className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-bold leading-none text-muted-foreground hover:bg-secondary hover:text-secondary-foreground"
          >
            i
          </button>
        )}
      </div>
      {!compact && detailsContent}
      {active && (
        <span className="mt-2 inline-block rounded-full bg-accent px-3 py-1 text-sm font-medium text-accent-foreground">
          מתקיים עכשיו
        </span>
      )}
      {/* Subtle, addition-only affordance shown solely on a clickable riding
          card - it does not alter any existing card's text or layout. */}
      {clickable && (
        <span
          className={`mt-2 block font-medium text-primary ${compact ? "text-xs" : "text-sm"}`}
          aria-hidden="true"
        >
          צפייה בחניכים ›
        </span>
      )}
      {compact && hasSecondaryDetails && (
        <Modal
          open={showDetails}
          onClose={() => setShowDetails(false)}
          title={`${item.startTime}-${item.endTime} · ${cleanScheduleTitle(item.title)}`}
        >
          <div className="flex flex-col gap-1.5">{detailsContent}</div>
        </Modal>
      )}
    </div>
  );
}

/**
 * LEVEL 2 SLICE S2A - COURSE-SCOPED. This section no longer takes an
 * `instructorId`: identity is derived server-side from the signed session inside
 * both actions below, so no client value can control whose schedule is read.
 *
 * `courseOfferingId` is REQUIRED and is a REQUEST, never a grant - the server
 * re-validates it on every read. This component never renders "the current
 * course" and never picks one itself.
 *
 * CLEARING ON COURSE SWITCH IS THE PARENT'S JOB, and the mechanism is
 * LOAD-BEARING: both mounting screens mount this with key={selectedOfferingId},
 * so choosing a different course REMOUNTS the component and `result` plus the
 * mine/all filter return to their initial state before the next request is
 * issued. No previous course's items can survive. (Same pattern the contacts
 * roster already relies on.) If a future caller ever mounts this WITHOUT the
 * key, it must clear the previous course itself.
 */
export function InstructorScheduleSection({
  mode,
  courseOfferingId,
  weeklyScheduleId = null,
  dayFilter = "all",
  emptyMessage = "עדיין לא הועלה לו\"ז לשבוע זה",
  resolveRidingActivity,
  onOpenRidingActivity,
}: {
  // "week": read the explicitly selected week of this course.
  // "today": let the SERVER pick whichever week of this course covers today
  //   (the client sends no date and no week id).
  mode: "week" | "today";
  courseOfferingId: string;
  weeklyScheduleId?: string | null;
  dayFilter?: string | "all";
  emptyMessage?: string;
  // Read-only lookup from a rendered card's own real ScheduleItem id to the
  // configured riding activity behind it (or null). Supplied by InstructorClient
  // from its single shared per-range activities read; when omitted, no card is
  // interactive and this section behaves exactly as before.
  resolveRidingActivity?: (scheduleItemId: string) => WeeklyRidingActivity | null;
  // Opens the single shared riding-students popup (owned by InstructorClient)
  // for a resolved activity. Same controller both existing riding-tab entry
  // paths already use - no second modal, no second save path.
  onOpenRidingActivity?: (activity: WeeklyRidingActivity) => void;
}) {
  // Defaults to the full schedule ("כל הלו"ז") rather than the
  // instructor's own lessons - not persisted anywhere, so every mount
  // (home tab or schedule tab) starts here; the instructor can still switch
  // to "השיעורים שלי" manually.
  const [scheduleFilter, setScheduleFilter] = useState<InstructorScheduleFilter>("all");
  const [result, setResult] = useState<InstructorScheduleResult | null>(null);
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    // In "week" mode nothing is requested until a week is chosen (the render
    // below shows the empty message instead) - unchanged from before. In "today"
    // mode there is no week to choose: the server picks it, scoped to this
    // course.
    if (mode === "week" && !weeklyScheduleId) return;
    let cancelled = false;
    // Reset to the loading state on every filter change so a slow or failed
    // request never leaves the previous (unfiltered) list frozen on screen.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setResult(null);
    const request =
      mode === "today"
        ? getTodayScheduleForInstructor(courseOfferingId, scheduleFilter)
        : getCourseScopedScheduleForInstructor(
            courseOfferingId,
            weeklyScheduleId,
            dayFilter,
            scheduleFilter,
          );
    request
      .then((r) => {
        if (!cancelled) setResult(r);
      })
      .catch(() => {
        if (!cancelled) setResult({ hasSchedule: true, weekName: null, courseLevel: 0, items: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [mode, courseOfferingId, weeklyScheduleId, dayFilter, scheduleFilter]);

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);

  const groupedByDay = useMemo(() => {
    if (!result) return [];
    const map = new Map<string, InstructorScheduleItem[]>();
    for (const item of result.items) {
      if (!map.has(item.dateKey)) map.set(item.dateKey, []);
      map.get(item.dateKey)!.push(item);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [result]);

  const todayKey = todayDateKey();

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-card-foreground">לו&quot;ז שבועי</h2>
        <div className="flex gap-2 text-sm">
          <button
            type="button"
            onClick={() => setScheduleFilter("mine")}
            className={`rounded-full px-4 py-2 font-medium ${
              scheduleFilter === "mine"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground"
            }`}
          >
            השיעורים שלי
          </button>
          <button
            type="button"
            onClick={() => setScheduleFilter("all")}
            className={`rounded-full px-4 py-2 font-medium ${
              scheduleFilter === "all"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground"
            }`}
          >
            כל הלו&quot;ז
          </button>
        </div>
      </div>

      {mode === "week" && !weeklyScheduleId ? (
        <p className="text-base text-card-foreground">{emptyMessage}</p>
      ) : !result ? (
        <p className="text-base text-muted-foreground">טוען...</p>
      ) : !result.hasSchedule ? (
        // Also the uniform server-side denial (unauthorized course, SCHEDULE not
        // ENABLED, or a week this course does not own) - deliberately
        // indistinguishable from "no week uploaded", so a week id can never be
        // probed across courses.
        <p className="text-base text-card-foreground">{emptyMessage}</p>
      ) : groupedByDay.length === 0 ? (
        <p className="text-base text-muted-foreground">אין פריטים להצגה</p>
      ) : (
        <div className="flex flex-col gap-5">
          {groupedByDay.map(([dk, items]) => (
            <div key={dk} className="flex flex-col gap-2">
              <div className="sticky top-0 z-10 rounded-lg bg-secondary px-3 py-2 text-base font-bold text-secondary-foreground">
                {items[0].dayLabel} · {items[0].dateLabel}
                {dk === todayKey && <span className="mr-2 text-sm font-normal">(היום)</span>}
              </div>
              <ScheduleTimeGrid
                items={items}
                renderCard={(item) => (
                  <InstructorScheduleCard
                    item={item}
                    active={isItemActiveNow(item, now)}
                    compact
                    // item.id may be a "+"-joined composite of atomic ScheduleItem
                    // ids (merged/coalesced cards); the activity map is keyed by
                    // atomic ids, so resolve through the composite-aware helper
                    // rather than looking the composite up directly.
                    ridingActivity={resolveActivityForScheduleCardId(resolveRidingActivity, item.id)}
                    onOpenRidingActivity={onOpenRidingActivity}
                    // The SERVER-RESOLVED level of the offering this whole
                    // result was read from (0 on any denial, which fails closed
                    // to no badge).
                    courseLevel={result.courseLevel}
                  />
                )}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
