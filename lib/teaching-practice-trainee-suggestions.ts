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
// Bucket/category design (Stage A revision - second-round ranking, see
// report):
//   lungeAny         - required capacity, target 1 - fed by ANY LUNGE
//                       slot/role (both rotation positions count - a lunge
//                       track's 2 seats are both real, independently
//                       required assignment places).
//   privateLead       - required capacity, target 1 - fed ONLY by
//                       BEGINNER_PRIVATE rotationOrder 0 (the "lead"/"חניך
//                       מתרגל" slot). This is the sole business-required
//                       "private" assignment place. (Renamed from
//                       privateGroupAny now that assistant is a distinct
//                       tracked category too - see privateAssistant below.)
//   privateAssistant  - RANKED but NOT required capacity, no target - fed by
//                       BEGINNER_PRIVATE rotationOrder 1. Previously
//                       informational-only (never read by scoring); Stage A
//                       promotes it to a real ranked category (see
//                       categoryCount below) because leaving it unranked
//                       produced a real bad pattern: the same trainee kept
//                       winning every assistant slot on spacing/load alone
//                       while another trainee was never suggested as
//                       assistant at all. It still never creates a
//                       "required hole" warning (see requiredBucket below) -
//                       only lungeAny/privateLead do that.
//   (BEGINNER_GROUP rotations) - informational/derived only, never ranked,
//                       never required. That track's own roster is derived
//                       read-only from its linked BEGINNER_PRIVATE tracks'
//                       own rotationOrder-0 trainees (see
//                       TeachingPracticeManager.tsx's buildBeginnerBlocks and
//                       isTraineeSuggestionSlotSelectable) - a suggestion is
//                       still computed and shown for visibility/load
//                       context, but is never selectable/applyable and never
//                       affects any category count.
//
// Two related but distinct concepts, both computed per slot by
// categorizeSlot below:
//   - rankingCategory ("lungeAny" | "privateLead" | "privateAssistant" |
//     null) - which count the NEW categoryCount scoring tier reads/updates
//     for this slot. Drives ranking, never drives a warning by itself.
//   - requiredBucket (a narrower "lungeAny" | "privateLead" | null) - which
//     of the two categories represents real, business-required capacity.
//     Drives supplyByBucket tallying and the no_suitable_candidate /
//     supply_below_demand warnings. privateAssistant and BEGINNER_GROUP
//     always have requiredBucket === null, by design (see privateAssistant
//     above) - an unfilled assistant slot is never reported as a "hole."
//
// Counting unit: a single TRACK MEMBERSHIP, not a single generated lesson.
// A fixed-structure "assignment" is one track membership - if a track later
// generates many lesson dates, the same membership still counts once per
// category it has ever realized (deduplicated per track), never once per
// lesson. This now applies to all three ranked categories, including
// privateAssistant (a Stage A correctness fix - previously privateAssistant
// was counted as a raw, undeduplicated participant-row tally, which would
// have massively overcounted a trainee's assistant load once that count
// started driving real ranking: BEGINNER_PRIVATE roles never rotate across
// a track's generated lessons - see lib/teaching-practice-rotation.ts - so
// one assistant track with 10 generated lessons produced 10 raw participant
// rows for the same single membership).
//
// Second-round ranking (Stage A - replaces the old hard "bucket_satisfied"
// exclusion): once every eligible trainee already holds one assignment in a
// category, the category no longer excludes anyone - it becomes purely a
// soft ranking signal (categoryCount ascending, see processSlot below),
// letting a well-spaced second assignment happen instead of leaving the slot
// as a permanent hole. This is a deliberate reversal of the previous design
// (which intentionally left a hard "surplus seat" hole once every real
// bucket target was met, to make real capacity-vs-demand mismatches
// visible) - the product goal has changed from "show me the exact surplus"
// to "fill it well when everyone's already had a fair first turn."
//
// Hard exclusions (the complete list - nothing else ever hard-blocks a
// candidate): inactive trainee; group mismatch; already on this same track
// in another slot; a genuine (fully-known) overlapping fixed-structure time
// conflict. That's it - category/bucket satisfaction is no longer a hard
// exclusion for anything, real or informational.

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
// Total target across both REQUIRED buckets (1 lungeAny + 1 privateLead) -
// used only for documentation/summary purposes, not read anywhere in this
// file's own logic (each bucket is checked independently, never as a
// combined sum). privateAssistant is intentionally excluded - it's ranked
// (see TraineeSuggestionRankingCategory below) but not required capacity, so
// it has no target of its own.
export const TRAINEE_SUGGESTION_TOTAL_TARGET = 2;

// Required-capacity buckets only - these two drive supplyByBucket tallying
// and the no_suitable_candidate/supply_below_demand warnings. See
// TraineeSuggestionRankingCategory below for the broader set of categories
// that affect ranking but never warn.
export type TraineeSuggestionBucket = "lungeAny" | "privateLead";

// Every category the new categoryCount scoring tier (Stage A) reads/updates
// - a strict superset of TraineeSuggestionBucket, adding privateAssistant
// (ranked, but never required - see file header). BEGINNER_GROUP rotations
// have no ranking category at all (null) - they're informational/derived
// only.
export type TraineeSuggestionRankingCategory = TraineeSuggestionBucket | "privateAssistant";

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
  // Set only on a BEGINNER_PRIVATE track - the id of the BEGINNER_GROUP
  // track it feeds. Mirrors TeachingPracticeTrack.groupTrackId in the
  // schema. Not read by shouldIgnoreFixedStructureTimeConflict below (that
  // check is deliberately linkage-independent - see its own comment for
  // why), but kept on this input shape for schema-mirroring completeness
  // and any future feature that does need real linkage (e.g. a "linked
  // track" display badge).
  groupTrackId: string | null;
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
//
// Stage A - "bucket_satisfied" is removed: category/bucket satisfaction is
// no longer a hard exclusion for anyone (see file header) - it's now a soft
// ranking tier (categoryCount) instead, so it never appears in
// excludedCandidates at all anymore.
export type TraineeSuggestionExclusionCategory = "already_on_track" | "overlap";

export interface TraineeSuggestionExcludedCandidate {
  traineeId: string;
  traineeName: string;
  reason: string;
  category: TraineeSuggestionExclusionCategory;
}

