/**
 * EXAM EX-S5B-2 — executable tests for the PURE ExamDefinition CREATE
 * orchestration (create-exam-definition-core.ts).
 *
 * Run with: npx tsx --test lib/exam/create-exam-definition-core.test.ts
 *
 * DB-FREE: every dependency is a fake, no database connection is opened, no SQL
 * is executed, and no production identifier appears anywhere. The only files read
 * are module SOURCE TEXTS, by the structural guards at the bottom.
 *
 * SCOPE OF PROOF:
 *   - the LOCKED ORDER: authorize -> gate -> resolve plan -> validate -> write,
 *     and, for every failure, exactly WHICH later dependencies are skipped;
 *   - that the VERIFIED offering id (never the requested one) reaches the plan
 *     lookup, and the SERVER-RESOLVED plan id (never a caller value) reaches the
 *     write;
 *   - that `planId` and `orderIndex` are unreachable from the caller;
 *   - the result model: narrow, plain, frozen, JSON-round-trippable, non-echoing;
 *   - that only the three known failures are classified and everything else —
 *     including a redirect-shaped throw — propagates unchanged;
 *   - the structural promises: no Prisma, no auth, no capability, no IO in the
 *     pure core.
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
  createExamDefinitionWithDeps,
  isExamDefinitionDuplicateNameError,
  type CreateExamDefinitionDeps,
  type CreateExamDefinitionResult,
  type CreatedExamDefinitionRecord,
  type NormalizedExamDefinitionCreate,
  type ResolvedExamPlanForCreate,
} from "./create-exam-definition-core";

// ===========================================================================
// Fixtures
// ===========================================================================

/** What the caller ASKS for. Deliberately different from what is verified. */
const REQUESTED_OFFERING_ID = "offering-as-requested";
/** What the boundary VERIFIED. Only this may reach the plan lookup. */
const VERIFIED_OFFERING_ID = "offering-as-verified";
/** The plan the SERVER resolved. Only this may reach the write. */
const SERVER_PLAN_ID = "plan-resolved-by-server";

const NEW_DEFINITION_ID = "definition-newly-created";

/** A raw create submission with every field valid; override to break one. */
function rawCreate(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "רכיבה",
    kind: "INTERFACE_RIDING",
    durationMinutes: 20,
    parallelCapacity: 2,
    requiresInstructedTrainee: false,
    requiresLessonTopic: false,
    requiresDiscipline: false,
    ...over,
  };
}

/** The typed not-found the real course boundary throws. */
class FakeCourseNotFoundError extends Error {}
/** The typed denial the real lifecycle policy throws. */
class FakeOperationDeniedError extends Error {}

/**
 * A framework REDIRECT throw, as Next produces for an unauthenticated admin.
 * It carries a `digest` and no `code`, and no classifier may recognize it.
 */
function redirectLikeError(): Error {
  const error = new Error("NEXT_REDIRECT");
  (error as unknown as { digest: string }).digest = "NEXT_REDIRECT;replace;/login;307;";
  return error;
}

/** A Prisma-shaped unique violation on the definition NAME key. */
function duplicateNameError(target: unknown = ["planId", "name"]): unknown {
  return { code: "P2002", meta: { target } };
}

interface HarnessOptions {
  readonly status?: string;
  readonly plan?: ResolvedExamPlanForCreate | null;
  readonly created?: CreatedExamDefinitionRecord;
  readonly contextThrows?: unknown;
  readonly gateThrows?: unknown;
  readonly planThrows?: unknown;
  readonly createThrows?: unknown;
}

interface Harness {
  /** Dependency names, in the exact order they were invoked. */
  readonly calls: string[];
  readonly planLookupArgs: string[];
  readonly createArgs: {
    planId: string;
    value: NormalizedExamDefinitionCreate;
  }[];
  readonly contextArgs: string[];
  readonly gateArgs: string[];
  readonly deps: CreateExamDefinitionDeps;
}

/**
 * Build a recording fake boundary. The three classifiers are the REAL ones where
 * a real one exists (the duplicate-name classifier is a pure export of the module
 * under test) and precise `instanceof` checks otherwise — never a catch-all, so a
 * test that expects propagation is proving something real.
 */
