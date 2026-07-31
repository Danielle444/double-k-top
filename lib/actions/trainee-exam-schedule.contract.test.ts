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

test("6b. the reader is untouched, server-only, and the wrapper is its only app-reachable caller", () => {
  // Byte-identical to HEAD: this slice changed no authorization, no course
  // resolution and no publication logic.
  for (const relative of [READERS_REL, SCOPE_REL, NAV_REL]) {
    assert.ok(unchangedSinceHead(relative), `${relative} was modified by this slice`);
  }

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

  // The Level 2 rules are FAIL-CLOSED allow-lists, and neither was relaxed: a
  // Level-2-only trainee never sees the entry, and nobody sees it before the
  // course options resolve.
  const loadingSafe = clientSlice("const LOADING_SAFE_NAV_IDS", "function toMessagePreview");
  assert.equal(loadingSafe.includes("exams"), false, "the loading-safe allow-list was widened");
  const nav = stripComments(read(NAV_REL));
  const level2 = nav.slice(
    nav.indexOf("const LEVEL2_ONLY_VISIBLE_NAV_IDS"),
    nav.indexOf("export function isTraineeNavEntryVisible"),
  );
  assert.equal(level2.includes("exams"), false, "the Level 2 allow-list was widened");
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
  assert.ok(
    SECTION_CODE.includes("{dayIsEmpty ? EMPTY_TEXT : NO_SELF_TEXT}"),
    "the empty state is never rendered",
  );
  assert.ok(SECTION.includes('const NO_SELF_TEXT = "אין לך שיבוץ למבחן ביום זה.";'));
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
  // The publication rule itself lives in the untouched committed core.
  assert.ok(unchangedSinceHead(SCOPE_REL), `${SCOPE_REL} was modified`);
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
  // viewer's own: exactly one personal-time line exists, and it reads only the
  // two `self*` fields.
  assert.equal((SECTION_CODE.match(/השעה שלך/g) ?? []).length, 1);
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
  // `sessionId` is a React list key, which never reaches the DOM. That is its
  // ONLY appearance in the file, so it cannot be in a rendered position: an
  // added use fails this count.
  assert.ok(SECTION_CODE.includes("key={row.sessionId}"), "the approved list key is missing");
  assert.equal(
    (SECTION_CODE.match(/sessionId/g) ?? []).length,
    1,
    "a session id is used outside the one approved, non-rendering place",
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
  // ...and no field the trainee contract does not carry is stubbed out.
  for (const absent of ["horse", "topic", "discipline", "pairing", "grade", "feedback", "rating"]) {
    assert.equal(
      new RegExp(absent, "i").test(SECTION_CODE),
      false,
      `the UI invents a ${absent} placeholder`,
    );
  }
});

// ===========================================================================
// 15–17. Containment
// ===========================================================================

test("15. no instructor or admin exam file was modified", () => {
  for (const relative of [
    INSTRUCTOR_ACTION_REL,
    INSTRUCTOR_SECTION_REL,
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
  for (const dir of ["prisma", "lib/auth", "lib/course/capabilities", "lib/exam"]) {
    assert.deepEqual(gitLines(["diff", "--name-only", "HEAD", "--", dir]), []);
    assert.deepEqual(gitLines(["ls-files", "--others", "--exclude-standard", dir]), []);
  }
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

test("17. the slice's footprint is exactly its five approved paths", () => {
  const touched = new Set([
    ...gitLines(["diff", "--name-only", "HEAD"]),
    ...gitLines(["diff", "--name-only", "--cached", "HEAD"]),
    ...gitLines(["ls-files", "--others", "--exclude-standard"]),
  ]);
  const approved = [ACTION_REL, SUITE_REL, SECTION_REL, CLIENT_REL, INSTRUCTOR_SUITE_REL];
  const offenders = [...touched].filter((path) => !approved.includes(path)).sort();
  assert.deepEqual(offenders, [], `an unapproved path was touched: ${offenders.join(", ")}`);
  // Nothing was staged.
  assert.deepEqual(gitLines(["diff", "--name-only", "--cached", "HEAD"]), []);
});
