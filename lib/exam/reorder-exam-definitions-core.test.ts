/**
 * EXAM EX-S5B-4 — executable tests for the PURE ExamDefinition REORDER
 * orchestration (reorder-exam-definitions-core.ts).
 *
 * Run with: npx tsx --test lib/exam/reorder-exam-definitions-core.test.ts
 *
 * DB-FREE: every dependency is a fake, no database connection is opened, no SQL
 * is executed, and no production identifier appears anywhere. The only files read
 * are module SOURCE TEXTS, by the structural guards at the bottom.
 *
 * SCOPE OF PROOF:
 *   - the LOCKED ORDER: authorize -> gate -> plan -> normalize -> one atomic
 *     effect, and, for every failure, exactly WHICH later dependencies are
 *     skipped;
 *   - that the VERIFIED offering id (never the requested one) reaches the plan
 *     lookup, and the SERVER-RESOLVED plan id (never a caller value) reaches the
 *     atomic effect;
 *   - normalization of two UNTRUSTED lists, including which malformed shapes are
 *     refused as `invalid_input` and which valid-but-wrong ones are refused as
 *     `reorder_conflict`;
 *   - the two success arms, the no-op's zero update count, and the exact array
 *     each one reports;
 *   - the two pure set/sequence predicates the atomic binding is required to use,
 *     proven here so the rule cannot be re-derived differently next to Prisma;
 *   - the result model: narrow, plain, frozen, JSON-round-trippable, non-echoing.
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
  isCurrentExamDefinitionIdOrder,
  isExactExamDefinitionIdPermutation,
  isSameExamDefinitionIdSequence,
  reorderExamDefinitionsWithDeps,
  type ReorderExamDefinitionsAtomicOutcome,
  type ReorderExamDefinitionsDeps,
  type ReorderExamDefinitionsResult,
  type ResolvedExamPlanForReorder,
} from "./reorder-exam-definitions-core";

// ===========================================================================
// Fixtures
// ===========================================================================

/** What the caller ASKS for. Deliberately different from what is verified. */
const REQUESTED_OFFERING_ID = "offering-as-requested";
/** What the boundary VERIFIED. Only this may reach the plan lookup. */
const VERIFIED_OFFERING_ID = "offering-as-verified";
/** The plan the SERVER resolved. Only this may reach the atomic effect. */
const SERVER_PLAN_ID = "plan-resolved-by-server";

const DEFINITION_ALPHA = "definition-alpha";
const DEFINITION_BETA = "definition-beta";
const DEFINITION_GAMMA = "definition-gamma";

/** The order the caller believes is stored. */
const CURRENT_ORDER = [DEFINITION_ALPHA, DEFINITION_BETA, DEFINITION_GAMMA];
/** The order the caller wants. */
const NEW_ORDER = [DEFINITION_GAMMA, DEFINITION_ALPHA, DEFINITION_BETA];

/** The typed not-found the real course boundary throws. */
class FakeCourseNotFoundError extends Error {}
/** The typed denial the real lifecycle policy throws. */
class FakeOperationDeniedError extends Error {}
/** Anything else at all. */
class FakeUnexpectedError extends Error {}

/**
 * A framework REDIRECT throw, as Next produces for an unauthenticated admin.
 * It carries a `digest` and no `code`, and no classifier may recognize it.
 */
function redirectLikeError(): Error {
  const error = new Error("NEXT_REDIRECT");
  (error as unknown as { digest: string }).digest = "NEXT_REDIRECT;replace;/login;307;";
  return error;
}

interface AtomicCall {
  readonly planId: string;
  readonly orderedDefinitionIds: readonly string[];
  readonly expectedOrderedDefinitionIds: readonly string[];
}

interface HarnessOptions {
  readonly status?: string;
  readonly plan?: ResolvedExamPlanForReorder | null;
  readonly atomic?: ReorderExamDefinitionsAtomicOutcome;
  readonly contextThrows?: unknown;
  readonly gateThrows?: unknown;
  readonly planThrows?: unknown;
  readonly atomicThrows?: unknown;
}

interface Harness {
  /** Dependency names, in the exact order they were invoked. */
  readonly calls: string[];
  readonly contextArgs: string[];
  readonly gateArgs: string[];
  readonly planLookupArgs: string[];
  readonly atomicArgs: AtomicCall[];
  readonly deps: ReorderExamDefinitionsDeps;
}

/**
 * Build a recording fake boundary. Both classifiers are precise `instanceof`
 * checks — never a catch-all, so a test that expects propagation proves
 * something real.
 */
function harness(options: HarnessOptions = {}): Harness {
  const calls: string[] = [];
  const contextArgs: string[] = [];
  const gateArgs: string[] = [];
  const planLookupArgs: string[] = [];
  const atomicArgs: AtomicCall[] = [];

  const deps: ReorderExamDefinitionsDeps = {
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
    reorderDefinitionsAtomically: async (
      planId,
      orderedDefinitionIds,
      expectedOrderedDefinitionIds,
    ) => {
      calls.push("reorderDefinitionsAtomically");
      atomicArgs.push({ planId, orderedDefinitionIds, expectedOrderedDefinitionIds });
      if ("atomicThrows" in options) throw options.atomicThrows;
      return (
        options.atomic ?? {
          status: "updated",
          orderedDefinitionIds: [...orderedDefinitionIds],
          updatedCount: 2,
        }
      );
    },
    isCourseNotFoundError: (error) => error instanceof FakeCourseNotFoundError,
    isOperationNotAllowedError: (error) => error instanceof FakeOperationDeniedError,
  };

  return { calls, contextArgs, gateArgs, planLookupArgs, atomicArgs, deps };
}

