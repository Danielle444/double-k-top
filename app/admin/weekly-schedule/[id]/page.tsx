import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/require-admin";
import { dateKey } from "@/lib/dates";
import { WeeklyScheduleDetailClient } from "@/app/admin/weekly-schedule/[id]/WeeklyScheduleDetailClient";

export const dynamic = "force-dynamic";

export default async function WeeklyScheduleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;

  const [week, instructors] = await Promise.all([
    prisma.weeklySchedule.findUnique({
      where: { id },
      include: {
        items: { orderBy: [{ date: "asc" }, { startTime: "asc" }] },
        // The week's OWN owning offering - the authoritative source for its
        // level. Nullable for weeks that predate the offering spine (all Level
        // 1); a Level 2 week can only be created through the offering-scoped
        // route, which always writes the FK.
        courseOffering: { select: { level: true } },
      },
    }),
    prisma.instructor.findMany({
      where: { isActive: true },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true },
    }),
  ]);

  if (!week) notFound();

  return (
    <WeeklyScheduleDetailClient
      instructors={instructors}
      week={{
        id: week.id,
        name: week.name,
        startDate: dateKey(week.startDate),
        endDate: dateKey(week.endDate),
        uploadedFileName: week.uploadedFileName,
        courseLevel: week.courseOffering?.level ?? null,
        items: week.items.map((i) => ({
          id: i.id,
          dateKey: dateKey(i.date),
          startTime: i.startTime,
          endTime: i.endTime,
          title: i.title,
          description: i.description,
          groupName: i.groupName,
          instructorName: i.instructorName,
          location: i.location,
        })),
      }}
    />
  );
}
