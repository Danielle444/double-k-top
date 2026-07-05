import { prisma } from "@/lib/prisma";
import { DailyTrackingTabs } from "@/app/admin/daily-tracking/DailyTrackingTabs";
import { getAttendanceTrackingForAdmin } from "@/lib/actions/attendance";
import { dateKey, enumerateDateKeys, todayDateKey } from "@/lib/dates";
import { requireAdmin } from "@/lib/auth/require-admin";

export const dynamic = "force-dynamic";

export default async function DailyTrackingPage() {
  await requireAdmin();

  const settings = await prisma.courseSettings.findUnique({ where: { id: 1 } });
  const courseStartDateKey = settings ? dateKey(settings.startDate) : null;
  const courseEndDateKey = settings ? dateKey(settings.endDate) : null;

  // Default to today, clamped into the course range if today falls outside it.
  let defaultDateKey = todayDateKey();
  if (courseStartDateKey && defaultDateKey < courseStartDateKey) {
    defaultDateKey = courseStartDateKey;
  } else if (courseEndDateKey && defaultDateKey > courseEndDateKey) {
    defaultDateKey = courseEndDateKey;
  }

  // Mirrors app/admin/completion/page.tsx and app/admin/availability/page.tsx
  // exactly, so the embedded tabs below get the same data those standalone
  // pages already fetch - neither of those pages' own code is touched.
  const [initialRows, students, presets, availabilityRows, dutyAssignments] = await Promise.all([
    getAttendanceTrackingForAdmin(defaultDateKey, defaultDateKey),
    prisma.student.findMany({
      where: { isActive: true },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true },
    }),
    prisma.availabilityRangePreset.findMany({ orderBy: { startDate: "asc" } }),
    settings
      ? prisma.studentAvailability.findMany({
          where: { date: { gte: settings.startDate, lte: settings.endDate } },
        })
      : Promise.resolve([]),
    prisma.dutyAssignment.findMany({
      include: { student: true, dutyType: true },
      orderBy: [{ date: "asc" }, { dutyType: { name: "asc" } }],
    }),
  ]);

  const dateKeys = settings ? enumerateDateKeys(settings.startDate, settings.endDate) : [];
  const availabilityMap: Record<string, boolean> = {};
  for (const row of availabilityRows) {
    availabilityMap[`${row.studentId}|${dateKey(row.date)}`] = row.isAvailable;
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-card-foreground">מעקב יומי</h1>
        <p className="text-sm text-muted-foreground">
          כאן ניתן לעקוב אחרי נוכחות החניכים, זמינות לתורנויות וביצוע תורנויות באותו יום.
        </p>
      </div>
      <DailyTrackingTabs
        attendance={{
          initialDateKey: defaultDateKey,
          initialRows,
          courseStartDateKey,
          courseEndDateKey,
        }}
        completion={{
          assignments: dutyAssignments.map((a) => ({
            id: a.id,
            dateKey: dateKey(a.date),
            studentName: a.student.fullName,
            groupName: a.student.groupName,
            subgroupNumber: a.student.subgroupNumber,
            dutyTypeName: a.dutyType.name,
            isPublished: a.isPublished,
            isCompleted: a.isCompleted,
            completedAt: a.completedAt ? a.completedAt.toISOString() : null,
          })),
          defaultDateKey,
        }}
        availability={
          settings
            ? {
                hasSettings: true,
                startDate: courseStartDateKey as string,
                endDate: courseEndDateKey as string,
                presets: presets.map((p) => ({
                  id: p.id,
                  name: p.name,
                  startDate: dateKey(p.startDate),
                  endDate: dateKey(p.endDate),
                })),
                students,
                dateKeys,
                availabilityMap,
              }
            : { hasSettings: false }
        }
      />
    </div>
  );
}
