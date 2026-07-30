/**
 * EXAM PLAN P1 — executable tests for the PURE, IDEMPOTENT ExamPlan CREATE
 * orchestration (create-exam-plan-core.ts).
 *
 * Run with: npx tsx --test lib/exam/create-exam-plan-core.test.ts
 *
 * DB-FREE: every dependency is a fake, no database connection is opened, no SQL
 * is executed, and no production identifier appears anywhere. The only files read
 * are module SOURCE TEXTS, by the structural guards at the bottom, which also ask
 * `git` whether the slice modified anything.
 *
 * SCOPE OF PROOF:
 *   - the LOCKED ORDER: authorize -> gate -> look -> create, and, for every
 *     failure, exactly WHICH later dependencies are skipped;
 *   - that the VERIFIED offering id (never the requested one) reaches the lookup
 *     and the write;
 *   - that an ALREADY-EXISTING plan is an idempotent SUCCESS performing zero
 *     writes, and that a concurrent winner's P2002 is the SAME success;
 *   - that a conflict whose re-read finds nothing is reported honestly rather
 *     than retried, invented or hidden;
 *   - that `createExamPlanForCourseOffering` runs AT MOST ONCE on every path;
 *   - the result model: narrow, plain, frozen, JSON-round-trippable, non-echoing;
 *   - that only the three known failures are classified and everything else —
 *     including a redirect-shaped throw — propagates unchanged;
 *   - the structural promises: no Prisma, no auth, no Next, no capability, no IO,
 *     no publication, no source date, no delete, no update, no upsert, and no
 *     import of any kind in the pure core.
 *
 * NOTE ON IDS: the fixtures use obviously-fake, hyphenated ids. No cuid-shaped
 * literal and no production identifier is written here, which the committed
 * exam-slice guards enforce over every file in this directory.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";

import {
  createExamPlanWithDeps,
  isExamPlanOfferingConflictError,
  type CreateExamPlanDeps,
  type CreateExamPlanResult,
  type ResolvedExamPlan,
} from "./create-exam-plan-core";

// ===========================================================================
// Fixtures
// ===========================================================================

/** What the caller ASKS for. Deliberately different from what is verified. */
const REQUESTED_OFFERING_ID = "offering-as-requested";
/** What the boundary VERIFIED. Only this may reach the lookup and the write. */
const VERIFIED_OFFERING_ID = "offering-as-verified";

/** The plan a repeated call finds already sitting there. */
const EXISTING_PLAN_ID = "plan-that-already-existed";
/** The plan THIS call brings into existence. */
const NEW_PLAN_ID = "plan-created-by-this-call";
/** The plan a concurrent manager created first, read back after the conflict. */
const WINNER_PLAN_ID = "plan-created-by-the-race-winner";

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

/** A Prisma-shaped unique violation on the plan's one-per-offering key. */
function offeringConflictError(target: unknown = ["courseOfferingId"]): unknown {
  return { code: "P2002", meta: { target } };
}

interface HarnessOptions {
  readonly status?: string;
  /** The FIRST lookup's answer. Defaults to `null` — i.e. the create path. */
  readonly plan?: ResolvedExamPlan | null;
  /** The CONFLICT re-read's answer. Defaults to `null`. */
  readonly planAfterConflict?: ResolvedExamPlan | null;
  readonly created?: ResolvedExamPlan;
  readonly contextThrows?: unknown;
  readonly gateThrows?: unknown;
  readonly findThrows?: unknown;
  readonly reReadThrows?: unknown;
  readonly createThrows?: unknown;
}

interface Harness {
  /** Dependency names, in the exact order they were invoked. */
  readonly calls: string[];
  readonly contextArgs: string[];
  readonly gateArgs: string[];
  readonly findArgs: string[];
  readonly createArgs: string[];
  readonly deps: CreateExamPlanDeps;
}

/**
 * Build a recording fake boundary. The conflict classifier is the REAL one (a pure
 * export of the module under test) and the other two are precise `instanceof`
 * checks — never a catch-all, so a test that expects propagation is proving
 * something real.
 */
function harness(options: HarnessOptions = {}): Harness {
  const calls: string[] = [];
  const contextArgs: string[] = [];
  const gateArgs: string[] = [];
  const findArgs: string[] = [];
  const createArgs: string[] = [];

  const deps: CreateExamPlanDeps = {
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
      findArgs.push(verifiedCourseOfferingId);
      // A lookup that happens AFTER a write attempt is the conflict RE-READ; the
      // ordinary existence check always precedes one. Keyed on the write rather
      // than on a call counter, so a bundle reused across invocations keeps
      // answering the existence check with the same plan.
      if (createArgs.length > 0) {
        if ("reReadThrows" in options) throw options.reReadThrows;
        return options.planAfterConflict === undefined ? null : options.planAfterConflict;
      }
      if ("findThrows" in options) throw options.findThrows;
      return options.plan === undefined ? null : options.plan;
    },
    createExamPlanForCourseOffering: async (verifiedCourseOfferingId) => {
      calls.push("createExamPlanForCourseOffering");
      createArgs.push(verifiedCourseOfferingId);
      if ("createThrows" in options) throw options.createThrows;
      return options.created ?? { id: NEW_PLAN_ID };
    },
    isCourseNotFoundError: (error) => error instanceof FakeCourseNotFoundError,
    isOperationNotAllowedError: (error) => error instanceof FakeOperationDeniedError,
    isPlanCourseOfferingUniqueConflict: isExamPlanOfferingConflictError,
  };

  return { calls, contextArgs, gateArgs, findArgs, createArgs, deps };
}

function run(
  options: HarnessOptions = {},
  requested: string = REQUESTED_OFFERING_ID,
): { harness: Harness; result: Promise<CreateExamPlanResult> } {
  const h = harness(options);
  return { harness: h, result: createExamPlanWithDeps(requested, h.deps) };
}

/** Count how many times each dependency name was invoked. */
function callCounts(calls: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const call of calls) counts.set(call, (counts.get(call) ?? 0) + 1);
  return counts;
}

