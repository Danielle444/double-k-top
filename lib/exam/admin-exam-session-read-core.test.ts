/**
 * EXAM EX-SES-R1 — the PURE admin stored-ExamSession read, proven DB-free.
 *
 * DB-FREE AND PRODUCTION-FREE: every case injects plain in-memory scalar rows
 * through the committed dependency seam. This suite opens no database
 * connection, executes no SQL, reads no session, touches no environment
 * variable, constructs no `Date` and makes no network request. The only file it
 * reads from disk is the module under test, for the structural guards.
 *
 * WHAT IS PROVEN HERE:
 *   - the LOCKED order, and that authorization precedes EVERY query;
 *   - that only the VERIFIED offering id and the SERVER-resolved plan id ever
 *     scope a query, and that no caller-supplied plan id is expressible;
 *   - the plan-absent view, and that it costs no further query;
 *   - the empty-session view, and that it costs no count query;
 *   - the EXACT dependency-call count at every size — no N+1 for 1, 3 or 60
 *     sessions;
 *   - the batched count join: correct attribution, zero for a missing group, and
 *     no attribution of a group naming a session outside the plan's own set;
 *   - the locked total order: date, then position, then time, then the id
 *     tie-break — and that the tie-break id is published only as `sessionId`;
 *   - the MISSING-DEFINITION invariant: such a row is omitted, never emitted
 *     with an invented, blank or placeholder name or kind;
 *   - the result model: narrow, plain, frozen, JSON-round-trippable, and free of
 *     any `Date`, plan id, course offering id, actor, assignment record, student
 *     or instructor;
 *   - that NOTHING is classified: a denial, a redirect and an infrastructure
 *     failure all propagate unchanged;
 *   - the structural promises: no IO, no auth, no capability, no write method,
 *     no transaction, no raw SQL and no Teaching-Practice reference.
 *
 * NOTE ON IDS: the fixtures use obviously-fake, hyphenated ids. No cuid-shaped
 * literal and no production identifier is written here.
 *
 * Run with: npx tsx --test lib/exam/admin-exam-session-read-core.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { findNonPlainJsonPaths } from "./exam-read-dto";
import {
  emptyAdminExamSessionsView,
  readAdminExamSessionsWithDeps,
  type AdminExamSessionsView,
  type ExamSessionAssignmentCountRow,
  type ReadAdminExamSessionsDeps,
  type ResolvedExamPlanForSessionRead,
  type StoredAdminExamSessionRow,
  type StoredExamSessionDefinitionRow,
} from "./admin-exam-session-read-core";

// ===========================================================================
// Fixtures
// ===========================================================================

/** What the caller ASKS for. Deliberately different from what is verified. */
const REQUESTED_OFFERING_ID = "offering-as-requested";
/** What the boundary VERIFIED. Only this may reach the plan lookup. */
const VERIFIED_OFFERING_ID = "offering-as-verified";
/** The plan the SERVER resolved. Only this may reach the scoped reads. */
const SERVER_PLAN_ID = "plan-resolved-by-server";

const PLAN_PUBLISHED_AT = 1_754_000_000_000;
const SESSION_UPDATED_AT = 1_753_000_000_111;

const DEF_RIDING = "definition-riding";
const DEF_INTERFACE = "definition-interface";
const DEF_ADVANCED = "definition-advanced";
/** A definition id no definition row carries — the invariant's probe. */
const DEF_VANISHED = "definition-that-is-not-in-the-plan";

const DAY_ONE = "2026-08-03";
const DAY_TWO = "2026-08-04";

function definitionRow(
  over: Partial<StoredExamSessionDefinitionRow> & { readonly id: string },
): StoredExamSessionDefinitionRow {
  return Object.freeze({
    id: over.id,
    name: over.name ?? `שם ${over.id}`,
    kind: over.kind ?? "INTERFACE_RIDING",
    durationMinutes: over.durationMinutes ?? 15,
    parallelCapacity: over.parallelCapacity ?? 1,
    orderIndex: over.orderIndex ?? 0,
  });
}

/**
 * THREE definitions, deliberately supplied OUT of order, with two of them
 * sharing one kind — two exams of the same kind must never collapse.
 */
const DEFINITION_ROWS: readonly StoredExamSessionDefinitionRow[] = Object.freeze([
  definitionRow({ id: DEF_ADVANCED, name: "הדרכה מתקדמת", kind: "ADVANCED_INSTRUCTION", orderIndex: 2, durationMinutes: 30 }),
  definitionRow({ id: DEF_RIDING, name: "רכיבה", orderIndex: 0 }),
  definitionRow({ id: DEF_INTERFACE, name: "ממשק", orderIndex: 1, parallelCapacity: 2, durationMinutes: 20 }),
]);

function sessionRow(
  over: Partial<StoredAdminExamSessionRow> & { readonly id: string },
): StoredAdminExamSessionRow {
  return Object.freeze({
    id: over.id,
    definitionId: over.definitionId ?? DEF_RIDING,
    dateKey: over.dateKey ?? DAY_ONE,
    startTime: over.startTime ?? "09:00",
    arena: over.arena ?? null,
    title: over.title ?? null,
    notes: over.notes ?? null,
    orderIndex: over.orderIndex ?? 0,
    updatedAt: over.updatedAt ?? SESSION_UPDATED_AT,
  });
}

