"use client";

import type { TeachingPracticeTypeValue } from "@/lib/teaching-practice-rotation";
import type {
  TeachingPracticeTraineeLessonRow,
  TeachingPracticeTraineeTrackRow,
} from "@/lib/actions/teaching-practice-student";
import { buildParentKey } from "@/lib/teaching-practice-same-parent";
import { formatHebrewDate, parseDateKey } from "@/lib/dates";
import { Modal } from "@/lib/components/Modal";
import { PRACTICE_TYPE_LABELS } from "@/lib/components/TeachingPracticeLessonCard";

/**
 * EX-EXAM-TP-SAME-PARENT — the "אותו הורה / איש קשר" popup, extracted
 * UNCHANGED from `app/student/StudentTeachingPracticeSection.tsx` so it can
 * be reused verbatim by both the trainee Teaching-Practice screen and the
 * trainee exam schedule's "לו״ז שלי" view, exactly like `TeachingPracticeLessonCard`
 * before it.
 *
 * This is a straight relocation, not a rewrite: `buildSameParentPopupRows`
 * is the same row-building logic that used to live inline in a `useMemo`,
 * and `TeachingPracticeSameParentPopup` is the same Modal/rows JSX. Callers
 * decide their OWN loading semantics (whether their source data is still
 * being fetched) and pass `rows: null` for "loading" - this module holds no
 * fetch, no state and no timer of its own.
 */

// Compact group label/color - a display-only distinguishing aid, never a
// visibility rule (that's entirely driven by the server action's own
// published/active filter). "א"/"ב" get their own tint; any other group name
// (or a track with no group at all) falls back to a neutral tint, so this
// never breaks for a group name this map doesn't happen to know about.
const GROUP_BADGE_CLASSES: Record<string, string> = {
  א: "bg-indigo-100 text-indigo-800",
  ב: "bg-fuchsia-100 text-fuchsia-800",
};

