/**
 * EXAM EX-S4C — executable tests for the PURE definition-grouping core
 * (exam-group-projection-core.ts).
 *
 * Run with: npx tsx --test lib/exam/exam-group-projection-core.test.ts
 * PURE: no Prisma, no DB, no clock, no randomness, no auth, no cookie, no env.
 *
 * SCOPE OF PROOF: that the group identity is `ExamDefinition.id` and NOTHING
 * else (not the name, not the kind, not a title); that two definitions sharing a
 * kind stay two groups; that contradictory or unidentifiable rows fail closed
 * with observable issues instead of being guessed at; that the live beginner
 * rows form exactly one group under the locked label; the locked group and
 * session ordering; object identity, immutability and freezing; and that
 * `projectByExamKind` is neither wrapped nor imported by the new core.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  projectByExamDefinition,
  serializeExamGroupKey,
  EXAM_BEGINNER_GROUP_LABEL,
  EXAM_GROUP_MESSAGES,
  type ExamGroupKey,
  type ExamScheduleGroup,
} from "./exam-group-projection-core";
import {
  projectByExamKind,
  type ProjectionSession,
} from "./exam-schedule-projection-core";
import { EXAM_KINDS } from "./exam-domain-core";
import { EXAM_KIND_LABELS } from "./exam-kind-labels";

const CORE_PATH = join(import.meta.dirname, "exam-group-projection-core.ts");
const CORE_SOURCE = readFileSync(CORE_PATH, "utf8");

/**
 * The core's source with its comments removed. The structural guards must assert
 * on CODE, not on the prose documenting the very rules they enforce — the file
 * legitimately explains why `EXAM_KIND_LABELS`, titles, `projectByExamKind` and
 * `Date` are excluded, and a naive text scan would fire on every explanation.
 */
const CORE_CODE = CORE_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

function session(over: Partial<ProjectionSession> = {}): ProjectionSession {
  return {
    sessionId: "S1",
    kind: "INTERFACE_RIDING",
    beginnerFormat: null,
    date: "2026-08-02",
    startTime: "16:00",
    endTime: "17:00",
    orderIndex: 0,
    examineeStudentIds: [],
    instructedTraineeStudentIds: [],
    beginnerChildCount: 0,
    ...over,
  };
}

/** A stored, definition-backed block. */
function stored(over: Partial<ProjectionSession> = {}): ProjectionSession {
  return session({
    definitionId: "def-riding",
    definitionName: "רכיבה",
    derivedBlockEndTime: "19:00",
    timetableStatus: "OK",
    ...over,
  });
}

/** A live Teaching-Practice beginner row: no definition, ever. */
function beginner(over: Partial<ProjectionSession> = {}): ProjectionSession {
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

function labels(groups: readonly ExamScheduleGroup[]): string[] {
  return groups.map((g) => g.label);
}

// ===========================================================================
// 1-4. Definition identity — the whole point of this slice
// ===========================================================================

test("1. two distinct INTERFACE_RIDING definitions produce TWO groups", () => {
  const { groups, issues } = projectByExamDefinition([
    stored({ sessionId: "A", definitionId: "def-1", definitionName: "רכיבה" }),
    stored({ sessionId: "B", definitionId: "def-2", definitionName: "ממשק" }),
  ]);
  assert.deepEqual(issues, []);
  assert.equal(groups.length, 2, "one kind must never collapse two definitions");
  assert.deepEqual(
    groups.map((g) => g.definitionId).sort(),
    ["def-1", "def-2"],
  );
  // Both really are the same kind — this is not an accident of differing kinds.
  assert.ok(groups.every((g) => g.kind === "INTERFACE_RIDING"));
});

test("2. the groups named רכיבה and ממשק remain distinct and keep their own labels", () => {
  const { groups } = projectByExamDefinition([
    stored({ sessionId: "A", definitionId: "def-riding", definitionName: "רכיבה" }),
    stored({ sessionId: "B", definitionId: "def-interface", definitionName: "ממשק" }),
  ]);
  const byLabel = new Map(groups.map((g) => [g.label, g]));
  assert.equal(byLabel.get("רכיבה")?.definitionId, "def-riding");
  assert.equal(byLabel.get("ממשק")?.definitionId, "def-interface");
  // Neither is relabelled to the shared kind label.
  assert.ok(!labels(groups).includes(EXAM_KIND_LABELS.INTERFACE_RIDING));
});

test("3. the grouping key is definitionId — same name+kind, different ids stay apart", () => {
  const { groups } = projectByExamDefinition([
    stored({ sessionId: "A", definitionId: "def-1", definitionName: "רכיבה" }),
    stored({ sessionId: "B", definitionId: "def-2", definitionName: "רכיבה" }),
  ]);
  assert.equal(groups.length, 2);
  for (const g of groups) {
    assert.equal(g.key.type, "DEFINITION");
    assert.equal(g.key.type === "DEFINITION" ? g.key.definitionId : null, g.definitionId);
  }
});

test("4. one definitionId across several rows is ONE group", () => {
  const { groups, issues } = projectByExamDefinition([
    stored({ sessionId: "A", definitionId: "def-1", date: "2026-08-02" }),
    stored({ sessionId: "B", definitionId: "def-1", date: "2026-08-03" }),
    stored({ sessionId: "C", definitionId: "def-1", date: "2026-08-04" }),
  ]);
  assert.deepEqual(issues, []);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].sessions.map((s) => s.sessionId), ["A", "B", "C"]);
});

