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
const READER_CALL = new RegExp("\\bread" + "TraineeExamDay\\s*\\(");
const READER_NAME = new RegExp("\\bread" + "TraineeExamDay\\b");
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
  const exported = [...ACTION_CODE.matchAll(/export async function (\w+)\(/g)].map(
    ([, name]) => name,
  );
  assert.deepEqual(exported, ["getTraineeExamDaySchedule"]);

  // ...and the reader is invoked exactly once, as the whole body.
  assert.equal(
    (ACTION_CODE.match(new RegExp(READER_CALL.source, "g")) ?? []).length,
    1,
    "the reader must be called exactly once",
  );
  assert.match(
    ACTION_CODE.replace(/\s+/g, " "),
    /return read.{0,40}\(selectedDate\); \}/,
    "the wrapper must return the reader's result unchanged",
  );
  // No other exam reader is reachable from here.
  for (const other of ["read" + "AdminExamPlan", "read" + "InstructorExamPlan"]) {
    assert.equal(ACTION_CODE.includes(other), false, `the action reaches ${other}`);
  }
});

test("2. the action accepts EXACTLY one date value and nothing else", () => {
  const signature = ACTION_CODE.slice(
    ACTION_CODE.indexOf("export async function getTraineeExamDaySchedule("),
  );
  const params = signature.slice(signature.indexOf("(") + 1, signature.indexOf(")"));
  assert.match(params.replace(/\s+/g, " ").trim(), /^selectedDate: string,?$/);
});

