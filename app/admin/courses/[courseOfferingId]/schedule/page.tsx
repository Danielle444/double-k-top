/**
 * MULTI-COURSE Schedule Slice W-S2B - the offering-scoped weekly-schedule admin
 * route.
 *
 * Server Component only. The URL [courseOfferingId] is the sole authoritative
 * scope and, in a fixed order:
 *   1. requireAdminCourseOffering() re-validates the admin AND exactly this
 *      offering (admin-authorization-first, exact-id lookup, no cookie, no
 *      fallback, no current-offering resolver). Only the typed not-found fails
 *      closed as notFound(), without reflecting the raw id;
 *   2. the READ is gated by the pure default-deny policy under HISTORICAL_READ
 *      (allowed for PLANNED/ACTIVE/ARCHIVED), mirroring the committed groups and
 *      enrollments pages;
 *   3. the week list is queried with `where: { courseOfferingId: context.id }` -
 *      the VALIDATED context id, never the raw route param. NULL-scoped legacy
 *      weeks, Level 1 weeks and any other offering's weeks are therefore
 *      structurally absent from this page, so the re-import affordance can only
 *      ever target a week this offering owns.
 *
 * The single mutation affordance (create / re-import) is shown only when the
 * offering's status permits SCHEDULE_DRAFT_CONFIGURATION (PLANNED and ACTIVE;
 * ARCHIVED never). The W-S2A writer re-checks that server-side, so this only
 * gates the visible UI. The action is bound with the validated context.id, so no
 * arbitrary target offering can be selected.
 *
 * Deliberately absent: publish/unpublish, delete, day-plan suggestion and
 * confirmation, duty generation, riding configuration, and any Level 1 global
 * schedule management. The nested course layout owns the visible course identity.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  requireAdminCourseOffering,
  CourseOfferingNotFoundError,
  type AdminCourseContext,
} from "@/lib/course/admin-course-context";
import {
  assertCourseOperationAllowed,
  evaluateCourseOperationPolicy,
} from "@/lib/course/operation-policy-core";
import { dateKey } from "@/lib/dates";
import { saveOfferingWeeklyScheduleAction } from "./actions";
import { OfferingScheduleClient, type OfferingWeekView } from "./OfferingScheduleClient";

export const dynamic = "force-dynamic";

export default async function CourseSchedulePage({
  params,
}: {
  params: Promise<{ courseOfferingId: string }>;
}) {
  const { courseOfferingId } = await params;

  // 1. Authorize the admin and re-validate EXACTLY this offering first.
  let context: AdminCourseContext;
  try {
    context = await requireAdminCourseOffering(courseOfferingId);
  } catch (error) {
    if (error instanceof CourseOfferingNotFoundError) {
      notFound();
    }
    throw error;
  }

  // 2. Gate the READ by the offering's status via the pure default-deny policy.
  assertCourseOperationAllowed(context.status, "HISTORICAL_READ");

  // 3. ONLY this offering's weeks. The filter uses the validated context id, so a
  //    NULL-scoped legacy week, a Level 1 week and another offering's week are all
  //    unreachable from this page.
  const weekRows = await prisma.weeklySchedule.findMany({
    where: { courseOfferingId: context.id },
    orderBy: [{ startDate: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      startDate: true,
      endDate: true,
      uploadedFileName: true,
      isPublished: true,
      _count: { select: { items: true } },
    },
  });

  const weeks: OfferingWeekView[] = weekRows.map((week) => ({
    id: week.id,
    name: week.name,
    startDate: dateKey(week.startDate),
    endDate: dateKey(week.endDate),
    uploadedFileName: week.uploadedFileName,
    isPublished: week.isPublished,
    itemCount: week._count.items,
  }));

  // The create / re-import affordance follows the same policy the writer enforces
  // (PLANNED and ACTIVE allowed, ARCHIVED denied). This only gates the visible UI.
  const canDraft = evaluateCourseOperationPolicy(
    context.status,
    "SCHEDULE_DRAFT_CONFIGURATION",
  ).allowed;

  const dashboardHref = `/admin/courses/${encodeURIComponent(context.id)}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-base font-semibold text-card-foreground">לוז שבועי של הקורס</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          העלאת לוז שבועי (Excel) עבור קורס זה בלבד. השבועות שנוצרים כאן משויכים
          לקורס זה ונשמרים כטיוטה — פרסום לחניכים, מחיקה, תכנון קבוצות יומי ויצירת
          שיבוצי תורנות אינם חלק ממסך זה.
        </p>
        <div className="mt-3">
          <Link
            href={dashboardHref}
            className="text-sm font-medium text-muted-foreground underline-offset-2 hover:underline"
          >
            חזרה ללוח הקורס
          </Link>
        </div>
      </div>

      {!canDraft && (
        <div className="rounded-xl border border-dashed border-border bg-muted p-5">
          <p className="text-sm text-muted-foreground">
            לא ניתן לערוך לוז בקורס במצב זה. רשימת השבועות מוצגת לקריאה בלבד.
          </p>
        </div>
      )}

      <OfferingScheduleClient
        weeks={weeks}
        canDraft={canDraft}
        scheduleBasePath={`/admin/courses/${encodeURIComponent(context.id)}/schedule`}
        action={saveOfferingWeeklyScheduleAction.bind(null, context.id)}
      />
    </div>
  );
}