function run(
  options: HarnessOptions = {},
  ordered: unknown = NEW_ORDER,
  expected: unknown = CURRENT_ORDER,
  requested: string = REQUESTED_OFFERING_ID,
): { harness: Harness; result: Promise<ReorderExamDefinitionsResult> } {
  const h = harness(options);
  return {
    harness: h,
    result: reorderExamDefinitionsWithDeps(requested, ordered, expected, h.deps),
  };
}

type ChangedResult = Extract<ReorderExamDefinitionsResult, { ok: true; changed: true }>;
type UnchangedResult = Extract<ReorderExamDefinitionsResult, { ok: true; changed: false }>;

/** Narrow to the CHANGED success arm, failing loudly (and typing) otherwise. */
function changedResult(result: ReorderExamDefinitionsResult): ChangedResult {
  if (!result.ok) assert.fail(`expected a success, got ${result.code}`);
  if (!result.changed) assert.fail("expected a CHANGED success, got a no-op");
  return result;
}

/** Narrow to the NO-OP success arm. */
function unchangedResult(result: ReorderExamDefinitionsResult): UnchangedResult {
  if (!result.ok) assert.fail(`expected a success, got ${result.code}`);
  if (result.changed) assert.fail("expected a NO-OP success, got a changed reorder");
  return result;
}

// ===========================================================================
// 1–2. The two successes
// ===========================================================================

test("1. a successful CHANGED reorder reports the new order and how many rows moved", async () => {
  const { harness: h, result } = run({
    atomic: { status: "updated", orderedDefinitionIds: NEW_ORDER, updatedCount: 3 },
  });
  const outcome = await result;

  assert.deepEqual(outcome, {
    ok: true,
    changed: true,
    orderedDefinitionIds: NEW_ORDER,
    updatedCount: 3,
  });
  assert.deepEqual(Object.keys(outcome).sort(), [
    "changed",
    "ok",
    "orderedDefinitionIds",
    "updatedCount",
  ]);
  assert.equal(h.atomicArgs.length, 1);
});

test("2. a successful NO-OP reorder reports the authoritative order and no writes", async () => {
  const { harness: h, result } = run(
    { atomic: { status: "unchanged", orderedDefinitionIds: CURRENT_ORDER } },
    CURRENT_ORDER,
    CURRENT_ORDER,
  );
  const outcome = await result;

  assert.deepEqual(outcome, {
    ok: true,
    changed: false,
    orderedDefinitionIds: CURRENT_ORDER,
    updatedCount: 0,
  });
  // The effect is still CALLED — deciding "nothing changed" requires reading the
  // authoritative order, which only the transaction may do.
  assert.equal(h.atomicArgs.length, 1);
});

// ===========================================================================
// 3–9. The locked order, and what reaches each dependency
// ===========================================================================

test("3. course authorization runs FIRST, with the requested id", async () => {
  const { harness: h, result } = run();
  await result;

  assert.equal(h.calls[0], "requireCourseContext");
  assert.deepEqual(h.contextArgs, [REQUESTED_OFFERING_ID]);
});

test("4. the lifecycle gate runs SECOND, on the VERIFIED status", async () => {
  const { harness: h, result } = run({ status: "PLANNED" });
  await result;

  assert.equal(h.calls[1], "assertConfigurationAllowed");
  assert.deepEqual(h.gateArgs, ["PLANNED"]);
});

test("5. the plan lookup runs AFTER the lifecycle gate", async () => {
  const { harness: h, result } = run();
  await result;

  assert.deepEqual(h.calls, [
    "requireCourseContext",
    "assertConfigurationAllowed",
    "findExamPlanByCourseOfferingId",
    "reorderDefinitionsAtomically",
  ]);
});

test("6. normalization happens only AFTER authorization and plan resolution", async () => {
  // A malformed list cannot short-circuit the boundary: an offering that does
  // not exist, an archived one and a plan-less one are each reported as
  // themselves, even when BOTH lists are garbage.
  const notFound = run(
    { contextThrows: new FakeCourseNotFoundError() },
    "not-an-array",
    42,
  );
  assert.deepEqual(await notFound.result, { ok: false, code: "offering_not_found" });
  assert.deepEqual(notFound.harness.calls, ["requireCourseContext"]);

  const denied = run({ gateThrows: new FakeOperationDeniedError() }, "not-an-array", 42);
  assert.deepEqual(await denied.result, { ok: false, code: "operation_not_allowed" });
  assert.deepEqual(denied.harness.calls, [
    "requireCourseContext",
    "assertConfigurationAllowed",
  ]);

  const noPlan = run({ plan: null }, "not-an-array", 42);
  assert.deepEqual(await noPlan.result, { ok: false, code: "plan_not_found" });
  assert.deepEqual(noPlan.harness.calls, [
    "requireCourseContext",
    "assertConfigurationAllowed",
    "findExamPlanByCourseOfferingId",
  ]);
});

