import test from "node:test";
import assert from "node:assert/strict";

/**
 * EXAM EX-ASG-UI1 — the contract of the manager-facing CREATE and REMOVAL of one
 * stored exam ASSIGNMENT, on the course-scoped admin exams route.
 *
 * Run (the bracketed route segment is a GLOB to node:test, so the `[` must be
 * escaped as `[[]` or the file silently matches nothing and zero tests run):
 *   npx tsx --test "app/admin/courses/[[]courseOfferingId]/exams/exam-assignment-ui.contract.test.ts"
 *
 * ===========================================================================
 * WHY SO MANY TOKENS IN THIS FILE ARE ASSEMBLED FROM PIECES
 * ===========================================================================
 * Several committed guards sweep every file under `app/`, `lib/` and
 * `components/` for a module name or a CALL SHAPE and pin the result to an exact
 * caller list. The two that matter most here are the assignment WRITE binding's
 * and the assignment READ binding's: before this slice both pinned their caller
 * lists at EXACTLY ZERO, and after it they pin them at exactly the one Server
 * Action module and the one page.
 *
 * A CONTRACT SUITE IS NOT A CALLER. This file asserts things ABOUT those bindings;
 * it never invokes one. But those guards match RAW SOURCE TEXT — not imports, not
 * an AST — so a suite that spelled a binding's module name, or a create/remove
 * CALL, whole anywhere in its source (INCLUDING in a comment such as this one)
 * would enrol itself in the very allow-lists it exists to keep narrow. The only
 * way to make that pass would be to widen them, which is exactly backwards. This
 * paragraph therefore describes those tokens rather than reproducing them.
 *
 * So every such token below is built by concatenation. The value compared against
 * the production source is identical; only the literal spelling in THIS file
 * differs. That is the project's split-literal convention, and it is load-bearing
 * rather than cosmetic.
 *
 * ===========================================================================
 * WHAT THIS SUITE PROVES, AND WHAT IT DELIBERATELY DOES NOT
 * ===========================================================================
 * It proves the SHAPE of the two new endpoints, their two forms, the closed
 * message module and the page wiring: the exact FormData budget, the server-bound
 * offering, the authorization order, the closed result mapping, the absence of any
 * try/catch, the single read per reader, the in-memory grouping, and the fact that
 * no id and no personal detail is ever rendered as text.
 *
 * It does NOT re-prove the writers or the readers. Whether the create assigns the
 * next order position atomically, whether the eligibility statement is one
 * fail-closed `where`, and how a unique-constraint violation is classified are all
 * the committed bindings' own contracts, proven in their own suites. Nothing in
 * this slice changed any of that, which the footprint guards assert directly.
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
const CREATE_FORM_REL = join(ROUTE_DIR_REL, "CreateExamAssignmentForm.tsx");
const DELETE_FORM_REL = join(ROUTE_DIR_REL, "DeleteExamAssignmentForm.tsx");
const MESSAGES_REL = join(ROUTE_DIR_REL, "exam-assignment-messages.ts");
const SUITE_REL = join(ROUTE_DIR_REL, "exam-assignment-ui.contract.test.ts");

/**
 * The route's EXACT final file set, after this slice's four additions.
 *
 * RE-POINTED by EX-ASG-IT2 — grown, never relaxed: three reviewed
 * instructed-trainee files (one client form, one closed message module and their
 * contract suite) joined the route, so the exact set is twenty-one. A
 * twenty-second file still fails here.
 */
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
 * The paths this slice may touch: four new route files, two amended route
 * production files, and the committed guard suites whose exact allow-lists,
 * export counts, route file counts or caller counts this slice re-points.
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
  // The four new files.
  `${ROUTE_DIR_PREFIX}CreateExamAssignmentForm.tsx`,
  `${ROUTE_DIR_PREFIX}DeleteExamAssignmentForm.tsx`,
  `${ROUTE_DIR_PREFIX}exam-assignment-messages.ts`,
  `${ROUTE_DIR_PREFIX}exam-assignment-ui.contract.test.ts`,
  // The two amended production files.
  `${ROUTE_DIR_PREFIX}actions.ts`,
  `${ROUTE_DIR_PREFIX}page.tsx`,
  // The four route guard suites whose counts this slice re-points.
  `${ROUTE_DIR_PREFIX}exam-plan-create.contract.test.ts`,
  `${ROUTE_DIR_PREFIX}exam-definition-create.contract.test.ts`,
  `${ROUTE_DIR_PREFIX}exam-definitions-page.contract.test.ts`,
  `${ROUTE_DIR_PREFIX}exam-session-create.contract.test.ts`,
  `${ROUTE_DIR_PREFIX}exam-session-edit-delete.contract.test.ts`,
  // EX-ASG-IT2's own three new route files, the sixth route guard suite it
  // re-points, and the committed Stage A caller guard it re-points.
  `${ROUTE_DIR_PREFIX}CreateExamInstructedTraineeAssignmentForm.tsx`,
  `${ROUTE_DIR_PREFIX}exam-instructed-trainee-assignment-messages.ts`,
  `${ROUTE_DIR_PREFIX}exam-instructed-trainee-assignment-ui.contract.test.ts`,
  "lib/actions/" + "exam-instructed-trainee-assignment-write" + "-io.test.ts",
  // The committed `lib/` footprint and caller guards.
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
  // the pure core's suite; all three are ASSEMBLED, and the core's two most
  // sharply of all, because the read guard sweeps `app/`, `lib/` and `components/`
  // for that core's name and must keep reporting exactly the one page.
  "lib/exam/" + "admin-exam-assignment-read" + "-core.ts",
  "lib/exam/" + "admin-exam-assignment-read" + "-core.test.ts",
  "lib/actions/" + "exam-assignment-read" + "-io.ts",
  // ...and the two committed SUPERVISOR IO footprint guards, whose "this slice
  // modified NO tracked file" claims that edit makes obsolete. Each is re-pointed
  // to an exact path list, never relaxed.
  "lib/actions/" + "exam-supervisor-read" + "-io.test.ts",
  "lib/actions/" + "exam-supervisor-write" + "-io.test.ts",
  // EX-ASG-LTD2-B2 — the DETAILED writer's own committed guard, whose caller list
  // this slice re-points from ZERO to exactly the one Server Action module.
  // ASSEMBLED, and this one most sharply of all: that guard sweeps `app/`, `lib/`
  // and `components/` for its own module name, so spelling it whole here would
  // enrol THIS suite in the very allow-list it re-points.
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
const ASSIGNMENT_WRITE_MODULE = "exam-assignment-write" + "-io";
const ASSIGNMENT_WRITE_SPECIFIER = "@/lib/actions/" + ASSIGNMENT_WRITE_MODULE;
const ASSIGNMENT_READ_MODULE = "exam-assignment-read" + "-io";
const ASSIGNMENT_READ_SPECIFIER = "@/lib/actions/" + ASSIGNMENT_READ_MODULE;
const CREATE_WRITER_CALL = "create" + "ExamAssignment" + "(";
const DELETE_WRITER_CALL = "delete" + "ExamAssignment" + "(";
/**
 * EX-ASG-LTD2-B2's writer: the committed DETAILED examinee create binding, which
 * the ONE existing create endpoint now calls in place of the three-field one.
 *
 * ASSEMBLED for the reason the header gives, and for a second one that is sharper
 * still: that binding's own committed guard pinned its caller list at EXACTLY ZERO
 * before this slice and at exactly the one Server Action module after it, and it
 * matches raw source text — so a suite that spelled the module name or the call
 * whole would enrol itself as a caller.
 */
