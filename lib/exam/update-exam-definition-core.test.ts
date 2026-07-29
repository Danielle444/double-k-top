/**
 * EXAM EX-S5B-3 — executable tests for the PURE ExamDefinition EDIT
 * orchestration (update-exam-definition-core.ts).
 *
 * Run with: npx tsx --test lib/exam/update-exam-definition-core.test.ts
 *
 * DB-FREE: every dependency is a fake, no database connection is opened, no SQL
 * is executed, and no production identifier appears anywhere. The only files read
 * are module SOURCE TEXTS, by the structural guards at the bottom.
 *
 * SCOPE OF PROOF:
 *   - the LOCKED ORDER: authorize -> gate -> plan -> definition -> token ->
 *     validate -> compare -> write, and, for every failure, exactly WHICH later
 *     dependencies are skipped;
 *   - that the VERIFIED offering id (never the requested one) reaches the plan
 *     lookup, and the SERVER-RESOLVED plan id (never a caller value) reaches the
 *     definition read and the write;
 *   - that `kind` and `orderIndex` are unreachable from the caller, and that the
 *     AUTHORITATIVE stored kind is what validation runs against;
 *   - the no-op rule: zero writes, `changed:false`, the authoritative version;
 *   - stale-write protection, and that it is the WRITE's answer, not a
 *     comparison made in application code;
 *   - the result model: narrow, plain, frozen, JSON-round-trippable, non-echoing;
 *   - that only the known failures are classified and everything else —
 *     including a redirect-shaped throw — propagates unchanged.
 *
 * NOTE ON IDS: the fixtures use obviously-fake, hyphenated ids. No cuid-shaped
 * literal and no production identifier is written here, which the committed
 * exam-slice guards enforce over every file in this directory.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { isExamDefinitionDuplicateNameError } from "./create-exam-definition-core";
import {
  isExamDefinitionVersionToken,
  updateExamDefinitionWithDeps,
  type ExistingExamDefinitionForUpdate,
  type NormalizedExamDefinitionEdit,
  type ResolvedExamPlanForUpdate,
  type UpdateExamDefinitionDeps,
  type UpdateExamDefinitionResult,
  type UpdatedExamDefinitionRecord,
} from "./update-exam-definition-core";

// ===========================================================================
// Fixtures
// ===========================================================================

/** What the caller ASKS for. Deliberately different from what is verified. */
const REQUESTED_OFFERING_ID = "offering-as-requested";
/** What the boundary VERIFIED. Only this may reach the plan lookup. */
const VERIFIED_OFFERING_ID = "offering-as-verified";
/** The plan the SERVER resolved. Only this may reach the read and the write. */
const SERVER_PLAN_ID = "plan-resolved-by-server";

const DEFINITION_ID = "definition-under-edit";

/** The version the stored row currently carries, in epoch milliseconds. */
const STORED_UPDATED_AT = 1_700_000_000_000;
/** The version the row carries AFTER a successful edit. */
const NEXT_UPDATED_AT = 1_700_000_060_000;

/** The AUTHORITATIVE row the server read back; override to change one field. */
function storedDefinition(
  over: Partial<ExistingExamDefinitionForUpdate> = {},
): ExistingExamDefinitionForUpdate {
  return {
    id: DEFINITION_ID,
    kind: "INTERFACE_RIDING",
    name: "רכיבה",
    durationMinutes: 20,
    parallelCapacity: 2,
    requiresInstructedTrainee: false,
    requiresLessonTopic: false,
    requiresDiscipline: false,
    updatedAt: STORED_UPDATED_AT,
    ...over,
  };
}

/** A raw edit submission that genuinely CHANGES the stored row. */
function rawEdit(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "רכיבה מתקדמת",
    durationMinutes: 30,
    parallelCapacity: 2,
    requiresInstructedTrainee: false,
    requiresLessonTopic: false,
    requiresDiscipline: false,
    ...over,
  };
}

/** A raw edit submission that is EXACTLY what the stored row already holds. */
function rawNoOpEdit(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "רכיבה",
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
  readonly plan?: ResolvedExamPlanForUpdate | null;
  readonly existing?: ExistingExamDefinitionForUpdate | null;
  readonly updated?: UpdatedExamDefinitionRecord | null;
  readonly contextThrows?: unknown;
  readonly gateThrows?: unknown;
  readonly planThrows?: unknown;
  readonly readThrows?: unknown;
  readonly updateThrows?: unknown;
}

interface UpdateCall {
  readonly planId: string;
  readonly definitionId: string;
  readonly expectedUpdatedAt: number;
  readonly value: NormalizedExamDefinitionEdit;
}

interface Harness {
  /** Dependency names, in the exact order they were invoked. */
  readonly calls: string[];
  readonly contextArgs: string[];
  readonly gateArgs: string[];
  readonly planLookupArgs: string[];
  readonly readArgs: { planId: string; definitionId: string }[];
  readonly updateArgs: UpdateCall[];
  readonly deps: UpdateExamDefinitionDeps;
}

/**
 * Build a recording fake boundary. The duplicate classifier is the REAL
 * committed one (a pure export of the create slice, reused here exactly as the
 * production binding reuses it); the other two are precise `instanceof` checks —
 * never a catch-all, so a test that expects propagation proves something real.
 */
