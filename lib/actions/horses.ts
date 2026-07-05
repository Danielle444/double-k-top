"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import type { ActionResult } from "@/lib/actions/students";

export interface HorseAssignmentRow {
  id: string;
  fullName: string;
  lastName: string;
  groupName: string | null;
  subgroupNumber: number | null;
  hasPrivateHorse: boolean;
  privateHorseName: string | null;
  assignedHorseName: string | null;
}

// Read-only, no permission gate - same convention as other instructor-facing
// reads (e.g. getScheduleForInstructor in lib/actions/instructor-schedule.ts)
// which can't call requireAdmin() since students/instructors have no
// NextAuth session in this app. Callable from both the admin server
// component and the instructor client tab.
export async function getHorseAssignments(): Promise<HorseAssignmentRow[]> {
  const students = await prisma.student.findMany({
    where: { isActive: true },
    orderBy: [{ groupName: "asc" }, { subgroupNumber: "asc" }, { lastName: "asc" }],
    select: {
      id: true,
      fullName: true,
      lastName: true,
      groupName: true,
      subgroupNumber: true,
      hasPrivateHorse: true,
      privateHorseName: true,
      assignedHorseName: true,
    },
  });
  return students;
}

export interface HorseInfoUpdate {
  hasPrivateHorse: boolean;
  privateHorseName: string | null;
  assignedHorseName: string | null;
}

// Admin-only for Stage A - instructor and student edit actions are
// deliberately not implemented yet.
export async function updateStudentHorseInfo(
  studentId: string,
  data: HorseInfoUpdate
): Promise<ActionResult> {
  await requireAdmin();

  await prisma.student.update({
    where: { id: studentId },
    data: {
      hasPrivateHorse: data.hasPrivateHorse,
      privateHorseName: data.privateHorseName?.trim() || null,
      assignedHorseName: data.assignedHorseName?.trim() || null,
    },
  });

  revalidatePath("/admin/horses");
  return { success: true };
}
