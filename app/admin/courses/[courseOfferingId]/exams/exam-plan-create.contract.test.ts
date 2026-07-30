/**
 * EXAM PLAN P3 — DB-free CONTRACT/source test for the admin "create an empty exam
 * plan" Server Action, its client form and its wiring into the exams page.
 *
 * WHY STRUCTURAL. The action is a `"use server"` module that reaches a
 * `server-only` binding, so it cannot be imported into a plain `tsx --test`
 * process — that is exactly what those declarations are for. Its BEHAVIOUR is
 * already proven, DB-free, by the committed pure core and the committed binding
 * suite. What is proven HERE is the SHAPE of the wiring: what is bound where, in
 * what order, what may be read from the request, and what the route must never
 * gain.
 *
 * DB-FREE AND PRODUCTION-FREE: this suite reads repository sources from disk and
 * runs `git` to describe its own file scope. It opens no database connection,
 * executes no SQL, reads no environment variable, resolves no session and makes
 * no network request.
 *
 * SPLIT LITERALS — LOAD-BEARING, NOT COSMETIC. The committed sibling guards sweep
 * every repository source file for the specifier of the ExamPlan write binding and
 * for a call to its public function, and they assert an EXACT caller list. This
 * suite necessarily has to talk about both. Every such token is therefore assembled
 * from pieces, so that a guard suite describing the wiring is not itself counted as
 * part of it — which would force those allow-lists to be widened beyond the one
 * production caller they are meant to pin.
 *
 * HOW TO RUN IT — see the line comment below. It uses a WILDCARD for the dynamic
 * segment: the node test runner treats its path argument as a GLOB, so a literal
 * `[courseOfferingId]` is read as a character class and matches nothing, the runner
 * reports 0 tests and exits 0 — which looks exactly like a passing suite. Always
 * confirm the reported test count.
 */
// Run:
//   npx tsx --test "app/admin/courses/*/exams/exam-plan-create.contract.test.ts"
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..", "..");

const ROUTE_DIR_REL = join("app", "admin", "courses", "[courseOfferingId]", "exams");
/** The same directory in git's own form: forward slashes, repository-relative. */
const ROUTE_DIR_PREFIX = "app/admin/courses/[courseOfferingId]/exams/";

const ACTION_REL = join(ROUTE_DIR_REL, "actions.ts");
const FORM_REL = join(ROUTE_DIR_REL, "ExamPlanCreateForm.tsx");
const PAGE_REL = join(ROUTE_DIR_REL, "page.tsx");

/** The ONE production module authorized to reach the ExamPlan write binding. */
const APPROVED_CALLER = "app/admin/courses/[courseOfferingId]/exams/actions.ts";

/**
 * Every path P3 was authorized to touch — three new files and four amended.
 *
 * The two `lib/` entries are assembled from pieces for the reason given in the
 * header: the committed core and binding guards sweep raw source for their own
 * module names and assert EXACT consumer lists, so spelling either path whole
 * would make this suite count as a consumer and force those lists to be widened
 * beyond the one production caller they exist to pin.
 */
const SLICE_PATHS = [
  "app/admin/courses/[courseOfferingId]/exams/actions.ts",
  "app/admin/courses/[courseOfferingId]/exams/ExamPlanCreateForm.tsx",
  "app/admin/courses/[courseOfferingId]/exams/exam-plan-create.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/page.tsx",
  "app/admin/courses/[courseOfferingId]/exams/exam-definitions-page.contract.test.ts",
  "lib/exam/create-exam-plan" + "-core.test.ts",
  "lib/actions/exam-plan-write" + "-io.test.ts",
];

