"use client";

import { Fragment, FormEvent, useMemo, useState, useTransition } from "react";
import { Button } from "@/lib/components/Button";
import {
  createManualAssignment,
  deleteAssignment,
  reassignDuty,
  runGenerateSchedule,
  setPublishStatus,
} from "@/lib/actions/schedule";
import {
  enumerateDateKeys,
  formatHebrewDate,
  formatHebrewWeekday,
  parseDateKey,
  weekKey,
} from "@/lib/dates";
import type { GenerateMode } from "@/lib/scheduler";

interface AssignmentRow {
  id: string;
  dateKey: string;
  studentId: string;
  studentName: string;
  dutyTypeId: string;
  dutyTypeName: string;
  isManual: boolean;
  isPublished: boolean;
  isCompleted: boolean;
}

interface Option {
  id: string;
  fullName?: string;
  name?: string;
}

interface WeeklyScheduleOption {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
}

interface CourseRange {
  startDate: string;
  endDate: string;
}

type RangeSource = "course" | "week" | "weeklySchedule" | "custom";

const MODE_LABELS: Record<GenerateMode, string> = {
  fillMissing: "השלמת חוסרים בלבד",
  regeneratePreserveManual: "ייצור מחדש, שמירה על שיבוצים ידניים",
  clearAndRegenerate: "מחיקה וייצור מחדש מלא",
};

