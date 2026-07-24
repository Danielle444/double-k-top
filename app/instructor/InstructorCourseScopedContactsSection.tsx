"use client";

import { useEffect, useState } from "react";
import {
  listInstructorContactCourseOptions,
  type InstructorCourseOptionView,
} from "@/lib/actions/instructor-course-options";
import { InstructorContactsSection } from "./InstructorContactsSection";

/**
 * LEVEL 2 SLICE C0-B: the instructor CONTACTS course selector.
 *
 * LOCAL BY DESIGN. This selection belongs to the instructor contacts tab and
 * nothing else - it is not app-wide state, is not shared with schedule, duties,
 * riding or any other tab, is not persisted, and is not restored across mounts.
 * Widening it into a global course context is a separate, separately-approved
 * decision.
 *
 * THE MENU IS NOT AUTHORIZATION. The options come from the server
 * (listInstructorContactCourseOptions), which owns the allow-list, the labels and
 * the ordering; this component knows no offering id, no level and no course name
 * of its own. Choosing an option only decides which id is REQUESTED - every read
 * re-validates it server-side, so nothing here can widen access.
 *
 * NO DEFAULT SELECTION is a hard rule: `selectedOfferingId` starts null, nothing
 * auto-selects (not even when exactly one option exists), and NO contacts request
 * is issued until an instructor picks a course. Ordering carries no selection
 * meaning.
 *
 * COURSE SWITCHING is made safe structurally rather than by hand: the roster is
 * mounted with key={selectedOfferingId}, so a switch REMOUNTS it and the previous
 * course's rows and filters cannot survive into the next one.
 */
export function InstructorCourseScopedContactsSection() {
  const [options, setOptions] = useState<InstructorCourseOptionView[] | null>(null);
  const [optionsFailed, setOptionsFailed] = useState(false);
  const [selectedOfferingId, setSelectedOfferingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listInstructorContactCourseOptions()
      .then((result) => {
        if (!cancelled) setOptions(result);
      })
      .catch(() => {
        // The reader throws for an anonymous / wrong-audience / inactive
        // instructor. Fail closed: no options, no selection, no roster.
        if (!cancelled) setOptionsFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedOption =
    selectedOfferingId === null
      ? null
      : (options?.find((option) => option.id === selectedOfferingId) ?? null);

  if (optionsFailed) {
    return (
      <p className="rounded-2xl border border-border bg-card p-5 text-base text-muted-foreground">
        לא ניתן לטעון את רשימת הקורסים
      </p>
    );
  }

  if (options === null) {
    return <p className="text-base text-muted-foreground">טוען...</p>;
  }

  // An empty list is a legitimate fail-closed outcome (nothing is selectable) and
  // is never a reason to fall back to some other course.
  if (options.length === 0) {
    return (
      <p className="rounded-2xl border border-border bg-card p-5 text-base text-muted-foreground">
        אין קורס זמין לצפייה
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border border-border bg-card p-4">
        <p className="mb-2 text-sm font-semibold text-card-foreground">בחירת קורס</p>
        <div className="flex flex-wrap gap-2">
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setSelectedOfferingId(option.id)}
              className={`rounded-full px-3 py-1.5 text-sm font-semibold ${
                selectedOfferingId === option.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {option.label}
              {option.status !== "ACTIVE" && (
                <span className="mr-1.5 text-xs font-medium opacity-80">
                  ({option.status === "PLANNED" ? "טרם התחיל" : "הסתיים"})
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {selectedOfferingId === null ? (
        <p className="rounded-2xl border border-border bg-card p-5 text-base text-muted-foreground">
          יש לבחור קורס כדי לראות את רשימת החניכים
        </p>
      ) : (
        <>
          {/* The selected course stays visible above the roster, so the rows on
              screen are never ambiguous about which course they belong to. */}
          <p className="text-sm font-semibold text-card-foreground">
            מציג חניכים של: {selectedOption?.label ?? ""}
          </p>
          <InstructorContactsSection
            key={selectedOfferingId}
            courseOfferingId={selectedOfferingId}
          />
        </>
      )}
    </div>
  );
}
