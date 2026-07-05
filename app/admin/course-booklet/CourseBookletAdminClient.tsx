"use client";

import { FormEvent, useState, useTransition } from "react";
import { Button } from "@/lib/components/Button";
import {
  getBookletAccess,
  removeCourseBooklet,
  type CourseBookletAccess,
} from "@/lib/actions/course-booklet";
import { formatHebrewDateTime } from "@/lib/dates";

const linkButtonClass =
  "rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground transition-colors hover:opacity-80";

export function CourseBookletAdminClient({
  initialBooklet,
}: {
  initialBooklet: CourseBookletAccess | null;
}) {
  const [booklet, setBooklet] = useState(initialBooklet);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleUpload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const formData = new FormData(form);
    startTransition(async () => {
      try {
        const response = await fetch("/api/admin/course-booklet/upload", {
          method: "POST",
          body: formData,
        });
        const result = await response.json();
        if (!result.success) {
          setError(result.error ?? "אירעה שגיאה בהעלאה");
          return;
        }
        form.reset();
        setBooklet(await getBookletAccess());
      } catch {
        setError("אירעה שגיאה בהעלאה - בדקו את החיבור ונסו שוב");
      }
    });
  }

  function handleRemove() {
    setError(null);
    startTransition(async () => {
      await removeCourseBooklet();
      setBooklet(null);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {booklet ? (
        <div className="rounded-2xl border border-border bg-card p-5">
          <p className="text-sm font-semibold text-muted-foreground">קובץ נוכחי</p>
          <p className="mb-1 text-lg font-bold text-card-foreground">{booklet.fileName}</p>
          <p className="mb-4 text-sm text-muted-foreground">
            הועלה: {formatHebrewDateTime(new Date(booklet.uploadedAt))}
          </p>
          <div className="flex flex-wrap gap-2">
            <a href={booklet.viewUrl} target="_blank" rel="noreferrer" className={linkButtonClass}>
              צפייה
            </a>
            <a href={booklet.downloadUrl} className={linkButtonClass}>
              הורדה
            </a>
            <Button type="button" variant="danger" onClick={handleRemove} disabled={isPending}>
              הסרה
            </Button>
          </div>
        </div>
      ) : (
        <p className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">
          לא הועלתה חוברת קורס עדיין.
        </p>
      )}

      <form
        onSubmit={handleUpload}
        className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5"
      >
        <label className="flex flex-col gap-1 text-sm font-medium text-card-foreground">
          {booklet ? "החלפת הקובץ (PDF)" : "העלאת קובץ (PDF)"}
          <input
            type="file"
            name="file"
            accept="application/pdf,.pdf"
            required
            className="rounded-lg border border-border px-3 py-2 text-sm"
          />
        </label>
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button type="submit" disabled={isPending} className="self-start">
          {isPending ? "מעלה..." : booklet ? "החלפת חוברת הקורס" : "העלאת חוברת הקורס"}
        </Button>
      </form>
    </div>
  );
}
