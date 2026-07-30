/**
 * EXAM — executable tests for the PURE admin schedule grouping core
 * (admin-exam-session-grouping-core.ts).
 *
 * Run with: npx tsx --test lib/exam/admin-exam-session-grouping-core.test.ts
 *
 * DB-FREE and PURE: no Prisma, no database connection, no SQL, no clock, no
 * randomness, no env, no auth, no cookie, no network. A few tests read the
 * core's own SOURCE TEXT from disk to prove structural properties; that is the
 * committed convention of the surrounding exam suites and touches no database.
 *
 * SCOPE OF PROOF: the locked day grouping and the locked within-day ordering
 * (`orderIndex` FIRST); that malformed rows and duplicate ids fail the whole
 * call rather than being dropped, collapsed or guessed at; that the day labels
 * are derived by integer arithmetic and match the product's existing Hebrew date
 * formatting; that no end time, wave, slot or capacity is derived; that the
 * input is never mutated and the output is frozen, JSON-safe and deterministic;
 * and that the slice is exactly two files with no impure import.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  groupAdminExamSessionsByDay,
  ADMIN_EXAM_SCHEDULE_GROUPING_MESSAGES,
  type AdminExamScheduleDay,
  type AdminExamScheduleGroupingIssue,
  type AdminExamScheduleGroupingIssueCode,
  type AdminExamScheduleGroupingResult,
  type GroupableAdminExamSession,
} from "./admin-exam-session-grouping-core";

const EXAM_DIR = import.meta.dirname;
const MODULE_NAME = "admin-exam-session-grouping-core.ts";
const TEST_NAME = "admin-exam-session-grouping-core.test.ts";
const CORE_SOURCE = readFileSync(join(EXAM_DIR, MODULE_NAME), "utf8");

/**
 * The core's source with comments removed. The structural guards must assert on
 * CODE, not on the prose documenting the very rules they enforce — the file
 * legitimately explains why `Date`, `Intl`, `endTime` and waves are excluded,
 * and a naive text scan would fire on every explanation.
 */
const CORE_CODE = CORE_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/**
 * Two specifiers assembled from pieces ON PURPOSE.
 *
 * The committed no-feedback guard scans EVERY file in lib/exam — test files
 * included — for these exact strings. A suite that spelled one of them whole
 * would register itself as the violation it is checking for.
 */
const PRISMA_CLIENT_SPECIFIER = "@prisma" + "/client";
const PRISMA_MODULE_SPECIFIER = "@/lib" + "/prisma";

// ===========================================================================
// Builders
// ===========================================================================

function row(over: Partial<GroupableAdminExamSession> = {}): GroupableAdminExamSession {
  return {
    sessionId: "s1",
    definitionId: "def-1",
    definitionName: "רכיבה",
    definitionKind: "INTERFACE_RIDING",
    dateKey: "2026-08-02",
    startTime: "09:00",
    arena: null,
    title: null,
    notes: null,
    orderIndex: 0,
    updatedAt: 1_700_000_000_000,
    assignmentCount: 0,
    ...over,
  };
}

/** A row with a deliberately WRONG value in one field, typed as the raw input. */
function badRow(field: string, value: unknown): GroupableAdminExamSession {
  return { ...row(), [field]: value } as unknown as GroupableAdminExamSession;
}

function expectOk(
  result: AdminExamScheduleGroupingResult,
): readonly AdminExamScheduleDay[] {
  assert.equal(result.ok, true, `expected success, got ${JSON.stringify(result)}`);
  assert.ok(result.ok);
  return result.days;
}

function expectIssues(
  result: AdminExamScheduleGroupingResult,
): readonly AdminExamScheduleGroupingIssue[] {
  assert.equal(result.ok, false, `expected failure, got ${JSON.stringify(result)}`);
  assert.ok(!result.ok);
  return result.issues;
}

function codes(result: AdminExamScheduleGroupingResult): AdminExamScheduleGroupingIssueCode[] {
  return expectIssues(result).map((issue) => issue.code);
}

function sessionIds(day: AdminExamScheduleDay): string[] {
  return day.sessions.map((session) => session.sessionId);
}

