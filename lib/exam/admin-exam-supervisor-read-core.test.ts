/**
 * EXAM EX-SUP-IO1 — executable tests for the PURE admin supervisor read shaping
 * (admin-exam-supervisor-read-core.ts).
 *
 * Run with: npx tsx --test lib/exam/admin-exam-supervisor-read-core.test.ts
 *
 * DB-FREE: no database connection is opened, no SQL is executed, no environment
 * variable is read, and no production identifier appears anywhere. Every fixture
 * id is a short, obviously synthetic token — never a cuid-shaped literal — so no
 * value here could be mistaken for, or replayed against, a real row.
 *
 * WHAT THESE PROVE, at runtime rather than by inspection:
 *   1–5   the two deterministic TOTAL orders, and their determinism under
 *         repetition;
 *   6–8   duplicate display names, and the ONE fixed placeholder for every
 *         unreadable name;
 *   9–11  the empty views;
 *  12–15  deep freeze, JSON round-trip, no input mutation, frozen inputs;
 *  16–19  the published shapes: exactly the approved keys, and no
 *         `Instructor.id` on the stored path;
 *  20–24  the structural purity guards over the module's own source text.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  buildAdminExamSupervisorListView,
  buildEligibleExamSupervisorListView,
  emptyAdminExamSupervisorListView,
  emptyEligibleExamSupervisorListView,
  UNNAMED_EXAM_SUPERVISOR_NAME,
  type StoredAdminExamSupervisorRow,
  type StoredEligibleExamSupervisorRow,
} from "./admin-exam-supervisor-read-core";

// ===========================================================================
// Fixtures — deliberately short and synthetic, never cuid-shaped
// ===========================================================================

function instructor(
  instructorId: string,
  fullName: string,
): StoredEligibleExamSupervisorRow {
  return { instructorId, fullName };
}

function supervisor(
  overrides: Partial<StoredAdminExamSupervisorRow> = {},
): StoredAdminExamSupervisorRow {
  return {
    supervisorId: "supervisor-a",
    sessionId: "session-1",
    instructorName: "דנה",
    ...overrides,
  };
}

/** Every object reachable from `value`, including `value` itself. */
function reachableObjects(value: unknown, seen: object[] = []): object[] {
  if (typeof value !== "object" || value === null) return seen;
  if (seen.includes(value)) return seen;
  seen.push(value);
  for (const entry of Object.values(value as Record<string, unknown>)) {
    reachableObjects(entry, seen);
  }
  return seen;
}

/** Is every object reachable from `value` frozen? */
function isDeeplyFrozen(value: unknown): boolean {
  return reachableObjects(value).every((entry) => Object.isFrozen(entry));
}

// ===========================================================================
// 1–5. The two deterministic total orders
// ===========================================================================

test("1. eligible instructors sort by fullName, then instructorId", () => {
  const view = buildEligibleExamSupervisorListView([
    instructor("instructor-c", "רון"),
    instructor("instructor-a", "אבי"),
    instructor("instructor-b", "מיכל"),
  ]);
  assert.deepEqual(
    view.instructors.map((option) => option.instructorId),
    ["instructor-a", "instructor-b", "instructor-c"],
  );
  assert.deepEqual(
    view.instructors.map((option) => option.fullName),
    ["אבי", "מיכל", "רון"],
  );
});

test("2. the instructor order is TOTAL: equal names break on instructorId", () => {
  const forward = buildEligibleExamSupervisorListView([
    instructor("instructor-z", "אבי"),
    instructor("instructor-a", "אבי"),
  ]);
  const reversed = buildEligibleExamSupervisorListView([
    instructor("instructor-a", "אבי"),
    instructor("instructor-z", "אבי"),
  ]);
  assert.deepEqual(
    forward.instructors.map((option) => option.instructorId),
    ["instructor-a", "instructor-z"],
  );
  // The SAME rows in the opposite input order produce the SAME output order:
  // the result does not depend on how the database happened to return them.
  assert.deepEqual(forward, reversed);
});

