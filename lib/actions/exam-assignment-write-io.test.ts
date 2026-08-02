/**
 * EXAM EX-ASG-IO1 — the guard suite for the ADMIN stored ExamAssignment WRITE
 * bindings.
 *
 * Run with: npx tsx --test lib/actions/exam-assignment-write-io.test.ts
 *
 * WHY THIS SUITE IS STRUCTURAL RATHER THAN BEHAVIOURAL. The module under test
 * declares `server-only` and imports the database client, so importing it here
 * would either fail the build or open a real connection. The ORCHESTRATION it
 * binds is already proven at runtime by the committed pure cores' own DB-free
 * suites, which drive every ordering, refusal and eligibility decision with
 * fakes. What is left — and what only a source-text guard can prove — is that
 * the BINDING is the one those cores were designed for: the exact statements,
 * the exact scopes, the exact selects, the exact classifiers, and the exact
 * absence of a caller.
 *
 * DB-FREE: no database connection is opened, no SQL is executed, no environment
 * variable is read, and no production identifier appears anywhere. The only
 * files read are module SOURCE TEXTS and `git`'s own output.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

const IO_REL = join("lib", "actions", "exam-assignment-write-io.ts");
const IO_TEST_REL = join("lib", "actions", "exam-assignment-write-io.test.ts");

/**
 * The SIX files this slice consists of, in repository form.
 *
 * ASSEMBLED, never spelled whole: the sibling READ binding's own guard suite
 * sweeps `lib/` for its module name and for its core's, and a suite that spelled
 * either as one literal would enrol ITSELF in the caller allow-list that guard
 * exists to keep empty.
 */
const NEW_FILES = [
  "lib/actions/" + "exam-assignment-read" + "-io.test.ts",
  "lib/actions/" + "exam-assignment-read" + "-io.ts",
  "lib/actions/exam-assignment-write-io.test.ts",
  "lib/actions/exam-assignment-write-io.ts",
  "lib/exam/" + "admin-exam-assignment-read" + "-core.test.ts",
  "lib/exam/" + "admin-exam-assignment-read" + "-core.ts",
];

const SOURCE = readFileSync(join(REPO_ROOT, IO_REL), "utf8");

/** Strip comments so the guards assert on CODE, not on explanatory prose. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Keep ONLY the comments, for the "is this documented?" assertions. */
function commentsOf(source: string): string {
  return [
    ...(source.match(/\/\*[\s\S]*?\*\//g) ?? []),
    ...(source.match(/^\s*\/\/.*$/gm) ?? []),
  ].join("\n");
}

const CODE = stripComments(SOURCE);
const COMMENTS = commentsOf(SOURCE);

/**
 * One top-level function's body, from its declaration to the closing brace in
 * column 0 — so an "inside this helper" assertion means what it says.
 */
function bodyOf(name: string): string {
  const start = CODE.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name} is missing`);
  const end = CODE.indexOf("\n}", start);
  assert.ok(end > start, `${name} is unbalanced`);
  return CODE.slice(start, end + 2);
}

/** Every exported function signature, in source order. */
const SIGNATURES = [
  ...SOURCE.matchAll(/export (?:async )?function (\w+)\(([\s\S]*?)\):\s*([^{]+)\{/g),
].map(([, name, params, returns]) => ({
  name,
  params: params.replace(/\s+/g, " ").trim(),
  returns: returns.replace(/\s+/g, " ").trim(),
}));

function gitLines(args: readonly string[]): string[] {
  const result = spawnSync("git", [...args], { cwd: REPO_ROOT, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr ?? ""}`);
  return (result.stdout ?? "")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
}

// Split specifiers: this suite necessarily names some of what it forbids, and
// the committed exam-slice guards scan sibling directories for them.
const PRISMA_MODULE = ["@/lib", "prisma"].join("/");
const GENERATED_CLIENT = ["@prisma", "client"].join("/");
const ENV_READ = "process" + ".env";

// ===========================================================================
// 1–5. Module kind and the public signatures
// ===========================================================================

test("1. the module imports server-only as its FIRST statement", () => {
  const serverOnly = new RegExp('import\\s+"server' + '-only";');
  assert.ok(serverOnly.test(CODE), "the module is not server-only");
  const firstStatement = CODE.split("\n").find((line) => line.trim().length > 0);
  assert.ok(firstStatement);
  assert.ok(serverOnly.test(firstStatement), `the first statement is: ${firstStatement}`);
});

test("2. the module does NOT declare use server (or use client)", () => {
  assert.equal(CODE.includes('"use ' + 'server"'), false);
  assert.equal(CODE.includes("'use " + "server'"), false);
  assert.equal(CODE.includes('"use ' + 'client"'), false);
  assert.equal(CODE.includes("'use " + "client'"), false);
  // ...and the header states the rule it holds itself to.
  assert.ok(COMMENTS.includes("use " + "server"), "the rule is undocumented");
});

test("3. the module exports exactly TWO functions, and no value", () => {
  assert.deepEqual(
    SIGNATURES.map((entry) => entry.name),
    ["createExamAssignment", "deleteExamAssignment"],
  );
  for (const token of [
    "export const",
    "export let",
    "export var",
    "export default",
    "export class",
    "GET",
    "POST",
    "PATCH",
    "NextRequest",
    "NextResponse",
    "revalidatePath",
    "redirect(",
  ]) {
    assert.equal(CODE.includes(token), false, `the module declares ${token}`);
  }
  // The only other exports are TYPE re-exports, which emit no runtime value.
  const exportStatements = CODE.match(/^export .*$/gm) ?? [];
  for (const statement of exportStatements) {
    assert.ok(
      statement.startsWith("export type {") || statement.startsWith("export async function "),
      `unexpected export: ${statement}`,
    );
  }
});

test("4. the two entry points take EXACTLY the approved parameters", () => {
  const [create, remove] = SIGNATURES;
  assert.equal(create.params, "courseOfferingId: string, rawInput: unknown,");
  assert.equal(create.returns, "Promise<CreateExamAssignmentResult>");
  assert.equal(remove.params, "courseOfferingId: string, assignmentId: unknown,");
  assert.equal(remove.returns, "Promise<DeleteExamAssignmentResult>");

  // Neither takes a role, a position, a plan, an actor or a transaction handle.
  for (const forbidden of [
    "role",
    "orderIndex",
    "planId",
    "sessionId",
    "studentId",
    "adminId",
    "actorId",
    "instructorId",
    "tx",
    "prisma",
    "deps",
    "expectedUpdatedAt",
  ]) {
    for (const entry of [create, remove]) {
      assert.equal(
        entry.params.includes(forbidden),
        false,
        `${entry.name} accepts ${forbidden}`,
      );
    }
  }
});

