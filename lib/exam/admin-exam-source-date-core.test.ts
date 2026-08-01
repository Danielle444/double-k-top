/**
 * EXAM EX-ADMIN-SRCDATE — the contract suite of the PURE source-date decision.
 *
 * The module has no IO, so every test here simply CALLS it. What is proved is
 * the decision itself — the containment level, the all-or-nothing validation,
 * the duplicate collapse, the empty selection and the no-op detection — plus the
 * structural claims its header makes about what it may never reach.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  decideExamSourceDateReplacement,
  replaceExamSourceDatesWithDeps,
  ADMIN_EXAM_SOURCE_DATE_MESSAGES,
  type AdminExamSourceDateDecisionInput,
  type ReplaceExamSourceDatesDeps,
} from "./admin-exam-source-date-core";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const SOURCE = readFileSync(
  join(REPO_ROOT, "lib", "exam", "admin-exam-source-date-core.ts"),
  "utf8",
);

/** Strip comments, so every structural guard sweeps CODE and never the prose. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const CODE = stripComments(SOURCE);

/** A supported, in-range, practice-bearing baseline. */
function input(
  overrides: Partial<AdminExamSourceDateDecisionInput> = {},
): AdminExamSourceDateDecisionInput {
  return {
    submitted: ["2026-08-02"],
    courseLevel: 1,
    courseStartDate: "2026-01-01",
    courseEndDate: "2026-12-31",
    practiceDates: new Set(["2026-08-02", "2026-08-09", "2026-08-16"]),
    storedDates: [],
    ...overrides,
  };
}

function codesOf(decision: ReturnType<typeof decideExamSourceDateReplacement>): string[] {
  return decision.ok ? [] : decision.issues.map((issue) => issue.code);
}

// ===========================================================================
// 1. The Level-1 containment rule
// ===========================================================================

test("1. a level with no beginner projection refuses the whole replacement", () => {
  for (const level of [2, 3, 0, -1, 1.5, NaN, Infinity, "1", null, undefined, true]) {
    const decision = decideExamSourceDateReplacement(
      input({ courseLevel: level as unknown }),
    );
    assert.equal(decision.ok, false, `level ${String(level)} was accepted`);
    assert.deepEqual(codesOf(decision), ["EX-SRC-LEVEL-NOT-SUPPORTED"]);
  }
});

test("2. the level is judged FIRST — no other diagnostic can accompany it", () => {
  // Every other rule is broken at once, and still exactly one code comes back:
  // a manager on an unsupported level must not be invited to "fix" dates.
  const decision = decideExamSourceDateReplacement(
    input({
      courseLevel: 2,
      submitted: ["nonsense", "1999-01-01", "2026-08-03"],
    }),
  );
  assert.deepEqual(codesOf(decision), ["EX-SRC-LEVEL-NOT-SUPPORTED"]);
});

test("3. the ONE supported level is accepted, and it is the committed one", () => {
  const decision = decideExamSourceDateReplacement(input({ courseLevel: 1 }));
  assert.equal(decision.ok, true);
  // The rule is ASKED of the committed predicate, never restated here.
  assert.ok(CODE.includes("isBeginnerSourceCourseLevel(input.courseLevel)"));
  assert.equal(/courseLevel\s*===\s*1/.test(CODE), false, "the level rule is restated");
});

// ===========================================================================
// 2. Per-date validation, and its all-or-nothing shape
// ===========================================================================

test("4. a token that is not a real calendar date refuses the replacement", () => {
  for (const bad of [
    "",
    "2026-8-2",
    " 2026-08-02",
    "2026-02-30",
    "2027-02-29",
    "2026-13-01",
    "not-a-date",
    20260802,
    null,
    undefined,
    ["2026-08-02"],
    { date: "2026-08-02" },
  ]) {
    const decision = decideExamSourceDateReplacement(
      input({ submitted: [bad], practiceDates: new Set(["2026-08-02"]) }),
    );
    assert.equal(decision.ok, false, `${String(bad)} was accepted`);
    assert.deepEqual(codesOf(decision), ["EX-SRC-DATE-INVALID"]);
  }
  // A leap day that IS real passes the shape test.
  const leap = decideExamSourceDateReplacement(
    input({
      submitted: ["2028-02-29"],
      practiceDates: new Set(["2028-02-29"]),
      courseEndDate: "2028-12-31",
    }),
  );
  assert.equal(leap.ok, true);
});

