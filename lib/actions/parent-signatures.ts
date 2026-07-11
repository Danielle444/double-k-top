"use server";

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/require-admin";
import { dateKey } from "@/lib/dates";
import { CURRENT_TEACHING_PRACTICE_COURSE_CYCLE } from "@/lib/parent-signatures/course-cycle";
import {
  buildParentSignatureChildStatus,
  type ParentSignatureAssignmentContext,
  type ParentSignatureChildStatusRow,
} from "@/lib/parent-signatures/status";

// Read-only Stage 2 surface: which Teaching Practice children are missing
// which required parent-signature forms. No create/update/delete action for
// TeachingPracticeSignedForm exists yet (Stage 3+) - this file only ever
// reads.

export interface ParentSignatureStatusResult {
  courseCycle: string;
  children: ParentSignatureChildStatusRow[];
}

// Same convention as getInstructorForAssignmentWrite in
// lib/actions/teaching-practice.ts: instructors have no NextAuth session, so
// permission is always re-verified by re-reading the instructor row fresh
// from a client-supplied instructorId, never trusted from stored client
// state. canManageChildSignatures gates this read (not just future writes) -
// unlike teaching practice scheduling, this surface exposes parent contact
// details and (once Stage 3 lands) medical notes, so it stays behind its own
// permission rather than being view-open to every active instructor.
async function getInstructorForSignatureRead(instructorId: string) {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  if (!instructor || !instructor.isActive || !instructor.canManageChildSignatures) {
    return null;
  }
  return instructor;
}

// Loads every active child's Teaching Practice assignments (all lessons,
// published or not - this is an internal staff readiness view, not the
// trainee-facing surface), groups them per child, and resolves each child's
// required forms against their ACTIVE TeachingPracticeSignedForm rows for
// the current course cycle. Shared by both the admin and instructor entry
// points below - the permission check happens before this is ever called.
async function loadParentSignatureStatusInternal(): Promise<ParentSignatureStatusResult> {
  const courseCycle = CURRENT_TEACHING_PRACTICE_COURSE_CYCLE;

  const assignments = await prisma.teachingPracticeChildAssignment.findMany({
    where: { child: { isActive: true } },
    select: {
      childId: true,
      child: {
        select: { fullName: true, age: true, parentName: true, parentPhone: true },
      },
      lesson: {
        select: { id: true, date: true, practiceType: true, groupName: true },
      },
    },
    orderBy: [{ lesson: { date: "asc" } }],
  });

  if (assignments.length === 0) {
    return { courseCycle, children: [] };
  }

  const childIds = Array.from(new Set(assignments.map((a) => a.childId)));

  const signedForms = await prisma.teachingPracticeSignedForm.findMany({
    where: { childId: { in: childIds }, courseCycle, status: "ACTIVE" },
    select: { id: true, childId: true, formType: true, signedAt: true },
  });

  const signedByChild = new Map<string, typeof signedForms>();
  for (const form of signedForms) {
    const list = signedByChild.get(form.childId);
    if (list) {
      list.push(form);
    } else {
      signedByChild.set(form.childId, [form]);
    }
  }

  interface ChildAccumulator {
    childId: string;
    childName: string;
    childAge: number | null;
    parentName: string | null;
    parentPhone: string | null;
    assignments: ParentSignatureAssignmentContext[];
  }

  const byChild = new Map<string, ChildAccumulator>();
  for (const a of assignments) {
    const assignmentContext: ParentSignatureAssignmentContext = {
      lessonId: a.lesson.id,
      date: dateKey(a.lesson.date),
      practiceType: a.lesson.practiceType,
      groupName: a.lesson.groupName,
    };
    const existing = byChild.get(a.childId);
    if (existing) {
      existing.assignments.push(assignmentContext);
    } else {
      byChild.set(a.childId, {
        childId: a.childId,
        childName: a.child.fullName,
        childAge: a.child.age,
        parentName: a.child.parentName,
        parentPhone: a.child.parentPhone,
        assignments: [assignmentContext],
      });
    }
  }

  const children = Array.from(byChild.values())
    .map((child) =>
      buildParentSignatureChildStatus({
        ...child,
        activeSignedForms: signedByChild.get(child.childId) ?? [],
      })
    )
    .sort((a, b) => a.childName.localeCompare(b.childName, "he"));

  return { courseCycle, children };
}

export async function getParentSignatureStatusForAdmin(): Promise<ParentSignatureStatusResult> {
  await requireAdmin();
  return loadParentSignatureStatusInternal();
}

export async function getParentSignatureStatusForInstructor(
  instructorId: string
): Promise<ParentSignatureStatusResult> {
  const instructor = await getInstructorForSignatureRead(instructorId);
  if (!instructor) {
    return { courseCycle: CURRENT_TEACHING_PRACTICE_COURSE_CYCLE, children: [] };
  }
  return loadParentSignatureStatusInternal();
}