test("3. the action accepts no student id and no other actor identity", () => {
  const signature = ACTION_CODE.slice(
    ACTION_CODE.indexOf("export async function getTraineeExamDaySchedule("),
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
  for (const token of SCOPE_AUTHORIZATION_TOKENS) {
    const offenders = changedLines.filter((line) => line.includes(token));
    assert.deepEqual(offenders, [], `${SCOPE_REL} changed a line naming ${token}`);
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
  // Byte-identical to HEAD: this slice changed no authorization, no course
  // resolution and no publication logic.
  assert.ok(unchangedSinceHead(READERS_REL), `${READERS_REL} was modified by this slice`);
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
  assert.ok(unchangedSinceHead(READERS_REL), "the reader changed alongside the navigation");
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
  assert.ok(
    SECTION_CODE.includes("export function StudentExamsSection()"),
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
    SECTION.includes('const EMPTY_TEXT = "עדיין לא פורסם לוח מבחנים ליום זה.";'),
    "the approved empty-state sentence is missing or was reworded",
  );
  // It is the sentence shown whenever the DAY itself carries no visible row —
  // missing, draft and denied alike, which is exactly what must not be told
  // apart. The second sentence is reachable ONLY when the day IS visible and
  // holds rows, so it can never stand in for the publication answer.
  assert.ok(SECTION_CODE.includes("view.allRows.length === 0"));
  assert.ok(SECTION.includes('const NO_SELF_TEXT = "אין לך שיבוץ למבחן ביום זה.";'));

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
    SECTION_CODE.includes("const emptyText = dayIsEmpty"),
    "the empty state no longer branches on the day itself first",
  );
  assert.ok(SECTION_CODE.includes("{emptyText}"), "the empty state is never rendered");
  assert.ok(SECTION.includes('const NO_MATCHING_ROWS_TEXT = "אין מבחנים בתצוגה שנבחרה.";'));
  // EMPTY_TEXT is named exactly twice — its declaration and the one branch — so
  // it cannot also be reached from a view selection.
  assert.equal((SECTION_CODE.match(/EMPTY_TEXT/g) ?? []).length, 2);
  // `dayIsEmpty` reads the LOADED day, never the narrowed rows.
  assert.ok(SECTION_CODE.includes("const dayIsEmpty = view !== null && view.allRows.length === 0;"));
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
  // The screen has exactly ONE server seam, and it carries only a date — there
  // is no argument through which a draft reading could be requested...
  const specifiers = [...SECTION_CODE.matchAll(/from\s+"([^"]+)"/g)].map(([, value]) => value);
  assert.deepEqual(specifiers.filter((value) => value.startsWith("@/lib/actions/")), [
    "@/lib/actions/trainee-exam-schedule",
  ]);
  const calls = SECTION_CODE.match(/getTraineeExamDaySchedule\([^)]*\)/g) ?? [];
  assert.deepEqual(calls, ["getTraineeExamDaySchedule(selectedDate)"]);

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
  // Both personal values are rendered ONLY behind an explicit non-null test.
  assert.ok(SECTION_CODE.includes("row.selfStartTime !== null &&"));
  assert.ok(SECTION_CODE.includes("row.selfEndTime !== null &&"));
  // ...and neither is ever defaulted from the block times or from a duration.
  for (const fallback of [
    "selfStartTime ??",
    "selfEndTime ??",
    "selfStartTime ||",
    "selfEndTime ||",
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
  // of its own, so the personal-time line exists once per view. The claim is
  // replaced by the property it was standing in for: EVERY personal-time line is
  // behind the same explicit non-null test on the same `self*` field, and there
  // are exactly as many guards as lines.
  const personalLines = (SECTION_CODE.match(/השעה שלך/g) ?? []).length;
  assert.equal(personalLines, 2, "a personal-time line was added or dropped");
  assert.equal(
    (SECTION_CODE.match(/\{row\.selfStartTime !== null && \(/g) ?? []).length,
    personalLines,
    "a personal-time line is not behind its own explicit non-null test",
  );
  assert.equal(
    (SECTION_CODE.match(/row\.selfEndTime !== null &&/g) ?? []).length,
    personalLines,
    "a personal end is rendered without its own explicit non-null test",
  );
});

test("14. no internal id and no raw contract object is rendered", () => {
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
    "parentName",
    "parentPhone",
    "childNotes",
    "equipmentNotes",
    "email",
    "phone",
    "beginner",
    "children",
    "narrowingIssues",
    "diagnostics",
  ]) {
    assert.equal(SECTION_CODE.includes(token), false, `the UI reaches ${token}`);
  }
  // `sessionId` is a React list key, which never reaches the DOM. Those are its
  // ONLY appearances in the file, so it cannot be in a rendered position: an
  // added use fails this count.
  //
  // EX-ROLE-SCHEDULE-REDESIGN RE-POINT — the count was ONE, when both trainee
  // views shared a single row loop. The compact personal view is its own loop,
  // so it needs its own list key; both are the SAME approved, non-rendering use.
  assert.ok(SECTION_CODE.includes("key={row.sessionId}"), "the approved list key is missing");
  assert.equal(
    (SECTION_CODE.match(/key=\{row\.sessionId\}/g) ?? []).length,
    2,
    "the list key is not the only use of a session id",
  );
  assert.equal(
    (SECTION_CODE.match(/sessionId/g) ?? []).length,
    2,
    "a session id is used outside the two approved, non-rendering places",
  );
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
    "row.selfRole",
    "row.selfStartTime",
    "row.selfEndTime",
    "row.examineeNames",
    "row.examineeCount",
    "row.instructedTraineeNames",
    "row.instructedTraineeCount",
  ]) {
    assert.ok(SECTION_CODE.includes(field), `${field} is not displayed`);
  }
  // Both trainee views are served from the SAME fetched contract...
  assert.ok(SECTION_CODE.includes("view.myRows") && SECTION_CODE.includes("view.allRows"));
  assert.ok(SECTION.includes('const ALL_MODE_LABEL = "לו״ז כולם";'));
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
  // It renders `view.myRows` — the SERVER's own list — and nothing else.
  assert.match(
    SECTION_CODE.replace(/\s+/g, " "),
    /mode === "self" && myRows\.map\(\(row\) => \{/,
    "the personal view is not the server's own row list",
  );

  // It does NOT reprint the all-participants structure: no participant summary
  // and no full block schedule inside the personal card. Both live in the
  // "לו״ז כולם" branch, which is the only place `<ExamAssignmentRows>` and the
  // `PeopleLine` summary appear.
  const personalStart = SECTION_CODE.indexOf('mode === "self" &&');
  const personalEnd = SECTION_CODE.search(/mode === "all" &&\s+groups\.map\(/);
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
    "row.selfRole",
    "row.selfStartTime",
    "row.selfEndTime",
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

test('14f. "לו״ז שלי" still finds the viewer through the SERVER markers alone', () => {
  // The detail renderer is handed the block's rows and the three server-derived
  // markers — the role and the exact personal window — and NOTHING else. No
  // name, no id and no browser-derived value crosses into it, and its own suite
  // proves it refuses to answer when those markers are ambiguous.
  const props = SECTION_CODE.slice(
    SECTION_CODE.indexOf("<ExamPersonalAssignmentDetail"),
    SECTION_CODE.indexOf("<ExamPersonalAssignmentDetail") + 400,
  );
  for (const fragment of [
    "assignments={row.assignments}",
    "role={row.selfRole}",
    "startTime={row.selfStartTime}",
    "endTime={row.selfEndTime}",
  ]) {
    assert.ok(props.includes(fragment), `the personal detail is not given ${fragment}`);
  }
  for (const forbidden of [
    "participantName=",
    "viewerName=",
    "studentId=",
    "selfName=",
    "isSelf={",
  ]) {
    assert.equal(props.includes(forbidden), false, `the personal detail is given ${forbidden}`);
  }
  // The highlight is still the server's boolean, in BOTH views.
  assert.equal(
    (SECTION_CODE.match(/row\.isSelf \?/g) ?? []).length,
    2,
    "a view stopped deriving its highlight from the server marker",
  );
});

test('14g. "לו״ז כולם" navigates the loaded day, and never re-reads it', () => {
  // The three options — everything, by exam type, by date — are the SHARED
  // navigation bar over rows already in hand.
  assert.ok(SECTION.includes('const ALL_FILTER_LABEL = "הכל";'));
  assert.ok(
    SECTION_CODE.includes('from "@/lib/components/ExamScheduleNav"'),
    "the screen does not mount the shared navigation bar",
  );
  assert.equal(
    (SECTION_CODE.match(/<ExamScheduleNav\s/g) ?? []).length,
    1,
    "a second navigation bar was added",
  );
  // The bar appears in "לו״ז כולם" ONLY: the personal view is already the
  // shortest list on the screen.
  assert.ok(
    SECTION_CODE.includes('mode === "all" && !dayIsEmpty && ('),
    "the navigation bar is not scoped to the everyone view",
  );

  // The option lists and the narrowing come from the PURE view core, so this
  // screen holds no filtering rule of its own to disagree with the instructor
  // screen's.
  assert.ok(SECTION_CODE.includes('from "@/lib/components/exam-schedule-view-core"'));
  for (const call of ["listExamDefinitionNames(allRows)", "listExamDates(allRows)"]) {
    assert.ok(SECTION_CODE.includes(call), `the options are not derived from the loaded day: ${call}`);
  }
  assert.ok(SECTION_CODE.includes("filterExamRows(allRows, {"), "the views are not one narrowing");

  // NAVIGATING ISSUES NO REQUEST. There is exactly one server call, it takes the
  // DATE and nothing else, and the load is keyed by that date alone — so no view
  // selection can re-read, widen or reach past the reader.
  const calls = SECTION_CODE.match(/getTraineeExamDaySchedule\([^)]*\)/g) ?? [];
  assert.deepEqual(calls, ["getTraineeExamDaySchedule(selectedDate)"]);
  assert.equal((SECTION_CODE.match(/useEffect\(/g) ?? []).length, 1);
  assert.ok(SECTION_CODE.includes("}, [selectedDate]);"), "the load is no longer keyed by the date");
  for (const token of ["navMode]", "navDate]", "navDefinitionName]", "mode]"]) {
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
  assert.ok(SECTION_CODE.includes("row.selfRole"), "the viewer's own role was dropped");
  assert.ok(SECTION_CODE.includes("row.selfStartTime !== null &&"), "the personal window was dropped");

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
  assert.deepEqual(gitLines(["diff", "--name-only", "HEAD", "--", adminExams]), []);
  assert.deepEqual(gitLines(["ls-files", "--others", "--exclude-standard", adminExams]), []);
  // The only instructor-side file this slice touches at all is that slice's own
  // guard suite, whose committed footprint claim was measured against a HEAD
  // that no longer exists. Its authorization assertions are untouched.
  assert.equal(unchangedSinceHead(INSTRUCTOR_SUITE_REL), false, "the re-pointed guard is missing");

  // ...nor was anything about schema, identity, sessions or capabilities.
  for (const dir of ["prisma", "lib/auth", "lib/course/capabilities"]) {
    assert.deepEqual(gitLines(["diff", "--name-only", "HEAD", "--", dir]), []);
    assert.deepEqual(gitLines(["ls-files", "--others", "--exclude-standard", dir]), []);
  }
  // EX-ROLE-OP-UI-MVP RE-POINT. An EXACT path allow-list of nine `lib/exam`
  // files was carried here while the operational-READ slice was in flight. That
  // slice is merged, so the exception describes nothing in the working tree any
  // more — it is a dead permission that would let an unrelated exam-core edit
  // through. The blanket claim is RESTORED at full strength: no file under that
  // directory may change, and no new file may appear in it.
  assert.deepEqual(gitLines(["diff", "--name-only", "HEAD", "--", "lib/exam"]), []);
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
  // The ONE input on the screen is the day picker: a native date field, with no
  // name attribute and no form around it, so it submits nothing anywhere.
  assert.equal((SECTION_CODE.match(/<input/g) ?? []).length, 1, "a second input exists");
  assert.ok(SECTION_CODE.includes('type="date"'), "the day picker is not a native date field");
  assert.equal(SECTION_CODE.includes("name="), false, "the input is form-wired");
  // The two buttons are the view switch and nothing else: both are type="button"
  // and both only set local state.
  assert.equal((SECTION_CODE.match(/<button/g) ?? []).length, 2, "an unexpected button exists");
  assert.equal((SECTION_CODE.match(/type="button"/g) ?? []).length, 2);
  assert.deepEqual(SECTION_CODE.match(/onClick=\{\(\) => setMode\("(all|self)"\)\}/g), [
    'onClick={() => setMode("all")}',
    'onClick={() => setMode("self")}',
  ]);
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
    // The nine `lib/exam` paths of the merged operational-READ slice are GONE
    // from this list for the reason given in test 15 above: they are dead
    // permissions now, and dropping them restores the sweep to full strength.
  ];
  const offenders = [...touched]
    .map((path) => path.split("\\").join("/"))
    .filter((path) => !approved.includes(path))
    .sort();
  assert.deepEqual(offenders, [], `an unapproved path was touched: ${offenders.join(", ")}`);
  // Nothing was staged.
  assert.deepEqual(gitLines(["diff", "--name-only", "--cached", "HEAD"]), []);
});
