/**
 * EXAM EX-S5B-3 — executable tests for the PURE ExamDefinition REMOVAL
 * orchestration (delete-exam-definition-core.ts).
 *
 * Run with: npx tsx --test lib/exam/delete-exam-definition-core.test.ts
 *
 * DB-FREE: every dependency is a fake, no database connection is opened, no SQL
 * is executed, and no production identifier appears anywhere. The only files read
 * are module SOURCE TEXTS, by the structural guards at the bottom.
 *
 * SCOPE OF PROOF:
 *   - the LOCKED ORDER: authorize -> gate -> plan -> definition -> token ->
 *     count -> delete, and, for every failure, exactly WHICH later dependencies
 *     are skipped;
 *   - that the VERIFIED offering id (never the requested one) reaches the plan
 *     lookup, and the SERVER-RESOLVED plan id (never a caller value) reaches the
 *     read, the count and the delete;
 *   - the TWO in-use protections: the pre-check that refuses without a delete,
 *     and the foreign-key race guard that refuses with the same code;
 *   - that the race guard is NARROW: an unrelated foreign-key failure and a
 *     record-not-found both propagate;
 *   - stale-delete protection;
 *   - the result model: narrow, plain, frozen, JSON-round-trippable, non-echoing,
 *     and carrying no archive state, because there is no archive.
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
  deleteExamDefinitionWithDeps,
  isExamDefinitionInUseError,
  type DeleteExamDefinitionDeps,
  type DeleteExamDefinitionResult,
  type ExistingExamDefinitionForDelete,
  type ResolvedExamPlanForDelete,
} from "./delete-exam-definition-core";

// ===========================================================================
// Fixtures
// ===========================================================================

/** What the caller ASKS for. Deliberately different from what is verified. */
const REQUESTED_OFFERING_ID = "offering-as-requested";
/** What the boundary VERIFIED. Only this may reach the plan lookup. */
const VERIFIED_OFFERING_ID = "offering-as-verified";
/** The plan the SERVER resolved. Only this may reach the read, count and write. */
const SERVER_PLAN_ID = "plan-resolved-by-server";

const DEFINITION_ID = "definition-under-removal";

/** The version the stored row currently carries, in epoch milliseconds. */
const STORED_UPDATED_AT = 1_700_000_000_000;

