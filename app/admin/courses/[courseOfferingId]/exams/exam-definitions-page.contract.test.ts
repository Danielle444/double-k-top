/**
 * EXAM EX-S5B-5B — DB-free CONTRACT/source test for the READ-ONLY admin exam
 * definitions page.
 *
 * WHY STRUCTURAL. The page is a Server Component whose only data dependency is a
 * `server-only` reader, so it cannot be imported into a plain `tsx --test`
 * process — that is the point of the reader's declaration. Its BEHAVIOUR is
 * already proven, DB-free, by the pure core behind that reader; what is proven
 * here is the SHAPE of the route: its scope, its ordering, what it may import,
 * what it renders, and what it must never gain.
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
 * absent does not itself introduce it.
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
 * Every path the CURRENT slice (EXAM PLAN P3) is allowed to have touched — three
 * new route files and four amended ones.
 *
 * The three amended GUARD suites are the ExamPlan write binding's suite and the
 * pure core's suite, which both asserted the binding had NO caller at all, and
 * this suite, which asserted this page had no creation affordance. P3 supersedes
 * exactly those claims and re-points them at its one exact caller.
 */
/**
 * The two amended `lib/` guard paths, assembled from pieces. Those committed
 * guards sweep raw source for their own module names and assert EXACT consumer
 * lists; spelling either path whole here would make this suite count as a consumer
 * and force those lists to be widened past the one production caller they pin.
 */
const PLAN_CORE_GUARD = "lib/exam/create-exam-plan" + "-core.test.ts";
const PLAN_WRITE_GUARD = "lib/actions/exam-plan-write" + "-io.test.ts";

