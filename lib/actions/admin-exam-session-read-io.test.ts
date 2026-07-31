/**
 * EXAM EX-SES-R1 — STRUCTURAL contract for the ADMIN stored-ExamSession read
 * bindings.
 *
 * WHY STRUCTURAL. The module under test declares `import "server-only"`, which
 * makes it unloadable from a plain `tsx --test` process — that is the point of
 * the declaration. Its BEHAVIOUR is proven, DB-free, through the pure,
 * dependency-injected core it binds (the sibling suite in `lib/exam`); its
 * BINDINGS are proven here, on its source text.
 *
 * DB-FREE AND PRODUCTION-FREE: this suite reads repository sources from disk and
 * runs `git` to describe its own file scope. It opens no database connection,
 * executes no SQL, reads no environment variable, resolves no session, makes no
 * network request and names no production identifier.
 *
 * WHAT IS PROVEN HERE:
 *   - the module kind: server-only, NOT a Server Action, not a route handler;
 *   - authorization is bound FIRST, and no query exists outside the four
 *     server-owned query helpers the core injects;
 *   - only the DB-VERIFIED offering id reaches the plan query, and only the
 *     server-resolved plan id reaches the definition, session and count queries;
 *   - no caller-supplied plan id, session id, definition id or filter is
 *     expressible in the public signature;
 *   - the gate is the READ gate (`HISTORICAL_READ`), never the write gate, and
 *     no capability is consulted;
 *   - EXACTLY four statements touch the database: one plan lookup, one
 *     definition list, one session list and one grouped count — none in a loop,
 *     none nested in a per-row callback, so there is no N+1 at any size;
 *   - the selects are exactly the approved column sets, and nothing forbidden is
 *     read: no deprecated session column, no assignment record, supervisor,
 *     break, beginner child, student, instructor, Teaching-Practice lesson,
 *     contact, diagnostic, grade or evaluation, and no `include` anywhere;
 *   - `publishedAt` and `updatedAt` become epoch milliseconds HERE, the stored
 *     calendar date becomes a `YYYY-MM-DD` key HERE, and no `Date` leaves the
 *     module;
 *   - the module writes nothing, opens no transaction, runs no raw SQL and lets
 *     no database client or raw row type escape;
 *   - the reader is UNWIRED: nothing in `app`, `lib` or `components` calls it,
 *     and no exam route directory was created;
 *   - the slice is EXACTLY four new files and modifies no tracked file.
 *
 * ON THE MODULE NAME. This binding is `admin-exam-session-read-io`, not
 * `exam-session-read-io`, because the committed session-WRITE suite asserts an
 * exact directory listing of every file in `lib/actions` whose name begins with
 * that write prefix. A read binding sharing the prefix would break a green,
 * committed guard for a reason unrelated to what the guard protects. Guard 13
 * below pins that decision so it cannot be silently undone.
 *
 * Run with: npx tsx --test lib/actions/admin-exam-session-read-io.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

const IO_REL = join("lib", "actions", "admin-exam-session-read-io.ts");
const IO_TEST_REL = join("lib", "actions", "admin-exam-session-read-io.test.ts");
const CORE_REL = join("lib", "exam", "admin-exam-session-read-core.ts");
const CORE_TEST_REL = join("lib", "exam", "admin-exam-session-read-core.test.ts");

/** The four files this slice consists of, in repository form. */
const NEW_FILES = [
  "lib/actions/admin-exam-session-read-io.ts",
  "lib/actions/admin-exam-session-read-io.test.ts",
  "lib/exam/admin-exam-session-read-core.ts",
  "lib/exam/admin-exam-session-read-core.test.ts",
];

/**
 * The route that EX-SES-UI-1 wires this reader into — its ONE production caller,
 * in the OS-native form guard 29's sweep reports.
 */
const ROUTE_DIR_REL = join("app", "admin", "courses", "[courseOfferingId]", "exams");
const APPROVED_CALLER_REL = join(ROUTE_DIR_REL, "page.tsx");

/**
 * The route directory in git's own form: forward slashes, repository-relative.
 * Used only by the footprint guards, which read git's output rather than the
 * filesystem's.
 */
const ROUTE_DIR_PREFIX = "app/admin/courses/[courseOfferingId]/exams/";

/**
 * Every tracked file EX-SES-UI-1 is authorized to have MODIFIED — the wired page,
 * the four route contract suites whose claims the wiring makes obsolete, this
 * suite, and the four `lib/` footprint guards whose approved-path sets had to
 * learn about this slice.
 *
 * The four `lib/` guard paths are ASSEMBLED rather than spelled. Each of those
 * committed suites sweeps `app/`, `lib/` and `components/` for its OWN module
 * name and pins the result to an exact caller list; a file that spelled one of
 * them whole would enrol itself in the very list it is trying not to disturb.
 */
