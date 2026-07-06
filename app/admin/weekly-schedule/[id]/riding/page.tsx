import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getWeeklyRidingOverview } from "@/lib/actions/riding-slots";
import { WeeklyRidingClient } from "@/app/admin/weekly-schedule/[id]/riding/WeeklyRidingClient";

export const dynamic = "force-dynamic";

export default async function WeeklyRidingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;

  const [week, days, instructors] = await Promise.all([
    prisma.weeklySchedule.findUnique({ where: { id } }),
    getWeeklyRidingOverview(id),
    prisma.instructor.findMany({
      where: { isActive: true },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true },
    }),
  ]);

  if (!week) notFound();

  return (
    <WeeklyRidingClient
      weekId={week.id}
      weekName={week.name}
      initialDays={days}
      instructors={instructors}
    />
  );
}