/** Supplied OUT of order, so the core's sort is doing real work. */
const SESSION_ROWS: readonly StoredAdminExamSessionRow[] = Object.freeze([
  sessionRow({ id: "session-day-two-first", dateKey: DAY_TWO, orderIndex: 0, startTime: "08:00", definitionId: DEF_ADVANCED }),
  sessionRow({ id: "session-day-one-second", dateKey: DAY_ONE, orderIndex: 1, startTime: "11:00", definitionId: DEF_INTERFACE, arena: "זירה א", title: "מחזור ראשון" }),
  sessionRow({ id: "session-day-one-first", dateKey: DAY_ONE, orderIndex: 0, startTime: "09:00", definitionId: DEF_RIDING, notes: "הערה" }),
]);

function countRow(sessionId: string, assignmentCount: number): ExamSessionAssignmentCountRow {
  return Object.freeze({ sessionId, assignmentCount });
}

const COUNT_ROWS: readonly ExamSessionAssignmentCountRow[] = Object.freeze([
  countRow("session-day-one-second", 4),
  countRow("session-day-one-first", 2),
]);

/** The fixture, serialized ONCE, so mutation by the core is detectable. */
const FIXTURE_SNAPSHOT = JSON.stringify({
  definitions: DEFINITION_ROWS,
  sessions: SESSION_ROWS,
  counts: COUNT_ROWS,
});

// ===========================================================================
// The injected boundary — the ONLY fakes in this suite
// ===========================================================================

interface Calls {
  readonly order: string[];
  readonly contextArgs: string[];
  readonly gateArgs: string[];
  readonly planArgs: string[];
  readonly definitionArgs: string[];
  readonly sessionArgs: string[];
  readonly countArgs: string[];
}

function makeCalls(): Calls {
  return {
    order: [],
    contextArgs: [],
    gateArgs: [],
    planArgs: [],
    definitionArgs: [],
    sessionArgs: [],
    countArgs: [],
  };
}

interface Overrides {
  readonly status?: string;
  readonly plan?: ResolvedExamPlanForSessionRead | null;
  readonly definitions?: readonly StoredExamSessionDefinitionRow[];
  readonly sessions?: readonly StoredAdminExamSessionRow[];
  readonly counts?: readonly ExamSessionAssignmentCountRow[];
  readonly contextError?: unknown;
  readonly gateError?: unknown;
  readonly planError?: unknown;
  readonly definitionError?: unknown;
  readonly sessionError?: unknown;
  readonly countError?: unknown;
}

class RedirectShapedThrow extends Error {
  readonly digest = "NEXT_REDIRECT;replace;/login;307;";
}
class CourseNotFoundShapedThrow extends Error {
  readonly code = "COURSE_OFFERING_NOT_FOUND" as const;
}
class LifecycleDenialShapedThrow extends Error {
  readonly code = "COURSE_OPERATION_NOT_PERMITTED" as const;
}
class InfrastructureError extends Error {}

function deps(calls: Calls, over: Overrides = {}): ReadAdminExamSessionsDeps {
  return {
    requireCourseContext: async (requested) => {
      calls.order.push("authorize");
      calls.contextArgs.push(requested);
      if (over.contextError !== undefined) throw over.contextError;
      return { courseOfferingId: VERIFIED_OFFERING_ID, status: over.status ?? "ACTIVE" };
    },
    assertHistoricalReadAllowed: (status) => {
      calls.order.push("gate");
      calls.gateArgs.push(status);
      if (over.gateError !== undefined) throw over.gateError;
    },
    findExamPlanByCourseOfferingId: async (verified) => {
      calls.order.push("plan");
      calls.planArgs.push(verified);
      if (over.planError !== undefined) throw over.planError;
      if (over.plan !== undefined) return over.plan;
      return { id: SERVER_PLAN_ID, publishedAt: PLAN_PUBLISHED_AT };
    },
    findDefinitionsByPlanId: async (planId) => {
      calls.order.push("definitions");
      calls.definitionArgs.push(planId);
      if (over.definitionError !== undefined) throw over.definitionError;
      return over.definitions ?? DEFINITION_ROWS;
    },
    findSessionsByPlanId: async (planId) => {
      calls.order.push("sessions");
      calls.sessionArgs.push(planId);
      if (over.sessionError !== undefined) throw over.sessionError;
      return over.sessions ?? SESSION_ROWS;
    },
    countAssignmentsBySessionId: async (planId) => {
      calls.order.push("counts");
      calls.countArgs.push(planId);
      if (over.countError !== undefined) throw over.countError;
      return over.counts ?? COUNT_ROWS;
    },
  };
}

function read(over: Overrides = {}): Promise<AdminExamSessionsView> {
  return readAdminExamSessionsWithDeps(REQUESTED_OFFERING_ID, deps(makeCalls(), over));
}

function sessionById(
  view: AdminExamSessionsView,
  sessionId: string,
): AdminExamSessionsView["sessions"][number] {
  const found = view.sessions.find((entry) => entry.sessionId === sessionId);
  assert.ok(found, `${sessionId} is missing from the view`);
  return found;
}

// ===========================================================================
// R1–R6. The locked order, and authorization before every query
// ===========================================================================

