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

export interface StudentProfile {
  id: string;
  fullName: string;
  groupName: string | null;
  subgroupNumber: number | null;
  hasPrivateHorse: boolean;
  privateHorseName: string | null;
  assignedHorseName: string | null;
}

export interface LoginResult {
  success: boolean;
  error?: string;
  student?: StudentProfile;
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
    student: {
      id: student.id,
      fullName: student.fullName,
      groupName: student.groupName,
      subgroupNumber: student.subgroupNumber,
      hasPrivateHorse: student.hasPrivateHorse,
      privateHorseName: student.privateHorseName,
      assignedHorseName: student.assignedHorseName,
    },
  };
}

// Refreshes the remembered session's profile fields from the DB. A
// long-lived "remember me" session (or one saved before a profile field
// existed) can otherwise show stale or missing data indefinitely.
export async function getStudentProfile(studentId: string): Promise<StudentProfile | null> {
  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student || !student.isActive) return null;
  return {
    id: student.id,
    fullName: student.fullName,
    groupName: student.groupName,
    subgroupNumber: student.subgroupNumber,
    hasPrivateHorse: student.hasPrivateHorse,
    privateHorseName: student.privateHorseName,
    assignedHorseName: student.assignedHorseName,
  };
}
