/**
 * EXAM EX-S5B-5A — the PURE admin ExamDefinition LIST read, proven DB-free.
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
 *     scope a query;
 *   - the plan-absent view, and that it costs no further query;
 *   - the published and draft representations;
 *   - the deterministic total order, including the `orderIndex` tie-break;
 *   - the batched count join: correct attribution, zero for a missing group,
 *     and no per-definition query for 1, 5 or 40 definitions;
 *   - that an empty plan skips the count query;
 *   - that names are carried VERBATIM, duplicates included;
 *   - the result model: narrow, plain, frozen, JSON-round-trippable, and free of
 *     any `Date`, plan id, actor, session, student or instructor;
 *   - that NOTHING is classified: a denial, a redirect and an infrastructure
 *     failure all propagate unchanged;
 *   - the structural promises: no IO, no auth, no capability, no write method,
 *     no read-pipeline entry point and no Teaching-Practice reference.
 *
 * NOTE ON IDS: the fixtures use obviously-fake, hyphenated ids. No cuid-shaped
 * literal and no production identifier is written here, which the committed
 * exam-slice guards enforce over every file in this directory.
 *
 * Run with: npx tsx --test lib/exam/exam-definition-admin-read-core.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { findNonPlainJsonPaths } from "./exam-read-dto";
import {
  emptyAdminExamDefinitionListView,
  readExamDefinitionsForAdminWithDeps,
  type AdminExamDefinitionListView,
  type ExamDefinitionSessionCountRow,
  type ReadExamDefinitionsForAdminDeps,
  type ResolvedExamPlanForAdminRead,
  type StoredAdminExamDefinitionRow,
} from "./exam-definition-admin-read-core";

// ===========================================================================
// Fixtures
// ===========================================================================

/** What the caller ASKS for. Deliberately different from what is verified. */
const REQUESTED_OFFERING_ID = "offering-as-requested";
/** What the boundary VERIFIED. Only this may reach the plan lookup. */
const VERIFIED_OFFERING_ID = "offering-as-verified";
/** The plan the SERVER resolved. Only this may reach the definition read. */
const SERVER_PLAN_ID = "plan-resolved-by-server";
/** A plan this read never asked about. Its rows must never be attributed here. */
const FOREIGN_PLAN_ID = "plan-of-another-course";

const PLAN_PUBLISHED_AT = 1_754_000_000_000;
const DEFINITION_UPDATED_AT = 1_753_000_000_111;

const DEF_ALPHA = "definition-alpha";
const DEF_BETA = "definition-beta";
const DEF_GAMMA = "definition-gamma";

function definitionRow(
  over: Partial<StoredAdminExamDefinitionRow> & { readonly id: string },
): StoredAdminExamDefinitionRow {
  return Object.freeze({
    id: over.id,
    name: over.name ?? `שם ${over.id}`,
    kind: over.kind ?? "INTERFACE_RIDING",
    durationMinutes: over.durationMinutes ?? 15,
    parallelCapacity: over.parallelCapacity ?? 1,
    requiresInstructedTrainee: over.requiresInstructedTrainee ?? false,
    requiresLessonTopic: over.requiresLessonTopic ?? false,
    requiresDiscipline: over.requiresDiscipline ?? false,
    orderIndex: over.orderIndex ?? 0,
    updatedAt: over.updatedAt ?? DEFINITION_UPDATED_AT,
  });
}

/**
 * THREE definitions, deliberately supplied OUT of order, with two of them
 * sharing one `ExamKind` — two exams of the same kind must never collapse.
 */
const DEFINITION_ROWS: readonly StoredAdminExamDefinitionRow[] = Object.freeze([
  definitionRow({ id: DEF_GAMMA, name: "הדרכה מתקדמת", kind: "ADVANCED_INSTRUCTION", orderIndex: 2, durationMinutes: 30, requiresInstructedTrainee: true, requiresLessonTopic: true, requiresDiscipline: true }),
  definitionRow({ id: DEF_ALPHA, name: "רכיבה", orderIndex: 0 }),
  definitionRow({ id: DEF_BETA, name: "ממשק", orderIndex: 1, parallelCapacity: 2, durationMinutes: 20 }),
]);

function countRow(
  definitionId: string,
  sessionCount: number,
  planId: string = SERVER_PLAN_ID,
): ExamDefinitionSessionCountRow {
  return Object.freeze({ planId, definitionId, sessionCount });
}

