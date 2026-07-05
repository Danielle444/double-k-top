"use client";

import { FormEvent, useEffect, useState, useTransition } from "react";
import { Button } from "@/lib/components/Button";
import { Logo } from "@/lib/components/Logo";
import { WeekDayPicker, type WeekOption } from "@/lib/components/WeekDayPicker";
import {
  searchStudents,
  verifyStudentLogin,
  type StudentSearchResult,
} from "@/lib/actions/auth";
import { getWeeklyScheduleSelection } from "@/lib/actions/weekly-schedule";
import { ScheduleSection } from "@/app/student/ScheduleSection";
import { DutiesSection } from "@/app/student/DutiesSection";

const STORAGE_KEY = "duty-manager-student";

interface StoredSession {
  id: string;
  fullName: string;
  groupName: string | null;
}

export function StudentClient() {
  const [session, setSession] = useState<StoredSession | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StudentSearchResult[]>([]);
  const [selected, setSelected] = useState<StudentSearchResult | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);

  const [weeks, setWeeks] = useState<WeekOption[] | null>(null);
  const [selectedWeekId, setSelectedWeekId] = useState<string | null>(null);
  const [dayFilter, setDayFilter] = useState<string | "all">("all");

  useEffect(() => {
    // One-time sync from localStorage (an external system unavailable during
    // SSR) into React state on mount - not a subscription, so this must run
    // in an effect rather than a lazy useState initializer.
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSession(JSON.parse(raw));
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    getWeeklyScheduleSelection().then((sel) => {
      if (cancelled) return;
      setWeeks(sel.weeks);
      setSelectedWeekId(sel.defaultWeekId);
    });
    return () => {
      cancelled = true;
    };
  }, [session]);

  useEffect(() => {
    if (selected || query.trim().length < 2) return;
    const timeout = setTimeout(() => {
      startTransition(async () => {
        const found = await searchStudents(query);
        setResults(found);
      });
    }, 250);
    return () => clearTimeout(timeout);
  }, [query, selected]);

  const visibleResults = selected || query.trim().length < 2 ? [] : results;

  function handleLogin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selected) return;
    setLoginError(null);
    const formData = new FormData(e.currentTarget);
    const identityNumber = String(formData.get("identityNumber"));
    startTransition(async () => {
      const result = await verifyStudentLogin(selected.id, identityNumber);
      if (!result.success || !result.student) {
        setLoginError(result.error ?? "מספר תעודת זהות שגוי");
        return;
      }
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(result.student));
      setSession(result.student);
    });
  }

  function handleSwitchStudent() {
    window.localStorage.removeItem(STORAGE_KEY);
    setSession(null);
    setSelected(null);
    setQuery("");
  }

  if (!hydrated) return null;

  if (!session) {
    return (
      <div className="flex flex-col items-center gap-6">
        <Logo width={220} />
        <p className="-mt-4 text-sm font-semibold text-muted-foreground">אזור חניכים</p>
        <div className="w-full rounded-2xl border border-border bg-card p-6">
          <h1 className="mb-1 text-2xl font-bold text-card-foreground">כניסת תלמיד/ה</h1>
          <p className="mb-4 text-base text-muted-foreground">
            הקלידו את שמכם ובחרו אותו מהרשימה
          </p>

          {!selected ? (
            <div className="flex flex-col gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="הקלידו שם..."
                className="rounded-xl border border-border px-4 py-3 text-base"
                autoFocus
              />
              {visibleResults.length > 0 && (
                <ul className="overflow-hidden rounded-xl border border-border">
                  {visibleResults.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelected(s);
                          setLoginError(null);
                        }}
                        className="w-full px-4 py-3 text-right text-base hover:bg-muted"
                      >
                        {s.fullName}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <form onSubmit={handleLogin} className="flex flex-col gap-3">
              <div className="flex items-center justify-between rounded-xl bg-muted px-4 py-3 text-base">
                <span className="font-medium text-card-foreground">{selected.fullName}</span>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="text-sm text-muted-foreground underline"
                >
                  שינוי
                </button>
              </div>
              <label className="flex flex-col gap-1 text-base">
                מספר תעודת זהות
                <input
                  name="identityNumber"
                  inputMode="numeric"
                  required
                  autoFocus
                  className="rounded-xl border border-border px-4 py-3 text-base"
                />
              </label>
              {loginError && <p className="text-base text-danger">{loginError}</p>}
              <Button type="submit" disabled={isPending} className="!py-3 !text-base">
                {isPending ? "מתחבר/ת..." : "כניסה"}
              </Button>
            </form>
          )}
        </div>
      </div>
    );
  }

  const selectedWeek = weeks?.find((w) => w.id === selectedWeekId) ?? null;
  const rangeStart = selectedWeek
    ? dayFilter === "all"
      ? selectedWeek.startDate
      : dayFilter
    : null;
  const rangeEnd = selectedWeek ? (dayFilter === "all" ? selectedWeek.endDate : dayFilter) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-muted-foreground">אזור חניכים</p>
          <h1 className="text-2xl font-bold text-card-foreground">שלום, {session.fullName}</h1>
        </div>
        <button
          onClick={handleSwitchStudent}
          className="text-sm text-muted-foreground underline hover:text-card-foreground"
        >
          החלפת תלמיד/ה
        </button>
      </div>

      {weeks === null ? (
        <p className="text-base text-muted-foreground">טוען...</p>
      ) : (
        <WeekDayPicker
          weeks={weeks}
          selectedWeekId={selectedWeekId}
          onSelectWeek={(id) => {
            setSelectedWeekId(id);
            setDayFilter("all");
          }}
          dayFilter={dayFilter}
          onSelectDay={setDayFilter}
        />
      )}

      <DutiesSection studentId={session.id} startDateKey={rangeStart} endDateKey={rangeEnd} />

      <ScheduleSection
        studentId={session.id}
        weeklyScheduleId={selectedWeekId}
        dayFilter={dayFilter}
      />
    </div>
  );
}
