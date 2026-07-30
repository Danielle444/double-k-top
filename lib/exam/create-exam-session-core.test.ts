/**
 * EXAM EX-SES-S2 — executable tests for the PURE stored-ExamSession CREATE
 * orchestration (create-exam-session-core.ts).
 *
 * Run with: npx tsx --test lib/exam/create-exam-session-core.test.ts
 *
 * DB-FREE: every dependency is a fake, no database connection is opened, no SQL
 * is executed, no environment variable is read, and no production identifier
 * appears anywhere. The only files read are module SOURCE TEXTS, by the
 * structural guards at the bottom.
 *
 * SCOPE OF PROOF:
 *   - the LOCKED ORDER: authorize -> gate -> resolve plan -> validate -> verify
 *     definition -> write, and, for every failure, exactly WHICH later
 *     dependencies are skipped;
 *   - that the VERIFIED offering id (never the requested one) reaches the plan
 *     lookup, and the SERVER-RESOLVED plan id (never a caller value) reaches both
 *     the definition verification and the write;
 *   - that `planId`, `sessionId` and `orderIndex` are unreachable from the caller;
 *   - that a MISSING definition and a FOREIGN one are indistinguishable;
 *   - the result model: narrow, plain, frozen, JSON-round-trippable, non-echoing;
 *   - that only the two known failures are classified and everything else —
 *     including a redirect-shaped throw — propagates unchanged;
 *   - the structural promises: no calendar type, no Prisma, no Next, no auth, no
 *     capability, no env and no IO in the pure core.
 *
 * NOTE ON IDS: the fixtures use obviously-fake, hyphenated ids. No cuid-shaped
 * literal and no production identifier is written here, which the committed
 * exam-slice guards enforce over every file in this directory.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  createExamSessionWithDeps,
  type CreateExamSessionDeps,
  type CreateExamSessionResult,
  type CreatedExamSessionRecord,
  type NormalizedExamSessionCreate,
  type ResolvedExamPlanForSessionCreate,
  type VerifiedExamDefinitionForSessionCreate,
} from "./create-exam-session-core";

// ===========================================================================
// Fixtures
// ===========================================================================

/** What the caller ASKS for. Deliberately different from what is verified. */
const REQUESTED_OFFERING_ID = "offering-as-requested";
/** What the boundary VERIFIED. Only this may reach the plan lookup. */
const VERIFIED_OFFERING_ID = "offering-as-verified";
/** The plan the SERVER resolved. Only this may reach the verification + write. */
const SERVER_PLAN_ID = "plan-resolved-by-server";

const SUBMITTED_DEFINITION_ID = "definition-as-submitted";
const NEW_SESSION_ID = "session-newly-created";

/** A raw create submission with every field valid; override to break one. */
function rawCreate(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    definitionId: SUBMITTED_DEFINITION_ID,
    date: "2026-08-03",
    startTime: "09:00",
    arena: "זירה מקורה",
    title: "מבחן רכיבה",
    notes: "הערה",
    ...over,
  };
}

/** The typed not-found the real course boundary throws. */
class FakeCourseNotFoundError extends Error {}
/** The typed denial the real lifecycle policy throws. */
class FakeOperationDeniedError extends Error {}

/**
 * A framework REDIRECT throw, as Next produces for an unauthenticated admin. It
 * carries a `digest` and no `code`, and no classifier may recognize it.
 */
function redirectLikeError(): Error {
  const error = new Error("REDIRECT_SENTINEL");
  (error as unknown as { digest: string }).digest = "REDIRECT;replace;/login;307;";
  return error;
}

interface HarnessOptions {
  readonly status?: string;
  readonly plan?: ResolvedExamPlanForSessionCreate | null;
  readonly definition?: VerifiedExamDefinitionForSessionCreate | null;
  readonly created?: CreatedExamSessionRecord;
  readonly contextThrows?: unknown;
  readonly gateThrows?: unknown;
  readonly planThrows?: unknown;
  readonly definitionThrows?: unknown;
  readonly createThrows?: unknown;
}

interface Harness {
  /** Dependency names, in the exact order they were invoked. */
  readonly calls: string[];
  readonly contextArgs: string[];
  readonly gateArgs: string[];
  readonly planLookupArgs: string[];
  readonly definitionArgs: { planId: string; definitionId: string }[];
  readonly createArgs: { planId: string; value: NormalizedExamSessionCreate }[];
  readonly deps: CreateExamSessionDeps;
}

/**
 * Build a recording fake boundary. The two classifiers are precise `instanceof`
 * checks and never a catch-all, so a test that expects propagation is proving
 * something real.
 */
