"use client";

import { useState, useTransition } from "react";
import { runGenerateSchedule } from "@/lib/actions/schedule";
import { Button } from "@/lib/components/Button";

export function GenerateScheduleButton() {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setMessage(null);
    setError(null);
    setWarnings([]);
    startTransition(async () => {
      const result = await runGenerateSchedule();
      if (!result.success) {
        setError(result.error ?? "אירעה שגיאה");
        return;
      }
      setMessage(
        `נוצרו ${result.assignedCount} שיבוצים עבור ${result.daysProcessed} ימים`
      );
      setWarnings(result.warnings ?? []);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <Button onClick={handleClick} disabled={isPending}>
        {isPending ? "מייצר שיבוץ..." : "ייצור שיבוץ אוטומטי"}
      </Button>
      {error && <p className="text-sm text-danger">{error}</p>}
      {message && <p className="text-sm text-success">{message}</p>}
      {warnings.length > 0 && (
        <div className="rounded-lg bg-warning-muted p-3 text-sm text-warning">
          <p className="mb-1 font-medium">אזהרות:</p>
          <ul className="list-inside list-disc space-y-0.5">
            {warnings.slice(0, 20).map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
          {warnings.length > 20 && (
            <p className="mt-1 text-xs">ועוד {warnings.length - 20} אזהרות נוספות...</p>
          )}
        </div>
      )}
    </div>
  );
}
