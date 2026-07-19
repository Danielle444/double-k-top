import { prisma } from "@/lib/prisma";
import { CompletionClient } from "@/app/admin/completion/CompletionClient";
import { dateKey, todayDateKey } from "@/lib/dates";
import { requireAdmin } from "@/lib/auth/require-admin";
import { loadHistoricalTraineeState } from "@/lib/course/historical-trainee-state";

export const dynamic = "force-dynamic";

export default async function CompletionPage() {
  await requireAdmin();
  const assignments = await prisma.dutyAssignment.findMany({
    include: { student: true, dutyType: true },
    orderBy: [{ date: "asc" }, { dutyType: { name: "asc" } }],
  });

  // W6D3-HOTFIX: each completion row shows the group the trainee was in ON THE
  // DUTY'S OWN DATE, resolved from the effective-dated GroupMembership — not the
  // current Student mirror (which relabels past rows after a group change). Fail
  // closed to null (no current-mirror fallback); the row itself is preserved.
  const historical = await loadHistoricalTraineeState(assignments.map((a) => a.studentId));

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold text-card-foreground">מעקב ביצוע תורנויות</h1>
      <CompletionClient
        assignments={assignments.map((a) => {
          const group = historical.groupAt(a.studentId, a.date);
          return {
            id: a.id,
            dateKey: dateKey(a.date),
            studentName: a.student.fullName,
            groupName: group.ok ? group.value.groupName : null,
            subgroupNumber: group.ok ? group.value.subgroupNumber : null,
            dutyTypeName: a.dutyType.name,
            isPublished: a.isPublished,
            isCompleted: a.isCompleted,
            completedAt: a.completedAt ? a.completedAt.toISOString() : null,
          };
        })}
        defaultDateKey={todayDateKey()}
      />
    </div>
  );
}
