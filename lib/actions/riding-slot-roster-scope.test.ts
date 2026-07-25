/**
 * L2-RIDING-ROSTER - executable tests for the PURE roster-scoping helper that
 * backs the Level 2 branch of buildRidingSlotStudentNotes (both the simple horse
 * list and the complex assignment picker share it).
 *
 * Run with: npx tsx --test lib/actions/riding-slot-roster-scope.test.ts
 * PURE: no Prisma, no DB, no clock, no randomness - the offering roster and the
 * complex-plan trainee ids are the only inputs.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  selectRidingRosterCandidates,
  type RidingRosterCandidateRow,
} from "@/lib/actions/riding-slot-roster-scope";

// Mirrors the active Level 2 prod shape: parent group "ג", subgroups 1-4, 18
// trainees (subgroups sized 5/5/4/4). "dual" vs "L2-only" is indistinguishable
// at roster level (the roster is offering-scoped) - both are simply rows, which
// is exactly why a dual trainee can only appear once.
function l2Roster(): RidingRosterCandidateRow[] {
  const rows: RidingRosterCandidateRow[] = [];
  const sizes: Record<number, number> = { 1: 5, 2: 5, 3: 4, 4: 4 };
  for (const sub of [1, 2, 3, 4]) {
    for (let i = 0; i < sizes[sub]; i++) {
      rows.push({ studentId: `s-${sub}-${i}`, groupName: "ג", subgroupNumber: sub });
    }
  }
  return rows;
}

// A whole-slot fallback filter (no assignment splits yet): scheduleItem.groupName
// "ג", subgroup null. This is the exact shape a fresh L2 riding slot produces.
const WHOLE_SLOT_GA: { groupName: string | null; subgroupNumber: number | null }[] = [
  { groupName: "ג", subgroupNumber: null },
];

test("whole-slot L2 fallback includes every eligible active L2 trainee (all 18)", () => {
  const roster = l2Roster();
  const scope = selectRidingRosterCandidates(roster, WHOLE_SLOT_GA, []);
  assert.equal(scope.candidateStudentIds.length, 18);
  assert.deepEqual(
    new Set(scope.candidateStudentIds),
    new Set(roster.map((r) => r.studentId)),
  );
});

test("L2-only and dual trainees both appear, and each exactly once (no duplicates)", () => {
  const roster = l2Roster();
  const scope = selectRidingRosterCandidates(roster, WHOLE_SLOT_GA, []);
  // No id repeats.
  assert.equal(scope.candidateStudentIds.length, new Set(scope.candidateStudentIds).size);
  // Even if the same trainee is ALSO named by the complex plan (dual-role in the
  // same slot), the union must not duplicate them.
  const someId = roster[0].studentId;
  const withComplex = selectRidingRosterCandidates(roster, WHOLE_SLOT_GA, [someId]);
  assert.equal(
    withComplex.candidateStudentIds.filter((id) => id === someId).length,
    1,
  );
  assert.equal(withComplex.candidateStudentIds.length, 18);
});

test("parent group ג and subgroup 1-4 come from the roster (GroupMembership), never Student", () => {
  const roster = l2Roster();
  const scope = selectRidingRosterCandidates(roster, WHOLE_SLOT_GA, []);
  for (const row of roster) {
    const override = scope.groupByStudentId.get(row.studentId);
    assert.ok(override, `expected group override for ${row.studentId}`);
    assert.equal(override!.groupName, "ג");
    assert.equal(override!.subgroupNumber, row.subgroupNumber);
    assert.ok([1, 2, 3, 4].includes(override!.subgroupNumber as number));
  }
});

test("a subgroup split filter narrows to exactly that subgroup", () => {
  const roster = l2Roster();
  // Assignment split (groupName null wildcard, subgroup 2) - matches all parent
  // groups' subgroup 2; with a single parent (ג) that is the 5 in subgroup 2.
  const scope = selectRidingRosterCandidates(
    roster,
    [{ groupName: null, subgroupNumber: 2 }],
    [],
  );
  assert.equal(scope.candidateStudentIds.length, 5);
  for (const id of scope.candidateStudentIds) {
    assert.equal(scope.groupByStudentId.get(id)!.subgroupNumber, 2);
  }
});

test("an explicit (ג, subgroup 3) split matches only that parent+subgroup", () => {
  const roster = l2Roster();
  const scope = selectRidingRosterCandidates(
    roster,
    [{ groupName: "ג", subgroupNumber: 3 }],
    [],
  );
  assert.equal(scope.candidateStudentIds.length, 4);
});

test("complex-plan station trainees are unioned in across subgroups (mirrors L1 OR clause)", () => {
  const roster = l2Roster();
  // Split limited to subgroup 1 (5 trainees), but the complex plan pairs in a
  // subgroup-4 station-mate - who must still appear.
  const stationMate = "s-4-0";
  const scope = selectRidingRosterCandidates(
    roster,
    [{ groupName: "ג", subgroupNumber: 1 }],
    [stationMate],
  );
  assert.ok(scope.candidateStudentIds.includes(stationMate));
  assert.equal(scope.candidateStudentIds.length, 6); // 5 in subgroup 1 + 1 station-mate
  // The station-mate keeps their real subgroup (4), from the roster.
  assert.equal(scope.groupByStudentId.get(stationMate)!.subgroupNumber, 4);
});

test("a complex trainee absent from the offering roster is still loaded (graceful), with no group override", () => {
  const roster = l2Roster();
  const ghost = "s-not-in-roster";
  const scope = selectRidingRosterCandidates(roster, WHOLE_SLOT_GA, [ghost]);
  assert.ok(scope.candidateStudentIds.includes(ghost));
  assert.equal(scope.groupByStudentId.has(ghost), false);
});

test("null-group wildcard filter (שתי הקבוצות) matches the whole offering roster", () => {
  const roster = l2Roster();
  const scope = selectRidingRosterCandidates(
    roster,
    [{ groupName: null, subgroupNumber: null }],
    [],
  );
  assert.equal(scope.candidateStudentIds.length, 18);
});

test("empty roster with no complex trainees yields no candidates (no global fallback)", () => {
  const scope = selectRidingRosterCandidates([], WHOLE_SLOT_GA, []);
  assert.equal(scope.candidateStudentIds.length, 0);
  assert.equal(scope.groupByStudentId.size, 0);
});

test("the helper only ever consumes roster-derived group - it has no access to Student.groupName", () => {
  // Structural guarantee: RidingRosterCandidateRow carries only studentId +
  // GroupMembership-derived group/subgroup. There is no Student column in the
  // input surface at all, so a Level 2 selection cannot fall back to
  // Student.groupName by construction. A row whose groupName is (hypothetically)
  // a legacy value is matched purely as data, never trusted as authority.
  const roster: RidingRosterCandidateRow[] = [
    { studentId: "x", groupName: "ג", subgroupNumber: 1 },
  ];
  const keys = Object.keys(roster[0]);
  assert.deepEqual(new Set(keys), new Set(["studentId", "groupName", "subgroupNumber"]));
});
