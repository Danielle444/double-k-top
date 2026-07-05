"use client";

import { useEffect, useState } from "react";
import { getBookletAccess, type CourseBookletAccess } from "@/lib/actions/course-booklet";

// Shared by /student and /instructor - identical behavior and visibility
// for both roles, no auth gate (the action itself never exposes anything
// beyond the current booklet's own signed view/download URLs).
export function CourseBookletSection() {
  const [booklet, setBooklet] = useState<CourseBookletAccess | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    getBookletAccess()
      .then((result) => {
        if (!cancelled) setBooklet(result);
      })
      .catch(() => {
        if (!cancelled) setBooklet(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (booklet === undefined) {
    return (
      <div className="rounded-2xl border border-border bg-card p-8 text-center">
        <p className="text-base text-muted-foreground">טוען...</p>
      </div>
    );
  }

  if (!booklet) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card p-8 text-center">
        <h2 className="text-xl font-bold text-card-foreground">חוברת קורס</h2>
        <p className="text-base text-muted-foreground">חוברת הקורס אינה זמינה כרגע.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 text-center">
      <h2 className="text-xl font-bold text-card-foreground">חוברת קורס</h2>
      <p className="text-sm text-muted-foreground">{booklet.fileName}</p>
      <div className="flex flex-col gap-3">
        <a
          href={booklet.viewUrl}
          target="_blank"
          rel="noreferrer"
          className="rounded-lg bg-primary px-6 py-3 text-base font-medium text-primary-foreground hover:opacity-90"
        >
          צפייה בחוברת
        </a>
        <a
          href={booklet.downloadUrl}
          className="rounded-lg bg-secondary px-6 py-3 text-base font-medium text-secondary-foreground hover:opacity-80"
        >
          הורדת החוברת
        </a>
      </div>
    </div>
  );
}
