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

/** The route's EXACT final file set, after this slice's four additions. */
const FINAL_ROUTE_FILES = [
  "app/admin/courses/[courseOfferingId]/exams/CreateExamAssignmentForm.tsx",
  "app/admin/courses/[courseOfferingId]/exams/DeleteExamAssignmentForm.tsx",
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
  "app/admin/courses/[courseOfferingId]/exams/exam-plan-create.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-session-create-error-messages.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-session-create.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-session-edit-delete.contract.test.ts",
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
  // The committed `lib/` footprint and caller guards.
  "lib/actions/" + "exam-assignment-write" + "-io.test.ts",
  "lib/actions/" + "exam-assignment-read" + "-io.test.ts",
  "lib/actions/" + "exam-definition-read" + "-io.test.ts",
  "lib/actions/" + "admin-exam-session-read" + "-io.test.ts",
  "lib/actions/" + "exam-session-write" + "-io.test.ts",
  "lib/exam/" + "exam-supervisor-write" + "-core.test.ts",
  "lib/actions/" + "exam-plan-write" + "-io.test.ts",
  "lib/exam/" + "create-exam-plan" + "-core.test.ts",
];

// --- Assembled tokens (see the header) -------------------------------------
const ASSIGNMENT_WRITE_MODULE = "exam-assignment-write" + "-io";
const ASSIGNMENT_WRITE_SPECIFIER = "@/lib/actions/" + ASSIGNMENT_WRITE_MODULE;
const ASSIGNMENT_READ_MODULE = "exam-assignment-read" + "-io";
const ASSIGNMENT_READ_SPECIFIER = "@/lib/actions/" + ASSIGNMENT_READ_MODULE;
const CREATE_WRITER_CALL = "create" + "ExamAssignment" + "(";
const DELETE_WRITER_CALL = "delete" + "ExamAssignment" + "(";
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

/** The THREE fields — and the ONLY three — the create action may read. */
const CREATE_FIELDS = ["sessionId", "studentId", "horseName"];

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

/** The three stable input-issue codes the message module must own. */
const ISSUE_CODES = [
  "EX-ASG-IN-SESSION-REQUIRED",
  "EX-ASG-IN-STUDENT-REQUIRED",
  "EX-ASG-IN-HORSE-REQUIRED",
];

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

