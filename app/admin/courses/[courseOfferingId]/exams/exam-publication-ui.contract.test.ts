import test from "node:test";
import assert from "node:assert/strict";

/**
 * EXAM EX-PUB-UI-MVP — the contract of the manager-facing PUBLISH / UNPUBLISH of
 * one ExamPlan, on the course-scoped admin exams route.
 *
 * Run (the bracketed route segment is a GLOB to node:test, so the `[` must be
 * escaped as `[[]` or the file silently matches nothing and zero tests run):
 *   npx tsx --test "app/admin/courses/[[]courseOfferingId]/exams/exam-publication-ui.contract.test.ts"
 *
 * ===========================================================================
 * WHY SO MANY TOKENS IN THIS FILE ARE ASSEMBLED FROM PIECES
 * ===========================================================================
 * Several committed guards sweep every file under `app/`, `lib/` and
 * `components/` for a module name or a CALL SHAPE and pin the result to an exact
 * caller list. The one that matters most here is the committed publication write
 * binding's: before this slice it pinned its caller list at EXACTLY ZERO, and
 * after it at exactly the one Server Action module this suite describes.
 *
 * A CONTRACT SUITE IS NOT A CALLER. This file asserts things ABOUT that binding;
 * it never invokes one. But those guards match RAW SOURCE TEXT — not imports, not
 * an AST — so a suite that spelled the binding's module name, or its public call,
 * whole anywhere in its source (INCLUDING in a comment such as this one) would
 * enrol itself in the very allow-list it exists to keep narrow. The only way to
 * make that pass would be to widen it, which is exactly backwards. This paragraph
 * therefore describes those tokens rather than reproducing them.
 *
 * So every such token below is built by concatenation. The value compared against
 * the production source is identical; only the literal spelling in THIS file
 * differs. That is the project's split-literal convention, and it is load-bearing
 * rather than cosmetic.
 *
 * ===========================================================================
 * WHAT THIS SUITE PROVES, AND WHAT IT DELIBERATELY DOES NOT
 * ===========================================================================
 * It proves the SHAPE of the ninth endpoint and its two inline forms: the exact
 * ONE-field FormData budget, the absent plan id and the absent timestamp, the
 * server-bound offering, the authorization order, the closed result mapping onto
 * an exact Hebrew table, the three UI states (draft, published, no plan), and the
 * fact that publication adds no notification, no per-session publication, no
 * pairing check and no supervisor check.
 *
 * It does NOT re-prove the committed writer. Whether an already-published plan is
 * a no-op that writes nothing, whether a re-publish leaves the stored instant
 * where it was, whether the conditional write really carries the expected state,
 * and how the two typed errors are classified are all that binding's own
 * contract, proven in its own suite against fakes. Nothing in this slice changed
 * any of it, which the footprint guard below asserts directly.
 *
 * DB-FREE AND PRODUCTION-FREE: this suite reads repository sources from disk and
 * runs `git` to describe its own file scope. It opens no database connection,
 * executes no SQL, reads no environment variable, resolves no session and makes
 * no network request.
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
const SUITE_REL = join(ROUTE_DIR_REL, "exam-publication-ui.contract.test.ts");

/** The one endpoint this slice adds. */
const ACTION_NAME = "setExamPlanPublicationAction";
/** The committed binding it calls, and that binding's module — both assembled. */
const WRITER_NAME = "set" + "ExamPlanPublication";
const WRITER_SPECIFIER = "@/lib/actions/" + "exam-publication-write" + "-io";
/** The call shape the committed caller guard sweeps for, likewise assembled. */
const WRITER_CALL = WRITER_NAME + "(";

const PRISMA_MODULE = "@/lib/" + "prisma";
const GENERATED_CLIENT = "@/app/" + "generated/prisma/client";

