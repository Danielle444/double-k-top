import { prisma } from "@/lib/prisma";
import { todayDateKey, parseDateKey } from "@/lib/dates";

// Plain server-only helper (no "use server") - nothing client-side needs to
// call this directly, /admin/page.tsx (a server component) is the only
// caller, so there is no reason to expose it as an invokable action.

export interface RecentMessageTaskItem {
  id: string;
  title: string;
  type: "MESSAGE" | "TASK";
  createdAt: Date;
}

export interface RecentMaterialItem {
  id: string;
  title: string;
  materialType: "FILE" | "LINK";
  createdAt: Date;
}

export interface AdminDashboardData {
  activeStudents: number;
  activeInstructors: number;
  courseRange: { startDate: Date; endDate: Date } | null;
  todayAssignmentsTotal: number;
  todayAssignmentsCompleted: number;
  activeMaterialsCount: number;

  studentsWithoutPhone: number;
  studentsWithoutHorse: number;
  incompleteTaskRecipients: number;

  recentMessageTasks: RecentMessageTaskItem[];
  recentMaterials: RecentMaterialItem[];
}

export async function getAdminDashboardData(): Promise<AdminDashboardData> {
  const today = parseDateKey(todayDateKey());

  const [
    activeStudents,
    activeInstructors,
    settings,
    todayAssignments,
    activeMaterialsCount,
    studentsWithoutPhone,
    studentsWithoutHorse,
    incompleteTaskRecipients,
    recentMessageTasks,
    recentMaterials,
  ] = await Promise.all([
    prisma.student.count({ where: { isActive: true } }),
    prisma.instructor.count({ where: { isActive: true } }),
    prisma.courseSettings.findUnique({ where: { id: 1 } }),
    prisma.dutyAssignment.findMany({
      where: { date: today, isPublished: true },
      select: { isCompleted: true },
    }),
    prisma.courseMaterial.count({ where: { isActive: true } }),
    // Missing phone: active students with no phone value at all.
    prisma.student.count({
      where: { isActive: true, OR: [{ phone: null }, { phone: "" }] },
    }),
    // Missing horse assignment mirrors getHorseDisplayInfo's exact "none"
    // condition - a private-horse student is never "missing" here regardless
    // of whether a name was entered yet.
    prisma.student.count({
      where: {
        isActive: true,
        hasPrivateHorse: false,
        OR: [{ assignedHorseName: null }, { assignedHorseName: "" }],
      },
    }),
    prisma.messageTaskRecipient.count({
      where: { completedAt: null, messageTask: { type: "TASK", isArchived: false } },
    }),
    prisma.messageTask.findMany({
      where: { isArchived: false },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, title: true, type: true, createdAt: true },
    }),
    prisma.courseMaterial.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, title: true, materialType: true, createdAt: true },
    }),
  ]);

  return {
    activeStudents,
    activeInstructors,
    courseRange: settings ? { startDate: settings.startDate, endDate: settings.endDate } : null,
    todayAssignmentsTotal: todayAssignments.length,
    todayAssignmentsCompleted: todayAssignments.filter((a) => a.isCompleted).length,
    activeMaterialsCount,
    studentsWithoutPhone,
    studentsWithoutHorse,
    incompleteTaskRecipients,
    recentMessageTasks,
    recentMaterials,
  };
}
