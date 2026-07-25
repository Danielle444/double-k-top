/**
 * COMBINED PARTICIPATION - SLICE 2: PURE visibility core for the TRAINEE
 * schedule read.
 *
 * PURE by construction: no Prisma, no DB, no clock, no randomness, no env, no
 * auth/session/cookie read. It receives already-fetched enrollment rows plus a
 * server-resolved offering context and decides which schedule items a trainee
 * may see. The whole contract is unit-testable without a database (see
 * combined-participation-visibility-core.test.ts).
 *
 * THE LOCKED RULE (this core's single reason to exist)
 * ----------------------------------------------------
 *  - DUAL-enrolled trainee + selected offering is LEVEL 2 + the item's
 *    combinedParticipation is STRICTLY false  -> the item is HIDDEN.
 *  - dual + Level 2 + true or null            -> shown.
 *  - Level-2-ONLY trainee (not dual)          -> ALL items shown, flag ignored.
 *  - Level 1 selected                         -> unchanged (nothing hidden).
 *  - Admin / instructor readers               -> never call this core at all.
 *
 * SERVER-OWNED FACTS ONLY
 * -----------------------
 *  - "Is the selected offering Level 2" comes from the DB-backed
 *    CourseOffering.level of the SERVER-RESOLVED offering - never from a client
 *    flag, an offering-id constant, a name, or a date window.
 *  - "Is this trainee dual" is DERIVED here from the trainee's own enrollment
 *    rows via the SHARED eligibility definition
 *    (eligibleTraineeOfferingsFromRows): only an ACTIVE CourseEnrollment into
 *    an ACTIVE CourseOffering counts, duplicate enrollments into one offering
 *    collapse to one course, and dual means "at least one eligible offering
 *    OTHER THAN the selected one". INACTIVE enrollments and PLANNED/ARCHIVED
 *    offerings can therefore never make a trainee dual, exactly as they can
 *    never make an offering selectable.
 *  - No client-supplied dual flag exists anywhere in this module's surface. The
 *    DI orchestration below takes the trainee id ONLY from the injected session
 *    reader, and the selected offering id it receives is the server's own
 *    already-resolved copy, never a raw request value.
 */
import type { TraineeEnrollmentOfferingRow } from "./actor-course-offering-core";
import {
  buildTraineeCourseSelectionQuery,
  eligibleTraineeOfferingsFromRows,
  type TraineeCourseSelectionDeps,
} from "./trainee-course-selection-core";
import { dateKey, formatHebrewDate, formatHebrewWeekday } from "@/lib/dates";

/**
 * The one course level at which the hide rule applies. A LEVEL number backed by
 * CourseOffering.level - deliberately NOT an offering id, so no environment or
 * data reshuffle can silently re-point the rule at a different course, and no
 * hardcoded cuid exists here.
 */
export const COMBINED_PARTICIPATION_HIDDEN_LEVEL = 2;

/**
 * Is this trainee DUAL-enrolled relative to the selected offering?
 *
 * Reuses the SINGLE eligibility definition shared with the course-selection
 * menu and resolver (ACTIVE enrollment AND ACTIVE offering, distinct by
 * offering id), so "dual" here can never drift from "has more than one
 * selectable course" there. Duplicate enrollment rows into one offering,
 * INACTIVE enrollments and PLANNED/ARCHIVED offerings are all non-inflating by
 * construction, because they are dropped before either check below runs.
 *
 * Dual requires BOTH:
 *  1. the selected offering itself is one of the trainee's eligible offerings
 *     (in the real call path this always holds - the selected id only ever
 *     reaches here after resolveTraineeSelectedCourseOffering has already
 *     authorized it against this same eligible set - but the pure function
 *     stays correct even if handed a selected id the trainee has no eligible
 *     row for, which must never read as "dual");
 *  2. at least one OTHER distinct eligible offering exists besides it.
 */
export function isTraineeDualEnrolledFromRows(
  rows: readonly TraineeEnrollmentOfferingRow[],
  selectedCourseOfferingId: string,
): boolean {
  if (typeof selectedCourseOfferingId !== "string" || selectedCourseOfferingId.length === 0) {
    // A blank selected id is a programming error upstream; the honest answer is
    // "not dual" regardless. Callers always pass the server-resolved offering
    // id, so this branch is defensive only.
    return false;
  }
  const eligible = eligibleTraineeOfferingsFromRows(rows);
  const isSelectedEligible = eligible.some((o) => o.id === selectedCourseOfferingId);
  if (!isSelectedEligible) {
    return false;
  }
  return eligible.some((o) => o.id !== selectedCourseOfferingId);
}

