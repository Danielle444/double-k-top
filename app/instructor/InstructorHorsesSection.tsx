"use client";

import { useEffect, useMemo, useState } from "react";
import { getHorseAssignments, type HorseAssignmentRow } from "@/lib/actions/horses";
import { getHorseDisplayInfo, type HorseBadgeType } from "@/lib/horse-info";

type HorseTypeFilter = "all" | HorseBadgeType;

const HORSE_TYPE_LABELS: Record<HorseTypeFilter, string> = {
  all: "הכל",
  private: "סוס פרטי",
  assigned: "סוס קורס",
  none: "לא שובץ",
};

function badgeClass(badgeType: HorseBadgeType): string {
  if (badgeType === "private") return "bg-success-muted text-success";
  if (badgeType === "assigned") return "bg-secondary text-secondary-foreground";
  return "bg-muted text-muted-foreground";
}

// View-only for Stage A - every instructor can see this tab, none can edit
// from it yet (canEditHorseAssignments exists on the model but nothing
// reads it in this stage).
export function InstructorHorsesSection() {
  const [rows, setRows] = useState<HorseAssignmentRow[] | null>(null);
  const [groupFilter, setGroupFilter] = useState("all");
  const [nameQuery, setNameQuery] = useState("");
  const [horseQuery, setHorseQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<HorseTypeFilter>("all");

  useEffect(() => {
    let cancelled = false;
    getHorseAssignments().then((result) => {
      if (!cancelled) setRows(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const groups = useMemo(() => {
    if (!rows) return [];
    return Array.from(new Set(rows.map((r) => r.groupName).filter((g): g is string => Boolean(g)))).sort();
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (!rows) return [];
    const nameQ = nameQuery.trim().toLowerCase();
    const horseQ = horseQuery.trim().toLowerCase();
    return rows.filter((r) => {
      if (groupFilter !== "all" && r.groupName !== groupFilter) return false;
      if (nameQ && !r.fullName.toLowerCase().includes(nameQ)) return false;
      const info = getHorseDisplayInfo(r);
      if (typeFilter !== "all" && info.badgeType !== typeFilter) return false;
      if (horseQ && !(info.horseName ?? "").toLowerCase().includes(horseQ)) return false;
      return true;
    });
  }, [rows, groupFilter, nameQuery, horseQuery, typeFilter]);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border border-border bg-card p-4">
        <h2 className="mb-3 text-lg font-bold text-card-foreground">חלוקה לקבוצות וסוסים</h2>
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <select
              value={groupFilter}
              onChange={(e) => setGroupFilter(e.target.value)}
              className="flex-1 rounded-xl border border-border px-3 py-2.5 text-base"
            >
              <option value="all">כל הקבוצות</option>
              {groups.map((g) => (
                <option key={g} value={g}>
                  קבוצה {g}
                </option>
              ))}
            </select>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as HorseTypeFilter)}
              className="flex-1 rounded-xl border border-border px-3 py-2.5 text-base"
            >
              {(Object.keys(HORSE_TYPE_LABELS) as HorseTypeFilter[]).map((key) => (
                <option key={key} value={key}>
                  {HORSE_TYPE_LABELS[key]}
                </option>
              ))}
            </select>
          </div>
          <input
            value={nameQuery}
            onChange={(e) => setNameQuery(e.target.value)}
            placeholder="חיפוש לפי שם תלמיד/ה..."
            className="rounded-xl border border-border px-3 py-2.5 text-base"
          />
          <input
            value={horseQuery}
            onChange={(e) => setHorseQuery(e.target.value)}
            placeholder="חיפוש לפי שם סוס..."
            className="rounded-xl border border-border px-3 py-2.5 text-base"
          />
        </div>
      </div>

      {rows === null ? (
        <p className="text-base text-muted-foreground">טוען...</p>
      ) : filteredRows.length === 0 ? (
        <p className="rounded-2xl border border-border bg-card p-5 text-base text-muted-foreground">
          אין תלמידים התואמים את הסינון
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {filteredRows.map((row) => {
            const info = getHorseDisplayInfo(row);
            return (
              <div key={row.id} className="rounded-xl border-2 border-border p-4">
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-lg font-bold text-card-foreground">{row.fullName}</p>
                  <span className={`rounded-full px-3 py-1 text-sm font-medium ${badgeClass(info.badgeType)}`}>
                    {info.badgeLabel}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {[
                    row.groupName ? `קבוצה ${row.groupName}` : null,
                    row.subgroupNumber != null ? `תת-קבוצה ${row.subgroupNumber}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {info.horseName && (
                  <p className="mt-2 text-base font-semibold text-card-foreground">{info.horseName}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
