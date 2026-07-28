/**
 * L2-RH1 - executable regression tests for the OFFERING-SCOPED historical group
 * resolver. No Prisma, no DB. Run with:
 *   npx tsx --test lib/course/historical-trainee-state-offering-core.test.ts
 *
 * Encodes the exact reported production case: with a Level 1 and a Level 2
 * offering both ACTIVE, a riding lesson belonging to the Level 2 week must
 * resolve the trainee's group from the LEVEL 2 offering (parent ג + subgroup
 * 1-4), never from the Level 1 offering the singleton current-offering resolver
 * answers with, and never from Student.groupName (which is not an input to any
 * function here, so a mirror fallback is structurally impossible).
 *
 * Kept in its own file rather than appended to historical-trainee-state-core.test.ts
 * so the pre-existing W6D3-HOTFIX suite stays byte-for-byte unchanged.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  resolveHistoricalGroupInOffering,
  type OfferingScopedMembership,
} from "./historical-trainee-state-core";

const D = (key: string) => new Date(`${key}T00:00:00.000Z`);

/** The two real launch offerings, referenced ONLY as opaque test fixtures. */
const L1 = "offering-level-1";
const L2 = "offering-level-2";

/** A Level 2 riding-lesson date inside both courses' live windows. */
const LESSON_DATE = D("2026-07-26");

function membership(
  courseOfferingId: string,
  from: string,
  to: string | null,
  groupName: string,
  parentName: string | null,
): OfferingScopedMembership {
  return {
    courseOfferingId,
    effectiveFrom: D(from),
    effectiveTo: to === null ? null : D(to),
    courseGroup: {
      name: groupName,
      parentGroupId: parentName === null ? null : "parent-id",
      parentGroup: parentName === null ? null : { name: parentName },
    },
  };
}

// A DUAL-enrolled trainee: group א/2 in Level 1 and group ג/3 in Level 2, both
// intervals covering the same lesson date. This is exactly the production shape
// that produced the wrong label.
const DUAL_TRAINEE: OfferingScopedMembership[] = [
  membership(L1, "2026-07-05", null, "2", "א"),
  membership(L2, "2026-07-26", null, "3", "ג"),
];

// A LEVEL-2-ONLY trainee: no Level 1 enrollment exists at all.
const L2_ONLY_TRAINEE: OfferingScopedMembership[] = [
  membership(L2, "2026-07-26", null, "1", "ג"),
];

// --- 1: the same trainee + same date resolves DIFFERENTLY per offering ---

test("dual trainee: the Level 2 lookup returns the Level 2 group ג", () => {
  assert.deepEqual(resolveHistoricalGroupInOffering(DUAL_TRAINEE, LESSON_DATE, L2), {
    ok: true,
    value: { groupName: "ג", subgroupNumber: 3 },
  });
});

test("dual trainee: the Level 1 lookup still returns the Level 1 group א", () => {
  assert.deepEqual(resolveHistoricalGroupInOffering(DUAL_TRAINEE, LESSON_DATE, L1), {
    ok: true,
    value: { groupName: "א", subgroupNumber: 2 },
  });
});

// --- 2: memberships from another offering are IGNORED, never a fallback ---

test("a covering membership in another offering never satisfies this offering", () => {
  const level1Only: OfferingScopedMembership[] = [membership(L1, "2026-07-05", null, "2", "א")];
  assert.deepEqual(resolveHistoricalGroupInOffering(level1Only, LESSON_DATE, L2), {
    ok: false,
    kind: "NO_COVERING_MEMBERSHIP",
  });
});

test("another offering's membership cannot make an ambiguous set look resolvable", () => {
  // Two covering rows in L2 (genuinely ambiguous) plus one in L1. The L1 row must
  // not be counted, and the L2 ambiguity must still be reported.
  const rows: OfferingScopedMembership[] = [
    membership(L1, "2026-07-05", null, "2", "א"),
    membership(L2, "2026-07-26", null, "1", "ג"),
    membership(L2, "2026-07-20", null, "2", "ג"),
  ];
  assert.deepEqual(resolveHistoricalGroupInOffering(rows, LESSON_DATE, L2), {
    ok: false,
    kind: "MULTIPLE_COVERING_MEMBERSHIPS",
  });
});

// --- 3: Level-2-only trainee ---

test("Level-2-only trainee: the Level 2 lookup succeeds with ג + subgroup", () => {
  assert.deepEqual(resolveHistoricalGroupInOffering(L2_ONLY_TRAINEE, LESSON_DATE, L2), {
    ok: true,
    value: { groupName: "ג", subgroupNumber: 1 },
  });
});