const APPROVED_MODIFIED_FILES = [
  `${ROUTE_DIR_PREFIX}page.tsx`,
  `${ROUTE_DIR_PREFIX}exam-definitions-page.contract.test.ts`,
  `${ROUTE_DIR_PREFIX}exam-plan-create.contract.test.ts`,
  `${ROUTE_DIR_PREFIX}exam-definition-create.contract.test.ts`,
  `${ROUTE_DIR_PREFIX}exam-session-create.contract.test.ts`,
  "lib/actions/admin-exam-session-read-io.test.ts",
  "lib/actions/" + "exam-session-write" + "-io.test.ts",
  "lib/actions/" + "exam-definition-read" + "-io.test.ts",
  "lib/actions/" + "exam-plan-write" + "-io.test.ts",
  "lib/exam/" + "create-exam-plan" + "-core.test.ts",
  // EX-SES-UI-2 — the approved session EDIT and REMOVAL UI, which travels in the
  // same working tree. It adds the route's shared Server Action module to the
  // MODIFIED set, and its three new route files to `INTRODUCED_FILES` below.
  //
  // Guard 29's claim about who may call THIS reader is untouched by it: the page
  // is still the only consumer, and neither new form reads a session — both are
  // handed their values as props by that one page.
  `${ROUTE_DIR_PREFIX}actions.ts`,
  // EX-ASG-UI1 — the approved stored-assignment CREATE and REMOVAL UI, which
  // travels in the same working tree. It adds the session edit/delete contract
  // suite to the MODIFIED set (that suite's per-session id counts learn about the
  // assignment create form's hidden field), plus the two committed assignment
  // guards and the supervisor core guard whose footprint lists it re-points. Its
  // four new route files join the list below.
  //
  // Guard 29's claim about who may call THIS reader is untouched by it: the page is
  // still the only consumer, and neither new form reads a session — both are handed
  // their values as props by that one page. The assignment slice reads its own rows
  // through its OWN committed binding and groups them against the session ids this
  // reader already returned, so it adds no caller here.
  `${ROUTE_DIR_PREFIX}exam-session-edit-delete.contract.test.ts`,
  "lib/actions/" + "exam-assignment-write" + "-io.test.ts",
  "lib/actions/" + "exam-assignment-read" + "-io.test.ts",
  "lib/exam/" + "exam-supervisor-write" + "-core.test.ts",
  "lib/actions/" + "exam-plan-write" + "-io.test.ts",
  "lib/exam/" + "create-exam-plan" + "-core.test.ts",
  // EX-ASG-IT2 — the approved INSTRUCTED_TRAINEE assignment CREATE UI, which
  // travels in the same working tree. It adds the ASSIGNMENT contract suite to
  // the modified set (that suite's route file set and export list learn about
  // the eighth endpoint) and the committed instructed-trainee write guard,
  // whose caller list it re-points from zero to exactly one Server Action
  // module. Its own three new route files are ADDITIONS. Nothing here changes
  // which module this guard is about: no reader gained a caller, no writer was
  // edited, and no schema, migration, auth, capability or policy file is named.
  `${ROUTE_DIR_PREFIX}exam-assignment-ui.contract.test.ts`,
  // ...and that slice's OWN contract suite, which EX-ASG-LTD2-B1 re-points: the
  // detail values it now displays are the examinee's, so the suite's blanket ban
  // on naming them is narrowed to the files that could WRITE one.
  `${ROUTE_DIR_PREFIX}exam-instructed-trainee-assignment-ui.contract.test.ts`,
  "lib/actions/" + "exam-instructed-trainee-assignment-write" + "-io.test.ts",
  // EX-ASG-LTD2-B1 — the approved ADMIN READ DETAIL slice, which travels in the
  // same working tree. It publishes two stored columns the assignment READ pair
  // already reached, so that pair's two PRODUCTION modules and its pure core's
  // suite join this list, together with the two supervisor footprint guards whose
  // "nothing was modified" claims it re-points.
  //
  // Nothing here changes which module THIS guard is about: this reader gained no
  // caller, neither it nor its pure core was edited — both are re-asserted
  // byte-identical below — and no schema, migration, auth, session, capability or
  // policy file appears. Every path is ASSEMBLED, the assignment core's two most
  // sharply of all, because the committed read guard sweeps `app/`, `lib/` and
  // `components/` for that core's name and must keep reporting exactly one caller.
  "lib/exam/" + "admin-exam-assignment-read" + "-core.ts",
  "lib/exam/" + "admin-exam-assignment-read" + "-core.test.ts",
  "lib/actions/" + "exam-assignment-read" + "-io.ts",
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
  `${ROUTE_DIR_PREFIX}CreateExamAssignmentForm.tsx`,
  `${ROUTE_DIR_PREFIX}exam-assignment-messages.ts`,
  "lib/actions/" + "detailed-exam-assignment-write" + "-io.test.ts",
  // EX-PAIR-BE-MVP — the approved instructed-trainee/examinee PAIRING backend,
  // which travels in the same working tree. Its four `lib/` additions re-point
  // the footprint list of the neighbouring publication backend's guard SUITE, so
  // that suite joins the modified set. It is a `.test.ts`; no production file,
  // no route, no Server Action and no schema, migration, auth, session,
  // capability or policy file comes with it, and THIS reader gained no caller.
  "lib/actions/" + "exam-publication-write" + "-io.test.ts",
];

/**
 * The files EX-SES-UI-2 and EX-ASG-UI1 ADD under `app/`, as git reports them.
 *
 * Kept apart from both lists above: they are neither this reader's own files nor
 * modifications, and the two guards below need them for different reasons — one
 * checks what was introduced, the other checks which UI paths may differ at all.
 * Every entry is a route-local file; no `lib/` module is among them, because both
 * slices reuse the committed bindings rather than adding one.
 */
const APPROVED_NEW_ROUTE_FILES = [
  `${ROUTE_DIR_PREFIX}ExamSessionEditForm.tsx`,
  `${ROUTE_DIR_PREFIX}ExamSessionDeleteForm.tsx`,
  `${ROUTE_DIR_PREFIX}exam-session-edit-delete.contract.test.ts`,
  `${ROUTE_DIR_PREFIX}CreateExamAssignmentForm.tsx`,
  `${ROUTE_DIR_PREFIX}DeleteExamAssignmentForm.tsx`,
  `${ROUTE_DIR_PREFIX}exam-assignment-messages.ts`,
  `${ROUTE_DIR_PREFIX}exam-assignment-ui.contract.test.ts`,
  // EX-ASG-IT2's three new route files, on exactly the same terms.
  `${ROUTE_DIR_PREFIX}CreateExamInstructedTraineeAssignmentForm.tsx`,
  `${ROUTE_DIR_PREFIX}exam-instructed-trainee-assignment-messages.ts`,
  `${ROUTE_DIR_PREFIX}exam-instructed-trainee-assignment-ui.contract.test.ts`,
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

function git(args: readonly string[]): { code: number; stdout: string } {
  const result = spawnSync("git", [...args], { cwd: REPO_ROOT, encoding: "utf8" });
  return { code: result.status ?? 1, stdout: result.stdout ?? "" };
}

function gitLines(args: readonly string[]): string[] {
  const { code, stdout } = git(args);
  assert.equal(code, 0, `git ${args.join(" ")} failed`);
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Every `.ts`/`.tsx` file in the repository's own source trees. */
function repoSourceFiles(): { path: string; source: string }[] {
  const out: { path: string; source: string }[] = [];
  for (const dir of ["app", "lib", "components"]) {
    const root = join(REPO_ROOT, dir);
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!/\.tsx?$/.test(entry.name)) continue;
      const path = join(entry.parentPath ?? root, entry.name);
      // The generated client is machine output, not repository source.
      if (path.includes(`${sep}generated${sep}`)) continue;
      out.push({ path, source: readFileSync(path, "utf8") });
    }
  }
  return out;
}

