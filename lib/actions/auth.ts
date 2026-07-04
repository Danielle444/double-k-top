"use server";

import { prisma } from "@/lib/prisma";

export interface StudentSearchResult {
  id: string;
  fullName: string;
}

export async function searchStudents(query: string): Promise<StudentSearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const students = await prisma.student.findMany({
    where: { isActive: true, fullName: { contains: trimmed, mode: "insensitive" } },
    select: { id: true, fullName: true },
    orderBy: { fullName: "asc" },
    take: 8,
  });
  return students;
}

export interface LoginResult {
  success: boolean;
  error?: string;
  student?: { id: string; fullName: string; groupName: string | null };
}

export async function verifyStudentLogin(
  studentId: string,
  identityNumber: string
): Promise<LoginResult> {
  const student = await prisma.student.findUnique({ where: { id: studentId } });

  if (!student || !student.isActive || student.identityNumber !== identityNumber.trim()) {
    return { success: false, error: "מספר תעודת זהות שגוי" };
  }

  return {
    success: true,
    student: { id: student.id, fullName: student.fullName, groupName: student.groupName },
  };
}
