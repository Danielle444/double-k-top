/**
 * EXAM EX-SUP-IO1 — the guard suite for the ADMIN supervisor READ bindings.
 *
 * Run with: npx tsx --test lib/actions/exam-supervisor-read-io.test.ts
 *
 * WHY THIS SUITE IS STRUCTURAL RATHER THAN BEHAVIOURAL. The module under test
 * declares `server-only` and imports the database client, so importing it here
 * would either fail the build or open a real connection. The SHAPING it binds —
 * the two total orders, the placeholder, the freeze, the empty views — is proven
 * at runtime by the pure core's own DB-free suite. What is left, and what only a
 * source-text guard can prove, is that the BINDING reads exactly what it is
 * allowed to read, scoped by exactly the server-verified ids, behind exactly the
 * right gate, in one statement per list, and writes nothing at all.
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

const IO_REL = join("lib", "actions", "exam-supervisor-read-io.ts");
const IO_TEST_REL = join("lib", "actions", "exam-supervisor-read-io.test.ts");
const CORE_REL = join("lib", "exam", "admin-exam-supervisor-read-core.ts");
const CORE_TEST_REL = join("lib", "exam", "admin-exam-supervisor-read-core.test.ts");

/**
 * The sibling WRITE binding's two files, ASSEMBLED rather than spelled whole:
 * that module's own guard suite sweeps `lib/` for its name and for the two
 * committed orchestration cores, and a suite that spelled either as one literal
 * would enrol ITSELF in the caller allow-list that guard exists to keep empty.
 */
const WRITE_FILES = [
  "lib/actions/" + "exam-supervisor-write" + "-io.test.ts",
  "lib/actions/" + "exam-supervisor-write" + "-io.ts",
];

const SOURCE = readFileSync(join(REPO_ROOT, IO_REL), "utf8");
const CORE_SOURCE = readFileSync(join(REPO_ROOT, CORE_REL), "utf8");

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
 * column 0 — so an "inside this reader" assertion means what it says.
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

test("r1. the module imports server-only as its FIRST statement", () => {
  const serverOnly = new RegExp('import\\s+"server' + '-only";');
  assert.ok(serverOnly.test(CODE), "the module is not server-only");
  const firstStatement = CODE.split("\n").find((line) => line.trim().length > 0);
  assert.ok(firstStatement);
  assert.ok(serverOnly.test(firstStatement), `the first statement is: ${firstStatement}`);
});

test("r2. the module does NOT declare use server (or use client)", () => {
  assert.equal(CODE.includes('"use ' + 'server"'), false);
  assert.equal(CODE.includes("'use " + "server'"), false);
  assert.equal(CODE.includes('"use ' + 'client"'), false);
  assert.equal(CODE.includes("'use " + "client'"), false);
  assert.ok(COMMENTS.includes("use " + "server"), "the rule is undocumented");
});