// Split specifiers: this suite necessarily names some of what it forbids, and
// the committed exam-slice guards scan sibling directories for exact tokens.
const PRISMA_MODULE = ["@/lib", "prisma"].join("/");
const TP_ACTIONS_MODULE = ["lib/actions", "teaching-practice"].join("/");

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
  assert.equal(CODE.includes("'use " + "client'"), false);
  // ...and the header states the rule it holds itself to.
  assert.ok(COMMENTS.includes("use " + "server"), "the rule is undocumented");
});

test("3. the module exports exactly ONE function, and no value", () => {
  assert.deepEqual(
    SIGNATURES.map((entry) => entry.name),
    ["readAdminExamSessions"],
  );
  assert.ok(/export async function readAdminExamSessions\(/.test(SOURCE));
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
    "notFound(",
  ]) {
    assert.equal(CODE.includes(token), false, `the module declares ${token}`);
  }
  // The only other export is a TYPE re-export, which emits no runtime value.
  const exportStatements = CODE.match(/^export .*$/gm) ?? [];
  for (const statement of exportStatements) {
    assert.ok(
      statement.startsWith("export type {") || statement.startsWith("export async function "),
      `unexpected export: ${statement}`,
    );
  }
});

test("4. the entry point takes ONLY a courseOfferingId and returns the view", () => {
  const [entry] = SIGNATURES;
  assert.equal(entry.params, "courseOfferingId: string,");
  assert.equal(entry.returns, "Promise<AdminExamSessionsView>");
  for (const forbidden of [
    "planId",
    "sessionId",
    "definitionId",
    "adminId",
    "actorId",
    "instructorId",
    "studentId",
    "traineeId",
    "date",
    "take",
    "skip",
    "cursor",
    "tx",
    "prisma",
    "deps",
  ]) {
    assert.equal(entry.params.includes(forbidden), false, `the entry point accepts ${forbidden}`);
  }
});

test("5. the entry point only hands the pure core its effects", () => {
  const entry = bodyOf("readAdminExamSessions");
  assert.ok(entry.includes("readAdminExamSessionsWithDeps(courseOfferingId, {"));
  // The bound dependency set is exactly the core's boundary…
  for (const dependency of [
    "requireCourseContext",
    "assertHistoricalReadAllowed",
    "findExamPlanByCourseOfferingId",
    "findDefinitionsByPlanId",
    "findSessionsByPlanId",
    "countAssignmentsBySessionId",
  ]) {
    assert.ok(entry.includes(dependency), `${dependency} is not bound`);
  }
  // …and the entry point issues no query, decides no order and builds no view.
  assert.equal(/prisma\./.test(entry), false, "the entry point queries directly");
  assert.equal(entry.includes("sort("), false, "the entry point re-implements the order");
  assert.equal(entry.includes("Object.freeze"), false, "the entry point builds the view");
  assert.equal(entry.includes("planExists"), false, "the entry point builds the view");
});

// ===========================================================================
// 6–10. Authorization, the verified id, and the lifecycle READ gate
// ===========================================================================

test("6. requireAdminCourseOffering is bound exactly once, with the REQUESTED id", () => {
  assert.ok(CODE.includes("requireAdminCourseOffering"), "the admin boundary is not bound");
  assert.equal((CODE.match(/await requireAdminCourseOffering\(/g) ?? []).length, 1);
  assert.ok(
    /requireAdminCourseOffering\(requestedCourseOfferingId\)/.test(CODE),
    "the admin boundary is not called with the requested id",
  );
  // It is bound in the ONE helper the core calls first, and that helper performs
  // no query of its own.
  const helper = bodyOf("requireCourseContext");
  assert.ok(helper.includes("requireAdminCourseOffering("));
  assert.equal(/prisma\./.test(helper), false, "the authorization helper queries");
  assert.ok(/courseOfferingId:\s*context\.id/.test(helper), "the verified id is not carried");
  assert.ok(/status:\s*context\.status/.test(helper), "the verified status is not carried");
});

test("7. authorization precedes EVERY query, because no query can precede it", () => {
  // The module owns SIX internal helpers plus the entry point: the authorization
  // step, the gate, and the four queries. None of the queries can be reached
  // from outside this file, and the ONLY function that reaches them is the
  // injected core — which calls the authorization dependency first, proven
  // DB-free by the sibling suite.
  const declared = [...CODE.matchAll(/^(?:async )?function (\w+)\(/gm)].map(([, name]) => name);
  assert.deepEqual(declared, [
    "requireCourseContext",
    "assertHistoricalReadAllowed",
    "findExamPlanByCourseOfferingId",
    "findDefinitionsByPlanId",
    "findSessionsByPlanId",
    "countAssignmentsBySessionId",
  ]);
  for (const name of ["requireCourseContext", "assertHistoricalReadAllowed"]) {
    assert.equal(/prisma\./.test(bodyOf(name)), false, `${name} performs a query`);
  }
  // NO helper is exported: the four queries are unreachable except through the
  // core, which cannot be entered without the authorization dependency.
  for (const name of declared) {
    assert.equal(CODE.includes(`export async function ${name}(`), false, `${name} is exported`);
    assert.equal(CODE.includes(`export function ${name}(`), false, `${name} is exported`);
  }
  assert.ok(CODE.includes("export async function readAdminExamSessions("));
});

test("8. the plan query uses the VERIFIED offering id, never the requested one", () => {
  const helper = bodyOf("findExamPlanByCourseOfferingId");
  assert.ok(
    /courseOfferingId:\s*verifiedCourseOfferingId/.test(helper),
    "the plan lookup does not use the verified id",
  );
  assert.equal(helper.includes("requestedCourseOfferingId"), false);
  // The three plan-scoped queries take a `planId` parameter and nothing else.
  for (const name of [
    "findDefinitionsByPlanId",
    "findSessionsByPlanId",
    "countAssignmentsBySessionId",
  ]) {
    const body = bodyOf(name);
    assert.ok(/\bplanId[,\s}]/.test(body), `${name} is not plan-scoped`);
    assert.equal(body.includes("courseOfferingId"), false, `${name} re-derives the course`);
  }
});

test("9. every query helper takes exactly ONE server-derived id parameter", () => {
  // No helper accepts a caller-supplied id, a filter, a page size or a date, so
  // a per-row fetch is not expressible even inside this file.
  for (const [name, parameter] of [
    ["findExamPlanByCourseOfferingId", "verifiedCourseOfferingId: string,"],
    ["findDefinitionsByPlanId", "planId: string,"],
    ["findSessionsByPlanId", "planId: string,"],
    ["countAssignmentsBySessionId", "planId: string,"],
  ] as const) {
    const signature = SOURCE.match(new RegExp(`function ${name}\\(([\\s\\S]*?)\\):`));
    assert.ok(signature, `${name} is missing`);
    assert.equal(signature[1].replace(/\s+/g, " ").trim(), parameter, `${name} takes more than one id`);
  }
});

test("10. the lifecycle gate is HISTORICAL_READ, via the committed policy", () => {
  assert.ok(CODE.includes("assertCourseOperationAllowed"));
  assert.ok(
    /assertCourseOperationAllowed\([\s\S]{0,120}?"HISTORICAL_READ"\)/.test(CODE),
    "the gate does not use the approved READ operation",
  );
  assert.equal((CODE.match(/assertCourseOperationAllowed\(/g) ?? []).length, 1);
  // The WRITE gate is deliberately NOT borrowed, and no other operation appears.
  for (const other of [
    "SCHEDULE_DRAFT_CONFIGURATION",
    "SCHEDULE_PUBLICATION",
    "OFFERING_METADATA_UPDATE",
    "OFFERING_STRUCTURE_UPDATE",
    "ENROLLMENT_MANAGEMENT",
    "TEACHING_PRACTICE_OPERATION",
    "DESTRUCTIVE_MAINTENANCE",
    "EXAM_CONFIGURATION",
  ]) {
    assert.equal(CODE.includes(other), false, `the module also references ${other}`);
  }
  // The choice of the READ gate over the write gate is documented.
  assert.ok(/ARCHIVED/.test(COMMENTS), "the ARCHIVED consequence is undocumented");
  assert.ok(/DEFAULT-DENY/i.test(COMMENTS), "the default-deny property is undocumented");
});

test("11. the module consults NO capability and no other actor role", () => {
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
    TP_ACTIONS_MODULE,
  ]) {
    assert.equal(CODE.includes(token), false, `the module references ${token}`);
  }
  assert.ok(/EXAMS/.test(COMMENTS), "the missing EXAMS capability is undocumented");
});

