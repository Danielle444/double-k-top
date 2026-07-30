/**
 * EXAM EX-S5B-5B + EXAM PLAN P3 + EXAM EX-S5B-5C — DB-free CONTRACT/source test
 * for the admin exam definitions ROUTE, now that it carries BOTH approved create
 * affordances.
 *
 * WHY STRUCTURAL. The page is a Server Component whose only data dependency is a
 * `server-only` reader, so it cannot be imported into a plain `tsx --test`
 * process — that is the point of the reader's declaration. Its BEHAVIOUR is
 * already proven, DB-free, by the pure core behind that reader; what is proven
 * here is the SHAPE of the route: its scope, its ordering, what it may import,
 * what it renders, in which state each affordance appears, and what it must never
 * gain.
 *
 * WHAT THIS SUITE OWNS, AND WHAT IT DOES NOT. The two features' own contract
 * suites — one per Server Action — prove each action's internals. This suite is
 * the ROUTE-level description: the exact file set, the combined import surface,
 * the single asserted page gate, the closed feedback query, and the STATE MATRIX
 * that decides which of the two forms may appear. Neither feature's security
 * assertions were dropped to make the combination pass; where a claim was
 * previously written as "the page has exactly one X", it is now written as the
 * exact combined set, which is still an exhaustive allow-list.
 *
 * DB-FREE AND PRODUCTION-FREE: this suite reads repository sources from disk and
 * runs `git` to describe its own file scope. It opens no database connection,
 * executes no SQL, reads no environment variable, resolves no session and makes
 * no network request.
 *
 * SPLIT LITERALS. The committed exam containment suites sweep every file under
 * `app/` for the exact specifiers they forbid, and this suite necessarily NAMES
 * much of what it forbids. Every such token is therefore assembled from pieces,
 * exactly as the committed sibling guards do, so that asserting an import is
 * absent does not itself introduce it. That now includes the exam SESSION slice's
 * module names: its committed guard asserts a caller list of exactly ZERO, so a
 * suite that spelled those paths whole would become their first "caller".
 *
 * HOW TO RUN IT — see the line comment directly below this block, which spells
 * the command out. It uses a WILDCARD for the dynamic segment, and that is not
 * cosmetic: the node test runner treats its path argument as a GLOB, so a
 * literal `[courseOfferingId]` is read as a character class and matches nothing.
 * The runner then reports 0 tests and exits 0, which looks exactly like a
 * passing suite. The committed sibling contract suite under `../schedule` is
 * affected identically. Always confirm the reported test count.
 *
 * (The command cannot live inside this block: a glob's star-slash would close
 * the comment early.)
 */
// Run:
//   npx tsx --test "app/admin/courses/*/exams/exam-definitions-page.contract.test.ts"
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..", "..");

const ROUTE_DIR_REL = join("app", "admin", "courses", "[courseOfferingId]", "exams");
/** The same directory in git's own form: forward slashes, repository-relative. */
const ROUTE_DIR_PREFIX = "app/admin/courses/[courseOfferingId]/exams/";
const PAGE_REL = join(ROUTE_DIR_REL, "page.tsx");
const TEST_REL = join(ROUTE_DIR_REL, "exam-definitions-page.contract.test.ts");
const DASHBOARD_REL = join("app", "admin", "courses", "[courseOfferingId]", "page.tsx");
const READER_GUARD_REL = join("lib", "actions", "exam-definition-read-io.test.ts");

/**
 * The amended `lib/` guard paths, assembled from pieces. Those committed guards
 * sweep raw source for their own module names and assert EXACT consumer lists;
 * spelling any of these paths whole here would make this suite count as a consumer
 * and force those lists to be widened past the production callers they pin.
 */
const PLAN_CORE_GUARD = "lib/exam/create-exam-plan" + "-core.test.ts";
const PLAN_WRITE_GUARD = "lib/actions/exam-plan-write" + "-io.test.ts";
const DEFINITION_WRITE_GUARD = "lib/actions/" + "exam-definition-write" + "-io.test.ts";

/**
 * The exam SESSION slice's files, which travel in the same integration batch but
 * belong to no route. Assembled for the reason above, and more sharply so: that
 * slice's committed guard asserts its writers have EXACTLY ZERO callers anywhere
 * under `app/`, `lib/` and `components/`, so naming them whole here would make
 * this file the very first violation of a claim that must stay at zero.
 */
const SESSION_SLICE_PATHS = [
  "lib/actions/" + "exam-session-write" + "-io.ts",
  "lib/actions/" + "exam-session-write" + "-io.test.ts",
  "lib/exam/" + "update-exam-session" + "-core.ts",
  "lib/exam/" + "update-exam-session" + "-core.test.ts",
  "lib/exam/" + "delete-exam-session" + "-core.ts",
  "lib/exam/" + "delete-exam-session" + "-core.test.ts",
];

