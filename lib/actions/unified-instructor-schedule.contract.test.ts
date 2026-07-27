/**
 * UNIFIED INSTRUCTOR SCHEDULE - SLICE IUS-2: contract tests for BOTH unified
 * instructor readers' wiring.
 *
 * lib/actions/unified-instructor-schedule.ts and
 * lib/actions/unified-instructor-week-options.ts are "use server" modules that
 * transitively import Prisma and next/headers (via instructor-course-options.ts,
 * instructor-schedule-course-scoped.ts and the Actor DAL), so neither can be
 * imported into a plain `tsx --test` process. This uses the repository's
 * established SOURCE-CONTRACT pattern (same convention as
 * unified-trainee-schedule.contract.test.ts) to prove: neither reader takes a
 * client-supplied identity or course id, the offering menu is loaded
 * server-side, the eligibility gate runs before any per-offering read, every
 * per-offering read reuses the EXISTING course-scoped actions rather than a new
 * query, NO direct Prisma call is introduced, per-offering denial handling is
 * narrow while infrastructure faults propagate, and the merge goes through the
 * committed pure cores rather than an inline reimplementation.
 *
 * The pure range/merge/tag/sort/coverage logic itself is proven DB-free in
 * lib/course/unified-instructor-schedule-core.test.ts and
 * lib/course/unified-instructor-week-options-core.test.ts.
 *
 * Run with:
 *   npx tsx --test lib/actions/unified-instructor-schedule.contract.test.ts
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

const SCHEDULE = readSource("./unified-instructor-schedule.ts");
const WEEK_OPTIONS = readSource("./unified-instructor-week-options.ts");

/** Strips block and line comments so prose about a rule can never satisfy the rule. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

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

const READERS: { label: string; src: string; fn: string }[] = [
  { label: "getUnifiedScheduleForInstructor", src: SCHEDULE, fn: "getUnifiedScheduleForInstructor" },
  { label: "getUnifiedInstructorWeekOptions", src: WEEK_OPTIONS, fn: "getUnifiedInstructorWeekOptions" },
];

// ---------------------------------------------------------------------------
// (6)(7) No client-supplied identity and no client-supplied course context.
// ---------------------------------------------------------------------------

test("neither unified reader accepts an instructorId anywhere in the module", () => {
  for (const { label, src } of READERS) {
    assert.equal(/instructorId/.test(code(src)), false, `${label} must never name an instructorId`);
  }
});

test("neither unified reader accepts a courseOfferingId parameter", () => {
  for (const { label, src, fn } of READERS) {
    for (const param of parameterList(src, fn)) {
      assert.ok(
        !/courseOffering|instructorId|actorId|eligible/i.test(param),
        `${label}: parameter \`${param}\` must not carry course context, identity or an eligibility flag`,
      );
    }
  }
});

test("getUnifiedInstructorWeekOptions takes NO parameters at all", () => {
  assert.deepEqual(parameterList(WEEK_OPTIONS, "getUnifiedInstructorWeekOptions"), []);
});

test("getUnifiedScheduleForInstructor takes exactly a range, a day key and the existing filter", () => {
  const params = parameterList(SCHEDULE, "getUnifiedScheduleForInstructor");
  assert.equal(params.length, 4, `expected exactly 4 parameters, got: ${JSON.stringify(params)}`);
  assert.match(params[0], /^rangeStart:\s*string$/);
  assert.match(params[1], /^rangeEnd:\s*string$/);
  assert.match(params[2], /^dayKey:\s*string \| "all"$/);
  assert.match(params[3], /^filter:\s*InstructorScheduleFilter$/);
});

// ---------------------------------------------------------------------------
// (8) The offering menu is loaded SERVER-SIDE, and gates before any read.
// ---------------------------------------------------------------------------

test("both readers load the addressable offerings from the server-side, session-derived menu", () => {
  for (const { label, src, fn } of READERS) {
    const body = code(functionSource(src, fn));
    assert.ok(
      body.includes("await listInstructorContactCourseOptions()"),
      `${label} must load offerings from the server-side allow-listed menu`,
    );
  }
});

test("the eligibility gate runs BEFORE any per-offering read, in both readers", () => {
  for (const { label, src, fn } of READERS) {
    const body = code(functionSource(src, fn));
    const options = requiredIndex(body, "listInstructorContactCourseOptions()", `${label} options load`);
    const gate = requiredIndex(body, "isInstructorEligibleForUnifiedSchedule(options.length)", `${label} gate`);
    const firstRead = requiredIndex(body, "getInstructorWeekSelection(", `${label} per-offering read`);
    assert.ok(options < gate, `${label}: offerings must be loaded before the gate`);
    assert.ok(gate < firstRead, `${label}: the gate must precede every per-offering read`);
  }
});

test("an ineligible instructor gets the uniform empty result, never a partial list", () => {
  assert.match(
    code(functionSource(WEEK_OPTIONS, "getUnifiedInstructorWeekOptions")),
    /if \(!isInstructorEligibleForUnifiedSchedule\(options\.length\)\) \{\s*return emptyUnifiedInstructorWeekOptionsResult\(\);/,
  );
  assert.match(
    code(functionSource(SCHEDULE, "getUnifiedScheduleForInstructor")),
    /if \(!isInstructorEligibleForUnifiedSchedule\(options\.length\)\) \{\s*return emptyUnifiedInstructorScheduleResult\(\);/,
  );
  for (const [label, src] of [["weeks", WEEK_OPTIONS], ["schedule", SCHEDULE]] as const) {
    assert.match(src, /eligible: false/, `${label}: the empty result must report eligible: false`);
  }
});

// ---------------------------------------------------------------------------
// (9) Existing course-scoped readers are reused, never reimplemented.
// ---------------------------------------------------------------------------

test("every per-offering week list comes from the EXISTING getInstructorWeekSelection", () => {
  for (const { label, src, fn } of READERS) {
    const body = code(functionSource(src, fn));
    assert.ok(
      body.includes("await getInstructorWeekSelection(option.id)"),
      `${label} must reuse the existing course-scoped week reader`,
    );
  }
  for (const { label, src } of READERS) {
    assert.match(
      src,
      /from "\.\/instructor-schedule-course-scoped"/,
      `${label} must import the existing course-scoped action module`,
    );
  }
});

test("every per-offering item read goes through the EXISTING getCourseScopedScheduleForInstructor", () => {
  const body = code(functionSource(SCHEDULE, "getUnifiedScheduleForInstructor"));
  assert.ok(body.includes("getCourseScopedScheduleForInstructor(option.id, week.id, dayKey, filter)"));
  // The week id passed is one of THIS offering's own resolved weeks - never the
  // merged picker's id, which can belong to the other offering.
  const resolve = requiredIndex(body, "findUnifiedInstructorWeeksForRange(selection.weeks,", "range->weeks resolve");
  const read = requiredIndex(body, "getCourseScopedScheduleForInstructor(", "item read");
  assert.ok(resolve < read, "weeks must be resolved from this offering's own list before any item read");
});

test("overlap-matched weeks are narrowed to the selected range before merging", () => {
  const body = code(functionSource(SCHEDULE, "getUnifiedScheduleForInstructor"));
  const read = requiredIndex(body, "getCourseScopedScheduleForInstructor(", "item read");
  const narrow = requiredIndex(body, "filterUnifiedInstructorItemsToRange(", "range narrowing");
  const merge = requiredIndex(body, "mergeUnifiedInstructorScheduleSources(sources)", "merge");
  assert.ok(read < narrow, "narrowing must follow the read");
  assert.ok(narrow < merge, "narrowing must precede the merge");
});

test("the merge itself goes through the committed pure cores, not an inline reimplementation", () => {
  assert.ok(
    code(SCHEDULE).includes("mergeUnifiedInstructorScheduleSources(sources)"),
    "schedule reader must delegate the merge to the pure core",
  );
  assert.ok(
    code(WEEK_OPTIONS).includes("mergeUnifiedInstructorWeekOptions(sources)"),
    "week-options reader must delegate the merge to the pure core",
  );
  // No hand-rolled sort/dedup in either shell.
  for (const { label, src } of READERS) {
    assert.equal(/\.sort\(/.test(code(src)), false, `${label} must not sort inline`);
    assert.equal(/new Map\(|new Set\(/.test(code(src)), false, `${label} must not dedup inline`);
  }
});

test("the source tag preserves offering id, label and level for the merge core", () => {
  const body = code(functionSource(SCHEDULE, "getUnifiedScheduleForInstructor"));
  assert.ok(body.includes("{ id: option.id, label: option.label, level: option.level }"));
});

test("the default selected week reuses the committed pickDefaultWeekId + server clock", () => {
  const body = code(functionSource(WEEK_OPTIONS, "getUnifiedInstructorWeekOptions"));
  assert.ok(body.includes("pickDefaultWeekId(weeks, todayDateKey())"));
});

// ---------------------------------------------------------------------------
// (10) No direct Prisma query is added by either reader.
// ---------------------------------------------------------------------------

test("neither unified reader touches Prisma directly", () => {
  for (const { label, src } of READERS) {
    const body = code(src);
    assert.equal(/prisma\./.test(body), false, `${label} must add no direct Prisma query`);
    assert.equal(/from "@\/lib\/prisma"/.test(body), false, `${label} must not import the Prisma client`);
  }
});

test("neither unified reader performs its own authorization, capability or session read", () => {
  for (const { label, src } of READERS) {
    const body = code(src);
    assert.equal(
      /requireCurrentInstructor|getEffectiveCapabilities|resolveInstructorCourseOffering|cookies\(|next\/headers/.test(body),
      false,
      `${label} must delegate every gate to the existing readers, never re-implement one`,
    );
  }
});

// ---------------------------------------------------------------------------
// (11)(12) Per-offering denial is narrow; infrastructure faults propagate.
// ---------------------------------------------------------------------------

test("the per-offering catch is narrow: only the typed instructor schedule denial is swallowed", () => {
  for (const { label, src, fn } of READERS) {
    const body = code(functionSource(src, fn));
    assert.ok(
      body.includes("if (isInstructorScheduleDenial(error)) {"),
      `${label} must classify the error before swallowing it`,
    );
    assert.ok(body.includes("throw error;"), `${label} must rethrow anything that is not a denial`);
    // A bare catch-all would silently turn a DB outage into "this course has no
    // items", producing a merged view that looks complete but is not.
    assert.equal(
      /catch\s*\([a-zA-Z]+\)\s*\{\s*return/.test(body),
      false,
      `${label} must not swallow errors unconditionally`,
    );
  }
});

test("a denied offering costs only its OWN contribution, never the whole merge", () => {
  const scheduleBody = code(functionSource(SCHEDULE, "getUnifiedScheduleForInstructor"));
  assert.ok(scheduleBody.includes("return { offering, items: [] as InstructorScheduleItem[] };"));
  const weeksBody = code(functionSource(WEEK_OPTIONS, "getUnifiedInstructorWeekOptions"));
  assert.ok(weeksBody.includes("return { offeringId: option.id, weeks: [] as UnifiedInstructorWeekOption[] };"));
});

test("offerings are fanned out concurrently, one contribution each", () => {
  for (const { label, src, fn } of READERS) {
    const body = code(functionSource(src, fn));
    assert.ok(body.includes("await Promise.all("), `${label} must fan out over offerings`);
    assert.ok(body.includes("options.map(async (option) =>"), `${label} must produce one source per offering`);
  }
});

// ---------------------------------------------------------------------------
// Trainee isolation - the locked architectural boundary.
// ---------------------------------------------------------------------------

test("neither unified instructor reader imports any trainee reader or trainee core", () => {
  for (const { label, src } of READERS) {
    const body = code(src);
    assert.equal(
      /unified-trainee|student-schedule|trainee-course-selection|getScheduleForStudent/.test(body),
      false,
      `${label} must not couple to the trainee schedule path`,
    );
  }
});

test("neither unified instructor reader imports combined-participation-visibility-core", () => {
  for (const { label, src } of READERS) {
    assert.equal(
      /combined-participation-visibility-core/.test(code(src)),
      false,
      `${label} must never call the trainee-only visibility core (see that module's own header)`,
    );
  }
});

test("both readers are server modules", () => {
  for (const { label, src } of READERS) {
    assert.match(src, /^"use server";/, `${label} must be a server module`);
  }
});