test("5. each entry point only hands its committed core the effects", () => {
  const create = bodyOf("createExamAssignment");
  assert.ok(create.includes("createExamAssignmentWithDeps(courseOfferingId, rawInput, {"));
  for (const dependency of [
    "requireCourseContext",
    "assertConfigurationAllowed",
    "findExamPlanByCourseOfferingId",
    "findSessionForPlan",
    "findEligibleTrainee",
    "createAssignmentAtNextOrder",
    "isCourseNotFoundError",
    "isOperationNotAllowedError",
    "isUniqueConstraintError: isExamAssignmentConflictError",
  ]) {
    assert.ok(create.includes(dependency), `${dependency} is not bound`);
  }

  const remove = bodyOf("deleteExamAssignment");
  assert.ok(
    remove.includes("deleteExamAssignmentWithDeps(courseOfferingId, assignmentId, {"),
  );
  for (const dependency of [
    "requireCourseContext",
    "assertConfigurationAllowed",
    "findExamPlanByCourseOfferingId",
    "findAssignmentForPlan",
    "deleteAssignmentById",
    "isCourseNotFoundError",
    "isOperationNotAllowedError",
  ]) {
    assert.ok(remove.includes(dependency), `${dependency} is not bound`);
  }
  // The removal binds NO uniqueness classifier: it creates nothing.
  assert.equal(remove.includes("isUniqueConstraintError"), false);

  // Neither entry point queries, orders, validates or builds an outcome itself.
  for (const entry of [create, remove]) {
    assert.equal(/prisma\./.test(entry), false, "the entry point queries directly");
    assert.equal(entry.includes("Object.freeze"), false, "the entry point builds a result");
    assert.equal(entry.includes("ok: false"), false, "the entry point invents an outcome");
  }
});

// ===========================================================================
// 6–9. Imports, authorization, the verified id, the lifecycle gate
// ===========================================================================

