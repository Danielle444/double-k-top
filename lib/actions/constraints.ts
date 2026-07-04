"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/actions/students";

const constraintSchema = z.object({
  dutyTypeId: z.string().min(1, "יש לבחור סוג תורנות"),
  slot: z.enum([
    "FIRST_MORNING",
    "SECOND_MORNING",
    "FIRST_AFTER_LUNCH",
    "SECOND_AFTER_LUNCH",
  ]),
  note: z.string().trim().optional(),
});

export async function createDutyConstraint(formData: FormData): Promise<ActionResult> {
  const parsed = constraintSchema.safeParse({
    dutyTypeId: formData.get("dutyTypeId"),
    slot: formData.get("slot"),
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "קלט לא תקין" };
  }

  await prisma.dutyConstraint.create({
    data: {
      dutyTypeId: parsed.data.dutyTypeId,
      slot: parsed.data.slot,
      note: parsed.data.note || null,
    },
  });

  revalidatePath("/admin/duties");
  return { success: true };
}

export async function setDutyConstraintActive(
  constraintId: string,
  isActive: boolean
): Promise<ActionResult> {
  await prisma.dutyConstraint.update({
    where: { id: constraintId },
    data: { isActive },
  });
  revalidatePath("/admin/duties");
  return { success: true };
}

export async function deleteDutyConstraint(constraintId: string): Promise<ActionResult> {
  await prisma.dutyConstraint.delete({ where: { id: constraintId } });
  revalidatePath("/admin/duties");
  return { success: true };
}
