/**
 * EXAM EX-ASG-LTD1-A — the guard suite for the ADMIN detailed
 * examinee-assignment WRITE binding.
 *
 * Run with: npx tsx --test lib/actions/detailed-exam-assignment-write-io.test.ts
 *
 * WHY THIS SUITE IS STRUCTURAL RATHER THAN BEHAVIOURAL. The module under test
 * declares `server-only` and imports the database client, so importing it here
 * would either fail the build or open a real connection. The ORCHESTRATION it
 * binds is already proven at runtime by the pure core's own DB-free suite, which
 * drives every ordering, requirement, refusal and eligibility decision with
 * fakes. What is left — and what only a source-text guard can prove — is that the
 * BINDING is the one that core was designed for: the exact statements, the exact
 * scopes, the exact selects, the exact classifier, and the exact absence of a
 * caller.
 *
 * DB-FREE: no database connection is opened, no SQL is executed, no environment
 * variable is read, and no production identifier appears anywhere. The only files
 * read are module SOURCE TEXTS.
 *
 * SPLIT LITERALS. Several committed exam guard suites sweep `app/`, `lib/` and
 * `components/` for their own module names and pin the resulting caller list to an
 * exact set. This slice's module path CONTAINS the sibling assignment write
 * binding's path as a substring, so spelling it whole here would enrol this file
 * in an allow-list that exists to stay narrow. Every such token below is
 * assembled from pieces for that reason, and for no other.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

/** Assembled for the reason the header gives. */
const IO_BASENAME = "detailed-exam-assignment-write" + "-io";
const CORE_BASENAME = "create-detailed-exam-assignment-core";

const IO_REL = join("lib", "actions", `${IO_BASENAME}.ts`);
const IO_TEST_REL = join("lib", "actions", `${IO_BASENAME}.test.ts`);
const CORE_REL = join("lib", "exam", `${CORE_BASENAME}.ts`);
const CORE_TEST_REL = join("lib", "exam", `${CORE_BASENAME}.test.ts`);

/** The FOUR files this slice consists of, in repository form. */
const NEW_FILES = [IO_REL, IO_TEST_REL, CORE_REL, CORE_TEST_REL];

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

// Split specifiers: this suite necessarily names some of what it forbids.
const ENV_READ = "process" + ".env";
const GENERATED_CLIENT = ["@prisma", "client"].join("/");

// ===========================================================================
// 1–6. Module kind and the public signature
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

