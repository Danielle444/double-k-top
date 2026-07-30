/**
 * EXAM EX-ASG-C1 — executable tests for the PURE stored-ExamAssignment REMOVAL
 * orchestration (delete-exam-assignment-core.ts).
 *
 * Run with: npx tsx --test lib/exam/delete-exam-assignment-core.test.ts
 *
 * DB-FREE: every dependency is a fake, no database connection is opened, no SQL
 * is executed, no environment variable is read, and no production identifier
 * appears anywhere. The only files read are module SOURCE TEXTS, by the
 * structural guards at the bottom.
 *
 * SCOPE OF PROOF:
 *   - the LOCKED ORDER: authorize -> gate -> resolve plan -> validate target ->
 *     resolve assignment under that plan -> delete, and, for every failure,
 *     exactly WHICH later dependencies are skipped;
 *   - that the VERIFIED offering id — never the requested one — reaches the plan
 *     lookup, and that the assignment is resolved under the SERVER-RESOLVED plan;
 *   - that the id handed to the delete is the one the SCOPED READ returned;
 *   - that a malformed target fails closed for every non-string value;
 *   - that a missing or FOREIGN assignment is one indistinguishable refusal;
 *   - that no version token exists, and that the reasoning for its absence is
 *     written down rather than assumed;
 *   - that only the two known failures are classified and everything else —
 *     including a redirect-shaped throw — propagates unchanged;
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
  deleteExamAssignmentWithDeps,
  type DeleteExamAssignmentDeps,
  type DeleteExamAssignmentResult,
  type ExistingExamAssignmentForDelete,
  type ResolvedExamPlanForAssignmentDelete,
} from "./delete-exam-assignment-core";

// ===========================================================================
// Fixtures
// ===========================================================================

/** What the caller ASKS for. Deliberately different from what is verified. */
const REQUESTED_OFFERING_ID = "offering-as-requested";
/** What the boundary VERIFIED. Only this may reach the plan lookup. */
const VERIFIED_OFFERING_ID = "offering-as-verified";
/** The plan the SERVER resolved. Only this may reach the scoped read. */
const SERVER_PLAN_ID = "plan-resolved-by-server";

/** The assignment id the CALLER routed the removal at. */
const REQUESTED_ASSIGNMENT_ID = "assignment-as-requested";
/**
 * The id of the row the plan-scoped read actually returned. In production the two
 * are equal; they are deliberately DIFFERENT here so a test can prove which one
 * flows onward to the delete.
 */
const STORED_ASSIGNMENT_ID = "assignment-as-stored";

function storedAssignment(
  over: Partial<ExistingExamAssignmentForDelete> = {},
): ExistingExamAssignmentForDelete {
  return { id: STORED_ASSIGNMENT_ID, ...over };
}

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

/** A file-like upload value: it has a `name`, and must contribute nothing. */
class FileLike {
  readonly name = "assignment.png";
  readonly size = 1;
  toString(): string {
    return "COERCED-FILE-NAME";
  }
}

/** Every target value that must fail closed. */
const MALFORMED_TARGETS: readonly unknown[] = [
  null,
  undefined,
  "",
  "   ",
  "\t\n",
  0,
  1,
  Number.NaN,
  true,
  false,
  [],
  [REQUESTED_ASSIGNMENT_ID],
  {},
  { id: REQUESTED_ASSIGNMENT_ID },
  { toString: () => "COERCED-OBJECT" },
  new FileLike(),
  () => REQUESTED_ASSIGNMENT_ID,
  Symbol("s"),
  BigInt(10),
];

interface HarnessOptions {
  readonly status?: string;
  readonly plan?: ResolvedExamPlanForAssignmentDelete | null;
  readonly assignment?: ExistingExamAssignmentForDelete | null;
  readonly contextThrows?: unknown;
  readonly gateThrows?: unknown;
  readonly planThrows?: unknown;
  readonly assignmentThrows?: unknown;
  readonly deleteThrows?: unknown;
}

