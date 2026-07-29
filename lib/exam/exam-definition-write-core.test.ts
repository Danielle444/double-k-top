/**
 * EXAM EX-S5B-1 — executable tests for the PURE ExamDefinition write-input core
 * (exam-definition-write-core.ts).
 *
 * Run with: npx tsx --test lib/exam/exam-definition-write-core.test.ts
 *
 * PURE: no Prisma, no DB, no clock, no randomness, no env. The only file read
 * is the module's own SOURCE TEXT, by the structural guards at the bottom.
 *
 * SCOPE OF PROOF:
 *   - create normalization: trimming, strict flag coercion, uncoerced numbers,
 *     unknown-key exclusion, and full delegation of every domain rule;
 *   - edit normalization: the authoritative server-supplied kind, the structural
 *     impossibility of writing a kind, and the refusal of a submitted one;
 *   - the result model: plain JSON, frozen, deterministic, non-echoing;
 *   - the structural promises: no IO, no auth, no capability, no write method,
 *     no unapproved bound, no case folding, and exactly two files in the slice.
 *
 * NOTE ON NAMES: several definitions may legitimately share one `ExamKind` —
 * "רכיבה" and "ממשק" are both INTERFACE_RIDING and must stay distinct — so no
 * test here couples a name to a kind, and no exam name is hardcoded as canonical.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import type { ExamKind } from "./exam-domain-core";
import {
  EXAM_DEFINITION_WRITE_INPUT_MESSAGES,
  normalizeExamDefinitionCreateInput,
  normalizeExamDefinitionEditInput,
  type ExamDefinitionWriteInputIssue,
  type ExamDefinitionWriteInputResult,
} from "./exam-definition-write-core";

// --- fixtures ---------------------------------------------------------------

const STORABLE_KINDS: readonly ExamKind[] = [
  "INTERFACE_RIDING",
  "LUNGE_NO_RIDER",
  "ADVANCED_INSTRUCTION",
];

const CREATE_FIELDS = [
  "name",
  "kind",
  "durationMinutes",
  "parallelCapacity",
  "requiresInstructedTrainee",
  "requiresLessonTopic",
  "requiresDiscipline",
] as const;

const EDIT_FIELDS = [
  "name",
  "durationMinutes",
  "parallelCapacity",
  "requiresInstructedTrainee",
  "requiresLessonTopic",
  "requiresDiscipline",
] as const;

/** A raw create submission with every field valid; override to break one. */
function rawCreate(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "רכיבה",
    kind: "INTERFACE_RIDING",
    durationMinutes: 20,
    parallelCapacity: 2,
    requiresInstructedTrainee: false,
    requiresLessonTopic: false,
    requiresDiscipline: false,
    ...over,
  };
}

/** A raw edit submission with every field valid; override to break one. */
function rawEdit(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "ממשק",
    durationMinutes: 15,
    parallelCapacity: 3,
    requiresInstructedTrainee: false,
    requiresLessonTopic: false,
    requiresDiscipline: false,
    ...over,
  };
}

function codesOf(result: ExamDefinitionWriteInputResult<unknown>): readonly string[] {
  return result.ok ? [] : result.issues.map((issue) => issue.code);
}

function expectOk<T>(result: ExamDefinitionWriteInputResult<T>): T {
  assert.equal(result.ok, true, `expected ok, got ${JSON.stringify(codesOf(result))}`);
  if (!result.ok) throw new Error("unreachable");
  return result.value;
}

function expectIssues(
  result: ExamDefinitionWriteInputResult<unknown>,
): readonly ExamDefinitionWriteInputIssue[] {
  assert.equal(result.ok, false, "expected failure, got ok");
  if (result.ok) throw new Error("unreachable");
  return result.issues;
}

// ===========================================================================
// GROUP A — create: the happy paths (1-6)
// ===========================================================================

test("A1. a valid INTERFACE_RIDING submission normalizes to exactly the seven fields", () => {
  const value = expectOk(normalizeExamDefinitionCreateInput(rawCreate()));
  assert.deepEqual(value, {
    name: "רכיבה",
    kind: "INTERFACE_RIDING",
    durationMinutes: 20,
    parallelCapacity: 2,
    requiresInstructedTrainee: false,
    requiresLessonTopic: false,
    requiresDiscipline: false,
  });
});

test("A2. a valid ADVANCED_INSTRUCTION submission normalizes, including both advanced flags", () => {
  const value = expectOk(
    normalizeExamDefinitionCreateInput(
      rawCreate({
        name: "הדרכת מתקדמים",
        kind: "ADVANCED_INSTRUCTION",
        requiresInstructedTrainee: true,
        requiresLessonTopic: true,
        requiresDiscipline: true,
      }),
    ),
  );
  assert.equal(value.kind, "ADVANCED_INSTRUCTION");
  assert.equal(value.requiresInstructedTrainee, true);
  assert.equal(value.requiresLessonTopic, true);
  assert.equal(value.requiresDiscipline, true);
});

test("A3. a valid LUNGE_NO_RIDER submission normalizes", () => {
  const value = expectOk(
    normalizeExamDefinitionCreateInput(
      rawCreate({ name: "לונז'ה", kind: "LUNGE_NO_RIDER", durationMinutes: 10 }),
    ),
  );
  assert.equal(value.kind, "LUNGE_NO_RIDER");
  assert.equal(value.durationMinutes, 10);
});

