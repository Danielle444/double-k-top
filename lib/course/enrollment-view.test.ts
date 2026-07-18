/**
 * MULTI-COURSE W5B0 - executable tests for the PURE enrollment-view module:
 * interval validity, membership cardinality, group/subgroup mapping, subgroup
 * parsing, deterministic ordering, and roster parity comparison.
 *
 * Run with: npx tsx --test lib/course/enrollment-view.test.ts
 * PURE: no Prisma, no DB, no clock, no randomness (every time-dependent call
 * takes an explicit asOf).
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { CourseEnrollmentStatus } from "@/app/generated/prisma/client";
import {
  isMembershipCurrentAt,
  parseSubgroupName,
  resolveGroupFromMembership,
  buildEnrollmentRoster,
  compareTraineeView,
  compareRosters,
  type RawEnrollment,
  type RawMembership,
  type EnrolledTraineeView,
  type EnrollmentRosterResult,
  type EnrollmentMembershipAnomaly,
  type LegacyRosterRow,
} from "./enrollment-view";

const AS_OF = new Date("2026-07-19T12:00:00.000Z");

// --- fixtures ---------------------------------------------------------------

function membership(opts: {
  from: string;
  to?: string | null;
  name: string;
  parentGroupId?: string | null;
  parentName?: string | null;
}): RawMembership {
  return {
    effectiveFrom: new Date(opts.from),
    effectiveTo: opts.to == null ? null : new Date(opts.to),
    courseGroup: {
      name: opts.name,
      parentGroupId: opts.parentGroupId ?? null,
      parentGroup: opts.parentName == null ? null : { name: opts.parentName },
    },
  };
}

function enrollment(opts: {
  id: string;
  studentId: string;
  lastName?: string;
  phone?: string | null;
  status?: CourseEnrollmentStatus;
  isPrimary?: boolean;
  memberships: RawMembership[];
}): RawEnrollment {
  return {
    id: opts.id,
    status: opts.status ?? "ACTIVE",
    isPrimary: opts.isPrimary ?? false,
    student: {
      id: opts.studentId,
      fullName: `full ${opts.studentId}`,
      lastName: opts.lastName ?? "כהן",
      phone: opts.phone ?? null,
    },
    memberships: opts.memberships,
  };
}

function view(
  id: string,
  groupName: string | null,
  subgroupNumber: number | null,
  lastName: string,
  extra: Partial<EnrolledTraineeView> = {},
): EnrolledTraineeView {
  return {
    id,
    fullName: `full ${id}`,
    lastName,
    phone: null,
    groupName,
    subgroupNumber,
    enrollmentStatus: "ACTIVE",
    isPrimary: false,
    ...extra,
  };
}

// --- interval semantics -----------------------------------------------------

test("effectiveFrom equal to asOf is active (inclusive lower bound)", () => {
  assert.equal(
    isMembershipCurrentAt({ effectiveFrom: AS_OF, effectiveTo: null }, AS_OF),
    true,
  );
});

test("effectiveFrom after asOf is not active", () => {
  assert.equal(
    isMembershipCurrentAt(
      { effectiveFrom: new Date("2026-07-20T00:00:00.000Z"), effectiveTo: null },
      AS_OF,
    ),
    false,
  );
});

test("effectiveTo null is open-ended (active when started)", () => {
  assert.equal(
    isMembershipCurrentAt(
      { effectiveFrom: new Date("2026-07-05T00:00:00.000Z"), effectiveTo: null },
      AS_OF,
    ),
    true,
  );
});

test("effectiveTo equal to asOf is not active (exclusive upper bound)", () => {
  assert.equal(
    isMembershipCurrentAt(
      { effectiveFrom: new Date("2026-07-05T00:00:00.000Z"), effectiveTo: AS_OF },
      AS_OF,
    ),
    false,
  );
});

test("effectiveTo after asOf is active", () => {
  assert.equal(
    isMembershipCurrentAt(
      {
        effectiveFrom: new Date("2026-07-05T00:00:00.000Z"),
        effectiveTo: new Date("2026-07-25T00:00:00.000Z"),
      },
      AS_OF,
    ),
    true,
  );
});

// --- subgroup parsing -------------------------------------------------------

test("valid positive integer subgroup names parse", () => {
  assert.deepEqual(parseSubgroupName("1"), { ok: true, value: 1 });
  assert.deepEqual(parseSubgroupName("8"), { ok: true, value: 8 });
  assert.deepEqual(parseSubgroupName("12"), { ok: true, value: 12 });
});

test("malformed subgroup names are rejected (never coerced)", () => {
  for (const bad of ["0", "-1", "1.5", "", " 1", "01", "abc", "1a", "+1", "٢"]) {
    assert.deepEqual(parseSubgroupName(bad), { ok: false }, `expected reject for ${JSON.stringify(bad)}`);
  }
});

// --- group/subgroup mapping -------------------------------------------------

test("top-level membership maps to groupName with null subgroup", () => {
  assert.deepEqual(
    resolveGroupFromMembership({ name: "א", parentGroupId: null, parentGroup: null }),
    { ok: true, groupName: "א", subgroupNumber: null },
  );
});

test("subgroup membership maps to parent groupName + numeric subgroup", () => {
  assert.deepEqual(
    resolveGroupFromMembership({ name: "3", parentGroupId: "g-top", parentGroup: { name: "ב" } }),
    { ok: true, groupName: "ב", subgroupNumber: 3 },
  );
});

test("subgroup with malformed name is an anomaly", () => {
  assert.deepEqual(
    resolveGroupFromMembership({ name: "x", parentGroupId: "g-top", parentGroup: { name: "ב" } }),
    { ok: false, kind: "MALFORMED_SUBGROUP" },
  );
});

test("subgroup with missing parent group is an anomaly", () => {
  assert.deepEqual(
    resolveGroupFromMembership({ name: "3", parentGroupId: "g-top", parentGroup: null }),
    { ok: false, kind: "MISSING_PARENT_GROUP" },
  );
});

// --- membership cardinality -------------------------------------------------

test("exactly one current membership yields a valid view", () => {
  const result = buildEnrollmentRoster(
    [
      enrollment({
        id: "e1",
        studentId: "s1",
        lastName: "אבן",
        isPrimary: true,
        memberships: [
          membership({ from: "2026-07-05T00:00:00.000Z", name: "2", parentGroupId: "g", parentName: "א" }),
        ],
      }),
    ],
    AS_OF,
  );
  assert.equal(result.anomalies.length, 0);
  assert.deepEqual(result.rows, [
    view("s1", "א", 2, "אבן", { fullName: "full s1", isPrimary: true }),
  ]);
});

test("zero current memberships is a NO_CURRENT_MEMBERSHIP anomaly", () => {
  const result = buildEnrollmentRoster(
    [enrollment({ id: "e1", studentId: "s1", memberships: [] })],
    AS_OF,
  );
  assert.equal(result.rows.length, 0);
  assert.deepEqual(result.anomalies, [
    { enrollmentId: "e1", studentId: "s1", kind: "NO_CURRENT_MEMBERSHIP", currentMembershipCount: 0 },
  ]);
});

test("two current memberships is a MULTIPLE_CURRENT_MEMBERSHIPS anomaly", () => {
  const result = buildEnrollmentRoster(
    [
      enrollment({
        id: "e1",
        studentId: "s1",
        memberships: [
          membership({ from: "2026-07-05T00:00:00.000Z", name: "1", parentGroupId: "g", parentName: "א" }),
          membership({ from: "2026-07-06T00:00:00.000Z", name: "2", parentGroupId: "g", parentName: "א" }),
        ],
      }),
    ],
    AS_OF,
  );
  assert.equal(result.rows.length, 0);
  assert.deepEqual(result.anomalies, [
    { enrollmentId: "e1", studentId: "s1", kind: "MULTIPLE_CURRENT_MEMBERSHIPS", currentMembershipCount: 2 },
  ]);
});

test("a future open-ended membership is not treated as current", () => {
  const result = buildEnrollmentRoster(
    [
      enrollment({
        id: "e1",
        studentId: "s1",
        memberships: [
          membership({ from: "2026-08-01T00:00:00.000Z", to: null, name: "1", parentGroupId: "g", parentName: "א" }),
        ],
      }),
    ],
    AS_OF,
  );
  assert.equal(result.rows.length, 0);
  assert.equal(result.anomalies[0].kind, "NO_CURRENT_MEMBERSHIP");
});

test("membership history: a closed past interval is ignored, only the current open one is selected", () => {
  const result = buildEnrollmentRoster(
    [
      enrollment({
        id: "e1",
        studentId: "s1",
        lastName: "אבן",
        memberships: [
          // closed PAST interval [2026-07-05, 2026-07-10) - not current at AS_OF
          membership({
            from: "2026-07-05T00:00:00.000Z",
            to: "2026-07-10T00:00:00.000Z",
            name: "1",
            parentGroupId: "g",
            parentName: "א",
          }),
          // current OPEN-ENDED interval [2026-07-10, null) - current at AS_OF
          membership({
            from: "2026-07-10T00:00:00.000Z",
            to: null,
            name: "2",
            parentGroupId: "g",
            parentName: "א",
          }),
        ],
      }),
    ],
    AS_OF,
  );
  assert.equal(result.anomalies.length, 0);
  assert.equal(result.rows.length, 1);
  // The current membership (subgroup 2) wins; the closed past one (subgroup 1) is ignored.
  assert.equal(result.rows[0].subgroupNumber, 2);
  assert.equal(result.rows[0].groupName, "א");
});

// --- ordering ---------------------------------------------------------------

test("ordering: group, then subgroup, then lastName, then id", () => {
  const rows = [
    view("id5", "ב", 1, "כהן"),
    view("id2", "א", 2, "לוי"),
    view("id1", "א", 1, "אבן"),
    view("id4", "א", null, "רון"), // null subgroup sorts LAST within its group
    view("id3", "א", 1, "בר"),
  ];
  assert.deepEqual(
    [...rows].sort(compareTraineeView).map((r) => r.id),
    ["id1", "id3", "id2", "id4", "id5"],
  );
});

test("ordering: null subgroup sorts after any numbered subgroup in the same group", () => {
  const nullSub = view("a", "א", null, "כהן");
  const numbered = view("b", "א", 1, "כהן");
  assert.deepEqual([nullSub, numbered].sort(compareTraineeView).map((r) => r.id), ["b", "a"]);
});

test("ordering: student id is the deterministic final tie-breaker", () => {
  const later = view("z", "א", 1, "כהן");
  const earlier = view("a", "א", 1, "כהן");
  assert.deepEqual([later, earlier].sort(compareTraineeView).map((r) => r.id), ["a", "z"]);
});

// --- parity comparison ------------------------------------------------------

function rosterResult(
  rows: EnrolledTraineeView[],
  anomalies: EnrollmentMembershipAnomaly[] = [],
): EnrollmentRosterResult {
  return { rows, anomalies };
}

const LEGACY_TWO: LegacyRosterRow[] = [
  { id: "s1", groupName: "א", subgroupNumber: 1, lastName: "אבן" },
  { id: "s2", groupName: "ב", subgroupNumber: 2, lastName: "כהן" },
];

test("parity: exact match passes", () => {
  const report = compareRosters(
    LEGACY_TWO,
    rosterResult([view("s1", "א", 1, "אבן"), view("s2", "ב", 2, "כהן")]),
  );
  assert.equal(report.ok, true);
  assert.equal(report.legacyCount, 2);
  assert.equal(report.enrollmentCount, 2);
});

test("parity: id missing from enrollment fails", () => {
  const report = compareRosters(LEGACY_TWO, rosterResult([view("s1", "א", 1, "אבן")]));
  assert.equal(report.ok, false);
  assert.deepEqual(report.missingFromEnrollment, ["s2"]);
});

test("parity: extra id in enrollment fails", () => {
  const report = compareRosters(
    LEGACY_TWO,
    rosterResult([view("s1", "א", 1, "אבן"), view("s2", "ב", 2, "כהן"), view("s3", "ב", 2, "לוי")]),
  );
  assert.equal(report.ok, false);
  assert.deepEqual(report.extraInEnrollment, ["s3"]);
});

test("parity: group mismatch fails", () => {
  const report = compareRosters(
    LEGACY_TWO,
    rosterResult([view("s1", "ב", 1, "אבן"), view("s2", "ב", 2, "כהן")]),
  );
  assert.equal(report.ok, false);
  assert.deepEqual(report.groupMismatches, ["s1"]);
});

test("parity: subgroup mismatch fails", () => {
  const report = compareRosters(
    LEGACY_TWO,
    rosterResult([view("s1", "א", 9, "אבן"), view("s2", "ב", 2, "כהן")]),
  );
  assert.equal(report.ok, false);
  assert.deepEqual(report.subgroupMismatches, ["s1"]);
});

test("parity: identical data and order passes with ORDERING MATCH", () => {
  const report = compareRosters(
    LEGACY_TWO,
    rosterResult([view("s1", "א", 1, "אבן"), view("s2", "ב", 2, "כהן")]),
  );
  assert.equal(report.ok, true);
  assert.equal(report.orderMismatch, false);
  assert.equal(report.orderFirstDivergenceIndex, null);
});

test("parity: order mismatch ALONE does not fail data parity (collation observation only)", () => {
  const report = compareRosters(
    LEGACY_TWO,
    rosterResult([view("s2", "ב", 2, "כהן"), view("s1", "א", 1, "אבן")]),
  );
  // Same set + same per-id group/subgroup -> data parity PASSES...
  assert.equal(report.ok, true);
  assert.deepEqual(report.groupMismatches, []);
  assert.deepEqual(report.subgroupMismatches, []);
  // ...but the ordering difference is still observed and reported.
  assert.equal(report.orderMismatch, true);
  assert.equal(report.orderFirstDivergenceIndex, 0);
});

test("parity: duplicate legacy id fails", () => {
  const legacy: LegacyRosterRow[] = [
    { id: "s1", groupName: "א", subgroupNumber: 1, lastName: "אבן" },
    { id: "s1", groupName: "א", subgroupNumber: 1, lastName: "אבן" },
  ];
  const report = compareRosters(legacy, rosterResult([view("s1", "א", 1, "אבן")]));
  assert.equal(report.ok, false);
  assert.deepEqual(report.duplicateLegacyIds, ["s1"]);
});

test("parity: duplicate enrollment id fails", () => {
  const report = compareRosters(
    LEGACY_TWO,
    rosterResult([
      view("s1", "א", 1, "אבן"),
      view("s1", "א", 1, "אבן"),
      view("s2", "ב", 2, "כהן"),
    ]),
  );
  assert.equal(report.ok, false);
  assert.deepEqual(report.duplicateEnrollmentIds, ["s1"]);
});

test("parity: a membership anomaly fails even when rows match", () => {
  const report = compareRosters(
    LEGACY_TWO,
    rosterResult(
      [view("s1", "א", 1, "אבן"), view("s2", "ב", 2, "כהן")],
      [{ enrollmentId: "e9", studentId: "s9", kind: "NO_CURRENT_MEMBERSHIP", currentMembershipCount: 0 }],
    ),
  );
  assert.equal(report.ok, false);
  assert.equal(report.anomalyCount, 1);
});

test("parity: isPrimary rows are counted but not required as a selector", () => {
  const report = compareRosters(
    LEGACY_TWO,
    rosterResult([
      view("s1", "א", 1, "אבן", { isPrimary: true }),
      view("s2", "ב", 2, "כהן", { isPrimary: false }),
    ]),
  );
  assert.equal(report.ok, true);
  assert.equal(report.primaryCount, 1);
});