function harness(options: HarnessOptions = {}): Harness {
  const calls: string[] = [];
  const planLookupArgs: string[] = [];
  const createArgs: { planId: string; value: NormalizedExamDefinitionCreate }[] = [];
  const contextArgs: string[] = [];
  const gateArgs: string[] = [];

  const deps: CreateExamDefinitionDeps = {
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
    createDefinitionAtNextOrder: async (planId, value) => {
      calls.push("createDefinitionAtNextOrder");
      createArgs.push({ planId, value });
      if ("createThrows" in options) throw options.createThrows;
      return options.created ?? { id: NEW_DEFINITION_ID, orderIndex: 0 };
    },
    isCourseNotFoundError: (error) => error instanceof FakeCourseNotFoundError,
    isOperationNotAllowedError: (error) => error instanceof FakeOperationDeniedError,
    isDuplicateNameError: isExamDefinitionDuplicateNameError,
  };

  return { calls, planLookupArgs, createArgs, contextArgs, gateArgs, deps };
}

function run(
  options: HarnessOptions = {},
  raw: unknown = rawCreate(),
  requested: string = REQUESTED_OFFERING_ID,
): { harness: Harness; result: Promise<CreateExamDefinitionResult> } {
  const h = harness(options);
  return { harness: h, result: createExamDefinitionWithDeps(requested, raw, h.deps) };
}

// ===========================================================================
// 1. Success
// ===========================================================================

test("1. a successful create returns ONLY definitionId + orderIndex", async () => {
  const { result } = run({ created: { id: NEW_DEFINITION_ID, orderIndex: 3 } });
  const outcome = await result;

  assert.deepEqual(outcome, { ok: true, definitionId: NEW_DEFINITION_ID, orderIndex: 3 });
  assert.deepEqual(Object.keys(outcome).sort(), ["definitionId", "ok", "orderIndex"]);
});

// ===========================================================================
// 2–7. The locked order
// ===========================================================================

test("2. course authorization runs FIRST, before anything else", async () => {
  const { harness: h, result } = run();
  await result;
  assert.equal(h.calls[0], "requireCourseContext");
  assert.deepEqual(h.contextArgs, [REQUESTED_OFFERING_ID]);
});

test("3. the lifecycle gate runs SECOND, on the VERIFIED status", async () => {
  const { harness: h, result } = run({ status: "PLANNED" });
  await result;
  assert.equal(h.calls[1], "assertConfigurationAllowed");
  assert.deepEqual(h.gateArgs, ["PLANNED"]);
});

test("4. the plan lookup runs AFTER the lifecycle gate", async () => {
  const { harness: h, result } = run();
  await result;
  const gate = h.calls.indexOf("assertConfigurationAllowed");
  const lookup = h.calls.indexOf("findExamPlanByCourseOfferingId");
  assert.ok(gate >= 0 && lookup > gate, `order was ${h.calls.join(" -> ")}`);
});

test("5. validation happens AFTER course + plan resolution", async () => {
  // Proof by consequence: an INVALID submission for an offering whose plan
  // exists still resolves the course AND the plan first — the diagnostics could
  // not have been produced before them.
  const { harness: h, result } = run({}, rawCreate({ durationMinutes: 0 }));
  const outcome = await result;

  assert.equal(outcome.ok, false);
  assert.deepEqual(h.calls, [
    "requireCourseContext",
    "assertConfigurationAllowed",
    "findExamPlanByCourseOfferingId",
  ]);
});

test("6. the write happens ONLY after successful validation", async () => {
  const { harness: h, result } = run();
  await result;
  assert.equal(h.calls[h.calls.length - 1], "createDefinitionAtNextOrder");
  assert.equal(h.createArgs.length, 1);
});

test("7. the VERIFIED offering id is what the plan lookup receives", async () => {
  const { harness: h, result } = run();
  await result;
  assert.deepEqual(h.planLookupArgs, [VERIFIED_OFFERING_ID]);
});

test("8. the RAW requested offering id is never reused after verification", async () => {
  const { harness: h, result } = run();
  await result;

  // It reached the boundary exactly once, and nothing downstream ever saw it.
  assert.deepEqual(h.contextArgs, [REQUESTED_OFFERING_ID]);
  assert.equal(h.planLookupArgs.includes(REQUESTED_OFFERING_ID), false);
  assert.equal(
    h.createArgs.some((call) => call.planId === REQUESTED_OFFERING_ID),
    false,
  );
  assert.equal(
    JSON.stringify(await run().result).includes(REQUESTED_OFFERING_ID),
    false,
  );
});