test("R1. the order is authorize, gate, plan, definitions, sessions, counts", async () => {
  const calls = makeCalls();
  await readAdminExamSessionsWithDeps(REQUESTED_OFFERING_ID, deps(calls));
  assert.deepEqual(calls.order, [
    "authorize",
    "gate",
    "plan",
    "definitions",
    "sessions",
    "counts",
  ]);
  // Authorization is FIRST, and every query comes after it — the property that
  // matters is not "it is called" but "nothing is read before it".
  assert.equal(calls.order[0], "authorize");
  for (const query of ["plan", "definitions", "sessions", "counts"]) {
    assert.equal(calls.order.indexOf("authorize") < calls.order.indexOf(query), true);
    assert.equal(calls.order.indexOf("gate") < calls.order.indexOf(query), true);
  }
});

test("R2. only the AUTHORIZER sees the requested id; only the VERIFIED id scopes the plan", async () => {
  const calls = makeCalls();
  await readAdminExamSessionsWithDeps(REQUESTED_OFFERING_ID, deps(calls));
  assert.deepEqual(calls.contextArgs, [REQUESTED_OFFERING_ID]);
  assert.deepEqual(calls.planArgs, [VERIFIED_OFFERING_ID]);
  assert.equal(calls.planArgs.includes(REQUESTED_OFFERING_ID), false);
});

test("R3. the three plan-scoped reads are scoped by the SERVER plan id alone", async () => {
  const calls = makeCalls();
  await readAdminExamSessionsWithDeps(REQUESTED_OFFERING_ID, deps(calls));
  assert.deepEqual(calls.definitionArgs, [SERVER_PLAN_ID]);
  assert.deepEqual(calls.sessionArgs, [SERVER_PLAN_ID]);
  assert.deepEqual(calls.countArgs, [SERVER_PLAN_ID]);
  for (const args of [calls.definitionArgs, calls.sessionArgs, calls.countArgs]) {
    assert.equal(args.includes(REQUESTED_OFFERING_ID), false);
    assert.equal(args.includes(VERIFIED_OFFERING_ID), false);
  }
});

test("R4. the gate receives the VERIFIED status, and runs before the plan lookup", async () => {
  const calls = makeCalls();
  await readAdminExamSessionsWithDeps(REQUESTED_OFFERING_ID, deps(calls, { status: "ARCHIVED" }));
  assert.deepEqual(calls.gateArgs, ["ARCHIVED"]);
  assert.equal(calls.order.indexOf("gate") < calls.order.indexOf("plan"), true);
});

test("R5. an ARCHIVED offering is readable — the READ gate is not the write gate", async () => {
  const view = await read({ status: "ARCHIVED" });
  assert.equal(view.planExists, true);
  assert.equal(view.sessions.length, 3);
});

test("R6. no caller-supplied plan id is expressible: the entry point takes ONE argument", () => {
  assert.equal(readAdminExamSessionsWithDeps.length, 2);
  // The second argument is the dependency seam, not data. The ONLY caller-facing
  // value is the requested offering id — there is no parameter object to smuggle
  // a plan id, a session id or a filter through.
  const source = readFileSync(join(EXAM_DIR, MODULE_NAME), "utf8");
  const signature = source.match(
    /export async function readAdminExamSessionsWithDeps\(([\s\S]*?)\):/,
  );
  assert.ok(signature);
  assert.equal(signature[1].replace(/\s+/g, " ").trim(), "courseOfferingId: string, deps: ReadAdminExamSessionsDeps,");
});

// ===========================================================================
// R7–R10. The no-plan and empty states
// ===========================================================================

test("R7. no plan returns the plan-absent view and issues NO further query", async () => {
  const calls = makeCalls();
  const view = await readAdminExamSessionsWithDeps(
    REQUESTED_OFFERING_ID,
    deps(calls, { plan: null }),
  );
  assert.deepEqual(calls.order, ["authorize", "gate", "plan"]);
  assert.deepEqual(calls.definitionArgs, []);
  assert.deepEqual(calls.sessionArgs, []);
  assert.deepEqual(calls.countArgs, []);
  assert.deepEqual(view, {
    planExists: false,
    publishedAt: null,
    definitions: [],
    sessions: [],
  });
});

test("R8. the plan-absent view is exactly the exported empty view, and it is frozen", async () => {
  const view = await read({ plan: null });
  assert.deepEqual(view, emptyAdminExamSessionsView());
  assert.equal(Object.isFrozen(view), true);
  assert.equal(Object.isFrozen(view.definitions), true);
  assert.equal(Object.isFrozen(view.sessions), true);
  // The shared empty arrays cannot be grown by a caller.
  assert.throws(() => (view.sessions as unknown as unknown[]).push(1));
});

test("R9. a plan with NO session returns the empty view and skips the COUNT query", async () => {
  const calls = makeCalls();
  const view = await readAdminExamSessionsWithDeps(
    REQUESTED_OFFERING_ID,
    deps(calls, { sessions: [] }),
  );
  assert.deepEqual(calls.order, ["authorize", "gate", "plan", "definitions", "sessions"]);
  assert.deepEqual(calls.countArgs, [], "a count was issued for an empty schedule");
  assert.equal(view.planExists, true);
  assert.deepEqual(view.sessions, []);
  // The picker options are still delivered: an empty schedule is exactly when a
  // manager needs to know which exams they may schedule.
  assert.deepEqual(
    view.definitions.map((entry) => entry.definitionId),
    [DEF_RIDING, DEF_INTERFACE, DEF_ADVANCED],
  );
});

