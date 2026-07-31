/**
 * EX-PUB-BE-MVP — tests for the PURE publish/unpublish decision and orchestration
 * (lib/exam/exam-publication-write-core.ts).
 *
 * Run with: npx tsx --test lib/exam/exam-publication-write-core.test.ts
 *
 * The module under test is PURE, so it is imported and executed for real: every
 * behavioural claim below is a genuine execution, not a restatement of source
 * text. The handful of SOURCE-TEXT assertions at the end prove the properties
 * that running the code cannot — that it imports no client, opens no database,
 * reads no clock and declares no Server Action.
 *
 * DB-FREE AND PRODUCTION-FREE: no database connection is opened, no SQL is
 * executed, no environment variable is read, no network call is made, and no
 * production identifier appears anywhere.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  decideExamPlanPublication,
  isExamPublicationOperation,
  setExamPlanPublicationWithDeps,
  type ExamPlanPublicationRow,
  type SetExamPlanPublicationDeps,
  type SetExamPlanPublicationResult,
} from "./exam-publication-write-core";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const CORE_REL = join("lib", "exam", "exam-publication-write-core.ts");
const CORE_TEST_REL = join("lib", "exam", "exam-publication-write-core.test.ts");

const SOURCE = readFileSync(join(REPO_ROOT, CORE_REL), "utf8");

/** Strip comments so the guards assert on CODE, not on explanatory prose. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const CODE = stripComments(SOURCE);

/** A fixed, obviously synthetic instant. Nothing here reads a real clock. */
const NOW = 1_700_000_000_000;
/** An earlier instant, standing in for "already published a while ago". */
const EARLIER = 1_600_000_000_000;

// ===========================================================================
// 1–4. The four transitions
// ===========================================================================

test("1. PUBLISH from unpublished chooses EXACTLY the supplied server time", () => {
  const decision = decideExamPlanPublication({
    operation: "PUBLISH",
    currentPublishedAt: null,
    now: NOW,
  });
  assert.deepEqual({ ...decision }, {
    change: true,
    expectedPublishedAt: null,
    nextPublishedAt: NOW,
    resultingPublishedAt: NOW,
  });
});

test("2. PUBLISH from published is a NO-OP that preserves the ORIGINAL timestamp", () => {
  const decision = decideExamPlanPublication({
    operation: "PUBLISH",
    currentPublishedAt: EARLIER,
    now: NOW,
  });
  assert.equal(decision.change, false, "an already-published plan was written to");
  // The whole point: the stored instant is NOT moved forward to `now`.
  assert.equal(decision.resultingPublishedAt, EARLIER);
  assert.equal(decision.nextPublishedAt, EARLIER);
  assert.equal(decision.expectedPublishedAt, EARLIER);
  assert.notEqual(decision.resultingPublishedAt, NOW);
});

test("3. UNPUBLISH from published clears the timestamp, conditional on that exact instant", () => {
  const decision = decideExamPlanPublication({
    operation: "UNPUBLISH",
    currentPublishedAt: EARLIER,
    now: NOW,
  });
  assert.deepEqual({ ...decision }, {
    change: true,
    expectedPublishedAt: EARLIER,
    nextPublishedAt: null,
    resultingPublishedAt: null,
  });
});

test("4. UNPUBLISH from unpublished is a NO-OP", () => {
  const decision = decideExamPlanPublication({
    operation: "UNPUBLISH",
    currentPublishedAt: null,
    now: NOW,
  });
  assert.deepEqual({ ...decision }, {
    change: false,
    expectedPublishedAt: null,
    nextPublishedAt: null,
    resultingPublishedAt: null,
  });
});

// ===========================================================================
// 5–7. Purity of the decision, and its fail-closed normalizations
// ===========================================================================