function harness(options: HarnessOptions = {}): Harness {
  const calls: string[] = [];
  const contextArgs: string[] = [];
  const gateArgs: string[] = [];
  const planLookupArgs: string[] = [];
  const definitionArgs: { planId: string; definitionId: string }[] = [];
  const createArgs: { planId: string; value: NormalizedExamSessionCreate }[] = [];

  const deps: CreateExamSessionDeps = {
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
    findDefinitionForPlan: async (planId, definitionId) => {
      calls.push("findDefinitionForPlan");
      definitionArgs.push({ planId, definitionId });
      if ("definitionThrows" in options) throw options.definitionThrows;
      return options.definition === undefined
        ? { id: SUBMITTED_DEFINITION_ID }
        : options.definition;
    },
    createSessionAtNextOrder: async (planId, value) => {
      calls.push("createSessionAtNextOrder");
      createArgs.push({ planId, value });
      if ("createThrows" in options) throw options.createThrows;
      return options.created ?? { id: NEW_SESSION_ID, orderIndex: 0 };
    },
    isCourseNotFoundError: (error) => error instanceof FakeCourseNotFoundError,
    isOperationNotAllowedError: (error) => error instanceof FakeOperationDeniedError,
  };

  return {
    calls,
    contextArgs,
    gateArgs,
    planLookupArgs,
    definitionArgs,
    createArgs,
    deps,
  };
}

function run(
  options: HarnessOptions = {},
  raw: unknown = rawCreate(),
  requested: string = REQUESTED_OFFERING_ID,
): { harness: Harness; result: Promise<CreateExamSessionResult> } {
  const h = harness(options);
  return { harness: h, result: createExamSessionWithDeps(requested, raw, h.deps) };
}

/** The locked, complete dependency sequence of a successful create. */
const LOCKED_ORDER = [
  "requireCourseContext",
  "assertConfigurationAllowed",
  "findExamPlanByCourseOfferingId",
  "findDefinitionForPlan",
  "createSessionAtNextOrder",
] as const;

// ===========================================================================
// 1–3. Success
// ===========================================================================

test("1. a successful create returns ONLY sessionId + orderIndex", async () => {
  const { result } = run({ created: { id: NEW_SESSION_ID, orderIndex: 4 } });
  const outcome = await result;

  assert.deepEqual(outcome, { ok: true, sessionId: NEW_SESSION_ID, orderIndex: 4 });
  assert.deepEqual(Object.keys(outcome).sort(), ["ok", "orderIndex", "sessionId"]);
});

test("2. the write receives EXACTLY the six normalized fields, trimmed", async () => {
  const { harness: h, result } = run(
    {},
    rawCreate({ definitionId: `  ${SUBMITTED_DEFINITION_ID}  `, arena: "  זירה  ", notes: "   " }),
  );
  await result;

  assert.equal(h.createArgs.length, 1);
  assert.deepEqual(h.createArgs[0].value, {
    definitionId: SUBMITTED_DEFINITION_ID,
    date: "2026-08-03",
    startTime: "09:00",
    arena: "זירה",
    title: "מבחן רכיבה",
    // Blank optional text collapses to null in the committed normalizer.
    notes: null,
  });
});

test("3. the first session of a plan-day may report orderIndex 0", async () => {
  const { result } = run({ created: { id: NEW_SESSION_ID, orderIndex: 0 } });
  assert.deepEqual(await result, { ok: true, sessionId: NEW_SESSION_ID, orderIndex: 0 });
});

// ===========================================================================
// 4–10. The locked order
// ===========================================================================

test("4. course authorization runs FIRST, before anything else", async () => {
  const { harness: h, result } = run();
  await result;
  assert.equal(h.calls[0], "requireCourseContext");
  assert.deepEqual(h.contextArgs, [REQUESTED_OFFERING_ID]);
});

test("5. the lifecycle gate runs SECOND, on the VERIFIED status", async () => {
  const { harness: h, result } = run({ status: "PLANNED" });
  await result;
  assert.equal(h.calls[1], "assertConfigurationAllowed");
  assert.deepEqual(h.gateArgs, ["PLANNED"]);
});

test("6. the plan lookup runs AFTER the lifecycle gate", async () => {
  const { harness: h, result } = run();
  await result;
  assert.equal(h.calls[2], "findExamPlanByCourseOfferingId");
});

test("7. the definition verification runs AFTER the plan lookup", async () => {
  const { harness: h, result } = run();
  await result;
  assert.equal(h.calls[3], "findDefinitionForPlan");
});

test("8. the write runs LAST, after the verification", async () => {
  const { harness: h, result } = run();
  await result;
  assert.equal(h.calls[4], "createSessionAtNextOrder");
});

