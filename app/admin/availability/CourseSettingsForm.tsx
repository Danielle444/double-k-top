"use client";

import { FormEvent, useState, useTransition } from "react";
import { Button } from "@/lib/components/Button";
import { updateCourseSettings } from "@/lib/actions/course-settings";

export function CourseSettingsForm({
  startDate,
  endDate,
}: {
  startDate: string;
  endDate: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await updateCourseSettings(formData);
      if (!result.success) {
        setError(result.error ?? "אירעה שגיאה");
        return;
      }
      setSaved(true);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-sm">
        תאריך התחלה
        <input
          type="date"
          name="startDate"
          defaultValue={startDate}
          className="rounded-lg border border-border px-3 py-2 text-sm"
          required
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        תאריך סיום
        <input
          type="date"
          name="endDate"
          defaultValue={endDate}
          className="rounded-lg border border-border px-3 py-2 text-sm"
          required
        />
      </label>
      <Button type="submit" disabled={isPending}>
        {isPending ? "שומר..." : "שמירה"}
      </Button>
      {error && <p className="text-sm text-danger">{error}</p>}
      {saved && !error && <p className="text-sm text-success">נשמר בהצלחה</p>}
    </form>
  );
}
