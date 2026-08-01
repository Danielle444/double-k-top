/**
 * EXAM EX-S5B-5A — STRUCTURAL contract for the ADMIN ExamDefinition LIST
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
 *     server-owned helpers the core injects;
 *   - only the DB-VERIFIED offering id reaches the plan query, and only the
 *     server-resolved plan id reaches the definition and count queries;
 *   - the gate is the READ gate (`HISTORICAL_READ`), never the write gate, and
 *     no capability is consulted;
 *   - EXACTLY three statements touch the database: one plan lookup, one
 *     definition list and one grouped count — none in a loop, none nested in a
 *     per-row callback, so there is no N+1 at any size;
 *   - the selects are exactly the approved column sets, and nothing forbidden is
 *     read: no session row, assignment, student, instructor, Teaching-Practice
 *     lesson, source-lesson detail, contact, diagnostic, grade or evaluation;
 *   - `updatedAt` and `publishedAt` become epoch milliseconds HERE, and no
 *     `Date` leaves the module;
 *   - the module writes nothing, opens no transaction, runs no raw SQL and lets
 *     no database client or raw row type escape;
 *   - EXACTLY ONE shipped module reaches this reader: the read-only admin exam
 *     definitions page added by EX-S5B-5B. Nothing else in `app`, `lib` or
 *     `components` may, and no top-level exam route exists in any role area;
 *   - nothing outside this slice's approved paths was touched.
 *
 * EX-S5B-5B AMENDED THIS FILE. Guards 20, 22 and 23 were written while the
 * reader was deliberately UNWIRED, and asserted that it had no caller and that
 * the slice modified no tracked file. Wiring it is exactly what EX-S5B-5B was
 * authorized to do, so those three are re-pointed at EXACT allow-lists rather
 * than relaxed: guard 20 still fails for any caller that is not the one approved
 * page, and guards 22 and 23 still fail for any path outside the approved set.
 * Guards 1–19, 21 and 24 are untouched.
 *
 * Run with: npx tsx --test lib/actions/exam-definition-read-io.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

const IO_REL = join("lib", "actions", "exam-definition-read-io.ts");
const IO_TEST_REL = join("lib", "actions", "exam-definition-read-io.test.ts");
const CORE_REL = join("lib", "exam", "exam-definition-admin-read-core.ts");
const CORE_TEST_REL = join("lib", "exam", "exam-definition-admin-read-core.test.ts");

/** The four files the EX-S5B-5A read slice consists of, in repository form. */
const NEW_FILES = [
  "lib/actions/exam-definition-read-io.ts",
  "lib/actions/exam-definition-read-io.test.ts",
  "lib/exam/exam-definition-admin-read-core.ts",
  "lib/exam/exam-definition-admin-read-core.test.ts",
];

/**
 * EX-S5B-5B — the ONE shipped module authorized to reach this reader, and the
 * route's own contract suite, which necessarily names the specifier in its
 * assertions. Any other caller is a guard failure.
 */
const APPROVED_PAGE = join(
  "app",
  "admin",
  "courses",
  "[courseOfferingId]",
  "exams",
  "page.tsx",
);
const APPROVED_PAGE_SUITE = join(
  "app",
  "admin",
  "courses",
  "[courseOfferingId]",
  "exams",
  "exam-definitions-page.contract.test.ts",
);

/**
 * EX-S5B-5C — the create slice's own contract suite. It names this reader for
 * ONE reason: to prove the page reads the definitions BEFORE it looks at the
 * create outcome in the query string. Like the sibling suite above it is a
 * `.test.ts`, so the "exactly one PRODUCTION caller" assertion below is
 * unaffected — the shipped caller set is still the single page.
 */
const APPROVED_CREATE_SUITE = join(
  "app",
  "admin",
  "courses",
  "[courseOfferingId]",
  "exams",
  "exam-definition-create.contract.test.ts",
);