test("5. the decision NEVER mutates its input, and is deterministic", () => {
  for (const current of [null, EARLIER] as const) {
    for (const operation of ["PUBLISH", "UNPUBLISH"] as const) {
      const input = { operation, currentPublishedAt: current, now: NOW };
      const snapshot = JSON.stringify(input);
      const first = decideExamPlanPublication(input);
      const second = decideExamPlanPublication(input);
      assert.equal(JSON.stringify(input), snapshot, "the input was mutated");
      assert.deepEqual({ ...first }, { ...second }, "the decision is not deterministic");
    }
  }
  // A frozen input is accepted, which a module that wrote to its argument could
  // not manage in strict mode.
  const frozen = Object.freeze({
    operation: "PUBLISH" as const,
    currentPublishedAt: null,
    now: NOW,
  });
  assert.equal(decideExamPlanPublication(frozen).nextPublishedAt, NOW);
});

test("6. the decision is FROZEN and JSON-safe, and carries no Date", () => {
  for (const current of [null, EARLIER] as const) {
    for (const operation of ["PUBLISH", "UNPUBLISH"] as const) {
      const decision = decideExamPlanPublication({
        operation,
        currentPublishedAt: current,
        now: NOW,
      });
      assert.ok(Object.isFrozen(decision), "the decision is mutable");
      assert.deepEqual(
        JSON.parse(JSON.stringify(decision)),
        { ...decision },
        "the decision is not JSON-safe",
      );
      for (const value of Object.values(decision)) {
        assert.equal(value instanceof Date, false, "the decision carries a Date");
        assert.ok(
          value === null || typeof value === "number" || typeof value === "boolean",
          `the decision carries ${typeof value}`,
        );
      }
    }
  }
});

test("7. both normalizations fail CLOSED", () => {
  // A malformed stored value reads as "never published", so it can only ever make
  // content LESS visible.
  for (const malformed of [Number.NaN, Number.POSITIVE_INFINITY]) {
    const decision = decideExamPlanPublication({
      operation: "PUBLISH",
      currentPublishedAt: malformed,
      now: NOW,
    });
    assert.equal(decision.change, true);
    assert.equal(decision.expectedPublishedAt, null, "a malformed value became a predicate");
    assert.equal(decision.nextPublishedAt, NOW);

    const cleared = decideExamPlanPublication({
      operation: "UNPUBLISH",
      currentPublishedAt: malformed,
      now: NOW,
    });
    assert.equal(cleared.change, false, "a malformed value was unpublished");
  }
  // An unusable clock never becomes a publication instant: nothing is written.
  for (const badClock of [Number.NaN, Number.POSITIVE_INFINITY]) {
    const decision = decideExamPlanPublication({
      operation: "PUBLISH",
      currentPublishedAt: null,
      now: badClock,
    });
    assert.equal(decision.change, false, "a garbage instant was about to be stored");
    assert.equal(decision.nextPublishedAt, null);
    // Clearing needs no clock at all, so UNPUBLISH is unaffected.
    const cleared = decideExamPlanPublication({
      operation: "UNPUBLISH",
      currentPublishedAt: EARLIER,
      now: badClock,
    });
    assert.equal(cleared.change, true);
    assert.equal(cleared.nextPublishedAt, null);
  }
});

test("8. the operation predicate is fail-closed", () => {
  assert.equal(isExamPublicationOperation("PUBLISH"), true);
  assert.equal(isExamPublicationOperation("UNPUBLISH"), true);
  for (const value of [
    "publish",
    "Publish",
    "PUBLISH ",
    "",
    null,
    undefined,
    0,
    1,
    true,
    {},
    [],
    ["PUBLISH"],
  ]) {
    assert.equal(isExamPublicationOperation(value), false, `${String(value)} was accepted`);
  }
});

// ===========================================================================
// The orchestration harness — the dependency bundle, reproduced with fakes
// ===========================================================================

/** The id the caller REQUESTS. Deliberately different from the verified one. */
const REQUESTED_OFFERING_ID = "requested-offering-id";
/** The id the admin boundary VERIFIES and returns. */
const VERIFIED_OFFERING_ID = "verified-offering-id";
/** The id the fake plan lookup reports. */
const PLAN_ID = "plan-of-the-verified-offering";

