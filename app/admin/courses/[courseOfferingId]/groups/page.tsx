/**
 * MULTI-COURSE (Slice 6) - read-only admin view of a course's group structure.
 *
 * This is the FIRST runtime consumer of the dormant Slice 5 group-tree reader. It
 * is a Server Component only: it takes the URL [courseOfferingId] as the sole
 * authoritative scope and, in a fixed order,
 *   1. re-validates the admin + exact offering via requireAdminCourseOffering()
 *      (admin-authorization-first, exact-id lookup, no cookie, no fallback);
 *   2. asserts the operation is permitted for that offering's status via the pure
 *      policy (HISTORICAL_READ - allowed for PLANNED/ACTIVE/ARCHIVED);
 *   3. reads EXACTLY that offering's group hierarchy with the validated context id.
 *
 * It renders only structural group/subgroup NAMES plus a generic anomaly count.
 * It reads no Student, enrollment, membership or count data (the reader cannot
 * carry them), exposes no raw database ids, and has no write path: no form, no
 * button that mutates, no action, no revalidation, no autosave, no DB mutation.
 * The nested course layout owns the visible course identity and archived/read-only
 * styling; this page adds only the "view-only" affordance for the groups module.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  requireAdminCourseOffering,
  CourseOfferingNotFoundError,
  type AdminCourseContext,
} from "@/lib/course/admin-course-context";
import { assertCourseOperationAllowed } from "@/lib/course/operation-policy-core";
import {
  getCourseGroupTreeByOfferingId,
  type CourseGroupTreeView,
} from "@/lib/course/course-group-tree";

export const dynamic = "force-dynamic";

export default async function CourseGroupsPage({
  params,
}: {
  params: Promise<{ courseOfferingId: string }>;
}) {
  const { courseOfferingId } = await params;

  // 1. Authorize the admin and re-validate EXACTLY this offering first. Auth
  //    redirects and unexpected errors propagate; only a typed not-found (invalid
  //    or nonexistent id) fails closed as notFound() without reflecting the id.
  let context: AdminCourseContext;
  try {
    context = await requireAdminCourseOffering(courseOfferingId);
  } catch (error) {
    if (error instanceof CourseOfferingNotFoundError) {
      notFound();
    }
    throw error;
  }

  // 2. Only after the context is validated, gate the read by the offering's
  //    status via the pure default-deny policy. HISTORICAL_READ is allowed for
  //    PLANNED/ACTIVE/ARCHIVED; a future non-readable status would throw.
  assertCourseOperationAllowed(context.status, "HISTORICAL_READ");

  // 3. Read exactly this offering's group tree, using ONLY the validated context
  //    id - never the raw param, a cookie or the singleton resolver.
  const tree: CourseGroupTreeView | null = await getCourseGroupTreeByOfferingId(
    context.id,
  );

  // The reader only returns null for an invalid id, which the validated context id
  // cannot be. Fail closed anyway rather than render a partial/uncertain view.
  if (tree === null) {
    notFound();
  }

  const dashboardHref = `/admin/courses/${encodeURIComponent(context.id)}`;
  const hasGroups = tree.topLevel.length > 0;
  const anomalyCount = tree.anomalies.length;
  const isEmpty = !hasGroups && anomalyCount === 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-card-foreground">קבוצות</h2>
          <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
            לצפייה בלבד
          </span>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          מבנה הקבוצות והתת-קבוצות של הקורס. תצוגה זו היא לקריאה בלבד ואינה כוללת
          חניכים או נתוני שיוך.
        </p>
      </div>

      {isEmpty && (
        <div className="rounded-xl border border-dashed border-border bg-muted p-5">
          <p className="text-sm text-muted-foreground">
            לא הוגדרו קבוצות עבור קורס זה.
          </p>
        </div>
      )}

      {hasGroups && (
        <ul className="flex flex-col gap-3">
          {tree.topLevel.map((group) => (
            <li
              key={group.id}
              className="rounded-xl border border-border bg-card p-4"
            >
              <h3 className="text-sm font-semibold text-card-foreground">
                {group.name}
              </h3>
              {group.subgroups.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1 border-r border-border pr-3">
                  {group.subgroups.map((subgroup) => (
                    <li key={subgroup.id} className="text-sm text-muted-foreground">
                      {subgroup.name}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      {anomalyCount > 0 && (
        <div className="rounded-lg bg-warning-muted px-3 py-2 text-xs font-medium text-warning">
          שים לב: נמצאו {anomalyCount} רשומות מבנה שאינן תקינות ואינן מוצגות במבנה
          שלמעלה. יש לבדוק את הגדרת הקבוצות של הקורס.
        </div>
      )}

      <div>
        <Link
          href={dashboardHref}
          className="text-sm font-medium text-muted-foreground underline-offset-2 hover:underline"
        >
          חזרה ללוח הקורס
        </Link>
      </div>
    </div>
  );
}
