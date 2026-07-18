/**
 * Characterization tests for the pure Teaching Practice fixed-structure check
 * (lib/teaching-practice-fixed-structure-check.ts). These pin down the CURRENT
 * set of issue kinds/severities checkTeachingPracticeFixedStructure emits (and
 * a couple it deliberately does NOT) against fixed, plain-data fixtures; they
 * are not aspirational and encode no desired future S4 behavior.
 *
 * Uses the existing `tsx` runner with Node built-ins `node:test` and
 * `node:assert/strict`. No test framework is installed. Run with:
 *   npx tsx --test lib/teaching-practice-fixed-structure-check.test.ts
 *
 * Pure: no Prisma, no DB, no Next.js runtime, no clock, plain-data fixtures.
 * All createdAt values are fixed literals (never Date.now()).
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  checkTeachingPracticeFixedStructure,
  type CheckTeachingPracticeFixedStructureInput,
  type FixedStructureCheckTrack,
  type FixedStructureCheckTrainee,
  type FixedStructureCheckChild,
  type TeachingPracticeFixedStructureIssue,
  type TeachingPracticeFixedStructureCheckResult,
} from "./teaching-practice-fixed-structure-check";
import type { TeachingPracticeTypeValue } from "./teaching-practice-rotation";

const FIXED_CREATED_AT = new Date("2020-01-01T00:00:00.000Z");

function member(
  traineeId: string,
  rotationOrder: number,
  opts: { fullName?: string; isActive?: boolean; studentGroupName?: string | null } = {}
): FixedStructureCheckTrainee {
  return {
    traineeId,
    fullName: opts.fullName ?? traineeId,
    rotationOrder,
    isActive: opts.isActive ?? true,
    studentGroupName: opts.studentGroupName === undefined ? "א" : opts.studentGroupName,
  };
}

function child(childId: string | null, opts: { isActive?: boolean; fullName?: string | null } = {}): FixedStructureCheckChild {
  return {
    childId,
    isActive: opts.isActive ?? true,
    fullName: opts.fullName ?? (childId ? childId : null),
  };
}

function track(
  trackId: string,
  practiceType: TeachingPracticeTypeValue,
  opts: {
    start?: string;
    end?: string;
    groupName?: string | null;
    groupTrackId?: string | null;
    trainees?: FixedStructureCheckTrainee[];
    children?: FixedStructureCheckChild[];
    createdAt?: Date;
  } = {}
): FixedStructureCheckTrack {
  return {
    trackId,
    practiceType,
    groupName: opts.groupName === undefined ? "א" : opts.groupName,
    defaultStartTime: opts.start ?? "10:00",
    defaultEndTime: opts.end ?? "10:30",
    createdAt: opts.createdAt ?? FIXED_CREATED_AT,
    groupTrackId: opts.groupTrackId ?? null,
    trainees: opts.trainees ?? [],
    children: opts.children ?? [child("dummy-child")],
  };
}

function check(tracks: FixedStructureCheckTrack[], groupName = "א"): TeachingPracticeFixedStructureCheckResult {
  const input: CheckTeachingPracticeFixedStructureInput = { groupName, tracks };
  return checkTeachingPracticeFixedStructure(input);
}

function allIssues(res: TeachingPracticeFixedStructureCheckResult): TeachingPracticeFixedStructureIssue[] {
  return [...res.errors, ...res.warnings, ...res.info];
}

function hasKind(res: TeachingPracticeFixedStructureCheckResult, kind: string): boolean {
  return allIssues(res).some((i) => i.kind === kind);
}

function issueOfKind(
  res: TeachingPracticeFixedStructureCheckResult,
  kind: string
): TeachingPracticeFixedStructureIssue | undefined {
  return allIssues(res).find((i) => i.kind === kind);
}

// 1. missing_required_slot (error) - LUNGE track with fewer than 2 trainees.
test("missing_required_slot is an error when a LUNGE track is under-staffed", () => {
  const res = check([track("l1", "LUNGE", { trainees: [member("t1", 0)] })]);
  const issue = issueOfKind(res, "missing_required_slot");
  assert.ok(issue);
  assert.equal(issue.severity, "error");
});

// 2. duplicate_trainee_lunge (error) - same trainee across two LUNGE tracks.
test("duplicate_trainee_lunge is an error when a trainee is in two LUNGE tracks", () => {
  const res = check([
    track("l1", "LUNGE", { start: "10:00", end: "10:30", trainees: [member("t1", 0), member("t2", 1)] }),
    track("l2", "LUNGE", { start: "11:00", end: "11:30", trainees: [member("t1", 0), member("t3", 1)] }),
  ]);
  const issue = issueOfKind(res, "duplicate_trainee_lunge");
  assert.ok(issue);
  assert.equal(issue.severity, "error");
  assert.equal(issue.traineeId, "t1");
});

// 3. duplicate_trainee_private_required (error) - same trainee as private lead
//    (rotationOrder 0) in two BEGINNER_PRIVATE tracks.
test("duplicate_trainee_private_required is an error for a repeated private lead", () => {
  const res = check([
    track("p1", "BEGINNER_PRIVATE", { start: "10:00", end: "10:30", trainees: [member("t1", 0)] }),
    track("p2", "BEGINNER_PRIVATE", { start: "11:00", end: "11:30", trainees: [member("t1", 0)] }),
  ]);
  assert.ok(hasKind(res, "duplicate_trainee_private_required"));
  assert.equal(issueOfKind(res, "duplicate_trainee_private_required")!.severity, "error");
});

// 4. duplicate_trainee_group_required (error) - same trainee as group lead in
//    two BEGINNER_GROUP tracks.
test("duplicate_trainee_group_required is an error for a repeated group lead", () => {
  const res = check([
    track("g1", "BEGINNER_GROUP", { start: "10:00", end: "11:00", trainees: [member("t1", 0)] }),
    track("g2", "BEGINNER_GROUP", { start: "12:00", end: "13:00", trainees: [member("t1", 0)] }),
  ]);
  assert.ok(hasKind(res, "duplicate_trainee_group_required"));
  assert.equal(issueOfKind(res, "duplicate_trainee_group_required")!.severity, "error");
});

// 5. overlap_required_required (error) - a trainee in two overlapping required
//    (LUNGE) slots.
test("overlap_required_required is an error for two overlapping required slots", () => {
  const res = check([
    track("l1", "LUNGE", { start: "10:00", end: "10:30", trainees: [member("t1", 0)] }),
    track("l2", "LUNGE", { start: "10:00", end: "10:30", trainees: [member("t1", 0)] }),
  ]);
  assert.ok(hasKind(res, "overlap_required_required"));
  assert.equal(issueOfKind(res, "overlap_required_required")!.severity, "error");
});

// 6. BEGINNER_PRIVATE / BEGINNER_GROUP overlap exemption - a trainee on both an
//    overlapping private and group track produces no overlap issue at all.
test("private/group overlap is exempt (no overlap_required_required, no overlap_informational)", () => {
  const res = check([
    track("pt", "BEGINNER_PRIVATE", { start: "10:00", end: "10:30", groupTrackId: "gt", trainees: [member("t1", 0)] }),
    track("gt", "BEGINNER_GROUP", { start: "10:00", end: "11:00", trainees: [member("t1", 0)] }),
  ]);
  assert.equal(hasKind(res, "overlap_required_required"), false);
  assert.equal(hasKind(res, "overlap_informational"), false);
});

// 7. group_mismatch (error) - a trainee whose own group differs from the track
//    group.
test("group_mismatch is an error when a trainee belongs to another group", () => {
  const res = check([
    track("l1", "LUNGE", {
      trainees: [member("t1", 0, { studentGroupName: "ב" }), member("t2", 1, { studentGroupName: "א" })],
    }),
  ]);
  const issue = issueOfKind(res, "group_mismatch");
  assert.ok(issue);
  assert.equal(issue.severity, "error");
  assert.equal(issue.traineeId, "t1");
});

// 8. inactive_trainee (error) - a non-active trainee on an active track.
test("inactive_trainee is an error for an inactive trainee on a track", () => {
  const res = check([
    track("l1", "LUNGE", { trainees: [member("t1", 0), member("t2", 1, { isActive: false })] }),
  ]);
  const issue = issueOfKind(res, "inactive_trainee");
  assert.ok(issue);
  assert.equal(issue.severity, "error");
  assert.equal(issue.traineeId, "t2");
});

// 9. duplicate_child_in_track (error) - the same child twice on one track.
test("duplicate_child_in_track is an error when a child appears twice on a track", () => {
  const res = check([
    track("l1", "LUNGE", {
      trainees: [member("t1", 0), member("t2", 1)],
      children: [child("c1"), child("c1")],
    }),
  ]);
  const issue = issueOfKind(res, "duplicate_child_in_track");
  assert.ok(issue);
  assert.equal(issue.severity, "error");
  assert.equal(issue.childId, "c1");
});

// 10. duplicate_child_across_group (error) - the same child on two unrelated
//     tracks (not a linked private/group pair).
test("duplicate_child_across_group is an error for a child on two unrelated tracks", () => {
  const res = check([
    track("l1", "LUNGE", { start: "10:00", end: "10:30", trainees: [member("t1", 0), member("t2", 1)], children: [child("c1")] }),
    track("l2", "LUNGE", { start: "11:00", end: "11:30", trainees: [member("t3", 0), member("t4", 1)], children: [child("c1")] }),
  ]);
  assert.ok(hasKind(res, "duplicate_child_across_group"));
  assert.equal(issueOfKind(res, "duplicate_child_across_group")!.severity, "error");
});

// 11. Linked beginner-pair child exemption - a child shared between a private
//     track and its OWN linked group track is not flagged as a duplicate.
test("a child shared by a linked private/group pair is not a duplicate_child_across_group", () => {
  const res = check([
    track("pt", "BEGINNER_PRIVATE", { start: "10:00", end: "10:30", groupTrackId: "gt", trainees: [member("t1", 0)], children: [child("c1")] }),
    track("gt", "BEGINNER_GROUP", { start: "10:00", end: "11:00", trainees: [member("t2", 0)], children: [child("c1")] }),
  ]);
  assert.equal(hasKind(res, "duplicate_child_across_group"), false);
});

// 12. missing_secondary_slot (info) - a private track with a lead but no
//     assistant (rotationOrder 1).
test("missing_secondary_slot is info when a private track has a lead but no assistant", () => {
  const res = check([track("pt", "BEGINNER_PRIVATE", { trainees: [member("t1", 0)] })]);
  const issue = issueOfKind(res, "missing_secondary_slot");
  assert.ok(issue);
  assert.equal(issue.severity, "info");
  // ... and the required lead slot IS present, so no missing_required_slot here.
  assert.equal(hasKind(res, "missing_required_slot"), false);
});

// 13. no_children_assigned (info) - a track with no real children.
test("no_children_assigned is info for a track with no children", () => {
  const res = check([track("l1", "LUNGE", { trainees: [member("t1", 0), member("t2", 1)], children: [] })]);
  const issue = issueOfKind(res, "no_children_assigned");
  assert.ok(issue);
  assert.equal(issue.severity, "info");
});

// 14. overlap_informational (warning) - a trainee in a required slot and a
//     non-required slot that overlap (LUNGE vs private assistant).
test("overlap_informational is a warning for a required/non-required overlap", () => {
  const res = check([
    track("l1", "LUNGE", { start: "10:00", end: "10:30", trainees: [member("t1", 0), member("t2", 1)] }),
    track("pt", "BEGINNER_PRIVATE", { start: "10:00", end: "10:30", trainees: [member("t3", 0), member("t1", 1)] }),
  ]);
  const issue = issueOfKind(res, "overlap_informational");
  assert.ok(issue);
  assert.equal(issue.severity, "warning");
  assert.equal(hasKind(res, "overlap_required_required"), false);
});

// 15. roster-drift warning (warning) - the persisted group roster differs from
//     the roster currently derivable from the linked private tracks.
test("beginner_group_roster_drift is a warning when persisted differs from derived", () => {
  const res = check([
    track("gt", "BEGINNER_GROUP", { start: "09:00", end: "10:00", trainees: [] }),
    track("p1", "BEGINNER_PRIVATE", { start: "10:00", end: "10:30", groupTrackId: "gt", trainees: [member("t1", 0)] }),
    track("p2", "BEGINNER_PRIVATE", { start: "11:00", end: "11:30", groupTrackId: "gt", trainees: [member("t2", 0)] }),
    track("p3", "BEGINNER_PRIVATE", { start: "12:00", end: "12:30", groupTrackId: "gt", trainees: [member("t3", 0)] }),
  ]);
  const issue = issueOfKind(res, "beginner_group_roster_drift");
  assert.ok(issue);
  assert.equal(issue.severity, "warning");
});

// 16. Current absence of a named per-trainee missing-LUNGE warning: a trainee
//     with no LUNGE assignment produces no such issue today.
// characterization of existing behavior — not desired final behavior; changes in S4
test("no per-trainee missing-LUNGE warning is emitted today", () => {
  const res = check([
    track("pt", "BEGINNER_PRIVATE", { trainees: [member("t1", 0), member("t2", 1)] }),
  ]);
  const kinds = new Set(allIssues(res).map((i) => i.kind));
  // No issue kind expresses "this trainee has no lunge assignment".
  assert.equal(kinds.has("trainee_missing_lunge"), false);
  assert.equal(kinds.has("missing_lunge_for_trainee"), false);
  assert.equal(
    allIssues(res).some((i) => /lunge/i.test(i.kind) && i.traineeId != null),
    false
  );
});

// 17. Summary counts reflect the emitted issues (error/warning/info buckets).
test("summary counts match the emitted error/warning/info issue lists", () => {
  const res = check([track("l1", "LUNGE", { trainees: [member("t1", 0)], children: [] })]);
  assert.equal(res.summary.errorCount, res.errors.length);
  assert.equal(res.summary.warningCount, res.warnings.length);
  assert.equal(res.summary.infoCount, res.info.length);
  assert.equal(res.summary.tracksChecked, 1);
  // Under-staffed LUNGE -> missing_required_slot (error); no children ->
  // no_children_assigned (info).
  assert.ok(hasKind(res, "missing_required_slot"));
  assert.ok(hasKind(res, "no_children_assigned"));
});
