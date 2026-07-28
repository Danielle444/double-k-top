/**
 * RIDING PROGRESS COURSE SCOPE - S4: the PURE, DB-free view model for the
 * course-scoped riding-progress journal - the row's course projection, its chip
 * label, and the journal's local course filter.
 *
 * PURE by construction: no Prisma, no DB, no session, no clock, no randomness.
 * It is imported by BOTH the server readers (to build the projection) and the
 * client components (to render the chip and apply the filter), which is exactly
 * why the wording and the filter predicate live here: three call sites can never
 * drift into three different answers for the same row.
 *
 * LABEL WORDING IS NOT REDEFINED HERE. The chip text and the unscoped label are
 * delegated to the committed riding-history course label core, so a
 * RidingLessonNote row and a riding-progress row that belong to the same course
 * are always labelled identically, and a legacy unattributed row reads the same
 * neutral text in both journals.
 *
 * FAIL CLOSED ON IDENTITY: a row whose courseOffering relation is null (a legacy
 * row written before S2) projects to null and renders the neutral unscoped
 * label. It is NEVER promoted to Level 1, never guessed from a date, a group, a
 * topic, an offering name, a route or a cookie - this module accepts none of
 * those as input.
 */
import {
  formatRidingHistoryCourseLabel,
  RIDING_HISTORY_COURSE_UNSCOPED_LABEL,
} from "./riding-history-course-scope-core";

/** The course identity carried by one riding-progress row, or null when legacy. */
export interface RidingProgressCourseProjection {
  readonly id: string;
  readonly level: number;
  /** The offering's own name. Secondary context only - never parsed for a level. */
  readonly name: string;
  /** The compact chip text, e.g. "רמה 1". Derived from `level`, never from `name`. */
  readonly label: string;
}

/**
 * Shown for a row with no course identity. Re-exported from the committed
 * riding-history core rather than restated, so the two journals can never
 * disagree about the wording.
 */
export const RIDING_PROGRESS_UNSCOPED_COURSE_LABEL = RIDING_HISTORY_COURSE_UNSCOPED_LABEL;

/** The offering columns a reader must project for the chip. */
export interface RidingProgressCourseOfferingInput {
  readonly id: string;
  readonly name: string;
  readonly level: number;
}

/**
 * Build a row's course projection from its joined offering.
 *
 * All-or-nothing: a missing/partial offering yields null rather than a partially
 * identified course, so the chip can never show a level the database did not
 * supply.
 */
export function buildRidingProgressCourseProjection(
  offering: RidingProgressCourseOfferingInput | null | undefined,
): RidingProgressCourseProjection | null {
  if (!offering) return null;
  if (typeof offering.id !== "string" || offering.id.length === 0) return null;
  if (!Number.isInteger(offering.level)) return null;
  return {
    id: offering.id,
    level: offering.level,
    name: offering.name,
    label: formatRidingHistoryCourseLabel({
      courseOfferingId: offering.id,
      courseName: offering.name,
      courseLevel: offering.level,
    }),
  };
}

/** The chip text for a row, including the neutral text for an unscoped row. */
export function ridingProgressCourseChipLabel(
  projection: RidingProgressCourseProjection | null | undefined,
): string {
  return projection?.label ?? RIDING_PROGRESS_UNSCOPED_COURSE_LABEL;
}

// ---------------------------------------------------------------------------
// The journal's local course filter
// ---------------------------------------------------------------------------

export type RidingProgressCourseFilter = "ALL" | "LEVEL_1" | "LEVEL_2" | "UNSCOPED";

/** The default filter: every row is visible until the user narrows it. */
export const RIDING_PROGRESS_DEFAULT_COURSE_FILTER: RidingProgressCourseFilter = "ALL";

/**
 * The filter options, in display order.
 *
 * All four are ALWAYS offered, including "ללא שיוך קורס" even when no unscoped
 * row is currently loaded: the option's presence is what tells a manager that
 * unattributed rows are a real category rather than something the screen hides.
 */
export const RIDING_PROGRESS_COURSE_FILTER_OPTIONS: readonly {
  readonly value: RidingProgressCourseFilter;
  readonly label: string;
}[] = [
  { value: "ALL", label: "הכול" },
  { value: "LEVEL_1", label: "רמה 1" },
  { value: "LEVEL_2", label: "רמה 2" },
  { value: "UNSCOPED", label: RIDING_PROGRESS_UNSCOPED_COURSE_LABEL },
];

/** The minimal row shape the filter needs. */
export interface RidingProgressFilterableRow {
  readonly courseOffering: RidingProgressCourseProjection | null;
}

/**
 * Does this row belong in the current filter?
 *
 * Matching is on the DB-backed `level` and on null-ness - never on the offering
 * NAME, which is admin-editable free text. An unknown filter value falls through
 * to `false` rather than silently showing everything.
 */
export function matchesRidingProgressCourseFilter(
  row: RidingProgressFilterableRow,
  filter: RidingProgressCourseFilter,
): boolean {
  switch (filter) {
    case "ALL":
      return true;
    case "LEVEL_1":
      return row.courseOffering?.level === 1;
    case "LEVEL_2":
      return row.courseOffering?.level === 2;
    case "UNSCOPED":
      return row.courseOffering === null;
    default:
      return false;
  }
}

/**
 * Apply the filter. Returns a NEW array and never mutates or reorders the input,
 * so the journal's existing newest-first sort is preserved exactly.
 *
 * VISIBILITY ONLY: this narrows what is displayed. It must never be used to
 * build the set the combined average is computed from - see
 * RIDING_PROGRESS_COMBINED_AVERAGE_LABEL.
 */
export function filterRidingProgressRowsByCourse<T extends RidingProgressFilterableRow>(
  rows: readonly T[],
  filter: RidingProgressCourseFilter,
): T[] {
  return rows.filter((row) => matchesRidingProgressCourseFilter(row, filter));
}

/**
 * The label the "רכיבה" section's average MUST carry.
 *
 * The number pools every course together, so it is stated as combined rather
 * than being allowed to read as though it belonged to the selected filter.
 * Per-course averages are deliberately out of scope for S4.
 */
export const RIDING_PROGRESS_COMBINED_AVERAGE_LABEL = "ממוצע משולב לכל הקורסים";
