import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/require-admin";
import { AdminsClient } from "@/app/admin/admins/AdminsClient";

export const dynamic = "force-dynamic";

export default async function AdminsPage() {
  const currentAdmin = await requireAdmin();

  const adminEmails = await prisma.adminEmail.findMany({
    orderBy: [{ isActive: "desc" }, { email: "asc" }],
  });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold text-card-foreground">מנהלים מורשים</h1>
      <p className="text-sm text-muted-foreground">
        רק כתובות Google המופיעות ברשימה זו, ומסומנות כפעילות, יכולות להיכנס למערכת
        הניהול.
      </p>
      <AdminsClient adminEmails={adminEmails} currentAdminEmail={currentAdmin.email} />
    </div>
  );
}