interface Harness {
  /** Dependency names, in the exact order they were invoked. */
  readonly calls: string[];
  readonly contextArgs: string[];
  readonly gateArgs: string[];
  readonly planLookupArgs: string[];
  readonly assignmentArgs: { planId: string; assignmentId: string }[];
  readonly deleteArgs: string[];
  readonly deps: DeleteExamAssignmentDeps;
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
  const assignmentArgs: { planId: string; assignmentId: string }[] = [];
  const deleteArgs: string[] = [];

  const deps: DeleteExamAssignmentDeps = {
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
    findAssignmentForPlan: async (planId, assignmentId) => {
      calls.push("findAssignmentForPlan");
      assignmentArgs.push({ planId, assignmentId });
      if ("assignmentThrows" in options) throw options.assignmentThrows;
      return options.assignment === undefined ? storedAssignment() : options.assignment;
    },
    deleteAssignmentById: async (assignmentId) => {
      calls.push("deleteAssignmentById");
      deleteArgs.push(assignmentId);
      if ("deleteThrows" in options) throw options.deleteThrows;
    },
    isCourseNotFoundError: (error) => error instanceof FakeCourseNotFoundError,
    isOperationNotAllowedError: (error) => error instanceof FakeOperationDeniedError,
  };

  return { calls, contextArgs, gateArgs, planLookupArgs, assignmentArgs, deleteArgs, deps };
}

const FULL_ORDER = [
  "requireCourseContext",
  "assertConfigurationAllowed",
  "findExamPlanByCourseOfferingId",
  "findAssignmentForPlan",
  "deleteAssignmentById",
];

/** The five dependency call sites at which a throw can originate. */
type ThrowSite =
  | "contextThrows"
  | "gateThrows"
  | "planThrows"
  | "assignmentThrows"
  | "deleteThrows";

/** Options that make exactly ONE dependency throw exactly this value. */
function throwingAt(site: ThrowSite, thrown: unknown): HarnessOptions {
  return { [site]: thrown } as unknown as HarnessOptions;
}

// ===========================================================================
// 1–7. The happy path and the locked order
// ===========================================================================

test("1. a well-formed removal succeeds, reporting nothing but `ok`", async () => {
  const h = harness();
  const result = await deleteExamAssignmentWithDeps(
    REQUESTED_OFFERING_ID,
    REQUESTED_ASSIGNMENT_ID,
    h.deps,
  );
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(Object.keys(result), ["ok"]);
});

test("2. the dependencies run in EXACTLY the locked order, once each", async () => {
  const h = harness();
  await deleteExamAssignmentWithDeps(REQUESTED_OFFERING_ID, REQUESTED_ASSIGNMENT_ID, h.deps);
  assert.deepEqual(h.calls, FULL_ORDER);
});

test("3. the boundary is asked about the REQUESTED offering, and nothing else is", async () => {
  const h = harness();
  await deleteExamAssignmentWithDeps(REQUESTED_OFFERING_ID, REQUESTED_ASSIGNMENT_ID, h.deps);
  assert.deepEqual(h.contextArgs, [REQUESTED_OFFERING_ID]);
  assert.deepEqual(h.planLookupArgs, [VERIFIED_OFFERING_ID]);
  assert.equal(JSON.stringify(h.planLookupArgs).includes(REQUESTED_OFFERING_ID), false);
});

test("4. the gate sees the VERIFIED status", async () => {
  const h = harness({ status: "DRAFT" });
  await deleteExamAssignmentWithDeps(REQUESTED_OFFERING_ID, REQUESTED_ASSIGNMENT_ID, h.deps);
  assert.deepEqual(h.gateArgs, ["DRAFT"]);
});

test("5. the assignment is resolved UNDER the server-resolved plan", async () => {
  const h = harness();
  await deleteExamAssignmentWithDeps(REQUESTED_OFFERING_ID, REQUESTED_ASSIGNMENT_ID, h.deps);
  assert.deepEqual(h.assignmentArgs, [
    { planId: SERVER_PLAN_ID, assignmentId: REQUESTED_ASSIGNMENT_ID },
  ]);
});