function harness(options: HarnessOptions = {}): Harness {
  const calls: string[] = [];
  const contextArgs: string[] = [];
  const gateArgs: string[] = [];
  const planLookupArgs: string[] = [];
  const readArgs: { planId: string; definitionId: string }[] = [];
  const updateArgs: UpdateCall[] = [];

  const deps: UpdateExamDefinitionDeps = {
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
    findDefinitionForUpdate: async (planId, definitionId) => {
      calls.push("findDefinitionForUpdate");
      readArgs.push({ planId, definitionId });
      if ("readThrows" in options) throw options.readThrows;
      return options.existing === undefined ? storedDefinition() : options.existing;
    },
    updateDefinitionIfCurrent: async (planId, definitionId, expectedUpdatedAt, value) => {
      calls.push("updateDefinitionIfCurrent");
      updateArgs.push({ planId, definitionId, expectedUpdatedAt, value });
      if ("updateThrows" in options) throw options.updateThrows;
      return options.updated === undefined
        ? { id: DEFINITION_ID, updatedAt: NEXT_UPDATED_AT }
        : options.updated;
    },
    isCourseNotFoundError: (error) => error instanceof FakeCourseNotFoundError,
    isOperationNotAllowedError: (error) => error instanceof FakeOperationDeniedError,
    isDuplicateNameError: isExamDefinitionDuplicateNameError,
  };

  return { calls, contextArgs, gateArgs, planLookupArgs, readArgs, updateArgs, deps };
}

function run(
  options: HarnessOptions = {},
  raw: unknown = rawEdit(),
  expectedUpdatedAt: number = STORED_UPDATED_AT,
  requested: string = REQUESTED_OFFERING_ID,
): { harness: Harness; result: Promise<UpdateExamDefinitionResult> } {
  const h = harness(options);
  return {
    harness: h,
    result: updateExamDefinitionWithDeps(
      requested,
      DEFINITION_ID,
      expectedUpdatedAt,
      raw,
      h.deps,
    ),
  };
}

/** The issue codes of an invalid-input result, or `[]` for anything else. */
function issueCodesOf(outcome: UpdateExamDefinitionResult): string[] {
  if (outcome.ok === false && outcome.code === "invalid_input") {
    return outcome.issues.map((issue) => issue.code);
  }
  return [];
}

// ===========================================================================
// 1. Success
// ===========================================================================

test("1. a successful edit returns changed:true and the NEW version", async () => {
  const { result } = run();
  const outcome = await result;

  assert.deepEqual(outcome, {
    ok: true,
    definitionId: DEFINITION_ID,
    changed: true,
    updatedAt: NEXT_UPDATED_AT,
  });
  assert.deepEqual(Object.keys(outcome).sort(), [
    "changed",
    "definitionId",
    "ok",
    "updatedAt",
  ]);
});

// ===========================================================================
// 2–7. The locked order
// ===========================================================================

test("2. the dependency order is EXACTLY authorize, gate, plan, read, write", async () => {
  const { harness: h, result } = run({ status: "PLANNED" });
  await result;

  assert.deepEqual(h.calls, [
    "requireCourseContext",
    "assertConfigurationAllowed",
    "findExamPlanByCourseOfferingId",
    "findDefinitionForUpdate",
    "updateDefinitionIfCurrent",
  ]);
  assert.deepEqual(h.contextArgs, [REQUESTED_OFFERING_ID]);
  assert.deepEqual(h.gateArgs, ["PLANNED"]);
});

test("2b. validation runs only AFTER course, plan and definition resolution", async () => {
  // Proof by consequence: an INVALID submission still resolves the course, the
  // plan AND the definition first — the diagnostics could not have been produced
  // before them, and no write followed.
  const { harness: h, result } = run({}, rawEdit({ durationMinutes: 0 }));
  const outcome = await result;

  assert.equal(outcome.ok, false);
  assert.deepEqual(h.calls, [
    "requireCourseContext",
    "assertConfigurationAllowed",
    "findExamPlanByCourseOfferingId",
    "findDefinitionForUpdate",
  ]);
});

test("3. the VERIFIED offering id is what the plan lookup receives", async () => {
  const { harness: h, result } = run();
  await result;

  assert.deepEqual(h.planLookupArgs, [VERIFIED_OFFERING_ID]);
  // The RAW requested id reached the boundary once and was never reused.
  assert.deepEqual(h.contextArgs, [REQUESTED_OFFERING_ID]);
  assert.equal(h.planLookupArgs.includes(REQUESTED_OFFERING_ID), false);
  assert.equal(
    h.readArgs.some((call) => call.planId === REQUESTED_OFFERING_ID),
    false,
  );
  assert.equal(
    h.updateArgs.some((call) => call.planId === REQUESTED_OFFERING_ID),
    false,
  );
});

