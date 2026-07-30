/**
 * EXAM EX-SUP-C1 — executable tests for the PURE supervisor REMOVAL
 * orchestration (delete-exam-supervisor-core.ts).
 *
 * Run with: npx tsx --test lib/exam/delete-exam-supervisor-core.test.ts
 *
 * DB-FREE: every dependency is a fake, no database connection is opened, no SQL
 * is executed, no environment variable is read, and no production identifier
 * appears anywhere. The only files read are module SOURCE TEXTS, by the
 * structural guards at the bottom.
 *
 * SCOPE OF PROOF:
 *   - the LOCKED ORDER: authorize -> gate -> resolve plan -> validate target ->
 *     verify under the plan -> delete, and, for every failure, exactly WHICH
 *     later dependencies are skipped;
 *   - that the VERIFIED offering id — never the requested one — reaches the plan
 *     lookup, and that the supervisor is resolved under the SERVER-RESOLVED plan;
 *   - that the STORED id, and NEVER the submitted one, reaches the delete;
 *   - that a foreign-plan supervisor and a missing one are one answer;
 *   - that there is no staleness token, no ordering, no cascade of the core's own
 *     and no tally;
 *   - that everything unclassified — including a redirect-shaped throw —
 *     propagates unchanged with its identity intact;
 *   - the result model: narrow, plain, frozen, JSON-round-trippable, non-echoing.
 *
 * NOTE ON IDS: the fixtures use obviously-fake, hyphenated ids, and the requested
 * and stored values are deliberately DIFFERENT so a test can prove which one
 * flows onward. No cuid-shaped or production identifier is written here.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  deleteExamSupervisorWithDeps,
  type DeleteExamSupervisorDeps,
  type DeleteExamSupervisorResult,
  type ExistingExamSupervisorForDelete,
  type ResolvedExamPlanForSupervisorDelete,
} from "./delete-exam-supervisor-core";

// ===========================================================================
// Fixtures
// ===========================================================================

/** What the caller ASKS for. Deliberately different from what is verified. */
const REQUESTED_OFFERING_ID = "offering-a-as-requested";
/** What the boundary VERIFIED. Only this may reach the plan lookup. */
const VERIFIED_OFFERING_ID = "offering-a-as-verified";
/** The plan the SERVER resolved. Only this may reach the scoped read. */
const SERVER_PLAN_ID = "plan-a-resolved-by-server";

/** The target the CLIENT submitted. */
const REQUESTED_SUPERVISOR_ID = "supervisor-a-as-requested";
/** The id of the row the plan-scoped read actually returned. */
const STORED_SUPERVISOR_ID = "supervisor-a-as-stored";

/** The typed not-found the real course boundary throws. */
class FakeCourseNotFoundError extends Error {}
/** The typed denial the real lifecycle policy throws. */
class FakeOperationDeniedError extends Error {}

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
  readonly plan?: ResolvedExamPlanForSupervisorDelete | null;
  readonly existing?: ExistingExamSupervisorForDelete | null;
  readonly contextThrows?: unknown;
  readonly gateThrows?: unknown;
  readonly planThrows?: unknown;
  readonly readThrows?: unknown;
  readonly deleteThrows?: unknown;
}

interface Harness {
  /** Dependency names, in the exact order they were invoked. */
  readonly calls: string[];
  readonly contextArgs: string[];
  readonly gateArgs: string[];
  readonly planLookupArgs: string[];
  readonly readArgs: { planId: string; supervisorId: string }[];
  readonly deleteArgs: string[];
  readonly deps: DeleteExamSupervisorDeps;
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
  const readArgs: { planId: string; supervisorId: string }[] = [];
  const deleteArgs: string[] = [];

  const deps: DeleteExamSupervisorDeps = {
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
    findSupervisorForPlan: async (planId, supervisorId) => {
      calls.push("findSupervisorForPlan");
      readArgs.push({ planId, supervisorId });
      if ("readThrows" in options) throw options.readThrows;
      return options.existing === undefined ? { id: STORED_SUPERVISOR_ID } : options.existing;
    },
    deleteSupervisor: async (supervisorId) => {
      calls.push("deleteSupervisor");
      deleteArgs.push(supervisorId);
      if ("deleteThrows" in options) throw options.deleteThrows;
    },
    isCourseNotFoundError: (error) => error instanceof FakeCourseNotFoundError,
    isOperationNotAllowedError: (error) => error instanceof FakeOperationDeniedError,
  };

