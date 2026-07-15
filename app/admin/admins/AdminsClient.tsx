"use client";

import { FormEvent, useState, useTransition } from "react";
import { Button } from "@/lib/components/Button";
import { addAdminEmail, setAdminEmailActive } from "@/lib/actions/admin-emails";

interface AdminEmailRow {
  id: string;
  email: string;
  name: string | null;
  isActive: boolean;
}

export function AdminsClient({
  adminEmails,
  currentAdminEmail,
}: {
  adminEmails: AdminEmailRow[];
  currentAdminEmail: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await addAdminEmail(formData);
      if (!result.success) {
        setError(result.error ?? "אירעה שגיאה");
        return;
      }
      (e.target as HTMLFormElement).reset();
    });
  }

  function handleToggleActive(row: AdminEmailRow) {
    startTransition(async () => {
      await setAdminEmailActive(row.id, !row.isActive);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <form
        onSubmit={handleSubmit}
        className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4"
      >
        <label className="flex flex-col gap-1 text-sm">
          כתובת Gmail
          <input
            name="email"
            type="email"
            required
            className="rounded-lg border border-border px-3 py-2 text-sm"
            placeholder="name@gmail.com"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          שם (אופציונלי)
          <input name="name" className="rounded-lg border border-border px-3 py-2 text-sm" />
        </label>
        <Button type="submit" disabled={isPending}>
          + הוספת מנהל/ת
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
              <th className="sticky top-0 z-10 bg-muted px-4 py-3 text-right font-medium">אימייל</th>
              <th className="sticky top-0 z-10 bg-muted px-4 py-3 text-right font-medium">שם</th>
              <th className="sticky top-0 z-10 bg-muted px-4 py-3 text-right font-medium">סטטוס</th>
              <th className="sticky top-0 z-10 bg-muted px-4 py-3 text-right font-medium">פעולות</th>
            </tr>
          </thead>
          <tbody>
            {adminEmails.map((row) => {
              const isSelf = row.email === currentAdminEmail;
              return (
                <tr key={row.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-medium text-card-foreground">
                    {row.email}
                    {isSelf && (
                      <span className="mr-2 text-xs text-muted-foreground">(את/ה)</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{row.name ?? "-"}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        row.isActive
                          ? "bg-success-muted text-success"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {row.isActive ? "פעיל/ה" : "לא פעיל/ה"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Button
                      variant={row.isActive ? "danger" : "secondary"}
                      className="!px-2 !py-1"
                      disabled={isPending || isSelf}
                      title={isSelf ? "לא ניתן להשבית את המשתמש המחובר" : undefined}
                      onClick={() => handleToggleActive(row)}
                    >
                      {row.isActive ? "השבתה" : "הפעלה"}
                    </Button>
                  </td>
                </tr>
              );
            })}
            {adminEmails.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                  אין מנהלים מורשים עדיין
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