test("4. the SERVER plan id is what the definition read and the write receive", async () => {
  const { harness: h, result } = run({ plan: { id: SERVER_PLAN_ID } });
  await result;

  assert.deepEqual(h.readArgs, [{ planId: SERVER_PLAN_ID, definitionId: DEFINITION_ID }]);
  assert.deepEqual(
    h.updateArgs.map((call) => ({ planId: call.planId, definitionId: call.definitionId })),
    [{ planId: SERVER_PLAN_ID, definitionId: DEFINITION_ID }],
  );
});

test("5. a foreign-plan definition is INDISTINGUISHABLE from a missing one", async () => {
  const OTHER_PLAN_ID = "plan-of-another-course";
  // A reader that HONOURS its plan scope, driven for an offering whose plan is a
  // different one: the definition exists, but not under this plan.
  const h = harness({ plan: { id: OTHER_PLAN_ID } });
  const scoped: UpdateExamDefinitionDeps = {
    ...h.deps,
    findDefinitionForUpdate: async (planId) =>
      planId === SERVER_PLAN_ID ? storedDefinition() : null,
  };
  const foreign = await updateExamDefinitionWithDeps(
    REQUESTED_OFFERING_ID,
    DEFINITION_ID,
    STORED_UPDATED_AT,
    rawEdit(),
    scoped,
  );
  const missing = await run({ existing: null }).result;

  // The identical result — otherwise the refusal would reveal that some OTHER
  // course holds that definition.
  assert.deepEqual(foreign, { ok: false, code: "definition_not_found" });
  assert.deepEqual(foreign, missing);
  assert.equal(JSON.stringify(foreign).includes(OTHER_PLAN_ID), false);
  assert.deepEqual(h.updateArgs, []);
});

test("6. a missing plan returns plan_not_found and skips everything after it", async () => {
  // Even an INVALID submission stops at the plan: no diagnostics are produced,
  // so an unauthorized-shaped request learns nothing about the input rules.
  const { harness: h, result } = run({ plan: null }, rawEdit({ name: "" }));
  const outcome = await result;

  assert.deepEqual(outcome, { ok: false, code: "plan_not_found" });
  assert.deepEqual(h.calls, [
    "requireCourseContext",
    "assertConfigurationAllowed",
    "findExamPlanByCourseOfferingId",
  ]);
  assert.deepEqual(h.updateArgs, []);
});

test("7. a missing definition returns definition_not_found and causes NO write", async () => {
  const { harness: h, result } = run({ existing: null }, rawEdit({ name: "" }));
  const outcome = await result;

  assert.deepEqual(outcome, { ok: false, code: "definition_not_found" });
  assert.deepEqual(h.calls, [
    "requireCourseContext",
    "assertConfigurationAllowed",
    "findExamPlanByCourseOfferingId",
    "findDefinitionForUpdate",
  ]);
  assert.deepEqual(h.updateArgs, []);
});

// ===========================================================================
// 8–9. The concurrency token
// ===========================================================================

test("8. an invalid expectedUpdatedAt is refused, and causes NO write", async () => {
  const { harness: h, result } = run({}, rawEdit(), Number.NaN);
  const outcome = await result;

  assert.equal(outcome.ok, false);
  assert.equal(outcome.ok === false && outcome.code, "invalid_input");
  assert.deepEqual(issueCodesOf(outcome), ["EX-DEF-VERSION-INVALID"]);
  assert.deepEqual(h.updateArgs, []);
});

test("9. a string, NaN, Infinity, fractional or negative token is refused", async () => {
  const rejected: unknown[] = [
    "1700000000000",
    "",
    " ",
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    1_700_000_000_000.5,
    -1,
    -0.5,
    null,
    undefined,
    {},
    [],
    true,
  ];
  for (const token of rejected) {
    const h = harness();
    const outcome = await updateExamDefinitionWithDeps(
      REQUESTED_OFFERING_ID,
      DEFINITION_ID,
      token as number,
      rawEdit(),
      h.deps,
    );
    const label = token === undefined ? "undefined" : JSON.stringify(token);
    assert.deepEqual(issueCodesOf(outcome), ["EX-DEF-VERSION-INVALID"], `accepted ${label}`);
    assert.deepEqual(h.updateArgs, [], `a write ran for ${label}`);
    // ...and the REAL predicate agrees, independently of the orchestration.
    assert.equal(isExamDefinitionVersionToken(token), false, `predicate accepted ${label}`);
  }

  // The boundary values that ARE usable.
  for (const token of [0, 1, STORED_UPDATED_AT, Number.MAX_SAFE_INTEGER]) {
    assert.equal(isExamDefinitionVersionToken(token), true, `predicate rejected ${token}`);
  }
});

// ===========================================================================
// 10–15. Input validation, and the immutability of kind
// ===========================================================================

test("10. invalid edit input returns invalid_input with the COMMITTED issue codes", async () => {
  const { harness: h, result } = run(
    {},
    rawEdit({ name: "   ", durationMinutes: "30", parallelCapacity: -1 }),
  );
  const outcome = await result;

  assert.deepEqual(issueCodesOf(outcome), [
    "EX-DEF-NAME-REQUIRED",
    "EX-DEF-INVALID-DURATION",
    "EX-DEF-INVALID-CAPACITY",
  ]);
  // Every issue carries a code and a message and nothing else — no submitted
  // value is ever echoed back.
  if (outcome.ok === false && outcome.code === "invalid_input") {
    for (const issue of outcome.issues) {
      assert.deepEqual(Object.keys(issue).sort(), ["code", "message"]);
      assert.ok(issue.message.length > 0);
    }
    assert.equal(JSON.stringify(outcome.issues).includes("30"), false);
  }
  assert.deepEqual(h.updateArgs, []);
});

