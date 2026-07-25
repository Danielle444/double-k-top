"use client";

/**
 * UNIFIED TRAINEE SCHEDULE - SLICE U1: the "הלו״ז שלי" combined chronological
 * sub-view for a dual-enrolled trainee.
 *
 * Calls ONLY getUnifiedScheduleForTrainee(dayKey) - no course offering id, no
 * student id, no dual flag. Renders every real, already-authorized item it
 * returns as a plain chronological stacked list (never ScheduleTimeGrid: this
 * view mixes items from different offerings, which the grid's single-course
 * column model does not model). Reuses the EXISTING ScheduleCard (exported
 * from ScheduleSection.tsx, unchanged) for every item's time/title/location/
 * note/instructor/riding-assignment/compact-details-modal behaviour - no
 * server logic or item rendering is duplicated here.
 */
import { useEffect, useState } from "react";
import { getUnifiedScheduleForTrainee } from "@/lib/actions/unified-trainee-schedule";
import type { ScheduleItemView } from "@/lib/actions/student-schedule";
import type { UnifiedScheduleItemView } from "@/lib/course/unified-trainee-schedule-core";
import { ScheduleCard, isItemActiveNow } from "./ScheduleSection";

type UnifiedItem = UnifiedScheduleItemView<ScheduleItemView>;

// Shown when the unified reader rejects with a non-denial error (an infra/DB
// hiccup) - never a permanent "טוען..." and never the raw server error.
const UNIFIED_SCHEDULE_LOAD_ERROR_MESSAGE = "לא ניתן לטעון כרגע את הלו״ז. נסו לרענן את העמוד.";

// eligible: false is the SAME uniform outcome the server returns for a
// no-longer-dual trainee (e.g. an enrollment change since the tab last
// loaded) - an expected access failure, distinct from an unexpected error.
const UNIFIED_SCHEDULE_DENIED_MESSAGE = "הלו״ז המאוחד אינו זמין עבורך כרגע";

type LoadState =
  | { status: "loading" }
  | { status: "denied" }
  | { status: "error" }
  | { status: "loaded"; items: UnifiedItem[] };

/**
 * `dayKey` is a plain date key (never "all") - null only while the caller's
 * own date navigation has not yet resolved one (e.g. weeks still loading),
 * in which case this renders the same loading state as an in-flight request.
 */
export function UnifiedScheduleSection({
  studentId,
  dayKey,
}: {
  studentId: string;
  dayKey: string | null;
}) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!dayKey) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ status: "loading" });
    getUnifiedScheduleForTrainee(dayKey)
      .then((result) => {
        if (cancelled) return;
        if (!result.eligible) {
          setState({ status: "denied" });
          return;
        }
        setState({ status: "loaded", items: result.items });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [dayKey]);

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <h2 className="mb-4 text-xl font-bold text-card-foreground">הלו&quot;ז שלי</h2>

      {!dayKey || state.status === "loading" ? (
        <p className="text-base text-muted-foreground">טוען...</p>
      ) : state.status === "denied" ? (
        <p className="text-base text-card-foreground">{UNIFIED_SCHEDULE_DENIED_MESSAGE}</p>
      ) : state.status === "error" ? (
        <p className="text-base text-muted-foreground">{UNIFIED_SCHEDULE_LOAD_ERROR_MESSAGE}</p>
      ) : state.items.length === 0 ? (
        <p className="text-base text-muted-foreground">אין פריטים להצגה</p>
      ) : (
        // Chronological stacked list only - never ScheduleTimeGrid, and never
        // grouped/re-sorted here: the pure core (mergeUnifiedScheduleSources)
        // already returns items in one global chronological order.
        <div className="flex flex-col gap-3">
          {state.items.map((item) => (
            <ScheduleCard
              key={item.id}
              item={item}
              active={isItemActiveNow(item, now)}
              studentId={studentId}
              extraBadges={
                <>
                  {/* Compact, always-visible source-course badge - never hidden
                      behind the compact-details dialog. */}
                  <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
                    {item.sourceCourseLabel}
                  </span>
                  {/* Minimal cross-course overlap indicator (locked scope for this
                      slice): a visible badge only, never conflict resolution and
                      never a link to the other course. */}
                  {item.overlappingSourceCourseOfferingIds.length > 0 && (
                    <span className="rounded-full bg-warning-muted px-2 py-0.5 text-xs font-medium text-warning">
                      חפיפה בלו&quot;ז
                    </span>
                  )}
                </>
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