test("R10. a plan with neither definition nor session is still plan-present", async () => {
  const view = await read({ definitions: [], sessions: [] });
  assert.equal(view.planExists, true);
  assert.deepEqual(view.definitions, []);
  assert.deepEqual(view.sessions, []);
  // ...and is NOT the plan-absent view, which is a different sentence.
  assert.notDeepEqual(view, emptyAdminExamSessionsView());
});

// ===========================================================================
// R11–R13. Publication
// ===========================================================================

test("R11. publishedAt is carried as epoch milliseconds for a published plan", async () => {
  const view = await read();
  assert.equal(view.publishedAt, PLAN_PUBLISHED_AT);
  assert.equal(typeof view.publishedAt, "number");
});

test("R12. a DRAFT plan reports publishedAt as null", async () => {
  const view = await read({ plan: { id: SERVER_PLAN_ID, publishedAt: null } });
  assert.equal(view.publishedAt, null);
  assert.equal(view.planExists, true);
});

test("R13. an unusable publication stamp fails CLOSED — it reads as a draft", async () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0, 1.5]) {
    const view = await read({ plan: { id: SERVER_PLAN_ID, publishedAt: bad } });
    assert.equal(view.publishedAt, null, `${bad} was reported as published`);
  }
});

// ===========================================================================
// R14–R18. The locked total order
// ===========================================================================

test("R14. sessions are ordered by date, then position, then time, then id", async () => {
  const view = await read();
  assert.deepEqual(
    view.sessions.map((entry) => entry.sessionId),
    ["session-day-one-first", "session-day-one-second", "session-day-two-first"],
  );
});

test("R15. DATE outranks position and time", async () => {
  const view = await read({
    sessions: [
      sessionRow({ id: "later-day-earliest-everything", dateKey: DAY_TWO, orderIndex: 0, startTime: "06:00" }),
      sessionRow({ id: "earlier-day-latest-everything", dateKey: DAY_ONE, orderIndex: 99, startTime: "23:00" }),
    ],
  });
  assert.deepEqual(
    view.sessions.map((entry) => entry.sessionId),
    ["earlier-day-latest-everything", "later-day-earliest-everything"],
  );
});

test("R16. POSITION outranks the clock within one day", async () => {
  const view = await read({
    sessions: [
      sessionRow({ id: "position-two-early-clock", orderIndex: 2, startTime: "07:00" }),
      sessionRow({ id: "position-one-late-clock", orderIndex: 1, startTime: "22:00" }),
    ],
  });
  assert.deepEqual(
    view.sessions.map((entry) => entry.sessionId),
    ["position-one-late-clock", "position-two-early-clock"],
  );
});

test("R17. the CLOCK breaks an equal position, and the ID breaks an equal clock", async () => {
  const view = await read({
    sessions: [
      sessionRow({ id: "session-zulu", orderIndex: 0, startTime: "10:00" }),
      sessionRow({ id: "session-alpha", orderIndex: 0, startTime: "10:00" }),
      sessionRow({ id: "session-mid", orderIndex: 0, startTime: "08:30" }),
    ],
  });
  assert.deepEqual(
    view.sessions.map((entry) => entry.sessionId),
    ["session-mid", "session-alpha", "session-zulu"],
  );
});

test("R18. the order is STABLE across repeated reads of a shuffled input", async () => {
  const shuffled = [...SESSION_ROWS].reverse();
  const first = await read({ sessions: shuffled });
  const second = await read({ sessions: [...SESSION_ROWS] });
  assert.deepEqual(
    first.sessions.map((entry) => entry.sessionId),
    second.sessions.map((entry) => entry.sessionId),
  );
});

test("R19. definitions are ordered by position, then id", async () => {
  const view = await read();
  assert.deepEqual(
    view.definitions.map((entry) => entry.definitionId),
    [DEF_RIDING, DEF_INTERFACE, DEF_ADVANCED],
  );
  const tied = await read({
    definitions: [
      definitionRow({ id: "definition-zulu", orderIndex: 0 }),
      definitionRow({ id: "definition-alpha", orderIndex: 0 }),
    ],
    sessions: [],
  });
  assert.deepEqual(
    tied.definitions.map((entry) => entry.definitionId),
    ["definition-alpha", "definition-zulu"],
  );
});

// ===========================================================================
// R20–R24. The batched assignment count — and the absence of an N+1
// ===========================================================================

test("R20. counts are attributed to the right session, and a missing group is ZERO", async () => {
  const view = await read();
  assert.equal(sessionById(view, "session-day-one-first").assignmentCount, 2);
  assert.equal(sessionById(view, "session-day-one-second").assignmentCount, 4);
  // No group named the third session, which means nobody is on it.
  assert.equal(sessionById(view, "session-day-two-first").assignmentCount, 0);
});

test("R21. a group naming a session OUTSIDE the read's own set is never attributed", async () => {
  const view = await read({
    counts: [
      countRow("session-of-another-plan-entirely", 99),
      countRow("session-day-one-first", 2),
    ],
  });
  for (const entry of view.sessions) {
    assert.notEqual(entry.assignmentCount, 99);
  }
  assert.equal(sessionById(view, "session-day-one-first").assignmentCount, 2);
  assert.equal(
    view.sessions.some((entry) => entry.sessionId === "session-of-another-plan-entirely"),
    false,
    "a foreign group created a schedule line",
  );
});