  return { calls, contextArgs, gateArgs, planLookupArgs, readArgs, deleteArgs, deps };
}

const FULL_ORDER = [
  "requireCourseContext",
  "assertConfigurationAllowed",
  "findExamPlanByCourseOfferingId",
  "findSupervisorForPlan",
  "deleteSupervisor",
];

// ===========================================================================
// 1–6. The happy path and the locked order
// ===========================================================================

test("D1. a well-formed removal succeeds, reporting nothing but `ok`", async () => {
  const h = harness();
  const result = await deleteExamSupervisorWithDeps(
    REQUESTED_OFFERING_ID,
    REQUESTED_SUPERVISOR_ID,
    h.deps,
  );
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(Object.keys(result), ["ok"]);
});

test("D2. the dependencies run in EXACTLY the locked order, once each", async () => {
  const h = harness();
  await deleteExamSupervisorWithDeps(REQUESTED_OFFERING_ID, REQUESTED_SUPERVISOR_ID, h.deps);
  assert.deepEqual(h.calls, FULL_ORDER);
});

test("D3. only the REQUESTED offering reaches the boundary; only the VERIFIED one goes on", async () => {
  const h = harness();
  await deleteExamSupervisorWithDeps(REQUESTED_OFFERING_ID, REQUESTED_SUPERVISOR_ID, h.deps);
  assert.deepEqual(h.contextArgs, [REQUESTED_OFFERING_ID]);
  assert.deepEqual(h.planLookupArgs, [VERIFIED_OFFERING_ID]);
  const serialized = JSON.stringify({
    plan: h.planLookupArgs,
    read: h.readArgs,
    write: h.deleteArgs,
  });
  assert.equal(
    serialized.includes(REQUESTED_OFFERING_ID),
    false,
    "the requested offering id reached a later dependency",
  );
});

test("D4. the gate sees the VERIFIED status", async () => {
  const h = harness({ status: "DRAFT" });
  await deleteExamSupervisorWithDeps(REQUESTED_OFFERING_ID, REQUESTED_SUPERVISOR_ID, h.deps);
  assert.deepEqual(h.gateArgs, ["DRAFT"]);
});

test("D5. the supervisor is read UNDER the server-resolved plan, with the TRIMMED target", async () => {
  const h = harness();
  await deleteExamSupervisorWithDeps(
    REQUESTED_OFFERING_ID,
    `  ${REQUESTED_SUPERVISOR_ID}\t\n`,
    h.deps,
  );
  assert.deepEqual(h.readArgs, [
    { planId: SERVER_PLAN_ID, supervisorId: REQUESTED_SUPERVISOR_ID },
  ]);
});

test("D6. the delete receives the STORED id, and the SUBMITTED id never reaches it", async () => {
  const h = harness();
  await deleteExamSupervisorWithDeps(REQUESTED_OFFERING_ID, REQUESTED_SUPERVISOR_ID, h.deps);
  assert.deepEqual(h.deleteArgs, [STORED_SUPERVISOR_ID]);
  assert.equal(
    h.deleteArgs.includes(REQUESTED_SUPERVISOR_ID),
    false,
    "the submitted raw id reached the delete dependency",
  );
});

// ===========================================================================
// 7–12. Every refusal, and exactly which dependencies it skips
// ===========================================================================

test("D7. a not-found offering refuses, and NOTHING else runs", async () => {
  const h = harness({ contextThrows: new FakeCourseNotFoundError("nope") });
  const result = await deleteExamSupervisorWithDeps(
    REQUESTED_OFFERING_ID,
    REQUESTED_SUPERVISOR_ID,
    h.deps,
  );
  assert.deepEqual(result, { ok: false, code: "offering_not_found" });
  assert.deepEqual(h.calls, FULL_ORDER.slice(0, 1));
});

test("D8. a denied lifecycle refuses, and no exam query happens at all", async () => {
  const h = harness({ status: "ARCHIVED", gateThrows: new FakeOperationDeniedError("nope") });
  const result = await deleteExamSupervisorWithDeps(
    REQUESTED_OFFERING_ID,
    REQUESTED_SUPERVISOR_ID,
    h.deps,
  );
  assert.deepEqual(result, { ok: false, code: "operation_not_allowed" });
  assert.deepEqual(h.calls, FULL_ORDER.slice(0, 2));
});

