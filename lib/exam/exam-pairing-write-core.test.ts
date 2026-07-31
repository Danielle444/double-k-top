/**
 * EX-PAIR-BE-MVP — tests for the PURE pairing decision and orchestration.
 *
 * Run with: npx tsx --test lib/exam/exam-pairing-write-core.test.ts
 *
 * DB-FREE AND PRODUCTION-FREE: no database connection is opened, no SQL is
 * executed, no environment variable is read, no network call is made, and no
 * production identifier, trainee name or course name appears anywhere. Every
 * effect is a local fake, and every id is an obvious fixture string.
 *
 * WHAT THIS SUITE PROVES:
 *  - the LOCKED ORDER — authorization, lifecycle gate, input check, plan,
 *    instructed row, examinee row, session examinees, decide, write — and that
 *    each step is skipped entirely once an earlier one refuses;
 *  - the PAIRING RULES — reuse of an existing index, allocation of the smallest
 *    positive unused one, several instructed trainees sharing one examinee's
 *    index, and the fail-closed refusals for roles, sessions and ambiguity;
 *  - that UNPAIR touches the instructed row only;
 *  - that a NO-OP issues no write at all;
 *  - that every write is CONDITIONAL on the state the decision was made from,
 *    and that a failed condition becomes a refusal rather than a retry;
 *  - and STRUCTURALLY, that this module has no clock, no DB, no PII and no
 *    caller-supplied pairing index.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  decideExamInstructedTraineePairing,
  setExamInstructedTraineePairingWithDeps,
  type ExamPairingAssignmentFacts,
  type ExamPairingExamineeFacts,
  type ExamPairingWriteCommand,
  type ExamUnpairWriteCommand,
  type SetExamInstructedTraineePairingDeps,
} from "./exam-pairing-write-core";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const CORE_REL = join("lib", "exam", "exam-pairing-write-core.ts");
const CORE_SOURCE = readFileSync(join(REPO_ROOT, CORE_REL), "utf8");

/**
 * Strip comments so the structural guards assert on CODE, not on explanatory
 * prose — the header legitimately DISCUSSES the tokens those guards forbid.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const CORE_CODE = stripComments(CORE_SOURCE);

// ===========================================================================
// Fixtures
// ===========================================================================

const OFFERING = "offering-1";
const PLAN = "plan-1";
const SESSION = "session-1";
const OTHER_SESSION = "session-2";

function instructedFacts(
  overrides: Partial<ExamPairingAssignmentFacts> = {},
): ExamPairingAssignmentFacts {
  return {
    assignmentId: "assignment-instructed",
    sessionId: SESSION,
    role: "INSTRUCTED_TRAINEE",
    pairingIndex: null,
    ...overrides,
  };
}

function examineeFacts(
  overrides: Partial<ExamPairingAssignmentFacts> = {},
): ExamPairingAssignmentFacts {
  return {
    assignmentId: "assignment-examinee",
    sessionId: SESSION,
    role: "EXAMINEE",
    pairingIndex: null,
    ...overrides,
  };
}

interface Scenario {
  readonly calls: string[];
  readonly pairCommands: ExamPairingWriteCommand[];
  readonly unpairCommands: ExamUnpairWriteCommand[];
}

interface ScenarioOptions {
  readonly assignments?: Record<string, ExamPairingAssignmentFacts>;
  readonly sessionExaminees?: readonly ExamPairingExamineeFacts[];
  readonly plan?: { readonly id: string } | null;
  readonly status?: string;
  readonly pairResult?: boolean;
  readonly unpairResult?: boolean;
  readonly requireCourseContext?: SetExamInstructedTraineePairingDeps["requireCourseContext"];
  readonly assertConfigurationAllowed?: SetExamInstructedTraineePairingDeps["assertConfigurationAllowed"];
  readonly isCourseNotFoundError?: (error: unknown) => boolean;
  readonly isOperationNotAllowedError?: (error: unknown) => boolean;
}

/**
 * A dependency bundle whose every call is recorded, so "which statements ran, in
 * which order, with which arguments" is a property this suite can assert on
 * rather than infer.
 */
