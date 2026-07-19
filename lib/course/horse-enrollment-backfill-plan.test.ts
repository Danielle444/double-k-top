/**
 * MULTI-COURSE W8A-2 - pure unit tests for the enrollment-scoped horse backfill
 * planner. No DB, no framework: node:test + node:assert/strict, run with
 *
 *   npx tsx --test lib/course/horse-enrollment-backfill-plan.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildHorseEnrollmentPlan,
  formatHorseEnrollmentPlanSummary,
  formatHorseEnrollmentAnomalies,
  type EnrollmentInput,
  type HorseAssignmentInput,
} from "./horse-enrollment-backfill-plan";

const OFFERING = "off_current";
const ASOF = "2026-07-19";

function enrollment(over: Partial<EnrollmentInput> & { id: string; studentId: string }): EnrollmentInput {
  return {
    hasPrivateHorse: false,
    privateHorseName: null,
    assignedHorseName: null,
    ...over,
  };
}

function assignment(
  over: Partial<HorseAssignmentInput> & { id: string; studentId: string },
): HorseAssignmentInput {
  return {
    courseEnrollmentId: null,
    assignedHorseName: null,
    hasPrivateHorse: false,
    privateHorseName: null,
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    ...over,
  };
}

/** Build N students, each with one enrollment + one open horse row (1:1:1). */
function happyInputs(n: number): {
  enrollments: EnrollmentInput[];
  horseAssignments: HorseAssignmentInput[];
} {
  const enrollments: EnrollmentInput[] = [];
  const horseAssignments: HorseAssignmentInput[] = [];
  for (let i = 0; i < n; i++) {
    const sid = `stu_${String(i).padStart(2, "0")}`;
    enrollments.push(enrollment({ id: `enr_${String(i).padStart(2, "0")}`, studentId: sid }));
    horseAssignments.push(
      assignment({
        id: `tha_${String(i).padStart(2, "0")}`,
        studentId: sid,
        assignedHorseName: `Horse${i}`,
      }),
    );
  }
  return { enrollments, horseAssignments };
}

test("happy 41-style plan: 41 link updates, cache derived, zero anomalies", () => {
  const { enrollments, horseAssignments } = happyInputs(41);
  const plan = buildHorseEnrollmentPlan({
    currentOfferingId: OFFERING,
    asOf: ASOF,
    enrollments,
    horseAssignments,
  });

  assert.equal(plan.canApply, true);
  assert.equal(plan.summary.anomalyTotal, 0);
  assert.equal(plan.summary.totalHistoryRows, 41);
  assert.equal(plan.summary.totalEnrollments, 41);
  assert.equal(plan.summary.linkUpdatesRequired, 41);
  // Every trainee has a ranch horse != the default no-horse cache, so all 41
  // enrollment caches need populating.
  assert.equal(plan.summary.cacheUpdatesRequired, 41);
  assert.equal(plan.summary.alreadyCorrectLinks, 0);
  assert.equal(plan.summary.alreadyCorrectCaches, 0);
  assert.equal(plan.rows.length, 41);
  for (const r of plan.rows) {
    assert.equal(r.linkNeedsUpdate, true);
    assert.equal(r.isCacheSource, true);
    assert.equal(r.cacheNeedsUpdate, true);
    assert.equal(r.targetHasPrivateHorse, false);
    assert.equal(r.targetPrivateHorseName, null);
    assert.ok(r.targetAssignedHorseName && r.targetAssignedHorseName.startsWith("Horse"));
  }
});

test("one enrollment per student resolves the link target by studentId only", () => {
  const plan = buildHorseEnrollmentPlan({
    currentOfferingId: OFFERING,
    asOf: ASOF,
    enrollments: [enrollment({ id: "enr_a", studentId: "s1" })],
    horseAssignments: [assignment({ id: "tha_a", studentId: "s1", assignedHorseName: "Bella" })],
  });
  assert.equal(plan.canApply, true);
  assert.equal(plan.rows[0].courseEnrollmentId, "enr_a");
  assert.equal(plan.rows[0].targetAssignedHorseName, "Bella");
});

test("zero-enrollment anomaly: history row for a student with no enrollment", () => {
  const plan = buildHorseEnrollmentPlan({
    currentOfferingId: OFFERING,
    asOf: ASOF,
    enrollments: [],
    horseAssignments: [assignment({ id: "tha_a", studentId: "s1" })],
  });
  assert.equal(plan.canApply, false);
  assert.equal(plan.summary.zeroEnrollment, 1);
  assert.equal(plan.rows.length, 0);
  assert.deepEqual(plan.anomalies[0], {
    kind: "zero-enrollment",
    studentId: "s1",
    traineeHorseAssignmentId: "tha_a",
  });
});