// ===========================================================================
// 1–3. The two ways this operation succeeds
// ===========================================================================

test("1. a fresh create returns ONLY planId + created:true", async () => {
  const { result } = run();
  const outcome = await result;

  assert.deepEqual(outcome, { ok: true, planId: NEW_PLAN_ID, created: true });
  assert.deepEqual(Object.keys(outcome).sort(), ["created", "ok", "planId"]);
});

test("2. an EXISTING plan is an idempotent SUCCESS with created:false", async () => {
  const { result } = run({ plan: { id: EXISTING_PLAN_ID } });
  const outcome = await result;

  assert.deepEqual(outcome, { ok: true, planId: EXISTING_PLAN_ID, created: false });
  // The very same shape a fresh create produces — only `created` differs.
  assert.deepEqual(Object.keys(outcome).sort(), ["created", "ok", "planId"]);
});

test("3. an EXISTING plan causes ZERO create calls", async () => {
  const { harness: h, result } = run({ plan: { id: EXISTING_PLAN_ID } });
  await result;

  assert.deepEqual(h.createArgs, [], "a write ran for an already-existing plan");
  assert.deepEqual(h.calls, [
    "requireCourseContext",
    "assertConfigurationAllowed",
    "findExamPlanByCourseOfferingId",
  ]);
});

test("4. calling twice against an existing plan is stable and still writes nothing", async () => {
  // Idempotence as a manager experiences it: a double-click, or two open tabs.
  const shared = harness({ plan: { id: EXISTING_PLAN_ID } });
  const first = await createExamPlanWithDeps(REQUESTED_OFFERING_ID, shared.deps);
  const second = await createExamPlanWithDeps(REQUESTED_OFFERING_ID, shared.deps);

  assert.deepEqual(first, { ok: true, planId: EXISTING_PLAN_ID, created: false });
  assert.deepEqual(second, first, "a repeated request produced a different answer");
  assert.deepEqual(shared.createArgs, []);
});

// ===========================================================================
// 5–11. The locked order
// ===========================================================================

test("5. course authorization runs FIRST, before anything else", async () => {
  const { harness: h, result } = run();
  await result;

  assert.equal(h.calls[0], "requireCourseContext");
  assert.deepEqual(h.contextArgs, [REQUESTED_OFFERING_ID]);
});

test("6. the lifecycle gate runs SECOND, on the VERIFIED status", async () => {
  const { harness: h, result } = run({ status: "PLANNED" });
  await result;

  assert.equal(h.calls[1], "assertConfigurationAllowed");
  assert.deepEqual(h.gateArgs, ["PLANNED"]);
});

test("7. the existence lookup runs AFTER the lifecycle gate", async () => {
  const { harness: h, result } = run();
  await result;

  const gate = h.calls.indexOf("assertConfigurationAllowed");
  const lookup = h.calls.indexOf("findExamPlanByCourseOfferingId");
  assert.ok(gate >= 0 && lookup > gate, `order was ${h.calls.join(" -> ")}`);
});

test("8. the write runs LAST, and only after the lookup found nothing", async () => {
  const { harness: h, result } = run();
  await result;

  assert.equal(h.calls[h.calls.length - 1], "createExamPlanForCourseOffering");
  const lookup = h.calls.indexOf("findExamPlanByCourseOfferingId");
  const write = h.calls.indexOf("createExamPlanForCourseOffering");
  assert.ok(lookup >= 0 && write > lookup, `order was ${h.calls.join(" -> ")}`);
});

test("9. the successful create order is EXACTLY the locked sequence", async () => {
  const { harness: h, result } = run();
  await result;

  assert.deepEqual(h.calls, [
    "requireCourseContext",
    "assertConfigurationAllowed",
    "findExamPlanByCourseOfferingId",
    "createExamPlanForCourseOffering",
  ]);
});

test("10. the VERIFIED offering id is what the lookup AND the write receive", async () => {
  const { harness: h, result } = run();
  await result;

  assert.deepEqual(h.findArgs, [VERIFIED_OFFERING_ID]);
  assert.deepEqual(h.createArgs, [VERIFIED_OFFERING_ID]);
});

test("11. the RAW requested offering id is never reused after verification", async () => {
  const { harness: h, result } = run();
  const outcome = await result;

  // It reached the boundary exactly once, and nothing downstream ever saw it.
  assert.deepEqual(h.contextArgs, [REQUESTED_OFFERING_ID]);
  assert.equal(h.findArgs.includes(REQUESTED_OFFERING_ID), false);
  assert.equal(h.createArgs.includes(REQUESTED_OFFERING_ID), false);
  assert.equal(JSON.stringify(outcome).includes(REQUESTED_OFFERING_ID), false);
});

test("12. the conflict re-read ALSO uses the verified offering id", async () => {
  const { harness: h, result } = run({
    createThrows: offeringConflictError(),
    planAfterConflict: { id: WINNER_PLAN_ID },
  });
  await result;

  assert.deepEqual(h.findArgs, [VERIFIED_OFFERING_ID, VERIFIED_OFFERING_ID]);
});

// ===========================================================================
// 13–15. The caller supplies a request, never a grant
// ===========================================================================

test("13. the orchestration accepts EXACTLY two arguments: an offering id and deps", () => {
  // There is no third parameter, so there is no slot for a plan id, an actor id,
  // a publication option, a stale-write token or a transaction handle. The
  // structural guards below prove the same thing from the source signature.
  assert.equal(createExamPlanWithDeps.length, 2);
});

test("14. the reported planId always comes from a dependency, never from the caller", async () => {
  // Whatever the caller passed as the offering id, the plan id in the result is
  // the one the SERVER produced — on all three success paths.
  const forged = "plan-forged-by-caller";
  const fresh = await run({}, forged).result;
  const existing = await run({ plan: { id: EXISTING_PLAN_ID } }, forged).result;
  const raced = await run(
    { createThrows: offeringConflictError(), planAfterConflict: { id: WINNER_PLAN_ID } },
    forged,
  ).result;

  assert.deepEqual(fresh, { ok: true, planId: NEW_PLAN_ID, created: true });
  assert.deepEqual(existing, { ok: true, planId: EXISTING_PLAN_ID, created: false });
  assert.deepEqual(raced, { ok: true, planId: WINNER_PLAN_ID, created: false });
  for (const outcome of [fresh, existing, raced]) {
    assert.equal(JSON.stringify(outcome).includes("forged"), false);
  }
});