function makeScenario(options: ScenarioOptions = {}): {
  deps: SetExamInstructedTraineePairingDeps;
  recorded: Scenario;
} {
  const recorded: Scenario = { calls: [], pairCommands: [], unpairCommands: [] };
  const assignments = options.assignments ?? {};

  const deps: SetExamInstructedTraineePairingDeps = {
    requireCourseContext:
      options.requireCourseContext ??
      (async (requested: string) => {
        recorded.calls.push(`requireCourseContext:${requested}`);
        return { courseOfferingId: OFFERING, status: options.status ?? "ACTIVE" };
      }),
    assertConfigurationAllowed:
      options.assertConfigurationAllowed ??
      ((status: string) => {
        recorded.calls.push(`assertConfigurationAllowed:${status}`);
      }),
    findExamPlanByCourseOfferingId: async (verified: string) => {
      recorded.calls.push(`findPlan:${verified}`);
      return options.plan === undefined ? { id: PLAN } : options.plan;
    },
    findAssignmentForPlan: async (planId: string, assignmentId: string) => {
      recorded.calls.push(`findAssignment:${planId}:${assignmentId}`);
      return assignments[assignmentId] ?? null;
    },
    findSessionExaminees: async (planId: string, sessionId: string) => {
      recorded.calls.push(`findSessionExaminees:${planId}:${sessionId}`);
      return options.sessionExaminees ?? [];
    },
    pairInstructedTrainee: async (command: ExamPairingWriteCommand) => {
      recorded.calls.push("pair");
      recorded.pairCommands.push(command);
      return options.pairResult ?? true;
    },
    unpairInstructedTrainee: async (command: ExamUnpairWriteCommand) => {
      recorded.calls.push("unpair");
      recorded.unpairCommands.push(command);
      return options.unpairResult ?? true;
    },
    isCourseNotFoundError: options.isCourseNotFoundError ?? (() => false),
    isOperationNotAllowedError: options.isOperationNotAllowedError ?? (() => false),
  };

  return { deps, recorded };
}

function writeCalls(recorded: Scenario): string[] {
  return recorded.calls.filter((call) => call === "pair" || call === "unpair");
}

// ===========================================================================
// 1–8. The pure decision
// ===========================================================================

test("1. a same-session instructed trainee and examinee can be paired", () => {
  const decision = decideExamInstructedTraineePairing({
    instructed: instructedFacts(),
    examinee: examineeFacts({ pairingIndex: 2 }),
    sessionExaminees: [{ assignmentId: "assignment-examinee", pairingIndex: 2 }],
  });

  assert.equal(decision.kind, "PAIR_WITH_EXISTING_INDEX");
  assert.equal(decision.kind === "PAIR_WITH_EXISTING_INDEX" && decision.pairingIndex, 2);
});

test("2. an existing UNIQUE examinee index is reused, never re-allocated", () => {
  const decision = decideExamInstructedTraineePairing({
    instructed: instructedFacts(),
    examinee: examineeFacts({ pairingIndex: 7 }),
    sessionExaminees: [
      { assignmentId: "assignment-examinee", pairingIndex: 7 },
      { assignmentId: "assignment-examinee-2", pairingIndex: 1 },
    ],
  });

  assert.deepEqual(decision, {
    kind: "PAIR_WITH_EXISTING_INDEX",
    pairingIndex: 7,
    expectedInstructedPairingIndex: null,
    expectedExamineePairingIndex: 7,
  });
});

test("3. a missing examinee index allocates the SMALLEST positive unused integer", () => {
  // 1 and 3 are taken, 2 is free — a gap is reused rather than the numbers
  // drifting upward, and 0 is never a candidate.
  const decision = decideExamInstructedTraineePairing({
    instructed: instructedFacts(),
    examinee: examineeFacts(),
    sessionExaminees: [
      { assignmentId: "assignment-examinee", pairingIndex: null },
      { assignmentId: "e-a", pairingIndex: 1 },
      { assignmentId: "e-b", pairingIndex: 3 },
    ],
  });

  assert.deepEqual(decision, {
    kind: "PAIR_WITH_NEW_INDEX",
    pairingIndex: 2,
    expectedInstructedPairingIndex: null,
    expectedExamineePairingIndex: null,
  });
});