/**
 * Every path this integration batch is allowed to have touched: the route's five
 * production/support files, the three route contract suites, the four amended
 * `lib/` guard suites, and the session slice's own six files.
 *
 * The four amended GUARD suites are the ExamPlan pure core's and write binding's
 * suites (both of which asserted the plan binding had NO caller at all), and the
 * definition reader's and definition write binding's suites (which asserted the
 * same of the definition writer). Each was RE-POINTED to an exact path rather than
 * relaxed, so a second caller still fails there.
 */
const SLICE_PATHS = [
  "app/admin/courses/[courseOfferingId]/exams/page.tsx",
  "app/admin/courses/[courseOfferingId]/exams/actions.ts",
  "app/admin/courses/[courseOfferingId]/exams/ExamPlanCreateForm.tsx",
  "app/admin/courses/[courseOfferingId]/exams/ExamDefinitionCreateForm.tsx",
  "app/admin/courses/[courseOfferingId]/exams/exam-definition-create-error-messages.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-plan-create.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-definition-create.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-definitions-page.contract.test.ts",
  // EX-SES-S4 — the approved ExamSession CREATE UI. Three NEW route files, none
  // of them wired into the page: this slice re-points the route file set below
  // and nothing else here. `page.tsx` is asserted BYTE-IDENTICAL to HEAD by that
  // slice's own suite, and it stays in this list only because the earlier batch
  // legitimately changed it.
  "app/admin/courses/[courseOfferingId]/exams/ExamSessionCreateForm.tsx",
  "app/admin/courses/[courseOfferingId]/exams/exam-session-create-error-messages.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-session-create.contract.test.ts",
  READER_GUARD_REL.replace(/\\/g, "/"),
  PLAN_CORE_GUARD,
  PLAN_WRITE_GUARD,
  DEFINITION_WRITE_GUARD,
  ...SESSION_SLICE_PATHS,
];

/** Strip comments so every guard asserts on CODE, not on explanatory prose. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Collapse whitespace, so an assertion survives ordinary JSX reformatting. */
function squash(source: string): string {
  return source.replace(/\s+/g, " ");
}

