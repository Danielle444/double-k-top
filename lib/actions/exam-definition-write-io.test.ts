/**
 * EXAM EX-S5B-2 / EX-S5B-3 — STRUCTURAL tests for the ExamDefinition WRITE
 * bindings (lib/actions/exam-definition-write-io.ts).
 *
 * Run with: npx tsx --test lib/actions/exam-definition-write-io.test.ts
 *
 * WHY SOURCE-TEXT TESTS. The module under test declares `import "server-only"`,
 * which is exactly the guarantee this slice wants — and which makes the module
 * UNIMPORTABLE under bare `tsx` outside the Next build (and, deliberately,
 * unimportable from any client bundle). The same approach the committed
 * `exam-read.contract` suite takes is used here: this suite reads the module's
 * SOURCE and asserts on its structure, while the BEHAVIOUR of each operation is
 * proven at runtime against its pure core with fakes, in
 * lib/exam/create-exam-definition-core.test.ts,
 * lib/exam/update-exam-definition-core.test.ts and
 * lib/exam/delete-exam-definition-core.test.ts.
 *
 * DB-FREE AND PRODUCTION-FREE: no database connection is opened, no SQL is
 * executed, no environment variable is read, no network call is made, and no
 * production identifier appears anywhere.
 *
 * NUMBERING. The `C`-prefixed tests are the committed EX-S5B-2 CREATE guards,
 * retained verbatim except where the module legitimately grew; the plain-numbered
 * tests 59–90 are the EX-S5B-3 requirement list for the EDIT and REMOVAL
 * bindings.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

const IO_REL = join("lib", "actions", "exam-definition-write-io.ts");
const IO_TEST_REL = join("lib", "actions", "exam-definition-write-io.test.ts");
const CREATE_CORE_REL = join("lib", "exam", "create-exam-definition-core.ts");
const CREATE_CORE_TEST_REL = join("lib", "exam", "create-exam-definition-core.test.ts");
const UPDATE_CORE_REL = join("lib", "exam", "update-exam-definition-core.ts");
const UPDATE_CORE_TEST_REL = join("lib", "exam", "update-exam-definition-core.test.ts");
const DELETE_CORE_REL = join("lib", "exam", "delete-exam-definition-core.ts");
const DELETE_CORE_TEST_REL = join("lib", "exam", "delete-exam-definition-core.test.ts");

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

/**
 * The transaction call expression ONLY — extracted by paren-depth so the
 * inside/outside assertions are meaningful rather than "everything after here".
 */
const TRANSACTION_BODY = (() => {
  const open = CODE.indexOf("$transaction(");
  assert.ok(open > 0, "no transaction was found");
  const from = CODE.indexOf("(", open);
  let depth = 0;
  for (let i = from; i < CODE.length; i += 1) {
    if (CODE[i] === "(") depth += 1;
    else if (CODE[i] === ")") {
      depth -= 1;
      if (depth === 0) return CODE.slice(from, i + 1);
    }
  }
  throw new Error("the transaction call is unbalanced");
})();