test("A4. two DIFFERENT names sharing ONE kind both validate and stay distinct", () => {
  // The locked product rule: "רכיבה" and "ממשק" are both INTERFACE_RIDING and
  // must remain two separate exams. Nothing in this core couples name to kind.
  const riding = expectOk(
    normalizeExamDefinitionCreateInput(rawCreate({ name: "רכיבה", kind: "INTERFACE_RIDING" })),
  );
  const interfaceExam = expectOk(
    normalizeExamDefinitionCreateInput(rawCreate({ name: "ממשק", kind: "INTERFACE_RIDING" })),
  );
  assert.equal(riding.kind, interfaceExam.kind);
  assert.notEqual(riding.name, interfaceExam.name);
  assert.equal(riding.name, "רכיבה");
  assert.equal(interfaceExam.name, "ממשק");
});

test("A5. surrounding whitespace on the name is trimmed", () => {
  for (const raw of ["  רכיבה", "רכיבה  ", "\t\n רכיבה \r\n", " רכיבה "]) {
    const value = expectOk(normalizeExamDefinitionCreateInput(rawCreate({ name: raw })));
    assert.equal(value.name, "רכיבה");
  }
});

test("A6. everything except surrounding whitespace survives byte-for-byte", () => {
  // Internal spacing, mixed scripts, punctuation, digits, an emoji and a
  // combining mark: no normalize(), no case folding, no collapsing.
  const exact = "מבחן  רכיבה — Level 2 (א'/ב') ✓ café́";
  const value = expectOk(normalizeExamDefinitionCreateInput(rawCreate({ name: `  ${exact}  ` })));
  assert.equal(value.name, exact);
  assert.equal([...value.name].length, [...exact].length);

  // Case is preserved in both directions — nothing is lowercased or uppercased.
  const mixed = expectOk(normalizeExamDefinitionCreateInput(rawCreate({ name: "MiXeD CaSe" })));
  assert.equal(mixed.name, "MiXeD CaSe");
});

// ===========================================================================
// GROUP B — create: the name rule is delegated (7-9)
// ===========================================================================

test("B1. a blank name is rejected with the committed name diagnostic", () => {
  assert.deepEqual(codesOf(normalizeExamDefinitionCreateInput(rawCreate({ name: "" }))), [
    "EX-DEF-NAME-REQUIRED",
  ]);
});

test("B2. a whitespace-only name is rejected (trim happens BEFORE the rule)", () => {
  for (const blank of [" ", "   ", "\t", "\n", "\r\n\t  "]) {
    assert.deepEqual(codesOf(normalizeExamDefinitionCreateInput(rawCreate({ name: blank }))), [
      "EX-DEF-NAME-REQUIRED",
    ]);
  }
});

test("B3. a missing or non-string name is rejected", () => {
  const missing = rawCreate();
  delete missing.name;
  assert.deepEqual(codesOf(normalizeExamDefinitionCreateInput(missing)), ["EX-DEF-NAME-REQUIRED"]);

  for (const bad of [null, undefined, 42, true, {}, [], ["רכיבה"], Symbol("x")]) {
    assert.deepEqual(
      codesOf(normalizeExamDefinitionCreateInput(rawCreate({ name: bad }))),
      ["EX-DEF-NAME-REQUIRED"],
      `non-string name ${String(bad)} was accepted`,
    );
  }
});

test("B4. a non-object raw input reads as entirely absent, never throws", () => {
  for (const raw of [null, undefined, "רכיבה", 7, true, [], Symbol("x")]) {
    const result = normalizeExamDefinitionCreateInput(raw);
    assert.equal(result.ok, false);
    assert.deepEqual(codesOf(result), [
      "EX-DEF-NAME-REQUIRED",
      "EX-DEF-KIND-NOT-STORABLE",
      "EX-DEF-INVALID-DURATION",
      "EX-DEF-INVALID-CAPACITY",
    ]);
  }
});

// ===========================================================================
// GROUP C — create: the kind rule is delegated (10-12)
// ===========================================================================

test("C1. BEGINNER_INSTRUCTION is rejected — it is never a stored definition kind", () => {
  assert.deepEqual(
    codesOf(normalizeExamDefinitionCreateInput(rawCreate({ kind: "BEGINNER_INSTRUCTION" }))),
    ["EX-DEF-KIND-NOT-STORABLE"],
  );
});

test("C2. an arbitrary free-string kind is rejected", () => {
  for (const bad of [
    "",
    " ",
    "RIDING",
    "interface_riding",
    "INTERFACE_RIDING ",
    " INTERFACE_RIDING",
    "רכיבה",
    "ADVANCED",
  ]) {
    assert.deepEqual(
      codesOf(normalizeExamDefinitionCreateInput(rawCreate({ kind: bad }))),
      ["EX-DEF-KIND-NOT-STORABLE"],
      `free-string kind ${JSON.stringify(bad)} was accepted`,
    );
  }
});

test("C3. null and prototype-shaped kind tokens are rejected", () => {
  for (const bad of [
    null,
    undefined,
    0,
    1,
    true,
    {},
    [],
    "__proto__",
    "constructor",
    "toString",
    "hasOwnProperty",
    "valueOf",
    "prototype",
  ]) {
    assert.deepEqual(
      codesOf(normalizeExamDefinitionCreateInput(rawCreate({ kind: bad }))),
      ["EX-DEF-KIND-NOT-STORABLE"],
      `prototype-shaped kind ${String(bad)} was accepted`,
    );
  }

  // ...and an INHERITED kind is not a submitted kind: a prototype carrying a
  // valid token must not be read as if the client had sent it.
  const inherited = Object.create({ kind: "INTERFACE_RIDING" }) as Record<string, unknown>;
  inherited.name = "רכיבה";
  inherited.durationMinutes = 20;
  inherited.parallelCapacity = 2;
  assert.deepEqual(codesOf(normalizeExamDefinitionCreateInput(inherited)), [
    "EX-DEF-KIND-NOT-STORABLE",
  ]);
});

// ===========================================================================
// GROUP D — create: the numeric rules are delegated and NOTHING is coerced (13-19)
// ===========================================================================

