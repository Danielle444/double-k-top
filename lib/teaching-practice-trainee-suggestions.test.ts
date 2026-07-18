/**
 * Characterization tests for the pure Teaching Practice trainee-suggestion
 * engine (lib/teaching-practice-trainee-suggestions.ts) - both
 * computeTeachingPracticeTraineeSuggestions and
 * computeTeachingPracticeTraineeSchedule. These pin down the engine's CURRENT
 * behavior against fixed, plain-data fixtures; they are not aspirational and
 * encode no desired future S3/S4 behavior.
 *
 * Uses the existing `tsx` runner with Node built-ins `node:test` and
 * `node:assert/strict`. No test framework is installed. Run with:
 *   npx tsx --test lib/teaching-practice-trainee-suggestions.test.ts
 *
 * Pure: no Prisma, no DB, no Next.js runtime, no clock, plain-data fixtures.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  computeTeachingPracticeTraineeSuggestions,
  computeTeachingPracticeTraineeSchedule,
  type ComputeTraineeSuggestionsInput,
  type ComputeTraineeScheduleInput,
  type TraineeSuggestionInputTrainee,
  type TraineeSuggestionInputTrack,
  type TraineeSuggestionInputTrackTrainee,
  type TraineeSuggestionInputParticipantHistory,
  type TraineeSuggestionRotationSlot,
  type ComputeTraineeSuggestionsResult,
} from "./teaching-practice-trainee-suggestions";
import type {
  TeachingPracticeTypeValue,
  TeachingPracticeRoleValue,
} from "./teaching-practice-rotation";

// --- fixture builders (plain data only) -----------------------------------

function trainee(
  id: string,
  fullName: string,
  groupName: string | null = "א",
  isActive = true
): TraineeSuggestionInputTrainee {
  return { id, fullName, groupName, isActive };
}

function track(
  id: string,
  practiceType: TeachingPracticeTypeValue,
  start: string,
  end: string,
  groupName: string | null = "א",
  groupTrackId: string | null = null
): TraineeSuggestionInputTrack {
  return { id, practiceType, groupName, weekday: null, defaultStartTime: start, defaultEndTime: end, groupTrackId };
}

function member(trackId: string, traineeId: string, rotationOrder: number): TraineeSuggestionInputTrackTrainee {
  return { trackId, traineeId, rotationOrder };
}

function hist(
  traineeId: string,
  trackId: string | null,
  practiceType: TeachingPracticeTypeValue,
  role: TeachingPracticeRoleValue
): TraineeSuggestionInputParticipantHistory {
  return { traineeId, trackId, practiceType, role };
}

function run(input: Partial<ComputeTraineeSuggestionsInput> & { groupName: string }): ComputeTraineeSuggestionsResult {
  return computeTeachingPracticeTraineeSuggestions({
    groupName: input.groupName,
    trainees: input.trainees ?? [],
    tracks: input.tracks ?? [],
    trackTrainees: input.trackTrainees ?? [],
    participantHistory: input.participantHistory ?? [],
  });
}

function slot(res: ComputeTraineeSuggestionsResult, trackId: string, rotationOrder: number): TraineeSuggestionRotationSlot {
  const trk = res.tracks.find((t) => t.trackId === trackId);
  assert.ok(trk, `track ${trackId} present in result`);
  const s = trk.slots.find((x) => x.rotationOrder === rotationOrder);
  assert.ok(s, `slot ${rotationOrder} present on track ${trackId}`);
  return s;
}

// 1. Zero-assignment priority: a candidate with categoryCount 0 wins, and the
//    "never assigned this role yet" priority reason is emitted.
test("zero-assignment candidate wins and emits the priority reason", () => {
  const res = run({
    groupName: "א",
    trainees: [trainee("t1", "אבי"), trainee("t2", "בני")],
    tracks: [track("l1", "LUNGE", "10:00", "10:30")],
  });
  const s0 = slot(res, "l1", 0);
  assert.equal(s0.targetBucket, "lungeAny");
  assert.equal(s0.rankingCategory, "lungeAny");
  assert.equal(s0.suggestedTraineeId, "t1"); // Hebrew name tie-break: אבי before בני
  assert.ok(s0.reason.includes("עדיפות כי טרם שובץ"), s0.reason);
  assert.equal(s0.rankedCandidates[0].traineeId, "t1");
  assert.equal(s0.rankedCandidates[0].categoryCount, 0);
  assert.equal(s0.rankedCandidates[0].isRecommended, true);
  assert.equal(s0.rankedCandidates[0].gapMinutes, null); // Infinity -> null (no other windows)
  // The second seat then goes to the other zero-count trainee.
  assert.equal(slot(res, "l1", 1).suggestedTraineeId, "t2");
});

// 2. Private-assistant balancing: a privateAssistant count-0 candidate is
//    preferred over a count>=2 candidate for the assistant (rotationOrder 1)
//    slot.
test("privateAssistant slot prefers a count-0 candidate over a count>=2 candidate", () => {
  const res = run({
    groupName: "א",
    // t1 has 2 realized private-assistant memberships (2 distinct tracks ->
    // deduped-per-track count of 2). t2 has none. t3 fills the lead slot.
    trainees: [trainee("t1", "אבי"), trainee("t2", "בני"), trainee("t3", "גדי")],
    tracks: [track("pt", "BEGINNER_PRIVATE", "10:00", "10:30")],
    trackTrainees: [member("pt", "t3", 0)],
    participantHistory: [
      hist("t1", "hist-p1", "BEGINNER_PRIVATE", "ASSISTANT_INSTRUCTOR"),
      hist("t1", "hist-p2", "BEGINNER_PRIVATE", "ASSISTANT_INSTRUCTOR"),
    ],
  });
  const s1 = slot(res, "pt", 1);
  assert.equal(s1.rankingCategory, "privateAssistant");
  assert.equal(s1.targetBucket, null);
  assert.equal(s1.suggestedTraineeId, "t2");
  assert.equal(s1.rankedCandidates[0].traineeId, "t2");
  assert.equal(s1.rankedCandidates[0].categoryCount, 0);
  const t1Ranked = s1.rankedCandidates.find((c) => c.traineeId === "t1");
  assert.ok(t1Ranked);
  assert.equal(t1Ranked.categoryCount, 2);
  // The lead occupant is hard-excluded as already-on-track.
  assert.ok(s1.excludedCandidates.some((e) => e.traineeId === "t3" && e.category === "already_on_track"));
});

// 3. Current lungeAny folding: a LUNGE LEAD and a LUNGE ASSISTANT both fold
//    into one lungeAny category count; there is no separate LUNGE-assistant
//    balancing category.
// characterization of existing behavior — not desired final behavior; changes in S3
test("LUNGE lead and LUNGE assistant both fold into one lungeAny count", () => {
  const res = run({
    groupName: "א",
    trainees: [trainee("t1", "אבי")],
    participantHistory: [
      hist("t1", "lt1", "LUNGE", "LEAD_INSTRUCTOR"),
      hist("t1", "lt2", "LUNGE", "ASSISTANT_INSTRUCTOR"),
    ],
  });
  const summary = res.traineeSummaries.find((s) => s.traineeId === "t1");
  assert.ok(summary);
  // Both LUNGE roles fold into lungeAny -> count 2, not split across two
  // categories, and there is no distinct lunge-assistant informational field.
  assert.equal(summary.counts.lungeAny, 2);
  assert.equal(summary.counts.privateLead, 0);
  assert.deepEqual(Object.keys(summary.informational).sort(), [
    "beginnerGroupLead",
    "beginnerGroupSecond",
    "evaluator",
    "privateAssistant",
  ]);
});

// 4. Manual-assignment preservation: an already-filled slot is never
//    re-suggested or overwritten - it keeps its "already assigned" outcome.
test("a manually filled slot is preserved and not re-suggested", () => {
  const res = run({
    groupName: "א",
    trainees: [trainee("t1", "אבי"), trainee("t2", "בני")],
    tracks: [track("l1", "LUNGE", "10:00", "10:30")],
    trackTrainees: [member("l1", "t1", 0)],
  });
  const s0 = slot(res, "l1", 0);
  assert.equal(s0.currentTraineeId, "t1");
  assert.equal(s0.suggestedTraineeId, null);
  assert.ok(s0.reason.includes("כבר משובץ"), s0.reason);
  assert.equal(s0.rankedCandidates.length, 0);
  assert.equal(s0.excludedCandidates.length, 0);
});

// 5. Group isolation: running group א returns only group-א tracks and only
//    group-א candidates.
test("running group א returns only group-א tracks and candidates", () => {
  const res = run({
    groupName: "א",
    trainees: [trainee("t1", "אבי", "א"), trainee("t3", "גדי", "א"), trainee("t2", "בני", "ב")],
    tracks: [track("a1", "LUNGE", "10:00", "10:30", "א"), track("b1", "LUNGE", "10:00", "10:30", "ב")],
  });
  assert.deepEqual(
    res.tracks.map((t) => t.trackId),
    ["a1"]
  );
  // t2 (group ב) never appears as a suggestion, current occupant, or candidate.
  const referenced = new Set<string>();
  for (const t of res.tracks) {
    for (const s of t.slots) {
      if (s.suggestedTraineeId) referenced.add(s.suggestedTraineeId);
      if (s.currentTraineeId) referenced.add(s.currentTraineeId);
      for (const e of s.excludedCandidates) referenced.add(e.traineeId);
      for (const c of s.rankedCandidates) referenced.add(c.traineeId);
    }
  }
  assert.equal(referenced.has("t2"), false);
  assert.equal(res.traineeSummaries.some((s) => s.traineeId === "t2"), false);
});

// 6. BEGINNER_PRIVATE / BEGINNER_GROUP parallel-overlap exemption: a trainee on
//    both a private and a group track at overlapping clock times triggers no
//    existing_overlap warning (they are different actual date blocks).
test("private/group overlapping pair triggers no existing_overlap warning", () => {
  const res = run({
    groupName: "א",
    trainees: [trainee("t1", "אבי")],
    tracks: [
      track("pt", "BEGINNER_PRIVATE", "10:00", "10:30", "א", "gt"),
      track("gt", "BEGINNER_GROUP", "10:00", "11:00", "א"),
    ],
    trackTrainees: [member("pt", "t1", 0), member("gt", "t1", 0)],
  });
  assert.equal(res.warnings.some((w) => w.kind === "existing_overlap"), false);
});

// 7a. Genuine overlap detection (candidate hard-exclusion): a candidate already
//     in an overlapping fixed slot is hard-excluded with category "overlap".
test("a genuinely overlapping candidate is hard-excluded with category overlap", () => {
  const res = run({
    groupName: "א",
    trainees: [trainee("t1", "אבי"), trainee("t3", "גדי"), trainee("t2", "בני")],
    tracks: [track("l1", "LUNGE", "10:00", "10:30"), track("l2", "LUNGE", "10:00", "10:30")],
    trackTrainees: [member("l1", "t1", 0), member("l1", "t3", 1)],
  });
  const s0 = slot(res, "l2", 0);
  assert.equal(s0.suggestedTraineeId, "t2"); // only free candidate
  assert.ok(s0.excludedCandidates.some((e) => e.traineeId === "t1" && e.category === "overlap"));
  assert.ok(s0.excludedCandidates.some((e) => e.traineeId === "t3" && e.category === "overlap"));
});

// 7b. Genuine overlap detection (existing_overlap signal): a trainee already
//     assigned to two overlapping same-type tracks yields an existing_overlap
//     warning.
test("a trainee in two overlapping LUNGE tracks yields an existing_overlap warning", () => {
  const res = run({
    groupName: "א",
    trainees: [trainee("t1", "אבי")],
    tracks: [track("l1", "LUNGE", "10:00", "10:30"), track("l2", "LUNGE", "10:00", "10:30")],
    trackTrainees: [member("l1", "t1", 0), member("l2", "t1", 0)],
  });
  assert.ok(res.warnings.some((w) => w.kind === "existing_overlap" && w.traineeId === "t1"));
});

// 8. Stable Hebrew-name tie-breaking within a fixed input order: with all other
//    tiers equal, localeCompare("he") decides, independent of input order.
test("ties break by Hebrew name regardless of input order", () => {
  const res = run({
    groupName: "א",
    // Input order deliberately reversed: בני before אבי.
    trainees: [trainee("t2", "בני"), trainee("t1", "אבי")],
    tracks: [track("l1", "LUNGE", "10:00", "10:30")],
  });
  const s0 = slot(res, "l1", 0);
  assert.equal(s0.suggestedTraineeId, "t1"); // אבי wins despite appearing second
  assert.equal(s0.rankedCandidates[0].traineeId, "t1");
  assert.equal(s0.rankedCandidates[1].traineeId, "t2");
});

// 9. Aggregate supply_below_demand: fewer required empty LUNGE seats than
//    trainees needing a lunge assignment produces the warning.
test("supply_below_demand warns when empty LUNGE seats are fewer than demand", () => {
  const res = run({
    groupName: "א",
    // 4 trainees each need a lunge (starting count 0), but only 2 empty seats.
    trainees: [trainee("t1", "אבי"), trainee("t2", "בני"), trainee("t3", "גדי"), trainee("t4", "דנה")],
    tracks: [track("l1", "LUNGE", "10:00", "10:30")],
  });
  const warning = res.warnings.find((w) => w.kind === "supply_below_demand");
  assert.ok(warning, "supply_below_demand warning present");
  assert.ok(warning.message.includes("(2)"), warning.message); // supply
  assert.ok(warning.message.includes("(4)"), warning.message); // demand
});

// 10. computeTeachingPracticeTraineeSchedule overview for a fixed fixture.
test("computeTeachingPracticeTraineeSchedule reports a trainee's overview", () => {
  const input: ComputeTraineeScheduleInput = {
    groupName: "א",
    trainees: [trainee("t1", "אבי")],
    tracks: [track("l1", "LUNGE", "10:00", "10:30"), track("pt", "BEGINNER_PRIVATE", "11:00", "11:30")],
    trackTrainees: [member("l1", "t1", 0), member("pt", "t1", 0)],
  };
  const res = computeTeachingPracticeTraineeSchedule(input);
  assert.equal(res.groupName, "א");
  assert.equal(res.warnings.length, 0);
  assert.equal(res.trainees.length, 1);
  const row = res.trainees[0];
  assert.equal(row.traineeId, "t1");
  assert.equal(row.totalAssignments, 2);
  assert.deepEqual(row.countByCategory, { lungeAny: 1, privateLead: 1, privateAssistant: 0, beginnerGroup: 0 });
  // Assignments are sorted by start time: LUNGE (10:00) then PRIVATE (11:00).
  assert.equal(row.assignments[0].trackId, "l1");
  assert.equal(row.assignments[0].practiceType, "LUNGE");
  assert.equal(row.assignments[0].nearestGapMinutes, 30);
  assert.equal(row.assignments[1].trackId, "pt");
  assert.equal(row.assignments[1].practiceType, "BEGINNER_PRIVATE");
  assert.equal(row.minGapMinutes, 30);
  assert.equal(row.hasOverlap, false);
});
