/**
 * EXAM EX-ASG-LTD1-A — executable tests for the PURE detailed examinee-assignment
 * CREATE orchestration (create-detailed-exam-assignment-core.ts).
 *
 * Run with: npx tsx --test lib/exam/create-detailed-exam-assignment-core.test.ts
 *
 * DB-FREE: every dependency is a fake, no database connection is opened, no SQL
 * is executed, no environment variable is read, and no production identifier
 * appears anywhere. The only files read are module SOURCE TEXTS, by the
 * structural guards at the bottom.
 *
 * SCOPE OF PROOF:
 *   - the five own-property reads, the trim rule, the blank-to-null rule, the
 *     no-coercion rule and the fixed issue order;
 *   - the LOCKED ORDER: authorize -> gate -> resolve plan -> validate input ->
 *     verify session -> horse rule -> definition demands -> verify trainee ->
 *     write, and, for every failure, exactly WHICH later dependencies are
 *     skipped;
 *   - the full definition matrix, including that an unsupported optional value is
 *     stored as null and that a malformed flag fails CLOSED in BOTH directions;
 *   - that `requiresInstructedTrainee` changes nothing on this path;
 *   - that the VERIFIED offering id — never the requested one — reaches the plan
 *     and eligibility lookups, and that the session is resolved under the
 *     SERVER-RESOLVED plan;
 *   - that the STORED session id and the ELIGIBLE trainee id, not the submitted
 *     ones, are what the write receives;
 *   - that the role is this module's constant and can never come from input;
 *   - that a uniqueness violation is the ordinary `assignment_conflict`, and that
 *     everything else — including a redirect-shaped throw — propagates unchanged
 *     with its identity intact;
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
  createDetailedExamAssignmentWithDeps,
  normalizeDetailedExamAssignmentCreateInput,
  DETAILED_EXAM_ASSIGNMENT_INPUT_MESSAGES,
  type CreateDetailedExamAssignmentDeps,
  type CreateDetailedExamAssignmentResult,
  type CreatedDetailedExamAssignmentRecord,
  type DetailedExamAssignmentInputIssueCode,
  type EligibleDetailedExamTrainee,
  type NewDetailedExamineeAssignment,
  type ResolvedExamPlanForDetailedAssignmentCreate,
  type VerifiedExamSessionForDetailedAssignmentCreate,
} from "./create-detailed-exam-assignment-core";
import type { ExamKind } from "./exam-domain-core";

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

const HORSE_NAME = "כוכב";
const TOPIC = "עבודה על מושב";
const DISCIPLINE = "דרסאז'";
const CREATED_ASSIGNMENT_ID = "assignment-as-created";
const ASSIGNED_ORDER_INDEX = 3;

/** The three kinds a stored exam session may carry. */
const STORABLE_KINDS: readonly ExamKind[] = [
  "INTERFACE_RIDING",
  "LUNGE_NO_RIDER",
  "ADVANCED_INSTRUCTION",
];

function validInput(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sessionId: SUBMITTED_SESSION_ID,
    studentId: SUBMITTED_STUDENT_ID,
    horseName: HORSE_NAME,
    ...over,
  };
}

function storedSession(
  over: Partial<VerifiedExamSessionForDetailedAssignmentCreate> = {},
): VerifiedExamSessionForDetailedAssignmentCreate {
  return {
    id: STORED_SESSION_ID,
    definitionKind: "INTERFACE_RIDING",
    requiresLessonTopic: false,
    requiresDiscipline: false,
    requiresInstructedTrainee: false,
    ...over,
  };
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
  readonly plan?: ResolvedExamPlanForDetailedAssignmentCreate | null;
  readonly session?: VerifiedExamSessionForDetailedAssignmentCreate | null;
  readonly trainee?: EligibleDetailedExamTrainee | null;
  readonly created?: CreatedDetailedExamAssignmentRecord;
  readonly throwOnContext?: unknown;
  readonly throwOnGate?: unknown;
  readonly throwOnWrite?: unknown;
}

interface Calls {
  contextRequests: string[];
  gateStatuses: string[];
  planOfferingIds: string[];
  sessionLookups: Array<{ planId: string; sessionId: string }>;
  traineeLookups: Array<{ offeringId: string; studentId: string }>;
  writes: Array<{ sessionId: string; value: NewDetailedExamineeAssignment }>;
}

