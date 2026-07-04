"use server";

import { prisma } from "@/lib/prisma";

export interface InstructorSearchResult {
  id: string;
  fullName: string;
}

export async function searchInstructors(query: string): Promise<InstructorSearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const instructors = await prisma.instructor.findMany({
    where: { isActive: true, fullName: { contains: trimmed, mode: "insensitive" } },
    select: { id: true, fullName: true },
    orderBy: { fullName: "asc" },
    take: 8,
  });
  return instructors;
}

export interface InstructorLoginResult {
  success: boolean;
  error?: string;
  instructor?: { id: string; fullName: string };
}

export async function verifyInstructorLogin(
  instructorId: string,
  identityNumber: string
): Promise<InstructorLoginResult> {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });

  if (
    !instructor ||
    !instructor.isActive ||
    instructor.identityNumber !== identityNumber.trim()
  ) {
    return { success: false, error: "מספר תעודת זהות שגוי" };
  }

  return { success: true, instructor: { id: instructor.id, fullName: instructor.fullName } };
}