test("9. the successful dependency order is EXACTLY the locked sequence", async () => {
  const { harness: h, result } = run();
  await result;
  assert.deepEqual(h.calls, [...LOCKED_ORDER]);
});

test("10. no dependency is invoked more than once, on ANY path", async () => {
  const paths: HarnessOptions[] = [
    {},
    { status: "ARCHIVED" },
    { plan: null },
    { definition: null },
    { contextThrows: new FakeCourseNotFoundError() },
    { gateThrows: new FakeOperationDeniedError() },
  ];
  for (const options of paths) {
    const { harness: h, result } = run(options);
    await result;
    const counted = new Map<string, number>();
    for (const call of h.calls) counted.set(call, (counted.get(call) ?? 0) + 1);
    for (const [name, count] of counted) {
      assert.equal(count, 1, `${name} ran ${count} times`);
    }
  }
});

// ===========================================================================
// 11–15. Only server-derived ids flow onward
// ===========================================================================

test("11. the VERIFIED offering id is what the plan lookup receives", async () => {
  const { harness: h, result } = run();
  await result;
  assert.deepEqual(h.planLookupArgs, [VERIFIED_OFFERING_ID]);
});

test("12. the RAW requested offering id is never reused after verification", async () => {
  const { harness: h, result } = run();
  await result;
  assert.equal(h.planLookupArgs.includes(REQUESTED_OFFERING_ID), false);
  for (const call of h.definitionArgs) {
    assert.equal(call.planId, SERVER_PLAN_ID);
    assert.notEqual(call.planId, REQUESTED_OFFERING_ID);
  }
  for (const call of h.createArgs) {
    assert.equal(call.planId, SERVER_PLAN_ID);
    assert.notEqual(call.planId, REQUESTED_OFFERING_ID);
    assert.equal(JSON.stringify(call.value).includes(REQUESTED_OFFERING_ID), false);
  }
});

test("13. the SERVER-RESOLVED plan id reaches BOTH the verification and the write", async () => {
  const { harness: h, result } = run();
  await result;
  assert.deepEqual(h.definitionArgs, [
    { planId: SERVER_PLAN_ID, definitionId: SUBMITTED_DEFINITION_ID },
  ]);
  assert.equal(h.createArgs[0].planId, SERVER_PLAN_ID);
});

test("14. a caller-supplied planId is ignored: the resolved plan is still used", async () => {
  const { harness: h, result } = run(
    {},
    rawCreate({ planId: "plan-chosen-by-client", courseOfferingId: "offering-chosen-by-client" }),
  );
  await result;
  assert.equal(h.definitionArgs[0].planId, SERVER_PLAN_ID);
  assert.equal(h.createArgs[0].planId, SERVER_PLAN_ID);
  const written = JSON.stringify(h.createArgs[0].value);
  assert.equal(written.includes("plan-chosen-by-client"), false);
  assert.equal(written.includes("offering-chosen-by-client"), false);
});

test("15. a caller-supplied orderIndex or sessionId never reaches the write payload", async () => {
  const { harness: h, result } = run(
    {},
    rawCreate({ orderIndex: 99, id: "session-chosen-by-client", expectedUpdatedAt: 1 }),
  );
  const outcome = await result;
  const value = h.createArgs[0].value as unknown as Record<string, unknown>;
  assert.equal("orderIndex" in value, false);
  assert.equal("id" in value, false);
  assert.equal("expectedUpdatedAt" in value, false);
  // ...and the reported position is the one the WRITE returned, not the submitted 99.
  assert.deepEqual(outcome, { ok: true, sessionId: NEW_SESSION_ID, orderIndex: 0 });
});

// ===========================================================================
// 16–19. A missing plan short-circuits everything after it
// ===========================================================================

test("16. a missing plan returns plan_not_found", async () => {
  const { result } = run({ plan: null });
  assert.deepEqual(await result, { ok: false, code: "plan_not_found" });
});

test("17. a missing plan skips the definition lookup AND the write entirely", async () => {
  const { harness: h, result } = run({ plan: null });
  await result;
  assert.deepEqual(h.calls, [
    "requireCourseContext",
    "assertConfigurationAllowed",
    "findExamPlanByCourseOfferingId",
  ]);
  assert.deepEqual(h.definitionArgs, []);
  assert.deepEqual(h.createArgs, []);
});

test("18. a missing plan does NOT normalize the input: the plan refusal wins", async () => {
  // The submission is invalid in FOUR ways. If normalization ran and its result
  // were consulted, the answer would be invalid_input; it is plan_not_found, so
  // no diagnostic about the submission was produced for a plan that does not
  // exist.
  const { result } = run({ plan: null }, { definitionId: 7, date: "nope", startTime: "9:00", arena: 3 });
  assert.deepEqual(await result, { ok: false, code: "plan_not_found" });
});

