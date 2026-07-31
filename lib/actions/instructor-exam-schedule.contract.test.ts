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
/**
 * EX-ROLE-OP-UI-MVP — the ONE shared renderer for a block's operational
 * assignment rows, mounted by the instructor screen and the trainee screen
 * alike. Its own behaviour is proven by real render tests beside it
 * (lib/components/ExamAssignmentRows.test.tsx); what this suite pins is that the
 * instructor screen delegates to it rather than growing a second copy.
 */
const ASSIGNMENT_ROWS_REL = "lib/components/ExamAssignmentRows.tsx";
const ASSIGNMENT_ROWS_SUITE_REL = "lib/components/ExamAssignmentRows.test.tsx";
/**
 * EX-ROLE-SCHEDULE-REDESIGN — the three shared leaves this screen now composes.
 *
 * The PURE view core owns the wave grouping, the examinee/instructed-trainee
 * nesting and the navigation filtering; the navigation bar owns the connected
 * views; the personal-detail renderer is the trainee screen's alone. Each is
 * proven by its own suite beside it — what this suite pins is that the
 * instructor screen DELEGATES to them rather than growing copies of their rules.
 */
const VIEW_CORE_REL = "lib/components/exam-schedule-view-core.ts";
const VIEW_CORE_SUITE_REL = "lib/components/exam-schedule-view-core.test.ts";
const SCHEDULE_NAV_REL = "lib/components/ExamScheduleNav.tsx";
const SCHEDULE_NAV_SUITE_REL = "lib/components/ExamScheduleNav.test.tsx";
const PERSONAL_DETAIL_REL = "lib/components/ExamPersonalAssignmentDetail.tsx";
const PERSONAL_DETAIL_SUITE_REL = "lib/components/ExamPersonalAssignmentDetail.test.tsx";

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

  for (const token of SCOPE_AUTHORIZATION_TOKENS) {
    const offenders = changedLines
      .filter((line) => line.includes(token))
      .map((line) => line.slice(1).trim())
      .filter((line) => !reindented.has(line) && !TOLERATED_CHANGED_LINES.has(line));
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
  //
  // EX-ROLE-SCHEDULE-REDESIGN RE-POINT — `groups.length > 0`. That expression
  // measured the LOADED rows while the screen had exactly one view of them. The
  // screen now has three connected views over that same loaded schedule, and
  // `groups` is what the CHOSEN VIEW left standing — so keeping the old
  // expression would have let a narrowed view that happens to be empty print
  // "this course has no exam plan", a publication-shaped claim it is in no
  // position to make.
  //
  // The claim is REPLACED by the one it was standing in for, and strengthened:
  // the approved sentence is reached ONLY from the unfiltered loaded rows, and a
  // narrowed empty view gets its own sentence, which says nothing about whether
  // a plan exists.
  assert.ok(
    SECTION_CODE.includes("view.planId !== null") && SECTION_CODE.includes("allRows.length > 0"),
    "the empty state must cover a missing plan and an empty plan alike",
  );
  assert.ok(
    SECTION.includes('const NO_MATCHING_ROWS_TEXT = "אין מבחנים בתצוגה שנבחרה.";'),
    "a narrowed empty view has no sentence of its own",
  );
  assert.ok(SECTION_CODE.includes("{NO_MATCHING_ROWS_TEXT}"), "that sentence is never rendered");
  // The two sentences are never interchangeable: only ONE of them is reachable
  // from the filtered rows.
  assert.equal(
    SECTION_CODE.includes("groups.length === 0 && (") &&
      SECTION_CODE.includes("!hasPlan && ("),
    true,
    "the narrowed-view notice and the no-plan sentence share a condition",
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
  // And no field the instructor contract does not carry is stubbed out. This
  // list was RE-POINTED by EX-ROLE-OP-UI-MVP: the contract now carries the horse,
  // the instruction topic, the discipline and the resolved pairing, so asserting
  // their absence would pin a claim that is simply no longer true. Grade,
  // feedback and rating are still absent from the contract, so they stay pinned.
  for (const absent of ["grade", "feedback", "rating"]) {
    assert.equal(
      new RegExp(absent, "i").test(SECTION_CODE),
      false,
      `the UI invents a ${absent} placeholder`,
    );
  }
});

