/**
 * MULTI-COURSE W5C0 - executable tests for the PURE active-trainee directory
 * projection, the dependency-injected loader orchestration, and the read-only
 * directory parity comparison.
 *
 * Run with: npx tsx --test lib/course/active-trainee-directory.test.ts
 * PURE: no Prisma, no DB, no real clock, no randomness (the loader clock and
 * dependencies are injected as fakes).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  toActiveTraineeDirectoryRows,
  compareActiveTraineeDirectoryRow,
  loadActiveTraineeDirectoryWithDeps,
  compareActiveTraineeDirectory,
  type ActiveTraineeDirectoryRow,
  type ActiveTraineeDirectoryDeps,
  type LegacyDirectoryRow,
} from "./active-trainee-directory";
import {
  buildEnrollmentRoster,
  type EnrolledTraineeView,
  type EnrollmentRosterResult,
  type EnrollmentMembershipAnomaly,
  type RawEnrollment,
  type RawMembership,
} from "./enrollment-view";

// --- fixtures ---------------------------------------------------------------

/** Build a full EnrolledTraineeView with directory-relevant fields set and the
 * private fields (lastName/phone/enrollmentStatus/isPrimary) filled so leakage
 * can be asserted against. */
function enrolledView(
  id: string,
  fullName: string,
  groupName: string | null,
  subgroupNumber: number | null,
  extra: Partial<EnrolledTraineeView> = {},
): EnrolledTraineeView {
  return {
    id,
    fullName,
    lastName: "כהן",
    phone: "050-0000000",
    groupName,
    subgroupNumber,
    enrollmentStatus: "ACTIVE",
    isPrimary: true,
    ...extra,
  };
}

function roster(
  rows: EnrolledTraineeView[],
  anomalies: EnrollmentMembershipAnomaly[] = [],
): EnrollmentRosterResult {
  return { rows, anomalies };
}

// --- projection: row shape --------------------------------------------------

test("projection: yields exactly the four directory keys", () => {
  const rows = toActiveTraineeDirectoryRows(roster([enrolledView("s1", "אבי", "א", 2)]));
  assert.equal(rows.length, 1);
  assert.deepEqual(Object.keys(rows[0]).sort(), ["fullName", "groupName", "id", "subgroupNumber"]);
  assert.deepEqual(rows[0], { id: "s1", fullName: "אבי", groupName: "א", subgroupNumber: 2 });
});

test("projection: private fields (lastName/phone/enrollmentStatus/isPrimary) do not leak", () => {
  const rows = toActiveTraineeDirectoryRows(roster([enrolledView("s1", "אבי", "א", 2)]));
  const row = rows[0] as unknown as Record<string, unknown>;
  assert.equal("lastName" in row, false);
  assert.equal("phone" in row, false);
  assert.equal("enrollmentStatus" in row, false);
  assert.equal("isPrimary" in row, false);
});

test("projection: null group and null subgroup are preserved", () => {
  const rows = toActiveTraineeDirectoryRows(
    roster([enrolledView("s1", "אבי", null, null)]),
  );
  assert.equal(rows[0].groupName, null);
  assert.equal(rows[0].subgroupNumber, null);
});

test("projection: empty roster returns an empty array", () => {
  assert.deepEqual(toActiveTraineeDirectoryRows(roster([])), []);
});

// --- projection: refusal semantics ------------------------------------------

test("projection: any membership anomaly causes a throw (never silently dropped)", () => {
  const anomaly: EnrollmentMembershipAnomaly = {
    enrollmentId: "e9",
    studentId: "s9",
    kind: "NO_CURRENT_MEMBERSHIP",
    currentMembershipCount: 0,
  };
  assert.throws(
    () => toActiveTraineeDirectoryRows(roster([enrolledView("s1", "אבי", "א", 1)], [anomaly])),
    /membership anomaly/i,
  );
});

test("projection: a MALFORMED_SUBGROUP anomaly (via buildEnrollmentRoster) causes a throw", () => {
  const asOf = new Date("2026-07-19T12:00:00.000Z");
  const membership: RawMembership = {
    effectiveFrom: new Date("2026-07-05T00:00:00.000Z"),
    effectiveTo: null,
    // subgroup name "x" is not a canonical positive integer -> MALFORMED_SUBGROUP
    courseGroup: { name: "x", parentGroupId: "g-top", parentGroup: { name: "א" } },
  };
  const enrollment: RawEnrollment = {
    id: "e1",
    status: "ACTIVE",
    isPrimary: false,
    student: { id: "s1", fullName: "אבי", lastName: "כהן", phone: null },
    memberships: [membership],
  };
  const built = buildEnrollmentRoster([enrollment], asOf);
  assert.equal(built.anomalies[0].kind, "MALFORMED_SUBGROUP");
  assert.throws(() => toActiveTraineeDirectoryRows(built), /membership anomaly/i);
});

