"use server";

// Stage C2 - group-scoped full fixed-structure -> generated-lessons sync
// (real apply) for Teaching Practice ("התנסויות מתחילים"). Business rule:
// the fixed structure (TeachingPracticeTrack / TeachingPracticeTrackTrainee /
// TeachingPracticeTrackChild) is the source of truth - this action is
// allowed to overwrite a manually-edited generated lesson's
// participants/children/time/location/instructor, as long as that lesson
// has no feedback and isn't in the past.
//
// This mirrors the comparison logic in
// lib/actions/teaching-practice-full-sync-preview.ts (the read-only dry
// run), but that file's computation helper is intentionally module-private
// (it returns sensitive Teaching Practice data and must stay unreachable
// without going through its own requireAdmin()-gated wrapper - see that
// file's header), so it isn't imported here; the same comparison shape is
// re-implemented directly against the write path below.
//
// This file does NOT modify lib/actions/teaching-practice.ts, and does NOT
// call setTeachingPracticeTrackTraineesAsAdmin / setTeachingPracticeTrackChildrenAsAdmin
// for BEGINNER_GROUP derivation (safety audit finding, see below) - the one
// reusable primitive this sync needs - the rotation formula
// (computeTeachingPracticeRotation) - already lives in its own module
// (lib/teaching-practice-rotation.ts) and is imported directly.
//
// Safety audit finding (fixed): setTeachingPracticeTrackTraineesAsAdmin's
// internal implementation auto-triggers the OLD syncTeachingPracticeTrackParticipants
// side effect whenever the new roster reaches the track's exact expected
// size - which BEGINNER_GROUP derivation always does (always exactly 3
// trainees). That old sync has no past-date filter at all (would silently
// rewrite PAST lessons' participants) and skips isManualOverride lessons
// (the opposite of this file's "manual overrides never block" business
// rule). Calling it here would let a BEGINNER_GROUP roster derivation
// silently mutate lessons outside this file's own eligibility rules, before
// this file's own per-lesson loop even runs. To avoid that, BEGINNER_GROUP
// roster/children derivation is persisted below via two small,
// module-private helpers (replaceTeachingPracticeTrackTraineesForSync /
// replaceTeachingPracticeTrackChildrenForSync) that do nothing but replace
// TeachingPracticeTrackTrainee/TeachingPracticeTrackChild rows for one
// track - no generated-lesson writes, no revalidatePath, no call into any
// exported admin action. All generated-lesson writes in this file remain
// fully controlled by this file's own eligibility logic below.
//
// setTeachingPracticeTrackChildrenAsAdmin, by contrast, has no such side
// effect (confirmed by reading it: it only replaces TeachingPracticeTrackChild
// rows, no generated-lesson writes, no revalidatePath) - but it's still not
// reused here, so that BOTH derivation writes go through the same
// dedicated, minimal, fully-audited path rather than one going through an
// exported admin action and the other not.
//
// Stage E1 - the per-track processing (BEGINNER_GROUP derivation, per-lesson
// comparison/write) is now shared between two entry points:
//   - syncTeachingPracticeFixedStructureToGeneratedLessonsInternal(groupName) -
//     the existing group-scoped path (unchanged behavior), reachable via the
//     exported, requireAdmin()-gated syncTeachingPracticeFixedStructureToGeneratedLessonsAsAdmin.
//   - syncTeachingPracticeFixedStructureTracksToGeneratedLessonsInternal(trackIds) -
//     NEW, module-private, NOT exported, NOT called from anywhere yet. Exists
//     only so a future stage can wire it up to fixed-structure edit actions
//     for scoped auto-sync, without duplicating the sync logic a second time.
//     Fetches only active tracks whose id is in trackIds; for any BEGINNER_GROUP
//     track among them, still fetches its linked BEGINNER_PRIVATE rows for
//     derivation (regardless of whether those private tracks are themselves
//     in trackIds) - but for a BEGINNER_PRIVATE track, does NOT automatically
//     pull in its linked BEGINNER_GROUP track; the caller must pass both ids
//     explicitly if both should be synced together. That cascade decision is
//     deliberately left for a later stage, not decided here.
//
// Scope: the public action remains group-scoped only (groupName required,
// "א"/"ב" only) - this action never runs system-wide. The new track-scoped
// helper is scoped to exactly the track ids given - never system-wide,
// never group-wide.
//
// Eligibility (per lesson): date >= today, and no MEANINGFUL feedback
// recorded on any participant - see lib/teaching-practice-feedback.ts: an
// empty TeachingPracticeFeedback row (created merely by opening/closing the
// feedback modal without entering anything) must never block this sync. A
// lesson failing either check is left completely untouched - not one
// field, not participants, not children.
//
// Never touched, anywhere in this file: TeachingPracticeFeedback (never
// read-modified or deleted), lesson existence (no create/delete), practiceType
// (deliberately excluded from the syncable-fields list), and generation/
// date-creation logic (nothing here calls it).

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/require-admin";
import { parseDateKey, todayDateKey } from "@/lib/dates";
import {
  computeTeachingPracticeRotation,
  TEACHING_PRACTICE_TEAM_SIZE,
  type TeachingPracticeRoleValue,
  type TeachingPracticeTypeValue,
} from "@/lib/teaching-practice-rotation";
import { hasMeaningfulTeachingPracticeFeedback } from "@/lib/teaching-practice-feedback";