test("D1. a zero duration is rejected", () => {
  assert.deepEqual(codesOf(normalizeExamDefinitionCreateInput(rawCreate({ durationMinutes: 0 }))), [
    "EX-DEF-INVALID-DURATION",
  ]);
  assert.deepEqual(codesOf(normalizeExamDefinitionCreateInput(rawCreate({ durationMinutes: -0 }))), [
    "EX-DEF-INVALID-DURATION",
  ]);
});

test("D2. a negative duration is rejected", () => {
  for (const bad of [-1, -20, -0.5, Number.MIN_SAFE_INTEGER]) {
    assert.deepEqual(
      codesOf(normalizeExamDefinitionCreateInput(rawCreate({ durationMinutes: bad }))),
      ["EX-DEF-INVALID-DURATION"],
      `negative duration ${bad} was accepted`,
    );
  }
});

test("D3. a fractional duration is rejected", () => {
  for (const bad of [0.5, 1.5, 20.000001, 19.999]) {
    assert.deepEqual(
      codesOf(normalizeExamDefinitionCreateInput(rawCreate({ durationMinutes: bad }))),
      ["EX-DEF-INVALID-DURATION"],
      `fractional duration ${bad} was accepted`,
    );
  }
});

test("D4. NaN and Infinity are rejected for duration", () => {
  for (const bad of [NaN, Infinity, -Infinity, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(
      codesOf(normalizeExamDefinitionCreateInput(rawCreate({ durationMinutes: bad }))),
      ["EX-DEF-INVALID-DURATION"],
      `non-finite duration ${String(bad)} was accepted`,
    );
  }
});

test("D5. a NUMERIC-STRING duration is rejected, never coerced", () => {
  // The whole point: "30" must not silently become 30. A form that submits a
  // string is a form that has not been parsed, and guessing would hide that.
  for (const bad of ["30", "20", " 20 ", "0", "-5", "20.5", "1e3", ""]) {
    assert.deepEqual(
      codesOf(normalizeExamDefinitionCreateInput(rawCreate({ durationMinutes: bad }))),
      ["EX-DEF-INVALID-DURATION"],
      `numeric-string duration ${JSON.stringify(bad)} was coerced`,
    );
  }
  // Non-numbers of every other shape too.
  for (const bad of [null, undefined, true, {}, [], [20]]) {
    assert.deepEqual(
      codesOf(normalizeExamDefinitionCreateInput(rawCreate({ durationMinutes: bad }))),
      ["EX-DEF-INVALID-DURATION"],
      `non-number duration ${String(bad)} was accepted`,
    );
  }
});

test("D6. a zero capacity is rejected", () => {
  assert.deepEqual(
    codesOf(normalizeExamDefinitionCreateInput(rawCreate({ parallelCapacity: 0 }))),
    ["EX-DEF-INVALID-CAPACITY"],
  );
});

test("D7. negative, fractional and string capacities are rejected, never coerced", () => {
  for (const bad of [-1, -3, 0.5, 2.5, "2", " 2 ", "", NaN, Infinity, null, undefined, true, {}, [2]]) {
    assert.deepEqual(
      codesOf(normalizeExamDefinitionCreateInput(rawCreate({ parallelCapacity: bad }))),
      ["EX-DEF-INVALID-CAPACITY"],
      `capacity ${String(bad)} was accepted`,
    );
  }
});

test("D8. a large positive integer is accepted — no upper bound is imposed", () => {
  // No maximum is approved in this slice; an unapproved ceiling would silently
  // reject a legitimate configuration.
  const value = expectOk(
    normalizeExamDefinitionCreateInput(
      rawCreate({ durationMinutes: 100000, parallelCapacity: 9999 }),
    ),
  );
  assert.equal(value.durationMinutes, 100000);
  assert.equal(value.parallelCapacity, 9999);

  // ...and a very long name is accepted for the same reason.
  const longName = "מ".repeat(5000);
  assert.equal(expectOk(normalizeExamDefinitionCreateInput(rawCreate({ name: longName }))).name, longName);
});

// ===========================================================================
// GROUP E — create: the requires* flags (20-23)
// ===========================================================================

test("E1. requiresLessonTopic applicability is DELEGATED to the committed validator", () => {
  for (const kind of ["INTERFACE_RIDING", "LUNGE_NO_RIDER"] as const) {
    assert.deepEqual(
      codesOf(normalizeExamDefinitionCreateInput(rawCreate({ kind, requiresLessonTopic: true }))),
      ["EX-DEF-TOPIC-NOT-APPLICABLE"],
    );
  }
  // Permitted for the one kind that can satisfy it.
  const ok = expectOk(
    normalizeExamDefinitionCreateInput(
      rawCreate({ kind: "ADVANCED_INSTRUCTION", requiresLessonTopic: true }),
    ),
  );
  assert.equal(ok.requiresLessonTopic, true);
});

test("E2. requiresInstructedTrainee applicability is DELEGATED to the committed validator", () => {
  for (const kind of ["INTERFACE_RIDING", "LUNGE_NO_RIDER"] as const) {
    assert.deepEqual(
      codesOf(
        normalizeExamDefinitionCreateInput(rawCreate({ kind, requiresInstructedTrainee: true })),
      ),
      ["EX-DEF-INSTRUCTED-NOT-APPLICABLE"],
    );
  }
  const ok = expectOk(
    normalizeExamDefinitionCreateInput(
      rawCreate({ kind: "ADVANCED_INSTRUCTION", requiresInstructedTrainee: true }),
    ),
  );
  assert.equal(ok.requiresInstructedTrainee, true);
});

test("E3. requiresDiscipline is permitted on EVERY storable kind", () => {
  for (const kind of STORABLE_KINDS) {
    const value = expectOk(
      normalizeExamDefinitionCreateInput(rawCreate({ kind, requiresDiscipline: true })),
    );
    assert.equal(value.requiresDiscipline, true);
    assert.equal(value.kind, kind);
  }
});

test("E4. a flag is true ONLY for the literal boolean true", () => {
  const truthyButNotTrue = ["true", "TRUE", "on", "1", 1, -1, [], {}, "false", " "];
  for (const raw of truthyButNotTrue) {
    const value = expectOk(
      normalizeExamDefinitionCreateInput(
        rawCreate({
          kind: "ADVANCED_INSTRUCTION",
          requiresInstructedTrainee: raw,
          requiresLessonTopic: raw,
          requiresDiscipline: raw,
        }),
      ),
    );
    assert.equal(value.requiresInstructedTrainee, false, `${String(raw)} switched a flag on`);
    assert.equal(value.requiresLessonTopic, false, `${String(raw)} switched a flag on`);
    assert.equal(value.requiresDiscipline, false, `${String(raw)} switched a flag on`);
  }

  // Falsy non-booleans and absence normalize to false too — always a boolean.
  const absent = rawCreate();
  delete absent.requiresInstructedTrainee;
  delete absent.requiresLessonTopic;
  delete absent.requiresDiscipline;
  const value = expectOk(normalizeExamDefinitionCreateInput(absent));
  assert.equal(value.requiresInstructedTrainee, false);
  assert.equal(value.requiresLessonTopic, false);
  assert.equal(value.requiresDiscipline, false);
});

// ===========================================================================
// GROUP F — create: the payload boundary (24-25)
// ===========================================================================

test("F1. unknown extra keys never enter the normalized payload", () => {
  const value = expectOk(
    normalizeExamDefinitionCreateInput(
      rawCreate({
        id: "def-1",
        planId: "plan-1",
        courseOfferingId: "off-1",
        definitionId: "def-1",
        orderIndex: 7,
        createdAt: "2026-07-29T00:00:00.000Z",
        updatedAt: "2026-07-29T00:00:00.000Z",
        publishedAt: "2026-07-29T00:00:00.000Z",
        expectedUpdatedAt: 1,
        sessionCount: 3,
        actorId: "admin-1",
        studentId: "stu-1",
        instructorId: "ins-1",
        __proto__: { polluted: true },
      }),
    ),
  );
  assert.deepEqual(Object.keys(value).sort(), [...CREATE_FIELDS].sort());
  for (const forbidden of [
    "id",
    "planId",
    "courseOfferingId",
    "definitionId",
    "orderIndex",
    "createdAt",
    "updatedAt",
    "publishedAt",
    "expectedUpdatedAt",
    "sessionCount",
    "actorId",
    "studentId",
    "instructorId",
  ]) {
    assert.equal(forbidden in value, false, `${forbidden} leaked into the payload`);
  }
  assert.equal(JSON.stringify(value).includes("plan-1"), false);
  assert.equal(JSON.stringify(value).includes("admin-1"), false);
});

test("F2. orderIndex is never accepted and never returned, and never changes the outcome", () => {
  const without = normalizeExamDefinitionCreateInput(rawCreate());
  for (const submitted of [0, 7, -3, "9", null, undefined, {}]) {
    const withOrder = normalizeExamDefinitionCreateInput(rawCreate({ orderIndex: submitted }));
    assert.deepEqual(withOrder, without, `orderIndex ${String(submitted)} changed the result`);
    assert.equal("orderIndex" in expectOk(withOrder), false);
  }
});

// ===========================================================================
// GROUP G — the result model (26-32)
// ===========================================================================

test("G1. the raw input object is never mutated", () => {
  for (const raw of [rawCreate(), rawCreate({ name: "  x  ", durationMinutes: "30", kind: "NOPE" })]) {
    const before = JSON.parse(JSON.stringify(raw)) as unknown;
    normalizeExamDefinitionCreateInput(raw);
    assert.deepEqual(JSON.parse(JSON.stringify(raw)), before);
  }
});

test("G2. a FROZEN raw input is fully supported", () => {
  const frozen = Object.freeze(rawCreate({ name: "  רכיבה  " }));
  const value = expectOk(normalizeExamDefinitionCreateInput(frozen));
  assert.equal(value.name, "רכיבה");
  assert.equal(Object.isFrozen(frozen), true);

  const frozenBad = Object.freeze(rawCreate({ durationMinutes: "30" }));
  assert.deepEqual(codesOf(normalizeExamDefinitionCreateInput(frozenBad)), [
    "EX-DEF-INVALID-DURATION",
  ]);
});

test("G3. results, values and issue lists are frozen", () => {
  const ok = normalizeExamDefinitionCreateInput(rawCreate());
  assert.equal(Object.isFrozen(ok), true);
  assert.equal(Object.isFrozen(expectOk(ok)), true);

  const bad = normalizeExamDefinitionCreateInput(rawCreate({ name: "" }));
  assert.equal(Object.isFrozen(bad), true);
  const issues = expectIssues(bad);
  assert.equal(Object.isFrozen(issues), true);
  for (const issue of issues) assert.equal(Object.isFrozen(issue), true);
});

test("G4. every result is plain JSON and survives a round trip deep-equal", () => {
  const results: ExamDefinitionWriteInputResult<unknown>[] = [
    normalizeExamDefinitionCreateInput(rawCreate()),
    normalizeExamDefinitionCreateInput(rawCreate({ name: "", durationMinutes: "30" })),
    normalizeExamDefinitionEditInput(rawEdit(), "ADVANCED_INSTRUCTION"),
    normalizeExamDefinitionEditInput(rawEdit({ kind: "LUNGE_NO_RIDER" }), "ADVANCED_INSTRUCTION"),
  ];
  for (const result of results) {
    const roundTripped = JSON.parse(JSON.stringify(result)) as unknown;
    assert.deepEqual(roundTripped, result);
  }
});

test("G5. no undefined value, and no Date/Map/Set/Error/class instance, appears anywhere", () => {
  const results: ExamDefinitionWriteInputResult<unknown>[] = [
    normalizeExamDefinitionCreateInput(rawCreate()),
    normalizeExamDefinitionCreateInput(rawCreate({ kind: "BEGINNER_INSTRUCTION" })),
    normalizeExamDefinitionEditInput(rawEdit(), "INTERFACE_RIDING"),
    normalizeExamDefinitionEditInput(rawEdit({ kind: "INTERFACE_RIDING" }), "INTERFACE_RIDING"),
  ];

  function walk(node: unknown, path: string): void {
    assert.notEqual(node, undefined, `${path} is undefined`);
    if (node === null) return;
    if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") return;
    assert.equal(node instanceof Date, false, `${path} is a Date`);
    assert.equal(node instanceof Map, false, `${path} is a Map`);
    assert.equal(node instanceof Set, false, `${path} is a Set`);
    assert.equal(node instanceof Error, false, `${path} is an Error`);
    assert.notEqual(typeof node, "bigint", `${path} is a BigInt`);
    assert.notEqual(typeof node, "function", `${path} is a function`);
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    assert.equal(
      Object.getPrototypeOf(node),
      Object.prototype,
      `${path} is a class instance, not a plain object`,
    );
    for (const [key, item] of Object.entries(node as Record<string, unknown>)) {
      walk(item, `${path}.${key}`);
    }
  }

  for (const [index, result] of results.entries()) walk(result, `result[${index}]`);
});

test("G6. the success arm carries no issues key, and the failure arm no value key", () => {
  const ok = normalizeExamDefinitionCreateInput(rawCreate());
  assert.deepEqual(Object.keys(ok).sort(), ["ok", "value"]);

  const bad = normalizeExamDefinitionCreateInput(rawCreate({ name: "" }));
  assert.deepEqual(Object.keys(bad).sort(), ["issues", "ok"]);
});

test("G7. issue ordering is deterministic and matches the committed validator order", () => {
  const everythingWrong = {
    name: "  ",
    kind: "NOT-A-KIND",
    durationMinutes: "30",
    parallelCapacity: -1,
    requiresInstructedTrainee: true,
    requiresLessonTopic: true,
    requiresDiscipline: true,
  };
  const expected = [
    "EX-DEF-NAME-REQUIRED",
    "EX-DEF-KIND-NOT-STORABLE",
    "EX-DEF-INVALID-DURATION",
    "EX-DEF-INVALID-CAPACITY",
    "EX-DEF-INSTRUCTED-NOT-APPLICABLE",
    "EX-DEF-TOPIC-NOT-APPLICABLE",
  ];
  assert.deepEqual(codesOf(normalizeExamDefinitionCreateInput(everythingWrong)), expected);

  // Same input, repeated: identical order and identical content, every time.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.deepEqual(
      normalizeExamDefinitionCreateInput(everythingWrong),
      normalizeExamDefinitionCreateInput(everythingWrong),
    );
  }

  // Every issue carries a non-empty message and nothing else.
  for (const issue of expectIssues(normalizeExamDefinitionCreateInput(everythingWrong))) {
    assert.deepEqual(Object.keys(issue).sort(), ["code", "message"]);
    assert.equal(typeof issue.message, "string");
    assert.ok(issue.message.length > 0);
  }
});

