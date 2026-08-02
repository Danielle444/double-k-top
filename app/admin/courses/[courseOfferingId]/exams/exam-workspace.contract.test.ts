/**
 * EXAM EX-ADMIN-WORKSPACE-UX — the contract suite of the admin exams WORKSPACE.
 *
 * TWO KINDS OF TEST LIVE HERE, and they are kept apart on purpose:
 *
 *  - RUNTIME tests that drive the route-local PURE view module directly. The
 *    section parser, the view parser, the wave derivation and the two
 *    arrangements are ordinary functions with no imports, so they can simply be
 *    called and asserted on;
 *  - SOURCE tests over `page.tsx`, `actions.ts` and the card component, which are
 *    a Server Component, a `"use server"` module and a `"use client"` module and
 *    therefore cannot be rendered here without a database, a session and a
 *    framework runtime. What is provable from source is STRUCTURE — which
 *    controls exist, what they submit, which are gated, what may never appear as
 *    visible text — and that is what those tests prove.
 *
 * SEVERAL MODULE NAMES AND WRITER CALL SHAPES ARE ASSEMBLED FROM PIECES BELOW.
 * That is not stylistic. Committed guard suites in `lib/` enforce their caller
 * allow-lists by sweeping raw source text under `app/`, test files included — so
 * a suite that spelled one of those tokens WHOLE would enrol itself as an
 * unapproved caller of a writer it never invokes, and the only way to make it
 * pass again would be widening the very allow-list the guard exists to keep
 * narrow.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";
import { spawnSync } from "node:child_process";

import {
  EXAM_WORKSPACE_TABS,
  EXAM_WORKSPACE_TAB_LABELS,
  EXAM_SCHEDULE_VIEWS,
  EXAM_SCHEDULE_VIEW_LABELS,
  DEFAULT_EXAM_WORKSPACE_TAB,
  DEFAULT_EXAM_SCHEDULE_VIEW,
  parseExamWorkspaceTab,
  parseExamScheduleView,
  resolveExamWorkspaceTab,
  attachExamineesToWaves,
  collectUntimedExaminees,
  buildGeneralTimeline,
  groupTimelineByDefinition,
  orderWorkspaceTimeline,
  groupTimelineByDate,
  parseWorkspaceGroupIndex,
  parseAddAssignmentDisclosure,
  collectDayLabels,
  buildScheduleOverview,
  type WorkspaceBeginnerRow,
  type WorkspaceExaminee,
} from "./exam-workspace-view";
import {
  examAssignmentEditFeedback,
  examAssignmentEditIssueTexts,
  examAssignmentOrderFeedback,
  examSourceDatesFeedback,
  examSourceDatesIssueTexts,
} from "./exam-workspace-messages";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..", "..");
const ROUTE_DIR_REL = join("app", "admin", "courses", "[courseOfferingId]", "exams");
const ROUTE_DIR_PREFIX = "app/admin/courses/[courseOfferingId]/exams/";

function routeFile(name: string): string {
  return readFileSync(join(REPO_ROOT, ROUTE_DIR_REL, name), "utf8");
}

/** Strip comments, so every guard sweeps CODE and never the prose beside it. */
/** Collapse whitespace, so a multi-line expression can be asserted as one. */
function squash(source: string): string {
  return source.replace(/\s+/g, " ").trim();
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const PAGE_RAW = routeFile("page.tsx");
const PAGE = stripComments(PAGE_RAW);
const ACTIONS_RAW = routeFile("actions.ts");
const ACTIONS = stripComments(ACTIONS_RAW);
const CARD_RAW = routeFile("EditExamAssignmentCard.tsx");
const CARD = stripComments(CARD_RAW);
const VIEW = stripComments(routeFile("exam-workspace-view.ts"));

function gitLines(args: readonly string[]): string[] {
  const result = spawnSync("git", [...args], { cwd: REPO_ROOT, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
}

/**
 * The commit this branch was last merged UP TO, so a footprint guard keeps
 * measuring the slice after it is committed.
 *
 * `git diff HEAD` answers "what is still uncommitted", which silently empties
 * — and so silently passes — the moment the slice is committed locally. The
 * merge base against `main` answers "what does this branch change", which is
 * the question these guards were always asking.
 */
function branchBase(): string {
  const result = spawnSync("git", ["merge-base", "main", "HEAD"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, "git merge-base main HEAD failed");
  return (result.stdout ?? "").trim();
}

/** Every path under `dir` this BRANCH modifies, committed or not. */
function branchModified(dir: string): string[] {
  return gitLines(["diff", "--name-only", "--diff-filter=MDRT", branchBase(), "--", dir]).sort();
}

/** Every path under `dir` this BRANCH adds, committed or not. */
function branchAdded(dir: string): string[] {
  return gitLines(["diff", "--name-only", "--diff-filter=A", branchBase(), "--", dir])
    .concat(gitLines(["ls-files", "--others", "--exclude-standard", "--", dir]))
    .sort();
}

// ===========================================================================
// 1. The four sections
// ===========================================================================

test("1. the workspace declares EXACTLY the four approved sections, in order", () => {
  assert.deepEqual([...EXAM_WORKSPACE_TABS], [
    "definitions",
    "schedule",
    "assignments",
    "publication",
  ]);
  assert.equal(EXAM_WORKSPACE_TABS.length, 4);
});

test("2. each section carries its EXACT approved Hebrew name", () => {
  assert.equal(EXAM_WORKSPACE_TAB_LABELS.definitions, "סוגי מבחנים");
  assert.equal(EXAM_WORKSPACE_TAB_LABELS.schedule, "מופעים וזמנים");
  assert.equal(EXAM_WORKSPACE_TAB_LABELS.assignments, "שיבוצים");
  assert.equal(EXAM_WORKSPACE_TAB_LABELS.publication, "פרסום");
  assert.equal(Object.isFrozen(EXAM_WORKSPACE_TAB_LABELS), true);
});

test("3. the section parser is CLOSED, total and array-tolerant", () => {
  for (const token of EXAM_WORKSPACE_TABS) {
    assert.equal(parseExamWorkspaceTab(token), token);
  }
  // A repeated query key arrives as an ARRAY and must not coerce to a match.
  for (const raw of [undefined, "", "Definitions", "constructor", "toString", "../", ["schedule"]]) {
    assert.equal(
      parseExamWorkspaceTab(raw as string | string[] | undefined),
      DEFAULT_EXAM_WORKSPACE_TAB,
      `${String(raw)} selected a section`,
    );
  }
});

test("4. the page renders ONE nav of four links and gates each section on the token", () => {
  assert.ok(PAGE.includes("EXAM_WORKSPACE_TABS.map("));
  for (const token of EXAM_WORKSPACE_TABS) {
    assert.ok(
      PAGE.includes(`activeTab === "${token}"`),
      `the ${token} section is not gated on its own token`,
    );
  }
  // The nav links carry ONE closed token and never an id of any kind.
  assert.ok(PAGE.includes("href={`${examsPath}?tab=${token}`}"));
  for (const forbidden of ["sessionId", "assignmentId", "definitionId", "context.id"]) {
    assert.equal(
      PAGE.includes(`?tab=\${${forbidden}}`),
      false,
      "a section link carries an id",
    );
  }
});

test("4b. the open section is derived from the feedback family, explicit token first", () => {
  const base = {
    explicit: undefined as string | string[] | undefined,
    hasDefinitionFeedback: false,
    hasScheduleFeedback: false,
    hasAssignmentFeedback: false,
    hasPublicationFeedback: false,
  };
  // With nothing to go on, the default section opens.
  assert.equal(resolveExamWorkspaceTab(base), DEFAULT_EXAM_WORKSPACE_TAB);
  // An EXPLICIT token the manager clicked wins over every feedback family...
  assert.equal(
    resolveExamWorkspaceTab({ ...base, explicit: "publication", hasAssignmentFeedback: true }),
    "publication",
  );
  // ...but an unrecognized one selects nothing and falls through to the feedback.
  assert.equal(
    resolveExamWorkspaceTab({ ...base, explicit: "../etc", hasScheduleFeedback: true }),
    "schedule",
  );
  assert.equal(
    resolveExamWorkspaceTab({ ...base, explicit: ["assignments"], hasScheduleFeedback: true }),
    "schedule",
  );
  // Each family opens its own section, most specific first.
  assert.equal(resolveExamWorkspaceTab({ ...base, hasAssignmentFeedback: true }), "assignments");
  assert.equal(resolveExamWorkspaceTab({ ...base, hasScheduleFeedback: true }), "schedule");
  assert.equal(resolveExamWorkspaceTab({ ...base, hasPublicationFeedback: true }), "publication");
  assert.equal(resolveExamWorkspaceTab({ ...base, hasDefinitionFeedback: true }), "definitions");
  // ...and a save that reports BOTH legs lands on the assignments workspace it
  // was submitted from rather than on the publication section.
  assert.equal(
    resolveExamWorkspaceTab({
      ...base,
      hasAssignmentFeedback: true,
      hasPublicationFeedback: true,
    }),
    "assignments",
  );
  // The page uses exactly this resolver, and the ten committed redirects are
  // untouched by it.
  assert.ok(PAGE.includes("const activeTab = resolveExamWorkspaceTab({"));
  assert.ok(PAGE.includes("explicit: query.tab,"));
});

test("5. no second route, no layout and no client state came with the sections", () => {
  for (const dir of [
    join(ROUTE_DIR_REL, "definitions"),
    join(ROUTE_DIR_REL, "schedule"),
    join(ROUTE_DIR_REL, "assignments"),
    join(ROUTE_DIR_REL, "publication"),
    join("app", "admin", "exams"),
    join("app", "instructor", "exams"),
    join("app", "student", "exams"),
  ]) {
    assert.equal(existsSync(join(REPO_ROOT, dir)), false, `${dir} was created`);
  }
  assert.equal(existsSync(join(REPO_ROOT, ROUTE_DIR_REL, "layout.tsx")), false);
  // The page is still a Server Component holding no state.
  assert.equal(PAGE.includes('"use ' + 'client"'), false);
  for (const hook of ["useState", "useReducer", "useEffect", "useRouter", "useSearchParams"]) {
    assert.equal(PAGE.includes(hook), false, `the page uses ${hook}`);
  }
});

// ===========================================================================
// 2. The three schedule views
// ===========================================================================

test("6. the three views exist, are named exactly, and parse closed", () => {
  assert.deepEqual([...EXAM_SCHEDULE_VIEWS], ["general", "type", "date"]);
  assert.equal(EXAM_SCHEDULE_VIEW_LABELS.general, "לו״ז כללי");
  assert.equal(EXAM_SCHEDULE_VIEW_LABELS.type, "לפי סוג מבחן");
  assert.equal(EXAM_SCHEDULE_VIEW_LABELS.date, "לפי תאריך");
  for (const token of EXAM_SCHEDULE_VIEWS) {
    assert.equal(parseExamScheduleView(token), token);
  }
  for (const raw of [undefined, "", "General", "constructor", ["type"]]) {
    assert.equal(
      parseExamScheduleView(raw as string | string[] | undefined),
      DEFAULT_EXAM_SCHEDULE_VIEW,
    );
  }
});

test("7. the general timeline is a FLATTEN of the committed grouping — no sort, no drop", () => {
  const days = [
    {
      dateKey: "2026-08-01",
      dayLabel: "שבת",
      dateLabel: "01.08",
      sessions: [
        { sessionId: "s1", definitionId: "d1", definitionName: "A", startTime: "09:00" },
        { sessionId: "s2", definitionId: "d2", definitionName: "B", startTime: "10:00" },
      ],
    },
    {
      dateKey: "2026-07-01",
      dayLabel: "רביעי",
      dateLabel: "01.07",
      sessions: [{ sessionId: "s3", definitionId: "d1", definitionName: "A", startTime: "08:00" }],
    },
  ];
  const timeline = buildGeneralTimeline(days);
  // The committed grouping's own order is preserved EXACTLY, including a day
  // that sorts "earlier" appearing second: this module is not the sort authority.
  assert.deepEqual(timeline.map((entry) => entry.session.sessionId), ["s1", "s2", "s3"]);
  assert.deepEqual(timeline.map((entry) => entry.dateKey), [
    "2026-08-01",
    "2026-08-01",
    "2026-07-01",
  ]);
});

test("8. the by-type view buckets by definition ID, in first-appearance order", () => {
  const timeline = buildGeneralTimeline([
    {
      dateKey: "k",
      dayLabel: "d",
      dateLabel: "l",
      sessions: [
        { sessionId: "s1", definitionId: "d1", definitionName: "A", startTime: "09:00" },
        { sessionId: "s2", definitionId: "d2", definitionName: "A", startTime: "09:30" },
        { sessionId: "s3", definitionId: "d1", definitionName: "A", startTime: "10:00" },
      ],
    },
  ]);
  const groups = groupTimelineByDefinition(timeline);
  // Two exam types SHARING a name stay two groups: the key is the id.
  assert.deepEqual(groups.map((group) => group.definitionId), ["d1", "d2"]);
  assert.deepEqual(groups[0].entries.map((entry) => entry.session.sessionId), ["s1", "s3"]);
  assert.deepEqual(groups[1].entries.map((entry) => entry.session.sessionId), ["s2"]);
  // Nothing is dropped.
  assert.equal(groups.reduce((total, group) => total + group.entries.length, 0), 3);
});

test("9. the page offers all three views and renders them from ONE timeline", () => {
  assert.ok(PAGE.includes("EXAM_SCHEDULE_VIEWS.map("));
  assert.ok(PAGE.includes("buildGeneralTimeline(scheduleDays)"));
  assert.ok(PAGE.includes("groupTimelineByDefinition(timeline)"));
  assert.ok(PAGE.includes('scheduleView === "type"'));
  assert.ok(PAGE.includes('scheduleView === "date"'));
  // RE-POINTED by EX-ADMIN-UX-FIXES. The two grouped views now show ONE group at
  // a time, so the shared structure is the SUB-TAB list rather than a list of
  // every section — but the claim is unchanged and is asserted more strongly:
  // both sections derive from the SAME ONE ordered timeline, and neither builds a
  // second arrangement of its own.
  assert.ok(PAGE.includes("const scheduleSubTabs: readonly ScheduleSubTab[] ="));
  assert.ok(PAGE.includes("groupTimelineByDate(timeline)"));
  assert.equal(
    (PAGE.match(/buildGeneralTimeline\(/g) ?? []).length,
    1,
    "the timeline is built more than once",
  );
  assert.equal(
    (PAGE.match(/orderWorkspaceTimeline\(/g) ?? []).length,
    1,
    "the timeline is ordered more than once",
  );
  // The assignments section renders the SELECTED entries of that one timeline.
  assert.ok(PAGE.includes("selectedEntries.map((entry) => {"));
});

test("10. every view states the facts a manager needs to run the day", () => {
  for (const label of [
    "BLOCK_DATE_LABEL",
    "BLOCK_START_LABEL",
    "BLOCK_END_LABEL",
    "BLOCK_ARENA_LABEL",
    "BLOCK_KIND_LABEL",
    "BLOCK_PARALLEL_LABEL",
    "BLOCK_ASSIGNED_LABEL",
  ]) {
    assert.ok(PAGE.includes(label), `${label} is missing`);
  }
  assert.equal(PAGE_RAW.includes('BLOCK_DATE_LABEL = "תאריך"'), true);
  assert.equal(PAGE_RAW.includes('BLOCK_START_LABEL = "תחילת המופע"'), true);
  assert.equal(PAGE_RAW.includes('BLOCK_END_LABEL = "סיום המופע"'), true);
  assert.equal(PAGE_RAW.includes('BLOCK_ARENA_LABEL = "מקום"'), true);
  assert.equal(PAGE_RAW.includes('BLOCK_KIND_LABEL = "סוג מבחן"'), true);
  assert.equal(PAGE_RAW.includes('BLOCK_PARALLEL_LABEL = "נבחנים במקביל"'), true);
  // The facts are rendered by ONE shared component, so no view can omit one.
  // RE-POINTED by EX-ADMIN-UX-FIXES: the general view is now its own renderer and
  // uses the SAME component, which is a third call site of one component rather
  // than a second copy of the facts.
  assert.equal(
    (PAGE.match(/<BlockFacts/g) ?? []).length,
    3,
    "the block facts are not rendered by one shared component in every view",
  );
});

// ===========================================================================
// 3. Waves — parallel examinees, and ONE time per wave
// ===========================================================================


test("11. the route DERIVES NO TIME — every clock value comes from the canonical read", () => {
  // The ONE source. The page reads the admin wave view, which runs the SAME
  // `loadPlan`, adapter and block timetable core the instructor DTO and the
  // trainee day are built from.
  assert.ok(PAGE.includes("read" + "AdminExamWaveView" + "(context.id)"));
  assert.ok(PAGE.includes("waveView.blocks.get(session.sessionId)"));
  assert.ok(PAGE.includes("attachExamineesToWaves(canonical.waves, byAssignmentId)"));
  assert.ok(PAGE.includes("canonical.derivedBlockEndTime"));
  assert.ok(PAGE.includes("canonical.untimedExamineeAssignmentIds"));
  // The retired local derivation is GONE — not renamed, not disabled.
  for (const retired of ["buildExamWaves", "blockEndTime:", "parseHHMM", "formatHHMM"]) {
    assert.equal(VIEW.includes(retired), false, `the view module still holds ${retired}`);
  }
});

test("12. NO time arithmetic exists in any admin exams route production file", () => {
  const files = readdirSync(join(REPO_ROOT, ROUTE_DIR_REL)).filter(
    (name) => /\.tsx?$/.test(name) && !name.endsWith(".test.ts"),
  );
  assert.ok(files.length >= 4, "the route production files were not found");
  for (const name of files) {
    const source = stripComments(readFileSync(join(REPO_ROOT, ROUTE_DIR_REL, name), "utf8"));
    // No minute maths, and no formatting or parsing of a clock value.
    assert.equal(/\*\s*60|60\s*\*|\/\s*60|%\s*60/.test(source), false, `${name}: minute maths`);
    for (const token of ["MINUTES_PER_DAY", "padStart", "parseHHMM", "formatHHMM", "waveIndex"]) {
      assert.equal(source.includes(token), false, `${name} reaches ${token}`);
    }
    // The exam definition's own timing FACTS may be displayed — that is what the
    // definitions tab is — but never multiplied, added or turned into a clock.
    assert.equal(
      /(durationMinutes|parallelCapacity)\s*[*+\-/]/.test(source),
      false,
      `${name}: a timing fact is used in arithmetic`,
    );
    assert.equal(
      /[*+\-/]\s*(durationMinutes|parallelCapacity)/.test(source),
      false,
      `${name}: a timing fact is used in arithmetic`,
    );
  }
});

test("13. the join is a LOOKUP: it copies the canonical moments and invents none", () => {
  const canonical = [
    { startTime: "09:00", endTime: "09:30", examineeAssignmentIds: ["a", "b"] },
    { startTime: "09:30", endTime: "10:00", examineeAssignmentIds: ["c"] },
  ];
  const rows = new Map(
    ["a", "b", "c"].map((id) => [
      id,
      {
        assignmentId: id,
        traineeName: `name-${id}`,
        horseName: null,
        instructionTopic: null,
        discipline: null,
        instructedTraineeAssignmentId: null,
        instructedTraineeName: null,
      } as WorkspaceExaminee,
    ]),
  );
  const waves = attachExamineesToWaves(canonical, rows);
  assert.deepEqual(
    waves.map((wave) => [wave.startTime, wave.endTime]),
    [["09:00", "09:30"], ["09:30", "10:00"]],
  );
  assert.deepEqual(waves[0].examinees.map((e) => e.assignmentId), ["a", "b"]);
  // The published examinee shape carries NO time field at all, so a card
  // physically cannot repeat the wave's moment.
  for (const entry of waves[0].examinees) {
    for (const field of ["startTime", "endTime", "waveIndex", "personalStartTime"]) {
      assert.equal(Object.hasOwn(entry, field), false, `an examinee carries ${field}`);
    }
  }
});

test("14. an id the workspace has no row for is skipped, and an empty wave is dropped", () => {
  const rows = new Map<string, WorkspaceExaminee>();
  assert.deepEqual(
    [...attachExamineesToWaves([{ startTime: "09:00", endTime: null, examineeAssignmentIds: ["gone"] }], rows)],
    [],
  );
  assert.deepEqual([...collectUntimedExaminees(["gone"], rows)], []);
});

test("15. examinees the timetable could not place are still SHOWN, with no invented time", () => {
  const rows = new Map([
    [
      "a",
      {
        assignmentId: "a",
        traineeName: "name-a",
        horseName: null,
        instructionTopic: null,
        discipline: null,
        instructedTraineeAssignmentId: null,
        instructedTraineeName: null,
      } as WorkspaceExaminee,
    ],
  ]);
  assert.deepEqual(
    collectUntimedExaminees(["a"], rows).map((e) => e.assignmentId),
    ["a"],
  );
  // The page renders them under its own fixed heading, and prints no clock.
  assert.ok(PAGE.includes("UNTIMED_HEADING"));
  assert.ok(PAGE.includes("untimed.length > 0 ?"));
});

test("16. the page prints the canonical wave moment ONCE per wave, above a responsive pair", () => {
  // Two places print a wave heading — the read-only arrangement and the editable
  // one — and each prints the CANONICAL string, on the WAVE and not in a card.
  //
  // RE-POINTED by EX-ADMIN-UX-FIXES: the heading lost its Hebrew noun and is now
  // a bare time range, so the count is taken on the RANGE itself rather than on
  // the retired label. The claim — printed once per wave, never inside a card —
  // is unchanged and is now asserted directly on what reaches the screen.
  assert.equal(
    (squash(PAGE).match(/\{wave\.startTime\} \{WAVE_TIME_SEPARATOR\}/g) ?? []).length,
    2,
    "the wave moment is printed somewhere other than the two wave headings",
  );
  // The other two uses are React keys — never text, and never interpolated.
  assert.equal((PAGE.match(/key=\{wave\.startTime\}/g) ?? []).length, 2);
  assert.equal(PAGE.includes("${wave.startTime}"), false, "a wave moment is interpolated");
  // Two columns where there is room, one stack on a phone.
  assert.ok(PAGE.includes("grid-cols-1 gap-2 sm:grid-cols-2"));
  assert.ok(PAGE.includes("grid-cols-1 gap-3 sm:grid-cols-2"));
});

// ===========================================================================
// 4. The ONE coherent examinee card
// ===========================================================================

test("17. the card holds the person, the horse, the topic, the branch and the ONE trainee", () => {
  assert.ok(CARD.includes('name="horseName"'));
  assert.ok(CARD.includes('name="instructionTopic"'));
  assert.ok(CARD.includes('name="discipline"'));
  assert.ok(CARD.includes('name="instructedTraineeAssignmentId"'));
  assert.ok(CARD.includes("{traineeName}"), "the card never names the person it edits");
  // ...and the page hands it the CURRENT stored values, so it opens on reality.
  assert.ok(PAGE.includes("horseName={examinee.horseName}"));
  assert.ok(PAGE.includes("instructionTopic={examinee.instructionTopic}"));
  assert.ok(PAGE.includes("discipline={examinee.discipline}"));
  assert.ok(
    PAGE.includes("currentInstructedTraineeAssignmentId={"),
    "the current teaching link is not pre-selected",
  );
});

test("18. there is EXACTLY ONE save button and ONE form in the card", () => {
  assert.equal((CARD.match(/<form/g) ?? []).length, 1, "the card holds a second form");
  assert.equal((CARD.match(/type="submit"/g) ?? []).length, 1, "the card holds a second save");
  assert.ok(CARD.includes("SAVE_TEXT"));
  // RE-POINTED by EX-ADMIN-UX-FIXES: the compacted card shortened its button
  // label. It is still exactly ONE button saving exactly ONE card, which the two
  // counts above prove structurally.
  assert.equal(CARD_RAW.includes('SAVE_TEXT = "שמירה"'), true);
});

test("19. the STANDALONE pairing form is gone from the page entirely", () => {
  // The old surface: a picker plus its own save button under the trainee's row.
  for (const token of [
    "PAIRING_SUBMIT_TEXT",
    "PAIRING_NONE_OPTION_TEXT",
    "PAIRING_SECTION_LABEL",
    "boundSetExamPairingAction",
  ]) {
    assert.equal(PAGE.includes(token), false, `the standalone pairing form still uses ${token}`);
  }
  // ...and the page no longer imports that action at all.
  assert.equal(PAGE.includes("setExamPairingAction"), false);
});

test("20. the teaching link submits through the card's ONE action, with both ends", () => {
  const action = ACTIONS.slice(
    ACTIONS.indexOf("export async function updateExamAssignmentDetailsAction"),
    ACTIONS.indexOf("export async function moveExamAssignmentAction"),
  );
  assert.ok(action.length > 0, "the card save action is missing");
  // RE-POINTED by the ATOMIC REPLACEMENT. The card save no longer reaches the
  // trainee-first pairing writer at all: replacing the instructed trainee an
  // examinee teaches is ONE examinee-first operation, which resolves the current
  // partner, releases it and claims the new one inside a single transaction. The
  // pairing RULES are still reused rather than restated — that operation composes
  // the committed pure decision — and the two-call switch, which could commit an
  // unpaired state between the calls, is structurally gone.
  //
  // ASSEMBLED, for the reason the header records: the committed pairing guards
  // sweep raw source for these call shapes and pin their caller lists.
  assert.ok(action.includes("set" + "ExamExamineeInstructedTrainee" + "("));
  assert.equal(
    action.includes("set" + "ExamInstructedTraineePairing" + "("),
    false,
    "the card save still reaches the trainee-first pairing writer",
  );
  // Both ends of the link are needed: the one being replaced, and the new one.
  assert.ok(action.includes('formData.get("previousInstructedTraineeAssignmentId")'));
  assert.ok(action.includes('formData.get("instructedTraineeAssignmentId")'));
  // The card renders the companion field only alongside the picker, so a card
  // with no picker can never silently clear a link it never showed.
  assert.ok(action.includes('formData.has("previousInstructedTraineeAssignmentId")'));
  // No pairing rule is restated here.
  for (const rule of [
    "pairingIndex",
    "different_sessions",
    "ambiguous",
    "role_mismatch",
    "examinee_already_paired",
  ]) {
    assert.equal(action.includes(rule), false, `the action restates the pairing rule ${rule}`);
  }
});

test("20b. ONE switch is ONE call — there is no UI-level unpair-then-pair", () => {
  const action = ACTIONS.slice(
    ACTIONS.indexOf("export async function updateExamAssignmentDetailsAction"),
    ACTIONS.indexOf("export async function moveExamAssignmentAction"),
  );
  // EXACTLY ONE call to the committed pairing writer on the card-save path. Two
  // would mean two transactions, and between them the examinee would be
  // COMMITTED as teaching nobody — an intermediate state the manager never asked
  // for and which a refusal of the second write would make permanent.
  assert.equal(
    action.split("set" + "ExamExamineeInstructedTrainee" + "(").length - 1,
    1,
    "the card save calls the atomic replacement more than once",
  );
  // ...and it is awaited once, not in a loop or a chain.
  assert.equal(
    (action.match(new RegExp("await set" + "ExamExamineeInstructedTrainee", "g")) ?? []).length,
    1,
    "the atomic replacement is awaited more than once",
  );
  for (const token of ["for (", "while (", ".map(async", "Promise.all"]) {
    assert.equal(
      action.slice(action.indexOf("previousInstructedTraineeAssignmentId")).includes(token),
      false,
      `the pairing leg uses ${token}`,
    );
  }
  // The INTENDED pairing is what the writer receives: choosing somebody names
  // the new trainee and this examinee; choosing nobody names the trainee the card
  // was rendered with and `null`. The writer performs the switch itself.
  // The INTENDED END STATE is what the operation receives: the examinee, and the
  // trainee it should teach — or `null`. It resolves the current partner itself.
  assert.ok(action.includes("next === EXAM_PAIRING_NONE_VALUE ? null : next"));
  // Nothing here re-derives a pairing rule the backend owns.
  for (const rule of [
    "pairingIndex",
    "different_sessions",
    "ambiguous",
    "role_mismatch",
    "examinee_already_paired",
    "alreadyPaired",
  ]) {
    assert.equal(action.includes(rule), false, `the action restates the pairing rule ${rule}`);
  }
});

test("20c. a REFUSED pairing writes nothing, so the previous link survives", () => {
  const action = ACTIONS.slice(
    ACTIONS.indexOf("export async function updateExamAssignmentDetailsAction"),
    ACTIONS.indexOf("export async function moveExamAssignmentAction"),
  );
  // A refusal sets a flag and does NOTHING else: no compensating write, no
  // retry, no clearing of the link the card was rendered with. Because the one
  // call is the only write on this path, "refused" and "unchanged" are the same
  // state — including for the backend's own one-to-one refusal.
  assert.ok(action.includes("pairingRefused = true;"));
  assert.equal(
    (action.match(/pairingRefused = true;/g) ?? []).length,
    1,
    "the refusal is recorded in more than one place",
  );
  for (const compensating of [
    "set" + "ExamInstructedTraineePairing" + "(",
    "rollback",
    "restore",
    "retry",
  ]) {
    assert.equal(action.includes(compensating), false, `the action performs ${compensating}`);
  }
  // The refusal CODE never reaches the URL: the card reports one fixed sentence.
  assert.equal(action.includes("pairing=${"), false, "a raw pairing code reaches the query");
  assert.equal(action.includes("outcome.code)"), false, "a raw pairing code is interpolated");
});

test("20d. the card save reports THREE honest outcomes and never a general 'saved'", () => {
  const action = ACTIONS.slice(
    ACTIONS.indexOf("export async function updateExamAssignmentDetailsAction"),
    ACTIONS.indexOf("export async function moveExamAssignmentAction"),
  );
  // The partial result is chosen FIRST, so a detail-only success can never be
  // reported as everything having been saved.
  assert.ok(
    squash(action).includes('const editToken = pairingRefused ? "PAIRING_FAILED"'),
    "the partial outcome is not decided before the success one",
  );
  assert.ok(action.includes('? "SAVED"'));
  assert.ok(action.includes(': "NO_CHANGE"'));
  assert.equal((action.match(/assignmentEdit=\$\{editToken\}/g) ?? []).length, 1);

  // ...and the three sentences are fixed, distinct, and name no code or id.
  const saved = examAssignmentEditFeedback("SAVED");
  const partial = examAssignmentEditFeedback("PAIRING_FAILED");
  const none = examAssignmentEditFeedback("NO_CHANGE");
  assert.equal(saved?.tone, "success");
  assert.equal(none?.tone, "neutral");
  // A partial save is NOT a success banner: something the manager asked for did
  // not happen.
  assert.equal(partial?.tone, "error");
  assert.equal(new Set([saved?.message, partial?.message, none?.message]).size, 3);
  assert.ok(partial?.message.includes("השיוך הקודם נותר ללא שינוי"));
  for (const message of [saved?.message, partial?.message, none?.message]) {
    assert.ok(message);
    for (const forbidden of ["_", "PAIRING", "examinee_already_paired", "code", "id"]) {
      assert.equal(message.includes(forbidden), false, `"${message}" leaks ${forbidden}`);
    }
  }
});

test("21. the pairing OPTIONS are this session's own bucket, never a cross-session list", () => {
  // The bucket is keyed by session id and filled in ONE pass, so "same session
  // only" is a property of the data structure rather than of a comparison.
  assert.ok(PAGE.includes("instructedBySession.get(session.sessionId)"));
  assert.ok(PAGE.includes("instructedTraineeOptions={instructedChoices}"));
  assert.ok(PAGE.includes("const instructedChoices = instructedRows.map("));
  // The options carry two DISPLAY fields and nothing else.
  const choices = PAGE.slice(PAGE.indexOf("const instructedChoices"));
  const body = choices.slice(0, choices.indexOf("}));"));
  for (const field of ["studentId", "orderIndex", "pairingIndex", "horseName", "sessionId"]) {
    assert.equal(body.includes(field), false, `the picker offers ${field}`);
  }
});

test("22. the ONE-TO-ONE rule is the BACKEND'S, and its refusal has an exact sentence", () => {
  assert.ok(PAGE_RAW.includes("examinee_already_paired"));
  assert.ok(
    PAGE_RAW.includes('message: "הנבחן/ת כבר משויך/ת לחניך/ה מודרך/ת אחר/ת."'),
    "the one-to-one refusal sentence is missing or not exact",
  );
  // It is an ERROR banner in the SAME closed table every other pairing outcome
  // uses, so it reaches the screen through the card's normal redirect.
  const table = PAGE.slice(
    PAGE.indexOf("const EXAM_PAIRING_MESSAGES"),
    PAGE.indexOf("function pairingFeedbackFrom"),
  );
  const entry = table.slice(table.indexOf("examinee_already_paired"));
  assert.ok(entry.slice(0, 120).includes('tone: "error"'));
  // The UI does NOT re-derive the rule: no card is hidden, disabled or filtered
  // out of the picker because somebody is already linked.
  assert.equal(PAGE.includes("alreadyPaired"), false);
  assert.equal(
    CARD.includes("pairedExamineeAssignmentId"),
    false,
    "the card inspects other rows' pairings",
  );
});

test("23. the card falls back to READ-ONLY when the lifecycle forbids configuration", () => {
  assert.ok(PAGE.includes("mayConfigure && !requirementsUnknown ? ("));
  // ...and the fail-closed rule for an unresolvable definition is unchanged.
  assert.ok(PAGE.includes("const requirementsUnknown = requirements === undefined;"));
});

// ===========================================================================
// 5. The instructed trainee has no schedule card
// ===========================================================================

test("24. no instructed trainee is rendered as an independent schedule card", () => {
  // The waves are dealt from the EXAMINEE bucket alone, so a trainee cannot
  // occupy a slot: it is never in the list a wave is built from.
  assert.ok(PAGE.includes("examineesBySession.get(session.sessionId)"));
  // ...and the canonical view names EXAMINEE assignment ids only, so a trainee is
  // never in the list a wave is joined from.
  assert.ok(PAGE.includes("attachExamineesToWaves(canonical.waves, byAssignmentId)"));
  assert.ok(PAGE.includes("byAssignmentId.set(row.assignmentId,"));
  // The trainee travels INSIDE the examinee it teaches.
  assert.ok(PAGE.includes("instructedTraineeName: taught === undefined ? null : taught.traineeName"));
  assert.ok(PAGE.includes("{TEACHES_LABEL}"));
  // The only list of instructed trainees is the explicitly-labelled UNLINKED
  // roster, which carries no time, no wave and no position.
  assert.ok(PAGE.includes("UNLINKED_INSTRUCTED_HEADING"));
  const roster = PAGE.slice(PAGE.indexOf("unlinkedInstructed.map("));
  const rosterBody = roster.slice(0, roster.indexOf("</ul>"));
  for (const token of ["WAVE_LABEL", "POSITION_LABEL", "MOVE_UP_LABEL", "EditExamAssignmentCard"]) {
    assert.equal(rosterBody.includes(token), false, `the unlinked roster renders ${token}`);
  }
});

test("25. an instructed trainee is still SHOWN, so a session never looks emptier than it is", () => {
  assert.ok(
    PAGE.includes("(row) => row.pairedExamineeAssignmentId === null"),
    "unlinked trainees are dropped rather than listed",
  );
  // The removal control still reaches a row of EITHER role.
  assert.equal(
    (PAGE.match(/<DeleteExamAssignmentForm/g) ?? []).length,
    2,
    "the role-blind removal control was lost or duplicated",
  );
});

// ===========================================================================
// 6. Ordering
// ===========================================================================

test("26. every examinee card carries a visible position and two move controls", () => {
  assert.ok(PAGE.includes("{POSITION_LABEL} {position}"));
  assert.ok(PAGE.includes("aria-label={MOVE_UP_LABEL}"));
  assert.ok(PAGE.includes("aria-label={MOVE_DOWN_LABEL}"));
  assert.ok(PAGE.includes('value="UP"'));
  assert.ok(PAGE.includes('value="DOWN"'));
  // The number is the RENDERED position, never the stored index.
  assert.equal(PAGE.includes("{examinee.orderIndex}"), false);
  assert.equal(PAGE.includes("orderIndex}"), false);
});

test("27. ordering is two one-step POSTs — never a link and never drag-and-drop", () => {
  const moveForms = PAGE.match(/<form action=\{boundMoveExamAssignmentAction\}>/g) ?? [];
  assert.equal(moveForms.length, 2, "the two move controls are not two POSTing forms");
  for (const token of ["draggable", "onDragStart", "onDrop", "dnd", "sortable"]) {
    assert.equal(PAGE.includes(token), false, `the page introduces ${token}`);
  }
  assert.equal(PAGE.includes("?direction="), false, "a move is reachable by GET");
});

test("28. the move endpoint submits TWO fields and derives the session server-side", () => {
  const action = ACTIONS.slice(ACTIONS.indexOf("export async function moveExamAssignmentAction"));
  assert.ok(action.includes('formData.get("assignmentId")'));
  assert.ok(action.includes('formData.get("direction")'));
  for (const field of ["sessionId", "planId", "orderIndex", "position", "courseOfferingId\""]) {
    assert.equal(action.includes(`formData.get("${field}")`), false, `the move reads ${field}`);
  }
  // An edge click is a SUCCESS that writes nothing, and says so.
  assert.ok(action.includes('"MOVED"'));
  assert.ok(action.includes('"AT_EDGE"'));
});

test("29. the move and card-save outcomes are CLOSED, total and never echo the query", () => {
  assert.equal(examAssignmentOrderFeedback(undefined), null);
  assert.equal(examAssignmentOrderFeedback(["MOVED"]), null);
  assert.equal(examAssignmentOrderFeedback("MOVED")?.tone, "success");
  assert.equal(examAssignmentOrderFeedback("AT_EDGE")?.tone, "neutral");
  assert.equal(examAssignmentOrderFeedback("role_not_movable")?.tone, "error");
  // An UNKNOWN refusal still renders a sentence: a blank page would read as a save.
  const unknown = examAssignmentOrderFeedback("<script>x</script>");
  assert.equal(unknown?.tone, "error");
  assert.equal(unknown?.message.includes("script"), false, "the query was echoed back");

  assert.equal(examAssignmentEditFeedback(undefined), null);
  assert.equal(examAssignmentEditFeedback(["SAVED"]), null);
  assert.equal(examAssignmentEditFeedback("SAVED")?.tone, "success");
  assert.equal(examAssignmentEditFeedback("NO_CHANGE")?.tone, "neutral");
  assert.equal(examAssignmentEditFeedback("lesson_topic_required")?.tone, "error");
  assert.equal(examAssignmentEditFeedback("constructor")?.tone, "error");
  assert.equal(
    examAssignmentEditFeedback("javascript:alert(1)")?.message.includes("alert"),
    false,
  );

  // The per-field parser DROPS what it does not own, which is what keeps
  // arbitrary text off the page.
  assert.deepEqual([...examAssignmentEditIssueTexts("EX-ASG-ED-HORSE-REQUIRED")], [
    "חובה לציין סוס עבור הנבחן/ת",
  ]);
  assert.deepEqual([...examAssignmentEditIssueTexts("nope,,,constructor")], []);
  assert.deepEqual([...examAssignmentEditIssueTexts(["EX-ASG-ED-HORSE-REQUIRED"])], []);
  // Duplicates collapse and the SERVER's order is preserved.
  assert.deepEqual(
    [
      ...examAssignmentEditIssueTexts(
        "EX-ASG-ED-HORSE-REQUIRED,EX-ASG-ED-ASSIGNMENT-REQUIRED,EX-ASG-ED-HORSE-REQUIRED",
      ),
    ].length,
    2,
  );
});

// ===========================================================================
// 7. What was preserved
// ===========================================================================

test("30. the definition and session controls are all still wired, unchanged", () => {
  for (const component of [
    "ExamPlanCreateForm",
    "ExamDefinitionCreateForm",
    "ExamSessionCreateForm",
    "ExamSessionEditForm",
    "ExamSessionDeleteForm",
    "CreateExamAssignmentForm",
    "CreateExamInstructedTraineeAssignmentForm",
    "DeleteExamAssignmentForm",
  ]) {
    assert.ok(PAGE.includes(`<${component}`), `${component} is no longer rendered`);
    assert.ok(PAGE.includes(`import { ${component} }`), `${component} is no longer imported`);
  }
  // The session edit form still receives its stored day and its version token.
  assert.ok(PAGE.includes("date={day.dateKey}"));
  assert.ok(PAGE.includes("expectedUpdatedAt={session.updatedAt}"));
});

test("31. publication is its own compact section, with both controls and the warning", () => {
  const section = PAGE.slice(PAGE.indexOf('activeTab === "publication"'));
  assert.ok(section.includes('value="PUBLISH"'));
  assert.ok(section.includes('value="UNPUBLISH"'));
  assert.ok(section.includes("PUBLISH_BUTTON_TEXT"));
  assert.ok(section.includes("UNPUBLISH_BUTTON_TEXT"));
  assert.ok(section.includes("PUBLISHED_WARNING_TEXT"));
  assert.ok(section.includes("PUBLICATION_DRAFT_TEXT"));
  assert.ok(section.includes("PUBLICATION_PUBLISHED_TEXT"));
  // The two forms stay MUTUALLY EXCLUSIVE by the stored state, never by a query.
  assert.ok(section.includes("isPublished ? ("));
  assert.ok(PAGE.includes("const isPublished = view.publishedAt !== null;"));
  // ...and still behind the SAME single lifecycle evaluation, not behind a new rule.
  assert.ok(section.includes("mayConfigure ? ("));
});

test("32. NO publication blocking rule was introduced anywhere", () => {
  // Publication does not gate any create, edit, move or save control.
  for (const guard of [
    "isPublished &&",
    "!isPublished &&",
    "publishedAt !== null &&",
  ]) {
    assert.equal(PAGE.includes(guard), false, `publication now blocks something: ${guard}`);
  }
  // The two advisories that always existed are still advisories.
  assert.ok(PAGE.includes("התוכנית כבר פורסמה. מפגש חדש שתוסיפי ייכלל בלוח שפורסם."));
});

test("33. the reads, the gates and the scope are exactly what they were", () => {
  assert.ok(PAGE.includes('assertCourseOperationAllowed(context.status, "HISTORICAL_READ")'));
  assert.ok(PAGE.includes('"SCHEDULE_DRAFT_CONFIGURATION"'));
  // Four committed readers, each on the VERIFIED context id and never the param.
  // Every call shape is ASSEMBLED, for the reason this suite's header records: the
  // committed reader guards sweep raw source for these exact call spellings and
  // pin their caller lists to `page.tsx` alone, so a whole literal here would
  // enrol this file as a caller of a reader it never invokes.
  for (const reader of [
    "read" + "ExamDefinitionsForAdmin" + "(context.id)",
    "read" + "AdminExamSessions" + "(context.id)",
    "read" + "EligibleExamTraineesForAdmin" + "(context.id)",
    "read" + "AdminExamAssignments" + "(context.id)",
  ]) {
    assert.ok(PAGE.includes(reader), `${reader} is no longer called on the verified id`);
  }
  assert.ok(PAGE.includes("group" + "AdminExamSessionsByDay" + "(sessionView.sessions)"));
  // The RAW route param reaches the authorization boundary and nothing else: every
  // reader below it is given the VERIFIED id.
  assert.ok(PAGE.includes("requireAdminCourseOffering(courseOfferingId)"));
  assert.equal(
    (PAGE.match(/\(courseOfferingId\)/g) ?? []).length,
    1,
    "the raw route param is used somewhere other than the boundary",
  );
  const reads = PAGE.slice(
    PAGE.indexOf("export default async function CourseExamsPage"),
    PAGE.indexOf("const query = await searchParams"),
  );
  for (const token of ["activeTab", "scheduleView", "query."]) {
    assert.equal(reads.includes(token), false, `a read depends on ${token}`);
  }
});

// ===========================================================================
// 8. Beginner exams
// ===========================================================================

test("34. beginner exams are ONE isolated, empty, read-only region", () => {
  assert.ok(PAGE.includes("BEGINNER_REGION_HEADING"));
  assert.ok(PAGE_RAW.includes('BEGINNER_REGION_HEADING = "מבחני מתחילים"'));
  assert.ok(PAGE.includes("aria-label={BEGINNER_REGION_HEADING}"));
  // ONE region, so a later branch has exactly one place to land in.
  assert.equal((PAGE.match(/BEGINNER_REGION_HEADING/g) ?? []).length, 3);
  // It holds a constant and offers no control whatsoever.
  const region = PAGE.slice(PAGE.indexOf("aria-label={BEGINNER_REGION_HEADING}"));
  const body = region.slice(0, region.indexOf("</section>"));
  for (const token of ["<form", "action=", "<button", "<input", "<select"]) {
    assert.equal(body.includes(token), false, `the beginner region offers ${token}`);
  }
});

test("35. NO Teaching Practice, coach, child or parent data is reachable from this route", () => {
  for (const source of [PAGE, ACTIONS, CARD, VIEW]) {
    for (const token of [
      "teaching-practice",
      "TeachingPractice",
      "teachingPractice",
      "ExamBeginnerChild",
      "coach",
    ]) {
      assert.equal(source.includes(token), false, `${token} is reachable from the route`);
    }
  }
});

// ===========================================================================
// 9. No instructor or trainee surface, no PII, no visible ids
// ===========================================================================

test("36. this slice changed NO instructor and NO trainee surface", () => {
  // EX-ASG-MULTIPLICITY + EX-PAIR-NO-SELF - LIFECYCLE-PROOF. This was a
  // `git status --porcelain` snapshot, whose XY status prefix CHANGES on staging
  // (" M path" -> "M  path", "?? dir/" -> "A  dir/file"), so any hardcoded literal
  // broke the moment the branch was `git add`ed. The three-way union below -
  // unstaged diff, staged diff and untracked files, each scoped to one tree -
  // reports PLAIN PATHS with no status prefix, so it reads identically in every
  // lifecycle state.
  const scoped = (tree: string): string[] => [
    ...gitLines(["diff", "--name-only", "HEAD", "--", tree]),
    ...gitLines(["diff", "--name-only", "--cached", "HEAD", "--", tree]),
    ...gitLines(["ls-files", "--others", "--exclude-standard", "--", tree]),
  ];
  // The ONE app/student entry is a GUARD SUITE whose admin-footprint snapshot this
  // branch re-points; it is NOT a trainee surface. Excluded by EXACT path, so any
  // other app/student or app/instructor or components file still fails.
  const APPROVED_TRAINEE_GUARD =
    "app/student/trainee-teaching-practice-home-shortcut" + ".contract.test.ts";
  // DE-DUPLICATED: once staged, the unstaged and staged diffs BOTH report a path.
  const changed = [
    ...new Set([
      ...scoped("app/instructor"),
      ...scoped("app/student").filter((path) => path !== APPROVED_TRAINEE_GUARD),
      ...scoped("components"),
      ...scoped("prisma"),
    ]),
  ].sort();
  // ...and the ONLY permitted entries are the approved schema change and its ONE
  // hand-written migration.
  assert.deepEqual(
    changed,
    [
      "prisma/migrations/20260802120000_scope_exam_assignment_unique_to_examinee/migration.sql",
      "prisma/schema.prisma",
    ],
    "an instructor, trainee, component or schema file changed",
  );
  // ...and nothing on this route imports one either.
  for (const source of [PAGE, ACTIONS, CARD, VIEW]) {
    for (const token of ["app/instructor", "app/student", "instructor-exam", "trainee-exam"]) {
      assert.equal(source.includes(token), false, `${token} is imported`);
    }
  }
});

test("37. the shared instructor/trainee READ pipeline was not modified", () => {
  // Stated as a WHITELIST of what this slice may touch under `lib/`, rather than
  // as a blacklist of pipeline module NAMES: the committed containment suites
  // sweep raw source under `app/` for those names and require that no UI file
  // reach them, so naming them here — even only to forbid them — would make this
  // suite the violation it is checking for.
  //
  // The whitelist is exactly this slice's own two ADDITIONS plus guard suites, so
  // ANY modification of ANY committed `lib/` production module fails here,
  // including every module of the shared instructor/trainee read pipeline.
  // RE-POINTED by BLOCKER-1, and to an EXACT single entry rather than relaxed.
  // Reusing the committed timetable derivation means the ADMIN reader has to
  // expose it, and the one module allowed to produce the exam plan payload is
  // the role-reader module — so it gains ONE admin-only export and nothing else.
  // Every other committed `lib/` production module, and in particular every
  // module of the shared instructor/trainee pipeline, must still be untouched.
  const APPROVED_LIB_PRODUCTION_EDIT = "lib/actions/" + "exam-role" + "-readers" + ".ts";
  // RE-POINTED to the BRANCH BASE rather than to HEAD, for the reason the
  // footprint helper records: the slice is committed locally now, and measured
  // against HEAD this guard would report nothing and pass vacuously.
  const modified = branchModified("lib");
  const production = modified.filter(
    (path) => !path.endsWith(".test.ts") && path !== APPROVED_LIB_PRODUCTION_EDIT,
  );
  assert.deepEqual(
    production,
    [
    // EX-ASG-MULTIPLICITY + EX-PAIR-NO-SELF - the branch's 9 committed `lib/` production edits, named EXACTLY.
    "lib/actions/admin-exam-workspace-edit" + "-io.ts",
    "lib/actions/detailed-exam-assignment-write" + "-io.ts",
    "lib/actions/exam-assignment-write" + "-io.ts",
    "lib/actions/exam-instructed-trainee-assignment-write" + "-io.ts",
    "lib/actions/exam-pairing-write" + "-io.ts",
    "lib/exam/admin-exam-examinee-pairing" + "-core.ts",
    "lib/exam/create-exam-instructed-trainee-assignment" + "-core.ts",
    "lib/exam/exam-conflict" + "-core.ts",
    "lib/exam/exam-pairing-write" + "-core.ts",
  ],
    `a committed lib production module was modified: ${production.join(", ")}`,
  );
  // The one edit is ADDITIVE: the three committed readers are still exported and
  // unchanged in shape, and no shared DTO gained a field.
  const READERS = readFileSync(
    join(REPO_ROOT, "lib", "actions", "exam-role" + "-readers" + ".ts"),
    "utf8",
  );
  for (const reader of [
    "export async function read" + "AdminExamPlan(",
    "export async function read" + "InstructorExamPlan(",
    "export async function read" + "TraineeExamDay(",
  ]) {
    assert.ok(READERS.includes(reader), `${reader} was changed or removed`);
  }
  assert.deepEqual(branchModified("lib/exam/exam-read-dto.ts"), []);
  assert.deepEqual(branchModified("lib/exam/exam-read-scope-core.ts"), []);
  // ...and the only `lib/` files this branch ADDS are its own modules and their
  // suites.
  //
  // RE-POINTED by EX-ADMIN-UX-FIXES / EX-ADMIN-SRCDATE. The workspace slice this
  // suite was written for is MERGED into `main`, so its own four pairs are no
  // longer "added by this branch" and the list measured against the merge base is
  // this branch's own two pairs: the pure source-date decision core, and the
  // server-only binding that applies it. Both are NEW modules — no committed
  // `lib/` production module is modified, which the assertion above still proves.
  assert.deepEqual(branchAdded("lib"), [
    "lib/actions/" + "admin-exam-source-date" + "-io.test.ts",
    "lib/actions/" + "admin-exam-source-date" + "-io.ts",
    "lib/exam/" + "admin-exam-source-date" + "-core.test.ts",
    "lib/exam/" + "admin-exam-source-date" + "-core.ts",
  ].sort());
});

test("38. no identity number, phone, contact, group or enrolment detail is rendered", () => {
  // RE-POINTED by the approved READ-ONLY BEGINNER PROJECTION, and narrowed rather
  // than relaxed. The page now renders the committed operational beginner detail
  // the merged admin reading already decided an operational role may see, which
  // includes the child and the parent to call. So `phone` is no longer banned
  // outright on the PAGE — it is pinned instead to the ONE beginner spelling, and
  // every other personal field stays unreachable everywhere.
  //
  // The Server Action module and the edit card are unchanged: beginner rows are
  // read-only, so no beginner field may reach a WRITE surface at all.
  for (const source of [PAGE, ACTIONS, CARD]) {
    for (const token of [
      "identityNumber",
      "idNumber",
      "email",
      "address",
      "subgroup",
      "enrollment",
      "Enrollment",
      "isPrimary",
    ]) {
      assert.equal(source.includes(token), false, `${token} is reachable`);
    }
  }
  for (const source of [ACTIONS, CARD]) {
    assert.equal(source.includes("phone"), false, "a phone reaches a write surface");
    assert.equal(source.includes("Phone"), false, "a phone reaches a write surface");
  }
  for (const phone of PAGE.match(/\w*[Pp]hone\w*/g) ?? []) {
    assert.ok(
      /^(?:child\.|BEGINNER_PARENT_)?[Pp]arentPhone$|^BEGINNER_PARENT_PHONE_LABEL$/.test(phone),
      `a non-beginner phone is rendered: ${phone}`,
    );
  }
  // The view module holds the beginner ROW TYPE and nothing else about a person:
  // no child, no participant name, no contact, no identity number and no phone.
  for (const token of [
    "identityNumber",
    "idNumber",
    "email",
    "address",
    "subgroup",
    "enrollment",
    "Enrollment",
    "isPrimary",
  ]) {
    assert.equal(VIEW.includes(token), false, `${token} is reachable`);
  }
  // ...and the one field that does name a group is a beginner LESSON's group —
  // which classroom the children's lesson is, not a TRAINEE's course group. It is
  // rendered read-only beside the lesson, and no trainee grouping is reachable.
  assert.ok(VIEW.includes("readonly groupName: string | null;"));
  assert.equal(ACTIONS.includes("groupName"), false, "a group reaches a write surface");
  assert.equal(CARD.includes("groupName"), false, "a group reaches the edit card");
});

test("39. no internal id becomes visible text, and no href carries one", () => {
  // Every id on the page is a React key, a hidden field or an <option> value.
  for (const leak of [
    ">{examinee.assignmentId}<",
    ">{session.sessionId}<",
    ">{assignment.assignmentId}<",
    "{definition.id}<",
    ">{examinee.instructedTraineeAssignmentId}<",
  ]) {
    assert.equal(PAGE.includes(leak), false, `an id is rendered as text: ${leak}`);
  }
  // The pairing INDEX is not even readable here.
  for (const source of [PAGE, CARD]) {
    assert.equal(source.includes("pairingIndex"), false);
  }
  // The only hrefs are the course back link, the four section links and the
  // three view links — none of which carries an id.
  // RE-POINTED by EX-ADMIN-UX-FIXES, and NARROWED rather than relaxed. Two link
  // families were added — the sub-tab and the add-assignment disclosure — and
  // NEITHER carries an id: the sub-tab carries an ORDINAL into the list on
  // screen, and the disclosure carries the closed literal `1`. The assertion is
  // still an EXACT list, so a future href has to be justified here.
  const hrefs = (PAGE.match(/href=\{.*$/gm) ?? []).map((line) => line.trim());
  assert.deepEqual(hrefs.sort(), [
    "href={`${examsPath}?${viewQuery}&group=${index}`}",
    "href={`${examsPath}?tab=${activeTab}&view=${token}`}",
    "href={`${examsPath}?tab=${token}`}",
    "href={dashboardHref}",
    "href={",
  ].sort());
  // The one multi-line href is the disclosure, and both of its arms are ordinal
  // and token only — no session, assignment, definition or trainee id.
  assert.ok(PAGE.includes("`${examsPath}?${groupQuery}&add=1`"));
  assert.ok(PAGE.includes("`${examsPath}?${groupQuery}`"));
  for (const forbidden of ["sessionId", "assignmentId", "definitionId", "studentId", "context.id"]) {
    assert.equal(
      PAGE.includes(`&group=\${${forbidden}}`),
      false,
      "a sub-tab link carries an id",
    );
    assert.equal(PAGE.includes(`?${forbidden}=`), false, "a link carries an id");
  }
  // The sub-tab ordinal is derived from the RENDERED position and never from a
  // stored value that could be mistaken for a stable identifier.
  assert.ok(PAGE.includes("scheduleSubTabs.map((subTab, index) => ("));
});

// ===========================================================================
// 10. Mobile
// ===========================================================================

test("40. there is no table, and no fixed-width layout, anywhere on the route", () => {
  for (const source of [PAGE, CARD]) {
    for (const token of ["<table", "<thead", "<tbody", "<tr", "<td", "<th ", "table-fixed"]) {
      assert.equal(source.includes(token), false, `${token} was introduced`);
    }
    // No hard pixel width and no forced horizontal scroll.
    assert.equal(/\bw-\[\d+px\]/.test(source), false, "a fixed pixel width was introduced");
    assert.equal(/\bmin-w-\[\d+px\]/.test(source), false, "a fixed minimum width was introduced");
    assert.equal(source.includes("overflow-x"), false, "a horizontal scroller was introduced");
  }
  // Every layout that is not behind a breakpoint prefix stays within two columns,
  // and every wider one is prefixed — so nothing forces a phone into a wide grid.
  for (const source of [PAGE, CARD]) {
    for (const grid of source.match(/(?<![a-z]:)grid-cols-\d+/g) ?? []) {
      const columns = Number(grid.slice("grid-cols-".length));
      assert.ok(columns <= 2, `an unprefixed wide grid exists: ${grid}`);
    }
  }
});

test("41. the card's own fields stack on a phone and widen only with room", () => {
  // RE-POINTED by EX-ADMIN-UX-FIXES: the compacted card reaches a THIRD column on
  // a large screen, still behind a breakpoint prefix and still stacking on a
  // phone, which guard 40 re-checks structurally.
  assert.ok(CARD.includes("grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3"));
  assert.ok(CARD.includes("w-full"), "a card field does not fill its column");
});

// ===========================================================================
// 11. Footprint
// ===========================================================================

/**
 * The EXACT approved footprint of this slice. The `lib/` entries are ASSEMBLED
 * for the reason the header gives — those are the suites whose own caller sweeps
 * this file must stay out of.
 */
const SLICE_PATHS = [
  ROUTE_DIR_PREFIX + "page.tsx",
  ROUTE_DIR_PREFIX + "actions.ts",
  ROUTE_DIR_PREFIX + "EditExamAssignmentCard.tsx",
  ROUTE_DIR_PREFIX + "exam-workspace-view.ts",
  ROUTE_DIR_PREFIX + "exam-workspace-messages.ts",
  ROUTE_DIR_PREFIX + "exam-workspace.contract.test.ts",
  ROUTE_DIR_PREFIX + "exam-plan-create.contract.test.ts",
  ROUTE_DIR_PREFIX + "exam-definitions-page.contract.test.ts",
  ROUTE_DIR_PREFIX + "exam-definition-create.contract.test.ts",
  ROUTE_DIR_PREFIX + "exam-session-create.contract.test.ts",
  ROUTE_DIR_PREFIX + "exam-session-edit-delete.contract.test.ts",
  ROUTE_DIR_PREFIX + "exam-assignment-ui.contract.test.ts",
  ROUTE_DIR_PREFIX + "exam-instructed-trainee-assignment-ui.contract.test.ts",
  ROUTE_DIR_PREFIX + "exam-publication-ui.contract.test.ts",
  ROUTE_DIR_PREFIX + "exam-pairing-ui.contract.test.ts",
  // The TWO new `lib/` PRODUCTION modules and their suites, ASSEMBLED.
  "lib/exam/" + "admin-exam-workspace-edit" + "-core.ts",
  "lib/exam/" + "admin-exam-workspace-edit" + "-core.test.ts",
  // BLOCKER-1 — the canonical wave narrowing and the ONE admin-only export that
  // exposes it. The reader module is the only committed `lib/` production file
  // this slice modifies, and the edit is purely additive.
  "lib/exam/" + "admin-exam-wave-view" + "-core.ts",
  "lib/exam/" + "admin-exam-wave-view" + "-core.test.ts",
  "lib/actions/" + "exam-role" + "-readers" + ".ts",
  // EX-ADMIN-SRCDATE ADDED two `lib/` production modules and MODIFIED no
  // committed one: the pure source-date decision core, and its server-only
  // binding. They are the ONE way a plan can gain a Teaching-Practice date, and
  // without them every plan held an empty selection and beginner exams could not
  // appear on any screen. ASSEMBLED, for the reason this file's header records.
  "lib/exam/" + "admin-exam-source-date" + "-core.ts",
  "lib/actions/" + "admin-exam-source-date" + "-io.ts",
  "lib/actions/" + "admin-exam-workspace-edit" + "-io.ts",
  "lib/actions/" + "admin-exam-workspace-edit" + "-io.test.ts",
  // The committed guard suites this slice re-points. Every entry ends in
  // `.test.ts`, which the assertion below re-checks.
  "lib/exam/" + "admin-exam-assignment-read" + "-core.test.ts",
  "lib/actions/" + "exam-assignment-read" + "-io.test.ts",
  "lib/actions/" + "exam-assignment-write" + "-io.test.ts",
  "lib/actions/" + "exam-pairing-write" + "-io.test.ts",
  "lib/actions/" + "exam-publication-write" + "-io.test.ts",
  "lib/actions/" + "admin-exam-session-read" + "-io.test.ts",
  "lib/actions/" + "exam-definition-read" + "-io.test.ts",
  "lib/actions/" + "exam-instructed-trainee-assignment-write" + "-io.test.ts",
  "lib/actions/" + "exam-plan-write" + "-io.test.ts",
  "lib/actions/" + "exam-session-write" + "-io.test.ts",
  "lib/actions/" + "detailed-exam-assignment-write" + "-io.test.ts",
  "lib/actions/" + "exam-supervisor-read" + "-io.test.ts",
  "lib/actions/" + "exam-supervisor-write" + "-io.test.ts",
  "lib/exam/" + "exam-supervisor-write" + "-core.test.ts",
  "lib/exam/" + "create-exam-plan" + "-core.test.ts",
  // Every committed `lib/` guard suite EX-ADMIN-WORKSPACE-UX re-points, so the
  // footprint here matches the working tree in full. All ASSEMBLED, for the
  // reason this suite's header records.
  "lib/exam/" + "exam-read" + ".contract.test.ts",
  // BLOCKER-1 also re-points the READ-PIPELINE guard suites whose claims the one
  // admin-only export makes obsolete. ASSEMBLED.
  "lib/exam/" + "exam-read" + "-dto.test.ts",
  "lib/exam/" + "exam-read-scope" + "-core.test.ts",
  // EX-ADMIN-SRCDATE — the TWO new `lib/` modules and their suites. ASSEMBLED,
  // for the reason this suite's header records.
  "lib/exam/" + "admin-exam-source-date" + "-core.test.ts",
  "lib/actions/" + "admin-exam-source-date" + "-io.test.ts",

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
  "app/student/trainee-teaching-practice-home-shortcut" + ".contract.test.ts",
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

/** The route's EXACT final file set, after this slice's FOUR additions. */
const FINAL_ROUTE_FILES = [
  ROUTE_DIR_PREFIX + "CreateExamAssignmentForm.tsx",
  ROUTE_DIR_PREFIX + "CreateExamInstructedTraineeAssignmentForm.tsx",
  ROUTE_DIR_PREFIX + "DeleteExamAssignmentForm.tsx",
  ROUTE_DIR_PREFIX + "EditExamAssignmentCard.tsx",
  ROUTE_DIR_PREFIX + "ExamDefinitionCreateForm.tsx",
  ROUTE_DIR_PREFIX + "ExamPlanCreateForm.tsx",
  ROUTE_DIR_PREFIX + "ExamSessionCreateForm.tsx",
  ROUTE_DIR_PREFIX + "ExamSessionDeleteForm.tsx",
  ROUTE_DIR_PREFIX + "ExamSessionEditForm.tsx",
  ROUTE_DIR_PREFIX + "actions.ts",
  ROUTE_DIR_PREFIX + "exam-assignment-messages.ts",
  ROUTE_DIR_PREFIX + "exam-assignment-ui.contract.test.ts",
  ROUTE_DIR_PREFIX + "exam-definition-create-error-messages.ts",
  ROUTE_DIR_PREFIX + "exam-definition-create.contract.test.ts",
  ROUTE_DIR_PREFIX + "exam-definitions-page.contract.test.ts",
  ROUTE_DIR_PREFIX + "exam-instructed-trainee-assignment-messages.ts",
  ROUTE_DIR_PREFIX + "exam-instructed-trainee-assignment-ui.contract.test.ts",
  ROUTE_DIR_PREFIX + "exam-pairing-ui.contract.test.ts",
  ROUTE_DIR_PREFIX + "exam-plan-create.contract.test.ts",
  ROUTE_DIR_PREFIX + "exam-publication-ui.contract.test.ts",
  ROUTE_DIR_PREFIX + "exam-session-create-error-messages.ts",
  ROUTE_DIR_PREFIX + "exam-session-create.contract.test.ts",
  ROUTE_DIR_PREFIX + "exam-session-edit-delete.contract.test.ts",
  ROUTE_DIR_PREFIX + "exam-workspace-messages.ts",
  ROUTE_DIR_PREFIX + "exam-workspace-view.ts",
  ROUTE_DIR_PREFIX + "exam-workspace.contract.test.ts",
  ROUTE_DIR_PREFIX + "page.tsx",
];

test("42. the route directory holds EXACTLY the twenty-seven approved files", () => {
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

test("43. the action module exports EXACTLY THIRTEEN actions, this slice's appended last", () => {
  const firstStatement = ACTIONS_RAW.split("\n").find((line) => line.trim().length > 0);
  assert.equal(firstStatement?.trim(), '"use server";');
  const exported = [...ACTIONS_RAW.matchAll(/export (?:async )?function (\w+)\(/g)].map(
    ([, name]) => name,
  );
  // RE-POINTED by EX-ADMIN-SRCDATE, and by exactly ONE endpoint. Nothing in the
  // product could write the plan's Teaching-Practice date selection, so every
  // plan held an empty one and beginner exams could not appear on any screen.
  // The twelve existing endpoints are unchanged, in the same order.
  assert.equal(exported.length, 13, "no fourteenth endpoint may exist in this module");
  assert.equal(exported[10], "updateExamAssignmentDetailsAction");
  assert.equal(exported[11], "moveExamAssignmentAction");
  assert.equal(exported[12], "replaceExamSourceDatesAction");
  for (const token of ["export const", "export default", "export {", "export type"]) {
    assert.equal(ACTIONS_RAW.includes(token), false, `the module has an ${token} export`);
  }
});

test("44. the slice touched EXACTLY its approved paths, and no schema or migration", () => {
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
  const touched = [
    ...new Set([
      ...gitLines(["diff", "--name-only", "HEAD"]),
      ...gitLines(["ls-files", "--others", "--exclude-standard"]),
    ]),
  ];
  const unexpected = touched.filter((path) => !SLICE_PATHS.includes(path)).sort();
  assert.deepEqual(unexpected, [], `unapproved paths were touched: ${unexpected.join(", ")}`);

  // Every `lib/` entry that is NOT one of this slice's four own files is a guard
  // suite, and the structural check is that it ends in `.test.ts`.
  const ownLib = [
    "lib/exam/" + "admin-exam-workspace-edit" + "-core.ts",
    "lib/actions/" + "admin-exam-workspace-edit" + "-io.ts",
    "lib/exam/" + "admin-exam-wave-view" + "-core.ts",
    "lib/actions/" + "exam-role" + "-readers" + ".ts",
    // EX-ADMIN-SRCDATE ADDED two `lib/` production modules and MODIFIED no
    // committed one: the pure source-date decision core, and its server-only
    // binding. They are the ONE way a plan can gain a Teaching-Practice date, and
    // without them every plan held an empty selection and beginner exams could not
    // appear on any screen. ASSEMBLED, for the reason this file's header records.
    "lib/exam/" + "admin-exam-source-date" + "-core.ts",
    "lib/actions/" + "admin-exam-source-date" + "-io.ts",
    // EX-ADMIN-SRCDATE's own two production modules.
    "lib/exam/" + "admin-exam-source-date" + "-core.ts",
    "lib/actions/" + "admin-exam-source-date" + "-io.ts",

    // EX-ASG-MULTIPLICITY + EX-PAIR-NO-SELF - the branch's production edits, named EXACTLY. No directory, no
    // prefix, no glob: an unrelated production file still fails here.
    "lib/actions/detailed-exam-assignment-write" + "-io.ts",
    "lib/actions/exam-assignment-write" + "-io.ts",
    "lib/actions/exam-instructed-trainee-assignment-write" + "-io.ts",
    "lib/actions/exam-pairing-write" + "-io.ts",
    "lib/exam/admin-exam-examinee-pairing" + "-core.ts",
    "lib/exam/create-exam-instructed-trainee-assignment" + "-core.ts",
    "lib/exam/exam-conflict" + "-core.ts",
    "lib/exam/exam-pairing-write" + "-core.ts",
  ];
  const libEntries = SLICE_PATHS.filter(
    (path) => path.startsWith("lib/") && !ownLib.includes(path),
  );
  for (const path of libEntries) {
    assert.ok(path.endsWith(".test.ts"), `${path} is a lib production file`);
  }
  for (const path of SLICE_PATHS) {
    assert.ok(
      existsSync(join(REPO_ROOT, ...path.split("/"))),
      `${path} is listed but does not exist`,
    );
  }
  assert.ok(sep.length > 0);
});

test("45. the two new lib modules are the ONLY backend this slice added", () => {
  const io = stripComments(
    readFileSync(
      join(REPO_ROOT, "lib", "actions", "admin-exam-workspace-edit" + "-io.ts"),
      "utf8",
    ),
  );
  // It is server-only, and it is NOT a Server Action module.
  assert.ok(new RegExp('import\\s+"server' + '-only";').test(io.split("\n").find((l) => l.trim())!));
  assert.equal(io.includes('"use ' + 'server"'), false);
  // It writes ONE model and gates on the WRITE operation.
  assert.ok(io.includes("SCHEDULE_DRAFT_CONFIGURATION"));
  assert.equal(io.includes("HISTORICAL_READ"), false);
  for (const token of ["examSession.update", "examPlan.update", "student.update", "$queryRaw"]) {
    assert.equal(io.includes(token), false, `the binding reaches ${token}`);
  }
  // The route reaches it through the two Server Actions and nothing else.
  assert.ok(ACTIONS.includes("updateExamAssignmentDetails("));
  assert.ok(ACTIONS.includes("moveExamAssignment("));
  assert.equal(PAGE.includes("admin-exam-workspace-edit" + "-io"), false);
});

// ===========================================================================
// 12. EX-ADMIN-UX-FIXES — the corrections from the first manual E2E review
// ===========================================================================

/** One schedulable session fixture. */
function session(sessionId: string, definitionId: string, startTime: string) {
  return { sessionId, definitionId, definitionName: `def-${definitionId}`, startTime };
}

/** One beginner row fixture, narrowed to the fields the arrangements read. */
function beginner(sessionId: string, date: string, startTime: string) {
  return {
    sessionId,
    date,
    startTime,
    displayEndTime: null,
    beginnerFormat: "BEGINNER_INSTRUCTION",
    groupName: null,
    location: "arena",
    responsibleInstructorName: null,
    participantNames: [] as readonly string[],
    participantCount: 0,
    children: [],
    notes: null,
    isPublished: true,
  } as WorkspaceBeginnerRow;
}

test("47. the ONE ordering rule is date, then start time, then arrival — never a name", () => {
  const timeline = buildGeneralTimeline([
    {
      dateKey: "2026-08-02",
      dayLabel: "d2",
      dateLabel: "l2",
      sessions: [session("late", "d1", "14:00"), session("early", "d1", "08:00")],
    },
    {
      dateKey: "2026-08-01",
      dayLabel: "d1",
      dateLabel: "l1",
      sessions: [session("first", "d2", "10:00")],
    },
  ]);
  const ordered = orderWorkspaceTimeline(timeline);
  assert.deepEqual(ordered.map((entry) => entry.session.sessionId), [
    "first",
    "early",
    "late",
  ]);
  // The sort is STABLE, so two blocks sharing a date AND a clock time keep the
  // committed grouping's own sequence rather than being re-ordered by name.
  const tied = orderWorkspaceTimeline(
    buildGeneralTimeline([
      {
        dateKey: "2026-08-01",
        dayLabel: "d",
        dateLabel: "l",
        sessions: [session("zzz", "d1", "09:00"), session("aaa", "d2", "09:00")],
      },
    ]),
  );
  assert.deepEqual(tied.map((entry) => entry.session.sessionId), ["zzz", "aaa"]);
  // The input is never mutated.
  assert.deepEqual(timeline.map((entry) => entry.session.sessionId), [
    "late",
    "early",
    "first",
  ]);
});

test("48. the by-date axis comes from the ORDERED timeline, days ascending", () => {
  const ordered = orderWorkspaceTimeline(
    buildGeneralTimeline([
      {
        dateKey: "2026-08-05",
        dayLabel: "d5",
        dateLabel: "l5",
        sessions: [session("b", "d1", "09:00")],
      },
      {
        dateKey: "2026-08-03",
        dayLabel: "d3",
        dateLabel: "l3",
        sessions: [session("a", "d1", "11:00")],
      },
    ]),
  );
  const days = groupTimelineByDate(ordered);
  assert.deepEqual(days.map((day) => day.dateKey), ["2026-08-03", "2026-08-05"]);
  assert.deepEqual(days[0].entries.map((entry) => entry.session.sessionId), ["a"]);
  // Nothing is dropped and no day is empty.
  assert.equal(days.reduce((total, day) => total + day.entries.length, 0), 2);
});

test("49. the general overview MERGES beginner times into ONE chronology", () => {
  const ordered = orderWorkspaceTimeline(
    buildGeneralTimeline([
      {
        dateKey: "2026-08-02",
        dayLabel: "יום ראשון",
        dateLabel: "2 באוגוסט 2026",
        sessions: [session("stored", "d1", "10:00")],
      },
    ]),
  );
  const overview = buildScheduleOverview(
    ordered,
    [beginner("tp-1", "2026-08-02", "09:00"), beginner("tp-2", "2026-08-02", "12:00")],
    collectDayLabels(ordered),
  );
  // Interleaved BY TIME rather than appended after the stored blocks.
  assert.deepEqual(
    overview.map((entry) => [entry.kind, entry.startTime]),
    [
      ["BEGINNER", "09:00"],
      ["SESSION", "10:00"],
      ["BEGINNER", "12:00"],
    ],
  );
  // A beginner row on a day the stored schedule also occupies borrows that day's
  // committed labels — this module derives no calendar of its own.
  const first = overview[0];
  assert.equal(first.dayLabel, "יום ראשון");
  assert.equal(first.dateLabel, "2 באוגוסט 2026");
});

test("50. an overview entry carries NO participant, horse, topic or assignment", () => {
  const ordered = orderWorkspaceTimeline(
    buildGeneralTimeline([
      {
        dateKey: "2026-08-02",
        dayLabel: "d",
        dateLabel: "l",
        sessions: [session("s", "d1", "10:00")],
      },
    ]),
  );
  const overview = buildScheduleOverview(
    ordered,
    [beginner("tp-1", "2026-08-02", "09:00")],
    collectDayLabels(ordered),
  );
  for (const entry of overview) {
    for (const field of [
      "examinees",
      "waves",
      "assignments",
      "traineeName",
      "horseName",
      "instructionTopic",
      "discipline",
      "instructedTraineeName",
      "children",
      "participantNames",
    ]) {
      assert.equal(Object.hasOwn(entry, field), false, `an overview row carries ${field}`);
    }
  }
});

test("51. a beginner row with an unusable date or time is DROPPED, never mis-placed", () => {
  const overview = buildScheduleOverview(
    [],
    [
      { ...beginner("bad-date", "", "09:00") },
      { ...beginner("bad-time", "2026-08-02", "") },
      beginner("good", "2026-08-02", "09:00"),
    ],
    new Map(),
  );
  assert.deepEqual(
    overview.map((entry) => (entry.kind === "BEGINNER" ? entry.beginner.sessionId : "")),
    ["good"],
  );
  // With no stored day to borrow labels from, the raw date key stands in and no
  // calendar is computed here.
  assert.equal(overview[0].dateLabel, "2026-08-02");
  assert.equal(overview[0].dayLabel, "");
});

test("52. the GENERAL VIEW renders structure only — no card, no name, no create form", () => {
  const start = PAGE.indexOf("function renderGeneralSchedule()");
  assert.notEqual(start, -1, "the general view has no renderer of its own");
  const end = PAGE.indexOf("function renderGroupedSchedule()");
  assert.ok(end > start, "the general renderer is not delimited");
  const general = PAGE.slice(start, end);

  // The facts a manager runs a day from ARE there.
  assert.ok(general.includes("<BlockFacts"));
  assert.ok(general.includes("BLOCK_ARENA_LABEL"));
  assert.ok(general.includes("scheduleOverview.map("));

  // ...and nothing that belongs to the roster or to editing is.
  for (const forbidden of [
    "traineeName",
    "horseText",
    "EditExamAssignmentCard",
    "CreateExamAssignmentForm",
    "CreateExamInstructedTraineeAssignmentForm",
    "DeleteExamAssignmentForm",
    "ReadOnlyWave",
    "TEACHES_LABEL",
    "INSTRUCTION_TOPIC_LABEL",
    "DISCIPLINE_LABEL",
    "instructedTrainee",
    "pairing",
    "participantNames",
    "children",
    "<form",
  ]) {
    assert.equal(general.includes(forbidden), false, `the general view renders ${forbidden}`);
  }
});

test("53. the general view CARRIES beginner times, and says where the editing is", () => {
  const start = PAGE.indexOf("function renderGeneralSchedule()");
  const general = PAGE.slice(start, PAGE.indexOf("function renderGroupedSchedule()"));
  assert.ok(general.includes('entry.kind === "SESSION"'));
  assert.ok(general.includes("entry.beginner.beginnerFormat"));
  assert.ok(general.includes("entry.beginner.displayEndTime"));
  assert.ok(general.includes("entry.beginner.location"));
  assert.ok(general.includes("GENERAL_VIEW_READ_ONLY_TEXT"));
  // The beginner rows come from the ONE already-loaded admin reading. No second
  // reader is named anywhere on the page.
  assert.equal(
    (PAGE.match(/readAdminExamPlan\(/g) ?? []).length,
    1,
    "the admin reading is asked more than once",
  );
});

test("54. the two grouped views are SUB-TABS with a safe default, one group at a time", () => {
  // The ordinal parser is closed, total and clamped.
  for (const raw of [undefined, "", "x", "-1", "1.5", "9", "constructor", ["1"], "1e1"]) {
    assert.equal(
      parseWorkspaceGroupIndex(raw as string | string[] | undefined, 3),
      0,
      `${String(raw)} escaped the safe default`,
    );
  }
  assert.equal(parseWorkspaceGroupIndex("2", 3), 2);
  assert.equal(parseWorkspaceGroupIndex("0", 3), 0);
  // A list with nothing in it still has a total answer.
  assert.equal(parseWorkspaceGroupIndex("2", 0), 0);

  // The page renders exactly ONE group, chosen by that ordinal.
  assert.ok(PAGE.includes("parseWorkspaceGroupIndex(query.group, scheduleSubTabs.length)"));
  assert.ok(PAGE.includes("const activeSubTab: ScheduleSubTab | undefined = scheduleSubTabs["));
  assert.ok(PAGE.includes("activeSubTab === undefined ? [] : activeSubTab.entries"));
  // A single group is not given a control to switch between.
  assert.ok(PAGE.includes("if (scheduleSubTabs.length < 2) return null;"));
});

test("55. the sub-tabs cover the exam TYPES in one view and the DATES in the other", () => {
  assert.ok(PAGE.includes("definitionGroups.map((group) => ({"));
  assert.ok(PAGE.includes("timelineDays.map((day) => ({"));
  // The general view has none — it is one continuous chronology by definition.
  assert.ok(PAGE.includes('scheduleView === "general" ? timeline'));
  // Switching arrangement DROPS the ordinal, so position 3 of the types cannot
  // land on position 3 of the dates.
  assert.ok(PAGE.includes("href={`${examsPath}?tab=${activeTab}&view=${token}`}"));
});

test("56. the ADD-ASSIGNMENT form is closed by default and opened from the TOP", () => {
  // The disclosure parser is closed to the exact literal.
  assert.equal(parseAddAssignmentDisclosure("1"), true);
  for (const raw of [undefined, "", "0", "true", "01", " 1", ["1"], "yes"]) {
    assert.equal(
      parseAddAssignmentDisclosure(raw as string | string[] | undefined),
      false,
      `${String(raw)} opened the form`,
    );
  }
  // The create forms render ONLY behind it, and the disclosure never replaces the
  // lifecycle gate.
  assert.ok(PAGE.includes("{addAssignmentOpen && mayConfigure ? ("));
  assert.equal(
    PAGE.includes("{mayConfigure ? (\n                                requirementsUnknown"),
    false,
    "the create form is still rendered unconditionally",
  );
  // The control sits ABOVE the list of blocks, not after it.
  const control = PAGE.indexOf("ADD_ASSIGNMENT_OPEN_TEXT");
  const list = PAGE.indexOf("selectedEntries.map((entry) => {");
  assert.ok(control !== -1 && list !== -1 && control < list, "the control is not at the top");
  assert.ok(PAGE_RAW.includes('ADD_ASSIGNMENT_OPEN_TEXT = "הוספת שיבוץ"'));
  // Opening a form is a NAVIGATION and never a write.
  assert.ok(PAGE.includes("&add=1`"));
});

test("57. the word for a wave is GONE from every visible string", () => {
  // The display-copy correction: the heading is a time range and no noun.
  assert.ok(PAGE.includes("{wave.startTime} {WAVE_TIME_SEPARATOR} {timeText(wave.endTime)}"));
  assert.equal(PAGE_RAW.includes("WAVE_LABEL"), false, "the wave noun still exists");
  // ...and it is not spelled inline anywhere in any route production file either.
  const files = readdirSync(join(REPO_ROOT, ROUTE_DIR_REL)).filter(
    (name) => /\.tsx?$/.test(name) && !name.endsWith(".test.ts"),
  );
  for (const name of files) {
    const source = stripComments(readFileSync(join(REPO_ROOT, ROUTE_DIR_REL, name), "utf8"));
    assert.equal(
      new RegExp('"\\u05d2\\u05dc"|>\\s*\\u05d2\\u05dc\\s*<|\\u05d2\\u05dc\\s*·').test(source),
      false,
      `${name} still renders the wave noun`,
    );
  }
  // The internal model KEEPS its technical name — this was copy, not behaviour.
  assert.ok(VIEW.includes("ExamWave"));
  assert.ok(PAGE.includes("attachExamineesToWaves("));
});

test("58. the instructed-trainee field follows the DEFINITION, not an existing pairing", () => {
  // The gate is the definition's own requirement flag...
  assert.ok(PAGE.includes("requirements !== undefined && requirements.requiresInstructedTrainee"));
  assert.ok(PAGE.includes("const definitionWantsInstructedTrainee = showInstructedTraineeForm;"));
  // ...and the old "any instructed row in this session" inference is GONE.
  assert.equal(
    PAGE.includes("showInstructedTraineeForm || instructedRows.length > 0"),
    false,
    "the field is still inferred from a session's rows",
  );
  // The ONE exception is per PERSON and can never produce an EMPTY field: it is
  // reached only when that examinee already carries a stored link.
  const flat = squash(PAGE);
  assert.ok(
    flat.includes(
      "definitionWantsInstructedTrainee || examinee.instructedTraineeAssignmentId !== null",
    ),
    "the card's field is not gated per person",
  );
  assert.ok(flat.includes("showTeachingLink || examinee.instructedTraineeName !== null"));
  // The read-only summary is gated on the same rule rather than printed always.
  assert.ok(
    flat.includes("definitionWantsInstructedTrainee || examinee.instructedTraineeName !== null"),
    "the read-only summary still prints the field unconditionally",
  );
  // The wave summary takes the same gate as a PROP rather than assuming it.
  assert.ok(flat.includes("showTeachingLink={ requirements !== undefined && requirements.requiresInstructedTrainee }"));
});

test("59. the examinee card is COMPACT, keeps one save and keeps the move controls", () => {
  // One save button, and it is still exactly one.
  assert.equal((CARD.match(/<SaveCardButton/g) ?? []).length, 1);
  assert.equal((CARD.match(/type="submit"/g) ?? []).length, 1);
  // Compact: single-line fields in one responsive grid, no repeated headings.
  assert.ok(CARD.includes("LABEL_CLASS"));
  assert.ok(CARD.includes("grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3"));
  assert.equal(CARD.includes("gap-3 sm:grid-cols-2"), false, "the tall layout survives");
  // Nothing required was hidden to achieve it.
  for (const field of ["horseName", "instructionTopic", "discipline", "instructedTraineeAssignmentId"]) {
    assert.ok(CARD.includes(`name="${field}"`), `${field} was dropped from the card`);
  }
  // The ordering controls are unchanged and still live on the page beside it.
  assert.ok(PAGE.includes("MOVE_UP_LABEL"));
  assert.ok(PAGE.includes("MOVE_DOWN_LABEL"));
  assert.ok(PAGE.includes("POSITION_LABEL"));
  assert.ok(PAGE.includes('value="UP"'));
  assert.ok(PAGE.includes('value="DOWN"'));
});

test("60. beginner rows stay READ-ONLY and are placed by arrangement", () => {
  // Full detail in the two grouped views, times only in the general one.
  assert.ok(PAGE.includes("const beginnerRowsInView: readonly WorkspaceBeginnerRow[] ="));
  assert.ok(PAGE.includes("beginnerRowsOnDate("));
  assert.ok(PAGE.includes("beginnerRowsInView.map((row) => ("));
  // The detail a manager needs to run the day is all still there.
  for (const label of [
    "BEGINNER_GROUP_LABEL",
    "BEGINNER_RESPONSIBLE_LABEL",
    "BEGINNER_PARTICIPANTS_LABEL",
    "BEGINNER_AGE_LABEL",
    "BEGINNER_PARENT_LABEL",
    "BEGINNER_PARENT_PHONE_LABEL",
    "BEGINNER_ABSENT_TEXT",
    "BEGINNER_DRAFT_TEXT",
  ]) {
    assert.ok(PAGE.includes(label), `${label} was dropped`);
  }
  // NO edit control of any kind is rendered for a beginner row, and the rule is
  // stated on screen.
  const start = PAGE.indexOf("aria-label={BEGINNER_REGION_HEADING}");
  const region = PAGE.slice(start, PAGE.indexOf("</section>", start));
  for (const forbidden of ["<form", "<button", "<input", "<select", "action={"]) {
    assert.equal(region.includes(forbidden), false, `a beginner row offers ${forbidden}`);
  }
  // The rule is stated in WORDS, and the sentence is the read-only one's own. The
  // region's old "these will be shown here read-only" placeholder is GONE,
  // replaced by the three distinguishable states guard 61 pins — one sentence
  // could not tell a level with no beginner exams apart from a plan that has
  // selected no days. The rule sentence is rendered TWICE: beside the rows, and
  // beside the source-date control that decides which rows exist at all.
  assert.ok(PAGE.includes("BEGINNER_READ_ONLY_TEXT"));
  assert.equal((PAGE.match(/BEGINNER_READ_ONLY_TEXT/g) ?? []).length, 3);
  assert.ok(PAGE_RAW.includes("כל שינוי נעשה במסך התרגול המעשי"));
});

test("61. the THREE beginner empty states are distinguishable", () => {
  assert.ok(PAGE.includes("!beginnerSupported ?"));
  assert.ok(PAGE.includes("!hasSourceDates ?"));
  assert.ok(PAGE.includes("orderedBeginnerRows.length === 0 ?"));
  for (const text of [
    "BEGINNER_LEVEL_UNSUPPORTED_TEXT",
    "BEGINNER_NO_SOURCE_DATES_TEXT",
    "BEGINNER_NO_MATCHING_LESSONS_TEXT",
  ]) {
    assert.ok(PAGE.includes(text), `${text} is missing`);
  }
  // The three sentences are DIFFERENT sentences.
  const found = [
    /BEGINNER_LEVEL_UNSUPPORTED_TEXT =\s*\n?\s*"([^"]+)"/,
    /BEGINNER_NO_SOURCE_DATES_TEXT =\s*\n?\s*"([^"]+)"/,
    /BEGINNER_NO_MATCHING_LESSONS_TEXT =\s*\n?\s*"([^"]+)"/,
  ].map((pattern) => (PAGE_RAW.match(pattern) ?? [])[1] ?? "");
  assert.equal(found.includes(""), false, "an empty state has no sentence");
  assert.equal(new Set(found).size, 3, "two empty states say the same thing");
  // The level question is DELEGATED, never restated on the page.
  assert.ok(PAGE.includes("examBeginnerDatesSupportedForLevel(context.level)"));
  assert.equal(/context\.level\s*===\s*1/.test(PAGE), false, "the level rule is restated");
});

test("62. the source-date control is the ONE way a plan gains beginner dates", () => {
  // It lives in the schedule section, behind the lifecycle gate and the level.
  assert.ok(PAGE.includes("{beginnerSupported ? ("));
  assert.ok(PAGE.includes("action={boundReplaceExamSourceDatesAction}"));
  assert.ok(PAGE.includes("replaceExamSourceDatesAction.bind(null, context.id)"));
  // The submission is the COMPLETE set: every selected day shares ONE field name
  // with the add field, so unchecking a day removes it.
  assert.equal((PAGE.match(/name="date"/g) ?? []).length, 2);
  assert.ok(PAGE.includes('type="checkbox"'));
  assert.ok(PAGE.includes('type="date"'));
  assert.ok(PAGE.includes("defaultChecked"));
  assert.ok(PAGE.includes("selectedSourceDates.map((selected) => ("));
  // The offering id travels in the SERVER-side binding and is never a field.
  assert.equal(PAGE.includes('name="courseOfferingId"'), false);
  assert.equal(PAGE.includes('name="planId"'), false);
  // No Teaching-Practice identifier is expressible from this surface at all.
  for (const forbidden of ['name="lessonId"', 'name="practiceId"', 'name="childId"']) {
    assert.equal(PAGE.includes(forbidden), false, `the control submits ${forbidden}`);
  }
});

test("63. the source-date action is bound to the committed writer and echoes nothing", () => {
  assert.ok(ACTIONS.includes('formData.getAll("date")'));
  assert.ok(ACTIONS.includes("replaceExamSourceDates(courseOfferingId, formData.getAll"));
  // The raw entries are NOT coerced — the backend validates every token.
  assert.equal(ACTIONS.includes('String(formData.getAll("date"))'), false);
  // Success revalidates only on a real write; a no-op revalidates nothing.
  assert.ok(ACTIONS.includes('if (result.outcome !== "NO_CHANGE")'));
  // The refusal carries CODES only, and the page selects a fixed sentence per
  // code — so no submitted date can be echoed onto the screen.
  assert.ok(ACTIONS.includes("result.issues.map((issue) => issue.code).join"));
  assert.ok(PAGE.includes("examSourceDatesFeedback(sourceDates)"));
  assert.ok(PAGE.includes("examSourceDatesIssueTexts(sourceDateIssues)"));
  const unknown = examSourceDatesIssueTexts("NOT-A-CODE,EX-SRC-DATE-INVALID");
  assert.equal(unknown.length, 1, "an unknown diagnostic code reached the screen");
  assert.equal(examSourceDatesFeedback(["REPLACED"] as unknown as string), null);
  assert.equal(examSourceDatesFeedback("REPLACED")?.tone, "success");
  assert.equal(examSourceDatesFeedback("NO_CHANGE")?.tone, "neutral");
  assert.equal(examSourceDatesFeedback("whatever-code")?.tone, "error");
});

test("64. the publication section is untouched by this slice", () => {
  assert.ok(PAGE.includes('activeTab === "publication"'));
  assert.ok(PAGE.includes("PUBLISH_BUTTON_TEXT"));
  assert.ok(PAGE.includes("UNPUBLISH_BUTTON_TEXT"));
  assert.ok(PAGE.includes("PUBLISHED_WARNING_TEXT"));
  assert.ok(PAGE.includes('value="PUBLISH"'));
  assert.ok(PAGE.includes('value="UNPUBLISH"'));
  assert.ok(PAGE.includes("boundSetExamPlanPublicationAction"));
  // The two forms are still chosen by the STORED state and never by the query.
  assert.ok(PAGE.includes("const isPublished = view.publishedAt !== null;"));
  // The disclosure and the sub-tab ordinal reach nothing in this section.
  const start = PAGE.indexOf('activeTab === "publication"');
  const publication = PAGE.slice(start);
  for (const forbidden of ["addAssignmentOpen", "activeSubTab", "sourceDates"]) {
    assert.equal(publication.includes(forbidden), false, `publication reads ${forbidden}`);
  }
});

test("65. no instructor or trainee file is touched, and no new PII is reachable", () => {
  // EX-ASG-MULTIPLICITY + EX-PAIR-NO-SELF - the ONE app/student entry is a GUARD SUITE whose admin-footprint
  // snapshot this branch re-points; it is NOT a trainee file and adds no PII.
  // Named EXACTLY, and nothing may be ADDED under any of these trees.
  const APPROVED_TREE_MODIFICATIONS: Record<string, readonly string[]> = {
    "app/student": ["app/student/trainee-teaching-practice-home-shortcut" + ".contract.test.ts"],
  };
  for (const dir of ["app/instructor", "app/student", "components"]) {
    assert.deepEqual(
      branchModified(dir),
      APPROVED_TREE_MODIFICATIONS[dir] ?? [],
      `${dir} was modified`,
    );
    assert.deepEqual(branchAdded(dir), [], `${dir} gained a file`);
  }
  // The source-date surface adds NO personal field anywhere: it can express a
  // date and nothing else. The Server Action module is the boundary that matters
  // — the view module's beginner ROW TYPE legitimately names the parent contact
  // the committed operational reader already publishes, which guard 38 pins.
  for (const token of ["identityNumber", "phone", "Phone", "parent", "Parent", "child", "Child"]) {
    assert.equal(ACTIONS.includes(token), false, `${token} became reachable`);
  }
  // And no beginner field reached a WRITE surface.
  for (const token of ["beginnerFormat", "participantNames", "childNotes", "equipmentNotes"]) {
    assert.equal(ACTIONS.includes(token), false, `${token} reaches a write surface`);
  }
});

test("66. this suite opens no database and reads no environment", () => {
  const own = stripComments(routeFile("exam-workspace.contract.test.ts"));
  for (const token of ["@/lib/" + "prisma", "Prisma" + "Client", "DATABASE" + "_URL"]) {
    assert.equal(own.includes(token), false, `the suite references ${token}`);
  }
});

// ===========================================================================
// 67–68. A card save redirects back into the EXACT arrangement it was
// submitted from, never always the general view
// ===========================================================================

const UPDATE_DETAILS_ACTION = ACTIONS.slice(
  ACTIONS.indexOf("export async function updateExamAssignmentDetailsAction"),
  ACTIONS.indexOf("export async function moveExamAssignmentAction"),
);

test("67. saving from the TYPE view redirects back into the exact TYPE sub-tab", () => {
  // The card save is bound with `groupQuery` — the current tab/view/ordinal
  // tail, computed once the TYPE view's own sub-tabs are known — not just the
  // verified offering id.
  assert.ok(
    squash(PAGE).includes(
      "updateExamAssignmentDetailsAction.bind(null, context.id, groupQuery)",
    ),
    "the card save is not bound with the current tab/view/sub-tab",
  );
  // The TYPE view's sub-tabs are ExamDefinition GROUPS, and `groupQuery` carries
  // their ordinal POSITION — never an ExamDefinition id — exactly like every
  // other in-view link on this route.
  assert.ok(
    squash(PAGE).includes('scheduleView === "type" ? definitionGroups.map((group) => ({'),
    "the TYPE view's sub-tabs are no longer derived from definitionGroups",
  );
  assert.ok(
    PAGE.includes(
      'const groupQuery = scheduleView === "general" ? viewQuery : `${viewQuery}&group=${activeSubTabIndex}`;',
    ),
    "groupQuery no longer carries the open sub-tab's ordinal for a non-general view",
  );
  // The action forwards `groupQuery` straight into its redirect target instead
  // of a hardcoded `tab=assignments`, which is what silently reset the manager
  // to the general view regardless of which sub-tab they saved from.
  assert.ok(
    UPDATE_DETAILS_ACTION.includes("const backPath = `${examsPath}?${groupQuery}`;"),
    "the action no longer builds its redirect target from groupQuery",
  );
  assert.equal(
    UPDATE_DETAILS_ACTION.includes("tab=assignments"),
    false,
    "the action still hardcodes the section token instead of forwarding the current view",
  );
  assert.equal(
    (UPDATE_DETAILS_ACTION.match(/export async function updateExamAssignmentDetailsAction\(/g) ?? [])
      .length,
    1,
  );
  assert.ok(
    /export async function updateExamAssignmentDetailsAction\(\s*courseOfferingId: string,\s*groupQuery: string,\s*formData: FormData,\s*\): Promise<void> \{/.test(
      ACTIONS,
    ),
    "the action no longer accepts the bound groupQuery as its second parameter",
  );
});

test("68. saving from the DATE view redirects back into the exact DATE sub-tab", () => {
  // Same binding, same forwarding — proven again against the DATE arrangement,
  // whose sub-tabs are a DIFFERENT grouping (by day) sharing the SAME `group`
  // ordinal convention.
  assert.ok(
    squash(PAGE).includes(
      "updateExamAssignmentDetailsAction.bind(null, context.id, groupQuery)",
    ),
    "the card save is not bound with the current tab/view/sub-tab",
  );
  assert.ok(
    squash(PAGE).includes('scheduleView === "date" ? timelineDays.map((day) => ({'),
    "the DATE view's sub-tabs are no longer derived from timelineDays",
  );
  assert.ok(
    PAGE.includes(
      'const groupQuery = scheduleView === "general" ? viewQuery : `${viewQuery}&group=${activeSubTabIndex}`;',
    ),
    "groupQuery no longer carries the open sub-tab's ordinal for a non-general view",
  );
  assert.ok(
    UPDATE_DETAILS_ACTION.includes("const backPath = `${examsPath}?${groupQuery}`;"),
    "the action no longer builds its redirect target from groupQuery",
  );
  // A date sub-tab is keyed by its OWN date string for React, never posted as a
  // saved value — the redirect carries only the closed `view`/`group` tail.
  assert.equal(
    UPDATE_DETAILS_ACTION.includes("dateKey"),
    false,
    "the action reaches into the date grouping instead of forwarding the closed groupQuery tail",
  );
});
