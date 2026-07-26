/**
 * MSG1A - focused tests for the pure audience input / normalization / validation
 * / preview core. DB-free: every fact is hand-built, so the whole contract runs
 * without Prisma.
 *
 * Run with:
 *   npx tsx --test lib/course/message-audience-input-core.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

import type {
  EnrolledTraineeView,
  EnrollmentMembershipAnomaly,
  EnrollmentRosterResult,
} from "@/lib/course/enrollment-view";
import type { EffectiveGroupMembershipEntry } from "@/lib/course/message-recipient-scope-core";
import {
  normalizeMessageAudienceSegments,
  resolveMessageAudiencePreview,
  previewMessageAudienceWithDeps,
  extractReferencedOfferingIds,
  type CoreOfferingFacts,
  type MessageAudienceFacts,
  type MessageAudienceRefusal,
} from "@/lib/course/message-audience-input-core";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRow(id: string, fullName: string): EnrolledTraineeView {
  return {
    id,
    fullName,
    lastName: fullName,
    phone: null,
    groupName: null,
    subgroupNumber: null,
    enrollmentStatus: "ACTIVE",
    isPrimary: true,
  };
}

function roster(
  rows: EnrolledTraineeView[],
  anomalies: EnrollmentMembershipAnomaly[] = [],
): EnrollmentRosterResult {
  return { rows, anomalies };
}

function membership(
  studentId: string,
  courseGroupId: string,
  parentGroupId: string | null,
): EffectiveGroupMembershipEntry {
  return { studentId, courseGroupId, parentGroupId };
}

// Offering L1: students S1 (subgroup G1a under G1), S2 (top-level G1), S3 (G2).
const OFF_L1 = "off-l1";
const OFF_L2 = "off-l2";

function offeringL1(overrides: Partial<CoreOfferingFacts> = {}): CoreOfferingFacts {
  return {
    courseOfferingId: OFF_L1,
    offeringName: "רמה 1",
    roster: roster([makeRow("S1", "דנה"), makeRow("S2", "רון"), makeRow("S3", "מאיה")]),
    effectiveGroupMemberships: [
      membership("S1", "G1a", "G1"),
      membership("S2", "G1", null),
      membership("S3", "G2", null),
    ],
    groupLabelsById: new Map([
      ["G1", "קבוצה א"],
      ["G1a", "קבוצה א · 1"],
      ["G2", "קבוצה ב"],
    ]),
    groupTreeHasAnomalies: false,
    ...overrides,
  };
}

// Offering L2: S1 is DUAL (also in L1), plus S4.
function offeringL2(overrides: Partial<CoreOfferingFacts> = {}): CoreOfferingFacts {
  return {
    courseOfferingId: OFF_L2,
    offeringName: "רמה 2",
    roster: roster([makeRow("S1", "דנה"), makeRow("S4", "יעל")]),
    effectiveGroupMemberships: [membership("S1", "H1", null), membership("S4", "H1", null)],
    groupLabelsById: new Map([["H1", "קבוצה 2א"]]),
    groupTreeHasAnomalies: false,
    ...overrides,
  };
}

function facts(...offerings: CoreOfferingFacts[]): MessageAudienceFacts {
  return { offeringsById: new Map(offerings.map((o) => [o.courseOfferingId, o])) };
}

function anomaly(studentId: string): EnrollmentMembershipAnomaly {
  return { enrollmentId: `enr-${studentId}`, studentId, kind: "NO_CURRENT_MEMBERSHIP", currentMembershipCount: 0 };
}

function expectRefusal(result: { ok: boolean }): MessageAudienceRefusal {
  assert.equal(result.ok, false);
  return result as MessageAudienceRefusal;
}

// ---------------------------------------------------------------------------
// Validation refusals
// ---------------------------------------------------------------------------

test("empty audience is rejected", () => {
  assert.equal(expectRefusal(normalizeMessageAudienceSegments([], facts(offeringL1()))).code, "NO_SEGMENTS");
  assert.equal(expectRefusal(normalizeMessageAudienceSegments(null, facts(offeringL1()))).code, "NO_SEGMENTS");
});

test("an inactive or capability-disabled offering (absent from facts) is rejected", () => {
  // Both "not ACTIVE" and "MESSAGES not ENABLED" surface identically as the
  // offering being absent from the authoritative facts.
  const result = normalizeMessageAudienceSegments(
    [{ kind: "COURSE", courseOfferingId: "off-not-eligible" }],
    facts(offeringL1()),
  );
  assert.equal(expectRefusal(result).code, "OFFERING_NOT_ELIGIBLE");
});

test("a group that does not belong to the offering is rejected", () => {
  const result = normalizeMessageAudienceSegments(
    [{ kind: "GROUP", courseOfferingId: OFF_L1, courseGroupId: "H1" }], // H1 belongs to L2
    facts(offeringL1()),
  );
  assert.equal(expectRefusal(result).code, "GROUP_NOT_IN_OFFERING");
});

test("a trainee not actively enrolled in the offering is rejected", () => {
  const result = normalizeMessageAudienceSegments(
    [{ kind: "TRAINEE", courseOfferingId: OFF_L1, studentId: "S4" }], // S4 is L2 only
    facts(offeringL1()),
  );
  assert.equal(expectRefusal(result).code, "TRAINEE_NOT_IN_OFFERING");
});

test("a blank server-derived label is rejected", () => {
  const result = normalizeMessageAudienceSegments(
    [{ kind: "COURSE", courseOfferingId: OFF_L1 }],
    facts(offeringL1({ offeringName: "   " })),
  );
  assert.equal(expectRefusal(result).code, "EMPTY_LABEL");
});

test("roster anomalies fail closed for ANY kind referencing the offering", () => {
  const anomalous = offeringL1({ roster: roster([makeRow("S1", "דנה")], [anomaly("S9")]) });
  for (const seg of [
    { kind: "COURSE", courseOfferingId: OFF_L1 },
    { kind: "TRAINEE", courseOfferingId: OFF_L1, studentId: "S1" },
  ] as const) {
    assert.equal(
      expectRefusal(normalizeMessageAudienceSegments([seg], facts(anomalous))).code,
      "ROSTER_HAS_ANOMALIES",
    );
  }
});

test("group-tree anomalies fail closed for a GROUP segment", () => {
  const anomalous = offeringL1({ groupTreeHasAnomalies: true });
  const result = normalizeMessageAudienceSegments(
    [{ kind: "GROUP", courseOfferingId: OFF_L1, courseGroupId: "G1" }],
    facts(anomalous),
  );
  assert.equal(expectRefusal(result).code, "GROUP_HAS_ANOMALIES");
});

test("malformed segments are rejected", () => {
  for (const bad of [
    [{ kind: "COURSE" }],
    [{ kind: "GROUP", courseOfferingId: OFF_L1 }],
    [{ kind: "TRAINEE", courseOfferingId: OFF_L1 }],
    [{ kind: "NONSENSE", courseOfferingId: OFF_L1 }],
    [{ courseOfferingId: OFF_L1 }],
    [null],
  ]) {
    assert.equal(
      expectRefusal(normalizeMessageAudienceSegments(bad as unknown[], facts(offeringL1()))).code,
      "MALFORMED_SEGMENT",
    );
  }
});

// ---------------------------------------------------------------------------
// Normalization - offering context + server-derived labels
// ---------------------------------------------------------------------------

test("labels are server-derived, never client-supplied", () => {
  const result = normalizeMessageAudienceSegments(
    [
      { kind: "COURSE", courseOfferingId: OFF_L1, labelSnapshot: "HACKED" } as unknown,
      { kind: "GROUP", courseOfferingId: OFF_L1, courseGroupId: "G1a" },
      { kind: "TRAINEE", courseOfferingId: OFF_L1, studentId: "S1" },
    ],
    facts(offeringL1()),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    result.segments.map((s) => s.labelSnapshot),
    ["רמה 1", "קבוצה א · 1", "דנה"],
  );
});

test("an EXACT duplicate segment is rejected", () => {
  const result = normalizeMessageAudienceSegments(
    [
      { kind: "TRAINEE", courseOfferingId: OFF_L1, studentId: "S1" },
      { kind: "TRAINEE", courseOfferingId: OFF_L1, studentId: "S1" },
    ],
    facts(offeringL1()),
  );
  assert.equal(expectRefusal(result).code, "DUPLICATE_SEGMENT");
});

test("the SAME trainee in TWO different offerings is preserved as TWO segments", () => {
  // Layer (a): offering context is preserved - S1 (dual) becomes two distinct
  // offering-scoped TRAINEE segments, NOT a duplicate.
  const result = normalizeMessageAudienceSegments(
    [
      { kind: "TRAINEE", courseOfferingId: OFF_L1, studentId: "S1" },
      { kind: "TRAINEE", courseOfferingId: OFF_L2, studentId: "S1" },
    ],
    facts(offeringL1(), offeringL2()),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.segments.length, 2);
  assert.deepEqual(
    result.segments.map((s) => `${s.courseOfferingId}:${s.studentId}`),
    [`${OFF_L1}:S1`, `${OFF_L2}:S1`],
  );
});

// ---------------------------------------------------------------------------
// Preview - recipient resolution + dedup
// ---------------------------------------------------------------------------

test("COURSE resolves to the whole offering roster", () => {
  const result = resolveMessageAudiencePreview([{ kind: "COURSE", courseOfferingId: OFF_L1 }], facts(offeringL1()));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual([...result.recipientIds].sort(), ["S1", "S2", "S3"]);
  assert.equal(result.recipientCount, 3);
});

test("GROUP resolves by STABLE id (top-level reaches its subgroup members)", () => {
  const top = resolveMessageAudiencePreview(
    [{ kind: "GROUP", courseOfferingId: OFF_L1, courseGroupId: "G1" }],
    facts(offeringL1()),
  );
  assert.equal(top.ok, true);
  if (!top.ok) return;
  assert.deepEqual([...top.recipientIds].sort(), ["S1", "S2"]); // S1 via parent, S2 direct

  const sub = resolveMessageAudiencePreview(
    [{ kind: "GROUP", courseOfferingId: OFF_L1, courseGroupId: "G1a" }],
    facts(offeringL1()),
  );
  assert.equal(sub.ok, true);
  if (!sub.ok) return;
  assert.deepEqual(sub.recipientIds, ["S1"]);
});

test("TRAINEE resolves to exactly that trainee", () => {
  const result = resolveMessageAudiencePreview(
    [{ kind: "TRAINEE", courseOfferingId: OFF_L1, studentId: "S2" }],
    facts(offeringL1()),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.recipientIds, ["S2"]);
});

test("overlapping COURSE / GROUP / TRAINEE dedupe to distinct student ids", () => {
  const result = resolveMessageAudiencePreview(
    [
      { kind: "COURSE", courseOfferingId: OFF_L1 }, // S1,S2,S3
      { kind: "GROUP", courseOfferingId: OFF_L1, courseGroupId: "G1" }, // S1,S2
      { kind: "TRAINEE", courseOfferingId: OFF_L1, studentId: "S1" }, // S1
    ],
    facts(offeringL1()),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual([...result.recipientIds].sort(), ["S1", "S2", "S3"]);
  assert.equal(result.recipientCount, 3);
});

test("a dual trainee reached through BOTH offerings appears once in the preview", () => {
  // Layer (a) keeps TWO segments; layer (b) dedupes S1 to ONE recipient.
  const result = resolveMessageAudiencePreview(
    [
      { kind: "TRAINEE", courseOfferingId: OFF_L1, studentId: "S1" },
      { kind: "TRAINEE", courseOfferingId: OFF_L2, studentId: "S1" },
    ],
    facts(offeringL1(), offeringL2()),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.segments.length, 2); // offering context preserved
  assert.deepEqual(result.recipientIds, ["S1"]); // one recipient
  assert.equal(result.recipientCount, 1);
});

test("a preview that resolves to nobody is rejected", () => {
  const empty = offeringL1({ roster: roster([]), effectiveGroupMemberships: [] });
  const result = resolveMessageAudiencePreview([{ kind: "COURSE", courseOfferingId: OFF_L1 }], facts(empty));
  assert.equal(expectRefusal(result).code, "NO_ELIGIBLE_RECIPIENTS");
});

// ---------------------------------------------------------------------------
// Async DI orchestration
// ---------------------------------------------------------------------------

test("extractReferencedOfferingIds returns the distinct offering ids", () => {
  const ids = extractReferencedOfferingIds([
    { kind: "COURSE", courseOfferingId: OFF_L1 },
    { kind: "TRAINEE", courseOfferingId: OFF_L1, studentId: "S1" },
    { kind: "TRAINEE", courseOfferingId: OFF_L2, studentId: "S1" },
  ]);
  assert.deepEqual([...ids].sort(), [OFF_L1, OFF_L2]);
});

test("previewMessageAudienceWithDeps loads facts then runs the pure preview", async () => {
  const loadFacts = async (offeringIds: readonly string[]): Promise<MessageAudienceFacts> => {
    assert.deepEqual([...offeringIds], [OFF_L1]);
    return facts(offeringL1());
  };
  const result = await previewMessageAudienceWithDeps({ loadFacts }, [
    { kind: "COURSE", courseOfferingId: OFF_L1 },
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.recipientCount, 3);
});

test("an unexpected infrastructure error PROPAGATES (never becomes a refusal)", async () => {
  const boom = new Error("db is down");
  const loadFacts = async (): Promise<MessageAudienceFacts> => {
    throw boom;
  };
  await assert.rejects(
    () => previewMessageAudienceWithDeps({ loadFacts }, [{ kind: "COURSE", courseOfferingId: OFF_L1 }]),
    (err) => err === boom,
  );
});