/** Recursively freeze a value, so any write attempt by the core would be observable. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const inner of Object.values(value as Record<string, unknown>)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

// ===========================================================================
// 1–5. Grouping and ordering
// ===========================================================================

test("1. empty input succeeds with no days at all", () => {
  const result = groupAdminExamSessionsByDay([]);
  assert.deepEqual(expectOk(result), []);
  // The success arm carries no `issues` key whatsoever.
  assert.equal(Object.prototype.hasOwnProperty.call(result, "issues"), false);
});

test("2. one day carries its sessions and its own date key", () => {
  const days = expectOk(
    groupAdminExamSessionsByDay([
      row({ sessionId: "a", orderIndex: 0 }),
      row({ sessionId: "b", orderIndex: 1, startTime: "10:30" }),
    ]),
  );

  assert.equal(days.length, 1);
  assert.equal(days[0].dateKey, "2026-08-02");
  assert.deepEqual(sessionIds(days[0]), ["a", "b"]);
});

test("3. multiple days are emitted, each holding only its own rows", () => {
  const days = expectOk(
    groupAdminExamSessionsByDay([
      row({ sessionId: "a", dateKey: "2026-08-03" }),
      row({ sessionId: "b", dateKey: "2026-08-02" }),
      row({ sessionId: "c", dateKey: "2026-08-03", orderIndex: 1 }),
    ]),
  );

  assert.equal(days.length, 2);
  assert.deepEqual(sessionIds(days[0]), ["b"]);
  assert.deepEqual(sessionIds(days[1]), ["a", "c"]);
});

test("4. days are ordered ASCENDING by date key, whatever the input order", () => {
  const keys = ["2026-12-01", "2026-01-05", "2027-01-01", "2026-01-31", "2025-12-31"];
  const days = expectOk(
    groupAdminExamSessionsByDay(
      keys.map((dateKey, index) => row({ sessionId: `s${index}`, dateKey })),
    ),
  );

  assert.deepEqual(
    days.map((day) => day.dateKey),
    ["2025-12-31", "2026-01-05", "2026-01-31", "2026-12-01", "2027-01-01"],
  );
});

test("5. sessions inside a day are ordered by orderIndex, then startTime, then name, then id", () => {
  // Every field disagrees with every other on purpose, so only the LOCKED
  // precedence can produce this answer.
  const input: GroupableAdminExamSession[] = [
    row({ sessionId: "late-order", orderIndex: 9, startTime: "07:00", definitionName: "א" }),
    row({ sessionId: "z", orderIndex: 1, startTime: "12:00", definitionName: "ב" }),
    row({ sessionId: "y", orderIndex: 1, startTime: "08:00", definitionName: "ת" }),
    row({ sessionId: "x", orderIndex: 0, startTime: "23:00", definitionName: "ת" }),
  ];

  const days = expectOk(groupAdminExamSessionsByDay(input));
  assert.deepEqual(sessionIds(days[0]), ["x", "y", "z", "late-order"]);

  // orderIndex genuinely LEADS: the 07:00 row sorts last because its sequence
  // number is last, and the 23:00 row sorts first because its sequence is 0.
  assert.equal(days[0].sessions[0].startTime, "23:00");
  assert.equal(days[0].sessions[3].startTime, "07:00");
});

test("6. an orderIndex tie falls to startTime, then definitionName, then sessionId", () => {
  const input: GroupableAdminExamSession[] = [
    row({ sessionId: "d", orderIndex: 3, startTime: "10:00", definitionName: "ב" }),
    row({ sessionId: "c", orderIndex: 3, startTime: "10:00", definitionName: "ב" }),
    row({ sessionId: "b", orderIndex: 3, startTime: "10:00", definitionName: "א" }),
    row({ sessionId: "a", orderIndex: 3, startTime: "09:00", definitionName: "ת" }),
  ];

  const days = expectOk(groupAdminExamSessionsByDay(input));
  assert.deepEqual(sessionIds(days[0]), ["a", "b", "c", "d"]);
});

test("7. the order is TOTAL: every permutation of the same rows yields one answer", () => {
  const rows: GroupableAdminExamSession[] = [
    row({ sessionId: "a", dateKey: "2026-08-03", orderIndex: 0 }),
    row({ sessionId: "b", dateKey: "2026-08-02", orderIndex: 1 }),
    row({ sessionId: "c", dateKey: "2026-08-02", orderIndex: 1, startTime: "08:00" }),
    row({ sessionId: "d", dateKey: "2026-08-02", orderIndex: 1, startTime: "08:00" }),
  ];
  const expected = JSON.stringify(groupAdminExamSessionsByDay(rows));

  // All 24 permutations of four rows.
  for (const [i, j, k, l] of [
    [0, 1, 2, 3], [0, 1, 3, 2], [0, 2, 1, 3], [0, 2, 3, 1], [0, 3, 1, 2], [0, 3, 2, 1],
    [1, 0, 2, 3], [1, 0, 3, 2], [1, 2, 0, 3], [1, 2, 3, 0], [1, 3, 0, 2], [1, 3, 2, 0],
    [2, 0, 1, 3], [2, 0, 3, 1], [2, 1, 0, 3], [2, 1, 3, 0], [2, 3, 0, 1], [2, 3, 1, 0],
    [3, 0, 1, 2], [3, 0, 2, 1], [3, 1, 0, 2], [3, 1, 2, 0], [3, 2, 0, 1], [3, 2, 1, 0],
  ]) {
    assert.equal(
      JSON.stringify(groupAdminExamSessionsByDay([rows[i], rows[j], rows[k], rows[l]])),
      expected,
    );
  }
});

test("8. grouping is by EXACT date key, and never by definition", () => {
  const days = expectOk(
    groupAdminExamSessionsByDay([
      row({ sessionId: "a", definitionId: "def-1", definitionName: "רכיבה" }),
      row({ sessionId: "b", definitionId: "def-2", definitionName: "ממשק", orderIndex: 1 }),
    ]),
  );

  // Two different exams on ONE day stay ONE day — definition grouping is a
  // different axis and is not this core's.
  assert.equal(days.length, 1);
  assert.deepEqual(sessionIds(days[0]), ["a", "b"]);
});

test("9. a session with zero assignments is grouped like any other", () => {
  const days = expectOk(
    groupAdminExamSessionsByDay([
      row({ sessionId: "empty", assignmentCount: 0 }),
      row({ sessionId: "staffed", assignmentCount: 4, orderIndex: 1 }),
    ]),
  );

  assert.deepEqual(sessionIds(days[0]), ["empty", "staffed"]);
  assert.equal(days[0].sessions[0].assignmentCount, 0);
});

// ===========================================================================
// 10–12. Day labels
// ===========================================================================

test("10. day labels match the product's existing Hebrew date formatting", () => {
  const cases: [string, string, string][] = [
    ["2026-08-02", "יום ראשון", "2 באוגוסט 2026"],
    ["2026-08-03", "יום שני", "3 באוגוסט 2026"],
    ["2026-08-08", "יום שבת", "8 באוגוסט 2026"],
    ["2026-01-01", "יום חמישי", "1 בינואר 2026"],
    ["1999-12-31", "יום שישי", "31 בדצמבר 1999"],
  ];

  for (const [dateKey, dayLabel, dateLabel] of cases) {
    const days = expectOk(groupAdminExamSessionsByDay([row({ dateKey })]));
    assert.equal(days[0].dayLabel, dayLabel, dateKey);
    assert.equal(days[0].dateLabel, dateLabel, dateKey);
  }
});

test("11. leap days and century rules are labelled correctly, with no Date involved", () => {
  const cases: [string, string, string][] = [
    ["2024-02-29", "יום חמישי", "29 בפברואר 2024"],
    ["2024-03-01", "יום שישי", "1 במרץ 2024"],
    ["2000-02-29", "יום שלישי", "29 בפברואר 2000"],
    ["2100-03-01", "יום שני", "1 במרץ 2100"],
  ];

  for (const [dateKey, dayLabel, dateLabel] of cases) {
    const days = expectOk(groupAdminExamSessionsByDay([row({ dateKey })]));
    assert.equal(days[0].dayLabel, dayLabel, dateKey);
    assert.equal(days[0].dateLabel, dateLabel, dateKey);
  }
});

test("12. the day of the month is NOT zero-padded, matching the long Hebrew form", () => {
  const days = expectOk(groupAdminExamSessionsByDay([row({ dateKey: "2026-08-05" })]));
  assert.equal(days[0].dateLabel, "5 באוגוסט 2026");
  assert.equal(days[0].dateKey, "2026-08-05");
});

// ===========================================================================
// 13–22. Fail-closed validation
// ===========================================================================

test("13. a duplicate sessionId fails the call and collapses nothing", () => {
  const result = groupAdminExamSessionsByDay([
    row({ sessionId: "same", startTime: "09:00" }),
    row({ sessionId: "same", startTime: "11:00", orderIndex: 1 }),
  ]);

  const issues = expectIssues(result);
  assert.deepEqual(
    issues.map((issue) => issue.code),
    ["EX-ASG-SESSION-ID-DUPLICATE"],
  );
  // The SECOND occurrence is the one reported, and it is observable.
  assert.equal(issues[0].index, 1);
  assert.equal(issues[0].sessionId, "same");
  // No days are returned at all — nothing was silently merged or dropped.
  assert.equal(Object.prototype.hasOwnProperty.call(result, "days"), false);
});

test("14. a malformed date key is refused with a stable code", () => {
  for (const dateKey of [
    "2026-13-01",
    "2026-02-31",
    "2026-00-10",
    "2026-8-2",
    "20260802",
    " 2026-08-02",
    "2026-08-02 ",
    "2026-08-02T00:00:00.000Z",
    "",
    "not-a-date",
    null,
    undefined,
    20260802,
  ]) {
    assert.deepEqual(
      codes(groupAdminExamSessionsByDay([badRow("dateKey", dateKey)])),
      ["EX-ASG-DATE-INVALID"],
      `accepted ${JSON.stringify(dateKey)}`,
    );
  }
});

test("15. a malformed start time is refused with a stable code", () => {
  for (const startTime of [
    "9:00",
    "24:00",
    "09:60",
    " 09:00",
    "09:00 ",
    "0900",
    "09:00:00",
    "",
    null,
    undefined,
    900,
  ]) {
    assert.deepEqual(
      codes(groupAdminExamSessionsByDay([badRow("startTime", startTime)])),
      ["EX-ASG-START-TIME-INVALID"],
      `accepted ${JSON.stringify(startTime)}`,
    );
  }
});

test("16. a negative, fractional or non-numeric orderIndex is refused", () => {
  for (const orderIndex of [
    -1,
    -0.5,
    0.5,
    1.000_1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 2,
    "0",
    null,
    undefined,
    true,
  ]) {
    assert.deepEqual(
      codes(groupAdminExamSessionsByDay([badRow("orderIndex", orderIndex)])),
      ["EX-ASG-ORDER-INDEX-INVALID"],
      `accepted ${JSON.stringify(orderIndex)}`,
    );
  }
});

test("17. a negative, fractional or non-numeric assignmentCount is refused", () => {
  for (const assignmentCount of [
    -1,
    2.5,
    Number.NaN,
    Number.NEGATIVE_INFINITY,
    "3",
    null,
    undefined,
    [],
  ]) {
    assert.deepEqual(
      codes(groupAdminExamSessionsByDay([badRow("assignmentCount", assignmentCount)])),
      ["EX-ASG-ASSIGNMENT-COUNT-INVALID"],
      `accepted ${JSON.stringify(assignmentCount)}`,
    );
  }
});

test("18. an invalid updatedAt version is refused", () => {
  for (const updatedAt of [
    -1,
    1_700_000_000_000.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    "1700000000000",
    null,
    undefined,
    {},
  ]) {
    assert.deepEqual(
      codes(groupAdminExamSessionsByDay([badRow("updatedAt", updatedAt)])),
      ["EX-ASG-UPDATED-AT-INVALID"],
      `accepted ${JSON.stringify(updatedAt)}`,
    );
  }
});

test("19. blank or non-string identity fields are refused, never coerced", () => {
  const expectations: [string, AdminExamScheduleGroupingIssueCode][] = [
    ["sessionId", "EX-ASG-SESSION-ID-INVALID"],
    ["definitionId", "EX-ASG-DEFINITION-ID-INVALID"],
    ["definitionName", "EX-ASG-DEFINITION-NAME-INVALID"],
    ["definitionKind", "EX-ASG-DEFINITION-KIND-INVALID"],
  ];

  for (const [field, code] of expectations) {
    for (const value of ["", "   ", null, undefined, 7, {}]) {
      assert.deepEqual(
        codes(groupAdminExamSessionsByDay([badRow(field, value)])),
        [code],
        `${field} accepted ${JSON.stringify(value)}`,
      );
    }
  }
});

test("20. an optional text field that is neither string nor null fails closed", () => {
  const expectations: [string, AdminExamScheduleGroupingIssueCode][] = [
    ["arena", "EX-ASG-ARENA-INVALID"],
    ["title", "EX-ASG-TITLE-INVALID"],
    ["notes", "EX-ASG-NOTES-INVALID"],
  ];

  for (const [field, code] of expectations) {
    for (const value of [undefined, 0, false, [], {}]) {
      assert.deepEqual(
        codes(groupAdminExamSessionsByDay([badRow(field, value)])),
        [code],
        `${field} accepted ${JSON.stringify(value)}`,
      );
    }
  }
});

test("21. a row that is not an object, and an input that is not a list, are reported not thrown", () => {
  for (const value of [null, undefined, "s1", 3, true]) {
    // The ROW ITSELF is the malformed value here, not one of its fields.
    const rows = [value, row()] as unknown as GroupableAdminExamSession[];
    const issues = expectIssues(groupAdminExamSessionsByDay(rows));
    assert.deepEqual(issues.map((issue) => issue.code), ["EX-ASG-ROW-INVALID"]);
    assert.equal(issues[0].index, 0);
    assert.equal(issues[0].sessionId, null);
  }

  for (const notAList of [null, undefined, "rows", 5, {}]) {
    const issues = expectIssues(
      groupAdminExamSessionsByDay(notAList as unknown as GroupableAdminExamSession[]),
    );
    assert.deepEqual(issues.map((issue) => issue.code), ["EX-ASG-INPUT-NOT-A-LIST"]);
    assert.equal(issues[0].index, -1);
  }
});

test("22. EVERY applicable issue is reported, ordered by input position then code", () => {
  const result = groupAdminExamSessionsByDay([
    row({ sessionId: "ok" }),
    badRow("dateKey", "2026-02-30"),
    { ...badRow("startTime", "25:00"), orderIndex: -4, sessionId: "third" },
  ]);

  const issues = expectIssues(result);
  assert.deepEqual(
    issues.map((issue) => [issue.index, issue.code]),
    [
      [1, "EX-ASG-DATE-INVALID"],
      [2, "EX-ASG-ORDER-INDEX-INVALID"],
      [2, "EX-ASG-START-TIME-INVALID"],
    ],
  );
  // Every issue carries the authoritative message for its code, and nothing else.
  for (const issue of issues) {
    assert.equal(issue.message, ADMIN_EXAM_SCHEDULE_GROUPING_MESSAGES[issue.code]);
    assert.deepEqual(Object.keys(issue).sort(), ["code", "index", "message", "sessionId"]);
  }
});

test("23. every issue code has a non-echoing Hebrew message", () => {
  const entries = Object.entries(ADMIN_EXAM_SCHEDULE_GROUPING_MESSAGES);
  assert.equal(entries.length, 15);
  for (const [code, message] of entries) {
    assert.ok(code.startsWith("EX-ASG-"), code);
    assert.ok(message.trim().length > 0, code);
    // No placeholder, and no echoed submitted value.
    for (const forbidden of ["{", "}", "${", "%s"]) {
      assert.equal(message.includes(forbidden), false, `${code} echoes via ${forbidden}`);
    }
  }
  assert.equal(Object.isFrozen(ADMIN_EXAM_SCHEDULE_GROUPING_MESSAGES), true);
});

// ===========================================================================
// 24–26. What a grouped session carries
// ===========================================================================

test("24. null optional fields are preserved as null, and text is preserved verbatim", () => {
  const nulls = expectOk(groupAdminExamSessionsByDay([row()]))[0].sessions[0];
  assert.equal(nulls.arena, null);
  assert.equal(nulls.title, null);
  assert.equal(nulls.notes, null);

  // Not trimmed, not blank-collapsed, not normalized: normalization is the write
  // path's job, and a read-side rewrite would hide a stored value.
  const preserved = expectOk(
    groupAdminExamSessionsByDay([
      row({ arena: "  מגרש עליון  ", title: "", notes: "שורה\nשנייה" }),
    ]),
  )[0].sessions[0];
  assert.equal(preserved.arena, "  מגרש עליון  ");
  assert.equal(preserved.title, "");
  assert.equal(preserved.notes, "שורה\nשנייה");
});

test("25. a grouped session carries EXACTLY the eleven approved fields", () => {
  const session = expectOk(groupAdminExamSessionsByDay([row()]))[0].sessions[0];
  assert.deepEqual(Object.keys(session).sort(), [
    "arena",
    "assignmentCount",
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

  // No end time, wave, slot, capacity, duration, publication or conflict field
  // is derived — none of them is knowable from this row.
  for (const absent of [
    "endTime",
    "effectiveEndTime",
    "derivedBlockEndTime",
    "durationMinutes",
    "waves",
    "wave",
    "slots",
    "slot",
    "capacity",
    "conflicts",
    "publishedAt",
    "isPublished",
    "dateKey",
  ]) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(session, absent),
      false,
      `a grouped session carries ${absent}`,
    );
  }
});

test("26. a day carries EXACTLY the four approved fields", () => {
  const day = expectOk(groupAdminExamSessionsByDay([row()]))[0];
  assert.deepEqual(Object.keys(day).sort(), ["dateKey", "dateLabel", "dayLabel", "sessions"]);
});

test("27. the core derives no end time, wave, slot or capacity anywhere in its code", () => {
  for (const token of [
    "endTime",
    "wave",
    "Wave",
    "slot",
    "Slot",
    "capacity",
    "Capacity",
    "duration",
    "Duration",
    "conflict",
    "Conflict",
    "published",
    "Published",
    "break",
    "supervisor",
  ]) {
    assert.equal(CORE_CODE.includes(token), false, `the core derives or models ${token}`);
  }
});

// ===========================================================================
// 28–31. Immutability, JSON safety, determinism
// ===========================================================================

test("28. the input array and every input row come back untouched", () => {
  const input = [
    row({ sessionId: "b", dateKey: "2026-08-03", orderIndex: 2 }),
    row({ sessionId: "a", dateKey: "2026-08-02", arena: "מגרש" }),
  ];
  const before = JSON.stringify(input);

  groupAdminExamSessionsByDay(input);

  assert.equal(JSON.stringify(input), before);
  assert.equal(input.length, 2);
  assert.equal(input[0].sessionId, "b");
  // Input rows are NOT frozen as a side effect either.
  assert.equal(Object.isFrozen(input[0]), false);
});

test("29. a deeply frozen input is accepted without throwing", () => {
  const input = deepFreeze([
    row({ sessionId: "a" }),
    row({ sessionId: "b", dateKey: "2026-08-04", orderIndex: 1 }),
  ]);

  const days = expectOk(groupAdminExamSessionsByDay(input));
  assert.deepEqual(days.map((day) => day.dateKey), ["2026-08-02", "2026-08-04"]);
});

test("30. the whole result is frozen, on both arms", () => {
  const ok = groupAdminExamSessionsByDay([row({ sessionId: "a" }), row({ sessionId: "b" })]);
  assert.equal(Object.isFrozen(ok), true);
  const days = expectOk(ok);
  assert.equal(Object.isFrozen(days), true);
  for (const day of days) {
    assert.equal(Object.isFrozen(day), true);
    assert.equal(Object.isFrozen(day.sessions), true);
    for (const session of day.sessions) assert.equal(Object.isFrozen(session), true);
  }
  // The frozen arrays genuinely refuse a push.
  assert.throws(() => (days as AdminExamScheduleDay[]).push(days[0]));
  assert.throws(() => (days[0].sessions as unknown[]).push(null));

  const failed = groupAdminExamSessionsByDay([badRow("dateKey", "nope")]);
  assert.equal(Object.isFrozen(failed), true);
  const issues = expectIssues(failed);
  assert.equal(Object.isFrozen(issues), true);
  for (const issue of issues) assert.equal(Object.isFrozen(issue), true);
});

test("31. the result is JSON-safe: plain objects, no undefined, no Date, no -0", () => {
  const result = groupAdminExamSessionsByDay([
    row({ sessionId: "a", arena: "מגרש", orderIndex: -0, assignmentCount: -0 }),
    row({ sessionId: "b", dateKey: "2026-08-04", title: "כותרת" }),
  ]);

  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);

  const session = expectOk(result)[0].sessions[0];
  assert.equal(Object.is(session.orderIndex, -0), false);
  assert.equal(Object.is(session.assignmentCount, -0), false);

  const walk = (value: unknown, path: string): void => {
    assert.notEqual(value, undefined, `${path} is undefined`);
    if (value === null || typeof value !== "object") return;
    assert.equal(value instanceof Date, false, `${path} is a Date`);
    assert.equal(value instanceof Map, false, `${path} is a Map`);
    assert.equal(value instanceof Set, false, `${path} is a Set`);
    if (Array.isArray(value)) {
      value.forEach((inner, index) => walk(inner, `${path}[${index}]`));
      return;
    }
    assert.equal(Object.getPrototypeOf(value), Object.prototype, `${path} is not a plain object`);
    for (const [key, inner] of Object.entries(value)) walk(inner, `${path}.${key}`);
  };
  walk(result, "result");
});

test("32. repeated calls are byte-identical, on both arms", () => {
  const rows = [
    row({ sessionId: "b", dateKey: "2026-08-03" }),
    row({ sessionId: "a", dateKey: "2026-08-02", arena: "מגרש" }),
    row({ sessionId: "c", dateKey: "2026-08-03", orderIndex: 1 }),
  ];
  const first = groupAdminExamSessionsByDay(rows);
  const second = groupAdminExamSessionsByDay(rows);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(first), JSON.stringify(second));

  const bad = [badRow("startTime", "99:99"), row({ sessionId: "x" })];
  assert.equal(
    JSON.stringify(groupAdminExamSessionsByDay(bad)),
    JSON.stringify(groupAdminExamSessionsByDay(bad)),
  );
});

// ===========================================================================
// 33–36. Structural purity and the slice's footprint
// ===========================================================================

test("33. the core imports EXACTLY the two approved pure primitives", () => {
  const specifiers = [...CORE_CODE.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]).sort();
  assert.deepEqual(specifiers, ["../trainee-history/interval-resolver", "./exam-overlap-core"]);
  // No dynamic import and no require slips past the static check above.
  assert.equal(/\bimport\s*\(/.test(CORE_CODE), false);
  assert.equal(/\brequire\s*\(/.test(CORE_CODE), false);
});

test("34. the core reaches no database, auth, Next, app or Server-Action surface", () => {
  for (const token of [
    PRISMA_CLIENT_SPECIFIER,
    PRISMA_MODULE_SPECIFIER,
    "PrismaClient",
    "prisma.",
    "$transaction",
    "lib/actions",
    "lib/auth",
    "next/headers",
    "next/navigation",
    "next/cache",
    "server-only",
    "use server",
    "use client",
    "@/app",
    "requireAdmin",
    "requireCurrent",
    "getCurrent",
    "cookies(",
    "revalidatePath",
    "capabilit",
    "migration",
  ]) {
    assert.equal(CORE_CODE.includes(token), false, `the pure core references ${token}`);
  }

  const dbCalls = /\.(create|createMany|update|updateMany|upsert|delete|deleteMany|findUnique|findFirst|findMany|count|aggregate)\s*\(/;
  assert.equal(dbCalls.test(CORE_CODE), false, "the pure core performs a database operation");
});

test("35. the core reads no clock, env or randomness, and parses no timezone", () => {
  for (const token of [
    "new Date",
    "Date.now",
    "Date(",
    "toISOString",
    "getTime(",
    "getTimezoneOffset",
    "Intl",
    "localeCompare",
    "Math.random",
    "crypto",
    "process.env",
    "parseDateKey",
    "getLocalDateKey",
    "todayDateKey",
    "Asia/Jerusalem",
    "UTC",
  ]) {
    assert.equal(CORE_CODE.includes(token), false, `the pure core uses ${token}`);
  }

  // ...and neither do the two primitives it imports, so purity holds
  // TRANSITIVELY rather than only at this file's boundary.
  for (const rel of [
    join(EXAM_DIR, "exam-overlap-core.ts"),
    join(EXAM_DIR, "..", "trainee-history", "interval-resolver.ts"),
  ]) {
    const dependency = readFileSync(rel, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    for (const token of ["new Date", "Date.now", "Math.random", "process.env", "from \""]) {
      assert.equal(dependency.includes(token), false, `${rel} uses ${token}`);
    }
  }
});

test("36. the slice is EXACTLY two files in lib/exam, and neither is a UI file", () => {
  const sliceFiles = readdirSync(EXAM_DIR)
    .filter((name) => name.startsWith("admin-exam-session-grouping-core"))
    .sort();
  assert.deepEqual(sliceFiles, [MODULE_NAME, TEST_NAME].sort());
  for (const name of sliceFiles) assert.equal(name.endsWith(".tsx"), false, `${name} is a UI file`);
});

test("37. the core exports exactly one function, and no side effect runs on import", () => {
  const exportedFunctions = [...CORE_CODE.matchAll(/export function (\w+)/g)].map((m) => m[1]);
  assert.deepEqual(exportedFunctions, ["groupAdminExamSessionsByDay"]);
  assert.equal(typeof groupAdminExamSessionsByDay, "function");
  assert.equal(groupAdminExamSessionsByDay.length, 1);
});
