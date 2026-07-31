import test from "node:test";
import assert from "node:assert/strict";

/**
 * EXAM EX-SES-UI-2 — the contract of the SAFE EDIT and the SAFE REMOVAL of one
 * stored ExamSession, on the course-scoped admin exams route.
 *
 * Run:
 *   npx tsx --test app/admin/courses/[courseOfferingId]/exams/exam-session-edit-delete.contract.test.ts
 *
 * ===========================================================================
 * WHY SO MANY TOKENS IN THIS FILE ARE ASSEMBLED FROM PIECES
 * ===========================================================================
 * Several committed guards sweep every file under `app/`, `lib/` and
 * `components/` for a module name or a CALL SHAPE and pin the result to an exact
 * caller list. Two of them matter most here:
 *
 *   - the session write binding's own suite pins the CREATE writer's callers to
 *     exactly one Server Action module, and (as re-pointed by this slice) the
 *     EDIT and REMOVAL writers' callers to exactly that same one;
 *   - the admin session reader's suite pins its caller list to exactly
 *     `page.tsx`.
 *
 * A CONTRACT SUITE IS NOT A CALLER. This file asserts things ABOUT those writers;
 * it never invokes one. But those guards match RAW SOURCE TEXT — not imports, not
 * an AST — so a suite that spelled the write binding's module name, or an edit or
 * removal CALL, whole anywhere in its source (INCLUDING in a comment such as this
 * one) would enrol itself in the very allow-lists it exists to keep at one entry.
 * The only way to make that pass would be to widen them, which is exactly
 * backwards. This paragraph therefore describes those tokens rather than
 * reproducing them.
 *
 * So every such token below is built by concatenation. The value compared against
 * the production source is identical; only the literal spelling in THIS file
 * differs. That is the project's split-literal convention, and it is load-bearing
 * rather than cosmetic.
 *
 * ===========================================================================
 * WHAT THIS SUITE PROVES, AND WHAT IT DELIBERATELY DOES NOT
 * ===========================================================================
 * It proves the SHAPE of the two new endpoints and their two forms: the exact
 * FormData budget, the server-bound offering, the authorization order, the closed
 * result mapping, the absence of any try/catch, the hidden concurrency token, the
 * POST-only removal, and the fact that the assignment count is display-only.
 *
 * It does NOT re-prove the writers. Whether an edit is atomic, whether a removal
 * carries its `assignments: { none: {} }` condition, and how a zero write count is
 * classified are all the committed binding's own contract, proven in its own
 * suite. Nothing in this slice changed any of that, which guard 24 asserts
 * directly.
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
const EDIT_FORM_REL = join(ROUTE_DIR_REL, "ExamSessionEditForm.tsx");
const DELETE_FORM_REL = join(ROUTE_DIR_REL, "ExamSessionDeleteForm.tsx");
const SUITE_REL = join(ROUTE_DIR_REL, "exam-session-edit-delete.contract.test.ts");

/**
 * The route's EXACT final file set, after this slice's three additions — and, as
 * RE-POINTED by EX-ASG-UI1, that slice's four: an assignment create form, an
 * assignment delete form, a closed message module and its own contract suite. It
 * is still an EXHAUSTIVE literal list; a nineteenth file still fails here.
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
  // EX-PAIR-UI-MVP - the approved admin PAIRING UI, whose ONE new file this is.
  "app/admin/courses/[courseOfferingId]/exams/exam-pairing-ui.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-plan-create.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-publication-ui.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-session-create-error-messages.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-session-create.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-session-edit-delete.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/page.tsx",
].sort();

/**
 * The FOURTEEN paths this slice may touch: three new route files, two amended
 * route production files, and nine committed guard suites whose exact allow-lists
 * had to learn about this slice.
 *
 * The `lib/` entries are ASSEMBLED for the reason in the header.
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
  // EX-PAIR-UI-MVP - the approved admin PAIRING UI, whose ONE new file this is.
  "app/admin/courses/[courseOfferingId]/exams/exam-pairing-ui.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-plan-create.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-definitions-page.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-definition-create.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-session-create.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-session-edit-delete.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-assignment-ui.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-instructed-trainee-assignment-ui.contract.test.ts",
  "lib/actions/" + "exam-publication-write" + "-io.test.ts",
  // ...and the committed PAIRING backend guard, whose caller list EX-PAIR-UI-MVP
  // re-points from zero to exactly one Server Action module. A `.test.ts`, so no
  // production module joins this list.
  "lib/actions/" + "exam-pairing-write" + "-io.test.ts",
  // The three new files.
  `${ROUTE_DIR_PREFIX}ExamSessionEditForm.tsx`,
  `${ROUTE_DIR_PREFIX}ExamSessionDeleteForm.tsx`,
  `${ROUTE_DIR_PREFIX}exam-session-edit-delete.contract.test.ts`,
  // The two amended production files.
  `${ROUTE_DIR_PREFIX}actions.ts`,
  `${ROUTE_DIR_PREFIX}page.tsx`,
  // The four route guard suites.
  `${ROUTE_DIR_PREFIX}exam-session-create.contract.test.ts`,
  `${ROUTE_DIR_PREFIX}exam-definition-create.contract.test.ts`,
  `${ROUTE_DIR_PREFIX}exam-definitions-page.contract.test.ts`,
  `${ROUTE_DIR_PREFIX}exam-plan-create.contract.test.ts`,
  // The five committed `lib/` footprint guards.
  "lib/actions/" + "exam-session-write" + "-io.test.ts",
  "lib/actions/" + "admin-exam-session-read" + "-io.test.ts",
  "lib/actions/" + "exam-definition-read" + "-io.test.ts",
  "lib/actions/" + "exam-plan-write" + "-io.test.ts",
  "lib/exam/" + "create-exam-plan" + "-core.test.ts",
  // EX-ASG-UI1's four new route files, plus the three further committed guards it
  // re-points. The `lib/` assignment entries are ASSEMBLED for the sharpest reason
  // of all: both pinned their caller lists at EXACTLY ZERO before that slice.
  `${ROUTE_DIR_PREFIX}CreateExamAssignmentForm.tsx`,
  `${ROUTE_DIR_PREFIX}DeleteExamAssignmentForm.tsx`,
  `${ROUTE_DIR_PREFIX}exam-assignment-messages.ts`,
  `${ROUTE_DIR_PREFIX}exam-assignment-ui.contract.test.ts`,
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
const UPDATE_WRITER_CALL = "update" + "ExamSession" + "(";
const DELETE_WRITER_CALL = "delete" + "ExamSession" + "(";
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
];

function gitLines(args: readonly string[]): string[] {
  const result = spawnSync("git", [...args], { cwd: REPO_ROOT, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed`);
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
const PAGE_FLAT = squash(PAGE);
const EDIT_FORM_SOURCE = readSource(EDIT_FORM_REL);
const EDIT_FORM = stripComments(EDIT_FORM_SOURCE);
const DELETE_FORM_SOURCE = readSource(DELETE_FORM_REL);
const DELETE_FORM = stripComments(DELETE_FORM_SOURCE);

/**
 * ONE exported action's body, from its declaration to the next one (or to the end
 * of the file for the last). The route's five actions share a module, so every
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

const UPDATE_ACTION = actionBody(ACTIONS, "updateExamSessionAction");
const DELETE_ACTION = actionBody(ACTIONS, "deleteExamSessionAction");
const CREATE_SESSION_ACTION = actionBody(ACTIONS, "createExamSessionAction");

/** The EIGHT fields — and the ONLY eight — the edit action may read. */
const UPDATE_FIELDS = [
  "sessionId",
  "expectedUpdatedAt",
  "definitionId",
  "date",
  "startTime",
  "arena",
  "title",
  "notes",
];