test("9. the SERVER-RESOLVED plan id is what the create dependency receives", async () => {
  const { harness: h, result } = run({ plan: { id: SERVER_PLAN_ID } });
  await result;
  assert.deepEqual(
    h.createArgs.map((call) => call.planId),
    [SERVER_PLAN_ID],
  );
});

// ===========================================================================
// 10–11. The caller cannot supply plan or order
// ===========================================================================

test("10. a caller-supplied planId is ignored: the resolved plan is still used", async () => {
  const { harness: h, result } = run(
    { plan: { id: SERVER_PLAN_ID } },
    rawCreate({ planId: "plan-forged-by-caller", id: "definition-forged" }),
  );
  const outcome = await result;

  assert.equal(outcome.ok, true);
  assert.deepEqual(
    h.createArgs.map((call) => call.planId),
    [SERVER_PLAN_ID],
  );
  // The forged values did not survive normalization either.
  const [call] = h.createArgs;
  assert.equal("planId" in call.value, false);
  assert.equal("id" in call.value, false);
  assert.equal(JSON.stringify(outcome).includes("forged"), false);
});

test("11. a caller-supplied orderIndex never reaches the write payload", async () => {
  const { harness: h, result } = run(
    { created: { id: NEW_DEFINITION_ID, orderIndex: 7 } },
    rawCreate({ orderIndex: 999 }),
  );
  const outcome = await result;

  const [call] = h.createArgs;
  assert.equal("orderIndex" in call.value, false);
  assert.equal(JSON.stringify(call.value).includes("999"), false);
  // The reported position is the one the WRITE assigned, never the submitted one.
  assert.deepEqual(outcome, { ok: true, definitionId: NEW_DEFINITION_ID, orderIndex: 7 });
});

// ===========================================================================
// 12–14. Order positions and shared kinds
// ===========================================================================

test("12. the first definition of a plan may report orderIndex 0", async () => {
  const { result } = run({ created: { id: NEW_DEFINITION_ID, orderIndex: 0 } });
  assert.deepEqual(await result, {
    ok: true,
    definitionId: NEW_DEFINITION_ID,
    orderIndex: 0,
  });
});

test("13. a later definition may report a higher orderIndex", async () => {
  const { result } = run({ created: { id: NEW_DEFINITION_ID, orderIndex: 12 } });
  const outcome = await result;
  assert.equal(outcome.ok === true && outcome.orderIndex, 12);
});

test("14. two DIFFERENT names with the SAME kind both succeed", async () => {
  // Locked product rule: a plan may hold several definitions of one kind
  // (רכיבה and ממשק are both INTERFACE_RIDING). Nothing here rejects the second
  // one, and no kind-level uniqueness is invented.
  const first = run({}, rawCreate({ name: "רכיבה", kind: "INTERFACE_RIDING" }));
  const second = run({}, rawCreate({ name: "ממשק", kind: "INTERFACE_RIDING" }));

  assert.equal((await first.result).ok, true);
  assert.equal((await second.result).ok, true);
  assert.equal(first.harness.createArgs[0].value.kind, "INTERFACE_RIDING");
  assert.equal(second.harness.createArgs[0].value.kind, "INTERFACE_RIDING");
  assert.notEqual(
    first.harness.createArgs[0].value.name,
    second.harness.createArgs[0].value.name,
  );
});

// ===========================================================================
// 15–17. Input validation
// ===========================================================================

test("15. BEGINNER_INSTRUCTION is refused BEFORE any write", async () => {
  const { harness: h, result } = run({}, rawCreate({ kind: "BEGINNER_INSTRUCTION" }));
  const outcome = await result;

  assert.equal(outcome.ok, false);
  assert.equal(outcome.ok === false && outcome.code, "invalid_input");
  assert.equal(h.calls.includes("createDefinitionAtNextOrder"), false);
  assert.deepEqual(
    outcome.ok === false && outcome.code === "invalid_input"
      ? outcome.issues.map((issue) => issue.code)
      : [],
    ["EX-DEF-KIND-NOT-STORABLE"],
  );
});