test("19. a plan-query failure propagates, and reaches neither verification nor write", async () => {
  const boom = new Error("plan query exploded");
  const { harness: h, result } = run({ planThrows: boom });
  await assert.rejects(
    () => result,
    (error) => error === boom,
  );
  assert.deepEqual(h.definitionArgs, []);
  assert.deepEqual(h.createArgs, []);
});

// ===========================================================================
// 20–23. Invalid input stops before the definition lookup
// ===========================================================================

test("20. invalid input returns invalid_input with the COMMITTED issue codes", async () => {
  const { result } = run({}, rawCreate({ date: "2026-02-31", startTime: "24:00" }));
  const outcome = await result;

  assert.equal(outcome.ok, false);
  assert.ok(!outcome.ok && outcome.code === "invalid_input");
  assert.ok(!outcome.ok && "issues" in outcome);
  const codes = !outcome.ok && "issues" in outcome ? outcome.issues.map((i) => i.code) : [];
  // The committed core's codes, in ITS fixed field order.
  assert.deepEqual(codes, ["EX-SES-DATE-INVALID", "EX-SES-START-TIME-INVALID"]);
});

test("21. invalid input causes ZERO definition lookups and ZERO writes", async () => {
  const broken = [
    rawCreate({ definitionId: "" }),
    rawCreate({ definitionId: 12 }),
    rawCreate({ date: "03/08/2026" }),
    rawCreate({ startTime: "9:00" }),
    rawCreate({ arena: { name: "זירה" } }),
    rawCreate({ title: 5 }),
    rawCreate({ notes: [] }),
    {},
    null,
    "not an object",
  ];
  for (const raw of broken) {
    const { harness: h, result } = run({}, raw);
    const outcome = await result;
    assert.ok(!outcome.ok && outcome.code === "invalid_input", `accepted: ${JSON.stringify(raw)}`);
    assert.deepEqual(h.definitionArgs, [], `a definition was looked up for ${JSON.stringify(raw)}`);
    assert.deepEqual(h.createArgs, [], `a write ran for ${JSON.stringify(raw)}`);
    // The plan WAS resolved first — that is the locked order, not a leak: the
    // caller is already authorized for this course.
    assert.deepEqual(h.calls, [
      "requireCourseContext",
      "assertConfigurationAllowed",
      "findExamPlanByCourseOfferingId",
    ]);
  }
});

test("22. an issue array is a fresh FROZEN copy that aliases nothing", async () => {
  const { result } = run({}, rawCreate({ date: "not-a-date" }));
  const outcome = await result;
  assert.ok(!outcome.ok && "issues" in outcome);
  if (!outcome.ok && "issues" in outcome) {
    assert.ok(Object.isFrozen(outcome.issues));
    assert.throws(() => (outcome.issues as unknown as unknown[]).push({}));
  }
});

test("23. a diagnostic NEVER echoes a submitted value", async () => {
  const secret = "SUBMITTED-SENTINEL-VALUE";
  const { result } = run({}, rawCreate({ date: secret, startTime: secret, arena: { secret } }));
  const outcome = await result;
  assert.equal(JSON.stringify(outcome).includes(secret), false, "a diagnostic echoed the input");
});

// ===========================================================================
// 24–27. A missing definition and a foreign one are one answer
// ===========================================================================

test("24. a definition that is absent under the resolved plan refuses the create", async () => {
  const { result } = run({ definition: null });
  assert.deepEqual(await result, { ok: false, code: "definition_not_found" });
});

test("25. a FOREIGN definition is INDISTINGUISHABLE from a missing one", async () => {
  // The dependency cannot report "it exists, but under another plan": it is asked
  // for a definition UNDER a plan and answers null. Both worlds are constructed
  // here and must be byte-identical to the caller.
  const missing = await run({ definition: null }, rawCreate({ definitionId: "definition-that-does-not-exist" }))
    .result;
  const foreign = await run({ definition: null }, rawCreate({ definitionId: "definition-of-another-plan" }))
    .result;
  assert.deepEqual(missing, foreign);
  assert.deepEqual(JSON.stringify(missing), JSON.stringify(foreign));
  assert.deepEqual(missing, { ok: false, code: "definition_not_found" });
});

test("26. an unverified definition causes ZERO writes", async () => {
  const { harness: h, result } = run({ definition: null });
  await result;
  assert.deepEqual(h.createArgs, []);
  assert.deepEqual(h.calls, [
    "requireCourseContext",
    "assertConfigurationAllowed",
    "findExamPlanByCourseOfferingId",
    "findDefinitionForPlan",
  ]);
});

