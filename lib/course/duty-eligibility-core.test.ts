/**
 * DUTY LEVEL-2-ONLY FILTER (P1) - tests for the single duty-eligibility rule.
 *
 * Two halves, both DB-free (the repo convention - a "use server" Prisma action
 * cannot be unit-run without a database):
 *
 *  1. BEHAVIOURAL - the pure `isDutyEligible` predicate and the
 *     `dutyEligibleStudentWhere` DB fragment, against plain fakes, covering
 *     Level-1-only / dual / dual-with-inactive-L1 / Level-2-only / inactive.
 *
 *  2. STRUCTURAL - source assertions that every duty-pool READER (scheduler,
 *     export, diagnostics) filters through `dutyEligibleStudentWhere`, that all
 *     three manual WRITE paths re-check eligibility and reject, and that the
 *     historical `dutyAssignment` reads/writes were NOT re-scoped by this change.
 *
 * Run with:  npx tsx --test lib/course/duty-eligibility-core.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  DUTY_POOL_OFFERING_ID,
  dutyEligibleStudentWhere,
  isDutyEligible,
} from "./duty-eligibility-core";
import { LEVEL_1_COURSE_OFFERING_ID } from "./temporary-level2-compatibility";

// The two real production offering ids, so the cases below describe the actual
// launch state rather than invented placeholders.
const L1 = "cmrqngqhn00017gcndjixzrh0";
const L2 = "cmrxk58vc0000lscnfm54bpze";

function readCode(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

// ===========================================================================
// PART 1 - BEHAVIOURAL: the pure eligibility rule
// ===========================================================================

test("the duty pool offering is the established Level 1 offering", () => {
  assert.equal(DUTY_POOL_OFFERING_ID, LEVEL_1_COURSE_OFFERING_ID);
  assert.equal(DUTY_POOL_OFFERING_ID, L1);
});

test("Level-1-only active trainee is INCLUDED", () => {
  assert.equal(
    isDutyEligible({
      isActive: true,
      courseEnrollments: [{ courseOfferingId: L1, status: "ACTIVE" }],
    }),
    true,
  );
});

test("dual (active L1 + active L2) is INCLUDED - via the L1 enrollment", () => {
  assert.equal(
    isDutyEligible({
      isActive: true,
      courseEnrollments: [
        { courseOfferingId: L1, status: "ACTIVE" },
        { courseOfferingId: L2, status: "ACTIVE" },
      ],
    }),
    true,
  );
});

test("dual with the L1 enrollment INACTIVE is EXCLUDED (L2 active does not count)", () => {
  assert.equal(
    isDutyEligible({
      isActive: true,
      courseEnrollments: [
        { courseOfferingId: L1, status: "INACTIVE" },
        { courseOfferingId: L2, status: "ACTIVE" },
      ],
    }),
    false,
  );
});

test("Level-2-only active trainee is EXCLUDED (no L1 enrollment)", () => {
  assert.equal(
    isDutyEligible({
      isActive: true,
      courseEnrollments: [{ courseOfferingId: L2, status: "ACTIVE" }],
    }),
    false,
  );
});

test("isActive=false is EXCLUDED even with an active L1 enrollment (isActive stays necessary)", () => {
  assert.equal(
    isDutyEligible({
      isActive: false,
      courseEnrollments: [{ courseOfferingId: L1, status: "ACTIVE" }],
    }),
    false,
  );
});

test("no enrollments at all is EXCLUDED", () => {
  assert.equal(isDutyEligible({ isActive: true, courseEnrollments: [] }), false);
});

test("the DB where-fragment encodes exactly the same rule (isActive + active L1 enrollment)", () => {
  // The readers filter at the DB with this fragment; it must key on the same
  // offering id + ACTIVE status as the pure predicate, and must still require
  // isActive.
  assert.equal(dutyEligibleStudentWhere.isActive, true);
  const some = (dutyEligibleStudentWhere.courseEnrollments as { some?: unknown })?.some as {
    courseOfferingId?: unknown;
    status?: unknown;
  };
  assert.ok(some, "where fragment must constrain courseEnrollments via `some`");
  assert.equal(some.courseOfferingId, DUTY_POOL_OFFERING_ID);
  assert.equal(some.status, "ACTIVE");
});

// ===========================================================================
// PART 2 - STRUCTURAL: the wiring the behavioural test cannot see
// ===========================================================================

test("every duty-pool READER filters through the shared where-fragment", () => {
  for (const relative of [
    "../scheduler.ts",
    "../exports/schedule-export.ts",
    "../schedule-diagnostics.ts",
    // The admin manual-assignment / reassign picker roster (feeds the dropdown
    // options in ScheduleClient) - the sixth pool, easy to miss.
    "../../app/admin/schedule/page.tsx",
  ]) {
    const code = readCode(relative);
    assert.match(
      code,
      /where:\s*dutyEligibleStudentWhere/,
      `${relative} must build its student pool with dutyEligibleStudentWhere`,
    );
    // The old, leaking predicate must be gone from the student pool query.
    assert.doesNotMatch(
      code,
      /student\.findMany\(\{\s*where:\s*\{\s*isActive:\s*true\s*\}/,
      `${relative} must no longer key the student pool on isActive alone`,
    );
  }
});

test("all three manual WRITE paths re-check eligibility and reject", () => {
  const code = readCode("../actions/schedule.ts");

  // create + reassign go through the fetch-and-check helper on the target id.
  assert.match(code, /isStudentDutyEligible\(newStudentId\)/, "reassignDuty must re-check the target");
  assert.match(code, /isStudentDutyEligible\(studentId\)/, "createManualAssignment must re-check the target");
  // upsert already fetched the student, so it checks the fetched row directly.
  assert.match(code, /isDutyEligible\(student\)/, "upsertManualAssignment must re-check the fetched student");
  // The helper is built on the shared pure rule, not a re-implementation.
  assert.match(code, /from "@\/lib\/course\/duty-eligibility-core"/);
  // Rejection is explicit, not a silent drop.
  assert.match(code, /return \{ success: false, error: DUTY_INELIGIBLE_ERROR \}/);
});

test("historical duty rows are untouched: no dutyAssignment read/write gained an eligibility filter", () => {
  // The change is confined to the *student pool* query. Existing DutyAssignment
  // reads still fetch by date range only, so already-assigned historical rows
  // (including any Level-2-only trainee assigned before this fix) remain
  // readable and unchanged.
  for (const relative of ["../exports/schedule-export.ts", "../schedule-diagnostics.ts"]) {
    const code = readCode(relative);
    assert.match(
      code,
      /dutyAssignment\.findMany\(\{\s*where:\s*\{\s*date:\s*\{\s*gte:\s*startDate,\s*lte:\s*endDate\s*\}/,
      `${relative} must still read duty assignments by date range only`,
    );
    assert.doesNotMatch(
      code,
      /dutyAssignment\.findMany\([\s\S]*?dutyEligibleStudentWhere/,
      `${relative} must NOT filter duty-assignment rows by eligibility`,
    );
  }
});