test("16. invalid input returns invalid_input with the COMMITTED issue codes", async () => {
  const { result } = run(
    {},
    rawCreate({ name: "   ", durationMinutes: "30", parallelCapacity: -1 }),
  );
  const outcome = await result;

  assert.equal(outcome.ok, false);
  assert.ok(outcome.ok === false && outcome.code === "invalid_input");
  const issues = outcome.ok === false && outcome.code === "invalid_input" ? outcome.issues : [];
  // The committed core's own codes, in the committed core's own order.
  assert.deepEqual(
    issues.map((issue) => issue.code),
    ["EX-DEF-NAME-REQUIRED", "EX-DEF-INVALID-DURATION", "EX-DEF-INVALID-CAPACITY"],
  );
  // Every issue carries a message and nothing else — no submitted value.
  for (const issue of issues) {
    assert.deepEqual(Object.keys(issue).sort(), ["code", "message"]);
    assert.equal(typeof issue.message, "string");
    assert.ok(issue.message.length > 0);
  }
  assert.equal(JSON.stringify(issues).includes("30"), false);
});

test("17. invalid input causes ZERO create calls", async () => {
  // Called directly rather than through `run`, so an explicitly-passed
  // `undefined` is a real submission and not `run`'s default fixture.
  for (const raw of [
    rawCreate({ name: "" }),
    rawCreate({ kind: "NOT_A_KIND" }),
    rawCreate({ durationMinutes: 1.5 }),
    rawCreate({ parallelCapacity: Number.NaN }),
    rawCreate({ requiresLessonTopic: true }),
    null,
    undefined,
    "definition",
    42,
    [],
  ]) {
    const h = harness();
    const outcome = await createExamDefinitionWithDeps(REQUESTED_OFFERING_ID, raw, h.deps);
    const label = raw === undefined ? "undefined" : JSON.stringify(raw);
    assert.equal(outcome.ok, false, `unexpectedly accepted ${label}`);
    assert.deepEqual(h.createArgs, [], `a write ran for ${label}`);
  }
});

// ===========================================================================
// 18–19. No plan
// ===========================================================================

test("18. a missing plan returns plan_not_found", async () => {
  const { result } = run({ plan: null });
  assert.deepEqual(await result, { ok: false, code: "plan_not_found" });
});

test("19. a missing plan skips validation AND the write entirely", async () => {
  // Even an INVALID submission stops at the plan: no diagnostics are produced,
  // so an unauthorized-shaped request learns nothing about the input rules.
  const { harness: h, result } = run({ plan: null }, rawCreate({ name: "" }));
  const outcome = await result;

  assert.deepEqual(outcome, { ok: false, code: "plan_not_found" });
  assert.deepEqual(h.calls, [
    "requireCourseContext",
    "assertConfigurationAllowed",
    "findExamPlanByCourseOfferingId",
  ]);
  assert.deepEqual(h.createArgs, []);
});

// ===========================================================================
// 20–23. Course + lifecycle denials
// ===========================================================================

test("20. a course not-found maps to offering_not_found", async () => {
  const { result } = run({ contextThrows: new FakeCourseNotFoundError("nope") });
  assert.deepEqual(await result, { ok: false, code: "offering_not_found" });
});

test("21. a course not-found causes ZERO gate, plan and create calls", async () => {
  const { harness: h, result } = run({ contextThrows: new FakeCourseNotFoundError() });
  await result;
  assert.deepEqual(h.calls, ["requireCourseContext"]);
  assert.deepEqual(h.gateArgs, []);
  assert.deepEqual(h.planLookupArgs, []);
  assert.deepEqual(h.createArgs, []);
});

test("22. a lifecycle denial maps to operation_not_allowed", async () => {
  const { result } = run({
    status: "ARCHIVED",
    gateThrows: new FakeOperationDeniedError(),
  });
  assert.deepEqual(await result, { ok: false, code: "operation_not_allowed" });
});

test("23. a lifecycle denial causes ZERO plan and create calls", async () => {
  const { harness: h, result } = run({
    status: "ARCHIVED",
    gateThrows: new FakeOperationDeniedError(),
  });
  await result;
  assert.deepEqual(h.calls, ["requireCourseContext", "assertConfigurationAllowed"]);
  assert.deepEqual(h.planLookupArgs, []);
  assert.deepEqual(h.createArgs, []);
});

// ===========================================================================
// 24. The duplicate-name classifier
// ===========================================================================