test("multiple-enrollment anomaly: two enrollments share a studentId", () => {
  const plan = buildHorseEnrollmentPlan({
    currentOfferingId: OFFERING,
    asOf: ASOF,
    enrollments: [
      enrollment({ id: "enr_a", studentId: "s1" }),
      enrollment({ id: "enr_b", studentId: "s1" }),
    ],
    horseAssignments: [assignment({ id: "tha_a", studentId: "s1" })],
  });
  assert.equal(plan.canApply, false);
  assert.equal(plan.summary.multipleEnrollment, 1);
  const a = plan.anomalies.find((x) => x.kind === "multiple-enrollment");
  assert.ok(a && a.kind === "multiple-enrollment");
  assert.deepEqual(a.courseEnrollmentIds, ["enr_a", "enr_b"]);
});

test("student/enrollment mismatch anomaly: pre-linked to another student's enrollment", () => {
  const plan = buildHorseEnrollmentPlan({
    currentOfferingId: OFFERING,
    asOf: ASOF,
    enrollments: [
      enrollment({ id: "enr_s1", studentId: "s1" }),
      enrollment({ id: "enr_s2", studentId: "s2" }),
    ],
    horseAssignments: [
      // s1's history row already points at s2's enrollment.
      assignment({ id: "tha_a", studentId: "s1", courseEnrollmentId: "enr_s2" }),
      assignment({ id: "tha_b", studentId: "s2" }),
    ],
  });
  assert.equal(plan.canApply, false);
  assert.equal(plan.summary.studentEnrollmentMismatch, 1);
  const a = plan.anomalies.find((x) => x.kind === "student-enrollment-mismatch");
  assert.ok(a && a.kind === "student-enrollment-mismatch");
  assert.equal(a.traineeHorseAssignmentId, "tha_a");
  assert.equal(a.historyStudentId, "s1");
  assert.equal(a.enrollmentStudentId, "s2");
});

test("missing-current-history anomaly: enrollment whose only interval is closed before asOf", () => {
  const plan = buildHorseEnrollmentPlan({
    currentOfferingId: OFFERING,
    asOf: ASOF,
    enrollments: [enrollment({ id: "enr_a", studentId: "s1" })],
    horseAssignments: [
      assignment({
        id: "tha_a",
        studentId: "s1",
        effectiveFrom: "2026-01-01",
        effectiveTo: "2026-06-01", // closed before 2026-07-19
      }),
    ],
  });
  assert.equal(plan.canApply, false);
  assert.equal(plan.summary.missingCurrentHistory, 1);
  const a = plan.anomalies.find((x) => x.kind === "missing-current-history");
  assert.ok(a && a.kind === "missing-current-history");
  assert.equal(a.courseEnrollmentId, "enr_a");
});

test("multiple-current-history anomaly: two overlapping intervals cover asOf", () => {
  const plan = buildHorseEnrollmentPlan({
    currentOfferingId: OFFERING,
    asOf: ASOF,
    enrollments: [enrollment({ id: "enr_a", studentId: "s1" })],
    horseAssignments: [
      assignment({ id: "tha_a", studentId: "s1", effectiveFrom: "2026-01-01", effectiveTo: null }),
      assignment({ id: "tha_b", studentId: "s1", effectiveFrom: "2026-05-01", effectiveTo: null }),
    ],
  });
  assert.equal(plan.canApply, false);
  assert.equal(plan.summary.multipleCurrentHistory, 1);
  const a = plan.anomalies.find((x) => x.kind === "multiple-current-history");
  assert.ok(a && a.kind === "multiple-current-history");
  assert.deepEqual(a.traineeHorseAssignmentIds, ["tha_a", "tha_b"]);
});

test("invalid-horse-state anomaly: contradictory horse fields on the current interval", () => {
  const plan = buildHorseEnrollmentPlan({
    currentOfferingId: OFFERING,
    asOf: ASOF,
    enrollments: [enrollment({ id: "enr_a", studentId: "s1" })],
    horseAssignments: [
      // hasPrivateHorse=true but a ranch (assigned) name is present -> noncanonical.
      assignment({
        id: "tha_a",
        studentId: "s1",
        hasPrivateHorse: true,
        assignedHorseName: "RanchHorse",
      }),
    ],
  });
  assert.equal(plan.canApply, false);
  assert.equal(plan.summary.invalidHorseState, 1);
  const a = plan.anomalies.find((x) => x.kind === "invalid-horse-state");
  assert.ok(a && a.kind === "invalid-horse-state");
  assert.equal(a.traineeHorseAssignmentId, "tha_a");
});