test("3. stored supervisors sort by sessionId, then instructorName, then supervisorId", () => {
  const view = buildAdminExamSupervisorListView([
    supervisor({ supervisorId: "supervisor-d", sessionId: "session-2", instructorName: "רון" }),
    supervisor({ supervisorId: "supervisor-b", sessionId: "session-1", instructorName: "מיכל" }),
    supervisor({ supervisorId: "supervisor-a", sessionId: "session-1", instructorName: "אבי" }),
    supervisor({ supervisorId: "supervisor-c", sessionId: "session-2", instructorName: "אבי" }),
  ]);
  assert.deepEqual(
    view.supervisors.map((row) => row.supervisorId),
    ["supervisor-a", "supervisor-b", "supervisor-c", "supervisor-d"],
  );
  // The session is the OUTER key: a name that sorts first cannot pull a row out
  // of its session group.
  assert.deepEqual(
    view.supervisors.map((row) => row.sessionId),
    ["session-1", "session-1", "session-2", "session-2"],
  );
});

test("4. the stored order is TOTAL: equal (session, name) breaks on supervisorId", () => {
  const forward = buildAdminExamSupervisorListView([
    supervisor({ supervisorId: "supervisor-z" }),
    supervisor({ supervisorId: "supervisor-a" }),
  ]);
  const reversed = buildAdminExamSupervisorListView([
    supervisor({ supervisorId: "supervisor-a" }),
    supervisor({ supervisorId: "supervisor-z" }),
  ]);
  assert.deepEqual(
    forward.supervisors.map((row) => row.supervisorId),
    ["supervisor-a", "supervisor-z"],
  );
  assert.deepEqual(forward, reversed);

  // The name compared is the RESOLVED one, so a row with no readable name sorts
  // by the placeholder it actually displays rather than by a value nobody sees.
  const mixed = buildAdminExamSupervisorListView([
    supervisor({ supervisorId: "supervisor-b", instructorName: "אבי" }),
    supervisor({ supervisorId: "supervisor-a", instructorName: null }),
  ]);
  assert.deepEqual(
    mixed.supervisors.map((row) => [row.supervisorId, row.instructorName]),
    [
      ["supervisor-b", "אבי"],
      ["supervisor-a", UNNAMED_EXAM_SUPERVISOR_NAME],
    ],
  );
});

test("5. repeated calls on the same input are byte-for-byte identical", () => {
  const instructorRows = [
    instructor("instructor-b", "מיכל"),
    instructor("instructor-a", "אבי"),
  ];
  const storedRows = [
    supervisor({ supervisorId: "supervisor-b", sessionId: "session-2" }),
    supervisor({ supervisorId: "supervisor-a", sessionId: "session-1" }),
  ];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    assert.deepEqual(
      buildEligibleExamSupervisorListView(instructorRows),
      buildEligibleExamSupervisorListView(instructorRows),
    );
    assert.deepEqual(
      buildAdminExamSupervisorListView(storedRows),
      buildAdminExamSupervisorListView(storedRows),
    );
  }
  // Deterministic across calls means the serialized payload is stable too — a
  // reader refreshing twice must not see the list reshuffle.
  assert.equal(
    JSON.stringify(buildAdminExamSupervisorListView(storedRows)),
    JSON.stringify(buildAdminExamSupervisorListView([...storedRows].reverse())),
  );
});

// ===========================================================================
// 6–8. Duplicates and the ONE fixed placeholder
// ===========================================================================

test("6. duplicate display names remain SEPARATE options", () => {
  const view = buildEligibleExamSupervisorListView([
    instructor("instructor-a", "נועה"),
    instructor("instructor-b", "נועה"),
  ]);
  assert.equal(view.instructors.length, 2);
  assert.deepEqual(
    view.instructors.map((option) => option.instructorId),
    ["instructor-a", "instructor-b"],
  );
  // Two instructors with one name are two people; collapsing them would make one
  // of them unrecordable.
  assert.equal(new Set(view.instructors.map((o) => o.fullName)).size, 1);
});

test("7. duplicate names are never merged on the STORED path either", () => {
  const view = buildAdminExamSupervisorListView([
    supervisor({ supervisorId: "supervisor-a", instructorName: "נועה" }),
    supervisor({ supervisorId: "supervisor-b", instructorName: "נועה" }),
    // ...including the same display name on a different session.
    supervisor({ supervisorId: "supervisor-c", sessionId: "session-2", instructorName: "נועה" }),
  ]);
  assert.equal(view.supervisors.length, 3);
  assert.deepEqual(
    view.supervisors.map((row) => row.supervisorId),
    ["supervisor-a", "supervisor-b", "supervisor-c"],
  );
});

