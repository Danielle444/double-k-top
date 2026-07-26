/**
 * UNIFIED TRAINEE SCHEDULE - contract tests for the "הלו״ז שלי" week/day
 * navigation reader's wiring (lib/actions/unified-trainee-week-options.ts).
 *
 * lib/actions/unified-trainee-week-options.ts is a "use server" module that
 * transitively imports Prisma and next/headers (via trainee-course-selection.ts
 * and weekly-schedule.ts), so it cannot be imported into a plain `tsx --test`
 * process. This uses the repository's established SOURCE-CONTRACT pattern
 * (same convention as unified-trainee-schedule.contract.test.ts) to prove:
 * the reader takes no client-supplied course id or identity, the eligibility
 * gate runs before any per-offering read, every per-offering read reuses the
 * EXISTING course-scoped week reader rather than a new query, each
 * per-offering read is independently denial-tolerant, and the merge/default
 * pick go through the pure core and the existing pickDefaultWeekId rather
 * than an inline reimplementation.
 *
 * The pure merge/dedup/sort logic itself is proven DB-free in
 * lib/course/unified-trainee-week-options-core.test.ts.
 *
 * Run with:
 *   npx tsx --test lib/actions/unified-trainee-week-options.contract.test.ts
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

const SRC = readSource("./unified-trainee-week-options.ts");

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

/**
 * Extract the named bindings of an `import { A, B, type C } from "<moduleSpecifier>"`
 * block. Anchored on the exact `from "<moduleSpecifier>"` literal first, then
 * walks backward for the nearest preceding `import`/`{`/`}` triple - a plain
 * regex capture group here would happily backtrack PAST other import
 * statements' own closing braces on its way to a distant match, silently
 * concatenating unrelated names.
 */
function importedNames(moduleSpecifier: string): string[] {
  const fromIdx = SRC.indexOf(`from "${moduleSpecifier}"`);
  assert.notEqual(fromIdx, -1, `expected an import from "${moduleSpecifier}"`);
  const importIdx = SRC.lastIndexOf("import", fromIdx);
  assert.notEqual(importIdx, -1, `expected an "import" keyword before "${moduleSpecifier}"`);
  const braceOpen = SRC.indexOf("{", importIdx);
  const braceClose = SRC.indexOf("}", braceOpen);
  assert.ok(
    braceOpen !== -1 && braceClose !== -1 && braceOpen < fromIdx && braceClose < fromIdx,
    `expected a { ... } import block before "from \\"${moduleSpecifier}\\""`,
  );
  return SRC.slice(braceOpen + 1, braceClose)
    .split(",")
    .map((s) => s.trim().replace(/^type\s+/, ""))
    .filter((s) => s.length > 0);
}

// ---------------------------------------------------------------------------
// Signature: no parameters at all - no course id, no identity, no dual flag.
// ---------------------------------------------------------------------------

test("getUnifiedWeekOptionsForTrainee takes no parameters", () => {
  const params = parameterList(SRC, "getUnifiedWeekOptionsForTrainee");
  assert.equal(params.length, 0, `expected zero parameters, got: ${JSON.stringify(params)}`);
});

// ---------------------------------------------------------------------------
// The eligibility gate runs BEFORE any per-offering read.
// ---------------------------------------------------------------------------

test("the eligibility gate precedes every per-offering read", () => {
  const body = functionSource(SRC, "getUnifiedWeekOptionsForTrainee");
  const gate = requiredIndex(body, "isTraineeEligibleForUnifiedSchedule(options.length)", "eligibility gate");
  const perOffering = requiredIndex(
    body,
    "getWeeklyScheduleSelectionForTrainee(option.id)",
    "per-offering week selection",
  );
  assert.ok(gate < perOffering, "the eligibility gate must precede the per-offering week fetch");
});

test("an ineligible trainee gets the uniform empty result before any per-offering read", () => {
  const body = functionSource(SRC, "getUnifiedWeekOptionsForTrainee");
  assert.match(
    body,
    /if\s*\(!isTraineeEligibleForUnifiedSchedule\(options\.length\)\)\s*\{\s*return emptyUnifiedWeekOptionsResult\(\);\s*\}/,
  );
});

// ---------------------------------------------------------------------------
// Which offerings are read comes ONLY from the trainee's own session-derived
// eligible set - never a hardcoded id, never a client value.
// ---------------------------------------------------------------------------