test("3b. the first pairing of an empty session allocates 1, never 0", () => {
  const decision = decideExamInstructedTraineePairing({
    instructed: instructedFacts(),
    examinee: examineeFacts(),
    sessionExaminees: [{ assignmentId: "assignment-examinee", pairingIndex: null }],
  });

  assert.equal(decision.kind === "PAIR_WITH_NEW_INDEX" && decision.pairingIndex, 1);
});

test("3c. non-positive and non-integer stored values never reserve a label", () => {
  // A stray 0, a negative and a fraction are all ignored by the allocator, so 1
  // is still free.
  const decision = decideExamInstructedTraineePairing({
    instructed: instructedFacts(),
    examinee: examineeFacts(),
    sessionExaminees: [
      { assignmentId: "assignment-examinee", pairingIndex: null },
      { assignmentId: "e-a", pairingIndex: 0 },
      { assignmentId: "e-b", pairingIndex: -4 },
      { assignmentId: "e-c", pairingIndex: 1.5 },
    ],
  });

  assert.equal(decision.kind === "PAIR_WITH_NEW_INDEX" && decision.pairingIndex, 1);
});

test("4. several instructed trainees may reuse ONE examinee's index", () => {
  const examinee = examineeFacts({ pairingIndex: 4 });
  const sessionExaminees = [{ assignmentId: "assignment-examinee", pairingIndex: 4 }];

  for (const id of ["instructed-a", "instructed-b", "instructed-c"]) {
    const decision = decideExamInstructedTraineePairing({
      instructed: instructedFacts({ assignmentId: id }),
      examinee,
      sessionExaminees,
    });
    assert.equal(decision.kind, "PAIR_WITH_EXISTING_INDEX");
    assert.equal(decision.kind === "PAIR_WITH_EXISTING_INDEX" && decision.pairingIndex, 4);
  }
});

test("5. two examinees can never share one pairing index", () => {
  // (a) an index already shared by two examinees is AMBIGUOUS and refuses.
  const ambiguous = decideExamInstructedTraineePairing({
    instructed: instructedFacts(),
    examinee: examineeFacts({ pairingIndex: 3 }),
    sessionExaminees: [
      { assignmentId: "assignment-examinee", pairingIndex: 3 },
      { assignmentId: "assignment-examinee-2", pairingIndex: 3 },
    ],
  });
  assert.deepEqual(ambiguous, { kind: "REFUSE", code: "ambiguous_pairing_index" });

  // (b) allocation never hands out a number another examinee already owns.
  const allocation = decideExamInstructedTraineePairing({
    instructed: instructedFacts(),
    examinee: examineeFacts(),
    sessionExaminees: [
      { assignmentId: "assignment-examinee", pairingIndex: null },
      { assignmentId: "e-a", pairingIndex: 1 },
      { assignmentId: "e-b", pairingIndex: 2 },
    ],
  });
  assert.equal(allocation.kind === "PAIR_WITH_NEW_INDEX" && allocation.pairingIndex, 3);
});

test("5b. an examinee index this module could not have written fails closed", () => {
  // A stored integer outside the allocator's own range is AMBIGUOUS: it is a
  // real label this module cannot explain, and reusing or overwriting it would
  // both be a guess.
  for (const stored of [0, -1]) {
    const decision = decideExamInstructedTraineePairing({
      instructed: instructedFacts(),
      examinee: examineeFacts({ pairingIndex: stored }),
      sessionExaminees: [{ assignmentId: "assignment-examinee", pairingIndex: stored }],
    });
    assert.deepEqual(
      decision,
      { kind: "REFUSE", code: "ambiguous_pairing_index" },
      `a stored ${stored} must not be reused or overwritten`,
    );
  }

  // A NON-INTEGER cannot come out of an `Int` column at all, so it is a
  // structurally unusable fact rather than an ambiguous label — and it still
  // writes nothing.
  const fractional = decideExamInstructedTraineePairing({
    instructed: instructedFacts(),
    examinee: examineeFacts({ pairingIndex: 2.5 }),
    sessionExaminees: [{ assignmentId: "assignment-examinee", pairingIndex: 2.5 }],
  });
  assert.deepEqual(fractional, { kind: "REFUSE", code: "invalid_input" });
});