/**
 * Stand-ins for the project's typed offering not-found and the committed policy's
 * typed lifecycle denial. The binding classifies each by IDENTITY, so a local
 * class reproduces exactly the property under test without importing the auth
 * chain or a database client.
 */
class SentinelOfferingNotFound extends Error {}
class SentinelOperationNotPermitted extends Error {}

interface HarnessOptions {
  readonly plan?: ExamPlanPublicationRow | null;
  readonly now?: number;
  readonly writeSucceeds?: boolean;
  readonly authThrows?: unknown;
  readonly gateThrows?: unknown;
}

interface WriteCall {
  readonly courseOfferingId: string;
  readonly planId: string;
  readonly expectedPublishedAt: number | null;
  readonly nextPublishedAt: number | null;
}

interface Harness {
  readonly deps: SetExamPlanPublicationDeps;
  readonly log: { kind: string; value: string }[];
  readonly findCalls: string[];
  readonly writeCalls: WriteCall[];
  readonly clockReads: number[];
}

function harness(options: HarnessOptions = {}): Harness {
  const log: { kind: string; value: string }[] = [];
  const findCalls: string[] = [];
  const writeCalls: WriteCall[] = [];
  const clockReads: number[] = [];

  const deps: SetExamPlanPublicationDeps = {
    async requireCourseContext(requestedCourseOfferingId) {
      log.push({ kind: "auth", value: requestedCourseOfferingId });
      if ("authThrows" in options) throw options.authThrows;
      return { courseOfferingId: VERIFIED_OFFERING_ID, status: "ACTIVE" };
    },
    assertConfigurationAllowed(status) {
      log.push({ kind: "gate", value: status });
      if ("gateThrows" in options) throw options.gateThrows;
    },
    now() {
      log.push({ kind: "clock", value: "now" });
      clockReads.push(options.now ?? NOW);
      return options.now ?? NOW;
    },
    async findPlanPublicationByCourseOfferingId(verifiedCourseOfferingId) {
      log.push({ kind: "find", value: verifiedCourseOfferingId });
      findCalls.push(verifiedCourseOfferingId);
      return options.plan === undefined
        ? { id: PLAN_ID, publishedAt: null }
        : options.plan;
    },
    async setPublicationIfCurrent(
      verifiedCourseOfferingId,
      planId,
      expectedPublishedAt,
      nextPublishedAt,
    ) {
      log.push({ kind: "write", value: planId });
      writeCalls.push({
        courseOfferingId: verifiedCourseOfferingId,
        planId,
        expectedPublishedAt,
        nextPublishedAt,
      });
      return options.writeSucceeds ?? true;
    },
    isCourseNotFoundError: (error) => error instanceof SentinelOfferingNotFound,
    isOperationNotAllowedError: (error) => error instanceof SentinelOperationNotPermitted,
  };

  return { deps, log, findCalls, writeCalls, clockReads };
}

function run(h: Harness, operation: unknown): Promise<SetExamPlanPublicationResult> {
  return setExamPlanPublicationWithDeps(REQUESTED_OFFERING_ID, operation, h.deps);
}

/** A framework redirect: a `digest`, and deliberately NO error code. */
function frameworkRedirect(): Error {
  const error = new Error("NEXT_" + "REDIRECT");
  (error as Error & { digest: string }).digest = "NEXT_" + "REDIRECT;replace;/login;307;";
  return error;
}

// ===========================================================================
// 9–12. The locked order: authorization and the gate come FIRST
// ===========================================================================

test("9. authorization and the gate run BEFORE any plan read and before the write", async () => {
  const h = harness({ plan: { id: PLAN_ID, publishedAt: null } });
  await run(h, "PUBLISH");
  assert.deepEqual(h.log.map((entry) => entry.kind), [
    "auth",
    "gate",
    "find",
    "clock",
    "write",
  ]);
  assert.equal(h.log[0].value, REQUESTED_OFFERING_ID, "the boundary got the wrong id");
  assert.equal(h.log[1].value, "ACTIVE", "the gate saw the wrong status");
});