test("offerings come only from listTraineeCourseOptions(), never a client id or a constant", () => {
  const body = functionSource(SRC, "getUnifiedWeekOptionsForTrainee");
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
// Every per-offering read reuses the EXISTING course-scoped reader - no new
// Prisma query, no admin/instructor reader import.
// ---------------------------------------------------------------------------

test("imports only the existing trainee course-scoped readers - no new Prisma query, no admin/instructor reader", () => {
  assert.match(
    SRC,
    /import\s*\{\s*listTraineeCourseOptions\s*\}\s*from\s*["']\.\/trainee-course-selection["']/,
  );
  assert.match(
    SRC,
    /import\s*\{\s*getWeeklyScheduleSelectionForTrainee\s*\}\s*from\s*["']\.\/weekly-schedule["']/,
  );
  assert.ok(!SRC.includes("prisma"), "the action must not import or call Prisma directly");
  assert.ok(!/instructor-directory|admin\//i.test(SRC), "must not import any admin/instructor reader");
});

// ---------------------------------------------------------------------------
// Independent per-offering behaviour: one offering's expected "not available"
// outcome (a narrow, typed course-context denial) must never sink another
// offering's already-valid contribution; anything else must still fail the
// whole request closed.
// ---------------------------------------------------------------------------

test("each per-offering read is wrapped in its own try/catch, inside the Promise.all map", () => {
  const body = functionSource(SRC, "getUnifiedWeekOptionsForTrainee");
  const promiseAll = requiredIndex(body, "await Promise.all(", "Promise.all");
  const optionsMap = requiredIndex(body, "options.map(async (option) => {", "per-offering map");
  const tryStart = requiredIndex(body, "try {", "try block");
  assert.ok(promiseAll < optionsMap, "Promise.all must wrap the per-offering map");
  assert.ok(optionsMap < tryStart, "the try block must be inside the per-offering map callback");
});

test("only the narrow trainee course-context denial is caught; it never sinks the whole batch", () => {
  const body = functionSource(SRC, "getUnifiedWeekOptionsForTrainee");
  assert.match(
    body,
    /catch \(error\) \{\s*if \(isTraineeCourseContextDenial\(error\)\) \{\s*return \{ offeringId: option\.id, weeks: \[\] as WeekOption\[\] \};\s*\}\s*throw error;\s*\}/,
    "the catch must check isTraineeCourseContextDenial specifically, return an empty contribution only on a match, and rethrow otherwise",
  );
});

test("the catch is not a blanket swallow - every catch clause rethrows a non-denial error", () => {
  const body = functionSource(SRC, "getUnifiedWeekOptionsForTrainee");
  const catchBlocks = body.match(/catch \([^)]*\) \{[\s\S]*?\n      \}/g) ?? [];
  assert.ok(catchBlocks.length >= 1, "expected at least one catch block");
  for (const block of catchBlocks) {
    assert.ok(/throw error;/.test(block), "every catch block must rethrow the non-denial case - never swallow silently");
  }
});

// ---------------------------------------------------------------------------
// The merge goes through the pure core, and the default week is picked via
// the EXISTING pickDefaultWeekId - no inline reimplementation.
// ---------------------------------------------------------------------------

test("the merged list is built by the pure core's merge function, not an inline dedup/sort", () => {
  const body = functionSource(SRC, "getUnifiedWeekOptionsForTrainee");
  assert.match(body, /const weeks = mergeUnifiedTraineeWeekOptions\(sources\);/);
  assert.ok(!/\.sort\(/.test(body), "sorting must live in the pure core, not inline here");
});

test("the default week is picked via the existing pickDefaultWeekId, never reimplemented", () => {
  const body = functionSource(SRC, "getUnifiedWeekOptionsForTrainee");
  assert.match(body, /pickDefaultWeekId\(weeks, todayDateKey\(\)\)/);
  assert.ok(!/function pickDefaultWeekId/.test(SRC), "must not redefine pickDefaultWeekId");
});

test("imports the pure core's decision functions, never redefines them", () => {
  const coreImports = importedNames("@/lib/course/course-scoped-week-options-core");
  assert.ok(coreImports.includes("isTraineeCourseContextDenial"));
  assert.ok(coreImports.includes("pickDefaultWeekId"));
  assert.ok(!/function isTraineeCourseContextDenial/.test(SRC));

  const unifiedCoreImports = importedNames("@/lib/course/unified-trainee-schedule-core");
  assert.ok(unifiedCoreImports.includes("isTraineeEligibleForUnifiedSchedule"));
  assert.ok(!/function isTraineeEligibleForUnifiedSchedule/.test(SRC));

  const mergeCoreImports = importedNames("@/lib/course/unified-trainee-week-options-core");
  assert.ok(mergeCoreImports.includes("mergeUnifiedTraineeWeekOptions"));
  assert.ok(!/function mergeUnifiedTraineeWeekOptions/.test(SRC));
});

test("uses the shared, timezone-correct todayDateKey - never a hand-rolled new Date() key", () => {
  const body = functionSource(SRC, "getUnifiedWeekOptionsForTrainee");
  assert.ok(!/new Date\(/.test(body), "must not construct a Date directly - reuse todayDateKey()");
  assert.match(SRC, /import\s*\{\s*todayDateKey\s*\}\s*from\s*["']@\/lib\/dates["']/);
});
