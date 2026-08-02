import test from "node:test";
import assert from "node:assert/strict";

/**
 * EXAM EX-ASG-IT2 — the contract of the manager-facing CREATE of one stored
 * INSTRUCTED_TRAINEE exam assignment, on the course-scoped admin exams route.
 *
 * Run (the bracketed route segment is a GLOB to node:test, so the `[` must be
 * escaped as `[[]` or the file silently matches nothing and zero tests run):
 *   npx tsx --test "app/admin/courses/[[]courseOfferingId]/exams/exam-instructed-trainee-assignment-ui.contract.test.ts"
 *
 * ===========================================================================
 * WHY SO MANY TOKENS IN THIS FILE ARE ASSEMBLED FROM PIECES
 * ===========================================================================
 * Several committed guards sweep every file under `app/`, `lib/` and
 * `components/` for a module name or a CALL SHAPE and pin the result to an exact
 * caller list. The one that matters most here is the committed Stage A write
 * binding's: before this slice it pinned its caller list at EXACTLY ZERO, and
 * after it at exactly the one Server Action module.
 *
 * A CONTRACT SUITE IS NOT A CALLER. This file asserts things ABOUT that binding;
 * it never invokes one. But those guards match RAW SOURCE TEXT — not imports, not
 * an AST — so a suite that spelled the binding's module name, or its create CALL,
 * whole anywhere in its source (INCLUDING in a comment such as this one) would
 * enrol itself in the very allow-list it exists to keep narrow. The only way to
 * make that pass would be to widen it, which is exactly backwards. This paragraph
 * therefore describes those tokens rather than reproducing them.
 *
 * So every such token below is built by concatenation. The value compared against
 * the production source is identical; only the literal spelling in THIS file
 * differs. That is the project's split-literal convention, and it is load-bearing
 * rather than cosmetic.
 *
 * ===========================================================================
 * WHAT THIS SUITE PROVES, AND WHAT IT DELIBERATELY DOES NOT
 * ===========================================================================
 * It proves the SHAPE of the eighth endpoint, its one form, its closed message
 * module and the page wiring: the exact two-field FormData budget, the absent
 * horse, role and pairing, the server-bound offering, the authorization order,
 * the closed result mapping, the independence of the two create gates, and the
 * fact that no id and no personal detail is ever rendered as text.
 *
 * It does NOT re-prove the committed writer. Whether the create assigns the next
 * order position atomically, whether the definition gate fails closed, whether
 * the eligibility statement is one fail-closed `where`, and how the role-blind
 * unique violation is classified are all that binding's own contract, proven in
 * its own suite. Nothing in this slice changed any of that, which the footprint
 * guards assert directly.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..", "..");

const ROUTE_DIR_REL = join("app", "admin", "courses", "[courseOfferingId]", "exams");
/** The same directory in git's own form: forward slashes, repository-relative. */
const ROUTE_DIR_PREFIX = "app/admin/courses/[courseOfferingId]/exams/";

const ACTIONS_REL = join(ROUTE_DIR_REL, "actions.ts");
const PAGE_REL = join(ROUTE_DIR_REL, "page.tsx");
const FORM_REL = join(ROUTE_DIR_REL, "CreateExamInstructedTraineeAssignmentForm.tsx");
const MESSAGES_REL = join(ROUTE_DIR_REL, "exam-instructed-trainee-assignment-messages.ts");
const SUITE_REL = join(ROUTE_DIR_REL, "exam-instructed-trainee-assignment-ui.contract.test.ts");

/** The route's EXACT final file set, after this slice's three additions. */
const FINAL_ROUTE_FILES = [
  "app/admin/courses/[courseOfferingId]/exams/CreateExamAssignmentForm.tsx",
  "app/admin/courses/[courseOfferingId]/exams/CreateExamInstructedTraineeAssignmentForm.tsx",
  "app/admin/courses/[courseOfferingId]/exams/DeleteExamAssignmentForm.tsx",
  "app/admin/courses/[courseOfferingId]/exams/EditExamAssignmentCard.tsx",
  "app/admin/courses/[courseOfferingId]/exams/ExamDefinitionCreateForm.tsx",
  "app/admin/courses/[courseOfferingId]/exams/ExamPlanCreateForm.tsx",
  "app/admin/courses/[courseOfferingId]/exams/ExamSessionCreateForm.tsx",
  "app/admin/courses/[courseOfferingId]/exams/ExamSessionDeleteForm.tsx",
  "app/admin/courses/[courseOfferingId]/exams/ExamSessionEditForm.tsx",
  "app/admin/courses/[courseOfferingId]/exams/actions.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-assignment-messages.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-assignment-ui.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-definition-create-error-messages.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-definition-create.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-definitions-page.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-instructed-trainee-assignment-messages.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-instructed-trainee-assignment-ui.contract.test.ts",
  // EX-PAIR-UI-MVP - the approved admin PAIRING UI, whose ONE new file this is.
  "app/admin/courses/[courseOfferingId]/exams/exam-pairing-ui.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-plan-create.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-publication-ui.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-session-create-error-messages.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-session-create.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-session-edit-delete.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-workspace-messages.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-workspace-view.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-workspace.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/page.tsx",
].sort();

/**
 * The paths this slice may touch: three new route files, two amended route
 * production files, and the committed guard suites whose exact allow-lists,
 * export counts, route file counts or caller lists this slice re-points.
 *
 * The `lib/` entries are ASSEMBLED for the reason in the header.
 */
const SLICE_PATHS = [
  // EX-ADMIN-SRCDATE — the TWO new `lib/` modules that let a manager select which
  // Teaching-Practice days the plan runs as exam days, plus their suites.
  // ASSEMBLED from pieces, for the reason this file's header records: those guards
  // sweep raw source for their own module names and pin exact consumer lists, so a
  // path written whole here would enrol this suite in one of them.
  "lib/exam/" + "admin-exam-source-date" + "-core.test.ts",
  "lib/actions/" + "admin-exam-source-date" + "-io.test.ts",
  // ===========================================================================
  // RE-POINTED by EX-PUB-UI-MVP, which wires the committed exam-plan publication
  // backend to this route. It re-points the export list, the binding count and
  // the feedback-key count of every suite below, so every one of them travels
  // with it and is named HERE, by exact path — never by a directory and never by
  // a glob. Its two PRODUCTION files are this route's Server Action module and
  // its page, both already on this list; the rest are guard suites and the one
  // new contract suite.
  //
  // The `lib/` entry is assembled from pieces for the reason in the header: that
  // suite sweeps every source file for the publication binding's module name and
  // pins the result to EXACTLY ONE production caller, so a path written whole
  // here would enrol this suite in the very list it exists to keep narrow.
  // ===========================================================================
  "app/admin/courses/[courseOfferingId]/exams/actions.ts",
  "app/admin/courses/[courseOfferingId]/exams/page.tsx",
  "app/admin/courses/[courseOfferingId]/exams/exam-publication-ui.contract.test.ts",
  // EX-PAIR-UI-MVP - the approved admin PAIRING UI, whose ONE new file this is.
  "app/admin/courses/[courseOfferingId]/exams/exam-pairing-ui.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-plan-create.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-definitions-page.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-definition-create.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-session-create.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-session-edit-delete.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-workspace-messages.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-workspace-view.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-workspace.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-assignment-ui.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-instructed-trainee-assignment-ui.contract.test.ts",
  "lib/actions/" + "exam-publication-write" + "-io.test.ts",
  // ...and the committed PAIRING backend guard, whose caller list EX-PAIR-UI-MVP
  // re-points from zero to exactly one Server Action module. A `.test.ts`, so no
  // production module joins this list.
  "lib/actions/" + "exam-pairing-write" + "-io.test.ts",
  // The three new files.
  `${ROUTE_DIR_PREFIX}CreateExamInstructedTraineeAssignmentForm.tsx`,
  `${ROUTE_DIR_PREFIX}exam-instructed-trainee-assignment-messages.ts`,
  `${ROUTE_DIR_PREFIX}exam-instructed-trainee-assignment-ui.contract.test.ts`,
  // The two amended production files.
  `${ROUTE_DIR_PREFIX}actions.ts`,
  `${ROUTE_DIR_PREFIX}page.tsx`,
  // The six route guard suites whose counts this slice re-points.
  `${ROUTE_DIR_PREFIX}exam-assignment-ui.contract.test.ts`,
  `${ROUTE_DIR_PREFIX}exam-plan-create.contract.test.ts`,
  `${ROUTE_DIR_PREFIX}exam-definition-create.contract.test.ts`,
  `${ROUTE_DIR_PREFIX}exam-definitions-page.contract.test.ts`,
  `${ROUTE_DIR_PREFIX}exam-session-create.contract.test.ts`,
  `${ROUTE_DIR_PREFIX}exam-session-edit-delete.contract.test.ts`,
  // The committed `lib/` footprint and caller guards.
  "lib/actions/" + "exam-instructed-trainee-assignment-write" + "-io.test.ts",
  "lib/actions/" + "exam-assignment-write" + "-io.test.ts",
  "lib/actions/" + "exam-assignment-read" + "-io.test.ts",
  "lib/actions/" + "exam-definition-read" + "-io.test.ts",
  "lib/actions/" + "admin-exam-session-read" + "-io.test.ts",
  "lib/actions/" + "exam-session-write" + "-io.test.ts",
  "lib/exam/" + "exam-supervisor-write" + "-core.test.ts",
  "lib/actions/" + "exam-plan-write" + "-io.test.ts",
  "lib/exam/" + "create-exam-plan" + "-core.test.ts",
  // EX-ASG-LTD2-B1 — the ADMIN READ DETAIL slice, which travels in the same
  // working tree. It edits the assignment READ pair's own production modules and
  // the pure core's suite, and re-points that pair's guards; all three paths are
  // ASSEMBLED, and the core's two most sharply of all, because the read guard
  // sweeps `app/`, `lib/` and `components/` for that core's name and must keep
  // reporting exactly the one page as its caller.
  "lib/exam/" + "admin-exam-assignment-read" + "-core.ts",
  "lib/exam/" + "admin-exam-assignment-read" + "-core.test.ts",
  "lib/actions/" + "exam-assignment-read" + "-io.ts",
  // ...and the two committed SUPERVISOR IO footprint guards, whose "this slice
  // modified NO tracked file" claims that edit makes obsolete. Each is re-pointed
  // to an exact path list, never relaxed.
  "lib/actions/" + "exam-supervisor-read" + "-io.test.ts",
  "lib/actions/" + "exam-supervisor-write" + "-io.test.ts",
  // EX-ASG-LTD2-B2 — the approved DETAILED examinee assignment UI wiring, which
  // travels in the same working tree. It switches the ONE existing create endpoint
  // to the committed detailed writer, so the examinee create form and the
  // route-local assignment message table join this list. Nothing new is created:
  // no route file, no Server Action, no query key and no form component. The last
  // path is that writer's own committed guard, whose caller list this wiring
  // re-points from ZERO to exactly the one Server Action module — and it is
  // ASSEMBLED, because that guard sweeps `app/`, `lib/` and `components/` for its
  // own module name and would otherwise enrol this suite as a caller.
  "app/admin/courses/[courseOfferingId]/exams/CreateExamAssignmentForm.tsx",
  "app/admin/courses/[courseOfferingId]/exams/exam-assignment-messages.ts",
  "lib/actions/" + "detailed-exam-assignment-write" + "-io.test.ts",
  // EX-ADMIN-WORKSPACE-UX — the four route files the workspace adds, plus the two
  // new `lib/` modules behind its two operations and their suites. The `lib/`
  // entries are ASSEMBLED for the reason this suite's header records: the
  // committed guards sweep raw source text, so a whole literal here would enrol
  // this file as a caller of a writer it never invokes.
  "app/admin/courses/[courseOfferingId]/exams/EditExamAssignmentCard.tsx",
  "app/admin/courses/[courseOfferingId]/exams/exam-workspace-view.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-workspace-messages.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-workspace.contract.test.ts",
  "lib/exam/" + "admin-exam-workspace-edit" + "-core.ts",
  "lib/exam/" + "admin-exam-workspace-edit" + "-core.test.ts",
  "lib/actions/" + "admin-exam-workspace-edit" + "-io.ts",
  "lib/actions/" + "admin-exam-workspace-edit" + "-io.test.ts",
  // Every committed `lib/` guard suite EX-ADMIN-WORKSPACE-UX re-points, so the
  // footprint here matches the working tree in full. All ASSEMBLED, for the
  // reason this suite's header records.
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
  "lib/exam/" + "create-exam-plan" + "-core.test.ts",
  "lib/exam/" + "exam-read" + ".contract.test.ts",
  "lib/exam/" + "exam-supervisor-write" + "-core.test.ts",
  // BLOCKER-1 — the canonical wave narrowing, its suite, and the ONE committed
  // `lib/` production module this slice modifies: the role-reader module, which
  // gains one ADMIN-ONLY export so the admin schedule can reuse the committed
  // timetable derivation instead of reproducing it. ASSEMBLED, so this suite
  // does not enrol itself as a caller of what it names.
  "lib/exam/" + "admin-exam-wave-view" + "-core.ts",
  "lib/exam/" + "admin-exam-wave-view" + "-core.test.ts",
  "lib/actions/" + "exam-role" + "-readers" + ".ts",
  // EX-ADMIN-SRCDATE ADDED two `lib/` production modules and MODIFIED no
  // committed one: the pure source-date decision core, and its server-only
  // binding. They are the ONE way a plan can gain a Teaching-Practice date, and
  // without them every plan held an empty selection and beginner exams could
  // not appear on any screen. ASSEMBLED, for the reason this header records.
  "lib/exam/" + "admin-exam-source-date" + "-core.ts",
  "lib/actions/" + "admin-exam-source-date" + "-io.ts",
  // BLOCKER-1 also re-points the READ-PIPELINE guard suites whose claims the one
  // admin-only export makes obsolete. ASSEMBLED.
  "lib/exam/" + "exam-read" + "-dto.test.ts",
  "lib/exam/" + "exam-read-scope" + "-core.test.ts",
  "lib/exam/" + "exam-read" + ".contract.test.ts",

  // EX-ASG-MULTIPLICITY + EX-PAIR-NO-SELF - this branch's EXACT, CLOSED footprint.
  // ADDED, never widened: every entry is one exact literal path. No directory,
  // no prefix, no glob - an unrelated file still fails this guard. Module names
  // are SPLIT so this list never reads as a REFERENCE to the module it names.
  "app/admin/courses/[courseOfferingId]/exams/CreateExamInstructedTraineeAssignment" + "Form.tsx",
  "app/admin/courses/[courseOfferingId]/exams/exam-instructed-trainee-assignment" + "-messages.ts",
  "app/student/trainee-teaching-practice-home-shortcut" + ".contract.test.ts",
  "lib/actions/detailed-exam-assignment-write" + "-io.ts",
  "lib/actions/exam-assignment-write" + "-io.ts",
  "lib/actions/exam-instructed-trainee-assignment-write" + "-io.ts",
  "lib/actions/exam-pairing-write" + "-io.ts",
  "lib/actions/instructor-exam-schedule" + ".contract.test.ts",
  "lib/actions/message-audience" + ".contract.test.ts",
  "lib/actions/trainee-exam-schedule" + ".contract.test.ts",
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
];

