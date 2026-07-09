// Stage 0 - pure, read-only suggestion engine for assigning חניכים (course
// trainees) to Teaching Practice ("התנסויות מתחילים") fixed-structure track
// slots. No DB access, no "use server", no imports from any write action or
// from TeachingPracticeManager.tsx - same convention as
// teaching-practice-rotation.ts / teaching-practice-schedule-check.ts. This
// module only ever reads already-fetched data and returns suggestion
// preview data; it must never be given, and never gains, any way to write to
// the database. The caller (lib/actions/teaching-practice-suggestions.ts)
// fetches data and is solely responsible for any future apply step, which
// does not exist yet in Stage 0.
//
// Scope: fixed-structure tracks only (TeachingPracticeTrack /
// TeachingPracticeTrackTrainee). Generated lessons are only ever read here as
// a source of *historical role facts* (via TraineeSuggestionInputParticipantHistory);
// this module never reasons about which lessons exist on which dates, and
// never suggests anything for a generated lesson directly.
//
// Bucket design (approved product rules):
//   lungeAny               - target 1 - fed by LUNGE LEAD_INSTRUCTOR or ASSISTANT_INSTRUCTOR
//                            (role doesn't matter - lunge pairs alternate lead/assistant
//                            across weeks, so a single lunge track membership already
//                            satisfies this bucket regardless of which role is realized).
//   privateGroupLead       - target 1 - fed by BEGINNER_PRIVATE LEAD_INSTRUCTOR or
//                            BEGINNER_GROUP LEAD_INSTRUCTOR.
//   privateGroupAssistant  - target 1 - fed ONLY by BEGINNER_PRIVATE ASSISTANT_INSTRUCTOR.
// Informational only (never counted toward a target, always reported so a
// future UI can still show them to the מנהלת):
//   beginnerGroupSecond    - BEGINNER_GROUP SECOND_INSTRUCTOR
//   evaluator              - BEGINNER_GROUP EVALUATOR
// Rationale for excluding SECOND_INSTRUCTOR/EVALUATOR from the assistant
// target: ROLE_LABELS ("מדריך שני" / "ממשב") and ROLE_SLOTS_BY_PRACTICE_TYPE in
// TeachingPracticeManager.tsx never treat either as equivalent to
// ASSISTANT_INSTRUCTOR ("עוזר מדריך"), and BEGINNER_GROUP has no
// ASSISTANT_INSTRUCTOR role at all - it is a genuinely different 3-role
// system, not a 2-role system with an observer bolted on. Folding them into
// "assistant" would risk telling the מנהלת a חניך already did assistant work
// they did not actually do.
//
// Counting unit: a single TRACK MEMBERSHIP, not a single generated lesson.
// A fixed-structure "assignment" is one track membership - if a track later
// generates many lesson dates, the same membership still counts once per
// bucket it has ever realized (deduplicated per track), never once per
// lesson. This is what makes "target 1" meaningful: a lunge track that has
// generated 10 lessons for the same pair should read as "1 lungeAny
// assignment fulfilled", not "10".

import {
  computeTeachingPracticeRotation,
  TEACHING_PRACTICE_TEAM_SIZE,
  type TeachingPracticeRoleValue,
  type TeachingPracticeTypeValue,
} from "@/lib/teaching-practice-rotation";
import { parseTimeToMinutes } from "@/lib/teaching-practice-schedule-check";

// Only the two real course groups - mirrors the VALID_GROUP_NAMES convention
// in lib/actions/teaching-practice.ts (not exported from there, so this is a
// small, deliberate, self-contained duplication rather than modifying that
// "do not touch" write-action file just to export a constant).
export const TEACHING_PRACTICE_SUGGESTION_GROUP_NAMES = ["א", "ב"] as const;

export const TRAINEE_SUGGESTION_TARGET_PER_BUCKET = 1;
export const TRAINEE_SUGGESTION_TOTAL_TARGET = 3;