test("G8. a rejected raw value is NEVER echoed in a diagnostic", () => {
  const marker = "MARKER-VALUE-THAT-MUST-NOT-LEAK";
  const result = normalizeExamDefinitionCreateInput({
    name: `   `,
    kind: `${marker}-KIND`,
    durationMinutes: `${marker}-DURATION`,
    parallelCapacity: { secret: `${marker}-CAPACITY` },
    requiresLessonTopic: `${marker}-FLAG`,
    id: `${marker}-ID`,
  });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(marker), false, "a raw value leaked into a diagnostic");
  assert.equal(serialized.includes("secret"), false);
  assert.ok(codesOf(result).length > 0);
});

// ===========================================================================
// GROUP H — edit: the authoritative kind (33-39)
// ===========================================================================

test("H1. a valid edit normalizes under the server-supplied authoritative kind", () => {
  const value = expectOk(normalizeExamDefinitionEditInput(rawEdit(), "INTERFACE_RIDING"));
  assert.deepEqual(value, {
    name: "ממשק",
    durationMinutes: 15,
    parallelCapacity: 3,
    requiresInstructedTrainee: false,
    requiresLessonTopic: false,
    requiresDiscipline: false,
  });
});

test("H2. the edit payload exposes NO writable kind", () => {
  const value = expectOk(normalizeExamDefinitionEditInput(rawEdit(), "ADVANCED_INSTRUCTION"));
  assert.deepEqual(Object.keys(value).sort(), [...EDIT_FIELDS].sort());
  assert.equal("kind" in value, false, "the edit payload carries a kind");
  assert.equal(JSON.stringify(value).includes("ADVANCED_INSTRUCTION"), false);
});

