/**
 * EXAM EX-SES-S3 — executable tests for the PURE stored-ExamSession REMOVAL
 * orchestration (delete-exam-session-core.ts).
 *
 * Run with: npx tsx --test lib/exam/delete-exam-session-core.test.ts
 *
 * DB-FREE: every dependency is a fake, no database connection is opened, no SQL
 * is executed, no environment variable is read, and no production identifier
 * appears anywhere. The only files read are module SOURCE TEXTS, by the
 * structural guards at the bottom.
 *
 * SCOPE OF PROOF:
 *   - the LOCKED ORDER: authorize -> gate -> resolve plan -> resolve session ->
 *     token -> count assignments -> delete, and, for every failure, exactly
 *     WHICH later dependencies are skipped;
 *   - that the assignment PRE-CHECK really is a pre-check: a non-zero count
 *     produces ZERO delete calls;
 *   - that zero assignments permits exactly ONE conditional delete, and that a
 *     count mismatch inside it becomes `stale_write`;
 *   - that breaks and supervisors are neither queried as blockers nor deleted —
 *     there is no dependency through which either could happen;
 *   - that NO `P2025` classifier and NO dead `P2003` classifier exists;
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
  deleteExamSessionWithDeps,
  type DeleteExamSessionDeps,
  type DeleteExamSessionResult,
  type ExistingExamSessionForDelete,
  type ResolvedExamPlanForSessionDelete,
} from "./delete-exam-session-core";

// ===========================================================================
// Fixtures
// ===========================================================================

/** What the caller ASKS for. Deliberately different from what is verified. */
const REQUESTED_OFFERING_ID = "offering-as-requested";
/** What the boundary VERIFIED. Only this may reach the plan lookup. */
const VERIFIED_OFFERING_ID = "offering-as-verified";
/** The plan the SERVER resolved. Only this may reach the scoped read + delete. */
const SERVER_PLAN_ID = "plan-resolved-by-server";

/** The session id the CALLER routed the removal at. */
const REQUESTED_SESSION_ID = "session-as-requested";
/**
 * The id of the row the plan-scoped read actually returned. In production the
 * two are equal; they are deliberately DIFFERENT here so a test can prove which
 * one flows onward to the count and the delete.
 */
const STORED_SESSION_ID = "session-as-stored";

/** A well-formed epoch-millisecond token. */
const STORED_VERSION = 1_700_000_000_000;

function storedSession(
  over: Partial<ExistingExamSessionForDelete> = {},
): ExistingExamSessionForDelete {
  return { id: STORED_SESSION_ID, updatedAt: STORED_VERSION, ...over };
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
  readonly plan?: ResolvedExamPlanForSessionDelete | null;
  readonly session?: ExistingExamSessionForDelete | null;
  /**
   * What the AUTHORITATIVE re-read returns on the second and later calls, when
   * the guarded delete matched nothing. Absent means "the same row as before".
   */
  readonly sessionOnRecheck?: ExistingExamSessionForDelete | null;
  readonly assignmentCount?: number;
  /**
   * A per-call assignment-count script, so a test can model the exact race this
   * slice exists to close: zero at the pre-check, non-zero at the re-check. The
   * last entry repeats if the count is asked for again.
   */
  readonly assignmentCounts?: readonly number[];
  readonly deleted?: boolean;
  readonly contextThrows?: unknown;
  readonly gateThrows?: unknown;
  readonly planThrows?: unknown;
  readonly sessionThrows?: unknown;
  readonly countThrows?: unknown;
  readonly deleteThrows?: unknown;
}

interface Harness {
  /** Dependency names, in the exact order they were invoked. */
  readonly calls: string[];
  readonly contextArgs: string[];
  readonly gateArgs: string[];
  readonly planLookupArgs: string[];
  readonly sessionArgs: { planId: string; sessionId: string }[];
  readonly countArgs: string[];
  readonly deleteArgs: { planId: string; sessionId: string; expectedUpdatedAt: number }[];
  readonly deps: DeleteExamSessionDeps;
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
  const sessionArgs: { planId: string; sessionId: string }[] = [];
  const countArgs: string[] = [];
  const deleteArgs: { planId: string; sessionId: string; expectedUpdatedAt: number }[] = [];

  /** How many times each read has been asked, so a race can be scripted. */
  let sessionReads = 0;
  let assignmentReads = 0;

