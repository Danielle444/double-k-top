"use server";

// Stage D1 - read-only, group-scoped fixed-structure assignment check
// ("בדוק שיבוץ" on the fixed structure itself) for Teaching Practice
// ("התנסויות מתחילים"). This is separate from the existing generated-lesson
// schedule check (getTeachingPracticeScheduleCheckForAdmin in
// lib/actions/teaching-practice.ts), which only ever reads already-generated
// TeachingPracticeLesson rows and has no concept of the fixed structure or
// of required-vs-informational slots.
//
// This file performs NO writes: no create/update/delete/upsert, no
// deleteMany/createMany, no $transaction, no revalidatePath. It only reads
// current fixed-structure state and delegates all comparison logic to the
// pure, DB-free lib/teaching-practice-fixed-structure-check.ts.

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/require-admin";
import {
  checkTeachingPracticeFixedStructure,
  type TeachingPracticeFixedStructureCheckResult,
} from "@/lib/teaching-practice-fixed-structure-check";

// Mirrors VALID_GROUP_NAMES in lib/actions/teaching-practice.ts (not
// exported from there) - same small, deliberate, self-contained duplication
// already used in lib/teaching-practice-trainee-suggestions.ts,
// lib/actions/teaching-practice-full-sync.ts and -preview.ts for the same
// reason.
const VALID_GROUP_NAMES = ["א", "ב"] as const;

async function checkTeachingPracticeFixedStructureInternal(
  groupName: string
): Promise<TeachingPracticeFixedStructureCheckResult> {
  if (!VALID_GROUP_NAMES.includes(groupName as "א" | "ב")) {
    throw new Error("קבוצה לא תקינה - יש לבחור קבוצה א או קבוצה ב");
  }

  // Read-only. Linked BEGINNER_PRIVATE tracks share their BEGINNER_GROUP
  // track's groupName in practice (same fetch convention already used in
  // lib/actions/teaching-practice-full-sync.ts / -preview.ts), so a single
  // group-scoped query covers everything the pure checker needs.
  const tracks = await prisma.teachingPracticeTrack.findMany({
    where: { groupName, isActive: true },
    select: {
      id: true,
      practiceType: true,
      groupName: true,
      defaultStartTime: true,
      defaultEndTime: true,
      createdAt: true,
      groupTrackId: true,
      trainees: {
        select: {
          traineeId: true,
          rotationOrder: true,
          trainee: { select: { fullName: true, isActive: true, groupName: true } },
        },
      },
      children: {
        select: {
          childId: true,
          child: { select: { fullName: true, isActive: true } },
        },
      },
    },
  });

  return checkTeachingPracticeFixedStructure({
    groupName,
    tracks: tracks.map((t) => ({
      trackId: t.id,
      practiceType: t.practiceType,
      groupName: t.groupName,
      defaultStartTime: t.defaultStartTime,
      defaultEndTime: t.defaultEndTime,
      createdAt: t.createdAt,
      groupTrackId: t.groupTrackId,
      trainees: t.trainees.map((tt) => ({
        traineeId: tt.traineeId,
        fullName: tt.trainee.fullName,
        rotationOrder: tt.rotationOrder,
        isActive: tt.trainee.isActive,
        studentGroupName: tt.trainee.groupName,
      })),
      children: t.children.map((c) => ({
        childId: c.childId,
        fullName: c.child?.fullName ?? null,
        isActive: c.child?.isActive ?? true,
      })),
    })),
  });
}

export async function checkTeachingPracticeFixedStructureForAdmin(
  groupName: string
): Promise<TeachingPracticeFixedStructureCheckResult> {
  await requireAdmin();
  return checkTeachingPracticeFixedStructureInternal(groupName);
}
