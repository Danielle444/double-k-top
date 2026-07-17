"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";

const studentSchema = z.object({
  firstName: z.string().trim().min(1, "יש להזין שם פרטי"),
  lastName: z.string().trim().min(1, "יש להזין שם משפחה"),
  identityNumber: z
    .string()
    .trim()
    .regex(/^\d{5,9}$/, "מספר תעודת זהות לא תקין"),
  groupName: z.string().trim().optional(),
  subgroupNumber: z.coerce.number().int().positive().optional(),
  phone: z.string().trim().optional(),
});

export interface ActionResult {
  success: boolean;
  error?: string;
}

function fullNameOf(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.trim();
}

export async function createStudent(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const parsed = studentSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    identityNumber: formData.get("identityNumber"),
    groupName: formData.get("groupName") || undefined,
    subgroupNumber: formData.get("subgroupNumber") || undefined,
    phone: formData.get("phone") || undefined,
  });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "קלט לא תקין" };
  }

  const existing = await prisma.student.findUnique({
    where: { identityNumber: parsed.data.identityNumber },
  });
  if (existing) {
    return { success: false, error: "כבר קיים/ת חניך/ה עם מספר תעודת זהות זה" };
  }

  await prisma.student.create({
    data: {
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      fullName: fullNameOf(parsed.data.firstName, parsed.data.lastName),
      identityNumber: parsed.data.identityNumber,
      groupName: parsed.data.groupName || null,
      subgroupNumber: parsed.data.subgroupNumber ?? null,
      phone: parsed.data.phone || null,
    },
  });

  revalidatePath("/admin/students");
  revalidatePath("/admin");
  return { success: true };
}

export async function updateStudent(
  studentId: string,
  formData: FormData
): Promise<ActionResult> {
  await requireAdmin();
  const parsed = studentSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    identityNumber: formData.get("identityNumber"),
    groupName: formData.get("groupName") || undefined,
    subgroupNumber: formData.get("subgroupNumber") || undefined,
    phone: formData.get("phone") || undefined,
  });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "קלט לא תקין" };
  }

  const conflict = await prisma.student.findUnique({
    where: { identityNumber: parsed.data.identityNumber },
  });
  if (conflict && conflict.id !== studentId) {
    return { success: false, error: "כבר קיים/ת חניך/ה עם מספר תעודת זהות זה" };
  }

  await prisma.student.update({
    where: { id: studentId },
    data: {
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      fullName: fullNameOf(parsed.data.firstName, parsed.data.lastName),
      identityNumber: parsed.data.identityNumber,
      groupName: parsed.data.groupName || null,
      subgroupNumber: parsed.data.subgroupNumber ?? null,
      phone: parsed.data.phone || null,
    },
  });

  revalidatePath("/admin/students");
  return { success: true };
}

export async function setStudentActive(
  studentId: string,
  isActive: boolean
): Promise<ActionResult> {
  await requireAdmin();
  await prisma.student.update({ where: { id: studentId }, data: { isActive } });
  revalidatePath("/admin/students");
  revalidatePath("/admin");
  return { success: true };
}