test("5. a date outside the course period is refused on either side", () => {
  const before = decideExamSourceDateReplacement(
    input({
      submitted: ["2025-12-31"],
      practiceDates: new Set(["2025-12-31"]),
    }),
  );
  assert.deepEqual(codesOf(before), ["EX-SRC-DATE-OUT-OF-COURSE-RANGE"]);

  const after = decideExamSourceDateReplacement(
    input({
      submitted: ["2027-01-01"],
      practiceDates: new Set(["2027-01-01"]),
    }),
  );
  assert.deepEqual(codesOf(after), ["EX-SRC-DATE-OUT-OF-COURSE-RANGE"]);

  // Both bounds are INCLUSIVE.
  const edges = decideExamSourceDateReplacement(
    input({
      submitted: ["2026-01-01", "2026-12-31"],
      practiceDates: new Set(["2026-01-01", "2026-12-31"]),
    }),
  );
  assert.equal(edges.ok, true);
});

test("6. an ABSENT course bound constrains nothing on that side", () => {
  const decision = decideExamSourceDateReplacement(
    input({
      courseStartDate: null,
      courseEndDate: null,
      submitted: ["1999-01-01", "2099-12-31"],
      practiceDates: new Set(["1999-01-01", "2099-12-31"]),
    }),
  );
  assert.equal(decision.ok, true);
  assert.deepEqual(decision.ok ? [...decision.dates] : [], ["1999-01-01", "2099-12-31"]);
  // A malformed bound is treated as ABSENT rather than as a closed boundary.
  const malformed = decideExamSourceDateReplacement(
    input({ courseStartDate: "not-a-date", courseEndDate: "2026-13-40" }),
  );
  assert.equal(malformed.ok, true);
});

test("7. a date with no Teaching-Practice lesson on it is refused", () => {
  const decision = decideExamSourceDateReplacement(
    input({ submitted: ["2026-08-03"] }),
  );
  assert.deepEqual(codesOf(decision), ["EX-SRC-DATE-HAS-NO-PRACTICE"]);
});

test("8. validation is ALL-OR-NOTHING — one bad token writes no set at all", () => {
  const decision = decideExamSourceDateReplacement(
    input({ submitted: ["2026-08-02", "2026-08-03"] }),
  );
  assert.equal(decision.ok, false);
  assert.equal(Object.hasOwn(decision, "dates"), false, "a partial set was returned");
});

test("9. every applicable rule is reported, deduplicated by code and ordered", () => {
  const decision = decideExamSourceDateReplacement(
    input({
      submitted: [
        "bad-one",
        "bad-two",
        "2025-01-01",
        "2025-01-02",
        "2026-08-03",
        "2026-08-04",
      ],
      practiceDates: new Set(["2026-08-02"]),
    }),
  );
  assert.deepEqual(codesOf(decision), [
    "EX-SRC-DATE-HAS-NO-PRACTICE",
    "EX-SRC-DATE-INVALID",
    "EX-SRC-DATE-OUT-OF-COURSE-RANGE",
  ]);
});

test("10. a submission that is not a list at all is reported, never thrown", () => {
  for (const raw of [null, undefined, "2026-08-02", 7, { length: 1 }]) {
    const decision = decideExamSourceDateReplacement(
      input({ submitted: raw as unknown as readonly unknown[] }),
    );
    assert.deepEqual(codesOf(decision), ["EX-SRC-INPUT-NOT-A-LIST"]);
  }
});

// ===========================================================================
// 3. Duplicates, the empty selection and the no-op
// ===========================================================================

test("11. duplicates collapse silently and are never an error", () => {
  const decision = decideExamSourceDateReplacement(
    input({ submitted: ["2026-08-09", "2026-08-02", "2026-08-09", "2026-08-02"] }),
  );
  assert.equal(decision.ok, true);
  assert.deepEqual(decision.ok ? [...decision.dates] : [], ["2026-08-02", "2026-08-09"]);
});

test("12. the result is ASCENDING and duplicate-free whatever order arrived", () => {
  const decision = decideExamSourceDateReplacement(
    input({ submitted: ["2026-08-16", "2026-08-02", "2026-08-09"] }),
  );
  assert.deepEqual(decision.ok ? [...decision.dates] : [], [
    "2026-08-02",
    "2026-08-09",
    "2026-08-16",
  ]);
});

test("13. the EMPTY selection is allowed and means no beginner dates", () => {
  const decision = decideExamSourceDateReplacement(
    input({ submitted: [], storedDates: ["2026-08-02"] }),
  );
  assert.equal(decision.ok, true);
  assert.deepEqual(decision.ok ? [...decision.dates] : [], []);
  assert.equal(decision.ok ? decision.changed : null, true);
});

