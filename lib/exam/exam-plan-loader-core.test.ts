/**
 * EXAM EX-S5A-3 — tests for the PURE exam-plan loader core.
 *
 * DB-FREE: every case injects plain in-memory dependency functions. This suite
 * opens no database connection, executes no SQL, reads no session and
 * constructs no `Date`. The only files it reads from disk are the loader's own
 * SOURCE and the IO shell's source, for the structural guards at the end.
 *
 * The forbidden identifiers those guards search for are assembled from SPLIT
 * LITERALS on purpose: `exam-no-feedback-guard.test.ts` scans every file in
 * `lib/exam` for those exact tokens, so spelling one out here would make this
 * suite trip that guard.
 *
 * Run with: npx tsx --test lib/exam/exam-plan-loader-core.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";

import type {
  ExamPlanIdentityRow,
  ExamPlanLoadDeps,
  ExamPlanLoadOptions,
  ExamPlanPayload,
  ExamPlanSourceDateRow,
} from "./exam-plan-loader-core";
import { emptyExamPlanPayload, loadExamPlan } from "./exam-plan-loader-core";
import type {
  StoredExamDefinitionRow,
  StoredExamSessionRow,
} from "./exam-stored-adapter-core";
import { composeStoredExamBlocks } from "./exam-stored-adapter-core";
import type { TeachingPracticeExamLessonRow } from "./exam-tp-source-adapter-core";
import { buildLiveBeginnerSessionId } from "./exam-live-beginner-adapter-core";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const LOADER_SOURCE_PATH = join(REPO_ROOT, "lib", "exam", "exam-plan-loader-core.ts");
const IO_SOURCE_PATH = join(REPO_ROOT, "lib", "actions", "exam-read-io.ts");
const TEST_SOURCE_PATH = join(REPO_ROOT, "lib", "exam", "exam-plan-loader-core.test.ts");

// ===========================================================================
// Fixtures
// ===========================================================================

function definition(
  over: Partial<StoredExamDefinitionRow> = {},
): StoredExamDefinitionRow {
  return {
    id: "d1",
    name: "רכיבה",
    kind: "INTERFACE_RIDING",
    durationMinutes: 10,
    parallelCapacity: 2,
    requiresInstructedTrainee: false,
    requiresLessonTopic: false,
    requiresDiscipline: false,
    orderIndex: 0,
    ...over,
  };
}

function session(over: Partial<StoredExamSessionRow> = {}): StoredExamSessionRow {
  return {
    id: "s1",
    definitionId: "d1",
    date: "2026-08-10",
    startTime: "09:00",
    endTime: "10:00",
    orderIndex: 0,
    arena: "מגרש 1",
    title: null,
    notes: null,
    individualPublishedAt: null,
    updatedAt: 1,
    assignments: [
      {
        id: "a1",
        studentId: "st1",
        role: "EXAMINEE",
        orderIndex: 0,
        horseName: "סוסון",
        instructionTopic: null,
        discipline: null,
        pairingIndex: null,
        notes: null,
      },
    ],
    breaks: [],
    supervisorInstructorIds: ["i1"],
    ...over,
  };
}

function lesson(over: Partial<TeachingPracticeExamLessonRow> = {}): TeachingPracticeExamLessonRow {
  return {
    id: "l1",
    practiceType: "LUNGE",
    date: "2026-08-11",
    startTime: "09:00",
    endTime: "10:00",
    createdAt: "2026-07-01T07:00:00.000Z",
    groupName: "א",
    location: "מגרש 2",
    notes: "הערת שיעור",
    isPublished: true,
    roleLabelOverrides: null,
    responsibleInstructorId: "i9",
    responsibleInstructorName: "מדריכה א",
    participants: [
      {
        id: "p1",
        traineeId: "st9",
        traineeName: "חניך א",
        role: "LEAD_INSTRUCTOR",
        isManualOverride: false,
        createdAt: "2026-07-01T08:00:00.000Z",
      },
    ],
    childAssignments: [
      {
        id: "ca1",
        childId: "c1",
        childName: "ילד א",
        childAge: 9,
        childGender: "F",
        childNotes: "רגיש לרעש",
        parentName: "הורה א",
        parentPhone: "050-1234567",
        horseName: "סוסון",
        equipmentNotes: "קסדה קטנה",
        isAbsent: false,
      },
    ],
    ...over,
  };
}

function options(over: Partial<ExamPlanLoadOptions> = {}): ExamPlanLoadOptions {
  return {
    requirePlanPublication: false,
    requireLessonPublication: false,
    viewerStudentId: null,
    ...over,
  };
}

interface Recorder {
  readonly deps: ExamPlanLoadDeps;
  readonly calls: string[];
  readonly args: Record<string, unknown[]>;
}

interface FakeData {
  readonly plan?: ExamPlanIdentityRow | null;
  readonly definitions?: readonly StoredExamDefinitionRow[];
  readonly sessions?: readonly StoredExamSessionRow[];
  readonly sourceDates?: readonly ExamPlanSourceDateRow[];
  readonly lessons?: readonly TeachingPracticeExamLessonRow[];
  readonly failOn?: string;
}

/** Injected fakes that RECORD the call order and every argument they receive. */
function recorder(data: FakeData = {}): Recorder {
  const calls: string[] = [];
  const args: Record<string, unknown[]> = {};

  function record(name: string, value: unknown): void {
    calls.push(name);
    (args[name] ??= []).push(value);
    if (data.failOn === name) throw new Error(`dependency failure: ${name}`);
  }

  const deps: ExamPlanLoadDeps = {
    async fetchPlanByCourseOfferingId(courseOfferingId) {
      record("plan", courseOfferingId);
      return data.plan === undefined
        ? { id: "plan1", publishedAt: 1000, updatedAt: 2000 }
        : data.plan;
    },
    async fetchDefinitionsByPlanId(planId) {
      record("definitions", planId);
      return data.definitions ?? [definition()];
    },
    async fetchSessionsByPlanId(planId) {
      record("sessions", planId);
      return data.sessions ?? [session()];
    },
    async fetchSourceDatesByPlanId(planId) {
      record("sourceDates", planId);
      return data.sourceDates ?? [];
    },
    async fetchTeachingPracticeLessonsByDates(dates) {
      record("lessons", [...dates]);
      return data.lessons ?? [];
    },
  };

  return { deps, calls, args };
}