export type TraineeSuggestionBucket = "lungeAny" | "privateGroupLead" | "privateGroupAssistant";

// ---------------------------------------------------------------------------
// Input shapes - already-fetched, plain data. No Prisma types leak in here.
// ---------------------------------------------------------------------------

export interface TraineeSuggestionInputTrainee {
  id: string;
  fullName: string;
  groupName: string | null;
  isActive: boolean;
}

export interface TraineeSuggestionInputTrack {
  id: string;
  practiceType: TeachingPracticeTypeValue;
  groupName: string | null;
  // 0=Sunday..6=Saturday, matches JS Date#getDay() - same "free-standing hint,
  // not enforced" field as TeachingPracticeTrack.weekday. Null/invalid values
  // are handled safely (see tracksMayOverlap) rather than crashing.
  weekday: number | null;
  defaultStartTime: string;
  defaultEndTime: string;
}

// One row per current track membership (TeachingPracticeTrackTrainee).
export interface TraineeSuggestionInputTrackTrainee {
  trackId: string;
  traineeId: string;
  rotationOrder: number;
}

// One row per realized TeachingPracticeParticipant, denormalized with its
// lesson's practiceType (and trackId, nullable for an ad-hoc lesson with no
// track) so this module never needs to cross-reference the tracks list to
// know how to bucket a historical role - a realized fact stays valid even if
// the trainee has since left that track, or the track isn't part of the
// current suggestion run's tracks list at all (e.g. a different group's
// track from before a group change).
export interface TraineeSuggestionInputParticipantHistory {
  traineeId: string;
  trackId: string | null;
  practiceType: TeachingPracticeTypeValue;
  role: TeachingPracticeRoleValue;
}

// Must include every trainee referenced anywhere in trackTrainees or
// participantHistory, not just the group's own active roster - needed to
// compute existing_group_mismatch / current-occupant-name display even for a
// trainee who is inactive or belongs to a different group than this run.
export interface ComputeTraineeSuggestionsInput {
  groupName: string;
  trainees: TraineeSuggestionInputTrainee[];
  tracks: TraineeSuggestionInputTrack[];
  trackTrainees: TraineeSuggestionInputTrackTrainee[];
  participantHistory: TraineeSuggestionInputParticipantHistory[];
}

// ---------------------------------------------------------------------------
// Output shapes
// ---------------------------------------------------------------------------

export interface TraineeSuggestionExcludedCandidate {
  traineeId: string;
  traineeName: string;
  reason: string;
}

export interface TraineeSuggestionRotationSlot {
  trackId: string;
  practiceType: TeachingPracticeTypeValue;
  weekday: number | null;
  defaultStartTime: string;
  defaultEndTime: string;
  rotationOrder: number;
  // The role this rotation-order position would receive on the track's
  // first-ever generated lesson (occurrenceIndex 0) - exact once the track
  // has no generated lessons yet, an approximation otherwise (see
  // projectRoleForRotationOrder doc comment).
  projectedRole: TeachingPracticeRoleValue;
  // Which of the 3 real target buckets this slot counts toward for scoring
  // purposes - null for a BEGINNER_GROUP rotationOrder 1/2 slot, which does
  // not count toward privateGroupAssistant (see bucketNote).
  targetBucket: TraineeSuggestionBucket | null;
  // Set only when targetBucket is null, explaining why (rule 7 / EVALUATOR
  // decision above) so a future UI can show this to the מנהלת instead of
  // silently treating the slot as unscored.
  bucketNote: string | null;
  currentTraineeId: string | null;
  currentTraineeName: string | null;
  suggestedTraineeId: string | null;
  suggestedTraineeName: string | null;
  reason: string;
  excludedCandidates: TraineeSuggestionExcludedCandidate[];
}

export interface TraineeSuggestionTrackGroup {
  trackId: string;
  practiceType: TeachingPracticeTypeValue;
  weekday: number | null;
  defaultStartTime: string;
  defaultEndTime: string;
  slots: TraineeSuggestionRotationSlot[];
}

