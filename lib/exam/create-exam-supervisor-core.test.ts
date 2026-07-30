/**
 * EXAM EX-SUP-C1 — executable tests for the PURE supervisor CREATE orchestration
 * (create-exam-supervisor-core.ts).
 *
 * Run with: npx tsx --test lib/exam/create-exam-supervisor-core.test.ts
 *
 * DB-FREE: every dependency is a fake, no database connection is opened, no SQL
 * is executed, no environment variable is read, and no production identifier
 * appears anywhere. The only files read are module SOURCE TEXTS, by the
 * structural guards at the bottom.
 *
 * SCOPE OF PROOF:
 *   - the LOCKED ORDER: authorize -> gate -> resolve plan -> validate input ->
 *     verify session -> ask eligibility -> write, and, for every failure, exactly
 *     WHICH later dependencies are skipped;
 *   - that the VERIFIED offering id — never the requested one — reaches the plan
 *     lookup and the eligibility question, and that the session is resolved under
 *     the SERVER-RESOLVED plan;
 *   - that the STORED session id and the ELIGIBLE instructor id, not the
 *     submitted ones, are what the write receives;
 *   - that eligibility is an INJECTED ANSWER and no rule about instructors lives
 *     in the core;
 *   - that a uniqueness violation is the ordinary `already_supervising`, and that
 *     everything else — including a redirect-shaped throw — propagates unchanged
 *     with its identity intact;
 *   - that NO permission is read, granted or checked, and no ordering exists;
 *   - the result model: narrow, plain, frozen, JSON-round-trippable, non-echoing.
 *
 * NOTE ON IDS: the fixtures use obviously-fake, hyphenated ids, and the requested
 * and verified values are deliberately DIFFERENT so a test can prove which one
 * flows onward. No cuid-shaped or production identifier is written here.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  createExamSupervisorWithDeps,
  type CreateExamSupervisorDeps,
  type CreateExamSupervisorResult,
  type CreatedExamSupervisorRecord,
  type EligibleExamSupervisorInstructor,
  type ResolvedExamPlanForSupervisorCreate,
  type VerifiedExamSessionForSupervisorCreate,
} from "./create-exam-supervisor-core";

// ===========================================================================
// Fixtures
// ===========================================================================

/** What the caller ASKS for. Deliberately different from what is verified. */
const REQUESTED_OFFERING_ID = "offering-a-as-requested";
/** What the boundary VERIFIED. Only this may reach the plan and eligibility. */
const VERIFIED_OFFERING_ID = "offering-a-as-verified";
/** The plan the SERVER resolved. Only this may reach the scoped session read. */
const SERVER_PLAN_ID = "plan-a-resolved-by-server";

/** The session the CLIENT submitted. */
const SUBMITTED_SESSION_ID = "session-a-as-submitted";
/** The id of the row the plan-scoped read actually returned. */
const STORED_SESSION_ID = "session-a-as-stored";

/** The instructor the CLIENT submitted. */
const SUBMITTED_INSTRUCTOR_ID = "instructor-a-as-submitted";
/** The id the ELIGIBILITY question returned. Only this may reach the write. */
const ELIGIBLE_INSTRUCTOR_ID = "instructor-a-as-eligible";

const CREATED_SUPERVISOR_ID = "supervisor-a-as-created";

function validInput(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sessionId: SUBMITTED_SESSION_ID,
    instructorId: SUBMITTED_INSTRUCTOR_ID,
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
  readonly plan?: ResolvedExamPlanForSupervisorCreate | null;
  readonly session?: VerifiedExamSessionForSupervisorCreate | null;
  readonly instructor?: EligibleExamSupervisorInstructor | null;
  readonly created?: CreatedExamSupervisorRecord;
  readonly contextThrows?: unknown;
  readonly gateThrows?: unknown;
  readonly planThrows?: unknown;
  readonly sessionThrows?: unknown;
  readonly instructorThrows?: unknown;
  readonly createThrows?: unknown;
}

