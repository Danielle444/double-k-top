/**
 * EXAM EX-ASG-C1 — executable tests for the PURE examinee-assignment CREATE
 * orchestration (create-exam-assignment-core.ts).
 *
 * Run with: npx tsx --test lib/exam/create-exam-assignment-core.test.ts
 *
 * DB-FREE: every dependency is a fake, no database connection is opened, no SQL
 * is executed, no environment variable is read, and no production identifier
 * appears anywhere. The only files read are module SOURCE TEXTS, by the
 * structural guards at the bottom.
 *
 * SCOPE OF PROOF:
 *   - the LOCKED ORDER: authorize -> gate -> resolve plan -> validate input ->
 *     verify session -> horse rule -> definition demands -> verify trainee ->
 *     write, and, for every failure, exactly WHICH later dependencies are
 *     skipped;
 *   - that the VERIFIED offering id — never the requested one — reaches the plan
 *     and eligibility lookups, and that the session is resolved under the
 *     SERVER-RESOLVED plan;
 *   - that the STORED session id and the ELIGIBLE trainee id, not the submitted
 *     ones, are what the write receives;
 *   - that the role is this module's constant and can never come from input;
 *   - PD-1: a definition demanding a lesson topic or a discipline is refused and
 *     NOTHING is written; PD-2: a definition that also needs a second person does
 *     NOT block the examinee row;
 *   - that no capacity, duration, wave or slot is consulted;
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
  createExamAssignmentWithDeps,
  type CreateExamAssignmentDeps,
  type CreateExamAssignmentResult,
  type CreatedExamAssignmentRecord,
  type EligibleExamTrainee,
  type NewExamineeAssignment,
  type ResolvedExamPlanForAssignmentCreate,
  type VerifiedExamSessionForAssignmentCreate,
} from "./create-exam-assignment-core";
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
  over: Partial<VerifiedExamSessionForAssignmentCreate> = {},
): VerifiedExamSessionForAssignmentCreate {
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
  readonly plan?: ResolvedExamPlanForAssignmentCreate | null;
  readonly session?: VerifiedExamSessionForAssignmentCreate | null;
  readonly trainee?: EligibleExamTrainee | null;
  readonly created?: CreatedExamAssignmentRecord;
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
  readonly writeArgs: { sessionId: string; value: NewExamineeAssignment }[];
  readonly deps: CreateExamAssignmentDeps;
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
  const writeArgs: { sessionId: string; value: NewExamineeAssignment }[] = [];

  const deps: CreateExamAssignmentDeps = {
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
      return options.session === undefined ? storedSession() : options.session;
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
        options.created ?? { id: CREATED_ASSIGNMENT_ID, orderIndex: ASSIGNED_ORDER_INDEX }
      );
    },
    isCourseNotFoundError: (error) => error instanceof FakeCourseNotFoundError,
    isOperationNotAllowedError: (error) => error instanceof FakeOperationDeniedError,
    isUniqueConstraintError: (error) => error instanceof FakeUniqueViolationError,
  };

  return { calls, contextArgs, gateArgs, planLookupArgs, sessionArgs, traineeArgs, writeArgs, deps };
}

const FULL_ORDER = [
  "requireCourseContext",
  "assertConfigurationAllowed",
  "findExamPlanByCourseOfferingId",
  "findSessionForPlan",
  "findEligibleTrainee",
  "createAssignmentAtNextOrder",
];

// ===========================================================================
// 1–8. The happy path and the locked order
// ===========================================================================

test("1. a well-formed create returns the new id and the SERVER-assigned position", async () => {
  const h = harness();
  const result = await createExamAssignmentWithDeps(REQUESTED_OFFERING_ID, validInput(), h.deps);
  assert.deepEqual(result, {
    ok: true,
    assignmentId: CREATED_ASSIGNMENT_ID,
    orderIndex: ASSIGNED_ORDER_INDEX,
  });
});

test("2. the dependencies run in EXACTLY the locked order, once each", async () => {
  const h = harness();
  await createExamAssignmentWithDeps(REQUESTED_OFFERING_ID, validInput(), h.deps);
  assert.deepEqual(h.calls, FULL_ORDER);
});

test("3. the boundary is asked about the REQUESTED offering, and nothing else is", async () => {
  const h = harness();
  await createExamAssignmentWithDeps(REQUESTED_OFFERING_ID, validInput(), h.deps);
  assert.deepEqual(h.contextArgs, [REQUESTED_OFFERING_ID]);
  // The requested id never reaches any later dependency.
  assert.deepEqual(h.planLookupArgs, [VERIFIED_OFFERING_ID]);
  assert.deepEqual(h.traineeArgs, [
    { courseOfferingId: VERIFIED_OFFERING_ID, studentId: SUBMITTED_STUDENT_ID },
  ]);
  const serialized = JSON.stringify({ plan: h.planLookupArgs, trainee: h.traineeArgs });
  assert.equal(serialized.includes(REQUESTED_OFFERING_ID), false);
});

test("4. the gate sees the VERIFIED status", async () => {
  const h = harness({ status: "DRAFT" });
  await createExamAssignmentWithDeps(REQUESTED_OFFERING_ID, validInput(), h.deps);
  assert.deepEqual(h.gateArgs, ["DRAFT"]);
});

test("5. the session is resolved UNDER the server-resolved plan", async () => {
  const h = harness();
  await createExamAssignmentWithDeps(REQUESTED_OFFERING_ID, validInput(), h.deps);
  assert.deepEqual(h.sessionArgs, [
    { planId: SERVER_PLAN_ID, sessionId: SUBMITTED_SESSION_ID },
  ]);
});

test("6. the write receives the STORED session id and the ELIGIBLE trainee id", async () => {
  const h = harness();
  await createExamAssignmentWithDeps(REQUESTED_OFFERING_ID, validInput(), h.deps);
  assert.deepEqual(h.writeArgs, [
    {
      sessionId: STORED_SESSION_ID,
      value: { studentId: ELIGIBLE_STUDENT_ID, role: "EXAMINEE", horseName: HORSE_NAME },
    },
  ]);
  // Neither submitted id reaches the write.
  const serialized = JSON.stringify(h.writeArgs);
  assert.equal(serialized.includes(SUBMITTED_SESSION_ID), false);
  assert.equal(serialized.includes(SUBMITTED_STUDENT_ID), false);
});

test("7. the role is the module's constant and NO input can influence it", async () => {
  for (const smuggled of ["INSTRUCTED_TRAINEE", "ADMIN", "", null, 7]) {
    const h = harness();
    await createExamAssignmentWithDeps(
      REQUESTED_OFFERING_ID,
      validInput({ role: smuggled }),
      h.deps,
    );
    assert.equal(h.writeArgs[0].value.role, "EXAMINEE", `role became ${String(smuggled)}`);
  }
  // ...and no order position, plan or offering is forwarded from input either.
  const h = harness();
  await createExamAssignmentWithDeps(
    REQUESTED_OFFERING_ID,
    validInput({ orderIndex: 99, planId: "plan-smuggled", courseOfferingId: "offering-smuggled" }),
    h.deps,
  );
  assert.deepEqual(Object.keys(h.writeArgs[0].value).sort(), [
    "horseName",
    "role",
    "studentId",
  ]);
  assert.equal(JSON.stringify(h.writeArgs).includes("smuggled"), false);
});

test("8. the submitted strings are TRIMMED before anything is looked up", async () => {
  const h = harness();
  await createExamAssignmentWithDeps(
    REQUESTED_OFFERING_ID,
    { sessionId: `  ${SUBMITTED_SESSION_ID} `, studentId: ` ${SUBMITTED_STUDENT_ID}`, horseName: "  רוח  " },
    h.deps,
  );
  assert.deepEqual(h.sessionArgs, [
    { planId: SERVER_PLAN_ID, sessionId: SUBMITTED_SESSION_ID },
  ]);
  assert.equal(h.traineeArgs[0].studentId, SUBMITTED_STUDENT_ID);
  assert.equal(h.writeArgs[0].value.horseName, "רוח");
});

// ===========================================================================
// 9–16. Every refusal, and exactly which dependencies it skips
// ===========================================================================

test("9. a not-found offering refuses, and NOTHING else runs", async () => {
  const h = harness({ contextThrows: new FakeCourseNotFoundError("nope") });
  const result = await createExamAssignmentWithDeps(REQUESTED_OFFERING_ID, validInput(), h.deps);
  assert.deepEqual(result, { ok: false, code: "offering_not_found" });
  assert.deepEqual(h.calls, ["requireCourseContext"]);
});

test("10. a denied lifecycle refuses, and no exam query happens at all", async () => {
  const h = harness({ status: "ARCHIVED", gateThrows: new FakeOperationDeniedError("nope") });
  const result = await createExamAssignmentWithDeps(REQUESTED_OFFERING_ID, validInput(), h.deps);
  assert.deepEqual(result, { ok: false, code: "operation_not_allowed" });
  assert.deepEqual(h.calls, ["requireCourseContext", "assertConfigurationAllowed"]);
});

test("11. a missing plan refuses, and the input is never even examined", async () => {
  const h = harness({ plan: null });
  const result = await createExamAssignmentWithDeps(REQUESTED_OFFERING_ID, validInput(), h.deps);
  assert.deepEqual(result, { ok: false, code: "plan_not_found" });
  assert.deepEqual(h.calls, [
    "requireCourseContext",
    "assertConfigurationAllowed",
    "findExamPlanByCourseOfferingId",
  ]);
});

test("12. invalid input refuses with the sibling's issues, and probes nothing", async () => {
  const h = harness();
  const result = await createExamAssignmentWithDeps(REQUESTED_OFFERING_ID, {}, h.deps);
  assert.equal(result.ok, false);
  if (result.ok || result.code !== "invalid_input") {
    assert.fail("expected invalid_input");
    return;
  }
  assert.deepEqual(
    result.issues.map((issue) => issue.code),
    [
      "EX-ASG-IN-SESSION-REQUIRED",
      "EX-ASG-IN-STUDENT-REQUIRED",
      "EX-ASG-IN-HORSE-REQUIRED",
    ],
  );
  // No session, trainee or write dependency is reached: a malformed submission
  // cannot be used to probe which sessions or trainees exist.
  assert.deepEqual(h.calls, [
    "requireCourseContext",
    "assertConfigurationAllowed",
    "findExamPlanByCourseOfferingId",
  ]);
});

test("13. a MISSING HORSE is refused before any session lookup", async () => {
  for (const blank of ["", "   ", "\t\n", undefined, null, 42, []]) {
    const h = harness();
    const result = await createExamAssignmentWithDeps(
      REQUESTED_OFFERING_ID,
      validInput({ horseName: blank }),
      h.deps,
    );
    assert.equal(result.ok, false);
    if (result.ok || result.code !== "invalid_input") {
      assert.fail(`expected invalid_input for ${JSON.stringify(blank ?? null)}`);
      return;
    }
    assert.deepEqual(
      result.issues.map((issue) => issue.code),
      ["EX-ASG-IN-HORSE-REQUIRED"],
    );
    assert.equal(h.calls.includes("findSessionForPlan"), false);
    assert.equal(h.calls.includes("createAssignmentAtNextOrder"), false);
  }
});

test("14. an unknown or FOREIGN session refuses, and no trainee is looked up", async () => {
  const h = harness({ session: null });
  const result = await createExamAssignmentWithDeps(REQUESTED_OFFERING_ID, validInput(), h.deps);
  assert.deepEqual(result, { ok: false, code: "session_not_found" });
  assert.deepEqual(h.calls, [
    "requireCourseContext",
    "assertConfigurationAllowed",
    "findExamPlanByCourseOfferingId",
    "findSessionForPlan",
  ]);
});

test("15. an id from another identifier space simply fails session resolution", async () => {
  // The scoped read is the only way a session can be found, so an id that no
  // stored row carries is an ordinary `session_not_found` — never a special case.
  const h = harness({ session: null });
  const result = await createExamAssignmentWithDeps(
    REQUESTED_OFFERING_ID,
    validInput({ sessionId: "other-space:1234" }),
    h.deps,
  );
  assert.deepEqual(result, { ok: false, code: "session_not_found" });
  assert.deepEqual(h.sessionArgs, [{ planId: SERVER_PLAN_ID, sessionId: "other-space:1234" }]);
});

test("16. a trainee from ANOTHER course refuses, and nothing is written", async () => {
  const h = harness({ trainee: null });
  const result = await createExamAssignmentWithDeps(REQUESTED_OFFERING_ID, validInput(), h.deps);
  assert.deepEqual(result, { ok: false, code: "trainee_not_eligible" });
  assert.deepEqual(h.calls, [
    "requireCourseContext",
    "assertConfigurationAllowed",
    "findExamPlanByCourseOfferingId",
    "findSessionForPlan",
    "findEligibleTrainee",
  ]);
  // The eligibility question was asked under the VERIFIED offering, which is what
  // makes a foreign trainee unreachable rather than merely rejected.
  assert.deepEqual(h.traineeArgs, [
    { courseOfferingId: VERIFIED_OFFERING_ID, studentId: SUBMITTED_STUDENT_ID },
  ]);
});

// ===========================================================================
// 17–22. PD-1, PD-2, the horse rule and capacity
// ===========================================================================

test("17. PD-1: a definition demanding a lesson topic is refused, writing NOTHING", async () => {
  const h = harness({ session: storedSession({ requiresLessonTopic: true }) });
  const result = await createExamAssignmentWithDeps(REQUESTED_OFFERING_ID, validInput(), h.deps);
  assert.deepEqual(result, { ok: false, code: "definition_requires_unsupported_fields" });
  assert.equal(h.calls.includes("findEligibleTrainee"), false);
  assert.equal(h.calls.includes("createAssignmentAtNextOrder"), false);
});

test("18. PD-1: a definition demanding a discipline is refused the same way", async () => {
  const h = harness({ session: storedSession({ requiresDiscipline: true }) });
  const result = await createExamAssignmentWithDeps(REQUESTED_OFFERING_ID, validInput(), h.deps);
  assert.deepEqual(result, { ok: false, code: "definition_requires_unsupported_fields" });
  assert.deepEqual(h.writeArgs, []);

  const both = harness({
    session: storedSession({ requiresLessonTopic: true, requiresDiscipline: true }),
  });
  const bothResult = await createExamAssignmentWithDeps(
    REQUESTED_OFFERING_ID,
    validInput(),
    both.deps,
  );
  assert.deepEqual(bothResult, { ok: false, code: "definition_requires_unsupported_fields" });
});

test("19. PD-1 FAILS CLOSED on a malformed demand flag", async () => {
  for (const malformed of [undefined, null, "true", 1, {}]) {
    const h = harness({
      session: storedSession({
        requiresLessonTopic: malformed as unknown as boolean,
      }),
    });
    const result = await createExamAssignmentWithDeps(REQUESTED_OFFERING_ID, validInput(), h.deps);
    assert.deepEqual(
      result,
      { ok: false, code: "definition_requires_unsupported_fields" },
      `a ${String(malformed)} demand flag was read as "no requirement"`,
    );
    assert.deepEqual(h.writeArgs, []);
  }
});

test("20. PD-2: requiring a second person does NOT block the examinee row", async () => {
  const h = harness({ session: storedSession({ requiresInstructedTrainee: true }) });
  const result = await createExamAssignmentWithDeps(REQUESTED_OFFERING_ID, validInput(), h.deps);
  assert.deepEqual(result, {
    ok: true,
    assignmentId: CREATED_ASSIGNMENT_ID,
    orderIndex: ASSIGNED_ORDER_INDEX,
  });
  assert.deepEqual(h.calls, FULL_ORDER);
  // ...and the second role is not written here either: exactly ONE row is created.
  assert.equal(h.writeArgs.length, 1);
  assert.equal(h.writeArgs[0].value.role, "EXAMINEE");
});

test("21. every storable definition kind creates, carrying the submitted horse", async () => {
  for (const definitionKind of STORABLE_KINDS) {
    const h = harness({ session: storedSession({ definitionKind }) });
    const result = await createExamAssignmentWithDeps(REQUESTED_OFFERING_ID, validInput(), h.deps);
    assert.equal(result.ok, true, `kind ${definitionKind} was refused`);
    assert.equal(h.writeArgs[0].value.horseName, HORSE_NAME);
  }
});

test("22. no capacity, duration, wave or slot is ever consulted", async () => {
  // The boundary has no such dependency, so this is proved structurally: a
  // capacity limit cannot be applied by a module that cannot ask for one.
  const h = harness();
  assert.deepEqual(Object.keys(h.deps).sort(), [
    "assertConfigurationAllowed",
    "createAssignmentAtNextOrder",
    "findEligibleTrainee",
    "findExamPlanByCourseOfferingId",
    "findSessionForPlan",
    "isCourseNotFoundError",
    "isOperationNotAllowedError",
    "isUniqueConstraintError",
    "requireCourseContext",
  ]);
  // ...and a session already holding many assignments is not something this
  // operation can even observe: the same create succeeds regardless.
  const many = harness({ created: { id: CREATED_ASSIGNMENT_ID, orderIndex: 99 } });
  const result = await createExamAssignmentWithDeps(REQUESTED_OFFERING_ID, validInput(), many.deps);
  assert.deepEqual(result, {
    ok: true,
    assignmentId: CREATED_ASSIGNMENT_ID,
    orderIndex: 99,
  });
});

// ===========================================================================
// 23–29. Error classification
// ===========================================================================

test("23. a uniqueness violation is the ordinary assignment_conflict", async () => {
  const h = harness({ createThrows: new FakeUniqueViolationError("duplicate") });
  const result = await createExamAssignmentWithDeps(REQUESTED_OFFERING_ID, validInput(), h.deps);
  assert.deepEqual(result, { ok: false, code: "assignment_conflict" });
  assert.deepEqual(h.calls, FULL_ORDER);
});

/** The six dependency call sites at which a throw can originate. */
type ThrowSite =
  | "contextThrows"
  | "gateThrows"
  | "planThrows"
  | "sessionThrows"
  | "traineeThrows"
  | "createThrows";