export interface TraineeBucketSummary {
  traineeId: string;
  traineeName: string;
  counts: {
    lungeAny: number;
    privateGroupLead: number;
    privateGroupAssistant: number;
  };
  informational: {
    beginnerGroupSecond: number;
    evaluator: number;
  };
  targetGaps: {
    lungeAny: number;
    privateGroupLead: number;
    privateGroupAssistant: number;
  };
  // Current fixed-structure track memberships (TeachingPracticeTrackTrainee
  // rows), not lifetime history - distinct from `counts`, which does include
  // historical realized roles even from a track the trainee has since left.
  totalCurrentFixedStructureAssignments: number;
}

export type TraineeSuggestionWarningKind =
  | "supply_below_demand"
  | "no_suitable_candidate"
  | "existing_group_mismatch"
  | "existing_overlap"
  | "missing_or_invalid_time_data";

export interface TraineeSuggestionWarning {
  kind: TraineeSuggestionWarningKind;
  message: string;
  trackId?: string;
  traineeId?: string;
}

export interface ComputeTraineeSuggestionsResult {
  groupName: string;
  tracks: TraineeSuggestionTrackGroup[];
  traineeSummaries: TraineeBucketSummary[];
  warnings: TraineeSuggestionWarning[];
}

// ---------------------------------------------------------------------------
// Role -> bucket mapping (the corrected design)
// ---------------------------------------------------------------------------

type BucketOrInformational = TraineeSuggestionBucket | "beginnerGroupSecond" | "evaluator";

const ROLE_TO_BUCKET: Record<
  TeachingPracticeTypeValue,
  Partial<Record<TeachingPracticeRoleValue, BucketOrInformational>>
> = {
  LUNGE: {
    LEAD_INSTRUCTOR: "lungeAny",
    ASSISTANT_INSTRUCTOR: "lungeAny",
  },
  BEGINNER_PRIVATE: {
    LEAD_INSTRUCTOR: "privateGroupLead",
    ASSISTANT_INSTRUCTOR: "privateGroupAssistant",
  },
  BEGINNER_GROUP: {
    LEAD_INSTRUCTOR: "privateGroupLead",
    SECOND_INSTRUCTOR: "beginnerGroupSecond",
    EVALUATOR: "evaluator",
  },
};

const BEGINNER_GROUP_NON_LEAD_NOTE =
  "תפקיד זה (מדריך שני/ממשב) אינו נספר ליעד עוזר מדריך - שיבוץ לפי איזון עומס כללי בלבד";

// What rotationOrder position `n` would receive on a track's first-ever
// generated lesson (occurrenceIndex 0). Reuses the real, exported
// computeTeachingPracticeRotation with placeholder trainee ids instead of
// re-deriving the role order locally, so this can never silently drift from
// the actual generation-time rotation formula. Exact for a track with no
// generated lessons yet (the expected case for a fixed-structure-only
// suggestion run). An approximation for a track that already has generated
// lessons and an incomplete team: real resync (syncTeachingPracticeTrackParticipants,
// untouched and not duplicated here) recomputes occurrenceIndex per
// chronological lesson once the team completes, which can differ from this
// occurrenceIndex-0 projection - reported as a known Stage 0 limitation, not
// silently assumed away.
function projectRoleForRotationOrder(
  practiceType: TeachingPracticeTypeValue,
  rotationOrder: number
): TeachingPracticeRoleValue {
  const size = TEACHING_PRACTICE_TEAM_SIZE[practiceType];
  const placeholders = Array.from({ length: size }, (_, i) => ({
    traineeId: `placeholder-${i}`,
    rotationOrder: i,
  }));
  const roles = computeTeachingPracticeRotation(practiceType, placeholders, 0);
  return roles[rotationOrder]?.role ?? roles[roles.length - 1].role;
}