interface Harness {
  /** Dependency names, in the exact order they were invoked. */
  readonly calls: string[];
  readonly contextArgs: string[];
  readonly gateArgs: string[];
  readonly planLookupArgs: string[];
  readonly sessionArgs: { planId: string; sessionId: string }[];
  readonly instructorArgs: { courseOfferingId: string; instructorId: string }[];
  readonly writeArgs: { sessionId: string; instructorId: string }[];
  readonly deps: CreateExamSupervisorDeps;
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
  const instructorArgs: { courseOfferingId: string; instructorId: string }[] = [];
  const writeArgs: { sessionId: string; instructorId: string }[] = [];

  const deps: CreateExamSupervisorDeps = {
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
      return options.session === undefined ? { id: STORED_SESSION_ID } : options.session;
    },
    findEligibleInstructor: async (courseOfferingId, instructorId) => {
      calls.push("findEligibleInstructor");
      instructorArgs.push({ courseOfferingId, instructorId });
      if ("instructorThrows" in options) throw options.instructorThrows;
      return options.instructor === undefined
        ? { instructorId: ELIGIBLE_INSTRUCTOR_ID }
        : options.instructor;
    },
    createSupervisor: async (sessionId, instructorId) => {
      calls.push("createSupervisor");
      writeArgs.push({ sessionId, instructorId });
      if ("createThrows" in options) throw options.createThrows;
      return options.created ?? { id: CREATED_SUPERVISOR_ID };
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
    instructorArgs,
    writeArgs,
    deps,
  };
}

const FULL_ORDER = [
  "requireCourseContext",
  "assertConfigurationAllowed",
  "findExamPlanByCourseOfferingId",
  "findSessionForPlan",
  "findEligibleInstructor",
  "createSupervisor",
];

// ===========================================================================
// 1–7. The happy path and the locked order
// ===========================================================================

test("C1. a well-formed create returns the NEW supervisor id and nothing else", async () => {
  const h = harness();
  const result = await createExamSupervisorWithDeps(REQUESTED_OFFERING_ID, validInput(), h.deps);
  assert.deepEqual(result, { ok: true, supervisorId: CREATED_SUPERVISOR_ID });
  assert.deepEqual(Object.keys(result).sort(), ["ok", "supervisorId"]);
});

test("C2. the dependencies run in EXACTLY the locked order, once each", async () => {
  const h = harness();
  await createExamSupervisorWithDeps(REQUESTED_OFFERING_ID, validInput(), h.deps);
  assert.deepEqual(h.calls, FULL_ORDER);
});

test("C3. the boundary is asked about the REQUESTED offering, and NOTHING else is", async () => {
  const h = harness();
  await createExamSupervisorWithDeps(REQUESTED_OFFERING_ID, validInput(), h.deps);
  assert.deepEqual(h.contextArgs, [REQUESTED_OFFERING_ID]);
  const serialized = JSON.stringify({
    plan: h.planLookupArgs,
    instructor: h.instructorArgs,
    session: h.sessionArgs,
    write: h.writeArgs,
  });
  assert.equal(
    serialized.includes(REQUESTED_OFFERING_ID),
    false,
    "the requested offering id reached a later dependency",
  );
});

test("C4. the VERIFIED offering id reaches the plan lookup AND the eligibility question", async () => {
  const h = harness();
  await createExamSupervisorWithDeps(REQUESTED_OFFERING_ID, validInput(), h.deps);
  assert.deepEqual(h.planLookupArgs, [VERIFIED_OFFERING_ID]);
  assert.deepEqual(h.instructorArgs, [
    { courseOfferingId: VERIFIED_OFFERING_ID, instructorId: SUBMITTED_INSTRUCTOR_ID },
  ]);
});

test("C5. the gate sees the VERIFIED status, and the session the SERVER-RESOLVED plan", async () => {
  const h = harness({ status: "DRAFT" });
  await createExamSupervisorWithDeps(REQUESTED_OFFERING_ID, validInput(), h.deps);
  assert.deepEqual(h.gateArgs, ["DRAFT"]);
  assert.deepEqual(h.sessionArgs, [
    { planId: SERVER_PLAN_ID, sessionId: SUBMITTED_SESSION_ID },
  ]);
});

