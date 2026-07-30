/**
 * EXAM EX-SES-S2 — STRUCTURAL tests for the stored ExamSession WRITE binding
 * (lib/actions/exam-session-write-io.ts).
 *
 * Run with: npx tsx --test lib/actions/exam-session-write-io.test.ts
 *
 * WHY SOURCE-TEXT TESTS. The module under test declares `import "server-only"`,
 * which is exactly the guarantee this slice wants — and which makes the module
 * UNIMPORTABLE under bare `tsx` outside the Next build (and, deliberately,
 * unimportable from any client bundle). This suite takes the approach the
 * committed exam read-contract and definition-write suites take: it reads the
 * module's SOURCE and asserts on its structure, while the BEHAVIOUR of the
 * operation — the locked order, every refusal, and what each failure skips — is
 * proven at runtime against its pure core with fakes, in
 * lib/exam/create-exam-session-core.test.ts.
 *
 * What that split can and cannot prove is worth stating plainly: the ORDER in
 * which authorization, the lifecycle gate, the plan lookup, validation, the
 * definition verification and the write run is a property of the pure core and is
 * proven there at runtime. What THIS suite proves is which effects the binding
 * supplies, which statements exist, on which client, inside which transaction,
 * with which filters, and that the binding itself decides nothing.
 *
 * DB-FREE AND PRODUCTION-FREE: no database connection is opened, no SQL is
 * executed, no environment variable is read, no network call is made, and no
 * production identifier appears anywhere.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { spawnSync } from "node:child_process";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

const IO_REL = join("lib", "actions", "exam-session-write-io.ts");
const IO_TEST_REL = join("lib", "actions", "exam-session-write-io.test.ts");
const CORE_REL = join("lib", "exam", "create-exam-session-core.ts");
const CORE_TEST_REL = join("lib", "exam", "create-exam-session-core.test.ts");
const INPUT_CORE_REL = join("lib", "exam", "exam-session-write-core.ts");

/** The four files this slice is allowed to add, as git reports them. */
const APPROVED_NEW_FILES = [
  "lib/actions/exam-session-write-io.test.ts",
  "lib/actions/exam-session-write-io.ts",
  "lib/exam/create-exam-session-core.test.ts",
  "lib/exam/create-exam-session-core.ts",
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

/** The single transaction call expression, extracted by paren depth. */
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
  throw new Error("the transaction is unbalanced");
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

/** The dependency object literal the public function hands the pure core. */
const DEPS_LITERAL = (() => {
  const start = CODE.indexOf("createExamSessionWithDeps(courseOfferingId, rawInput, {");
  assert.ok(start > 0, "the pure core is not bound with the expected arguments");
  const end = CODE.indexOf("});", start);
  assert.ok(end > start, "the dependency literal is unbalanced");
  return CODE.slice(start, end);
})();

/** The `data: { ... }` object of the single create. */
const CREATE_DATA = (() => {
  const start = CODE.indexOf("examSession.create(");
  assert.ok(start > 0, "no session create was found");
  const dataStart = CODE.indexOf("data: {", start);
  assert.ok(dataStart > 0, "no create data was found");
  return CODE.slice(dataStart, CODE.indexOf("},", dataStart));
})();

/** Every `where: { ... }` object of the module, as flat text. */
const WHERE_CLAUSES = CODE.match(/where:\s*\{[^}]*\}/g) ?? [];

/**
 * Database-client specifiers, assembled from SPLIT LITERALS. This suite has to
 * NAME the specifiers it asserts about — both the one the binding legitimately
 * imports and the ones the pure cores may not — while its own containment check
 * (test 36) proves the suite itself opens no database. Spelling either out would
 * make that check trip on this file.
 */
const PRISMA_MODULE = ["@/lib", "prisma"].join("/");
const GENERATED_CLIENT = ["@prisma", "client"].join("/");

/**
 * Columns of `ExamSession` this slice must NEVER write: the deprecated-and-
 * unwritten model, the derived end time, the copy-provenance columns, the
 * per-session publication column and the database-generated timestamps.
 */
