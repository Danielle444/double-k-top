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

/** The route's EXACT final file set, after this slice's three additions. */
const FINAL_ROUTE_FILES = [
  "app/admin/courses/[courseOfferingId]/exams/ExamDefinitionCreateForm.tsx",
  "app/admin/courses/[courseOfferingId]/exams/ExamPlanCreateForm.tsx",
  "app/admin/courses/[courseOfferingId]/exams/ExamSessionCreateForm.tsx",
  "app/admin/courses/[courseOfferingId]/exams/actions.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-definition-create-error-messages.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-definition-create.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-definitions-page.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-plan-create.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-session-create.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-session-create-error-messages.ts",
  "app/admin/courses/[courseOfferingId]/exams/page.tsx",
].sort();

/**
 * The EIGHT paths EX-SES-S4 was authorized to touch — three new, five amended.
 *
 * The session write binding's paths are ASSEMBLED for the reason in the header.
 */
const SLICE_PATHS = [
  "app/admin/courses/[courseOfferingId]/exams/ExamSessionCreateForm.tsx",
  "app/admin/courses/[courseOfferingId]/exams/exam-session-create-error-messages.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-session-create.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/actions.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-definition-create.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-plan-create.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-definitions-page.contract.test.ts",
  "lib/actions/" + "exam-session-write" + "-io.test.ts",
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

test("5. the module exports EXACTLY the three approved actions, in order", () => {
  const exported = [
    ...ACTIONS_SOURCE.matchAll(/export (?:async )?function (\w+)\(/g),
  ].map(([, name]) => name);
  // An EXHAUSTIVE allow-list in a FIXED order. Everything exported from a
  // "use server" module is a public network endpoint, so this list IS the attack
  // surface: no fourth endpoint, and no helper, parser, constant or type beside
  // them.
  assert.deepEqual(exported, [
    "createExamPlanAction",
    "createExamDefinitionAction",
    "createExamSessionAction",
  ]);
  assert.equal(exported.length, 3, "no fourth endpoint may exist in this module");
  for (const token of ["export const", "export default", "export {", "export type"]) {
    assert.equal(ACTIONS.includes(token), false, `the module also declares ${token}`);
  }
  assert.equal((ACTIONS.match(/export async function /g) ?? []).length, 3);
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
    "@/lib/auth/require-admin",
    "next/cache",
    "next/navigation",
  ].sort());
  for (const token of [PRISMA_MODULE, GENERATED_CLIENT, "capabilit", "Capabilit", "notification", "Notification", "push", "sendMessage"]) {
    assert.equal(ACTIONS.includes(token), false, `the action module reaches ${token}`);
  }
});

test("16. no session edit, delete, reorder, assignment, break, supervisor, publication or source-date path exists", () => {
  for (const token of [
    UPDATE_WRITER,
    DELETE_WRITER,
    "reorder" + "ExamSessions",
    "update" + "ExamDefinition",
    "delete" + "ExamDefinition",
    "reorder" + "ExamDefinitions",
    "publish" + "ExamPlan",
    "unpublish" + "ExamPlan",
    "delete" + "ExamPlan",
    "ExamAssignment",
    "examAssignment",
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
  assert.ok(PLAN_ACTION.includes("createExamPlan(courseOfferingId)"));
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
  assert.equal(SESSION_ACTION.includes("createExamPlan("), false);
  assert.equal(SESSION_ACTION.includes("createExamDefinition("), false);
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

test("26. page.tsx is BYTE-IDENTICAL to HEAD and renders no session form", () => {
  // This slice deliberately does NOT wire the form: the reader and the grouping
  // core it needs are a later, separately reviewed integration slice.
  const head = gitLines(["rev-parse", `HEAD:${ROUTE_DIR_PREFIX}page.tsx`]);
  const working = gitLines(["hash-object", join(REPO_ROOT, PAGE_REL)]);
  assert.deepEqual(working, head, "page.tsx was modified");

  // ...and it therefore introduces no third page-reachable mutation.
  for (const token of [
    "ExamSessionCreateForm",
    "createExamSessionAction",
    "createdSession",
    "sessionError",
    "sessionIssues",
    "exam-session-create-error-messages",
  ]) {
    assert.equal(PAGE.includes(token), false, `the page references ${token}`);
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

test("28. the EDIT and REMOVAL writers remain reachable from NOTHING", () => {
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
    offenders,
    [],
    `a UI or route module reaches a destructive session writer: ${offenders.join(", ")}`,
  );
  // Nothing under app/ names their pure cores either.
  for (const core of ["update-exam-session" + "-core", "delete-exam-session" + "-core"]) {
    const named = gitGrepFiles([core, "--", "app", "components"]);
    assert.deepEqual(named, [], `${core} is named under app/: ${named.join(", ")}`);
  }
});

test("29. the slice touched EXACTLY its eight approved paths", () => {
  const touched = new Set([
    ...gitLines(["diff", "--name-only", "HEAD"]),
    ...gitLines(["diff", "--name-only", "--cached", "HEAD"]),
    ...gitLines(["ls-files", "--others", "--exclude-standard"]),
  ]);
  const offenders = [...touched].filter((path) => !SLICE_PATHS.includes(path)).sort();
  assert.deepEqual(offenders, [], `an unapproved path was touched: ${offenders.join(", ")}`);
  assert.equal(SLICE_PATHS.length, 8, "the approved scope is eight files");
  // No ninth file, and page.tsx is not among them.
  assert.equal(
    SLICE_PATHS.includes(`${ROUTE_DIR_PREFIX}page.tsx`),
    false,
    "page.tsx must not be in scope",
  );
});