test("7. the VERIFIED offering id is what the plan lookup receives", async () => {
  const { harness: h, result } = run();
  await result;

  assert.deepEqual(h.planLookupArgs, [VERIFIED_OFFERING_ID]);
});

test("8. the RAW requested offering id is never reused after verification", async () => {
  const { harness: h, result } = run();
  await result;

  assert.equal(h.planLookupArgs.includes(REQUESTED_OFFERING_ID), false);
  assert.equal(h.atomicArgs[0].planId, SERVER_PLAN_ID);
  assert.notEqual(h.atomicArgs[0].planId, REQUESTED_OFFERING_ID);
  assert.notEqual(h.atomicArgs[0].planId, VERIFIED_OFFERING_ID);
});

test("9. the SERVER-resolved plan id is what the atomic effect receives", async () => {
  const { harness: h, result } = run({ plan: { id: "plan-from-another-lookup" } });
  await result;

  assert.deepEqual(h.atomicArgs, [
    {
      planId: "plan-from-another-lookup",
      orderedDefinitionIds: NEW_ORDER,
      expectedOrderedDefinitionIds: CURRENT_ORDER,
    },
  ]);
});

// ===========================================================================
// 10–11. What the public signature cannot express
// ===========================================================================

test("10. the orchestration accepts no planId", () => {
  const source = readFileSync(join(EXAM_DIR, MODULE_NAME), "utf8");
  const params = orchestrationParams(source);
  assert.equal(params.includes("planId"), false, `the signature is: ${params}`);
  assert.equal(params.includes("plan"), false, `the signature is: ${params}`);
});

test("11. the orchestration accepts no orderIndex, actor or transaction value", () => {
  const source = readFileSync(join(EXAM_DIR, MODULE_NAME), "utf8");
  const params = orchestrationParams(source);
  for (const forbidden of [
    "orderIndex",
    "index",
    "position",
    "adminId",
    "actorId",
    "instructorId",
    "studentId",
    "kind",
    "name",
    "durationMinutes",
    "parallelCapacity",
    "publish",
    "tx:",
    "prisma",
    "expectedUpdatedAt",
  ]) {
    assert.equal(params.includes(forbidden), false, `the orchestration accepts ${forbidden}`);
  }
  assert.equal(
    params,
    "courseOfferingId: string, orderedDefinitionIds: unknown, expectedOrderedDefinitionIds: unknown, deps: ReorderExamDefinitionsDeps,",
  );
});

// ===========================================================================
// 12–17. Input normalization — the MALFORMED shapes
// ===========================================================================

test("12. a malformed ORDERED list is invalid_input, naming only that list", async () => {
  const { harness: h, result } = run({}, { zero: DEFINITION_ALPHA }, CURRENT_ORDER);
  const outcome = await result;

  assert.deepEqual(outcome, {
    ok: false,
    code: "invalid_input",
    issues: [{ field: "orderedDefinitionIds", code: "not_an_id_list" }],
  });
  // The effect is never reached: nothing is written and nothing is read.
  assert.equal(h.atomicArgs.length, 0);
});

test("13. a malformed EXPECTED list is invalid_input, naming only that list", async () => {
  const { harness: h, result } = run({}, NEW_ORDER, { zero: DEFINITION_ALPHA });
  const outcome = await result;

  assert.deepEqual(outcome, {
    ok: false,
    code: "invalid_input",
    issues: [{ field: "expectedOrderedDefinitionIds", code: "not_an_id_list" }],
  });
  assert.equal(h.atomicArgs.length, 0);
});

test("14. a string, a number, null and undefined are all rejected as lists", async () => {
  const malformed: readonly unknown[] = [
    DEFINITION_ALPHA,
    "",
    0,
    3,
    null,
    true,
    { length: 1, 0: DEFINITION_ALPHA },
    new Set([DEFINITION_ALPHA]),
  ];
  const refusal = {
    ok: false,
    code: "invalid_input",
    issues: [{ field: "orderedDefinitionIds", code: "not_an_id_list" }],
  };

  for (const value of malformed) {
    const outcome = await run({}, value, CURRENT_ORDER).result;
    assert.deepEqual(outcome, refusal, `${String(value)} was accepted as an id list`);
  }

  // `undefined` is passed to the orchestration DIRECTLY: routing it through the
  // harness helper would silently pick up that helper's default argument.
  const h = harness();
  assert.deepEqual(
    await reorderExamDefinitionsWithDeps(
      REQUESTED_OFFERING_ID,
      undefined,
      CURRENT_ORDER,
      h.deps,
    ),
    refusal,
  );
  assert.equal(h.atomicArgs.length, 0);
});

test("15. a MIXED array is rejected — no entry is ever coerced", async () => {
  for (const entry of [1, 0, null, undefined, true, false, {}, []]) {
    const outcome = await run({}, [DEFINITION_ALPHA, entry], CURRENT_ORDER).result;
    assert.deepEqual(outcome, {
      ok: false,
      code: "invalid_input",
      issues: [{ field: "orderedDefinitionIds", code: "not_an_id_list" }],
    });
  }
});