test("6. two rows of DIFFERENT sessions are never a pair", () => {
  const decision = decideExamInstructedTraineePairing({
    instructed: instructedFacts(),
    examinee: examineeFacts({ sessionId: OTHER_SESSION, pairingIndex: 1 }),
    sessionExaminees: [],
  });

  assert.deepEqual(decision, { kind: "REFUSE", code: "different_sessions" });
});

test("7. the roles are checked, and anything unrecognized fails closed", () => {
  for (const role of ["EXAMINEE", "", "instructed_trainee", "SUPERVISOR"]) {
    const decision = decideExamInstructedTraineePairing({
      instructed: instructedFacts({ role }),
      examinee: examineeFacts({ pairingIndex: 1 }),
      sessionExaminees: [{ assignmentId: "assignment-examinee", pairingIndex: 1 }],
    });
    assert.deepEqual(
      decision,
      { kind: "REFUSE", code: "instructed_role_mismatch" },
      `role ${role} must not be paired as an instructed trainee`,
    );
  }

  for (const role of ["INSTRUCTED_TRAINEE", "", "examinee", "SUPERVISOR"]) {
    const decision = decideExamInstructedTraineePairing({
      instructed: instructedFacts(),
      examinee: examineeFacts({ role, pairingIndex: 1 }),
      sessionExaminees: [{ assignmentId: "assignment-examinee", pairingIndex: 1 }],
    });
    assert.deepEqual(
      decision,
      { kind: "REFUSE", code: "examinee_role_mismatch" },
      `role ${role} must not be paired to as an examinee`,
    );
  }
});

test("7b. one row can never be both halves of a pair", () => {
  const decision = decideExamInstructedTraineePairing({
    instructed: instructedFacts({ assignmentId: "same" }),
    examinee: examineeFacts({ assignmentId: "same", pairingIndex: 1 }),
    sessionExaminees: [],
  });

  assert.deepEqual(decision, { kind: "REFUSE", code: "invalid_input" });
});

test("7c. structurally unusable facts refuse before anything is decided", () => {
  const blank: ExamPairingAssignmentFacts[] = [
    instructedFacts({ assignmentId: "" }),
    instructedFacts({ assignmentId: "   " }),
    instructedFacts({ sessionId: "" }),
    instructedFacts({ pairingIndex: 1.5 }),
  ];
  for (const instructed of blank) {
    const decision = decideExamInstructedTraineePairing({
      instructed,
      examinee: examineeFacts({ pairingIndex: 1 }),
      sessionExaminees: [],
    });
    assert.deepEqual(decision, { kind: "REFUSE", code: "invalid_input" });
  }
});

test("8. UNPAIR describes the instructed row only, and only while it is current", () => {
  const decision = decideExamInstructedTraineePairing({
    instructed: instructedFacts({ pairingIndex: 5 }),
    examinee: null,
    sessionExaminees: [],
  });

  assert.deepEqual(decision, { kind: "UNPAIR", expectedInstructedPairingIndex: 5 });
  // There is no field anywhere on the decision through which an examinee row
  // could be cleared.
  assert.equal(JSON.stringify(decision).includes("examinee"), false);
});

test("8b. the decision never mutates its input", () => {
  const instructed = instructedFacts({ pairingIndex: 1 });
  const examinee = examineeFacts({ pairingIndex: 2 });
  const sessionExaminees = [{ assignmentId: "assignment-examinee", pairingIndex: 2 }];
  const snapshot = JSON.stringify({ instructed, examinee, sessionExaminees });

  decideExamInstructedTraineePairing({ instructed, examinee, sessionExaminees });

  assert.equal(JSON.stringify({ instructed, examinee, sessionExaminees }), snapshot);
});

test("8c. every decision is frozen and JSON-safe", () => {
  const decision = decideExamInstructedTraineePairing({
    instructed: instructedFacts(),
    examinee: examineeFacts(),
    sessionExaminees: [],
  });

  assert.equal(Object.isFrozen(decision), true);
  assert.deepEqual(JSON.parse(JSON.stringify(decision)), decision);
});

// ===========================================================================
// 9–16. The orchestration
// ===========================================================================

