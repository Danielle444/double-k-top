/**
 * EXAM EX-ADMIN-WORKSPACE-UX (ATOMIC REPLACEMENT) — the runtime suite of the
 * examinee-first instructed-trainee replacement.
 *
 * The decision is pure and the orchestration is deps-injected, so both are
 * driven directly here. The transaction itself is proven the only way it can be
 * without a database: by asserting the exact COMMAND the decision emits — one
 * command carrying BOTH halves, so a caller cannot apply half of it — and by
 * asserting the write layer is handed that command exactly once.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  decideExamExamineeInstructedTraineeReplacement,
  setExamExamineeInstructedTraineeWithDeps,
  type ExamReplacementAssignmentFacts,
  type SetExamExamineeInstructedTraineeDeps,
} from "./admin-exam-examinee-pairing-core";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const SESSION = "s1";

function examinee(pairingIndex: number | null, id = "E"): ExamReplacementAssignmentFacts {
  return { assignmentId: id, sessionId: SESSION, role: "EXAMINEE", pairingIndex };
}
function trainee(id: string, pairingIndex: number | null): ExamReplacementAssignmentFacts {
  return { assignmentId: id, sessionId: SESSION, role: "INSTRUCTED_TRAINEE", pairingIndex };
}
function facts(rows: readonly ExamReplacementAssignmentFacts[]) {
  return rows.map((row) => ({ assignmentId: row.assignmentId, pairingIndex: row.pairingIndex }));
}

// ===========================================================================
// 1. The nine required behaviours
// ===========================================================================

test("1. NO current trainee -> assigning A allocates and writes BOTH rows", () => {
  const E = examinee(null);
  const A = trainee("A", null);
  const decision = decideExamExamineeInstructedTraineeReplacement({
    examinee: E,
    next: A,
    sessionExaminees: facts([E]),
    sessionInstructedTrainees: facts([A]),
  });
  assert.ok(decision.ok && decision.kind === "REPLACE");
  // Nothing to release: this is a first assignment rather than a replacement.
  assert.equal(decision.clear, null);
  assert.equal(decision.pair.kind, "PAIR_WITH_NEW_INDEX");
});

test("2. A -> B succeeds, and the ONE command carries BOTH halves", () => {
  const E = examinee(1);
  const A = trainee("A", 1);
  const B = trainee("B", null);
  const decision = decideExamExamineeInstructedTraineeReplacement({
    examinee: E,
    next: B,
    sessionExaminees: facts([E]),
    sessionInstructedTrainees: facts([A, B]),
  });
  assert.ok(decision.ok && decision.kind === "REPLACE");
  // The release of A and the claim of B are ONE decision. A caller cannot apply
  // one without the other, which is what makes the transaction atomic by
  // construction rather than by convention.
  assert.deepEqual({ ...decision.clear }, {
    instructedTraineeAssignmentId: "A",
    expectedPairingIndex: 1,
  });
  assert.equal(decision.pair.kind, "PAIR_WITH_EXISTING_INDEX");
  assert.equal((decision.pair as { pairingIndex: number }).pairingIndex, 1);
});

test("3. A -> B is REFUSED when B already belongs to another examinee, and A remains", () => {
  const E = examinee(1);
  const other = examinee(2, "E2");
  const A = trainee("A", 1);
  const B = trainee("B", 2); // B follows the OTHER examinee
  const decision = decideExamExamineeInstructedTraineeReplacement({
    examinee: E,
    next: B,
    sessionExaminees: facts([E, other]),
    sessionInstructedTrainees: facts([A, B]),
  });
  assert.deepEqual({ ...decision }, {
    ok: false,
    code: "instructed_trainee_already_paired",
  });
  // A refusal describes NO write at all, so nothing can release A: there is no
  // `clear` on a refusal to apply.
  assert.equal("clear" in decision, false);
});

test("4. A -> null removes A and writes nothing else", () => {
  const E = examinee(1);
  const A = trainee("A", 1);
  const decision = decideExamExamineeInstructedTraineeReplacement({
    examinee: E,
    next: null,
    sessionExaminees: facts([E]),
    sessionInstructedTrainees: facts([A]),
  });
  assert.ok(decision.ok && decision.kind === "UNPAIR");
  assert.deepEqual({ ...decision.clear }, {
    instructedTraineeAssignmentId: "A",
    expectedPairingIndex: 1,
  });
});

test("5. re-selecting the SAME trainee is NO_CHANGE, and unpairing nobody is too", () => {
  const E = examinee(1);
  const A = trainee("A", 1);
  assert.deepEqual(
    { ...decideExamExamineeInstructedTraineeReplacement({
      examinee: E, next: A, sessionExaminees: facts([E]), sessionInstructedTrainees: facts([A]),
    }) },
    { ok: true, kind: "NO_CHANGE" },
  );
  assert.deepEqual(
    { ...decideExamExamineeInstructedTraineeReplacement({
      examinee: examinee(null), next: null, sessionExaminees: [], sessionInstructedTrainees: [],
    }) },
    { ok: true, kind: "NO_CHANGE" },
  );
});

test("6. wrong ROLE, wrong SESSION and a self-pair all fail closed", () => {
  const E = examinee(1);
  for (const [input, code] of [
    [{ examinee: { ...E, role: "INSTRUCTED_TRAINEE" }, next: trainee("A", null) }, "role_not_examinee"],
    [{ examinee: E, next: { ...trainee("A", null), role: "EXAMINEE" } }, "instructed_role_mismatch"],
    [{ examinee: E, next: { ...trainee("A", null), sessionId: "other" } }, "different_sessions"],
    [{ examinee: E, next: { ...trainee("A", null), assignmentId: "E" } }, "invalid_input"],
    [{ examinee: { ...E, assignmentId: "  " }, next: null }, "invalid_input"],
  ] as const) {
    const decision = decideExamExamineeInstructedTraineeReplacement({
      ...(input as { examinee: ExamReplacementAssignmentFacts; next: ExamReplacementAssignmentFacts | null }),
      sessionExaminees: facts([E]),
      sessionInstructedTrainees: [],
    });
    assert.deepEqual({ ...decision }, { ok: false, code });
  }
});

test("7. two trainees claiming one examinee is AMBIGUOUS and writes nothing", () => {
  const E = examinee(1);
  const A = trainee("A", 1);
  const A2 = trainee("A2", 1);
  const decision = decideExamExamineeInstructedTraineeReplacement({
    examinee: E,
    next: trainee("B", null),
    sessionExaminees: facts([E]),
    sessionInstructedTrainees: facts([A, A2]),
  });
  assert.deepEqual({ ...decision }, { ok: false, code: "ambiguous_pairing_index" });
});

test("8. the COMMITTED one-to-one rule still applies, evaluated POST-CLEAR", () => {
  // A holds the examinee; C is a THIRD trainee also holding it would be ambiguous,
  // so instead: the examinee is claimed by a trainee that is NOT being replaced.
  const E = examinee(1);
  const A = trainee("A", 1);
  const B = trainee("B", null);
  // Replacing A with B is allowed precisely because A is released in the same
  // transaction — the committed rule is asked about the POST-CLEAR set.
  const allowed = decideExamExamineeInstructedTraineeReplacement({
    examinee: E,
    next: B,
    sessionExaminees: facts([E]),
    sessionInstructedTrainees: facts([A, B]),
  });
  assert.ok(allowed.ok && allowed.kind === "REPLACE");
  // ...and with NO release to perform, the very same request is refused by the
  // committed rule, which proves the rule is still in force and not bypassed.
  const refused = decideExamExamineeInstructedTraineeReplacement({
    examinee: E,
    next: B,
    sessionExaminees: facts([E]),
    // A is present but holds a DIFFERENT index, so it is not the current partner
    // and is not released — yet the single-examinee fallback still claims E.
    sessionInstructedTrainees: [
      { assignmentId: "A", pairingIndex: null },
      { assignmentId: "B", pairingIndex: null },
    ],
  });
  assert.equal(refused.ok, false);
  assert.equal((refused as { code: string }).code, "examinee_already_paired");
});

test("9. the decision never mutates its inputs and is frozen", () => {
  const E = examinee(1);
  const A = trainee("A", 1);
  const B = trainee("B", null);
  const trainees = facts([A, B]);
  const snapshot = JSON.stringify(trainees);
  const decision = decideExamExamineeInstructedTraineeReplacement({
    examinee: E,
    next: B,
    sessionExaminees: facts([E]),
    sessionInstructedTrainees: trainees,
  });
  assert.equal(JSON.stringify(trainees), snapshot, "the input was mutated");
  assert.equal(Object.isFrozen(decision), true);
});

// ===========================================================================
// 2. The orchestration — ONE command, ONE apply, and no partial state
// ===========================================================================

class NotFound extends Error {}
class NotAllowed extends Error {}

function deps(
  overrides: Partial<SetExamExamineeInstructedTraineeDeps> = {},
  rows: Record<string, ExamReplacementAssignmentFacts> = {},
): { deps: SetExamExamineeInstructedTraineeDeps; applied: unknown[] } {
  const applied: unknown[] = [];
  return {
    applied,
    deps: {
      requireCourseContext: async () => ({ courseOfferingId: "c1", status: "ACTIVE" }),
      assertConfigurationAllowed: () => {},
      findExamPlanByCourseOfferingId: async () => ({ id: "p1" }),
      findAssignmentForPlan: async (_planId, assignmentId) => rows[assignmentId] ?? null,
      listSessionExaminees: async () =>
        Object.values(rows)
          .filter((row) => row.role === "EXAMINEE")
          .map((row) => ({ assignmentId: row.assignmentId, pairingIndex: row.pairingIndex })),
      listSessionInstructedTrainees: async () =>
        Object.values(rows)
          .filter((row) => row.role === "INSTRUCTED_TRAINEE")
          .map((row) => ({ assignmentId: row.assignmentId, pairingIndex: row.pairingIndex })),
      applyReplacement: async (command) => {
        applied.push(command);
        return true;
      },
      isCourseNotFoundError: (error) => error instanceof NotFound,
      isOperationNotAllowedError: (error) => error instanceof NotAllowed,
      ...overrides,
    },
  };
}

test("10. a replacement calls the write layer EXACTLY ONCE, with both halves", async () => {
  const rows = {
    E: examinee(1),
    A: trainee("A", 1),
    B: trainee("B", null),
  };
  const { deps: d, applied } = deps({}, rows);
  const result = await setExamExamineeInstructedTraineeWithDeps("c1", "E", "B", d);
  assert.deepEqual({ ...result }, { ok: true, status: "PAIRED" });
  // ONE apply. Never two — two would mean two transactions and a committed
  // moment in which the examinee taught nobody.
  assert.equal(applied.length, 1);
  const command = applied[0] as { clear: unknown; pair: unknown; instructedTraineeAssignmentId: string };
  assert.deepEqual(command.clear, {
    instructedTraineeAssignmentId: "A",
    expectedPairingIndex: 1,
  });
  assert.equal(command.instructedTraineeAssignmentId, "B");
  assert.notEqual(command.pair, null);
});

test("11. a REFUSED replacement never reaches the write layer, so A survives", async () => {
  const rows = {
    E: examinee(1),
    E2: examinee(2, "E2"),
    A: trainee("A", 1),
    B: trainee("B", 2),
  };
  const { deps: d, applied } = deps({}, rows);
  const result = await setExamExamineeInstructedTraineeWithDeps("c1", "E", "B", d);
  assert.equal(result.ok, false);
  assert.equal((result as { code: string }).code, "instructed_trainee_already_paired");
  // NOTHING was applied, so A still holds the examinee. There is no compensating
  // write to get wrong, because there was no first write.
  assert.deepEqual(applied, []);
});

test("12. a failed CONDITION is a stale write, never a partial success", async () => {
  const rows = { E: examinee(1), A: trainee("A", 1), B: trainee("B", null) };
  const { deps: d } = deps({ applyReplacement: async () => false }, rows);
  const result = await setExamExamineeInstructedTraineeWithDeps("c1", "E", "B", d);
  assert.deepEqual({ ...result }, { ok: false, code: "stale_write" });
});

test("13. NO_CHANGE writes nothing at all", async () => {
  const rows = { E: examinee(1), A: trainee("A", 1) };
  const { deps: d, applied } = deps({}, rows);
  const result = await setExamExamineeInstructedTraineeWithDeps("c1", "E", "A", d);
  assert.deepEqual({ ...result }, { ok: true, status: "NO_CHANGE" });
  assert.deepEqual(applied, []);
});

test("14. an unknown offering, a lifecycle denial and a missing plan all fail closed", async () => {
  const offering = deps({
    requireCourseContext: async () => {
      throw new NotFound();
    },
  });
  assert.equal(
    (await setExamExamineeInstructedTraineeWithDeps("c1", "E", null, offering.deps) as { code: string }).code,
    "offering_not_found",
  );
  assert.deepEqual(offering.applied, []);

  const gate = deps({
    assertConfigurationAllowed: () => {
      throw new NotAllowed();
    },
  });
  assert.equal(
    (await setExamExamineeInstructedTraineeWithDeps("c1", "E", null, gate.deps) as { code: string }).code,
    "operation_not_allowed",
  );

  const plan = deps({ findExamPlanByCourseOfferingId: async () => null });
  assert.equal(
    (await setExamExamineeInstructedTraineeWithDeps("c1", "E", null, plan.deps) as { code: string }).code,
    "plan_not_found",
  );
});

test("15. a FOREIGN examinee or trainee is simply not found, and nothing is written", async () => {
  const missingExaminee = deps({}, {});
  assert.equal(
    (await setExamExamineeInstructedTraineeWithDeps("c1", "E", null, missingExaminee.deps) as { code: string }).code,
    "assignment_not_found",
  );
  const missingTrainee = deps({}, { E: examinee(null) });
  assert.equal(
    (await setExamExamineeInstructedTraineeWithDeps("c1", "E", "B", missingTrainee.deps) as { code: string }).code,
    "instructed_assignment_not_found",
  );
  assert.deepEqual(missingTrainee.applied, []);
});

test("16. the SESSION is read from the examinee's own row, never from a caller", async () => {
  const seen: string[] = [];
  const rows = { E: examinee(null), B: trainee("B", null) };
  const { deps: d } = deps(
    {
      listSessionExaminees: async (sessionId) => {
        seen.push(`ex:${sessionId}`);
        return [{ assignmentId: "E", pairingIndex: null }];
      },
      listSessionInstructedTrainees: async (sessionId) => {
        seen.push(`it:${sessionId}`);
        return [{ assignmentId: "B", pairingIndex: null }];
      },
    },
    rows,
  );
  await setExamExamineeInstructedTraineeWithDeps("c1", "E", "B", d);
  assert.deepEqual(seen, [`ex:${SESSION}`, `it:${SESSION}`]);
});

// ===========================================================================
// 3. It duplicates no pairing rule, and the write layer is one transaction
// ===========================================================================

/** Strip comments, so the sweeps assert on CODE and not the prose beside it. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

test("17. the committed pairing decision is CALLED, not re-implemented", () => {
  const code = stripComments(
    readFileSync(join(REPO_ROOT, "lib", "exam", "admin-exam-examinee-pairing-core.ts"), "utf8"),
  );
  assert.ok(code.includes("decideExamInstructedTraineePairing({"));
  // The rules the committed decision owns are never restated here: no allocation,
  // no rival scan, no role table of its own.
  for (const token of [
    "allocatePairingIndex",
    "isIndexHeldByAnotherExaminee",
    "isExamineeClaimedByAnotherInstructedTrainee",
    "PAIR_WITH_NEW_INDEX\" as const",
  ]) {
    assert.equal(code.includes(token), false, `the module re-implements ${token}`);
  }
  // ...and the committed decision is asked about the POST-CLEAR set, which is
  // what makes a replacement legal without weakening the one-to-one rule.
  assert.ok(code.includes("sessionInstructedTrainees: postClear"));
});

test("18. the write layer applies the whole switch in ONE transaction", () => {
  const io = stripComments(
    readFileSync(join(REPO_ROOT, "lib", "actions", "admin-exam-workspace-edit-io.ts"), "utf8"),
  );
  const apply = io.slice(io.indexOf("async function applyExamExamineeInstructedTraineeReplacement"));
  const end = apply.indexOf("export function setExamExamineeInstructedTrainee");
  const body = end === -1 ? apply : apply.slice(0, end);
  assert.equal((body.match(/prisma\.\$transaction\(/g) ?? []).length, 1, "not one transaction");
  // Both halves are inside it, and every statement is conditional.
  assert.ok(body.includes("data: { pairingIndex: null }"), "the release is missing");
  assert.ok(body.includes("pairingIndex: command.clear.expectedPairingIndex"));
  assert.ok(body.includes("pairingIndex: pair.expectedExamineePairingIndex"));
  assert.ok(body.includes("pairingIndex: pair.expectedInstructedPairingIndex"));
  // A failed condition rolls the WHOLE thing back rather than leaving half of it.
  assert.equal((body.match(/throw new ExamReplacementConditionFailed\(\)/g) ?? []).length, 4);
  assert.equal(body.includes("await prisma.examAssignment.update"), false, "a write escapes the tx");
});

test("19. the route action calls the atomic operation EXACTLY ONCE per save", () => {
  const actions = stripComments(
    readFileSync(
      join(
        REPO_ROOT,
        "app",
        "admin",
        "courses",
        "[courseOfferingId]",
        "exams",
        "actions.ts",
      ),
      "utf8",
    ),
  );
  const save = actions.slice(
    actions.indexOf("export async function updateExamAssignmentDetailsAction"),
    actions.indexOf("export async function moveExamAssignmentAction"),
  );
  assert.equal(
    save.split("set" + "ExamExamineeInstructedTrainee" + "(").length - 1,
    1,
    "the card save calls the atomic replacement more than once",
  );
  // ...and it does NOT reach the trainee-first pairing writer for a replacement.
  assert.equal(
    save.includes("set" + "ExamInstructedTraineePairing" + "("),
    false,
    "the card save still calls the trainee-first pairing writer",
  );
});