/** The server-derived facts the visibility decision needs - nothing more. */
export interface CombinedParticipationVisibilityContext {
  /** DB-backed level of the SERVER-RESOLVED selected offering. */
  readonly offeringLevel: number;
  /** Server-derived via {@link isTraineeDualEnrolledFromRows} - never a client flag. */
  readonly isDualEnrolled: boolean;
}

/**
 * Does the hide rule apply AT ALL for this trainee + selected offering? Only
 * for a DUAL trainee whose SELECTED offering is Level 2. A Level-2-only trainee
 * (not dual) and any Level 1 context are exempt, so their item lists are
 * byte-identical to the pre-Slice-2 behaviour.
 */
export function shouldHideCombinedParticipationItems(
  context: CombinedParticipationVisibilityContext,
): boolean {
  return context.offeringLevel === COMBINED_PARTICIPATION_HIDDEN_LEVEL && context.isDualEnrolled;
}

/**
 * Apply the locked rule to an already-authorized item list.
 *
 * Hiding matches STRICTLY `combinedParticipation === false`: true and null are
 * always shown (null means "not stated", and an unstated session must never
 * disappear). Items are passed through by REFERENCE and in order, so every
 * surviving item - including its combinedParticipation badge value - reaches
 * the mapper verbatim; this function only ever removes, never mutates.
 */
export function filterTraineeScheduleItemsForCombinedParticipation<
  T extends { combinedParticipation: boolean | null },
>(items: readonly T[], context: CombinedParticipationVisibilityContext): T[] {
  if (!shouldHideCombinedParticipationItems(context)) {
    return [...items];
  }
  return items.filter((item) => item.combinedParticipation !== false);
}

// ---------------------------------------------------------------------------
// SLICE 2.1 - compact placeholders for hidden Level 2 items
//
// The filter above REMOVES combinedParticipation === false items outright for
// a dual trainee viewing Level 2, which leaves large empty gaps in the
// rendered schedule. This section builds a SEPARATE, deliberately reduced
// stand-in for each removed time range - never the removed item(s)
// themselves - so the gap reads as "something is here, go check Level 1"
// without exposing the hidden session's group, title, description, location,
// instructor, notes, horse assignment or participants. Only day and time
// range survive (schedule layout needs them and neither is on the forbidden
// list) - groupName is EXCLUDED even though it's on the source row, because
// it is itself derived from the hidden item and merging must not depend on
// it (see below). The wording is two FIXED strings, never derived from the
// hidden item(s).
// ---------------------------------------------------------------------------

/** The only text a placeholder ever carries - fixed, never item-derived. */
export const COMBINED_PARTICIPATION_PLACEHOLDER_TITLE = "זמן עם לו״ז רמה 1";
export const COMBINED_PARTICIPATION_PLACEHOLDER_DESCRIPTION = "יש לעבור ללוח רמה 1 לפרטים";

/**
 * The minimal, non-identifying shape the placeholder builder needs from a
 * schedule row: enough to bucket, sort and merge by day/time - nothing that
 * could describe what the hidden session actually was. groupName is
 * deliberately NOT part of this shape: the builder must never read it, so a
 * hidden item's group can never influence merging or reach the output.
 */
export interface CombinedParticipationScheduleItemShape {
  readonly id: string;
  readonly date: Date;
  readonly startTime: string;
  readonly endTime: string;
  readonly combinedParticipation: boolean | null;
}

/**
 * A compact stand-in for one or more merged hidden Level 2 items covering one
 * contiguous/overlapping time range, on one day, ACROSS every hidden group
 * (a placeholder never carries or is scoped by group - see the shape above).
 * This object IS the entire surface sent to the client for a hidden range -
 * its id is opaque and content-free (built only from source ids, never from
 * source text), and every field beyond day/time is the fixed wording above.
 */
export interface CombinedParticipationHiddenPlaceholder {
  readonly id: string;
  readonly dateKey: string;
  readonly dateLabel: string;
  readonly dayLabel: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly title: string;
  readonly description: string;
}

