/**
 * EXAM EX-ASG-IO1 — executable tests for the PURE admin assignment read shaping
 * (admin-exam-assignment-read-core.ts).
 *
 * Run with: npx tsx --test lib/exam/admin-exam-assignment-read-core.test.ts
 *
 * DB-FREE: no database connection is opened, no SQL is executed, no environment
 * variable is read, and no production identifier appears anywhere. Every fixture
 * id is a short, obviously synthetic token — never a cuid-shaped literal — so no
 * value here could be mistaken for, or replayed against, a real row.
 *
 * WHAT THESE PROVE, at runtime rather than by inspection:
 *   1–4   the two deterministic TOTAL orders;
 *   5–7   duplicate display names, the missing-trainee placeholder, and the
 *         unfiltered role;
 *   8–10  the empty views;
 *  11–14  deep freeze, JSON round-trip, no input mutation, frozen inputs;
 *  15–20  the published shapes: exactly the approved keys, and no `Student.id`;
 *  21–25  the structural purity guards over the module's own source text;
 *  26–28  EX-ASG-LTD2-B1 — the two stored DETAIL values: carried verbatim, null
 *         preserved as null, published for every role, and given no placeholder.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  buildAdminExamAssignmentListView,
  buildEligibleExamTraineeListView,
  emptyAdminExamAssignmentListView,
  emptyEligibleExamTraineeListView,
  UNASSIGNED_EXAM_TRAINEE_NAME,
  type StoredAdminExamAssignmentRow,
  type StoredEligibleExamTraineeRow,
} from "./admin-exam-assignment-read-core";

// ===========================================================================
// Fixtures — deliberately short and synthetic, never cuid-shaped
// ===========================================================================

function trainee(
  studentId: string,
  fullName: string,
): StoredEligibleExamTraineeRow {
  return { studentId, fullName };
}

function assignment(
  overrides: Partial<StoredAdminExamAssignmentRow> = {},
): StoredAdminExamAssignmentRow {
  return {
    assignmentId: "assignment-a",
    sessionId: "session-1",
    role: "EXAMINEE",
    traineeName: "דנה",
    horseName: "סוסון",
    instructionTopic: "עלייה וירידה",
    discipline: "רכיבה טיפולית",
    orderIndex: 0,
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
// 1–4. The two deterministic total orders
// ===========================================================================

test("1. eligible trainees sort by fullName, then studentId", () => {
  const view = buildEligibleExamTraineeListView([
    trainee("student-c", "רון"),
    trainee("student-a", "אבי"),
    trainee("student-b", "מיכל"),
  ]);
  assert.deepEqual(
    view.trainees.map((option) => option.studentId),
    ["student-a", "student-b", "student-c"],
  );
  assert.deepEqual(
    view.trainees.map((option) => option.fullName),
    ["אבי", "מיכל", "רון"],
  );
});

test("2. the trainee order is TOTAL: equal names break on studentId", () => {
  const forward = buildEligibleExamTraineeListView([
    trainee("student-z", "אבי"),
    trainee("student-a", "אבי"),
  ]);
  const reversed = buildEligibleExamTraineeListView([
    trainee("student-a", "אבי"),
    trainee("student-z", "אבי"),
  ]);
  assert.deepEqual(
    forward.trainees.map((option) => option.studentId),
    ["student-a", "student-z"],
  );
  // The SAME rows in the opposite input order produce the SAME output order:
  // the result does not depend on how the database happened to return them.
  assert.deepEqual(forward, reversed);
});

test("3. assignments sort by sessionId, then orderIndex, then assignmentId", () => {
  const view = buildAdminExamAssignmentListView([
    assignment({ assignmentId: "assignment-d", sessionId: "session-2", orderIndex: 0 }),
    assignment({ assignmentId: "assignment-b", sessionId: "session-1", orderIndex: 5 }),
    assignment({ assignmentId: "assignment-a", sessionId: "session-1", orderIndex: 1 }),
    assignment({ assignmentId: "assignment-c", sessionId: "session-2", orderIndex: 0 }),
  ]);
  assert.deepEqual(
    view.assignments.map((row) => row.assignmentId),
    ["assignment-a", "assignment-b", "assignment-c", "assignment-d"],
  );
});

test("4. the assignment order is TOTAL: equal (session, position) breaks on id", () => {
  // The committed create binding documents that two concurrent creates on one
  // session may receive the SAME orderIndex. Without the id tie-break the list
  // would reshuffle between two identical reads.
  const forward = buildAdminExamAssignmentListView([
    assignment({ assignmentId: "assignment-z", orderIndex: 3 }),
    assignment({ assignmentId: "assignment-a", orderIndex: 3 }),
  ]);
  const reversed = buildAdminExamAssignmentListView([
    assignment({ assignmentId: "assignment-a", orderIndex: 3 }),
    assignment({ assignmentId: "assignment-z", orderIndex: 3 }),
  ]);
  assert.deepEqual(
    forward.assignments.map((row) => row.assignmentId),
    ["assignment-a", "assignment-z"],
  );
  assert.deepEqual(forward, reversed);

  // A non-integer position sorts as 0 rather than as NaN, which would otherwise
  // produce a different order on every read.
  const withGarbage = buildAdminExamAssignmentListView([
    assignment({ assignmentId: "assignment-b", orderIndex: 1 }),
    assignment({
      assignmentId: "assignment-a",
      orderIndex: Number.NaN as unknown as number,
    }),
  ]);
  assert.deepEqual(
    withGarbage.assignments.map((row) => [row.assignmentId, row.orderIndex]),
    [
      ["assignment-a", 0],
      ["assignment-b", 1],
    ],
  );
});

// ===========================================================================
// 5–7. Duplicates, the placeholder, and the unfiltered role
// ===========================================================================

test("5. duplicate display names remain SEPARATE options", () => {
  const view = buildEligibleExamTraineeListView([
    trainee("student-a", "נועה"),
    trainee("student-b", "נועה"),
  ]);
  assert.equal(view.trainees.length, 2);
  assert.deepEqual(
    view.trainees.map((option) => option.studentId),
    ["student-a", "student-b"],
  );
  // Two trainees with one name are two people; collapsing them would make one
  // of them unassignable.
  assert.equal(new Set(view.trainees.map((o) => o.fullName)).size, 1);
});

test("6. a null trainee keeps its row under ONE fixed Hebrew placeholder", () => {
  const view = buildAdminExamAssignmentListView([
    assignment({ assignmentId: "assignment-a", traineeName: null }),
    assignment({ assignmentId: "assignment-b", traineeName: undefined }),
    assignment({ assignmentId: "assignment-c", traineeName: "" }),
  ]);
  // The rows are RETAINED — a position with no linked trainee still occupies the
  // session — and each carries the same constant, never a derived value.
  assert.equal(view.assignments.length, 3);
  for (const row of view.assignments) {
    assert.equal(row.traineeName, UNASSIGNED_EXAM_TRAINEE_NAME);
  }
  assert.equal(UNASSIGNED_EXAM_TRAINEE_NAME, "ללא חניך משויך");
  // The placeholder carries no identity: no id, no fragment, no counter.
  for (const row of view.assignments) {
    assert.equal(row.traineeName.includes(row.assignmentId), false);
    assert.equal(row.traineeName.includes(row.sessionId), false);
    assert.equal(/\d/.test(row.traineeName), false);
  }
});

test("7. INSTRUCTED_TRAINEE rows are READABLE and never filtered out", () => {
  const view = buildAdminExamAssignmentListView([
    assignment({ assignmentId: "assignment-a", role: "EXAMINEE" }),
    assignment({ assignmentId: "assignment-b", role: "INSTRUCTED_TRAINEE" }),
  ]);
  assert.equal(view.assignments.length, 2);
  assert.deepEqual(
    view.assignments.map((row) => row.role),
    ["EXAMINEE", "INSTRUCTED_TRAINEE"],
  );
  // The role is carried VERBATIM: no mapping table, no default, no relabelling.
  const single = buildAdminExamAssignmentListView([
    assignment({ role: "INSTRUCTED_TRAINEE" }),
  ]);
  assert.equal(single.assignments[0].role, "INSTRUCTED_TRAINEE");

  // A row with no horse is likewise kept, with a null horse rather than an
  // invented one.
  const noHorse = buildAdminExamAssignmentListView([
    assignment({ role: "INSTRUCTED_TRAINEE", horseName: null }),
  ]);
  assert.equal(noHorse.assignments.length, 1);
  assert.equal(noHorse.assignments[0].horseName, null);
});

// ===========================================================================
// 8–10. The empty views
// ===========================================================================

test("8. no eligible rows produces the empty, frozen picker", () => {
  const built = buildEligibleExamTraineeListView([]);
  assert.deepEqual(built, { trainees: [] });
  assert.deepEqual(built, emptyEligibleExamTraineeListView());
  assert.ok(isDeeplyFrozen(built));
  assert.equal(built.trainees.length, 0);
});

test("9. no assignment rows produces the empty, frozen list", () => {
  const built = buildAdminExamAssignmentListView([]);
  assert.deepEqual(built, { assignments: [] });
  assert.deepEqual(built, emptyAdminExamAssignmentListView());
  assert.ok(isDeeplyFrozen(built));
  assert.equal(built.assignments.length, 0);
});

test("10. the empty views cannot be appended to by a caller", () => {
  const picker = emptyEligibleExamTraineeListView();
  const list = emptyAdminExamAssignmentListView();
  assert.throws(() => {
    (picker.trainees as unknown as unknown[]).push({});
  });
  assert.throws(() => {
    (list.assignments as unknown as unknown[]).push({});
  });
  // ...and a second call still sees an empty list.
  assert.equal(emptyEligibleExamTraineeListView().trainees.length, 0);
  assert.equal(emptyAdminExamAssignmentListView().assignments.length, 0);
});

// ===========================================================================
// 11–14. Freezing, JSON, immutability of inputs
// ===========================================================================

test("11. both views are DEEPLY frozen: view, array and every row", () => {
  const picker = buildEligibleExamTraineeListView([
    trainee("student-a", "אבי"),
    trainee("student-b", "מיכל"),
  ]);
  const list = buildAdminExamAssignmentListView([
    assignment({ assignmentId: "assignment-a" }),
    assignment({ assignmentId: "assignment-b", sessionId: "session-2" }),
  ]);

  for (const view of [picker, list] as const) {
    assert.ok(Object.isFrozen(view), "the view is not frozen");
    assert.ok(isDeeplyFrozen(view), "the view is not DEEPLY frozen");
  }
  assert.ok(Object.isFrozen(picker.trainees));
  assert.ok(Object.isFrozen(list.assignments));
  for (const option of picker.trainees) assert.ok(Object.isFrozen(option));
  for (const row of list.assignments) assert.ok(Object.isFrozen(row));

  // A consumer cannot rewrite a published name in place.
  assert.throws(() => {
    (list.assignments[0] as { traineeName: string }).traineeName = "x";
  });
});

test("12. both views round-trip through JSON unchanged", () => {
  const picker = buildEligibleExamTraineeListView([
    trainee("student-b", "מיכל"),
    trainee("student-a", "אבי"),
  ]);
  const list = buildAdminExamAssignmentListView([
    assignment({ assignmentId: "assignment-b", horseName: null, traineeName: null }),
    assignment({ assignmentId: "assignment-a" }),
  ]);
  for (const view of [picker, list, emptyEligibleExamTraineeListView(),
    emptyAdminExamAssignmentListView()] as const) {
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
});

test("13. the builders never mutate or alias their input", () => {
  const traineeRows = [trainee("student-c", "רון"), trainee("student-a", "אבי")];
  const traineeSnapshot = JSON.parse(JSON.stringify(traineeRows));
  const picker = buildEligibleExamTraineeListView(traineeRows);
  assert.deepEqual(traineeRows, traineeSnapshot, "the trainee input was reordered");
  for (const [index, option] of picker.trainees.entries()) {
    assert.equal(traineeRows.includes(option as never), false, `option ${index} aliases an input`);
  }

  const assignmentRows = [
    assignment({ assignmentId: "assignment-c", orderIndex: 2 }),
    assignment({ assignmentId: "assignment-a", orderIndex: 1 }),
  ];
  const assignmentSnapshot = JSON.parse(JSON.stringify(assignmentRows));
  const list = buildAdminExamAssignmentListView(assignmentRows);
  assert.deepEqual(assignmentRows, assignmentSnapshot, "the assignment input was reordered");
  for (const [index, row] of list.assignments.entries()) {
    assert.equal(
      assignmentRows.includes(row as never),
      false,
      `row ${index} aliases an input`,
    );
  }
});

test("14. a FROZEN input is accepted by both builders", () => {
  const traineeRows = Object.freeze([
    Object.freeze(trainee("student-b", "מיכל")),
    Object.freeze(trainee("student-a", "אבי")),
  ]);
  const assignmentRows = Object.freeze([
    Object.freeze(assignment({ assignmentId: "assignment-b" })),
    Object.freeze(assignment({ assignmentId: "assignment-a" })),
  ]);
  assert.deepEqual(
    buildEligibleExamTraineeListView(traineeRows).trainees.map((o) => o.studentId),
    ["student-a", "student-b"],
  );
  assert.deepEqual(
    buildAdminExamAssignmentListView(assignmentRows).assignments.map((r) => r.assignmentId),
    ["assignment-a", "assignment-b"],
  );
});

// ===========================================================================
// 15–20. The published shapes
// ===========================================================================

test("15. an option carries EXACTLY studentId and fullName", () => {
  const [option] = buildEligibleExamTraineeListView([
    trainee("student-a", "אבי"),
  ]).trainees;
  assert.deepEqual(Object.keys(option).sort(), ["fullName", "studentId"]);
  assert.deepEqual(option, { studentId: "student-a", fullName: "אבי" });
});

test("16. an assignment row carries EXACTLY the eight approved keys", () => {
  // RE-POINTED by EX-ASG-LTD2-B1, and GROWN rather than relaxed: the two stored
  // DETAIL values of an examinee's row join the published shape, and a NINTH key
  // still fails here. Nothing was removed and nothing became optional.
  const [row] = buildAdminExamAssignmentListView([assignment()]).assignments;
  assert.deepEqual(Object.keys(row).sort(), [
    "assignmentId",
    "discipline",
    "horseName",
    "instructionTopic",
    "orderIndex",
    "role",
    "sessionId",
    "traineeName",
  ]);
});

test("17. NO Student.id reaches the assignment DTO", () => {
  const list = buildAdminExamAssignmentListView([
    assignment({ assignmentId: "assignment-a", traineeName: "student-a" }),
  ]);
  for (const row of list.assignments) {
    assert.equal("studentId" in row, false, "the DTO publishes a studentId");
    assert.equal("student" in row, false, "the DTO publishes a student");
  }
  // The input row type has no student id field either, so one cannot arrive.
  const serialized = JSON.stringify(list);
  assert.equal(serialized.includes('"studentId"'), false);
});

test("18. neither view carries personal or scoping data beyond the approved keys", () => {
  const picker = buildEligibleExamTraineeListView([trainee("student-a", "אבי")]);
  const list = buildAdminExamAssignmentListView([assignment()]);
  const keys = new Set<string>();
  for (const entry of [...reachableObjects(picker), ...reachableObjects(list)]) {
    if (Array.isArray(entry)) continue;
    for (const key of Object.keys(entry)) keys.add(key);
  }
  // `studentId` appears ONCE, and only on the picker option, which exists to be
  // submitted back as the create's chosen trainee. Test 17 proves it is absent
  // from the assignment DTO.
  // RE-POINTED by EX-ASG-LTD2-B1: the two stored DETAIL values join the list. They
  // are the ASSIGNMENT's own columns — free text about the exam — and not a fact
  // about a person, which is why the personal and scoping bans below are unchanged.
  assert.deepEqual([...keys].sort(), [
    "assignmentId",
    "assignments",
    "discipline",
    "fullName",
    "horseName",
    "instructionTopic",
    "orderIndex",
    "role",
    "sessionId",
    "studentId",
    "traineeName",
    "trainees",
  ]);
  const assignmentKeys = new Set<string>();
  for (const entry of reachableObjects(list)) {
    if (Array.isArray(entry)) continue;
    for (const key of Object.keys(entry)) assignmentKeys.add(key);
  }
  assert.equal(assignmentKeys.has("studentId"), false, "the assignment view leaks a studentId");
  for (const forbidden of [
    "identityNumber",
    "phone",
    "parentName",
    "parentPhone",
    "groupName",
    "subgroupNumber",
    "enrollmentId",
    "isPrimary",
    "isActive",
    "status",
    "assignedHorseName",
    "privateHorseName",
    "planId",
    "courseOfferingId",
    "createdAt",
    "updatedAt",
    "pairingIndex",
    "sourcePracticeRole",
    "notes",
    "score",
    "grade",
  ]) {
    assert.equal(keys.has(forbidden), false, `the views publish ${forbidden}`);
  }
});

test("19. text is carried VERBATIM — no trim, case fold or normalization", () => {
  const messy = "  אבי  כהן ";
  const picker = buildEligibleExamTraineeListView([trainee("student-a", messy)]);
  assert.equal(picker.trainees[0].fullName, messy);

  const horse = "  Star  ";
  const list = buildAdminExamAssignmentListView([
    assignment({ traineeName: messy, horseName: horse }),
  ]);
  assert.equal(list.assignments[0].traineeName, messy);
  assert.equal(list.assignments[0].horseName, horse);
});

test("20. an absent horse reads as null, never as undefined", () => {
  const list = buildAdminExamAssignmentListView([
    assignment({ assignmentId: "assignment-a", horseName: null }),
    assignment({ assignmentId: "assignment-b", horseName: undefined }),
  ]);
  for (const row of list.assignments) {
    assert.equal(row.horseName, null);
    assert.ok("horseName" in row, "the key vanished instead of reading as null");
  }
  // `undefined` would disappear from the serialized payload rather than
  // round-tripping as "no value".
  assert.ok(JSON.stringify(list).includes('"horseName":null'));
});

// ===========================================================================
// 21–25. Structural guards over the module's own source text
// ===========================================================================

const EXAM_DIR = import.meta.dirname;
const MODULE_NAME = "admin-exam-assignment-read-core.ts";
const TEST_NAME = "admin-exam-assignment-read-core.test.ts";
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

test("21. the pure module declares NO imports at all", () => {
  assert.equal(/(^|\n)\s*import\s/.test(CODE), false, "the module imports something");
  assert.equal(/require\s*\(/.test(CODE), false, "the module uses require");
  assert.equal(/\bfrom\s+"/.test(CODE), false, "the module has a module specifier");
});

test("22. the pure module reaches NO database, auth, framework, env or clock", () => {
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
});

test("23. the pure module performs no write and opens no transaction", () => {
  const writes = /\.(create|createMany|update|updateMany|upsert|delete|deleteMany|aggregate|groupBy|findMany|findFirst|findUnique|count)\s*\(/;
  assert.equal(writes.test(CODE), false, "the pure core issues a query");
  for (const token of ["$transaction", "$executeRaw", "$queryRaw"]) {
    assert.equal(CODE.includes(token), false, `the pure core uses ${token}`);
  }
});

test("24. the module exports exactly the intended surface", () => {
  const functions = [...SOURCE.matchAll(/^export\s+function\s+(\w+)/gm)].map((m) => m[1]);
  assert.deepEqual(functions.sort(), [
    "buildAdminExamAssignmentListView",
    "buildEligibleExamTraineeListView",
    "emptyAdminExamAssignmentListView",
    "emptyEligibleExamTraineeListView",
  ]);
  const values = [...SOURCE.matchAll(/^export\s+const\s+(\w+)/gm)].map((m) => m[1]);
  assert.deepEqual(values, ["UNASSIGNED_EXAM_TRAINEE_NAME"]);
  assert.equal(CODE.includes("export default"), false);
  assert.equal(CODE.includes("export class"), false);
  // Both builders take exactly one argument, and neither takes a dependency bag.
  assert.equal(buildEligibleExamTraineeListView.length, 1);
  assert.equal(buildAdminExamAssignmentListView.length, 1);
  assert.equal(emptyEligibleExamTraineeListView.length, 0);
  assert.equal(emptyAdminExamAssignmentListView.length, 0);

  // The DTO declares the two roles and no third.
  const roles = [...CODE.matchAll(/"(EXAMINEE|INSTRUCTED_TRAINEE)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(roles)].sort(), ["EXAMINEE", "INSTRUCTED_TRAINEE"]);
  // ...and it never filters on one.
  assert.equal(/\.filter\(/.test(CODE), false, "the pure core filters rows");
});

test("25. this slice's lib/exam files are exactly the approved pair, and this suite is DB-free", () => {
  const sliceFiles = readdirSync(EXAM_DIR)
    .filter((name) => name.startsWith("admin-exam-assignment-read"))
    .sort();
  assert.deepEqual(sliceFiles, [MODULE_NAME, TEST_NAME].sort());
  for (const name of sliceFiles) {
    assert.equal(name.endsWith(".tsx"), false, `${name} is a UI file`);
  }

  const own = stripComments(readFileSync(join(EXAM_DIR, TEST_NAME), "utf8"));
  for (const token of [
    PRISMA_MODULE,
    GENERATED_CLIENT,
    ENV_READ,
    "DATABASE" + "_URL",
    "Prisma" + "Client",
  ]) {
    assert.equal(own.includes(token), false, `the suite references ${token}`);
  }
  const specifiers = [...own.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(
    [...new Set(specifiers)].sort(),
    [
      "./admin-exam-assignment-read-core",
      "node:assert/strict",
      "node:fs",
      "node:path",
      "node:test",
    ],
  );
});

// ===========================================================================
// 26–28. EX-ASG-LTD2-B1 — the two stored DETAIL values
// ===========================================================================

test("26. the two detail values are carried VERBATIM, with no fallback text", () => {
  const topic = "  עלייה   וירידה ";
  const branch = "\tרכיבה טיפולית\n";
  const [row] = buildAdminExamAssignmentListView([
    assignment({ instructionTopic: topic, discipline: branch }),
  ]).assignments;
  // Byte-for-byte: no trim, no case fold, no normalization and no substitution.
  assert.equal(row.instructionTopic, topic);
  assert.equal(row.discipline, branch);

  // A value that happens to look like markup is data, not markup: the core is a
  // shaper, so it neither escapes nor rewrites it, and the consumer renders it as
  // a text node.
  const hostile = "<img src=x onerror=alert(1)>";
  const [hostileRow] = buildAdminExamAssignmentListView([
    assignment({ instructionTopic: hostile, discipline: hostile }),
  ]).assignments;
  assert.equal(hostileRow.instructionTopic, hostile);
  assert.equal(hostileRow.discipline, hostile);
});

test("27. an absent detail reads as null, never as undefined and never as text", () => {
  const list = buildAdminExamAssignmentListView([
    assignment({ assignmentId: "assignment-a", instructionTopic: null, discipline: null }),
    assignment({ assignmentId: "assignment-b", instructionTopic: undefined, discipline: undefined }),
  ]);
  for (const row of list.assignments) {
    assert.equal(row.instructionTopic, null);
    assert.equal(row.discipline, null);
    // The keys must SURVIVE as null rather than vanish: `undefined` would
    // disappear from the serialized payload instead of round-tripping as
    // "no value".
    assert.ok("instructionTopic" in row, "the key vanished instead of reading as null");
    assert.ok("discipline" in row, "the key vanished instead of reading as null");
  }
  const serialized = JSON.stringify(list);
  assert.ok(serialized.includes('"instructionTopic":null'));
  assert.ok(serialized.includes('"discipline":null'));

  // NO placeholder is invented for either value. The missing-trainee placeholder
  // is the ONE fixed string this module owns, and it belongs to the name alone.
  assert.equal(serialized.includes(UNASSIGNED_EXAM_TRAINEE_NAME), false);
  assert.equal(CODE.includes("toTraineeName(row.instructionTopic)"), false);
  assert.equal(CODE.includes("toTraineeName(row.discipline)"), false);
});

test("28. the detail values are role-blind, frozen, JSON-safe and non-mutating", () => {
  // NOTHING is filtered or blanked by role here. An INSTRUCTED_TRAINEE row whose
  // stored data is malformed is reported AS IT IS, so the surface that renders it
  // can decide what to say — a core that silently emptied the field would hide the
  // fault instead of exposing it.
  const [instructed] = buildAdminExamAssignmentListView([
    assignment({ role: "INSTRUCTED_TRAINEE", instructionTopic: "נושא", discipline: "ענף" }),
  ]).assignments;
  assert.equal(instructed.role, "INSTRUCTED_TRAINEE");
  assert.equal(instructed.instructionTopic, "נושא");
  assert.equal(instructed.discipline, "ענף");
  assert.equal(/\brole\b[^\n]*===/.test(CODE), false, "the pure core branches on role");

  // The published row stays deeply frozen and JSON-safe with both values present.
  const list = buildAdminExamAssignmentListView([assignment()]);
  assert.ok(isDeeplyFrozen(list));
  assert.deepEqual(JSON.parse(JSON.stringify(list)), list);
  assert.throws(() => {
    (list.assignments[0] as { discipline: string | null }).discipline = "x";
  });

  // ...and the INPUT rows are neither reordered nor rewritten.
  const rows = [
    assignment({ assignmentId: "assignment-c", instructionTopic: "ב" }),
    assignment({ assignmentId: "assignment-a", instructionTopic: null }),
  ];
  const snapshot = JSON.parse(JSON.stringify(rows));
  buildAdminExamAssignmentListView(rows);
  assert.deepEqual(rows, snapshot, "the input rows were mutated");
});