/** Every exported function signature in the module, in source order. */
const SIGNATURES = [
  ...SOURCE.matchAll(/export (?:async )?function (\w+)\(([\s\S]*?)\):\s*([^{]+)\{/g),
].map(([, name, params, returns]) => ({
  name,
  params: params.replace(/\s+/g, " ").trim(),
  returns: returns.replace(/\s+/g, " ").trim(),
}));

function signature(name: string): { name: string; params: string; returns: string } {
  const found = SIGNATURES.find((entry) => entry.name === name);
  assert.ok(found, `${name} is not exported`);
  return found;
}

/** Every `prisma.x.y` / `tx.x.y` call, in source order. */
const PRISMA_CALLS = CODE.match(/\b(?:prisma|tx)\.[\w$]+(?:\.[\w$]+)?/g) ?? [];

/** Every `where: { ... }` object of the module, as flat text. */
const WHERE_CLAUSES = CODE.match(/where:\s*\{[^}]*\}/g) ?? [];

// ===========================================================================
// C41–C46. Module kind and the CREATE signature
// ===========================================================================

test("C41. the module imports server-only as its first statement", () => {
  const serverOnly = new RegExp('import\\s+"server' + '-only";');
  assert.ok(serverOnly.test(CODE), "the module is not server-only");
  // FIRST statement: nothing executable precedes the marker.
  const firstStatement = CODE.split("\n").find((line) => line.trim().length > 0);
  assert.ok(firstStatement);
  assert.ok(serverOnly.test(firstStatement), `the first statement is: ${firstStatement}`);
});

test("C42. the module does NOT declare use server (or use client)", () => {
  assert.equal(CODE.includes('"use ' + 'server"'), false);
  assert.equal(CODE.includes("'use " + "server'"), false);
  assert.equal(CODE.includes('"use ' + 'client"'), false);
  // ...and the header states the rule it holds itself to.
  assert.ok(COMMENTS.includes("use " + "server"), "the rule is undocumented");
});

test("C43. the module exports exactly THREE ordinary functions", () => {
  assert.deepEqual(SIGNATURES.map((entry) => entry.name), [
    "createExamDefinition",
    "updateExamDefinition",
    "deleteExamDefinition",
  ]);
  // Ordinary async server functions — not generated actions, not handlers.
  for (const name of ["createExamDefinition", "updateExamDefinition", "deleteExamDefinition"]) {
    assert.ok(new RegExp(`export async function ${name}\\(`).test(SOURCE));
  }
  for (const token of [
    "export const",
    "export default",
    "GET",
    "POST",
    "NextRequest",
    "NextResponse",
  ]) {
    assert.equal(CODE.includes(token), false, `the module declares ${token}`);
  }
});

test("C44. createExamDefinition accepts ONLY courseOfferingId + rawInput", () => {
  assert.equal(signature("createExamDefinition").params, "courseOfferingId: string, rawInput: unknown,");
});

test("C45. createExamDefinition has NO planId parameter", () => {
  const params = signature("createExamDefinition").params;
  assert.equal(params.includes("planId"), false);
  assert.equal(params.includes("plan"), false);
});

test("C46. createExamDefinition has no definition, order, version or actor parameter", () => {
  const params = signature("createExamDefinition").params;
  for (const forbidden of [
    "definitionId",
    "examDefinitionId",
    "orderIndex",
    "adminId",
    "actorId",
    "instructorId",
    "studentId",
    "expectedUpdatedAt",
    "publish",
    "tx",
    "prisma",
    "deps",
  ]) {
    assert.equal(params.includes(forbidden), false, `createExamDefinition accepts ${forbidden}`);
  }
});

// ===========================================================================
// C47–C51. Authorization, lifecycle, and what is NOT consulted
// ===========================================================================

test("C47. the module binds requireAdminCourseOffering, exactly once", () => {
  assert.ok(CODE.includes("requireAdminCourseOffering"), "the admin boundary is not bound");
  assert.ok(
    /requireAdminCourseOffering\(requestedCourseOfferingId\)/.test(CODE),
    "the admin boundary is not called with the requested id",
  );
  assert.equal((CODE.match(/await requireAdminCourseOffering\(/g) ?? []).length, 1);
  // The typed not-found is classified rather than caught broadly.
  assert.ok(CODE.includes("CourseOfferingNotFoundError"));
  assert.equal(/catch\s*\(/.test(CODE), false, "the binding catches errors itself");
});

test("C48. the ExamPlan lookup uses the VERIFIED offering id, never the requested one", () => {
  assert.ok(
    /courseOfferingId:\s*verifiedCourseOfferingId/.test(CODE),
    "the plan lookup does not use the verified id",
  );
  // The verified id is what the admin boundary returned.
  assert.ok(/courseOfferingId:\s*context\.id/.test(CODE), "the context id is not carried forward");
  // The RAW parameter name never appears inside the plan query.
  const planQuery = CODE.slice(CODE.indexOf("examPlan.findUnique"));
  assert.equal(
    planQuery.slice(0, 200).includes("rawInput"),
    false,
    "the raw input reached the plan query",
  );
});

test("C49. the lifecycle gate is SCHEDULE_DRAFT_CONFIGURATION, via the committed policy", () => {
  assert.ok(CODE.includes("assertCourseOperationAllowed"));
  assert.ok(
    /assertCourseOperationAllowed\([\s\S]{0,120}?"SCHEDULE_DRAFT_CONFIGURATION"/.test(CODE),
    "the gate does not use the approved operation",
  );
  assert.ok(CODE.includes("CourseOperationNotPermittedError"));
  // Exactly ONE gate call, shared by all three operations, and no other
  // operation token anywhere.
  assert.equal((CODE.match(/assertCourseOperationAllowed\(/g) ?? []).length, 1);
  for (const other of [
    "OFFERING_STRUCTURE_UPDATE",
    "OFFERING_METADATA_UPDATE",
    "SCHEDULE_PUBLICATION",
    "ENROLLMENT_MANAGEMENT",
    "TEACHING_PRACTICE_OPERATION",
    "DESTRUCTIVE_MAINTENANCE",
    "EXAM_CONFIGURATION",
  ]) {
    assert.equal(CODE.includes(other), false, `the module also references ${other}`);
  }
  // The temporary reuse, and the possible dedicated operation, are documented.
  assert.ok(/EXAM_CONFIGURATION/.test(COMMENTS), "the future dedicated operation is undocumented");
  assert.ok(/lifecycle/i.test(COMMENTS), "the lifecycle reuse is undocumented");
});

test("C50. the module consults NO capability of any kind", () => {
  for (const token of [
    '"EXAMS"',
    "'EXAMS'",
    "TEACHING_PRACTICE",
    '"SCHEDULE"',
    "'SCHEDULE'",
    "CapabilityKey",
    "capability",
    "Capability",
    "getEffectiveCapabilities",
    "capability-keys",
    "offering-capabilities",
  ]) {
    assert.equal(CODE.includes(token), false, `the module consults ${token}`);
  }
  // ...and says so, so the absence reads as a decision rather than an omission.
  assert.ok(/EXAMS/.test(COMMENTS), "the missing EXAMS capability is undocumented");
});

test("C51. the module imports no instructor or trainee actor helper", () => {
  for (const token of [
    "requireCurrentInstructor",
    "requireCurrentTrainee",
    "getCurrentInstructor",
    "getCurrentTrainee",
    "resolveInstructorCourseOffering",
    "resolveTraineeCourseOffering",
    "lib/auth/actor",
    "instructorId",
    "studentId",
  ]) {
    assert.equal(CODE.includes(token), false, `the module references ${token}`);
  }
});

// ===========================================================================
// C52–C57. The CREATE Prisma inventory
// ===========================================================================

test("C52. there is EXACTLY one ExamPlan findUnique", () => {
  assert.equal((CODE.match(/examPlan\.findUnique\(/g) ?? []).length, 1);
  // ...and no other ExamPlan operation of any kind.
  const planOps = CODE.match(/examPlan\.\w+/g) ?? [];
  assert.deepEqual(planOps, ["examPlan.findUnique"]);
});

test("C53. the ExamPlan query selects `id` and nothing else", () => {
  const query = bodyOf("findExamPlanByCourseOfferingId");
  assert.ok(/select:\s*\{\s*id:\s*true,?\s*\}/.test(query), `the select was: ${query}`);
  for (const forbidden of [
    "publishedAt",
    "sourceDates",
    "sessions",
    "definitions",
    "courseOffering:",
    "createdAt",
    "updatedAt",
    "include",
  ]) {
    assert.equal(query.includes(forbidden), false, `the plan query selects ${forbidden}`);
  }
  // No upsert: a plan is never created as a side effect.
  for (const token of ["examPlan.upsert", "examPlan.create", "examPlan.update"]) {
    assert.equal(CODE.includes(token), false, `the module performs ${token}`);
  }
});

test("C54. there is EXACTLY one prisma.$transaction", () => {
  assert.equal((CODE.match(/\$transaction\(/g) ?? []).length, 1);
  assert.ok(/prisma\.\$transaction\(async \(tx\) =>/.test(CODE));
  for (const token of ["$executeRaw", "$queryRaw", "$connect", "$disconnect"]) {
    assert.equal(CODE.includes(token), false, `the module uses ${token}`);
  }
});

test("C55. the aggregate AND the create both run on the TRANSACTION client", () => {
  assert.ok(TRANSACTION_BODY.includes("tx.examDefinition.aggregate("));
  assert.ok(TRANSACTION_BODY.includes("tx.examDefinition.create("));
  // The plan lookup is OUTSIDE the transaction.
  assert.equal(TRANSACTION_BODY.includes("examPlan"), false, "the plan query is inside the tx");
  // Exactly two statements touch the database inside it.
  assert.equal((TRANSACTION_BODY.match(/tx\.\w+\./g) ?? []).length, 2);
  // No definition CREATE runs off the transaction client.
  assert.equal(CODE.includes("prisma.examDefinition.create"), false);
  assert.equal(CODE.includes("prisma.examDefinition.aggregate"), false);
});

test("C56. there is EXACTLY one examDefinition.aggregate, on _max.orderIndex", () => {
  assert.equal((CODE.match(/examDefinition\.aggregate\(/g) ?? []).length, 1);
  const helper = bodyOf("createDefinitionAtNextOrder");
  assert.ok(/where:\s*\{\s*planId,?\s*\}/.test(helper), `the aggregate where was: ${helper}`);
  assert.ok(/_max:\s*\{\s*orderIndex:\s*true,?\s*\}/.test(helper), "the aggregate max is wrong");
  // Not a count: a count would silently reuse a position after any future gap.
  assert.equal(helper.includes(".count("), false, "the create helper uses count");
  assert.equal(CODE.includes("_count"), false, "the module uses _count");
});

test("C57. there is EXACTLY one examDefinition.create", () => {
  assert.equal((CODE.match(/examDefinition\.create\(/g) ?? []).length, 1);
  assert.equal(CODE.includes("examDefinition.createMany"), false);
  assert.equal(CODE.includes("examDefinition.upsert"), false);
});

// ===========================================================================
// C59–C64. Nothing else is written, and the create payload
// ===========================================================================

test("C59. there is no ExamPlan create, update or upsert", () => {
  const writes = /examPlan\.(create|createMany|update|updateMany|upsert|delete|deleteMany)/;
  assert.equal(writes.test(CODE), false, "the module writes an ExamPlan");
  // Nor a lazy-plan helper by any other name.
  for (const token of ["ensurePlan", "createPlan", "upsertPlan", "getOrCreate"]) {
    assert.equal(CODE.includes(token), false, `the module exposes ${token}`);
  }
});

test("C60. no ExamAssignment, break, TP or roster row is touched at all", () => {
  for (const model of [
    "examAssignment",
    "examSessionBreak",
    "examBlockBreak",
    "examTeachingPracticeSourceDate",
    "teachingPractice",
    "courseOffering.",
    "courseEnrollment",
    "student.",
    "instructor.",
  ]) {
    assert.equal(CODE.includes(model), false, `the module touches ${model}`);
  }
});

/** The `data: { ... }` object of the single create. */
const CREATE_DATA = (() => {
  const start = CODE.indexOf("examDefinition.create(");
  const dataStart = CODE.indexOf("data: {", start);
  assert.ok(dataStart > 0, "no create data was found");
  return CODE.slice(dataStart, CODE.indexOf("},", dataStart));
})();

test("C61. the create data contains EVERY normalized field, from the normalized value", () => {
  for (const field of [
    "name",
    "kind",
    "durationMinutes",
    "parallelCapacity",
    "requiresInstructedTrainee",
    "requiresLessonTopic",
    "requiresDiscipline",
  ]) {
    assert.ok(
      new RegExp(`${field}:\\s*value\\.${field},`).test(CREATE_DATA),
      `${field} is missing or not taken from the normalized value`,
    );
  }
  // Nothing is read from the RAW input at the write boundary.
  assert.equal(CREATE_DATA.includes("rawInput"), false, "the create data reads raw input");
});

test("C62. the create data includes the SERVER-RESOLVED planId", () => {
  assert.ok(/(^|\s)planId,/.test(CREATE_DATA), `planId is missing: ${CREATE_DATA}`);
  assert.ok(
    /function createDefinitionAtNextOrder\(\s*planId: string,/.test(SOURCE),
    "the write helper does not take a server-supplied planId",
  );
});

test("C63. the create data includes the SERVER-COMPUTED orderIndex", () => {
  assert.ok(/orderIndex:\s*nextOrderIndex,/.test(CREATE_DATA), `orderIndex is missing`);
  assert.ok(
    /aggregate\._max\.orderIndex === null\s*\?\s*0\s*:\s*aggregate\._max\.orderIndex \+ 1/.test(
      CODE.replace(/\s+/g, " "),
    ),
    "the next-order computation is not the approved max+1 / 0 rule",
  );
  assert.equal(CREATE_DATA.includes("value.orderIndex"), false, "order came from the payload");
});

test("C64. the create select is exactly id + orderIndex", () => {
  const helper = bodyOf("createDefinitionAtNextOrder");
  assert.ok(
    /select:\s*\{\s*id:\s*true,\s*orderIndex:\s*true,?\s*\}/.test(helper),
    "the create select is not exactly id + orderIndex",
  );
  for (const forbidden of ["name: true", "kind: true", "planId: true", "createdAt", "include"]) {
    assert.equal(helper.includes(forbidden), false, `the create selects ${forbidden}`);
  }
});

// ===========================================================================
// C65–C72. Concurrency, preflight and error classification
// ===========================================================================

test("C65. no query filters on a submitted name", () => {
  // Uniqueness is the DATABASE's answer, from the @@unique([planId, name]) key.
  // A read-then-write check would be both racy and a second source of truth.
  for (const clause of WHERE_CLAUSES) {
    assert.equal(clause.includes("name"), false, `a query filters on a name: ${clause}`);
  }
  for (const token of ["existingDefinition", "countByName", "findMany"]) {
    assert.equal(CODE.includes(token), false, `the module preflights via ${token}`);
  }
});

test("C66. there is no loop or per-row Prisma write anywhere", () => {
  for (const loop of ["for (", "for(", "while (", "forEach(", ".map(", ".reduce(", "Promise.all"]) {
    assert.equal(CODE.includes(loop), false, `the module contains ${loop}`);
  }
  // One aggregate, one create — the transaction body contains no iteration.
  assert.equal((TRANSACTION_BODY.match(/await /g) ?? []).length, 1);
});

test("C67. there is no transaction retry", () => {
  for (const token of ["retry", "Retry", "attempt", "backoff", "maxWait", "timeout"]) {
    assert.equal(CODE.includes(token), false, `the module configures ${token}`);
  }
});

test("C68. there is no isolation-level override and no process-local lock", () => {
  for (const token of [
    "isolationLevel",
    "Serializable",
    "RepeatableRead",
    "ReadCommitted",
    "Mutex",
    "mutex",
    "lockfile",
    "globalThis",
  ]) {
    assert.equal(CODE.includes(token), false, `the module uses ${token}`);
  }
});

test("C69. the orderIndex concurrency limitation is documented HONESTLY", () => {
  assert.ok(/concurren/i.test(COMMENTS), "concurrency is not discussed at all");
  assert.ok(
    /(equal|same|duplicate)[^.]{0,80}orderIndex/i.test(COMMENTS),
    "the equal-orderIndex outcome is not stated",
  );
  assert.ok(/orderIndex[^.]{0,120}id/i.test(COMMENTS), "the deterministic read order is not stated");
  assert.ok(/reorder/i.test(COMMENTS), "the later normalization is not mentioned");
  // ...and must NOT claim a guarantee it does not have.
  assert.equal(
    /(guarantee|prevent|ensure)s?[^.]{0,60}unique/i.test(COMMENTS),
    false,
    "the header claims uniqueness it does not enforce",
  );
});

test("C70. the duplicate classifier is the committed narrow one, not a bare P2002", () => {
  // The classifier is a PURE export of the exam core (runtime-proven there);
  // this module BINDS it and defines no looser one of its own.
  assert.equal(
    (CODE.match(/isDuplicateNameError: isExamDefinitionDuplicateNameError/g) ?? []).length,
    2,
    "the create and the edit do not share the committed classifier",
  );
  assert.equal(CODE.includes("P2002"), false, "the binding re-implements P2002 detection");
  // The two typed errors are matched by identity, so an unrelated failure — and
  // a framework redirect — cannot be classified as either.
  assert.ok(CODE.includes("error instanceof CourseOfferingNotFoundError"));
  assert.ok(CODE.includes("error instanceof CourseOperationNotPermittedError"));
  assert.equal(CODE.includes("NEXT_REDIRECT"), false, "the binding inspects redirects");
});

test("C71. no notification, message or push surface is imported", () => {
  for (const token of [
    "notification",
    "Notification",
    "sendMessage",
    "web-push",
    "webpush",
    "push-",
    "materials",
    "revalidatePath",
    "revalidateTag",
    "redirect(",
  ]) {
    assert.equal(CODE.includes(token), false, `the module reaches ${token}`);
  }
});

test("C72. every public function returns its pure core's result and decides nothing", () => {
  assert.equal(signature("createExamDefinition").returns, "Promise<CreateExamDefinitionResult>");
  assert.ok(/return createExamDefinitionWithDeps\(courseOfferingId, rawInput, \{/.test(CODE));
  // No ordering, validation, no-op or outcome decision of its own.
  for (const token of [
    "normalizeExamDefinitionCreateInput",
    "normalizeExamDefinitionEditInput",
    "validateExamDefinition",
    "plan_not_found",
    "invalid_input",
    "offering_not_found",
    "operation_not_allowed",
    "duplicate_name",
    "definition_not_found",
    "definition_in_use",
    "stale_write",
    "changed:",
    "ok: false",
    "ok: true",
  ]) {
    assert.equal(CODE.includes(token), false, `the binding decides ${token} itself`);
  }
});

// ===========================================================================
// 59–64. The module kind and the EDIT / REMOVAL signatures
// ===========================================================================

test("59. the module still imports server-only", () => {
  assert.ok(new RegExp('import\\s+"server' + '-only";').test(CODE));
});

test("60. the module is still not a Server Action module", () => {
  assert.equal(CODE.includes('"use ' + 'server"'), false);
  assert.equal(CODE.includes("'use " + "server'"), false);
});

test("61. the existing CREATE export is unchanged", () => {
  const create = signature("createExamDefinition");
  assert.equal(create.params, "courseOfferingId: string, rawInput: unknown,");
  assert.equal(create.returns, "Promise<CreateExamDefinitionResult>");
  // It still delegates wholesale to the committed create core, and the create
  // core itself still exports what it did.
  assert.ok(/return createExamDefinitionWithDeps\(courseOfferingId, rawInput, \{/.test(CODE));
  const createCore = readFileSync(join(REPO_ROOT, CREATE_CORE_REL), "utf8");
  assert.ok(createCore.includes("export async function createExamDefinitionWithDeps("));
  assert.ok(createCore.includes("export function isExamDefinitionDuplicateNameError("));
});

test("62. the UPDATE export signature is exact", () => {
  const update = signature("updateExamDefinition");
  assert.equal(
    update.params,
    "courseOfferingId: string, definitionId: string, expectedUpdatedAt: number, rawInput: unknown,",
  );
  assert.equal(update.returns, "Promise<UpdateExamDefinitionResult>");
});

test("63. the DELETE export signature is exact", () => {
  const remove = signature("deleteExamDefinition");
  assert.equal(
    remove.params,
    "courseOfferingId: string, definitionId: string, expectedUpdatedAt: number,",
  );
  assert.equal(remove.returns, "Promise<DeleteExamDefinitionResult>");
});

test("64. no public function accepts a planId, kind, orderIndex or admin id", () => {
  for (const entry of SIGNATURES) {
    for (const forbidden of [
      "planId",
      "kind",
      "orderIndex",
      "adminId",
      "actorId",
      "instructorId",
      "studentId",
      "sessionCount",
      "publish",
      "tx",
      "prisma",
      "deps",
      "Date",
    ]) {
      assert.equal(
        entry.params.includes(forbidden),
        false,
        `${entry.name} accepts ${forbidden}`,
      );
    }
  }
});

// ===========================================================================
// 65–68. The shared, unwidened trust boundary
// ===========================================================================

test("65. no capability lookup was introduced for the edit or the removal", () => {
  for (const token of ['"EXAMS"', "capability", "Capability", "getEffectiveCapabilities"]) {
    assert.equal(CODE.includes(token), false, `the module consults ${token}`);
  }
});

test("66. no instructor or trainee actor helper was introduced", () => {
  for (const token of [
    "requireCurrentInstructor",
    "requireCurrentTrainee",
    "getCurrentInstructor",
    "getCurrentTrainee",
    "lib/auth/actor",
  ]) {
    assert.equal(CODE.includes(token), false, `the module references ${token}`);
  }
});

test("67. all three operations reuse the SAME admin/course resolution", () => {
  // One helper, bound by name three times — so the three can never drift into
  // different trust boundaries.
  assert.equal((CODE.match(/^\s*requireCourseContext,$/gm) ?? []).length, 3);
  assert.equal((CODE.match(/async function requireCourseContext\(/g) ?? []).length, 1);
  assert.equal((CODE.match(/requireAdminCourseOffering\(/g) ?? []).length, 1);
});

test("68. all three operations reuse the SAME lifecycle operation", () => {
  assert.equal((CODE.match(/^\s*assertConfigurationAllowed,$/gm) ?? []).length, 3);
  assert.equal((CODE.match(/function assertConfigurationAllowed\(/g) ?? []).length, 1);
  assert.equal((CODE.match(/"SCHEDULE_DRAFT_CONFIGURATION"/g) ?? []).length, 1);
  // The two typed classifiers are shared too.
  assert.equal((CODE.match(/^\s*isCourseNotFoundError,$/gm) ?? []).length, 3);
  assert.equal((CODE.match(/^\s*isOperationNotAllowedError,$/gm) ?? []).length, 3);
});

// ===========================================================================
// 69–78. The exact Prisma inventory of the new operations
// ===========================================================================

test("69. the plan query remains a single id-only findUnique, shared by all three", () => {
  assert.equal((CODE.match(/examPlan\.findUnique\(/g) ?? []).length, 1);
  assert.equal((CODE.match(/^\s*findExamPlanByCourseOfferingId,$/gm) ?? []).length, 3);
  const query = bodyOf("findExamPlanByCourseOfferingId");
  assert.ok(/select:\s*\{\s*id:\s*true,?\s*\}/.test(query));
});

test("70. no ExamPlan create, update or upsert was introduced", () => {
  assert.equal(
    /examPlan\.(create|createMany|update|updateMany|upsert|delete|deleteMany)/.test(CODE),
    false,
  );
});

test("71. every definition lookup is PLAN-SCOPED", () => {
  // Two narrow reads: the shared pre-read, and the post-update version re-read.
  assert.equal((CODE.match(/examDefinition\.findFirst\(/g) ?? []).length, 2);
  assert.equal(CODE.includes("examDefinition.findUnique"), false, "an unscoped lookup exists");
  for (const clause of WHERE_CLAUSES) {
    if (clause.includes("id: definitionId")) {
      assert.ok(clause.includes("planId"), `an unscoped definition where: ${clause}`);
    }
  }
  // The shared reader selects exactly the approved columns.
  const reader = bodyOf("findDefinitionForPlan");
  for (const column of [
    "id: true",
    "kind: true",
    "name: true",
    "durationMinutes: true",
    "parallelCapacity: true",
    "requiresInstructedTrainee: true",
    "requiresLessonTopic: true",
    "requiresDiscipline: true",
    "updatedAt: true",
  ]) {
    assert.ok(reader.includes(column), `the definition reader does not select ${column}`);
  }
  for (const forbidden of ["include", "sessions", "plan:", "assignments", "orderIndex", "createdAt"]) {
    assert.equal(reader.includes(forbidden), false, `the definition reader selects ${forbidden}`);
  }
});

test("72. the update data excludes kind, orderIndex and planId", () => {
  const helper = bodyOf("updateDefinitionIfCurrent");
  const dataStart = helper.indexOf("data: {");
  assert.ok(dataStart > 0, "no update data was found");
  const data = helper.slice(dataStart, helper.indexOf("},", dataStart));

  for (const field of [
    "name",
    "durationMinutes",
    "parallelCapacity",
    "requiresInstructedTrainee",
    "requiresLessonTopic",
    "requiresDiscipline",
  ]) {
    assert.ok(
      new RegExp(`${field}:\\s*value\\.${field},`).test(data),
      `${field} is missing or not taken from the normalized value`,
    );
  }
  for (const forbidden of ["kind", "orderIndex", "planId", "createdAt", "updatedAt", "rawInput"]) {
    assert.equal(data.includes(forbidden), false, `the update data writes ${forbidden}`);
  }
});

test("73. the updateMany where includes id, planId AND updatedAt", () => {
  assert.equal((CODE.match(/examDefinition\.updateMany\(/g) ?? []).length, 1);
  const helper = bodyOf("updateDefinitionIfCurrent");
  const where = helper.slice(helper.indexOf("where: {"), helper.indexOf("data: {"));
  assert.ok(/id:\s*definitionId,/.test(where), `the where lacks the id: ${where}`);
  assert.ok(/\bplanId,/.test(where), `the where lacks the plan scope: ${where}`);
  assert.ok(
    /updatedAt:\s*new Date\(expectedUpdatedAt\),/.test(where),
    `the where lacks the version check: ${where}`,
  );
  // `count === 0` is the ONLY stale signal, and it is not decided here.
  assert.ok(/written\.count === 0/.test(helper), "the conditional result is not inspected");
});

test("74. the epoch-millisecond conversion happens ONLY in this IO layer", () => {
  // Exactly twice: the conditional update and the conditional delete.
  assert.equal((CODE.match(/new Date\(expectedUpdatedAt\)/g) ?? []).length, 2);
  assert.equal((CODE.match(/new Date\(/g) ?? []).length, 2);
  // ...and back to a number on the way out, never as a Date.
  assert.equal((CODE.match(/\.updatedAt\.getTime\(\)/g) ?? []).length, 2);
  for (const token of ["Date.now(", "toISOString", "getTimezoneOffset"]) {
    assert.equal(CODE.includes(token), false, `the module uses ${token}`);
  }
  // No pure core carries a Date.
  for (const rel of [UPDATE_CORE_REL, DELETE_CORE_REL]) {
    const core = stripComments(readFileSync(join(REPO_ROOT, rel), "utf8"));
    assert.equal(/\bDate\b/.test(core), false, `${rel} references a Date`);
  }
});

test("75. the post-update query selects id + updatedAt only", () => {
  const helper = bodyOf("updateDefinitionIfCurrent");
  const after = helper.slice(helper.indexOf("findFirst("));
  assert.ok(
    /select:\s*\{\s*id:\s*true,\s*updatedAt:\s*true,?\s*\}/.test(after),
    `the post-update select is not exactly id + updatedAt: ${after}`,
  );
  for (const forbidden of ["name: true", "kind: true", "planId: true", "orderIndex", "include"]) {
    assert.equal(after.includes(forbidden), false, `the post-update read selects ${forbidden}`);
  }
});

test("76. the session count is scoped by planId AND definitionId, and is the only session query", () => {
  assert.equal((CODE.match(/examSession\.count\(/g) ?? []).length, 1);
  const helper = bodyOf("countSessionsForDefinition");
  assert.ok(/where:\s*\{\s*planId,\s*definitionId,?\s*\}/.test(helper), `the count where is wrong`);
  // No other ExamSession operation exists — in particular, no write.
  const sessionOps = CODE.match(/examSession\.\w+/g) ?? [];
  assert.deepEqual(sessionOps, ["examSession.count"]);
});

test("77. the deleteMany where includes id, planId AND updatedAt", () => {
  assert.equal((CODE.match(/examDefinition\.deleteMany\(/g) ?? []).length, 1);
  const helper = bodyOf("deleteDefinitionIfCurrent");
  assert.ok(/id:\s*definitionId,/.test(helper), "the delete lacks the id");
  assert.ok(/\bplanId,/.test(helper), "the delete lacks the plan scope");
  assert.ok(
    /updatedAt:\s*new Date\(expectedUpdatedAt\),/.test(helper),
    "the delete lacks the version check",
  );
  assert.ok(/removed\.count > 0/.test(helper), "the conditional result is not inspected");
});

test("78. there is no blind update or delete by id", () => {
  for (const token of [
    "examDefinition.update(",
    "examDefinition.delete(",
    "examDefinition.upsert(",
    "examDefinition.createMany(",
    "examDefinition.updateManyAndReturn(",
  ]) {
    assert.equal(CODE.includes(token), false, `the module performs ${token}`);
  }
  // Every statement that targets a single definition is BOTH id- and
  // plan-scoped; there is no `where: { id }` anywhere.
  assert.equal(/where:\s*\{\s*id:\s*definitionId,?\s*\}/.test(CODE), false);
  assert.deepEqual(PRISMA_CALLS, [
    "prisma.examPlan.findUnique",
    "prisma.$transaction",
    "tx.examDefinition.aggregate",
    "tx.examDefinition.create",
    "prisma.examDefinition.findFirst",
    "prisma.examDefinition.updateMany",
    "prisma.examDefinition.findFirst",
    "prisma.examSession.count",
    "prisma.examDefinition.deleteMany",
  ]);
});

// ===========================================================================
// 79–86. Classification and containment
// ===========================================================================

test("79. the foreign-key classifier is the committed narrow one", () => {
  assert.ok(CODE.includes("isDefinitionInUseForeignKeyError: isExamDefinitionInUseError"));
  // The binding defines no P2003 detection of its own.
  assert.equal(CODE.includes("P2003"), false, "the binding re-implements P2003 detection");
  // The committed classifier names the exact constraint and is not a bare check.
  const deleteCore = stripComments(readFileSync(join(REPO_ROOT, DELETE_CORE_REL), "utf8"));
  assert.ok(deleteCore.includes("exam_sessions_planId_definitionId_fkey"));
  assert.ok(deleteCore.includes('"P2003"'));
});

test("80. P2025 is classified nowhere as the foreign-key restriction", () => {
  assert.equal(CODE.includes("P2025"), false, "the binding inspects P2025");
  const deleteCore = stripComments(readFileSync(join(REPO_ROOT, DELETE_CORE_REL), "utf8"));
  assert.equal(deleteCore.includes("P2025"), false, "the pure classifier inspects P2025");
});

test("81. there is no transaction retry for the edit or the removal", () => {
  for (const token of ["retry", "Retry", "attempt", "backoff", "maxWait", "timeout"]) {
    assert.equal(CODE.includes(token), false, `the module configures ${token}`);
  }
  // The conditional statements are single, unwrapped calls — no extra
  // transaction was introduced for either of them.
  assert.equal((CODE.match(/\$transaction\(/g) ?? []).length, 1);
  assert.equal(bodyOf("updateDefinitionIfCurrent").includes("$transaction"), false);
  assert.equal(bodyOf("deleteDefinitionIfCurrent").includes("$transaction"), false);
});

test("82. there is no raw SQL", () => {
  for (const token of ["$executeRaw", "$queryRaw", "$executeRawUnsafe", "$queryRawUnsafe", "sql`"]) {
    assert.equal(CODE.includes(token), false, `the module uses ${token}`);
  }
});

test("83. nothing but ExamDefinition is ever written", () => {
  const writes =
    /\b(?:prisma|tx)\.(\w+)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/g;
  const written = [...CODE.matchAll(writes)].map((match) => match[1]);
  assert.deepEqual([...new Set(written)], ["examDefinition"]);
  for (const model of [
    "examSession.create",
    "examSession.update",
    "examSession.delete",
    "examAssignment",
    "student.",
    "instructor.",
    "courseOffering.",
    "courseEnrollment",
    "examPlan.update",
  ]) {
    assert.equal(CODE.includes(model), false, `the module writes ${model}`);
  }
});

test("84. no notification, message or push module is imported", () => {
  const specifiers = [...CODE.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(specifiers)].sort(), [
    "@/app/generated/prisma/client",
    "@/lib/course/admin-course-context",
    "@/lib/course/operation-policy-core",
    "@/lib/exam/create-exam-definition-core",
    "@/lib/exam/delete-exam-definition-core",
    "@/lib/exam/update-exam-definition-core",
    "@/lib/prisma",
  ]);
  for (const token of ["notification", "Notification", "web-push", "sendMessage", "push-"]) {
    assert.equal(CODE.includes(token), false, `the module reaches ${token}`);
  }
});

test("85. no app/, route, page or Server Action caller exists for any of the three writers", () => {
  const declaring = new Set(
    [IO_REL, IO_TEST_REL, CREATE_CORE_REL, UPDATE_CORE_REL, DELETE_CORE_REL].map((rel) =>
      join(REPO_ROOT, rel),
    ),
  );
  const ownSuites = new Set(
    [CREATE_CORE_TEST_REL, UPDATE_CORE_TEST_REL, DELETE_CORE_TEST_REL].map((rel) =>
      join(REPO_ROOT, rel),
    ),
  );

  const callers: string[] = [];
  for (const dir of ["app", "lib", "components"]) {
    const root = join(REPO_ROOT, dir);
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) continue;
      const path = join(entry.parentPath ?? root, entry.name);
      if (path.includes(`${sep}generated${sep}`)) continue;
      if (declaring.has(path)) continue;
      const code = stripComments(readFileSync(path, "utf8"));
      const reaches =
        /exam-definition-write-io/.test(code) ||
        /\b(?:create|update|delete)ExamDefinition\s*\(/.test(code) ||
        /(?:create|update|delete)ExamDefinitionWithDeps\s*\(/.test(code);
      // Each pure core's OWN suite legitimately drives its injectable
      // orchestration with fakes; nothing else may reach any of these symbols.
      if (reaches && !ownSuites.has(path)) {
        callers.push(path.slice(REPO_ROOT.length + 1));
      }
    }
  }
  assert.deepEqual(callers, [], `an unapproved caller exists: ${callers.join(", ")}`);

  for (const dir of [
    join("app", "admin", "exams"),
    join("app", "instructor", "exams"),
    join("app", "student", "exams"),
  ]) {
    assert.equal(existsSync(join(REPO_ROOT, dir)), false, `${dir} was created`);
  }
  for (const file of [
    join("lib", "actions", "exam-definition-actions.ts"),
    join("lib", "actions", "exams.ts"),
    join("lib", "actions", "exam-write.ts"),
  ]) {
    assert.equal(existsSync(join(REPO_ROOT, file)), false, `${file} was created`);
  }
});

test("86. no module under lib/exam imports a database client", () => {
  const PRISMA_MODULE = ["@/lib", "prisma"].join("/");
  const GENERATED_CLIENT = ["@prisma", "client"].join("/");
  const examDir = join(REPO_ROOT, "lib", "exam");
  const offenders: string[] = [];
  // MODULES, not suites: a guard suite necessarily names what it forbids.
  for (const name of readdirSync(examDir).filter(
    (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
  )) {
    const source = readFileSync(join(examDir, name), "utf8");
    for (const specifier of [PRISMA_MODULE, GENERATED_CLIENT]) {
      if (source.includes(specifier)) offenders.push(`${name} -> ${specifier}`);
    }
  }
  assert.deepEqual(offenders, [], `the exam cores must stay DB-free: ${offenders.join(", ")}`);
});

// ===========================================================================
// 87–90. Slice shape
// ===========================================================================

test("87. the committed CREATE slice is untouched by this change", () => {
  // The committed S5B-1 normalizer and the S5B-2 create core are IMPORTED and
  // consumed as-is; neither gained an export for this slice.
  const writeCore = readFileSync(join(REPO_ROOT, "lib", "exam", "exam-definition-write-core.ts"), "utf8");
  assert.ok(writeCore.includes("export function normalizeExamDefinitionCreateInput("));
  assert.ok(writeCore.includes("export function normalizeExamDefinitionEditInput("));

  const createCore = readFileSync(join(REPO_ROOT, CREATE_CORE_REL), "utf8");
  const createExports = [...createCore.matchAll(/export (?:async )?function (\w+)\(/g)].map(
    ([, name]) => name,
  );
  assert.deepEqual(createExports, [
    "isExamDefinitionDuplicateNameError",
    "createExamDefinitionWithDeps",
  ]);
  // The new cores do not import the create core: only this binding reuses its
  // duplicate-name classifier.
  for (const rel of [UPDATE_CORE_REL, DELETE_CORE_REL]) {
    const core = readFileSync(join(REPO_ROOT, rel), "utf8");
    assert.equal(core.includes("create-exam-definition-core"), false, `${rel} imports the create core`);
  }
});

test("88. the slice consists of EXACTLY the six approved files", () => {
  for (const rel of [
    IO_REL,
    IO_TEST_REL,
    CREATE_CORE_REL,
    CREATE_CORE_TEST_REL,
    UPDATE_CORE_REL,
    UPDATE_CORE_TEST_REL,
    DELETE_CORE_REL,
    DELETE_CORE_TEST_REL,
  ]) {
    assert.ok(statSync(join(REPO_ROOT, rel)).isFile(), `${rel} is missing`);
  }
  // No seventh file was added under either directory for this slice.
  const examSlice = readdirSync(join(REPO_ROOT, "lib", "exam"))
    .filter((name) => /^(create|update|delete)-exam-definition/.test(name))
    .sort();
  assert.deepEqual(examSlice, [
    "create-exam-definition-core.test.ts",
    "create-exam-definition-core.ts",
    "delete-exam-definition-core.test.ts",
    "delete-exam-definition-core.ts",
    "update-exam-definition-core.test.ts",
    "update-exam-definition-core.ts",
  ]);
  const actionsSlice = readdirSync(join(REPO_ROOT, "lib", "actions"))
    .filter((name) => name.startsWith("exam-definition-write"))
    .sort();
  assert.deepEqual(actionsSlice, [
    "exam-definition-write-io.test.ts",
    "exam-definition-write-io.ts",
  ]);
});

test("89. the slice adds no schema, migration, capability, policy, route or UI file", () => {
  // No migration directory was created for this slice: the definition table is
  // the one the committed S3 migration already added.
  const migrations = readdirSync(join(REPO_ROOT, "prisma", "migrations")).filter((name) =>
    /definition/i.test(name),
  );
  assert.deepEqual(migrations, ["20260730120000_add_exam_definition_and_breaks"]);

  // The committed course-operation policy gained no exam operation.
  const policy = readFileSync(join(REPO_ROOT, "lib", "course", "operation-policy-core.ts"), "utf8");
  assert.equal(/EXAM/.test(policy), false, "the course policy gained an exam operation");
  assert.ok(policy.includes("SCHEDULE_DRAFT_CONFIGURATION"));

  // The ExamDefinition model still has no archive column of any kind.
  const schema = readFileSync(join(REPO_ROOT, "prisma", "schema.prisma"), "utf8");
  const model = schema.slice(
    schema.indexOf("model ExamDefinition {"),
    schema.indexOf("@@map(\"exam_definitions\")"),
  );
  assert.ok(model.length > 0, "sanity: the model should be found");
  for (const column of ["archivedAt", "isArchived", "deletedAt", "isActive"]) {
    assert.equal(model.includes(column), false, `ExamDefinition gained ${column}`);
  }
});

test("90. no suite of this slice opens a database or reads the environment", () => {
  // Split literals: these suites necessarily name the tokens they forbid.
  const forbidden = [
    "DATABASE" + "_URL",
    "process" + ".env",
    "Prisma" + "Client",
    "create" + "Client",
    "supa" + "base",
  ];
  for (const rel of [IO_TEST_REL, UPDATE_CORE_TEST_REL, DELETE_CORE_TEST_REL]) {
    const self = stripComments(readFileSync(join(REPO_ROOT, rel), "utf8"));
    for (const token of forbidden) {
      assert.equal(self.includes(token), false, `${rel} references ${token}`);
    }
  }
  // This suite's only imports are the node test runner and the filesystem.
  const own = stripComments(readFileSync(join(REPO_ROOT, IO_TEST_REL), "utf8"));
  const specifiers = [...own.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(
    [...new Set(specifiers)].sort(),
    ["node:assert/strict", "node:fs", "node:path", "node:test"],
  );
});
