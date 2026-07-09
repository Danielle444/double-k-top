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
// a source of *historical role facts* (via TraineeSuggestionInputParticipantHistory),
// used only as a soft scoring signal, never a hard blocker - this module
// never reasons about which lessons exist on which dates, and never
// suggests anything for a generated lesson directly.
//
// Bucket design (corrected, evidence-validated against real business
// capacity - see report):
//   lungeAny       - target 1 - fed by ANY LUNGE slot/role (both rotation
//                    positions count - a lunge track's 2 seats are both real,
//                    independently required assignment places).
//   privateGroupAny - target 1 - fed ONLY by BEGINNER_PRIVATE rotationOrder 0
//                    (the "lead"/"חניך מתרגל" slot). This is the sole
//                    business-required "private/group" assignment place.
//
// Why privateGroupAny is scoped this narrowly (not every BEGINNER_PRIVATE/
// BEGINNER_GROUP slot): empirically, a group's real business capacity for
// lunge (tracks x 2) closely matches its real trainee count (yielding
// exactly the expected small number of holes), but the *technical* slot
// count across BEGINNER_PRIVATE (tracks x 2) + BEGINNER_GROUP (tracks x 3)
// vastly overshoots real demand (e.g. 63 technical slots for ~21 trainees in
// one real group). The existing UI's own Beginners-block code
// (TeachingPracticeManager.tsx, buildBeginnerBlocks) confirms why: a
// BEGINNER_GROUP track's displayed roster is deliberately NOT assigned via
// its own team slots - it is derived read-only from each linked
// BEGINNER_PRIVATE track's own rotationOrder-0 trainee ("trainee assignment
// happens on the private rows"). So the one genuinely-independent,
// business-required "private/group place" is BEGINNER_PRIVATE rotationOrder
// 0 - confirmed by simulating this exact model against real group data and
// getting precisely the expected hole counts (1 total hole per group).
//
// BEGINNER_PRIVATE rotationOrder 1 (assistant) and every BEGINNER_GROUP
// rotationOrder are still shown and still receive a suggestion attempt
// (general-load-balance only, freely reusing already-satisfied trainees -
// nothing here is a hard target), but never create a required-hole warning
// and never affect the expected hole totals above.
//
// Counting unit: a single TRACK MEMBERSHIP, not a single generated lesson.
// A fixed-structure "assignment" is one track membership - if a track later
// generates many lesson dates, the same membership still counts once per
// bucket it has ever realized (deduplicated per track), never once per
// lesson. This is what makes "target 1" meaningful: a lunge track that has
// generated 10 lessons for the same pair should read as "1 lungeAny
// assignment fulfilled", not "10".
//
// Hard exclusions (the complete list - nothing else ever hard-blocks a
// candidate): inactive trainee; group mismatch; already on this same track
// in another slot; a genuine (fully-known) overlapping fixed-structure time
// conflict; and, ONLY for a slot whose targetBucket is non-null (a LUNGE
// slot, or a BEGINNER_PRIVATE rotationOrder-0 slot), already having reached
// that specific bucket's target - this last rule is what turns a real
// numeric surplus (e.g. 22 lunge seats for 21 trainees) into exactly the
// expected number of holes instead of either flooding with holes (if this
// exclusion were missing entirely) or silently over-assigning everyone via
// unlimited reuse (if it were softened to a mere tiebreak - verified
// empirically: a soft/tiebreak-only version of this rule produces 0 holes,
// not the expected 1, because the surplus seat gets filled via reuse instead
// of staying empty). Generated-lesson history is NEVER a hard blocker - it
// only feeds the same buckets as current track membership, both real facts
// about a real bucket, both subject to the exact same rule above.

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
// Total target across both buckets (1 lungeAny + 1 privateGroupAny) - used
// only for documentation/summary purposes, not read anywhere in this file's
// own logic (each bucket is checked independently, never as a combined sum).
export const TRAINEE_SUGGESTION_TOTAL_TARGET = 2;