function harness(options: HarnessOptions = {}): {
  deps: CreateDetailedExamAssignmentDeps;
  calls: Calls;
} {
  const calls: Calls = {
    contextRequests: [],
    gateStatuses: [],
    planOfferingIds: [],
    sessionLookups: [],
    traineeLookups: [],
    writes: [],
  };

  const deps: CreateDetailedExamAssignmentDeps = {
    async requireCourseContext(requestedCourseOfferingId) {
      calls.contextRequests.push(requestedCourseOfferingId);
      if (options.throwOnContext !== undefined) throw options.throwOnContext;
      return {
        courseOfferingId: VERIFIED_OFFERING_ID,
        status: options.status ?? "ACTIVE",
      };
    },
    assertConfigurationAllowed(status) {
      calls.gateStatuses.push(status);
      if (options.throwOnGate !== undefined) throw options.throwOnGate;
    },
    async findExamPlanByCourseOfferingId(verifiedCourseOfferingId) {
      calls.planOfferingIds.push(verifiedCourseOfferingId);
      return options.plan === undefined ? { id: SERVER_PLAN_ID } : options.plan;
    },
    async findSessionForPlan(planId, sessionId) {
      calls.sessionLookups.push({ planId, sessionId });
      return options.session === undefined ? storedSession() : options.session;
    },
    async findEligibleTrainee(verifiedCourseOfferingId, studentId) {
      calls.traineeLookups.push({ offeringId: verifiedCourseOfferingId, studentId });
      return options.trainee === undefined
        ? { studentId: ELIGIBLE_STUDENT_ID }
        : options.trainee;
    },
    async createAssignmentAtNextOrder(sessionId, value) {
      calls.writes.push({ sessionId, value });
      if (options.throwOnWrite !== undefined) throw options.throwOnWrite;
      return (
        options.created ?? { id: CREATED_ASSIGNMENT_ID, orderIndex: ASSIGNED_ORDER_INDEX }
      );
    },
    isCourseNotFoundError: (error) => error instanceof FakeCourseNotFoundError,
    isOperationNotAllowedError: (error) => error instanceof FakeOperationDeniedError,
    isUniqueConstraintError: (error) => error instanceof FakeUniqueViolationError,
  };

  return { deps, calls };
}

function run(
  rawInput: unknown,
  options: HarnessOptions = {},
): Promise<{ result: CreateDetailedExamAssignmentResult; calls: Calls }> {
  const { deps, calls } = harness(options);
  return createDetailedExamAssignmentWithDeps(REQUESTED_OFFERING_ID, rawInput, deps).then(
    (result) => ({ result, calls }),
  );
}

/** The issue codes of an `invalid_input` result, in order. */
function codesOf(result: CreateDetailedExamAssignmentResult): string[] {
  assert.equal(result.ok, false);
  assert.equal(result.code, "invalid_input");
  assert.ok("issues" in result);
  return result.issues.map((issue) => issue.code);
}

/** The issue codes the NORMALIZER produced, in order. */
function normalizedCodes(rawInput: unknown): string[] {
  const outcome = normalizeDetailedExamAssignmentCreateInput(rawInput);
  assert.equal(outcome.ok, false);
  assert.ok(!outcome.ok);
  return outcome.issues.map((issue) => issue.code);
}

// ===========================================================================
// 1–14. The normalizer: the five fields
// ===========================================================================

test("1. exactly the five approved own properties are read, and nothing else", () => {
  const read: string[] = [];
  const probe = new Proxy(
    {
      sessionId: SUBMITTED_SESSION_ID,
      studentId: SUBMITTED_STUDENT_ID,
      horseName: HORSE_NAME,
      instructionTopic: TOPIC,
      discipline: DISCIPLINE,
      // Everything below must be ignored ENTIRELY — never even looked for.
      id: "x",
      role: "INSTRUCTED_TRAINEE",
      orderIndex: 99,
      pairingIndex: 1,
      planId: "plan-x",
      courseOfferingId: "offering-x",
      definitionId: "definition-x",
      notes: "n",
      sourcePracticeRole: "r",
      createdAt: "t",
      updatedAt: "t",
    } as Record<string, unknown>,
    {
      get(target, key) {
        if (typeof key === "string") read.push(key);
        return Reflect.get(target, key);
      },
    },
  );

  const outcome = normalizeDetailedExamAssignmentCreateInput(probe);
  assert.ok(outcome.ok);
  assert.deepEqual(read.sort(), [
    "discipline",
    "horseName",
    "instructionTopic",
    "sessionId",
    "studentId",
  ]);
});

test("2. required values are trimmed and preserved byte-for-byte otherwise", () => {
  const outcome = normalizeDetailedExamAssignmentCreateInput({
    sessionId: "  session-padded  ",
    studentId: "\tstudent-padded\n",
    horseName: `  ${HORSE_NAME}  `,
  });
  assert.ok(outcome.ok);
  assert.deepEqual(outcome.value, {
    sessionId: "session-padded",
    studentId: "student-padded",
    horseName: HORSE_NAME,
    instructionTopic: null,
    discipline: null,
  });
});

test("3. optional values are trimmed when supplied", () => {
  const outcome = normalizeDetailedExamAssignmentCreateInput(
    validInput({ instructionTopic: `  ${TOPIC}  `, discipline: `\n${DISCIPLINE}\t` }),
  );
  assert.ok(outcome.ok);
  assert.equal(outcome.value.instructionTopic, TOPIC);
  assert.equal(outcome.value.discipline, DISCIPLINE);
});