test("r3. the module exports exactly TWO functions, and no value", () => {
  assert.deepEqual(
    SIGNATURES.map((entry) => entry.name),
    ["readEligibleExamSupervisorsForAdmin", "readAdminExamSupervisors"],
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
  const exportStatements = CODE.match(/^export .*$/gm) ?? [];
  for (const statement of exportStatements) {
    assert.ok(
      statement.startsWith("export type {") || statement.startsWith("export async function "),
      `unexpected export: ${statement}`,
    );
  }
});

test("r4. each entry point takes ONLY a courseOfferingId and returns its view", () => {
  const [instructors, supervisors] = SIGNATURES;
  assert.equal(instructors.params, "courseOfferingId: string,");
  assert.equal(instructors.returns, "Promise<EligibleExamSupervisorListView>");
  assert.equal(supervisors.params, "courseOfferingId: string,");
  assert.equal(supervisors.returns, "Promise<AdminExamSupervisorListView>");

  for (const forbidden of [
    "planId",
    "sessionId",
    "instructorId",
    "supervisorId",
    "adminId",
    "actorId",
    "date",
    "take",
    "skip",
    "cursor",
    "tx",
    "prisma",
    "deps",
  ]) {
    for (const entry of [instructors, supervisors]) {
      assert.equal(
        entry.params.includes(forbidden),
        false,
        `${entry.name} accepts ${forbidden}`,
      );
    }
  }
});

test("r5. the module imports EXACTLY the approved specifiers", () => {
  const specifiers = [...CODE.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(
    [...new Set(specifiers)].sort(),
    [
      "@/app/generated/prisma/client",
      "@/lib/course/admin-course-context",
      "@/lib/course/operation-policy-core",
      "@/lib/exam/admin-exam-supervisor-read-core",
      PRISMA_MODULE,
    ].sort(),
  );
  assert.ok(/import type \{ CourseOfferingStatus \} from/.test(CODE));
  // No date helper is needed: not one selected column is a calendar value.
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

// ===========================================================================
// 6–9. Authorization, the verified id, and the lifecycle READ gate
// ===========================================================================

test("r6. requireAdminCourseOffering is bound once, with the RAW requested id", () => {
  assert.equal((CODE.match(/await requireAdminCourseOffering\(/g) ?? []).length, 1);
  assert.ok(
    /requireAdminCourseOffering\(requestedCourseOfferingId\)/.test(CODE),
    "the admin boundary is not called with the requested id",
  );
  const helper = bodyOf("requireCourseContext");
  assert.equal(/prisma\./.test(helper), false, "the authorization helper queries");
  assert.ok(/courseOfferingId:\s*context\.id/.test(helper), "the verified id is not carried");
  assert.ok(/status:\s*context\.status/.test(helper), "the verified status is not carried");
  for (const forbidden of ["name", "level", "activityYear", "startDate", "endDate"]) {
    assert.equal(helper.includes(forbidden), false, `the context carries ${forbidden}`);
  }
  // ONE helper, shared by BOTH reads.
  assert.equal((CODE.match(/function requireCourseContext\(/g) ?? []).length, 1);
  assert.equal((CODE.match(/requireCourseContext\(courseOfferingId\)/g) ?? []).length, 2);

  // An offering id is written in exactly TWO places: the helper carrying the
  // VERIFIED one forward, and the plan lookup consuming it.
  // (`: string` matches are TYPE annotations, not values, and are dropped.)
  const offeringUses = [...CODE.matchAll(/courseOfferingId:\s*([\w.]+)/g)]
    .map((m) => m[1])
    .filter((value) => value !== "string");
  assert.deepEqual(offeringUses, ["context.id", "verifiedCourseOfferingId"]);
});

test("r7. BOTH reads authorize FIRST, then gate, before any query", () => {
  for (const name of ["readEligibleExamSupervisorsForAdmin", "readAdminExamSupervisors"]) {
    const entry = bodyOf(name);
    const authorize = entry.indexOf("await requireCourseContext(courseOfferingId)");
    const gate = entry.indexOf("assertHistoricalReadAllowed(context.status)");
    const firstQuery = entry.search(/\b(prisma\.|findExamPlanByCourseOfferingId\()/);
    assert.ok(authorize > 0, `${name} does not authorize`);
    assert.ok(gate > authorize, `${name} gates before it authorizes`);
    assert.ok(firstQuery > gate, `${name} queries before it gates`);
  }
});

test("r8. the lifecycle gate is HISTORICAL_READ on BOTH reads, and no capability is consulted", () => {
  const gate = bodyOf("assertHistoricalReadAllowed");
  assert.ok(gate.includes("assertCourseOperationAllowed("));
  assert.ok(gate.includes('"HISTORICAL_READ"'), "the wrong operation is gated");
  assert.ok(gate.includes("status as CourseOfferingStatus"));
  assert.equal((CODE.match(/assertCourseOperationAllowed\(/g) ?? []).length, 1);
  // ONE gate helper, invoked by BOTH readers — they cannot drift apart.
  assert.equal((CODE.match(/assertHistoricalReadAllowed\(context\.status\)/g) ?? []).length, 2);
  // A READ never borrows the write gate: an ARCHIVED offering's staffing stays
  // readable history while it may no longer be changed.
  assert.equal(CODE.includes("SCHEDULE_DRAFT_CONFIGURATION"), false);
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
  assert.ok(/EXAMS/.test(COMMENTS), "the absent capability is undocumented");
});

test("r9. NOTHING is classified: a denial never becomes an empty view", () => {
  assert.equal(/\btry\s*\{/.test(CODE), false, "the reader catches");
  assert.equal(/\bcatch\s*\(/.test(CODE), false, "the reader catches");
  for (const token of [
    "instanceof",
    "CourseOfferingNotFoundError",
    "CourseOperationNotPermittedError",
    "NEXT_" + "REDIRECT",
    "notFound(",
    "P2002",
    "P2025",
  ]) {
    assert.equal(CODE.includes(token), false, `the reader handles ${token}`);
  }
  // The one absence it DOES report is the honest one — no plan — and it is the
  // core's own empty view rather than a locally invented shape.
  assert.equal((CODE.match(/emptyAdminExamSupervisorListView\(\)/g) ?? []).length, 1);
  assert.ok(CODE.includes("return emptyAdminExamSupervisorListView();"));
  assert.equal(CODE.includes("Object.freeze"), false, "the reader builds a view itself");
  // The no-plan short circuit is the ONLY early return in the stored reader.
  const stored = bodyOf("readAdminExamSupervisors");
  assert.equal((stored.match(/\breturn\b/g) ?? []).length, 2, "an extra early return exists");
  assert.ok(/if \(plan === null\) \{/.test(stored), "the short circuit is not the no-plan case");
});

// ===========================================================================
// 10–14. The exact three-statement query inventory, and no write of any kind
// ===========================================================================

test("r10. the module issues EXACTLY three statements, all reads", () => {
  const statements = [...CODE.matchAll(/\bprisma\.(\w+)\.(\w+)\(/g)].map(
    ([, model, method]) => `${model}.${method}`,
  );
  assert.equal(statements.length, 3, `the inventory was: ${statements.join(", ")}`);
  assert.deepEqual(statements.sort(), [
    "examPlan.findUnique",
    "examSessionSupervisor.findMany",
    "instructor.findMany",
  ]);
});

test("r11. NO write method name appears ANYWHERE in the reader — not even in prose", () => {
  // The whole SOURCE, comments included: a reader that cannot spell a mutating
  // method cannot grow one by a careless edit, and the sibling WRITE module is
  // where every one of these belongs.
  for (const token of [
    "create",
    "update",
    "upsert",
    "delete",
    "deleteMany",
    "updateMany",
    "createMany",
    "aggregate",
    "groupBy",
    "$" + "executeRaw",
    "$" + "queryRaw",
    "$" + "transaction",
  ]) {
    assert.equal(
      SOURCE.toLowerCase().includes(token.toLowerCase()),
      false,
      `the reader names ${token}`,
    );
  }
  // ...and it reaches no model outside the three it reads.
  for (const token of [
    "teachingPractice",
    "examBeginnerChild",
    "examAssignment",
    "examSessionBreak",
    "examDefinition",
    "signedForm",
    "prisma.student.",
    "prisma.courseEnrollment.",
    "prisma.examSession.",
  ]) {
    assert.equal(CODE.includes(token), false, `the reader touches ${token}`);
  }
});

test("r12. the plan lookup uses the VERIFIED offering id and selects only its id", () => {
  const reader = bodyOf("findExamPlanByCourseOfferingId");
  assert.ok(reader.includes("prisma.examPlan.findUnique("));
  assert.ok(
    /where:\s*\{\s*courseOfferingId:\s*verifiedCourseOfferingId,?\s*\}/.test(reader),
    `the plan where was: ${reader}`,
  );
  const select = reader.slice(reader.indexOf("select: {"));
  assert.ok(/select:\s*\{\s*id:\s*true,?\s*\}/.test(select));
  for (const forbidden of ["publishedAt", "sessions", "definitions", "include"]) {
    assert.equal(select.includes(forbidden), false, `the plan read selects ${forbidden}`);
  }
  // It is called with the VERIFIED id, never the requested one...
  assert.ok(CODE.includes("findExamPlanByCourseOfferingId(context.courseOfferingId)"));
  // ...and no plan means the stored query is never reached.
  const stored = bodyOf("readAdminExamSupervisors");
  assert.ok(
    stored.indexOf("emptyAdminExamSupervisorListView()") <
      stored.indexOf("prisma.examSessionSupervisor.findMany("),
    "the empty view is not returned before the stored query",
  );
  // The eligible picker needs no plan at all, and asks for none.
  assert.equal(
    bodyOf("readEligibleExamSupervisorsForAdmin").includes("findExamPlanByCourseOfferingId"),
    false,
  );
});

test("r13. the eligible read is active-only, two-column and permission-free", () => {
  const entry = bodyOf("readEligibleExamSupervisorsForAdmin");
  assert.ok(entry.includes("prisma.instructor.findMany("));
  assert.ok(/where:\s*\{\s*isActive:\s*true,?\s*\}/.test(entry), `the where was: ${entry}`);

  // EXACTLY the instructor id and the display name.
  const select = entry.slice(entry.indexOf("select: {"), entry.indexOf("orderBy:"));
  const columns = [...select.matchAll(/^\s+(\w+): true,/gm)].map((match) => match[1]);
  assert.deepEqual(columns, ["id", "fullName"]);
  for (const forbidden of [
    "phone",
    "email",
    "identityNumber",
    "firstName",
    "lastName",
    "isActive",
    "createdAt",
    "updatedAt",
    "canEdit",
    "canSend",
    "canManage",
    "canView",
    "include",
  ]) {
    assert.equal(select.includes(forbidden), false, `the eligible read selects ${forbidden}`);
  }

  // The database order matches the core's, which re-imposes it regardless.
  assert.ok(/orderBy:\s*\[\s*\{\s*fullName:\s*"asc",?\s*\},\s*\{\s*id:\s*"asc",?\s*\},?\s*\]/.test(entry));
  // The rows are handed straight to the pure builder: no local order, no local
  // shaping and no local filter.
  assert.ok(entry.includes("buildEligibleExamSupervisorListView("));
  assert.ok(entry.includes("instructorId: row.id,"));
  assert.ok(entry.includes("fullName: row.fullName,"));
  assert.equal(entry.includes(".sort("), false, "the reader re-implements the order");
  assert.equal(entry.includes(".filter("), false, "the reader filters rows");
  // The picker's course-scope limitation is documented rather than hidden.
  const flat = COMMENTS.replace(/^\s*\*/gm, "").replace(/\s+/g, " ");
  assert.ok(
    /NO relation between an .?Instructor.? and a .?CourseOffering/i.test(flat),
    "the missing course relation is undocumented",
  );
});

test("r14. the stored read is ONE plan-scoped statement, unfiltered and instructor-id-free", () => {
  const entry = bodyOf("readAdminExamSupervisors");
  assert.ok(entry.includes("prisma.examSessionSupervisor.findMany("));
  // A relation FILTER on the SERVER-resolved plan, never an include.
  assert.ok(
    /where:\s*\{\s*session:\s*\{\s*planId:\s*plan\.id,?\s*\},?\s*\}/.test(entry),
    "the stored read is not plan-scoped",
  );
  assert.equal(entry.includes("include"), false, "the stored read includes a relation");

  // ONE statement for EVERY session: no loop around a query, and no per-session
  // read of any kind.
  assert.equal((entry.match(/prisma\./g) ?? []).length, 1, "the stored read runs more than once");
  for (const token of ["for (", "while (", "Promise.all", ".map(async", "forEach"]) {
    assert.equal(entry.includes(token), false, `the stored read loops with ${token}`);
  }

  // HISTORY: no activity, eligibility, capability or schedule filter, and no
  // application-side filtering.
  for (const forbidden of [
    "isActive",
    "courseEnrollment",
    "enrollment",
    "capability",
    "isPrimary",
  ]) {
    assert.equal(entry.includes(forbidden), false, `the stored read filters on ${forbidden}`);
  }
  assert.equal(entry.includes(".filter("), false, "the reader filters rows");
  assert.equal(entry.includes(".sort("), false, "the reader re-implements the order");

  // EXACTLY two own columns plus the instructor's display name — and no
  // Instructor.id anywhere on this path.
  const select = entry.slice(entry.indexOf("select: {"), entry.indexOf("orderBy:"));
  const columns = [...select.matchAll(/^\s+(\w+): true,/gm)].map((match) => match[1]);
  assert.deepEqual(columns, ["id", "sessionId", "fullName"]);
  for (const forbidden of [
    "instructorId",
    "phone",
    "email",
    "identityNumber",
    "canEdit",
    "canSend",
    "createdAt",
    "session: {",
  ]) {
    assert.equal(select.includes(forbidden), false, `the stored read selects ${forbidden}`);
  }

  // The required relation is mapped straight through; the pure core owns the
  // defensive placeholder, and this binding invents no name of its own.
  assert.ok(entry.includes("instructorName: row.instructor.fullName,"));
  assert.ok(entry.includes("supervisorId: row.id,"));
  assert.ok(entry.includes("sessionId: row.sessionId,"));
  assert.equal(entry.includes("מדריך"), false, "the binding hardcodes the placeholder");
  assert.ok(CORE_SOURCE.includes("מדריך ללא שם"), "the core lost its placeholder");

  // The database order matches the core's total order.
  assert.ok(/\{\s*sessionId:\s*"asc",?\s*\}/.test(entry));
  assert.ok(/\{\s*instructor:\s*\{\s*fullName:\s*"asc",?\s*\},?\s*\}/.test(entry));
  assert.ok(entry.includes("buildAdminExamSupervisorListView("));
});

// ===========================================================================
// 15–19. Containment: no caller, no UI, the approved files, nothing modified
// ===========================================================================

test("r15. NOTHING calls either reader: the module is deliberately unwired", () => {
  const declaring = new Set(
    [IO_REL, IO_TEST_REL, CORE_REL, CORE_TEST_REL].map((rel) => join(REPO_ROOT, rel)),
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
      if (declaring.has(path)) continue;
      const code = stripComments(readFileSync(path, "utf8"));
      const reaches =
        /exam-supervisor-read-io/.test(code) ||
        /admin-exam-supervisor-read-core/.test(code) ||
        /\breadEligibleExamSupervisorsForAdmin\s*\(/.test(code) ||
        /\breadAdminExamSupervisors\s*\(/.test(code) ||
        /\bbuild(EligibleExamSupervisorListView|AdminExamSupervisorListView)\s*\(/.test(code);
      if (reaches) callers.push(path.slice(REPO_ROOT.length + 1));
    }
  }
  assert.ok(scanned > 100, `expected the repository, scanned ${scanned} files`);
  assert.deepEqual(callers, [], `an unapproved caller exists: ${callers.join(", ")}`);
});

test("r16. no exam route, page, form or Server Action was created", () => {
  for (const dir of [
    join("app", "admin", "exams"),
    join("app", "instructor", "exams"),
    join("app", "student", "exams"),
  ]) {
    assert.equal(existsSync(join(REPO_ROOT, dir)), false, `${dir} was created`);
  }
  for (const rel of [IO_REL, IO_TEST_REL, CORE_REL, CORE_TEST_REL]) {
    assert.equal(rel.endsWith(".tsx"), false, `${rel} is a UI file`);
    const source = stripComments(readFileSync(join(REPO_ROOT, rel), "utf8"));
    assert.equal(source.includes('"use ' + 'server"'), false, `${rel} is a Server Action module`);
  }
  // The sibling write pair is likewise neither a UI file nor a Server Action.
  for (const rel of WRITE_FILES) {
    assert.equal(rel.endsWith(".tsx"), false, `${rel} is a UI file`);
    const source = stripComments(readFileSync(join(REPO_ROOT, rel.split("/").join(sep)), "utf8"));
    assert.equal(source.includes('"use ' + 'server"'), false, `${rel} is a Server Action module`);
  }
});

test("r17. the pure core stays DB-free, and the read pair is exactly two files", () => {
  const core = stripComments(CORE_SOURCE);
  for (const token of [
    PRISMA_MODULE,
    GENERATED_CLIENT,
    ENV_READ,
    "server" + "-only",
    "next/",
    "lib/auth",
    "lib/course",
  ]) {
    assert.equal(core.includes(token), false, `the pure core references ${token}`);
  }
  assert.equal(/(^|\n)\s*import\s/.test(core), false, "the pure core imports something");

  assert.deepEqual(
    readdirSync(join(REPO_ROOT, "lib", "actions"))
      .filter((name) => name.startsWith("exam-supervisor-read"))
      .sort(),
    ["exam-supervisor-read-io.test.ts", "exam-supervisor-read-io.ts"],
  );
  assert.deepEqual(
    readdirSync(join(REPO_ROOT, "lib", "exam"))
      .filter((name) => name.startsWith("admin-exam-supervisor-read"))
      .sort(),
    ["admin-exam-supervisor-read-core.test.ts", "admin-exam-supervisor-read-core.ts"],
  );
});

test("r18. the slice modified NO tracked file: no schema, migration, auth or policy", () => {
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
  ];
  for (const path of APPROVED_MODIFICATIONS) {
    assert.ok(
      path.endsWith(".test.ts") || APPROVED_PRODUCTION.includes(path),
      `${path} is neither a suite nor an approved production file`,
    );
    assert.equal(/supervisor/.test(path) && !path.endsWith(".test.ts"), false, `${path}`);
  }

  const prismaStatus = gitLines(["status", "--porcelain", "--", "prisma"]);
  assert.deepEqual(prismaStatus, [], `prisma/ changed: ${prismaStatus.join(", ")}`);

  // No file on the read path hardcodes a cuid-shaped identifier.
  for (const rel of [IO_REL, IO_TEST_REL, CORE_REL, CORE_TEST_REL]) {
    const source = readFileSync(join(REPO_ROOT, rel), "utf8");
    assert.equal(
      /["']c[a-z0-9]{24}["']/.test(source),
      false,
      `${rel} hardcodes a cuid-shaped literal`,
    );
  }
});

test("r19. this suite opens no database and reads no environment", () => {
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
