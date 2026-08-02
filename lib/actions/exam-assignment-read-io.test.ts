/**
 * EXAM EX-ASG-IO1 — the guard suite for the ADMIN assignment READ bindings.
 *
 * Run with: npx tsx --test lib/actions/exam-assignment-read-io.test.ts
 *
 * WHY THIS SUITE IS STRUCTURAL RATHER THAN BEHAVIOURAL. The module under test
 * declares `server-only` and imports the database client, so importing it here
 * would either fail the build or open a real connection. The SHAPING it binds —
 * the two total orders, the placeholder, the freeze, the empty views — is proven
 * at runtime by the pure core's own DB-free suite. What is left, and what only a
 * source-text guard can prove, is that the BINDING reads exactly what it is
 * allowed to read, scoped by exactly the server-verified ids, behind exactly the
 * right gate, and writes nothing at all.
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

const IO_REL = join("lib", "actions", "exam-assignment-read-io.ts");
const IO_TEST_REL = join("lib", "actions", "exam-assignment-read-io.test.ts");
const CORE_REL = join("lib", "exam", "admin-exam-assignment-read-core.ts");
const CORE_TEST_REL = join("lib", "exam", "admin-exam-assignment-read-core.test.ts");

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
  assert.ok(COMMENTS.includes("use " + "server"), "the rule is undocumented");
});

test("3. the module exports exactly TWO functions, and no value", () => {
  assert.deepEqual(
    SIGNATURES.map((entry) => entry.name),
    ["readEligibleExamTraineesForAdmin", "readAdminExamAssignments"],
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

test("4. each entry point takes ONLY a courseOfferingId and returns its view", () => {
  const [trainees, assignments] = SIGNATURES;
  assert.equal(trainees.params, "courseOfferingId: string,");
  assert.equal(trainees.returns, "Promise<EligibleExamTraineeListView>");
  assert.equal(assignments.params, "courseOfferingId: string,");
  assert.equal(assignments.returns, "Promise<AdminExamAssignmentListView>");

  for (const forbidden of [
    "planId",
    "sessionId",
    "studentId",
    "assignmentId",
    "role",
    "adminId",
    "actorId",
    "instructorId",
    "date",
    "take",
    "skip",
    "cursor",
    "tx",
    "prisma",
    "deps",
  ]) {
    for (const entry of [trainees, assignments]) {
      assert.equal(
        entry.params.includes(forbidden),
        false,
        `${entry.name} accepts ${forbidden}`,
      );
    }
  }
});

test("5. the module imports EXACTLY the approved specifiers", () => {
  const specifiers = [...CODE.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(
    [...new Set(specifiers)].sort(),
    [
      "@/app/generated/prisma/client",
      "@/lib/course/admin-course-context",
      "@/lib/course/operation-policy-core",
      "@/lib/exam/admin-exam-assignment-read-core",
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

test("6. requireAdminCourseOffering is bound once, with the RAW requested id", () => {
  assert.equal((CODE.match(/await requireAdminCourseOffering\(/g) ?? []).length, 1);
  assert.ok(
    /requireAdminCourseOffering\(requestedCourseOfferingId\)/.test(CODE),
    "the admin boundary is not called with the requested id",
  );
  const helper = bodyOf("requireCourseContext");
  assert.equal(/prisma\./.test(helper), false, "the authorization helper queries");
  assert.ok(/courseOfferingId:\s*context\.id/.test(helper), "the verified id is not carried");
  assert.ok(/status:\s*context\.status/.test(helper), "the verified status is not carried");
  // ONE helper, shared by BOTH reads.
  assert.equal((CODE.match(/function requireCourseContext\(/g) ?? []).length, 1);
  assert.equal((CODE.match(/requireCourseContext\(courseOfferingId\)/g) ?? []).length, 2);
});

test("7. BOTH reads authorize FIRST, then gate, before any query", () => {
  for (const name of ["readEligibleExamTraineesForAdmin", "readAdminExamAssignments"]) {
    const entry = bodyOf(name);
    const authorize = entry.indexOf("await requireCourseContext(courseOfferingId)");
    const gate = entry.indexOf("assertHistoricalReadAllowed(context.status)");
    const firstQuery = entry.search(/\b(prisma\.|findExamPlanByCourseOfferingId\()/);
    assert.ok(authorize > 0, `${name} does not authorize`);
    assert.ok(gate > authorize, `${name} gates before it authorizes`);
    assert.ok(firstQuery > gate, `${name} queries before it gates`);
  }
});

test("8. the lifecycle gate is HISTORICAL_READ, and no capability is consulted", () => {
  const gate = bodyOf("assertHistoricalReadAllowed");
  assert.ok(gate.includes("assertCourseOperationAllowed("));
  assert.ok(gate.includes('"HISTORICAL_READ"'), "the wrong operation is gated");
  assert.ok(gate.includes("status as CourseOfferingStatus"));
  assert.equal((CODE.match(/assertCourseOperationAllowed\(/g) ?? []).length, 1);
  // A READ never borrows the write gate: an ARCHIVED offering's roster stays
  // readable history while its assignments may no longer be changed.
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

test("9. NOTHING is classified: a denial never becomes an empty view", () => {
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
  // The one absence it DOES report is the honest one, and it is the core's own
  // empty view rather than a locally invented shape.
  assert.ok(CODE.includes("return emptyAdminExamAssignmentListView();"));
  assert.equal(CODE.includes("Object.freeze"), false, "the reader builds a view itself");
});

// ===========================================================================
// 10–13. The exact query inventory, and no write of any kind
// ===========================================================================

test("10. the module issues EXACTLY three statements, all reads", () => {
  const statements = [...CODE.matchAll(/\bprisma\.(\w+)\.(\w+)\(/g)].map(
    ([, model, method]) => `${model}.${method}`,
  );
  assert.deepEqual(statements.sort(), [
    "courseEnrollment.findMany",
    "examAssignment.findMany",
    "examPlan.findUnique",
  ]);
});

test("11. NO write method, transaction or raw statement exists in the reader", () => {
  const writes = /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/;
  assert.equal(writes.test(CODE), false, "the reader performs a write");
  for (const token of [
    "$transaction",
    "$executeRaw",
    "$queryRaw",
    "aggregate(",
    "groupBy(",
    "count(",
  ]) {
    assert.equal(CODE.includes(token), false, `the reader uses ${token}`);
  }
  // ...and it reaches no model outside the three it reads.
  for (const token of [
    "teachingPractice",
    "examBeginnerChild",
    "examSessionSupervisor",
    "examSessionBreak",
    "signedForm",
    "prisma.student.",
    "prisma.instructor.",
  ]) {
    assert.equal(CODE.includes(token), false, `the reader touches ${token}`);
  }
});

test("12. the plan lookup uses the VERIFIED offering id and selects only its id", () => {
  const reader = bodyOf("findExamPlanByCourseOfferingId");
  assert.ok(reader.includes("prisma.examPlan.findUnique("));
  assert.ok(
    /where:\s*\{\s*courseOfferingId:\s*verifiedCourseOfferingId\s*\}/.test(reader),
    `the plan where was: ${reader}`,
  );
  const select = reader.slice(reader.indexOf("select: {"));
  assert.ok(/select:\s*\{\s*id:\s*true\s*\}/.test(select));
  for (const forbidden of ["publishedAt", "sessions", "definitions", "include"]) {
    assert.equal(select.includes(forbidden), false, `the plan read selects ${forbidden}`);
  }
  // It is called with the VERIFIED id, never the requested one.
  assert.ok(CODE.includes("findExamPlanByCourseOfferingId(context.courseOfferingId)"));
  // No plan short-circuits BEFORE the assignment query.
  const entry = bodyOf("readAdminExamAssignments");
  assert.ok(
    entry.indexOf("emptyAdminExamAssignmentListView()") <
      entry.indexOf("prisma.examAssignment.findMany("),
    "the empty view is not returned before the assignment query",
  );
});

test("13. the eligible read is scoped, fail-closed and two-column", () => {
  const entry = bodyOf("readEligibleExamTraineesForAdmin");
  assert.ok(entry.includes("prisma.courseEnrollment.findMany("));
  for (const condition of [
    "courseOfferingId: context.courseOfferingId,",
    'status: "ACTIVE",',
    "student: { isActive: true },",
  ]) {
    assert.ok(entry.includes(condition), `the eligibility where lacks: ${condition}`);
  }
  // Exactly the trainee id and the display name.
  assert.ok(entry.includes("studentId: true,"));
  assert.ok(entry.includes("student: { select: { fullName: true } },"));
  for (const forbidden of [
    "isPrimary",
    "identityNumber",
    "phone",
    "parent",
    "memberships",
    "groupName",
    "subgroupNumber",
    "assignedHorseName",
    "privateHorseName",
    "id: true,",
    "include",
  ]) {
    assert.equal(entry.includes(forbidden), false, `the eligible read reads ${forbidden}`);
  }
  // The database order matches the core's, which re-imposes it regardless.
  assert.ok(
    entry.includes('orderBy: [{ student: { fullName: "asc" } }, { studentId: "asc" }],'),
  );
  // The rows are handed straight to the pure builder: no local order, no local
  // shaping and no local filter.
  assert.ok(entry.includes("buildEligibleExamTraineeListView("));
  assert.equal(entry.includes(".sort("), false, "the reader re-implements the order");
  assert.equal(entry.includes(".filter("), false, "the reader filters rows");
});

test("14. the assignment read is plan-scoped, unfiltered and student-id-free", () => {
  const entry = bodyOf("readAdminExamAssignments");
  assert.ok(entry.includes("prisma.examAssignment.findMany("));
  // A relation FILTER on the SERVER-resolved plan, never an include.
  assert.ok(
    entry.includes("where: { session: { planId: plan.id } },"),
    "the assignment read is not plan-scoped",
  );
  assert.equal(entry.includes("include"), false, "the assignment read includes a relation");

  // HISTORY: no role filter, no activity filter, no enrolment join.
  for (const forbidden of [
    'role: "',
    "role: {",
    "isActive",
    "courseEnrollment",
    "enrollments",
    "enrollment:",
  ]) {
    assert.equal(entry.includes(forbidden), false, `the assignment read filters on ${forbidden}`);
  }
  assert.equal(entry.includes(".filter("), false, "the reader filters rows");
  assert.equal(entry.includes(".sort("), false, "the reader re-implements the order");

  // Exactly SEVEN own columns plus the trainee's display name — and no Student.id.
  //
  // RE-POINTED by EX-ASG-LTD2-B1, and GROWN rather than relaxed: the two stored
  // DETAIL values of an examinee's row joined the select. They are the
  // ASSIGNMENT's OWN columns — free text a manager typed about the exam — so the
  // list can describe more without reaching further: NOT ONE additional `Student`
  // column, NOT ONE additional relation and NOT ONE additional statement came with
  // them, which the exact list here, the unchanged `student` select and guard 10's
  // three-statement inventory each prove independently.
  //
  // RE-POINTED AGAIN by EX-PAIR-UI-MVP, and GROWN by EXACTLY ONE column:
  // `pairingIndex`. WHICH examinee an instructed trainee is paired with is
  // undecidable without it, and the alternative — a SECOND reader with its own
  // admin boundary, its own plan resolution and its own statements — would be
  // strictly worse for every property this suite protects.
  //
  // It is the ASSIGNMENT's OWN column and an INTERNAL allocation label rather
  // than a fact about a person, and it stays SERVER-INTERNAL in the strongest
  // available sense: it is handed to the pure core, which CONSUMES it to resolve
  // the pairing and publishes the ANSWER — a partner assignment id and a display
  // name — instead. The core's own suite proves AT RUNTIME that no published row
  // carries it and that it appears in no serialized payload; the ban below is
  // therefore re-pointed onto the MAPPING rather than dropped. NOT ONE additional
  // `Student` column, NOT ONE additional relation and NOT ONE additional
  // statement came with it, which the exact list here, the unchanged `student`
  // select and guard 10's three-statement inventory each prove independently.
  //
  // This is an EXACT list in EXACT source order, so a NINTH column still fails
  // here, and the personal, scoping and audit bans below are untouched.
  const select = entry.slice(entry.indexOf("select: {"), entry.indexOf("orderBy:"));
  const columns = [...select.matchAll(/^\s+(\w+): true,/gm)].map((match) => match[1]);
  assert.deepEqual(columns, [
    "id",
    "sessionId",
    "role",
    "horseName",
    "instructionTopic",
    "discipline",
    "orderIndex",
    "pairingIndex",
  ]);
  assert.ok(select.includes("student: { select: { fullName: true } },"));
  // The two new columns are selected as themselves and mapped straight through:
  // no rename, no default, no coalescing and no role test anywhere on the path.
  assert.ok(entry.includes("instructionTopic: row.instructionTopic,"));
  assert.ok(entry.includes("discipline: row.discipline,"));
  assert.equal(
    /instructionTopic:[^\n]*\?\?/.test(entry) || /discipline:[^\n]*\?\?/.test(entry),
    false,
    "a detail value is defaulted rather than carried",
  );
  assert.ok(entry.includes("pairingIndex: row.pairingIndex,"));
  for (const forbidden of [
    "studentId: true",
    "sourcePracticeRole",
    "notes",
    "createdAt",
    "updatedAt",
    "session: {",
  ]) {
    assert.equal(select.includes(forbidden), false, `the assignment read selects ${forbidden}`);
  }

  // THE INDEX IS CONSUMED, NEVER RE-PUBLISHED. This binding hands it to the pure
  // core and does nothing else with it: it is not compared, not counted, not
  // grouped, not renamed and not turned into a partner here. Every pairing
  // decision — which roles may pair, that both rows share one session, which
  // index identifies exactly one examinee, and which fails closed — belongs to
  // the committed rule the core consults, and a second copy in this shell would
  // be free to drift from it.
  // THREE mentions and no fourth: the select column, and the two halves of the
  // straight `pairingIndex: row.pairingIndex,` mapping.
  assert.equal(
    (entry.match(/pairingIndex/g) ?? []).length,
    3,
    "the index is used for something beyond the select and the straight mapping",
  );
  for (const forbidden of ["pairedExaminee", "resolveExamPairings", "INSTRUCTED_TRAINEE"]) {
    assert.equal(entry.includes(forbidden), false, `the binding resolves pairing itself: ${forbidden}`);
  }

  // The nullable relation is mapped to null, which the pure core resolves to its
  // ONE fixed placeholder — the binding invents no name of its own.
  assert.ok(entry.includes("traineeName: row.student === null ? null : row.student.fullName,"));
  assert.equal(entry.includes("ללא"), false, "the binding hardcodes the placeholder");
  assert.ok(CORE_SOURCE.includes("ללא חניך משויך"), "the core lost its placeholder");

  assert.ok(
    entry.includes('orderBy: [{ sessionId: "asc" }, { orderIndex: "asc" }, { id: "asc" }],'),
  );
  assert.ok(entry.includes("buildAdminExamAssignmentListView("));
  // `Student.id` is neither selected nor mapped on the ASSIGNMENT path. (The
  // eligible picker DOES carry one, deliberately: it exists to be submitted back
  // as the create's chosen trainee.)
  assert.equal(entry.includes("studentId"), false, "a Student.id reaches the assignment view");
});

// ===========================================================================
// 15–18. Containment: no caller, no UI, the approved files, nothing modified
// ===========================================================================

test("15. EXACTLY the approved page calls either reader — and nothing else does", () => {
  // EX-ASG-UI1 TRANSITION. This guard asserted the caller list was EMPTY, which was
  // the correct claim while the read binding was committed but deliberately
  // unwired. Wiring it is exactly what makes that claim obsolete, so the guard is
  // RE-POINTED to an equally exact positive claim rather than deleted or weakened
  // to "some caller exists": the ONE course-scoped admin exams page, and nothing
  // else anywhere under `app/`, `lib/` or `components/`.
  //
  // A SECOND caller — an instructor page, a trainee page, a component, another
  // route — still fails here, which is the whole point: these readers carry an
  // admin boundary and a course-lifecycle gate, and every new caller is a new
  // decision about who may see a course's exam roster.
  const declaring = new Set(
    [IO_REL, IO_TEST_REL, CORE_REL, CORE_TEST_REL].map((rel) => join(REPO_ROOT, rel)),
  );
  // The ONE production module authorized to reach either reader. The route's own
  // contract suite is deliberately NOT on this list: it asserts things ABOUT these
  // readers and never invokes one, and it spells every module name and call shape
  // in split literals precisely so it does not enrol itself here.
  const APPROVED_CALLERS = [
    join("app", "admin", "courses", "[courseOfferingId]", "exams", "page.tsx"),
  ];

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
        /exam-assignment-read-io/.test(code) ||
        /admin-exam-assignment-read-core/.test(code) ||
        /\breadEligibleExamTraineesForAdmin\s*\(/.test(code) ||
        /\breadAdminExamAssignments\s*\(/.test(code) ||
        /\bbuild(EligibleExamTraineeListView|AdminExamAssignmentListView)\s*\(/.test(code);
      if (reaches) callers.push(path.slice(REPO_ROOT.length + 1));
    }
  }
  // Sanity: the exact result below is a PASS, not an empty search.
  assert.ok(scanned > 100, `expected the repository, scanned ${scanned} files`);
  assert.deepEqual(
    callers.sort(),
    APPROVED_CALLERS,
    `the caller list is not exactly the approved page: ${callers.join(", ")}`,
  );
});

test("16. no exam route, page, form or Server Action was created", () => {
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
});

test("17. the pure core stays DB-free, and the read pair is exactly two files", () => {
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
  // RE-POINTED by EX-PAIR-UI-MVP, and NARROWED to an EXACT count rather than
  // dropped. The claim was "the pure core imports NOTHING", which was correct
  // while it answered questions about one row at a time. Resolving WHICH
  // examinee an instructed trainee is paired with is a question about a
  // RELATIONSHIP, and the repository already owns ONE committed answer to it;
  // restating that rule inside the core would give this screen a second copy
  // free to drift from the one the operational readers use.
  //
  // What this guard always protected is asserted UNCHANGED above and holds: the
  // core still reaches no database, no `server-only`, no framework, no auth and
  // no course policy. The one import is a pure sibling in the core's OWN
  // directory, named by a RELATIVE specifier — so it can reach nothing this
  // guard forbids either — and its own suite proves it. A SECOND import still
  // fails here, and the core's own guard 21 pins WHICH single specifier it is.
  assert.equal(
    (core.match(/(^|\n)\s*import\s/g) ?? []).length,
    1,
    "the pure core imports more than the one approved sibling",
  );
  const coreSpecifiers = [...core.matchAll(/\bfrom\s+"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(coreSpecifiers.length, 1, "the pure core has more than one specifier");
  assert.ok(
    coreSpecifiers[0].startsWith("./"),
    "the pure core reaches outside its own directory",
  );

  assert.deepEqual(
    readdirSync(join(REPO_ROOT, "lib", "actions"))
      .filter((name) => name.startsWith("exam-assignment-read"))
      .sort(),
    ["exam-assignment-read-io.test.ts", "exam-assignment-read-io.ts"],
  );
  assert.deepEqual(
    readdirSync(join(REPO_ROOT, "lib", "exam"))
      .filter((name) => name.startsWith("admin-exam-assignment-read"))
      .sort(),
    ["admin-exam-assignment-read-core.test.ts", "admin-exam-assignment-read-core.ts"],
  );
});

test("18. only the approved wiring paths are modified: no schema, migration, auth or policy", () => {
  // EX-ASG-UI1 TRANSITION. This guard asserted the working tree modified NOTHING,
  // which was correct while EX-ASG-IO1 was the uncommitted slice and added only new
  // files. The wiring slice necessarily modifies the route's Server Action module,
  // its page and the committed guard suites whose exact counts it re-points, so the
  // guard is RE-POINTED to an EXACT allow-list rather than deleted.
  //
  // What it always protected is unchanged and is what the list proves: no schema,
  // no migration, no auth module, no session module, no capability catalog, no
  // course-policy core, and no `lib/` PRODUCTION file of any kind — every `lib/`
  // entry below is a `.test.ts` guard suite. The route paths are spelled whole
  // because this suite is under `lib/` and no guard sweeps `lib/` for them.
  const APPROVED_MODIFICATIONS = [
    "app/admin/courses/[courseOfferingId]/exams/actions.ts",
    "app/admin/courses/[courseOfferingId]/exams/page.tsx",
    "app/admin/courses/[courseOfferingId]/exams/exam-definition-create.contract.test.ts",
    "app/admin/courses/[courseOfferingId]/exams/exam-definitions-page.contract.test.ts",
    "app/admin/courses/[courseOfferingId]/exams/exam-plan-create.contract.test.ts",
    "app/admin/courses/[courseOfferingId]/exams/exam-session-create.contract.test.ts",
    "app/admin/courses/[courseOfferingId]/exams/exam-session-edit-delete.contract.test.ts",
    "lib/actions/" + "exam-assignment-read" + "-io.test.ts",
    "lib/actions/" + "exam-assignment-write" + "-io.test.ts",
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
    // EX-ASG-LTD2-B1 — the ADMIN READ DETAIL slice, which travels in the same
    // working tree. It is the FIRST slice to edit this read pair's own production
    // modules, so the two of them and the pure core's suite join the list. That is
    // an EXACT, three-entry addition and not a relaxation: the modules are this
    // guard's OWN subject, the change is two nullable columns on the assignment
    // select and two fields on the published row, and every other claim in this
    // suite — server-only, two exports, three statements, no write, the admin
    // boundary, the HISTORICAL_READ gate, no capability, no classification and the
    // absent `Student.id` — is asserted unchanged above and holds.
    //
    // What this guard has always refused is unchanged: no schema, no migration, no
    // auth module, no session module, no capability catalog and no course-policy
    // core is named here, and the assertion below still pins WHICH `lib/`
    // production modules may appear.
    "lib/exam/" + "admin-exam-assignment-read" + "-core.ts",
    "lib/exam/" + "admin-exam-assignment-read" + "-core.test.ts",
    "lib/actions/" + "exam-assignment-read" + "-io.ts",
    // ...and the two committed SUPERVISOR IO footprint guards, whose "this slice
    // modified NO tracked file" claims this edit makes obsolete. Both are SUITES;
    // no supervisor production module is named, and the assertion below still
    // pins WHICH `lib/` production modules may appear at all.
    "lib/actions/" + "exam-supervisor-read" + "-io.test.ts",
    "lib/actions/" + "exam-supervisor-write" + "-io.test.ts",
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
    "app/admin/courses/[courseOfferingId]/exams/CreateExamAssignmentForm.tsx",
    "app/admin/courses/[courseOfferingId]/exams/exam-assignment-messages.ts",
    "lib/actions/" + "detailed-exam-assignment-write" + "-io.test.ts",
    // EX-PAIR-BE-MVP — the approved instructed-trainee/examinee PAIRING backend,
    // which travels in the same working tree. Its four `lib/` additions re-point
    // the footprint list of the neighbouring publication backend's guard SUITE,
    // so that suite joins the modified set. It is a `.test.ts`; no production
    // file, no route, no Server Action and no schema, migration, auth, session,
    // capability or policy file comes with it, and THIS reader is neither edited
    // nor given a caller by it.
    "lib/actions/" + "exam-publication-write" + "-io.test.ts",
    "lib/actions/" + "exam-pairing-write" + "-io.test.ts",
    // EX-PAIR-UI-MVP — the approved ADMIN PAIRING UI, which wires that same
    // committed pairing backend to this route. It is the FIRST slice since
    // EX-ASG-LTD2-B1 to edit THIS read pair's own production modules, and it does
    // so for one reason: the pairing cannot be displayed without reading the
    // index behind it. The pair and the pure core's suite therefore rejoin the
    // list BY NAME, together with the route's action module and page (already
    // above) and the ONE contract suite the slice adds — an ADDITION rather than
    // a modification, so it does not appear here at all.
    //
    // What this guard has always refused is unchanged: no schema, no migration,
    // no auth module, no session module, no capability catalog and no
    // course-policy core is named, and the assertion below still pins WHICH
    // `lib/` production modules may appear.
    "lib/exam/" + "admin-exam-assignment-read" + "-core.ts",
    "lib/exam/" + "admin-exam-assignment-read" + "-core.test.ts",
    "lib/actions/" + "exam-assignment-read" + "-io.ts",
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
    // BLOCKER-1 — the canonical wave narrowing, and the ONE committed `lib/`
    // production module the workspace modifies: the role-reader module gains one
    // ADMIN-ONLY export so the admin schedule reuses the committed timetable
    // derivation instead of reproducing it. ASSEMBLED.
    "lib/exam/" + "admin-exam-wave-view" + "-core.ts",
    "lib/exam/" + "admin-exam-wave-view" + "-core.test.ts",
    "lib/actions/" + "exam-role" + "-readers.ts",
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

  // RE-POINTED by EX-ASG-LTD2-B1, and NARROWED to an exact pair rather than
  // dropped. The claim was "no `lib/` PRODUCTION module was touched at all", which
  // was correct while every earlier slice only WIRED these bindings. A read that
  // must publish two more stored columns has to edit the pair that reads them, so
  // the guard now names EXACTLY the two modules this suite is about — the pure
  // read-shaping core and its own binding — and a THIRD `lib/` production module,
  // of any kind, still fails here. No writer, no policy core, no auth module and
  // no session module may appear.
  // RE-POINTED AGAIN by EX-ASG-LTD2-B2, back to the STRICTEST form of the claim -
  // EMPTY. The pair above was correct while the read slice was uncommitted in this
  // working tree; it is committed now, so those names described a moment rather
  // than a rule. The wiring slice that followed edits no `lib/` production module
  // at all - every binding it reaches is already committed, and the wiring lives
  // entirely under `app/` - so the original claim is restored in full.
  //
  // RE-POINTED ONCE MORE by EX-PAIR-UI-MVP, back to the EXACT PAIR. That slice
  // must display a pairing, which is undecidable without reading the index behind
  // it, so it edits the two modules THIS SUITE IS ABOUT — the pure read-shaping
  // core and its own binding — and nothing else under `lib/`. A THIRD `lib/`
  // production module, of ANY kind, still fails here: no writer, no policy core,
  // no auth module and no session module may appear.
  const libProduction = modified
    .filter((path) => path.startsWith("lib/") && !path.endsWith(".test.ts"))
    .sort();
  assert.deepEqual(
    libProduction,
    // RE-POINTED by BLOCKER-1 to an EXACT single entry. The admin read pair was
    // edited by the PAIRING slice that shared this working tree; the workspace
    // slice modifies exactly ONE committed `lib/` production module — the
    // role-reader module, which gains one ADMIN-ONLY export so the admin schedule
    // reuses the committed timetable derivation instead of reproducing it. Its own
    // three `lib/` modules are ADDITIONS, which a modifications-only diff does not
    // report. Any OTHER modification still fails here. ASSEMBLED.
    // MERGE RESOLUTION — the UNION of both slices' approved lib production edits.
    //
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
      // Every entry this list used to name — the plan loader, the read DTO, the
      // read scope core, the trainee view core and the role-reader module — was
      // edited by slices that shared this working tree and are MERGED into `main`
      // now. Measured against HEAD they are no longer modifications, so the names
      // described a moment rather than a rule.
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
});

test("19. this suite opens no database and reads no environment", () => {
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
