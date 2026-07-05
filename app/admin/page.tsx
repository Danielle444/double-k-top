import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatHebrewDate, todayDateKey, parseDateKey } from "@/lib/dates";
import { Logo } from "@/lib/components/Logo";
import { requireAdmin } from "@/lib/auth/require-admin";

export const dynamic = "force-dynamic";

async function getDashboardData() {
  const todayKey = todayDateKey();
  const today = parseDateKey(todayKey);

  const [activeStudents, activeDutyTypes, settings, todayAssignments] =
    await Promise.all([
      prisma.student.count({ where: { isActive: true } }),
      prisma.dutyType.count({ where: { isActive: true } }),
      prisma.courseSettings.findUnique({ where: { id: 1 } }),
      prisma.dutyAssignment.findMany({
        where: { date: today, isPublished: true },
        include: { student: true, dutyType: true },
      }),
    ]);

  return { activeStudents, activeDutyTypes, settings, todayAssignments };
}

export default async function AdminDashboardPage() {
  await requireAdmin();
  const { activeStudents, activeDutyTypes, settings, todayAssignments } =
    await getDashboardData();

  const completedCount = todayAssignments.filter((a) => a.isCompleted).length;

  return (
    <div className="flex flex-col gap-6">
      <Logo width={160} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="תלמידים פעילים" value={activeStudents} />
        <StatCard label="סוגי תורנות פעילים" value={activeDutyTypes} />
        <StatCard
          label="טווח תאריכי הקורס"
          value={
            settings
              ? `${formatHebrewDate(settings.startDate)} - ${formatHebrewDate(settings.endDate)}`
              : "טרם הוגדר"
          }
          small
        />
        <StatCard
          label="ביצוע תורנויות היום"
          value={
            todayAssignments.length === 0
              ? "אין שיבוצים שפורסמו היום"
              : `${completedCount} / ${todayAssignments.length} בוצעו`
          }
          small
        />
      </div>

      {!settings && (
        <div className="rounded-lg bg-warning-muted p-4 text-sm text-warning">
          יש להגדיר תחילה את תאריכי הקורס בעמוד{" "}
          <Link href="/admin/availability" className="underline">
            הזמינות
          </Link>{" "}
          לפני ייצור שיבוץ אוטומטי.
        </div>
      )}

      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-3 text-base font-semibold text-card-foreground">ייצור שיבוצים</h2>
        <p className="text-sm text-muted-foreground">
          ייצור ועריכת שיבוצי תורנות מתבצעים מעמוד{" "}
          <Link href="/admin/schedule" className="underline">
            שיבוץ
          </Link>{" "}
          (ניתן לבחור שבוע מתוך{" "}
          <Link href="/admin/weekly-schedule" className="underline">
            לו&quot;ז שבועי
          </Link>{" "}
          כטווח לייצור).
        </p>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  small,
}: {
  label: string;
  value: string | number;
  small?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p
        className={`mt-1 font-bold text-card-foreground ${small ? "text-base" : "text-2xl"}`}
      >
        {value}
      </p>
    </div>
  );
}