test("11. a raw `kind` property is REFUSED rather than silently ignored", async () => {
  const { harness: h, result } = run({}, rawEdit({ kind: "INTERFACE_RIDING" }));
  const outcome = await result;

  assert.deepEqual(issueCodesOf(outcome), ["EX-DEF-KIND-NOT-EDITABLE"]);
  assert.deepEqual(h.updateArgs, []);
});

test("12. BEGINNER_INSTRUCTION cannot be submitted through an edit", async () => {
  // It is refused for being a SUBMITTED kind at all — the stored kind is what
  // validation runs against, so the beginner projection can never become a
  // stored definition through this path.
  const { harness: h, result } = run({}, rawEdit({ kind: "BEGINNER_INSTRUCTION" }));
  const outcome = await result;

  assert.deepEqual(issueCodesOf(outcome), ["EX-DEF-KIND-NOT-EDITABLE"]);
  assert.deepEqual(h.updateArgs, []);
  assert.equal(JSON.stringify(outcome).includes("BEGINNER"), false);

  // And a definition whose STORED kind is the beginner one fails closed: the
  // committed validator refuses to normalize an edit against an unstorable kind.
  const closed = await run(
    { existing: storedDefinition({ kind: "BEGINNER_INSTRUCTION" }) },
    rawEdit(),
  ).result;
  assert.deepEqual(issueCodesOf(closed), ["EX-DEF-KIND-NOT-STORABLE"]);
});

test("13. the AUTHORITATIVE stored kind is what drives validation", async () => {
  // The SAME submission is valid under one stored kind and invalid under
  // another, which is only possible if the stored kind is what is consulted.
  const advanced = await run(
    { existing: storedDefinition({ kind: "ADVANCED_INSTRUCTION" }) },
    rawEdit({ requiresLessonTopic: true, requiresInstructedTrainee: true }),
  ).result;
  assert.equal(advanced.ok, true);

  const riding = await run(
    { existing: storedDefinition({ kind: "INTERFACE_RIDING" }) },
    rawEdit({ requiresLessonTopic: true, requiresInstructedTrainee: true }),
  ).result;
  assert.deepEqual(issueCodesOf(riding), [
    "EX-DEF-INSTRUCTED-NOT-APPLICABLE",
    "EX-DEF-TOPIC-NOT-APPLICABLE",
  ]);
});

test("14. `kind` never reaches the update dependency", async () => {
  const { harness: h, result } = run(
    { existing: storedDefinition({ kind: "ADVANCED_INSTRUCTION" }) },
    rawEdit(),
  );
  await result;

  const [call] = h.updateArgs;
  assert.equal("kind" in call.value, false);
  assert.equal(JSON.stringify(call.value).includes("ADVANCED_INSTRUCTION"), false);
  assert.equal(JSON.stringify(call.value).includes("INTERFACE_RIDING"), false);
});

test("15. `orderIndex`, `planId` and `id` never reach the update payload", async () => {
  const { harness: h, result } = run(
    {},
    rawEdit({ orderIndex: 999, planId: "plan-forged-by-caller", id: "definition-forged" }),
  );
  const outcome = await result;

  assert.equal(outcome.ok, true);
  const [call] = h.updateArgs;
  for (const forbidden of ["orderIndex", "planId", "id", "kind", "updatedAt", "createdAt"]) {
    assert.equal(forbidden in call.value, false, `${forbidden} entered the payload`);
  }
  assert.equal(JSON.stringify(call.value).includes("999"), false);
  assert.equal(JSON.stringify(call.value).includes("forged"), false);
  // The write is still scoped by the SERVER plan, not the forged one.
  assert.equal(call.planId, SERVER_PLAN_ID);
});

// ===========================================================================
// 16–19. The no-op edit
// ===========================================================================

test("16. an edit equal to the stored row returns changed:false", async () => {
  const { result } = run({}, rawNoOpEdit());
  assert.deepEqual(await result, {
    ok: true,
    definitionId: DEFINITION_ID,
    changed: false,
    updatedAt: STORED_UPDATED_AT,
  });
});

test("17. a no-op performs ZERO update calls", async () => {
  const { harness: h, result } = run({}, rawNoOpEdit());
  await result;

  assert.deepEqual(h.calls, [
    "requireCourseContext",
    "assertConfigurationAllowed",
    "findExamPlanByCourseOfferingId",
    "findDefinitionForUpdate",
  ]);
  assert.deepEqual(h.updateArgs, []);

  // Whitespace-only differences are normalized away, so they are no-ops too.
  const trimmed = harness();
  await updateExamDefinitionWithDeps(
    REQUESTED_OFFERING_ID,
    DEFINITION_ID,
    STORED_UPDATED_AT,
    rawNoOpEdit({ name: "  רכיבה  " }),
    trimmed.deps,
  );
  assert.deepEqual(trimmed.updateArgs, []);

  // ...but a real rename is NOT a no-op, and the comparison is case- and
  // character-exact rather than folded.
  const renamed = harness();
  await updateExamDefinitionWithDeps(
    REQUESTED_OFFERING_ID,
    DEFINITION_ID,
    STORED_UPDATED_AT,
    rawNoOpEdit({ name: "רכיבה!" }),
    renamed.deps,
  );
  assert.equal(renamed.updateArgs.length, 1);
});