test("Level-2-only trainee: the Level 1 lookup fails closed", () => {
  assert.deepEqual(resolveHistoricalGroupInOffering(L2_ONLY_TRAINEE, LESSON_DATE, L1), {
    ok: false,
    kind: "NO_COVERING_MEMBERSHIP",
  });
});

// --- 4: zero covering memberships fails closed ---

test("no membership at all fails closed", () => {
  assert.deepEqual(resolveHistoricalGroupInOffering([], LESSON_DATE, L2), {
    ok: false,
    kind: "NO_COVERING_MEMBERSHIP",
  });
});

test("a right-offering membership that does not cover the date fails closed", () => {
  const future: OfferingScopedMembership[] = [membership(L2, "2026-08-01", null, "1", "ג")];
  assert.deepEqual(resolveHistoricalGroupInOffering(future, LESSON_DATE, L2), {
    ok: false,
    kind: "NO_COVERING_MEMBERSHIP",
  });
});

test("half-open boundary is preserved: effectiveTo belongs to the NEXT interval", () => {
  const closed: OfferingScopedMembership[] = [
    membership(L2, "2026-07-20", "2026-07-26", "1", "ג"),
    membership(L2, "2026-07-26", null, "2", "ג"),
  ];
  assert.deepEqual(resolveHistoricalGroupInOffering(closed, LESSON_DATE, L2), {
    ok: true,
    value: { groupName: "ג", subgroupNumber: 2 },
  });
  assert.deepEqual(resolveHistoricalGroupInOffering(closed, D("2026-07-25"), L2), {
    ok: true,
    value: { groupName: "ג", subgroupNumber: 1 },
  });
});

// --- 5: multiple covering memberships in the SAME offering fails closed ---

test("two covering memberships in the same offering fail closed (never picks one)", () => {
  const overlapping: OfferingScopedMembership[] = [
    membership(L2, "2026-07-20", null, "1", "ג"),
    membership(L2, "2026-07-26", null, "4", "ג"),
  ];
  assert.deepEqual(resolveHistoricalGroupInOffering(overlapping, LESSON_DATE, L2), {
    ok: false,
    kind: "MULTIPLE_COVERING_MEMBERSHIPS",
  });
});

// --- 6: a null / blank offering fails closed and is NEVER coerced ---

test("a null courseOfferingId (unscoped legacy week) fails closed", () => {
  assert.deepEqual(resolveHistoricalGroupInOffering(DUAL_TRAINEE, LESSON_DATE, null), {
    ok: false,
    kind: "NO_COVERING_MEMBERSHIP",
  });
});

test("a null offering is not coerced to Level 1 even when Level 1 is the only membership", () => {
  const level1Only: OfferingScopedMembership[] = [membership(L1, "2026-07-05", null, "2", "א")];
  assert.deepEqual(resolveHistoricalGroupInOffering(level1Only, LESSON_DATE, null), {
    ok: false,
    kind: "NO_COVERING_MEMBERSHIP",
  });
});

test("a null offering is not coerced to 'the only offering present'", () => {
  assert.deepEqual(resolveHistoricalGroupInOffering(L2_ONLY_TRAINEE, LESSON_DATE, null), {
    ok: false,
    kind: "NO_COVERING_MEMBERSHIP",
  });
});

test("a blank offering id fails closed rather than matching a blank-keyed row", () => {
  assert.deepEqual(resolveHistoricalGroupInOffering(DUAL_TRAINEE, LESSON_DATE, ""), {
    ok: false,
    kind: "NO_COVERING_MEMBERSHIP",
  });
});

// --- malformed group data still fails closed within the right offering ---

test("malformed subgroup in the requested offering fails closed (no relabel)", () => {
  const bad: OfferingScopedMembership[] = [membership(L2, "2026-07-20", null, "abc", "ג")];
  assert.deepEqual(resolveHistoricalGroupInOffering(bad, LESSON_DATE, L2), {
    ok: false,
    kind: "MALFORMED_SUBGROUP",
  });
});

test("missing parent group in the requested offering fails closed", () => {
  const orphan: OfferingScopedMembership[] = [
    {
      courseOfferingId: L2,
      effectiveFrom: D("2026-07-20"),
      effectiveTo: null,
      courseGroup: { name: "1", parentGroupId: "parent-id", parentGroup: null },
    },
  ];
  assert.deepEqual(resolveHistoricalGroupInOffering(orphan, LESSON_DATE, L2), {
    ok: false,
    kind: "MISSING_PARENT_GROUP",
  });
});

test("a top-level covering membership maps to its own name, subgroup null", () => {
  const topLevel: OfferingScopedMembership[] = [membership(L2, "2026-07-20", null, "ג", null)];
  assert.deepEqual(resolveHistoricalGroupInOffering(topLevel, LESSON_DATE, L2), {
    ok: true,
    value: { groupName: "ג", subgroupNumber: null },
  });
});

