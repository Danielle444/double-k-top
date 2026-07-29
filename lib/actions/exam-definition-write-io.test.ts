/**
 * EXAM EX-S5B-2 — STRUCTURAL tests for the ExamDefinition CREATE binding
 * (lib/actions/exam-definition-write-io.ts).
 *
 * Run with: npx tsx --test lib/actions/exam-definition-write-io.test.ts
 *
 * WHY SOURCE-TEXT TESTS. The module under test declares `import "server-only"`,
 * which is exactly the guarantee this slice wants — and which makes the module
 * UNIMPORTABLE under bare `tsx` outside the Next build (and, deliberately,
 * unimportable from any client bundle). The same approach the committed
 * `exam-read.contract` suite takes is used here: this suite reads the module's
 * SOURCE and asserts on its structure, while the BEHAVIOUR of the operation is
 * proven at runtime against the pure core with fakes, in
 * lib/exam/create-exam-definition-core.test.ts.
 *
 * DB-FREE AND PRODUCTION-FREE: no database connection is opened, no SQL is
 * executed, no environment variable is read, no network call is made, and no
 * production identifier appears anywhere.
 *
 * WHAT IS PROVEN HERE:
 *   - server-only, and NOT a Server Action module;
 *   - the public signature is exactly (courseOfferingId, rawInput) — no plan,
 *     definition, order or actor parameter;
 *   - admin authorization + the SCHEDULE_DRAFT_CONFIGURATION lifecycle gate are
 *     the bindings, and NO capability is consulted;
 *   - the EXACT Prisma call inventory: one ExamPlan findUnique selecting `id`,
 *     and one transaction containing one aggregate and one create;
 *   - the create payload carries every normalized field, the server-resolved
 *     plan id and the server-computed order — and nothing else;
 *   - the concurrency limitation is DOCUMENTED rather than hidden;
 *   - the slice is exactly four files, with no route, page, action or UI caller.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

const IO_REL = join("lib", "actions", "exam-definition-write-io.ts");
const IO_TEST_REL = join("lib", "actions", "exam-definition-write-io.test.ts");
const CORE_REL = join("lib", "exam", "create-exam-definition-core.ts");
const CORE_TEST_REL = join("lib", "exam", "create-exam-definition-core.test.ts");

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

// ===========================================================================
// 41–46. Module kind and public signature
// ===========================================================================

test("41. the module imports server-only as its first statement", () => {
  const serverOnly = new RegExp('import\\s+"server' + '-only";');
  assert.ok(serverOnly.test(CODE), "the module is not server-only");
  // FIRST statement: nothing executable precedes the marker.
  const firstStatement = CODE.split("\n").find((line) => line.trim().length > 0);
  assert.ok(firstStatement);
  assert.ok(serverOnly.test(firstStatement), `the first statement is: ${firstStatement}`);
});

test("42. the module does NOT declare use server (or use client)", () => {
  assert.equal(CODE.includes('"use ' + 'server"'), false);
  assert.equal(CODE.includes("'use " + "server'"), false);
  assert.equal(CODE.includes('"use ' + 'client"'), false);
  // ...and the header states the rule it holds itself to.
  assert.ok(COMMENTS.includes("use " + "server"), "the rule is undocumented");
});

/** Every exported function signature in the module. */
const SIGNATURES = [
  ...SOURCE.matchAll(/export (?:async )?function (\w+)\(([\s\S]*?)\):\s*([^{]+)\{/g),
].map(([, name, params, returns]) => ({
  name,
  params: params.replace(/\s+/g, " ").trim(),
  returns: returns.replace(/\s+/g, " ").trim(),
}));

test("43. the module exports exactly ONE ordinary function: createExamDefinition", () => {
  assert.deepEqual(
    SIGNATURES.map((signature) => signature.name),
    ["createExamDefinition"],
  );
  const [signature] = SIGNATURES;
  assert.equal(signature.returns, "Promise<CreateExamDefinitionResult>");
  // An ordinary async server function — not a generated action, not a handler.
  assert.ok(/export async function createExamDefinition\(/.test(SOURCE));
  for (const token of ["export const", "export default", "GET", "POST", "NextRequest", "NextResponse"]) {
    assert.equal(CODE.includes(token), false, `the module declares ${token}`);
  }
});

test("44. the exported function accepts ONLY courseOfferingId + rawInput", () => {
  const [signature] = SIGNATURES;
  assert.equal(signature.params, "courseOfferingId: string, rawInput: unknown,");
});

test("45. the exported function has NO planId parameter", () => {
  const [signature] = SIGNATURES;
  assert.equal(signature.params.includes("planId"), false);
  assert.equal(signature.params.includes("plan"), false);
});

test("46. the exported function has no definition, order or actor parameter", () => {
  const [signature] = SIGNATURES;
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
    assert.equal(
      signature.params.includes(forbidden),
      false,
      `createExamDefinition accepts ${forbidden}`,
    );
  }
});

// ===========================================================================
// 47–51. Authorization, lifecycle, and what is NOT consulted
// ===========================================================================

test("47. the module binds requireAdminCourseOffering", () => {
  assert.ok(CODE.includes("requireAdminCourseOffering"), "the admin boundary is not bound");
  assert.ok(
    /requireAdminCourseOffering\(requestedCourseOfferingId\)/.test(CODE),
    "the admin boundary is not called with the requested id",
  );
  // The typed not-found is classified rather than caught broadly.
  assert.ok(CODE.includes("CourseOfferingNotFoundError"));
  assert.equal(/catch\s*\(/.test(CODE), false, "the binding catches errors itself");
});

test("48. the ExamPlan lookup uses the VERIFIED offering id, never the requested one", () => {
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

test("49. the lifecycle gate is SCHEDULE_DRAFT_CONFIGURATION, via the committed policy", () => {
  assert.ok(CODE.includes("assertCourseOperationAllowed"));
  assert.ok(
    /assertCourseOperationAllowed\([\s\S]{0,120}?"SCHEDULE_DRAFT_CONFIGURATION"/.test(CODE),
    "the gate does not use the approved operation",
  );
  assert.ok(CODE.includes("CourseOperationNotPermittedError"));
  // Exactly ONE gate call, and no other operation token anywhere.
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

test("50. the module consults NO capability of any kind", () => {
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

test("51. the module imports no instructor or trainee actor helper", () => {
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
// 52–57. The exact Prisma call inventory
// ===========================================================================

/** Every `prisma.x.y` / `tx.x.y` call, in source order. */
const PRISMA_CALLS = CODE.match(/\b(?:prisma|tx)\.[\w$]+(?:\.[\w$]+)?/g) ?? [];

test("52. there is EXACTLY one ExamPlan findUnique", () => {
  assert.equal((CODE.match(/examPlan\.findUnique\(/g) ?? []).length, 1);
  // ...and no other ExamPlan operation of any kind.
  const planOps = CODE.match(/examPlan\.\w+/g) ?? [];
  assert.deepEqual(planOps, ["examPlan.findUnique"]);
});

test("53. the ExamPlan query selects `id` and nothing else", () => {
  const start = CODE.indexOf("examPlan.findUnique");
  const query = CODE.slice(start, CODE.indexOf("}),", start) + 3);
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

test("54. there is EXACTLY one prisma.$transaction", () => {
  assert.equal((CODE.match(/\$transaction\(/g) ?? []).length, 1);
  assert.ok(/prisma\.\$transaction\(async \(tx\) =>/.test(CODE));
  for (const token of ["$executeRaw", "$queryRaw", "$connect", "$disconnect"]) {
    assert.equal(CODE.includes(token), false, `the module uses ${token}`);
  }
});

test("55. the aggregate AND the create both run on the TRANSACTION client", () => {
  assert.ok(TRANSACTION_BODY.includes("tx.examDefinition.aggregate("));
  assert.ok(TRANSACTION_BODY.includes("tx.examDefinition.create("));
  // Neither runs on the non-transactional client.
  assert.equal(CODE.includes("prisma.examDefinition"), false, "a definition op bypasses the tx");
  // The plan lookup, conversely, is OUTSIDE the transaction.
  assert.equal(TRANSACTION_BODY.includes("examPlan"), false, "the plan query is inside the tx");
  // Exactly two statements touch the database inside it.
  assert.equal((TRANSACTION_BODY.match(/tx\.\w+\./g) ?? []).length, 2);
});

test("56. there is EXACTLY one examDefinition.aggregate, on _max.orderIndex", () => {
  assert.equal((CODE.match(/examDefinition\.aggregate\(/g) ?? []).length, 1);
  const start = CODE.indexOf("examDefinition.aggregate");
  const query = CODE.slice(start, start + 260);
  assert.ok(/where:\s*\{\s*planId,?\s*\}/.test(query), `the aggregate where was: ${query}`);
  assert.ok(/_max:\s*\{\s*orderIndex:\s*true,?\s*\}/.test(query), `the aggregate max was: ${query}`);
  // Not a count: a count would silently reuse a position after any future gap.
  assert.equal(CODE.includes(".count("), false, "the module uses count");
  assert.equal(CODE.includes("_count"), false, "the module uses _count");
});

test("57. there is EXACTLY one examDefinition.create", () => {
  assert.equal((CODE.match(/examDefinition\.create\(/g) ?? []).length, 1);
});

test("57b. the module issues EXACTLY the three approved Prisma calls, none in a loop", () => {
  assert.deepEqual(PRISMA_CALLS, [
    "prisma.$transaction",
    "tx.examDefinition.aggregate",
    "tx.examDefinition.create",
    "prisma.examPlan.findUnique",
  ]);
  for (const loop of ["for (", "for(", "while (", "forEach(", ".map(", "Promise.all"]) {
    assert.equal(CODE.includes(loop), false, `the module contains ${loop}`);
  }
});

// ===========================================================================
// 58–60. Nothing else is written
// ===========================================================================

test("58. there is no examDefinition update, delete or upsert", () => {
  for (const token of [
    "examDefinition.update",
    "examDefinition.updateMany",
    "examDefinition.delete",
    "examDefinition.deleteMany",
    "examDefinition.upsert",
    "examDefinition.createMany",
  ]) {
    assert.equal(CODE.includes(token), false, `the module performs ${token}`);
  }
});

test("59. there is no ExamPlan create, update or upsert", () => {
  const writes = /examPlan\.(create|createMany|update|updateMany|upsert|delete|deleteMany)/;
  assert.equal(writes.test(CODE), false, "the module writes an ExamPlan");
  // Nor a lazy-plan helper by any other name.
  for (const token of ["ensurePlan", "createPlan", "upsertPlan", "getOrCreate"]) {
    assert.equal(CODE.includes(token), false, `the module exposes ${token}`);
  }
});

test("60. no ExamSession, ExamAssignment or break row is written", () => {
  for (const model of [
    "examSession",
    "examAssignment",
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

// ===========================================================================
// 61–64. The create payload
// ===========================================================================

/** The `data: { ... }` object of the single create. */
const CREATE_DATA = (() => {
  const start = CODE.indexOf("examDefinition.create(");
  const dataStart = CODE.indexOf("data: {", start);
  assert.ok(dataStart > 0, "no create data was found");
  return CODE.slice(dataStart, CODE.indexOf("},", dataStart));
})();

test("61. the create data contains EVERY normalized field, from the normalized value", () => {
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

test("62. the create data includes the SERVER-RESOLVED planId", () => {
  assert.ok(/(^|\s)planId,/.test(CREATE_DATA), `planId is missing: ${CREATE_DATA}`);
  // The plan id is a PARAMETER of the write helper, supplied by the pure core
  // from the plan the server looked up — never read from the raw input.
  assert.ok(
    /function createDefinitionAtNextOrder\(\s*planId: string,/.test(SOURCE),
    "the write helper does not take a server-supplied planId",
  );
});

test("63. the create data includes the SERVER-COMPUTED orderIndex", () => {
  assert.ok(/orderIndex:\s*nextOrderIndex,/.test(CREATE_DATA), `orderIndex is missing: ${CREATE_DATA}`);
  // 0 for the first row; max + 1 afterwards. Never caller-supplied.
  assert.ok(
    /aggregate\._max\.orderIndex === null\s*\?\s*0\s*:\s*aggregate\._max\.orderIndex \+ 1/.test(
      CODE.replace(/\s+/g, " "),
    ),
    "the next-order computation is not the approved max+1 / 0 rule",
  );
  assert.equal(CREATE_DATA.includes("value.orderIndex"), false, "order came from the payload");
});

test("64. the create select is exactly id + orderIndex", () => {
  const start = CODE.indexOf("examDefinition.create(");
  const query = CODE.slice(start);
  assert.ok(
    /select:\s*\{\s*id:\s*true,\s*orderIndex:\s*true,?\s*\}/.test(query),
    "the create select is not exactly id + orderIndex",
  );
  for (const forbidden of ["name: true", "kind: true", "planId: true", "createdAt", "updatedAt", "include"]) {
    assert.equal(query.includes(forbidden), false, `the create selects ${forbidden}`);
  }
});

// ===========================================================================
// 65–70. Concurrency, preflight and error classification
// ===========================================================================

test("65. there is no duplicate-name preflight query", () => {
  // Uniqueness is the DATABASE's answer, from the @@unique([planId, name]) key.
  // A read-then-write check would be both racy and a second source of truth.
  for (const token of ["findFirst", "findMany", "existingDefinition", "countByName"]) {
    assert.equal(CODE.includes(token), false, `the module preflights via ${token}`);
  }
  const nameLookups = CODE.match(/where:\s*\{[^}]*name/g) ?? [];
  assert.deepEqual(nameLookups, [], "a query filters on the submitted name");
});

test("66. there is no loop or per-row Prisma write", () => {
  // One aggregate, one create — the transaction body contains no iteration.
  for (const loop of ["for (", "while (", "forEach(", ".map(", ".reduce("]) {
    assert.equal(TRANSACTION_BODY.includes(loop), false, `the transaction contains ${loop}`);
  }
  assert.equal((TRANSACTION_BODY.match(/await /g) ?? []).length, 1);
});

test("67. there is no transaction retry", () => {
  for (const token of ["retry", "Retry", "attempt", "backoff", "maxWait", "timeout"]) {
    assert.equal(CODE.includes(token), false, `the module configures ${token}`);
  }
});

test("68. there is no isolation-level override", () => {
  for (const token of ["isolationLevel", "Serializable", "RepeatableRead", "ReadCommitted"]) {
    assert.equal(CODE.includes(token), false, `the module sets ${token}`);
  }
  // Nor a process-local lock, which would be a false guarantee on a serverless
  // deployment with more than one instance.
  for (const token of ["Mutex", "mutex", "lockfile", "globalThis"]) {
    assert.equal(CODE.includes(token), false, `the module uses ${token}`);
  }
});

test("69. the orderIndex concurrency limitation is documented HONESTLY", () => {
  // The header must state the limitation rather than imply prevention.
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

test("70. the duplicate classifier is the committed narrow one, not a bare P2002", () => {
  // The classifier is a PURE export of the exam core (runtime-proven there);
  // this module BINDS it and defines no looser one of its own.
  assert.ok(CODE.includes("isDuplicateNameError: isExamDefinitionDuplicateNameError"));
  assert.equal(CODE.includes("P2002"), false, "the binding re-implements P2002 detection");
  assert.equal(CODE.includes('code === "P2002"'), false);
  // The two typed errors are matched by identity, so an unrelated failure — and
  // a framework redirect — cannot be classified as either.
  assert.ok(CODE.includes("error instanceof CourseOfferingNotFoundError"));
  assert.ok(CODE.includes("error instanceof CourseOperationNotPermittedError"));
  assert.equal(CODE.includes("NEXT_REDIRECT"), false, "the binding inspects redirects");
});

// ===========================================================================
// 71–74. Containment
// ===========================================================================

test("71. no notification, message or push surface is imported", () => {
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

test("72. the public function returns the pure core's narrow result, not a Prisma row", () => {
  const [signature] = SIGNATURES;
  assert.equal(signature.returns, "Promise<CreateExamDefinitionResult>");
  // It delegates wholesale: the orchestration is not reimplemented here.
  assert.ok(/return createExamDefinitionWithDeps\(courseOfferingId, rawInput, \{/.test(CODE));
  // No ordering, validation or outcome decision of its own.
  for (const token of [
    "normalizeExamDefinitionCreateInput",
    "validateExamDefinition",
    "plan_not_found",
    "invalid_input",
    "offering_not_found",
    "operation_not_allowed",
    "duplicate_name",
    "ok: false",
    "ok: true",
  ]) {
    assert.equal(CODE.includes(token), false, `the binding decides ${token} itself`);
  }
});

test("73. no app/ or client module calls this writer", () => {
  const callers: string[] = [];
  for (const dir of ["app", "lib", "components"]) {
    const root = join(REPO_ROOT, dir);
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) continue;
      const path = join(entry.parentPath ?? root, entry.name);
      if (path.includes(`${sep}generated${sep}`)) continue;
      // The three files of this slice that legitimately DECLARE these symbols:
      // the binding, its suite, and the pure core that defines the injectable
      // orchestration. Every other file in the repository is a caller.
      if (
        path === join(REPO_ROOT, IO_REL) ||
        path === join(REPO_ROOT, IO_TEST_REL) ||
        path === join(REPO_ROOT, CORE_REL)
      ) {
        continue;
      }
      const code = stripComments(readFileSync(path, "utf8"));
      if (
        /exam-definition-write-io/.test(code) ||
        /\bcreateExamDefinition\s*\(/.test(code) ||
        /createExamDefinitionWithDeps\s*\(/.test(code)
      ) {
        // The pure core's OWN suite legitimately drives the injectable
        // orchestration with fakes; nothing else may reach either symbol.
        if (path === join(REPO_ROOT, CORE_TEST_REL)) continue;
        callers.push(path.slice(REPO_ROOT.length + 1));
      }
    }
  }
  assert.deepEqual(callers, [], `an unapproved caller exists: ${callers.join(", ")}`);
});

test("74. no exam route, page or Server Action file exists for this writer", () => {
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

// ===========================================================================
// 75–78. Slice shape
// ===========================================================================

test("75. no write module under lib/exam imports a database client", () => {
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

test("76. this suite opens no database and reads no environment", () => {
  const self = stripComments(readFileSync(join(REPO_ROOT, IO_TEST_REL), "utf8"));
  // Split literals: this suite necessarily names the tokens it forbids itself.
  for (const token of [
    "DATABASE" + "_URL",
    "process" + ".env",
    "Prisma" + "Client",
    "create" + "Client",
    "supa" + "base",
  ]) {
    assert.equal(self.includes(token), false, `this suite references ${token}`);
  }
  // Its only imports are the node test runner and the filesystem.
  const specifiers = [...self.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(specifiers)].sort(), ["node:assert/strict", "node:fs", "node:path", "node:test"]);
});

test("77. the slice consists of EXACTLY the four approved files", () => {
  for (const rel of [IO_REL, CORE_REL, IO_TEST_REL, CORE_TEST_REL]) {
    assert.ok(statSync(join(REPO_ROOT, rel)).isFile(), `${rel} is missing`);
  }
  // No fifth file was added under either directory for this slice.
  const examSlice = readdirSync(join(REPO_ROOT, "lib", "exam"))
    .filter((name) => name.startsWith("create-exam-definition"))
    .sort();
  assert.deepEqual(examSlice, [
    "create-exam-definition-core.test.ts",
    "create-exam-definition-core.ts",
  ]);
  const actionsSlice = readdirSync(join(REPO_ROOT, "lib", "actions"))
    .filter((name) => name.startsWith("exam-definition-write"))
    .sort();
  assert.deepEqual(actionsSlice, [
    "exam-definition-write-io.test.ts",
    "exam-definition-write-io.ts",
  ]);
});

test("78. the slice adds no schema, migration, capability, route or UI file", () => {
  // The committed S5B-1 core is untouched by this slice: it is imported, and its
  // exports are consumed as-is.
  const committedCore = readFileSync(
    join(REPO_ROOT, "lib", "exam", "exam-definition-write-core.ts"),
    "utf8",
  );
  assert.ok(committedCore.includes("normalizeExamDefinitionCreateInput"));
  // The pure core imports it, and adds nothing to it.
  const core = readFileSync(join(REPO_ROOT, CORE_REL), "utf8");
  assert.ok(core.includes("./exam-definition-write-core"));
  // No migration directory was created for this slice.
  const migrations = readdirSync(join(REPO_ROOT, "prisma", "migrations")).filter((name) =>
    /definition/i.test(name),
  );
  assert.deepEqual(migrations, ["20260730120000_add_exam_definition_and_breaks"]);
});
