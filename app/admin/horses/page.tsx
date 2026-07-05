import { requireAdmin } from "@/lib/auth/require-admin";
import { getHorseAssignments } from "@/lib/actions/horses";
import { HorsesClient } from "@/app/admin/horses/HorsesClient";

export const dynamic = "force-dynamic";

export default async function HorsesPage() {
  await requireAdmin();
  const students = await getHorseAssignments();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-card-foreground">חלוקה לקבוצות וסוסים</h1>
      </div>
      <HorsesClient students={students} />
    </div>
  );
}