test("projection: a duplicate student id causes a throw", () => {
  assert.throws(
    () =>
      toActiveTraineeDirectoryRows(
        roster([enrolledView("s1", "אבי", "א", 1), enrolledView("s1", "אבי", "א", 1)]),
      ),
    /duplicate student id/i,
  );
});

test("projection: refusal error messages are PII-free (no fullName/phone leak)", () => {
  const anomaly: EnrollmentMembershipAnomaly = {
    enrollmentId: "e9",
    studentId: "s9",
    kind: "NO_CURRENT_MEMBERSHIP",
    currentMembershipCount: 0,
  };
  try {
    toActiveTraineeDirectoryRows(roster([enrolledView("s1", "דוד ישראלי", "א", 1)], [anomaly]));
    assert.fail("expected throw");
  } catch (err) {
    const message = (err as Error).message;
    assert.equal(message.includes("דוד ישראלי"), false);
    assert.equal(message.includes("050-"), false);
  }
});

// --- projection: ordering ---------------------------------------------------

test("projection: rows are returned sorted by fullName ascending", () => {
  const rows = toActiveTraineeDirectoryRows(
    roster([
      enrolledView("s3", "גד", "א", 1),
      enrolledView("s1", "אבי", "ב", 2),
      enrolledView("s2", "בני", "א", null),
    ]),
  );
  assert.deepEqual(rows.map((r) => r.fullName), ["אבי", "בני", "גד"]);
});

test("projection: identical fullName is ordered by student id (deterministic tie-breaker)", () => {
  const rows = toActiveTraineeDirectoryRows(
    roster([enrolledView("zzz", "אבי", "א", 1), enrolledView("aaa", "אבי", "ב", 2)]),
  );
  assert.deepEqual(rows.map((r) => r.id), ["aaa", "zzz"]);
});

test("comparator: fullName then id, pure and standalone", () => {
  const a: ActiveTraineeDirectoryRow = { id: "z", fullName: "אבי", groupName: null, subgroupNumber: null };
  const b: ActiveTraineeDirectoryRow = { id: "a", fullName: "אבי", groupName: null, subgroupNumber: null };
  assert.equal(compareActiveTraineeDirectoryRow(a, b) > 0, true); // same name -> id "z" after "a"
  assert.equal(compareActiveTraineeDirectoryRow(b, a) < 0, true);
});

// --- loader orchestration ---------------------------------------------------

interface Recorder {
  calls: string[];
  nowCount: number;
  offeringIdSeen: string | null;
  asOfSeen: Date | null;
}

function fakeDeps(
  overrides: Partial<ActiveTraineeDirectoryDeps>,
  rec: Recorder,
): ActiveTraineeDirectoryDeps {
  const fixedNow = new Date("2026-07-19T09:00:00.000Z");
  return {
    resolveCurrentCourseOffering: async () => {
      rec.calls.push("resolveOffering");
      return { id: "offering-1" };
    },
    now: () => {
      rec.calls.push("now");
      rec.nowCount += 1;
      return fixedNow;
    },
    getCurrentCourseEnrollmentRoster: async (courseOfferingId, options) => {
      rec.calls.push("loadRoster");
      rec.offeringIdSeen = courseOfferingId;
      rec.asOfSeen = options.asOf;
      return roster([enrolledView("s1", "אבי", "א", 1)]);
    },
    ...overrides,
  };
}

function newRecorder(): Recorder {
  return { calls: [], nowCount: 0, offeringIdSeen: null, asOfSeen: null };
}

test("loader: resolves the offering BEFORE loading the roster, then projects", async () => {
  const rec = newRecorder();
  const rows = await loadActiveTraineeDirectoryWithDeps(fakeDeps({}, rec));
  assert.deepEqual(rec.calls, ["resolveOffering", "now", "loadRoster"]);
  assert.deepEqual(rows, [{ id: "s1", fullName: "אבי", groupName: "א", subgroupNumber: 1 }]);
});

test("loader: captures exactly ONE asOf and passes it to the roster DAL", async () => {
  const rec = newRecorder();
  await loadActiveTraineeDirectoryWithDeps(fakeDeps({}, rec));
  assert.equal(rec.nowCount, 1);
  assert.equal(rec.asOfSeen?.toISOString(), "2026-07-19T09:00:00.000Z");
});

test("loader: passes the resolved offering id to the roster DAL", async () => {
  const rec = newRecorder();
  await loadActiveTraineeDirectoryWithDeps(
    fakeDeps(
      { resolveCurrentCourseOffering: async () => ({ id: "offering-XYZ" }) },
      rec,
    ),
  );
  assert.equal(rec.offeringIdSeen, "offering-XYZ");
});

test("loader: resolver failure propagates (no fallback, roster never loaded)", async () => {
  const rec = newRecorder();
  await assert.rejects(
    loadActiveTraineeDirectoryWithDeps(
      fakeDeps(
        {
          resolveCurrentCourseOffering: async () => {
            rec.calls.push("resolveOffering");
            throw new Error("AMBIGUOUS");
          },
        },
        rec,
      ),
    ),
    /AMBIGUOUS/,
  );
  assert.equal(rec.calls.includes("loadRoster"), false);
});

