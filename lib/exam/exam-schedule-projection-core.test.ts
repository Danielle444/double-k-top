/**
 * EXAM EX-C1 — executable tests for the PURE three-view projection core
 * (exam-schedule-projection-core.ts).
 *
 * Run with: npx tsx --test lib/exam/exam-schedule-projection-core.test.ts
 * PURE: no Prisma, no DB, no clock, no randomness, no auth, no cookie, no env.
 *
 * SCOPE OF PROOF: the locked ordering of each view; that all three views
 * project the SAME authoritative session ids (one source of truth); that
 * editing one session is visible through all three without any synchronisation;
 * both total-hours readings; the beginner format sub-grouping; distinct (not
 * summed) trainee counts; and input immutability.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  projectGeneralSchedule,
  projectByDate,
  projectByExamKind,
  listExamDates,
  collectSessionIds,
  type ProjectionSession,
  type ProjectionTimetableStatus,
} from "./exam-schedule-projection-core";
import { EXAM_KINDS } from "./exam-domain-core";

function session(over: Partial<ProjectionSession> = {}): ProjectionSession {
  return {
    sessionId: "S1",
    kind: "BEGINNER_INSTRUCTION",
    beginnerFormat: "LUNGE",
    date: "2026-08-02",
    startTime: "16:00",
    endTime: "16:30",
    orderIndex: 0,
    examineeStudentIds: [],
    instructedTraineeStudentIds: [],
    beginnerChildCount: 0,
    ...over,
  };
}

/**
 * A miniature of the real copy-source shape: two dates, sessions sharing start
 * times (which is why orderIndex exists), two kinds.
 */
function fixture(): ProjectionSession[] {
  return [
    session({ sessionId: "B2", date: "2026-08-02", startTime: "16:00", endTime: "16:30", orderIndex: 1, examineeStudentIds: ["T1", "T2"] }),
    session({ sessionId: "B1", date: "2026-08-02", startTime: "16:00", endTime: "16:30", orderIndex: 0, examineeStudentIds: ["T3"] }),
    session({ sessionId: "B3", date: "2026-08-02", startTime: "18:30", endTime: "19:30", orderIndex: 2, beginnerFormat: "BEGINNER_GROUP", examineeStudentIds: ["T1"], beginnerChildCount: 3 }),
    session({ sessionId: "B4", date: "2026-08-03", startTime: "16:00", endTime: "16:30", orderIndex: 0, examineeStudentIds: ["T4"] }),
    session({
      sessionId: "A1",
      kind: "ADVANCED_INSTRUCTION",
      beginnerFormat: null,
      date: "2026-08-02",
      startTime: "17:00",
      endTime: "18:00",
      orderIndex: 0,
      examineeStudentIds: ["T5"],
      instructedTraineeStudentIds: ["T6"],
    }),
  ];
}

// --- ordering ---------------------------------------------------------------

test("by date: every kind together, ordered by startTime, orderIndex, sessionId", () => {
  const rows = projectByDate(fixture(), "2026-08-02");
  assert.deepEqual(rows.map((s) => s.sessionId), ["B1", "B2", "A1", "B3"]);
  // Both kinds appear in one chronological list.
  assert.ok(rows.some((s) => s.kind === "ADVANCED_INSTRUCTION"));
  assert.ok(rows.some((s) => s.kind === "BEGINNER_INSTRUCTION"));
});

test("by date: orderIndex breaks a shared start time deterministically", () => {
  // B1 and B2 share 16:00; only orderIndex separates them.
  const rows = projectByDate(fixture(), "2026-08-02");
  const b1 = rows.findIndex((s) => s.sessionId === "B1");
  const b2 = rows.findIndex((s) => s.sessionId === "B2");
  assert.ok(b1 < b2, "orderIndex must decide the order of equal start times");
});

test("by date: an exact date token match only - no ranges, no calendar math", () => {
  assert.equal(projectByDate(fixture(), "2026-08-04").length, 0);
  assert.equal(projectByDate(fixture(), "2026-08-03").length, 1);
});