function loaderCodes(payload: ExamPlanPayload): string[] {
  return payload.diagnostics.loaderIssues.map((i) => i.code);
}

function sessionIds(payload: ExamPlanPayload): string[] {
  return payload.sessions.map((s) => s.sessionId);
}

/** A JSON-comparable shape, so two payloads can be compared byte for byte. */
function snapshot(payload: ExamPlanPayload): string {
  return JSON.stringify({
    planId: payload.planId,
    publishedAt: payload.publishedAt,
    sessions: payload.sessions,
    storedDetails: [...payload.storedDetails.entries()],
    beginnerDetails: [...payload.beginnerDetails.entries()],
    conflictSessions: payload.conflictSessions,
    sourceDates: payload.sourceDates,
    diagnostics: payload.diagnostics,
  });
}

// ===========================================================================
// 1–5. The plan gate
// ===========================================================================

test("a blank courseOfferingId returns the empty payload and calls NOTHING", async () => {
  for (const blank of ["", "   "]) {
    const r = recorder();
    const payload = await loadExamPlan({ courseOfferingId: blank, options: options() }, r.deps);

    assert.deepEqual(r.calls, []);
    assert.equal(payload.planId, null);
    assert.equal(payload.publishedAt, null);
    assert.deepEqual([...payload.sessions], []);
    assert.deepEqual(loaderCodes(payload), ["EX-LOAD-COURSE-OFFERING-ID-REQUIRED"]);
  }
});

test("no plan returns the empty payload with ONLY the plan fetch performed", async () => {
  const r = recorder({ plan: null });
  const payload = await loadExamPlan({ courseOfferingId: "co1", options: options() }, r.deps);

  assert.deepEqual(r.calls, ["plan"]);
  assert.equal(payload.planId, null);
  assert.deepEqual([...payload.sessions], []);
  // An offering with no plan is ordinary, not a defect: nothing is reported.
  assert.deepEqual(loaderCodes(payload), []);
});

test("an unpublished plan under requirePlanPublication fetches NO content", async () => {
  const r = recorder({ plan: { id: "plan1", publishedAt: null, updatedAt: 5 } });
  const payload = await loadExamPlan(
    { courseOfferingId: "co1", options: options({ requirePlanPublication: true }) },
    r.deps,
  );

  assert.deepEqual(r.calls, ["plan"]);
  // The empty payload does not even disclose that a plan exists.
  assert.equal(payload.planId, null);
  assert.equal(payload.publishedAt, null);
  assert.deepEqual([...payload.sessions], []);
  assert.deepEqual([...payload.storedDetails.keys()], []);
  assert.deepEqual([...payload.sourceDates], []);
});

test("an unpublished plan WITHOUT the requirement loads its content", async () => {
  const r = recorder({ plan: { id: "plan1", publishedAt: null, updatedAt: 5 } });
  const payload = await loadExamPlan(
    { courseOfferingId: "co1", options: options({ requirePlanPublication: false }) },
    r.deps,
  );

  assert.deepEqual(r.calls, ["plan", "definitions", "sessions", "sourceDates"]);
  assert.equal(payload.planId, "plan1");
  assert.equal(payload.publishedAt, null);
  assert.deepEqual(sessionIds(payload), ["s1"]);
});

test("a published plan loads its content under either publication option", async () => {
  for (const requirePlanPublication of [true, false]) {
    const r = recorder();
    const payload = await loadExamPlan(
      { courseOfferingId: "co1", options: options({ requirePlanPublication }) },
      r.deps,
    );
    assert.equal(payload.planId, "plan1");
    assert.equal(payload.publishedAt, 1000);
    assert.deepEqual(sessionIds(payload), ["s1"]);
  }
});

test("an unusable plan identity fails closed without fetching content", async () => {
  const r = recorder({ plan: { id: "   ", publishedAt: 1000, updatedAt: 2 } });
  const payload = await loadExamPlan({ courseOfferingId: "co1", options: options() }, r.deps);

  assert.deepEqual(r.calls, ["plan"]);
  assert.equal(payload.planId, null);
  assert.deepEqual(loaderCodes(payload), ["EX-LOAD-PLAN-ID-INVALID"]);
});

test("the options are read FAIL CLOSED when they are malformed at runtime", async () => {
  const r = recorder({ plan: { id: "plan1", publishedAt: null, updatedAt: 1 } });
  // A partially-built options object must be MORE restrictive, never less.
  const payload = await loadExamPlan(
    { courseOfferingId: "co1", options: {} as ExamPlanLoadOptions },
    r.deps,
  );
  assert.deepEqual(r.calls, ["plan"]);
  assert.equal(payload.planId, null);
});

// ===========================================================================
// 6–8. The planId trust boundary and the call order
// ===========================================================================

test("every content dependency receives the plan id the PLAN FETCH returned", async () => {
  const r = recorder({
    plan: { id: "plan-from-db", publishedAt: 1, updatedAt: 1 },
    sourceDates: [{ date: "2026-08-11" }],
  });
  await loadExamPlan({ courseOfferingId: "co1", options: options() }, r.deps);

  assert.deepEqual(r.args.plan, ["co1"]);
  assert.deepEqual(r.args.definitions, ["plan-from-db"]);
  assert.deepEqual(r.args.sessions, ["plan-from-db"]);
  assert.deepEqual(r.args.sourceDates, ["plan-from-db"]);
});

test("a planId smuggled onto the input object addresses NOTHING", async () => {
  const r = recorder({ plan: { id: "plan-from-db", publishedAt: 1, updatedAt: 1 } });
  const smuggled = {
    courseOfferingId: "co1",
    planId: "someone-elses-plan",
    options: options(),
  } as unknown as { courseOfferingId: string; options: ExamPlanLoadOptions };

  await loadExamPlan(smuggled, r.deps);

  for (const name of ["definitions", "sessions", "sourceDates"]) {
    assert.deepEqual(r.args[name], ["plan-from-db"], `${name} used the caller's id`);
  }
});

test("the plan fetch happens BEFORE every content fetch", async () => {
  const r = recorder({ sourceDates: [{ date: "2026-08-11" }], lessons: [lesson()] });
  await loadExamPlan({ courseOfferingId: "co1", options: options() }, r.deps);

  assert.equal(r.calls[0], "plan");
  assert.equal(r.calls.indexOf("plan"), 0);
  for (const name of ["definitions", "sessions", "sourceDates", "lessons"]) {
    assert.ok(r.calls.indexOf(name) > 0, `${name} ran before the plan gate`);
  }
  // The Teaching-Practice fetch is last: it depends on the source dates.
  assert.equal(r.calls[r.calls.length - 1], "lessons");
});