test("24. a P2002 name conflict maps to duplicate_name", async () => {
  for (const target of [
    ["planId", "name"],
    "exam_definitions_planId_name_key",
    undefined,
    null,
  ]) {
    const { result } = run({ createThrows: duplicateNameError(target) });
    assert.deepEqual(
      await result,
      { ok: false, code: "duplicate_name" },
      `target ${JSON.stringify(target)} was not classified`,
    );
  }
});

test("24b. the REAL classifier accepts only the definition-name conflict", () => {
  // Accepted: both Prisma target representations, and an unreadable target (the
  // bound transaction writes exactly one model, documented in the core).
  assert.equal(isExamDefinitionDuplicateNameError(duplicateNameError()), true);
  assert.equal(
    isExamDefinitionDuplicateNameError(duplicateNameError("exam_definitions_planId_name_key")),
    true,
  );
  assert.equal(isExamDefinitionDuplicateNameError({ code: "P2002" }), true);
  assert.equal(isExamDefinitionDuplicateNameError({ code: "P2002", meta: {} }), true);

  // Rejected: the SIBLING unique key on the same model, other Prisma codes, and
  // every non-Prisma shape — including a framework redirect.
  assert.equal(isExamDefinitionDuplicateNameError(duplicateNameError(["planId", "id"])), false);
  assert.equal(
    isExamDefinitionDuplicateNameError(duplicateNameError("exam_definitions_planId_id_key")),
    false,
  );
  assert.equal(isExamDefinitionDuplicateNameError({ code: "P2003" }), false);
  assert.equal(isExamDefinitionDuplicateNameError({ code: "P2025" }), false);
  assert.equal(isExamDefinitionDuplicateNameError(new Error("boom")), false);
  assert.equal(isExamDefinitionDuplicateNameError(redirectLikeError()), false);
  assert.equal(isExamDefinitionDuplicateNameError(null), false);
  assert.equal(isExamDefinitionDuplicateNameError(undefined), false);
  assert.equal(isExamDefinitionDuplicateNameError("P2002"), false);
});

// ===========================================================================
// 25–28. Everything else propagates
// ===========================================================================

test("25. an unrelated error from the course boundary propagates unchanged", async () => {
  const boom = new Error("infrastructure is down");
  await assert.rejects(
    () => run({ contextThrows: boom }).result,
    (error) => error === boom,
  );
});

test("26. a REDIRECT-shaped error propagates unchanged from every dependency", async () => {
  const redirect = redirectLikeError();
  const paths: (readonly [string, HarnessOptions])[] = [
    ["requireCourseContext", { contextThrows: redirect }],
    ["assertConfigurationAllowed", { gateThrows: redirect }],
    ["findExamPlanByCourseOfferingId", { planThrows: redirect }],
    ["createDefinitionAtNextOrder", { createThrows: redirect }],
  ];
  for (const [dependency, options] of paths) {
    await assert.rejects(
      () => run(options).result,
      (error) => error === redirect,
      `${dependency} swallowed the redirect`,
    );
  }
});

test("27. an unexpected plan-query error propagates unchanged", async () => {
  const boom = new Error("plan query failed");
  const { harness: h, result } = run({ planThrows: boom });
  await assert.rejects(
    () => result,
    (error) => error === boom,
  );
  assert.deepEqual(h.createArgs, []);
});

test("28. an unexpected create error propagates unchanged", async () => {
  for (const boom of [
    new Error("write failed"),
    { code: "P2003" },
    { code: "P2025" },
    duplicateNameError(["planId", "id"]),
  ]) {
    await assert.rejects(
      () => run({ createThrows: boom }).result,
      (error) => error === boom,
      `a ${JSON.stringify(boom)} was swallowed`,
    );
  }
});

// ===========================================================================
// 29–36. The result model
// ===========================================================================

/** Every distinct result this core can produce. */
async function everyResult(): Promise<CreateExamDefinitionResult[]> {
  return [
    await run({ created: { id: NEW_DEFINITION_ID, orderIndex: 4 } }).result,
    await run({ contextThrows: new FakeCourseNotFoundError() }).result,
    await run({ gateThrows: new FakeOperationDeniedError() }).result,
    await run({ plan: null }).result,
    await run({}, rawCreate({ name: "" })).result,
    await run({ createThrows: duplicateNameError() }).result,
  ];
}