/** Options that make exactly ONE dependency throw exactly this value. */
function throwingAt(site: ThrowSite, thrown: unknown): HarnessOptions {
  return { [site]: thrown } as unknown as HarnessOptions;
}

test("24. an UNRECOGNIZED throw from any dependency propagates with its identity", async () => {
  const sentinel = new Error("INFRASTRUCTURE_SENTINEL");
  const sites: ThrowSite[] = [
    "contextThrows",
    "gateThrows",
    "planThrows",
    "sessionThrows",
    "traineeThrows",
    "createThrows",
  ];
  for (const site of sites) {
    const h = harness(throwingAt(site, sentinel));
    await assert.rejects(
      () => createExamAssignmentWithDeps(REQUESTED_OFFERING_ID, validInput(), h.deps),
      (error: unknown) => {
        assert.equal(error, sentinel, `${site} did not propagate the SAME object`);
        return true;
      },
    );
  }
});

test("25. a REDIRECT-shaped throw is never converted into a refusal", async () => {
  for (const site of ["contextThrows", "gateThrows"] as const) {
    const redirect = redirectLikeError();
    const h = harness(throwingAt(site, redirect));
    await assert.rejects(
      () => createExamAssignmentWithDeps(REQUESTED_OFFERING_ID, validInput(), h.deps),
      (error: unknown) => {
        assert.equal(error, redirect);
        assert.equal(
          (error as { digest?: string }).digest,
          "REDIRECT;replace;/login;307;",
          "the redirect payload was altered",
        );
        return true;
      },
    );
  }
});