/**
 * Builds one placeholder per contiguous-or-overlapping run of hidden items,
 * per day, MERGING ACROSS GROUPS - two different groups' hidden items at the
 * same time must produce exactly one placeholder, never one per group,
 * because a placeholder carries no group and duplicate same-time cards for
 * one trainee would be confusing/wrong. Returns [] whenever the hide rule
 * doesn't apply (Level-2-only trainee, Level 1 selected) or nothing is
 * actually hidden - the exact same applicability gate as
 * {@link filterTraineeScheduleItemsForCombinedParticipation}, so the two
 * functions can never disagree about WHICH items are hidden, only about what
 * happens to them afterward (dropped vs. replaced).
 */
export function buildHiddenCombinedParticipationPlaceholders<
  T extends CombinedParticipationScheduleItemShape,
>(
  items: readonly T[],
  context: CombinedParticipationVisibilityContext,
): CombinedParticipationHiddenPlaceholder[] {
  if (!shouldHideCombinedParticipationItems(context)) return [];
  const hidden = items.filter((item) => item.combinedParticipation === false);
  if (hidden.length === 0) return [];

  // Bucket by day ONLY - never by group. A placeholder must never merge
  // across a day boundary, but MUST merge across a group boundary within the
  // same day when the time ranges touch or overlap (see the loop below).
  const buckets = new Map<string, T[]>();
  for (const item of hidden) {
    const bucketKey = dateKey(item.date);
    const bucket = buckets.get(bucketKey);
    if (bucket) bucket.push(item);
    else buckets.set(bucketKey, [item]);
  }

  const placeholders: CombinedParticipationHiddenPlaceholder[] = [];
  for (const bucket of buckets.values()) {
    const sorted = [...bucket].sort((a, b) => a.startTime.localeCompare(b.startTime));
    let run: T[] = [sorted[0]];
    let runEnd = sorted[0].endTime;
    const flush = () => {
      const first = run[0];
      placeholders.push({
        id: `combined-participation-placeholder:${run.map((i) => i.id).join("+")}`,
        dateKey: dateKey(first.date),
        dateLabel: formatHebrewDate(first.date),
        dayLabel: formatHebrewWeekday(first.date),
        startTime: first.startTime,
        endTime: runEnd,
        title: COMBINED_PARTICIPATION_PLACEHOLDER_TITLE,
        description: COMBINED_PARTICIPATION_PLACEHOLDER_DESCRIPTION,
      });
    };
    // Touching (next.startTime === runEnd) or overlapping (next.startTime <
    // runEnd) runs merge into one placeholder; a real gap starts a new one.
    for (let idx = 1; idx < sorted.length; idx++) {
      const next = sorted[idx];
      if (next.startTime <= runEnd) {
        if (next.endTime > runEnd) runEnd = next.endTime;
        run.push(next);
      } else {
        flush();
        run = [next];
        runEnd = next.endTime;
      }
    }
    flush();
  }

  placeholders.sort((a, b) => a.dateKey.localeCompare(b.dateKey) || a.startTime.localeCompare(b.startTime));
  return placeholders;
}

// ---------------------------------------------------------------------------
// Dependency-injected orchestration
//
// Lives in the PURE core (repo convention - see trainee-course-selection-core):
// it performs no IO itself, only sequences injected boundaries, so the DB-free
// tests can prove the identity source, the exact query shape and the
// single-fetch (no N+1) property without Prisma or next/headers.
// ---------------------------------------------------------------------------

/**
 * Derive the authenticated trainee's dual-enrollment status for a
 * SERVER-RESOLVED selected offering.
 *
 * Identity comes ONLY from the injected session reader - this function accepts
 * no student id and no dual flag, so no client value can participate. It issues
 * EXACTLY ONE enrollment fetch, using the same query shape as the trainee
 * course-selection resolver (buildTraineeCourseSelectionQuery: the session
 * trainee's ACTIVE enrollments into ACTIVE offerings); the selected offering id
 * never reaches the query and is only compared against the rows that come back.
 */
export async function resolveTraineeDualEnrollmentWithDeps(
  selectedCourseOfferingId: string,
  deps: TraineeCourseSelectionDeps,
): Promise<boolean> {
  const studentId = await deps.requireTraineeId();
  const rows = await deps.fetchTraineeEnrollmentRows(buildTraineeCourseSelectionQuery(studentId));
  return isTraineeDualEnrolledFromRows(rows, selectedCourseOfferingId);
}