test("8. every unreadable name resolves to ONE fixed Hebrew placeholder", () => {
  const view = buildAdminExamSupervisorListView([
    supervisor({ supervisorId: "supervisor-a", instructorName: null }),
    supervisor({ supervisorId: "supervisor-b", instructorName: undefined }),
    supervisor({ supervisorId: "supervisor-c", instructorName: "" }),
    supervisor({ supervisorId: "supervisor-d", instructorName: "   " }),
    supervisor({ supervisorId: "supervisor-e", instructorName: "\t\n " }),
    supervisor({
      supervisorId: "supervisor-f",
      instructorName: 42 as unknown as string,
    }),
  ]);
  // The rows are RETAINED — a supervisor with no readable name is still recorded
  // on the session — and each carries the same constant, never a derived value.
  assert.equal(view.supervisors.length, 6);
  for (const row of view.supervisors) {
    assert.equal(row.instructorName, UNNAMED_EXAM_SUPERVISOR_NAME);
  }
  assert.equal(UNNAMED_EXAM_SUPERVISOR_NAME, "מדריך ללא שם");
  // The placeholder carries no identity: no id, no fragment, no counter.
  for (const row of view.supervisors) {
    assert.equal(row.instructorName.includes(row.supervisorId), false);
    assert.equal(row.instructorName.includes(row.sessionId), false);
    assert.equal(/\d/.test(row.instructorName), false);
  }

  // A name that survives the blank test is carried VERBATIM — untrimmed, not
  // case-folded, not normalized.
  const messy = "  אבי  כהן ";
  const kept = buildAdminExamSupervisorListView([supervisor({ instructorName: messy })]);
  assert.equal(kept.supervisors[0].instructorName, messy);
  const picker = buildEligibleExamSupervisorListView([instructor("instructor-a", messy)]);
  assert.equal(picker.instructors[0].fullName, messy);
});

// ===========================================================================
// 9–11. The empty views
// ===========================================================================

test("9. no eligible rows produces the empty, frozen picker", () => {
  const built = buildEligibleExamSupervisorListView([]);
  assert.deepEqual(built, { instructors: [] });
  assert.deepEqual(built, emptyEligibleExamSupervisorListView());
  assert.ok(isDeeplyFrozen(built));
  assert.equal(built.instructors.length, 0);
});

test("10. no stored rows produces the empty, frozen list", () => {
  const built = buildAdminExamSupervisorListView([]);
  assert.deepEqual(built, { supervisors: [] });
  assert.deepEqual(built, emptyAdminExamSupervisorListView());
  assert.ok(isDeeplyFrozen(built));
  assert.equal(built.supervisors.length, 0);
});

test("11. the empty views cannot be appended to by a caller", () => {
  const picker = emptyEligibleExamSupervisorListView();
  const list = emptyAdminExamSupervisorListView();
  assert.throws(() => {
    (picker.instructors as unknown as unknown[]).push({});
  });
  assert.throws(() => {
    (list.supervisors as unknown as unknown[]).push({});
  });
  // ...and a second call still sees an empty list.
  assert.equal(emptyEligibleExamSupervisorListView().instructors.length, 0);
  assert.equal(emptyAdminExamSupervisorListView().supervisors.length, 0);
});

// ===========================================================================
// 12–15. Freezing, JSON, immutability of inputs
// ===========================================================================

test("12. both views are DEEPLY frozen: view, array and every row", () => {
  const picker = buildEligibleExamSupervisorListView([
    instructor("instructor-a", "אבי"),
    instructor("instructor-b", "מיכל"),
  ]);
  const list = buildAdminExamSupervisorListView([
    supervisor({ supervisorId: "supervisor-a" }),
    supervisor({ supervisorId: "supervisor-b", sessionId: "session-2" }),
  ]);

  for (const view of [picker, list] as const) {
    assert.ok(Object.isFrozen(view), "the view is not frozen");
    assert.ok(isDeeplyFrozen(view), "the view is not DEEPLY frozen");
  }
  assert.ok(Object.isFrozen(picker.instructors));
  assert.ok(Object.isFrozen(list.supervisors));
  for (const option of picker.instructors) assert.ok(Object.isFrozen(option));
  for (const row of list.supervisors) assert.ok(Object.isFrozen(row));

  // A consumer cannot rewrite a published name in place.
  assert.throws(() => {
    (list.supervisors[0] as { instructorName: string }).instructorName = "x";
  });
});

