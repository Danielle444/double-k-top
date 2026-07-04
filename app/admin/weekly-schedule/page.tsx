import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/require-admin";
import { WeeklyScheduleClient } from "@/app/admin/weekly-schedule/WeeklyScheduleClient";
import { dateKey } from "@/lib/dates";

export const dynamic = "force-dynamic";

export default async function WeeklySchedulePage() {
  await requireAdmin();

  const weeklySchedules = await prisma.weeklySchedule.findMany({
    include: { items: true },
    orderBy: { startDate: "asc" },
  });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold text-card-foreground">לו&quot;ז שבועי</h1>
      <p className="text-sm text-muted-foreground">
        העלו את לוח הרכיבה השבועי (Excel), שבוע אחר שבוע, כשהוא זמין. הלו&quot;ז מוצג
        לתלמידים ולמדריכים, ומאפשר להציע ערכי תכנון קבוצות יומי ולייצר את שיבוץ
        התורנויות לאותו שבוע.
      </p>
      <WeeklyScheduleClient
        weeklySchedules={weeklySchedules.map((w) => ({
          id: w.id,
          name: w.name,
          startDate: dateKey(w.startDate),
          endDate: dateKey(w.endDate),
          uploadedFileName: w.uploadedFileName,
          items: w.items.map((i) => ({
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
        }))}
      />
    </div>
  );
}
