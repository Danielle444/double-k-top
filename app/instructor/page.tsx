import { prisma } from "@/lib/prisma";
import { InstructorClient } from "@/app/instructor/InstructorClient";

export const dynamic = "force-dynamic";

export default async function InstructorPage() {
  const [students, dutyTypes] = await Promise.all([
    prisma.student.findMany({
      where: { isActive: true },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true, groupName: true, subgroupNumber: true },
    }),
    prisma.dutyType.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center bg-background px-4 py-10">
      <InstructorClient students={students} dutyTypes={dutyTypes} />
    </div>
  );
}