test("13. both views round-trip through JSON unchanged", () => {
  const picker = buildEligibleExamSupervisorListView([
    instructor("instructor-b", "מיכל"),
    instructor("instructor-a", "אבי"),
  ]);
  const list = buildAdminExamSupervisorListView([
    supervisor({ supervisorId: "supervisor-b", instructorName: null }),
    supervisor({ supervisorId: "supervisor-a" }),
  ]);
  for (const view of [
    picker,
    list,
    emptyEligibleExamSupervisorListView(),
    emptyAdminExamSupervisorListView(),
  ] as const) {
    assert.deepEqual(JSON.parse(JSON.stringify(view)), view);
  }
  // Nothing published is a calendar value, Map, Set, BigInt, Error or class
  // instance — every reachable object is a plain object or a plain array.
  for (const entry of [...reachableObjects(picker), ...reachableObjects(list)]) {
    const proto = Object.getPrototypeOf(entry);
    assert.ok(
      proto === Object.prototype || proto === Array.prototype,
      `a non-plain object was published: ${String(proto?.constructor?.name)}`,
    );
  }
  // No property is present-but-undefined: a key that vanished from the payload
  // would not round-trip as "no value".
  for (const entry of [...reachableObjects(picker), ...reachableObjects(list)]) {
    if (Array.isArray(entry)) continue;
    for (const value of Object.values(entry as Record<string, unknown>)) {
      assert.notEqual(value, undefined);
    }
  }
});

test("14. the builders never mutate or alias their input", () => {
  const instructorRows = [
    instructor("instructor-c", "רון"),
    instructor("instructor-a", "אבי"),
  ];
  const instructorSnapshot = JSON.parse(JSON.stringify(instructorRows));
  const picker = buildEligibleExamSupervisorListView(instructorRows);
  assert.deepEqual(instructorRows, instructorSnapshot, "the instructor input was reordered");
  for (const [index, option] of picker.instructors.entries()) {
    assert.equal(
      instructorRows.includes(option as never),
      false,
      `option ${index} aliases an input`,
    );
  }

  const storedRows = [
    supervisor({ supervisorId: "supervisor-c", sessionId: "session-2" }),
    supervisor({ supervisorId: "supervisor-a", sessionId: "session-1" }),
  ];
  const storedSnapshot = JSON.parse(JSON.stringify(storedRows));
  const list = buildAdminExamSupervisorListView(storedRows);
  assert.deepEqual(storedRows, storedSnapshot, "the stored input was reordered");
  for (const [index, row] of list.supervisors.entries()) {
    assert.equal(storedRows.includes(row as never), false, `row ${index} aliases an input`);
  }
});

test("15. a FROZEN input is accepted by both builders", () => {
  const instructorRows = Object.freeze([
    Object.freeze(instructor("instructor-b", "מיכל")),
    Object.freeze(instructor("instructor-a", "אבי")),
  ]);
  const storedRows = Object.freeze([
    Object.freeze(supervisor({ supervisorId: "supervisor-b" })),
    Object.freeze(supervisor({ supervisorId: "supervisor-a" })),
  ]);
  assert.deepEqual(
    buildEligibleExamSupervisorListView(instructorRows).instructors.map((o) => o.instructorId),
    ["instructor-a", "instructor-b"],
  );
  assert.deepEqual(
    buildAdminExamSupervisorListView(storedRows).supervisors.map((r) => r.supervisorId),
    ["supervisor-a", "supervisor-b"],
  );
});

// ===========================================================================
// 16–19. The published shapes
// ===========================================================================

test("16. an option carries EXACTLY instructorId and fullName", () => {
  const [option] = buildEligibleExamSupervisorListView([
    instructor("instructor-a", "אבי"),
  ]).instructors;
  assert.deepEqual(Object.keys(option).sort(), ["fullName", "instructorId"]);
  assert.deepEqual(option, { instructorId: "instructor-a", fullName: "אבי" });
});

test("17. a stored row carries EXACTLY the three approved keys", () => {
  const [row] = buildAdminExamSupervisorListView([supervisor()]).supervisors;
  assert.deepEqual(Object.keys(row).sort(), [
    "instructorName",
    "sessionId",
    "supervisorId",
  ]);
  // The supervisor id is RETAINED: it is the removal path's only handle.
  assert.equal(row.supervisorId, "supervisor-a");
});

test("18. NO Instructor.id reaches the stored DTO", () => {
  const list = buildAdminExamSupervisorListView([
    supervisor({ supervisorId: "supervisor-a", instructorName: "instructor-a" }),
  ]);
  for (const row of list.supervisors) {
    assert.equal("instructorId" in row, false, "the DTO publishes an instructorId");
    assert.equal("instructor" in row, false, "the DTO publishes an instructor");
  }
  // The input row type has no instructor id field either, so one cannot arrive.
  const serialized = JSON.stringify(list);
  assert.equal(serialized.includes('"instructorId"'), false);
});

