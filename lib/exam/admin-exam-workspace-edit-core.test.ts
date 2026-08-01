/**
 * EXAM EX-ADMIN-WORKSPACE-UX — the runtime suite of the pure workspace edit/move
 * core.
 *
 * It drives the pure functions directly and the two orchestrations through
 * FAKES, so nothing here opens a database, reads an environment variable or
 * touches the network. The last two tests prove that property of the module
 * under test rather than merely asserting it in prose.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  normalizeExamAssignmentEditInput,
  decideExamAssignmentMove,
  isExamAssignmentMoveDirection,
  updateExamAssignmentDetailsWithDeps,
  moveExamAssignmentWithDeps,
  EXAM_ASSIGNMENT_EDIT_INPUT_MESSAGES,
  makeExamAssignmentEditInputIssue,
  type ExistingExamAssignmentForEdit,
  type MovableExamAssignmentRow,
  type UpdateExamAssignmentDetailsDeps,
  type MoveExamAssignmentDeps,
} from "./admin-exam-workspace-edit-core";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const MODULE_REL = join("lib", "exam", "admin-exam-workspace-edit-core.ts");

// ===========================================================================
// 1. The edit input normalizer
// ===========================================================================

test("1. a complete submission normalizes to exactly four fields", () => {
  const result = normalizeExamAssignmentEditInput({
    assignmentId: " a1 ",
    horseName: " סוסון ",
    instructionTopic: " עצירה ",
    discipline: " קלאסי ",
  });
  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.deepEqual({ ...result.value }, {
    assignmentId: "a1",
    horseName: "סוסון",
    instructionTopic: "עצירה",
    discipline: "קלאסי",
  });
  assert.equal(Object.isFrozen(result.value), true);
});

test("2. a blank topic and a blank discipline become null, never an empty string", () => {
  const result = normalizeExamAssignmentEditInput({
    assignmentId: "a1",
    horseName: "h",
    instructionTopic: "   ",
    discipline: "",
  });
  assert.ok(result.ok);
  assert.equal(result.value.instructionTopic, null);
  assert.equal(result.value.discipline, null);
});

test("3. an absent topic and discipline are null rather than a refusal", () => {
  const result = normalizeExamAssignmentEditInput({ assignmentId: "a1", horseName: "h" });
  assert.ok(result.ok);
  assert.equal(result.value.instructionTopic, null);
  assert.equal(result.value.discipline, null);
});

test("4. a missing assignment id and a missing horse are BOTH reported, in field order", () => {
  const result = normalizeExamAssignmentEditInput({});
  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.deepEqual(result.issues.map((issue) => issue.code), [
    "EX-ASG-ED-ASSIGNMENT-REQUIRED",
    "EX-ASG-ED-HORSE-REQUIRED",
  ]);
});

test("5. a whitespace-only horse is refused rather than collapsed to nothing", () => {
  const result = normalizeExamAssignmentEditInput({ assignmentId: "a1", horseName: "   " });
  assert.ok(!result.ok);
  assert.deepEqual(result.issues.map((issue) => issue.code), ["EX-ASG-ED-HORSE-REQUIRED"]);
});

test("6. NOTHING is coerced — every non-string is refused, never stringified", () => {
  for (const value of [1, true, [], {}, () => "x", null, undefined, Symbol("s")]) {
    const result = normalizeExamAssignmentEditInput({ assignmentId: "a1", horseName: value });
    assert.ok(!result.ok, `${String(value)} was accepted`);
  }
  // ...and an optional field of a non-string type is simply absent.
  const optional = normalizeExamAssignmentEditInput({
    assignmentId: "a1",
    horseName: "h",
    instructionTopic: 42,
    discipline: { toString: () => "x" },
  });
  assert.ok(optional.ok);
  assert.equal(optional.value.instructionTopic, null);
  assert.equal(optional.value.discipline, null);
});

test("7. inherited properties are never read as submitted data", () => {
  const raw = Object.create({ assignmentId: "a1", horseName: "h" }) as object;
  const result = normalizeExamAssignmentEditInput(raw);
  assert.ok(!result.ok);
  assert.equal(result.issues.length, 2);
});

test("8. a non-object raw input is total, not a throw", () => {
  for (const raw of [null, undefined, "a", 5, [], true]) {
    const result = normalizeExamAssignmentEditInput(raw);
    assert.ok(!result.ok);
  }
});

test("9. the raw input is never mutated", () => {
  const raw = { assignmentId: " a1 ", horseName: " h " };
  normalizeExamAssignmentEditInput(raw);
  assert.deepEqual(raw, { assignmentId: " a1 ", horseName: " h " });
});

test("10. no submitted value can reach a message, and no forbidden field is read", () => {
  for (const message of Object.values(EXAM_ASSIGNMENT_EDIT_INPUT_MESSAGES)) {
    assert.equal(/[{}$]/.test(message), false, `${message} interpolates`);
  }
  const issue = makeExamAssignmentEditInputIssue("EX-ASG-ED-HORSE-REQUIRED");
  assert.equal(Object.isFrozen(issue), true);
  assert.deepEqual(Object.keys(issue).sort(), ["code", "message"]);

  // The forbidden fields are not merely stripped — they are never sought.
  const source = readFileSync(join(REPO_ROOT, MODULE_REL), "utf8");
  const body = source.slice(source.indexOf("export function normalizeExamAssignmentEditInput"));
  for (const field of ["sessionId", "studentId", "orderIndex", "pairingIndex", "planId"]) {
    assert.equal(
      body.includes(`readField(rawInput, "${field}")`),
      false,
      `${field} is read from the submission`,
    );
  }
});

// ===========================================================================
// 2. The move decision
// ===========================================================================

function rows(...spec: readonly string[]): MovableExamAssignmentRow[] {
  return spec.map((entry) => ({
    assignmentId: entry.slice(1),
    role: entry.startsWith("E") ? ("EXAMINEE" as const) : ("INSTRUCTED_TRAINEE" as const),
  }));
}

test("11. only UP and DOWN are recognized directions", () => {
  assert.equal(isExamAssignmentMoveDirection("UP"), true);
  assert.equal(isExamAssignmentMoveDirection("DOWN"), true);
  for (const value of ["up", "DOWN ", "", null, undefined, 1, ["UP"], {}]) {
    assert.equal(isExamAssignmentMoveDirection(value), false, `${String(value)} was accepted`);
  }
});

test("12. moving DOWN exchanges the target with the next examinee", () => {
  const decision = decideExamAssignmentMove(rows("Ea", "Eb", "Ec"), "a", "DOWN");
  assert.ok(decision.ok && decision.moved);
  assert.deepEqual([...decision.orderedAssignmentIds], ["b", "a", "c"]);
});

test("13. moving UP exchanges the target with the previous examinee", () => {
  const decision = decideExamAssignmentMove(rows("Ea", "Eb", "Ec"), "c", "UP");
  assert.ok(decision.ok && decision.moved);
  assert.deepEqual([...decision.orderedAssignmentIds], ["a", "c", "b"]);
});

test("14. an instructed trainee between two examinees keeps its exact place", () => {
  const decision = decideExamAssignmentMove(rows("Ea", "Ix", "Eb"), "a", "DOWN");
  assert.ok(decision.ok && decision.moved);
  assert.deepEqual([...decision.orderedAssignmentIds], ["b", "x", "a"]);
});

test("15. the first examinee cannot move UP, and that is a no-op rather than a refusal", () => {
  const decision = decideExamAssignmentMove(rows("Ix", "Ea", "Eb"), "a", "UP");
  assert.deepEqual({ ...decision }, { ok: true, moved: false });
});

test("16. the last examinee cannot move DOWN", () => {
  const decision = decideExamAssignmentMove(rows("Ea", "Eb", "Ix"), "b", "DOWN");
  assert.deepEqual({ ...decision }, { ok: true, moved: false });
});

test("17. a lone examinee never moves in either direction", () => {
  for (const direction of ["UP", "DOWN"] as const) {
    const decision = decideExamAssignmentMove(rows("Ea", "Ix"), "a", direction);
    assert.deepEqual({ ...decision }, { ok: true, moved: false });
  }
});

test("18. an unknown id is refused, and an instructed trainee is NOT movable", () => {
  assert.deepEqual({ ...decideExamAssignmentMove(rows("Ea"), "zz", "UP") }, {
    ok: false,
    code: "assignment_not_found",
  });
  assert.deepEqual({ ...decideExamAssignmentMove(rows("Ea", "Ix"), "x", "UP") }, {
    ok: false,
    code: "role_not_movable",
  });
});

test("19. the result is always a PERMUTATION — same length, same ids, no invention", () => {
  const input = rows("Ea", "Ix", "Eb", "Iy", "Ec");
  const decision = decideExamAssignmentMove(input, "b", "DOWN");
  assert.ok(decision.ok && decision.moved);
  assert.equal(decision.orderedAssignmentIds.length, input.length);
  assert.deepEqual(
    [...decision.orderedAssignmentIds].sort(),
    input.map((row) => row.assignmentId).sort(),
  );
});

test("20. the caller's rows are never mutated or reordered", () => {
  const input = rows("Ea", "Eb", "Ec");
  const snapshot = input.map((row) => row.assignmentId);
  decideExamAssignmentMove(input, "a", "DOWN");
  assert.deepEqual(input.map((row) => row.assignmentId), snapshot);
});

test("21. an empty session decides nothing and never throws", () => {
  assert.deepEqual({ ...decideExamAssignmentMove([], "a", "UP") }, {
    ok: false,
    code: "assignment_not_found",
  });
});

// ===========================================================================
// 3. The EDIT orchestration
// ===========================================================================

class NotFound extends Error {}
class NotAllowed extends Error {}

function existing(overrides: Partial<ExistingExamAssignmentForEdit> = {}): ExistingExamAssignmentForEdit {
  return {
    assignmentId: "a1",
    sessionId: "s1",
    role: "EXAMINEE",
    horseName: "old",
    instructionTopic: null,
    discipline: null,
    requiresLessonTopic: false,
    requiresDiscipline: false,
    ...overrides,
  };
}

function editDeps(overrides: Partial<UpdateExamAssignmentDetailsDeps> = {}): {
  deps: UpdateExamAssignmentDetailsDeps;
  writes: unknown[];
} {
  const writes: unknown[] = [];
  const deps: UpdateExamAssignmentDetailsDeps = {
    requireCourseContext: async () => ({ courseOfferingId: "c1", status: "ACTIVE" }),
    assertConfigurationAllowed: () => {},
    findExamPlanByCourseOfferingId: async () => ({ id: "p1" }),
    findAssignmentForPlan: async () => existing(),
    updateAssignmentDetails: async (assignmentId, details) => {
      writes.push({ assignmentId, ...details });
    },
    isCourseNotFoundError: (error) => error instanceof NotFound,
    isOperationNotAllowedError: (error) => error instanceof NotAllowed,
    ...overrides,
  };
  return { deps, writes };
}

const GOOD_EDIT = { assignmentId: "a1", horseName: "new", instructionTopic: "", discipline: "" };

test("22. a real change writes exactly the three detail columns, on the id the READ returned", async () => {
  const { deps, writes } = editDeps({
    findAssignmentForPlan: async () => existing({ assignmentId: "server-id" }),
  });
  const result = await updateExamAssignmentDetailsWithDeps("c1", GOOD_EDIT, deps);
  assert.deepEqual({ ...result }, { ok: true, changed: true });
  assert.deepEqual(writes, [
    { assignmentId: "server-id", horseName: "new", instructionTopic: null, discipline: null },
  ]);
});

test("23. an identical submission writes NOTHING and reports changed: false", async () => {
  const { deps, writes } = editDeps({
    findAssignmentForPlan: async () =>
      existing({ horseName: "new", instructionTopic: "t", discipline: "d" }),
  });
  const result = await updateExamAssignmentDetailsWithDeps(
    "c1",
    { assignmentId: "a1", horseName: "new", instructionTopic: "t", discipline: "d" },
    deps,
  );
  assert.deepEqual({ ...result }, { ok: true, changed: false });
  assert.deepEqual(writes, []);
});

test("24. an unknown offering refuses BEFORE the gate, the plan and every query", async () => {
  let planRead = false;
  const { deps, writes } = editDeps({
    requireCourseContext: async () => {
      throw new NotFound();
    },
    findExamPlanByCourseOfferingId: async () => {
      planRead = true;
      return { id: "p1" };
    },
  });
  const result = await updateExamAssignmentDetailsWithDeps("c1", GOOD_EDIT, deps);
  assert.deepEqual({ ...result }, { ok: false, code: "offering_not_found", issues: [] });
  assert.equal(planRead, false);
  assert.deepEqual(writes, []);
});

test("25. the lifecycle denial refuses before the plan is read", async () => {
  let planRead = false;
  const { deps } = editDeps({
    assertConfigurationAllowed: () => {
      throw new NotAllowed();
    },
    findExamPlanByCourseOfferingId: async () => {
      planRead = true;
      return { id: "p1" };
    },
  });
  const result = await updateExamAssignmentDetailsWithDeps("c1", GOOD_EDIT, deps);
  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.equal(result.code, "operation_not_allowed");
  assert.equal(planRead, false);
});

test("26. an unrelated throw from the boundary or the gate PROPAGATES", async () => {
  const boundary = editDeps({
    requireCourseContext: async () => {
      throw new Error("redirect");
    },
  });
  await assert.rejects(() => updateExamAssignmentDetailsWithDeps("c1", GOOD_EDIT, boundary.deps));

  const gate = editDeps({
    assertConfigurationAllowed: () => {
      throw new Error("boom");
    },
  });
  await assert.rejects(() => updateExamAssignmentDetailsWithDeps("c1", GOOD_EDIT, gate.deps));
});

test("27. no plan refuses, and a malformed submission refuses with NO assignment read", async () => {
  const noPlan = editDeps({ findExamPlanByCourseOfferingId: async () => null });
  const planResult = await updateExamAssignmentDetailsWithDeps("c1", GOOD_EDIT, noPlan.deps);
  assert.ok(!planResult.ok);
  assert.equal(planResult.code, "plan_not_found");

  let assignmentRead = false;
  const bad = editDeps({
    findAssignmentForPlan: async () => {
      assignmentRead = true;
      return existing();
    },
  });
  const badResult = await updateExamAssignmentDetailsWithDeps("c1", { horseName: "" }, bad.deps);
  assert.ok(!badResult.ok);
  assert.equal(badResult.code, "invalid_input");
  assert.deepEqual(badResult.issues.map((issue) => issue.code), [
    "EX-ASG-ED-ASSIGNMENT-REQUIRED",
    "EX-ASG-ED-HORSE-REQUIRED",
  ]);
  assert.equal(assignmentRead, false);
  assert.deepEqual(bad.writes, []);
});

test("28. a missing or FOREIGN assignment is not found, and no write happens", async () => {
  const { deps, writes } = editDeps({ findAssignmentForPlan: async () => null });
  const result = await updateExamAssignmentDetailsWithDeps("c1", GOOD_EDIT, deps);
  assert.ok(!result.ok);
  assert.equal(result.code, "assignment_not_found");
  assert.deepEqual(writes, []);
});

test("29. an INSTRUCTED_TRAINEE row is not editable through this operation", async () => {
  const { deps, writes } = editDeps({
    findAssignmentForPlan: async () => existing({ role: "INSTRUCTED_TRAINEE" }),
  });
  const result = await updateExamAssignmentDetailsWithDeps("c1", GOOD_EDIT, deps);
  assert.ok(!result.ok);
  assert.equal(result.code, "role_not_editable");
  assert.deepEqual(writes, []);
});

test("30. the DEFINITION requirement is enforced on the SERVER-read row, never on a submitted flag", async () => {
  const topic = editDeps({
    findAssignmentForPlan: async () => existing({ requiresLessonTopic: true }),
  });
  const topicResult = await updateExamAssignmentDetailsWithDeps("c1", GOOD_EDIT, topic.deps);
  assert.ok(!topicResult.ok);
  assert.equal(topicResult.code, "lesson_topic_required");
  assert.deepEqual(topic.writes, []);

  const discipline = editDeps({
    findAssignmentForPlan: async () => existing({ requiresDiscipline: true }),
  });
  const disciplineResult = await updateExamAssignmentDetailsWithDeps(
    "c1",
    { ...GOOD_EDIT, instructionTopic: "t" },
    discipline.deps,
  );
  assert.ok(!disciplineResult.ok);
  assert.equal(disciplineResult.code, "discipline_required");
  assert.deepEqual(discipline.writes, []);

  // A submission cannot claim its own exam demands less.
  const smuggled = editDeps({
    findAssignmentForPlan: async () => existing({ requiresLessonTopic: true }),
  });
  const smuggledResult = await updateExamAssignmentDetailsWithDeps(
    "c1",
    { ...GOOD_EDIT, requiresLessonTopic: false },
    smuggled.deps,
  );
  assert.ok(!smuggledResult.ok);
  assert.equal(smuggledResult.code, "lesson_topic_required");
});

test("31. the offering id the PLAN is read with is the VERIFIED one, never the request", async () => {
  const seen: string[] = [];
  const { deps } = editDeps({
    requireCourseContext: async () => ({ courseOfferingId: "verified", status: "ACTIVE" }),
    findExamPlanByCourseOfferingId: async (id) => {
      seen.push(id);
      return { id: "p1" };
    },
  });
  await updateExamAssignmentDetailsWithDeps("requested", GOOD_EDIT, deps);
  assert.deepEqual(seen, ["verified"]);
});

// ===========================================================================
// 4. The MOVE orchestration
// ===========================================================================

function moveDeps(overrides: Partial<MoveExamAssignmentDeps> = {}): {
  deps: MoveExamAssignmentDeps;
  renumbered: { sessionId: string; ids: readonly string[] }[];
} {
  const renumbered: { sessionId: string; ids: readonly string[] }[] = [];
  const deps: MoveExamAssignmentDeps = {
    requireCourseContext: async () => ({ courseOfferingId: "c1", status: "ACTIVE" }),
    assertConfigurationAllowed: () => {},
    findExamPlanByCourseOfferingId: async () => ({ id: "p1" }),
    findAssignmentSessionForPlan: async () => ({ sessionId: "s1" }),
    listSessionAssignmentsInOrder: async () => rows("Ea", "Eb", "Ec"),
    renumberSessionAssignments: async (sessionId, ids) => {
      renumbered.push({ sessionId, ids });
    },
    isCourseNotFoundError: (error) => error instanceof NotFound,
    isOperationNotAllowedError: (error) => error instanceof NotAllowed,
    ...overrides,
  };
  return { deps, renumbered };
}

test("32. a real move renumbers THAT session with the complete new order", async () => {
  const { deps, renumbered } = moveDeps();
  const result = await moveExamAssignmentWithDeps("c1", "a", "DOWN", deps);
  assert.deepEqual({ ...result }, { ok: true, moved: true });
  assert.deepEqual(renumbered, [{ sessionId: "s1", ids: ["b", "a", "c"] }]);
});

test("33. a move at the edge writes NOTHING", async () => {
  const { deps, renumbered } = moveDeps();
  const result = await moveExamAssignmentWithDeps("c1", "a", "UP", deps);
  assert.deepEqual({ ...result }, { ok: true, moved: false });
  assert.deepEqual(renumbered, []);
});

test("34. an unusable id or direction refuses BEFORE the assignment is read", async () => {
  for (const [id, direction] of [
    ["", "UP"],
    ["  ", "UP"],
    [null, "UP"],
    [5, "UP"],
    ["a", "up"],
    ["a", null],
    ["a", ["UP"]],
  ] as const) {
    let read = false;
    const { deps, renumbered } = moveDeps({
      findAssignmentSessionForPlan: async () => {
        read = true;
        return { sessionId: "s1" };
      },
    });
    const result = await moveExamAssignmentWithDeps("c1", id, direction, deps);
    assert.ok(!result.ok);
    assert.equal(result.code, "invalid_input");
    assert.equal(read, false);
    assert.deepEqual(renumbered, []);
  }
});

test("35. a FOREIGN assignment is simply not found, and nothing is renumbered", async () => {
  const { deps, renumbered } = moveDeps({ findAssignmentSessionForPlan: async () => null });
  const result = await moveExamAssignmentWithDeps("c1", "a", "UP", deps);
  assert.ok(!result.ok);
  assert.equal(result.code, "assignment_not_found");
  assert.deepEqual(renumbered, []);
});

test("36. the SESSION comes from the target row, never from the caller", async () => {
  const seen: string[] = [];
  const { deps, renumbered } = moveDeps({
    findAssignmentSessionForPlan: async () => ({ sessionId: "server-session" }),
    listSessionAssignmentsInOrder: async (sessionId) => {
      seen.push(sessionId);
      return rows("Ea", "Eb");
    },
  });
  await moveExamAssignmentWithDeps("c1", "a", "DOWN", deps);
  assert.deepEqual(seen, ["server-session"]);
  assert.deepEqual(renumbered, [{ sessionId: "server-session", ids: ["b", "a"] }]);
});

test("37. an instructed trainee cannot be moved, and the offering/gate refusals hold", async () => {
  const role = moveDeps({ listSessionAssignmentsInOrder: async () => rows("Ea", "Ix") });
  const roleResult = await moveExamAssignmentWithDeps("c1", "x", "UP", role.deps);
  assert.ok(!roleResult.ok);
  assert.equal(roleResult.code, "role_not_movable");
  assert.deepEqual(role.renumbered, []);

  const offering = moveDeps({
    requireCourseContext: async () => {
      throw new NotFound();
    },
  });
  const offeringResult = await moveExamAssignmentWithDeps("c1", "a", "UP", offering.deps);
  assert.ok(!offeringResult.ok);
  assert.equal(offeringResult.code, "offering_not_found");

  const gate = moveDeps({
    assertConfigurationAllowed: () => {
      throw new NotAllowed();
    },
  });
  const gateResult = await moveExamAssignmentWithDeps("c1", "a", "UP", gate.deps);
  assert.ok(!gateResult.ok);
  assert.equal(gateResult.code, "operation_not_allowed");

  const plan = moveDeps({ findExamPlanByCourseOfferingId: async () => null });
  const planResult = await moveExamAssignmentWithDeps("c1", "a", "UP", plan.deps);
  assert.ok(!planResult.ok);
  assert.equal(planResult.code, "plan_not_found");
});

test("38. an unrelated throw from the MOVE boundary PROPAGATES", async () => {
  const { deps } = moveDeps({
    requireCourseContext: async () => {
      throw new Error("redirect");
    },
  });
  await assert.rejects(() => moveExamAssignmentWithDeps("c1", "a", "UP", deps));
});

// ===========================================================================
// 5. Purity
// ===========================================================================

/**
 * Strip block and line comments, so a guard sweeps CODE and not the prose that
 * legitimately NAMES what the code may not do. Every token below is spelled in
 * this file's own header, which is exactly why the raw source cannot be swept.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * The forbidden tokens, ASSEMBLED from pieces. A whole literal here would put
 * the very text this guard forbids into a file the guard also reads.
 */
const IMPURE_TOKENS = [
  "pris" + "ma",
  "Pris" + "maClient",
  "server" + "-only",
  "use " + "server",
  "use " + "client",
  "next" + "/",
  "Date." + "now",
  "new " + "Date",
  "Math." + "random",
  "process." + "env",
  "fetch" + "(",
  "require" + "(",
];

test("39. the module under test is PURE — no imports, no effects, no framework", () => {
  const source = stripComments(readFileSync(join(REPO_ROOT, MODULE_REL), "utf8"));
  assert.equal(/^\s*import\s/m.test(source), false, "the core imports something");
  for (const token of IMPURE_TOKENS) {
    assert.equal(source.includes(token), false, `the core reaches ${token}`);
  }
});

test("40. this suite opens no database and reads no environment", () => {
  const own = stripComments(
    readFileSync(join(REPO_ROOT, "lib", "exam", "admin-exam-workspace-edit-core.test.ts"), "utf8"),
  );
  for (const token of ["@/lib/" + "prisma", "DATABASE" + "_URL"]) {
    assert.equal(own.includes(token), false, `the suite references ${token}`);
  }
});
