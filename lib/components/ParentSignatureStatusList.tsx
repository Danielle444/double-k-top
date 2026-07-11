"use client";

import { useMemo, useState } from "react";
import type { ParentSignatureStatusResult } from "@/lib/actions/parent-signatures";

// Shared, read-only presentation for the Stage 2 parent-signature status
// view - used by both the admin page and the instructor/tablet section, each
// of which only differs in which server action fetches the data (admin vs.
// instructor-permission-gated). No signing action here yet: the "חתימה"
// button is a disabled placeholder until the Stage 3 signing flow exists.
export function ParentSignatureStatusList({ data }: { data: ParentSignatureStatusResult | null }) {
  const [search, setSearch] = useState("");

  const filteredChildren = useMemo(() => {
    if (!data) return [];
    const trimmed = search.trim();
    if (!trimmed) return data.children;
    return data.children.filter(
      (child) =>
        child.childName.includes(trimmed) || (child.parentName?.includes(trimmed) ?? false)
    );
  }, [data, search]);

  if (data === null) {
    return <p className="text-base text-muted-foreground">טוען...</p>;
  }

  if (data.children.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">
        אין כרגע ילדים משובצים להתנסויות מתחילים.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-semibold text-muted-foreground">מחזור: {data.courseCycle}</p>

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="חיפוש לפי שם ילד/ה או הורה..."
        className="rounded-xl border border-border bg-card px-3 py-2 text-sm text-card-foreground placeholder:text-muted-foreground"
      />

      {filteredChildren.length === 0 ? (
        <p className="text-sm text-muted-foreground">לא נמצאו ילדים תואמים לחיפוש.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {filteredChildren.map((child) => (
            <div key={child.childId} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-base font-bold text-card-foreground">
                    {child.childName}
                    {child.childAge != null && (
                      <span className="font-normal text-muted-foreground"> · גיל {child.childAge}</span>
                    )}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {child.parentName ?? "אין שם הורה"}
                    {child.parentPhone ? ` · ${child.parentPhone}` : ""}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${
                    child.isCleared
                      ? "bg-success-muted text-success"
                      : "bg-warning-muted text-warning"
                  }`}
                >
                  {child.isCleared ? "חתום" : `חסרים ${child.missingCount}`}
                </span>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {child.requiredForms.map((form) => (
                  <span
                    key={form.formType}
                    className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                      form.status === "SIGNED"
                        ? "border-success/30 bg-success-muted text-success"
                        : "border-warning/30 bg-warning-muted text-warning"
                    }`}
                  >
                    {form.title} · {form.status === "SIGNED" ? "חתום" : "חסר"}
                  </span>
                ))}
              </div>

              <button
                type="button"
                disabled
                className="mt-3 w-full cursor-not-allowed rounded-xl border border-dashed border-border py-2 text-sm font-semibold text-muted-foreground"
              >
                חתימה — בשלב הבא
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