test("4. an absent, null, undefined, empty or whitespace-only optional becomes null", () => {
  for (const blank of [undefined, null, "", "   ", "\t\n  "]) {
    const outcome = normalizeDetailedExamAssignmentCreateInput(
      validInput({ instructionTopic: blank, discipline: blank }),
    );
    assert.ok(outcome.ok, `${JSON.stringify(blank)} was refused`);
    assert.equal(outcome.value.instructionTopic, null);
    assert.equal(outcome.value.discipline, null);
  }
  // ...and an entirely absent property behaves identically.
  const bare = normalizeDetailedExamAssignmentCreateInput(validInput());
  assert.ok(bare.ok);
  assert.equal(bare.value.instructionTopic, null);
  assert.equal(bare.value.discipline, null);
});

test("5. a required field is refused for every non-string type — no coercion", () => {
  for (const value of [0, 1, true, false, [], ["a"], {}, { a: 1 }, () => "x", Symbol("s")]) {
    assert.deepEqual(normalizedCodes(validInput({ horseName: value })), [
      "EX-ASG-LTD-HORSE-REQUIRED",
    ]);
  }
});

test("6. an optional field is refused for every non-string, non-nullish type", () => {
  for (const value of [0, 1, true, false, [], ["a"], {}, { a: 1 }, () => "x"]) {
    assert.deepEqual(normalizedCodes(validInput({ instructionTopic: value })), [
      "EX-ASG-LTD-TOPIC-REQUIRED",
    ]);
    assert.deepEqual(normalizedCodes(validInput({ discipline: value })), [
      "EX-ASG-LTD-DISCIPLINE-REQUIRED",
    ]);
  }
});

test("7. no toString, valueOf or other member of a submitted value is probed", () => {
  let probed = 0;
  const hostile = {
    get toString() {
      probed += 1;
      return () => "coerced";
    },
    get valueOf() {
      probed += 1;
      return () => "coerced";
    },
    get name() {
      probed += 1;
      return "coerced";
    },
  };
  const outcome = normalizeDetailedExamAssignmentCreateInput(
    validInput({ instructionTopic: hostile, horseName: hostile }),
  );
  assert.equal(outcome.ok, false);
  assert.equal(probed, 0, "a member of a submitted value was read");
});

test("8. inherited prototype properties are NOT read as submitted data", () => {
  const parent = {
    sessionId: SUBMITTED_SESSION_ID,
    studentId: SUBMITTED_STUDENT_ID,
    horseName: HORSE_NAME,
    instructionTopic: TOPIC,
  };
  const child = Object.create(parent) as Record<string, unknown>;
  assert.deepEqual(normalizedCodes(child), [
    "EX-ASG-LTD-SESSION-REQUIRED",
    "EX-ASG-LTD-STUDENT-REQUIRED",
    "EX-ASG-LTD-HORSE-REQUIRED",
  ]);
});

test("9. a non-object raw input reads as five absent fields, never a throw", () => {
  for (const raw of [undefined, null, "text", 7, true, [], () => "x"]) {
    assert.deepEqual(normalizedCodes(raw), [
      "EX-ASG-LTD-SESSION-REQUIRED",
      "EX-ASG-LTD-STUDENT-REQUIRED",
      "EX-ASG-LTD-HORSE-REQUIRED",
    ]);
  }
});

test("10. the issue order is FIXED: session, student, horse, topic, discipline", () => {
  assert.deepEqual(
    normalizedCodes({
      // Deliberately reversed key order — the output order must not follow it.
      discipline: 1,
      instructionTopic: 1,
      horseName: "",
      studentId: "",
      sessionId: "",
    }),
    [
      "EX-ASG-LTD-SESSION-REQUIRED",
      "EX-ASG-LTD-STUDENT-REQUIRED",
      "EX-ASG-LTD-HORSE-REQUIRED",
      "EX-ASG-LTD-TOPIC-REQUIRED",
      "EX-ASG-LTD-DISCIPLINE-REQUIRED",
    ],
  );
});

test("11. every combination of the three required fields reports every problem", () => {
  const fields = ["sessionId", "studentId", "horseName"] as const;
  const codes: Record<(typeof fields)[number], string> = {
    sessionId: "EX-ASG-LTD-SESSION-REQUIRED",
    studentId: "EX-ASG-LTD-STUDENT-REQUIRED",
    horseName: "EX-ASG-LTD-HORSE-REQUIRED",
  };
  for (let mask = 0; mask < 8; mask += 1) {
    const raw = validInput();
    const expected: string[] = [];
    fields.forEach((field, index) => {
      if ((mask & (1 << index)) !== 0) {
        raw[field] = "   ";
        expected.push(codes[field]);
      }
    });
    if (expected.length === 0) {
      assert.ok(normalizeDetailedExamAssignmentCreateInput(raw).ok);
    } else {
      assert.deepEqual(normalizedCodes(raw), expected);
    }
  }
});