// Mirrors VALID_GROUP_NAMES in lib/actions/teaching-practice.ts (not
// exported from there) - same small, deliberate, self-contained duplication
// already used in lib/teaching-practice-trainee-suggestions.ts and
// lib/actions/teaching-practice-full-sync-preview.ts for the same reason.
const VALID_GROUP_NAMES = ["א", "ב"] as const;

export interface TeachingPracticeFullSyncApplyError {
  trackId: string;
  lessonId?: string;
  message: string;
}

export interface TeachingPracticeFullSyncApplyResult {
  groupName: string;
  tracksChecked: number;
  tracksSkippedNoLessons: number;
  tracksSkippedIncompleteFixedStructure: number;
  beginnerGroupRostersDerived: number;
  beginnerGroupRostersSkipped: number;
  lessonsChecked: number;
  lessonsSynced: number;
  lessonsUnchanged: number;
  lessonsSkippedFeedback: number;
  lessonsSkippedPastDate: number;
  participants: { created: number; deleted: number; unchanged: number };
  childAssignments: { created: number; deleted: number; unchanged: number };
  lessonFields: { updated: number; unchanged: number };
  errors: TeachingPracticeFullSyncApplyError[];
}

function emptyResult(groupName: string): TeachingPracticeFullSyncApplyResult {
  return {
    groupName,
    tracksChecked: 0,
    tracksSkippedNoLessons: 0,
    tracksSkippedIncompleteFixedStructure: 0,
    beginnerGroupRostersDerived: 0,
    beginnerGroupRostersSkipped: 0,
    lessonsChecked: 0,
    lessonsSynced: 0,
    lessonsUnchanged: 0,
    lessonsSkippedFeedback: 0,
    lessonsSkippedPastDate: 0,
    participants: { created: 0, deleted: 0, unchanged: 0 },
    childAssignments: { created: 0, deleted: 0, unchanged: 0 },
    lessonFields: { updated: 0, unchanged: 0 },
    errors: [],
  };
}

// Same ordering the fixed-structure UI already uses for linked private rows
// (compareLinkedPrivateRows in TeachingPracticeManager.tsx) - replicated
// here rather than imported, since that comparator lives in a client
// component file this server module can't import from. Byte-for-byte
// equivalent: defaultStartTime, then createdAt, then id. Same replication
// already used in lib/actions/teaching-practice-full-sync-preview.ts.
function compareLinkedPrivateTracks(
  a: { defaultStartTime: string; createdAt: Date; id: string },
  b: { defaultStartTime: string; createdAt: Date; id: string }
): number {
  return (
    a.defaultStartTime.localeCompare(b.defaultStartTime) ||
    a.createdAt.getTime() - b.createdAt.getTime() ||
    a.id.localeCompare(b.id)
  );
}

interface FixedTrack {
  id: string;
  practiceType: TeachingPracticeTypeValue;
  groupName: string | null;
  defaultStartTime: string;
  defaultEndTime: string;
  defaultLocation: string | null;
  defaultResponsibleInstructorId: string | null;
  groupTrackId: string | null;
  createdAt: Date;
  trainees: { traineeId: string; rotationOrder: number }[];
  children: { childId: string | null; horseName: string | null; equipmentNotes: string | null }[];
  _count: { lessons: number };
}

interface LinkedPrivateTrack {
  id: string;
  groupTrackId: string | null;
  defaultStartTime: string;
  createdAt: Date;
  trainees: { traineeId: string; rotationOrder: number }[];
  children: { childId: string | null; horseName: string | null; equipmentNotes: string | null }[];
}