test("10. an unauthorized/unknown offering causes ZERO reads, ZERO writes and ZERO clock reads", async () => {
  const h = harness({ authThrows: new SentinelOfferingNotFound() });
  assert.deepEqual(await run(h, "PUBLISH"), { ok: false, code: "offering_not_found" });
  assert.deepEqual(h.findCalls, [], "the plan was read anyway");
  assert.deepEqual(h.writeCalls, [], "the plan was written anyway");
  assert.deepEqual(h.clockReads, [], "the clock was read anyway");
  assert.deepEqual(h.log.map((entry) => entry.kind), ["auth"]);
});

test("11. the lifecycle gate runs BEFORE the plan read, and a denial touches nothing", async () => {
  const h = harness({ gateThrows: new SentinelOperationNotPermitted() });
  assert.deepEqual(await run(h, "UNPUBLISH"), { ok: false, code: "operation_not_allowed" });
  assert.deepEqual(h.findCalls, [], "an ARCHIVED offering was still queried");
  assert.deepEqual(h.writeCalls, [], "an ARCHIVED offering was still published");
  assert.deepEqual(h.log.map((entry) => entry.kind), ["auth", "gate"]);
});

test("12. an unrecognized operation is refused AFTER the gates and BEFORE any query", async () => {
  for (const operation of ["publish", "TOGGLE", "", null, undefined, 1, {}]) {
    const h = harness();
    assert.deepEqual(await run(h, operation), { ok: false, code: "unknown_operation" });
    assert.deepEqual(h.findCalls, [], `${String(operation)} still read the plan`);
    assert.deepEqual(h.writeCalls, [], `${String(operation)} still wrote`);
    assert.deepEqual(h.log.map((entry) => entry.kind), ["auth", "gate"]);
  }
});

// ===========================================================================
// 13–16. The plan, the verified id, and the two real transitions
// ===========================================================================

test("13. a missing plan is refused, and NOTHING is created", async () => {
  for (const operation of ["PUBLISH", "UNPUBLISH"] as const) {
    const h = harness({ plan: null });
    assert.deepEqual(await run(h, operation), { ok: false, code: "plan_not_found" });
    assert.deepEqual(h.writeCalls, [], "a missing plan was written to");
    assert.deepEqual(h.findCalls, [VERIFIED_OFFERING_ID]);
  }
});

test("14. the VERIFIED offering id is what reaches the read and the write", async () => {
  const h = harness({ plan: { id: PLAN_ID, publishedAt: null } });
  await run(h, "PUBLISH");
  assert.deepEqual(h.findCalls, [VERIFIED_OFFERING_ID]);
  assert.deepEqual(h.writeCalls.map((call) => call.courseOfferingId), [VERIFIED_OFFERING_ID]);
  assert.deepEqual(h.writeCalls.map((call) => call.planId), [PLAN_ID]);
  // The REQUESTED id reached the boundary and nothing else.
  const sawRequested = h.log.filter((entry) => entry.value === REQUESTED_OFFERING_ID);
  assert.deepEqual(sawRequested.map((entry) => entry.kind), ["auth"]);
});

test("15. PUBLISH writes the SERVER instant EXACTLY once, conditional on still-unpublished", async () => {
  const h = harness({ plan: { id: PLAN_ID, publishedAt: null } });
  assert.deepEqual(await run(h, "PUBLISH"), {
    ok: true,
    status: "PUBLISHED",
    publishedAt: NOW,
  });
  assert.equal(h.writeCalls.length, 1, "the write was repeated");
  assert.deepEqual(h.writeCalls[0], {
    courseOfferingId: VERIFIED_OFFERING_ID,
    planId: PLAN_ID,
    expectedPublishedAt: null,
    nextPublishedAt: NOW,
  });
  // The instant came from the injected clock, which was read exactly once.
  assert.deepEqual(h.clockReads, [NOW]);
});