test("H3. a submitted kind is REJECTED, even when it equals the authoritative kind", () => {
  const result = normalizeExamDefinitionEditInput(
    rawEdit({ kind: "INTERFACE_RIDING" }),
    "INTERFACE_RIDING",
  );
  assert.deepEqual(codesOf(result), ["EX-DEF-KIND-NOT-EDITABLE"]);
  assert.equal(
    expectIssues(result)[0].message,
    EXAM_DEFINITION_WRITE_INPUT_MESSAGES["EX-DEF-KIND-NOT-EDITABLE"],
  );

  // Presence is what is refused — any value, including null/undefined.
  for (const submitted of [null, undefined, "", 0, false, {}]) {
    assert.deepEqual(
      codesOf(normalizeExamDefinitionEditInput(rawEdit({ kind: submitted }), "INTERFACE_RIDING")),
      ["EX-DEF-KIND-NOT-EDITABLE"],
      `a kind property of ${String(submitted)} was tolerated`,
    );
  }

  // An INHERITED kind is not a submission and must not be refused.
  const inherited = Object.create({ kind: "LUNGE_NO_RIDER" }) as Record<string, unknown>;
  Object.assign(inherited, rawEdit());
  assert.equal(normalizeExamDefinitionEditInput(inherited, "INTERFACE_RIDING").ok, true);
});