test("9. pairing runs the locked order and writes ONE atomic pair command", async () => {
  const { deps, recorded } = makeScenario({
    assignments: {
      "assignment-instructed": instructedFacts(),
      "assignment-examinee": examineeFacts(),
    },
    sessionExaminees: [{ assignmentId: "assignment-examinee", pairingIndex: null }],
  });

  const result = await setExamInstructedTraineePairingWithDeps(
    "requested-offering",
    "assignment-instructed",
    "assignment-examinee",
    deps,
  );

  assert.deepEqual(result, { ok: true, status: "PAIRED", pairingIndex: 1 });
  assert.deepEqual(recorded.calls, [
    "requireCourseContext:requested-offering",
    "assertConfigurationAllowed:ACTIVE",
    `findPlan:${OFFERING}`,
    `findAssignment:${PLAN}:assignment-instructed`,
    `findAssignment:${PLAN}:assignment-examinee`,
    `findSessionExaminees:${PLAN}:${SESSION}`,
    "pair",
  ]);
  // ONE command, naming BOTH rows — the atomicity contract the binding must
  // honour — and carrying an expected-current predicate for each of them.
  assert.equal(recorded.pairCommands.length, 1);
  assert.deepEqual(recorded.pairCommands[0], {
    planId: PLAN,
    sessionId: SESSION,
    instructedAssignmentId: "assignment-instructed",
    expectedInstructedPairingIndex: null,
    examineeAssignmentId: "assignment-examinee",
    expectedExamineePairingIndex: null,
    pairingIndex: 1,
  });
});

test("10. a no-op pairing performs NO write at all", async () => {
  const { deps, recorded } = makeScenario({
    assignments: {
      "assignment-instructed": instructedFacts({ pairingIndex: 2 }),
      "assignment-examinee": examineeFacts({ pairingIndex: 2 }),
    },
    sessionExaminees: [{ assignmentId: "assignment-examinee", pairingIndex: 2 }],
  });

  const result = await setExamInstructedTraineePairingWithDeps(
    OFFERING,
    "assignment-instructed",
    "assignment-examinee",
    deps,
  );

  assert.deepEqual(result, { ok: true, status: "NO_CHANGE", pairingIndex: 2 });
  assert.deepEqual(writeCalls(recorded), []);
});

test("10b. unpairing an already-unpaired trainee performs NO write at all", async () => {
  const { deps, recorded } = makeScenario({
    assignments: { "assignment-instructed": instructedFacts() },
  });

  const result = await setExamInstructedTraineePairingWithDeps(
    OFFERING,
    "assignment-instructed",
    null,
    deps,
  );

  assert.deepEqual(result, { ok: true, status: "NO_CHANGE", pairingIndex: null });
  assert.deepEqual(writeCalls(recorded), []);
  // An unpair reads no examinee list: there is nothing to allocate.
  assert.equal(
    recorded.calls.some((call) => call.startsWith("findSessionExaminees")),
    false,
  );
});

test("11. unpair issues ONE command that names only the instructed row", async () => {
  const { deps, recorded } = makeScenario({
    assignments: { "assignment-instructed": instructedFacts({ pairingIndex: 3 }) },
  });

  const result = await setExamInstructedTraineePairingWithDeps(
    OFFERING,
    "assignment-instructed",
    null,
    deps,
  );

  assert.deepEqual(result, { ok: true, status: "UNPAIRED", pairingIndex: null });
  assert.deepEqual(writeCalls(recorded), ["unpair"]);
  assert.deepEqual(recorded.unpairCommands[0], {
    planId: PLAN,
    sessionId: SESSION,
    instructedAssignmentId: "assignment-instructed",
    expectedInstructedPairingIndex: 3,
  });
  // The examinee's index is not an argument of the unpair boundary at all, so it
  // provably cannot be cleared by this path.
  assert.equal(
    Object.keys(recorded.unpairCommands[0]).some((key) => key.toLowerCase().includes("examinee")),
    false,
  );
});

