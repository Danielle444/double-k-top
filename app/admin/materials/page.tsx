import { requireAdmin } from "@/lib/auth/require-admin";
import { getMaterialsForAdmin, getMaterialOfferingOptions } from "@/lib/actions/materials";
import { MaterialsClient } from "@/app/admin/materials/MaterialsClient";

export const dynamic = "force-dynamic";

export default async function MaterialsPage() {
  await requireAdmin();
  const [materials, offeringOptions] = await Promise.all([
    getMaterialsForAdmin(),
    getMaterialOfferingOptions(),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-card-foreground">חומרי קורס</h1>
      </div>
      <MaterialsClient materials={materials} offeringOptions={offeringOptions} />
    </div>
  );
}