test("18. a no-op preserves the AUTHORITATIVE updatedAt, not the submitted token", async () => {
  // A STALE but well-formed token on a genuine no-op still succeeds, and the
  // version reported back is the CURRENT one — so a re-submission carries a
  // token the database will recognize.
  const { harness: h, result } = run({}, rawNoOpEdit(), STORED_UPDATED_AT - 5_000);
  const outcome = await result;

  assert.deepEqual(outcome, {
    ok: true,
    definitionId: DEFINITION_ID,
    changed: false,
    updatedAt: STORED_UPDATED_AT,
  });
  assert.deepEqual(h.updateArgs, []);

  // A MALFORMED token is still refused, even for a no-op: the request itself is
  // malformed, which is a different thing from a conflict.
  const malformed = await run({}, rawNoOpEdit(), Number.NaN).result;
  assert.deepEqual(issueCodesOf(malformed), ["EX-DEF-VERSION-INVALID"]);
});

test("19. a real edit reports the version the WRITE returned", async () => {
  const { result } = run({ updated: { id: DEFINITION_ID, updatedAt: NEXT_UPDATED_AT } });
  const outcome = await result;

  assert.equal(outcome.ok === true && outcome.updatedAt, NEXT_UPDATED_AT);
  assert.notEqual(outcome.ok === true && outcome.updatedAt, STORED_UPDATED_AT);
});

// ===========================================================================
// 20–22. Stale writes and the duplicate-name classifier
// ===========================================================================

test("20. a write that matched nothing returns stale_write", async () => {
  const { harness: h, result } = run({ updated: null });
  const outcome = await result;

  assert.deepEqual(outcome, { ok: false, code: "stale_write" });
  // The token the caller supplied is what the write was asked to match — the
  // core never compares versions itself.
  assert.deepEqual(
    h.updateArgs.map((call) => call.expectedUpdatedAt),
    [STORED_UPDATED_AT],
  );
});

test("21. a P2002 name conflict maps to duplicate_name", async () => {
  for (const target of [
    ["planId", "name"],
    "exam_definitions_planId_name_key",
    undefined,
    null,
  ]) {
    const { result } = run({ updateThrows: duplicateNameError(target) });
    assert.deepEqual(
      await result,
      { ok: false, code: "duplicate_name" },
      `target ${JSON.stringify(target)} was not classified`,
    );
  }
});

test("22. an UNRELATED P2002 propagates unchanged", async () => {
  // The sibling `[planId, id]` unique key cannot be violated by an update that
  // changes neither column, so a P2002 naming it is a real defect.
  for (const thrown of [
    duplicateNameError(["planId", "id"]),
    duplicateNameError("exam_definitions_planId_id_key"),
    { code: "P2025" },
    { code: "P2003" },
  ]) {
    await assert.rejects(
      () => run({ updateThrows: thrown }).result,
      (error) => error === thrown,
      `${JSON.stringify(thrown)} was swallowed`,
    );
  }
});

// ===========================================================================
// 23–26. Denials and propagation
// ===========================================================================

test("23. a course not-found maps to offering_not_found and skips everything", async () => {
  const { harness: h, result } = run({ contextThrows: new FakeCourseNotFoundError() });
  assert.deepEqual(await result, { ok: false, code: "offering_not_found" });

  assert.deepEqual(h.calls, ["requireCourseContext"]);
  assert.deepEqual(h.gateArgs, []);
  assert.deepEqual(h.planLookupArgs, []);
  assert.deepEqual(h.readArgs, []);
  assert.deepEqual(h.updateArgs, []);
});

test("24. a lifecycle denial maps to operation_not_allowed and skips every exam call", async () => {
  const { harness: h, result } = run({
    status: "ARCHIVED",
    gateThrows: new FakeOperationDeniedError(),
  });
  assert.deepEqual(await result, { ok: false, code: "operation_not_allowed" });

  assert.deepEqual(h.calls, ["requireCourseContext", "assertConfigurationAllowed"]);
  assert.deepEqual(h.planLookupArgs, []);
  assert.deepEqual(h.readArgs, []);
  assert.deepEqual(h.updateArgs, []);
});

test("25. a REDIRECT-shaped error propagates unchanged from EVERY dependency", async () => {
  const redirect = redirectLikeError();
  const paths: (readonly [string, HarnessOptions])[] = [
    ["requireCourseContext", { contextThrows: redirect }],
    ["assertConfigurationAllowed", { gateThrows: redirect }],
    ["findExamPlanByCourseOfferingId", { planThrows: redirect }],
    ["findDefinitionForUpdate", { readThrows: redirect }],
    ["updateDefinitionIfCurrent", { updateThrows: redirect }],
  ];
  for (const [dependency, options] of paths) {
    await assert.rejects(
      () => run(options).result,
      (error) => error === redirect,
      `${dependency} swallowed the redirect`,
    );
  }
});