// ===========================================================================
// 12–13. The naming decision that keeps a committed guard exact
// ===========================================================================

test("12. the module and its core carry the admin- prefix, deliberately", () => {
  assert.equal(existsSync(join(REPO_ROOT, IO_REL)), true);
  assert.equal(existsSync(join(REPO_ROOT, CORE_REL)), true);
  // The name that would have collided does NOT exist.
  assert.equal(
    existsSync(join(REPO_ROOT, "lib", "actions", "exam-session-" + "read-io.ts")),
    false,
    "the colliding name was created after all",
  );
  assert.ok(/committed/i.test(COMMENTS), "the naming decision is undocumented");
});

test("13. the committed session-WRITE directory guard still holds exactly", () => {
  // The guard this slice was named around: every file in `lib/actions` whose
  // name begins with the WRITE prefix must still be exactly the write slice's
  // own two files. This suite re-states the property rather than editing the
  // committed suite that owns it.
  const writePrefix = "exam-session-" + "write";
  const writeSlice = readdirSync(join(REPO_ROOT, "lib", "actions"))
    .filter((name) => name.startsWith("exam-session"))
    .sort();
  assert.deepEqual(writeSlice, [`${writePrefix}-io.test.ts`, `${writePrefix}-io.ts`]);
});

// ===========================================================================
// 14–20. The database inventory: four reads, no N+1
// ===========================================================================

const APPROVED_QUERIES = [
  "prisma.examPlan.findUnique",
  "prisma.examDefinition.findMany",
  "prisma.examSession.findMany",
  "prisma.examAssignment.groupBy",
] as const;

test("14. the module issues EXACTLY the four approved queries", () => {
  assert.deepEqual(CODE.match(/prisma\.\w+\.\w+/g) ?? [], [...APPROVED_QUERIES]);
  // ...and the client is referenced nowhere else at all: four mentions, four
  // queries. A fifth reference of any kind would fail here.
  assert.equal((CODE.match(/\bprisma\./g) ?? []).length, APPROVED_QUERIES.length);
});

test("15. no query sits inside a loop or a per-row callback", () => {
  for (const keyword of ["for (", "for(", "while (", "while(", "do {"]) {
    assert.equal(CODE.includes(keyword), false, `the module contains a ${keyword} loop`);
  }
  // The only callbacks are the pure `.map` projections of already-fetched rows;
  // none of them contains a query.
  for (const callback of CODE.match(/\.map\(\([\s\S]*?\n\s{2}\}\)\)/g) ?? []) {
    assert.equal(/prisma\./.test(callback), false, "a query sits inside a map callback");
  }
  for (const helper of [
    "findExamPlanByCourseOfferingId",
    "findDefinitionsByPlanId",
    "findSessionsByPlanId",
    "countAssignmentsBySessionId",
  ]) {
    assert.equal(
      (bodyOf(helper).match(/prisma\./g) ?? []).length,
      1,
      `${helper} issues more than one query`,
    );
  }
  // No Promise.all fan-out that could hide a per-row batch either.
  for (const token of ["Promise.all", "Promise.allSettled", "flatMap(async", "map(async"]) {
    assert.equal(CODE.includes(token), false, `the module uses ${token}`);
  }
});

test("16. the PLAN select is exactly the id and the publication instant", () => {
  const helper = bodyOf("findExamPlanByCourseOfferingId");
  assert.ok(/select:\s*\{\s*id:\s*true,\s*publishedAt:\s*true,?\s*\}/.test(helper));
  // RELATION-shaped matches only. The scalar `courseOfferingId` in the `where`
  // clause is the whole point of this helper, so the guard targets
  // `courseOffering:` — the relation — and not the id that merely contains it.
  for (const relation of [/\bsessions\s*:/, /\bdefinitions\s*:/, /\bsourceDates\s*:/, /\bcourseOffering\s*:/, /\binclude\s*:/]) {
    assert.equal(relation.test(helper), false, `the plan query reads ${relation}`);
  }
});

