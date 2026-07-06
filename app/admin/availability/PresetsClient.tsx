"use client";

import { FormEvent, useState, useTransition } from "react";
import { Button } from "@/lib/components/Button";
import {
  applyPresetToStudents,
  createAvailabilityPreset,
  deleteAvailabilityPreset,
} from "@/lib/actions/availability-presets";
import { formatHebrewDate, parseDateKey } from "@/lib/dates";

interface PresetRow {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
}

interface StudentOption {
  id: string;
  fullName: string;
}

export function PresetsClient({
  presets,
  students,
}: {
  presets: PresetRow[];
  students: StudentOption[];
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(new Set());
  const [selectedPresetId, setSelectedPresetId] = useState("");

  function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await createAvailabilityPreset(formData);
      if (!result.success) {
        setError(result.error ?? "אירעה שגיאה");
        return;
      }
      (e.target as HTMLFormElement).reset();
    });
  }

  function handleDelete(presetId: string) {
    startTransition(async () => {
      await deleteAvailabilityPreset(presetId);
    });
  }

  function toggleStudent(id: string) {
    setSelectedStudentIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleApply() {
    if (!selectedPresetId || selectedStudentIds.size === 0) return;
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await applyPresetToStudents(
        selectedPresetId,
        Array.from(selectedStudentIds)
      );
      if (!result.success) {
        setError(result.error ?? "אירעה שגיאה");
        return;
      }
      setMessage(`הזמינות עודכנה עבור ${selectedStudentIds.size} חניכים`);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <form
        onSubmit={handleCreate}
        className="flex flex-wrap items-end gap-3 rounded-lg bg-muted p-3"
      >
        <label className="flex flex-col gap-1 text-sm">
          שם הפריסט
          <input
            name="name"
            required
            className="rounded-lg border border-border px-3 py-2 text-sm"
            placeholder='למשל: "שבועיים ראשונים"'
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          מתאריך
          <input
            type="date"
            name="startDate"
            required
            className="rounded-lg border border-border px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          עד תאריך
          <input
            type="date"
            name="endDate"
            required
            className="rounded-lg border border-border px-3 py-2 text-sm"
          />
        </label>
        <Button type="submit" disabled={isPending}>
          + הוספת פריסט
        </Button>
      </form>

      {presets.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {presets.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-sm"
            >
              <span className="font-medium text-card-foreground">{p.name}</span>
              <span className="text-xs text-muted-foreground">
                {formatHebrewDate(parseDateKey(p.startDate))} -{" "}
                {formatHebrewDate(parseDateKey(p.endDate))}
              </span>
              <button
                type="button"
                onClick={() => handleDelete(p.id)}
                className="text-muted-foreground hover:text-danger"
                aria-label="מחיקת פריסט"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {presets.length > 0 && students.length > 0 && (
        <div className="rounded-lg border border-border p-3">
          <p className="mb-2 text-sm font-medium text-card-foreground">
            החלת פריסט על מספר חניכים
          </p>
          <div className="mb-3 flex max-h-40 flex-wrap gap-2 overflow-y-auto">
            {students.map((s) => (
              <label
                key={s.id}
                className="flex items-center gap-1 rounded-full border border-border px-2 py-1 text-xs"
              >
                <input
                  type="checkbox"
                  checked={selectedStudentIds.has(s.id)}
                  onChange={() => toggleStudent(s.id)}
                />
                {s.fullName}
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedPresetId}
              onChange={(e) => setSelectedPresetId(e.target.value)}
              className="rounded-lg border border-border px-3 py-2 text-sm"
            >
              <option value="">בחרו פריסט</option>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <Button
              type="button"
              disabled={isPending || !selectedPresetId || selectedStudentIds.size === 0}
              onClick={handleApply}
            >
              החלת זמינות
            </Button>
          </div>
          {error && <p className="mt-2 text-sm text-danger">{error}</p>}
          {message && <p className="mt-2 text-sm text-success">{message}</p>}
        </div>
      )}
    </div>
  );
}