test("D9. a missing plan refuses, and the target is never even examined", async () => {
  const h = harness({ plan: null });
  const result = await deleteExamSupervisorWithDeps(
    REQUESTED_OFFERING_ID,
    REQUESTED_SUPERVISOR_ID,
    h.deps,
  );
  assert.deepEqual(result, { ok: false, code: "plan_not_found" });
  assert.deepEqual(h.calls, FULL_ORDER.slice(0, 3));
});

test("D10. a MALFORMED target is invalid_input, and nothing is read or deleted", async () => {
  for (const target of [
    undefined,
    null,
    "",
    "   ",
    "\t\n",
    0,
    42,
    true,
    [],
    [REQUESTED_SUPERVISOR_ID],
    {},
    { supervisorId: REQUESTED_SUPERVISOR_ID },
    () => REQUESTED_SUPERVISOR_ID,
    Symbol("s"),
    BigInt(3),
  ]) {
    const h = harness();
    const result = await deleteExamSupervisorWithDeps(REQUESTED_OFFERING_ID, target, h.deps);
    assert.deepEqual(
      result,
      { ok: false, code: "invalid_input" },
      `target ${String(typeof target)} was accepted`,
    );
    assert.deepEqual(h.calls, FULL_ORDER.slice(0, 3));
    assert.deepEqual(h.deleteArgs, []);
  }
});

test("D11. a missing OR FOREIGN-PLAN supervisor is one indistinguishable refusal", async () => {
  const h = harness({ existing: null });
  const result = await deleteExamSupervisorWithDeps(
    REQUESTED_OFFERING_ID,
    REQUESTED_SUPERVISOR_ID,
    h.deps,
  );
  assert.deepEqual(result, { ok: false, code: "supervisor_not_found" });
  assert.deepEqual(h.calls, FULL_ORDER.slice(0, 4));
  assert.deepEqual(h.deleteArgs, []);

  // An id from another identifier space receives the SAME ordinary refusal: the
  // plan-scoped read is the only way a supervisor can be found.
  const other = harness({ existing: null });
  const otherResult = await deleteExamSupervisorWithDeps(
    REQUESTED_OFFERING_ID,
    "other-space:1234",
    other.deps,
  );
  assert.deepEqual(otherResult, { ok: false, code: "supervisor_not_found" });
  assert.deepEqual(other.readArgs, [{ planId: SERVER_PLAN_ID, supervisorId: "other-space:1234" }]);
});

test("D12. a refusal NEVER runs a later dependency, on any path", async () => {
  const cases: { options: HarnessOptions; target: unknown; expected: string[] }[] = [
    {
      options: { contextThrows: new FakeCourseNotFoundError() },
      target: REQUESTED_SUPERVISOR_ID,
      expected: FULL_ORDER.slice(0, 1),
    },
    {
      options: { gateThrows: new FakeOperationDeniedError() },
      target: REQUESTED_SUPERVISOR_ID,
      expected: FULL_ORDER.slice(0, 2),
    },
    { options: { plan: null }, target: REQUESTED_SUPERVISOR_ID, expected: FULL_ORDER.slice(0, 3) },
    { options: {}, target: "  ", expected: FULL_ORDER.slice(0, 3) },
    { options: { existing: null }, target: REQUESTED_SUPERVISOR_ID, expected: FULL_ORDER.slice(0, 4) },
  ];
  for (const { options, target, expected } of cases) {
    const h = harness(options);
    await deleteExamSupervisorWithDeps(REQUESTED_OFFERING_ID, target, h.deps);
    assert.deepEqual(h.calls, expected);
  }
});

// ===========================================================================
// 13–16. Error classification
// ===========================================================================

/** The five dependency call sites at which a throw can originate. */
type ThrowSite =
  | "contextThrows"
  | "gateThrows"
  | "planThrows"
  | "readThrows"
  | "deleteThrows";

/** Options that make exactly ONE dependency throw exactly this value. */
function throwingAt(site: ThrowSite, thrown: unknown): HarnessOptions {
  return { [site]: thrown } as unknown as HarnessOptions;
}

const THROW_SITES: ThrowSite[] = [
  "contextThrows",
  "gateThrows",
  "planThrows",
  "readThrows",
  "deleteThrows",
];