test("3. the module exports EXACTLY ONE function, and no value", () => {
  assert.deepEqual(
    SIGNATURES.map((entry) => entry.name),
    ["createDetailedExamAssignment"],
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

test("4. the signature accepts a REQUESTED offering id and a RAW input, and nothing else", () => {
  const [create] = SIGNATURES;
  assert.equal(create.params, "courseOfferingId: string, rawInput: unknown,");
  assert.equal(create.returns, "Promise<CreateDetailedExamAssignmentResult>");
  for (const forbidden of [
    "role",
    "planId",
    "sessionId",
    "studentId",
    "orderIndex",
    "pairingIndex",
    "actorId",
    "adminId",
    "tx:",
    "prisma",
  ]) {
    assert.equal(create.params.includes(forbidden), false, `the writer accepts ${forbidden}`);
  }
});

test("5. the module declares no update, delete or reorder path", () => {
  for (const token of [
    ".update(",
    ".updateMany(",
    ".upsert(",
    ".delete(",
    ".deleteMany(",
    ".createMany(",
    "$executeRaw",
    "$queryRaw",
    "$executeRawUnsafe",
    "$queryRawUnsafe",
  ]) {
    assert.equal(CODE.includes(token), false, `the module issues ${token}`);
  }
});

test("6. the module reads no environment and opens no other client", () => {
  assert.equal(CODE.includes(ENV_READ), false);
  assert.equal(CODE.includes(GENERATED_CLIENT), false);
  assert.equal(CODE.includes("new PrismaClient"), false);
  assert.equal(CODE.includes("dotenv"), false);
});

// ===========================================================================
// 7–11. Authorization, lifecycle and the absence of a capability
// ===========================================================================

test("7. authorization is the admin course-offering boundary, bound exactly once", () => {
  const matches = CODE.match(/requireAdminCourseOffering\(/g) ?? [];
  assert.equal(matches.length, 1, `bound ${matches.length} times`);
  const body = bodyOf("requireCourseContext");
  assert.match(body, /requireAdminCourseOffering\(requestedCourseOfferingId\)/);
  // ONLY the two approved fields are carried forward.
  assert.match(body, /courseOfferingId:\s*context\.id/);
  assert.match(body, /status:\s*context\.status/);
  for (const leaked of ["context.name", "context.level", "context.year", "context.startDate"]) {
    assert.equal(body.includes(leaked), false, `the boundary leaks ${leaked}`);
  }
});

test("8. no instructor or trainee actor helper is imported", () => {
  for (const token of [
    "requireInstructor",
    "requireStudent",
    "requireTrainee",
    "getSession",
    "cookies(",
    "headers(",
    "auth(",
  ]) {
    assert.equal(CODE.includes(token), false, `the module binds ${token}`);
  }
});

test("9. the lifecycle gate is the committed operation, and no table is copied", () => {
  const body = bodyOf("assertConfigurationAllowed");
  assert.match(body, /assertCourseOperationAllowed\(/);
  assert.match(body, /"SCHEDULE_DRAFT_CONFIGURATION"/);
  // The policy TABLE is not restated here. `"ACTIVE"` is deliberately NOT in this
  // list: the module's one occurrence of it is the ENROLMENT status in the
  // eligibility statement, which test 16 pins, and which is a different
  // vocabulary from the offering lifecycle entirely.
  for (const status of ["PLANNED", "ARCHIVED", "COMPLETED"]) {
    assert.equal(CODE.includes(`"${status}"`), false, `the module restates ${status}`);
  }
  // ...and the gate is consulted exactly once, with exactly one operation.
  assert.equal((CODE.match(/assertCourseOperationAllowed\(/g) ?? []).length, 1);
  assert.equal((CODE.match(/"SCHEDULE_DRAFT_CONFIGURATION"/g) ?? []).length, 1);
});

test("10. NO capability is consulted, and none is introduced", () => {
  for (const token of [
    '"EXAMS"',
    "'EXAMS'",
    "CapabilityKey",
    "capability",
    "Capability",
    "getEffectiveCapabilities",
    "courseCapability",
  ]) {
    assert.equal(CODE.includes(token), false, `the module consults ${token}`);
  }
});

test("11. authorization runs BEFORE the first Prisma statement", () => {
  const auth = CODE.indexOf("requireAdminCourseOffering(");
  const firstPrisma = CODE.indexOf("prisma.");
  assert.ok(auth > 0 && firstPrisma > 0);
  assert.ok(auth < firstPrisma, "a Prisma statement precedes the authorization binding");
  // ...and the wiring hands the core its dependencies in the locked order.
  const wiring = CODE.slice(CODE.indexOf("createDetailedExamAssignmentWithDeps("));
  for (const dep of [
    "requireCourseContext",
    "assertConfigurationAllowed",
    "findExamPlanByCourseOfferingId",
    "findSessionForPlan",
    "findEligibleTrainee",
    "createAssignmentAtNextOrder",
    "isCourseNotFoundError",
    "isOperationNotAllowedError",
    "isUniqueConstraintError",
  ]) {
    assert.ok(wiring.includes(dep), `the wiring omits ${dep}`);
  }
});

// ===========================================================================
// 12–18. The exact Prisma inventory
// ===========================================================================

test("12. there are EXACTLY four logical operations, and no extra query", () => {
  const models = [...CODE.matchAll(/(?:prisma|tx)\.(\w+)\.(\w+)\(/g)].map(
    ([, model, method]) => `${model}.${method}`,
  );
  assert.deepEqual(models, [
    "examPlan.findUnique",
    "examSession.findFirst",
    "courseEnrollment.findFirst",
    "examAssignment.aggregate",
    "examAssignment.create",
  ]);
  // One transaction, and only one.
  assert.equal((CODE.match(/\$transaction\(/g) ?? []).length, 1);
});

test("13. the plan lookup uses the VERIFIED offering id and selects only its id", () => {
  const body = bodyOf("findExamPlanByCourseOfferingId");
  assert.match(body, /prisma\.examPlan\.findUnique\(\{/);
  assert.match(body, /where:\s*\{\s*courseOfferingId:\s*verifiedCourseOfferingId\s*\}/);
  assert.match(body, /select:\s*\{\s*id:\s*true\s*\}/);
  for (const leaked of ["publish", "sourceDate", "sessions", "definitions", "createdAt"]) {
    assert.equal(body.includes(leaked), false, `the plan lookup selects ${leaked}`);
  }
});

test("14. the session lookup is PLAN-SCOPED and never a bare findUnique by id", () => {
  const body = bodyOf("findSessionForPlan");
  assert.match(body, /prisma\.examSession\.findFirst\(\{/);
  assert.match(body, /where:\s*\{\s*id:\s*sessionId,\s*planId\s*\}/);
  assert.equal(body.includes("findUnique"), false, "the session is read without the plan scope");
});

test("15. the session select is EXACTLY the id plus the four definition columns", () => {
  const body = bodyOf("findSessionForPlan");
  const selected = [...body.matchAll(/^\s*(\w+):\s*true,$/gm)].map(([, name]) => name);
  assert.deepEqual(selected.sort(), [
    "id",
    "kind",
    "requiresDiscipline",
    "requiresInstructedTrainee",
    "requiresLessonTopic",
  ]);
  for (const leaked of [
    "name:",
    "durationMinutes",
    "parallelCapacity",
    "assignments",
    "_count",
    "date:",
    "startTime",
    "endTime",
    "arena",
    "orderIndex:",
    "publishedAt",
    "notes",
  ]) {
    assert.equal(body.includes(leaked), false, `the session select leaks ${leaked}`);
  }
});

test("16. eligibility is ONE fail-closed statement selecting ONE column", () => {
  const body = bodyOf("findEligibleTrainee");
  assert.match(body, /prisma\.courseEnrollment\.findFirst\(\{/);
  assert.match(body, /courseOfferingId:\s*verifiedCourseOfferingId/);
  assert.match(body, /studentId,/);
  assert.match(body, /status:\s*"ACTIVE"/);
  assert.match(body, /student:\s*\{\s*isActive:\s*true\s*\}/);
  assert.match(body, /select:\s*\{\s*studentId:\s*true\s*\}/);
  assert.equal(body.includes("findUnique"), false);
});

test("17. eligibility reads NO personal or enrolment detail", () => {
  const body = bodyOf("findEligibleTrainee");
  for (const leaked of [
    "identityNumber",
    "phone",
    "parent",
    "contact",
    "group",
    "isPrimary",
    "combinedParticipation",
    "firstName",
    "lastName",
    "email",
    "birth",
    "address",
  ]) {
    assert.equal(body.includes(leaked), false, `eligibility selects ${leaked}`);
  }
  // The SERVER-matched id is what is returned, never the submitted argument.
  assert.match(body, /studentId:\s*row\.studentId/);
});

test("18. no Teaching-Practice, beginner, notification or publication surface is reached", () => {
  for (const token of [
    "teachingPractice",
    "TeachingPractice",
    "beginner",
    "Beginner",
    "notification",
    "Notification",
    "push",
    "message",
    "publish",
    "Publish",
    "grade",
    "score",
    "feedback",
  ]) {
    assert.equal(CODE.includes(token), false, `the module reaches ${token}`);
  }
});

// ===========================================================================
// 19–23. The transaction and the write
// ===========================================================================

test("19. the transaction contains EXACTLY the aggregate and the create, on tx", () => {
  const body = bodyOf("createAssignmentAtNextOrder");
  assert.match(body, /prisma\.\$transaction\(async \(tx\) => \{/);
  const calls = [...body.matchAll(/tx\.(\w+)\.(\w+)\(/g)].map(
    ([, model, method]) => `${model}.${method}`,
  );
  assert.deepEqual(calls, ["examAssignment.aggregate", "examAssignment.create"]);
  // No statement inside the transaction escapes to the non-transactional client.
  assert.equal(body.includes("prisma.examAssignment"), false);
});

test("20. the order position is MAX + 1, never a COUNT", () => {
  const body = bodyOf("createAssignmentAtNextOrder");
  assert.match(body, /_max:\s*\{\s*orderIndex:\s*true\s*\}/);
  assert.match(body, /where:\s*\{\s*sessionId\s*\}/);
  assert.match(body, /maxOrderIndex === null\s*\?\s*0\s*:\s*maxOrderIndex \+ 1/);
  for (const forbidden of ["_count", ".count(", "_sum", "SERIALIZABLE", "isolationLevel", "FOR UPDATE"]) {
    assert.equal(body.includes(forbidden), false, `the write uses ${forbidden}`);
  }
});

test("21. the concurrency limit is documented HONESTLY, and no lock or retry is added", () => {
  // The block-comment prefix `*` may fall between any two words, so the wording
  // assertions tolerate it rather than pinning a line layout.
  assert.match(COMMENTS, /same[\s*]+`?orderIndex`?/i);
  assert.match(COMMENTS, /TOLERATED, not[\s*]+prevented/i);
  assert.match(COMMENTS, /tie-break/i);
  for (const forbidden of ["retry", "advisory", "pg_advisory", "LOCK TABLE", "setTimeout"]) {
    assert.equal(CODE.includes(forbidden), false, `the write adds ${forbidden}`);
  }
});

test("22. the create writes EXACTLY the seven approved columns", () => {
  const body = bodyOf("createAssignmentAtNextOrder");
  const data = body.slice(body.indexOf("data: {"), body.indexOf("select: {"));
  const columns = [...data.matchAll(/^\s{8}(\w+)[,:]/gm)].map(([, name]) => name);
  assert.deepEqual(columns, [
    "sessionId",
    "studentId",
    "role",
    "horseName",
    "orderIndex",
    "instructionTopic",
    "discipline",
  ]);
  // The server-verified values, and the core's fixed role literal.
  assert.match(data, /studentId:\s*value\.studentId/);
  assert.match(data, /role:\s*value\.role/);
  assert.match(data, /instructionTopic:\s*value\.instructionTopic/);
  assert.match(data, /discipline:\s*value\.discipline/);
  // The narrow select.
  assert.match(body, /select:\s*\{\s*id:\s*true,\s*orderIndex:\s*true\s*\}/);
});

test("23. no forbidden column, undefined placeholder or caller-supplied role is written", () => {
  const body = bodyOf("createAssignmentAtNextOrder");
  for (const forbidden of [
    "pairingIndex",
    "sourcePracticeRole",
    "notes",
    "planId",
    "courseOfferingId",
    "createdAt",
    "updatedAt",
    "undefined",
    '"EXAMINEE"',
    "rawInput",
  ]) {
    assert.equal(body.includes(forbidden), false, `the write sets ${forbidden}`);
  }
});

// ===========================================================================
// 24–26. The conflict classifier
// ===========================================================================

test("24. the P2002 classifier is private, local and exactly the approved shape", () => {
  const body = bodyOf("isDetailedAssignmentConflictError");
  assert.equal(CODE.includes("export function isDetailedAssignmentConflictError"), false);
  assert.match(body, /!==\s*"P2002"/);
  // BOTH columns are required in the array form — a single-field target is not
  // this key.
  assert.match(body, /tokens\.includes\("sessionId"\) && tokens\.includes\("studentId"\)/);
  // The index-name form is matched by EQUALITY, never by inclusion.
  assert.match(body, /target === DETAILED_ASSIGNMENT_CONFLICT_INDEX/);
  assert.equal(body.includes("target.includes("), false, "the index name is matched loosely");
  assert.equal(body.includes("startsWith"), false, "the index name is prefix-matched");
  assert.equal(body.includes("endsWith"), false, "the index name is suffix-matched");
  assert.match(CODE, /exam_assignments_sessionId_studentId_key/);
});

test("25. no other Prisma code is classified, and no error is inspected further", () => {
  for (const code of ["P2025", "P2003", "P2001", "P1001"]) {
    assert.equal(CODE.includes(code), false, `the module classifies ${code}`);
  }
  for (const token of ["console.", "logger", "error.message", "error.stack", "JSON.stringify(error"]) {
    assert.equal(CODE.includes(token), false, `the module inspects ${token}`);
  }
});

test("26. a redirect cannot be laundered: no digest is read anywhere", () => {
  assert.equal(CODE.includes("digest"), false, "the module inspects a redirect digest");
  assert.equal(CODE.includes("NEXT_REDIRECT"), false);
  // The classifier is reached ONLY through the core's uniqueness slot.
  assert.match(CODE, /isUniqueConstraintError:\s*isDetailedAssignmentConflictError/);
});

// ===========================================================================
// 27–31. Containment: no caller, no UI, no schema
// ===========================================================================

test("27. NOTHING under app, lib or components calls this binding or its core", () => {
  const declaring = new Set(NEW_FILES.map((rel) => join(REPO_ROOT, rel)));
  // Assembled, for the reason the header gives.
  const IO_TOKEN = new RegExp("detailed-exam-assignment-write" + "-io");
  const CORE_TOKEN = new RegExp(CORE_BASENAME);
  const WRITER_CALL = /\bcreateDetailedExamAssignment\s*\(/;
  const ORCHESTRATION_CALL = /\bcreateDetailedExamAssignmentWithDeps\s*\(/;

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
      if (declaring.has(path)) continue;
      const code = stripComments(readFileSync(path, "utf8"));
      if (
        IO_TOKEN.test(code) ||
        CORE_TOKEN.test(code) ||
        WRITER_CALL.test(code) ||
        ORCHESTRATION_CALL.test(code)
      ) {
        callers.push(path.slice(REPO_ROOT.length + 1));
      }
    }
  }
  // Sanity: the exact result below is a PASS, not an empty search.
  assert.ok(scanned > 100, `expected the repository, scanned ${scanned} files`);
  assert.deepEqual(callers, [], `this slice must stay callerless; found: ${callers.join(", ")}`);
});

test("28. no exam route, page, form or Server Action was created", () => {
  for (const dir of [
    join("app", "admin", "exams"),
    join("app", "instructor", "exams"),
    join("app", "student", "exams"),
  ]) {
    assert.equal(existsSync(join(REPO_ROOT, dir)), false, `${dir} was created`);
  }
  // No file this slice added is a UI file or declares a Server Action.
  for (const rel of NEW_FILES) {
    assert.equal(rel.endsWith(".tsx"), false, `${rel} is a UI file`);
    const source = stripComments(readFileSync(join(REPO_ROOT, rel), "utf8"));
    assert.equal(source.includes('"use ' + 'server"'), false, `${rel} is a Server Action module`);
  }
});

test("29. the slice's footprint is EXACTLY four files under its two prefixes", () => {
  const actions = readdirSync(join(REPO_ROOT, "lib", "actions"))
    .filter((name) => name.startsWith("detailed-exam-assignment"))
    .sort();
  assert.deepEqual(actions, [`${IO_BASENAME}.test.ts`, `${IO_BASENAME}.ts`]);

  const exam = readdirSync(join(REPO_ROOT, "lib", "exam"))
    .filter((name) => name.startsWith("create-detailed-exam-assignment"))
    .sort();
  assert.deepEqual(exam, [`${CORE_BASENAME}.test.ts`, `${CORE_BASENAME}.ts`]);

  for (const rel of NEW_FILES) {
    assert.ok(existsSync(join(REPO_ROOT, rel)), `${rel} is missing`);
  }
});

test("30. the module imports only committed boundaries plus its own core", () => {
  const specifiers = [...CODE.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(specifiers)].sort(), [
    "@/app/generated/prisma/client",
    "@/lib/course/admin-course-context",
    "@/lib/course/operation-policy-core",
    `@/lib/exam/${CORE_BASENAME}`,
    "@/lib/prisma",
  ]);
  // The sibling assignment write binding's private helpers are NOT imported.
  assert.equal(CODE.includes("createExamAssignmentWithDeps"), false);
  assert.equal(CODE.includes("isExamAssignmentConflictError"), false);
});

test("31. this slice changes no schema, no migration and no .mcp.json", () => {
  // A source-text guard, not a git guard: these paths are simply unreachable
  // from a module that imports none of them and writes no file. The schema
  // filename is assembled so this suite does not itself contain the token it
  // forbids in the four files it then reads.
  const SCHEMA_FILE = "schema" + ".prisma";
  for (const token of [SCHEMA_FILE, "migrations", "prisma migrate", "db push", ".mcp" + ".json", "seed"]) {
    assert.equal(CODE.includes(token), false, `the module references ${token}`);
  }
  for (const rel of NEW_FILES) {
    const source = readFileSync(join(REPO_ROOT, rel), "utf8");
    assert.equal(source.includes(SCHEMA_FILE), false, `${rel} references the schema`);
    assert.equal(source.includes(ENV_READ), false, `${rel} reads the environment`);
  }
});
