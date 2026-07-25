"use client";

import { FormEvent, useState, useTransition } from "react";
import { Button } from "@/lib/components/Button";
import { Modal } from "@/lib/components/Modal";
import type { ActionResult } from "@/lib/actions/students";
import type { Level2DefaultHorseRow } from "@/lib/course/level2-default-horse-core";
import type { HorseBadgeType } from "@/lib/horse-info";
import type { Level2DefaultHorseInput } from "./actions";

function badgeClass(badgeType: HorseBadgeType): string {
  if (badgeType === "private") return "bg-success-muted text-success";
  if (badgeType === "assigned") return "bg-secondary text-secondary-foreground";
  return "bg-muted text-muted-foreground";
}

export function CourseHorsesClient({
  rows,
  action,
}: {
  rows: Level2DefaultHorseRow[];
  // The offering id is already bound server-side; the client supplies only the
  // studentId and the submitted triple.
  action: (studentId: string, data: Level2DefaultHorseInput) => Promise<ActionResult>;
}) {
  const [items, setItems] = useState(rows);
  const [modalRow, setModalRow] = useState<Level2DefaultHorseRow | null>(null);
  const [hasPrivateHorse, setHasPrivateHorse] = useState(false);
  const [privateHorseName, setPrivateHorseName] = useState("");
  const [assignedHorseName, setAssignedHorseName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function openModal(row: Level2DefaultHorseRow) {
    setError(null);
    setModalRow(row);
    setHasPrivateHorse(row.hasPrivateHorse);
    setPrivateHorseName(row.privateHorseName ?? "");
    setAssignedHorseName(row.assignedHorseName ?? "");
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!modalRow) return;
    setError(null);
    const studentId = modalRow.studentId;
    const data: Level2DefaultHorseInput = {
      hasPrivateHorse,
      privateHorseName: hasPrivateHorse ? privateHorseName : null,
      assignedHorseName: !hasPrivateHorse ? assignedHorseName : null,
    };
    startTransition(async () => {
      const result = await action(studentId, data);
      if (!result.success) {
        setError(result.error ?? "אירעה שגיאה");
        return;
      }
      // Optimistically mirror the normalized outcome (empty -> null, and the
      // unselected name cleared) so the row reflects the save without a refetch.
      const privateName = hasPrivateHorse ? privateHorseName.trim() || null : null;
      const assignedName = !hasPrivateHorse ? assignedHorseName.trim() || null : null;
      const badgeType: HorseBadgeType = hasPrivateHorse
        ? "private"
        : assignedName
          ? "assigned"
          : "none";
      const badgeLabel = hasPrivateHorse ? "סוס פרטי" : assignedName ? "סוס קורס" : "לא שובץ";
      const horseNameDisplay = hasPrivateHorse
        ? (privateName ?? "שם סוס לא הוזן")
        : (assignedName ?? "לא שובץ סוס");
      setItems((prev) =>
        prev.map((r) =>
          r.studentId === studentId
            ? {
                ...r,
                hasPrivateHorse,
                privateHorseName: privateName,
                assignedHorseName: assignedName,
                horseBadgeType: badgeType,
                horseBadgeLabel: badgeLabel,
                horseNameDisplay,
              }
            : r,
        ),
      );
      setModalRow(null);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="max-h-[70vh] overflow-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted text-muted-foreground">
              <th className="sticky top-0 z-10 bg-muted px-4 py-3 text-right font-medium">שם מלא</th>
              <th className="sticky top-0 z-10 bg-muted px-4 py-3 text-right font-medium">קבוצה / תת־קבוצה</th>
              <th className="sticky top-0 z-10 bg-muted px-4 py-3 text-right font-medium">סוג סוס</th>
              <th className="sticky top-0 z-10 bg-muted px-4 py-3 text-right font-medium">סוס ברירת מחדל</th>
              <th className="sticky top-0 z-10 bg-muted px-4 py-3 text-right font-medium">פעולות</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.studentId} className="border-b border-border last:border-0">
                <td className="px-4 py-3 font-medium text-card-foreground">{row.fullName}</td>
                <td className="px-4 py-3 text-muted-foreground">{row.subgroupLabel ?? "-"}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${badgeClass(row.horseBadgeType)}`}
                  >
                    {row.horseBadgeLabel}
                  </span>
                </td>
                <td
                  className={`px-4 py-3 ${row.horseNameDisplay ? "text-muted-foreground" : "italic text-muted-foreground/70"}`}
                >
                  {row.horseNameDisplay}
                </td>
                <td className="px-4 py-3">
                  {row.editable ? (
                    <Button
                      variant="ghost"
                      className="!px-2 !py-1"
                      onClick={() => openModal(row)}
                    >
                      עריכה
                    </Button>
                  ) : (
                    <span className="text-xs italic text-muted-foreground/70">
                      בירושה מקורס אחר (לקריאה בלבד)
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  אין חניכים פעילים רשומים לקורס זה
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal
        open={modalRow !== null}
        title={modalRow ? `עריכת סוס ברירת מחדל - ${modalRow.fullName}` : ""}
        onClose={() => setModalRow(null)}
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="hasPrivateHorse"
                checked={!hasPrivateHorse}
                onChange={() => setHasPrivateHorse(false)}
              />
              סוס קורס
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="hasPrivateHorse"
                checked={hasPrivateHorse}
                onChange={() => setHasPrivateHorse(true)}
              />
              סוס פרטי
            </label>
          </div>

          {hasPrivateHorse ? (
            <label className="flex flex-col gap-1 text-sm">
              שם הסוס הפרטי
              <input
                value={privateHorseName}
                onChange={(e) => setPrivateHorseName(e.target.value)}
                className="rounded-lg border border-border px-3 py-2 text-sm"
              />
            </label>
          ) : (
            <label className="flex flex-col gap-1 text-sm">
              שם סוס הקורס המשובץ
              <input
                value={assignedHorseName}
                onChange={(e) => setAssignedHorseName(e.target.value)}
                className="rounded-lg border border-border px-3 py-2 text-sm"
              />
            </label>
          )}

          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setModalRow(null)}>
              ביטול
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "שומר..." : "שמירה"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
