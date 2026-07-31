/**
 * EXAM EX-ASG-IT1 — executable tests for the PURE INSTRUCTED_TRAINEE assignment
 * CREATE orchestration (create-exam-instructed-trainee-assignment-core.ts).
 *
 * Run with:
 *   npx tsx --test lib/exam/create-exam-instructed-trainee-assignment-core.test.ts
 *
 * DB-FREE: every dependency is a fake, no database connection is opened, no SQL
 * is executed, no environment variable is read, and no production identifier
 * appears anywhere. The only files read are module SOURCE TEXTS, by the
 * structural guards at the bottom.
 *
 * SCOPE OF PROOF:
 *   - the INPUT model: exactly `sessionId` and `studentId`, trimmed, non-blank,
 *     uncoerced, unprobed, and NOTHING else read — `horseName`, `role`,
 *     `orderIndex` and `pairingIndex` above all;
 *   - the LOCKED ORDER: authorize -> gate -> resolve plan -> validate input ->
 *     verify session -> definition gate -> verify trainee -> write, and, for every
 *     failure, exactly WHICH later dependencies are skipped;
 *   - that the VERIFIED offering id — never the requested one — reaches the plan
 *     and eligibility lookups, and that the session is resolved under the
 *     SERVER-RESOLVED plan;
 *   - that the STORED session id and the ELIGIBLE trainee id, not the submitted
 *     ones, are what the write receives;
 *   - that the role is this module's constant and can never come from input;
 *   - the FAIL-CLOSED definition gate, and that the topic/discipline/kind facts
 *     are neither modelled nor consulted;
 *   - that a uniqueness violation is the ordinary, ROLE-BLIND
 *     `assignment_conflict`, and that everything else — including a
 *     redirect-shaped throw — propagates unchanged with its identity intact;
 *   - the result model: narrow, plain, frozen, JSON-round-trippable, non-echoing.
 *
 * NOTE ON IDS: the fixtures use obviously-fake, hyphenated ids, and the requested
 * and verified values are deliberately DIFFERENT so a test can prove which one
 * flows onward. No production identifier is written here.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  createExamInstructedTraineeAssignmentWithDeps,
  type CreateExamInstructedTraineeAssignmentDeps,
  type CreateExamInstructedTraineeAssignmentResult,
  type CreatedExamInstructedTraineeAssignmentRecord,
  type EligibleExamInstructedTrainee,
  type NewInstructedTraineeAssignment,
  type ResolvedExamPlanForInstructedTraineeCreate,
  type VerifiedExamSessionForInstructedTraineeCreate,
} from "./create-exam-instructed-trainee-assignment-core";

// ===========================================================================
// Fixtures
// ===========================================================================

/** What the caller ASKS for. Deliberately different from what is verified. */
const REQUESTED_OFFERING_ID = "offering-as-requested";
/** What the boundary VERIFIED. Only this may reach the plan and roster lookups. */
const VERIFIED_OFFERING_ID = "offering-as-verified";
/** The plan the SERVER resolved. Only this may reach the scoped session read. */
const SERVER_PLAN_ID = "plan-resolved-by-server";

/** The session the CLIENT submitted. */
const SUBMITTED_SESSION_ID = "session-as-submitted";
/** The id of the row the plan-scoped read actually returned. */
const STORED_SESSION_ID = "session-as-stored";

/** The trainee the CLIENT submitted. */
const SUBMITTED_STUDENT_ID = "student-as-submitted";
/** The id the ELIGIBILITY check returned. Only this may reach the write. */
const ELIGIBLE_STUDENT_ID = "student-as-eligible";

const CREATED_ASSIGNMENT_ID = "assignment-as-created";
const ASSIGNED_ORDER_INDEX = 4;

const SESSION_ISSUE = "EX-ASG-IN-SESSION-REQUIRED";
const STUDENT_ISSUE = "EX-ASG-IN-STUDENT-REQUIRED";

function validInput(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sessionId: SUBMITTED_SESSION_ID,
    studentId: SUBMITTED_STUDENT_ID,
    ...over,
  };
}

/**
 * A stored session whose definition DOES require an instructed trainee. The
 * `requiresInstructedTrainee` value is deliberately widened so a test can hand
 * the gate a defensive non-boolean the declared type would otherwise forbid.
 */
function storedSession(
  requiresInstructedTrainee: unknown,
): VerifiedExamSessionForInstructedTraineeCreate {
  return {
    id: STORED_SESSION_ID,
    requiresInstructedTrainee:
      requiresInstructedTrainee as VerifiedExamSessionForInstructedTraineeCreate["requiresInstructedTrainee"],
  };
}

/**
 * The DEFAULT stored session: a definition that DOES require an instructed
 * trainee. Kept separate from `storedSession` so that passing `undefined` to the
 * gate is a real test of the fail-closed reading rather than a parameter default.
 */
function permittingSession(): VerifiedExamSessionForInstructedTraineeCreate {
  return storedSession(true);
}

/** The typed not-found the real course boundary throws. */
class FakeCourseNotFoundError extends Error {}
/** The typed denial the real lifecycle policy throws. */
class FakeOperationDeniedError extends Error {}
/** The typed uniqueness violation the real write binding classifies. */
class FakeUniqueViolationError extends Error {}

/**
 * A framework REDIRECT throw, as the admin boundary produces for an
 * unauthenticated caller. It carries a `digest` and no `code`, and no classifier
 * may recognize it.
 */
function redirectLikeError(): Error {
  const error = new Error("REDIRECT_SENTINEL");
  (error as unknown as { digest: string }).digest = "REDIRECT;replace;/login;307;";
  return error;
}

interface HarnessOptions {
  readonly status?: string;
  readonly plan?: ResolvedExamPlanForInstructedTraineeCreate | null;
  readonly session?: VerifiedExamSessionForInstructedTraineeCreate | null;
  readonly trainee?: EligibleExamInstructedTrainee | null;
  readonly created?: CreatedExamInstructedTraineeAssignmentRecord;
  readonly contextThrows?: unknown;
  readonly gateThrows?: unknown;
  readonly planThrows?: unknown;
  readonly sessionThrows?: unknown;
  readonly traineeThrows?: unknown;
  readonly createThrows?: unknown;
}

