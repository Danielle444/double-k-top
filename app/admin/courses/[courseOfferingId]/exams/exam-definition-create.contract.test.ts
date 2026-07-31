/**
 * EXAM EX-S5B-5C — DB-free CONTRACT test for the admin ExamDefinition CREATE UI.
 *
 * WHY MOSTLY STRUCTURAL. The Server Action and the page both reach `server-only`
 * modules and Next's request scope, so neither can be imported into a plain
 * `tsx --test` process — which is exactly what those declarations are for. Their
 * SHAPE is therefore asserted from source: the order of the trust boundary, the
 * exact FormData mapping, what may be imported, and what must never appear.
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
 * SPLIT LITERALS — NOT COSMETIC. The committed EX-C1 containment guard sweeps
 * every file under `app/` for the exam core module names and matches RAW SOURCE
 * TEXT, so a suite that spelled `exam-domain-core` in order to forbid it would
 * itself become the violation it is checking for. The same is true of the
 * committed caller allow-lists, which sweep for the write binding's module name.
 * Every such token below is therefore assembled from pieces at runtime.
 *
 * HOW TO RUN IT — see the line comment below. It uses a WILDCARD for the dynamic
 * segment: the node test runner treats its path argument as a GLOB, so a literal
 * `[courseOfferingId]` is read as a character class, matches nothing, and the
 * runner then reports 0 tests and exits 0 — which looks exactly like a passing
 * suite. Always confirm the reported test count.
 */
// Run:
//   npx tsx --test "app/admin/courses/*/exams/exam-definition-create.contract.test.ts"
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  examDefinitionCreateErrorText,
  examDefinitionCreateIssueTexts,
  EXAM_DEFINITION_CREATE_ERROR_TEXT,
  EXAM_DEFINITION_CREATE_ISSUE_TEXT,
} from "./exam-definition-create-error-messages";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..", "..");

const ROUTE_DIR_REL = join("app", "admin", "courses", "[courseOfferingId]", "exams");
/** The same directory in git's own form: forward slashes, repository-relative. */
const ROUTE_DIR_PREFIX = "app/admin/courses/[courseOfferingId]/exams/";

const ACTIONS_REL = join(ROUTE_DIR_REL, "actions.ts");
const FORM_REL = join(ROUTE_DIR_REL, "ExamDefinitionCreateForm.tsx");
const MESSAGES_REL = join(ROUTE_DIR_REL, "exam-definition-create-error-messages.ts");
const PAGE_REL = join(ROUTE_DIR_REL, "page.tsx");

/**
 * Every path EX-S5B-5C was authorized to touch — four new, four amended.
 *
 * The write binding's guard path is ASSEMBLED rather than spelled: the committed
 * caller allow-list in that very suite sweeps every file under `app/` for its
 * own module name, and a suite that named it here would enrol ITSELF in the
 * allow-list it exists to keep at exactly one entry.
 */