test("26. an unexpected plan, read or write error propagates unchanged", async () => {
  const paths: (readonly [string, (boom: Error) => HarnessOptions])[] = [
    ["plan", (boom) => ({ planThrows: boom })],
    ["read", (boom) => ({ readThrows: boom })],
    ["write", (boom) => ({ updateThrows: boom })],
  ];
  for (const [label, build] of paths) {
    const boom = new Error("infrastructure is down");
    const { harness: h, result } = run(build(boom));
    await assert.rejects(
      () => result,
      (error) => error === boom,
      `the ${label} error was swallowed`,
    );
    if (label !== "write") assert.deepEqual(h.updateArgs, []);
  }

  // A harness whose classifiers ALL say "no" must propagate every throw — proof
  // that the refusals come from the classifiers, not from a bare catch.
  const courseError = new FakeCourseNotFoundError();
  const gateError = new FakeOperationDeniedError();
  const writeError = duplicateNameError();
  const declining: (readonly [HarnessOptions, unknown])[] = [
    [{ contextThrows: courseError }, courseError],
    [{ gateThrows: gateError }, gateError],
    [{ updateThrows: writeError }, writeError],
  ];
  for (const [options, thrown] of declining) {
    const h = harness(options);
    const deps: UpdateExamDefinitionDeps = {
      ...h.deps,
      isCourseNotFoundError: () => false,
      isOperationNotAllowedError: () => false,
      isDuplicateNameError: () => false,
    };
    await assert.rejects(
      () =>
        updateExamDefinitionWithDeps(
          REQUESTED_OFFERING_ID,
          DEFINITION_ID,
          STORED_UPDATED_AT,
          rawEdit(),
          deps,
        ),
      (error) => error === thrown,
    );
  }
});

// ===========================================================================
// 27–32. The result model
// ===========================================================================

/** Every distinct result this core can produce. */
async function everyResult(): Promise<UpdateExamDefinitionResult[]> {
  return [
    await run().result,
    await run({}, rawNoOpEdit()).result,
    await run({ contextThrows: new FakeCourseNotFoundError() }).result,
    await run({ gateThrows: new FakeOperationDeniedError() }).result,
    await run({ plan: null }).result,
    await run({ existing: null }).result,
    await run({}, rawEdit(), Number.NaN).result,
    await run({}, rawEdit({ name: "" })).result,
    await run({ updateThrows: duplicateNameError() }).result,
    await run({ updated: null }).result,
  ];
}

test("27. no raw Prisma-like field enters any result", async () => {
  for (const outcome of await everyResult()) {
    for (const forbidden of [
      "createdAt",
      "publishedAt",
      "orderIndex",
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
      "target",
    ]) {
      assert.equal(
        JSON.stringify(outcome).includes(`"${forbidden}"`),
        false,
        `${forbidden} leaked into ${JSON.stringify(outcome)}`,
      );
    }
  }
});

test("28. no plan, course, actor identifier or submitted name enters any result", async () => {
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
      "רכיבה",
    ]) {
      assert.equal(serialized.includes(secret), false, `${secret} leaked into ${serialized}`);
    }
  }
});

test("29. every result is a plain object and deep-equals its JSON round trip", async () => {
  for (const outcome of await everyResult()) {
    assert.equal(Object.getPrototypeOf(outcome), Object.prototype);
    assert.equal(outcome instanceof Error, false);
    assert.deepEqual(JSON.parse(JSON.stringify(outcome)), outcome);
    if (outcome.ok === false && outcome.code === "invalid_input") {
      assert.ok(Array.isArray(outcome.issues));
      for (const issue of outcome.issues) {
        assert.equal(Object.getPrototypeOf(issue), Object.prototype);
      }
    }
  }
});

test("30. no result carries an undefined property value", async () => {
  for (const outcome of await everyResult()) {
    const record = outcome as unknown as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      assert.notEqual(record[key], undefined, `${key} is undefined`);
    }
    // `issues` exists ONLY on invalid_input — never as an undefined placeholder.
    const hasIssues = Object.prototype.hasOwnProperty.call(record, "issues");
    assert.equal(hasIssues, outcome.ok === false && outcome.code === "invalid_input");
    // `changed` and `updatedAt` exist ONLY on success.
    assert.equal(Object.prototype.hasOwnProperty.call(record, "changed"), outcome.ok);
    assert.equal(Object.prototype.hasOwnProperty.call(record, "updatedAt"), outcome.ok);
  }
});

