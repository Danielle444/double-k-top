"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState, useTransition } from "react";
import { Button } from "@/lib/components/Button";
import { Modal } from "@/lib/components/Modal";
import { formatHebrewDate, formatHebrewWeekday, getDefaultDayFilter, getLocalDateKey, parseDateKey } from "@/lib/dates";
import { cleanScheduleTitle } from "@/lib/schedule-title";
import { ScheduleTimeGrid } from "@/lib/components/ScheduleTimeGrid";
import { coalesceAdjacentSameActivity } from "@/lib/schedule-grouping";
import { getScheduleGroupColorClass } from "@/lib/schedule-group-colors";
import {
  createScheduleItem,
  deleteScheduleItem,
  updateScheduleItem,
  updateMergedScheduleItems,
  type ScheduleItemInput,
  type ScheduleItemRow,
} from "@/lib/actions/schedule-items";
import {
  getNoDutyStatusForRange,
  markNoDutyDate,
  unmarkNoDutyDate,
  type NoDutyDayStatus,
} from "@/lib/actions/no-duty-dates";
import { RidingSlotModal } from "@/app/admin/weekly-schedule/[id]/RidingSlotModal";

type ScheduleItemView = ScheduleItemRow;

interface InstructorOption {
  id: string;
  fullName: string;
}

interface WeeklyScheduleView {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  uploadedFileName: string;
  // Level of the CourseOffering that OWNS this week (WeeklySchedule
  // .courseOfferingId -> CourseOffering.level), resolved server-side in
  // page.tsx. null for the legacy weeks that predate the offering spine - all
  // of which are Level 1. Consumed only by RidingSlotModal, to decide which
  // riding modes may be offered.
  courseLevel: number | null;
  items: ScheduleItemView[];
}

const EMPTY_FORM: ScheduleItemInput = {
  dateKey: "",
  startTime: "",
  endTime: "",
  title: "",
  groupName: "",
  instructorName: "",
  location: "",
  description: "",
};