test("definitions, sessions and source dates are each fetched EXACTLY once", async () => {
  const r = recorder({ sourceDates: [{ date: "2026-08-11" }], lessons: [lesson()] });
  await loadExamPlan({ courseOfferingId: "co1", options: options() }, r.deps);

  for (const name of ["plan", "definitions", "sessions", "sourceDates", "lessons"]) {
    assert.equal(r.calls.filter((c) => c === name).length, 1, `${name} was not called once`);
  }
});

// ===========================================================================
// 10–14. Source dates
// ===========================================================================

test("an empty source-date list does NOT call the Teaching-Practice dependency", async () => {
  const r = recorder({ sourceDates: [] });
  const payload = await loadExamPlan({ courseOfferingId: "co1", options: options() }, r.deps);

  assert.equal(r.calls.includes("lessons"), false);
  assert.deepEqual([...payload.sourceDates], []);
  assert.deepEqual([...payload.beginnerDetails.keys()], []);
});

test("a non-empty source-date list calls the Teaching-Practice dependency once", async () => {
  const r = recorder({ sourceDates: [{ date: "2026-08-11" }], lessons: [lesson()] });
  await loadExamPlan({ courseOfferingId: "co1", options: options() }, r.deps);

  assert.equal(r.calls.filter((c) => c === "lessons").length, 1);
});

test("the Teaching-Practice fetch receives the normalized, deduped, sorted dates", async () => {
  const r = recorder({
    sourceDates: [
      { date: "2026-08-12" },
      { date: " 2026-08-11 " },
      { date: "2026-08-12" },
      { date: "2026-08-09" },
    ],
  });
  const payload = await loadExamPlan({ courseOfferingId: "co1", options: options() }, r.deps);

  assert.deepEqual(r.args.lessons, [["2026-08-09", "2026-08-11", "2026-08-12"]]);
  assert.deepEqual([...payload.sourceDates], ["2026-08-09", "2026-08-11", "2026-08-12"]);
});

test("a malformed source date is DROPPED and reported without echoing its value", async () => {
  const r = recorder({
    sourceDates: [
      { date: "2026-8-1" },
      { date: "not-a-date" },
      { date: "2026-08-11" },
      { date: "" },
    ],
  });
  const payload = await loadExamPlan({ courseOfferingId: "co1", options: options() }, r.deps);

  assert.deepEqual(r.args.lessons, [["2026-08-11"]]);
  assert.deepEqual([...payload.sourceDates], ["2026-08-11"]);
  // One collapsed issue, not four identical ones.
  assert.deepEqual(loaderCodes(payload), ["EX-LOAD-SOURCE-DATE-INVALID"]);
  const issue = payload.diagnostics.loaderIssues[0];
  assert.equal(issue.sessionId, null);
  assert.equal(issue.lessonId, null);
  assert.equal(JSON.stringify(issue).includes("not-a-date"), false);
});

test("no date is ever INFERRED from the sessions, the lessons or anything else", async () => {
  const r = recorder({
    // The stored block sits on a date that is NOT a source date.
    sessions: [session({ date: "2026-08-10" })],
    sourceDates: [{ date: "2026-08-11" }],
    lessons: [lesson({ date: "2026-08-11" })],
  });
  const payload = await loadExamPlan({ courseOfferingId: "co1", options: options() }, r.deps);

  assert.deepEqual(r.args.lessons, [["2026-08-11"]]);
  assert.deepEqual([...payload.sourceDates], ["2026-08-11"]);
  // The stored block's own date never joins the source-date list.
  assert.equal(payload.sourceDates.includes("2026-08-10"), false);
});

test("an all-malformed source-date list does not call Teaching Practice at all", async () => {
  const r = recorder({ sourceDates: [{ date: "nope" }] });
  const payload = await loadExamPlan({ courseOfferingId: "co1", options: options() }, r.deps);

  assert.equal(r.calls.includes("lessons"), false);
  assert.deepEqual(loaderCodes(payload), ["EX-LOAD-SOURCE-DATE-INVALID"]);
});

// ===========================================================================
// 15–18. Stored composition
// ===========================================================================

test("stored sessions, details and conflict inputs all reach the payload", async () => {
  const r = recorder();
  const payload = await loadExamPlan({ courseOfferingId: "co1", options: options() }, r.deps);

  assert.deepEqual(sessionIds(payload), ["s1"]);
  // The detail lookup is keyed by SESSION ID.
  assert.deepEqual([...payload.storedDetails.keys()], ["s1"]);
  assert.equal(payload.storedDetails.get("s1")?.source, "STORED");
  assert.deepEqual(
    payload.conflictSessions.map((c) => c.sessionId),
    ["s1"],
  );
  assert.equal(payload.conflictSessions[0].source, "STORED");
  // The definition-backed row keeps its definition identity.
  assert.equal(payload.sessions[0].definitionId, "d1");
  assert.equal(payload.sessions[0].timetableStatus, "OK");
});

test("an UNRESOLVED stored row REMAINS in the internal payload, with diagnostics", async () => {
  const r = recorder({
    // A zero duration cannot produce a timetable.
    definitions: [definition({ durationMinutes: 0 })],
    sessions: [session()],
  });
  const payload = await loadExamPlan({ courseOfferingId: "co1", options: options() }, r.deps);

  assert.deepEqual(sessionIds(payload), ["s1"]);
  assert.equal(payload.sessions[0].timetableStatus, "UNRESOLVED");
  // No slot detail exists for an unresolved block — that is the committed rule.
  assert.equal(payload.storedDetails.has("s1"), false);
  // ...and the reason is observable.
  const diag = payload.diagnostics.storedBlockDiagnostics.find((d) => d.sessionId === "s1");
  assert.ok(diag !== undefined);
  assert.ok(diag.timetableIssues.length > 0);
});

