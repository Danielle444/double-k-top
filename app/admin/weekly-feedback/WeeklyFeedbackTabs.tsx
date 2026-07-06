"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Button } from "@/lib/components/Button";
import {
  createWeeklyFeedbackDraft,
  getWeeklyFeedbackDraftForAdmin,
  listWeeklyFeedbackForms,
  updateWeeklyFeedbackSchedule,
  type FeedbackQuestionTypeValue,
  type WeeklyFeedbackDraft,
  type WeeklyFeedbackFormListItem,
  type WeeklyFeedbackStatusValue,
} from "@/lib/actions/weekly-feedback";
import type { WeeklyScheduleOption } from "@/lib/actions/weekly-schedule";
import { formatHebrewDate, parseDateKey } from "@/lib/dates";

type Tab = "list" | "draft" | "schedule";

const TAB_LABELS: Record<Tab, string> = {
  list: "רשימת משובים",
  draft: "בניית טיוטה / צפייה בשאלות",
  schedule: "הגדרות פתיחה וסגירה",
};

const STATUS_LABELS: Record<WeeklyFeedbackStatusValue, string> = {
  DRAFT: "טיוטה",
  PUBLISHED: "פורסם",
  CLOSED: "סגור",
};

const STATUS_BADGE_CLASSES: Record<WeeklyFeedbackStatusValue, string> = {
  DRAFT: "bg-secondary text-secondary-foreground",
  PUBLISHED: "bg-success-muted text-success",
  CLOSED: "bg-muted text-muted-foreground",
};

const TYPE_LABELS: Record<FeedbackQuestionTypeValue, string> = {
  RATING_5: "דירוג 1–5",
  COMPARISON_3: "השוואה לשבוע שעבר (1–3)",
  FREE_TEXT: "טקסט חופשי",
};

function weekRangeLabel(startDate: string, endDate: string): string {
  return `${formatHebrewDate(parseDateKey(startDate))} - ${formatHebrewDate(parseDateKey(endDate))}`;
}

// datetime-local inputs work in the browser's own local time - converting
// with plain Date getters (not the UTC variants) here is intentional, since
// this runs client-side only.
function toDateTimeLocalValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function StatusBadge({ status }: { status: WeeklyFeedbackStatusValue }) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_BADGE_CLASSES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

