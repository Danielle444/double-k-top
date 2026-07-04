"use client";

import { enumerateDateKeys, formatHebrewWeekday, parseDateKey } from "@/lib/dates";

export interface WeekOption {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
}

export function WeekDayPicker({
  weeks,
  selectedWeekId,
  onSelectWeek,
  dayFilter,
  onSelectDay,
}: {
  weeks: WeekOption[];
  selectedWeekId: string | null;
  onSelectWeek: (id: string) => void;
  dayFilter: string | "all";
  onSelectDay: (day: string | "all") => void;
}) {
  const selectedWeek = weeks.find((w) => w.id === selectedWeekId) ?? null;
  const dayKeys = selectedWeek
    ? enumerateDateKeys(parseDateKey(selectedWeek.startDate), parseDateKey(selectedWeek.endDate))
    : [];

  if (weeks.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card p-5 text-center">
        <p className="text-base text-card-foreground">טרם הועלה לו&quot;ז לאף שבוע</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4">
      <label className="flex flex-col gap-2">
        <span className="text-base font-bold text-card-foreground">שבוע</span>
        <select
          value={selectedWeekId ?? ""}
          onChange={(e) => onSelectWeek(e.target.value)}
          className="rounded-xl border border-border px-4 py-3 text-base"
        >
          {weeks.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </label>

      {selectedWeek && (
        <div className="flex flex-col gap-2">
          <span className="text-base font-bold text-card-foreground">יום</span>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onSelectDay("all")}
              className={`rounded-full px-4 py-2.5 text-sm font-medium ${
                dayFilter === "all"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              כל השבוע
            </button>
            {dayKeys.map((dk) => (
              <button
                key={dk}
                type="button"
                onClick={() => onSelectDay(dk)}
                className={`rounded-full px-4 py-2.5 text-sm font-medium ${
                  dayFilter === dk
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {formatHebrewWeekday(parseDateKey(dk))}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