test("loader: roster failure propagates (no Student fallback)", async () => {
  const rec = newRecorder();
  await assert.rejects(
    loadActiveTraineeDirectoryWithDeps(
      fakeDeps(
        {
          getCurrentCourseEnrollmentRoster: async () => {
            throw new Error("roster boom");
          },
        },
        rec,
      ),
    ),
    /roster boom/,
  );
});

test("loader: a roster anomaly propagates as a projection throw (no silent drop)", async () => {
  const rec = newRecorder();
  await assert.rejects(
    loadActiveTraineeDirectoryWithDeps(
      fakeDeps(
        {
          getCurrentCourseEnrollmentRoster: async () =>
            roster(
              [enrolledView("s1", "אבי", "א", 1)],
              [
                {
                  enrollmentId: "e2",
                  studentId: "s2",
                  kind: "NO_CURRENT_MEMBERSHIP",
                  currentMembershipCount: 0,
                },
              ],
            ),
        },
        rec,
      ),
    ),
    /membership anomaly/i,
  );
});

// --- directory parity comparison --------------------------------------------

const LEGACY_TWO: LegacyDirectoryRow[] = [
  { id: "s1", groupName: "א", subgroupNumber: 1 },
  { id: "s2", groupName: "ב", subgroupNumber: 2 },
];

function dir(
  id: string,
  groupName: string | null,
  subgroupNumber: number | null,
): ActiveTraineeDirectoryRow {
  return { id, fullName: `full ${id}`, groupName, subgroupNumber };
}

test("parity: exact match (same ids, groups, subgroups, order) passes with MATCH", () => {
  const report = compareActiveTraineeDirectory(LEGACY_TWO, [dir("s1", "א", 1), dir("s2", "ב", 2)]);
  assert.equal(report.ok, true);
  assert.equal(report.orderMismatch, false);
  assert.equal(report.orderFirstDivergenceIndex, null);
});

test("parity: missing id fails", () => {
  const report = compareActiveTraineeDirectory(LEGACY_TWO, [dir("s1", "א", 1)]);
  assert.equal(report.ok, false);
  assert.deepEqual(report.missingFromDirectory, ["s2"]);
});

test("parity: extra id fails", () => {
  const report = compareActiveTraineeDirectory(LEGACY_TWO, [
    dir("s1", "א", 1),
    dir("s2", "ב", 2),
    dir("s3", "ב", 3),
  ]);
  assert.equal(report.ok, false);
  assert.deepEqual(report.extraInDirectory, ["s3"]);
});

test("parity: group mismatch fails", () => {
  const report = compareActiveTraineeDirectory(LEGACY_TWO, [dir("s1", "ב", 1), dir("s2", "ב", 2)]);
  assert.equal(report.ok, false);
  assert.deepEqual(report.groupMismatches, ["s1"]);
});

test("parity: subgroup mismatch fails", () => {
  const report = compareActiveTraineeDirectory(LEGACY_TWO, [dir("s1", "א", 9), dir("s2", "ב", 2)]);
  assert.equal(report.ok, false);
  assert.deepEqual(report.subgroupMismatches, ["s1"]);
});

test("parity: duplicate id fails", () => {
  const report = compareActiveTraineeDirectory(LEGACY_TWO, [
    dir("s1", "א", 1),
    dir("s1", "א", 1),
    dir("s2", "ב", 2),
  ]);
  assert.equal(report.ok, false);
  assert.deepEqual(report.duplicateDirectoryIds, ["s1"]);
});

test("parity: duplicate legacy id fails", () => {
  const legacy: LegacyDirectoryRow[] = [
    { id: "s1", groupName: "א", subgroupNumber: 1 },
    { id: "s1", groupName: "א", subgroupNumber: 1 },
  ];
  const report = compareActiveTraineeDirectory(legacy, [dir("s1", "א", 1)]);
  assert.equal(report.ok, false);
  assert.deepEqual(report.duplicateLegacyIds, ["s1"]);
});

test("parity: order-only mismatch remains informational (data parity still PASSES)", () => {
  // Same set + same per-id group/subgroup, but reversed positional order.
  const report = compareActiveTraineeDirectory(LEGACY_TWO, [dir("s2", "ב", 2), dir("s1", "א", 1)]);
  assert.equal(report.ok, true);
  assert.deepEqual(report.groupMismatches, []);
  assert.deepEqual(report.subgroupMismatches, []);
  assert.equal(report.orderMismatch, true);
  assert.equal(report.orderFirstDivergenceIndex, 0);
});

test("parity: null group/subgroup values compare as equal (preserved)", () => {
  const legacy: LegacyDirectoryRow[] = [{ id: "s1", groupName: null, subgroupNumber: null }];
  const report = compareActiveTraineeDirectory(legacy, [dir("s1", null, null)]);
  assert.equal(report.ok, true);
});