test("29. no raw Prisma-like field enters any result", async () => {
  for (const outcome of await everyResult()) {
    for (const forbidden of [
      "createdAt",
      "updatedAt",
      "publishedAt",
      "kind",
      "name",
      "durationMinutes",
      "parallelCapacity",
      "requiresInstructedTrainee",
      "requiresLessonTopic",
      "requiresDiscipline",
      "meta",
      "stack",
      "clientVersion",
    ]) {
      assert.equal(
        JSON.stringify(outcome).includes(`"${forbidden}"`),
        false,
        `${forbidden} leaked into ${JSON.stringify(outcome)}`,
      );
    }
  }
});

test("30. no plan, course or actor identifier enters any result", async () => {
  for (const outcome of await everyResult()) {
    const serialized = JSON.stringify(outcome);
    for (const secret of [
      SERVER_PLAN_ID,
      VERIFIED_OFFERING_ID,
      REQUESTED_OFFERING_ID,
      "planId",
      "courseOfferingId",
      "adminId",
      "actorId",
      "instructorId",
      "studentId",
    ]) {
      assert.equal(serialized.includes(secret), false, `${secret} leaked into ${serialized}`);
    }
  }
});

test("31. every result is a plain object", async () => {
  for (const outcome of await everyResult()) {
    assert.equal(Object.getPrototypeOf(outcome), Object.prototype);
    assert.equal(outcome instanceof Error, false);
    if (outcome.ok === false && outcome.code === "invalid_input") {
      assert.ok(Array.isArray(outcome.issues));
      for (const issue of outcome.issues) {
        assert.equal(Object.getPrototypeOf(issue), Object.prototype);
      }
    }
  }
});

test("32. every result deep-equals its JSON round trip", async () => {
  for (const outcome of await everyResult()) {
    assert.deepEqual(JSON.parse(JSON.stringify(outcome)), outcome);
  }
});

test("33. no result carries an undefined property value", async () => {
  for (const outcome of await everyResult()) {
    const record = outcome as unknown as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      assert.notEqual(record[key], undefined, `${key} is undefined`);
    }
    // `issues` exists ONLY on invalid_input — never as an undefined placeholder.
    const hasIssues = Object.prototype.hasOwnProperty.call(record, "issues");
    assert.equal(hasIssues, outcome.ok === false && outcome.code === "invalid_input");
  }
});

test("34. every result, and every issue array, is FROZEN", async () => {
  for (const outcome of await everyResult()) {
    assert.equal(Object.isFrozen(outcome), true, `${JSON.stringify(outcome)} is mutable`);
    if (outcome.ok === false && outcome.code === "invalid_input") {
      assert.equal(Object.isFrozen(outcome.issues), true);
      for (const issue of outcome.issues) {
        assert.equal(Object.isFrozen(issue), true);
      }
    }
  }
});

test("35. the source raw input is never modified", async () => {
  const raw = rawCreate({ name: "  רכיבה  " });
  const snapshot = JSON.parse(JSON.stringify(raw));
  const { harness: h, result } = run({}, raw);
  await result;

  assert.deepEqual(raw, snapshot);
  // The trimmed value went to the write; the source kept its whitespace.
  assert.equal(h.createArgs[0].value.name, "רכיבה");
  assert.equal(raw.name, "  רכיבה  ");
});

test("36. a FROZEN raw input is supported", async () => {
  const raw = Object.freeze(rawCreate());
  const { result } = run({}, raw);
  assert.equal((await result).ok, true);
});

// ===========================================================================
// 37–40. Call discipline
// ===========================================================================

test("37. the successful dependency order is EXACTLY the locked sequence", async () => {
  const { harness: h, result } = run();
  await result;
  assert.deepEqual(h.calls, [
    "requireCourseContext",
    "assertConfigurationAllowed",
    "findExamPlanByCourseOfferingId",
    "createDefinitionAtNextOrder",
  ]);
});

test("38. no dependency is invoked more than once, on ANY path", async () => {
  const paths: HarnessOptions[] = [
    {},
    { contextThrows: new FakeCourseNotFoundError() },
    { gateThrows: new FakeOperationDeniedError() },
    { plan: null },
    { createThrows: duplicateNameError() },
  ];
  for (const options of paths) {
    const { harness: h, result } = run(options);
    await result;
    const counts = new Map<string, number>();
    for (const call of h.calls) counts.set(call, (counts.get(call) ?? 0) + 1);
    for (const [name, count] of counts) {
      assert.equal(count, 1, `${name} ran ${count} times for ${JSON.stringify(options)}`);
    }
  }
  // The invalid-input path too (it takes a raw override rather than an option).
  const invalid = run({}, rawCreate({ name: "" }));
  await invalid.result;
  assert.deepEqual(new Set(invalid.harness.calls).size, invalid.harness.calls.length);
});

