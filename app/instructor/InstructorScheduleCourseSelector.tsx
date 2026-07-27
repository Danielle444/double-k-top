"use client";

import { useEffect, useRef, useState } from "react";
import {
  listInstructorContactCourseOptions,
  type InstructorCourseOptionView,
} from "@/lib/actions/instructor-course-options";

/**
 * LEVEL 2 SLICE S2A: the compact SCHEDULE course selector.
 *
 * SCREEN-LOCAL BY DESIGN, and shared by the two schedule surfaces ONLY (the
 * schedule tab and the today card). It owns the OPTIONS it fetches; it does NOT
 * own the selection - each mounting screen owns its own `selectedOfferingId`, so
 * two mounted screens can sit on two different courses simultaneously and
 * neither can move the other. There is no context, no module-level variable and
 * no shared parent state anywhere in this file.
 *
 * IT DOES NOT TOUCH CONTACTS. The contacts tab keeps its own separate selector
 * (InstructorCourseScopedContactsSection), which this slice does not modify and
 * does not import. Only the underlying server options ACTION is shared - a
 * read-only menu that grants nothing - so the two surfaces cannot influence one
 * another through it.
 *
 * THE MENU IS NOT AUTHORIZATION. The options come from the server, which owns
 * the allow-list, the labels and the ordering; this component knows no offering
 * id, no level and no course name of its own. Choosing an option only decides
 * which id is REQUESTED - every schedule read re-validates it server-side
 * (identity -> resolveInstructorCourseOffering -> SCHEDULE capability -> an
 * offering-scoped query), so nothing here can widen access.
 *
 * THIS COMPONENT STILL NEVER SELECTS ANYTHING. It owns no selection and applies
 * no default: it neither calls onSelectOffering on its own nor knows what a
 * default would be, and its display ordering still carries no selection meaning.
 *
 * IUS-2E adds one OPTIONAL, purely informational callback - onOptionsLoaded -
 * which hands the already-fetched, server-composed option list back to the
 * MOUNTING SCREEN. A screen that wants an automatic default decides it there
 * (see pickInstructorDefaultOfferingId), which keeps that policy out of this
 * shared menu and out of the contacts surface entirely. Omitting the callback
 * leaves this component's behaviour byte-for-byte as before.
 *
 * The action is named ...ContactCourseOptions for historical reasons (it shipped
 * with the contacts slice). It is course-agnostic - an instructor course MENU
 * with no contacts-specific behaviour - and is deliberately NOT renamed here:
 * renaming it would mean editing working contacts files for cosmetics.
 */
export function InstructorScheduleCourseSelector({
  selectedOfferingId,
  onSelectOffering,
  onOptionsLoaded,
}: {
  selectedOfferingId: string | null;
  onSelectOffering: (courseOfferingId: string) => void;
  // IUS-2E - OPTIONAL. Called at most once per mount, with the loaded
  // server-composed option list, and ONLY on the success path: a failed or
  // cancelled load never invokes it, so a mounting screen can never apply a
  // default off a partial/absent menu. Purely informational - this component
  // still selects nothing itself.
  onOptionsLoaded?: (options: InstructorCourseOptionView[]) => void;
}) {
  const [options, setOptions] = useState<InstructorCourseOptionView[] | null>(null);
  const [optionsFailed, setOptionsFailed] = useState(false);

  // Latest-callback ref so the load effect below keeps its EMPTY dependency
  // array: this shared selector must issue exactly ONE options request per
  // mount, and taking the callback as a dependency would re-fetch on every
  // render for any caller that passes an inline function.
  const onOptionsLoadedRef = useRef(onOptionsLoaded);
  useEffect(() => {
    onOptionsLoadedRef.current = onOptionsLoaded;
  }, [onOptionsLoaded]);

  useEffect(() => {
    let cancelled = false;
    listInstructorContactCourseOptions()
      .then((result) => {
        if (cancelled) return;
        setOptions(result);
        // After the options are committed, and never on the catch path.
        onOptionsLoadedRef.current?.(result);
      })
      .catch(() => {
        // The reader throws for an anonymous / wrong-audience / inactive
        // instructor. Fail closed: no options, no selection, no schedule.
        if (!cancelled) setOptionsFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="mb-2 text-sm font-semibold text-card-foreground">בחירת קורס</p>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onSelectOffering(option.id)}
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
  );
}
