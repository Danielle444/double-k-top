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
  type WorkspaceExaminee,
} from "./exam-workspace-view";
import {
  examAssignmentEditFeedback,
  examAssignmentEditIssueTexts,
  examAssignmentOrderFeedback,
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
        { sessionId: "s1", definitionId: "d1", definitionName: "A" },
        { sessionId: "s2", definitionId: "d2", definitionName: "B" },
      ],
    },
    {
      dateKey: "2026-07-01",
      dayLabel: "רביעי",
      dateLabel: "01.07",
      sessions: [{ sessionId: "s3", definitionId: "d1", definitionName: "A" }],
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
        { sessionId: "s1", definitionId: "d1", definitionName: "A" },
        { sessionId: "s2", definitionId: "d2", definitionName: "A" },
        { sessionId: "s3", definitionId: "d1", definitionName: "A" },
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
  // Both schedule-bearing sections render from the SAME sections list, so they
  // cannot disagree about what exists or about sequence.
  assert.equal(
    (PAGE.match(/scheduleSections\.map\(/g) ?? []).length,
    2,
    "the two sections do not share one arrangement",
  );
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
  assert.equal(
    (PAGE.match(/<BlockFacts/g) ?? []).length,
    2,
    "the block facts are not rendered by one shared component in both sections",
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
  assert.equal(
    (PAGE.match(/\{WAVE_LABEL\}/g) ?? []).length,
    2,
    "the wave moment is printed somewhere other than the two wave headings",
  );
  assert.equal(
    (PAGE.match(/· \{wave\.startTime\}/g) ?? []).length,
    2,
    "the wave start is printed somewhere else, or assembled",
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
  assert.equal(CARD_RAW.includes('SAVE_TEXT = "שמירת הכרטיס"'), true);
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
  // It reuses the COMMITTED pairing writer rather than reimplementing the rules.
  // ASSEMBLED, for the reason the header records: the committed pairing guard
  // sweeps raw source for this call shape and pins its caller list to the route's
  // Server Action module alone.
  assert.ok(action.includes("set" + "ExamInstructedTraineePairing" + "("));
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
    action.split("set" + "ExamInstructedTraineePairing" + "(").length - 1,
    1,
    "the card save calls the pairing writer more than once",
  );
  // ...and it is awaited once, not in a loop or a chain.
  assert.equal(
    (action.match(new RegExp("await set" + "ExamInstructedTraineePairing", "g")) ?? []).length,
    1,
    "the pairing writer is awaited more than once",
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
  assert.ok(action.includes("const isClearing = next === EXAM_PAIRING_NONE_VALUE;"));
  assert.ok(action.includes("const instructedTraineeAssignmentId = isClearing ? previous : next;"));
  assert.ok(action.includes("? null"), "clearing must pass null as the partner");
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
    "set" + "ExamInstructedTraineePairing" + "(courseOfferingId, previous, null)",
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
    "isPublished ? null",
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
      "beginnerChild",
      "ExamBeginnerChild",
      "parentPhone",
      "guardian",
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
  const changed = [
    ...gitLines(["status", "--porcelain", "--", "app/instructor"]),
    ...gitLines(["status", "--porcelain", "--", "app/student"]),
    ...gitLines(["status", "--porcelain", "--", "components"]),
    ...gitLines(["status", "--porcelain", "--", "prisma"]),
  ];
  assert.deepEqual(changed, [], "an instructor, trainee, component or schema file changed");
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
  const modified = gitLines(["diff", "--name-only", "HEAD", "--", "lib"]).sort();
  const production = modified.filter(
    (path) => !path.endsWith(".test.ts") && path !== APPROVED_LIB_PRODUCTION_EDIT,
  );
  assert.deepEqual(
    production,
    [],
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
  assert.deepEqual(gitLines(["diff", "--name-only", "HEAD", "--", "lib/exam/exam-read-dto.ts"]), []);
  assert.deepEqual(
    gitLines(["diff", "--name-only", "HEAD", "--", "lib/exam/exam-read-scope-core.ts"]),
    [],
  );
  // ...and the only untracked `lib/` files are this slice's own two modules and
  // their two suites.
  const added = gitLines(["ls-files", "--others", "--exclude-standard"])
    .filter((path) => path.startsWith("lib/"))
    .sort();
  assert.deepEqual(added, [
    "lib/actions/" + "admin-exam-workspace-edit" + "-io.test.ts",
    "lib/actions/" + "admin-exam-workspace-edit" + "-io.ts",
    "lib/exam/" + "admin-exam-workspace-edit" + "-core.test.ts",
    "lib/exam/" + "admin-exam-workspace-edit" + "-core.ts",
    "lib/exam/" + "admin-exam-wave-view" + "-core.test.ts",
    "lib/exam/" + "admin-exam-wave-view" + "-core.ts",
  ].sort());
});

test("38. no identity number, phone, contact, group or enrolment detail is rendered", () => {
  // The VIEW module is swept separately below: it DECLARES the beginner row shape
  // the follow-up will render, and that shape names a lesson's group. Naming a
  // field in a type is not rendering it — this branch renders NO beginner row at
  // all, which test 34 pins from the other side.
  for (const source of [PAGE, ACTIONS, CARD]) {
    for (const token of [
      "identityNumber",
      "idNumber",
      "phone",
      "email",
      "address",
      "subgroup",
      "groupName",
      "enrollment",
      "Enrollment",
      "isPrimary",
    ]) {
      assert.equal(source.includes(token), false, `${token} is reachable`);
    }
  }
  // The view module holds the beginner ROW TYPE and nothing else about a person:
  // no child, no participant name, no contact, no identity number and no phone.
  for (const token of [
    "identityNumber",
    "idNumber",
    "phone",
    "email",
    "address",
    "subgroup",
    "enrollment",
    "Enrollment",
    "isPrimary",
    "children",
    "participantNames",
    "parent",
    "guardian",
  ]) {
    assert.equal(VIEW.includes(token), false, `${token} is reachable`);
  }
  // ...and the one field that does name a group is a LESSON's group, declared on
  // a type this branch renders nothing from.
  assert.ok(VIEW.includes("readonly groupName: string | null;"));
  assert.equal(PAGE.includes("groupName"), false, "a group reaches the page");
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
  const hrefs = (PAGE.match(/href=\{.*$/gm) ?? []).map((line) => line.trim());
  assert.deepEqual(hrefs.sort(), [
    "href={`${examsPath}?tab=${activeTab}&view=${token}`}",
    "href={`${examsPath}?tab=${token}`}",
    "href={dashboardHref}",
  ]);
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
  assert.ok(CARD.includes("grid-cols-1 gap-3 sm:grid-cols-2"));
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
  "lib/exam/" + "create-exam-plan" + "-core.test.ts",
  "lib/exam/" + "exam-read" + ".contract.test.ts",
  "lib/exam/" + "exam-supervisor-write" + "-core.test.ts",
  // BLOCKER-1 also re-points the READ-PIPELINE guard suites whose claims the one
  // admin-only export makes obsolete. ASSEMBLED.
  "lib/exam/" + "exam-read" + "-dto.test.ts",
  "lib/exam/" + "exam-read-scope" + "-core.test.ts",
  "lib/exam/" + "exam-read" + ".contract.test.ts",
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

test("43. the action module exports EXACTLY TWELVE actions, this slice's appended last", () => {
  const firstStatement = ACTIONS_RAW.split("\n").find((line) => line.trim().length > 0);
  assert.equal(firstStatement?.trim(), '"use server";');
  const exported = [...ACTIONS_RAW.matchAll(/export (?:async )?function (\w+)\(/g)].map(
    ([, name]) => name,
  );
  assert.equal(exported.length, 12, "no thirteenth endpoint may exist in this module");
  assert.equal(exported[10], "updateExamAssignmentDetailsAction");
  assert.equal(exported[11], "moveExamAssignmentAction");
  for (const token of ["export const", "export default", "export {", "export type"]) {
    assert.equal(ACTIONS_RAW.includes(token), false, `the module has an ${token} export`);
  }
});

test("44. the slice touched EXACTLY its approved paths, and no schema or migration", () => {
  assert.deepEqual(gitLines(["status", "--porcelain", "--", "prisma"]), []);
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

test("46. this suite opens no database and reads no environment", () => {
  const own = stripComments(routeFile("exam-workspace.contract.test.ts"));
  for (const token of ["@/lib/" + "prisma", "Prisma" + "Client", "DATABASE" + "_URL"]) {
    assert.equal(own.includes(token), false, `the suite references ${token}`);
  }
});