  const deps: DeleteExamSessionDeps = {
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
    findSessionForDelete: async (planId, sessionId) => {
      calls.push("findSessionForDelete");
      sessionArgs.push({ planId, sessionId });
      if ("sessionThrows" in options) throw options.sessionThrows;
      sessionReads += 1;
      const first = options.session === undefined ? storedSession() : options.session;
      if (sessionReads === 1 || options.sessionOnRecheck === undefined) {
        return first;
      }
      return options.sessionOnRecheck;
    },
    countAssignmentsForSession: async (sessionId) => {
      calls.push("countAssignmentsForSession");
      countArgs.push(sessionId);
      if ("countThrows" in options) throw options.countThrows;
      assignmentReads += 1;
      const script = options.assignmentCounts;
      if (script !== undefined && script.length > 0) {
        return script[Math.min(assignmentReads - 1, script.length - 1)];
      }
      return options.assignmentCount ?? 0;
    },
    deleteSessionIfCurrent: async (planId, sessionId, expectedUpdatedAt) => {
      calls.push("deleteSessionIfCurrent");
      deleteArgs.push({ planId, sessionId, expectedUpdatedAt });
      if ("deleteThrows" in options) throw options.deleteThrows;
      return options.deleted ?? true;
    },
    isCourseNotFoundError: (error) => error instanceof FakeCourseNotFoundError,
    isOperationNotAllowedError: (error) => error instanceof FakeOperationDeniedError,
  };

  return { calls, contextArgs, gateArgs, planLookupArgs, sessionArgs, countArgs, deleteArgs, deps };
}

function run(
  options: HarnessOptions = {},
  token: number = STORED_VERSION,
  sessionId: string = REQUESTED_SESSION_ID,
  requested: string = REQUESTED_OFFERING_ID,
): { harness: Harness; result: Promise<DeleteExamSessionResult> } {
  const h = harness(options);
  return {
    harness: h,
    result: deleteExamSessionWithDeps(requested, sessionId, token, h.deps),
  };
}

/** The locked, complete dependency sequence of a successful removal. */
const LOCKED_ORDER = [
  "requireCourseContext",
  "assertConfigurationAllowed",
  "findExamPlanByCourseOfferingId",
  "findSessionForDelete",
  "countAssignmentsForSession",
  "deleteSessionIfCurrent",
] as const;

// ===========================================================================
// 1–3. Success
// ===========================================================================

test("1. a successful removal returns ONLY sessionId", async () => {
  const { result } = run();
  const outcome = await result;
  assert.deepEqual(outcome, { ok: true, sessionId: STORED_SESSION_ID });
  assert.deepEqual(Object.keys(outcome).sort(), ["ok", "sessionId"]);
});

test("2. the removal reports the STORED row's id, never the requested one", async () => {
  const outcome = await run().result;
  assert.ok(outcome.ok);
  assert.equal(outcome.ok && outcome.sessionId, STORED_SESSION_ID);
  assert.notEqual(outcome.ok && outcome.sessionId, REQUESTED_SESSION_ID);
});

