import { prisma } from "@/lib/prisma";
import { ScheduleClient } from "@/app/admin/schedule/ScheduleClient";
import { dateKey } from "@/lib/dates";
import { requireAdmin } from "@/lib/auth/require-admin";

export const dynamic = "force-dynamic";

export default async function SchedulePage() {
  await requireAdmin();
  const [assignments, students, dutyTypes, settings, weeklySchedules, noDutyDates] =
    await Promise.all([
      prisma.dutyAssignment.findMany({
        include: { student: true, dutyType: true },
        orderBy: [{ date: "asc" }, { dutyType: { name: "asc" } }],
      }),
      prisma.student.findMany({
        where: { isActive: true },
        orderBy: { fullName: "asc" },
        select: {
          id: true,
          fullName: true,
          lastName: true,
          groupName: true,
          subgroupNumber: true,
        },
      }),
      prisma.dutyType.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      prisma.courseSettings.findUnique({ where: { id: 1 } }),
      prisma.weeklySchedule.findMany({ orderBy: { startDate: "asc" } }),
      prisma.noDutyDate.findMany({ select: { date: true } }),
    ]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold text-card-foreground">שיבוץ תורנויות</h1>
      <ScheduleClient
        assignments={assignments.map((a) => ({
          id: a.id,
          dateKey: dateKey(a.date),
          studentId: a.studentId,
          studentName: a.student.fullName,
          dutyTypeId: a.dutyTypeId,
          dutyTypeName: a.dutyType.name,
          isManual: a.isManual,
          isPublished: a.isPublished,
          isCompleted: a.isCompleted,
        }))}
        students={students}
        dutyTypes={dutyTypes}
        courseRange={
          settings ? { startDate: dateKey(settings.startDate), endDate: dateKey(settings.endDate) } : null
        }
        weeklySchedules={weeklySchedules.map((w) => ({
          id: w.id,
          name: w.name,
          startDate: dateKey(w.startDate),
          endDate: dateKey(w.endDate),
        }))}
        noDutyDateKeys={noDutyDates.map((n) => dateKey(n.date))}
      />
    </div>
  );
}
