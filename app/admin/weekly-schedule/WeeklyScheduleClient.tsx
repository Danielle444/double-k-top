"use client";

import { FormEvent, useMemo, useState, useTransition } from "react";
import { Button } from "@/lib/components/Button";
import { Modal } from "@/lib/components/Modal";
import {
  commitWeeklySchedule,
  confirmDayPlanSuggestions,
  deleteWeeklySchedule,
  parseWeeklyScheduleExcel,
  suggestDayPlanFromSchedule,
  type DayPlanSuggestion,
  type ScheduleImportItem,
} from "@/lib/actions/weekly-schedule";
import { runGenerateSchedule, setPublishStatus } from "@/lib/actions/schedule";
import { formatHebrewDate, formatHebrewWeekday, parseDateKey } from "@/lib/dates";
import type { GenerateMode } from "@/lib/scheduler";

interface ScheduleItemView {
  id: string;
  dateKey: string;
  startTime: string;
  endTime: string;
  title: string;
  description: string | null;
  groupName: string | null;
  instructorName: string | null;
  location: string | null;
}

interface WeeklyScheduleView {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  uploadedFileName: string;
  items: ScheduleItemView[];
}

const MODE_LABELS: Record<GenerateMode, string> = {
  fillMissing: "השלמת חוסרים בלבד",
  regeneratePreserveManual: "ייצור מחדש, שמירה על שיבוצים ידניים",
  clearAndRegenerate: "מחיקה וייצור מחדש מלא",
};

