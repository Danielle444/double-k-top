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
 * Every path this slice is allowed to have touched — two new files and two
 * amended ones. The reader's committed guard suite is the second amended file:
 * it asserted the reader had NO caller at all, which this slice deliberately
 * supersedes by becoming its first and only one.
 */
const SLICE_PATHS = [
  "app/admin/courses/[courseOfferingId]/exams/page.tsx",
  "app/admin/courses/[courseOfferingId]/exams/exam-definitions-page.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/page.tsx",
  "lib/actions/exam-definition-read-io.test.ts",
];

/** Strip comments so every guard asserts on CODE, not on explanatory prose. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
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

test("3. the route directory holds exactly the page and this suite", () => {
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
    "app/admin/courses/[courseOfferingId]/exams/exam-definitions-page.contract.test.ts",
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

test("5. the READ gate is HISTORICAL_READ, and never the definition WRITE gate", () => {
  assert.ok(PAGE.includes('assertCourseOperationAllowed(context.status, "HISTORICAL_READ")'));
  for (const forbidden of [
    "SCHEDULE_DRAFT_CONFIGURATION",
    "OFFERING_STRUCTURE_UPDATE",
    "OFFERING_METADATA_UPDATE",
    "evaluateCourseOperationPolicy",
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

test("8. the route param is the ONLY scope input", () => {
  for (const forbidden of [
    "searchParams",
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
// 9–12. The module kind, and the exact import surface
// ===========================================================================

test("9. the page is a server component and declares force-dynamic", () => {
  assert.equal(PAGE.includes('"use client"'), false, "the page must not be a client component");
  assert.equal(PAGE.includes("'use client'"), false, "the page must not be a client component");
  assert.equal(PAGE.includes('"use server"'), false, "the page must not be a Server Action module");
  assert.ok(PAGE.includes('export const dynamic = "force-dynamic"'));
});

test("10. the page imports EXACTLY the five approved specifiers", () => {
  const specifiers = [...PAGE.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]).sort();
  assert.deepEqual(specifiers, [
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

test("13. no Server Action or mutation module is imported", () => {
  for (const forbidden of [
    DEFINITION_WRITE_MODULE,
    PLAN_WRITE_MODULE,
    "createExamDefinition",
    "updateExamDefinition",
    "deleteExamDefinition",
    "reorderExamDefinitions",
    "createExamPlan",
    "publishExamPlan",
    "revalidatePath",
    "redirect(",
    "./actions",
  ]) {
    assert.equal(PAGE.includes(forbidden), false, `the page must not reference ${forbidden}`);
  }
});

test("14. the page renders no form, button or other mutation affordance", () => {
  for (const forbidden of [
    "<form",
    "</form",
    "<button",
    "action=",
    "formAction",
    "onClick",
    "onSubmit",
    "onChange",
    "disabled",
    "<input",
    "useState",
    "useTransition",
  ]) {
    assert.equal(PAGE.includes(forbidden), false, `the page must not render ${forbidden}`);
  }
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

test("19. the no-plan state is an ordinary state, with no creation affordance", () => {
  assert.ok(PAGE.includes("view.planExists"), "the plan-absent branch must be driven by the view");
  assert.ok(
    PAGE.includes("עדיין לא נוצרה תוכנית מבחנים לקורס זה"),
    "the no-plan state must say so in Hebrew",
  );
  // It is not styled or worded as a failure, and offers nothing to click.
  for (const forbidden of ["bg-danger-muted", "text-danger", "שגיאה."]) {
    assert.equal(PAGE.includes(forbidden), false, `the no-plan state must not use ${forbidden}`);
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

test("23. this slice touched nothing outside its four approved paths", () => {
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

test("24. the reader's committed guard suite is the only amended guard", () => {
  assert.ok(existsSync(join(REPO_ROOT, READER_GUARD_REL)), "the reader's guard suite is missing");
  assert.ok(SLICE_PATHS.includes(READER_GUARD_REL.replace(/\\/g, "/")));
  assert.ok(SLICE_PATHS.includes(TEST_REL.replace(/\\/g, "/")));
});