test("3. the caller's token is forwarded to the delete VERBATIM", async () => {
  const { harness: h, result } = run({}, 1_699_000_000_123);
  await result;
  assert.equal(h.deleteArgs[0].expectedUpdatedAt, 1_699_000_000_123);
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

test("6. the plan lookup runs THIRD, and the session read FOURTH", async () => {
  const { harness: h, result } = run();
  await result;
  assert.equal(h.calls[2], "findExamPlanByCourseOfferingId");
  assert.equal(h.calls[3], "findSessionForDelete");
});

test("7. the assignment count runs FIFTH, and the delete LAST", async () => {
  const { harness: h, result } = run();
  await result;
  assert.equal(h.calls[4], "countAssignmentsForSession");
  assert.equal(h.calls[5], "deleteSessionIfCurrent");
});

test("8. the successful dependency order is EXACTLY the locked sequence", async () => {
  const { harness: h, result } = run();
  await result;
  assert.deepEqual(h.calls, [...LOCKED_ORDER]);
});

/** Every path this operation can take, for the whole-path invariants. */
const EVERY_PATH: readonly (readonly [string, HarnessOptions, number])[] = [
  ["success", {}, STORED_VERSION],
  ["assigned pre-check", { assignmentCount: 2 }, STORED_VERSION],
  ["guarded delete lost the race", { deleted: false, assignmentCounts: [0, 3] }, STORED_VERSION],
  ["guarded delete, still unassigned", { deleted: false, assignmentCounts: [0, 0] }, STORED_VERSION],
  ["malformed token", {}, Number.NaN],
  ["archived", { status: "ARCHIVED" }, STORED_VERSION],
  ["no plan", { plan: null }, STORED_VERSION],
  ["no session", { session: null }, STORED_VERSION],
  ["course not found", { contextThrows: new FakeCourseNotFoundError() }, STORED_VERSION],
  ["denied", { gateThrows: new FakeOperationDeniedError() }, STORED_VERSION],
];

test("9. the DELETE runs at most once on every path, and reads at most twice", async () => {
  for (const [label, options, token] of EVERY_PATH) {
    const { harness: h, result } = run(options, token);
    await result;
    const counted = new Map<string, number>();
    for (const call of h.calls) counted.set(call, (counted.get(call) ?? 0) + 1);

    // The destructive write is NEVER re-attempted — that is the whole point of
    // classifying a zero match by re-reading instead of retrying.
    assert.ok(
      (counted.get("deleteSessionIfCurrent") ?? 0) <= 1,
      `${label}: the delete ran ${counted.get("deleteSessionIfCurrent")} times`,
    );
    for (const once of [
      "requireCourseContext",
      "assertConfigurationAllowed",
      "findExamPlanByCourseOfferingId",
    ]) {
      assert.ok((counted.get(once) ?? 0) <= 1, `${label}: ${once} ran more than once`);
    }
    // Only the two CLASSIFICATION re-reads may repeat, and only ever twice.
    for (const twice of ["findSessionForDelete", "countAssignmentsForSession"]) {
      assert.ok((counted.get(twice) ?? 0) <= 2, `${label}: ${twice} ran more than twice`);
    }
  }
});

test("10. the SOURCE order of the effects matches the locked sequence", () => {
  const positions = [
    "deps.requireCourseContext(",
    "deps.assertConfigurationAllowed(",
    "deps.findExamPlanByCourseOfferingId(",
    "deps.findSessionForDelete(",
    "isExamSessionVersionToken(expectedUpdatedAt)",
    "deps.countAssignmentsForSession(",
    "deps.deleteSessionIfCurrent(",
  ].map((token) => {
    const at = CODE.indexOf(token);
    assert.ok(at > 0, `${token} is missing`);
    return at;
  });
  for (let i = 1; i < positions.length; i += 1) {
    assert.ok(positions[i] > positions[i - 1], `step ${i + 1} precedes step ${i}`);
  }
  // The authorization effects and — critically — the DESTRUCTIVE WRITE appear
  // exactly once in the source: there is no retry and no second delete path.
  for (const token of [
    "deps.requireCourseContext(",
    "deps.assertConfigurationAllowed(",
    "deps.findExamPlanByCourseOfferingId(",
    "deps.deleteSessionIfCurrent(",
  ]) {
    const escaped = token.replace(/[.()]/g, "\\$&");
    assert.equal((CODE.match(new RegExp(escaped, "g")) ?? []).length, 1, `${token} appears twice`);
  }
  // The two reads appear twice — once in the main path, once in the classifier —
  // and nowhere else.
  for (const token of ["deps.findSessionForDelete(", "deps.countAssignmentsForSession("]) {
    const escaped = token.replace(/[.()]/g, "\\$&");
    assert.equal((CODE.match(new RegExp(escaped, "g")) ?? []).length, 2, `${token} is not re-read`);
  }
});

// ===========================================================================
// 11–15. Scoping: only server-derived ids flow onward
// ===========================================================================

test("11. the VERIFIED offering id is what the plan lookup receives", async () => {
  const { harness: h, result } = run();
  await result;
  assert.deepEqual(h.planLookupArgs, [VERIFIED_OFFERING_ID]);
  assert.equal(h.planLookupArgs.includes(REQUESTED_OFFERING_ID), false);
});

test("12. the session read is scoped by the SERVER plan id and the requested session id", async () => {
  const { harness: h, result } = run();
  await result;
  assert.deepEqual(h.sessionArgs, [
    { planId: SERVER_PLAN_ID, sessionId: REQUESTED_SESSION_ID },
  ]);
});

test("13. the STORED row's id — never the requested one — reaches the count and the delete", async () => {
  const { harness: h, result } = run();
  await result;
  assert.deepEqual(h.countArgs, [STORED_SESSION_ID]);
  assert.equal(h.deleteArgs[0].sessionId, STORED_SESSION_ID);
  assert.notEqual(h.deleteArgs[0].sessionId, REQUESTED_SESSION_ID);
});

test("14. the delete is scoped by the SERVER-RESOLVED plan id", async () => {
  const { harness: h, result } = run();
  await result;
  assert.equal(h.deleteArgs[0].planId, SERVER_PLAN_ID);
  assert.notEqual(h.deleteArgs[0].planId, REQUESTED_OFFERING_ID);
  assert.notEqual(h.deleteArgs[0].planId, VERIFIED_OFFERING_ID);
});

test("15. a FOREIGN session is INDISTINGUISHABLE from a missing one", async () => {
  const missing = await run({ session: null }, STORED_VERSION, "session-that-does-not-exist").result;
  const foreign = await run({ session: null }, STORED_VERSION, "session-of-another-plan").result;
  assert.deepEqual(missing, foreign);
  assert.equal(JSON.stringify(missing), JSON.stringify(foreign));
  assert.deepEqual(missing, { ok: false, code: "session_not_found" });
});

// ===========================================================================
// 16–19. A missing plan and a missing session short-circuit
// ===========================================================================

test("16. a missing plan returns plan_not_found and skips everything after it", async () => {
  const { harness: h, result } = run({ plan: null });
  assert.deepEqual(await result, { ok: false, code: "plan_not_found" });
  assert.deepEqual(h.calls, [
    "requireCourseContext",
    "assertConfigurationAllowed",
    "findExamPlanByCourseOfferingId",
  ]);
  assert.deepEqual(h.countArgs, []);
  assert.deepEqual(h.deleteArgs, []);
});

test("17. a missing session returns session_not_found and counts nothing", async () => {
  const { harness: h, result } = run({ session: null });
  assert.deepEqual(await result, { ok: false, code: "session_not_found" });
  assert.deepEqual(h.calls, [
    "requireCourseContext",
    "assertConfigurationAllowed",
    "findExamPlanByCourseOfferingId",
    "findSessionForDelete",
  ]);
  assert.deepEqual(h.countArgs, [], "a missing session was still counted");
  assert.deepEqual(h.deleteArgs, []);
});

test("18. a malformed token refuses with invalid_input, before the count", async () => {
  for (const bad of [Number.NaN, -1, 1.5, Number.POSITIVE_INFINITY]) {
    const { harness: h, result } = run({}, bad);
    assert.deepEqual(await result, { ok: false, code: "invalid_input" }, `${bad} was accepted`);
    assert.deepEqual(h.countArgs, [], `${bad} still reached the count`);
    assert.deepEqual(h.deleteArgs, []);
  }
});

test("19. a well-formed token of 0 is accepted", async () => {
  const { harness: h, result } = run({}, 0);
  assert.ok((await result).ok);
  assert.equal(h.deleteArgs[0].expectedUpdatedAt, 0);
});

// ===========================================================================
// 20–25. The assignment pre-check
// ===========================================================================

test("20. a session WITH assignments refuses with session_has_assignments", async () => {
  const { result } = run({ assignmentCount: 1 });
  assert.deepEqual(await result, { ok: false, code: "session_has_assignments" });
});

test("21. a session with assignments performs ZERO delete calls", async () => {
  for (const count of [1, 2, 30]) {
    const { harness: h, result } = run({ assignmentCount: count });
    await result;
    assert.deepEqual(h.deleteArgs, [], `${count} assignments still reached the delete`);
    assert.deepEqual(h.calls, [
      "requireCourseContext",
      "assertConfigurationAllowed",
      "findExamPlanByCourseOfferingId",
      "findSessionForDelete",
      "countAssignmentsForSession",
    ]);
  }
});

test("22. ZERO assignments permits exactly ONE conditional delete", async () => {
  const { harness: h, result } = run({ assignmentCount: 0 });
  assert.deepEqual(await result, { ok: true, sessionId: STORED_SESSION_ID });
  assert.equal(h.deleteArgs.length, 1);
});

test("23. the assignment COUNT itself never leaves the module", async () => {
  const outcome = await run({ assignmentCount: 7 }).result;
  const serialized = JSON.stringify(outcome);
  assert.equal(serialized.includes("7"), false, `the count leaked into ${serialized}`);
  assert.equal(serialized.includes("count"), false);
});

test("24. the count is asked with the STORED id and nothing else", async () => {
  const { harness: h, result } = run();
  await result;
  assert.deepEqual(h.countArgs, [STORED_SESSION_ID]);
  // One argument only: no plan id, no date, no role filter is representable.
  assert.ok(
    /countAssignmentsForSession\(sessionId: string\): Promise<number>/.test(CODE),
    "the count dependency accepts more than a session id",
  );
});

test("25. breaks and supervisors are NOT queried as blockers and NOT deleted", () => {
  // There is no dependency through which either could be counted or removed, so
  // the guarantee is structural rather than behavioural.
  const deps = CODE.slice(
    CODE.indexOf("export interface DeleteExamSessionDeps"),
    CODE.indexOf("export type DeleteExamSessionRefusalCode"),
  );
  const methods = [...deps.matchAll(/^\s{2}(\w+)[(<]/gm)].map((match) => match[1]);
  assert.deepEqual(methods.sort(), [
    "assertConfigurationAllowed",
    "countAssignmentsForSession",
    "deleteSessionIfCurrent",
    "findExamPlanByCourseOfferingId",
    "findSessionForDelete",
    "isCourseNotFoundError",
    "isOperationNotAllowedError",
    "requireCourseContext",
  ]);
  for (const token of [
    "countBreaks",
    "countSupervisors",
    "deleteBreaks",
    "deleteSupervisors",
    "deleteAssignments",
    "deleteBeginnerChildren",
    "ExamSessionBreak",
    "ExamSessionSupervisor",
    "ExamBeginnerChild",
    "ExamAssignment",
  ]) {
    assert.equal(CODE.includes(token), false, `the pure core reaches ${token}`);
  }
});

test("26. NO cascade of the module's own is performed: the only write is the delete", () => {
  const writeLike = [...CODE.matchAll(/deps\.(\w+)\(/g)].map((match) => match[1]);
  const mutating = writeLike.filter((name) => /^(delete|remove|create|update|write|purge)/i.test(name));
  assert.deepEqual(mutating, ["deleteSessionIfCurrent"]);
});

// ===========================================================================
// 26a–26h. The ATOMIC assignment guard, and the race it closes
// ===========================================================================

test("26a. AN ASSIGNMENT APPEARING AFTER THE PRE-CHECK destroys nothing", async () => {
  // The race, exactly: the count says zero, the guarded statement then removes
  // nothing because someone was assigned in between. Without the condition in
  // the statement, that assignment would have been cascaded away.
  const { harness: h, result } = run({ deleted: false, assignmentCounts: [0, 3] });
  assert.deepEqual(await result, { ok: false, code: "session_has_assignments" });

  // The delete was ATTEMPTED once — and removed nothing, which is the guard doing
  // its job — and was never attempted again.
  assert.equal(h.deleteArgs.length, 1, "the delete was retried");
});

test("26b. the lost race is classified by RE-READING, in the locked order", async () => {
  const { harness: h, result } = run({ deleted: false, assignmentCounts: [0, 3] });
  await result;
  assert.deepEqual(h.calls, [
    "requireCourseContext",
    "assertConfigurationAllowed",
    "findExamPlanByCourseOfferingId",
    "findSessionForDelete",
    "countAssignmentsForSession",
    "deleteSessionIfCurrent",
    // ...and only now the classification, reads only.
    "findSessionForDelete",
    "countAssignmentsForSession",
  ]);
  assert.deepEqual(h.sessionArgs[1], { planId: SERVER_PLAN_ID, sessionId: STORED_SESSION_ID });
  assert.deepEqual(h.countArgs, [STORED_SESSION_ID, STORED_SESSION_ID]);
});

test("26c. the early refusal and the raced refusal are the SAME code", async () => {
  // They mean the same thing to a manager, so they must be indistinguishable.
  const early = await run({ assignmentCount: 1 }).result;
  const raced = await run({ deleted: false, assignmentCounts: [0, 1] }).result;
  assert.deepEqual(early, raced);
  assert.equal(JSON.stringify(early), JSON.stringify(raced));
  assert.deepEqual(early, { ok: false, code: "session_has_assignments" });
});

test("26d. a guarded delete that lost to a VERSION change is stale_write, not the gate", async () => {
  const { harness: h, result } = run({
    deleted: false,
    sessionOnRecheck: storedSession({ updatedAt: STORED_VERSION + 1_000 }),
    assignmentCounts: [0, 4],
  });
  assert.deepEqual(await result, { ok: false, code: "stale_write" });
  // The second count is never asked: the version answer already decided it.
  assert.deepEqual(h.countArgs, [STORED_SESSION_ID]);
});

test("26e. a guarded delete whose row VANISHED is stale_write, and counts nothing more", async () => {
  const { harness: h, result } = run({
    deleted: false,
    sessionOnRecheck: null,
    assignmentCounts: [0, 8],
  });
  assert.deepEqual(await result, { ok: false, code: "stale_write" });
  assert.deepEqual(h.countArgs, [STORED_SESSION_ID], "a vanished row was still counted");
});

test("26f. a guarded delete that matched nothing while still unassigned FAILS CLOSED", async () => {
  const { harness: h, result } = run({ deleted: false, assignmentCounts: [0, 0] });
  assert.deepEqual(await result, { ok: false, code: "stale_write" });
  assert.equal(h.deleteArgs.length, 1, "the delete was retried");
});

test("26g. the destructive write is NEVER retried, structurally", () => {
  assert.equal(
    (CODE.match(/deps\.deleteSessionIfCurrent\(/g) ?? []).length,
    1,
    "the delete appears more than once — a retry path exists",
  );
  for (const token of ["retry", "Retry", "attempt", "backoff", "while (", "for (", "setTimeout"]) {
    assert.equal(CODE.includes(token), false, `the pure core contains ${token}`);
  }
  // The classification helper reads and refuses; it can reach no write at all.
  const helper = CODE.slice(CODE.indexOf("async function classifyFailedDelete"));
  assert.equal(helper.includes("deleteSessionIfCurrent"), false, "the classifier deletes");
  assert.ok(helper.includes("findSessionForDelete"));
  assert.ok(helper.includes("countAssignmentsForSession"));
});

test("26h. the write dependency CONTRACTUALLY owns the no-assignments condition", () => {
  // There is no flag: an unassigned session is the only kind this operation may
  // ever remove, so the condition is unconditional — and the contract says the
  // STATEMENT must carry it, not the caller.
  assert.ok(
    /deleteSessionIfCurrent\(\s*planId: string,\s*sessionId: string,\s*expectedUpdatedAt: number,\s*\): Promise<boolean>/.test(
      CODE,
    ),
    "the delete dependency signature changed shape",
  );
  const contract = COMMENTS.slice(COMMENTS.indexOf("The SINGLE write: remove that session"));
  assert.ok(/NO ASSIGNMENTS at delete time/i.test(contract), "the contract does not require it");
  assert.ok(/check-then-act/i.test(contract), "the contract does not say why");
});

// ===========================================================================
// 27–29. The stale-write outcome
// ===========================================================================

test("27. a delete that matched nothing becomes stale_write", async () => {
  const { result } = run({ deleted: false });
  assert.deepEqual(await result, { ok: false, code: "stale_write" });
});

test("28. a stale token is decided by the DELETE, not by the row read earlier", async () => {
  // The row read in step 5 reports one version; the caller sends another. The
  // module still attempts the conditional delete — refusing here from a row that
  // could already be out of date would be a guess.
  const { harness: h, result } = run({ deleted: false }, STORED_VERSION - 5_000);
  assert.deepEqual(await result, { ok: false, code: "stale_write" });
  assert.equal(h.deleteArgs.length, 1);
  assert.equal(h.deleteArgs[0].expectedUpdatedAt, STORED_VERSION - 5_000);
});

test("29. a stale delete and an assignment refusal are DIFFERENT codes", async () => {
  const stale = await run({ deleted: false }).result;
  const assigned = await run({ assignmentCount: 1 }).result;
  assert.notDeepEqual(stale, assigned);
  assert.deepEqual(stale, { ok: false, code: "stale_write" });
  assert.deepEqual(assigned, { ok: false, code: "session_has_assignments" });
});

// ===========================================================================
// 30–34. Classification and propagation
// ===========================================================================

test("30. a course not-found maps to offering_not_found and stops immediately", async () => {
  const { harness: h, result } = run({ contextThrows: new FakeCourseNotFoundError() });
  assert.deepEqual(await result, { ok: false, code: "offering_not_found" });
  assert.deepEqual(h.calls, ["requireCourseContext"]);
});

test("31. a lifecycle denial maps to operation_not_allowed and costs zero exam reads", async () => {
  const { harness: h, result } = run({
    status: "ARCHIVED",
    gateThrows: new FakeOperationDeniedError(),
  });
  assert.deepEqual(await result, { ok: false, code: "operation_not_allowed" });
  assert.deepEqual(h.calls, ["requireCourseContext", "assertConfigurationAllowed"]);
  assert.deepEqual(h.planLookupArgs, []);
  assert.deepEqual(h.deleteArgs, []);
});

const THROW_PATHS: readonly (readonly [string, (thrown: unknown) => HarnessOptions])[] = [
  ["requireCourseContext", (thrown) => ({ contextThrows: thrown })],
  ["assertConfigurationAllowed", (thrown) => ({ gateThrows: thrown })],
  ["findExamPlanByCourseOfferingId", (thrown) => ({ planThrows: thrown })],
  ["findSessionForDelete", (thrown) => ({ sessionThrows: thrown })],
  ["countAssignmentsForSession", (thrown) => ({ countThrows: thrown })],
  ["deleteSessionIfCurrent", (thrown) => ({ deleteThrows: thrown })],
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

test("33. NO Prisma error shape is classified — P2003 and P2025 in particular", async () => {
  const unrelated = [
    new Error("infrastructure fault"),
    new TypeError("programming error"),
    // A foreign-key restriction cannot be raised by this delete (every inbound
    // reference to ExamSession is CASCADE), and "record not found" cannot be
    // either (the bound write is a conditional deleteMany, which reports a count).
    // Classifying either would be dead code that a future edit could rely on.
    { code: "P2003" },
    { code: "P2003", meta: { field_name: "sessionId" } },
    { code: "P2025" },
    { code: "P2002" },
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

test("34. a failed read reaches no delete at all", async () => {
  for (const [label, build] of [
    ["plan", (t: unknown) => ({ planThrows: t })],
    ["session", (t: unknown) => ({ sessionThrows: t })],
    ["count", (t: unknown) => ({ countThrows: t })],
  ] as const) {
    const boom = new Error(`${label} query exploded`);
    const { harness: h, result } = run(build(boom));
    await assert.rejects(
      () => result,
      (error) => error === boom,
    );
    assert.deepEqual(h.deleteArgs, [], `${label}: a delete ran anyway`);
  }
});

// ===========================================================================
// 35–40. The result model
// ===========================================================================

/** Every outcome this core can produce, for the whole-model assertions. */
async function everyOutcome(): Promise<DeleteExamSessionResult[]> {
  return [
    await run().result,
    await run({}, Number.NaN).result,
    await run({ plan: null }).result,
    await run({ session: null }).result,
    await run({ assignmentCount: 3 }).result,
    await run({ deleted: false }).result,
    await run({ contextThrows: new FakeCourseNotFoundError() }).result,
    await run({ gateThrows: new FakeOperationDeniedError() }).result,
  ];
}

test("35. no plan, course, definition or actor identifier enters any result", async () => {
  for (const outcome of await everyOutcome()) {
    const serialized = JSON.stringify(outcome);
    for (const forbidden of [
      SERVER_PLAN_ID,
      VERIFIED_OFFERING_ID,
      REQUESTED_OFFERING_ID,
      "planId",
      "courseOfferingId",
      "definitionId",
      "adminId",
      "updatedAt",
      "assignmentCount",
    ]) {
      assert.equal(serialized.includes(forbidden), false, `${forbidden} leaked into ${serialized}`);
    }
  }
});

test("36. every result key is drawn from the approved surface only", async () => {
  const allowed = new Set(["ok", "sessionId", "code"]);
  for (const outcome of await everyOutcome()) {
    for (const key of Object.keys(outcome)) {
      assert.ok(allowed.has(key), `an unapproved key exists: ${key}`);
    }
  }
});

test("37. every result is a plain, frozen object with no prototype surprises", async () => {
  for (const outcome of await everyOutcome()) {
    assert.equal(Object.getPrototypeOf(outcome), Object.prototype);
    assert.equal(outcome instanceof Error, false);
    assert.ok(Object.isFrozen(outcome), `a result is mutable: ${JSON.stringify(outcome)}`);
  }
});

test("38. every result deep-equals its JSON round trip", async () => {
  for (const outcome of await everyOutcome()) {
    assert.deepEqual(JSON.parse(JSON.stringify(outcome)), outcome);
  }
});

test("39. no result carries an undefined property value or an issue list", async () => {
  for (const outcome of await everyOutcome()) {
    for (const [key, value] of Object.entries(outcome)) {
      assert.notEqual(value, undefined, `${key} is present-but-undefined`);
    }
    // A removal submits no fields, so there is nothing per-field to report.
    assert.equal("issues" in outcome, false);
  }
});

test("40. no result contains a calendar object, Map, Set or BigInt anywhere", async () => {
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
// Structural guards on the pure core
// ===========================================================================

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const EXAM_DIR = join(REPO_ROOT, "lib", "exam");
const MODULE_NAME = "delete-exam-session-core.ts";
const TEST_NAME = "delete-exam-session-core.test.ts";
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

test("S2. the pure core imports no auth, session, cookie or course implementation", () => {
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
    "dateKey",
  ]) {
    assert.equal(CODE.includes(token), false, `the pure core references ${token}`);
  }
});

test("S3. the pure core is neither server-only nor a Server Action module", () => {
  assert.equal(CODE.includes("server" + "-only"), false);
  assert.equal(CODE.includes('"use ' + 'server"'), false);
  assert.equal(CODE.includes("'use " + "server'"), false);
  assert.equal(CODE.includes('"use ' + 'client"'), false);
  assert.equal(/import\s+["']server/.test(SOURCE), false);
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

test("S5. the pure core has NO calendar type, clock, randomness or process access", () => {
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
});

test("S6. the pure core imports ONLY the committed sibling session edit core", () => {
  const specifiers = [...CODE.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(specifiers)], ["./update-exam-session-core"]);
  // The token predicate is REUSED, not restated, so the two session operations
  // can never disagree about what a well-formed token is.
  assert.ok(/import \{ isExamSessionVersionToken \} from/.test(CODE));
  assert.equal(CODE.includes("Number.isInteger"), false, "the predicate was copied");
});

test("S7. the module exports exactly the intended surface", () => {
  const functions = [...SOURCE.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)].map(
    (match) => match[1],
  );
  assert.deepEqual(functions, ["deleteExamSessionWithDeps"]);

  const orchestration = [
    ...SOURCE.matchAll(/export async function (\w+)\(([\s\S]*?)\):\s*([^{]+)\{/g),
  ].map(([, name, params, returns]) => ({
    name,
    params: params.replace(/\s+/g, " ").trim(),
    returns: returns.replace(/\s+/g, " ").trim(),
  }))[0];
  assert.equal(
    orchestration.params,
    "courseOfferingId: string, sessionId: string, expectedUpdatedAt: number, deps: DeleteExamSessionDeps,",
  );
  assert.equal(orchestration.returns, "Promise<DeleteExamSessionResult>");
  for (const forbidden of [
    "planId",
    "definitionId",
    "orderIndex",
    "adminId",
    "actorId",
    "assignmentCount",
    "rawInput",
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

test("S8. no result code beyond the seven approved outcomes exists", () => {
  const codes = [...CODE.matchAll(/refuse\("([a-z_]+)"\)|code: "([a-z_]+)"/g)]
    .map((match) => match[1] ?? match[2])
    .filter((code): code is string => typeof code === "string");
  assert.deepEqual(
    [...new Set(codes)].sort(),
    [
      "invalid_input",
      "offering_not_found",
      "operation_not_allowed",
      "plan_not_found",
      "session_has_assignments",
      "stale_write",
      "session_not_found",
    ].sort(),
  );
  for (const token of [
    "unexpected",
    "duplicate",
    "conflict",
    "definition_not_found",
    "definition_change_not_allowed",
    "archived",
  ]) {
    assert.equal(CODE.includes(token), false, `the pure core invents ${token}`);
  }
});

test("S9. NO Prisma error classifier of any kind exists in the code", () => {
  for (const token of ["P2002", "P2003", "P2025", "constraint", "field_name", "driverAdapterError"]) {
    assert.equal(CODE.includes(token), false, `the pure core classifies ${token}`);
  }
  // Only the two approved predicates exist.
  const predicates = [...CODE.matchAll(/\bis[A-Z]\w+Error\b/g)].map((match) => match[0]);
  assert.deepEqual([...new Set(predicates)].sort(), [
    "isCourseNotFoundError",
    "isOperationNotAllowedError",
  ]);
  // ...and the reason a foreign-key classifier is absent is written down.
  assert.ok(/P2003/.test(COMMENTS), "the absent foreign-key classifier is undocumented");
  assert.ok(/P2025/.test(COMMENTS), "the absent not-found classifier is undocumented");
});

test("S10. the atomic guard is documented, and the residual window stated HONESTLY", () => {
  assert.ok(/cascade/i.test(COMMENTS), "the cascade is not discussed at all");
  assert.ok(/assignment/i.test(COMMENTS), "the assignment pre-check is not discussed");
  assert.ok(/atomic/i.test(COMMENTS), "the atomic condition is not described");
  assert.ok(/fails? closed/i.test(COMMENTS), "the fail-closed posture is not stated");
  // The count must be described as the diagnostic, never as the guarantee.
  assert.ok(
    /diagnostic/i.test(COMMENTS),
    "the count is not distinguished from the protection",
  );
  // The APPLICATION-level window is closed; the database-level one is not, and
  // the header must say so rather than claim a guarantee it does not have.
  assert.ok(
    /READ COMMITTED/i.test(COMMENTS),
    "the remaining database-level window is not disclosed",
  );
  assert.ok(
    /(SERIALIZABLE|row locking)/i.test(COMMENTS),
    "what WOULD close the remaining window is not named",
  );
  // ...and no lock, retry or isolation override is introduced to pretend it is.
  for (const token of ["isolationLevel", "Serializable", "FOR UPDATE", "Mutex", "mutex"]) {
    assert.equal(CODE.includes(token), false, `the pure core introduces ${token}`);
  }
});

test("S11. the slice's two lib/exam files are exactly the approved pair", () => {
  const sliceFiles = readdirSync(EXAM_DIR)
    .filter((name) => name.startsWith("delete-exam-session-core"))
    .sort();
  assert.deepEqual(sliceFiles, [MODULE_NAME, TEST_NAME].sort());
});

test("S12. this suite opens no database and reads no environment", () => {
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
    ["./delete-exam-session-core", "node:assert/strict", "node:fs", "node:path", "node:test"],
  );
});
