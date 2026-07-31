import test from "node:test";
import assert from "node:assert/strict";

/**
 * EXAM EX-PAIR-UI-MVP — the contract of the manager-facing PAIRING control that
 * links ONE instructed trainee to ONE examinee of the SAME exam session, on the
 * course-scoped admin exams route.
 *
 * Run (the bracketed route segment is a GLOB to node:test, so the `[` must be
 * escaped as `[[]` or the file silently matches nothing and zero tests run):
 *   npx tsx --test "app/admin/courses/[[]courseOfferingId]/exams/exam-pairing-ui.contract.test.ts"
 *
 * ===========================================================================
 * WHY SO MANY TOKENS IN THIS FILE ARE ASSEMBLED FROM PIECES
 * ===========================================================================
 * Several committed guards sweep every file under `app/`, `lib/`, `components/`
 * and `scripts/` for a module name or a CALL SHAPE and pin the result to an exact
 * caller list. Two matter here: the committed pairing write binding's, which this
 * slice re-points from ZERO callers to exactly one Server Action module, and the
 * committed admin assignment read pair's, which stays pinned at exactly one page.
 *
 * A CONTRACT SUITE IS NOT A CALLER. This file asserts things ABOUT those modules;
 * it never invokes one. But those guards match RAW SOURCE TEXT — not imports, not
 * an AST — so a suite that spelled a module name or a public call whole anywhere
 * in its source (INCLUDING in a comment such as this one) would enrol itself in
 * the very allow-lists it exists to keep narrow. The only way to make that pass
 * would be to widen them, which is exactly backwards. This paragraph therefore
 * describes those tokens rather than reproducing them.
 *
 * So every such token below is built by concatenation. The value compared against
 * the production source is identical; only the literal spelling in THIS file
 * differs. That is the project's split-literal convention, and it is load-bearing
 * rather than cosmetic.
 *
 * ===========================================================================
 * WHAT THIS SUITE PROVES, AND WHAT IT DELIBERATELY DOES NOT
 * ===========================================================================
 * It proves the SHAPE of the tenth endpoint and its one inline form: the exact
 * TWO-field FormData budget, the absent session id, plan id, pairing index,
 * participant id, timestamp and actor id, the server-bound offering, the
 * authorization order, the closed result mapping onto an exact Hebrew table, and
 * the rendering rules — a control for INSTRUCTED_TRAINEE rows and no other role,
 * options drawn from THIS session's examinee bucket and no other, the current
 * partner pre-selected from the committed reader's own resolved answer, an
 * explicit unpair option, and the lifecycle gate every other affordance here uses.
 *
 * It also proves the ONE admin-read extension the control needs: the published
 * assignment row gained the ANSWER (a partner assignment id and a display name)
 * and did NOT gain the internal allocation index behind it.
 *
 * It does NOT re-prove the committed pairing writer. Which roles may be paired,
 * that both rows must share one session, when an index is reused and when one is
 * allocated, that an ambiguous index fails closed, that a no-op writes nothing
 * and that a zero write count is a stale write are all that backend's own
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
const SUITE_REL = join(ROUTE_DIR_REL, "exam-pairing-ui.contract.test.ts");

/** The committed pure read core this slice extends — path ASSEMBLED. */
const READ_CORE_REL = join("lib", "exam", "admin-exam-assignment" + "-read-core.ts");

/** The one endpoint this slice adds. */
const ACTION_NAME = "setExamPairingAction";
/** The committed binding it calls, and that binding's module — both assembled. */
const WRITER_NAME = "set" + "ExamInstructedTraineePairing";
const WRITER_SPECIFIER = "@/lib/actions/" + "exam-pairing-write" + "-io";
/** The call shape the committed caller guard sweeps for, likewise assembled. */
const WRITER_CALL = WRITER_NAME + "(";

const PRISMA_MODULE = "@/lib/" + "prisma";
const GENERATED_CLIENT = "@/app/" + "generated/prisma/client";

/** The two FormData names this endpoint may read, and no third. */
const FIELDS = ["instructedTraineeAssignmentId", "examineeAssignmentId"] as const;

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
const READ_CORE = stripComments(readSource(READ_CORE_REL));
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

const PAIRING_ACTION = bodyOf(ACTION_NAME);

