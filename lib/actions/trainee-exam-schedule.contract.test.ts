/**
 * EX-TRAINEE-VIEW-MVP — STRUCTURAL contract test for the trainee exam view.
 *
 * SOURCE-TEXT CONTRACT TEST, following this repository's committed precedent
 * (lib/actions/instructor-exam-schedule.contract.test.ts, lib/exam/exam-read
 * .contract.test.ts). The runner is `node:test` via `npx tsx --test` with no
 * React/DOM framework, and AGENTS.md forbids introducing one for a scoped task,
 * so the properties below are pinned by reading the shipped sources.
 *
 * IT LIVES UNDER `lib/` DELIBERATELY. Several committed exam guard suites sweep
 * every file under `app/` — test files included — for the exam read pipeline's
 * own module names and call shapes, and treat a match as an unapproved caller.
 * A suite placed beside the section would therefore register itself as the
 * violation it is checking for. Here it may name those modules plainly.
 *
 * Run with:
 *   npx tsx --test lib/actions/trainee-exam-schedule.contract.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, sep } from "node:path";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../");

const ACTION_REL = "lib/actions/trainee-exam-schedule.ts";
const SUITE_REL = "lib/actions/trainee-exam-schedule.contract.test.ts";
const SECTION_REL = "app/student/StudentExamsSection.tsx";
const CLIENT_REL = "app/student/StudentClient.tsx";
const READERS_REL = "lib/actions/exam-role-readers.ts";
const SCOPE_REL = "lib/exam/exam-read-scope-core.ts";
const NAV_REL = "app/student/trainee-nav-visibility.ts";
const INSTRUCTOR_ACTION_REL = "lib/actions/instructor-exam-schedule.ts";
const INSTRUCTOR_SECTION_REL = "app/instructor/InstructorExamsSection.tsx";
const INSTRUCTOR_CLIENT_REL = "app/instructor/InstructorClient.tsx";
const INSTRUCTOR_SUITE_REL = "lib/actions/instructor-exam-schedule.contract.test.ts";
/**
 * EX-ROLE-OP-UI-MVP — the ONE shared renderer for a block's operational
 * assignment rows, mounted by the trainee screen and the instructor screen
 * alike. Its own behaviour is proven by real render tests beside it
 * (lib/components/ExamAssignmentRows.test.tsx); what this suite pins is that the
 * trainee screen delegates to it rather than growing a second copy.
 */
const ASSIGNMENT_ROWS_REL = "lib/components/ExamAssignmentRows.tsx";
const ASSIGNMENT_ROWS_SUITE_REL = "lib/components/ExamAssignmentRows.test.tsx";
/**
 * EX-ROLE-SCHEDULE-REDESIGN — the three shared leaves this screen now composes.
 *
 * The PURE view core owns the wave grouping, the examinee/instructed-trainee
 * nesting, the navigation filtering and the FAIL-CLOSED self-selector; the
 * navigation bar owns the compact filtering inside "לו״ז כולם"; the
 * personal-detail renderer is what makes "לו״ז שלי" short. Each is proven by its
 * own suite beside it — what this suite pins is that the trainee screen
 * DELEGATES to them rather than growing copies of their rules.
 */
const VIEW_CORE_REL = "lib/components/exam-schedule-view-core.ts";
const VIEW_CORE_SUITE_REL = "lib/components/exam-schedule-view-core.test.ts";
const SCHEDULE_NAV_REL = "lib/components/ExamScheduleNav.tsx";
const SCHEDULE_NAV_SUITE_REL = "lib/components/ExamScheduleNav.test.tsx";
const PERSONAL_DETAIL_REL = "lib/components/ExamPersonalAssignmentDetail.tsx";
const PERSONAL_DETAIL_SUITE_REL = "lib/components/ExamPersonalAssignmentDetail.test.tsx";
const NAV_SUITE_REL = "app/student/trainee-nav-visibility.test.ts";
/**
 * EX-TRAINEE-DATE-NAV — the trainee-only DATE sub-tabs, which replace the shared
 * three-view bar on this screen, and EX-BEGINNER-EXAM-UI — the ONE shared
 * compact renderer for a LIVE beginner row, which the instructor screen mounts
 * too. Each is proven by its own render suite beside it; what this suite pins is
 * that the trainee screen DELEGATES to them rather than growing copies.
 */
const DATE_TABS_REL = "lib/components/ExamDateTabs.tsx";
const DATE_TABS_SUITE_REL = "lib/components/ExamDateTabs.test.tsx";
const BEGINNER_ROWS_REL = "lib/components/ExamBeginnerRows.tsx";
const BEGINNER_ROWS_SUITE_REL = "lib/components/ExamBeginnerRows.test.tsx";

function read(relative: string): string {
  return readFileSync(join(REPO_ROOT, relative), "utf8");
}

/** CODE only — the headers in this slice legitimately NAME what they forbid. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function gitLines(args: string[]): string[] {
  const result = spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr ?? ""}`);
  return (result.stdout ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Is this path byte-identical to HEAD, staged and unstaged alike? */
function unchangedSinceHead(relative: string): boolean {
  return (
    spawnSync("git", ["diff", "--quiet", "HEAD", "--", relative], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }).status === 0
  );
}

const ACTION = read(ACTION_REL);
const ACTION_CODE = stripComments(ACTION);
const SECTION = read(SECTION_REL);
const SECTION_CODE = stripComments(SECTION);
const CLIENT = read(CLIENT_REL);
const CLIENT_CODE = stripComments(CLIENT);

/**
 * The committed reader's own name, and the Prisma entry points. Assembled from
 * pieces where a whole literal would make an unrelated guard treat THIS file as
 * a call site.
 */
const READER_CALL = new RegExp("\\bread" + "TraineeExamSchedule\\s*\\(");
/**
 * EX-TRAINEE-MULTIDAY-READ — BOTH trainee readers.
 *
 * The committed DAY reader is KEPT (public API, and a single-day reading stays
 * legitimate); the SCHEDULE reader is the one the trainee UI now goes through.
 * The caller sweep below must recognise EITHER name, so neither can acquire an
 * unapproved caller unnoticed — recognising only the new one would have quietly
 * opened the old one up.
 */
const READER_NAME = new RegExp("\\bread" + "TraineeExam(Day|Schedule)\\b");
const PRISMA_MODULE = ["@/lib", "prisma"].join("/");
const GENERATED_CLIENT = ["@prisma", "client"].join("/");

/** Every `.ts`/`.tsx` file in the repository's own source trees. */
function repoSourceFiles(): { rel: string; source: string }[] {
  const out: { rel: string; source: string }[] = [];
  for (const dir of ["app", "lib", "components"]) {
    const root = join(REPO_ROOT, dir);
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!/\.tsx?$/.test(entry.name)) continue;
      const path = join(entry.parentPath ?? root, entry.name);
      if (path.includes(`${sep}generated${sep}`)) continue;
      out.push({
        rel: path.slice(REPO_ROOT.length + 1).split(sep).join("/"),
        source: readFileSync(path, "utf8"),
      });
    }
  }
  return out;
}

/** A named slice of the client source, between two top-level declarations. */
function clientSlice(from: string, to: string): string {
  const start = CLIENT_CODE.indexOf(from);
  const end = CLIENT_CODE.indexOf(to);
  assert.ok(start >= 0, `${from} was not found`);
  assert.ok(end > start, `${to} was not found after ${from}`);
  return CLIENT_CODE.slice(start, end);
}

// ===========================================================================
// 1–6. The Server Action is a transport wrapper and nothing else
// ===========================================================================

test("1. the action calls the committed trainee reader and nothing else", () => {
  // It is a Server Action module...
  assert.match(ACTION, /^"use server";/);

  // ...whose ONLY runtime import is the committed role-reader binding.
  const specifiers = [...ACTION_CODE.matchAll(/from\s+"([^"]+)"/g)].map(([, value]) => value);
  assert.deepEqual(specifiers, ["./exam-role-readers"]);

  // ...it exports exactly ONE function...
  //
  // EX-TRAINEE-MULTIDAY-READ RE-POINT — that one function is now the SCHEDULE
  // reading. The day wrapper was REPLACED rather than joined: everything
  // exported from a "use server" module becomes publicly callable over the
  // network with a stable id, and a second endpoint returning a SUBSET of this
  // one's data would be network surface nobody needs. The count stays ONE,
  // which is the property this assertion exists to hold.
  const exported = [...ACTION_CODE.matchAll(/export async function (\w+)\(/g)].map(
    ([, name]) => name,
  );
  assert.deepEqual(exported, ["getTraineeExamSchedule"]);

  // ...and the reader is invoked exactly once, as the whole body.
  assert.equal(
    (ACTION_CODE.match(new RegExp(READER_CALL.source, "g")) ?? []).length,
    1,
    "the reader must be called exactly once",
  );
  assert.match(
    ACTION_CODE.replace(/\s+/g, " "),
    /return read.{0,40}\(\); \}/,
    "the wrapper must return the reader's result unchanged",
  );
  // No other exam reader is reachable from here — including the DAY reader,
  // which is KEPT in the readers module but is deliberately NOT published as a
  // second Server Action.
  for (const other of [
    "read" + "AdminExamPlan",
    "read" + "InstructorExamPlan",
    "read" + "TraineeExamDay",
  ]) {
    assert.equal(ACTION_CODE.includes(other), false, `the action reaches ${other}`);
  }
});

test("2. the action accepts NO value at all", () => {
  // EX-TRAINEE-MULTIDAY-READ RE-POINT — this asserted the ONE parameter was a
  // date. The schedule reading takes none, which is the STRONGER form of the
  // very property the assertion existed to hold: there is no longer any
  // caller-supplied value to normalize, reject or reason about.
  const signature = ACTION_CODE.slice(
    ACTION_CODE.indexOf("export async function getTraineeExamSchedule("),
  );
  const params = signature.slice(signature.indexOf("(") + 1, signature.indexOf(")"));
  assert.equal(params.replace(/\s+/g, " ").trim(), "");
  // ...and no date is reachable through the module either, so the UI cannot
  // reintroduce a per-day request through this seam.
  assert.equal(ACTION_CODE.includes("selectedDate"), false, "the action still names a date");
});

test("3. the action accepts no student id and no other actor identity", () => {
  const signature = ACTION_CODE.slice(
    ACTION_CODE.indexOf("export async function getTraineeExamSchedule("),
  );
  const params = signature.slice(signature.indexOf("(") + 1, signature.indexOf(")"));
  for (const forbidden of [
    "studentId",
    "traineeId",
    "instructorId",
    "actorId",
    "viewerStudentId",
    "planId",
    "sessionId",
    "deps",
    "options",
  ]) {
    assert.equal(params.includes(forbidden), false, `the action accepts ${forbidden}`);
  }
  // ...and it derives no identity of its own either.
  for (const token of [
    "requireCurrentTrainee",
    "getCurrentTrainee",
    "requireCurrentInstructor",
    "cookies(",
    "headers(",
  ]) {
    assert.equal(ACTION_CODE.includes(token), false, `the action performs ${token}`);
  }
});

test("4. the action accepts and names no course offering id", () => {
  assert.equal(ACTION_CODE.includes("courseOfferingId"), false, "the action names a course id");
  for (const token of [
    "resolveTraineeCourseOffering",
    "requireAdminCourseOffering",
    "resolveInstructorCourseOffering",
  ]) {
    assert.equal(ACTION_CODE.includes(token), false, `the action resolves a course via ${token}`);
  }
});

test("5. the action exposes no publication toggle and no publication rule", () => {
  for (const token of [
    "requirePlanPublication",
    "requireLessonPublication",
    "publishedAt",
    "isPublished",
    "includeDraft",
    "draft",
  ]) {
    assert.equal(ACTION_CODE.includes(token), false, `the action names ${token}`);
  }
  // ...and it consults no capability either: that boundary is the reader's.
  for (const token of ["CapabilityKey", "getEffectiveCapabilities", "EXAMS", "SCHEDULE"]) {
    assert.equal(ACTION_CODE.includes(token), false, `the action consults ${token}`);
  }
});

test("6. the action contains no Prisma query, no DTO narrowing and no write", () => {
  for (const token of [
    PRISMA_MODULE,
    GENERATED_CLIENT,
    "prisma.",
    "$transaction",
    "$queryRaw",
    "$executeRaw",
    "revalidatePath",
    "redirect(",
    "exam-read-dto",
    "exam-read-io",
    "exam-read-scope-core",
    "exam-plan-loader-core",
    "build" + "TraineeExamDayDto",
    "load" + "ExamPlan",
  ]) {
    assert.equal(ACTION_CODE.includes(token), false, `the action uses ${token}`);
  }
  assert.equal(
    /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/.test(ACTION_CODE),
    false,
    "the action performs a write",
  );
});

// ===========================================================================
// 6b. The committed reader is still the authorization boundary
// ===========================================================================

/**
 * The authorization surface of the pure scope core: the identity step, the
 * course-resolution step, the denial classification and the locked per-role
 * publication options.
 */
const SCOPE_AUTHORIZATION_TOKENS = [
  "requireInstructorId",
  "requireTraineeId",
  "requireAdminCourseOffering",
  "resolveInstructorCourseOffering",
  "resolveTraineeCourseOffering",
  "isCourseContextDenial",
  "requirePlanPublication",
  "requireLessonPublication",
  "viewerStudentId",
  "ADMIN_EXAM_PLAN_LOAD_OPTIONS",
  "INSTRUCTOR_EXAM_PLAN_LOAD_OPTIONS",
  "traineeExamPlanLoadOptions",
  "normalizeSelectedExamDate",
  "loadPlan(",
] as const;