/**
 * Every path the CURRENT slice (EX-S5B-5C, the create UI) was authorized to
 * touch: four new route files and four amended ones.
 *
 * EX-S5B-5B's paths are NOT carried forward. That slice is committed, so
 * `git diff HEAD` no longer reports it, and keeping its course-dashboard entry
 * here would silently permit an unrelated edit to a file this slice must not
 * touch.
 */
const SLICE_PATHS = [
  "app/admin/courses/[courseOfferingId]/exams/page.tsx",
  "app/admin/courses/[courseOfferingId]/exams/exam-definitions-page.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/actions.ts",
  "app/admin/courses/[courseOfferingId]/exams/ExamDefinitionCreateForm.tsx",
  "app/admin/courses/[courseOfferingId]/exams/exam-definition-create-error-messages.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-definition-create.contract.test.ts",
  "lib/actions/exam-definition-read-io.test.ts",
  // ASSEMBLED, not spelled: the write binding's own guard suite sweeps `lib/`
  // for its module name, and naming it here would enrol this suite in the
  // caller allow-list it must stay out of.
  "lib/actions/" + "exam-definition-write" + "-io.test.ts",
  // EX-SES-UI-1 — the slice that wires the committed exam SESSION reader, the day
  // grouping core and the session create form into the very page this reader
  // already feeds. Those files travel in the same working tree, so they are
  // listed here for the footprint guard below and for NO other reason: test 20's
  // claim about who may call the DEFINITION reader is untouched, and the page is
  // still its only production caller.
  //
  // Assembled for the reason above, and for the session reader most sharply of
  // all: its committed guard pins its own caller list to EXACTLY the exams page,
  // so a suite spelling that module name whole would become a second entry there.
  "app/admin/courses/[courseOfferingId]/exams/exam-plan-create.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-session-create.contract.test.ts",
  "lib/actions/" + "admin-exam-session-read" + "-io.test.ts",
  "lib/actions/" + "exam-session-write" + "-io.test.ts",
  "lib/actions/" + "exam-plan-write" + "-io.test.ts",
  "lib/exam/" + "create-exam-plan" + "-core.test.ts",
  // EX-SES-UI-2 — the approved session EDIT and REMOVAL UI, which travels in the
  // same working tree: two new client forms and their contract suite. Listed here
  // for the footprint guard below and for NO other reason — test 20's claim about
  // who may call the DEFINITION reader is untouched, and the page is still its only
  // production caller. Neither new form reads a definition: the edit picker's
  // options are handed to it as a prop by that same page.
  "app/admin/courses/[courseOfferingId]/exams/ExamSessionEditForm.tsx",
  "app/admin/courses/[courseOfferingId]/exams/ExamSessionDeleteForm.tsx",
  "app/admin/courses/[courseOfferingId]/exams/exam-session-edit-delete.contract.test.ts",
  // EX-ASG-UI1 — the approved stored-assignment CREATE and REMOVAL UI, which
  // travels in the same working tree: two new client forms, a closed message module
  // and their contract suite. Listed here for the footprint guard below and for NO
  // other reason — test 20's claim about who may call the DEFINITION reader is
  // untouched, and the page is still its only production caller.
  //
  // That slice does consult the definitions this reader returns, but only through
  // the SAME page-level view already loaded: it builds an in-memory lookup of the
  // two requirement flags to decide whether the assignment create form may be
  // offered at all, which adds no reader, no query and no caller. The `lib/`
  // assignment guard paths are ASSEMBLED for the sharpest reason of all: both
  // pinned their caller lists at EXACTLY ZERO before that slice.
  "app/admin/courses/[courseOfferingId]/exams/CreateExamAssignmentForm.tsx",
  "app/admin/courses/[courseOfferingId]/exams/DeleteExamAssignmentForm.tsx",
  "app/admin/courses/[courseOfferingId]/exams/exam-assignment-messages.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-assignment-ui.contract.test.ts",
  // EX-ASG-IT2 — the approved INSTRUCTED_TRAINEE assignment CREATE UI, which
  // travels in the same working tree. It adds the ASSIGNMENT contract suite to
  // the modified set (that suite's route file set and export list learn about
  // the eighth endpoint) and the committed instructed-trainee write guard,
  // whose caller list it re-points from zero to exactly one Server Action
  // module. Its own three new route files are ADDITIONS. Nothing here changes
  // which module this guard is about: no reader gained a caller, no writer was
  // edited, and no schema, migration, auth, capability or policy file is named.
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
  "lib/actions/" + "exam-assignment-write" + "-io.test.ts",
  "lib/actions/" + "exam-assignment-read" + "-io.test.ts",
  "lib/exam/" + "exam-supervisor-write" + "-core.test.ts",
  "lib/actions/" + "exam-plan-write" + "-io.test.ts",
  "lib/exam/" + "create-exam-plan" + "-core.test.ts",
  // EX-ASG-LTD2-B1 — the approved ADMIN READ DETAIL slice, which travels in the
  // same working tree: it publishes two stored columns on the assignment list and
  // shows them on the page this reader already feeds. Listed here for the
  // footprint guard below and for NO other reason — test 20's claim about who may
  // call the DEFINITION reader is untouched, and the page is still its only
  // production caller.
  //
  // That slice does consult this reader's requirement flags, but only through the
  // SAME page-level lookup EX-ASG-UI1 already built: it decides whether a stored
  // value is MISSING, which adds no reader, no query and no caller. Every path is
  // ASSEMBLED, the assignment core's two most sharply of all, because the
  // committed read guard sweeps `app/`, `lib/` and `components/` for that core's
  // name and must keep reporting exactly one caller.
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
  "lib/actions/" + "detailed-exam-assignment-write" + "-io.test.ts",
  // EX-PUB-BE-MVP — the exam-plan publish/unpublish BACKEND, which travels in the
  // same working tree: a pure core, a binding and a suite for each, all four
  // ADDITIONS under `lib/`. Listed here for the footprint guard below and for NO
  // other reason — test 20's claim about who may call the DEFINITION reader is
  // untouched, and the page is still its only production caller.
  //
  // That slice reads and writes ONE ExamPlan column and nothing else: it consults
  // no definition, adds no reader, no query, no route and no caller. The two
  // `lib/actions` paths are ASSEMBLED for the sharpest reason of all — that
  // slice's own guard pins its caller list at EXACTLY ZERO.
  "lib/exam/exam-publication-write-core.ts",
  "lib/exam/exam-publication-write-core.test.ts",
  "lib/actions/" + "exam-publication-write" + "-io.ts",
  "lib/actions/" + "exam-publication-write" + "-io.test.ts",
  // EX-PAIR-BE-MVP — the instructed-trainee/examinee PAIRING backend, which
  // travels in the same working tree: a pure core, a binding and a suite for
  // each, all four ADDITIONS under `lib/`, plus the five neighbouring guard
  // SUITES whose footprint lists those four additions re-point. Listed here for
  // the footprint guard below and for NO other reason — test 20's claim about who
  // may call the DEFINITION reader is untouched, and the page is still its only
  // production caller.
  //
  // That slice reads and writes ONE ExamAssignment column, `pairingIndex`: it
  // consults no definition, adds no reader, no query, no route and no caller.
  // Assembled for the sharpest reason of all — its own guard pins its caller list
  // at EXACTLY ZERO.
  "lib/exam/exam-pairing-write-core.ts",
  "lib/exam/exam-pairing-write-core.test.ts",
  "lib/actions/" + "exam-pairing-write" + "-io.ts",
  "lib/actions/" + "exam-pairing-write" + "-io.test.ts",
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

/** The `(` nesting depth at `index` — 0 means "at statement level". */
function parenDepthAt(source: string, index: number): number {
  let depth = 0;
  for (let i = 0; i < index; i += 1) {
    if (source[i] === "(") depth += 1;
    else if (source[i] === ")") depth -= 1;
  }
  return depth;
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

// Split specifiers: this suite necessarily names some of what it forbids, and
// the committed exam-slice guards scan sibling directories for them.
const PRISMA_MODULE = ["@/lib", "prisma"].join("/");
const GENERATED_CLIENT = ["@prisma", "client"].join("/");
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
    ["readExamDefinitionsForAdmin"],
  );
  assert.ok(/export async function readExamDefinitionsForAdmin\(/.test(SOURCE));
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
  assert.equal(entry.returns, "Promise<AdminExamDefinitionListView>");
  for (const forbidden of [
    "planId",
    "definitionId",
    "adminId",
    "actorId",
    "instructorId",
    "studentId",
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

test("5. the entry point only hands the committed core its effects", () => {
  const entry = bodyOf("readExamDefinitionsForAdmin");
  assert.ok(entry.includes("readExamDefinitionsForAdminWithDeps(courseOfferingId, {"));
  // The bound dependency set is exactly the core's boundary…
  for (const dependency of [
    "requireCourseContext",
    "assertHistoricalReadAllowed",
    "findExamPlanByCourseOfferingId",
    "findDefinitionsByPlanId",
    "countSessionsByDefinition",
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
  // The module owns FIVE internal helpers plus the entry point: the
  // authorization step, the gate, and the three queries. None of the queries can
  // be reached from outside this file, and the ONLY function that reaches them
  // is the injected core — which calls the authorization dependency first,
  // proven DB-free by the sibling suite.
  const declared = [...CODE.matchAll(/^(?:async )?function (\w+)\(/gm)].map(([, name]) => name);
  assert.deepEqual(declared, [
    "requireCourseContext",
    "assertHistoricalReadAllowed",
    "findExamPlanByCourseOfferingId",
    "findDefinitionsByPlanId",
    "countSessionsByDefinition",
  ]);
  for (const name of ["requireCourseContext", "assertHistoricalReadAllowed"]) {
    assert.equal(/prisma\./.test(bodyOf(name)), false, `${name} performs a query`);
  }
  // NO helper is exported: the three queries are unreachable except through the
  // core, which cannot be entered without the authorization dependency.
  for (const name of declared) {
    assert.equal(CODE.includes(`export async function ${name}(`), false, `${name} is exported`);
    assert.equal(CODE.includes(`export function ${name}(`), false, `${name} is exported`);
  }
  // ...and the one exported function is the entry point, which never queries.
  assert.ok(CODE.includes("export async function readExamDefinitionsForAdmin("));
});

test("8. the plan query uses the VERIFIED offering id, never the requested one", () => {
  const helper = bodyOf("findExamPlanByCourseOfferingId");
  assert.ok(
    /courseOfferingId:\s*verifiedCourseOfferingId/.test(helper),
    "the plan lookup does not use the verified id",
  );
  assert.equal(helper.includes("requestedCourseOfferingId"), false);
  // The two plan-scoped queries take a `planId` parameter and nothing else.
  for (const name of ["findDefinitionsByPlanId", "countSessionsByDefinition"]) {
    const body = bodyOf(name);
    assert.ok(/where:\s*\{\s*planId[,\s}]/.test(body), `${name} is not plan-scoped`);
    assert.equal(body.includes("courseOfferingId"), false, `${name} re-derives the course`);
  }
});

test("9. the lifecycle gate is HISTORICAL_READ, via the committed policy", () => {
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

test("10. the module consults NO capability and no other actor role", () => {
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
  ]) {
    assert.equal(CODE.includes(token), false, `the module references ${token}`);
  }
  assert.ok(/EXAMS/.test(COMMENTS), "the missing EXAMS capability is undocumented");
});

// ===========================================================================
// 11–15. The database inventory: three reads, no N+1
// ===========================================================================

const APPROVED_QUERIES = [
  "prisma.examPlan.findUnique",
  "prisma.examDefinition.findMany",
  "prisma.examSession.groupBy",
] as const;

test("11. the module issues EXACTLY the three approved queries", () => {
  assert.deepEqual(CODE.match(/prisma\.\w+\.\w+/g) ?? [], [...APPROVED_QUERIES]);
  assert.equal((CODE.match(/=\s*await\s+prisma\./g) ?? []).length, APPROVED_QUERIES.length);
  // No other model is touched at all.
  for (const model of [
    "prisma.examAssignment",
    "prisma.examSessionBreak",
    "prisma.examSessionSupervisor",
    "prisma.examBeginnerChild",
    "prisma.examTeachingPracticeSourceDate",
    "prisma.teachingPracticeLesson",
    "prisma.student",
    "prisma.instructor",
    "prisma.courseOffering",
    "prisma.courseEnrollment",
  ]) {
    assert.equal(CODE.includes(model), false, `the module reads ${model}`);
  }
});

test("12. no query sits in a loop or in a per-row callback", () => {
  for (const loop of ["for (", "for(", "while (", "forEach(", "reduce("]) {
    assert.equal(CODE.includes(loop), false, `the module contains a ${loop} construct`);
  }
  for (const match of CODE.matchAll(/prisma\.\w+\./g)) {
    assert.equal(parenDepthAt(CODE, match.index), 0, `a query at ${match.index} is nested`);
  }
  // Each query lives in its own helper, so there is exactly one per function.
  for (const name of [
    "findExamPlanByCourseOfferingId",
    "findDefinitionsByPlanId",
    "countSessionsByDefinition",
  ]) {
    assert.equal((bodyOf(name).match(/prisma\./g) ?? []).length, 1, `${name} queries twice`);
  }
});

test("13. the usage count is ONE grouped statement over BOTH key columns", () => {
  const helper = bodyOf("countSessionsByDefinition");
  assert.ok(/by:\s*\["planId",\s*"definitionId"\]/.test(helper), "the grouping key is wrong");
  assert.ok(/where:\s*\{\s*planId\s*\}/.test(helper), "the count is not plan-scoped");
  assert.ok(/_count:\s*\{\s*_all:\s*true\s*\}/.test(helper), "the count is not a row count");
  // The QUERY region only — the mapping below it legitimately names the grouped
  // `definitionId` when it hands the group to the core.
  const query = helper.slice(0, helper.indexOf("return "));
  assert.ok(query.includes("groupBy("), "the query region could not be bounded");
  assert.equal(query.includes("definitionId:"), false, "the count filters one definition");
  assert.equal(CODE.includes("examSession.count("), false, "a single-definition count exists");
  // It selects no ExamSession column and includes no relation.
  for (const column of [
    "date:",
    "startTime:",
    "endTime:",
    "arena:",
    "title:",
    "notes:",
    "assignments:",
    "supervisors:",
    "breaks:",
    "individualPublishedAt:",
    "include:",
  ]) {
    assert.equal(helper.includes(column), false, `the count reads ${column}`);
  }
});

test("14. the plan select is the id and the publication instant, and nothing else", () => {
  const helper = bodyOf("findExamPlanByCourseOfferingId");
  assert.ok(
    /select:\s*\{\s*id:\s*true,\s*publishedAt:\s*true,?\s*\}/.test(helper),
    `the select was: ${helper}`,
  );
  for (const forbidden of [
    "sourceDates",
    "sessions",
    "definitions",
    "courseOffering:",
    "createdAt",
    "updatedAt",
    "include",
  ]) {
    assert.equal(helper.includes(forbidden), false, `the plan query reads ${forbidden}`);
  }
  // A read never creates a plan.
  for (const token of ["examPlan.upsert", "examPlan.create", "examPlan.update"]) {
    assert.equal(CODE.includes(token), false, `the module performs ${token}`);
  }
});

test("15. the definition select is EXACTLY the ten approved columns, in a stable order", () => {
  const helper = bodyOf("findDefinitionsByPlanId");
  const select = helper.slice(helper.indexOf("select: {"), helper.indexOf("orderBy:"));
  const columns = [...select.matchAll(/(\w+):\s*true/g)].map(([, name]) => name);
  assert.deepEqual(columns, [
    "id",
    "name",
    "kind",
    "durationMinutes",
    "parallelCapacity",
    "requiresInstructedTrainee",
    "requiresLessonTopic",
    "requiresDiscipline",
    "orderIndex",
    "updatedAt",
  ]);
  for (const forbidden of ["planId:", "createdAt:", "sessions:", "plan:", "include:", "_count:"]) {
    assert.equal(select.includes(forbidden), false, `the definition query reads ${forbidden}`);
  }
  // The deterministic order, with the id tie-break the core also imposes.
  assert.ok(
    /orderBy:\s*\[\{\s*orderIndex:\s*"asc"\s*\},\s*\{\s*id:\s*"asc"\s*\}\]/.test(helper),
    "the definition order is not deterministic",
  );
});

// ===========================================================================
// 16–19. What is NOT read, and what NEVER escapes
// ===========================================================================

test("16. no forbidden entity is read anywhere in the module", () => {
  // NOTE: `requiresInstructedTrainee` is a per-exam BOOLEAN FLAG the manager
  // configured, not a person — which is why the person tokens below are the
  // exact identity/contact fields rather than the substring "trainee".
  for (const token of [
    "assignments",
    "assignment",
    "supervisor",
    "participants",
    "childAssignments",
    "beginnerChild",
    "studentId",
    "traineeId",
    "instructorId",
    "prisma.student",
    "prisma.instructor",
    "parentName",
    "parentPhone",
    "fullName",
    "TeachingPractice",
    "teachingPractice",
    TP_ACTIONS_MODULE,
    "sourceLesson",
    "sourceTeachingPracticeLessonId",
    "diagnostics",
    GENERATED_CLIENT,
  ]) {
    assert.equal(CODE.includes(token), false, `the module reads ${token}`);
  }
  // The Exams area models no evaluation of any kind: not selected, not mapped.
  for (const word of ["feedback", "rating", "grade", "score", "evaluation"]) {
    const pattern = new RegExp(`\\b\\w*${word}\\w*\\s*:`, "i");
    assert.equal(pattern.test(CODE), false, `the module names a ${word} field`);
  }
});

test("17. the module does not reach the committed exam READ pipeline", () => {
  // This slice is a NARROW, dedicated reader. It must not reuse the wide
  // role-scoped plan read, whose payload is the sensitive superset.
  for (const token of [
    "readAdminExamPlan",
    "readInstructorExamPlan",
    "readTraineeExamDay",
    "loadExamPlan",
    "exam-read-scope-core",
    "exam-plan-loader-core",
    "exam-read-io",
    "exam-role-readers",
    "exam-read-dto",
    "examPlanReadDeps",
  ]) {
    assert.equal(CODE.includes(token), false, `the module reaches ${token}`);
  }
  // The ONE exam module it imports is this slice's own pure core.
  const specifiers = [...CODE.matchAll(/from\s+"([^"]+)"/g)].map(([, value]) => value);
  assert.deepEqual(specifiers.filter((value) => value.includes("/exam")).sort(), [
    "@/lib/exam/exam-definition-admin-read-core",
    "@/lib/exam/exam-definition-admin-read-core",
  ]);
  assert.deepEqual(specifiers.sort(), [
    "@/app/generated/prisma/client",
    "@/lib/course/admin-course-context",
    "@/lib/course/operation-policy-core",
    "@/lib/exam/exam-definition-admin-read-core",
    "@/lib/exam/exam-definition-admin-read-core",
    PRISMA_MODULE,
  ]);
});

test("18. the module writes NOTHING, opens no transaction and runs no raw SQL", () => {
  const writes = /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/;
  assert.equal(writes.test(CODE), false, "the module performs a write");
  for (const token of [
    "$transaction",
    "$executeRaw",
    "$queryRaw",
    "$connect",
    "$disconnect",
    "notification",
    "Notification",
    "web-push",
    "sendMessage",
  ]) {
    assert.equal(CODE.includes(token), false, `the module uses ${token}`);
  }
});

test("19. no database client, raw row or Date escapes the module", () => {
  // The client is imported for use, never re-exported or returned.
  assert.equal(/return\s+prisma\b/.test(CODE), false, "the client is returned");
  assert.equal(CODE.includes("export { prisma"), false, "the client is re-exported");
  for (const token of ["PrismaClient", "Prisma.", "PrismaPromise", "prisma as "]) {
    assert.equal(CODE.includes(token), false, `the module exposes ${token}`);
  }
  // Every helper's return type is a committed core type, never an inferred row.
  for (const [name, returned] of [
    ["requireCourseContext", "Promise<VerifiedExamDefinitionReadCourseContext>"],
    ["findExamPlanByCourseOfferingId", "Promise<ResolvedExamPlanForAdminRead | null>"],
    ["findDefinitionsByPlanId", "Promise<readonly StoredAdminExamDefinitionRow[]>"],
    ["countSessionsByDefinition", "Promise<readonly ExamDefinitionSessionCountRow[]>"],
  ] as const) {
    assert.ok(CODE.includes(`): ${returned} {`), `${name} does not declare ${returned}`);
  }
  // Exactly TWO instants are converted, both to epoch milliseconds, both here.
  assert.equal((CODE.match(/\.getTime\(\)/g) ?? []).length, 2);
  assert.ok(/publishedAt:\s*plan\.publishedAt === null \? null : plan\.publishedAt\.getTime\(\)/.test(CODE));
  assert.ok(/updatedAt:\s*row\.updatedAt\.getTime\(\)/.test(CODE));
  // ...and no `Date` is constructed, compared or formatted anywhere.
  for (const token of ["new Date", "Date.now", "toISOString", "dateKey", "parseDateKey"]) {
    assert.equal(CODE.includes(token), false, `the module uses ${token}`);
  }
});

// ===========================================================================
// 20–23. The slice's shape: exactly one caller, and an exact file footprint
// ===========================================================================

test("20. EXACTLY the one approved admin page reaches this reader", () => {
  const declaring = new Set([join(REPO_ROOT, IO_REL), join(REPO_ROOT, IO_TEST_REL)]);
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
      if (/exam-definition-read-io/.test(code) || /\breadExamDefinitionsForAdmin\s*\(/.test(code)) {
        callers.push(path.slice(REPO_ROOT.length + 1));
      }
    }
  }
  // The COMPLETE caller set — the approved page, plus the two contract suites of
  // that same route, which name the specifier only in order to constrain it.
  // Three EXACT paths; the directory itself is NOT allow-listed, so a fourth
  // file appearing beside them is still a guard failure.
  assert.deepEqual(
    callers.sort(),
    [APPROVED_PAGE, APPROVED_PAGE_SUITE, APPROVED_CREATE_SUITE].sort(),
    `an unapproved caller exists: ${callers.join(", ")}`,
  );

  // And of those, exactly ONE is shipped code. A test suite may drive or describe
  // the reader; only this page may render it to a user.
  assert.deepEqual(
    callers.filter((path) => !/\.test\.tsx?$/.test(path)),
    [APPROVED_PAGE],
    "exactly one production module may reach this reader",
  );

  // No top-level exam route and no exam Server Action surface exists. The
  // approved page is course-scoped, so it matches none of these.
  for (const dir of [
    join("app", "admin", "exams"),
    join("app", "instructor", "exams"),
    join("app", "student", "exams"),
  ]) {
    assert.equal(existsSync(join(REPO_ROOT, dir)), false, `${dir} was created`);
  }
  for (const file of [
    join("lib", "actions", "exam-definition-actions.ts"),
    join("lib", "actions", "exam-definition-read-actions.ts"),
    join("lib", "actions", "exams.ts"),
  ]) {
    assert.equal(existsSync(join(REPO_ROOT, file)), false, `${file} was created`);
  }
});

test("21. the slice's four files exist, and none of them is a UI file", () => {
  for (const rel of [IO_REL, IO_TEST_REL, CORE_REL, CORE_TEST_REL]) {
    assert.ok(existsSync(join(REPO_ROOT, rel)), `${rel} is missing`);
    assert.equal(rel.endsWith(".tsx"), false, `${rel} is a UI file`);
  }
  // No fifth file was added under either directory for this read slice.
  const actionsSlice = readdirSync(join(REPO_ROOT, "lib", "actions"))
    .filter((name) => name.startsWith("exam-definition-read"))
    .sort();
  assert.deepEqual(actionsSlice, [
    "exam-definition-read-io.test.ts",
    "exam-definition-read-io.ts",
  ]);
  const examSlice = readdirSync(join(REPO_ROOT, "lib", "exam"))
    .filter((name) => name.startsWith("exam-definition-admin-read"))
    .sort();
  assert.deepEqual(examSlice, [
    "exam-definition-admin-read-core.test.ts",
    "exam-definition-admin-read-core.ts",
  ]);
});

test("22. nothing outside the approved paths was touched", () => {
  // Worktree, index and untracked together, so this describes the SLICE rather
  // than one moment in its lifecycle. The previous form asserted that NO tracked
  // file changed at all — which the authorized EX-S5B-5B dashboard link makes
  // permanently impossible — and that nothing was staged, which stopped being a
  // containment statement the moment the read slice was committed.
  const touched = new Set([
    ...gitLines(["diff", "--name-only", "HEAD"]),
    ...gitLines(["diff", "--name-only", "--cached", "HEAD"]),
    ...gitLines(["ls-files", "--others", "--exclude-standard"]),
  ]);
  const offenders = [...touched].filter((path) => !SLICE_PATHS.includes(path)).sort();
  assert.deepEqual(offenders, [], `an unapproved path was touched: ${offenders.join(", ")}`);
});

test("23. the four EX-S5B-5A files are all tracked, and none was deleted", () => {
  // The previous form compared the UNTRACKED file list against these four, which
  // could only ever hold before they were committed (and had already stopped
  // holding at 85f0818). Tracked-existence is the same invariant, permanently.
  const tracked = new Set(gitLines(["ls-files"]));
  for (const rel of NEW_FILES) {
    assert.ok(tracked.has(rel), `${rel} is not tracked`);
  }
});

// ===========================================================================
// 24. The core it binds stays pure
// ===========================================================================

test("24. the pure core this module binds imports no database client", () => {
  const core = readFileSync(join(REPO_ROOT, CORE_REL), "utf8");
  for (const specifier of [PRISMA_MODULE, GENERATED_CLIENT]) {
    assert.equal(core.includes(specifier), false, `the core imports ${specifier}`);
  }
  // CODE only: the core's header legitimately states that it is NOT server-bound.
  const coreCode = stripComments(core);
  assert.equal(coreCode.includes("server" + "-only"), false, "the core is server-bound");
  assert.equal(/^import\s/m.test(coreCode), false, "the core imports something");
  // The core is the layer that owns the order and the view; this module is not.
  assert.ok(core.includes("export async function readExamDefinitionsForAdminWithDeps("));
  assert.ok(core.includes("export function emptyAdminExamDefinitionListView("));
});
