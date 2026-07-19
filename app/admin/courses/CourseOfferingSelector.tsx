/**
 * MULTI-COURSE (Slice 4) - small presentational helpers shared by the admin
 * course-shell surface (the selection page and the nested course layout).
 *
 * This is a pure presentational Server module: it renders UI and holds the single
 * closed status-label map so the label/badge treatment is defined once instead of
 * being duplicated across the shell files. It performs NO authorization, NO data
 * loading and NO cookie access; the course switcher form merely submits a single
 * candidate id to the validated server action, which re-authorizes and validates
 * before it trusts anything.
 */
import type { CourseOfferingStatus } from "@/app/generated/prisma/client";
import type { SelectableCourseOfferingView } from "@/lib/course/offering-by-id-core";
import { formatHebrewDate } from "@/lib/dates";
import { selectAdminCourseOffering } from "@/app/admin/courses/actions";

/**
 * The one closed Hebrew status map for the whole course-shell surface. The enum
 * has exactly these three members (see prisma schema / the Slice 1 STATUS_RANK);
 * COMPLETED is intentionally absent.
 */
export const COURSE_STATUS_LABELS: Record<CourseOfferingStatus, string> = {
  PLANNED: "מתוכנן",
  ACTIVE: "פעיל",
  ARCHIVED: "ארכיון",
};

// ARCHIVED reads as historical/muted; ACTIVE as live; PLANNED as pending.
const STATUS_BADGE_CLASSES: Record<CourseOfferingStatus, string> = {
  PLANNED: "bg-warning-muted text-warning",
  ACTIVE: "bg-success-muted text-success",
  ARCHIVED: "bg-muted text-muted-foreground",
};

export function CourseStatusBadge({ status }: { status: CourseOfferingStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_BADGE_CLASSES[status]}`}
    >
      {COURSE_STATUS_LABELS[status]}
    </span>
  );
}

/**
 * Render the offering date range when present. A PLANNED offering may have null
 * dates (schema: @db.Date optional) - we never fabricate a date, returning null
 * so the caller can omit the line entirely.
 */
export function formatCourseDateRange(
  startDate: Date | null,
  endDate: Date | null,
): string | null {
  if (startDate && endDate) {
    return `${formatHebrewDate(startDate)} – ${formatHebrewDate(endDate)}`;
  }
  if (startDate) {
    return `החל מ-${formatHebrewDate(startDate)}`;
  }
  if (endDate) {
    return `עד ${formatHebrewDate(endDate)}`;
  }
  return null;
}

/**
 * The course switcher: a plain server-rendered <form> that submits ONLY a single
 * id candidate to the validated server action. It carries no client state and no
 * cookie authority - the candidate is never trusted here; the action re-runs
 * requireAdminCourseOffering() before it redirects. Submitting only navigates the
 * current tab (a normal POST->redirect); other open tabs keep their own URLs.
 */
export function CourseOfferingSwitcherForm({
  offerings,
  currentId,
}: {
  offerings: SelectableCourseOfferingView[];
  currentId: string;
}) {
  return (
    <form action={selectAdminCourseOffering} className="flex flex-wrap items-center gap-2">
      <label htmlFor="course-switcher" className="text-xs font-medium text-muted-foreground">
        מעבר לקורס אחר
      </label>
      <select
        id="course-switcher"
        name="courseOfferingId"
        defaultValue={currentId}
        className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-card-foreground"
      >
        {offerings.map((offering) => (
          <option key={offering.id} value={offering.id}>
            {`${offering.name} · רמה ${offering.level} · ${COURSE_STATUS_LABELS[offering.status]}`}
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="rounded-lg bg-secondary px-3 py-1.5 text-sm font-medium text-secondary-foreground hover:opacity-80"
      >
        מעבר
      </button>
    </form>
  );
}