test("15. `created` is decided by the code path, never by anything the caller sent", async () => {
  const fresh = await run().result;
  const existing = await run({ plan: { id: EXISTING_PLAN_ID } }).result;

  assert.equal(fresh.ok === true && fresh.created, true);
  assert.equal(existing.ok === true && existing.created, false);
  // A real boolean, not a truthy value a caller could have injected.
  for (const outcome of [fresh, existing]) {
    assert.equal(typeof (outcome as { created?: unknown }).created, "boolean");
  }
});

// ===========================================================================
// 16–20. The concurrent writer
// ===========================================================================

test("16. a P2002 offering conflict is a SUCCESS carrying the winner's plan", async () => {
  const { result } = run({
    createThrows: offeringConflictError(),
    planAfterConflict: { id: WINNER_PLAN_ID },
  });

  assert.deepEqual(await result, { ok: true, planId: WINNER_PLAN_ID, created: false });
});

test("17. the conflict path re-reads ONCE and never retries the write", async () => {
  const { harness: h, result } = run({
    createThrows: offeringConflictError(),
    planAfterConflict: { id: WINNER_PLAN_ID },
  });
  await result;

  assert.deepEqual(h.calls, [
    "requireCourseContext",
    "assertConfigurationAllowed",
    "findExamPlanByCourseOfferingId",
    "createExamPlanForCourseOffering",
    "findExamPlanByCourseOfferingId",
  ]);
  assert.equal(h.createArgs.length, 1, "the write was retried");
});

test("18. every readable P2002 target form for the offering key is classified", async () => {
  for (const target of [
    ["courseOfferingId"],
    "exam_plans_courseOfferingId_key",
    ["courseOfferingId", "somethingElse"],
    undefined,
    null,
  ]) {
    const { result } = run({
      createThrows: offeringConflictError(target),
      planAfterConflict: { id: WINNER_PLAN_ID },
    });
    assert.deepEqual(
      await result,
      { ok: true, planId: WINNER_PLAN_ID, created: false },
      `target ${JSON.stringify(target)} was not classified`,
    );
  }
});

test("19. a conflict whose re-read finds NOTHING returns plan_conflict", async () => {
  const { harness: h, result } = run({
    createThrows: offeringConflictError(),
    planAfterConflict: null,
  });

  assert.deepEqual(await result, { ok: false, code: "plan_conflict" });
  // No invented id, no second write, no loop.
  assert.equal(h.createArgs.length, 1);
  assert.equal(h.findArgs.length, 2);
});

test("20. an UNRELATED P2002 propagates instead of being read as a conflict", async () => {
  for (const boom of [
    offeringConflictError(["id"]),
    offeringConflictError("exam_plans_pkey"),
    offeringConflictError(["planId", "name"]),
  ]) {
    const { harness: h, result } = run({
      createThrows: boom,
      // A plan IS available to the re-read — so if the error were misclassified
      // this would silently become a success rather than a rejection.
      planAfterConflict: { id: WINNER_PLAN_ID },
    });
    await assert.rejects(
      () => result,
      (error) => error === boom,
      `${JSON.stringify(boom)} was laundered into a success`,
    );
    assert.equal(h.findArgs.length, 1, "the conflict re-read ran for an unrelated error");
  }
});

test("21. the REAL classifier accepts only the plan's offering conflict", () => {
  // Accepted: both Prisma target representations, and an unreadable target (the
  // bound write inserts one row into one table, documented in the core).
  assert.equal(isExamPlanOfferingConflictError(offeringConflictError()), true);
  assert.equal(
    isExamPlanOfferingConflictError(offeringConflictError("exam_plans_courseOfferingId_key")),
    true,
  );
  assert.equal(isExamPlanOfferingConflictError({ code: "P2002" }), true);
  assert.equal(isExamPlanOfferingConflictError({ code: "P2002", meta: {} }), true);

  // Rejected: the SIBLING primary key on the same table, another table's key,
  // other error codes, and every non-Prisma shape — including a redirect.
  assert.equal(isExamPlanOfferingConflictError(offeringConflictError(["id"])), false);
  assert.equal(isExamPlanOfferingConflictError(offeringConflictError("exam_plans_pkey")), false);
  assert.equal(
    isExamPlanOfferingConflictError(offeringConflictError(["planId", "name"])),
    false,
  );
  assert.equal(isExamPlanOfferingConflictError(offeringConflictError([])), false);
  assert.equal(isExamPlanOfferingConflictError(offeringConflictError([42])), false);
  assert.equal(isExamPlanOfferingConflictError({ code: "P2003" }), false);
  assert.equal(isExamPlanOfferingConflictError({ code: "P2025" }), false);
  assert.equal(isExamPlanOfferingConflictError(new Error("boom")), false);
  assert.equal(isExamPlanOfferingConflictError(redirectLikeError()), false);
  assert.equal(isExamPlanOfferingConflictError(null), false);
  assert.equal(isExamPlanOfferingConflictError(undefined), false);
  assert.equal(isExamPlanOfferingConflictError("P2002"), false);
});

// ===========================================================================
// 22–25. Course + lifecycle denials
// ===========================================================================

test("22. a course not-found maps to offering_not_found", async () => {
  const { result } = run({ contextThrows: new FakeCourseNotFoundError("nope") });
  assert.deepEqual(await result, { ok: false, code: "offering_not_found" });
});