// --- input is never mutated ---

test("the membership list is never mutated or reordered", () => {
  const rows = [...DUAL_TRAINEE];
  const snapshot = rows.map((r) => `${r.courseOfferingId}|${r.courseGroup.name}`);
  resolveHistoricalGroupInOffering(rows, LESSON_DATE, L2);
  resolveHistoricalGroupInOffering(rows, LESSON_DATE, L1);
  assert.deepEqual(
    rows.map((r) => `${r.courseOfferingId}|${r.courseGroup.name}`),
    snapshot,
  );
});

// ---------------------------------------------------------------------------
// 7 / 12: SOURCE CONTRACT - no Student mirror, no current-offering resolver
// ---------------------------------------------------------------------------

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
/** Source with block/line comments removed, so prose never satisfies a check. */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
const CORE = read("lib/course/historical-trainee-state-core.ts");
const CORE_CODE = code("lib/course/historical-trainee-state-core.ts");
const LOADER = read("lib/course/historical-trainee-state.ts");

test("7. the pure core has no Student.groupName fallback and no Student input", () => {
  assert.ok(!/\bStudent\b/.test(CORE_CODE), "no Student reference in executable code");
  assert.ok(!/groupName:\s*student/i.test(CORE_CODE), "no student-mirror group output");
  assert.ok(!/prisma/i.test(CORE_CODE), "the core stays DB-free (no Prisma in code)");
  assert.ok(!/from "@\/lib\/prisma"/.test(CORE), "the core imports no Prisma client");
});

test("12. the offering-aware loader imports no current-offering / Level-2 helper", () => {
  const start = LOADER.indexOf("loadHistoricalTraineeStateForOfferings");
  assert.ok(start > 0, "the offering-aware loader exists");
  const body = LOADER.slice(start);
  assert.ok(
    !/resolveCurrentCourseOffering/.test(body),
    "the offering-aware loader must never call the singleton current-offering resolver",
  );
  assert.ok(
    !/temporary-level2-compatibility|LEVEL_1_COURSE_OFFERING_ID|LEVEL_2_COURSE_OFFERING_ID/.test(body),
    "no temporary Level 2 compatibility helper or hardcoded offering id",
  );
  // The pre-existing loader above it still uses the singleton resolver - unchanged.
  assert.ok(
    /resolveCurrentCourseOffering/.test(LOADER.slice(0, start)),
    "loadHistoricalTraineeState above is left untouched",
  );
});

test("12. the offering-aware loader hardcodes no offering id and infers no level", () => {
  const start = LOADER.indexOf("loadHistoricalTraineeStateForOfferings");
  const body = LOADER.slice(start);
  assert.ok(!/\blevel\b/.test(body.replace(/\/\*[\s\S]*?\*\//g, "")), "no course-level inference");
  assert.ok(!/cm[a-z0-9]{20,}/.test(body), "no literal cuid offering id");
});

// ---------------------------------------------------------------------------
// 8: empty inputs avoid unnecessary reads (structural, source-level)
// ---------------------------------------------------------------------------

test("8. an empty trainee list short-circuits before any query", () => {
  const start = LOADER.indexOf("export async function loadHistoricalTraineeStateForOfferings");
  const body = LOADER.slice(start);
  const guard = body.indexOf("uniqueStudentIds.length === 0");
  const firstQuery = body.indexOf("prisma.");
  assert.ok(guard > 0, "an empty-trainee guard exists");
  assert.ok(firstQuery > guard, "the guard precedes every Prisma call");
});

test("8. an empty/all-null offering list skips the enrollment query specifically", () => {
  const start = LOADER.indexOf("export async function loadHistoricalTraineeStateForOfferings");
  const body = LOADER.slice(start);
  assert.ok(
    /if \(uniqueOfferingIds\.length > 0\) \{[\s\S]*?prisma\.courseEnrollment\.findMany/.test(body),
    "the enrollment read is guarded by a non-empty offering list",
  );
});

test("5. the loader issues a BOUNDED two queries - never one per record", () => {
  const start = LOADER.indexOf("export async function loadHistoricalTraineeStateForOfferings");
  const body = LOADER.slice(start);
  const calls = body.match(/prisma\.[a-zA-Z]+\.findMany/g) ?? [];
  assert.equal(calls.length, 2, "exactly two findMany calls");
  assert.ok(!/for \([\s\S]{0,400}?await prisma\./.test(body), "no query inside any loop");
  // Both reads are set-based (`in`), so cost does not scale with record count.
  assert.ok(/studentId: \{ in: uniqueStudentIds \}/.test(body), "students read by IN");
  assert.ok(/courseOfferingId: \{ in: uniqueOfferingIds \}/.test(body), "offerings read by IN");
});
