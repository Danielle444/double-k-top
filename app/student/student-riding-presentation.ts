// Pure presentation-core for a student's riding schedule card. No "use client"
// / "use server" directive and no React, server action, Prisma, auth, headers,
// cookies, env, or DB import - the only runtime dependencies are the pure
// getStudentScheduleTitle and resolveComplexSessionTitle (RC-A0) helpers.
// ScheduleItemView is imported type-only, so it contributes nothing at runtime.
// This keeps the logic deterministic, side-effect-free, and unit-testable
// without loading the Client Component or instantiating the shared Prisma client.

import { getStudentScheduleTitle } from "@/lib/schedule-title";
import { resolveComplexSessionTitle } from "@/lib/riding-complex/complex-session-title-core";
import type { ScheduleItemView } from "@/lib/actions/student-schedule";

// RC-A4 - the GENERATED FALLBACK for a complex riding slot: a Level 1 slot (or
// an absent/false preserve flag) falls back to "תרגול הדרכה"; a Level 2 slot
// falls back to the preserved (shortened) ScheduleItem title. This is no longer
// the forced FINAL title - a manager's custom published title snapshot overrides
// it (see resolveStudentRidingPresentation below); it remains the fallback only.
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
  // GENERATED FALLBACK (unchanged precedence):
  //  - a complex-mode slot with preserveOriginalComplexTitle !== true (Level 1,
  //    or an absent/false flag) falls back to the fixed "תרגול הדרכה";
  //  - otherwise (a non-complex item, OR a Level 2 complex slot with the flag
  //    true) the original title runs through getStudentScheduleTitle.
  // `!== true` means an absent/false flag keeps the legacy fallback and never
  // opts into preservation by accident.
  const generatedFallback =
    item.isComplex && item.preserveOriginalComplexTitle !== true
      ? COMPLEX_RIDING_TITLE
      : getStudentScheduleTitle(item.title);

  // RC-A4 - a trainee only ever sees a complex session once it is PUBLISHED
  // (publishedComplexRidingPlan is non-null iff a publication exists for this
  // student's published week). When it is, the displayed title comes from the
  // PUBLISHED snapshot via the RC-A0 core (the custom title if present, else the
  // generated fallback) - it NEVER reads the live plan.title, so a post-publish
  // live edit cannot change what the trainee sees until re-publish. An
  // unpublished (or non-complex) slot always shows the generated fallback.
  const title =
    item.publishedComplexRidingPlan !== null
      ? resolveComplexSessionTitle({
          surface: "PUBLISHED",
          publishedTitleSnapshot: item.publishedComplexRidingPlan.titleSnapshot,
          generatedFallback,
        })
      : generatedFallback;

  return {
    title,
    showGenericRidingInfo: !item.isComplex && item.ridingInfo !== null,
    showComplexPlan: item.publishedComplexRidingPlan !== null,
  };
}