test("6. the delete targets the id the SCOPED READ returned, never the submitted one", async () => {
  const h = harness();
  await deleteExamAssignmentWithDeps(REQUESTED_OFFERING_ID, REQUESTED_ASSIGNMENT_ID, h.deps);
  assert.deepEqual(h.deleteArgs, [STORED_ASSIGNMENT_ID]);
  assert.equal(h.deleteArgs.includes(REQUESTED_ASSIGNMENT_ID), false);
});

test("7. the submitted target is TRIMMED before it is used to look anything up", async () => {
  const h = harness();
  await deleteExamAssignmentWithDeps(
    REQUESTED_OFFERING_ID,
    `  ${REQUESTED_ASSIGNMENT_ID}\t`,
    h.deps,
  );
  assert.deepEqual(h.assignmentArgs, [
    { planId: SERVER_PLAN_ID, assignmentId: REQUESTED_ASSIGNMENT_ID },
  ]);
});

// ===========================================================================
// 8–14. Every refusal, and exactly which dependencies it skips
// ===========================================================================

test("8. a not-found offering refuses, and NOTHING else runs", async () => {
  const h = harness({ contextThrows: new FakeCourseNotFoundError("nope") });
  const result = await deleteExamAssignmentWithDeps(
    REQUESTED_OFFERING_ID,
    REQUESTED_ASSIGNMENT_ID,
    h.deps,
  );
  assert.deepEqual(result, { ok: false, code: "offering_not_found" });
  assert.deepEqual(h.calls, ["requireCourseContext"]);
});

test("9. a denied lifecycle refuses, and no exam query happens at all", async () => {
  const h = harness({ status: "ARCHIVED", gateThrows: new FakeOperationDeniedError("nope") });
  const result = await deleteExamAssignmentWithDeps(
    REQUESTED_OFFERING_ID,
    REQUESTED_ASSIGNMENT_ID,
    h.deps,
  );
  assert.deepEqual(result, { ok: false, code: "operation_not_allowed" });
  assert.deepEqual(h.calls, ["requireCourseContext", "assertConfigurationAllowed"]);
});

test("10. a missing plan refuses, and the target is never even examined", async () => {
  const h = harness({ plan: null });
  const result = await deleteExamAssignmentWithDeps(
    REQUESTED_OFFERING_ID,
    REQUESTED_ASSIGNMENT_ID,
    h.deps,
  );
  assert.deepEqual(result, { ok: false, code: "plan_not_found" });
  assert.deepEqual(h.calls, FULL_ORDER.slice(0, 3));
});

test("11. EVERY malformed target fails closed, uncoerced, and reads nothing", async () => {
  for (const target of MALFORMED_TARGETS) {
    const label = typeof target === "symbol" ? "symbol" : String(typeof target);
    const h = harness();
    const result = await deleteExamAssignmentWithDeps(REQUESTED_OFFERING_ID, target, h.deps);
    assert.deepEqual(result, { ok: false, code: "invalid_input" }, `accepted a ${label}`);
    // The scoped read and the delete are never reached: a malformed target
    // cannot be used to probe which assignments exist.
    assert.deepEqual(h.calls, FULL_ORDER.slice(0, 3), `read something for a ${label}`);
    assert.deepEqual(h.deleteArgs, []);
  }
});

test("12. a file-like target contributes NOTHING, not even its name", async () => {
  const h = harness();
  const result = await deleteExamAssignmentWithDeps(REQUESTED_OFFERING_ID, new FileLike(), h.deps);
  assert.deepEqual(result, { ok: false, code: "invalid_input" });
  const serialized = JSON.stringify({ result, args: h.assignmentArgs, deleted: h.deleteArgs });
  for (const token of ["assignment.png", "COERCED"]) {
    assert.equal(serialized.includes(token), false, `the run used ${token}`);
  }
});

test("13. a missing assignment refuses assignment_not_found, deleting nothing", async () => {
  const h = harness({ assignment: null });
  const result = await deleteExamAssignmentWithDeps(
    REQUESTED_OFFERING_ID,
    REQUESTED_ASSIGNMENT_ID,
    h.deps,
  );
  assert.deepEqual(result, { ok: false, code: "assignment_not_found" });
  assert.deepEqual(h.calls, FULL_ORDER.slice(0, 4));
  assert.deepEqual(h.deleteArgs, []);
});

