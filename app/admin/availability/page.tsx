import { prisma } from "@/lib/prisma";
import { CourseSettingsForm } from "@/app/admin/availability/CourseSettingsForm";
import { AvailabilityFilterableGrid } from "@/app/admin/availability/AvailabilityFilterableGrid";
import { PresetsClient } from "@/app/admin/availability/PresetsClient";
import { dateKey, enumerateDateKeys } from "@/lib/dates";
import { requireAdmin } from "@/lib/auth/require-admin";

export const dynamic = "force-dynamic";

export default async function AvailabilityPage() {
  await requireAdmin();
  const [settings, students, presets] = await Promise.all([
    prisma.courseSettings.findUnique({ where: { id: 1 } }),
    prisma.student.findMany({
      where: { isActive: true },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true, groupName: true, subgroupNumber: true },
    }),
    prisma.availabilityRangePreset.findMany({ orderBy: { startDate: "asc" } }),
  ]);

  const dateKeys = settings
    ? enumerateDateKeys(settings.startDate, settings.endDate)
    : [];

  const availabilityRows = settings
    ? await prisma.studentAvailability.findMany({
        where: { date: { gte: settings.startDate, lte: settings.endDate } },
      })
    : [];

  const availabilityMap: Record<string, boolean> = {};
  for (const row of availabilityRows) {
    availabilityMap[`${row.studentId}|${dateKey(row.date)}`] = row.isAvailable;
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-bold text-card-foreground">הגדרות קורס וזמינות</h1>

      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-3 text-base font-semibold text-card-foreground">תאריכי הקורס</h2>
        <CourseSettingsForm
          startDate={settings ? dateKey(settings.startDate) : ""}
          endDate={settings ? dateKey(settings.endDate) : ""}
        />
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-3 text-base font-semibold text-card-foreground">
          פריסטים לזמינות
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          שמרו טווחי תאריכים נפוצים (למשל &quot;שבועיים ראשונים בלבד&quot;) כדי להחיל אותם
          במהירות על מספר תלמידים.
        </p>
        <PresetsClient
          presets={presets.map((p) => ({
            id: p.id,
            name: p.name,
            startDate: dateKey(p.startDate),
            endDate: dateKey(p.endDate),
          }))}
          students={students}
        />
      </div>

      {settings ? (
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-3 text-base font-semibold text-card-foreground">
            זמינות תלמידים לפי תאריך
          </h2>
          <p className="mb-3 text-sm text-muted-foreground">
            תלמיד/ה ללא סימון נחשב/ת זמין/ה כברירת מחדל. לחצו על תא כדי להחליף בין זמין/ה
            לבין לא זמין/ה.
          </p>
          <AvailabilityFilterableGrid
            students={students}
            dateKeys={dateKeys}
            initialAvailability={availabilityMap}
          />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          יש להגדיר תחילה את תאריכי ההתחלה והסיום של הקורס.
        </p>
      )}
    </div>
  );
}
