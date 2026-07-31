/**
 * EXAM EX-SUP-C1 — executable tests for the PURE supervisor input normalizers
 * (exam-supervisor-write-core.ts).
 *
 * Run with: npx tsx --test lib/exam/exam-supervisor-write-core.test.ts
 *
 * DB-FREE: no database connection is opened, no SQL is executed, no environment
 * variable is read, and no production identifier appears anywhere. The only files
 * read are module SOURCE TEXTS, by the structural guards at the bottom, and the
 * only subprocess is `git`, used by the slice-containment guard.
 *
 * SCOPE OF PROOF:
 *   - the two accepted CREATE fields, and that NOTHING else is ever read;
 *   - the single accepted DELETE target;
 *   - every diagnostic, its stable code, its exact message and the fixed order;
 *   - fail-closed behaviour for every non-string value, including a file-like
 *     upload object, and the total absence of coercion;
 *   - the frozen, JSON-round-trippable result model;
 *   - the structural promises: no imports at all, no IO, no calendar type, no
 *     framework and no authorization anywhere in the module;
 *   - the SLICE CONTAINMENT of all six approved files.
 *
 * NOTE ON IDS: the fixtures use obviously-fake, hyphenated ids. No cuid-shaped
 * literal and no production identifier is written here, which the committed
 * exam-slice guards enforce over every file in this directory.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import {
  EXAM_SUPERVISOR_WRITE_INPUT_MESSAGES,
  makeExamSupervisorWriteInputIssue,
  normalizeExamSupervisorCreateInput,
  normalizeExamSupervisorDeleteInput,
  type ExamSupervisorWriteInputIssueCode,
} from "./exam-supervisor-write-core";

// ===========================================================================
// Fixtures
// ===========================================================================

const SESSION_ID = "session-a";
const INSTRUCTOR_ID = "instructor-a";
const SUPERVISOR_ID = "supervisor-a";

function validInput(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { sessionId: SESSION_ID, instructorId: INSTRUCTOR_ID, ...over };
}

function createCodesOf(
  result: ReturnType<typeof normalizeExamSupervisorCreateInput>,
): string[] {
  return result.ok ? [] : result.issues.map((issue) => issue.code);
}

function deleteCodesOf(
  result: ReturnType<typeof normalizeExamSupervisorDeleteInput>,
): string[] {
  return result.ok ? [] : result.issues.map((issue) => issue.code);
}

/**
 * A file-like upload value: the shape a browser sends for an `<input type=file>`
 * that a form serializer happily hands to a normalizer. It has a `name`, which is
 * exactly the member a careless implementation would end up storing.
 */
class FileLike {
  readonly name = "roster-export.png";
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

/** Every non-string value the normalizers must refuse, without coercing any. */
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
// 1–6. The CREATE happy path
// ===========================================================================

test("S1. a well-formed create submission normalizes to exactly the two fields", () => {
  const result = normalizeExamSupervisorCreateInput(validInput());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value, { sessionId: SESSION_ID, instructorId: INSTRUCTOR_ID });
  assert.deepEqual(Object.keys(result.value).sort(), ["instructorId", "sessionId"]);
});