test("C6. the write receives the STORED session id and the ELIGIBLE instructor id", async () => {
  const h = harness();
  await createExamSupervisorWithDeps(REQUESTED_OFFERING_ID, validInput(), h.deps);
  assert.deepEqual(h.writeArgs, [
    { sessionId: STORED_SESSION_ID, instructorId: ELIGIBLE_INSTRUCTOR_ID },
  ]);
  // Neither submitted id reaches the write.
  const serialized = JSON.stringify(h.writeArgs);
  assert.equal(serialized.includes(SUBMITTED_SESSION_ID), false);
  assert.equal(serialized.includes(SUBMITTED_INSTRUCTOR_ID), false);
});

test("C7. the submitted strings are TRIMMED before anything is looked up, and nothing else is forwarded", async () => {
  const h = harness();
  await createExamSupervisorWithDeps(
    REQUESTED_OFFERING_ID,
    {
      sessionId: `  ${SUBMITTED_SESSION_ID} `,
      instructorId: ` ${SUBMITTED_INSTRUCTOR_ID}\t`,
      planId: "plan-smuggled",
      courseOfferingId: "offering-smuggled",
      orderIndex: 99,
      isPrimary: true,
    },
    h.deps,
  );
  assert.deepEqual(h.sessionArgs, [
    { planId: SERVER_PLAN_ID, sessionId: SUBMITTED_SESSION_ID },
  ]);
  assert.equal(h.instructorArgs[0].instructorId, SUBMITTED_INSTRUCTOR_ID);
  assert.deepEqual(Object.keys(h.writeArgs[0]).sort(), ["instructorId", "sessionId"]);
  assert.equal(JSON.stringify(h.writeArgs).includes("smuggled"), false);
});

// ===========================================================================
// 8–15. Every refusal, and exactly which dependencies it skips
// ===========================================================================

test("C8. a not-found offering refuses, and NOTHING else runs", async () => {
  const h = harness({ contextThrows: new FakeCourseNotFoundError("nope") });
  const result = await createExamSupervisorWithDeps(REQUESTED_OFFERING_ID, validInput(), h.deps);
  assert.deepEqual(result, { ok: false, code: "offering_not_found" });
  assert.deepEqual(h.calls, ["requireCourseContext"]);
});

test("C9. a denied lifecycle refuses, and no exam query happens at all", async () => {
  const h = harness({ status: "ARCHIVED", gateThrows: new FakeOperationDeniedError("nope") });
  const result = await createExamSupervisorWithDeps(REQUESTED_OFFERING_ID, validInput(), h.deps);
  assert.deepEqual(result, { ok: false, code: "operation_not_allowed" });
  assert.deepEqual(h.calls, ["requireCourseContext", "assertConfigurationAllowed"]);
});

test("C10. a missing plan refuses, and the input is never even examined", async () => {
  const h = harness({ plan: null });
  const result = await createExamSupervisorWithDeps(REQUESTED_OFFERING_ID, validInput(), h.deps);
  assert.deepEqual(result, { ok: false, code: "plan_not_found" });
  assert.deepEqual(h.calls, FULL_ORDER.slice(0, 3));
});

test("C11. invalid input refuses with the sibling's issues, and probes nothing", async () => {
  const h = harness();
  const result = await createExamSupervisorWithDeps(REQUESTED_OFFERING_ID, {}, h.deps);
  assert.equal(result.ok, false);
  if (result.ok || result.code !== "invalid_input") {
    assert.fail("expected invalid_input");
    return;
  }
  assert.deepEqual(
    result.issues.map((issue) => issue.code),
    ["EX-SUP-IN-SESSION-REQUIRED", "EX-SUP-IN-INSTRUCTOR-REQUIRED"],
  );
  // No session lookup, no eligibility question and no write: a malformed
  // submission cannot be used to probe which sessions or instructors exist.
  assert.deepEqual(h.calls, FULL_ORDER.slice(0, 3));
});

test("C12. every malformed submission shape is invalid_input, never a throw", async () => {
  for (const raw of [undefined, null, 0, "", [], { sessionId: 7 }, { instructorId: " " }]) {
    const h = harness();
    const result = await createExamSupervisorWithDeps(REQUESTED_OFFERING_ID, raw, h.deps);
    assert.equal(result.ok, false, `raw ${JSON.stringify(raw ?? null)} was accepted`);
    if (result.ok) return;
    assert.equal(result.code, "invalid_input");
    assert.deepEqual(h.calls, FULL_ORDER.slice(0, 3));
  }
});