test("R22. an unusable count is 0, never negative and never NaN", async () => {
  for (const bad of [-5, Number.NaN, Number.POSITIVE_INFINITY, 2.5]) {
    const view = await read({ counts: [countRow("session-day-one-first", bad)] });
    assert.equal(sessionById(view, "session-day-one-first").assignmentCount, 0, `${bad} leaked`);
  }
});

test("R23. blank ids in the count and definition lists are discarded, not indexed", async () => {
  const view = await read({ counts: [countRow("", 7), countRow("session-day-one-first", 3)] });
  assert.equal(sessionById(view, "session-day-one-first").assignmentCount, 3);
  for (const entry of view.sessions) {
    assert.notEqual(entry.assignmentCount, 7);
  }
});

test("R24. NO per-session or per-definition query at ANY size — exactly six calls", async () => {
  for (const size of [1, 3, 60]) {
    const sessions = Array.from({ length: size }, (_, index) =>
      sessionRow({ id: `session-number-${index}`, orderIndex: index }),
    );
    const calls = makeCalls();
    const view = await readAdminExamSessionsWithDeps(
      REQUESTED_OFFERING_ID,
      deps(calls, { sessions }),
    );
    assert.equal(view.sessions.length, size);
    // Six dependency calls, regardless of how many sessions exist. If a per-row
    // fetch were ever introduced, this count would grow with `size`.
    assert.equal(calls.order.length, 6, `${size} sessions issued ${calls.order.length} calls`);
    assert.equal(calls.sessionArgs.length, 1);
    assert.equal(calls.definitionArgs.length, 1);
    assert.equal(calls.countArgs.length, 1);
  }
});

test("R25. the boundary makes a per-row fetch UNREPRESENTABLE", () => {
  // Neither batched dependency accepts a single id: they take a plan id and
  // return a whole list. The N+1 is forbidden by the SHAPE of the seam, not by a
  // rule someone must remember.
  const calls = makeCalls();
  const boundary = deps(calls);
  assert.equal(boundary.findDefinitionsByPlanId.length, 1);
  assert.equal(boundary.findSessionsByPlanId.length, 1);
  assert.equal(boundary.countAssignmentsBySessionId.length, 1);
  assert.deepEqual(Object.keys(boundary).sort(), [
    "assertHistoricalReadAllowed",
    "countAssignmentsBySessionId",
    "findDefinitionsByPlanId",
    "findExamPlanByCourseOfferingId",
    "findSessionsByPlanId",
    "requireCourseContext",
  ]);
});

// ===========================================================================
// R26–R29. The MISSING-DEFINITION invariant
// ===========================================================================

test("R26. a session whose definition cannot be resolved is OMITTED, not fabricated", async () => {
  const view = await read({
    sessions: [
      sessionRow({ id: "session-resolvable", definitionId: DEF_RIDING }),
      sessionRow({ id: "session-orphaned", definitionId: DEF_VANISHED, orderIndex: 1 }),
    ],
  });
  assert.deepEqual(
    view.sessions.map((entry) => entry.sessionId),
    ["session-resolvable"],
  );
  // No invented, blank or placeholder identity anywhere in the view.
  for (const entry of view.sessions) {
    assert.notEqual(entry.definitionName, "");
    assert.notEqual(entry.definitionKind, "");
    assert.notEqual(entry.definitionId, DEF_VANISHED);
  }
  const serialized = JSON.stringify(view);
  assert.equal(serialized.includes(DEF_VANISHED), false, "the orphaned id leaked");
  assert.equal(serialized.includes("session-orphaned"), false, "the orphaned row leaked");
});

test("R27. one orphaned row does not make the whole schedule unreadable", async () => {
  const view = await read({
    sessions: [
      sessionRow({ id: "session-orphaned", definitionId: DEF_VANISHED }),
      ...SESSION_ROWS,
    ],
  });
  // Nothing threw, and every resolvable row survived.
  assert.equal(view.sessions.length, 3);
  assert.equal(view.planExists, true);
});

test("R28. a row with no usable date, time or id is omitted for the same reason", async () => {
  const view = await read({
    sessions: [
      sessionRow({ id: "session-good" }),
      sessionRow({ id: "session-no-date", dateKey: "" }),
      sessionRow({ id: "session-no-time", startTime: "" }),
      sessionRow({ id: "" }),
    ],
  });
  assert.deepEqual(
    view.sessions.map((entry) => entry.sessionId),
    ["session-good"],
  );
});

test("R29. if EVERY row is unresolvable, the result is the empty schedule and NO count", async () => {
  const calls = makeCalls();
  const view = await readAdminExamSessionsWithDeps(
    REQUESTED_OFFERING_ID,
    deps(calls, { sessions: [sessionRow({ id: "session-orphaned", definitionId: DEF_VANISHED })] }),
  );
  assert.deepEqual(view.sessions, []);
  assert.deepEqual(calls.countArgs, [], "a count was issued for a fully-unresolvable schedule");
  assert.equal(view.planExists, true);
});

// ===========================================================================
// R30–R36. The result model
// ===========================================================================