test("by exam type: all dates, ordered by date then time then orderIndex", () => {
  const p = projectByExamKind(fixture(), "BEGINNER_INSTRUCTION");
  assert.deepEqual(p.sessions.map((s) => s.sessionId), ["B1", "B2", "B3", "B4"]);
  assert.deepEqual(p.groups.map((g) => g.date), ["2026-08-02", "2026-08-03"]);
  assert.deepEqual(p.groups[0].sessions.map((s) => s.sessionId), ["B1", "B2", "B3"]);
  assert.deepEqual(p.groups[1].sessions.map((s) => s.sessionId), ["B4"]);
});

test("by exam type: the date grouping re-buckets the SAME session objects", () => {
  const p = projectByExamKind(fixture(), "BEGINNER_INSTRUCTION");
  const flat = p.sessions.map((s) => s.sessionId).sort();
  const grouped = p.groups.flatMap((g) => g.sessions.map((s) => s.sessionId)).sort();
  assert.deepEqual(grouped, flat);
  // Object identity, not a copy - grouping is presentation only.
  assert.equal(p.groups[0].sessions[0], p.sessions[0]);
});

test("projections are input-order independent", () => {
  const forward = fixture();
  const reverse = [...fixture()].reverse();
  assert.deepEqual(
    projectByDate(forward, "2026-08-02").map((s) => s.sessionId),
    projectByDate(reverse, "2026-08-02").map((s) => s.sessionId),
  );
  assert.deepEqual(
    projectByExamKind(forward, "BEGINNER_INSTRUCTION").sessions.map((s) => s.sessionId),
    projectByExamKind(reverse, "BEGINNER_INSTRUCTION").sessions.map((s) => s.sessionId),
  );
});

// --- ONE SOURCE OF TRUTH ----------------------------------------------------

test("all three views project the SAME authoritative session ids", () => {
  const sessions = fixture();
  const expected = collectSessionIds(sessions);

  // Union of every by-date projection.
  const viaDates = new Set<string>();
  for (const date of listExamDates(sessions)) {
    for (const s of projectByDate(sessions, date)) viaDates.add(s.sessionId);
  }

  // Union of every by-kind projection.
  const viaKinds = new Set<string>();
  for (const kind of EXAM_KINDS) {
    for (const s of projectByExamKind(sessions, kind).sessions) viaKinds.add(s.sessionId);
  }

  assert.deepEqual([...viaDates].sort(), [...expected]);
  assert.deepEqual([...viaKinds].sort(), [...expected]);

  // The general schedule summarises exactly those same rows.
  const summarised = projectGeneralSchedule(sessions).reduce((n, r) => n + r.sessionCount, 0);
  assert.equal(summarised, expected.length);
});

test("editing ONE session is reflected in all three views with no sync step", () => {
  const before = fixture();
  // The shared editor moves B3 to a new time on a new date.
  const after = before.map((s) =>
    s.sessionId === "B3" ? { ...s, date: "2026-08-03", startTime: "09:00", endTime: "10:00" } : s,
  );

  // 1. by date: gone from the old date, present on the new one.
  assert.ok(!projectByDate(after, "2026-08-02").some((s) => s.sessionId === "B3"));
  assert.equal(projectByDate(after, "2026-08-03")[0].sessionId, "B3");

  // 2. by exam type: re-sorted into the new date group, still the same row.
  const kindView = projectByExamKind(after, "BEGINNER_INSTRUCTION");
  assert.deepEqual(kindView.sessions.map((s) => s.sessionId), ["B1", "B2", "B3", "B4"]);
  assert.deepEqual(kindView.groups.map((g) => g.date), ["2026-08-02", "2026-08-03"]);

  // 3. general schedule: the edited kind's span is recomputed at read time.
  const beginnerRow = (rows: readonly { kind: string; operationalSpanMinutes: number; sessionCount: number }[]) => {
    const row = rows.find((r) => r.kind === "BEGINNER_INSTRUCTION");
    assert.ok(row);
    return row;
  };
  const generalBefore = beginnerRow(projectGeneralSchedule(before));
  const generalAfter = beginnerRow(projectGeneralSchedule(after));
  // 08-02 (16:00->19:30 = 210) + 08-03 (30) = 240, becomes
  // 08-02 (30) + 08-03 (09:00->16:30 = 450) = 480.
  assert.equal(generalBefore.operationalSpanMinutes, 240);
  assert.equal(generalAfter.operationalSpanMinutes, 480);
  assert.equal(generalAfter.sessionCount, generalBefore.sessionCount);

  // The untouched kind is genuinely untouched - no cross-talk between rows.
  const advancedBefore = projectGeneralSchedule(before).find((r) => r.kind === "ADVANCED_INSTRUCTION");
  const advancedAfter = projectGeneralSchedule(after).find((r) => r.kind === "ADVANCED_INSTRUCTION");
  assert.deepEqual(advancedAfter, advancedBefore);
});

