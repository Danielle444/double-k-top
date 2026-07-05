"use client";

import { useEffect, useState } from "react";
import {
  getInstructorMaterials,
  getStudentMaterials,
  type RoleMaterialItem,
} from "@/lib/actions/materials";

// Shared by /student and /instructor - identical rendering for both roles;
// only the fetch function differs, and the visibility filter behind it is
// enforced server-side (see lib/actions/materials.ts), never here.
export function CourseMaterialsSection({ role }: { role: "student" | "instructor" }) {
  const [materials, setMaterials] = useState<RoleMaterialItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetcher = role === "student" ? getStudentMaterials : getInstructorMaterials;
    fetcher().then((result) => {
      if (!cancelled) setMaterials(result);
    });
    return () => {
      cancelled = true;
    };
  }, [role]);

  if (materials === null) {
    return (
      <div className="rounded-2xl border border-border bg-card p-8 text-center">
        <p className="text-base text-muted-foreground">טוען...</p>
      </div>
    );
  }

  if (materials.length === 0) {
    return (
      <p className="rounded-2xl border border-border bg-card p-5 text-base text-muted-foreground">
        אין חומרי קורס זמינים כרגע.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {materials.map((m) => (
        <div key={m.id} className="rounded-xl border-2 border-border bg-card p-4">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                m.materialType === "LINK"
                  ? "bg-secondary text-secondary-foreground"
                  : "bg-success-muted text-success"
              }`}
            >
              {m.materialType === "LINK" ? "קישור" : "קובץ"}
            </span>
            <p className="text-lg font-bold text-card-foreground">{m.title}</p>
          </div>
          {m.description && (
            <p className="mb-3 whitespace-pre-wrap text-sm text-muted-foreground">{m.description}</p>
          )}
          <div className="flex flex-wrap gap-2">
            {m.materialType === "LINK" ? (
              <a
                href={m.externalUrl ?? "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                פתיחת קישור
              </a>
            ) : (
              <>
                {m.viewUrl && (
                  <a
                    href={m.viewUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
                  >
                    צפייה
                  </a>
                )}
                {m.downloadUrl && (
                  <a
                    href={m.downloadUrl}
                    className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:opacity-80"
                  >
                    הורדה
                  </a>
                )}
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