test("26. each classifier is asked ONLY where its failure can occur", async () => {
  // The course not-found is not recognized at the gate...
  const atGate = harness({ gateThrows: new FakeCourseNotFoundError("wrong place") });
  await assert.rejects(() =>
    createExamAssignmentWithDeps(REQUESTED_OFFERING_ID, validInput(), atGate.deps),
  );
  // ...the lifecycle denial is not recognized at the boundary...
  const atContext = harness({ contextThrows: new FakeOperationDeniedError("wrong place") });
  await assert.rejects(() =>
    createExamAssignmentWithDeps(REQUESTED_OFFERING_ID, validInput(), atContext.deps),
  );
  // ...and the uniqueness violation is recognized ONLY at the write.
  for (const site of ["contextThrows", "gateThrows", "planThrows", "sessionThrows", "traineeThrows"] as const) {
    const h = harness(throwingAt(site, new FakeUniqueViolationError("wrong place")));
    await assert.rejects(
      () => createExamAssignmentWithDeps(REQUESTED_OFFERING_ID, validInput(), h.deps),
      `a uniqueness violation at ${site} was laundered into a refusal`,
    );
  }
});

test("27. a thrown NON-ERROR value propagates unchanged too", async () => {
  for (const thrown of ["a string", 0, null, { code: "P2002" }]) {
    const h = harness({ createThrows: thrown });
    await assert.rejects(
      () => createExamAssignmentWithDeps(REQUESTED_OFFERING_ID, validInput(), h.deps),
      (error: unknown) => {
        assert.equal(error, thrown);
        return true;
      },
    );
  }
});