export function ScheduleClient({
  assignments,
  students,
  dutyTypes,
  courseRange,
  weeklySchedules,
}: {
  assignments: AssignmentRow[];
  students: Option[];
  dutyTypes: Option[];
  courseRange: CourseRange | null;
  weeklySchedules: WeeklyScheduleOption[];
}) {
  const [isPending, startTransition] = useTransition();
  const [filterDate, setFilterDate] = useState("");
  const [filterStudent, setFilterStudent] = useState("");
  const [filterDuty, setFilterDuty] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  const [rangeSource, setRangeSource] = useState<RangeSource>("weeklySchedule");
  const [selectedWeekKey, setSelectedWeekKey] = useState("");
  const [selectedWeeklyScheduleId, setSelectedWeeklyScheduleId] = useState("");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [mode, setMode] = useState<GenerateMode>("regeneratePreserveManual");
  const [genMessage, setGenMessage] = useState<string | null>(null);

  const weekOptions = useMemo(() => {
    if (!courseRange) return [];
    const keys = enumerateDateKeys(parseDateKey(courseRange.startDate), parseDateKey(courseRange.endDate));
    const byWeek = new Map<string, string[]>();
    for (const dk of keys) {
      const wk = weekKey(parseDateKey(dk));
      if (!byWeek.has(wk)) byWeek.set(wk, []);
      byWeek.get(wk)!.push(dk);
    }
    return Array.from(byWeek.entries()).map(([wk, dks]) => ({
      weekKey: wk,
      startDate: dks[0],
      endDate: dks[dks.length - 1],
    }));
  }, [courseRange]);

  function resolveRange(): { startDate: Date; endDate: Date } | null {
    if (rangeSource === "course" && courseRange) {
      return { startDate: parseDateKey(courseRange.startDate), endDate: parseDateKey(courseRange.endDate) };
    }
    if (rangeSource === "week") {
      const week = weekOptions.find((w) => w.weekKey === selectedWeekKey);
      if (!week) return null;
      return { startDate: parseDateKey(week.startDate), endDate: parseDateKey(week.endDate) };
    }
    if (rangeSource === "weeklySchedule") {
      const ws = weeklySchedules.find((w) => w.id === selectedWeeklyScheduleId);
      if (!ws) return null;
      return { startDate: parseDateKey(ws.startDate), endDate: parseDateKey(ws.endDate) };
    }
    if (rangeSource === "custom") {
      if (!customStart || !customEnd) return null;
      return { startDate: parseDateKey(customStart), endDate: parseDateKey(customEnd) };
    }
    return null;
  }

  function handleGenerate() {
    const range = resolveRange();
    if (!range) {
      setGenMessage("יש לבחור טווח תאריכים תקין");
      return;
    }
    setGenMessage(null);
    startTransition(async () => {
      const result = await runGenerateSchedule({ ...range, mode });
      if (!result.success) {
        setGenMessage(result.error ?? "אירעה שגיאה");
        return;
      }
      setGenMessage(`נוצרו ${result.assignedCount} שיבוצים (טיוטה) עבור ${result.daysProcessed} ימים`);
    });
  }

  function handlePublish(isPublished: boolean) {
    const range = resolveRange();
    if (!range) {
      setGenMessage("יש לבחור טווח תאריכים תקין");
      return;
    }
    setGenMessage(null);
    startTransition(async () => {
      await setPublishStatus(range.startDate, range.endDate, isPublished);
      setGenMessage(isPublished ? "הטווח פורסם" : "פרסום הטווח בוטל");
    });
  }

  const filtered = useMemo(() => {
    return assignments.filter((a) => {
      if (filterDate && a.dateKey !== filterDate) return false;
      if (filterStudent && a.studentId !== filterStudent) return false;
      if (filterDuty && a.dutyTypeId !== filterDuty) return false;
      return true;
    });
  }, [assignments, filterDate, filterStudent, filterDuty]);

  const availableDates = useMemo(
    () => Array.from(new Set(assignments.map((a) => a.dateKey))).sort(),
    [assignments]
  );

  function handleReassign(assignmentId: string, newStudentId: string) {
    setError(null);
    startTransition(async () => {
      const result = await reassignDuty(assignmentId, newStudentId);
      if (!result.success) setError(result.error ?? "אירעה שגיאה");
    });
  }

  function handleDelete(assignmentId: string) {
    setError(null);
    startTransition(async () => {
      const result = await deleteAssignment(assignmentId);
      if (!result.success) setError(result.error ?? "אירעה שגיאה");
    });
  }

  function handleAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    const dk = String(formData.get("date"));
    const dutyTypeId = String(formData.get("dutyTypeId"));
    const studentId = String(formData.get("studentId"));
    startTransition(async () => {
      const result = await createManualAssignment(dk, dutyTypeId, studentId);
      if (!result.success) {
        setError(result.error ?? "אירעה שגיאה");
        return;
      }
      setShowAddForm(false);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
        <p className="text-sm font-medium text-card-foreground">ייצור ופרסום שיבוצים</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            טווח
            <select
              value={rangeSource}
              onChange={(e) => setRangeSource(e.target.value as RangeSource)}
              className="rounded-lg border border-border px-3 py-2 text-sm"
            >
              <option value="weeklySchedule">לפי לו&quot;ז שבועי שהועלה</option>
              <option value="week">שבוע ספציפי</option>
              <option value="course">כל טווח הקורס</option>
              <option value="custom">טווח תאריכים מותאם</option>
            </select>
          </label>

          {rangeSource === "weeklySchedule" && (
            <label className="flex flex-col gap-1 text-sm">
              שבוע
              <select
                value={selectedWeeklyScheduleId}
                onChange={(e) => setSelectedWeeklyScheduleId(e.target.value)}
                className="rounded-lg border border-border px-3 py-2 text-sm"
              >
                <option value="">בחרו שבוע</option>
                {weeklySchedules.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {rangeSource === "week" && (
            <label className="flex flex-col gap-1 text-sm">
              שבוע
              <select
                value={selectedWeekKey}
                onChange={(e) => setSelectedWeekKey(e.target.value)}
                className="rounded-lg border border-border px-3 py-2 text-sm"
              >
                <option value="">בחרו שבוע</option>
                {weekOptions.map((w) => (
                  <option key={w.weekKey} value={w.weekKey}>
                    {formatHebrewDate(parseDateKey(w.startDate))} -{" "}
                    {formatHebrewDate(parseDateKey(w.endDate))}
                  </option>
                ))}
              </select>
            </label>
          )}

          {rangeSource === "custom" && (
            <>
              <label className="flex flex-col gap-1 text-sm">
                מתאריך
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="rounded-lg border border-border px-3 py-2 text-sm"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                עד תאריך
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="rounded-lg border border-border px-3 py-2 text-sm"
                />
              </label>
            </>
          )}

          <label className="flex flex-col gap-1 text-sm">
            אופן ייצור
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as GenerateMode)}
              className="rounded-lg border border-border px-3 py-2 text-sm"
            >
              {Object.entries(MODE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <Button disabled={isPending} onClick={handleGenerate}>
            ייצור שיבוץ
          </Button>
          <Button variant="secondary" disabled={isPending} onClick={() => handlePublish(true)}>
            פרסום טווח זה
          </Button>
          <Button variant="ghost" disabled={isPending} onClick={() => handlePublish(false)}>
            ביטול פרסום
          </Button>
        </div>
        {genMessage && <p className="text-sm text-muted-foreground">{genMessage}</p>}
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4">
        <label className="flex flex-col gap-1 text-sm">
          תאריך
          <select
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
            className="rounded-lg border border-border px-3 py-2 text-sm"
          >
            <option value="">הכל</option>
            {availableDates.map((dk) => (
              <option key={dk} value={dk}>
                {formatHebrewDate(parseDateKey(dk))}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          תלמיד/ה
          <select
            value={filterStudent}
            onChange={(e) => setFilterStudent(e.target.value)}
            className="rounded-lg border border-border px-3 py-2 text-sm"
          >
            <option value="">הכל</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.fullName}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          סוג תורנות
          <select
            value={filterDuty}
            onChange={(e) => setFilterDuty(e.target.value)}
            className="rounded-lg border border-border px-3 py-2 text-sm"
          >
            <option value="">הכל</option>
            {dutyTypes.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <Button variant="secondary" onClick={() => setShowAddForm((v) => !v)}>
          {showAddForm ? "סגירה" : "+ שיבוץ ידני"}
        </Button>
      </div>

      {showAddForm && (
        <form
          onSubmit={handleAdd}
          className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4"
        >
          <label className="flex flex-col gap-1 text-sm">
            תאריך
            <input
              type="date"
              name="date"
              className="rounded-lg border border-border px-3 py-2 text-sm"
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            סוג תורנות
            <select
              name="dutyTypeId"
              className="rounded-lg border border-border px-3 py-2 text-sm"
              required
            >
              {dutyTypes.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            תלמיד/ה
            <select
              name="studentId"
              className="rounded-lg border border-border px-3 py-2 text-sm"
              required
            >
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.fullName}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" disabled={isPending}>
            הוספה
          </Button>
        </form>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-base">
          <thead>
            <tr className="border-b border-border bg-muted text-muted-foreground">
              <th className="px-4 py-3 text-right font-medium">יום</th>
              <th className="px-4 py-3 text-right font-medium">סוג תורנות</th>
              <th className="px-4 py-3 text-right font-medium">תלמיד/ה</th>
              <th className="px-4 py-3 text-right font-medium">מקור</th>
              <th className="px-4 py-3 text-right font-medium">פרסום</th>
              <th className="px-4 py-3 text-right font-medium">ביצוע</th>
              <th className="px-4 py-3 text-right font-medium">פעולות</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((a, i) => {
              const isNewDay = i === 0 || filtered[i - 1].dateKey !== a.dateKey;
              return (
                <Fragment key={a.id}>
                  {isNewDay && (
                    <tr key={`${a.dateKey}-header`} className="bg-secondary">
                      <td
                        colSpan={7}
                        className="px-4 py-2 text-sm font-bold text-secondary-foreground"
                      >
                        {formatHebrewWeekday(parseDateKey(a.dateKey))} ·{" "}
                        {formatHebrewDate(parseDateKey(a.dateKey))}
                      </td>
                    </tr>
                  )}
                  <tr key={a.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 text-card-foreground">
                      {formatHebrewWeekday(parseDateKey(a.dateKey))}
                    </td>
                    <td className="px-4 py-3 font-medium text-card-foreground">
                      {a.dutyTypeName}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        defaultValue={a.studentId}
                        disabled={isPending}
                        onChange={(e) => handleReassign(a.id, e.target.value)}
                        className="rounded-lg border border-border px-2 py-1.5 text-base"
                      >
                        {students.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.fullName}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          a.isManual
                            ? "bg-warning-muted text-warning"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {a.isManual ? "ידני" : "אוטומטי"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
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
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          a.isCompleted
                            ? "bg-success-muted text-success"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {a.isCompleted ? "בוצע" : "טרם בוצע"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Button
                        variant="danger"
                        className="!px-2 !py-1"
                        disabled={isPending}
                        onClick={() => handleDelete(a.id)}
                      >
                        מחיקה
                      </Button>
                    </td>
                  </tr>
                </Fragment>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                  אין שיבוצים התואמים את הסינון
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