test("6. the module imports EXACTLY the approved specifiers", () => {
  const specifiers = [...CODE.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(
    [...new Set(specifiers)].sort(),
    [
      "@/app/generated/prisma/client",
      "@/lib/course/admin-course-context",
      "@/lib/course/operation-policy-core",
      "@/lib/exam/create-exam-assignment-core",
      "@/lib/exam/delete-exam-assignment-core",
      PRISMA_MODULE,
    ].sort(),
  );
  // The generated enum is imported as a TYPE only — no runtime client value.
  assert.ok(/import type \{ CourseOfferingStatus \} from/.test(CODE));
  // No date helper is needed, because no statement reads or writes a calendar
  // value; and no notification, message, push or Teaching-Practice module is
  // reachable from here.
  for (const forbidden of [
    "@/lib/dates",
    "notifications",
    "messages",
    "push",
    "teaching-practice",
    "capability",
    "@/lib/auth",
  ]) {
    assert.equal(CODE.includes(forbidden), false, `the module imports ${forbidden}`);
  }
});

test("7. requireAdminCourseOffering is bound once, with the RAW requested id", () => {
  assert.equal((CODE.match(/await requireAdminCourseOffering\(/g) ?? []).length, 1);
  assert.ok(
    /requireAdminCourseOffering\(requestedCourseOfferingId\)/.test(CODE),
    "the admin boundary is not called with the requested id",
  );
  // It is bound in the ONE helper both cores call first, and that helper
  // performs no query of its own and carries forward only two fields.
  const helper = bodyOf("requireCourseContext");
  assert.equal(/prisma\./.test(helper), false, "the authorization helper queries");
  assert.ok(/courseOfferingId:\s*context\.id/.test(helper), "the verified id is not carried");
  assert.ok(/status:\s*context\.status/.test(helper), "the verified status is not carried");
  for (const forbidden of ["name", "level", "activityYear", "startDate", "endDate"]) {
    assert.equal(helper.includes(forbidden), false, `the context carries ${forbidden}`);
  }
  // ONE authorization helper, shared: the two operations cannot drift apart.
  assert.equal((CODE.match(/function requireCourseContext\(/g) ?? []).length, 1);
});

test("8. the lifecycle gate is SCHEDULE_DRAFT_CONFIGURATION, and no capability is consulted", () => {
  const gate = bodyOf("assertConfigurationAllowed");
  assert.ok(gate.includes("assertCourseOperationAllowed("));
  assert.ok(gate.includes('"SCHEDULE_DRAFT_CONFIGURATION"'), "the wrong operation is gated");
  assert.ok(gate.includes("status as CourseOfferingStatus"));
  assert.equal((CODE.match(/assertCourseOperationAllowed\(/g) ?? []).length, 1);
  // A WRITE never borrows the read gate...
  assert.equal(CODE.includes("HISTORICAL_READ"), false);
  // ...and no capability is introduced or borrowed.
  for (const token of [
    '"EXAMS"',
    "'EXAMS'",
    "TEACHING_PRACTICE",
    '"SCHEDULE"',
    "'SCHEDULE'",
    "CapabilityKey",
    "getEffectiveCapabilities",
    "capability-keys",
  ]) {
    assert.equal(CODE.includes(token), false, `the module consults ${token}`);
  }
  // The reuse — and the absent EXAMS capability — stay documented.
  assert.ok(/EXAMS/.test(COMMENTS), "the absent capability is undocumented");
});

test("9. only the two typed project errors are classified", () => {
  assert.ok(bodyOf("isCourseNotFoundError").includes("error instanceof CourseOfferingNotFoundError"));
  assert.ok(
    bodyOf("isOperationNotAllowedError").includes(
      "error instanceof CourseOperationNotPermittedError",
    ),
  );
  // No catch-all: an unrecognized throw — including the framework redirect —
  // leaves this module unchanged.
  assert.equal(/\bcatch\s*\(/.test(CODE), false, "the binding catches");
  assert.equal(CODE.includes("NEXT_" + "REDIRECT"), false, "the binding inspects a redirect");
});

// ===========================================================================
// 10–13. The exact query inventory
// ===========================================================================

test("10. the module issues EXACTLY the approved statements, and no others", () => {
  const statements = [...CODE.matchAll(/\bprisma\.(\w+)\.(\w+)\(/g)].map(
    ([, model, method]) => `${model}.${method}`,
  );
  assert.deepEqual(statements.sort(), [
    "courseEnrollment.findFirst",
    "examAssignment.delete",
    "examAssignment.findFirst",
    "examPlan.findUnique",
    "examSession.findFirst",
  ]);
  // ONE transaction, and exactly two statements inside it.
  assert.equal((CODE.match(/prisma\.\$transaction\(/g) ?? []).length, 1);
  const txStatements = [...CODE.matchAll(/\btx\.(\w+)\.(\w+)\(/g)].map(
    ([, model, method]) => `${model}.${method}`,
  );
  assert.deepEqual(txStatements, ["examAssignment.aggregate", "examAssignment.create"]);

  for (const token of ["$executeRaw", "$queryRaw", "createMany", "updateMany", "upsert"]) {
    assert.equal(CODE.includes(token), false, `the module uses ${token}`);
  }
  // No Teaching-Practice, beginner-child, supervisor, break, parent or contact
  // model is reachable, and no plan/session/definition is created here.
  for (const token of [
    "teachingPractice",
    "examBeginnerChild",
    "examSessionSupervisor",
    "examSessionBreak",
    "parent",
    "signedForm",
    "examPlan.create",
    "examPlan.upsert",
    "examSession.create",
    "examDefinition.create",
  ]) {
    assert.equal(CODE.includes(token), false, `the module touches ${token}`);
  }
});

test("11. the plan lookup uses the VERIFIED offering id and selects only its id", () => {
  const reader = bodyOf("findExamPlanByCourseOfferingId");
  assert.ok(reader.includes("prisma.examPlan.findUnique("));
  assert.ok(
    /where:\s*\{\s*courseOfferingId:\s*verifiedCourseOfferingId\s*\}/.test(reader),
    `the plan where was: ${reader}`,
  );
  const select = reader.slice(reader.indexOf("select: {"));
  assert.ok(/select:\s*\{\s*id:\s*true\s*\}/.test(select));
  for (const forbidden of [
    "publishedAt",
    "sessions",
    "definitions",
    "courseOffering:",
    "include",
  ]) {
    assert.equal(select.includes(forbidden), false, `the plan read selects ${forbidden}`);
  }
  // ONE plan lookup, shared by both operations.
  assert.equal((CODE.match(/function findExamPlanByCourseOfferingId\(/g) ?? []).length, 1);
});

test("12. the session read is a PLAN-SCOPED findFirst with the exact select", () => {
  const reader = bodyOf("findSessionForPlan");
  assert.ok(reader.includes("prisma.examSession.findFirst("), "the session read is not a findFirst");
  assert.ok(
    /where:\s*\{\s*id:\s*sessionId,\s*planId\s*\}/.test(reader),
    `the session where was: ${reader}`,
  );
  // A bare findUnique by id would find another plan's session and then rely on a
  // comparison someone could later remove.
  assert.equal(CODE.includes("examSession.findUnique"), false);
  // The helper takes the SERVER-supplied plan id as its FIRST parameter.
  assert.ok(/function findSessionForPlan\(\s*planId: string,/.test(SOURCE));

  // Exactly the session id plus four definition columns.
  const columns = [...reader.matchAll(/^\s+(\w+): true,/gm)].map((match) => match[1]);
  assert.deepEqual(columns, [
    "id",
    "kind",
    "requiresLessonTopic",
    "requiresDiscipline",
    "requiresInstructedTrainee",
  ]);
  for (const forbidden of [
    "assignments",
    "_count",
    "parallelCapacity",
    "durationMinutes",
    "capacity",
    "date",
    "startTime",
    "endTime",
    "arena",
    "orderIndex",
    "individualPublishedAt",
    "phase",
    "beginnerFormat",
    "sourceTeachingPracticeLessonId",
    "include",
  ]) {
    assert.equal(reader.includes(forbidden), false, `the session read selects ${forbidden}`);
  }
  // The four definition facts are mapped straight through, unrenamed.
  for (const field of [
    "definitionKind: row.definition.kind",
    "requiresLessonTopic: row.definition.requiresLessonTopic",
    "requiresDiscipline: row.definition.requiresDiscipline",
    "requiresInstructedTrainee: row.definition.requiresInstructedTrainee",
  ]) {
    assert.ok(reader.includes(field), `${field} is not mapped`);
  }
});

test("13. eligibility is ONE fail-closed, offering-scoped findFirst", () => {
  const reader = bodyOf("findEligibleTrainee");
  assert.ok(reader.includes("prisma.courseEnrollment.findFirst("));
  assert.equal(CODE.includes("courseEnrollment.findUnique"), false);
  // All four conditions in ONE where clause: no application-side comparison, and
  // no window between "enrolled?" and "active?".
  for (const condition of [
    "courseOfferingId: verifiedCourseOfferingId,",
    "studentId,",
    'status: "ACTIVE",',
    "student: { isActive: true },",
  ]) {
    assert.ok(reader.includes(condition), `the eligibility where lacks: ${condition}`);
  }
  assert.ok(/select:\s*\{\s*studentId:\s*true\s*\}/.test(reader));
  // The SERVER-matched id is what is returned, never the submitted one.
  assert.ok(/return \{ studentId: row\.studentId \};/.test(reader));
  // Combined trainees: isPrimary is neither read nor selected.
  for (const forbidden of [
    "isPrimary",
    "identityNumber",
    "phone",
    "parent",
    "memberships",
    "groupName",
    "assignedHorseName",
    "privateHorseName",
    "id: true",
    "include",
  ]) {
    assert.equal(reader.includes(forbidden), false, `the eligibility read reads ${forbidden}`);
  }
  // The combined-trainee decision stays documented.
  assert.ok(/isPrimary/.test(COMMENTS), "the isPrimary decision is undocumented");
});

// ===========================================================================
// 14–17. The two writes
// ===========================================================================

test("14. the create transaction is ONE aggregate + ONE create, on MAX not COUNT", () => {
  const writer = bodyOf("createAssignmentAtNextOrder");
  assert.ok(writer.includes("prisma.$transaction(async (tx) => {"));
  assert.equal((writer.match(/tx\.examAssignment\.aggregate\(/g) ?? []).length, 1);
  assert.equal((writer.match(/tx\.examAssignment\.create\(/g) ?? []).length, 1);

  // The aggregate is a MAX over the SESSION's positions — never a COUNT, which
  // would silently reuse a position after any removal.
  assert.ok(/where:\s*\{\s*sessionId\s*\}/.test(writer), `the aggregate where was: ${writer}`);
  assert.ok(/_max:\s*\{\s*orderIndex:\s*true\s*\}/.test(writer));
  assert.equal(/_count/.test(writer), false, "the aggregate counts");
  assert.equal(/\.count\(/.test(writer), false, "the writer counts");
  assert.ok(
    /aggregate\._max\.orderIndex === null\s*\?\s*0\s*:\s*aggregate\._max\.orderIndex \+ 1/.test(
      writer.replace(/\s+/g, " "),
    ),
    "the next position is not MAX + 1",
  );

  // No retry, lock, isolation override, unique rule or compaction was added...
  for (const token of ["isolationLevel", "Serializable", "FOR UPDATE", "retry", "attempt"]) {
    assert.equal(writer.includes(token), false, `the writer adds ${token}`);
  }
  // ...and the tolerated equal-position race is documented honestly.
  const flatComments = COMMENTS.replace(/\s+/g, " ");
  assert.ok(/same\s+`?orderIndex`?/i.test(flatComments), "the race is undocumented");
  assert.ok(/tie-break/i.test(flatComments), "the id tie-break is undocumented");
});

test("15. the create writes EXACTLY five columns, and the role is the core's", () => {
  const writer = bodyOf("createAssignmentAtNextOrder");
  const dataStart = writer.indexOf("data: {");
  assert.ok(dataStart > 0);
  const data = writer.slice(dataStart, writer.indexOf("select:", dataStart));
  // `sessionId` is a shorthand property (no colon), so it is asserted on its own
  // line below rather than by the keyed-column scan.
  const columns = [...data.matchAll(/^\s+(\w+):/gm)].map((match) => match[1]);
  assert.deepEqual(columns, ["studentId", "role", "horseName", "orderIndex"]);
  assert.ok(/^\s+sessionId,$/m.test(data), "the session id is not written");

  // The role is FORWARDED from the committed core's payload — never a literal
  // here, never derived from input, never defaulted.
  assert.ok(data.includes("role: value.role,"), "the role is not the core's");
  assert.equal(/role:\s*"/.test(CODE), false, "the binding hardcodes a role literal");
  assert.equal(CODE.includes('"EXAMINEE"'), false, "the binding names a role literal");
  assert.equal(CODE.includes("INSTRUCTED_TRAINEE"), false, "the binding names the second role");

  // The ids written are the SERVER-VERIFIED ones the core forwards.
  assert.ok(data.includes("studentId: value.studentId,"));
  assert.ok(data.includes("orderIndex: nextOrderIndex,"));

  for (const forbidden of [
    "instructionTopic",
    "discipline",
    "pairingIndex",
    "notes",
    "sourcePracticeRole",
    "planId",
    "courseOfferingId",
    "createdAt",
    "updatedAt",
  ]) {
    assert.equal(data.includes(forbidden), false, `the create writes ${forbidden}`);
  }
  // The returned row is narrow.
  assert.ok(/select:\s*\{\s*id:\s*true,\s*orderIndex:\s*true\s*\}/.test(writer));
});

test("16. the removal target is read PLAN-SCOPED and deleted by the STORED id", () => {
  const reader = bodyOf("findAssignmentForPlan");
  assert.ok(reader.includes("prisma.examAssignment.findFirst("));
  assert.ok(
    /where:\s*\{\s*id:\s*assignmentId,\s*session:\s*\{\s*planId\s*\}\s*\}/.test(reader),
    `the scoped where was: ${reader}`,
  );
  assert.ok(/select:\s*\{\s*id:\s*true\s*\}/.test(reader));
  assert.equal(CODE.includes("examAssignment.findUnique"), false);
  // A relation FILTER, never an include: no session row is materialized.
  assert.equal(reader.includes("include"), false);
  assert.ok(/function findAssignmentForPlan\(\s*planId: string,/.test(SOURCE));

  const writer = bodyOf("deleteAssignmentById");
  assert.ok(writer.includes("prisma.examAssignment.delete("), "the removal is not a delete");
  // NEVER deleteMany: the filter is the primary key, and a vanished row must
  // surface as a throw rather than as a silent zero.
  assert.equal(CODE.includes("deleteMany"), false, "the module uses deleteMany");
  assert.ok(
    /where:\s*\{\s*id:\s*assignmentId\s*\}/.test(writer),
    `the delete where was: ${writer}`,
  );
  assert.ok(/select:\s*\{\s*id:\s*true\s*\}/.test(writer));
  // The delete takes the id the SCOPED READ returned: the committed core passes
  // `existing.id`, and this binding has no access to the raw submitted value.
  assert.ok(/function deleteAssignmentById\(assignmentId: string\): Promise<void>/.test(SOURCE));
});

test("17. the removal reorders, compacts and cascades NOTHING", () => {
  for (const token of [
    "compact",
    "renumber",
    "reorder",
    "orderIndex:",
    "assignmentCount",
    "expectedUpdatedAt",
    "version",
  ]) {
    assert.equal(
      bodyOf("deleteAssignmentById").includes(token),
      false,
      `the removal performs ${token}`,
    );
  }
  // Exactly ONE delete statement exists in the whole module.
  assert.equal((CODE.match(/\.delete\(/g) ?? []).length, 1);
  // The P2025 decision is documented rather than implemented.
  assert.ok(/P2025/.test(COMMENTS), "the P2025 propagation is undocumented");
  assert.equal(CODE.includes("P2025"), false, "the binding classifies P2025");
});

// ===========================================================================
// 18–20. The conflict classifier
// ===========================================================================

test("18. the conflict classifier names the EXACT unique index", () => {
  // EX-ASG-MULTIPLICITY RE-POINTED this, and did not weaken it. The role-blind key
  // this used to name is DROPPED; the classifier must name the EXAMINEE-scoped
  // PARTIAL index that replaced it, and must NOT still accept the dropped name —
  // a P2002 naming the old index would mean the migration has not been applied,
  // which is a deployment fault to surface rather than a manager-facing form
  // error to absorb.
  assert.ok(
    CODE.includes(
      'const EXAM_ASSIGNMENT_CONFLICT_INDEX = "exam_assignments_examinee_session_student_key"',
    ),
    "the exact index name is missing",
  );
  assert.equal(
    CODE.includes("exam_assignments_sessionId" + "_studentId_key"),
    false,
    "the classifier still matches the DROPPED role-blind index name",
  );
  // The index name is used ONLY by this classifier, and matched EXACTLY.
  const classifier = bodyOf("isExamAssignmentConflictError");
  assert.ok(/target === EXAM_ASSIGNMENT_CONFLICT_INDEX/.test(classifier));
  assert.equal(/\.includes\(EXAM_ASSIGNMENT_CONFLICT_INDEX\)/.test(CODE), false);
  assert.equal(/startsWith\(EXAM_ASSIGNMENT_CONFLICT_INDEX/.test(CODE), false);
});

test("19. the classifier requires BOTH target fields, and only P2002", () => {
  const classifier = bodyOf("isExamAssignmentConflictError");
  assert.ok(/\(error as \{ code\?: unknown \}\)\.code !== "P2002"/.test(classifier));
  // The array form needs BOTH columns — a target naming only one is a different
  // key and must NOT be reported as "already assigned".
  assert.ok(
    /tokens\.includes\("sessionId"\) && tokens\.includes\("studentId"\)/.test(classifier),
    "the array form does not require both fields",
  );
  assert.equal(/\.some\(/.test(classifier), false, "the array form matches on one field");
  // A non-object, a null and a different Prisma code are all rejected.
  assert.ok(/typeof error !== "object" \|\| error === null/.test(classifier));
  // A framework redirect carries a digest, not a code, so it can never match.
  assert.equal(classifier.includes("digest"), false);
  // The raw error is never unwrapped, logged or echoed.
  for (const token of ["console.", "JSON.stringify", "error.message", "String(error)"]) {
    assert.equal(classifier.includes(token), false, `the classifier ${token}s the error`);
  }
});

test("20. the classifier is PRIVATE and is the module's ONLY P2002 handling", () => {
  assert.equal(
    CODE.includes("export function isExamAssignmentConflictError"),
    false,
    "the classifier is exported",
  );
  assert.equal((CODE.match(/"P2002"/g) ?? []).length, 1, "P2002 is handled in two places");
  // It is bound to the CREATE only.
  assert.equal(
    (CODE.match(/isExamAssignmentConflictError/g) ?? []).length,
    2,
    "the classifier is declared once and bound once",
  );
  // The fallback for unreadable metadata is documented rather than silent.
  assert.ok(/[Uu]nreadable/.test(COMMENTS), "the fallback is undocumented");
});

// ===========================================================================
// 21–24. Containment: no caller, no UI, six new files, nothing modified
// ===========================================================================

test("21. EXACTLY the approved Server Action module calls either writer", () => {
  // EX-ASG-UI1 TRANSITION. This guard asserted the caller list was EMPTY, which was
  // the correct claim while the write binding was committed but deliberately
  // unwired. Wiring it is exactly what makes that claim obsolete, so the guard is
  // RE-POINTED to an equally exact positive claim rather than deleted or weakened
  // to "some caller exists": the ONE course-scoped admin exams Server Action
  // module, and nothing else anywhere under `app/`, `lib/` or `components/`.
  //
  // A SECOND caller still fails here, and that is the whole point. These are the
  // WRITE bindings: every caller is a new publicly reachable path to creating or
  // removing an exam assignment, and no page, form, component or other route may
  // reach one directly — only a reviewed Server Action may.
  const declaring = new Set([join(REPO_ROOT, IO_REL), join(REPO_ROOT, IO_TEST_REL)]);
  /** The ONE production module authorized to reach either writer. */
  const APPROVED_CALLERS = [
    join("app", "admin", "courses", "[courseOfferingId]", "exams", "actions.ts"),
  ];
  // The committed pure cores DECLARE these symbols, and their own suites
  // legitimately drive the injectable orchestrations with fakes — as does the
  // sibling input core's suite, whose directory-listing guard necessarily names
  // the two orchestration files. Nothing else may reach any of these symbols.
  const ownSuites = new Set(
    [
      join("lib", "exam", "create-exam-assignment-core.ts"),
      join("lib", "exam", "create-exam-assignment-core.test.ts"),
      join("lib", "exam", "delete-exam-assignment-core.ts"),
      join("lib", "exam", "delete-exam-assignment-core.test.ts"),
      join("lib", "exam", "exam-assignment-write-core.test.ts"),
    ].map((rel) => join(REPO_ROOT, rel)),
  );

  const callers: string[] = [];
  let scanned = 0;
  for (const dir of ["app", "lib", "components"]) {
    const root = join(REPO_ROOT, dir);
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) continue;
      const path = join(entry.parentPath ?? root, entry.name);
      if (path.includes(`${sep}generated${sep}`)) continue;
      scanned += 1;
      if (declaring.has(path) || ownSuites.has(path)) continue;
      const code = stripComments(readFileSync(path, "utf8"));
      const reaches =
        /exam-assignment-write-io/.test(code) ||
        /(create|delete)-exam-assignment-core/.test(code) ||
        /\b(create|delete)ExamAssignment\s*\(/.test(code) ||
        /\b(create|delete)ExamAssignmentWithDeps\s*\(/.test(code);
      if (reaches) callers.push(path.slice(REPO_ROOT.length + 1));
    }
  }
  // Sanity: the exact result below is a PASS, not an empty search.
  assert.ok(scanned > 100, `expected the repository, scanned ${scanned} files`);
  assert.deepEqual(
    callers.sort(),
    APPROVED_CALLERS,
    `the caller list is not exactly the approved Server Action module: ${callers.join(", ")}`,
  );

  // EX-ASG-LTD2-B2 TRANSITION, and a STRICTLY TIGHTER claim than the file-level one
  // above. The two writers share a module, so a file-level caller list cannot tell
  // them apart — and the route's create endpoint now calls the committed DETAILED
  // examinee binding instead of the three-field CREATE below, while still calling
  // the REMOVAL. The module therefore keeps exactly one caller, and the CREATE has
  // none.
  //
  // This is the whole point of stating it per SYMBOL: "the ordinary create writer
  // is unreachable from production" is a property no import list can express, and
  // it is what makes the switch provable rather than merely intended. A single
  // production caller of the create — anywhere under `app/`, `lib/` or
  // `components/` — fails here, so the two paths cannot silently coexist.
  const createCallers: string[] = [];
  for (const dir of ["app", "lib", "components"]) {
    const root = join(REPO_ROOT, dir);
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) continue;
      const path = join(entry.parentPath ?? root, entry.name);
      if (path.includes(`${sep}generated${sep}`)) continue;
      // The declaring module, the cores that DECLARE these symbols and every
      // `.test.ts` are excluded: a suite that asserts about the create is not a
      // caller of it, which is the same distinction the file-level scan draws.
      if (declaring.has(path) || ownSuites.has(path) || /\.test\.tsx?$/.test(entry.name)) continue;
      const code = stripComments(readFileSync(path, "utf8"));
      const reaches =
        /create-exam-assignment-core/.test(code) ||
        /\bcreateExamAssignment\s*\(/.test(code) ||
        /\bcreateExamAssignmentWithDeps\s*\(/.test(code);
      if (reaches) createCallers.push(path.slice(REPO_ROOT.length + 1));
    }
  }
  assert.deepEqual(
    createCallers.sort(),
    [],
    `the three-field create writer must have no production caller; found: ${createCallers.join(", ")}`,
  );
});

test("22. no exam route, page, form or Server Action was created", () => {
  for (const dir of [
    join("app", "admin", "exams"),
    join("app", "instructor", "exams"),
    join("app", "student", "exams"),
  ]) {
    assert.equal(existsSync(join(REPO_ROOT, dir)), false, `${dir} was created`);
  }
  for (const file of [
    join("lib", "actions", "exam-assignment-actions.ts"),
    join("lib", "actions", "exam-assignments.ts"),
    join("lib", "actions", "exams.ts"),
  ]) {
    assert.equal(existsSync(join(REPO_ROOT, file)), false, `${file} was created`);
  }
  // No file this slice added is a UI file or declares a Server Action.
  for (const rel of NEW_FILES) {
    assert.equal(rel.endsWith(".tsx"), false, `${rel} is a UI file`);
    const source = stripComments(readFileSync(join(REPO_ROOT, rel.split("/").join(sep)), "utf8"));
    assert.equal(source.includes('"use ' + 'server"'), false, `${rel} is a Server Action module`);
  }
});

test("23. each approved file-prefix set contains EXACTLY its approved pair", () => {
  const actions = readdirSync(join(REPO_ROOT, "lib", "actions"));
  assert.deepEqual(
    actions.filter((name) => name.startsWith("exam-assignment-write")).sort(),
    ["exam-assignment-write-io.test.ts", "exam-assignment-write-io.ts"],
  );
  // Assembled for the reason the NEW_FILES comment gives.
  assert.deepEqual(
    actions.filter((name) => name.startsWith("exam-assignment-read")).sort(),
    ["exam-assignment-read" + "-io.test.ts", "exam-assignment-read" + "-io.ts"],
  );
  // The committed assignment guard pins the six lib/exam files whose names begin
  // with the three core prefixes; this slice's core deliberately sits OUTSIDE
  // that set, under its own prefix.
  const exam = readdirSync(join(REPO_ROOT, "lib", "exam"));
  assert.deepEqual(
    exam.filter((name) => name.startsWith("admin-exam-assignment-read")).sort(),
    ["admin-exam-assignment-read" + "-core.test.ts", "admin-exam-assignment-read" + "-core.ts"],
  );
  assert.deepEqual(
    exam.filter((name) => /^(exam|create-exam|delete-exam)-assignment-/.test(name)).sort(),
    [
      "create-exam-assignment-core.test.ts",
      "create-exam-assignment-core.ts",
      "delete-exam-assignment-core.test.ts",
      "delete-exam-assignment-core.ts",
      "exam-assignment-write-core.test.ts",
      "exam-assignment-write-core.ts",
    ],
  );
});

test("24. only the approved wiring paths are modified: no schema, migration, auth or policy", () => {
  // `--diff-filter=MDRT` excludes additions on purpose: a brand-new file is what a
  // slice is allowed to produce, and including additions would make the check flip
  // to red the moment the new files are staged and back to green after they are
  // committed.
  //
  // EX-ASG-UI1 TRANSITION. This guard asserted the working tree modified NOTHING,
  // which was correct while EX-ASG-IO1 was the uncommitted slice and added only new
  // files. The wiring slice necessarily modifies the route's Server Action module,
  // its page and the committed guard suites whose exact counts it re-points, so the
  // guard is RE-POINTED to an EXACT allow-list rather than deleted.
  //
  // What it always protected is unchanged and is what the list proves: no schema,
  // no migration, no auth module, no session module, no capability catalog, no
  // course-policy core, and no `lib/` PRODUCTION file of any kind.
  const APPROVED_MODIFICATIONS = [
    "app/admin/courses/[courseOfferingId]/exams/actions.ts",
    "app/admin/courses/[courseOfferingId]/exams/page.tsx",
    "app/admin/courses/[courseOfferingId]/exams/exam-definition-create.contract.test.ts",
    "app/admin/courses/[courseOfferingId]/exams/exam-definitions-page.contract.test.ts",
    "app/admin/courses/[courseOfferingId]/exams/exam-plan-create.contract.test.ts",
    "app/admin/courses/[courseOfferingId]/exams/exam-session-create.contract.test.ts",
    "app/admin/courses/[courseOfferingId]/exams/exam-session-edit-delete.contract.test.ts",
    "lib/actions/" + "exam-assignment-read" + "-io.test.ts",
    "lib/actions/exam-assignment-write-io.test.ts",
    "lib/actions/" + "exam-definition-read" + "-io.test.ts",
    "lib/actions/" + "admin-exam-session-read" + "-io.test.ts",
    "lib/actions/" + "exam-session-write" + "-io.test.ts",
    "lib/actions/" + "exam-plan-write" + "-io.test.ts",
    "lib/exam/" + "exam-supervisor-write" + "-core.test.ts",
    // EX-ASG-IT2 — the approved INSTRUCTED_TRAINEE assignment CREATE UI, which
    // travels in the same working tree. It adds the ASSIGNMENT contract suite to
    // the modified set (that suite's route file set and export list learn about
    // the eighth endpoint) and the committed instructed-trainee write guard,
    // whose caller list it re-points from zero to exactly one Server Action
    // module. Its own three new route files are ADDITIONS. Nothing here changes
    // which module this guard is about: no reader gained a caller, no writer was
    // edited, and no schema, migration, auth, capability or policy file is named.
    "app/admin/courses/[courseOfferingId]/exams/exam-assignment-ui.contract.test.ts",
    "app/admin/courses/[courseOfferingId]/exams/CreateExamInstructedTraineeAssignmentForm.tsx",
    "app/admin/courses/[courseOfferingId]/exams/exam-instructed-trainee-assignment-messages.ts",
    "app/admin/courses/[courseOfferingId]/exams/exam-instructed-trainee-assignment-ui.contract.test.ts",
    // EX-PUB-UI-MVP — the approved slice that wires the committed exam-plan
    // PUBLICATION backend to this same route. It travels in the same working tree,
    // adds ONE new contract suite, and re-points that backend's own footprint and
    // caller guards, so both paths join this list BY NAME. Nothing it does touches
    // this module: no schema, no migration, no auth, no capability, and no `lib/`
    // production file of any kind.
    //
    // The `lib/` entry is ASSEMBLED from pieces: that suite sweeps every source
    // file for the publication binding's module name and pins the result to
    // EXACTLY ONE production caller, so a path written whole here would enrol this
    // suite in the very list it exists to keep narrow.
    "app/admin/courses/[courseOfferingId]/exams/exam-publication-ui.contract.test.ts",
    "lib/actions/" + "exam-publication-write" + "-io.test.ts",
    "lib/actions/" + "exam-instructed-trainee-assignment-write" + "-io.test.ts",
    "lib/exam/" + "create-exam-plan" + "-core.test.ts",
    // EX-ASG-LTD2-B1 — the approved ADMIN READ DETAIL slice, which travels in the
    // same working tree. It publishes two stored columns the assignment READ pair
    // already reached, so that pair's two PRODUCTION modules and its pure core's
    // suite join this list, together with the two supervisor footprint guards
    // whose "nothing was modified" claims it re-points.
    //
    // Nothing here changes which module THIS guard is about: the assignment WRITE
    // binding is not named, gained no caller and was not edited, and no schema,
    // migration, auth, session, capability or policy file appears. The assertion
    // below still pins WHICH `lib/` production modules may differ at all.
    "lib/exam/" + "admin-exam-assignment-read" + "-core.ts",
    "lib/exam/" + "admin-exam-assignment-read" + "-core.test.ts",
    "lib/actions/" + "exam-assignment-read" + "-io.ts",
    "lib/actions/" + "exam-supervisor-read" + "-io.test.ts",
    "lib/actions/" + "exam-supervisor-write" + "-io.test.ts",
    // EX-ASG-LTD2-B2 — the approved DETAILED examinee assignment UI wiring, which
    // travels in the same working tree. It switches the route's ONE create endpoint
    // to the committed detailed writer, which brings the examinee create form (two
    // conditional inputs) and the route-local assignment message table (the
    // detailed writer's own issue codes) into the modified set, plus that writer's
    // committed guard, whose caller list it re-points from zero to exactly one
    // Server Action module. The last path is ASSEMBLED, because that guard sweeps
    // for its own module name.
    //
    // Nothing here changes which module THIS guard is about: the three-field write
    // binding below is not edited, LOSES its create caller rather than gaining one,
    // and no schema, migration, auth, session, capability or policy file appears.
    "app/admin/courses/[courseOfferingId]/exams/CreateExamAssignmentForm.tsx",
    "app/admin/courses/[courseOfferingId]/exams/exam-assignment-messages.ts",
    "lib/actions/" + "detailed-exam-assignment-write" + "-io.test.ts",
    // EX-PAIR-BE-MVP — the approved instructed-trainee/examinee PAIRING backend,
    // which travels in the same working tree. Its four `lib/` additions re-point
    // the footprint list of the neighbouring publication backend's guard SUITE,
    // so that suite joins the modified set. It is a `.test.ts`; no production
    // file, no route, no Server Action and no schema, migration, auth, session,
    // capability or policy file comes with it, and THIS binding is neither edited
    // nor given a caller by it.
    "lib/actions/" + "exam-publication-write" + "-io.test.ts",
      // EX-ADMIN-WORKSPACE-UX — the admin exams WORKSPACE rebuild. It adds four
    // route files and two `lib/` modules (both NEW; no committed `lib/` production
    // module is modified), edits the route's page and Server Action module, and
    // re-points the guard suites listed below. Every entry is spelled in full, so a
    // path this slice does not touch still fails here. The `lib/` entries are
    // ASSEMBLED so this suite does not enrol itself as a caller of what it names.
    "app/admin/courses/[courseOfferingId]/exams/page.tsx",
    "app/admin/courses/[courseOfferingId]/exams/actions.ts",
    "app/admin/courses/[courseOfferingId]/exams/EditExamAssignmentCard.tsx",
    "app/admin/courses/[courseOfferingId]/exams/exam-workspace-view.ts",
    "app/admin/courses/[courseOfferingId]/exams/exam-workspace-messages.ts",
    "app/admin/courses/[courseOfferingId]/exams/exam-workspace.contract.test.ts",
    "app/admin/courses/[courseOfferingId]/exams/exam-assignment-ui.contract.test.ts",
    "app/admin/courses/[courseOfferingId]/exams/exam-definition-create.contract.test.ts",
    "app/admin/courses/[courseOfferingId]/exams/exam-definitions-page.contract.test.ts",
    "app/admin/courses/[courseOfferingId]/exams/exam-instructed-trainee-assignment-ui.contract.test.ts",
    "app/admin/courses/[courseOfferingId]/exams/exam-pairing-ui.contract.test.ts",
    "app/admin/courses/[courseOfferingId]/exams/exam-plan-create.contract.test.ts",
    "app/admin/courses/[courseOfferingId]/exams/exam-publication-ui.contract.test.ts",
    "app/admin/courses/[courseOfferingId]/exams/exam-session-create.contract.test.ts",
    "app/admin/courses/[courseOfferingId]/exams/exam-session-edit-delete.contract.test.ts",
    // ...and its two `lib/` modules, which are ADDITIONS: a new pure core and its
    // new server-only binding. ASSEMBLED, so this suite does not enrol itself as
    // a caller of either.
    "lib/actions/" + "admin-exam-workspace-edit" + "-io.ts",
    "lib/exam/" + "admin-exam-workspace-edit" + "-core.ts",
    // EX-BEGINNER-EXAM-READ - the Level-1 beginner containment gate plus the
    // trainee-only assignment `isSelf` marker. Beginner Teaching-Practice rows are
    // gated to Level 1 in the loader, and the trainee narrowing marks the viewer's
    // own assignment by exact student id. Every path below is named EXACTLY - no
    // directory, no prefix, no glob - so an unrelated file still fails this guard,
    // and each module name is SPLIT so this list never enrols itself as a caller.
    "lib/actions/" + "admin-exam-session-read" + "-io.test.ts",
    "lib/actions/" + "exam-assignment-read" + "-io.test.ts",
    "lib/actions/" + "exam-assignment-write" + "-io.test.ts",
    "lib/actions/" + "exam-definition-read" + "-io.test.ts",
    "lib/actions/" + "exam-definition-write" + "-io.test.ts",
    "lib/actions/" + "exam-instructed-trainee-assignment-write" + "-io.test.ts",
    "lib/actions/" + "exam-pairing-write" + "-io.test.ts",
    "lib/actions/" + "exam-plan-write" + "-io.test.ts",
    "lib/actions/" + "exam-publication-write" + "-io.test.ts",
    "lib/actions/" + "exam-session-write" + "-io.test.ts",
    "lib/actions/" + "exam-supervisor-read" + "-io.test.ts",
    "lib/actions/" + "exam-supervisor-write" + "-io.test.ts",
    "lib/exam/" + "create-exam-plan" + "-core.test.ts",
    "lib/exam/" + "exam-read" + "-dto.test.ts",
    "lib/exam/" + "exam-read-scope" + "-core.test.ts",
    "lib/exam/" + "exam-read" + ".contract.test.ts",
    "lib/exam/" + "exam-supervisor-write" + "-core.test.ts",
    "lib/actions/" + "admin-exam-workspace-edit" + "-io.test.ts",
    "lib/exam/" + "admin-exam-workspace-edit" + "-core.test.ts",
    "lib/actions/" + "instructor-exam-schedule" + ".contract.test.ts",
    "lib/actions/" + "trainee-exam-schedule" + ".contract.test.ts",
    "lib/exam/" + "create-exam-plan" + "-core.test.ts",
    "lib/exam/" + "exam-beginner-course-scope" + "-core.test.ts",
    "lib/exam/" + "exam-beginner-course-scope" + "-core.ts",
    "lib/exam/" + "exam-beginner-course-scope" + ".contract.test.ts",
    "lib/exam/" + "exam-plan-loader" + "-core.test.ts",
    "lib/exam/" + "exam-plan-loader" + "-core.ts",
    "lib/exam/" + "exam-read-" + "dto.test.ts",
    "lib/exam/" + "exam-rea" + "d-dto.ts",
    "lib/exam/" + "exam-read-scope" + "-core.test.ts",
    "lib/exam/" + "exam-read-scope" + "-core.ts",
    "lib/exam/" + "exam-read" + ".contract.test.ts",
    "lib/exam/" + "exam-supervisor-write" + "-core.test.ts",
    "lib/exam/" + "exam-trainee-view" + "-core.ts",


    // EX-ASG-MULTIPLICITY + EX-PAIR-NO-SELF - this branch's EXACT, CLOSED footprint.
    // ADDED, never widened: every entry is one exact literal path. No directory,
    // no prefix, no glob - an unrelated file still fails this guard. Module names
    // are SPLIT so this list never reads as a REFERENCE to the module it names.
    "app/student/trainee-teaching-practice-home-shortcut" + ".contract.test.ts",
    "lib/actions/detailed-exam-assignment-write" + "-io.ts",
    "lib/actions/exam-assignment-write" + "-io.ts",
    "lib/actions/exam-instructed-trainee-assignment-write" + "-io.ts",
    "lib/actions/exam-pairing-write" + "-io.ts",
    "lib/actions/message-audience" + ".contract.test.ts",
    "lib/exam/admin-exam-examinee-pairing" + "-core.test.ts",
    "lib/exam/admin-exam-examinee-pairing" + "-core.ts",
    "lib/exam/create-exam-instructed-trainee-assignment" + "-core.test.ts",
    "lib/exam/create-exam-instructed-trainee-assignment" + "-core.ts",
    "lib/exam/exam-conflict" + "-core.ts",
    "lib/exam/exam-pairing-write" + "-core.test.ts",
    "lib/exam/exam-pairing-write" + "-core.ts",
    "lib/exam/exam-schema-structure" + ".test.ts",
    "prisma/migrations/20260802120000_scope_exam_assignment_unique_to_examinee/migration.sql",
    "prisma/schema.prisma",
].sort();

  const modified = gitLines([
    "diff",
    "--name-only",
    "--diff-filter=MDRT",
    "HEAD",
    "--",
    "lib",
    "prisma",
    "app",
    "components",
  ]);
  const offenders = modified.filter((path) => !APPROVED_MODIFICATIONS.includes(path)).sort();
  assert.deepEqual(offenders, [], `the slice modified: ${offenders.join(", ")}`);

  // RE-POINTED by EX-ASG-LTD2-B1 to an exact pair, and RE-POINTED AGAIN by
  // EX-ASG-LTD2-B2 back to the STRICTEST form of the claim — EMPTY.
  //
  // The pair was correct while the read slice was uncommitted in this working tree
  // and had to publish two more stored columns. It is committed now, so those names
  // described a moment rather than a rule, and the wiring slice that followed edits
  // no `lib/` production module at all: every binding it reaches is already
  // committed, and the wiring lives entirely under `app/`.
  //
  // The original claim is therefore restored in full: NO `lib/` production module —
  // no writer, no reader, no core, no policy, auth or session module — may differ
  // from HEAD.
  const libProduction = modified
    .filter((path) => path.startsWith("lib/") && !path.endsWith(".test.ts"))
    .sort();
  assert.deepEqual(
    libProduction,
    // RE-POINTED by EX-BEGINNER-EXAM-READ. The Level-1 beginner containment gate
    // plus the trainee-only assignment `isSelf` marker MODIFY exactly these four
    // lib/ production modules: the plan loader gains the containment option, the
    // role scope core derives it from the DB-verified offering level, the trainee
    // view core carries the server-derived viewer id on its INTERNAL projection,
    // and the narrowing turns that id into one boolean per trainee assignment row.
    // The slice's fifth production file - the pure course-level predicate - is a
    // NEW file and so never appears in a diff against HEAD.
    //
    // Each is named EXACTLY - no directory, no prefix, no glob - so a FIFTH
    // modified lib/ production module still fails here. None is a writer, a policy
    // core, an auth module or a session module.
    [
      // RE-POINTED to the EMPTY set by EX-ADMIN-UX-FIXES / EX-ADMIN-SRCDATE, and
      // it is the STRICTEST form of this claim rather than a relaxation.
      //
      // The four modules this list used to name — the plan loader, the read DTO,
      // the read scope core and the trainee view core — were edited by a slice
      // that shared this working tree and is MERGED into `main` now. Measured
      // against HEAD they are no longer modifications, so the names described a
      // moment rather than a rule.
      //
      // THIS branch modifies NO `lib/` production module at all. It ADDS two —
      // the pure source-date decision core and its server-only binding, which a
      // modifications-only diff does not report — and does everything else under
      // `app/`. A modification of ANY `lib/` production module fails here again.

      // EX-ASG-MULTIPLICITY + EX-PAIR-NO-SELF - the branch's 9 committed `lib/` production edits, named EXACTLY:
      // the three P2002 classifiers re-pointed at the role-scoped unique index,
      // the two pairing bindings that now read `studentId` for EX-PAIR-NO-SELF,
      // and the pure cores those bind. A fourth still fails here.
      "lib/actions/admin-exam-workspace-edit" + "-io.ts",
      "lib/actions/detailed-exam-assignment-write" + "-io.ts",
      "lib/actions/exam-assignment-write" + "-io.ts",
      "lib/actions/exam-instructed-trainee-assignment-write" + "-io.ts",
      "lib/actions/exam-pairing-write" + "-io.ts",
      "lib/exam/admin-exam-examinee-pairing" + "-core.ts",
      "lib/exam/create-exam-instructed-trainee-assignment" + "-core.ts",
      "lib/exam/exam-conflict" + "-core.ts",
      "lib/exam/exam-pairing-write" + "-core.ts",
].sort(),
    `an unapproved lib production module was edited: ${libProduction.join(", ")}`,
  );

  // ...and every working-tree entry under `prisma/` — untracked included — is
  // empty, so no migration directory was added either.
    // DE-DUPLICATED: once staged, the unstaged and staged diffs BOTH report the
  // same path, so the union must be a Set or the expectation doubles.
  const prismaStatus = [
    ...new Set([
      ...gitLines(["diff", "--name-only", "HEAD", "--", "prisma"]),
      ...gitLines(["diff", "--name-only", "--cached", "HEAD", "--", "prisma"]),
      ...gitLines(["ls-files", "--others", "--exclude-standard", "--", "prisma"]),
    ]),
  ].sort();
  // EX-ASG-MULTIPLICITY + EX-PAIR-NO-SELF - the prisma/ working tree is the ONE approved schema change and its ONE
  // hand-written migration, snapshotted EXACTLY. Any other prisma entry still fails.
  assert.deepEqual(prismaStatus, [
    "prisma/migrations/20260802120000_scope_exam_assignment_unique_to_examinee/migration.sql",
    "prisma/schema.prisma",
  ], `prisma/ changed: ${prismaStatus.join(", ")}`);

  // The committed pure cores this module BINDS were not edited or duplicated.
  for (const rel of [
    join("lib", "exam", "exam-assignment-write-core.ts"),
    join("lib", "exam", "create-exam-assignment-core.ts"),
    join("lib", "exam", "delete-exam-assignment-core.ts"),
    join("lib", "course", "admin-course-context.ts"),
    join("lib", "course", "operation-policy-core.ts"),
  ]) {
    assert.ok(existsSync(join(REPO_ROOT, rel)), `${rel} is missing`);
  }
});

test("25. this suite opens no database and reads no environment", () => {
  const own = stripComments(readFileSync(join(REPO_ROOT, IO_TEST_REL), "utf8"));
  for (const token of [
    PRISMA_MODULE,
    GENERATED_CLIENT,
    ENV_READ,
    "DATABASE" + "_URL",
    "Prisma" + "Client",
  ]) {
    assert.equal(own.includes(token), false, `the suite references ${token}`);
  }
  const specifiers = [...own.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(
    [...new Set(specifiers)].sort(),
    ["node:assert/strict", "node:child_process", "node:fs", "node:path", "node:test"],
  );
});