test("27. the definition lookup is asked with the SUBMITTED id, trimmed, never widened", async () => {
  const { harness: h, result } = run({}, rawCreate({ definitionId: "  Definition-MiXeD-Case  " }));
  await result;
  // Trimmed by the committed normalizer, case preserved exactly.
  assert.deepEqual(h.definitionArgs, [
    { planId: SERVER_PLAN_ID, definitionId: "Definition-MiXeD-Case" },
  ]);
});

// ===========================================================================
// 28–33. Classification and propagation
// ===========================================================================

test("28. a course not-found maps to offering_not_found", async () => {
  const { result } = run({ contextThrows: new FakeCourseNotFoundError() });
  assert.deepEqual(await result, { ok: false, code: "offering_not_found" });
});

test("29. a course not-found causes ZERO gate, plan, verification and write calls", async () => {
  const { harness: h, result } = run({ contextThrows: new FakeCourseNotFoundError() });
  await result;
  assert.deepEqual(h.calls, ["requireCourseContext"]);
});

test("30. a lifecycle denial maps to operation_not_allowed", async () => {
  const { result } = run({ status: "ARCHIVED", gateThrows: new FakeOperationDeniedError() });
  assert.deepEqual(await result, { ok: false, code: "operation_not_allowed" });
});

test("31. a lifecycle denial causes ZERO plan, verification and write calls", async () => {
  const { harness: h, result } = run({ gateThrows: new FakeOperationDeniedError() });
  await result;
  assert.deepEqual(h.calls, ["requireCourseContext", "assertConfigurationAllowed"]);
  assert.deepEqual(h.planLookupArgs, []);
  assert.deepEqual(h.definitionArgs, []);
  assert.deepEqual(h.createArgs, []);
});

/**
 * Every dependency, as a function that makes THAT dependency throw a given
 * value. Written as builders rather than a computed key so each option object is
 * type-checked exactly as production code would be.
 */
const THROW_PATHS: readonly (readonly [string, (thrown: unknown) => HarnessOptions])[] = [
  ["requireCourseContext", (thrown) => ({ contextThrows: thrown })],
  ["assertConfigurationAllowed", (thrown) => ({ gateThrows: thrown })],
  ["findExamPlanByCourseOfferingId", (thrown) => ({ planThrows: thrown })],
  ["findDefinitionForPlan", (thrown) => ({ definitionThrows: thrown })],
  ["createSessionAtNextOrder", (thrown) => ({ createThrows: thrown })],
];

test("32. a REDIRECT-shaped error propagates unchanged from every dependency", async () => {
  const redirect = redirectLikeError();
  for (const [dependency, build] of THROW_PATHS) {
    await assert.rejects(
      () => run(build(redirect)).result,
      (error) => error === redirect,
      `${dependency} swallowed the redirect`,
    );
  }
});

test("33. no error is swallowed broadly: only the two classified shapes refuse", async () => {
  const unrelated = [
    new Error("infrastructure fault"),
    new TypeError("programming error"),
    // A uniqueness violation and a foreign-key violation are NOT classified by
    // this slice: neither is reachable through an approved path, and laundering
    // one into a refusal would hide a real defect.
    { code: "P2002", meta: { target: ["planId", "sourceLesson"] } },
    { code: "P2003" },
    { code: "P2025" },
  ];
  for (const thrown of unrelated) {
    for (const [dependency, build] of THROW_PATHS) {
      await assert.rejects(
        () => run(build(thrown)).result,
        (error) => error === thrown,
        `${dependency} absorbed ${JSON.stringify(thrown)}`,
      );
    }
  }
});

test("34. a definition-query failure propagates and reaches no write", async () => {
  const boom = new Error("definition query exploded");
  const { harness: h, result } = run({ definitionThrows: boom });
  await assert.rejects(
    () => result,
    (error) => error === boom,
  );
  assert.deepEqual(h.createArgs, []);
});

// ===========================================================================
// 35–41. The result model
// ===========================================================================

/** Every outcome this core can produce, for the whole-model assertions. */
async function everyOutcome(): Promise<CreateExamSessionResult[]> {
  return [
    await run().result,
    await run({}, rawCreate({ date: "bad" })).result,
    await run({ plan: null }).result,
    await run({ definition: null }).result,
    await run({ contextThrows: new FakeCourseNotFoundError() }).result,
    await run({ gateThrows: new FakeOperationDeniedError() }).result,
  ];
}

test("35. no plan, course, definition, date or actor identifier enters any result", async () => {
  for (const outcome of await everyOutcome()) {
    const serialized = JSON.stringify(outcome);
    for (const forbidden of [
      SERVER_PLAN_ID,
      VERIFIED_OFFERING_ID,
      REQUESTED_OFFERING_ID,
      SUBMITTED_DEFINITION_ID,
      "2026-08-03",
      "09:00",
      "planId",
      "courseOfferingId",
      "definitionId",
      "adminId",
    ]) {
      assert.equal(serialized.includes(forbidden), false, `${forbidden} leaked into ${serialized}`);
    }
  }
});