// Shared select shape for the main track fetch - used identically by both
// the group-scoped and track-scoped entry points, so their results are
// structurally guaranteed to match FixedTrack.
const TRACK_SELECT = {
  id: true,
  practiceType: true,
  groupName: true,
  defaultStartTime: true,
  defaultEndTime: true,
  defaultLocation: true,
  defaultResponsibleInstructorId: true,
  groupTrackId: true,
  createdAt: true,
  trainees: { select: { traineeId: true, rotationOrder: true } },
  children: { select: { childId: true, horseName: true, equipmentNotes: true } },
  _count: { select: { lessons: true } },
} as const;

// Shared select shape for the batched linked-BEGINNER_PRIVATE-tracks fetch.
const LINKED_PRIVATE_SELECT = {
  id: true,
  groupTrackId: true,
  defaultStartTime: true,
  createdAt: true,
  trainees: { select: { traineeId: true, rotationOrder: true } },
  children: { select: { childId: true, horseName: true, equipmentNotes: true } },
} as const;

// Replaces ONLY TeachingPracticeTrackTrainee rows for one track - no
// generated-lesson writes, no revalidatePath, no call into any exported
// admin action. Deliberately NOT setTeachingPracticeTrackTraineesInternal:
// that function auto-triggers syncTeachingPracticeTrackParticipants once the
// roster reaches the track's exact expected size (which BEGINNER_GROUP
// derivation always does), and that old sync ignores past-date eligibility
// and skips isManualOverride lessons - both wrong for this file's own rules.
// traineeIds is expected to already be deduped/valid (derived from other
// tracks' own persisted rosters); no additional validation is performed
// here, since this is an internal derivation step, not user-supplied input.
async function replaceTeachingPracticeTrackTraineesForSync(trackId: string, traineeIds: string[]): Promise<void> {
  await prisma.$transaction([
    prisma.teachingPracticeTrackTrainee.deleteMany({ where: { trackId } }),
    prisma.teachingPracticeTrackTrainee.createMany({
      data: traineeIds.map((traineeId, rotationOrder) => ({ trackId, traineeId, rotationOrder })),
    }),
  ]);
}

// Replaces ONLY TeachingPracticeTrackChild rows for one track - no
// generated-lesson writes, no revalidatePath, no call into any exported
// admin action. children is expected to already be deduped by childId
// (derived from other tracks' own persisted rows); no additional validation
// is performed here, for the same reason as above.
async function replaceTeachingPracticeTrackChildrenForSync(
  trackId: string,
  children: { childId: string; horseName: string | null; equipmentNotes: string | null }[]
): Promise<void> {
  await prisma.$transaction([
    prisma.teachingPracticeTrackChild.deleteMany({ where: { trackId } }),
    prisma.teachingPracticeTrackChild.createMany({
      data: children.map((c) => ({ trackId, childId: c.childId, horseName: c.horseName, equipmentNotes: c.equipmentNotes })),
    }),
  ]);
}