// Admin always sees the full (time-cleaned) title and instructorName - no
// student-facing shortening or hiding here.
//
// A real component (not a plain function returning JSX) specifically so its
// own menuOpen state can live here, scoped per card - the same reason
// InstructorScheduleCard (InstructorScheduleSection.tsx) holds its own
// showDetails state instead of the caller. Compact grid cards (see
// ScheduleTimeGrid) can be as short as a single time-slot row, whose
// upstream per-item wrapper's overflow-hidden (unchanged) clips content from
// the bottom up - so the old inline עריכה/ניהול רכיבה/מחיקה button cluster
// could overflow or get clipped. All three actions now live behind one
// compact "⋯" trigger that stays on the top header line (time/tag), which
// is never clipped, and the SAME trigger is used for the non-compact
// (single-group list) card too, so no card's controls depend on its height.
function ScheduleCard({
  item,
  onEdit,
  onDelete,
  onManageRiding,
  compact = false,
}: {
  item: ScheduleItemView;
  onEdit: (item: ScheduleItemView) => void;
  onDelete: (item: ScheduleItemView) => void;
  onManageRiding: (item: ScheduleItemView) => void;
  compact?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  // Both the "all groups" grid view and the single-group list can merge two
  // or more real rows into one display card - a continuous same-title
  // activity, or a same-time cross-group pair - giving it a synthetic
  // "realId1+realId2" id that was never a real row. Real cuids never contain
  // "+", so splitting on it losslessly recovers the ordered list of real
  // source ids (see updateMergedScheduleItems), which is what makes editing
  // a merged card possible without ever sending the fake id to Prisma. The
  // menu below passes the same `item` (composite id and all) through to
  // onEdit/onDelete/onManageRiding unchanged, so a merged card's actions
  // still target every original row, exactly as before.
  const sourceIds = item.id.split("+");
  const isMerged = sourceIds.length > 1;

  return (
    <div
      className={`rounded-xl border-2 border-border ${getScheduleGroupColorClass(item.groupName)} ${
        compact ? "p-2.5" : "p-4"
      }`}
    >
      <div
        className={
          compact
            ? "relative mb-1 flex items-center justify-between gap-2"
            : "mb-1 flex flex-wrap items-center justify-between gap-1.5"
        }
      >
        <span className={`font-semibold text-card-foreground ${compact ? "text-sm" : "text-base"}`}>
          {item.startTime}-{item.endTime}
        </span>
        <span
          className={`rounded-full bg-muted text-muted-foreground ${
            compact ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm"
          }`}
        >
          {item.groupName ? `קבוצה ${item.groupName}` : "שתי הקבוצות"}
        </span>
        <button
          type="button"
          onClick={(e) => {
            // The card itself has no click behavior today, but this stays
            // consistent with the same guard InstructorScheduleCard's info
            // trigger uses, so opening the menu can never also trigger a
            // future card-level handler.
            e.stopPropagation();
            setMenuOpen(true);
          }}
          onKeyDown={(e) => e.stopPropagation()}
          aria-label="פעולות לסשן"
          className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-sm font-bold leading-none text-muted-foreground hover:bg-secondary hover:text-secondary-foreground"
        >
          ⋯
        </button>
      </div>
      <p className={`font-bold text-card-foreground ${compact ? "text-base" : "text-lg"}`}>
        {cleanScheduleTitle(item.title)}
      </p>
      {item.instructorName && (
        <p className={`mt-1 text-muted-foreground ${compact ? "text-xs" : "text-sm"}`}>
          מדריך/ה: {item.instructorName}
        </p>
      )}
      {item.location && (
        <p className={`text-muted-foreground ${compact ? "text-xs" : "text-sm"}`}>
          מיקום: {item.location}
        </p>
      )}

      <Modal open={menuOpen} onClose={() => setMenuOpen(false)} title="פעולות לסשן">
        <div className="flex flex-col gap-2">
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => {
              setMenuOpen(false);
              onEdit(item);
            }}
          >
            עריכה
          </Button>
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => {
              setMenuOpen(false);
              onManageRiding(item);
            }}
          >
            ניהול רכיבה
          </Button>
          {isMerged ? (
            <p className="text-xs italic text-muted-foreground">
              מחיקה לא זמינה עבור פעילות ממוזגת - ניתן לערוך את כל הפריטים המקוריים יחד
            </p>
          ) : (
            <Button
              variant="danger"
              className="w-full"
              onClick={() => {
                setMenuOpen(false);
                onDelete(item);
              }}
            >
              מחיקה
            </Button>
          )}
        </div>
      </Modal>
    </div>
  );
}

