"use client";

import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import {
  getScheduleForInstructor,
  type InstructorScheduleFilter,
  type InstructorScheduleItem,
  type InstructorScheduleResult,
} from "@/lib/actions/instructor-schedule";
import type { WeeklyRidingActivity } from "@/lib/actions/riding-slots";
import { todayDateKey } from "@/lib/dates";
import { cleanScheduleTitle } from "@/lib/schedule-title";
import { ScheduleTimeGrid } from "@/lib/components/ScheduleTimeGrid";
import { getScheduleGroupColorClass } from "@/lib/schedule-group-colors";

function isItemActiveNow(item: InstructorScheduleItem, now: Date): boolean {
  const todayKey = now.toISOString().slice(0, 10);
  if (item.dateKey !== todayKey) return false;
  const [sh, sm] = item.startTime.split(":").map(Number);
  const [eh, em] = item.endTime.split(":").map(Number);
  if (Number.isNaN(sh) || Number.isNaN(eh)) return false;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  return nowMinutes >= sh * 60 + sm && nowMinutes < eh * 60 + em;
}

function renderScheduleCard(
  item: InstructorScheduleItem,
  active: boolean,
  compact: boolean,
  // The configured riding activity this exact card's id resolves to, or null.
  // Clickability comes ONLY from a successful id -> real-activity mapping here,
  // never from the (Hebrew) title text - so meals, duties, lessons and any
  // unconfigured riding item stay non-interactive with their styling, layout
  // and text untouched.
  ridingActivity: WeeklyRidingActivity | null,
  onOpenRidingActivity: ((activity: WeeklyRidingActivity) => void) | undefined
) {
  const clickable = Boolean(ridingActivity && ridingActivity.ridingSlot && onOpenRidingActivity);
  // The card has no nested interactive elements, so a single handler on the
  // card can never be reached twice for one activation and needs no
  // stopPropagation; the outer ScheduleTimeGrid wrapper is layout-only and
  // binds no click handler of its own.
  const open = clickable ? () => onOpenRidingActivity!(ridingActivity!) : undefined;

  return (
    <div
      key={item.id}
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
        <span
          className={`rounded-full bg-muted text-muted-foreground ${
            compact ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm"
          }`}
        >
          {item.groupName ? `קבוצה ${item.groupName}` : "שתי הקבוצות"}
        </span>
      </div>
      <p className={`font-bold text-card-foreground ${compact ? "text-base" : "text-lg"}`}>
        {cleanScheduleTitle(item.title)}
      </p>
      {item.instructorName && (
        <p className={`mt-1 text-muted-foreground ${compact ? "text-xs" : "text-sm"}`}>
          מדריך/ה: {item.instructorName}
        </p>
      )}
      {item.location && (
        <p className={`text-muted-foreground ${compact ? "text-xs" : "text-sm"}`}>
          מיקום: {item.location}
        </p>
      )}
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
    </div>
  );
}

export function InstructorScheduleSection({
  instructorId,
  weeklyScheduleId,
  dayFilter,
  resolveRidingActivity,
  onOpenRidingActivity,
}: {
  instructorId: string;
  weeklyScheduleId: string | null;
  dayFilter: string | "all";
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
    if (!weeklyScheduleId) return;
    let cancelled = false;
    // Reset to the loading state on every filter change so a slow or failed
    // request never leaves the previous (unfiltered) list frozen on screen.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setResult(null);
    getScheduleForInstructor(instructorId, weeklyScheduleId, dayFilter, scheduleFilter)
      .then((r) => {
        if (!cancelled) setResult(r);
      })
      .catch(() => {
        if (!cancelled) setResult({ hasSchedule: true, weekName: null, items: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [instructorId, weeklyScheduleId, dayFilter, scheduleFilter]);

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

      {!weeklyScheduleId ? (
        <p className="text-base text-card-foreground">עדיין לא הועלה לו&quot;ז לשבוע זה</p>
      ) : !result ? (
        <p className="text-base text-muted-foreground">טוען...</p>
      ) : !result.hasSchedule ? (
        <p className="text-base text-card-foreground">עדיין לא הועלה לו&quot;ז לשבוע זה</p>
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
                renderCard={(item) =>
                  renderScheduleCard(
                    item,
                    isItemActiveNow(item, now),
                    true,
                    resolveRidingActivity?.(item.id) ?? null,
                    onOpenRidingActivity
                  )
                }
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