test("already-linked-correctly: FK already points at the right enrollment, no link update", () => {
  const plan = buildHorseEnrollmentPlan({
    currentOfferingId: OFFERING,
    asOf: ASOF,
    enrollments: [enrollment({ id: "enr_a", studentId: "s1", assignedHorseName: "Bella" })],
    horseAssignments: [
      assignment({
        id: "tha_a",
        studentId: "s1",
        courseEnrollmentId: "enr_a",
        assignedHorseName: "Bella",
      }),
    ],
  });
  assert.equal(plan.canApply, true);
  assert.equal(plan.summary.linkUpdatesRequired, 0);
  assert.equal(plan.summary.alreadyCorrectLinks, 1);
  assert.equal(plan.rows[0].linkNeedsUpdate, false);
  assert.equal(plan.rows[0].alreadyLinkedCorrectly, true);
});

test("pre-linked-wrong-enrollment anomaly: FK points at a different same-owner-unknown enrollment", () => {
  const plan = buildHorseEnrollmentPlan({
    currentOfferingId: OFFERING,
    asOf: ASOF,
    enrollments: [enrollment({ id: "enr_a", studentId: "s1" })],
    horseAssignments: [
      // Points at an enrollment id that is not in the current offering set.
      assignment({ id: "tha_a", studentId: "s1", courseEnrollmentId: "enr_stale" }),
    ],
  });
  assert.equal(plan.canApply, false);
  assert.equal(plan.summary.preLinkedWrongEnrollment, 1);
  const a = plan.anomalies.find((x) => x.kind === "pre-linked-wrong-enrollment");
  assert.ok(a && a.kind === "pre-linked-wrong-enrollment");
  assert.equal(a.currentCourseEnrollmentId, "enr_stale");
  assert.equal(a.expectedCourseEnrollmentId, "enr_a");
});

test("cache already matches: enrollment cache equals the current interval, no cache update", () => {
  const plan = buildHorseEnrollmentPlan({
    currentOfferingId: OFFERING,
    asOf: ASOF,
    enrollments: [
      enrollment({
        id: "enr_a",
        studentId: "s1",
        hasPrivateHorse: true,
        privateHorseName: "Shadow",
        assignedHorseName: null,
      }),
    ],
    horseAssignments: [
      assignment({
        id: "tha_a",
        studentId: "s1",
        hasPrivateHorse: true,
        privateHorseName: "Shadow",
      }),
    ],
  });
  assert.equal(plan.canApply, true);
  assert.equal(plan.summary.cacheUpdatesRequired, 0);
  assert.equal(plan.summary.alreadyCorrectCaches, 1);
  assert.equal(plan.rows[0].cacheNeedsUpdate, false);
  assert.equal(plan.rows[0].cacheAlreadyMatches, true);
});

test("cache needs update: enrollment default cache differs from a private-horse interval", () => {
  const plan = buildHorseEnrollmentPlan({
    currentOfferingId: OFFERING,
    asOf: ASOF,
    enrollments: [enrollment({ id: "enr_a", studentId: "s1" })],
    horseAssignments: [
      assignment({ id: "tha_a", studentId: "s1", hasPrivateHorse: true, privateHorseName: "Rocky" }),
    ],
  });
  assert.equal(plan.rows[0].cacheNeedsUpdate, true);
  assert.equal(plan.rows[0].targetHasPrivateHorse, true);
  assert.equal(plan.rows[0].targetPrivateHorseName, "Rocky");
  assert.equal(plan.rows[0].targetAssignedHorseName, null);
});

test("duplicate-history-row anomaly: same traineeHorseAssignmentId twice", () => {
  const plan = buildHorseEnrollmentPlan({
    currentOfferingId: OFFERING,
    asOf: ASOF,
    enrollments: [enrollment({ id: "enr_a", studentId: "s1" })],
    horseAssignments: [
      assignment({ id: "dup", studentId: "s1" }),
      assignment({ id: "dup", studentId: "s1" }),
    ],
  });
  assert.equal(plan.canApply, false);
  assert.equal(plan.summary.duplicateHistoryRow, 1);
});

test("duplicate-enrollment anomaly: same courseEnrollmentId twice", () => {
  const plan = buildHorseEnrollmentPlan({
    currentOfferingId: OFFERING,
    asOf: ASOF,
    enrollments: [
      enrollment({ id: "dup", studentId: "s1" }),
      enrollment({ id: "dup", studentId: "s1" }),
    ],
    horseAssignments: [assignment({ id: "tha_a", studentId: "s1" })],
  });
  assert.equal(plan.canApply, false);
  assert.equal(plan.summary.duplicateEnrollment, 1);
});