test("16. a blank or whitespace-only id is rejected", async () => {
  for (const blank of ["", " ", "\t", "\n", "   \r\n  "]) {
    const outcome = await run({}, [DEFINITION_ALPHA, blank], CURRENT_ORDER).result;
    assert.deepEqual(outcome, {
      ok: false,
      code: "invalid_input",
      issues: [{ field: "orderedDefinitionIds", code: "not_an_id_list" }],
    });
  }
});

test("17. ids are TRIMMED, and their case is preserved exactly", async () => {
  const { harness: h, result } = run(
    {},
    [`  ${DEFINITION_GAMMA} `, `\t${DEFINITION_ALPHA}`, `${DEFINITION_BETA}\n`],
    [` ${DEFINITION_ALPHA}`, DEFINITION_BETA, `${DEFINITION_GAMMA}  `],
  );
  await result;

  assert.deepEqual(h.atomicArgs[0].orderedDefinitionIds, NEW_ORDER);
  assert.deepEqual(h.atomicArgs[0].expectedOrderedDefinitionIds, CURRENT_ORDER);

  // Case is opaque, never folded.
  const cased = run({}, [" Definition-Alpha "], [DEFINITION_ALPHA]);
  await cased.result;
  assert.deepEqual(cased.harness.atomicArgs[0].orderedDefinitionIds, ["Definition-Alpha"]);
});

// ===========================================================================
// 18–19. Duplicates are a CONFLICT, not a shape error
// ===========================================================================

test("18. duplicate ORDERED ids reach the atomic check and refuse as reorder_conflict", async () => {
  const { harness: h, result } = run(
    { atomic: { status: "conflict" } },
    [DEFINITION_ALPHA, DEFINITION_ALPHA, DEFINITION_BETA],
    CURRENT_ORDER,
  );
  const outcome = await result;

  assert.deepEqual(outcome, { ok: false, code: "reorder_conflict" });
  // The shape was VALID, so the list reached the authoritative comparison.
  assert.equal(h.atomicArgs.length, 1);
  assert.deepEqual(h.atomicArgs[0].orderedDefinitionIds, [
    DEFINITION_ALPHA,
    DEFINITION_ALPHA,
    DEFINITION_BETA,
  ]);
});

test("19. duplicate EXPECTED ids reach the atomic check and refuse as reorder_conflict", async () => {
  const { harness: h, result } = run({ atomic: { status: "conflict" } }, NEW_ORDER, [
    DEFINITION_ALPHA,
    DEFINITION_ALPHA,
    DEFINITION_BETA,
  ]);

  assert.deepEqual(await result, { ok: false, code: "reorder_conflict" });
  assert.equal(h.atomicArgs.length, 1);
});

// ===========================================================================
// 20–23. Every refusal path
// ===========================================================================

test("20. no plan is plan_not_found, and the atomic effect is never reached", async () => {
  const { harness: h, result } = run({ plan: null });

  assert.deepEqual(await result, { ok: false, code: "plan_not_found" });
  assert.equal(h.calls.includes("reorderDefinitionsAtomically"), false);
});

test("21. the typed course not-found is offering_not_found", async () => {
  const { harness: h, result } = run({ contextThrows: new FakeCourseNotFoundError() });

  assert.deepEqual(await result, { ok: false, code: "offering_not_found" });
  assert.deepEqual(h.calls, ["requireCourseContext"]);
});

test("22. the typed lifecycle denial is operation_not_allowed", async () => {
  const { harness: h, result } = run({
    status: "ARCHIVED",
    gateThrows: new FakeOperationDeniedError(),
  });

  assert.deepEqual(await result, { ok: false, code: "operation_not_allowed" });
  assert.deepEqual(h.gateArgs, ["ARCHIVED"]);
  assert.equal(h.calls.includes("findExamPlanByCourseOfferingId"), false);
});

test("23. the atomic conflict outcome is reorder_conflict, with no issues key", async () => {
  const outcome = await run({ atomic: { status: "conflict" } }).result;

  assert.deepEqual(outcome, { ok: false, code: "reorder_conflict" });
  assert.deepEqual(Object.keys(outcome).sort(), ["code", "ok"]);
  assert.equal("issues" in outcome, false);
});

// ===========================================================================
// 24–27. Which array, and which count, each success reports
// ===========================================================================

test("24. a CHANGED result reports the submitted, normalized order", async () => {
  const outcome = changedResult(
    await run(
      {},
      [` ${DEFINITION_GAMMA}`, DEFINITION_ALPHA, `${DEFINITION_BETA} `],
      CURRENT_ORDER,
    ).result,
  );

  assert.deepEqual(outcome.orderedDefinitionIds, NEW_ORDER);
});

test("25. a NO-OP result reports the AUTHORITATIVE order the effect returned", async () => {
  // The effect is the only thing that has seen the database, so its array — not
  // the submitted one — is what the caller is told.
  const outcome = unchangedResult(
    await run(
      { atomic: { status: "unchanged", orderedDefinitionIds: CURRENT_ORDER } },
      CURRENT_ORDER,
      CURRENT_ORDER,
    ).result,
  );

  assert.deepEqual(outcome.orderedDefinitionIds, CURRENT_ORDER);
});

test("26. updatedCount is carried through unmodified for a changed result", async () => {
  for (const updatedCount of [1, 2, 3, 17]) {
    const outcome = changedResult(
      await run({
        atomic: { status: "updated", orderedDefinitionIds: NEW_ORDER, updatedCount },
      }).result,
    );
    assert.equal(outcome.updatedCount, updatedCount);
  }
});