test("36. every result key is drawn from the approved surface only", async () => {
  const allowed = new Set(["ok", "sessionId", "orderIndex", "code", "issues"]);
  for (const outcome of await everyOutcome()) {
    for (const key of Object.keys(outcome)) {
      assert.ok(allowed.has(key), `an unapproved key exists: ${key}`);
    }
  }
});

test("37. every result is a plain object with no prototype surprises", async () => {
  for (const outcome of await everyOutcome()) {
    assert.equal(Object.getPrototypeOf(outcome), Object.prototype);
    assert.equal(outcome instanceof Error, false);
  }
});

test("38. every result deep-equals its JSON round trip", async () => {
  for (const outcome of await everyOutcome()) {
    assert.deepEqual(JSON.parse(JSON.stringify(outcome)), outcome);
  }
});

test("39. no result carries an undefined property value", async () => {
  for (const outcome of await everyOutcome()) {
    for (const [key, value] of Object.entries(outcome)) {
      assert.notEqual(value, undefined, `${key} is present-but-undefined`);
    }
  }
  // `issues` exists ONLY on the invalid-input arm.
  const planRefusal = await run({ plan: null }).result;
  assert.equal("issues" in planRefusal, false);
  const success = await run().result;
  assert.equal("issues" in success, false);
  assert.equal("code" in success, false);
});

test("40. every result, and every issue array, is FROZEN", async () => {
  for (const outcome of await everyOutcome()) {
    assert.ok(Object.isFrozen(outcome), `a result is mutable: ${JSON.stringify(outcome)}`);
    if (!outcome.ok && "issues" in outcome) {
      assert.ok(Object.isFrozen(outcome.issues));
    }
  }
});

test("41. no result contains a calendar object, Map, Set or BigInt anywhere", async () => {
  function scan(value: unknown, path: string): void {
    if (value === null || typeof value !== "object") return;
    assert.equal(value instanceof Date, false, `${path} holds a calendar object`);
    assert.equal(value instanceof Map, false, `${path} holds a Map`);
    assert.equal(value instanceof Set, false, `${path} holds a Set`);
    for (const [key, child] of Object.entries(value)) {
      assert.notEqual(typeof child, "bigint", `${path}.${key} is a BigInt`);
      assert.notEqual(typeof child, "function", `${path}.${key} is a function`);
      scan(child, `${path}.${key}`);
    }
  }
  for (const outcome of await everyOutcome()) scan(outcome, "result");
});

// ===========================================================================
// 42–44. The raw input is never touched
// ===========================================================================

test("42. the source raw input is never modified", async () => {
  const raw = rawCreate();
  const before = JSON.stringify(raw);
  await run({}, raw).result;
  assert.equal(JSON.stringify(raw), before);
});

test("43. a FROZEN raw input is supported, valid or not", async () => {
  const valid = Object.freeze(rawCreate());
  assert.deepEqual(await run({}, valid).result, {
    ok: true,
    sessionId: NEW_SESSION_ID,
    orderIndex: 0,
  });

  const invalid = Object.freeze(rawCreate({ startTime: "24:00" }));
  const outcome = await run({}, invalid).result;
  assert.ok(!outcome.ok && outcome.code === "invalid_input");
});

test("44. mutating the raw input AFTER the call cannot change the written payload", async () => {
  const raw = rawCreate();
  const { harness: h, result } = run({}, raw);
  await result;
  raw.arena = "זירה אחרת";
  assert.equal(h.createArgs[0].value.arena, "זירה מקורה");
});

// ===========================================================================
// Structural guards on the pure core
// ===========================================================================

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const EXAM_DIR = join(REPO_ROOT, "lib", "exam");
const MODULE_NAME = "create-exam-session-core.ts";
const TEST_NAME = "create-exam-session-core.test.ts";
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