test("39. no error is swallowed broadly: only the three classified shapes refuse", async () => {
  // A harness whose classifiers ALL say "no" must propagate every throw — proof
  // that the refusals come from the classifiers, not from a bare catch. The
  // errors used here are the very shapes the REAL classifiers would accept.
  const courseError = new FakeCourseNotFoundError();
  const gateError = new FakeOperationDeniedError();
  const writeError = duplicateNameError();
  const paths: (readonly [string, HarnessOptions, unknown])[] = [
    ["requireCourseContext", { contextThrows: courseError }, courseError],
    ["assertConfigurationAllowed", { gateThrows: gateError }, gateError],
    ["createDefinitionAtNextOrder", { createThrows: writeError }, writeError],
  ];
  for (const [dependency, options, thrown] of paths) {
    const h = harness(options);
    const deps: CreateExamDefinitionDeps = {
      ...h.deps,
      isCourseNotFoundError: () => false,
      isOperationNotAllowedError: () => false,
      isDuplicateNameError: () => false,
    };
    await assert.rejects(
      () => createExamDefinitionWithDeps(REQUESTED_OFFERING_ID, rawCreate(), deps),
      // The very shape a REAL classifier would accept still propagates when the
      // classifier declines — so refusals come from the classifiers alone.
      (error) => error === thrown,
      `${dependency} was swallowed`,
    );
  }
});

test("40. same-kind definitions stay independent: no cross-call state exists", async () => {
  // Two creates through SEPARATE harnesses, and two through the SAME one.
  const shared = harness({ created: { id: NEW_DEFINITION_ID, orderIndex: 0 } });
  const first = await createExamDefinitionWithDeps(
    REQUESTED_OFFERING_ID,
    rawCreate({ name: "רכיבה" }),
    shared.deps,
  );
  const second = await createExamDefinitionWithDeps(
    REQUESTED_OFFERING_ID,
    rawCreate({ name: "ממשק" }),
    shared.deps,
  );

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.deepEqual(first, second, "the module derives nothing from call history");
  assert.deepEqual(
    shared.createArgs.map((call) => call.value.name),
    ["רכיבה", "ממשק"],
  );
  // Each create still received the same server-resolved plan.
  assert.deepEqual(
    [...new Set(shared.createArgs.map((call) => call.planId))],
    [SERVER_PLAN_ID],
  );
});

// ===========================================================================
// Structural guards on the pure core
// ===========================================================================

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const EXAM_DIR = join(REPO_ROOT, "lib", "exam");
const MODULE_NAME = "create-exam-definition-core.ts";
const TEST_NAME = "create-exam-definition-core.test.ts";
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
 * guard scans every file in this directory for these exact tokens, and spelling
 * one out here would make this suite trip it.
 */
const PRISMA_MODULE = ["@/lib", "prisma"].join("/");
const GENERATED_CLIENT = ["@prisma", "client"].join("/");

test("S1. the pure core imports no database client and performs no IO", () => {
  for (const token of [
    PRISMA_MODULE,
    GENERATED_CLIENT,
    "$transaction",
    "$executeRaw",
    "$queryRaw",
    "aggregate(",
    "readFile",
    "writeFile",
    "fetch(",
  ]) {
    assert.equal(CODE.includes(token), false, `the pure core references ${token}`);
  }
  const dbCalls = /\.(create|createMany|update|updateMany|upsert|delete|deleteMany|findUnique|findFirst|findMany|count|aggregate)\s*\(/;
  assert.equal(dbCalls.test(CODE), false, "the pure core performs a database operation");
});

test("S2. NO write module in lib/exam imports a database client", () => {
  const offenders: string[] = [];
  // MODULES, not suites: the committed no-feedback GUARD suite necessarily names
  // the specifiers it forbids, and so does this one.
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
  ]) {
    assert.equal(CODE.includes(token), false, `the pure core references ${token}`);
  }
});