test("10b. the complete operational schedule is rendered, through the ONE shared renderer", () => {
  // The block's assignment rows are handed to the shared renderer VERBATIM: the
  // whole array, in the contract's own order, with no filter, slice, sort or
  // re-map in between.
  assert.ok(
    SECTION_CODE.includes("<ExamAssignmentRows assignments={row.assignments} />"),
    "the instructor screen does not render the operational assignment rows",
  );
  assert.ok(
    SECTION_CODE.includes('from "@/lib/components/ExamAssignmentRows"'),
    "the instructor screen does not mount the shared renderer",
  );
  // EX-ROLE-SCHEDULE-REDESIGN RE-POINT — this count was ONE. The screen now
  // reads `row.assignments` a SECOND time, and for one purpose only: to decide
  // whether the participant SUMMARY above the rows would merely reprint the
  // names the rows are about to show. The claim is replaced by an EXACT list of
  // the two approved uses, which is stronger than a bare count — a third use, or
  // a different second one, fails here.
  const APPROVED_ASSIGNMENT_USES = [
    "{row.assignments.length === 0 && (",
    "<ExamAssignmentRows assignments={row.assignments} />",
  ];
  for (const fragment of APPROVED_ASSIGNMENT_USES) {
    assert.ok(SECTION_CODE.includes(fragment), `approved use is missing: ${fragment}`);
  }
  assert.equal(
    (SECTION_CODE.match(/row\.assignments/g) ?? []).length,
    2,
    "the assignment rows are read somewhere beyond the two approved uses",
  );
  // The second use is a LENGTH TEST and nothing else: no element of the array is
  // indexed, filtered, sliced, sorted or re-mapped by the screen.
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

  // THE SCREEN ITSELF DECIDES NOTHING ABOUT THEM. Every per-assignment value —
  // the role label, the personal window, the horse, the topic, the discipline
  // and the pairing — lives in the shared renderer, so this file cannot grow a
  // second, disagreeing copy of any of them.
  for (const token of [
    "horseName",
    "instructionTopic",
    "discipline",
    "personalStartTime",
    "personalEndTime",
    "pairedParticipantName",
    "pairedParticipantNames",
    "EXAMINEE",
    "INSTRUCTED_TRAINEE",
  ]) {
    assert.equal(SECTION_CODE.includes(token), false, `the screen re-implements ${token}`);
  }
  // ...and no pairing or timetable calculation was duplicated into UI code here.
  for (const token of ["pairingIndex", "resolvePairing", "computePairing", "addMinutes", "parseInt"]) {
    assert.equal(SECTION_CODE.includes(token), false, `the screen duplicates ${token}`);
  }
});

// ===========================================================================
// 10c–10e. EX-ROLE-SCHEDULE-REDESIGN — connected views, and no repetition
// ===========================================================================

test("10c. the three connected views are one loaded schedule, narrowed in the browser", () => {
  // לו״ז כללי, by exam type and by date — mounted as the SHARED navigation bar,
  // not re-implemented here.
  assert.ok(
    SECTION.includes('const GENERAL_VIEW_LABEL = "לו״ז כללי";'),
    "the general view has no approved label",
  );
  assert.ok(
    SECTION_CODE.includes('from "@/lib/components/ExamScheduleNav"'),
    "the screen does not mount the shared navigation bar",
  );
  assert.equal(
    (SECTION_CODE.match(/<ExamScheduleNav\s/g) ?? []).length,
    1,
    "a second navigation bar was added",
  );

  // The option lists and the narrowing come from the PURE view core, so this
  // file holds no filtering rule of its own to disagree with the trainee
  // screen's.
  assert.ok(
    SECTION_CODE.includes('from "@/lib/components/exam-schedule-view-core"'),
    "the screen does not use the shared view core",
  );
  for (const call of ["listExamDefinitionNames(allRows)", "listExamDates(allRows)"]) {
    assert.ok(SECTION_CODE.includes(call), `the options are not derived from the loaded rows: ${call}`);
  }
  assert.ok(SECTION_CODE.includes("filterExamRows(allRows, {"), "the views are not one narrowing");

  // ...and they are ONE read. There is exactly one server call on this screen,
  // it takes the course id and nothing else, and no view issues another.
  const calls = SECTION_CODE.match(/getInstructorExamSchedule\([^)]*\)/g) ?? [];
  assert.deepEqual(calls, ["getInstructorExamSchedule(selectedOfferingId)"]);
  assert.equal(
    (SECTION_CODE.match(/useEffect\(/g) ?? []).length,
    1,
    "a view change can now trigger a second load",
  );
  // The effect depends on the COURSE alone: no navigation state is in its
  // dependency list, so switching views cannot re-fetch anything.
  assert.ok(
    SECTION_CODE.includes("}, [selectedOfferingId]);"),
    "the load is no longer keyed by the course alone",
  );
  for (const token of ["navMode]", "navDate]", "navDefinitionName]"]) {
    assert.equal(SECTION_CODE.includes(token), false, `the load now depends on ${token}`);
  }
});