/**
 * EX-OPS-READ-MVP RE-POINT — `lib/exam/exam-read-scope-core.ts`.
 *
 * This suite asserted the scope core was BYTE-IDENTICAL to HEAD. That claim
 * described the trainee-view slice while it was in flight; that slice is merged,
 * so the same command no longer measures it — it measures whichever slice
 * currently sits in the tree. The separately reviewed operational-read slice is
 * exactly such a slice, and it edits the scope core in ONE place: it passes one
 * additional SIBLING lookup to the DTO narrowing.
 *
 * The claim is REPLACED, not dropped, by the property this suite actually cares
 * about and which no later slice can satisfy by accident: NO CHANGED LINE of
 * that file may name any part of the authorization surface, and the locked
 * per-role publication options — including the trainee's two `true`s, which are
 * the publication rule this whole suite exists to protect — must still read
 * exactly as they did.
 */
function assertScopeCoreAuthorizationUnchanged(): void {
  const diff = spawnSync("git", ["diff", "-U0", "HEAD", "--", SCOPE_REL], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  assert.equal(diff.status, 0, `git diff ${SCOPE_REL} failed: ${diff.stderr ?? ""}`);
  const changedLines = (diff.stdout ?? "")
    .split("\n")
    .filter((line) => /^[+-]/.test(line) && !/^(\+\+\+|---)/.test(line));
  // NARROWED by EX-BEGINNER-EXAM-READ, on the axis this guard exists to protect.
  //
  // The claim is that no changed line may touch the AUTHORIZATION SURFACE. This
  // slice changes that file in exactly three shapes, and NOTHING else:
  //
  //   1. each role resolver's RETURN TYPE widens from `{ readonly id: string }`
  //      to the two-field `ResolvedExamCourseOffering`, so the reader can read the
  //      DB-VERIFIED offering's LEVEL alongside its id;
  //   2. the two locked per-role option CONSTANTS become option PRODUCERS taking
  //      that level, because the Level-1 beginner containment gate cannot be a
  //      compile-time constant;
  //   3. the three call sites pass the level they just resolved.
  //
  // The authorization ORDER, the denial classification, the actor resolution and
  // the four publication literals are all untouched — the literals are re-asserted
  // verbatim below, and a pure RE-INDENTATION is recognised as such by comparing
  // trimmed text rather than being waved through by a pattern.
  //
  // Every tolerated line is spelled out EXACTLY. A new resolver, a skipped call, a
  // reordered step or a changed publication value matches none of them and still
  // fails here.
  const TOLERATED_CHANGED_LINES = new Set([
    "readonly requireAdminCourseOffering: (",
    "readonly resolveInstructorCourseOffering: (",
    "readonly resolveTraineeCourseOffering: () => Promise<{ readonly id: string }>;",
    "readonly resolveTraineeCourseOffering: () => Promise<ResolvedExamCourseOffering>;",
    ") => Promise<{ readonly id: string }>;",
    ") => Promise<ResolvedExamCourseOffering>;",
    "export const ADMIN_EXAM_PLAN_LOAD_OPTIONS: ExamPlanLoadOptions = Object.freeze({",
    "export const INSTRUCTOR_EXAM_PLAN_LOAD_OPTIONS: ExamPlanLoadOptions = Object.freeze({",
    "export function adminExamPlanLoadOptions(courseLevel: unknown): ExamPlanLoadOptions {",
    "export function instructorExamPlanLoadOptions(courseLevel: unknown): ExamPlanLoadOptions {",
    "options: ADMIN_EXAM_PLAN_LOAD_OPTIONS,",
    "options: INSTRUCTOR_EXAM_PLAN_LOAD_OPTIONS,",
    "options: adminExamPlanLoadOptions(offering?.level),",
    "options: instructorExamPlanLoadOptions(verifiedLevel),",
    "options: traineeExamPlanLoadOptions(studentId),",
    "options: traineeExamPlanLoadOptions(studentId, verifiedLevel),",
    "authenticatedStudentId: string,",
    "): ExamPlanLoadOptions {",
  ]);
  // A line whose TRIMMED text appears on BOTH sides of the diff is a pure
  // re-indentation: the same code, moved. Recognised structurally rather than
  // listed, so it cannot be used to smuggle a value change through.
  const removed = new Set(
    changedLines.filter((line) => line.startsWith("-")).map((line) => line.slice(1).trim()),
  );
  const added = new Set(
    changedLines.filter((line) => line.startsWith("+")).map((line) => line.slice(1).trim()),
  );
  const reindented = new Set([...removed].filter((line) => added.has(line)));

  // EX-TRAINEE-MULTIDAY-READ RE-POINT — ADDED lines are separated from REMOVED
  // ones.
  //
  // The sweep treated every changed line alike, which was right while no slice
  // needed a new reader: a line naming the authorization surface could only be
  // an edit to the existing one. The approved multi-day trainee read ADDS a
  // reader, and a reader that did NOT name `requireTraineeId`,
  // `resolveTraineeCourseOffering`, `isCourseContextDenial`,
  // `traineeExamPlanLoadOptions` and `loadPlan` would be one that skipped the
  // authorization — so the old form is satisfiable here only by writing an
  // UNSAFE reader.
  //
  // The claim is SPLIT, and the half that protects the committed behaviour is
  // kept at FULL strength:
  //
  //   - NO REMOVED LINE may name the authorization surface. Nothing about the
  //     existing readers can be deleted, weakened or re-ordered, whatever else
  //     the slice does. This is the original claim, unchanged.
  //   - An ADDED line may name it ONLY inside the new trainee SCHEDULE reader,
  //     and the check below then proves that reader's authorization lines are
  //     the day reader's, verbatim — same steps, same order, same options. An
  //     added line anywhere else in the file still fails.
  for (const token of SCOPE_AUTHORIZATION_TOKENS) {
    const offenders = changedLines
      .filter((line) => line.startsWith("-"))
      .filter((line) => line.includes(token))
      .map((line) => line.slice(1).trim())
      .filter((line) => !reindented.has(line) && !TOLERATED_CHANGED_LINES.has(line));
    assert.deepEqual(offenders, [], `${SCOPE_REL} REMOVED or rewrote a line naming ${token}`);
  }

  const scopeCode = stripComments(read(SCOPE_REL));
  /** The body of one reader in the pure scope core, by exact name. */
  const readerBody = (name: string): string => {
    const start = scopeCode.indexOf(`export async function ${name}(`);
    assert.ok(start >= 0, `${name} was not found in ${SCOPE_REL}`);
    const end = scopeCode.indexOf("\n}", start);
    assert.ok(end > start, `${name} has no readable body`);
    return scopeCode.slice(start, end);
  };
  const dayBody = readerBody("read" + "TraineeExamDayWithDeps");
  const scheduleBody = readerBody("read" + "TraineeExamScheduleWithDeps");

  // EVERY added CODE line naming the authorization surface lives inside the new
  // reader. Comment lines are excluded on the same principle this whole suite
  // already applies to every source it reads: a header that EXPLAINS which
  // authorization it repeats is not an authorization decision, and the stripped
  // body below is where the decisions themselves are compared.
  const isCommentLine = (line: string): boolean =>
    line.startsWith("*") || line.startsWith("//") || line.startsWith("/*");
  for (const token of SCOPE_AUTHORIZATION_TOKENS) {
    const addedOffenders = [...added]
      .filter((line) => line.includes(token))
      .filter((line) => !isCommentLine(line))
      .filter((line) => !reindented.has(line) && !TOLERATED_CHANGED_LINES.has(line))
      .filter((line) => !scheduleBody.includes(line));
    assert.deepEqual(
      addedOffenders,
      [],
      `${SCOPE_REL} added a line naming ${token} outside the new trainee schedule reader`,
    );
  }

  // ...and the new reader's authorization is the day reader's, line for line.
  // The DATE is the only thing it may legitimately lack.
  const authorizationLines = (body: string): string[] =>
    body
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => SCOPE_AUTHORIZATION_TOKENS.some((token) => line.includes(token)))
      .filter((line) => !line.includes("normalizeSelectedExamDate"));
  assert.deepEqual(
    authorizationLines(scheduleBody),
    authorizationLines(dayBody),
    "the multi-day trainee reader does not authorize exactly as the day reader does",
  );
  // It states no publication rule of its own, and reaches no other role's.
  for (const foreign of [
    "adminExamPlanLoadOptions",
    "instructorExamPlanLoadOptions",
    "requireInstructorId",
    "requireAdminCourseOffering",
    "requirePlanPublication",
    "requireLessonPublication",
  ]) {
    assert.equal(
      scheduleBody.includes(foreign),
      false,
      `the multi-day trainee reader reaches ${foreign}`,
    );
  }


  const scope = stripComments(read(SCOPE_REL));
  for (const locked of [
    "requirePlanPublication: true",
    "requireLessonPublication: true",
    "requirePlanPublication: false",
    "requireLessonPublication: false",
  ]) {
    assert.ok(scope.includes(locked), `the scope core no longer states ${locked}`);
  }
}

/**
 * EX-ROLE-OP-UI-MVP RE-POINT — `app/student/trainee-nav-visibility.ts`.
 *
 * This suite asserted the navigation rule was BYTE-IDENTICAL to HEAD. That
 * described the trainee-view slice, which needed no navigation change; the
 * operational-UI slice does, because the fail-closed level allow-list was hiding
 * the "מבחנים" entry from Level-2-only trainees — precisely the trainees the exam
 * schedule exists for, and whom the committed reader was already willing to
 * serve.
 *
 * The claim is REPLACED, not dropped, by a strictly EXACT one: the ONLY code
 * change permitted in that file is the addition of the single `"exams"` id. No
 * code line may be REMOVED, and no other line may be ADDED. A slice that touched
 * the cardinality rule, the allow-list's other entries, the additive
 * `serverUnlockedNavIds` seam or either exported function's body would change or
 * delete a code line and fail here — as would one that quietly widened the
 * allow-list with a second module.
 */
function assertNavVisibilityOnlyGainedExamsId(): void {
  // EX-ROLE-SCHEDULE-REDESIGN RE-POINT. This helper asserted that the working
  // tree's diff of the navigation rule against HEAD was EXACTLY the one added
  // `"exams"` id. That described the operational-UI slice while it was in
  // flight; that slice is merged, so the same command no longer measures it —
  // against the current HEAD the diff is EMPTY, and the helper failed on its own
  // success. (It was already red at HEAD before this slice began.)
  //
  // The claim is REPLACED by the strictly stronger, durable pair it was standing
  // in for: the navigation rule is BYTE-IDENTICAL to HEAD — this slice adds no
  // navigation entry and unlocks nothing — and it is still a PURE module. Its
  // exact allow-list membership is pinned independently by test 7 below.
  assert.ok(unchangedSinceHead(NAV_REL), `${NAV_REL} was modified by this slice`);

  // The module is still PURE — its own suite proves this structurally, and it is
  // restated here because THIS suite's subject is what a trainee may reach.
  const nav = stripComments(read(NAV_REL));
  for (const token of ["prisma", "cookies(", "headers(", "getEffectiveCapabilities", "use server"]) {
    assert.equal(nav.includes(token), false, `the navigation rule now performs ${token}`);
  }
}