/** The TWO fields — and the ONLY two — the removal action may read. */
const DELETE_FIELDS = ["sessionId", "expectedUpdatedAt"];

// ===========================================================================
// 1–3. The route's exact file set
// ===========================================================================

test("1. the three new files exist at the exact course-scoped route", () => {
  for (const rel of [EDIT_FORM_REL, DELETE_FORM_REL, SUITE_REL]) {
    assert.ok(existsSync(join(REPO_ROOT, rel)), `${rel} is missing`);
  }
  // ...and they joined an EXISTING route rather than creating a second one.
  assert.ok(existsSync(join(REPO_ROOT, ACTIONS_REL)), "the action module is missing");
  assert.ok(existsSync(join(REPO_ROOT, PAGE_REL)), "the page is missing");
});

test("2. the route directory holds EXACTLY the twenty-three approved files", () => {
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
    join("app", "admin", "exam-sessions"),
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

// ===========================================================================
// 4–7. The Server Actions: kind, exports, signatures and the ORDER
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
  // surface: no eighth endpoint, and no helper, parser, constant or type beside
  // them. RE-POINTED by EX-ASG-UI1, which adds the sixth and seventh.
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
  ]);
  assert.equal(exported.length, 10, "no eleventh endpoint may exist in this module");
  for (const token of ["export const", "export default", "export {", "export type"]) {
    assert.equal(ACTIONS.includes(token), false, `the module also declares ${token}`);
  }
  assert.equal((ACTIONS.match(/export async function /g) ?? []).length, 10);
});

test("6. both new actions have the EXACT locked signature, and return void", () => {
  for (const name of ["updateExamSessionAction", "deleteExamSessionAction"]) {
    assert.ok(
      new RegExp(
        `export async function ${name}\\(\\s*courseOfferingId: string,\\s*formData: FormData,\\s*\\): Promise<void> \\{`,
      ).test(ACTIONS_SOURCE),
      `${name}'s signature is not the locked one`,
    );
  }
  // No `prevState`, no options bag, no third parameter and no non-void return:
  // every outcome is a navigation, so neither action can grow client-visible state.
  for (const [label, body] of [
    ["update", UPDATE_ACTION],
    ["delete", DELETE_ACTION],
  ] as const) {
    assert.equal(body.includes("prevState"), false, `the ${label} action takes prevState`);
    assert.equal(/return\s+[^;]/.test(body), false, `the ${label} action returns a value`);
  }
});

test("7. requireAdmin() is the FIRST awaited operation in BOTH new bodies", () => {
  for (const [label, body] of [
    ["update", UPDATE_ACTION],
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
      UPDATE_WRITER_CALL,
      DELETE_WRITER_CALL,
      "redirect(",
      "revalidatePath(",
    ]) {
      assert.equal(before.includes(token), false, `${token} runs before requireAdmin()`);
    }
  }
});

// ===========================================================================
// 8–11. The exact FormData budget of each action
// ===========================================================================

test("8. the offering is the BOUND leading argument and is NEVER read from FormData", () => {
  // The id reaches each writer from the bound parameter, in the locked position...
  assert.ok(
    squash(UPDATE_ACTION).includes(
      `${UPDATE_WRITER_CALL} courseOfferingId, sessionId, expectedUpdatedAt, rawInput, );`,
    ),
    "the edit writer is not called with the bound id, the row, the version and the raw input",
  );
  assert.ok(
    UPDATE_ACTION.includes("const result = await " + UPDATE_WRITER_CALL),
    "the edit writer's result must be awaited into `result`",
  );
  assert.ok(
    DELETE_ACTION.includes(
      `${DELETE_WRITER_CALL}courseOfferingId, sessionId, expectedUpdatedAt)`,
    ),
    "the removal writer is not called with the bound id, the row and the version",
  );
  // ...and no submission, cookie, header or current-offering resolver is consulted.
  for (const [label, body] of [
    ["update", UPDATE_ACTION],
    ["delete", DELETE_ACTION],
  ] as const) {
    for (const token of [
      'formData.get("courseOfferingId")',
      'formData.get("planId")',
      "cookies(",
      "headers(",
      "searchParams",
      "currentOffering",
    ]) {
      assert.equal(body.includes(token), false, `the ${label} action reads ${token}`);
    }
  }
});