// ===========================================================================
// 5-6. Contradictions
// ===========================================================================

test("5. the same definitionId with contradictory NAMES is reported, not guessed", () => {
  const { groups, issues } = projectByExamDefinition([
    stored({ sessionId: "A", definitionId: "def-1", definitionName: "רכיבה" }),
    stored({ sessionId: "B", definitionId: "def-1", definitionName: "ממשק" }),
  ]);
  assert.deepEqual(groups, [], "an unresolvable identity must render nothing");
  assert.deepEqual(issues.map((i) => i.code), [
    "EX-GRP-DEFINITION-NAME-CONFLICT",
    "EX-GRP-DEFINITION-NAME-CONFLICT",
  ]);
  assert.deepEqual(issues.map((i) => i.sessionId), ["A", "B"]);
  // Neither competing name silently won.
  assert.ok(!labels(groups).includes("רכיבה"));
  assert.ok(!labels(groups).includes("ממשק"));
});

test("6. the same definitionId with contradictory KINDS is reported", () => {
  const { groups, issues } = projectByExamDefinition([
    stored({ sessionId: "A", definitionId: "def-1", kind: "INTERFACE_RIDING" }),
    stored({ sessionId: "B", definitionId: "def-1", kind: "LUNGE_NO_RIDER" }),
  ]);
  assert.deepEqual(groups, []);
  assert.deepEqual(issues.map((i) => i.code), [
    "EX-GRP-DEFINITION-KIND-CONFLICT",
    "EX-GRP-DEFINITION-KIND-CONFLICT",
  ]);
  assert.ok(issues.every((i) => i.definitionId === "def-1"));
});

test("6b. a conflicting id fails closed WITHOUT harming an unrelated valid group", () => {
  const { groups, issues } = projectByExamDefinition([
    stored({ sessionId: "A", definitionId: "def-1", definitionName: "רכיבה" }),
    stored({ sessionId: "B", definitionId: "def-1", definitionName: "ממשק" }),
    stored({ sessionId: "C", definitionId: "def-2", definitionName: "לונג" }),
  ]);
  assert.deepEqual(labels(groups), ["לונג"]);
  assert.equal(issues.length, 2);
});

// ===========================================================================
// 7-10. Invalid rows fail closed
// ===========================================================================

test("7. a blank/absent definitionId is rejected", () => {
  for (const bad of [undefined, null, "", "   "]) {
    const { groups, issues } = projectByExamDefinition([
      stored({ sessionId: "A", definitionId: bad }),
    ]);
    assert.deepEqual(groups, [], `definitionId ${JSON.stringify(bad)} must not group`);
    assert.deepEqual(issues.map((i) => i.code), ["EX-GRP-DEFINITION-ID-REQUIRED"]);
    assert.equal(issues[0].sessionId, "A");
    assert.equal(issues[0].definitionId, null);
  }
});

test("8. a blank/absent definitionName is rejected — no group under a guessed name", () => {
  for (const bad of [undefined, null, "", "   "]) {
    const { groups, issues } = projectByExamDefinition([
      stored({ sessionId: "A", definitionId: "def-1", definitionName: bad }),
    ]);
    assert.deepEqual(groups, []);
    assert.deepEqual(issues.map((i) => i.code), ["EX-GRP-DEFINITION-NAME-REQUIRED"]);
    assert.equal(issues[0].definitionId, "def-1");
  }
});

