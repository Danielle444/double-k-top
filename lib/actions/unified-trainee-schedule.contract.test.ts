/**
 * UNIFIED TRAINEE SCHEDULE - SLICE U0: contract tests for the "הלו״ז שלי"
 * reader's wiring.
 *
 * lib/actions/unified-trainee-schedule.ts is a "use server" module that
 * transitively imports Prisma and next/headers (via student-schedule.ts,
 * weekly-schedule.ts and the Actor DAL), so it cannot be imported into a
 * plain `tsx --test` process. This uses the repository's established
 * SOURCE-CONTRACT pattern (same convention as
 * student-schedule.course-scope.test.ts) to prove: the reader takes no
 * client-supplied course id or identity, the eligibility gate runs before any
 * per-offering read, every per-offering read reuses the EXISTING course-scoped
 * actions rather than a new query, the real session-derived trainee id (never
 * a client value) is what reaches getScheduleForStudent, and the merge goes
 * through the pure core rather than an inline reimplementation.
 *
 * The pure eligibility/merge/tag/sort/day-match logic itself is proven DB-free
 * in lib/course/unified-trainee-schedule-core.test.ts.
 *
 * Run with:
 *   npx tsx --test lib/actions/unified-trainee-schedule.contract.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function readSource(relative: string): string {
  // Normalise CRLF -> LF so column-0 / substring anchors below are stable on
  // Windows working trees.
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

const SRC = readSource("./unified-trainee-schedule.ts");

function parameterList(src: string, name: string): string[] {
  const sigMarker = `export async function ${name}(`;
  const start = src.indexOf(sigMarker);
  assert.notEqual(start, -1, `expected to find ${name} in source`);
  const open = start + sigMarker.length - 1;
  let depth = 0;
  let close = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")") {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  assert.notEqual(close, -1, `unbalanced parameter list for ${name}`);
  return src
    .slice(open + 1, close)
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function functionSource(src: string, name: string): string {
  const sigMarker = `export async function ${name}(`;
  const start = src.indexOf(sigMarker);
  assert.notEqual(start, -1, `expected to find ${name} in source`);
  const end = src.indexOf("\n}\n", start);
  assert.ok(end > start, "expected the function to close");
  return src.slice(start, end);
}

function requiredIndex(haystack: string, needle: string, label: string): number {
  const i = haystack.indexOf(needle);
  assert.notEqual(i, -1, `${label}: expected to find \`${needle}\``);
  return i;
}

// ---------------------------------------------------------------------------
// Signature: exactly one parameter, a plain day key - no course id, no
// identity, no dual flag.
// ---------------------------------------------------------------------------

test("getUnifiedScheduleForTrainee takes exactly one parameter: a plain day key", () => {
  const params = parameterList(SRC, "getUnifiedScheduleForTrainee");
  assert.equal(params.length, 1, `expected exactly 1 parameter, got: ${JSON.stringify(params)}`);
  assert.match(params[0], /^dayKey:\s*string$/);
});

test("no parameter accepts a client-supplied course id, actor id, or dual flag", () => {
  for (const param of parameterList(SRC, "getUnifiedScheduleForTrainee")) {
    assert.ok(
      !/courseOffering|studentId|traineeId|instructorId|dual|actor/i.test(param),
      `parameter "${param}" must not accept a client-supplied course id, identity, or dual flag`,
    );
  }
});

// ---------------------------------------------------------------------------
// The eligibility gate runs BEFORE any per-offering read.
// ---------------------------------------------------------------------------

test("the eligibility gate precedes the session read and every per-offering call", () => {
  const body = functionSource(SRC, "getUnifiedScheduleForTrainee");
  const gate = requiredIndex(body, "isTraineeEligibleForUnifiedSchedule(options.length)", "eligibility gate");
  const sessionRead = requiredIndex(body, "await requireCurrentTrainee()", "session read");
  const weekSelection = requiredIndex(
    body,
    "getWeeklyScheduleSelectionForTrainee(option.id)",
    "per-offering week selection",
  );
  const scheduleRead = requiredIndex(body, "getScheduleForStudent(", "per-offering schedule read");
  assert.ok(gate < sessionRead, "the eligibility gate must precede the session read");
  assert.ok(sessionRead < weekSelection, "the session read must precede any per-offering read");
  assert.ok(gate < scheduleRead, "the eligibility gate must precede the per-offering schedule read");
});

test("an ineligible trainee gets the uniform empty result before any per-offering read", () => {
  const body = functionSource(SRC, "getUnifiedScheduleForTrainee");
  assert.match(
    body,
    /if\s*\(!isTraineeEligibleForUnifiedSchedule\(options\.length\)\)\s*\{\s*return emptyUnifiedScheduleResult\(\);\s*\}/,
  );
});

// ---------------------------------------------------------------------------
// Which offerings are read comes ONLY from the trainee's own session-derived
// eligible set - never a hardcoded id, never a client value.
// ---------------------------------------------------------------------------

test("offerings come only from listTraineeCourseOptions(), never a client id or a constant", () => {
  const body = functionSource(SRC, "getUnifiedScheduleForTrainee");
  assert.match(body, /const options = await listTraineeCourseOptions\(\);/);
  assert.match(body, /options\.map\(/, "every offering read must iterate the server-derived options list");
  for (const forbidden of [
    "LEVEL_1_COURSE_OFFERING_ID",
    "LEVEL_2_COURSE_OFFERING_ID",
    "temporary-level2-compatibility",
  ]) {
    assert.ok(!SRC.includes(forbidden), `must not reference "${forbidden}"`);
  }
});

// ---------------------------------------------------------------------------
// Every per-offering read reuses the EXISTING course-scoped actions - no new
// Prisma query, no admin/instructor reader import.
// ---------------------------------------------------------------------------

test("imports only the existing trainee course-scoped readers - no new Prisma query, no admin/instructor reader", () => {
  assert.match(SRC, /import\s*\{\s*requireCurrentTrainee\s*\}\s*from\s*["']@\/lib\/auth\/actor["']/);
  assert.match(
    SRC,
    /import\s*\{\s*listTraineeCourseOptions\s*\}\s*from\s*["']\.\/trainee-course-selection["']/,
  );
  assert.match(
    SRC,
    /import\s*\{\s*getWeeklyScheduleSelectionForTrainee\s*\}\s*from\s*["']\.\/weekly-schedule["']/,
  );
  assert.match(
    SRC,
    /import\s*\{[^}]*\bgetScheduleForStudent\b[^}]*\}\s*from\s*["']\.\/student-schedule["']/,
  );
  assert.ok(!SRC.includes("prisma"), "the action must not import or call Prisma directly");
  assert.ok(!/instructor-directory|admin\//i.test(SRC), "must not import any admin/instructor reader");
});

test("the real session-derived trainee id, never a client value, reaches getScheduleForStudent", () => {
  const body = functionSource(SRC, "getUnifiedScheduleForTrainee");
  assert.match(body, /const trainee = await requireCurrentTrainee\(\);/);
  assert.match(
    body,
    /getScheduleForStudent\(trainee\.id,\s*week\.id,\s*dayKey,\s*groupFilter,\s*option\.id\)/,
  );
});

// ---------------------------------------------------------------------------
// The merge goes through the pure core - no inline reimplementation of
// placeholder exclusion, tagging, or sorting.
// ---------------------------------------------------------------------------

test("the result is built by the pure core's merge function, not an inline sort/filter", () => {
  const body = functionSource(SRC, "getUnifiedScheduleForTrainee");
  assert.match(body, /return \{ eligible: true, items: mergeUnifiedScheduleSources\(sources\) \};/);
  assert.ok(!/\.sort\(/.test(body), "sorting must live in the pure core, not inline here");
  assert.ok(
    !/isCombinedParticipationPlaceholder/.test(body),
    "placeholder exclusion must live in the pure core, not be reimplemented here",
  );
});

test("imports the pure core's decision functions, never redefines them", () => {
  assert.match(
    SRC,
    /import\s*\{[\s\S]*?isTraineeEligibleForUnifiedSchedule[\s\S]*?\}\s*from\s*["']@\/lib\/course\/unified-trainee-schedule-core["']/,
  );
  for (const fn of [
    "unifiedScheduleGroupFilterForOfferingLevel",
    "findUnifiedScheduleWeekForDay",
    "mergeUnifiedScheduleSources",
  ]) {
    assert.ok(SRC.includes(fn), `expected the action to use ${fn} from the pure core`);
  }
});

// ---------------------------------------------------------------------------
// Independent per-offering behaviour: one offering's expected "not available"
// outcome (a narrow, typed course-context denial) must never sink another
// offering's already-valid contribution; anything else must still fail the
// whole request closed.
// ---------------------------------------------------------------------------

test("each per-offering read is wrapped in its own try/catch, inside the Promise.all map", () => {
  const body = functionSource(SRC, "getUnifiedScheduleForTrainee");
  const promiseAll = requiredIndex(body, "await Promise.all(", "Promise.all");
  const optionsMap = requiredIndex(body, "options.map(async (option) => {", "per-offering map");
  const tryStart = requiredIndex(body, "try {", "try block");
  assert.ok(promiseAll < optionsMap, "Promise.all must wrap the per-offering map");
  assert.ok(optionsMap < tryStart, "the try block must be inside the per-offering map callback");
});

test("only the narrow trainee course-context denial is caught; it never sinks the whole batch", () => {
  const body = functionSource(SRC, "getUnifiedScheduleForTrainee");
  assert.match(
    body,
    /catch \(error\) \{\s*if \(isTraineeCourseContextDenial\(error\)\) \{\s*return \{ offering: option, items: \[\] as ScheduleItemView\[\] \};\s*\}\s*throw error;\s*\}/,
    "the catch must check isTraineeCourseContextDenial specifically, return an empty contribution only on a match, and rethrow otherwise",
  );
});

test("the catch is not a blanket swallow - every catch clause rethrows a non-denial error", () => {
  const body = functionSource(SRC, "getUnifiedScheduleForTrainee");
  const catchBlocks = body.match(/catch \([^)]*\) \{[\s\S]*?\n      \}/g) ?? [];
  assert.ok(catchBlocks.length >= 1, "expected at least one catch block");
  for (const block of catchBlocks) {
    assert.ok(/throw error;/.test(block), "every catch block must rethrow the non-denial case - never swallow silently");
  }
});

test("imports isTraineeCourseContextDenial from the existing pure course-context core, never redefines it", () => {
  assert.match(
    SRC,
    /import\s*\{\s*isTraineeCourseContextDenial\s*\}\s*from\s*["']@\/lib\/course\/course-scoped-week-options-core["']/,
  );
  assert.ok(
    !/function isTraineeCourseContextDenial/.test(SRC),
    "must not redefine the denial predicate - it must stay the single shared definition",
  );
});