test("6b. the reader is untouched, server-only, and the wrapper is its only app-reachable caller", () => {
  // EX-TRAINEE-MULTIDAY-READ RE-POINT — the BYTE-IDENTICAL claim on the readers
  // module.
  //
  // That claim said this slice changed no authorization, no course resolution
  // and no publication logic, and it was expressible as byte-identity only while
  // no slice needed a new reader binding. The approved multi-day trainee read
  // needs exactly one, so byte-identity would now be satisfiable only by not
  // doing the approved work.
  //
  // The claim is REPLACED by the property it was standing in for, checked
  // directly rather than by proxy: the file's ONLY difference from HEAD is
  // ADDITIVE, every pre-existing reader is still there with its dependency
  // bundle intact, and the new binding is handed the SAME five dependencies as
  // the day reader — same identity source, same non-selectable resolver, same
  // denial classification, same loader, same single name fetch. A binding that
  // swapped any of them, or a slice that quietly edited an existing reader,
  // fails here.
  const readersDiff = spawnSync("git", ["diff", "-U0", "HEAD", "--", READERS_REL], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  assert.equal(readersDiff.status, 0, `git diff ${READERS_REL} failed`);
  const removedLines = (readersDiff.stdout ?? "")
    .split("\n")
    .filter((line) => line.startsWith("-") && !line.startsWith("---"))
    .map((line) => line.slice(1).trim())
    .filter(Boolean);
  assert.deepEqual(removedLines, [], `${READERS_REL} lost a line: ${removedLines.join(" | ")}`);

  const readersSource = stripComments(read(READERS_REL));
  // Every committed reader is still declared, and the new one beside them.
  for (const reader of [
    "read" + "AdminExamPlan",
    "read" + "AdminExamWaveView",
    "read" + "InstructorExamPlan",
    "read" + "TraineeExamDay",
    "read" + "TraineeExamSchedule",
  ]) {
    assert.ok(
      readersSource.includes(`export async function ${reader}(`),
      `${reader} is no longer exported`,
    );
  }
  // The two trainee bindings hand over the SAME dependency set. Compared as
  // sorted property names, so a reordering is not a difference and a swapped,
  // added or dropped dependency is.
  const depsOf = (reader: string): string[] => {
    const start = readersSource.indexOf(`export async function ${reader}(`);
    assert.ok(start >= 0, `${reader} was not found`);
    const body = readersSource.slice(start, readersSource.indexOf("\n}", start));
    return [...body.matchAll(/^\s{4}(\w+)[,:]/gm)].map(([, name]) => name).sort();
  };
  assert.deepEqual(
    depsOf("read" + "TraineeExamSchedule"),
    depsOf("read" + "TraineeExamDay"),
    "the schedule binding was given a different dependency bundle from the day binding",
  );
  // ...and the navigation rule gained the one approved id and nothing else.
  assertNavVisibilityOnlyGainedExamsId();
  // ...and no changed line of the pure scope core touches authorization.
  assertScopeCoreAuthorizationUnchanged();

  // CODE only: the reader's header legitimately NAMES the directive when it
  // explains why it deliberately does not carry one.
  const readers = stripComments(read(READERS_REL));
  assert.match(readers, new RegExp('import\\s+"server' + '-only";'));
  assert.equal(readers.includes('"use server"'), false, "the reader became a Server Action module");
  assert.equal(readers.includes("'use server'"), false, "the reader became a Server Action module");

  // EXACTLY two production modules name the trainee reader: its own definition,
  // and the one approved wrapper. An exact path list, never a directory or a
  // glob. The `\b` terminator keeps the pure core's `...WithDeps` seam out.
  const callers = repoSourceFiles()
    .filter((file) => !/\.test\.tsx?$/.test(file.rel))
    .filter((file) => READER_NAME.test(stripComments(file.source)))
    .map((file) => file.rel)
    .sort();
  assert.deepEqual(callers, [ACTION_REL, READERS_REL].sort());

  // No app/ or client module reaches the read pipeline's internals directly:
  // the wrapper is the whole seam.
  const offenders = repoSourceFiles()
    .filter(
      (file) =>
        file.rel.startsWith("app/") ||
        file.rel.startsWith("components/") ||
        /^\s*["']use client["']\s*;?/.test(stripComments(file.source)),
    )
    .filter((file) =>
      /exam-role-readers|exam-read-scope-core|exam-read-io|exam-read-dto/.test(
        stripComments(file.source),
      ),
    )
    .map((file) => file.rel);
  assert.deepEqual(offenders, [], `a UI module reaches the read pipeline: ${offenders.join(", ")}`);
});

// ===========================================================================
// 7–9. Navigation and routing
// ===========================================================================

test('7. the "מבחנים" trainee entry exists EXACTLY once', () => {
  assert.equal((CLIENT_CODE.match(/"מבחנים"/g) ?? []).length, 1, "the label appears more than once");
  assert.equal((CLIENT_CODE.match(/id: "exams"/g) ?? []).length, 1, "the id is registered twice");
  assert.equal(
    (CLIENT_CODE.match(/activeTab === "exams"/g) ?? []).length,
    1,
    "the screen has more than one render branch",
  );

  // It is a "עוד" menu entry, NOT a sixth bottom tab and NOT a home shortcut.
  const moreItems = clientSlice("const STUDENT_MORE_ITEMS", "const STUDENT_ALL_TABS");
  assert.ok(moreItems.includes('{ id: "exams", label: "מבחנים" }'), "the entry is not in the menu");
  const mainTabs = clientSlice("const STUDENT_MAIN_TABS", "const STUDENT_MORE_ITEMS");
  assert.equal(mainTabs.includes("exams"), false, "the bottom bar gained a tab");
  const quickActions = clientSlice("const STUDENT_QUICK_ACTIONS", "interface StoredSession");
  assert.equal(quickActions.includes("exams"), false, "a second entry point was added");

  // NOBODY sees the entry before the course options resolve. This half of the
  // rule is UNCHANGED: while the options are unknown we cannot tell a Level 2
  // trainee from anyone else, and the safe direction while unknown is to show
  // less, so the entry appears only once the options arrive.
  const loadingSafe = clientSlice("const LOADING_SAFE_NAV_IDS", "function toMessagePreview");
  assert.equal(loadingSafe.includes("exams"), false, "the loading-safe allow-list was widened");

  // EX-ROLE-OP-UI-MVP RE-POINT — the Level 2 allow-list. This asserted that a
  // Level-2-only trainee NEVER sees the entry. That was the trainee-view slice's
  // deliberate conservative default, and it turned out to hide the exam schedule
  // from exactly the trainees it is for: the reader already serves them, so the
  // allow-list was the only thing in the way.
  //
  // The claim is REPLACED by the EXACT membership of that list, which is a
  // strictly stronger statement than the one it replaces — the previous version
  // said nothing at all about the other seven ids, so a slice that added
  // "duties" would have passed it. The fail-closed shape is intact: any id NOT
  // spelled below is still hidden without needing to be enumerated, and
  // `assertNavVisibilityOnlyGainedExamsId` above independently pins that this
  // list gained "exams" and nothing else.
  const nav = stripComments(read(NAV_REL));
  const level2 = nav.slice(
    nav.indexOf("const LEVEL2_ONLY_VISIBLE_NAV_IDS"),
    nav.indexOf("export function isTraineeNavEntryVisible"),
  );
  assert.deepEqual(
    [...level2.matchAll(/"(\w+)"/g)].map(([, id]) => id),
    ["today", "schedule", "contacts", "exams", "profile", "help", "more"],
    "the Level 2 allow-list is not exactly the approved membership",
  );

  // AND IT UNLOCKS NOTHING. Being reachable is not being shown a schedule: the
  // committed reader still proves the session, resolves the trainee's own course
  // and requires a PUBLISHED plan and PUBLISHED lessons. That is the property
  // this navigation change must not have moved, so it is re-checked here.
  assertScopeCoreAuthorizationUnchanged();
  // EX-TRAINEE-MULTIDAY-READ RE-POINT — the byte-identity claim on the readers
  // module, for the reason given in test 6b: the approved multi-day read ADDS a
  // binding there. What this line was protecting — that the NAVIGATION change
  // did not come with a quiet edit to an existing reader — is checked at full
  // strength in 6b, which allows additions and forbids every removal or rewrite.
  // Restated here so this test still fails if that ever stops holding.
  const readersDiff = spawnSync("git", ["diff", "-U0", "HEAD", "--", READERS_REL], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  assert.equal(readersDiff.status, 0, `git diff ${READERS_REL} failed`);
  assert.deepEqual(
    (readersDiff.stdout ?? "")
      .split("\n")
      .filter((line) => line.startsWith("-") && !line.startsWith("---"))
      .map((line) => line.slice(1).trim())
      .filter(Boolean),
    [],
    "an existing reader was edited alongside the navigation",
  );
});

test("8. every existing trainee navigation entry is still present", () => {
  for (const label of [
    "היום",
    'לו"ז',
    "תורנויות",
    "הודעות",
    "עוד",
    "פרופיל",
    "אנשי קשר",
    "חומרי קורס",
    "התנסויות מתחילים",
    "עדכונים",
    "משוב שבועי",
    "עזרה",
  ]) {
    // Presence in CODE, not a fixed quoting shape: 'לו"ז' is single-quoted in
    // the source precisely because it contains a double quote.
    assert.ok(CLIENT_CODE.includes(label), `the ${label} entry disappeared`);
  }
  for (const id of [
    "today",
    "schedule",
    "duties",
    "messages",
    "more",
    "profile",
    "contacts",
    "materials",
    "teachingPractice",
    "notifications",
    "weeklyFeedback",
    "help",
  ]) {
    assert.ok(CLIENT_CODE.includes(`id: "${id}"`), `the ${id} entry disappeared`);
  }
  // The shared bottom-bar default is untouched by this slice too.
  assert.ok(unchangedSinceHead("lib/components/BottomTabs.tsx"), "BottomTabs.tsx was modified");
});

test("9. no exam route directory was created in any role area", () => {
  for (const dir of [
    join("app", "student", "exams"),
    join("app", "instructor", "exams"),
    join("app", "admin", "exams"),
  ]) {
    assert.equal(existsSync(join(REPO_ROOT, dir)), false, `${dir} was created`);
  }
  // The feature is hosted inside the existing student page/client architecture.
  // EX-EXAM-TP-CARDS — the temporary groupName-based placeholder prop is GONE
  // (the static placeholders it drove are fully removed, see the beginner-row
  // tests below); the section is back to taking no props at all, exactly like
  // every other identity/course value on this screen, and is still a plain
  // component, not a route module (still no `export default` below).
  assert.ok(
    SECTION_CODE.includes("export function StudentExamsSection() {"),
    "the screen is not a plain section component",
  );
  assert.equal(SECTION_CODE.includes("export default"), false, "the section became a route module");
  assert.ok(
    CLIENT_CODE.includes('from "@/app/student/StudentExamsSection"'),
    "the section is not mounted by the existing student client",
  );
});

// ===========================================================================
// 10–11. Empty, loading and error states
// ===========================================================================

test("10. the empty state renders the exact approved Hebrew sentence", () => {
  assert.ok(
    SECTION.includes('const EMPTY_TEXT = "עדיין לא פורסם לוח מבחנים.";'),
    "the approved empty-state sentence is missing or was reworded",
  );
  // EX-TRAINEE-MULTIDAY-READ RE-POINT — the WORDING of the two sentences.
  //
  // Both said "ליום זה" / "ביום זה" — "for this day" — because the screen had
  // chosen a day and read exactly that one. It now loads the WHOLE published
  // schedule, so a sentence scoped to a day would be telling a trainee that
  // nothing is published TODAY when what the server actually said is that
  // nothing is published for them AT ALL. The exact strings are re-pinned rather
  // than loosened, and the property they exist for is unchanged and re-checked
  // below: EMPTY_TEXT is the only sentence that touches publication.
  //
  // It is the sentence shown whenever the SCHEDULE itself carries no visible row
  // — missing, draft and denied alike, which is exactly what must not be told
  // apart. The other two are reachable ONLY when the schedule IS visible and
  // holds rows, so neither can stand in for the publication answer.
  assert.ok(SECTION_CODE.includes("view.allRows.length === 0"));
  assert.ok(SECTION.includes('const NO_SELF_TEXT = "אין לך שיבוץ למבחן.";'));

  // EX-ROLE-SCHEDULE-REDESIGN RE-POINT — the two-way choice
  // `{dayIsEmpty ? EMPTY_TEXT : NO_SELF_TEXT}`. "לו״ז כולם" can now be narrowed
  // by exam type or by date, so a THIRD outcome exists: the day is visible and
  // holds rows, but the chosen view holds none of them. Keeping the two-way
  // choice would have printed "you have no exam assignment today" to a trainee
  // who does — and, worse, would have made that sentence answerable by a view
  // selection rather than by the server.
  //
  // The claim is REPLACED by the property it was standing in for, unchanged in
  // strength: the sentence that touches PUBLICATION is reached from `dayIsEmpty`
  // and from nowhere else, and every other outcome gets a sentence that says
  // nothing about publication.
  assert.ok(
    SECTION_CODE.includes("const emptyText = scheduleIsEmpty"),
    "the empty state no longer branches on the loaded schedule first",
  );
  assert.ok(SECTION_CODE.includes("{emptyText}"), "the empty state is never rendered");
  assert.ok(SECTION.includes('const NO_MATCHING_ROWS_TEXT = "אין מבחנים בתצוגה שנבחרה.";'));
  // EMPTY_TEXT is named exactly twice — its declaration and the one branch — so
  // it cannot also be reached from a view selection.
  assert.equal((SECTION_CODE.match(/EMPTY_TEXT/g) ?? []).length, 2);
  // The flag reads the LOADED contract, never the narrowed rows.
  assert.ok(
    SECTION_CODE.includes("const scheduleIsEmpty = view !== null && view.allRows.length === 0;"),
  );
});

test("11. loading and error states are fixed strings that expose no raw error", () => {
  assert.ok(SECTION.includes('const LOADING_TEXT = "טוען לוח מבחנים...";'));
  assert.ok(SECTION.includes('const ERROR_TEXT = "לא ניתן לטעון כרגע את לוח המבחנים.";'));
  assert.ok(SECTION_CODE.includes("{LOADING_TEXT}") && SECTION_CODE.includes("{ERROR_TEXT}"));
  // The rejection value is never bound, so it cannot be rendered, logged or
  // stringified: no message, no code, no stack, no id.
  assert.match(SECTION_CODE, /\.catch\(\(\) => \{/, "the catch handler must take no error param");
  assert.equal(
    /\.catch\(\s*(async\s*)?\(?\s*[A-Za-z_$]/.test(SECTION_CODE),
    false,
    "no catch handler may bind the rejection value",
  );
  for (const token of ["String(", "console.", ".stack", "issueCode", "toString()"]) {
    assert.equal(SECTION_CODE.includes(token), false, `the UI surfaces ${token}`);
  }
});

// ===========================================================================
// 12–14. Publication, personal time and privacy
// ===========================================================================

test("12. unpublished data cannot be displayed by this UI", () => {
  // The exam-schedule seam still carries only a date — there is no argument
  // through which a draft reading could be requested...
  const specifiers = [...SECTION_CODE.matchAll(/from\s+"([^"]+)"/g)].map(([, value]) => value);
  // EX-EXAM-TP-CARDS RE-POINT — a SECOND `@/lib/actions/` module is now
  // imported: the SAME lessons reader "ההתנסויות שלי" already calls, reused
  // verbatim rather than duplicated (once as a value import, once as a
  // type-only import). It is likewise called with no argument that could
  // request a draft — see the second `assert.deepEqual` below.
  //
  // EX-EXAM-TP-SAME-PARENT-TRACKS RE-POINT — a THIRD specifier from the SAME
  // module: the roster-wide fixed-structure ("מבנה קבוע") reader, the SAME
  // one "ההתנסויות שלי"'s own popup already calls, feeding ONLY the
  // same-parent popup (never a card) - see the file header
  // (EX-EXAM-TP-SAME-PARENT-TRACKS) and the dedicated tests below for why.
  assert.deepEqual(specifiers.filter((value) => value.startsWith("@/lib/actions/")), [
    "@/lib/actions/trainee-exam-schedule",
    "@/lib/actions/teaching-practice-student",
    "@/lib/actions/teaching-practice-student",
    "@/lib/actions/teaching-practice-student",
  ]);
  const calls = SECTION_CODE.match(/getTraineeExamSchedule\([^)]*\)/g) ?? [];
  assert.deepEqual(calls, ["getTraineeExamSchedule()"]);
  // The Teaching-Practice call sites take the SAME empty-string inert
  // argument documented at their call sites - never a client-supplied identity.
  const practiceCalls = SECTION_CODE.match(/listMyTeachingPracticeLessonsForTrainee\([^)]*\)/g) ?? [];
  assert.deepEqual(practiceCalls, ['listMyTeachingPracticeLessonsForTrainee("")']);
  const tracksCalls = SECTION_CODE.match(/listPublishedTeachingPracticeTracksForTrainee\([^)]*\)/g) ?? [];
  assert.deepEqual(tracksCalls, ['listPublishedTeachingPracticeTracksForTrainee("")']);

  // ...and the UI names no publication concept at all, so it can neither ask for
  // a draft nor label one.
  for (const token of [
    "requirePlanPublication",
    "requireLessonPublication",
    "isPublished",
    "publishedAt",
    "individualPublishedAt",
    "includeDraft",
    "draft",
    "טיוטה",
  ]) {
    assert.equal(SECTION_CODE.includes(token), false, `the UI names ${token}`);
  }
  // The publication rule itself still lives, untouched, in the committed core.
  assertScopeCoreAuthorizationUnchanged();
});

test("13. no personal time is invented when the contract does not carry one", () => {
  // EX-TRN-MULTI-SLOT RE-POINT — a personal-time line is now rendered by
  // mapping over `row.personalSlots`, not by a single nullable field behind an
  // explicit-null guard: an empty array renders nothing, and the array itself
  // (built entirely server-side by the committed trainee core) is the
  // fail-closed gate. Neither the start nor the end is ever defaulted from the
  // block times or from a duration.
  for (const fallback of [
    "personalSlots ??",
    "personalSlots ||",
    "?? row.startTime",
    "?? row.displayEndTime",
    "DEFAULT_DURATION",
    "addMinutes",
  ]) {
    assert.equal(SECTION_CODE.includes(fallback), false, `the UI invents a personal time: ${fallback}`);
  }
  // The block start/end are shown as the ROW's times, never relabelled as the
  // viewer's own.
  //
  // EX-ROLE-SCHEDULE-REDESIGN RE-POINT — this count was ONE, when both trainee
  // views shared a single card. "לו״ז שלי" is now a different, much shorter card
  // of its own, so the personal-time line's rendering site exists once per view.
  // The claim is replaced by the property it was standing in for: EVERY
  // personal-time rendering site is driven by `row.personalSlots.map(`, and
  // there are exactly as many map sites as `.map(` call sites.
  const personalLines = (SECTION_CODE.match(/השעה שלך/g) ?? []).length;
  assert.equal(personalLines, 2, "a personal-time line was added or dropped");
  assert.equal(
    (SECTION_CODE.match(/row\.personalSlots\.map\(/g) ?? []).length,
    personalLines,
    "a personal-time line is not driven by row.personalSlots",
  );
});

test("14. no internal id and no raw contract object is rendered", () => {
  // EX-EXAM-TP-SAME-PARENT RE-POINT — `parentName`, `parentPhone` and
  // `children` LEAVE the blanket sweep, and nothing else does.
  //
  // They were banned because this screen had no reason to name Teaching-
  // Practice child/parent fields at all. That stopped being true the moment
  // the real same-parent badge/popup were approved: building
  // `examSameParentOtherNamesByChildId` (the SAME construction
  // "ההתנסויות שלי" already performs for its own badge) requires reading
  // `lesson.children` and each child's `parentName`/`parentPhone` to compute
  // the client-side lookup Map the shared, separately-reviewed
  // `buildSameParentOtherNamesByChildId` needs. The claim is REPLACED below
  // by an EXACT approved-use count, confined to that ONE construction site -
  // none of the three is ever interpolated into rendered JSX in this file;
  // every child/parent VALUE that reaches the screen is rendered only inside
  // the shared `TeachingPracticeLessonCard`/`TeachingPracticeSameParentPopup`
  // components, whose own render suites pin exactly what they show.
  for (const token of [
    "JSON.stringify",
    "Object.entries",
    "Object.keys",
    "{...row}",
    "{...view}",
    "definitionId",
    "assignmentId",
    "lessonId",
    "childAssignmentId",
    "planId",
    "studentId",
    "instructorId",
    "traineeId",
    "courseOfferingId",
    "nationalId",
    "identityNumber",
    "childNotes",
    "equipmentNotes",
    "email",
    "phone",
    "narrowingIssues",
    "diagnostics",
  ]) {
    assert.equal(SECTION_CODE.includes(token), false, `the UI reaches ${token}`);
  }
  // The ONE approved construction site, and nowhere else.
  const badgeMapStart = SECTION_CODE.indexOf("const examSameParentOtherNamesByChildId = useMemo(() => {");
  assert.notEqual(badgeMapStart, -1, "the same-parent badge map construction is missing");
  const badgeMapEnd = SECTION_CODE.indexOf("}, [myTeachingPracticeLessons]);", badgeMapStart);
  assert.ok(badgeMapEnd > badgeMapStart);
  const badgeMapBlock = SECTION_CODE.slice(badgeMapStart, badgeMapEnd);
  for (const token of ["parentName", "parentPhone", "children"]) {
    const totalCount = SECTION_CODE.split(token).length - 1;
    const insideCount = badgeMapBlock.split(token).length - 1;
    assert.equal(
      totalCount,
      insideCount,
      `${token} is read outside the one approved same-parent construction site`,
    );
  }
  assert.equal((SECTION_CODE.match(/parentName/g) ?? []).length, 2, "parentName's approved use count changed");
  assert.equal((SECTION_CODE.match(/parentPhone/g) ?? []).length, 2, "parentPhone's approved use count changed");
  assert.equal((SECTION_CODE.match(/\bchildren\b/g) ?? []).length, 1, "children's approved use count changed");
  // Never interpolated into JSX text content directly in this file - the
  // values only ever flow INTO the Map that `buildSameParentOtherNamesByChildId`
  // returns, never printed here.
  for (const token of ["{c.parentName}", "{c.parentPhone}", ">{c.parentName", ">{c.parentPhone"]) {
    assert.equal(SECTION_CODE.includes(token), false, `${token} is rendered directly in this file`);
  }
  // EX-BEGINNER-EXAM-UI RE-POINT — the bare token `beginner` LEAVES the sweep,
  // and nothing else does.
  //
  // It was on the list because this screen had no reason to name the sibling
  // beginner detail, and that turned out to be exactly the defect: live beginner
  // rows arrived with their detail attached and the screen rendered none of it,
  // so a trainee saw an empty card where a Teaching-Practice lesson should have
  // been. Satisfying the old claim now means keeping that defect.
  //
  // EX-EXAM-TP-CARDS RE-POINT — the hand-off count drops from TWO to ONE.
  // "לו״ז שלי" no longer routes a live beginner row to `ExamBeginnerRows` at
  // all: `myAdvancedRows` excludes every beginner row before `selfViewEntries`
  // is built, so there is no `row.beginner` left to read there. ONLY "לפי
  // תאריך" still carries the (dead, since `filteredRows` already excludes
  // every beginner row too — EX-C2-0-SUSPEND-UI) hand-off. The claim is an
  // EXACT approved-use list, which is stronger than the ban it replaces: the
  // ONE remaining detail is handed WHOLE to the shared beginner renderer and
  // is never indexed into here. Every child, parent and contact field
  // therefore stays out of this file, which is why `parentName`,
  // `parentPhone`, `childNotes`, `equipmentNotes`, `childAssignmentId` and
  // `children` all stay swept above. They are rendered only inside
  // `lib/components/ExamBeginnerRows.tsx`, whose own render suite pins exactly
  // what it shows.
  assert.ok(
    SECTION_CODE.includes("<ExamBeginnerRows detail={row.beginner} />"),
    "the trainee screen does not render the live beginner detail",
  );
  assert.ok(
    SECTION_CODE.includes('from "@/lib/components/ExamBeginnerRows"'),
    "the beginner detail is not the shared renderer",
  );
  assert.equal(
    (SECTION_CODE.match(/row\.beginner/g) ?? []).length,
    1,
    "the beginner detail is read beyond the one approved hand-off",
  );
  assert.equal(
    (SECTION_CODE.match(/<ExamBeginnerRows/g) ?? []).length,
    1,
    "a view still routes to ExamBeginnerRows, or a third renderer was added",
  );
  // THE OPERATIONAL OPT-IN IS NEVER SET HERE. Lesson notes and lesson
  // publication state are not on the trainee contract, and this screen must not
  // ask for them even if they one day were.
  assert.equal(
    SECTION_CODE.includes("showOperationalDetail"),
    false,
    "the trainee screen asks for the operational beginner detail",
  );
  for (const token of [
    "row.beginner.",
    "row.beginner?",
    "beginner.children",
    "beginner.participantNames",
    "beginnerFormat",
    "beginnerChildCount",
  ]) {
    assert.equal(SECTION_CODE.includes(token), false, `the screen reaches into ${token}`);
  }
  // EX-EXAM-TP-CARDS — the SAME privacy shape, restated for the real
  // Teaching-Practice card: `entry.lesson` is handed WHOLE to
  // `TeachingPracticeLessonCard` and is never indexed into here, exactly like
  // `row.beginner` above. Every child/parent/contact field the lesson DTO
  // carries therefore stays out of this file too - it is rendered only inside
  // the shared card, whose own render suite pins exactly what it shows.
  assert.ok(
    SECTION_CODE.includes("<TeachingPracticeLessonCard"),
    "the real Teaching-Practice card is not wired",
  );
  assert.equal(
    (SECTION_CODE.match(/<TeachingPracticeLessonCard/g) ?? []).length,
    1,
    "the real card is rendered more than once, or not at all",
  );
  // EX-EXAM-TP-SAME-PARENT RE-POINT — `lesson.children` LEAVES this
  // particular ban (it is now the ONE approved same-parent construction site,
  // checked precisely above); `lesson.participants`/`.location`/
  // `.practiceType` are still never read anywhere in this file.
  for (const token of ["lesson.participants", "lesson.location", "lesson.practiceType"]) {
    assert.equal(SECTION_CODE.includes(token), false, `the screen reaches into ${token}`);
  }
  // The ONE field read out of `entry.lesson` (the merged/tagged self-view
  // entry, as opposed to the same-parent loop's own `lesson` variable above)
  // is `.id`, used ONLY as the React list key - the same positional-key
  // pattern already approved for `row.rowKey` above, never a privacy field.
  assert.deepEqual(
    Array.from(new Set(SECTION_CODE.match(/entry\.lesson\.\w+/g) ?? [])).sort(),
    ["entry.lesson.id"],
    "a field of entry.lesson beyond .id (the list key) is read directly",
  );
  // EX-TRAINEE-ID-CONTAINMENT RE-POINT — the list key is `row.rowKey`, not
  // `row.sessionId`. The trainee contract no longer carries a session id at
  // all: it was a database primary key (or, for a live beginner row, the
  // synthetic `tp:<lessonId>` carrying ANOTHER primary key inside it), and the
  // ONLY use it ever had here was as this very list key. `rowKey` is the
  // POSITIONAL replacement — it addresses a position in a list the client
  // already holds and carries no database identity.
  assert.ok(SECTION_CODE.includes("key={row.rowKey}"), "the approved list key is missing");
  assert.equal(
    (SECTION_CODE.match(/key=\{row\.rowKey\}/g) ?? []).length,
    2,
    "the list key is not the only use of the row key",
  );
  assert.equal(SECTION_CODE.includes("sessionId"), false, "a session id is used in the screen");
  // The UI queries nothing itself.
  for (const token of [PRISMA_MODULE, GENERATED_CLIENT, "prisma."]) {
    assert.equal(SECTION_CODE.includes(token), false, `the UI reaches ${token}`);
  }
});

test("14b. the approved trainee display fields are the ones rendered", () => {
  for (const field of [
    "row.date",
    "row.definitionName",
    "row.startTime",
    "row.displayEndTime",
    "row.arena",
    "row.location",
    "row.isSelf",
    "row.selfLabel",
    "row.personalSlots",
    "slot.role",
    "slot.startTime",
    "slot.endTime",
    "row.examineeNames",
    "row.examineeCount",
    "row.instructedTraineeNames",
    "row.instructedTraineeCount",
  ]) {
    assert.ok(SECTION_CODE.includes(field), `${field} is not displayed`);
  }
  // Both trainee views are served from the SAME fetched contract...
  assert.ok(SECTION_CODE.includes("view.myRows") && SECTION_CODE.includes("view.allRows"));
  // EX-TRAINEE-DATE-NAV RE-POINT — `ALL_MODE_LABEL` / "לו״ז כולם". The general
  // schedule is GONE from the trainee screen: the approved product rule gives a
  // trainee exactly two views, "לפי תאריך" and "לו״ז שלי", so asserting the
  // presence of a third label would pin the opposite of the approved work. The
  // claim is REPLACED by the EXACT two-label membership, and by the strictly
  // stronger absence check in test 14i below.
  assert.ok(SECTION.includes('const DATE_MODE_LABEL = "לפי תאריך";'));
  assert.ok(SECTION.includes('const SELF_MODE_LABEL = "לו״ז שלי";'));
  // ...and no field the trainee contract does not carry is stubbed out. This
  // list was RE-POINTED by EX-ROLE-OP-UI-MVP: the contract now carries the horse,
  // the instruction topic, the discipline and the resolved pairing for every
  // participant, so asserting their absence would pin a claim that is no longer
  // true. Grade, feedback and rating are still absent, so they stay pinned.
  for (const absent of ["grade", "feedback", "rating"]) {
    assert.equal(
      new RegExp(absent, "i").test(SECTION_CODE),
      false,
      `the UI invents a ${absent} placeholder`,
    );
  }
});

test('14c. "לו״ז כולם" renders the COMPLETE operational schedule, through the shared renderer', () => {
  // Every visible row's assignment rows are handed to the shared renderer
  // VERBATIM — the whole array, in the contract's own order, with no filter,
  // slice, sort or re-map in between.
  assert.ok(
    SECTION_CODE.includes("<ExamAssignmentRows assignments={row.assignments} />"),
    "the trainee screen does not render the operational assignment rows",
  );
  assert.ok(
    SECTION_CODE.includes('from "@/lib/components/ExamAssignmentRows"'),
    "the trainee screen does not mount the shared renderer",
  );
  assert.equal(
    (SECTION_CODE.match(/<ExamAssignmentRows\s/g) ?? []).length,
    1,
    "a second, view-specific full-schedule renderer was added",
  );

  // EX-ROLE-SCHEDULE-REDESIGN RE-POINT — the ONE-row-loop claim, and the
  // `mode === "self" ? view.myRows : view.allRows` expression.
  //
  // Both described the state in which the two views were the SAME card with
  // different rows in it. That is exactly what made "לו״ז שלי" unreadable: a
  // trainee looking for their own horse was handed the whole day's
  // all-participants structure with their row merely ringed inside it. The
  // approved redesign makes the personal view a different, much shorter card, so
  // a claim that the two views render identically is one the approved work
  // contradicts.
  //
  // What REPLACES it is the property that actually mattered, and it is checked
  // in full by test 14e below: the personal view still shows only rows the
  // SERVER marked as the viewer's, and it can show no operational value that the
  // server did not tie to the viewer. `row.assignments` is read exactly three
  // times, each an EXACT approved use:
  const APPROVED_ASSIGNMENT_USES = [
    // "לו״ז כולם": the whole array, verbatim, to the shared renderer.
    "<ExamAssignmentRows assignments={row.assignments} />",
    // "לו״ז כולם": the participant summary is skipped when the rows below would
    // reprint the very same names.
    "{row.assignments.length === 0 && (",
    // "לו״ז שלי": the whole array to the personal-detail renderer, which reaches
    // it ONLY through the pure core's fail-closed self-selector.
    "assignments={row.assignments}",
  ];
  for (const fragment of APPROVED_ASSIGNMENT_USES) {
    assert.ok(SECTION_CODE.includes(fragment), `approved use is missing: ${fragment}`);
  }
  assert.equal(
    (SECTION_CODE.match(/row\.assignments/g) ?? []).length,
    3,
    "the assignment rows are read somewhere beyond the three approved uses",
  );
  // None of the three reaches INTO the array: the screen indexes, filters,
  // slices, sorts and re-maps nothing.
  for (const token of [
    "row.assignments[",
    "row.assignments.filter",
    "row.assignments.map",
    "row.assignments.slice",
    "row.assignments.sort",
    "row.assignments.find",
    "row.assignments.some",
  ]) {
    assert.equal(SECTION_CODE.includes(token), false, `the screen reaches into ${token}`);
  }
  // The two views are still served from the SAME fetched contract, and the
  // personal one is still the SERVER's own list.
  assert.ok(SECTION_CODE.includes("const myRows = view === null ? [] : view.myRows;"));
  assert.ok(SECTION_CODE.includes("const allRows = view === null ? [] : view.allRows;"));

  // THE SCREEN ITSELF DECIDES NOTHING ABOUT THEM, so it cannot grow a second,
  // disagreeing copy of the role labels, the personal window, the horse, the
  // topic, the discipline or the pairing.
  for (const token of [
    "horseName",
    "instructionTopic",
    "discipline",
    "personalStartTime",
    "personalEndTime",
    "pairedParticipantName",
    "pairedParticipantNames",
  ]) {
    assert.equal(SECTION_CODE.includes(token), false, `the screen re-implements ${token}`);
  }
  for (const token of ["pairingIndex", "resolvePairing", "computePairing", "addMinutes", "parseInt"]) {
    assert.equal(SECTION_CODE.includes(token), false, `the screen duplicates ${token}`);
  }
});

// ===========================================================================
// 14e–14g. EX-ROLE-SCHEDULE-REDESIGN — the compact personal view and the
//          navigation inside "לו״ז כולם"
// ===========================================================================

test('14e. "לו״ז שלי" is COMPACT: only the viewer\'s rows, and only their own detail', () => {
  // EX-EXAM-TP-CARDS RE-POINT — it renders `selfViewEntries`, the chronological
  // merge of `myAdvancedRows` (itself `view.myRows` with beginner rows removed
  // - the SAME server list as before, just no longer including the rows now
  // shown as real cards) and the trainee's real beginner Teaching-Practice
  // lessons. It is still built from nothing the server did not already send.
  assert.match(
    SECTION_CODE.replace(/\s+/g, " "),
    /mode === "self" && selfViewEntries\.map\(\(entry\) => \{/,
    "the personal view is not built from the server's own row list plus the real lessons",
  );
  assert.ok(
    SECTION_CODE.includes("const myAdvancedRows = myRows.filter((row) => !isBeginnerExamRow(row));"),
    "myAdvancedRows is not derived from the server's own myRows",
  );
  assert.ok(
    SECTION_CODE.includes(
      "const selfViewEntries = buildSelfViewEntries(myAdvancedRows, beginnerLessonsForSelfView);",
    ),
    "selfViewEntries is not built from myAdvancedRows and the real lessons",
  );

  // It does NOT reprint the all-participants structure: no participant summary
  // and no full block schedule inside the personal card. Both live in the
  // "לו״ז כולם" branch, which is the only place `<ExamAssignmentRows>` and the
  // `PeopleLine` summary appear.
  // EX-TRAINEE-DATE-NAV RE-POINT — the everyone view's mode token is now
  // `"date"`, because that IS the view: one date at a time, and no general
  // schedule to fall back to. The locator is otherwise unchanged.
  const personalStart = SECTION_CODE.indexOf('mode === "self" &&');
  const personalEnd = SECTION_CODE.search(/mode === "date" &&\s+groups\.map\(/);
  assert.ok(personalStart >= 0 && personalEnd > personalStart, "the two view branches could not be located");
  const personal = SECTION_CODE.slice(personalStart, personalEnd);
  for (const token of ["<ExamAssignmentRows", "<PeopleLine", "examineeNames", "instructedTraineeNames"]) {
    assert.equal(
      personal.includes(token),
      false,
      `the personal view reprints the all-participants structure: ${token}`,
    );
  }

  // What it DOES carry is exactly the approved short list: the exam name, the
  // date, the block time, the place, the viewer's own label, role and personal
  // window — and the viewer's own operational detail through the shared
  // fail-closed renderer.
  for (const fragment of [
    "row.definitionName",
    "row.date",
    "row.startTime",
    "row.displayEndTime",
    "row.arena ?? row.location",
    "row.selfLabel",
    "row.personalSlots",
    "slot.role",
    "slot.startTime",
    "slot.endTime",
  ]) {
    assert.ok(personal.includes(fragment), `the personal view dropped ${fragment}`);
  }
  assert.ok(
    personal.includes("<ExamPersonalAssignmentDetail"),
    "the personal view shows no horse, topic, discipline or counterpart",
  );
  assert.ok(
    SECTION_CODE.includes('from "@/lib/components/ExamPersonalAssignmentDetail"'),
    "the personal detail is not the shared renderer",
  );
  assert.equal(
    (SECTION_CODE.match(/<ExamPersonalAssignmentDetail/g) ?? []).length,
    1,
    "a second personal-detail renderer was added",
  );
});

test('14f. "לו״ז שלי" finds the viewer through the SERVER-DERIVED assignment marker', () => {
  // EX-BEGINNER-EXAM-READ INTEGRATION. The trainee contract now marks the
  // viewer's OWN assignment with `isSelf`, decided server-side by exact
  // student-id equality against the identity proven from the signed session. The
  // screen therefore hands over the rows and NOTHING else: the previous `role` /
  // `startTime` / `endTime` selection props are gone, because there is no longer
  // anything for the browser to select with.
  assert.ok(
    SECTION_CODE.includes("<ExamPersonalAssignmentDetail assignments={row.assignments} />"),
    "the personal detail is not handed the rows verbatim",
  );
  const props = SECTION_CODE.slice(
    SECTION_CODE.indexOf("<ExamPersonalAssignmentDetail"),
    SECTION_CODE.indexOf("<ExamPersonalAssignmentDetail") + 400,
  );
  for (const forbidden of [
    "role={",
    "startTime={",
    "endTime={",
    "participantName=",
    "viewerName=",
    "studentId=",
    "selfName=",
    "isSelf={",
  ]) {
    assert.equal(props.includes(forbidden), false, `the personal detail is given ${forbidden}`);
  }

  // THE REMOVED HEURISTIC. The screen used to hand over `selfRole` plus the
  // exact personal window so the browser could match the viewer's row among the
  // block's assignments. Those three values are still RENDERED — as the viewer's
  // own label and their own time, which is what they are for — but they no
  // longer reach anything that SELECTS with them, and this file names no
  // selection rule of any kind.
  for (const token of [
    "selectSelfAssignmentDetail",
    "selectSelfAssignmentRow",
    "ExamSelfMarker",
    "isSelf ===",
    "assignments.find",
    "assignments.filter",
  ]) {
    assert.equal(SECTION_CODE.includes(token), false, `the screen selects the viewer by ${token}`);
  }

  // The row-level highlight is still the server's boolean, in BOTH views.
  assert.equal(
    (SECTION_CODE.match(/row\.isSelf \?/g) ?? []).length,
    2,
    "a view stopped deriving its highlight from the server marker",
  );
  // ...and every `isSelf` the screen names is READ from the contract. It builds
  // none of its own.
  assert.equal(
    (SECTION_CODE.match(/isSelf/g) ?? []).length,
    (SECTION_CODE.match(/row\.isSelf/g) ?? []).length,
    "the screen names an isSelf that did not come from the contract row",
  );
});

test('14g. "לפי תאריך" navigates the loaded day, and never re-reads it', () => {
  // EX-TRAINEE-DATE-NAV RE-POINT — the three connected views, "הכל", and the
  // shared `ExamScheduleNav`.
  //
  // Those claims described the trainee screen while it offered a general
  // schedule, a by-exam-type schedule and a by-date schedule. The approved
  // product rule gives a trainee exactly TWO views — "לפי תאריך" and
  // "לו״ז שלי" — so a claim that a general option and an exam-type option are
  // rendered here is one the approved work contradicts, and satisfying it would
  // mean putting both back.
  //
  // The claim is REPLACED by the same property about the control that took their
  // place: the date sub-tabs are the SHARED, separately tested `ExamDateTabs`
  // over rows already in hand, they are scoped to the same one view, and — the
  // part that actually mattered — navigating still issues NO request, which is
  // re-checked in full below. The instructor screen keeps `ExamScheduleNav`
  // unchanged; test 15 pins that this slice did not fork it.
  assert.ok(
    SECTION_CODE.includes('from "@/lib/components/ExamDateTabs"'),
    "the screen does not mount the shared date sub-tabs",
  );
  assert.equal(
    (SECTION_CODE.match(/<ExamDateTabs\s/g) ?? []).length,
    1,
    "a second navigation control was added",
  );
  // The three-view bar is GONE from this screen entirely — not merely unused.
  assert.equal(
    SECTION_CODE.includes("ExamScheduleNav"),
    false,
    "the trainee screen still mounts the general/by-type navigation bar",
  );
  // The sub-tabs appear in "לפי תאריך" ONLY: the personal view is already the
  // shortest list on the screen.
  assert.ok(
    SECTION_CODE.includes('mode === "date" && !scheduleIsEmpty && ('),
    "the date sub-tabs are not scoped to the date view",
  );

  // The option list and the narrowing come from the PURE view core, so this
  // screen holds no filtering rule of its own to disagree with the instructor
  // screen's. The exam-type option list is no longer derived at all — there is
  // no view left that could show it.
  assert.ok(SECTION_CODE.includes('from "@/lib/components/exam-schedule-view-core"'));
  assert.ok(
    SECTION_CODE.includes("listExamDates(allRows)"),
    "the dates are not derived from the loaded day",
  );
  assert.equal(
    SECTION_CODE.includes("listExamDefinitionNames"),
    false,
    "the screen still derives an exam-type option list",
  );
  assert.ok(SECTION_CODE.includes("filterExamRows(allRows, {"), "the views are not one narrowing");

  // NAVIGATING ISSUES NO REQUEST. There is exactly one exam-schedule server
  // call, it takes the DATE and nothing else, and the load is keyed by that
  // date alone — so no view selection can re-read, widen or reach past the
  // reader.
  const calls = SECTION_CODE.match(/getTraineeExamSchedule\([^)]*\)/g) ?? [];
  assert.deepEqual(calls, ["getTraineeExamSchedule()"]);
  // EX-EXAM-TP-CARDS RE-POINT — a SECOND `useEffect` now exists, for the
  // trainee's real Teaching-Practice lessons (test 4 in the sibling suite
  // pins that its OWN call, `listMyTeachingPracticeLessonsForTrainee`, is
  // issued exactly once). Both effects are independent, ONE-LOAD-ON-MOUNT
  // effects with empty dependency arrays - neither can re-enter on a
  // mode/date-tab change, and neither depends on the other's state.
  assert.equal((SECTION_CODE.match(/useEffect\(/g) ?? []).length, 2);
  // EX-TRAINEE-MULTIDAY-READ RE-POINT — the effect was keyed by the DATE, which
  // is what made every date change a fresh request and left the sub-tabs holding
  // exactly one date. The dependency list is now EMPTY, which is the strongest
  // possible form of "navigating issues no request": there is no value left that
  // could re-enter the effect at all. BOTH effects now end this way.
  assert.equal(
    (SECTION_CODE.match(/\}, \[\]\);/g) ?? []).length,
    2,
    "both the exam-schedule and the Teaching-Practice load must be loaded exactly once, on mount",
  );
  assert.equal(
    SECTION_CODE.includes("}, [selectedDate]);"),
    false,
    "the screen still re-reads the server per date",
  );
  for (const token of ["navMode]", "navDate]", "navDefinitionName]", "mode]", "activeDate]"]) {
    assert.equal(SECTION_CODE.includes(token), false, `the load now depends on ${token}`);
  }
  // ...and the narrowing runs over the contract as it ARRIVED.
  for (const token of [
    "allRows.concat(",
    "allRows.push(",
    "view.allRows.concat(",
    "view.allRows.push(",
    "...allRows",
    "...view.allRows",
  ]) {
    assert.equal(SECTION_CODE.includes(token), false, `the screen builds rows with ${token}`);
  }
});

test("14h. the participant summary is not printed twice on one block", () => {
  // A block whose operational rows are rendered below already names every
  // examinee and every instructed trainee, in their waves and with their horses.
  assert.ok(
    SECTION_CODE.includes("{row.assignments.length === 0 && ("),
    "the duplicate participant summary was not removed",
  );
  const guardStart = SECTION_CODE.indexOf("{row.assignments.length === 0 && (");
  const handOff = SECTION_CODE.indexOf("<ExamAssignmentRows");
  assert.ok(handOff > guardStart, "the summary no longer sits above the operational rows");
  const summary = SECTION_CODE.slice(guardStart, handOff);
  assert.ok(summary.includes("row.examineeNames"), "the examinee summary moved out of the guard");
  assert.ok(
    summary.includes("row.instructedTraineeNames"),
    "the trainee summary moved out of the guard",
  );
  // Both summary lines are inside the ONE guard: neither survives on a block
  // whose rows are about to name the same people.
  assert.equal(
    (SECTION_CODE.match(/<PeopleLine/g) ?? []).length,
    2,
    "a participant summary line escaped the duplicate guard",
  );
});

test('14d. "לו״ז שלי" still identifies "mine" by the server-computed marker, never by name', () => {
  // The personal view is `view.myRows`, which the committed trainee core derived
  // server-side from the SIGNED SESSION and handed over as the boolean `isSelf`.
  // The highlight, the label and the personal window all hang off that same
  // marker — no id crosses the boundary, and none is needed.
  assert.ok(SECTION_CODE.includes("view.myRows"), "the personal view is no longer the server filter");
  assert.ok(SECTION_CODE.includes("row.isSelf ?"), "the viewer's own row is no longer highlighted");
  assert.ok(SECTION_CODE.includes("row.selfLabel !== null &&"), "the self label was dropped");
  assert.ok(SECTION_CODE.includes("row.personalSlots"), "the viewer's own personal slots were dropped");
  assert.ok(SECTION_CODE.includes("slot.role"), "the viewer's own role was dropped");

  // NO NAME IS EVER COMPARED to decide what is "mine". A display name is not an
  // identity: two trainees may share one, and the screen holds no name of the
  // viewer to compare against in the first place.
  for (const token of [
    "participantName ===",
    "=== row.participantName",
    "participantName ==",
    "selfLabel ===",
    ".includes(row.participantName",
    "localeCompare",
    "viewerName",
    "myName",
  ]) {
    assert.equal(SECTION_CODE.includes(token), false, `the UI matches identity by ${token}`);
  }
  // ...and no id was added to the client contract to highlight a line either.
  for (const token of ["viewerStudentId", "selfAssignmentId", "selfStudentId"]) {
    assert.equal(SECTION_CODE.includes(token), false, `the UI reaches ${token}`);
  }
});

// ===========================================================================
// 14i–14m. EX-TRAINEE-DATE-NAV — exactly two views, and a date-only schedule
// ===========================================================================

test("14i. a trainee is offered EXACTLY TWO top-level views, and no other", () => {
  // The two approved labels, and exactly one button each.
  assert.ok(SECTION.includes('const DATE_MODE_LABEL = "לפי תאריך";'));
  assert.ok(SECTION.includes('const SELF_MODE_LABEL = "לו״ז שלי";'));
  assert.equal((SECTION_CODE.match(/\{DATE_MODE_LABEL\}/g) ?? []).length, 1);
  assert.equal((SECTION_CODE.match(/\{SELF_MODE_LABEL\}/g) ?? []).length, 1);
  // The mode union has exactly two members, so a third view is not
  // representable, and every render branch is one of the two.
  assert.ok(SECTION_CODE.includes('type DayMode = "date" | "self";'));
  const modes = [...SECTION_CODE.matchAll(/mode === "(\w+)"/g)].map(([, name]) => name);
  assert.deepEqual([...new Set(modes)].sort(), ["date", "self"]);
});

test("14j. the general and by-exam-type views are GONE — no label, no control, no state", () => {
  // NEITHER LABEL EXISTS IN THE FILE AT ALL. Asserted on the RAW source rather
  // than the stripped code, which is deliberately stricter than this suite's
  // usual convention: a commented-out label is one keystroke from being a
  // rendered one, and there is no legitimate reason for this screen to hold the
  // text of a view it does not have.
  for (const label of ["לו״ז כללי", "לפי סוג מבחן", "לו״ז כולם"]) {
    assert.equal(SECTION.includes(label), false, `the trainee screen still holds ${label}`);
  }
  // ...and "הכל", the old general option inside the everyone view, is gone with
  // the view it belonged to.
  assert.equal(
    SECTION_CODE.includes("ALL_FILTER_LABEL"),
    false,
    "the general filter option survived",
  );
  // No exam-type axis remains anywhere: no state, no option list, no filter.
  for (const token of [
    "navDefinitionName",
    "listExamDefinitionNames",
    "definitionNames",
    "ExamScheduleNavMode",
    "navMode",
    'definitionName: nav',
  ]) {
    assert.equal(SECTION_CODE.includes(token), false, `the exam-type axis survives as ${token}`);
  }
  // The one place a definition name still appears is the row's own TITLE, which
  // is what an exam is called — not an axis to navigate by.
  assert.equal((SECTION_CODE.match(/row\.definitionName/g) ?? []).length, 2);
  // The narrowing states the exam-type axis as UNCONDITIONALLY unconstrained, so
  // no selection can reintroduce it.
  assert.ok(
    SECTION_CODE.includes("definitionName: null,"),
    "the exam-type axis is not hard-wired to unconstrained",
  );
});

test("14k. the date sub-tabs default SAFELY to the earliest available date", () => {
  // The default comes from the PURE core, which is where it is tested against
  // month and year boundaries, blank tokens and an empty list.
  assert.ok(
    SECTION_CODE.includes("earliestExamDate(dates)"),
    "the default is not the earliest available date",
  );
  // An explicit selection is honoured ONLY while the contract still carries it;
  // anything else falls back to that earliest date. There is no "all dates"
  // state to fall into.
  assert.ok(
    SECTION_CODE.includes(
      "navDate !== null && dates.includes(navDate) ? navDate : earliestExamDate(dates)",
    ),
    "a stale or absent selection does not fall back to the earliest date",
  );
  // EX-TRAINEE-MULTIDAY-READ RE-POINT — the "a new day drops the selection"
  // reset. There is no day to change any more: the schedule is loaded once and
  // the contract does not move underneath the selection. The reset is therefore
  // gone, and the stale-selection case it guarded is handled by the fallback
  // above, which is checked on every render rather than only on a day change.
  assert.equal(
    SECTION_CODE.includes("setNavDate(null)"),
    false,
    "a selection reset survives, though there is no longer a day change to reset on",
  );
  // The setter is named exactly twice — where it is declared, and where it is
  // handed to the sub-tabs — so the ONLY thing that can ever move the selection
  // is a reader tapping a date.
  assert.equal((SECTION_CODE.match(/setNavDate/g) ?? []).length, 2);
  assert.ok(SECTION_CODE.includes("const [navDate, setNavDate] = useState<string | null>(null);"));
  assert.ok(SECTION_CODE.includes("onSelectDate={setNavDate}"));
  // The sub-tabs are always given the RESOLVED date, never the raw state, so the
  // chip that is highlighted is the date that is actually being shown.
  assert.ok(
    SECTION_CODE.includes("<ExamDateTabs dates={dates} selectedDate={activeDate}"),
    "the sub-tabs are not given the resolved selection",
  );
});

test("14l. ONE date is shown at a time, ordered by start time", () => {
  // The narrowing is by the RESOLVED date, so the view holds one date's rows and
  // never the whole contract.
  assert.ok(
    SECTION_CODE.includes("date: activeDate,"),
    "the view is not narrowed to the selected date",
  );
  // ...and those rows are ordered chronologically by the PURE core before they
  // are grouped, so this screen holds no comparator of its own.
  assert.ok(
    SECTION_CODE.includes("groupRowsByDate(sortExamRowsByStartTime(filteredRows))"),
    "the selected date's rows are not ordered by start time",
  );
  assert.equal((SECTION_CODE.match(/sortExamRowsByStartTime\(/g) ?? []).length, 1);
  for (const token of [".sort(", "localeCompare", "orderIndex", "new Date(", "getTime()"]) {
    assert.equal(SECTION_CODE.includes(token), false, `the screen re-implements ordering: ${token}`);
  }
});

test("14m. live beginner rows are ROUTED away from the advanced renderer, in BOTH views", () => {
  // EX-EXAM-TP-CARDS RE-POINT — ONE routing conditional survives, not two.
  // "לו״ז שלי" no longer routes a beginner row to `ExamBeginnerRows` at all:
  // `myAdvancedRows` (see 14n below) excludes every beginner row before
  // `selfViewEntries` exists, so there is no `isBeginnerExamRow(row) ? (...)`
  // branch left to write there - a beginner row reaches that view as a REAL
  // Teaching-Practice card instead (see test 14 above). ONLY "לפי תאריך" still
  // carries this conditional, on the CONTRACT's own `source`, so a beginner
  // row cannot reach the wave/examinee renderer there even by accident.
  assert.equal(
    (SECTION_CODE.match(/\{isBeginnerExamRow\(row\) \? \(/g) ?? []).length,
    1,
    "a view still routes beginner rows to their own renderer, or the one remaining route was lost",
  );
  // The ORIGIN is the shared pure predicate, never a guess from emptiness.
  for (const token of ['=== "BEGINNER"', '=== "STORED"', "row.source ===", "row.kind ==="]) {
    assert.equal(SECTION_CODE.includes(token), false, `the screen re-implements the origin test: ${token}`);
  }
  // NO INVENTED ROLE. EX-TRN-MULTI-SLOT RE-POINT — the guard moved from this
  // screen into the contract itself: `TraineeExamPersonalSlotDto.role` is now
  // `null` for EVERY personal slot of a `BEGINNER` source row (see
  // `buildTraineeExamDayDto` in `lib/exam/exam-read-dto.ts`), so both views can
  // share the SAME per-slot rule — `slot.role === null` — without naming
  // `isBeginnerExamRow` at the label site at all. The property is unchanged: a
  // beginner row is never labelled with an invented exam role.
  assert.equal(
    (SECTION_CODE.match(/slot\.role === null \? null : SELF_ROLE_LABELS\[slot\.role\]/g) ?? [])
      .length,
    2,
    "a personal-slot role label is not guarded against a null (beginner) role",
  );
  assert.ok(
    SECTION_CODE.includes("{isBeginnerExamRow(row) ? (\n                    <ExamBeginnerRows") ||
      /isBeginnerExamRow\(row\) \? \(\s*<ExamBeginnerRows/.test(SECTION_CODE),
    "the beginner branch does not render the beginner detail first",
  );
  // The participant summary — the only place this screen prints "נבחנים" — sits
  // in the STORED branch, so it can never describe a beginner lesson.
  const storedBranch = SECTION_CODE.slice(SECTION_CODE.lastIndexOf(") : ("));
  assert.ok(storedBranch.includes("row.assignments.length === 0 && ("), "the summary left the stored branch");
  assert.equal((SECTION_CODE.match(/נבחנים/g) ?? []).length, 1);
});

test("14n. the personal view's beginner rows are the SERVER's relevance answer", () => {
  // `myRows` is `allRows.filter(isSelf)` from the committed trainee core, which
  // marked the row from the signed session's own student id. A beginner row is
  // in it for exactly that reason and no other — this screen performs no
  // matching of any kind, for beginner rows or for stored ones.
  assert.ok(SECTION_CODE.includes("const myRows = view === null ? [] : view.myRows;"));
  // EX-EXAM-TP-CARDS RE-POINT — `myAdvancedRows` is the ONE approved narrowing
  // of `myRows`: a PRESENTATIONAL split by the contract's own `source` (kept
  // vs. dropped, never re-derived), exactly replacing the dead
  // `isBeginnerExamRow(row) ? ... : ...` branch this view used to write
  // inline. It answers "is this a beginner row", never "is this row mine" -
  // that question is answered once, server-side, by `view.myRows` itself.
  assert.ok(
    SECTION_CODE.includes("const myAdvancedRows = myRows.filter((row) => !isBeginnerExamRow(row));"),
    "the personal view's advanced rows are not myRows with beginner rows split out",
  );
  assert.equal(
    (SECTION_CODE.match(/myRows\.filter/g) ?? []).length,
    1,
    "myRows is narrowed more than once, or by something other than the approved split",
  );
  // Nothing beginner-specific narrows or re-derives THAT relevance - no
  // second, disagreeing filter/find/some/concat over myRows or the real
  // Teaching-Practice lessons, and no name-based matching of any kind.
  for (const token of [
    "myRows.find",
    "myRows.some",
    "myRows.concat",
    "participantNames.includes",
    "children.some",
    "childName",
  ]) {
    assert.equal(SECTION_CODE.includes(token), false, `the screen re-derives relevance with ${token}`);
  }
  // ...and no viewer identity was introduced to compare with.
  for (const token of ["viewerStudentId", "selfStudentId", "myName", "viewerName"]) {
    assert.equal(SECTION_CODE.includes(token), false, `the screen reaches ${token}`);
  }
});

// ===========================================================================
// 14o–14q. EX-TRAINEE-MULTIDAY-READ — one load, real dates, no picker
// ===========================================================================

test("14o. the WHOLE schedule is loaded ONCE, and a date change reads nothing", () => {
  // ONE effect PER data source (see test 14g/4's own re-point - a second,
  // independent, empty-deps effect now also loads the real Teaching-Practice
  // lessons), ONE call each, and an EMPTY dependency list on both — so no view
  // selection, no date and no state of any kind can re-enter either.
  assert.equal((SECTION_CODE.match(/useEffect\(/g) ?? []).length, 2);
  assert.ok(SECTION_CODE.includes("}, []);"), "the load is not a mount-only effect");
  const calls = SECTION_CODE.match(/getTraineeExamSchedule\([^)]*\)/g) ?? [];
  assert.deepEqual(calls, ["getTraineeExamSchedule()"], "the schedule is read more than once");
  // The action itself takes no argument, so a per-date request is not merely
  // absent — it is unrepresentable through this seam.
  assert.equal(
    /getTraineeExamSchedule\(\s*[A-Za-z_$]/.test(SECTION_CODE),
    false,
    "a value is sent to the server",
  );
  // Nothing loops over dates issuing reads.
  for (const token of [
    "dates.map(",
    "dates.forEach",
    "Promise.all",
    "for (const date",
    "await getTrainee",
  ]) {
    assert.equal(SECTION_CODE.includes(token), false, `the screen reads per date via ${token}`);
  }
});

test("14p. the sub-tabs are the plan's REAL dates, not one fetched day", () => {
  // Derived from the loaded contract's own rows, so every tab has rows behind it
  // and a date the publication gates hid is not offered at all.
  assert.ok(SECTION_CODE.includes("const dates = listExamDates(allRows);"));
  assert.ok(SECTION_CODE.includes("<ExamDateTabs dates={dates}"));
  // The date the view shows is the one the tabs say is selected — one value,
  // used for both, so the highlighted tab cannot disagree with the rows below.
  assert.ok(SECTION_CODE.includes("selectedDate={activeDate}"));
  assert.ok(SECTION_CODE.includes("date: activeDate,"));
});

test("14q. NO native date picker remains anywhere on the screen", () => {
  for (const token of [
    "<input",
    'type="date"',
    "<label",
    "selectedDate,",
    "setSelectedDate",
    "getLocalDateKey",
    "trainee-exam-day",
  ]) {
    assert.equal(SECTION_CODE.includes(token), false, `a native date picker survives as ${token}`);
  }
  // The date-picker heading is gone from the rendered text too.
  assert.equal(
    />\s*תאריך\s*</.test(SECTION),
    false,
    "the date-picker label is still rendered",
  );
});

// ===========================================================================
// 15–17. Containment
// ===========================================================================

test("15. no instructor or admin exam file was modified", () => {
  // EX-ROLE-OP-UI-MVP RE-POINT — `INSTRUCTOR_SECTION_REL` LEAVES THIS LIST. The
  // operational-UI slice renders the same newly available assignment rows on
  // BOTH role screens, so the instructor section is a file it necessarily edits;
  // keeping it here would pin a claim the approved work contradicts. Its change
  // is pinned in full by the instructor suite's own tests 8-11, 10b and 15. The
  // instructor ACTION and CLIENT, and the shared bottom bar, keep the strictly
  // byte-identical claim, because this slice touches none of them.
  for (const relative of [
    INSTRUCTOR_ACTION_REL,
    INSTRUCTOR_CLIENT_REL,
    "lib/components/BottomTabs.tsx",
  ]) {
    assert.ok(unchangedSinceHead(relative), `${relative} was modified by this slice`);
  }
  const adminExams = "app/admin/courses/[courseOfferingId]/exams";
  // %s POST-MERGE. The exact-path snapshots this branch put here described an
  // UNCOMMITTED working tree; that work is now commit c0fa3d8, so both trees are
  // byte-identical to HEAD again and the guard's ORIGINAL strict-empty claim is
  // true once more. Restored rather than kept as a snapshot: `[]` is STRICTLY
  // STRONGER, and the merge from main touches neither tree.
  assert.deepEqual(gitLines(["diff", "--name-only", "HEAD", "--", adminExams]), []);
  assert.deepEqual(gitLines(["ls-files", "--others", "--exclude-standard", adminExams]), []);
  // EX-ROLE-SCHEDULE-REDESIGN RE-POINT — the instructor guard suite.
  //
  // This asserted that `INSTRUCTOR_SUITE_REL` was MODIFIED relative to HEAD: the
  // operational-UI slice re-pointed that suite's footprint claim, and while that
  // slice was in flight the modification was visible. It is an IN-FLIGHT claim by
  // construction — once any such slice is committed the tree is clean and the
  // assertion inverts — so it fails on its own success and can never hold again.
  //
  // It is REPLACED by the durable property it was standing in for: the
  // instructor suite still EXISTS and still carries its authorization
  // assertions, so no slice can have quietly emptied it while re-pointing a
  // footprint list. The instructor ACTION and CLIENT keep the strict
  // byte-identical claim just above, which is what actually protects the
  // instructor surface.
  const instructorSuite = read(INSTRUCTOR_SUITE_REL);
  for (const claim of [
    "assertScopeCoreAuthorizationUnchanged",
    // EX-TRAINEE-MULTIDAY-READ RE-POINT — the instructor suite's readers claim
    // moved from `git diff --quiet` (byte-identity) to `git diff -U0` plus an
    // EMPTY removed-line assertion, because the approved multi-day trainee read
    // ADDS a binding to that shared file. What is pinned here is the same thing
    // as before — that the instructor suite still HOLDS a readers-module claim
    // and has not been quietly emptied while being re-pointed — so the token is
    // updated to the command that claim now uses.
    '"diff", "-U0", "HEAD", "--", READERS_REL',
    "approvedSlicePaths",
  ]) {
    assert.ok(
      instructorSuite.includes(claim),
      `the instructor guard suite no longer states ${claim}`,
    );
  }

  // ...nor was anything about schema, identity, sessions or capabilities.
  // EX-ASG-MULTIPLICITY + EX-PAIR-NO-SELF - `prisma` leaves the STRICT-EMPTY loop, because the approved schema and
  // migration genuinely change it; it is snapshotted EXACTLY just below instead.
  // `lib/auth` and `lib/course/capabilities` keep the strict claim, unchanged.
  for (const dir of ["lib/auth", "lib/course/capabilities"]) {
    assert.deepEqual(gitLines(["diff", "--name-only", "HEAD", "--", dir]), []);
    assert.deepEqual(gitLines(["ls-files", "--others", "--exclude-standard", dir]), []);
  }
  // EX-ASG-MULTIPLICITY + EX-PAIR-NO-SELF - LIFECYCLE-PROOF. `diff --name-only HEAD` and `ls-files --others` SWAP
  // which of the two prisma paths they report the moment the branch is staged, so
  // splitting the claim across them was fragile. The de-duplicated three-way union
  // reports the same two plain paths in every lifecycle state.
  const prismaTouched = [
    ...new Set([
      ...gitLines(["diff", "--name-only", "HEAD", "--", "prisma"]),
      ...gitLines(["diff", "--name-only", "--cached", "HEAD", "--", "prisma"]),
      ...gitLines(["ls-files", "--others", "--exclude-standard", "--", "prisma"]),
    ]),
  ].sort();
  assert.deepEqual(prismaTouched, []);
  // EX-ROLE-OP-UI-MVP RE-POINT. An EXACT path allow-list of nine `lib/exam`
  // files was carried here while the operational-READ slice was in flight. That
  // slice is merged, so the exception describes nothing in the working tree any
  // more — it is a dead permission that would let an unrelated exam-core edit
  // through. The blanket claim is RESTORED at full strength: no file under that
  // directory may change, and no new file may appear in it.
  //
  // EX-TRAINEE-MULTIDAY-READ RE-POINT, narrowly. The approved multi-day trainee
  // read adds ONE reader to the pure scope core, so that ONE file — and its own
  // suite — are named EXACTLY here, never a directory and never a glob. NO NEW
  // FILE may appear under `lib/exam` at all: the claim below is unchanged on
  // that axis, so a new core, a new adapter or a new DTO still fails. What that
  // one file may contain is pinned far more tightly by
  // `assertScopeCoreAuthorizationUnchanged` above, which proves no committed
  // authorization line was removed or rewritten and that the added reader
  // authorizes exactly as the day reader does.
  const APPROVED_EXAM_CORE_PATHS = [
    // The ONE production file: the pure scope core, which gains one reader.
    "lib/exam/" + "exam-read-scope" + "-core.ts",
    // Its own suite, plus the two committed read-pipeline guard suites whose
    // exported-reader lists this addition necessarily re-points. All three are
    // TEST files — no production behaviour is behind any of them.
    "lib/exam/" + "exam-read-scope" + "-core.test.ts",
    "lib/exam/" + "exam-read-" + "dto.test.ts",
    "lib/exam/" + "exam-read" + ".contract.test.ts",

    // EX-ASG-MULTIPLICITY + EX-PAIR-NO-SELF - this branch's EXACT, CLOSED footprint.
    // ADDED, never widened: every entry is one exact literal path. No directory,
    // no prefix, no glob - an unrelated file still fails this guard. Module names
    // are SPLIT so this list never reads as a REFERENCE to the module it names.
    "lib/exam/admin-exam-examinee-pairing" + "-core.test.ts",
    "lib/exam/admin-exam-examinee-pairing" + "-core.ts",
    "lib/exam/create-exam-instructed-trainee-assignment" + "-core.test.ts",
    "lib/exam/create-exam-instructed-trainee-assignment" + "-core.ts",
    "lib/exam/create-exam-plan" + "-core.test.ts",
    "lib/exam/exam-conflict" + "-core.ts",
    "lib/exam/exam-pairing-write" + "-core.test.ts",
    "lib/exam/exam-pairing-write" + "-core.ts",
    "lib/exam/exam-schema-structure" + ".test.ts",
    "lib/exam/exam-supervisor-write" + "-core.test.ts",

    // EX-TRN-MULTI-SLOT RE-POINT — this slice's EXACT, CLOSED footprint. The
    // trainee reader stops dropping a whole session when the authenticated
    // trainee legitimately resolves to more than one assignment in it
    // (EX-ASG-MULTIPLICITY). Four files, all named exactly — the pure core and
    // its own suite, the DTO layer and the one sibling suite whose fixtures
    // exercise the same personal-slot shape.
    "lib/exam/exam-trainee-view" + "-core.ts",
    "lib/exam/exam-trainee-view" + "-core.test.ts",
    "lib/exam/exam-read-" + "dto.ts",
    "lib/exam/exam-stored-adapter" + "-core.test.ts",
];
  const changedExamCores = gitLines(["diff", "--name-only", "HEAD", "--", "lib/exam"]).map((path) =>
    path.split("\\").join("/"),
  );
  assert.deepEqual(
    changedExamCores.filter((path) => !APPROVED_EXAM_CORE_PATHS.includes(path)),
    [],
    "an unapproved lib/exam file was modified",
  );
  assert.deepEqual(gitLines(["ls-files", "--others", "--exclude-standard", "lib/exam"]), []);
});

test("16. no write, publish, supervisor or pairing control was added", () => {
  for (const token of [
    "<form",
    "<textarea",
    "<select",
    "onSubmit",
    "useActionState",
    "useTransition",
    "FormData",
    "action=",
    "unpublish",
    "setPublished",
    "createExam",
    "updateExam",
    "deleteExam",
    "Supervisor",
    "supervisor",
    "pairingIndex",
    "-write-",
  ]) {
    assert.equal(SECTION_CODE.includes(token), false, `the UI adds a ${token} control`);
  }
  // EX-TRAINEE-MULTIDAY-READ RE-POINT — the native day picker is GONE.
  //
  // This asserted that the screen held EXACTLY ONE input and that it was a
  // `type="date"` field. That picker existed only because the reader could serve
  // one day at a time; keeping it would leave a second, competing date selector
  // beside the sub-tabs — the very thing the approved product rule removes.
  //
  // The claim is REPLACED by the stronger one: the screen holds NO input at all,
  // so there is nothing on it that can be typed into, submitted or form-wired,
  // and the date sub-tabs are the only date selector that exists.
  assert.equal((SECTION_CODE.match(/<input/g) ?? []).length, 0, "an input control exists");
  assert.equal(SECTION_CODE.includes('type="date"'), false, "a native date picker survives");
  assert.equal(SECTION_CODE.includes("<label"), false, "a form label survives");
  assert.equal(SECTION_CODE.includes("name="), false, "a control is form-wired");
  // ...and no local date state feeds a request any more.
  for (const token of ["setSelectedDate", "getLocalDateKey", "onChange="]) {
    assert.equal(SECTION_CODE.includes(token), false, `the day picker survives as ${token}`);
  }
  // The two buttons are the view switch and nothing else: both are type="button"
  // and both only set local state. The DATE sub-tabs are buttons too, and they
  // live in their own separately tested component precisely so this count keeps
  // measuring what it was written to measure.
  assert.equal((SECTION_CODE.match(/<button/g) ?? []).length, 2, "an unexpected button exists");
  assert.equal((SECTION_CODE.match(/type="button"/g) ?? []).length, 2);
  // EX-TRAINEE-DATE-NAV RE-POINT — the everyone view's mode token is `"date"`.
  // The shape is unchanged and still EXACT: two buttons, each setting one of two
  // modes and doing nothing else.
  assert.deepEqual(SECTION_CODE.match(/onClick=\{\(\) => setMode\("(date|self)"\)\}/g), [
    'onClick={() => setMode("date")}',
    'onClick={() => setMode("self")}',
  ]);
  // ...and no third mode is even representable.
  assert.ok(
    SECTION_CODE.includes('type DayMode = "date" | "self";'),
    "the trainee screen has more or fewer than two top-level views",
  );
  // And there is no second course picker: this screen has no course to pick.
  for (const token of ["TraineeCourseSelector", "listTraineeCourseOptions", "CourseSelector"]) {
    assert.equal(SECTION_CODE.includes(token), false, `the section opens its own course menu`);
  }
});

test("17. the working tree holds only the approved paths of this slice and the operational-UI slice", () => {
  const touched = new Set([
    ...gitLines(["diff", "--name-only", "HEAD"]),
    ...gitLines(["diff", "--name-only", "--cached", "HEAD"]),
    ...gitLines(["ls-files", "--others", "--exclude-standard"]),
  ]);
  const approved = [
    ACTION_REL,
    SUITE_REL,
    SECTION_REL,
    CLIENT_REL,
    INSTRUCTOR_SUITE_REL,
    // EX-ROLE-OP-UI-MVP RE-POINT, on the same terms as the re-point in test 16 of
    // the instructor suite: this repo-wide sweep is deliberately KEPT — it is the
    // only "nothing else was touched" check here — and widened by an EXACT path
    // list, never a directory and never a glob. These four are the
    // operational-UI slice's own paths: the shared renderer, its render tests,
    // the trainee navigation rule that was hiding the exams entry, and that
    // rule's own suite.
    INSTRUCTOR_SECTION_REL,
    ASSIGNMENT_ROWS_REL,
    ASSIGNMENT_ROWS_SUITE_REL,
    // EX-ROLE-SCHEDULE-REDESIGN RE-POINT, on the same terms: an EXACT path list,
    // never a directory and never a glob. These six are that slice's own NEW
    // paths — the pure view core that owns the wave grouping, the nesting and the
    // filtering, the shared navigation bar, the compact personal-detail
    // renderer, and the suite beside each of them. Every one is a
    // `lib/components` leaf: the slice adds no route, no action, no reader and
    // no `lib/exam` file, and test 15 above independently pins that last part.
    //
    // `NAV_REL` and `NAV_SUITE_REL` STAY on this list only as the merged
    // operational-UI slice's paths; this slice touches neither, and
    // `assertNavVisibilityOnlyGainedExamsId` now proves they are byte-identical
    // to HEAD.
    VIEW_CORE_REL,
    VIEW_CORE_SUITE_REL,
    SCHEDULE_NAV_REL,
    SCHEDULE_NAV_SUITE_REL,
    PERSONAL_DETAIL_REL,
    PERSONAL_DETAIL_SUITE_REL,
    NAV_REL,
    NAV_SUITE_REL,
    // EX-TRAINEE-DATE-NAV + EX-BEGINNER-EXAM-UI, on the same terms: an EXACT
    // path list, never a directory and never a glob. Four `lib/components`
    // leaves — the trainee-only date sub-tabs that replaced the three-view bar,
    // the shared compact beginner presentation that makes live
    // Teaching-Practice rows visible on BOTH screens, and the render suite
    // beside each. The slice adds no route, no action, no reader and no
    // `lib/exam` file, and test 15 above independently pins that last part.
    DATE_TABS_REL,
    DATE_TABS_SUITE_REL,
    BEGINNER_ROWS_REL,
    BEGINNER_ROWS_SUITE_REL,
    // EX-C2-0-SUSPEND-UI, on the same terms: an EXACT path list, never a
    // directory and never a glob. This slice's two new test files, proving the
    // temporary beginner-row suspension and its two static placeholders on
    // both the trainee and instructor screens. It adds no route, no action,
    // no reader and no `lib/exam` file.
    "lib/components/StudentExamsSectionBeginnerPlaceholder.test.tsx",
    "lib/components/InstructorExamsSectionBeginnerPlaceholder.test.tsx",
    // EX-TRAINEE-MULTIDAY-READ, on the same terms: an EXACT path list. The
    // approved smallest multi-day trainee read touches THREE production files
    // beyond the section — the pure scope core (one added reader), the readers
    // binding (one added binding) and this module's own action — plus the scope
    // core's suite. Test 15 above independently pins that `lib/exam` gained no
    // NEW file and lost no authorization line.
    SCOPE_REL,
    "lib/exam/" + "exam-read-scope" + "-core.test.ts",
    READERS_REL,
    // The nine `lib/exam` paths of the merged operational-READ slice are GONE
    // from this list for the reason given in test 15 above: they are dead
    // permissions now, and dropping them restores the sweep to full strength.
    // EX-BEGINNER-EXAM-READ - the Level-1 beginner containment gate plus the
    // trainee-only assignment `isSelf` marker. Beginner Teaching-Practice rows are
    // gated to Level 1 in the loader, and the trainee narrowing marks the viewer's
    // own assignment by exact student id. Every path below is named EXACTLY - no
    // directory, no prefix, no glob - so an unrelated file still fails this guard,
    // and each module name is SPLIT so this list never enrols itself as a caller.
    "lib/actions/" + "admin-exam-session-read" + "-io.test.ts",
    "lib/actions/" + "exam-assignment-read" + "-io.test.ts",
    "lib/actions/" + "exam-assignment-write" + "-io.test.ts",
    "lib/actions/" + "exam-definition-read" + "-io.test.ts",
    "lib/actions/" + "exam-instructed-trainee-assignment-write" + "-io.test.ts",
    "lib/actions/" + "exam-pairing-write" + "-io.test.ts",
    "lib/actions/" + "exam-plan-write" + "-io.test.ts",
    "lib/actions/" + "exam-publication-write" + "-io.test.ts",
    "lib/actions/" + "exam-session-write" + "-io.test.ts",
    "lib/actions/" + "exam-supervisor-read" + "-io.test.ts",
    "lib/actions/" + "exam-supervisor-write" + "-io.test.ts",
    "lib/actions/" + "instructor-exam-schedule" + ".contract.test.ts",
    "lib/actions/" + "trainee-exam-schedule" + ".contract.test.ts",
    "lib/exam/" + "create-exam-plan" + "-core.test.ts",
    "lib/exam/" + "exam-beginner-course-scope" + "-core.test.ts",
    "lib/exam/" + "exam-beginner-course-scope" + "-core.ts",
    "lib/exam/" + "exam-beginner-course-scope" + ".contract.test.ts",
    "lib/exam/" + "exam-plan-loader" + "-core.test.ts",
    "lib/exam/" + "exam-plan-loader" + "-core.ts",
    "lib/exam/" + "exam-read-" + "dto.test.ts",
    "lib/exam/" + "exam-rea" + "d-dto.ts",
    "lib/exam/" + "exam-read-scope" + "-core.test.ts",
    "lib/exam/" + "exam-read-scope" + "-core.ts",
    "lib/exam/" + "exam-read" + ".contract.test.ts",
    "lib/exam/" + "exam-supervisor-write" + "-core.test.ts",
    "lib/exam/" + "exam-trainee-view" + "-core.ts",

    // EX-TRN-MULTI-SLOT, on the same terms: an EXACT path list, never a
    // directory and never a glob. The trainee reader stops dropping a whole
    // session when the authenticated trainee legitimately resolves to more
    // than one assignment in it. `exam-trainee-view-core.ts` is already
    // approved above (EX-TRAINEE-MULTIDAY-READ); its own suite and the
    // sibling adapter suite whose fixtures exercise the same personal-slot
    // shape are the two new entries.
    "lib/exam/" + "exam-trainee-view" + "-core.test.ts",
    "lib/exam/" + "exam-stored-adapter" + "-core.test.ts",
    // fix/exam-role-ui-urgent, on the same terms: an EXACT path list, never a
    // directory and never a glob. This branch's four NEW test files - the
    // instructor general/all overview-only regression test (re-pointed to also
    // pin the timetable-status label gate), and three new trainee contract
    // tests (default-view, beginner-placeholder group wiring, and the
    // Teaching-Practice home shortcut). It adds no route, no action, no reader
    // and no `lib/exam` file. SECTION_REL, CLIENT_REL and the other
    // already-approved paths above already cover this branch's four
    // implementation-file edits.
    "app/instructor/instructor-exams-general-overview.contract.test.ts",
    "app/student/trainee-exams-default-view.contract.test.ts",
    "app/student/trainee-beginner-placeholder-group-wiring.contract.test.ts",
    "app/student/trainee-teaching-practice-home-shortcut.contract.test.ts",

    // EX-ASG-MULTIPLICITY + EX-PAIR-NO-SELF - this branch's EXACT, CLOSED footprint.
    // ADDED, never widened: every entry is one exact literal path. No directory,
    // no prefix, no glob - an unrelated file still fails this guard. Module names
    // are SPLIT so this list never reads as a REFERENCE to the module it names.
    "app/admin/courses/[courseOfferingId]/exams/CreateExamInstructedTraineeAssignment" + "Form.tsx",
    "app/admin/courses/[courseOfferingId]/exams/actions.ts",
    "app/admin/courses/[courseOfferingId]/exams/exam-assignment-ui" + ".contract.test.ts",
    "app/admin/courses/[courseOfferingId]/exams/exam-definition-create" + ".contract.test.ts",
    "app/admin/courses/[courseOfferingId]/exams/exam-definitions-page" + ".contract.test.ts",
    "app/admin/courses/[courseOfferingId]/exams/exam-instructed-trainee-assignment" + "-messages.ts",
    "app/admin/courses/[courseOfferingId]/exams/exam-instructed-trainee-assignment-ui" + ".contract.test.ts",
    "app/admin/courses/[courseOfferingId]/exams/exam-pairing-ui" + ".contract.test.ts",
    "app/admin/courses/[courseOfferingId]/exams/exam-plan-create" + ".contract.test.ts",
    "app/admin/courses/[courseOfferingId]/exams/exam-publication-ui" + ".contract.test.ts",
    "app/admin/courses/[courseOfferingId]/exams/exam-session-create" + ".contract.test.ts",
    "app/admin/courses/[courseOfferingId]/exams/exam-session-edit-delete" + ".contract.test.ts",
    "app/admin/courses/[courseOfferingId]/exams/exam-workspace" + ".contract.test.ts",
    "app/admin/courses/[courseOfferingId]/exams/page.tsx",
    "lib/actions/admin-exam-workspace-edit" + "-io.ts",
    "lib/actions/detailed-exam-assignment-write" + "-io.test.ts",
    "lib/actions/detailed-exam-assignment-write" + "-io.ts",
    "lib/actions/exam-assignment-write" + "-io.ts",
    "lib/actions/exam-instructed-trainee-assignment-write" + "-io.ts",
    "lib/actions/exam-pairing-write" + "-io.ts",
    "lib/actions/message-audience" + ".contract.test.ts",
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
    "prisma/migrations/20260802120000_scope_exam_assignment_unique_to_examinee/",
    // EX-EXAM-TP-CARDS, on the same terms: an EXACT path list, never a
    // directory and never a glob. The two prior trainee placeholder test
    // files above are now DELETED (their subject, the temporary trainee
    // placeholder, no longer exists) - deleting an approved path is still an
    // approved touch. This slice's own new paths: the extracted shared
    // Teaching-Practice lesson card (a `lib/components` leaf, exactly like
    // every other shared exam renderer) and its own render/content suite, the
    // pure merge/filter core behind "לו״ז שלי" and its own real-behavior
    // suite, `StudentTeachingPracticeSection.tsx` (now rendering through the
    // extracted card), and two new trainee contract suites covering the real
    // cards' wiring. It adds no route, no action, no reader and no `lib/exam`
    // file; the instructor screen and its own placeholder are untouched (see
    // this slice's own test 16).
    "lib/components/TeachingPracticeLessonCard.tsx",
    "lib/components/TeachingPracticeLessonCard.test.tsx",
    "app/student/trainee-exam-self-view-core.ts",
    "app/student/trainee-exam-self-view-core.test.ts",
    "app/student/StudentTeachingPracticeSection.tsx",
    "app/student/trainee-teaching-practice-shared-card.contract.test.ts",
    "app/student/trainee-exam-teaching-practice-cards.contract.test.ts",
    // EX-EXAM-TP-SAME-PARENT, on the same terms: an EXACT path list, never a
    // directory and never a glob. The real same-parent badge/popup, extracted
    // into its own `lib/components` leaf (the "אותו הורה" popup, GroupBadge
    // and the pure row-builder) so both trainee screens render the identical
    // popup, plus its own real-behavior suite. It adds no route, no action,
    // no reader and no `lib/exam` file; the instructor screen is untouched
    // (see this slice's own test 16).
    "lib/components/TeachingPracticeSameParentPopup.tsx",
    "lib/components/TeachingPracticeSameParentPopup.test.ts",
    // EX-EXAM-TP-CARDS, on the same terms - the trainee Teaching-Practice READER
    // the extracted card renders through. A modified committed action module,
    // named EXACTLY: it is in the merge's own file set and nothing else under
    // `lib/actions` becomes approved by it.
    "lib/actions/teaching-practice-student.ts",
  ];
  const offenders = [...touched]
    .map((path) => path.split("\\").join("/"))
    .filter((path) => !approved.includes(path))
    .sort();
  assert.deepEqual(offenders, [], `an unapproved path was touched: ${offenders.join(", ")}`);
  // Nothing was staged.
  assert.deepEqual(gitLines(["diff", "--name-only", "--cached", "HEAD"]), []);
});
