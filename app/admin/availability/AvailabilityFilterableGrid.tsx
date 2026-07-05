"use client";

import { useMemo, useState } from "react";
import { AvailabilityGrid } from "@/app/admin/availability/AvailabilityGrid";

interface StudentOption {
  id: string;
  fullName: string;
  groupName: string | null;
  subgroupNumber: number | null;
}

// Thin filter layer in front of the existing, unmodified AvailabilityGrid -
// only narrows which students' rows are rendered; AvailabilityGrid's own
// state/save logic (setAvailability per cell click) is untouched, and
// initialAvailability always covers every student regardless of the current
// filter, so clearing a filter brings previously-hidden rows back exactly as
// they were, never re-fetched or reset.
export function AvailabilityFilterableGrid({
  students,
  dateKeys,
  initialAvailability,
}: {
  students: StudentOption[];
  dateKeys: string[];
  initialAvailability: Record<string, boolean>;
}) {
  const [groupFilter, setGroupFilter] = useState("");
  const [subgroupFilter, setSubgroupFilter] = useState("");
  const [nameQuery, setNameQuery] = useState("");

  const groups = useMemo(
    () =>
      Array.from(
        new Set(students.map((s) => s.groupName).filter((g): g is string => Boolean(g)))
      ).sort(),
    [students]
  );

  const subgroups = useMemo(
    () =>
      Array.from(
        new Set(
          students
            .filter((s) => !groupFilter || s.groupName === groupFilter)
            .map((s) => s.subgroupNumber)
            .filter((n): n is number => n != null)
        )
      ).sort((a, b) => a - b),
    [students, groupFilter]
  );

  const filteredStudents = useMemo(() => {
    const q = nameQuery.trim().toLowerCase();
    return students.filter((s) => {
      if (groupFilter && s.groupName !== groupFilter) return false;
      if (subgroupFilter && String(s.subgroupNumber ?? "") !== subgroupFilter) return false;
      if (q && !s.fullName.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [students, groupFilter, subgroupFilter, nameQuery]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          קבוצה
          <select
            value={groupFilter}
            onChange={(e) => {
              setGroupFilter(e.target.value);
              setSubgroupFilter("");
            }}
            className="rounded-lg border border-border px-3 py-2 text-sm"
          >
            <option value="">הכל</option>
            {groups.map((g) => (
              <option key={g} value={g}>
                קבוצה {g}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          תת־קבוצה
          <select
            value={subgroupFilter}
            onChange={(e) => setSubgroupFilter(e.target.value)}
            className="rounded-lg border border-border px-3 py-2 text-sm"
          >
            <option value="">הכל</option>
            {subgroups.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          חיפוש חניך/ה
          <input
            value={nameQuery}
            onChange={(e) => setNameQuery(e.target.value)}
            placeholder="שם..."
            className="rounded-lg border border-border px-3 py-2 text-sm"
          />
        </label>
        {(groupFilter || subgroupFilter || nameQuery) && (
          <p className="text-xs text-muted-foreground">
            מציג {filteredStudents.length} מתוך {students.length}
          </p>
        )}
      </div>
      <AvailabilityGrid
        students={filteredStudents.map((s) => ({ id: s.id, fullName: s.fullName }))}
        dateKeys={dateKeys}
        initialAvailability={initialAvailability}
      />
    </div>
  );
}