test("14. a submission matching what is stored is reported as NO CHANGE", () => {
  const unchanged = decideExamSourceDateReplacement(
    input({
      submitted: ["2026-08-09", "2026-08-02"],
      storedDates: ["2026-08-02", "2026-08-09"],
    }),
  );
  assert.equal(unchanged.ok && unchanged.changed, false);

  const changed = decideExamSourceDateReplacement(
    input({
      submitted: ["2026-08-02", "2026-08-16"],
      storedDates: ["2026-08-02", "2026-08-09"],
    }),
  );
  assert.equal(changed.ok && changed.changed, true);

  // An empty submission against an empty stored set is also a no-op.
  const bothEmpty = decideExamSourceDateReplacement(
    input({ submitted: [], storedDates: [] }),
  );
  assert.equal(bothEmpty.ok && bothEmpty.changed, false);
});

test("15. the decision describes the COMPLETE set — there is no add or remove arm", () => {
  const decision = decideExamSourceDateReplacement(
    input({
      submitted: ["2026-08-16"],
      storedDates: ["2026-08-02", "2026-08-09"],
    }),
  );
  assert.deepEqual(decision.ok ? [...decision.dates] : [], ["2026-08-16"]);
  for (const arm of ["added", "removed", "toAdd", "toRemove", "merge"]) {
    assert.equal(
      decision.ok ? Object.hasOwn(decision, arm) : false,
      false,
      `the decision exposes ${arm}`,
    );
  }
});

// ===========================================================================
// 4. Purity, immutability and JSON safety
// ===========================================================================

test("16. inputs are never mutated and every result is frozen and JSON-safe", () => {
  const submitted = ["2026-08-09", "2026-08-02"];
  const stored = ["2026-08-02"];
  const practice = new Set(["2026-08-02", "2026-08-09"]);
  const decision = decideExamSourceDateReplacement(
    input({ submitted, storedDates: stored, practiceDates: practice }),
  );
  assert.deepEqual(submitted, ["2026-08-09", "2026-08-02"]);
  assert.deepEqual(stored, ["2026-08-02"]);
  assert.deepEqual([...practice], ["2026-08-02", "2026-08-09"]);
  assert.equal(Object.isFrozen(decision), true);
  assert.equal(decision.ok && Object.isFrozen(decision.dates), true);
  assert.deepEqual(JSON.parse(JSON.stringify(decision)), decision);

  const refusal = decideExamSourceDateReplacement(input({ courseLevel: 2 }));
  assert.equal(Object.isFrozen(refusal), true);
  assert.deepEqual(JSON.parse(JSON.stringify(refusal)), refusal);
});

test("17. every issue code carries a NON-ECHOING message", () => {
  assert.equal(Object.isFrozen(ADMIN_EXAM_SOURCE_DATE_MESSAGES), true);
  for (const [code, message] of Object.entries(ADMIN_EXAM_SOURCE_DATE_MESSAGES)) {
    assert.ok(message.length > 0, `${code} has no message`);
    for (const placeholder of ["${", "%s", "{0}", "{date}"]) {
      assert.equal(message.includes(placeholder), false, `${code} interpolates`);
    }
  }
  // A refusal names no date, so a submitted token can never be echoed back.
  const decision = decideExamSourceDateReplacement(input({ submitted: ["2026-08-03"] }));
  assert.equal(decision.ok, false);
  if (!decision.ok) {
    for (const issue of decision.issues) {
      assert.equal(Object.hasOwn(issue, "date"), false);
      assert.equal(issue.message.includes("2026"), false, "a date was echoed back");
    }
  }
});

// ===========================================================================
// 5. Structural containment
// ===========================================================================

test("18. the module reaches no IO, no clock, no framework and no Teaching-Practice row", () => {
  for (const token of [
    "prisma",
    "Prisma",
    "@/lib/prisma",
    "server-only",
    '"use server"',
    "next/",
    "Date.now",
    "new Date",
    "Math.random",
    "process.env",
    "localeCompare",
    "Intl.",
    "fetch(",
  ]) {
    assert.equal(CODE.includes(token), false, `the core reaches ${token}`);
  }
  // It is told about Teaching Practice as a set of DATES and nothing else: no
  // lesson, participant, child, horse, contact, time, format or note.
  for (const token of [
    "lessonId",
    "participant",
    "child",
    "Child",
    "horse",
    "Horse",
    "parent",
    "Parent",
    "phone",
    "Phone",
    "startTime",
    "endTime",
    "beginnerFormat",
    "notes",
  ]) {
    assert.equal(CODE.includes(token), false, `the core models ${token}`);
  }
});