test("16. UNPUBLISH clears the column, conditional on the EXACT stored instant", async () => {
  const h = harness({ plan: { id: PLAN_ID, publishedAt: EARLIER } });
  assert.deepEqual(await run(h, "UNPUBLISH"), {
    ok: true,
    status: "UNPUBLISHED",
    publishedAt: null,
  });
  assert.equal(h.writeCalls.length, 1);
  assert.deepEqual(h.writeCalls[0], {
    courseOfferingId: VERIFIED_OFFERING_ID,
    planId: PLAN_ID,
    expectedPublishedAt: EARLIER,
    nextPublishedAt: null,
  });
});

// ===========================================================================
// 17–19. No-ops write nothing; stale state never overwrites newer data
// ===========================================================================

test("17. a true NO-OP issues ZERO writes, in both directions", async () => {
  const alreadyPublished = harness({ plan: { id: PLAN_ID, publishedAt: EARLIER } });
  assert.deepEqual(await run(alreadyPublished, "PUBLISH"), {
    ok: true,
    status: "NO_CHANGE",
    publishedAt: EARLIER,
  });
  assert.deepEqual(alreadyPublished.writeCalls, [], "an already-published plan was re-stamped");

  const alreadyUnpublished = harness({ plan: { id: PLAN_ID, publishedAt: null } });
  assert.deepEqual(await run(alreadyUnpublished, "UNPUBLISH"), {
    ok: true,
    status: "NO_CHANGE",
    publishedAt: null,
  });
  assert.deepEqual(alreadyUnpublished.writeCalls, [], "an unpublished plan was written to");
});

test("18. re-publishing NEVER moves the stored instant forward", async () => {
  const h = harness({ plan: { id: PLAN_ID, publishedAt: EARLIER }, now: NOW });
  const result = await run(h, "PUBLISH");
  assert.equal(result.ok, true);
  assert.equal(result.ok === true ? result.publishedAt : "unreachable", EARLIER);
  assert.notEqual(result.ok === true ? result.publishedAt : null, NOW);
  assert.deepEqual(h.writeCalls, []);
});

test("19. a concurrent change is a stale write, NOT an overwrite and NOT a retry", async () => {
  for (const [operation, plan] of [
    ["PUBLISH", { id: PLAN_ID, publishedAt: null }],
    ["UNPUBLISH", { id: PLAN_ID, publishedAt: EARLIER }],
  ] as const) {
    const h = harness({ plan, writeSucceeds: false });
    assert.deepEqual(await run(h, operation), { ok: false, code: "stale_write" });
    // ONE attempt, never a second: a retry would clobber the newer state.
    assert.equal(h.writeCalls.length, 1, "the write was retried");
    assert.equal(h.findCalls.length, 1, "the plan was re-read");
  }
});

// ===========================================================================
// 20–22. The redirect, and the shape of what is returned
// ===========================================================================

test("20. a framework redirect propagates UNTOUCHED from the boundary and from the gate", async () => {
  const redirect = frameworkRedirect();
  const h = harness({ authThrows: redirect });
  await assert.rejects(
    () => run(h, "PUBLISH"),
    (error: unknown) => {
      assert.equal(error, redirect, "the redirect identity was not preserved");
      assert.equal((error as { digest?: string }).digest?.startsWith("NEXT_" + "REDIRECT"), true);
      return true;
    },
  );
  assert.deepEqual(h.log.map((entry) => entry.kind), ["auth"]);

  const gateRedirect = frameworkRedirect();
  const gated = harness({ gateThrows: gateRedirect });
  await assert.rejects(() => run(gated, "PUBLISH"), (error: unknown) => error === gateRedirect);
  assert.deepEqual(gated.findCalls, []);
  assert.deepEqual(gated.writeCalls, []);
});

test("21. an unexpected dependency failure propagates unchanged", async () => {
  const boom = new Error("connection reset");
  const h = harness();
  h.deps.findPlanPublicationByCourseOfferingId = async () => {
    throw boom;
  };
  await assert.rejects(
    () => run(h, "PUBLISH"),
    (error: unknown) => {
      assert.equal(error, boom, "the error identity was not preserved");
      return true;
    },
  );
  assert.deepEqual(h.writeCalls, []);
});