interface Harness {
  /** Dependency names, in the exact order they were invoked. */
  readonly calls: string[];
  readonly contextArgs: string[];
  readonly gateArgs: string[];
  readonly planLookupArgs: string[];
  readonly sessionArgs: { planId: string; sessionId: string }[];
  readonly traineeArgs: { courseOfferingId: string; studentId: string }[];
  readonly writeArgs: { sessionId: string; value: NewInstructedTraineeAssignment }[];
  readonly deps: CreateExamInstructedTraineeAssignmentDeps;
}

/**
 * Build a recording fake boundary. The three classifiers are precise `instanceof`
 * checks and never a catch-all, so a test that expects propagation is proving
 * something real.
 */
function harness(options: HarnessOptions = {}): Harness {
  const calls: string[] = [];
  const contextArgs: string[] = [];
  const gateArgs: string[] = [];
  const planLookupArgs: string[] = [];
  const sessionArgs: { planId: string; sessionId: string }[] = [];
  const traineeArgs: { courseOfferingId: string; studentId: string }[] = [];
  const writeArgs: { sessionId: string; value: NewInstructedTraineeAssignment }[] = [];

  const deps: CreateExamInstructedTraineeAssignmentDeps = {
    requireCourseContext: async (requestedCourseOfferingId) => {
      calls.push("requireCourseContext");
      contextArgs.push(requestedCourseOfferingId);
      if ("contextThrows" in options) throw options.contextThrows;
      return {
        courseOfferingId: VERIFIED_OFFERING_ID,
        status: options.status ?? "ACTIVE",
      };
    },
    assertConfigurationAllowed: (status) => {
      calls.push("assertConfigurationAllowed");
      gateArgs.push(status);
      if ("gateThrows" in options) throw options.gateThrows;
    },
    findExamPlanByCourseOfferingId: async (verifiedCourseOfferingId) => {
      calls.push("findExamPlanByCourseOfferingId");
      planLookupArgs.push(verifiedCourseOfferingId);
      if ("planThrows" in options) throw options.planThrows;
      return options.plan === undefined ? { id: SERVER_PLAN_ID } : options.plan;
    },
    findSessionForPlan: async (planId, sessionId) => {
      calls.push("findSessionForPlan");
      sessionArgs.push({ planId, sessionId });
      if ("sessionThrows" in options) throw options.sessionThrows;
      return options.session === undefined ? permittingSession() : options.session;
    },
    findEligibleTrainee: async (courseOfferingId, studentId) => {
      calls.push("findEligibleTrainee");
      traineeArgs.push({ courseOfferingId, studentId });
      if ("traineeThrows" in options) throw options.traineeThrows;
      return options.trainee === undefined
        ? { studentId: ELIGIBLE_STUDENT_ID }
        : options.trainee;
    },
    createAssignmentAtNextOrder: async (sessionId, value) => {
      calls.push("createAssignmentAtNextOrder");
      writeArgs.push({ sessionId, value });
      if ("createThrows" in options) throw options.createThrows;
      return (
        options.created ?? {
          id: CREATED_ASSIGNMENT_ID,
          orderIndex: ASSIGNED_ORDER_INDEX,
        }
      );
    },
    isCourseNotFoundError: (error) => error instanceof FakeCourseNotFoundError,
    isOperationNotAllowedError: (error) => error instanceof FakeOperationDeniedError,
    isUniqueConstraintError: (error) => error instanceof FakeUniqueViolationError,
  };

  return {
    calls,
    contextArgs,
    gateArgs,
    planLookupArgs,
    sessionArgs,
    traineeArgs,
    writeArgs,
    deps,
  };
}

function run(
  rawInput: unknown,
  options: HarnessOptions = {},
): Promise<[CreateExamInstructedTraineeAssignmentResult, Harness]> {
  const built = harness(options);
  return createExamInstructedTraineeAssignmentWithDeps(
    REQUESTED_OFFERING_ID,
    rawInput,
    built.deps,
  ).then((result) => [result, built]);
}

/** The issue codes of an `invalid_input` refusal, in the order produced. */
function issueCodes(result: CreateExamInstructedTraineeAssignmentResult): string[] {
  assert.equal(result.ok, false);
  assert.equal("issues" in result, true, `expected invalid_input, got: ${JSON.stringify(result)}`);
  return (result as { issues: readonly { code: string }[] }).issues.map((issue) => issue.code);
}

// ===========================================================================
// 1–14. The input model
// ===========================================================================

test("1. two trimmed, non-blank strings are accepted", async () => {
  const [result] = await run(validInput());
  assert.deepEqual(result, {
    ok: true,
    assignmentId: CREATED_ASSIGNMENT_ID,
    orderIndex: ASSIGNED_ORDER_INDEX,
  });
});

