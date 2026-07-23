/**
 * MULTI-COURSE (Slice 6 / W9A-3) - admin view of a course's group structure,
 * with top-level group creation (W9A-3).
 *
 * Server Component only: it takes the URL [courseOfferingId] as the sole
 * authoritative scope and, in a fixed order,
 *   1. re-validates the admin + exact offering via requireAdminCourseOffering()
 *      (admin-authorization-first, exact-id lookup, no cookie, no fallback);
 *   2. asserts the read is permitted for that offering's status via the pure
 *      policy (HISTORICAL_READ - allowed for PLANNED/ACTIVE/ARCHIVED);
 *   3. reads EXACTLY that offering's group hierarchy with the validated context id.
 *
 * The existing group tree stays READ-ONLY: no rename, delete, reorder or subgroup
 * editing here. W9A-3 adds ONE mutation affordance - a minimal single-field form
 * to create one top-level group at a time - which posts the validated context id
 * to createCourseGroupAction. That action independently re-validates the admin +
 * exact offering and gates the write by OFFERING_STRUCTURE_UPDATE (allowed only
 * for PLANNED), so the create form is only actionable for a PLANNED offering. The
 * nested course layout owns the visible course identity and archived styling.
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
import { createCourseGroupAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Stable error-code -> Hebrew message map for the ?error= state. Only a stable
 * code is ever reflected; an unknown code falls back to the generic message.
 */
const GROUP_ERROR_MESSAGES: Record<string, string> = {
  name_required: "יש להזין שם קבוצה.",
  name_too_long: "שם הקבוצה ארוך מדי.",
  duplicate_name: "כבר קיימת קבוצה בשם זה בקורס זה.",
  operation_not_allowed: "לא ניתן להוסיף קבוצות לקורס במצב זה.",
  unexpected: "אירעה שגיאה. נסו שוב.",
};

export default async function CourseGroupsPage({
  params,
  searchParams,
}: {
  params: Promise<{ courseOfferingId: string }>;
  searchParams: Promise<{ error?: string; created?: string }>;
}) {
  const { courseOfferingId } = await params;
  const { error, created } = await searchParams;

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

  // Structural group creation (OFFERING_STRUCTURE_UPDATE) is permitted only for a
  // PLANNED offering; the action re-checks this server-side, so this only gates
  // the visible affordance. The reader itself never carries trainee/count data.
  const canCreateGroup = context.status === "PLANNED";
  const errorMessage = error
    ? (GROUP_ERROR_MESSAGES[error] ?? GROUP_ERROR_MESSAGES.unexpected)
    : null;
  const successMessage = created ? "הקבוצה נוצרה בהצלחה." : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-base font-semibold text-card-foreground">קבוצות</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          מבנה הקבוצות של הקורס. ניתן להוסיף קבוצות ראשיות בעלות שם חופשי. רשימת
          הקבוצות הקיימת היא לקריאה בלבד ואינה כוללת חניכים או נתוני שיוך.
        </p>
      </div>

      {errorMessage && (
        <div className="rounded-lg bg-danger-muted px-4 py-3 text-sm font-medium text-danger">
          {errorMessage}
        </div>
      )}

      {successMessage && (
        <div className="rounded-lg bg-success-muted px-4 py-3 text-sm font-medium text-success">
          {successMessage}
        </div>
      )}

      {canCreateGroup ? (
        <form
          action={createCourseGroupAction}
          className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5"
        >
          <input type="hidden" name="courseOfferingId" value={context.id} />
          <div>
            <h3 className="text-base font-semibold text-card-foreground">
              הוספת קבוצה ראשית
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              יש להזין שם קבוצה. השם חופשי (לדוגמה: א, ב) ואינו נבחר מתוך רשימה
              קבועה. נוצרת קבוצה ראשית אחת בכל פעם.
            </p>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-card-foreground">שם הקבוצה</span>
            <input
              type="text"
              name="name"
              required
              maxLength={100}
              className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-card-foreground"
            />
          </label>
          <div>
            <button
              type="submit"
              className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:opacity-80"
            >
              הוסף קבוצה
            </button>
          </div>
        </form>
      ) : (
        <div className="rounded-xl border border-dashed border-border bg-muted p-5">
          <p className="text-sm text-muted-foreground">
            ניתן להוסיף קבוצות רק בקורס במצב &quot;מתוכנן&quot;. מבנה הקבוצות למטה
            מוצג לקריאה בלבד.
          </p>
        </div>
      )}

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
