/**
 * MULTI-COURSE (Slice 4/6) - the minimal course dashboard shell.
 *
 * Intentionally thin: the persistent course identity banner is owned by the
 * nested layout, so this page does NOT refetch the CourseOffering merely to repeat
 * it. It runs no operational counts or global Student/Schedule/Duty/Feedback
 * queries.
 *
 * As of Slice 6 it re-validates the URL [courseOfferingId] through
 * requireAdminCourseOffering() (admin-authorization-first, exact-id lookup, no
 * cookie, no fallback) so the ONE course-scoped module link it now exposes - the
 * read-only groups view - is built from the validated context id, never the raw
 * param. Additional course-scoped modules will be added here one at a time, each
 * with its own server data boundary.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  requireAdminCourseOffering,
  CourseOfferingNotFoundError,
  type AdminCourseContext,
} from "@/lib/course/admin-course-context";

export const dynamic = "force-dynamic";

export default async function CourseDashboardPage({
  params,
}: {
  params: Promise<{ courseOfferingId: string }>;
}) {
  const { courseOfferingId } = await params;

  // Admin-authorization-first, then an exact-id lookup of this offering. Only the
  // typed not-found fails closed as notFound(); auth redirects and unexpected
  // errors propagate.
  let context: AdminCourseContext;
  try {
    context = await requireAdminCourseOffering(courseOfferingId);
  } catch (error) {
    if (error instanceof CourseOfferingNotFoundError) {
      notFound();
    }
    throw error;
  }

  const groupsHref = `/admin/courses/${encodeURIComponent(context.id)}/groups`;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-base font-semibold text-card-foreground">לוח הקורס</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          זהו שלד ניהול הקורס. מודולי הקורס (חניכים, סוסים, שיבוץ, משוב ועוד)
          יועברו לכאן בהדרגה, מודול אחד בכל פעם. בשלב זה אין עדיין מודולים תפעוליים
          תחת הקורס — הניהול התפעולי הקיים ממשיך לפעול כרגיל בתפריט הכללי.
        </p>
      </div>

      <Link
        href={groupsHref}
        className="rounded-xl border border-border bg-card p-5 transition-colors hover:bg-muted"
      >
        <h3 className="text-base font-semibold text-card-foreground">קבוצות</h3>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          מבנה הקבוצות והתת-קבוצות של הקורס, לקריאה בלבד.
        </p>
      </Link>

      <div>
        <Link
          href="/admin"
          className="text-sm font-medium text-muted-foreground underline-offset-2 hover:underline"
        >
          חזרה ללוח הבקרה הכללי
        </Link>
      </div>
    </div>
  );
}