// --- general schedule -------------------------------------------------------

test("general rows follow the canonical EXAM_KINDS order and skip empty kinds", () => {
  const rows = projectGeneralSchedule(fixture());
  assert.deepEqual(rows.map((r) => r.kind), ["ADVANCED_INSTRUCTION", "BEGINNER_INSTRUCTION"]);
  // LUNGE_NO_RIDER / INTERFACE_RIDING have no sessions, so they get no row.
  assert.equal(rows.length, 2);
});

test("both total-hours readings are exposed and differ as designed", () => {
  // One date, three back-to-back-ish sessions inside a wider window.
  const sessions = [
    session({ sessionId: "S1", startTime: "16:00", endTime: "16:30" }),
    session({ sessionId: "S2", startTime: "17:00", endTime: "17:30" }),
    session({ sessionId: "S3", startTime: "19:00", endTime: "19:30" }),
  ];
  const row = projectGeneralSchedule(sessions)[0];
  // Sum of durations: 3 x 30 minutes.
  assert.equal(row.totalDurationMinutes, 90);
  // Operational span: 16:00 -> 19:30.
  assert.equal(row.operationalSpanMinutes, 210);
});

test("the operational span is summed PER DATE, not across the whole range", () => {
  const sessions = [
    session({ sessionId: "S1", date: "2026-08-02", startTime: "16:00", endTime: "19:30" }),
    session({ sessionId: "S2", date: "2026-08-03", startTime: "16:00", endTime: "19:30" }),
  ];
  const row = projectGeneralSchedule(sessions)[0];
  // 3.5h + 3.5h = 7h, NOT the 2-day wall-clock distance.
  assert.equal(row.operationalSpanMinutes, 420);
  assert.equal(row.totalDurationMinutes, 420);
  assert.deepEqual(row.dates, ["2026-08-02", "2026-08-03"]);
});

test("trainee counts are DISTINCT across sessions, never summed", () => {
  const rows = projectGeneralSchedule(fixture());
  const beginner = rows.find((r) => r.kind === "BEGINNER_INSTRUCTION");
  assert.ok(beginner);
  // T1 appears in two sessions (B2 and B3) but counts once: T1,T2,T3,T4 = 4.
  assert.equal(beginner.distinctExamineeCount, 4);
  assert.equal(beginner.beginnerChildCount, 3);

  const advanced = rows.find((r) => r.kind === "ADVANCED_INSTRUCTION");
  assert.ok(advanced);
  assert.equal(advanced.distinctExamineeCount, 1);
  assert.equal(advanced.distinctInstructedTraineeCount, 1);
});

test("the beginner format breakdown is available for the EX-C2 display choice", () => {
  const rows = projectGeneralSchedule(fixture());
  const beginner = rows.find((r) => r.kind === "BEGINNER_INSTRUCTION");
  assert.ok(beginner);
  assert.deepEqual(beginner.formatBreakdown, [
    { beginnerFormat: "BEGINNER_GROUP", sessionCount: 1 },
    { beginnerFormat: "LUNGE", sessionCount: 3 },
  ]);
  // Both groupings come from ONE row set - kind alone is the sessionCount.
  assert.equal(beginner.sessionCount, 4);

  // A non-beginner kind carries no format breakdown at all.
  const advanced = rows.find((r) => r.kind === "ADVANCED_INSTRUCTION");
  assert.deepEqual(advanced?.formatBreakdown, []);
});

test("malformed times fail closed to a zero contribution, never NaN", () => {
  const rows = projectGeneralSchedule([
    session({ sessionId: "S1", startTime: "nope", endTime: "16:30" }),
    session({ sessionId: "S2", startTime: "18:00", endTime: "17:00" }),
  ]);
  assert.equal(rows[0].totalDurationMinutes, 0);
  assert.ok(Number.isFinite(rows[0].operationalSpanMinutes));
});