test("28. a refusal never runs a later dependency, on any path", async () => {
  const cases: { options: HarnessOptions; input: unknown; expected: string[] }[] = [
    { options: { contextThrows: new FakeCourseNotFoundError() }, input: validInput(), expected: FULL_ORDER.slice(0, 1) },
    { options: { gateThrows: new FakeOperationDeniedError() }, input: validInput(), expected: FULL_ORDER.slice(0, 2) },
    { options: { plan: null }, input: validInput(), expected: FULL_ORDER.slice(0, 3) },
    { options: {}, input: {}, expected: FULL_ORDER.slice(0, 3) },
    { options: { session: null }, input: validInput(), expected: FULL_ORDER.slice(0, 4) },
    {
      options: { session: storedSession({ requiresDiscipline: true }) },
      input: validInput(),
      expected: FULL_ORDER.slice(0, 4),
    },
    { options: { trainee: null }, input: validInput(), expected: FULL_ORDER.slice(0, 5) },
  ];
  for (const { options, input, expected } of cases) {
    const h = harness(options);
    await createExamAssignmentWithDeps(REQUESTED_OFFERING_ID, input, h.deps);
    assert.deepEqual(h.calls, expected);
  }
});

test("29. nothing is written when the definition is unsupported, even under retry", async () => {
  const h = harness({ session: storedSession({ requiresLessonTopic: true }) });
  await createExamAssignmentWithDeps(REQUESTED_OFFERING_ID, validInput(), h.deps);
  await createExamAssignmentWithDeps(REQUESTED_OFFERING_ID, validInput(), h.deps);
  assert.deepEqual(h.writeArgs, []);
});