test("9. a STORED BEGINNER_INSTRUCTION row is rejected — beginner is never storable", () => {
  // A beginner row that presents as stored (it carries definition identity) is
  // contradictory: BEGINNER_INSTRUCTION is not a storable kind at all.
  const { groups, issues } = projectByExamDefinition([
    beginner({ sessionId: "X", definitionId: "def-1", definitionName: "מתחילים" }),
  ]);
  assert.deepEqual(groups, [], "a stored beginner row must produce no group");
  assert.deepEqual(issues.map((i) => i.code), ["EX-GRP-BEGINNER-DEFINITION-FORBIDDEN"]);
  // And the kind itself is outside the storable set, by construction.
  assert.ok(!["INTERFACE_RIDING", "LUNGE_NO_RIDER", "ADVANCED_INSTRUCTION"].includes(
    "BEGINNER_INSTRUCTION",
  ));
});

test("10. a beginner row carrying EITHER definitionId or definitionName is rejected", () => {
  const onlyId = projectByExamDefinition([beginner({ sessionId: "X", definitionId: "def-1" })]);
  assert.deepEqual(onlyId.groups, []);
  assert.deepEqual(onlyId.issues.map((i) => i.code), ["EX-GRP-BEGINNER-DEFINITION-FORBIDDEN"]);
  assert.equal(onlyId.issues[0].definitionId, "def-1");

  const onlyName = projectByExamDefinition([beginner({ sessionId: "Y", definitionName: "רכיבה" })]);
  assert.deepEqual(onlyName.groups, []);
  assert.deepEqual(onlyName.issues.map((i) => i.code), ["EX-GRP-BEGINNER-DEFINITION-FORBIDDEN"]);
  assert.equal(onlyName.issues[0].definitionId, null);
});

test("10b. an out-of-domain kind is rejected with the kind-invalid code", () => {
  const garbage = { ...stored({ sessionId: "A" }), kind: "NOT_A_KIND" } as unknown as
    ProjectionSession;
  const { groups, issues } = projectByExamDefinition([garbage]);
  assert.deepEqual(groups, []);
  assert.deepEqual(issues.map((i) => i.code), ["EX-GRP-DEFINITION-KIND-INVALID"]);
});

test("10c. no UNASSIGNED / other / fallback group is ever invented", () => {
  const { groups } = projectByExamDefinition([
    stored({ sessionId: "A", definitionId: null }),
    stored({ sessionId: "B", definitionName: null }),
    beginner({ sessionId: "C", definitionId: "def-1" }),
  ]);
  assert.deepEqual(groups, []);
  assert.equal(/UNASSIGNED/i.test(CORE_CODE), false, "no unassigned group is ever constructed");
});

// ===========================================================================
// 11-13. The live beginner group
// ===========================================================================

test("11. all valid beginner rows form EXACTLY ONE group", () => {
  const { groups, issues } = projectByExamDefinition([
    beginner({ sessionId: "tp:1", date: "2026-08-02" }),
    beginner({ sessionId: "tp:2", date: "2026-08-03" }),
    beginner({ sessionId: "tp:3", date: "2026-08-04" }),
  ]);
  assert.deepEqual(issues, []);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].key.type, "BEGINNER");
  assert.equal(groups[0].definitionId, null, "only the beginner group has a null id");
  assert.equal(groups[0].sessions.length, 3);
});

test("12. beginner rows are NOT split by beginnerFormat", () => {
  const { groups } = projectByExamDefinition([
    beginner({ sessionId: "tp:1", beginnerFormat: "LUNGE" }),
    beginner({ sessionId: "tp:2", beginnerFormat: "BEGINNER_PRIVATE" }),
    beginner({ sessionId: "tp:3", beginnerFormat: "BEGINNER_GROUP" }),
  ]);
  assert.equal(groups.length, 1, "the format is a lesson attribute, not an exam");
  assert.equal(groups[0].sessions.length, 3);
});

test("13. the beginner label is exactly התנסויות מתחילים", () => {
  const { groups } = projectByExamDefinition([beginner()]);
  assert.equal(groups[0].label, "התנסויות מתחילים");
  assert.equal(EXAM_BEGINNER_GROUP_LABEL, "התנסויות מתחילים");
  // NOT the generic kind label.
  assert.notEqual(groups[0].label, EXAM_KIND_LABELS.BEGINNER_INSTRUCTION);
});