test("2. leading and trailing whitespace is trimmed off both fields", async () => {
  const [result, built] = await run({
    sessionId: `  \t${SUBMITTED_SESSION_ID}\n `,
    studentId: `\n ${SUBMITTED_STUDENT_ID}  `,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(built.sessionArgs, [
    { planId: SERVER_PLAN_ID, sessionId: SUBMITTED_SESSION_ID },
  ]);
  assert.deepEqual(built.traineeArgs, [
    { courseOfferingId: VERIFIED_OFFERING_ID, studentId: SUBMITTED_STUDENT_ID },
  ]);
});

test("3. a blank session id is refused with the session code alone", async () => {
  for (const blank of ["", "   ", "\t\n"]) {
    const [result] = await run(validInput({ sessionId: blank }));
    assert.deepEqual(issueCodes(result), [SESSION_ISSUE]);
  }
});

test("4. a blank trainee id is refused with the student code alone", async () => {
  for (const blank of ["", "  ", "\n"]) {
    const [result] = await run(validInput({ studentId: blank }));
    assert.deepEqual(issueCodes(result), [STUDENT_ISSUE]);
  }
});

test("5. both issues are reported together, in a STABLE order", async () => {
  const [result] = await run({ sessionId: "  ", studentId: "" });
  assert.deepEqual(issueCodes(result), [SESSION_ISSUE, STUDENT_ISSUE]);

  // The order does not depend on the raw object's key order.
  const [reversed] = await run({ studentId: "", sessionId: "  " });
  assert.deepEqual(issueCodes(reversed), [SESSION_ISSUE, STUDENT_ISSUE]);
});

test("6. a null or undefined raw input yields BOTH issues and never throws", async () => {
  for (const raw of [null, undefined]) {
    const [result] = await run(raw);
    assert.deepEqual(issueCodes(result), [SESSION_ISSUE, STUDENT_ISSUE]);
  }
});

test("7. a non-object raw input of every shape yields BOTH issues", async () => {
  const raws: unknown[] = [
    42,
    0,
    NaN,
    true,
    false,
    "session-as-submitted",
    "",
    Symbol("submission"),
    () => validInput(),
    BigInt(123),
  ];
  for (const raw of raws) {
    const [result] = await run(raw);
    assert.deepEqual(
      issueCodes(result),
      [SESSION_ISSUE, STUDENT_ISSUE],
      `raw ${String(typeof raw)} was accepted`,
    );
  }
});

test("8. an array raw input yields BOTH issues, and its entries are never read", async () => {
  const [result] = await run([SUBMITTED_SESSION_ID, SUBMITTED_STUDENT_ID]);
  assert.deepEqual(issueCodes(result), [SESSION_ISSUE, STUDENT_ISSUE]);
});

test("9. every non-string FIELD value fails closed, uncoerced, on both fields", async () => {
  const values: unknown[] = [
    42,
    0,
    true,
    false,
    null,
    undefined,
    [SUBMITTED_SESSION_ID],
    { id: SUBMITTED_SESSION_ID },
    Symbol("id"),
    () => SUBMITTED_SESSION_ID,
    BigInt(123),
    new Map(),
  ];
  for (const value of values) {
    const [bySession] = await run(validInput({ sessionId: value }));
    assert.deepEqual(issueCodes(bySession), [SESSION_ISSUE], `session accepted ${String(typeof value)}`);
    const [byStudent] = await run(validInput({ studentId: value }));
    assert.deepEqual(issueCodes(byStudent), [STUDENT_ISSUE], `student accepted ${String(typeof value)}`);
  }
});

test("10. a custom toString / valueOf is NEVER probed", async () => {
  let probed = false;
  const probe = {
    toString() {
      probed = true;
      return SUBMITTED_SESSION_ID;
    },
    valueOf() {
      probed = true;
      return SUBMITTED_SESSION_ID;
    },
    get name() {
      probed = true;
      return SUBMITTED_SESSION_ID;
    },
  };
  const [result] = await run(validInput({ sessionId: probe }));
  assert.equal(probed, false, "the core probed a member of the submitted value");
  assert.deepEqual(issueCodes(result), [SESSION_ISSUE]);
});

test("11. INHERITED properties are not submitted data", async () => {
  const raw = Object.create({
    sessionId: SUBMITTED_SESSION_ID,
    studentId: SUBMITTED_STUDENT_ID,
  }) as Record<string, unknown>;
  const [result] = await run(raw);
  assert.deepEqual(issueCodes(result), [SESSION_ISSUE, STUDENT_ISSUE]);
});

test("12. ONLY sessionId and studentId are ever read from the raw input", async () => {
  const read: string[] = [];
  const raw = new Proxy(validInput(), {
    get(targetObject, key, receiver) {
      if (typeof key === "string") read.push(key);
      return Reflect.get(targetObject, key, receiver);
    },
    has(targetObject, key) {
      if (typeof key === "string") read.push(key);
      return Reflect.has(targetObject, key);
    },
  });
  const [result] = await run(raw);
  assert.equal(result.ok, true);
  assert.deepEqual([...new Set(read)].sort(), ["sessionId", "studentId"]);
});

test("13. a submitted role, horse, order or pairing is IGNORED, not honoured", async () => {
  const [result, built] = await run(
    validInput({
      role: "EXAMINEE",
      horseName: "כוכב",
      orderIndex: 99,
      pairingIndex: 7,
      instructionTopic: "topic-as-submitted",
      discipline: "discipline-as-submitted",
      notes: "notes-as-submitted",
      planId: "plan-as-submitted",
      courseOfferingId: "offering-as-smuggled",
      definitionId: "definition-as-submitted",
      id: "assignment-as-submitted",
    }),
  );
  assert.equal(result.ok, true);

  const [write] = built.writeArgs;
  assert.deepEqual(write.value, {
    studentId: ELIGIBLE_STUDENT_ID,
    role: "INSTRUCTED_TRAINEE",
  });
  // The smuggled offering id never reached the plan or roster lookups either.
  assert.deepEqual(built.planLookupArgs, [VERIFIED_OFFERING_ID]);
  assert.deepEqual(built.traineeArgs, [
    { courseOfferingId: VERIFIED_OFFERING_ID, studentId: SUBMITTED_STUDENT_ID },
  ]);
});

test("14. a MISSING horseName is not a problem: this role carries no horse", async () => {
  const [result] = await run({
    sessionId: SUBMITTED_SESSION_ID,
    studentId: SUBMITTED_STUDENT_ID,
  });
  assert.equal(result.ok, true);
  // ...and there is no horse issue code anywhere in the outcome.
  assert.equal(JSON.stringify(result).includes("HORSE"), false);
});

// ===========================================================================
// 15–19. The role
// ===========================================================================

test("15. the write payload is EXACTLY a studentId and the fixed role", async () => {
  const [, built] = await run(validInput());
  const [write] = built.writeArgs;
  assert.deepEqual(Object.keys(write.value).sort(), ["role", "studentId"]);
  assert.equal(write.value.role, "INSTRUCTED_TRAINEE");
});

test("16. the role is ALWAYS the literal, whatever the input claims", async () => {
  for (const claimed of ["EXAMINEE", "INSTRUCTED_TRAINEE", "ADMIN", "", null, 7, undefined]) {
    const [result, built] = await run(validInput({ role: claimed }));
    assert.equal(result.ok, true);
    assert.equal(built.writeArgs[0].value.role, "INSTRUCTED_TRAINEE");
  }
});

test("17. the write payload has NO horse, pairing, topic, discipline or notes", async () => {
  const [, built] = await run(
    validInput({ horseName: "כוכב", pairingIndex: 1, instructionTopic: "t", discipline: "d", notes: "n" }),
  );
  const payload = built.writeArgs[0].value as unknown as Record<string, unknown>;
  for (const forbidden of [
    "horseName",
    "pairingIndex",
    "instructionTopic",
    "discipline",
    "notes",
    "orderIndex",
    "sessionId",
    "planId",
    "courseOfferingId",
    "sourcePracticeRole",
  ]) {
    assert.equal(forbidden in payload, false, `the payload carries ${forbidden}`);
  }
});

test("18. the write receives the STORED session id, not the submitted one", async () => {
  const [, built] = await run(validInput());
  assert.equal(built.writeArgs[0].sessionId, STORED_SESSION_ID);
  assert.notEqual(built.writeArgs[0].sessionId, SUBMITTED_SESSION_ID);
});

test("19. the write receives the ELIGIBLE trainee id, not the submitted one", async () => {
  const [, built] = await run(validInput());
  assert.equal(built.writeArgs[0].value.studentId, ELIGIBLE_STUDENT_ID);
  assert.notEqual(built.writeArgs[0].value.studentId, SUBMITTED_STUDENT_ID);
});

// ===========================================================================
// 20–29. The locked call order and every short circuit
// ===========================================================================

test("20. the success path calls the dependencies in EXACTLY the locked order", async () => {
  const [result, built] = await run(validInput());
  assert.equal(result.ok, true);
  assert.deepEqual(built.calls, [
    "requireCourseContext",
    "assertConfigurationAllowed",
    "findExamPlanByCourseOfferingId",
    "findSessionForPlan",
    "findEligibleTrainee",
    "createAssignmentAtNextOrder",
  ]);
  // The REQUESTED id reaches only the boundary; the VERIFIED one reaches the rest.
  assert.deepEqual(built.contextArgs, [REQUESTED_OFFERING_ID]);
  assert.deepEqual(built.gateArgs, ["ACTIVE"]);
  assert.deepEqual(built.planLookupArgs, [VERIFIED_OFFERING_ID]);
  assert.deepEqual(built.sessionArgs, [
    { planId: SERVER_PLAN_ID, sessionId: SUBMITTED_SESSION_ID },
  ]);
});

test("21. offering_not_found stops before the gate and every query", async () => {
  const [result, built] = await run(validInput(), {
    contextThrows: new FakeCourseNotFoundError("nope"),
  });
  assert.deepEqual(result, { ok: false, code: "offering_not_found" });
  assert.deepEqual(built.calls, ["requireCourseContext"]);
});

test("22. operation_not_allowed stops before ANY exam query", async () => {
  const [result, built] = await run(validInput(), {
    status: "ARCHIVED",
    gateThrows: new FakeOperationDeniedError("archived"),
  });
  assert.deepEqual(result, { ok: false, code: "operation_not_allowed" });
  assert.deepEqual(built.calls, ["requireCourseContext", "assertConfigurationAllowed"]);
  assert.deepEqual(built.gateArgs, ["ARCHIVED"]);
});

test("23. plan_not_found stops before the input is even validated", async () => {
  // The input is deliberately INVALID: if validation ran first, the outcome would
  // be `invalid_input` instead, which is the ordering this proves.
  const [result, built] = await run({ sessionId: "", studentId: "" }, { plan: null });
  assert.deepEqual(result, { ok: false, code: "plan_not_found" });
  assert.deepEqual(built.calls, [
    "requireCourseContext",
    "assertConfigurationAllowed",
    "findExamPlanByCourseOfferingId",
  ]);
});

test("24. invalid_input stops before the session, roster and write", async () => {
  const [result, built] = await run({ sessionId: "  " });
  assert.deepEqual(issueCodes(result), [SESSION_ISSUE, STUDENT_ISSUE]);
  assert.deepEqual(built.calls, [
    "requireCourseContext",
    "assertConfigurationAllowed",
    "findExamPlanByCourseOfferingId",
  ]);
});

test("25. session_not_found stops before the roster and the write", async () => {
  const [result, built] = await run(validInput(), { session: null });
  assert.deepEqual(result, { ok: false, code: "session_not_found" });
  assert.deepEqual(built.calls, [
    "requireCourseContext",
    "assertConfigurationAllowed",
    "findExamPlanByCourseOfferingId",
    "findSessionForPlan",
  ]);
});

test("26. a FOREIGN session is indistinguishable from a missing one", async () => {
  // The fake returns null for a session under another plan, exactly as a
  // plan-scoped read does; the caller learns nothing about which case it was.
  const [missing] = await run(validInput(), { session: null });
  const [foreign] = await run(validInput({ sessionId: "session-of-another-course" }), {
    session: null,
  });
  assert.deepEqual(missing, foreign);
});

test("27. the definition gate refuses BEFORE the roster is touched", async () => {
  const [result, built] = await run(validInput(), { session: storedSession(false) });
  assert.deepEqual(result, {
    ok: false,
    code: "definition_does_not_require_instructed_trainee",
  });
  assert.deepEqual(built.calls, [
    "requireCourseContext",
    "assertConfigurationAllowed",
    "findExamPlanByCourseOfferingId",
    "findSessionForPlan",
  ]);
  assert.deepEqual(built.traineeArgs, [], "the roster was probed through a refused create");
});

test("28. trainee_not_eligible stops before the write", async () => {
  const [result, built] = await run(validInput(), { trainee: null });
  assert.deepEqual(result, { ok: false, code: "trainee_not_eligible" });
  assert.deepEqual(built.calls, [
    "requireCourseContext",
    "assertConfigurationAllowed",
    "findExamPlanByCourseOfferingId",
    "findSessionForPlan",
    "findEligibleTrainee",
  ]);
  assert.deepEqual(built.writeArgs, []);
});

test("29. assignment_conflict is reached only AFTER the whole chain ran", async () => {
  const [result, built] = await run(validInput(), {
    createThrows: new FakeUniqueViolationError("duplicate"),
  });
  assert.deepEqual(result, { ok: false, code: "assignment_conflict" });
  assert.deepEqual(built.calls, [
    "requireCourseContext",
    "assertConfigurationAllowed",
    "findExamPlanByCourseOfferingId",
    "findSessionForPlan",
    "findEligibleTrainee",
    "createAssignmentAtNextOrder",
  ]);
});

// ===========================================================================
// 30–34. The definition gate
// ===========================================================================

test("30. requiresInstructedTrainee === true is the ONLY value that proceeds", async () => {
  const [result, built] = await run(validInput(), { session: storedSession(true) });
  assert.equal(result.ok, true);
  assert.equal(built.writeArgs.length, 1);
});

test("31. false, null and undefined all refuse, and write nothing", async () => {
  for (const flag of [false, null, undefined]) {
    const [result, built] = await run(validInput(), { session: storedSession(flag) });
    assert.deepEqual(
      result,
      { ok: false, code: "definition_does_not_require_instructed_trainee" },
      `flag ${String(flag)} was accepted`,
    );
    assert.deepEqual(built.writeArgs, []);
  }
});

test("32. every defensive NON-BOOLEAN value fails closed", async () => {
  const flags: unknown[] = [
    "true",
    "TRUE",
    1,
    0,
    -1,
    "1",
    {},
    [],
    [true],
    NaN,
    Symbol("true"),
    () => true,
  ];
  for (const flag of flags) {
    const [result] = await run(validInput(), { session: storedSession(flag) });
    assert.deepEqual(
      result,
      { ok: false, code: "definition_does_not_require_instructed_trainee" },
      `defensive flag ${String(typeof flag)} was accepted`,
    );
  }
});

test("33. the topic and discipline demands are NOT consulted", async () => {
  // Both flags are attached to the verified session the fake returns. The gate
  // must ignore them completely: they describe the EXAMINEE's row, not this one.
  const session = {
    ...storedSession(true),
    requiresLessonTopic: true,
    requiresDiscipline: true,
  } as VerifiedExamSessionForInstructedTraineeCreate;
  const [result] = await run(validInput(), { session });
  assert.equal(result.ok, true, "a topic/discipline demand blocked the instructed trainee");
});

test("34. the definition's KIND is not consulted either", async () => {
  const session = {
    ...storedSession(true),
    definitionKind: "LUNGE_NO_RIDER",
    kind: "LUNGE_NO_RIDER",
  } as VerifiedExamSessionForInstructedTraineeCreate;
  const [result] = await run(validInput(), { session });
  assert.equal(result.ok, true, "the definition kind gated the instructed trainee");
});

// ===========================================================================
// 35–38. Eligibility
// ===========================================================================

test("35. eligibility is asked under the VERIFIED offering and the SUBMITTED id", async () => {
  const [, built] = await run(validInput());
  assert.deepEqual(built.traineeArgs, [
    { courseOfferingId: VERIFIED_OFFERING_ID, studentId: SUBMITTED_STUDENT_ID },
  ]);
  // The requested offering id never reaches the roster.
  assert.equal(built.traineeArgs[0].courseOfferingId === REQUESTED_OFFERING_ID, false);
});

test("36. the SERVER-returned id is what reaches the writer, always", async () => {
  const [, built] = await run(validInput(), {
    trainee: { studentId: "student-the-server-matched" },
  });
  assert.equal(built.writeArgs[0].value.studentId, "student-the-server-matched");
});

test("37. an ineligible or foreign trainee is refused identically", async () => {
  const [unknownStudent] = await run(validInput({ studentId: "student-never-enrolled" }), {
    trainee: null,
  });
  const [foreignStudent] = await run(validInput({ studentId: "student-of-another-course" }), {
    trainee: null,
  });
  assert.deepEqual(unknownStudent, { ok: false, code: "trainee_not_eligible" });
  assert.deepEqual(foreignStudent, unknownStudent);
});

test("38. eligibility is never asked before the definition gate passes", async () => {
  for (const flag of [false, null, undefined, "true", 1]) {
    const [, built] = await run(validInput(), { session: storedSession(flag) });
    assert.deepEqual(built.traineeArgs, [], `the roster was read for flag ${String(flag)}`);
  }
});

// ===========================================================================
// 39–44. Conflict and error propagation
// ===========================================================================

test("39. a classified uniqueness violation becomes assignment_conflict", async () => {
  const [result] = await run(validInput(), {
    createThrows: new FakeUniqueViolationError("exam_assignments unique"),
  });
  assert.deepEqual(result, { ok: false, code: "assignment_conflict" });
});

test("40. the conflict NEVER reveals which role the existing row holds", async () => {
  const [result] = await run(validInput(), {
    createThrows: new FakeUniqueViolationError("the student is already the EXAMINEE"),
  });
  const serialized = JSON.stringify(result);
  for (const leak of [
    "EXAMINEE",
    "INSTRUCTED_TRAINEE",
    "role",
    "already",
    SUBMITTED_STUDENT_ID,
    ELIGIBLE_STUDENT_ID,
    STORED_SESSION_ID,
  ]) {
    assert.equal(serialized.includes(leak), false, `the conflict result leaks ${leak}`);
  }
  assert.deepEqual(Object.keys(result).sort(), ["code", "ok"]);
});

test("41. an UNKNOWN create error propagates by IDENTITY", async () => {
  const thrown = new Error("connection reset");
  await assert.rejects(
    () => run(validInput(), { createThrows: thrown }),
    (error: unknown) => error === thrown,
  );
});

test("42. a framework REDIRECT propagates from every guarded step", async () => {
  for (const key of ["contextThrows", "gateThrows", "createThrows"] as const) {
    const thrown = redirectLikeError();
    await assert.rejects(
      () => run(validInput(), { [key]: thrown }),
      (error: unknown) => error === thrown,
      `${key} swallowed the redirect`,
    );
  }
});

test("43. an UNGUARDED dependency's throw propagates untouched", async () => {
  for (const key of ["planThrows", "sessionThrows", "traineeThrows"] as const) {
    const thrown = new Error(`failure from ${key}`);
    await assert.rejects(
      () => run(validInput(), { [key]: thrown }),
      (error: unknown) => error === thrown,
      `${key} was classified`,
    );
  }
});

test("44. each classifier is consulted ONLY at its own step", async () => {
  // A uniqueness violation thrown by the BOUNDARY is not a conflict: only the
  // course classifier is asked there, and it says no, so the error propagates.
  const thrown = new FakeUniqueViolationError("wrong step");
  await assert.rejects(
    () => run(validInput(), { contextThrows: thrown }),
    (error: unknown) => error === thrown,
  );
  // ...and a course not-found thrown by the WRITE is likewise not laundered.
  const atWrite = new FakeCourseNotFoundError("wrong step");
  await assert.rejects(
    () => run(validInput(), { createThrows: atWrite }),
    (error: unknown) => error === atWrite,
  );
});

// ===========================================================================
// 45–51. Result safety
// ===========================================================================

test("45. the success result carries ONLY ok, assignmentId and orderIndex", async () => {
  const [result] = await run(validInput());
  assert.deepEqual(Object.keys(result).sort(), ["assignmentId", "ok", "orderIndex"]);
});

test("46. every refusal result carries ONLY its closed fields", async () => {
  const refusals: CreateExamInstructedTraineeAssignmentResult[] = [
    (await run(validInput(), { contextThrows: new FakeCourseNotFoundError() }))[0],
    (await run(validInput(), { gateThrows: new FakeOperationDeniedError() }))[0],
    (await run(validInput(), { plan: null }))[0],
    (await run(validInput(), { session: null }))[0],
    (await run(validInput(), { session: storedSession(false) }))[0],
    (await run(validInput(), { trainee: null }))[0],
    (await run(validInput(), { createThrows: new FakeUniqueViolationError() }))[0],
  ];
  for (const refusal of refusals) {
    assert.deepEqual(Object.keys(refusal).sort(), ["code", "ok"]);
  }
  // The invalid-input arm is the ONLY one with an issues key.
  const [invalid] = await run(null);
  assert.deepEqual(Object.keys(invalid).sort(), ["code", "issues", "ok"]);
});

test("47. NO result echoes a submitted value or any server identifier", async () => {
  const echoes = [
    REQUESTED_OFFERING_ID,
    VERIFIED_OFFERING_ID,
    SERVER_PLAN_ID,
    SUBMITTED_SESSION_ID,
    STORED_SESSION_ID,
    SUBMITTED_STUDENT_ID,
    ELIGIBLE_STUDENT_ID,
  ];
  const results: CreateExamInstructedTraineeAssignmentResult[] = [
    (await run(validInput(), { plan: null }))[0],
    (await run(validInput(), { session: null }))[0],
    (await run(validInput(), { session: storedSession(false) }))[0],
    (await run(validInput(), { trainee: null }))[0],
    (await run(validInput(), { createThrows: new FakeUniqueViolationError() }))[0],
    (await run(validInput({ sessionId: 5, studentId: 6 })))[0],
  ];
  for (const result of results) {
    const serialized = JSON.stringify(result);
    for (const echo of echoes) {
      assert.equal(serialized.includes(echo), false, `${serialized} echoes ${echo}`);
    }
    for (const token of ["createdAt", "updatedAt", "timestamp", "stack", "Error", "P2002"]) {
      assert.equal(serialized.includes(token), false, `${serialized} carries ${token}`);
    }
  }
});

test("48. every result JSON round-trips to an equal value", async () => {
  const results: CreateExamInstructedTraineeAssignmentResult[] = [
    (await run(validInput()))[0],
    (await run(null))[0],
    (await run(validInput(), { plan: null }))[0],
    (await run(validInput(), { session: storedSession(false) }))[0],
    (await run(validInput(), { createThrows: new FakeUniqueViolationError() }))[0],
  ];
  for (const result of results) {
    assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  }
});

test("49. every result — and its issues array — is FROZEN", async () => {
  const [success] = await run(validInput());
  assert.equal(Object.isFrozen(success), true);

  const [invalid] = await run(null);
  assert.equal(Object.isFrozen(invalid), true);
  const issues = (invalid as { issues: readonly unknown[] }).issues;
  assert.equal(Object.isFrozen(issues), true);
  for (const issue of issues) assert.equal(Object.isFrozen(issue), true);

  const [refusal] = await run(validInput(), { trainee: null });
  assert.equal(Object.isFrozen(refusal), true);
});

test("50. two calls return independent, non-aliasing results", async () => {
  const [first] = await run(null);
  const [second] = await run(null);
  assert.notEqual(first, second);
  assert.notEqual(
    (first as { issues: readonly unknown[] }).issues,
    (second as { issues: readonly unknown[] }).issues,
  );
  assert.deepEqual(first, second);
});

test("51. a FROZEN raw input is accepted, and the raw input is never mutated", async () => {
  const raw = Object.freeze(validInput({ horseName: "כוכב" }));
  const before = JSON.stringify(raw);
  const [result] = await run(raw);
  assert.equal(result.ok, true);
  assert.equal(JSON.stringify(raw), before);
});

// ===========================================================================
// 52–60. Structural guards over the module SOURCE
// ===========================================================================

const EXAM_DIR = join(import.meta.dirname);
const MODULE_NAME = "create-exam-instructed-trainee-assignment-core.ts";
const TEST_NAME = "create-exam-instructed-trainee-assignment-core.test.ts";
const SOURCE = readFileSync(join(EXAM_DIR, MODULE_NAME), "utf8");

/** Strip comments so the guards assert on CODE, not on explanatory prose. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Keep ONLY the comments, for the "is this documented?" assertions. */
function commentsOf(source: string): string {
  return [
    ...(source.match(/\/\*[\s\S]*?\*\//g) ?? []),
    ...(source.match(/^\s*\/\/.*$/gm) ?? []),
  ].join("\n");
}

const CODE = stripComments(SOURCE);
const COMMENTS = commentsOf(SOURCE);

// Split specifiers: this suite necessarily names some of what it forbids, and the
// committed exam-slice guards scan sibling directories for them.
const PRISMA_MODULE = ["@/lib", "prisma"].join("/");
const GENERATED_CLIENT = ["@prisma", "client"].join("/");
const ENV_READ = "process" + ".env";

test("52. the module imports EXACTLY the two approved exam specifiers", () => {
  const specifiers = [...CODE.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(
    [...new Set(specifiers)].sort(),
    ["./exam-assignment-write-core", "./exam-domain-core"],
  );
  // The role vocabulary is a TYPE-only import, so nothing is emitted for it and
  // the module's purity is unaffected.
  assert.ok(/import type \{ ExamAssignmentRole \} from/.test(CODE));
  // The shared module supplies only the issue factory and its issue TYPE — the
  // three-field create normalizer is deliberately NOT reused, because it demands
  // a horse this role must not carry.
  assert.ok(CODE.includes("makeExamAssignmentWriteInputIssue"));
  assert.equal(
    CODE.includes("normalizeExamAssignmentCreateInput"),
    false,
    "the core reuses the horse-demanding normalizer",
  );
});

test("53. the module performs no IO and touches no database, clock or randomness", () => {
  for (const token of [
    PRISMA_MODULE,
    GENERATED_CLIENT,
    ENV_READ,
    "DATABASE" + "_URL",
    "Prisma" + "Client",
    "$transaction",
    "findFirst",
    "findUnique",
    "aggregate",
    "fetch(",
    "node:fs",
    "Date.now",
    "new Date",
    "Math.random",
    "crypto",
    "server" + "-only",
    "use " + "server",
    "use " + "client",
  ]) {
    assert.equal(CODE.includes(token), false, `the pure core references ${token}`);
  }
});

test("54. the module knows nothing of auth, capability, the framework or the app", () => {
  for (const token of [
    "@/lib/auth",
    "requireAdmin",
    "cookies(",
    "getSession",
    "capability",
    "Capability",
    "next/",
    "revalidatePath",
    "redirect(",
    "NextResponse",
    "@/app",
    "@/components",
  ]) {
    assert.equal(CODE.includes(token), false, `the pure core references ${token}`);
  }
});

test("55. the role is a module constant, never a parameter or an input field", () => {
  assert.ok(
    /const ROLE_INSTRUCTED_TRAINEE = "INSTRUCTED_TRAINEE"/.test(CODE),
    "the role is not a fixed constant",
  );
  // It appears as a value in exactly two places: the constant, and the payload.
  assert.equal((CODE.match(/"INSTRUCTED_TRAINEE"/g) ?? []).length, 2);
  assert.ok(CODE.includes("role: ROLE_INSTRUCTED_TRAINEE,"), "the payload role is not the constant");
  // The other role is never named in code — this slice writes one role only.
  assert.equal(CODE.includes('"EXAMINEE"'), false, "the core names the other role");

  const orchestration = [
    ...SOURCE.matchAll(/export async function (\w+)\(([\s\S]*?)\):\s*([^{]+)\{/g),
  ].map(([, name, params, returns]) => ({
    name,
    params: params.replace(/\s+/g, " ").trim(),
    returns: returns.replace(/\s+/g, " ").trim(),
  }));
  assert.equal(orchestration.length, 1, "the module exports more than one orchestration");
  assert.equal(orchestration[0].name, "createExamInstructedTraineeAssignmentWithDeps");
  assert.equal(
    orchestration[0].params,
    "courseOfferingId: string, rawInput: unknown, deps: CreateExamInstructedTraineeAssignmentDeps,",
  );
  assert.equal(
    orchestration[0].returns,
    "Promise<CreateExamInstructedTraineeAssignmentResult>",
  );
  for (const forbidden of ["role", "planId", "orderIndex", "sessionId", "actorId", "tx:", "prisma"]) {
    assert.equal(
      orchestration[0].params.includes(forbidden),
      false,
      `the orchestration accepts ${forbidden}`,
    );
  }
});

test("56. exactly two field names are read, as OWN properties", () => {
  const fields = [...CODE.matchAll(/readField\(rawInput, "(\w+)"\)/g)].map((m) => m[1]);
  assert.deepEqual(fields, ["sessionId", "studentId"]);
  assert.ok(/Object\.prototype\.hasOwnProperty\.call/.test(CODE), "fields are not own-property reads");
  // No coercion anywhere: a number, an object or a file-like value is refused
  // rather than stringified.
  for (const token of ["String(", "Number(", "toString()", "valueOf()", ".normalize(", "toLowerCase"]) {
    assert.equal(CODE.includes(token), false, `the pure core coerces via ${token}`);
  }
  // ...and no field beyond the two is ever named in code.
  for (const forbidden of [
    "horseName",
    "pairingIndex",
    "instructionTopic",
    "discipline",
    "notes",
    "definitionId",
    "sourcePracticeRole",
    "requiresLessonTopic",
    "requiresDiscipline",
    "definitionKind",
  ]) {
    assert.equal(CODE.includes(forbidden), false, `the pure core models ${forbidden}`);
  }
});

test("57. only the two approved issue codes are used, and no new one is invented", () => {
  const codes = [...CODE.matchAll(/makeExamAssignmentWriteInputIssue\("([A-Z-]+)"\)/g)].map(
    (m) => m[1],
  );
  assert.deepEqual(codes.sort(), [SESSION_ISSUE, STUDENT_ISSUE]);
  assert.equal(CODE.includes("HORSE-REQUIRED"), false, "the core demands a horse");
  assert.equal(
    CODE.includes("EXAM_ASSIGNMENT_WRITE_INPUT_MESSAGES"),
    false,
    "the core restates the shared message table",
  );
});

test("58. no result code beyond the eight approved outcomes exists", () => {
  const codes = [...CODE.matchAll(/refuse\("([a-z_]+)"\)|code: "([a-z_]+)"/g)]
    .map((m) => m[1] ?? m[2])
    .filter((code): code is string => typeof code === "string");
  assert.deepEqual([...new Set(codes)].sort(), [
    "assignment_conflict",
    "definition_does_not_require_instructed_trainee",
    "invalid_input",
    "offering_not_found",
    "operation_not_allowed",
    "plan_not_found",
    "session_not_found",
    "trainee_not_eligible",
  ]);
  for (const token of [
    "unexpected",
    "infrastructure_error",
    "raw_error",
    "stale_write",
    "archived",
    "capacity_exceeded",
    "session_full",
    "already_instructed",
  ]) {
    assert.equal(CODE.includes(token), false, `the pure core invents ${token}`);
  }
});

test("59. exactly three classifiers exist, each guarding ONE call, with no catch-all", () => {
  const predicates = [...CODE.matchAll(/\bis[A-Z]\w+Error\b/g)].map((m) => m[0]);
  assert.deepEqual([...new Set(predicates)].sort(), [
    "isCourseNotFoundError",
    "isOperationNotAllowedError",
    "isUniqueConstraintError",
  ]);
  for (const token of ["P2002", "P2025", "error.code", "error.message", "instanceof", "console."]) {
    assert.equal(CODE.includes(token), false, `the pure core inspects ${token}`);
  }
  assert.equal((CODE.match(/try \{/g) ?? []).length, 3, "the number of guarded calls changed");
  assert.equal((CODE.match(/throw error;/g) ?? []).length, 3, "an unrecognized throw is swallowed");
  assert.ok(/NEXT_REDIRECT/.test(COMMENTS), "the redirect rule is undocumented");
});

test("60. the two locked decisions are WRITTEN DOWN, not merely implemented", () => {
  const flat = COMMENTS.replace(/\s+/g, " ");
  // The role-blind conflict, including the EXAMINEE case.
  assert.ok(/regardless of role/i.test(flat), "the role-blind conflict is undocumented");
  assert.ok(/EXAMINEE/.test(flat), "the already-the-examinee case is undocumented");
  assert.ok(/sessionId\), studentId\)|\(sessionId, studentId\)/.test(flat), "the unique key is unnamed");
  // The no-pairing limitation, and BOTH of its consequences.
  assert.ok(/pairingIndex/.test(flat), "the pairing limitation is undocumented");
  assert.ok(/personal time/i.test(flat), "the missing personal time is not stated");
  assert.ok(/slot-grained/i.test(flat), "the excluded conflict check is not stated");
  // ...and the pairing field is nowhere in the CODE.
  assert.equal(CODE.includes("pairingIndex"), false, "the pure core writes a pairing index");
  // No capacity, wave, publication or notification notion exists at all.
  for (const token of ["parallelCapacity", "waves", "slots", "endTime", "publish", "notif"]) {
    assert.equal(CODE.includes(token), false, `the pure core references ${token}`);
  }
});

test("61. the slice's two lib/exam files are exactly the approved pair", () => {
  const sliceFiles = readdirSync(EXAM_DIR)
    .filter((name) => name.startsWith("create-exam-instructed-trainee-assignment-core"))
    .sort();
  assert.deepEqual(sliceFiles, [MODULE_NAME, TEST_NAME].sort());
  for (const name of sliceFiles) assert.equal(name.endsWith(".tsx"), false, `${name} is a UI file`);
  // The core deliberately sits OUTSIDE the prefix the committed assignment guard
  // pins, so adding it cannot change that guard's exact six-file answer.
  for (const name of sliceFiles) {
    assert.equal(
      /^(exam|create-exam|delete-exam)-assignment-/.test(name),
      false,
      `${name} collides with the pinned assignment prefix`,
    );
  }
});

test("62. this suite opens no database and reads no environment", () => {
  const own = stripComments(readFileSync(join(EXAM_DIR, TEST_NAME), "utf8"));
  for (const token of [
    PRISMA_MODULE,
    GENERATED_CLIENT,
    ENV_READ,
    "DATABASE" + "_URL",
    "Prisma" + "Client",
    "supa" + "base",
  ]) {
    assert.equal(own.includes(token), false, `the suite references ${token}`);
  }
  const specifiers = [...own.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(
    [...new Set(specifiers)].sort(),
    [
      "./create-exam-instructed-trainee-assignment-core",
      "node:assert/strict",
      "node:fs",
      "node:path",
      "node:test",
    ],
  );
  // No production identifier: every fixture id is an obviously-fake hyphenated
  // token, and none is cuid-shaped.
  const ids = [
    REQUESTED_OFFERING_ID,
    VERIFIED_OFFERING_ID,
    SERVER_PLAN_ID,
    SUBMITTED_SESSION_ID,
    STORED_SESSION_ID,
    SUBMITTED_STUDENT_ID,
    ELIGIBLE_STUDENT_ID,
    CREATED_ASSIGNMENT_ID,
  ];
  for (const id of ids) {
    assert.ok(id.includes("-"), `${id} is not an obviously-fake fixture`);
    assert.equal(/^c[a-z0-9]{20,}$/.test(id), false, `${id} is cuid-shaped`);
  }
});
