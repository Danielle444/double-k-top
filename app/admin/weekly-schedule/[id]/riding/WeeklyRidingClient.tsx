"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/lib/components/Button";
import { formatHebrewDate, formatHebrewWeekday, parseDateKey } from "@/lib/dates";
import { cleanScheduleTitle } from "@/lib/schedule-title";
import { getScheduleGroupColorClass } from "@/lib/schedule-group-colors";
import { RidingSlotModal } from "@/app/admin/weekly-schedule/[id]/RidingSlotModal";
import {
  getWeeklyRidingOverview,
  type WeeklyRidingDay,
  type WeeklyRidingActivity,
} from "@/lib/actions/riding-slots";

interface InstructorOption {
  id: string;
  fullName: string;
}

type ViewMode = "likely" | "all";

export function WeeklyRidingClient({
  weekId,
  weekName,
  initialDays,
  instructors,
}: {
  weekId: string;
  weekName: string;
  initialDays: WeeklyRidingDay[];
  instructors: InstructorOption[];
}) {
  const [days, setDays] = useState(initialDays);
  const [viewMode, setViewMode] = useState<ViewMode>("likely");
  const [ridingTarget, setRidingTarget] = useState<WeeklyRidingActivity | null>(null);

  function refetch() {
    getWeeklyRidingOverview(weekId).then(setDays);
  }

  function closeModal() {
    setRidingTarget(null);
    // The modal may have created/edited the slot behind this activity (or
    // any other) - refresh so the list's status/assignments summary and
    // "טרם הוגדר" badges stay accurate.
    refetch();
  }

  const visibleDays = days
    .map((day) => ({
      ...day,
      activities: day.activities.filter((a) => viewMode === "all" || a.isLikelyRiding),
    }))
    .filter((day) => day.activities.length > 0);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link
          href={`/admin/weekly-schedule/${weekId}`}
          className="text-sm text-muted-foreground underline hover:text-card-foreground"
        >
          &larr; חזרה ללו&quot;ז השבועי
        </Link>
        <h1 className="mt-1 text-xl font-bold text-card-foreground">ניהול רכיבות - {weekName}</h1>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setViewMode("likely")}
          className={`rounded-full px-4 py-2 text-sm font-medium ${
            viewMode === "likely"
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground"
          }`}
        >
          פעילויות רכיבה סבירות
        </button>
        <button
          type="button"
          onClick={() => setViewMode("all")}
          className={`rounded-full px-4 py-2 text-sm font-medium ${
            viewMode === "all"
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground"
          }`}
        >
          הצג את כל הפעילויות
        </button>
      </div>

      {visibleDays.length === 0 ? (
        <p className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
          אין פעילויות להצגה
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          {visibleDays.map((day) => (
            <div key={day.dateKey} className="rounded-2xl border border-border bg-card p-5">
              <p className="mb-3 inline-block rounded-lg bg-secondary px-3 py-2 text-base font-bold text-secondary-foreground">
                {formatHebrewWeekday(parseDateKey(day.dateKey))} ·{" "}
                {formatHebrewDate(parseDateKey(day.dateKey))}
              </p>
              <div className="flex flex-col gap-3">
                {day.activities.map((activity) => (
                  <div
                    key={activity.scheduleItemIds.join("+")}
                    className={`rounded-xl border-2 border-border p-4 ${getScheduleGroupColorClass(
                      activity.groupName
                    )}`}
                  >
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-1.5">
                      <span className="font-semibold text-card-foreground">
                        {activity.startTime}-{activity.endTime}
                      </span>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                          {activity.groupName ? `קבוצה ${activity.groupName}` : "שתי הקבוצות"}
                        </span>
                        {activity.isLikelyRiding && (
                          <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
                            רכיבה (זוהה אוטומטית)
                          </span>
                        )}
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            activity.ridingSlot
                              ? "bg-success-muted text-success"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {activity.ridingSlot ? "מוגדר כרכיבה" : "טרם הוגדר"}
                        </span>
                      </div>
                    </div>

                    <p className="text-lg font-bold text-card-foreground">
                      {cleanScheduleTitle(activity.title)}
                    </p>

                    {activity.ridingSlot && (
                      <div className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground">
                        <p>
                          חשיפה לתלמידים: מדריך/ה{" "}
                          {activity.ridingSlot.showInstructorToStudents ? "מוצג" : "מוסתר"} · מגרש{" "}
                          {activity.ridingSlot.showArenaToStudents ? "מוצג" : "מוסתר"} · תת-קבוצה{" "}
                          {activity.ridingSlot.showSubgroupToStudents ? "מוצג" : "מוסתר"}
                        </p>
                        {activity.ridingSlot.assignments.length === 0 ? (
                          <p>אין שיוכים עדיין</p>
                        ) : (
                          activity.ridingSlot.assignments.map((a) => (
                            <p key={a.id}>
                              {a.groupName ? `קבוצה ${a.groupName}` : "כל הרכיבה"}
                              {a.subgroupNumber != null ? ` / תת-קבוצה ${a.subgroupNumber}` : ""} -
                              מדריך/ה: {a.instructorName ?? "לא נבחר"} · מגרש: {a.arena ?? "לא הוזן"}
                            </p>
                          ))
                        )}
                      </div>
                    )}

                    <div className="mt-2">
                      <Button
                        variant="secondary"
                        className="!px-2 !py-1 !text-xs"
                        onClick={() => setRidingTarget(activity)}
                      >
                        ניהול רכיבה
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {ridingTarget && (
        <RidingSlotModal
          open={ridingTarget !== null}
          onClose={closeModal}
          scheduleItemIds={ridingTarget.scheduleItemIds}
          scheduleItemInfo={{
            title: ridingTarget.title,
            dateKey: ridingTarget.dateKey,
            startTime: ridingTarget.startTime,
            endTime: ridingTarget.endTime,
            groupName: ridingTarget.groupName,
            instructorName: ridingTarget.instructorName,
            location: ridingTarget.location,
          }}
          isMergedDisplay={ridingTarget.scheduleItemIds.length > 1}
          instructors={instructors}
        />
      )}
    </div>
  );
}