test("19. no Teaching-Practice id is an input, and no date is ever inferred", () => {
  // The DECISION is told about dates and course facts only. The orchestration
  // below it legitimately holds the verified offering id and the plan id it
  // looked up — neither of which a caller may supply — so the ban is stated
  // against the decision's own input type rather than against the whole file.
  const decisionInput = CODE.slice(
    CODE.indexOf("export interface AdminExamSourceDateDecisionInput"),
  ).slice(0, CODE.slice(CODE.indexOf("export interface AdminExamSourceDateDecisionInput")).indexOf("}") + 1);
  for (const token of ["planId", "sessionId", "courseOfferingId", "studentId", "traineeId"]) {
    assert.equal(decisionInput.includes(token), false, `the decision accepts ${token}`);
  }
  // NO Teaching-Practice identity is nameable ANYWHERE in the module: the only
  // thing it may learn about a lesson is that a date holds one.
  for (const token of ["lessonId", "practiceId", "TeachingPracticeLesson", "teachingPractice"]) {
    assert.equal(CODE.includes(token), false, `the core names ${token}`);
  }
  // No range is expanded into a list and no weekday rule is applied: the only
  // dates that can reach the output are tokens the caller submitted.
  for (const token of ["getDay", "weekday", "Weekday", "eachDay", "expandRange", "while ("]) {
    assert.equal(CODE.includes(token), false, `the core infers dates via ${token}`);
  }
});

// ===========================================================================
// 6. The orchestration
// ===========================================================================

/** A recording set of fakes, bound exactly as the IO module binds the real ones. */
function deps(overrides: Partial<ReplaceExamSourceDatesDeps> = {}) {
  const calls: string[] = [];
  const written: { planId: string; dates: readonly string[] }[] = [];
  const probes: readonly string[][] = [];
  const base: ReplaceExamSourceDatesDeps = {
    requireCourseContext: async () => {
      calls.push("requireCourseContext");
      return {
        courseOfferingId: "verified-offering",
        status: "ACTIVE",
        courseLevel: 1,
        courseStartDate: "2026-01-01",
        courseEndDate: "2026-12-31",
      };
    },
    assertConfigurationAllowed: () => {
      calls.push("assertConfigurationAllowed");
    },
    findPlanIdByCourseOfferingId: async () => {
      calls.push("findPlanIdByCourseOfferingId");
      return "plan-1";
    },
    findStoredSourceDates: async () => {
      calls.push("findStoredSourceDates");
      return [];
    },
    findPracticeDates: async (dates) => {
      calls.push("findPracticeDates");
      (probes as string[][]).push([...dates]);
      return dates.filter((d) => d !== "2026-08-03");
    },
    replaceSourceDates: async (planId, dates) => {
      calls.push("replaceSourceDates");
      written.push({ planId, dates: [...dates] });
    },
    isCourseNotFoundError: (error) => error === "NOT_FOUND",
    isOperationNotAllowedError: (error) => error === "NOT_ALLOWED",
    ...overrides,
  };
  return { deps: base, calls, written, probes };
}

test("21. the boundary runs FIRST, then the gate, then the level, then the plan", async () => {
  const fake = deps();
  const result = await replaceExamSourceDatesWithDeps(
    "requested",
    ["2026-08-02"],
    fake.deps,
  );
  assert.equal(result.ok, true);
  assert.deepEqual(fake.calls, [
    "requireCourseContext",
    "assertConfigurationAllowed",
    "findPlanIdByCourseOfferingId",
    "findPracticeDates",
    "findStoredSourceDates",
    "replaceSourceDates",
  ]);
});

test("22. the two typed failures become CLOSED refusals, and nothing else is caught", async () => {
  const notFound = deps({
    requireCourseContext: async () => {
      throw "NOT_FOUND";
    },
  });
  assert.deepEqual(
    await replaceExamSourceDatesWithDeps("requested", [], notFound.deps),
    { ok: false, reason: "offering_not_found", issues: [] },
  );

  const denied = deps({
    assertConfigurationAllowed: () => {
      throw "NOT_ALLOWED";
    },
  });
  const deniedResult = await replaceExamSourceDatesWithDeps("requested", [], denied.deps);
  assert.equal(deniedResult.ok === false && deniedResult.reason, "operation_not_allowed");

  // Anything else — a defect, a redirect — propagates untouched.
  const boom = deps({
    requireCourseContext: async () => {
      throw new Error("NEXT_REDIRECT");
    },
  });
  await assert.rejects(
    () => replaceExamSourceDatesWithDeps("requested", [], boom.deps),
    /NEXT_REDIRECT/,
  );
});