function readSource(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

/** Strip comments so every assertion below is about CODE, never about prose. */
function stripComments(source: string): string {
  return source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** Collapse every run of whitespace, so formatting cannot break an assertion. */
function squash(source: string): string {
  return source.replace(/\s+/g, " ");
}

const ACTIONS_SOURCE = readSource(ACTIONS_REL);
const PAGE_SOURCE = readSource(PAGE_REL);
const ACTIONS = stripComments(ACTIONS_SOURCE);
const PAGE = stripComments(PAGE_SOURCE);
const ACTIONS_FLAT = squash(ACTIONS);
const PAGE_FLAT = squash(PAGE);

/**
 * ONE top-level function's body, from its declaration to the closing brace in
 * column 0 — so an "inside this action" assertion means what it says.
 */
function bodyOf(name: string): string {
  const start = ACTIONS.indexOf(`export async function ${name}(`);
  assert.ok(start > -1, `${name} is missing`);
  const end = ACTIONS.indexOf("\n}", start);
  assert.ok(end > start, `${name} is unbalanced`);
  return ACTIONS.slice(start, end + 2);
}

const PUBLICATION_ACTION = bodyOf(ACTION_NAME);

function gitLines(args: readonly string[]): string[] {
  const result = spawnSync("git", [...args], { cwd: REPO_ROOT, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
}

/**
 * The EXACT approved footprint of this slice: two production files, one new
 * suite, and the guard suites whose counts it re-points.
 *
 * The `lib/` entry is assembled for the reason in the header — that suite is the
 * one whose caller sweep this file must stay out of.
 */
const SLICE_PATHS = [
  // EX-ADMIN-SRCDATE — the TWO new `lib/` modules that let a manager select which
  // Teaching-Practice days the plan runs as exam days, plus their suites.
  // ASSEMBLED from pieces, for the reason this file's header records: those guards
  // sweep raw source for their own module names and pin exact consumer lists, so a
  // path written whole here would enrol this suite in one of them.
  "lib/exam/" + "admin-exam-source-date" + "-core.test.ts",
  "lib/actions/" + "admin-exam-source-date" + "-io.test.ts",
  ROUTE_DIR_PREFIX + "actions.ts",
  ROUTE_DIR_PREFIX + "page.tsx",
  ROUTE_DIR_PREFIX + "exam-publication-ui.contract.test.ts",
  // EX-PAIR-UI-MVP - the approved admin PAIRING UI, which travels in the same
  // working tree. It adds ONE contract suite of its own, re-points this suite's
  // route file set and export count, and extends the committed ADMIN ASSIGNMENT
  // READ pair so a stored pairing can be displayed at all. Those two lib/
  // PRODUCTION modules and the pure core's suite therefore join this list BY
  // NAME, assembled like every other lib/ entry here. Nothing it does touches
  // publication: no schema, no migration, no auth, no capability and no
  // publication module is named.
  ROUTE_DIR_PREFIX + "exam-pairing-ui.contract.test.ts",
  "lib/exam/" + "admin-exam-assignment-read" + "-core.ts",
  "lib/exam/" + "admin-exam-assignment-read" + "-core.test.ts",
  "lib/actions/" + "exam-assignment-read" + "-io.ts",
  "lib/actions/" + "exam-pairing-write" + "-io.test.ts",
  ROUTE_DIR_PREFIX + "exam-plan-create.contract.test.ts",
  ROUTE_DIR_PREFIX + "exam-definitions-page.contract.test.ts",
  ROUTE_DIR_PREFIX + "exam-definition-create.contract.test.ts",
  ROUTE_DIR_PREFIX + "exam-session-create.contract.test.ts",
  ROUTE_DIR_PREFIX + "exam-session-edit-delete.contract.test.ts",
  ROUTE_DIR_PREFIX + "exam-assignment-ui.contract.test.ts",
  ROUTE_DIR_PREFIX + "exam-instructed-trainee-assignment-ui.contract.test.ts",
  // The committed `lib/` guard suites this slice re-points, and NOT ONE `lib/`
  // production file. Each of these was written while ITS own slice was the one in
  // the working tree and pins that slice's footprint to an exact list, so a NEW
  // slice in the same tree necessarily has to name itself in each of them. Every
  // entry here ends in `.test.ts`, which the assertion below re-checks rather than
  // trusting this list to stay honest on its own.
  //
  // ASSEMBLED, every one: each of these suites sweeps the repository for its own
  // module name and pins an exact caller list, so a path written whole here would
  // enrol this suite in a list it must stay out of.
  "lib/actions/" + "exam-publication-write" + "-io.test.ts",
  "lib/actions/" + "admin-exam-session-read" + "-io.test.ts",
  "lib/actions/" + "exam-assignment-read" + "-io.test.ts",
  "lib/actions/" + "exam-assignment-write" + "-io.test.ts",
  "lib/actions/" + "exam-definition-read" + "-io.test.ts",
  "lib/actions/" + "exam-instructed-trainee-assignment-write" + "-io.test.ts",
  "lib/actions/" + "exam-plan-write" + "-io.test.ts",
  "lib/actions/" + "exam-session-write" + "-io.test.ts",
  "lib/exam/" + "exam-supervisor-write" + "-core.test.ts",
  // EX-ADMIN-WORKSPACE-UX — the four route files the workspace adds, plus the two
  // new `lib/` modules behind its two operations and their suites. The `lib/`
  // entries are ASSEMBLED for the reason this suite's header records: the
  // committed guards sweep raw source text, so a whole literal here would enrol
  // this file as a caller of a writer it never invokes.
  "app/admin/courses/[courseOfferingId]/exams/EditExamAssignmentCard.tsx",
  "app/admin/courses/[courseOfferingId]/exams/exam-workspace-view.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-workspace-messages.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-workspace.contract.test.ts",
  "lib/exam/" + "admin-exam-workspace-edit" + "-core.ts",
  "lib/exam/" + "admin-exam-workspace-edit" + "-core.test.ts",
  "lib/actions/" + "admin-exam-workspace-edit" + "-io.ts",
  "lib/actions/" + "admin-exam-workspace-edit" + "-io.test.ts",
  // Every committed `lib/` guard suite EX-ADMIN-WORKSPACE-UX re-points, so the
  // footprint here matches the working tree in full. All ASSEMBLED, for the
  // reason this suite's header records.
  "lib/actions/" + "exam-supervisor-read" + "-io.test.ts",
  "lib/actions/" + "exam-supervisor-write" + "-io.test.ts",
  "lib/exam/" + "create-exam-plan" + "-core.test.ts",
  "lib/exam/" + "exam-read" + ".contract.test.ts",
  // BLOCKER-1 — the canonical wave narrowing, its suite, and the ONE committed
  // `lib/` production module this slice modifies: the role-reader module, which
  // gains one ADMIN-ONLY export so the admin schedule can reuse the committed
  // timetable derivation instead of reproducing it. ASSEMBLED, so this suite
  // does not enrol itself as a caller of what it names.
  "lib/exam/" + "admin-exam-wave-view" + "-core.ts",
  "lib/exam/" + "admin-exam-wave-view" + "-core.test.ts",
  "lib/actions/" + "exam-role" + "-readers" + ".ts",
  // EX-ADMIN-SRCDATE ADDED two `lib/` production modules and MODIFIED no
  // committed one: the pure source-date decision core, and its server-only
  // binding. They are the ONE way a plan can gain a Teaching-Practice date, and
  // without them every plan held an empty selection and beginner exams could
  // not appear on any screen. ASSEMBLED, for the reason this header records.
  "lib/exam/" + "admin-exam-source-date" + "-core.ts",
  "lib/actions/" + "admin-exam-source-date" + "-io.ts",
  // BLOCKER-1 also re-points the READ-PIPELINE guard suites whose claims the one
  // admin-only export makes obsolete. ASSEMBLED.
  "lib/exam/" + "exam-read" + "-dto.test.ts",
  "lib/exam/" + "exam-read-scope" + "-core.test.ts",

  // EX-ASG-MULTIPLICITY + EX-PAIR-NO-SELF - this branch's EXACT, CLOSED footprint.
  // ADDED, never widened: every entry is one exact literal path. No directory,
  // no prefix, no glob - an unrelated file still fails this guard. Module names
  // are SPLIT so this list never reads as a REFERENCE to the module it names.
  "app/admin/courses/[courseOfferingId]/exams/CreateExamInstructedTraineeAssignment" + "Form.tsx",
  "app/admin/courses/[courseOfferingId]/exams/exam-instructed-trainee-assignment" + "-messages.ts",
  "app/student/trainee-teaching-practice-home-shortcut" + ".contract.test.ts",
  "lib/actions/detailed-exam-assignment-write" + "-io.test.ts",
  "lib/actions/detailed-exam-assignment-write" + "-io.ts",
  "lib/actions/exam-assignment-write" + "-io.ts",
  "lib/actions/exam-instructed-trainee-assignment-write" + "-io.ts",
  "lib/actions/exam-pairing-write" + "-io.ts",
  "lib/actions/instructor-exam-schedule" + ".contract.test.ts",
  "lib/actions/message-audience" + ".contract.test.ts",
  "lib/actions/trainee-exam-schedule" + ".contract.test.ts",
  "lib/exam/admin-exam-examinee-pairing" + "-core.test.ts",
  "lib/exam/admin-exam-examinee-pairing" + "-core.ts",
  "lib/exam/create-exam-instructed-trainee-assignment" + "-core.test.ts",
  "lib/exam/create-exam-instructed-trainee-assignment" + "-core.ts",
  "lib/exam/exam-conflict" + "-core.ts",
  "lib/exam/exam-pairing-write" + "-core.test.ts",
  "lib/exam/exam-pairing-write" + "-core.ts",
  "lib/exam/exam-schema-structure" + ".test.ts",
  "prisma/migrations/20260802120000_scope_exam_assignment_unique_to_examinee/migration.sql",
  "prisma/schema.prisma",
];

/** The route's EXACT final file set, after this slice's ONE addition. */
const FINAL_ROUTE_FILES = [
  "app/admin/courses/[courseOfferingId]/exams/CreateExamAssignmentForm.tsx",
  "app/admin/courses/[courseOfferingId]/exams/CreateExamInstructedTraineeAssignmentForm.tsx",
  "app/admin/courses/[courseOfferingId]/exams/DeleteExamAssignmentForm.tsx",
  "app/admin/courses/[courseOfferingId]/exams/EditExamAssignmentCard.tsx",
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
  "app/admin/courses/[courseOfferingId]/exams/exam-workspace-messages.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-workspace-view.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-workspace.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/page.tsx",
];

/** The EXACT approved Hebrew, code by code. Nothing else may be shown. */
const SUCCESS_TEXTS: ReadonlyArray<readonly [string, string]> = [
  ["PUBLISHED", "לוח המבחנים פורסם לחניכים."],
  ["UNPUBLISHED", "פרסום לוח המבחנים בוטל."],
  ["NO_CHANGE", "מצב הפרסום כבר מעודכן."],
];
const FAILURE_TEXTS: ReadonlyArray<readonly [string, string]> = [
  ["plan_not_found", "לא נמצאה תוכנית מבחנים לפרסום."],
  ["operation_not_allowed", "לא ניתן לשנות את מצב הפרסום של הקורס כעת."],
  ["stale_write", "מצב הפרסום השתנה בינתיים. יש לרענן ולנסות שוב."],
  ["unknown_operation", "בקשת הפרסום אינה תקינה."],
];

const DRAFT_TEXT = "טיוטה";
const PUBLISHED_TEXT = "פורסם";
const PUBLISH_BUTTON = "פרסום לחניכים";
const UNPUBLISH_BUTTON = "ביטול פרסום";
const PUBLISHED_WARNING =
  "הלוח כבר פורסם לחניכים. שינויים שתבצעי כעת עשויים לשנות את המידע שהם רואים.";
const NO_PLAN_TEXT = "יש ליצור תוכנית מבחנים לפני הפרסום.";

// ===========================================================================
// 1–3. The endpoint exists, exactly once, in exactly the approved place
// ===========================================================================

test("1. the slice adds ONE file and creates no new route or component", () => {
  for (const rel of [ACTIONS_REL, PAGE_REL, SUITE_REL]) {
    assert.ok(existsSync(join(REPO_ROOT, rel)), `${rel} is missing`);
  }
  // No second exams route in any role area, and no publication route of its own.
  for (const dir of [
    join("app", "admin", "exams"),
    join("app", "instructor", "exams"),
    join("app", "student", "exams"),
    join(ROUTE_DIR_REL, "publication"),
    join(ROUTE_DIR_REL, "publish"),
  ]) {
    assert.equal(existsSync(join(REPO_ROOT, dir)), false, `${dir} was created`);
  }
  // The publication control is INLINE, so no component file came with it either.
  for (const file of [
    join(ROUTE_DIR_REL, "ExamPlanPublicationForm.tsx"),
    join(ROUTE_DIR_REL, "PublishExamPlanForm.tsx"),
    join(ROUTE_DIR_REL, "exam-publication-messages.ts"),
  ]) {
    assert.equal(existsSync(join(REPO_ROOT, file)), false, `${file} was created`);
  }
});

test("2. the route directory holds EXACTLY the twenty-seven approved files", () => {
  // Tracked AND untracked, so this holds before and after the slice is committed.
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
  assert.deepEqual(routeFiles, FINAL_ROUTE_FILES, "the route file set changed");
  assert.equal(routeFiles.length, 27);
});

test("3. the action module is STILL a Server Action module and nothing else", () => {
  const firstStatement = ACTIONS_SOURCE.split("\n").find((line) => line.trim().length > 0);
  assert.equal(firstStatement?.trim(), '"use server";');
  // Everything exported from a "use server" module is a public network endpoint,
  // so the export list is the attack surface: nothing but the nine actions leaves
  // this file, and the ninth is the one this slice adds.
  const exported = [...ACTIONS_SOURCE.matchAll(/export (?:async )?function (\w+)\(/g)].map(
    ([, name]) => name,
  );
  // RE-POINTED by EX-ADMIN-SRCDATE's ONE appended endpoint — the source-date
  // replacement, which is the only way a plan can gain a Teaching-Practice day
  // and therefore the only way a beginner exam can appear anywhere at all.
  assert.equal(exported.length, 13, "no fourteenth endpoint may exist in this module");
  assert.equal(exported[8], ACTION_NAME, "the publication action must be appended LAST");
  assert.equal(exported.filter((name) => name === ACTION_NAME).length, 1);
  for (const token of ["export const", "export default", "export {", "export type"]) {
    assert.equal(ACTIONS.includes(token), false, `the module also declares ${token}`);
  }
  // ...and there is no SECOND publication endpoint under any other name.
  for (const forbidden of [
    "publishExamPlanAction",
    "unpublishExamPlanAction",
    "togglePublicationAction",
  ]) {
    assert.equal(ACTIONS.includes(forbidden), false, `a second endpoint exists: ${forbidden}`);
  }
});

// ===========================================================================
// 4–6. The signature, the authorization order, and the absent try/catch
// ===========================================================================

test("4. the action has the EXACT locked signature, and returns void", () => {
  assert.ok(
    new RegExp(
      `export async function ${ACTION_NAME}\\(\\s*courseOfferingId: string,\\s*formData: FormData,\\s*\\): Promise<void> \\{`,
    ).test(ACTIONS_SOURCE),
    "the signature is not the locked one",
  );
  // TWO parameters and no third: no plan id, no publishedAt, no timestamp, no
  // actor id, no `prevState`. `Promise<void>` is what keeps a `prevState`
  // parameter unrepresentable, because an in-page error renderer would demand one.
  const signature = ACTIONS_FLAT.slice(
    ACTIONS_FLAT.indexOf(`export async function ${ACTION_NAME}(`),
  );
  const params = signature.slice(signature.indexOf("(") + 1, signature.indexOf(")"));
  assert.deepEqual(
    params.split(",").map((part) => part.trim()).filter(Boolean),
    ["courseOfferingId: string", "formData: FormData"],
  );
});

test("5. requireAdmin() is the FIRST awaited operation in the body", () => {
  const firstAwait = PUBLICATION_ACTION.indexOf("await ");
  assert.ok(firstAwait > -1, "the action awaits nothing");
  assert.ok(
    PUBLICATION_ACTION.slice(firstAwait).startsWith("await requireAdmin();"),
    "requireAdmin() is not the first awaited operation",
  );
  // Nothing is read from the submission, and no writer is entered, before it.
  const beforeAuth = PUBLICATION_ACTION.slice(0, firstAwait);
  for (const forbidden of ["formData.get", WRITER_CALL, "redirect(", "revalidatePath("]) {
    assert.equal(beforeAuth.includes(forbidden), false, `${forbidden} runs before requireAdmin`);
  }
});

test("6. there is STILL no try/catch anywhere, so NEXT_REDIRECT always propagates", () => {
  // The strongest form of the rule: not "the redirect is outside the block", but
  // "there is no block". A `catch` here would swallow the login redirect thrown by
  // requireAdmin() or by the committed binding's own admin boundary.
  for (const token of ["try {", "catch", "finally"]) {
    assert.equal(ACTIONS.includes(token), false, `the module contains ${token}`);
  }
});

// ===========================================================================
// 7–10. What the form may say, and what it structurally cannot
// ===========================================================================

test("7. the action reads EXACTLY ONE field, and it is `operation`", () => {
  const reads = [...PUBLICATION_ACTION.matchAll(/formData\.get\("([^"]+)"\)/g)].map(
    ([, key]) => key,
  );
  assert.deepEqual(reads, ["operation"]);
  assert.equal((PUBLICATION_ACTION.match(/formData\./g) ?? []).length, 1);
  // No iteration escape hatch: a loop over the submission would defeat the budget.
  for (const forbidden of ["formData.entries", "formData.forEach", "formData.keys", "...formData"]) {
    assert.equal(PUBLICATION_ACTION.includes(forbidden), false, `the action uses ${forbidden}`);
  }
});

test("8. NO plan id, timestamp, actor or scope is ever read from the submission", () => {
  // Not filtered out — never looked for. Each of these would be a way for a client
  // to decide something the server must decide: WHICH plan, WHEN it was published,
  // or WHO published it.
  for (const forbidden of [
    'formData.get("planId")',
    'formData.get("courseOfferingId")',
    'formData.get("publishedAt")',
    'formData.get("individualPublishedAt")',
    'formData.get("timestamp")',
    'formData.get("now")',
    'formData.get("actorId")',
    'formData.get("sessionId")',
  ]) {
    // Scoped to THIS action's body: the module's eight neighbours legitimately
    // read a session id of their own, and a module-wide ban would say nothing
    // about the endpoint under test.
    assert.equal(
      PUBLICATION_ACTION.includes(forbidden),
      false,
      `the action reads ${forbidden}`,
    );
  }
  // ...and no clock is read anywhere in the module: the committed binding owns the
  // publication instant, in one place, on the server.
  for (const forbidden of ["Date.now(", "new Date(", "publishedAt"]) {
    assert.equal(PUBLICATION_ACTION.includes(forbidden), false, `the action uses ${forbidden}`);
  }
});

test("9. the ONE field is CLOSED to the two literals, and never coerced", () => {
  // The narrowing is a direct comparison to two literals: no String(...), no ??,
  // no .trim(), no case folding and no default. A File entry from a multipart
  // submission equals neither literal and is refused exactly as an absent field is.
  assert.ok(
    PUBLICATION_ACTION.includes(
      'if (submitted !== "PUBLISH" && submitted !== "UNPUBLISH") {',
    ),
    "the operation field is not closed to the two literals",
  );
  for (const forbidden of [
    "String(submitted",
    "submitted ??",
    "submitted.trim",
    "toUpperCase",
    "toLowerCase",
    "as ExamPublicationOperation",
    "as string",
  ]) {
    assert.equal(PUBLICATION_ACTION.includes(forbidden), false, `the action uses ${forbidden}`);
  }
  // The two literals appear EXACTLY where they should and nowhere else: once each
  // in the guard, and the VERIFIED value — never the raw one — reaches the writer.
  assert.ok(
    PUBLICATION_ACTION.includes(`await ${WRITER_NAME}(courseOfferingId, submitted)`),
    "the writer does not receive the bound id and the narrowed operation",
  );
  // A default is unrepresentable: an unrecognized value REDIRECTS rather than
  // falling through to PUBLISH.
  assert.ok(
    PUBLICATION_ACTION.includes("?publication=unknown_operation"),
    "an unrecognized operation must fail closed",
  );
});

test("10. the offering is the BOUND leading argument, never a submitted field", () => {
  // The bound id travels inside the encrypted Server Action payload, so it is not
  // forgeable from the client — and it is bound from `context.id`, the offering
  // the page's own admin boundary already verified, never from the raw route param.
  assert.ok(
    PAGE_FLAT.includes(
      `const boundSetExamPlanPublicationAction = ${ACTION_NAME}.bind(null, context.id);`,
    ),
    "the publication action is not bound once to the verified context id",
  );
  assert.equal((PAGE.match(new RegExp(`${ACTION_NAME}\\.bind`, "g")) ?? []).length, 1);
  assert.equal(
    PAGE.includes(`${ACTION_NAME}.bind(null, courseOfferingId)`),
    false,
    "the raw route param is bound",
  );
  // The exams path is built from the BOUND id and nothing else.
  assert.ok(
    PUBLICATION_ACTION.includes(
      "const examsPath = `/admin/courses/${encodeURIComponent(courseOfferingId)}/exams`",
    ),
    "the exams path is not built from the bound, encoded offering id",
  );
});

// ===========================================================================
// 11–13. The one writer, the one revalidation, the closed redirect targets
// ===========================================================================

test("11. the action calls the committed publication writer and NOTHING else", () => {
  assert.equal(
    (PUBLICATION_ACTION.match(new RegExp(WRITER_CALL.replace(/\(/g, "\\("), "g")) ?? []).length,
    1,
    "the writer must be called exactly once",
  );
  assert.ok(
    ACTIONS_FLAT.includes(`import { ${WRITER_NAME} } ` + "fr" + `om "${WRITER_SPECIFIER}";`),
    "the writer is not imported by its exact name from its exact module",
  );
  // No Prisma, no core, no capability, no notification and no push surface is
  // reachable from this module — so no lifecycle or authorization rule could have
  // been copied into it.
  for (const forbidden of [
    PRISMA_MODULE,
    GENERATED_CLIENT,
    "prisma.",
    "examPlan.",
    "-core",
    "capabilit",
    "Capabilit",
    "notification",
    "Notification",
    "sendMessage",
  ]) {
    assert.equal(ACTIONS.includes(forbidden), false, `the module reaches ${forbidden}`);
  }
  // ...and the action copies no policy of its own: no status test, no lifecycle
  // constant, no admin-role comparison beyond the requireAdmin() call itself.
  for (const forbidden of [
    "ARCHIVED",
    "PLANNED",
    "ACTIVE",
    "SCHEDULE_DRAFT_CONFIGURATION",
    "SCHEDULE_PUBLICATION",
    "role ===",
    "isAdmin",
  ]) {
    assert.equal(PUBLICATION_ACTION.includes(forbidden), false, `the action restates ${forbidden}`);
  }
});

test("12. success revalidates this ONE exams path, and a NO_CHANGE revalidates nothing", () => {
  assert.equal((PUBLICATION_ACTION.match(/revalidatePath\(/g) ?? []).length, 1);
  assert.ok(PUBLICATION_ACTION.includes("revalidatePath(examsPath)"));
  // The single occurrence sits INSIDE the changed branch: the committed writer
  // issues no statement at all for a no-op, so a cache invalidation would be a lie
  // about what happened.
  assert.ok(
    squash(PUBLICATION_ACTION).includes(
      'if (result.ok) { if (result.status !== "NO_CHANGE") { revalidatePath(examsPath); }',
    ),
    "a NO_CHANGE publication must revalidate nothing",
  );
  for (const forbidden of ['revalidatePath("/', "revalidateTag", '"layout"', '"page"']) {
    assert.equal(PUBLICATION_ACTION.includes(forbidden), false, `the action uses ${forbidden}`);
  }
});

test("13. every redirect target is closed, and echoes NO id or submitted value", () => {
  const targets = [...PUBLICATION_ACTION.matchAll(/redirect\(([^;]+)\);/g)].map(([, t]) =>
    squash(t),
  );
  assert.deepEqual(targets, [
    "`${examsPath}?publication=unknown_operation`",
    "`${examsPath}?publication=${result.status}`",
    '"/admin/courses?error=invalid"',
    "`${examsPath}?publication=${encodeURIComponent(result.code)}`",
  ]);
  // The only dynamic values that reach a target are the writer's own compile-time
  // literals. No plan id, no offering id, no timestamp, no message, no raw error.
  for (const forbidden of [
    "${courseOfferingId}?",
    "planId",
    "publishedAt",
    "result.publishedAt",
    "error.message",
    "String(result",
    "JSON.stringify",
  ]) {
    assert.equal(PUBLICATION_ACTION.includes(forbidden), false, `${forbidden} reaches a URL`);
  }
  // The offering-not-found refusal leaves this course-scoped route entirely, and
  // does not reflect the requested id back.
  assert.ok(PUBLICATION_ACTION.includes('if (result.code === "offering_not_found") {'));
});

// ===========================================================================
// 14–17. The three UI states and the exact Hebrew
// ===========================================================================

test("14. a DRAFT plan shows the draft state and the PUBLISH form", () => {
  assert.ok(PAGE.includes(`const PUBLICATION_DRAFT_TEXT = "${DRAFT_TEXT}";`));
  assert.ok(PAGE.includes(`const PUBLISH_BUTTON_TEXT = "${PUBLISH_BUTTON}";`));
  // The publish form carries the PUBLISH literal, exactly once, as a hidden field.
  assert.ok(
    PAGE_FLAT.includes(
      '<form action={boundSetExamPlanPublicationAction} className="mt-4"> <input type="hidden" name="operation" value="PUBLISH" readOnly />',
    ),
    "the draft branch does not submit operation=PUBLISH",
  );
  assert.equal((PAGE.match(/value="PUBLISH"/g) ?? []).length, 1);
});

test("15. a PUBLISHED plan shows the published state, the warning and the UNPUBLISH form", () => {
  assert.ok(PAGE.includes(`const PUBLICATION_PUBLISHED_TEXT = "${PUBLISHED_TEXT}";`));
  assert.ok(PAGE.includes(`const UNPUBLISH_BUTTON_TEXT = "${UNPUBLISH_BUTTON}";`));
  assert.ok(PAGE.includes(`"${PUBLISHED_WARNING}"`), "the published warning is not the exact text");
  assert.ok(
    PAGE_FLAT.includes(
      '<form action={boundSetExamPlanPublicationAction} className="mt-4"> <input type="hidden" name="operation" value="UNPUBLISH" readOnly />',
    ),
    "the published branch does not submit operation=UNPUBLISH",
  );
  assert.equal((PAGE.match(/value="UNPUBLISH"/g) ?? []).length, 1);
  // The two forms are MUTUALLY EXCLUSIVE by the STORED state, never by the query:
  // `isPublished` comes from the committed reader's `publishedAt` and from nothing
  // else, and the branch is a single ternary over it.
  assert.ok(PAGE.includes("const isPublished = view.publishedAt !== null;"));
  assert.ok(
    PAGE_FLAT.includes("{mayConfigure ? ( isPublished ? ( <form"),
    "the two forms are not mutually exclusive by the stored publication state",
  );
  assert.equal(
    /isPublished\s*=\s*[^;]*(query|searchParams|publication\b)/.test(PAGE),
    false,
    "the publication state is derived from the query",
  );
});

test("16. the warning BLOCKS nothing — every existing edit affordance is untouched", () => {
  // Informational only. The definition and session create forms are still gated on
  // the lifecycle policy alone, and `isPublished` still only adds an advisory.
  assert.ok(PAGE.includes("const showCreateForm = view.planExists && mayConfigure;"));
  assert.ok(
    PAGE_FLAT.includes(
      "const showSessionCreateForm = sessionView.planExists && view.definitions.length > 0 && mayConfigure;",
    ),
    "the session create gate changed",
  );
  // No affordance anywhere on the page is disabled BY publication.
  for (const forbidden of [
    "!isPublished &&",
    "isPublished &&",
    "&& !isPublished",
    "mayConfigure && !isPublished",
  ]) {
    assert.equal(PAGE.includes(forbidden), false, `publication gates an affordance: ${forbidden}`);
  }
});

test("17. NO plan means NO publication button, and one fixed sentence instead", () => {
  assert.ok(PAGE.includes(`const NO_PLAN_PUBLICATION_TEXT = "${NO_PLAN_TEXT}";`));
  // The sentence lives in the no-plan branch; the card — and therefore both forms
  // and both hidden fields — lives in the plan-EXISTING branch, after it. The
  // window is taken from the FLATTENED source so line endings and indentation
  // cannot silently make this assertion vacuous.
  const noPlanBranch = PAGE_FLAT.indexOf("{!view.planExists ? (");
  const planBranch = PAGE_FLAT.indexOf("</div> ) : ( <>", noPlanBranch);
  assert.ok(noPlanBranch > -1, "the no-plan branch was not found");
  assert.ok(planBranch > noPlanBranch, "the plan-existing branch was not found");
  const noPlanMarkup = PAGE_FLAT.slice(noPlanBranch, planBranch);
  assert.ok(noPlanMarkup.includes("NO_PLAN_PUBLICATION_TEXT"));
  for (const forbidden of [
    "boundSetExamPlanPublicationAction",
    'name="operation"',
    "PUBLISH_BUTTON_TEXT",
    "UNPUBLISH_BUTTON_TEXT",
  ]) {
    assert.equal(
      noPlanMarkup.includes(forbidden),
      false,
      `the no-plan branch offers a publication control: ${forbidden}`,
    );
  }
});

test("18. the publication controls sit behind the SAME single lifecycle evaluation", () => {
  // ONE evaluation still serves every affordance on this page, and the publication
  // forms are behind it — so an ARCHIVED offering, or any status the default-deny
  // policy does not recognize, keeps a readable STATUS and gains no control. Each
  // server binding re-evaluates the same gate and refuses on its own, so this is a
  // display decision and never the enforcement.
  assert.equal((PAGE.match(/evaluateCourseOperationPolicy\(/g) ?? []).length, 1);
  assert.ok(PAGE_FLAT.includes("{mayConfigure ? ( isPublished ? ( <form"));
  // The STATUS text is NOT behind the gate: an archived plan still says which it
  // is. Proven by POSITION in the flattened source — the status renders before the
  // gate opens — so a future edit that moved it inside would fail here.
  const statusAt = PAGE_FLAT.indexOf("PUBLICATION_PUBLISHED_TEXT : PUBLICATION_DRAFT_TEXT");
  const gateAt = PAGE_FLAT.indexOf("{mayConfigure ? ( isPublished ? ( <form");
  assert.ok(statusAt > -1, "the status text is missing");
  assert.ok(gateAt > -1, "the gated publication forms are missing");
  assert.ok(statusAt < gateAt, "the status text must render regardless of the write gate");
  // The WARNING is likewise outside the gate: an archived published plan still
  // tells the manager that trainees can see the board.
  assert.ok(
    PAGE_FLAT.indexOf("{PUBLISHED_WARNING_TEXT}") < gateAt,
    "the warning must render regardless of the write gate",
  );
});

// ===========================================================================
// 19–21. The closed message table
// ===========================================================================

test("19. the outcome table is FROZEN, closed, and owns EXACTLY the seven sentences", () => {
  const start = PAGE.indexOf("const EXAM_PUBLICATION_MESSAGES");
  assert.ok(start > -1, "the closed publication table must exist");
  assert.ok(PAGE.slice(start, start + 120).includes("Object.freeze({"), "the table is not frozen");
  const table = PAGE.slice(start, PAGE.indexOf("});", start));
  const codes = [...table.matchAll(/^\s{2}(\w+):/gm)].map(([, code]) => code).sort();
  assert.deepEqual(
    codes,
    [...SUCCESS_TEXTS, ...FAILURE_TEXTS].map(([code]) => code).sort(),
    "the table's code set is not the approved one",
  );
  // `offering_not_found` is deliberately absent: it never returns to this route.
  assert.equal(table.includes("offering_not_found"), false);
});

test("20. every approved Hebrew sentence is present, verbatim, with its tone", () => {
  for (const [code, text] of SUCCESS_TEXTS) {
    assert.ok(
      new RegExp(`${code}: \\{ tone: "(success|neutral)", message: "${text}" \\}`).test(
        squash(PAGE).replace(/\s+/g, " "),
      ) || squash(PAGE).includes(`${code}: { tone: "success", message: "${text}" }`) ||
        squash(PAGE).includes(`${code}: { tone: "neutral", message: "${text}" }`),
      `the success sentence for ${code} is not the approved wording`,
    );
  }
  for (const [code, text] of FAILURE_TEXTS) {
    assert.ok(squash(PAGE).includes(`"${text}"`), `the failure sentence for ${code} is missing`);
    assert.ok(squash(PAGE).includes(`${code}: {`), `the failure code ${code} has no entry`);
  }
  // NO raw code and NO raw error is ever rendered: the query can SELECT a sentence
  // and can never supply one.
  for (const forbidden of ["{publication}", "{query.publication}", "{result.code}"]) {
    assert.equal(PAGE.includes(forbidden), false, `the page echoes ${forbidden}`);
  }
});

test("21. the parser is CLOSED in both directions and never echoes the query", () => {
  assert.ok(
    PAGE_FLAT.includes(
      'if (typeof raw !== "string" || raw.length === 0) { return null; } return Object.hasOwn(EXAM_PUBLICATION_MESSAGES, raw) ? EXAM_PUBLICATION_MESSAGES[raw] : null;',
    ),
    "the publication parser is not closed in both directions",
  );
  // `Object.hasOwn` rather than a plain lookup, so an inherited property name such
  // as `constructor` cannot select a message; the `typeof` test is what stops a
  // repeated key — which arrives as an ARRAY — coercing its way to a match.
  assert.ok(PAGE.includes("Object.hasOwn(EXAM_PUBLICATION_MESSAGES, raw)"));
  // The token is FEEDBACK and never SCOPE: it is destructured from the ONE resolved
  // query, and nothing but a banner reads it.
  assert.equal(PAGE.split("await searchParams").length - 1, 1);
  assert.ok(PAGE.includes("const { publication } = query;"));
  // The raw token is read EXACTLY ONCE, and only to hand it to the closed parser.
  // RE-POINTED by EX-ADMIN-WORKSPACE-UX, and NARROWED to the claim it always
  // made. The bare word now also names one of the four workspace SECTIONS — a
  // closed arrangement token that selects which markup renders and reads nothing —
  // so the count is taken over the QUERY token's own two uses instead: the
  // destructuring, and the hand-off to the closed parser.
  assert.equal((PAGE.match(/\bpublication\b(?!Feedback|\?|")/g) ?? []).length, 2);
  assert.ok(PAGE.includes('activeTab === "publication"'), "the section token is a literal");
  assert.ok(PAGE.includes("const publicationFeedback = publicationFeedbackFrom(publication);"));
  // ...and the parsed result reaches EXACTLY ONE banner: a null check, a tone
  // class and a message, and nothing else. No affordance, no read and no scope.
  assert.ok(
    PAGE_FLAT.includes(
      "{publicationFeedback !== null ? ( <div className={FEEDBACK_CLASS[publicationFeedback.tone]}> {publicationFeedback.message} </div> ) : null}",
    ),
    "the parsed feedback must reach exactly one banner",
  );
  assert.equal((PAGE.match(/publicationFeedback\./g) ?? []).length, 2);
});

// ===========================================================================
// 22–24. What this slice deliberately does NOT add
// ===========================================================================

test("22. no notification, history, per-session publication or validation was added", () => {
  // The MVP flips one plan-level column. Every one of these is a product rule with
  // its own edge cases, and a half-implemented one that silently passed would read
  // as enforcement to the next person who edits these files.
  for (const [label, source] of [
    ["actions", ACTIONS],
    ["page", PAGE],
  ] as const) {
    for (const forbidden of [
      "individualPublishedAt",
      "publicationHistory",
      "PublicationHistory",
      "notify",
      "Notification",
      "webpush",
      "supervisor",
      "Supervisor",
      "duplicate",
      "Duplicate",
      "completeness",
    ]) {
      assert.equal(source.includes(forbidden), false, `${label} reaches ${forbidden}`);
    }
  }
  // RE-POINTED by EX-PAIR-UI-MVP, and NARROWED to the PUBLICATION surface rather
  // than dropped. The two pairing tokens left the module-wide list because the
  // route now legitimately holds a separately reviewed pairing endpoint of its
  // own. What this guard has always protected is that PUBLISHING validates
  // nothing and drags nothing along with it — so the ban is re-pointed onto the
  // publication ACTION body and the publication CARD, where a pairing check would
  // actually be a readiness gate. Both are still exact.
  for (const forbidden of ["pairing", "Pairing"]) {
    assert.equal(
      PUBLICATION_ACTION.includes(forbidden),
      false,
      `the publication action reaches ${forbidden}`,
    );
  }
  // The LAST occurrence is the CARD heading; the first is the constant table this
  // module owns, which legitimately spells every sentence it may render.
  // RE-POINTED by EX-ADMIN-WORKSPACE-UX: the card moved into its own section, so
  // the slice runs from its heading to the END of that section rather than to the
  // definitions list, which now precedes it in source order.
  const publicationCard = PAGE.slice(
    PAGE.lastIndexOf("פרסום לוח המבחנים"),
    PAGE.indexOf("<div>", PAGE.lastIndexOf("פרסום לוח המבחנים")),
  );
  assert.ok(publicationCard.length > 0, "the publication card is missing");
  for (const forbidden of ["pairing", "Pairing"]) {
    assert.equal(
      publicationCard.includes(forbidden),
      false,
      `the publication card reaches ${forbidden}`,
    );
  }
});

test("23. no GET can publish, and no client code came with the control", () => {
  // Both publication forms are POST-ing forms on a Server Action. There is no
  // href, no effect, no auto-submit and no client fetch anywhere on this page.
  // RE-POINTED by EX-ADMIN-WORKSPACE-UX: the workspace is selected by a query
  // token, so the page gained one link per section and one per schedule
  // arrangement. The inventory is EXACT and every entry carries a CLOSED token
  // and NO id, so no navigation on this page can name a session, an assignment
  // or a definition.
  const hrefs = [...new Set((PAGE.match(/href=\{.*$/gm) ?? []).map((line) => line.trim()))].sort();
  assert.deepEqual(
    hrefs,
    [
      // RE-POINTED by EX-ADMIN-UX-FIXES, and still an EXACT inventory. The two
      // grouped views gained one compact SUB-TAB link per group, and the
      // assignments workspace gained one disclosure link that opens the create
      // form from the top. Both carry CLOSED tokens only: the sub-tab carries an
      // ORDINAL into the list on screen, and the disclosure carries the literal
      // `1`. Neither can name a session, an assignment, a definition or a trainee.
      "href={",
      "href={`${examsPath}?${viewQuery}&group=${index}`}",
      "href={`${examsPath}?tab=${activeTab}&view=${token}`}",
      "href={`${examsPath}?tab=${token}`}",
      "href={dashboardHref}",
    ],
    "a link that is neither the back link nor a closed workspace link exists",
  );

  for (const forbidden of [
    '"use client"',
    "useEffect",
    "useState",
    "useTransition",
    "useFormStatus",
    "onClick",
    "onSubmit",
    "onChange",
    "fetch(",
    "method=",
    "formAction",
  ]) {
    assert.equal(PAGE.includes(forbidden), false, `the page contains ${forbidden}`);
  }
  // ...and the page still performs no write of its own: only the bound actions do.
  assert.equal(PAGE.includes(WRITER_CALL), false, "the page reaches the writer directly");
});

test("24. the slice touched EXACTLY its approved paths, and no schema or migration", () => {
  // Worktree, index and untracked together, so this describes the SLICE rather
  // than one moment in its lifecycle.
  const touched = new Set([
    ...gitLines(["diff", "--name-only", "HEAD"]),
    ...gitLines(["diff", "--name-only", "--cached", "HEAD"]),
    ...gitLines(["ls-files", "--others", "--exclude-standard"]),
  ]);
  const offenders = [...touched].filter((path) => !SLICE_PATHS.includes(path)).sort();
  assert.deepEqual(offenders, [], `an unapproved path was touched: ${offenders.join(", ")}`);
  // RE-POINTED by EX-PAIR-UI-MVP, and GROWN by an EXACT PAIR rather than relaxed.
  // Two route-local PRODUCTION files remain the only ones this SUITE's own slice
  // may modify. The pairing UI travelling in the same working tree additionally
  // edits the committed ADMIN ASSIGNMENT READ pair — it cannot display a stored
  // pairing without reading the index behind it — so those two `lib/` modules
  // join this list BY NAME. A FIFTH production file, of any kind, still fails
  // here, and no writer, policy core, auth module or session module may appear.
  // RE-POINTED by EX-ADMIN-WORKSPACE-UX, and GROWN by an EXACT set rather than
  // relaxed. The workspace adds THREE route-local production files — the examinee
  // edit card, the closed workspace message module and the PURE workspace view
  // module — and TWO `lib/` modules, both of them NEW: the pure edit/move core and
  // its server-only binding. No committed `lib/` production module was modified by
  // it, and no writer, policy core, auth module or session module appears here.
  const production = SLICE_PATHS.filter((path) => !path.endsWith(".test.ts")).sort();
  assert.deepEqual(production, [
    // EX-ASG-MULTIPLICITY + EX-PAIR-NO-SELF - restated as EXACT sorted literals, de-duplicated. The comparison
    // is against the sorted non-test SLICE_PATHS, so this list is the whole
    // approved production footprint; a file outside it still fails.
    "app/admin/courses/[courseOfferingId]/exams/CreateExamInstructedTraineeAssignment" + "Form.tsx",
    "app/admin/courses/[courseOfferingId]/exams/EditExamAssignmentCard.tsx",
    "app/admin/courses/[courseOfferingId]/exams/actions.ts",
    "app/admin/courses/[courseOfferingId]/exams/exam-instructed-trainee-assignment" + "-messages.ts",
    "app/admin/courses/[courseOfferingId]/exams/exam-workspace" + "-messages.ts",
    "app/admin/courses/[courseOfferingId]/exams/exam-workspace-view.ts",
    "app/admin/courses/[courseOfferingId]/exams/page.tsx",
    "lib/actions/admin-exam-source-date" + "-io.ts",
    "lib/actions/admin-exam-workspace-edit" + "-io.ts",
    "lib/actions/detailed-exam-assignment-write" + "-io.ts",
    "lib/actions/exam-assignment-read" + "-io.ts",
    "lib/actions/exam-assignment-write" + "-io.ts",
    "lib/actions/exam-instructed-trainee-assignment-write" + "-io.ts",
    "lib/actions/exam-pairing-write" + "-io.ts",
    "lib/actions/exam-role-readers.ts",
    "lib/exam/admin-exam-assignment-read" + "-core.ts",
    "lib/exam/admin-exam-examinee-pairing" + "-core.ts",
    "lib/exam/admin-exam-source-date" + "-core.ts",
    "lib/exam/admin-exam-wave-view" + "-core.ts",
    "lib/exam/admin-exam-workspace-edit" + "-core.ts",
    "lib/exam/create-exam-instructed-trainee-assignment" + "-core.ts",
    "lib/exam/exam-conflict" + "-core.ts",
    "lib/exam/exam-pairing-write" + "-core.ts",
    "prisma/migrations/20260802120000_scope_exam_assignment_unique_to_examinee/migration.sql",
    "prisma/schema.prisma",
  ].sort());
  // No schema, no migration, and no auth, session, cookie, capability or
  // service-worker file — in ANY state.
  // EX-ASG-MULTIPLICITY + EX-PAIR-NO-SELF - the prisma/ working tree is the ONE approved schema change and its ONE
  // hand-written migration, snapshotted EXACTLY. Any other prisma entry still fails.
  // EX-ASG-MULTIPLICITY + EX-PAIR-NO-SELF - LIFECYCLE-PROOF. This was a `git status --porcelain` snapshot, whose
  // XY status prefix CHANGES on staging (" M path" -> "M  path", "?? dir/" ->
  // "A  dir/file"), so hardcoded literals broke the moment the branch was staged.
  // The three-way union reports PLAIN PATHS with no status prefix, so it is
  // identical in every lifecycle state. The expectation is still an EXACT two-path
  // list: any other prisma/ change still fails.
  // DE-DUPLICATED: once staged, the unstaged and staged diffs BOTH report the
  // same path, so the union must be a Set or the expectation doubles.
  const prismaStatus = [
    ...new Set([
      ...gitLines(["diff", "--name-only", "HEAD", "--", "prisma"]),
      ...gitLines(["diff", "--name-only", "--cached", "HEAD", "--", "prisma"]),
      ...gitLines(["ls-files", "--others", "--exclude-standard", "--", "prisma"]),
    ]),
  ].sort();
  assert.deepEqual(prismaStatus, [
    "prisma/migrations/20260802120000_scope_exam_assignment_unique_to_examinee/migration.sql",
    "prisma/schema.prisma",
  ]);
  for (const tree of [
    ["app", "instructor"].join("/"),
    ["app", "student"].join("/"),
    ["lib", "auth"].join("/"),
    ["lib", "session"].join("/"),
    ["lib", "capability"].join("/"),
    "middleware.ts",
    "package.json",
    ".mcp.json",
  ]) {
    // EX-ASG-MULTIPLICITY + EX-PAIR-NO-SELF - the ONE trainee-tree entry is a GUARD SUITE whose admin-footprint
    // snapshot this branch re-points; it is NOT a trainee UI file. Named EXACTLY,
    // so any other app/student or app/instructor change still fails.
    const APPROVED_TREE_ENTRIES: Record<string, readonly string[]> = {
      "app/student": [
        "M app/student/trainee-teaching-practice-home-shortcut" + ".contract.test.ts",
      ],
    };
    assert.deepEqual(
      gitLines(["status", "--porcelain", "--", tree]),
      APPROVED_TREE_ENTRIES[tree] ?? [],
      `${tree} changed`,
    );
  }
});

test("25. this suite opens no database and reads no environment", () => {
  const own = stripComments(readSource(SUITE_REL));
  for (const token of [
    "DATABASE" + "_URL",
    "process" + ".env",
    "Prisma" + "Client",
    "create" + "Client",
    "supa" + "base",
  ]) {
    assert.equal(own.includes(token), false, `the suite references ${token}`);
  }
  const specifiers = [...own.matchAll(/from\s+"([^"]+)"/g)].map(([, s]) => s);
  assert.deepEqual([...new Set(specifiers)].sort(), [
    "node:assert/strict",
    "node:child_process",
    "node:fs",
    "node:path",
    "node:test",
  ]);
});
