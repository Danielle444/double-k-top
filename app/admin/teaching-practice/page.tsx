import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/require-admin";
import { TeachingPracticeManager } from "@/lib/components/TeachingPracticeManager";

export const dynamic = "force-dynamic";

export default async function TeachingPracticePage() {
  await requireAdmin();

  const [students, instructors] = await Promise.all([
    prisma.student.findMany({
      where: { isActive: true },
      orderBy: [{ groupName: "asc" }, { fullName: "asc" }],
      select: { id: true, fullName: true, groupName: true, subgroupNumber: true },
    }),
    prisma.instructor.findMany({
      where: { isActive: true },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true },
    }),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-card-foreground">התנסויות מתחילים</h1>
        <p className="text-sm text-muted-foreground">
          ניהול מסלולי התנסות קבועים, יצירת שיעורים בפועל, וניהול ילדים חיצוניים.
        </p>
      </div>
      <TeachingPracticeManager
        role="admin"
        actorId={null}
        canManageAssignments
        canManageHorses
        students={students}
        instructors={instructors}
      />
    </div>
  );
}
