"use server";

// Stage 0 - read-only data-fetch + calculation wrapper around the pure
// engine in lib/teaching-practice-trainee-suggestions.ts. This file never
// writes to the database: no create/update/delete/upsert Prisma calls, no
// calls into any existing set*/create*/update*/delete* Teaching Practice
// write action, and no revalidatePath. There is no apply step yet - Stage 0
// is preview-only, matching the approved design.

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/require-admin";
import {
  computeTeachingPracticeTraineeSuggestions,
  TEACHING_PRACTICE_SUGGESTION_GROUP_NAMES,
  type ComputeTraineeSuggestionsInput,
  type ComputeTraineeSuggestionsResult,
  type TraineeSuggestionInputParticipantHistory,
  type TraineeSuggestionInputTrackTrainee,
  type TraineeSuggestionInputTrainee,
} from "@/lib/teaching-practice-trainee-suggestions";

async function computeTeachingPracticeTraineeSuggestionsForGroupInternal(
  groupName: string
): Promise<ComputeTraineeSuggestionsResult> {
  if (!TEACHING_PRACTICE_SUGGESTION_GROUP_NAMES.includes(groupName as "א" | "ב")) {
    throw new Error("קבוצה לא תקינה - יש לבחור קבוצה א או קבוצה ב");
  }

  const tracks = await prisma.teachingPracticeTrack.findMany({
    where: { groupName, isActive: true },
    select: {
      id: true,
      practiceType: true,
      groupName: true,
      weekday: true,
      defaultStartTime: true,
      defaultEndTime: true,
    },
  });
  const trackIds = tracks.map((t) => t.id);

  const trackTraineeRows = trackIds.length
    ? await prisma.teachingPracticeTrackTrainee.findMany({
        where: { trackId: { in: trackIds } },
        select: {
          trackId: true,
          traineeId: true,
          rotationOrder: true,
          trainee: { select: { id: true, fullName: true, groupName: true, isActive: true } },
        },
      })
    : [];

  const activeGroupTrainees = await prisma.student.findMany({
    where: { groupName, isActive: true },
    select: { id: true, fullName: true, groupName: true, isActive: true },
  });

  // Directory must include every trainee referenced by trackTraineeRows too,
  // even if inactive or from a different group - needed to name a mismatched
  // current occupant, not just this group's own active roster (see the input
  // contract documented on ComputeTraineeSuggestionsInput).
  const traineeDirectory = new Map<string, TraineeSuggestionInputTrainee>();
  for (const t of activeGroupTrainees) traineeDirectory.set(t.id, t);
  for (const row of trackTraineeRows) {
    if (!traineeDirectory.has(row.trainee.id)) traineeDirectory.set(row.trainee.id, row.trainee);
  }
  const traineeIds = Array.from(traineeDirectory.keys());

  // Full history for every referenced trainee, regardless of which track it
  // came from - a חניך's lifetime bucket counts must not be scoped only to
  // this group's current tracks (see file header of the pure engine).
  const participantRows = traineeIds.length
    ? await prisma.teachingPracticeParticipant.findMany({
        where: { traineeId: { in: traineeIds } },
        select: {
          traineeId: true,
          role: true,
          lesson: { select: { trackId: true, practiceType: true } },
        },
      })
    : [];

  const trackTrainees: TraineeSuggestionInputTrackTrainee[] = trackTraineeRows.map((r) => ({
    trackId: r.trackId,
    traineeId: r.traineeId,
    rotationOrder: r.rotationOrder,
  }));

  const participantHistory: TraineeSuggestionInputParticipantHistory[] = participantRows.map((p) => ({
    traineeId: p.traineeId,
    trackId: p.lesson.trackId,
    practiceType: p.lesson.practiceType,
    role: p.role,
  }));

  const input: ComputeTraineeSuggestionsInput = {
    groupName,
    trainees: Array.from(traineeDirectory.values()),
    tracks: tracks.map((t) => ({
      id: t.id,
      practiceType: t.practiceType,
      groupName: t.groupName,
      weekday: t.weekday,
      defaultStartTime: t.defaultStartTime,
      defaultEndTime: t.defaultEndTime,
    })),
    trackTrainees,
    participantHistory,
  };

  return computeTeachingPracticeTraineeSuggestions(input);
}

// Admin-only for Stage 0 (no UI/instructor entry point exists yet). Mirrors
// the requireAdmin-gated read pattern used throughout
// lib/actions/teaching-practice.ts (e.g. listTeachingPracticeTracksForAdmin).
// An instructor-facing variant can be added later the same way
// listTeachingPracticeTracksForInstructor mirrors its admin counterpart, once
// a UI actually needs it.
export async function getTeachingPracticeTraineeSuggestionsForAdmin(
  groupName: string
): Promise<ComputeTraineeSuggestionsResult> {
  await requireAdmin();
  return computeTeachingPracticeTraineeSuggestionsForGroupInternal(groupName);
}
