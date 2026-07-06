import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getStudentRidingHistoryForAdmin } from "@/lib/actions/riding-slots";
import { RidingHistoryList } from "@/lib/components/RidingHistoryList";

export const dynamic = "force-dynamic";

export default async function StudentRidingHistoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;

  const result = await getStudentRidingHistoryForAdmin(id);
  if (!result) notFound();

  const { student, rows } = result;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link
          href="/admin/students"
          className="text-sm text-muted-foreground underline hover:text-card-foreground"
        >
          &larr; חזרה לחניכים
        </Link>
        <h1 className="mt-1 text-xl font-bold text-card-foreground">
          היסטוריית רכיבה - {student.fullName}
        </h1>
        <p className="text-sm text-muted-foreground">
          {student.groupName ? `קבוצה ${student.groupName}` : "ללא קבוצה"}
          {student.subgroupNumber != null ? ` / תת-קבוצה ${student.subgroupNumber}` : ""} · סוס:{" "}
          {student.horseNameDisplay}
        </p>
      </div>

      <RidingHistoryList rows={rows} />
    </div>
  );
}