test("D13. an UNRECOGNIZED throw from any dependency propagates with its identity", async () => {
  const sentinel = new Error("INFRASTRUCTURE_SENTINEL");
  for (const site of THROW_SITES) {
    const h = harness(throwingAt(site, sentinel));
    await assert.rejects(
      () =>
        deleteExamSupervisorWithDeps(REQUESTED_OFFERING_ID, REQUESTED_SUPERVISOR_ID, h.deps),
      (error: unknown) => {
        assert.equal(error, sentinel, `${site} did not propagate the SAME object`);
        return true;
      },
    );
  }
});

test("D14. a REDIRECT-shaped throw is NEVER converted into a refusal", async () => {
  for (const site of ["contextThrows", "gateThrows"] as const) {
    const redirect = redirectLikeError();
    const h = harness(throwingAt(site, redirect));
    await assert.rejects(
      () =>
        deleteExamSupervisorWithDeps(REQUESTED_OFFERING_ID, REQUESTED_SUPERVISOR_ID, h.deps),
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

test("D15. each classifier is asked ONLY where its failure can occur", async () => {
  const atGate = harness({ gateThrows: new FakeCourseNotFoundError("wrong place") });
  await assert.rejects(() =>
    deleteExamSupervisorWithDeps(REQUESTED_OFFERING_ID, REQUESTED_SUPERVISOR_ID, atGate.deps),
  );
  const atContext = harness({ contextThrows: new FakeOperationDeniedError("wrong place") });
  await assert.rejects(() =>
    deleteExamSupervisorWithDeps(REQUESTED_OFFERING_ID, REQUESTED_SUPERVISOR_ID, atContext.deps),
  );
  // A row that vanishes BETWEEN the verification and the write is an unexpected
  // error, never laundered into `supervisor_not_found`.
  const vanished = harness({ deleteThrows: new FakeCourseNotFoundError("gone") });
  await assert.rejects(() =>
    deleteExamSupervisorWithDeps(REQUESTED_OFFERING_ID, REQUESTED_SUPERVISOR_ID, vanished.deps),
  );
});

test("D16. a thrown NON-ERROR value propagates unchanged too", async () => {
  for (const thrown of ["a string", 0, null, { code: "P2025" }]) {
    const h = harness({ deleteThrows: thrown });
    await assert.rejects(
      () =>
        deleteExamSupervisorWithDeps(REQUESTED_OFFERING_ID, REQUESTED_SUPERVISOR_ID, h.deps),
      (error: unknown) => {
        assert.equal(error, thrown);
        return true;
      },
    );
  }
});

// ===========================================================================
// 17–21. The boundary and the result model
// ===========================================================================

test("D17. the injected boundary is EXACTLY the seven approved dependencies", () => {
  const h = harness();
  assert.deepEqual(Object.keys(h.deps).sort(), [
    "assertConfigurationAllowed",
    "deleteSupervisor",
    "findExamPlanByCourseOfferingId",
    "findSupervisorForPlan",
    "isCourseNotFoundError",
    "isOperationNotAllowedError",
    "requireCourseContext",
  ]);
  // No dependency can create, edit, reorder, tally, cascade, notify or resolve a
  // permission: the operation is structurally incapable of it.
  for (const forbidden of [
    /create/i,
    /update/i,
    /reorder/i,
    /order/i,
    /count/i,
    /cascade/i,
    /notif/i,
    /permission/i,
  ]) {
    assert.equal(
      Object.keys(h.deps).some((name) => forbidden.test(name)),
      false,
      `the boundary exposes a ${forbidden} dependency`,
    );
  }
  // ...and exactly ONE dependency deletes, taking exactly ONE id.
  assert.equal(h.deps.deleteSupervisor.length, 1);
});

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

async function everyResult(): Promise<DeleteExamSupervisorResult[]> {
  return Promise.all([
    deleteExamSupervisorWithDeps(REQUESTED_OFFERING_ID, REQUESTED_SUPERVISOR_ID, harness().deps),
    deleteExamSupervisorWithDeps(REQUESTED_OFFERING_ID, "  ", harness().deps),
    deleteExamSupervisorWithDeps(
      REQUESTED_OFFERING_ID,
      REQUESTED_SUPERVISOR_ID,
      harness({ contextThrows: new FakeCourseNotFoundError() }).deps,
    ),
    deleteExamSupervisorWithDeps(
      REQUESTED_OFFERING_ID,
      REQUESTED_SUPERVISOR_ID,
      harness({ gateThrows: new FakeOperationDeniedError() }).deps,
    ),
    deleteExamSupervisorWithDeps(
      REQUESTED_OFFERING_ID,
      REQUESTED_SUPERVISOR_ID,
      harness({ plan: null }).deps,
    ),
    deleteExamSupervisorWithDeps(
      REQUESTED_OFFERING_ID,
      REQUESTED_SUPERVISOR_ID,
      harness({ existing: null }).deps,
    ),
  ]);
}

test("D18. every result is frozen, plain and JSON-safe, and round-trips", async () => {
  for (const result of await everyResult()) {
    assertPlainFrozenJsonSafe(result);
    assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  }
});

test("D19. NO result carries an id, a tally or any submitted value", async () => {
  for (const result of await everyResult()) {
    const serialized = JSON.stringify(result);
    for (const secret of [
      REQUESTED_OFFERING_ID,
      VERIFIED_OFFERING_ID,
      SERVER_PLAN_ID,
      REQUESTED_SUPERVISOR_ID,
      STORED_SUPERVISOR_ID,
    ]) {
      assert.equal(serialized.includes(secret), false, `a result echoes ${secret}`);
    }
    assert.ok(
      Object.keys(result).length <= 2,
      `a result carries more than ok + code: ${serialized}`,
    );
    assert.equal(Object.prototype.hasOwnProperty.call(result, "issues"), false);
  }
});

test("D20. exactly the six approved outcomes are reachable", async () => {
  const outcomes = (await everyResult()).map((result) => (result.ok ? "ok" : result.code));
  assert.deepEqual([...new Set(outcomes)].sort(), [
    "invalid_input",
    "offering_not_found",
    "ok",
    "operation_not_allowed",
    "plan_not_found",
    "supervisor_not_found",
  ]);
});

test("D21. two runs return independent, non-aliasing results", async () => {
  const [a, b] = await Promise.all([
    deleteExamSupervisorWithDeps(REQUESTED_OFFERING_ID, REQUESTED_SUPERVISOR_ID, harness().deps),
    deleteExamSupervisorWithDeps(REQUESTED_OFFERING_ID, REQUESTED_SUPERVISOR_ID, harness().deps),
  ]);
  assert.deepEqual(a, b);
  assert.notEqual(a as unknown, b as unknown);
});

// ===========================================================================
// 22–30. Structural guards
// ===========================================================================

const EXAM_DIR = import.meta.dirname;
const MODULE_NAME = "delete-exam-supervisor-core.ts";
const TEST_NAME = "delete-exam-supervisor-core.test.ts";
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

test("D22. the pure core imports no database client and performs no IO", () => {
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

test("D23. the pure core imports no auth, app, framework or action module", () => {
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

test("D24. the pure core reads, revokes and checks NO permission of any kind", () => {
  for (const token of [
    '"EXAMS"',
    "'EXAMS'",
    "CapabilityKey",
    "capability",
    "Capability",
    "getEffectiveCapabilities",
    "revoke",
    "canView",
  ]) {
    assert.equal(CODE.includes(token), false, `the pure core consults ${token}`);
  }
  assert.ok(
    /operational relationship/i.test(COMMENTS),
    "the operational-relationship decision is undocumented",
  );
});

test("D25. the pure core has NO calendar type, clock, randomness or process access", () => {
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

test("D26. the pure core imports ONLY its sibling input core and restates no rule", () => {
  const specifiers = [...CODE.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(specifiers)], ["./exam-supervisor-write-core"]);
  assert.ok(
    /normalizeExamSupervisorDeleteInput/.test(CODE),
    "the sibling normalizer is not consulted",
  );
  for (const token of ["trim()", "String(", "Number(", "toLowerCase", "toUpperCase"]) {
    assert.equal(CODE.includes(token), false, `the pure core restates ${token}`);
  }
});

test("D27. the orchestration exports exactly one function with the approved signature", () => {
  const functions = [...SOURCE.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)].map(
    (m) => m[1],
  );
  assert.deepEqual(functions, ["deleteExamSupervisorWithDeps"]);

  const orchestration = [
    ...SOURCE.matchAll(/export async function (\w+)\(([\s\S]*?)\):\s*([^{]+)\{/g),
  ].map(([, name, params, returns]) => ({
    name,
    params: params.replace(/\s+/g, " ").trim(),
    returns: returns.replace(/\s+/g, " ").trim(),
  }))[0];
  assert.equal(orchestration.name, "deleteExamSupervisorWithDeps");
  assert.equal(
    orchestration.params,
    "courseOfferingId: string, supervisorId: unknown, deps: DeleteExamSupervisorDeps,",
  );
  assert.equal(orchestration.returns, "Promise<DeleteExamSupervisorResult>");
  for (const forbidden of ["planId", "sessionId", "instructorId", "actorId", "tx:", "prisma"]) {
    assert.equal(
      orchestration.params.includes(forbidden),
      false,
      `the orchestration accepts ${forbidden}`,
    );
  }

  const types = [...SOURCE.matchAll(/^export\s+(?:type|interface)\s+(\w+)/gm)].map((m) => m[1]);
  assert.deepEqual(types.sort(), [
    "DeleteExamSupervisorDeps",
    "DeleteExamSupervisorRefusalCode",
    "DeleteExamSupervisorResult",
    "ExistingExamSupervisorForDelete",
    "ResolvedExamPlanForSupervisorDelete",
    "VerifiedExamSupervisorCourseContext",
  ]);
});

test("D28. no result code beyond the five approved outcomes exists", () => {
  const codes = [...CODE.matchAll(/refuse\("([a-z_]+)"\)|code: "([a-z_]+)"/g)]
    .map((m) => m[1] ?? m[2])
    .filter((code): code is string => typeof code === "string");
  assert.deepEqual([...new Set(codes)].sort(), [
    "invalid_input",
    "offering_not_found",
    "operation_not_allowed",
    "plan_not_found",
    "supervisor_not_found",
  ]);
  for (const token of [
    "unexpected",
    "stale_write",
    "conflict",
    "archived",
    "session_not_found",
    "already_supervising",
  ]) {
    assert.equal(CODE.includes(token), false, `the pure core invents ${token}`);
  }
});

test("D29. exactly two classifiers exist, and no raw error is inspected", () => {
  const predicates = [...CODE.matchAll(/\bis[A-Z]\w+Error\b/g)].map((m) => m[0]);
  assert.deepEqual([...new Set(predicates)].sort(), [
    "isCourseNotFoundError",
    "isOperationNotAllowedError",
  ]);
  for (const token of ["P2002", "P2003", "P2025", "error.code", "error.message", "instanceof"]) {
    assert.equal(CODE.includes(token), false, `the pure core inspects ${token}`);
  }
  const tryBlocks = CODE.match(/try \{/g) ?? [];
  assert.equal(tryBlocks.length, 2, "the number of guarded calls changed");
  assert.equal((CODE.match(/throw error;/g) ?? []).length, 2, "an unrecognized throw is swallowed");
  assert.ok(/NEXT_REDIRECT/.test(COMMENTS), "the redirect rule is undocumented");
});

test("D30. NO staleness token, ordering, cascade or tally exists, and the reasons are written down", () => {
  for (const token of [
    "expectedUpdatedAt",
    "updatedAt",
    "version",
    "Version",
    "isCurrent",
    "IfCurrent",
    "orderIndex",
    "reorder",
    "Reorder",
    "cascade",
    "Cascade",
    "count",
    "Count",
    "tally",
    "isPrimary",
    "examinerSet",
  ]) {
    assert.equal(CODE.includes(token), false, `the pure core carries ${token}`);
  }
  // The four reasons, and the future obligation, must all be written down.
  const prose = COMMENTS.replace(/\s+/g, " ");
  assert.ok(/immutable/i.test(prose), "the immutability premise is unstated");
  assert.ok(/same row/i.test(prose), "the stable-identifier premise is unstated");
  assert.ok(/supervisor_not_found/.test(prose), "the already-gone outcome is unstated");
  assert.ok(
    /update/i.test(prose) && /stale-write/i.test(prose),
    "the future update flow's obligation is unstated",
  );
  assert.ok(/unordered set/i.test(prose), "the unordered-set premise is unstated");
});

test("D31. the slice's two lib/exam files are exactly the approved pair", () => {
  const sliceFiles = readdirSync(EXAM_DIR)
    .filter((name) => name.startsWith("delete-exam-supervisor-core"))
    .sort();
  assert.deepEqual(sliceFiles, [MODULE_NAME, TEST_NAME].sort());
});

test("D32. this suite opens no database and reads no environment", () => {
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
      "./delete-exam-supervisor-core",
      "node:assert/strict",
      "node:fs",
      "node:path",
      "node:test",
    ],
  );
});