test("27. a no-op's updatedCount is exactly 0", async () => {
  const outcome = unchangedResult(
    await run(
      { atomic: { status: "unchanged", orderedDefinitionIds: CURRENT_ORDER } },
      CURRENT_ORDER,
      CURRENT_ORDER,
    ).result,
  );

  assert.equal(outcome.updatedCount, 0);
  assert.equal(Object.is(outcome.updatedCount, 0), true, "the count must be a plain zero");
});

// ===========================================================================
// 28–29. Call counts, and which dependencies a failure skips
// ===========================================================================

test("28. every dependency is called AT MOST once on the success path", async () => {
  const { harness: h, result } = run();
  await result;

  const counted = new Map<string, number>();
  for (const call of h.calls) counted.set(call, (counted.get(call) ?? 0) + 1);
  for (const [name, count] of counted) {
    assert.equal(count, 1, `${name} was called ${count} times`);
  }
  assert.equal(h.calls.length, 4);
});

test("29. each failure path skips every later dependency", async () => {
  const cases: { options: HarnessOptions; ordered?: unknown; calls: string[] }[] = [
    { options: { contextThrows: new FakeCourseNotFoundError() }, calls: ["requireCourseContext"] },
    {
      options: { gateThrows: new FakeOperationDeniedError() },
      calls: ["requireCourseContext", "assertConfigurationAllowed"],
    },
    {
      options: { plan: null },
      calls: [
        "requireCourseContext",
        "assertConfigurationAllowed",
        "findExamPlanByCourseOfferingId",
      ],
    },
    {
      options: {},
      ordered: "not-an-array",
      calls: [
        "requireCourseContext",
        "assertConfigurationAllowed",
        "findExamPlanByCourseOfferingId",
      ],
    },
    {
      options: { atomic: { status: "conflict" } },
      calls: [
        "requireCourseContext",
        "assertConfigurationAllowed",
        "findExamPlanByCourseOfferingId",
        "reorderDefinitionsAtomically",
      ],
    },
  ];

  for (const { options, ordered, calls } of cases) {
    const attempt = run(options, ordered === undefined ? NEW_ORDER : ordered);
    await attempt.result;
    assert.deepEqual(attempt.harness.calls, calls);
  }
});

// ===========================================================================
// 30–33. Everything unrecognized propagates
// ===========================================================================

test("30. an unexpected authorization error propagates unchanged", async () => {
  const thrown = new FakeUnexpectedError("boom");
  await assert.rejects(() => run({ contextThrows: thrown }).result, (error) => error === thrown);
});

test("31. a redirect-like throw propagates from the authorization boundary", async () => {
  const thrown = redirectLikeError();
  await assert.rejects(() => run({ contextThrows: thrown }).result, (error) => error === thrown);

  // ...and from the gate, which is the other place a policy may redirect.
  const fromGate = redirectLikeError();
  await assert.rejects(
    () => run({ gateThrows: fromGate }).result,
    (error) => error === fromGate,
  );
});

test("32. an unexpected plan-lookup error propagates unchanged", async () => {
  const thrown = new FakeUnexpectedError("plan");
  await assert.rejects(() => run({ planThrows: thrown }).result, (error) => error === thrown);
});

test("33. an unexpected atomic-effect error propagates unchanged", async () => {
  const thrown = new FakeUnexpectedError("transaction");
  await assert.rejects(() => run({ atomicThrows: thrown }).result, (error) => error === thrown);
  // A course/lifecycle classifier must NOT be consulted for the effect's throws.
  const courseShaped = new FakeCourseNotFoundError();
  await assert.rejects(
    () => run({ atomicThrows: courseShaped }).result,
    (error) => error === courseShaped,
  );
});

// ===========================================================================
// 34–42. The result model
// ===========================================================================

/** Every result this module can produce, for the model-wide assertions. */
async function everyResult(): Promise<ReorderExamDefinitionsResult[]> {
  return [
    await run().result,
    await run(
      { atomic: { status: "unchanged", orderedDefinitionIds: CURRENT_ORDER } },
      CURRENT_ORDER,
      CURRENT_ORDER,
    ).result,
    await run({ atomic: { status: "conflict" } }).result,
    await run({ plan: null }).result,
    await run({ contextThrows: new FakeCourseNotFoundError() }).result,
    await run({ gateThrows: new FakeOperationDeniedError() }).result,
    await run({}, "not-an-array", 7).result,
  ];
}

test("34. every result is plain JSON — no Date, Map, Set, class or function", async () => {
  function assertPlain(value: unknown, path: string): void {
    if (value === null) return;
    const kind = typeof value;
    if (kind === "string" || kind === "number" || kind === "boolean") return;
    assert.equal(kind, "object", `${path} is a ${kind}`);
    assert.equal(value instanceof Date, false, `${path} is a Date`);
    assert.equal(value instanceof Map, false, `${path} is a Map`);
    assert.equal(value instanceof Set, false, `${path} is a Set`);
    assert.equal(value instanceof Error, false, `${path} is an Error`);
    if (Array.isArray(value)) {
      value.forEach((entry, index) => assertPlain(entry, `${path}[${index}]`));
      return;
    }
    assert.equal(
      Object.getPrototypeOf(value),
      Object.prototype,
      `${path} is a class instance`,
    );
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      assertPlain(entry, `${path}.${key}`);
    }
  }

  for (const [index, result] of (await everyResult()).entries()) {
    assertPlain(result, `result[${index}]`);
  }
});