test("13b. definitionId is null ONLY for the beginner group", () => {
  const { groups } = projectByExamDefinition([
    stored({ sessionId: "A", definitionId: "def-1", definitionName: "רכיבה" }),
    beginner({ sessionId: "tp:1" }),
  ]);
  for (const g of groups) {
    assert.equal(g.definitionId === null, g.key.type === "BEGINNER");
  }
});

// ===========================================================================
// 14-15. Group ordering
// ===========================================================================

test("14. group ordering follows the canonical ExamKind order", () => {
  const { groups } = projectByExamDefinition([
    beginner({ sessionId: "tp:1" }),
    stored({ sessionId: "C", kind: "ADVANCED_INSTRUCTION", definitionId: "d3", definitionName: "ג" }),
    stored({ sessionId: "A", kind: "INTERFACE_RIDING", definitionId: "d1", definitionName: "א" }),
    stored({ sessionId: "B", kind: "LUNGE_NO_RIDER", definitionId: "d2", definitionName: "ב" }),
  ]);
  assert.deepEqual(groups.map((g) => g.kind), [
    "INTERFACE_RIDING",
    "LUNGE_NO_RIDER",
    "ADVANCED_INSTRUCTION",
    "BEGINNER_INSTRUCTION",
  ]);
  // That IS the canonical list, and beginner is last because it is last there.
  assert.deepEqual(groups.map((g) => g.kind), [...EXAM_KINDS]);
  assert.equal(groups[groups.length - 1].key.type, "BEGINNER");
});

test("15. groups sharing a kind sort by name, then by definitionId", () => {
  const { groups } = projectByExamDefinition([
    stored({ sessionId: "C", definitionId: "d-z", definitionName: "בבב" }),
    stored({ sessionId: "A", definitionId: "d-b", definitionName: "אאא" }),
    stored({ sessionId: "B", definitionId: "d-a", definitionName: "אאא" }),
  ]);
  assert.deepEqual(groups.map((g) => [g.label, g.definitionId]), [
    ["אאא", "d-a"],
    ["אאא", "d-b"],
    ["בבב", "d-z"],
  ]);
});

test("15b. ordering is not locale-sensitive — plain code-point comparison", () => {
  assert.equal(/localeCompare|Intl\b/.test(CORE_CODE), false);
});

// ===========================================================================
// 16-17. Session and date-group ordering
// ===========================================================================

test("16. sessions inside a group sort by date, startTime, orderIndex, sessionId", () => {
  const { groups } = projectByExamDefinition([
    stored({ sessionId: "S4", date: "2026-08-03", startTime: "09:00", orderIndex: 0 }),
    stored({ sessionId: "S3", date: "2026-08-02", startTime: "16:00", orderIndex: 1 }),
    stored({ sessionId: "S2", date: "2026-08-02", startTime: "16:00", orderIndex: 0 }),
    stored({ sessionId: "S1", date: "2026-08-02", startTime: "16:00", orderIndex: 0 }),
    stored({ sessionId: "S0", date: "2026-08-02", startTime: "08:00", orderIndex: 9 }),
  ]);
  assert.deepEqual(groups[0].sessions.map((s) => s.sessionId), [
    "S0", // earliest time on the earliest date
    "S1", // shares 16:00/orderIndex 0 with S2 — sessionId decides
    "S2",
    "S3", // orderIndex 1
    "S4", // later date
  ]);
});

test("16b. that order is exactly the projection core's locked across-date order", () => {
  const rows = [
    stored({ sessionId: "S4", date: "2026-08-03", startTime: "09:00", orderIndex: 0 }),
    stored({ sessionId: "S3", date: "2026-08-02", startTime: "16:00", orderIndex: 1 }),
    stored({ sessionId: "S2", date: "2026-08-02", startTime: "16:00", orderIndex: 0 }),
    stored({ sessionId: "S0", date: "2026-08-02", startTime: "08:00", orderIndex: 9 }),
  ];
  // Same rows, one definition and one kind: the two orderings must agree.
  const viaDefinition = projectByExamDefinition(rows).groups[0];
  const viaKind = projectByExamKind(rows, "INTERFACE_RIDING");
  assert.deepEqual(
    viaDefinition.sessions.map((s) => s.sessionId),
    viaKind.sessions.map((s) => s.sessionId),
  );
  assert.deepEqual(
    viaDefinition.dateGroups.map((g) => g.date),
    viaKind.groups.map((g) => g.date),
  );
});

