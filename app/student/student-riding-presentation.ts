// Pure presentation-core for a student's riding schedule card. No "use client"
// / "use server" directive and no React, server action, Prisma, auth, headers,
// cookies, env, or DB import - the only runtime dependency is the pure
// getStudentScheduleTitle helper. ScheduleItemView is imported type-only, so it
// contributes nothing at runtime. This keeps the logic deterministic,
// side-effect-free, and unit-testable without loading the Client Component or
// instantiating the shared Prisma client.

import { getStudentScheduleTitle } from "@/lib/schedule-title";
import type { ScheduleItemView } from "@/lib/actions/student-schedule";

// A complex-mode riding slot (RidingSlot with a complexPlan relation) is
// shown to trainees as "תרגול הדרכה" (instruction practice), never the
// generic "רכיבה" title - regardless of whether its plan is published yet.
export const COMPLEX_RIDING_TITLE = "תרגול הדרכה";

export interface StudentRidingPresentation {
  // The student-facing card title: the complex label for a complex slot,
  // otherwise the existing shortened schedule title.
  title: string;
  // Whether to render the generic assignment coach/arena box. Never for a
  // complex slot (its coach/arena come only from the published complex plan);
  // the data layer already suppresses ridingInfo for complex slots, and this
  // keeps the presentation intent explicit and independent of that.
  showGenericRidingInfo: boolean;
  // Whether the published complex plan section is shown - unchanged from
  // today (present only when a publication exists). An unpublished complex
  // slot exposes nothing complex here.
  showComplexPlan: boolean;
}

// Pure presentation decision for one schedule item. Complexity is taken only
// from the typed isComplex flag threaded from the data layer - never inferred
// from the Hebrew title text or from publication state.
export function resolveStudentRidingPresentation(
  item: Pick<ScheduleItemView, "isComplex" | "title" | "ridingInfo" | "publishedComplexRidingPlan"> & {
    // LEVEL 2 COMPLEX-TITLE FIX - typed optional here on purpose so the resolver
    // is robust to an absent flag (treated identically to false via the
    // `!== true` check below). The server mapper in getScheduleForStudent always
    // sets it (required on ScheduleItemView); a required→optional shape is
    // assignable, so real callers are unaffected while tests can omit it.
    preserveOriginalComplexTitle?: boolean;
  }
): StudentRidingPresentation {
  return {
    // Title precedence:
    //  - a complex-mode slot with preserveOriginalComplexTitle !== true (Level 1,
    //    or an absent/false flag) shows the fixed "תרגול הדרכה" override;
    //  - otherwise (a non-complex item, OR a Level 2 complex slot with the flag
    //    true) the original title runs through getStudentScheduleTitle.
    // `!== true` means an absent/false flag keeps the legacy override and never
    // opts into preservation by accident.
    title:
      item.isComplex && item.preserveOriginalComplexTitle !== true
        ? COMPLEX_RIDING_TITLE
        : getStudentScheduleTitle(item.title),
    showGenericRidingInfo: !item.isComplex && item.ridingInfo !== null,
    showComplexPlan: item.publishedComplexRidingPlan !== null,
  };
}