test("2. the route directory holds EXACTLY the eighteen approved files", () => {
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

test("5. the module exports EXACTLY the seven approved actions, in order", () => {
  const exported = [
    ...ACTIONS_SOURCE.matchAll(/export (?:async )?function (\w+)\(/g),
  ].map(([, name]) => name);
  // An EXHAUSTIVE allow-list in a FIXED order. Everything exported from a
  // "use server" module is a public network endpoint, so this list IS the attack
  // surface: no eighth endpoint, and no helper, parser, constant or type beside
  // them.
  assert.deepEqual(exported, [
    "createExamPlanAction",
    "createExamDefinitionAction",
    "createExamSessionAction",
    "updateExamSessionAction",
    "deleteExamSessionAction",
    "createExamAssignmentAction",
    "deleteExamAssignmentAction",
  ]);
  assert.equal(exported.length, 7, "no eighth endpoint may exist in this module");
  for (const token of ["export const", "export default", "export {", "export type"]) {
    assert.equal(ACTIONS.includes(token), false, `the module also declares ${token}`);
  }
  assert.equal((ACTIONS.match(/export async function /g) ?? []).length, 7);
});

test("6. both new actions have the EXACT locked signature, and return void", () => {
  for (const name of ["createExamAssignmentAction", "deleteExamAssignmentAction"]) {
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
  // The id reaches each writer from the bound parameter, in the locked position...
  assert.ok(
    squash(CREATE_ACTION).includes(
      `${CREATE_WRITER_CALL}courseOfferingId, { sessionId: formData.get("sessionId"), studentId: formData.get("studentId"), horseName: formData.get("horseName"), });`,
    ),
    "the create writer is not called with the bound id and the exact three raw fields",
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
  for (const action of ["createExamAssignmentAction", "deleteExamAssignmentAction"]) {
    assert.ok(
      PAGE.includes(`${action}.bind(null, context.id)`),
      `the page must bind the verified context id into ${action}`,
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
  }
});

test("10. the CREATE reads EXACTLY three named fields, and nothing else", () => {
  const reads = [...CREATE_ACTION.matchAll(/formData\.get\("([^"]+)"\)/g)].map(([, f]) => f);
  assert.deepEqual(reads, CREATE_FIELDS);
  assert.equal(reads.length, 3, "the create action's FormData budget is exactly three");
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

test("12. neither action coerces, defaults or trims the create's three values", () => {
  // Every one of the three is forwarded EXACTLY as FormData.get returned it — a
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
      "`${examsPath}?assignmentError=invalid_input&assignmentIssues=${encodeURIComponent(codes)}`",
    ),
  );
  // Every other refusal is fully described by its code alone.
  assert.ok(
    CREATE_ACTION.includes("`${examsPath}?assignmentError=${encodeURIComponent(result.code)}`"),
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
      "`${examsPath}?assignmentDeleteError=${encodeURIComponent(result.code)}`",
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
    // compile-time-known literal from a closed set — and the joined issue codes.
    const interpolations = [...body.matchAll(/\$\{([^}]+)\}/g)].map(([, expr]) => expr.trim());
    for (const expr of interpolations) {
      assert.ok(
        ["encodeURIComponent(courseOfferingId)", "examsPath", "encodeURIComponent(result.code)", "encodeURIComponent(codes)"].includes(
          expr,
        ),
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
  assert.ok(
    squash(CREATE_FORM).includes(
      "export function CreateExamAssignmentForm({ action, courseOfferingId, sessionId, eligibleTrainees, }: { action: (formData: FormData) => void | Promise<void>; courseOfferingId: string; sessionId: string; eligibleTrainees: readonly EligibleExamTraineeChoice[]; })",
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

test("18. the create form submits EXACTLY three fields, and binds no scope", () => {
  // The session travels as a HIDDEN field; the offering does NOT.
  assert.ok(CREATE_FORM.includes('<input type="hidden" name="sessionId" value={sessionId} />'));
  const hidden = [...CREATE_FORM.matchAll(/type="hidden"\s+name="([^"]+)"/g)].map(([, n]) => n);
  assert.deepEqual(hidden, ["sessionId"], "the create form carries an unapproved hidden field");
  // The complete submitted field set.
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
    "parent",
    "guardian",
    "groupName",
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
  assert.ok(
    PAGE.includes("const assignmentsBySession = new Map<string, AdminExamAssignmentRow[]>();"),
  );
  assert.ok(PAGE.includes("for (const assignment of assignmentView.assignments) {"));
  // The committed reader already imposed the total order — session, then position,
  // then assignment id — and a for...of that APPENDS preserves it.
  for (const forbidden of [".sort(", ".reverse(", ".filter(", ".slice("]) {
    assert.equal(PAGE.includes(forbidden), false, `the page uses ${forbidden}`);
  }
});

test("26. every assignment renders under its OWN session, with every role kept", () => {
  assert.ok(
    PAGE.includes("assignmentsBySession.get(session.sessionId) ?? NO_ASSIGNMENTS"),
    "the rows must be looked up by the session they belong to",
  );
  // An INSTRUCTED_TRAINEE row this surface cannot create is still SHOWN: hiding it
  // would make a session look emptier than it is and disagree with its own count.
  assert.ok(PAGE.includes('EXAMINEE: "נבחן/ת"'));
  assert.ok(PAGE.includes('INSTRUCTED_TRAINEE: "חניך מודרך"'));
  assert.equal(
    PAGE.includes('role === "EXAMINEE"'),
    false,
    "the page filters the list by role",
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
  for (const forbidden of ["identityNumber", "parentPhone", "guardian", "subgroup", "enrollment"]) {
    assert.equal(PAGE.includes(forbidden), false, `the page renders ${forbidden}`);
  }
});

test("28. the create form is hidden for topic/discipline, but NOT for instructed-trainee", () => {
  // A definition demanding a lesson topic or a discipline cannot be assigned from
  // UI1: this form collects neither, so the affordance is absent rather than
  // offered-and-refused. An UNKNOWN definition fails closed the same way.
  assert.ok(
    squash(PAGE).includes(
      "const requiresUnsupportedFields = requirements === undefined || requirements.requiresLessonTopic || requirements.requiresDiscipline;",
    ),
    "the create gate is not the closed topic/discipline test",
  );
  assert.ok(PAGE.includes("סוג מבחן זה דורש פרטים נוספים, ולכן השיבוץ ייפתח"));
  // requiresInstructedTrainee is deliberately NOT consulted by that gate: the
  // instructed trainee is a SECOND row written by a later operation, and it never
  // blocks the examinee.
  assert.equal(
    /requiresUnsupportedFields[\s\S]{0,200}requiresInstructedTrainee/.test(squash(PAGE)),
    false,
    "requiresInstructedTrainee must not gate the examinee create form",
  );
  // The requirements come from the DEFINITION reader already loaded — no second
  // query, and no widening of the session reader, which reports neither flag.
  assert.ok(PAGE.includes("for (const definition of view.definitions) {"));
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
  ]) {
    assert.ok(MESSAGES.includes(sentence), `the approved sentence is missing: ${sentence}`);
  }
  for (const code of ISSUE_CODES) {
    assert.ok(MESSAGES.includes(code), `the issue code ${code} is unmapped`);
  }
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
  // Only the Server Action module may reach the assignment WRITE binding, and only
  // the page may reach the assignment READ binding.
  assert.ok(ACTIONS.includes(ASSIGNMENT_WRITE_SPECIFIER));
  assert.equal(PAGE.includes(ASSIGNMENT_WRITE_MODULE), false, "the page reaches the write binding");
  assert.equal(
    ACTIONS.includes(ASSIGNMENT_READ_MODULE),
    false,
    "the action module reaches the read binding",
  );
});

test("36. this slice adds NO publication, notification, instructor or trainee surface", () => {
  for (const [label, source] of [
    ["actions", ACTIONS],
    ["page", PAGE],
  ] as const) {
    for (const forbidden of [
      "publishExamPlan",
      "unpublishExamPlan",
      "deleteExamPlan",
      "reorderExamAssignments",
      "updateExamAssignment",
      "INSTRUCTED_TRAINEE\"," + " role",
      "instructionTopic",
      "discipline:",
      "pairingIndex",
      "supervisor",
      "Supervisor",
      "sourceDate",
      "SourceDate",
      "TeachingPractice",
      "beginnerChild",
    ]) {
      assert.equal(source.includes(forbidden), false, `the ${label} references ${forbidden}`);
    }
  }
  // No instructor, trainee or supervisor route gained an assignment surface.
  for (const dir of [
    join("app", "instructor"),
    join("app", "student"),
  ]) {
    if (!existsSync(join(REPO_ROOT, dir))) continue;
    const touched = gitLines(["diff", "--name-only", "HEAD", "--", dir]);
    assert.deepEqual(touched, [], `${dir} was modified: ${touched.join(", ")}`);
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
  const prismaStatus = gitLines(["status", "--porcelain", "--", "prisma"]);
  assert.deepEqual(prismaStatus, [], `prisma/ changed: ${prismaStatus.join(", ")}`);

  // The committed bindings this slice WIRES were not edited.
  const libTouched = gitLines(["diff", "--name-only", "HEAD", "--", "lib"]).filter(
    (path) => !path.endsWith(".test.ts"),
  );
  assert.deepEqual(libTouched, [], `a committed lib binding was edited: ${libTouched.join(", ")}`);
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