test("R30. a session view carries EXACTLY the twelve approved fields", async () => {
  const view = await read();
  const entry = sessionById(view, "session-day-one-second");
  assert.deepEqual(Object.keys(entry).sort(), [
    "arena",
    "assignmentCount",
    "dateKey",
    "definitionId",
    "definitionKind",
    "definitionName",
    "notes",
    "orderIndex",
    "sessionId",
    "startTime",
    "title",
    "updatedAt",
  ]);
  assert.deepEqual({ ...entry }, {
    sessionId: "session-day-one-second",
    definitionId: DEF_INTERFACE,
    definitionName: "ממשק",
    definitionKind: "INTERFACE_RIDING",
    dateKey: DAY_ONE,
    startTime: "11:00",
    arena: "זירה א",
    title: "מחזור ראשון",
    notes: null,
    orderIndex: 1,
    updatedAt: SESSION_UPDATED_AT,
    assignmentCount: 4,
  });
});

test("R31. a definition option carries EXACTLY the five approved fields", async () => {
  const view = await read();
  const [first] = view.definitions;
  assert.deepEqual(Object.keys(first).sort(), [
    "definitionId",
    "durationMinutes",
    "kind",
    "name",
    "parallelCapacity",
  ]);
  assert.deepEqual({ ...first }, {
    definitionId: DEF_RIDING,
    name: "רכיבה",
    kind: "INTERFACE_RIDING",
    durationMinutes: 15,
    parallelCapacity: 1,
  });
  // The picker exposes no position, no version stamp and no `requires*` flag.
  for (const forbidden of ["orderIndex", "updatedAt", "requiresInstructedTrainee", "sessionCount"]) {
    assert.equal(forbidden in first, false, `the option carries ${forbidden}`);
  }
});

test("R32. the view carries no plan id, no course offering id and no forbidden field", async () => {
  const view = await read();
  const serialized = JSON.stringify(view);
  for (const forbidden of [SERVER_PLAN_ID, VERIFIED_OFFERING_ID, REQUESTED_OFFERING_ID]) {
    assert.equal(serialized.includes(forbidden), false, `${forbidden} leaked into the view`);
  }
  const topLevel = Object.keys(view).sort();
  assert.deepEqual(topLevel, ["definitions", "planExists", "publishedAt", "sessions"]);
  for (const entry of view.sessions) {
    for (const forbidden of [
      "planId",
      "courseOfferingId",
      "phase",
      "interfaceSessionId",
      "individualPublishedAt",
      "sourceTeachingPracticeLessonId",
      "copiedAt",
      "endTime",
      "capacity",
      "beginnerFormat",
      "roleLabelOverrides",
      "createdAt",
      "assignments",
      "supervisors",
      "breaks",
      "definition",
      "plan",
      "studentId",
      "instructorId",
      "id",
    ]) {
      assert.equal(forbidden in entry, false, `a session carries ${forbidden}`);
    }
  }
});

test("R33. the tie-break id is published ONLY as sessionId", async () => {
  const view = await read();
  for (const entry of view.sessions) {
    // `id` is absent as a field name — the value is reachable only under the
    // unambiguous `sessionId`.
    assert.equal("id" in entry, false);
    assert.equal(typeof entry.sessionId, "string");
  }
});

test("R34. the whole result is FROZEN, top to bottom", async () => {
  const view = await read();
  assert.equal(Object.isFrozen(view), true);
  assert.equal(Object.isFrozen(view.sessions), true);
  assert.equal(Object.isFrozen(view.definitions), true);
  for (const entry of view.sessions) assert.equal(Object.isFrozen(entry), true);
  for (const entry of view.definitions) assert.equal(Object.isFrozen(entry), true);
  assert.throws(() => (view.sessions as unknown as unknown[]).push(1));
});

test("R35. the result is plain JSON: no Date, Map, Set, BigInt, class or undefined", async () => {
  const view = await read();
  assert.deepEqual(findNonPlainJsonPaths(view), []);
  assert.deepEqual(JSON.parse(JSON.stringify(view)), view);
  // No property is `undefined` — an absent optional reads as `null`.
  for (const entry of view.sessions) {
    for (const [key, value] of Object.entries(entry)) {
      assert.notEqual(value, undefined, `${key} is undefined`);
    }
  }
});

test("R36. optional text is carried VERBATIM, with absence as null", async () => {
  const view = await read({
    sessions: [
      sessionRow({ id: "session-text", arena: "  זירה עם רווחים  ", title: "", notes: null }),
    ],
  });
  const entry = sessionById(view, "session-text");
  assert.equal(entry.arena, "  זירה עם רווחים  ", "the arena was trimmed or normalized");
  assert.equal(entry.title, "", "an empty title was substituted");
  assert.equal(entry.notes, null);
});

test("R37. an unusable version stamp becomes 0, and never a Date", async () => {
  for (const bad of [Number.NaN, -1, 1.5, Number.POSITIVE_INFINITY]) {
    const view = await read({ sessions: [sessionRow({ id: "session-stamp", updatedAt: bad })] });
    assert.equal(sessionById(view, "session-stamp").updatedAt, 0, `${bad} leaked`);
  }
});

test("R38. the input rows are never mutated, and no stored row object is republished", async () => {
  const view = await read();
  assert.equal(
    JSON.stringify({ definitions: DEFINITION_ROWS, sessions: SESSION_ROWS, counts: COUNT_ROWS }),
    FIXTURE_SNAPSHOT,
    "the core mutated its input",
  );
  // Every published object is a FRESH one — no stored row is handed through.
  for (const entry of view.sessions) {
    assert.equal(
      SESSION_ROWS.some((row) => (row as unknown) === (entry as unknown)),
      false,
      "a stored row object was republished",
    );
  }
  for (const entry of view.definitions) {
    assert.equal(
      DEFINITION_ROWS.some((row) => (row as unknown) === (entry as unknown)),
      false,
      "a stored definition object was republished",
    );
  }
});

