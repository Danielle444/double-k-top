import { prisma } from "@/lib/prisma";
import { StudentsClient } from "@/app/admin/students/StudentsClient";
import { requireAdmin } from "@/lib/auth/require-admin";
import { dateKey } from "@/lib/dates";

export const dynamic = "force-dynamic";

export default async function StudentsPage() {
  await requireAdmin();
  const [students, presets, courseSettings] = await Promise.all([
    prisma.student.findMany({
      orderBy: [{ isActive: "desc" }, { fullName: "asc" }],
    }),
    prisma.availabilityRangePreset.findMany({ orderBy: { startDate: "asc" } }),
    prisma.courseSettings.findUnique({ where: { id: 1 } }),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-card-foreground">ניהול חניכים</h1>
      </div>
      <StudentsClient
        students={students.map((s) => ({
          id: s.id,
          firstName: s.firstName,
          lastName: s.lastName,
          fullName: s.fullName,
          groupName: s.groupName,
          subgroupNumber: s.subgroupNumber,
          identityNumber: s.identityNumber,
          phone: s.phone,
          isActive: s.isActive,
        }))}
        presets={presets.map((p) => ({ id: p.id, name: p.name }))}
        courseRange={
          courseSettings
            ? {
                startDate: dateKey(courseSettings.startDate),
                endDate: dateKey(courseSettings.endDate),
              }
            : null
        }
      />
    </div>
  );
}