test("S1. the pure core imports no database client and performs no IO", () => {
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

test("S2. NO module in lib/exam imports a database client", () => {
  const offenders: string[] = [];
  // MODULES, not suites: the committed guard suites necessarily name the
  // specifiers they forbid, and so does this one.
  for (const name of readdirSync(EXAM_DIR).filter(
    (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
  )) {
    const source = readFileSync(join(EXAM_DIR, name), "utf8");
    for (const specifier of [PRISMA_MODULE, GENERATED_CLIENT]) {
      if (source.includes(specifier)) offenders.push(`${name} -> ${specifier}`);
    }
  }
  assert.deepEqual(offenders, [], `the exam cores must stay DB-free; found: ${offenders.join(", ")}`);
});

test("S3. the pure core imports no auth, session, cookie or course implementation", () => {
  for (const token of [
    "lib/auth",
    "lib/course",
    "lib/actions",
    "next/headers",
    "next/navigation",
    "next-auth",
    "cookies(",
    "requireAdmin",
    "requireCurrent",
    "getCurrent",
    "AdminCourseContext",
    "assertCourseOperationAllowed",
    "SCHEDULE_DRAFT_CONFIGURATION",
    "parseDateKey",
  ]) {
    assert.equal(CODE.includes(token), false, `the pure core references ${token}`);
  }
});

test("S4. the pure core is neither server-only nor a Server Action module", () => {
  // Asserted on CODE: the header legitimately NAMES the markers it forbids, and a
  // rule stated in prose is exactly what should survive a future edit.
  assert.equal(CODE.includes("server" + "-only"), false);
  assert.equal(CODE.includes('"use ' + 'server"'), false);
  assert.equal(CODE.includes("'use " + "server'"), false);
  assert.equal(CODE.includes('"use ' + 'client"'), false);
  assert.equal(/import\s+["']server/.test(SOURCE), false);
  // ...and the header does state the rule it holds itself to.
  assert.ok(COMMENTS.includes("server" + "-only"), "the rule is undocumented");
});

test("S5. the pure core consults no capability of any kind", () => {
  for (const token of [
    '"EXAMS"',
    "'EXAMS'",
    "TEACHING_PRACTICE",
    '"SCHEDULE"',
    "'SCHEDULE'",
    "CapabilityKey",
    "capability",
    "Capability",
    "getEffectiveCapabilities",
  ]) {
    assert.equal(CODE.includes(token), false, `the pure core consults ${token}`);
  }
});

test("S6. the pure core has NO calendar type, clock, randomness or process access", () => {
  for (const pattern of [
    /\bDate\b/,
    /new Date\b/,
    /Date\.now\b/,
    /Math\.random\b/,
    /process\./,
    /globalThis/,
    /toISOString/,
    /getTime\(/,
    /getTimezoneOffset/,
  ]) {
    assert.equal(pattern.test(CODE), false, `the pure core uses ${pattern}`);
  }
  // ...and the reason the conversion lives in the IO layer is documented.
  assert.ok(/timezone/i.test(COMMENTS), "the timezone reasoning is undocumented");
});

test("S7. the pure core imports ONLY the committed sibling session input core", () => {
  const specifiers = [...CODE.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.ok(specifiers.length > 0, "sanity: the module should import something");
  for (const specifier of specifiers) {
    assert.ok(specifier.startsWith("./exam-"), `the pure core imports ${specifier}`);
  }
  assert.deepEqual([...new Set(specifiers)], ["./exam-session-write-core"]);
});

test("S8. the committed normalizer is CALLED rather than having its rules copied", () => {
  assert.ok(
    /\bnormalizeExamSessionCreateInput\s*\(/.test(CODE),
    "the pure core does not call the committed normalizer",
  );
  for (const token of [
    "isValidDateKey",
    "isValidHHMM",
    "Number.isInteger",
    "hasOwnProperty",
    ".trim(",
    ".toLowerCase(",
    ".normalize(",
    "EX-SES-",
  ]) {
    assert.equal(CODE.includes(token), false, `the pure core restates ${token}`);
  }
  // The EDIT normalizer is NOT bound here: this slice is create-only.
  assert.equal(CODE.includes("normalizeExamSessionEditInput"), false);
});

test("S9. the module exports exactly the intended surface", () => {
  const functions = [...SOURCE.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)].map(
    (match) => match[1],
  );
  assert.deepEqual(functions, ["createExamSessionWithDeps"]);

  const orchestration = [
    ...SOURCE.matchAll(/export async function (\w+)\(([\s\S]*?)\):\s*([^{]+)\{/g),
  ].map(([, name, params, returns]) => ({
    name,
    params: params.replace(/\s+/g, " ").trim(),
    returns: returns.replace(/\s+/g, " ").trim(),
  }))[0];
  assert.equal(
    orchestration.params,
    "courseOfferingId: string, rawInput: unknown, deps: CreateExamSessionDeps,",
  );
  assert.equal(orchestration.returns, "Promise<CreateExamSessionResult>");
  for (const forbidden of [
    "planId",
    "definitionId",
    "sessionId",
    "orderIndex",
    "adminId",
    "actorId",
    "instructorId",
    "studentId",
    "expectedUpdatedAt",
    "tx:",
    "prisma",
  ]) {
    assert.equal(
      orchestration.params.includes(forbidden),
      false,
      `the orchestration accepts ${forbidden}`,
    );
  }
});

test("S10. the injected boundary cannot edit, delete, reorder, publish or announce", () => {
  for (const token of [
    "createPlan",
    "upsertPlan",
    "ensurePlan",
    "createExamPlan",
    "updateSession",
    "deleteSession",
    "publish",
    "unpublish",
    "notify",
    "notification",
    "reorder",
    "archive",
    "assignment",
    "Assignment",
    "supervisor",
    "Supervisor",
    "break",
    "Break",
  ]) {
    assert.equal(CODE.includes(token), false, `the pure core exposes ${token}`);
  }
  // The write dependency is the ONLY effect that can change anything.
  const deps = CODE.slice(
    CODE.indexOf("export interface CreateExamSessionDeps"),
    CODE.indexOf("export type CreateExamSessionRefusalCode"),
  );
  const methods = [...deps.matchAll(/^\s{2}(\w+)[(<]/gm)].map((match) => match[1]);
  assert.deepEqual(methods.sort(), [
    "assertConfigurationAllowed",
    "createSessionAtNextOrder",
    "findDefinitionForPlan",
    "findExamPlanByCourseOfferingId",
    "isCourseNotFoundError",
    "isOperationNotAllowedError",
    "requireCourseContext",
  ]);
});

test("S11. no result code beyond the five approved outcomes exists", () => {
  const codes = [...CODE.matchAll(/refuse\("([a-z_]+)"\)|code: "([a-z_]+)"/g)]
    .map((match) => match[1] ?? match[2])
    .filter((code): code is string => typeof code === "string");
  assert.deepEqual(
    [...new Set(codes)].sort(),
    [
      "definition_not_found",
      "invalid_input",
      "offering_not_found",
      "operation_not_allowed",
      "plan_not_found",
    ],
  );
  for (const token of [
    "unexpected",
    "stale_write",
    "session_not_found",
    "duplicate",
    "conflict",
    "P2002",
    "P2003",
  ]) {
    assert.equal(CODE.includes(token), false, `the pure core invents ${token}`);
  }
});

test("S12. the source ORDER of the four effects matches the locked sequence", () => {
  const positions = [
    "deps.requireCourseContext(",
    "deps.assertConfigurationAllowed(",
    "deps.findExamPlanByCourseOfferingId(",
    "normalizeExamSessionCreateInput(",
    "deps.findDefinitionForPlan(",
    "deps.createSessionAtNextOrder(",
  ].map((token) => {
    const at = CODE.indexOf(token);
    assert.ok(at > 0, `${token} is missing`);
    return at;
  });
  for (let i = 1; i < positions.length; i += 1) {
    assert.ok(positions[i] > positions[i - 1], `step ${i + 1} precedes step ${i}`);
  }
  // Each effect is invoked exactly ONCE in the source: no retry, no second path.
  for (const token of [
    "deps.requireCourseContext(",
    "deps.assertConfigurationAllowed(",
    "deps.findExamPlanByCourseOfferingId(",
    "normalizeExamSessionCreateInput(",
    "deps.findDefinitionForPlan(",
    "deps.createSessionAtNextOrder(",
  ]) {
    const escaped = token.replace(/[.()]/g, "\\$&");
    assert.equal((CODE.match(new RegExp(escaped, "g")) ?? []).length, 1, `${token} appears twice`);
  }
});

test("S13. the beginner-session limitation is documented HONESTLY", () => {
  // The definition verification deliberately reads only an id, so this slice
  // cannot refuse a live-beginner definition. That must be STATED, not implied.
  assert.ok(/beginner/i.test(COMMENTS), "the beginner rule is not discussed at all");
  assert.equal(
    /(guarantee|prevent|ensure)s?[^.]{0,80}beginner/i.test(COMMENTS),
    false,
    "the header claims a beginner refusal it does not perform",
  );
  // ...and no kind is read anywhere in the code.
  for (const token of ["kind", "Kind", "BEGINNER"]) {
    assert.equal(CODE.includes(token), false, `the pure core reads ${token}`);
  }
});

test("S14. the slice's two lib/exam files are exactly the approved pair", () => {
  const sliceFiles = readdirSync(EXAM_DIR)
    .filter((name) => name.startsWith("create-exam-session-core"))
    .sort();
  assert.deepEqual(sliceFiles, [MODULE_NAME, TEST_NAME].sort());
});

test("S15. this suite opens no database and reads no environment", () => {
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
  const specifiers = [...own.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(
    [...new Set(specifiers)].sort(),
    ["./create-exam-session-core", "node:assert/strict", "node:fs", "node:path", "node:test"],
  );
});