const SLICE_PATHS = [
  "app/admin/courses/[courseOfferingId]/exams/actions.ts",
  "app/admin/courses/[courseOfferingId]/exams/ExamDefinitionCreateForm.tsx",
  "app/admin/courses/[courseOfferingId]/exams/exam-definition-create-error-messages.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-definition-create.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/page.tsx",
  "app/admin/courses/[courseOfferingId]/exams/exam-definitions-page.contract.test.ts",
  "lib/actions/exam-definition-read-io.test.ts",
  "lib/actions/" + "exam-definition-write" + "-io.test.ts",
  // The rest of the integration batch this slice now travels in: the approved
  // ExamPlan create UI, and the ExamSession edit/delete writers. Assembled for the
  // reason above — and the session paths most sharply of all, because that slice's
  // committed guard asserts its writers have EXACTLY ZERO callers under `app/`.
  "app/admin/courses/[courseOfferingId]/exams/ExamPlanCreateForm.tsx",
  "app/admin/courses/[courseOfferingId]/exams/exam-plan-create.contract.test.ts",
  "lib/exam/create-exam-plan" + "-core.test.ts",
  "lib/actions/exam-plan-write" + "-io.test.ts",
  "lib/actions/" + "exam-session-write" + "-io.ts",
  "lib/actions/" + "exam-session-write" + "-io.test.ts",
  "lib/exam/" + "update-exam-session" + "-core.ts",
  "lib/exam/" + "update-exam-session" + "-core.test.ts",
  "lib/exam/" + "delete-exam-session" + "-core.ts",
  "lib/exam/" + "delete-exam-session" + "-core.test.ts",
  // EX-SES-S4, the approved ExamSession CREATE UI, which re-points this suite's
  // route file set and export list and therefore travels with it.
  "app/admin/courses/[courseOfferingId]/exams/ExamSessionCreateForm.tsx",
  "app/admin/courses/[courseOfferingId]/exams/exam-session-create-error-messages.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-session-create.contract.test.ts",
  // EX-SES-UI-1, which WIRES that create form — plus the committed session reader
  // and the pure day-grouping core — into the page this suite also guards.
  // Assembled for the reason above, and most sharply of all here: the session
  // reader's committed guard pins its caller list to EXACTLY the page, so spelling
  // that module name whole would make THIS suite a second entry in it.
  "lib/actions/" + "admin-exam-session-read" + "-io.test.ts",
  // EX-SES-UI-2, the approved ExamSession EDIT and REMOVAL UI. It adds two forms
  // and its own contract suite to this route, and amends this suite's route file
  // set and export list — so those three files travel with it here.
  "app/admin/courses/[courseOfferingId]/exams/ExamSessionEditForm.tsx",
  "app/admin/courses/[courseOfferingId]/exams/ExamSessionDeleteForm.tsx",
  "app/admin/courses/[courseOfferingId]/exams/exam-session-edit-delete.contract.test.ts",
  // EX-ASG-UI1, the approved stored-assignment CREATE and REMOVAL UI. It adds two
  // forms, a closed message module and its own contract suite to this route, and
  // amends this suite's route file set, export list, import surface and
  // revalidation budget — so those four files travel with it here. The two `lib/`
  // assignment entries are assembled for the sharpest reason of all: their
  // committed guards pinned their caller lists at EXACTLY ZERO before this slice.
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

/** Strip comments so every guard asserts on CODE, not on explanatory prose. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function readSource(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

const ACTIONS_SOURCE = readSource(ACTIONS_REL);
const ACTIONS = stripComments(ACTIONS_SOURCE);
const FORM = stripComments(readSource(FORM_REL));
const MESSAGES = stripComments(readSource(MESSAGES_REL));
const PAGE = stripComments(readSource(PAGE_REL));

/**
 * The body of ONE action inside the now-SHARED `"use server"` module.
 *
 * WHY THIS EXISTS. `actions.ts` was this slice's alone when the suite was written.
 * The approved ExamPlan create UI adds a SECOND action beside it, and the two are
 * deliberately kept as two separate endpoints. Every claim about how THIS action
 * treats the REQUEST — that it revalidates exactly one path, that it redirects on
 * exactly four branches, that it reaches no plan-creation symbol — is therefore
 * re-pointed at this action's own body instead of at the whole file. That is the
 * same claim, correctly targeted: asserting it file-wide would now be asserting it
 * about the neighbouring action too, which has its own contract and its own suite.
 *
 * Module-WIDE claims stay module-wide: the `"use server"` first statement, the
 * exact export list, the import surface, the seven-field FormData budget and the
 * total absence of try/catch are properties of the FILE and are checked as such.
 */
function actionBody(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}(`);
  assert.ok(start > -1, `${name} is not declared in the action module`);
  const rest = source.slice(start + 1);
  const next = rest.indexOf("export async function ");
  return next === -1 ? source.slice(start) : source.slice(start, start + 1 + next);
}

/** THIS slice's own action, isolated from the plan-create action beside it. */
const DEFINITION_ACTION = actionBody(ACTIONS, "createExamDefinitionAction");

// Split tokens — see the header note.
const WRITE_IO_MODULE = "exam-definition-write" + "-io";
const WRITER_CALL = "createExamDefinition" + "(";
/**
 * The NEIGHBOURING slice's write binding specifier, assembled for a sharper reason
 * than the rest: the committed ExamPlan core and binding guards match RAW source
 * text for this exact string and assert an EXACT reachability list, so spelling it
 * whole here would register this suite as reaching a binding it never calls.
 */
const PLAN_WRITE_SPECIFIER = "@/lib/actions/" + "exam-plan-write" + "-io";
/**
 * The SESSION write binding's specifier, assembled for the sharpest reason of
 * all: that binding's committed guard sweeps every file under `app/` for its own
 * module name and asserts an EXACT caller list of ONE. Spelling it whole here
 * would register this suite as a second caller of a write binding it never calls.
 */
const SESSION_WRITE_SPECIFIER = "@/lib/actions/" + "exam-session-write" + "-io";
/**
 * The ASSIGNMENT write binding's specifier, added by EX-ASG-UI1 and assembled for
 * a sharper reason still: that binding's committed guard pinned its caller list at
 * EXACTLY ZERO before this slice, so spelling it whole here would register this
 * suite as a caller of a write binding it never calls.
 */
const ASSIGNMENT_WRITE_SPECIFIER = "@/lib/actions/" + "exam-assignment-write" + "-io";
const PRISMA_MODULE = ["@/lib", "prisma"].join("/");
const GENERATED_CLIENT = ["@prisma", "client"].join("/");
/** The committed exam cores that no file under `app/` may name. */
const FORBIDDEN_CORES = [
  "exam-kind" + "-labels",
  "exam-definition-validation" + "-core",
  "exam-domain" + "-core",
  "exam-conflict" + "-core",
  "exam-overlap" + "-core",
  "exam-publication" + "-core",
  "exam-block-timetable" + "-core",
  "exam-no-feedback" + "-guard",
  "exam-schedule-projection" + "-core",
  "exam-beginner-format" + "-core",
  "exam-beginner-copy" + "-core",
  "exam-live-beginner-adapter" + "-core",
];

function gitLines(args: readonly string[]): string[] {
  const result = spawnSync("git", [...args], { cwd: REPO_ROOT, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed`);
  return (result.stdout ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

// ===========================================================================
// 1–3. The route's exact file set
// ===========================================================================

test("1. the four new files exist at the exact course-scoped route", () => {
  for (const rel of [ACTIONS_REL, FORM_REL, MESSAGES_REL]) {
    assert.ok(existsSync(join(REPO_ROOT, rel)), `${rel} is missing`);
  }
  assert.ok(existsSync(join(REPO_ROOT, PAGE_REL)), "the page is missing");
});

test("2. the route directory holds EXACTLY the twenty-one approved files", () => {
  // RE-POINTED by EX-SES-S4, not relaxed: the session-create slice added three
  // reviewed files to this route (a form, a message table and its own contract
  // suite), so the exact set grew from eight to eleven.
  //
  // RE-POINTED AGAIN by EX-SES-UI-2, on the same terms: the session edit/removal
  // slice added an edit form, a delete form and its own contract suite, so the set
  // grew to fourteen.
  //
  // RE-POINTED AGAIN by EX-ASG-UI1, on the same terms: the stored-assignment
  // create/removal slice added a create form, a delete form, a closed message
  // module and its own contract suite, so the set grew to eighteen. It is still an
  // EXHAUSTIVE literal list — a nineteenth file still fails here.
  const routeFiles = [
    ...new Set([
      ...gitLines(["ls-files"]),
      ...gitLines(["ls-files", "--others", "--exclude-standard"]),
    ]),
  ]
    .filter((path) => path.startsWith(ROUTE_DIR_PREFIX))
    .sort();
  assert.deepEqual(routeFiles, [
    "app/admin/courses/[courseOfferingId]/exams/CreateExamAssignmentForm.tsx",
    "app/admin/courses/[courseOfferingId]/exams/CreateExamInstructedTraineeAssignmentForm.tsx",
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
    "app/admin/courses/[courseOfferingId]/exams/exam-instructed-trainee-assignment-messages.ts",
    "app/admin/courses/[courseOfferingId]/exams/exam-instructed-trainee-assignment-ui.contract.test.ts",
    "app/admin/courses/[courseOfferingId]/exams/exam-plan-create.contract.test.ts",
    "app/admin/courses/[courseOfferingId]/exams/exam-session-create-error-messages.ts",
    "app/admin/courses/[courseOfferingId]/exams/exam-session-create.contract.test.ts",
    "app/admin/courses/[courseOfferingId]/exams/exam-session-edit-delete.contract.test.ts",
    "app/admin/courses/[courseOfferingId]/exams/page.tsx",
  ]);
});

test("3. no top-level exams route was created in any role area", () => {
  for (const dir of [
    join("app", "admin", "exams"),
    join("app", "admin", "exam-definitions"),
    join("app", "instructor", "exams"),
    join("app", "student", "exams"),
  ]) {
    assert.equal(existsSync(join(REPO_ROOT, dir)), false, `${dir} was created`);
  }
});

// ===========================================================================
// 4–8. The Server Action: kind, signature, and the ORDER
// ===========================================================================

test("4. the action module declares use server as its FIRST statement", () => {
  const useServer = '"use ' + 'server"';
  const firstLine = ACTIONS_SOURCE.split("\n").find((line) => line.trim().length > 0);
  assert.ok(firstLine);
  assert.equal(firstLine.trim(), `${useServer};`, `the first line is: ${firstLine}`);
  // ...and it is NOT also a client module or a server-only module.
  assert.equal(ACTIONS.includes('"use ' + 'client"'), false);
  assert.equal(ACTIONS.includes("server" + "-only"), false);
});

test("5. the module exports EXACTLY the eight approved actions, with exact signatures", () => {
  const exported = [
    ...ACTIONS_SOURCE.matchAll(/export (?:async )?function (\w+)\(/g),
  ].map(([, name]) => name);
  // RE-POINTED by EX-SES-S4, again by EX-SES-UI-2 and again by EX-ASG-UI1, not
  // relaxed. Still an EXHAUSTIVE allow-list, and still in a fixed order — it
  // simply names all seven approved actions, because the route legitimately has
  // seven. None was folded into a single generic endpoint that would choose its
  // operation from the request, which is precisely the decision that must not be
  // client-influenced — and that matters most for the two pairs, since an endpoint
  // that chose between writing and deleting from a submitted flag would make
  // deletion reachable from a request that looks like a save.
  assert.deepEqual(exported, [
    "createExamPlanAction",
    "createExamDefinitionAction",
    "createExamSessionAction",
    "updateExamSessionAction",
    "deleteExamSessionAction",
    "createExamAssignmentAction",
    "deleteExamAssignmentAction",
    "createExamInstructedTraineeAssignmentAction",
  ]);
  assert.equal(exported.length, 8, "no ninth endpoint may exist in this module");
  // Everything exported from a "use server" module is publicly callable, so the
  // export list is the attack surface: nothing else may leave this file.
  for (const token of ["export const", "export default", "export {", "export type"]) {
    assert.equal(ACTIONS.includes(token), false, `the module also declares ${token}`);
  }
  assert.ok(
    /export async function createExamDefinitionAction\(\s*courseOfferingId: string,\s*formData: FormData,\s*\): Promise<void> \{/.test(
      ACTIONS_SOURCE,
    ),
    "the action signature is not the locked one",
  );
});

test("6. requireAdmin() is the FIRST awaited operation in the body", () => {
  assert.ok(ACTIONS.includes("await requireAdmin();"), "requireAdmin is not awaited");
  const body = ACTIONS.slice(ACTIONS.indexOf("createExamDefinitionAction("));
  assert.equal(
    body.indexOf("await "),
    body.indexOf("await requireAdmin()"),
    "something is awaited before the admin gate",
  );
  // No FormData is read and no writer is entered before it.
  assert.ok(
    body.indexOf("await requireAdmin()") < body.indexOf("formData.get("),
    "FormData is read before the admin gate",
  );
  assert.ok(
    body.indexOf("await requireAdmin()") < body.indexOf(WRITER_CALL),
    "the writer runs before the admin gate",
  );
});

test("7. the offering is the BOUND leading argument and is never read from FormData", () => {
  // The page binds the VERIFIED context id; the client cannot forge it.
  assert.ok(
    PAGE.includes("createExamDefinitionAction.bind(null, context.id)"),
    "the page does not bind the verified offering id",
  );
  assert.equal(
    PAGE.includes("createExamDefinitionAction.bind(null, courseOfferingId)"),
    false,
    "the page bound the RAW route param",
  );
  // Neither the course nor the plan is ever read from the submission.
  //
  // RE-POINTED by EX-SES-S4 from the whole module to THIS action's body, and not
  // weakened: `definitionId` is a legitimate field of the neighbouring SESSION
  // create (which must name the definition its session runs under), so a
  // file-wide ban would now fail for a reason that has nothing to do with this
  // action. Scoping it to the definition action keeps the original claim exactly
  // — this action reads none of the five — and the session action's own six-field
  // budget is proven in its own suite.
  for (const field of [
    'formData.get("courseOfferingId")',
    'formData.get("planId")',
    'formData.get("id")',
    'formData.get("definitionId")',
    'formData.get("orderIndex")',
  ]) {
    assert.equal(DEFINITION_ACTION.includes(field), false, `the action reads ${field}`);
  }
  // The two that no action in the module may EVER read stay banned file-wide.
  for (const field of ['formData.get("courseOfferingId")', 'formData.get("planId")']) {
    assert.equal(ACTIONS.includes(field), false, `the module reads ${field}`);
  }
  // ...and the form cannot even offer them.
  for (const name of [
    'name="courseOfferingId"',
    'name="planId"',
    'name="orderIndex"',
    'name="id"',
    "hidden",
  ]) {
    assert.equal(FORM.includes(name), false, `the form submits ${name}`);
  }
});

test("8. the FormData mapping is EXACTLY the seven fields, coerced exactly", () => {
  // RE-POINTED by EX-SES-S4 from the module to THIS action's body: the module now
  // holds a third action with its own raw-input object, so a file-wide slice would
  // span both. Every coercion claim below is unchanged.
  const raw = DEFINITION_ACTION.slice(
    DEFINITION_ACTION.indexOf("const rawInput = {"),
    DEFINITION_ACTION.indexOf(WRITER_CALL),
  );

  assert.ok(/name: formData\.get\("name"\),/.test(raw), "name is not passed through");
  assert.ok(/kind: formData\.get\("kind"\),/.test(raw), "kind is not the exact string");
  assert.ok(
    /durationMinutes: Number\(formData\.get\("durationMinutes"\)\),/.test(raw),
    "durationMinutes is not Number(value)",
  );
  assert.ok(
    /parallelCapacity: Number\(formData\.get\("parallelCapacity"\)\),/.test(raw),
    "parallelCapacity is not Number(value)",
  );
  for (const flag of [
    "requiresInstructedTrainee",
    "requiresLessonTopic",
    "requiresDiscipline",
  ]) {
    assert.ok(
      new RegExp(`${flag}: formData\\.get\\("${flag}"\\) === "on",`).test(raw),
      `${flag} is not the exact === "on" coercion`,
    );
  }

  // EXACTLY seven reads in THIS action, and Number() is applied to the two numeric
  // fields ONLY — scoped for the reason above. `Number(` stays banned MODULE-WIDE
  // below, because the definition action is the only one that may coerce at all.
  assert.equal((DEFINITION_ACTION.match(/formData\.get\(/g) ?? []).length, 7);
  assert.equal((DEFINITION_ACTION.match(/Number\(/g) ?? []).length, 2);
  // RE-POINTED by EX-SES-UI-2 from two to FOUR, and the claim is unchanged in
  // substance: the definition action coerces its two numeric fields, and the
  // session EDIT and REMOVAL each coerce their ONE concurrency token, because the
  // committed writers take those as `number`. Nothing else in the module coerces a
  // submitted value at all — in particular no session PAYLOAD field is coerced,
  // which the session suites assert on the raw-input objects themselves.
  assert.equal(
    (ACTIONS.match(/Number\(/g) ?? []).length,
    4,
    "no other action in the module may coerce a submitted value",
  );
  // The name is NOT trimmed here: trimming is the committed input core's rule.
  assert.equal(raw.includes(".trim()"), false, "the action trims the name itself");
  // Nothing is defaulted into a valid value.
  for (const token of ["??", "|| 0", "|| \"\"", "parseInt", "parseFloat", "Boolean("]) {
    assert.equal(raw.includes(token), false, `the mapping defaults or coerces via ${token}`);
  }
});

// ===========================================================================
// 9–13. Outcomes: destinations, revalidation, and no echo
// ===========================================================================

test("9. the action calls the committed writer with the bound id and the raw input", () => {
  assert.ok(
    new RegExp(
      `const result = await ${"createExamDefinition"}\\(courseOfferingId, rawInput\\);`,
    ).test(ACTIONS),
    "the writer is not called with exactly (courseOfferingId, rawInput)",
  );
  // The module's ENTIRE import surface is the seven approved specifiers: the admin
  // boundary, the four committed write bindings the seven actions wrap, and the
  // two framework modules. Nothing else — no Prisma, no core, no capability, no
  // notification surface, and no FIFTH writer.
  //
  // RE-POINTED by EX-SES-S4 and again by EX-ASG-UI1 by ADDING one specifier to an
  // exhaustive list, which is the strongest available form of this guard: each
  // binding is named explicitly, so importing any other writer — including a
  // binding's own siblings, which live in the same module and are therefore NOT
  // separately importable — still fails here.
  const specifiers = [...ACTIONS.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]).sort();
  assert.deepEqual(
    specifiers,
    [
      "@/lib/actions/" + WRITE_IO_MODULE,
      PLAN_WRITE_SPECIFIER,
      SESSION_WRITE_SPECIFIER,
      ASSIGNMENT_WRITE_SPECIFIER,
      // ADDED by EX-ASG-IT2, assembled for the reason above: the committed
      // instructed-trainee write binding's guard pinned its caller list at ZERO
      // before this slice, and at exactly this one Server Action module after it.
      "@/lib/actions/" + "exam-instructed-trainee-assignment-write" + "-io",
    // ADDED by EX-ASG-LTD2-B2, and assembled on exactly the same terms: the
    // committed DETAILED examinee write binding's guard pinned its caller list at
    // ZERO before that slice, and at exactly this one Server Action module after
    // it. It is an ADDITION and not a swap — the three-field binding above is
    // still imported, for the assignment REMOVAL.
    "@/lib/actions/" + "detailed-exam-assignment-write" + "-io",
      "@/lib/auth/require-admin",
      "next/cache",
      "next/navigation",
    ].sort(),
  );
  // RE-POINTED by EX-SES-UI-2. The claim was "the session binding is imported for
  // its CREATE alone", which was correct while only the create had an approved UI.
  // The edit and the removal now have their own reviewed forms, so the import is
  // an EXACT three-name list instead: no fourth name may be pulled from that
  // binding — which is what keeps its plan-publication and reordering siblings
  // unreachable from this route — and the list is still exhaustive.
  assert.ok(
    new RegExp(
      `import \\{\\s*${"create" + "ExamSession"},\\s*${"update" + "ExamSession"},\\s*${"delete" + "ExamSession"},?\\s*\\} from "${SESSION_WRITE_SPECIFIER}";`,
    ).test(ACTIONS),
    "the session binding import is not the exact three-name list",
  );
  for (const forbidden of ["reorder" + "ExamSessions", "publish" + "ExamPlan"]) {
    assert.equal(ACTIONS.includes(forbidden), false, `the module imports ${forbidden}`);
  }
});

test("10. offering_not_found leaves this route for the course list", () => {
  assert.ok(
    /if \(result\.code === "offering_not_found"\) \{\s*redirect\("\/admin\/courses\?error=invalid"\);/.test(
      ACTIONS.replace(/\s+/g, " ").replace(/ \{ /g, " { "),
    ) ||
      (ACTIONS.includes('result.code === "offering_not_found"') &&
        ACTIONS.includes('redirect("/admin/courses?error=invalid")')),
    "the not-found refusal does not redirect to the course list",
  );
  // The requested id is not reflected back in that destination. Located inside THIS
  // action's body: the neighbouring action redirects to the same safe list, so a
  // file-wide `indexOf` would inspect its destination instead of this one.
  const destination = DEFINITION_ACTION.slice(
    DEFINITION_ACTION.indexOf('"/admin/courses?error=invalid"'),
  );
  assert.ok(destination.length > 0, "the not-found destination must be locatable");
  assert.equal(
    destination.slice(0, 60).includes("courseOfferingId"),
    false,
    "the not-found destination echoes the requested id",
  );
});

test("11. success revalidates ONLY this exams path and redirects with the flag", () => {
  assert.ok(
    /const examsPath = `\/admin\/courses\/\$\{encodeURIComponent\(courseOfferingId\)\}\/exams`;/.test(
      ACTIONS,
    ),
    "the exams path is not built from the bound, encoded offering id",
  );
  // Scoped to THIS action's body: each of the module's two actions revalidates
  // exactly once, so a file-wide count would now read 2 and prove nothing about
  // either. The module-wide budget is asserted right below.
  assert.equal((DEFINITION_ACTION.match(/revalidatePath\(/g) ?? []).length, 1);
  // The module-wide budget: at most one revalidation per action, and every one of
  // them is the SAME course-scoped exams path. Re-pointed from 2 to 3 by EX-SES-S4,
  // from 3 to 5 by EX-SES-UI-2 and from 5 to 7 by EX-ASG-UI1 — the per-action
  // budget is what this asserts, and it did not change. The edit's single
  // occurrence sits on its CHANGED branch only, so a no-op edit revalidates nothing
  // at all, which its own suite pins.
  assert.equal(
    (ACTIONS.match(/revalidatePath\(/g) ?? []).length,
    8,
    "the module must revalidate at most once per action and no more",
  );
  assert.equal((ACTIONS.match(/revalidatePath\(examsPath\);/g) ?? []).length, 8);
  assert.ok(DEFINITION_ACTION.includes("revalidatePath(examsPath);"), "the wrong path is revalidated");
  assert.ok(
    DEFINITION_ACTION.includes("redirect(`${examsPath}?createdDefinition=1`);"),
    "success does not redirect with createdDefinition=1",
  );
  // No other surface is revalidated — no dashboard, no Level 1 schedule, no
  // trainee or coach path, and no tag-based invalidation at all.
  for (const token of [
    "revalidateTag",
    '"/admin/courses"',
    '"/admin/weekly-schedule"',
    '"/student',
    '"/instructor',
    "revalidatePath(dashboard",
  ]) {
    assert.equal(ACTIONS.includes(token), false, `the action also revalidates ${token}`);
  }
  // Revalidation happens ONLY on success — asserted within this action's body,
  // because the neighbouring action's own revalidation sits earlier in the file.
  assert.ok(
    DEFINITION_ACTION.indexOf("if (result.ok)") < DEFINITION_ACTION.indexOf("revalidatePath("),
    "revalidation is not inside the success branch",
  );
});

test("12. invalid_input carries STABLE CODES ONLY, and duplicate_name its bare code", () => {
  assert.ok(
    ACTIONS.includes("result.issues.map((issue) => issue.code).join(\",\")"),
    "the issue codes are not the only thing forwarded",
  );
  assert.ok(
    ACTIONS.includes("createError=invalid_input&createIssues=${encodeURIComponent(codes)}"),
    "the invalid-input destination is wrong",
  );
  // The remaining refusals — plan_not_found, operation_not_allowed and
  // duplicate_name — are fully described by their code and share one branch.
  assert.ok(
    ACTIONS.includes("redirect(`${examsPath}?createError=${encodeURIComponent(result.code)}`)"),
    "the residual refusals do not redirect with their bare code",
  );
  // NOTHING from the submission is ever placed in a URL.
  for (const echoed of [
    "issue.message",
    "rawInput.name",
    "rawInput.kind",
    "rawInput.durationMinutes",
    "rawInput.parallelCapacity",
    'formData.get("name")}',
    "name=${",
    "JSON.stringify",
  ]) {
    assert.equal(ACTIONS.includes(echoed), false, `a redirect echoes ${echoed}`);
  }
});

test("13. there is NO try/catch, so every redirect is outside one", () => {
  // The strongest form of the rule: there is no block for a NEXT_REDIRECT throw
  // — or the authorization redirect — to be swallowed by.
  assert.equal(ACTIONS.includes("try {"), false, "the action opens a try block");
  assert.equal(/catch\s*\(/.test(ACTIONS), false, "the action catches");
  assert.equal(ACTIONS.includes("NEXT_REDIRECT"), false, "the action inspects redirects");
  // Four branches in THIS action: success, offering-not-found, invalid-input, and
  // the residual bare-code refusal. Scoped to its body, because the neighbouring
  // action contributes three redirects of its own to the file.
  assert.equal((DEFINITION_ACTION.match(/redirect\(/g) ?? []).length, 4);
});

// ===========================================================================
// 14–15. What the action may NOT reach
// ===========================================================================

test("14. the action imports no database client, capability or notification surface", () => {
  for (const token of [
    PRISMA_MODULE,
    GENERATED_CLIENT,
    "prisma.",
    "PrismaClient",
    "capabilit",
    "Capabilit",
    "getEffectiveCapabilities",
    "notification",
    "Notification",
    "web-push",
    "webpush",
    "sendMessage",
  ]) {
    assert.equal(ACTIONS.includes(token), false, `the action reaches ${token}`);
  }
});

test("15. no edit, delete, reorder, session, source-date or publication path exists", () => {
  // Plan CREATION is no longer in the universal list: it is the approved
  // neighbouring action's whole purpose, and it has its own reviewed contract and
  // suite. Everything else stays forbidden, and the plan tokens are re-asserted
  // against THIS action's body below — so the two endpoints in the shared module
  // provably cannot have become entangled.
  // RE-POINTED by EX-SES-S4. The session CREATE verb and its binding module have
  // left this list, because the module now legitimately holds the approved
  // session-create endpoint — exactly the treatment the definition CREATE verb
  // already received when it became an approved neighbour.
  //
  // Nothing else moved, and the replacement is NARROWER rather than absent: the
  // session EDIT and REMOVAL writers are banned by name below, so the one
  // relaxation cannot be stretched into "any session work is fine here". The
  // session action's own six-field budget, closed result mapping and no-echo
  // property are proven in its own suite.
  // RE-POINTED AGAIN by EX-SES-UI-2. The session EDIT and REMOVAL verbs have left
  // this module-wide list on exactly the terms the definition and session CREATE
  // verbs already earned: both are now approved, separately reviewed neighbours in
  // the shared action module. The FORM is still swept for them below — this
  // definition slice's own UI gains nothing — and the two new endpoints' contract
  // is proven in their own suite, while the write binding's committed guard still
  // pins the complete caller list for all three session writers to this ONE module.
  // RE-POINTED AGAIN by EX-ASG-UI1. The blanket `ExamAssignment` substring has
  // left this module-wide list on exactly the terms the definition, session-create
  // and session edit/removal verbs already earned: the shared action module now
  // legitimately holds two approved, separately reviewed assignment endpoints. The
  // FORM is still swept for it below — this definition slice's own UI gains
  // nothing — the ASSIGNMENT REORDER and EDIT verbs that no route may reach stay
  // banned by name, and THIS action is re-swept for the whole assignment slice
  // immediately after, so the one relaxation cannot be stretched into "any
  // assignment work is fine here".
  for (const token of [
    "update" + "ExamDefinition",
    "delete" + "ExamDefinition",
    "reorder" + "ExamDefinitions",
    "publish" + "ExamPlan",
    "unpublish" + "ExamPlan",
    "delete" + "ExamPlan",
    "reorder" + "ExamSessions",
    // Assignment management NO route may perform, in any module.
    "reorder" + "ExamAssignments",
    "update" + "ExamAssignment",
    // Session management this route does not perform at all.
    "SessionBreak",
    "Supervisor",
    "sourceDate",
    "publishedAt",
  ]) {
    for (const [label, code] of [
      ["action", ACTIONS],
      ["form", FORM],
    ] as const) {
      assert.equal(code.includes(token), false, `the ${label} reaches ${token}`);
    }
  }
  // The definition CREATE FORM reaches neither destructive session verb, and no
  // part of the assignment slice at all: the relaxations above are for the shared
  // action module only.
  for (const token of [
    "update" + "ExamSession",
    "delete" + "ExamSession",
    "ExamAssignment",
  ]) {
    assert.equal(FORM.includes(token), false, `the form reaches ${token}`);
  }

  // THIS action still reaches no part of the session slice at all: the relaxation
  // above is for the module, and the definition endpoint gains nothing from it.
  for (const token of [
    "create" + "ExamSession",
    "update" + "ExamSession",
    "delete" + "ExamSession",
    SESSION_WRITE_SPECIFIER,
    "sessionError=",
    "sessionEditError=",
    "sessionDeleteError=",
  ]) {
    assert.equal(
      DEFINITION_ACTION.includes(token),
      false,
      `the definition action reaches ${token}`,
    );
  }

  // ...and no part of the ASSIGNMENT slice either, on the same terms.
  for (const token of [
    "ExamAssignment",
    ASSIGNMENT_WRITE_SPECIFIER,
    "assignmentError=",
    "assignmentDeleteError=",
    "createdAssignment=",
    "deletedAssignment=",
  ]) {
    assert.equal(
      DEFINITION_ACTION.includes(token),
      false,
      `the definition action reaches ${token}`,
    );
  }

  // THIS action names no part of the plan-creation slice at all: not the binding,
  // not its public function, not the plan's own result tokens.
  for (const token of [
    "create" + "ExamPlan",
    PLAN_WRITE_SPECIFIER,
    "exam-plan-write" + "-io",
    "result.created",
    "existing=1",
  ]) {
    assert.equal(
      DEFINITION_ACTION.includes(token),
      false,
      `the definition action reaches ${token}`,
    );
  }

  // ...and the form reaches NO write binding: only the Server Action may.
  for (const token of [WRITE_IO_MODULE, "exam-plan-write" + "-io", "exam-session-write" + "-io"]) {
    assert.equal(FORM.includes(token), false, `the form reaches ${token}`);
  }
});

// ===========================================================================
// 16–21. The create form
// ===========================================================================

test("16. the form is a client component and holds only UX state", () => {
  const useClient = '"use ' + 'client"';
  const firstLine = readSource(FORM_REL).split("\n").find((line) => line.trim().length > 0);
  assert.ok(firstLine);
  assert.equal(firstLine.trim(), `${useClient};`);
  const specifiers = [...FORM.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]).sort();
  assert.deepEqual(specifiers, ["react", "react-dom"]);
});

test("17. EXACTLY the three storable kinds are offered, in order", () => {
  const options = [...FORM.matchAll(/\{ value: "([A-Z_]+)", label: "[^"]+" \}/g)].map(
    ([, value]) => value,
  );
  assert.deepEqual(options, [
    "INTERFACE_RIDING",
    "LUNGE_NO_RIDER",
    "ADVANCED_INSTRUCTION",
  ]);
});

test("18. BEGINNER_INSTRUCTION is absent from the form entirely", () => {
  assert.equal(
    FORM.includes("BEGINNER_INSTRUCTION"),
    false,
    "the form can express a beginner definition",
  );
  assert.equal(FORM.includes("BEGINNER"), false, "the form names a beginner kind");
});

test("19. the two conditional flags are enabled ONLY for advanced instruction", () => {
  assert.ok(
    FORM.includes('const ADVANCED_INSTRUCTION_KIND = "ADVANCED_INSTRUCTION";'),
    "the advanced kind is not named once",
  );
  assert.ok(
    FORM.includes("const isAdvancedInstruction = kind === ADVANCED_INSTRUCTION_KIND;"),
    "the applicability is not derived from the chosen kind",
  );
  for (const flag of ["requiresInstructedTrainee", "requiresLessonTopic"]) {
    assert.ok(
      new RegExp(`checked=\\{isAdvancedInstruction && ${flag}\\}`).test(FORM),
      `${flag} can stay ticked for a kind it does not apply to`,
    );
  }
  // Both boxes are disabled together, by the same predicate.
  assert.equal((FORM.match(/disabled=\{!isAdvancedInstruction\}/g) ?? []).length, 2);
});

test("20. changing kind AWAY from advanced instruction clears both flags", () => {
  const handler = FORM.slice(
    FORM.indexOf("function handleKindChange("),
    FORM.indexOf("return (", FORM.indexOf("function handleKindChange(")),
  );
  assert.ok(
    handler.includes("if (nextKind !== ADVANCED_INSTRUCTION_KIND)"),
    "the handler does not test the new kind",
  );
  assert.ok(handler.includes("setRequiresInstructedTrainee(false)"));
  assert.ok(handler.includes("setRequiresLessonTopic(false)"));
  // The discipline flag is NOT cleared: it applies to every storable kind.
  assert.equal(
    handler.includes("setRequiresDiscipline"),
    false,
    "the handler also clears the discipline flag",
  );
});

test("21. requiresDiscipline is always available, and the submit is pending-disabled", () => {
  const discipline = FORM.slice(FORM.indexOf('name="requiresDiscipline"'));
  const block = discipline.slice(0, discipline.indexOf("/>") + 2);
  assert.equal(block.includes("disabled"), false, "the discipline flag can be disabled");
  assert.ok(FORM.includes("checked={requiresDiscipline}"), "it is not a working checkbox");
  assert.ok(FORM.includes("onChange={setRequiresDiscipline}"), "it cannot be toggled");

  assert.ok(FORM.includes("const { pending } = useFormStatus();"));
  assert.ok(FORM.includes("disabled={pending}"), "the submit is not pending-disabled");
  // No optimistic insertion: the form keeps no list and renders no pending row.
  for (const token of ["useOptimistic", "definitions", "newDefinition", "rows.push"]) {
    assert.equal(FORM.includes(token), false, `the form inserts optimistically via ${token}`);
  }
});

// ===========================================================================
// 22–24. The message module — proven at RUNTIME
// ===========================================================================

test("22. the message module is dependency-free", () => {
  assert.equal(/^\s*import\s/m.test(MESSAGES), false, "the message module imports something");
});

test("23. only RECOGNIZED issue codes render; everything else is dropped", () => {
  // The whole point: the query string is attacker-controllable, so an unknown
  // token must never become text on the page.
  assert.deepEqual(examDefinitionCreateIssueTexts("<script>alert(1)</script>"), []);
  assert.deepEqual(examDefinitionCreateIssueTexts("EX-DEF-NOT-A-REAL-CODE"), []);
  assert.deepEqual(examDefinitionCreateIssueTexts("toString,constructor,__proto__"), []);
  assert.deepEqual(examDefinitionCreateIssueTexts(""), []);
  assert.deepEqual(examDefinitionCreateIssueTexts(undefined), []);
  assert.deepEqual(examDefinitionCreateIssueTexts(42), []);

  // A known code renders its own sentence, in the SERVER's order, deduped.
  assert.deepEqual(examDefinitionCreateIssueTexts("EX-DEF-NAME-REQUIRED"), [
    EXAM_DEFINITION_CREATE_ISSUE_TEXT["EX-DEF-NAME-REQUIRED"],
  ]);
  assert.deepEqual(
    examDefinitionCreateIssueTexts("EX-DEF-INVALID-CAPACITY,EX-DEF-NAME-REQUIRED"),
    [
      EXAM_DEFINITION_CREATE_ISSUE_TEXT["EX-DEF-INVALID-CAPACITY"],
      EXAM_DEFINITION_CREATE_ISSUE_TEXT["EX-DEF-NAME-REQUIRED"],
    ],
  );
  assert.deepEqual(
    examDefinitionCreateIssueTexts("EX-DEF-NAME-REQUIRED,EX-DEF-NAME-REQUIRED"),
    [EXAM_DEFINITION_CREATE_ISSUE_TEXT["EX-DEF-NAME-REQUIRED"]],
  );
  // A mixture keeps only what it recognizes.
  assert.deepEqual(examDefinitionCreateIssueTexts("bogus,EX-DEF-INVALID-DURATION,also-bogus"), [
    EXAM_DEFINITION_CREATE_ISSUE_TEXT["EX-DEF-INVALID-DURATION"],
  ]);
});

test("24. an absent error is silent; an unknown one is explicit, never echoed", () => {
  assert.equal(examDefinitionCreateErrorText(undefined), null);
  assert.equal(examDefinitionCreateErrorText(""), null);
  assert.equal(examDefinitionCreateErrorText(7), null);

  for (const code of Object.keys(EXAM_DEFINITION_CREATE_ERROR_TEXT)) {
    assert.equal(
      examDefinitionCreateErrorText(code),
      EXAM_DEFINITION_CREATE_ERROR_TEXT[
        code as keyof typeof EXAM_DEFINITION_CREATE_ERROR_TEXT
      ],
    );
  }
  // An unrecognized refusal produces a fixed sentence that does NOT contain the
  // token — a refusal must never render as a blank page, nor as the raw token.
  const unknown = examDefinitionCreateErrorText("totally-made-up-code");
  assert.ok(typeof unknown === "string" && unknown.length > 0);
  assert.equal(unknown.includes("totally-made-up-code"), false, "the unknown code is echoed");
  // Prototype members are not messages.
  assert.equal(examDefinitionCreateErrorText("toString")?.includes("toString"), false);
  // `offering_not_found` is deliberately NOT renderable here: it never returns
  // to this page.
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      EXAM_DEFINITION_CREATE_ERROR_TEXT,
      "offering_not_found",
    ),
    false,
  );
});

// ===========================================================================
// 25–27. Page composition and form visibility
// ===========================================================================

test("25. the form renders ONLY when the plan exists AND the lifecycle permits it", () => {
  assert.ok(
    PAGE.includes(
      "const mayConfigure = evaluateCourseOperationPolicy(\n    context.status,\n    \"SCHEDULE_DRAFT_CONFIGURATION\",\n  ).allowed;",
    ) ||
      (PAGE.includes("evaluateCourseOperationPolicy(") &&
        PAGE.includes('"SCHEDULE_DRAFT_CONFIGURATION"') &&
        PAGE.includes(").allowed")),
    "the write gate is not evaluated for visibility",
  );
  assert.ok(
    PAGE.includes("const showCreateForm = view.planExists && mayConfigure;"),
    "visibility is not planExists AND the lifecycle gate",
  );
  // The gate is evaluated on the VERIFIED status, never on a route value.
  assert.ok(PAGE.includes("context.status"), "the gate does not use the verified status");
  // The form is rendered behind exactly that flag, and nowhere else.
  assert.equal((PAGE.match(/<ExamDefinitionCreateForm/g) ?? []).length, 1);
  assert.ok(PAGE.includes("{showCreateForm ? ("), "the form is not behind the flag");
});

test("26. an ARCHIVED offering stays readable and loses the form, by POLICY", () => {
  // The page states no status literal of its own: which statuses may configure
  // is the committed policy's decision, so ARCHIVED is denied there.
  for (const literal of ['"ARCHIVED"', '"PLANNED"', '"ACTIVE"']) {
    assert.equal(PAGE.includes(literal), false, `the page hard-codes ${literal}`);
  }
  // The READ gate is unchanged and still asserts, so archived config stays
  // readable...
  assert.ok(PAGE.includes('assertCourseOperationAllowed(context.status, "HISTORICAL_READ")'));
  // ...and the WRITE gate is only ever EVALUATED here, never asserted — an
  // assertion would turn an archived course into an error page.
  assert.equal(
    /assertCourseOperationAllowed\([^)]*SCHEDULE_DRAFT_CONFIGURATION/.test(PAGE),
    false,
    "the page asserts the write gate and would break archived reads",
  );
});

test("27. the no-plan branch renders no form, and searchParams never affects scope", () => {
  const noPlan = PAGE.slice(PAGE.indexOf("{!view.planExists ? ("), PAGE.indexOf(") : ("));
  assert.equal(
    noPlan.includes("ExamDefinitionCreateForm"),
    false,
    "the no-plan state offers a create form",
  );
  // searchParams exists for the notice ONLY: it reaches neither the
  // authorization boundary, nor the reader, nor either gate, nor the action.
  assert.ok(PAGE.includes("await searchParams;"), "the outcome is not read");
  assert.ok(
    PAGE.indexOf("requireAdminCourseOffering(courseOfferingId)") <
      PAGE.indexOf("await searchParams"),
    "searchParams is read before authorization",
  );
  assert.ok(
    PAGE.indexOf("readExamDefinitionsForAdmin(context.id)") < PAGE.indexOf("await searchParams"),
    "searchParams is read before the reader",
  );
  for (const forbidden of [
    "readExamDefinitionsForAdmin(createError",
    "requireAdminCourseOffering(create",
    ".bind(null, createdDefinition",
    "searchParams.courseOfferingId",
  ]) {
    assert.equal(PAGE.includes(forbidden), false, `searchParams reached scope via ${forbidden}`);
  }
});

// ===========================================================================
// 28–30. Containment and the slice footprint
// ===========================================================================

test("28. no new file names a committed exam core module (EX-C1)", () => {
  for (const [label, code] of [
    ["actions", ACTIONS_SOURCE],
    ["form", readSource(FORM_REL)],
    ["messages", readSource(MESSAGES_REL)],
    ["page", readSource(PAGE_REL)],
  ] as const) {
    for (const core of FORBIDDEN_CORES) {
      assert.equal(
        code.includes(`./${core}`) || code.includes(["lib", "exam", core].join("/")),
        false,
        `${label} names the core ${core}`,
      );
    }
  }
});

test("29. EXACTLY ONE module in the repository reaches the definition writer", () => {
  // `--untracked` matters: the approved caller is a NEW file, and a tracked-only
  // search would report a clean allow-list purely because the file is not
  // committed yet — the guard would pass for the wrong reason.
  const callers = gitLines([
    "grep",
    "-l",
    "--untracked",
    WRITE_IO_MODULE,
    "--",
    "app",
    "lib",
    "components",
  ]);
  // Exactly two files name the write binding: its own guard suite, and the
  // single approved Server Action. The binding itself does not name its own
  // path, so it is correctly absent. No page, component, layout, route handler
  // or other `lib/actions` module appears — which is the whole point.
  assert.deepEqual(callers.sort(), [
    "app/admin/courses/[courseOfferingId]/exams/actions.ts",
    "lib/actions/" + WRITE_IO_MODULE + ".test.ts",
  ]);
});

test("30. the batch touched EXACTLY its approved paths", () => {
  const touched = new Set([
    ...gitLines(["diff", "--name-only", "HEAD"]),
    ...gitLines(["diff", "--name-only", "--cached", "HEAD"]),
    ...gitLines(["ls-files", "--others", "--exclude-standard"]),
  ]);
  const offenders = [...touched].filter((path) => !SLICE_PATHS.includes(path)).sort();
  assert.deepEqual(offenders, [], `an unapproved path was touched: ${offenders.join(", ")}`);

  // And no schema, migration or capability file is among them.
  for (const path of touched) {
    assert.equal(/^prisma\//.test(path), false, `the slice touched ${path}`);
    assert.equal(/capabilit/i.test(path), false, `the slice touched ${path}`);
  }
});