test("12. there is NO maximum length for any field", () => {
  const long = "א".repeat(5000);
  const outcome = normalizeDetailedExamAssignmentCreateInput(
    validInput({ horseName: long, instructionTopic: long, discipline: long }),
  );
  assert.ok(outcome.ok);
  assert.equal(outcome.value.horseName.length, 5000);
  assert.equal(outcome.value.instructionTopic?.length, 5000);
});

test("13. the raw input is never mutated, and a frozen object is accepted", () => {
  const raw = Object.freeze(validInput({ instructionTopic: `  ${TOPIC}  ` }));
  const before = JSON.stringify(raw);
  const outcome = normalizeDetailedExamAssignmentCreateInput(raw);
  assert.ok(outcome.ok);
  assert.equal(JSON.stringify(raw), before);
});

test("14. the message table is frozen, complete and echoes nothing", () => {
  const codes: DetailedExamAssignmentInputIssueCode[] = [
    "EX-ASG-LTD-SESSION-REQUIRED",
    "EX-ASG-LTD-STUDENT-REQUIRED",
    "EX-ASG-LTD-HORSE-REQUIRED",
    "EX-ASG-LTD-TOPIC-REQUIRED",
    "EX-ASG-LTD-DISCIPLINE-REQUIRED",
  ];
  assert.ok(Object.isFrozen(DETAILED_EXAM_ASSIGNMENT_INPUT_MESSAGES));
  assert.deepEqual(Object.keys(DETAILED_EXAM_ASSIGNMENT_INPUT_MESSAGES).sort(), [...codes].sort());
  for (const code of codes) {
    const message = DETAILED_EXAM_ASSIGNMENT_INPUT_MESSAGES[code];
    assert.ok(message.length > 0);
    for (const echoed of [
      "{",
      "}",
      "$",
      "%s",
      SUBMITTED_SESSION_ID,
      SUBMITTED_STUDENT_ID,
      HORSE_NAME,
      TOPIC,
      DISCIPLINE,
    ]) {
      assert.equal(message.includes(echoed), false, `${code} echoes ${echoed}`);
    }
  }
});

// ===========================================================================
// 15–24. The definition matrix
// ===========================================================================

test("15. topic false + discipline false: neither is demanded, and neither is stored", async () => {
  const { result, calls } = await run(
    validInput({ instructionTopic: TOPIC, discipline: DISCIPLINE }),
    { session: storedSession({ requiresLessonTopic: false, requiresDiscipline: false }) },
  );
  assert.deepEqual(result, {
    ok: true,
    assignmentId: CREATED_ASSIGNMENT_ID,
    orderIndex: ASSIGNED_ORDER_INDEX,
  });
  assert.equal(calls.writes[0].value.instructionTopic, null);
  assert.equal(calls.writes[0].value.discipline, null);
});

test("16. topic true + discipline false: only the topic is stored", async () => {
  const { result, calls } = await run(
    validInput({ instructionTopic: TOPIC, discipline: DISCIPLINE }),
    { session: storedSession({ requiresLessonTopic: true, requiresDiscipline: false }) },
  );
  assert.equal(result.ok, true);
  assert.equal(calls.writes[0].value.instructionTopic, TOPIC);
  assert.equal(calls.writes[0].value.discipline, null);
});

test("17. topic false + discipline true: only the discipline is stored", async () => {
  const { result, calls } = await run(
    validInput({ instructionTopic: TOPIC, discipline: DISCIPLINE }),
    { session: storedSession({ requiresLessonTopic: false, requiresDiscipline: true }) },
  );
  assert.equal(result.ok, true);
  assert.equal(calls.writes[0].value.instructionTopic, null);
  assert.equal(calls.writes[0].value.discipline, DISCIPLINE);
});

test("18. topic true + discipline true: both are stored", async () => {
  const { result, calls } = await run(
    validInput({ instructionTopic: TOPIC, discipline: DISCIPLINE }),
    { session: storedSession({ requiresLessonTopic: true, requiresDiscipline: true }) },
  );
  assert.equal(result.ok, true);
  assert.equal(calls.writes[0].value.instructionTopic, TOPIC);
  assert.equal(calls.writes[0].value.discipline, DISCIPLINE);
});

test("19. a DEMANDED topic that was not supplied refuses, and writes nothing", async () => {
  const { result, calls } = await run(validInput({ discipline: DISCIPLINE }), {
    session: storedSession({ requiresLessonTopic: true, requiresDiscipline: false }),
  });
  assert.deepEqual(codesOf(result), ["EX-ASG-LTD-TOPIC-REQUIRED"]);
  assert.equal(calls.writes.length, 0);
  // The roster is not probed by a failed create.
  assert.equal(calls.traineeLookups.length, 0);
});

test("20. a DEMANDED discipline that was not supplied refuses, and writes nothing", async () => {
  const { result, calls } = await run(validInput({ instructionTopic: TOPIC }), {
    session: storedSession({ requiresLessonTopic: false, requiresDiscipline: true }),
  });
  assert.deepEqual(codesOf(result), ["EX-ASG-LTD-DISCIPLINE-REQUIRED"]);
  assert.equal(calls.writes.length, 0);
  assert.equal(calls.traineeLookups.length, 0);
});