const SLICE_PATHS = [
  "app/admin/courses/[courseOfferingId]/exams/page.tsx",
  "app/admin/courses/[courseOfferingId]/exams/actions.ts",
  "app/admin/courses/[courseOfferingId]/exams/ExamPlanCreateForm.tsx",
  "app/admin/courses/[courseOfferingId]/exams/exam-plan-create.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-definitions-page.contract.test.ts",
  PLAN_CORE_GUARD,
  PLAN_WRITE_GUARD,
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
 * A direct call of the plan write binding's public function. Split for the usual
 * reason: the committed binding guard sweeps every source file for this exact
 * token and asserts an EXACT caller list, so spelling it whole here would make
 * this suite count as a caller and force that list to be widened.
 */
const PLAN_WRITE_CALL = "create" + "ExamPlan(";

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

test("3. the route directory holds exactly the four approved files", () => {
  // Tracked AND untracked, so this holds both before and after the slice is
  // committed. Listing the whole repository and filtering by prefix in JS is
  // deliberate: a `[courseOfferingId]` pathspec would be read by git as a
  // character class and quietly match nothing.
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

// ===========================================================================
// 4–7. Authorization, the read gate, and the ORDER
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

test("5. the THROWING gate is HISTORICAL_READ; the write gate only hides a button", () => {
  // The page's only gate that can DENY the page itself is still the read gate, so
  // an ARCHIVED offering's exam configuration stays readable history.
  assert.ok(PAGE.includes('assertCourseOperationAllowed(context.status, "HISTORICAL_READ")'));
  assert.equal(
    PAGE.split("assertCourseOperationAllowed(").length - 1,
    1,
    "exactly one throwing lifecycle gate may run on this page",
  );

  // P3 TRANSITION. The page may now ALSO evaluate the configuration gate — but
  // only through the NON-throwing policy evaluation, and only to decide whether to
  // render the create button. The server binding re-runs the same gate and refuses
  // on its own, so this can never be the enforcement.
  assert.ok(
    PAGE.includes('evaluateCourseOperationPolicy(') && PAGE.includes('"SCHEDULE_DRAFT_CONFIGURATION"'),
    "the affordance must be gated on the non-throwing policy evaluation",
  );
  assert.equal(
    PAGE.includes('assertCourseOperationAllowed(context.status, "SCHEDULE_DRAFT_CONFIGURATION")'),
    false,
    "the configuration gate must NOT be able to deny the page itself",
  );
  // No other course operation is consulted anywhere on this page.
  for (const forbidden of ["OFFERING_STRUCTURE_UPDATE", "OFFERING_METADATA_UPDATE"]) {
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
  // P3 TRANSITION. This guard previously forbade `searchParams` outright. P3 needs
  // it for closed post-redirect feedback, so the claim is narrowed rather than
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

  // The query is consumed exactly once, by a closed parser, and never reaches the
  // reader, the context or a href. (The P3 contract suite proves the parser is
  // closed and that no submitted value is echoed.)
  assert.ok(PAGE.includes("const feedback = feedbackFrom(await searchParams);"));
  assert.equal(PAGE.split("await searchParams").length - 1, 1);
  for (const forbidden of [
    "searchParams.courseOfferingId",
    "feedbackFrom(await params)",
    "readExamDefinitionsForAdmin(searchParams",
    "encodeURIComponent(searchParams",
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

test("10. the page imports EXACTLY the seven approved specifiers", () => {
  // P3 TRANSITION: the two route-local modules are added — the Server Action and
  // the client form. The page still reaches NO write binding directly.
  const specifiers = [...PAGE.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]).sort();
  assert.deepEqual(specifiers, [
    "./ExamPlanCreateForm",
    "./actions",
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
// 13–15. READ-ONLY: no action, no mutation, no affordance
// ===========================================================================

test("13. the ONLY mutation reachable from the page is the plan-create action", () => {
  // P3 TRANSITION. The page may now import its route-local Server Action module,
  // and nothing else that writes. Every OTHER mutation — definition create / edit
  // / delete / reorder, publication, source dates, sessions, delete-plan — stays
  // unreachable, and the page still never touches a write BINDING directly.
  assert.ok(PAGE.includes('from "./actions"'), "the page must import its own action module");
  assert.ok(PAGE.includes("createExamPlanAction.bind(null, context.id)"));

  for (const forbidden of [
    DEFINITION_WRITE_MODULE,
    PLAN_WRITE_MODULE,
    "createExamDefinition",
    "updateExamDefinition",
    "deleteExamDefinition",
    "reorderExamDefinitions",
    "deleteExamPlan",
    "publishExamPlan",
    "unpublishExamPlan",
    "sourceDate",
    "SourceDate",
    "examSession",
    "ExamSession",
    // The page itself performs no server mutation work: no revalidation, no
    // redirect, and no direct call of the write binding.
    "revalidatePath",
    "redirect(",
    PLAN_WRITE_CALL,
  ]) {
    assert.equal(PAGE.includes(forbidden), false, `the page must not reference ${forbidden}`);
  }
});

test("14. the page renders exactly ONE affordance, and holds no client state", () => {
  // P3 TRANSITION. The page delegates the form entirely to the client component,
  // so the page source itself still contains no form, button or input. The one
  // permitted addition is passing the bound action down as a prop.
  for (const forbidden of [
    "<form",
    "</form",
    "<button",
    "formAction",
    "onClick",
    "onSubmit",
    "onChange",
    "disabled",
    "<input",
    "useState",
    "useTransition",
    "useEffect",
    '"use client"',
  ]) {
    assert.equal(PAGE.includes(forbidden), false, `the page must not render ${forbidden}`);
  }
  // `action=` appears exactly once, and only as the bound server action prop.
  const actionProps = [...PAGE.matchAll(/action=/g)];
  assert.equal(actionProps.length, 1, "action= must appear exactly once");
  assert.ok(
    squash(PAGE).includes("<ExamPlanCreateForm action={createExamPlanAction.bind(null, context.id)} />"),
    "the only action= must be the bound create action on the create form",
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
// 16–17. What is rendered, and what must never be
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
// 19–21. The three states
// ===========================================================================

test("19. the no-plan state is an ordinary state that offers exactly one create", () => {
  assert.ok(PAGE.includes("view.planExists"), "the plan-absent branch must be driven by the view");
  assert.ok(
    PAGE.includes("עדיין לא נוצרה תוכנית מבחנים לקורס זה"),
    "the no-plan state must say so in Hebrew",
  );
  // P3 TRANSITION. This guard previously required the state to offer NOTHING to
  // click. It now requires exactly ONE affordance, still presented as an ordinary
  // state rather than a failure.
  const noPlanBranch = PAGE.indexOf("!view.planExists");
  const form = PAGE.indexOf("<ExamPlanCreateForm");
  const planPresent = PAGE.indexOf("מצב תוכנית המבחנים");
  assert.ok(noPlanBranch > -1 && form > -1 && planPresent > -1);
  assert.ok(noPlanBranch < form && form < planPresent, "the form must sit in the no-plan branch");
  assert.equal(
    PAGE.split("<ExamPlanCreateForm").length - 1,
    1,
    "exactly one create affordance may exist on the page",
  );
  // It is gated on the lifecycle, so an ARCHIVED offering keeps a readable,
  // affordance-free no-plan state.
  assert.ok(PAGE.includes("{canCreatePlan && ("), "the affordance must be lifecycle-gated");
  // The copy states plainly that only an EMPTY plan is created.
  assert.ok(PAGE.includes("ריקה"));
  // The no-plan state itself is still not styled or worded as a failure. (The
  // danger styling that now exists on the page belongs to the feedback banner,
  // which renders above this branch and only after a real refusal.)
  const noPlanText = PAGE.slice(noPlanBranch, planPresent);
  for (const forbidden of ["bg-danger-muted", "text-danger", "שגיאה."]) {
    assert.equal(noPlanText.includes(forbidden), false, `the no-plan state must not use ${forbidden}`);
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
    assert.equal(DASHBOARD.includes(forbidden), false, `the dashboard must not reference ${forbidden}`);
  }
});

// ===========================================================================
// 23. The slice's exact footprint
// ===========================================================================

test("23. this slice touched nothing outside its seven approved paths", () => {
  // Worktree modifications, staged changes and untracked files together — so the
  // guard describes the SLICE rather than one moment in its lifecycle, and keeps
  // holding after the work is staged or committed.
  const touched = new Set([
    ...gitLines(["diff", "--name-only", "HEAD"]),
    ...gitLines(["diff", "--name-only", "--cached", "HEAD"]),
    ...gitLines(["ls-files", "--others", "--exclude-standard"]),
  ]);
  const offenders = [...touched].filter((path) => !SLICE_PATHS.includes(path)).sort();
  assert.deepEqual(offenders, [], `an unapproved path was touched: ${offenders.join(", ")}`);
});

test("24. exactly three committed guard suites are amended, and they still exist", () => {
  // P3 TRANSITION. EX-S5B-5B amended one guard (the reader's). P3 amends three:
  // the ExamPlan pure core's suite and the write binding's suite, which both
  // asserted the binding had NO caller, and THIS suite, which asserted this page
  // had no creation affordance. The reader's guard is NOT amended by P3 — this
  // page's use of the reader is unchanged — so it is no longer a slice path.
  const AMENDED_GUARDS = [PLAN_CORE_GUARD, PLAN_WRITE_GUARD, TEST_REL.replace(/\\/g, "/")];
  for (const rel of AMENDED_GUARDS) {
    assert.ok(existsSync(join(REPO_ROOT, rel)), `${rel} is missing`);
    assert.ok(SLICE_PATHS.includes(rel), `${rel} is not an approved slice path`);
    assert.match(rel, /\.test\.ts$/, "only test suites may be amended as guards");
  }
  // The reader's own committed guard still exists and was NOT touched by P3.
  assert.ok(existsSync(join(REPO_ROOT, READER_GUARD_REL)), "the reader's guard suite is missing");
  assert.equal(
    SLICE_PATHS.includes(READER_GUARD_REL.replace(/\\/g, "/")),
    false,
    "P3 must not amend the reader's guard suite",
  );
  // No production file other than this page is an approved slice path in app/.
  const appProduction = SLICE_PATHS.filter(
    (path) => path.startsWith("app/") && !/\.test\.tsx?$/.test(path),
  ).sort();
  assert.deepEqual(appProduction, [
    "app/admin/courses/[courseOfferingId]/exams/ExamPlanCreateForm.tsx",
    "app/admin/courses/[courseOfferingId]/exams/actions.ts",
    "app/admin/courses/[courseOfferingId]/exams/page.tsx",
  ]);
});