test("R39. two definitions sharing a kind stay two distinct options and two distinct lines", async () => {
  const view = await read();
  const kinds = view.definitions.map((entry) => entry.kind);
  assert.equal(kinds.filter((kind) => kind === "INTERFACE_RIDING").length, 2);
  assert.equal(view.definitions.length, 3, "two exams of one kind collapsed");
  assert.equal(
    new Set(view.sessions.map((entry) => entry.definitionId)).size,
    3,
    "sessions were grouped by kind rather than by definition",
  );
});

// ===========================================================================
// R40–R44. Nothing is classified
// ===========================================================================

test("R40. an authorization redirect propagates unchanged, before any query", async () => {
  const calls = makeCalls();
  const thrown = new RedirectShapedThrow("redirect");
  await assert.rejects(
    () => readAdminExamSessionsWithDeps(REQUESTED_OFFERING_ID, deps(calls, { contextError: thrown })),
    (error) => error === thrown,
  );
  assert.deepEqual(calls.order, ["authorize"], "a query ran after a redirect");
});

test("R41. the typed offering not-found propagates unchanged, before any query", async () => {
  const calls = makeCalls();
  const thrown = new CourseNotFoundShapedThrow("missing");
  await assert.rejects(
    () => readAdminExamSessionsWithDeps(REQUESTED_OFFERING_ID, deps(calls, { contextError: thrown })),
    (error) => error === thrown,
  );
  assert.deepEqual(calls.order, ["authorize"]);
});

test("R42. a lifecycle denial propagates unchanged, and no query runs", async () => {
  const calls = makeCalls();
  const thrown = new LifecycleDenialShapedThrow("denied");
  await assert.rejects(
    () => readAdminExamSessionsWithDeps(REQUESTED_OFFERING_ID, deps(calls, { gateError: thrown })),
    (error) => error === thrown,
  );
  assert.deepEqual(calls.order, ["authorize", "gate"], "a query ran after a denial");
});

test("R43. a denial is NEVER turned into an empty schedule", async () => {
  // The distinction this asserts: "you may not see this" must not become "there
  // is nothing here", which is what a swallowed denial would look like.
  await assert.rejects(
    () => read({ gateError: new LifecycleDenialShapedThrow("denied") }),
    LifecycleDenialShapedThrow,
  );
});

test("R44. an infrastructure failure at ANY query propagates unchanged", async () => {
  for (const key of ["planError", "definitionError", "sessionError", "countError"] as const) {
    const thrown = new InfrastructureError("connection lost");
    await assert.rejects(
      () => read({ [key]: thrown }),
      (error) => error === thrown,
      `${key} was swallowed`,
    );
  }
});

// ===========================================================================
// S1–S10. Structural guards on the module's own source
// ===========================================================================

const EXAM_DIR = import.meta.dirname;
const MODULE_NAME = "admin-exam-session-read-core.ts";
const TEST_NAME = "admin-exam-session-read-core.test.ts";

const SOURCE = readFileSync(join(EXAM_DIR, MODULE_NAME), "utf8");

