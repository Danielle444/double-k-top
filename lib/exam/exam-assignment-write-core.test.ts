/**
 * EXAM EX-ASG-C1 — executable tests for the PURE examinee-assignment input
 * normalizer (exam-assignment-write-core.ts).
 *
 * Run with: npx tsx --test lib/exam/exam-assignment-write-core.test.ts
 *
 * DB-FREE: no database connection is opened, no SQL is executed, no environment
 * variable is read, and no production identifier appears anywhere. The only files
 * read are module SOURCE TEXTS, by the structural guards at the bottom.
 *
 * SCOPE OF PROOF:
 *   - the three accepted fields, and that NOTHING else is ever read;
 *   - every diagnostic, its stable code, its exact message and the fixed order;
 *   - fail-closed behaviour for every non-string value, including a file-like
 *     upload object, and the total absence of coercion;
 *   - the frozen, JSON-round-trippable result model;
 *   - the structural promises: no imports at all, no IO, no calendar type, no
 *     framework and no authorization anywhere in the module.
 *
 * NOTE ON IDS: the fixtures use obviously-fake, hyphenated ids. No production
 * identifier is written here, which the committed exam-slice guards enforce over
 * every file in this directory.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  EXAM_ASSIGNMENT_WRITE_INPUT_MESSAGES,
  makeExamAssignmentWriteInputIssue,
  normalizeExamAssignmentCreateInput,
  type ExamAssignmentWriteInputIssueCode,
} from "./exam-assignment-write-core";

// ===========================================================================
// Fixtures
// ===========================================================================

const SESSION_ID = "session-as-submitted";
const STUDENT_ID = "student-as-submitted";
const HORSE_NAME = "סוסה";

function validInput(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { sessionId: SESSION_ID, studentId: STUDENT_ID, horseName: HORSE_NAME, ...over };
}

function codesOf(result: ReturnType<typeof normalizeExamAssignmentCreateInput>): string[] {
  return result.ok ? [] : result.issues.map((issue) => issue.code);
}

/**
 * A file-like upload value: the shape a browser sends for an `<input type=file>`
 * that a form serializer happily hands to a normalizer. It has a `name`, which is
 * exactly the member a careless implementation would end up storing.
 */
class FileLike {
  readonly name = "horse-photo.png";
  readonly size = 1;
  readonly type = "image/png";
  toString(): string {
    return "COERCED-FILE-NAME";
  }
}

/** A value whose `toString` would produce a plausible-looking id. */
class CoercibleId {
  toString(): string {
    return "COERCED-ID";
  }
}

/** Every non-string value the normalizer must refuse, without coercing any. */
const NON_STRING_VALUES: readonly unknown[] = [
  null,
  undefined,
  0,
  1,
  -0,
  Number.NaN,
  true,
  false,
  [],
  ["a"],
  {},
  { toString: () => "COERCED-OBJECT" },
  new FileLike(),
  new CoercibleId(),
  () => "COERCED-FUNCTION",
  Symbol("s"),
  BigInt(10),
];

// ===========================================================================
// 1–6. The happy path
// ===========================================================================

test("1. a well-formed submission normalizes to exactly the three fields", () => {
  const result = normalizeExamAssignmentCreateInput(validInput());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value, {
    sessionId: SESSION_ID,
    studentId: STUDENT_ID,
    horseName: HORSE_NAME,
  });
  assert.deepEqual(Object.keys(result.value).sort(), ["horseName", "sessionId", "studentId"]);
});