test("deterministic output ordering: shuffled inputs produce an identical plan", () => {
  const { enrollments, horseAssignments } = happyInputs(6);
  const forward = buildHorseEnrollmentPlan({
    currentOfferingId: OFFERING,
    asOf: ASOF,
    enrollments,
    horseAssignments,
  });
  const reversed = buildHorseEnrollmentPlan({
    currentOfferingId: OFFERING,
    asOf: ASOF,
    enrollments: [...enrollments].reverse(),
    horseAssignments: [...horseAssignments].reverse(),
  });
  assert.deepEqual(reversed, forward);
  // Rows are in (studentId, id) order.
  const ids = forward.rows.map((r) => r.traineeHorseAssignmentId);
  assert.deepEqual(ids, [...ids].sort());
});

test("safe PII-free diagnostics: summary + anomaly lines never leak names/horses/credentials", () => {
  const plan = buildHorseEnrollmentPlan({
    currentOfferingId: OFFERING,
    asOf: ASOF,
    enrollments: [enrollment({ id: "enr_a", studentId: "s1" })],
    horseAssignments: [
      assignment({ id: "tha_a", studentId: "s1", assignedHorseName: "SECRET_HORSE_NAME" }),
      assignment({ id: "tha_b", studentId: "s_orphan" }), // zero-enrollment anomaly
    ],
  });
  const summary = formatHorseEnrollmentPlanSummary(plan);
  const anomalyLines = formatHorseEnrollmentAnomalies(plan).join("\n");
  const blob = `${summary}\n${anomalyLines}`;
  assert.equal(blob.includes("SECRET_HORSE_NAME"), false);
  assert.equal(blob.includes("password"), false);
  assert.equal(blob.includes("DATABASE_URL"), false);
  // It DOES surface safe ids for diagnosis.
  assert.ok(anomalyLines.includes("s_orphan"));
  assert.ok(anomalyLines.includes("tha_b"));
});

test("apply refused when any anomaly exists (canApply gate)", () => {
  const { enrollments, horseAssignments } = happyInputs(3);
  // Inject one orphan history row -> a single anomaly must flip canApply off.
  const plan = buildHorseEnrollmentPlan({
    currentOfferingId: OFFERING,
    asOf: ASOF,
    enrollments,
    horseAssignments: [...horseAssignments, assignment({ id: "tha_x", studentId: "ghost" })],
  });
  assert.equal(plan.summary.anomalyTotal, 1);
  assert.equal(plan.canApply, false);
});

test("second-run idempotency: rebuilding after a correct apply yields 0 updates", () => {
  // Simulate the post-apply state: every FK set to its enrollment, every cache
  // populated from the current interval.
  const enrollments: EnrollmentInput[] = [
    enrollment({ id: "enr_a", studentId: "s1", assignedHorseName: "Bella" }),
    enrollment({
      id: "enr_b",
      studentId: "s2",
      hasPrivateHorse: true,
      privateHorseName: "Shadow",
    }),
  ];
  const horseAssignments: HorseAssignmentInput[] = [
    assignment({ id: "tha_a", studentId: "s1", courseEnrollmentId: "enr_a", assignedHorseName: "Bella" }),
    assignment({
      id: "tha_b",
      studentId: "s2",
      courseEnrollmentId: "enr_b",
      hasPrivateHorse: true,
      privateHorseName: "Shadow",
    }),
  ];
  const plan = buildHorseEnrollmentPlan({
    currentOfferingId: OFFERING,
    asOf: ASOF,
    enrollments,
    horseAssignments,
  });
  assert.equal(plan.canApply, true);
  assert.equal(plan.summary.linkUpdatesRequired, 0);
  assert.equal(plan.summary.cacheUpdatesRequired, 0);
  assert.equal(plan.summary.alreadyCorrectLinks, 2);
  assert.equal(plan.summary.alreadyCorrectCaches, 2);
});

test("only allowed target fields are present on a planned row (no source mutation fields)", () => {
  const plan = buildHorseEnrollmentPlan({
    currentOfferingId: OFFERING,
    asOf: ASOF,
    enrollments: [enrollment({ id: "enr_a", studentId: "s1" })],
    horseAssignments: [assignment({ id: "tha_a", studentId: "s1", assignedHorseName: "Bella" })],
  });
  const row = plan.rows[0];
  // The plan never carries effectiveFrom/effectiveTo/studentId-write or a
  // Student write target - only the FK link + the three cache fields.
  assert.deepEqual(Object.keys(row).sort(), [
    "alreadyLinkedCorrectly",
    "cacheAlreadyMatches",
    "cacheNeedsUpdate",
    "courseEnrollmentId",
    "isCacheSource",
    "linkNeedsUpdate",
    "studentId",
    "targetAssignedHorseName",
    "targetHasPrivateHorse",
    "targetPrivateHorseName",
    "traineeHorseAssignmentId",
  ]);
});
