"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/actions/students";

export async function markDutyCompleted(
  assignmentId: string,
  studentId: string
): Promise<ActionResult> {
  const assignment = await prisma.dutyAssignment.findUnique({
    where: { id: assignmentId },
  });
  if (!assignment || assignment.studentId !== studentId || !assignment.isPublished) {
    return { success: false, error: "השיבוץ לא נמצא" };
  }

  await prisma.dutyAssignment.update({
    where: { id: assignmentId },
    data: { isCompleted: true, completedAt: new Date() },
  });

  revalidatePath("/admin/completion");
  revalidatePath("/student");
  return { success: true };
}

export async function adminSetCompletion(
  assignmentId: string,
  isCompleted: boolean
): Promise<ActionResult> {
  await prisma.dutyAssignment.update({
    where: { id: assignmentId },
    data: { isCompleted, completedAt: isCompleted ? new Date() : null },
  });

  revalidatePath("/admin/completion");
  revalidatePath("/student");
  return { success: true };
}