test("C13. an unknown or FOREIGN session refuses, and no instructor is looked up", async () => {
  const h = harness({ session: null });
  const result = await createExamSupervisorWithDeps(REQUESTED_OFFERING_ID, validInput(), h.deps);
  assert.deepEqual(result, { ok: false, code: "session_not_found" });
  assert.deepEqual(h.calls, FULL_ORDER.slice(0, 4));
  // An id from another identifier space is the SAME ordinary refusal: the scoped
  // read is the only way a session can be found.
  const other = harness({ session: null });
  const otherResult = await createExamSupervisorWithDeps(
    REQUESTED_OFFERING_ID,
    validInput({ sessionId: "other-space:1234" }),
    other.deps,
  );
  assert.deepEqual(otherResult, { ok: false, code: "session_not_found" });
  assert.deepEqual(other.sessionArgs, [
    { planId: SERVER_PLAN_ID, sessionId: "other-space:1234" },
  ]);
});

test("C14. an INELIGIBLE instructor refuses, and nothing is written", async () => {
  const h = harness({ instructor: null });
  const result = await createExamSupervisorWithDeps(REQUESTED_OFFERING_ID, validInput(), h.deps);
  assert.deepEqual(result, { ok: false, code: "instructor_not_eligible" });
  assert.deepEqual(h.calls, FULL_ORDER.slice(0, 5));
  assert.deepEqual(h.writeArgs, []);
  // The question was asked under the VERIFIED offering, which is what makes an
  // instructor from elsewhere unreachable rather than merely rejected.
  assert.deepEqual(h.instructorArgs, [
    { courseOfferingId: VERIFIED_OFFERING_ID, instructorId: SUBMITTED_INSTRUCTOR_ID },
  ]);
});

test("C15. a DUPLICATE pair is the ordinary already_supervising", async () => {
  const h = harness({ createThrows: new FakeUniqueViolationError("duplicate") });
  const result = await createExamSupervisorWithDeps(REQUESTED_OFFERING_ID, validInput(), h.deps);
  assert.deepEqual(result, { ok: false, code: "already_supervising" });
  assert.deepEqual(h.calls, FULL_ORDER);
  // It is classified AT THE WRITE, never pre-checked by a read: there is no
  // dependency capable of listing the existing supervisors of a session.
  assert.equal(
    Object.keys(h.deps).some((name) => /list|existing|supervisors/i.test(name)),
    false,
  );
});

test("C16. a refusal NEVER runs a later dependency, on any path", async () => {
  const cases: { options: HarnessOptions; input: unknown; expected: string[] }[] = [
    {
      options: { contextThrows: new FakeCourseNotFoundError() },
      input: validInput(),
      expected: FULL_ORDER.slice(0, 1),
    },
    {
      options: { gateThrows: new FakeOperationDeniedError() },
      input: validInput(),
      expected: FULL_ORDER.slice(0, 2),
    },
    { options: { plan: null }, input: validInput(), expected: FULL_ORDER.slice(0, 3) },
    { options: {}, input: {}, expected: FULL_ORDER.slice(0, 3) },
    { options: { session: null }, input: validInput(), expected: FULL_ORDER.slice(0, 4) },
    { options: { instructor: null }, input: validInput(), expected: FULL_ORDER.slice(0, 5) },
  ];
  for (const { options, input, expected } of cases) {
    const h = harness(options);
    await createExamSupervisorWithDeps(REQUESTED_OFFERING_ID, input, h.deps);
    assert.deepEqual(h.calls, expected);
  }
});

// ===========================================================================
// 17–21. Error classification
// ===========================================================================

/** The six dependency call sites at which a throw can originate. */
type ThrowSite =
  | "contextThrows"
  | "gateThrows"
  | "planThrows"
  | "sessionThrows"
  | "instructorThrows"
  | "createThrows";

/** Options that make exactly ONE dependency throw exactly this value. */
function throwingAt(site: ThrowSite, thrown: unknown): HarnessOptions {
  return { [site]: thrown } as unknown as HarnessOptions;
}

const THROW_SITES: ThrowSite[] = [
  "contextThrows",
  "gateThrows",
  "planThrows",
  "sessionThrows",
  "instructorThrows",
  "createThrows",
];