test("empty input yields empty, frozen projections", () => {
  assert.deepEqual(projectGeneralSchedule([]), []);
  assert.deepEqual(projectByDate([], "2026-08-02"), []);
  assert.deepEqual(projectByExamKind([], "LUNGE_NO_RIDER").sessions, []);
  assert.deepEqual(listExamDates([]), []);
  assert.ok(Object.isFrozen(projectGeneralSchedule([])));
});

test("the projections do not mutate their input array or rows", () => {
  const sessions = fixture();
  const snapshot = JSON.parse(JSON.stringify(sessions));
  const order = sessions.map((s) => s.sessionId);

  projectGeneralSchedule(sessions);
  projectByDate(sessions, "2026-08-02");
  projectByExamKind(sessions, "BEGINNER_INSTRUCTION");
  listExamDates(sessions);

  assert.deepEqual(JSON.parse(JSON.stringify(sessions)), snapshot);
  // Sorting happens on internal copies - the caller's array order is intact.
  assert.deepEqual(sessions.map((s) => s.sessionId), order);
});

// ===========================================================================
// EX-S4B — the definition-aware contract
// ===========================================================================

const SOURCE = readFileSync(
  join(import.meta.dirname, "exam-schedule-projection-core.ts"),
  "utf8",
);

/**
 * The core's source with its comments removed. The structural guards below must
 * assert on CODE, not on the prose that documents the very rules they enforce —
 * the file legitimately says "no clock (`Date.now`/`new Date`)" and explains why
 * `EXAM_KIND_LABELS` is not a fallback, and a naive text scan would fire on both.
 */
const SOURCE_CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/** The declared body of `interface ProjectionSession`, for structural checks. */
const PROJECTION_SESSION_BODY = (() => {
  const match = /export interface ProjectionSession \{([\s\S]*?)\n\}/.exec(SOURCE);
  assert.ok(match, "sanity: interface ProjectionSession must be declarable-locatable");
  return match[1];
})();

/** A stored, definition-backed block whose timetable resolved. */
function storedBlock(over: Partial<ProjectionSession> = {}): ProjectionSession {
  return session({
    sessionId: "D1",
    kind: "ADVANCED_INSTRUCTION",
    beginnerFormat: null,
    date: "2026-08-02",
    startTime: "16:00",
    // Deliberately STALE: for a definition-backed block the timetable decides.
    endTime: "17:00",
    definitionId: "def-advanced-1",
    definitionName: "מבחן הדרכה מתקדמת",
    derivedBlockEndTime: "19:00",
    timetableStatus: "OK",
    ...over,
  });
}

/** A live beginner row, exactly as the adapter shapes one. */
function liveBeginnerSession(over: Partial<ProjectionSession> = {}): ProjectionSession {
  return session({
    sessionId: "tp:lesson-1",
    kind: "BEGINNER_INSTRUCTION",
    beginnerFormat: "LUNGE",
    startTime: "16:00",
    endTime: "16:30",
    timetableStatus: "NOT_APPLICABLE",
    ...over,
  });
}

// --- 1. the four optional fields exist and are optional ----------------------

test("ProjectionSession accepts the four new optional fields", () => {
  const full: ProjectionSession = storedBlock();
  assert.equal(full.definitionId, "def-advanced-1");
  assert.equal(full.definitionName, "מבחן הדרכה מתקדמת");
  assert.equal(full.derivedBlockEndTime, "19:00");
  assert.equal(full.timetableStatus, "OK");

  // ...and every one of them is OPTIONAL: a pre-S4B row still type-checks and
  // still projects, which is what makes this slice purely additive.
  const bare: ProjectionSession = session();
  assert.equal(bare.definitionId, undefined);
  assert.equal(bare.definitionName, undefined);
  assert.equal(bare.derivedBlockEndTime, undefined);
  assert.equal(bare.timetableStatus, undefined);

  // The status union is exported and closed to exactly three values.
  const statuses: ProjectionTimetableStatus[] = ["NOT_APPLICABLE", "OK", "UNRESOLVED"];
  assert.equal(statuses.length, 3);
});