test("22. every result is frozen, JSON-safe, and leaks no id, status or Date", async () => {
  const results = [
    await run(harness({ plan: { id: PLAN_ID, publishedAt: null } }), "PUBLISH"),
    await run(harness({ plan: { id: PLAN_ID, publishedAt: EARLIER } }), "UNPUBLISH"),
    await run(harness({ plan: { id: PLAN_ID, publishedAt: EARLIER } }), "PUBLISH"),
    await run(harness({ plan: null }), "PUBLISH"),
    await run(harness({ plan: { id: PLAN_ID, publishedAt: null }, writeSucceeds: false }), "PUBLISH"),
    await run(harness(), "TOGGLE"),
  ];
  for (const result of results) {
    assert.ok(Object.isFrozen(result), "the result is mutable");
    assert.deepEqual(JSON.parse(JSON.stringify(result)), result, "the result is not JSON-safe");
    const serialized = JSON.stringify(result);
    for (const leak of [PLAN_ID, VERIFIED_OFFERING_ID, REQUESTED_OFFERING_ID, "ACTIVE"]) {
      assert.equal(serialized.includes(leak), false, `the result leaks ${leak}`);
    }
  }
  // Exactly two shapes, and the success arm carries a number or null — never a
  // calendar object a Server Action would have to serialize.
  for (const result of results) {
    assert.deepEqual(
      Object.keys(result).sort(),
      result.ok ? ["ok", "publishedAt", "status"] : ["code", "ok"],
    );
    if (result.ok) {
      assert.ok(
        result.publishedAt === null || typeof result.publishedAt === "number",
        "publishedAt is not a plain number or null",
      );
    }
  }
});

// ===========================================================================
// 23–25. SOURCE TEXT — purity, and the single meaning of publishedAt
// ===========================================================================

test("23. the core imports NOTHING and touches no client, clock or framework", () => {
  assert.deepEqual([...CODE.matchAll(/^\s*import\s/gm)].length, 0, "the core imports something");
  assert.deepEqual([...CODE.matchAll(/\bfrom\s+"[^"]+"/g)].map((m) => m[0]), []);
  for (const token of [
    "server" + "-only",
    "use " + "server",
    "use " + "client",
    "prisma",
    "Prisma",
    "$transaction",
    "queryRaw",
    "executeRaw",
    "Date.now",
    "new Date",
    "Math.random",
    "process" + ".env",
    "next/",
    "revalidate",
    "cookies(",
    "headers(",
    "redirect(",
    "fetch(",
  ]) {
    assert.equal(CODE.includes(token), false, `the core references ${token}`);
  }
});

test("24. the core writes ONE column and knows nothing of individual publication", () => {
  for (const token of [
    "individualPublishedAt",
    "examSession",
    "examDefinition",
    "examAssignment",
    "examSessionBreak",
    "supervisor",
    "Supervisor",
    "pairing",
    "notification",
    "Notification",
    "web-push",
    "sourceDate",
    "teachingPractice",
    "capability",
    "Capability",
  ]) {
    assert.equal(CODE.includes(token), false, `the core references ${token}`);
  }
  // The MVP's deliberate omissions are documented, so they read as a decision.
  assert.ok(/no pairing check/i.test(SOURCE), "the omitted readiness checks are undocumented");
  assert.ok(/individualPublishedAt/.test(SOURCE), "the per-session column is not disclaimed");
});

test("25. the file pair exists, and neither is a UI file", () => {
  for (const rel of [CORE_REL, CORE_TEST_REL]) {
    assert.ok(statSync(join(REPO_ROOT, rel)).isFile(), `${rel} is missing`);
    assert.equal(rel.endsWith(".tsx"), false, `${rel} is a UI file`);
  }
  // The three exported entry points, and nothing else that mutates.
  const exported = [...SOURCE.matchAll(/export (?:async )?function (\w+)\(/g)].map(
    ([, name]) => name,
  );
  assert.deepEqual(exported.sort(), [
    "decideExamPlanPublication",
    "isExamPublicationOperation",
    "setExamPlanPublicationWithDeps",
  ]);
});
