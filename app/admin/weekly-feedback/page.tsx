import { requireAdmin } from "@/lib/auth/require-admin";
import { listWeeklyFeedbackForms } from "@/lib/actions/weekly-feedback";
import { listWeeklyScheduleOptions } from "@/lib/actions/weekly-schedule";
import { WeeklyFeedbackTabs } from "@/app/admin/weekly-feedback/WeeklyFeedbackTabs";

export const dynamic = "force-dynamic";

export default async function WeeklyFeedbackPage() {
  await requireAdmin();

  const [forms, weeks] = await Promise.all([listWeeklyFeedbackForms(), listWeeklyScheduleOptions()]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-card-foreground">משוב שבועי</h1>
        <p className="text-sm text-muted-foreground">
          יצירת טיוטות משוב סוף שבוע לחניכים, לפי לו&quot;ז שבועי קיים, והגדרת מתי הן פתוחות למילוי.
        </p>
      </div>
      <WeeklyFeedbackTabs initialForms={forms} weeks={weeks} />
    </div>
  );
}