export function GroupBadge({ groupName }: { groupName: string | null }) {
  if (!groupName) return <>—</>;
  const cls = GROUP_BADGE_CLASSES[groupName] ?? "bg-slate-100 text-slate-800";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${cls}`}>
      {`קבוצה ${groupName}`}
    </span>
  );
}

/**
 * Unified row shape - date is null for fixed-structure rows (they have no
 * concrete date, only a template defaultStartTime), which also drives the
 * sort (dated rows first, chronological; fixed-structure rows after).
 */
export interface SameParentPopupRow {
  key: string;
  sourceLabel: string;
  childFullName: string;
  parentName: string | null;
  parentPhone: string | null;
  practiceType: TeachingPracticeTypeValue;
  groupName: string | null;
  date: string | null;
  startTime: string;
  traineeNames: string[];
  horseName: string | null;
  equipmentNotes: string | null;
}

/**
 * Build the popup's rows for one target child, from whichever lesson/track
 * sources the caller has in hand.
 *
 * PURE: no fetch, no React, no clock. `tracks` may be `[]` for a caller with
 * no fixed-structure data of its own (e.g. the exam screen, which never
 * reads it - see that screen's own file header) - the target lookup and the
 * row collection both simply find nothing there, exactly as if tracks were
 * genuinely empty.
 */
export function buildSameParentPopupRows(
  targetChildId: string,
  lessons: readonly TeachingPracticeTraineeLessonRow[],
  tracks: readonly TeachingPracticeTraineeTrackRow[],
): SameParentPopupRow[] {
  let targetKey: string | null = null;
  for (const lesson of lessons) {
    const match = lesson.children.find((c) => c.childId === targetChildId);
    if (match) {
      targetKey = buildParentKey(match.parentName, match.parentPhone);
      break;
    }
  }
  if (!targetKey) {
    for (const track of tracks) {
      const match = track.children.find((c) => c.childId === targetChildId);
      if (match) {
        targetKey = buildParentKey(match.parentName, match.parentPhone);
        break;
      }
    }
  }
  if (!targetKey) return [];

  const rows: SameParentPopupRow[] = [];
  for (const lesson of lessons) {
    for (const c of lesson.children) {
      if (buildParentKey(c.parentName, c.parentPhone) !== targetKey) continue;
      rows.push({
        key: `lesson-${lesson.id}-${c.childId}`,
        sourceLabel: "שיעור בתאריך",
        childFullName: `${c.firstName}${c.lastName ? ` ${c.lastName}` : ""}`,
        parentName: c.parentName,
        parentPhone: c.parentPhone,
        practiceType: lesson.practiceType,
        groupName: lesson.groupName,
        date: lesson.date,
        startTime: lesson.startTime,
        traineeNames: lesson.participants.map((p) => p.traineeName),
        horseName: c.horseName,
        equipmentNotes: c.equipmentNotes,
      });
    }
  }
  for (const track of tracks) {
    for (const c of track.children) {
      if (buildParentKey(c.parentName, c.parentPhone) !== targetKey) continue;
      rows.push({
        key: `track-${track.id}-${c.childId}`,
        sourceLabel: "מבנה קבוע",
        childFullName: `${c.firstName}${c.lastName ? ` ${c.lastName}` : ""}`,
        parentName: c.parentName,
        parentPhone: c.parentPhone,
        practiceType: track.practiceType,
        groupName: track.groupName,
        date: null,
        startTime: track.defaultStartTime,
        traineeNames: track.trainees.map((t) => t.traineeName),
        horseName: c.horseName,
        equipmentNotes: c.equipmentNotes,
      });
    }
  }

  return rows.sort(
    (a, b) =>
      (a.date ?? "9999-99-99").localeCompare(b.date ?? "9999-99-99") || a.startTime.localeCompare(b.startTime),
  );
}

/**
 * The "אותו הורה / איש קשר" popup itself. `rows === null` means "loading"
 * (the caller's own source data has not resolved yet); `[]` means loaded and
 * genuinely no related rows.
 */
export function TeachingPracticeSameParentPopup({
  open,
  onClose,
  rows,
}: {
  open: boolean;
  onClose: () => void;
  rows: SameParentPopupRow[] | null;
}) {
  return (
    <Modal open={open} onClose={onClose} title="אותו הורה / איש קשר">
      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">
          כדאי לתאם מי יוצר קשר כדי לא לפנות לאותו הורה כמה פעמים.
        </p>
        {rows === null ? (
          <p className="text-sm text-muted-foreground">טוען...</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">לא נמצאו שיעורים משויכים.</p>
        ) : (
          <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto">
            {rows.map((row) => (
              <div key={row.key} className="rounded-lg border border-border bg-card p-3 text-sm">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {row.sourceLabel}
                  </span>
                  <GroupBadge groupName={row.groupName} />
                </div>
                <p className="mt-1 font-semibold text-card-foreground">{row.childFullName}</p>
                <p className="mt-1 text-muted-foreground">
                  {row.parentName ?? "—"}
                  {row.parentPhone ? ` · ${row.parentPhone}` : ""}
                </p>
                <p className="mt-1 text-muted-foreground">
                  {row.date ? (
                    <>
                      {formatHebrewDate(parseDateKey(row.date))} · {row.startTime} ·{" "}
                    </>
                  ) : (
                    <>{row.startTime} · </>
                  )}
                  {PRACTICE_TYPE_LABELS[row.practiceType]}
                </p>
                {row.traineeNames.length > 0 && (
                  <p className="mt-1 text-muted-foreground">חניכים: {row.traineeNames.join(", ")}</p>
                )}
                {(row.horseName || row.equipmentNotes) && (
                  <p className="mt-1 text-muted-foreground">
                    {row.horseName ? `סוס: ${row.horseName}` : ""}
                    {row.horseName && row.equipmentNotes ? " · " : ""}
                    {row.equipmentNotes ? `ציוד: ${row.equipmentNotes}` : ""}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
