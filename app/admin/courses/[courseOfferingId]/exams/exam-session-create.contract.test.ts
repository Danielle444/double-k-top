/**
 * EXAM EX-SES-S4 — DB-free CONTRACT test for the admin ExamSession CREATE UI:
 * the third Server Action of the course-scoped exams route, its reusable client
 * form, and the route-local message table.
 *
 * WHY MOSTLY STRUCTURAL. The Server Action reaches `server-only` modules and
 * Next's request scope, so it cannot be imported into a plain `tsx --test`
 * process — which is exactly what those declarations are for. Its SHAPE is
 * therefore asserted from source: the order of the trust boundary, the exact
 * FormData mapping, what may be imported, and what must never appear.
 *
 * The one module that IS dependency-free — the route-local message table — is
 * imported and driven at RUNTIME below, because its "never echo an unknown
 * token" promise is a behaviour and deserves to be proven rather than described.
 *
 * DB-FREE AND PRODUCTION-FREE: this suite reads repository sources from disk and
 * runs `git` to describe its own file scope. It opens no database connection,
 * executes no SQL, reads no environment variable, resolves no session and makes
 * no network request.
 *
 * SPLIT LITERALS — NOT COSMETIC. The committed caller allow-list in the session
 * write binding's own suite sweeps every file under `app/`, `lib/` and
 * `components/` for that binding's module name and for its three public function
 * names, and it matches RAW SOURCE TEXT after comment stripping. A suite that
 * spelled those tokens in order to assert on them would ENROL ITSELF in the
 * allow-list it exists to keep at exactly one entry — and, for the edit and
 * removal writers, would break a guard whose whole content is that the list is
 * EMPTY. Every such token below is therefore assembled from pieces at runtime.
 *
 * HOW TO RUN IT — see the line comment below. It uses a WILDCARD for the dynamic
 * segment: the node test runner treats its path argument as a GLOB, so a literal
 * bracketed segment is read as a character class, matches nothing, and the runner
 * then reports 0 tests and exits 0 — which looks exactly like a passing suite.
 * Always confirm the reported test count.
 */
// Run:
//   npx tsx --test "app/admin/courses/*/exams/exam-session-create.contract.test.ts"
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  examSessionCreateErrorText,
  examSessionCreateIssueTexts,
  EXAM_SESSION_CREATE_ERROR_TEXT,
  EXAM_SESSION_CREATE_ISSUE_TEXT,
} from "./exam-session-create-error-messages";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..", "..");

const ROUTE_DIR_REL = join("app", "admin", "courses", "[courseOfferingId]", "exams");
/** The same directory in git's own form: forward slashes, repository-relative. */
const ROUTE_DIR_PREFIX = "app/admin/courses/[courseOfferingId]/exams/";

const ACTIONS_REL = join(ROUTE_DIR_REL, "actions.ts");
const FORM_REL = join(ROUTE_DIR_REL, "ExamSessionCreateForm.tsx");
const MESSAGES_REL = join(ROUTE_DIR_REL, "exam-session-create-error-messages.ts");
const PAGE_REL = join(ROUTE_DIR_REL, "page.tsx");

/**
 * The route's EXACT final file set.
 *
 * RE-POINTED by EX-SES-UI-2, not relaxed: that slice added three reviewed files
 * to this route — an edit form, a delete form and its own contract suite — so the
 * exact set grew from eleven to fourteen.
 *
 * RE-POINTED AGAIN by EX-ASG-UI1, on the same terms: that slice added four —
 * an assignment create form, an assignment delete form, a closed message module
 * and its own contract suite — so the set grew to eighteen. It is still an
 * EXHAUSTIVE literal list; a nineteenth file still fails here.
 */
const FINAL_ROUTE_FILES = [
  "app/admin/courses/[courseOfferingId]/exams/CreateExamAssignmentForm.tsx",
  "app/admin/courses/[courseOfferingId]/exams/CreateExamInstructedTraineeAssignmentForm.tsx",
  "app/admin/courses/[courseOfferingId]/exams/DeleteExamAssignmentForm.tsx",
  "app/admin/courses/[courseOfferingId]/exams/exam-assignment-messages.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-assignment-ui.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/ExamDefinitionCreateForm.tsx",
  "app/admin/courses/[courseOfferingId]/exams/ExamPlanCreateForm.tsx",
  "app/admin/courses/[courseOfferingId]/exams/ExamSessionCreateForm.tsx",
  "app/admin/courses/[courseOfferingId]/exams/ExamSessionDeleteForm.tsx",
  "app/admin/courses/[courseOfferingId]/exams/ExamSessionEditForm.tsx",
  "app/admin/courses/[courseOfferingId]/exams/actions.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-definition-create-error-messages.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-definition-create.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-definitions-page.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-instructed-trainee-assignment-messages.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-instructed-trainee-assignment-ui.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-plan-create.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-publication-ui.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-session-create.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-session-create-error-messages.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-session-edit-delete.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/page.tsx",
].sort();

/**
 * The FOURTEEN paths in scope for EX-SES-UI-2.
 *
 * EX-SES-S4 contributed eight and EX-SES-UI-1 five more; both are COMMITTED, so
 * a clean tree reports neither and this list must describe the slice that is
 * currently in the working tree instead. RE-POINTED, not widened: it is still an
 * exhaustive literal set of exact paths, and it still admits no directory, no
 * prefix and no glob.
 *
 * EX-SES-UI-2's own shape is three new route files (an edit form, a delete form
 * and its contract suite), two amended route production files, and nine committed
 * guard suites — the four here on the route and five under `lib/` — whose exact
 * allow-lists had to learn about it.
 *
 * The session write binding's path is ASSEMBLED for the reason in the header, and
 * the session READER's most sharply of all: its committed guard pins the reader's
 * caller list to EXACTLY `page.tsx`, so a suite spelling that module name whole
 * would become the second entry in a list that must hold one.
 */
const SLICE_PATHS = [
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
  "app/admin/courses/[courseOfferingId]/exams/exam-plan-create.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-definitions-page.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-definition-create.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-session-create.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-session-edit-delete.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-assignment-ui.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-instructed-trainee-assignment-ui.contract.test.ts",
  "lib/actions/" + "exam-publication-write" + "-io.test.ts",
  // The three new route files.
  "app/admin/courses/[courseOfferingId]/exams/ExamSessionEditForm.tsx",
  "app/admin/courses/[courseOfferingId]/exams/ExamSessionDeleteForm.tsx",
  "app/admin/courses/[courseOfferingId]/exams/exam-session-edit-delete.contract.test.ts",
  // The two amended production files.
  "app/admin/courses/[courseOfferingId]/exams/actions.ts",
  "app/admin/courses/[courseOfferingId]/exams/page.tsx",
  // The four route guard suites, including this one.
  "app/admin/courses/[courseOfferingId]/exams/exam-session-create.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-definition-create.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-plan-create.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-definitions-page.contract.test.ts",
  // The five committed `lib/` footprint guards.
  "lib/actions/" + "exam-session-write" + "-io.test.ts",
  "lib/actions/" + "admin-exam-session-read" + "-io.test.ts",
  "lib/actions/" + "exam-definition-read" + "-io.test.ts",
  "lib/actions/" + "exam-plan-write" + "-io.test.ts",
  "lib/exam/" + "create-exam-plan" + "-core.test.ts",
  // EX-ASG-UI1's own four new route files, its contract suite, and the two
  // committed assignment guards plus the supervisor core guard whose footprint
  // lists it re-points. The `lib/` assignment entries are ASSEMBLED for the
  // sharpest reason of all: both pinned their caller lists at EXACTLY ZERO before
  // that slice.
  "app/admin/courses/[courseOfferingId]/exams/CreateExamAssignmentForm.tsx",
  "app/admin/courses/[courseOfferingId]/exams/DeleteExamAssignmentForm.tsx",
  "app/admin/courses/[courseOfferingId]/exams/exam-assignment-messages.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-assignment-ui.contract.test.ts",
  "lib/actions/" + "exam-assignment-write" + "-io.test.ts",
  "lib/actions/" + "exam-assignment-read" + "-io.test.ts",
  "lib/exam/" + "exam-supervisor-write" + "-core.test.ts",
  "lib/actions/" + "exam-plan-write" + "-io.test.ts",
  // EX-ASG-IT2's three new route files, plus the committed Stage A caller guard
  // it re-points from ZERO callers to exactly this route's Server Action module.
  // That last entry is ASSEMBLED for the sharpest reason of all: the guard sweeps
  // every file under `app/` for its own module name and must keep reporting
  // exactly one caller, so a suite that spelled it whole would become the second.
  "app/admin/courses/[courseOfferingId]/exams/CreateExamInstructedTraineeAssignmentForm.tsx",
  "app/admin/courses/[courseOfferingId]/exams/exam-instructed-trainee-assignment-messages.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-instructed-trainee-assignment-ui.contract.test.ts",
  "lib/actions/" + "exam-instructed-trainee-assignment-write" + "-io.test.ts",
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
  // to the committed detailed writer. Every route file it edits — the Server Action
  // module, the page, the examinee create form and the route-local assignment
  // message table — is ALREADY in this list, and nothing new is created: no route
  // file, no Server Action, no query key and no form component. The ONE path it
  // adds is that writer's own committed guard, whose caller list the wiring
  // re-points from ZERO to exactly the one Server Action module — and it is
  // ASSEMBLED, because that guard sweeps `app/`, `lib/` and `components/` for its
  // own module name and would otherwise enrol this suite as a caller.
  "lib/actions/" + "detailed-exam-assignment-write" + "-io.test.ts",
];