test("19. neither view carries personal or scoping data beyond the approved keys", () => {
  const picker = buildEligibleExamSupervisorListView([instructor("instructor-a", "אבי")]);
  const list = buildAdminExamSupervisorListView([supervisor()]);
  const keys = new Set<string>();
  for (const entry of [...reachableObjects(picker), ...reachableObjects(list)]) {
    if (Array.isArray(entry)) continue;
    for (const key of Object.keys(entry)) keys.add(key);
  }
  // `instructorId` appears ONCE, and only on the picker option, which exists to
  // be submitted back as the chosen instructor. Test 18 proves it is absent from
  // the stored DTO.
  assert.deepEqual([...keys].sort(), [
    "fullName",
    "instructorId",
    "instructorName",
    "instructors",
    "sessionId",
    "supervisorId",
    "supervisors",
  ]);
  for (const forbidden of [
    "identityNumber",
    "phone",
    "email",
    "firstName",
    "lastName",
    "isActive",
    "canEditAttendance",
    "canSendMessages",
    "planId",
    "courseOfferingId",
    "createdAt",
    "updatedAt",
    "position",
    "kind",
    "tier",
    "primary",
    "responsible",
  ]) {
    assert.equal(keys.has(forbidden), false, `the views publish ${forbidden}`);
  }
});

// ===========================================================================
// 20–24. Structural guards over the module's own source text
// ===========================================================================

const EXAM_DIR = import.meta.dirname;
const MODULE_NAME = "admin-exam-supervisor-read-core.ts";
const TEST_NAME = "admin-exam-supervisor-read-core.test.ts";
const SOURCE = readFileSync(join(EXAM_DIR, MODULE_NAME), "utf8");