test("12. a reused index writes the pair CONDITIONAL on the examinee still holding it", async () => {
  const { deps, recorded } = makeScenario({
    assignments: {
      "assignment-instructed": instructedFacts({ pairingIndex: 9 }),
      "assignment-examinee": examineeFacts({ pairingIndex: 4 }),
    },
    sessionExaminees: [{ assignmentId: "assignment-examinee", pairingIndex: 4 }],
  });

  const result = await setExamInstructedTraineePairingWithDeps(
    OFFERING,
    "assignment-instructed",
    "assignment-examinee",
    deps,
  );

  assert.deepEqual(result, { ok: true, status: "PAIRED", pairingIndex: 4 });
  assert.equal(recorded.pairCommands[0].expectedExamineePairingIndex, 4);
  assert.equal(recorded.pairCommands[0].expectedInstructedPairingIndex, 9);
});

test("13. a stale pairing write is refused, never retried", async () => {
  const { deps, recorded } = makeScenario({
    assignments: {
      "assignment-instructed": instructedFacts(),
      "assignment-examinee": examineeFacts(),
    },
    pairResult: false,
  });

  const result = await setExamInstructedTraineePairingWithDeps(
    OFFERING,
    "assignment-instructed",
    "assignment-examinee",
    deps,
  );

  assert.deepEqual(result, { ok: false, code: "stale_write" });
  assert.deepEqual(writeCalls(recorded), ["pair"]);
});

test("13b. a stale unpair write is refused, never retried", async () => {
  const { deps, recorded } = makeScenario({
    assignments: { "assignment-instructed": instructedFacts({ pairingIndex: 1 }) },
    unpairResult: false,
  });

  const result = await setExamInstructedTraineePairingWithDeps(
    OFFERING,
    "assignment-instructed",
    null,
    deps,
  );

  assert.deepEqual(result, { ok: false, code: "stale_write" });
  assert.deepEqual(writeCalls(recorded), ["unpair"]);
});

test("14. every read is scoped by the SERVER-VERIFIED offering, plan and session", async () => {
  const { deps, recorded } = makeScenario({
    assignments: {
      "assignment-instructed": instructedFacts(),
      "assignment-examinee": examineeFacts({ sessionId: SESSION }),
    },
  });

  await setExamInstructedTraineePairingWithDeps(
    // A REQUESTED offering id that differs from the verified one: nothing may be
    // scoped by it after the boundary answered.
    "requested-offering",
    "assignment-instructed",
    "assignment-examinee",
    deps,
  );

  assert.equal(recorded.calls.includes(`findPlan:${OFFERING}`), true);
  assert.equal(
    recorded.calls.some((call) => call.includes("requested-offering") && !call.startsWith("requireCourseContext")),
    false,
    "the unverified request id reached a later step",
  );
  for (const call of recorded.calls.filter((entry) => entry.startsWith("findAssignment"))) {
    assert.ok(call.startsWith(`findAssignment:${PLAN}:`), `${call} is not plan-scoped`);
  }
  // The session comes off the instructed row the server read, never from a
  // caller.
  assert.equal(recorded.calls.includes(`findSessionExaminees:${PLAN}:${SESSION}`), true);
});

test("15. a foreign or missing assignment refuses without a write", async () => {
  const missingInstructed = makeScenario({ assignments: {} });
  assert.deepEqual(
    await setExamInstructedTraineePairingWithDeps(OFFERING, "nope", "also-nope", missingInstructed.deps),
    { ok: false, code: "instructed_assignment_not_found" },
  );
  assert.deepEqual(writeCalls(missingInstructed.recorded), []);
  // The examinee is not even looked up once the instructed row is unknown.
  assert.equal(
    missingInstructed.recorded.calls.filter((call) => call.startsWith("findAssignment")).length,
    1,
  );

  const missingExaminee = makeScenario({
    assignments: { "assignment-instructed": instructedFacts() },
  });
  assert.deepEqual(
    await setExamInstructedTraineePairingWithDeps(
      OFFERING,
      "assignment-instructed",
      "assignment-examinee",
      missingExaminee.deps,
    ),
    { ok: false, code: "examinee_assignment_not_found" },
  );
  assert.deepEqual(writeCalls(missingExaminee.recorded), []);
});

test("16. no plan means nothing to pair, and no plan is ever created", async () => {
  const { deps, recorded } = makeScenario({ plan: null });

  const result = await setExamInstructedTraineePairingWithDeps(
    OFFERING,
    "assignment-instructed",
    null,
    deps,
  );

  assert.deepEqual(result, { ok: false, code: "plan_not_found" });
  assert.deepEqual(writeCalls(recorded), []);
  assert.equal(
    recorded.calls.some((call) => call.startsWith("findAssignment")),
    false,
  );
});

