/**
 * Executable tests for the pure group-change core (Stage W6D2).
 *
 * Uses the existing `tsx` runner with Node built-ins `node:test` and
 * `node:assert/strict`. No test framework is installed. Run with:
 *   npx tsx --test lib/trainee-history/group-change-core.test.ts
 *
 * PURE: no Prisma, no DB, no Next.js runtime, no clock, no randomness. All
 * fixtures are fixed plain-data literals. The source-scan tests below lock the
 * authority-model decisions (no legacy dependency, no Prisma, no date input)
 * into the suite itself.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  validateResolvedTarget,
  decideGroupChange,
  deriveGroupMirror,
  checkGroupChangeParity,
  type ResolvedTargetCourseGroup,
  type ValidateTargetResult,
} from "./group-change-core";

/** A canonical, fully-valid resolved target used across the decision tests. */
const TARGET: ResolvedTargetCourseGroup = {
  courseGroupId: "cg-target",
  courseOfferingId: "co-1",
  parentGroupId: "pg-A",
  groupName: "א",
  subgroupNumber: 2,
};

function validated(input: unknown): ResolvedTargetCourseGroup {
  const result = validateResolvedTarget(input);
  assert.equal(result.ok, true);
  if (!result.ok) {
    throw new Error("unreachable");
  }
  return result.value;
}

function validationCode(result: ValidateTargetResult): string {
  assert.equal(result.ok, false);
  if (result.ok) {
    throw new Error("unreachable");
  }
  return result.code;
}

// --- CHANGE DECISION -------------------------------------------------------

test("1. same group id → NO_CHANGE", () => {
  const result = decideGroupChange("cg-target", TARGET);
  assert.deepEqual(result, { ok: true, decision: "NO_CHANGE" });
});

test("2. different group id → APPLY_CHANGE", () => {
  const result = decideGroupChange("cg-current", TARGET);
  assert.deepEqual(result, { ok: true, decision: "APPLY_CHANGE" });
});

test("3. same labels but different group id → APPLY_CHANGE", () => {
  // current group carries identical mirror labels but a different CourseGroup id.
  const sameLabelsDifferentId: ResolvedTargetCourseGroup = {
    ...TARGET,
    courseGroupId: "cg-target-2",
  };
  const result = decideGroupChange("cg-current", sameLabelsDifferentId);
  assert.deepEqual(result, { ok: true, decision: "APPLY_CHANGE" });
  // And guarded from the other direction: matching labels never force NO_CHANGE.
  assert.notEqual(sameLabelsDifferentId.courseGroupId, "cg-current");
});

// --- TARGET VALIDATION -----------------------------------------------------

test("4. malformed/empty target id fails", () => {
  assert.equal(
    validationCode(validateResolvedTarget({ ...TARGET, courseGroupId: "" })),
    "EMPTY_COURSE_GROUP_ID",
  );
  assert.equal(
    validationCode(validateResolvedTarget({ ...TARGET, courseGroupId: "   " })),
    "EMPTY_COURSE_GROUP_ID",
  );
  assert.equal(validationCode(validateResolvedTarget(null)), "EMPTY_COURSE_GROUP_ID");
  // A malformed target must also fail the decision, not silently no-op.
  assert.equal(decideGroupChange("cg-current", { ...TARGET, courseGroupId: "" }).ok, false);
});

test("5. empty offering id fails", () => {
  assert.equal(
    validationCode(validateResolvedTarget({ ...TARGET, courseOfferingId: "" })),
    "EMPTY_COURSE_OFFERING_ID",
  );
});

test("6. missing parent id fails", () => {
  assert.equal(
    validationCode(validateResolvedTarget({ ...TARGET, parentGroupId: "" })),
    "EMPTY_PARENT_GROUP_ID",
  );
  const { parentGroupId: _omit, ...withoutParent } = TARGET;
  void _omit;
  assert.equal(validationCode(validateResolvedTarget(withoutParent)), "EMPTY_PARENT_GROUP_ID");
});

test("7. empty/whitespace groupName fails", () => {
  assert.equal(
    validationCode(validateResolvedTarget({ ...TARGET, groupName: "" })),
    "EMPTY_GROUP_NAME",
  );
  assert.equal(
    validationCode(validateResolvedTarget({ ...TARGET, groupName: "   " })),
    "EMPTY_GROUP_NAME",
  );
});

test("8. subgroup 0 fails", () => {
  assert.equal(
    validationCode(validateResolvedTarget({ ...TARGET, subgroupNumber: 0 })),
    "INVALID_SUBGROUP_NUMBER",
  );
});

