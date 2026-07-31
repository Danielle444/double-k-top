/**
 * EXAM EX-SUP-IO1 — the guard suite for the ADMIN stored ExamSessionSupervisor
 * WRITE bindings.
 *
 * Run with: npx tsx --test lib/actions/exam-supervisor-write-io.test.ts
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

const IO_REL = join("lib", "actions", "exam-supervisor-write-io.ts");
const IO_TEST_REL = join("lib", "actions", "exam-supervisor-write-io.test.ts");

/**
 * The SIX files this slice consists of, in repository form.
 *
 * ASSEMBLED, never spelled whole: the sibling READ binding's own guard suite
 * sweeps `lib/` for its module name and for its core's, and a suite that spelled
 * either as one literal would enrol ITSELF in the caller allow-list that guard
 * exists to keep empty.
 */
const NEW_FILES = [
  "lib/actions/" + "exam-supervisor-read" + "-io.test.ts",
  "lib/actions/" + "exam-supervisor-read" + "-io.ts",
  "lib/actions/exam-supervisor-write-io.test.ts",
  "lib/actions/exam-supervisor-write-io.ts",
  "lib/exam/" + "admin-exam-supervisor-read" + "-core.test.ts",
  "lib/exam/" + "admin-exam-supervisor-read" + "-core.ts",
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

test("t1. the module imports server-only as its FIRST statement", () => {
  const serverOnly = new RegExp('import\\s+"server' + '-only";');
  assert.ok(serverOnly.test(CODE), "the module is not server-only");
  const firstStatement = CODE.split("\n").find((line) => line.trim().length > 0);
  assert.ok(firstStatement);
  assert.ok(serverOnly.test(firstStatement), `the first statement is: ${firstStatement}`);
});

test("t2. the module does NOT declare use server (or use client)", () => {
  assert.equal(CODE.includes('"use ' + 'server"'), false);
  assert.equal(CODE.includes("'use " + "server'"), false);
  assert.equal(CODE.includes('"use ' + 'client"'), false);
  assert.equal(CODE.includes("'use " + "client'"), false);
  // ...and the header states the rule it holds itself to.
  assert.ok(COMMENTS.includes("use " + "server"), "the rule is undocumented");
});

test("t3. the module exports exactly TWO functions, and no value", () => {
  assert.deepEqual(
    SIGNATURES.map((entry) => entry.name),
    ["createExamSupervisor", "deleteExamSupervisor"],
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

test("t4. the two entry points take EXACTLY the approved parameters", () => {
  const [create, remove] = SIGNATURES;
  assert.equal(create.params, "courseOfferingId: string, rawInput: unknown,");
  assert.equal(create.returns, "Promise<CreateExamSupervisorResult>");
  assert.equal(remove.params, "courseOfferingId: string, supervisorId: unknown,");
  assert.equal(remove.returns, "Promise<DeleteExamSupervisorResult>");

  // Neither takes a plan, a session, an instructor, a position, an actor or a
  // transaction handle.
  for (const forbidden of [
    "planId",
    "sessionId",
    "instructorId",
    "orderIndex",
    "role",
    "isPrimary",
    "adminId",
    "actorId",
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

test("t5. each entry point only hands its committed core the effects", () => {
  const create = bodyOf("createExamSupervisor");
  assert.ok(create.includes("createExamSupervisorWithDeps(courseOfferingId, rawInput, {"));
  for (const dependency of [
    "requireCourseContext",
    "assertConfigurationAllowed",
    "findExamPlanByCourseOfferingId",
    "findSessionForPlan",
    "findEligibleInstructor",
    "createSupervisor",
    "isCourseNotFoundError",
    "isOperationNotAllowedError",
    "isUniqueConstraintError: isExamSupervisorConflictError",
  ]) {
    assert.ok(create.includes(dependency), `${dependency} is not bound`);
  }

  const remove = bodyOf("deleteExamSupervisor");
  assert.ok(
    remove.includes("deleteExamSupervisorWithDeps(courseOfferingId, supervisorId, {"),
  );
  for (const dependency of [
    "requireCourseContext",
    "assertConfigurationAllowed",
    "findExamPlanByCourseOfferingId",
    "findSupervisorForPlan",
    "deleteSupervisor",
    "isCourseNotFoundError",
    "isOperationNotAllowedError",
  ]) {
    assert.ok(remove.includes(dependency), `${dependency} is not bound`);
  }
  // The removal binds NO uniqueness classifier: it records nothing.
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

test("t6. the module imports EXACTLY the approved specifiers", () => {
  const specifiers = [...CODE.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(
    [...new Set(specifiers)].sort(),
    [
      "@/app/generated/prisma/client",
      "@/lib/course/admin-course-context",
      "@/lib/course/operation-policy-core",
      "@/lib/exam/create-exam-supervisor-core",
      "@/lib/exam/delete-exam-supervisor-core",
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

test("t7. requireAdminCourseOffering is bound once, with the RAW requested id", () => {
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

  // The RAW requested id reaches the authorization boundary and NOTHING else.
  // An offering id is written in exactly TWO places in the whole module: the
  // helper carrying the VERIFIED one forward, and the plan lookup consuming it.
  // (`: string` matches are TYPE annotations, not values, and are dropped.)
  const offeringUses = [...CODE.matchAll(/courseOfferingId:\s*([\w.]+)/g)]
    .map((m) => m[1])
    .filter((value) => value !== "string");
  assert.deepEqual(offeringUses, ["context.id", "verifiedCourseOfferingId"]);
});

test("t8. the lifecycle gate is SCHEDULE_DRAFT_CONFIGURATION, and no capability is consulted", () => {
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

test("t9. only the two typed project errors are classified, and nothing is caught broadly", () => {
  assert.ok(
    bodyOf("isCourseNotFoundError").includes("error instanceof CourseOfferingNotFoundError"),
  );
  assert.ok(
    bodyOf("isOperationNotAllowedError").includes(
      "error instanceof CourseOperationNotPermittedError",
    ),
  );
  // No catch-all: an unrecognized throw — including the framework redirect —
  // leaves this module unchanged.
  assert.equal(/\bcatch\s*\(/.test(CODE), false, "the binding catches");
  assert.equal(/\btry\s*\{/.test(CODE), false, "the binding catches");
  assert.equal(CODE.includes("NEXT_" + "REDIRECT"), false, "the binding inspects a redirect");
  // Exactly two `instanceof` checks exist, and both are the typed project errors.
  assert.equal((CODE.match(/instanceof/g) ?? []).length, 2);
});

// ===========================================================================
// 10–14. The exact six-statement query inventory
// ===========================================================================

test("t10. the module issues EXACTLY the approved six statements, and no others", () => {
  const statements = [...CODE.matchAll(/\bprisma\.(\w+)\.(\w+)\(/g)].map(
    ([, model, method]) => `${model}.${method}`,
  );
  assert.equal(statements.length, 6, `the inventory was: ${statements.join(", ")}`);
  assert.deepEqual(statements.sort(), [
    "examPlan.findUnique",
    "examSession.findFirst",
    "examSessionSupervisor.create",
    "examSessionSupervisor.delete",
    "examSessionSupervisor.findFirst",
    "instructor.findFirst",
  ]);

  // No transaction, no raw SQL, no bulk statement and no aggregation anywhere.
  for (const token of [
    "$" + "transaction",
    "$" + "executeRaw",
    "$" + "queryRaw",
    "createMany",
    "updateMany",
    "deleteMany",
    "upsert",
    "aggregate",
    "groupBy",
    ".count(",
    "isolationLevel",
    "Serializable",
    "FOR UPDATE",
    "retry",
  ]) {
    assert.equal(CODE.includes(token), false, `the module uses ${token}`);
  }
  // No Teaching-Practice, beginner-child, assignment, break, parent or contact
  // model is reachable, and no plan/session/definition is written here.
  for (const token of [
    "teachingPractice",
    "examBeginnerChild",
    "examAssignment",
    "examSessionBreak",
    "examDefinition",
    "prisma.student.",
    "parent",
    "signedForm",
    "examPlan.create",
    "examPlan.upsert",
    "examSession.create",
  ]) {
    assert.equal(CODE.includes(token), false, `the module touches ${token}`);
  }
});

test("t11. the plan lookup uses the VERIFIED offering id and selects only its id", () => {
  const reader = bodyOf("findExamPlanByCourseOfferingId");
  assert.ok(reader.includes("prisma.examPlan.findUnique("));
  assert.ok(
    /where:\s*\{\s*courseOfferingId:\s*verifiedCourseOfferingId,?\s*\}/.test(reader),
    `the plan where was: ${reader}`,
  );
  const select = reader.slice(reader.indexOf("select: {"));
  assert.ok(/select:\s*\{\s*id:\s*true,?\s*\}/.test(select));
  for (const forbidden of [
    "publishedAt",
    "sessions",
    "definitions",
    "courseOffering:",
    "include",
  ]) {
    assert.equal(select.includes(forbidden), false, `the plan read selects ${forbidden}`);
  }
  // ONE plan lookup, shared by both operations, and it is handed the VERIFIED id
  // by the committed cores rather than the requested one.
  assert.equal((CODE.match(/function findExamPlanByCourseOfferingId\(/g) ?? []).length, 1);
});

test("t12. the session read is a PLAN-SCOPED findFirst that selects the id ALONE", () => {
  const reader = bodyOf("findSessionForPlan");
  assert.ok(
    reader.includes("prisma.examSession.findFirst("),
    "the session read is not a findFirst",
  );
  assert.ok(
    /where:\s*\{\s*id:\s*sessionId,\s*planId,?\s*\}/.test(reader),
    `the session where was: ${reader}`,
  );
  // A bare findUnique by id would find another plan's session and then rely on a
  // comparison someone could later remove.
  assert.equal(CODE.includes("examSession.findUnique"), false);
  // The helper takes the SERVER-supplied plan id as its FIRST parameter.
  assert.ok(/function findSessionForPlan\(\s*planId: string,/.test(SOURCE));

  // EXACTLY one selected column: the id. No definition, and no session detail.
  const columns = [...reader.matchAll(/^\s+(\w+): true,/gm)].map((match) => match[1]);
  assert.deepEqual(columns, ["id"]);
  for (const forbidden of [
    "definition",
    "kind",
    "requiresLessonTopic",
    "requiresDiscipline",
    "requiresInstructedTrainee",
    "supervisors",
    "assignments",
    "_count",
    "parallelCapacity",
    "durationMinutes",
    "date",
    "startTime",
    "endTime",
    "arena",
    "orderIndex",
    "individualPublishedAt",
    "phase",
    "include",
  ]) {
    assert.equal(reader.includes(forbidden), false, `the session read selects ${forbidden}`);
  }
});

test("t13. eligibility is ONE fail-closed active-instructor findFirst, id-only", () => {
  const reader = bodyOf("findEligibleInstructor");
  assert.ok(reader.includes("prisma.instructor.findFirst("));
  assert.equal(CODE.includes("instructor.findUnique"), false);
  // Both conditions in ONE where clause: no application-side comparison, and no
  // window between "does this person exist?" and "are they active?".
  for (const condition of ["id: instructorId,", "isActive: true,"]) {
    assert.ok(reader.includes(condition), `the eligibility where lacks: ${condition}`);
  }
  assert.ok(/select:\s*\{\s*id:\s*true,?\s*\}/.test(reader));
  // The SERVER-matched id is what is returned, never the submitted one.
  assert.ok(/instructorId:\s*row\.id,/.test(reader));

  // The committed contract's offering parameter is still the FIRST parameter —
  // the seam a course-scoped rule will use.
  assert.ok(
    /function findEligibleInstructor\(\s*verifiedCourseOfferingId: string,/.test(SOURCE),
    "the offering seam was dropped from the eligibility signature",
  );

  // NO personal or permission column is read, and no invented course relation is
  // consulted.
  for (const forbidden of [
    "fullName",
    "firstName",
    "lastName",
    "identityNumber",
    "phone",
    "email",
    "canEdit",
    "canSend",
    "canManage",
    "courseEnrollment",
    "courseOfferingCapability",
    "courseGroup",
    "teachingPractice",
    "include",
  ]) {
    assert.equal(reader.includes(forbidden), false, `the eligibility read reads ${forbidden}`);
  }
  // The limitation is documented rather than hidden, and so is the latent
  // contact-visibility coupling that will force it to be revisited.
  const flat = COMMENTS.replace(/^\s*\*/gm, "").replace(/\s+/g, " ");
  assert.ok(
    /no relation between an .?Instructor.? and a .?CourseOffering/i.test(flat),
    "the missing course relation is undocumented",
  );
  assert.ok(
    /parent-contact visibility|parent contacts/i.test(flat),
    "the contact-visibility coupling is undocumented",
  );
});

test("t14. the create writes EXACTLY the pair, and invents no column", () => {
  const writer = bodyOf("createSupervisor");
  assert.ok(writer.includes("prisma.examSessionSupervisor.create("));
  const dataStart = writer.indexOf("data: {");
  assert.ok(dataStart > 0);
  const data = writer.slice(dataStart, writer.indexOf("select:", dataStart));
  const columns = [...data.matchAll(/^\s+(\w+):/gm)].map((match) => match[1]);
  assert.deepEqual(columns, ["sessionId", "instructorId"]);
  assert.ok(data.includes("sessionId: storedSessionId,"));
  assert.ok(data.includes("instructorId: eligibleInstructorId,"));

  // No sequence, kind, tier, responsibility or examiner-set concept exists
  // ANYWHERE in the module — the supervisors of a session are an unordered SET
  // with no position column.
  for (const forbidden of [
    "orderIndex",
    "reorder",
    "role",
    "isPrimary",
    "isResponsible",
    "supervisorRole",
    "SupervisorKind",
    "examiner",
    "Examiner",
    "responsibleInstructorId",
  ]) {
    assert.equal(CODE.includes(forbidden), false, `the module names ${forbidden}`);
  }
  // ...and the written columns are the pair alone: no timestamp, no plan id and
  // no offering id (the last two are not columns of this table at all).
  for (const forbidden of ["createdAt", "updatedAt", "planId", "courseOfferingId", "id:"]) {
    assert.equal(data.includes(forbidden), false, `the create writes ${forbidden}`);
  }
  // The returned row is narrow: the new id and nothing else.
  assert.ok(/select:\s*\{\s*id:\s*true,?\s*\}/.test(writer));
  // Exactly ONE create statement exists in the whole module.
  assert.equal((CODE.match(/\.create\(/g) ?? []).length, 1);
});

test("t15. the removal target is read PLAN-SCOPED and deleted by the STORED id", () => {
  const reader = bodyOf("findSupervisorForPlan");
  assert.ok(reader.includes("prisma.examSessionSupervisor.findFirst("));
  assert.ok(
    /where:\s*\{\s*id:\s*supervisorId,\s*session:\s*\{\s*planId,?\s*\},?\s*\}/.test(reader),
    `the scoped where was: ${reader}`,
  );
  assert.ok(/select:\s*\{\s*id:\s*true,?\s*\}/.test(reader));
  assert.equal(CODE.includes("examSessionSupervisor.findUnique"), false);
  // A relation FILTER, never an include: no session row is materialized.
  assert.equal(reader.includes("include"), false);
  assert.ok(/function findSupervisorForPlan\(\s*planId: string,/.test(SOURCE));

  const writer = bodyOf("deleteSupervisor");
  assert.ok(
    writer.includes("prisma.examSessionSupervisor.delete("),
    "the removal is not a delete",
  );
  assert.ok(
    /where:\s*\{\s*id:\s*storedSupervisorId,?\s*\}/.test(writer),
    `the delete where was: ${writer}`,
  );
  assert.ok(/select:\s*\{\s*id:\s*true,?\s*\}/.test(writer));
  // The delete takes the id the SCOPED READ returned: the committed core passes
  // `existing.id`, and this binding's parameter is named for exactly that. The
  // raw submitted value has no path to this statement.
  assert.ok(
    /function deleteSupervisor\(storedSupervisorId: string\): Promise<void>/.test(SOURCE),
  );
  assert.equal(writer.includes("supervisorId:"), false, "a raw id reaches the delete");
  // Exactly ONE delete statement exists in the whole module, and it is a
  // `delete`, never a `deleteMany`.
  assert.equal((CODE.match(/\.delete\(/g) ?? []).length, 1);
  // Nothing is renumbered, compacted, tallied or version-checked afterwards.
  for (const token of ["compact", "renumber", "supervisorCount", "expectedUpdatedAt", "version"]) {
    assert.equal(writer.includes(token), false, `the removal performs ${token}`);
  }
  // The P2025 decision is documented rather than implemented: it PROPAGATES.
  assert.ok(/P2025/.test(COMMENTS), "the P2025 propagation is undocumented");
  assert.equal(CODE.includes("P2025"), false, "the binding classifies P2025");
});

// ===========================================================================
// 16–18. The duplicate-pair classifier
// ===========================================================================

test("t16. the conflict classifier names the EXACT unique index", () => {
  assert.ok(
    /const EXAM_SUPERVISOR_CONFLICT_INDEX\s*=\s*"exam_session_supervisors_sessionId_instructorId_key";/.test(
      CODE,
    ),
    "the exact index name is missing",
  );
  // The index name is used ONLY by this classifier, and matched EXACTLY.
  const classifier = bodyOf("isExamSupervisorConflictError");
  assert.ok(/target === EXAM_SUPERVISOR_CONFLICT_INDEX/.test(classifier));
  assert.equal(/\.includes\(EXAM_SUPERVISOR_CONFLICT_INDEX\)/.test(CODE), false);
  assert.equal(/startsWith\(EXAM_SUPERVISOR_CONFLICT_INDEX/.test(CODE), false);
  assert.equal(/endsWith\(EXAM_SUPERVISOR_CONFLICT_INDEX/.test(CODE), false);
});

test("t17. the classifier requires BOTH target fields, and only P2002", () => {
  const classifier = bodyOf("isExamSupervisorConflictError");
  assert.ok(/\(error as \{ code\?: unknown \}\)\.code !== "P2002"/.test(classifier));
  // The array form needs BOTH columns — a target naming only one is a different
  // key and must NOT be reported as "already supervising".
  assert.ok(
    /tokens\.includes\("sessionId"\) && tokens\.includes\("instructorId"\)/.test(classifier),
    "the array form does not require both fields",
  );
  assert.equal(/\.some\(/.test(classifier), false, "the array form matches on one field");
  assert.equal(/\|\|\s*tokens\.includes/.test(classifier), false, "the array form is an OR");
  // A non-object, a null and a different Prisma code are all rejected — so an
  // unrelated P2002 with a foreign target, and a P2025 from the removal, both
  // propagate.
  assert.ok(/typeof error !== "object" \|\| error === null/.test(classifier));
  // The unreadable-metadata fallback is the LAST statement, reached only after
  // both readable shapes were tried.
  assert.ok(
    classifier.lastIndexOf("return true;") > classifier.indexOf("typeof target === \"string\""),
    "the fallback is not the final arm",
  );
  // A framework redirect carries a digest, not a code, so it can never match.
  assert.equal(classifier.includes("digest"), false);
  // The raw error is never unwrapped, logged or echoed.
  for (const token of ["console.", "JSON.stringify", "error.message", "String(error)"]) {
    assert.equal(classifier.includes(token), false, `the classifier ${token}s the error`);
  }
});

test("t18. the classifier is PRIVATE, and is bound to the CREATE only", () => {
  assert.equal(
    CODE.includes("export function isExamSupervisorConflictError"),
    false,
    "the classifier is exported",
  );
  assert.equal((CODE.match(/"P2002"/g) ?? []).length, 1, "P2002 is handled in two places");
  // Declared once, bound once — and the removal's dependency bag does not name it.
  assert.equal(
    (CODE.match(/isExamSupervisorConflictError/g) ?? []).length,
    2,
    "the classifier is declared once and bound once",
  );
  assert.equal(bodyOf("deleteExamSupervisor").includes("isExamSupervisorConflictError"), false);
  // The fallback for unreadable metadata is documented rather than silent.
  assert.ok(/[Uu]nreadable/.test(COMMENTS), "the fallback is undocumented");
});

// ===========================================================================
// 19–23. Containment: no caller, no UI, six new files, nothing modified
// ===========================================================================

test("t19. NOTHING calls either writer: the module is deliberately unwired", () => {
  const declaring = new Set([join(REPO_ROOT, IO_REL), join(REPO_ROOT, IO_TEST_REL)]);
  // The committed pure cores DECLARE these symbols, and their own suites
  // legitimately drive the injectable orchestrations with fakes — as does the
  // sibling input core's suite, whose directory-listing guard necessarily names
  // the two orchestration files. Nothing else may reach any of these symbols.
  const ownSuites = new Set(
    [
      join("lib", "exam", "create-exam-supervisor-core.ts"),
      join("lib", "exam", "create-exam-supervisor-core.test.ts"),
      join("lib", "exam", "delete-exam-supervisor-core.ts"),
      join("lib", "exam", "delete-exam-supervisor-core.test.ts"),
      join("lib", "exam", "exam-supervisor-write-core.test.ts"),
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
        /exam-supervisor-write-io/.test(code) ||
        /(create|delete)-exam-supervisor-core/.test(code) ||
        /\b(create|delete)ExamSupervisor\s*\(/.test(code) ||
        /\b(create|delete)ExamSupervisorWithDeps\s*\(/.test(code);
      if (reaches) callers.push(path.slice(REPO_ROOT.length + 1));
    }
  }
  // Sanity: the clean result below is a PASS, not an empty search.
  assert.ok(scanned > 100, `expected the repository, scanned ${scanned} files`);
  assert.deepEqual(callers, [], `an unapproved caller exists: ${callers.join(", ")}`);
});

test("t20. no exam route, page, form or Server Action was created", () => {
  for (const dir of [
    join("app", "admin", "exams"),
    join("app", "instructor", "exams"),
    join("app", "student", "exams"),
  ]) {
    assert.equal(existsSync(join(REPO_ROOT, dir)), false, `${dir} was created`);
  }
  for (const file of [
    join("lib", "actions", "exam-supervisor-actions.ts"),
    join("lib", "actions", "exam-supervisors.ts"),
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

test("t21. each approved file-prefix set contains EXACTLY its approved pair", () => {
  const actions = readdirSync(join(REPO_ROOT, "lib", "actions"));
  assert.deepEqual(
    actions.filter((name) => name.startsWith("exam-supervisor-write")).sort(),
    ["exam-supervisor-write-io.test.ts", "exam-supervisor-write-io.ts"],
  );
  // Assembled for the reason the NEW_FILES comment gives.
  assert.deepEqual(
    actions.filter((name) => name.startsWith("exam-supervisor-read")).sort(),
    ["exam-supervisor-read" + "-io.test.ts", "exam-supervisor-read" + "-io.ts"],
  );
  // The committed supervisor guard pins the six lib/exam files whose names begin
  // with the three core prefixes; this slice's core deliberately sits OUTSIDE
  // that set, under its own prefix.
  const exam = readdirSync(join(REPO_ROOT, "lib", "exam"));
  assert.deepEqual(
    exam.filter((name) => name.startsWith("admin-exam-supervisor-read")).sort(),
    ["admin-exam-supervisor-read" + "-core.test.ts", "admin-exam-supervisor-read" + "-core.ts"],
  );
  assert.deepEqual(
    exam.filter((name) => /^(exam|create-exam|delete-exam)-supervisor-/.test(name)).sort(),
    [
      "create-exam-supervisor-core.test.ts",
      "create-exam-supervisor-core.ts",
      "delete-exam-supervisor-core.test.ts",
      "delete-exam-supervisor-core.ts",
      "exam-supervisor-write-core.test.ts",
      "exam-supervisor-write-core.ts",
    ],
  );
});

test("t22. the slice modified NO tracked file: no schema, migration, auth or policy", () => {
  // `--diff-filter=MDRT` excludes additions on purpose: a brand-new file is what
  // this slice is allowed to produce, and including additions would make the
  // check flip to red the moment the new files are staged and back to green
  // after they are committed.
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
  // EX-ASG-LTD2-B1 TRANSITION. This assertion was `deepEqual(modified, [])`, which
  // was correct while nothing else lived in this working tree. The approved ADMIN
  // READ DETAIL slice — which publishes two stored EXAM ASSIGNMENT columns on the
  // admin exams page — shares the tree, so the guard is RE-POINTED to an EXACT
  // path list rather than deleted or weakened to "some files changed".
  //
  // What it always protected is unchanged and is what the list proves: NOT ONE
  // supervisor module of any kind, no schema, no migration, no auth module, no
  // session module, no capability catalog and no course-policy core. The only two
  // PRODUCTION files under `lib/` are the assignment READ pair, and this suite's
  // own binding and pure core are re-asserted present and unduplicated below.
  //
  // The `lib/` entries are ASSEMBLED: several of those suites pin caller
  // allow-lists by sweeping `lib/` for their own module names, and a file that
  // spelled one whole would enrol itself as a caller of a module it never calls.
  const ROUTE = "app/admin/courses/[courseOfferingId]/exams/";
  const APPROVED_MODIFICATIONS = [
    `${ROUTE}page.tsx`,
    `${ROUTE}exam-assignment-ui.contract.test.ts`,
    `${ROUTE}exam-definition-create.contract.test.ts`,
    `${ROUTE}exam-definitions-page.contract.test.ts`,
    `${ROUTE}exam-instructed-trainee-assignment-ui.contract.test.ts`,
    `${ROUTE}exam-plan-create.contract.test.ts`,
    `${ROUTE}exam-session-create.contract.test.ts`,
    `${ROUTE}exam-session-edit-delete.contract.test.ts`,
    "lib/exam/" + "admin-exam-assignment-read" + "-core.ts",
    "lib/exam/" + "admin-exam-assignment-read" + "-core.test.ts",
    "lib/actions/" + "exam-assignment-read" + "-io.ts",
    "lib/actions/" + "exam-assignment-read" + "-io.test.ts",
    "lib/actions/" + "exam-assignment-write" + "-io.test.ts",
    "lib/actions/" + "exam-definition-read" + "-io.test.ts",
    "lib/actions/" + "admin-exam-session-read" + "-io.test.ts",
    "lib/actions/" + "exam-session-write" + "-io.test.ts",
    "lib/actions/" + "exam-plan-write" + "-io.test.ts",
    "lib/actions/" + "exam-instructed-trainee-assignment-write" + "-io.test.ts",
    "lib/actions/" + "exam-supervisor-read" + "-io.test.ts",
    "lib/actions/" + "exam-supervisor-write" + "-io.test.ts",
    "lib/exam/" + "create-exam-plan" + "-core.test.ts",
    "lib/exam/" + "exam-supervisor-write" + "-core.test.ts",
    // EX-ASG-LTD2-B2 - the approved DETAILED examinee assignment UI wiring, which
    // travels in the same working tree. It switches the route's ONE existing create
    // endpoint to the committed detailed writer, which brings that route's examinee
    // create form and its route-local assignment message table into the modified set,
    // plus the detailed writer's own committed guard, whose caller list it re-points
    // from zero to exactly one Server Action module. The last path is ASSEMBLED,
    // because that guard sweeps `app/`, `lib/` and `components/` for its own module
    // name. Nothing here changes which module THIS guard is about: no new route file,
    // Server Action, query key or component exists, no `lib/` production module is
    // edited, and no schema, migration, auth, session, capability or policy file
    // appears.
    `${ROUTE}actions.ts`,
    `${ROUTE}CreateExamAssignmentForm.tsx`,
    `${ROUTE}exam-assignment-messages.ts`,
    "lib/actions/" + "detailed-exam-assignment-write" + "-io.test.ts",
    // EX-PAIR-BE-MVP — the approved instructed-trainee/examinee PAIRING backend,
    // which travels in the same working tree. Its four `lib/` additions re-point
    // the footprint list of the neighbouring publication backend's guard SUITE,
    // so that suite joins the modified set. It is a `.test.ts`; no production
    // file, no route, no Server Action and no schema, migration, auth, session,
    // capability or policy file comes with it, and no supervisor module is
    // touched by it.
    "lib/actions/" + "exam-publication-write" + "-io.test.ts",
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
    "lib/actions/" + "exam-instructed-trainee-assignment-write" + "-io.test.ts",
    "lib/actions/" + "exam-pairing-write" + "-io.test.ts",
    "lib/actions/" + "exam-plan-write" + "-io.test.ts",
    "lib/actions/" + "exam-publication-write" + "-io.test.ts",
    "lib/actions/" + "exam-session-write" + "-io.test.ts",
    "lib/actions/" + "exam-supervisor-read" + "-io.test.ts",
    "lib/actions/" + "exam-supervisor-write" + "-io.test.ts",
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
  ];
  const unapproved = modified.filter((path) => !APPROVED_MODIFICATIONS.includes(path)).sort();
  assert.deepEqual(unapproved, [], `the slice modified: ${unapproved.join(", ")}`);

  // Every approved entry is a guard SUITE, one route page, or one of the two
  // assignment READ production modules — so no supervisor production file, and no
  // third `lib/` production module of any kind, can enter this list unnoticed.
  const APPROVED_PRODUCTION = [
    // RE-POINTED by EX-ASG-LTD2-B2: the examinee create FORM and the route-local
    // assignment MESSAGE TABLE are production files of that same one route, and the
    // detailed-writer wiring edits both. Each is named EXACTLY - no directory, no
    // prefix, no glob - so a further production file still fails here.
    `${ROUTE}actions.ts`,
    `${ROUTE}CreateExamAssignmentForm.tsx`,
    `${ROUTE}exam-assignment-messages.ts`,
    `${ROUTE}page.tsx`,
    "lib/exam/" + "admin-exam-assignment-read" + "-core.ts",
    "lib/actions/" + "exam-assignment-read" + "-io.ts",
    // EX-BEGINNER-EXAM-READ - the Level-1 beginner containment gate plus the
    // trainee-only assignment `isSelf` marker. Beginner Teaching-Practice rows are
    // gated to Level 1 in the loader, and the trainee narrowing marks the viewer's
    // own assignment by exact student id. Every path below is named EXACTLY - no
    // directory, no prefix, no glob - so an unrelated file still fails this guard,
    // and each module name is SPLIT so this list never enrols itself as a caller.
    "lib/exam/" + "exam-beginner-course-scope" + "-core.ts",
    "lib/exam/" + "exam-plan-loader" + "-core.ts",
    "lib/exam/" + "exam-rea" + "d-dto.ts",
    "lib/exam/" + "exam-read-scope" + "-core.ts",
    "lib/exam/" + "exam-trainee-view" + "-core.ts",
  ];
  for (const path of APPROVED_MODIFICATIONS) {
    assert.ok(
      path.endsWith(".test.ts") || APPROVED_PRODUCTION.includes(path),
      `${path} is neither a suite nor an approved production file`,
    );
    assert.equal(/supervisor/.test(path) && !path.endsWith(".test.ts"), false, `${path}`);
  }

  // ...and every working-tree entry under `prisma/` — untracked included — is
  // empty, so no migration directory was added either.
  const prismaStatus = gitLines(["status", "--porcelain", "--", "prisma"]);
  assert.deepEqual(prismaStatus, [], `prisma/ changed: ${prismaStatus.join(", ")}`);

  // The committed pure cores this module BINDS were not edited or duplicated.
  for (const rel of [
    join("lib", "exam", "exam-supervisor-write-core.ts"),
    join("lib", "exam", "create-exam-supervisor-core.ts"),
    join("lib", "exam", "delete-exam-supervisor-core.ts"),
    join("lib", "course", "admin-course-context.ts"),
    join("lib", "course", "operation-policy-core.ts"),
  ]) {
    assert.ok(existsSync(join(REPO_ROOT, rel)), `${rel} is missing`);
  }

  // No file in this slice hardcodes a cuid-shaped identifier.
  for (const rel of NEW_FILES) {
    const source = readFileSync(join(REPO_ROOT, rel.split("/").join(sep)), "utf8");
    assert.equal(
      /["']c[a-z0-9]{24}["']/.test(source),
      false,
      `${rel} hardcodes a cuid-shaped literal`,
    );
  }
});

test("t23. this suite opens no database and reads no environment", () => {
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