test("31. every result, and every issue array, is FROZEN", async () => {
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

test("32. the raw input is never modified, and a FROZEN raw input is supported", async () => {
  const raw = rawEdit({ name: "  רכיבה מתקדמת  " });
  const snapshot = JSON.parse(JSON.stringify(raw));
  const { harness: h, result } = run({}, raw);
  await result;

  assert.deepEqual(raw, snapshot);
  assert.equal(h.updateArgs[0].value.name, "רכיבה מתקדמת");
  assert.equal(raw.name, "  רכיבה מתקדמת  ");

  const frozen = Object.freeze(rawEdit());
  assert.equal((await run({}, frozen).result).ok, true);
});

// ===========================================================================
// 33–36. Call discipline, independence, publication and notifications
// ===========================================================================

test("33. no dependency is invoked more than once, on ANY path", async () => {
  const paths: (readonly [HarnessOptions, unknown, number])[] = [
    [{}, rawEdit(), STORED_UPDATED_AT],
    [{}, rawNoOpEdit(), STORED_UPDATED_AT],
    [{}, rawEdit(), Number.NaN],
    [{}, rawEdit({ name: "" }), STORED_UPDATED_AT],
    [{ contextThrows: new FakeCourseNotFoundError() }, rawEdit(), STORED_UPDATED_AT],
    [{ gateThrows: new FakeOperationDeniedError() }, rawEdit(), STORED_UPDATED_AT],
    [{ plan: null }, rawEdit(), STORED_UPDATED_AT],
    [{ existing: null }, rawEdit(), STORED_UPDATED_AT],
    [{ updated: null }, rawEdit(), STORED_UPDATED_AT],
    [{ updateThrows: duplicateNameError() }, rawEdit(), STORED_UPDATED_AT],
  ];
  for (const [options, raw, token] of paths) {
    const { harness: h, result } = run(options, raw, token);
    await result;
    assert.equal(
      new Set(h.calls).size,
      h.calls.length,
      `a dependency repeated for ${JSON.stringify(options)}: ${h.calls.join(" -> ")}`,
    );
  }
});

test("34. two definitions of the same kind stay independent: no cross-call state", async () => {
  const shared = harness();
  const first = await updateExamDefinitionWithDeps(
    REQUESTED_OFFERING_ID,
    DEFINITION_ID,
    STORED_UPDATED_AT,
    rawEdit({ name: "רכיבה מתקדמת" }),
    shared.deps,
  );
  const second = await updateExamDefinitionWithDeps(
    REQUESTED_OFFERING_ID,
    DEFINITION_ID,
    STORED_UPDATED_AT,
    rawEdit({ name: "ממשק" }),
    shared.deps,
  );

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.deepEqual(first, second, "the module derives nothing from call history");
  assert.deepEqual(
    shared.updateArgs.map((call) => call.value.name),
    ["רכיבה מתקדמת", "ממשק"],
  );
  assert.deepEqual([...new Set(shared.updateArgs.map((call) => call.planId))], [SERVER_PLAN_ID]);
});

test("35. a PUBLISHED plan does not block, alter or branch the edit", async () => {
  // The resolved plan carries an id and nothing else, so publication cannot be
  // consulted even if a dependency volunteered it.
  const published = harness({
    plan: { id: SERVER_PLAN_ID, publishedAt: 1_699_000_000_000 } as ResolvedExamPlanForUpdate,
  });
  const outcome = await updateExamDefinitionWithDeps(
    REQUESTED_OFFERING_ID,
    DEFINITION_ID,
    STORED_UPDATED_AT,
    // A duration change — precisely the edit a published-plan rule would block.
    rawEdit({ durationMinutes: 45 }),
    published.deps,
  );

  assert.equal(outcome.ok, true);
  assert.equal(outcome.ok === true && outcome.changed, true);
  assert.equal(published.updateArgs[0].value.durationMinutes, 45);
  assert.equal(JSON.stringify(outcome).includes("published"), false);
});

test("36. the dependency surface offers no publication or notification effect", async () => {
  // Proof by enumeration: these are ALL the effects the operation can reach.
  const { deps } = harness();
  assert.deepEqual(Object.keys(deps).sort(), [
    "assertConfigurationAllowed",
    "findDefinitionForUpdate",
    "findExamPlanByCourseOfferingId",
    "isCourseNotFoundError",
    "isDuplicateNameError",
    "isOperationNotAllowedError",
    "requireCourseContext",
    "updateDefinitionIfCurrent",
  ]);
});

// ===========================================================================
// Structural guards on the pure core
// ===========================================================================

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const EXAM_DIR = join(REPO_ROOT, "lib", "exam");
const MODULE_NAME = "update-exam-definition-core.ts";
const TEST_NAME = "update-exam-definition-core.test.ts";
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

test("U1. the pure core imports no database client and performs no IO", () => {
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

test("U2. the pure core imports no auth, session, cookie or course implementation", () => {
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

test("U3. the pure core is neither server-only nor a Server Action module", () => {
  assert.equal(CODE.includes("server" + "-only"), false);
  assert.equal(CODE.includes('"use ' + 'server"'), false);
  assert.equal(CODE.includes("'use " + "server'"), false);
  assert.equal(CODE.includes('"use ' + 'client"'), false);
  assert.equal(/import\s+["']server/.test(SOURCE), false);
  assert.ok(COMMENTS.includes("server" + "-only"), "the rule is undocumented");
});

test("U4. the pure core consults no capability of any kind", () => {
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

test("U5. the pure core imports ONLY sibling pure exam cores", () => {
  const specifiers = [...CODE.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.ok(specifiers.length > 0, "sanity: the module should import something");
  for (const specifier of specifiers) {
    assert.ok(specifier.startsWith("./exam-"), `the pure core imports ${specifier}`);
  }
  assert.deepEqual(
    [...new Set(specifiers)].sort(),
    ["./exam-definition-write-core", "./exam-domain-core"],
  );
});

test("U6. the committed normalizer is CALLED rather than having its rules copied", () => {
  assert.ok(
    /\bnormalizeExamDefinitionEditInput\s*\(/.test(CODE),
    "the pure core does not call the committed edit normalizer",
  );
  for (const token of [
    "isPositiveInteger",
    "isStorableExamKind",
    "isPresentText",
    "INTERFACE_RIDING",
    "LUNGE_NO_RIDER",
    "ADVANCED_INSTRUCTION",
    "BEGINNER_INSTRUCTION",
    ".trim(",
    ".toLowerCase(",
    ".normalize(",
    "localeCompare",
  ]) {
    assert.equal(CODE.includes(token), false, `the pure core restates ${token}`);
  }
});

test("U7. no exported function accepts a plan, kind, order, actor or transaction argument", () => {
  const signatures = [
    ...SOURCE.matchAll(/export (?:async )?function (\w+)\(([\s\S]*?)\):/g),
  ].map(([, name, params]) => ({ name, params: params.replace(/\s+/g, " ").trim() }));

  assert.deepEqual(
    signatures.map((signature) => signature.name),
    ["isExamDefinitionVersionToken", "updateExamDefinitionWithDeps"],
  );
  const orchestration = signatures.find((s) => s.name === "updateExamDefinitionWithDeps");
  assert.ok(orchestration);
  assert.equal(
    orchestration.params,
    "courseOfferingId: string, definitionId: string, expectedUpdatedAt: number, rawInput: unknown, deps: UpdateExamDefinitionDeps,",
  );
  for (const forbidden of ["planId", "kind", "orderIndex", "adminId", "actorId", "prisma", "tx:"]) {
    assert.equal(
      orchestration.params.includes(forbidden),
      false,
      `the orchestration accepts ${forbidden}`,
    );
  }
});

test("U8. the pure core has no clock, Date, randomness, env or process access", () => {
  // A Date must never appear in a signature or a result: the token is epoch
  // milliseconds, and the conversion happens in the IO layer alone.
  for (const pattern of [
    /\bDate\b/,
    /Date\.now\b/,
    /Math\.random\b/,
    /process\./,
    /globalThis/,
  ]) {
    assert.equal(pattern.test(CODE), false, `the pure core uses ${pattern}`);
  }
});

test("U9. the pure core can neither create, delete, reorder, publish nor notify", () => {
  for (const token of [
    "createPlan",
    "upsertPlan",
    "ensurePlan",
    "createExamPlan",
    "createDefinition",
    "deleteDefinition",
    "publish",
    "unpublish",
    "notify",
    "notification",
    "reorder",
    "archive",
    "countSessions",
    "examSession",
  ]) {
    assert.equal(CODE.includes(token), false, `the pure core exposes ${token}`);
  }
});

test("U10. no result code beyond the approved outcomes exists", () => {
  const codes = [...CODE.matchAll(/refuse\("([a-z_]+)"\)|code: "([a-z_]+)"/g)]
    .map((match) => match[1] ?? match[2])
    .filter((code): code is string => typeof code === "string");
  assert.deepEqual(
    [...new Set(codes)].sort(),
    [
      "definition_not_found",
      "duplicate_name",
      "invalid_input",
      "offering_not_found",
      "operation_not_allowed",
      "plan_not_found",
      "stale_write",
    ],
  );
  for (const token of ["unexpected", "definition_in_use", "reorder_conflict", "plan_published"]) {
    assert.equal(CODE.includes(token), false, `the pure core invents ${token}`);
  }
});

test("U11. the no-op decision is documented, and compares only the six editable fields", () => {
  assert.ok(/no-op/i.test(COMMENTS), "the no-op rule is undocumented");
  assert.ok(/stale/i.test(COMMENTS), "the stale-token-on-no-op decision is undocumented");

  const start = CODE.indexOf("function isUnchanged");
  assert.ok(start > 0, "the comparison helper is missing");
  const body = CODE.slice(start, CODE.indexOf("\n}", start));
  for (const field of [
    "name",
    "durationMinutes",
    "parallelCapacity",
    "requiresInstructedTrainee",
    "requiresLessonTopic",
    "requiresDiscipline",
  ]) {
    assert.ok(body.includes(`existing.${field} === value.${field}`), `${field} is not compared`);
  }
  for (const forbidden of ["kind", "orderIndex", "updatedAt", "createdAt", "planId"]) {
    assert.equal(body.includes(forbidden), false, `the no-op rule compares ${forbidden}`);
  }
});

test("U12. the slice's two lib/exam files are exactly the approved pair", () => {
  const sliceFiles = readdirSync(EXAM_DIR)
    .filter((name) => name.startsWith("update-exam-definition-core"))
    .sort();
  assert.deepEqual(sliceFiles, [MODULE_NAME, TEST_NAME].sort());
});
