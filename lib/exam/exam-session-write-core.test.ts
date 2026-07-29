/**
 * EXAM EX-SES-S1 — executable tests for the PURE stored-ExamSession write-input
 * core (exam-session-write-core.ts).
 *
 * Run with: npx tsx --test lib/exam/exam-session-write-core.test.ts
 *
 * PURE: no Prisma, no DB, no clock, no randomness, no env, no network. The only
 * files read are SOURCE TEXTS — the module's own, and those of its two
 * dependencies, so the purity of the cross-directory reuse is PROVEN
 * TRANSITIVELY rather than assumed.
 *
 * SCOPE OF PROOF:
 *   - the six accepted fields, and nothing else, on both create and edit;
 *   - dates: exact `YYYY-MM-DD`, real calendars, leap years, impossible days;
 *   - times: exact zero-padded `HH:mm`, both boundaries, every near-miss;
 *   - the optional-text policy: trim, blank -> null, non-string fails closed;
 *   - the result model: plain JSON, frozen, deterministic, non-echoing;
 *   - the exclusions: every server-supplied, forbidden and deprecated column;
 *   - the structural promises: no IO, no auth, no clock, no coercion, no bound,
 *     no ordering/assignment/break/supervisor/publication logic, and exactly two
 *     new files.
 *
 * NOTE ON WHAT IS *NOT* PROVEN HERE, BY DESIGN: nothing about whether a
 * definition exists, belongs to the plan, or is of a storable kind; nothing about
 * authorization; and nothing about beginner exams. A successful normalization is
 * a statement about SHAPE ONLY — the write layer owns every one of those
 * questions, and a test here that implied otherwise would misdescribe the
 * boundary.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  EXAM_SESSION_WRITE_INPUT_MESSAGES,
  normalizeExamSessionCreateInput,
  normalizeExamSessionEditInput,
  type ExamSessionWriteInputIssue,
  type ExamSessionWriteInputIssueCode,
  type ExamSessionWriteInputResult,
  type NormalizedExamSessionCreate,
} from "./exam-session-write-core";

// --- fixtures ---------------------------------------------------------------

/** The six accepted fields, in the module's fixed order. */
const SESSION_FIELDS = ["definitionId", "date", "startTime", "arena", "title", "notes"] as const;

/** The fixed diagnostic order, one per field. */
const ISSUE_ORDER: readonly ExamSessionWriteInputIssueCode[] = [
  "EX-SES-DEFINITION-REQUIRED",
  "EX-SES-DATE-INVALID",
  "EX-SES-START-TIME-INVALID",
  "EX-SES-ARENA-INVALID",
  "EX-SES-TITLE-INVALID",
  "EX-SES-NOTES-INVALID",
];

/**
 * Everything a client must NEVER be able to write through this input: the five
 * server-supplied values, every column the task forbids, and the deprecated /
 * unwritten columns the schema retains without dropping.
 */
const FORBIDDEN_FIELDS = [
  // server-supplied
  "courseOfferingId",
  "planId",
  "sessionId",
  "orderIndex",
  "expectedUpdatedAt",
  // forbidden / derived / deprecated
  "id",
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
  "assignments",
  "breaks",
  "supervisors",
  "sourcePracticeRole",
] as const;

/** A minimal submission every field of which is valid. */
function validRaw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    definitionId: "cme1AbCdEf",
    date: "2026-03-15",
    startTime: "09:30",
    arena: "זירה מקורה",
    title: "מבחן ממשק",
    notes: "להביא כפפות",
    ...overrides,
  };
}

/**
 * Both public normalizers, so every behavioural rule is proven on BOTH paths.
 *
 * The shared signature uses the CREATE payload type deliberately: create and edit
 * are separate declared types that are structurally identical TODAY, so the edit
 * function is assignable here. That assignability is itself the check that the
 * two accepted field sets have not silently diverged — if a later slice changes
 * one, this fixture stops compiling. Their SEPARATENESS as declarations is proven
 * by J14/J15, not here.
 */
type Normalizer = (rawInput: unknown) => ExamSessionWriteInputResult<NormalizedExamSessionCreate>;

const NORMALIZERS: readonly { readonly label: string; readonly run: Normalizer }[] = [
  { label: "create", run: normalizeExamSessionCreateInput },
  { label: "edit", run: normalizeExamSessionEditInput },
];