test("C17. an UNRECOGNIZED throw from any dependency propagates with its identity", async () => {
  const sentinel = new Error("INFRASTRUCTURE_SENTINEL");
  for (const site of THROW_SITES) {
    const h = harness(throwingAt(site, sentinel));
    await assert.rejects(
      () => createExamSupervisorWithDeps(REQUESTED_OFFERING_ID, validInput(), h.deps),
      (error: unknown) => {
        assert.equal(error, sentinel, `${site} did not propagate the SAME object`);
        return true;
      },
    );
  }
});

test("C18. a REDIRECT-shaped throw is NEVER converted into a refusal", async () => {
  for (const site of ["contextThrows", "gateThrows"] as const) {
    const redirect = redirectLikeError();
    const h = harness(throwingAt(site, redirect));
    await assert.rejects(
      () => createExamSupervisorWithDeps(REQUESTED_OFFERING_ID, validInput(), h.deps),
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

test("C19. each classifier is asked ONLY where its failure can occur", async () => {
  // The course not-found is not recognized at the gate...
  const atGate = harness({ gateThrows: new FakeCourseNotFoundError("wrong place") });
  await assert.rejects(() =>
    createExamSupervisorWithDeps(REQUESTED_OFFERING_ID, validInput(), atGate.deps),
  );
  // ...the lifecycle denial is not recognized at the boundary...
  const atContext = harness({ contextThrows: new FakeOperationDeniedError("wrong place") });
  await assert.rejects(() =>
    createExamSupervisorWithDeps(REQUESTED_OFFERING_ID, validInput(), atContext.deps),
  );
  // ...and the uniqueness violation is recognized ONLY at the write.
  for (const site of THROW_SITES.filter((s) => s !== "createThrows")) {
    const h = harness(throwingAt(site, new FakeUniqueViolationError("wrong place")));
    await assert.rejects(
      () => createExamSupervisorWithDeps(REQUESTED_OFFERING_ID, validInput(), h.deps),
      `a uniqueness violation at ${site} was laundered into a refusal`,
    );
  }
});

test("C20. a thrown NON-ERROR value propagates unchanged too", async () => {
  for (const thrown of ["a string", 0, null, { code: "P2002" }]) {
    const h = harness({ createThrows: thrown });
    await assert.rejects(
      () => createExamSupervisorWithDeps(REQUESTED_OFFERING_ID, validInput(), h.deps),
      (error: unknown) => {
        assert.equal(error, thrown);
        return true;
      },
    );
  }
});

test("C21. the injected boundary is EXACTLY the nine approved dependencies", async () => {
  const h = harness();
  assert.deepEqual(Object.keys(h.deps).sort(), [
    "assertConfigurationAllowed",
    "createSupervisor",
    "findEligibleInstructor",
    "findExamPlanByCourseOfferingId",
    "findSessionForPlan",
    "isCourseNotFoundError",
    "isOperationNotAllowedError",
    "isUniqueConstraintError",
    "requireCourseContext",
  ]);
  // No dependency can reorder, count, notify, publish, or resolve a permission:
  // the operation is structurally incapable of it.
  for (const forbidden of [/reorder/i, /order/i, /count/i, /notif/i, /publish/i, /permission/i, /grant/i]) {
    assert.equal(
      Object.keys(h.deps).some((name) => forbidden.test(name)),
      false,
      `the boundary exposes a ${forbidden} dependency`,
    );
  }
});

// ===========================================================================
// 22–26. The result model
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

async function everyResult(): Promise<CreateExamSupervisorResult[]> {
  return Promise.all([
    createExamSupervisorWithDeps(REQUESTED_OFFERING_ID, validInput(), harness().deps),
    createExamSupervisorWithDeps(REQUESTED_OFFERING_ID, {}, harness().deps),
    createExamSupervisorWithDeps(
      REQUESTED_OFFERING_ID,
      validInput(),
      harness({ contextThrows: new FakeCourseNotFoundError() }).deps,
    ),
    createExamSupervisorWithDeps(
      REQUESTED_OFFERING_ID,
      validInput(),
      harness({ gateThrows: new FakeOperationDeniedError() }).deps,
    ),
    createExamSupervisorWithDeps(REQUESTED_OFFERING_ID, validInput(), harness({ plan: null }).deps),
    createExamSupervisorWithDeps(
      REQUESTED_OFFERING_ID,
      validInput(),
      harness({ session: null }).deps,
    ),
    createExamSupervisorWithDeps(
      REQUESTED_OFFERING_ID,
      validInput(),
      harness({ instructor: null }).deps,
    ),
    createExamSupervisorWithDeps(
      REQUESTED_OFFERING_ID,
      validInput(),
      harness({ createThrows: new FakeUniqueViolationError() }).deps,
    ),
  ]);
}

test("C22. every result is frozen, plain and JSON-safe, and round-trips", async () => {
  for (const result of await everyResult()) {
    assertPlainFrozenJsonSafe(result);
    assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  }
});

test("C23. `issues` exists on invalid_input and on NO other arm", async () => {
  for (const result of await everyResult()) {
    const hasIssues = Object.prototype.hasOwnProperty.call(result, "issues");
    const isInvalidInput = result.ok === false && result.code === "invalid_input";
    assert.equal(hasIssues, isInvalidInput, JSON.stringify(result));
  }
});

test("C24. NO result echoes an identifier other than the created supervisor id", async () => {
  for (const result of await everyResult()) {
    const serialized = JSON.stringify(result);
    for (const secret of [
      REQUESTED_OFFERING_ID,
      VERIFIED_OFFERING_ID,
      SERVER_PLAN_ID,
      SUBMITTED_SESSION_ID,
      STORED_SESSION_ID,
      SUBMITTED_INSTRUCTOR_ID,
      ELIGIBLE_INSTRUCTOR_ID,
    ]) {
      assert.equal(serialized.includes(secret), false, `a result echoes ${secret}`);
    }
  }
  // ...and the ONE id a success does carry is the created supervisor's.
  const success = (await everyResult())[0];
  assert.equal(success.ok, true);
  if (!success.ok) return;
  assert.equal(success.supervisorId, CREATED_SUPERVISOR_ID);
});

test("C25. exactly the eight approved outcomes are reachable", async () => {
  const outcomes = (await everyResult()).map((result) => (result.ok ? "ok" : result.code));
  assert.deepEqual([...new Set(outcomes)].sort(), [
    "already_supervising",
    "instructor_not_eligible",
    "invalid_input",
    "offering_not_found",
    "ok",
    "operation_not_allowed",
    "plan_not_found",
    "session_not_found",
  ]);
});

test("C26. the success arm carries NO position, and two runs do not alias", async () => {
  const h = harness();
  const result = await createExamSupervisorWithDeps(REQUESTED_OFFERING_ID, validInput(), h.deps);
  assert.deepEqual(Object.keys(result).sort(), ["ok", "supervisorId"]);
  for (const forbidden of ["orderIndex", "position", "index", "isPrimary"]) {
    assert.equal(Object.prototype.hasOwnProperty.call(result, forbidden), false);
  }
  const [a, b] = await Promise.all([
    createExamSupervisorWithDeps(REQUESTED_OFFERING_ID, {}, harness().deps),
    createExamSupervisorWithDeps(REQUESTED_OFFERING_ID, {}, harness().deps),
  ]);
  assert.deepEqual(a, b);
  assert.notEqual(a as unknown, b as unknown);
});

// ===========================================================================
// 27–35. Structural guards
// ===========================================================================

const EXAM_DIR = import.meta.dirname;
const MODULE_NAME = "create-exam-supervisor-core.ts";
const TEST_NAME = "create-exam-supervisor-core.test.ts";
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

test("C27. the pure core imports no database client and performs no IO", () => {
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

test("C28. the pure core imports no auth, app, framework or action module", () => {
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

test("C29. the pure core reads, grants and checks NO permission of any kind", () => {
  for (const token of [
    '"EXAMS"',
    "'EXAMS'",
    "CapabilityKey",
    "capability",
    "Capability",
    "getEffectiveCapabilities",
    "canView",
    "canEdit",
    "isAllowedTo",
  ]) {
    assert.equal(CODE.includes(token), false, `the pure core consults ${token}`);
  }
  // ...and the reason is written down rather than left to be rediscovered.
  assert.ok(
    /operational relationship/i.test(COMMENTS),
    "the operational-relationship decision is undocumented",
  );
});

test("C30. the pure core has NO calendar type, clock, randomness or process access", () => {
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

test("C31. the pure core imports ONLY its sibling input core", () => {
  const specifiers = [...CODE.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(specifiers)], ["./exam-supervisor-write-core"]);
  // The input rules are REUSED, not restated, so the two cannot disagree.
  assert.ok(
    /normalizeExamSupervisorCreateInput/.test(CODE),
    "the sibling normalizer is not consulted",
  );
  assert.equal(CODE.includes("trim()"), false, "the core restates a trim rule");
});

test("C32. the orchestration takes a REQUEST and a raw input, and nothing else", () => {
  const functions = [...SOURCE.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)].map(
    (m) => m[1],
  );
  assert.deepEqual(functions, ["createExamSupervisorWithDeps"]);

  const orchestration = [
    ...SOURCE.matchAll(/export async function (\w+)\(([\s\S]*?)\):\s*([^{]+)\{/g),
  ].map(([, name, params, returns]) => ({
    name,
    params: params.replace(/\s+/g, " ").trim(),
    returns: returns.replace(/\s+/g, " ").trim(),
  }))[0];
  assert.equal(orchestration.name, "createExamSupervisorWithDeps");
  assert.equal(
    orchestration.params,
    "courseOfferingId: string, rawInput: unknown, deps: CreateExamSupervisorDeps,",
  );
  assert.equal(orchestration.returns, "Promise<CreateExamSupervisorResult>");
  for (const forbidden of ["planId", "sessionId", "instructorId", "actorId", "tx:", "prisma"]) {
    assert.equal(
      orchestration.params.includes(forbidden),
      false,
      `the orchestration accepts ${forbidden}`,
    );
  }
});

test("C33. no result code beyond the seven approved outcomes exists", () => {
  const codes = [...CODE.matchAll(/refuse\("([a-z_]+)"\)|code: "([a-z_]+)"/g)]
    .map((m) => m[1] ?? m[2])
    .filter((code): code is string => typeof code === "string");
  assert.deepEqual([...new Set(codes)].sort(), [
    "already_supervising",
    "instructor_not_eligible",
    "invalid_input",
    "offering_not_found",
    "operation_not_allowed",
    "plan_not_found",
    "session_not_found",
  ]);
  for (const token of ["unexpected", "stale_write", "archived", "session_full"]) {
    assert.equal(CODE.includes(token), false, `the pure core invents ${token}`);
  }
});

test("C34. exactly three classifiers exist, and no raw error is inspected", () => {
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

test("C35. NO ordering, examiner set or eligibility RULE lives in the core", () => {
  for (const token of [
    "orderIndex",
    "reorder",
    "Reorder",
    "isPrimary",
    "isResponsible",
    "examinerSet",
    "Examiner",
    "supervisorRole",
  ]) {
    assert.equal(CODE.includes(token), false, `the pure core invents ${token}`);
  }
  // Eligibility is ASKED, never decided: the only mention is the dependency.
  const eligibilityMentions = [...CODE.matchAll(/findEligibleInstructor/g)].length;
  assert.ok(eligibilityMentions >= 2, "the eligibility dependency is not both declared and called");
  for (const token of ["isActive", "Instructor.", "instructors", "roster"]) {
    assert.equal(CODE.includes(token), false, `the pure core reasons about ${token}`);
  }
  // ...and the reason no rule can live here is written down.
  assert.ok(
    /no relation between an Instructor and a CourseOffering/i.test(COMMENTS),
    "the missing-relation premise is undocumented",
  );
});

test("C36. the slice's two lib/exam files are exactly the approved pair", () => {
  const sliceFiles = readdirSync(EXAM_DIR)
    .filter((name) => name.startsWith("create-exam-supervisor-core"))
    .sort();
  assert.deepEqual(sliceFiles, [MODULE_NAME, TEST_NAME].sort());
});

test("C37. this suite opens no database and reads no environment", () => {
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
      "./create-exam-supervisor-core",
      "node:assert/strict",
      "node:fs",
      "node:path",
      "node:test",
    ],
  );
});
