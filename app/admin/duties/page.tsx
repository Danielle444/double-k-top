import { prisma } from "@/lib/prisma";
import { DutiesClient } from "@/app/admin/duties/DutiesClient";
import { ConstraintsClient } from "@/app/admin/duties/ConstraintsClient";
import { requireAdmin } from "@/lib/auth/require-admin";

export const dynamic = "force-dynamic";

export default async function DutiesPage() {
  await requireAdmin();
  const [dutyTypes, constraints] = await Promise.all([
    prisma.dutyType.findMany({
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    }),
    prisma.dutyConstraint.findMany({
      include: { dutyType: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-bold text-card-foreground">ניהול סוגי תורנות</h1>
        <DutiesClient dutyTypes={dutyTypes} />
      </div>

      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-bold text-card-foreground">אילוצי שיבוץ</h2>
          <p className="text-sm text-muted-foreground">
            חסמו סוג תורנות מקבוצה שרוכבת במקטע יומי מסוים (לפי{" "}
            <a href="/admin/day-plan" className="underline">
              תכנון הקבוצות היומי
            </a>
            ). ניתן להוסיף כל שילוב של תורנות ומקטע.
          </p>
        </div>
        <ConstraintsClient
          dutyTypes={dutyTypes
            .filter((d) => d.isActive)
            .map((d) => ({ id: d.id, name: d.name }))}
          constraints={constraints.map((c) => ({
            id: c.id,
            dutyTypeName: c.dutyType.name,
            slot: c.slot,
            note: c.note,
            isActive: c.isActive,
          }))}
        />
      </div>
    </div>
  );
}
