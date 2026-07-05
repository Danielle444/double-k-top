import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/require-admin";
import { listMessageTasksForAdmin } from "@/lib/actions/messages";
import { MessagesClient } from "@/app/admin/messages/MessagesClient";

export const dynamic = "force-dynamic";

export default async function MessagesPage() {
  await requireAdmin();

  const [messageTasks, students] = await Promise.all([
    listMessageTasksForAdmin(),
    prisma.student.findMany({
      where: { isActive: true },
      orderBy: [{ groupName: "asc" }, { fullName: "asc" }],
      select: { id: true, fullName: true, groupName: true },
    }),
  ]);

  const groups = Array.from(
    new Set(students.map((s) => s.groupName).filter((g): g is string => Boolean(g)))
  ).sort();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-card-foreground">הודעות ומשימות</h1>
      </div>
      <MessagesClient messageTasks={messageTasks} students={students} groups={groups} />
    </div>
  );
}
