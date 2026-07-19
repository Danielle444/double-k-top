/**
 * MULTI-COURSE (Slice 4) - the minimal course dashboard shell.
 *
 * Intentionally thin: the persistent course identity banner is owned by the
 * nested layout, so this page does NOT refetch the CourseOffering merely to repeat
 * it. It renders only static/explanatory shell content and runs no operational
 * counts or global Student/Schedule/Duty/Feedback queries, and links to no
 * fabricated course-scoped module routes. Future course-scoped modules will be
 * added here one at a time, each with its own server data boundary.
 */
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/require-admin";

export const dynamic = "force-dynamic";

export default async function CourseDashboardPage() {
  // Explicit admin gate, matching existing admin pages.
  await requireAdmin();

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
