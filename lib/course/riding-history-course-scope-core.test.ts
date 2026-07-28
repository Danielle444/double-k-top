/**
 * R1-RIDING-HISTORY-COURSE - DB-free unit tests for the riding-history course
 * identity + badge label core. No Prisma, no session, no clock. Run with:
 *   npx tsx --test lib/course/riding-history-course-scope-core.test.ts
 *
 * These prove the SEMANTICS (which identity a joined offering produces, and what
 * it renders as). That each reader/component feeds the AUTHORITATIVE offering in -
 * the lesson's own WeeklySchedule -> CourseOffering, per row - is proven by the
 * source-scan contract test in
 * lib/actions/riding-history-course-identity.contract.test.ts, the same split
 * already used by historical-trainee-state-core.test.ts vs.
 * historical-readers.contract.test.ts.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  RIDING_HISTORY_COURSE_UNSCOPED_LABEL,
  formatRidingHistoryCourseLabel,
  resolveRidingHistoryCourseIdentity,
  type RidingHistoryCourseIdentity,
} from "./riding-history-course-scope-core";

// The two real production offerings' shapes (ids kept local to the TEST - the
// runtime core and reader hardcode no offering id, which the contract test
// asserts).
const L1 = { id: "cmrqngqhn00017gcndjixzrh0", name: "קורס מדריכים קיץ – רמה 1", level: 1 };
const L2 = { id: "cmrxk58vc0000lscnfm54bpze", name: "קורס מדריכים קיץ – רמה 2", level: 2 };

// --- A: identity resolution ---

test("1. a Level 1 lesson's offering yields full Level 1 identity", () => {
  const identity = resolveRidingHistoryCourseIdentity(L1);
  assert.deepEqual(identity, {
    courseOfferingId: L1.id,
    courseName: L1.name,
    courseLevel: 1,
  });
});

test("2. a Level 2 lesson's offering yields full Level 2 identity", () => {
  const identity = resolveRidingHistoryCourseIdentity(L2);
  assert.deepEqual(identity, {
    courseOfferingId: L2.id,
    courseName: L2.name,
    courseLevel: 2,
  });
});

test("3. dual trainee, same date: two lessons from different offerings keep DIFFERENT identities", () => {
  // The core is date-free by construction, so the only thing distinguishing these
  // two rows is the offering each lesson's own week points at - exactly the
  // dual-enrolled overlap case (an L1 and an L2 riding slot on one calendar day).
  const l1Row = resolveRidingHistoryCourseIdentity(L1);
  const l2Row = resolveRidingHistoryCourseIdentity(L2);
  assert.notEqual(l1Row.courseOfferingId, l2Row.courseOfferingId);
  assert.notEqual(l1Row.courseLevel, l2Row.courseLevel);
  assert.equal(formatRidingHistoryCourseLabel(l1Row), "רמה 1");
  assert.equal(formatRidingHistoryCourseLabel(l2Row), "רמה 2");
});

test("4. identity can ONLY come from the joined offering - the resolver accepts nothing else", () => {
  // Arity is the guard: one parameter, so there is no date/title/group/session/
  // selected-course argument a caller could pass and no way for this module to
  // infer a course from anything but the lesson's own joined offering.
  assert.equal(resolveRidingHistoryCourseIdentity.length, 1);
  assert.equal(formatRidingHistoryCourseLabel.length, 1);
});

test("5. legacy NULL-scoped week stays fully null and renders the neutral label", () => {
  for (const missing of [null, undefined]) {
    const identity = resolveRidingHistoryCourseIdentity(missing);
    assert.deepEqual(identity, { courseOfferingId: null, courseName: null, courseLevel: null });
    assert.equal(formatRidingHistoryCourseLabel(identity), "ללא שיוך קורס");
    assert.equal(formatRidingHistoryCourseLabel(identity), RIDING_HISTORY_COURSE_UNSCOPED_LABEL);
  }
});

test("6. missing identity is NEVER coerced to Level 1 or any other course", () => {
  const identity = resolveRidingHistoryCourseIdentity(null);
  assert.equal(identity.courseLevel, null, "no level fabricated");
  assert.notEqual(formatRidingHistoryCourseLabel(identity), "רמה 1");
  assert.notEqual(formatRidingHistoryCourseLabel(identity), "רמה 2");
});

test("7. partial/blank identity fails closed rather than emitting a course without a level", () => {
  // Unreachable against the current schema (CourseOffering.level is a required
  // Int) - asserted so a future loosening can never produce a half-attributed row.
  assert.deepEqual(resolveRidingHistoryCourseIdentity({ id: "", name: "x", level: 1 }), {
    courseOfferingId: null,
    courseName: null,
    courseLevel: null,
  });
  assert.deepEqual(
    resolveRidingHistoryCourseIdentity({
      id: "cmrqngqhn00017gcndjixzrh0",
      name: "x",
      level: Number.NaN,
    }),
    { courseOfferingId: null, courseName: null, courseLevel: null },
  );
});

// --- B: label composition ---

test("8. level 1 -> רמה 1, level 2 -> רמה 2, any other known level -> רמה {level}", () => {
  assert.equal(formatRidingHistoryCourseLabel(resolveRidingHistoryCourseIdentity(L1)), "רמה 1");
  assert.equal(formatRidingHistoryCourseLabel(resolveRidingHistoryCourseIdentity(L2)), "רמה 2");
  assert.equal(
    formatRidingHistoryCourseLabel(
      resolveRidingHistoryCourseIdentity({ id: "future", name: "רמה שלוש", level: 3 }),
    ),
    "רמה 3",
    "a future Level 3 needs no code change",
  );
  assert.equal(
    formatRidingHistoryCourseLabel(
      resolveRidingHistoryCourseIdentity({ id: "future", name: "x", level: 17 }),
    ),
    "רמה 17",
  );
});

test("9. the label never depends on the course NAME", () => {
  // Same level, wildly different (and deliberately misleading) names -> identical
  // badge. An admin renaming an offering can never change its badge.
  const renamed = resolveRidingHistoryCourseIdentity({
    id: L2.id,
    name: "רמה 1 - שם שהוקלד לא נכון",
    level: 2,
  });
  assert.equal(formatRidingHistoryCourseLabel(renamed), "רמה 2");

  const noName = resolveRidingHistoryCourseIdentity({ id: L1.id, name: "", level: 1 });
  assert.equal(formatRidingHistoryCourseLabel(noName), "רמה 1", "an empty name still labels by level");
});

test("10. the label is a pure function of identity - a row-shaped object works unchanged", () => {
  // How the components call it: a full RidingHistoryRow is structurally an
  // identity, so the badge and the timeline chip share one implementation.
  const rowShaped: RidingHistoryCourseIdentity & { note: string | null; dateKey: string } = {
    courseOfferingId: L2.id,
    courseName: L2.name,
    courseLevel: 2,
    note: "הערה",
    dateKey: "2026-07-29",
  };
  assert.equal(formatRidingHistoryCourseLabel(rowShaped), "רמה 2");
  assert.equal(formatRidingHistoryCourseLabel(rowShaped), "רמה 2", "no memo/state - repeatable");
});