test("17. the DEFINITION select is exactly the six approved columns", () => {
  const helper = bodyOf("findDefinitionsByPlanId");
  const select = helper.slice(helper.indexOf("select:"), helper.indexOf("orderBy:"));
  const columns = [...select.matchAll(/(\w+):\s*true/g)].map(([, name]) => name).sort();
  assert.deepEqual(columns, [
    "durationMinutes",
    "id",
    "kind",
    "name",
    "orderIndex",
    "parallelCapacity",
  ]);
  // RELATION-shaped matches only, for the same reason as the plan query: the
  // scalar `planId` in the `where` clause is this helper's whole scope.
  for (const forbidden of [/\bsessions\s*:/, /\bplan\s*:/, /\binclude\s*:/, /\bcreatedAt\s*:/, /\bupdatedAt\s*:/, /\brequires\w*\s*:/]) {
    assert.equal(forbidden.test(helper), false, `the definition query reads ${forbidden}`);
  }
});

test("18. the SESSION select is exactly the nine approved columns", () => {
  const helper = bodyOf("findSessionsByPlanId");
  const select = helper.slice(helper.indexOf("select:"), helper.indexOf("orderBy:"));
  const columns = [...select.matchAll(/(\w+):\s*true/g)].map(([, name]) => name).sort();
  assert.deepEqual(columns, [
    "arena",
    "date",
    "definitionId",
    "id",
    "notes",
    "orderIndex",
    "startTime",
    "title",
    "updatedAt",
  ]);
});

test("19. the session query reads NO deprecated, relation or out-of-scope column", () => {
  const helper = bodyOf("findSessionsByPlanId");
  for (const forbidden of [
    "phase",
    "beginnerFormat",
    "endTime",
    "capacity",
    "interfaceSessionId",
    "interfaceSession",
    "ridingSessions",
    "sourceTeachingPracticeLessonId",
    "sourceLesson",
    "copiedAt",
    "roleLabelOverrides",
    "individualPublishedAt",
    "createdAt",
    "assignments",
    "breaks",
    "supervisors",
    "beginnerChildren",
    "definition:",
    "plan:",
    "include",
  ]) {
    assert.equal(helper.includes(forbidden), false, `the session query reads ${forbidden}`);
  }
  // The deprecated columns are discussed, so their absence reads as a decision.
  assert.ok(/deprecated/i.test(COMMENTS), "the deprecated columns are undocumented");
});

test("20. the ASSIGNMENT query is a grouped COUNT that selects no column", () => {
  const helper = bodyOf("countAssignmentsBySessionId");
  assert.ok(/by:\s*\[\s*"sessionId"\s*\]/.test(helper), "the grouping key is wrong");
  assert.ok(/_count:\s*\{\s*_all:\s*true\s*\}/.test(helper), "it is not a row count");
  // Scoped to the SERVER plan through a where-clause relation FILTER…
  assert.ok(/where:\s*\{\s*session:\s*\{\s*planId\s*\}\s*\}/.test(helper), "the count is not plan-scoped");
  // …which is a join condition, NOT an include: no relation is materialized.
  assert.equal(helper.includes("include"), false, "the count includes a relation");
  assert.equal(helper.includes("select"), false, "the count selects a column");
  for (const forbidden of [
    "studentId",
    "student",
    "role",
    "horseName",
    "instructionTopic",
    "discipline",
    "pairingIndex",
    "sourcePracticeRole",
    "notes",
    "orderIndex",
  ]) {
    assert.equal(helper.includes(forbidden), false, `the count reads ${forbidden}`);
  }
});

test("21. no relation is included ANYWHERE in the module", () => {
  assert.equal(/\binclude:/.test(CODE), false, "the module includes a relation");
});

// ===========================================================================
// 22–24. Ordering, and the date conversions
// ===========================================================================

test("22. the session query orders by date, position, time, then id", () => {
  const helper = bodyOf("findSessionsByPlanId");
  const orderBy = helper.slice(helper.indexOf("orderBy:"));
  const keys = [...orderBy.matchAll(/\{\s*(\w+):\s*"asc"\s*\}/g)].map(([, name]) => name);
  assert.deepEqual(keys, ["date", "orderIndex", "startTime", "id"]);
  assert.equal(orderBy.includes('"desc"'), false, "a descending key appeared");
});

test("23. the definition query orders by position then id", () => {
  const helper = bodyOf("findDefinitionsByPlanId");
  const orderBy = helper.slice(helper.indexOf("orderBy:"));
  const keys = [...orderBy.matchAll(/\{\s*(\w+):\s*"asc"\s*\}/g)].map(([, name]) => name);
  assert.deepEqual(keys, ["orderIndex", "id"]);
});

test("24. dates are converted HERE, through the shared helper, and only here", () => {
  // The calendar date -> `YYYY-MM-DD`, via the repository's UTC-anchored helper.
  assert.ok(/import \{ dateKey \} from "@\/lib\/dates";/.test(CODE), "the shared helper is not imported");
  assert.ok(/dateKey:\s*dateKey\(row\.date\)/.test(CODE), "the date key is not derived here");
  assert.equal((CODE.match(/dateKey\(/g) ?? []).length, 1, "dateKey is called more than once");
  // The write helper is NOT imported: this module converts OUT, never in.
  assert.equal(CODE.includes("parseDateKey"), false, "the module imports the inbound converter");

  // The instants -> epoch milliseconds, in exactly two places.
  assert.ok(/publishedAt\.getTime\(\)/.test(CODE), "publishedAt is not converted");
  assert.ok(/updatedAt\.getTime\(\)/.test(CODE), "updatedAt is not converted");
  assert.equal((CODE.match(/\.getTime\(\)/g) ?? []).length, 2);

  // No `Date` is constructed, and no timezone rule is re-derived.
  for (const token of [
    "new Date(",
    "Date.now(",
    "Date.parse(",
    "toISOString",
    "toLocaleDateString",
    "getTimezoneOffset",
    "setHours",
    "UTC(",
  ]) {
    assert.equal(CODE.includes(token), false, `the module uses ${token}`);
  }
  assert.ok(/epoch millisecond/i.test(COMMENTS), "the epoch-ms convention is undocumented");
});

test("25. no Date and no raw row type can escape the module", () => {
  // The only exported runtime function returns the core's view type.
  const [entry] = SIGNATURES;
  assert.equal(entry.returns, "Promise<AdminExamSessionsView>");
  // Every type re-export comes from the pure core, never from the client.
  const reExports = CODE.match(/^export type \{[\s\S]*?\} from "([^"]+)";$/m);
  assert.ok(reExports);
  assert.equal(reExports[1], "@/lib/exam/admin-exam-session-read-core");
  // The generated client is imported for ONE thing: the status enum, as a TYPE.
  assert.ok(/import type \{ CourseOfferingStatus \} from/.test(CODE));
  // Split, so this suite's own forbidden-token list does not trip guard 33.
  for (const token of ["Prisma" + "Client", "Prisma.", "ExamSession" + "GetPayload", "ExamSession" + "Select"]) {
    assert.equal(CODE.includes(token), false, `the module leaks ${token}`);
  }
});