test("23. a course not-found causes ZERO gate, lookup and write calls", async () => {
  const { harness: h, result } = run({ contextThrows: new FakeCourseNotFoundError() });
  await result;

  assert.deepEqual(h.calls, ["requireCourseContext"]);
  assert.deepEqual(h.gateArgs, []);
  assert.deepEqual(h.findArgs, []);
  assert.deepEqual(h.createArgs, []);
});

test("24. a lifecycle denial maps to operation_not_allowed", async () => {
  const { result } = run({
    status: "ARCHIVED",
    gateThrows: new FakeOperationDeniedError(),
  });
  assert.deepEqual(await result, { ok: false, code: "operation_not_allowed" });
});

test("25. a lifecycle denial causes ZERO lookup and write calls", async () => {
  // An ARCHIVED offering costs no exam query at all — plan existence is not even
  // probed, let alone created.
  const { harness: h, result } = run({
    status: "ARCHIVED",
    gateThrows: new FakeOperationDeniedError(),
  });
  await result;

  assert.deepEqual(h.calls, ["requireCourseContext", "assertConfigurationAllowed"]);
  assert.deepEqual(h.findArgs, []);
  assert.deepEqual(h.createArgs, []);
});

// ===========================================================================
// 26–30. Everything else propagates
// ===========================================================================

test("26. an unrelated error from the course boundary propagates unchanged", async () => {
  const boom = new Error("infrastructure is down");
  await assert.rejects(
    () => run({ contextThrows: boom }).result,
    (error) => error === boom,
  );
});

test("27. a REDIRECT-shaped error propagates unchanged from every dependency", async () => {
  const redirect = redirectLikeError();
  const paths: (readonly [string, HarnessOptions])[] = [
    ["requireCourseContext", { contextThrows: redirect }],
    ["assertConfigurationAllowed", { gateThrows: redirect }],
    ["findExamPlanByCourseOfferingId", { findThrows: redirect }],
    ["createExamPlanForCourseOffering", { createThrows: redirect }],
    [
      "the conflict re-read",
      { createThrows: offeringConflictError(), reReadThrows: redirect },
    ],
  ];
  for (const [dependency, options] of paths) {
    await assert.rejects(
      () => run(options).result,
      (error) => error === redirect,
      `${dependency} swallowed the redirect`,
    );
  }
});

test("28. an unexpected lookup error propagates, and nothing is written", async () => {
  const boom = new Error("plan lookup failed");
  const { harness: h, result } = run({ findThrows: boom });

  await assert.rejects(
    () => result,
    (error) => error === boom,
  );
  assert.deepEqual(h.createArgs, []);
});

test("29. an unexpected write error propagates unchanged", async () => {
  for (const boom of [
    new Error("write failed"),
    { code: "P2003" },
    { code: "P2025" },
    offeringConflictError(["id"]),
  ]) {
    await assert.rejects(
      () => run({ createThrows: boom }).result,
      (error) => error === boom,
      `a ${JSON.stringify(boom)} was swallowed`,
    );
  }
});

test("30. an unexpected error from the conflict RE-READ propagates unchanged", async () => {
  // The re-read is not wrapped in a classifier: a failure there is a real fault,
  // not a quiet `plan_conflict`.
  const boom = new Error("re-read failed");
  await assert.rejects(
    () => run({ createThrows: offeringConflictError(), reReadThrows: boom }).result,
    (error) => error === boom,
  );
});

test("31. no error is swallowed broadly: only the three classified shapes decide", async () => {
  // A harness whose classifiers ALL say "no" must propagate every throw — proof
  // that the outcomes come from the classifiers, not from a bare catch. The errors
  // used here are the very shapes the REAL classifiers would accept.
  const courseError = new FakeCourseNotFoundError();
  const gateError = new FakeOperationDeniedError();
  const writeError = offeringConflictError();
  const paths: (readonly [string, HarnessOptions, unknown])[] = [
    ["requireCourseContext", { contextThrows: courseError }, courseError],
    ["assertConfigurationAllowed", { gateThrows: gateError }, gateError],
    ["createExamPlanForCourseOffering", { createThrows: writeError }, writeError],
  ];
  for (const [dependency, options, thrown] of paths) {
    const h = harness({ ...options, planAfterConflict: { id: WINNER_PLAN_ID } });
    const deps: CreateExamPlanDeps = {
      ...h.deps,
      isCourseNotFoundError: () => false,
      isOperationNotAllowedError: () => false,
      isPlanCourseOfferingUniqueConflict: () => false,
    };
    await assert.rejects(
      () => createExamPlanWithDeps(REQUESTED_OFFERING_ID, deps),
      (error) => error === thrown,
      `${dependency} was swallowed`,
    );
  }
});

// ===========================================================================
// 32–39. The result model
// ===========================================================================

/** Every distinct result this core can produce. */
async function everyResult(): Promise<CreateExamPlanResult[]> {
  return [
    await run().result,
    await run({ plan: { id: EXISTING_PLAN_ID } }).result,
    await run({
      createThrows: offeringConflictError(),
      planAfterConflict: { id: WINNER_PLAN_ID },
    }).result,
    await run({ createThrows: offeringConflictError() }).result,
    await run({ contextThrows: new FakeCourseNotFoundError() }).result,
    await run({ gateThrows: new FakeOperationDeniedError() }).result,
  ];
}

test("32. every result is either the two-field success or the one-code refusal", async () => {
  for (const outcome of await everyResult()) {
    assert.deepEqual(
      Object.keys(outcome).sort(),
      outcome.ok ? ["created", "ok", "planId"] : ["code", "ok"],
    );
  }
});