test("21. BOTH demanded and BOTH missing reports both, in the fixed field order", async () => {
  const { result, calls } = await run(validInput(), {
    session: storedSession({ requiresLessonTopic: true, requiresDiscipline: true }),
  });
  assert.deepEqual(codesOf(result), [
    "EX-ASG-LTD-TOPIC-REQUIRED",
    "EX-ASG-LTD-DISCIPLINE-REQUIRED",
  ]);
  assert.equal(calls.writes.length, 0);
});

test("22. a blank supplied value counts as NOT supplied against a demand", async () => {
  const { result } = await run(validInput({ instructionTopic: "   " }), {
    session: storedSession({ requiresLessonTopic: true }),
  });
  assert.deepEqual(codesOf(result), ["EX-ASG-LTD-TOPIC-REQUIRED"]);
});

test("23. a MALFORMED requirement flag fails CLOSED in BOTH directions", async () => {
  // The declared type is boolean; these are the defensive values a widened
  // binding or a hand-built fake could produce. Only a literal `false` may mean
  // "not required".
  const malformed = [undefined, null, 0, 1, "", "true", "false", {}, []];

  for (const flag of malformed) {
    // (a) DEMANDED: an absent topic is refused rather than silently stored null.
    const missing = await run(validInput(), {
      session: storedSession({
        requiresLessonTopic: flag as unknown as boolean,
      }),
    });
    assert.deepEqual(
      codesOf(missing.result),
      ["EX-ASG-LTD-TOPIC-REQUIRED"],
      `flag ${JSON.stringify(flag)} did not demand the topic`,
    );
    assert.equal(missing.calls.writes.length, 0);

    // (b) AND STORED: when the value IS supplied it is written, so the
    //     fail-closed demand can never produce the incomplete row it exists to
    //     prevent.
    const supplied = await run(validInput({ instructionTopic: TOPIC }), {
      session: storedSession({
        requiresLessonTopic: flag as unknown as boolean,
      }),
    });
    assert.equal(supplied.result.ok, true);
    assert.equal(
      supplied.calls.writes[0].value.instructionTopic,
      TOPIC,
      `flag ${JSON.stringify(flag)} demanded a topic and then dropped it`,
    );
  }

  // The SAME reasoning for the discipline flag.
  const missingDiscipline = await run(validInput(), {
    session: storedSession({ requiresDiscipline: undefined as unknown as boolean }),
  });
  assert.deepEqual(codesOf(missingDiscipline.result), ["EX-ASG-LTD-DISCIPLINE-REQUIRED"]);

  // ...and a LITERAL false is the only value that means "not required".
  const notRequired = await run(validInput({ instructionTopic: TOPIC }), {
    session: storedSession({ requiresLessonTopic: false }),
  });
  assert.equal(notRequired.result.ok, true);
  assert.equal(notRequired.calls.writes[0].value.instructionTopic, null);
});

test("24. requiresInstructedTrainee changes NOTHING on this create path", async () => {
  for (const flag of [true, false]) {
    const { result, calls } = await run(validInput(), {
      session: storedSession({ requiresInstructedTrainee: flag }),
    });
    assert.equal(result.ok, true, `requiresInstructedTrainee=${flag} blocked the examinee`);
    assert.equal(calls.writes.length, 1);
    assert.equal(calls.writes[0].value.role, "EXAMINEE");
  }
});

// ===========================================================================
// 25–34. Scoping and the locked order
// ===========================================================================

test("25. an unknown offering refuses, and nothing else runs", async () => {
  const { result, calls } = await run(validInput(), {
    throwOnContext: new FakeCourseNotFoundError("no such offering"),
  });
  assert.deepEqual(result, { ok: false, code: "offering_not_found" });
  assert.deepEqual(calls.contextRequests, [REQUESTED_OFFERING_ID]);
  assert.equal(calls.gateStatuses.length, 0);
  assert.equal(calls.planOfferingIds.length, 0);
  assert.equal(calls.sessionLookups.length, 0);
  assert.equal(calls.traineeLookups.length, 0);
  assert.equal(calls.writes.length, 0);
});

test("26. a lifecycle denial refuses BEFORE any exam query", async () => {
  const { result, calls } = await run(validInput(), {
    status: "ARCHIVED",
    throwOnGate: new FakeOperationDeniedError("archived"),
  });
  assert.deepEqual(result, { ok: false, code: "operation_not_allowed" });
  assert.deepEqual(calls.gateStatuses, ["ARCHIVED"]);
  assert.equal(calls.planOfferingIds.length, 0);
  assert.equal(calls.writes.length, 0);
});