test("35. every result survives a JSON round trip, deep-equal", async () => {
  for (const result of await everyResult()) {
    assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  }
});

test("36. no result carries an undefined value anywhere", async () => {
  function assertDefined(value: unknown, path: string): void {
    assert.notEqual(value, undefined, `${path} is undefined`);
    if (value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((entry, index) => assertDefined(entry, `${path}[${index}]`));
      return;
    }
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      assertDefined(entry, `${path}.${key}`);
    }
  }
  for (const [index, result] of (await everyResult()).entries()) {
    assertDefined(result, `result[${index}]`);
  }
});

test("37. every result, its id array and its issue list are FROZEN", async () => {
  for (const result of await everyResult()) {
    assert.equal(Object.isFrozen(result), true, "the result is mutable");
    if (result.ok) {
      assert.equal(Object.isFrozen(result.orderedDefinitionIds), true, "the id array is mutable");
      assert.throws(() => {
        (result.orderedDefinitionIds as string[]).push("definition-injected");
      });
    } else if (result.code === "invalid_input") {
      assert.equal(Object.isFrozen(result.issues), true, "the issue list is mutable");
      for (const issue of result.issues) {
        assert.equal(Object.isFrozen(issue), true, "an issue is mutable");
      }
    }
  }
});

test("38. the caller's source arrays are never mutated", async () => {
  const ordered = [` ${DEFINITION_GAMMA}`, DEFINITION_ALPHA, DEFINITION_BETA];
  const expected = [DEFINITION_ALPHA, DEFINITION_BETA, DEFINITION_GAMMA];
  const orderedCopy = [...ordered];
  const expectedCopy = [...expected];

  const outcome = changedResult(await run({}, ordered, expected).result);

  assert.deepEqual(ordered, orderedCopy, "the submitted array was mutated");
  assert.deepEqual(expected, expectedCopy, "the expected array was mutated");
  // ...and the result does not ALIAS either of them.
  assert.notEqual(outcome.orderedDefinitionIds, ordered);
});

test("39. FROZEN source arrays are accepted", async () => {
  const ordered = Object.freeze([...NEW_ORDER]);
  const expected = Object.freeze([...CURRENT_ORDER]);

  const outcome = changedResult(await run({}, ordered, expected).result);

  assert.deepEqual(outcome.orderedDefinitionIds, NEW_ORDER);
});

test("40. no result carries a raw database field", async () => {
  for (const result of await everyResult()) {
    for (const key of Object.keys(result)) {
      for (const forbidden of [
        "orderIndex",
        "createdAt",
        "updatedAt",
        "planId",
        "kind",
        "durationMinutes",
        "parallelCapacity",
        "requires",
      ]) {
        assert.equal(key.includes(forbidden), false, `the result carries ${key}`);
      }
    }
  }
});

test("41. no result carries a plan, course or actor identifier", async () => {
  for (const result of await everyResult()) {
    const serialized = JSON.stringify(result);
    for (const identifier of [
      SERVER_PLAN_ID,
      VERIFIED_OFFERING_ID,
      REQUESTED_OFFERING_ID,
      "plan-from-another-lookup",
    ]) {
      assert.equal(serialized.includes(identifier), false, `the result leaks ${identifier}`);
    }
  }
});

test("42. a rejected submitted value is never echoed back", async () => {
  const secret = "definition-<script>-injected";
  const outcome = await run({}, [DEFINITION_ALPHA, secret, 7], CURRENT_ORDER).result;

  const serialized = JSON.stringify(outcome);
  assert.equal(serialized.includes(secret), false, "the rejected value was echoed");
  assert.equal(serialized.includes(DEFINITION_ALPHA), false, "a sibling value was echoed");
  assert.deepEqual(outcome, {
    ok: false,
    code: "invalid_input",
    issues: [{ field: "orderedDefinitionIds", code: "not_an_id_list" }],
  });
});

// ===========================================================================
// 43–44. The degenerate plans
// ===========================================================================

test("43. an EMPTY plan can be reordered — both lists empty, and it succeeds", async () => {
  const { harness: h, result } = run(
    { atomic: { status: "unchanged", orderedDefinitionIds: [] } },
    [],
    [],
  );
  const outcome = await result;

  assert.deepEqual(outcome, {
    ok: true,
    changed: false,
    orderedDefinitionIds: [],
    updatedCount: 0,
  });
  assert.deepEqual(h.atomicArgs[0].orderedDefinitionIds, []);
  assert.deepEqual(h.atomicArgs[0].expectedOrderedDefinitionIds, []);
});

test("44. a ONE-definition plan in the same position is a no-op success", async () => {
  const outcome = await run(
    { atomic: { status: "unchanged", orderedDefinitionIds: [DEFINITION_ALPHA] } },
    [DEFINITION_ALPHA],
    [DEFINITION_ALPHA],
  ).result;

  assert.deepEqual(outcome, {
    ok: true,
    changed: false,
    orderedDefinitionIds: [DEFINITION_ALPHA],
    updatedCount: 0,
  });
});