test("33. no raw Prisma-like or publication field enters any result", async () => {
  for (const outcome of await everyResult()) {
    for (const forbidden of [
      "createdAt",
      "updatedAt",
      "publishedAt",
      "individualPublishedAt",
      "courseOffering",
      "definitions",
      "sessions",
      "sourceDates",
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

test("34. no course, actor or error identifier enters any result", async () => {
  for (const outcome of await everyResult()) {
    const serialized = JSON.stringify(outcome);
    for (const secret of [
      VERIFIED_OFFERING_ID,
      REQUESTED_OFFERING_ID,
      "courseOfferingId",
      "adminId",
      "actorId",
      "instructorId",
      "studentId",
      "P2002",
    ]) {
      assert.equal(serialized.includes(secret), false, `${secret} leaked into ${serialized}`);
    }
  }
});

test("35. every result is a plain object", async () => {
  for (const outcome of await everyResult()) {
    assert.equal(Object.getPrototypeOf(outcome), Object.prototype);
    assert.equal(outcome instanceof Error, false);
  }
});

test("36. every result deep-equals its JSON round trip", async () => {
  for (const outcome of await everyResult()) {
    assert.deepEqual(JSON.parse(JSON.stringify(outcome)), outcome);
  }
});

test("37. no result carries an undefined property value", async () => {
  for (const outcome of await everyResult()) {
    const record = outcome as unknown as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      assert.notEqual(record[key], undefined, `${key} is undefined`);
    }
    // `planId`/`created` exist ONLY on success, `code` ONLY on a refusal — never
    // as undefined placeholders.
    assert.equal(Object.prototype.hasOwnProperty.call(record, "planId"), outcome.ok);
    assert.equal(Object.prototype.hasOwnProperty.call(record, "created"), outcome.ok);
    assert.equal(Object.prototype.hasOwnProperty.call(record, "code"), !outcome.ok);
  }
});

test("38. every result is FROZEN", async () => {
  for (const outcome of await everyResult()) {
    assert.equal(Object.isFrozen(outcome), true, `${JSON.stringify(outcome)} is mutable`);
  }
});

test("39. every value in every result is a JSON primitive", async () => {
  for (const outcome of await everyResult()) {
    for (const value of Object.values(outcome as unknown as Record<string, unknown>)) {
      // Checked BEFORE the primitive assertion narrows the type away.
      assert.equal(value instanceof Date, false);
      assert.ok(
        typeof value === "string" || typeof value === "boolean",
        `${JSON.stringify(value)} is not a plain string or boolean`,
      );
    }
  }
});

// ===========================================================================
// 40–43. Call discipline
// ===========================================================================

test("40. no dependency runs more than once — except the documented conflict re-read", async () => {
  const singleCallPaths: (readonly [string, HarnessOptions])[] = [
    ["fresh create", {}],
    ["existing plan", { plan: { id: EXISTING_PLAN_ID } }],
    ["course not-found", { contextThrows: new FakeCourseNotFoundError() }],
    ["lifecycle denial", { gateThrows: new FakeOperationDeniedError() }],
  ];
  for (const [label, options] of singleCallPaths) {
    const { harness: h, result } = run(options);
    await result;
    assert.equal(new Set(h.calls).size, h.calls.length, `${label} repeated a dependency`);
  }

  // The ONE documented exception: the conflict path reads the plan back, so the
  // LOOKUP runs exactly twice. Everything else still runs exactly once.
  for (const planAfterConflict of [{ id: WINNER_PLAN_ID }, null]) {
    const { harness: h, result } = run({
      createThrows: offeringConflictError(),
      planAfterConflict,
    });
    await result;
    const counts = callCounts(h.calls);
    assert.deepEqual(
      [...counts.entries()].sort(),
      [
        ["assertConfigurationAllowed", 1],
        ["createExamPlanForCourseOffering", 1],
        ["findExamPlanByCourseOfferingId", 2],
        ["requireCourseContext", 1],
      ],
    );
  }
});

test("41. the WRITE runs at most ONCE on every path: there is no retry loop", async () => {
  const paths: HarnessOptions[] = [
    {},
    { plan: { id: EXISTING_PLAN_ID } },
    { contextThrows: new FakeCourseNotFoundError() },
    { gateThrows: new FakeOperationDeniedError() },
    { createThrows: offeringConflictError(), planAfterConflict: { id: WINNER_PLAN_ID } },
    { createThrows: offeringConflictError() },
  ];
  for (const options of paths) {
    const { harness: h, result } = run(options);
    await result;
    assert.ok(
      h.createArgs.length <= 1,
      `the write ran ${h.createArgs.length} times for ${JSON.stringify(Object.keys(options))}`,
    );
  }
});

test("42. the authorization boundary runs exactly once on every path", async () => {
  for (const options of [
    {},
    { plan: { id: EXISTING_PLAN_ID } },
    { createThrows: offeringConflictError(), planAfterConflict: { id: WINNER_PLAN_ID } },
    { createThrows: offeringConflictError() },
    { gateThrows: new FakeOperationDeniedError() },
  ] satisfies HarnessOptions[]) {
    const { harness: h, result } = run(options);
    await result;
    assert.equal(h.contextArgs.length, 1);
  }
});

test("43. the module derives nothing from call history", async () => {
  // Two invocations through the SAME dependency bundle, whose lookup answers
  // change between them, produce exactly the answers those lookups imply.
  const shared = harness({ plan: null, created: { id: NEW_PLAN_ID } });
  const first = await createExamPlanWithDeps(REQUESTED_OFFERING_ID, shared.deps);
  const second = await createExamPlanWithDeps(REQUESTED_OFFERING_ID, shared.deps);

  // The fake's second lookup is the "re-read" slot, which defaults to null, so
  // the second call takes the create path again — and still reports created:true.
  assert.deepEqual(first, { ok: true, planId: NEW_PLAN_ID, created: true });
  assert.deepEqual(second, first);
  assert.deepEqual(shared.createArgs, [VERIFIED_OFFERING_ID, VERIFIED_OFFERING_ID]);
});

// ===========================================================================
// Structural guards on the pure core
// ===========================================================================

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const EXAM_DIR = join(REPO_ROOT, "lib", "exam");
const MODULE_NAME = "create-exam-plan-core.ts";
const TEST_NAME = "create-exam-plan-core.test.ts";
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
    "spawnSync",
  ]) {
    assert.equal(CODE.includes(token), false, `the pure core references ${token}`);
  }
  const dbCalls =
    /\.(create|createMany|update|updateMany|upsert|delete|deleteMany|findUnique|findFirst|findMany|count|aggregate)\s*\(/;
  assert.equal(dbCalls.test(CODE), false, "the pure core performs a database operation");
});

test("S2. the pure core imports no auth, session, cookie, Next or course implementation", () => {
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

test("S3. the pure core is neither server-only nor a Server Action module", () => {
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

test("S4. the pure core consults no capability of any kind", () => {
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

test("S5. the pure core imports NOTHING AT ALL", () => {
  // Not even a sibling exam core: this slice owns no input rule, no label table
  // and no domain enum, so it needs no dependency it does not receive.
  assert.deepEqual([...CODE.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]), []);
  assert.equal(/^\s*import\s/m.test(CODE), false, "the pure core has an import statement");
  assert.equal(/\brequire\s*\(/.test(CODE), false);
});

test("S6. the pure core has no clock, randomness, env, process or network access", () => {
  for (const pattern of [
    /new Date\b/,
    /Date\.now\b/,
    /Math\.random\b/,
    /process\./,
    /globalThis/,
    /process\.env\b/,
    /XMLHttpRequest|WebSocket/,
  ]) {
    assert.equal(pattern.test(CODE), false, `the pure core uses ${pattern}`);
  }
});

test("S7. the pure core contains no publication, source-date, delete, update or upsert logic", () => {
  for (const token of [
    "publish",
    "Publish",
    "publishedAt",
    "sourceDate",
    "SourceDate",
    "ExamTeachingPracticeSourceDate",
    "upsert",
    "Upsert",
    "ensurePlan",
    "ensureExamPlan",
    "getOrCreate",
    "deletePlan",
    "updatePlan",
    "archive",
    "notify",
    "notification",
    "definition",
    "Definition",
    "reorder",
  ]) {
    assert.equal(CODE.includes(token), false, `the pure core references ${token}`);
  }
  // ...and the header explains that each absence is deliberate.
  assert.ok(COMMENTS.includes("publishedAt"), "the publication rule is undocumented");
  assert.ok(COMMENTS.includes("upsert"), "the no-upsert rule is undocumented");
  assert.ok(/lazy/i.test(COMMENTS), "the no-lazy-creation rule is undocumented");
});

test("S8. no exported function accepts a plan, actor, token or transaction argument", () => {
  const signatures = [
    ...SOURCE.matchAll(/export (?:async )?function (\w+)\(([\s\S]*?)\):/g),
  ].map(([, name, params]) => ({ name, params: params.replace(/\s+/g, " ").trim() }));

  assert.deepEqual(
    signatures.map((signature) => signature.name),
    ["isExamPlanOfferingConflictError", "createExamPlanWithDeps"],
  );

  const orchestration = signatures.find((s) => s.name === "createExamPlanWithDeps");
  assert.ok(orchestration);
  assert.equal(orchestration.params, "courseOfferingId: string, deps: CreateExamPlanDeps,");
  for (const forbidden of [
    "planId",
    "plan:",
    "adminId",
    "actorId",
    "prisma",
    "tx:",
    "expectedUpdatedAt",
    "publishedAt",
    "created",
  ]) {
    assert.equal(
      orchestration.params.includes(forbidden),
      false,
      `the orchestration accepts ${forbidden}`,
    );
  }
});

test("S9. the injected boundary is EXACTLY the seven approved dependencies", () => {
  const block = CODE.match(/export interface CreateExamPlanDeps \{([\s\S]*?)\n\}/);
  assert.ok(block, "the dependency interface was not found");
  const members = [...block[1].matchAll(/^\s{2}(\w+)\s*[(<]/gm)].map((m) => m[1]);
  assert.deepEqual(members.sort(), [
    "assertConfigurationAllowed",
    "createExamPlanForCourseOffering",
    "findExamPlanByCourseOfferingId",
    "isCourseNotFoundError",
    "isOperationNotAllowedError",
    "isPlanCourseOfferingUniqueConflict",
    "requireCourseContext",
  ]);
});

test("S10. no result code beyond the three approved outcomes exists", () => {
  const codes = [...CODE.matchAll(/refuse\("([a-z_]+)"\)|code: "([a-z_]+)"/g)]
    .map((match) => match[1] ?? match[2])
    .filter((code): code is string => typeof code === "string");
  assert.deepEqual(
    [...new Set(codes)].sort(),
    ["offering_not_found", "operation_not_allowed", "plan_conflict"],
  );
  for (const token of [
    "unexpected",
    "stale_write",
    "invalid_input",
    "already_exists",
    "plan_not_found",
    "duplicate_name",
    "issues",
  ]) {
    assert.equal(CODE.includes(token), false, `the pure core invents ${token}`);
  }
});

test("S11. the plan shape the core may see is ONLY an id", () => {
  const block = CODE.match(/export interface ResolvedExamPlan \{([\s\S]*?)\n\}/);
  assert.ok(block, "the plan interface was not found");
  const members = [...block[1].matchAll(/^\s{2}readonly (\w+)/gm)].map((m) => m[1]);
  assert.deepEqual(members, ["id"]);
});

test("S12. NO module in lib/exam imports a database client", () => {
  // MODULES, not suites: the committed guard suites necessarily name the
  // specifiers they forbid, and so does this one.
  const offenders: string[] = [];
  for (const name of readdirSync(EXAM_DIR).filter(
    (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
  )) {
    const source = readFileSync(join(EXAM_DIR, name), "utf8");
    for (const specifier of [PRISMA_MODULE, GENERATED_CLIENT]) {
      if (source.includes(specifier)) offenders.push(`${name} -> ${specifier}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `the exam cores must stay DB-free; found: ${offenders.join(", ")}`,
  );
});

// ===========================================================================
// Containment: exactly two new files, nothing modified, nothing wired
// ===========================================================================

test("S13. the slice's lib/exam files are exactly the approved pair", () => {
  const sliceFiles = readdirSync(EXAM_DIR)
    .filter((name) => name.startsWith("create-exam-plan-core"))
    .sort();
  assert.deepEqual(sliceFiles, [MODULE_NAME, TEST_NAME].sort());
});

/**
 * Tracked paths, as `git` spells them (forward slashes on every platform), so the
 * containment guards below can name them exactly.
 */
const CORE_TRACKED_PATH = ["lib", "exam", MODULE_NAME].join("/");
const SUITE_TRACKED_PATH = ["lib", "exam", TEST_NAME].join("/");
const IO_TRACKED_PATH = ["lib", "actions", "exam-plan-write-io.ts"].join("/");
const IO_TEST_TRACKED_PATH = ["lib", "actions", "exam-plan-write-io.test.ts"].join("/");

/** P3 — the exams route that wires the binding to a manager-facing button. */
const ROUTE_DIR = ["app", "admin", "courses", "[courseOfferingId]", "exams"].join("/");
const P3_ACTION_TRACKED_PATH = `${ROUTE_DIR}/actions.ts`;
const P3_PAGE_TRACKED_PATH = `${ROUTE_DIR}/page.tsx`;
const P3_PAGE_SUITE_TRACKED_PATH = `${ROUTE_DIR}/exam-definitions-page.contract.test.ts`;
const P3_SUITE_TRACKED_PATH = `${ROUTE_DIR}/exam-plan-create.contract.test.ts`;

test("S14. the slice modified NO production file outside the approved P3 wiring", () => {
  // P1 -> P2 -> P3 TRANSITION, STATED EXPLICITLY. While P1 was the pure core alone,
  // the approved diff was EMPTY. P2 added the server-only Prisma binding, which
  // made two of P1's containment CLAIMS obsolete — the core gained a consumer, and
  // an IO binding came to exist. P3 now adds the ONE app caller, which makes the
  // "wired to nothing" claim obsolete in turn.
  //
  // The guard is NOT relaxed by that. The pure core and the binding are still
  // asserted byte-identical to HEAD; the schema and the migrations are still
  // untouched; and S15/S16 below still pin the consumer and the caller to EXACT
  // paths rather than to a directory, a glob or "there is none".
  const result = spawnSync(
    "git",
    ["diff", "--name-only", "HEAD", "--", "lib", "prisma", "app", "components"],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  assert.equal(result.status, 0, `git diff failed: ${result.stderr ?? ""}`);
  const modified = (result.stdout ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  // WHAT IS TOLERATED, AND WHY IT IS TOLERATED RATHER THAN REQUIRED. These paths
  // may legitimately differ from HEAD — before a slice is committed the diff holds
  // them, afterwards it is empty, and a later fix puts one back. Pinning the diff
  // to an exact list would make this test flip red on every one of those perfectly
  // correct states.
  //
  // The GUARD SUITES are tolerated because amending an obsolete containment claim
  // means editing them. The ONE tolerated production file is the exams PAGE, which
  // P3 edits to render the create affordance. Everything else — and in particular
  // the pure core, the binding, the schema and the migrations — must NEVER differ.
  // EX-SES-UI-1 adds the four further guard suites that its own wiring slice
  // amends. They are SUITES, every one of them: the tolerated PRODUCTION list
  // below is unchanged and still holds exactly the P3 page, which is what the
  // final assertion in this test re-states.
  //
  // The session paths are ASSEMBLED, not spelled: the committed session reader
  // guard pins its caller list to EXACTLY the exams page and the session write
  // guard pins its own to EXACTLY one Server Action, so a suite naming either
  // module whole would become an extra entry in a list it must stay out of.
  const TOLERATED_SUITES = [
    SUITE_TRACKED_PATH,
    IO_TEST_TRACKED_PATH,
    P3_PAGE_SUITE_TRACKED_PATH,
    P3_SUITE_TRACKED_PATH,
    `${ROUTE_DIR}/exam-definition-create.contract.test.ts`,
    `${ROUTE_DIR}/exam-session-create.contract.test.ts`,
    ["lib", "actions", "admin-exam-session-read" + "-io.test.ts"].join("/"),
    ["lib", "actions", "exam-session-write" + "-io.test.ts"].join("/"),
    ["lib", "actions", "exam-definition-read" + "-io.test.ts"].join("/"),
  ];
  const TOLERATED_PRODUCTION = [P3_PAGE_TRACKED_PATH];
  const TOLERATED = [...TOLERATED_SUITES, ...TOLERATED_PRODUCTION];
  const unexpected = modified.filter((path) => !TOLERATED.includes(path));
  assert.deepEqual(
    unexpected,
    [],
    `the slice modified production code: ${unexpected.join(", ")}`,
  );
  // Named explicitly, so the two files that matter most cannot drift in under a
  // future widening of the tolerated list.
  for (const production of [CORE_TRACKED_PATH, IO_TRACKED_PATH]) {
    assert.equal(modified.includes(production), false, `${production} was modified`);
  }
  // Every tolerated suite really is a test suite...
  for (const path of TOLERATED_SUITES) {
    assert.match(path, /\.test\.ts$/);
  }
  // ...and the single tolerated production file is exactly the exams page — not a
  // lib module, not the binding, not a second route.
  assert.deepEqual(TOLERATED_PRODUCTION, [P3_PAGE_TRACKED_PATH]);
});

/**
 * Every `.ts`/`.tsx` file of the repository's own source trees, as tracked-style
 * relative paths. Shared by the two containment guards below.
 */
function repoSourceFiles(): { path: string; source: string }[] {
  const out: { path: string; source: string }[] = [];

  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "generated") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      out.push({
        path: full.slice(REPO_ROOT.length + 1).split(sep).join("/"),
        source: readFileSync(full, "utf8"),
      });
    }
  }
  for (const root of ["app", "lib", "components", "scripts"]) {
    try {
      walk(join(REPO_ROOT, root));
    } catch {
      // An absent optional root is not a failure.
    }
  }
  return out;
}

test("S15. the ONLY production consumer of this core is the server-only IO binding", () => {
  // P1 -> P2 TRANSITION. This guard previously asserted ZERO consumers. P2's whole
  // purpose is to add exactly ONE, so the claim is now pinned to that one PATH
  // instead of being dropped: any second consumer — a route, a page, a Server
  // Action, another lib/actions module or a script — still fails this test.
  const ORCHESTRATION = new RegExp("\\bcreate" + "ExamPlanWithDeps\\b");
  const MODULE_SPECIFIER = "create-exam-plan-core";

  const consumers = repoSourceFiles()
    .filter((file) => file.path !== CORE_TRACKED_PATH && file.path !== SUITE_TRACKED_PATH)
    .filter(
      (file) => file.source.includes(MODULE_SPECIFIER) || ORCHESTRATION.test(file.source),
    )
    .map((file) => file.path)
    .sort();

  // The binding, and the binding's OWN suite — which legitimately drives the pure
  // orchestration with fakes, exactly as this suite does.
  assert.deepEqual(
    consumers,
    [IO_TRACKED_PATH, IO_TEST_TRACKED_PATH].sort(),
    `the core is consumed by an unapproved file: ${consumers.join(", ")}`,
  );

  // PRODUCTION code specifically: exactly one shipped module may reach the core.
  const production = consumers.filter((path) => !/\.test\.tsx?$/.test(path));
  assert.deepEqual(production, [IO_TRACKED_PATH]);

  // ...and no OTHER module in lib/actions consumes it, by directory listing rather
  // than by content, so a differently-named binding cannot slip in.
  const actionsConsumers = readdirSync(join(REPO_ROOT, "lib", "actions"))
    .filter((name) => /\.tsx?$/.test(name))
    .filter((name) => {
      const source = readFileSync(join(REPO_ROOT, "lib", "actions", name), "utf8");
      return source.includes(MODULE_SPECIFIER) || ORCHESTRATION.test(source);
    })
    .sort();
  assert.deepEqual(actionsConsumers, [
    "exam-plan-write-io.test.ts",
    "exam-plan-write-io.ts",
  ]);
});

test("S16. the binding is reachable from EXACTLY ONE app Server Action, and no UI", () => {
  // P1 -> P2 -> P3 TRANSITION. This guard first asserted that no ExamPlan IO
  // binding existed at all, then that one existed and was wired to NOTHING. P3's
  // whole purpose is to give it exactly ONE public caller, so the claim is now
  // pinned to that one PATH — spelled out in full, never as a directory or a glob,
  // so a second route, a second Server Action module or any `.tsx` still fails.
  const created = readdirSync(join(REPO_ROOT, "lib", "actions"))
    .filter((name) => /exam-plan/.test(name))
    .sort();
  assert.deepEqual(created, ["exam-plan-write-io.test.ts", "exam-plan-write-io.ts"]);

  const io = stripComments(readFileSync(join(REPO_ROOT, "lib", "actions", "exam-plan-write-io.ts"), "utf8"));

  // It is server-only, and it is NOT a Server Action module: nothing exported from
  // it has a callable network id.
  const firstStatement = io.split("\n").find((line) => line.trim().length > 0);
  assert.ok(firstStatement);
  assert.ok(
    new RegExp('import\\s+"server' + '-only";').test(firstStatement),
    `the binding's first statement is: ${firstStatement}`,
  );
  assert.equal(io.includes('"use ' + 'server"'), false, "the binding is a Server Action module");
  assert.equal(io.includes("'use " + "server'"), false);

  // Exactly ONE file outside the slice's own modules names the binding: the P3
  // Server Action. THIS suite and the binding's own suite are excluded because a
  // guard necessarily names the path it guards; they import nothing from the
  // binding and call nothing in it.
  const reaching = repoSourceFiles().filter(
    (file) =>
      file.source.includes("exam-plan-write-io") &&
      file.path !== IO_TRACKED_PATH &&
      file.path !== IO_TEST_TRACKED_PATH &&
      file.path !== SUITE_TRACKED_PATH,
  );
  assert.deepEqual(
    reaching.map((file) => file.path),
    [P3_ACTION_TRACKED_PATH],
    "the binding is reachable from an unapproved file",
  );
  // That one caller is a Server Action module, NOT a component: no `.tsx` reaches
  // the binding, and no UI file of any kind reaches the pure core either.
  assert.equal(P3_ACTION_TRACKED_PATH.endsWith(".ts"), true);
  const tsxReaching = repoSourceFiles().filter(
    (file) => file.path.endsWith(".tsx") && file.source.includes("exam-plan-write-io"),
  );
  assert.deepEqual(tsxReaching.map((file) => file.path), []);
  const uiReaching = repoSourceFiles().filter(
    (file) => file.path.endsWith(".tsx") && file.source.includes("create-exam-plan-core"),
  );
  assert.deepEqual(uiReaching.map((file) => file.path), []);
  for (const dir of [
    ["app", "admin", "exams"],
    ["app", "instructor", "exams"],
    ["app", "student", "exams"],
  ]) {
    assert.equal(existsSync(join(REPO_ROOT, ...dir)), false, `${dir.join("/")} was created`);
  }

  // NO publication, source-date, delete, capability or notification work came with
  // the binding: the tokens are absent from its code, not merely unused.
  for (const token of [
    "publishedAt",
    "publish",
    "sourceDate",
    "SourceDate",
    "delete",
    "upsert",
    "capability",
    "Capability",
    "notification",
    "Notification",
    "$transaction",
    "examDefinition",
    "examSession",
  ]) {
    assert.equal(io.includes(token), false, `the binding reaches ${token}`);
  }

  // NO schema or migration work: the prisma tree is untouched (S14 proves the diff
  // is this suite alone) and no migration was added for the binding.
  const migrations = readdirSync(join(REPO_ROOT, "prisma", "migrations"))
    .filter((name) => /exam/i.test(name))
    .sort();
  assert.deepEqual(migrations, [
    "20260729120000_add_exam_plan_tree",
    "20260729140000_add_exam_teaching_practice_source_date",
    "20260730120000_add_exam_definition_and_breaks",
  ]);
});