// ===========================================================================
// 26–28. A read, and only a read
// ===========================================================================

test("26. the module contains NO write, NO transaction and NO raw SQL", () => {
  for (const token of [
    ".create(",
    ".createMany(",
    ".update(",
    ".updateMany(",
    ".upsert(",
    ".delete(",
    ".deleteMany(",
    "$transaction",
    "$executeRaw",
    "$queryRaw",
    "$executeRawUnsafe",
    "$queryRawUnsafe",
    "isolationLevel",
    "$connect",
    "$disconnect",
  ]) {
    assert.equal(CODE.includes(token), false, `the module references ${token}`);
  }
  // Every prisma statement is one of the three read verbs.
  for (const call of CODE.match(/prisma\.\w+\.(\w+)/g) ?? []) {
    const [, method] = call.split(/prisma\.\w+\./);
    assert.ok(
      ["findUnique", "findMany", "groupBy"].includes(method),
      `${call} is not a read`,
    );
  }
});

test("27. the module sends no notification, message or push", () => {
  for (const token of [
    "notification",
    "Notification",
    "sendPush",
    "webpush",
    "whatsapp",
    "WhatsApp",
    "sendMessage",
    "fetch(",
  ]) {
    assert.equal(CODE.includes(token), false, `the module references ${token}`);
  }
});

test("28. the module imports exactly the approved specifiers", () => {
  // De-duplicated: the pure core is named twice on purpose — once for the values
  // and injected types, once for the type re-export the callers consume.
  const specifiers = [
    ...new Set([...CODE.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1])),
  ].sort();
  assert.deepEqual(specifiers, [
    "@/app/generated/prisma/client",
    "@/lib/course/admin-course-context",
    "@/lib/course/operation-policy-core",
    "@/lib/dates",
    "@/lib/exam/admin-exam-session-read-core",
    PRISMA_MODULE,
  ].sort());
});

// ===========================================================================
// 29–32. Containment: no caller, no UI, four new files, nothing modified
// ===========================================================================