// --- Assembled tokens (see the header) -------------------------------------
const WRITER_MODULE = "exam-instructed-trainee-assignment-write" + "-io";
const WRITER_SPECIFIER = "@/lib/actions/" + WRITER_MODULE;
const WRITER_NAME = "create" + "ExamInstructedTraineeAssignment";
const WRITER_CALL = WRITER_NAME + "(";
/** The eighth Server Action — safe to spell whole: it is not the writer. */
const ACTION_NAME = "createExamInstructedTraineeAssignmentAction";
const ELIGIBLE_READER_CALL = "read" + "EligibleExamTraineesForAdmin" + "(";
const ASSIGNMENT_READER_CALL = "read" + "AdminExamAssignments" + "(";
const DEFINITION_READER_CALL = "read" + "ExamDefinitionsForAdmin" + "(";
const SESSION_READER_CALL = "read" + "AdminExamSessions" + "(";
const PRISMA_MODULE = ["@/lib", "prisma"].join("/");
const GENERATED_CLIENT = ["@prisma", "client"].join("/");
/** The committed exam cores that no file under `app/` may name. */
const FORBIDDEN_CORES = [
  "exam-kind" + "-labels",
  "exam-assignment-write" + "-core",
  "create-exam-assignment" + "-core",
  "delete-exam-assignment" + "-core",
  "create-exam-instructed-trainee-assignment" + "-core",
  "admin-exam-assignment-read" + "-core",
  "exam-domain" + "-core",
  "exam-definition-validation" + "-core",
];

