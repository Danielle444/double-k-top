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
  type ExamPairingDecision,
  type ExamPairingExamineeFacts,
  type ExamPairingInstructedTraineeFacts,
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

/**
 * The pure decision, with the ONE-TO-ONE fact set defaulting to EMPTY.
 *
 * An empty set means "no instructed trainee of this session claims anything", so
 * the one-to-one rule never fires — which is exactly what every test ABOUT
 * ANOTHER RULE wants to say, and says by omission rather than by repeating a
 * fixture 18 times. The tests that are about the rule state the set explicitly,
 * so no assertion below depends on this default silently changing meaning.
 */
function decide(input: {
  readonly instructed: ExamPairingAssignmentFacts;
  readonly examinee: ExamPairingAssignmentFacts | null;
  readonly sessionExaminees: readonly ExamPairingExamineeFacts[];
  readonly sessionInstructedTrainees?: readonly ExamPairingInstructedTraineeFacts[];
}): ExamPairingDecision {
  return decideExamInstructedTraineePairing({
    instructed: input.instructed,
    examinee: input.examinee,
    sessionExaminees: input.sessionExaminees,
    sessionInstructedTrainees: input.sessionInstructedTrainees ?? [],
  });
}

interface Scenario {
  readonly calls: string[];
  readonly pairCommands: ExamPairingWriteCommand[];
  readonly unpairCommands: ExamUnpairWriteCommand[];
}

interface ScenarioOptions {
  readonly assignments?: Record<string, ExamPairingAssignmentFacts>;
  readonly sessionExaminees?: readonly ExamPairingExamineeFacts[];
  readonly sessionInstructedTrainees?: readonly ExamPairingInstructedTraineeFacts[];
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
    findSessionInstructedTrainees: async (planId: string, sessionId: string) => {
      recorded.calls.push(`findSessionInstructedTrainees:${planId}:${sessionId}`);
      return options.sessionInstructedTrainees ?? [];
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
  const decision = decide({
    instructed: instructedFacts(),
    examinee: examineeFacts({ pairingIndex: 2 }),
    sessionExaminees: [{ assignmentId: "assignment-examinee", pairingIndex: 2 }],
  });

  assert.equal(decision.kind, "PAIR_WITH_EXISTING_INDEX");
  assert.equal(decision.kind === "PAIR_WITH_EXISTING_INDEX" && decision.pairingIndex, 2);
});