// ===========================================================================
// P1–P4. The two pure predicates the atomic binding is required to use
// ===========================================================================

test("P1. sequence equality is position-by-position, and length-sensitive", () => {
  assert.equal(isSameExamDefinitionIdSequence(CURRENT_ORDER, [...CURRENT_ORDER]), true);
  assert.equal(isSameExamDefinitionIdSequence([], []), true);
  assert.equal(isSameExamDefinitionIdSequence(CURRENT_ORDER, NEW_ORDER), false);
  assert.equal(isSameExamDefinitionIdSequence(CURRENT_ORDER, CURRENT_ORDER.slice(0, 2)), false);
  assert.equal(
    isSameExamDefinitionIdSequence([DEFINITION_ALPHA], ["Definition-Alpha"]),
    false,
    "sequence equality must be case-sensitive",
  );
});

test("P2. an exact permutation requires the same length, no duplicate and the same set", () => {
  assert.equal(isExactExamDefinitionIdPermutation(NEW_ORDER, CURRENT_ORDER), true);
  assert.equal(isExactExamDefinitionIdPermutation(CURRENT_ORDER, CURRENT_ORDER), true);
  assert.equal(isExactExamDefinitionIdPermutation([], []), true);

  // Missing.
  assert.equal(
    isExactExamDefinitionIdPermutation([DEFINITION_ALPHA, DEFINITION_BETA], CURRENT_ORDER),
    false,
  );
  // Extra.
  assert.equal(
    isExactExamDefinitionIdPermutation([...CURRENT_ORDER, "definition-extra"], CURRENT_ORDER),
    false,
  );
  // Duplicate, right length — the case a bare set comparison would miss.
  assert.equal(
    isExactExamDefinitionIdPermutation(
      [DEFINITION_ALPHA, DEFINITION_ALPHA, DEFINITION_BETA],
      CURRENT_ORDER,
    ),
    false,
  );
  // Unknown / foreign-plan id, right length.
  assert.equal(
    isExactExamDefinitionIdPermutation(
      [DEFINITION_ALPHA, DEFINITION_BETA, "definition-of-another-plan"],
      CURRENT_ORDER,
    ),
    false,
  );
});

test("P3. the current-order predicate is the permutation AND the positions", () => {
  assert.equal(isCurrentExamDefinitionIdOrder(CURRENT_ORDER, CURRENT_ORDER), true);
  assert.equal(isCurrentExamDefinitionIdOrder([], []), true);
  assert.equal(isCurrentExamDefinitionIdOrder(NEW_ORDER, CURRENT_ORDER), false);
  // A duplicated list that happens to match position-by-position against a
  // duplicated "current" is still refused, because it is not a permutation.
  assert.equal(
    isCurrentExamDefinitionIdOrder(
      [DEFINITION_ALPHA, DEFINITION_ALPHA],
      [DEFINITION_ALPHA, DEFINITION_ALPHA],
    ),
    false,
  );
});

test("P4. neither predicate mutates or reads anything but its two arguments", () => {
  const left = Object.freeze([...CURRENT_ORDER]);
  const right = Object.freeze([...NEW_ORDER]);
  assert.equal(isSameExamDefinitionIdSequence(left, right), false);
  assert.equal(isExactExamDefinitionIdPermutation(left, right), true);
  assert.equal(isCurrentExamDefinitionIdOrder(left, right), false);
  assert.deepEqual(left, CURRENT_ORDER);
  assert.deepEqual(right, NEW_ORDER);
});

// ===========================================================================
// D1–D9. Structural guards on the module SOURCE
// ===========================================================================

const EXAM_DIR = join(import.meta.dirname);
const MODULE_NAME = "reorder-exam-definitions-core.ts";
const TEST_NAME = "reorder-exam-definitions-core.test.ts";

const SOURCE = readFileSync(join(EXAM_DIR, MODULE_NAME), "utf8");

/** Strip comments so the guards assert on CODE, not on explanatory prose. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function commentsOf(source: string): string {
  return [
    ...(source.match(/\/\*[\s\S]*?\*\//g) ?? []),
    ...(source.match(/^\s*\/\/.*$/gm) ?? []),
  ].join("\n");
}

const CODE = stripComments(SOURCE);
const COMMENTS = commentsOf(SOURCE);

/** The parameter list of the orchestration, whitespace-collapsed. */
function orchestrationParams(source: string): string {
  const match = source.match(
    /export async function reorderExamDefinitionsWithDeps\(([\s\S]*?)\):/,
  );
  assert.ok(match, "the orchestration is not exported");
  return match[1].replace(/\s+/g, " ").trim();
}