/** Strip comments so the guards assert on CODE, not on explanatory prose. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const CODE = stripComments(SOURCE);

// Split specifiers: this suite necessarily names some of what it forbids, and
// the committed exam-slice guards scan sibling directories for them.
const PRISMA_MODULE = ["@/lib", "prisma"].join("/");
const GENERATED_CLIENT = ["@prisma", "client"].join("/");
const ENV_READ = "process" + ".env";

test("20. the pure module declares NO imports at all", () => {
  assert.equal(/(^|\n)\s*import\s/.test(CODE), false, "the module imports something");
  assert.equal(/require\s*\(/.test(CODE), false, "the module uses require");
  assert.equal(/\bfrom\s+"/.test(CODE), false, "the module has a module specifier");
});

test("21. the pure module reaches NO database, auth, framework, env, clock or randomness", () => {
  for (const token of [
    PRISMA_MODULE,
    GENERATED_CLIENT,
    ENV_READ,
    "DATABASE" + "_URL",
    "Prisma" + "Client",
    "app/generated",
    "next/",
    "lib/auth",
    "lib/course",
    "requireAdmin",
    "cookies(",
    "headers(",
    "getCurrentInstructor",
    "requireCurrentTrainee",
    "server" + "-only",
    '"use ' + 'server"',
    "'use " + "server'",
    '"use ' + 'client"',
    "new Date",
    "Date.now",
    "Math.random",
    "crypto",
    "node:fs",
    "node:path",
    "fetch(",
    "revalidatePath",
    "redirect(",
  ]) {
    assert.equal(CODE.includes(token), false, `the pure core references ${token}`);
  }
  // No capability is consulted either.
  for (const token of ['"EXAMS"', "'EXAMS'", "CapabilityKey", "getEffectiveCapabilities"]) {
    assert.equal(CODE.includes(token), false, `the pure core consults ${token}`);
  }
  // The order is machine-independent: plain `<` on the raw string, never a
  // locale-aware collation.
  assert.equal(CODE.includes("locale" + "Compare"), false, "the order is locale-dependent");
  assert.equal(CODE.includes("Intl."), false, "the order is locale-dependent");
});

test("22. the pure module performs no query and opens no transaction", () => {
  const statements =
    /\.(create|createMany|update|updateMany|upsert|delete|deleteMany|aggregate|groupBy|findMany|findFirst|findUnique|count)\s*\(/;
  assert.equal(statements.test(CODE), false, "the pure core issues a query");
  for (const token of ["$" + "transaction", "$" + "executeRaw", "$" + "queryRaw"]) {
    assert.equal(CODE.includes(token), false, `the pure core uses ${token}`);
  }
});

test("23. the module exports exactly the intended surface, and models nothing more", () => {
  const functions = [...SOURCE.matchAll(/^export\s+function\s+(\w+)/gm)].map((m) => m[1]);
  assert.deepEqual(functions.sort(), [
    "buildAdminExamSupervisorListView",
    "buildEligibleExamSupervisorListView",
    "emptyAdminExamSupervisorListView",
    "emptyEligibleExamSupervisorListView",
  ]);
  const values = [...SOURCE.matchAll(/^export\s+const\s+(\w+)/gm)].map((m) => m[1]);
  assert.deepEqual(values, ["UNNAMED_EXAM_SUPERVISOR_NAME"]);
  assert.equal(CODE.includes("export default"), false);
  assert.equal(CODE.includes("export class"), false);
  // Both builders take exactly one argument, and neither takes a dependency bag.
  assert.equal(buildEligibleExamSupervisorListView.length, 1);
  assert.equal(buildAdminExamSupervisorListView.length, 1);
  assert.equal(emptyEligibleExamSupervisorListView.length, 0);
  assert.equal(emptyAdminExamSupervisorListView.length, 0);

  // No sequence, kind, tier or responsibility concept exists anywhere in the
  // module — the supervisors of a session are an unordered SET.
  for (const token of [
    "orderIndex",
    "reorder",
    "Reorder",
    "isPrimary",
    "isResponsible",
    "supervisorRole",
    "SupervisorKind",
    "examiner",
    "Examiner",
  ]) {
    assert.equal(CODE.includes(token), false, `the pure core invents ${token}`);
  }
  // ...and no evaluation field of any kind is declared. Field-position matches
  // only, so prose explaining WHY these are absent does not trip the check.
  for (const word of ["feedback", "rating", "grade", "score"]) {
    const fieldLike = new RegExp(`\\b${word}\\w*\\s*\\??\\s*:`, "i");
    assert.equal(fieldLike.test(CODE), false, `the pure core declares a ${word} field`);
  }
  // Nothing is deduplicated or collapsed.
  assert.equal(CODE.includes("new Set"), false, "the pure core deduplicates");
  assert.equal(/\.filter\(/.test(CODE), false, "the pure core filters rows");
});

test("24. this slice's lib/exam files are exactly the approved pair, and this suite is DB-free", () => {
  const sliceFiles = readdirSync(EXAM_DIR)
    .filter((name) => name.startsWith("admin-exam-supervisor-read"))
    .sort();
  assert.deepEqual(sliceFiles, [MODULE_NAME, TEST_NAME].sort());
  for (const name of sliceFiles) {
    assert.equal(name.endsWith(".tsx"), false, `${name} is a UI file`);
  }
  // The committed six-file supervisor core set is untouched by this slice: its
  // filename guard pins that prefix, which is exactly why this core sits outside
  // it under its own.
  //
  // The two orchestration names are ASSEMBLED, never spelled whole: the sibling
  // WRITE binding's guard sweeps `lib/` for them and keeps an EMPTY caller list,
  // and a suite that spelled either as one literal would enrol itself in it.
  assert.deepEqual(
    readdirSync(EXAM_DIR)
      .filter((name) => /^(exam|create-exam|delete-exam)-supervisor-/.test(name))
      .sort(),
    [
      "create-exam-supervisor" + "-core.test.ts",
      "create-exam-supervisor" + "-core.ts",
      "delete-exam-supervisor" + "-core.test.ts",
      "delete-exam-supervisor" + "-core.ts",
      "exam-supervisor-write-core.test.ts",
      "exam-supervisor-write-core.ts",
    ],
  );

  // No fixture in this suite is cuid-shaped, so nothing here resembles a real id.
  const own = readFileSync(join(EXAM_DIR, TEST_NAME), "utf8");
  assert.equal(/["']c[a-z0-9]{24}["']/.test(own), false, "a cuid-shaped literal is hardcoded");
  assert.equal(/["']c[a-z0-9]{24}["']/.test(SOURCE), false, "a cuid-shaped literal is hardcoded");

  const ownCode = stripComments(own);
  for (const token of [
    PRISMA_MODULE,
    GENERATED_CLIENT,
    ENV_READ,
    "DATABASE" + "_URL",
    "Prisma" + "Client",
  ]) {
    assert.equal(ownCode.includes(token), false, `the suite references ${token}`);
  }
  const specifiers = [...ownCode.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(
    [...new Set(specifiers)].sort(),
    [
      "./admin-exam-supervisor-read-core",
      "node:assert/strict",
      "node:fs",
      "node:path",
      "node:test",
    ],
  );
});