/**
 * Strip comments so every guard asserts on CODE, not on explanatory prose.
 *
 * LINE comments are removed FIRST, and the order is load-bearing. The Run line
 * above contains a GLOB for the dynamic route segment, and the slash-star and
 * star-slash pairs inside it read exactly like block-comment DELIMITERS. Stripping
 * block comments first therefore lets a spurious match open inside that glob and
 * run on to the end of the next real doc comment, quietly eating the import list
 * and the constants in between — which is not a hypothetical: it silently emptied
 * this suite's own import assertion until the order was swapped. Removing
 * whole-line comments first deletes the glob before it can be misread.
 *
 * (This prose deliberately spells the delimiters out in words rather than showing
 * them, for exactly the same reason.)
 */
function stripComments(source: string): string {
  return source.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Collapse whitespace, so an assertion survives ordinary reformatting. */
function squash(source: string): string {
  return source.replace(/\s+/g, " ");
}

function readSource(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

const ACTION = stripComments(readSource(ACTION_REL));
const FORM = stripComments(readSource(FORM_REL));
const PAGE = stripComments(readSource(PAGE_REL));

const ACTION_FLAT = squash(ACTION);
const PAGE_FLAT = squash(PAGE);

// Split specifiers — see the header note on why these are assembled.
const WRITE_BINDING_MODULE = "exam-plan-write" + "-io";
const WRITE_BINDING_SPECIFIER = "@/lib/actions/" + WRITE_BINDING_MODULE;
const PUBLIC_WRITE_CALL = new RegExp("\\bcreate" + "ExamPlan\\s*\\(");
const PRISMA_MODULE = ["@/lib", "prisma"].join("/");
const GENERATED_CLIENT = ["@prisma", "client"].join("/");

function gitLines(args: readonly string[]): string[] {
  const result = spawnSync("git", [...args], { cwd: REPO_ROOT, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed`);
  return (result.stdout ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Every `.ts`/`.tsx` file of the repository's own source trees. */
function repoSourceFiles(): { path: string; source: string }[] {
  const out: { path: string; source: string }[] = [];
  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "generated") continue;
      const full = join(dir, entry.name);
      if (full.includes(`${sep}generated${sep}`)) continue;
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      out.push({
        path: full.slice(REPO_ROOT.length + 1).split(sep).join("/"),
        source: readFileSync(full, "utf8"),
      });
    }
  }
  for (const root of ["app", "lib", "components", "scripts"]) {
    const dir = join(REPO_ROOT, root);
    if (existsSync(dir)) walk(dir);
  }
  return out;
}

// ===========================================================================
// 1–3. The Server Action module: one endpoint, one exact signature
// ===========================================================================

test("1. the three P3 files exist at the EXACT course-scoped route", () => {
  for (const rel of [ACTION_REL, FORM_REL, PAGE_REL]) {
    assert.ok(existsSync(join(REPO_ROOT, rel)), `${rel} is missing`);
  }
  // No top-level exams route was created in any role area.
  for (const dir of [
    join("app", "admin", "exams"),
    join("app", "instructor", "exams"),
    join("app", "student", "exams"),
  ]) {
    assert.equal(existsSync(join(REPO_ROOT, dir)), false, `${dir} was created`);
  }
});

test("2. the action module is a Server Action module exporting EXACTLY one function", () => {
  const firstStatement = ACTION.split("\n").find((line) => line.trim().length > 0);
  assert.equal(firstStatement?.trim(), '"use server";', `first statement: ${firstStatement}`);

  // Everything exported from a "use server" module is a public network endpoint,
  // so the export list IS the attack surface. Exactly one.
  const exports = [...ACTION.matchAll(/export\s+(?:async\s+)?(?:function|const|class|type)\s+(\w+)/g)]
    .map((match) => match[1])
    .sort();
  assert.deepEqual(exports, ["createExamPlanAction"]);
  assert.equal(/export\s*\{/.test(ACTION), false, "no re-export list is allowed");
  assert.equal(/export\s+default/.test(ACTION), false, "no default export is allowed");
});

test("3. the action has the EXACT locked signature, and returns void", () => {
  assert.ok(
    ACTION_FLAT.includes(
      "export async function createExamPlanAction( courseOfferingId: string, formData: FormData, ): Promise<void> {",
    ),
    "the locked signature is not present verbatim",
  );
});

// ===========================================================================
// 4–6. Authorization first, and the id is BOUND — never submitted
// ===========================================================================

test("4. requireAdmin() is the FIRST awaited operation in the action", () => {
  assert.ok(ACTION.includes("await requireAdmin()"), "requireAdmin() must be awaited");
  assert.equal(
    ACTION.indexOf("await "),
    ACTION.indexOf("await requireAdmin()"),
    "some other operation is awaited before requireAdmin()",
  );
  // ...and it runs before the write binding is entered.
  assert.ok(
    ACTION.indexOf("await requireAdmin()") < ACTION.indexOf("createExamPlan(courseOfferingId)"),
    "the write binding is reached before authorization",
  );
});

test("5. the offering id is SERVER-BOUND from the validated route context", () => {
  // The page binds the VERIFIED context id, never the raw route param.
  assert.ok(
    PAGE.includes("createExamPlanAction.bind(null, context.id)"),
    "the page must bind the verified context id into the action",
  );
  assert.equal(
    PAGE.includes("createExamPlanAction.bind(null, courseOfferingId)"),
    false,
    "the raw route param must never be bound into the action",
  );
  // The action passes exactly that bound parameter to the binding.
  assert.ok(ACTION.includes("createExamPlan(courseOfferingId)"));
});

test("6. NOTHING is read from FormData — not the offering id, not a plan id", () => {
  // The parameter exists because React supplies it, and is never inspected.
  assert.equal(/formData\s*\./.test(ACTION), false, "the action reads from formData");
  for (const forbidden of [
    "formData.get",
    "formData.has",
    "formData.entries",
    "formData.forEach",
    "planId",
    "plan_id",
    "courseOfferingId\")",
    "get(",
  ]) {
    assert.equal(ACTION.includes(forbidden), false, `the action must not use ${forbidden}`);
  }
  // The form itself submits no fields at all, so the FormData is empty by
  // construction rather than merely ignored.
  for (const forbidden of ["<input", "<select", "<textarea", "name=", "value="]) {
    assert.equal(FORM.includes(forbidden), false, `the form must not carry ${forbidden}`);
  }
});

// ===========================================================================
// 7–9. Result mapping, revalidation, and redirects outside any try/catch
// ===========================================================================

test("7. the three refusal codes map to their EXACT locked targets", () => {
  // offering_not_found -> the safe courses list; the unresolved id builds no URL.
  assert.ok(ACTION.includes('if (result.code === "offering_not_found") {'));
  assert.ok(ACTION.includes('redirect("/admin/courses?error=invalid")'));
  // Every other refusal -> this course's exams path, carrying ONLY the stable code.
  assert.ok(
    ACTION.includes("redirect(`${examsPath}?error=${encodeURIComponent(result.code)}`)"),
    "a refusal must return to the exams path with the stable code",
  );
  // The code is the ONLY dynamic value in any redirect target: no message, no
  // exception text, no submitted value, no id.
  for (const forbidden of [
    "result.planId",
    "error.message",
    "String(error)",
    "JSON.stringify",
    "result.ok ?",
  ]) {
    assert.equal(ACTION.includes(forbidden), false, `the action must not put ${forbidden} in a URL`);
  }
});

test("8. success revalidates ONLY this course's exams path, exactly once", () => {
  assert.equal(
    ACTION.split("revalidatePath(").length - 1,
    1,
    "revalidatePath must be called exactly once",
  );
  assert.ok(ACTION.includes("revalidatePath(examsPath)"));
  assert.ok(
    ACTION.includes(
      "const examsPath = `/admin/courses/${encodeURIComponent(courseOfferingId)}/exams`",
    ),
    "the exams path must be built from the bound offering id",
  );
  // No other route, layout or tag is revalidated.
  for (const forbidden of ['revalidatePath("/', "revalidateTag", '"layout"', '"page"']) {
    assert.equal(ACTION.includes(forbidden), false, `the action must not use ${forbidden}`);
  }
  // The two successes are distinguished, and both land on the exams path.
  assert.ok(
    ACTION.includes(
      "redirect(result.created ? `${examsPath}?created=1` : `${examsPath}?existing=1`)",
    ),
    "created/existing must be reported distinctly",
  );
});

test("9. redirects sit outside any try/catch — the action has none at all", () => {
  for (const forbidden of [/\btry\b/, /\bcatch\b/, /\bfinally\b/]) {
    assert.equal(forbidden.test(ACTION), false, `the action must not use ${forbidden}`);
  }
  // Every redirect is therefore free to throw NEXT_REDIRECT to the framework, as
  // is the login redirect thrown by requireAdmin() and by the binding itself.
  assert.ok(ACTION.split("redirect(").length - 1 >= 3, "all three branches must redirect");
});

// ===========================================================================
// 10–12. No automatic creation; the affordance is state- and lifecycle-gated
// ===========================================================================

test("10. nothing creates a plan automatically — no effect, no auto-submit", () => {
  for (const [name, source] of [
    ["page", PAGE],
    ["form", FORM],
    ["action", ACTION],
  ] as const) {
    for (const forbidden of [
      "useEffect",
      "useLayoutEffect",
      "useState",
      "useTransition",
      "setTimeout",
      "setInterval",
      "requestSubmit",
      "router.push",
      "router.replace",
      "useRouter",
    ]) {
      assert.equal(source.includes(forbidden), false, `the ${name} must not use ${forbidden}`);
    }
  }
  // The page performs no write of any kind: a plain GET cannot create anything.
  for (const forbidden of ["revalidatePath", "redirect(", WRITE_BINDING_SPECIFIER]) {
    assert.equal(PAGE.includes(forbidden), false, `the page must not use ${forbidden}`);
  }
  assert.equal(PUBLIC_WRITE_CALL.test(PAGE), false, "the page must not call the write binding");
  // The create happens on submit, and only on submit.
  assert.ok(FORM.includes('type="submit"'));
  assert.ok(FORM.includes("<form action={action}>"));
});

test("11. the create affordance appears ONLY in the no-plan + configurable state", () => {
  // Gated on the course lifecycle, using the non-throwing policy evaluation.
  assert.ok(
    PAGE_FLAT.includes(
      'const canCreatePlan = evaluateCourseOperationPolicy( context.status, "SCHEDULE_DRAFT_CONFIGURATION", ).allowed;',
    ),
    "the affordance must be gated on SCHEDULE_DRAFT_CONFIGURATION",
  );
  assert.ok(PAGE.includes("{canCreatePlan && ("), "the form must be rendered conditionally");

  // ...and positioned inside the plan-ABSENT branch: after the `!view.planExists`
  // test and before the first content of the plan-present branch.
  const noPlanBranch = PAGE.indexOf("!view.planExists");
  const form = PAGE.indexOf("<ExamPlanCreateForm");
  const planPresentBranch = PAGE.indexOf("מצב תוכנית המבחנים");
  assert.ok(noPlanBranch > -1 && form > -1 && planPresentBranch > -1, "all three markers exist");
  assert.ok(noPlanBranch < form, "the form must sit inside the no-plan branch");
  assert.ok(form < planPresentBranch, "the form must precede the plan-present branch");

  // The copy states plainly that this creates an EMPTY plan only.
  assert.ok(PAGE.includes("ריקה"), "the copy must say the plan is created empty");
  assert.ok(PAGE.includes("צור תוכנית מבחנים") || FORM.includes("צור תוכנית מבחנים"));
  assert.ok(FORM.includes("צור תוכנית מבחנים"), "the button label is locked");
  // The submit button is disabled while the action is in flight.
  assert.ok(FORM.includes("useFormStatus"));
  assert.ok(FORM.includes("disabled={pending}"));
  assert.ok(FORM.includes("aria-disabled={pending}"));
});

test("12. the plan-EXISTING branch carries no create affordance whatsoever", () => {
  const planPresent = PAGE.slice(PAGE.indexOf("מצב תוכנית המבחנים"));
  for (const forbidden of ["ExamPlanCreateForm", "createExamPlanAction", "canCreatePlan"]) {
    assert.equal(
      planPresent.includes(forbidden),
      false,
      `the plan-present branch must not reference ${forbidden}`,
    );
  }
  // The read-only definitions display is intact.
  assert.ok(PAGE.includes("view.definitions.map("));
  assert.ok(PAGE.includes("לא הוגדרו מבחנים בתוכנית זו"));
});

// ===========================================================================
// 13–15. The closed feedback query, and why it cannot become scope
// ===========================================================================

test("13. searchParams carries ONLY closed feedback tokens", () => {
  // Exactly three declared keys, and no other query key is ever consulted.
  assert.ok(
    PAGE_FLAT.includes(
      "searchParams: Promise<{ created?: string | string[]; existing?: string | string[]; error?: string | string[]; }>;",
    ),
    "the searchParams type must be the closed three-key shape",
  );
  // created/existing are honoured only on the exact string "1"; a repeated key
  // (which arrives as an array) is not a recognized token.
  assert.ok(PAGE.includes('typeof query.created === "string" && query.created === "1"'));
  assert.ok(PAGE.includes('typeof query.existing === "string" && query.existing === "1"'));
  // error is honoured only for a key the table OWNS — hasOwn, so an inherited
  // property name such as `constructor` cannot select a message.
  assert.ok(
    PAGE.includes(
      'typeof query.error === "string" && Object.hasOwn(EXAM_PLAN_ERROR_MESSAGES, query.error)',
    ),
    "the error code must be checked with Object.hasOwn against the closed table",
  );
  assert.ok(PAGE.includes("return null;"), "an unrecognized query must yield no feedback");
  // The closed table holds exactly the two codes reachable on this route.
  const tableStart = PAGE.indexOf("const EXAM_PLAN_ERROR_MESSAGES");
  assert.ok(tableStart > -1, "the closed error table must exist");
  const table = PAGE.slice(tableStart, PAGE.indexOf("});", tableStart));
  const codes = [...table.matchAll(/(\w+):\s*"/g)].map((match) => match[1]).sort();
  assert.deepEqual(codes, ["operation_not_allowed", "plan_conflict"]);
});

test("14. no submitted value is ever echoed — the query selects a message, never supplies one", () => {
  const parser = PAGE.slice(PAGE.indexOf("function feedbackFrom("), PAGE.indexOf("const FEEDBACK_CLASS"));
  assert.ok(parser.length > 0, "the parser body must be locatable");
  assert.equal(
    parser.includes("${"),
    false,
    "the parser must not interpolate anything into a message",
  );
  // Every message the parser can return is a constant owned by this module.
  assert.equal(
    /message:\s*query\./.test(parser),
    false,
    "a query value must never become a message",
  );
  assert.ok(parser.includes("message: EXAM_PLAN_ERROR_MESSAGES[query.error]"));
});

test("15. NO query value can influence which course is read or written", () => {
  // searchParams appears exactly three times: the destructured prop, its type,
  // and the single await that hands it straight to the closed parser.
  assert.equal(PAGE.split("searchParams").length - 1, 3, "searchParams must appear exactly 3 times");
  assert.ok(PAGE.includes("const feedback = feedbackFrom(await searchParams);"));

  // The parsed result is a {tone, message} pair, and `query.` is referenced ONLY
  // inside the parser — never near the context, the reader or a href.
  const parserStart = PAGE.indexOf("function feedbackFrom(");
  const parserEnd = PAGE.indexOf("const FEEDBACK_CLASS");
  for (const match of PAGE.matchAll(/query\./g)) {
    const at = match.index ?? -1;
    assert.ok(at > parserStart && at < parserEnd, "query is referenced outside the closed parser");
  }

  // Scope comes from the route param and then from the VERIFIED context id only.
  assert.ok(PAGE.includes("const { courseOfferingId } = await params;"));
  assert.ok(PAGE.includes("requireAdminCourseOffering(courseOfferingId)"));
  assert.ok(
    PAGE.includes("const dashboardHref = `/admin/courses/${encodeURIComponent(context.id)}`"),
  );
  // The query is resolved only AFTER the authorization boundary.
  assert.ok(
    PAGE.indexOf("requireAdminCourseOffering(courseOfferingId)") < PAGE.indexOf("await searchParams"),
    "the query must not be parsed before authorization",
  );
  // No cookie, header or ambient offering resolver participates in scoping.
  for (const forbidden of [
    "cookies(",
    "next/headers",
    "resolveCurrentCourseOffering",
    "resolveTraineeCourseOffering",
    "current-offering",
    "admin-course-cookie",
  ]) {
    assert.equal(PAGE.includes(forbidden), false, `the page must not use ${forbidden}`);
  }
});

// ===========================================================================
// 16–18. Containment: no Prisma, no side modules, one caller, one file set
// ===========================================================================

test("16. no P3 file touches a database client directly", () => {
  for (const [name, source] of [
    ["page", PAGE],
    ["form", FORM],
    ["action", ACTION],
  ] as const) {
    for (const forbidden of [PRISMA_MODULE, GENERATED_CLIENT, "prisma.", "Prisma" + "Client"]) {
      assert.equal(source.includes(forbidden), false, `the ${name} must not reference ${forbidden}`);
    }
  }
  // ...and no file anywhere under this route directory does either.
  for (const name of readdirSync(join(REPO_ROOT, ROUTE_DIR_REL))) {
    if (!/\.tsx?$/.test(name) || name.endsWith(".test.ts")) continue;
    const source = readFileSync(join(REPO_ROOT, ROUTE_DIR_REL, name), "utf8");
    for (const forbidden of [PRISMA_MODULE, GENERATED_CLIENT]) {
      assert.equal(source.includes(forbidden), false, `${name} imports ${forbidden}`);
    }
  }
});

test("17. no publication, source-date, definition, session, capability or notification work", () => {
  for (const [name, source] of [
    ["page", PAGE],
    ["form", FORM],
    ["action", ACTION],
  ] as const) {
    // Mutation VERBS, not the word "publish": the page legitimately RENDERS the
    // committed read-only publication state (`view.publishedAt`), which predates
    // P3 and is proven by the sibling suite. What must be absent is any way to
    // CHANGE publication, source dates, definitions or sessions from here.
    for (const forbidden of [
      "publishExamPlan",
      "unpublishExamPlan",
      "deleteExamPlan",
      "sourceDate",
      "SourceDate",
      "examDefinition",
      "examSession",
      "ExamSession",
      "createExamDefinition",
      "updateExamDefinition",
      "deleteExamDefinition",
      "reorderExamDefinitions",
      "capabilit",
      "Capabilit",
      "notification",
      "Notification",
      "sendPush",
      "webpush",
    ]) {
      assert.equal(source.includes(forbidden), false, `the ${name} must not reference ${forbidden}`);
    }
  }
  // The action in particular writes nothing but the plan: publication state is
  // absent from it entirely, in either spelling.
  for (const forbidden of ["publish", "Publish"]) {
    assert.equal(ACTION.includes(forbidden), false, `the action must not reference ${forbidden}`);
  }
  // The action's ENTIRE import surface is the four approved specifiers.
  const specifiers = [...ACTION.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]).sort();
  assert.deepEqual(specifiers, [
    "@/lib/auth/require-admin",
    WRITE_BINDING_SPECIFIER,
    "next/cache",
    "next/navigation",
  ].sort());
});

test("18. the ExamPlan write binding has EXACTLY one production caller", () => {
  const callers = repoSourceFiles()
    .filter((file) => !/\.test\.tsx?$/.test(file.path))
    // The binding module itself declares the function; it is not a caller.
    .filter((file) => file.path !== `lib/actions/${WRITE_BINDING_MODULE}.ts`)
    .filter((file) => {
      const code = stripComments(file.source);
      return code.includes(WRITE_BINDING_MODULE) || PUBLIC_WRITE_CALL.test(code);
    })
    .map((file) => file.path)
    .sort();
  assert.deepEqual(callers, [APPROVED_CALLER], `an unapproved caller exists: ${callers.join(", ")}`);

  // No UI file reaches it: the only caller is a Server Action module, not a .tsx.
  assert.equal(APPROVED_CALLER.endsWith(".tsx"), false);
});

test("19. the route directory holds EXACTLY the four approved files", () => {
  // Tracked AND untracked, so this holds both before and after P3 is committed.
  // Listing the whole repository and filtering by prefix in JS is deliberate: a
  // `[courseOfferingId]` pathspec would be read by git as a character class.
  const routeFiles = [
    ...new Set([
      ...gitLines(["ls-files"]),
      ...gitLines(["ls-files", "--others", "--exclude-standard"]),
    ]),
  ]
    .filter((path) => path.startsWith(ROUTE_DIR_PREFIX))
    .sort();
  assert.deepEqual(routeFiles, [
    "app/admin/courses/[courseOfferingId]/exams/ExamPlanCreateForm.tsx",
    "app/admin/courses/[courseOfferingId]/exams/actions.ts",
    "app/admin/courses/[courseOfferingId]/exams/exam-definitions-page.contract.test.ts",
    "app/admin/courses/[courseOfferingId]/exams/exam-plan-create.contract.test.ts",
    "app/admin/courses/[courseOfferingId]/exams/page.tsx",
  ]);
});

test("20. P3 touched nothing outside its seven approved paths", () => {
  // Worktree, index and untracked together, so the guard describes the SLICE
  // rather than one moment in its lifecycle.
  const touched = new Set([
    ...gitLines(["diff", "--name-only", "HEAD"]),
    ...gitLines(["diff", "--name-only", "--cached", "HEAD"]),
    ...gitLines(["ls-files", "--others", "--exclude-standard"]),
  ]);
  const offenders = [...touched].filter((path) => !SLICE_PATHS.includes(path)).sort();
  assert.deepEqual(offenders, [], `an unapproved path was touched: ${offenders.join(", ")}`);

  // No schema or migration work came with P3.
  const migrations = readdirSync(join(REPO_ROOT, "prisma", "migrations"))
    .filter((name) => /exam/i.test(name))
    .sort();
  assert.deepEqual(migrations, [
    "20260729120000_add_exam_plan_tree",
    "20260729140000_add_exam_teaching_practice_source_date",
    "20260730120000_add_exam_definition_and_breaks",
  ]);
});

test("21. this suite opens no database and reads no environment", () => {
  const own = stripComments(readSource(join(ROUTE_DIR_REL, "exam-plan-create.contract.test.ts")));
  for (const token of [
    "DATABASE" + "_URL",
    "process" + ".env",
    "Prisma" + "Client",
    "create" + "Client",
    "supa" + "base",
  ]) {
    assert.equal(own.includes(token), false, `the suite references ${token}`);
  }
  const specifiers = [...own.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(specifiers)].sort(), [
    "node:assert/strict",
    "node:child_process",
    "node:fs",
    "node:path",
    "node:test",
  ]);
});