function storedDefinition(): ExistingExamDefinitionForDelete {
  return { id: DEFINITION_ID, updatedAt: STORED_UPDATED_AT };
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

/** The pg driver adapter's shape: the constraint name, one level in. */
function adapterForeignKeyError(constraint: unknown): unknown {
  return {
    code: "P2003",
    meta: { driverAdapterError: { cause: { kind: "ForeignKeyConstraintViolation", constraint } } },
  };
}

/** The query engine's legacy shape: a decorated constraint string. */
function legacyForeignKeyError(fieldName: unknown): unknown {
  return { code: "P2003", meta: { field_name: fieldName } };
}

interface HarnessOptions {
  readonly status?: string;
  readonly plan?: ResolvedExamPlanForDelete | null;
  readonly existing?: ExistingExamDefinitionForDelete | null;
  readonly sessionCount?: number;
  readonly deleted?: boolean;
  readonly contextThrows?: unknown;
  readonly gateThrows?: unknown;
  readonly planThrows?: unknown;
  readonly readThrows?: unknown;
  readonly countThrows?: unknown;
  readonly deleteThrows?: unknown;
}

interface ScopedCall {
  readonly planId: string;
  readonly definitionId: string;
}

interface Harness {
  /** Dependency names, in the exact order they were invoked. */
  readonly calls: string[];
  readonly contextArgs: string[];
  readonly gateArgs: string[];
  readonly planLookupArgs: string[];
  readonly readArgs: ScopedCall[];
  readonly countArgs: ScopedCall[];
  readonly deleteArgs: (ScopedCall & { expectedUpdatedAt: number })[];
  readonly deps: DeleteExamDefinitionDeps;
}

/**
 * Build a recording fake boundary. The foreign-key classifier is the REAL one (a
 * pure export of the module under test, exactly as the production binding uses
 * it); the other two are precise `instanceof` checks — never a catch-all, so a
 * test that expects propagation proves something real.
 */
function harness(options: HarnessOptions = {}): Harness {
  const calls: string[] = [];
  const contextArgs: string[] = [];
  const gateArgs: string[] = [];
  const planLookupArgs: string[] = [];
  const readArgs: ScopedCall[] = [];
  const countArgs: ScopedCall[] = [];
  const deleteArgs: (ScopedCall & { expectedUpdatedAt: number })[] = [];

  const deps: DeleteExamDefinitionDeps = {
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
    findDefinitionForDelete: async (planId, definitionId) => {
      calls.push("findDefinitionForDelete");
      readArgs.push({ planId, definitionId });
      if ("readThrows" in options) throw options.readThrows;
      return options.existing === undefined ? storedDefinition() : options.existing;
    },
    countSessionsForDefinition: async (planId, definitionId) => {
      calls.push("countSessionsForDefinition");
      countArgs.push({ planId, definitionId });
      if ("countThrows" in options) throw options.countThrows;
      return options.sessionCount ?? 0;
    },
    deleteDefinitionIfCurrent: async (planId, definitionId, expectedUpdatedAt) => {
      calls.push("deleteDefinitionIfCurrent");
      deleteArgs.push({ planId, definitionId, expectedUpdatedAt });
      if ("deleteThrows" in options) throw options.deleteThrows;
      return options.deleted ?? true;
    },
    isCourseNotFoundError: (error) => error instanceof FakeCourseNotFoundError,
    isOperationNotAllowedError: (error) => error instanceof FakeOperationDeniedError,
    isDefinitionInUseForeignKeyError: isExamDefinitionInUseError,
  };

  return {
    calls,
    contextArgs,
    gateArgs,
    planLookupArgs,
    readArgs,
    countArgs,
    deleteArgs,
    deps,
  };
}

function run(
  options: HarnessOptions = {},
  expectedUpdatedAt: number = STORED_UPDATED_AT,
  requested: string = REQUESTED_OFFERING_ID,
): { harness: Harness; result: Promise<DeleteExamDefinitionResult> } {
  const h = harness(options);
  return {
    harness: h,
    result: deleteExamDefinitionWithDeps(requested, DEFINITION_ID, expectedUpdatedAt, h.deps),
  };
}

// ===========================================================================
// 37–40. Success, order and scoping
// ===========================================================================

test("37. a successful removal returns ONLY definitionId", async () => {
  const { result } = run();
  const outcome = await result;

  assert.deepEqual(outcome, { ok: true, definitionId: DEFINITION_ID });
  assert.deepEqual(Object.keys(outcome).sort(), ["definitionId", "ok"]);
});

test("38. the dependency order is EXACTLY authorize, gate, plan, read, count, delete", async () => {
  const { harness: h, result } = run({ status: "PLANNED" });
  await result;

  assert.deepEqual(h.calls, [
    "requireCourseContext",
    "assertConfigurationAllowed",
    "findExamPlanByCourseOfferingId",
    "findDefinitionForDelete",
    "countSessionsForDefinition",
    "deleteDefinitionIfCurrent",
  ]);
  assert.deepEqual(h.contextArgs, [REQUESTED_OFFERING_ID]);
  assert.deepEqual(h.gateArgs, ["PLANNED"]);
});

test("39. the VERIFIED offering id is what the plan lookup receives", async () => {
  const { harness: h, result } = run();
  await result;

  assert.deepEqual(h.planLookupArgs, [VERIFIED_OFFERING_ID]);
  assert.deepEqual(h.contextArgs, [REQUESTED_OFFERING_ID]);
  // The RAW requested id is never reused after verification.
  for (const call of [...h.readArgs, ...h.countArgs, ...h.deleteArgs]) {
    assert.notEqual(call.planId, REQUESTED_OFFERING_ID);
    assert.notEqual(call.planId, VERIFIED_OFFERING_ID);
  }
});

test("40. the SERVER plan id scopes the read, the count AND the delete", async () => {
  const { harness: h, result } = run({ plan: { id: SERVER_PLAN_ID } });
  await result;

  const expected = { planId: SERVER_PLAN_ID, definitionId: DEFINITION_ID };
  assert.deepEqual(h.readArgs, [expected]);
  assert.deepEqual(h.countArgs, [expected]);
  assert.deepEqual(h.deleteArgs, [{ ...expected, expectedUpdatedAt: STORED_UPDATED_AT }]);
});

// ===========================================================================
// 41–43. Missing plan, missing definition, unusable token
// ===========================================================================

test("41. a missing plan returns plan_not_found and skips everything after it", async () => {
  const { harness: h, result } = run({ plan: null });
  const outcome = await result;

  assert.deepEqual(outcome, { ok: false, code: "plan_not_found" });
  assert.deepEqual(h.calls, [
    "requireCourseContext",
    "assertConfigurationAllowed",
    "findExamPlanByCourseOfferingId",
  ]);
  assert.deepEqual(h.countArgs, []);
  assert.deepEqual(h.deleteArgs, []);
});

test("42. a missing or foreign-plan definition returns definition_not_found", async () => {
  const missing = run({ existing: null });
  const missingOutcome = await missing.result;

  assert.deepEqual(missingOutcome, { ok: false, code: "definition_not_found" });
  assert.deepEqual(missing.harness.calls, [
    "requireCourseContext",
    "assertConfigurationAllowed",
    "findExamPlanByCourseOfferingId",
    "findDefinitionForDelete",
  ]);
  assert.deepEqual(missing.harness.countArgs, []);
  assert.deepEqual(missing.harness.deleteArgs, []);

  // A reader that HONOURS its plan scope, driven for an offering whose plan is a
  // different one: the definition exists, but not under this plan — and the
  // refusal is INDISTINGUISHABLE, so it cannot reveal another course's data.
  const OTHER_PLAN_ID = "plan-of-another-course";
  const h = harness({ plan: { id: OTHER_PLAN_ID } });
  const scoped: DeleteExamDefinitionDeps = {
    ...h.deps,
    findDefinitionForDelete: async (planId) =>
      planId === SERVER_PLAN_ID ? storedDefinition() : null,
  };
  const foreign = await deleteExamDefinitionWithDeps(
    REQUESTED_OFFERING_ID,
    DEFINITION_ID,
    STORED_UPDATED_AT,
    scoped,
  );
  assert.deepEqual(foreign, missingOutcome);
  assert.equal(JSON.stringify(foreign).includes(OTHER_PLAN_ID), false);
  assert.deepEqual(h.deleteArgs, []);
});

test("43. an unusable expectedUpdatedAt returns invalid_input, before the count", async () => {
  const rejected: unknown[] = [
    "1700000000000",
    "",
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    1_700_000_000_000.5,
    -1,
    null,
    undefined,
    {},
    [],
    true,
  ];
  for (const token of rejected) {
    // Called directly rather than through `run`, so an explicitly-passed
    // `undefined` is a real submission and not `run`'s default token.
    const h = harness();
    const outcome = await deleteExamDefinitionWithDeps(
      REQUESTED_OFFERING_ID,
      DEFINITION_ID,
      token as number,
      h.deps,
    );
    const label = token === undefined ? "undefined" : JSON.stringify(token);
    assert.deepEqual(outcome, { ok: false, code: "invalid_input" }, `accepted ${label}`);
    // The usage question is not even asked for a malformed request.
    assert.deepEqual(h.countArgs, [], `a count ran for ${label}`);
    assert.deepEqual(h.deleteArgs, [], `a delete ran for ${label}`);
  }

  // The boundary values that ARE usable still reach the delete.
  for (const token of [0, 1, STORED_UPDATED_AT]) {
    const { harness: h, result } = run({}, token);
    assert.equal((await result).ok, true, `rejected ${token}`);
    assert.deepEqual(
      h.deleteArgs.map((call) => call.expectedUpdatedAt),
      [token],
    );
  }
});

// ===========================================================================
// 44–48. The two in-use protections
// ===========================================================================

test("44. a definition with sessions returns definition_in_use", async () => {
  for (const sessionCount of [1, 2, 40]) {
    const { result } = run({ sessionCount });
    const outcome = await result;
    assert.deepEqual(outcome, { ok: false, code: "definition_in_use" });
    // The COUNT itself never leaves the module.
    assert.equal(JSON.stringify(outcome).includes(String(sessionCount)), false);
  }
});

test("45. an in-use definition causes ZERO delete calls", async () => {
  const { harness: h, result } = run({ sessionCount: 3 });
  await result;

  assert.deepEqual(h.calls, [
    "requireCourseContext",
    "assertConfigurationAllowed",
    "findExamPlanByCourseOfferingId",
    "findDefinitionForDelete",
    "countSessionsForDefinition",
  ]);
  assert.deepEqual(h.deleteArgs, []);
});

test("46. the RACE — a relevant P2003 during the delete maps to definition_in_use", async () => {
  // Every shape the drivers produce for the ExamSession -> ExamDefinition key.
  const relevant: unknown[] = [
    adapterForeignKeyError({ index: "exam_sessions_planId_definitionId_fkey" }),
    adapterForeignKeyError({ fields: ["planId", "definitionId"] }),
    adapterForeignKeyError({ fields: ["definitionId"] }),
    legacyForeignKeyError("exam_sessions_planId_definitionId_fkey (index)"),
    legacyForeignKeyError("definitionId"),
    { code: "P2003", meta: { constraint: "exam_sessions_planId_definitionId_fkey" } },
    { code: "P2003", meta: { constraint: { index: "exam_sessions_planId_definitionId_fkey" } } },
    // Unreadable metadata: a DELETE from exam_definitions can only violate the
    // one inbound key, so it is attributed to the session restriction.
    { code: "P2003" },
    { code: "P2003", meta: {} },
    { code: "P2003", meta: { constraint: { foreignKey: true } } },
    adapterForeignKeyError(undefined),
  ];
  for (const thrown of relevant) {
    const { result } = run({ deleteThrows: thrown });
    assert.deepEqual(
      await result,
      { ok: false, code: "definition_in_use" },
      `${JSON.stringify(thrown)} was not classified`,
    );
    assert.equal(isExamDefinitionInUseError(thrown), true);
  }
});

test("47. an UNRELATED P2003 propagates unchanged", async () => {
  // The definition's OWN outbound key to exam_plans, and a foreign relation:
  // neither can be raised by deleting a definition, so neither may be laundered
  // into an in-use refusal.
  const unrelated: unknown[] = [
    adapterForeignKeyError({ index: "exam_definitions_planId_fkey" }),
    adapterForeignKeyError({ fields: ["planId"] }),
    legacyForeignKeyError("exam_definitions_planId_fkey (index)"),
    legacyForeignKeyError("sourceTeachingPracticeLessonId"),
    { code: "P2003", meta: { constraint: "exam_session_breaks_sessionId_fkey" } },
  ];
  for (const thrown of unrelated) {
    await assert.rejects(
      () => run({ deleteThrows: thrown }).result,
      (error) => error === thrown,
      `${JSON.stringify(thrown)} was swallowed`,
    );
    assert.equal(isExamDefinitionInUseError(thrown), false);
  }
});

test("48. P2025 is NEVER classified as the foreign-key restriction", async () => {
  // "Record not found" is the opposite of "still in use"; reporting it as in-use
  // would tell a manager to remove sessions that do not exist.
  const notFound = { code: "P2025", meta: { cause: "Record to delete does not exist." } };
  assert.equal(isExamDefinitionInUseError(notFound), false);
  await assert.rejects(
    () => run({ deleteThrows: notFound }).result,
    (error) => error === notFound,
  );

  // ...and neither is anything else that is not a P2003 object.
  for (const value of [
    { code: "P2002", meta: { target: ["planId", "name"] } },
    { code: "P2034" },
    new Error("boom"),
    redirectLikeError(),
    null,
    undefined,
    "P2003",
    2003,
    ["P2003"],
  ]) {
    assert.equal(
      isExamDefinitionInUseError(value),
      false,
      `${String(value)} was classified as in-use`,
    );
  }
});

// ===========================================================================
// 49–52. Stale deletes, denials and propagation
// ===========================================================================

test("49. a delete that matched nothing returns stale_write", async () => {
  const { harness: h, result } = run({ deleted: false });
  assert.deepEqual(await result, { ok: false, code: "stale_write" });
  assert.deepEqual(
    h.deleteArgs.map((call) => call.expectedUpdatedAt),
    [STORED_UPDATED_AT],
  );
});

test("50. a course not-found maps to offering_not_found and skips ALL later work", async () => {
  const { harness: h, result } = run({ contextThrows: new FakeCourseNotFoundError() });
  assert.deepEqual(await result, { ok: false, code: "offering_not_found" });

  assert.deepEqual(h.calls, ["requireCourseContext"]);
  assert.deepEqual(h.gateArgs, []);
  assert.deepEqual(h.planLookupArgs, []);
  assert.deepEqual(h.readArgs, []);
  assert.deepEqual(h.countArgs, []);
  assert.deepEqual(h.deleteArgs, []);
});

test("51. a lifecycle denial maps to operation_not_allowed and skips ALL later work", async () => {
  const { harness: h, result } = run({
    status: "ARCHIVED",
    gateThrows: new FakeOperationDeniedError(),
  });
  assert.deepEqual(await result, { ok: false, code: "operation_not_allowed" });

  assert.deepEqual(h.calls, ["requireCourseContext", "assertConfigurationAllowed"]);
  assert.deepEqual(h.planLookupArgs, []);
  assert.deepEqual(h.readArgs, []);
  assert.deepEqual(h.countArgs, []);
  assert.deepEqual(h.deleteArgs, []);
});

test("52. unexpected count, delete and boundary errors propagate unchanged", async () => {
  const paths: (readonly [string, (boom: Error) => HarnessOptions])[] = [
    ["plan", (boom) => ({ planThrows: boom })],
    ["read", (boom) => ({ readThrows: boom })],
    ["count", (boom) => ({ countThrows: boom })],
    ["delete", (boom) => ({ deleteThrows: boom })],
  ];
  for (const [label, build] of paths) {
    const boom = new Error("infrastructure is down");
    const { harness: h, result } = run(build(boom));
    await assert.rejects(
      () => result,
      (error) => error === boom,
      `the ${label} error was swallowed`,
    );
    if (label !== "delete") assert.deepEqual(h.deleteArgs, []);
  }

  // A REDIRECT-shaped throw propagates from EVERY dependency.
  const redirect = redirectLikeError();
  const dependencies: HarnessOptions[] = [
    { contextThrows: redirect },
    { gateThrows: redirect },
    { planThrows: redirect },
    { readThrows: redirect },
    { countThrows: redirect },
    { deleteThrows: redirect },
  ];
  for (const options of dependencies) {
    await assert.rejects(
      () => run(options).result,
      (error) => error === redirect,
      `${Object.keys(options).join()} swallowed the redirect`,
    );
  }

  // A harness whose classifiers ALL say "no" must propagate every throw — proof
  // that the refusals come from the classifiers, not from a bare catch.
  const courseError = new FakeCourseNotFoundError();
  const gateError = new FakeOperationDeniedError();
  const fkError = adapterForeignKeyError({ index: "exam_sessions_planId_definitionId_fkey" });
  const declining: (readonly [HarnessOptions, unknown])[] = [
    [{ contextThrows: courseError }, courseError],
    [{ gateThrows: gateError }, gateError],
    [{ deleteThrows: fkError }, fkError],
  ];
  for (const [options, thrown] of declining) {
    const h = harness(options);
    const deps: DeleteExamDefinitionDeps = {
      ...h.deps,
      isCourseNotFoundError: () => false,
      isOperationNotAllowedError: () => false,
      isDefinitionInUseForeignKeyError: () => false,
    };
    await assert.rejects(
      () =>
        deleteExamDefinitionWithDeps(
          REQUESTED_OFFERING_ID,
          DEFINITION_ID,
          STORED_UPDATED_AT,
          deps,
        ),
      (error) => error === thrown,
    );
  }
});

// ===========================================================================
// 53–58. The result model, containment and call discipline
// ===========================================================================

/** Every distinct result this core can produce. */
async function everyResult(): Promise<DeleteExamDefinitionResult[]> {
  return [
    await run().result,
    await run({ contextThrows: new FakeCourseNotFoundError() }).result,
    await run({ gateThrows: new FakeOperationDeniedError() }).result,
    await run({ plan: null }).result,
    await run({ existing: null }).result,
    await run({}, Number.NaN).result,
    await run({ sessionCount: 5 }).result,
    await run({ deleted: false }).result,
  ];
}

test("53. every result is plain, frozen and JSON-round-trippable", async () => {
  for (const outcome of await everyResult()) {
    assert.equal(Object.getPrototypeOf(outcome), Object.prototype);
    assert.equal(outcome instanceof Error, false);
    assert.equal(Object.isFrozen(outcome), true, `${JSON.stringify(outcome)} is mutable`);
    assert.deepEqual(JSON.parse(JSON.stringify(outcome)), outcome);
    const record = outcome as unknown as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      assert.notEqual(record[key], undefined, `${key} is undefined`);
    }
    assert.deepEqual(
      Object.keys(record).sort(),
      outcome.ok ? ["definitionId", "ok"] : ["code", "ok"],
    );
  }
});