test("H4. a submitted BEGINNER_INSTRUCTION cannot override the authoritative kind", () => {
  const result = normalizeExamDefinitionEditInput(
    rawEdit({ kind: "BEGINNER_INSTRUCTION" }),
    "ADVANCED_INSTRUCTION",
  );
  // Refused for being submitted at all — and NOT reported as an unstorable kind,
  // which proves the raw value never reached the validator as the exam's kind.
  assert.deepEqual(codesOf(result), ["EX-DEF-KIND-NOT-EDITABLE"]);
  assert.equal(codesOf(result).includes("EX-DEF-KIND-NOT-STORABLE"), false);
});

test("H5. a submitted arbitrary kind cannot override the authoritative kind", () => {
  for (const submitted of ["NOT-A-KIND", "__proto__", "constructor", "interface_riding", 7, []]) {
    const result = normalizeExamDefinitionEditInput(
      rawEdit({ kind: submitted }),
      "LUNGE_NO_RIDER",
    );
    assert.deepEqual(
      codesOf(result),
      ["EX-DEF-KIND-NOT-EDITABLE"],
      `submitted kind ${String(submitted)} reached the validator`,
    );
  }
});

test("H6. the AUTHORITATIVE kind drives requires* applicability", () => {
  // Refused under a kind that cannot satisfy them...
  for (const kind of ["INTERFACE_RIDING", "LUNGE_NO_RIDER"] as const) {
    assert.deepEqual(
      codesOf(
        normalizeExamDefinitionEditInput(
          rawEdit({ requiresInstructedTrainee: true, requiresLessonTopic: true }),
          kind,
        ),
      ),
      ["EX-DEF-INSTRUCTED-NOT-APPLICABLE", "EX-DEF-TOPIC-NOT-APPLICABLE"],
    );
  }
  // ...and permitted under the one that can.
  const ok = expectOk(
    normalizeExamDefinitionEditInput(
      rawEdit({ requiresInstructedTrainee: true, requiresLessonTopic: true }),
      "ADVANCED_INSTRUCTION",
    ),
  );
  assert.equal(ok.requiresInstructedTrainee, true);
  assert.equal(ok.requiresLessonTopic, true);
});

test("H7. an invalid authoritative currentKind FAILS CLOSED", () => {
  for (const bad of ["BEGINNER_INSTRUCTION", "NOT-A-KIND", "", "__proto__", null, undefined, 7, {}]) {
    const result = normalizeExamDefinitionEditInput(rawEdit(), bad as unknown as ExamKind);
    assert.equal(result.ok, false, `currentKind ${String(bad)} was accepted`);
    assert.ok(
      codesOf(result).includes("EX-DEF-KIND-NOT-STORABLE"),
      `currentKind ${String(bad)} did not fail closed`,
    );
  }
});

// ===========================================================================
// GROUP I — edit: shared rules and the payload boundary (40-45)
// ===========================================================================

test("I1. name, duration and capacity follow EXACTLY the create rules", () => {
  const cases: readonly Record<string, unknown>[] = [
    { name: "" },
    { name: "   " },
    { name: 42 },
    { durationMinutes: 0 },
    { durationMinutes: -1 },
    { durationMinutes: 1.5 },
    { durationMinutes: NaN },
    { durationMinutes: Infinity },
    { durationMinutes: "30" },
    { parallelCapacity: 0 },
    { parallelCapacity: -2 },
    { parallelCapacity: 2.5 },
    { parallelCapacity: "2" },
  ];
  for (const over of cases) {
    const createCodes = codesOf(normalizeExamDefinitionCreateInput(rawCreate(over)));
    const editCodes = codesOf(normalizeExamDefinitionEditInput(rawEdit(over), "INTERFACE_RIDING"));
    assert.deepEqual(editCodes, createCodes, `divergent rule for ${JSON.stringify(over)}`);
  }

  // Trimming and byte-preservation are shared too.
  assert.equal(
    expectOk(normalizeExamDefinitionEditInput(rawEdit({ name: "  ממשק א'  " }), "INTERFACE_RIDING"))
      .name,
    "ממשק א'",
  );
});

test("I2. identifiers, timestamps and orderIndex never appear in an edit payload", () => {
  const value = expectOk(
    normalizeExamDefinitionEditInput(
      rawEdit({
        id: "def-1",
        planId: "plan-1",
        courseOfferingId: "off-1",
        definitionId: "def-1",
        orderIndex: 4,
        createdAt: "2026-07-29T00:00:00.000Z",
        updatedAt: "2026-07-29T00:00:00.000Z",
        publishedAt: "2026-07-29T00:00:00.000Z",
        expectedUpdatedAt: 1,
        actorId: "admin-1",
      }),
      "INTERFACE_RIDING",
    ),
  );
  assert.deepEqual(Object.keys(value).sort(), [...EDIT_FIELDS].sort());
  for (const forbidden of [
    "id",
    "planId",
    "courseOfferingId",
    "definitionId",
    "orderIndex",
    "createdAt",
    "updatedAt",
    "publishedAt",
    "expectedUpdatedAt",
    "actorId",
    "kind",
  ]) {
    assert.equal(forbidden in value, false, `${forbidden} leaked into the edit payload`);
  }
  const serialized = JSON.stringify(value);
  for (const secret of ["def-1", "plan-1", "off-1", "admin-1", "2026-07-29"]) {
    assert.equal(serialized.includes(secret), false, `${secret} leaked into the edit payload`);
  }
});

