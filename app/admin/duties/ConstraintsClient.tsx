"use client";

import { FormEvent, useState, useTransition } from "react";
import { Button } from "@/lib/components/Button";
import {
  createDutyConstraint,
  deleteDutyConstraint,
  setDutyConstraintActive,
} from "@/lib/actions/constraints";

const SLOT_LABELS: Record<string, string> = {
  FIRST_MORNING: "רכיבה ראשונה - בוקר",
  SECOND_MORNING: "רכיבה שנייה - בוקר",
  FIRST_AFTER_LUNCH: 'רכיבה ראשונה - אחה"צ',
  SECOND_AFTER_LUNCH: 'רכיבה שנייה - אחה"צ',
};

interface DutyTypeOption {
  id: string;
  name: string;
}

interface ConstraintRow {
  id: string;
  dutyTypeName: string;
  slot: string;
  note: string | null;
  isActive: boolean;
}

export function ConstraintsClient({
  dutyTypes,
  constraints,
}: {
  dutyTypes: DutyTypeOption[];
  constraints: ConstraintRow[];
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await createDutyConstraint(formData);
      if (!result.success) {
        setError(result.error ?? "אירעה שגיאה");
        return;
      }
      (e.target as HTMLFormElement).reset();
    });
  }

  function handleToggle(row: ConstraintRow) {
    startTransition(async () => {
      await setDutyConstraintActive(row.id, !row.isActive);
    });
  }

  function handleDelete(row: ConstraintRow) {
    startTransition(async () => {
      await deleteDutyConstraint(row.id);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <form
        onSubmit={handleSubmit}
        className="flex flex-wrap items-end gap-3 rounded-lg bg-muted p-3"
      >
        <label className="flex flex-col gap-1 text-sm">
          סוג תורנות
          <select
            name="dutyTypeId"
            required
            className="rounded-lg border border-border px-3 py-2 text-sm"
          >
            {dutyTypes.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          חסימה עבור קבוצה שרוכבת ב-
          <select
            name="slot"
            required
            className="rounded-lg border border-border px-3 py-2 text-sm"
          >
            {Object.entries(SLOT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          הערה (אופציונלי)
          <input name="note" className="rounded-lg border border-border px-3 py-2 text-sm" />
        </label>
        <Button type="submit" disabled={isPending}>
          + הוספת אילוץ
        </Button>
        {error && <p className="text-sm text-danger">{error}</p>}
      </form>

      {/* Bounded self-contained scroll box (same max-h-[70vh] overflow-auto
          pattern as HorsesClient.tsx/InstructorsClient.tsx) - the header
          row's sticky top-0 below sticks to the top of *this* box only,
          never the page, so it can't collide with the admin layout's own
          sticky header. A short list never hits max-h, so it never looks
          boxed-in. */}
      <div className="max-h-[70vh] overflow-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted text-muted-foreground">
              <th className="sticky top-0 z-10 bg-muted px-4 py-3 text-right font-medium">סוג תורנות</th>
              <th className="sticky top-0 z-10 bg-muted px-4 py-3 text-right font-medium">מקטע חסום</th>
              <th className="sticky top-0 z-10 bg-muted px-4 py-3 text-right font-medium">הערה</th>
              <th className="sticky top-0 z-10 bg-muted px-4 py-3 text-right font-medium">סטטוס</th>
              <th className="sticky top-0 z-10 bg-muted px-4 py-3 text-right font-medium">פעולות</th>
            </tr>
          </thead>
          <tbody>
            {constraints.map((row) => (
              <tr key={row.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3 font-medium text-card-foreground">
                  {row.dutyTypeName}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {SLOT_LABELS[row.slot] ?? row.slot}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{row.note ?? "-"}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      row.isActive
                        ? "bg-success-muted text-success"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {row.isActive ? "פעיל" : "לא פעיל"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant={row.isActive ? "danger" : "secondary"}
                      className="!px-2 !py-1"
                      disabled={isPending}
                      onClick={() => handleToggle(row)}
                    >
                      {row.isActive ? "השבתה" : "הפעלה"}
                    </Button>
                    <Button
                      variant="ghost"
                      className="!px-2 !py-1"
                      disabled={isPending}
                      onClick={() => handleDelete(row)}
                    >
                      מחיקה
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {constraints.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  אין אילוצים מוגדרים
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