// Stage E1 extraction - everything that used to be the body of the
// group-scoped sync's per-track for-loop, now shared by both entry points.
// Mutates `result` in place (same convention the original loop already
// used). Byte-for-byte identical logic to before the refactor - only
// lifted out of its enclosing loop/function so a second caller (the new
// track-scoped helper) can invoke it without duplicating any of it.
async function processTrackForSync(
  track: FixedTrack,
  linkedByGroupTrackId: Map<string, LinkedPrivateTrack[]>,
  todayUtc: Date,
  result: TeachingPracticeFullSyncApplyResult
): Promise<void> {
  result.tracksChecked += 1;

  if (track._count.lessons === 0) {
    result.tracksSkippedNoLessons += 1;
    return;
  }

  // Effective trainees/children for this run - normally the track's own
  // rows, but for BEGINNER_GROUP, first attempt to derive+persist them from
  // the linked BEGINNER_PRIVATE rows (see file header). "Do not guess when
  // incomplete" - any failure to derive cleanly falls back to whatever the
  // group track's own rows already are, reported as skipped, never blocks
  // the rest of this track's lesson sync.
  let effectiveTrainees = track.trainees;
  let effectiveChildren = track.children;

  if (track.practiceType === "BEGINNER_GROUP") {
    const expectedGroupSize = TEACHING_PRACTICE_TEAM_SIZE.BEGINNER_GROUP;
    const linked = (linkedByGroupTrackId.get(track.id) ?? []).slice().sort(compareLinkedPrivateTracks);

    if (linked.length !== expectedGroupSize) {
      result.beginnerGroupRostersSkipped += 1;
    } else {
      const slot0Trainees = linked.map((p) => p.trainees.find((t) => t.rotationOrder === 0)?.traineeId ?? null);
      if (slot0Trainees.some((id) => id === null)) {
        result.beginnerGroupRostersSkipped += 1;
      } else {
        const derivedTraineeIds = slot0Trainees as string[]; // linked[i] -> group rotationOrder i
        try {
          await replaceTeachingPracticeTrackTraineesForSync(track.id, derivedTraineeIds);
          result.beginnerGroupRostersDerived += 1;
          effectiveTrainees = derivedTraineeIds.map((traineeId, rotationOrder) => ({ traineeId, rotationOrder }));
        } catch (err) {
          result.beginnerGroupRostersSkipped += 1;
          result.errors.push({
            trackId: track.id,
            message: `דירוג צוות לשיעור הקבוצתי נכשל: ${err instanceof Error ? err.message : "אירעה שגיאה"}`,
          });
        }

        // Children: union of every linked private track's real children,
        // deduped by childId (first occurrence, in the same stable link
        // order, wins if horse/equipment notes ever differ between them).
        const derivedChildrenMap = new Map<string, { childId: string; horseName: string | null; equipmentNotes: string | null }>();
        for (const p of linked) {
          for (const c of p.children) {
            if (c.childId && !derivedChildrenMap.has(c.childId)) {
              derivedChildrenMap.set(c.childId, { childId: c.childId, horseName: c.horseName, equipmentNotes: c.equipmentNotes });
            }
          }
        }
        const derivedChildren = Array.from(derivedChildrenMap.values());
        try {
          await replaceTeachingPracticeTrackChildrenForSync(track.id, derivedChildren);
          effectiveChildren = derivedChildren.map((c) => ({ childId: c.childId, horseName: c.horseName, equipmentNotes: c.equipmentNotes }));
        } catch (err) {
          result.errors.push({
            trackId: track.id,
            message: `דירוג ילדים לשיעור הקבוצתי נכשל: ${err instanceof Error ? err.message : "אירעה שגיאה"}`,
          });
        }
      }
    }
  }

  const expectedTeamSize = TEACHING_PRACTICE_TEAM_SIZE[track.practiceType];
  if (effectiveTrainees.length !== expectedTeamSize) {
    result.tracksSkippedIncompleteFixedStructure += 1;
    return;
  }

  const traineeInput = [...effectiveTrainees].sort((a, b) => a.rotationOrder - b.rotationOrder);
  const targetChildAssignments = effectiveChildren
    .filter((c): c is { childId: string; horseName: string | null; equipmentNotes: string | null } => c.childId !== null)
    .map((c) => ({ childId: c.childId, horseName: c.horseName, equipmentNotes: c.equipmentNotes }));

  // Fetched in full chronological order (not date-filtered) so each
  // lesson's occurrenceIndex - needed for the rotation formula - reflects
  // its true position among ALL of this track's lessons, exactly matching
  // the existing generation/sync convention. Eligibility (past-date/
  // feedback) is applied per lesson below, after occurrenceIndex is known,
  // never by excluding a lesson from this list up front.
  const lessons = await prisma.teachingPracticeLesson.findMany({
    where: { trackId: track.id },
    orderBy: [{ date: "asc" }, { startTime: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    include: {
      participants: {
        select: {
          id: true,
          traineeId: true,
          role: true,
          feedback: { select: { feedback: true, ratingHalfPoints: true } },
        },
      },
      childAssignments: { select: { id: true, childId: true, horseName: true, equipmentNotes: true, isAbsent: true } },
    },
  });

  for (let occurrenceIndex = 0; occurrenceIndex < lessons.length; occurrenceIndex++) {
    const lesson = lessons[occurrenceIndex];
    result.lessonsChecked += 1;

    if (lesson.date.getTime() < todayUtc.getTime()) {
      result.lessonsSkippedPastDate += 1;
      continue;
    }
    if (lesson.participants.some((p) => hasMeaningfulTeachingPracticeFeedback(p.feedback))) {
      result.lessonsSkippedFeedback += 1;
      continue;
    }

    try {
      let roleAssignments: { traineeId: string; role: TeachingPracticeRoleValue }[];
      try {
        roleAssignments = computeTeachingPracticeRotation(track.practiceType, traineeInput, occurrenceIndex);
      } catch (err) {
        result.errors.push({
          trackId: track.id,
          lessonId: lesson.id,
          message: err instanceof Error ? err.message : "שגיאה בחישוב חלוקת התפקידים",
        });
        continue;
      }

      // ---- Participants: compare current vs. target (traineeId+role pairs) ----
      const currentParticipantKey = new Set(lesson.participants.map((p) => `${p.traineeId}:${p.role}`));
      const targetParticipantKey = new Set(roleAssignments.map((r) => `${r.traineeId}:${r.role}`));
      const participantsMatch =
        currentParticipantKey.size === targetParticipantKey.size &&
        [...currentParticipantKey].every((k) => targetParticipantKey.has(k));

      // ---- Child assignments: compare current vs. target (childId + horse/equipment) ----
      const currentChildByChildId = new Map(lesson.childAssignments.map((c) => [c.childId, c]));
      const targetChildByChildId = new Map(targetChildAssignments.map((c) => [c.childId, c]));
      const childrenMatch =
        currentChildByChildId.size === targetChildByChildId.size &&
        [...targetChildByChildId.entries()].every(([childId, target]) => {
          const current = currentChildByChildId.get(childId);
          return current != null && current.horseName === target.horseName && current.equipmentNotes === target.equipmentNotes;
        });

      // ---- Lesson fields: startTime/endTime/location/instructor/groupName ----
      const fieldsMatch =
        lesson.startTime === track.defaultStartTime &&
        lesson.endTime === track.defaultEndTime &&
        lesson.location === track.defaultLocation &&
        lesson.responsibleInstructorId === track.defaultResponsibleInstructorId &&
        lesson.groupName === track.groupName;

      if (participantsMatch && childrenMatch && fieldsMatch) {
        result.lessonsUnchanged += 1;
        result.participants.unchanged += lesson.participants.length;
        result.childAssignments.unchanged += lesson.childAssignments.length;
        result.lessonFields.unchanged += 1;
        continue;
      }

      const writes = [];

      if (!participantsMatch) {
        writes.push(prisma.teachingPracticeParticipant.deleteMany({ where: { lessonId: lesson.id } }));
        writes.push(
          prisma.teachingPracticeParticipant.createMany({
            data: roleAssignments.map((r) => ({
              lessonId: lesson.id,
              traineeId: r.traineeId,
              role: r.role,
              isManualOverride: false,
            })),
          })
        );
      }

      if (!childrenMatch) {
        // Preserve each surviving child's isAbsent - a genuine per-
        // occurrence fact the fixed structure has no equivalent field for,
        // never something this sync should reset to false.
        writes.push(prisma.teachingPracticeChildAssignment.deleteMany({ where: { lessonId: lesson.id } }));
        writes.push(
          prisma.teachingPracticeChildAssignment.createMany({
            data: targetChildAssignments.map((c) => ({
              lessonId: lesson.id,
              childId: c.childId,
              horseName: c.horseName,
              equipmentNotes: c.equipmentNotes,
              isAbsent: currentChildByChildId.get(c.childId)?.isAbsent ?? false,
            })),
          })
        );
      }

      if (!fieldsMatch) {
        writes.push(
          prisma.teachingPracticeLesson.update({
            where: { id: lesson.id },
            data: {
              startTime: track.defaultStartTime,
              endTime: track.defaultEndTime,
              location: track.defaultLocation,
              responsibleInstructorId: track.defaultResponsibleInstructorId,
              groupName: track.groupName,
            },
          })
        );
      }

      await prisma.$transaction(writes);

      if (!participantsMatch) {
        result.participants.deleted += lesson.participants.length;
        result.participants.created += roleAssignments.length;
      } else {
        result.participants.unchanged += lesson.participants.length;
      }
      if (!childrenMatch) {
        result.childAssignments.deleted += lesson.childAssignments.length;
        result.childAssignments.created += targetChildAssignments.length;
      } else {
        result.childAssignments.unchanged += lesson.childAssignments.length;
      }
      if (!fieldsMatch) result.lessonFields.updated += 1;
      else result.lessonFields.unchanged += 1;

      result.lessonsSynced += 1;
    } catch (err) {
      result.errors.push({
        trackId: track.id,
        lessonId: lesson.id,
        message: err instanceof Error ? err.message : "אירעה שגיאה בסנכרון השיעור",
      });
    }
  }
}

// Stage E1 extraction - shared orchestration for both entry points: given
// an already-fetched list of tracks (however they were selected) and a
// label for the result's groupName field, batches the linked-private-tracks
// fetch (needed for any BEGINNER_GROUP track among them) and runs
// processTrackForSync over every track. Neither entry point below
// duplicates this logic.
async function syncTracksInternal(
  tracks: FixedTrack[],
  resultGroupName: string
): Promise<TeachingPracticeFullSyncApplyResult> {
  const result = emptyResult(resultGroupName);

  // Batched: every BEGINNER_PRIVATE track linked to any BEGINNER_GROUP track
  // among the tracks being processed, fetched once, not per-track. This
  // runs regardless of whether those linked private tracks are themselves
  // part of `tracks` - a BEGINNER_GROUP track always needs its linked rows
  // for derivation, whether it was reached via the group-scoped fetch (where
  // its linked privates are also naturally in `tracks`) or the track-scoped
  // one (where they might not be).
  const groupTrackIds = tracks.filter((t) => t.practiceType === "BEGINNER_GROUP").map((t) => t.id);
  const linkedPrivateTracks: LinkedPrivateTrack[] = groupTrackIds.length
    ? await prisma.teachingPracticeTrack.findMany({
        where: { practiceType: "BEGINNER_PRIVATE", groupTrackId: { in: groupTrackIds } },
        select: LINKED_PRIVATE_SELECT,
      })
    : [];
  const linkedByGroupTrackId = new Map<string, LinkedPrivateTrack[]>();
  for (const p of linkedPrivateTracks) {
    if (!p.groupTrackId) continue;
    const list = linkedByGroupTrackId.get(p.groupTrackId) ?? [];
    list.push(p);
    linkedByGroupTrackId.set(p.groupTrackId, list);
  }

  const todayUtc = parseDateKey(todayDateKey());

  for (const track of tracks) {
    await processTrackForSync(track, linkedByGroupTrackId, todayUtc, result);
  }

  return result;
}

// Unchanged public behavior: group-scoped only, "א"/"ב" required.
async function syncTeachingPracticeFixedStructureToGeneratedLessonsInternal(
  groupName: string
): Promise<TeachingPracticeFullSyncApplyResult> {
  if (!VALID_GROUP_NAMES.includes(groupName as "א" | "ב")) {
    throw new Error("קבוצה לא תקינה - יש לבחור קבוצה א או קבוצה ב");
  }

  const tracks: FixedTrack[] = await prisma.teachingPracticeTrack.findMany({
    where: { groupName, isActive: true },
    select: TRACK_SELECT,
  });

  return syncTracksInternal(tracks, groupName);
}

// Stage E1 - NEW, module-private, NOT exported, NOT called from anywhere
// yet. Prepared so a future stage can wire scoped auto-sync to
// fixed-structure edit actions without duplicating the sync logic. Fetches
// only active tracks whose id is in trackIds - never group-wide, never
// system-wide. For a BEGINNER_PRIVATE track in trackIds, does NOT
// automatically also sync its linked BEGINNER_GROUP track (or vice versa) -
// the caller must include both ids explicitly if both should be synced
// together; that cascade decision belongs to a later stage.
//
// resultGroupName is derived from whichever tracks were actually found
// (all expected to share one real group in practice) rather than accepted
// as a parameter, since track-scoped callers don't necessarily know it
// upfront - falls back to "" if no tracks matched (e.g. all ids were
// inactive or nonexistent), never throws for that case.
//
// Deliberately unused for now (Stage E1 is prep-only, per its own
// requirements) - the lint suppression below is temporary and expected to
// be removed the moment a later stage actually calls this from an edit
// action.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function syncTeachingPracticeFixedStructureTracksToGeneratedLessonsInternal(
  trackIds: string[]
): Promise<TeachingPracticeFullSyncApplyResult> {
  const tracks: FixedTrack[] = await prisma.teachingPracticeTrack.findMany({
    where: { id: { in: trackIds }, isActive: true },
    select: TRACK_SELECT,
  });

  const resultGroupName = tracks[0]?.groupName ?? "";
  return syncTracksInternal(tracks, resultGroupName);
}

export async function syncTeachingPracticeFixedStructureToGeneratedLessonsAsAdmin(
  groupName: string
): Promise<TeachingPracticeFullSyncApplyResult> {
  await requireAdmin();
  return syncTeachingPracticeFixedStructureToGeneratedLessonsInternal(groupName);
}