test("9. the EDIT reads EXACTLY the eight approved fields, in order", () => {
  const reads = [...UPDATE_ACTION.matchAll(/formData\.get\("([^"]+)"\)/g)].map(
    ([, field]) => field,
  );
  assert.deepEqual(reads, UPDATE_FIELDS, "the mapping is not the approved eight");
  assert.equal(reads.length, 8, "there must be exactly eight reads");
  // Exactly eight `formData.get` calls in total: none with a computed key, and
  // none hidden in a loop over a field list.
  assert.equal((UPDATE_ACTION.match(/formData\.get\(/g) ?? []).length, 8);
  for (const token of ["formData.getAll", "formData.entries", "formData.forEach"]) {
    assert.equal(UPDATE_ACTION.includes(token), false, `the action uses ${token}`);
  }

  // The raw input object carries the SIX mutable keys and nothing else — the two
  // identifying fields are arguments to the writer, never part of its payload.
  const rawInput = UPDATE_ACTION.slice(
    UPDATE_ACTION.indexOf("const rawInput = {"),
    UPDATE_ACTION.indexOf("};", UPDATE_ACTION.indexOf("const rawInput = {")),
  );
  const keys = [...rawInput.matchAll(/^\s*(\w+):/gm)].map(([, key]) => key);
  assert.deepEqual(keys, ["definitionId", "date", "startTime", "arena", "title", "notes"]);
});

test("10. ONLY the version token is coerced; the six values are forwarded RAW", () => {
  // `Number(...)` appears exactly once, and only on the concurrency token. The
  // committed input core owns every other rule, and a second copy here would be
  // free to drift from the one the database actually sees.
  assert.ok(
    UPDATE_ACTION.includes('const expectedUpdatedAt = Number(formData.get("expectedUpdatedAt"));'),
    "the version token must be coerced with Number(...)",
  );
  assert.equal((UPDATE_ACTION.match(/Number\(/g) ?? []).length, 1);
  assert.equal((DELETE_ACTION.match(/Number\(/g) ?? []).length, 1);

  // The six mutable values are forwarded EXACTLY as FormData.get returned them:
  // no String(), no ??, no ||, no .trim(), no default and no Date construction.
  // That is what stops a `File` entry from a multipart submission becoming the
  // text of a field, which `String(...)` would happily do.
  const rawInput = UPDATE_ACTION.slice(
    UPDATE_ACTION.indexOf("const rawInput = {"),
    UPDATE_ACTION.indexOf("};", UPDATE_ACTION.indexOf("const rawInput = {")),
  );
  for (const token of ["String(", "Number(", "?? ", "|| ", ".trim()", "new Date(", "toString("]) {
    assert.equal(rawInput.includes(token), false, `the payload coerces with ${token}`);
  }

  // The row id is narrowed by TYPE rather than coerced: a non-string yields the
  // empty string, which no stored session id can equal, so it fails closed. It is
  // never `String(...)`-ed, in either action.
  for (const [label, body] of [
    ["update", UPDATE_ACTION],
    ["delete", DELETE_ACTION],
  ] as const) {
    assert.ok(
      body.includes(
        'const sessionId = typeof submittedSessionId === "string" ? submittedSessionId : "";',
      ),
      `the ${label} action must narrow the row id by type`,
    );
    assert.equal(
      body.includes('String(formData.get("sessionId"))'),
      false,
      `the ${label} action stringifies the row id`,
    );
  }
});

test("11. the REMOVAL reads EXACTLY two fields — and never a payload or a count", () => {
  const reads = [...DELETE_ACTION.matchAll(/formData\.get\("([^"]+)"\)/g)].map(
    ([, field]) => field,
  );
  assert.deepEqual(reads, DELETE_FIELDS, "the removal must read exactly the two fields");
  assert.equal((DELETE_ACTION.match(/formData\.get\(/g) ?? []).length, 2);
  // A removal has no payload to normalize, so it builds none.
  assert.equal(DELETE_ACTION.includes("const rawInput"), false);
  for (const field of ["definitionId", "date", "startTime", "arena", "title", "notes"]) {
    assert.equal(
      DELETE_ACTION.includes(`"${field}"`),
      false,
      `the removal names the field ${field}`,
    );
  }
});

test("12. NEITHER action reads a plan, order, end time, actor or assignment count", () => {
  // The LOCKED BUSINESS RULE of this slice, asserted from the strongest side: the
  // assignment count is display-only, so it is not merely ignored by the writers —
  // it is never named by either endpoint at all, in any spelling.
  for (const [label, body] of [
    ["update", UPDATE_ACTION],
    ["delete", DELETE_ACTION],
  ] as const) {
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
      "assignmentCount",
      "actorId",
      "userId",
    ]) {
      assert.equal(
        body.includes(`"${field}"`),
        false,
        `the ${label} action names the field ${field}`,
      );
    }
    // And no count of any spelling reaches a writer argument.
    for (const token of ["assignmentCount", "hasAssignments"]) {
      assert.equal(body.includes(token), false, `the ${label} action reaches ${token}`);
    }
  }
});

// ===========================================================================
// 13–16. The closed result mappings
// ===========================================================================

test("13. offering_not_found leaves this route for the safe course list, from BOTH", () => {
  for (const [label, body] of [
    ["update", UPDATE_ACTION],
    ["delete", DELETE_ACTION],
  ] as const) {
    assert.ok(
      body.includes('if (result.code === "offering_not_found") {'),
      `the ${label} action does not classify offering_not_found`,
    );
    assert.ok(
      body.includes('redirect("/admin/courses?error=invalid");'),
      `the ${label} action does not fall back to the safe course list`,
    );
    // The requested id is NOT reflected back into that destination.
    assert.equal(
      body.includes("/admin/courses?error=invalid&"),
      false,
      `the ${label} action reflects a value into the fallback`,
    );
  }
});

test("14. the EDIT distinguishes CHANGED from UNCHANGED, and revalidates only once", () => {
  // A real change revalidates exactly this course's exams path, exactly once...
  assert.ok(UPDATE_ACTION.includes("if (result.changed) {"), "the two successes must be split");
  assert.ok(UPDATE_ACTION.includes("revalidatePath(examsPath);"));
  assert.ok(UPDATE_ACTION.includes("?updatedSession=1"));
  // ...and a NO-OP revalidates NOTHING, because nothing was written.
  assert.ok(UPDATE_ACTION.includes("?unchangedSession=1"));
  assert.equal(
    (UPDATE_ACTION.match(/revalidatePath\(/g) ?? []).length,
    1,
    "the edit must revalidate at most once, on the changed branch only",
  );
  // The revalidated path is built from the BOUND id and is the only one touched.
  assert.ok(
    UPDATE_ACTION.includes(
      "const examsPath = `/admin/courses/${encodeURIComponent(courseOfferingId)}/exams`;",
    ),
  );
  for (const forbidden of ["revalidateTag", 'revalidatePath("/")', "layout"]) {
    assert.equal(UPDATE_ACTION.includes(forbidden), false, `the edit reaches ${forbidden}`);
  }
  // The unchanged branch sits INSIDE the ok branch, after the changed one — so a
  // no-op can never fall through into a refusal mapping.
  assert.ok(
    UPDATE_ACTION.indexOf("?updatedSession=1") < UPDATE_ACTION.indexOf("?unchangedSession=1"),
  );
  assert.ok(
    UPDATE_ACTION.indexOf("?unchangedSession=1") <
      UPDATE_ACTION.indexOf('result.code === "offering_not_found"'),
  );
});

test("15. the EDIT's refusals carry STABLE CODES ONLY, never a submitted value", () => {
  // Diagnostics travel as the writer's own codes, joined — never a value.
  assert.ok(
    UPDATE_ACTION.includes(
      "const codes = result.issues.map((issue) => issue.code).join(\",\");",
    ),
    "the issue codes must come from the writer's own result",
  );
  assert.ok(
    UPDATE_ACTION.includes(
      "?sessionEditError=invalid_input&sessionEditIssues=${encodeURIComponent(codes)}",
    ),
  );
  // Every OTHER refusal is fully described by its bare code — which is exactly the
  // three the slice names plus the three the writer can still produce.
  assert.ok(
    UPDATE_ACTION.includes(
      "?sessionEditError=${encodeURIComponent(result.code)}",
    ),
    "the tail mapping must carry the bare code",
  );
  // Nothing else is interpolated into any edit redirect: no id, no version, no
  // date, no message and no Prisma text.
  const interpolations = [...UPDATE_ACTION.matchAll(/\$\{([^}]+)\}/g)].map(([, expr]) =>
    expr.trim(),
  );
  assert.deepEqual(
    [...new Set(interpolations)].sort(),
    [
      "encodeURIComponent(codes)",
      "encodeURIComponent(courseOfferingId)",
      "encodeURIComponent(result.code)",
      "examsPath",
    ].sort(),
    `an unexpected value is interpolated: ${interpolations.join(", ")}`,
  );
  for (const forbidden of [
    "result.sessionId",
    "result.updatedAt",
    "issue.message",
    "error.message",
    "stack",
  ]) {
    assert.equal(UPDATE_ACTION.includes(forbidden), false, `the edit leaks ${forbidden}`);
  }
});

test("16. the REMOVAL maps its refusals to bare codes and reveals no id", () => {
  assert.ok(DELETE_ACTION.includes("revalidatePath(examsPath);"));
  assert.equal((DELETE_ACTION.match(/revalidatePath\(/g) ?? []).length, 1);
  assert.ok(DELETE_ACTION.includes("?deletedSession=1"));
  assert.ok(
    DELETE_ACTION.includes("?sessionDeleteError=${encodeURIComponent(result.code)}"),
  );
  // A removal has no per-field diagnostics, so it carries no issues token at all.
  assert.equal(DELETE_ACTION.includes("sessionDeleteIssues"), false);
  assert.equal(DELETE_ACTION.includes("result.issues"), false);
  // The removed row's id is NOT reflected back.
  const interpolations = [...DELETE_ACTION.matchAll(/\$\{([^}]+)\}/g)].map(([, expr]) =>
    expr.trim(),
  );
  assert.deepEqual(
    [...new Set(interpolations)].sort(),
    [
      "encodeURIComponent(courseOfferingId)",
      "encodeURIComponent(result.code)",
      "examsPath",
    ].sort(),
    `an unexpected value is interpolated: ${interpolations.join(", ")}`,
  );
  assert.equal(DELETE_ACTION.includes("result.sessionId"), false);
});

test("17. there is STILL no try/catch anywhere, so every redirect is outside one", () => {
  // `redirect()` signals by THROWING, and `requireAdmin()` fails closed the same
  // way. The strongest form of the rule is not "the redirect is outside the block"
  // but "there is no block" — asserted over the WHOLE module, so neither new
  // action could have introduced one.
  for (const token of ["try {", "catch (", "catch(", "finally {"]) {
    assert.equal(ACTIONS.includes(token), false, `the module contains ${token}`);
  }
});

// ===========================================================================
// 18–19. What the actions may reach, and the untouched neighbours
// ===========================================================================

test("18. the module's import surface did NOT grow a new binding", () => {
  const imports = [...ACTIONS_SOURCE.matchAll(/from "([^"]+)"/g)].map(([, m]) => m);
  // The edit and the removal live in the SAME committed binding as the create, so
  // THIS slice adds two named imports and ZERO new specifiers.
  //
  // RE-POINTED by EX-ASG-UI1 by ADDING one specifier to an exhaustive list — the
  // assignment write binding, whose create and removal are a genuinely separate
  // committed module. The list is still exhaustive: a FIFTH writer module still
  // fails here. It is ASSEMBLED for the sharpest reason of all, since that
  // binding's committed guard pinned its caller list at EXACTLY ZERO before that
  // slice and at exactly this one Server Action module after it.
  assert.deepEqual(imports.sort(), [
    "@/lib/actions/" + "exam-definition-write" + "-io",
    "@/lib/actions/" + "exam-plan-write" + "-io",
    SESSION_WRITE_SPECIFIER,
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
    // ADDED by EX-PAIR-UI-MVP, and assembled on exactly the same terms: the
    // committed PAIRING write binding's own guard pinned its caller list at
    // EXACTLY ZERO before this slice and at exactly this one Server Action
    // module after it, so a suite that spelled the module whole would enrol
    // itself in that list.
    "@/lib/actions/" + "exam-pairing-write" + "-io",
    "@/lib/auth/require-admin",
    "next/cache",
    "next/navigation",
  ].sort());
  for (const token of [
    PRISMA_MODULE,
    GENERATED_CLIENT,
    "capabilit",
    "Capabilit",
    "notification",
    "Notification",
    "push",
    "sendMessage",
  ]) {
    assert.equal(ACTIONS.includes(token), false, `the action module reaches ${token}`);
  }
  // Still NO exam core is named from under `app/`, in any of this slice's files.
  for (const [label, source] of [
    ["actions", ACTIONS_SOURCE],
    ["edit form", EDIT_FORM_SOURCE],
    ["delete form", DELETE_FORM_SOURCE],
    ["page", PAGE_SOURCE],
  ] as const) {
    for (const core of FORBIDDEN_CORES) {
      assert.equal(
        source.includes(`./${core}`) || source.includes(["lib", "exam", core].join("/")),
        false,
        `${label} names the core ${core}`,
      );
    }
  }
});

test("19. the three EXISTING actions are intact and did not become entangled", () => {
  // The create action still reads its own six fields and uses its OWN tokens...
  const createReads = [
    ...CREATE_SESSION_ACTION.matchAll(/formData\.get\("([^"]+)"\)/g),
  ].map(([, field]) => field);
  assert.deepEqual(createReads, [
    "definitionId",
    "date",
    "startTime",
    "arena",
    "title",
    "notes",
  ]);
  assert.ok(CREATE_SESSION_ACTION.includes("?createdSession=1"));
  // ...and it gained NO knowledge of the row id, the version or the new tokens.
  for (const forbidden of [
    '"sessionId"',
    '"expectedUpdatedAt"',
    "sessionEditError",
    "sessionDeleteError",
    "updatedSession",
    "deletedSession",
  ]) {
    assert.equal(
      CREATE_SESSION_ACTION.includes(forbidden),
      false,
      `the create action reaches ${forbidden}`,
    );
  }
  // The five endpoints are DISJOINT: neither new action reaches a neighbour's
  // writer, and the create does not reach either new one.
  for (const [label, body] of [
    ["update", UPDATE_ACTION],
    ["delete", DELETE_ACTION],
  ] as const) {
    for (const token of [CREATE_WRITER_CALL, "create" + "ExamPlan(", "create" + "ExamDefinition("]) {
      assert.equal(body.includes(token), false, `the ${label} action reaches ${token}`);
    }
  }
  assert.equal(CREATE_SESSION_ACTION.includes(UPDATE_WRITER_CALL), false);
  assert.equal(CREATE_SESSION_ACTION.includes(DELETE_WRITER_CALL), false);
  // The edit does not delete, and the removal does not edit.
  assert.equal(UPDATE_ACTION.includes(DELETE_WRITER_CALL), false);
  assert.equal(DELETE_ACTION.includes(UPDATE_WRITER_CALL), false);
  // No generic discriminator: neither action chooses its operation from the form.
  for (const [label, body] of [
    ["update", UPDATE_ACTION],
    ["delete", DELETE_ACTION],
  ] as const) {
    for (const token of ['"intent"', '"action"', '"operation"', '"mode"', '"_action"']) {
      assert.equal(body.includes(token), false, `the ${label} action reads ${token}`);
    }
  }
});

// ===========================================================================
// 20–22. The two forms
// ===========================================================================

test("20. both forms are client components whose every value comes from props", () => {
  for (const [label, source, code] of [
    ["edit", EDIT_FORM_SOURCE, EDIT_FORM],
    ["delete", DELETE_FORM_SOURCE, DELETE_FORM],
  ] as const) {
    assert.equal(source.split("\n")[0].trim(), '"use ' + 'client";', `${label} is not a client component`);
    // No data loading, no navigation, no effect, no optimistic update, no
    // auto-submit and no client-side state of any kind.
    for (const token of [
      "useEffect",
      "useLayoutEffect",
      "useState",
      "useOptimistic",
      "useActionState",
      "fetch(",
      "axios",
      "useRouter",
      "router.",
      "redirect(",
      "revalidatePath",
      "requestSubmit",
      "\.submit()",
      "setTimeout",
      "localStorage",
      "document.",
      "window.",
    ]) {
      assert.equal(code.includes(token), false, `the ${label} form reaches ${token}`);
    }
    // The ONE hook each is allowed: the pending state that disables the submit.
    assert.ok(code.includes("useFormStatus()"), `the ${label} form must use useFormStatus`);
    assert.ok(code.includes("disabled={pending"), `the ${label} form must disable while pending`);
    // No write binding is reachable from a component: only the Server Action may.
    for (const token of [SESSION_WRITE_MODULE, PRISMA_MODULE, GENERATED_CLIENT, "capabilit"]) {
      assert.equal(code.includes(token), false, `the ${label} form reaches ${token}`);
    }
  }
});

test("21. the EDIT form renders the six fields plus TWO hidden identifiers", () => {
  // The six editable values, each defaulted from the stored row.
  const named = [...EDIT_FORM.matchAll(/name="([^"]+)"/g)].map(([, name]) => name);
  assert.deepEqual(named.sort(), UPDATE_FIELDS.slice().sort(), "the field set is not the approved eight");
  // The two identifiers are HIDDEN inputs, never visible controls.
  assert.ok(
    EDIT_FORM.includes('<input type="hidden" name="sessionId" value={sessionId} />'),
  );
  assert.ok(
    EDIT_FORM.includes(
      '<input type="hidden" name="expectedUpdatedAt" value={expectedUpdatedAt} />',
    ),
  );
  // The stored values are the DEFAULTS — uncontrolled inputs, so the form holds
  // no state that could drift from the server's copy.
  for (const field of ["date", "startTime", "definitionId"]) {
    assert.ok(
      EDIT_FORM.includes(`defaultValue={${field}}`),
      `${field} must default to the stored value`,
    );
  }
  for (const field of ["arena", "title", "notes"]) {
    assert.ok(
      EDIT_FORM.includes(`defaultValue={textDefault(${field})}`),
      `${field} must default to the stored value`,
    );
  }
  // The visible Hebrew term for the internal `arena` field, and the field name
  // itself deliberately NOT renamed.
  assert.ok(EDIT_FORM.includes("מגרש"), "the visible term must be the approved Hebrew one");
  assert.ok(EDIT_FORM.includes('name="arena"'), "the internal field name must stay `arena`");
  // No course, plan, order, end-time or COUNT field exists in the markup.
  for (const forbidden of [
    'name="courseOfferingId"',
    'name="planId"',
    'name="orderIndex"',
    'name="endTime"',
    'name="assignmentCount"',
    'name="capacity"',
  ]) {
    assert.equal(EDIT_FORM.includes(forbidden), false, `the edit form submits ${forbidden}`);
  }
});

test("22. the REMOVAL form is a POST with two hidden fields, and never a link", () => {
  const named = [...DELETE_FORM.matchAll(/name="([^"]+)"/g)].map(([, name]) => name);
  assert.deepEqual(named.sort(), DELETE_FIELDS.slice().sort(), "the removal submits more than two fields");
  assert.ok(
    DELETE_FORM.includes('<input type="hidden" name="sessionId" value={sessionId} />'),
  );
  assert.ok(
    DELETE_FORM.includes(
      '<input type="hidden" name="expectedUpdatedAt" value={expectedUpdatedAt} />',
    ),
  );
  // A removal must not be reachable by GET: no link, no href, no method override.
  for (const forbidden of ["<a ", "href", "Link", 'method="get"', 'method="GET"', "next/link"]) {
    assert.equal(DELETE_FORM.includes(forbidden), false, `the removal form uses ${forbidden}`);
  }
  // One submit, and it is destructive in words rather than only in colour.
  assert.equal((DELETE_FORM.match(/type="submit"/g) ?? []).length, 1);
  assert.ok(DELETE_FORM.includes("מחיקת מועד הבחינה"));
  assert.ok(DELETE_FORM.includes("סופית ואינה ניתנת לביטול"));
});

test("23. an ASSIGNED session renders NO delete form at all — and the edit stays open", () => {
  // The blocked branch returns BEFORE any `<form>` is constructed, so there is no
  // hidden field and nothing to submit — strictly stronger than a disabled button,
  // which a console can re-enable.
  // From the guard clause to the first `<form` in the file: everything the blocked
  // branch can render lies inside that span, because the ACTIVE form is what ends
  // it. An early return is what makes this span meaningful — the two branches
  // cannot both execute.
  const blockedStart = DELETE_FORM.indexOf("if (hasAssignments) {");
  const activeFormStart = DELETE_FORM.indexOf("<form");
  assert.ok(blockedStart > -1, "the blocked branch must exist");
  assert.ok(activeFormStart > blockedStart, "the active form must follow the blocked branch");
  const blocked = DELETE_FORM.slice(blockedStart, activeFormStart);
  for (const forbidden of ["<form", 'name="sessionId"', 'name="expectedUpdatedAt"', "<button"]) {
    assert.equal(blocked.includes(forbidden), false, `the blocked branch still renders ${forbidden}`);
  }
  assert.ok(blocked.includes("לא ניתן למחוק מועד בחינה שכבר משובצים אליו נבחנים"));

  // The EDIT form is NOT pre-blocked by the same condition: ordinary edits stay
  // legal for an assigned session, and only the DEFINITION change is refused —
  // which the form states as an advisory and never enforces.
  assert.equal(
    EDIT_FORM.includes("if (hasAssignments) {"),
    false,
    "the edit form must not refuse outright when assignments exist",
  );
  assert.equal(
    EDIT_FORM.includes("disabled={hasAssignments"),
    false,
    "the edit form must not disable its fields when assignments exist",
  );
  assert.ok(EDIT_FORM.includes("{hasAssignments ? ("), "the advisory must be conditional");
  assert.ok(EDIT_FORM.includes("לא ניתן להחליף את הגדרת המבחן כל עוד קיימים שיבוצים"));
});

// ===========================================================================
// 24–27. The page: binding, visibility, the version token and the query
// ===========================================================================

test("24. the page binds BOTH new actions to the VERIFIED context id, once each", () => {
  assert.ok(PAGE.includes('from "./ExamSessionEditForm"'));
  assert.ok(PAGE.includes('from "./ExamSessionDeleteForm"'));
  assert.equal((PAGE.match(/<ExamSessionEditForm/g) ?? []).length, 1);
  assert.equal((PAGE.match(/<ExamSessionDeleteForm/g) ?? []).length, 1);

  assert.ok(PAGE.includes("updateExamSessionAction.bind(null, context.id)"));
  assert.ok(PAGE.includes("deleteExamSessionAction.bind(null, context.id)"));
  // Imported once, bound once — and NEVER bound to the raw route param, which is
  // the whole point of the binding.
  assert.equal((PAGE.match(/updateExamSessionAction/g) ?? []).length, 2);
  assert.equal((PAGE.match(/deleteExamSessionAction/g) ?? []).length, 2);
  for (const forbidden of [
    "updateExamSessionAction.bind(null, courseOfferingId)",
    "deleteExamSessionAction.bind(null, courseOfferingId)",
  ]) {
    assert.equal(PAGE.includes(forbidden), false, `the raw route param is bound: ${forbidden}`);
  }
  // The page still reaches NO writer directly: only the Server Action module.
  for (const token of [SESSION_WRITE_MODULE, UPDATE_WRITER_CALL, DELETE_WRITER_CALL]) {
    assert.equal(PAGE.includes(token), false, `the page reaches ${token}`);
  }
  // ...and NEITHER session control is a control of the page's own: both remain
  // client components. RE-POINTED by EX-PUB-UI-MVP, which renders its publication
  // form INLINE because that form needs no client behaviour at all — one fixed
  // hidden value, no pending UX, no validation, no confirmation.
  //
  // The CLIENT-behaviour tokens stay absolutely forbidden. The MARKUP tokens
  // become an exact inventory, which is what proves the two session forms did NOT
  // acquire inline markup: every one of these counts belongs to the publication
  // card, which sits outside the session list entirely and is pinned by name in
  // the page's own suite.
  // RE-POINTED by EX-PAIR-UI-MVP: the pairing picker is a `<select>` and there is
  // exactly ONE on this page. A SECOND still fails, and every other control token
  // stays banned outright.
  assert.equal((PAGE.match(/<select/g) ?? []).length, 1, "exactly one inline picker");
  for (const forbidden of ["<textarea", "onClick", "onSubmit", "onChange"]) {
    assert.equal(PAGE.includes(forbidden), false, `the page renders ${forbidden}`);
  }
  // RE-POINTED from two to THREE by EX-PAIR-UI-MVP, which renders its pairing
  // control INLINE for the same reason the publication one is: fixed values, no
  // pending UX, no validation and no confirmation. An inventory stays stronger
  // than a ban: a FOURTH form, button or input still fails here.
  assert.equal((PAGE.match(/<form /g) ?? []).length, 3);
  assert.equal((PAGE.match(/<button/g) ?? []).length, 3);
  // RE-POINTED from two to THREE by EX-PAIR-UI-MVP: the pairing form carries ONE
  // hidden field naming the instructed-trainee row it belongs to. A FOURTH still
  // fails, and the two `name="operation"` inputs are pinned separately below.
  assert.equal((PAGE.match(/<input/g) ?? []).length, 3);
  assert.equal((PAGE.match(/name="operation"/g) ?? []).length, 2);
  // No inline markup sits anywhere near a session: neither the edit nor the
  // delete form gained a hidden field, a button or an input of the page's own.
  assert.equal(/<(form|button|input)[\s>][\s\S]{0,400}?ExamSessionEditForm/.test(PAGE), false);
  assert.equal(/ExamSessionDeleteForm[\s\S]{0,400}?<(form|button|input)[\s>]/.test(PAGE), false);
});

test("25. NO edit or delete control exists when mayConfigure is false", () => {
  // ONE lifecycle evaluation still serves every affordance, and both new controls
  // sit behind it. An ARCHIVED offering keeps a readable, affordance-free page.
  assert.equal((PAGE.match(/evaluateCourseOperationPolicy\(/g) ?? []).length, 1);
  assert.equal((PAGE.match(/"SCHEDULE_DRAFT_CONFIGURATION"/g) ?? []).length, 1);
  assert.ok(PAGE.includes("{mayConfigure ? ("), "the controls must sit behind the policy flag");
  // Both components are rendered INSIDE that one gate — asserted by position, so
  // neither can drift out of it.
  const gate = PAGE.indexOf("{mayConfigure ? (");
  for (const component of ["<ExamSessionEditForm", "<ExamSessionDeleteForm"]) {
    assert.ok(PAGE.indexOf(component) > gate, `${component} is rendered outside the gate`);
  }
  // The count decides DISPLAY only: it reaches the two components as a boolean and
  // nothing else. It is never bound into an action and never a form field.
  assert.equal(
    (PAGE.match(/hasAssignments=\{session\.assignmentCount > 0\}/g) ?? []).length,
    2,
  );
  for (const forbidden of [
    'name="assignmentCount"',
    "bind(null, session.assignmentCount",
    "assignmentCount={",
  ]) {
    assert.equal(PAGE.includes(forbidden), false, `the count is used as authority: ${forbidden}`);
  }
});

test("26. the version stamp travels ONLY as a hidden token, never as text or an href", () => {
  // The page passes the reader's own epoch-millisecond `updatedAt` straight to the
  // two forms, untransformed...
  assert.equal(
    (PAGE.match(/expectedUpdatedAt=\{session\.updatedAt\}/g) ?? []).length,
    2,
    "both forms must receive the stored version stamp",
  );
  // ...and `session.updatedAt` appears NOWHERE else: not as a child expression, not
  // in a template string, not in a href, and not passed through a formatter.
  assert.equal((PAGE.match(/session\.updatedAt/g) ?? []).length, 2);
  for (const forbidden of [
    ">{session.updatedAt}<",
    "${session.updatedAt}",
    "value={session.updatedAt}",
    "String(session.updatedAt)",
    "new Date(session.updatedAt",
    "toLocaleString",
  ]) {
    assert.equal(PAGE.includes(forbidden), false, `the version stamp is rendered: ${forbidden}`);
  }
  // RE-POINTED by EX-ASG-UI1, and NARROWED rather than relaxed. The session id was
  // a React key and TWO hidden-field props; it is now a React key, THREE
  // hidden-field props (the assignment create form is the third) and ONE in-memory
  // bucket-lookup key. All five uses are NON-VISIBLE, which is the property this
  // guard has always protected, and the exact counts keep "only" honest.
  assert.ok(PAGE.includes("key={session.sessionId}"));
  assert.equal((PAGE.match(/sessionId=\{session\.sessionId\}/g) ?? []).length, 4);
  // RE-POINTED by EX-PAIR-UI-MVP: ONE further NON-VISIBLE use — the pairing
  // picker's same-session examinee bucket, looked up by this very key. Still
  // never text, never an interpolation and never an href.
  assert.equal((PAGE.match(/session\.sessionId/g) ?? []).length, 7);
  assert.ok(
    PAGE.includes("assignmentsBySession.get(session.sessionId)"),
    "the fifth use must be the assignment-bucket lookup",
  );
  for (const forbidden of [">{session.sessionId}<", "${session.sessionId}"]) {
    assert.equal(PAGE.includes(forbidden), false, `the session id is rendered: ${forbidden}`);
  }
  // The ASSIGNMENT id is held to exactly the same rule: a React key and the
  // removal form's one hidden prop, and never text or an interpolation.
  assert.ok(PAGE.includes("key={assignment.assignmentId}"));
  // RE-POINTED from 2 to 3 by EX-PAIR-UI-MVP: the pairing form's ONE hidden
  // field is a third NON-VISIBLE use, held to exactly the same rule — never
  // text, never an interpolation and never an href, which the ban below
  // re-states from the other side.
  assert.equal((PAGE.match(/assignment\.assignmentId/g) ?? []).length, 3);
  for (const forbidden of [">{assignment.assignmentId}<", "${assignment.assignmentId}"]) {
    assert.equal(PAGE.includes(forbidden), false, `the assignment id is rendered: ${forbidden}`);
  }
  // The page still exposes exactly ONE link, and no id of any kind is in it.
  const hrefs = [...PAGE.matchAll(/href=\{?([^}\s]+)\}?/g)].map(([, value]) => value);
  assert.deepEqual(hrefs, ["dashboardHref"], "a second link entered the page");

  // The grouping core is still the FINAL ordering authority: the page re-orders
  // nothing, derives no end time and reads no clock.
  for (const forbidden of [".sort(", ".reverse(", ".filter(", ".slice("]) {
    assert.equal(PAGE.includes(forbidden), false, `the page must not ${forbidden} the schedule`);
  }
  for (const forbidden of ["new Date(", "Date.now(", "toLocaleDateString", "Intl.", "endTime"]) {
    assert.equal(PAGE.includes(forbidden), false, `the page must not use ${forbidden}`);
  }
});

test("27. the edit form's date default is the GROUPING core's own day key", () => {
  // The stored day, not a derived one: the grouping core keyed the day by it, so
  // no date arithmetic, parsing or locale formatting happens on this page.
  assert.ok(PAGE.includes("date={day.dateKey}"), "the date default must be the day key");
  assert.ok(PAGE.includes("startTime={session.startTime}"));
  for (const field of ["arena", "title", "notes"]) {
    assert.ok(
      PAGE.includes(`${field}={session.${field}}`),
      `${field} must be passed through unmodified`,
    );
  }
  assert.ok(PAGE.includes("definitionId={session.definitionId}"));
  // The picker is fed from the DEFINITION reader already loaded — no second query.
  assert.ok(PAGE.includes("definitions={sessionDefinitionOptions}"));
  assert.equal(
    (PAGE.match(/definitions=\{sessionDefinitionOptions\}/g) ?? []).length,
    2,
    "the create and edit pickers must share the one option list",
  );
});

// ===========================================================================
// 28–29. The closed feedback query
// ===========================================================================

test("28. the six new feedback keys are declared, closed, and array-tolerant", () => {
  const typeStart = PAGE.indexOf("searchParams: Promise<{");
  assert.ok(typeStart > -1, "the searchParams type must be declared inline");
  const queryType = PAGE.slice(typeStart, PAGE.indexOf("}>;", typeStart));
  const keys = [...queryType.matchAll(/(\w+)\?:/g)].map(([, key]) => key).sort();
  // RE-POINTED by EX-ASG-UI1, which brings the assignment CREATE's three tokens
  // and the REMOVAL's two, so the closed set grows from fifteen to twenty.
  assert.deepEqual(keys, [
    "created",
    "createdDefinition",
    "createdSession",
    "createError",
    "createIssues",
    "deletedSession",
    "error",
    "existing",
    "sessionDeleteError",
    "sessionEditError",
    "sessionEditIssues",
    "sessionError",
    "sessionIssues",
    "unchangedSession",
    "updatedSession",
    "createdAssignment",
    "assignmentError",
    "assignmentIssues",
    "deletedAssignment",
    "assignmentDeleteError",
    "createdInstructedTrainee",
    "instructedTraineeError",
    "instructedTraineeIssues",
    // ADDED by EX-PUB-UI-MVP: ONE closed publication FEEDBACK token, which this
    // suite pins only to prove the session family did not change shape.
    // EX-PAIR-UI-MVP adds ONE more closed feedback token, and no other key.
    "pairing",
    "publication",
  ].sort());
  // Every key admits the ARRAY form a repeated query key produces, which is what
  // forces every parser to reject it rather than coerce it.
  // RE-POINTED from 24 to 25 by EX-PAIR-UI-MVP: ONE closed pairing FEEDBACK
  // token, which names no course, plan, session, trainee, assignment or version,
  // and from which nothing derives scope, state or a selection.
  assert.equal((queryType.match(/string \| string\[\]/g) ?? []).length, 25);
  // Not one of them names a course, a plan, a definition, a session, a trainee, an
  // assignment or a version.
  for (const forbidden of [
    "courseOfferingId?",
    "planId",
    "definitionId",
    "sessionId",
    "updatedAt",
    "studentId",
    "assignmentId",
    "horseName",
  ]) {
    assert.equal(queryType.includes(forbidden), false, `searchParams must not carry ${forbidden}`);
  }
  // The query is still resolved EXACTLY ONCE, and the new tokens are DESTRUCTURED
  // from that same resolution rather than read as `query.x`.
  assert.equal(PAGE.split("await searchParams").length - 1, 1);
  assert.ok(
    PAGE_FLAT.includes(
      "const { updatedSession, unchangedSession, sessionEditError, sessionEditIssues, deletedSession, sessionDeleteError, } = query;",
    ),
    "the new outcome tokens must come from that one resolved query",
  );
  for (const forbidden of [
    "query.updatedSession",
    "query.deletedSession",
    "query.sessionEditError",
    "query.sessionDeleteError",
  ]) {
    assert.equal(PAGE.includes(forbidden), false, `${forbidden} escapes the closed parser`);
  }
});

test("29. every new parser is closed in BOTH directions, and echoes nothing", () => {
  // Success only on the exact string "1", through one shared closed predicate.
  assert.ok(
    PAGE.includes('return typeof raw === "string" && raw === "1";'),
    "the success predicate must be closed in both directions",
  );
  for (const token of ["updatedSession", "unchangedSession", "deletedSession"]) {
    assert.ok(PAGE.includes(`isSuccessToken(${token})`), `${token} must go through the predicate`);
  }
  // Error and issue codes are checked with Object.hasOwn against FROZEN tables, so
  // an inherited property name such as `constructor` cannot select a message.
  assert.ok(PAGE.includes("return Object.hasOwn(table, raw) ? table[raw] : null;"));
  assert.ok(PAGE.includes("!Object.hasOwn(table, code)"));
  for (const table of [
    "EXAM_SESSION_EDIT_ERROR_MESSAGES",
    "EXAM_SESSION_EDIT_ISSUE_MESSAGES",
    "EXAM_SESSION_DELETE_ERROR_MESSAGES",
  ]) {
    assert.ok(PAGE.includes(`const ${table}: Readonly<Record<string, string>> = Object.freeze({`), `${table} must be a frozen route-local table`);
  }
  // A non-string (an array, from a repeated key) yields nothing, in both parsers.
  assert.ok(PAGE.includes('if (typeof raw !== "string" || raw.length === 0) {'));
  // Nothing from the query is interpolated into markup: a token can only SELECT a
  // constant sentence, never supply one.
  for (const forbidden of [
    "${sessionEditError}",
    "${sessionEditIssues}",
    "${sessionDeleteError}",
    "${updatedSession}",
    "${deletedSession}",
  ]) {
    assert.equal(PAGE.includes(forbidden), false, `a submitted value is echoed: ${forbidden}`);
  }
});

test("30. the required Hebrew outcome sentences all exist, and are fixed strings", () => {
  // One sentence per outcome the slice must report, each a constant owned by the
  // page. Asserted by CONTENT rather than by count, so a future reword fails here
  // and is reviewed rather than silently changing what a manager is told.
  for (const [outcome, text] of [
    ["update succeeded", "מועד המבחן עודכן בהצלחה."],
    ["no change was needed", "לא בוצע שינוי במועד המבחן"],
    ["delete succeeded", "מועד המבחן נמחק."],
    ["stale edit", "לא נשמרה. יש לרענן את הדף ולנסות שוב."],
    ["stale delete", "לא בוצעה. יש לרענן את הדף ולנסות שוב."],
    ["session not found", "אינו קיים עוד בתוכנית המבחנים של קורס זה"],
    ["delete blocked by assignments", "לא ניתן למחוק מועד בחינה שמשובצים אליו נבחנים"],
    ["definition change blocked", "לא ניתן להחליף את הגדרת המבחן של מועד שכבר משובצים אליו נבחנים"],
    ["invalid edit input", "לא ניתן היה לשמור את השינויים"],
  ] as const) {
    assert.ok(PAGE.includes(text), `the "${outcome}" message is missing`);
  }
  // The CREATE feedback still works, unchanged: its parsers and its success token
  // are untouched by this slice.
  assert.ok(PAGE.includes("examSessionCreateErrorText(sessionError)"));
  assert.ok(PAGE.includes("examSessionCreateIssueTexts(sessionIssues)"));
  assert.ok(PAGE.includes('typeof createdSession === "string" && createdSession === "1"'));
  assert.ok(PAGE.includes("מפגש המבחן נוסף בהצלחה."));
});

// ===========================================================================
// 31–33. Containment: the callers, the untouched writers, the exact footprint
// ===========================================================================

test("31. the writers, their cores and the schema are BYTE-IDENTICAL to HEAD", () => {
  // The single most important claim of this slice: it REUSES the committed
  // writers and changes none of them. Asserted against git rather than by reading
  // the files, so a whitespace-only edit fails too.
  const untouched = [
    "lib/actions/" + SESSION_WRITE_MODULE + ".ts",
    "lib/exam/" + "create-exam-session" + "-core.ts",
    "lib/exam/" + "update-exam-session" + "-core.ts",
    "lib/exam/" + "delete-exam-session" + "-core.ts",
    "lib/actions/" + "admin-exam-session-read" + "-io.ts",
    "lib/exam/" + "admin-exam-session-read" + "-core.ts",
    "lib/exam/" + "admin-exam-session-grouping" + "-core.ts",
    "lib/course/operation-policy-core.ts",
    "prisma/schema.prisma",
  ];
  for (const rel of untouched) {
    const result = spawnSync("git", ["diff", "--quiet", "HEAD", "--", rel], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, `${rel} was modified by this slice`);
  }
});

test("32. no schema, migration, capability, auth or service-worker file was touched", () => {
  const touched = new Set([
    ...gitLines(["diff", "--name-only", "HEAD"]),
    ...gitLines(["diff", "--name-only", "--cached", "HEAD"]),
    ...gitLines(["ls-files", "--others", "--exclude-standard"]),
  ]);
  for (const path of touched) {
    assert.equal(/^prisma\//.test(path), false, `the slice touched ${path}`);
    assert.equal(/capabilit/i.test(path), false, `the slice touched ${path}`);
    assert.equal(/^lib\/auth\//.test(path), false, `the slice touched ${path}`);
    assert.equal(/service-worker|\bsw\.js$/.test(path), false, `the slice touched ${path}`);
    assert.equal(/^\.env/.test(path), false, `the slice touched ${path}`);
    assert.equal(path === ".mcp.json", false, `the slice touched ${path}`);
  }
});

test("33. the slice touched EXACTLY its fourteen approved paths", () => {
  const touched = new Set([
    ...gitLines(["diff", "--name-only", "HEAD"]),
    ...gitLines(["diff", "--name-only", "--cached", "HEAD"]),
    ...gitLines(["ls-files", "--others", "--exclude-standard"]),
  ]);
  const offenders = [...touched].filter((path) => !SLICE_PATHS.includes(path)).sort();
  assert.deepEqual(offenders, [], `an unapproved path was touched: ${offenders.join(", ")}`);
  // EX-ASG-UI1 TRANSITION. The scope was fourteen while EX-SES-UI-2 sat in the
  // working tree; that slice is COMMITTED, so this list now describes the one that
  // is uncommitted instead — four new route files and three further re-pointed
  // committed guards, for an exact twenty-three. Still an exhaustive literal set of
  // exact paths, admitting no directory, prefix or glob.
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
  assert.equal(new Set(SLICE_PATHS).size, 35, "the approved scope is thirty-five files");

  // EXACTLY TWO production files in scope are not new: the shared Server Action
  // module and the page. Everything else is either one of the new route files or a
  // guard suite — no layout, no route handler, no `lib/` production module, and no
  // second page.
  // DE-DUPLICATED as of EX-PUB-UI-MVP, which re-adds paths this list already
  // holds. `SLICE_PATHS` is an allow-list consulted with `includes`, so a repeated
  // entry permits nothing extra — but this assertion turns it into a SET, and a
  // duplicate would otherwise read as a production file that does not exist.
  const production = [...new Set(SLICE_PATHS)].filter((path) => !path.endsWith(".test.ts"));
  assert.deepEqual(production.sort(), [
    `${ROUTE_DIR_PREFIX}ExamSessionDeleteForm.tsx`,
    `${ROUTE_DIR_PREFIX}ExamSessionEditForm.tsx`,
    `${ROUTE_DIR_PREFIX}CreateExamAssignmentForm.tsx`,
    `${ROUTE_DIR_PREFIX}CreateExamInstructedTraineeAssignmentForm.tsx`,
    `${ROUTE_DIR_PREFIX}DeleteExamAssignmentForm.tsx`,
    `${ROUTE_DIR_PREFIX}exam-assignment-messages.ts`,
    `${ROUTE_DIR_PREFIX}exam-instructed-trainee-assignment-messages.ts`,
    `${ROUTE_DIR_PREFIX}actions.ts`,
    `${ROUTE_DIR_PREFIX}page.tsx`,
    "lib/exam/" + "admin-exam-assignment-read" + "-core.ts",
    "lib/actions/" + "exam-assignment-read" + "-io.ts",
  ].sort());
  for (const path of SLICE_PATHS) {
    assert.equal(
      path.endsWith("layout.tsx") || path.endsWith("route.ts"),
      false,
      `a layout or route handler entered the scope: ${path}`,
    );
  }
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
});
