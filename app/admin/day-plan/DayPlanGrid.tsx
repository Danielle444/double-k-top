"use client";

import { useState, useTransition } from "react";
import { setCourseDayPlan, type DayPlanSlots } from "@/lib/actions/course-day-plan";
import { parseDateKey } from "@/lib/dates";

const SLOT_FIELDS: { key: keyof DayPlanSlots; label: string }[] = [
  { key: "firstMorningGroup", label: "רכיבה ראשונה - בוקר" },
  { key: "secondMorningGroup", label: "רכיבה שנייה - בוקר" },
  { key: "firstAfterLunchGroup", label: "רכיבה ראשונה - אחה\"צ" },
  { key: "secondAfterLunchGroup", label: "רכיבה שנייה - אחה\"צ" },
];

const EMPTY_SLOTS: DayPlanSlots = {
  firstMorningGroup: null,
  secondMorningGroup: null,
  firstAfterLunchGroup: null,
  secondAfterLunchGroup: null,
};

function shortDayLabel(dk: string) {
  const date = parseDateKey(dk);
  const weekday = new Intl.DateTimeFormat("he-IL", {
    weekday: "short",
    timeZone: "UTC",
  }).format(date);
  return `${weekday} ${date.getUTCDate()}/${date.getUTCMonth() + 1}`;
}

export function DayPlanGrid({
  dateKeys,
  groupOptions,
  initialPlans,
}: {
  dateKeys: string[];
  groupOptions: string[];
  initialPlans: Record<string, DayPlanSlots>;
}) {
  const [, startTransition] = useTransition();
  const [plans, setPlans] = useState<Record<string, DayPlanSlots>>(initialPlans);

  function handleChange(dk: string, field: keyof DayPlanSlots, value: string) {
    const current = plans[dk] ?? EMPTY_SLOTS;
    const next = { ...current, [field]: value || null };
    setPlans((prev) => ({ ...prev, [dk]: next }));
    startTransition(async () => {
      await setCourseDayPlan(dk, next);
    });
  }

  return (
    <div className="max-h-[70vh] overflow-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            <th className="sticky top-0 right-0 z-20 min-w-[7rem] border-b border-l border-border bg-muted px-3 py-2 text-right">
              תאריך
            </th>
            {SLOT_FIELDS.map((field) => (
              <th
                key={field.key}
                className="sticky top-0 z-10 min-w-[8rem] border-b border-border bg-muted px-2 py-2 text-center font-normal text-muted-foreground"
              >
                {field.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dateKeys.map((dk) => {
            const slots = plans[dk] ?? EMPTY_SLOTS;
            return (
              <tr key={dk}>
                <td className="sticky right-0 z-10 border-b border-l border-border bg-card px-3 py-1.5 font-medium text-card-foreground">
                  {shortDayLabel(dk)}
                </td>
                {SLOT_FIELDS.map((field) => (
                  <td key={field.key} className="border-b border-border p-1 text-center">
                    <select
                      value={slots[field.key] ?? ""}
                      onChange={(e) => handleChange(dk, field.key, e.target.value)}
                      className="w-full rounded-md border border-border px-1 py-1 text-xs"
                    >
                      <option value="">ללא</option>
                      {groupOptions.map((g) => (
                        <option key={g} value={g}>
                          {g}
                        </option>
                      ))}
                    </select>
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
