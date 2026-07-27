/**
 * UNIFIED INSTRUCTOR TODAY SCHEDULE - SLICE IUS-2B: contract tests for the
 * "הלו״ז המשולב שלי" TODAY reader's wiring.
 *
 * lib/actions/unified-instructor-today-schedule.ts is a "use server" module
 * that transitively imports Prisma and next/headers, so it cannot be imported
 * into a plain `tsx --test` process. This uses the repository's established
 * SOURCE-CONTRACT pattern to prove: the reader takes NOTHING from the client,
 * the offering menu is loaded server-side, the eligibility gate runs before any
 * per-offering read, every read reuses the EXISTING course-scoped today action
 * with the fixed mine-only filter, NO direct Prisma call is introduced, no fake
 * WeeklySchedule id is manufactured, per-offering denial handling is narrow
 * while infrastructure faults propagate, and the merge goes through the
 * committed pure core shared with the weekly view.
 *
 * Run with:
 *   npx tsx --test lib/actions/unified-instructor-today-schedule.contract.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

const SRC = readSource("./unified-instructor-today-schedule.ts");

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

const FN = "getUnifiedTodayScheduleForInstructor";

// ---------------------------------------------------------------------------
// (7)(8) No client-supplied identity, course context, date or filter.
// ---------------------------------------------------------------------------

test("the unified today reader takes NO parameters at all", () => {
  assert.deepEqual(parameterList(SRC, FN), []);
});

test("the module never names an instructorId", () => {
  assert.equal(/instructorId/.test(code(SRC)), false);
});

test("the module accepts no courseOfferingId from a caller", () => {
  const body = code(functionSource(SRC, FN));
  // The only offering ids in play come from the server-side menu.
  assert.ok(body.includes("option.id"), "offering ids must come from the server-composed menu");
  assert.equal(
    /function [^(]*\([^)]*courseOfferingId/.test(code(SRC)),
    false,
    "no exported function may take a courseOfferingId",
  );
});

test("the client sends no date - today is derived server-side by the existing reader", () => {
  const body = code(functionSource(SRC, FN));
  assert.equal(/todayDateKey|dateKey|new Date\(|Date\.now/.test(body), false,
    "this shell must not read or accept a clock value - getTodayScheduleForInstructor owns it");
});

// ---------------------------------------------------------------------------
// (9) Existing per-offering today reader, with the fixed mine-only filter.
// ---------------------------------------------------------------------------

test("every per-offering read goes through the EXISTING getTodayScheduleForInstructor", () => {
  const body = code(functionSource(SRC, FN));
  assert.ok(body.includes("await getTodayScheduleForInstructor("));
  assert.match(code(SRC), /from "\.\/instructor-schedule-course-scoped"/);
});

test("the filter is a fixed server-side mine-only constant, never a parameter", () => {
  assert.match(
    code(SRC),
    /const UNIFIED_INSTRUCTOR_TODAY_FILTER: InstructorScheduleFilter = "mine";/,
  );
  const body = code(functionSource(SRC, FN));
  assert.ok(body.includes("UNIFIED_INSTRUCTOR_TODAY_FILTER,"));
  for (const param of parameterList(SRC, FN)) {
    assert.ok(!/filter/i.test(param), `parameter \`${param}\` must not carry a filter`);
  }
});

test("the reader never requests the \"all\" filter", () => {
  assert.equal(/"all"/.test(code(SRC)), false, "an \"all\" mode must not be reachable here");
});

test("the instructor-matching helper is reused, never duplicated", () => {
  assert.equal(
    /isInstructorMatch|normalizeHebrewName|isMealItem/.test(code(SRC)),
    false,
    "\"mine\" semantics belong to the existing scoped reader",
  );
});

// ---------------------------------------------------------------------------
// Server-side offering menu + eligibility gate ordering.
// ---------------------------------------------------------------------------

test("the addressable offerings come from the server-side, session-derived menu", () => {
  const body = code(functionSource(SRC, FN));
  assert.ok(body.includes("await listInstructorContactCourseOptions()"));
});

test("the eligibility gate runs BEFORE any per-offering read", () => {
  const body = code(functionSource(SRC, FN));
  const options = requiredIndex(body, "listInstructorContactCourseOptions()", "options load");
  const gate = requiredIndex(body, "isInstructorEligibleForUnifiedSchedule(options.length)", "gate");
  const read = requiredIndex(body, "getTodayScheduleForInstructor(", "per-offering read");
  assert.ok(options < gate);
  assert.ok(gate < read);
});

test("an ineligible instructor gets the uniform empty result", () => {
  assert.match(
    code(functionSource(SRC, FN)),
    /if \(!isInstructorEligibleForUnifiedSchedule\(options\.length\)\) \{\s*return emptyUnifiedInstructorTodayScheduleResult\(\);/,
  );
  assert.match(code(SRC), /eligible: false/);
});

// ---------------------------------------------------------------------------
// (10) No direct Prisma query; no fake week id.
// ---------------------------------------------------------------------------

test("the reader touches Prisma directly nowhere", () => {
  const body = code(SRC);
  assert.equal(/prisma\./.test(body), false);
  assert.equal(/from "@\/lib\/prisma"/.test(body), false);
});

test("no WeeklySchedule id is manufactured, and no weekly range is faked", () => {
  const body = code(SRC);
  assert.equal(/weeklyScheduleId|week\.id|rangeStart|rangeEnd/.test(body), false,
    "the today path must not synthesize week ids or a fake single-day range");
  assert.equal(/getInstructorWeekSelection|findUnifiedInstructorWeeksForRange/.test(body), false,
    "the today path must not go through the weekly week-resolution machinery");
});

test("the reader performs no authorization, capability or session read of its own", () => {
  const body = code(SRC);
  assert.equal(
    /requireCurrentInstructor|getEffectiveCapabilities|resolveInstructorCourseOffering|cookies\(|next\/headers/.test(body),
    false,
  );
});

// ---------------------------------------------------------------------------
// (11)(12) Narrow per-offering denial; infrastructure faults propagate.
// ---------------------------------------------------------------------------

test("the per-offering catch is narrow: only the typed denial is swallowed", () => {
  const body = code(functionSource(SRC, FN));
  assert.ok(body.includes("if (isInstructorScheduleDenial(error)) {"));
  assert.ok(body.includes("throw error;"));
  assert.equal(
    /catch\s*\([a-zA-Z]+\)\s*\{\s*return/.test(body),
    false,
    "errors must never be swallowed unconditionally",
  );
});

test("a denied offering costs only its OWN contribution", () => {
  const body = code(functionSource(SRC, FN));
  assert.ok(body.includes("return { offering, items: [] as InstructorScheduleItem[] };"));
});

test("offerings are fanned out concurrently, one contribution each", () => {
  const body = code(functionSource(SRC, FN));
  assert.ok(body.includes("await Promise.all("));
  assert.ok(body.includes("options.map(async (option) =>"));
});

// ---------------------------------------------------------------------------
// (14)(16) Shared merge core: source metadata + deterministic chronology.
// ---------------------------------------------------------------------------

test("the merge goes through the committed pure core shared with the weekly view", () => {
  const body = code(functionSource(SRC, FN));
  assert.ok(body.includes("mergeUnifiedInstructorScheduleSources(sources)"));
  assert.match(code(SRC), /from "@\/lib\/course\/unified-instructor-schedule-core"/);
  // No hand-rolled ordering or dedup in the shell - chronology is the core's.
  assert.equal(/\.sort\(/.test(code(SRC)), false);
  assert.equal(/new Map\(|new Set\(/.test(code(SRC)), false);
});

test("the source tag preserves offering id, label and level", () => {
  const body = code(functionSource(SRC, FN));
  assert.ok(body.includes("{ id: option.id, label: option.label, level: option.level }"));
});

// ---------------------------------------------------------------------------
// Locked architectural boundaries.
// ---------------------------------------------------------------------------

test("the reader imports no trainee reader or trainee core", () => {
  assert.equal(
    /unified-trainee|student-schedule|trainee-course-selection|getScheduleForStudent/.test(code(SRC)),
    false,
  );
});

test("the reader never imports combined-participation-visibility-core", () => {
  assert.equal(/combined-participation-visibility-core/.test(code(SRC)), false);
});

test("the reader is a server module", () => {
  assert.match(SRC, /^"use server";/);
});
