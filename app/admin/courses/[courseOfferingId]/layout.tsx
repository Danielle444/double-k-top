/**
 * MULTI-COURSE (Slice 4) - the nested, course-aware admin layout.
 *
 * This layout OWNS the visible course identity for every nested course page. The
 * authoritative scope is the URL [courseOfferingId], re-validated here on every
 * request via requireAdminCourseOffering() (admin-authorization-first, then an
 * exact-id lookup - no cookie, no fallback). Only the typed
 * CourseOfferingNotFoundError is translated to notFound(); Next auth redirects and
 * unexpected errors propagate untouched.
 *
 * There is deliberately NO client-side course context provider: course identity
 * is a server boundary, so future course-scoped child pages independently re-call
 * requireAdminCourseOffering(params.courseOfferingId) for their own data instead
 * of trusting a shared client authority.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  requireAdminCourseOffering,
  CourseOfferingNotFoundError,
  type AdminCourseContext,
} from "@/lib/course/admin-course-context";
import { listSelectableCourseOfferingsForAdmin } from "@/lib/course/offering-by-id";
import {
  CourseStatusBadge,
  CourseOfferingSwitcherForm,
  formatCourseDateRange,
} from "@/app/admin/courses/CourseOfferingSelector";

export default async function CourseShellLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ courseOfferingId: string }>;
}) {
  const { courseOfferingId } = await params;

  let context: AdminCourseContext;
  try {
    // requireAdminCourseOffering() authorizes the admin first (may redirect
    // unauthenticated callers), then resolves exactly this offering.
    context = await requireAdminCourseOffering(courseOfferingId);
  } catch (error) {
    if (error instanceof CourseOfferingNotFoundError) {
      // Fail closed for an invalid/nonexistent id without exposing the raw id.
      notFound();
    }
    // Auth redirects and unexpected errors propagate.
    throw error;
  }

  const offerings = await listSelectableCourseOfferingsForAdmin();
  const dateRange = formatCourseDateRange(context.startDate, context.endDate);
  const isArchived = context.status === "ARCHIVED";

  return (
    <div className="flex flex-col gap-6">
      <section
        className={`rounded-xl border p-5 ${
          isArchived ? "border-dashed border-border bg-muted" : "border-border bg-card"
        }`}
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-card-foreground">{context.name}</h1>
              <CourseStatusBadge status={context.status} />
            </div>
            <Link
              href="/admin/courses"
              className="text-sm font-medium text-muted-foreground underline-offset-2 hover:underline"
            >
              → כל הקורסים
            </Link>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span>רמה {context.level}</span>
            {dateRange && <span>{dateRange}</span>}
          </div>

          {isArchived && (
            <p className="rounded-lg bg-warning-muted px-3 py-2 text-xs font-medium text-warning">
              קורס בארכיון — קריאה בלבד. אין לבצע פעולות עריכה תחת מחזור זה.
            </p>
          )}

          <CourseOfferingSwitcherForm offerings={offerings} currentId={context.id} />
        </div>
      </section>

      <div>{children}</div>
    </div>
  );
}