export function WeeklyScheduleDetailClient({
  week,
  instructors,
}: {
  week: WeeklyScheduleView;
  instructors: InstructorOption[];
}) {
  const [items, setItems] = useState(week.items);
  const [groupFilter, setGroupFilter] = useState<"all" | string>("all");
  // Opening the current week focuses today's day instead of always starting
  // on "כל השבוע" - only when today actually has schedule items, and only
  // ever computed once for this page's initial state (a lazy initializer,
  // not re-run on later renders), so it never fights a manual selection.
  const [dayFilter, setDayFilter] = useState<"all" | string>(() =>
    getDefaultDayFilter(
      week,
      getLocalDateKey(),
      week.items.map((i) => i.dateKey)
    )
  );
  const [noDutyStatus, setNoDutyStatus] = useState<Map<string, NoDutyDayStatus> | null>(null);
  const [isPending, startTransition] = useTransition();

  const [modalItem, setModalItem] = useState<ScheduleItemView | "new" | null>(null);
  const [form, setForm] = useState<ScheduleItemInput>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, startSaveTransition] = useTransition();

  const [deleteTarget, setDeleteTarget] = useState<ScheduleItemView | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, startDeleteTransition] = useTransition();

  const [ridingTarget, setRidingTarget] = useState<ScheduleItemView | null>(null);

  useEffect(() => {
    // Resyncs local editable state when the server-provided week prop
    // changes (e.g. a revalidated refetch from elsewhere) - local
    // edit/create/delete handlers already patch `items` directly for
    // immediate feedback, this only covers the external-update case.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItems(week.items);
  }, [week.items]);

  function loadNoDutyStatus() {
    getNoDutyStatusForRange(week.startDate, week.endDate).then((rows) => {
      setNoDutyStatus(new Map(rows.map((r) => [r.dateKey, r])));
    });
  }

  useEffect(() => {
    loadNoDutyStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week.startDate, week.endDate]);

  function handleToggleNoDuty(dk: string, currentlyMarked: boolean) {
    startTransition(async () => {
      if (currentlyMarked) {
        await unmarkNoDutyDate(dk);
      } else {
        await markNoDutyDate(dk);
      }
      loadNoDutyStatus();
    });
  }

  const groups = useMemo(
    () => Array.from(new Set(items.map((i) => i.groupName).filter((g): g is string => Boolean(g)))).sort(),
    [items]
  );

  const dayOptions = useMemo(() => Array.from(new Set(items.map((i) => i.dateKey))).sort(), [items]);

  const filteredItems = useMemo(() => {
    return items
      .filter((i) => groupFilter === "all" || !i.groupName || i.groupName === groupFilter)
      .filter((i) => dayFilter === "all" || i.dateKey === dayFilter)
      .sort((a, b) => (a.dateKey + a.startTime).localeCompare(b.dateKey + b.startTime));
  }, [items, groupFilter, dayFilter]);

  const itemsByDay = useMemo(() => {
    const map = new Map<string, ScheduleItemView[]>();
    for (const item of filteredItems) {
      if (!map.has(item.dateKey)) map.set(item.dateKey, []);
      map.get(item.dateKey)!.push(item);
    }
    return Array.from(map.entries());
  }, [filteredItems]);

  // Whether the currently-open edit modal targets a merged card whose real
  // source rows (looked up in the raw, un-coalesced `items` state) span more
  // than one groupName - a cross-group "שתי הקבוצות" merge. groupName must
  // stay non-editable for those, since applying one group to all rows would
  // reassign a row out of its real group (server-side enforces this too, in
  // updateMergedScheduleItems).
  const modalIsCrossGroup = useMemo(() => {
    if (!modalItem || modalItem === "new") return false;
    const sourceIds = modalItem.id.split("+");
    if (sourceIds.length <= 1) return false;
    const sourceGroups = new Set(
      items.filter((i) => sourceIds.includes(i.id)).map((i) => i.groupName)
    );
    return sourceGroups.size > 1;
  }, [modalItem, items]);

  function openEdit(item: ScheduleItemView) {
    setModalItem(item);
    setForm({
      dateKey: item.dateKey,
      startTime: item.startTime,
      endTime: item.endTime,
      title: item.title,
      groupName: item.groupName ?? "",
      instructorName: item.instructorName ?? "",
      location: item.location ?? "",
      description: item.description ?? "",
    });
    setFormError(null);
  }

  function openCreate() {
    setModalItem("new");
    setForm({
      ...EMPTY_FORM,
      dateKey: dayFilter !== "all" ? dayFilter : "",
    });
    setFormError(null);
  }

  function handleFormSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    const editingMergedItem =
      modalItem && modalItem !== "new" && modalItem.id.includes("+") ? modalItem : null;
    startSaveTransition(async () => {
      if (editingMergedItem) {
        // A merged card's id is the "+"-joined list of its real source
        // ScheduleItem ids - split it back and update all of them together
        // in one transaction rather than sending the fake id to Prisma.
        const result = await updateMergedScheduleItems(editingMergedItem.id.split("+"), form);
        if (!result.success || !result.items) {
          setFormError(result.error ?? "אירעה שגיאה");
          return;
        }
        const updatedById = new Map(result.items.map((i) => [i.id, i]));
        setItems((prev) => prev.map((i) => updatedById.get(i.id) ?? i));
        setModalItem(null);
        return;
      }

      const result =
        modalItem && modalItem !== "new"
          ? await updateScheduleItem(modalItem.id, form)
          : await createScheduleItem(week.id, form);
      if (!result.success || !result.item) {
        setFormError(result.error ?? "אירעה שגיאה");
        return;
      }
      const savedItem = result.item;
      setItems((prev) => {
        if (modalItem && modalItem !== "new") {
          return prev.map((i) => (i.id === savedItem.id ? savedItem : i));
        }
        return [...prev, savedItem];
      });
      setModalItem(null);
    });
  }

  function openDelete(item: ScheduleItemView) {
    setDeleteError(null);
    setDeleteTarget(item);
  }

  function openManageRiding(item: ScheduleItemView) {
    setRidingTarget(item);
  }

  // A merged display card's id is the "+"-joined list of its real source
  // ScheduleItem ids (see updateMergedScheduleItems) - passing the full list
  // lets the riding slot actions manage the whole logical activity the
  // admin actually sees, not just its first row (see RidingSlotScheduleItem).
  const ridingScheduleItemIds = ridingTarget ? ridingTarget.id.split("+") : [];
  const ridingIsMergedDisplay = ridingTarget ? ridingTarget.id.includes("+") : false;

  function handleConfirmDelete() {
    if (!deleteTarget) return;
    setDeleteError(null);
    const itemId = deleteTarget.id;
    startDeleteTransition(async () => {
      const result = await deleteScheduleItem(itemId);
      if (!result.success) {
        setDeleteError(result.error ?? "אירעה שגיאה");
        return;
      }
      setItems((prev) => prev.filter((i) => i.id !== itemId));
      setDeleteTarget(null);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/admin/weekly-schedule"
            className="text-sm text-muted-foreground underline hover:text-card-foreground"
          >
            &larr; חזרה ללו&quot;ז שבועי
          </Link>
          <h1 className="mt-1 text-xl font-bold text-card-foreground">{week.name}</h1>
          <p className="text-sm text-muted-foreground">
            {formatHebrewDate(parseDateKey(week.startDate))} -{" "}
            {formatHebrewDate(parseDateKey(week.endDate))} · {items.length} פריטי לו&quot;ז ·{" "}
            {week.uploadedFileName}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={openCreate}>+ הוספת פריט</Button>
          <Link
            href={`/admin/weekly-schedule/${week.id}/riding`}
            className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground transition-colors hover:opacity-80"
          >
            ניהול רכיבות לשבוע
          </Link>
          <a
            href={`/api/admin/schedule/export?weeklyScheduleId=${week.id}`}
            className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground transition-colors hover:opacity-80"
          >
            ייצוא לאקסל
          </a>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setGroupFilter("all")}
          className={`rounded-full px-4 py-2 text-sm font-medium ${
            groupFilter === "all"
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground"
          }`}
        >
          שתי הקבוצות
        </button>
        {groups.map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => setGroupFilter(g)}
            className={`rounded-full px-4 py-2 text-sm font-medium ${
              groupFilter === g
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground"
            }`}
          >
            קבוצה {g}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setDayFilter("all")}
          className={`rounded-full px-4 py-2 text-sm font-medium ${
            dayFilter === "all"
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground"
          }`}
        >
          כל הימים
        </button>
        {dayOptions.map((dk) => (
          <button
            key={dk}
            type="button"
            onClick={() => setDayFilter(dk)}
            className={`rounded-full px-4 py-2 text-sm font-medium ${
              dayFilter === dk
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {formatHebrewWeekday(parseDateKey(dk))} · {formatHebrewDate(parseDateKey(dk))}
          </button>
        ))}
      </div>

      {itemsByDay.length === 0 ? (
        <p className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
          אין פריטים להצגה
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          {itemsByDay.map(([dk, dayItems]) => {
            const status = noDutyStatus?.get(dk);
            const isNoDuty = status?.isNoDuty ?? false;
            return (
            <div key={dk} className="rounded-2xl border border-border bg-card p-5">
              {/* Bounded internal scroll, own box per day - each day card
                  gets its own independent scroll region rather than one
                  page-level sticky header handing off between days, so
                  there's no possibility of two days' headers colliding or
                  glitching under "כל הימים" (each is fully isolated). The
                  header bar's sticky top-0 below resolves against *this* box
                  only, never the page, so it can't collide with the admin
                  layout's own sticky header either - same containment
                  reasoning as ScheduleGrid.tsx/TeachingPracticeManager.tsx.
                  A day with only a few items never hits max-h, so it never
                  looks boxed-in. */}
              <div className="max-h-[60vh] overflow-y-auto">
                <div className="sticky top-0 z-10 mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-secondary px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-base font-bold text-secondary-foreground">
                      {formatHebrewWeekday(parseDateKey(dk))} · {formatHebrewDate(parseDateKey(dk))}
                    </span>
                    {isNoDuty && (
                      <span className="rounded-full bg-warning-muted px-3 py-1 text-xs font-medium text-warning">
                        אין תורנויות ביום זה
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={isPending || !noDutyStatus}
                    onClick={() => handleToggleNoDuty(dk, isNoDuty)}
                    className="rounded-full bg-card px-3 py-1 text-xs font-medium text-card-foreground underline decoration-dotted hover:bg-muted disabled:opacity-50"
                  >
                    {isNoDuty ? "בטל סימון ללא תורנויות" : "סמן כיום ללא תורנויות"}
                  </button>
                </div>

                {isNoDuty && status && status.assignmentCount > 0 && (
                  <div className="mb-3 rounded-lg bg-danger-muted p-3 text-sm text-danger">
                    קיימים {status.assignmentCount} שיבוצי תורנות ליום זה שלא נמחקו אוטומטית. ניתן
                    לטפל בהם ידנית בעמוד שיבוץ.
                  </div>
                )}

                {groupFilter === "all" ? (
                  <ScheduleTimeGrid
                    items={dayItems}
                    renderCard={(item) => (
                      <ScheduleCard
                        item={item}
                        onEdit={openEdit}
                        onDelete={openDelete}
                        onManageRiding={openManageRiding}
                        compact
                      />
                    )}
                  />
                ) : (
                  // A single-group filter can still include both the target
                  // group's rows and null-group "שתי הקבוצות" rows (see
                  // filteredItems above), so a continuous activity still needs
                  // the same coalescing ScheduleTimeGrid applies internally, or
                  // it renders as separate boxes here - and since coalescing
                  // buckets by groupName and concatenates each bucket in
                  // first-encountered order (not merged by time), the result
                  // needs an explicit re-sort by time afterward.
                  <div className="flex flex-col gap-3">
                    {[...coalesceAdjacentSameActivity(dayItems)]
                      .sort(
                        (a, b) =>
                          a.startTime.localeCompare(b.startTime) ||
                          a.endTime.localeCompare(b.endTime)
                      )
                      .map((item) => (
                        <ScheduleCard
                          key={item.id}
                          item={item}
                          onEdit={openEdit}
                          onDelete={openDelete}
                          onManageRiding={openManageRiding}
                        />
                      ))}
                  </div>
                )}
              </div>
            </div>
            );
          })}
        </div>
      )}

      <Modal
        open={modalItem !== null}
        title={modalItem === "new" ? 'הוספת פריט לו"ז' : 'עריכת פריט לו"ז'}
        onClose={() => setModalItem(null)}
      >
        <form onSubmit={handleFormSubmit} className="flex flex-col gap-3">
          {modalItem !== null && modalItem !== "new" && modalItem.id.includes("+") && (
            <p className="rounded-lg bg-secondary p-3 text-xs text-secondary-foreground">
              {modalIsCrossGroup
                ? "פעילות זו כוללת כמה קבוצות. לא ניתן לשנות קבוצה בעריכה ממוזגת."
                : 'פעילות זו מורכבת מכמה פריטי לו"ז רצופים. השינוי יחול על כל הפריטים המקוריים.'}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm">
              תאריך
              <input
                type="date"
                value={form.dateKey}
                onChange={(e) => setForm((f) => ({ ...f, dateKey: e.target.value }))}
                className="rounded-lg border border-border px-3 py-2 text-sm"
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              שעת התחלה
              <input
                value={form.startTime}
                onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))}
                placeholder="HH:MM"
                className="rounded-lg border border-border px-3 py-2 text-sm"
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              שעת סיום
              <input
                value={form.endTime}
                onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))}
                placeholder="HH:MM"
                className="rounded-lg border border-border px-3 py-2 text-sm"
                required
              />
            </label>
          </div>

          <label className="flex flex-col gap-1 text-sm">
            קבוצה (ריק = שתי הקבוצות)
            <input
              value={form.groupName}
              onChange={(e) => setForm((f) => ({ ...f, groupName: e.target.value }))}
              placeholder="א / ב"
              disabled={modalIsCrossGroup}
              className="rounded-lg border border-border px-3 py-2 text-sm disabled:bg-muted disabled:opacity-60"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            כותרת פעילות
            <input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              className="rounded-lg border border-border px-3 py-2 text-sm"
              required
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              מדריך/ה
              <input
                value={form.instructorName}
                onChange={(e) => setForm((f) => ({ ...f, instructorName: e.target.value }))}
                className="rounded-lg border border-border px-3 py-2 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              מיקום
              <input
                value={form.location}
                onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                className="rounded-lg border border-border px-3 py-2 text-sm"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1 text-sm">
            הערה לסשן (אופציונלי, מוצג לחניכים)
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              rows={2}
              className="rounded-lg border border-border px-3 py-2 text-sm"
            />
          </label>

          {formError && <p className="text-sm text-danger">{formError}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setModalItem(null)}>
              ביטול
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? "שומר..." : "שמירה"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={deleteTarget !== null}
        title='מחיקת פריט לו"ז'
        onClose={() => setDeleteTarget(null)}
      >
        <p className="text-sm text-card-foreground">
          האם למחוק את הפריט &quot;{deleteTarget ? cleanScheduleTitle(deleteTarget.title) : ""}&quot;
          ({deleteTarget?.startTime}-{deleteTarget?.endTime})? הפעולה אינה הפיכה. שיבוצי תורנות
          קיימים אינם מושפעים.
        </p>
        {deleteError && <p className="mt-2 text-sm text-danger">{deleteError}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setDeleteTarget(null)}>
            ביטול
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={isDeleting}
            onClick={handleConfirmDelete}
          >
            {isDeleting ? "מוחק..." : "מחיקה"}
          </Button>
        </div>
      </Modal>

      {ridingTarget && ridingScheduleItemIds.length > 0 && (
        <RidingSlotModal
          open={ridingTarget !== null}
          onClose={() => setRidingTarget(null)}
          scheduleItemIds={ridingScheduleItemIds}
          scheduleItemInfo={{
            title: ridingTarget.title,
            dateKey: ridingTarget.dateKey,
            startTime: ridingTarget.startTime,
            endTime: ridingTarget.endTime,
            groupName: ridingTarget.groupName,
            instructorName: ridingTarget.instructorName,
            location: ridingTarget.location,
          }}
          isMergedDisplay={ridingIsMergedDisplay}
          instructors={instructors}
          // Straight from the week this page is bound to - never from a
          // globally-selected course or the item's own title/group.
          courseLevel={week.courseLevel}
        />
      )}
    </div>
  );
}
