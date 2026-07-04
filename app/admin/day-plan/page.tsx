import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/require-admin";
import { DayPlanGrid } from "@/app/admin/day-plan/DayPlanGrid";
import { dateKey, enumerateDateKeys } from "@/lib/dates";
import type { DayPlanSlots } from "@/lib/actions/course-day-plan";

export const dynamic = "force-dynamic";

export default async function DayPlanPage() {
  await requireAdmin();

  const [settings, groupRows] = await Promise.all([
    prisma.courseSettings.findUnique({ where: { id: 1 } }),
    prisma.student.findMany({
      where: { isActive: true, groupName: { not: null } },
      select: { groupName: true },
      distinct: ["groupName"],
    }),
  ]);

  const groupOptions = groupRows
    .map((r) => r.groupName)
    .filter((g): g is string => Boolean(g))
    .sort();

  const dateKeys = settings ? enumerateDateKeys(settings.startDate, settings.endDate) : [];

  const dayPlans = settings
    ? await prisma.courseDayPlan.findMany({
        where: { date: { gte: settings.startDate, lte: settings.endDate } },
      })
    : [];

  const dayPlanMap: Record<string, DayPlanSlots> = {};
  for (const dp of dayPlans) {
    dayPlanMap[dateKey(dp.date)] = {
      firstMorningGroup: dp.firstMorningGroup,
      secondMorningGroup: dp.secondMorningGroup,
      firstAfterLunchGroup: dp.firstAfterLunchGroup,
      secondAfterLunchGroup: dp.secondAfterLunchGroup,
    };
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold text-card-foreground">תכנון קבוצות יומי</h1>
      <p className="text-sm text-muted-foreground">
        עבור כל תאריך, ציינו איזו קבוצה רוכבת בכל אחד מארבעת המקטעים היומיים. הנתונים
        משמשים את אילוצי השיבוץ שמוגדרים בעמוד &quot;סוגי תורנות&quot; (למשל: חסימת
        תורנות מסוימת לקבוצה שרוכבת ראשונה אחר הצהריים).
      </p>
      {settings ? (
        <DayPlanGrid
          dateKeys={dateKeys}
          groupOptions={groupOptions}
          initialPlans={dayPlanMap}
        />
      ) : (
        <p className="text-sm text-muted-foreground">יש להגדיר תחילה את תאריכי הקורס.</p>
      )}
    </div>
  );
}
