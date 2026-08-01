/**
 * EXAM EX-ADMIN-WORKSPACE-UX — the structural suite of the workspace edit/move IO
 * binding.
 *
 * The binding is the layer that HOLDS the database client, the admin boundary and
 * the course-lifecycle policy, so it cannot be driven with fakes the way its pure
 * core can. What is provable without a database is its SHAPE, and that is what
 * this suite proves: which statements exist, what they are scoped by, which
 * columns they select and write, which gate they use, and what they must never
 * become.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const IO_REL = join("lib", "actions", "admin-exam-workspace-edit-io.ts");
const SUITE_REL = join("lib", "actions", "admin-exam-workspace-edit-io.test.ts");

const RAW = readFileSync(join(REPO_ROOT, IO_REL), "utf8");

/** Strip comments, so every guard sweeps CODE and never the prose beside it. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const CODE = stripComments(RAW);

// ===========================================================================
// 1. It is a server-only module, and NOT a Server Action module
// ===========================================================================

test("1. the first statement declares the module server-only", () => {
  const firstStatement = CODE.split("\n").find((line) => line.trim().length > 0);
  assert.ok(firstStatement);
  assert.ok(
    new RegExp('import\\s+"server' + '-only";').test(firstStatement),
    `the binding's first statement is: ${firstStatement}`,
  );
});

test("2. it is NOT a Server Action module — nothing here has a network id", () => {
  assert.equal(CODE.includes('"use ' + 'server"'), false);
  assert.equal(CODE.includes('"use ' + 'client"'), false);
});

test("3. it exports EXACTLY the three operations, and no fourth", () => {
  // RE-POINTED from two to THREE by the ATOMIC REPLACEMENT. Replacing the ONE
  // instructed trainee an examinee teaches cannot be composed out of the other
  // two without committing an unpaired state between them, so it is its own
  // operation. A FOURTH export still fails here.
  const exported = [...CODE.matchAll(/export (?:async )?function (\w+)\(/g)].map(([, n]) => n);
  assert.deepEqual(
    exported.sort(),
    [
      "moveExamAssignment",
      "set" + "ExamExamineeInstructedTrainee",
      "updateExamAssignmentDetails",
    ].sort(),
  );
});

// ===========================================================================
// 2. The trust boundary and the gate
// ===========================================================================

test("4. the admin + exact-offering boundary is the FIRST thing every operation depends on", () => {
  assert.ok(CODE.includes("requireAdminCourseOffering("));
  // ONE boundary helper, shared by both operations, so the two cannot drift.
  assert.equal(
    (CODE.match(/function requireCourseContext\(/g) ?? []).length,
    1,
    "the boundary is declared more than once",
  );
  assert.equal(
    (CODE.match(/requireAdminCourseOffering\(/g) ?? []).length,
    1,
    "the boundary is reached from more than one place",
  );
  // Only the VERIFIED id and status leave it.
  assert.ok(CODE.includes("courseOfferingId: context.id"));
  assert.ok(CODE.includes("status: context.status"));
});

test("5. the lifecycle gate is the WRITE gate, and the READ gate is absent", () => {
  assert.ok(CODE.includes("SCHEDULE_DRAFT_CONFIGURATION"));
  assert.equal(
    CODE.includes("HISTORICAL_READ"),
    false,
    "an exam WRITE may not gate on the read operation",
  );
  assert.equal(
    (CODE.match(/assertCourseOperationAllowed\(/g) ?? []).length,
    1,
    "the gate is asserted from more than one place",
  );
});

test("6. exactly two failures are classified, and the ONE catch swallows nothing", () => {
  assert.ok(CODE.includes("error instanceof CourseOfferingNotFoundError"));
  assert.ok(CODE.includes("error instanceof CourseOperationNotPermittedError"));
  // RE-POINTED by the ATOMIC REPLACEMENT, and NARROWED rather than relaxed. The
  // replacement's transaction reports a lost race by throwing a sentinel of its
  // own, because that is the only way to abort a transaction, so the module now
  // has exactly ONE catch. It is still forbidden to swallow anything: the catch
  // converts that private sentinel and RE-THROWS everything else, which is what
  // the outright ban existed to protect.
  assert.equal((CODE.match(/\bcatch\s*\(/g) ?? []).length, 1, "the binding catches twice");
  const clause = CODE.slice(CODE.indexOf("} catch (error) {"));
  assert.ok(
    clause.includes("if (error instanceof ExamReplacementConditionFailed) return false;"),
    "the catch classifies something other than its own sentinel",
  );
  assert.ok(clause.includes("throw error;"), "the catch does not re-throw");
});

test("7. no capability, no notification, no publication and no policy edit", () => {
  for (const token of [
    "capabilit",
    "Capabilit",
    "notification",
    "Notification",
    "publish",
    "publishedAt",
    "revalidate",
    "redirect",
  ]) {
    assert.equal(CODE.includes(token), false, `the binding reaches ${token}`);
  }
});

// ===========================================================================
// 3. The statements
// ===========================================================================

test("8. the plan is resolved from the VERIFIED offering, and never upserted", () => {
  assert.ok(CODE.includes("prisma.examPlan.findUnique("));
  assert.ok(CODE.includes("where: { courseOfferingId: verifiedCourseOfferingId }"));
  assert.ok(CODE.includes("select: { id: true }"));
  assert.equal(CODE.includes("examPlan.upsert"), false);
  assert.equal(CODE.includes("examPlan.create"), false);
});

test("9. every assignment read is PLAN-SCOPED through the session relation", () => {
  // RE-POINTED from two to THREE by the ATOMIC REPLACEMENT: it reads the examinee
  // row it is asked about. The RULE is unchanged and still applies to every read —
  // each one is scoped through the session's plan, never by primary key alone.
  const reads = CODE.match(/prisma\.examAssignment\.findFirst\(\{[\s\S]*?\}\);/g) ?? [];
  assert.equal(reads.length, 3, "there must be exactly three plan-scoped assignment reads");
  for (const read of reads) {
    assert.ok(
      read.includes("session: { planId }"),
      "an assignment read is not scoped by the plan",
    );
  }
  // Never by primary key alone, which would find a row of another course and then
  // rely on a comparison somebody could later delete.
  assert.equal(CODE.includes("examAssignment.findUnique("), false);
});

test("10. the EDIT writes EXACTLY the three detail columns, on the id the read returned", () => {
  const update = CODE.slice(CODE.indexOf("prisma.examAssignment.update("));
  const data = update.slice(update.indexOf("data: {"), update.indexOf("select: { id: true }"));
  for (const column of ["horseName", "instructionTopic", "discipline"]) {
    assert.ok(data.includes(`${column}:`), `${column} is not written`);
  }
  for (const column of [
    "sessionId",
    "studentId",
    "role",
    "orderIndex",
    "pairingIndex",
    "sourcePracticeRole",
    "notes",
    "updatedAt",
    "createdAt",
  ]) {
    assert.equal(data.includes(`${column}:`), false, `the edit writes ${column}`);
  }
  assert.ok(update.includes("where: { id: assignmentId }"));
});

test("11. the EDIT reads the DEFINITION requirements rather than trusting a submission", () => {
  assert.ok(CODE.includes("requiresLessonTopic: true"));
  assert.ok(CODE.includes("requiresDiscipline: true"));
  assert.ok(CODE.includes("row.session.definition.requiresLessonTopic"));
  assert.ok(CODE.includes("row.session.definition.requiresDiscipline"));
});

test("12. the EDIT never reads a Student column", () => {
  const read = CODE.slice(
    CODE.indexOf("async function findAssignmentForPlan"),
    CODE.indexOf("async function updateAssignmentDetails"),
  );
  for (const token of ["student:", "studentId", "fullName", "phone", "identity"]) {
    assert.equal(read.includes(token), false, `the edit read selects ${token}`);
  }
});

test("13. the MOVE reads a session's rows in the reader's OWN total order", () => {
  const list = CODE.slice(
    CODE.indexOf("async function listSessionAssignmentsInOrder"),
    CODE.indexOf("async function renumberSessionAssignments"),
  );
  assert.ok(list.includes('orderBy: [{ orderIndex: "asc" }, { id: "asc" }]'));
  assert.ok(list.includes("select: { id: true, role: true }"));
  // A permutation needs identity and eligibility, and nothing else.
  for (const token of ["horseName", "instructionTopic", "discipline", "pairingIndex", "student"]) {
    assert.equal(list.includes(token), false, `the move read selects ${token}`);
  }
});

test("14. the renumbering is ONE transaction, one column, scoped by session AND id", () => {
  const renumber = CODE.slice(CODE.indexOf("async function renumberSessionAssignments"));
  assert.ok(renumber.includes("prisma.$transaction("));
  assert.ok(renumber.includes("where: { id: assignmentId, sessionId }"));
  assert.ok(renumber.includes("data: { orderIndex: position }"));
  // A raw index shift would leave a partially renumbered session reachable.
  assert.equal(renumber.includes("increment"), false);
  assert.equal(renumber.includes("decrement"), false);
});

test("15. no delete, no create and no other model is ever written", () => {
  for (const token of [
    "examAssignment.delete",
    "examAssignment.deleteMany",
    "examAssignment.create",
    "examAssignment.createMany",
    "examAssignment.upsert",
    "examSession.update",
    "examDefinition.update",
    "examPlan.update",
    "student.update",
    "$executeRaw",
    "$queryRaw",
  ]) {
    assert.equal(CODE.includes(token), false, `the binding reaches ${token}`);
  }
});

test("16. exactly two write statements exist in the whole module", () => {
  const writes = CODE.match(/prisma\.examAssignment\.(update|updateMany)\(/g) ?? [];
  assert.deepEqual(writes.sort(), [
    "prisma.examAssignment.update(",
    "prisma.examAssignment.updateMany(",
  ]);
});

// ===========================================================================
// 4. The division of labour
// ===========================================================================

test("17. the decision ORDER belongs to the pure core, not to this binding", () => {
  // The binding supplies effects and delegates; it restates no rule of its own.
  assert.ok(CODE.includes("updateExamAssignmentDetailsWithDeps("));
  assert.ok(CODE.includes("moveExamAssignmentWithDeps("));
  for (const token of [
    "role_not_editable",
    "lesson_topic_required",
    "discipline_required",
    "assignment_not_found",
    "role_not_movable",
    "invalid_input",
  ]) {
    assert.equal(CODE.includes(token), false, `the binding invents the outcome ${token}`);
  }
});

test("18. the slice adds no schema and no migration", () => {
  const schema = readFileSync(join(REPO_ROOT, "prisma", "schema.prisma"), "utf8");
  assert.ok(schema.includes("model ExamAssignment"));
  // The three edited columns and the position column already exist.
  for (const column of ["horseName", "instructionTopic", "discipline", "orderIndex"]) {
    assert.ok(schema.includes(column), `${column} is not a stored column`);
  }
});

test("19. this suite opens no database and reads no environment", () => {
  const own = stripComments(readFileSync(join(REPO_ROOT, SUITE_REL), "utf8"));
  for (const token of ["@/lib/" + "prisma", "Prisma" + "Client", "DATABASE" + "_URL"]) {
    assert.equal(own.includes(token), false, `the suite references ${token}`);
  }
});
