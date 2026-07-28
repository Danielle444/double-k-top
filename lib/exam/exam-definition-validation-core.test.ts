/**
 * EXAM EX-C2 — executable tests for the PURE exam-definition validation core
 * (exam-definition-validation-core.ts).
 *
 * Run with: npx tsx --test lib/exam/exam-definition-validation-core.test.ts
 * PURE: no Prisma, no DB, no clock, no randomness, no env. The only file read
 * is this module's own SOURCE TEXT, by the purity guard at the bottom.
 *
 * SCOPE OF PROOF: definition shape and satisfiability; the horse rule in every
 * kind/role combination; assignment conformance including the "not required is
 * not forbidden" ruling; stable issue ordering and assignmentId attribution;
 * and the structural promises (no input mutation, frozen results, exhaustive
 * messages, no IO in the module).
 *
 * NOTE ON NAMES: `ExamDefinition.name` is manager-entered free text and this
 * core never inspects it beyond "non-empty". Several definitions may share one
 * `ExamKind` — INTERFACE_RIDING in particular is expected to back more than one
 * independently-named definition — so nothing here couples a name to a kind,
 * and no exam name is hardcoded anywhere in the core or in these tests.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { ExamKind } from "./exam-domain-core";
import {
  isHorseRequiredFor,
  validateAssignmentsAgainstDefinition,
  validateExamDefinition,
  EXAM_DEFINITION_MESSAGES,
  type ExamAssignmentConformanceInput,
  type ExamDefinitionInput,
  type ExamDefinitionValidationResult,
} from "./exam-definition-validation-core";

// --- fixtures ---------------------------------------------------------------

const STORED_KINDS: readonly ExamKind[] = [
  "INTERFACE_RIDING",
  "LUNGE_NO_RIDER",
  "ADVANCED_INSTRUCTION",
];

function definition(over: Partial<ExamDefinitionInput> = {}): ExamDefinitionInput {
  return {
    name: "exam-definition-under-test",
    kind: "LUNGE_NO_RIDER",
    durationMinutes: 15,
    parallelCapacity: 2,
    requiresInstructedTrainee: false,
    requiresLessonTopic: false,
    requiresDiscipline: false,
    ...over,
  };
}

function assignment(
  over: Partial<ExamAssignmentConformanceInput> = {},
): ExamAssignmentConformanceInput {
  return {
    assignmentId: "as1",
    role: "EXAMINEE",
    studentId: "st1",
    horseName: "horse-1",
    instructionTopic: null,
    discipline: null,
    pairingIndex: null,
    ...over,
  };
}

function codes(r: ExamDefinitionValidationResult): string[] {
  return r.issues.map((i) => i.code);
}

// ===========================================================================
// Valid definitions
// ===========================================================================

test("a fully-enabled advanced-instruction definition is valid", () => {
  const r = validateExamDefinition(
    definition({
      kind: "ADVANCED_INSTRUCTION",
      requiresInstructedTrainee: true,
      requiresLessonTopic: true,
      requiresDiscipline: true,
    }),
  );

  assert.equal(r.ok, true);
  assert.deepEqual(r.issues, []);
});

test("a lunge definition requiring discipline is valid", () => {
  const r = validateExamDefinition(
    definition({ kind: "LUNGE_NO_RIDER", requiresDiscipline: true }),
  );

  assert.equal(r.ok, true);
  assert.deepEqual(r.issues, []);
});

test("several independently-named definitions may share one ExamKind", () => {
  // The kind is an internal behavioural category; the manager-entered name is
  // the exam identity. Two INTERFACE_RIDING definitions are both valid and this
  // core never compares their names.
  for (const name of ["definition-alpha", "definition-beta"]) {
    const r = validateExamDefinition(definition({ name, kind: "INTERFACE_RIDING" }));
    assert.equal(r.ok, true, name);
  }
});

// ===========================================================================
// Definition shape
// ===========================================================================

test("an empty or whitespace-only name is rejected", () => {
  for (const bad of ["", "   ", "\t\n", null, undefined, 42]) {
    const r = validateExamDefinition(definition({ name: bad as string }));
    assert.deepEqual(codes(r), ["EX-DEF-NAME-REQUIRED"], String(bad));
  }
});

test("a beginner kind is not a storable definition kind", () => {
  const r = validateExamDefinition(definition({ kind: "BEGINNER_INSTRUCTION" }));

  assert.deepEqual(codes(r), ["EX-DEF-KIND-NOT-STORABLE"]);
});

test("unknown, prototype-key and non-string kinds are rejected", () => {
  for (const bad of ["THEORY", "", "__proto__", "toString", "constructor", null, undefined, 3, {}]) {
    const r = validateExamDefinition(definition({ kind: bad as ExamKind }));
    assert.deepEqual(codes(r), ["EX-DEF-KIND-NOT-STORABLE"], String(bad));
  }
});

test("an invalid duration is rejected", () => {
  for (const bad of [0, -15, 12.5, NaN, Infinity, -Infinity, null, undefined, "15"]) {
    const r = validateExamDefinition(definition({ durationMinutes: bad as number }));
    assert.deepEqual(codes(r), ["EX-DEF-INVALID-DURATION"], String(bad));
  }
});

test("an invalid parallel capacity is rejected", () => {
  for (const bad of [0, -2, 2.5, NaN, Infinity, null, undefined, "2"]) {
    const r = validateExamDefinition(definition({ parallelCapacity: bad as number }));
    assert.deepEqual(codes(r), ["EX-DEF-INVALID-CAPACITY"], String(bad));
  }
});

test("requiresInstructedTrainee is only applicable to advanced instruction", () => {
  for (const kind of ["INTERFACE_RIDING", "LUNGE_NO_RIDER"] as const) {
    const r = validateExamDefinition(definition({ kind, requiresInstructedTrainee: true }));
    assert.deepEqual(codes(r), ["EX-DEF-INSTRUCTED-NOT-APPLICABLE"], kind);
  }
  // ...and is accepted on the kind that can satisfy it.
  assert.equal(
    validateExamDefinition(
      definition({ kind: "ADVANCED_INSTRUCTION", requiresInstructedTrainee: true }),
    ).ok,
    true,
  );
});

test("requiresLessonTopic is only applicable to advanced instruction", () => {
  for (const kind of ["INTERFACE_RIDING", "LUNGE_NO_RIDER"] as const) {
    const r = validateExamDefinition(definition({ kind, requiresLessonTopic: true }));
    assert.deepEqual(codes(r), ["EX-DEF-TOPIC-NOT-APPLICABLE"], kind);
  }
  assert.equal(
    validateExamDefinition(definition({ kind: "ADVANCED_INSTRUCTION", requiresLessonTopic: true }))
      .ok,
    true,
  );
});

test("requiresDiscipline is applicable to every storable kind", () => {
  for (const kind of STORED_KINDS) {
    const r = validateExamDefinition(definition({ kind, requiresDiscipline: true }));
    assert.equal(r.ok, true, kind);
  }
});

test("definition issues are collected in the documented stable order", () => {
  const r = validateExamDefinition({
    name: "   ",
    kind: "BEGINNER_INSTRUCTION",
    durationMinutes: 0,
    parallelCapacity: -1,
    requiresInstructedTrainee: true,
    requiresLessonTopic: true,
    requiresDiscipline: true,
  });

  assert.deepEqual(codes(r), [
    "EX-DEF-NAME-REQUIRED",
    "EX-DEF-KIND-NOT-STORABLE",
    "EX-DEF-INVALID-DURATION",
    "EX-DEF-INVALID-CAPACITY",
    "EX-DEF-INSTRUCTED-NOT-APPLICABLE",
    "EX-DEF-TOPIC-NOT-APPLICABLE",
  ]);
  // Definition-shape issues carry no assignment attribution.
  for (const issue of r.issues) assert.equal(issue.assignmentId, null);
});

// ===========================================================================
// The horse rule
// ===========================================================================

test("a horse is required for the examinee of every stored kind", () => {
  for (const kind of STORED_KINDS) {
    assert.equal(isHorseRequiredFor(kind, "EXAMINEE"), true, kind);
  }
});

test("a horse is never required on an instructed-trainee assignment", () => {
  for (const kind of STORED_KINDS) {
    assert.equal(isHorseRequiredFor(kind, "INSTRUCTED_TRAINEE"), false, kind);
  }
});

test("the horse rule fails closed on a non-storable kind", () => {
  for (const kind of ["BEGINNER_INSTRUCTION", "THEORY", "__proto__", null, undefined]) {
    assert.equal(isHorseRequiredFor(kind as ExamKind, "EXAMINEE"), false, String(kind));
  }
});

// ===========================================================================
// Assignment conformance
// ===========================================================================

test("every assignment must carry a student", () => {
  for (const bad of ["", "   ", null, undefined]) {
    const r = validateAssignmentsAgainstDefinition(definition(), [
      assignment({ studentId: bad as string | null }),
    ]);
    assert.deepEqual(codes(r), ["EX-DEF-TRAINEE-REQUIRED"], String(bad));
    assert.equal(r.issues[0].assignmentId, "as1");
  }
});

test("an examinee without a horse is rejected for every stored kind", () => {
  for (const kind of STORED_KINDS) {
    const r = validateAssignmentsAgainstDefinition(definition({ kind }), [
      assignment({ role: "EXAMINEE", horseName: null }),
    ]);
    assert.deepEqual(codes(r), ["EX-DEF-HORSE-REQUIRED"], kind);
    assert.equal(r.issues[0].assignmentId, "as1");
  }
});

test("an instructed trainee without a horse is accepted", () => {
  // The lesson horse is already recorded once on the examinee assignment; a
  // second one here would be the same fact stored twice.
  const r = validateAssignmentsAgainstDefinition(
    definition({ kind: "ADVANCED_INSTRUCTION", requiresInstructedTrainee: true }),
    [
      assignment({ assignmentId: "as1", role: "EXAMINEE", horseName: "horse-1" }),
      assignment({ assignmentId: "as2", role: "INSTRUCTED_TRAINEE", horseName: null }),
    ],
  );

  assert.equal(r.ok, true);
  assert.deepEqual(r.issues, []);
});

test("a required lesson topic must be present on every examinee", () => {
  const def = definition({ kind: "ADVANCED_INSTRUCTION", requiresLessonTopic: true });
  for (const bad of ["", "   ", null, undefined]) {
    const r = validateAssignmentsAgainstDefinition(def, [
      assignment({ instructionTopic: bad as string | null }),
    ]);
    assert.deepEqual(codes(r), ["EX-DEF-TOPIC-REQUIRED"], String(bad));
    assert.equal(r.issues[0].assignmentId, "as1");
  }
});

test("a required discipline must be present on every examinee", () => {
  const def = definition({ requiresDiscipline: true });
  for (const bad of ["", "   ", null, undefined]) {
    const r = validateAssignmentsAgainstDefinition(def, [
      assignment({ discipline: bad as string | null }),
    ]);
    assert.deepEqual(codes(r), ["EX-DEF-DISCIPLINE-REQUIRED"], String(bad));
  }
});

test("a required instructed trainee must be present somewhere in the block", () => {
  const def = definition({ kind: "ADVANCED_INSTRUCTION", requiresInstructedTrainee: true });

  const missing = validateAssignmentsAgainstDefinition(def, [assignment({ role: "EXAMINEE" })]);
  assert.deepEqual(codes(missing), ["EX-DEF-INSTRUCTED-REQUIRED"]);
  // It is a block-level fact, so it names no single assignment.
  assert.equal(missing.issues[0].assignmentId, null);

  const present = validateAssignmentsAgainstDefinition(def, [
    assignment({ assignmentId: "as1", role: "EXAMINEE" }),
    assignment({ assignmentId: "as2", role: "INSTRUCTED_TRAINEE", horseName: null }),
  ]);
  assert.equal(present.ok, true);
});

test("required topic and discipline bind examinees only, not instructed trainees", () => {
  const r = validateAssignmentsAgainstDefinition(
    definition({
      kind: "ADVANCED_INSTRUCTION",
      requiresInstructedTrainee: true,
      requiresLessonTopic: true,
      requiresDiscipline: true,
    }),
    [
      assignment({
        assignmentId: "as1",
        role: "EXAMINEE",
        instructionTopic: "topic",
        discipline: "discipline",
      }),
      assignment({
        assignmentId: "as2",
        role: "INSTRUCTED_TRAINEE",
        horseName: null,
        instructionTopic: null,
        discipline: null,
      }),
    ],
  );

  assert.equal(r.ok, true);
});

test("a false requires* flag accepts an ABSENT value", () => {
  const r = validateAssignmentsAgainstDefinition(definition(), [
    assignment({ instructionTopic: null, discipline: null }),
  ]);

  assert.equal(r.ok, true);
});

test("a false requires* flag also accepts a PRESENT value — not required is not forbidden", () => {
  // Unchecking a box must never retroactively invalidate blocks already built
  // from the definition. Kind-level prohibition stays exam-domain-core's alone.
  const r = validateAssignmentsAgainstDefinition(
    definition({ kind: "ADVANCED_INSTRUCTION" }),
    [assignment({ instructionTopic: "a topic nobody asked for", discipline: "a discipline" })],
  );

  assert.equal(r.ok, true);
  assert.deepEqual(r.issues, []);
});

test("conformance issues follow input order, then the block-level check", () => {
  const r = validateAssignmentsAgainstDefinition(
    definition({
      kind: "ADVANCED_INSTRUCTION",
      requiresInstructedTrainee: true,
      requiresLessonTopic: true,
      requiresDiscipline: true,
    }),
    [
      assignment({ assignmentId: "as1", studentId: null, horseName: null }),
      assignment({ assignmentId: "as2" }),
    ],
  );

  assert.deepEqual(codes(r), [
    // as1: trainee, horse, topic, discipline — the fixed within-assignment order
    "EX-DEF-TRAINEE-REQUIRED",
    "EX-DEF-HORSE-REQUIRED",
    "EX-DEF-TOPIC-REQUIRED",
    "EX-DEF-DISCIPLINE-REQUIRED",
    // as2: horse is present, so only the two required text fields
    "EX-DEF-TOPIC-REQUIRED",
    "EX-DEF-DISCIPLINE-REQUIRED",
    // block level, appended last
    "EX-DEF-INSTRUCTED-REQUIRED",
  ]);
  assert.deepEqual(
    r.issues.map((i) => i.assignmentId),
    ["as1", "as1", "as1", "as1", "as2", "as2", null],
  );
});

test("an empty assignment list is conformant unless the block-level rule binds", () => {
  assert.equal(validateAssignmentsAgainstDefinition(definition(), []).ok, true);
  assert.deepEqual(
    codes(
      validateAssignmentsAgainstDefinition(
        definition({ kind: "ADVANCED_INSTRUCTION", requiresInstructedTrainee: true }),
        [],
      ),
    ),
    ["EX-DEF-INSTRUCTED-REQUIRED"],
  );
});

// ===========================================================================
// Structural promises
// ===========================================================================

test("the caller's input is never mutated", () => {
  const def = definition({ kind: "ADVANCED_INSTRUCTION", requiresLessonTopic: true });
  const list = [assignment({ assignmentId: "as1", studentId: null }), assignment({ assignmentId: "as2" })];
  const original = JSON.stringify({ def, list });

  validateExamDefinition(def);
  validateAssignmentsAgainstDefinition(def, list);

  assert.equal(JSON.stringify({ def, list }), original);
  assert.equal(Object.isFrozen(def), false, "caller objects must not be frozen in place");
  assert.equal(Object.isFrozen(list), false);
});

test("repeated calls on the same input are deeply equal", () => {
  const def = definition({ kind: "ADVANCED_INSTRUCTION", requiresDiscipline: true });
  const list = [assignment({ discipline: null })];

  assert.deepEqual(validateExamDefinition(def), validateExamDefinition(def));
  assert.deepEqual(
    validateAssignmentsAgainstDefinition(def, list),
    validateAssignmentsAgainstDefinition(def, list),
  );
});

test("results and their issue arrays are frozen", () => {
  for (const r of [
    validateExamDefinition(definition({ name: "" })),
    validateExamDefinition(definition()),
    validateAssignmentsAgainstDefinition(definition(), [assignment({ studentId: null })]),
    validateAssignmentsAgainstDefinition(definition(), []),
  ]) {
    assert.equal(Object.isFrozen(r), true);
    assert.equal(Object.isFrozen(r.issues), true);
    for (const issue of r.issues) assert.equal(Object.isFrozen(issue), true);
  }
});

test("every code carries a non-empty Hebrew message, and there are no extras", () => {
  const allCodes = [
    "EX-DEF-NAME-REQUIRED",
    "EX-DEF-KIND-NOT-STORABLE",
    "EX-DEF-INVALID-DURATION",
    "EX-DEF-INVALID-CAPACITY",
    "EX-DEF-INSTRUCTED-NOT-APPLICABLE",
    "EX-DEF-TOPIC-NOT-APPLICABLE",
    "EX-DEF-TRAINEE-REQUIRED",
    "EX-DEF-HORSE-REQUIRED",
    "EX-DEF-TOPIC-REQUIRED",
    "EX-DEF-DISCIPLINE-REQUIRED",
    "EX-DEF-INSTRUCTED-REQUIRED",
  ] as const;

  assert.deepEqual(Object.keys(EXAM_DEFINITION_MESSAGES).sort(), [...allCodes].sort());
  for (const code of allCodes) {
    assert.equal(typeof EXAM_DEFINITION_MESSAGES[code], "string");
    assert.ok(EXAM_DEFINITION_MESSAGES[code].trim().length > 0, code);
  }
  assert.equal(Object.isFrozen(EXAM_DEFINITION_MESSAGES), true);
});

// --- purity guard -----------------------------------------------------------

/** Strip block and line comments so documentation never trips the guard. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

test("the module is DB-free, clock-free and IO-free at the source level", () => {
  const source = readFileSync(
    join(import.meta.dirname, "exam-definition-validation-core.ts"),
    "utf8",
  );
  const code = stripComments(source);

  for (const forbidden of [
    /\bDate\b/,
    /Math\s*\.\s*random/,
    /process\s*\.\s*env/,
    /\bprisma\b/i,
    /\bfetch\s*\(/,
    /\brequire\s*\(/,
    /readFileSync/,
    /use server/,
    /\bcookies\b/,
  ]) {
    assert.equal(forbidden.test(code), false, `forbidden in core: ${forbidden}`);
  }

  // The one permitted dependency is the sibling pure domain core, and the
  // storable-kind membership table is NOT duplicated here.
  const imports = [...code.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(imports)], ["./exam-domain-core"]);
  assert.equal(/STORED_KIND_SET|STORED_EXAM_KINDS\s*=/.test(code), false);
});

test("no exam name is hardcoded in the core", () => {
  const source = readFileSync(
    join(import.meta.dirname, "exam-definition-validation-core.ts"),
    "utf8",
  );

  // Manager-created definition names are data, never code. Only Hebrew ISSUE
  // MESSAGES may appear, and none of them is an exam name.
  for (const name of ["לונג", "ממשק", "רכיבה", "קבוצתי", "מתקדמים"]) {
    const inMessages = Object.values(EXAM_DEFINITION_MESSAGES).some((m) => m.includes(name));
    const inSource = source.includes(name);
    assert.equal(
      inSource && !inMessages,
      false,
      `"${name}" appears in the core outside an issue message`,
    );
  }
});