test("S4. the pure core is neither server-only nor a Server Action module", () => {
  // Asserted on CODE: the header legitimately NAMES the markers it forbids, and
  // a rule stated in prose is exactly what should survive a future edit.
  assert.equal(CODE.includes("server" + "-only"), false);
  assert.equal(CODE.includes('"use ' + 'server"'), false);
  assert.equal(CODE.includes("'use " + "server'"), false);
  assert.equal(CODE.includes('"use ' + 'client"'), false);
  // No import statement of any kind pulls the marker in.
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

test("S6. the pure core imports ONLY a sibling pure exam core", () => {
  const specifiers = [...CODE.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.ok(specifiers.length > 0, "sanity: the module should import something");
  for (const specifier of specifiers) {
    assert.ok(specifier.startsWith("./exam-"), `the pure core imports ${specifier}`);
  }
  assert.deepEqual([...new Set(specifiers)], ["./exam-definition-write-core"]);
});

test("S7. the committed normalizer is CALLED rather than having its rules copied", () => {
  assert.ok(
    /\bnormalizeExamDefinitionCreateInput\s*\(/.test(CODE),
    "the pure core does not call the committed normalizer",
  );
  for (const token of [
    "Number.isInteger",
    "isPositiveInteger",
    "isStorableExamKind",
    "isPresentText",
    "INTERFACE_RIDING",
    "LUNGE_NO_RIDER",
    "ADVANCED_INSTRUCTION",
    ".trim(",
    ".toLowerCase(",
    ".normalize(",
  ]) {
    assert.equal(CODE.includes(token), false, `the pure core restates ${token}`);
  }
});

test("S8. no exported function accepts a plan, order, actor or transaction argument", () => {
  const signatures = [
    ...SOURCE.matchAll(/export (?:async )?function (\w+)\(([\s\S]*?)\):/g),
  ].map(([, name, params]) => ({ name, params: params.replace(/\s+/g, " ").trim() }));

  assert.deepEqual(signatures.map((signature) => signature.name), [
    "isExamDefinitionDuplicateNameError",
    "createExamDefinitionWithDeps",
  ]);
  const orchestration = signatures.find((s) => s.name === "createExamDefinitionWithDeps");
  assert.ok(orchestration);
  assert.equal(orchestration.params, "courseOfferingId: string, rawInput: unknown, deps: CreateExamDefinitionDeps,");
  for (const forbidden of ["planId", "definitionId", "orderIndex", "adminId", "actorId", "prisma", "tx:"]) {
    assert.equal(
      orchestration.params.includes(forbidden),
      false,
      `the orchestration accepts ${forbidden}`,
    );
  }
});

test("S9. the pure core has no clock, randomness, env or process access", () => {
  for (const pattern of [/new Date\b/, /Date\.now\b/, /Math\.random\b/, /process\./, /globalThis/]) {
    assert.equal(pattern.test(CODE), false, `the pure core uses ${pattern}`);
  }
});

test("S10. the pure core can neither create a plan nor write anything else", () => {
  // No dependency name, type or comment offers a plan-creating or
  // publication-changing effect: the operation is structurally append-only.
  for (const token of [
    "createPlan",
    "upsertPlan",
    "ensurePlan",
    "createExamPlan",
    "publish",
    "unpublish",
    "notify",
    "notification",
    "reorder",
    "archive",
    "rename",
  ]) {
    assert.equal(CODE.includes(token), false, `the pure core exposes ${token}`);
  }
});

test("S11. no result code beyond the five approved outcomes exists", () => {
  const codes = [...CODE.matchAll(/refuse\("([a-z_]+)"\)|code: "([a-z_]+)"/g)]
    .map((match) => match[1] ?? match[2])
    .filter((code): code is string => typeof code === "string");
  assert.deepEqual(
    [...new Set(codes)].sort(),
    ["duplicate_name", "invalid_input", "offering_not_found", "operation_not_allowed", "plan_not_found"],
  );
  for (const token of [
    "unexpected",
    "stale_write",
    "definition_not_found",
    "definition_in_use",
    "reorder_conflict",
  ]) {
    assert.equal(CODE.includes(token), false, `the pure core invents ${token}`);
  }
});

test("S12. the slice's two lib/exam files are exactly the approved pair", () => {
  const sliceFiles = readdirSync(EXAM_DIR)
    .filter((name) => name.startsWith("create-exam-definition-core"))
    .sort();
  assert.deepEqual(sliceFiles, [MODULE_NAME, TEST_NAME].sort());
});