test("27. no plan refuses, and no plan is ever created", async () => {
  const { result, calls } = await run(validInput(), { plan: null });
  assert.deepEqual(result, { ok: false, code: "plan_not_found" });
  assert.deepEqual(calls.planOfferingIds, [VERIFIED_OFFERING_ID]);
  assert.equal(calls.sessionLookups.length, 0);
  assert.equal(calls.writes.length, 0);
});

test("28. invalid input stops BEFORE the session, eligibility and write", async () => {
  const { result, calls } = await run({}, {});
  assert.deepEqual(codesOf(result), [
    "EX-ASG-LTD-SESSION-REQUIRED",
    "EX-ASG-LTD-STUDENT-REQUIRED",
    "EX-ASG-LTD-HORSE-REQUIRED",
  ]);
  assert.equal(calls.sessionLookups.length, 0);
  assert.equal(calls.traineeLookups.length, 0);
  assert.equal(calls.writes.length, 0);
});

test("29. the session is resolved under the SERVER plan id and the SUBMITTED session id", async () => {
  const { calls } = await run(validInput());
  assert.deepEqual(calls.sessionLookups, [
    { planId: SERVER_PLAN_ID, sessionId: SUBMITTED_SESSION_ID },
  ]);
  // The requested offering id reached the boundary and NOTHING else.
  assert.deepEqual(calls.contextRequests, [REQUESTED_OFFERING_ID]);
  assert.deepEqual(calls.planOfferingIds, [VERIFIED_OFFERING_ID]);
});

test("30. a missing session and a FOREIGN-plan session are the same refusal", async () => {
  // The dependency cannot be asked for a session without a plan id, so a foreign
  // session is simply `null` — the two are indistinguishable by construction.
  const { result, calls } = await run(validInput(), { session: null });
  assert.deepEqual(result, { ok: false, code: "session_not_found" });
  assert.equal(calls.traineeLookups.length, 0);
  assert.equal(calls.writes.length, 0);
});

test("31. eligibility is asked under the VERIFIED offering and the SUBMITTED student", async () => {
  const { calls } = await run(validInput());
  assert.deepEqual(calls.traineeLookups, [
    { offeringId: VERIFIED_OFFERING_ID, studentId: SUBMITTED_STUDENT_ID },
  ]);
});

test("32. a foreign-offering, inactive-enrolment or inactive Student trainee is refused", async () => {
  // All three are the SAME `null` at this boundary — a distinguishable answer
  // would be an existence oracle over another course's roster.
  const { result, calls } = await run(validInput(), { trainee: null });
  assert.deepEqual(result, { ok: false, code: "trainee_not_eligible" });
  assert.equal(calls.writes.length, 0);
});

test("33. the SERVER-returned ids reach the write — never the submitted ones", async () => {
  const { calls } = await run(validInput());
  assert.equal(calls.writes.length, 1);
  assert.equal(calls.writes[0].sessionId, STORED_SESSION_ID);
  assert.notEqual(calls.writes[0].sessionId, SUBMITTED_SESSION_ID);
  assert.equal(calls.writes[0].value.studentId, ELIGIBLE_STUDENT_ID);
  assert.notEqual(calls.writes[0].value.studentId, SUBMITTED_STUDENT_ID);
});

test("34. a submitted student id can never bypass the eligibility statement", async () => {
  // Even when the submission names the id the eligibility check would return,
  // the dependency is still consulted and its answer is still what decides.
  const { result, calls } = await run(validInput({ studentId: ELIGIBLE_STUDENT_ID }), {
    trainee: null,
  });
  assert.deepEqual(result, { ok: false, code: "trainee_not_eligible" });
  assert.equal(calls.traineeLookups.length, 1);
  assert.equal(calls.writes.length, 0);
});

// ===========================================================================
// 35–42. The write payload, the classifiers and the result model
// ===========================================================================

test("35. the write payload is EXACTLY the five approved properties", async () => {
  const { calls } = await run(validInput({ instructionTopic: TOPIC, discipline: DISCIPLINE }), {
    session: storedSession({ requiresLessonTopic: true, requiresDiscipline: true }),
  });
  const value = calls.writes[0].value;
  assert.deepEqual(Object.keys(value).sort(), [
    "discipline",
    "horseName",
    "instructionTopic",
    "role",
    "studentId",
  ]);
  assert.deepEqual(value, {
    studentId: ELIGIBLE_STUDENT_ID,
    role: "EXAMINEE",
    horseName: HORSE_NAME,
    instructionTopic: TOPIC,
    discipline: DISCIPLINE,
  });
  for (const forbidden of [
    "pairingIndex",
    "notes",
    "sourcePracticeRole",
    "orderIndex",
    "planId",
    "courseOfferingId",
    "definitionId",
    "sessionId",
  ]) {
    assert.equal(forbidden in value, false, `the payload carries ${forbidden}`);
  }
});

test("36. the role is the module constant, whatever the submission claims", async () => {
  for (const claimed of ["INSTRUCTED_TRAINEE", "EXAMINER", "", 7, null]) {
    const { calls } = await run(validInput({ role: claimed }));
    assert.equal(calls.writes[0].value.role, "EXAMINEE");
  }
});

