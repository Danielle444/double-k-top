"use client";

import type { TraineeCourseOptionView } from "@/lib/actions/trainee-course-selection";

interface TraineeCourseSelectorProps {
  /**
   * The trainee's own selectable courses, exactly as returned by
   * listTraineeCourseOptions(). NEVER assembled on the client and never filtered
   * here - this component renders the server's list verbatim.
   */
  options: TraineeCourseOptionView[];
  selectedId: string | null;
  onSelect: (courseOfferingId: string) => void;
}

/**
 * LEVEL 2 SLICE L2-DUAL - the compact trainee course switcher.
 *
 * UX ONLY, NEVER AUTHORITY. Selecting here changes nothing but a React state
 * value that is sent along as a REQUEST on the next schedule/contacts call; each
 * of those server actions independently re-resolves it against the trainee's own
 * ACTIVE enrollments before reading anything. Nothing is persisted to
 * localStorage, a cookie or the database, so a stale or tampered selection cannot
 * survive a reload or bypass a future server check.
 *
 * Mounted ONLY under the weekly-schedule and contacts screens. It must not appear
 * anywhere else: no other trainee module is course-selectable, and every one of
 * them stays on the single-course resolver.
 *
 * Renders NOTHING for a trainee with one (or zero) course, which is what keeps the
 * existing single-course experience pixel-identical.
 */
export function TraineeCourseSelector({
  options,
  selectedId,
  onSelect,
}: TraineeCourseSelectorProps) {
  if (options.length <= 1) return null;

  return (
    <div className="rounded-2xl border border-border bg-card p-3">
      <p className="mb-2 text-xs font-semibold text-muted-foreground">הקורס המוצג</p>
      {/* Wraps rather than scrolls horizontally, and every control keeps a
          finger-sized tap target, so two (or more) long Hebrew course labels
          stay usable on a narrow phone. */}
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const isSelected = option.id === selectedId;
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onSelect(option.id)}
              className={`min-h-11 flex-1 basis-40 rounded-full px-4 py-2 text-sm font-semibold ${
                isSelected
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