test("a session excluded by the stored adapter is reported at plan level", async () => {
  const r = recorder({
    definitions: [definition()],
    sessions: [session(), session({ id: "s2", definitionId: "missing" })],
  });
  const payload = await loadExamPlan({ courseOfferingId: "co1", options: options() }, r.deps);

  assert.deepEqual(sessionIds(payload), ["s1"]);
  assert.deepEqual(
    payload.diagnostics.storedAdapterIssues.map((i) => i.code),
    ["EX-ADP-DEFINITION-MISSING"],
  );
  // A block that produced nothing has no per-block diagnostic entry.
  assert.equal(
    payload.diagnostics.storedBlockDiagnostics.some((d) => d.sessionId === "s2"),
    false,
  );
});

test("an ordinary plan carries NO noisy per-block diagnostics", async () => {
  const r = recorder();
  const payload = await loadExamPlan({ courseOfferingId: "co1", options: options() }, r.deps);
  assert.deepEqual([...payload.diagnostics.storedBlockDiagnostics], []);
});

// ===========================================================================
// 19–26. The live beginner composition
// ===========================================================================

test("live beginner rows are projected, keyed and marked NOT_APPLICABLE", async () => {
  const r = recorder({
    sessions: [],
    sourceDates: [{ date: "2026-08-11" }],
    lessons: [lesson()],
  });
  const payload = await loadExamPlan({ courseOfferingId: "co1", options: options() }, r.deps);

  const liveId = buildLiveBeginnerSessionId("l1");
  assert.deepEqual(sessionIds(payload), [liveId]);
  assert.equal(payload.sessions[0].kind, "BEGINNER_INSTRUCTION");
  assert.equal(payload.sessions[0].timetableStatus, "NOT_APPLICABLE");
  // The detail map key is the COMMITTED synthetic id.
  assert.deepEqual([...payload.beginnerDetails.keys()], [liveId]);
  assert.equal(payload.beginnerDetails.get(liveId)?.lessonId, "l1");
  // A beginner row NEVER produces a stored-detail entry.
  assert.equal(payload.storedDetails.has(liveId), false);
  assert.deepEqual([...payload.storedDetails.keys()], []);
});

test("requireLessonPublication false keeps published AND unpublished lessons", async () => {
  const r = recorder({
    sessions: [],
    sourceDates: [{ date: "2026-08-11" }],
    lessons: [lesson(), lesson({ id: "l2", startTime: "11:00", endTime: "12:00", isPublished: false })],
  });
  const payload = await loadExamPlan(
    { courseOfferingId: "co1", options: options({ requireLessonPublication: false }) },
    r.deps,
  );

  assert.deepEqual(sessionIds(payload), [
    buildLiveBeginnerSessionId("l1"),
    buildLiveBeginnerSessionId("l2"),
  ]);
  assert.equal(payload.beginnerDetails.get(buildLiveBeginnerSessionId("l2"))?.isPublished, false);
});

test("requireLessonPublication true excludes the unpublished lesson ENTIRELY", async () => {
  const r = recorder({
    sessions: [],
    definitions: [],
    sourceDates: [{ date: "2026-08-11" }],
    lessons: [
      lesson(),
      lesson({
        id: "l2",
        startTime: "11:00",
        endTime: "12:00",
        isPublished: false,
        notes: "סוד",
        childAssignments: [
          {
            id: "ca2",
            childId: "c2",
            childName: "ילד סודי",
            childAge: 7,
            childGender: "M",
            childNotes: null,
            parentName: "הורה סודי",
            parentPhone: "050-7654321",
            horseName: null,
            equipmentNotes: null,
            isAbsent: false,
          },
        ],
      }),
    ],
  });
  const payload = await loadExamPlan(
    { courseOfferingId: "co1", options: options({ requireLessonPublication: true }) },
    r.deps,
  );

  const hiddenId = buildLiveBeginnerSessionId("l2");
  assert.deepEqual(sessionIds(payload), [buildLiveBeginnerSessionId("l1")]);
  // No session, no detail, and no remnant anywhere in the payload.
  assert.equal(payload.beginnerDetails.has(hiddenId), false);
  assert.deepEqual([...payload.beginnerDetails.keys()], [buildLiveBeginnerSessionId("l1")]);
  const serialized = snapshot(payload);
  for (const secret of ["l2", "סוד", "ילד סודי", "הורה סודי", "050-7654321", "ca2"]) {
    assert.equal(serialized.includes(secret), false, `the payload leaked ${secret}`);
  }
});

test("the viewer id reaches the live adapter as its own self-match input", async () => {
  const r = recorder({
    sessions: [],
    sourceDates: [{ date: "2026-08-11" }],
    lessons: [lesson()],
  });
  const payload = await loadExamPlan(
    { courseOfferingId: "co1", options: options({ viewerStudentId: "  st9  " }) },
    r.deps,
  );

  const detail = payload.beginnerDetails.get(buildLiveBeginnerSessionId("l1"));
  assert.equal(detail?.isSelf, true);
  assert.equal(detail?.participants[0].isSelf, true);
});

test("a null viewer marks nobody", async () => {
  const r = recorder({
    sessions: [],
    sourceDates: [{ date: "2026-08-11" }],
    lessons: [lesson()],
  });
  const payload = await loadExamPlan({ courseOfferingId: "co1", options: options() }, r.deps);
  assert.equal(payload.beginnerDetails.get(buildLiveBeginnerSessionId("l1"))?.isSelf, false);
});

test("duplicate live session ids FAIL CLOSED — neither row wins, nothing is overwritten", async () => {
  const r = recorder({
    sessions: [],
    sourceDates: [{ date: "2026-08-11" }],
    // The same lesson id twice: the synthetic session id would collide.
    lessons: [lesson(), lesson({ notes: "גרסה שנייה" })],
  });
  const payload = await loadExamPlan({ courseOfferingId: "co1", options: options() }, r.deps);

  const liveId = buildLiveBeginnerSessionId("l1");
  assert.deepEqual(sessionIds(payload), []);
  assert.equal(payload.beginnerDetails.has(liveId), false);
  assert.deepEqual(loaderCodes(payload), ["EX-LOAD-BEGINNER-SESSION-DUPLICATE"]);
  assert.equal(payload.diagnostics.loaderIssues[0].sessionId, liveId);
  // Neither version's content is carried.
  assert.equal(snapshot(payload).includes("גרסה שנייה"), false);
});

test("Teaching-Practice source rejections stay observable", async () => {
  const r = recorder({
    sessions: [],
    sourceDates: [{ date: "2026-08-11" }],
    lessons: [lesson({ id: "l3", practiceType: "NOT_A_TYPE" })],
  });
  const payload = await loadExamPlan({ courseOfferingId: "co1", options: options() }, r.deps);

  assert.deepEqual(sessionIds(payload), []);
  assert.deepEqual(
    payload.diagnostics.teachingPracticeSourceIssues.map((i) => i.code),
    ["EX-TP-ADP-PRACTICE-TYPE-UNSUPPORTED"],
  );
});