test("54. no raw database field or error detail enters any result", async () => {
  for (const outcome of await everyResult()) {
    const serialized = JSON.stringify(outcome);
    for (const forbidden of [
      "createdAt",
      "updatedAt",
      "publishedAt",
      "orderIndex",
      "kind",
      "name",
      "meta",
      "stack",
      "clientVersion",
      "constraint",
      "field_name",
      "P2003",
      "P2025",
      "sessionCount",
      "sessions",
    ]) {
      assert.equal(
        serialized.includes(forbidden),
        false,
        `${forbidden} leaked into ${serialized}`,
      );
    }
  }
});

test("55. no result reports an archive state, because there is no archive", async () => {
  for (const outcome of await everyResult()) {
    const serialized = JSON.stringify(outcome);
    for (const forbidden of ["archive", "archived", "isActive", "deletedAt", "soft"]) {
      assert.equal(serialized.includes(forbidden), false, `${forbidden} leaked into ${serialized}`);
    }
  }
});

test("56. no plan, course or actor identifier enters any result", async () => {
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

test("57. no dependency is invoked more than once, on ANY path", async () => {
  const paths: (readonly [HarnessOptions, number])[] = [
    [{}, STORED_UPDATED_AT],
    [{}, Number.NaN],
    [{ contextThrows: new FakeCourseNotFoundError() }, STORED_UPDATED_AT],
    [{ gateThrows: new FakeOperationDeniedError() }, STORED_UPDATED_AT],
    [{ plan: null }, STORED_UPDATED_AT],
    [{ existing: null }, STORED_UPDATED_AT],
    [{ sessionCount: 2 }, STORED_UPDATED_AT],
    [{ deleted: false }, STORED_UPDATED_AT],
    [
      { deleteThrows: adapterForeignKeyError({ fields: ["definitionId"] }) },
      STORED_UPDATED_AT,
    ],
  ];
  for (const [options, token] of paths) {
    const { harness: h, result } = run(options, token);
    await result;
    assert.equal(
      new Set(h.calls).size,
      h.calls.length,
      `a dependency repeated for ${JSON.stringify(options)}: ${h.calls.join(" -> ")}`,
    );
  }
});

test("58. a PUBLISHED plan does not block the removal of an UNUSED definition", async () => {
  // The resolved plan carries an id and nothing else, so publication cannot be
  // consulted even if a dependency volunteered it.
  const published = harness({
    plan: { id: SERVER_PLAN_ID, publishedAt: 1_699_000_000_000 } as ResolvedExamPlanForDelete,
    sessionCount: 0,
  });
  const outcome = await deleteExamDefinitionWithDeps(
    REQUESTED_OFFERING_ID,
    DEFINITION_ID,
    STORED_UPDATED_AT,
    published.deps,
  );

  assert.deepEqual(outcome, { ok: true, definitionId: DEFINITION_ID });
  assert.equal(published.deleteArgs.length, 1);

  // Proof by enumeration: these are ALL the effects the operation can reach —
  // no publication, no notification, no session write.
  assert.deepEqual(Object.keys(published.deps).sort(), [
    "assertConfigurationAllowed",
    "countSessionsForDefinition",
    "deleteDefinitionIfCurrent",
    "findDefinitionForDelete",
    "findExamPlanByCourseOfferingId",
    "isCourseNotFoundError",
    "isDefinitionInUseForeignKeyError",
    "isOperationNotAllowedError",
    "requireCourseContext",
  ]);
});

// ===========================================================================
// Structural guards on the pure core
// ===========================================================================

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const EXAM_DIR = join(REPO_ROOT, "lib", "exam");
const MODULE_NAME = "delete-exam-definition-core.ts";
const TEST_NAME = "delete-exam-definition-core.test.ts";
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

test("D1. the pure core imports no database client and performs no IO", () => {
  for (const token of [
    PRISMA_MODULE,
    GENERATED_CLIENT,
    "$transaction",
    "$executeRaw",
    "$queryRaw",
    "readFile",
    "writeFile",
    "fetch(",
  ]) {
    assert.equal(CODE.includes(token), false, `the pure core references ${token}`);
  }
  const dbCalls =
    /\.(create|createMany|update|updateMany|upsert|delete|deleteMany|findUnique|findFirst|findMany|count|aggregate)\s*\(/;
  assert.equal(dbCalls.test(CODE), false, "the pure core performs a database operation");
});

test("D2. the pure core imports no auth, session, cookie or course implementation", () => {
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

test("D3. the pure core is neither server-only nor a Server Action module", () => {
  assert.equal(CODE.includes("server" + "-only"), false);
  assert.equal(CODE.includes('"use ' + 'server"'), false);
  assert.equal(CODE.includes("'use " + "server'"), false);
  assert.equal(CODE.includes('"use ' + 'client"'), false);
  assert.equal(/import\s+["']server/.test(SOURCE), false);
  assert.ok(COMMENTS.includes("server" + "-only"), "the rule is undocumented");
});

test("D4. the pure core consults no capability of any kind", () => {
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

test("D5. the pure core imports ONLY a sibling pure exam core", () => {
  const specifiers = [...CODE.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(specifiers)], ["./update-exam-definition-core"]);
  // The version-token rule is IMPORTED rather than restated, so the edit and the
  // removal can never disagree about which tokens are usable.
  assert.ok(/\bisExamDefinitionVersionToken\s*\(/.test(CODE));
  for (const token of ["Number.isInteger", "isFinite", "parseInt", "Number("]) {
    assert.equal(CODE.includes(token), false, `the pure core restates ${token}`);
  }
});

test("D6. the orchestration signature exposes no plan, count, actor or transaction", () => {
  const signatures = [
    ...SOURCE.matchAll(/export (?:async )?function (\w+)\(([\s\S]*?)\):/g),
  ].map(([, name, params]) => ({ name, params: params.replace(/\s+/g, " ").trim() }));

  assert.deepEqual(
    signatures.map((signature) => signature.name),
    ["isExamDefinitionInUseError", "deleteExamDefinitionWithDeps"],
  );
  const orchestration = signatures.find((s) => s.name === "deleteExamDefinitionWithDeps");
  assert.ok(orchestration);
  assert.equal(
    orchestration.params,
    "courseOfferingId: string, definitionId: string, expectedUpdatedAt: number, deps: DeleteExamDefinitionDeps,",
  );
  for (const forbidden of [
    "planId",
    "kind",
    "orderIndex",
    "sessionCount",
    "adminId",
    "actorId",
    "prisma",
    "tx:",
    "rawInput",
  ]) {
    assert.equal(
      orchestration.params.includes(forbidden),
      false,
      `the orchestration accepts ${forbidden}`,
    );
  }
});

test("D7. the pure core has no clock, Date, randomness, env or process access", () => {
  for (const pattern of [/\bDate\b/, /Date\.now\b/, /Math\.random\b/, /process\./, /globalThis/]) {
    assert.equal(pattern.test(CODE), false, `the pure core uses ${pattern}`);
  }
});

test("D8. the pure core can neither create, edit, reorder, publish, archive nor notify", () => {
  for (const token of [
    "createPlan",
    "upsertPlan",
    "ensurePlan",
    "createDefinition",
    "updateDefinition",
    "publish",
    "unpublish",
    "notify",
    "notification",
    "reorder",
    "archive",
    "isActive",
    "deletedAt",
  ]) {
    assert.equal(CODE.includes(token), false, `the pure core exposes ${token}`);
  }
});

test("D9. no result code beyond the approved outcomes exists", () => {
  const codes = [...CODE.matchAll(/refuse\("([a-z_]+)"\)|code: "([a-z_]+)"/g)]
    .map((match) => match[1] ?? match[2])
    .filter((code): code is string => typeof code === "string");
  assert.deepEqual(
    [...new Set(codes)].sort(),
    [
      "definition_in_use",
      "definition_not_found",
      "invalid_input",
      "offering_not_found",
      "operation_not_allowed",
      "plan_not_found",
      "stale_write",
    ],
  );
  for (const token of ["unexpected", "duplicate_name", "reorder_conflict", "plan_published"]) {
    assert.equal(CODE.includes(token), false, `the pure core invents ${token}`);
  }
});

test("D10. the FK classifier names the exact constraint, and the fallback is documented", () => {
  assert.ok(
    CODE.includes("exam_sessions_planId_definitionId_fkey"),
    "the classifier does not name the session constraint",
  );
  assert.ok(CODE.includes('"P2003"'), "the classifier does not check the Prisma code");
  // P2025 is never referenced as a classified shape — only discussed in prose.
  assert.equal(CODE.includes("P2025"), false, "the classifier references P2025");
  assert.ok(/P2025/.test(COMMENTS), "the P2025 exclusion is undocumented");
  assert.ok(/fallback/i.test(COMMENTS), "the unreadable-metadata fallback is undocumented");
  assert.ok(/RESTRICT/i.test(COMMENTS), "the ON DELETE RESTRICT protection is undocumented");
  // The pre-check and the race guard are BOTH described.
  assert.ok(/pre-check/i.test(COMMENTS), "the pre-check is undocumented");
  assert.ok(/race/i.test(COMMENTS), "the race guard is undocumented");
});

test("D11. the slice's two lib/exam files are exactly the approved pair", () => {
  const sliceFiles = readdirSync(EXAM_DIR)
    .filter((name) => name.startsWith("delete-exam-definition-core"))
    .sort();
  assert.deepEqual(sliceFiles, [MODULE_NAME, TEST_NAME].sort());
});