test("2. an existing UNIQUE examinee index is reused, never re-allocated", () => {
  const decision = decide({
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
  const decision = decide({
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
  const decision = decide({
    instructed: instructedFacts(),
    examinee: examineeFacts(),
    sessionExaminees: [{ assignmentId: "assignment-examinee", pairingIndex: null }],
  });

  assert.equal(decision.kind === "PAIR_WITH_NEW_INDEX" && decision.pairingIndex, 1);
});

test("3c. non-positive and non-integer stored values never reserve a label", () => {
  // A stray 0, a negative and a fraction are all ignored by the allocator, so 1
  // is still free.
  const decision = decide({
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

test("4. EX-PAIR-1TO1 — a SECOND instructed trainee is refused, and the first is not", () => {
  const examinee = examineeFacts({ pairingIndex: 4 });
  const sessionExaminees = [{ assignmentId: "assignment-examinee", pairingIndex: 4 }];

  // (a) the FIRST pairing succeeds: nobody claims this examinee yet.
  const first = decide({
    instructed: instructedFacts({ assignmentId: "instructed-a" }),
    examinee,
    sessionExaminees,
    sessionInstructedTrainees: [
      { assignmentId: "instructed-a", pairingIndex: null },
      { assignmentId: "instructed-b", pairingIndex: 9 },
    ],
  });
  assert.deepEqual(first, {
    kind: "PAIR_WITH_EXISTING_INDEX",
    pairingIndex: 4,
    expectedInstructedPairingIndex: null,
    expectedExamineePairingIndex: 4,
  });

  // (b) ...and once `instructed-a` holds that index, EVERY other trainee is
  //     refused, with a fixed code that names nobody.
  for (const id of ["instructed-b", "instructed-c"]) {
    const decision = decide({
      instructed: instructedFacts({ assignmentId: id }),
      examinee,
      sessionExaminees,
      sessionInstructedTrainees: [
        { assignmentId: "instructed-a", pairingIndex: 4 },
        { assignmentId: id, pairingIndex: null },
      ],
    });
    assert.deepEqual(
      decision,
      { kind: "REFUSE", code: "examinee_already_paired" },
      `${id} must not become a second partner`,
    );
  }
});

test("4b. EX-PAIR-1TO1 — the refusal carries NO id, name, count or partner", () => {
  const decision = decide({
    instructed: instructedFacts({ assignmentId: "instructed-b" }),
    examinee: examineeFacts({ pairingIndex: 4 }),
    sessionExaminees: [{ assignmentId: "assignment-examinee", pairingIndex: 4 }],
    sessionInstructedTrainees: [
      { assignmentId: "instructed-a", pairingIndex: 4 },
      { assignmentId: "instructed-b", pairingIndex: null },
    ],
  });

  // Exactly two keys, and neither can identify the occupant.
  assert.deepEqual(Object.keys(decision).sort(), ["code", "kind"]);
  const serialized = JSON.stringify(decision);
  for (const leak of ["instructed-a", "assignment-examinee", "4"]) {
    assert.equal(serialized.includes(leak), false, `the refusal echoes ${leak}`);
  }
});

test("4c. EX-PAIR-1TO1 — the trainee ALREADY holding the examinee is never its own rival", () => {
  const examinee = examineeFacts({ pairingIndex: 4 });
  const sessionExaminees = [{ assignmentId: "assignment-examinee", pairingIndex: 4 }];
  const sessionInstructedTrainees = [
    { assignmentId: "instructed-a", pairingIndex: 4 },
    { assignmentId: "instructed-b", pairingIndex: 7 },
  ];

  // Re-submitting the pairing it already holds is a NO_CHANGE, not a conflict.
  assert.deepEqual(
    decide({
      instructed: instructedFacts({ assignmentId: "instructed-a", pairingIndex: 4 }),
      examinee,
      sessionExaminees,
      sessionInstructedTrainees,
    }),
    { kind: "NO_CHANGE", pairingIndex: 4 },
  );

  // ...and so is moving BACK onto an examinee it is the sole claimant of: here
  // `instructed-a` carries a stale index nobody matches, and reclaiming 4 — which
  // only it ever held — is allowed rather than read as its own rivalry.
  const reclaim = decide({
    instructed: instructedFacts({ assignmentId: "instructed-a", pairingIndex: 8 }),
    examinee,
    sessionExaminees,
    sessionInstructedTrainees: [
      { assignmentId: "instructed-a", pairingIndex: 8 },
      { assignmentId: "instructed-b", pairingIndex: 7 },
    ],
  });
  assert.deepEqual(reclaim, {
    kind: "PAIR_WITH_EXISTING_INDEX",
    pairingIndex: 4,
    expectedInstructedPairingIndex: 8,
    expectedExamineePairingIndex: 4,
  });
});

test("4d. EX-PAIR-1TO1 — switching A -> B releases A and claims B in ONE write", () => {
  // Two examinees, two trainees. `instructed-a` is paired to examinee 1 and
  // moves to examinee 2, which nobody holds.
  const sessionExaminees = [
    { assignmentId: "examinee-1", pairingIndex: 1 },
    { assignmentId: "examinee-2", pairingIndex: 2 },
  ];

  const free = decide({
    instructed: instructedFacts({ assignmentId: "instructed-a", pairingIndex: 1 }),
    examinee: examineeFacts({ assignmentId: "examinee-2", pairingIndex: 2 }),
    sessionExaminees,
    sessionInstructedTrainees: [{ assignmentId: "instructed-a", pairingIndex: 1 }],
  });
  // ONE index moves. The release of examinee 1 IS the claim on examinee 2: there
  // is no second command, and no examinee row is cleared.
  assert.deepEqual(free, {
    kind: "PAIR_WITH_EXISTING_INDEX",
    pairingIndex: 2,
    expectedInstructedPairingIndex: 1,
    expectedExamineePairingIndex: 2,
  });

  // ...and when examinee 2 is OCCUPIED, the switch is refused and `instructed-a`
  // keeps its index: a REFUSE describes no write at all.
  const occupied = decide({
    instructed: instructedFacts({ assignmentId: "instructed-a", pairingIndex: 1 }),
    examinee: examineeFacts({ assignmentId: "examinee-2", pairingIndex: 2 }),
    sessionExaminees,
    sessionInstructedTrainees: [
      { assignmentId: "instructed-a", pairingIndex: 1 },
      { assignmentId: "instructed-b", pairingIndex: 2 },
    ],
  });
  assert.deepEqual(occupied, { kind: "REFUSE", code: "examinee_already_paired" });
});

test("4e. EX-PAIR-1TO1 — several DIFFERENT one-to-one pairs in one session all work", () => {
  const sessionExaminees = [
    { assignmentId: "examinee-1", pairingIndex: 1 },
    { assignmentId: "examinee-2", pairingIndex: 2 },
    { assignmentId: "examinee-3", pairingIndex: null },
  ];
  const sessionInstructedTrainees = [
    { assignmentId: "instructed-1", pairingIndex: 1 },
    { assignmentId: "instructed-2", pairingIndex: 2 },
    { assignmentId: "instructed-3", pairingIndex: null },
  ];

  // The two settled pairs are no-ops...
  for (const index of [1, 2]) {
    assert.deepEqual(
      decide({
        instructed: instructedFacts({
          assignmentId: `instructed-${index}`,
          pairingIndex: index,
        }),
        examinee: examineeFacts({ assignmentId: `examinee-${index}`, pairingIndex: index }),
        sessionExaminees,
        sessionInstructedTrainees,
      }),
      { kind: "NO_CHANGE", pairingIndex: index },
    );
  }

  // ...and the third pair forms, allocating the smallest free index. The rule
  // constrains partners, never how MANY pairs a session may hold.
  assert.deepEqual(
    decide({
      instructed: instructedFacts({ assignmentId: "instructed-3" }),
      examinee: examineeFacts({ assignmentId: "examinee-3" }),
      sessionExaminees,
      sessionInstructedTrainees,
    }),
    {
      kind: "PAIR_WITH_NEW_INDEX",
      pairingIndex: 3,
      expectedInstructedPairingIndex: null,
      expectedExamineePairingIndex: null,
    },
  );
});

test("4f. EX-PAIR-1TO1 — the SINGLE-EXAMINEE FALLBACK claims the examinee too", () => {
  // A session holding exactly ONE examinee: an instructed trainee with NO stored
  // index already READS as its partner, so it is already a claimant.
  const sessionExaminees = [{ assignmentId: "assignment-examinee", pairingIndex: null }];

  // (a) the session's ONLY trainee may still be paired explicitly — it is the
  //     claimant, and it is itself.
  assert.deepEqual(
    decide({
      instructed: instructedFacts({ assignmentId: "instructed-a" }),
      examinee: examineeFacts(),
      sessionExaminees,
      sessionInstructedTrainees: [{ assignmentId: "instructed-a", pairingIndex: null }],
    }),
    {
      kind: "PAIR_WITH_NEW_INDEX",
      pairingIndex: 1,
      expectedInstructedPairingIndex: null,
      expectedExamineePairingIndex: null,
    },
  );

  // (b) but a SECOND index-less trainee in that session is a second implied
  //     partner, so the write fails closed rather than authoring the pairing the
  //     fallback was already implying.
  assert.deepEqual(
    decide({
      instructed: instructedFacts({ assignmentId: "instructed-a" }),
      examinee: examineeFacts(),
      sessionExaminees,
      sessionInstructedTrainees: [
        { assignmentId: "instructed-a", pairingIndex: null },
        { assignmentId: "instructed-b", pairingIndex: null },
      ],
    }),
    { kind: "REFUSE", code: "examinee_already_paired" },
  );

  // (c) the fallback is a ONE-EXAMINEE rule and nothing else: add a second
  //     examinee and an index-less trainee resolves to NOBODY, so it claims
  //     nothing and the pairing is allowed again.
  assert.deepEqual(
    decide({
      instructed: instructedFacts({ assignmentId: "instructed-a" }),
      examinee: examineeFacts(),
      sessionExaminees: [
        { assignmentId: "assignment-examinee", pairingIndex: null },
        { assignmentId: "examinee-2", pairingIndex: 5 },
      ],
      sessionInstructedTrainees: [
        { assignmentId: "instructed-a", pairingIndex: null },
        { assignmentId: "instructed-b", pairingIndex: null },
      ],
    }),
    {
      kind: "PAIR_WITH_NEW_INDEX",
      pairingIndex: 1,
      expectedInstructedPairingIndex: null,
      expectedExamineePairingIndex: null,
    },
  );
});

test("4g. EX-PAIR-1TO1 — a DUPLICATED stored claim on the target fails closed", () => {
  // Two instructed trainees already share the target examinee's index. Neither
  // is the requester, so the examinee is occupied however that state arose, and
  // the request is refused rather than becoming a third claimant.
  assert.deepEqual(
    decide({
      instructed: instructedFacts({ assignmentId: "instructed-c" }),
      examinee: examineeFacts({ pairingIndex: 4 }),
      sessionExaminees: [{ assignmentId: "assignment-examinee", pairingIndex: 4 }],
      sessionInstructedTrainees: [
        { assignmentId: "instructed-a", pairingIndex: 4 },
        { assignmentId: "instructed-b", pairingIndex: 4 },
        { assignmentId: "instructed-c", pairingIndex: null },
      ],
    }),
    { kind: "REFUSE", code: "examinee_already_paired" },
  );

  // An AMBIGUOUS examinee index still wins: it is checked first, because a
  // number two examinees share identifies no examinee to be occupied at all.
  assert.deepEqual(
    decide({
      instructed: instructedFacts({ assignmentId: "instructed-c" }),
      examinee: examineeFacts({ pairingIndex: 4 }),
      sessionExaminees: [
        { assignmentId: "assignment-examinee", pairingIndex: 4 },
        { assignmentId: "examinee-2", pairingIndex: 4 },
      ],
      sessionInstructedTrainees: [
        { assignmentId: "instructed-a", pairingIndex: 4 },
        { assignmentId: "instructed-c", pairingIndex: null },
      ],
    }),
    { kind: "REFUSE", code: "ambiguous_pairing_index" },
  );
});

test("4h. EX-PAIR-1TO1 — UNPAIR is never refused by the rule, and releases the examinee", () => {
  // Releasing can only REDUCE the number of claimants, so an over-subscribed
  // session must never block the way OUT of it.
  assert.deepEqual(
    decide({
      instructed: instructedFacts({ assignmentId: "instructed-a", pairingIndex: 4 }),
      examinee: null,
      sessionExaminees: [{ assignmentId: "assignment-examinee", pairingIndex: 4 }],
      sessionInstructedTrainees: [
        { assignmentId: "instructed-a", pairingIndex: 4 },
        { assignmentId: "instructed-b", pairingIndex: 4 },
      ],
    }),
    { kind: "UNPAIR", expectedInstructedPairingIndex: 4 },
  );

  // ...and once `instructed-a` is gone from the session, the examinee it held is
  // free for somebody else: the very same request that was refused at 4(b) now
  // succeeds, with no other write in between.
  assert.deepEqual(
    decide({
      instructed: instructedFacts({ assignmentId: "instructed-b" }),
      examinee: examineeFacts({ pairingIndex: 4 }),
      sessionExaminees: [{ assignmentId: "assignment-examinee", pairingIndex: 4 }],
      sessionInstructedTrainees: [{ assignmentId: "instructed-b", pairingIndex: null }],
    }),
    {
      kind: "PAIR_WITH_EXISTING_INDEX",
      pairingIndex: 4,
      expectedInstructedPairingIndex: null,
      expectedExamineePairingIndex: 4,
    },
  );
});

test("5. two examinees can never share one pairing index", () => {
  // (a) an index already shared by two examinees is AMBIGUOUS and refuses.
  const ambiguous = decide({
    instructed: instructedFacts(),
    examinee: examineeFacts({ pairingIndex: 3 }),
    sessionExaminees: [
      { assignmentId: "assignment-examinee", pairingIndex: 3 },
      { assignmentId: "assignment-examinee-2", pairingIndex: 3 },
    ],
  });
  assert.deepEqual(ambiguous, { kind: "REFUSE", code: "ambiguous_pairing_index" });

  // (b) allocation never hands out a number another examinee already owns.
  const allocation = decide({
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
    const decision = decide({
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
  const fractional = decide({
    instructed: instructedFacts(),
    examinee: examineeFacts({ pairingIndex: 2.5 }),
    sessionExaminees: [{ assignmentId: "assignment-examinee", pairingIndex: 2.5 }],
  });
  assert.deepEqual(fractional, { kind: "REFUSE", code: "invalid_input" });
});

test("6. two rows of DIFFERENT sessions are never a pair", () => {
  const decision = decide({
    instructed: instructedFacts(),
    examinee: examineeFacts({ sessionId: OTHER_SESSION, pairingIndex: 1 }),
    sessionExaminees: [],
  });

  assert.deepEqual(decision, { kind: "REFUSE", code: "different_sessions" });
});

test("7. the roles are checked, and anything unrecognized fails closed", () => {
  for (const role of ["EXAMINEE", "", "instructed_trainee", "SUPERVISOR"]) {
    const decision = decide({
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
    const decision = decide({
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
  const decision = decide({
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
    const decision = decide({
      instructed,
      examinee: examineeFacts({ pairingIndex: 1 }),
      sessionExaminees: [],
    });
    assert.deepEqual(decision, { kind: "REFUSE", code: "invalid_input" });
  }
});

test("8. UNPAIR describes the instructed row only, and only while it is current", () => {
  const decision = decide({
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

  decide({ instructed, examinee, sessionExaminees });

  assert.equal(JSON.stringify({ instructed, examinee, sessionExaminees }), snapshot);
});

test("8c. every decision is frozen and JSON-safe", () => {
  const decision = decide({
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
    sessionInstructedTrainees: [{ assignmentId: "assignment-instructed", pairingIndex: null }],
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
    // EX-PAIR-1TO1's read sits HERE — after both rows are verified and scoped by
    // the SAME server-resolved plan and derived session, and before the decision.
    `findSessionInstructedTrainees:${PLAN}:${SESSION}`,
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
  // caller — and EX-PAIR-1TO1's read is scoped by exactly the same two ids, so
  // the rule can never be answered from another course's or another session's
  // trainees.
  assert.equal(recorded.calls.includes(`findSessionExaminees:${PLAN}:${SESSION}`), true);
  assert.equal(
    recorded.calls.includes(`findSessionInstructedTrainees:${PLAN}:${SESSION}`),
    true,
  );
});

test("14b. EX-PAIR-1TO1 refuses through the orchestration, and writes NOTHING", async () => {
  const { deps, recorded } = makeScenario({
    assignments: {
      "assignment-instructed": instructedFacts(),
      "assignment-examinee": examineeFacts({ pairingIndex: 3 }),
    },
    sessionExaminees: [{ assignmentId: "assignment-examinee", pairingIndex: 3 }],
    sessionInstructedTrainees: [
      { assignmentId: "occupant", pairingIndex: 3 },
      { assignmentId: "assignment-instructed", pairingIndex: null },
    ],
  });

  const result = await setExamInstructedTraineePairingWithDeps(
    OFFERING,
    "assignment-instructed",
    "assignment-examinee",
    deps,
  );

  assert.deepEqual(result, { ok: false, code: "examinee_already_paired" });
  assert.deepEqual(writeCalls(recorded), []);
  // The refused result carries the code and nothing else — not the occupant, not
  // the index it holds, not a count.
  assert.deepEqual(Object.keys(result).sort(), ["code", "ok"]);
  assert.equal(JSON.stringify(result).includes("occupant"), false);
});

test("14c. an UNPAIR issues no one-to-one read at all", async () => {
  const { deps, recorded } = makeScenario({
    assignments: { "assignment-instructed": instructedFacts({ pairingIndex: 3 }) },
    sessionInstructedTrainees: [
      { assignmentId: "occupant", pairingIndex: 3 },
      { assignmentId: "assignment-instructed", pairingIndex: 3 },
    ],
  });

  const result = await setExamInstructedTraineePairingWithDeps(
    OFFERING,
    "assignment-instructed",
    null,
    deps,
  );

  // Releasing can only REDUCE the claimants, so the rule has nothing to say and
  // the query that answers it is never issued.
  assert.deepEqual(result, { ok: true, status: "UNPAIRED", pairingIndex: null });
  assert.equal(
    recorded.calls.some((call) => call.startsWith("findSessionInstructedTrainees")),
    false,
  );
  assert.equal(
    recorded.calls.some((call) => call.startsWith("findSessionExaminees")),
    false,
  );
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
  // Its imports are EXACTLY two, and both are PURE sibling cores: the type-only
  // role vocabulary, and — RE-POINTED by EX-PAIR-1TO1 — the committed pairing
  // resolution, which this module ASKS rather than restating so the writer and
  // every reader cannot disagree about who is already paired. Nothing else is
  // reachable, and neither import brings a database, a clock or an environment
  // with it (asserted for the timetable core in its own suite, and by the token
  // sweep above for this one).
  const specifiers = [...CORE_CODE.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(specifiers)].sort(), [
    "./exam-block-timetable-core",
    "./exam-domain-core",
  ]);
  assert.ok(CORE_CODE.includes('import type { ExamAssignmentRole } from "./exam-domain-core"'));
  assert.ok(
    CORE_CODE.includes('import { resolveExamPairings } from "./exam-block-timetable-core"'),
  );
  // The rule is ASKED, never copied: this module contains no pairing index map,
  // no ambiguity set and no fallback of its own.
  for (const token of ["soleExaminee", "byPairingIndex", "new Map(", "indexExaminee"]) {
    assert.equal(CORE_CODE.includes(token), false, `the core restates ${token}`);
  }
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
    "findSessionInstructedTrainees",
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
    // EX-PAIR-1TO1's one addition, and it is FIXED: one code for "this examinee
    // already has an instructed trainee", with no variant that says which.
    "examinee_already_paired",
    "stale_write",
  ]);
  for (const forbidden of ["unexpected", "unknown_error", "failed"]) {
    assert.equal(listed.includes(forbidden), false, `a catch-all code ${forbidden} exists`);
  }
});