const UNWRITTEN_COLUMNS = [
  "kind",
  "phase",
  "beginnerFormat",
  "endTime",
  "capacity",
  "interfaceSessionId",
  "sourceTeachingPracticeLessonId",
  "copiedAt",
  "roleLabelOverrides",
  "individualPublishedAt",
  "createdAt",
  "updatedAt",
] as const;

// ===========================================================================
// 1–5. Module kind and the public signature
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
  // ...and the header states the rule it holds itself to.
  assert.ok(COMMENTS.includes("use " + "server"), "the rule is undocumented");
});

test("3. the module exports EXACTLY one ordinary async function", () => {
  assert.deepEqual(SIGNATURES.map((entry) => entry.name), ["createExamSession"]);
  assert.ok(/export async function createExamSession\(/.test(SOURCE));
  for (const token of [
    "export const",
    "export default",
    "export class",
    "GET",
    "POST",
    "NextRequest",
    "NextResponse",
  ]) {
    assert.equal(CODE.includes(token), false, `the module declares ${token}`);
  }
});

test("4. createExamSession accepts ONLY courseOfferingId + rawInput", () => {
  const create = signature("createExamSession");
  assert.equal(create.params, "courseOfferingId: string, rawInput: unknown,");
  assert.equal(create.returns, "Promise<CreateExamSessionResult>");
});

test("5. the public function has no plan, session, order, actor or client parameter", () => {
  const params = signature("createExamSession").params;
  for (const forbidden of [
    "planId",
    "plan",
    "sessionId",
    "definitionId",
    "orderIndex",
    "date",
    "startTime",
    "endTime",
    "kind",
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
    assert.equal(params.includes(forbidden), false, `createExamSession accepts ${forbidden}`);
  }
});

// ===========================================================================
// 6–10. Authorization, the lifecycle gate, and what is NOT consulted
// ===========================================================================

test("6. the module binds requireAdminCourseOffering, exactly once, with the REQUESTED id", () => {
  assert.ok(CODE.includes("requireAdminCourseOffering"), "the admin boundary is not bound");
  assert.ok(
    /requireAdminCourseOffering\(requestedCourseOfferingId\)/.test(CODE),
    "the admin boundary is not called with the requested id",
  );
  assert.equal((CODE.match(/await requireAdminCourseOffering\(/g) ?? []).length, 1);
  // The typed not-found is classified by identity rather than caught broadly...
  assert.ok(CODE.includes("error instanceof CourseOfferingNotFoundError"));
  // ...and the module contains NO catch at all: every unrecognized throw, and
  // every framework redirect, propagates untouched.
  assert.equal((CODE.match(/catch\s*\(/g) ?? []).length, 0, "the binding catches");
  assert.equal(CODE.includes("NEXT_REDIRECT"), false, "the binding inspects redirects");
});

test("7. the admin boundary is reached BEFORE any Prisma statement", () => {
  const adminAt = CODE.indexOf("requireAdminCourseOffering(");
  const prismaAt = CODE.search(/\bprisma\./);
  assert.ok(adminAt > 0 && prismaAt > 0, "sanity: both must exist");
  assert.ok(adminAt < prismaAt, "a Prisma statement precedes the admin boundary");
  // The authorization helper itself touches no client, and the gate does not either.
  for (const helper of ["requireCourseContext", "assertConfigurationAllowed"]) {
    const body = bodyOf(helper);
    assert.equal(/\b(?:prisma|tx)\./.test(body), false, `${helper} touches a database client`);
  }
  // Only `id` and `status` are carried forward from the verified offering.
  assert.ok(/courseOfferingId:\s*context\.id/.test(CODE));
  assert.ok(/status:\s*context\.status/.test(CODE));
  for (const wide of ["context.name", "context.level", "context.startDate", "context.endDate"]) {
    assert.equal(CODE.includes(wide), false, `the binding reads ${wide}`);
  }
});

test("8. the lifecycle gate is SCHEDULE_DRAFT_CONFIGURATION, via the committed policy", () => {
  assert.ok(CODE.includes("assertCourseOperationAllowed"));
  assert.ok(
    /assertCourseOperationAllowed\([\s\S]{0,120}?"SCHEDULE_DRAFT_CONFIGURATION"/.test(CODE),
    "the gate does not use the approved operation",
  );
  assert.ok(CODE.includes("error instanceof CourseOperationNotPermittedError"));
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

test("9. the gate is declared and bound BEFORE the plan query, and both precede the write", () => {
  // Declaration order in the source...
  const gateAt = CODE.indexOf("function assertConfigurationAllowed(");
  const planAt = CODE.indexOf("function findExamPlanByCourseOfferingId(");
  const definitionAt = CODE.indexOf("function findDefinitionForPlan(");
  const writeAt = CODE.indexOf("function createSessionAtNextOrder(");
  assert.ok(gateAt > 0 && planAt > gateAt, "the plan query is declared before the gate");
  assert.ok(definitionAt > planAt, "the definition query is declared before the plan query");
  assert.ok(writeAt > definitionAt, "the write is declared before the definition query");

  // ...and binding order in the dependency literal. The RUNTIME order is the
  // committed pure core's contract and is proven at runtime in its own suite;
  // this is the binding's half of that contract.
  // `[ \t\r]*$` rather than a bare `$`: this repository checks out with CRLF
  // endings, and a line-end anchor that does not tolerate the carriage return
  // silently matches nothing — which would make this guard vacuously pass.
  const bound = [...DEPS_LITERAL.matchAll(/^\s{4}(\w+),[ \t\r]*$/gm)].map((match) => match[1]);
  assert.deepEqual(bound, [
    "requireCourseContext",
    "assertConfigurationAllowed",
    "findExamPlanByCourseOfferingId",
    "findDefinitionForPlan",
    "createSessionAtNextOrder",
    "isCourseNotFoundError",
    "isOperationNotAllowedError",
  ]);
});

test("10. the module consults NO capability, and no instructor or trainee actor helper", () => {
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
  // ...and says so, so the absence reads as a decision rather than an omission.
  assert.ok(/EXAMS/.test(COMMENTS), "the missing EXAMS capability is undocumented");
});

// ===========================================================================
// 11–14. The verified offering id, and the plan query
// ===========================================================================

test("11. the ExamPlan lookup uses the VERIFIED offering id, never the requested one", () => {
  assert.ok(
    /courseOfferingId:\s*verifiedCourseOfferingId/.test(CODE),
    "the plan lookup does not use the verified id",
  );
  const planQuery = bodyOf("findExamPlanByCourseOfferingId");
  assert.equal(planQuery.includes("rawInput"), false, "the raw input reached the plan query");
  assert.equal(
    planQuery.includes("requestedCourseOfferingId"),
    false,
    "the REQUESTED id reached the plan query",
  );
});

test("12. there is EXACTLY one ExamPlan findUnique, selecting `id` and nothing else", () => {
  assert.equal((CODE.match(/examPlan\.findUnique\(/g) ?? []).length, 1);
  const planOps = CODE.match(/examPlan\.\w+/g) ?? [];
  assert.deepEqual(planOps, ["examPlan.findUnique"]);

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
});

test("13. no ExamPlan is created, updated or upserted, by any name", () => {
  const writes = /examPlan\.(create|createMany|update|updateMany|upsert|delete|deleteMany)/;
  assert.equal(writes.test(CODE), false, "the module writes an ExamPlan");
  for (const token of ["ensurePlan", "createPlan", "upsertPlan", "getOrCreate"]) {
    assert.equal(CODE.includes(token), false, `the module exposes ${token}`);
  }
});

test("14. the definition lookup is scoped by the SERVER planId AND the submitted id", () => {
  assert.equal((CODE.match(/examDefinition\.\w+\(/g) ?? []).length, 1);
  const query = bodyOf("findDefinitionForPlan");
  assert.ok(
    /prisma\.examDefinition\.findFirst\(/.test(query),
    "the definition verification is not a plan-scoped findFirst",
  );
  assert.ok(
    /where:\s*\{\s*id:\s*definitionId,\s*planId,?\s*\}/.test(query),
    `the definition where was: ${query}`,
  );
  assert.ok(/select:\s*\{\s*id:\s*true,?\s*\}/.test(query), "the definition select is not id-only");
  // A bare findUnique by id would find another plan's definition and then rely on
  // a comparison someone could later remove.
  assert.equal(CODE.includes("examDefinition.findUnique"), false);
  // The verification reads NOTHING that could drive a decision or leak.
  for (const column of ["name: true", "kind: true", "durationMinutes", "parallelCapacity", "include"]) {
    assert.equal(query.includes(column), false, `the verification selects ${column}`);
  }
  // The helper takes the SERVER-supplied plan id as its first parameter.
  assert.ok(/function findDefinitionForPlan\(\s*planId: string,/.test(SOURCE));
  // ...and the definition table is never written.
  const definitionWrites =
    /examDefinition\.(create|createMany|update|updateMany|upsert|delete|deleteMany)/;
  assert.equal(definitionWrites.test(CODE), false, "the module writes an ExamDefinition");
});

// ===========================================================================
// 15–18. The single date conversion
// ===========================================================================

test("15. the date is converted EXACTLY ONCE, by the repository's shared helper", () => {
  assert.equal((CODE.match(/parseDateKey\(/g) ?? []).length, 1, "the date is converted twice");
  assert.ok(/const date = parseDateKey\(value\.date\);/.test(CODE), "the conversion is not the expected one");
  assert.ok(
    /import \{ parseDateKey \} from "@\/lib\/dates";/.test(CODE),
    "the shared date helper is not imported",
  );
});

test("16. the conversion happens at the IO boundary and NOWHERE else in the slice", () => {
  // In this module: inside the write binding, before the transaction opens.
  const helper = bodyOf("createSessionAtNextOrder");
  assert.ok(helper.includes("parseDateKey("), "the conversion is not in the write binding");
  assert.ok(
    helper.indexOf("parseDateKey(") < helper.indexOf("$transaction("),
    "the conversion happens inside the transaction",
  );
  // And in the pure cores: not at all.
  for (const rel of [CORE_REL, INPUT_CORE_REL]) {
    const core = stripComments(readFileSync(join(REPO_ROOT, rel), "utf8"));
    assert.equal(core.includes("parseDateKey"), false, `${rel} converts a date`);
    assert.equal(/new Date\b/.test(core), false, `${rel} constructs a calendar value`);
  }
});

test("17. no other calendar construction, parsing or formatting exists in the binding", () => {
  for (const token of [
    "new Date",
    "Date.now",
    "Date.UTC",
    "toISOString",
    "getTime()",
    "setUTC",
    "getUTC",
    "getTimezoneOffset",
    "toLocaleDateString",
    "dateKey(",
    "enumerateDateKeys",
    "startOfDay",
  ]) {
    assert.equal(CODE.includes(token), false, `the module uses ${token}`);
  }
  // The converted value is a local const, reused by BOTH statements.
  assert.ok(/where:\s*\{\s*planId,\s*date,?\s*\}/.test(TRANSACTION_BODY));
  assert.ok(/(^|\s)date,/.test(CREATE_DATA), "the create does not write the converted date");
});

test("18. the pure core's date stays a plain string, and the reason is documented", () => {
  const inputCore = readFileSync(join(REPO_ROOT, INPUT_CORE_REL), "utf8");
  assert.ok(inputCore.includes("readonly date: string;"), "the normalized date is no longer a string");
  assert.ok(/timezone/i.test(COMMENTS), "the single-conversion reasoning is undocumented");
  assert.ok(/UTC/.test(COMMENTS), "the shared day-boundary convention is undocumented");
});

// ===========================================================================
// 19–24. The transaction, the order aggregate and the create payload
// ===========================================================================

test("19. there is EXACTLY one interactive transaction, and no raw escape hatch", () => {
  assert.equal((CODE.match(/\$transaction\(/g) ?? []).length, 1);
  assert.equal((CODE.match(/prisma\.\$transaction\(/g) ?? []).length, 1);
  assert.ok(/prisma\.\$transaction\(async \(tx\) =>/.test(CODE));
  for (const token of ["$executeRaw", "$queryRaw", "$connect", "$disconnect", "$extends"]) {
    assert.equal(CODE.includes(token), false, `the module uses ${token}`);
  }
});

test("20. the transaction contains EXACTLY the aggregate and the create, on the tx client", () => {
  assert.ok(TRANSACTION_BODY.includes("tx.examSession.aggregate("));
  assert.ok(TRANSACTION_BODY.includes("tx.examSession.create("));
  // Exactly two statements touch the database inside it, and only one is awaited
  // (the create is the returned expression).
  assert.equal((TRANSACTION_BODY.match(/tx\.\w+\./g) ?? []).length, 2);
  assert.equal((TRANSACTION_BODY.match(/await /g) ?? []).length, 1);
  // The plan and definition queries are OUTSIDE the transaction.
  assert.equal(TRANSACTION_BODY.includes("examPlan"), false, "the plan query is inside the tx");
  assert.equal(TRANSACTION_BODY.includes("examDefinition"), false, "the definition query is inside the tx");
  // Neither statement runs off the base client.
  assert.equal(CODE.includes("prisma.examSession."), false, "a session statement bypasses the tx");
  // No iteration of any kind: one row in, one row out.
  for (const loop of ["for (", "for(", "while (", "forEach(", ".map(", ".reduce(", "Promise.all"]) {
    assert.equal(TRANSACTION_BODY.includes(loop), false, `the transaction contains ${loop}`);
  }
});

test("21. the order aggregate is a MAX scoped by planId AND date", () => {
  assert.equal((CODE.match(/examSession\.aggregate\(/g) ?? []).length, 1);
  const helper = bodyOf("createSessionAtNextOrder");
  assert.ok(/where:\s*\{\s*planId,\s*date,?\s*\}/.test(helper), `the aggregate where was: ${helper}`);
  assert.ok(/_max:\s*\{\s*orderIndex:\s*true,?\s*\}/.test(helper), "the aggregate max is wrong");
  // Not a count: a count would silently reuse a position after any future gap.
  assert.equal(helper.includes(".count("), false, "the write helper uses count");
  assert.equal(CODE.includes("_count"), false, "the module uses _count");
  // The scope is the plan's DAY, never the whole plan and never a wider filter.
  for (const clause of WHERE_CLAUSES) {
    assert.equal(clause.includes("courseOfferingId: {"), false, `a query filters widely: ${clause}`);
  }
});

test("22. orderIndex is SERVER-computed as max + 1, and never caller-supplied", () => {
  assert.ok(
    /aggregate\._max\.orderIndex === null\s*\?\s*0\s*:\s*aggregate\._max\.orderIndex \+ 1/.test(
      CODE.replace(/\s+/g, " "),
    ),
    "the next-order computation is not the approved max+1 / 0 rule",
  );
  assert.ok(/orderIndex:\s*nextOrderIndex,/.test(CREATE_DATA), "orderIndex is missing from the data");
  assert.equal(CREATE_DATA.includes("value.orderIndex"), false, "order came from the payload");
  assert.equal(CREATE_DATA.includes("rawInput"), false, "the create data reads raw input");
});

test("23. the create data is EXACTLY the eight approved columns", () => {
  const keys = [...CREATE_DATA.matchAll(/^\s{8}(\w+)[,:]/gm)].map((match) => match[1]);
  assert.deepEqual(keys, [
    "planId",
    "definitionId",
    "date",
    "startTime",
    "arena",
    "title",
    "notes",
    "orderIndex",
  ]);
  // The five submitted values come from the NORMALIZED payload, never elsewhere.
  for (const field of ["definitionId", "startTime", "arena", "title", "notes"]) {
    assert.ok(
      new RegExp(`${field}:\\s*value\\.${field},`).test(CREATE_DATA),
      `${field} is missing or not taken from the normalized value`,
    );
  }
  // The plan id is the SERVER-resolved one, passed in as the helper's first
  // parameter and written by shorthand.
  assert.ok(/(^|\s)planId,/.test(CREATE_DATA), `planId is missing: ${CREATE_DATA}`);
  assert.ok(/function createSessionAtNextOrder\(\s*planId: string,/.test(SOURCE));
});

test("24. NO deprecated, derived, provenance or generated column is written", () => {
  for (const column of UNWRITTEN_COLUMNS) {
    assert.equal(CREATE_DATA.includes(column), false, `the create data writes ${column}`);
    assert.equal(CODE.includes(column), false, `the module references ${column}`);
  }
  // The create select is exactly the two values the caller is told about.
  const helper = bodyOf("createSessionAtNextOrder");
  assert.ok(
    /select:\s*\{\s*id:\s*true,\s*orderIndex:\s*true,?\s*\}/.test(helper),
    "the create select is not exactly id + orderIndex",
  );
  for (const forbidden of ["date: true", "title: true", "planId: true", "include"]) {
    assert.equal(helper.includes(forbidden), false, `the create selects ${forbidden}`);
  }
});

// ===========================================================================
// 25–29. Nothing else is written, and nothing is announced
// ===========================================================================

test("25. there is no update, delete or upsert of ANY model", () => {
  for (const verb of ["update(", "updateMany(", "upsert(", "delete(", "deleteMany(", "createMany("]) {
    assert.equal(CODE.includes(`.${verb}`), false, `the module performs a ${verb}`);
  }
  const writes = /\b(?:prisma|tx)\.(\w+)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/g;
  const written = [...CODE.matchAll(writes)].map((match) => match[1]);
  assert.deepEqual([...new Set(written)], ["examSession"]);
});

test("26. no assignment, break, supervisor, roster or Teaching-Practice row is touched", () => {
  for (const model of [
    "examAssignment",
    "examSessionBreak",
    "examSessionSupervisor",
    "examBlockBreak",
    "examBeginnerChild",
    "examTeachingPracticeSourceDate",
    "teachingPractice",
    "courseOffering.",
    "courseEnrollment",
    "groupMembership",
    "student.",
    "instructor.",
  ]) {
    assert.equal(CODE.includes(model), false, `the module touches ${model}`);
  }
  // The complete Prisma inventory of the module: four statements, three models.
  const calls = CODE.match(/\b(?:prisma|tx)\.[\w$]+(?:\.[\w$]+)?/g) ?? [];
  assert.deepEqual(calls, [
    "prisma.examPlan.findUnique",
    "prisma.examDefinition.findFirst",
    "prisma.$transaction",
    "tx.examSession.aggregate",
    "tx.examSession.create",
  ]);
});

test("27. no publication state is read or written, and nothing is announced", () => {
  for (const token of [
    "publishedAt",
    "publish",
    "unpublish",
    "notification",
    "Notification",
    "sendMessage",
    "web-push",
    "push-",
    "revalidatePath",
    "revalidateTag",
  ]) {
    assert.equal(CODE.includes(token), false, `the module reaches ${token}`);
  }
});

test("28. there is no re-run, isolation override, lock or timing knob", () => {
  for (const token of [
    "retry",
    "Retry",
    "attempt",
    "backoff",
    "maxWait",
    "timeout",
    "isolationLevel",
    "Serializable",
    "RepeatableRead",
    "ReadCommitted",
    "Mutex",
    "mutex",
    "lockfile",
    "globalThis",
    "setTimeout",
  ]) {
    assert.equal(CODE.includes(token), false, `the module uses ${token}`);
  }
});

test("29. the orderIndex concurrency limitation is documented HONESTLY", () => {
  assert.ok(/concurren/i.test(COMMENTS), "concurrency is not discussed at all");
  assert.ok(
    /(equal|same|duplicate)[^.]{0,80}orderIndex/i.test(COMMENTS),
    "the equal-orderIndex outcome is not stated",
  );
  assert.ok(/orderIndex[^.]{0,120}id/i.test(COMMENTS), "the deterministic read order is not stated");
  // ...and must NOT claim a guarantee it does not have.
  assert.equal(
    /(guarantee|prevent|ensure)s?[^.]{0,60}unique/i.test(COMMENTS),
    false,
    "the header claims uniqueness it does not enforce",
  );
  // The schema is not silently assumed to enforce it either.
  const schema = readFileSync(join(REPO_ROOT, "prisma", "schema.prisma"), "utf8");
  const model = schema.slice(
    schema.indexOf("model ExamSession {"),
    schema.indexOf('@@map("exam_sessions")'),
  );
  assert.ok(model.length > 0, "sanity: the model should be found");
  assert.equal(
    /@@unique\(\[planId, date, orderIndex\]\)/.test(model),
    false,
    "the schema gained a unique order key (this slice must not add one)",
  );
});

// ===========================================================================
// 30–32. The binding decides nothing
// ===========================================================================

test("30. the public function returns its pure core's result and decides nothing", () => {
  assert.ok(/return createExamSessionWithDeps\(courseOfferingId, rawInput, \{/.test(CODE));
  for (const token of [
    "normalizeExamSessionCreateInput",
    "normalizeExamSessionEditInput",
    "validateStoredExamSession",
    "isValidDateKey",
    "isValidHHMM",
    "plan_not_found",
    "invalid_input",
    "offering_not_found",
    "operation_not_allowed",
    "definition_not_found",
    "stale_write",
    "duplicate",
    "ok: false",
    "ok: true",
    "issues",
    "P2002",
    "P2003",
  ]) {
    assert.equal(CODE.includes(token), false, `the binding decides ${token} itself`);
  }
});

test("31. the module imports EXACTLY the seven approved specifiers", () => {
  const specifiers = [...CODE.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(
    [...new Set(specifiers)].sort(),
    [
      "@/app/generated/prisma/client",
      "@/lib/course/admin-course-context",
      "@/lib/course/operation-policy-core",
      "@/lib/dates",
      "@/lib/exam/create-exam-session-core",
      PRISMA_MODULE,
    ].sort(),
  );
  // The generated enum is imported as a TYPE only — no runtime client value.
  assert.ok(/import type \{ CourseOfferingStatus \} from/.test(CODE));
});

test("32. the pure core it binds is DB-free, and no lib/exam module imports a client", () => {
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
// 33–36. Containment: no caller, no UI, four new files, nothing modified
// ===========================================================================

test("33. no app/, route, page, Server Action or UI caller exists for this writer", () => {
  const declaring = new Set([IO_REL, IO_TEST_REL, CORE_REL].map((rel) => join(REPO_ROOT, rel)));
  const ownSuite = join(REPO_ROOT, CORE_TEST_REL);

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
        /exam-session-write-io/.test(code) ||
        /create-exam-session-core/.test(code) ||
        /\bcreateExamSession\s*\(/.test(code) ||
        /\bcreateExamSessionWithDeps\s*\(/.test(code);
      // The pure core's OWN suite legitimately drives its injectable
      // orchestration with fakes; nothing else may reach either symbol.
      if (reaches && path !== ownSuite) {
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
    join("lib", "actions", "exam-session-actions.ts"),
    join("lib", "actions", "exams.ts"),
    join("lib", "actions", "exam-write.ts"),
  ]) {
    assert.equal(existsSync(join(REPO_ROOT, file)), false, `${file} was created`);
  }
});

test("34. the slice consists of EXACTLY the four approved files", () => {
  for (const rel of [IO_REL, IO_TEST_REL, CORE_REL, CORE_TEST_REL]) {
    assert.ok(statSync(join(REPO_ROOT, rel)).isFile(), `${rel} is missing`);
    assert.equal(rel.endsWith(".tsx"), false, `${rel} is a UI file`);
  }
  // No fifth file was added under either directory.
  const examSlice = readdirSync(join(REPO_ROOT, "lib", "exam"))
    .filter((name) => name.startsWith("create-exam-session"))
    .sort();
  assert.deepEqual(examSlice, [
    "create-exam-session-core.test.ts",
    "create-exam-session-core.ts",
  ]);
  const actionsSlice = readdirSync(join(REPO_ROOT, "lib", "actions"))
    .filter((name) => name.startsWith("exam-session"))
    .sort();
  assert.deepEqual(actionsSlice, [
    "exam-session-write-io.test.ts",
    "exam-session-write-io.ts",
  ]);
});

test("35. the slice MODIFIED no tracked file, and added nothing beyond the four", () => {
  const scope = ["lib", "prisma", "app", "components"];

  // Nothing that EXISTS IN HEAD was edited, deleted, renamed or type-changed.
  // `--diff-filter=MDRT` excludes additions on purpose: a brand-new file is what
  // this slice is allowed to produce, and including additions would make the
  // check flip to red the moment the four files are staged and back to green
  // after they are committed — a guard that only holds in one of three ordinary
  // states proves nothing. Modifications, by contrast, are forbidden in ALL
  // three, which is exactly what is asserted here.
  const diff = spawnSync(
    "git",
    ["diff", "--name-only", "--diff-filter=MDRT", "HEAD", "--", ...scope],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  assert.equal(diff.status, 0, `git diff failed: ${diff.stderr ?? ""}`);
  const modified = (diff.stdout ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  assert.deepEqual(modified, [], `the slice modified: ${modified.join(", ")}`);

  // ...and every working-tree entry in scope — untracked, staged or both — names
  // one of the four approved paths and nothing else.
  const status = spawnSync("git", ["status", "--porcelain", "--", ...scope], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  assert.equal(status.status, 0, `git status failed: ${status.stderr ?? ""}`);
  for (const line of (status.stdout ?? "").split("\n").filter((l) => l.trim().length > 0)) {
    const path = line.slice(3).trim();
    assert.ok(APPROVED_NEW_FILES.includes(path), `an unapproved change exists: ${line}`);
  }
});

test("36. the slice adds no schema, migration, capability, policy, route or UI file", () => {
  // No migration directory was created: the session table and its indexes are
  // the ones the committed exam migrations already added.
  const migrations = readdirSync(join(REPO_ROOT, "prisma", "migrations"))
    .filter((name) => /exam/i.test(name))
    .sort();
  assert.deepEqual(migrations, [
    "20260729120000_add_exam_plan_tree",
    "20260729140000_add_exam_teaching_practice_source_date",
    "20260730120000_add_exam_definition_and_breaks",
  ]);

  // The committed course-operation policy gained no exam operation.
  const policy = readFileSync(join(REPO_ROOT, "lib", "course", "operation-policy-core.ts"), "utf8");
  assert.equal(/EXAM/.test(policy), false, "the course policy gained an exam operation");
  assert.ok(policy.includes("SCHEDULE_DRAFT_CONFIGURATION"));

  // This suite performs no production access of its own.
  const own = stripComments(readFileSync(join(REPO_ROOT, IO_TEST_REL), "utf8"));
  for (const token of [
    PRISMA_MODULE,
    GENERATED_CLIENT,
    ["process", "env"].join("."),
    "DATABASE" + "_URL",
    "Prisma" + "Client",
    "supa" + "base",
  ]) {
    assert.equal(own.includes(token), false, `the suite references ${token}`);
  }
  // Anchored at line start, so it matches REAL import statements only: this
  // suite necessarily quotes an import line inside an assertion, and that quoted
  // text is evidence about the module under test, not a dependency of the suite.
  const specifiers = [...own.matchAll(/^import .*?from\s+"([^"]+)"/gm)].map((match) => match[1]);
  assert.deepEqual(
    [...new Set(specifiers)].sort(),
    ["node:assert/strict", "node:child_process", "node:fs", "node:path", "node:test"],
  );
});