test("17. dateGroups hold the EXACT same ProjectionSession object references", () => {
  const a = stored({ sessionId: "A", date: "2026-08-02" });
  const b = stored({ sessionId: "B", date: "2026-08-03" });
  const { groups } = projectByExamDefinition([b, a]);
  const group = groups[0];

  assert.deepEqual(group.dateGroups.map((g) => g.date), ["2026-08-02", "2026-08-03"]);
  // Reference identity, not deep equality: there is no copied session model.
  assert.equal(group.sessions[0], a);
  assert.equal(group.sessions[1], b);
  assert.equal(group.dateGroups[0].sessions[0], a);
  assert.equal(group.dateGroups[1].sessions[0], b);

  // The flat list and the date buckets are the same rows, not two row sets.
  const flat = group.dateGroups.flatMap((g) => [...g.sessions]);
  assert.deepEqual(flat, [...group.sessions]);
});

test("17b. date groups ascend by the exact date token — no calendar math", () => {
  const { groups } = projectByExamDefinition([
    stored({ sessionId: "C", date: "2026-12-01" }),
    stored({ sessionId: "A", date: "2026-08-02" }),
    stored({ sessionId: "B", date: "2026-09-30" }),
  ]);
  assert.deepEqual(groups[0].dateGroups.map((g) => g.date), [
    "2026-08-02",
    "2026-09-30",
    "2026-12-01",
  ]);
});

// ===========================================================================
// 18-20. Determinism, immutability, freezing
// ===========================================================================

test("18. the result is independent of input order", () => {
  const rows = [
    stored({ sessionId: "A", definitionId: "d1", definitionName: "רכיבה", date: "2026-08-02" }),
    stored({ sessionId: "B", definitionId: "d2", definitionName: "ממשק", date: "2026-08-03" }),
    stored({ sessionId: "C", definitionId: "d1", definitionName: "רכיבה", date: "2026-08-04" }),
    beginner({ sessionId: "tp:1" }),
    stored({ sessionId: "D", definitionId: null }),
  ];
  const shape = (rs: ProjectionSession[]) => {
    const { groups, issues } = projectByExamDefinition(rs);
    return {
      groups: groups.map((g) => ({
        key: g.serializedKey,
        label: g.label,
        sessions: g.sessions.map((s) => s.sessionId),
        dates: g.dateGroups.map((d) => d.date),
      })),
      issues: issues.map((i) => `${i.code}:${i.sessionId}`),
    };
  };
  const forward = shape([...rows]);
  const reverse = shape([...rows].reverse());
  const rotated = shape([...rows.slice(2), ...rows.slice(0, 2)]);
  assert.deepEqual(reverse, forward);
  assert.deepEqual(rotated, forward);
});

test("19. the input array and the input rows are never mutated", () => {
  const rows = [
    stored({ sessionId: "B", date: "2026-08-03" }),
    stored({ sessionId: "A", date: "2026-08-02" }),
    beginner({ sessionId: "tp:1", definitionId: "def-x" }),
  ];
  const before = JSON.stringify(rows);
  const orderBefore = rows.map((s) => s.sessionId);

  projectByExamDefinition(rows);

  assert.equal(JSON.stringify(rows), before, "no row field may change");
  assert.deepEqual(rows.map((s) => s.sessionId), orderBefore, "the array must not be re-sorted");
});

test("20. every result object, group, array and issue is frozen", () => {
  const result = projectByExamDefinition([
    stored({ sessionId: "A", definitionId: "d1", definitionName: "רכיבה" }),
    beginner({ sessionId: "tp:1" }),
    stored({ sessionId: "D", definitionId: null }),
  ]);

  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.groups));
  assert.ok(Object.isFrozen(result.issues));
  assert.ok(result.issues.every((i) => Object.isFrozen(i)));
  assert.ok(result.groups.length > 0 && result.issues.length > 0, "sanity: both are non-empty");

  for (const group of result.groups) {
    assert.ok(Object.isFrozen(group));
    assert.ok(Object.isFrozen(group.key));
    assert.ok(Object.isFrozen(group.sessions));
    assert.ok(Object.isFrozen(group.dateGroups));
    for (const dateGroup of group.dateGroups) {
      assert.ok(Object.isFrozen(dateGroup));
      assert.ok(Object.isFrozen(dateGroup.sessions));
    }
  }

  // Frozen means frozen: a write throws in this strict ESM module.
  assert.throws(() => {
    (result.groups as ExamScheduleGroup[]).push(result.groups[0]);
  });
  assert.equal(EXAM_GROUP_MESSAGES && Object.isFrozen(EXAM_GROUP_MESSAGES), true);
});