const DETAILED_WRITE_MODULE = "detailed-exam-assignment-write" + "-io";
const DETAILED_WRITE_SPECIFIER = "@/lib/actions/" + DETAILED_WRITE_MODULE;
const DETAILED_WRITER_CALL = "create" + "DetailedExamAssignment" + "(";
const ELIGIBLE_READER_CALL = "read" + "EligibleExamTraineesForAdmin" + "(";
const ASSIGNMENT_READER_CALL = "read" + "AdminExamAssignments" + "(";
const PRISMA_MODULE = ["@/lib", "prisma"].join("/");
const GENERATED_CLIENT = ["@prisma", "client"].join("/");
/** The committed exam cores that no file under `app/` may name. */
const FORBIDDEN_CORES = [
  "exam-kind" + "-labels",
  "exam-assignment-write" + "-core",
  "create-exam-assignment" + "-core",
  "delete-exam-assignment" + "-core",
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
const CREATE_FORM_SOURCE = readSource(CREATE_FORM_REL);
const CREATE_FORM = stripComments(CREATE_FORM_SOURCE);
const DELETE_FORM_SOURCE = readSource(DELETE_FORM_REL);
const DELETE_FORM = stripComments(DELETE_FORM_SOURCE);
const MESSAGES_SOURCE = readSource(MESSAGES_REL);
const MESSAGES = stripComments(MESSAGES_SOURCE);

/**
 * ONE exported action's body, from its declaration to the next one (or to the end
 * of the file for the last). The route's seven actions share a module, so every
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

const CREATE_ACTION = actionBody(ACTIONS, "createExamAssignmentAction");
const DELETE_ACTION = actionBody(ACTIONS, "deleteExamAssignmentAction");

/**
 * The FIVE fields — and the ONLY five — the create action may read, in the ONLY
 * order it may read them.
 *
 * RE-POINTED by EX-ASG-LTD2-B2 by APPENDING the two the detailed writer collects.
 * The order is the committed detailed input core's own diagnostic order, so a
 * refusal lists its per-field advice in the sequence the form renders it. A SIXTH
 * field, and a different order, still fail here.
 */
const CREATE_FIELDS = [
  "sessionId",
  "studentId",
  "horseName",
  "instructionTopic",
  "discipline",
];

/** The three fields the create form submits UNCONDITIONALLY. */
const ALWAYS_SUBMITTED_FIELDS = ["sessionId", "studentId", "horseName"];

/** The refusal codes the create action must map, and no others. */
const CREATE_REFUSALS = [
  "invalid_input",
  "offering_not_found",
  "operation_not_allowed",
  "plan_not_found",
  "session_not_found",
  "trainee_not_eligible",
  "assignment_conflict",
  "definition_requires_unsupported_fields",
];

/** The refusal codes the removal action must map, and no others. */
const DELETE_REFUSALS = [
  "invalid_input",
  "offering_not_found",
  "operation_not_allowed",
  "plan_not_found",
  "assignment_not_found",
];

/**
 * The stable input-issue codes the message module must own.
 *
 * RE-POINTED by EX-ASG-LTD2-B2 by ADDING the detailed writer's own five — which
 * are what a fresh submission now produces — and KEEPING the legacy three, which
 * travel through the query string and can therefore still arrive from a page the
 * previous build rendered.
 */
const DETAILED_ISSUE_CODES = [
  "EX-ASG-LTD-SESSION-REQUIRED",
  "EX-ASG-LTD-STUDENT-REQUIRED",
  "EX-ASG-LTD-HORSE-REQUIRED",
  "EX-ASG-LTD-TOPIC-REQUIRED",
  "EX-ASG-LTD-DISCIPLINE-REQUIRED",
];
const LEGACY_ISSUE_CODES = [
  "EX-ASG-IN-SESSION-REQUIRED",
  "EX-ASG-IN-STUDENT-REQUIRED",
  "EX-ASG-IN-HORSE-REQUIRED",
];
const ISSUE_CODES = [...DETAILED_ISSUE_CODES, ...LEGACY_ISSUE_CODES];

// ===========================================================================
// 1–3. The route's exact file set
// ===========================================================================

test("1. the four new files exist at the exact course-scoped route", () => {
  for (const rel of [CREATE_FORM_REL, DELETE_FORM_REL, MESSAGES_REL, SUITE_REL]) {
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

test("3. no second exams route and no new write wrapper was created", () => {
  for (const dir of [
    join("app", "admin", "exams"),
    join("app", "admin", "exam-assignments"),
    join("app", "instructor", "exams"),
    join("app", "student", "exams"),
  ]) {
    assert.equal(existsSync(join(REPO_ROOT, dir)), false, `${dir} was created`);
  }
  for (const file of [
    join("lib", "actions", "exam-assignment-actions.ts"),
    join("lib", "actions", "exam-assignments.ts"),
    join("lib", "actions", "exams.ts"),
  ]) {
    assert.equal(existsSync(join(REPO_ROOT, file)), false, `${file} was created`);
  }
});

// ===========================================================================
// 4–8. The Server Actions: kind, exports, signatures and the ORDER
// ===========================================================================

test("4. the action module is still a Server Action module and nothing else", () => {
  const useServer = '"use ' + 'server"';
  const firstLine = ACTIONS_SOURCE.split("\n").find((line) => line.trim().length > 0);
  assert.ok(firstLine);
  assert.equal(firstLine.trim(), `${useServer};`, `the first line is: ${firstLine}`);
  assert.equal(ACTIONS.includes('"use ' + 'client"'), false);
  assert.equal(ACTIONS.includes("server" + "-only"), false);
});

test("5. the module exports EXACTLY the eight approved actions, in order", () => {
  const exported = [
    ...ACTIONS_SOURCE.matchAll(/export (?:async )?function (\w+)\(/g),
  ].map(([, name]) => name);
  // An EXHAUSTIVE allow-list in a FIXED order. Everything exported from a
  // "use server" module is a public network endpoint, so this list IS the attack
  // surface: no NINTH endpoint, and no helper, parser, constant or type beside
  // them.
  //
  // RE-POINTED by EX-ASG-IT2 by APPENDING one reviewed endpoint to an exhaustive,
  // ORDERED list — never by relaxing it. The seven UI1 pinned keep their exact
  // relative positions, and an unapproved ninth still fails here.
  assert.deepEqual(exported, [
    "createExamPlanAction",
    "createExamDefinitionAction",
    "createExamSessionAction",
    "updateExamSessionAction",
    "deleteExamSessionAction",
    "createExamAssignmentAction",
    "deleteExamAssignmentAction",
    "createExamInstructedTraineeAssignmentAction",
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

test("6. both new actions have the EXACT locked signature, and return void", () => {
  // RE-POINTED: both actions take a SECOND bound parameter, `groupQuery` — the
  // same closed tab/view/ordinal tail every in-view link already carries —
  // between the offering id and the submission, so the redirect can return to
  // the exact arrangement the manager was looking at. Still a closed, EXACT
  // signature.
  //
  // RE-POINTED again: the CREATE endpoint alone takes a THIRD bound parameter,
  // `addAssignmentOpen` — the same closed disclosure the page renders the form
  // from — so a manager adding several trainees in a row is not kicked out of
  // the open add form after every save. The REMOVAL endpoint has no add form to
  // reopen and keeps its two-parameter shape; a third or fourth parameter on
  // either still fails here.
  assert.ok(
    new RegExp(
      "export async function createExamAssignmentAction\\(\\s*courseOfferingId: string,\\s*groupQuery: string,\\s*addAssignmentOpen: boolean,\\s*formData: FormData,\\s*\\): Promise<void> \\{",
    ).test(ACTIONS_SOURCE),
    "createExamAssignmentAction's signature is not the locked one",
  );
  assert.ok(
    new RegExp(
      "export async function deleteExamAssignmentAction\\(\\s*courseOfferingId: string,\\s*groupQuery: string,\\s*formData: FormData,\\s*\\): Promise<void> \\{",
    ).test(ACTIONS_SOURCE),
    "deleteExamAssignmentAction's signature is not the locked one",
  );
  // No `prevState`, no options bag, no unapproved extra parameter and no
  // non-void return: every outcome is a navigation, so neither action can grow
  // client-visible state.
  for (const [label, body] of [
    ["create", CREATE_ACTION],
    ["delete", DELETE_ACTION],
  ] as const) {
    assert.equal(body.includes("prevState"), false, `the ${label} action takes prevState`);
    assert.equal(/return\s+[^;]/.test(body), false, `the ${label} action returns a value`);
  }
});

test("7. requireAdmin() is the FIRST awaited operation in BOTH new bodies", () => {
  for (const [label, body] of [
    ["create", CREATE_ACTION],
    ["delete", DELETE_ACTION],
  ] as const) {
    const firstAwait = body.indexOf("await ");
    assert.ok(firstAwait > 0, `the ${label} action awaits nothing`);
    assert.ok(
      body.slice(firstAwait).startsWith("await requireAdmin();"),
      `the ${label} action's first awaited operation is not requireAdmin()`,
    );
    // Nothing is read from the submission, and no writer is entered, BEFORE it.
    const before = body.slice(0, firstAwait);
    for (const token of [
      "formData.get",
      CREATE_WRITER_CALL,
      DETAILED_WRITER_CALL,
      DELETE_WRITER_CALL,
      "redirect(",
      "revalidatePath(",
    ]) {
      assert.equal(before.includes(token), false, `${token} runs before requireAdmin()`);
    }
  }
});

test("8. there is NO try/catch anywhere, so NEXT_REDIRECT always propagates", () => {
  // The strongest form of the rule: not "the redirect is outside the block", but
  // "there is no block". An unexpected writer failure therefore propagates rather
  // than being flattened into a query code that nobody investigates.
  for (const token of ["try {", "catch (", "catch(", "finally {"]) {
    assert.equal(ACTIONS.includes(token), false, `the action module uses ${token}`);
  }
});

// ===========================================================================
// 9–12. The exact FormData budget of each action
// ===========================================================================

test("9. the offering is the BOUND leading argument and is NEVER read from FormData", () => {
  // The id reaches each writer from the bound parameter, in the locked position.
  //
  // RE-POINTED by EX-ASG-LTD2-B2: the SAME endpoint, the SAME bound leading
  // argument and the SAME raw-forwarding shape, now against the committed DETAILED
  // writer and its five fields. The whole call is pinned as one string, so the
  // writer, the argument order and every field name are proven together.
  assert.ok(
    squash(CREATE_ACTION).includes(
      `${DETAILED_WRITER_CALL}courseOfferingId, { sessionId: formData.get("sessionId"), studentId: formData.get("studentId"), horseName: formData.get("horseName"), instructionTopic: formData.get("instructionTopic"), discipline: formData.get("discipline"), });`,
    ),
    "the create writer is not the detailed one, called with the bound id and the exact five raw fields",
  );
  assert.ok(
    squash(DELETE_ACTION).includes(
      `${DELETE_WRITER_CALL} courseOfferingId, formData.get("assignmentId"), );`,
    ),
    "the removal writer is not called with the bound id and the raw target id",
  );
  // ...and NEVER from the submission, in either action.
  for (const [label, body] of [
    ["create", CREATE_ACTION],
    ["delete", DELETE_ACTION],
  ] as const) {
    for (const forbidden of [
      'formData.get("courseOfferingId")',
      'formData.get("planId")',
      'formData.get("offeringId")',
      'formData.get("role")',
      'formData.get("orderIndex")',
      'formData.get("definitionId")',
      'formData.get("assignmentCount")',
      'formData.get("fullName")',
    ]) {
      assert.equal(body.includes(forbidden), false, `the ${label} action reads ${forbidden}`);
    }
  }
  // The page binds the VERIFIED context id, never the raw route param — and binds
  // each action EXACTLY ONCE, hoisted, so there is one place to check the id's
  // provenance no matter how many per-session controls React renders from it.
  //
  // RE-POINTED: each action now ALSO binds `groupQuery` — the same closed
  // tab/view/ordinal tail every in-view link already carries — so a create or a
  // removal redirects back to the exact arrangement it was submitted from
  // instead of always the general view. The exact bind call is still pinned
  // whole, immediately after the id, and still never the raw route param.
  //
  // RE-POINTED again: the CREATE bind ALSO carries `addAssignmentOpen` — the
  // same closed disclosure the page renders the form from — so the add form
  // stays open across a create. It is checked separately below (squashed,
  // since the fourth argument pushed the call onto several lines); the REMOVAL
  // bind is unchanged and still fits the shared loop.
  assert.ok(
    squash(PAGE).includes(
      "createExamAssignmentAction.bind( null, context.id, groupQuery, addAssignmentOpen, )",
    ),
    "the page must bind the verified context id, the current view and the add-form disclosure into createExamAssignmentAction",
  );
  assert.equal(
    (PAGE.match(/createExamAssignmentAction\.bind\(/g) ?? []).length,
    1,
    "createExamAssignmentAction must be bound exactly once",
  );
  assert.equal(
    PAGE.includes("createExamAssignmentAction.bind(null, courseOfferingId)"),
    false,
    "the raw route param must never be bound into createExamAssignmentAction",
  );
  assert.equal(
    squash(PAGE).includes("createExamAssignmentAction.bind( null, context.id, groupQuery, )"),
    false,
    "createExamAssignmentAction must not be bound WITHOUT the add-form disclosure",
  );

  for (const action of ["deleteExamAssignmentAction"]) {
    assert.ok(
      PAGE.includes(`${action}.bind(null, context.id, groupQuery)`),
      `the page must bind the verified context id and the current view into ${action}`,
    );
    assert.equal(
      (PAGE.match(new RegExp(`${action}\\.bind\\(`, "g")) ?? []).length,
      1,
      `${action} must be bound exactly once`,
    );
    assert.equal(
      PAGE.includes(`${action}.bind(null, courseOfferingId)`),
      false,
      `the raw route param must never be bound into ${action}`,
    );
    assert.equal(
      PAGE.includes(`${action}.bind(null, context.id)`),
      false,
      `${action} must not be bound WITHOUT the current view — that is the bug this re-pointing fixes`,
    );
    assert.equal(
      PAGE.includes(`${action}.bind(null, context.id, groupQuery, addAssignmentOpen)`),
      false,
      `${action} has no add form to reopen and must not bind addAssignmentOpen`,
    );
  }
});

test("10. the CREATE reads EXACTLY five named fields, in order, and nothing else", () => {
  const reads = [...CREATE_ACTION.matchAll(/formData\.get\("([^"]+)"\)/g)].map(([, f]) => f);
  assert.deepEqual(reads, CREATE_FIELDS);
  assert.equal(reads.length, 5, "the create action's FormData budget is exactly five");
  // No iteration API could smuggle a fourth field past the exact list above.
  for (const token of ["formData.entries", "formData.forEach", "formData.keys", "formData.getAll"]) {
    assert.equal(CREATE_ACTION.includes(token), false, `the create action uses ${token}`);
  }
});

test("11. the REMOVAL reads EXACTLY one field, forwarded RAW and never coerced", () => {
  const reads = [...DELETE_ACTION.matchAll(/formData\.get\("([^"]+)"\)/g)].map(([, f]) => f);
  assert.deepEqual(reads, ["assignmentId"]);
  // The committed delete core owns normalization: it accepts `unknown`, refuses
  // every non-string without probing its members, and refuses a blank one. A
  // `String(...)` here would turn a multipart `File` entry into the text
  // "[object File]" and send THAT to the database as an id; a `?? ""` would
  // manufacture a target the client never sent.
  for (const forbidden of [
    "String(formData",
    "`${formData",
    'formData.get("assignmentId") ??',
    'formData.get("assignmentId") ||',
    ".trim()",
    "Number(formData",
  ]) {
    assert.equal(DELETE_ACTION.includes(forbidden), false, `the removal coerces with ${forbidden}`);
  }
  assert.equal(
    /typeof\s+\w+\s*===\s*"string"/.test(DELETE_ACTION),
    false,
    "the removal narrows the target id instead of forwarding it raw",
  );
});

test("12. neither action coerces, defaults or trims the create's five values", () => {
  // Every one of the five is forwarded EXACTLY as FormData.get returned it — a
  // string, or null for an absent field. The committed input core defines the
  // rest, and a second copy here would be free to drift from the rule the
  // database actually sees.
  for (const forbidden of ["String(formData", "Number(formData", "`${formData", ".trim()"]) {
    assert.equal(CREATE_ACTION.includes(forbidden), false, `the create coerces with ${forbidden}`);
  }
  assert.equal(CREATE_ACTION.includes("??"), false, "the create defaults a submitted value");
});

// ===========================================================================
// 13–16. The closed outcome mapping
// ===========================================================================

test("13. the CREATE maps its closed refusal union and invents no code", () => {
  for (const code of CREATE_REFUSALS) {
    assert.ok(
      CREATE_ACTION.includes(code) || MESSAGES.includes(code),
      `the create outcome ${code} is unmapped`,
    );
  }
  // The offering not-found routes to the SAFE courses list, because an id that did
  // not resolve cannot be used to build a URL for this course-scoped route — and
  // the requested id is not reflected back in that destination.
  assert.ok(CREATE_ACTION.includes('if (result.code === "offering_not_found")'));
  assert.ok(CREATE_ACTION.includes('redirect("/admin/courses?error=invalid")'));
  // Field diagnostics travel as the writer's own CODES, joined — never a message,
  // never a submitted value.
  assert.ok(
    CREATE_ACTION.includes('const codes = result.issues.map((issue) => issue.code).join(",")'),
  );
  assert.ok(
    CREATE_ACTION.includes(
      "`${backPath}&assignmentError=invalid_input&assignmentIssues=${encodeURIComponent(codes)}`",
    ),
  );
  // Every other refusal is fully described by its code alone.
  assert.ok(
    CREATE_ACTION.includes("`${backPath}&assignmentError=${encodeURIComponent(result.code)}`"),
  );
});

test("14. the REMOVAL maps its closed refusal union and invents no code", () => {
  for (const code of DELETE_REFUSALS) {
    assert.ok(
      DELETE_ACTION.includes(code) || MESSAGES.includes(code),
      `the removal outcome ${code} is unmapped`,
    );
  }
  assert.ok(DELETE_ACTION.includes('if (result.code === "offering_not_found")'));
  assert.ok(
    DELETE_ACTION.includes(
      "`${backPath}&assignmentDeleteError=${encodeURIComponent(result.code)}`",
    ),
  );
  // A removal has no per-field diagnostics, so it carries no issues token.
  assert.equal(DELETE_ACTION.includes("Issues="), false, "the removal carries an issues token");
  assert.equal(DELETE_ACTION.includes("result.issues"), false, "the removal reads issues");
});

test("15. each action revalidates EXACTLY this exams path, BEFORE its redirect", () => {
  for (const [label, body, token] of [
    ["create", CREATE_ACTION, "createdAssignment=1"],
    ["delete", DELETE_ACTION, "deletedAssignment=1"],
  ] as const) {
    assert.ok(
      body.includes(
        "const examsPath = `/admin/courses/${encodeURIComponent(courseOfferingId)}/exams`",
      ),
      `the ${label} action must build the path from the BOUND offering id`,
    );
    assert.equal(
      (body.match(/revalidatePath\(/g) ?? []).length,
      1,
      `the ${label} action revalidates more than once`,
    );
    assert.ok(
      body.includes("revalidatePath(examsPath)"),
      `the ${label} action revalidates some other path`,
    );
    // Ordering: the cache is invalidated BEFORE the navigation, so the page the
    // manager lands on is re-read rather than served stale.
    assert.ok(
      body.indexOf("revalidatePath(examsPath)") < body.indexOf(`${token}\``),
      `the ${label} action redirects before it revalidates`,
    );
    // No other route, layout or tag is refreshed.
    for (const forbidden of ['revalidatePath("/', "revalidateTag", '"layout"', '"page"']) {
      assert.equal(body.includes(forbidden), false, `the ${label} action uses ${forbidden}`);
    }
  }
});

test("16. NO id, submitted value or raw error ever reaches the query string", () => {
  for (const [label, body] of [
    ["create", CREATE_ACTION],
    ["delete", DELETE_ACTION],
  ] as const) {
    // The success arms carry a FLAG and nothing else: the create writer returns
    // the new assignment id and its assigned position, and neither is read here.
    for (const forbidden of [
      "result.assignmentId",
      "result.orderIndex",
      "result.id",
      "error.message",
      "String(error",
      "JSON.stringify",
    ]) {
      assert.equal(body.includes(forbidden), false, `the ${label} action leaks ${forbidden}`);
    }
    // The ONLY dynamic values in any redirect target are `result.code` — a
    // compile-time-known literal from a closed set — the joined issue codes,
    // and now `backPath`/`groupQuery`: the same closed tab/view/ordinal tail
    // every in-view link already carries, bound in from the page and never
    // read from the submission. Still a CLOSED, EXACT allow-list — a database
    // id, a raw submitted value or anything else still fails here.
    //
    // RE-POINTED to ADD `backPath` and `groupQuery` — never to relax the check
    // into a pattern or a prefix match.
    const interpolations = [...body.matchAll(/\$\{([^}]+)\}/g)].map(([, expr]) => expr.trim());
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
        `the ${label} action interpolates ${expr} into a URL`,
      );
    }
  }
});

// ===========================================================================
// 17–21. The CREATE form
// ===========================================================================

test("17. the create form is a client component with EXACTLY the approved props", () => {
  assert.equal(
    CREATE_FORM_SOURCE.split("\n").find((line) => line.trim().length > 0)?.trim(),
    '"use ' + 'client";',
  );
  // RE-POINTED by EX-ASG-LTD2-B2 by ADDING exactly two BOOLEAN props — never a
  // requirements object, a definition, a definition id or a kind. Two booleans is
  // the narrowest thing that can express "render this input": the form cannot read
  // a rule it was never handed, and a SIXTH prop still fails here.
  assert.ok(
    squash(CREATE_FORM).includes(
      "export function CreateExamAssignmentForm({ action, courseOfferingId, sessionId, eligibleTrainees, requiresLessonTopic, requiresDiscipline, }: { action: (formData: FormData) => void | Promise<void>; courseOfferingId: string; sessionId: string; eligibleTrainees: readonly EligibleExamTraineeChoice[]; requiresLessonTopic: boolean; requiresDiscipline: boolean; })",
    ),
    "the create form's prop shape is not the locked one",
  );
  // The trainee option type carries TWO fields and cannot express a third.
  assert.ok(
    squash(CREATE_FORM).includes(
      "export interface EligibleExamTraineeChoice { readonly studentId: string; readonly fullName: string; }",
    ),
    "the eligible-trainee prop type is not the narrow two-field shape",
  );
  // No plan id, definition id, role, order or count may be handed to the form.
  for (const forbidden of ["planId", "definitionId", "orderIndex", "assignmentCount", "role"]) {
    assert.equal(CREATE_FORM.includes(forbidden), false, `the create form receives ${forbidden}`);
  }
});

test("18. the create form submits EXACTLY five fields, and binds no scope", () => {
  // The session travels as a HIDDEN field; the offering does NOT. Neither of the
  // two conditional fields is hidden either — a hidden topic or branch would post a
  // value the manager never saw.
  assert.ok(CREATE_FORM.includes('<input type="hidden" name="sessionId" value={sessionId} />'));
  const hidden = [...CREATE_FORM.matchAll(/type="hidden"\s+name="([^"]+)"/g)].map(([, n]) => n);
  assert.deepEqual(hidden, ["sessionId"], "the create form carries an unapproved hidden field");
  // The complete submitted field set — the same five the action reads, and no
  // sixth. RE-POINTED by EX-ASG-LTD2-B2 from three.
  const named = [...CREATE_FORM.matchAll(/\bname="([^"]+)"/g)].map(([, n]) => n).sort();
  assert.deepEqual(named, [...CREATE_FIELDS].sort());
  // The offering is bound into the ACTION on the server, never posted.
  for (const forbidden of ['name="courseOfferingId"', 'name="planId"', 'name="role"']) {
    assert.equal(CREATE_FORM.includes(forbidden), false, `the create form posts ${forbidden}`);
  }
});

test("19. the trainee picker is a NATIVE select showing ONLY the display name", () => {
  assert.ok(CREATE_FORM.includes('<select name="studentId" required defaultValue=""'));
  // The option VALUE is the opaque Student.id, and the visible text is the name
  // alone. Two trainees who share a display name therefore look identical while
  // remaining DISTINCT options, because their values differ.
  assert.ok(
    squash(CREATE_FORM).includes(
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
  ]) {
    assert.equal(CREATE_FORM.includes(forbidden), false, `the create form renders ${forbidden}`);
  }
  // No searchable-select dependency was introduced.
  const specifiers = [...CREATE_FORM.matchAll(/from\s+"([^"]+)"/g)].map(([, s]) => s);
  assert.deepEqual(specifiers, ["react-dom"]);
});

test("20. the create form has a pending state and a closed empty state", () => {
  assert.ok(CREATE_FORM.includes("const { pending } = useFormStatus();"));
  assert.ok(CREATE_FORM.includes('{pending ? "שומר..." : "שיבוץ חניך"}'));
  // With no assignable trainee the whole field set is DISABLED — a disabled
  // fieldset disables every control inside it, and disabled controls submit no
  // entry at all, so this is not merely a visual state.
  assert.ok(CREATE_FORM.includes("const hasNoTrainees = eligibleTrainees.length === 0;"));
  assert.ok(CREATE_FORM.includes("<fieldset disabled={hasNoTrainees}"));
  assert.ok(CREATE_FORM.includes("<CreateSubmitButton disabled={hasNoTrainees} />"));
  assert.ok(CREATE_FORM.includes("אין כרגע חניכים פעילים הזמינים לשיבוץ בקורס הזה."));
  // The horse is required in the markup too — a courtesy that saves a round trip,
  // never the rule, which the committed input core owns.
  assert.ok(CREATE_FORM.includes('<input type="text" name="horseName" required'));
});

test("21. neither form loads data, duplicates a rule or inserts optimistically", () => {
  for (const [label, source] of [
    ["create form", CREATE_FORM],
    ["delete form", DELETE_FORM],
  ] as const) {
    for (const forbidden of [
      "useEffect",
      "useState",
      "useOptimistic",
      "fetch(",
      "useRouter",
      "router.",
      PRISMA_MODULE,
      GENERATED_CLIENT,
      ASSIGNMENT_WRITE_MODULE,
      ASSIGNMENT_READ_MODULE,
    ]) {
      assert.equal(source.includes(forbidden), false, `the ${label} references ${forbidden}`);
    }
  }
});

// ===========================================================================
// 22–23. The REMOVAL form
// ===========================================================================

test("22. the delete form is a POST-ing form with EXACTLY the approved props", () => {
  assert.equal(
    DELETE_FORM_SOURCE.split("\n").find((line) => line.trim().length > 0)?.trim(),
    '"use ' + 'client";',
  );
  assert.ok(
    squash(DELETE_FORM).includes(
      "export function DeleteExamAssignmentForm({ action, courseOfferingId, assignmentId, }: { action: (formData: FormData) => void | Promise<void>; courseOfferingId: string; assignmentId: string; })",
    ),
    "the delete form's prop shape is not the locked one",
  );
  // ONE hidden field, and deliberately not a second: no session, plan, offering,
  // student, role or order travels with a removal.
  const hidden = [...DELETE_FORM.matchAll(/type="hidden"\s+name="([^"]+)"/g)].map(([, n]) => n);
  assert.deepEqual(hidden, ["assignmentId"]);
  const named = [...DELETE_FORM.matchAll(/\bname="([^"]+)"/g)].map(([, n]) => n);
  assert.deepEqual(named, ["assignmentId"]);
  // A removal must never be reachable by a GET: no href anywhere in the file.
  assert.equal(DELETE_FORM.includes("href"), false, "the removal is reachable by a link");
  assert.equal(DELETE_FORM.includes("<Link"), false, "the removal uses a Link");
  assert.ok(DELETE_FORM.includes("<form action={action}>"));
});

test("23. the delete form has a pending state and NO confirmation logic", () => {
  assert.ok(DELETE_FORM.includes("const { pending } = useFormStatus();"));
  assert.ok(DELETE_FORM.includes('{pending ? "מסיר..." : "הסר שיבוץ"}'));
  assert.ok(DELETE_FORM.includes("disabled={pending}"));
  // UI1 adds no confirm() and no modal — a JS confirmation is not a security
  // control, and the committed writer decides the outcome regardless.
  for (const forbidden of ["confirm(", "window.confirm", "dialog", "onSubmit", "preventDefault"]) {
    assert.equal(DELETE_FORM.includes(forbidden), false, `the delete form uses ${forbidden}`);
  }
});

// ===========================================================================
// 24–29. The page: reads, grouping and rendering
// ===========================================================================

test("24. the page reads each committed reader EXACTLY once — never per session", () => {
  assert.ok(
    PAGE.includes(ASSIGNMENT_READ_SPECIFIER),
    "the page must import the committed assignment read binding",
  );
  for (const call of [ELIGIBLE_READER_CALL, ASSIGNMENT_READER_CALL]) {
    assert.equal(
      (PAGE.match(new RegExp(call.replace(/[()]/g, "\\$&"), "g")) ?? []).length,
      1,
      `${call} is called more than once — that is an N+1 over the session list`,
    );
  }
  // Both are given the VALIDATED context id, never the raw route param.
  assert.ok(PAGE.includes(`${ELIGIBLE_READER_CALL}context.id)`));
  assert.ok(PAGE.includes(`${ASSIGNMENT_READER_CALL}context.id)`));
  for (const call of [ELIGIBLE_READER_CALL, ASSIGNMENT_READER_CALL]) {
    assert.equal(
      PAGE.includes(`${call}courseOfferingId)`),
      false,
      `${call} is given the raw route param`,
    );
  }
  // No reader is invoked from inside a render callback, which is the shape an
  // accidental per-session read would take.
  assert.equal(
    /\.map\([^)]*\)\s*=>\s*[^}]*read(Eligible|AdminExamAssignments)/.test(PAGE),
    false,
    "a reader is called from inside a map callback",
  );
});

test("25. the page groups assignments with a Map and a for...of, and never re-sorts", () => {
  // RE-POINTED by EX-ADMIN-WORKSPACE-UX: the ONE pass now fills THREE buckets
  // instead of two — examinees, instructed trainees, and the map from an examinee
  // to the ONE trainee it teaches. All three still APPEND in arrival order, which
  // is what preserves the committed reader's own total order.
  assert.ok(
    PAGE.includes("const examineesBySession = new Map<string, AdminExamAssignmentRow[]>();"),
  );
  assert.ok(
    PAGE.includes("const instructedBySession = new Map<string, AdminExamAssignmentRow[]>();"),
  );
  assert.ok(PAGE.includes("const teachesByExaminee = new Map<string, AdminExamAssignmentRow>();"));
  assert.ok(PAGE.includes("for (const assignment of assignmentView.assignments) {"));
  assert.equal(
    (PAGE.match(/for \(const assignment of assignmentView\.assignments\)/g) ?? []).length,
    1,
    "the rows are walked more than once",
  );
  for (const forbidden of [".sort(", ".reverse(", ".slice("]) {
    assert.equal(PAGE.includes(forbidden), false, `the page uses ${forbidden}`);
  }
  // RE-POINTED by EX-ADMIN-WORKSPACE-UX: `.filter(` is pinned to EXACTLY TWO uses
  // rather than banned, and NEITHER re-orders anything the reader decided. One
  // selects the instructed trainees nobody teaches yet; the other partitions the
  // day grouping's OWN timeline by its OWN stored day key.
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

});

test("26. every assignment renders under its OWN session, with every role kept", () => {
  // RE-POINTED by EX-ADMIN-WORKSPACE-UX: the ONE bucket became TWO, both keyed by
  // the SAME session id, because the workspace renders the two roles in different
  // PLACES — an examinee gets a card in its wave, and an instructed trainee travels
  // inside the examinee it teaches or, when nobody teaches it yet, in its own
  // explicitly labelled roster. Neither is ever dropped.
  assert.ok(
    PAGE.includes("examineesBySession.get(session.sessionId) ?? NO_ASSIGNMENTS"),
    "the examinee rows must be looked up by the session they belong to",
  );
  assert.ok(
    PAGE.includes("instructedBySession.get(session.sessionId) ?? NO_ASSIGNMENTS"),
    "the instructed rows must be looked up by the session they belong to",
  );
  // An INSTRUCTED_TRAINEE row this surface cannot create is still SHOWN: hiding it
  // would make a session look emptier than it is and disagree with its own count.
  assert.ok(PAGE.includes('EXAMINEE: "נבחן/ת"'));
  assert.ok(PAGE.includes('INSTRUCTED_TRAINEE: "חניך מודרך"'));
  // RE-POINTED by EX-ASG-LTD2-B1, and NARROWED to what it always protected rather
  // than relaxed. The claim was "the string `role === "EXAMINEE"` appears nowhere",
  // which was a proxy for the real rule: NO ROW MAY BE DROPPED BY ROLE. The detail
  // slice needs a per-row role test — the two stored detail values belong to the
  // examinee's row and to no other — so the proxy is replaced by the rule itself:
  //
  //   - EXACTLY ONE role comparison exists, and it is the row-level DISPLAY
  //     predicate. A second one, and any comparison against the other role, still
  //     fails here;
  //   - the list is still built by mapping EVERY bucketed row, with no filter of
  //     any kind (guard 25 pins the absence of `.filter(` for the whole page);
  //   - the predicate decides what a row SAYS. It is never the row's condition:
  //     the `<li>` and its name, horse, role label and removal control are outside
  //     it entirely.
  // RE-POINTED by EX-ADMIN-WORKSPACE-UX, and NARROWED again to the rule itself.
  // The comparison is now the BUCKETING predicate rather than a row-level display
  // test: it decides which of the two buckets a row joins, and both buckets are
  // rendered in full. It still may not gate whether a row appears at all.
  assert.equal(
    (PAGE.match(/=== "EXAMINEE"/g) ?? []).length,
    1,
    "exactly one role comparison may exist, and it is the bucketing predicate",
  );
  assert.ok(
    PAGE.includes('if (assignment.role === "EXAMINEE") {'),
    "the one role comparison must be the bucketing predicate",
  );
  // Both buckets are rendered, and the role LABEL still exists for each of them.
  assert.ok(PAGE.includes("wave.examinees.map((examinee) => {"));
  assert.ok(PAGE.includes("unlinkedInstructed.map((assignment) => ("));
  // RE-POINTED by EX-PAIR-UI-MVP, and NARROWED to an EXACT COUNT rather than
  // dropped. The ban was correct while no affordance belonged to the second
  // role. The pairing control belongs to it and to no other, so the page has to
  // ask the question exactly once — to decide what ONE row RENDERS, never
  // whether a row, its role label or its removal control appears at all, which
  // the untouched list assertions above still prove.
  // RE-POINTED to ZERO by EX-ADMIN-WORKSPACE-UX. The one branch on the second role
  // was the standalone pairing control, which moved onto the examinee's card — so
  // the page no longer asks the question at all: an instructed trainee reaches the
  // screen through the bucket it was appended to, never through a role test.
  assert.equal(
    (PAGE.match(/=== "INSTRUCTED_TRAINEE"/g) ?? []).length,
    0,
    "the page must not branch on the second role at all",
  );
  // RE-POINTED by EX-ADMIN-WORKSPACE-UX: the ONE list became TWO, and BOTH are
  // mapped in full — the examinees through their waves, the unlinked instructed
  // trainees through their own roster. No row of either role is filtered out of
  // its own list.
  assert.ok(
    PAGE.includes("{wave.examinees.map((examinee) => {"),
    "every bucketed examinee must still be mapped",
  );
  assert.ok(
    PAGE.includes("{unlinkedInstructed.map((assignment) => ("),
    "every unlinked instructed trainee must still be mapped",
  );
  assert.equal(
    /role\s*(\?|&&)\s*\(?\s*<li/.test(squash(PAGE)),
    false,
    "a role predicate must not decide whether a row is rendered",
  );
  // The empty state is a fixed sentence, not a blank block.
  assert.ok(PAGE.includes("עדיין אין חניכים משובצים ליחידת המבחן הזו."));
});

test("27. the horse placeholder is safe, and NO id or personal detail is rendered", () => {
  assert.ok(PAGE.includes('const NO_HORSE_TEXT = "—";'));
  assert.ok(
    squash(PAGE).includes(
      "return horseName === null || horseName.trim().length === 0 ? NO_HORSE_TEXT : horseName;",
    ),
    "a null or blank horse must resolve to the fixed placeholder",
  );
  // The assignment id is a React key and the removal form's hidden field; it is
  // never TEXT and never an href. The Student.id is not even selected by the
  // committed assignment reader.
  assert.ok(PAGE.includes("key={assignment.assignmentId}"));
  assert.equal(
    PAGE.includes(">{assignment.assignmentId}"),
    false,
    "the assignment id is rendered as text",
  );
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

test("28. the create form is hidden ONLY when the requirements are unknown", () => {
  // RE-POINTED by EX-ASG-LTD2-B2, and NARROWED to the one thing this gate always
  // really protected. It used to ALSO withhold the form from a definition demanding
  // a lesson topic or a branch, because the form collected neither and the writer
  // behind it refused the whole create. The form now collects both and the endpoint
  // now calls the writer that STORES them, so those two demands are ordinary fields
  // and withholding the form over them would hide the very surface this slice
  // exists to open.
  //
  // The FAIL-CLOSED case survives untouched and is now the WHOLE gate: `undefined`
  // means the session names a definition the definition reader did not report, so
  // the page cannot state what its exam demands — and a write surface must never be
  // opened on a requirement nobody can state.
  const flat = squash(PAGE);
  assert.ok(
    flat.includes("const requirementsUnknown = requirements === undefined;"),
    "the create gate is not the closed unknown-requirements test",
  );
  // The retired disjuncts are GONE, not merely reordered: neither requirement flag
  // may appear in the gate under any name.
  assert.equal(
    PAGE.includes("requiresUnsupportedFields"),
    false,
    "the retired topic/discipline gate is still present",
  );
  assert.equal(
    /requirementsUnknown\s*=[^;]*requires(LessonTopic|Discipline|InstructedTrainee)/.test(flat),
    false,
    "a definition requirement must not enter the examinee create gate",
  );
  assert.ok(PAGE.includes("לא ניתן לזהות את דרישות סוג המבחן של יחידה זו"));
  assert.equal(
    PAGE.includes("סוג מבחן זה דורש פרטים נוספים"),
    false,
    "the retired not-yet-supported sentence is still rendered",
  );
  // requiresInstructedTrainee is still deliberately NOT consulted by that gate: the
  // instructed trainee is a SECOND row written by a separate operation, and it never
  // blocks the examinee.
  // RE-POINTED by EX-ADMIN-WORKSPACE-UX, and NARROWED to the exact variable the
  // rule has always been about. `requiresInstructedTrainee` still may not enter
  // the EXAMINEE CREATE gate — asserted against that gate's own name below — but
  // it legitimately decides whether the examinee's card offers a TEACHING-LINK
  // picker, which is a different question about a different control.
  assert.equal(
    /const requirementsUnknown[\s\S]{0,120}requiresInstructedTrainee/.test(flat),
    false,
    "requiresInstructedTrainee must not gate the examinee create form",
  );
  assert.ok(
    flat.includes(
      "const showInstructedTraineeForm = requirements !== undefined && requirements.requiresInstructedTrainee;",
    ),
    "the instructed-trainee flag must have its own separate gate",
  );

  // The two flags reach the form as PROPS — read from the same already-loaded
  // definition requirements, on the branch where they are provably known.
  assert.ok(
    flat.includes(
      "requiresLessonTopic={requirements.requiresLessonTopic} requiresDiscipline={requirements.requiresDiscipline}",
    ),
    "the two requirement booleans are not passed from the loaded definition requirements",
  );
  // The requirements come from the DEFINITION reader already loaded — no second
  // query, and no widening of the session reader, which reports neither flag.
  assert.ok(PAGE.includes("for (const definition of view.definitions) {"));
  // RE-POINTED from four to FIVE by BLOCKER-1. The fifth is the CANONICAL
  // timetable read: the admin reading of the committed exam plan pipeline, which
  // is what lets this page show the derived times instead of reproducing them.
  // It is the same `loadPlan`, adapter and timetable core the instructor DTO and
  // the trainee day are built from, so no second derivation exists anywhere.
  // RE-POINTED from five to SIX by the approved beginner projection: the SIXTH is
  // the committed ADMIN READING, which is the one source of beginner rows. It is
  // the same pipeline the wave view already uses — no second query.
  assert.equal((PAGE.match(/\bread[A-Z]\w*\(/g) ?? []).length, 6, "a seventh reader entered the page");
});

test("28b. the two conditional inputs render IFF their flag, and are REQUIRED", () => {
  const flat = squash(CREATE_FORM);
  // Each input is rendered by its OWN flag and by nothing else — no `&&` chain
  // with the other, no count, no role and no kind — and each collapses to `null`
  // rather than to a hidden or disabled control, so a flag that is false submits
  // no entry at all.
  assert.ok(
    flat.includes(
      '{requiresLessonTopic ? ( <label className="flex flex-col gap-1 text-sm"> <span className="font-medium text-card-foreground">נושא הדרכה</span> <input type="text" name="instructionTopic" required className={FIELD_CLASS} /> </label> ) : null}',
    ),
    "the lesson-topic input is not rendered iff requiresLessonTopic, required",
  );
  assert.ok(
    flat.includes(
      '{requiresDiscipline ? ( <label className="flex flex-col gap-1 text-sm"> <span className="font-medium text-card-foreground">ענף</span> <input type="text" name="discipline" required className={FIELD_CLASS} /> </label> ) : null}',
    ),
    "the branch input is not rendered iff requiresDiscipline, required",
  );
  // Each flag is read EXACTLY once, in its own condition: there is no second place
  // a requirement could change what this form does.
  for (const flag of ["requiresLessonTopic", "requiresDiscipline"]) {
    assert.equal(
      (CREATE_FORM.match(new RegExp(`\\b${flag}\\b`, "g")) ?? []).length,
      3,
      `${flag} must appear exactly three times: destructured, typed and tested`,
    );
  }
  // The form holds NO rule of its own: no requirement table, no definition, no
  // kind, no role and no client-side copy of what the writer decides.
  for (const forbidden of [
    "requiresInstructedTrainee",
    "definitionKind",
    "ExamKind",
    "INTERFACE_RIDING",
    "EXAMINEE",
  ]) {
    assert.equal(CREATE_FORM.includes(forbidden), false, `the create form reaches ${forbidden}`);
  }
  // Both new inputs sit INSIDE the disabled-able fieldset, so the empty-roster
  // state still disables every control rather than only some.
  const fieldsetAt = CREATE_FORM.indexOf("<fieldset disabled={hasNoTrainees}");
  const fieldsetEnd = CREATE_FORM.indexOf("</fieldset>");
  for (const field of ["instructionTopic", "discipline"]) {
    const at = CREATE_FORM.indexOf(`name="${field}"`);
    assert.ok(at > fieldsetAt && at < fieldsetEnd, `${field} sits outside the fieldset`);
  }
});

test("29. write controls sit behind the lifecycle gate; the LIST does not", () => {
  // ONE lifecycle evaluation, and both assignment affordances hang off it — so an
  // ARCHIVED offering keeps a readable roster and gains neither control.
  assert.equal(
    (PAGE.match(/evaluateCourseOperationPolicy\(/g) ?? []).length,
    1,
    "the write gate must be evaluated exactly once",
  );
  assert.ok(PAGE.includes("<CreateExamAssignmentForm"));
  assert.ok(PAGE.includes("<DeleteExamAssignmentForm"));
  // Each control is inside a mayConfigure branch...
  const createAt = PAGE.indexOf("<CreateExamAssignmentForm");
  const deleteAt = PAGE.indexOf("<DeleteExamAssignmentForm");
  for (const [label, at] of [
    ["create", createAt],
    ["delete", deleteAt],
  ] as const) {
    assert.ok(
      PAGE.lastIndexOf("mayConfigure ?", at) > PAGE.lastIndexOf("</ul>", at),
      `the ${label} control is not behind the lifecycle gate`,
    );
  }
  // ...while the list itself is NOT: it renders from the READ gate's data.
  assert.ok(
    PAGE.indexOf("sessionAssignments.length > 0") < createAt,
    "the roster must render before, and independently of, the create affordance",
  );
  // The existing per-session edit/delete controls and their count rule survive.
  assert.ok(PAGE.includes("<ExamSessionEditForm"));
  assert.ok(PAGE.includes("<ExamSessionDeleteForm"));
  assert.ok(PAGE.includes("hasAssignments={session.assignmentCount > 0}"));
  // The session reader's COUNT stays the authority for those two decisions; the
  // assignment rows are used only to render the list.
  assert.equal(
    PAGE.includes("sessionAssignments.length > 0}"),
    false,
    "the rendered rows must not replace the authoritative assignment count",
  );
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
    "next/",
    "process" + ".env",
  ]) {
    assert.equal(MESSAGES.includes(token), false, `the message module references ${token}`);
  }
});

test("31. both refusal tables are FROZEN, closed, and own every sentence", () => {
  for (const table of [
    "EXAM_ASSIGNMENT_CREATE_ERROR_TEXT",
    "EXAM_ASSIGNMENT_DELETE_ERROR_TEXT",
    "EXAM_ASSIGNMENT_ISSUE_TEXT",
  ]) {
    assert.ok(MESSAGES.includes(`export const ${table}`), `${table} is missing`);
  }
  assert.equal(
    (MESSAGES.match(/Object\.freeze\(\{/g) ?? []).length,
    3,
    "every message table must be frozen",
  );
  // The create table holds EXACTLY the writer's own refusal codes...
  const createTable = MESSAGES.slice(
    MESSAGES.indexOf("EXAM_ASSIGNMENT_CREATE_ERROR_TEXT"),
    MESSAGES.indexOf("EXAM_ASSIGNMENT_DELETE_ERROR_TEXT"),
  );
  for (const code of CREATE_REFUSALS) {
    assert.ok(createTable.includes(code), `the create table is missing ${code}`);
  }
  // ...and the removal table exactly its own.
  const deleteTable = MESSAGES.slice(
    MESSAGES.indexOf("EXAM_ASSIGNMENT_DELETE_ERROR_TEXT"),
    MESSAGES.indexOf("EXAM_ASSIGNMENT_ISSUE_TEXT"),
  );
  for (const code of DELETE_REFUSALS) {
    assert.ok(deleteTable.includes(code), `the removal table is missing ${code}`);
  }
});

test("32. the fixed Hebrew is exactly the approved wording", () => {
  for (const sentence of [
    "שיבוץ החניך נשמר בהצלחה.",
    "השיבוץ הוסר בהצלחה.",
    "החניך כבר משובץ למבחן הזה.",
    "החניך אינו זמין לשיבוץ בקורס הזה.",
    "יחידת המבחן לא נמצאה.",
    "תוכנית המבחנים לא נמצאה.",
    "לא ניתן לשנות שיבוצים במצב הקורס הנוכחי.",
    "לא ניתן להסיר שיבוצים במצב הקורס הנוכחי.",
    "הקורס לא נמצא.",
    "לא ניתן לשבץ כאן עדיין, משום שסוג המבחן דורש פרטים נוספים.",
    "השיבוץ לא נמצא או שכבר הוסר.",
    "לא ניתן היה לזהות את השיבוץ להסרה.",
    "לא ניתן היה לשמור את השיבוץ.",
    "לא ניתן היה להסיר את השיבוץ.",
    "יש לבחור יחידת מבחן.",
    "יש לבחור חניך.",
    "יש להזין שם סוס.",
    // ADDED by EX-ASG-LTD2-B2 — the two per-field diagnostics the detailed writer
    // can now raise, in the approved wording.
    "יש להזין נושא הדרכה.",
    "יש להזין ענף.",
  ]) {
    assert.ok(MESSAGES.includes(sentence), `the approved sentence is missing: ${sentence}`);
  }
  for (const code of ISSUE_CODES) {
    assert.ok(MESSAGES.includes(code), `the issue code ${code} is unmapped`);
  }
  // Every detailed code maps to the EXACT approved sentence, pinned as a pair so a
  // code cannot quietly acquire another message.
  for (const [code, text] of [
    ["EX-ASG-LTD-SESSION-REQUIRED", "יש לבחור יחידת מבחן."],
    ["EX-ASG-LTD-STUDENT-REQUIRED", "יש לבחור חניך."],
    ["EX-ASG-LTD-HORSE-REQUIRED", "יש להזין שם סוס."],
    ["EX-ASG-LTD-TOPIC-REQUIRED", "יש להזין נושא הדרכה."],
    ["EX-ASG-LTD-DISCIPLINE-REQUIRED", "יש להזין ענף."],
  ] as const) {
    assert.ok(
      MESSAGES.includes(`"${code}": "${text}"`),
      `${code} does not map to its approved sentence`,
    );
  }
  // The issue table holds EXACTLY the eight codes and no ninth.
  const issueTable = MESSAGES.slice(MESSAGES.indexOf("EXAM_ASSIGNMENT_ISSUE_TEXT: Readonly"));
  const mapped = [...issueTable.matchAll(/"(EX-ASG-[A-Z-]+)":/g)].map(([, code]) => code);
  assert.deepEqual(mapped, ISSUE_CODES, "the issue table is not exactly the approved eight");
});

test("33. every parser is CLOSED, and no query value is ever echoed", () => {
  // Own-property lookup only, so `toString`, `constructor` and every other
  // prototype member read as unknown rather than as a message.
  assert.equal(
    (MESSAGES.match(/Object\.prototype\.hasOwnProperty\.call\(/g) ?? []).length,
    3,
    "every table lookup must be an own-property check",
  );
  // A repeated query key arrives as an ARRAY: every parser must reject a
  // non-string rather than letting `["1"]` coerce its way to a match.
  assert.equal(
    (MESSAGES.match(/typeof raw !== "string"/g) ?? []).length,
    3,
    "every parser must reject a non-string",
  );
  assert.ok(MESSAGES.includes('return typeof raw === "string" && raw === "1";'));
  // The two HEADLINE parsers fall back to a fixed sentence — a refusal that
  // rendered as a blank page would read as a successful save. The per-field parser
  // DROPS unknown tokens, which is what keeps arbitrary text off the page.
  assert.ok(MESSAGES.includes("UNRECOGNIZED_CREATE_ERROR_TEXT"));
  assert.ok(MESSAGES.includes("UNRECOGNIZED_DELETE_ERROR_TEXT"));
  assert.ok(MESSAGES.includes("if (code.length === 0 || seen.has(code) || !isKnownIssueCode(code))"));
  // Nothing from the query reaches a returned string: there is no interpolation
  // and no concatenation of a raw token into a message anywhere in the module.
  assert.equal(MESSAGES.includes("${raw}"), false, "a raw token is interpolated into a message");
  assert.equal(MESSAGES.includes("+ raw"), false, "a raw token is concatenated into a message");
});

// ===========================================================================
// 34–37. Containment and footprint
// ===========================================================================

test("34. no file this slice added or amended names a committed exam CORE", () => {
  // The committed containment guards forbid any file under `app/` from naming an
  // exam core module — by import OR in prose, because those guards match raw
  // source text. That is why the Hebrew is duplicated route-locally.
  for (const [label, source] of [
    ["actions", ACTIONS_SOURCE],
    ["page", PAGE_SOURCE],
    ["create form", CREATE_FORM_SOURCE],
    ["delete form", DELETE_FORM_SOURCE],
    ["messages", MESSAGES_SOURCE],
  ] as const) {
    for (const core of FORBIDDEN_CORES) {
      assert.equal(source.includes(core), false, `the ${label} names the core ${core}`);
    }
  }
});

test("35. no new route file reaches Prisma, a capability or a notification", () => {
  for (const [label, source] of [
    ["actions", ACTIONS],
    ["page", PAGE],
    ["create form", CREATE_FORM],
    ["delete form", DELETE_FORM],
    ["messages", MESSAGES],
  ] as const) {
    for (const forbidden of [
      PRISMA_MODULE,
      GENERATED_CLIENT,
      "examAssignment.",
      "examSession.",
      "examDefinition.",
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
  // Only the Server Action module may reach the assignment WRITE bindings — the
  // three-field one, still imported for its REMOVAL, and the DETAILED one the
  // create now calls — and only the page may reach the assignment READ binding.
  assert.ok(ACTIONS.includes(ASSIGNMENT_WRITE_SPECIFIER));
  assert.ok(
    ACTIONS.includes(DETAILED_WRITE_SPECIFIER),
    "the action module must import the detailed write binding",
  );
  assert.equal(PAGE.includes(ASSIGNMENT_WRITE_MODULE), false, "the page reaches the write binding");
  assert.equal(
    PAGE.includes(DETAILED_WRITE_MODULE),
    false,
    "the page reaches the detailed write binding",
  );
  for (const [label, source] of [
    ["create form", CREATE_FORM],
    ["delete form", DELETE_FORM],
    ["messages", MESSAGES],
  ] as const) {
    assert.equal(
      source.includes(DETAILED_WRITE_MODULE),
      false,
      `the ${label} reaches the detailed write binding`,
    );
  }
  assert.equal(
    ACTIONS.includes(ASSIGNMENT_READ_MODULE),
    false,
    "the action module reaches the read binding",
  );
});

test("36. this slice adds NO publication, notification, instructor or trainee surface", () => {
  // The bans that apply to BOTH files. `instructionTopic` left this list for the
  // PAGE only — see below — and remains forbidden everywhere a WRITE could be
  // built from it.
  const FORBIDDEN_EVERYWHERE = [
    "publishExamPlan",
    "unpublishExamPlan",
    "deleteExamPlan",
    "reorderExamAssignments",
    // NOT banned in this shared list by EX-ADMIN-WORKSPACE-UX: assignment editing
    // and moving are approved endpoints of this route, and the ACTION MODULE is
    // where their committed writers are legitimately called. The PAGE is still
    // forbidden from reaching either, which is asserted separately below.
    "INSTRUCTED_TRAINEE\"," + " role",
    "pairingIndex",
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
  ];
  for (const [label, source] of [
    ["actions", ACTIONS],
    ["page", PAGE],
  ] as const) {
    for (const forbidden of FORBIDDEN_EVERYWHERE) {
      assert.equal(source.includes(forbidden), false, `the ${label} references ${forbidden}`);
    }
  }

  // RE-POINTED by EX-ASG-LTD2-B1, and NARROWED to the file that matters rather
  // than relaxed. The blanket `instructionTopic` ban described a page that could
  // not SHOW what the detailed writer stores; showing it is exactly that slice's
  // purpose, and a value that exists but is never displayed is indistinguishable
  // from one that was never written.
  //
  // RE-POINTED AGAIN by EX-ASG-LTD2-B2, and again narrowed rather than dropped.
  // The ban on the Server Action module described an endpoint that could not
  // COLLECT the two values; collecting them is exactly this slice's purpose, and a
  // definition demanding a lesson topic was otherwise unassignable from any screen.
  //
  // What the ban always protected is re-stated as the exact shape instead: each
  // field may be read from FormData EXACTLY ONCE, as a RAW forward and nothing
  // else. No second read, no coercion, no default, no interpolation into a URL and
  // no other syntactic use may exist — so the action still cannot assemble a write
  // of its own from either value, which is the whole of what the blanket ban bought.
  // RE-POINTED from two to FOUR by EX-ADMIN-WORKSPACE-UX. The card SAVE reads and
  // forwards the SAME two fields on exactly the same terms the create endpoint
  // does — one key, one raw read, per endpoint — so the exact shape below is what
  // still holds, and a FIFTH mention of either field still fails here.
  for (const field of ["instructionTopic", "discipline"]) {
    assert.equal(
      (ACTIONS.match(new RegExp(field, "g")) ?? []).length,
      4,
      `the action module may name ${field} exactly twice per endpoint`,
    );
    assert.ok(
      ACTIONS.includes(`${field}: formData.get("${field}"),`),
      `${field} is not a raw one-line forward`,
    );
    for (const forbidden of [
      `String(formData.get("${field}")`,
      `Number(formData.get("${field}")`,
      `formData.get("${field}") ??`,
      `formData.get("${field}") ||`,
      `${field}=`,
      `\${${field}`,
    ]) {
      assert.equal(
        ACTIONS.includes(forbidden),
        false,
        `the action module turns ${field} into ${forbidden}`,
      );
    }
  }
  // ...and NEITHER value reaches the query string, on any branch.
  assert.equal(
    CREATE_ACTION.includes("assignmentIssues=${encodeURIComponent(codes)}") &&
      CREATE_ACTION.includes("instructionTopic}"),
    false,
    "a submitted detail value reaches the query string",
  );
  // RE-POINTED by EX-ADMIN-WORKSPACE-UX, and NARROWED to what it always
  // protected. The page now ALSO hands the stored value to the examinee's edit
  // card as a prop, which is the only way an already-assigned examinee can be
  // corrected at all. The rule that survives is the sharp one: the page still
  // never READS the value from a submission, never builds a field name from it and
  // never interpolates it into a URL — so it still cannot assemble a write of its
  // own, which is the whole of what the old count bought.
  assert.ok(
    squash(PAGE).includes("storedDetailText( examinee.instructionTopic"),
    "the value must go through the page's own display helper",
  );
  assert.ok(
    PAGE.includes("instructionTopic={examinee.instructionTopic}"),
    "the stored value must reach the edit card as a prop",
  );
  // The ONE `instructionTopic:` on the page is the KEY of the in-memory mapping
  // that reshapes a reader row for the wave builder. It is not a write, it is not
  // a form field, and it names no submission — which the three bans below and the
  // ban list above state from the other side.
  assert.equal((PAGE.match(/instructionTopic:/g) ?? []).length, 1);
  assert.ok(PAGE.includes("instructionTopic: row.instructionTopic,"));
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
  // The FIELD NAME the card submits belongs to the card, and to nothing else.
  const CARD = readSource(join(ROUTE_DIR_REL, "EditExamAssignmentCard.tsx"));
  assert.equal((CARD.match(/name="instructionTopic"/g) ?? []).length, 1);
  assert.equal((CARD.match(/name="discipline"/g) ?? []).length, 1);
  // No instructor, trainee or supervisor route gained an assignment surface.
  for (const dir of [
    join("app", "instructor"),
    join("app", "student"),
  ]) {
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
  // The pair was correct while the read slice was uncommitted in this working tree
  // and had to publish two more stored columns. It is committed now, so the exact
  // names described a moment rather than a rule. THIS slice edits no `lib/`
  // production module at all: the detailed writer, its core and the assignment read
  // pair are all already committed, and wiring them is done entirely under `app/`.
  //
  // What the guard always protected is therefore restored in full: no writer, no
  // reader, no core, no policy core, no auth module and no session module may
  // differ from HEAD.
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
});

// ===========================================================================
// 43–45. EX-ASG-LTD2-B2 — the detailed writer behind the ONE create endpoint
// ===========================================================================

test("43. the ONE create endpoint calls the DETAILED writer and nothing else", () => {
  // The endpoint is the SAME one: no second create action and no second bound
  // action entered the route for THIS role. (Guard 5 pins the exhaustive ordered
  // export list; these restate the count from the two other directions.)
  //
  // RE-POINTED from 8 to 9 by EX-PUB-UI-MVP, which appends ONE reviewed endpoint
  // and ONE bound form. What this guard is responsible for is that the EXAMINEE
  // create did not gain a sibling, which the assertions below still pin BY NAME;
  // the three totals move together, so a tenth export with no form — or a tenth
  // form with no export — still fails here.
  // RE-POINTED from ten to TWELVE by EX-ADMIN-WORKSPACE-UX, which appends the
  // examinee card save and the one-step examinee move. Still an EXACT count: a
  // thirteenth endpoint still fails here.
  // RE-POINTED by EX-ADMIN-SRCDATE's ONE appended endpoint — the source-date
  // replacement, which is the only way a plan can gain a Teaching-Practice day
  // and therefore the only way a beginner exam can appear anywhere at all.
  assert.equal((ACTIONS.match(/^export async function /gm) ?? []).length, 13);
  // RE-POINTED from ten to ELEVEN by EX-ADMIN-WORKSPACE-UX: it binds TWO more
  // reviewed actions and REMOVES one — the standalone pairing action, whose
  // control was absorbed into the examinee's card.
  // RE-POINTED by EX-ADMIN-SRCDATE's ONE appended endpoint — the source-date
  // replacement, which is the only way a plan can gain a Teaching-Practice day
  // and therefore the only way a beginner exam can appear anywhere at all.
  // RE-POINTED from EIGHT to SEVEN by the instructed-trainee navigation-state
  // fix: `createExamInstructedTraineeAssignmentAction` moved OUT of this bucket
  // — it used to be one of the bind sites that still took only the verified
  // offering id, dropping the manager's arrangement on every save, exactly the
  // bug `createExamAssignmentAction` never had. It now joins that sibling's own
  // bucket instead (pinned below), so this count NARROWS rather than relaxes.
  assert.equal(
    (PAGE.match(/\.bind\(null, context\.id\)/g) ?? []).length,
    7,
    "seven of the twelve ASSIGNMENT-affecting bind sites still take ONLY the verified offering id",
  );
  // RE-POINTED: the remaining FOUR — createExamAssignmentAction,
  // deleteExamAssignmentAction, updateExamAssignmentDetailsAction and
  // moveExamAssignmentAction — now ALSO bind `groupQuery`, the same closed
  // tab/view/ordinal tail every in-view link already carries, so every
  // assignment mutation returns to the exact arrangement it was submitted
  // from instead of always the general view. Twelve total, unchanged.
  //
  // RE-POINTED from four to THREE: createExamAssignmentAction moved to its own
  // FOUR-argument shape (below), which also adds `addAssignmentOpen` so the add
  // form stays open across a create. deleteExamAssignmentAction,
  // updateExamAssignmentDetailsAction and moveExamAssignmentAction still bind
  // exactly `context.id, groupQuery` — three, not four.
  assert.equal(
    (PAGE.match(/\.bind\(null, context\.id, groupQuery\)/g) ?? []).length,
    3,
    "exactly three bind sites must forward ONLY the current view",
  );
  // RE-POINTED from ONE to TWO by the instructed-trainee navigation-state fix:
  // `createExamInstructedTraineeAssignmentAction` now shares the EXACT same
  // four-argument shape as its examinee sibling `createExamAssignmentAction`,
  // for the same reason — both create forms live behind the ONE shared
  // `addAssignmentOpen` disclosure, so both must reopen it identically on
  // success.
  assert.equal(
    (squash(PAGE).match(/\.bind\( null, context\.id, groupQuery, addAssignmentOpen, \)/g) ?? [])
      .length,
    2,
    "exactly two bind sites — both create endpoints — must ALSO forward the add-form disclosure",
  );
  // `action=` counts TWO for the publication card, because its two mutually
  // exclusive forms are written out separately so each can carry a LITERAL hidden
  // operation value rather than a computed one.
  // RE-POINTED from 10 to 11 by EX-PAIR-UI-MVP: ONE more inline form, bound to
  // the SAME verified context id, which the `.bind` count above pins.
  // RE-POINTED from eleven to FOURTEEN by EX-ADMIN-WORKSPACE-UX: the pairing form
  // left the page (-1); the two one-step move forms arrived (+2); the examinee edit
  // card arrived (+1); and the role-blind REMOVAL control is now rendered from TWO
  // places (+1), because an instructed trainee no longer has a card of its own to
  // carry it.
  // RE-POINTED by EX-ADMIN-SRCDATE's ONE appended endpoint — the source-date
  // replacement, which is the only way a plan can gain a Teaching-Practice day
  // and therefore the only way a beginner exam can appear anywhere at all.
  assert.equal((PAGE.match(/action=/g) ?? []).length, 15);

  // The create action reaches the DETAILED writer EXACTLY ONCE...
  assert.equal(
    (CREATE_ACTION.match(new RegExp(DETAILED_WRITER_CALL.replace(/[()]/g, "\\$&"), "g")) ?? [])
      .length,
    1,
    "the create action must call the detailed writer exactly once",
  );
  // ...and the THREE-FIELD create writer is not reached from ANY action body. It
  // is the committed sibling of the removal writer and lives in the same module,
  // so the import alone cannot prove this — the CALL SHAPE can.
  assert.equal(
    ACTIONS.includes(CREATE_WRITER_CALL),
    false,
    "the ordinary three-field create writer still has a production caller",
  );
  // The removal is untouched: still the ordinary, role-blind writer.
  assert.ok(DELETE_ACTION.includes(DELETE_WRITER_CALL));
  assert.equal(
    DELETE_ACTION.includes(DETAILED_WRITER_CALL),
    false,
    "the removal must not reach the detailed writer",
  );
  // The instructed-trainee endpoint is untouched and independent: its own writer,
  // its own two fields, its own token family — and no detail field at all.
  const instructed = actionBody(ACTIONS, "createExamInstructedTraineeAssignmentAction");
  assert.equal(instructed.includes(DETAILED_WRITER_CALL), false);
  assert.equal(instructed.includes(CREATE_WRITER_CALL), false);
  assert.deepEqual(
    [...instructed.matchAll(/formData\.get\("([^"]+)"\)/g)].map(([, f]) => f),
    ["sessionId", "studentId"],
  );
  assert.ok(instructed.includes("instructedTraineeError="));
});

test("44. NO client input selects the writer, and no discriminator exists", () => {
  // The writer is a compile-time-known identifier in the source of ONE function.
  // Nothing read from the submission, the query string or a prop can change which
  // one runs: there is no conditional call, no lookup table and no field whose
  // value names an operation.
  assert.equal(
    /(if|\?|&&|\|\|)[^;]{0,120}create(Detailed)?ExamAssignment\s*\(/.test(squash(CREATE_ACTION)),
    false,
    "the writer is chosen conditionally",
  );
  for (const forbidden of [
    'formData.get("mode")',
    'formData.get("detailed")',
    'formData.get("writer")',
    'formData.get("kind")',
    'formData.get("variant")',
    'formData.get("requiresLessonTopic")',
    'formData.get("requiresDiscipline")',
    'formData.get("requiresInstructedTrainee")',
  ]) {
    assert.equal(
      CREATE_ACTION.includes(forbidden),
      false,
      `the create action lets the client supply ${forbidden}`,
    );
  }
  // The form posts no such field either, and carries no flag of its own.
  const named = [...CREATE_FORM.matchAll(/\bname="([^"]+)"/g)].map(([, n]) => n);
  for (const field of named) {
    assert.ok(CREATE_FIELDS.includes(field), `the form posts an unapproved field: ${field}`);
  }
  for (const forbidden of ['name="mode"', 'name="detailed"', 'name="requiresLessonTopic"']) {
    assert.equal(CREATE_FORM.includes(forbidden), false, `the create form posts ${forbidden}`);
  }
  // The three ALWAYS-submitted fields are still unconditional markup — only the
  // two new ones are behind a flag.
  for (const field of ALWAYS_SUBMITTED_FIELDS) {
    assert.ok(CREATE_FORM.includes(`name="${field}"`), `${field} left the form`);
  }
  assert.equal(
    /requires(LessonTopic|Discipline)[\s\S]{0,80}name="(sessionId|studentId|horseName)"/.test(
      squash(CREATE_FORM),
    ),
    false,
    "an always-submitted field was put behind a requirement flag",
  );
});

test("45. this slice adds no route, no query key, no schema and no capability", () => {
  // The route gained no file...
  const routeFiles = [
    ...new Set([
      ...gitLines(["ls-files"]),
      ...gitLines(["ls-files", "--others", "--exclude-standard"]),
    ]),
  ]
    .filter((path) => path.startsWith(ROUTE_DIR_PREFIX))
    .sort();
  assert.deepEqual(routeFiles, FINAL_ROUTE_FILES, "the route file set changed");

  // ...and no query key. The examinee family is unchanged: the same success token,
  // the same headline token and the same issues token carry the new writer's codes.
  const squashed = squash(PAGE);
  const queryStart = squashed.indexOf("searchParams: Promise<{");
  const queryType = squashed.slice(queryStart, squashed.indexOf("}>;", queryStart) + 3);
  // RE-POINTED from 23 to 24 by EX-PUB-UI-MVP, which adds ONE closed publication
  // FEEDBACK token and nothing else. The existing families are untouched, and the
  // new key carries no id, no submitted value and no scope.
  // RE-POINTED from 24 to 25 by EX-PAIR-UI-MVP: ONE closed pairing FEEDBACK
  // token, which names no course, plan, session, trainee, assignment or version,
  // and from which nothing derives scope, state or a selection.
  // RE-POINTED from 25 to 30 by EX-ADMIN-WORKSPACE-UX: the card save's two
  // FEEDBACK tokens, the move's one, and the two ARRANGEMENT tokens. None names a
  // course, plan, session, trainee, assignment or version, and nothing derives
  // scope or state from any of them.
  // RE-POINTED by EX-ADMIN-UX-FIXES (two ARRANGEMENT keys: the sub-tab ORDINAL
  // and the create-form disclosure) and by EX-ADMIN-SRCDATE (two closed FEEDBACK
  // keys). None names a course, plan, session, trainee, assignment, version or
  // date, and nothing derives scope or state from any of them.
  assert.equal((queryType.match(/\?: string \| string\[\];/g) ?? []).length, 34);
  for (const forbidden of ["instructionTopic?", "discipline?", "detailedAssignment"]) {
    assert.equal(queryType.includes(forbidden), false, `searchParams gained ${forbidden}`);
  }
  for (const token of ["createdAssignment=1", "assignmentError=", "assignmentIssues="]) {
    assert.ok(CREATE_ACTION.includes(token), `the create endpoint dropped ${token}`);
  }

  // Nothing this slice touched reaches a schema, a capability, a notification, a
  // publication or an auth/session module. (Guard 35 pins Prisma and the accessor
  // spellings for the same five files.)
  for (const [label, source] of [
    ["actions", ACTIONS],
    ["page", PAGE],
    ["create form", CREATE_FORM],
    ["messages", MESSAGES],
  ] as const) {
    for (const forbidden of [
      "schema" + ".prisma",
      "migrat",
      "capabilit",
      "Capabilit",
      "notification",
      "publishExamPlan",
      "individualPublishedAt",
      "@/lib/auth/session",
      "cookies(",
      "process" + ".env",
    ]) {
      assert.equal(source.includes(forbidden), false, `the ${label} references ${forbidden}`);
    }
  }
  // The one auth import the actions legitimately keep is the admin boundary, and
  // it is still the first awaited call of every body (guard 7). The IMPORT KEYWORD
  // is split: guard 38 below extracts every `from "…"` occurrence in THIS file and
  // pins the result to five node: builtins, so spelling it whole here would enrol
  // the expectation as an import of its own.
  assert.ok(ACTIONS.includes("fr" + 'om "@/lib/auth/require-admin"'));
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
// 39–42. EX-ASG-LTD2-B1 — the stored DETAIL values on the assignment row
// ===========================================================================

test("39. the two stored detail values are DISPLAYED, verbatim and text-only", () => {
  // The labels are this route's own constants, so a stored value can never supply
  // one — it can only follow one.
  assert.ok(PAGE.includes('const INSTRUCTION_TOPIC_LABEL = "נושא הדרכה";'));
  assert.ok(PAGE.includes('const DISCIPLINE_LABEL = "ענף";'));
  // The retired wording must not come back as a VALUE label. (The DEFINITION facts
  // above legitimately keep their own requirement-flag wording; these two
  // assertions are about the value labels this slice introduces.)
  assert.equal(PAGE.includes('= "נושא שיעור"'), false, "the retired topic label came back");
  assert.equal(PAGE.includes('= "דיסציפלינה"'), false, "the retired branch label came back");

  // Each value is rendered as an ordinary React text node, inside a plain span,
  // straight from the reader — no formatter, no interpolation into an attribute
  // and no raw-HTML path anywhere on the page.
  const flat = squash(PAGE);
  assert.ok(flat.includes("{INSTRUCTION_TOPIC_LABEL}: {topicText}"));
  assert.ok(flat.includes("{DISCIPLINE_LABEL}: {disciplineText}"));
  for (const forbidden of [
    "dangerouslySetInnerHTML",
    "innerHTML",
    "__html",
    `${"eval"}(`,
    "new Function",
  ]) {
    assert.equal(PAGE.includes(forbidden), false, `the page renders through ${forbidden}`);
  }

  // The presence test is the horse's, and what is RETURNED is the untrimmed stored
  // string: the page decides whether to show a value, never what it says.
  assert.ok(
    flat.includes(
      "function storedDetailText(value: string | null): string | null { return value === null || value.trim().length === 0 ? null : value; }",
    ),
    "the display helper must not rewrite the stored value",
  );
});

test("40. the detail values are shown for the EXAMINEE row only", () => {
  const flat = squash(PAGE);
  // Both value lines hang off the SAME single role predicate, and each also
  // requires something to have been stored.
  // RE-POINTED by EX-ADMIN-WORKSPACE-UX. The two values are now shown inside the
  // EXAMINEE's own card, so the role is a property of WHERE they render rather
  // than a conjunct beside them — which is a stronger form of the same rule: an
  // instructed trainee has no card to carry them at all.
  assert.ok(flat.includes("{INSTRUCTION_TOPIC_LABEL}: {topicText}"));
  assert.ok(flat.includes("{DISCIPLINE_LABEL}: {disciplineText}"));
  assert.ok(flat.includes("{topicText !== null ? ("));
  assert.ok(flat.includes("{disciplineText !== null ? ("));
  // The INSTRUCTED_TRAINEE row keeps everything it had — name, horse, role label
  // and the ONE removal control — and gains neither value line: those are outside
  // the predicate entirely.
  assert.ok(flat.includes("{roleText(assignment.role)}"));
  assert.ok(flat.includes("{roleText(\"EXAMINEE\")}"));
  assert.ok(flat.includes("סוס: {horseText(examinee.horseName)}"));
  // RE-POINTED from one to TWO by EX-ADMIN-WORKSPACE-UX: the role-blind removal
  // control is rendered from two places now — once on an examinee card, and once
  // in the unlinked instructed-trainee roster — because a trainee no longer has a
  // card of its own to carry it. It is the SAME control, bound to the SAME hoisted
  // action, and it still reaches a row of EITHER role.
  assert.equal(
    (PAGE.match(/<DeleteExamAssignmentForm/g) ?? []).length,
    2,
    "the role-blind removal control was lost or duplicated",
  );
  // A null value is NOT rendered as an ordinary value row: there is no placeholder
  // constant for either detail, and neither label may be emitted unconditionally.
  assert.equal(
    /\{INSTRUCTION_TOPIC_LABEL\}: \{(examinee\.instructionTopic|NO_)/.test(flat),
    false,
    "an absent topic is rendered as a value row",
  );
  assert.equal(
    /\{DISCIPLINE_LABEL\}: \{(examinee\.discipline|NO_)/.test(flat),
    false,
    "an absent branch is rendered as a value row",
  );
});

test("41. a MISSING required value is a fixed diagnostic that FAILS CLOSED", () => {
  const flat = squash(PAGE);
  assert.ok(
    PAGE.includes('const MISSING_INSTRUCTION_TOPIC_TEXT = "חסר נושא הדרכה בשיבוץ ההיסטורי הזה.";'),
  );
  assert.ok(PAGE.includes('const MISSING_DISCIPLINE_TEXT = "חסר ענף בשיבוץ ההיסטורי הזה.";'));

  // Each diagnostic is the SAME closed four-part test: the examinee role, KNOWN
  // requirements, the requirement itself, and nothing stored. `requirements !==
  // undefined` is a conjunct in both, so an unresolvable definition emits NEITHER
  // warning — the page never invents what an exam demanded.
  assert.ok(
    flat.includes(
      // RE-POINTED by EX-ADMIN-WORKSPACE-UX: the role conjunct is GONE because the
      // diagnostic is now rendered only inside an EXAMINEE's card — the role is a
      // property of WHERE the test runs rather than a term inside it. The
      // fail-closed conjunct that actually matters is untouched.
      "const missingTopic = requirements !== undefined && requirements.requiresLessonTopic && topicText === null;",
    ),
    "the topic diagnostic is not the closed fail-closed test",
  );
  assert.ok(
    flat.includes(
      "const missingDiscipline = requirements !== undefined && requirements.requiresDiscipline && disciplineText === null;",
    ),
    "the branch diagnostic is not the closed fail-closed test",
  );
  // The requirements come from the definition reader the page already loaded — no
  // second reader and no second query came with the diagnostics.
  assert.ok(PAGE.includes("for (const definition of view.definitions) {"));
  // RE-POINTED from four to FIVE by BLOCKER-1. The fifth is the CANONICAL
  // timetable read: the admin reading of the committed exam plan pipeline, which
  // is what lets this page show the derived times instead of reproducing them.
  // It is the same `loadPlan`, adapter and timetable core the instructor DTO and
  // the trainee day are built from, so no second derivation exists anywhere.
  // RE-POINTED from five to SIX by the approved beginner projection: the SIXTH is
  // the committed ADMIN READING, which is the one source of beginner rows. It is
  // the same pipeline the wave view already uses — no second query.
  assert.equal((PAGE.match(/\bread[A-Z]\w*\(/g) ?? []).length, 6, "a seventh reader entered the page");

  // Rendering is NOT blocked by either diagnostic: both are siblings of the value
  // spans inside the same row, never a wrapper around the row or an early return.
  // RE-POINTED by EX-ADMIN-WORKSPACE-UX: each diagnostic is now a paragraph in the
  // examinee's card rather than an inline span in a flat row. The claim is
  // unchanged and is the one that matters — neither wraps the row, and neither can
  // stop it rendering.
  assert.ok(flat.includes("{missingTopic ? ( <p"));
  assert.ok(flat.includes("{missingDiscipline ? ( <p"));
  assert.equal(/missingTopic\s*(\?|&&)\s*\(?\s*<li/.test(flat), false, "a diagnostic hides the row");
});

test("42. the diagnostics add NO write, no route, no query key and no client state", () => {
  // Not one affordance came with the DIAGNOSTICS: no control, no handler, no
  // state. Every CLIENT-BEHAVIOUR token stays absolutely forbidden — EX-PUB-UI-MVP
  // weakens none of them, because its publication form needs no client code at all.
  for (const forbidden of [
    "<textarea",
    "onClick",
    "onSubmit",
    "onChange",
    "useState",
    "useTransition",
    "useEffect",
    '"use client"',
  ]) {
    assert.equal(PAGE.includes(forbidden), false, `the page renders ${forbidden}`);
  }
  // The MARKUP tokens leave the blanket ban and become an exact INVENTORY, because
  // EX-PUB-UI-MVP renders its publication form inline. An inventory is stronger
  // than the ban was: a third form or a stray control still fails, and the two
  // hidden inputs are pinned to their two literal values by the page's own suite.
  // What matters HERE is that the diagnostic ROWS gained none of them — all four
  // counts belong to the publication card alone, which sits outside the session
  // list entirely.
  // RE-POINTED from two to THREE by EX-PAIR-UI-MVP, which renders its pairing
  // control INLINE for the same reason the publication one is: fixed values, no
  // pending UX, no validation and no confirmation. An inventory stays stronger
  // than a ban: a FOURTH form, button or input still fails here.
  // RE-POINTED from three to FOUR by EX-ADMIN-WORKSPACE-UX: the pairing form left
  // the page with its control (-1) and the two one-step ORDER controls arrived
  // (+2). What matters HERE is unchanged — the diagnostic rows gained none of
  // them, and every count belongs to the publication card or to an order control.
  // RE-POINTED by EX-ADMIN-SRCDATE, which renders its source-date control INLINE
  // for exactly the reason the publication and move controls are: fixed field
  // names, no pending UX, no client validation and no confirmation. An inventory
  // stays strictly stronger than a ban.
  assert.equal((PAGE.match(/<form/g) ?? []).length, 5);
  // RE-POINTED by EX-ADMIN-SRCDATE, which renders its source-date control INLINE
  // for exactly the reason the publication and move controls are: fixed field
  // names, no pending UX, no client validation and no confirmation. An inventory
  // stays strictly stronger than a ban.
  assert.equal((PAGE.match(/<button/g) ?? []).length, 5);
  // RE-POINTED from two to THREE by EX-PAIR-UI-MVP: the pairing form carries ONE
  // hidden field naming the instructed-trainee row it belongs to. A FOURTH still
  // fails, and the two `name="operation"` inputs are pinned separately below.
  // RE-POINTED from three to SIX: two hidden publication operations, and two per
  // move form — the assignment it acts on and a fixed direction literal.
  // RE-POINTED by EX-ADMIN-SRCDATE, which renders its source-date control INLINE
  // for exactly the reason the publication and move controls are: fixed field
  // names, no pending UX, no client validation and no confirmation. An inventory
  // stays strictly stronger than a ban.
  assert.equal((PAGE.match(/<input/g) ?? []).length, 8);
  assert.equal((PAGE.match(/name="direction"/g) ?? []).length, 2);
  // RE-POINTED to ZERO: the one inline picker this page held was the pairing one,
  // and it moved to the examinee's card with its control.
  assert.equal((PAGE.match(/<select/g) ?? []).length, 0, "no inline picker may exist");
  assert.equal((PAGE.match(/name="operation"/g) ?? []).length, 2);
  // RE-POINTED from ten to ELEVEN by EX-ADMIN-WORKSPACE-UX: it binds TWO more
  // reviewed actions and REMOVES one — the standalone pairing action, whose
  // control was absorbed into the examinee's card.
  // RE-POINTED by EX-ADMIN-SRCDATE's ONE appended endpoint — the source-date
  // replacement, which is the only way a plan can gain a Teaching-Practice day
  // and therefore the only way a beginner exam can appear anywhere at all.
  // RE-POINTED from EIGHT to SEVEN by the instructed-trainee navigation-state
  // fix: `createExamInstructedTraineeAssignmentAction` moved OUT of this bucket
  // — it used to be one of the bind sites that still took only the verified
  // offering id, dropping the manager's arrangement on every save, exactly the
  // bug `createExamAssignmentAction` never had. It now joins that sibling's own
  // bucket instead (pinned below), so this count NARROWS rather than relaxes.
  assert.equal(
    (PAGE.match(/\.bind\(null, context\.id\)/g) ?? []).length,
    7,
    "seven of the twelve ASSIGNMENT-affecting bind sites still take ONLY the verified offering id",
  );
  // RE-POINTED: the remaining FOUR — createExamAssignmentAction,
  // deleteExamAssignmentAction, updateExamAssignmentDetailsAction and
  // moveExamAssignmentAction — now ALSO bind `groupQuery`, the same closed
  // tab/view/ordinal tail every in-view link already carries, so every
  // assignment mutation returns to the exact arrangement it was submitted
  // from instead of always the general view. Twelve total, unchanged.
  //
  // RE-POINTED from four to THREE: createExamAssignmentAction moved to its own
  // FOUR-argument shape (below), which also adds `addAssignmentOpen` so the add
  // form stays open across a create. deleteExamAssignmentAction,
  // updateExamAssignmentDetailsAction and moveExamAssignmentAction still bind
  // exactly `context.id, groupQuery` — three, not four.
  assert.equal(
    (PAGE.match(/\.bind\(null, context\.id, groupQuery\)/g) ?? []).length,
    3,
    "exactly three bind sites must forward ONLY the current view",
  );
  // RE-POINTED from ONE to TWO by the instructed-trainee navigation-state fix:
  // `createExamInstructedTraineeAssignmentAction` now shares the EXACT same
  // four-argument shape as its examinee sibling `createExamAssignmentAction`,
  // for the same reason — both create forms live behind the ONE shared
  // `addAssignmentOpen` disclosure, so both must reopen it identically on
  // success.
  assert.equal(
    (squash(PAGE).match(/\.bind\( null, context\.id, groupQuery, addAssignmentOpen, \)/g) ?? [])
      .length,
    2,
    "exactly two bind sites — both create endpoints — must ALSO forward the add-form disclosure",
  );
  // RE-POINTED from 10 to 11 by EX-PAIR-UI-MVP: ONE more inline form, bound to
  // the SAME verified context id, which the `.bind` count above pins.
  // RE-POINTED from eleven to FOURTEEN by EX-ADMIN-WORKSPACE-UX: the pairing form
  // left the page (-1); the two move forms arrived (+2); the examinee edit card
  // arrived (+1); and the role-blind removal control is rendered from two places
  // now (+1).
  // RE-POINTED by EX-ADMIN-SRCDATE's ONE appended endpoint — the source-date
  // replacement, which is the only way a plan can gain a Teaching-Practice day
  // and therefore the only way a beginner exam can appear anywhere at all.
  assert.equal((PAGE.match(/action=/g) ?? []).length, 15);

  // No new query key, and the query is still resolved once.
  const squashed = squash(PAGE);
  const queryStart = squashed.indexOf("searchParams: Promise<{");
  assert.ok(queryStart > -1, "the searchParams type must be declared inline");
  const queryType = squashed.slice(queryStart, squashed.indexOf("}>;", queryStart) + 3);
  // RE-POINTED from 23 to 24 by EX-PUB-UI-MVP, which adds ONE closed publication
  // FEEDBACK token and nothing else. The existing families are untouched, and the
  // new key carries no id, no submitted value and no scope.
  // RE-POINTED from 24 to 25 by EX-PAIR-UI-MVP: ONE closed pairing FEEDBACK
  // token, which names no course, plan, session, trainee, assignment or version,
  // and from which nothing derives scope, state or a selection.
  // RE-POINTED from 25 to 30 by EX-ADMIN-WORKSPACE-UX: the card save's two
  // FEEDBACK tokens, the move's one, and the two ARRANGEMENT tokens. None names a
  // course, plan, session, trainee, assignment or version, and nothing derives
  // scope or state from any of them.
  // RE-POINTED by EX-ADMIN-UX-FIXES (two ARRANGEMENT keys: the sub-tab ORDINAL
  // and the create-form disclosure) and by EX-ADMIN-SRCDATE (two closed FEEDBACK
  // keys). None names a course, plan, session, trainee, assignment, version or
  // date, and nothing derives scope or state from any of them.
  assert.equal((queryType.match(/\?: string \| string\[\];/g) ?? []).length, 34);
  for (const forbidden of ["instructionTopic?", "discipline?", "missingTopic?", "assignmentId?"]) {
    assert.equal(queryType.includes(forbidden), false, `searchParams gained ${forbidden}`);
  }

  // The route gained no file, and its Server Action module gained no export.
  const routeFiles = [
    ...new Set([
      ...gitLines(["ls-files"]),
      ...gitLines(["ls-files", "--others", "--exclude-standard"]),
    ]),
  ]
    .filter((path) => path.startsWith(ROUTE_DIR_PREFIX))
    .sort();
  assert.deepEqual(routeFiles, FINAL_ROUTE_FILES, "the route file set changed");
  assert.equal(
  // RE-POINTED from 8 to 9 by EX-PUB-UI-MVP and from 9 to 10 by EX-PAIR-UI-MVP,
  // each of which appends ONE reviewed endpoint. What this guard owns is that the
  // ASSIGNMENT slice added none, and the exhaustive ordered export list at guard 5
  // is what pins which ten exist.
    (ACTIONS.match(/^export async function /gm) ?? []).length,
    // RE-POINTED from twelve to THIRTEEN by EX-ADMIN-SRCDATE's ONE appended
    // endpoint. What THIS guard owns is unchanged: the ASSIGNMENT slice added
    // none, and the exhaustive ordered export list at guard 5 pins which exist.
    13,
    "the action module gained an export",
  );
});

// ===========================================================================
// 46–47. A create or a removal redirects back into the EXACT arrangement it
// was submitted from, never always the general view
// ===========================================================================

test("46. saving a new assignment redirects back into the exact TYPE/DATE sub-tab, and reopens an open add form", () => {
  // The create endpoint is bound with `groupQuery` — the current tab/view/
  // ordinal tail, computed once the open arrangement's own sub-tabs are known
  // — and with `addAssignmentOpen`, the SAME closed disclosure the page
  // renders the form from. Both are server-derived at render time and never
  // read from the submission.
  assert.ok(
    squash(PAGE).includes(
      "createExamAssignmentAction.bind( null, context.id, groupQuery, addAssignmentOpen, )",
    ),
    "the create endpoint is not bound with the current tab/view/sub-tab and the add-form disclosure",
  );
  // It forwards `groupQuery` into every redirect target via `backPath`,
  // instead of the bare `examsPath` this endpoint used to redirect to — which
  // is what silently reset the manager to the general view regardless of
  // which TYPE or DATE sub-tab they were creating from.
  assert.ok(CREATE_ACTION.includes("const backPath = `${examsPath}?${groupQuery}`;"));
  // 1. A create from an OPEN add form preserves `add=1` on success — the
  //    manager can add several trainees in a row without reopening the form —
  //    and a create from a CLOSED add form does not gain one it never had.
  //    Both branches build from the SAME server-derived `backPath` and a fixed
  //    literal tail; nothing from `formData` or `result` reaches either.
  assert.ok(
    CREATE_ACTION.includes(
      "redirect(addAssignmentOpen ? `${backPath}&createdAssignment=1&add=1` : `${backPath}&createdAssignment=1`);",
    ),
    "success does not conditionally reopen the add form from the bound disclosure alone",
  );
  assert.equal(
    (CREATE_ACTION.match(/addAssignmentOpen/g) ?? []).length,
    2,
    "addAssignmentOpen must appear exactly twice: the bound parameter, and the one success-redirect condition",
  );
  // 3. No arbitrary query parameter is forwarded: `add` never appears anywhere
  //    else in the action, and the ONLY dynamic pieces of the success target
  //    are the two already-closed, server-derived values.
  assert.equal(
    (CREATE_ACTION.match(/add=1/g) ?? []).length,
    1,
    "the add-form token must appear in exactly the one conditional branch",
  );
  assert.equal(CREATE_ACTION.includes("formData.get(\"add\")"), false, "add is read from the submission");
  assert.equal(CREATE_ACTION.includes("query.add"), false, "add is read from a raw query object");
  assert.ok(
    CREATE_ACTION.includes(
      "`${backPath}&assignmentError=invalid_input&assignmentIssues=${encodeURIComponent(codes)}`",
    ),
  );
  assert.ok(
    CREATE_ACTION.includes("`${backPath}&assignmentError=${encodeURIComponent(result.code)}`"),
  );
  for (const stale of ["?createdAssignment=1", "?assignmentError="]) {
    assert.equal(
      CREATE_ACTION.includes(stale),
      false,
      `a redirect target still starts from examsPath directly (${stale}), dropping the current arrangement`,
    );
  }
});

test("47. deleting an assignment redirects back into the exact TYPE/DATE sub-tab", () => {
  assert.ok(
    PAGE.includes("deleteExamAssignmentAction.bind(null, context.id, groupQuery)"),
    "the delete endpoint is not bound with the current tab/view/sub-tab",
  );
  assert.ok(DELETE_ACTION.includes("const backPath = `${examsPath}?${groupQuery}`;"));
  assert.ok(DELETE_ACTION.includes("`${backPath}&deletedAssignment=1`"));
  assert.ok(
    DELETE_ACTION.includes("`${backPath}&assignmentDeleteError=${encodeURIComponent(result.code)}`"),
  );
  for (const stale of ["?deletedAssignment=1", "?assignmentDeleteError="]) {
    assert.equal(
      DELETE_ACTION.includes(stale),
      false,
      `a redirect target still starts from examsPath directly (${stale}), dropping the current arrangement`,
    );
  }
});
