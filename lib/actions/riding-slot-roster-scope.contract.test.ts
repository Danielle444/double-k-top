// DB-free CONTRACT/source test for the L2-RIDING-ROSTER offering-aware branch in
// buildRidingSlotStudentNotes (lib/actions/riding-slots.ts). It runs no Prisma
// and opens no DB: it statically inspects the reader's source and asserts the
// approved invariants, so a future refactor cannot silently regress the Level 1
// path, re-introduce an N+1, mutate Student, or trust Student.groupName for
// Level 2.
//
// Run: npx tsx --test lib/actions/riding-slot-roster-scope.contract.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const rawSrc = readFileSync(fileURLToPath(new URL("./riding-slots.ts", import.meta.url)), "utf8");
const src = stripComments(rawSrc);

// The reader body: from its declaration to the next top-level declaration.
function readerRegion(): string {
  const start = src.indexOf("async function buildRidingSlotStudentNotes");
  assert.ok(start > -1, "buildRidingSlotStudentNotes not found");
  const end = src.indexOf("export async function getRidingSlotStudentNotes", start);
  assert.ok(end > start, "reader end marker not found");
  return src.slice(start, end);
}

const reader = readerRegion();

test("offering + level are resolved from the slot's server-owned spine (RidingSlot -> ScheduleItem -> WeeklySchedule -> CourseOffering)", () => {
  assert.match(reader, /weeklySchedule:\s*\{[\s\S]*courseOfferingId:\s*true/);
  assert.match(reader, /courseOffering:\s*\{\s*select:\s*\{\s*level:\s*true/);
  assert.match(reader, /slot\.scheduleItem\.weeklySchedule\?\.courseOfferingId/);
  assert.match(reader, /slot\.scheduleItem\.weeklySchedule\?\.courseOffering\?\.level/);
});

test("the course-roster branch is gated on a resolved offering AND level >= 2 (Level 1 / offering-null never enters it)", () => {
  assert.match(
    reader,
    /useCourseRoster\s*=\s*courseOfferingId\s*!==\s*null\s*&&\s*offeringLevel\s*!==\s*null\s*&&\s*offeringLevel\s*>=\s*2/,
  );
  assert.match(reader, /if\s*\(useCourseRoster\)/);
});

test("Level 1 path is preserved byte-for-byte in the else branch (Student.groupName OR-query, unchanged)", () => {
  // The original global Student.groupName OR-query must still exist, and must be
  // the ELSE of the useCourseRoster branch (so Level 1 behaviour is untouched).
  const elseIdx = reader.indexOf("} else {");
  assert.ok(elseIdx > -1, "expected an else branch for the Level 1 path");
  const elseBranch = reader.slice(elseIdx);
  assert.match(elseBranch, /prisma\.student\.findMany/);
  assert.match(elseBranch, /f\.groupName\s*!==\s*null\s*\?\s*\{\s*groupName:\s*f\.groupName\s*\}/);
  assert.match(elseBranch, /f\.subgroupNumber\s*!==\s*null\s*\?\s*\{\s*subgroupNumber:\s*f\.subgroupNumber\s*\}/);
  assert.match(elseBranch, /complexTraineeIds\.length\s*>\s*0\s*\?\s*\[\{\s*id:\s*\{\s*in:\s*complexTraineeIds\s*\}\s*\}\]/);
});

test("Level 2 scopes candidates from the offering roster, resolved AS-OF the ScheduleItem date", () => {
  assert.match(reader, /getCurrentCourseEnrollmentRoster\(\s*courseOfferingId,\s*\{\s*asOf:\s*slot\.scheduleItem\.date/);
  assert.match(reader, /selectRidingRosterCandidates\(/);
});

test("Level 2 selection never queries or trusts Student.groupName as authority", () => {
  // Inside the useCourseRoster branch, the Student read is BY ID ONLY (the
  // roster decided membership) - the student QUERY carries no groupName/
  // subgroupNumber predicate. (The roster.rows.map above legitimately reads the
  // GroupMembership-derived r.groupName/r.subgroupNumber - that is the spine, not
  // Student.) So the check is scoped to the Student query substring only.
  const ifIdx = reader.indexOf("if (useCourseRoster)");
  const elseIdx = reader.indexOf("} else {", ifIdx);
  const l2Branch = reader.slice(ifIdx, elseIdx);
  const studentQueryIdx = l2Branch.indexOf("prisma.student.findMany");
  assert.ok(studentQueryIdx > -1, "expected a Student read in the L2 branch");
  const studentQuery = l2Branch.slice(studentQueryIdx);
  assert.match(studentQuery, /where:\s*\{\s*id:\s*\{\s*in:\s*scope\.candidateStudentIds\s*\},\s*isActive:\s*true\s*\}/);
  assert.doesNotMatch(studentQuery, /groupName:/);
  assert.doesNotMatch(studentQuery, /subgroupNumber:/);
});

test("Level 2 rows expose the GroupMembership-derived group/subgroup override, never the Student columns", () => {
  assert.match(reader, /groupOverride\s*\?\s*groupOverride\.groupName\s*:\s*s\.groupName/);
  assert.match(reader, /groupOverride\s*\?\s*groupOverride\.subgroupNumber\s*:\s*s\.subgroupNumber/);
});

test("no N+1: exactly one roster read + one Student IN read in the L2 branch + one shared attendance read (no per-row query)", () => {
  const ifIdx = reader.indexOf("if (useCourseRoster)");
  const elseIdx = reader.indexOf("} else {", ifIdx);
  const l2Branch = reader.slice(ifIdx, elseIdx);
  assert.equal((l2Branch.match(/getCurrentCourseEnrollmentRoster\(/g) ?? []).length, 1);
  assert.equal((l2Branch.match(/prisma\.student\.findMany/g) ?? []).length, 1);
  // The Student read is a single batched IN, never a .map/loop of per-id queries.
  assert.match(l2Branch, /id:\s*\{\s*in:\s*scope\.candidateStudentIds\s*\}/);
  // Attendance stays a single batched IN over the resolved students (shared by
  // both branches, unchanged).
  assert.match(reader, /studentAttendance\.findMany\(\{\s*where:\s*\{\s*date:[\s\S]*studentId:\s*\{\s*in:\s*students\.map/);
});

test("the reader performs NO mutation (read-only): no create/update/upsert/delete of Student, horse, group, or enrollment", () => {
  assert.doesNotMatch(reader, /\.(update|updateMany|create|createMany|upsert|delete|deleteMany)\(/);
  assert.doesNotMatch(reader, /assignedHorseName:\s*[^,\n]*=/); // no assignment to horse fields
});