test("I3. orderIndex is EXCLUDED (not rejected) on edit — the locked policy", () => {
  // The documented rule: order is assigned by the write layer, and no surface
  // this core serves lets a manager submit one, so exclusion states the rule
  // exactly while a refusal would describe a request nobody can make.
  const without = normalizeExamDefinitionEditInput(rawEdit(), "INTERFACE_RIDING");
  for (const submitted of [0, 4, -1, "9", null]) {
    const withOrder = normalizeExamDefinitionEditInput(
      rawEdit({ orderIndex: submitted }),
      "INTERFACE_RIDING",
    );
    assert.equal(withOrder.ok, true, `orderIndex ${String(submitted)} was rejected`);
    assert.deepEqual(withOrder, without);
  }
});

test("I4. a non-object raw edit input reads as absent and never throws", () => {
  for (const raw of [null, undefined, "ממשק", 7, true, []]) {
    const result = normalizeExamDefinitionEditInput(raw, "INTERFACE_RIDING");
    assert.equal(result.ok, false);
    assert.deepEqual(codesOf(result), [
      "EX-DEF-NAME-REQUIRED",
      "EX-DEF-INVALID-DURATION",
      "EX-DEF-INVALID-CAPACITY",
    ]);
  }
});

test("I5. the raw edit input is never mutated, and a frozen one is supported", () => {
  const raw = rawEdit({ name: "  ממשק  " });
  const before = JSON.parse(JSON.stringify(raw)) as unknown;
  normalizeExamDefinitionEditInput(raw, "INTERFACE_RIDING");
  assert.deepEqual(JSON.parse(JSON.stringify(raw)), before);

  const frozen = Object.freeze(rawEdit({ name: "  ממשק  " }));
  assert.equal(expectOk(normalizeExamDefinitionEditInput(frozen, "INTERFACE_RIDING")).name, "ממשק");
  assert.equal(Object.isFrozen(frozen), true);
});

test("I6. both a submitted kind AND a content problem are reported together, kind first", () => {
  const result = normalizeExamDefinitionEditInput(
    rawEdit({ kind: "INTERFACE_RIDING", name: "", durationMinutes: 0 }),
    "INTERFACE_RIDING",
  );
  assert.deepEqual(codesOf(result), [
    "EX-DEF-KIND-NOT-EDITABLE",
    "EX-DEF-NAME-REQUIRED",
    "EX-DEF-INVALID-DURATION",
  ]);
});

// ===========================================================================
// GROUP J — structural guards (46-60)
// ===========================================================================

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const EXAM_DIR = join(REPO_ROOT, "lib", "exam");
const MODULE_NAME = "exam-definition-write-core.ts";
const TEST_NAME = "exam-definition-write-core.test.ts";
const SOURCE = readFileSync(join(EXAM_DIR, MODULE_NAME), "utf8");

/**
 * The module's CODE, with comments removed. Every guard below runs against this
 * rather than the raw text: the file's documentation legitimately NAMES the
 * things it forbids (it explains why it does not restate `isPositiveInteger`,
 * for instance), and a guard that could not tell prose from code would either
 * trip on the explanation or force the explanation to be deleted.
 */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * The Prisma module specifiers, ASSEMBLED rather than spelled out.
 *
 * The committed `exam-no-feedback-guard.test.ts` scans every file in `lib/exam`
 * — this suite included — for these exact tokens, and writing them literally
 * here would make this suite trip that one. The same construction is already
 * used for the same reason in `exam-read.contract.test.ts`.
 */
const PRISMA_MODULE = ["@/lib", "prisma"].join("/");
const GENERATED_CLIENT = ["@prisma", "client"].join("/");

test("J1. the module imports no Prisma client of any kind", () => {
  for (const token of [
    PRISMA_MODULE,
    GENERATED_CLIENT,
    "PrismaClient",
    ["app/generated", "prisma"].join("/"),
  ]) {
    assert.equal(CODE.includes(token), false, `the module references ${token}`);
  }
});

test("J2. the module imports no auth, session or cookie surface", () => {
  for (const token of [
    "lib/auth",
    "next/headers",
    "next-auth",
    "cookies(",
    "getCurrent",
    "requireAdmin",
    "requireCurrent",
    "session",
    "Session",
  ]) {
    assert.equal(CODE.includes(token), false, `the module references ${token}`);
  }
});

test("J3. the module is neither server-only nor a Server Action module", () => {
  assert.equal(SOURCE.includes("server-only"), false);
  assert.equal(SOURCE.includes('"use server"'), false);
  assert.equal(SOURCE.includes("'use server'"), false);
  assert.equal(SOURCE.includes('"use client"'), false);
});

test("J4. the module imports nothing from app/, lib/actions or any framework", () => {
  for (const token of ["@/app", "lib/actions", "next/", "react", "server", "revalidate", "redirect"]) {
    assert.equal(CODE.includes(token), false, `the module references ${token}`);
  }
});

test("J5. the module consults no capability of any kind", () => {
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
    assert.equal(CODE.includes(token), false, `the module consults ${token}`);
  }
});