function targetBucketForSlot(
  practiceType: TeachingPracticeTypeValue,
  rotationOrder: number
): { bucket: TraineeSuggestionBucket | null; note: string | null } {
  if (practiceType === "LUNGE") return { bucket: "lungeAny", note: null };
  if (practiceType === "BEGINNER_PRIVATE") {
    return rotationOrder === 0
      ? { bucket: "privateGroupLead", note: null }
      : { bucket: "privateGroupAssistant", note: null };
  }
  // BEGINNER_GROUP
  if (rotationOrder === 0) return { bucket: "privateGroupLead", note: null };
  return { bucket: null, note: BEGINNER_GROUP_NON_LEAD_NOTE };
}

// ---------------------------------------------------------------------------
// Overlap detection - fixed-structure best-effort check (weekday + time
// window only; real generated-lesson-date overlap is out of scope for Stage 0).
// ---------------------------------------------------------------------------

interface OverlapCheck {
  overlaps: boolean;
  // true when overlap could not be determined (missing/invalid weekday or
  // time) - callers must not exclude a candidate on an "unknown" result, only
  // warn.
  unknown: boolean;
}

function tracksMayOverlap(a: TraineeSuggestionInputTrack, b: TraineeSuggestionInputTrack): OverlapCheck {
  if (a.weekday == null || b.weekday == null) return { overlaps: false, unknown: true };
  if (!Number.isInteger(a.weekday) || !Number.isInteger(b.weekday) || a.weekday < 0 || a.weekday > 6 || b.weekday < 0 || b.weekday > 6) {
    return { overlaps: false, unknown: true };
  }
  if (a.weekday !== b.weekday) return { overlaps: false, unknown: false };

  const aStart = parseTimeToMinutes(a.defaultStartTime);
  const aEnd = parseTimeToMinutes(a.defaultEndTime);
  const bStart = parseTimeToMinutes(b.defaultStartTime);
  const bEnd = parseTimeToMinutes(b.defaultEndTime);
  if (aStart == null || aEnd == null || bStart == null || bEnd == null) {
    return { overlaps: false, unknown: true };
  }

  return { overlaps: aStart < bEnd && bStart < aEnd, unknown: false };
}

const WEEKDAY_LABELS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

function describeTrackTime(track: TraineeSuggestionInputTrack): string {
  const day = track.weekday != null && track.weekday >= 0 && track.weekday <= 6 ? `יום ${WEEKDAY_LABELS[track.weekday]}` : "יום לא ידוע";
  return `${day} ${track.defaultStartTime}-${track.defaultEndTime}`;
}

// ---------------------------------------------------------------------------
// Bucket-count computation
// ---------------------------------------------------------------------------

interface InternalBucketState {
  lungeAny: number;
  privateGroupLead: number;
  privateGroupAssistant: number;
  beginnerGroupSecond: number; // raw realized-row count - informational, not deduplicated per track
  evaluator: number; // raw realized-row count - informational, not deduplicated per track
  currentTrackIds: Set<string>;
}

function newBucketState(): InternalBucketState {
  return {
    lungeAny: 0,
    privateGroupLead: 0,
    privateGroupAssistant: 0,
    beginnerGroupSecond: 0,
    evaluator: 0,
    currentTrackIds: new Set(),
  };
}