export type TraineeSuggestionBucket = "lungeAny" | "privateGroupAny";

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
  // not enforced" field as TeachingPracticeTrack.weekday. Business rule: the
  // fixed structure's assignment/overlap logic does not depend on weekday at
  // all - it is never read by tracksMayOverlap or hasUsableTimeData below,
  // only used (when present) as optional display context in
  // describeTrackTime. A null value here never produces a warning and never
  // reduces trust in a suggestion.
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
// track from before a group change). Used only as a soft scoring input
// (feeds the same buckets/informational counters as current membership) -
// never a hard blocker on its own.
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

// Typed exclusion reason category, alongside the human-readable `reason`
// string - lets the engine (and, if useful later, a UI) summarize *why* a
// hole happened without fragile string matching against `reason` text.
export type TraineeSuggestionExclusionCategory = "already_on_track" | "bucket_satisfied" | "overlap";

export interface TraineeSuggestionExcludedCandidate {
  traineeId: string;
  traineeName: string;
  reason: string;
  category: TraineeSuggestionExclusionCategory;
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
  // Which real target bucket this slot counts toward - null for
  // BEGINNER_PRIVATE rotationOrder 1 and every BEGINNER_GROUP rotationOrder,
  // which are informational/general-load-balance-only (see bucketNote).
  targetBucket: TraineeSuggestionBucket | null;
  // Set only when targetBucket is null, explaining why, so a future UI can
  // show this to the מנהלת instead of silently treating the slot as unscored.
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
    privateGroupAny: number;
  };
  // Realized-history counts for roles/slots that never count toward a real
  // bucket target - always reported so a UI can still show them to the
  // מנהלת, never used for scoring/exclusion.
  informational: {
    // BEGINNER_PRIVATE ASSISTANT_INSTRUCTOR (rotationOrder 1) history.
    privateAssistant: number;
    // BEGINNER_GROUP LEAD_INSTRUCTOR history - no longer counts toward
    // privateGroupAny (corrected model), so it moved from a real bucket to
    // purely informational.
    beginnerGroupLead: number;
    beginnerGroupSecond: number;
    evaluator: number;
  };
  targetGaps: {
    lungeAny: number;
    privateGroupAny: number;
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
// Role -> bucket/informational mapping (corrected design)
// ---------------------------------------------------------------------------

type BucketOrInformational = TraineeSuggestionBucket | "privateAssistant" | "beginnerGroupLead" | "beginnerGroupSecond" | "evaluator";

const ROLE_TO_BUCKET: Record<
  TeachingPracticeTypeValue,
  Partial<Record<TeachingPracticeRoleValue, BucketOrInformational>>
> = {
  LUNGE: {
    LEAD_INSTRUCTOR: "lungeAny",
    ASSISTANT_INSTRUCTOR: "lungeAny",
  },
  BEGINNER_PRIVATE: {
    LEAD_INSTRUCTOR: "privateGroupAny",
    ASSISTANT_INSTRUCTOR: "privateAssistant",
  },
  BEGINNER_GROUP: {
    LEAD_INSTRUCTOR: "beginnerGroupLead",
    SECOND_INSTRUCTOR: "beginnerGroupSecond",
    EVALUATOR: "evaluator",
  },
};

const INFORMATIONAL_KEYS = ["privateAssistant", "beginnerGroupLead", "beginnerGroupSecond", "evaluator"] as const;
type InformationalKey = (typeof INFORMATIONAL_KEYS)[number];

function isInformationalKey(value: BucketOrInformational): value is InformationalKey {
  return (INFORMATIONAL_KEYS as readonly string[]).includes(value);
}

const PRIVATE_ASSISTANT_NOTE =
  "תפקיד עוזר/ת בשיעור פרטני - אינו נספר ליעד privateGroupAny (הנספר רק דרך תפקיד המוביל/ה, רוטציה 0) - שיבוץ לפי איזון עומס כללי בלבד";
const BEGINNER_GROUP_NOTE =
  "שיעור קבוצתי מתחילים - כל תפקידיו הם משניים ואינם נספרים ליעד privateGroupAny (הנספר רק דרך תפקיד המוביל/ה בשיעור פרטני) - שיבוץ לפי איזון עומס כללי בלבד";

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

// Corrected business-capacity model (see file header): LUNGE - every
// rotation position is a real required place. BEGINNER_PRIVATE - only
// rotationOrder 0 (lead) is a real required place; rotationOrder 1
// (assistant) is informational/general-load-only. BEGINNER_GROUP - no
// rotation position counts toward a real target at all.
function targetBucketForSlot(
  practiceType: TeachingPracticeTypeValue,
  rotationOrder: number
): { bucket: TraineeSuggestionBucket | null; note: string | null } {
  if (practiceType === "LUNGE") return { bucket: "lungeAny", note: null };
  if (practiceType === "BEGINNER_PRIVATE") {
    return rotationOrder === 0
      ? { bucket: "privateGroupAny", note: null }
      : { bucket: null, note: PRIVATE_ASSISTANT_NOTE };
  }
  // BEGINNER_GROUP - never a required place under the corrected model.
  return { bucket: null, note: BEGINNER_GROUP_NOTE };
}

// ---------------------------------------------------------------------------
// Overlap detection - fixed-structure best-effort check, time window only
// (weekday is never part of this - see tracksMayOverlap below). Real
// generated-lesson-date overlap is out of scope for Stage 0.
// ---------------------------------------------------------------------------

interface OverlapCheck {
  overlaps: boolean;
  // true when overlap could not be determined (missing/invalid start/end
  // time) - callers must not exclude a candidate on an "unknown" result,
  // only warn, and only ever with one quiet, aggregated warning (see
  // hasUsableTimeData).
  unknown: boolean;
}

// Time-window-only comparison - weekday is deliberately NOT read here at
// all. Business rule: the fixed structure's assignment logic does not
// depend on weekday (it's a free-standing display hint on
// TeachingPracticeTrack, never enforced elsewhere in the app - see its own
// schema comment), so two tracks are treated as a potential conflict purely
// by whether their time-of-day windows overlap, regardless of which weekday
// (if any) either one has recorded. This is a deliberate, accepted
// trade-off: two tracks at the same clock time on genuinely different
// weekdays will still be flagged as an overlap - the business has chosen
// this as the safer default given the fixed structure has no real calendar
// dates to disambiguate by.
function tracksMayOverlap(a: TraineeSuggestionInputTrack, b: TraineeSuggestionInputTrack): OverlapCheck {
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

// Weekday is shown here purely as optional display context (when present) -
// it plays no role in tracksMayOverlap/hasUsableTimeData below, and its
// absence is never mentioned or treated as missing data.
function describeTrackTime(track: TraineeSuggestionInputTrack): string {
  const day = track.weekday != null && track.weekday >= 0 && track.weekday <= 6 ? `יום ${WEEKDAY_LABELS[track.weekday]} ` : "";
  return `${day}${track.defaultStartTime}-${track.defaultEndTime}`;
}

// A track's own time window is usable for overlap-checking only when both
// start/end parse cleanly - weekday plays no part in this check at all (see
// tracksMayOverlap) and its presence/absence is never considered here.
function hasUsableTimeData(track: TraineeSuggestionInputTrack): boolean {
  return parseTimeToMinutes(track.defaultStartTime) != null && parseTimeToMinutes(track.defaultEndTime) != null;
}

// ---------------------------------------------------------------------------
// Bucket-count computation
// ---------------------------------------------------------------------------

interface InternalBucketState {
  lungeAny: number;
  privateGroupAny: number;
  privateAssistant: number; // informational, raw realized-row count
  beginnerGroupLead: number; // informational, raw realized-row count
  beginnerGroupSecond: number; // informational, raw realized-row count
  evaluator: number; // informational, raw realized-row count
  currentTrackIds: Set<string>;
}

function newBucketState(): InternalBucketState {
  return {
    lungeAny: 0,
    privateGroupAny: 0,
    privateAssistant: 0,
    beginnerGroupLead: 0,
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

  // Realized history, deduplicated per (traineeId, trackId) for the 2 real
  // buckets (one track membership = at most one contribution per bucket,
  // regardless of how many lessons that track has generated) - see file
  // header for why this counting unit is the correct one. Ad-hoc lessons
  // (trackId null) have nothing to deduplicate against, so each contributes
  // independently. Informational counts are intentionally raw row counts,
  // never deduplicated - see their field doc.
  const realizedBucketsByTraineeTrack = new Map<string, Set<TraineeSuggestionBucket>>();

  for (const row of input.participantHistory) {
    const mapped = ROLE_TO_BUCKET[row.practiceType]?.[row.role];
    if (!mapped) continue;
    const state = getState(row.traineeId);
    if (isInformationalKey(mapped)) {
      state[mapped] += 1;
      continue;
    }

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
    if (mapped) state[mapped] += 1;
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
      privateGroupAny: s.privateGroupAny,
    },
    informational: {
      privateAssistant: s.privateAssistant,
      beginnerGroupLead: s.beginnerGroupLead,
      beginnerGroupSecond: s.beginnerGroupSecond,
      evaluator: s.evaluator,
    },
    targetGaps: {
      lungeAny: gap(s.lungeAny),
      privateGroupAny: gap(s.privateGroupAny),
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

  // ---- missing_or_invalid_time_data - computed ONCE, upfront, directly from
  // each track's own start/end time fields only (weekday plays no part in
  // this at all - missing weekday alone is never warned about, never
  // reduces trust, and never appears here). Always exactly one quiet summary
  // line, however many tracks are affected. The underlying per-pair overlap
  // checks below still treat these tracks safely (never excluding a
  // candidate on an "unknown" result) - they just don't also emit their own
  // warning each time.
  const tracksWithIncompleteTimeData = tracks.filter((t) => !hasUsableTimeData(t));
  if (tracksWithIncompleteTimeData.length > 0) {
    warnings.push({
      kind: "missing_or_invalid_time_data",
      message: `בדיקת חפיפות חלקית: ל-${tracksWithIncompleteTimeData.length} מסלולים קבועים אין שעת התחלה/סיום תקינה, ולכן לא ניתן לבדוק עבורם חפיפות זמנים. שאר ההצעות אינן מושפעות.`,
    });
  }

  const bucketStates = buildBucketStates({ ...input, tracks });
  const traineeSummaries = input.trainees
    .filter((t) => t.isActive && t.groupName === input.groupName)
    .map((t) => toBucketSummary(t, bucketStates.get(t.id)))
    .sort((a, b) => a.traineeName.localeCompare(b.traineeName, "he"));

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
  // and their time windows already overlap - pre-existing data, not
  // something this run created.
  const membershipsByTrainee = new Map<string, TraineeSuggestionInputTrackTrainee[]>();
  for (const m of input.trackTrainees) {
    if (!trackByIdForMismatch.has(m.trackId)) continue;
    const list = membershipsByTrainee.get(m.traineeId) ?? [];
    list.push(m);
    membershipsByTrainee.set(m.traineeId, list);
  }
  for (const [traineeId, memberships] of membershipsByTrainee) {
    for (let i = 0; i < memberships.length; i++) {
      for (let j = i + 1; j < memberships.length; j++) {
        const trackA = trackByIdForMismatch.get(memberships[i].trackId)!;
        const trackB = trackByIdForMismatch.get(memberships[j].trackId)!;
        const check = tracksMayOverlap(trackA, trackB);
        if (check.unknown) {
          // Already covered by the single upfront tracksWithIncompleteTimeData
          // summary warning above - never re-reported per pair here.
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

  // ---- Provisional state - reacts to suggestions already made earlier in
  // THIS SAME run, not just the real starting state - otherwise a
  // candidate's apparent bucket status/total load/occupied windows never
  // change as the loop progresses, so whoever looks best for the very first
  // empty slot keeps looking best for every later one too. provisionalBuckets
  // starts as a mutable per-trainee copy of the real current state
  // (bucketStates) and provisionalWindows starts as a mutable copy of real
  // current memberships; both are updated in place immediately after each
  // accepted suggestion, before the next slot is scored.
  interface ProvisionalTraineeState {
    lungeAny: number;
    privateGroupAny: number;
    totalAssignments: number;
  }
  const provisionalBuckets = new Map<string, ProvisionalTraineeState>();
  for (const t of eligibleTrainees) {
    const s = bucketStates.get(t.id);
    provisionalBuckets.set(t.id, {
      lungeAny: s?.lungeAny ?? 0,
      privateGroupAny: s?.privateGroupAny ?? 0,
      totalAssignments: s?.currentTrackIds.size ?? 0,
    });
  }

  // Occupied time-windows per trainee, seeded from real current memberships
  // and appended to (never removed from) as this run suggests new slots - so
  // a later slot's overlap check also excludes a trainee who was JUST
  // suggested into an overlapping slot earlier in this same run, not only
  // their pre-existing real assignments.
  const provisionalWindows = new Map<string, TraineeSuggestionInputTrack[]>();
  for (const [traineeId, memberships] of membershipsByTrainee) {
    provisionalWindows.set(
      traineeId,
      memberships.map((m) => trackByIdForMismatch.get(m.trackId)).filter((t): t is TraineeSuggestionInputTrack => !!t)
    );
  }

  // ---- Build per-track slot rows + suggestions.
  //
  // Two-pass processing (the fix for a real bug found while validating the
  // corrected model against real data): a targetBucket===null slot
  // (BEGINNER_PRIVATE rotationOrder 1, any BEGINNER_GROUP rotationOrder)
  // must NEVER be filled before every real-target slot (LUNGE, BEGINNER_
  // PRIVATE rotationOrder 0) across the WHOLE group has already had its
  // chance - otherwise, filling an informational slot early can occupy a
  // candidate's time-window and then, via the overlap hard-exclusion, block
  // that same candidate from later winning their genuinely-required
  // lungeAny/privateGroupAny slot elsewhere, turning a real seat into an
  // artificial hole purely because of processing order. Verified against
  // real group data: without this two-pass split, group א showed 3 required
  // holes instead of the expected 1 - re-ordering into "all real targets
  // first, informational slots second" was required to reach the correct
  // count. Filled (already-assigned) slots are recorded during pass 1
  // regardless of bucket, since they don't consume a new candidate at all.
  const trackGroups: TraineeSuggestionTrackGroup[] = [];
  // supply/demand tally per real bucket, group-wide.
  const supplyByBucket: Record<TraineeSuggestionBucket, number> = {
    lungeAny: 0,
    privateGroupAny: 0,
  };

  interface TrackMeta {
    track: TraineeSuggestionInputTrack;
    expectedSize: number;
    membershipByRotationOrder: Map<number, string>;
    traineeIdsOnThisTrack: Set<string>;
    slotsByRotationOrder: Map<number, TraineeSuggestionRotationSlot>;
  }
  const trackMetas: TrackMeta[] = tracks.map((track) => {
    const membershipByRotationOrder = new Map<number, string>();
    for (const m of input.trackTrainees) {
      if (m.trackId === track.id) membershipByRotationOrder.set(m.rotationOrder, m.traineeId);
    }
    return {
      track,
      expectedSize: TEACHING_PRACTICE_TEAM_SIZE[track.practiceType],
      membershipByRotationOrder,
      // Mutable across both passes for this track: once a candidate is
      // suggested for one empty slot on this track (in either pass), they
      // must not also be suggested for another empty slot on the *same*
      // track (a חניך can't fill two rotation-order positions on one track
      // at once).
      traineeIdsOnThisTrack: new Set(membershipByRotationOrder.values()),
      slotsByRotationOrder: new Map(),
    };
  });

  // processSlot handles one (track, rotationOrder) - shared by both passes
  // below so the candidate-filtering/scoring/reason logic is never
  // duplicated between them.
  function processSlot(meta: TrackMeta, rotationOrder: number): void {
    const { track, traineeIdsOnThisTrack } = meta;
    const projectedRole = projectRoleForRotationOrder(track.practiceType, rotationOrder);
    const { bucket: targetBucket, note: bucketNote } = targetBucketForSlot(track.practiceType, rotationOrder);
    const currentTraineeId = meta.membershipByRotationOrder.get(rotationOrder) ?? null;

    if (currentTraineeId) {
      meta.slotsByRotationOrder.set(rotationOrder, {
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
      return;
    }

    if (targetBucket) supplyByBucket[targetBucket] += 1;

    // ---- Candidate filtering (hard constraints - the complete list) ----
    const excludedCandidates: TraineeSuggestionExcludedCandidate[] = [];
    const candidates: TraineeSuggestionInputTrainee[] = [];

    for (const candidate of eligibleTrainees) {
      if (traineeIdsOnThisTrack.has(candidate.id)) {
        excludedCandidates.push({
          traineeId: candidate.id,
          traineeName: candidate.fullName,
          reason: "כבר משובץ/ת בסלוט אחר באותו מסלול",
          category: "already_on_track",
        });
        continue;
      }

      // Only applies to a slot with a real targetBucket (LUNGE, or
      // BEGINNER_PRIVATE rotationOrder 0) - a BEGINNER_PRIVATE
      // rotationOrder-1 or BEGINNER_GROUP slot has targetBucket===null and
      // never hard-excludes on this rule, matching "may still get
      // general-load-balance suggestions" for those slots.
      if (targetBucket) {
        const provisionalState = provisionalBuckets.get(candidate.id);
        if (provisionalState && provisionalState[targetBucket] >= TRAINEE_SUGGESTION_TARGET_PER_BUCKET) {
          excludedCandidates.push({
            traineeId: candidate.id,
            traineeName: candidate.fullName,
            reason: `כבר עמד/ה ביעד ${targetBucket} - לא יוצע/תוצע שוב לסלוט מסוג זה`,
            category: "bucket_satisfied",
          });
          continue;
        }
      }

      // Checked against provisionalWindows (real memberships + anything
      // already suggested earlier in this run), not just real memberships -
      // this is what stops the same candidate from being suggested into two
      // overlapping slots within one preview/apply batch. An "unknown"
      // result (missing/invalid time data on either side) is never treated
      // as a conflict here - it's already covered once, upfront, by the
      // single tracksWithIncompleteTimeData summary warning, not re-reported
      // per candidate/slot.
      const otherWindows = (provisionalWindows.get(candidate.id) ?? []).filter((t) => t.id !== track.id);
      let overlapFound = false;
      for (const otherTrack of otherWindows) {
        const check = tracksMayOverlap(track, otherTrack);
        if (check.unknown) continue;
        if (check.overlaps) {
          excludedCandidates.push({
            traineeId: candidate.id,
            traineeName: candidate.fullName,
            reason: `חפיפת זמנים עם סלוט קבוע/הצעה קודמת (${describeTrackTime(otherTrack)})`,
            category: "overlap",
          });
          overlapFound = true;
          break;
        }
      }
      if (overlapFound) continue;

      candidates.push(candidate);
    }

    // ---- Scoring - against PROVISIONAL state, not the static starting
    // summary, so a candidate's deficit/load/same-weekday-count already
    // reflects every suggestion accepted earlier in this run (including
    // every real-target slot from pass 1, by the time pass 2 runs). For a
    // slot with targetBucket===null, bucketDeficit is always 0 for everyone -
    // scoring falls straight through to general load-balance (total
    // assignments, then same-weekday clustering, then name), exactly the
    // "general-load-balance suggestions" behavior required for
    // BEGINNER_PRIVATE rotationOrder 1 / BEGINNER_GROUP slots.
    const scored = candidates
      .map((c) => {
        const state = provisionalBuckets.get(c.id);
        const bucketDeficit = targetBucket
          ? Math.max(0, TRAINEE_SUGGESTION_TARGET_PER_BUCKET - (state?.[targetBucket] ?? 0))
          : 0;
        const totalAssignments = state?.totalAssignments ?? 0;
        const sameWeekdayCount = (provisionalWindows.get(c.id) ?? []).filter(
          (t) => track.weekday != null && t.weekday === track.weekday
        ).length;
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
      // Summarize WHY, from the actual exclusion categories tallied above.
      // For a bucket-counted slot, "bucket_satisfied" holes are the
      // expected, correct outcome once real business capacity for that
      // bucket is exhausted (e.g. the one surplus lunge seat) - not a
      // data problem. For a targetBucket===null slot, a hole here only
      // ever comes from overlap/already-on-track, never bucket_satisfied
      // (that exclusion never applies to these slots).
      if (eligibleTrainees.length === 0) {
        reason = "אין חניכים פעילים בקבוצה זו";
      } else {
        const categoriesPresent = new Set(excludedCandidates.map((e) => e.category));
        const onlyBucketSatisfied = categoriesPresent.size === 1 && categoriesPresent.has("bucket_satisfied");
        const onlyOverlap = categoriesPresent.size === 1 && categoriesPresent.has("overlap");
        if (onlyBucketSatisfied && targetBucket) {
          reason = `אין הצעה מתאימה - כל החניכים הפעילים בקבוצה כבר עמדו ביעד ${targetBucket} (עודף מקומות אמיתי מעבר להיקף החניכים הפעילים)`;
        } else if (onlyOverlap) {
          reason = "אין הצעה מתאימה - כל החניכים הזמינים חופפים בזמן לסלוט זה";
        } else {
          reason =
            "אין הצעה מתאימה - כל החניכים הפעילים בקבוצה נפסלו (שילוב של: עמידה ביעד, חפיפת זמנים, ו/או שיבוץ קיים באותו מסלול - ראו פירוט למטה)";
        }
      }
      // Only a required (bucket-counted) slot's absence of a suggestion is
      // warning-worthy - an informational/general-load-only slot (targetBucket
      // null) having no suggestion is expected/acceptable (see file header)
      // and must not create a required-hole-style warning; its own `reason`
      // text on the slot itself already explains why, without adding noise to
      // the warnings list.
      if (targetBucket) {
        warnings.push({
          kind: "no_suitable_candidate",
          message: `אין הצעה מתאימה לסלוט ${describeTrackTime(track)} (${track.practiceType}, מס' ${rotationOrder + 1})`,
          trackId: track.id,
        });
      }
    } else {
      suggestedTraineeId = best.candidate.id;
      suggestedTraineeName = best.candidate.fullName;
      traineeIdsOnThisTrack.add(best.candidate.id);

      // Fold this suggestion into the provisional state immediately,
      // before the next slot is scored - without this, the same
      // under-target candidate(s) would keep winning every subsequent
      // slot in the run.
      const provisionalState = provisionalBuckets.get(best.candidate.id);
      if (provisionalState) {
        if (targetBucket) provisionalState[targetBucket] += 1;
        provisionalState.totalAssignments += 1;
      }
      const windows = provisionalWindows.get(best.candidate.id) ?? [];
      windows.push(track);
      provisionalWindows.set(best.candidate.id, windows);

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

    meta.slotsByRotationOrder.set(rotationOrder, {
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

  // Pass 1: every real-target slot (targetBucket !== null), plus every
  // already-filled slot regardless of bucket (recording an existing
  // occupant never depends on pass ordering).
  for (const meta of trackMetas) {
    for (let rotationOrder = 0; rotationOrder < meta.expectedSize; rotationOrder++) {
      const alreadyFilled = meta.membershipByRotationOrder.has(rotationOrder);
      const { bucket: targetBucket } = targetBucketForSlot(meta.track.practiceType, rotationOrder);
      if (alreadyFilled || targetBucket) processSlot(meta, rotationOrder);
    }
  }
  // Pass 2: every remaining informational/general-load-only empty slot
  // (targetBucket === null), now that all real targets have already had
  // first claim on candidates and provisional state/windows.
  for (const meta of trackMetas) {
    for (let rotationOrder = 0; rotationOrder < meta.expectedSize; rotationOrder++) {
      if (!meta.slotsByRotationOrder.has(rotationOrder)) processSlot(meta, rotationOrder);
    }
  }

  for (const meta of trackMetas) {
    const slots = Array.from({ length: meta.expectedSize }, (_, i) => meta.slotsByRotationOrder.get(i)!);
    trackGroups.push({
      trackId: meta.track.id,
      practiceType: meta.track.practiceType,
      weekday: meta.track.weekday,
      defaultStartTime: meta.track.defaultStartTime,
      defaultEndTime: meta.track.defaultEndTime,
      slots,
    });
  }

  // ---- supply_below_demand, computed after all tracks are processed. Only
  // meaningful for the 2 real buckets - a targetBucket===null slot never
  // contributes to supplyByBucket and never factors into this warning.
  const bucketLabels: Record<TraineeSuggestionBucket, string> = {
    lungeAny: "לונג׳",
    privateGroupAny: "פרטני/קבוצתי",
  };
  for (const bucket of ["lungeAny", "privateGroupAny"] as const) {
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