test("10d. a filtered view can only ever NARROW what the server already sent", () => {
  // The narrowing runs over `allRows`, which is `view.rows` — the contract as it
  // arrived. Nothing is concatenated, pushed or spread into it.
  assert.ok(SECTION_CODE.includes("const allRows = view === null ? [] : view.rows;"));
  for (const token of [
    "allRows.concat(",
    "allRows.push(",
    "view.rows.concat(",
    "view.rows.push(",
    "...allRows",
    "...view.rows",
  ]) {
    assert.equal(SECTION_CODE.includes(token), false, `the screen builds rows with ${token}`);
  }
  // A view selection is a plain local string, never anything the server reads.
  assert.equal(
    /getInstructorExamSchedule\([^)]*nav/.test(SECTION_CODE),
    false,
    "a view selection is sent to the server",
  );
});

test("10e. the participant summary is not printed twice on one block", () => {
  // A block whose operational rows are rendered below already names every
  // examinee and every instructed trainee. The summary therefore survives ONLY
  // where it is the only place those names appear at all.
  assert.ok(
    SECTION_CODE.includes("{row.assignments.length === 0 && ("),
    "the duplicate participant summary was not removed",
  );
  const guardStart = SECTION_CODE.indexOf("{row.assignments.length === 0 && (");
  const guardEnd = SECTION_CODE.indexOf("</>", guardStart);
  assert.ok(guardEnd > guardStart, "the guarded summary block could not be located");
  const summary = SECTION_CODE.slice(guardStart, guardEnd);
  assert.ok(summary.includes("row.examineeNames"), "the examinee summary moved out of the guard");
  assert.ok(
    summary.includes("row.instructedTraineeNames"),
    "the trainee summary moved out of the guard",
  );
  // Supervisors are NEVER in the operational rows, so their line is never a
  // duplicate and must stay OUTSIDE the guard — it is the one participant line
  // that always stands.
  assert.equal(
    summary.includes("row.supervisorNames"),
    false,
    "the supervisor line was hidden behind the duplicate-summary guard",
  );
  assert.ok(
    SECTION_CODE.indexOf("row.supervisorNames") > guardEnd,
    "the supervisor line disappeared or moved inside the guard",
  );
});