test("14. an assignment of ANOTHER course's plan is the SAME refusal", async () => {
  // The scoped read is the only way an assignment can be found, so a row under
  // another plan comes back as `null` exactly like a missing one, and the two are
  // indistinguishable to the caller.
  const h = harness({ assignment: null });
  const foreign = await deleteExamAssignmentWithDeps(
    REQUESTED_OFFERING_ID,
    "assignment-of-another-course",
    h.deps,
  );
  assert.deepEqual(foreign, { ok: false, code: "assignment_not_found" });
  assert.deepEqual(h.assignmentArgs, [
    { planId: SERVER_PLAN_ID, assignmentId: "assignment-of-another-course" },
  ]);
  // The removal was still scoped to the SERVER's plan, which is what makes a
  // cross-plan removal unreachable rather than merely rejected.
  assert.equal(h.assignmentArgs[0].planId, SERVER_PLAN_ID);
});

// ===========================================================================
// 15–19. Error classification
// ===========================================================================

test("15. an UNRECOGNIZED throw from any dependency propagates with its identity", async () => {
  const sentinel = new Error("INFRASTRUCTURE_SENTINEL");
  const sites: ThrowSite[] = [
    "contextThrows",
    "gateThrows",
    "planThrows",
    "assignmentThrows",
    "deleteThrows",
  ];
  for (const site of sites) {
    const h = harness(throwingAt(site, sentinel));
    await assert.rejects(
      () =>
        deleteExamAssignmentWithDeps(REQUESTED_OFFERING_ID, REQUESTED_ASSIGNMENT_ID, h.deps),
      (error: unknown) => {
        assert.equal(error, sentinel, `${site} did not propagate the SAME object`);
        return true;
      },
    );
  }
});

