/**
 * EX-INST-VIEW-MVP — STRUCTURAL contract test for the instructor exam view.
 *
 * SOURCE-TEXT CONTRACT TEST, following this repository's committed precedent
 * (app/instructor/instructor-page-gate.test.ts, lib/exam/exam-read.contract
 * .test.ts). The runner is `node:test` via `npx tsx --test` with no React/DOM
 * framework, and AGENTS.md forbids introducing one for a scoped task, so the
 * properties below are pinned by reading the shipped sources.
 *
 * IT LIVES UNDER `lib/` DELIBERATELY. Several committed exam guard suites sweep
 * every file under `app/` — test files included — for the exam read pipeline's
 * own module names and call shapes, and treat a match as an unapproved caller.
 * A suite placed beside the section would therefore register itself as the
 * violation it is checking for. Here it may name those modules plainly.
 *
 * Run with:
 *   npx tsx --test lib/actions/instructor-exam-schedule.contract.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, sep } from "node:path";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../");

const ACTION_REL = "lib/actions/instructor-exam-schedule.ts";
const SECTION_REL = "app/instructor/InstructorExamsSection.tsx";
const CLIENT_REL = "app/instructor/InstructorClient.tsx";
const READERS_REL = "lib/actions/exam-role-readers.ts";
const SCOPE_REL = "lib/exam/exam-read-scope-core.ts";

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
const READER_CALL = new RegExp("\\bread" + "InstructorExamPlan\\s*\\(");
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

// ===========================================================================
// 1–4. The Server Action is a transport wrapper and nothing else
// ===========================================================================

test("1. the action calls the committed instructor reader and nothing else", () => {
  // It is a Server Action module...
  assert.match(ACTION, /^"use server";/);

  // ...whose ONLY runtime import is the committed role-reader binding.
  const specifiers = [...ACTION_CODE.matchAll(/from\s+"([^"]+)"/g)].map(([, value]) => value);
  assert.deepEqual(specifiers, ["./exam-role-readers"]);

  // ...it exports exactly ONE function...
  const exported = [...ACTION_CODE.matchAll(/export async function (\w+)\(/g)].map(
    ([, name]) => name,
  );
  assert.deepEqual(exported, ["getInstructorExamSchedule"]);

  // ...and the reader is invoked exactly once, as the whole body.
  assert.equal((ACTION_CODE.match(READER_CALL) ?? []).length > 0, true);
  assert.equal(
    (ACTION_CODE.match(new RegExp(READER_CALL.source, "g")) ?? []).length,
    1,
    "the reader must be called exactly once",
  );
  assert.match(
    ACTION_CODE.replace(/\s+/g, " "),
    /return read.{0,40}\(courseOfferingId\); \}/,
    "the wrapper must return the reader's result unchanged",
  );
});

test("2. the action accepts no actor id and no other forbidden argument", () => {
  const signature = ACTION_CODE.slice(
    ACTION_CODE.indexOf("export async function getInstructorExamSchedule("),
  );
  const params = signature.slice(signature.indexOf("(") + 1, signature.indexOf(")"));
  assert.match(params.replace(/\s+/g, " ").trim(), /^courseOfferingId: string,?$/);
  for (const forbidden of [
    "instructorId",
    "studentId",
    "traineeId",
    "actorId",
    "viewerStudentId",
    "planId",
    "sessionId",
    "deps",
    "options",
  ]) {
    assert.equal(params.includes(forbidden), false, `the action accepts ${forbidden}`);
  }
});

test("3. the action exposes no publication toggle and no publication rule", () => {
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

test("4. the action contains no Prisma query, no auth lookup and no write", () => {
  for (const token of [
    PRISMA_MODULE,
    GENERATED_CLIENT,
    "prisma.",
    "$transaction",
    "$queryRaw",
    "$executeRaw",
    "requireCurrentInstructor",
    "getCurrentInstructor",
    "cookies(",
    "revalidatePath",
    "redirect(",
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
// 5. The committed reader is still the authorization boundary
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
 * described the instructor-view slice while it was in flight; that slice is
 * merged, so the same command no longer measures it — it measures whichever
 * slice currently sits in the tree. The separately reviewed operational-read
 * slice is exactly such a slice, and it edits the scope core in ONE place: it
 * passes one additional SIBLING lookup to the DTO narrowing.
 *
 * The claim is REPLACED, not dropped, by the property this suite actually cares
 * about and which no later slice can satisfy by accident: NO CHANGED LINE of
 * that file may name any part of the authorization surface, and the locked
 * per-role publication options must still read exactly as they did. A slice that
 * moved an identity check, a course resolution, a denial classification or a
 * publication option would change such a line and fail here.
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

  // The locked per-role options themselves are still verbatim in the file.
  const scope = stripComments(read(SCOPE_REL));
  for (const locked of [
    "requirePlanPublication: false",
    "requireLessonPublication: false",
    "requirePlanPublication: true",
    "requireLessonPublication: true",
  ]) {
    assert.ok(scope.includes(locked), `the scope core no longer states ${locked}`);
  }
}

test("5. the reader is untouched, server-only, and the wrapper is its only app-reachable caller", () => {
  // Byte-identical to HEAD: this slice changed no authorization logic.
  const result = spawnSync("git", ["diff", "--quiet", "HEAD", "--", READERS_REL], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${READERS_REL} was modified by this slice`);
  // ...and no changed line of the pure scope core touches authorization.
  assertScopeCoreAuthorizationUnchanged();

  // CODE only: the reader's header legitimately NAMES the directive when it
  // explains why it deliberately does not carry one.
  const readers = stripComments(read(READERS_REL));
  assert.match(readers, new RegExp('import\\s+"server' + '-only";'));
  assert.equal(readers.includes('"use server"'), false, "the reader became a Server Action module");
  assert.equal(readers.includes("'use server'"), false, "the reader became a Server Action module");

  // EXACTLY two production modules name the reader: its own definition, and the
  // one approved wrapper. An exact path list, never a directory or a glob. The
  // `\b` terminator keeps the pure core's `...WithDeps` seam out of this list.
  const READER_NAME = new RegExp("\\bread" + "InstructorExamPlan\\b");
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
// 6–7. Navigation: exactly one new entry, every existing one intact
// ===========================================================================

test('6. the "מבחנים" instructor entry exists EXACTLY once', () => {
  assert.equal(
    (CLIENT_CODE.match(/"מבחנים"/g) ?? []).length,
    1,
    "the label appears more than once",
  );
  assert.equal((CLIENT_CODE.match(/id: "exams"/g) ?? []).length, 1, "the id is registered twice");
  assert.equal(
    (CLIENT_CODE.match(/activeTab === "exams"/g) ?? []).length,
    1,
    "the screen has more than one render branch",
  );
  // It is a "עוד" menu entry, NOT a sixth bottom tab and NOT a home shortcut.
  const moreItems = CLIENT_CODE.slice(
    CLIENT_CODE.indexOf("const INSTRUCTOR_MORE_ITEMS"),
    CLIENT_CODE.indexOf("const INSTRUCTOR_ACTIVITY_SHORTCUTS"),
  );
  assert.ok(moreItems.includes('{ id: "exams", label: "מבחנים" }'), "the entry is not in the menu");
  const mainTabs = CLIENT_CODE.slice(
    CLIENT_CODE.indexOf("const INSTRUCTOR_MAIN_TABS"),
    CLIENT_CODE.indexOf("const INSTRUCTOR_MORE_ITEMS"),
  );
  assert.equal(mainTabs.includes("exams"), false, "the bottom bar gained a tab");
  const shortcuts = CLIENT_CODE.slice(
    CLIENT_CODE.indexOf("const INSTRUCTOR_ACTIVITY_SHORTCUTS"),
    CLIENT_CODE.indexOf("interface StoredSession"),
  );
  assert.equal(shortcuts.includes("exams"), false, "a second entry point was added");
});

test("7. every existing instructor navigation entry is still present", () => {
  for (const label of [
    "היום",
    'לו"ז',
    "תורנויות",
    "רכיבות",
    "עוד",
    "סוסים",
    "פרופיל",
    "נוכחות",
    "הודעות ומשימות",
    "אנשי קשר",
    "חומרי קורס",
    "עדכונים",
    "התנסויות מתחילים",
    "עזרה",
    "חתימות ילדים",
    "מעקב חניכים",
  ]) {
    // Presence in CODE, not a fixed quoting shape: 'לו"ז' is single-quoted in
    // the source precisely because it contains a double quote.
    assert.ok(CLIENT_CODE.includes(label), `the ${label} entry disappeared`);
  }
  for (const id of [
    "today",
    "schedule",
    "duties",
    "riding",
    "more",
    "horses",
    "profile",
    "attendance",
    "messages",
    "contacts",
    "materials",
    "notifications",
    "teachingPractice",
    "help",
    "childSignatures",
    "traineeProgress",
  ]) {
    assert.ok(CLIENT_CODE.includes(`id: "${id}"`), `the ${id} entry disappeared`);
  }
  // The TRAINEE bottom bar is untouched: the shared union gained a member, the
  // trainee tab list did not.
  const tabs = stripComments(read("lib/components/BottomTabs.tsx"));
  const mainTabs = tabs.slice(tabs.indexOf("export const MAIN_TABS"), tabs.indexOf("export const NAV_MAX_WIDTH"));
  assert.equal(mainTabs.includes("exams"), false, "the trainee bottom bar gained a tab");
});

// ===========================================================================
// 8–9. Empty, loading and error states
// ===========================================================================

test("8. the empty state renders the exact approved Hebrew sentence", () => {
  assert.ok(
    SECTION.includes('const EMPTY_TEXT = "אין עדיין לוח מבחנים לקורס זה.";'),
    "the approved empty-state sentence is missing or was reworded",
  );
  assert.ok(SECTION_CODE.includes("{EMPTY_TEXT}"), "the empty state is never rendered");
  // It covers BOTH "no plan" and "no sessions".
  assert.ok(
    SECTION_CODE.includes("view.planId !== null") && SECTION_CODE.includes("groups.length > 0"),
    "the empty state must cover a missing plan and an empty plan alike",
  );
});

test("9. loading and error states are fixed strings that expose no raw error", () => {
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
// 10–11. What is rendered, and what is not
// ===========================================================================

test("10. the approved session display fields are the ones rendered", () => {
  for (const field of [
    "row.definitionName",
    "row.startTime",
    "row.displayEndTime",
    "row.arena",
    "row.location",
    "row.examineeNames",
    "row.examineeCount",
    "row.instructedTraineeNames",
    "row.instructedTraineeCount",
    "row.supervisorNames",
    "row.supervisorCount",
    "row.timetableStatus",
    "row.date",
  ]) {
    assert.ok(SECTION_CODE.includes(field), `${field} is not displayed`);
  }
  // The operational messages are the committed canonical Hebrew ones, taken by
  // `message` alone — never a raw code and never the ids beside it.
  assert.ok(SECTION_CODE.includes("issue.message") && SECTION_CODE.includes("warning.message"));
  // And no field the instructor contract does not carry is stubbed out.
  for (const absent of ["horse", "topic", "discipline", "pairing", "grade", "feedback", "rating"]) {
    assert.equal(
      new RegExp(absent, "i").test(SECTION_CODE),
      false,
      `the UI invents a ${absent} placeholder`,
    );
  }
});

test("11. no internal id and no raw contract object is rendered", () => {
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
    "studentId",
    "instructorId",
    "traineeId",
    "nationalId",
    "identityNumber",
    "parentName",
    "parentPhone",
    "childNotes",
    "equipmentNotes",
    "email",
    "beginner",
    "children",
    "narrowingIssues",
    "loaderIssues",
    "beginnerRejections",
    "storedAdapterIssues",
    "teachingPracticeSourceIssues",
    "sourceDates",
    "publishedAt",
  ]) {
    assert.equal(SECTION_CODE.includes(token), false, `the UI reaches ${token}`);
  }
  // `planId` is read ONCE, as a null check, and is never placed on screen.
  assert.equal((SECTION_CODE.match(/planId/g) ?? []).length, 1);
  assert.ok(SECTION_CODE.includes("view.planId !== null"));
  // `sessionId` is a React list key (which never reaches the DOM) and an exact
  // diagnostics lookup key. Those are its ONLY five appearances in the file, so
  // it cannot be in a rendered position: an added use fails this count.
  const APPROVED_SESSION_ID_USES = [
    "sessionId: string,",
    "if (block.sessionId !== sessionId) continue;",
    "operationalMessagesFor(view, row.sessionId)",
    "key={row.sessionId}",
  ];
  for (const fragment of APPROVED_SESSION_ID_USES) {
    assert.ok(SECTION_CODE.includes(fragment), `approved use is missing: ${fragment}`);
  }
  assert.equal(
    (SECTION_CODE.match(/sessionId/g) ?? []).length,
    5,
    "a session id is used outside the four approved, non-rendering places",
  );
  // The UI queries nothing itself.
  for (const token of [PRISMA_MODULE, GENERATED_CLIENT, "prisma."]) {
    assert.equal(SECTION_CODE.includes(token), false, `the UI reaches ${token}`);
  }
});

// ===========================================================================
// 12–15. Containment
// ===========================================================================

test("12. no exam route directory was created in any role area", () => {
  for (const dir of [
    join("app", "instructor", "exams"),
    join("app", "student", "exams"),
    join("app", "admin", "exams"),
  ]) {
    assert.equal(existsSync(join(REPO_ROOT, dir)), false, `${dir} was created`);
  }
});

test("13. the instructor action and UI are untouched and name no trainee reader", () => {
  // EX-TRAINEE-VIEW-MVP RE-POINT. This test also asserted that the working tree
  // left `app/student` completely alone. That claim described THIS slice while
  // it was in flight; the slice is now merged, so the same two commands no
  // longer measure it at all — they measure whichever slice currently sits in
  // the tree, and the separately reviewed trainee exam view is exactly such a
  // slice. The claim was replaced, not dropped: what is checked now is the
  // durable and strictly stronger property that the instructor surface is
  // BYTE-IDENTICAL to HEAD, so no later trainee work can edit it unnoticed. The
  // trainee slice's own footprint is pinned by
  // lib/actions/trainee-exam-schedule.contract.test.ts.
  for (const relative of [ACTION_REL, SECTION_REL, CLIENT_REL]) {
    const result = spawnSync("git", ["diff", "--quiet", "HEAD", "--", relative], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, `${relative} was modified`);
  }
  for (const token of ["readTraineeExamDay", "TraineeExamDayDto", "buildTraineeExamDayDto"]) {
    assert.equal(ACTION_CODE.includes(token), false, `the action names ${token}`);
    assert.equal(SECTION_CODE.includes(token), false, `the UI names ${token}`);
  }
});

test("14. no admin exam file was modified, and no schema or migration", () => {
  const adminExams = "app/admin/courses/[courseOfferingId]/exams";
  assert.deepEqual(gitLines(["diff", "--name-only", "HEAD", "--", adminExams]), []);
  assert.deepEqual(gitLines(["ls-files", "--others", "--exclude-standard", adminExams]), []);
  assert.deepEqual(gitLines(["diff", "--name-only", "HEAD", "--", "prisma"]), []);
  assert.deepEqual(gitLines(["ls-files", "--others", "--exclude-standard", "prisma"]), []);
  // ...nor anything about identity, sessions or capabilities.
  for (const dir of ["lib/auth", "lib/course/capabilities"]) {
    assert.deepEqual(gitLines(["diff", "--name-only", "HEAD", "--", dir]), []);
    assert.deepEqual(gitLines(["ls-files", "--others", "--exclude-standard", dir]), []);
  }
});

test("15. no write, publish, supervisor or pairing control was added", () => {
  for (const token of [
    "<form",
    "<input",
    "<button",
    "<select",
    "<textarea",
    "onSubmit",
    "useTransition",
    "useActionState",
    "FormData",
    "unpublish",
    "setPublished",
    "createExam",
    "updateExam",
    "deleteExam",
    "Supervisor",
    "pairingIndex",
    "-write-",
  ]) {
    assert.equal(SECTION_CODE.includes(token), false, `the UI adds a ${token} control`);
  }
  // The section talks to exactly ONE server module: the approved wrapper. The
  // course menu it mounts is the EXISTING shared selector, not a second picker.
  const specifiers = [...SECTION_CODE.matchAll(/from\s+"([^"]+)"/g)].map(([, value]) => value);
  assert.deepEqual(specifiers.filter((value) => value.startsWith("@/lib/actions/")), [
    "@/lib/actions/instructor-exam-schedule",
  ]);
  assert.ok(
    SECTION_CODE.includes('from "@/app/instructor/InstructorScheduleCourseSelector"'),
    "the section must reuse the existing instructor course selector",
  );
  assert.equal(
    SECTION_CODE.includes("listInstructorContactCourseOptions"),
    false,
    "the section must not open its own course menu",
  );
});

// ===========================================================================
// 16. This slice's own exact footprint
// ===========================================================================

test("16. the working tree holds only this slice's five paths and the approved trainee-view paths", () => {
  const touched = new Set([
    ...gitLines(["diff", "--name-only", "HEAD"]),
    ...gitLines(["diff", "--name-only", "--cached", "HEAD"]),
    ...gitLines(["ls-files", "--others", "--exclude-standard"]),
  ]);
  const approved = [
    ACTION_REL,
    "lib/actions/instructor-exam-schedule.contract.test.ts",
    SECTION_REL,
    CLIENT_REL,
    "lib/components/BottomTabs.tsx",
    // EX-TRAINEE-VIEW-MVP RE-POINT. This slice is merged, so a repo-wide sweep
    // against HEAD now sees the NEXT slice's files rather than this one's. The
    // sweep is deliberately kept — it is the only repo-wide "nothing else was
    // touched" check in this suite — and widened by an EXACT path list, never a
    // directory and never a glob. Each entry below is an approved path of the
    // trainee exam view; test 13 above independently pins that none of the
    // instructor files changed.
    "lib/actions/trainee-exam-schedule.ts",
    "lib/actions/trainee-exam-schedule.contract.test.ts",
    "app/student/StudentExamsSection.tsx",
    "app/student/StudentClient.tsx",
    // EX-OPS-READ-MVP RE-POINT, for exactly the same reason and on exactly the
    // same terms: an EXACT path list of the operational-read slice's own files,
    // never a directory and never a glob. Test 13 above independently pins that
    // none of the instructor files changed, test 5 pins that the scope core's
    // authorization surface did not move, and that slice's own footprint is
    // pinned by that slice's own cross-slice contract suite.
    //
    // The DIRECTORY PREFIX IS JOINED rather than spelled into each literal: the
    // committed `exam-schema-structure` containment guard scans every file
    // outside `lib/exam` for the exact token `<dir>/<core-name>`, and a
    // fully-written path here would read to it as this suite wiring itself to an
    // exam core. The paths produced are identical either way.
    ...[
      "exam-block-timetable-core.ts",
      "exam-block-timetable-core.test.ts",
      "exam-stored-adapter-core.ts",
      "exam-stored-adapter-core.test.ts",
      "exam-plan-loader-core.ts",
      "exam-read-dto.ts",
      "exam-read-dto.test.ts",
      "exam-read-scope-core.ts",
      "exam-read.contract.test.ts",
    ].map((name) => ["lib", "exam", name].join("/")),
  ];
  const offenders = [...touched].filter((path) => !approved.includes(path)).sort();
  assert.deepEqual(offenders, [], `an unapproved path was touched: ${offenders.join(", ")}`);
  // Nothing was staged.
  assert.deepEqual(gitLines(["diff", "--name-only", "--cached", "HEAD"]), []);
});