// ===========================================================================
// 27–29. Ordering, determinism and the call-count contract
// ===========================================================================

test("stored and live rows are merged in ONE deterministic order", async () => {
  const r = recorder({
    definitions: [definition()],
    sessions: [
      session({ id: "sB", date: "2026-08-11", startTime: "09:00", orderIndex: 1 }),
      session({ id: "sA", date: "2026-08-11", startTime: "09:00", orderIndex: 0 }),
      session({ id: "sC", date: "2026-08-12", startTime: "08:00", orderIndex: 0 }),
    ],
    sourceDates: [{ date: "2026-08-11" }],
    lessons: [lesson({ id: "l1", date: "2026-08-11", startTime: "08:00", endTime: "09:00" })],
  });
  const payload = await loadExamPlan({ courseOfferingId: "co1", options: options() }, r.deps);

  assert.deepEqual(sessionIds(payload), [
    buildLiveBeginnerSessionId("l1"), // 08-11 08:00
    "sA", // 08-11 09:00 #0
    "sB", // 08-11 09:00 #1
    "sC", // 08-12 08:00
  ]);
});

test("shuffled dependency output produces a BYTE-IDENTICAL payload", async () => {
  const definitions = [definition(), definition({ id: "d2", name: "ליטוף", orderIndex: 1 })];
  const sessions = [
    session({ id: "s1", orderIndex: 0 }),
    session({ id: "s2", definitionId: "d2", orderIndex: 1 }),
    session({ id: "s3", date: "2026-08-12", orderIndex: 0 }),
  ];
  const sourceDates = [{ date: "2026-08-11" }, { date: "2026-08-12" }];
  const lessons = [
    lesson({ id: "l1", date: "2026-08-11" }),
    lesson({ id: "l2", date: "2026-08-12", startTime: "10:00", endTime: "11:00" }),
  ];

  const forward = await loadExamPlan(
    { courseOfferingId: "co1", options: options() },
    recorder({ definitions, sessions, sourceDates, lessons }).deps,
  );
  const reversed = await loadExamPlan(
    { courseOfferingId: "co1", options: options() },
    recorder({
      definitions: [...definitions].reverse(),
      sessions: [...sessions].reverse(),
      sourceDates: [...sourceDates].reverse(),
      lessons: [...lessons].reverse(),
    }).deps,
  );

  assert.equal(snapshot(forward), snapshot(reversed));
});

test("1, 5 and 40 sessions produce IDENTICAL dependency call counts", async () => {
  const counts: string[] = [];
  for (const n of [1, 5, 40]) {
    const sessions = Array.from({ length: n }, (_, i) =>
      session({ id: `s${i}`, orderIndex: i }),
    );
    const lessons = Array.from({ length: n }, (_, i) =>
      lesson({ id: `l${i}`, startTime: `0${(i % 5) + 4}:00`, endTime: "23:00" }),
    );
    const r = recorder({ sessions, lessons, sourceDates: [{ date: "2026-08-11" }] });
    const payload = await loadExamPlan({ courseOfferingId: "co1", options: options() }, r.deps);

    assert.equal(payload.sessions.length, n * 2, `n=${n} lost rows`);
    counts.push(r.calls.join(","));
  }
  assert.equal(counts[0], counts[1]);
  assert.equal(counts[1], counts[2]);
  assert.deepEqual(counts[0].split(",").sort(), [
    "definitions",
    "lessons",
    "plan",
    "sessions",
    "sourceDates",
  ]);
});

// ===========================================================================
// 30–34. Failure surfacing, privacy, immutability
// ===========================================================================

test("a dependency failure PROPAGATES — it is never swallowed as an empty plan", async () => {
  for (const failOn of ["plan", "definitions", "sessions", "sourceDates", "lessons"]) {
    const r = recorder({ failOn, sourceDates: [{ date: "2026-08-11" }] });
    await assert.rejects(
      () => loadExamPlan({ courseOfferingId: "co1", options: options() }, r.deps),
      /dependency failure/,
      `${failOn} was swallowed`,
    );
  }
});

test("the diagnostics carry NO personal information", async () => {
  const r = recorder({
    definitions: [definition({ durationMinutes: 0 })],
    sessions: [
      session({
        assignments: [
          {
            id: "a1",
            studentId: "st-secret",
            role: "NOT_A_ROLE",
            orderIndex: 0,
            horseName: "סוס סודי",
            instructionTopic: "נושא סודי",
            discipline: "ענף סודי",
            pairingIndex: null,
            notes: "הערה סודית",
          },
        ],
        notes: "הערת מפגש סודית",
        title: "כותרת סודית",
      }),
    ],
    sourceDates: [{ date: "2026-08-11" }, { date: "bad" }],
    lessons: [
      lesson({
        id: "l1",
        participants: [
          {
            id: "p1",
            traineeId: "st-secret-2",
            traineeName: "שם סודי",
            role: "NOT_A_ROLE",
            isManualOverride: false,
            createdAt: "2026-07-01T08:00:00.000Z",
          },
        ],
      }),
    ],
  });
  const payload = await loadExamPlan({ courseOfferingId: "co1", options: options() }, r.deps);

  const serialized = JSON.stringify(payload.diagnostics);
  for (const secret of [
    "st-secret",
    "st-secret-2",
    "שם סודי",
    "סוס סודי",
    "נושא סודי",
    "ענף סודי",
    "הערה סודית",
    "הערת מפגש סודית",
    "כותרת סודית",
    "ילד א",
    "הורה א",
    "050-1234567",
  ]) {
    assert.equal(serialized.includes(secret), false, `the diagnostics leaked ${secret}`);
  }
  // ...while still reporting the defects by code.
  assert.ok(payload.diagnostics.loaderIssues.length > 0);
  assert.ok(payload.diagnostics.teachingPracticeSourceIssues.length > 0);
});