test("16. a REDIRECT-shaped throw is never converted into a refusal", async () => {
  for (const site of ["contextThrows", "gateThrows"] as const) {
    const redirect = redirectLikeError();
    const h = harness(throwingAt(site, redirect));
    await assert.rejects(
      () =>
        deleteExamAssignmentWithDeps(REQUESTED_OFFERING_ID, REQUESTED_ASSIGNMENT_ID, h.deps),
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

test("17. each classifier is asked ONLY where its failure can occur", async () => {
  const atGate = harness({ gateThrows: new FakeCourseNotFoundError("wrong place") });
  await assert.rejects(() =>
    deleteExamAssignmentWithDeps(REQUESTED_OFFERING_ID, REQUESTED_ASSIGNMENT_ID, atGate.deps),
  );
  const atContext = harness({ contextThrows: new FakeOperationDeniedError("wrong place") });
  await assert.rejects(() =>
    deleteExamAssignmentWithDeps(REQUESTED_OFFERING_ID, REQUESTED_ASSIGNMENT_ID, atContext.deps),
  );
  // ...and NEITHER classifier is consulted at the reads or the write.
  for (const site of ["planThrows", "assignmentThrows", "deleteThrows"] as const) {
    for (const thrown of [new FakeCourseNotFoundError(), new FakeOperationDeniedError()]) {
      const h = harness(throwingAt(site, thrown));
      await assert.rejects(
        () =>
          deleteExamAssignmentWithDeps(REQUESTED_OFFERING_ID, REQUESTED_ASSIGNMENT_ID, h.deps),
        `a known error at ${site} was laundered into a refusal`,
      );
    }
  }
});

test("18. a throw at the DELETE is never laundered into assignment_not_found", async () => {
  // The row disappearing between the verification and the write is the world
  // changing underneath the caller, not a caller mistake.
  const vanished = new Error("ROW_VANISHED");
  const h = harness({ deleteThrows: vanished });
  await assert.rejects(
    () => deleteExamAssignmentWithDeps(REQUESTED_OFFERING_ID, REQUESTED_ASSIGNMENT_ID, h.deps),
    (error: unknown) => {
      assert.equal(error, vanished);
      return true;
    },
  );
});

test("19. a thrown NON-ERROR value propagates unchanged too", async () => {
  for (const thrown of ["a string", 0, null, { code: "P2025" }]) {
    const h = harness({ assignmentThrows: thrown });
    await assert.rejects(
      () => deleteExamAssignmentWithDeps(REQUESTED_OFFERING_ID, REQUESTED_ASSIGNMENT_ID, h.deps),
      (error: unknown) => {
        assert.equal(error, thrown);
        return true;
      },
    );
  }
});

// ===========================================================================
// 20–24. The result model
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

async function everyResult(): Promise<DeleteExamAssignmentResult[]> {
  return Promise.all([
    deleteExamAssignmentWithDeps(REQUESTED_OFFERING_ID, REQUESTED_ASSIGNMENT_ID, harness().deps),
    deleteExamAssignmentWithDeps(REQUESTED_OFFERING_ID, null, harness().deps),
    deleteExamAssignmentWithDeps(
      REQUESTED_OFFERING_ID,
      REQUESTED_ASSIGNMENT_ID,
      harness({ contextThrows: new FakeCourseNotFoundError() }).deps,
    ),
    deleteExamAssignmentWithDeps(
      REQUESTED_OFFERING_ID,
      REQUESTED_ASSIGNMENT_ID,
      harness({ gateThrows: new FakeOperationDeniedError() }).deps,
    ),
    deleteExamAssignmentWithDeps(
      REQUESTED_OFFERING_ID,
      REQUESTED_ASSIGNMENT_ID,
      harness({ plan: null }).deps,
    ),
    deleteExamAssignmentWithDeps(
      REQUESTED_OFFERING_ID,
      REQUESTED_ASSIGNMENT_ID,
      harness({ assignment: null }).deps,
    ),
  ]);
}

test("20. every result is frozen, plain and JSON-safe all the way down", async () => {
  for (const result of await everyResult()) assertPlainFrozenJsonSafe(result);
});

test("21. every result JSON round-trips to an equal value", async () => {
  for (const result of await everyResult()) {
    assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  }
});

test("22. no result carries an id, a count or any submitted value", async () => {
  for (const result of await everyResult()) {
    const serialized = JSON.stringify(result);
    for (const secret of [
      REQUESTED_OFFERING_ID,
      VERIFIED_OFFERING_ID,
      SERVER_PLAN_ID,
      REQUESTED_ASSIGNMENT_ID,
      STORED_ASSIGNMENT_ID,
    ]) {
      assert.equal(serialized.includes(secret), false, `a result echoes ${secret}`);
    }
    assert.ok(
      Object.keys(result).length <= 2,
      `a result carries more than ok + code: ${serialized}`,
    );
  }
});

test("23. exactly five outcomes are reachable, and no result arm carries `issues`", async () => {
  const outcomes = (await everyResult()).map((result) =>
    result.ok ? "ok" : result.code,
  );
  assert.deepEqual([...new Set(outcomes)].sort(), [
    "assignment_not_found",
    "invalid_input",
    "offering_not_found",
    "ok",
    "operation_not_allowed",
    "plan_not_found",
  ].sort());
  for (const result of await everyResult()) {
    assert.equal(Object.prototype.hasOwnProperty.call(result, "issues"), false);
  }
});

test("24. two runs return independent, non-aliasing results", async () => {
  const [a, b] = await Promise.all([
    deleteExamAssignmentWithDeps(REQUESTED_OFFERING_ID, REQUESTED_ASSIGNMENT_ID, harness().deps),
    deleteExamAssignmentWithDeps(REQUESTED_OFFERING_ID, REQUESTED_ASSIGNMENT_ID, harness().deps),
  ]);
  assert.deepEqual(a, b);
  assert.notEqual(a as unknown, b as unknown);
});

// ===========================================================================
// 25–34. Structural guards
// ===========================================================================

const EXAM_DIR = import.meta.dirname;
const MODULE_NAME = "delete-exam-assignment-core.ts";
const TEST_NAME = "delete-exam-assignment-core.test.ts";
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

test("25. the pure core has NO imports at all and performs no IO", () => {
  assert.equal(/\bimport\b/.test(CODE), false, "the pure core imports something");
  assert.equal(/\brequire\s*\(/.test(CODE), false, "the pure core requires something");
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

test("26. the pure core imports no auth, app, framework or action module", () => {
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

test("27. the pure core consults no capability of any kind", () => {
  for (const token of ['"EXAMS"', "CapabilityKey", "capability", "Capability"]) {
    assert.equal(CODE.includes(token), false, `the pure core consults ${token}`);
  }
});

test("28. the pure core has NO calendar type, clock, randomness or process access", () => {
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

test("29. the pure core coerces nothing", () => {
  for (const token of ["String(", "Number(", "toLowerCase", "toUpperCase", "normalize("]) {
    assert.equal(CODE.includes(token), false, `the pure core uses ${token}`);
  }
});

test("30. the module exports exactly the intended surface", () => {
  const functions = [...SOURCE.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)].map(
    (m) => m[1],
  );
  assert.deepEqual(functions, ["deleteExamAssignmentWithDeps"]);

  const orchestration = [
    ...SOURCE.matchAll(/export async function (\w+)\(([\s\S]*?)\):\s*([^{]+)\{/g),
  ].map(([, name, params, returns]) => ({
    name,
    params: params.replace(/\s+/g, " ").trim(),
    returns: returns.replace(/\s+/g, " ").trim(),
  }))[0];
  assert.equal(
    orchestration.params,
    "courseOfferingId: string, assignmentId: unknown, deps: DeleteExamAssignmentDeps,",
  );
  assert.equal(orchestration.returns, "Promise<DeleteExamAssignmentResult>");
  for (const forbidden of ["planId", "sessionId", "orderIndex", "actorId", "tx:", "prisma"]) {
    assert.equal(
      orchestration.params.includes(forbidden),
      false,
      `the orchestration accepts ${forbidden}`,
    );
  }
});

test("31. no result code beyond the five approved outcomes exists", () => {
  const codes = [...CODE.matchAll(/refuse\("([a-z_]+)"\)|code: "([a-z_]+)"/g)]
    .map((m) => m[1] ?? m[2])
    .filter((code): code is string => typeof code === "string");
  assert.deepEqual([...new Set(codes)].sort(), [
    "assignment_not_found",
    "invalid_input",
    "offering_not_found",
    "operation_not_allowed",
    "plan_not_found",
  ]);
  for (const token of ["unexpected", "stale_write", "conflict", "archived", "session_not_found"]) {
    assert.equal(CODE.includes(token), false, `the pure core invents ${token}`);
  }
});

test("32. exactly two classifiers exist, and no raw error is inspected", () => {
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

test("33. NO version token exists, and its absence is REASONED, not assumed", () => {
  for (const token of [
    "expectedUpdatedAt",
    "updatedAt",
    "version",
    "Version",
    "isCurrent",
    "IfCurrent",
  ]) {
    assert.equal(CODE.includes(token), false, `the pure core carries ${token}`);
  }
  // The four reasons, and the future obligation, must all be written down.
  const prose = COMMENTS.replace(/\s+/g, " ");
  assert.ok(/immutable/i.test(prose), "the immutability premise is unstated");
  assert.ok(/same row/i.test(prose), "the stable-identifier premise is unstated");
  assert.ok(/assignment_not_found/.test(prose), "the already-gone outcome is unstated");
  assert.ok(
    /update/i.test(prose) && /stale-write/i.test(prose),
    "the future update flow's obligation is unstated",
  );
});

test("34. the slice's two lib/exam files are exactly the approved pair", () => {
  const sliceFiles = readdirSync(EXAM_DIR)
    .filter((name) => name.startsWith("delete-exam-assignment-core"))
    .sort();
  assert.deepEqual(sliceFiles, [MODULE_NAME, TEST_NAME].sort());
});

test("35. this suite opens no database and reads no environment", () => {
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
    ["./delete-exam-assignment-core", "node:assert/strict", "node:fs", "node:path", "node:test"],
  );
});