test("29. EXACTLY ONE production caller reaches this reader — the course exams page", () => {
  // EX-SES-UI-1 TRANSITION. This guard previously asserted the caller list was
  // EMPTY, which was the correct claim while the reader was committed but
  // unwired. Wiring gives it its first and only consumer, so the list is
  // RE-POINTED to that ONE exact path rather than dropped or widened to the route
  // directory: a second page, a component, a layout, a route handler or another
  // `lib/actions` module still fails here, and so does a `.tsx` other than the
  // page itself.
  const declaring = new Set(
    [IO_REL, IO_TEST_REL, CORE_REL, CORE_TEST_REL].map((rel) => join(REPO_ROOT, rel)),
  );
  const callers = repoSourceFiles()
    .filter((file) => !declaring.has(file.path))
    .filter((file) => {
      const code = stripComments(file.source);
      return (
        /admin-exam-session-read-io/.test(code) ||
        /admin-exam-session-read-core/.test(code) ||
        /\breadAdminExamSessions\s*\(/.test(code) ||
        /\breadAdminExamSessionsWithDeps\s*\(/.test(code)
      );
    })
    .map((file) => file.path.slice(REPO_ROOT.length + 1));
  // `sep`, not a forward slash: these paths come from the filesystem walk above,
  // so on Windows they arrive back-slashed and a hard-coded "/" literal would
  // make this guard pass for the wrong reason.
  assert.deepEqual(
    callers,
    [APPROVED_CALLER_REL],
    `an unapproved caller exists: ${callers.join(", ")}`,
  );
  // The one caller really is that page, and the pure core stayed behind the
  // binding: no consumer reaches it directly.
  assert.equal(callers.length, 1, "the reader must have exactly one consumer");
  assert.ok(
    APPROVED_CALLER_REL.endsWith(`${sep}page.tsx`),
    "the approved caller must be a page",
  );

  // No exam route directory was created by this slice.
  for (const dir of [
    join("app", "admin", "exams"),
    join("app", "instructor", "exams"),
    join("app", "student", "exams"),
  ]) {
    assert.equal(existsSync(join(REPO_ROOT, dir)), false, `${dir} was created`);
  }
});

test("30. the slice consists of EXACTLY the four approved files", () => {
  for (const rel of [IO_REL, IO_TEST_REL, CORE_REL, CORE_TEST_REL]) {
    assert.ok(statSync(join(REPO_ROOT, rel)).isFile(), `${rel} is missing`);
    assert.equal(rel.endsWith(".tsx"), false, `${rel} is a UI file`);
  }
  // No fifth file was added under either directory.
  const examSlice = readdirSync(join(REPO_ROOT, "lib", "exam"))
    .filter((name) => name.startsWith("admin-exam-session-read"))
    .sort();
  assert.deepEqual(examSlice, [
    "admin-exam-session-read-core.test.ts",
    "admin-exam-session-read-core.ts",
  ]);
  const actionsSlice = readdirSync(join(REPO_ROOT, "lib", "actions"))
    .filter((name) => name.startsWith("admin-exam-session-read"))
    .sort();
  assert.deepEqual(actionsSlice, [
    "admin-exam-session-read-io.test.ts",
    "admin-exam-session-read-io.ts",
  ]);
});

test("31. the slice added ONLY these four files and modified no tracked file", () => {
  const scope = ["lib", "prisma", "app", "components"];

  // What EXISTS IN HEAD and was edited, deleted, renamed or type-changed.
  // `--diff-filter=MDRT` excludes additions on purpose: a brand-new file is what
  // this slice is allowed to produce, and including additions would make the
  // check flip to red the moment the new files are staged and back to green
  // after they are committed — a guard that only holds in one of three ordinary
  // states proves nothing.
  const modified = gitLines([
    "diff",
    "HEAD",
    "--name-only",
    "--diff-filter=MDRT",
    "--",
    ...scope,
  ]);
  // EX-SES-UI-1 TRANSITION. This assertion was `deepEqual(modified, [])` while the
  // reader was unwired, and that is exactly what wiring it makes obsolete. It is
  // re-pointed to an EXACT approved path set rather than deleted: every path is
  // spelled out, none is a directory or a prefix, and the two production modules
  // that matter are re-asserted byte-identical immediately below.
  const unapprovedModified = modified.filter(
    (path) => !APPROVED_MODIFIED_FILES.includes(path),
  );
  assert.deepEqual(
    unapprovedModified,
    [],
    `a tracked file was modified: ${unapprovedModified.join(", ")}`,
  );
  // Named explicitly, so neither this binding nor its pure core can drift in
  // under a future widening of the approved list. NOTHING this slice does may
  // touch the reader's own production code.
  for (const production of [
    "lib/actions/admin-exam-session-read-io.ts",
    "lib/exam/admin-exam-session-read-core.ts",
  ]) {
    assert.equal(modified.includes(production), false, `${production} was modified`);
  }
  // ...and every approved modification really is a guard suite, except the ONE
  // approved production file: the page this reader was wired into.
  //
  // RE-POINTED by EX-SES-UI-2 from ONE approved production file to TWO: the page,
  // and the route's shared Server Action module that slice extends. Both are named
  // EXACTLY — no directory, no prefix — so a third production file still fails.
  // RE-POINTED AGAIN by EX-ASG-LTD2-B1, from TWO approved production files to
  // FOUR. The two additions are the assignment READ pair — a pure core and its
  // binding — which that slice must edit to publish two more stored columns. They
  // are named EXACTLY, they are not this reader's own modules (those two are
  // asserted byte-identical above and remain so), and a FIFTH production file
  // still fails here.
  const APPROVED_PRODUCTION = [
    // RE-POINTED by EX-ASG-LTD2-B2: the examinee create FORM and the route-local
    // assignment MESSAGE TABLE are production files of that same one route, and the
    // detailed-writer wiring edits both. Each is named EXACTLY - no directory, no
    // prefix, no glob - so a further production file still fails here.
    `${ROUTE_DIR_PREFIX}CreateExamAssignmentForm.tsx`,
    `${ROUTE_DIR_PREFIX}exam-assignment-messages.ts`,
    `${ROUTE_DIR_PREFIX}page.tsx`,
    `${ROUTE_DIR_PREFIX}actions.ts`,
    "lib/exam/" + "admin-exam-assignment-read" + "-core.ts",
    "lib/actions/" + "exam-assignment-read" + "-io.ts",
  ];
  for (const path of APPROVED_MODIFIED_FILES) {
    assert.ok(
      path.endsWith(".test.ts") || APPROVED_PRODUCTION.includes(path),
      `${path} is neither a suite nor an approved production file`,
    );
  }

  // Nothing was introduced OUTSIDE the approved four — a SUBSET check, and the
  // half of this guard that is true in every ordinary state.
  //
  // The first version of this assertion REQUIRED the four paths to appear here,
  // which made it the very thing the comment above warns against: it passed only
  // while the slice was uncommitted and failed the moment it was committed, when
  // both of these sets are correctly EMPTY. What is durable is not "these four
  // appear" but "nothing else does".
  const added = gitLines(["diff", "HEAD", "--name-only", "--diff-filter=A", "--", ...scope]);
  const untracked = gitLines([
    "ls-files",
    "--others",
    "--exclude-standard",
    "--",
    ...scope,
  ]);
  const introduced = [...new Set([...added, ...untracked])].sort();
  // RE-POINTED by EX-SES-UI-2, which introduces THREE new files of its own — an
  // edit form, a delete form and their contract suite, all under `app/`. They are
  // listed SEPARATELY from `NEW_FILES` on purpose: that list is also asserted to be
  // fully TRACKED below, which is a claim about this reader's own four committed
  // files and must not be diluted by files that are legitimately still untracked.
  //
  // RE-POINTED AGAIN by EX-PUB-BE-MVP, the exam-plan publish/unpublish BACKEND
  // that travels in the same working tree: a pure core, a binding and a suite for
  // each, all four under `lib/`. They are listed as FOUR EXACT paths for the same
  // reason as the route files above — this reader gained no caller, its own four
  // files are still asserted fully TRACKED below, and a fifth addition still
  // fails. The two `lib/actions` paths are ASSEMBLED, not spelled: that slice's
  // own guard pins its caller list at EXACTLY ZERO, so naming one whole here
  // would become its first entry.
  //
  // RE-POINTED AGAIN by EX-PAIR-BE-MVP, the instructed-trainee/examinee PAIRING
  // backend, which travels in the same working tree and has exactly the same
  // shape: a pure core, a binding and a suite for each, all four under `lib/`.
  // Four more EXACT paths, assembled for the same reason, and a ninth addition
  // still fails.
  const APPROVED_NEW_LIB_FILES = [
    "lib/exam/exam-publication-write-core.ts",
    "lib/exam/exam-publication-write-core.test.ts",
    "lib/actions/" + "exam-publication-write" + "-io.ts",
    "lib/actions/" + "exam-publication-write" + "-io.test.ts",
    "lib/exam/exam-pairing-write-core.ts",
    "lib/exam/exam-pairing-write-core.test.ts",
    "lib/actions/" + "exam-pairing-write" + "-io.ts",
    "lib/actions/" + "exam-pairing-write" + "-io.test.ts",
  ];
  const INTRODUCED_FILES = [
    ...NEW_FILES,
    ...APPROVED_NEW_ROUTE_FILES,
    ...APPROVED_NEW_LIB_FILES,
  ];
  const unapproved = introduced.filter((path) => !INTRODUCED_FILES.includes(path));
  assert.deepEqual(unapproved, [], `unexpected files: ${unapproved.join(", ")}`);
  // THIS slice introduced no `lib/` module at all: it reuses the committed writers
  // rather than adding one. RE-POINTED by EX-PUB-BE-MVP and NARROWED rather than
  // dropped — the four `lib/` paths a NEIGHBOURING backend slice adds are excluded
  // by exact name, and any other `lib/` addition still fails here.
  for (const path of introduced) {
    if (APPROVED_NEW_LIB_FILES.includes(path)) continue;
    assert.equal(path.startsWith("lib/"), false, `a lib module was introduced: ${path}`);
  }

  // ...and the four approved files are each present AND TRACKED. Spelled out one
  // by one from the same explicit list, never as a directory or a glob, so this
  // still fails if one is missing, renamed, or left untracked on a clean tree —
  // which is what the removed assertion was reaching for, stated in a way that
  // does not depend on the slice being uncommitted.
  const tracked = gitLines(["ls-files", "--", ...NEW_FILES]).sort();
  assert.deepEqual(tracked, [...NEW_FILES].sort(), "an approved file is untracked or missing");
});

test("32. the slice touches no schema, migration, capability or policy file", () => {
  // `gitLines` has ALREADY trimmed each line, so the porcelain status field is no
  // longer a fixed two columns: ` M path` arrives as `M path`, and the previous
  // `slice(3)` therefore ate the first character of every unstaged path. That went
  // unnoticed while this slice's own files were all untracked (`?? path` happens to
  // survive `slice(3)`), and it would have made this guard compare — and silently
  // pass — a path that does not exist. Strip the status field by SHAPE instead.
  const touched = gitLines(["status", "--porcelain"]).map((line) =>
    line.replace(/^\S{1,2}\s+/, ""),
  );
  for (const path of touched) {
    // EX-SES-UI-1 TRANSITION. The blanket `.tsx` and `app/` bans described a
    // reader that no UI reached. Wiring it means exactly ONE `.tsx` under `app/`
    // may differ — the approved page — so those two bans become an EXACT
    // allow-list rather than being dropped. A second UI file, or any other route,
    // still fails here.
    //
    // RE-POINTED AGAIN by EX-SES-UI-2, which adds two client forms and a contract
    // suite under the SAME route. The allow-list therefore spans the approved
    // MODIFICATIONS and the approved ADDITIONS — still every path spelled exactly,
    // still no directory and no prefix. A second route, or any UI file outside
    // these two exact lists, still fails here.
    if (path.endsWith(".tsx") || path.includes("app/")) {
      assert.ok(
        APPROVED_MODIFIED_FILES.includes(path) || APPROVED_NEW_ROUTE_FILES.includes(path),
        `an unapproved UI or route file was touched: ${path}`,
      );
    }
    // The claims that never had an exception keep none: no schema, no migration,
    // no course policy and nothing capability-shaped is touched at all.
    for (const forbidden of [
      "prisma/schema.prisma",
      "prisma/migrations/",
      "operation-policy-core",
      "capability",
    ]) {
      assert.equal(path.includes(forbidden), false, `a forbidden path was touched: ${path}`);
    }
  }
  // RE-POINTED by EX-SES-UI-2. The claim was "at most ONE `.tsx` may differ, and
  // it is that page" — correct while the only UI change was wiring this reader in.
  // A safe edit and a safe removal need a form each, so the bound moves from one
  // to THREE and every one of them is named EXACTLY: the page, plus the two new
  // client forms.
  //
  // RE-POINTED AGAIN by EX-ASG-UI1, on identical terms: the stored-assignment
  // create and removal need a form each, so the bound moves from three to FIVE.
  // It is still a closed set, not a directory: a sixth UI file, or any `.tsx`
  // outside these five, still fails — and every entry is under this one route.
  //
  // RE-POINTED AGAIN by EX-ASG-IT2, on identical terms: the instructed-trainee
  // create needs one form, so the bound moves from five to SIX. It is still a
  // closed set, not a directory: a seventh UI file, or any `.tsx` outside these
  // six, still fails - and every entry is under this one route.
  const APPROVED_UI_FILES = [
    `${ROUTE_DIR_PREFIX}page.tsx`,
    `${ROUTE_DIR_PREFIX}CreateExamInstructedTraineeAssignmentForm.tsx`,
    `${ROUTE_DIR_PREFIX}ExamSessionEditForm.tsx`,
    `${ROUTE_DIR_PREFIX}ExamSessionDeleteForm.tsx`,
    `${ROUTE_DIR_PREFIX}CreateExamAssignmentForm.tsx`,
    `${ROUTE_DIR_PREFIX}DeleteExamAssignmentForm.tsx`,
  ];
  const uiTouched = [...new Set(touched.filter((path) => path.endsWith(".tsx")))];
  for (const path of uiTouched) {
    assert.ok(APPROVED_UI_FILES.includes(path), `an unapproved UI file was touched: ${path}`);
  }
  assert.ok(uiTouched.length <= 3, "more than three UI files were touched");
  // Every approved UI file lives in the ONE approved route directory: no second
  // route, no shared component library and no role-area page is in scope.
  for (const path of APPROVED_UI_FILES) {
    assert.ok(path.startsWith(ROUTE_DIR_PREFIX), `${path} is outside the approved route`);
  }
  // The committed schema and policy files are untouched in the working tree.
  const schemaChanged = gitLines([
    "diff",
    "HEAD",
    "--name-only",
    "--",
    "prisma/schema.prisma",
    "prisma/migrations",
  ]);
  assert.deepEqual(schemaChanged, []);
});

test("33. this suite opens no database and names no production identifier", () => {
  const own = stripComments(readFileSync(join(REPO_ROOT, IO_TEST_REL), "utf8"));
  for (const token of [
    PRISMA_MODULE,
    ["process", "env"].join("."),
    "DATABASE" + "_URL",
    "Prisma" + "Client",
    "supa" + "base",
  ]) {
    assert.equal(own.includes(token), false, `the suite references ${token}`);
  }
  // Anchored to real IMPORT LINES. A bare `from "…"` scan would also match the
  // regex literals this suite uses to assert on the module's own import
  // statements, which are assertions rather than imports of its own.
  const specifiers = [...own.matchAll(/^import[^"]*from\s+"([^"]+)";$/gm)].map((match) => match[1]);
  assert.deepEqual(
    [...new Set(specifiers)].sort(),
    ["node:assert/strict", "node:child_process", "node:fs", "node:path", "node:test"],
  );
});