function gitLines(args: readonly string[]): string[] {
  const result = spawnSync("git", [...args], { cwd: REPO_ROOT, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed`);
  return (result.stdout ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * The commit this branch was last merged UP TO, so a footprint guard keeps
 * measuring the slice after it is committed.
 *
 * `git diff HEAD` answers "what is still uncommitted", which silently empties
 * — and so silently passes — the moment the slice is committed locally. The
 * merge base against `main` answers "what does this branch change", which is
 * the question these guards were always asking.
 */
function branchBase(): string {
  const result = spawnSync("git", ["merge-base", "main", "HEAD"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, "git merge-base main HEAD failed");
  return (result.stdout ?? "").trim();
}

/** Every path under `dir` this BRANCH modifies, committed or not. */
function branchModified(dir: string): string[] {
  return gitLines(["diff", "--name-only", "--diff-filter=MDRT", branchBase(), "--", dir]).sort();
}

/**
 * Strip comments so every guard asserts on CODE, not on explanatory prose.
 *
 * LINE comments are removed FIRST, and the order is load-bearing: the Run line in
 * the header contains a GLOB whose bracket-and-slash run can read like a block
 * comment delimiter, and stripping block comments first would let a spurious
 * match open inside it and eat the constants below.
 */
function stripComments(source: string): string {
  return source.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * Collapse every run of whitespace to ONE space, so a guard can assert on a
 * multi-line declaration without also asserting on how the formatter broke it.
 */
function squash(source: string): string {
  return source.replace(/\s+/g, " ");
}

function readSource(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

const ACTIONS_SOURCE = readSource(ACTIONS_REL);
const ACTIONS = stripComments(ACTIONS_SOURCE);
const PAGE_SOURCE = readSource(PAGE_REL);
const PAGE = stripComments(PAGE_SOURCE);
const FORM_SOURCE = readSource(FORM_REL);
const FORM = stripComments(FORM_SOURCE);
const MESSAGES_SOURCE = readSource(MESSAGES_REL);
const MESSAGES = stripComments(MESSAGES_SOURCE);

/**
 * ONE exported action's body, from its declaration to the next one (or to the end
 * of the file for the last). The route's eight actions share a module, so every
 * "this action does X" claim must be scoped to its own body — otherwise a
 * neighbour's `revalidatePath` or `redirect` would satisfy an assertion about
 * this one.
 */
function actionBody(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, `${name} is missing`);
  const rest = source.slice(start);
  const next = rest.indexOf("export async function ", 1);
  return next === -1 ? rest : rest.slice(0, next);
}

const ACTION = actionBody(ACTIONS, ACTION_NAME);

/** The TWO fields — and the ONLY two — the action may read. */
const FIELDS = ["sessionId", "studentId"];

/** The refusal codes the action must map, and no others. */
const REFUSALS = [
  "invalid_input",
  "offering_not_found",
  "operation_not_allowed",
  "plan_not_found",
  "session_not_found",
  "definition_does_not_require_instructed_trainee",
  "trainee_not_eligible",
  "assignment_conflict",
];

/** The two stable input-issue codes the message module must own — and only two. */
const ISSUE_CODES = ["EX-ASG-IN-SESSION-REQUIRED", "EX-ASG-IN-STUDENT-REQUIRED"];

// ===========================================================================
// 1–3. The route's exact file set
// ===========================================================================

test("1. the three new files exist at the exact course-scoped route", () => {
  for (const rel of [FORM_REL, MESSAGES_REL, SUITE_REL]) {
    assert.ok(existsSync(join(REPO_ROOT, rel)), `${rel} is missing`);
  }
  // ...and they joined an EXISTING route rather than creating a second one.
  assert.ok(existsSync(join(REPO_ROOT, ACTIONS_REL)), "the action module is missing");
  assert.ok(existsSync(join(REPO_ROOT, PAGE_REL)), "the page is missing");
});

test("2. the route directory holds EXACTLY the twenty-seven approved files", () => {
  // Tracked AND untracked, so this holds both before and after the slice is
  // committed. Listing the whole repository and filtering by prefix in JS is
  // deliberate: a bracketed pathspec would be read by git as a character class.
  const routeFiles = [
    ...new Set([
      ...gitLines(["ls-files"]),
      ...gitLines(["ls-files", "--others", "--exclude-standard"]),
    ]),
  ]
    .filter((path) => path.startsWith(ROUTE_DIR_PREFIX))
    .sort();
  assert.deepEqual(routeFiles, FINAL_ROUTE_FILES);
});

test("3. no second exams route and no instructor or trainee surface was created", () => {
  for (const dir of [
    join("app", "admin", "exams"),
    join("app", "admin", "exam-assignments"),
    join("app", "instructor", "exams"),
    join("app", "student", "exams"),
  ]) {
    assert.equal(existsSync(join(REPO_ROOT, dir)), false, `${dir} was created`);
  }
  for (const file of [
    join("lib", "actions", "exam-instructed-trainee-assignment-actions.ts"),
    join("lib", "actions", "exam-instructed-trainees.ts"),
    join("lib", "actions", "exams.ts"),
  ]) {
    assert.equal(existsSync(join(REPO_ROOT, file)), false, `${file} was created`);
  }
});

// ===========================================================================
// 4–9. The Server Action: kind, exports, signature and the ORDER
// ===========================================================================

test("4. the action module is still a Server Action module and nothing else", () => {
  const useServer = '"use ' + 'server"';
  const firstLine = ACTIONS_SOURCE.split("\n").find((line) => line.trim().length > 0);
  assert.ok(firstLine);
  assert.equal(firstLine.trim(), `${useServer};`, `the first line is: ${firstLine}`);
  assert.equal(ACTIONS.includes('"use ' + 'client"'), false);
  assert.equal(ACTIONS.includes("server" + "-only"), false);
});

test("5. the module exports EXACTLY nine actions, IT2's appended EIGHTH", () => {
  const exported = [
    ...ACTIONS_SOURCE.matchAll(/export (?:async )?function (\w+)\(/g),
  ].map(([, name]) => name);
  // An EXHAUSTIVE allow-list in a FIXED order. Everything exported from a
  // "use server" module is a public network endpoint, so this list IS the attack
  // surface: no TENTH endpoint, and no helper, parser, constant or type beside
  // them. The seven that were here keep their exact relative order — this slice
  // APPENDS rather than reshuffles.
  //
  // RE-POINTED by EX-PUB-UI-MVP on exactly the terms IT2 earned: ONE reviewed
  // endpoint APPENDED to an exhaustive, ORDERED list. IT2's own action keeps its
  // EIGHTH position, which is what this suite is actually responsible for, and the
  // publication action is pinned by name in the ninth slot so an unapproved tenth
  // still fails here.
  assert.deepEqual(exported, [
    "createExamPlanAction",
    "createExamDefinitionAction",
    "createExamSessionAction",
    "updateExamSessionAction",
    "deleteExamSessionAction",
    "createExamAssignmentAction",
    "deleteExamAssignmentAction",
    ACTION_NAME,
    "setExamPlanPublicationAction",
    // EX-PAIR-UI-MVP appended a TENTH: the admin pairing endpoint. Still EXHAUSTIVE.
    "setExamPairingAction",
    // EX-ADMIN-WORKSPACE-UX appended an ELEVENTH and a TWELFTH: the ONE coherent
    // examinee card save, and the one-step examinee move. Still EXHAUSTIVE.
    "updateExamAssignmentDetailsAction",
    "moveExamAssignmentAction",
    // EX-ADMIN-SRCDATE appended a THIRTEENTH: the ONE endpoint that replaces the
    // plan's Teaching-Practice date selection. Still EXHAUSTIVE, and still not a
    // generic endpoint — it performs one operation and reads one field name.
    "replaceExamSourceDatesAction",
  ]);
  // RE-POINTED by EX-ADMIN-SRCDATE's ONE appended endpoint — the source-date
  // replacement, which is the only way a plan can gain a Teaching-Practice day
  // and therefore the only way a beginner exam can appear anywhere at all.
  assert.equal(exported.length, 13, "no fourteenth endpoint may exist in this module");
  assert.equal(exported[7], ACTION_NAME, "the new action must be appended after the seven");
  for (const token of ["export const", "export default", "export {", "export type"]) {
    assert.equal(ACTIONS.includes(token), false, `the module also declares ${token}`);
  }
  // RE-POINTED from ten to TWELVE by EX-ADMIN-WORKSPACE-UX, which appends the
  // examinee card save and the one-step examinee move. Still an EXACT count: a
  // thirteenth endpoint still fails here.
  // RE-POINTED by EX-ADMIN-SRCDATE's ONE appended endpoint — the source-date
  // replacement, which is the only way a plan can gain a Teaching-Practice day
  // and therefore the only way a beginner exam can appear anywhere at all.
  assert.equal((ACTIONS.match(/export async function /g) ?? []).length, 13);
});

test("6. the action has the EXACT locked signature, and returns void", () => {
  // RE-POINTED — the navigation-state fix. The action gained TWO bound
  // parameters between the offering id and the submission: `groupQuery` — the
  // same closed tab/view/ordinal tail every in-view link already carries — and
  // `addAssignmentOpen` — the same closed disclosure the page renders this form
  // (and its examinee sibling) from. This is the SAME two-parameter shape
  // `createExamAssignmentAction` already carries, for the SAME reason: a create
  // must return the manager to the exact arrangement they opened it from, and
  // reopen the add form only if it already was open. A third or fourth
  // unapproved parameter still fails here.
  assert.ok(
    new RegExp(
      `export async function ${ACTION_NAME}\\(\\s*courseOfferingId: string,\\s*groupQuery: string,\\s*addAssignmentOpen: boolean,\\s*formData: FormData,\\s*\\): Promise<void> \\{`,
    ).test(ACTIONS_SOURCE),
    "the signature is not the locked one",
  );
  // No `prevState`, no options bag, no fifth parameter and no non-void return:
  // every outcome is a navigation, so the action cannot grow client-visible state.
  assert.equal(ACTION.includes("prevState"), false, "the action takes prevState");
  assert.equal(/return\s+[^;]/.test(ACTION), false, "the action returns a value");
});

test("7. requireAdmin() is the FIRST awaited operation in the new body", () => {
  const firstAwait = ACTION.indexOf("await ");
  assert.ok(firstAwait > 0, "the action awaits nothing");
  assert.ok(
    ACTION.slice(firstAwait).startsWith("await requireAdmin();"),
    "the first awaited operation is not requireAdmin()",
  );
  // Nothing is read from the submission, and the writer is not entered, BEFORE it.
  const before = ACTION.slice(0, firstAwait);
  for (const token of ["formData.get", WRITER_CALL, "redirect(", "revalidatePath("]) {
    assert.equal(before.includes(token), false, `${token} runs before requireAdmin()`);
  }
});

test("8. there is STILL no try/catch anywhere, so NEXT_REDIRECT always propagates", () => {
  // The strongest form of the rule: not "the redirect is outside the block", but
  // "there is no block". An unexpected writer failure therefore propagates rather
  // than being flattened into a query code that nobody investigates.
  for (const token of ["try {", "catch (", "catch(", "finally {"]) {
    assert.equal(ACTIONS.includes(token), false, `the action module uses ${token}`);
  }
});

test("9. the module's import surface gained EXACTLY the one committed writer", () => {
  const specifiers = [...ACTIONS.matchAll(/from\s+"([^"]+)"/g)].map(([, s]) => s).sort();
  // RE-POINTED by EX-ASG-LTD2-B2 by ADDING one specifier: the committed DETAILED
  // examinee write binding, which the existing create endpoint now calls in place
  // of the three-field one. The three-field binding is STILL imported, for the
  // removal, so this is a ninth specifier and not a swap.
  // RE-POINTED from 9 to 10 by EX-PUB-UI-MVP, which adds the committed
  // publication write binding. The three positive assertions below still pin the
  // specifiers THIS suite is responsible for, and the core/Prisma/capability/
  // notification bans below are untouched.
  // RE-POINTED from 11 to 12 by EX-ADMIN-WORKSPACE-UX, which adds the workspace
  // edit/move binding — the ONE backend addition behind the examinee card save and
  // the one-step move. The three positive assertions above still pin the
  // specifiers THIS suite is responsible for, and the core/Prisma/capability/
  // notification bans below are untouched.
  // RE-POINTED by EX-ADMIN-SRCDATE's ONE appended endpoint — the source-date
  // replacement, which is the only way a plan can gain a Teaching-Practice day
  // and therefore the only way a beginner exam can appear anywhere at all.
  assert.equal(specifiers.length, 13, "the action module's import surface is not thirteen");
  assert.ok(specifiers.includes(WRITER_SPECIFIER), "the committed writer is not imported");
  assert.ok(
    specifiers.includes("@/lib/actions/" + "detailed-exam-assignment-write" + "-io"),
    "the detailed examinee write binding is not imported",
  );
  // The IMPORT KEYWORD itself is split, not just the specifier: this suite's own
  // no-database guard below extracts every `from "…"` occurrence in THIS file and
  // pins the result to five node: builtins, so any spelling that puts a quote
  // straight after the word would enrol the expectation as an import of its own.
  const importStatement =
    "import { " + WRITER_NAME + " } " + "fr" + "om " + JSON.stringify(WRITER_SPECIFIER) + ";";
  assert.ok(
    squash(ACTIONS).includes(importStatement),
    "the writer is not imported by its exact name from its exact module",
  );
  // No pure core, no Prisma, no capability and no notification surface entered.
  for (const specifier of specifiers) {
    assert.equal(specifier.includes("-core"), false, `the module imports a core: ${specifier}`);
  }
  for (const forbidden of [PRISMA_MODULE, GENERATED_CLIENT, "capabilit", "notification"]) {
    assert.equal(ACTIONS.includes(forbidden), false, `the module references ${forbidden}`);
  }
});

// ===========================================================================
// 10–12. The exact FormData budget
// ===========================================================================

test("10. the offering is the BOUND leading argument and is NEVER read from FormData", () => {
  // The id reaches the writer from the bound parameter, in the locked position,
  // followed by exactly the two raw fields.
  assert.ok(
    squash(ACTION).includes(
      `${WRITER_CALL}courseOfferingId, { sessionId: formData.get("sessionId"), studentId: formData.get("studentId"), });`,
    ),
    "the writer is not called with the bound id and the exact two raw fields",
  );
  // ...and NEVER from the submission.
  for (const forbidden of [
    'formData.get("courseOfferingId")',
    'formData.get("planId")',
    'formData.get("offeringId")',
    'formData.get("definitionId")',
    'formData.get("role")',
    'formData.get("horseName")',
    'formData.get("orderIndex")',
    'formData.get("pairingIndex")',
    'formData.get("assignmentCount")',
    'formData.get("fullName")',
    'formData.get("instructionTopic")',
    'formData.get("discipline")',
    'formData.get("notes")',
  ]) {
    assert.equal(ACTION.includes(forbidden), false, `the action reads ${forbidden}`);
  }
  // The page binds the VERIFIED context id, the current view and the shared
  // add-form disclosure — never the raw route param — and binds the action
  // EXACTLY ONCE, hoisted, so there is one place to check the id's provenance no
  // matter how many per-session controls React renders from it.
  //
  // RE-POINTED — the navigation-state fix. The binding gained the SAME two
  // extra arguments the action's signature gained: `groupQuery` and
  // `addAssignmentOpen`, bound in ONLY once both are known — the same reason
  // `createExamAssignmentAction`'s own binding is deferred to that point rather
  // than hoisted with the id alone.
  assert.ok(
    squash(PAGE).includes(
      `${ACTION_NAME}.bind( null, context.id, groupQuery, addAssignmentOpen, )`,
    ),
    "the page must bind the verified context id, the current view and the add-form disclosure into the action",
  );
  assert.equal(
    (PAGE.match(new RegExp(`${ACTION_NAME}\\.bind\\(`, "g")) ?? []).length,
    1,
    "the action must be bound exactly once",
  );
  assert.equal(
    PAGE.includes(`${ACTION_NAME}.bind(null, courseOfferingId)`),
    false,
    "the raw route param must never be bound into the action",
  );
  assert.equal(
    PAGE.includes(`${ACTION_NAME}.bind(null, context.id)`),
    false,
    "the action must not be bound WITHOUT the current view and the add-form disclosure — that is the bug this fix corrects",
  );
});

test("11. the action reads EXACTLY two named fields, and nothing else", () => {
  const reads = [...ACTION.matchAll(/formData\.get\("([^"]+)"\)/g)].map(([, f]) => f);
  assert.deepEqual(reads, FIELDS);
  assert.equal(reads.length, 2, "the action's FormData budget is exactly two");
  // No iteration API could smuggle a third field past the exact list above.
  for (const token of [
    "formData.entries",
    "formData.forEach",
    "formData.keys",
    "formData.getAll",
  ]) {
    assert.equal(ACTION.includes(token), false, `the action uses ${token}`);
  }
});

test("12. neither value is coerced, defaulted, narrowed or trimmed", () => {
  // Both are forwarded EXACTLY as FormData.get returned them — a string, or null
  // for an absent field. The committed input core defines the rest, and a second
  // copy here would be free to drift from the rule the database actually sees.
  for (const forbidden of ["String(formData", "Number(formData", "`${formData", ".trim()"]) {
    assert.equal(ACTION.includes(forbidden), false, `the action coerces with ${forbidden}`);
  }
  assert.equal(ACTION.includes("??"), false, "the action defaults a submitted value");
  assert.equal(
    /typeof\s+\w+\s*===\s*"string"/.test(ACTION),
    false,
    "the action narrows a submitted value instead of forwarding it raw",
  );
});

// ===========================================================================
// 13–15. The closed outcome mapping
// ===========================================================================

test("13. the action maps its closed refusal union and invents no code", () => {
  for (const code of REFUSALS) {
    assert.ok(
      ACTION.includes(code) || MESSAGES.includes(code),
      `the outcome ${code} is unmapped`,
    );
  }
  // The offering not-found routes to the SAFE courses list, because an id that did
  // not resolve cannot be used to build a URL for this course-scoped route — and
  // the requested id is not reflected back in that destination.
  assert.ok(ACTION.includes('if (result.code === "offering_not_found")'));
  assert.ok(ACTION.includes('redirect("/admin/courses?error=invalid")'));
  // Field diagnostics travel as the writer's own CODES, joined — never a message,
  // never a submitted value.
  assert.ok(ACTION.includes('const codes = result.issues.map((issue) => issue.code).join(",")'));
  // RE-POINTED — the navigation-state fix. Every refusal now returns to
  // `backPath` (the exams path plus the bound `groupQuery`) rather than always
  // to the bare exams path, exactly as `createExamAssignmentAction`'s own
  // refusal branches do.
  assert.ok(
    ACTION.includes(
      "`${backPath}&instructedTraineeError=invalid_input&instructedTraineeIssues=${encodeURIComponent(codes)}`",
    ),
  );
  // Every other refusal is fully described by its code alone.
  assert.ok(
    ACTION.includes("`${backPath}&instructedTraineeError=${encodeURIComponent(result.code)}`"),
  );
  assert.equal(
    ACTION.includes("?instructedTraineeError="),
    false,
    "a refusal must never redirect to the bare exams path — that drops the arrangement",
  );
  // The success arm is checked FIRST, so `result.code` is only ever read on a
  // refusal — the success arm of the committed union carries no `code` at all.
  assert.ok(
    ACTION.indexOf("if (result.ok) {") < ACTION.indexOf("result.code"),
    "the success arm must be handled before any refusal code is read",
  );
});

test("14. the action revalidates EXACTLY this exams path, BEFORE its redirect, and returns to the arrangement it was opened from", () => {
  assert.ok(
    ACTION.includes(
      "const examsPath = `/admin/courses/${encodeURIComponent(courseOfferingId)}/exams`",
    ),
    "the action must build the path from the BOUND offering id",
  );
  // RE-POINTED — the navigation-state fix. `backPath` is the same
  // `${examsPath}?${groupQuery}` construction `deleteExamAssignmentAction`,
  // `updateExamAssignmentDetailsAction` and `moveExamAssignmentAction` already
  // build from their own bound `groupQuery`.
  assert.ok(
    ACTION.includes("const backPath = `${examsPath}?${groupQuery}`;"),
    "the action must build the return path from the BOUND groupQuery",
  );
  assert.equal((ACTION.match(/revalidatePath\(/g) ?? []).length, 1, "it revalidates more than once");
  assert.ok(ACTION.includes("revalidatePath(examsPath)"), "it revalidates some other path");
  // Ordering: the cache is invalidated BEFORE the navigation, so the page the
  // manager lands on is re-read rather than served stale.
  assert.ok(
    ACTION.indexOf("revalidatePath(examsPath)") < ACTION.indexOf("redirect("),
    "the action redirects before it revalidates",
  );
  // The success redirect stays open ONLY if the add form already was —
  // `addAssignmentOpen` is never forced on for a manager who submitted from a
  // closed one, mirroring `createExamAssignmentAction`'s own success branch
  // exactly, since both create forms share the one disclosure.
  assert.ok(
    squash(ACTION).includes(
      "redirect( addAssignmentOpen ? `${backPath}&createdInstructedTrainee=1&add=1` : `${backPath}&createdInstructedTrainee=1`, );",
    ),
    "the success redirect must conditionally reopen the shared add form",
  );
  // No other route, layout or tag is refreshed.
  for (const forbidden of ['revalidatePath("/', "revalidateTag", '"layout"', '"page"']) {
    assert.equal(ACTION.includes(forbidden), false, `the action uses ${forbidden}`);
  }
});

test("15. NO id, submitted value or raw error ever reaches the query string", () => {
  // The success arm carries a FLAG and nothing else: the committed writer returns
  // the new assignment id and its assigned position, and neither is read here.
  for (const forbidden of [
    "result.assignmentId",
    "result.orderIndex",
    "result.id",
    "error.message",
    "String(error",
    "JSON.stringify",
  ]) {
    assert.equal(ACTION.includes(forbidden), false, `the action leaks ${forbidden}`);
  }
  // The ONLY dynamic values in any redirect target are `result.code` — a
  // compile-time-known literal from a closed set — the joined issue codes, and
  // now `backPath`/`groupQuery`: the same closed tab/view/ordinal tail every
  // in-view link already carries, bound in from the page and never read from
  // the submission. RE-POINTED to ADD `backPath` and `groupQuery` — never to
  // relax the check into a pattern or a prefix match.
  const interpolations = [...ACTION.matchAll(/\$\{([^}]+)\}/g)].map(([, expr]) => expr.trim());
  for (const expr of interpolations) {
    assert.ok(
      [
        "encodeURIComponent(courseOfferingId)",
        "examsPath",
        "groupQuery",
        "backPath",
        "encodeURIComponent(result.code)",
        "encodeURIComponent(codes)",
      ].includes(expr),
      `the action interpolates ${expr} into a URL`,
    );
  }
});

// ===========================================================================
// 16–20. The create form
// ===========================================================================

test("16. the form is a client component with EXACTLY the approved props", () => {
  assert.equal(
    FORM_SOURCE.split("\n").find((line) => line.trim().length > 0)?.trim(),
    '"use ' + 'client";',
  );
  assert.ok(
    squash(FORM).includes(
      "export function CreateExamInstructedTraineeAssignmentForm({ action, courseOfferingId, sessionId, eligibleTrainees, }: { action: (formData: FormData) => void | Promise<void>; courseOfferingId: string; sessionId: string; eligibleTrainees: readonly InstructedTraineeChoice[]; })",
    ),
    "the form's prop shape is not the locked one",
  );
  // The choice type is declared LOCALLY, carries TWO fields, and is NOT exported:
  // sharing it with the sibling examinee form would tie two separately reviewed
  // surfaces together so that widening either one silently widens the other.
  assert.ok(
    squash(FORM).includes(
      "interface InstructedTraineeChoice { readonly studentId: string; readonly fullName: string; }",
    ),
    "the trainee choice type is not the narrow two-field shape",
  );
  assert.equal(
    FORM.includes("EligibleExamTraineeChoice"),
    false,
    "the form imports the sibling form's private type",
  );
  // No plan id, definition id, role, order, pairing or count may be handed to it.
  for (const forbidden of [
    "planId",
    "definitionId",
    "orderIndex",
    "pairingIndex",
    "assignmentCount",
    "role",
    "horseName",
  ]) {
    assert.equal(FORM.includes(forbidden), false, `the form receives ${forbidden}`);
  }
});

test("17. the form submits EXACTLY two fields, and binds no scope", () => {
  // The session travels as a HIDDEN field; the offering does NOT.
  assert.ok(FORM.includes('<input type="hidden" name="sessionId" value={sessionId} />'));
  const hidden = [...FORM.matchAll(/type="hidden"\s+name="([^"]+)"/g)].map(([, n]) => n);
  assert.deepEqual(hidden, ["sessionId"], "the form carries an unapproved hidden field");
  // The complete submitted field set.
  const named = [...FORM.matchAll(/\bname="([^"]+)"/g)].map(([, n]) => n).sort();
  assert.deepEqual(named, [...FIELDS].sort());
  // The offering is bound into the ACTION on the server, never posted; and the
  // structural guard prop is referenced, never rendered.
  for (const forbidden of [
    'name="courseOfferingId"',
    'name="planId"',
    'name="definitionId"',
    'name="role"',
    'name="horseName"',
    'name="pairingIndex"',
    'name="orderIndex"',
    'name="assignmentCount"',
  ]) {
    assert.equal(FORM.includes(forbidden), false, `the form posts ${forbidden}`);
  }
  assert.ok(FORM.includes("void courseOfferingId;"));
  assert.equal(FORM.includes("{courseOfferingId}"), false, "the offering id is rendered");
  assert.equal(FORM.includes("href"), false, "the form builds a link");
});

test("18. the trainee picker is a NATIVE select showing ONLY the display name", () => {
  assert.ok(FORM.includes('<select name="studentId" required defaultValue=""'));
  // The option VALUE is the opaque Student.id, and the visible text is the name
  // alone. Two trainees who share a display name therefore look identical while
  // remaining DISTINCT options, because their values differ.
  assert.ok(
    squash(FORM).includes(
      "<option key={trainee.studentId} value={trainee.studentId}> {trainee.fullName} </option>",
    ),
    "the option must carry the id as its value and render only the full name",
  );
  // No identity number is rendered merely to tell two names apart, and no other
  // personal detail is reachable at all.
  for (const forbidden of [
    "identityNumber",
    "phone",
    "subgroup",
    "enrollment",
    "birth",
  ]) {
    assert.equal(FORM.includes(forbidden), false, `the form renders ${forbidden}`);
  }
  // No searchable-select dependency was introduced.
  const specifiers = [...FORM.matchAll(/from\s+"([^"]+)"/g)].map(([, s]) => s);
  assert.deepEqual(specifiers, ["react-dom"]);
});

test("19. the form has a pending state and a closed empty state", () => {
  assert.ok(FORM.includes("const { pending } = useFormStatus();"));
  assert.ok(FORM.includes('{pending ? "שומר..." : "שבץ חניך מודרך"}'));
  // With no assignable trainee the whole field set is DISABLED — a disabled
  // fieldset disables every control inside it, and disabled controls submit no
  // entry at all, so this is not merely a visual state.
  assert.ok(FORM.includes("const hasNoTrainees = eligibleTrainees.length === 0;"));
  assert.ok(FORM.includes("<fieldset disabled={hasNoTrainees}"));
  assert.ok(FORM.includes("<CreateSubmitButton disabled={hasNoTrainees} />"));
  assert.ok(FORM.includes("אין כרגע חניכים פעילים הזמינים לשיבוץ בקורס הזה."));
  // There is NO horse control of any kind: this role carries none.
  assert.equal(FORM.includes('name="horseName"'), false);
  assert.equal(FORM.includes('type="text"'), false, "the form has a free-text field");
});

test("20. the form loads no data, duplicates no rule and inserts nothing optimistically", () => {
  for (const forbidden of [
    "useEffect",
    "useState",
    "useOptimistic",
    "fetch(",
    "useRouter",
    "router.",
    "confirm(",
    "onSubmit",
    "preventDefault",
    PRISMA_MODULE,
    GENERATED_CLIENT,
    WRITER_MODULE,
    WRITER_CALL,
    "exam-assignment-write" + "-io",
    "exam-assignment-read" + "-io",
  ]) {
    assert.equal(FORM.includes(forbidden), false, `the form references ${forbidden}`);
  }
  // It does not narrow the offered list against what is already assigned, here or
  // anywhere: the DATABASE's role-blind unique key decides that.
  for (const forbidden of [".filter(", ".sort(", ".slice(", ".reverse("]) {
    assert.equal(FORM.includes(forbidden), false, `the form uses ${forbidden}`);
  }
});

// ===========================================================================
// 21–26. The page: requirements, gating, placement and the untouched list
// ===========================================================================

test("21. the requirements interface gained a THIRD field, copied from the reader", () => {
  assert.ok(
    squash(PAGE).includes(
      // RE-POINTED by EX-ADMIN-WORKSPACE-UX. The three REQUIREMENT flags are
      // unchanged and still lead the shape; three DERIVATION facts follow them —
      // the exam's own duration, how many it takes at once, and its kind — which
      // the wave arithmetic and the block facts need. All six come from the ONE
      // definition reader the page already loaded: no second query, and no
      // widening of the session reader, which reports none of them.
      "interface AssignmentDefinitionRequirements { readonly requiresLessonTopic: boolean; readonly requiresDiscipline: boolean; readonly requiresInstructedTrainee: boolean; readonly durationMinutes: number; readonly parallelCapacity: number; readonly kind: string; }",
    ),
    "the requirements interface is not the locked six-field shape",
  );
  assert.ok(
    squash(PAGE).includes("requiresInstructedTrainee: definition.requiresInstructedTrainee,"),
    "the map must copy the definition reader's own flag",
  );
  assert.ok(PAGE.includes("for (const definition of view.definitions) {"));
});

test("22. NO new reader and no new database call entered the page", () => {
  for (const call of [
    DEFINITION_READER_CALL,
    SESSION_READER_CALL,
    ELIGIBLE_READER_CALL,
    ASSIGNMENT_READER_CALL,
  ]) {
    assert.equal(
      (PAGE.match(new RegExp(call.replace(/[()]/g, "\\$&"), "g")) ?? []).length,
      1,
      `${call} is called more than once — that is an N+1 over the session list`,
    );
    assert.ok(PAGE.includes(`${call}context.id)`), `${call} is not given the verified id`);
    assert.equal(
      PAGE.includes(`${call}courseOfferingId)`),
      false,
      `${call} is given the raw route param`,
    );
  }
  // Exactly four reads, and no fifth of any kind.
  // RE-POINTED from four to FIVE by BLOCKER-1. The fifth is the CANONICAL
  // timetable read: the admin reading of the committed exam plan pipeline, which
  // is what lets this page show the derived times instead of reproducing them.
  // It is the same `loadPlan`, adapter and timetable core the instructor DTO and
  // the trainee day are built from, so no second derivation exists anywhere.
  // RE-POINTED from five to SIX by the approved beginner projection: the SIXTH is
  // the committed ADMIN READING, which is the one source of beginner rows. It is
  // the same pipeline the wave view already uses — no second query.
  assert.equal((PAGE.match(/\bread[A-Z]\w*\(/g) ?? []).length, 6, "a seventh reader entered the page");
  // ASSEMBLED: this suite's own no-database guard below forbids the whole token.
  for (const forbidden of [PRISMA_MODULE, GENERATED_CLIENT, "prisma.", "Prisma" + "Client"]) {
    assert.equal(PAGE.includes(forbidden), false, `the page references ${forbidden}`);
  }
});

test("23. the visibility rule is EXACTLY the definition flag, and fails closed", () => {
  assert.ok(
    squash(PAGE).includes(
      "const showInstructedTraineeForm = requirements !== undefined && requirements.requiresInstructedTrainee;",
    ),
    "the instructed-trainee gate is not the closed two-part test",
  );
  // Unknown requirements fail closed: `requirements !== undefined` is the FIRST
  // conjunct, so a session naming a definition the reader did not report opens no
  // write surface.
  assert.ok(
    squash(PAGE).includes("requirements !== undefined && requirements.requiresInstructedTrainee"),
  );
  // The gate is DECLARED BEFORE the examinee gate, which is what lets the guard
  // below prove the flag never enters it. RE-POINTED by EX-ASG-LTD2-B2: the
  // examinee gate is now named `requirementsUnknown`, and the ORDER — the whole
  // point of this assertion — is unchanged.
  assert.ok(
    PAGE.indexOf("const showInstructedTraineeForm") < PAGE.indexOf("const requirementsUnknown"),
    "showInstructedTraineeForm must be declared before the examinee gate",
  );
});

test("24. the two create gates are INDEPENDENT in both directions", () => {
  // RE-POINTED by EX-ASG-LTD2-B2. The examinee gate NARROWED — from "unknown, or
  // topic, or discipline" to "unknown" alone, because the examinee form now
  // collects both values and its endpoint calls the writer that stores them. This
  // guard is about INDEPENDENCE, not about the examinee rule (that is the
  // assignment suite's own), so what it pins is the new gate's exact text and the
  // fact that the instructed-trainee flag still does not enter it.
  assert.ok(
    squash(PAGE).includes("const requirementsUnknown = requirements === undefined;"),
    "the examinee gate is not the closed unknown-requirements test",
  );
  assert.equal(
    /requirementsUnknown[\s\S]{0,200}requiresInstructedTrainee/.test(squash(PAGE)),
    false,
    "requiresInstructedTrainee must not gate the examinee create form",
  );
  // ...and the topic and discipline flags do not enter the instructed-trainee one.
  const gate = squash(PAGE).slice(
    squash(PAGE).indexOf("const showInstructedTraineeForm"),
    squash(PAGE).indexOf("const requirementsUnknown"),
  );
  for (const forbidden of [
    "requiresLessonTopic",
    "requiresDiscipline",
    "assignmentCount",
    "horseName",
    "pairingIndex",
    "wave",
    "personalTime",
    "sessionAssignments",
  ]) {
    assert.equal(gate.includes(forbidden), false, `the instructed-trainee gate reads ${forbidden}`);
  }
});

test("25. the form sits behind the SAME single lifecycle evaluation, via &&", () => {
  // ONE lifecycle evaluation for the whole page, still, and the new affordance
  // hangs off it — so an ARCHIVED offering keeps a readable roster and gains no
  // control. `&&` rather than a second `mayConfigure ?` ternary, so the committed
  // positional guards over this block keep meaning what they meant.
  assert.equal(
    (PAGE.match(/evaluateCourseOperationPolicy\(/g) ?? []).length,
    1,
    "the write gate must be evaluated exactly once",
  );
  assert.equal(
    (PAGE.match(/assertCourseOperationAllowed\(/g) ?? []).length,
    1,
    "the read gate must be asserted exactly once",
  );
  // RE-POINTED by EX-ADMIN-UX-FIXES, and NARROWED rather than relaxed. The create
  // forms are now CLOSED BY DEFAULT and opened by one control at the TOP of the
  // assignments workspace, so the DISCLOSURE token joins the lifecycle gate as an
  // EXTRA condition — never as a replacement for it. With `mayConfigure` false no
  // `add=1` can bring either form back, and each committed writer re-evaluates the
  // same gate for itself regardless.
  assert.ok(PAGE.includes("{addAssignmentOpen && mayConfigure ? ("));
  assert.ok(PAGE.includes("{showInstructedTraineeForm ? ("));
  assert.ok(PAGE.includes("<CreateExamInstructedTraineeAssignmentForm"));
  // Its four props, exactly — the VERIFIED offering id, this session's id, and the
  // ONE page-wide eligible roster.
  assert.ok(
    squash(PAGE).includes(
      "<CreateExamInstructedTraineeAssignmentForm action={boundCreateInstructedTraineeAssignmentAction} courseOfferingId={context.id} sessionId={session.sessionId} eligibleTrainees={eligibleView.trainees} />",
    ),
    "the form is not rendered with exactly the four approved props",
  );
  // It is placed AFTER the ordinary examinee create block, inside the same
  // per-session assignment section.
  assert.ok(
    PAGE.indexOf("<CreateExamAssignmentForm") <
      PAGE.indexOf("<CreateExamInstructedTraineeAssignmentForm"),
    "the instructed-trainee form must follow the examinee create block",
  );
});

test("26. the list, its roles, the count rule and the ONE delete path are untouched", () => {
  // The stored list still renders every role, including the one this slice now
  // creates, and still uses the SAME removal form and action — no second delete
  // path, no role-specific writer.
  assert.ok(PAGE.includes('EXAMINEE: "נבחן/ת"'));
  assert.ok(PAGE.includes('INSTRUCTED_TRAINEE: "חניך מודרך"'));
  assert.ok(PAGE.includes('const NO_HORSE_TEXT = "—";'));
  assert.ok(PAGE.includes("<DeleteExamAssignmentForm"));
  // RE-POINTED from one to TWO by EX-ADMIN-WORKSPACE-UX: the role-blind removal
  // control is rendered from two places now — once on an examinee's card, and once
  // in the unlinked instructed-trainee roster — because a trainee no longer has a
  // card of its own to carry it. It is the SAME control, bound to the SAME hoisted
  // action, and it still reaches a row of EITHER role.
  assert.equal(
    (PAGE.match(/<DeleteExamAssignmentForm/g) ?? []).length,
    2,
    "the role-blind removal control was lost or duplicated",
  );
  assert.equal(
    (PAGE.match(/action=\{boundDeleteAssignmentAction\}/g) ?? []).length,
    2,
    "the two removal controls must share the ONE hoisted binding",
  );
  assert.equal(
    (PAGE.match(/deleteExamAssignmentAction\.bind\(/g) ?? []).length,
    1,
    "a second delete binding entered the page",
  );
  for (const forbidden of [
    "DeleteExamInstructedTraineeAssignmentForm",
    "deleteExamInstructedTraineeAssignmentAction",
    // RE-POINTED by EX-ASG-LTD2-B1: the EXAMINEE comparison left this list and is
    // pinned exactly below instead. RE-POINTED AGAIN by EX-PAIR-UI-MVP: the
    // INSTRUCTED_TRAINEE one leaves this list too, because the pairing control
    // belongs to that role and to no other. It is pinned to an EXACT count
    // below, and what this guard protects — that the LIST still shows every
    // stored row of every role — is asserted directly and is unchanged.
  ]) {
    assert.equal(PAGE.includes(forbidden), false, `the page adds ${forbidden}`);
  }
  // NARROWED, not relaxed. What this guard protected is that the list shows EVERY
  // stored row whatever its role; the detail slice needs a per-row DISPLAY test,
  // because the two stored detail values belong to the examinee's row and to no
  // other. So the rule is stated directly: EXACTLY ONE role comparison exists, it
  // is the row-level predicate, and it decides what a row SAYS — never whether the
  // row, its role label or its removal control is rendered.
  // RE-POINTED by EX-ADMIN-WORKSPACE-UX, and NARROWED again to the rule itself.
  // The one comparison is now the BUCKETING predicate: it decides which of the two
  // buckets a row joins, and BOTH buckets are rendered in full — the examinees
  // through their waves, the unlinked instructed trainees through their own
  // roster. It still may not gate whether a row or its removal control appears.
  assert.equal(
    (PAGE.match(/=== "EXAMINEE"/g) ?? []).length,
    1,
    "exactly one role comparison may exist, and it is the bucketing predicate",
  );
  assert.ok(PAGE.includes('if (assignment.role === "EXAMINEE") {'));
  assert.ok(
    PAGE.includes("{wave.examinees.map((examinee) => {"),
    "every bucketed examinee must still be mapped",
  );
  assert.ok(
    PAGE.includes("{unlinkedInstructed.map((assignment) => ("),
    "every unlinked instructed trainee must still be mapped",
  );
  assert.equal(
    /role\s*(\?|&&)\s*\(?\s*<(li|DeleteExamAssignmentForm)/.test(squash(PAGE)),
    false,
    "a role predicate must not gate a row or its removal control",
  );
  // The session reader's COUNT stays the authority for the edit/delete decisions.
  assert.ok(PAGE.includes("hasAssignments={session.assignmentCount > 0}"));
  assert.equal(
    (PAGE.match(/hasAssignments=\{session\.assignmentCount > 0\}/g) ?? []).length,
    2,
    "the assignment-count rule changed",
  );
  // No ordering or slicing was introduced anywhere on the page.
  for (const forbidden of [".sort(", ".reverse(", ".slice("]) {
    assert.equal(PAGE.includes(forbidden), false, `the page uses ${forbidden}`);
  }
  // RE-POINTED by EX-ADMIN-WORKSPACE-UX: `.filter(` is pinned to EXACTLY TWO uses
  // rather than banned, and NEITHER re-orders anything the readers decided. One
  // selects the instructed trainees nobody teaches yet; the other partitions the
  // grouping's OWN timeline by its OWN stored day key.
  // RE-POINTED from two to THREE by the approved beginner projection: the third
  // filter selects the committed admin reading's own BEGINNER rows by its own
  // `source` discriminator. It re-orders nothing and reads nothing new.
  // RE-POINTED from three to TWO by EX-ADMIN-UX-FIXES, and it is a NARROWING
  // rather than a relaxation: the by-date day partition moved OUT of the page
  // and into the PURE route-local view module, whose own suite exercises it
  // directly. The two filters left are the unlinked instructed roster and the
  // committed admin reading's own BEGINNER discriminator.
  assert.equal((PAGE.match(/\.filter\(/g) ?? []).length, 2);
  assert.ok(PAGE.includes("(row) => row.pairedExamineeAssignmentId === null"));
  assert.ok(PAGE.includes('(row) => row.source === "BEGINNER"'));
  // And no id or personal detail became text.
  assert.equal(PAGE.includes("assignment.orderIndex"), false, "the order position is rendered");
  assert.equal(PAGE.includes("assignment.studentId"), false, "a Student.id reaches the page");
  // RE-POINTED by the approved READ-ONLY BEGINNER PROJECTION. A beginner exam is a
  // children's lesson, and the merged admin reading already decided an operational
  // role may see the child, the horse and the parent to call — that is what the
  // manager running the day needs. The beginner parent field therefore leaves this
  // ban. Everything the ban existed for is unchanged: no identity number, no
  // guardian record, no subgroup and no enrolment is reachable, and the assertion
  // below pins that the ONLY phone on the page is the beginner parent one, so no
  // TRAINEE contact detail can arrive behind this narrowing.
  for (const forbidden of ["identityNumber", "guardian", "subgroup", "enrollment"]) {
    assert.equal(PAGE.includes(forbidden), false, `the page renders ${forbidden}`);
  }
  for (const phone of PAGE.match(/\w*[Pp]hone\w*/g) ?? []) {
    assert.ok(/^(?:child\.)?parentPhone$/.test(phone), `a non-beginner phone is rendered: ${phone}`);
  }
});

// ===========================================================================
// 27–29. The page's query surface and bindings
// ===========================================================================

test("27. searchParams carries EXACTLY the closed twenty-five keys", () => {
  const squashed = squash(PAGE);
  const start = squashed.indexOf("searchParams: Promise<{");
  assert.ok(start > -1, "the searchParams type must be declared inline");
  const queryType = squashed.slice(start, squashed.indexOf("}>;", start) + 3);
  for (const key of [
    "createdInstructedTrainee?: string | string[];",
    "instructedTraineeError?: string | string[];",
    "instructedTraineeIssues?: string | string[];",
  ]) {
    assert.ok(queryType.includes(key), `the searchParams type is missing ${key}`);
  }
  assert.equal(
  // RE-POINTED from 23 to 24 by EX-PUB-UI-MVP, which adds ONE closed publication
  // FEEDBACK token, and from 24 to 25 by EX-PAIR-UI-MVP, which adds ONE closed
  // pairing FEEDBACK token. This slice's own three keys are pinned by name above
  // and are untouched, and the id ban below still refuses every scope-shaped key.
    // RE-POINTED from 25 to 30 by EX-ADMIN-WORKSPACE-UX: the card save's two
    // FEEDBACK tokens, the move's one, and the two ARRANGEMENT tokens.
    // RE-POINTED from 30 to 34 by EX-ADMIN-UX-FIXES (the sub-tab ORDINAL and the
    // create-form disclosure — both ARRANGEMENT) and by EX-ADMIN-SRCDATE (the
    // source-date outcome and its per-rule codes — both closed FEEDBACK). None
    // names a course, plan, session, trainee, assignment, version or date.
    (queryType.match(/\?: string \| string\[\];/g) ?? []).length,
    34,
    "the searchParams type must be the closed thirty-four-key shape",
  );
  // No id, no scope and no submitted value may become a query key...
  for (const forbidden of [
    "courseOfferingId?",
    "planId?",
    "sessionId?",
    "studentId?",
    "assignmentId?",
    "definitionId?",
    "horseName?",
    "pairingIndex?",
    "deletedInstructedTrainee?",
  ]) {
    assert.equal(queryType.includes(forbidden), false, `searchParams must not carry ${forbidden}`);
  }
  // ...and the query is still resolved exactly once, after authorization.
  assert.equal(PAGE.split("await searchParams").length - 1, 1);
  assert.ok(PAGE.includes("const query = await searchParams;"));
  assert.ok(
    PAGE.indexOf("requireAdminCourseOffering(courseOfferingId)") <
      PAGE.indexOf("await searchParams"),
    "searchParams is read before authorization",
  );
});

test("28. the three new tokens select constants and are never interpolated", () => {
  assert.ok(
    squash(PAGE).includes(
      "const { createdInstructedTrainee, instructedTraineeError, instructedTraineeIssues, } = query;",
    ),
    "the three tokens must be destructured from the one resolved query",
  );
  assert.ok(
    PAGE.includes("isExamInstructedTraineeSuccessToken(") &&
      PAGE.includes("examInstructedTraineeErrorText(") &&
      PAGE.includes("examInstructedTraineeIssueTexts("),
    "the tokens must be parsed by the closed message module",
  );
  assert.ok(PAGE.includes("{EXAM_INSTRUCTED_TRAINEE_CREATED_TEXT}"));
  // No raw token is rendered, and none reaches scope or a binding.
  for (const forbidden of [
    "{instructedTraineeError}",
    "{createdInstructedTrainee}",
    "{instructedTraineeIssues}",
    ".bind(null, createdInstructedTrainee",
    ".bind(null, query",
    "encodeURIComponent(instructedTrainee",
  ]) {
    assert.equal(PAGE.includes(forbidden), false, `the page renders or scopes with ${forbidden}`);
  }
});

test("29. the page binds EXACTLY eight actions, all to the verified context id", () => {
  // RE-POINTED — the navigation-state fix. The instructed-trainee create
  // binding moved from the single-line `.bind(null, context.id)` shape to the
  // SAME multi-line, three-argument shape `createExamAssignmentAction`,
  // `deleteExamAssignmentAction`, `updateExamAssignmentDetailsAction` and
  // `moveExamAssignmentAction` already use once `groupQuery` is known, so it no
  // longer matches the single-line `.bind(null, ` / `.bind(null, context.id)`
  // patterns below — exactly like those four already did not. The counts drop
  // by exactly one each, from the twelve a prior slice recorded, and the exact
  // three-argument shape is pinned directly further down.
  assert.equal((PAGE.match(/\.bind\(null, /g) ?? []).length, 10);
  assert.equal((PAGE.match(/\.bind\(null, context\.id\)/g) ?? []).length, 7);
  // `action=` is unaffected: it counts JSX props, not `.bind(` call shapes, and
  // this fix adds no new form and removes none.
  assert.equal((PAGE.match(/action=/g) ?? []).length, 15);
  // The binding is HOISTED, once `groupQuery` and `addAssignmentOpen` are both
  // known — alongside `boundCreateAssignmentAction`, `boundDeleteAssignmentAction`,
  // `boundUpdateExamAssignmentDetailsAction` and `boundMoveExamAssignmentAction`
  // — and NOT created inside the session loop.
  assert.ok(
    squash(PAGE).includes(
      `const boundCreateInstructedTraineeAssignmentAction = ${ACTION_NAME}.bind( null, context.id, groupQuery, addAssignmentOpen, );`,
    ),
    "the action must be bound once, hoisted, to context.id, groupQuery and addAssignmentOpen",
  );
  assert.equal(
    (PAGE.match(/const boundCreateInstructedTraineeAssignmentAction/g) ?? []).length,
    1,
    "the binding must be declared exactly once",
  );
  assert.ok(
    PAGE.indexOf("const boundCreateInstructedTraineeAssignmentAction") <
      PAGE.indexOf("day.sessions.map"),
    "the binding must be hoisted above the session loop",
  );
  // ...and it is hoisted alongside its groupQuery-dependent neighbours, AFTER
  // `groupQuery` itself is computed — never before, which is the bug this fix
  // corrects.
  assert.ok(
    PAGE.indexOf("const groupQuery =") <
      PAGE.indexOf("const boundCreateInstructedTraineeAssignmentAction"),
    "the binding must be declared after groupQuery is known",
  );
  // The page imports EXACTLY the twenty-one approved specifiers, and reaches no
  // write binding directly: all eight actions arrive through the one `./actions`.
  const specifiers = [...PAGE.matchAll(/from\s+"([^"]+)"/g)].map(([, s]) => s);
  // RE-POINTED from 21 to 24 by EX-ADMIN-WORKSPACE-UX: three route-local
  // specifiers — the examinee edit card, the closed workspace message module and
  // the PURE workspace view module. The page still reaches NO write binding
  // directly: all twelve actions arrive through the one `./actions`.
  // RE-POINTED from 24 to 26 by BLOCKER-1: the canonical timetable read and its
  // view type. The page still reaches NO write binding directly.
  // RE-POINTED from 26 to 27 by EX-ADMIN-SRCDATE: the ONE admin-facing predicate
  // that says whether this course level has beginner exams at all. The page still
  // reaches NO write binding directly.
  assert.equal(specifiers.length, 27, "the page's import surface is not twenty-seven");
  assert.ok(specifiers.includes("./CreateExamInstructedTraineeAssignmentForm"));
  assert.ok(specifiers.includes("./exam-instructed-trainee-assignment-messages"));
  for (const specifier of specifiers) {
    assert.equal(
      specifier.includes("-write" + "-io"),
      false,
      `the page imports a write binding: ${specifier}`,
    );
  }
});

// ===========================================================================
// 30–33. The closed message module
// ===========================================================================

test("30. the message module is PURE and imports nothing at all", () => {
  assert.equal(/(^|\n)\s*import\s/.test(MESSAGES), false, "the message module imports something");
  for (const token of [
    PRISMA_MODULE,
    GENERATED_CLIENT,
    "server" + "-only",
    '"use ' + 'server"',
    '"use ' + 'client"',
    "next/",
    "process" + ".env",
    "react",
  ]) {
    assert.equal(MESSAGES.includes(token), false, `the message module references ${token}`);
  }
});

test("31. both tables are FROZEN, closed, and own every sentence", () => {
  for (const table of [
    "EXAM_INSTRUCTED_TRAINEE_ERROR_TEXT",
    "EXAM_INSTRUCTED_TRAINEE_ISSUE_TEXT",
  ]) {
    assert.ok(MESSAGES.includes(`export const ${table}`), `${table} is missing`);
  }
  assert.equal(
    (MESSAGES.match(/Object\.freeze\(\{/g) ?? []).length,
    2,
    "every message table must be frozen",
  );
  const errorTable = MESSAGES.slice(
    MESSAGES.indexOf("export const EXAM_INSTRUCTED_TRAINEE_ERROR_TEXT"),
    MESSAGES.indexOf("export const EXAM_INSTRUCTED_TRAINEE_ISSUE_TEXT"),
  );
  for (const code of REFUSALS) {
    assert.ok(errorTable.includes(code), `the refusal table is missing ${code}`);
  }
  // The issue table holds EXACTLY the two codes this submission can produce. The
  // horse diagnostic is ABSENT rather than unused: this role carries no horse, the
  // form has no such field, and a table that could name one would let a future
  // edit render advice about a control that does not exist.
  const issueTable = MESSAGES.slice(MESSAGES.indexOf("export const EXAM_INSTRUCTED_TRAINEE_ISSUE_TEXT"));
  for (const code of ISSUE_CODES) {
    assert.ok(issueTable.includes(code), `the issue table is missing ${code}`);
  }
  assert.equal(
    MESSAGES.includes("EX-ASG-IN-HORSE" + "-REQUIRED"),
    false,
    "the horse diagnostic must not exist here",
  );
  for (const forbidden of ["role", "horseName", "pairingIndex", "orderIndex", "instructionTopic"]) {
    assert.equal(MESSAGES.includes(forbidden), false, `the message module names ${forbidden}`);
  }
});

test("32. the fixed Hebrew is exactly the approved wording", () => {
  assert.ok(
    MESSAGES.includes(
      'export const EXAM_INSTRUCTED_TRAINEE_CREATED_TEXT = "החניך המודרך שובץ בהצלחה.";',
    ),
    "the success sentence is not the approved one",
  );
  for (const sentence of [
    "סוג המבחן הזה אינו דורש חניך מודרך.",
    "החניך כבר משובץ ביחידת המבחן הזו.",
    "החניך אינו זמין לשיבוץ בקורס הזה.",
    "יחידת המבחן לא נמצאה.",
    "תוכנית המבחנים לא נמצאה.",
    "לא ניתן לשנות שיבוצים במצב הקורס הנוכחי.",
    "הקורס לא נמצא.",
    "לא ניתן היה לשמור את שיבוץ החניך המודרך. יש לתקן את הפרטים ולנסות שוב.",
    "לא ניתן היה לשמור את שיבוץ החניך המודרך.",
    "יש לבחור יחידת מבחן.",
    "יש לבחור חניך.",
  ]) {
    assert.ok(MESSAGES.includes(sentence), `the approved sentence is missing: ${sentence}`);
  }
  // The horse advice is nowhere in the module.
  assert.equal(MESSAGES.includes("יש להזין שם סוס."), false, "the horse advice exists here");
});

test("33. every parser is CLOSED, and no query value is ever echoed", () => {
  // Own-property lookup only, so `toString`, `constructor` and every other
  // prototype member read as unknown rather than as a message.
  assert.equal(
    (MESSAGES.match(/Object\.prototype\.hasOwnProperty\.call\(/g) ?? []).length,
    2,
    "every table lookup must be an own-property check",
  );
  // A repeated query key arrives as an ARRAY: every parser must reject a
  // non-string rather than letting `["1"]` coerce its way to a match.
  assert.equal(
    (MESSAGES.match(/typeof raw !== "string"/g) ?? []).length,
    2,
    "every parser must reject a non-string",
  );
  assert.ok(MESSAGES.includes('return typeof raw === "string" && raw === "1";'));
  // The HEADLINE parser falls back to a fixed sentence — a refusal that rendered
  // as a blank page would read as a successful save. The per-field parser DROPS
  // unknown tokens, which is what keeps arbitrary text off the page.
  assert.ok(MESSAGES.includes("UNRECOGNIZED_ERROR_TEXT"));
  assert.ok(
    MESSAGES.includes("if (code.length === 0 || seen.has(code) || !isKnownIssueCode(code))"),
  );
  // Nothing from the query reaches a returned string: there is no interpolation
  // and no concatenation of a raw token into a message anywhere in the module.
  assert.equal(MESSAGES.includes("${raw}"), false, "a raw token is interpolated into a message");
  assert.equal(MESSAGES.includes("+ raw"), false, "a raw token is concatenated into a message");
});

// ===========================================================================
// 34–38. Containment and footprint
// ===========================================================================

test("34. no file this slice added or amended names a committed exam CORE", () => {
  // The committed containment guards forbid any file under `app/` from naming an
  // exam core module — by import OR in prose, because those guards match raw
  // source text. That is why the Hebrew is spelled out route-locally.
  for (const [label, source] of [
    ["actions", ACTIONS_SOURCE],
    ["page", PAGE_SOURCE],
    ["form", FORM_SOURCE],
    ["messages", MESSAGES_SOURCE],
  ] as const) {
    for (const core of FORBIDDEN_CORES) {
      assert.equal(source.includes(core), false, `the ${label} names the core ${core}`);
    }
  }
  // Only the Server Action module reaches the committed write binding — not the
  // page, not the form, not the message module.
  assert.ok(ACTIONS.includes(WRITER_SPECIFIER));
  for (const [label, source] of [
    ["page", PAGE],
    ["form", FORM],
    ["messages", MESSAGES],
  ] as const) {
    assert.equal(source.includes(WRITER_MODULE), false, `the ${label} reaches the write binding`);
    assert.equal(source.includes(WRITER_CALL), false, `the ${label} calls the writer`);
  }
});

test("35. this slice adds NO publication, notification, pairing, wave or supervisor", () => {
  for (const [label, source] of [
    ["actions", ACTIONS],
    ["page", PAGE],
    ["form", FORM],
    ["messages", MESSAGES],
  ] as const) {
    for (const forbidden of [
      "publishExamPlan",
      "unpublishExamPlan",
      "deleteExamPlan",
      "reorderExamAssignments",
    // NOT banned in this shared list by EX-ADMIN-WORKSPACE-UX: assignment editing
    // and moving are approved endpoints of this route, and the ACTION MODULE is
    // where their committed writers are legitimately called. The PAGE is still
    // forbidden from reaching either, which is asserted separately below.
      "pairingIndex",
      "personalTime",
      // RE-POINTED by EX-ADMIN-WORKSPACE-UX. `wave` was banned as a proxy for "this
      // page derives no timetable", which is exactly what the workspace now does —
      // from the exam's own duration and capacity, in one route-local pure module,
      // reading no clock and writing nothing. The claim narrows to what it always
      // protected: no STORED wave or personal time is read, because the committed
      // readers publish neither.
      "session.wave",
      "sessionView.wave",
      "supervisor",
      "Supervisor",
      // RE-POINTED by EX-ADMIN-SRCDATE, and NARROWED to the TABLE rather than
      // relaxed. Selecting which Teaching-Practice days a plan runs as exam days is
      // now an approved endpoint of this route: nothing in the product could write
      // that selection before, so every plan held an empty one and beginner exams
      // could not appear on any screen. What must still be absent from every file
      // here is the Prisma model itself, so the route names its own endpoint and its
      // own display copy and reaches no table.
      "examTeachingPracticeSourceDate",
      "TeachingPractice",
      "capabilit",
      "Capabilit",
      "notification",
      "Notification",
      "sendPush",
      "webpush",
    ]) {
      assert.equal(source.includes(forbidden), false, `the ${label} references ${forbidden}`);
    }
  }
  // RE-POINTED by EX-ASG-LTD2-B1, and NARROWED to the three files that matter
  // rather than relaxed. The blanket ban meant "this slice's instructed-trainee
  // surface has nothing to do with the examinee's stored lesson subject", which is
  // still exactly true — the writer for this role cannot store one — and stays
  // TOTAL on the Server Action module, the client form and the message module.
  //
  // Only the PAGE may now name it, and only to READ it: it displays the value on
  // the EXAMINEE's row. It reaches no write, no FormData key and no query key
  // through it, which is why the permitted use is pinned to a single occurrence.
  //
  // RE-POINTED AGAIN by EX-ASG-LTD2-B2, and narrowed once more rather than
  // dropped. The examinee create endpoint now COLLECTS the lesson subject, so the
  // Server Action module legitimately names it — twice, as a FormData key and its
  // raw read, which the assignment suite pins exactly. What this guard is about is
  // untouched and is re-stated from the side that matters here: THIS slice's
  // instructed-trainee surface still has nothing to do with that value, so the ban
  // stays TOTAL on the client form and the message module, and the
  // instructed-trainee ACTION BODY must still never name it.
  for (const [label, source] of [
    ["form", FORM],
    ["messages", MESSAGES],
  ] as const) {
    assert.equal(
      source.includes("instructionTopic"),
      false,
      `the ${label} references instructionTopic`,
    );
  }
  assert.equal(
    actionBody(ACTIONS, "createExamInstructedTraineeAssignmentAction").includes("instructionTopic"),
    false,
    "the instructed-trainee action references instructionTopic",
  );
  // RE-POINTED by EX-ADMIN-WORKSPACE-UX, and NARROWED to what it always protected.
  // The page now also reshapes the stored value for the wave builder and hands it
  // to the examinee's edit card, which is the only way an already-assigned
  // examinee can be corrected at all. The sharp rule survives: the page still
  // never READS the value from a submission, never builds a field name from it and
  // never interpolates it into a URL, so it cannot assemble a write of its own.
  for (const forbidden of [
    'name="instructionTopic"',
    'get("instructionTopic")',
    "${examinee.instructionTopic",
  ]) {
    assert.equal(
      PAGE.includes(forbidden),
      false,
      `the page turns the detail value into ${forbidden}`,
    );
  }
  assert.ok(PAGE.includes("instructionTopic={examinee.instructionTopic}"));
  assert.ok(squash(PAGE).includes("storedDetailText( examinee.instructionTopic"));
  for (const forbidden of ['name="instructionTopic"', 'get("instructionTopic")']) {
    assert.equal(PAGE.includes(forbidden), false, `the page turns it into ${forbidden}`);
  }
  // The ONE `instructionTopic:` left on the page is the KEY of the in-memory
  // mapping that reshapes a reader row for the wave builder. It is not a write, not
  // a form field, and it names no submission.
  assert.equal((PAGE.match(/instructionTopic:/g) ?? []).length, 1);
  assert.ok(PAGE.includes("instructionTopic: row.instructionTopic,"));
});

test("36. no instructor, trainee or supervisor surface was modified", () => {
  for (const dir of [join("app", "instructor"), join("app", "student")]) {
    if (!existsSync(join(REPO_ROOT, dir))) continue;
    const touched = gitLines(["diff", "--name-only", "HEAD", "--", dir]);
    // EX-ASG-MULTIPLICITY + EX-PAIR-NO-SELF - the ONE app/student entry is a GUARD SUITE whose admin-footprint
    // snapshot this branch re-points; it is NOT a trainee/instructor surface.
    // Named EXACTLY, so any other file under these trees still fails.
    const APPROVED_TREE: Record<string, readonly string[]> = {
      "app/student": ["app/student/trainee-teaching-practice-home-shortcut" + ".contract.test.ts"],
    };
    // `dir` arrives with the PLATFORM separator, so the key is normalised first.
    assert.deepEqual(
      touched,
      APPROVED_TREE[dir.split("\\").join("/")] ?? [],
      `${dir} was modified: ${touched.join(", ")}`,
    );
  }
});

test("37. the slice touched EXACTLY its approved paths, and no schema or migration", () => {
  // Worktree, index and untracked together, so the guard describes the SLICE
  // rather than one moment in its lifecycle.
  const touched = new Set([
    ...gitLines(["diff", "--name-only", "HEAD"]),
    ...gitLines(["diff", "--name-only", "--cached", "HEAD"]),
    ...gitLines(["ls-files", "--others", "--exclude-standard"]),
  ]);
  const offenders = [...touched].filter((path) => !SLICE_PATHS.includes(path)).sort();
  assert.deepEqual(offenders, [], `an unapproved path was touched: ${offenders.join(", ")}`);

  // Every working-tree entry under `prisma/` — untracked included — is empty, so
  // no schema edit and no migration directory came with this slice.
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

  // RE-POINTED by EX-ASG-LTD2-B1 to an exact pair, and RE-POINTED AGAIN by
  // EX-ASG-LTD2-B2 back to the STRICTEST form of the claim — EMPTY.
  //
  // The pair was correct while the read slice was uncommitted in this working tree.
  // It is committed now, so those names described a moment rather than a rule, and
  // the wiring slice that followed edits no `lib/` production module at all: every
  // binding it reaches — the instructed-trainee writer, the detailed examinee
  // writer and the assignment read pair — is already committed, and the wiring
  // lives entirely under `app/`.
  // RE-POINTED by EX-PAIR-UI-MVP, back to an EXACT PAIR. That slice must display
  // a stored pairing, which is undecidable without reading the index behind it,
  // so it edits the committed ADMIN ASSIGNMENT READ pair — the pure read-shaping
  // core and its own binding — and nothing else under `lib/`. A THIRD `lib/`
  // production module, of ANY kind, still fails here: no writer, no policy core,
  // no auth module and no session module may appear.
  // RE-POINTED by EX-ADMIN-WORKSPACE-UX to the EMPTY set. The admin read pair was
  // edited by the PAIRING slice that shared this working tree; the workspace slice
  // modifies NO committed `lib/` production module at all — it only ADDS two new
  // ones, which the workspace's own suite pins by name. Any modification of a
  // committed `lib/` production module still fails here.
  const APPROVED_LIB_PRODUCTION: readonly string[] = [
    // BLOCKER-1 — the ONE committed `lib/` production module this slice modifies.
    // It gains one ADMIN-ONLY export so the admin schedule can reuse the committed
    // timetable derivation instead of reproducing it; the three existing readers
    // and every shared DTO are untouched. ASSEMBLED, so this suite does not enrol
    // itself as a caller.
    // RE-POINTED to the EMPTY set by EX-ADMIN-UX-FIXES / EX-ADMIN-SRCDATE, which
    // is the STRICTEST form of this claim rather than a relaxation. The admin-only
    // reader export belonged to the workspace slice that shared this working tree
    // and is MERGED into `main` now, so measured against the branch base it is not
    // an edit this branch makes. THIS branch modifies NO committed `lib/`
    // production module at all: it only ADDS two new ones — the pure source-date
    // decision core and its server-only binding — which the workspace suite pins
    // by name. Any modification of a committed `lib/` production module still
    // fails here.
    // EX-ASG-MULTIPLICITY + EX-PAIR-NO-SELF - the branch's 9 committed `lib/` production edits, named EXACTLY:
    // the three P2002 classifiers re-pointed at the role-scoped unique index, the
    // two pairing bindings that now read `studentId`, and the pure cores those
    // bind. Order matches the sorted git output this is compared against.
    "lib/actions/admin-exam-workspace-edit" + "-io.ts",
    "lib/actions/detailed-exam-assignment-write" + "-io.ts",
    "lib/actions/exam-assignment-write" + "-io.ts",
    "lib/actions/exam-instructed-trainee-assignment-write" + "-io.ts",
    "lib/actions/exam-pairing-write" + "-io.ts",
    "lib/exam/admin-exam-examinee-pairing" + "-core.ts",
    "lib/exam/create-exam-instructed-trainee-assignment" + "-core.ts",
    "lib/exam/exam-conflict" + "-core.ts",
    "lib/exam/exam-pairing-write" + "-core.ts",
  ];
  // RE-POINTED to the BRANCH BASE rather than to HEAD. The slice is committed
  // locally now, so `git diff HEAD` reports nothing and this guard would pass
  // vacuously; measured against the branch base it still answers exactly what it
  // was written to answer — which committed `lib/` bindings this branch edits.
  const libTouched = branchModified("lib").filter((path) => !path.endsWith(".test.ts"));
  assert.deepEqual(
    libTouched,
    APPROVED_LIB_PRODUCTION,
    `an unapproved lib binding was edited: ${libTouched.join(", ")}`,
  );

  // No dependency, environment, auth, middleware or MCP surface came with it.
  //
  // Each entry is a PATH-EXACT fragment rather than a bare word: this route's own
  // approved suites legitimately carry "session" and "auth" inside their FILE
  // NAMES, and a bare-substring ban would report `exam-session-create.contract.test.ts`
  // as an authentication change. The directories and file names below are the
  // actual surfaces, so the guard still fails on a real one.
  for (const path of touched) {
    for (const forbidden of [
      "package.json",
      "package-lock.json",
      ".env",
      ".mcp.json",
      "middleware.",
      "next.config",
      "capability-keys",
      "capabilities/",
      "permission",
      "lib/auth/",
      "lib/session",
      "migrations/",
      "prisma/",

    ]) {
      // EX-ASG-MULTIPLICITY + EX-PAIR-NO-SELF - the ONE approved schema edit and its ONE hand-written migration are
      // named EXACTLY and exempted from the two prisma bans; every OTHER prisma
      // path, and every auth/session/capability/permission path, still fails.
      const APPROVED_PRISMA = [
        "prisma/schema.prisma",
        "prisma/migrations/20260802120000_scope_exam_assignment_unique_to_examinee/",
        "prisma/migrations/20260802120000_scope_exam_assignment_unique_to_examinee/migration.sql",
      ];
      if (APPROVED_PRISMA.includes(path) && forbidden.includes("prisma")) continue;
      if (APPROVED_PRISMA.includes(path) && forbidden === "migrations/") continue;
      assert.equal(
        path.includes(forbidden),
        false,
        `the slice touched a forbidden surface: ${path}`,
      );
    }
  }
});

test("38. this suite opens no database and reads no environment", () => {
  const own = stripComments(readSource(SUITE_REL));
  for (const token of [
    PRISMA_MODULE,
    GENERATED_CLIENT,
    "process" + ".env",
    "DATABASE" + "_URL",
    "Prisma" + "Client",
  ]) {
    assert.equal(own.includes(token), false, `the suite references ${token}`);
  }
  const specifiers = [...own.matchAll(/from\s+"([^"]+)"/g)].map(([, s]) => s);
  assert.deepEqual(
    [...new Set(specifiers)].sort(),
    ["node:assert/strict", "node:child_process", "node:fs", "node:path", "node:test"],
  );
});

// ===========================================================================
// 39–44. NAVIGATION-STATE PRESERVATION — the fix this suite exists to prove
//
// Before this fix, `createExamInstructedTraineeAssignmentAction` was bound with
// ONLY `context.id` and redirected EVERY branch — success and every refusal
// alike — to the bare exams path, dropping the manager's open tab, their
// "לפי סוג"/"לפי תאריך" arrangement, the selected sub-tab and the open
// add-form disclosure. The examinee sibling `createExamAssignmentAction` never
// had this bug; these six tests prove the instructed-trainee action now shares
// its exact fix, mirroring the assertions the sibling assignment suite makes
// about its own create/removal pair.
//
// This suite is DB-free and renders nothing (see test 38 and the header), so
// "preserves the arrangement" is proven the same way every other claim in this
// file is proven: structurally, against the source the server actually runs —
// that the redirect target is BUILT FROM the one page-resolved `groupQuery`
// and `addAssignmentOpen`, never from a re-derived copy, a hardcoded default or
// the bare exams path. What the committed `groupQuery` computation itself
// encodes for each arrangement is the workspace-view module's own contract, not
// this route's; nothing here re-proves it, and nothing here opens a page.
// ===========================================================================

test("39. CREATE preserves the TYPE arrangement (\"לפי סוג\") and its selected sub-tab", () => {
  // `groupQuery` is the ONE computation every arrangement — "general", "type"
  // and "date" — flows through: the active tab and the current view always,
  // and the selected sub-tab ordinal for every non-general view, "type"
  // included. It is computed EXACTLY ONCE on the page.
  assert.ok(
    PAGE.includes('const viewQuery = `tab=${activeTab}&view=${scheduleView}`;'),
    "groupQuery must be built from the active tab and the CURRENT view, whatever it is",
  );
  assert.ok(
    squash(PAGE).includes(
      'const groupQuery = scheduleView === "general" ? viewQuery : `${viewQuery}&group=${activeSubTabIndex}`;',
    ),
    "a TYPE (or DATE) arrangement must carry the selected sub-tab ordinal in groupQuery",
  );
  assert.equal(
    (PAGE.match(/const groupQuery = /g) ?? []).length,
    1,
    "groupQuery must be computed exactly once, so a TYPE-view create cannot silently return to a different arrangement",
  );
  assert.ok(PAGE.includes('scheduleView === "type"'), "the TYPE arrangement must still exist");
  // The CREATE action is bound to that SAME variable — not a second, parallel
  // computation that could drift from it or ignore the TYPE arrangement.
  assert.ok(
    squash(PAGE).includes(
      `${ACTION_NAME}.bind( null, context.id, groupQuery, addAssignmentOpen, )`,
    ),
    "the create action must be bound to the one shared groupQuery, covering every arrangement including TYPE",
  );
});

test("40. CREATE preserves the DATE arrangement (\"לפי תאריך\") and its selected day sub-tab", () => {
  // The DATE arrangement feeds the exact SAME `groupQuery` the TYPE arrangement
  // does (proven above) — there is no second, date-only construction and no
  // date-specific carve-out anywhere in the create action's own body.
  assert.ok(PAGE.includes('scheduleView === "date"'), "the DATE arrangement must still exist");
  assert.equal(
    ACTION.includes('"type"') || ACTION.includes('"date"'),
    false,
    "the action itself must never branch on which arrangement it was opened from — groupQuery is opaque, closed content bound in from the page",
  );
  // The instructed-trainee create redirects through the SAME `backPath` family
  // every groupQuery-aware action on this route builds — proven directly in the
  // action's own body by test 14 — so a DATE-arrangement create is preserved by
  // construction rather than by a second, easily-missed code path.
  assert.ok(
    ACTION.includes("const backPath = `${examsPath}?${groupQuery}`;"),
    "the create action must build its return path from the bound groupQuery, whatever arrangement it encodes",
  );
});

test("41. REPLACE (swapping the instructed trainee an examinee teaches) preserves navigation state", () => {
  // The "replace" this route offers is the examinee card's teaching-link swap:
  // ONE coherent save that calls the committed detail writer and, when the
  // picker actually changed, the committed atomic replacement — both reached
  // through `updateExamAssignmentDetailsAction`, proven above (background) to
  // already carry `groupQuery`. This test pins that it still does, so the fix
  // to the CREATE endpoint above never regresses its already-fixed neighbour.
  const replaceAction = actionBody(ACTIONS, "updateExamAssignmentDetailsAction");
  assert.ok(
    new RegExp(
      "export async function updateExamAssignmentDetailsAction\\(\\s*courseOfferingId: string,\\s*groupQuery: string,\\s*formData: FormData,\\s*\\): Promise<void> \\{",
    ).test(ACTIONS_SOURCE),
    "the replace action's signature must still carry groupQuery",
  );
  assert.ok(
    replaceAction.includes("const backPath = `${examsPath}?${groupQuery}`;"),
    "the replace action must still build its return path from groupQuery",
  );
  // Every one of its outcome branches — the detail refusal, the pairing
  // refusal and the final honest summary — returns through that SAME backPath,
  // never the bare exams path.
  assert.equal(replaceAction.includes("?assignmentEdit="), false);
  assert.ok(replaceAction.includes("${backPath}&assignmentEdit="));
  assert.ok(
    squash(PAGE).includes(
      "const boundUpdateExamAssignmentDetailsAction = updateExamAssignmentDetailsAction.bind( null, context.id, groupQuery, );",
    ) ||
      PAGE.includes(
        "updateExamAssignmentDetailsAction.bind(null, context.id, groupQuery)",
      ),
    "the page must bind the replace action to the verified context id and the current arrangement",
  );
});

test("42. REMOVE (deleting an instructed-trainee assignment row) preserves navigation state", () => {
  // There is no role-specific instructed-trainee delete endpoint (test 26 pins
  // that directly): removal reaches the SAME role-blind `deleteExamAssignmentAction`
  // the examinee removal uses, for BOTH the unlinked instructed-trainee roster
  // and any other stored row. This test pins that shared action still carries
  // groupQuery, so an instructed-trainee removal is preserved by construction.
  const removeAction = actionBody(ACTIONS, "deleteExamAssignmentAction");
  assert.ok(
    new RegExp(
      "export async function deleteExamAssignmentAction\\(\\s*courseOfferingId: string,\\s*groupQuery: string,\\s*formData: FormData,\\s*\\): Promise<void> \\{",
    ).test(ACTIONS_SOURCE),
    "the removal action's signature must still carry groupQuery",
  );
  assert.ok(
    removeAction.includes("const backPath = `${examsPath}?${groupQuery}`;"),
    "the removal action must still build its return path from groupQuery",
  );
  assert.ok(removeAction.includes("${backPath}&deletedAssignment=1"));
  assert.equal(removeAction.includes("?deletedAssignment="), false);
  // The instructed-trainee roster's own removal button is wired to that SAME
  // hoisted binding — never a second one.
  assert.ok(
    PAGE.includes(
      "deleteExamAssignmentAction.bind(null, context.id, groupQuery)",
    ),
  );
  assert.equal(
    (PAGE.match(/deleteExamAssignmentAction\.bind\(/g) ?? []).length,
    1,
    "a second, un-fixed delete binding must not exist",
  );
});

test("43. the reopened add-form disclosure stays USABLE — the instructed-trainee form renders inside it too", () => {
  // `addAssignmentOpen` is the ONE shared disclosure both create forms render
  // behind (test 25 pins the examinee half of this); a manager who just
  // assigned an instructed trainee and lands back with the form reopened must
  // see a form that still WORKS, not a stale or half-hidden one — which is what
  // "reopened but unusable" would look like.
  assert.ok(PAGE.includes("{addAssignmentOpen && mayConfigure ? ("));
  assert.ok(PAGE.includes("{showInstructedTraineeForm ? ("));
  assert.ok(PAGE.includes("<CreateExamInstructedTraineeAssignmentForm"));
  // The instructed-trainee form sits INSIDE the disclosure block that
  // `addAssignmentOpen` gates — never outside it and never behind a second,
  // independent disclosure that this fix could leave closed.
  const disclosureBlock = PAGE.slice(
    PAGE.indexOf("{addAssignmentOpen && mayConfigure ? ("),
    PAGE.indexOf("{addAssignmentOpen && mayConfigure ? (") +
      PAGE.slice(PAGE.indexOf("{addAssignmentOpen && mayConfigure ? (")).indexOf(
        "<CreateExamInstructedTraineeAssignmentForm",
      ) +
      "<CreateExamInstructedTraineeAssignmentForm".length,
  );
  assert.ok(
    disclosureBlock.includes("<CreateExamInstructedTraineeAssignmentForm"),
    "the instructed-trainee form must be reachable from inside the addAssignmentOpen block",
  );
  // The form itself is rendered with a live, working eligible-trainee list and
  // the freshly bound action — never a stale prop the redirect could not have
  // refreshed, since the page always re-reads from the database after a
  // revalidated redirect (test 14; test 22's single-read-per-reader guard).
  assert.ok(
    squash(PAGE).includes(
      "<CreateExamInstructedTraineeAssignmentForm action={boundCreateInstructedTraineeAssignmentAction} courseOfferingId={context.id} sessionId={session.sessionId} eligibleTrainees={eligibleView.trainees} />",
    ),
  );
});

test("44. the redirect target itself carries tab, view, sub-tab ordinal and disclosure — the same property that lets the sibling create avoid a scroll", () => {
  // This app restores no pixel scroll position anywhere (there is no scroll
  // library, no ref and no `scrollIntoView` on this route or its siblings).
  // The examinee create achieves "effective" scroll preservation by returning
  // the manager to the exact tab/view/sub-tab arrangement — so the block they
  // were working in renders at the top of that arrangement instead of at the
  // top of a full, unfiltered exam day — and by reopening the add form in
  // place. This test proves the instructed-trainee create now has that SAME
  // property, by proving its redirect targets are built from the same closed
  // ingredients: `groupQuery` (which itself is `tab=...&view=...` and,
  // non-generally, `&group=...`) and, on success, `add=1`.
  for (const scrollLibrary of ["scrollIntoView", "useRef", "scrollTo(", "IntersectionObserver"]) {
    assert.equal(ACTION.includes(scrollLibrary), false, `a pixel-scroll mechanism was introduced: ${scrollLibrary}`);
  }
  assert.equal(
    ACTIONS.includes("scrollIntoView") ||
      ACTIONS.includes("IntersectionObserver") ||
      /\buseRef\b/.test(ACTIONS),
    false,
    "no pixel-scroll mechanism exists anywhere in this Server Action module",
  );
  // Every redirect target this action can produce is built from `backPath`
  // (`${examsPath}?${groupQuery}`) or, for the one refusal that is not about
  // this page, the safe course list — never the bare exams path. `groupQuery`
  // itself supplies `tab=`, `view=` and, for a TYPE or DATE arrangement,
  // `group=`; the success branch additionally supplies `add=1` whenever the
  // form the manager is using was already open.
  assert.equal(
    /`\$\{examsPath\}\?instructedTraineeError/.test(ACTION),
    false,
    "a refusal must never drop the arrangement by targeting the bare exams path",
  );
  assert.equal(
    /`\$\{examsPath\}\?createdInstructedTrainee/.test(ACTION),
    false,
    "a success must never drop the arrangement by targeting the bare exams path",
  );
  assert.ok(
    squash(ACTION).includes(
      "redirect( addAssignmentOpen ? `${backPath}&createdInstructedTrainee=1&add=1` : `${backPath}&createdInstructedTrainee=1`, );",
    ),
    "a success from an OPEN add form must carry add=1 forward, so the reopened form needs no re-scroll to find",
  );
});