// ===========================================================================
// 17–22. The boundary: authorization, lifecycle, input
// ===========================================================================

test("17. authorization runs FIRST, and nothing about exams is read when it fails", async () => {
  class NotFound extends Error {}
  const { deps, recorded } = makeScenario({
    requireCourseContext: async () => {
      recorded.calls.push("requireCourseContext");
      throw new NotFound();
    },
    isCourseNotFoundError: (error) => error instanceof NotFound,
  });

  const result = await setExamInstructedTraineePairingWithDeps(
    OFFERING,
    "assignment-instructed",
    null,
    deps,
  );

  assert.deepEqual(result, { ok: false, code: "offering_not_found" });
  assert.deepEqual(recorded.calls, ["requireCourseContext"]);
});

test("18. an unrecognized authorization throw PROPAGATES — a redirect is never swallowed", async () => {
  class Redirect extends Error {}
  const { deps } = makeScenario({
    requireCourseContext: async () => {
      throw new Redirect();
    },
  });

  await assert.rejects(
    () => setExamInstructedTraineePairingWithDeps(OFFERING, "a", null, deps),
    Redirect,
  );
});

test("19. the lifecycle gate runs before any exam query", async () => {
  class Denied extends Error {}
  const { deps, recorded } = makeScenario({
    status: "ARCHIVED",
    assertConfigurationAllowed: () => {
      recorded.calls.push("assertConfigurationAllowed");
      throw new Denied();
    },
    isOperationNotAllowedError: (error) => error instanceof Denied,
  });

  const result = await setExamInstructedTraineePairingWithDeps(
    OFFERING,
    "assignment-instructed",
    "assignment-examinee",
    deps,
  );

  assert.deepEqual(result, { ok: false, code: "operation_not_allowed" });
  assert.deepEqual(recorded.calls, [
    `requireCourseContext:${OFFERING}`,
    "assertConfigurationAllowed",
  ]);
});

test("20. an unrecognized lifecycle throw PROPAGATES", async () => {
  class Boom extends Error {}
  const { deps } = makeScenario({
    assertConfigurationAllowed: () => {
      throw new Boom();
    },
  });

  await assert.rejects(
    () => setExamInstructedTraineePairingWithDeps(OFFERING, "a", null, deps),
    Boom,
  );
});

test("21. both id arguments are re-checked at runtime, before any exam query", async () => {
  const rejected: unknown[] = ["", "   ", undefined, 7, {}, [], null];

  for (const value of rejected) {
    const { deps, recorded } = makeScenario();
    const result = await setExamInstructedTraineePairingWithDeps(
      OFFERING,
      value,
      "assignment-examinee",
      deps,
    );
    assert.deepEqual(
      result,
      { ok: false, code: "invalid_input" },
      `instructed id ${String(value)} must be refused`,
    );
    assert.equal(
      recorded.calls.some((call) => call.startsWith("findPlan")),
      false,
      "an exam query ran for a malformed request",
    );
  }

  // `null` is the ONLY accepted non-string on the examinee side; everything else
  // is refused rather than read as an accidental unpair.
  for (const value of ["", "  ", undefined, 0, {}, []]) {
    const { deps, recorded } = makeScenario();
    const result = await setExamInstructedTraineePairingWithDeps(
      OFFERING,
      "assignment-instructed",
      value,
      deps,
    );
    assert.deepEqual(
      result,
      { ok: false, code: "invalid_input" },
      `examinee id ${String(value)} must be refused`,
    );
    assert.deepEqual(writeCalls(recorded), []);
  }
});

test("22. every result is frozen, JSON-safe and carries no id, date or PII", async () => {
  const { deps } = makeScenario({
    assignments: {
      "assignment-instructed": instructedFacts(),
      "assignment-examinee": examineeFacts(),
    },
  });

  const result = await setExamInstructedTraineePairingWithDeps(
    OFFERING,
    "assignment-instructed",
    "assignment-examinee",
    deps,
  );

  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  assert.deepEqual(Object.keys(result).sort(), ["ok", "pairingIndex", "status"]);
  const serialized = JSON.stringify(result);
  for (const leak of [PLAN, SESSION, OFFERING, "assignment-"]) {
    assert.equal(serialized.includes(leak), false, `the result leaked ${leak}`);
  }
});