test("37. a submitted orderIndex, pairingIndex or definitionId is never read", async () => {
  const { result, calls } = await run(
    validInput({ orderIndex: 0, pairingIndex: 5, definitionId: "definition-x", courseOfferingId: "offering-x" }),
  );
  assert.equal(result.ok, true);
  assert.ok(result.ok);
  // The position is the WRITE's answer, not the submission's.
  assert.equal(result.orderIndex, ASSIGNED_ORDER_INDEX);
  assert.equal("orderIndex" in calls.writes[0].value, false);
  assert.deepEqual(calls.planOfferingIds, [VERIFIED_OFFERING_ID]);
});

test("38. a uniqueness violation at the write is the ordinary assignment_conflict", async () => {
  const { result, calls } = await run(validInput(), {
    throwOnWrite: new FakeUniqueViolationError("duplicate"),
  });
  assert.deepEqual(result, { ok: false, code: "assignment_conflict" });
  assert.equal(calls.writes.length, 1);
});

test("39. every UNCLASSIFIED error propagates with its identity intact", async () => {
  const infra = new Error("connection reset");
  for (const options of [
    { throwOnContext: infra },
    { throwOnGate: infra },
    { throwOnWrite: infra },
  ]) {
    await assert.rejects(() => run(validInput(), options), (error) => error === infra);
  }
});

test("40. a REDIRECT-shaped throw is never laundered into a refusal", async () => {
  const placements: ReadonlyArray<(thrown: unknown) => HarnessOptions> = [
    (thrown) => ({ throwOnContext: thrown }),
    (thrown) => ({ throwOnGate: thrown }),
    (thrown) => ({ throwOnWrite: thrown }),
  ];
  for (const place of placements) {
    const redirect = redirectLikeError();
    await assert.rejects(
      () => run(validInput(), place(redirect)),
      (error) => error === redirect,
    );
  }
});

test("41. every result is frozen, JSON-safe and echoes no submitted value", async () => {
  const outcomes: CreateDetailedExamAssignmentResult[] = [
    (await run(validInput())).result,
    (await run({})).result,
    (await run(validInput(), { plan: null })).result,
    (await run(validInput(), { session: null })).result,
    (await run(validInput(), { trainee: null })).result,
    (await run(validInput(), { throwOnContext: new FakeCourseNotFoundError() })).result,
    (await run(validInput(), { throwOnGate: new FakeOperationDeniedError() })).result,
    (await run(validInput(), { throwOnWrite: new FakeUniqueViolationError() })).result,
    (
      await run(validInput(), {
        session: storedSession({ requiresLessonTopic: true, requiresDiscipline: true }),
      })
    ).result,
  ];

  for (const outcome of outcomes) {
    assert.ok(Object.isFrozen(outcome));
    assert.deepEqual(JSON.parse(JSON.stringify(outcome)), outcome);
    if (!outcome.ok && "issues" in outcome) {
      assert.ok(Object.isFrozen(outcome.issues));
    }
    const serialized = JSON.stringify(outcome);
    for (const secret of [
      REQUESTED_OFFERING_ID,
      VERIFIED_OFFERING_ID,
      SERVER_PLAN_ID,
      SUBMITTED_SESSION_ID,
      STORED_SESSION_ID,
      SUBMITTED_STUDENT_ID,
      ELIGIBLE_STUDENT_ID,
      HORSE_NAME,
      TOPIC,
      DISCIPLINE,
    ]) {
      assert.equal(serialized.includes(secret), false, `the result echoes ${secret}`);
    }
  }
});

test("42. the horse rule is consulted with the definition's authoritative kind", async () => {
  // The normalizer already demands a horse unconditionally, so every storable
  // kind succeeds; the point is that no kind changes the outcome behind the
  // committed rule's back.
  for (const kind of STORABLE_KINDS) {
    const { result } = await run(validInput(), {
      session: storedSession({ definitionKind: kind }),
    });
    assert.equal(result.ok, true, `${kind} was refused`);
  }
});

// ===========================================================================
// 43–50. Structural guards on the module source
// ===========================================================================

const CORE_REL = join("lib", "exam", "create-detailed-exam-assignment-core.ts");
const REPO_ROOT = join(import.meta.dirname, "..", "..");
const SOURCE = readFileSync(join(REPO_ROOT, CORE_REL), "utf8");