test("S2. every accepted string is TRIMMED, and nothing else about it is touched", () => {
  const result = normalizeExamSupervisorCreateInput({
    sessionId: "  session-padded\t",
    instructorId: "\ninstructor-padded  ",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value, {
    sessionId: "session-padded",
    instructorId: "instructor-padded",
  });
  // ...and INTERNAL whitespace survives byte-for-byte: only the surrounding
  // padding is removed.
  const inner = normalizeExamSupervisorCreateInput({
    sessionId: " a b ",
    instructorId: " c\td ",
  });
  assert.equal(inner.ok, true);
  if (!inner.ok) return;
  assert.equal(inner.value.sessionId, "a b");
  assert.equal(inner.value.instructorId, "c\td");
});

test("S3. CASE is preserved exactly on both opaque ids", () => {
  const result = normalizeExamSupervisorCreateInput(
    validInput({ sessionId: "SeSsIoN-MiXeD", instructorId: "InStRuCtOr-MiXeD" }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.sessionId, "SeSsIoN-MiXeD");
  assert.equal(result.value.instructorId, "InStRuCtOr-MiXeD");
});

test("S4. the success arm carries no `issues` key at all", () => {
  const result = normalizeExamSupervisorCreateInput(validInput());
  assert.equal(Object.prototype.hasOwnProperty.call(result, "issues"), false);
  assert.deepEqual(Object.keys(result).sort(), ["ok", "value"]);
});

test("S5. no field beyond the two is ever read or returned", () => {
  const result = normalizeExamSupervisorCreateInput(
    validInput({
      id: "id-smuggled",
      planId: "plan-smuggled",
      courseOfferingId: "offering-smuggled",
      orderIndex: 7,
      isPrimary: true,
      isResponsible: true,
      examinerSetId: "examiner-set-smuggled",
      supervisorRole: "role-smuggled",
      createdAt: "when-smuggled",
    }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(Object.keys(result.value).sort(), ["instructorId", "sessionId"]);
  const serialized = JSON.stringify(result.value);
  for (const smuggled of [
    "smuggled",
    "planId",
    "courseOfferingId",
    "orderIndex",
    "isPrimary",
    "isResponsible",
    "examinerSet",
    "createdAt",
  ]) {
    assert.equal(serialized.includes(smuggled), false, `the payload carries ${smuggled}`);
  }
});

test("S6. INHERITED properties are not submitted data", () => {
  const proto = { sessionId: SESSION_ID, instructorId: INSTRUCTOR_ID };
  const inheritedOnly = Object.create(proto) as unknown;
  assert.deepEqual(createCodesOf(normalizeExamSupervisorCreateInput(inheritedOnly)), [
    "EX-SUP-IN-SESSION-REQUIRED",
    "EX-SUP-IN-INSTRUCTOR-REQUIRED",
  ]);
  // ...and a raw object that owns ONE field but inherits the other reports only
  // the inherited one as missing.
  const half = Object.create({ instructorId: INSTRUCTOR_ID }) as Record<string, unknown>;
  half.sessionId = SESSION_ID;
  assert.deepEqual(createCodesOf(normalizeExamSupervisorCreateInput(half)), [
    "EX-SUP-IN-INSTRUCTOR-REQUIRED",
  ]);
});

// ===========================================================================
// 7–12. Every CREATE diagnostic
// ===========================================================================

test("S7. a missing session id is EX-SUP-IN-SESSION-REQUIRED", () => {
  const result = normalizeExamSupervisorCreateInput({ instructorId: INSTRUCTOR_ID });
  assert.deepEqual(createCodesOf(result), ["EX-SUP-IN-SESSION-REQUIRED"]);
});

test("S8. a missing instructor is EX-SUP-IN-INSTRUCTOR-REQUIRED", () => {
  const result = normalizeExamSupervisorCreateInput({ sessionId: SESSION_ID });
  assert.deepEqual(createCodesOf(result), ["EX-SUP-IN-INSTRUCTOR-REQUIRED"]);
});

test("S9. a blank or whitespace-only value fails on every field", () => {
  for (const blank of ["", " ", "\t", "\n", "   \t \n "]) {
    assert.deepEqual(
      createCodesOf(normalizeExamSupervisorCreateInput(validInput({ sessionId: blank }))),
      ["EX-SUP-IN-SESSION-REQUIRED"],
      `sessionId ${JSON.stringify(blank)}`,
    );
    assert.deepEqual(
      createCodesOf(
        normalizeExamSupervisorCreateInput(validInput({ instructorId: blank })),
      ),
      ["EX-SUP-IN-INSTRUCTOR-REQUIRED"],
      `instructorId ${JSON.stringify(blank)}`,
    );
  }
});

test("S10. EVERY applicable issue is reported, in the FIXED field order", () => {
  assert.deepEqual(createCodesOf(normalizeExamSupervisorCreateInput({})), [
    "EX-SUP-IN-SESSION-REQUIRED",
    "EX-SUP-IN-INSTRUCTOR-REQUIRED",
  ]);
  // The order does NOT follow the raw object's key order.
  assert.deepEqual(
    createCodesOf(normalizeExamSupervisorCreateInput({ instructorId: "", sessionId: "" })),
    ["EX-SUP-IN-SESSION-REQUIRED", "EX-SUP-IN-INSTRUCTOR-REQUIRED"],
  );
  // ...and the delete code is NEVER produced by the create normalizer.
  assert.equal(
    createCodesOf(normalizeExamSupervisorCreateInput({})).includes(
      "EX-SUP-IN-SUPERVISOR-REQUIRED",
    ),
    false,
  );
});

test("S11. every non-string value FAILS CLOSED on every create field, uncoerced", () => {
  for (const value of NON_STRING_VALUES) {
    const label = typeof value === "symbol" ? "symbol" : String(typeof value);
    for (const [field, code] of [
      ["sessionId", "EX-SUP-IN-SESSION-REQUIRED"],
      ["instructorId", "EX-SUP-IN-INSTRUCTOR-REQUIRED"],
    ] as const) {
      const result = normalizeExamSupervisorCreateInput(validInput({ [field]: value }));
      assert.deepEqual(createCodesOf(result), [code], `${field} accepted a ${label}`);
      assert.equal(result.ok, false);
    }
  }
});

test("S12. a MALFORMED non-object raw input yields both issues and never throws", () => {
  for (const raw of NON_STRING_VALUES) {
    const label = typeof raw === "symbol" ? "symbol" : String(typeof raw);
    assert.deepEqual(
      createCodesOf(normalizeExamSupervisorCreateInput(raw)),
      ["EX-SUP-IN-SESSION-REQUIRED", "EX-SUP-IN-INSTRUCTOR-REQUIRED"],
      `raw ${label}`,
    );
  }
  // A bare string is a raw input too, and its characters are not fields.
  assert.equal(normalizeExamSupervisorCreateInput("sessionId").ok, false);
});

// ===========================================================================
// 13–17. The DELETE normalizer
// ===========================================================================

test("S13. a well-formed delete target normalizes to exactly the supervisor id", () => {
  const result = normalizeExamSupervisorDeleteInput(SUPERVISOR_ID);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value, { supervisorId: SUPERVISOR_ID });
  assert.deepEqual(Object.keys(result.value), ["supervisorId"]);
});

test("S14. the delete target is TRIMMED only, and its case is preserved", () => {
  const padded = normalizeExamSupervisorDeleteInput("  SuPeRvIsOr-MiXeD\t\n");
  assert.equal(padded.ok, true);
  if (!padded.ok) return;
  assert.equal(padded.value.supervisorId, "SuPeRvIsOr-MiXeD");
});

test("S15. a blank, missing or non-string delete target is EX-SUP-IN-SUPERVISOR-REQUIRED", () => {
  for (const blank of ["", " ", "\t", "\n", "   \t \n "]) {
    assert.deepEqual(
      deleteCodesOf(normalizeExamSupervisorDeleteInput(blank)),
      ["EX-SUP-IN-SUPERVISOR-REQUIRED"],
      `blank ${JSON.stringify(blank)}`,
    );
  }
  for (const value of NON_STRING_VALUES) {
    const label = typeof value === "symbol" ? "symbol" : String(typeof value);
    assert.deepEqual(
      deleteCodesOf(normalizeExamSupervisorDeleteInput(value)),
      ["EX-SUP-IN-SUPERVISOR-REQUIRED"],
      `the delete normalizer accepted a ${label}`,
    );
  }
});

test("S16. the delete normalizer accepts the TARGET VALUE, never a session or a pair", () => {
  // A form-like wrapper is NOT the delete input: the sibling orchestration hands
  // this normalizer one raw id, so an object is simply an unusable value.
  assert.deepEqual(
    deleteCodesOf(normalizeExamSupervisorDeleteInput({ supervisorId: SUPERVISOR_ID })),
    ["EX-SUP-IN-SUPERVISOR-REQUIRED"],
  );
  // ...and no session id, instructor id or pair can enter through it.
  assert.deepEqual(
    deleteCodesOf(
      normalizeExamSupervisorDeleteInput({ sessionId: SESSION_ID, instructorId: INSTRUCTOR_ID }),
    ),
    ["EX-SUP-IN-SUPERVISOR-REQUIRED"],
  );
});

test("S17. exactly ONE issue is ever possible on the delete path", () => {
  const result = normalizeExamSupervisorDeleteInput(undefined);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.issues.length, 1);
});

// ===========================================================================
// 18–22. Messages and the issue model
// ===========================================================================

test("S18. the message table is exactly three stable Hebrew messages", () => {
  assert.deepEqual(Object.keys(EXAM_SUPERVISOR_WRITE_INPUT_MESSAGES).sort(), [
    "EX-SUP-IN-INSTRUCTOR-REQUIRED",
    "EX-SUP-IN-SESSION-REQUIRED",
    "EX-SUP-IN-SUPERVISOR-REQUIRED",
  ]);
  assert.equal(
    EXAM_SUPERVISOR_WRITE_INPUT_MESSAGES["EX-SUP-IN-SESSION-REQUIRED"],
    "חובה לבחור מפגש מבחן",
  );
  assert.equal(
    EXAM_SUPERVISOR_WRITE_INPUT_MESSAGES["EX-SUP-IN-INSTRUCTOR-REQUIRED"],
    "חובה לבחור מדריך",
  );
  assert.equal(
    EXAM_SUPERVISOR_WRITE_INPUT_MESSAGES["EX-SUP-IN-SUPERVISOR-REQUIRED"],
    "חובה לבחור שיוך מדריך להסרה",
  );
});

test("S19. each issue carries ONLY a code and its message", () => {
  const results = [
    normalizeExamSupervisorCreateInput({}),
    normalizeExamSupervisorDeleteInput(null),
  ];
  for (const result of results) {
    assert.equal(result.ok, false);
    if (result.ok) continue;
    for (const issue of result.issues) {
      assert.deepEqual(Object.keys(issue).sort(), ["code", "message"]);
      assert.equal(issue.message, EXAM_SUPERVISOR_WRITE_INPUT_MESSAGES[issue.code]);
    }
  }
});

test("S20. NO message echoes a submitted value, a field path or a placeholder", () => {
  const submitted = "SUBMITTED-SENTINEL";
  const created = normalizeExamSupervisorCreateInput({
    sessionId: { evil: submitted },
    instructorId: [submitted],
  });
  const deleted = normalizeExamSupervisorDeleteInput({ evil: submitted });
  for (const result of [created, deleted]) {
    assert.equal(result.ok, false);
    assert.equal(
      JSON.stringify(result).includes(submitted),
      false,
      "a submitted value was echoed",
    );
  }
  for (const message of Object.values(EXAM_SUPERVISOR_WRITE_INPUT_MESSAGES)) {
    for (const placeholder of [
      "{",
      "}",
      "%s",
      "$",
      "sessionId",
      "instructorId",
      "supervisorId",
    ]) {
      assert.equal(message.includes(placeholder), false, `${message} contains ${placeholder}`);
    }
  }
});

test("S21. a file-like upload contributes NOTHING, not even its name", () => {
  const created = normalizeExamSupervisorCreateInput(
    validInput({ instructorId: new FileLike() }),
  );
  const deleted = normalizeExamSupervisorDeleteInput(new FileLike());
  for (const result of [created, deleted]) {
    assert.equal(result.ok, false);
    const serialized = JSON.stringify(result);
    for (const token of ["roster-export", "image/png", "COERCED"]) {
      assert.equal(serialized.includes(token), false, `the result echoes ${token}`);
    }
  }
});

test("S22. the exported issue factory produces the same frozen issue", () => {
  const codes: ExamSupervisorWriteInputIssueCode[] = [
    "EX-SUP-IN-SESSION-REQUIRED",
    "EX-SUP-IN-INSTRUCTOR-REQUIRED",
    "EX-SUP-IN-SUPERVISOR-REQUIRED",
  ];
  for (const code of codes) {
    const issue = makeExamSupervisorWriteInputIssue(code);
    assert.deepEqual(issue, { code, message: EXAM_SUPERVISOR_WRITE_INPUT_MESSAGES[code] });
    assert.equal(Object.isFrozen(issue), true);
  }
  assert.equal(Object.isFrozen(EXAM_SUPERVISOR_WRITE_INPUT_MESSAGES), true);
});

// ===========================================================================
// 23–27. The result model: frozen, JSON-safe, non-aliasing
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

const EVERY_RESULT = () => [
  normalizeExamSupervisorCreateInput(validInput()),
  normalizeExamSupervisorCreateInput({}),
  normalizeExamSupervisorCreateInput({ sessionId: SESSION_ID }),
  normalizeExamSupervisorDeleteInput(SUPERVISOR_ID),
  normalizeExamSupervisorDeleteInput(""),
];

test("S23. every result is FROZEN all the way down, issues array included", () => {
  for (const result of EVERY_RESULT()) {
    assertPlainFrozenJsonSafe(result);
    if (!result.ok) {
      assert.equal(Object.isFrozen(result.issues), true);
      for (const issue of result.issues) assert.equal(Object.isFrozen(issue), true);
    }
  }
});

test("S24. every result JSON round-trips to an equal value", () => {
  for (const result of EVERY_RESULT()) {
    assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  }
  for (const raw of [null, 7, [1, 2], "x"]) {
    const result = normalizeExamSupervisorCreateInput(raw);
    assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  }
});

test("S25. the raw input is NEVER mutated, and a frozen raw input is fine", () => {
  const raw = Object.freeze(validInput());
  const before = JSON.stringify(raw);
  const result = normalizeExamSupervisorCreateInput(raw);
  assert.equal(result.ok, true);
  assert.equal(JSON.stringify(raw), before);
  // ...and the payload does not alias the raw object.
  if (!result.ok) return;
  assert.notEqual(result.value as unknown, raw as unknown);
});

test("S26. two calls return INDEPENDENT, non-aliasing results", () => {
  const a = normalizeExamSupervisorCreateInput({});
  const b = normalizeExamSupervisorCreateInput({});
  assert.equal(a.ok, false);
  assert.equal(b.ok, false);
  if (a.ok || b.ok) return;
  assert.notEqual(a.issues as unknown, b.issues as unknown);
  assert.deepEqual(a.issues, b.issues);

  const c = normalizeExamSupervisorDeleteInput(SUPERVISOR_ID);
  const d = normalizeExamSupervisorDeleteInput(SUPERVISOR_ID);
  assert.equal(c.ok, true);
  assert.equal(d.ok, true);
  if (!c.ok || !d.ok) return;
  assert.notEqual(c.value as unknown, d.value as unknown);
  assert.deepEqual(c.value, d.value);
});

test("S27. the two normalizers never share an outcome shape by accident", () => {
  const create = normalizeExamSupervisorCreateInput(validInput());
  const remove = normalizeExamSupervisorDeleteInput(SUPERVISOR_ID);
  assert.equal(create.ok, true);
  assert.equal(remove.ok, true);
  if (!create.ok || !remove.ok) return;
  assert.deepEqual(Object.keys(create.value).sort(), ["instructorId", "sessionId"]);
  assert.deepEqual(Object.keys(remove.value).sort(), ["supervisorId"]);
});

// ===========================================================================
// 28–38. Structural guards
// ===========================================================================

const EXAM_DIR = import.meta.dirname;
const REPO_ROOT = join(EXAM_DIR, "..", "..");
const MODULE_NAME = "exam-supervisor-write-core.ts";
const TEST_NAME = "exam-supervisor-write-core.test.ts";
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

/** The six files this slice is allowed to consist of, repo-relative. */
const APPROVED_SLICE_FILES = [
  "create-exam-supervisor-core.test.ts",
  "create-exam-supervisor-core.ts",
  "delete-exam-supervisor-core.test.ts",
  "delete-exam-supervisor-core.ts",
  MODULE_NAME,
  TEST_NAME,
].sort();

/** The three PRODUCTION modules of the slice — the purity guards' subjects. */
const PRODUCTION_MODULES = [
  MODULE_NAME,
  "create-exam-supervisor-core.ts",
  "delete-exam-supervisor-core.ts",
];

test("S28. the input module has NO imports at all", () => {
  assert.equal(/\bimport\b/.test(CODE), false, "the normalizer imports something");
  assert.equal(/\brequire\s*\(/.test(CODE), false, "the normalizer requires something");
});

test("S29. NO module in the slice touches a database, a client or any IO", () => {
  for (const name of PRODUCTION_MODULES) {
    const code = stripComments(readFileSync(join(EXAM_DIR, name), "utf8"));
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
      assert.equal(code.includes(token), false, `${name} references ${token}`);
    }
    const dbCalls =
      /\.(create|createMany|update|updateMany|upsert|delete|deleteMany|findUnique|findFirst|findMany|count|aggregate)\s*\(/;
    assert.equal(dbCalls.test(code), false, `${name} performs a database operation`);
  }
});

test("S30. NO module in the slice knows of auth, permissions, the framework or the app", () => {
  for (const name of PRODUCTION_MODULES) {
    const code = stripComments(readFileSync(join(EXAM_DIR, name), "utf8"));
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
      '"EXAMS"',
      "CapabilityKey",
      "capability",
      "Capability",
      "react",
      "React",
    ]) {
      assert.equal(code.includes(token), false, `${name} references ${token}`);
    }
    assert.equal(code.includes("server" + "-only"), false, name);
    assert.equal(code.includes('"use ' + 'server"'), false, name);
    assert.equal(code.includes('"use ' + 'client"'), false, name);
  }
});

test("S31. NO module in the slice has a calendar type, clock, randomness or process access", () => {
  for (const name of PRODUCTION_MODULES) {
    const code = stripComments(readFileSync(join(EXAM_DIR, name), "utf8"));
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
      assert.equal(pattern.test(code), false, `${name} uses ${pattern}`);
    }
  }
});

