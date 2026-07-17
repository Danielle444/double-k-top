"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/actions/students";
import { requireAdmin } from "@/lib/auth/require-admin";

const emailSchema = z.object({
  email: z.string().trim().toLowerCase().email("כתובת אימייל לא תקינה"),
  name: z.string().trim().optional(),
});

export async function addAdminEmail(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const parsed = emailSchema.safeParse({
    email: formData.get("email"),
    name: formData.get("name") || undefined,
  });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "קלט לא תקין" };
  }

  await prisma.adminEmail.upsert({
    where: { email: parsed.data.email },
    update: { isActive: true, name: parsed.data.name || undefined },
    create: { email: parsed.data.email, name: parsed.data.name || null },
  });

  revalidatePath("/admin/admins");
  return { success: true };
}

export async function setAdminEmailActive(
  adminEmailId: string,
  isActive: boolean
): Promise<ActionResult> {
  await requireAdmin();
  await prisma.adminEmail.update({ where: { id: adminEmailId }, data: { isActive } });
  revalidatePath("/admin/admins");
  return { success: true };
}