// ===========================================================================
// 30–34. The result model
// ===========================================================================

/** Recursively assert a value is plain, frozen and JSON-safe. */
function assertPlainFrozenJsonSafe(value: unknown, path = "$"): void {
  if (value === null) return;
  if (typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    assert.equal(Number.isFinite(value), true, `${path} is not a finite number`);
    assert.equal(Object.is(value, -0), false, `${path} is negative zero`);
    return;
  }
  assert.equal(typeof value, "object", `${path} is a ${typeof value}`);
  assert.equal(Object.isFrozen(value), true, `${path} is not frozen`);
  assert.equal(value instanceof Map, false, `${path} is a Map`);
  assert.equal(value instanceof Set, false, `${path} is a Set`);
  assert.equal(value instanceof Error, false, `${path} is an Error`);
  assert.equal(
    Object.prototype.toString.call(value),
    Array.isArray(value) ? "[object Array]" : "[object Object]",
    `${path} is an exotic object`,
  );
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertPlainFrozenJsonSafe(entry, `${path}[${index}]`));
    return;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    assert.notEqual(entry, undefined, `${path}.${key} is undefined`);
    assertPlainFrozenJsonSafe(entry, `${path}.${key}`);
  }
}

async function everyResult(): Promise<CreateExamAssignmentResult[]> {
  const runs: Promise<CreateExamAssignmentResult>[] = [
    createExamAssignmentWithDeps(REQUESTED_OFFERING_ID, validInput(), harness().deps),
    createExamAssignmentWithDeps(REQUESTED_OFFERING_ID, {}, harness().deps),
    createExamAssignmentWithDeps(
      REQUESTED_OFFERING_ID,
      validInput(),
      harness({ contextThrows: new FakeCourseNotFoundError() }).deps,
    ),
    createExamAssignmentWithDeps(
      REQUESTED_OFFERING_ID,
      validInput(),
      harness({ gateThrows: new FakeOperationDeniedError() }).deps,
    ),
    createExamAssignmentWithDeps(REQUESTED_OFFERING_ID, validInput(), harness({ plan: null }).deps),
    createExamAssignmentWithDeps(
      REQUESTED_OFFERING_ID,
      validInput(),
      harness({ session: null }).deps,
    ),
    createExamAssignmentWithDeps(
      REQUESTED_OFFERING_ID,
      validInput(),
      harness({ session: storedSession({ requiresLessonTopic: true }) }).deps,
    ),
    createExamAssignmentWithDeps(
      REQUESTED_OFFERING_ID,
      validInput(),
      harness({ trainee: null }).deps,
    ),
    createExamAssignmentWithDeps(
      REQUESTED_OFFERING_ID,
      validInput(),
      harness({ createThrows: new FakeUniqueViolationError() }).deps,
    ),
  ];
  return Promise.all(runs);
}

