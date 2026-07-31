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
  "app/admin/courses/[courseOfferingId]/exams/actions.ts",
  "app/admin/courses/[courseOfferingId]/exams/ExamPlanCreateForm.tsx",
  // EX-PAIR-UI-MVP - the approved admin PAIRING UI, whose ONE new file this is.
  "app/admin/courses/[courseOfferingId]/exams/exam-pairing-ui.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-plan-create.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/page.tsx",
  "app/admin/courses/[courseOfferingId]/exams/exam-definitions-page.contract.test.ts",
  "lib/exam/create-exam-plan" + "-core.test.ts",
  "lib/actions/exam-plan-write" + "-io.test.ts",
  // The rest of the integration batch P3 now travels in: the approved
  // ExamDefinition create UI, and the ExamSession edit/delete writers. Every one
  // of these is assembled from pieces for the reason in the header — and the
  // session paths most sharply of all, because that slice's committed guard
  // asserts its writers have EXACTLY ZERO callers anywhere under `app/`.
  "app/admin/courses/[courseOfferingId]/exams/ExamDefinitionCreateForm.tsx",
  "app/admin/courses/[courseOfferingId]/exams/exam-definition-create-error-messages.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-definition-create.contract.test.ts",
  // The definition READER's guard suite likewise sweeps `app/` for its own module
  // name and pins an EXACT three-entry caller list, so this path is assembled too:
  // spelling it whole would make THIS suite a fourth "caller" of a reader it never
  // touches, and the only way to make that pass would be to widen the very list the
  // guard exists to keep narrow.
  "lib/actions/" + "exam-definition-read" + "-io.test.ts",
  "lib/actions/" + "exam-definition-write" + "-io.test.ts",
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
  // and the pure day-grouping core — into the page, and re-points this suite's
  // flattened `searchParams` shape from six keys to nine. Assembled for the reason
  // above, and most sharply of all here: the session reader's committed guard pins
  // its caller list to EXACTLY the page, so spelling that module name whole would
  // make THIS suite the second entry in a list that must hold one.
  "lib/actions/" + "admin-exam-session-read" + "-io.test.ts",
  // EX-SES-UI-2, the approved ExamSession EDIT and REMOVAL UI. It adds two client
  // forms and its own contract suite to this route, and re-points this suite's
  // export list, route file set, revalidation budget and flattened `searchParams`
  // shape — from nine keys to fifteen.
  "app/admin/courses/[courseOfferingId]/exams/ExamSessionEditForm.tsx",
  "app/admin/courses/[courseOfferingId]/exams/ExamSessionDeleteForm.tsx",
  "app/admin/courses/[courseOfferingId]/exams/exam-session-edit-delete.contract.test.ts",
  // EX-ASG-UI1, the approved stored-assignment CREATE and REMOVAL UI. It adds two
  // client forms, a closed message module and its own contract suite to this
  // route, and re-points this suite's export list, route file set, revalidation
  // budget and flattened `searchParams` shape — from fifteen keys to twenty. The
  // two `lib/` entries are assembled for the reason in the header, and most
  // sharply of all here: the assignment IO guards pinned their caller lists to
  // EXACTLY ZERO before this slice, so spelling either module name whole would
  // make THIS suite a caller of a module it never touches.
  "app/admin/courses/[courseOfferingId]/exams/CreateExamAssignmentForm.tsx",
  "app/admin/courses/[courseOfferingId]/exams/DeleteExamAssignmentForm.tsx",
  "app/admin/courses/[courseOfferingId]/exams/exam-assignment-messages.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-assignment-ui.contract.test.ts",
  "lib/actions/" + "exam-assignment-read" + "-io.test.ts",
  "lib/actions/" + "exam-assignment-write" + "-io.test.ts",
  "lib/actions/" + "exam-session-write" + "-io.test.ts",
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

/**
 * The body of ONE action inside the now-SHARED `"use server"` module.
 *
 * WHY THIS EXISTS. `actions.ts` was P3's alone when this suite was written. The
 * approved ExamDefinition create UI adds a SECOND action beside it, and the two
 * are deliberately kept as two separate endpoints. Every claim about how P3's
 * action treats the REQUEST — that it reads nothing from FormData, that it
 * revalidates exactly one path, that it redirects on exactly three branches — is
 * therefore re-pointed at P3's own body instead of at the whole file. That is the
 * same claim, correctly targeted: asserting it file-wide would now be asserting it
 * about the neighbouring action too, which has its own contract and its own suite.
 *
 * Module-WIDE claims stay module-wide: the `"use server"` first statement, the
 * exact export list, the import surface and the total absence of try/catch are
 * properties of the file and are checked as such below.
 */