const COUNT_ROWS: readonly ExamDefinitionSessionCountRow[] = Object.freeze([
  countRow(DEF_BETA, 4),
  countRow(DEF_ALPHA, 2),
]);

/** The fixture, serialized ONCE, so mutation by the core is detectable. */
const FIXTURE_SNAPSHOT = JSON.stringify({
  definitions: DEFINITION_ROWS,
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
  readonly countArgs: string[];
}

function makeCalls(): Calls {
  return {
    order: [],
    contextArgs: [],
    gateArgs: [],
    planArgs: [],
    definitionArgs: [],
    countArgs: [],
  };
}

interface Overrides {
  readonly status?: string;
  readonly plan?: ResolvedExamPlanForAdminRead | null;
  readonly definitions?: readonly StoredAdminExamDefinitionRow[];
  readonly counts?: readonly ExamDefinitionSessionCountRow[];
  readonly contextError?: unknown;
  readonly gateError?: unknown;
  readonly planError?: unknown;
  readonly definitionError?: unknown;
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

function deps(calls: Calls, over: Overrides = {}): ReadExamDefinitionsForAdminDeps {
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
    countSessionsByDefinition: async (planId) => {
      calls.order.push("counts");
      calls.countArgs.push(planId);
      if (over.countError !== undefined) throw over.countError;
      return over.counts ?? COUNT_ROWS;
    },
  };
}

function read(over: Overrides = {}): Promise<AdminExamDefinitionListView> {
  return readExamDefinitionsForAdminWithDeps(REQUESTED_OFFERING_ID, deps(makeCalls(), over));
}

function definitionById(
  view: AdminExamDefinitionListView,
  id: string,
): AdminExamDefinitionListView["definitions"][number] {
  const found = view.definitions.find((entry) => entry.id === id);
  assert.ok(found, `${id} is missing from the view`);
  return found;
}

// ===========================================================================
// R1–R6. The locked order, and authorization before every query
// ===========================================================================

test("R1. the order is authorize, gate, plan, definitions, counts", async () => {
  const calls = makeCalls();
  await readExamDefinitionsForAdminWithDeps(REQUESTED_OFFERING_ID, deps(calls));
  assert.deepEqual(calls.order, ["authorize", "gate", "plan", "definitions", "counts"]);
  // Authorization is FIRST, and every query comes after it — the property that
  // matters is not "it is called" but "nothing is read before it".
  assert.equal(calls.order[0], "authorize");
  assert.equal(calls.order.indexOf("authorize") < calls.order.indexOf("plan"), true);
  assert.equal(calls.order.indexOf("gate") < calls.order.indexOf("plan"), true);
});

test("R2. only the AUTHORIZER sees the requested id; only the VERIFIED id scopes the plan", async () => {
  const calls = makeCalls();
  await readExamDefinitionsForAdminWithDeps(REQUESTED_OFFERING_ID, deps(calls));
  assert.deepEqual(calls.contextArgs, [REQUESTED_OFFERING_ID]);
  assert.deepEqual(calls.planArgs, [VERIFIED_OFFERING_ID]);
  assert.equal(calls.planArgs.includes(REQUESTED_OFFERING_ID), false);
});

test("R3. the definition read and the count are scoped by the SERVER plan id alone", async () => {
  const calls = makeCalls();
  await readExamDefinitionsForAdminWithDeps(REQUESTED_OFFERING_ID, deps(calls));
  assert.deepEqual(calls.definitionArgs, [SERVER_PLAN_ID]);
  assert.deepEqual(calls.countArgs, [SERVER_PLAN_ID]);
  for (const args of [calls.definitionArgs, calls.countArgs]) {
    assert.equal(args.includes(REQUESTED_OFFERING_ID), false);
    assert.equal(args.includes(VERIFIED_OFFERING_ID), false);
  }
});

test("R4. the lifecycle gate receives the VERIFIED status, once", async () => {
  const calls = makeCalls();
  await readExamDefinitionsForAdminWithDeps(REQUESTED_OFFERING_ID, deps(calls, { status: "ARCHIVED" }));
  assert.deepEqual(calls.gateArgs, ["ARCHIVED"]);
});

test("R5. an authorization failure or redirect propagates and issues NO query", async () => {
  for (const error of [
    new RedirectShapedThrow(),
    new CourseNotFoundShapedThrow(),
    new InfrastructureError(),
  ]) {
    const calls = makeCalls();
    await assert.rejects(
      () => readExamDefinitionsForAdminWithDeps(REQUESTED_OFFERING_ID, deps(calls, { contextError: error })),
      (thrown) => thrown === error,
    );
    // Not even the lifecycle gate ran, let alone a query.
    assert.deepEqual(calls.order, ["authorize"]);
  }
});

test("R6. a lifecycle denial propagates and issues NO query", async () => {
  const error = new LifecycleDenialShapedThrow();
  const calls = makeCalls();
  await assert.rejects(
    () => readExamDefinitionsForAdminWithDeps(REQUESTED_OFFERING_ID, deps(calls, { gateError: error })),
    (thrown) => thrown === error,
  );
  assert.deepEqual(calls.order, ["authorize", "gate"]);
  assert.deepEqual(calls.planArgs, []);
});

// ===========================================================================
// R7–R10. The plan-absent view, and publication
// ===========================================================================

test("R7. no plan returns exactly the plan-absent view", async () => {
  const view = await read({ plan: null });
  assert.deepEqual(view, { planExists: false, publishedAt: null, definitions: [] });
  assert.deepEqual(view, emptyAdminExamDefinitionListView());
  assert.deepEqual(Object.keys(view), ["planExists", "publishedAt", "definitions"]);
});

test("R8. no plan reads NO definition and NO count", async () => {
  const calls = makeCalls();
  await readExamDefinitionsForAdminWithDeps(REQUESTED_OFFERING_ID, deps(calls, { plan: null }));
  assert.deepEqual(calls.order, ["authorize", "gate", "plan"]);
  assert.deepEqual(calls.definitionArgs, []);
  assert.deepEqual(calls.countArgs, []);
});

test("R9. a PUBLISHED plan reports its instant as epoch milliseconds", async () => {
  const view = await read();
  assert.equal(view.planExists, true);
  assert.equal(view.publishedAt, PLAN_PUBLISHED_AT);
  assert.equal(typeof view.publishedAt, "number");
  // Carried VERBATIM: no rounding, no re-derivation, no `Date` in sight.
  assert.equal(Object.prototype.toString.call(view.publishedAt), "[object Number]");
});

test("R10. a DRAFT plan reports null, and still lists its definitions", async () => {
  const view = await read({ plan: { id: SERVER_PLAN_ID, publishedAt: null } });
  assert.equal(view.planExists, true);
  assert.equal(view.publishedAt, null);
  assert.equal(view.definitions.length, DEFINITION_ROWS.length);
  // An UNUSABLE stamp fails closed to "draft" rather than claiming publication.
  for (const broken of [Number.NaN, 0, -1, 1.5, Number.POSITIVE_INFINITY]) {
    const reported = await read({ plan: { id: SERVER_PLAN_ID, publishedAt: broken } });
    assert.equal(reported.publishedAt, null, `${broken} was reported as published`);
  }
});

// ===========================================================================
// R11–R14. Deterministic ordering
// ===========================================================================

test("R11. definitions are ordered by orderIndex, then by id", async () => {
  const view = await read();
  assert.deepEqual(
    view.definitions.map((entry) => entry.id),
    [DEF_ALPHA, DEF_BETA, DEF_GAMMA],
  );
  assert.deepEqual(
    view.definitions.map((entry) => entry.orderIndex),
    [0, 1, 2],
  );
});

test("R12. EQUAL order positions tie-break by id, not by arrival", async () => {
  // The committed create binding documents that concurrent appends may share a
  // position, so this is a real state, not a hypothetical one.
  const shared = Object.freeze([
    definitionRow({ id: "definition-zulu", orderIndex: 3 }),
    definitionRow({ id: "definition-alpha-tie", orderIndex: 3 }),
    definitionRow({ id: "definition-mike", orderIndex: 3 }),
  ]);
  const view = await read({ definitions: shared, counts: [] });
  assert.deepEqual(
    view.definitions.map((entry) => entry.id),
    ["definition-alpha-tie", "definition-mike", "definition-zulu"],
  );
});

test("R13. the order is stable across repeated reads and independent of input order", async () => {
  const forward = await read();
  const reversed = await read({ definitions: Object.freeze([...DEFINITION_ROWS].reverse()) });
  assert.deepEqual(
    forward.definitions.map((entry) => entry.id),
    reversed.definitions.map((entry) => entry.id),
  );
  const again = await read();
  assert.deepEqual(again, forward);
});

test("R14. the core never mutates the rows it was given", async () => {
  await read();
  await read({ definitions: DEFINITION_ROWS, counts: COUNT_ROWS });
  assert.equal(
    JSON.stringify({ definitions: DEFINITION_ROWS, counts: COUNT_ROWS }),
    FIXTURE_SNAPSHOT,
    "the read mutated its input rows",
  );
});

// ===========================================================================
// R15–R20. The batched count join
// ===========================================================================

test("R15. each definition receives ITS OWN grouped count", async () => {
  const view = await read();
  assert.equal(definitionById(view, DEF_ALPHA).sessionCount, 2);
  assert.equal(definitionById(view, DEF_BETA).sessionCount, 4);
});

test("R16. a definition with NO grouped row is reported as zero", async () => {
  const view = await read();
  // `DEF_GAMMA` has no group at all: an absent group means no session refers to
  // it, which is exactly zero — never null, undefined or unknown.
  assert.equal(definitionById(view, DEF_GAMMA).sessionCount, 0);
  const none = await read({ counts: [] });
  for (const entry of none.definitions) {
    assert.equal(entry.sessionCount, 0);
  }
});

test("R17. a group belonging to ANOTHER plan is discarded, never attributed", async () => {
  const view = await read({
    counts: Object.freeze([
      countRow(DEF_ALPHA, 7, FOREIGN_PLAN_ID),
      countRow(DEF_BETA, 4),
    ]),
  });
  assert.equal(definitionById(view, DEF_ALPHA).sessionCount, 0);
  assert.equal(definitionById(view, DEF_BETA).sessionCount, 4);
});

test("R18. a blank definition id, and an unusable count, both read as zero", async () => {
  const view = await read({
    counts: Object.freeze([
      countRow("", 9),
      countRow(DEF_ALPHA, -3),
      countRow(DEF_BETA, Number.NaN),
      countRow(DEF_GAMMA, 2.5),
    ]),
  });
  for (const entry of view.definitions) {
    assert.equal(entry.sessionCount, 0, `${entry.id} accepted an unusable count`);
    assert.ok(Number.isInteger(entry.sessionCount));
    assert.ok(entry.sessionCount >= 0);
  }
});

test("R19. two groups naming one definition are summed, never silently dropped", async () => {
  const view = await read({
    counts: Object.freeze([countRow(DEF_ALPHA, 2), countRow(DEF_ALPHA, 3)]),
  });
  assert.equal(definitionById(view, DEF_ALPHA).sessionCount, 5);
});

test("R20. an EMPTY plan skips the count query entirely", async () => {
  const calls = makeCalls();
  const view = await readExamDefinitionsForAdminWithDeps(
    REQUESTED_OFFERING_ID,
    deps(calls, { definitions: [] }),
  );
  assert.deepEqual(calls.order, ["authorize", "gate", "plan", "definitions"]);
  assert.deepEqual(calls.countArgs, []);
  // Still a plan — the offering HAS one, it is simply not configured yet.
  assert.deepEqual(view, {
    planExists: true,
    publishedAt: PLAN_PUBLISHED_AT,
    definitions: [],
  });
});

// ===========================================================================
// R21–R23. No N+1, at any size
// ===========================================================================

test("R21. exactly ONE plan query, ONE definition query and ONE grouped count", async () => {
  const calls = makeCalls();
  await readExamDefinitionsForAdminWithDeps(REQUESTED_OFFERING_ID, deps(calls));
  assert.equal(calls.planArgs.length, 1);
  assert.equal(calls.definitionArgs.length, 1);
  assert.equal(calls.countArgs.length, 1);
  assert.equal(calls.order.filter((entry) => entry === "counts").length, 1);
});

test("R22. the query count does not grow with 1, 5 or 40 definitions", async () => {
  for (const size of [1, 5, 40]) {
    const rows = Object.freeze(
      Array.from({ length: size }, (_unused, index) =>
        definitionRow({ id: `definition-${index}`, orderIndex: index }),
      ),
    );
    const calls = makeCalls();
    const view = await readExamDefinitionsForAdminWithDeps(
      REQUESTED_OFFERING_ID,
      deps(calls, {
        definitions: rows,
        counts: Object.freeze(rows.map((row, index) => countRow(row.id, index + 1))),
      }),
    );
    assert.equal(view.definitions.length, size);
    // FIVE dependency calls in total, for every size: two boundary steps and
    // three queries. A per-definition count would make this grow with `size`.
    assert.equal(calls.order.length, 5, `${size} definitions issued ${calls.order.length} calls`);
    assert.deepEqual(calls.order, ["authorize", "gate", "plan", "definitions", "counts"]);
    assert.deepEqual(
      view.definitions.map((entry) => entry.sessionCount),
      rows.map((_row, index) => index + 1),
    );
  }
});

test("R23. the injected boundary offers NO per-definition dependency", () => {
  const boundary = deps(makeCalls());
  assert.deepEqual(Object.keys(boundary).sort(), [
    "assertHistoricalReadAllowed",
    "countSessionsByDefinition",
    "findDefinitionsByPlanId",
    "findExamPlanByCourseOfferingId",
    "requireCourseContext",
  ]);
  // The count dependency takes ONE argument — the plan — so a caller cannot bind
  // a per-definition count even by mistake.
  assert.equal(boundary.countSessionsByDefinition.length, 1);
  assert.equal(boundary.findDefinitionsByPlanId.length, 1);
});

// ===========================================================================
// R24–R26. Names, kinds and the field set
// ===========================================================================

test("R24. names are carried VERBATIM — untrimmed, unfolded, undeduplicated", async () => {
  const padded = "  רכיבה  ";
  const rows = Object.freeze([
    definitionRow({ id: DEF_ALPHA, name: padded, orderIndex: 0 }),
    definitionRow({ id: DEF_BETA, name: padded, orderIndex: 1 }),
    definitionRow({ id: DEF_GAMMA, name: "רכיבה", orderIndex: 2 }),
  ]);
  const view = await read({ definitions: rows, counts: [] });
  // THREE rows survive: a duplicate name is the database's business (the plan's
  // `@@unique([planId, name])` is what forbids it), and this reader neither
  // merges, renames nor rejects one.
  assert.equal(view.definitions.length, 3);
  assert.deepEqual(
    view.definitions.map((entry) => entry.name),
    [padded, padded, "רכיבה"],
  );
});

test("R25. two definitions sharing ONE kind stay two rows", async () => {
  const view = await read();
  const sameKind = view.definitions.filter((entry) => entry.kind === "INTERFACE_RIDING");
  assert.deepEqual(
    sameKind.map((entry) => entry.id),
    [DEF_ALPHA, DEF_BETA],
  );
});

test("R26. each row carries EXACTLY the eleven approved fields", async () => {
  const view = await read();
  for (const entry of view.definitions) {
    assert.deepEqual(Object.keys(entry), [
      "id",
      "name",
      "kind",
      "durationMinutes",
      "parallelCapacity",
      "requiresInstructedTrainee",
      "requiresLessonTopic",
      "requiresDiscipline",
      "orderIndex",
      "updatedAt",
      "sessionCount",
    ]);
    for (const forbidden of [
      "planId",
      "courseOfferingId",
      "createdAt",
      "sessions",
      "assignments",
      "students",
      "studentId",
      "instructorId",
      "supervisors",
      "date",
      "startTime",
      "arena",
      "notes",
      "title",
      "diagnostics",
      "publishedAt",
    ]) {
      assert.equal(forbidden in entry, false, `a row exposes ${forbidden}`);
    }
  }
  // The three configured booleans are carried as booleans, per row.
  const gamma = definitionById(view, DEF_GAMMA);
  assert.equal(gamma.requiresInstructedTrainee, true);
  assert.equal(gamma.requiresLessonTopic, true);
  assert.equal(gamma.requiresDiscipline, true);
  assert.equal(gamma.durationMinutes, 30);
  const beta = definitionById(view, DEF_BETA);
  assert.equal(beta.parallelCapacity, 2);
  assert.equal(beta.requiresInstructedTrainee, false);
});

// ===========================================================================
// R27–R29. Epoch stamps, plain JSON, freezing
// ===========================================================================

test("R27. updatedAt is an epoch-millisecond number, and an unusable stamp becomes 0", async () => {
  const view = await read();
  for (const entry of view.definitions) {
    assert.equal(entry.updatedAt, DEFINITION_UPDATED_AT);
    assert.equal(typeof entry.updatedAt, "number");
    assert.ok(Number.isInteger(entry.updatedAt));
  }
  const broken = await read({
    definitions: Object.freeze([
      definitionRow({ id: DEF_ALPHA, updatedAt: Number.NaN }),
      definitionRow({ id: DEF_BETA, updatedAt: -5, orderIndex: 1 }),
      definitionRow({ id: DEF_GAMMA, updatedAt: 1.5, orderIndex: 2 }),
    ]),
    counts: [],
  });
  for (const entry of broken.definitions) {
    assert.equal(entry.updatedAt, 0, `${entry.id} kept an unusable stamp`);
  }
});

test("R28. the view is plain JSON: no Date, no Map, no undefined, and it round-trips", async () => {
  for (const [name, view] of [
    ["populated", await read()],
    ["draft", await read({ plan: { id: SERVER_PLAN_ID, publishedAt: null } })],
    ["empty plan", await read({ definitions: [] })],
    ["no plan", await read({ plan: null })],
    ["helper", emptyAdminExamDefinitionListView()],
  ] as const) {
    assert.deepEqual(findNonPlainJsonPaths(view), [], `${name} is not plain JSON`);
    assert.doesNotThrow(() => JSON.stringify(view), `${name} does not serialize`);
    assert.deepEqual(JSON.parse(JSON.stringify(view)), view, `${name} does not round trip`);
    // No `Date` instance anywhere, asserted independently of the shared helper.
    const walk = (value: unknown): void => {
      assert.equal(value instanceof Date, false, `${name} carries a Date`);
      if (value !== null && typeof value === "object") {
        Object.values(value as Record<string, unknown>).forEach(walk);
      }
    };
    walk(view);
  }
});

test("R29. the view, its array and every row are FROZEN", async () => {
  const view = await read();
  assert.ok(Object.isFrozen(view));
  assert.ok(Object.isFrozen(view.definitions));
  assert.ok(Object.isFrozen(view.definitions[0]));
  assert.ok(Object.isFrozen(emptyAdminExamDefinitionListView()));
  assert.ok(Object.isFrozen(emptyAdminExamDefinitionListView().definitions));
  const [first] = view.definitions;
  assert.throws(() => {
    (first as { name: string }).name = "tampered";
  });
});

// ===========================================================================
// R30. Nothing is classified
// ===========================================================================

test("R30. a failure of ANY dependency propagates with its identity intact", async () => {
  const boom = new InfrastructureError("the definition query failed");
  for (const over of [
    { planError: boom },
    { definitionError: boom },
    { countError: boom },
  ] as const) {
    await assert.rejects(
      () => readExamDefinitionsForAdminWithDeps(REQUESTED_OFFERING_ID, deps(makeCalls(), over)),
      (thrown) => thrown === boom,
    );
  }
  // A redirect from the authorization boundary is not absorbed either.
  const redirect = new RedirectShapedThrow();
  await assert.rejects(
    () => readExamDefinitionsForAdminWithDeps(REQUESTED_OFFERING_ID, deps(makeCalls(), { contextError: redirect })),
    (thrown) => thrown === redirect,
  );
});

// ===========================================================================
// S1–S9. The structural promises
// ===========================================================================

const EXAM_DIR = join(import.meta.dirname);
const MODULE_NAME = "exam-definition-admin-read-core.ts";
const TEST_NAME = "exam-definition-admin-read-core.test.ts";
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

// Split specifiers: this suite necessarily names what it forbids, and the
// committed exam-slice guards scan every file in this directory for them.
const PRISMA_MODULE = ["@/lib", "prisma"].join("/");
const GENERATED_CLIENT = ["@prisma", "client"].join("/");
const TP_ACTIONS_MODULE = ["lib/actions", "teaching-practice"].join("/");

test("S1. the pure core declares NO import at all", () => {
  assert.equal(/^import\s/m.test(CODE), false, "the pure core imports something");
  assert.equal(/\brequire\s*\(/.test(CODE), false);
  assert.equal(CODE.includes("server" + "-only"), false, "the pure core is server-bound");
  assert.equal(CODE.includes('"use ' + 'server"'), false);
  assert.equal(CODE.includes('"use ' + 'client"'), false);
});

test("S2. the pure core reaches no database, IO, clock, env or framework", () => {
  for (const token of [
    PRISMA_MODULE,
    GENERATED_CLIENT,
    "PrismaClient",
    "$transaction",
    "$queryRaw",
    "$executeRaw",
    "Date.now",
    "new Date",
    "Math.random",
    "process.env",
    "next/headers",
    "next/navigation",
    "next-auth",
    "cookies(",
    "fetch(",
    "node:fs",
    "readFileSync",
  ]) {
    assert.equal(CODE.includes(token), false, `the pure core references ${token}`);
  }
  const dbCalls =
    /\.(create|createMany|update|updateMany|upsert|delete|deleteMany|findUnique|findFirst|findMany|count|groupBy|aggregate)\s*\(/;
  assert.equal(dbCalls.test(CODE), false, "the pure core performs a database operation");
});

test("S3. the pure core imports no auth, session or course implementation", () => {
  for (const token of [
    "lib/auth",
    "lib/course",
    "requireAdmin",
    "requireCurrent",
    "getCurrent",
    "AdminCourseContext",
    "assertCourseOperationAllowed",
    "HISTORICAL_READ",
    "SCHEDULE_DRAFT_CONFIGURATION",
  ]) {
    assert.equal(CODE.includes(token), false, `the pure core references ${token}`);
  }
  // The gate is named as an INJECTED dependency, and the operation it must bind
  // is documented in prose rather than hardcoded here.
  assert.ok(CODE.includes("assertHistoricalReadAllowed"), "the read gate is not injected");
  assert.ok(/lifecycle/i.test(COMMENTS), "the lifecycle gate is undocumented");
});

test("S4. the pure core consults NO capability", () => {
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
    "capability-keys",
  ]) {
    assert.equal(CODE.includes(token), false, `the pure core consults ${token}`);
  }
});

test("S5. the pure core does not reach the committed read pipeline or Teaching Practice", () => {
  for (const token of [
    "readAdminExamPlan",
    "loadExamPlan",
    "exam-read-scope-core",
    "exam-plan-loader-core",
    "exam-read-io",
    TP_ACTIONS_MODULE,
    "TeachingPractice",
    "teachingPracticeLesson",
    "sourceTeachingPracticeLessonId",
    "sourceLesson",
    "participants",
    "childAssignments",
    "parentPhone",
    "parentName",
  ]) {
    assert.equal(CODE.includes(token), false, `the pure core references ${token}`);
  }
});

test("S6. the pure core models no session row, person or evaluation", () => {
  // FIELD-POSITION matches only, so the prose explaining why these are absent
  // cannot make the check fire.
  for (const pattern of [
    /\bfeedback\w*\s*\??\s*:/i,
    /\brating\w*\s*\??\s*:/i,
    /\bgrade\w*\s*\??\s*:/i,
    /\bscore\w*\s*\??\s*:/i,
    /\bstudent\w*\s*\??\s*:/i,
    /\binstructor\w*\s*\??\s*:/i,
    /\bassignment\w*\s*\??\s*:/i,
    /\barena\s*\??\s*:/i,
    /\bstartTime\s*\??\s*:/i,
  ]) {
    assert.equal(pattern.test(CODE), false, `the core declares a field matching ${pattern}`);
  }
  // `sessionCount` is a NUMBER, and it is the only session-shaped thing here.
  assert.ok(/sessionCount:\s*number/.test(CODE));
  assert.equal(/\bsessionId\s*\??\s*:/.test(CODE), false);
});

test("S7. the core contains no try, no catch and no error classifier", () => {
  for (const token of ["try {", "catch (", "instanceof", "isCourseNotFoundError", "P2002", "P2003"]) {
    assert.equal(CODE.includes(token), false, `the core classifies via ${token}`);
  }
  // ...and says so, so the absence reads as a decision rather than an omission.
  assert.ok(/propagate/i.test(COMMENTS), "the propagation rule is undocumented");
});

test("S8. the core exports exactly the read orchestration and the empty view", () => {
  const exported = [...SOURCE.matchAll(/export (?:async )?function (\w+)\(/g)].map(([, name]) => name);
  assert.deepEqual(exported, [
    "emptyAdminExamDefinitionListView",
    "readExamDefinitionsForAdminWithDeps",
  ]);
  assert.equal(CODE.includes("export const"), false, "the core exports a value");
  assert.equal(CODE.includes("export default"), false);
  // Every result object is frozen at the point of construction.
  assert.equal((CODE.match(/Object\.freeze\(/g) ?? []).length >= 4, true);
});

test("S9. the slice's two lib/exam files are exactly the approved pair", () => {
  const sliceFiles = readdirSync(EXAM_DIR)
    .filter((name) => name.startsWith("exam-definition-admin-read-core"))
    .sort();
  assert.deepEqual(sliceFiles, [MODULE_NAME, TEST_NAME].sort());
});