/** Strip comments so the guards assert on CODE, not on explanatory prose. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Keep ONLY the comments, for the "is this documented?" assertions. */
function commentsOf(source: string): string {
  return [
    ...(source.match(/\/\*[\s\S]*?\*\//g) ?? []),
    ...(source.match(/^\s*\/\/.*$/gm) ?? []),
  ].join("\n");
}

const CODE = stripComments(SOURCE);
const COMMENTS = commentsOf(SOURCE);

// Split specifiers: this suite necessarily names some of what it forbids, and
// the committed exam-slice guards scan sibling directories for exact tokens.
const PRISMA_MODULE = ["@/lib", "prisma"].join("/");
const GENERATED_CLIENT = ["@prisma", "client"].join("/");
const ENV_READ = ["process", "env"].join(".");

test("S1. the pure core imports NOTHING at all", () => {
  assert.deepEqual(CODE.match(/^import\s/gm) ?? [], []);
  assert.deepEqual(CODE.match(/\brequire\(/g) ?? [], []);
});

test("S2. the core reaches no IO, no auth, no client and no environment", () => {
  for (const token of [
    "server" + "-only",
    "use " + "server",
    "use " + "client",
    PRISMA_MODULE,
    GENERATED_CLIENT,
    ENV_READ,
    "DATABASE" + "_URL",
    "Prisma" + "Client",
    "supa" + "base",
    "lib/auth",
    "lib/course",
    "next/",
    "cookies(",
    "headers(",
    "fetch(",
    "redirect(",
    "notFound(",
    "revalidatePath",
  ]) {
    assert.equal(CODE.includes(token), false, `the pure core references ${token}`);
  }
});

test("S3. the core constructs no Date, reads no clock and uses no randomness", () => {
  for (const token of ["new Date(", "Date.now(", "Date.parse(", "Math.random(", "toISOString", "getTimezoneOffset"]) {
    assert.equal(CODE.includes(token), false, `the pure core uses ${token}`);
  }
  // ...and the rule is stated, so the absence reads as a decision.
  assert.ok(/epoch millisecond/i.test(COMMENTS), "the epoch-ms convention is undocumented");
  assert.ok(/YYYY-MM-DD/.test(COMMENTS), "the date-key convention is undocumented");
});

test("S4. the core contains no write method, no transaction and no raw SQL", () => {
  for (const token of [
    "create(",
    "createMany",
    "update(",
    "updateMany",
    "upsert",
    "delete(",
    "deleteMany",
    "$transaction",
    "$executeRaw",
    "$queryRaw",
    "$executeRawUnsafe",
    "$queryRawUnsafe",
    "isolationLevel",
    "publishPlan",
    "unpublish",
    "setPublished",
  ]) {
    assert.equal(CODE.includes(token), false, `the pure core references ${token}`);
  }
  // `publishedAt` IS named — as something READ. It is never assigned, and the
  // substring is not evidence of a publication write, so it is asserted
  // precisely rather than banned as a token.
  assert.ok(/publishedAt/.test(CODE), "sanity: publishedAt should be read here");
  // No PROPERTY assignment: the local `const publishedAt = ...` binding that
  // normalizes the stamp is a read, so only `something.publishedAt = ...` — the
  // shape an actual publication write would take — is forbidden.
  assert.equal(/\.publishedAt\s*=[^=]/.test(CODE), false, "publishedAt is assigned");
});

test("S5. the core consults NO capability and no other actor role", () => {
  for (const token of [
    "Capability",
    "capability",
    "getEffectiveCapabilities",
    "requireCurrentInstructor",
    "requireCurrentTrainee",
    "getCurrentInstructor",
    "getCurrentTrainee",
    "requireAdmin",
    "Teaching" + "Practice",
    "teaching-" + "practice",
  ]) {
    assert.equal(CODE.includes(token), false, `the pure core references ${token}`);
  }
});

test("S6. the core names no assignment, trainee, instructor or supervisor field", () => {
  for (const pattern of [
    /\bstudentI?d?\s*\??\s*:/i,
    /\btraineeI?d?\s*\??\s*:/i,
    /\binstructorI?d?\s*\??\s*:/i,
    /\bsupervisors?\s*\??\s*:/i,
    /\bassignments\s*\??\s*:/i,
    /\bhorseName\s*\??\s*:/i,
    /\bdiscipline\s*\??\s*:/i,
    /\bbreaks\s*\??\s*:/i,
  ]) {
    assert.equal(pattern.test(CODE), false, `the core declares a field matching ${pattern}`);
  }
  // The count IS modelled — as a number, and only as a number.
  assert.ok(/assignmentCount:\s*number/.test(CODE));
});

test("S7. the core models no deprecated or out-of-scope session column", () => {
  for (const token of [
    "phase",
    "Phase",
    "interfaceSessionId",
    "individualPublishedAt",
    "sourceTeachingPracticeLessonId",
    "copiedAt",
    "beginnerFormat",
    "roleLabelOverrides",
    "endTime",
    "capacity",
  ]) {
    assert.equal(CODE.includes(token), false, `the core models ${token}`);
  }
  // ...and explains why they are absent rather than merely omitting them.
  assert.ok(/deprecated/i.test(COMMENTS), "the deprecated columns are not discussed");
});

test("S8. the core contains no try, no catch and no error classifier", () => {
  for (const token of ["try {", "catch (", "instanceof", "isCourseNotFoundError", "P2002", "P2003"]) {
    assert.equal(CODE.includes(token), false, `the core classifies via ${token}`);
  }
  assert.ok(/propagate/i.test(COMMENTS), "the propagation rule is undocumented");
});

test("S9. the core exports exactly the read orchestration and the empty view", () => {
  const exported = [...SOURCE.matchAll(/export (?:async )?function (\w+)\(/g)].map(([, name]) => name);
  assert.deepEqual(exported, [
    "emptyAdminExamSessionsView",
    "readAdminExamSessionsWithDeps",
  ]);
  assert.equal(CODE.includes("export const"), false, "the core exports a value");
  assert.equal(CODE.includes("export default"), false);
  // Every result object is frozen at the point of construction.
  assert.equal((CODE.match(/Object\.freeze\(/g) ?? []).length >= 6, true);
  // The missing-definition invariant is DOCUMENTED, not merely implemented.
  assert.ok(/INVARIANT/i.test(COMMENTS), "the invariant is undocumented");
  assert.ok(/composite foreign key/i.test(COMMENTS), "the FK reasoning is undocumented");
  assert.ok(/FAILED CLOSED|fail closed/i.test(COMMENTS), "the fail-closed rule is undocumented");
});

test("S10. the slice's two lib/exam files are exactly the approved pair", () => {
  const sliceFiles = readdirSync(EXAM_DIR)
    .filter((name) => name.startsWith("admin-exam-session-read-core"))
    .sort();
  assert.deepEqual(sliceFiles, [MODULE_NAME, TEST_NAME].sort());
});

test("S11. this suite opens no database and reads no environment", () => {
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
  // Anchored to real IMPORT LINES, so a regex literal that happens to spell
  // `from "…"` inside an assertion is not mistaken for an import.
  const specifiers = [...own.matchAll(/^import[^"]*from\s+"([^"]+)";$/gm)].map((match) => match[1]);
  assert.deepEqual(
    [...new Set(specifiers)].sort(),
    ["./admin-exam-session-read-core", "./exam-read-dto", "node:assert/strict", "node:fs", "node:path", "node:test"],
  );
});
