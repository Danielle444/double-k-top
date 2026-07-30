/**
 * EXAM EX-SES-S3 — executable tests for the PURE stored-ExamSession EDIT
 * orchestration (update-exam-session-core.ts).
 *
 * Run with: npx tsx --test lib/exam/update-exam-session-core.test.ts
 *
 * DB-FREE: every dependency is a fake, no database connection is opened, no SQL
 * is executed, no environment variable is read, and no production identifier
 * appears anywhere. The only files read are module SOURCE TEXTS, by the
 * structural guards at the bottom.
 *
 * SCOPE OF PROOF:
 *   - the LOCKED ORDER: authorize -> gate -> resolve plan -> resolve session ->
 *     token -> validate -> no-op -> (verify definition -> count assignments) ->
 *     write, and, for every failure, exactly WHICH later dependencies are
 *     skipped;
 *   - that the VERIFIED offering id (never the requested one) reaches the plan
 *     lookup, that the SERVER-RESOLVED plan id reaches every scoped read and the
 *     write, and that the STORED row's id (never the requested one) reaches the
 *     assignment count and the write;
 *   - the malformed-token, stale-token and no-op rules, including the deliberate
 *     interaction between the last two;
 *   - the definition-change gate, with and without assignments, and that an
 *     unchanged definition triggers neither the verification nor the count;
 *   - that a MISSING definition and a FOREIGN one are indistinguishable, and the
 *     same for a missing and a foreign session;
 *   - that ONLY the six approved mutable values reach the write, and that
 *     `orderIndex` never does;
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
  isExamSessionVersionToken,
  updateExamSessionWithDeps,
  type ExistingExamSessionForUpdate,
  type NormalizedExamSessionEdit,
  type ResolvedExamPlanForSessionUpdate,
  type UpdateExamSessionDeps,
  type UpdateExamSessionResult,
  type UpdatedExamSessionRecord,
  type VerifiedExamDefinitionForSessionUpdate,
} from "./update-exam-session-core";

// ===========================================================================
// Fixtures
// ===========================================================================

/** What the caller ASKS for. Deliberately different from what is verified. */
const REQUESTED_OFFERING_ID = "offering-as-requested";
/** What the boundary VERIFIED. Only this may reach the plan lookup. */
const VERIFIED_OFFERING_ID = "offering-as-verified";
/** The plan the SERVER resolved. Only this may reach the scoped reads + write. */
const SERVER_PLAN_ID = "plan-resolved-by-server";

/** The session id the CALLER routed the edit at. */
const REQUESTED_SESSION_ID = "session-as-requested";
/**
 * The id of the row the plan-scoped read actually returned. In production the
 * two are equal; they are deliberately DIFFERENT here so a test can prove which
 * one flows onward to the count and the write.
 */
const STORED_SESSION_ID = "session-as-stored";

const STORED_DEFINITION_ID = "definition-already-stored";
const OTHER_DEFINITION_ID = "definition-newly-submitted";

/** A well-formed epoch-millisecond token. */
const STORED_VERSION = 1_700_000_000_000;
/** The version the row carries after a successful write. */
const NEW_VERSION = 1_700_000_999_000;

/** The AUTHORITATIVE row, as the IO layer hands it over: plain, no calendar. */
function storedSession(
  over: Partial<ExistingExamSessionForUpdate> = {},
): ExistingExamSessionForUpdate {
  return {
    id: STORED_SESSION_ID,
    definitionId: STORED_DEFINITION_ID,
    date: "2026-08-03",
    startTime: "09:00",
    arena: "זירה מקורה",
    title: "מבחן רכיבה",
    notes: "הערה",
    updatedAt: STORED_VERSION,
    ...over,
  };
}

/**
 * A raw edit submission that CHANGES exactly one value (`notes`) relative to the
 * stored row, so the default path is a real write; override to break or vary it.
 */
function rawEdit(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    definitionId: STORED_DEFINITION_ID,
    date: "2026-08-03",
    startTime: "09:00",
    arena: "זירה מקורה",
    title: "מבחן רכיבה",
    notes: "הערה מעודכנת",
    ...over,
  };
}

/** A raw submission identical to the stored row: the canonical no-op. */
function rawNoop(over: Record<string, unknown> = {}): Record<string, unknown> {
  return rawEdit({ notes: "הערה", ...over });
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
  readonly plan?: ResolvedExamPlanForSessionUpdate | null;
  readonly session?: ExistingExamSessionForUpdate | null;
  /**
   * What the AUTHORITATIVE re-read returns on the second and later calls, when
   * the guarded write matched nothing. Absent means "the same row as before".
   */
  readonly sessionOnRecheck?: ExistingExamSessionForUpdate | null;
  readonly definition?: VerifiedExamDefinitionForSessionUpdate | null;
  readonly assignmentCount?: number;
  /**
   * A per-call assignment-count script, so a test can model the exact race this
   * slice exists to close: zero at the pre-check, non-zero at the re-check. The
   * last entry repeats if the count is asked for again.
   */
  readonly assignmentCounts?: readonly number[];
  readonly updated?: UpdatedExamSessionRecord | null;
  readonly contextThrows?: unknown;
  readonly gateThrows?: unknown;
  readonly planThrows?: unknown;
  readonly sessionThrows?: unknown;
  readonly definitionThrows?: unknown;
  readonly countThrows?: unknown;
  readonly updateThrows?: unknown;
}

interface Harness {
  /** Dependency names, in the exact order they were invoked. */
  readonly calls: string[];
  readonly contextArgs: string[];
  readonly gateArgs: string[];
  readonly planLookupArgs: string[];
  readonly sessionArgs: { planId: string; sessionId: string }[];
  readonly definitionArgs: { planId: string; definitionId: string }[];
  readonly countArgs: string[];
  readonly updateArgs: {
    planId: string;
    sessionId: string;
    expectedUpdatedAt: number;
    value: NormalizedExamSessionEdit;
    requireNoAssignments: boolean;
  }[];
  readonly deps: UpdateExamSessionDeps;
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
  const definitionArgs: { planId: string; definitionId: string }[] = [];
  const countArgs: string[] = [];
  const updateArgs: {
    planId: string;
    sessionId: string;
    expectedUpdatedAt: number;
    value: NormalizedExamSessionEdit;
    requireNoAssignments: boolean;
  }[] = [];

  /** How many times each read has been asked, so a race can be scripted. */
  let sessionReads = 0;
  let assignmentReads = 0;