test("frozen output is MUTATION protection only — never a privacy boundary", async () => {
  const r = recorder({ sourceDates: [{ date: "2026-08-11" }], lessons: [lesson()] });
  const payload = await loadExamPlan({ courseOfferingId: "co1", options: options() }, r.deps);

  assert.ok(Object.isFrozen(payload));
  assert.ok(Object.isFrozen(payload.sessions));
  assert.ok(Object.isFrozen(payload.conflictSessions));
  assert.ok(Object.isFrozen(payload.sourceDates));
  assert.ok(Object.isFrozen(payload.diagnostics));
  assert.ok(Object.isFrozen(payload.diagnostics.loaderIssues));
  assert.ok(Object.isFrozen(payload.diagnostics.storedBlockDiagnostics));
  assert.ok(Object.isFrozen(payload.diagnostics.beginnerRejections));

  // ...and it stops EXACTLY there. The payload remains the sensitive superset: a
  // caller can read every field of it, so nothing here filters, authorizes or
  // contains anything. That is the EX-S5A-4 DTO narrowing's job, and this
  // assertion exists so the freezing above is never mistaken for it.
  const detail = payload.beginnerDetails.get(buildLiveBeginnerSessionId("l1"));
  assert.equal(detail?.children[0].parentPhone, "050-1234567");
  assert.deepEqual(JSON.parse(JSON.stringify(payload.sessions)), [...payload.sessions]);
});

test("the empty payload is a FRESH value, never a shared mutable singleton", () => {
  const a = emptyExamPlanPayload();
  const b = emptyExamPlanPayload();

  assert.notEqual(a.storedDetails, b.storedDetails);
  assert.notEqual(a.beginnerDetails, b.beginnerDetails);
  (a.storedDetails as unknown as Map<string, unknown>).set("poison", 1);
  assert.equal(b.storedDetails.size, 0);
  assert.equal(emptyExamPlanPayload().storedDetails.size, 0);
  assert.equal(a.planId, null);
  assert.deepEqual([...b.sourceDates], []);
});

test("neither the inputs nor the dependency outputs are mutated", async () => {
  const definitions = [definition()];
  const sessions = [session({ id: "sZ" }), session({ id: "sA" })];
  const sourceDates = [{ date: "2026-08-12" }, { date: "2026-08-11" }];
  const lessons = [lesson({ id: "l2", date: "2026-08-12" }), lesson({ id: "l1" })];
  const input = { courseOfferingId: "co1", options: options() };

  const before = JSON.stringify({ definitions, sessions, sourceDates, lessons, input });
  await loadExamPlan(input, recorder({ definitions, sessions, sourceDates, lessons }).deps);
  assert.equal(JSON.stringify({ definitions, sessions, sourceDates, lessons, input }), before);
});

test("ProjectionSession is unchanged: no slots, no isSelf, no definition orderIndex", async () => {
  const r = recorder({ sourceDates: [{ date: "2026-08-11" }], lessons: [lesson()] });
  const payload = await loadExamPlan({ courseOfferingId: "co1", options: options() }, r.deps);

  const allowed = new Set([
    "sessionId",
    "kind",
    "beginnerFormat",
    "date",
    "startTime",
    "endTime",
    "orderIndex",
    "examineeStudentIds",
    "instructedTraineeStudentIds",
    "beginnerChildCount",
    "definitionId",
    "definitionName",
    "derivedBlockEndTime",
    "timetableStatus",
  ]);
  for (const row of payload.sessions) {
    for (const key of Object.keys(row)) {
      assert.ok(allowed.has(key), `ProjectionSession gained ${key}`);
    }
  }
});

test("stored adapter output is included UNCHANGED", async () => {
  const definitions = [definition()];
  const sessions = [session()];
  const r = recorder({ definitions, sessions });
  const payload = await loadExamPlan({ courseOfferingId: "co1", options: options() }, r.deps);

  // The same rows, composed directly by the committed adapter.
  const direct = composeStoredExamBlocks(sessions, definitions);
  assert.deepEqual(payload.sessions[0], direct.blocks[0].session);
  assert.deepEqual(payload.conflictSessions[0], direct.blocks[0].conflictSession);
  assert.deepEqual(payload.storedDetails.get("s1"), direct.blocks[0].detail);
  assert.deepEqual([...payload.diagnostics.storedAdapterIssues], [...direct.issues]);
  assert.ok(Object.isFrozen(payload.sessions[0]));
});

// ===========================================================================
// 35–44. Structural guards
// ===========================================================================

const LOADER_SOURCE = readFileSync(LOADER_SOURCE_PATH, "utf8");
const IO_SOURCE = readFileSync(IO_SOURCE_PATH, "utf8");

/**
 * The EXECUTABLE text only, with block and line comments removed.
 *
 * The guards below must assert on CODE, never on prose: both files legitimately
 * DISCUSS the things they forbid (a role, a capability, the deprecated columns),
 * and a check that fired on the explanation would have to be deleted the first
 * time somebody documented a rule properly.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/gm, "$1");
}

const LOADER_CODE = stripComments(LOADER_SOURCE);
const IO_CODE = stripComments(IO_SOURCE);

/** Assembled from split literals so the sibling exam-slice guard stays green. */
const PRISMA_MODULE = ["@/lib", "prisma"].join("/");
const BROAD_TP_READER = ["lib/actions", "teaching-practice"].join("/");
const WIDE_INCLUDE = ["LESSON_DETAIL", "INCLUDE"].join("_");
const EVALUATION_MODEL = ["TeachingPractice", "Feed", "back"].join("");
const RATING_COLUMN = ["rating", "Half", "Points"].join("");

test("neither new source file is a Server Action module", () => {
  // Asserted on the EXECUTABLE text: both files DISCUSS the directive in prose,
  // and only an actual directive — never a sentence about one — makes a module
  // a Server Action surface.
  for (const [name, source] of [
    ["exam-plan-loader-core.ts", LOADER_CODE],
    ["exam-read-io.ts", IO_CODE],
  ] as const) {
    assert.equal(source.includes('"use server"'), false, `${name} declares use server`);
    assert.equal(source.includes("'use server'"), false, `${name} declares use server`);
  }
});

test("the loader core is PURE: no database, auth, actor, clock or env access", () => {
  const forbidden = [
    PRISMA_MODULE,
    "@prisma" + "/client",
    "app/generated",
    "next/",
    "getCurrentInstructor",
    "getCurrentStudent",
    "cookies(",
    "process.env",
    "Date.now(",
    "new Date(",
    "Math.random(",
  ];
  for (const token of forbidden) {
    assert.equal(LOADER_CODE.includes(token), false, `the loader references ${token}`);
  }
  // Every import is a SIBLING pure core; nothing is imported from outside.
  const imports = LOADER_CODE.match(/from\s+"([^"]+)"/g) ?? [];
  assert.ok(imports.length > 0, "sanity: the loader imports the committed cores");
  for (const specifier of imports) {
    assert.ok(specifier.includes('"./'), `the loader imports ${specifier}`);
  }
});