test("2. every accepted string is trimmed, and nothing else about it is touched", () => {
  const result = normalizeExamAssignmentCreateInput({
    sessionId: "  session-padded\t",
    studentId: "\nstudent-padded  ",
    horseName: "  כוכב הצפון  ",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value, {
    sessionId: "session-padded",
    studentId: "student-padded",
    // Internal whitespace and every non-ASCII character survive byte-for-byte.
    horseName: "כוכב הצפון",
  });
});

test("3. case is preserved exactly on both opaque ids", () => {
  const result = normalizeExamAssignmentCreateInput(
    validInput({ sessionId: "SeSsIoN-MiXeD", studentId: "StUdEnT-MiXeD" }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.sessionId, "SeSsIoN-MiXeD");
  assert.equal(result.value.studentId, "StUdEnT-MiXeD");
});

test("4. the success arm carries no `issues` key at all", () => {
  const result = normalizeExamAssignmentCreateInput(validInput());
  assert.equal(Object.prototype.hasOwnProperty.call(result, "issues"), false);
  assert.deepEqual(Object.keys(result).sort(), ["ok", "value"]);
});

test("5. no field beyond the three is ever read or returned", () => {
  const result = normalizeExamAssignmentCreateInput(
    validInput({
      role: "INSTRUCTED_TRAINEE",
      orderIndex: 7,
      planId: "plan-smuggled",
      courseOfferingId: "offering-smuggled",
      definitionId: "definition-smuggled",
      instructionTopic: "topic-smuggled",
      discipline: "discipline-smuggled",
      pairingIndex: 3,
      notes: "notes-smuggled",
      id: "id-smuggled",
      sourcePracticeRole: "role-smuggled",
    }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(Object.keys(result.value).sort(), ["horseName", "sessionId", "studentId"]);
  const serialized = JSON.stringify(result.value);
  for (const smuggled of [
    "smuggled",
    "role",
    "orderIndex",
    "planId",
    "courseOfferingId",
    "definitionId",
    "instructionTopic",
    "discipline",
    "pairingIndex",
    "notes",
  ]) {
    assert.equal(serialized.includes(smuggled), false, `the payload carries ${smuggled}`);
  }
});

test("6. INHERITED properties are not submitted data", () => {
  const proto = { sessionId: SESSION_ID, studentId: STUDENT_ID, horseName: HORSE_NAME };
  const inheritedOnly = Object.create(proto) as unknown;
  assert.deepEqual(codesOf(normalizeExamAssignmentCreateInput(inheritedOnly)), [
    "EX-ASG-IN-SESSION-REQUIRED",
    "EX-ASG-IN-STUDENT-REQUIRED",
    "EX-ASG-IN-HORSE-REQUIRED",
  ]);
});

// ===========================================================================
// 7–14. Every diagnostic
// ===========================================================================

test("7. a missing session id is EX-ASG-IN-SESSION-REQUIRED", () => {
  const result = normalizeExamAssignmentCreateInput({
    studentId: STUDENT_ID,
    horseName: HORSE_NAME,
  });
  assert.deepEqual(codesOf(result), ["EX-ASG-IN-SESSION-REQUIRED"]);
});

test("8. a missing trainee is EX-ASG-IN-STUDENT-REQUIRED", () => {
  const result = normalizeExamAssignmentCreateInput({
    sessionId: SESSION_ID,
    horseName: HORSE_NAME,
  });
  assert.deepEqual(codesOf(result), ["EX-ASG-IN-STUDENT-REQUIRED"]);
});

test("9. a missing horse is EX-ASG-IN-HORSE-REQUIRED", () => {
  const result = normalizeExamAssignmentCreateInput({
    sessionId: SESSION_ID,
    studentId: STUDENT_ID,
  });
  assert.deepEqual(codesOf(result), ["EX-ASG-IN-HORSE-REQUIRED"]);
});

test("10. a blank or whitespace-only value fails on every field", () => {
  for (const blank of ["", " ", "\t", "\n", "   \t \n "]) {
    assert.deepEqual(
      codesOf(normalizeExamAssignmentCreateInput(validInput({ sessionId: blank }))),
      ["EX-ASG-IN-SESSION-REQUIRED"],
      `sessionId ${JSON.stringify(blank)}`,
    );
    assert.deepEqual(
      codesOf(normalizeExamAssignmentCreateInput(validInput({ studentId: blank }))),
      ["EX-ASG-IN-STUDENT-REQUIRED"],
      `studentId ${JSON.stringify(blank)}`,
    );
    assert.deepEqual(
      codesOf(normalizeExamAssignmentCreateInput(validInput({ horseName: blank }))),
      ["EX-ASG-IN-HORSE-REQUIRED"],
      `horseName ${JSON.stringify(blank)}`,
    );
  }
});

test("11. EVERY applicable issue is reported, in the fixed field order", () => {
  assert.deepEqual(codesOf(normalizeExamAssignmentCreateInput({})), [
    "EX-ASG-IN-SESSION-REQUIRED",
    "EX-ASG-IN-STUDENT-REQUIRED",
    "EX-ASG-IN-HORSE-REQUIRED",
  ]);
  // The order does NOT follow the raw object's key order.
  assert.deepEqual(
    codesOf(
      normalizeExamAssignmentCreateInput({ horseName: "", studentId: "", sessionId: "" }),
    ),
    [
      "EX-ASG-IN-SESSION-REQUIRED",
      "EX-ASG-IN-STUDENT-REQUIRED",
      "EX-ASG-IN-HORSE-REQUIRED",
    ],
  );
  // ...and a partial failure reports exactly its own two.
  assert.deepEqual(
    codesOf(normalizeExamAssignmentCreateInput({ studentId: STUDENT_ID })),
    ["EX-ASG-IN-SESSION-REQUIRED", "EX-ASG-IN-HORSE-REQUIRED"],
  );
});

test("12. every non-string value FAILS CLOSED on every field, uncoerced", () => {
  for (const value of NON_STRING_VALUES) {
    const label = typeof value === "symbol" ? "symbol" : String(typeof value);
    for (const [field, code] of [
      ["sessionId", "EX-ASG-IN-SESSION-REQUIRED"],
      ["studentId", "EX-ASG-IN-STUDENT-REQUIRED"],
      ["horseName", "EX-ASG-IN-HORSE-REQUIRED"],
    ] as const) {
      const result = normalizeExamAssignmentCreateInput(validInput({ [field]: value }));
      assert.deepEqual(codesOf(result), [code], `${field} accepted a ${label}`);
      assert.equal(result.ok, false);
    }
  }
});

test("13. a file-like upload contributes NOTHING, not even its name", () => {
  const result = normalizeExamAssignmentCreateInput(validInput({ horseName: new FileLike() }));
  assert.equal(result.ok, false);
  const serialized = JSON.stringify(result);
  for (const token of ["horse-photo", "image/png", "COERCED"]) {
    assert.equal(serialized.includes(token), false, `the result echoes ${token}`);
  }
});

test("14. a non-object raw input yields all three issues, and never throws", () => {
  for (const raw of NON_STRING_VALUES) {
    const label = typeof raw === "symbol" ? "symbol" : String(typeof raw);
    assert.deepEqual(
      codesOf(normalizeExamAssignmentCreateInput(raw)),
      [
        "EX-ASG-IN-SESSION-REQUIRED",
        "EX-ASG-IN-STUDENT-REQUIRED",
        "EX-ASG-IN-HORSE-REQUIRED",
      ],
      `raw ${label}`,
    );
  }
  // A bare string is a raw input too, and its characters are not fields.
  assert.equal(normalizeExamAssignmentCreateInput("sessionId").ok, false);
});

// ===========================================================================
// 15–19. Messages and the issue model
// ===========================================================================

test("15. the message table is exactly three stable Hebrew messages", () => {
  assert.deepEqual(Object.keys(EXAM_ASSIGNMENT_WRITE_INPUT_MESSAGES).sort(), [
    "EX-ASG-IN-HORSE-REQUIRED",
    "EX-ASG-IN-SESSION-REQUIRED",
    "EX-ASG-IN-STUDENT-REQUIRED",
  ]);
  assert.equal(
    EXAM_ASSIGNMENT_WRITE_INPUT_MESSAGES["EX-ASG-IN-SESSION-REQUIRED"],
    "חובה לבחור מפגש מבחן",
  );
  assert.equal(
    EXAM_ASSIGNMENT_WRITE_INPUT_MESSAGES["EX-ASG-IN-STUDENT-REQUIRED"],
    "חובה לבחור חניך",
  );
  assert.equal(
    EXAM_ASSIGNMENT_WRITE_INPUT_MESSAGES["EX-ASG-IN-HORSE-REQUIRED"],
    "חובה לציין סוס עבור הנבחן",
  );
});

test("16. each issue carries ONLY a code and its message", () => {
  const result = normalizeExamAssignmentCreateInput({});
  assert.equal(result.ok, false);
  if (result.ok) return;
  for (const issue of result.issues) {
    assert.deepEqual(Object.keys(issue).sort(), ["code", "message"]);
    assert.equal(issue.message, EXAM_ASSIGNMENT_WRITE_INPUT_MESSAGES[issue.code]);
  }
});

test("17. no message echoes a submitted value, a field path or a placeholder", () => {
  const submitted = "SUBMITTED-SENTINEL";
  const result = normalizeExamAssignmentCreateInput({
    sessionId: { evil: submitted },
    studentId: [submitted],
    horseName: 42,
  });
  assert.equal(result.ok, false);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(submitted), false, "a submitted value was echoed");
  for (const message of Object.values(EXAM_ASSIGNMENT_WRITE_INPUT_MESSAGES)) {
    for (const placeholder of ["{", "}", "%s", "$", "sessionId", "studentId", "horseName"]) {
      assert.equal(message.includes(placeholder), false, `${message} contains ${placeholder}`);
    }
  }
});

test("18. the exported issue factory produces the same frozen issue", () => {
  const codes: ExamAssignmentWriteInputIssueCode[] = [
    "EX-ASG-IN-SESSION-REQUIRED",
    "EX-ASG-IN-STUDENT-REQUIRED",
    "EX-ASG-IN-HORSE-REQUIRED",
  ];
  for (const code of codes) {
    const issue = makeExamAssignmentWriteInputIssue(code);
    assert.deepEqual(issue, { code, message: EXAM_ASSIGNMENT_WRITE_INPUT_MESSAGES[code] });
    assert.equal(Object.isFrozen(issue), true);
  }
});

test("19. the message table itself is frozen", () => {
  assert.equal(Object.isFrozen(EXAM_ASSIGNMENT_WRITE_INPUT_MESSAGES), true);
});

// ===========================================================================
// 20–24. The result model: frozen, JSON-safe, non-aliasing
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

test("20. a success result is frozen all the way down", () => {
  const result = normalizeExamAssignmentCreateInput(validInput());
  assertPlainFrozenJsonSafe(result);
});

test("21. a failure result and its issues array are frozen all the way down", () => {
  const result = normalizeExamAssignmentCreateInput({});
  assertPlainFrozenJsonSafe(result);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(Object.isFrozen(result.issues), true);
  for (const issue of result.issues) assert.equal(Object.isFrozen(issue), true);
});

test("22. every result JSON round-trips to an equal value", () => {
  for (const raw of [validInput(), {}, { sessionId: SESSION_ID }, null, 7, [1, 2]]) {
    const result = normalizeExamAssignmentCreateInput(raw);
    assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  }
});

test("23. the raw input is never mutated, and a frozen raw input is fine", () => {
  const raw = Object.freeze(validInput());
  const before = JSON.stringify(raw);
  const result = normalizeExamAssignmentCreateInput(raw);
  assert.equal(result.ok, true);
  assert.equal(JSON.stringify(raw), before);
  // ...and the payload does not alias the raw object.
  if (!result.ok) return;
  assert.notEqual(result.value as unknown, raw as unknown);
});

test("24. two calls return independent, non-aliasing results", () => {
  const a = normalizeExamAssignmentCreateInput({});
  const b = normalizeExamAssignmentCreateInput({});
  assert.equal(a.ok, false);
  assert.equal(b.ok, false);
  if (a.ok || b.ok) return;
  assert.notEqual(a.issues as unknown, b.issues as unknown);
  assert.deepEqual(a.issues, b.issues);
});

// ===========================================================================
// 25–33. Structural guards
// ===========================================================================

const EXAM_DIR = import.meta.dirname;
const MODULE_NAME = "exam-assignment-write-core.ts";
const TEST_NAME = "exam-assignment-write-core.test.ts";
const SOURCE = readFileSync(join(EXAM_DIR, MODULE_NAME), "utf8");

/** Strip comments so the guards assert on CODE, not on explanatory prose. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const CODE = stripComments(SOURCE);

/**
 * Forbidden specifiers, assembled from SPLIT LITERALS: the committed exam-slice
 * guards scan every file in this directory for these exact tokens, and spelling
 * one out here would make this suite trip them.
 */
const PRISMA_MODULE = ["@/lib", "prisma"].join("/");
const GENERATED_CLIENT = ["@prisma", "client"].join("/");
const ENV_READ = ["process", "env"].join(".");

test("25. the module has NO imports at all", () => {
  assert.equal(/\bimport\b/.test(CODE), false, "the normalizer imports something");
  assert.equal(/\brequire\s*\(/.test(CODE), false, "the normalizer requires something");
});

test("26. the module performs no IO and touches no database", () => {
  for (const token of [
    PRISMA_MODULE,
    GENERATED_CLIENT,
    "$transaction",
    "$queryRaw",
    "readFile",
    "writeFile",
    "fetch(",
    ENV_READ,
  ]) {
    assert.equal(CODE.includes(token), false, `the module references ${token}`);
  }
  const dbCalls =
    /\.(create|createMany|update|updateMany|upsert|delete|deleteMany|findUnique|findFirst|findMany|count|aggregate)\s*\(/;
  assert.equal(dbCalls.test(CODE), false, "the module performs a database operation");
});

test("27. the module knows nothing of auth, capability, the framework or the app", () => {
  for (const token of [
    "lib/auth",
    "lib/course",
    "lib/actions",
    "@/app",
    "next/",
    "next-auth",
    "cookies(",
    "requireAdmin",
    "requireCourseContext",
    "CapabilityKey",
    "capability",
    "Capability",
    "react",
    "React",
  ]) {
    assert.equal(CODE.includes(token), false, `the module references ${token}`);
  }
  assert.equal(CODE.includes("server" + "-only"), false);
  assert.equal(CODE.includes('"use ' + 'server"'), false);
  assert.equal(CODE.includes('"use ' + 'client"'), false);
});

test("28. the module has NO calendar type, clock, randomness or process access", () => {
  for (const pattern of [
    /\bDate\b/,
    /Date\.now\b/,
    /Math\.random\b/,
    /process\./,
    /globalThis/,
    /\bIntl\b/,
    /localeCompare/,
    /toISOString/,
  ]) {
    assert.equal(pattern.test(CODE), false, `the module uses ${pattern}`);
  }
});

test("29. the module coerces nothing and folds no case", () => {
  for (const token of ["String(", "Number(", "toLowerCase", "toUpperCase", "normalize("]) {
    assert.equal(CODE.includes(token), false, `the module uses ${token}`);
  }
});

test("30. exactly three field names are read, and they are read as own properties", () => {
  const readFields = [...CODE.matchAll(/readField\([^,]+,\s*"([^"]+)"\)/g)].map((m) => m[1]);
  assert.deepEqual(readFields, ["sessionId", "studentId", "horseName"]);
  assert.ok(/hasOwnProperty\.call/.test(CODE), "own-property reading was dropped");
});

test("31. the module exports exactly the intended surface", () => {
  const functions = [...SOURCE.matchAll(/^export\s+function\s+(\w+)/gm)].map((m) => m[1]);
  assert.deepEqual(functions.sort(), [
    "makeExamAssignmentWriteInputIssue",
    "normalizeExamAssignmentCreateInput",
  ]);
  assert.equal(typeof normalizeExamAssignmentCreateInput, "function");
  assert.equal(normalizeExamAssignmentCreateInput.length, 1);
});

test("32. no code beyond the three approved diagnostics exists", () => {
  const codes = [...CODE.matchAll(/"(EX-[A-Z0-9-]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(codes)].sort(), [
    "EX-ASG-IN-HORSE-REQUIRED",
    "EX-ASG-IN-SESSION-REQUIRED",
    "EX-ASG-IN-STUDENT-REQUIRED",
  ]);
  for (const token of ["not_found", "conflict", "unexpected", "stale", "forbidden"]) {
    assert.equal(CODE.includes(token), false, `the module invents ${token}`);
  }
});

test("33. the slice is EXACTLY six lib/exam files, and none is a UI file", () => {
  const sliceFiles = readdirSync(EXAM_DIR)
    .filter((name) => /^(exam|create-exam|delete-exam)-assignment-/.test(name))
    .sort();
  assert.deepEqual(sliceFiles, [
    "create-exam-assignment-core.test.ts",
    "create-exam-assignment-core.ts",
    "delete-exam-assignment-core.test.ts",
    "delete-exam-assignment-core.ts",
    MODULE_NAME,
    TEST_NAME,
  ].sort());
  for (const name of sliceFiles) assert.equal(name.endsWith(".tsx"), false, `${name} is a UI file`);
});

test("34. this suite opens no database and reads no environment", () => {
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
    ["./exam-assignment-write-core", "node:assert/strict", "node:fs", "node:path", "node:test"],
  );
});