// Stage C1 - one row per surviving (non-hard-excluded) candidate for a slot,
// in the exact order the existing scoring tiers already rank them (see the
// `scored` array in processSlot below) - this is not a new computation, it's
// exposing data the engine already builds internally and previously
// discarded (only scored[0] used to survive into the output). Scoring
// itself is unchanged; this is purely a "stop throwing away scored[1..]"
// change so a UI can show the manager every real option, not just the
// engine's own top pick.
export interface TraineeSuggestionRankedCandidate {
  traineeId: string;
  traineeName: string;
  categoryCount: number;
  // Infinity (from nearestGapMinutes - "no other assignments to compare
  // against") is converted to null here, not left as Infinity, since this
  // shape crosses the Server Action boundary as JSON - callers must treat
  // null the same way the pure engine's own Infinity is treated internally
  // ("best possible spacing"), never as "unknown".
  gapMinutes: number | null;
  totalAssignments: number;
  // True only for rankedCandidates[0] - always matches whether this
  // candidate is also the slot's own suggestedTraineeId.
  isRecommended: boolean;
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
  // Which REQUIRED-capacity bucket this slot counts toward - null for
  // BEGINNER_PRIVATE rotationOrder 1 (privateAssistant - ranked, but not
  // required, see rankingCategory below) and every BEGINNER_GROUP
  // rotationOrder (fully informational). Drives supplyByBucket tallying and
  // the no_suitable_candidate/supply_below_demand warnings only.
  targetBucket: TraineeSuggestionBucket | null;
  // Stage A - which category the new categoryCount scoring tier used for
  // this slot - null only for BEGINNER_GROUP rotations. Equal to
  // targetBucket whenever targetBucket is non-null; additionally
  // "privateAssistant" for BEGINNER_PRIVATE rotationOrder 1, where
  // targetBucket is null but ranking still happens.
  rankingCategory: TraineeSuggestionRankingCategory | null;
  // Set only when targetBucket is null (BEGINNER_PRIVATE rotationOrder 1, or
  // any BEGINNER_GROUP rotation), explaining why this slot has no required-
  // capacity target, so a future UI can show this to the מנהלת instead of
  // silently treating the slot as unscored. Still set for a
  // rotationOrder-1/privateAssistant slot even though that slot IS ranked -
  // the note explains it's ranked separately from the lead target, not that
  // it's unranked.
  bucketNote: string | null;
  currentTraineeId: string | null;
  currentTraineeName: string | null;
  suggestedTraineeId: string | null;
  suggestedTraineeName: string | null;
  reason: string;
  excludedCandidates: TraineeSuggestionExcludedCandidate[];
  // Stage C1 - every surviving candidate (see TraineeSuggestionRankedCandidate
  // above), always empty for an already-filled slot (candidates are never
  // computed for one - see the early return in processSlot). rankedCandidates[0],
  // when present, always equals suggestedTraineeId/suggestedTraineeName - both
  // are kept for backward compatibility, not recomputed independently.
  rankedCandidates: TraineeSuggestionRankedCandidate[];
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
  // Required-capacity categories only (lungeAny, privateLead - renamed from
  // privateGroupAny now that privateAssistant is a separate tracked
  // category, see file header).
  counts: {
    lungeAny: number;
    privateLead: number;
  };
  // Realized-history counts for roles/slots that never count toward a
  // required-capacity target - always reported so a UI can still show them
  // to the מנהלת. privateAssistant is the one exception worth calling out:
  // it lives here for output-shape stability, but (Stage A) IS now used for
  // scoring/ranking internally - see InternalBucketState's own comment. The
  // three BEGINNER_GROUP roles remain purely informational/unused by
  // scoring, as before.
  informational: {
    // BEGINNER_PRIVATE ASSISTANT_INSTRUCTOR (rotationOrder 1) history/current
    // membership - ranked (Stage A), not required capacity.
    privateAssistant: number;
    // BEGINNER_GROUP LEAD_INSTRUCTOR history - never counts toward any
    // required or ranked category, purely informational.
    beginnerGroupLead: number;
    beginnerGroupSecond: number;
    evaluator: number;
  };
  targetGaps: {
    lungeAny: number;
    privateLead: number;
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
// Role -> category/informational mapping
// ---------------------------------------------------------------------------

// Stage A - the "real" (ranked) side now includes privateAssistant, not just
// the two required buckets - see TraineeSuggestionRankingCategory. Only
// BEGINNER_GROUP's three roles remain purely informational/raw-counted
// (INFORMATIONAL_KEYS below).
type BucketOrInformational = TraineeSuggestionRankingCategory | "beginnerGroupLead" | "beginnerGroupSecond" | "evaluator";

const ROLE_TO_BUCKET: Record<
  TeachingPracticeTypeValue,
  Partial<Record<TeachingPracticeRoleValue, BucketOrInformational>>
> = {
  LUNGE: {
    LEAD_INSTRUCTOR: "lungeAny",
    ASSISTANT_INSTRUCTOR: "lungeAny",
  },
  BEGINNER_PRIVATE: {
    LEAD_INSTRUCTOR: "privateLead",
    ASSISTANT_INSTRUCTOR: "privateAssistant",
  },
  BEGINNER_GROUP: {
    LEAD_INSTRUCTOR: "beginnerGroupLead",
    SECOND_INSTRUCTOR: "beginnerGroupSecond",
    EVALUATOR: "evaluator",
  },
};

// Stage A - privateAssistant moved OUT of this set (was previously raw/
// undeduplicated, like these three still are) into the same dedup-per-track-
// membership path as lungeAny/privateLead (see buildBucketStates below) -
// necessary now that its count drives real ranking: BEGINNER_PRIVATE roles
// never rotate across a track's generated lessons (see
// lib/teaching-practice-rotation.ts), so a raw/undeduplicated count would
// have massively overcounted a single assistant track membership that
// generated many lesson dates. Only these three BEGINNER_GROUP roles remain
// purely informational/raw-counted - they never feed ranking at all.
const INFORMATIONAL_KEYS = ["beginnerGroupLead", "beginnerGroupSecond", "evaluator"] as const;
type InformationalKey = (typeof INFORMATIONAL_KEYS)[number];

function isInformationalKey(value: BucketOrInformational): value is InformationalKey {
  return (INFORMATIONAL_KEYS as readonly string[]).includes(value);
}

// Stage A - assistant is now ranked (see categoryCount in processSlot), not
// purely informational - note text updated accordingly. Still never a
// required-capacity target (requiredBucket stays null for this slot), so it
// never creates a "hole" warning.
const PRIVATE_ASSISTANT_NOTE =
  "תפקיד עוזר/ת בשיעור פרטני - מאוזן בפני עצמו (לא נספר ליעד המוביל/ה, רוטציה 0) - אינו יוצר התרעת \"סלוט חסר\" גם אם לא נמצא/ה מועמד/ת";
// Stage B - explicitly states the group roster is derived, not directly
// assignable here (see isTraineeSuggestionSlotSelectable in
// TeachingPracticeManager.tsx, which now excludes BEGINNER_GROUP slots from
// the checkbox/apply flow entirely) - this note is the one place that
// explanation reaches the UI, via slot.bucketNote.
const BEGINNER_GROUP_NOTE =
  "שיעור קבוצתי מתחילים - כל תפקידיו הם משניים ואינם נספרים לאף יעד (לא ללונג׳, לא לפרטני) - שיבוץ לפי איזון עומס כללי בלבד. הצוות בפועל נגזר מהמסלולים הפרטניים המקושרים - לא ניתן להחיל הצעה ישירות כאן, יש לשבץ במסלול הפרטני המתאים";

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

// Stage A - business-capacity/ranking model (see file header): LUNGE - every
// rotation position is a real required place, ranked as lungeAny.
// BEGINNER_PRIVATE - rotationOrder 0 (lead) is a real required place,
// ranked as privateLead; rotationOrder 1 (assistant) is ranked separately as
// privateAssistant but never required. BEGINNER_GROUP - no rotation
// position is ranked or required at all (fully informational/derived).
//
// requiredBucket is always either equal to rankingCategory or null - never
// a category rankingCategory doesn't also cover - so
// "requiredBucket !== null" is exactly "this slot's category also drives
// the no_suitable_candidate/supply_below_demand warnings."
function categorizeSlot(
  practiceType: TeachingPracticeTypeValue,
  rotationOrder: number
): {
  rankingCategory: TraineeSuggestionRankingCategory | null;
  requiredBucket: TraineeSuggestionBucket | null;
  note: string | null;
} {
  if (practiceType === "LUNGE") {
    return { rankingCategory: "lungeAny", requiredBucket: "lungeAny", note: null };
  }
  if (practiceType === "BEGINNER_PRIVATE") {
    return rotationOrder === 0
      ? { rankingCategory: "privateLead", requiredBucket: "privateLead", note: null }
      : { rankingCategory: "privateAssistant", requiredBucket: null, note: PRIVATE_ASSISTANT_NOTE };
  }
  // BEGINNER_GROUP - never ranked, never required, under this model.
  return { rankingCategory: null, requiredBucket: null, note: BEGINNER_GROUP_NOTE };
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

// Product rule (revised - broadened beyond linkage): fixed structure is
// time-of-day only (no real date field - weekday is only ever an unenforced
// display hint, see TraineeSuggestionInputTrack's own comment), but
// BEGINNER_PRIVATE and BEGINNER_GROUP represent different ACTUAL DATE
// BLOCKS in the real schedule - private lessons and the group lesson never
// happen on the same day, even when their recorded clock times happen to
// overlap. So a BEGINNER_PRIVATE <-> BEGINNER_GROUP pair is NEVER treated as
// a real time conflict, regardless of whether the two specific tracks are
// linked to each other via groupTrackId - practiceType alone is sufficient.
// LUNGE and same-type (private/private, group/group) pairs are unaffected -
// only a BEGINNER_PRIVATE <-> BEGINNER_GROUP pair is ever ignored here.
//
// Used consistently everywhere a time relationship between two of a
// trainee's fixed-structure tracks is evaluated: the existing_overlap
// warning below, the candidate hard-overlap exclusion AND the spacing
// (nearestGapMinutes) scoring in processSlot further down, and the trainee
// schedule overview's own pairwise overlap/gap computation - so a private/
// group pair is never flagged as "חפיפה", never hard-excludes a candidate,
// and never shrinks a candidate's spacing score or a trainee's minimum-gap
// summary. Mirrors shouldIgnoreFixedStructureTimeConflict in
// lib/teaching-practice-fixed-structure-check.ts - not imported, since
// that's a separate standalone pure-check module (same small, deliberate
// duplication convention already used elsewhere between these two files,
// e.g. VALID_GROUP_NAMES/tracksMayOverlap-style helpers).
function shouldIgnoreFixedStructureTimeConflict(
  a: TraineeSuggestionInputTrack,
  b: TraineeSuggestionInputTrack
): boolean {
  return (
    (a.practiceType === "BEGINNER_PRIVATE" && b.practiceType === "BEGINNER_GROUP") ||
    (a.practiceType === "BEGINNER_GROUP" && b.practiceType === "BEGINNER_PRIVATE")
  );
}

// ---------------------------------------------------------------------------
// Stage A - spacing ("gap") scoring. Ranks candidates for an empty slot by
// how crowded the new assignment would be relative to their OTHER current
// fixed-structure windows - a larger nearest gap is a better (more spacious)
// candidate. This is layered on top of, not a replacement for, the hard
// overlap exclusion above: a pair that actually overlaps never reaches this
// code (it was already filtered out as a hard exclusion before scoring
// runs), so minutesBetweenTracks below only ever needs to handle the
// non-overlapping case.
//
// Day-blind, same limitation and same reasoning as tracksMayOverlap above:
// the fixed structure has no real calendar date/day field (weekday is only
// ever an unenforced display hint - see TeachingPracticeTrack's own schema
// comment), so "nearest gap" is computed purely from time-of-day, exactly
// like the overlap check it's built next to. A candidate's Monday-morning
// slot and Wednesday-morning slot are scored as if they were 0 minutes
// apart on the same day, not as unrelated. This is a deliberate, accepted
// trade-off (kept consistent with the overlap check rather than introducing
// a day-aware gap alongside a day-blind overlap, which would produce
// confusing, inconsistent-feeling results) - not a bug.
// ---------------------------------------------------------------------------

// Minutes between two non-overlapping time windows, on whichever side is
// closer (other entirely before target, or entirely after it). Returns null
// when either side's time can't be parsed - callers must treat this the same
// "unknown, never guessed" way tracksMayOverlap's own unknown result is
// treated, never as a forced 0 (tie) or Infinity (automatic win). 0 in the
// non-null return path is a defensive fallback for a pair that turns out to
// overlap after all (should never happen here - overlap is already a hard
// exclusion upstream, see processSlot below), not a real "adjacent" gap.
function minutesBetweenTracks(target: TraineeSuggestionInputTrack, other: TraineeSuggestionInputTrack): number | null {
  const targetStart = parseTimeToMinutes(target.defaultStartTime);
  const targetEnd = parseTimeToMinutes(target.defaultEndTime);
  const otherStart = parseTimeToMinutes(other.defaultStartTime);
  const otherEnd = parseTimeToMinutes(other.defaultEndTime);
  if (targetStart == null || targetEnd == null || otherStart == null || otherEnd == null) return null;
  if (otherStart >= targetEnd) return otherStart - targetEnd;
  if (targetStart >= otherEnd) return targetStart - otherEnd;
  return 0;
}

// The candidate's nearest gap, in minutes, between the target slot and every
// one of their OTHER current fixed-structure windows (real memberships plus
// anything already suggested earlier in this same run - see
// provisionalWindows in the main loop below). Infinity when the candidate
// has no other windows at all (best possible spacing - "פנוי/ה בשעה הזו") or
// when every other window's gap is unknown (missing/invalid time data,
// already covered once upfront by the missing_or_invalid_time_data warning,
// never re-penalized per candidate here).
function nearestGapMinutes(target: TraineeSuggestionInputTrack, otherWindows: TraineeSuggestionInputTrack[]): number {
  let nearest = Infinity;
  for (const other of otherWindows) {
    const gap = minutesBetweenTracks(target, other);
    if (gap != null && gap < nearest) nearest = gap;
  }
  return nearest;
}

// Gaps at or above this are described as "מרווח טוב" (good spacing) in the
// suggestion reason text; anything smaller (but not overlapping, which is
// already a hard exclusion) is described as "צמוד" (tight/adjacent). A
// simple, adjustable threshold, not a hard rule - same convention as
// SAME_DUTY_REPEAT_THRESHOLD/TOTAL_DEVIATION_THRESHOLD in
// lib/schedule-fairness.ts.
// Exported (Stage B) so the trainee schedule overview can use the exact
// same "good gap" threshold for its own spacing chips, rather than
// duplicating the number.
export const TRAINEE_SUGGESTION_GOOD_GAP_MINUTES = 60;

// ---------------------------------------------------------------------------
// Bucket-count computation
// ---------------------------------------------------------------------------

interface InternalBucketState {
  lungeAny: number;
  privateLead: number;
  // Stage A - now dedup-per-track-membership counted, same as lungeAny/
  // privateLead (see buildBucketStates below) - despite still being exposed
  // under TraineeBucketSummary.informational for display, this count is now
  // ALSO read live by processSlot's categoryCount scoring tier. Not purely
  // informational/decorative any more, just never a required-capacity
  // target (see file header).
  privateAssistant: number;
  beginnerGroupLead: number; // informational, raw realized-row count
  beginnerGroupSecond: number; // informational, raw realized-row count
  evaluator: number; // informational, raw realized-row count
  currentTrackIds: Set<string>;
}

function newBucketState(): InternalBucketState {
  return {
    lungeAny: 0,
    privateLead: 0,
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

  // Realized history, deduplicated per (traineeId, trackId) for the 3
  // ranked categories (one track membership = at most one contribution per
  // category, regardless of how many lessons that track has generated) -
  // see file header for why this counting unit is the correct one, and why
  // privateAssistant needs this too now that it's ranked. Ad-hoc lessons
  // (trackId null) have nothing to deduplicate against, so each contributes
  // independently. Informational counts (the 3 BEGINNER_GROUP roles) are
  // intentionally raw row counts, never deduplicated - see their field doc.
  const realizedBucketsByTraineeTrack = new Map<string, Set<TraineeSuggestionRankingCategory>>();

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
      privateLead: s.privateLead,
    },
    informational: {
      // Stage A - privateAssistant lives here for backward-compatible output
      // shape, but is no longer purely informational internally - see its
      // own field comment on InternalBucketState above.
      privateAssistant: s.privateAssistant,
      beginnerGroupLead: s.beginnerGroupLead,
      beginnerGroupSecond: s.beginnerGroupSecond,
      evaluator: s.evaluator,
    },
    targetGaps: {
      lungeAny: gap(s.lungeAny),
      privateLead: gap(s.privateLead),
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
  // something this run created. Exempts any BEGINNER_PRIVATE/BEGINNER_GROUP
  // pair, linked or not (see shouldIgnoreFixedStructureTimeConflict) -
  // private and group lessons happen on different actual dates, so their
  // clock-time overlap is never a real conflict.
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
        if (check.overlaps && !shouldIgnoreFixedStructureTimeConflict(trackA, trackB)) {
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
  // Stage A - now carries privateAssistant too (indexable by
  // TraineeSuggestionRankingCategory), not just the two required buckets -
  // it's read by processSlot's categoryCount tier for any ranked slot,
  // required or not.
  interface ProvisionalTraineeState {
    lungeAny: number;
    privateLead: number;
    privateAssistant: number;
    totalAssignments: number;
  }
  const provisionalBuckets = new Map<string, ProvisionalTraineeState>();
  for (const t of eligibleTrainees) {
    const s = bucketStates.get(t.id);
    provisionalBuckets.set(t.id, {
      lungeAny: s?.lungeAny ?? 0,
      privateLead: s?.privateLead ?? 0,
      privateAssistant: s?.privateAssistant ?? 0,
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
  // corrected model against real data): a requiredBucket===null slot
  // (BEGINNER_PRIVATE rotationOrder 1/privateAssistant, any BEGINNER_GROUP
  // rotationOrder) must NEVER be filled before every required slot (LUNGE,
  // BEGINNER_PRIVATE rotationOrder 0) across the WHOLE group has already had
  // its chance - otherwise, filling a non-required slot early can occupy a
  // candidate's time-window and then, via the overlap hard-exclusion, block
  // that same candidate from later winning their genuinely-required
  // lungeAny/privateLead slot elsewhere, turning a real seat into an
  // artificial hole purely because of processing order. Verified against
  // real group data: without this two-pass split, group א showed 3 required
  // holes instead of the expected 1 - re-ordering into "all required slots
  // first, everything else second" was required to reach the correct count.
  // Filled (already-assigned) slots are recorded during pass 1 regardless of
  // category, since they don't consume a new candidate at all. Stage A -
  // this pass split is keyed on requiredBucket specifically (not
  // rankingCategory), so privateAssistant slots still run in pass 2, exactly
  // like before it was promoted to a ranked category - only whether a slot
  // creates required-hole warnings changed, not this processing order.
  const trackGroups: TraineeSuggestionTrackGroup[] = [];
  // supply/demand tally per required bucket, group-wide. privateAssistant is
  // deliberately never tallied here - it's ranked but not required capacity
  // (see file header), so it never contributes to supply_below_demand.
  const supplyByBucket: Record<TraineeSuggestionBucket, number> = {
    lungeAny: 0,
    privateLead: 0,
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

  // Stage C2a - result of the hard-exclusion candidate filter, extracted out
  // of processSlot (see filterEligibleCandidates below) so the most-
  // constrained-first scheduler can evaluate "how many candidates currently
  // survive for this slot" without committing anything.
  interface CandidateFilterResult {
    candidates: TraineeSuggestionInputTrainee[];
    excludedCandidates: TraineeSuggestionExcludedCandidate[];
  }

  // Stage C2a - the complete hard-exclusion filter (already_on_track, then
  // overlap against provisionalWindows), unchanged from what used to live
  // inline in processSlot - now shared by both the scheduler's read-only
  // probing (runMostConstrainedFirst below) and processSlot's real,
  // committing run, so there is exactly one implementation of "who's
  // eligible right now," never two that could drift apart. Deliberately
  // keyed on (meta, track) only, not rotationOrder - hard exclusion has
  // never depended on which rotationOrder/category a slot is (only
  // categoryCount scoring does, inside processSlot itself), so the exact
  // same result is valid for every still-empty rotationOrder on this track
  // at this moment in the run.
  function filterEligibleCandidates(meta: TrackMeta, track: TraineeSuggestionInputTrack): CandidateFilterResult {
    const excludedCandidates: TraineeSuggestionExcludedCandidate[] = [];
    const candidates: TraineeSuggestionInputTrainee[] = [];

    for (const candidate of eligibleTrainees) {
      if (meta.traineeIdsOnThisTrack.has(candidate.id)) {
        excludedCandidates.push({
          traineeId: candidate.id,
          traineeName: candidate.fullName,
          reason: "כבר משובץ/ת בסלוט אחר באותו מסלול",
          category: "already_on_track",
        });
        continue;
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
        // Product rule: a BEGINNER_PRIVATE/BEGINNER_GROUP pair never
        // hard-excludes a candidate here, linked or not - see
        // shouldIgnoreFixedStructureTimeConflict's own comment. LUNGE and
        // same-type pairs are unaffected.
        if (shouldIgnoreFixedStructureTimeConflict(track, otherTrack)) continue;
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

    return { candidates, excludedCandidates };
  }

  // processSlot handles one (track, rotationOrder) - shared by both passes
  // below so the candidate-filtering/scoring/reason logic is never
  // duplicated between them. Stage C2a - accepts an optional precomputed
  // candidate filter (from the most-constrained-first scheduler's own probe
  // of this exact slot, taken immediately before calling processSlot, with
  // no other slot processed/committed in between) so the filter is never
  // computed twice for the slot that's actually chosen; falls back to
  // computing it fresh when called without one (the already-filled short-
  // circuit below never needs it at all).
  function processSlot(meta: TrackMeta, rotationOrder: number, precomputedFilter?: CandidateFilterResult): void {
    const { track } = meta;
    const projectedRole = projectRoleForRotationOrder(track.practiceType, rotationOrder);
    const { rankingCategory, requiredBucket, note: bucketNote } = categorizeSlot(track.practiceType, rotationOrder);
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
        targetBucket: requiredBucket,
        rankingCategory,
        bucketNote,
        currentTraineeId,
        currentTraineeName: traineeName(currentTraineeId),
        suggestedTraineeId: null,
        suggestedTraineeName: null,
        reason: "הסלוט כבר משובץ - לא מוצעת החלפה אוטומטית",
        excludedCandidates: [],
        rankedCandidates: [],
      });
      return;
    }

    if (requiredBucket) supplyByBucket[requiredBucket] += 1;

    // ---- Candidate filtering (hard constraints - the complete list) ----
    // Stage A - category/bucket satisfaction is no longer a hard exclusion
    // for anyone (see file header) - a candidate who already holds one (or
    // more) assignments in this slot's rankingCategory is still a valid
    // candidate, just ranked behind anyone with fewer (see the categoryCount
    // scoring tier below). This is what allows a well-spaced second-round
    // assignment once everyone has had a fair first turn, instead of
    // leaving the slot as a permanent hole. Stage C2a - the actual filtering
    // now lives in filterEligibleCandidates above; precomputedFilter is
    // reused when the most-constrained-first scheduler already evaluated
    // this exact slot immediately before choosing to commit it.
    const { candidates, excludedCandidates } = precomputedFilter ?? filterEligibleCandidates(meta, track);

    // ---- Scoring - against PROVISIONAL state, not the static starting
    // summary, so a candidate's category load/spacing/total-load already
    // reflects every suggestion accepted earlier in this run (including
    // every required slot from pass 1, by the time pass 2 runs). For a slot
    // with rankingCategory===null (BEGINNER_GROUP), categoryCount is always
    // 0 for everyone - scoring falls straight through to spacing (then
    // total-load, then name).
    //
    // Stage A - categoryCount ascending is now the PRIMARY tier (replaces
    // the old bucketDeficit tier and the hard "bucket_satisfied" exclusion
    // together): a candidate with fewer existing assignments in this exact
    // category (lungeAny / privateLead / privateAssistant) always ranks
    // above one with more, whether that's "0 vs 1" (prefer never-assigned)
    // or "1 vs 2" (prefer fewer, once everyone has at least one) - a single
    // ascending sort on the raw count covers both cases in one tier, unlike
    // the old clamped-at-1 bucketDeficit, which could never distinguish "1
    // assignment" from "2 assignments" (both clamped to deficit 0). This
    // directly fixes the reported bad pattern (one trainee suggested as
    // assistant twice while another was never suggested as assistant at
    // all) - category fairness now strictly outranks spacing, exactly as
    // required. Below that, ordering prefers the most SPACIOUS candidate
    // (largest nearestGapMinutes), then fewer total assignments, then name.
    // gapMinutes is computed against otherWindows (provisionalWindows minus
    // this exact track - never meaningfully present yet at this point,
    // since the candidate hasn't been assigned to it, but filtered
    // defensively the same way the overlap-exclusion loop above does).
    const scored = candidates
      .map((c) => {
        const state = provisionalBuckets.get(c.id);
        const categoryCount = rankingCategory ? (state?.[rankingCategory] ?? 0) : 0;
        const totalAssignments = state?.totalAssignments ?? 0;
        // Product rule: a BEGINNER_PRIVATE/BEGINNER_GROUP pair is never
        // "comparable" for spacing purposes either (see
        // shouldIgnoreFixedStructureTimeConflict) - filtered out here so it
        // can never shrink a candidate's gapMinutes or make them look
        // artificially "צמוד" against a slot that isn't a real conflict.
        const otherWindows = (provisionalWindows.get(c.id) ?? []).filter(
          (t) => t.id !== track.id && !shouldIgnoreFixedStructureTimeConflict(track, t)
        );
        const gapMinutes = nearestGapMinutes(track, otherWindows);
        return { candidate: c, categoryCount, totalAssignments, gapMinutes };
      })
      .sort((a, b) => {
        // Fewer existing assignments in this category = better, so a
        // smaller a.categoryCount sorts first (negative result).
        if (a.categoryCount !== b.categoryCount) return a.categoryCount - b.categoryCount;
        // Larger gap = more spacious = better, so a larger b.gapMinutes
        // sorts first (positive result). Guarded by the equality check
        // first so two Infinity gaps (both "no other assignments at all")
        // never subtract to NaN - they fall through to the next tier
        // instead, same convention as every other tier here.
        if (b.gapMinutes !== a.gapMinutes) return b.gapMinutes - a.gapMinutes;
        if (a.totalAssignments !== b.totalAssignments) return a.totalAssignments - b.totalAssignments;
        return a.candidate.fullName.localeCompare(b.candidate.fullName, "he");
      });

    // Stage C1 - expose the whole ranked, surviving-candidate list (not just
    // scored[0]) in the exact order scoring already produced above - no new
    // sort, no new filtering, just a mapping to the public JSON-safe shape
    // (Infinity -> null).
    const rankedCandidates: TraineeSuggestionRankedCandidate[] = scored.map((s, index) => ({
      traineeId: s.candidate.id,
      traineeName: s.candidate.fullName,
      categoryCount: s.categoryCount,
      gapMinutes: s.gapMinutes === Infinity ? null : s.gapMinutes,
      totalAssignments: s.totalAssignments,
      isRecommended: index === 0,
    }));

    const best = scored[0];
    let reason: string;
    let suggestedTraineeId: string | null = null;
    let suggestedTraineeName: string | null = null;

    if (!best) {
      // Stage A - summarize WHY, from the actual exclusion categories
      // tallied above. Now that "bucket_satisfied" no longer exists (see
      // file header), a hole here can only ever come from overlap and/or
      // already-on-track exhausting the entire eligible pool - a rarer,
      // more genuinely "no one is actually available" situation than
      // before.
      if (eligibleTrainees.length === 0) {
        reason = "אין חניכים פעילים בקבוצה זו";
      } else {
        const categoriesPresent = new Set(excludedCandidates.map((e) => e.category));
        const onlyOverlap = categoriesPresent.size === 1 && categoriesPresent.has("overlap");
        if (onlyOverlap) {
          reason = "אין הצעה מתאימה - כל החניכים הזמינים חופפים בזמן לסלוט זה";
        } else {
          reason =
            "אין הצעה מתאימה - כל החניכים הפעילים בקבוצה נפסלו (חפיפת זמנים ו/או שיבוץ קיים באותו מסלול - ראו פירוט למטה)";
        }
      }
      // Only a required-bucket slot's absence of a suggestion is
      // warning-worthy - privateAssistant and BEGINNER_GROUP slots
      // (requiredBucket null) never create a required-hole-style warning,
      // per the explicit product rule, even when nobody could be suggested;
      // their own `reason` text on the slot itself already explains why,
      // without adding noise to the warnings list.
      if (requiredBucket) {
        warnings.push({
          kind: "no_suitable_candidate",
          message: `אין הצעה מתאימה לסלוט ${describeTrackTime(track)} (${track.practiceType}, מס' ${rotationOrder + 1})`,
          trackId: track.id,
        });
      }
    } else {
      suggestedTraineeId = best.candidate.id;
      suggestedTraineeName = best.candidate.fullName;
      meta.traineeIdsOnThisTrack.add(best.candidate.id);

      // Fold this suggestion into the provisional state immediately,
      // before the next slot is scored - without this, the same
      // under-count candidate(s) would keep winning every subsequent
      // slot in the run.
      const provisionalState = provisionalBuckets.get(best.candidate.id);
      if (provisionalState) {
        if (rankingCategory) provisionalState[rankingCategory] += 1;
        provisionalState.totalAssignments += 1;
      }
      const windows = provisionalWindows.get(best.candidate.id) ?? [];
      windows.push(track);
      provisionalWindows.set(best.candidate.id, windows);

      const reasonParts: string[] = [];
      // Stage A - category-fairness segment, exactly the phrasing
      // requested: first-time-in-this-category always wins the top phrase;
      // a second (or later) assignment in the category gets one of two
      // phrases depending on how good the resulting spacing is. Falls back
      // to the slot's own bucketNote for a BEGINNER_GROUP slot
      // (rankingCategory null), unchanged from before.
      if (rankingCategory) {
        if (best.categoryCount === 0) {
          reasonParts.push("עדיפות כי טרם שובץ/ה בתפקיד הזה");
        } else if (best.gapMinutes === Infinity || best.gapMinutes >= TRAINEE_SUGGESTION_GOOD_GAP_MINUTES) {
          reasonParts.push("שיבוץ נוסף בתפקיד הזה, עם מרווח טוב");
        } else {
          reasonParts.push("כבר שובץ/ה בתפקיד הזה, אבל המרווח מתאים");
        }
      } else {
        reasonParts.push(bucketNote ?? "שיבוץ לפי מרווח/איזון עומס");
      }
      // Spacing segment - existing phrasing, unchanged.
      if (best.gapMinutes === Infinity) {
        reasonParts.push("פנוי/ה בשעה הזו - אין שיבוצים קבועים אחרים בכלל");
      } else if (best.gapMinutes >= TRAINEE_SUGGESTION_GOOD_GAP_MINUTES) {
        reasonParts.push(`מרווח טוב מהשיבוץ הקרוב (${best.gapMinutes} דק')`);
      } else {
        reasonParts.push(`צמוד לשיבוץ אחר (${best.gapMinutes} דק')`);
      }
      reasonParts.push(`סה"כ שיבוצים קבועים נוכחיים: ${best.totalAssignments}`);
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
      targetBucket: requiredBucket,
      rankingCategory,
      bucketNote,
      currentTraineeId: null,
      currentTraineeName: null,
      suggestedTraineeId,
      suggestedTraineeName,
      reason,
      excludedCandidates,
      rankedCandidates,
    });
  }

  // Stage C2a - most-constrained-first scheduler for one pass's still-open
  // slots: repeatedly re-evaluates every remaining slot's LIVE eligible-
  // candidate count (via filterEligibleCandidates, against whatever
  // provisional state the run has reached so far - never a stale snapshot
  // from before this pass started) and commits the most-constrained slot
  // next, so a low-constraint hole can never "use up" a candidate who was
  // one of very few options for a still-open, harder-to-fill hole elsewhere
  // in the same pass. `pendingSlots` is built by the caller in the original
  // track/rotationOrder order (same order raw processing used before Stage
  // C2a); `remaining` preserves that relative order across splices, and the
  // scan below only ever replaces the current pick on a STRICTLY smaller
  // count (never on a tie) - so among equally-constrained slots, the one
  // that appears earliest in original track/slot order always wins, giving
  // a stable, reproducible tie-break with no extra bookkeeping needed.
  function runMostConstrainedFirst(pendingSlots: { meta: TrackMeta; rotationOrder: number }[]): void {
    const remaining = pendingSlots.slice();
    while (remaining.length > 0) {
      let winnerIndex = 0;
      let winnerFilter = filterEligibleCandidates(remaining[0].meta, remaining[0].meta.track);
      for (let i = 1; i < remaining.length; i++) {
        const filter = filterEligibleCandidates(remaining[i].meta, remaining[i].meta.track);
        if (filter.candidates.length < winnerFilter.candidates.length) {
          winnerIndex = i;
          winnerFilter = filter;
        }
      }
      const { meta, rotationOrder } = remaining[winnerIndex];
      remaining.splice(winnerIndex, 1);
      processSlot(meta, rotationOrder, winnerFilter);
    }
  }

  // Pass 1: every already-filled slot is recorded immediately, in original
  // order - filled slots never consume a candidate or touch provisional
  // state, so their processing order has never mattered (unchanged from
  // before Stage C2a). Every required, still-EMPTY slot (requiredBucket !==
  // null - LUNGE both seats, BEGINNER_PRIVATE rotationOrder 0) is instead
  // collected and handed to the most-constrained-first scheduler, so within
  // this pass the hardest-to-fill required hole is always resolved before an
  // easier one can take a candidate it didn't strictly need. This preserves
  // the original two-pass boundary exactly - every required slot (however
  // it's ordered internally) still fully resolves before any non-required
  // slot is even considered - which is what prevents an assistant/BEGINNER_
  // GROUP slot from ever blocking a required one (see the two-pass rationale
  // above).
  const pass1Pending: { meta: TrackMeta; rotationOrder: number }[] = [];
  for (const meta of trackMetas) {
    for (let rotationOrder = 0; rotationOrder < meta.expectedSize; rotationOrder++) {
      const alreadyFilled = meta.membershipByRotationOrder.has(rotationOrder);
      const { requiredBucket } = categorizeSlot(meta.track.practiceType, rotationOrder);
      if (alreadyFilled) {
        processSlot(meta, rotationOrder);
      } else if (requiredBucket) {
        pass1Pending.push({ meta, rotationOrder });
      }
    }
  }
  runMostConstrainedFirst(pass1Pending);

  // Pass 2: every remaining empty slot - privateAssistant (ranked but not
  // required) and every BEGINNER_GROUP rotation (neither ranked nor
  // required) - now that every pass-1 slot (required + already-filled) has
  // already committed/consumed provisional state, exactly as before Stage
  // C2a. Most-constrained-first is applied within this pass too, on the
  // same principle: a privateAssistant hole with only one real option is
  // resolved before one with several, instead of raw track order deciding
  // who "gets there first."
  const pass2Pending: { meta: TrackMeta; rotationOrder: number }[] = [];
  for (const meta of trackMetas) {
    for (let rotationOrder = 0; rotationOrder < meta.expectedSize; rotationOrder++) {
      if (!meta.slotsByRotationOrder.has(rotationOrder)) pass2Pending.push({ meta, rotationOrder });
    }
  }
  runMostConstrainedFirst(pass2Pending);

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
  // meaningful for the 2 required buckets - privateAssistant (ranked but not
  // required) never contributes to supplyByBucket and never factors into
  // this warning, by design.
  const bucketLabels: Record<TraineeSuggestionBucket, string> = {
    lungeAny: "לונג׳",
    privateLead: "פרטני (מוביל/ה)",
  };
  for (const bucket of ["lungeAny", "privateLead"] as const) {
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

// ---------------------------------------------------------------------------
// Stage B - trainee schedule overview ("לו״ז חניכים"). Read-only, fixed-
// structure only, same day-blind time-of-day model as the suggestion engine
// above - reuses tracksMayOverlap, minutesBetweenTracks,
// shouldIgnoreFixedStructureTimeConflict, hasUsableTimeData and
// projectRoleForRotationOrder directly (all already pure, already in this
// file) rather than duplicating any time-gap logic. This is purely a
// different PRESENTATION of largely the same underlying facts the
// suggestion engine already reasons about - no scoring, no candidate
// filtering, no write path of any kind.
// ---------------------------------------------------------------------------

// Deliberately narrower than ComputeTraineeSuggestionsInput - this view
// never needs participantHistory (fixed-structure only, no generated-lesson
// history involved).
export interface ComputeTraineeScheduleInput {
  groupName: string;
  trainees: TraineeSuggestionInputTrainee[];
  tracks: TraineeSuggestionInputTrack[];
  trackTrainees: TraineeSuggestionInputTrackTrainee[];
}

export interface TraineeScheduleAssignment {
  trackId: string;
  practiceType: TeachingPracticeTypeValue;
  rotationOrder: number;
  projectedRole: TeachingPracticeRoleValue;
  weekday: number | null;
  defaultStartTime: string;
  defaultEndTime: string;
  // True only for BEGINNER_GROUP - that track's roster is derived from its
  // linked BEGINNER_PRIVATE tracks, never directly assignable (see
  // isTraineeSuggestionSlotSelectable in TeachingPracticeManager.tsx) - this
  // flag lets the UI badge it as such while still showing it for load/
  // schedule context, per product rule.
  isDerived: boolean;
  // Minutes to this trainee's nearest OTHER assignment, excluding both a
  // genuinely overlapping pair (see overlapsWithTrackIds instead) and any
  // BEGINNER_PRIVATE/BEGINNER_GROUP pair, linked or not (never a real gap or
  // a real conflict - see shouldIgnoreFixedStructureTimeConflict). Null when
  // no such comparable other assignment exists (missing/invalid time data on
  // every other side, or genuinely no other assignments at all).
  nearestGapMinutes: number | null;
  // Non-empty only for a genuine (non-linked-pair) time overlap with another
  // of this trainee's own assignments.
  overlapsWithTrackIds: string[];
}

export interface TraineeScheduleRow {
  traineeId: string;
  traineeName: string;
  totalAssignments: number;
  countByCategory: {
    lungeAny: number;
    privateLead: number;
    privateAssistant: number;
    // Informational/derived - see TraineeScheduleAssignment.isDerived.
    beginnerGroup: number;
  };
  // Sorted by defaultStartTime.
  assignments: TraineeScheduleAssignment[];
  // The smallest nearestGapMinutes across all of this trainee's assignments -
  // null when fewer than 2 comparable assignments exist (0 or 1 assignment,
  // or every pair is either linked-exempt or has unusable time data).
  minGapMinutes: number | null;
  hasOverlap: boolean;
}

export interface ComputeTraineeScheduleResult {
  groupName: string;
  trainees: TraineeScheduleRow[];
  warnings: TraineeSuggestionWarning[];
}

export function computeTeachingPracticeTraineeSchedule(
  input: ComputeTraineeScheduleInput
): ComputeTraineeScheduleResult {
  const warnings: TraineeSuggestionWarning[] = [];

  // Defensive re-scoping, same convention as computeTeachingPracticeTraineeSuggestions.
  const tracks = input.tracks.filter((t) => t.groupName === input.groupName);
  const trackById = new Map(tracks.map((t) => [t.id, t]));
  const eligibleTrainees = input.trainees.filter((t) => t.isActive && t.groupName === input.groupName);

  const tracksWithIncompleteTimeData = tracks.filter((t) => !hasUsableTimeData(t));
  if (tracksWithIncompleteTimeData.length > 0) {
    warnings.push({
      kind: "missing_or_invalid_time_data",
      message: `ל-${tracksWithIncompleteTimeData.length} מסלולים קבועים בקבוצה אין שעת התחלה/סיום תקינה - לא ניתן לחשב עבורם מרווחים/חפיפות. שאר הלו״ז אינו מושפע.`,
    });
  }

  const membershipsByTrainee = new Map<string, TraineeSuggestionInputTrackTrainee[]>();
  for (const m of input.trackTrainees) {
    if (!trackById.has(m.trackId)) continue;
    const list = membershipsByTrainee.get(m.traineeId) ?? [];
    list.push(m);
    membershipsByTrainee.set(m.traineeId, list);
  }

  const rows: TraineeScheduleRow[] = eligibleTrainees.map((trainee) => {
    const tracksForTrainee = (membershipsByTrainee.get(trainee.id) ?? [])
      .map((m) => ({ m, track: trackById.get(m.trackId) }))
      .filter((x): x is { m: TraineeSuggestionInputTrackTrainee; track: TraineeSuggestionInputTrack } => !!x.track)
      .sort((a, b) => a.track.defaultStartTime.localeCompare(b.track.defaultStartTime));

    const countByCategory = { lungeAny: 0, privateLead: 0, privateAssistant: 0, beginnerGroup: 0 };

    const assignments: TraineeScheduleAssignment[] = tracksForTrainee.map(({ m, track }) => {
      if (track.practiceType === "LUNGE") countByCategory.lungeAny += 1;
      else if (track.practiceType === "BEGINNER_PRIVATE") {
        if (m.rotationOrder === 0) countByCategory.privateLead += 1;
        else countByCategory.privateAssistant += 1;
      } else {
        countByCategory.beginnerGroup += 1;
      }

      // Pairwise against every OTHER assignment this same trainee has (not
      // just chronological neighbors) - any BEGINNER_PRIVATE/BEGINNER_GROUP
      // pair, linked or not, is skipped entirely (neither an overlap nor a
      // gap contributor - see shouldIgnoreFixedStructureTimeConflict: fixed
      // structure is time-of-day only, but private and group lessons happen
      // on different actual dates, so their clock-time overlap is never a
      // real conflict or a real spacing signal); a genuine overlap
      // contributes to overlapsWithTrackIds and never to the gap; everything
      // else contributes its minutesBetweenTracks value as a gap candidate.
      const overlapsWithTrackIds: string[] = [];
      let nearestGap: number | null = null;
      for (const { track: other } of tracksForTrainee) {
        if (other.id === track.id) continue;
        if (shouldIgnoreFixedStructureTimeConflict(track, other)) continue;
        const check = tracksMayOverlap(track, other);
        if (check.unknown) continue; // already covered by the upfront missing_or_invalid_time_data warning
        if (check.overlaps) {
          overlapsWithTrackIds.push(other.id);
          continue;
        }
        const gap = minutesBetweenTracks(track, other);
        if (gap != null && (nearestGap === null || gap < nearestGap)) nearestGap = gap;
      }

      return {
        trackId: track.id,
        practiceType: track.practiceType,
        rotationOrder: m.rotationOrder,
        projectedRole: projectRoleForRotationOrder(track.practiceType, m.rotationOrder),
        weekday: track.weekday,
        defaultStartTime: track.defaultStartTime,
        defaultEndTime: track.defaultEndTime,
        isDerived: track.practiceType === "BEGINNER_GROUP",
        nearestGapMinutes: nearestGap,
        overlapsWithTrackIds,
      };
    });

    const hasOverlap = assignments.some((a) => a.overlapsWithTrackIds.length > 0);
    const knownGaps = assignments
      .map((a) => a.nearestGapMinutes)
      .filter((g): g is number => g != null);
    const minGapMinutes = knownGaps.length > 0 ? Math.min(...knownGaps) : null;

    return {
      traineeId: trainee.id,
      traineeName: trainee.fullName,
      totalAssignments: assignments.length,
      countByCategory,
      assignments,
      minGapMinutes,
      hasOverlap,
    };
  });

  rows.sort((a, b) => a.traineeName.localeCompare(b.traineeName, "he"));

  return { groupName: input.groupName, trainees: rows, warnings };
}