test("30. every result is frozen, plain and JSON-safe all the way down", async () => {
  for (const result of await everyResult()) assertPlainFrozenJsonSafe(result);
});

test("31. every result JSON round-trips to an equal value", async () => {
  for (const result of await everyResult()) {
    assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  }
});

test("32. `issues` exists on invalid_input and on NO other arm", async () => {
  for (const result of await everyResult()) {
    const hasIssues = Object.prototype.hasOwnProperty.call(result, "issues");
    const isInvalidInput = result.ok === false && result.code === "invalid_input";
    assert.equal(hasIssues, isInvalidInput, JSON.stringify(result));
  }
});

test("33. no result echoes an id, a horse or a submitted value", async () => {
  for (const result of await everyResult()) {
    const serialized = JSON.stringify(result);
    for (const secret of [
      REQUESTED_OFFERING_ID,
      VERIFIED_OFFERING_ID,
      SERVER_PLAN_ID,
      SUBMITTED_SESSION_ID,
      STORED_SESSION_ID,
      SUBMITTED_STUDENT_ID,
      ELIGIBLE_STUDENT_ID,
      HORSE_NAME,
    ]) {
      assert.equal(serialized.includes(secret), false, `a result echoes ${secret}`);
    }
  }
});

test("34. the success arm carries exactly three keys, and an order of 0 survives", async () => {
  const h = harness({ created: { id: CREATED_ASSIGNMENT_ID, orderIndex: 0 } });
  const result = await createExamAssignmentWithDeps(REQUESTED_OFFERING_ID, validInput(), h.deps);
  assert.deepEqual(Object.keys(result).sort(), ["assignmentId", "ok", "orderIndex"]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(Object.is(result.orderIndex, 0), true);
});

// ===========================================================================
// 35–44. Structural guards
// ===========================================================================

const EXAM_DIR = import.meta.dirname;
const MODULE_NAME = "create-exam-assignment-core.ts";
const TEST_NAME = "create-exam-assignment-core.test.ts";
const SOURCE = readFileSync(join(EXAM_DIR, MODULE_NAME), "utf8");

/** Strip comments so the guards assert on CODE, not on explanatory prose. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const CODE = stripComments(SOURCE);

/** Keep ONLY the comments, for the "is this documented?" assertions. */
const COMMENTS = [
  ...(SOURCE.match(/\/\*[\s\S]*?\*\//g) ?? []),
  ...(SOURCE.match(/^\s*\/\/.*$/gm) ?? []),
].join("\n");

/**
 * Forbidden specifiers, assembled from SPLIT LITERALS: the committed exam-slice
 * guards scan every file in this directory for these exact tokens, and spelling
 * one out here would make this suite trip them.
 */
const PRISMA_MODULE = ["@/lib", "prisma"].join("/");
const GENERATED_CLIENT = ["@prisma", "client"].join("/");
const ENV_READ = ["process", "env"].join(".");

test("35. the pure core imports no database client and performs no IO", () => {
  for (const token of [
    PRISMA_MODULE,
    GENERATED_CLIENT,
    "$transaction",
    "$executeRaw",
    "$queryRaw",
    "readFile",
    "writeFile",
    "fetch(",
    ENV_READ,
  ]) {
    assert.equal(CODE.includes(token), false, `the pure core references ${token}`);
  }
  const dbCalls =
    /\.(create|createMany|update|updateMany|upsert|delete|deleteMany|findUnique|findFirst|findMany|count|aggregate)\s*\(/;
  assert.equal(dbCalls.test(CODE), false, "the pure core performs a database operation");
});

test("36. the pure core imports no auth, app, framework or action module", () => {
  for (const token of [
    "lib/auth",
    "lib/course",
    "lib/actions",
    "@/app",
    "next/",
    "next-auth",
    "cookies(",
    "requireAdmin",
    "getCurrent",
    "AdminCourseContext",
    "assertCourseOperationAllowed",
    "react",
    "React",
  ]) {
    assert.equal(CODE.includes(token), false, `the pure core references ${token}`);
  }
  assert.equal(CODE.includes("server" + "-only"), false);
  assert.equal(CODE.includes('"use ' + 'server"'), false);
  assert.equal(CODE.includes('"use ' + 'client"'), false);
  assert.ok(COMMENTS.includes("server" + "-only"), "the rule is undocumented");
});

test("37. the pure core consults no capability of any kind", () => {
  for (const token of [
    '"EXAMS"',
    "'EXAMS'",
    "CapabilityKey",
    "capability",
    "Capability",
    "getEffectiveCapabilities",
  ]) {
    assert.equal(CODE.includes(token), false, `the pure core consults ${token}`);
  }
});

test("38. the pure core has NO calendar type, clock, randomness or process access", () => {
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

test("39. the pure core imports ONLY committed sibling exam cores", () => {
  const specifiers = [...CODE.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(specifiers)].sort(), [
    "./exam-assignment-write-core",
    "./exam-definition-validation-core",
    "./exam-domain-core",
  ]);
  for (const specifier of specifiers) {
    assert.ok(specifier.startsWith("./exam-"), `the core imports ${specifier}`);
  }
  // The horse rule is REUSED, not restated, so the two cannot disagree.
  assert.ok(/isHorseRequiredFor/.test(CODE), "the committed horse rule is not consulted");
  for (const restated of ["INTERFACE_RIDING", "LUNGE_NO_RIDER", "ADVANCED_INSTRUCTION"]) {
    assert.equal(CODE.includes(restated), false, `the core restates the kind ${restated}`);
  }
});

test("40. the role is a module constant, never a parameter or an input field", () => {
  assert.ok(/const ROLE_EXAMINEE = "EXAMINEE"/.test(CODE), "the role is not a fixed constant");
  const orchestration = [
    ...SOURCE.matchAll(/export async function (\w+)\(([\s\S]*?)\):\s*([^{]+)\{/g),
  ].map(([, name, params, returns]) => ({
    name,
    params: params.replace(/\s+/g, " ").trim(),
    returns: returns.replace(/\s+/g, " ").trim(),
  }))[0];
  assert.equal(orchestration.name, "createExamAssignmentWithDeps");
  assert.equal(
    orchestration.params,
    "courseOfferingId: string, rawInput: unknown, deps: CreateExamAssignmentDeps,",
  );
  assert.equal(orchestration.returns, "Promise<CreateExamAssignmentResult>");
  for (const forbidden of ["role", "planId", "orderIndex", "sessionId", "actorId", "tx:", "prisma"]) {
    assert.equal(
      orchestration.params.includes(forbidden),
      false,
      `the orchestration accepts ${forbidden}`,
    );
  }
});

test("41. no capacity, wave, slot or timetable notion appears in the code", () => {
  for (const token of [
    "parallelCapacity",
    "durationMinutes",
    "waves",
    "slots",
    "endTime",
    "breaks",
    "supervisor",
    "publish",
    "notif",
  ]) {
    assert.equal(CODE.includes(token), false, `the pure core references ${token}`);
  }
  // ...and the reason capacity is absent is written down rather than forgotten.
  assert.ok(/capacity/i.test(COMMENTS), "the capacity decision is undocumented");
  assert.ok(/wave/i.test(COMMENTS), "the per-wave meaning of capacity is not stated");
});

test("42. no result code beyond the eight approved outcomes exists", () => {
  const codes = [...CODE.matchAll(/refuse\("([a-z_]+)"\)|code: "([a-z_]+)"/g)]
    .map((m) => m[1] ?? m[2])
    .filter((code): code is string => typeof code === "string");
  assert.deepEqual([...new Set(codes)].sort(), [
    "assignment_conflict",
    "definition_requires_unsupported_fields",
    "invalid_input",
    "offering_not_found",
    "operation_not_allowed",
    "plan_not_found",
    "session_not_found",
    "trainee_not_eligible",
  ]);
  for (const token of ["unexpected", "stale_write", "archived", "capacity_exceeded", "session_full"]) {
    assert.equal(CODE.includes(token), false, `the pure core invents ${token}`);
  }
});

test("43. exactly three classifiers exist, and no raw error is inspected", () => {
  const predicates = [...CODE.matchAll(/\bis[A-Z]\w+Error\b/g)].map((m) => m[0]);
  assert.deepEqual([...new Set(predicates)].sort(), [
    "isCourseNotFoundError",
    "isOperationNotAllowedError",
    "isUniqueConstraintError",
  ]);
  for (const token of ["P2002", "P2003", "P2025", "error.code", "error.message", "instanceof"]) {
    assert.equal(CODE.includes(token), false, `the pure core inspects ${token}`);
  }
  // Each try wraps exactly one dependency call, and there is no catch-all.
  const tryBlocks = CODE.match(/try \{/g) ?? [];
  assert.equal(tryBlocks.length, 3, "the number of guarded calls changed");
  assert.equal((CODE.match(/throw error;/g) ?? []).length, 3, "an unrecognized throw is swallowed");
  assert.ok(/NEXT_REDIRECT/.test(COMMENTS), "the redirect rule is undocumented");
});

test("44. PD-1 and PD-2 are BOTH written down, not just implemented", () => {
  assert.ok(/PD-1/.test(COMMENTS) && /PD-2/.test(COMMENTS), "the locked decisions are unnamed");
  assert.ok(/requiresLessonTopic/.test(CODE), "the topic demand is not checked");
  assert.ok(/requiresDiscipline/.test(CODE), "the discipline demand is not checked");
  // PD-2 is a deliberate NON-check: the flag must be modelled but never gate.
  assert.ok(/requiresInstructedTrainee/.test(SOURCE), "the second-role flag is not modelled");
  const guarded = CODE.split("export async function")[1] ?? "";
  assert.equal(
    guarded.includes("requiresInstructedTrainee"),
    false,
    "the orchestration gates on requiresInstructedTrainee",
  );
});

test("45. the slice's two lib/exam files are exactly the approved pair", () => {
  const sliceFiles = readdirSync(EXAM_DIR)
    .filter((name) => name.startsWith("create-exam-assignment-core"))
    .sort();
  assert.deepEqual(sliceFiles, [MODULE_NAME, TEST_NAME].sort());
});

test("46. this suite opens no database and reads no environment", () => {
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
      "./create-exam-assignment-core",
      "./exam-domain-core",
      "node:assert/strict",
      "node:fs",
      "node:path",
      "node:test",
    ],
  );
});