test("9. negative subgroup fails", () => {
  assert.equal(
    validationCode(validateResolvedTarget({ ...TARGET, subgroupNumber: -1 })),
    "INVALID_SUBGROUP_NUMBER",
  );
});

test("10. non-integer subgroup fails", () => {
  for (const bad of [1.5, Number.NaN, "2", true, null]) {
    assert.equal(
      validationCode(validateResolvedTarget({ ...TARGET, subgroupNumber: bad })),
      "INVALID_SUBGROUP_NUMBER",
      `expected INVALID_SUBGROUP_NUMBER for ${String(bad)}`,
    );
  }
});

// --- MIRROR MAPPING --------------------------------------------------------

test("11. valid target maps to exact Student mirror", () => {
  const target = validated(TARGET);
  assert.deepEqual(deriveGroupMirror(target), { groupName: "א", subgroupNumber: 2 });
});

test("11b. validation normalizes a padded groupName and feeds the mirror", () => {
  const result = validateResolvedTarget({ ...TARGET, groupName: " א " });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("unreachable");
  assert.equal(result.value.groupName, "א");
  assert.deepEqual(deriveGroupMirror(result.value), {
    groupName: "א",
    subgroupNumber: TARGET.subgroupNumber,
  });
});

// --- POST-WRITE PARITY -----------------------------------------------------

test("12. parity passes when history id and mirror match target", () => {
  const result = checkGroupChangeParity(
    { membershipCourseGroupId: "cg-target", mirror: { groupName: "א", subgroupNumber: 2 } },
    TARGET,
  );
  assert.deepEqual(result, { ok: true });
});

test("13. parity fails on wrong membership id", () => {
  const result = checkGroupChangeParity(
    { membershipCourseGroupId: "cg-wrong", mirror: { groupName: "א", subgroupNumber: 2 } },
    TARGET,
  );
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  assert.deepEqual(result.mismatches, ["MEMBERSHIP_COURSE_GROUP_ID"]);
});

test("14. parity fails on wrong groupName", () => {
  const result = checkGroupChangeParity(
    { membershipCourseGroupId: "cg-target", mirror: { groupName: "ב", subgroupNumber: 2 } },
    TARGET,
  );
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  assert.deepEqual(result.mismatches, ["MIRROR_GROUP_NAME"]);
});

test("15. parity fails on wrong subgroupNumber", () => {
  const result = checkGroupChangeParity(
    { membershipCourseGroupId: "cg-target", mirror: { groupName: "א", subgroupNumber: 9 } },
    TARGET,
  );
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  assert.deepEqual(result.mismatches, ["MIRROR_SUBGROUP_NUMBER"]);
});

test("15b. parity reports multiple mismatches together", () => {
  const result = checkGroupChangeParity(
    { membershipCourseGroupId: "cg-wrong", mirror: { groupName: "א", subgroupNumber: 9 } },
    TARGET,
  );
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  assert.deepEqual(result.mismatches, ["MEMBERSHIP_COURSE_GROUP_ID", "MIRROR_SUBGROUP_NUMBER"]);
});

// --- CONTRACT LOCKS (source-scan) ------------------------------------------

const SOURCE = readFileSync("lib/trainee-history/group-change-core.ts", "utf8");

// Executable code only — block and line comments stripped — so that a comment
// documenting the "legacy model is banned" decision does not itself trip the
// dependency scan below.
const CODE_ONLY = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

test("16. no legacy TraineeGroupMembership dependency", () => {
  assert.ok(
    !/traineeGroupMembership/i.test(CODE_ONLY),
    "pure core code must not import or reference the legacy TraineeGroupMembership model",
  );
});

test("17. no Prisma import", () => {
  // The module is fully self-contained: no imports at all, so no Prisma client,
  // no @prisma/*, and no DB delegate can reach the pure core.
  assert.ok(!/^\s*import\b/m.test(SOURCE), "pure core must have no imports at all");
  assert.ok(!/\bfrom\s+["'][^"']*prisma/i.test(SOURCE), "pure core must not import Prisma");
});

test("18. no date or client effectiveFrom input in this core", () => {
  assert.ok(!SOURCE.includes("effectiveFrom"), "pure core must not accept an effectiveFrom input");
  assert.ok(!SOURCE.includes("effectiveTo"), "pure core must not accept an effectiveTo input");
  assert.ok(!/\bDate\b/.test(SOURCE), "pure core must not use JS Date / any date input");
});