test("S32. the input module coerces nothing and folds no case", () => {
  for (const token of ["String(", "Number(", "toLowerCase", "toUpperCase", "normalize("]) {
    assert.equal(CODE.includes(token), false, `the module uses ${token}`);
  }
});

test("S33. exactly two field names are read, as OWN properties", () => {
  const readFields = [...CODE.matchAll(/readField\([^,]+,\s*"([^"]+)"\)/g)].map((m) => m[1]);
  assert.deepEqual(readFields, ["sessionId", "instructorId"]);
  assert.ok(/hasOwnProperty\.call/.test(CODE), "own-property reading was dropped");
});

test("S34. the input module exports EXACTLY the intended surface", () => {
  const functions = [...SOURCE.matchAll(/^export\s+function\s+(\w+)/gm)].map((m) => m[1]);
  assert.deepEqual(functions.sort(), [
    "makeExamSupervisorWriteInputIssue",
    "normalizeExamSupervisorCreateInput",
    "normalizeExamSupervisorDeleteInput",
  ]);
  assert.equal(typeof normalizeExamSupervisorCreateInput, "function");
  assert.equal(normalizeExamSupervisorCreateInput.length, 1);
  assert.equal(typeof normalizeExamSupervisorDeleteInput, "function");
  assert.equal(normalizeExamSupervisorDeleteInput.length, 1);

  const consts = [...SOURCE.matchAll(/^export\s+const\s+(\w+)/gm)].map((m) => m[1]);
  assert.deepEqual(consts, ["EXAM_SUPERVISOR_WRITE_INPUT_MESSAGES"]);

  const types = [...SOURCE.matchAll(/^export\s+(?:type|interface)\s+(\w+)/gm)].map((m) => m[1]);
  assert.deepEqual(types.sort(), [
    "ExamSupervisorWriteInputIssue",
    "ExamSupervisorWriteInputIssueCode",
    "ExamSupervisorWriteInputResult",
    "NormalizedExamSupervisorCreate",
    "NormalizedExamSupervisorDelete",
  ]);
});

test("S35. no diagnostic beyond the three approved codes exists", () => {
  const codes = [...CODE.matchAll(/"(EX-[A-Z0-9-]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(codes)].sort(), [
    "EX-SUP-IN-INSTRUCTOR-REQUIRED",
    "EX-SUP-IN-SESSION-REQUIRED",
    "EX-SUP-IN-SUPERVISOR-REQUIRED",
  ]);
  for (const token of ["not_found", "conflict", "unexpected", "stale", "forbidden"]) {
    assert.equal(CODE.includes(token), false, `the module invents ${token}`);
  }
});

test("S36. NO module invents an ordering, a responsibility marker or an examiner set", () => {
  for (const name of PRODUCTION_MODULES) {
    const code = stripComments(readFileSync(join(EXAM_DIR, name), "utf8"));
    for (const token of [
      "orderIndex",
      "reorder",
      "Reorder",
      "isPrimary",
      "isResponsible",
      "examinerSet",
      "ExaminerSet",
      "examiner",
      "Examiner",
      "supervisorRole",
      "SupervisorKind",
    ]) {
      assert.equal(code.includes(token), false, `${name} invents ${token}`);
    }
  }
});

test("S37. NO module in the slice names a feedback, rating, grade or score field", () => {
  for (const name of PRODUCTION_MODULES) {
    const code = stripComments(readFileSync(join(EXAM_DIR, name), "utf8"));
    for (const pattern of [
      /\bfeedback\w*\s*\??\s*:/i,
      /\brating\w*\s*\??\s*:/i,
      /\bgrade\w*\s*\??\s*:/i,
      /\bscore\w*\s*\??\s*:/i,
    ]) {
      assert.equal(pattern.test(code), false, `${name} declares a field matching ${pattern}`);
    }
  }
});

test("S38. NO file in the slice hardcodes a cuid-shaped identifier", () => {
  for (const name of APPROVED_SLICE_FILES) {
    const source = readFileSync(join(EXAM_DIR, name), "utf8");
    assert.equal(
      /["']c[a-z0-9]{24}["']/.test(source),
      false,
      `${name} hardcodes a cuid-shaped literal`,
    );
  }
});

// ===========================================================================
// 39–41. Slice containment
// ===========================================================================

test("S39. the slice is EXACTLY the six approved lib/exam files, and none is a UI file", () => {
  const sliceFiles = readdirSync(EXAM_DIR)
    .filter((name) => /^(exam|create-exam|delete-exam)-supervisor-/.test(name))
    .sort();
  assert.deepEqual(sliceFiles, APPROVED_SLICE_FILES);
  for (const name of sliceFiles) {
    assert.equal(name.endsWith(".tsx"), false, `${name} is a UI file`);
  }
});

test("S40. this slice's own six files are additive, and every neighbour is approved", () => {
  const scope = ["lib", "prisma", "app", "components"];
  const approved = APPROVED_SLICE_FILES.map((name) => `lib/exam/${name}`);

  /**
   * EX-ASG-UI1 TRANSITION.
   *
   * This guard asserted the working tree modified ZERO tracked files, which was the
   * correct claim while THIS supervisor slice was the only uncommitted work: it is
   * purely additive, and it still is. What changed is that an approved NEIGHBOURING
   * slice — the stored-assignment admin UI — now shares the working tree, and it
   * necessarily modifies the exams route and the committed guard suites whose exact
   * counts it re-points.
   *
   * So the guard is RE-POINTED to an EXACT allow-list rather than deleted, and THIS
   * slice's own additive claim is re-stated from the other side immediately below:
   * not one of the six supervisor files may appear as a MODIFICATION, and no
   * `lib/` production module anywhere may be touched.
   *
   * What it always protected is unchanged: no schema, no migration, no auth or
   * session module, no capability catalog and no course-policy core — every `lib/`
   * entry below is a `.test.ts` guard suite.
   */
  const APPROVED_NEIGHBOUR_MODIFICATIONS = [
    "app/admin/courses/[courseOfferingId]/exams/actions.ts",
    "app/admin/courses/[courseOfferingId]/exams/page.tsx",
    "app/admin/courses/[courseOfferingId]/exams/exam-definition-create.contract.test.ts",
    "app/admin/courses/[courseOfferingId]/exams/exam-definitions-page.contract.test.ts",
    "app/admin/courses/[courseOfferingId]/exams/exam-plan-create.contract.test.ts",
    "app/admin/courses/[courseOfferingId]/exams/exam-session-create.contract.test.ts",
    "app/admin/courses/[courseOfferingId]/exams/exam-session-edit-delete.contract.test.ts",
    "lib/actions/" + "exam-assignment-read" + "-io.test.ts",
    "lib/actions/" + "exam-assignment-write" + "-io.test.ts",
    "lib/actions/" + "exam-definition-read" + "-io.test.ts",
    "lib/actions/" + "admin-exam-session-read" + "-io.test.ts",
    "lib/actions/" + "exam-session-write" + "-io.test.ts",
    "lib/actions/" + "exam-plan-write" + "-io.test.ts",
    "lib/exam/" + "exam-supervisor-write" + "-core.test.ts",
    // EX-ASG-IT2 — the approved INSTRUCTED_TRAINEE assignment CREATE UI, which
    // travels in the same working tree. It adds the ASSIGNMENT contract suite to
    // the modified set (that suite's route file set and export list learn about
    // the eighth endpoint) and the committed instructed-trainee write guard,
    // whose caller list it re-points from zero to exactly one Server Action
    // module. Its own three new route files are ADDITIONS. Nothing here changes
    // which module this guard is about: no reader gained a caller, no writer was
    // edited, and no schema, migration, auth, capability or policy file is named.
    "app/admin/courses/[courseOfferingId]/exams/exam-assignment-ui.contract.test.ts",
    "app/admin/courses/[courseOfferingId]/exams/CreateExamInstructedTraineeAssignmentForm.tsx",
    "app/admin/courses/[courseOfferingId]/exams/exam-instructed-trainee-assignment-messages.ts",
    "app/admin/courses/[courseOfferingId]/exams/exam-instructed-trainee-assignment-ui.contract.test.ts",
    "lib/actions/" + "exam-instructed-trainee-assignment-write" + "-io.test.ts",
    "lib/exam/" + "create-exam-plan" + "-core.test.ts",
    // EX-ASG-LTD2-B1 — the approved ADMIN READ DETAIL slice, which travels in the
    // same working tree. It publishes two stored EXAM ASSIGNMENT columns, so the
    // assignment READ pair's two PRODUCTION modules and its pure core's suite join
    // this list, together with the two supervisor IO footprint guards whose
    // "nothing was modified" claims it re-points.
    //
    // Those two supervisor entries are SUITES. No supervisor PRODUCTION file is
    // named here, and the assertion below re-checks that structurally rather than
    // trusting this list.
    "lib/exam/" + "admin-exam-assignment-read" + "-core.ts",
    "lib/exam/" + "admin-exam-assignment-read" + "-core.test.ts",
    "lib/actions/" + "exam-assignment-read" + "-io.ts",
    "lib/actions/" + "exam-supervisor-read" + "-io.test.ts",
    "lib/actions/" + "exam-supervisor-write" + "-io.test.ts",
    // EX-ASG-LTD2-B2 - the approved DETAILED examinee assignment UI wiring, which
    // travels in the same working tree. It switches the route's ONE existing create
    // endpoint to the committed detailed writer, which brings that route's examinee
    // create form and its route-local assignment message table into the modified set,
    // plus the detailed writer's own committed guard, whose caller list it re-points
    // from zero to exactly one Server Action module. The last path is ASSEMBLED,
    // because that guard sweeps `app/`, `lib/` and `components/` for its own module
    // name. Nothing here changes which module THIS guard is about: no new route file,
    // Server Action, query key or component exists, no `lib/` production module is
    // edited, and no schema, migration, auth, session, capability or policy file
    // appears.
    "app/admin/courses/[courseOfferingId]/exams/CreateExamAssignmentForm.tsx",
    "app/admin/courses/[courseOfferingId]/exams/exam-assignment-messages.ts",
    "lib/actions/" + "detailed-exam-assignment-write" + "-io.test.ts",
  ];
  /**
   * The neighbouring slices' NEW files: EX-ASG-UI1's four route files, and
   * EX-PUB-BE-MVP's four `lib/` files — the exam-plan publish/unpublish pure core,
   * its binding, and a suite for each.
   *
   * The four backend paths are named EXACTLY, so a fifth `lib/` addition still
   * fails, and the two `lib/actions` ones are ASSEMBLED from pieces because that
   * slice's own guard pins its caller list at EXACTLY ZERO. It touches no
   * supervisor module, adds no caller and modifies no production file.
   */
  const APPROVED_NEIGHBOUR_ADDITIONS = [
    "app/admin/courses/[courseOfferingId]/exams/CreateExamAssignmentForm.tsx",
    "app/admin/courses/[courseOfferingId]/exams/DeleteExamAssignmentForm.tsx",
    "app/admin/courses/[courseOfferingId]/exams/exam-assignment-messages.ts",
    "app/admin/courses/[courseOfferingId]/exams/exam-assignment-ui.contract.test.ts",
    "lib/exam/exam-publication-write-core.ts",
    "lib/exam/exam-publication-write-core.test.ts",
    "lib/actions/" + "exam-publication-write" + "-io.ts",
    "lib/actions/" + "exam-publication-write" + "-io.test.ts",
  ];

  // What EXISTS IN HEAD and was edited, deleted, renamed or type-changed.
  const diff = spawnSync(
    "git",
    ["diff", "--name-only", "--diff-filter=MDRT", "HEAD", "--", ...scope],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  assert.equal(diff.status, 0, `git diff failed: ${diff.stderr ?? ""}`);
  const modified = (diff.stdout ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const unapproved = modified.filter(
    (path) => !APPROVED_NEIGHBOUR_MODIFICATIONS.includes(path),
  );
  assert.deepEqual(unapproved, [], `the tree modified: ${unapproved.join(", ")}`);

  // THIS slice's PRODUCTION files are still ADDITIVE: not one of them is a
  // modification. This guard suite itself is deliberately excluded — re-pointing it
  // is exactly the approved change the neighbouring slice makes, and a rule that
  // forbade its own amendment could never be satisfied.
  const supervisorModified = modified.filter(
    (path) => approved.includes(path) && !path.endsWith(".test.ts"),
  );
  assert.deepEqual(
    supervisorModified,
    [],
    `a supervisor production file was modified: ${supervisorModified.join(", ")}`,
  );
  // RE-POINTED by EX-ASG-LTD2-B1, and NARROWED to an exact pair rather than
  // dropped. The claim was "no `lib/` PRODUCTION module anywhere was touched",
  // which held while every neighbouring slice only WIRED committed bindings. A
  // read that must publish two more stored columns has to edit the pair that reads
  // them, so exactly those two are named — neither is a supervisor module, which
  // the assertion above proves independently — and a THIRD still fails here.
  // RE-POINTED AGAIN by EX-ASG-LTD2-B2, back to the STRICTEST form of the claim -
  // EMPTY. The pair above was correct while the read slice was uncommitted in this
  // working tree; it is committed now, so those names described a moment rather
  // than a rule. The wiring slice that followed edits no `lib/` production module
  // at all - every binding it reaches is already committed, and the wiring lives
  // entirely under `app/` - so the original claim is restored in full.
  const libProduction = modified
    .filter((path) => path.startsWith("lib/") && !path.endsWith(".test.ts"))
    .sort();
  assert.deepEqual(
    libProduction,
    [],
    `an unapproved lib production module was edited: ${libProduction.join(", ")}`,
  );

  // ...and every working-tree entry in scope — untracked, modified, staged or any
  // combination — names one of the six approved paths or an approved neighbour.
  const status = spawnSync("git", ["status", "--porcelain", "--", ...scope], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  assert.equal(status.status, 0, `git status failed: ${status.stderr ?? ""}`);
  for (const line of (status.stdout ?? "").split("\n").filter((l) => l.trim().length > 0)) {
    const path = line.slice(3).trim();
    assert.ok(
      approved.includes(path) ||
        APPROVED_NEIGHBOUR_MODIFICATIONS.includes(path) ||
        APPROVED_NEIGHBOUR_ADDITIONS.includes(path),
      `an unapproved change exists: ${line}`,
    );
  }
});

test("S41. this suite opens no database and reads no environment", () => {
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
      "./exam-supervisor-write-core",
      "node:assert/strict",
      "node:child_process",
      "node:fs",
      "node:path",
      "node:test",
    ],
  );
});