/** Strip comments so the guards assert on CODE, not on explanatory prose. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const CODE = stripComments(SOURCE);

test("43. the pure core is DB-free, framework-free and effect-free", () => {
  for (const token of [
    "prisma",
    "Prisma",
    // Assembled: a committed lib/exam containment suite sweeps every file in this
    // directory for the client's module specifier, so spelling it whole here
    // would make this suite the violation it is checking for.
    "@/lib" + "/prisma",
    "server" + "-only",
    "use " + "server",
    "use " + "client",
    "next/",
    "cookies(",
    "headers(",
    "redirect(",
    "revalidatePath",
    "fetch(",
    "node:fs",
    "$transaction",
  ]) {
    assert.equal(CODE.includes(token), false, `the pure core references ${token}`);
  }
});

test("44. the pure core has NO calendar type, clock, randomness or process access", () => {
  for (const pattern of [
    /\bDate\b/,
    /Date\.now\b/,
    /Math\.random\b/,
    /process\./,
    /globalThis/,
    /\bIntl\b/,
    /localeCompare/,
    /toISOString/,
    /new Map\b/,
    /new Set\b/,
  ]) {
    assert.equal(pattern.test(CODE), false, `the pure core uses ${pattern}`);
  }
});

test("45. the pure core performs NO coercion and NO case folding", () => {
  for (const token of [
    "String(",
    "Number(",
    "Boolean(",
    ".toString(",
    ".valueOf(",
    ".normalize(",
    ".toLowerCase(",
    ".toUpperCase(",
    "parseInt",
    "parseFloat",
    "`${",
    "MAX_LENGTH",
    "maxLength",
    ".slice(0,",
  ]) {
    assert.equal(CODE.includes(token), false, `the pure core uses ${token}`);
  }
  // Own-property reads only.
  assert.ok(/Object\.prototype\.hasOwnProperty\.call/.test(CODE));
});

test("46. the pure core imports ONLY committed sibling exam cores", () => {
  const specifiers = [...CODE.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(specifiers)].sort(), [
    "./exam-definition-validation-core",
    "./exam-domain-core",
  ]);
  // The horse rule is REUSED, not restated, so the two cannot disagree.
  assert.ok(/isHorseRequiredFor/.test(CODE), "the committed horse rule is not consulted");
  for (const restated of ["INTERFACE_RIDING", "LUNGE_NO_RIDER", "ADVANCED_INSTRUCTION"]) {
    assert.equal(CODE.includes(restated), false, `the core restates the kind ${restated}`);
  }
  // The committed three-field namespace is NOT reused or edited.
  assert.equal(CODE.includes("EX-ASG-IN-"), false, "the core reuses the committed issue set");
});

test("47. the role is a module constant, never a parameter or an input field", () => {
  assert.ok(/const ROLE_EXAMINEE = "EXAMINEE"/.test(CODE), "the role is not a fixed constant");
  const orchestration = [
    ...SOURCE.matchAll(/export async function (\w+)\(([\s\S]*?)\):\s*([^{]+)\{/g),
  ].map(([, name, params, returns]) => ({
    name,
    params: params.replace(/\s+/g, " ").trim(),
    returns: returns.replace(/\s+/g, " ").trim(),
  }))[0];
  assert.equal(orchestration.name, "createDetailedExamAssignmentWithDeps");
  assert.equal(
    orchestration.params,
    "courseOfferingId: string, rawInput: unknown, deps: CreateDetailedExamAssignmentDeps,",
  );
  assert.equal(orchestration.returns, "Promise<CreateDetailedExamAssignmentResult>");
  for (const forbidden of ["role", "planId", "orderIndex", "sessionId", "actorId", "tx:", "prisma"]) {
    assert.equal(
      orchestration.params.includes(forbidden),
      false,
      `the orchestration accepts ${forbidden}`,
    );
  }
});

test("48. no capacity, wave, slot, timetable, vocabulary or capability notion appears", () => {
  for (const token of [
    "parallelCapacity",
    "durationMinutes",
    "waves",
    "slots",
    "endTime",
    "breaks",
    "supervisor",
    "publish",
    "notification",
    "pairingIndex",
    "sourcePracticeRole",
    "notes",
    "autocomplete",
    "suggestions",
    "vocabulary",
    "CapabilityKey",
    "capability",
    "Capability",
  ]) {
    assert.equal(CODE.includes(token), false, `the pure core references ${token}`);
  }
});

test("49. the refusal namespace is exactly the six approved codes", () => {
  for (const code of [
    "offering_not_found",
    "operation_not_allowed",
    "plan_not_found",
    "session_not_found",
    "trainee_not_eligible",
    "assignment_conflict",
  ]) {
    assert.ok(CODE.includes(`"${code}"`), `${code} is missing`);
  }
  for (const forbidden of [
    "definition_requires_unsupported_fields",
    "unexpected",
    "infrastructure_error",
    "stale_write",
    "capacity_exceeded",
  ]) {
    assert.equal(CODE.includes(forbidden), false, `the core declares ${forbidden}`);
  }
});

test("50. this slice's lib/exam footprint is EXACTLY its own pair of files", () => {
  const entries = readdirSync(join(REPO_ROOT, "lib", "exam"))
    .filter((name) => name.startsWith("create-detailed-exam-assignment"))
    .sort();
  assert.deepEqual(entries, [
    "create-detailed-exam-assignment-core.test.ts",
    "create-detailed-exam-assignment-core.ts",
  ]);
});