test("23. an unsupported level refuses BEFORE any Teaching-Practice read happens", async () => {
  const fake = deps({
    requireCourseContext: async () => ({
      courseOfferingId: "verified-offering",
      status: "ACTIVE",
      courseLevel: 2,
      courseStartDate: null,
      courseEndDate: null,
    }),
  });
  const result = await replaceExamSourceDatesWithDeps(
    "requested",
    ["2026-08-02"],
    fake.deps,
  );
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.ok === false ? result.issues.map((i) => i.code) : [],
    ["EX-SRC-LEVEL-NOT-SUPPORTED"],
  );
  assert.equal(fake.calls.includes("findPracticeDates"), false, "a practice read happened");
  assert.equal(fake.calls.includes("findPlanIdByCourseOfferingId"), false);
  assert.deepEqual(fake.written, []);
});

test("24. no plan is a closed refusal and never an implicit create", async () => {
  const fake = deps({ findPlanIdByCourseOfferingId: async () => null });
  const result = await replaceExamSourceDatesWithDeps("requested", [], fake.deps);
  assert.equal(result.ok === false && result.reason, "plan_not_found");
  assert.deepEqual(fake.written, []);
  assert.equal(fake.calls.includes("replaceSourceDates"), false);
});

test("25. an EMPTY selection issues no Teaching-Practice query at all", async () => {
  const fake = deps({ findStoredSourceDates: async () => ["2026-08-02"] });
  const result = await replaceExamSourceDatesWithDeps("requested", [], fake.deps);
  assert.equal(result.ok && result.outcome, "REPLACED");
  assert.equal(fake.calls.includes("findPracticeDates"), false);
  // The empty set is WRITTEN — deselecting every date is a real selection.
  assert.deepEqual(fake.written, [{ planId: "plan-1", dates: [] }]);
});

test("26. only well-formed, deduplicated date keys are ever put into a query", async () => {
  const fake = deps();
  await replaceExamSourceDatesWithDeps(
    "requested",
    ["2026-08-09", "2026-08-02", "2026-08-09", "not-a-date", null, 42],
    fake.deps,
  );
  assert.deepEqual(fake.probes, [["2026-08-02", "2026-08-09"]]);
});

test("27. the write is ONE atomic replacement, and only when the set changed", async () => {
  const unchanged = deps({
    findStoredSourceDates: async () => ["2026-08-09", "2026-08-02"],
  });
  const result = await replaceExamSourceDatesWithDeps(
    "requested",
    ["2026-08-02", "2026-08-09"],
    unchanged.deps,
  );
  assert.equal(result.ok && result.outcome, "NO_CHANGE");
  assert.deepEqual(unchanged.written, [], "an unchanged submission was written");

  const changed = deps({ findStoredSourceDates: async () => ["2026-08-02"] });
  const changedResult = await replaceExamSourceDatesWithDeps(
    "requested",
    ["2026-08-09", "2026-08-02"],
    changed.deps,
  );
  assert.equal(changedResult.ok && changedResult.outcome, "REPLACED");
  assert.equal(changed.written.length, 1, "the replacement was not a single call");
  assert.deepEqual(changed.written[0].dates, ["2026-08-02", "2026-08-09"]);
  // The plan id came from the LOOKUP and never from the caller.
  assert.equal(changed.written[0].planId, "plan-1");
});

test("28. a refused submission writes NOTHING", async () => {
  const fake = deps();
  const result = await replaceExamSourceDatesWithDeps(
    "requested",
    ["2026-08-02", "2026-08-03"],
    fake.deps,
  );
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.ok === false ? result.issues.map((i) => i.code) : [],
    ["EX-SRC-DATE-HAS-NO-PRACTICE"],
  );
  assert.deepEqual(fake.written, []);
});

test("29. the replacement dependency is ONE call — there is no remove-then-add seam", () => {
  const block = CODE.slice(CODE.indexOf("export interface ReplaceExamSourceDatesDeps"));
  const body = block.slice(0, block.indexOf("\n}") + 2);
  assert.ok(body.includes("replaceSourceDates: (planId: string, dates: readonly string[])"));
  for (const seam of ["deleteSourceDates", "addSourceDates", "removeSourceDates"]) {
    assert.equal(body.includes(seam), false, `the deps expose ${seam}`);
  }
});

test("20. the two committed primitives are the ONLY imports", () => {
  const imports = [...CODE.matchAll(/^import[\s\S]*?from\s+"([^"]+)";/gm)].map(
    ([, from]) => from,
  );
  assert.deepEqual(imports.sort(), [
    "../trainee-history/interval-resolver",
    "./exam-beginner-course-scope-core",
  ]);
});