function gitLines(args: readonly string[]): string[] {
  const result = spawnSync("git", [...args], { cwd: REPO_ROOT, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
}

/**
 * The EXACT approved footprint of this slice: two route production files, two
 * `lib/` production files of the admin READ pair it extends, one new suite, and
 * the guard suites whose counts or caller lists it re-points.
 *
 * The `lib/` entries are ASSEMBLED for the reason in the header — those are the
 * suites whose own sweeps this file must stay out of.
 */
const SLICE_PATHS = [
  ROUTE_DIR_PREFIX + "actions.ts",
  ROUTE_DIR_PREFIX + "page.tsx",
  ROUTE_DIR_PREFIX + "exam-pairing-ui.contract.test.ts",
  ROUTE_DIR_PREFIX + "exam-plan-create.contract.test.ts",
  ROUTE_DIR_PREFIX + "exam-definitions-page.contract.test.ts",
  ROUTE_DIR_PREFIX + "exam-definition-create.contract.test.ts",
  ROUTE_DIR_PREFIX + "exam-session-create.contract.test.ts",
  ROUTE_DIR_PREFIX + "exam-session-edit-delete.contract.test.ts",
  ROUTE_DIR_PREFIX + "exam-assignment-ui.contract.test.ts",
  ROUTE_DIR_PREFIX + "exam-instructed-trainee-assignment-ui.contract.test.ts",
  ROUTE_DIR_PREFIX + "exam-publication-ui.contract.test.ts",
  // The TWO `lib/` PRODUCTION modules this slice edits, and no third: the admin
  // assignment read pair, which must publish the resolved partner for the control
  // to pre-select one. Both are ASSEMBLED.
  "lib/exam/" + "admin-exam-assignment-read" + "-core.ts",
  "lib/actions/" + "exam-assignment-read" + "-io.ts",
  // The committed guard suites this slice re-points. Every entry ends in
  // `.test.ts`, which the assertion below re-checks rather than trusting this
  // list to stay honest on its own.
  "lib/exam/" + "admin-exam-assignment-read" + "-core.test.ts",
  "lib/actions/" + "exam-assignment-read" + "-io.test.ts",
  "lib/actions/" + "exam-pairing-write" + "-io.test.ts",
  "lib/actions/" + "exam-publication-write" + "-io.test.ts",
  "lib/actions/" + "admin-exam-session-read" + "-io.test.ts",
  "lib/actions/" + "exam-assignment-write" + "-io.test.ts",
  "lib/actions/" + "exam-definition-read" + "-io.test.ts",
  "lib/actions/" + "exam-instructed-trainee-assignment-write" + "-io.test.ts",
  "lib/actions/" + "exam-plan-write" + "-io.test.ts",
  "lib/actions/" + "exam-session-write" + "-io.test.ts",
  "lib/actions/" + "detailed-exam-assignment-write" + "-io.test.ts",
  "lib/exam/" + "exam-supervisor-write" + "-core.test.ts",
  "lib/exam/" + "create-exam-plan" + "-core.test.ts",
  "lib/actions/" + "exam-supervisor-read" + "-io.test.ts",
  "lib/actions/" + "exam-supervisor-write" + "-io.test.ts",
  "lib/actions/" + "trainee-exam-schedule.contract" + ".test.ts",
  "lib/actions/" + "instructor-exam-schedule.contract" + ".test.ts",
  "lib/exam/" + "exam-read.contract" + ".test.ts",
];

/** The route's EXACT final file set, after this slice's ONE addition. */
const FINAL_ROUTE_FILES = [
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
  "app/admin/courses/[courseOfferingId]/exams/exam-pairing-ui.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-plan-create.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-publication-ui.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-session-create-error-messages.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-session-create.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-session-edit-delete.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/page.tsx",
];

/** The EXACT approved Hebrew, token by token. Nothing else may be shown. */
const SUCCESS_TEXTS: ReadonlyArray<readonly [string, string]> = [
  ["PAIRED", "השיוך לנבחן/ת נשמר."],
  ["UNPAIRED", "השיוך לנבחן/ת הוסר."],
  ["NO_CHANGE", "לא בוצע שינוי בשיוך."],
];
const FAILURE_TEXTS: ReadonlyArray<readonly [string, string]> = [
  ["plan_not_found", "לא קיימת תוכנית מבחנים לקורס זה, ולכן אין מה לשייך. יש לרענן את הדף."],
  ["operation_not_allowed", "לא ניתן לשנות שיוכים במצב הנוכחי של הקורס."],
  ["invalid_input", "בקשת השיוך אינה תקינה. יש לרענן את הדף ולנסות שוב."],
  [
    "instructed_assignment_not_found",
    "החניך המודרך שנבחר אינו קיים עוד בתוכנית המבחנים של קורס זה. יש לרענן את הדף.",
  ],
  [
    "examinee_assignment_not_found",
    "הנבחן/ת שנבחר/ה אינו/ה קיים/ת עוד בתוכנית המבחנים של קורס זה. יש לרענן את הדף.",
  ],
  ["instructed_role_mismatch", "לא ניתן לשייך: השיבוץ שנשלח אינו של חניך מודרך. יש לרענן את הדף."],
  ["examinee_role_mismatch", "לא ניתן לשייך: השיבוץ שנבחר אינו של נבחן/ת. יש לרענן את הדף."],
  ["different_sessions", "ניתן לשייך רק לנבחן/ת מאותו מפגש מבחן. יש לרענן את הדף ולבחור שוב."],
  [
    "ambiguous_pairing_index",
    "לא ניתן לקבוע את השיוך: קיימים שיוכים כפולים במפגש הזה. יש לתקן את השיבוצים.",
  ],
  ["stale_write", "השיוך השתנה מאז שהדף נטען, ולכן לא נשמר. יש לרענן את הדף ולנסות שוב."],
];

const SECTION_LABEL = "שיוך לנבחן/ת";
const NONE_OPTION_TEXT = "ללא שיוך";
const SUBMIT_TEXT = "שמירת שיוך";
const UNPAIRED_TEXT = "אין שיוך לנבחן/ת.";
const NO_EXAMINEES_TEXT = "אין נבחנים במפגש הזה, ולכן אין למי לשייך.";

// ===========================================================================
// 1–3. The endpoint exists, exactly once, in exactly the approved place
// ===========================================================================

test("1. the slice adds ONE file and creates no new route or component", () => {
  for (const rel of [ACTIONS_REL, PAGE_REL, SUITE_REL]) {
    assert.ok(existsSync(join(REPO_ROOT, rel)), `${rel} is missing`);
  }
  // No second exams route in any role area, and no pairing route of its own.
  for (const dir of [
    join("app", "admin", "exams"),
    join("app", "instructor", "exams"),
    join("app", "student", "exams"),
    join(ROUTE_DIR_REL, "pairing"),
    join(ROUTE_DIR_REL, "pairings"),
  ]) {
    assert.equal(existsSync(join(REPO_ROOT, dir)), false, `${dir} was created`);
  }
  // The pairing control is INLINE, so no component file came with it either.
  for (const file of [
    join(ROUTE_DIR_REL, "ExamPairingForm.tsx"),
    join(ROUTE_DIR_REL, "SetExamPairingForm.tsx"),
    join(ROUTE_DIR_REL, "exam-pairing-messages.ts"),
  ]) {
    assert.equal(existsSync(join(REPO_ROOT, file)), false, `${file} was created`);
  }
});

test("2. the route directory holds EXACTLY the twenty-three approved files", () => {
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
  assert.equal(routeFiles.length, 23);
});

test("3. the action module exports EXACTLY TEN actions, this slice's appended TENTH", () => {
  const firstStatement = ACTIONS_SOURCE.split("\n").find((line) => line.trim().length > 0);
  assert.equal(firstStatement?.trim(), '"use server";');
  // Everything exported from a "use server" module is a public network endpoint,
  // so the export list is the attack surface: nothing but the ten actions leaves
  // this file, and the tenth is the one this slice adds.
  const exported = [...ACTIONS_SOURCE.matchAll(/export (?:async )?function (\w+)\(/g)].map(
    ([, name]) => name,
  );
  assert.equal(exported.length, 10, "no eleventh endpoint may exist in this module");
  assert.equal(exported[9], ACTION_NAME, "the pairing action must be appended LAST");
  assert.equal(exported.filter((name) => name === ACTION_NAME).length, 1);
  for (const token of ["export const", "export default", "export {", "export type"]) {
    assert.equal(ACTIONS.includes(token), false, `the module also declares ${token}`);
  }
  // ...and there is no SECOND pairing endpoint under any other name. In
  // particular UNPAIRING is not its own endpoint: it is the `null` value of the
  // committed writer's own third parameter, reached through this same action.
  for (const forbidden of [
    "pairExamTraineeAction",
    "unpairExamTraineeAction",
    "clearExamPairingAction",
    "setExamPairingIndexAction",
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
  // TWO parameters and no third: no session id, no plan id, no pairing index, no
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
  const awaits = [...PAIRING_ACTION.matchAll(/await\s+([\w.]+)\s*\(/g)].map(([, name]) => name);
  assert.ok(awaits.length >= 2, "the action awaits nothing");
  assert.equal(awaits[0], "requireAdmin", "authorization is not first");
  // Nothing is read from the submission before it resolves. The slice starts at
  // the declaration, so `formData: FormData` in the SIGNATURE is legitimately
  // present — what must not appear is a READ of it, or the writer.
  const beforeAuth = PAIRING_ACTION.slice(0, PAIRING_ACTION.indexOf("await requireAdmin()"));
  assert.equal(beforeAuth.includes("formData.get"), false, "the submission is read before auth");
  assert.equal(beforeAuth.includes(WRITER_CALL), false, "the writer runs before auth");
});

test("6. there is STILL no try/catch anywhere, so NEXT_REDIRECT always propagates", () => {
  for (const token of ["try {", "catch (", "catch(", "finally {"]) {
    assert.equal(ACTIONS.includes(token), false, `the module declares ${token}`);
  }
});

// ===========================================================================
// 7–9. The FormData budget, and the ONE exact unpair sentinel
// ===========================================================================

test("7. the action reads EXACTLY TWO fields, with the exact approved names", () => {
  const named = [...PAIRING_ACTION.matchAll(/formData\.get\("([^"]+)"\)/g)].map(([, n]) => n);
  assert.deepEqual(named, [...FIELDS]);
  assert.equal(
    (PAIRING_ACTION.match(/formData\./g) ?? []).length,
    2,
    "the submission is touched beyond the two approved reads",
  );
  for (const forbidden of [
    "formData.getAll",
    "formData.entries",
    "formData.forEach",
    "formData.keys",
    "formData.values",
    "formData.has",
  ]) {
    assert.equal(PAIRING_ACTION.includes(forbidden), false, `the action uses ${forbidden}`);
  }
});

test("8. NO scope, index, participant, timestamp or actor is ever read from the submission", () => {
  for (const forbidden of [
    "sessionId",
    "planId",
    "pairingIndex",
    "courseOfferingId\"",
    "studentId",
    "assignmentCount",
    "orderIndex",
    "expectedUpdatedAt",
    "updatedAt",
    "createdAt",
    "actorId",
    "instructorId",
    "traineeName",
    "role\"",
    "publishedAt",
  ]) {
    assert.equal(
      PAIRING_ACTION.includes(forbidden),
      false,
      `the action reads ${forbidden} from the request`,
    );
  }
  // The SESSION is the sharpest of those: this endpoint never states one, so it
  // cannot be talked into pairing across two of them. The backend derives it from
  // the instructed-trainee row it resolved server-side.
  assert.equal(
    (PAIRING_ACTION.match(/formData\.get\(/g) ?? []).length,
    FIELDS.length,
    "the FormData budget changed",
  );
});

test("9. the dedicated EMPTY value becomes null, and nothing is coerced", () => {
  // The sentinel is declared ONCE, as the empty string, and compared EXACTLY.
  assert.ok(
    ACTIONS.includes('const EXAM_PAIRING_NONE_VALUE = "";'),
    "the unpair sentinel is missing or is not the dedicated empty value",
  );
  assert.ok(
    squash(PAIRING_ACTION).includes("submittedExaminee === EXAM_PAIRING_NONE_VALUE ? null"),
    "the sentinel does not map to null",
  );
  // The instructed id fails CLOSED to the empty string, which no assignment has
  // and which the committed core refuses as invalid input before any query runs.
  assert.ok(
    squash(PAIRING_ACTION).includes(
      'typeof submittedInstructed === "string" ? submittedInstructed : ""',
    ),
    "the instructed id does not fail closed",
  );
  assert.ok(
    squash(PAIRING_ACTION).includes(
      'typeof submittedExaminee === "string" ? submittedExaminee : ""',
    ),
    "a non-string examinee value does not fail closed",
  );
  // NO coercion anywhere: a `File` from a multipart submission must never be
  // stringified into an id, and an absent field must never default to anything.
  // (Template interpolation is NOT on this list: the action legitimately builds
  // its own exams path from the BOUND offering id, which guard 10 pins exactly.)
  for (const forbidden of ["String(", "Number(", ".trim()", "??", ".toString()"]) {
    assert.equal(PAIRING_ACTION.includes(forbidden), false, `the action uses ${forbidden}`);
  }
  // ...and neither submitted value is interpolated into anything.
  for (const forbidden of ["${submittedInstructed", "${submittedExaminee"]) {
    assert.equal(PAIRING_ACTION.includes(forbidden), false, `the action interpolates ${forbidden}`);
  }
});

// ===========================================================================
// 10–13. The bound offering, the ONE writer, revalidation and the redirects
// ===========================================================================

test("10. the offering is the BOUND leading argument, never a submitted field", () => {
  assert.ok(
    PAIRING_ACTION.includes(
      "const examsPath = `/admin/courses/${encodeURIComponent(courseOfferingId)}/exams`;",
    ),
    "the path is not built from the bound id",
  );
  // The page binds it from the VERIFIED admin context, exactly once.
  assert.ok(
    PAGE.includes(`const boundSetExamPairingAction = ${ACTION_NAME}.bind(null, context.id);`),
    "the action is not bound to the verified offering id",
  );
  assert.equal(
    (PAGE.match(new RegExp(`${ACTION_NAME}\\.bind\\(`, "g")) ?? []).length,
    1,
    "the action is bound in more than one place",
  );
  assert.equal(
    PAGE.includes(`${ACTION_NAME}.bind(null, courseOfferingId)`),
    false,
    "the RAW route param was bound instead of the verified id",
  );
  // No hidden field carries a course, a plan or a session.
  for (const forbidden of [
    'name="courseOfferingId"',
    'name="planId"',
    'name="sessionId"',
    'name="pairingIndex"',
  ]) {
    assert.equal(PAGE.includes(forbidden), false, `the form submits ${forbidden}`);
  }
});

test("11. the action calls the committed pairing writer and NOTHING else", () => {
  assert.ok(ACTIONS.includes(WRITER_SPECIFIER), "the committed writer is not imported");
  assert.ok(PAIRING_ACTION.includes(WRITER_CALL), "the committed writer is not called");
  assert.equal(
    (PAIRING_ACTION.match(new RegExp(WRITER_NAME, "g")) ?? []).length,
    1,
    "the writer is called more than once",
  );
  // The THREE arguments, in the locked order, and no fourth.
  assert.ok(
    squash(PAIRING_ACTION).includes(
      `await ${WRITER_NAME}( courseOfferingId, instructedTraineeAssignmentId, examineeAssignmentId, );`,
    ),
    "the writer is not called with exactly the three locked arguments",
  );
  // NO Prisma, no transaction, no raw SQL and no second writer anywhere in the
  // module: this route binds operations, it does not perform them.
  for (const forbidden of [
    PRISMA_MODULE,
    GENERATED_CLIENT,
    "prisma.",
    "$transaction",
    "$executeRaw",
    "$queryRaw",
    "examAssignment",
  ]) {
    assert.equal(ACTIONS.includes(forbidden), false, `the module references ${forbidden}`);
  }
  // ...and none of the pairing RULES is restated here.
  for (const forbidden of [
    "EXAMINEE",
    "INSTRUCTED_TRAINEE",
    "resolveExamPairings",
    "ambiguous",
  ]) {
    assert.equal(PAIRING_ACTION.includes(forbidden), false, `the action restates ${forbidden}`);
  }
});

test("12. a real change revalidates this ONE exams path, and a NO_CHANGE revalidates nothing", () => {
  assert.ok(
    squash(PAIRING_ACTION).includes(
      'if (result.ok) { if (result.status !== "NO_CHANGE") { revalidatePath(examsPath); }',
    ),
    "the revalidation rule changed",
  );
  assert.equal(
    (PAIRING_ACTION.match(/revalidatePath\(/g) ?? []).length,
    1,
    "the action revalidates more than once",
  );
  assert.equal(
    PAIRING_ACTION.includes("revalidatePath(\"/"),
    false,
    "a literal path other than this offering's exams path is revalidated",
  );
});

test("13. every redirect target is CLOSED, and echoes NO id or submitted value", () => {
  // EXACTLY THREE redirects, and each is one of the three approved targets. The
  // targets are matched as whole statements rather than by a paren-counting
  // regex, which a nested `encodeURIComponent(...)` would defeat.
  assert.equal(
    (PAIRING_ACTION.match(/redirect\(/g) ?? []).length,
    3,
    "the redirect budget changed",
  );
  for (const target of [
    "redirect(`${examsPath}?pairing=${result.status}`);",
    'redirect("/admin/courses?error=invalid");',
    "redirect(`${examsPath}?pairing=${encodeURIComponent(result.code)}`);",
  ]) {
    assert.ok(PAIRING_ACTION.includes(target), `the redirect target changed: ${target}`);
  }
  // `result.status` and `result.code` are compile-time-known literals of the
  // committed writer's own closed unions. Nothing submitted, and no id of any
  // kind, reaches a URL.
  // Nothing submitted, and no id of any kind, is INTERPOLATED into a target.
  // (The local variable NAMES legitimately appear in the body — what must never
  // appear is a `${...}` that puts one of their values in a URL.)
  for (const forbidden of [
    "${instructedTraineeAssignmentId",
    "${examineeAssignmentId",
    "${submittedInstructed",
    "${submittedExaminee",
    "${result.pairingIndex",
    "result.pairingIndex",
  ]) {
    assert.equal(PAIRING_ACTION.includes(forbidden), false, `the redirect echoes ${forbidden}`);
  }
  // The ONLY dynamic values interpolated ANYWHERE in this action are the BOUND
  // offering id (in the exams path it builds), the path itself, and the writer's
  // own compile-time-known closed literals. A fourth still fails here.
  const interpolations = [...PAIRING_ACTION.matchAll(/\$\{([^}]+)\}/g)].map(([, e]) => e.trim());
  assert.deepEqual(
    [...new Set(interpolations)].sort(),
    [
      "encodeURIComponent(courseOfferingId)",
      "encodeURIComponent(result.code)",
      "examsPath",
      "result.status",
    ].sort(),
  );
  // The offering that did not resolve routes to the safe courses list, and the
  // requested id is not reflected back in that destination.
  assert.ok(PAIRING_ACTION.includes('if (result.code === "offering_not_found") {'));
});

// ===========================================================================
// 14–18. The rendered control
// ===========================================================================

test("14. the control renders for INSTRUCTED_TRAINEE rows and for NO other role", () => {
  assert.ok(
    PAGE.includes('{assignment.role === "INSTRUCTED_TRAINEE" ? ('),
    "the control is not gated on the row's role",
  );
  assert.equal(
    (PAGE.match(/name="instructedTraineeAssignmentId"/g) ?? []).length,
    1,
    "there is more than one pairing form on the page",
  );
  assert.equal(
    (PAGE.match(/name="examineeAssignmentId"/g) ?? []).length,
    1,
    "there is more than one examinee picker on the page",
  );
  // The list itself is UNCHANGED: every stored row of every role is still
  // rendered, so a session cannot look emptier than its own count says.
  assert.ok(PAGE.includes("sessionAssignments.map((assignment) => {"));
});

test("15. the options are THIS session's examinee bucket, built without a filter", () => {
  // The bucket is keyed by `sessionId` and filled in the SAME single pass that
  // fills the assignment list, so "only examinees of THIS session" is a property
  // of the DATA STRUCTURE rather than of a comparison somebody could delete.
  assert.ok(
    PAGE.includes("const examineesBySession = new Map<string, AdminExamAssignmentRow[]>();"),
  );
  assert.ok(PAGE.includes("for (const assignment of assignmentView.assignments) {"));
  assert.ok(PAGE.includes('if (assignment.role !== "EXAMINEE") {'));
  assert.ok(
    PAGE.includes("examineesBySession.get(session.sessionId) ?? NO_ASSIGNMENTS"),
    "the picker does not read this session's own bucket",
  );
  assert.ok(PAGE.includes("sessionExaminees.map((examinee) => ("));
  // The page still never sorts, filters, slices or reverses anything.
  for (const forbidden of [".sort(", ".reverse(", ".filter(", ".slice("]) {
    assert.equal(PAGE.includes(forbidden), false, `the page uses ${forbidden}`);
  }
});

test("16. the CURRENT partner is pre-selected from the READER, never from the query", () => {
  assert.ok(
    squash(PAGE).includes(
      "defaultValue={ assignment.pairedExamineeAssignmentId ?? EXAM_PAIRING_NONE_VALUE }",
    ),
    "the current pairing is not pre-selected from the reader's resolved answer",
  );
  // The displayed partner NAME comes from the same resolved answer, and an
  // unresolved pairing says so plainly instead of naming an arbitrary examinee.
  assert.ok(squash(PAGE).includes("{assignment.pairedExamineeName ?? PAIRING_UNPAIRED_TEXT}"));
  // NOTHING derives a pairing from the query string, from an array position or
  // from an index. `pairing` is a feedback token and nothing else.
  for (const forbidden of [
    "pairingIndex",
    "query.pairing ===",
    "pairing === \"PAIRED\"",
    "sessionExaminees[0]",
    "assignments[0]",
    "indexOf(",
  ]) {
    assert.equal(PAGE.includes(forbidden), false, `the page derives a pairing from ${forbidden}`);
  }
});

test("17. the UNPAIR option exists, carries the exact sentinel, and comes FIRST", () => {
  assert.ok(
    PAGE_FLAT.includes(
      "<option value={EXAM_PAIRING_NONE_VALUE}> {PAIRING_NONE_OPTION_TEXT} </option>",
    ),
    "the unpair option is missing or is not the dedicated empty value",
  );
  // ...and the constant it renders is this module's own fixed Hebrew.
  assert.ok(
    PAGE.includes(`const PAIRING_NONE_OPTION_TEXT = "${NONE_OPTION_TEXT}";`),
    "the unpair option's text changed",
  );
  assert.ok(PAGE.includes('const EXAM_PAIRING_NONE_VALUE = "";'));
  // The page's sentinel and the action's sentinel are the SAME literal. They are
  // declared separately because a `"use server"` module may export nothing but
  // its actions, so this is what keeps the two from drifting apart.
  assert.ok(ACTIONS.includes('const EXAM_PAIRING_NONE_VALUE = "";'));
  // The unpair option precedes every examinee option.
  const optionsStart = PAGE.indexOf("<option value={EXAM_PAIRING_NONE_VALUE}>");
  const examineeOption = PAGE.indexOf("value={examinee.assignmentId}");
  assert.ok(optionsStart > -1 && examineeOption > optionsStart, "the unpair option is not first");
  // A session with no examinee gets a SENTENCE rather than a picker offering
  // only "no partner", which would read as a control that does nothing.
  assert.ok(PAGE.includes(NO_EXAMINEES_TEXT));
  assert.ok(PAGE.includes("sessionExaminees.length > 0 ? ("));
});

test("18. the control sits behind the SAME lifecycle gate, and NOT behind publication", () => {
  // ONE lifecycle evaluation on the page, and this control reads its result like
  // every other affordance. The list above it stays readable either way.
  assert.ok(
    PAGE_FLAT.includes(
      'const mayConfigure = evaluateCourseOperationPolicy( context.status, "SCHEDULE_DRAFT_CONFIGURATION", ).allowed;',
    ),
    "the single lifecycle evaluation changed",
  );
  assert.equal(
    (PAGE.match(/evaluateCourseOperationPolicy\(/g) ?? []).length,
    1,
    "the page evaluates the lifecycle policy more than once",
  );
  const control = PAGE.slice(
    PAGE.indexOf('{assignment.role === "INSTRUCTED_TRAINEE" ? ('),
  );
  assert.ok(control.includes("{mayConfigure ? ("), "the control is not behind the write gate");
  // PUBLICATION IS NOT AUTHORIZATION. The control must not consult it: the
  // product rule is that a manager may still edit a published plan, and the
  // existing advisory is what says so.
  for (const forbidden of ["isPublished", "publishedAt", "view.publishedAt"]) {
    assert.equal(
      control.slice(0, control.indexOf("</li>")).includes(forbidden),
      false,
      `the pairing control consults ${forbidden}`,
    );
  }
});

// ===========================================================================
// 19–21. The closed Hebrew mapping, and what may never become text
// ===========================================================================

test("19. the outcome table is FROZEN, closed, and owns EXACTLY the thirteen sentences", () => {
  const start = PAGE.indexOf("const EXAM_PAIRING_MESSAGES");
  assert.ok(start > -1, "the pairing table is missing");
  assert.ok(PAGE.slice(start, start + 120).includes("Object.freeze({"), "the table is not frozen");
  const table = PAGE.slice(start, PAGE.indexOf("});", start));
  const codes = [...table.matchAll(/^\s{2}(\w+):/gm)].map(([, code]) => code);
  assert.deepEqual(codes, [
    ...SUCCESS_TEXTS.map(([code]) => code),
    ...FAILURE_TEXTS.map(([code]) => code),
  ]);
  // `offering_not_found` is deliberately absent: that refusal routes to the
  // courses list and never returns to this course-scoped route.
  assert.equal(table.includes("offering_not_found"), false);
});

test("20. every approved Hebrew sentence is present, verbatim, with its tone", () => {
  for (const [code, message] of SUCCESS_TEXTS) {
    assert.ok(PAGE.includes(message), `${code} has no sentence`);
  }
  for (const [code, message] of FAILURE_TEXTS) {
    assert.ok(PAGE.includes(message), `${code} has no sentence`);
  }
  const table = squash(PAGE.slice(PAGE.indexOf("const EXAM_PAIRING_MESSAGES")));
  for (const [code] of SUCCESS_TEXTS) {
    const tone = code === "NO_CHANGE" ? "neutral" : "success";
    assert.ok(
      table.includes(`${code}: { tone: "${tone}"`),
      `${code} does not carry the ${tone} tone`,
    );
  }
  for (const [code] of FAILURE_TEXTS) {
    assert.ok(
      table.slice(table.indexOf(`${code}: {`)).startsWith(`${code}: { tone: "error"`),
      `${code} does not carry the error tone`,
    );
  }
  // The control's own fixed Hebrew is present too.
  for (const text of [SECTION_LABEL, NONE_OPTION_TEXT, SUBMIT_TEXT, UNPAIRED_TEXT]) {
    assert.ok(PAGE.includes(text), `the control is missing "${text}"`);
  }
});

test("21. the parser is CLOSED in both directions and never echoes the query", () => {
  const parser = PAGE.slice(
    PAGE.indexOf("function pairingFeedbackFrom("),
    PAGE.indexOf("const EXAM_PAIRING_NONE_VALUE"),
  );
  assert.ok(parser.includes('typeof raw !== "string"'), "a repeated key would coerce to a match");
  assert.ok(parser.includes("raw.length === 0"), "an empty token is not rejected");
  assert.ok(
    parser.includes("Object.hasOwn(EXAM_PAIRING_MESSAGES, raw)"),
    "an inherited property name could select a message",
  );
  // Nothing from the query is ever interpolated: the parser can only SELECT a
  // constant sentence, never supply one.
  for (const forbidden of ["${raw", "+ raw", "raw}", "dangerouslySetInnerHTML"]) {
    assert.equal(parser.includes(forbidden), false, `the parser echoes ${forbidden}`);
  }
  // The token is FEEDBACK and never STATE: no read, no affordance and no
  // selection is derived from it.
  assert.ok(PAGE.includes("const pairingFeedback = pairingFeedbackFrom(pairing);"));
  // It reaches JSX EXACTLY twice — the banner's own guard and its sentence — so
  // it cannot be gating a form, a read, an option or a selection anywhere.
  assert.equal(
    (PAGE.match(/\{pairingFeedback/g) ?? []).length,
    2,
    "the pairing token influences something beyond its one banner",
  );
  assert.ok(
    PAGE_FLAT.includes(
      "{pairingFeedback !== null ? ( <div className={FEEDBACK_CLASS[pairingFeedback.tone]}> {pairingFeedback.message} </div> ) : null}",
    ),
    "the banner is not the token's only consumer",
  );
});

test("22. no raw id, index or personal detail becomes visible text", () => {
  // Both ids travel ONLY as submitted values — a hidden field and an option
  // value — and neither is ever rendered as a text node or placed in an href.
  assert.ok(PAGE.includes('value={assignment.assignmentId}'));
  assert.ok(PAGE.includes("value={examinee.assignmentId}"));
  assert.equal(
    PAGE.includes("{assignment.pairedExamineeAssignmentId}"),
    false,
    "a partner id is rendered as text",
  );
  // Every occurrence of an examinee's id is an ATTRIBUTE value — `value={...}`
  // or a React `key` — and never a JSX text node. A text node would be preceded
  // by `>` or followed by `<` once whitespace is collapsed.
  for (const forbidden of [
    "> {examinee.assignmentId}",
    "{examinee.assignmentId} <",
    ">{examinee.assignmentId}",
    "{examinee.assignmentId}<",
  ]) {
    assert.equal(PAGE_FLAT.includes(forbidden), false, "an id is rendered as text");
  }
  const idUses = (PAGE.match(/examinee\.assignmentId/g) ?? []).length;
  assert.equal(idUses, 2, "an examinee id is used beyond the React key and the option value");
  assert.ok(PAGE.includes("key={examinee.assignmentId}"));
  assert.equal(PAGE.includes("pairingIndex"), false, "the internal index reaches the page");
  for (const forbidden of [
    "identityNumber",
    "phone",
    "parentName",
    "parentPhone",
    "guardian",
    "subgroup",
    "enrollment",
    "assignment.studentId",
    "examinee.studentId",
  ]) {
    assert.equal(PAGE.includes(forbidden), false, `the page renders ${forbidden}`);
  }
});

// ===========================================================================
// 23–24. The admin READ extension: the answer, never the index
// ===========================================================================

test("23. the published assignment row gained the ANSWER and not the index", () => {
  // The two published fields the control needs, and no third.
  for (const field of ["pairedExamineeAssignmentId: string | null", "pairedExamineeName: string | null"]) {
    assert.ok(READ_CORE.includes(`readonly ${field};`), `the DTO is missing ${field}`);
  }
  // The INTERNAL allocation label is an INPUT of the stored row and appears in NO
  // published type: the core consumes it and publishes the resolved partner.
  const published = READ_CORE.slice(
    READ_CORE.indexOf("export interface AdminExamAssignmentRow {"),
    READ_CORE.indexOf("export interface AdminExamAssignmentListView {"),
  );
  assert.ok(published.length > 0, "the published row type is missing");
  assert.equal(published.includes("pairingIndex"), false, "the index reaches the published row");
  // The pairing rule is the committed SIBLING core's, consulted rather than
  // restated — so this screen and the operational readers cannot disagree.
  assert.ok(READ_CORE.includes("resolveExamPairings("), "the committed pairing rule is not used");
});

test("24. no GET can pair, and no client code came with the control", () => {
  // The control is a POST-ing form on a Server Action. There is no pairing link,
  // no effect, no auto-submit and no client component anywhere on this page.
  assert.ok(PAGE_FLAT.includes("<form action={boundSetExamPairingAction}"));
  for (const forbidden of [
    '"use client"',
    "useState",
    "useEffect",
    "useTransition",
    "onSubmit",
    "onChange",
    "onClick",
    "useFormStatus",
    `href={\`/admin/courses/\${context.id}/exams?pairing`,
  ]) {
    assert.equal(PAGE.includes(forbidden), false, `the page uses ${forbidden}`);
  }
  // No notification, no publication validation and no per-session publication
  // came with this slice.
  for (const forbidden of [
    "notification",
    "sendPush",
    "webpush",
    "individualPublishedAt",
    "validatePublication",
  ]) {
    assert.equal(ACTIONS.includes(forbidden), false, `the module references ${forbidden}`);
    assert.equal(PAGE.includes(forbidden), false, `the page references ${forbidden}`);
  }
});

// ===========================================================================
// 25–26. The slice's footprint, and this suite's own hygiene
// ===========================================================================

test("25. the slice touched EXACTLY its approved paths, and no schema or migration", () => {
  // Every working-tree entry under `prisma/` — untracked included — is empty.
  assert.deepEqual(gitLines(["status", "--porcelain", "--", "prisma"]), []);

  const touched = gitLines([
    "status",
    "--porcelain",
    "--",
    "lib",
    "prisma",
    "app",
    "components",
    "scripts",
  ]).map((line) => line.replace(/^\S{1,2}\s+/, "").replace(/^"|"$/g, ""));
  const unexpected = touched.filter((path) => !SLICE_PATHS.includes(path)).sort();
  assert.deepEqual(unexpected, [], `unexpected changes: ${unexpected.join(", ")}`);

  // EXACTLY TWO `lib/` production modules — the admin read pair this control
  // needs — and no third. Every other `lib/` entry is a guard suite.
  const libProduction = SLICE_PATHS.filter(
    (path) => path.startsWith("lib/") && !path.endsWith(".test.ts"),
  ).sort();
  assert.deepEqual(libProduction, [
    "lib/actions/" + "exam-assignment-read" + "-io.ts",
    "lib/exam/" + "admin-exam-assignment-read" + "-core.ts",
  ].sort());

  // No instructor or trainee UI, no auth, session, middleware, capability,
  // notification or service-worker file is in scope at all.
  for (const path of SLICE_PATHS) {
    for (const forbidden of [
      "app/instructor/",
      "app/student/",
      "lib/auth/",
      "lib/session",
      "middleware",
      "capabilit",
      "notification",
      "service-worker",
      "prisma/",
    ]) {
      assert.equal(path.includes(forbidden), false, `${path} is out of scope (${forbidden})`);
    }
  }
});

test("26. this suite opens no database and reads no environment", () => {
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
  const specifiers = [...own.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(specifiers)].sort(), [
    "node:assert/strict",
    "node:child_process",
    "node:fs",
    "node:path",
    "node:test",
  ]);
});
