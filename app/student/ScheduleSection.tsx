"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getScheduleForStudent,
  type GroupFilter,
  type ScheduleItemView,
  type StudentScheduleResult,
} from "@/lib/actions/student-schedule";
import { todayDateKey } from "@/lib/dates";

function isItemActiveNow(item: ScheduleItemView, now: Date): boolean {
  const todayKey = now.toISOString().slice(0, 10);
  if (item.dateKey !== todayKey) return false;
  const [sh, sm] = item.startTime.split(":").map(Number);
  const [eh, em] = item.endTime.split(":").map(Number);
  if (Number.isNaN(sh) || Number.isNaN(eh)) return false;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  return nowMinutes >= sh * 60 + sm && nowMinutes < eh * 60 + em;
}

export function ScheduleSection({
  studentId,
  weeklyScheduleId,
  dayFilter,
}: {
  studentId: string;
  weeklyScheduleId: string | null;
  dayFilter: string | "all";
}) {
  const [groupFilter, setGroupFilter] = useState<GroupFilter>("mine");
  const [result, setResult] = useState<StudentScheduleResult | null>(null);
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    if (!weeklyScheduleId) return;
    let cancelled = false;
    getScheduleForStudent(studentId, weeklyScheduleId, dayFilter, groupFilter).then((r) => {
      if (!cancelled) setResult(r);
    });
    return () => {
      cancelled = true;
    };
  }, [studentId, weeklyScheduleId, dayFilter, groupFilter]);

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);

  const groupedByDay = useMemo(() => {
    if (!result) return [];
    const map = new Map<string, ScheduleItemView[]>();
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
        <h2 className="text-xl font-bold text-card-foreground">הלו&quot;ז שלי</h2>
        <div className="flex gap-2 text-sm">
          <button
            type="button"
            onClick={() => setGroupFilter("mine")}
            className={`rounded-full px-4 py-2 font-medium ${
              groupFilter === "mine"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground"
            }`}
          >
            הקבוצה שלי
          </button>
          <button
            type="button"
            onClick={() => setGroupFilter("both")}
            className={`rounded-full px-4 py-2 font-medium ${
              groupFilter === "both"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground"
            }`}
          >
            שתי הקבוצות
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
              <div className="flex flex-col gap-3">
                {items.map((item) => {
                  const active = isItemActiveNow(item, now);
                  return (
                    <div
                      key={item.id}
                      className={`rounded-xl border-2 p-4 ${
                        active ? "border-accent bg-secondary" : "border-border"
                      }`}
                    >
                      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-base font-semibold text-card-foreground">
                          {item.startTime}-{item.endTime}
                        </span>
                        <span className="rounded-full bg-muted px-3 py-1 text-sm text-muted-foreground">
                          {item.groupName ? `קבוצה ${item.groupName}` : "שתי הקבוצות"}
                        </span>
                      </div>
                      <p className="text-lg font-bold text-card-foreground">{item.title}</p>
                      {item.location && (
                        <p className="mt-1 text-sm text-muted-foreground">מיקום: {item.location}</p>
                      )}
                      {active && (
                        <span className="mt-2 inline-block rounded-full bg-accent px-3 py-1 text-sm font-medium text-accent-foreground">
                          מתקיים עכשיו
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