function buildBucketStates(input: ComputeTraineeSuggestionsInput): Map<string, InternalBucketState> {
  const states = new Map<string, InternalBucketState>();
  const getState = (traineeId: string): InternalBucketState => {
    let state = states.get(traineeId);
    if (!state) {
      state = newBucketState();
      states.set(traineeId, state);
    }
    return state;
  };

  // Realized history, deduplicated per (traineeId, trackId) for the 3 real
  // buckets (one track membership = at most one contribution per bucket,
  // regardless of how many lessons that track has generated) - see file
  // header for why this counting unit is the correct one. Ad-hoc lessons
  // (trackId null) have nothing to deduplicate against, so each contributes
  // independently. Informational counts (beginnerGroupSecond/evaluator) are
  // intentionally raw row counts, not deduplicated - see their field doc.
  const realizedBucketsByTraineeTrack = new Map<string, Set<TraineeSuggestionBucket>>();

  for (const row of input.participantHistory) {
    const mapped = ROLE_TO_BUCKET[row.practiceType]?.[row.role];
    const state = getState(row.traineeId);
    if (mapped === "beginnerGroupSecond") {
      state.beginnerGroupSecond += 1;
      continue;
    }
    if (mapped === "evaluator") {
      state.evaluator += 1;
      continue;
    }
    if (!mapped) continue;

    const trackKey = row.trackId ?? `adhoc:${row.traineeId}:${realizedBucketsByTraineeTrack.size}`;
    const dedupeKey = `${row.traineeId}:${trackKey}`;
    let bucketsForThisMembership = realizedBucketsByTraineeTrack.get(dedupeKey);
    if (!bucketsForThisMembership) {
      bucketsForThisMembership = new Set();
      realizedBucketsByTraineeTrack.set(dedupeKey, bucketsForThisMembership);
    }
    if (!bucketsForThisMembership.has(mapped)) {
      bucketsForThisMembership.add(mapped);
      state[mapped] += 1;
    }
  }

  // Track which (traineeId, trackId) pairs already have realized history, so
  // current-membership projection is only applied where nothing real has
  // happened on that track for that trainee yet.
  const hasRealizedForTrack = new Set<string>();
  for (const row of input.participantHistory) {
    if (row.trackId) hasRealizedForTrack.add(`${row.traineeId}:${row.trackId}`);
  }

  const tracksById = new Map(input.tracks.map((t) => [t.id, t]));

  for (const membership of input.trackTrainees) {
    const state = getState(membership.traineeId);
    state.currentTrackIds.add(membership.trackId);

    if (hasRealizedForTrack.has(`${membership.traineeId}:${membership.trackId}`)) continue; // ground truth already counted above

    const track = tracksById.get(membership.trackId);
    if (!track) continue; // defensive - should not happen given how the action fetches data

    const projectedRole = projectRoleForRotationOrder(track.practiceType, membership.rotationOrder);
    const mapped = ROLE_TO_BUCKET[track.practiceType]?.[projectedRole];
    if (mapped === "beginnerGroupSecond") state.beginnerGroupSecond += 1;
    else if (mapped === "evaluator") state.evaluator += 1;
    else if (mapped) state[mapped] += 1;
  }

  return states;
}