export function WeeklyFeedbackTabs({
  initialForms,
  weeks,
}: {
  initialForms: WeeklyFeedbackFormListItem[];
  weeks: WeeklyScheduleOption[];
}) {
  const [tab, setTab] = useState<Tab>("list");
  const [forms, setForms] = useState(initialForms);
  const [selectedFormId, setSelectedFormId] = useState<string | null>(null);

  const [selectedWeekId, setSelectedWeekId] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);
  const [isCreatePending, startCreateTransition] = useTransition();

  const weeksWithoutForm = useMemo(
    () => weeks.filter((w) => !forms.some((f) => f.weeklyScheduleId === w.id)),
    [weeks, forms]
  );

  // Derived at render time instead of corrected via an effect: falls back to
  // the first still-available week whenever the raw selection is empty or no
  // longer in weeksWithoutForm (e.g. right after a draft was just created for
  // it) - both the <select> and handleCreateDraft use this, never the raw
  // selectedWeekId directly.
  const effectiveSelectedWeekId =
    selectedWeekId && weeksWithoutForm.some((w) => w.id === selectedWeekId)
      ? selectedWeekId
      : (weeksWithoutForm[0]?.id ?? "");

  async function refreshForms() {
    const fresh = await listWeeklyFeedbackForms();
    setForms(fresh);
  }

  function handleCreateDraft() {
    if (!effectiveSelectedWeekId) return;
    setCreateError(null);
    setCreateSuccess(null);
    startCreateTransition(async () => {
      const result = await createWeeklyFeedbackDraft(effectiveSelectedWeekId);
      if (!result.success) {
        setCreateError(result.error ?? "אירעה שגיאה");
        return;
      }
      await refreshForms();
      setCreateSuccess("הטיוטה נוצרה בהצלחה");
    });
  }

  function openForm(formId: string, target: Tab) {
    setSelectedFormId(formId);
    setTab(target);
  }

  const [draft, setDraft] = useState<WeeklyFeedbackDraft | null>(null);
  const [isDraftLoading, setIsDraftLoading] = useState(false);

  useEffect(() => {
    // selectedFormId only ever becomes non-null via openForm below - it's
    // never reset back to null in this UI, so there's no "cleared
    // selection" case to handle here; this guard exists purely for
    // TypeScript's benefit (getWeeklyFeedbackDraftForAdmin expects a string).
    if (!selectedFormId) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsDraftLoading(true);
    getWeeklyFeedbackDraftForAdmin(selectedFormId).then((result) => {
      if (!cancelled) {
        setDraft(result);
        setIsDraftLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [selectedFormId]);

  const [opensAtInput, setOpensAtInput] = useState("");
  const [closesAtInput, setClosesAtInput] = useState("");
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [scheduleSuccess, setScheduleSuccess] = useState<string | null>(null);
  const [isSchedulePending, startScheduleTransition] = useTransition();

  // Syncs the editable datetime-local input state from the asynchronously
  // loaded draft (opensAt/closesAt arrive from getWeeklyFeedbackDraftForAdmin
  // after this component has already rendered) - genuinely needed here since
  // there's nothing to derive at render time, unlike effectiveSelectedWeekId
  // above.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpensAtInput(toDateTimeLocalValue(draft?.opensAt ?? null));
    setClosesAtInput(toDateTimeLocalValue(draft?.closesAt ?? null));
    setScheduleError(null);
    setScheduleSuccess(null);
  }, [draft?.id, draft?.opensAt, draft?.closesAt]);

  function handleSaveSchedule() {
    if (!draft) return;
    setScheduleError(null);
    setScheduleSuccess(null);

    // Converting through `new Date(...)` here (in the browser) captures the
    // admin's own local time correctly regardless of which timezone the
    // server process runs in - the resulting ISO string is an unambiguous
    // absolute instant by the time it reaches updateWeeklyFeedbackSchedule.
    const opensAtIso = opensAtInput ? new Date(opensAtInput).toISOString() : null;
    const closesAtIso = closesAtInput ? new Date(closesAtInput).toISOString() : null;
    if (opensAtIso && closesAtIso && closesAtIso <= opensAtIso) {
      setScheduleError("תאריך הסגירה חייב להיות אחרי תאריך הפתיחה");
      return;
    }

    startScheduleTransition(async () => {
      const result = await updateWeeklyFeedbackSchedule(draft.id, opensAtIso, closesAtIso);
      if (!result.success) {
        setScheduleError(result.error ?? "אירעה שגיאה");
        return;
      }
      const fresh = await getWeeklyFeedbackDraftForAdmin(draft.id);
      setDraft(fresh);
      await refreshForms();
      setScheduleSuccess("ההגדרות נשמרו בהצלחה");
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-full px-4 py-2 text-sm font-medium ${
              tab === t ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            }`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {tab === "list" && (
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-border bg-card p-4">
            <h2 className="mb-3 text-base font-semibold text-card-foreground">יצירת טיוטה חדשה</h2>
            {weeks.length === 0 ? (
              <p className="text-sm text-muted-foreground">לא הועלה עדיין לו&quot;ז שבועי.</p>
            ) : weeksWithoutForm.length === 0 ? (
              <p className="text-sm text-muted-foreground">לכל השבועות הקיימים כבר נוצרה טיוטת משוב.</p>
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-3">
                <label className="flex flex-1 flex-col gap-1 text-sm">
                  שבוע
                  <select
                    value={effectiveSelectedWeekId}
                    onChange={(e) => setSelectedWeekId(e.target.value)}
                    className="w-full rounded-lg border border-border px-3 py-2 text-sm"
                  >
                    {weeksWithoutForm.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name} ({weekRangeLabel(w.startDate, w.endDate)})
                      </option>
                    ))}
                  </select>
                </label>
                <Button disabled={isCreatePending} onClick={handleCreateDraft}>
                  {isCreatePending ? "יוצר..." : "יצירת טיוטה"}
                </Button>
              </div>
            )}
            {createError && <p className="mt-2 text-sm text-danger">{createError}</p>}
            {createSuccess && <p className="mt-2 text-sm text-success">{createSuccess}</p>}
          </div>

          <div className="flex flex-col gap-3">
            {forms.length === 0 ? (
              <p className="rounded-xl border border-border bg-card p-5 text-center text-sm text-muted-foreground">
                אין עדיין משובים שבועיים.
              </p>
            ) : (
              forms.map((form) => (
                <div key={form.id} className="rounded-xl border border-border bg-card p-4">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <StatusBadge status={form.status} />
                    <p className="text-base font-bold text-card-foreground">{form.title}</p>
                  </div>
                  <p className="mb-2 text-xs text-muted-foreground">
                    {form.weekName} · {weekRangeLabel(form.weekStartDate, form.weekEndDate)}
                  </p>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="text-muted-foreground">
                      {form.questionCount} שאלות · הגישו {form.responseCount} מתוך{" "}
                      {form.activeStudentCount} חניכים
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="ghost"
                        className="!px-2 !py-1"
                        onClick={() => openForm(form.id, "draft")}
                      >
                        צפייה בשאלות
                      </Button>
                      <Button
                        variant="ghost"
                        className="!px-2 !py-1"
                        onClick={() => openForm(form.id, "schedule")}
                      >
                        הגדרות פתיחה/סגירה
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {tab === "draft" && (
        <div className="flex flex-col gap-3">
          {!selectedFormId ? (
            <p className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
              לא נבחר משוב. יש לבחור משוב מתוך &quot;רשימת משובים&quot;.
            </p>
          ) : isDraftLoading || !draft ? (
            <p className="text-sm text-muted-foreground">טוען...</p>
          ) : (
            <>
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <StatusBadge status={draft.status} />
                  <p className="text-base font-bold text-card-foreground">{draft.title}</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  {draft.weekName} · {weekRangeLabel(draft.weekStartDate, draft.weekEndDate)}
                </p>
              </div>

              <div className="flex flex-col gap-3">
                {Object.entries(
                  draft.questions.reduce<Record<string, typeof draft.questions>>((acc, q) => {
                    (acc[q.section] ??= []).push(q);
                    return acc;
                  }, {})
                ).map(([section, questions]) => (
                  <div key={section} className="rounded-xl border border-border bg-card p-4">
                    <h3 className="mb-2 text-sm font-bold text-card-foreground">{section}</h3>
                    <div className="flex flex-col gap-1">
                      {questions.map((q) => (
                        <div
                          key={q.id}
                          className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-1.5 text-sm last:border-0"
                        >
                          <span className="text-card-foreground">{q.prompt}</span>
                          <span className="text-xs text-muted-foreground">{TYPE_LABELS[q.type]}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {tab === "schedule" && (
        <div className="flex flex-col gap-3">
          {!selectedFormId ? (
            <p className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
              לא נבחר משוב. יש לבחור משוב מתוך &quot;רשימת משובים&quot;.
            </p>
          ) : isDraftLoading || !draft ? (
            <p className="text-sm text-muted-foreground">טוען...</p>
          ) : (
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <StatusBadge status={draft.status} />
                <p className="text-base font-bold text-card-foreground">{draft.title}</p>
              </div>
              {draft.status === "CLOSED" ? (
                <p className="text-sm text-muted-foreground">
                  המשוב סגור - לא ניתן לעדכן את חלון הזמינות.
                </p>
              ) : (
                <div className="flex flex-col gap-3">
                  <label className="flex flex-col gap-1 text-sm">
                    פתיחה למילוי
                    <input
                      type="datetime-local"
                      value={opensAtInput}
                      onChange={(e) => setOpensAtInput(e.target.value)}
                      className="w-full rounded-lg border border-border px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    סגירה למילוי
                    <input
                      type="datetime-local"
                      value={closesAtInput}
                      onChange={(e) => setClosesAtInput(e.target.value)}
                      className="w-full rounded-lg border border-border px-3 py-2 text-sm"
                    />
                  </label>
                  {scheduleError && <p className="text-sm text-danger">{scheduleError}</p>}
                  {scheduleSuccess && <p className="text-sm text-success">{scheduleSuccess}</p>}
                  <Button disabled={isSchedulePending} onClick={handleSaveSchedule} className="self-start">
                    {isSchedulePending ? "שומר..." : "שמירה"}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