export function WeeklyScheduleClient({
  weeklySchedules,
}: {
  weeklySchedules: WeeklyScheduleView[];
}) {
  const [isPending, startTransition] = useTransition();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadTarget, setUploadTarget] = useState<WeeklyScheduleView | null>(null);
  const [parsedItems, setParsedItems] = useState<ScheduleImportItem[] | null>(null);
  const [weekName, setWeekName] = useState("");
  const [weekStart, setWeekStart] = useState("");
  const [weekEnd, setWeekEnd] = useState("");
  const [uploadedFileName, setUploadedFileName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [parseWarning, setParseWarning] = useState<string | null>(null);

  const [detailWeekId, setDetailWeekId] = useState<string | null>(null);
  const [detailGroupFilter, setDetailGroupFilter] = useState<"all" | string>("all");

  const [suggestWeekId, setSuggestWeekId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<DayPlanSuggestion[] | null>(null);

  function openUpload(target: WeeklyScheduleView | null) {
    setUploadTarget(target);
    setWeekName(target?.name ?? "");
    setWeekStart(target?.startDate ?? "");
    setWeekEnd(target?.endDate ?? "");
    setUploadedFileName("");
    setParsedItems(null);
    setError(null);
    setSummary(null);
    setParseWarning(null);
    setUploadOpen(true);
  }

  function handleParse(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setParseWarning(null);
    const formData = new FormData(e.currentTarget);
    const file = formData.get("file");
    if (file instanceof File) setUploadedFileName(file.name);
    startTransition(async () => {
      const result = await parseWeeklyScheduleExcel(formData);
      if (!result.success || !result.items) {
        setError(result.error ?? "אירעה שגיאה");
        return;
      }
      setParsedItems(result.items);
      setParseWarning(result.warning ?? null);
    });
  }

  function updateItem(key: string, patch: Partial<ScheduleImportItem>) {
    setParsedItems((prev) =>
      prev ? prev.map((i) => (i.key === key ? { ...i, ...patch } : i)) : prev
    );
  }

  function handleCommit() {
    if (!parsedItems) return;
    if (!weekName.trim() || !weekStart || !weekEnd) {
      setError("יש למלא שם וטווח תאריכים לשבוע");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await commitWeeklySchedule({
        weeklyScheduleId: uploadTarget?.id,
        name: weekName,
        startDate: weekStart,
        endDate: weekEnd,
        uploadedFileName: uploadedFileName || uploadTarget?.uploadedFileName || "",
        items: parsedItems,
      });
      if (!result.success) {
        setError(result.error ?? "אירעה שגיאה בשמירה");
        return;
      }
      setSummary(
        `נשמרו ${result.savedCount} פריטים` +
          (result.skippedCount > 0 ? `, דולגו ${result.skippedCount} שורות ללא תאריך תקין` : "")
      );
      setParsedItems(null);
      if (result.weeklyScheduleId) {
        setSuggestWeekId(result.weeklyScheduleId);
      }
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      await deleteWeeklySchedule(id);
    });
  }

  function openSuggestions(weekId: string) {
    setError(null);
    setSuggestWeekId(weekId);
    startTransition(async () => {
      const result = await suggestDayPlanFromSchedule(weekId);
      if (!result.success || !result.suggestions) {
        setError(result.error ?? "לא ניתן היה להציע ערכים");
        setSuggestions([]);
        return;
      }
      setSuggestions(result.suggestions);
    });
  }

  function updateSuggestion(dk: string, patch: Partial<DayPlanSuggestion>) {
    setSuggestions((prev) =>
      prev ? prev.map((s) => (s.dateKey === dk ? { ...s, ...patch } : s)) : prev
    );
  }

  function handleConfirmSuggestions() {
    if (!suggestions) return;
    startTransition(async () => {
      await confirmDayPlanSuggestions(suggestions);
      setSuggestWeekId(null);
      setSuggestions(null);
    });
  }

  const detailWeek = weeklySchedules.find((w) => w.id === detailWeekId) ?? null;
  const detailGroups = useMemo(() => {
    if (!detailWeek) return [];
    return Array.from(
      new Set(detailWeek.items.map((i) => i.groupName).filter((g): g is string => Boolean(g)))
    ).sort();
  }, [detailWeek]);
  const detailItems = useMemo(() => {
    if (!detailWeek) return [];
    return detailWeek.items
      .filter(
        (i) =>
          detailGroupFilter === "all" || !i.groupName || i.groupName === detailGroupFilter
      )
      .sort((a, b) => (a.dateKey + a.startTime).localeCompare(b.dateKey + b.startTime));
  }, [detailWeek, detailGroupFilter]);

  const detailItemsByDay = useMemo(() => {
    const map = new Map<string, ScheduleItemView[]>();
    for (const item of detailItems) {
      if (!map.has(item.dateKey)) map.set(item.dateKey, []);
      map.get(item.dateKey)!.push(item);
    }
    return Array.from(map.entries());
  }, [detailItems]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button onClick={() => openUpload(null)}>+ העלאת לו&quot;ז לשבוע חדש</Button>
      </div>

      <div className="flex flex-col gap-3">
        {weeklySchedules.map((week) => (
          <WeekCard
            key={week.id}
            week={week}
            onView={() => {
              setDetailWeekId(week.id);
              setDetailGroupFilter("all");
            }}
            onReplace={() => openUpload(week)}
            onDelete={() => handleDelete(week.id)}
            onSuggest={() => openSuggestions(week.id)}
          />
        ))}
        {weeklySchedules.length === 0 && (
          <p className="text-sm text-muted-foreground">טרם הועלה לו&quot;ז לאף שבוע.</p>
        )}
      </div>

      <Modal
        open={uploadOpen}
        title={uploadTarget ? `החלפת לו"ז - ${uploadTarget.name}` : 'העלאת לו"ז חדש'}
        onClose={() => setUploadOpen(false)}
      >
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm">
              שם השבוע
              <input
                value={weekName}
                onChange={(e) => setWeekName(e.target.value)}
                className="rounded-lg border border-border px-2 py-1 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              מתאריך
              <input
                type="date"
                value={weekStart}
                onChange={(e) => setWeekStart(e.target.value)}
                className="rounded-lg border border-border px-2 py-1 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              עד תאריך
              <input
                type="date"
                value={weekEnd}
                onChange={(e) => setWeekEnd(e.target.value)}
                className="rounded-lg border border-border px-2 py-1 text-sm"
              />
            </label>
          </div>

          {!parsedItems && (
            <form onSubmit={handleParse} className="flex flex-col gap-3">
              <input
                type="file"
                name="file"
                accept=".xlsx"
                required
                className="rounded-lg border border-border px-3 py-2 text-sm"
              />
              {error && <p className="text-sm text-danger">{error}</p>}
              <Button type="submit" disabled={isPending}>
                {isPending ? "מפענח..." : "פענוח קובץ"}
              </Button>
            </form>
          )}

          {parsedItems && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                נמצאו {parsedItems.length} פריטים. שורות ללא תאריך תקין מסומנות וניתן לתקן
                ידנית, אחרת ידולגו בשמירה.
              </p>
              {parseWarning && (
                <div className="rounded-lg bg-warning-muted p-3 text-sm text-warning">
                  {parseWarning}
                </div>
              )}
              <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
                {parsedItems.map((item) => (
                  <div key={item.key} className="border-b border-border p-2 last:border-0">
                    {item.needsReview && (
                      <span className="mb-1 inline-block rounded-full bg-warning-muted px-2 py-0.5 text-xs font-medium text-warning">
                        דורש בדיקה
                      </span>
                    )}
                    <div className="mb-1 grid grid-cols-2 gap-1 sm:grid-cols-4">
                      <input
                        type="date"
                        value={item.dateKey ?? ""}
                        onChange={(e) => updateItem(item.key, { dateKey: e.target.value || null })}
                        className={`rounded border px-1 py-0.5 text-xs ${
                          item.dateKey ? "border-border" : "border-danger"
                        }`}
                      />
                      <input
                        value={item.startTime}
                        onChange={(e) => updateItem(item.key, { startTime: e.target.value })}
                        placeholder="שעת התחלה"
                        className="rounded border border-border px-1 py-0.5 text-xs"
                      />
                      <input
                        value={item.endTime}
                        onChange={(e) => updateItem(item.key, { endTime: e.target.value })}
                        placeholder="שעת סיום"
                        className="rounded border border-border px-1 py-0.5 text-xs"
                      />
                      <input
                        value={item.groupName}
                        onChange={(e) => updateItem(item.key, { groupName: e.target.value })}
                        placeholder="קבוצה (ריק = שתי הקבוצות)"
                        className="rounded border border-border px-1 py-0.5 text-xs"
                      />
                    </div>
                    <input
                      value={item.title}
                      onChange={(e) => updateItem(item.key, { title: e.target.value })}
                      placeholder="כותרת"
                      className="mb-1 w-full rounded border border-border px-1 py-0.5 text-xs font-medium"
                    />
                    <div className="mb-1 grid grid-cols-2 gap-1">
                      <input
                        value={item.instructorName}
                        onChange={(e) =>
                          updateItem(item.key, { instructorName: e.target.value })
                        }
                        placeholder="מדריך/ה"
                        className="rounded border border-border px-1 py-0.5 text-xs"
                      />
                      <input
                        value={item.location}
                        onChange={(e) => updateItem(item.key, { location: e.target.value })}
                        placeholder="מיקום"
                        className="rounded border border-border px-1 py-0.5 text-xs"
                      />
                    </div>
                    <textarea
                      value={item.rawText}
                      onChange={(e) => updateItem(item.key, { rawText: e.target.value })}
                      placeholder="שורה מקורית"
                      rows={1}
                      className="w-full rounded border border-border px-1 py-0.5 text-xs text-muted-foreground"
                    />
                  </div>
                ))}
              </div>
              {error && <p className="text-sm text-danger">{error}</p>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setParsedItems(null)}>
                  ביטול
                </Button>
                <Button type="button" onClick={handleCommit} disabled={isPending}>
                  {isPending ? "שומר..." : "שמירת הלו\"ז"}
                </Button>
              </div>
            </div>
          )}

          {summary && <p className="text-sm text-success">{summary}</p>}
        </div>
      </Modal>

      <Modal
        open={detailWeek !== null}
        title={detailWeek ? `לו"ז - ${detailWeek.name}` : ""}
        onClose={() => setDetailWeekId(null)}
      >
        {detailWeek && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setDetailGroupFilter("all")}
                className={`rounded-full px-3 py-1 text-xs ${
                  detailGroupFilter === "all" ? "bg-primary text-primary-foreground" : "bg-muted"
                }`}
              >
                שתי הקבוצות
              </button>
              {detailGroups.map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setDetailGroupFilter(g)}
                  className={`rounded-full px-3 py-1 text-xs ${
                    detailGroupFilter === g ? "bg-primary text-primary-foreground" : "bg-muted"
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>
            <div className="max-h-96 overflow-y-auto">
              {detailItemsByDay.map(([dk, items]) => (
                <div key={dk} className="mb-4">
                  <div className="mb-2 rounded-lg bg-secondary px-3 py-2 text-sm font-bold text-secondary-foreground">
                    {formatHebrewWeekday(parseDateKey(dk))} · {formatHebrewDate(parseDateKey(dk))}
                  </div>
                  <div className="flex flex-col gap-2">
                    {items.map((item) => (
                      <div key={item.id} className="rounded-lg border border-border p-3">
                        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-card-foreground">
                            {item.startTime}-{item.endTime}
                          </span>
                          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                            {item.groupName ? `קבוצה ${item.groupName}` : "שתי הקבוצות"}
                          </span>
                        </div>
                        <p className="text-base font-medium text-card-foreground">{item.title}</p>
                        {item.instructorName && (
                          <p className="text-xs text-muted-foreground">
                            מדריך/ה: {item.instructorName}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {detailItems.length === 0 && (
                <p className="py-4 text-center text-sm text-muted-foreground">אין פריטים</p>
              )}
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={suggestWeekId !== null}
        title='הצעת ערכי תכנון קבוצות יומי'
        onClose={() => {
          setSuggestWeekId(null);
          setSuggestions(null);
        }}
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            הצעה בלבד, על בסיס פענוח מיטבי של הלו&quot;ז. בדקו ותקנו לפני האישור - שום דבר
            לא נשמר לפני לחיצה על &quot;אישור וכתיבה&quot;.
          </p>
          {suggestions === null && <p className="text-sm text-muted-foreground">טוען...</p>}
          {suggestions && suggestions.length === 0 && (
            <p className="text-sm text-muted-foreground">אין הצעות לשבוע זה.</p>
          )}
          {suggestions && suggestions.length > 0 && (
            <div className="max-h-80 overflow-y-auto rounded-lg border border-border">
              {suggestions.map((s) => (
                <div key={s.dateKey} className="border-b border-border p-2 last:border-0">
                  <p className="mb-1 text-xs font-medium text-card-foreground">
                    {formatHebrewDate(parseDateKey(s.dateKey))}
                  </p>
                  <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
                    <input
                      value={s.firstMorningGroup ?? ""}
                      onChange={(e) =>
                        updateSuggestion(s.dateKey, { firstMorningGroup: e.target.value || null })
                      }
                      placeholder="בוקר 1"
                      className="rounded border border-border px-1 py-0.5 text-xs"
                    />
                    <input
                      value={s.secondMorningGroup ?? ""}
                      onChange={(e) =>
                        updateSuggestion(s.dateKey, { secondMorningGroup: e.target.value || null })
                      }
                      placeholder="בוקר 2"
                      className="rounded border border-border px-1 py-0.5 text-xs"
                    />
                    <input
                      value={s.firstAfterLunchGroup ?? ""}
                      onChange={(e) =>
                        updateSuggestion(s.dateKey, {
                          firstAfterLunchGroup: e.target.value || null,
                        })
                      }
                      placeholder='אחה"צ 1'
                      className="rounded border border-border px-1 py-0.5 text-xs"
                    />
                    <input
                      value={s.secondAfterLunchGroup ?? ""}
                      onChange={(e) =>
                        updateSuggestion(s.dateKey, {
                          secondAfterLunchGroup: e.target.value || null,
                        })
                      }
                      placeholder='אחה"צ 2'
                      className="rounded border border-border px-1 py-0.5 text-xs"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setSuggestWeekId(null);
                setSuggestions(null);
              }}
            >
              סגירה
            </Button>
            {suggestions && suggestions.length > 0 && (
              <Button type="button" onClick={handleConfirmSuggestions} disabled={isPending}>
                אישור וכתיבה לתכנון הקבוצות
              </Button>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}

function WeekCard({
  week,
  onView,
  onReplace,
  onDelete,
  onSuggest,
}: {
  week: WeeklyScheduleView;
  onView: () => void;
  onReplace: () => void;
  onDelete: () => void;
  onSuggest: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [mode, setMode] = useState<GenerateMode>("regeneratePreserveManual");
  const [message, setMessage] = useState<string | null>(null);

  function handleGenerate() {
    setMessage(null);
    startTransition(async () => {
      const result = await runGenerateSchedule({
        startDate: parseDateKey(week.startDate),
        endDate: parseDateKey(week.endDate),
        mode,
      });
      if (!result.success) {
        setMessage(result.error ?? "אירעה שגיאה");
        return;
      }
      setMessage(`נוצרו ${result.assignedCount} שיבוצים (טיוטה)`);
    });
  }

  function handlePublish(isPublished: boolean) {
    setMessage(null);
    startTransition(async () => {
      await setPublishStatus(parseDateKey(week.startDate), parseDateKey(week.endDate), isPublished);
      setMessage(isPublished ? "השבוע פורסם" : "פרסום השבוע בוטל");
    });
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-bold text-card-foreground">{week.name}</p>
          <p className="text-xs text-muted-foreground">
            {formatHebrewDate(parseDateKey(week.startDate))} -{" "}
            {formatHebrewDate(parseDateKey(week.endDate))} · {week.items.length} פריטי לו&quot;ז ·{" "}
            {week.uploadedFileName}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" className="!px-2 !py-1" onClick={onView}>
            צפייה בלו&quot;ז
          </Button>
          <Button variant="ghost" className="!px-2 !py-1" onClick={onSuggest}>
            הצעת תכנון קבוצות
          </Button>
          <Button variant="secondary" className="!px-2 !py-1" onClick={onReplace}>
            החלפת קובץ
          </Button>
          <Button variant="danger" className="!px-2 !py-1" onClick={onDelete}>
            מחיקה
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as GenerateMode)}
          className="rounded-lg border border-border px-2 py-1 text-xs"
        >
          {Object.entries(MODE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <Button className="!px-2 !py-1" disabled={isPending} onClick={handleGenerate}>
          יצירת שיבוץ תורנויות לשבוע זה
        </Button>
        <Button
          variant="secondary"
          className="!px-2 !py-1"
          disabled={isPending}
          onClick={() => handlePublish(true)}
        >
          פרסום השבוע
        </Button>
        <Button
          variant="ghost"
          className="!px-2 !py-1"
          disabled={isPending}
          onClick={() => handlePublish(false)}
        >
          ביטול פרסום
        </Button>
        {message && <span className="text-xs text-muted-foreground">{message}</span>}
      </div>
    </div>
  );
}