// ===========================================================================
// 23–27. Structural claims about this module
// ===========================================================================

test("23. no caller can supply a pairing index, a session, a plan or an actor", () => {
  // The public orchestration takes FOUR parameters and not one of them is an
  // index, a session, a plan, a student or an actor.
  const signature = CORE_SOURCE.slice(
    CORE_SOURCE.indexOf("export async function setExamInstructedTraineePairingWithDeps("),
  ).slice(0, 400);
  assert.ok(signature.includes("courseOfferingId: string"));
  assert.ok(signature.includes("instructedTraineeAssignmentId: unknown"));
  assert.ok(signature.includes("examineeAssignmentId: unknown"));
  assert.ok(signature.includes("deps: SetExamInstructedTraineePairingDeps"));
  for (const forbidden of ["pairingIndex:", "sessionId:", "planId:", "studentId:", "actorId:", "now:"]) {
    assert.equal(
      signature.includes(forbidden),
      false,
      `the public signature accepts ${forbidden}`,
    );
  }
});

test("24. the module is DB-free, clock-free and env-free", () => {
  for (const token of [
    ["@/lib", "prisma"].join("/"),
    ["@prisma", "client"].join("/"),
    "process" + ".env",
    "Date" + ".now(",
    "new Date(",
    "Math" + ".random(",
    "server" + "-only",
    "use " + "server",
    "$transaction",
  ]) {
    assert.equal(CORE_CODE.includes(token), false, `the pure core references ${token}`);
  }
  // Its ONLY import is the type-only role vocabulary.
  const specifiers = [...CORE_CODE.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(specifiers)], ["./exam-domain-core"]);
  assert.ok(CORE_CODE.includes('import type { ExamAssignmentRole } from "./exam-domain-core"'));
});

test("25. the module never names orderIndex, and never writes any other column", () => {
  assert.equal(CORE_CODE.includes("orderIndex"), false, "orderIndex is modelled");
  for (const column of [
    "studentId:",
    "horseName:",
    "instructionTopic:",
    "discipline:",
    "notes:",
    "sourcePracticeRole:",
    "publishedAt:",
    "individualPublishedAt:",
  ]) {
    assert.equal(CORE_SOURCE.includes(column), false, `the core models ${column}`);
  }
});

test("26. the boundary exposes no create, delete, reorder, publish or notify effect", () => {
  const boundary = CORE_SOURCE.slice(
    CORE_SOURCE.indexOf("export interface SetExamInstructedTraineePairingDeps {"),
  );
  const body = boundary.slice(0, boundary.indexOf("\n}"));
  const methods = [...body.matchAll(/^\s{2}(\w+)\(/gm)].map(([, name]) => name).sort();
  assert.deepEqual(methods, [
    "assertConfigurationAllowed",
    "findAssignmentForPlan",
    "findExamPlanByCourseOfferingId",
    "findSessionExaminees",
    "isCourseNotFoundError",
    "isOperationNotAllowedError",
    "pairInstructedTrainee",
    "requireCourseContext",
    "unpairInstructedTrainee",
  ]);
});

test("27. the refusal vocabulary is fixed and has no catch-all", () => {
  const codes = CORE_SOURCE.slice(
    CORE_SOURCE.indexOf("export type SetExamInstructedTraineePairingRefusalCode ="),
  );
  const listed = [...codes.slice(0, codes.indexOf(";")).matchAll(/"([a-z_]+)"/g)].map(
    ([, code]) => code,
  );
  assert.deepEqual(listed, [
    "offering_not_found",
    "operation_not_allowed",
    "plan_not_found",
    "invalid_input",
    "instructed_assignment_not_found",
    "examinee_assignment_not_found",
    "instructed_role_mismatch",
    "examinee_role_mismatch",
    "different_sessions",
    "ambiguous_pairing_index",
    "stale_write",
  ]);
  for (const forbidden of ["unexpected", "unknown_error", "failed"]) {
    assert.equal(listed.includes(forbidden), false, `a catch-all code ${forbidden} exists`);
  }
});