test("10f. the instructor screen never references the TRAINEE-ONLY isSelf marker", () => {
  // EX-BEGINNER-EXAM-READ INTEGRATION. `isSelf` exists on the TRAINEE assignment
  // contract only — it answers "is this row the signed-in trainee's", a question
  // an instructor screen has no viewer to ask. The instructor DTO does not carry
  // it, this screen must not name it, and the shared wave renderer both screens
  // mount must not read it either, or the instructor rendering would depend on a
  // field its own contract does not have.
  for (const token of ["isSelf", "selfRole", "selfLabel", "selfStartTime", "selfEndTime", "myRows"]) {
    assert.equal(SECTION_CODE.includes(token), false, `the instructor screen names ${token}`);
  }
  const sharedRenderer = stripComments(read(ASSIGNMENT_ROWS_REL));
  assert.equal(
    sharedRenderer.includes("isSelf"),
    false,
    "the shared renderer reads a trainee-only field",
  );
  // The trainee's own personal-detail renderer is where that marker is read, and
  // the instructor screen does not mount it.
  assert.equal(
    SECTION_CODE.includes("ExamPersonalAssignmentDetail"),
    false,
    "the instructor screen mounts the trainee personal-detail renderer",
  );
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
  //
  // EX-ROLE-OP-UI-MVP RE-POINT — `SECTION_REL` LEAVES THIS LIST. That slice
  // renders the newly available operational assignment rows on BOTH role
  // screens, so the instructor section is a file it necessarily edits; keeping
  // it here would pin a claim the approved work contradicts. It is a re-point,
  // not a hole: the section's every rendered value is pinned by tests 8-11
  // above, its one new hand-off is pinned by test 10b, and its whole server seam
  // is pinned by test 15. The instructor ACTION and CLIENT keep the strictly
  // byte-identical claim, because that slice touches neither.
  for (const relative of [ACTION_REL, CLIENT_REL]) {
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

/**
 * Every path this working tree may legitimately hold, spelled out EXACTLY.
 *
 * Hoisted out of test 16 by EX-BEGINNER-EXAM-READ so test 14 can hold `lib/exam`
 * to the SAME list instead of to a weaker rule of its own. One list, two checks:
 * a path approved for the repo-wide sweep is approved for the directory sweep,
 * and nothing can be approved for one and not the other.
 */
function approvedSlicePaths(): string[] {
  return [
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
    // EX-ROLE-OP-UI-MVP RE-POINT, on the same terms: an EXACT path list, never a
    // directory and never a glob. These are the operational-UI slice's own
    // paths — the shared renderer and its render tests, and the trainee
    // navigation rule that was hiding the exams entry from the very trainees the
    // exam schedule exists for. That slice's own behaviour is pinned by test 10b
    // above, by the trainee suite's own tests, and by the two suites beside
    // those files.
    ASSIGNMENT_ROWS_REL,
    ASSIGNMENT_ROWS_SUITE_REL,
    "app/student/trainee-nav-visibility.ts",
    "app/student/trainee-nav-visibility.test.ts",
    // EX-OPS-READ-MVP RE-POINT REMOVED. Nine `lib/exam` paths were approved here
    // while the operational-READ slice was in flight. That slice is merged, so
    // those entries no longer describe anything in the working tree — they are
    // dead permissions that would let an unrelated edit to an exam core pass
    // this sweep unnoticed. Dropping them restores the sweep to its full
    // strength; test 14 below independently pins that `lib/exam` is untouched.
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
    // EX-ROLE-SCHEDULE-REDESIGN, on the same terms: an EXACT path list, never a
    // directory and never a glob. These six are that slice's own NEW paths — the
    // pure view core that owns the wave grouping and the examinee/instructed-
    // trainee nesting, the shared navigation bar behind the general/type/date
    // views, the compact personal-detail renderer behind "לו״ז שלי", and the
    // suite beside each of them. Every one is a `lib/components` leaf: the slice
    // adds no route, no action, no reader and no `lib/exam` file of its own, and
    // test 14 below independently pins that last part.
    VIEW_CORE_REL,
    VIEW_CORE_SUITE_REL,
    SCHEDULE_NAV_REL,
    SCHEDULE_NAV_SUITE_REL,
    PERSONAL_DETAIL_REL,
    PERSONAL_DETAIL_SUITE_REL,
    ];
}

test("14. no admin exam file was modified, and no schema or migration", () => {
  const adminExams = "app/admin/courses/[courseOfferingId]/exams";
  assert.deepEqual(gitLines(["diff", "--name-only", "HEAD", "--", adminExams]), []);
  assert.deepEqual(gitLines(["ls-files", "--others", "--exclude-standard", adminExams]), []);
  assert.deepEqual(gitLines(["diff", "--name-only", "HEAD", "--", "prisma"]), []);
  assert.deepEqual(gitLines(["ls-files", "--others", "--exclude-standard", "prisma"]), []);
  // ...nor anything about identity, sessions or capabilities. `lib/exam` joins
  // this list with EX-ROLE-OP-UI-MVP: the operational-READ slice that legitimately
  // edited those cores is merged, so from here on any change under that directory
  // is an unrelated one, and the exact-path exception test 16 used to carry for
  // it is gone.
  // `lib/auth` and `lib/course/capabilities` keep the STRICT claim: nothing about
  // identity, sessions or capabilities may differ from HEAD, and nothing new may
  // appear under either. This slice touches neither.
  for (const dir of ["lib/auth", "lib/course/capabilities"]) {
    assert.deepEqual(gitLines(["diff", "--name-only", "HEAD", "--", dir]), []);
    assert.deepEqual(gitLines(["ls-files", "--others", "--exclude-standard", dir]), []);
  }
  // RE-POINTED by EX-BEGINNER-EXAM-READ for `lib/exam` alone, and re-pointed to an
  // EXACT PATH LIST rather than dropped. That directory was pinned to "empty"
  // because the operational-READ slice that last edited it had merged; the Level-1
  // beginner containment gate and the trainee-only assignment `isSelf` marker are
  // the next slice to legitimately edit it. `approved` names every path this tree
  // may hold, each spelled out, so an unrelated `lib/exam` change still fails —
  // and test 16 below re-checks the WHOLE working tree against the same list.
  for (const path of [
    ...gitLines(["diff", "--name-only", "HEAD", "--", "lib/exam"]),
    ...gitLines(["ls-files", "--others", "--exclude-standard", "lib/exam"]),
  ]) {
    const normalized = path.split("\\").join("/");
    assert.ok(
      approvedSlicePaths().includes(normalized),
      `an unapproved lib/exam file was touched: ${normalized}`,
    );
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
  // BOTH SIDES, and neither wholesale: the repo-wide sweep is main's — the
  // beginner-read slice hoisted this list into `approvedSlicePaths()` so test 14
  // could re-use it — and the role-schedule slice's own six paths are declared
  // inside that one helper rather than re-inlined here. One list, one place, and
  // every path in it still named EXACTLY.
  const approved = approvedSlicePaths();
  const offenders = [...touched].filter((path) => !approved.includes(path)).sort();
  assert.deepEqual(offenders, [], `an unapproved path was touched: ${offenders.join(", ")}`);
  // Nothing was staged.
  assert.deepEqual(gitLines(["diff", "--name-only", "--cached", "HEAD"]), []);
});
