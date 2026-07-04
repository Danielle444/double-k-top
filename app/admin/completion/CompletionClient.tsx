"use client";

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/lib/components/Button";
import { adminSetCompletion } from "@/lib/actions/completion";
import { formatHebrewDate, formatHebrewDateTime, parseDateKey } from "@/lib/dates";

interface CompletionRow {
  id: string;
  dateKey: string;
  studentName: string;
  dutyTypeName: string;
  isPublished: boolean;
  isCompleted: boolean;
  completedAt: string | null;
}

export function CompletionClient({
  assignments,
  defaultDateKey,
}: {
  assignments: CompletionRow[];
  defaultDateKey: string;
}) {
  const [isPending, startTransition] = useTransition();
  const availableDates = useMemo(
    () => Array.from(new Set(assignments.map((a) => a.dateKey))).sort(),
    [assignments]
  );
  const [selectedDate, setSelectedDate] = useState(
    availableDates.includes(defaultDateKey) ? defaultDateKey : availableDates[0] ?? ""
  );

  const dayAssignments = useMemo(
    () => assignments.filter((a) => a.dateKey === selectedDate),
    [assignments, selectedDate]
  );

  const completedCount = dayAssignments.filter((a) => a.isCompleted).length;

  function handleToggle(id: string, current: boolean) {
    startTransition(async () => {
      await adminSetCompletion(id, !current);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4">
        <label className="flex flex-col gap-1 text-sm">
          תאריך
          <select
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="rounded-lg border border-border px-3 py-2 text-sm"
          >
            {availableDates.length === 0 && <option value="">אין שיבוצים</option>}
            {availableDates.map((dk) => (
              <option key={dk} value={dk}>
                {formatHebrewDate(parseDateKey(dk))}
              </option>
            ))}
          </select>
        </label>
        {dayAssignments.length > 0 && (
          <p className="text-sm text-muted-foreground">
            בוצעו {completedCount} מתוך {dayAssignments.length}
          </p>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted text-muted-foreground">
              <th className="px-4 py-3 text-right font-medium">תלמיד/ה</th>
              <th className="px-4 py-3 text-right font-medium">סוג תורנות</th>
              <th className="px-4 py-3 text-right font-medium">פרסום</th>
              <th className="px-4 py-3 text-right font-medium">סטטוס</th>
              <th className="px-4 py-3 text-right font-medium">שעת ביצוע</th>
              <th className="px-4 py-3 text-right font-medium">פעולות</th>
            </tr>
          </thead>
          <tbody>
            {dayAssignments.map((a) => (
              <tr key={a.id} className="border-b border-border last:border-0">
                <td className="px-4 py-2 font-medium text-card-foreground">{a.studentName}</td>
                <td className="px-4 py-2 text-card-foreground">{a.dutyTypeName}</td>
                <td className="px-4 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      a.isPublished
                        ? "bg-success-muted text-success"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {a.isPublished ? "פורסם" : "טיוטה"}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      a.isCompleted
                        ? "bg-success-muted text-success"
                        : "bg-danger-muted text-danger"
                    }`}
                  >
                    {a.isCompleted ? "בוצע" : "לא בוצע"}
                  </span>
                </td>
                <td className="px-4 py-2 text-muted-foreground">
                  {a.completedAt ? formatHebrewDateTime(new Date(a.completedAt)) : "-"}
                </td>
                <td className="px-4 py-2">
                  <Button
                    variant="secondary"
                    className="!px-2 !py-1"
                    disabled={isPending}
                    onClick={() => handleToggle(a.id, a.isCompleted)}
                  >
                    {a.isCompleted ? "סימון כלא בוצע" : "סימון כבוצע"}
                  </Button>
                </td>
              </tr>
            ))}
            {dayAssignments.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  אין שיבוצים לתאריך זה
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