test("J6. the module performs no write, query, transaction or IO", () => {
  const writes = /\.(create|createMany|update|updateMany|upsert|delete|deleteMany|findUnique|findFirst|findMany|count)\s*\(/;
  assert.equal(writes.test(CODE), false, "the module performs a database operation");
  for (const token of ["$transaction", "$executeRaw", "$queryRaw", "readFile", "writeFile", "fetch("]) {
    assert.equal(CODE.includes(token), false, `the module uses ${token}`);
  }
});

test("J7. the module imports ONLY sibling pure exam cores", () => {
  const specifiers = [...CODE.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.ok(specifiers.length > 0, "sanity: the module should import something");
  for (const specifier of specifiers) {
    assert.ok(specifier.startsWith("./exam-"), `the module imports ${specifier}`);
  }
  assert.deepEqual(
    [...specifiers].sort(),
    ["./exam-definition-validation-core", "./exam-domain-core"],
  );
});

test("J8. the committed validator is CALLED rather than having its rules copied", () => {
  assert.ok(
    /\bvalidateExamDefinition\s*\(/.test(CODE),
    "the module does not call the committed validator",
  );
  // None of the rules the validator owns is restated in code here.
  for (const token of [
    "Number.isInteger",
    "isPositiveInteger",
    "isStorableExamKind",
    "isPresentText",
    "STORED_KIND_SET",
    "INTERFACE_RIDING",
    "LUNGE_NO_RIDER",
    "ADVANCED_INSTRUCTION",
    "BEGINNER_INSTRUCTION",
  ]) {
    assert.equal(CODE.includes(token), false, `the module restates ${token}`);
  }
});

test("J9. no upper bound on name, duration or capacity is introduced", () => {
  for (const token of ["MAX", "Max", "maximum", "MIN_", "minLength", "maxLength", "slice(0,"]) {
    assert.equal(CODE.includes(token), false, `the module declares a bound via ${token}`);
  }
  // The ONLY numeric literal in the code is the zero of an emptiness check —
  // there is no threshold, ceiling or magic limit anywhere.
  const numerals = [...CODE.matchAll(/\b\d+(?:\.\d+)?\b/g)].map((match) => match[0]);
  assert.deepEqual([...new Set(numerals)], ["0"], `unexpected numeric literals: ${numerals.join(", ")}`);
});

test("J10. no case folding, Unicode normalization or locale comparison is performed", () => {
  for (const token of [
    ".toLowerCase(",
    ".toUpperCase(",
    ".normalize(",
    ".localeCompare(",
    "Intl.",
    "toLocale",
  ]) {
    assert.equal(CODE.includes(token), false, `the module performs ${token}`);
  }
  // trim() is the ONLY string transformation the module applies.
  const stringOps = [...CODE.matchAll(/\.\s*([a-zA-Z]+)\s*\(/g)]
    .map((match) => match[1])
    .filter((name) => ["trim", "toLowerCase", "toUpperCase", "normalize", "replace", "split", "padStart"].includes(name));
  assert.deepEqual([...new Set(stringOps)], ["trim"]);
});

test("J11. no exported function accepts a plan, course, definition or actor identifier", () => {
  const signatures = [...SOURCE.matchAll(/export function (\w+)\(([\s\S]*?)\):/g)].map(
    ([, name, params]) => ({ name, params: params.replace(/\s+/g, " ").trim() }),
  );
  assert.deepEqual(signatures.map((signature) => signature.name), [
    "normalizeExamDefinitionCreateInput",
    "normalizeExamDefinitionEditInput",
  ]);
  for (const { name, params } of signatures) {
    for (const forbidden of [
      "planId",
      "courseOfferingId",
      "definitionId",
      "examDefinitionId",
      "studentId",
      "instructorId",
      "actorId",
      "adminId",
      "orderIndex",
      "expectedUpdatedAt",
      "deps",
      "prisma",
      "tx",
    ]) {
      assert.equal(params.includes(forbidden), false, `${name} accepts ${forbidden}`);
    }
  }
  // The edit normalizer takes the authoritative kind, and nothing else.
  assert.equal(signatures[0].params, "rawInput: unknown,");
  assert.equal(signatures[1].params, "rawInput: unknown, currentKind: ExamKind,");
});

test("J12. no environment, process or production access exists", () => {
  for (const token of ["process.", "env", "DATABASE_URL", "require(", "import(", "globalThis"]) {
    assert.equal(CODE.includes(token), false, `the module references ${token}`);
  }
});

test("J13. the module invents no database or authorization outcome", () => {
  // Those belong to later slices; naming one here would imply this core can see
  // a row, a plan or a policy that it cannot.
  for (const token of [
    "duplicate_name",
    "DUPLICATE_NAME",
    "stale_write",
    "STALE_WRITE",
    "plan_not_found",
    "PLAN_NOT_FOUND",
    "operation_not_allowed",
    "definition_in_use",
    "P2002",
    "P2003",
    "P2025",
  ]) {
    assert.equal(SOURCE.includes(token), false, `the module names the write outcome ${token}`);
  }
});

test("J14. no ordering strategy is expressed anywhere in the slice", () => {
  // Order assignment belongs to the future write layer; this slice must not
  // encode, assume or imply any allocation scheme.
  for (const token of ["orderIndex", "sortOrder", "Math.max", "appendOrder", "nextOrder"]) {
    assert.equal(CODE.includes(token), false, `the module encodes ordering via ${token}`);
  }
});

test("J15. the slice consists of EXACTLY the two approved new files", () => {
  const sliceFiles = readdirSync(EXAM_DIR)
    .filter((name) => name.startsWith("exam-definition-write-core"))
    .sort();
  assert.deepEqual(sliceFiles, [MODULE_NAME, TEST_NAME].sort());
});