  const deps: UpdateExamSessionDeps = {
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
    findSessionForUpdate: async (planId, sessionId) => {
      calls.push("findSessionForUpdate");
      sessionArgs.push({ planId, sessionId });
      if ("sessionThrows" in options) throw options.sessionThrows;
      sessionReads += 1;
      const first = options.session === undefined ? storedSession() : options.session;
      if (sessionReads === 1 || options.sessionOnRecheck === undefined) {
        return first;
      }
      return options.sessionOnRecheck;
    },
    findDefinitionForPlan: async (planId, definitionId) => {
      calls.push("findDefinitionForPlan");
      definitionArgs.push({ planId, definitionId });
      if ("definitionThrows" in options) throw options.definitionThrows;
      return options.definition === undefined ? { id: definitionId } : options.definition;
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
    updateSessionIfCurrent: async (
      planId,
      sessionId,
      expectedUpdatedAt,
      value,
      requireNoAssignments,
    ) => {
      calls.push("updateSessionIfCurrent");
      updateArgs.push({ planId, sessionId, expectedUpdatedAt, value, requireNoAssignments });
      if ("updateThrows" in options) throw options.updateThrows;
      return options.updated === undefined
        ? { id: STORED_SESSION_ID, updatedAt: NEW_VERSION }
        : options.updated;
    },
    isCourseNotFoundError: (error) => error instanceof FakeCourseNotFoundError,
    isOperationNotAllowedError: (error) => error instanceof FakeOperationDeniedError,
  };

  return {
    calls,
    contextArgs,
    gateArgs,
    planLookupArgs,
    sessionArgs,
    definitionArgs,
    countArgs,
    updateArgs,
    deps,
  };
}

function run(
  options: HarnessOptions = {},
  raw: unknown = rawEdit(),
  token: number = STORED_VERSION,
  sessionId: string = REQUESTED_SESSION_ID,
  requested: string = REQUESTED_OFFERING_ID,
): { harness: Harness; result: Promise<UpdateExamSessionResult> } {
  const h = harness(options);
  return {
    harness: h,
    result: updateExamSessionWithDeps(requested, sessionId, token, raw, h.deps),
  };
}

/** The dependency sequence of a successful edit that keeps its definition. */
const LOCKED_ORDER = [
  "requireCourseContext",
  "assertConfigurationAllowed",
  "findExamPlanByCourseOfferingId",
  "findSessionForUpdate",
  "updateSessionIfCurrent",
] as const;

/** The dependency sequence of a successful edit that CHANGES its definition. */
const LOCKED_ORDER_WITH_DEFINITION_CHANGE = [
  "requireCourseContext",
  "assertConfigurationAllowed",
  "findExamPlanByCourseOfferingId",
  "findSessionForUpdate",
  "findDefinitionForPlan",
  "countAssignmentsForSession",
  "updateSessionIfCurrent",
] as const;

// ===========================================================================
// 1–5. Success
// ===========================================================================

test("1. a successful edit returns ONLY sessionId + changed + updatedAt", async () => {
  const { result } = run();
  const outcome = await result;

  assert.deepEqual(outcome, {
    ok: true,
    sessionId: STORED_SESSION_ID,
    changed: true,
    updatedAt: NEW_VERSION,
  });
  assert.deepEqual(Object.keys(outcome).sort(), ["changed", "ok", "sessionId", "updatedAt"]);
});

test("2. the write receives EXACTLY the six normalized values, trimmed", async () => {
  const { harness: h, result } = run(
    {},
    rawEdit({ arena: "  זירה חדשה  ", notes: "   ", title: "  כותרת  " }),
  );
  await result;

  assert.equal(h.updateArgs.length, 1);
  assert.deepEqual(h.updateArgs[0].value, {
    definitionId: STORED_DEFINITION_ID,
    date: "2026-08-03",
    startTime: "09:00",
    arena: "זירה חדשה",
    title: "כותרת",
    // Blank optional text collapses to null in the committed normalizer.
    notes: null,
  });
});

test("3. the write payload has NO orderIndex, planId, kind or timestamp field", async () => {
  const { harness: h, result } = run(
    {},
    rawEdit({
      orderIndex: 99,
      planId: "plan-chosen-by-client",
      kind: "BEGINNER_INSTRUCTION",
      endTime: "10:00",
      capacity: 5,
      individualPublishedAt: 1,
      updatedAt: 1,
      createdAt: 1,
      id: "session-chosen-by-client",
    }),
  );
  await result;

  const value = h.updateArgs[0].value as unknown as Record<string, unknown>;
  assert.deepEqual(Object.keys(value).sort(), [
    "arena",
    "date",
    "definitionId",
    "notes",
    "startTime",
    "title",
  ]);
  for (const forbidden of [
    "orderIndex",
    "planId",
    "kind",
    "phase",
    "beginnerFormat",
    "endTime",
    "capacity",
    "interfaceSessionId",
    "sourceTeachingPracticeLessonId",
    "copiedAt",
    "roleLabelOverrides",
    "individualPublishedAt",
    "createdAt",
    "updatedAt",
    "id",
  ]) {
    assert.equal(forbidden in value, false, `the payload carries ${forbidden}`);
  }
});

test("4. every one of the six values is independently editable", async () => {
  const edits: [string, Record<string, unknown>][] = [
    ["date", { date: "2026-08-04" }],
    ["startTime", { startTime: "10:30" }],
    ["arena", { arena: "זירה אחרת" }],
    ["title", { title: "כותרת אחרת" }],
    ["notes", { notes: "הערה אחרת" }],
    ["arena -> null", { arena: null }],
    ["title -> null", { title: "" }],
  ];
  for (const [label, over] of edits) {
    const { harness: h, result } = run({}, rawNoop(over));
    const outcome = await result;
    assert.ok(outcome.ok && outcome.changed === true, `${label} was treated as a no-op`);
    assert.equal(h.updateArgs.length, 1, `${label} performed no write`);
  }
});

test("5. the caller's token is forwarded to the write VERBATIM", async () => {
  const { harness: h, result } = run({}, rawEdit(), 1_699_000_000_123);
  await result;
  assert.equal(h.updateArgs[0].expectedUpdatedAt, 1_699_000_000_123);
});

// ===========================================================================
// 6–13. The locked order
// ===========================================================================

test("6. course authorization runs FIRST, before anything else", async () => {
  const { harness: h, result } = run();
  await result;
  assert.equal(h.calls[0], "requireCourseContext");
  assert.deepEqual(h.contextArgs, [REQUESTED_OFFERING_ID]);
});

test("7. the lifecycle gate runs SECOND, on the VERIFIED status", async () => {
  const { harness: h, result } = run({ status: "PLANNED" });
  await result;
  assert.equal(h.calls[1], "assertConfigurationAllowed");
  assert.deepEqual(h.gateArgs, ["PLANNED"]);
});

test("8. the plan lookup runs THIRD, and the session read FOURTH", async () => {
  const { harness: h, result } = run();
  await result;
  assert.equal(h.calls[2], "findExamPlanByCourseOfferingId");
  assert.equal(h.calls[3], "findSessionForUpdate");
});

test("9. the successful dependency order is EXACTLY the locked sequence", async () => {
  const { harness: h, result } = run();
  await result;
  assert.deepEqual(h.calls, [...LOCKED_ORDER]);
});

test("10. a definition change inserts the verification and the count, in that order", async () => {
  const { harness: h, result } = run({}, rawEdit({ definitionId: OTHER_DEFINITION_ID }));
  await result;
  assert.deepEqual(h.calls, [...LOCKED_ORDER_WITH_DEFINITION_CHANGE]);
  // Both sit strictly BETWEEN the session read and the write.
  assert.ok(h.calls.indexOf("findDefinitionForPlan") > h.calls.indexOf("findSessionForUpdate"));
  assert.ok(
    h.calls.indexOf("countAssignmentsForSession") < h.calls.indexOf("updateSessionIfCurrent"),
  );
});

test("11. an UNCHANGED definition costs zero definition reads and zero counts", async () => {
  const { harness: h, result } = run({}, rawEdit({ notes: "הערה אחרת לגמרי" }));
  await result;
  assert.deepEqual(h.definitionArgs, []);
  assert.deepEqual(h.countArgs, []);
  assert.deepEqual(h.calls, [...LOCKED_ORDER]);
});

/** Every path this operation can take, for the whole-path invariants. */
const EVERY_PATH: readonly (readonly [string, HarnessOptions, unknown, number])[] = [
  ["ordinary edit", {}, rawEdit(), STORED_VERSION],
  ["definition change", {}, rawEdit({ definitionId: OTHER_DEFINITION_ID }), STORED_VERSION],
  ["no-op", {}, rawNoop(), STORED_VERSION],
  ["malformed token", {}, rawEdit(), Number.NaN],
  ["archived", { status: "ARCHIVED" }, rawEdit(), STORED_VERSION],
  ["no plan", { plan: null }, rawEdit(), STORED_VERSION],
  ["no session", { session: null }, rawEdit(), STORED_VERSION],
  [
    "no definition",
    { definition: null },
    rawEdit({ definitionId: OTHER_DEFINITION_ID }),
    STORED_VERSION,
  ],
  [
    "assigned pre-check",
    { assignmentCount: 3 },
    rawEdit({ definitionId: OTHER_DEFINITION_ID }),
    STORED_VERSION,
  ],
  ["ordinary stale", { updated: null }, rawEdit(), STORED_VERSION],
  [
    "guarded write lost the race",
    { updated: null, assignmentCounts: [0, 2] },
    rawEdit({ definitionId: OTHER_DEFINITION_ID }),
    STORED_VERSION,
  ],
  [
    "guarded write, still unassigned",
    { updated: null, assignmentCounts: [0, 0] },
    rawEdit({ definitionId: OTHER_DEFINITION_ID }),
    STORED_VERSION,
  ],
  ["course not found", { contextThrows: new FakeCourseNotFoundError() }, rawEdit(), STORED_VERSION],
  ["denied", { gateThrows: new FakeOperationDeniedError() }, rawEdit(), STORED_VERSION],
];

test("12. the WRITE runs at most once on every path, and reads at most twice", async () => {
  for (const [label, options, raw, token] of EVERY_PATH) {
    const { harness: h, result } = run(options, raw, token);
    await result;
    const counted = new Map<string, number>();
    for (const call of h.calls) counted.set(call, (counted.get(call) ?? 0) + 1);

    // The write is NEVER re-attempted — that is the whole point of classifying a
    // zero match by re-reading instead of retrying.
    assert.ok(
      (counted.get("updateSessionIfCurrent") ?? 0) <= 1,
      `${label}: the write ran ${counted.get("updateSessionIfCurrent")} times`,
    );
    // Authorization and the two plan/definition lookups are strictly once.
    for (const once of [
      "requireCourseContext",
      "assertConfigurationAllowed",
      "findExamPlanByCourseOfferingId",
      "findDefinitionForPlan",
    ]) {
      assert.ok((counted.get(once) ?? 0) <= 1, `${label}: ${once} ran more than once`);
    }
    // Only the two CLASSIFICATION re-reads may repeat, and only ever twice.
    for (const twice of ["findSessionForUpdate", "countAssignmentsForSession"]) {
      assert.ok((counted.get(twice) ?? 0) <= 2, `${label}: ${twice} ran more than twice`);
    }
  }
});

test("13. the SOURCE order of the effects matches the locked sequence", () => {
  const positions = [
    "deps.requireCourseContext(",
    "deps.assertConfigurationAllowed(",
    "deps.findExamPlanByCourseOfferingId(",
    "deps.findSessionForUpdate(",
    "isExamSessionVersionToken(expectedUpdatedAt)",
    "normalizeExamSessionEditInput(rawInput)",
    // The CALL site, not the declaration (whose parameters are on their own
    // lines), so this really is the position of step 10.
    "isUnchanged(existing, normalized.value)",
    "deps.findDefinitionForPlan(",
    "deps.countAssignmentsForSession(",
    "deps.updateSessionIfCurrent(",
  ].map((token) => {
    const at = CODE.indexOf(token);
    assert.ok(at > 0, `${token} is missing`);
    return at;
  });
  for (let i = 1; i < positions.length; i += 1) {
    assert.ok(positions[i] > positions[i - 1], `step ${i + 1} precedes step ${i}`);
  }
});

// ===========================================================================
// 14–18. Only server-derived ids flow onward
// ===========================================================================

test("14. the VERIFIED offering id is what the plan lookup receives", async () => {
  const { harness: h, result } = run();
  await result;
  assert.deepEqual(h.planLookupArgs, [VERIFIED_OFFERING_ID]);
  assert.equal(h.planLookupArgs.includes(REQUESTED_OFFERING_ID), false);
});

test("15. the session read is scoped by the SERVER plan id and the requested session id", async () => {
  const { harness: h, result } = run();
  await result;
  assert.deepEqual(h.sessionArgs, [
    { planId: SERVER_PLAN_ID, sessionId: REQUESTED_SESSION_ID },
  ]);
});

test("16. the STORED row's id — never the requested one — reaches the count and the write", async () => {
  const { harness: h, result } = run({}, rawEdit({ definitionId: OTHER_DEFINITION_ID }));
  await result;
  assert.deepEqual(h.countArgs, [STORED_SESSION_ID]);
  assert.equal(h.updateArgs[0].sessionId, STORED_SESSION_ID);
  assert.notEqual(h.updateArgs[0].sessionId, REQUESTED_SESSION_ID);
});

test("17. the SERVER-RESOLVED plan id reaches BOTH scoped reads and the write", async () => {
  const { harness: h, result } = run({}, rawEdit({ definitionId: OTHER_DEFINITION_ID }));
  await result;
  assert.equal(h.sessionArgs[0].planId, SERVER_PLAN_ID);
  assert.equal(h.definitionArgs[0].planId, SERVER_PLAN_ID);
  assert.equal(h.updateArgs[0].planId, SERVER_PLAN_ID);
});

test("18. a caller-supplied planId or offering id never steers anything", async () => {
  const { harness: h, result } = run(
    {},
    rawEdit({ planId: "plan-chosen-by-client", courseOfferingId: "offering-chosen-by-client" }),
  );
  await result;
  assert.equal(h.updateArgs[0].planId, SERVER_PLAN_ID);
  const written = JSON.stringify(h.updateArgs[0].value);
  assert.equal(written.includes("plan-chosen-by-client"), false);
  assert.equal(written.includes("offering-chosen-by-client"), false);
});

// ===========================================================================
// 19–22. A missing plan and a missing session short-circuit
// ===========================================================================

test("19. a missing plan returns plan_not_found and skips everything after it", async () => {
  const { harness: h, result } = run({ plan: null });
  assert.deepEqual(await result, { ok: false, code: "plan_not_found" });
  assert.deepEqual(h.calls, [
    "requireCourseContext",
    "assertConfigurationAllowed",
    "findExamPlanByCourseOfferingId",
  ]);
});

test("20. a missing plan does NOT normalize the input: the plan refusal wins", async () => {
  const { result } = run(
    { plan: null },
    { definitionId: 7, date: "nope", startTime: "9:00", arena: 3 },
  );
  assert.deepEqual(await result, { ok: false, code: "plan_not_found" });
});

test("21. a missing session returns session_not_found and reaches no write", async () => {
  const { harness: h, result } = run({ session: null });
  assert.deepEqual(await result, { ok: false, code: "session_not_found" });
  assert.deepEqual(h.calls, [
    "requireCourseContext",
    "assertConfigurationAllowed",
    "findExamPlanByCourseOfferingId",
    "findSessionForUpdate",
  ]);
  assert.deepEqual(h.updateArgs, []);
});

test("22. a FOREIGN session is INDISTINGUISHABLE from a missing one", async () => {
  // The dependency cannot report "it exists, but under another plan": it is asked
  // for a session UNDER a plan and answers null. Both worlds are constructed here
  // and must be byte-identical to the caller.
  const missing = await run({ session: null }, rawEdit(), STORED_VERSION, "session-that-does-not-exist")
    .result;
  const foreign = await run({ session: null }, rawEdit(), STORED_VERSION, "session-of-another-plan")
    .result;
  assert.deepEqual(missing, foreign);
  assert.equal(JSON.stringify(missing), JSON.stringify(foreign));
  assert.deepEqual(missing, { ok: false, code: "session_not_found" });
});

// ===========================================================================
// 23–28. The version token
// ===========================================================================

test("23. the token predicate accepts only finite, non-negative integers", () => {
  for (const good of [0, 1, STORED_VERSION, Number.MAX_SAFE_INTEGER]) {
    assert.equal(isExamSessionVersionToken(good), true, `${good} was refused`);
  }
  for (const bad of [
    -1,
    -STORED_VERSION,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    "1700000000000",
    "",
    " 1 ",
    null,
    undefined,
    true,
    {},
    [],
  ]) {
    assert.equal(isExamSessionVersionToken(bad), false, `${String(bad)} was accepted`);
  }
});

test("24. a MALFORMED token refuses with invalid_input and its own stable code", async () => {
  for (const bad of [Number.NaN, -1, 1.5, Number.POSITIVE_INFINITY]) {
    const { harness: h, result } = run({}, rawEdit(), bad);
    const outcome = await result;
    assert.ok(!outcome.ok && outcome.code === "invalid_input", `${bad} was accepted`);
    const codes = !outcome.ok && "issues" in outcome ? outcome.issues.map((i) => i.code) : [];
    assert.deepEqual(codes, ["EX-SES-VERSION-INVALID"]);
    // ...and nothing after the session read ran.
    assert.deepEqual(h.definitionArgs, []);
    assert.deepEqual(h.countArgs, []);
    assert.deepEqual(h.updateArgs, []);
  }
});

test("25. a malformed token is refused even when the submission is a perfect NO-OP", async () => {
  // The no-op rule tolerates a STALE token; it does not tolerate a MALFORMED one,
  // because a malformed token means the request itself is malformed.
  const { harness: h, result } = run({}, rawNoop(), Number.NaN);
  const outcome = await result;
  assert.ok(!outcome.ok && outcome.code === "invalid_input");
  assert.deepEqual(h.updateArgs, []);
});

test("26. the token is checked BEFORE the input is normalized", async () => {
  // The submission is invalid in two ways AND the token is malformed. Only the
  // token's own code comes back, which proves the ordering.
  const { result } = run({}, rawEdit({ date: "2026-02-31", startTime: "24:00" }), Number.NaN);
  const outcome = await result;
  const codes = !outcome.ok && "issues" in outcome ? outcome.issues.map((i) => i.code) : [];
  assert.deepEqual(codes, ["EX-SES-VERSION-INVALID"]);
});

test("27. a STALE but well-formed token is decided by the WRITE, not by this module", async () => {
  // The row read in step 5 says one version; the caller sends another. This module
  // still attempts the write — refusing here from a row that could already be out
  // of date would be a guess.
  const { harness: h, result } = run({ updated: null }, rawEdit(), STORED_VERSION - 5_000);
  assert.deepEqual(await result, { ok: false, code: "stale_write" });
  assert.equal(h.updateArgs.length, 1);
  assert.equal(h.updateArgs[0].expectedUpdatedAt, STORED_VERSION - 5_000);
});

test("28. a stale token on a REAL change is stale_write, never a silent success", async () => {
  const { result } = run({ updated: null }, rawEdit({ startTime: "11:00" }), 1);
  assert.deepEqual(await result, { ok: false, code: "stale_write" });
});

// ===========================================================================
// 29–34. The no-op rule
// ===========================================================================

test("29. a submission identical to the stored row succeeds with changed:false", async () => {
  const { result } = run({}, rawNoop());
  assert.deepEqual(await result, {
    ok: true,
    sessionId: STORED_SESSION_ID,
    changed: false,
    updatedAt: STORED_VERSION,
  });
});

test("30. a no-op performs ZERO writes, definition reads and assignment counts", async () => {
  const { harness: h, result } = run({}, rawNoop());
  await result;
  assert.deepEqual(h.calls, [
    "requireCourseContext",
    "assertConfigurationAllowed",
    "findExamPlanByCourseOfferingId",
    "findSessionForUpdate",
  ]);
  assert.deepEqual(h.definitionArgs, []);
  assert.deepEqual(h.countArgs, []);
  assert.deepEqual(h.updateArgs, []);
});

test("31. a no-op reports the AUTHORITATIVE version, not the caller's token", async () => {
  const { result } = run({}, rawNoop(), STORED_VERSION - 99_000);
  const outcome = await result;
  assert.ok(outcome.ok && outcome.changed === false);
  assert.equal(outcome.ok && outcome.updatedAt, STORED_VERSION);
});

test("32. a WELL-FORMED STALE token still yields changed:false when nothing differs", async () => {
  // This is the documented, deliberate interaction: the no-op is decided against
  // the AUTHORITATIVE row, so "your token is old" and "the row already says
  // exactly this" can both be true, and there is nothing left to protect.
  const { harness: h, result } = run({}, rawNoop(), 1);
  const outcome = await result;
  assert.deepEqual(outcome, {
    ok: true,
    sessionId: STORED_SESSION_ID,
    changed: false,
    updatedAt: STORED_VERSION,
  });
  assert.deepEqual(h.updateArgs, [], "a stale no-op still wrote");
});

test("33. the no-op comparison covers all SIX values and is exact", async () => {
  // Whitespace-only differences are erased by the committed normalizer's trim, so
  // they are correctly still a no-op...
  const trimmedAway = await run({}, rawNoop({ arena: "  זירה מקורה  " })).result;
  assert.ok(trimmedAway.ok && trimmedAway.changed === false);

  // ...while a real difference in ANY of the six is a change.
  const differences: Record<string, unknown>[] = [
    { definitionId: OTHER_DEFINITION_ID },
    { date: "2026-08-04" },
    { startTime: "09:01" },
    { arena: "זירה מקורה " + "x" },
    { title: "מבחן רכיבה!" },
    { notes: "הערה אחרת" },
  ];
  for (const over of differences) {
    const { harness: h, result } = run({}, rawNoop(over));
    const outcome = await result;
    assert.ok(outcome.ok && outcome.changed === true, `${JSON.stringify(over)} read as a no-op`);
    assert.equal(h.updateArgs.length, 1);
  }
});

test("34. null and blank are the SAME stored value, so switching between them is a no-op", async () => {
  const stored = storedSession({ notes: null });
  for (const blank of [undefined, null, "", "   "]) {
    const { harness: h, result } = run({ session: stored }, rawNoop({ notes: blank }));
    const outcome = await result;
    assert.ok(
      outcome.ok && outcome.changed === false,
      `${String(blank)} was treated as a change`,
    );
    assert.deepEqual(h.updateArgs, []);
  }
});

// ===========================================================================
// 35–41. The definition-change gate
// ===========================================================================

test("35. a definition change with ZERO assignments is allowed and written", async () => {
  const { harness: h, result } = run(
    { assignmentCount: 0 },
    rawEdit({ definitionId: OTHER_DEFINITION_ID }),
  );
  const outcome = await result;
  assert.ok(outcome.ok && outcome.changed === true);
  assert.equal(h.updateArgs[0].value.definitionId, OTHER_DEFINITION_ID);
});

test("36. a definition change with assignments refuses, and writes NOTHING", async () => {
  const { harness: h, result } = run(
    { assignmentCount: 1 },
    rawEdit({ definitionId: OTHER_DEFINITION_ID, startTime: "12:00", notes: "הערה אחרת" }),
  );
  assert.deepEqual(await result, { ok: false, code: "definition_change_not_allowed" });
  // Not even the OTHER five values are written: a partial success would let a
  // manager believe the exam had been switched.
  assert.deepEqual(h.updateArgs, []);
});

test("37. any positive assignment count refuses; only zero permits the change", async () => {
  for (const count of [1, 2, 17]) {
    const { result } = run({ assignmentCount: count }, rawEdit({ definitionId: OTHER_DEFINITION_ID }));
    assert.deepEqual(await result, { ok: false, code: "definition_change_not_allowed" });
  }
  const { result } = run({ assignmentCount: 0 }, rawEdit({ definitionId: OTHER_DEFINITION_ID }));
  assert.ok((await result).ok);
});

test("38. a session WITH assignments may still edit its other five values", async () => {
  const { harness: h, result } = run(
    { assignmentCount: 9 },
    rawEdit({ date: "2026-08-10", startTime: "14:00", arena: "זירה אחרת" }),
  );
  const outcome = await result;
  assert.ok(outcome.ok && outcome.changed === true);
  // The count was never even asked for: the definition did not change.
  assert.deepEqual(h.countArgs, []);
  assert.equal(h.updateArgs[0].value.date, "2026-08-10");
});

test("39. a definition that is absent under the resolved plan refuses the edit", async () => {
  const { harness: h, result } = run(
    { definition: null },
    rawEdit({ definitionId: OTHER_DEFINITION_ID }),
  );
  assert.deepEqual(await result, { ok: false, code: "definition_not_found" });
  // The count and the write are both skipped.
  assert.deepEqual(h.countArgs, []);
  assert.deepEqual(h.updateArgs, []);
});

test("40. a FOREIGN definition is INDISTINGUISHABLE from a missing one", async () => {
  const missing = await run(
    { definition: null },
    rawEdit({ definitionId: "definition-that-does-not-exist" }),
  ).result;
  const foreign = await run(
    { definition: null },
    rawEdit({ definitionId: "definition-of-another-plan" }),
  ).result;
  assert.deepEqual(missing, foreign);
  assert.equal(JSON.stringify(missing), JSON.stringify(foreign));
  assert.deepEqual(missing, { ok: false, code: "definition_not_found" });
});

test("41. the definition lookup is asked with the SUBMITTED id, trimmed, never widened", async () => {
  const { harness: h, result } = run({}, rawEdit({ definitionId: "  Definition-MiXeD-Case  " }));
  await result;
  assert.deepEqual(h.definitionArgs, [
    { planId: SERVER_PLAN_ID, definitionId: "Definition-MiXeD-Case" },
  ]);
});

// ===========================================================================
// 41a–41k. The ATOMIC assignment guard, and the race it closes
// ===========================================================================

test("41a. a definition change asks the write to require NO assignments", async () => {
  const { harness: h, result } = run({}, rawEdit({ definitionId: OTHER_DEFINITION_ID }));
  await result;
  assert.equal(h.updateArgs.length, 1);
  assert.equal(
    h.updateArgs[0].requireNoAssignments,
    true,
    "a definition change was written without the atomic guard",
  );
});

test("41b. an ORDINARY edit asks the write NOT to require it", async () => {
  for (const over of [
    { date: "2026-08-09" },
    { startTime: "16:00" },
    { arena: "זירה אחרת" },
    { title: "כותרת אחרת" },
    { notes: "הערה אחרת" },
  ]) {
    const { harness: h, result } = run({}, rawNoop(over));
    await result;
    assert.equal(
      h.updateArgs[0].requireNoAssignments,
      false,
      `${JSON.stringify(over)} attached the assignment guard to an ordinary edit`,
    );
  }
});

test("41c. an ordinary edit of an ASSIGNED session still succeeds, unguarded", async () => {
  // The regression this must never become: a session people are assigned to must
  // stay correctable. The count is not even consulted.
  const { harness: h, result } = run({ assignmentCount: 12 }, rawNoop({ startTime: "17:45" }));
  const outcome = await result;
  assert.ok(outcome.ok && outcome.changed === true, "an assigned session could not be corrected");
  assert.deepEqual(h.countArgs, [], "an ordinary edit consulted the assignment count");
  assert.equal(h.updateArgs[0].requireNoAssignments, false);
  assert.equal(h.updateArgs[0].value.startTime, "17:45");
});

test("41d. AN ASSIGNMENT APPEARING AFTER THE PRE-CHECK causes zero write effect", async () => {
  // The race, exactly: the count says zero, the guarded statement then matches
  // nothing because someone was assigned in between.
  const { harness: h, result } = run(
    { updated: null, assignmentCounts: [0, 2] },
    rawEdit({ definitionId: OTHER_DEFINITION_ID }),
  );
  assert.deepEqual(await result, { ok: false, code: "definition_change_not_allowed" });

  // The write was ATTEMPTED once — and reported no match, which is the guard
  // doing its job — and was never attempted again.
  assert.equal(h.updateArgs.length, 1, "the write was retried");
  assert.equal(h.updateArgs[0].requireNoAssignments, true);
});

test("41e. the lost race is classified by RE-READING, in the locked order", async () => {
  const { harness: h, result } = run(
    { updated: null, assignmentCounts: [0, 2] },
    rawEdit({ definitionId: OTHER_DEFINITION_ID }),
  );
  await result;
  assert.deepEqual(h.calls, [
    "requireCourseContext",
    "assertConfigurationAllowed",
    "findExamPlanByCourseOfferingId",
    "findSessionForUpdate",
    "findDefinitionForPlan",
    "countAssignmentsForSession",
    "updateSessionIfCurrent",
    // ...and only now the classification, reads only.
    "findSessionForUpdate",
    "countAssignmentsForSession",
  ]);
  // Both re-reads are asked about the SERVER plan and the STORED row.
  assert.deepEqual(h.sessionArgs[1], { planId: SERVER_PLAN_ID, sessionId: STORED_SESSION_ID });
  assert.deepEqual(h.countArgs, [STORED_SESSION_ID, STORED_SESSION_ID]);
});

test("41f. a guarded write that lost to a VERSION change is stale_write, not the gate", async () => {
  const { harness: h, result } = run(
    {
      updated: null,
      sessionOnRecheck: storedSession({ updatedAt: STORED_VERSION + 1_000 }),
      // Even with assignments present, the version moved first and that is the
      // honest explanation.
      assignmentCounts: [0, 5],
    },
    rawEdit({ definitionId: OTHER_DEFINITION_ID }),
  );
  assert.deepEqual(await result, { ok: false, code: "stale_write" });
  // The second count is never asked: the version answer already decided it.
  assert.deepEqual(h.countArgs, [STORED_SESSION_ID]);
});

test("41g. a guarded write whose row VANISHED is stale_write, and counts nothing more", async () => {
  const { harness: h, result } = run(
    { updated: null, sessionOnRecheck: null, assignmentCounts: [0, 9] },
    rawEdit({ definitionId: OTHER_DEFINITION_ID }),
  );
  assert.deepEqual(await result, { ok: false, code: "stale_write" });
  assert.deepEqual(h.countArgs, [STORED_SESSION_ID], "a vanished row was still counted");
});

test("41h. a guarded write that matched nothing while still unassigned FAILS CLOSED", async () => {
  // Nothing explains the zero match, so the safe answer is "reload", never a
  // silent success and never a retry.
  const { harness: h, result } = run(
    { updated: null, assignmentCounts: [0, 0] },
    rawEdit({ definitionId: OTHER_DEFINITION_ID }),
  );
  assert.deepEqual(await result, { ok: false, code: "stale_write" });
  assert.equal(h.updateArgs.length, 1, "the write was retried");
});

test("41i. an ORDINARY edit that matched nothing needs no re-read at all", async () => {
  // It carried no assignment condition, so there is exactly one possible reason
  // and a re-read could not add anything.
  const { harness: h, result } = run({ updated: null }, rawEdit());
  assert.deepEqual(await result, { ok: false, code: "stale_write" });
  assert.deepEqual(h.calls, [
    "requireCourseContext",
    "assertConfigurationAllowed",
    "findExamPlanByCourseOfferingId",
    "findSessionForUpdate",
    "updateSessionIfCurrent",
  ]);
  assert.deepEqual(h.countArgs, []);
});

test("41j. the write is invoked EXACTLY ONCE in the source: no retry exists", () => {
  assert.equal(
    (CODE.match(/deps\.updateSessionIfCurrent\(/g) ?? []).length,
    1,
    "the write appears more than once — a retry path exists",
  );
  for (const token of ["retry", "Retry", "attempt", "backoff", "while (", "for (", "setTimeout"]) {
    assert.equal(CODE.includes(token), false, `the pure core contains ${token}`);
  }
  // The classification helper reads and refuses; it can reach no write at all.
  const helper = CODE.slice(CODE.indexOf("async function classifyFailedDefinitionChange"));
  assert.equal(helper.includes("updateSessionIfCurrent"), false, "the classifier writes");
  assert.ok(helper.includes("findSessionForUpdate"));
  assert.ok(helper.includes("countAssignmentsForSession"));
});

test("41k. the pre-check remains, and is documented as a DIAGNOSTIC not the guard", () => {
  // Both survive: the early refusal AND the atomic condition.
  assert.ok(/deps\.countAssignmentsForSession\(/.test(CODE));
  assert.ok(/requireNoAssignments/.test(CODE));
  assert.ok(/definitionChanged/.test(CODE), "the flag that drives the guard is missing");
  // The write's flag is the SAME value the gate branched on, so the two cannot
  // disagree about which case this is.
  assert.ok(
    /const definitionChanged\s*=/.test(CODE),
    "the definition-change decision is not computed once",
  );
  assert.ok(/diagnostic/i.test(COMMENTS), "the pre-check is not described as a diagnostic");
});

// ===========================================================================
// 42–45. Invalid input
// ===========================================================================

test("42. invalid input returns invalid_input with the COMMITTED issue codes", async () => {
  const { result } = run({}, rawEdit({ date: "2026-02-31", startTime: "24:00" }));
  const outcome = await result;
  assert.ok(!outcome.ok && outcome.code === "invalid_input");
  const codes = !outcome.ok && "issues" in outcome ? outcome.issues.map((i) => i.code) : [];
  // The committed core's codes, in ITS fixed field order.
  assert.deepEqual(codes, ["EX-SES-DATE-INVALID", "EX-SES-START-TIME-INVALID"]);
});

test("43. invalid input causes ZERO definition reads, counts and writes", async () => {
  const broken = [
    rawEdit({ definitionId: "" }),
    rawEdit({ definitionId: 12 }),
    rawEdit({ date: "03/08/2026" }),
    rawEdit({ startTime: "9:00" }),
    rawEdit({ arena: { name: "זירה" } }),
    rawEdit({ title: 5 }),
    rawEdit({ notes: [] }),
    {},
    null,
    "not an object",
  ];
  for (const raw of broken) {
    const { harness: h, result } = run({}, raw);
    const outcome = await result;
    assert.ok(!outcome.ok && outcome.code === "invalid_input", `accepted: ${JSON.stringify(raw)}`);
    assert.deepEqual(h.definitionArgs, []);
    assert.deepEqual(h.countArgs, []);
    assert.deepEqual(h.updateArgs, []);
    assert.deepEqual(h.calls, [
      "requireCourseContext",
      "assertConfigurationAllowed",
      "findExamPlanByCourseOfferingId",
      "findSessionForUpdate",
    ]);
  }
});

test("44. an issue array is a fresh FROZEN copy that aliases nothing", async () => {
  const { result } = run({}, rawEdit({ date: "not-a-date" }));
  const outcome = await result;
  assert.ok(!outcome.ok && "issues" in outcome);
  if (!outcome.ok && "issues" in outcome) {
    assert.ok(Object.isFrozen(outcome.issues));
    assert.throws(() => (outcome.issues as unknown as unknown[]).push({}));
  }
});

test("45. a diagnostic NEVER echoes a submitted value", async () => {
  const secret = "SUBMITTED-SENTINEL-VALUE";
  const { result } = run({}, rawEdit({ date: secret, startTime: secret, arena: { secret } }));
  const outcome = await result;
  assert.equal(JSON.stringify(outcome).includes(secret), false, "a diagnostic echoed the input");
});

// ===========================================================================
// 46–50. Classification and propagation
// ===========================================================================

test("46. a course not-found maps to offering_not_found and stops immediately", async () => {
  const { harness: h, result } = run({ contextThrows: new FakeCourseNotFoundError() });
  assert.deepEqual(await result, { ok: false, code: "offering_not_found" });
  assert.deepEqual(h.calls, ["requireCourseContext"]);
});

test("47. a lifecycle denial maps to operation_not_allowed and costs zero exam reads", async () => {
  const { harness: h, result } = run({
    status: "ARCHIVED",
    gateThrows: new FakeOperationDeniedError(),
  });
  assert.deepEqual(await result, { ok: false, code: "operation_not_allowed" });
  assert.deepEqual(h.calls, ["requireCourseContext", "assertConfigurationAllowed"]);
  assert.deepEqual(h.planLookupArgs, []);
  assert.deepEqual(h.sessionArgs, []);
  assert.deepEqual(h.updateArgs, []);
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
  ["findSessionForUpdate", (thrown) => ({ sessionThrows: thrown })],
  ["findDefinitionForPlan", (thrown) => ({ definitionThrows: thrown })],
  ["countAssignmentsForSession", (thrown) => ({ countThrows: thrown })],
  ["updateSessionIfCurrent", (thrown) => ({ updateThrows: thrown })],
];

test("48. a REDIRECT-shaped error propagates unchanged from every dependency", async () => {
  const redirect = redirectLikeError();
  for (const [dependency, build] of THROW_PATHS) {
    await assert.rejects(
      () => run(build(redirect), rawEdit({ definitionId: OTHER_DEFINITION_ID })).result,
      (error) => error === redirect,
      `${dependency} swallowed the redirect`,
    );
  }
});

test("49. no error is swallowed broadly: only the two classified shapes refuse", async () => {
  const unrelated = [
    new Error("infrastructure fault"),
    new TypeError("programming error"),
    // Neither a uniqueness violation, a foreign-key violation nor a
    // record-not-found is classified by this slice: none is reachable through an
    // approved path, and laundering one into a refusal would hide a real defect.
    { code: "P2002", meta: { target: ["planId", "sourceLesson"] } },
    { code: "P2003" },
    { code: "P2025" },
  ];
  for (const thrown of unrelated) {
    for (const [dependency, build] of THROW_PATHS) {
      await assert.rejects(
        () => run(build(thrown), rawEdit({ definitionId: OTHER_DEFINITION_ID })).result,
        (error) => error === thrown,
        `${dependency} absorbed ${JSON.stringify(thrown)}`,
      );
    }
  }
});

test("50. a failed read reaches no write at all", async () => {
  for (const [label, build] of [
    ["plan", (t: unknown) => ({ planThrows: t })],
    ["session", (t: unknown) => ({ sessionThrows: t })],
    ["definition", (t: unknown) => ({ definitionThrows: t })],
    ["count", (t: unknown) => ({ countThrows: t })],
  ] as const) {
    const boom = new Error(`${label} query exploded`);
    const { harness: h, result } = run(
      build(boom),
      rawEdit({ definitionId: OTHER_DEFINITION_ID }),
    );
    await assert.rejects(
      () => result,
      (error) => error === boom,
    );
    assert.deepEqual(h.updateArgs, [], `${label}: a write ran anyway`);
  }
});

// ===========================================================================
// 51–57. The result model
// ===========================================================================

/** Every outcome this core can produce, for the whole-model assertions. */
async function everyOutcome(): Promise<UpdateExamSessionResult[]> {
  return [
    await run().result,
    await run({}, rawNoop()).result,
    await run({}, rawEdit({ date: "bad" })).result,
    await run({}, rawEdit(), Number.NaN).result,
    await run({ plan: null }).result,
    await run({ session: null }).result,
    await run({ definition: null }, rawEdit({ definitionId: OTHER_DEFINITION_ID })).result,
    await run({ assignmentCount: 4 }, rawEdit({ definitionId: OTHER_DEFINITION_ID })).result,
    await run({ updated: null }).result,
    await run({ contextThrows: new FakeCourseNotFoundError() }).result,
    await run({ gateThrows: new FakeOperationDeniedError() }).result,
  ];
}

test("51. no plan, course, definition, date or actor identifier enters any result", async () => {
  for (const outcome of await everyOutcome()) {
    const serialized = JSON.stringify(outcome);
    for (const forbidden of [
      SERVER_PLAN_ID,
      VERIFIED_OFFERING_ID,
      REQUESTED_OFFERING_ID,
      STORED_DEFINITION_ID,
      OTHER_DEFINITION_ID,
      "2026-08-03",
      "09:00",
      "זירה מקורה",
      "planId",
      "courseOfferingId",
      "definitionId",
      "adminId",
      "assignmentCount",
    ]) {
      assert.equal(serialized.includes(forbidden), false, `${forbidden} leaked into ${serialized}`);
    }
  }
});

test("52. every result key is drawn from the approved surface only", async () => {
  const allowed = new Set(["ok", "sessionId", "changed", "updatedAt", "code", "issues"]);
  for (const outcome of await everyOutcome()) {
    for (const key of Object.keys(outcome)) {
      assert.ok(allowed.has(key), `an unapproved key exists: ${key}`);
    }
  }
});

test("53. every result is a plain object with no prototype surprises", async () => {
  for (const outcome of await everyOutcome()) {
    assert.equal(Object.getPrototypeOf(outcome), Object.prototype);
    assert.equal(outcome instanceof Error, false);
  }
});

test("54. every result deep-equals its JSON round trip, and is FROZEN", async () => {
  for (const outcome of await everyOutcome()) {
    assert.deepEqual(JSON.parse(JSON.stringify(outcome)), outcome);
    assert.ok(Object.isFrozen(outcome), `a result is mutable: ${JSON.stringify(outcome)}`);
    if (!outcome.ok && "issues" in outcome) {
      assert.ok(Object.isFrozen(outcome.issues));
    }
  }
});

test("55. no result carries an undefined property value, and issues is arm-exclusive", async () => {
  for (const outcome of await everyOutcome()) {
    for (const [key, value] of Object.entries(outcome)) {
      assert.notEqual(value, undefined, `${key} is present-but-undefined`);
    }
  }
  const planRefusal = await run({ plan: null }).result;
  assert.equal("issues" in planRefusal, false);
  const success = await run().result;
  assert.equal("issues" in success, false);
  assert.equal("code" in success, false);
});

test("56. no result contains a calendar object, Map, Set or BigInt anywhere", async () => {
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

test("57. the two success arms differ only in `changed`, and both report a number", async () => {
  const changed = await run().result;
  const unchanged = await run({}, rawNoop()).result;
  assert.ok(changed.ok && unchanged.ok);
  if (changed.ok && unchanged.ok) {
    assert.equal(changed.changed, true);
    assert.equal(unchanged.changed, false);
    assert.equal(typeof changed.updatedAt, "number");
    assert.equal(typeof unchanged.updatedAt, "number");
    assert.deepEqual(Object.keys(changed).sort(), Object.keys(unchanged).sort());
  }
});

// ===========================================================================
// 58–60. The raw input is never touched
// ===========================================================================

test("58. the source raw input is never modified", async () => {
  const raw = rawEdit();
  const before = JSON.stringify(raw);
  await run({}, raw).result;
  assert.equal(JSON.stringify(raw), before);
});

test("59. a FROZEN raw input is supported, valid or not", async () => {
  const valid = Object.freeze(rawEdit());
  const outcome = await run({}, valid).result;
  assert.ok(outcome.ok && outcome.changed === true);

  const invalid = Object.freeze(rawEdit({ startTime: "24:00" }));
  const refusal = await run({}, invalid).result;
  assert.ok(!refusal.ok && refusal.code === "invalid_input");
});

test("60. mutating the raw input AFTER the call cannot change the written payload", async () => {
  const raw = rawEdit();
  const { harness: h, result } = run({}, raw);
  await result;
  raw.arena = "זירה אחרת";
  assert.equal(h.updateArgs[0].value.arena, "זירה מקורה");
});

// ===========================================================================
// Structural guards on the pure core
// ===========================================================================

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const EXAM_DIR = join(REPO_ROOT, "lib", "exam");
const MODULE_NAME = "update-exam-session-core.ts";
const TEST_NAME = "update-exam-session-core.test.ts";
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
    "dateKey",
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
  // ...and the reason both conversions live in the IO layer is documented.
  assert.ok(/timezone/i.test(COMMENTS), "the timezone reasoning is undocumented");
});

test("S7. the pure core imports ONLY the committed sibling session input core", () => {
  const specifiers = [...CODE.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.ok(specifiers.length > 0, "sanity: the module should import something");
  assert.deepEqual([...new Set(specifiers)], ["./exam-session-write-core"]);
});

test("S8. the committed normalizer is CALLED rather than having its rules copied", () => {
  assert.ok(
    /\bnormalizeExamSessionEditInput\s*\(/.test(CODE),
    "the pure core does not call the committed EDIT normalizer",
  );
  for (const token of [
    "isValidDateKey",
    "isValidHHMM",
    "hasOwnProperty",
    ".trim(",
    ".toLowerCase(",
    ".normalize(",
    // The six committed FIELD codes belong to the input core and are not
    // restated here. The module's own version-token code is a different thing
    // and is asserted on below.
    "EX-SES-DEFINITION-REQUIRED",
    "EX-SES-DATE-INVALID",
    "EX-SES-START-TIME-INVALID",
    "EX-SES-ARENA-INVALID",
    "EX-SES-TITLE-INVALID",
    "EX-SES-NOTES-INVALID",
  ]) {
    assert.equal(CODE.includes(token), false, `the pure core restates ${token}`);
  }
  // The CREATE normalizer is NOT bound here: this is the edit path.
  assert.equal(CODE.includes("normalizeExamSessionCreateInput"), false);
  // The one code it does own.
  assert.ok(CODE.includes("EX-SES-VERSION-INVALID"));
});

test("S9. the module exports exactly the intended surface", () => {
  const functions = [...SOURCE.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)].map(
    (match) => match[1],
  );
  assert.deepEqual(functions, ["isExamSessionVersionToken", "updateExamSessionWithDeps"]);

  const orchestration = [
    ...SOURCE.matchAll(/export async function (\w+)\(([\s\S]*?)\):\s*([^{]+)\{/g),
  ].map(([, name, params, returns]) => ({
    name,
    params: params.replace(/\s+/g, " ").trim(),
    returns: returns.replace(/\s+/g, " ").trim(),
  }))[0];
  assert.equal(
    orchestration.params,
    "courseOfferingId: string, sessionId: string, expectedUpdatedAt: number, rawInput: unknown, deps: UpdateExamSessionDeps,",
  );
  assert.equal(orchestration.returns, "Promise<UpdateExamSessionResult>");
  for (const forbidden of [
    "planId",
    "definitionId",
    "orderIndex",
    "adminId",
    "actorId",
    "instructorId",
    "studentId",
    "assignmentCount",
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

test("S10. the injected boundary cannot create, delete, reorder, publish or announce", () => {
  for (const token of [
    "createPlan",
    "upsertPlan",
    "ensurePlan",
    "createExamPlan",
    "createSession",
    "deleteSession",
    "publish",
    "unpublish",
    "notify",
    "notification",
    "reorder",
    "archive",
    "supervisor",
    "Supervisor",
    "break",
    "Break",
  ]) {
    assert.equal(CODE.includes(token), false, `the pure core exposes ${token}`);
  }
  // The write dependency is the ONLY effect that can change anything, and the
  // assignment dependency is a COUNT.
  const deps = CODE.slice(
    CODE.indexOf("export interface UpdateExamSessionDeps"),
    CODE.indexOf("export type UpdateExamSessionOwnIssueCode"),
  );
  const methods = [...deps.matchAll(/^\s{2}(\w+)[(<]/gm)].map((match) => match[1]);
  assert.deepEqual(methods.sort(), [
    "assertConfigurationAllowed",
    "countAssignmentsForSession",
    "findDefinitionForPlan",
    "findExamPlanByCourseOfferingId",
    "findSessionForUpdate",
    "isCourseNotFoundError",
    "isOperationNotAllowedError",
    "requireCourseContext",
    "updateSessionIfCurrent",
  ]);
  assert.ok(
    /countAssignmentsForSession\(sessionId: string\): Promise<number>/.test(CODE),
    "the assignment dependency is not a plain count",
  );
});

test("S11. no result code beyond the eight approved outcomes exists", () => {
  const codes = [...CODE.matchAll(/refuse\("([a-z_]+)"\)|code: "([a-z_]+)"/g)]
    .map((match) => match[1] ?? match[2])
    .filter((code): code is string => typeof code === "string");
  assert.deepEqual(
    [...new Set(codes)].sort(),
    [
      "definition_change_not_allowed",
      "definition_not_found",
      "invalid_input",
      "offering_not_found",
      "operation_not_allowed",
      "plan_not_found",
      "session_not_found",
      "stale_write",
    ],
  );
  for (const token of [
    "unexpected",
    "duplicate",
    "conflict",
    "session_has_assignments",
    "P2002",
    "P2003",
    "P2025",
  ]) {
    assert.equal(CODE.includes(token), false, `the pure core invents ${token}`);
  }
});

test("S12. the beginner-session and orderIndex limitations are documented HONESTLY", () => {
  assert.ok(/beginner/i.test(COMMENTS), "the beginner rule is not discussed at all");
  assert.equal(
    /(guarantee|prevent|ensure)s?[^.]{0,80}beginner/i.test(COMMENTS),
    false,
    "the header claims a beginner refusal it does not perform",
  );
  // No kind is read anywhere in the code.
  for (const token of ["kind", "Kind", "BEGINNER"]) {
    assert.equal(CODE.includes(token), false, `the pure core reads ${token}`);
  }
  // The order position is never written, and the consequence is stated.
  assert.equal(CODE.includes("orderIndex"), false, "the pure core references orderIndex");
  assert.ok(/orderIndex/.test(COMMENTS), "the untouched order position is undocumented");
});

test("S13. the atomic guard is documented, and the residual window stated HONESTLY", () => {
  assert.ok(/assignment/i.test(COMMENTS), "the assignment gate is not discussed");
  assert.ok(/atomic/i.test(COMMENTS), "the atomic condition is not described");
  assert.ok(
    /check-then-act|check then act/i.test(COMMENTS),
    "the race the guard closes is not named",
  );
  assert.ok(/fails? closed/i.test(COMMENTS), "the fail-closed posture is not stated");
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

test("S14. the no-op / stale-token interaction is documented HONESTLY", () => {
  assert.ok(/no-op/i.test(COMMENTS), "the no-op rule is not discussed");
  assert.ok(/stale/i.test(COMMENTS), "the stale-token rule is not discussed");
  assert.ok(
    /malformed/i.test(COMMENTS),
    "the malformed-token rule is not distinguished from the stale one",
  );
});

test("S15. the slice's two lib/exam files are exactly the approved pair", () => {
  const sliceFiles = readdirSync(EXAM_DIR)
    .filter((name) => name.startsWith("update-exam-session-core"))
    .sort();
  assert.deepEqual(sliceFiles, [MODULE_NAME, TEST_NAME].sort());
});

test("S16. this suite opens no database and reads no environment", () => {
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
    ["./update-exam-session-core", "node:assert/strict", "node:fs", "node:path", "node:test"],
  );
});