// ===========================================================================
// 21-22. serializeExamGroupKey
// ===========================================================================

test("21. serializeExamGroupKey yields def:<id> and beginner", () => {
  assert.equal(serializeExamGroupKey({ type: "DEFINITION", definitionId: "abc123" }), "def:abc123");
  assert.equal(serializeExamGroupKey({ type: "BEGINNER" }), "beginner");

  const { groups } = projectByExamDefinition([
    stored({ sessionId: "A", definitionId: "abc123", definitionName: "רכיבה" }),
    beginner({ sessionId: "tp:1" }),
  ]);
  assert.deepEqual(groups.map((g) => g.serializedKey), ["def:abc123", "beginner"]);
  // Each group's serializedKey really is the serialization of its own key.
  for (const g of groups) assert.equal(g.serializedKey, serializeExamGroupKey(g.key));
});

test("22. a blank or invalid group key fails closed to null", () => {
  for (const bad of ["", "   "]) {
    assert.equal(serializeExamGroupKey({ type: "DEFINITION", definitionId: bad }), null);
  }
  for (const bad of [null, undefined, "beginner", 7, { type: "OTHER" }, { definitionId: "x" }]) {
    assert.equal(serializeExamGroupKey(bad as unknown as ExamGroupKey), null);
  }
  // A bare `def:` is never emitted — it would collide across every bad key.
  assert.notEqual(serializeExamGroupKey({ type: "DEFINITION", definitionId: " " }), "def:");
});

test("22b. a definition token never collides with the beginner token", () => {
  assert.notEqual(
    serializeExamGroupKey({ type: "DEFINITION", definitionId: "beginner" }),
    serializeExamGroupKey({ type: "BEGINNER" }),
  );
});

// ===========================================================================
// 23-24. Forbidden identity fallbacks
// ===========================================================================

test("23. an occurrence title is never used as identity or as a label fallback", () => {
  const titled = {
    ...stored({ sessionId: "A", definitionId: "d1", definitionName: "רכיבה" }),
    title: "מחזור ב׳ בוקר",
  } as unknown as ProjectionSession;
  const { groups } = projectByExamDefinition([titled]);
  assert.equal(groups[0].label, "רכיבה", "the definition name wins over any title");

  // A row missing its name is NOT rescued by its title.
  const untitledFallback = {
    ...stored({ sessionId: "B", definitionId: "d2", definitionName: null }),
    title: "מחזור ב׳ בוקר",
  } as unknown as ProjectionSession;
  const bad = projectByExamDefinition([untitledFallback]);
  assert.deepEqual(bad.groups, []);
  assert.deepEqual(bad.issues.map((i) => i.code), ["EX-GRP-DEFINITION-NAME-REQUIRED"]);

  // And the core does not model a title at all.
  assert.equal(/\btitle\b/.test(CORE_CODE), false, "the core must not read a title");
});

test("24. EXAM_KIND_LABELS is never a definitionName fallback", () => {
  // Not imported by the core at all — it cannot be a fallback.
  assert.equal(/EXAM_KIND_LABELS/.test(CORE_CODE), false);
  assert.equal(/exam-kind-labels/.test(CORE_CODE), false);

  const { groups } = projectByExamDefinition([
    stored({ sessionId: "A", definitionId: "d1", definitionName: null }),
  ]);
  assert.deepEqual(groups, []);
  // Sanity: that label exists and is exactly what must NOT appear.
  assert.equal(EXAM_KIND_LABELS.INTERFACE_RIDING, "ממשק ורכיבה");
});

// ===========================================================================
// 25-26. Source purity and payload minimality
// ===========================================================================