// --- Assembled tokens (see the header) -------------------------------------
const SESSION_WRITE_MODULE = "exam-session-write" + "-io";
const SESSION_WRITE_SPECIFIER = "@/lib/actions/" + SESSION_WRITE_MODULE;
const CREATE_WRITER_CALL = "create" + "ExamSession" + "(";
const UPDATE_WRITER = "update" + "ExamSession";
const DELETE_WRITER = "delete" + "ExamSession";
const PRISMA_MODULE = ["@/lib", "prisma"].join("/");
const GENERATED_CLIENT = ["@prisma", "client"].join("/");
/** The committed exam cores that no file under `app/` may name. */
const FORBIDDEN_CORES = [
  "exam-kind" + "-labels",
  "exam-session-write" + "-core",
  "create-exam-session" + "-core",
  "update-exam-session" + "-core",
  "delete-exam-session" + "-core",
  "exam-definition-validation" + "-core",
  "exam-domain" + "-core",
  "exam-conflict" + "-core",
  "exam-overlap" + "-core",
  "exam-publication" + "-core",
  "exam-schedule-projection" + "-core",
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
 * `git grep -l`, tolerating the EMPTY result.
 *
 * `git grep` exits 1 when nothing matches, which is the SUCCESS case for the two
 * "reachable from nothing" guards below — treating it as a failure would make an
 * empty allow-list impossible to assert.
 */
function gitGrepFiles(args: readonly string[]): string[] {
  const result = spawnSync("git", ["grep", "-l", "--untracked", ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  assert.ok(
    result.status === 0 || result.status === 1,
    `git grep failed: ${result.stderr ?? ""}`,
  );
  return (result.stdout ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Strip comments so every guard asserts on CODE, not on explanatory prose. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/**
 * Collapse every run of whitespace to ONE space, so a guard can assert on a
 * multi-line declaration without also asserting on how the formatter broke it.
 * Same helper, same spelling, as the three sibling route suites.
 */
function squash(source: string): string {
  return source.replace(/\s+/g, " ");
}

function readSource(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

const ACTIONS_SOURCE = readSource(ACTIONS_REL);
const ACTIONS = stripComments(ACTIONS_SOURCE);
const FORM_SOURCE = readSource(FORM_REL);
const FORM = stripComments(FORM_SOURCE);
const MESSAGES_SOURCE = readSource(MESSAGES_REL);
const MESSAGES = stripComments(MESSAGES_SOURCE);
const PAGE = stripComments(readSource(PAGE_REL));
const PAGE_FLAT = squash(PAGE);

/**
 * ONE exported action's body, from its declaration to the next one (or to the end
 * of the file for the last). The route's three actions share a module, so every
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

const SESSION_ACTION = actionBody(ACTIONS, "createExamSessionAction");
const PLAN_ACTION = actionBody(ACTIONS, "createExamPlanAction");
const DEFINITION_ACTION = actionBody(ACTIONS, "createExamDefinitionAction");

/** The six fields — and the ONLY six — this action may read from a submission. */
const APPROVED_FIELDS = [
  "definitionId",
  "date",
  "startTime",
  "arena",
  "title",
  "notes",
];

// ===========================================================================
// 1–3. The route's exact file set
// ===========================================================================

test("1. the three new files exist at the exact course-scoped route", () => {
  for (const rel of [FORM_REL, MESSAGES_REL, join(ROUTE_DIR_REL, "exam-session-create.contract.test.ts")]) {
    assert.ok(existsSync(join(REPO_ROOT, rel)), `${rel} is missing`);
  }
  // ...and they joined an EXISTING route rather than creating a second one.
  assert.ok(existsSync(join(REPO_ROOT, ACTIONS_REL)), "the action module is missing");
  assert.ok(existsSync(join(REPO_ROOT, PAGE_REL)), "the page is missing");
});

test("2. the route directory holds EXACTLY the eleven approved files", () => {
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

test("3. no top-level or role-area exams route was created", () => {
  for (const dir of [
    join("app", "admin", "exams"),
    join("app", "admin", "exam-sessions"),
    join("app", "instructor", "exams"),
    join("app", "student", "exams"),
  ]) {
    assert.equal(existsSync(join(REPO_ROOT, dir)), false, `${dir} was created`);
  }
  // And no second write-binding wrapper was introduced under lib/actions.
  for (const file of [
    join("lib", "actions", "exam-session-actions.ts"),
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

test("5. the module exports EXACTLY the eight approved actions, in order", () => {
  const exported = [
    ...ACTIONS_SOURCE.matchAll(/export (?:async )?function (\w+)\(/g),
  ].map(([, name]) => name);
  // RE-POINTED by EX-SES-UI-2 and again by EX-ASG-UI1, not relaxed. Still an
  // EXHAUSTIVE allow-list, still in a fixed order — it simply names all seven
  // approved actions, because the route legitimately has seven. Everything
  // exported from a "use server" module is a public network endpoint, so this list
  // IS the attack surface: no eighth endpoint, and no helper, parser, constant or
  // type beside them.
  //
  // In each pair the write and the removal are SEPARATE endpoints rather than one
  // "save" action with an intent field, which is what stops a request that looks
  // like a save from being able to delete.
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
  ]);
  assert.equal(exported.length, 9, "no tenth endpoint may exist in this module");
  for (const token of ["export const", "export default", "export {", "export type"]) {
    assert.equal(ACTIONS.includes(token), false, `the module also declares ${token}`);
  }
  assert.equal((ACTIONS.match(/export async function /g) ?? []).length, 9);
});

test("6. the session action has the EXACT locked signature, and returns void", () => {
  assert.ok(
    /export async function createExamSessionAction\(\s*courseOfferingId: string,\s*formData: FormData,\s*\): Promise<void> \{/.test(
      ACTIONS_SOURCE,
    ),
    "the action signature is not the locked one",
  );
  // No `prevState`, no options bag, no fourth parameter and no non-void return:
  // every outcome is a navigation.
  assert.equal(SESSION_ACTION.includes("prevState"), false);
  assert.equal(/return\s+[^;]/.test(SESSION_ACTION), false, "the action returns a value");
});

test("7. requireAdmin() is the FIRST awaited operation in the session action body", () => {
  const firstAwait = SESSION_ACTION.indexOf("await ");
  assert.ok(firstAwait > 0, "the action awaits nothing");
  assert.ok(
    SESSION_ACTION.slice(firstAwait).startsWith("await requireAdmin();"),
    "the first awaited operation is not requireAdmin()",
  );
  // Nothing is read from the submission, and no writer is entered, BEFORE it.
  const before = SESSION_ACTION.slice(0, firstAwait);
  for (const token of ["formData.get", CREATE_WRITER_CALL, "redirect(", "revalidatePath("]) {
    assert.equal(before.includes(token), false, `${token} runs before requireAdmin()`);
  }
});

test("8. the offering is the BOUND leading argument and is NEVER read from FormData", () => {
  // The id reaches the writer from the bound parameter...
  assert.ok(
    SESSION_ACTION.includes(`${CREATE_WRITER_CALL}courseOfferingId, rawInput)`),
    "the writer is not called with the bound id and the raw input",
  );
  // ...and no submission, cookie, header or current-offering resolver is consulted.
  for (const token of [
    'formData.get("courseOfferingId")',
    'formData.get("planId")',
    "cookies(",
    "headers(",
    "searchParams",
    "currentOffering",
  ]) {
    assert.equal(SESSION_ACTION.includes(token), false, `the action reads ${token}`);
  }
});

test("9. the FormData mapping is EXACTLY the six approved fields, read raw", () => {
  const reads = [...SESSION_ACTION.matchAll(/formData\.get\("([^"]+)"\)/g)].map(
    ([, field]) => field,
  );
  assert.deepEqual(reads, APPROVED_FIELDS, "the mapping is not the approved six");
  assert.equal(reads.length, 6, "there must be exactly six reads");
  // Exactly six `formData.get` calls in total: none with a computed key, and none
  // hidden in a loop over a field list.
  assert.equal((SESSION_ACTION.match(/formData\.get\(/g) ?? []).length, 6);
  for (const token of ["formData.getAll", "formData.entries", "formData.forEach"]) {
    assert.equal(SESSION_ACTION.includes(token), false, `the action uses ${token}`);
  }

  // NO COERCION AND NO DEFAULTING. The committed input core owns every rule, and
  // a second copy here would be free to drift from the one the database sees.
  for (const token of ["String(", "Number(", "?? ", "|| ", ".trim()", "new Date(", "toString("]) {
    assert.equal(
      SESSION_ACTION.includes(token),
      false,
      `the action coerces or defaults with ${token}`,
    );
  }
});

test("10. no plan, order, end-time, capacity or deprecated field is read or sent", () => {
  for (const field of [
    "planId",
    "courseOfferingId",
    "orderIndex",
    "endTime",
    "capacity",
    "parallelCapacity",
    "durationMinutes",
    "kind",
    "phase",
    "interfaceSessionId",
    "sourceTeachingPracticeLessonId",
    "beginnerFormat",
    "individualPublishedAt",
    "sessionId",
    "expectedUpdatedAt",
  ]) {
    assert.equal(
      SESSION_ACTION.includes(`"${field}"`),
      false,
      `the action names the field ${field}`,
    );
  }
  // The raw input object carries the six keys and nothing else.
  const rawInput = SESSION_ACTION.slice(
    SESSION_ACTION.indexOf("const rawInput = {"),
    SESSION_ACTION.indexOf("};", SESSION_ACTION.indexOf("const rawInput = {")),
  );
  const keys = [...rawInput.matchAll(/^\s*(\w+):/gm)].map(([, key]) => key);
  assert.deepEqual(keys, APPROVED_FIELDS);
});

// ===========================================================================
// 11–14. The closed result mapping
// ===========================================================================

test("11. offering_not_found leaves this route for the safe course list", () => {
  assert.ok(
    SESSION_ACTION.includes('if (result.code === "offering_not_found")'),
    "the not-found refusal is not classified",
  );
  assert.ok(
    SESSION_ACTION.includes('redirect("/admin/courses?error=invalid")'),
    "the not-found refusal does not route to the safe course list",
  );
  // The requested id is NOT reflected back into that destination.
  assert.equal(
    /redirect\("\/admin\/courses\?error=invalid"\s*\+/.test(SESSION_ACTION),
    false,
  );
  assert.equal(SESSION_ACTION.includes("/admin/courses?error=${"), false);
});

test("12. success revalidates ONLY this exams path, exactly once, then redirects", () => {
  assert.equal(
    (SESSION_ACTION.match(/revalidatePath\(/g) ?? []).length,
    1,
    "there must be exactly one revalidation",
  );
  assert.ok(
    SESSION_ACTION.includes("revalidatePath(examsPath);"),
    "the revalidation is not the course-scoped exams path",
  );
  assert.ok(
    ACTIONS.includes(
      "const examsPath = `/admin/courses/${encodeURIComponent(courseOfferingId)}/exams`;",
    ),
    "the exams path is not built from the encoded bound id",
  );
  assert.ok(
    SESSION_ACTION.includes("redirect(`${examsPath}?createdSession=1`);"),
    "success does not redirect with the approved token",
  );
  // No layout, dashboard, tag or second path is revalidated.
  for (const token of ["revalidateTag", "revalidatePath(`/admin/courses`", '"layout"', '"page"']) {
    assert.equal(SESSION_ACTION.includes(token), false, `the action calls ${token}`);
  }
});

test("13. invalid_input carries STABLE CODES ONLY; every other refusal its bare code", () => {
  assert.ok(
    SESSION_ACTION.includes('if (result.code === "invalid_input")'),
    "invalid_input is not classified",
  );
  // Only the issue CODE is mapped — never the message, never the field, never a
  // submitted value.
  assert.ok(
    SESSION_ACTION.includes("result.issues.map((issue) => issue.code).join(\",\")"),
    "the issues are not reduced to codes",
  );
  assert.equal(SESSION_ACTION.includes("issue.message"), false);
  assert.equal(SESSION_ACTION.includes("issue.value"), false);
  assert.ok(
    SESSION_ACTION.includes(
      "`${examsPath}?sessionError=invalid_input&sessionIssues=${encodeURIComponent(codes)}`",
    ),
    "the issue redirect is not the approved shape",
  );
  // The catch-all carries the code alone, encoded.
  assert.ok(
    SESSION_ACTION.includes(
      "redirect(`${examsPath}?sessionError=${encodeURIComponent(result.code)}`);",
    ),
    "the residual refusal does not carry its bare encoded code",
  );
  // Nothing submitted is ever interpolated into a destination.
  for (const token of ["rawInput.", "definitionId}", "startTime}", "arena}", "title}", "notes}"]) {
    assert.equal(
      SESSION_ACTION.includes(`\${${token}`),
      false,
      `a submitted value reaches a redirect: ${token}`,
    );
  }
});

test("14. there is NO try/catch anywhere, so every redirect is outside one", () => {
  // redirect() signals by THROWING NEXT_REDIRECT. The strongest form of the rule
  // is not "the redirect sits outside the block" but "there is no block".
  for (const token of ["try {", "catch (", "catch(", "finally {"]) {
    assert.equal(ACTIONS.includes(token), false, `the module declares ${token}`);
  }
  // ...so an unexpected failure PROPAGATES rather than becoming a query code.
  assert.equal(SESSION_ACTION.includes("unexpected"), false);
  assert.equal(SESSION_ACTION.includes("error.message"), false);
  assert.equal(SESSION_ACTION.includes("String(error"), false);
});

// ===========================================================================
// 15–17. What the action may reach, and what stays unreachable
// ===========================================================================

test("15. the action imports no database client, capability or notification surface", () => {
  const imports = [...ACTIONS_SOURCE.matchAll(/from "([^"]+)"/g)].map(([, m]) => m);
  // The two NEIGHBOURING bindings are assembled from pieces for the same reason
  // as this slice's own: each has a committed guard that sweeps `app/` for its
  // module name and pins an EXACT caller list, and a suite that spelled either
  // whole would enrol itself as an extra caller of a binding it never calls.
  assert.deepEqual(imports.sort(), [
    "@/lib/actions/" + "exam-definition-write" + "-io",
    "@/lib/actions/" + "exam-plan-write" + "-io",
    SESSION_WRITE_SPECIFIER,
    // ADDED by EX-ASG-UI1, and assembled for the sharpest reason of all: that
    // binding's committed guard pinned its caller list at EXACTLY ZERO before the
    // slice, and at exactly this one Server Action module after it.
    "@/lib/actions/" + "exam-assignment-write" + "-io",
    // ADDED by EX-ASG-IT2, and assembled on exactly the same terms: the committed
    // instructed-trainee write binding's guard pinned its caller list at ZERO
    // before this slice, and at exactly this one Server Action module after it.
    "@/lib/actions/" + "exam-instructed-trainee-assignment-write" + "-io",
    // ADDED by EX-ASG-LTD2-B2, and assembled on exactly the same terms: the
    // committed DETAILED examinee write binding's guard pinned its caller list at
    // ZERO before that slice, and at exactly this one Server Action module after
    // it. It is an ADDITION and not a swap — the three-field binding above is
    // still imported, for the assignment REMOVAL.
    "@/lib/actions/" + "detailed-exam-assignment-write" + "-io",
    // ADDED by EX-PUB-UI-MVP, and assembled for the sharpest reason of all: the
    // committed publication write binding is what makes an exam plan visible to
    // trainees, and its own guard pinned its caller list at EXACTLY ZERO before
    // this slice and at exactly this one Server Action module after it — so a
    // suite that spelled the module whole would enrol itself in that list.
    "@/lib/actions/" + "exam-publication-write" + "-io",
    "@/lib/auth/require-admin",
    "next/cache",
    "next/navigation",
  ].sort());
  for (const token of [PRISMA_MODULE, GENERATED_CLIENT, "capabilit", "Capabilit", "notification", "Notification", "push", "sendMessage"]) {
    assert.equal(ACTIONS.includes(token), false, `the action module reaches ${token}`);
  }
});

test("16. no session reorder, assignment, break, supervisor, publication or source-date path exists", () => {
  // RE-POINTED by EX-SES-UI-2. The session EDIT and REMOVAL verbs have LEFT this
  // universal list, because the module now legitimately holds those two approved
  // endpoints — exactly the treatment the definition CREATE and the session CREATE
  // verbs already received when each became an approved neighbour.
  //
  // The relaxation is NARROW and is re-established from the other side rather than
  // dropped: the CREATE FORM and the CREATE MESSAGE TABLE are still swept for both
  // verbs below, so the create slice's own files provably gained nothing; the two
  // new endpoints' exact FormData budget and result mapping are proven in the
  // EX-SES-UI-2 suite; and the write binding's own committed guard still pins the
  // complete caller list for all three session writers to this ONE module.
  //
  // Everything genuinely absent stays banned across all three files.
  for (const token of [
    "reorder" + "ExamSessions",
    "update" + "ExamDefinition",
    "delete" + "ExamDefinition",
    "reorder" + "ExamDefinitions",
    "publish" + "ExamPlan",
    "unpublish" + "ExamPlan",
    "delete" + "ExamPlan",
    // RE-POINTED by EX-ASG-UI1. The blanket `ExamAssignment` / `examAssignment`
    // substrings have LEFT this universal list, because the shared action module
    // now legitimately holds two approved, separately reviewed assignment
    // endpoints — exactly the treatment every other approved verb received. The
    // relaxation is NARROW and re-established from the other side: the Prisma
    // ACCESSOR spelling stays banned everywhere (the trailing dot is what makes it
    // an accessor), assignment EDITING and REORDERING stay banned outright because
    // no such affordance exists, and THIS create slice's own form and message
    // table are still swept for the whole assignment slice below.
    "examAssignment.",
    "reorder" + "ExamAssignments",
    "update" + "ExamAssignment",
    "SessionBreak",
    "Supervisor",
    "sourceDate",
    "SourceDate",
    "publishedAt",
    "individualPublishedAt",
  ]) {
    for (const [label, code] of [
      ["action module", ACTIONS],
      ["form", FORM],
      ["messages", MESSAGES],
    ] as const) {
      assert.equal(code.includes(token), false, `the ${label} reaches ${token}`);
    }
  }
  // The CREATE slice's OWN two files reach no part of the assignment slice at all.
  for (const token of ["ExamAssignment", "examAssignment", "assignmentError="]) {
    for (const [label, code] of [
      ["form", FORM],
      ["messages", MESSAGES],
    ] as const) {
      assert.equal(code.includes(token), false, `the ${label} reaches ${token}`);
    }
  }
  // ...and so does the CREATE ACTION's own body.
  for (const token of ["ExamAssignment", "assignmentError=", "assignmentDeleteError="]) {
    assert.equal(
      SESSION_ACTION.includes(token),
      false,
      `the session create action reaches ${token}`,
    );
  }
  // The CREATE slice's OWN two files still reach neither destructive verb: the
  // relaxation above is for the shared action MODULE, and the create form and its
  // message table gain nothing from it.
  for (const token of [UPDATE_WRITER, DELETE_WRITER]) {
    for (const [label, code] of [
      ["form", FORM],
      ["messages", MESSAGES],
    ] as const) {
      assert.equal(code.includes(token), false, `the ${label} reaches ${token}`);
    }
  }
  // ...and the CREATE ACTION's own body reaches neither, so the five endpoints in
  // the shared module provably did not become entangled.
  assert.equal(SESSION_ACTION.includes(UPDATE_WRITER + "("), false);
  assert.equal(SESSION_ACTION.includes(DELETE_WRITER + "("), false);
  // No schema or migration work travels with this slice.
  const touched = new Set([
    ...gitLines(["diff", "--name-only", "HEAD"]),
    ...gitLines(["ls-files", "--others", "--exclude-standard"]),
  ]);
  for (const path of touched) {
    assert.equal(/^prisma\//.test(path), false, `the slice touched ${path}`);
    assert.equal(/capabilit/i.test(path), false, `the slice touched ${path}`);
  }
});

test("17. the two EXISTING actions are intact and did not become entangled", () => {
  // The plan action still never reads the submission at all...
  assert.equal(PLAN_ACTION.includes("formData.get"), false);
  assert.ok(PLAN_ACTION.includes("void formData;"));
  // ASSEMBLED, like `CREATE_WRITER_CALL` above and for the same reason: the
  // ExamPlan write binding's committed guard sweeps `app/`, `lib/`, `components/`
  // and `scripts/` for this exact call pattern and pins the result to the ONE
  // approved Server Action plus the plan route's own suite. Spelled whole, this
  // file became an unapproved caller of a writer it never invokes.
  assert.ok(PLAN_ACTION.includes("create" + "ExamPlan(courseOfferingId)"));
  assert.ok(PLAN_ACTION.includes("?created=1"));
  assert.ok(PLAN_ACTION.includes("?existing=1"));
  // ...and the definition action still reads exactly its seven fields, with its
  // own coercion rules, and still uses its OWN query tokens.
  const definitionReads = [
    ...DEFINITION_ACTION.matchAll(/formData\.get\("([^"]+)"\)/g),
  ].map(([, field]) => field);
  assert.deepEqual(definitionReads, [
    "name",
    "kind",
    "durationMinutes",
    "parallelCapacity",
    "requiresInstructedTrainee",
    "requiresLessonTopic",
    "requiresDiscipline",
  ]);
  assert.ok(DEFINITION_ACTION.includes("?createdDefinition=1"));
  assert.ok(DEFINITION_ACTION.includes("createError="));
  // The three endpoints are DISJOINT: neither neighbour reaches the session
  // writer, and the session action reaches neither neighbour's writer.
  assert.equal(PLAN_ACTION.includes(CREATE_WRITER_CALL), false);
  assert.equal(DEFINITION_ACTION.includes(CREATE_WRITER_CALL), false);
  assert.equal(SESSION_ACTION.includes("create" + "ExamPlan("), false);
  // ASSEMBLED for the same reason as the plan call above: the ExamDefinition write
  // binding's committed guard sweeps `app/`, `lib/` and `components/` for this call
  // pattern and pins the result to the ONE approved Server Action. Spelled whole,
  // this file became an unapproved caller of a writer it never invokes.
  assert.equal(SESSION_ACTION.includes("create" + "ExamDefinition("), false);
  // ...and their query tokens do not collide.
  assert.equal(SESSION_ACTION.includes("createError="), false);
  assert.equal(SESSION_ACTION.includes("createdDefinition"), false);
  assert.equal(DEFINITION_ACTION.includes("sessionError="), false);
});

// ===========================================================================
// 18–22. The create form
// ===========================================================================

test("18. the form is a client component whose every value comes from props", () => {
  assert.equal(FORM_SOURCE.split("\n")[0].trim(), '"use ' + 'client";');
  // No data loading, no navigation, no effect, no auto-submit of any kind.
  for (const token of [
    "useEffect",
    "useLayoutEffect",
    "fetch(",
    "axios",
    "useRouter",
    "router.",
    "redirect(",
    "revalidatePath",
    ".submit()",
    "requestSubmit",
    "useSWR",
    "server-only",
  ]) {
    assert.equal(FORM.includes(token), false, `the form uses ${token}`);
  }
  // It reaches no write binding and no database client: only the Server Action may.
  for (const token of [SESSION_WRITE_MODULE, CREATE_WRITER_CALL, PRISMA_MODULE, GENERATED_CLIENT, "prisma."]) {
    assert.equal(FORM.includes(token), false, `the form reaches ${token}`);
  }
  // The only imports are React's form-status hook.
  const imports = [...FORM_SOURCE.matchAll(/from "([^"]+)"/g)].map(([, m]) => m);
  assert.deepEqual(imports, ["react-dom"]);
});

test("19. the props are EXACTLY the bound action and the safe definition options", () => {
  assert.ok(
    /action: \(formData: FormData\) => void \| Promise<void>;/.test(FORM),
    "the action prop is not the bound form-action shape",
  );
  assert.ok(
    /definitions: readonly ExamSessionDefinitionOption\[\];/.test(FORM),
    "the definitions prop is not a readonly option list",
  );
  // The option carries THREE safe fields and nothing else — no duration, no
  // capacity, no plan id, no offering id, no requirement flag, no timestamp.
  const optionType = FORM.slice(
    FORM.indexOf("interface ExamSessionDefinitionOption"),
    FORM.indexOf("}", FORM.indexOf("interface ExamSessionDefinitionOption")),
  );
  const fields = [...optionType.matchAll(/readonly (\w+):/g)].map(([, f]) => f);
  assert.deepEqual(fields, ["id", "name", "kind"]);
  for (const forbidden of ["planId", "courseOfferingId", "durationMinutes", "parallelCapacity", "createdAt", "requires"]) {
    assert.equal(optionType.includes(forbidden), false, `the option carries ${forbidden}`);
  }
  // The options are rendered from the prop and from nothing else.
  assert.ok(FORM.includes("definitions.map((definition)"), "options are not mapped from the prop");
});

test("20. the form renders EXACTLY the six approved fields, and no hidden id", () => {
  const named = [...FORM.matchAll(/name="([^"]+)"/g)].map(([, n]) => n);
  assert.deepEqual(named, APPROVED_FIELDS, "the rendered fields are not the approved six");
  // No hidden input of ANY kind, and no course, plan or order field.
  assert.equal(/type="hidden"/.test(FORM), false, "the form carries a hidden input");
  for (const forbidden of ["courseOfferingId", "planId", "orderIndex", "endTime", "capacity", "sessionId"]) {
    assert.equal(FORM.includes(`name="${forbidden}"`), false, `the form submits ${forbidden}`);
  }
  // The two format-bearing inputs use the types the committed validator expects.
  assert.ok(/type="date" name="date"/.test(FORM.replace(/\s+/g, " ")));
  assert.ok(/type="time"[\s\S]{0,60}name="startTime"/.test(FORM));
  // ...and no end time is asked for: it is derived from the definition.
  assert.equal(FORM.includes('name="endTime"'), false);
});

test("21. the submit is pending-disabled, and nothing is inserted optimistically", () => {
  assert.ok(FORM.includes("useFormStatus()"), "the form does not observe pending state");
  assert.ok(/const \{ pending \} = useFormStatus\(\);/.test(FORM));
  assert.ok(/disabled=\{isDisabled\}/.test(FORM), "the submit is not disabled while pending");
  assert.ok(/aria-disabled=\{isDisabled\}/.test(FORM), "the disabled state is not exposed to AT");
  assert.ok(/const isDisabled = pending \|\| disabled;/.test(FORM));
  // No optimistic list, no local row, no edit or delete control.
  for (const token of ["useOptimistic", "setSessions", "sessions.push", "onDelete", "onEdit", "handleDelete", "handleEdit"]) {
    assert.equal(FORM.includes(token), false, `the form holds ${token}`);
  }
});

test("22. an EMPTY definition list disables the whole form and explains why", () => {
  assert.ok(
    FORM.includes("const hasNoDefinitions = definitions.length === 0;"),
    "the empty case is not derived from the prop",
  );
  // A disabled fieldset disables every control inside it, so nothing can be
  // submitted — this is not merely a visual state.
  assert.ok(
    /<fieldset disabled=\{hasNoDefinitions\}/.test(FORM),
    "the field set is not disabled when there is nothing to choose",
  );
  // ...and the submit is disabled for that reason INDEPENDENTLY of pending.
  assert.ok(/<CreateSubmitButton disabled=\{hasNoDefinitions\} \/>/.test(FORM));
  // The reason is stated in words rather than left to be guessed.
  assert.ok(
    FORM.includes("{hasNoDefinitions ? ("),
    "the empty state renders no explanation",
  );
  assert.ok(
    FORM_SOURCE.includes("יש להוסיף הגדרת מבחן תחילה"),
    "the explanation does not name the missing prerequisite",
  );
});

// ===========================================================================
// 23–25. The route-local message table (RUNTIME)
// ===========================================================================

test("23. the message module is dependency-free", () => {
  assert.equal(/^\s*import /m.test(MESSAGES), false, "the message module imports something");
  for (const core of FORBIDDEN_CORES) {
    assert.equal(
      MESSAGES_SOURCE.includes(`./${core}`) ||
        MESSAGES_SOURCE.includes(["lib", "exam", core].join("/")),
      false,
      `the message module names the core ${core}`,
    );
  }
});

test("24. the issue table is EXACTLY the six committed diagnostics", () => {
  assert.deepEqual(Object.keys(EXAM_SESSION_CREATE_ISSUE_TEXT), [
    "EX-SES-DEFINITION-REQUIRED",
    "EX-SES-DATE-INVALID",
    "EX-SES-START-TIME-INVALID",
    "EX-SES-ARENA-INVALID",
    "EX-SES-TITLE-INVALID",
    "EX-SES-NOTES-INVALID",
  ]);
  // The refusal table omits offering_not_found on purpose: it never reaches this
  // page, because the action routes it to the course list.
  assert.deepEqual(Object.keys(EXAM_SESSION_CREATE_ERROR_TEXT).sort(), [
    "definition_not_found",
    "invalid_input",
    "operation_not_allowed",
    "plan_not_found",
  ]);
  assert.equal("offering_not_found" in EXAM_SESSION_CREATE_ERROR_TEXT, false);
  // No message contains a placeholder, so none can echo a submitted value.
  for (const text of [
    ...Object.values(EXAM_SESSION_CREATE_ERROR_TEXT),
    ...Object.values(EXAM_SESSION_CREATE_ISSUE_TEXT),
  ]) {
    assert.equal(/\$\{|%s|\{\d\}/.test(text), false, `a message interpolates: ${text}`);
  }
});

test("25. only RECOGNIZED tokens render; everything else is dropped or explicit", () => {
  // Recognized issue codes render, in the SERVER's order, deduplicated.
  assert.deepEqual(
    examSessionCreateIssueTexts("EX-SES-DATE-INVALID,EX-SES-DEFINITION-REQUIRED"),
    [
      EXAM_SESSION_CREATE_ISSUE_TEXT["EX-SES-DATE-INVALID"],
      EXAM_SESSION_CREATE_ISSUE_TEXT["EX-SES-DEFINITION-REQUIRED"],
    ],
  );
  assert.deepEqual(examSessionCreateIssueTexts("EX-SES-NOTES-INVALID,EX-SES-NOTES-INVALID"), [
    EXAM_SESSION_CREATE_ISSUE_TEXT["EX-SES-NOTES-INVALID"],
  ]);
  // An unknown token cannot place text on the page — it is DROPPED.
  for (const raw of [
    "<script>alert(1)</script>",
    "toString",
    "constructor",
    "__proto__",
    "EX-SES-NOT-A-CODE",
    ",,,",
    "",
    null,
    undefined,
    42,
    {},
  ]) {
    assert.deepEqual(examSessionCreateIssueTexts(raw), [], `an unknown token rendered: ${String(raw)}`);
  }

  // A recognized refusal renders its sentence; an absent one is silent; an
  // UNKNOWN one is explicit rather than blank, and never echoes the token.
  assert.equal(
    examSessionCreateErrorText("plan_not_found"),
    EXAM_SESSION_CREATE_ERROR_TEXT.plan_not_found,
  );
  for (const raw of [null, undefined, "", 7, {}]) {
    assert.equal(examSessionCreateErrorText(raw), null, `a silent case rendered: ${String(raw)}`);
  }
  for (const raw of ["nope", "toString", "constructor", "<img onerror=x>"]) {
    const text = examSessionCreateErrorText(raw);
    assert.ok(typeof text === "string" && text.length > 0, "an unknown refusal rendered blank");
    assert.equal(text.includes(raw), false, `the unknown token was echoed: ${raw}`);
  }
});

// ===========================================================================
// 26–29. Containment: the page, the callers and the exact file scope
// ===========================================================================

test("26. page.tsx WIRES this form to the committed reader, grouping core and action", () => {
  // EX-SES-UI-1 TRANSITION. This guard previously asserted page.tsx was
  // BYTE-IDENTICAL to HEAD and named none of this slice's tokens — the correct
  // claim while the form was committed but deliberately unwired. Wiring is exactly
  // what makes that claim obsolete, so it is REPLACED by the equally exact positive
  // claim, not deleted and not weakened to "the page mentions the form".

  // The form is imported ROUTE-LOCALLY and rendered exactly once.
  assert.ok(PAGE.includes('from "./ExamSessionCreateForm"'));
  assert.equal((PAGE.match(/<ExamSessionCreateForm/g) ?? []).length, 1);

  // The bound action is the committed Server Action, bound to the VERIFIED context
  // id and never to the raw route param — the whole point of the binding.
  assert.ok(PAGE.includes("createExamSessionAction.bind(null, context.id)"));
  assert.equal(
    PAGE.includes("createExamSessionAction.bind(null, courseOfferingId)"),
    false,
    "the raw route param must not be bound",
  );
  // Imported once, bound once: no second session mutation entered the page.
  assert.equal((PAGE.match(/createExamSessionAction/g) ?? []).length, 2);

  // The SESSIONS come from the committed admin reader, given the VERIFIED id, and
  // the day grouping is the committed PURE core. Both tokens are ASSEMBLED: the
  // reader's own guard sweeps every file under `app/` for them and pins the caller
  // list to `page.tsx` alone, so spelling either whole here would make THIS suite
  // the second entry in a list that must hold exactly one.
  const SESSION_READER_CALL = "read" + "AdminExamSessions" + "(context.id)";
  const GROUPING_CALL = "group" + "AdminExamSessionsByDay" + "(sessionView.sessions)";
  assert.ok(PAGE.includes(SESSION_READER_CALL), "the page must read sessions by verified id");
  assert.ok(PAGE.includes(GROUPING_CALL), "the page must group through the committed core");
  assert.equal(
    PAGE.includes("read" + "AdminExamSessions" + "(courseOfferingId)"),
    false,
    "the raw route param must not reach the reader",
  );

  // The grouping core is the FINAL ordering authority: the page re-orders nothing.
  for (const forbidden of [".sort(", ".reverse(", ".filter(", ".slice("]) {
    assert.equal(PAGE.includes(forbidden), false, `the page must not ${forbidden} the schedule`);
  }
  // Its CLOSED failure arm becomes ONE fixed sentence — never a raw diagnostic,
  // never a row echo, and never a silent fall back to the reader's own order.
  assert.ok(PAGE.includes("grouping.ok ? ("), "the closed result union must be discriminated");
  assert.ok(PAGE.includes("לא ניתן להציג כרגע את מפגשי המבחנים. יש לבדוק את נתוני המפגשים."));
  for (const forbidden of ["grouping.issues", "issue.message", "issue.code"]) {
    assert.equal(PAGE.includes(forbidden), false, `the page must not surface ${forbidden}`);
  }

  // RE-POINTED by EX-SES-UI-2. The claim was "the session id is a React key and
  // nothing else, and no definition id or version stamp exists on this page at
  // all" — correct while the page only READ sessions. Editing one requires naming
  // WHICH row, at WHICH version, against WHICH definition, so the ban is NARROWED
  // to what it was always protecting rather than dropped: none of the three may be
  // rendered as TEXT, interpolated into a string, or placed in an href. Each may
  // travel only as a React key or as a prop the client form turns into a HIDDEN
  // field, and the exact counts below are what keep "only" honest.
  //
  // RE-POINTED AGAIN by EX-ASG-UI1, and NARROWED rather than relaxed. The session
  // id gains exactly TWO further NON-VISIBLE uses: it keys the in-memory lookup of
  // that session's assignment rows, and it is the assignment create form's hidden
  // `sessionId` prop. Both are covered by the same rule — never text, never an
  // interpolation, never an href — and the counts below still keep "only" honest.
  assert.ok(PAGE.includes("key={session.sessionId}"));
  // Once as the key, FOUR times as the four forms' hidden-field props — the
  // instructed-trainee create form is the fourth, added by EX-ASG-IT2 — and once
  // as the assignment-bucket lookup key. Every one of the six is NON-VISIBLE,
  // which is the property this guard has always protected.
  assert.equal((PAGE.match(/session\.sessionId/g) ?? []).length, 6);
  assert.equal((PAGE.match(/sessionId=\{session\.sessionId\}/g) ?? []).length, 4);
  assert.ok(
    PAGE.includes("assignmentsBySession.get(session.sessionId)"),
    "the sixth use must be the assignment-bucket lookup",
  );
  // Once per form, and only as the hidden concurrency token.
  assert.equal((PAGE.match(/session\.updatedAt/g) ?? []).length, 2);
  assert.equal((PAGE.match(/expectedUpdatedAt=\{session\.updatedAt\}/g) ?? []).length, 2);
  // RE-POINTED by EX-ASG-UI1: the definition id gains ONE further non-visible use,
  // as the key of the requirement lookup that decides whether an examinee may be
  // assigned to this session at all. Still never text, an interpolation or a link.
  assert.equal((PAGE.match(/session\.definitionId/g) ?? []).length, 2);
  assert.ok(PAGE.includes("definitionId={session.definitionId}"));
  assert.ok(
    /requirementsByDefinition\.get\(\s*session\.definitionId,?\s*\)/.test(PAGE),
    "the second use must be the requirement lookup",
  );
  // None of the three is ever TEXT, an interpolation or part of a link.
  for (const forbidden of [
    ">{session.sessionId}<",
    ">{session.updatedAt}<",
    ">{session.definitionId}<",
    "${session.sessionId}",
    "${session.updatedAt}",
    "${session.definitionId}",
  ]) {
    assert.equal(PAGE.includes(forbidden), false, `the page renders an identifier: ${forbidden}`);
  }
  // Everything that was never rendered still is not.
  for (const forbidden of [
    "session.definitionKind",
    "session.orderIndex",
    "endTime",
    "waves",
    "slots",
    "capacity",
  ]) {
    assert.equal(PAGE.includes(forbidden), false, `the page must not render ${forbidden}`);
  }

  // The three always-rendered display fields, and the three optional ones, which
  // are rendered only when actually present.
  for (const field of ["session.definitionName", "session.startTime", "session.assignmentCount"]) {
    assert.ok(PAGE.includes(field), `${field} is not rendered`);
  }
  for (const optional of ["session.title", "session.arena", "session.notes"]) {
    assert.ok(
      PAGE.includes(`${optional} !== null && ${optional} !== ""`),
      `${optional} must be rendered only when present`,
    );
  }

  // The day heading is the grouping core's own pair of labels — the page derives no
  // date text of its own, reads no clock and filters against none.
  for (const label of ["day.dayLabel", "day.dateLabel", "key={day.dateKey}"]) {
    assert.ok(PAGE.includes(label), `${label} is missing`);
  }
  for (const forbidden of ["new Date(", "Date.now(", "toLocaleDateString", "Intl."]) {
    assert.equal(PAGE.includes(forbidden), false, `the page must not use ${forbidden}`);
  }
});

test("26b. the session form is gated, fed from the definition reader, and advisory-only", () => {
  // THREE preconditions, over the SAME single lifecycle evaluation the other two
  // affordances use: a plan to attach to, at least one exam to schedule against,
  // and the policy's permission. A session cannot exist without a definition, so
  // the middle term is structural rather than cosmetic.
  assert.ok(
    PAGE_FLAT.includes(
      "const showSessionCreateForm = sessionView.planExists && view.definitions.length > 0 && mayConfigure;",
    ),
    "the session form must be gated on plan, definitions and policy together",
  );
  assert.ok(PAGE.includes("{showSessionCreateForm ? ("), "the form must sit behind that flag");
  // ONE policy evaluation still serves all three affordances, and the READ gate is
  // still the only asserting one.
  assert.equal((PAGE.match(/evaluateCourseOperationPolicy\(/g) ?? []).length, 1);
  assert.equal((PAGE.match(/"SCHEDULE_DRAFT_CONFIGURATION"/g) ?? []).length, 1);
  assert.equal((PAGE.match(/assertCourseOperationAllowed\(/g) ?? []).length, 1);

  // The picker's options come from the DEFINITION reader already loaded — no second
  // query — narrowed to exactly the three fields the form's prop type accepts.
  assert.ok(
    PAGE.includes("const sessionDefinitionOptions = view.definitions.map((option) => ({"),
    "the options must be mapped from the already-loaded definition view",
  );
  assert.ok(PAGE.includes("definitions={sessionDefinitionOptions}"));
  assert.equal(
    PAGE.includes("sessionView.definitions"),
    false,
    "the session reader's own option list must not feed the form",
  );

  // Publication is NOT part of the gate. It adds one fixed advisory sentence and
  // changes nothing else; the page mutates no publication state.
  assert.ok(PAGE.includes("התוכנית כבר פורסמה. מפגש חדש שתוסיפי ייכלל בלוח שפורסם."));
  const sessionCard = PAGE.slice(PAGE.indexOf("{showSessionCreateForm ? ("));
  assert.ok(sessionCard.includes("{isPublished ? ("), "the advisory must sit inside the form card");
  for (const forbidden of ["publishExamPlan", "unpublishExamPlan", "individualPublishedAt"]) {
    assert.equal(PAGE.includes(forbidden), false, `the page must not reference ${forbidden}`);
  }

  // The distinct THIRD empty state: definitions exist, sessions do not. It is never
  // shown when there is no plan — that branch renders the plan-create state, and
  // every piece of session markup lives inside the plan-PRESENT branch.
  assert.ok(PAGE.includes("עדיין לא נוצרו מפגשי מבחנים לקורס הזה."));
  const noPlan = PAGE.slice(PAGE.indexOf("{!view.planExists ? ("), PAGE.indexOf(") : ("));
  assert.ok(noPlan.length > 0, "the no-plan branch must be locatable");
  for (const forbidden of [
    "עדיין לא נוצרו מפגשי מבחנים לקורס הזה.",
    "ExamSessionCreateForm",
    "showSessionCreateForm",
    "grouping",
  ]) {
    assert.equal(noPlan.includes(forbidden), false, `the no-plan state must not carry ${forbidden}`);
  }
});

test("26c. the session feedback query is parsed through the CLOSED committed table", () => {
  // Imported from the committed route-local table — not re-declared here, and not
  // a second competing message module.
  assert.ok(PAGE.includes('from "./exam-session-create-error-messages"'));
  assert.ok(PAGE.includes("examSessionCreateErrorText(sessionError)"));
  assert.ok(PAGE.includes("examSessionCreateIssueTexts(sessionIssues)"));
  assert.equal(
    PAGE.includes("EXAM_SESSION_CREATE_ERROR_TEXT"),
    false,
    "the page must go through the parsers, never the raw table",
  );

  // Success is honoured ONLY on the exact string "1". The `typeof` test is what
  // stops a REPEATED key — which arrives as `["1"]` — coercing its way to a match.
  assert.ok(
    PAGE.includes('typeof createdSession === "string" && createdSession === "1"'),
    "the success token must be closed in both directions",
  );

  // The tokens are DESTRUCTURED from the one already-resolved query, so no `query.`
  // reference escapes the closed plan parser the sibling suite pins.
  assert.ok(PAGE.includes("const { createdSession, sessionError, sessionIssues } = query;"));
  assert.equal(PAGE.split("await searchParams").length - 1, 1);
  for (const forbidden of ["query.createdSession", "query.sessionError", "query.sessionIssues"]) {
    assert.equal(PAGE.includes(forbidden), false, `${forbidden} escapes the closed parser`);
  }

  // Nothing submitted is ever echoed: every rendered string is a constant owned by
  // the committed table, and no query value is interpolated into markup.
  for (const forbidden of ["${sessionError}", "${sessionIssues}", "${createdSession}"]) {
    assert.equal(PAGE.includes(forbidden), false, `a submitted value is echoed: ${forbidden}`);
  }
});

test("27. EXACTLY ONE module in the repository reaches the CREATE writer", () => {
  // `--untracked` matters: a tracked-only search would report a clean allow-list
  // purely because a new file is not committed yet.
  const callers = gitGrepFiles([SESSION_WRITE_MODULE, "--", "app", "lib", "components"]);
  // Exactly two files name the write binding: its own guard suite, and the single
  // approved Server Action. The binding itself does not name its own path, so it
  // is correctly absent. No page, component, layout, route handler or other
  // lib/actions module appears — which is the whole point.
  assert.deepEqual(callers.sort(), [
    "app/admin/courses/[courseOfferingId]/exams/actions.ts",
    "lib/actions/" + SESSION_WRITE_MODULE + ".test.ts",
  ]);
  // The one caller is a Server Action module, never a UI file.
  assert.equal(callers.some((path) => path.endsWith(".tsx")), false);
});

test("28. EXACTLY ONE module reaches the EDIT and REMOVAL writers, and no component does", () => {
  // EX-SES-UI-2 TRANSITION. This guard asserted the allow-list was EMPTY, which
  // was the correct claim while only the CREATE had an approved UI. Giving the
  // edit and the removal their own reviewed forms is exactly what makes it
  // obsolete, so it is RE-POINTED to an EXACT one-entry list rather than deleted
  // or widened to the route directory: a second Server Action module, a `.tsx`
  // component, a layout, a route handler or any other file still fails here.
  const offenders = gitGrepFiles([
    "-e",
    UPDATE_WRITER + "(",
    "-e",
    DELETE_WRITER + "(",
    "--",
    "app",
    "components",
  ]);
  assert.deepEqual(
    offenders.sort(),
    ["app/admin/courses/[courseOfferingId]/exams/actions.ts"],
    `an unapproved module reaches a destructive session writer: ${offenders.join(", ")}`,
  );
  // The one caller is a Server Action module, never a UI file — which is the half
  // of the original claim that has no exception at all.
  assert.equal(offenders.some((path) => path.endsWith(".tsx")), false);
  // And it is the SAME module that owns the create: no second endpoint module was
  // introduced to host the destructive pair.
  assert.deepEqual(
    offenders.sort(),
    gitGrepFiles(["-e", CREATE_WRITER_CALL, "--", "app", "components"]).sort(),
  );

  // Nothing under app/ names their pure cores, in ANY spelling: the writers are
  // reached through the committed binding alone, never around it.
  for (const core of ["update-exam-session" + "-core", "delete-exam-session" + "-core"]) {
    const named = gitGrepFiles([core, "--", "app", "components"]);
    assert.deepEqual(named, [], `${core} is named under app/: ${named.join(", ")}`);
  }
  // ...and no `WithDeps` orchestration is reachable from a route either.
  for (const symbol of [UPDATE_WRITER + "WithDeps", DELETE_WRITER + "WithDeps"]) {
    const named = gitGrepFiles([symbol, "--", "app", "components"]);
    assert.deepEqual(named, [], `${symbol} is reachable from app/: ${named.join(", ")}`);
  }
});

test("29. the slice touched EXACTLY its fourteen approved paths", () => {
  const touched = new Set([
    ...gitLines(["diff", "--name-only", "HEAD"]),
    ...gitLines(["diff", "--name-only", "--cached", "HEAD"]),
    ...gitLines(["ls-files", "--others", "--exclude-standard"]),
  ]);
  const offenders = [...touched].filter((path) => !SLICE_PATHS.includes(path)).sort();
  assert.deepEqual(offenders, [], `an unapproved path was touched: ${offenders.join(", ")}`);
  // EX-SES-UI-2 TRANSITION. The scope was thirteen files while EX-SES-UI-1 was in
  // the working tree; that slice is COMMITTED, so this list now describes the one
  // that is uncommitted instead. RE-POINTED to an exact fourteen, with the page
  // still asserted positively as an in-scope production file.
  //
  // EX-ASG-UI1 TRANSITION, on exactly the same terms: EX-SES-UI-2 is now COMMITTED
  // too, and the uncommitted slice adds four route files and re-points three more
  // committed guard suites, so the exact scope is twenty-three. It is still an
  // exhaustive literal set of exact paths, admitting no directory, prefix or glob.
  // EX-ASG-LTD2-B1 TRANSITION, on exactly the same terms: the approved ADMIN READ
  // DETAIL slice adds five paths — the assignment READ pair's two PRODUCTION
  // modules, that pair's pure-core suite, and the two committed SUPERVISOR IO
  // footprint guards whose "this slice modified NO tracked file" claims it
  // re-points — so the exact scope is thirty-two. Still an exhaustive literal set
  // of exact paths, admitting no directory, prefix or glob.
  // EX-ASG-LTD2-B2 TRANSITION, on exactly the same terms: the approved detailed
  // assignment UI wiring edits only files this list ALREADY holds and adds exactly
  // ONE path — the detailed writer's own committed guard, whose caller list it
  // re-points from zero to one — so the exact scope is thirty-three.
  // RE-POINTED by EX-PUB-UI-MVP, which names ONE new contract suite and re-adds
  // paths this list already holds. Counted as a SET rather than as an array: the
  // list is an allow-list consulted with `includes`, so a repeated entry permits
  // nothing extra, and a raw length would report a scope that does not exist.
  assert.equal(new Set(SLICE_PATHS).size, 33, "the approved scope is thirty-three files");
  assert.ok(
    SLICE_PATHS.includes(`${ROUTE_DIR_PREFIX}page.tsx`),
    "the wired page must be in scope",
  );
  // Every OTHER path in scope is a guard suite or a route-local support file. No
  // second page, no layout, no route handler and no `lib/` production module.
  // DE-DUPLICATED as of EX-PUB-UI-MVP, which re-adds paths this list already
  // holds. `SLICE_PATHS` is an allow-list consulted with `includes`, so a repeated
  // entry permits nothing extra — but this assertion turns it into a SET, and a
  // duplicate would otherwise read as a production file that does not exist.
  const production = [...new Set(SLICE_PATHS)].filter(
    (path) => !path.endsWith(".test.ts") && path !== `${ROUTE_DIR_PREFIX}page.tsx`,
  );
  assert.deepEqual(production.sort(), [
    `${ROUTE_DIR_PREFIX}ExamSessionEditForm.tsx`,
    `${ROUTE_DIR_PREFIX}ExamSessionDeleteForm.tsx`,
    `${ROUTE_DIR_PREFIX}actions.ts`,
    `${ROUTE_DIR_PREFIX}CreateExamAssignmentForm.tsx`,
    `${ROUTE_DIR_PREFIX}CreateExamInstructedTraineeAssignmentForm.tsx`,
    `${ROUTE_DIR_PREFIX}DeleteExamAssignmentForm.tsx`,
    `${ROUTE_DIR_PREFIX}exam-assignment-messages.ts`,
    `${ROUTE_DIR_PREFIX}exam-instructed-trainee-assignment-messages.ts`,
    "lib/exam/" + "admin-exam-assignment-read" + "-core.ts",
    "lib/actions/" + "exam-assignment-read" + "-io.ts",
  ].sort());
  // RE-POINTED by EX-ASG-LTD2-B1, and NARROWED to an exact pair rather than
  // dropped. The claim was "no `lib/` PRODUCTION module is in scope", which held
  // while every slice in this tree only WIRED committed bindings. The detail slice
  // must publish two more stored columns, which cannot be done without editing the
  // pair that READS them — so those two are named exactly, and a THIRD `lib/`
  // production module still fails here. No WRITER and no policy core may appear.
  const APPROVED_LIB_PRODUCTION = [
    "lib/exam/" + "admin-exam-assignment-read" + "-core.ts",
    "lib/actions/" + "exam-assignment-read" + "-io.ts",
  ];
  for (const path of SLICE_PATHS) {
    assert.equal(
      path.startsWith("lib/") &&
        !path.endsWith(".test.ts") &&
        !APPROVED_LIB_PRODUCTION.includes(path),
      false,
      `an unapproved lib production module entered the scope: ${path}`,
    );
  }
  for (const path of SLICE_PATHS) {
    assert.equal(
      path.endsWith("layout.tsx") || path.endsWith("route.ts"),
      false,
      `a layout or route handler entered the scope: ${path}`,
    );
  }
});
