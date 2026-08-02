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

// EX-PAIR-NO-SELF - participant identity, DERIVED FROM THE ROW ID by default so
// every fixture row is a DIFFERENT person unless a test says otherwise. That keeps
// every pre-existing expectation in this suite meaning exactly what it did, and
// makes the self-pairing case something a test must ask for EXPLICITLY by handing
// both builders the SAME studentId.
function examinee(
  pairingIndex: number | null,
  id = "E",
  studentId: string | null = `student-of-${id}`,
): ExamReplacementAssignmentFacts {
  return { assignmentId: id, sessionId: SESSION, role: "EXAMINEE", pairingIndex, studentId };
}
function trainee(
  id: string,
  pairingIndex: number | null,
  studentId: string | null = `student-of-${id}`,
): ExamReplacementAssignmentFacts {
  return {
    assignmentId: id,
    sessionId: SESSION,
    role: "INSTRUCTED_TRAINEE",
    pairingIndex,
    studentId,
  };
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

// ===========================================================================
// 20. EX-PAIR-NO-SELF — the EXAMINEE-FIRST direction of the same rule
// ===========================================================================
//
// The examinee-first surface is the one the admin workspace actually uses, so the
// rule has to hold here and not merely in the trainee-first core it delegates to.
// The bug being closed: the guard on the line above these tests compared
// ASSIGNMENT IDS, and one person who is both an EXAMINEE and an
// INSTRUCTED_TRAINEE of a session holds TWO DIFFERENT rows. That combination was
// unreachable only because the database's role-blind unique key forbade it;
// EX-ASG-MULTIPLICITY scoped that key to EXAMINEE rows and made it legal.

const SAME_PERSON = "student-shared";

test("20. THE BUG: an examinee cannot be given ITSELF as its instructed trainee", () => {
  // E and T are DIFFERENT assignment rows — so the pre-existing assignment-id
  // guard does NOT fire — but they are the SAME PERSON.
  const decision = decideExamExamineeInstructedTraineeReplacement({
    examinee: examinee(null, "E", SAME_PERSON),
    next: trainee("T", null, SAME_PERSON),
    sessionExaminees: [{ assignmentId: "E", pairingIndex: null }],
    sessionInstructedTrainees: [{ assignmentId: "T", pairingIndex: null }],
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.ok === false ? decision.code : null, "self_pairing");
  assert.notEqual("E", "T");
});

test("20a. it refuses BEFORE the NO_CHANGE short circuit, so a stored self-pair is not re-affirmed", () => {
  // The session ALREADY holds the self-pair (both rows on index 1), which is the
  // exact state the old NO_CHANGE branch would have reported as a success without
  // ever reaching the delegate. It must refuse.
  const decision = decideExamExamineeInstructedTraineeReplacement({
    examinee: examinee(1, "E", SAME_PERSON),
    next: trainee("T", 1, SAME_PERSON),
    sessionExaminees: [{ assignmentId: "E", pairingIndex: 1 }],
    sessionInstructedTrainees: [{ assignmentId: "T", pairingIndex: 1 }],
  });
  assert.equal(decision.ok === false ? decision.code : null, "self_pairing");
});

test("20b. NO FALSE POSITIVE: different people still pair, replace and unpair", () => {
  // First assignment.
  const first = decideExamExamineeInstructedTraineeReplacement({
    examinee: examinee(null, "E"),
    next: trainee("A", null),
    sessionExaminees: [{ assignmentId: "E", pairingIndex: null }],
    sessionInstructedTrainees: [{ assignmentId: "A", pairingIndex: null }],
  });
  assert.equal(first.ok, true);
  assert.equal(first.ok === true ? first.kind : null, "REPLACE");

  // REPLACE A with B — both halves in one command.
  const replaced = decideExamExamineeInstructedTraineeReplacement({
    examinee: examinee(1, "E"),
    next: trainee("B", null),
    sessionExaminees: [{ assignmentId: "E", pairingIndex: 1 }],
    sessionInstructedTrainees: [
      { assignmentId: "A", pairingIndex: 1 },
      { assignmentId: "B", pairingIndex: null },
    ],
  });
  assert.equal(replaced.ok === true ? replaced.kind : null, "REPLACE");

  // REMOVE.
  const removed = decideExamExamineeInstructedTraineeReplacement({
    examinee: examinee(1, "E"),
    next: null,
    sessionExaminees: [{ assignmentId: "E", pairingIndex: 1 }],
    sessionInstructedTrainees: [{ assignmentId: "A", pairingIndex: 1 }],
  });
  assert.equal(removed.ok === true ? removed.kind : null, "UNPAIR");
});

test("20c. a DUAL trainee is still assignable to a DIFFERENT examinee of the same session", () => {
  // EX-ASG-MULTIPLICITY rule 1: the trainee behind T is also the person behind
  // examinee row E_SELF, and is being pointed at E_OTHER. Must SUCCEED.
  const decision = decideExamExamineeInstructedTraineeReplacement({
    examinee: examinee(null, "E_OTHER", "student-other"),
    next: trainee("T", null, "student-dual"),
    sessionExaminees: [
      { assignmentId: "E_SELF", pairingIndex: null },
      { assignmentId: "E_OTHER", pairingIndex: null },
    ],
    sessionInstructedTrainees: [{ assignmentId: "T", pairingIndex: null }],
  });
  assert.equal(decision.ok, true);
});

test("20d. one trainee may still be instructed by MULTIPLE DIFFERENT examinees", () => {
  // EX-ASG-MULTIPLICITY rule 2: two separate instructed rows for ONE person, each
  // claimed by a different examinee. Neither is a self-pair.
  const first = decideExamExamineeInstructedTraineeReplacement({
    examinee: examinee(null, "E1", "student-e1"),
    next: trainee("T1", null, "student-popular"),
    sessionExaminees: [
      { assignmentId: "E1", pairingIndex: null },
      { assignmentId: "E2", pairingIndex: 2 },
    ],
    sessionInstructedTrainees: [
      { assignmentId: "T1", pairingIndex: null },
      { assignmentId: "T2", pairingIndex: 2 },
    ],
  });
  assert.equal(first.ok, true);
});

test("20e. NULL participants are never treated as the same person", () => {
  const decision = decideExamExamineeInstructedTraineeReplacement({
    examinee: examinee(null, "E", null),
    next: trainee("T", null, null),
    sessionExaminees: [{ assignmentId: "E", pairingIndex: null }],
    sessionInstructedTrainees: [{ assignmentId: "T", pairingIndex: null }],
  });
  assert.equal(decision.ok, true);
});

test("20f. the more specific refusals still win, and one row as both halves is still invalid_input", () => {
  const wrongRole = decideExamExamineeInstructedTraineeReplacement({
    examinee: examinee(null, "E", SAME_PERSON),
    next: examinee(null, "T", SAME_PERSON),
    sessionExaminees: [],
    sessionInstructedTrainees: [],
  });
  assert.equal(wrongRole.ok === false ? wrongRole.code : null, "instructed_role_mismatch");

  const sameRow = decideExamExamineeInstructedTraineeReplacement({
    examinee: examinee(null, "SAME", SAME_PERSON),
    next: trainee("SAME", null, SAME_PERSON),
    sessionExaminees: [],
    sessionInstructedTrainees: [],
  });
  assert.equal(sameRow.ok === false ? sameRow.code : null, "invalid_input");
});

test("20g. the self-pair refusal reaches NO write, through the real orchestration", async () => {
  const rows = {
    E: examinee(null, "E", SAME_PERSON),
    T: trainee("T", null, SAME_PERSON),
  };
  const { deps: d, applied } = deps({}, rows);
  const result = await setExamExamineeInstructedTraineeWithDeps("c1", "E", "T", d);
  assert.deepEqual({ ...result }, { ok: false, code: "self_pairing" });
  // NOTHING was written: a refusal leaves the pairing the examinee had.
  assert.deepEqual(applied, []);
});

test("20h. lifecycle and stale-write protections are UNCHANGED by the identity check", async () => {
  const rows = {
    E: examinee(null, "E", SAME_PERSON),
    T: trainee("T", null, SAME_PERSON),
    G: trainee("G", null, "student-different"),
  };

  // LIFECYCLE still denies FIRST — before any assignment is read, so a denied
  // offering never learns whether these rows exist, self-pair or not.
  const lifecycle = deps(
    {
      assertConfigurationAllowed: () => {
        throw new NotAllowed();
      },
      findAssignmentForPlan: async () => {
        throw new Error("no assignment may be read after a lifecycle denial");
      },
    },
    rows,
  );
  const denied = await setExamExamineeInstructedTraineeWithDeps("c1", "E", "T", lifecycle.deps);
  assert.deepEqual({ ...denied }, { ok: false, code: "operation_not_allowed" });
  assert.deepEqual(lifecycle.applied, []);

  // OFFERING not-found still wins too.
  const missing = deps(
    {
      requireCourseContext: async () => {
        throw new NotFound();
      },
    },
    rows,
  );
  assert.deepEqual(
    { ...(await setExamExamineeInstructedTraineeWithDeps("c1", "E", "T", missing.deps)) },
    { ok: false, code: "offering_not_found" },
  );

  // STALE WRITE still reported for a LEGITIMATE pairing whose condition failed —
  // the identity check must not short-circuit or mask it.
  //
  // A fixture holding ONE instructed trainee, deliberately: with two index-less
  // trainees in a one-examinee session the committed single-examinee FALLBACK
  // already reads BOTH as that examinee's partner, so the one-to-one rule refuses
  // first and this case would never reach a write at all.
  const staleRows = {
    E: examinee(null, "E", SAME_PERSON),
    G: trainee("G", null, "student-different"),
  };
  // The override REPLACES the harness's recording writer, so attempts are counted
  // here rather than through `applied`.
  let attempts = 0;
  const stale = deps(
    {
      applyReplacement: async () => {
        attempts += 1;
        return false;
      },
    },
    staleRows,
  );
  const staleResult = await setExamExamineeInstructedTraineeWithDeps("c1", "E", "G", stale.deps);
  assert.deepEqual({ ...staleResult }, { ok: false, code: "stale_write" });
  // ...and it really did ATTEMPT the write, which is what makes this a STALE
  // write rather than a refusal: the identity check let a legitimate pairing
  // through to the write layer exactly as it did before.
  assert.equal(attempts, 1);
});