// --- 2 & 3. preservation and object identity --------------------------------

test("every projection preserves the four fields, on the SAME row objects", () => {
  const stored = storedBlock();
  const live = liveBeginnerSession();
  const sessions = [stored, live];

  const byDate = projectByDate(sessions, "2026-08-02");
  // Identity, not a copy: the fields cannot drift because there is one object.
  assert.equal(byDate.find((s) => s.sessionId === "D1"), stored);
  assert.equal(byDate.find((s) => s.sessionId === "tp:lesson-1"), live);

  const kindView = projectByExamKind(sessions, "ADVANCED_INSTRUCTION");
  assert.equal(kindView.sessions[0], stored);
  assert.equal(kindView.groups[0].sessions[0], stored);

  for (const row of [...byDate, ...kindView.sessions, ...kindView.groups[0].sessions]) {
    if (row.sessionId !== "D1") continue;
    assert.equal(row.definitionId, "def-advanced-1");
    assert.equal(row.definitionName, "מבחן הדרכה מתקדמת");
    assert.equal(row.derivedBlockEndTime, "19:00");
    assert.equal(row.timetableStatus, "OK");
  }

  // A live beginner row keeps NOT_APPLICABLE and gains no definition fields.
  const liveOut = byDate.find((s) => s.sessionId === "tp:lesson-1");
  assert.ok(liveOut);
  assert.equal(liveOut.timetableStatus, "NOT_APPLICABLE");
  assert.equal(liveOut.definitionId, undefined);
  assert.equal(liveOut.definitionName, undefined);
});

// --- 4-7. the end-time reading ----------------------------------------------

test("a resolved stored block is measured by derivedBlockEndTime, not its stored endTime", () => {
  const row = projectGeneralSchedule([storedBlock()])[0];
  // 16:00 -> 19:00 (the DERIVED end), never 16:00 -> 17:00 (the stored one).
  assert.equal(row.totalDurationMinutes, 180);
  assert.equal(row.operationalSpanMinutes, 180);
  assert.equal(row.lastEndTime, "19:00");
});

test("an unresolved stored block contributes zero, and never falls back to endTime", () => {
  const row = projectGeneralSchedule([
    storedBlock({ derivedBlockEndTime: null, timetableStatus: "UNRESOLVED" }),
  ])[0];
  assert.equal(row.totalDurationMinutes, 0);
  assert.equal(row.operationalSpanMinutes, 0);
  // Not "17:00": an unresolved block has no usable end at all.
  assert.equal(row.lastEndTime, null);
  assert.equal(row.sessionCount, 1, "it is still COUNTED - only its duration is zero");
});

test("an unresolved block cannot widen another block's operational span", () => {
  const row = projectGeneralSchedule([
    storedBlock({ sessionId: "D1", startTime: "16:00", derivedBlockEndTime: "17:00" }),
    storedBlock({
      sessionId: "D2",
      startTime: "08:00",
      endTime: "23:00",
      derivedBlockEndTime: null,
      timetableStatus: "UNRESOLVED",
    }),
  ])[0];
  // Only D1 defines a window: 16:00 -> 17:00. D2 contributes NEITHER endpoint.
  assert.equal(row.operationalSpanMinutes, 60);
  assert.equal(row.totalDurationMinutes, 60);
  assert.equal(row.firstStartTime, "08:00", "firstStartTime is unchanged raw data");
  assert.equal(row.lastEndTime, "17:00");
});

test("a live beginner row is measured by its own real endTime", () => {
  const row = projectGeneralSchedule([liveBeginnerSession()])[0];
  assert.equal(row.totalDurationMinutes, 30);
  assert.equal(row.operationalSpanMinutes, 30);
  assert.equal(row.lastEndTime, "16:30");
});

test("a malformed or missing derived end contributes zero, never NaN", () => {
  for (const derived of ["nope", "", "  ", null, undefined]) {
    const row = projectGeneralSchedule([
      storedBlock({ derivedBlockEndTime: derived, timetableStatus: "OK" }),
    ])[0];
    assert.equal(row.totalDurationMinutes, 0, `derived=${String(derived)}`);
    assert.equal(row.operationalSpanMinutes, 0, `derived=${String(derived)}`);
    assert.ok(Number.isFinite(row.totalDurationMinutes));
    assert.ok(Number.isFinite(row.operationalSpanMinutes));
  }
});