test("D1. the pure core performs no database operation and imports nothing", () => {
  const specifiers = [...CODE.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(specifiers, [], `the pure core imports: ${specifiers.join(", ")}`);
  assert.equal(/^\s*import\s/m.test(CODE), false, "the pure core has an import statement");

  const dbCalls =
    /\.(create|createMany|update|updateMany|upsert|delete|deleteMany|findUnique|findFirst|findMany|count|aggregate|\$transaction)\s*\(/;
  assert.equal(dbCalls.test(CODE), false, "the pure core performs a database operation");
});

test("D2. the pure core declares neither server-only nor a directive", () => {
  for (const token of [
    "server" + "-only",
    '"use ' + 'server"',
    "'use " + "server'",
    '"use ' + 'client"',
  ]) {
    assert.equal(CODE.includes(token), false, `the pure core declares ${token}`);
  }
});

test("D3. the pure core has no clock, Date, randomness, env or process access", () => {
  for (const pattern of [/\bDate\b/, /Math\.random\b/, /process\./, /globalThis/, /crypto/]) {
    assert.equal(pattern.test(CODE), false, `the pure core uses ${pattern}`);
  }
});

test("D4. the pure core consults no capability and no actor helper", () => {
  for (const token of [
    '"EXAMS"',
    "'EXAMS'",
    "CapabilityKey",
    "capability",
    "Capability",
    "getEffectiveCapabilities",
    "requireAdmin",
    "getCurrentInstructor",
    "getCurrentTrainee",
    "lib/auth",
    "lib/course",
    "next/headers",
    "next/navigation",
  ]) {
    assert.equal(CODE.includes(token), false, `the pure core reaches ${token}`);
  }
});

test("D5. the pure core can neither create, edit, remove, publish, archive nor notify", () => {
  for (const token of [
    "createPlan",
    "upsertPlan",
    "ensurePlan",
    "createDefinition",
    "updateDefinition",
    "deleteDefinition",
    "publish",
    "unpublish",
    "notify",
    "notification",
    "Notification",
    "web-push",
    "archive",
    "isActive",
    "deletedAt",
  ]) {
    assert.equal(CODE.includes(token), false, `the pure core exposes ${token}`);
  }
});

test("D6. the injected boundary has exactly the six approved members", () => {
  const block = CODE.slice(
    CODE.indexOf("export interface ReorderExamDefinitionsDeps {"),
    CODE.indexOf("\n}", CODE.indexOf("export interface ReorderExamDefinitionsDeps {")),
  );
  assert.ok(block.length > 0, "the deps interface is missing");
  const members = [...block.matchAll(/^\s{2}(\w+)\(/gm)].map(([, name]) => name).sort();
  assert.deepEqual(members, [
    "assertConfigurationAllowed",
    "findExamPlanByCourseOfferingId",
    "isCourseNotFoundError",
    "isOperationNotAllowedError",
    "reorderDefinitionsAtomically",
    "requireCourseContext",
  ]);
});

test("D7. the reorder never inspects a definition's kind, name or other stored field", () => {
  // A reorder moves rows; it reads nothing ABOUT them. The core therefore never
  // names a definition column — same-kind definitions are simply irrelevant to
  // it, and no dependency exists that could fetch one.
  for (const field of [
    "kind",
    "durationMinutes",
    "parallelCapacity",
    "requiresInstructedTrainee",
    "requiresLessonTopic",
    "requiresDiscipline",
    "orderIndex",
    "BEGINNER",
    "findDefinition",
    "definitionKind",
  ]) {
    assert.equal(CODE.includes(field), false, `the pure core inspects ${field}`);
  }
  // `name` appears only as the deps' method names, never as a field read; the
  // ONLY definition property this module ever handles is the id.
  assert.equal(/\.name\b/.test(CODE), false, "the pure core reads a definition name");
});

test("D8. only the approved outcome codes exist", () => {
  // The refusal helper's argument, and the one arm that spells its own code.
  // (The `not_an_id_list` ISSUE code is a different vocabulary and is asserted
  // by the behavioural tests above.)
  const codes = [...CODE.matchAll(/refuse\("([a-z_]+)"\)|code: "([a-z_]+)" as const/g)]
    .map((match) => match[1] ?? match[2])
    .filter((code): code is string => typeof code === "string");
  assert.deepEqual(
    [...new Set(codes)].sort(),
    ["invalid_input", "offering_not_found", "operation_not_allowed", "plan_not_found", "reorder_conflict"],
  );
  for (const token of [
    "unexpected",
    "stale_write",
    "duplicate_name",
    "definition_not_found",
    "definition_in_use",
    "plan_published",
  ]) {
    assert.equal(CODE.includes(token), false, `the pure core invents ${token}`);
  }
});

test("D9. the whole-set rule and the non-disclosure decision are documented", () => {
  assert.ok(/permutation/i.test(COMMENTS), "the exact-set rule is undocumented");
  assert.ok(/duplicate/i.test(COMMENTS), "the duplicate handling is undocumented");
  assert.ok(/another plan|foreign/i.test(COMMENTS), "the non-disclosure rule is undocumented");
  assert.ok(/token/i.test(COMMENTS), "the stale-write token is undocumented");
  // ...and it must not claim a uniqueness guarantee the schema does not have.
  assert.equal(
    /(guarantee|prevent|ensure)s?[^.]{0,60}unique/i.test(COMMENTS),
    false,
    "the header claims uniqueness it does not enforce",
  );
});

test("D10. the slice's two lib/exam files are exactly the approved pair", () => {
  const sliceFiles = readdirSync(EXAM_DIR)
    .filter((name) => name.startsWith("reorder-exam-definitions-core"))
    .sort();
  assert.deepEqual(sliceFiles, [MODULE_NAME, TEST_NAME].sort());
});
