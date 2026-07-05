// Shared, presentation-only helpers for the admin daily-tracking view
// (app/admin/daily-tracking/AttendanceTrackingClient.tsx) and the instructor
// attendance view (app/instructor/InstructorAttendanceSection.tsx), so the
// two screens read/labeled/colored identically without duplicating this
// logic. Neither screen's own fetch/mutation/modal logic lives here - only
// the parts that are pure functions of an AttendanceTrackingRow.
import type { AttendanceStatusValue, AttendanceTrackingRow } from "@/lib/actions/attendance";
import type { HorseBadgeType } from "@/lib/horse-info";

export const STATUS_LABELS: Record<AttendanceStatusValue, string> = {
  PRESENT: 'נוכח/ת',
  ABSENT: 'נעדר/ת',
  PARTIAL: 'חלקי',
};

export const STATUS_SHORT_LABELS: Record<AttendanceStatusValue, string> = {
  PRESENT: "נוכח",
  ABSENT: "נעדר",
  PARTIAL: "חלקי",
};

export const STATUS_BADGE_CLASS: Record<AttendanceStatusValue, string> = {
  PRESENT: "bg-success-muted text-success",
  ABSENT: "bg-danger-muted text-danger",
  PARTIAL: "bg-warning-muted text-warning",
};

// A missing record is the normal, expected case (most students, most days) -
// it must never read like a warning or an unfinished task.
export const DEFAULT_LABEL = "אין היעדרות ידועה";
export const DEFAULT_BADGE_CLASS = "bg-muted text-muted-foreground";
export const DEFAULT_CELL_CLASS = "bg-muted/40 text-muted-foreground border-border";

// Mirrors app/admin/horses/HorsesClient.tsx's badgeClass exactly, so a
// student's horse badge looks the same everywhere.
export function horseBadgeClass(badgeType: HorseBadgeType): string {
  if (badgeType === "private") return "bg-success-muted text-success";
  if (badgeType === "assigned") return "bg-secondary text-secondary-foreground";
  return "bg-muted text-muted-foreground";
}

export interface AttendanceForm {
  // null only for a brand-new exception nobody has chosen a type for yet -
  // Save is blocked until it's set, so nothing is ever written by just
  // opening the modal.
  status: AttendanceStatusValue | null;
  arrivalTime: string;
  departureTime: string;
  notes: string;
}

export function defaultFormFromRow(row: AttendanceTrackingRow): AttendanceForm {
  return {
    status: row.attendance?.status ?? null,
    arrivalTime: row.attendance?.arrivalTime ?? "",
    departureTime: row.attendance?.departureTime ?? "",
    notes: row.attendance?.notes ?? "",
  };
}

export interface StudentGroup {
  studentId: string;
  studentName: string;
  groupName: string | null;
  subgroupNumber: number | null;
  cells: AttendanceTrackingRow[];
}

export function groupRowsByStudent(rows: AttendanceTrackingRow[]): StudentGroup[] {
  const map = new Map<string, StudentGroup>();
  for (const row of rows) {
    if (!map.has(row.studentId)) {
      map.set(row.studentId, {
        studentId: row.studentId,
        studentName: row.studentName,
        groupName: row.groupName,
        subgroupNumber: row.subgroupNumber,
        cells: [],
      });
    }
    map.get(row.studentId)!.cells.push(row);
  }
  return Array.from(map.values());
}

export interface SubgroupSection<T> {
  subgroupNumber: number | null;
  items: T[];
}

export interface GroupSection<T> {
  groupName: string | null;
  subgroups: SubgroupSection<T>[];
}

// Groups already-filtered items into group -> subgroup sections for display -
// called on the post-filter list, never the raw fetched rows, so filters and
// grouping compose (a filtered-out group/subgroup simply produces no
// section). Groups sort alphabetically with the ungrouped bucket last;
// subgroups sort numerically with the un-numbered bucket last.
export function groupByGroupAndSubgroup<
  T extends { groupName: string | null; subgroupNumber: number | null },
>(items: T[]): GroupSection<T>[] {
  const byGroup = new Map<string, T[]>();
  for (const item of items) {
    const key = item.groupName ?? "";
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key)!.push(item);
  }

  const groupKeys = Array.from(byGroup.keys()).sort((a, b) => {
    if (a === "" || b === "") return a === b ? 0 : a === "" ? 1 : -1;
    return a.localeCompare(b);
  });

  return groupKeys.map((groupKey) => {
    const groupItems = byGroup.get(groupKey)!;
    const bySubgroup = new Map<string, T[]>();
    for (const item of groupItems) {
      const subKey = item.subgroupNumber != null ? String(item.subgroupNumber) : "";
      if (!bySubgroup.has(subKey)) bySubgroup.set(subKey, []);
      bySubgroup.get(subKey)!.push(item);
    }
    const subKeys = Array.from(bySubgroup.keys()).sort((a, b) => {
      if (a === "" || b === "") return a === b ? 0 : a === "" ? 1 : -1;
      return Number(a) - Number(b);
    });

    return {
      groupName: groupKey || null,
      subgroups: subKeys.map((subKey) => ({
        subgroupNumber: subKey ? Number(subKey) : null,
        items: bySubgroup.get(subKey)!,
      })),
    };
  });
}

export function renderWarnings(row: AttendanceTrackingRow) {
  if (row.warnings.length === 0) return null;
  return (
    <div className="mb-2 flex flex-col gap-1 rounded-lg bg-warning-muted p-2">
      {row.warnings.map((w) => (
        <p key={w.type} className="text-xs text-warning">
          {w.message}
        </p>
      ))}
    </div>
  );
}