test("a row with no timetableStatus behaves exactly as it did before S4B", () => {
  const before = projectGeneralSchedule([
    session({ sessionId: "S1", startTime: "16:00", endTime: "16:30" }),
  ])[0];
  assert.equal(before.totalDurationMinutes, 30);
  assert.equal(before.operationalSpanMinutes, 30);
  assert.equal(before.lastEndTime, "16:30");
});

// --- 8 & 9. a definition name is NEVER synthesized ---------------------------

test("an occurrence title is never used as a definition name", () => {
  // A row carrying a title but no definition: the projection must not promote
  // it. Titles are an occurrence SUBTITLE; the name comes from ExamDefinition.
  const titled = { ...storedBlock(), definitionId: undefined, definitionName: undefined, title: "מחזור ב" };
  const out = projectByDate([titled as ProjectionSession], "2026-08-02")[0];
  assert.equal(out.definitionName, undefined);
  assert.equal(out.definitionId, undefined);

  // Structurally: the core declares and reads no `title` field whatsoever.
  assert.equal(/\btitle\s*\??\s*:/.test(SOURCE), false, "the core must not model a title");
});

test("EXAM_KIND_LABELS is never a definition-name fallback", () => {
  // Prose about the rule is expected; a runtime dependency is not.
  assert.ok(SOURCE.includes("EXAM_KIND_LABELS"), "sanity: the rule is documented here");
  assert.equal(/from\s+["']\.\/exam-kind-labels["']/.test(SOURCE_CODE), false);
  assert.equal(/EXAM_KIND_LABELS/.test(SOURCE_CODE), false);

  // Behaviourally: a kind-only row gets no name invented for it.
  const out = projectByDate(
    [session({ kind: "LUNGE_NO_RIDER", beginnerFormat: null })],
    "2026-08-02",
  )[0];
  assert.equal(out.definitionName, undefined);
});

// --- 10 & 11. listExamDates ---------------------------------------------------

test("listExamDates unions stored dates with the optional source dates", () => {
  const sessions = fixture();
  // Unchanged when omitted.
  assert.deepEqual(listExamDates(sessions), ["2026-08-02", "2026-08-03"]);
  assert.deepEqual(listExamDates(sessions, undefined), ["2026-08-02", "2026-08-03"]);

  // A source date with no session of its own still appears as a date token.
  assert.deepEqual(listExamDates(sessions, ["2026-07-30", "2026-08-05"]), [
    "2026-07-30",
    "2026-08-02",
    "2026-08-03",
    "2026-08-05",
  ]);

  // ...but it creates no ROWS. Empty dates stay empty.
  assert.deepEqual(projectByDate(sessions, "2026-07-30"), []);
});

test("source dates are deduplicated, sorted and shape-checked", () => {
  const sessions = [session({ date: "2026-08-02" })];
  assert.deepEqual(
    listExamDates(sessions, ["2026-08-05", "2026-08-02", "2026-08-05", " 2026-08-01 "]),
    ["2026-08-01", "2026-08-02", "2026-08-05"],
  );

  // Garbage tokens are dropped rather than sorted into the picker.
  assert.deepEqual(
    listExamDates(sessions, ["", "  ", "not-a-date", "2026-8-5", "20260805"]),
    ["2026-08-02"],
  );
  assert.deepEqual(listExamDates([], []), []);
  assert.ok(Object.isFrozen(listExamDates(sessions, ["2026-08-05"])));
});

// --- 12. no calendar arithmetic ----------------------------------------------

test("the core constructs no Date and performs no calendar arithmetic", () => {
  for (const forbidden of [
    /new\s+Date\b/,
    /\bDate\.now\b/,
    /\bDate\.parse\b/,
    /\bDate\.UTC\b/,
    /\.getTime\(/,
    /\.toISOString\(/,
    /\bgetFullYear\b/,
    /\bsetDate\b/,
    /\bIntl\b/,
  ]) {
    assert.equal(
      forbidden.test(SOURCE_CODE),
      false,
      `the core must not use ${forbidden}`,
    );
  }
});

// --- 15 & 16. immutability and frozen output ---------------------------------

test("the new fields do not mutate the input rows", () => {
  const sessions = [storedBlock(), liveBeginnerSession()];
  const snapshot = JSON.parse(JSON.stringify(sessions));

  projectGeneralSchedule(sessions);
  projectByDate(sessions, "2026-08-02");
  projectByExamKind(sessions, "ADVANCED_INSTRUCTION");
  listExamDates(sessions, ["2026-08-09"]);
  collectSessionIds(sessions);

  assert.deepEqual(JSON.parse(JSON.stringify(sessions)), snapshot);
  // No field was added to, removed from or nulled on a caller's row.
  assert.deepEqual(Object.keys(sessions[1]).includes("definitionId"), false);
});

test("every projection still returns frozen results", () => {
  const sessions = [storedBlock(), liveBeginnerSession()];
  assert.ok(Object.isFrozen(projectGeneralSchedule(sessions)));
  assert.ok(Object.isFrozen(projectGeneralSchedule(sessions)[0]));
  assert.ok(Object.isFrozen(projectByDate(sessions, "2026-08-02")));
  assert.ok(Object.isFrozen(listExamDates(sessions)));
  assert.ok(Object.isFrozen(listExamDates(sessions, ["2026-08-09"])));
  assert.ok(Object.isFrozen(collectSessionIds(sessions)));

  const kindView = projectByExamKind(sessions, "ADVANCED_INSTRUCTION");
  assert.ok(Object.isFrozen(kindView));
  assert.ok(Object.isFrozen(kindView.sessions));
  assert.ok(Object.isFrozen(kindView.groups));
  assert.ok(Object.isFrozen(kindView.groups[0]));
  assert.ok(Object.isFrozen(kindView.groups[0].sessions));
});

// --- 17. projectByExamKind is NOT redesigned in this slice --------------------

test("projectByExamKind still groups by ExamKind - definition grouping is S4C", () => {
  const p = projectByExamKind(fixture(), "BEGINNER_INSTRUCTION");
  assert.deepEqual(Object.keys(p).sort(), ["groups", "kind", "sessions"]);
  assert.deepEqual(p.sessions.map((s) => s.sessionId), ["B1", "B2", "B3", "B4"]);
  assert.deepEqual(p.groups.map((g) => g.date), ["2026-08-02", "2026-08-03"]);
  assert.deepEqual(Object.keys(p.groups[0]).sort(), ["date", "sessions"]);

  // Two blocks of the same kind under DIFFERENT definitions are still one kind
  // bucket, unsplit and unreordered by definition.
  const mixed = [
    storedBlock({ sessionId: "D1", definitionId: "def-b", orderIndex: 0 }),
    storedBlock({ sessionId: "D2", definitionId: "def-a", orderIndex: 1 }),
  ];
  const view = projectByExamKind(mixed, "ADVANCED_INSTRUCTION");
  assert.equal(view.groups.length, 1);
  assert.deepEqual(view.sessions.map((s) => s.sessionId), ["D1", "D2"]);

  // No definition-grouping entry point has been introduced yet.
  assert.equal(SOURCE_CODE.includes("projectByExamGroup"), false);
});

// --- 18. the compact row stays compact ---------------------------------------

test("no slot, wave, detail or retired field was added to ProjectionSession", () => {
  for (const field of [
    "slots",
    "waves",
    "issues",
    "warnings",
    "timetableIssues",
    "timetableWarnings",
    "isSelf",
    "phase",
    "interfaceSessionId",
    "detail",
    "definition",
    "assignments",
  ]) {
    const declared = new RegExp(`^\\s*(readonly\\s+)?${field}\\s*\\??\\s*:`, "m");
    assert.equal(
      declared.test(PROJECTION_SESSION_BODY),
      false,
      `ProjectionSession must not declare "${field}" - detail belongs in a sibling payload`,
    );
  }

  // Exactly the four new optional scalars, and nothing else, were added.
  const optional = [...PROJECTION_SESSION_BODY.matchAll(/^\s*readonly\s+(\w+)\?:/gm)].map(
    (m) => m[1],
  );
  assert.deepEqual(optional.sort(), [
    "definitionId",
    "definitionName",
    "derivedBlockEndTime",
    "timetableStatus",
  ]);
});
