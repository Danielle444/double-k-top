/**
 * MULTI-COURSE (Slice 4) - the explicit admin CourseOffering selection page.
 *
 * This page is the always-available safe fallback: it lists every selectable
 * offering (PLANNED, ACTIVE, ARCHIVED) in the committed deterministic order and
 * lets the admin pick one explicitly. Selecting submits the offering id to the
 * validated server action - the page never builds a trusted destination from a
 * client value and never reads the convenience cookie.
 */
import { requireAdmin } from "@/lib/auth/require-admin";
import { listSelectableCourseOfferingsForAdmin } from "@/lib/course/offering-by-id";
import { selectAdminCourseOffering } from "@/app/admin/courses/actions";
import {
  CourseStatusBadge,
  formatCourseDateRange,
} from "@/app/admin/courses/CourseOfferingSelector";

export const dynamic = "force-dynamic";

export default async function AdminCoursesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  // Explicit admin gate even though the parent layout also authorizes.
  await requireAdmin();
  const { error } = await searchParams;
  const offerings = await listSelectableCourseOfferingsForAdmin();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold text-card-foreground">קורסים</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          בחירת מחזור קורס לניהול. הבחירה נשמרת לנוחות בלבד — כתובת ה־URL של הקורס
          היא המקור המחייב, וכל דף מאמת מחדש את ההרשאה.
        </p>
      </div>

      {error === "invalid" && (
        <div className="rounded-lg bg-danger-muted px-4 py-3 text-sm font-medium text-danger">
          הבחירה אינה תקפה. נא לבחור מחזור קורס מהרשימה.
        </div>
      )}

      {offerings.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">
            לא קיימים מחזורי קורס להצגה עדיין.
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {offerings.map((offering) => {
            const dateRange = formatCourseDateRange(offering.startDate, offering.endDate);
            const isArchived = offering.status === "ARCHIVED";
            return (
              <li key={offering.id}>
                <form action={selectAdminCourseOffering}>
                  <input type="hidden" name="courseOfferingId" value={offering.id} />
                  <button
                    type="submit"
                    className={`flex w-full flex-col gap-2 rounded-xl border border-border bg-card p-4 hover:bg-muted ${
                      isArchived ? "opacity-80" : ""
                    }`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-base font-semibold text-card-foreground">
                        {offering.name}
                      </span>
                      <CourseStatusBadge status={offering.status} />
                    </span>
                    <span className="text-sm text-muted-foreground">רמה {offering.level}</span>
                    <span className="text-sm text-muted-foreground">
                      {offering.activityYearName}
                    </span>
                    {dateRange && (
                      <span className="text-xs text-muted-foreground">{dateRange}</span>
                    )}
                    {isArchived && (
                      <span className="text-xs font-medium text-muted-foreground">
                        ארכיון · קריאה בלבד
                      </span>
                    )}
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