test("25. the core is DB-free, clock-free, env-free and IO-free", () => {
  for (const banned of [
    /\bnew Date\b/,
    /\bDate\.now\b/,
    /\bMath\.random\b/,
    /\bprisma\b/i,
    /@prisma\/client/,
    /\bprocess\.env\b/,
    /\bfetch\s*\(/,
    /\bnode:fs\b/,
    /\breadFileSync\b/,
    /\bcookies\s*\(/,
    /\bheaders\s*\(/,
    /"use server"/,
    /\brequire\s*\(/,
  ]) {
    assert.equal(banned.test(CORE_CODE), false, `banned in the core: ${banned}`);
  }
});

test("25b. the core imports ONLY the two approved pure siblings", () => {
  const imports = [...CORE_CODE.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(
    [...new Set(imports)].sort(),
    ["./exam-domain-core", "./exam-schedule-projection-core"],
  );
  // The conflict core is explicitly out of scope for this slice.
  assert.equal(/exam-conflict-core/.test(CORE_CODE), false);
});

test("26. no slot / wave / assignment / child / isSelf / diagnostic payload is added", () => {
  for (const banned of [
    /\bslot/i,
    /\bwave/i,
    /\bisSelf\b/,
    /\bcontact/i,
    /\bphone/i,
    /\bchildName\b/,
    /\bphase\b/i,
    /\binterfaceSessionId\b/,
  ]) {
    assert.equal(banned.test(CORE_CODE), false, `banned in the core: ${banned}`);
  }

  // The group carries exactly the agreed keys and nothing else.
  const { groups } = projectByExamDefinition([stored({ sessionId: "A" })]);
  assert.deepEqual(Object.keys(groups[0]).sort(), [
    "dateGroups",
    "definitionId",
    "key",
    "kind",
    "label",
    "serializedKey",
    "sessions",
  ]);
  assert.deepEqual(Object.keys(groups[0].dateGroups[0]).sort(), ["date", "sessions"]);
});

// ===========================================================================
// 8 (contract). projectByExamKind is neither imported nor wrapped
// ===========================================================================

test("contract: the core does NOT import or wrap projectByExamKind", () => {
  // Asserted on CODE: the header comment explains at length why this core sits
  // BESIDE projectByExamKind, and that prose must stay allowed.
  assert.equal(/projectByExamKind/.test(CORE_CODE), false, "never called or re-exported");
  assert.equal(/ByExamKindProjection/.test(CORE_CODE), false);
  // Only the TYPE is taken from the projection core; no function is.
  assert.ok(
    /import type \{[^}]*\} from "\.\/exam-schedule-projection-core"/.test(CORE_CODE),
    "the projection core must be a TYPE-only import",
  );
  assert.equal(
    /import \{[^}]*\} from "\.\/exam-schedule-projection-core"/.test(CORE_CODE),
    false,
    "no value import from the projection core",
  );
});

test("contract: the new grouping does NOT merge definitions sharing one kind", () => {
  const rows = [
    stored({ sessionId: "A", definitionId: "d1", definitionName: "רכיבה" }),
    stored({ sessionId: "B", definitionId: "d2", definitionName: "ממשק" }),
  ];
  // The legacy kind projection returns ONE bucket for both...
  assert.equal(projectByExamKind(rows, "INTERFACE_RIDING").sessions.length, 2);
  // ...and the definition grouping deliberately does not.
  assert.equal(projectByExamDefinition(rows).groups.length, 2);
});

// ===========================================================================
// Totality
// ===========================================================================

test("totality: empty and malformed input yield an empty, frozen result", () => {
  const empty = projectByExamDefinition([]);
  assert.deepEqual(empty.groups, []);
  assert.deepEqual(empty.issues, []);
  assert.ok(Object.isFrozen(empty));

  const junk = projectByExamDefinition([
    null as unknown as ProjectionSession,
    undefined as unknown as ProjectionSession,
  ]);
  assert.deepEqual(junk.groups, []);
  assert.deepEqual(junk.issues, []);
});

test("totality: every issue code carries a non-empty Hebrew message", () => {
  for (const [code, message] of Object.entries(EXAM_GROUP_MESSAGES)) {
    assert.ok(message.trim().length > 0, `${code} needs a message`);
    assert.ok(/[֐-׿]/.test(message), `${code} must be Hebrew`);
  }
});

test("totality: whitespace around a definition id/name is normalized, not identity", () => {
  const { groups, issues } = projectByExamDefinition([
    stored({ sessionId: "A", definitionId: "d1", definitionName: "רכיבה" }),
    stored({ sessionId: "B", definitionId: " d1 ", definitionName: " רכיבה " }),
  ]);
  assert.deepEqual(issues, [], "trailing whitespace must not read as a contradiction");
  assert.equal(groups.length, 1);
  assert.equal(groups[0].definitionId, "d1");
  assert.equal(groups[0].label, "רכיבה");
});