function actionBody(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}(`);
  assert.ok(start > -1, `${name} is not declared in the action module`);
  const rest = source.slice(start + 1);
  const next = rest.indexOf("export async function ");
  return next === -1 ? source.slice(start) : source.slice(start, start + 1 + next);
}

/** P3's OWN action, isolated from the definition-create action beside it. */
const PLAN_ACTION = actionBody(ACTION, "createExamPlanAction");

// Split specifiers — see the header note on why these are assembled.
const WRITE_BINDING_MODULE = "exam-plan-write" + "-io";
const WRITE_BINDING_SPECIFIER = "@/lib/actions/" + WRITE_BINDING_MODULE;
/**
 * The NEIGHBOURING slice's write binding. Assembled for a sharper reason than the
 * rest: that binding's committed guard sweeps every file under `app/` for its own
 * module name and asserts an EXACT caller list of one, so spelling it whole here
 * would enrol this suite in a list it must stay out of.
 */
const DEFINITION_BINDING_MODULE = "exam-definition-write" + "-io";
const DEFINITION_BINDING_SPECIFIER = "@/lib/actions/" + DEFINITION_BINDING_MODULE;
/**
 * The SESSION write binding, assembled for the same reason and more sharply
 * still: its committed guard pins the caller list at EXACTLY ONE production
 * module and requires its EDIT and REMOVAL siblings to have NONE, so spelling it
 * whole here would register this suite as a second caller.
 */
const SESSION_BINDING_MODULE = "exam-session-write" + "-io";
const SESSION_BINDING_SPECIFIER = "@/lib/actions/" + SESSION_BINDING_MODULE;
/**
 * The ASSIGNMENT write binding, added by EX-ASG-UI1 and assembled for the sharpest
 * reason of all: its committed guard pinned the caller list at EXACTLY ZERO before
 * this slice, so spelling it whole here would register this suite as a caller of a
 * module it never invokes.
 */
const ASSIGNMENT_BINDING_MODULE = "exam-assignment-write" + "-io";
const ASSIGNMENT_BINDING_SPECIFIER = "@/lib/actions/" + ASSIGNMENT_BINDING_MODULE;
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

test("2. the action module is a Server Action module exporting EXACTLY the nine approved actions", () => {
  const firstStatement = ACTION.split("\n").find((line) => line.trim().length > 0);
  assert.equal(firstStatement?.trim(), '"use server";', `first statement: ${firstStatement}`);

  // Everything exported from a "use server" module is a public network endpoint, so
  // the export list IS the attack surface. RE-POINTED by EX-SES-S4, again by
  // EX-SES-UI-2, again by EX-ASG-UI1 and again by EX-PUB-UI-MVP, and still an
  // EXHAUSTIVE allow-list — it simply now names all nine approved actions, because
  // the route legitimately has nine. No helper, no parser, no constant and no type
  // may join them, and no TENTH endpoint may appear.
  const exports = [...ACTION.matchAll(/export\s+(?:async\s+)?(?:function|const|class|type)\s+(\w+)/g)]
    .map((match) => match[1])
    .sort();
  assert.deepEqual(exports, [
    "createExamAssignmentAction",
    "createExamDefinitionAction",
    "createExamInstructedTraineeAssignmentAction",
    "createExamPlanAction",
    "createExamSessionAction",
    "deleteExamAssignmentAction",
    "deleteExamSessionAction",
    // EX-PAIR-UI-MVP appended a TENTH: the admin pairing endpoint. Still EXHAUSTIVE.
    "setExamPairingAction",
    "setExamPlanPublicationAction",
    "updateExamSessionAction",
  ]);
  assert.equal(/export\s*\{/.test(ACTION), false, "no re-export list is allowed");
  assert.equal(/export\s+default/.test(ACTION), false, "no default export is allowed");
  assert.equal(/export\s+const/.test(ACTION), false, "no exported constant is allowed");
  assert.equal(/export\s+type/.test(ACTION), false, "no exported type is allowed");
  // No action was folded into a single generic endpoint that would have to
  // choose its operation from the request.
  //
  // The NINTH is the one place a submitted value names a transition, and it is
  // deliberately not the thing this rule forbids: publish and unpublish reach ONE
  // committed writer through ONE authorization boundary and ONE lifecycle gate, so
  // no request can steer between two different operations. Guard 22 pins that
  // field to its two literals from both directions.
  assert.equal((ACTION.match(/export async function /g) ?? []).length, 10);
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
  // Scoped to P3's own body — see `actionBody` above.
  assert.ok(PLAN_ACTION.includes("await requireAdmin()"), "requireAdmin() must be awaited");
  assert.equal(
    PLAN_ACTION.indexOf("await "),
    PLAN_ACTION.indexOf("await requireAdmin()"),
    "some other operation is awaited before requireAdmin()",
  );
  // ...and it runs before the write binding is entered.
  assert.ok(
    PLAN_ACTION.indexOf("await requireAdmin()") <
      PLAN_ACTION.indexOf("createExamPlan(courseOfferingId)"),
    "the write binding is reached before authorization",
  );
  // Module-wide: the very first awaited operation in the FILE is an admin gate, so
  // no action in it can have been added with the gate further down.
  assert.equal(ACTION.indexOf("await "), ACTION.indexOf("await requireAdmin()"));
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
  // Scoped to P3's own body: the neighbouring definition-create action reads seven
  // NAMED fields, which is its own approved contract and its own suite's business.
  // What must stay true here is that THIS action inspects the submission not at all.
  assert.equal(/formData\s*\./.test(PLAN_ACTION), false, "the action reads from formData");
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
    assert.equal(PLAN_ACTION.includes(forbidden), false, `the action must not use ${forbidden}`);
  }
  // The parameter exists only because React supplies it, and is discarded.
  assert.ok(PLAN_ACTION.includes("void formData;"), "the unread parameter must be explicit");
  // Neither action anywhere in the module may take the COURSE or the PLAN from the
  // submission — that claim is module-wide, because it is the scoping boundary.
  for (const forbidden of [
    'formData.get("courseOfferingId")',
    'formData.get("planId")',
    'formData.get("id")',
  ]) {
    assert.equal(ACTION.includes(forbidden), false, `no action may read ${forbidden}`);
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
  assert.ok(PLAN_ACTION.includes('if (result.code === "offering_not_found") {'));
  assert.ok(PLAN_ACTION.includes('redirect("/admin/courses?error=invalid")'));
  // Every other refusal -> this course's exams path, carrying ONLY the stable code.
  assert.ok(
    PLAN_ACTION.includes("redirect(`${examsPath}?error=${encodeURIComponent(result.code)}`)"),
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
  // Scoped to P3's body: each action revalidates exactly once, so a file-wide count
  // would now read 2 and prove nothing about either.
  assert.equal(
    PLAN_ACTION.split("revalidatePath(").length - 1,
    1,
    "revalidatePath must be called exactly once",
  );
  assert.ok(PLAN_ACTION.includes("revalidatePath(examsPath)"));
  assert.ok(
    PLAN_ACTION.includes(
      "const examsPath = `/admin/courses/${encodeURIComponent(courseOfferingId)}/exams`",
    ),
    "the exams path must be built from the bound offering id",
  );
  // No other route, layout or tag is revalidated — anywhere in the module.
  for (const forbidden of ['revalidatePath("/', "revalidateTag", '"layout"', '"page"']) {
    assert.equal(ACTION.includes(forbidden), false, `the action must not use ${forbidden}`);
  }
  // Every revalidation in the file is of that one bound path, and there is exactly
  // one per action: none can quietly refresh a second surface. Re-pointed from 2
  // to 3 by EX-SES-S4 — the PER-ACTION budget is what this asserts, and it is
  // unchanged.
  // Re-pointed again from 3 to 5 by EX-SES-UI-2, which adds the session EDIT and
  // REMOVAL endpoints. The per-action budget is still what this asserts: at most
  // one revalidation each, and the edit places its single occurrence on the
  // CHANGED branch alone, so a no-op edit revalidates nothing.
  // Re-pointed again from 5 to 7 by EX-ASG-UI1, which adds the assignment CREATE
  // and REMOVAL endpoints. The per-action budget is unchanged: one each, on the
  // success branch alone.
  // Re-pointed again from 8 to 9 by EX-PUB-UI-MVP, which adds the plan PUBLICATION
  // endpoint. The per-action budget is still one, and — like the session edit —
  // that single occurrence sits on the CHANGED branch alone, so a NO_CHANGE
  // publication revalidates nothing, because the committed writer issued no
  // statement and a cache invalidation would be a lie about what happened.
  assert.equal((ACTION.match(/revalidatePath\(/g) ?? []).length, 10);
  assert.equal((ACTION.match(/revalidatePath\(examsPath\)/g) ?? []).length, 10);
  // The two successes are distinguished, and both land on the exams path.
  assert.ok(
    PLAN_ACTION.includes(
      "redirect(result.created ? `${examsPath}?created=1` : `${examsPath}?existing=1`)",
    ),
    "created/existing must be reported distinctly",
  );
});

test("9. redirects sit outside any try/catch — the module has none at all", () => {
  // Module-wide, and deliberately so: this is the strongest form of the rule, and it
  // must hold for every action the file grows.
  for (const forbidden of [/\btry\b/, /\bcatch\b/, /\bfinally\b/]) {
    assert.equal(forbidden.test(ACTION), false, `the action must not use ${forbidden}`);
  }
  // Every redirect is therefore free to throw NEXT_REDIRECT to the framework, as
  // is the login redirect thrown by requireAdmin() and by the binding itself.
  assert.ok(PLAN_ACTION.split("redirect(").length - 1 >= 3, "all three branches must redirect");
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
  // Gated on the course lifecycle, using the non-throwing policy evaluation on the
  // VERIFIED status. The page now makes that ONE evaluation and derives both this
  // affordance and the definition form's from it, so the assertion moved from "the
  // flag IS the evaluation" to "the flag is that evaluation AND plan-absence" —
  // which is strictly stronger: the plan-create form is now unrenderable when a
  // plan exists by CONSTRUCTION, not merely by where it sits in the markup.
  assert.ok(
    PAGE_FLAT.includes(
      'const mayConfigure = evaluateCourseOperationPolicy( context.status, "SCHEDULE_DRAFT_CONFIGURATION", ).allowed;',
    ),
    "the affordance must be gated on SCHEDULE_DRAFT_CONFIGURATION",
  );
  assert.ok(
    PAGE.includes("const canCreatePlan = mayConfigure && !view.planExists;"),
    "the affordance must require BOTH the lifecycle gate and plan-absence",
  );
  // Exactly one policy evaluation exists, so this affordance and the neighbouring
  // definition form cannot drift onto different course operations.
  assert.equal((PAGE.match(/evaluateCourseOperationPolicy\(/g) ?? []).length, 1);
  assert.equal((PAGE.match(/"SCHEDULE_DRAFT_CONFIGURATION"/g) ?? []).length, 1);
  assert.ok(PAGE.includes("{canCreatePlan && ("), "the form must be rendered conditionally");

  // ...and positioned inside the plan-ABSENT branch: after the `!view.planExists`
  // JSX test and before the first content of the plan-present branch.
  const noPlanBranch = PAGE.indexOf("{!view.planExists ? (");
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
  // A CLOSED, exhaustively declared key set, and no other query key is ever
  // consulted. It grew from P3's three to six when the approved definition-create
  // feature added its own three outcome tokens, to NINE when EX-SES-UI-1 wired the
  // session create form and brought its three, to FIFTEEN when EX-SES-UI-2
  // added the session EDIT's four and the REMOVAL's two, and to TWENTY when
  // EX-ASG-UI1 added the assignment CREATE's three and the REMOVAL's two. It is
  // still an exact list, every key is still feedback-only, and not one of them
  // names a course, a plan, a definition, a session, a trainee, an assignment or a
  // version stamp — which the id ban below re-states from the other side.
  assert.ok(
    PAGE_FLAT.includes(
      "searchParams: Promise<{ created?: string | string[]; existing?: string | string[]; error?: string | string[]; createdDefinition?: string | string[]; createError?: string | string[]; createIssues?: string | string[]; createdSession?: string | string[]; sessionError?: string | string[]; sessionIssues?: string | string[]; updatedSession?: string | string[]; unchangedSession?: string | string[]; sessionEditError?: string | string[]; sessionEditIssues?: string | string[]; deletedSession?: string | string[]; sessionDeleteError?: string | string[]; createdAssignment?: string | string[]; assignmentError?: string | string[]; assignmentIssues?: string | string[]; deletedAssignment?: string | string[]; assignmentDeleteError?: string | string[]; createdInstructedTrainee?: string | string[]; instructedTraineeError?: string | string[]; instructedTraineeIssues?: string | string[]; publication?: string | string[]; pairing?: string | string[]; }>;",
    ),
    "the searchParams type must be the closed twenty-five-key shape",
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
  // and the SINGLE await that resolves it. One resolution, shared by both closed
  // parsers — a second `await searchParams` would let a later reader diverge from
  // the one this suite describes.
  assert.equal(PAGE.split("searchParams").length - 1, 3, "searchParams must appear exactly 3 times");
  assert.equal(PAGE.split("await searchParams").length - 1, 1);
  assert.ok(PAGE.includes("const query = await searchParams;"));
  assert.ok(PAGE.includes("const feedback = feedbackFrom(query);"));

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

test("17. no publication, source-date, session, capability or notification work", () => {
  for (const [name, source] of [
    ["page", PAGE],
    ["form", FORM],
    ["action", ACTION],
  ] as const) {
    // Mutation VERBS, not the word "publish": the page legitimately RENDERS the
    // committed read-only publication state (`view.publishedAt`), which predates
    // P3 and is proven by the sibling suite. What must be absent is any way to
    // CHANGE publication, source dates or sessions from here.
    //
    // The definition CREATE verb is no longer in this list, because it is now an
    // approved neighbour with its own reviewed contract and its own suite. Every
    // OTHER definition verb stays forbidden, and the two checks below re-establish
    // the narrower claim from both directions.
    //
    // RE-POINTED by EX-SES-S4: the blanket `examSession` / `ExamSession` SUBSTRING
    // bans are replaced by NARROW bans on session management this route does not
    // perform. The session CREATE is now an approved neighbour on the same terms
    // the definition CREATE already earned; its EDIT, REMOVAL and reordering are
    // not, and are banned by name. The Prisma ACCESSOR spelling `examSession.` is
    // KEPT — the no-Prisma claim is untouched, and is what the trailing dot means.
    for (const forbidden of [
      "publishExamPlan",
      "unpublishExamPlan",
      "deleteExamPlan",
      "sourceDate",
      "SourceDate",
      // The Prisma model ACCESSORS themselves: no file here may touch a table.
      // Spelled with the trailing dot, which is what makes it an accessor — the
      // page legitimately imports route-local message helpers whose names begin
      // `examDefinition...`, and those read no table at all. The stronger claim
      // that no Prisma client is reachable from any of these files is asserted
      // separately, by test 16 and by the sibling route suite.
      "examDefinition.",
      "examSession.",
      // RE-POINTED by EX-ASG-UI1, on EXACTLY the terms `examDefinition.` and
      // `examSession.` were: the blanket substring bans become the Prisma ACCESSOR
      // spelling. The no-Prisma claim is untouched — that trailing dot is what
      // makes it an accessor — while the route may legitimately name its own
      // approved assignment endpoints, forms and message helpers.
      "examAssignment.",
      // The session EDIT and REMOVAL verbs left this SHARED loop in EX-SES-UI-2 and
      // are re-asserted against the page and the form alone, immediately below —
      // the action module now legitimately holds both endpoints, on exactly the
      // terms the definition and session CREATE verbs already earned. Reordering
      // stays banned everywhere, since no reorder affordance exists at all.
      "reorder" + "ExamSessions",
      "update" + "ExamDefinition",
      "delete" + "ExamDefinition",
      "reorder" + "ExamDefinitions",
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
  // The destructive session verbs, re-asserted on the two files that may never
  // reach a writer of any kind. Only the Server Action module may, and the two
  // endpoints it holds are proven in their own suite.
  for (const [name, source] of [
    ["page", PAGE],
    ["form", FORM],
  ] as const) {
    for (const forbidden of ["update" + "ExamSession" + "(", "delete" + "ExamSession" + "("]) {
      assert.equal(source.includes(forbidden), false, `the ${name} must not call ${forbidden}`);
    }
  }

  // P3's OWN action writes nothing but the plan: publication state is absent from
  // it entirely, in either spelling, and it names no part of the definition slice —
  // so the two endpoints in this file cannot have become entangled.
  for (const forbidden of [
    "publish",
    "Publish",
    "ExamDefinition",
    // Added by EX-SES-S4: the plan endpoint gains nothing from the session
    // endpoint's arrival in the same file, and the SUBSTRING ban is safe HERE —
    // it is scoped to this one action's body, not to the module.
    "ExamSession",
    "ExamAssignment",
    DEFINITION_BINDING_MODULE,
    SESSION_BINDING_MODULE,
    ASSIGNMENT_BINDING_MODULE,
  ]) {
    assert.equal(
      PLAN_ACTION.includes(forbidden),
      false,
      `P3's action must not reference ${forbidden}`,
    );
  }
  // No create form may reach a write binding of any kind: only the Server
  // Action module may.
  for (const forbidden of [
    WRITE_BINDING_MODULE,
    DEFINITION_BINDING_MODULE,
    SESSION_BINDING_MODULE,
    ASSIGNMENT_BINDING_MODULE,
  ]) {
    assert.equal(FORM.includes(forbidden), false, `the form must not reference ${forbidden}`);
    assert.equal(PAGE.includes(forbidden), false, `the page must not reference ${forbidden}`);
  }
  // The module's ENTIRE import surface is the approved specifiers: the admin
  // boundary, the committed write bindings, and the two framework modules.
  // Nothing else — no Prisma, no core, no capability, no notification surface.
  // RE-POINTED by EX-SES-S4, by EX-ASG-UI1 and again by EX-PUB-UI-MVP by ADDING
  // one specifier to an exhaustive list, which keeps this the strongest available
  // form of the guard: an unapproved writer still fails here.
  const specifiers = [...ACTION.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]).sort();
  assert.deepEqual(specifiers, [
    "@/lib/auth/require-admin",
    WRITE_BINDING_SPECIFIER,
    DEFINITION_BINDING_SPECIFIER,
    SESSION_BINDING_SPECIFIER,
    ASSIGNMENT_BINDING_SPECIFIER,
    // ADDED by EX-ASG-IT2, assembled for the reason in the header: the committed
    // instructed-trainee write binding's guard pinned its caller list at ZERO
    // before this slice, and at exactly this one Server Action module after it.
    "@/lib/actions/" + "exam-instructed-trainee-assignment-write" + "-io",
    // ADDED by EX-ASG-LTD2-B2, and assembled on exactly the same terms: the
    // committed DETAILED examinee write binding's guard pinned its caller list at
    // ZERO before that slice, and at exactly this one Server Action module after
    // it. It is an ADDITION and not a swap — the three-field binding above is
    // still imported, for the assignment REMOVAL.
    "@/lib/actions/" + "detailed-exam-assignment-write" + "-io",
    // ADDED by EX-PUB-UI-MVP, assembled on exactly the same terms and for the
    // sharpest version of the reason in the header: the committed publication
    // write binding's guard pinned its caller list at ZERO before this slice, and
    // at exactly this one Server Action module after it — so spelling the module
    // whole HERE would enrol this guard suite in the very list it exists to keep
    // at one production caller.
    "@/lib/actions/" + "exam-publication-write" + "-io",
    // ADDED by EX-PAIR-UI-MVP, and assembled on exactly the same terms: the
    // committed PAIRING write binding's own guard pinned its caller list at
    // EXACTLY ZERO before this slice and at exactly this one Server Action
    // module after it, so a suite that spelled the module whole would enrol
    // itself in that list.
    "@/lib/actions/" + "exam-pairing-write" + "-io",
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

test("19. the route directory holds EXACTLY the twenty-three approved files", () => {
  // Tracked AND untracked, so this holds both before and after the slice is
  // committed. Listing the whole repository and filtering by prefix in JS is
  // deliberate: a `[courseOfferingId]` pathspec would be read by git as a
  // character class.
  //
  // RE-POINTED by EX-SES-S4, not relaxed: three reviewed session-create files
  // joined the route, so the exact set grew from eight to eleven. RE-POINTED
  // AGAIN by EX-SES-UI-2, on the same terms: an edit form, a delete form and their
  // contract suite joined it, so the set grew to fourteen. RE-POINTED AGAIN by
  // EX-ASG-UI1: an assignment create form, an assignment delete form, a closed
  // message module and their contract suite joined it, so the set grew to
  // eighteen. A nineteenth file still fails here.
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
    // EX-PAIR-UI-MVP - the approved admin PAIRING UI, whose ONE new file this is.
    "app/admin/courses/[courseOfferingId]/exams/exam-pairing-ui.contract.test.ts",
    "app/admin/courses/[courseOfferingId]/exams/exam-plan-create.contract.test.ts",
    "app/admin/courses/[courseOfferingId]/exams/exam-publication-ui.contract.test.ts",
    "app/admin/courses/[courseOfferingId]/exams/exam-session-create-error-messages.ts",
    "app/admin/courses/[courseOfferingId]/exams/exam-session-create.contract.test.ts",
    "app/admin/courses/[courseOfferingId]/exams/exam-session-edit-delete.contract.test.ts",
    "app/admin/courses/[courseOfferingId]/exams/page.tsx",
  ]);
});

test("20. the batch touched nothing outside its approved paths", () => {
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