function readSource(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

const PAGE_SOURCE = readSource(PAGE_REL);
const PAGE = stripComments(PAGE_SOURCE);
const PAGE_FLAT = squash(PAGE);
const DASHBOARD = stripComments(readSource(DASHBOARD_REL));

function gitLines(args: readonly string[]): string[] {
  const result = spawnSync("git", [...args], { cwd: REPO_ROOT, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed`);
  return (result.stdout ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

// Split specifiers — see the header note.
const PRISMA_MODULE = ["@/lib", "prisma"].join("/");
const GENERATED_CLIENT = ["@prisma", "client"].join("/");
const TP_ACTIONS_MODULE = ["lib/actions", "teaching-practice"].join("/");
const LOADER_SYMBOL = "load" + "ExamPlan";
const ADMIN_PLAN_READER = "read" + "AdminExamPlan";
const ROLE_READERS_MODULE = "exam-role" + "-readers";
const READ_IO_MODULE = "exam-read" + "-io";
const READ_SCOPE_MODULE = "exam-read-scope" + "-core";
const DEFINITION_WRITE_MODULE = "exam-definition-write" + "-io";
const PLAN_WRITE_MODULE = "exam-plan-write" + "-io";
/**
 * DIRECT CALLS of the two write bindings' public functions. Split for the usual
 * reason: each committed binding guard sweeps every source file for exactly this
 * call shape and asserts an EXACT caller list, so spelling either whole would make
 * this suite count as a caller and force that list to be widened.
 *
 * Note the trailing parenthesis in both. It is what distinguishes the WRITER from
 * the Server Action that wraps it: the page legitimately names
 * `createExamPlanAction` and `createExamDefinitionAction`, and must never name the
 * binding those actions call.
 */
const PLAN_WRITE_CALL = "create" + "ExamPlan(";
const DEFINITION_WRITE_CALL = "createExamDefinition" + "(";

// ===========================================================================
// 1–3. The route: exactly one, exactly course-scoped
// ===========================================================================

test("1. the page lives at the EXACT course-scoped route", () => {
  assert.ok(existsSync(join(REPO_ROOT, PAGE_REL)), `${PAGE_REL} is missing`);
});

test("2. no top-level exams route exists in any role area", () => {
  for (const dir of [
    join("app", "admin", "exams"),
    join("app", "admin", "exam-definitions"),
    join("app", "instructor", "exams"),
    join("app", "student", "exams"),
  ]) {
    assert.equal(existsSync(join(REPO_ROOT, dir)), false, `${dir} was created`);
  }
});

test("3. the route directory holds exactly the eleven approved files", () => {
  // Tracked AND untracked, so this holds both before and after the batch is
  // committed. Listing the whole repository and filtering by prefix in JS is
  // deliberate: a `[courseOfferingId]` pathspec would be read by git as a
  // character class and quietly match nothing.
  //
  // RE-POINTED by EX-SES-S4, not relaxed: three reviewed session-create files
  // joined the route. None of them is rendered by the page — the wiring is a
  // later slice — so every page assertion in this suite is unaffected.
  const routeFiles = [
    ...new Set([
      ...gitLines(["ls-files"]),
      ...gitLines(["ls-files", "--others", "--exclude-standard"]),
    ]),
  ]
    .filter((path) => path.startsWith(ROUTE_DIR_PREFIX))
    .sort();
  assert.deepEqual(routeFiles, [
    "app/admin/courses/[courseOfferingId]/exams/ExamDefinitionCreateForm.tsx",
    "app/admin/courses/[courseOfferingId]/exams/ExamPlanCreateForm.tsx",
    "app/admin/courses/[courseOfferingId]/exams/ExamSessionCreateForm.tsx",
    "app/admin/courses/[courseOfferingId]/exams/actions.ts",
    "app/admin/courses/[courseOfferingId]/exams/exam-definition-create-error-messages.ts",
    "app/admin/courses/[courseOfferingId]/exams/exam-definition-create.contract.test.ts",
    "app/admin/courses/[courseOfferingId]/exams/exam-definitions-page.contract.test.ts",
    "app/admin/courses/[courseOfferingId]/exams/exam-plan-create.contract.test.ts",
    "app/admin/courses/[courseOfferingId]/exams/exam-session-create-error-messages.ts",
    "app/admin/courses/[courseOfferingId]/exams/exam-session-create.contract.test.ts",
    "app/admin/courses/[courseOfferingId]/exams/page.tsx",
  ]);
});

// ===========================================================================
// 4–8. Authorization, the gates, and the ORDER
// ===========================================================================

test("4. the page validates the exact route offering, and fails closed", () => {
  assert.ok(PAGE.includes("requireAdminCourseOffering(courseOfferingId)"));
  assert.ok(PAGE.includes("CourseOfferingNotFoundError"), "must fail closed on not-found");
  assert.ok(PAGE.includes("notFound()"), "a typed not-found must render notFound()");
  // The requested id is never reflected back to the caller.
  assert.equal(
    /notFound\(\)[\s\S]{0,80}courseOfferingId/.test(PAGE),
    false,
    "the requested id must not be echoed at the not-found boundary",
  );
});

test("5. HISTORICAL_READ is the ONLY asserted gate; the write gate is only evaluated", () => {
  // The page's only gate that can DENY the page itself is still the READ gate, so
  // an ARCHIVED offering's exam configuration stays readable history.
  assert.ok(PAGE.includes('assertCourseOperationAllowed(context.status, "HISTORICAL_READ")'));
  assert.equal(
    PAGE.split("assertCourseOperationAllowed(").length - 1,
    1,
    "exactly one throwing lifecycle gate may run on this page",
  );

  // The page ALSO needs to know whether the offering may be CONFIGURED, in order
  // to decide which create form to render. That question is asked with the PURE,
  // total, default-deny evaluator and NEVER with the asserting form — asserting it
  // would turn every ARCHIVED course's exams page into an error instead of the
  // readable history it must stay.
  assert.ok(
    PAGE.includes("evaluateCourseOperationPolicy(") && PAGE.includes(").allowed"),
    "the write gate must be EVALUATED for form visibility",
  );
  assert.equal(
    /assertCourseOperationAllowed\([^)]*SCHEDULE_DRAFT_CONFIGURATION/.test(PAGE),
    false,
    "the configuration gate must NOT be able to deny the page itself",
  );

  // BOTH display decisions are evaluated with SCHEDULE_DRAFT_CONFIGURATION, and
  // through a SINGLE evaluation on the VERIFIED status: the literal appears exactly
  // once, so the two affordances cannot drift onto different operations.
  assert.ok(
    PAGE_FLAT.includes(
      'const mayConfigure = evaluateCourseOperationPolicy( context.status, "SCHEDULE_DRAFT_CONFIGURATION", ).allowed;',
    ),
    "the one write-gate evaluation must be on the verified status",
  );
  assert.equal((PAGE.match(/"SCHEDULE_DRAFT_CONFIGURATION"/g) ?? []).length, 1);
  assert.equal((PAGE.match(/evaluateCourseOperationPolicy\(/g) ?? []).length, 1);
  assert.ok(PAGE.includes("const canCreatePlan = mayConfigure && !view.planExists;"));
  assert.ok(PAGE.includes("const showCreateForm = view.planExists && mayConfigure;"));

  // No other course operation is consulted anywhere on this page.
  for (const forbidden of [
    "OFFERING_STRUCTURE_UPDATE",
    "OFFERING_METADATA_UPDATE",
    "SCHEDULE_PUBLICATION",
    "ENROLLMENT_MANAGEMENT",
    "TEACHING_PRACTICE_OPERATION",
    "DESTRUCTIVE_MAINTENANCE",
  ]) {
    assert.equal(PAGE.includes(forbidden), false, `the page must not use ${forbidden}`);
  }
});

test("6. authorization, then the gate, then the read — in that order", () => {
  const auth = PAGE.indexOf("requireAdminCourseOffering(courseOfferingId)");
  const gate = PAGE.indexOf('assertCourseOperationAllowed(context.status, "HISTORICAL_READ")');
  const read = PAGE.indexOf("readExamDefinitionsForAdmin(context.id)");
  assert.ok(auth > -1 && gate > -1 && read > -1, "all three steps must be present");
  assert.ok(auth < gate, "the offering must be verified before the lifecycle gate");
  assert.ok(gate < read, "the lifecycle gate must run before the read");
  // Nothing at all is awaited before the authorization boundary.
  assert.equal(PAGE.indexOf("await "), PAGE.indexOf("await params"), "params is awaited first");
  assert.ok(
    PAGE.indexOf("await params") < auth,
    "only the route params may be resolved before authorization",
  );
});

test("7. the reader receives the VERIFIED context id, never the raw route param", () => {
  assert.ok(PAGE.includes("readExamDefinitionsForAdmin(context.id)"));
  assert.equal(
    PAGE.includes("readExamDefinitionsForAdmin(courseOfferingId)"),
    false,
    "the raw route param must never reach the reader",
  );
  // Exactly one read call on the page.
  assert.equal(PAGE.split("readExamDefinitionsForAdmin(").length - 1, 1);
});

test("8. the route param is the ONLY scope input; the query is feedback only", () => {
  // This guard originally forbade `searchParams` outright. Both features need it
  // for closed post-redirect feedback, so the claim is NARROWED rather than
  // dropped: the query may select a message and NOTHING else. Every other ambient
  // scope source stays forbidden.
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

  // Scope still comes from the route param, then from the VERIFIED context id.
  assert.ok(PAGE.includes("const { courseOfferingId } = await params;"));
  assert.ok(PAGE.includes("requireAdminCourseOffering(courseOfferingId)"));

  // The query is resolved EXACTLY ONCE — after authorization AND after the read —
  // and is then handed only to closed parsers. One resolution matters: two would
  // let a later reader diverge from the one the guards below describe.
  assert.equal(PAGE.split("await searchParams").length - 1, 1);
  assert.ok(PAGE.includes("const query = await searchParams;"));
  assert.ok(
    PAGE.indexOf("requireAdminCourseOffering(courseOfferingId)") <
      PAGE.indexOf("await searchParams"),
    "the query must not be parsed before authorization",
  );
  assert.ok(
    PAGE.indexOf("readExamDefinitionsForAdmin(context.id)") < PAGE.indexOf("await searchParams"),
    "the query must not be parsed before the read",
  );
  assert.ok(PAGE.includes("const feedback = feedbackFrom(query);"));
  assert.ok(
    PAGE.includes("const { createdDefinition, createError, createIssues } = query;"),
    "the definition outcome must come from that one resolved query",
  );

  // The declared query shape is CLOSED: exactly the six feedback keys, and not one
  // of them names a course, a plan, a definition or any other id. Every key admits
  // an ARRAY, which is what a repeated query key arrives as — so the parsers are
  // forced to reject it rather than coerce it.
  const typeStart = PAGE.indexOf("searchParams: Promise<{");
  assert.ok(typeStart > -1, "the searchParams type must be declared inline");
  const queryType = PAGE.slice(typeStart, PAGE.indexOf("}>;", typeStart));
  const keys = [...queryType.matchAll(/(\w+)\?:/g)].map((match) => match[1]).sort();
  assert.deepEqual(
    keys,
    ["createError", "createIssues", "createdDefinition", "created", "error", "existing"].sort(),
  );
  assert.equal(
    (queryType.match(/string \| string\[\]/g) ?? []).length,
    6,
    "every feedback key must admit the array form a repeated key produces",
  );
  for (const forbidden of ["courseOfferingId?", "planId", "definitionId", "offeringId"]) {
    assert.equal(queryType.includes(forbidden), false, `searchParams must not carry ${forbidden}`);
  }

  // Nothing from the query may reach authorization, the reader, a href or a bind.
  for (const forbidden of [
    "searchParams.courseOfferingId",
    "feedbackFrom(await params)",
    "readExamDefinitionsForAdmin(searchParams",
    "readExamDefinitionsForAdmin(createError",
    "requireAdminCourseOffering(create",
    "encodeURIComponent(searchParams",
    ".bind(null, createdDefinition",
    ".bind(null, query",
  ]) {
    assert.equal(PAGE.includes(forbidden), false, `the query must not reach ${forbidden}`);
  }
});

// ===========================================================================
// 9–12. The module kind, and the exact import surface
// ===========================================================================

test("9. the page is a server component and declares force-dynamic", () => {
  assert.equal(PAGE.includes('"use client"'), false, "the page must not be a client component");
  assert.equal(PAGE.includes("'use client'"), false, "the page must not be a client component");
  assert.equal(PAGE.includes('"use server"'), false, "the page must not be a Server Action module");
  assert.ok(PAGE.includes('export const dynamic = "force-dynamic"'));
});

test("10. the page imports EXACTLY the nine approved specifiers", () => {
  // The four additions over the read-only page are all ROUTE-LOCAL: the shared
  // Server Action module, the two client create forms, and the local message
  // table. No new shared module, no core and no second data source entered the
  // page, and it still reaches NO write binding directly.
  const specifiers = [...PAGE.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]).sort();
  assert.deepEqual(specifiers, [
    "./ExamDefinitionCreateForm",
    "./ExamPlanCreateForm",
    "./actions",
    "./exam-definition-create-error-messages",
    "@/lib/actions/exam-definition-read-io",
    "@/lib/course/admin-course-context",
    "@/lib/course/operation-policy-core",
    "next/link",
    "next/navigation",
  ]);
});

test("11. no database client and no other exam read pipeline is reachable", () => {
  for (const forbidden of [
    PRISMA_MODULE,
    GENERATED_CLIENT,
    "prisma.",
    "PrismaClient",
    LOADER_SYMBOL,
    ADMIN_PLAN_READER,
    ROLE_READERS_MODULE,
    READ_IO_MODULE,
    READ_SCOPE_MODULE,
  ]) {
    assert.equal(PAGE.includes(forbidden), false, `the page must not reference ${forbidden}`);
  }
});

test("12. no Teaching Practice, student, instructor or contact dependency exists", () => {
  for (const forbidden of [
    TP_ACTIONS_MODULE,
    "teachingPractice",
    "TeachingPractice",
    "getStudentContacts",
    "getInstructorContacts",
    "parentContact",
    "ParentContact",
    "student",
    "Student",
    "instructor",
    "Instructor",
    "capabilit",
  ]) {
    assert.equal(PAGE.includes(forbidden), false, `the page must not reference ${forbidden}`);
  }
});

// ===========================================================================
// 13–15. EXACTLY TWO mutations, no control rendered here, one link
// ===========================================================================

test("13. EXACTLY the two approved Server Actions are reachable from the page", () => {
  // The page may import its route-local Server Action module, and nothing else
  // that writes. Both approved actions are bound to the VERIFIED context id.
  assert.ok(PAGE.includes('from "./actions"'), "the page must import its own action module");
  assert.ok(PAGE.includes("createExamPlanAction.bind(null, context.id)"));
  assert.ok(PAGE.includes("createExamDefinitionAction.bind(null, context.id)"));
  // Each action is imported once and bound once — never bound twice, and never
  // bound to the RAW route param.
  assert.equal((PAGE.match(/createExamPlanAction/g) ?? []).length, 2);
  assert.equal((PAGE.match(/createExamDefinitionAction/g) ?? []).length, 2);
  for (const forbidden of [
    "createExamPlanAction.bind(null, courseOfferingId)",
    "createExamDefinitionAction.bind(null, courseOfferingId)",
  ]) {
    assert.equal(
      PAGE.includes(forbidden),
      false,
      `the raw route param must not be bound: ${forbidden}`,
    );
  }

  for (const forbidden of [
    // The committed write bindings stay unreachable from the page: only the
    // Server Action module may name or call them.
    DEFINITION_WRITE_MODULE,
    PLAN_WRITE_MODULE,
    PLAN_WRITE_CALL,
    DEFINITION_WRITE_CALL,
    // Every OTHER exam mutation remains absent — not disabled, but unimportable.
    "update" + "ExamDefinition",
    "delete" + "ExamDefinition",
    "reorder" + "ExamDefinitions",
    "deleteExamPlan",
    "publishExamPlan",
    "unpublishExamPlan",
    "sourceDate",
    "SourceDate",
    "examSession",
    "ExamSession",
    // The page itself performs no server mutation work: no revalidation and no
    // redirect. Those belong to the actions.
    "revalidatePath",
    "revalidateTag",
    "redirect(",
  ]) {
    assert.equal(PAGE.includes(forbidden), false, `the page must not reference ${forbidden}`);
  }
});

test("14. the page renders NO control itself and holds no state", () => {
  // Each create form is a separate client component. The page composes them and
  // supplies the bound actions; it declares no markup control and no hook, so
  // there is no second place where submission behaviour could be defined.
  for (const forbidden of [
    "<form",
    "</form",
    "<button",
    "<input",
    "<select",
    "<textarea",
    "formAction",
    "onClick",
    "onSubmit",
    "onChange",
    "disabled",
    "useState",
    "useTransition",
    "useEffect",
    "useFormStatus",
    "useActionState",
    "useOptimistic",
    '"use client"',
  ]) {
    assert.equal(PAGE.includes(forbidden), false, `the page must not render ${forbidden}`);
  }

  // `action=` appears exactly TWICE — once per approved form — and each one is a
  // server-bound action prop, never an `action=` on markup the page renders itself.
  assert.equal((PAGE.match(/action=/g) ?? []).length, 2, "action= must appear exactly twice");
  assert.ok(
    PAGE_FLAT.includes(
      "<ExamPlanCreateForm action={createExamPlanAction.bind(null, context.id)} />",
    ),
    "the plan form must receive exactly the bound plan action",
  );
  assert.ok(
    PAGE_FLAT.includes(
      "<ExamDefinitionCreateForm action={createExamDefinitionAction.bind(null, context.id)} />",
    ),
    "the definition form must receive exactly the bound definition action",
  );
});

test("15. the only navigation is the course-scoped back link", () => {
  const hrefs = [...PAGE.matchAll(/href=\{?([^}\s]+)\}?/g)].map((match) => match[1]);
  assert.deepEqual(hrefs, ["dashboardHref"], "the page must expose exactly one link");
  assert.ok(
    PAGE.includes("const dashboardHref = `/admin/courses/${encodeURIComponent(context.id)}`"),
    "the back link must be built from the validated context id",
  );
});

// ===========================================================================
// 16–18. What is rendered, and what must never be
// ===========================================================================

test("16. no raw id, plan id or version stamp is rendered", () => {
  // `{definition.id}` is not forbidden outright: it is the legitimate React key.
  // What is forbidden is rendering it as TEXT or as a field value.
  for (const forbidden of [
    "updatedAt",
    "planId",
    "orderIndex",
    ">{definition.id}<",
    "value={definition.id}",
  ]) {
    assert.equal(PAGE.includes(forbidden), false, `the page must not render ${forbidden}`);
  }
  // The definition id appears ONCE, and only as a React key — never as text.
  const idUses = [...PAGE.matchAll(/definition\.id/g)];
  assert.equal(idUses.length, 1, "definition.id must be used exactly once");
  assert.ok(PAGE.includes("key={definition.id}"), "its only use must be the React key");
});

test("17. every required display field is rendered", () => {
  for (const field of [
    "definition.name",
    "definition.kind",
    "definition.durationMinutes",
    "definition.parallelCapacity",
    "definition.requiresInstructedTrainee",
    "definition.requiresLessonTopic",
    "definition.requiresDiscipline",
    "definition.sessionCount",
  ]) {
    assert.ok(PAGE.includes(field), `${field} is not rendered`);
  }
  // Each of the four exam kinds has a Hebrew label, and an unknown kind is
  // named explicitly rather than leaking a raw enum token.
  for (const kind of [
    "INTERFACE_RIDING",
    "LUNGE_NO_RIDER",
    "ADVANCED_INSTRUCTION",
    "BEGINNER_INSTRUCTION",
  ]) {
    assert.ok(PAGE.includes(kind), `${kind} has no Hebrew label`);
  }
  assert.ok(PAGE.includes("סוג מבחן לא מזוהה"), "an unknown kind must be named explicitly");
});

test("18. the definitions are rendered in the reader's order, unmodified", () => {
  assert.ok(PAGE.includes("view.definitions.map("), "the reader's list is rendered directly");
  for (const forbidden of [".sort(", ".reverse(", ".filter(", ".slice("]) {
    assert.equal(PAGE.includes(forbidden), false, `the page must not ${forbidden} the list`);
  }
});

// ===========================================================================
// 19–21. The rendered states
// ===========================================================================

test("19. the no-plan state offers the PLAN create only, and never the definition form", () => {
  assert.ok(PAGE.includes("view.planExists"), "the plan-absent branch must be driven by the view");
  assert.ok(
    PAGE.includes("עדיין לא נוצרה תוכנית מבחנים לקורס זה"),
    "the no-plan state must say so in Hebrew",
  );

  // SCOPED TO THE BRANCH, and located by the exact JSX marker rather than by the
  // bare condition: the condition also appears in the display flags above the
  // markup, and slicing from there would sweep the feedback banners in.
  const noPlanStart = PAGE.indexOf("{!view.planExists ? (");
  assert.ok(noPlanStart > 0, "the no-plan branch was not found");
  const noPlan = PAGE.slice(noPlanStart, PAGE.indexOf(") : ("));
  assert.ok(noPlan.length > 0, "the no-plan branch must be locatable");

  // The ONE affordance this state may offer is the plan create, lifecycle-gated...
  assert.ok(
    noPlan.includes("<ExamPlanCreateForm"),
    "the plan create must sit in the no-plan branch",
  );
  assert.ok(noPlan.includes("{canCreatePlan && ("), "the affordance must be lifecycle-gated");
  assert.equal(
    PAGE.split("<ExamPlanCreateForm").length - 1,
    1,
    "exactly one plan-create affordance may exist on the page",
  );
  // The copy states plainly that only an EMPTY plan is created.
  assert.ok(noPlan.includes("ריקה"));

  // ...and the definition create is structurally absent here: this state has no
  // plan to attach a definition to, so a form here could only ever fail.
  for (const forbidden of [
    "ExamDefinitionCreateForm",
    "createExamDefinitionAction",
    "showCreateForm",
  ]) {
    assert.equal(noPlan.includes(forbidden), false, `the no-plan state must not offer ${forbidden}`);
  }

  // The no-plan state itself is not styled or worded as a failure. (The danger
  // styling that exists on the page belongs to the feedback banners, which render
  // ABOVE this branch and only after a real refusal.)
  for (const forbidden of ["bg-danger-muted", "text-danger", "שגיאה."]) {
    assert.equal(noPlan.includes(forbidden), false, `the no-plan state must not use ${forbidden}`);
  }
});

test("20. the empty-definitions state is explicit and distinct from the no-plan state", () => {
  assert.ok(PAGE.includes("view.definitions.length"), "emptiness must be derived from the view");
  assert.ok(PAGE.includes("לא הוגדרו מבחנים בתוכנית זו"));
  assert.ok(
    PAGE.includes("עדיין לא נוצרה תוכנית מבחנים לקורס זה"),
    "the two empty states must not share one message",
  );
});

test("21. the plan publication state is shown as draft or published", () => {
  assert.ok(PAGE.includes("view.publishedAt !== null"), "publication must come from the view");
  assert.ok(PAGE.includes("טיוטה"), "an unpublished plan must read as a draft");
  assert.ok(PAGE.includes("פורסמה"), "a published plan must say so");
});

// ===========================================================================
// 22. The dashboard entry point
// ===========================================================================

test("22. the course dashboard links to the EXACT course-scoped exams route", () => {
  assert.ok(
    DASHBOARD.includes(
      "const examsHref = `/admin/courses/${encodeURIComponent(context.id)}/exams`",
    ),
    "the dashboard href must be built from the validated context id",
  );
  assert.ok(DASHBOARD.includes("href={examsHref}"), "the link must use that href");
  assert.equal(
    DASHBOARD.includes('"/admin/exams"'),
    false,
    "the dashboard must not link to a top-level exams route",
  );
  // The dashboard gained a link and nothing else: no reader, no action, no gate.
  for (const forbidden of ["readExamDefinitionsForAdmin", "exam-definition-read", "ExamPlan"]) {
    assert.equal(
      DASHBOARD.includes(forbidden),
      false,
      `the dashboard must not reference ${forbidden}`,
    );
  }
});

// ===========================================================================
// 23–24. The batch's exact footprint
// ===========================================================================

test("23. this batch touched nothing outside its approved paths", () => {
  // Worktree modifications, staged changes and untracked files together — so the
  // guard describes the BATCH rather than one moment in its lifecycle, and keeps
  // holding after the work is staged or committed.
  const touched = new Set([
    ...gitLines(["diff", "--name-only", "HEAD"]),
    ...gitLines(["diff", "--name-only", "--cached", "HEAD"]),
    ...gitLines(["ls-files", "--others", "--exclude-standard"]),
  ]);
  const offenders = [...touched].filter((path) => !SLICE_PATHS.includes(path)).sort();
  assert.deepEqual(offenders, [], `an unapproved path was touched: ${offenders.join(", ")}`);

  // No schema, migration or capability file is among them, in any state.
  for (const path of touched) {
    assert.equal(/^prisma\//.test(path), false, `the batch touched ${path}`);
    assert.equal(/capabilit/i.test(path), false, `the batch touched ${path}`);
  }
});

test("24. the amended committed guard suites all exist and are approved paths", () => {
  // Four committed guards were re-pointed rather than relaxed. The plan pure
  // core's and plan binding's suites both asserted that binding had NO caller; the
  // definition reader's and definition binding's suites asserted the same of the
  // definition writer. Each now names ONE exact caller — this route's action
  // module — so a second caller still fails there. This suite is the fifth amended
  // guard: it asserted the page had no creation affordance at all.
  const AMENDED_GUARDS = [
    PLAN_CORE_GUARD,
    PLAN_WRITE_GUARD,
    DEFINITION_WRITE_GUARD,
    READER_GUARD_REL.replace(/\\/g, "/"),
    TEST_REL.replace(/\\/g, "/"),
  ];
  for (const rel of AMENDED_GUARDS) {
    assert.ok(existsSync(join(REPO_ROOT, rel)), `${rel} is missing`);
    assert.ok(SLICE_PATHS.includes(rel), `${rel} is not an approved slice path`);
    assert.match(rel, /\.test\.ts$/, "only test suites may be amended as guards");
  }

  // The production files of this route are an EXACT set: the page, the shared
  // Server Action module, the two forms and the local message table. Nothing else
  // under `app/` is an approved path for this batch.
  const appProduction = SLICE_PATHS.filter(
    (path) => path.startsWith("app/") && !/\.test\.tsx?$/.test(path),
  ).sort();
  assert.deepEqual(appProduction, [
    "app/admin/courses/[courseOfferingId]/exams/ExamDefinitionCreateForm.tsx",
    "app/admin/courses/[courseOfferingId]/exams/ExamPlanCreateForm.tsx",
    // RE-POINTED by EX-SES-S4: a third form and a third message table joined the
    // route. Neither is rendered by the page — the wiring is a later slice — so
    // this list grew while the page's own affordance matrix did not.
    "app/admin/courses/[courseOfferingId]/exams/ExamSessionCreateForm.tsx",
    "app/admin/courses/[courseOfferingId]/exams/actions.ts",
    "app/admin/courses/[courseOfferingId]/exams/exam-definition-create-error-messages.ts",
    "app/admin/courses/[courseOfferingId]/exams/exam-session-create-error-messages.ts",
    "app/admin/courses/[courseOfferingId]/exams/page.tsx",
  ]);

  // A guard suite belonging to an UNRELATED slice must not have been widened to
  // let this batch through. The message-audience containment suite is the one
  // neighbouring guard that none of the three merged features may touch.
  const changed = new Set(gitLines(["diff", "--name-only", "HEAD"]));
  const untouchable = "lib/actions/" + "message-audience" + ".contract.test.ts";
  assert.equal(
    changed.has(untouchable),
    false,
    `${untouchable} must not be weakened by this batch`,
  );
});

// ===========================================================================
// 25–27. The full affordance matrix: plan state x lifecycle x publication
// ===========================================================================

test("25. the plan-PRESENT branch carries no plan-create affordance whatsoever", () => {
  const planPresent = PAGE.slice(PAGE.indexOf("מצב תוכנית המבחנים"));
  assert.ok(planPresent.length > 0, "the plan-present branch must be locatable");
  for (const forbidden of ["ExamPlanCreateForm", "createExamPlanAction", "canCreatePlan"]) {
    assert.equal(
      planPresent.includes(forbidden),
      false,
      `the plan-present branch must not reference ${forbidden}`,
    );
  }
  // It carries the DEFINITION create instead, behind its own flag, exactly once.
  assert.ok(
    planPresent.includes("{showCreateForm ? ("),
    "the definition form must be behind its flag",
  );
  assert.equal((PAGE.match(/<ExamDefinitionCreateForm/g) ?? []).length, 1);
  // The read-only definitions display is intact.
  assert.ok(PAGE.includes("view.definitions.map("));
  assert.ok(PAGE.includes("לא הוגדרו מבחנים בתוכנית זו"));
});

test("26. an ARCHIVED offering keeps a readable page and loses BOTH forms, by POLICY", () => {
  // The page states no status literal of its own: which statuses may configure is
  // the committed policy's decision, so ARCHIVED is denied there and not here.
  for (const literal of ['"ARCHIVED"', '"PLANNED"', '"ACTIVE"']) {
    assert.equal(PAGE.includes(literal), false, `the page hard-codes ${literal}`);
  }
  // Both display flags are conjunctions over the SAME evaluated gate, so a policy
  // denial (`mayConfigure === false`) removes BOTH affordances and can remove
  // neither selectively.
  assert.ok(PAGE.includes("const canCreatePlan = mayConfigure && !view.planExists;"));
  assert.ok(PAGE.includes("const showCreateForm = view.planExists && mayConfigure;"));
  // ...while the READ gate still asserts, so archived configuration stays readable.
  assert.ok(PAGE.includes('assertCourseOperationAllowed(context.status, "HISTORICAL_READ")'));
});

test("27. a PUBLISHED plan keeps the definition form and only gains an advisory", () => {
  // Publication is NOT part of either visibility decision: whether a published
  // plan may still be configured is the lifecycle policy's call, not this page's.
  assert.ok(PAGE.includes("const isPublished = view.publishedAt !== null;"));
  for (const flag of [
    "const canCreatePlan = mayConfigure && !view.planExists;",
    "const showCreateForm = view.planExists && mayConfigure;",
  ]) {
    assert.ok(PAGE.includes(flag));
    assert.equal(flag.includes("isPublished"), false, "publication must not gate an affordance");
    assert.equal(flag.includes("publishedAt"), false, "publication must not gate an affordance");
  }
  // What publication DOES change is one advisory sentence inside the form card.
  assert.ok(
    PAGE.includes("שימו לב: תוכנית המבחנים כבר פורסמה."),
    "a published plan must carry the advisory",
  );
  const formCard = PAGE.slice(PAGE.indexOf("{showCreateForm ? ("));
  assert.ok(formCard.includes("{isPublished ? ("), "the advisory must sit inside the form card");
});