test("the loader core contains no role, capability or authorization logic", () => {
  // The ONLY publication logic is the two OPTION reads; there is no role enum.
  for (const token of [
    "isAdmin",
    "isInstructor",
    "requireAdmin",
    "capabilit",
    "Capabilit",
    "ADMIN",
    "actor",
    "enrollment",
    "getSession",
    "cookie",
  ]) {
    assert.equal(LOADER_CODE.includes(token), false, `the loader references ${token}`);
  }
  assert.ok(LOADER_CODE.includes("requirePlanPublication"));
  assert.ok(LOADER_CODE.includes("requireLessonPublication"));
});

test("the IO shell contains NO write method", () => {
  const writes = /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/;
  assert.equal(writes.test(IO_CODE), false, "the IO shell performs a write");
  for (const token of ["$executeRaw", "$transaction", "$queryRaw"]) {
    assert.equal(IO_CODE.includes(token), false, `the IO shell uses ${token}`);
  }
});

test("the IO shell reuses NO broad Teaching-Practice reader", () => {
  assert.equal(IO_SOURCE.includes(BROAD_TP_READER), false);
  assert.equal(IO_SOURCE.includes(WIDE_INCLUDE), false);
});

test("the IO shell selects no evaluation, rating, grade, score or result field", () => {
  assert.equal(IO_SOURCE.includes(EVALUATION_MODEL), false);
  assert.equal(IO_SOURCE.includes(RATING_COLUMN), false);
  for (const pattern of [
    /\bfeedback\s*:/i,
    /\brating\w*\s*:/i,
    /\bgrade\w*\s*:/i,
    /\bscore\w*\s*:/i,
  ]) {
    assert.equal(pattern.test(IO_CODE), false, `the IO shell selects ${pattern}`);
  }
});

/** The `fetchExamSessionsByPlanId` body, from its query to its mapper's end. */
function sessionQuerySource(): string {
  const start = IO_CODE.indexOf("prisma.examSession.findMany");
  assert.ok(start > 0, "the session query was not found");
  const end = IO_CODE.indexOf("export async function", start);
  assert.ok(end > start, "the session query body was not found");
  return IO_CODE.slice(start, end);
}

test("the session select names NONE of the deprecated columns", () => {
  const body = sessionQuerySource();
  for (const field of [
    "kind",
    "phase",
    "beginnerFormat",
    "capacity",
    "interfaceSessionId",
    "sourceTeachingPracticeLessonId",
    "copiedAt",
    "roleLabelOverrides",
    "sourcePracticeRole",
    "beginnerChildren",
  ]) {
    assert.equal(
      new RegExp(`\\b${field}\\s*:`).test(body),
      false,
      `the session select names the deprecated ${field}`,
    );
  }
  // ...while still selecting what the committed row contract declares.
  for (const field of ["definitionId", "individualPublishedAt", "supervisors", "breaks"]) {
    assert.ok(new RegExp(`\\b${field}\\s*:`).test(body), `the session select lost ${field}`);
  }
});

test("the Teaching-Practice query is ONE batched lookup over the explicit dates", () => {
  assert.ok(IO_CODE.includes("date: { in: dates.map"), "the date filter is not batched");
  // No loop of any kind, so no query can be issued per session or per lesson.
  for (const loop of ["for (", "while (", "forEach("]) {
    assert.equal(IO_CODE.includes(loop), false, `the IO shell contains a ${loop} loop`);
  }
  // Exactly one database call per dependency function — no per-row query exists.
  const calls = IO_CODE.match(/prisma\.\w+\./g) ?? [];
  assert.equal(calls.length, 5, `expected 5 queries, found ${calls.length}`);
});

// --- the privacy-boundary guards -------------------------------------------

