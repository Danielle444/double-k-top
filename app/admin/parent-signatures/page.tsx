import { requireAdmin } from "@/lib/auth/require-admin";
import { ParentSignaturesAdminClient } from "@/app/admin/parent-signatures/ParentSignaturesAdminClient";

export const dynamic = "force-dynamic";

export default async function ParentSignaturesPage() {
  await requireAdmin();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-card-foreground">חתימות הורים</h1>
        <p className="text-sm text-muted-foreground">
          מעקב סטטוס טפסי הסכמה חתומים עבור ילדי התנסויות מתחילים. שלב 2 - תצוגה בלבד, ללא חתימה דיגיטלית.
        </p>
      </div>
      <ParentSignaturesAdminClient />
    </div>
  );
}
