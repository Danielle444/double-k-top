"use client";

import { useState, useTransition } from "react";
import { setAvailability, setAvailabilityForAllStudents } from "@/lib/actions/availability";
import { parseDateKey } from "@/lib/dates";

interface StudentOption {
  id: string;
  fullName: string;
}

interface AvailabilityGridProps {
  students: StudentOption[];
  dateKeys: string[];
  initialAvailability: Record<string, boolean>;
}

function cellKey(studentId: string, dk: string) {
  return `${studentId}|${dk}`;
}

function shortDayLabel(dk: string) {
  const date = parseDateKey(dk);
  const weekday = new Intl.DateTimeFormat("he-IL", {
    weekday: "short",
    timeZone: "UTC",
  }).format(date);
  const day = date.getUTCDate();
  const month = date.getUTCMonth() + 1;
  return { weekday, dayMonth: `${day}/${month}` };
}

export function AvailabilityGrid({
  students,
  dateKeys,
  initialAvailability,
}: AvailabilityGridProps) {
  const [, startTransition] = useTransition();
  const [availability, setAvailabilityState] =
    useState<Record<string, boolean>>(initialAvailability);

  function isAvailable(studentId: string, dk: string): boolean {
    return availability[cellKey(studentId, dk)] ?? true;
  }

  function toggleCell(studentId: string, dk: string) {
    const next = !isAvailable(studentId, dk);
    setAvailabilityState((prev) => ({ ...prev, [cellKey(studentId, dk)]: next }));
    startTransition(async () => {
      await setAvailability(studentId, dk, next);
    });
  }

  function setWholeColumn(dk: string, value: boolean) {
    setAvailabilityState((prev) => {
      const next = { ...prev };
      for (const s of students) next[cellKey(s.id, dk)] = value;
      return next;
    });
    startTransition(async () => {
      await setAvailabilityForAllStudents(dk, value);
    });
  }

  return (
    <div className="max-h-[70vh] overflow-auto rounded-lg border border-border">
      <table className="border-collapse text-xs">
        <thead>
          <tr>
            <th className="sticky top-0 right-0 z-20 min-w-[10rem] border-b border-l border-border bg-muted px-3 py-2 text-right">
              חניך/ה
            </th>
            {dateKeys.map((dk) => {
              const { weekday, dayMonth } = shortDayLabel(dk);
              return (
                <th
                  key={dk}
                  className="sticky top-0 z-10 w-12 min-w-[3rem] border-b border-border bg-muted px-1 py-1 text-center font-normal"
                >
                  <div className="text-muted-foreground">{weekday}</div>
                  <div className="font-semibold text-card-foreground">{dayMonth}</div>
                  <div className="mt-1 flex justify-center gap-0.5">
                    <button
                      type="button"
                      title="סמן הכל כזמין/ה"
                      className="rounded px-1 text-[10px] text-success hover:bg-success-muted"
                      onClick={() => setWholeColumn(dk, true)}
                    >
                      ✓
                    </button>
                    <button
                      type="button"
                      title="סמן הכל כלא זמין/ה"
                      className="rounded px-1 text-[10px] text-danger hover:bg-danger-muted"
                      onClick={() => setWholeColumn(dk, false)}
                    >
                      ✗
                    </button>
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {students.map((student) => (
            <tr key={student.id}>
              <td className="sticky right-0 z-10 border-b border-l border-border bg-card px-3 py-1.5 font-medium text-card-foreground">
                {student.fullName}
              </td>
              {dateKeys.map((dk) => {
                const available = isAvailable(student.id, dk);
                return (
                  <td key={dk} className="border-b border-border/60 p-0.5 text-center">
                    <button
                      type="button"
                      onClick={() => toggleCell(student.id, dk)}
                      className={`h-7 w-7 rounded-md text-sm font-bold transition-colors ${
                        available
                          ? "bg-success-muted text-success hover:opacity-80"
                          : "bg-danger-muted text-danger hover:opacity-80"
                      }`}
                    >
                      {available ? "✓" : "✗"}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