/** The COMMENT text only — the inverse of {@link stripComments}. */
function commentsOf(source: string): string {
  return [
    ...(source.match(/\/\*[\s\S]*?\*\//g) ?? []),
    ...(source.match(/(?:^|[^:])\/\/[^\n]*/gm) ?? []),
  ]
    .join("\n")
    .replace(/^\s*\*+/gm, " ");
}

const LOADER_COMMENTS = commentsOf(LOADER_SOURCE);
const IO_COMMENTS = commentsOf(IO_SOURCE);

test("the loader header marks ExamPlanPayload INTERNAL-ONLY and SENSITIVE", () => {
  assert.ok(
    /ExamPlanPayload IS INTERNAL-ONLY AND SENSITIVE/.test(LOADER_COMMENTS),
    "the internal-only warning is missing from the loader header",
  );
  // It must name the real boundary, so a reader is never left to guess.
  assert.ok(/EX-S5A-4/.test(LOADER_COMMENTS));
  assert.ok(/narrowing/i.test(LOADER_COMMENTS));
  assert.ok(/never be returned/i.test(LOADER_COMMENTS));
  // ...and both files must say who the sensitive data belongs to.
  for (const comments of [LOADER_COMMENTS, IO_COMMENTS]) {
    assert.ok(/superset/i.test(comments), "the superset warning is missing");
    assert.ok(/parent[- ]contact/i.test(comments), "the contact warning is missing");
  }
});

/**
 * A comment PARAGRAPH that mentions immutability together with client exposure,
 * without ever DISCLAIMING the link between them.
 *
 * TARGETED, not a blanket substring ban: an honest paragraph may — and should —
 * discuss both at once, precisely in order to deny that one implies the other.
 * What is forbidden is discussing them together while leaving the reader with
 * the impression that `readonly` / `ReadonlyMap` / `Object.freeze` does any
 * containing. The disclaimer vocabulary is deliberately narrow, so the guard
 * fires on a claim rather than on a wording it merely dislikes.
 */
function immutabilityClaimOffenders(comments: string): string[] {
  const IMMUTABILITY = /\b(ReadonlyMap|readonly|frozen|freeze|immutab\w*)\b/i;
  // "client" means A VIEWER's client — never "the database client", which every
  // purity note legitimately mentions while forbidding it.
  const EXPOSURE =
    /\b(serializ\w*|Server[- ]Action|Server Component|browser)\b|(?<!database )(?<!Prisma )\bclients?\b/i;
  const DISCLAIMER =
    /\b(mutation|do(?:es)? not|is not|are not|never a|no authorization|not a (?:privacy|security|serialization|authorization) boundary|neither prevent)\b/i;

  const offenders: string[] = [];
  for (const paragraph of comments.split(/\n\s*\n/)) {
    if (!IMMUTABILITY.test(paragraph)) continue;
    if (!EXPOSURE.test(paragraph)) continue;
    if (DISCLAIMER.test(paragraph)) continue;
    offenders.push(paragraph.replace(/\s+/g, " ").trim().slice(0, 140));
  }
  return offenders;
}

test("no comment claims immutability prevents serialization or client exposure", () => {
  for (const [name, comments] of [
    ["exam-plan-loader-core.ts", LOADER_COMMENTS],
    ["exam-read-io.ts", IO_COMMENTS],
  ] as const) {
    assert.deepEqual(
      immutabilityClaimOffenders(comments),
      [],
      `${name} describes immutability as a privacy or serialization boundary`,
    );
  }
});

test("that guard is meaningful, not vacuously true", () => {
  // The EXACT phrasing this review rejected: it presents `ReadonlyMap` as the
  // reason the payload cannot be returned. It must be caught.
  const rejected =
    " - NO client serialization. `ReadonlyMap` is deliberate: this payload is\n" +
    "   an INTERNAL value, never returned by an action.";
  assert.equal(immutabilityClaimOffenders(rejected).length, 1);

  // ...while the correction — which discusses both, to DENY the link — is not.
  const honest =
    " `readonly`, `ReadonlyMap` and `Object.freeze` protect against ACCIDENTAL\n" +
    " MUTATION and nothing else: they perform no authorization, filter no field,\n" +
    " and a framework may serialize whatever it is handed to a client.";
  assert.deepEqual(immutabilityClaimOffenders(honest), []);

  // Sanity: the loader really does discuss both, so the clean result above is a
  // pass rather than an absence of subject matter.
  assert.ok(/ReadonlyMap/.test(LOADER_COMMENTS) && /serializ/i.test(LOADER_COMMENTS));
});

test("the loader header states the cross-course source-date containment rule", () => {
  // The schema limitation, and what it forbids for the NEXT slice.
  assert.ok(/no\s+`?courseOfferingId`?/i.test(LOADER_COMMENTS));
  assert.ok(/EX-S5A-4 MUST NOT\s*\n?\s*\*?\s*BE DEPLOYED/i.test(LOADER_COMMENTS.replace(/\s+/g, " ")) ||
    /EX-S5A-4 MUST NOT BE DEPLOYED/i.test(LOADER_COMMENTS.replace(/\s+/g, " ")));
  assert.ok(/SEPARATE, REVIEWED CONTAINMENT DECISION/i.test(LOADER_COMMENTS.replace(/\s+/g, " ")));
});

/** Every `.ts`/`.tsx` file in the repo's own source trees. */
function repoSourceFiles(): { path: string; source: string }[] {
  const out: { path: string; source: string }[] = [];
  for (const dir of ["app", "lib"]) {
    const root = join(REPO_ROOT, dir);
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!/\.tsx?$/.test(entry.name)) continue;
      const path = join(entry.parentPath ?? root, entry.name);
      // The generated client is machine output, not repository source.
      if (path.includes(`${sep}generated${sep}`)) continue;
      out.push({ path, source: readFileSync(path, "utf8") });
    }
  }
  return out;
}

test("NO route, action, page or UI file calls the loader yet", () => {
  const files = repoSourceFiles();
  assert.ok(files.length > 100, `sanity: expected the repository, found ${files.length} files`);

  const callers = files
    .filter((f) => f.path !== LOADER_SOURCE_PATH && f.path !== TEST_SOURCE_PATH)
    // CODE only: the IO shell's header legitimately NAMES the loader when it
    // explains who is expected to call it.
    .filter((f) => /\bloadExamPlan\s*\(/.test(stripComments(f.source)))
    .map((f) => f.path.slice(REPO_ROOT.length + 1));

  assert.deepEqual(
    callers,
    [],
    `EX-S5A-3 is unwired infrastructure; the payload may only be consumed through the EX-S5A-4 narrowing. Found: ${callers.join(", ")}`,
  );

  // The IO shell may reference the loader's CONTRACT, but only as a type.
  assert.ok(IO_CODE.includes('import type {'), "the loader contract must be type-only here");
  assert.equal(/import\s+{[^}]*}\s+from\s+"@\/lib\/exam\/exam-plan-loader-core"/.test(IO_CODE), false);
});

test("the approved file scope is exactly the three new files", () => {
  for (const path of [LOADER_SOURCE_PATH, TEST_SOURCE_PATH, IO_SOURCE_PATH]) {
    assert.ok(existsSync(path), `missing ${path}`);
  }
});

test("this slice adds no route, page, UI or write action", () => {
  // No exam route or page exists yet: the loader is internal infrastructure.
  for (const dir of ["app/admin/exams", "app/instructor/exams", "app/student/exams"]) {
    assert.equal(existsSync(join(REPO_ROOT, dir)), false, `${dir} was created`);
  }
  // The IO shell exports narrow fetches and one dependency bundle — there is no
  // role-accessible entry point yet; that is EX-S5A-4.
  const exported = (IO_CODE.match(/export\s+(?:async\s+function|const)\s+(\w+)/g) ?? []).map(
    (line) => line.split(/\s+/).pop(),
  );
  assert.deepEqual(exported, [
    "fetchExamPlanByCourseOfferingId",
    "fetchExamDefinitionsByPlanId",
    "fetchExamSessionsByPlanId",
    "fetchExamSourceDatesByPlanId",
    "fetchExamTeachingPracticeLessonsByDates",
    "examPlanReadDeps",
  ]);
  // Narrow read bindings ONLY: no role-facing reader that would hand a caller
  // the un-narrowed payload. Such an entry point is EX-S5A-4's, with its DTO.
  for (const name of exported) {
    assert.equal(
      /^(get|load|read)Exam/.test(name ?? ""),
      false,
      `${name} reads as a role-facing entry point`,
    );
  }
  assert.equal(IO_CODE.includes("loadExamPlan"), false, "the IO shell calls the loader");
});
