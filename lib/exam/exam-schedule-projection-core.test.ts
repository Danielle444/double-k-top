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
import {
  projectGeneralSchedule,
  projectByDate,
  projectByExamKind,
  listExamDates,
  collectSessionIds,
  type ProjectionSession,
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