function expectOk<T>(result: ExamSessionWriteInputResult<T>): T {
  assert.equal(result.ok, true, `expected ok, got ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  return result.value;
}

function codesOf<T>(result: ExamSessionWriteInputResult<T>): readonly string[] {
  assert.equal(result.ok, false, `expected failure, got ${JSON.stringify(result)}`);
  if (result.ok) throw new Error("unreachable");
  return result.issues.map((issue) => issue.code);
}

// ===========================================================================
// A. The accepted shape
// ===========================================================================

test("A1. a valid submission normalizes to EXACTLY the six fields, on both paths", () => {
  for (const { label, run } of NORMALIZERS) {
    const value = expectOk(run(validRaw()));
    assert.deepEqual(Object.keys(value).sort(), [...SESSION_FIELDS].sort(), label);
    assert.deepEqual(
      value,
      {
        definitionId: "cme1AbCdEf",
        date: "2026-03-15",
        startTime: "09:30",
        arena: "זירה מקורה",
        title: "מבחן ממשק",
        notes: "להביא כפפות",
      },
      label,
    );
  }
});

test("A2. create and edit accept the identical field set but are separate values", () => {
  const raw = validRaw();
  const created = expectOk(normalizeExamSessionCreateInput(raw));
  const edited = expectOk(normalizeExamSessionEditInput(raw));

  assert.deepEqual(created, edited, "the accepted field set must not diverge today");
  assert.notEqual(created, edited, "the two payloads must not be the same object");
});

test("A3. definitionId IS accepted on edit — a mis-scheduled session must be correctable", () => {
  const value = expectOk(normalizeExamSessionEditInput(validRaw({ definitionId: "other-def" })));
  assert.equal(value.definitionId, "other-def");
});

// ===========================================================================
// B. date — exact YYYY-MM-DD, real calendar
// ===========================================================================

test("B1. boundary and ordinary real dates are accepted", () => {
  for (const date of [
    "2026-01-01",
    "2026-12-31",
    "2026-01-31",
    "2026-04-30",
    "2026-02-28",
    "1000-01-01",
    "9999-12-31",
  ]) {
    for (const { label, run } of NORMALIZERS) {
      assert.equal(expectOk(run(validRaw({ date }))).date, date, `${label} ${date}`);
    }
  }
});

test("B2. leap years are honoured in all four cases", () => {
  // Accepted: divisible by 4 and not by 100; and divisible by 400.
  for (const date of ["2024-02-29", "2028-02-29", "2000-02-29", "1600-02-29"]) {
    assert.equal(expectOk(normalizeExamSessionCreateInput(validRaw({ date }))).date, date, date);
  }
  // Refused: not divisible by 4; and divisible by 100 but not by 400.
  for (const date of ["2026-02-29", "2027-02-29", "1900-02-29", "2100-02-29"]) {
    assert.deepEqual(codesOf(normalizeExamSessionCreateInput(validRaw({ date }))), [
      "EX-SES-DATE-INVALID",
    ], date);
  }
});

test("B3. impossible calendar dates are REFUSED, not silently accepted", () => {
  for (const date of [
    "2026-02-31",
    "2026-02-30",
    "2026-04-31",
    "2026-06-31",
    "2026-09-31",
    "2026-11-31",
    "2026-13-01",
    "2026-00-10",
    "2026-01-32",
    "2026-01-00",
    "2026-99-99",
  ]) {
    for (const { label, run } of NORMALIZERS) {
      assert.deepEqual(
        codesOf(run(validRaw({ date }))),
        ["EX-SES-DATE-INVALID"],
        `${label} ${date}`,
      );
    }
  }
});

test("B4. the date must be EXACT — no padding slack, no whitespace, no timestamp", () => {
  for (const date of [
    "2026-1-1",
    "2026-01-1",
    "2026-1-01",
    "20260101",
    "2026/01/01",
    "01-01-2026",
    " 2026-01-01",
    "2026-01-01 ",
    "\t2026-01-01",
    "2026-01-01\n",
    "2026-01-01T00:00:00Z",
    "2026-01-01T10:00",
    "+2026-01-01",
    "",
    "   ",
  ]) {
    assert.deepEqual(
      codesOf(normalizeExamSessionCreateInput(validRaw({ date }))),
      ["EX-SES-DATE-INVALID"],
      JSON.stringify(date),
    );
  }
});

test("B5. a non-string date is refused and NEVER coerced — including a real Date", () => {
  for (const date of [
    20260101,
    0,
    null,
    undefined,
    true,
    {},
    [],
    ["2026-01-01"],
    new Date("2026-01-01T00:00:00Z"),
    { toString: () => "2026-01-01" },
  ]) {
    assert.deepEqual(
      codesOf(normalizeExamSessionCreateInput(validRaw({ date }))),
      ["EX-SES-DATE-INVALID"],
      String(date),
    );
  }
});

test("B6. an absent date is refused, and today is NEVER inferred", () => {
  const raw = validRaw();
  delete raw.date;
  assert.deepEqual(codesOf(normalizeExamSessionCreateInput(raw)), ["EX-SES-DATE-INVALID"]);
});

// ===========================================================================
// C. startTime — exact zero-padded HH:mm
// ===========================================================================

test("C1. both clock boundaries and ordinary padded times are accepted", () => {
  for (const startTime of ["00:00", "00:01", "09:00", "09:30", "12:00", "23:58", "23:59"]) {
    for (const { label, run } of NORMALIZERS) {
      assert.equal(
        expectOk(run(validRaw({ startTime }))).startTime,
        startTime,
        `${label} ${startTime}`,
      );
    }
  }
});

test("C2. the exact cases the task names are refused: 9:00, 24:00 and whitespace variants", () => {
  for (const startTime of ["9:00", "24:00", " 09:00", "09:00 ", "\t09:00", "09:00\n", " 9:00 "]) {
    for (const { label, run } of NORMALIZERS) {
      assert.deepEqual(
        codesOf(run(validRaw({ startTime }))),
        ["EX-SES-START-TIME-INVALID"],
        `${label} ${JSON.stringify(startTime)}`,
      );
    }
  }
});

test("C3. every other malformed time is refused", () => {
  for (const startTime of [
    "24:01",
    "25:00",
    "99:99",
    "09:60",
    "09:99",
    "09:5",
    "9:5",
    "0930",
    "09-30",
    "09:30:00",
    "09.30",
    "-1:00",
    "1:00",
    ":30",
    "09:",
    "",
    "   ",
    "aa:bb",
    "٠٩:٣٠",
  ]) {
    assert.deepEqual(
      codesOf(normalizeExamSessionCreateInput(validRaw({ startTime }))),
      ["EX-SES-START-TIME-INVALID"],
      JSON.stringify(startTime),
    );
  }
});

test("C4. a non-string startTime is refused and NEVER coerced", () => {
  for (const startTime of [930, 0, null, undefined, true, {}, [], new Date(0)]) {
    assert.deepEqual(
      codesOf(normalizeExamSessionCreateInput(validRaw({ startTime }))),
      ["EX-SES-START-TIME-INVALID"],
      String(startTime),
    );
  }
});

test("C5. an absent startTime is refused, and no default hour is invented", () => {
  const raw = validRaw();
  delete raw.startTime;
  assert.deepEqual(codesOf(normalizeExamSessionCreateInput(raw)), ["EX-SES-START-TIME-INVALID"]);
});

// ===========================================================================
// D. definitionId — trim, non-empty, case-preserving, uncoerced
// ===========================================================================

test("D1. definitionId is trimmed but otherwise preserved byte-for-byte", () => {
  for (const { label, run } of NORMALIZERS) {
    assert.equal(
      expectOk(run(validRaw({ definitionId: "  cme1AbCdEf  " }))).definitionId,
      "cme1AbCdEf",
      label,
    );
    assert.equal(
      expectOk(run(validRaw({ definitionId: "\t\ncme1AbCdEf\r\n" }))).definitionId,
      "cme1AbCdEf",
      label,
    );
  }
});

test("D2. definitionId CASE is preserved — never folded, never normalized", () => {
  for (const definitionId of ["ABCdef123", "abcDEF123", "AbCdEfGhIj"]) {
    const value = expectOk(normalizeExamSessionCreateInput(validRaw({ definitionId })));
    assert.equal(value.definitionId, definitionId);
  }
  // Two ids differing only in case stay DISTINCT.
  const upper = expectOk(normalizeExamSessionCreateInput(validRaw({ definitionId: "ABC" })));
  const lower = expectOk(normalizeExamSessionCreateInput(validRaw({ definitionId: "abc" })));
  assert.notEqual(upper.definitionId, lower.definitionId);
});

test("D3. a blank or whitespace-only definitionId is refused", () => {
  for (const definitionId of ["", " ", "   ", "\t", "\n", "\r\n", "  "]) {
    for (const { label, run } of NORMALIZERS) {
      assert.deepEqual(
        codesOf(run(validRaw({ definitionId }))),
        ["EX-SES-DEFINITION-REQUIRED"],
        `${label} ${JSON.stringify(definitionId)}`,
      );
    }
  }
});

test("D4. a malformed / non-string / absent definitionId is refused and NEVER coerced", () => {
  for (const definitionId of [null, undefined, 0, 42, true, false, {}, [], ["abc"], new Date(0)]) {
    assert.deepEqual(
      codesOf(normalizeExamSessionCreateInput(validRaw({ definitionId }))),
      ["EX-SES-DEFINITION-REQUIRED"],
      String(definitionId),
    );
  }
  const raw = validRaw();
  delete raw.definitionId;
  assert.deepEqual(codesOf(normalizeExamSessionCreateInput(raw)), ["EX-SES-DEFINITION-REQUIRED"]);
});

test("D5. definitionId is OPAQUE — no format, prefix or length is imposed", () => {
  for (const definitionId of ["a", "1", "-", "לא-מזהה-לטיני", "cme1abc".repeat(500)]) {
    assert.equal(
      expectOk(normalizeExamSessionCreateInput(validRaw({ definitionId }))).definitionId,
      definitionId,
    );
  }
});

// ===========================================================================
// E. arena / title / notes — the optional-text policy
// ===========================================================================

test("E1. absent, null and undefined optional text all normalize to null", () => {
  for (const field of ["arena", "title", "notes"] as const) {
    for (const { label, run } of NORMALIZERS) {
      const absent = validRaw();
      delete absent[field];
      assert.equal(expectOk(run(absent))[field], null, `${label} ${field} absent`);
      assert.equal(
        expectOk(run(validRaw({ [field]: null })))[field],
        null,
        `${label} ${field} null`,
      );
      assert.equal(
        expectOk(run(validRaw({ [field]: undefined })))[field],
        null,
        `${label} ${field} undefined`,
      );
    }
  }
});

test("E2. BLANK optional text collapses to null, never to an empty string", () => {
  for (const field of ["arena", "title", "notes"] as const) {
    for (const blank of ["", " ", "    ", "\t", "\n", "\r\n", " \t\n "]) {
      for (const { label, run } of NORMALIZERS) {
        const value = expectOk(run(validRaw({ [field]: blank })));
        assert.equal(value[field], null, `${label} ${field} ${JSON.stringify(blank)}`);
        assert.notEqual(value[field], "", "a blank must never survive as an empty string");
      }
    }
  }
});

test("E3. optional text is trimmed at the edges only", () => {
  const value = expectOk(
    normalizeExamSessionCreateInput(
      validRaw({ arena: "  זירה  ", title: "\tמבחן\n", notes: "  שורה אחת  " }),
    ),
  );
  assert.equal(value.arena, "זירה");
  assert.equal(value.title, "מבחן");
  assert.equal(value.notes, "שורה אחת");
});

test("E4. INTERNAL characters are preserved exactly — Hebrew, punctuation, newlines, emoji", () => {
  const notes = "שורה ראשונה\nשורה  שנייה\tטאב — מקף 🐴 ‏ RTL ְ ניקוד";
  const arena = "זירה  מקורה (מס' 2)";
  const title = 'מבחן "ממשק" – שלב א׳';
  const value = expectOk(normalizeExamSessionCreateInput(validRaw({ arena, title, notes })));
  assert.equal(value.notes, notes);
  assert.equal(value.arena, arena);
  assert.equal(value.title, title);
  // No Unicode normalization: a DECOMPOSED sequence is NOT recomposed. Both
  // literals are built from CODE POINTS rather than typed characters, so the
  // assertion cannot be defeated by the encoding of this source file itself.
  const decomposed = `a${String.fromCharCode(0x0301)}`;
  const precomposed = String.fromCharCode(0x00e1);
  assert.notEqual(decomposed, precomposed, "sanity: the two forms must differ");
  const kept = expectOk(normalizeExamSessionCreateInput(validRaw({ title: decomposed }))).title;
  assert.equal(kept, decomposed);
  assert.notEqual(kept, precomposed, "the module applied Unicode normalization");
});

test("E5. a NON-STRING optional value FAILS CLOSED — it is never coerced or dropped", () => {
  const cases: readonly [string, unknown][] = [
    ["arena", 42],
    ["arena", 0],
    ["arena", true],
    ["arena", {}],
    ["arena", []],
    ["arena", ["זירה"]],
    ["arena", new Date(0)],
    ["arena", { toString: () => "זירה" }],
    ["title", 42],
    ["title", false],
    ["title", {}],
    ["notes", 42],
    ["notes", []],
    ["notes", { a: 1 }],
  ];
  const expected: Record<string, ExamSessionWriteInputIssueCode> = {
    arena: "EX-SES-ARENA-INVALID",
    title: "EX-SES-TITLE-INVALID",
    notes: "EX-SES-NOTES-INVALID",
  };
  for (const [field, value] of cases) {
    for (const { label, run } of NORMALIZERS) {
      assert.deepEqual(
        codesOf(run(validRaw({ [field]: value }))),
        [expected[field]],
        `${label} ${field}=${String(value)}`,
      );
    }
  }
});

test("E6. no coerced artefact can ever reach a payload", () => {
  // The two outcomes a coercing implementation would have produced.
  const result = normalizeExamSessionCreateInput(validRaw({ arena: {}, title: 42 }));
  assert.equal(result.ok, false);
  const text = JSON.stringify(result);
  assert.equal(text.includes("[object Object]"), false);
  assert.equal(text.includes("42"), false, "a diagnostic must not echo the submitted value");
});

// ===========================================================================
// F. Diagnostics — stable, ordered, non-echoing
// ===========================================================================

test("F1. EVERY applicable issue is reported, in the fixed field order", () => {
  const raw = {
    definitionId: "   ",
    date: "2026-02-31",
    startTime: "9:00",
    arena: 5,
    title: {},
    notes: [],
  };
  for (const { label, run } of NORMALIZERS) {
    assert.deepEqual(codesOf(run(raw)), ISSUE_ORDER, label);
  }
});

test("F2. the issue order does NOT depend on the raw object's key order", () => {
  const reversed: Record<string, unknown> = {};
  reversed.notes = [];
  reversed.title = {};
  reversed.arena = 5;
  reversed.startTime = "9:00";
  reversed.date = "2026-02-31";
  reversed.definitionId = "   ";
  assert.deepEqual(codesOf(normalizeExamSessionCreateInput(reversed)), ISSUE_ORDER);
});

test("F3. a non-object rawInput yields the ordinary diagnostics, never a throw", () => {
  for (const raw of [null, undefined, "", "x", 0, 42, true, [], NaN, Symbol("s"), () => {}]) {
    for (const { label, run } of NORMALIZERS) {
      // Only the three REQUIRED fields can be missing; the optional three read as
      // absent, which is legitimate.
      assert.deepEqual(
        codesOf(run(raw)),
        ["EX-SES-DEFINITION-REQUIRED", "EX-SES-DATE-INVALID", "EX-SES-START-TIME-INVALID"],
        label,
      );
    }
  }
});

test("F4. each issue carries EXACTLY a code and its table message — nothing else", () => {
  const result = normalizeExamSessionCreateInput({});
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  for (const issue of result.issues) {
    assert.deepEqual(Object.keys(issue).sort(), ["code", "message"]);
    assert.equal(issue.message, EXAM_SESSION_WRITE_INPUT_MESSAGES[issue.code]);
    assert.equal(typeof issue.message, "string");
    assert.ok(issue.message.length > 0);
    assert.ok(Object.isFrozen(issue));
  }
});

test("F5. the message table is frozen, complete, and free of value placeholders", () => {
  assert.ok(Object.isFrozen(EXAM_SESSION_WRITE_INPUT_MESSAGES));
  assert.deepEqual(Object.keys(EXAM_SESSION_WRITE_INPUT_MESSAGES).sort(), [...ISSUE_ORDER].sort());
  for (const [code, message] of Object.entries(EXAM_SESSION_WRITE_INPUT_MESSAGES)) {
    // Hebrew, and no interpolation hole through which a value could be echoed.
    assert.ok(/[֐-׿]/.test(message), `${code} is not Hebrew`);
    for (const hole of ["${", "%s", "%d", "{0}", "{}"]) {
      assert.equal(message.includes(hole), false, `${code} contains ${hole}`);
    }
  }
});

test("F6. diagnostics NEVER echo the submitted values", () => {
  const secret = "SENSITIVE-DEFINITION-TOKEN";
  const result = normalizeExamSessionCreateInput({
    definitionId: secret,
    date: `${secret}-date`,
    startTime: `${secret}-time`,
    arena: 1,
  });
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test("F7. diagnostics are DETERMINISTIC — the same input always yields the same result", () => {
  const raw = validRaw({ date: "2026-02-31", arena: 7 });
  const first = normalizeExamSessionCreateInput(raw);
  const second = normalizeExamSessionCreateInput(raw);
  assert.deepEqual(first, second);
  assert.deepEqual(codesOf(first), codesOf(second));
});

// ===========================================================================
// G. Exclusions — server-supplied, forbidden and deprecated columns
// ===========================================================================

test("G1. EVERY forbidden field is excluded from the payload, on both paths", () => {
  const raw = validRaw();
  for (const field of FORBIDDEN_FIELDS) {
    raw[field] = `INJECTED-${field}`;
  }
  // Shapes a naive spread would have carried through verbatim.
  raw.orderIndex = 999;
  raw.capacity = 99;
  raw.kind = "BEGINNER_INSTRUCTION";
  raw.endTime = "23:59";
  raw.copiedAt = new Date(0);
  raw.createdAt = new Date(0);
  raw.updatedAt = new Date(0);
  raw.expectedUpdatedAt = new Date(0);
  raw.individualPublishedAt = new Date(0);
  raw.roleLabelOverrides = { EVALUATOR: "בוחן" };
  raw.assignments = [{ studentId: "s1" }];
  raw.breaks = [{ afterWaveIndex: 1 }];
  raw.supervisors = [{ instructorId: "i1" }];

  for (const { label, run } of NORMALIZERS) {
    const value = expectOk(run(raw));
    assert.deepEqual(Object.keys(value).sort(), [...SESSION_FIELDS].sort(), label);
    for (const field of FORBIDDEN_FIELDS) {
      assert.equal(field in value, false, `${label}: ${field} entered the payload`);
    }
    const text = JSON.stringify(value);
    assert.equal(text.includes("INJECTED"), false, label);
    assert.equal(text.includes("BEGINNER"), false, label);
    assert.equal(text.includes("999"), false, label);
  }
});

test("G2. an UNKNOWN field is excluded rather than carried through", () => {
  const value = expectOk(
    normalizeExamSessionCreateInput(
      validRaw({ somethingNew: "x", __proto__unsafe: "y", "": "z", isAdmin: true }),
    ),
  );
  assert.deepEqual(Object.keys(value).sort(), [...SESSION_FIELDS].sort());
});

test("G3. a field on the PROTOTYPE is not treated as submitted data", () => {
  const parent = { definitionId: "inherited", date: "2026-03-15", startTime: "09:30" };
  const child = Object.create(parent) as Record<string, unknown>;
  // Only the required fields are inherited, so all three must read as ABSENT.
  assert.deepEqual(codesOf(normalizeExamSessionCreateInput(child)), [
    "EX-SES-DEFINITION-REQUIRED",
    "EX-SES-DATE-INVALID",
    "EX-SES-START-TIME-INVALID",
  ]);
});

test("G4. no derived value — end time, waves, slots, duration, conflicts — is produced", () => {
  const value = expectOk(normalizeExamSessionCreateInput(validRaw()));
  for (const derived of [
    "endTime",
    "end",
    "durationMinutes",
    "duration",
    "waves",
    "waveCount",
    "slots",
    "personalSlots",
    "timetable",
    "conflicts",
    "parallelCapacity",
  ]) {
    assert.equal(derived in value, false, `${derived} was produced`);
  }
});

// ===========================================================================
// H. The result model — plain, frozen, JSON-safe
// ===========================================================================

/** Recursively assert a value is plain JSON data and nothing exotic. */
function assertPlainJsonData(value: unknown, path: string): void {
  if (value === null) return;
  const type = typeof value;
  if (type === "string" || type === "boolean") return;
  if (type === "number") {
    assert.ok(Number.isFinite(value as number), `${path} is a non-finite number`);
    return;
  }
  assert.notEqual(type, "undefined", `${path} is undefined`);
  assert.notEqual(type, "bigint", `${path} is a BigInt`);
  assert.notEqual(type, "function", `${path} is a function`);
  assert.notEqual(type, "symbol", `${path} is a Symbol`);
  assert.equal(type, "object", `${path} has exotic type ${type}`);
  assert.equal(value instanceof Date, false, `${path} is a Date`);
  assert.equal(value instanceof Map, false, `${path} is a Map`);
  assert.equal(value instanceof Set, false, `${path} is a Set`);
  assert.equal(value instanceof Error, false, `${path} is an Error`);
  assert.equal(value instanceof RegExp, false, `${path} is a RegExp`);
  assert.equal(value instanceof Promise, false, `${path} is a Promise`);

  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertPlainJsonData(entry, `${path}[${index}]`));
    return;
  }
  const proto = Object.getPrototypeOf(value);
  assert.ok(
    proto === Object.prototype || proto === null,
    `${path} is a class instance, not a plain object`,
  );
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    assertPlainJsonData(entry, `${path}.${key}`);
  }
}

/** Every result shape this module can return. */
function allResults(): readonly ExamSessionWriteInputResult<unknown>[] {
  const raws: unknown[] = [
    validRaw(),
    validRaw({ arena: null, title: "", notes: undefined }),
    validRaw({ date: "2026-02-31" }),
    { definitionId: "  ", date: 1, startTime: "9:00", arena: {}, title: [], notes: 0 },
    {},
    null,
  ];
  return raws.flatMap((raw) => [
    normalizeExamSessionCreateInput(raw),
    normalizeExamSessionEditInput(raw),
  ]);
}

test("H1. no result contains a Date, Map, Set, Error, BigInt, undefined or class instance", () => {
  allResults().forEach((result, index) => assertPlainJsonData(result, `result[${index}]`));
});

test("H2. every result survives a JSON round trip unchanged", () => {
  for (const result of allResults()) {
    assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  }
});

test("H3. no key is ever present-but-undefined; the arms are strictly disjoint", () => {
  for (const result of allResults()) {
    const keys = Object.keys(result).sort();
    if (result.ok) {
      assert.deepEqual(keys, ["ok", "value"]);
      assert.equal("issues" in result, false);
    } else {
      assert.deepEqual(keys, ["issues", "ok"]);
      assert.equal("value" in result, false);
    }
  }
});

test("H4. results, payloads and issue arrays are all FROZEN", () => {
  for (const result of allResults()) {
    assert.ok(Object.isFrozen(result), "the result is not frozen");
    if (result.ok) {
      assert.ok(Object.isFrozen(result.value), "the payload is not frozen");
    } else {
      assert.ok(Object.isFrozen(result.issues), "the issue array is not frozen");
      for (const issue of result.issues) {
        assert.ok(Object.isFrozen(issue), "an issue is not frozen");
      }
    }
  }
});

test("H5. a returned issue array does not ALIAS anything a caller can mutate", () => {
  const result = normalizeExamSessionCreateInput({});
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  const before = result.issues.length;
  const mutable = result.issues as unknown as ExamSessionWriteInputIssue[];
  assert.throws(() => {
    mutable.push({ code: "EX-SES-DATE-INVALID", message: "injected" });
  });
  assert.equal(result.issues.length, before);
});

// ===========================================================================
// I. Input is never mutated
// ===========================================================================

test("I1. rawInput is not mutated, and a FROZEN rawInput is accepted", () => {
  const raw = Object.freeze(validRaw());
  const snapshot = JSON.parse(JSON.stringify(raw));

  for (const { label, run } of NORMALIZERS) {
    const value = expectOk(run(raw));
    assert.deepEqual(JSON.parse(JSON.stringify(raw)), snapshot, `${label} mutated rawInput`);
    // The payload must be a COPY, not the raw object itself.
    assert.notEqual(value as unknown, raw as unknown, label);
  }
});

test("I2. a frozen INVALID rawInput is refused without throwing", () => {
  const raw = Object.freeze({ definitionId: "", date: "2026-02-31", startTime: "9:00" });
  assert.deepEqual(codesOf(normalizeExamSessionCreateInput(raw)), [
    "EX-SES-DEFINITION-REQUIRED",
    "EX-SES-DATE-INVALID",
    "EX-SES-START-TIME-INVALID",
  ]);
  assert.deepEqual(Object.keys(raw).sort(), ["date", "definitionId", "startTime"]);
});

test("I3. mutating rawInput AFTER normalization cannot change the payload", () => {
  const raw = validRaw();
  const value = expectOk(normalizeExamSessionCreateInput(raw));
  raw.definitionId = "hijacked";
  raw.date = "1999-01-01";
  raw.arena = "hijacked";
  assert.equal(value.definitionId, "cme1AbCdEf");
  assert.equal(value.date, "2026-03-15");
  assert.equal(value.arena, "זירה מקורה");
});

test("I4. the two payloads of one raw input do not alias each other", () => {
  const raw = validRaw();
  const created = expectOk(normalizeExamSessionCreateInput(raw));
  const edited = expectOk(normalizeExamSessionEditInput(raw));
  assert.notEqual(created as unknown, edited as unknown);
  assert.ok(Object.isFrozen(created));
  assert.ok(Object.isFrozen(edited));
});

// ===========================================================================
// J. Structural guards over the SOURCE TEXT
// ===========================================================================

const EXAM_DIR = join(process.cwd(), "lib", "exam");
const MODULE_NAME = "exam-session-write-core.ts";
const TEST_NAME = "exam-session-write-core.test.ts";

const SOURCE = readFileSync(join(EXAM_DIR, MODULE_NAME), "utf8");
/** The module with comments removed, so prose can discuss what code must not do. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

test("J1. the module touches no database, ORM or query of any kind", () => {
  // The two Prisma import specifiers are ASSEMBLED rather than spelled out: the
  // committed slice-wide guard (exam-no-feedback-guard.test.ts) substring-scans
  // EVERY file in lib/exam, including this one, so writing them literally would
  // make this very denial list trip that guard.
  const prismaSpecifiers = ["@" + "prisma/client", "@/lib/" + "prisma"];
  for (const token of [
    ...prismaSpecifiers,
    "prisma",
    "PrismaClient",
    "$transaction",
    "$executeRaw",
    "$queryRaw",
    "tx.",
  ]) {
    assert.equal(CODE.includes(token), false, `the module references ${token}`);
  }
  const writes =
    /\.(create|createMany|update|updateMany|upsert|delete|deleteMany|findUnique|findFirst|findMany|count|aggregate)\s*\(/;
  assert.equal(writes.test(CODE), false, "the module performs a database operation");
});

test("J2. the module is neither server-only nor a Server Action nor a client module", () => {
  // Checked against comment-stripped CODE, because the module's own header PROSE
  // legitimately names these directives in order to state that it carries none.
  for (const token of [
    "server-only",
    '"use server"',
    "'use server'",
    '"use client"',
    "'use client'",
  ]) {
    assert.equal(CODE.includes(token), false, `the module contains ${token}`);
  }

  // Stronger than a token scan: a directive prologue must be the FIRST statement
  // of a module to have any effect, so prove the first real line is an import.
  const firstStatement = CODE.split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  assert.equal(firstStatement, 'import { isValidHHMM } from "./exam-overlap-core";');
});

test("J3. the module imports nothing from app/, lib/actions or any framework", () => {
  for (const token of [
    "@/app",
    "lib/actions",
    "next/",
    "next/headers",
    "next/navigation",
    "react",
    "revalidatePath",
    "revalidateTag",
    "redirect(",
  ]) {
    assert.equal(CODE.includes(token), false, `the module references ${token}`);
  }
});

test("J4. the module performs NO authorization and reads no actor", () => {
  for (const token of [
    "requireAdmin",
    "requireCourseContext",
    "getCurrentInstructor",
    "getCurrentStudent",
    "getCurrentActor",
    "cookies(",
    "headers(",
    "auth",
    "Actor",
    "isAdmin",
  ]) {
    assert.equal(CODE.includes(token), false, `the module references ${token}`);
  }
});

test("J5. the module consults no capability of any kind", () => {
  for (const token of [
    '"EXAMS"',
    "'EXAMS'",
    "TEACHING_PRACTICE",
    "CapabilityKey",
    "capability",
    "Capability",
    "getEffectiveCapabilities",
  ]) {
    assert.equal(CODE.includes(token), false, `the module consults ${token}`);
  }
});

test("J6. the module reads no clock, no randomness, no env and no filesystem", () => {
  for (const token of [
    "new Date(",
    "Date.now(",
    "Date(",
    "Math.random",
    "process.env",
    "performance.now",
    "readFile",
    "writeFile",
    "fetch(",
    "setTimeout",
  ]) {
    assert.equal(CODE.includes(token), false, `the module uses ${token}`);
  }
});

test("J7. the module COERCES nothing", () => {
  for (const token of ["String(", "Number(", "parseInt", "parseFloat", "toLowerCase", "toUpperCase", "normalize(", "localeCompare", "JSON.parse"]) {
    assert.equal(CODE.includes(token), false, `the module uses ${token}`);
  }
});

test("J8. the module imposes NO arbitrary upper bound", () => {
  // Every length comparison must be against 0 (the emptiness check), never a cap.
  for (const match of CODE.matchAll(/\.length\s*(?:[<>]=?|===|!==)\s*(\d+)/g)) {
    assert.equal(match[1], "0", `the module bounds a length at ${match[1]}`);
  }
  for (const token of ["MAX_", "_MAX", "maxLength", "MAX)", "slice(0,", "substring(", "substr("]) {
    assert.equal(CODE.includes(token), false, `the module uses ${token}`);
  }
});

test("J9. the module expresses NO assignment, break, supervisor, publication or order logic", () => {
  for (const token of [
    "assignment",
    "Assignment",
    "supervisor",
    "Supervisor",
    "publish",
    "Publish",
    "published",
    "Published",
    "orderIndex",
    "OrderIndex",
    "wave",
    "Wave",
    "notification",
    "Notification",
    "conflict",
    "Conflict",
    "endTime",
    "capacity",
    "Capacity",
    "kind",
    "Kind",
    "BEGINNER",
    "phase",
    "Phase",
  ]) {
    assert.equal(CODE.includes(token), false, `the module references ${token}`);
  }
});

test("J10. the module imports EXACTLY the two committed pure helpers it reuses", () => {
  const specifiers = [...CODE.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual([...specifiers].sort(), [
    "../trainee-history/interval-resolver",
    "./exam-overlap-core",
  ]);
});

test("J11. the reused validators are CALLED, not re-implemented here", () => {
  assert.ok(/\bisValidDateKey\s*\(/.test(CODE), "the committed date validator is not called");
  assert.ok(/\bisValidHHMM\s*\(/.test(CODE), "the committed time validator is not called");
  // None of the calendar/clock rules those helpers own is restated in code here,
  // and the module declares no pattern of its own at all.
  for (const token of [
    "isLeapYear",
    "DAYS_IN_MONTH",
    "% 400",
    "% 100",
    "RegExp",
    ".test(",
    "match(",
    "/^",
  ]) {
    assert.equal(CODE.includes(token), false, `the module restates ${token}`);
  }
});

test("J12. TRANSITIVE purity: both reused modules are themselves import-free and clock-free", () => {
  const dependencies = [
    join(EXAM_DIR, "exam-overlap-core.ts"),
    join(process.cwd(), "lib", "trainee-history", "interval-resolver.ts"),
  ];
  for (const path of dependencies) {
    const depSource = readFileSync(path, "utf8");
    const depCode = depSource
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    // Zero imports at all, so nothing impure can arrive transitively.
    assert.equal(/^\s*import\s/m.test(depCode), false, `${path} imports something`);
    assert.equal(depCode.includes("require("), false, `${path} uses require()`);
    for (const token of [
      "new Date(",
      "Date.now(",
      "Math.random",
      "process.env",
      "prisma",
      "server-only",
      '"use server"',
      "next/",
      "fetch(",
    ]) {
      assert.equal(depCode.includes(token), false, `${path} uses ${token}`);
    }
  }
});

test("J13. the slice added EXACTLY two files", () => {
  const own = readdirSync(EXAM_DIR)
    .filter((name) => name.startsWith("exam-session-"))
    .sort();
  assert.deepEqual(own, [TEST_NAME, MODULE_NAME].sort());
  assert.equal(own.length, 2);
});

test("J14. the module exports exactly the intended surface", () => {
  const exported = [...SOURCE.matchAll(/^export\s+(?:async\s+)?(?:function|const|type|interface)\s+(\w+)/gm)].map(
    (match) => match[1],
  );
  assert.deepEqual([...exported].sort(), [
    "EXAM_SESSION_WRITE_INPUT_MESSAGES",
    "ExamSessionWriteInputIssue",
    "ExamSessionWriteInputIssueCode",
    "ExamSessionWriteInputResult",
    "NormalizedExamSessionCreate",
    "NormalizedExamSessionEdit",
    "normalizeExamSessionCreateInput",
    "normalizeExamSessionEditInput",
  ]);
});

test("J15. both payload types are declared SEPARATELY and hold exactly the six fields", () => {
  const bodies = [...SOURCE.matchAll(/export interface (NormalizedExamSession\w+)\s*\{([^}]*)\}/g)];
  assert.deepEqual(
    bodies.map((match) => match[1]).sort(),
    ["NormalizedExamSessionCreate", "NormalizedExamSessionEdit"],
    "the create and edit payloads must be two separate declarations, not one alias",
  );

  for (const [, name, body] of bodies) {
    const fields = [...body.matchAll(/readonly\s+(\w+)\s*:/g)].map((match) => match[1]);
    assert.deepEqual([...fields].sort(), [...SESSION_FIELDS].sort(), `${name} field set`);

    // Every field is a plain string-or-null: no Date, and no server-supplied value.
    assert.equal(/\bDate\b/.test(body), false, `${name} declares a Date`);
    for (const forbidden of [
      "courseOfferingId",
      "planId",
      "sessionId",
      "orderIndex",
      "expectedUpdatedAt",
    ]) {
      assert.equal(body.includes(forbidden), false, `${name} declares ${forbidden}`);
    }
  }
});