function toBucketSummary(
  trainee: TraineeSuggestionInputTrainee,
  state: InternalBucketState | undefined
): TraineeBucketSummary {
  const s = state ?? newBucketState();
  const gap = (n: number) => Math.max(0, TRAINEE_SUGGESTION_TARGET_PER_BUCKET - n);
  return {
    traineeId: trainee.id,
    traineeName: trainee.fullName,
    counts: {
      lungeAny: s.lungeAny,
      privateGroupLead: s.privateGroupLead,
      privateGroupAssistant: s.privateGroupAssistant,
    },
    informational: {
      beginnerGroupSecond: s.beginnerGroupSecond,
      evaluator: s.evaluator,
    },
    targetGaps: {
      lungeAny: gap(s.lungeAny),
      privateGroupLead: gap(s.privateGroupLead),
      privateGroupAssistant: gap(s.privateGroupAssistant),
    },
    totalCurrentFixedStructureAssignments: s.currentTrackIds.size,
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function computeTeachingPracticeTraineeSuggestions(
  input: ComputeTraineeSuggestionsInput
): ComputeTraineeSuggestionsResult {
  const warnings: TraineeSuggestionWarning[] = [];

  // Defensive re-scoping - the caller is expected to already scope tracks to
  // this group, but the engine never trusts that blindly (manual testing
  // requirement: "running the action for group א returns only group א tracks").
  const tracks = input.tracks.filter((t) => t.groupName === input.groupName);

  const traineeById = new Map(input.trainees.map((t) => [t.id, t]));
  const missingTraineeName = "(חניך/ה לא נמצא/ה)";
  const traineeName = (id: string): string => traineeById.get(id)?.fullName ?? missingTraineeName;

  const eligibleTrainees = input.trainees.filter((t) => t.isActive && t.groupName === input.groupName);

  const bucketStates = buildBucketStates({ ...input, tracks });
  const traineeSummaries = input.trainees
    .filter((t) => t.isActive && t.groupName === input.groupName)
    .map((t) => toBucketSummary(t, bucketStates.get(t.id)))
    .sort((a, b) => a.traineeName.localeCompare(b.traineeName, "he"));
  const summaryByTraineeId = new Map(traineeSummaries.map((s) => [s.traineeId, s]));

  // ---- existing_group_mismatch: a trackTrainee row whose trainee does not
  // belong to this group, on a track that does belong to this group.
  const trackByIdForMismatch = new Map(tracks.map((t) => [t.id, t]));
  for (const membership of input.trackTrainees) {
    const track = trackByIdForMismatch.get(membership.trackId);
    if (!track) continue;
    const trainee = traineeById.get(membership.traineeId);
    const traineeGroup = trainee?.groupName ?? null;
    if (traineeGroup !== input.groupName) {
      warnings.push({
        kind: "existing_group_mismatch",
        message: `${traineeName(membership.traineeId)} (קבוצה ${traineeGroup ?? "לא ידועה"}) משובץ/ת בסלוט קבוע השייך לקבוצה ${input.groupName} - נתון קיים שלא שונה`,
        trackId: track.id,
        traineeId: membership.traineeId,
      });
    }
  }

  // ---- existing_overlap: two of this group's tracks share a real trainee
  // and their weekday/time windows already overlap - pre-existing data, not
  // something this run created.
  const membershipsByTrainee = new Map<string, TraineeSuggestionInputTrackTrainee[]>();
  for (const m of input.trackTrainees) {
    if (!trackByIdForMismatch.has(m.trackId)) continue;
    const list = membershipsByTrainee.get(m.traineeId) ?? [];
    list.push(m);
    membershipsByTrainee.set(m.traineeId, list);
  }
  const timeDataWarnedTrackIds = new Set<string>();
  for (const [traineeId, memberships] of membershipsByTrainee) {
    for (let i = 0; i < memberships.length; i++) {
      for (let j = i + 1; j < memberships.length; j++) {
        const trackA = trackByIdForMismatch.get(memberships[i].trackId)!;
        const trackB = trackByIdForMismatch.get(memberships[j].trackId)!;
        const check = tracksMayOverlap(trackA, trackB);
        if (check.unknown) {
          for (const t of [trackA, trackB]) {
            if (!timeDataWarnedTrackIds.has(t.id)) {
              timeDataWarnedTrackIds.add(t.id);
              warnings.push({
                kind: "missing_or_invalid_time_data",
                message: `לא ניתן לבדוק חפיפת זמנים עבור סלוט (${describeTrackTime(t)}) - נתוני יום/שעה חסרים או שגויים`,
                trackId: t.id,
              });
            }
          }
          continue;
        }
        if (check.overlaps) {
          warnings.push({
            kind: "existing_overlap",
            message: `${traineeName(traineeId)} משובץ/ת בשני סלוטים קבועים חופפים בזמן (${describeTrackTime(trackA)} / ${describeTrackTime(trackB)}) - נתון קיים שלא שונה`,
            traineeId,
          });
        }
      }
    }
  }

  // ---- Build per-track slot rows + suggestions.
  const trackGroups: TraineeSuggestionTrackGroup[] = [];
  // supply/demand tally per real bucket, group-wide.
  const supplyByBucket: Record<TraineeSuggestionBucket, number> = {
    lungeAny: 0,
    privateGroupLead: 0,
    privateGroupAssistant: 0,
  };

  for (const track of tracks) {
    const expectedSize = TEACHING_PRACTICE_TEAM_SIZE[track.practiceType];
    const membershipByRotationOrder = new Map<number, string>(); // rotationOrder -> traineeId
    for (const m of input.trackTrainees) {
      if (m.trackId === track.id) membershipByRotationOrder.set(m.rotationOrder, m.traineeId);
    }
    // Mutable across this track's slot loop: once a candidate is suggested for
    // one empty slot on this track, they must not also be suggested for
    // another empty slot on the *same* track in this same run (a חניך can't
    // fill two rotation-order positions on one track at once).
    const traineeIdsOnThisTrack = new Set(membershipByRotationOrder.values());

    const slots: TraineeSuggestionRotationSlot[] = [];

    for (let rotationOrder = 0; rotationOrder < expectedSize; rotationOrder++) {
      const projectedRole = projectRoleForRotationOrder(track.practiceType, rotationOrder);
      const { bucket: targetBucket, note: bucketNote } = targetBucketForSlot(track.practiceType, rotationOrder);
      const currentTraineeId = membershipByRotationOrder.get(rotationOrder) ?? null;

      if (currentTraineeId) {
        slots.push({
          trackId: track.id,
          practiceType: track.practiceType,
          weekday: track.weekday,
          defaultStartTime: track.defaultStartTime,
          defaultEndTime: track.defaultEndTime,
          rotationOrder,
          projectedRole,
          targetBucket,
          bucketNote,
          currentTraineeId,
          currentTraineeName: traineeName(currentTraineeId),
          suggestedTraineeId: null,
          suggestedTraineeName: null,
          reason: "הסלוט כבר משובץ - לא מוצעת החלפה אוטומטית",
          excludedCandidates: [],
        });
        continue;
      }

      if (targetBucket) supplyByBucket[targetBucket] += 1;

      // ---- Candidate filtering (hard constraints) ----
      const excludedCandidates: TraineeSuggestionExcludedCandidate[] = [];
      const candidates: TraineeSuggestionInputTrainee[] = [];

      for (const candidate of eligibleTrainees) {
        if (traineeIdsOnThisTrack.has(candidate.id)) {
          excludedCandidates.push({
            traineeId: candidate.id,
            traineeName: candidate.fullName,
            reason: "כבר משובץ/ת בסלוט אחר באותו מסלול",
          });
          continue;
        }

        const otherMemberships = (membershipsByTrainee.get(candidate.id) ?? []).filter(
          (m) => m.trackId !== track.id
        );
        let overlapFound = false;
        for (const m of otherMemberships) {
          const otherTrack = trackByIdForMismatch.get(m.trackId);
          if (!otherTrack) continue;
          const check = tracksMayOverlap(track, otherTrack);
          if (check.unknown) {
            if (!timeDataWarnedTrackIds.has(track.id)) {
              timeDataWarnedTrackIds.add(track.id);
              warnings.push({
                kind: "missing_or_invalid_time_data",
                message: `לא ניתן לבדוק חפיפת זמנים עבור סלוט (${describeTrackTime(track)}) - נתוני יום/שעה חסרים או שגויים`,
                trackId: track.id,
              });
            }
            continue;
          }
          if (check.overlaps) {
            excludedCandidates.push({
              traineeId: candidate.id,
              traineeName: candidate.fullName,
              reason: `חפיפת זמנים עם סלוט קבוע אחר (${describeTrackTime(otherTrack)})`,
            });
            overlapFound = true;
            break;
          }
        }
        if (overlapFound) continue;

        candidates.push(candidate);
      }

      // ---- Scoring ----
      const scored = candidates
        .map((c) => {
          const summary = summaryByTraineeId.get(c.id);
          const bucketDeficit = targetBucket
            ? Math.max(0, TRAINEE_SUGGESTION_TARGET_PER_BUCKET - (summary?.counts[targetBucket] ?? 0))
            : 0;
          const totalAssignments = summary?.totalCurrentFixedStructureAssignments ?? 0;
          const sameWeekdayCount = (membershipsByTrainee.get(c.id) ?? []).filter((m) => {
            const t = trackByIdForMismatch.get(m.trackId);
            return t && track.weekday != null && t.weekday === track.weekday;
          }).length;
          return { candidate: c, bucketDeficit, totalAssignments, sameWeekdayCount };
        })
        .sort((a, b) => {
          if (b.bucketDeficit !== a.bucketDeficit) return b.bucketDeficit - a.bucketDeficit;
          if (a.totalAssignments !== b.totalAssignments) return a.totalAssignments - b.totalAssignments;
          if (a.sameWeekdayCount !== b.sameWeekdayCount) return a.sameWeekdayCount - b.sameWeekdayCount;
          return a.candidate.fullName.localeCompare(b.candidate.fullName, "he");
        });

      const best = scored[0];
      let reason: string;
      let suggestedTraineeId: string | null = null;
      let suggestedTraineeName: string | null = null;

      if (!best) {
        reason = "אין מועמד/ת מתאים/ה בקבוצה זו (כל החניכים הפעילים בקבוצה נפסלו עקב חפיפת זמנים או כבר משובצים)";
        warnings.push({
          kind: "no_suitable_candidate",
          message: `אין הצעה מתאימה לסלוט ${describeTrackTime(track)} (${track.practiceType}, מס' ${rotationOrder + 1})`,
          trackId: track.id,
        });
      } else {
        suggestedTraineeId = best.candidate.id;
        suggestedTraineeName = best.candidate.fullName;
        traineeIdsOnThisTrack.add(best.candidate.id);
        const reasonParts: string[] = [];
        if (targetBucket) {
          reasonParts.push(
            best.bucketDeficit > 0
              ? `טרם השלים/ה יעד ${targetBucket} (0 מתוך ${TRAINEE_SUGGESTION_TARGET_PER_BUCKET})`
              : `כבר עמד/ה ביעד ${targetBucket} - נבחר/ה לפי איזון עומס כללי`
          );
        } else {
          reasonParts.push(bucketNote ?? "שיבוץ לפי איזון עומס כללי");
        }
        reasonParts.push(`סה"כ שיבוצים קבועים נוכחיים: ${best.totalAssignments}`);
        if (best.sameWeekdayCount === 0) reasonParts.push("ללא חפיפת יום בשבוע עם שיבוצים אחרים");
        reason = reasonParts.join("; ");
      }

      slots.push({
        trackId: track.id,
        practiceType: track.practiceType,
        weekday: track.weekday,
        defaultStartTime: track.defaultStartTime,
        defaultEndTime: track.defaultEndTime,
        rotationOrder,
        projectedRole,
        targetBucket,
        bucketNote,
        currentTraineeId: null,
        currentTraineeName: null,
        suggestedTraineeId,
        suggestedTraineeName,
        reason,
        excludedCandidates,
      });
    }

    trackGroups.push({
      trackId: track.id,
      practiceType: track.practiceType,
      weekday: track.weekday,
      defaultStartTime: track.defaultStartTime,
      defaultEndTime: track.defaultEndTime,
      slots,
    });
  }

  // ---- supply_below_demand, computed after all tracks are processed.
  const bucketLabels: Record<TraineeSuggestionBucket, string> = {
    lungeAny: "לונג׳",
    privateGroupLead: "מוביל/ה בפרטני/קבוצתי",
    privateGroupAssistant: "עוזר/ת בפרטני",
  };
  for (const bucket of ["lungeAny", "privateGroupLead", "privateGroupAssistant"] as const) {
    const demand = traineeSummaries.filter((s) => s.targetGaps[bucket] > 0).length;
    const supply = supplyByBucket[bucket];
    if (supply < demand) {
      warnings.push({
        kind: "supply_below_demand",
        message: `מספר המקומות הפנויים ב${bucketLabels[bucket]} (${supply}) נמוך ממספר החניכים הזקוקים לשיבוץ (${demand}) בקבוצה ${input.groupName}`,
      });
    }
  }

  return { groupName: input.groupName, tracks: trackGroups, traineeSummaries, warnings };
}
