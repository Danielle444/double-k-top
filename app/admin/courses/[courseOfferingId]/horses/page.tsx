/**
 * LEVEL 2 DEFAULT HORSE - course-scoped admin default-horse roster for ONE exact
 * CourseOffering.
 *
 * Server Component only. In a fixed order it:
 *   1. re-validates the admin + exact offering via requireAdminCourseOffering()
 *      (admin-authorization-first, exact-id lookup, no cookie, no fallback, no
 *      singleton resolver);
 *   2. asserts the read is permitted for the offering's status via the pure
 *      default-deny policy (HISTORICAL_READ), mirroring the enrollments/groups
 *      pages;
 *   3. reads EXACTLY this offering's ACTIVE enrollment roster (group/subgroup
 *      from the effective GroupMembership spine, via the committed E3 reader),
 *      each rostered trainee's Student horse triple, and each trainee's ACTIVE-
 *      enrollment offering-id set — all from the validated context id.
 *
 * QUERY STRATEGY (no N+1): exactly three bounded queries regardless of roster
 * size — the E3 roster reader (one findMany), one Student horse findMany over the
 * rostered ids, and one CourseEnrollment findMany (ACTIVE, over the rostered ids)
 * for dual-enrollment detection. The pure core joins them.
 *
 * The default horse shown is the trainee's current Student horse (the exact
 * resolution both riding flows already use as their per-session default). A
 * Level-2-only trainee (actively enrolled ONLY here) is editable; a dual trainee
 * is read-only, their value being the inherited Level 1 / persistent default.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  requireAdminCourseOffering,
  CourseOfferingNotFoundError,
  type AdminCourseContext,
} from "@/lib/course/admin-course-context";
import { assertCourseOperationAllowed } from "@/lib/course/operation-policy-core";
import { readOfferingEnrollmentsForAdmin } from "@/lib/course/offering-enrollments-admin";
import {
  buildLevel2DefaultHorseRows,
  type Level2HorseTriple,
  type Level2RosterEnrollmentRow,
} from "@/lib/course/level2-default-horse-core";
import {
  CourseStatusBadge,
  formatCourseDateRange,
} from "@/app/admin/courses/CourseOfferingSelector";
import { CourseHorsesClient } from "./CourseHorsesClient";
import { updateLevel2OnlyTraineeDefaultHorse } from "./actions";

export const dynamic = "force-dynamic";

export default async function CourseHorsesPage({
  params,
}: {
  params: Promise<{ courseOfferingId: string }>;
}) {
  const { courseOfferingId } = await params;

  // 1. Authorize the admin and re-validate EXACTLY this offering first.
  let context: AdminCourseContext;
  try {
    context = await requireAdminCourseOffering(courseOfferingId);
  } catch (err) {
    if (err instanceof CourseOfferingNotFoundError) {
      notFound();
    }
    throw err;
  }

  // 2. Gate the READ by the offering's status via the pure default-deny policy.
  assertCourseOperationAllowed(context.status, "HISTORICAL_READ");

  // 3a. ACTIVE-only roster for this offering (group/subgroup from GroupMembership).
  const rosterAll = await readOfferingEnrollmentsForAdmin(context.id, context.startDate);
  const roster = rosterAll.filter((r) => r.status === "ACTIVE");
  const studentIds = roster.map((r) => r.studentId);

  // 3b. Two bounded joins over the rostered ids — the Student horse triples and
  //     the ACTIVE-enrollment offering-id sets (for dual-enrollment detection).
  const [horseRows, activeEnrollmentRows] =
    studentIds.length === 0
      ? [[], []]
      : await Promise.all([
          prisma.student.findMany({
            where: { id: { in: studentIds } },
            select: {
              id: true,
              hasPrivateHorse: true,
              privateHorseName: true,
              assignedHorseName: true,
            },
          }),
          prisma.courseEnrollment.findMany({
            where: { studentId: { in: studentIds }, status: "ACTIVE" },
            select: { studentId: true, courseOfferingId: true },
          }),
        ]);

  const horseByStudentId = new Map<string, Level2HorseTriple>(
    horseRows.map((s) => [
      s.id,
      {
        hasPrivateHorse: s.hasPrivateHorse,
        privateHorseName: s.privateHorseName,
        assignedHorseName: s.assignedHorseName,
      },
    ]),
  );

  const activeOfferingIdsByStudentId = new Map<string, Set<string>>();
  for (const row of activeEnrollmentRows) {
    const set = activeOfferingIdsByStudentId.get(row.studentId) ?? new Set<string>();
    set.add(row.courseOfferingId);
    activeOfferingIdsByStudentId.set(row.studentId, set);
  }

  const enrollmentRows: Level2RosterEnrollmentRow[] = roster.map((r) => ({
    studentId: r.studentId,
    fullName: r.fullName,
    subgroupLabel: r.subgroupLabel,
    membershipState: r.membershipState,
  }));

  const rows = buildLevel2DefaultHorseRows({
    enrollments: enrollmentRows,
    thisOfferingId: context.id,
    horseByStudentId,
    activeOfferingIdsByStudentId,
  });

  const dashboardHref = `/admin/courses/${encodeURIComponent(context.id)}`;
  const dateRange = formatCourseDateRange(context.startDate, context.endDate);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-card-foreground">שיוך סוסים</h2>
          <CourseStatusBadge status={context.status} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span>{context.name}</span>
          <span>רמה {context.level}</span>
          {dateRange && <span>{dateRange}</span>}
        </div>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          סוס ברירת המחדל של החניך/ה. אם לא שובץ סוס ספציפי לשיעור, ברירת המחדל הזו
          מוצעת. חניך/ה הרשום/ה לקורס זה בלבד ניתן/ת לעריכה; חניך/ה הרשום/ה גם לקורס
          אחר מוצג/ת לקריאה בלבד, וברירת המחדל שלו/ה נשמרת מהקורס האחר.
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

      <CourseHorsesClient
        rows={rows}
        action={updateLevel2OnlyTraineeDefaultHorse.bind(null, context.id)}
      />
    </div>
  );
}
