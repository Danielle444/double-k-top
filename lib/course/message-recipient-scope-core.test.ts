/**
 * SECURITY / LEVEL 2 SLICE L2-FANOUT-1A - focused tests for the PURE message /
 * task recipient scope core.
 *
 * Two halves, both DB-free:
 *
 *  1. BEHAVIOURAL - resolveScopedMessageRecipients exercised against hand-built
 *     roster fixtures that model the real launch state: a Level 1 offering with
 *     a nested group hierarchy, and a Level 2 offering that deliberately reuses
 *     the SAME display labels with DIFFERENT group ids. This locks: the roster is
 *     the sole authority, group matching is by stable id, SPECIFIC is
 *     all-or-nothing, anomalies fail closed, and output is deterministic.
 *
 *  2. STRUCTURAL - source assertions over the new core file itself. A behavioural
 *     test cannot prove that a module stayed pure, so these pin the import
 *     surface (exactly one type-only import), the absence of any IO / clock /
 *     environment access, and the fact that NOTHING in the repository imports
 *     the core in this slice.
 *
 * Uses the existing `tsx` + node:test approach. Run with:
 *   npx tsx --test lib/course/message-recipient-scope-core.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  MESSAGE_RECIPIENT_AUDIENCES,
  MESSAGE_RECIPIENT_REFUSAL_CODES,
  isMessageRecipientAudience,
  resolveScopedMessageRecipients,
  type EffectiveGroupMembershipEntry,
  type MessageRecipientRefusal,
  type MessageRecipientScopeInput,
  type MessageRecipientScopeResult,
} from "@/lib/course/message-recipient-scope-core";
import type {
  EnrolledTraineeView,
  EnrollmentMembershipAnomaly,
  EnrollmentRosterResult,
} from "@/lib/course/enrollment-view";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * The Level 1 group hierarchy: one top-level group with two subgroups, plus a
 * second top-level group. Ids are stable and opaque; the LABELS are deliberately
 * duplicated by the Level 2 fixture below.
 */
const L1_GROUP_A = "grp-l1-a";
const L1_GROUP_A_SUB1 = "grp-l1-a-sub1";
const L1_GROUP_A_SUB2 = "grp-l1-a-sub2";
const L1_GROUP_B = "grp-l1-b";

/** The Level 2 hierarchy - DIFFERENT ids, IDENTICAL display labels. */
const L2_GROUP_A = "grp-l2-a";

/** A trainee who exists only in the Level 2 roster. */
const OUTSIDE_STUDENT_ID = "student-l2-only";

function makeRow(
  id: string,
  groupName: string | null,
  subgroupNumber: number | null,
  lastName: string,
): EnrolledTraineeView {
  return {
    id,
    // PII-shaped fields are present because the roster type carries them; the
    // core must never place any of them on a result.
    fullName: `שם מלא ${id}`,
    lastName,
    phone: "050-0000000",
    groupName,
    subgroupNumber,
    enrollmentStatus: "ACTIVE",
    isPrimary: true,
  };
}

function membership(
  studentId: string,
  courseGroupId: string,
  parentGroupId: string | null,
): EffectiveGroupMembershipEntry {
  return { studentId, courseGroupId, parentGroupId };
}

function roster(
  rows: EnrolledTraineeView[],
  anomalies: EnrollmentMembershipAnomaly[] = [],
): EnrollmentRosterResult {
  return { rows, anomalies };
}

/**
 * The Level 1 regression fixture - the shape the CURRENT global fan-out is
 * expected to reproduce exactly:
 *   s1, s2 -> group א subgroup 1
 *   s3     -> group א subgroup 2
 *   s4     -> group א directly (top level, no subgroup)
 *   s5, s6 -> group ב
 */
const L1_ROWS: EnrolledTraineeView[] = [
  makeRow("student-1", "א", 1, "אבן"),
  makeRow("student-2", "א", 1, "בר"),
  makeRow("student-3", "א", 2, "גל"),
  makeRow("student-4", "א", null, "דגן"),
  makeRow("student-5", "ב", null, "הר"),
  makeRow("student-6", "ב", null, "ורד"),
];

const L1_MEMBERSHIPS: EffectiveGroupMembershipEntry[] = [
  membership("student-1", L1_GROUP_A_SUB1, L1_GROUP_A),
  membership("student-2", L1_GROUP_A_SUB1, L1_GROUP_A),
  membership("student-3", L1_GROUP_A_SUB2, L1_GROUP_A),
  membership("student-4", L1_GROUP_A, null),
  membership("student-5", L1_GROUP_B, null),
  membership("student-6", L1_GROUP_B, null),
];

const L1_ALL_IDS = [
  "student-1",
  "student-2",
  "student-3",
  "student-4",
  "student-5",
  "student-6",
];

/** The Level 2 roster: one trainee, group labelled "א" but a DIFFERENT group id. */
const L2_ROWS: EnrolledTraineeView[] = [makeRow(OUTSIDE_STUDENT_ID, "א", null, "זהר")];
const L2_MEMBERSHIPS: EffectiveGroupMembershipEntry[] = [
  membership(OUTSIDE_STUDENT_ID, L2_GROUP_A, null),
];

function level1(
  overrides: Partial<MessageRecipientScopeInput> = {},
): MessageRecipientScopeInput {
  return {
    roster: roster(L1_ROWS),
    effectiveGroupMemberships: L1_MEMBERSHIPS,
    audience: "ALL",
    ...overrides,
  };
}

function level2(
  overrides: Partial<MessageRecipientScopeInput> = {},
): MessageRecipientScopeInput {
  return {
    roster: roster(L2_ROWS),
    effectiveGroupMemberships: L2_MEMBERSHIPS,
    audience: "ALL",
    ...overrides,
  };
}

/** Assert a refusal and return it, so the code can be inspected. */
function expectRefusal(result: MessageRecipientScopeResult): MessageRecipientRefusal {
  assert.equal(result.ok, false, "expected a refusal, got a successful selection");
  if (result.ok) throw new Error("unreachable");
  return result;
}

/** Assert success and return the ids. */
function expectIds(result: MessageRecipientScopeResult): readonly string[] {
  assert.equal(result.ok, true, "expected a successful selection, got a refusal");
  if (!result.ok) throw new Error("unreachable");
  return result.recipientIds;
}

// ---------------------------------------------------------------------------
// 1. ALL returns exactly the roster ids
// ---------------------------------------------------------------------------

test("ALL returns exactly the roster ids, in roster order", () => {
  const ids = expectIds(resolveScopedMessageRecipients(level1({ audience: "ALL" })));
  assert.deepEqual(ids, L1_ALL_IDS);
});

// ---------------------------------------------------------------------------
// 2. ALL excludes an outside-course trainee
// ---------------------------------------------------------------------------

test("ALL can never reach a trainee outside the supplied roster", () => {
  const ids = expectIds(resolveScopedMessageRecipients(level1({ audience: "ALL" })));
  assert.equal(ids.includes(OUTSIDE_STUDENT_ID), false);

  // And the mirror case: the Level 2 roster reaches only its own trainee.
  const l2Ids = expectIds(resolveScopedMessageRecipients(level2({ audience: "ALL" })));
  assert.deepEqual(l2Ids, [OUTSIDE_STUDENT_ID]);
  for (const id of L1_ALL_IDS) {
    assert.equal(l2Ids.includes(id), false);
  }
});

// ---------------------------------------------------------------------------
// 3. GROUP matches effective membership by stable id
// ---------------------------------------------------------------------------

test("GROUP by top-level id reaches direct members AND subgroup members", () => {
  const ids = expectIds(
    resolveScopedMessageRecipients(level1({ audience: "GROUP", requestedGroupId: L1_GROUP_A })),
  );
  assert.deepEqual(ids, ["student-1", "student-2", "student-3", "student-4"]);
});

test("GROUP by subgroup id reaches only that subgroup", () => {
  const ids = expectIds(
    resolveScopedMessageRecipients(
      level1({ audience: "GROUP", requestedGroupId: L1_GROUP_A_SUB1 }),
    ),
  );
  assert.deepEqual(ids, ["student-1", "student-2"]);
});

test("GROUP by the other top-level id reaches only that group", () => {
  const ids = expectIds(
    resolveScopedMessageRecipients(level1({ audience: "GROUP", requestedGroupId: L1_GROUP_B })),
  );
  assert.deepEqual(ids, ["student-5", "student-6"]);
});

// ---------------------------------------------------------------------------
// 4. A duplicated display label in another offering is irrelevant
// ---------------------------------------------------------------------------

test("an identical group LABEL in another offering never matches", () => {
  // Both fixtures label their group "א"; only the ids differ.
  assert.equal(L1_ROWS[0].groupName, L2_ROWS[0].groupName);

  // The Level 1 group id resolves nothing against the Level 2 roster...
  const crossRefusal = expectRefusal(
    resolveScopedMessageRecipients(level2({ audience: "GROUP", requestedGroupId: L1_GROUP_A })),
  );
  assert.equal(crossRefusal.reason, "GROUP_HAS_NO_ELIGIBLE_TRAINEES");

  // ...and the Level 2 group id resolves nothing against the Level 1 roster.
  const reverseRefusal = expectRefusal(
    resolveScopedMessageRecipients(level1({ audience: "GROUP", requestedGroupId: L2_GROUP_A })),
  );
  assert.equal(reverseRefusal.reason, "GROUP_HAS_NO_ELIGIBLE_TRAINEES");

  // The correct id still works within its own offering.
  const ids = expectIds(
    resolveScopedMessageRecipients(level2({ audience: "GROUP", requestedGroupId: L2_GROUP_A })),
  );
  assert.deepEqual(ids, [OUTSIDE_STUDENT_ID]);
});

test("the display label is never accepted as a group identifier", () => {
  for (const label of ["א", "ב"]) {
    const refusal = expectRefusal(
      resolveScopedMessageRecipients(level1({ audience: "GROUP", requestedGroupId: label })),
    );
    assert.equal(refusal.reason, "GROUP_HAS_NO_ELIGIBLE_TRAINEES");
  }
});

// ---------------------------------------------------------------------------
// 5 + 6. GROUP refusals
// ---------------------------------------------------------------------------

test("GROUP without a group id refuses", () => {
  for (const requestedGroupId of [undefined, null, ""]) {
    const refusal = expectRefusal(
      resolveScopedMessageRecipients(level1({ audience: "GROUP", requestedGroupId })),
    );
    assert.equal(refusal.reason, "GROUP_ID_MISSING");
  }
});

test("GROUP with no matching trainee refuses", () => {
  const refusal = expectRefusal(
    resolveScopedMessageRecipients(
      level1({ audience: "GROUP", requestedGroupId: "grp-that-does-not-exist" }),
    ),
  );
  assert.equal(refusal.reason, "GROUP_HAS_NO_ELIGIBLE_TRAINEES");
});

// ---------------------------------------------------------------------------
// 7-10. SPECIFIC
// ---------------------------------------------------------------------------

test("SPECIFIC with a valid subset succeeds", () => {
  const ids = expectIds(
    resolveScopedMessageRecipients(
      level1({ audience: "SPECIFIC", requestedStudentIds: ["student-3", "student-5"] }),
    ),
  );
  assert.deepEqual(ids, ["student-3", "student-5"]);
});

test("SPECIFIC refuses the WHOLE request when one id is outside the roster", () => {
  const refusal = expectRefusal(
    resolveScopedMessageRecipients(
      level1({
        audience: "SPECIFIC",
        requestedStudentIds: ["student-1", OUTSIDE_STUDENT_ID, "student-2"],
      }),
    ),
  );
  assert.equal(refusal.reason, "SPECIFIC_IDS_OUTSIDE_ROSTER");
  assert.equal(refusal.requestedCount, 3);
  assert.equal(refusal.outsideRosterCount, 1);
  // The in-roster part is NOT quietly sent.
  assert.equal("recipientIds" in refusal, false);
});

test("SPECIFIC deduplicates repeated ids", () => {
  const ids = expectIds(
    resolveScopedMessageRecipients(
      level1({
        audience: "SPECIFIC",
        requestedStudentIds: ["student-2", "student-2", "student-2", "student-4"],
      }),
    ),
  );
  assert.deepEqual(ids, ["student-2", "student-4"]);
});

test("SPECIFIC with no ids refuses", () => {
  for (const requestedStudentIds of [undefined, null, []]) {
    const refusal = expectRefusal(
      resolveScopedMessageRecipients(level1({ audience: "SPECIFIC", requestedStudentIds })),
    );
    assert.equal(refusal.reason, "SPECIFIC_IDS_MISSING");
  }
});

test("SPECIFIC with a blank id refuses", () => {
  const refusal = expectRefusal(
    resolveScopedMessageRecipients(
      level1({ audience: "SPECIFIC", requestedStudentIds: ["student-1", ""] }),
    ),
  );
  assert.equal(refusal.reason, "SPECIFIC_ID_MALFORMED");
});

// ---------------------------------------------------------------------------
// 11 + 12. Duplicate / dual-enrolled roster rows collapse to one recipient
// ---------------------------------------------------------------------------

test("a duplicated roster row yields one recipient", () => {
  const rows = [...L1_ROWS, makeRow("student-1", "א", 1, "אבן")];
  const ids = expectIds(
    resolveScopedMessageRecipients(
      level1({ roster: roster(rows), effectiveGroupMemberships: L1_MEMBERSHIPS }),
    ),
  );
  assert.deepEqual(ids, L1_ALL_IDS);
  assert.equal(ids.filter((id) => id === "student-1").length, 1);
});

test("a dual-enrolled trainee surfaced twice in one offering roster counts once", () => {
  // The same person, reached through two enrollment rows, with an identical
  // repeated membership entry - exactly what a dual-enrolled trainee produces.
  const rows = [...L1_ROWS, makeRow("student-4", "א", null, "דגן")];
  const memberships = [...L1_MEMBERSHIPS, membership("student-4", L1_GROUP_A, null)];
  const ids = expectIds(
    resolveScopedMessageRecipients(
      level1({ roster: roster(rows), effectiveGroupMemberships: memberships }),
    ),
  );
  assert.deepEqual(ids, L1_ALL_IDS);

  // ...and the same holds for a GROUP send.
  const groupIds = expectIds(
    resolveScopedMessageRecipients(
      level1({
        roster: roster(rows),
        effectiveGroupMemberships: memberships,
        audience: "GROUP",
        requestedGroupId: L1_GROUP_A,
      }),
    ),
  );
  assert.deepEqual(groupIds, ["student-1", "student-2", "student-3", "student-4"]);
});

// ---------------------------------------------------------------------------
// 13. Anomalies fail closed
// ---------------------------------------------------------------------------

const ANOMALY_KINDS = [
  "NO_CURRENT_MEMBERSHIP",
  "MULTIPLE_CURRENT_MEMBERSHIPS",
  "MALFORMED_SUBGROUP",
  "MISSING_PARENT_GROUP",
] as const;

for (const kind of ANOMALY_KINDS) {
  for (const audience of MESSAGE_RECIPIENT_AUDIENCES) {
    test(`${audience}: a ${kind} anomaly refuses the whole send`, () => {
      const anomaly: EnrollmentMembershipAnomaly = {
        enrollmentId: "enrollment-x",
        studentId: "student-x",
        kind,
        currentMembershipCount: kind === "MULTIPLE_CURRENT_MEMBERSHIPS" ? 2 : 0,
      };
      const refusal = expectRefusal(
        resolveScopedMessageRecipients(
          level1({
            roster: roster(L1_ROWS, [anomaly]),
            audience,
            requestedGroupId: L1_GROUP_A,
            requestedStudentIds: ["student-1"],
          }),
        ),
      );
      assert.equal(refusal.reason, "ROSTER_HAS_ANOMALIES");
      assert.equal(refusal.anomalyCount, 1);
      assert.deepEqual(refusal.anomalyKinds, [kind]);
    });
  }
}

test("an anomaly refuses even though every other roster row is valid", () => {
  const refusal = expectRefusal(
    resolveScopedMessageRecipients(
      level1({
        roster: roster(L1_ROWS, [
          {
            enrollmentId: "enrollment-y",
            studentId: "student-y",
            kind: "NO_CURRENT_MEMBERSHIP",
            currentMembershipCount: 0,
          },
        ]),
      }),
    ),
  );
  assert.equal(refusal.reason, "ROSTER_HAS_ANOMALIES");
  // Never a partial send.
  assert.equal("recipientIds" in refusal, false);
});

// ---------------------------------------------------------------------------
// 14. Empty roster
// ---------------------------------------------------------------------------

test("an empty roster refuses for every audience", () => {
  for (const audience of MESSAGE_RECIPIENT_AUDIENCES) {
    const refusal = expectRefusal(
      resolveScopedMessageRecipients({
        roster: roster([]),
        effectiveGroupMemberships: [],
        audience,
        requestedGroupId: L1_GROUP_A,
        requestedStudentIds: ["student-1"],
      }),
    );
    assert.equal(refusal.reason, "ROSTER_EMPTY");
  }
});

// ---------------------------------------------------------------------------
// Membership-index integrity (the two inputs can never disagree silently)
// ---------------------------------------------------------------------------

/** The four ways the supplied membership data can be untrustworthy. */
const BROKEN_MEMBERSHIP_CASES: [string, EffectiveGroupMembershipEntry[], string][] = [
  ["a roster trainee with no supplied membership", L1_MEMBERSHIPS.slice(0, 5), "GROUP_MEMBERSHIP_MISSING"],
  [
    "a supplied membership for a trainee outside the roster",
    [...L1_MEMBERSHIPS, membership(OUTSIDE_STUDENT_ID, L2_GROUP_A, null)],
    "GROUP_MEMBERSHIP_OUTSIDE_ROSTER",
  ],
  [
    "two conflicting memberships for one trainee",
    [...L1_MEMBERSHIPS, membership("student-1", L1_GROUP_B, null)],
    "GROUP_MEMBERSHIP_CONFLICT",
  ],
  [
    "a blank membership id",
    [...L1_MEMBERSHIPS.slice(1), membership("student-1", "", null)],
    "GROUP_MEMBERSHIP_MALFORMED",
  ],
];

for (const [label, memberships, expectedReason] of BROKEN_MEMBERSHIP_CASES) {
  test(`GROUP: ${label} refuses`, () => {
    const refusal = expectRefusal(
      resolveScopedMessageRecipients(
        level1({
          audience: "GROUP",
          requestedGroupId: L1_GROUP_A,
          effectiveGroupMemberships: memberships,
        }),
      ),
    );
    assert.equal(refusal.reason, expectedReason);
  });
}

test("a blank roster trainee id refuses", () => {
  const refusal = expectRefusal(
    resolveScopedMessageRecipients(
      level1({ roster: roster([...L1_ROWS, makeRow("", "א", null, "חן")]) }),
    ),
  );
  assert.equal(refusal.reason, "ROSTER_ROW_MISSING_TRAINEE_ID");
});

// ---------------------------------------------------------------------------
// Membership data is required ONLY by GROUP
// ---------------------------------------------------------------------------

/** The three ways a caller can decline to supply membership data. */
const ABSENT_MEMBERSHIP_INPUTS = [undefined, null] as const;

test("ALL succeeds with no membership array at all", () => {
  // The property omitted entirely...
  const omitted = expectIds(
    resolveScopedMessageRecipients({ roster: roster(L1_ROWS), audience: "ALL" }),
  );
  assert.deepEqual(omitted, L1_ALL_IDS);

  // ...and explicitly absent.
  for (const effectiveGroupMemberships of ABSENT_MEMBERSHIP_INPUTS) {
    const ids = expectIds(
      resolveScopedMessageRecipients(level1({ audience: "ALL", effectiveGroupMemberships })),
    );
    assert.deepEqual(ids, L1_ALL_IDS);
  }
});

test("SPECIFIC succeeds with no membership array at all", () => {
  const omitted = expectIds(
    resolveScopedMessageRecipients({
      roster: roster(L1_ROWS),
      audience: "SPECIFIC",
      requestedStudentIds: ["student-3", "student-1"],
    }),
  );
  assert.deepEqual(omitted, ["student-1", "student-3"]);

  for (const effectiveGroupMemberships of ABSENT_MEMBERSHIP_INPUTS) {
    const ids = expectIds(
      resolveScopedMessageRecipients(
        level1({
          audience: "SPECIFIC",
          effectiveGroupMemberships,
          requestedStudentIds: ["student-6"],
        }),
      ),
    );
    assert.deepEqual(ids, ["student-6"]);
  }
});

test("SPECIFIC keeps its all-or-nothing refusal with no membership array", () => {
  const refusal = expectRefusal(
    resolveScopedMessageRecipients({
      roster: roster(L1_ROWS),
      audience: "SPECIFIC",
      requestedStudentIds: ["student-1", OUTSIDE_STUDENT_ID],
    }),
  );
  assert.equal(refusal.reason, "SPECIFIC_IDS_OUTSIDE_ROSTER");
  assert.equal(refusal.outsideRosterCount, 1);
});

test("GROUP without membership data refuses", () => {
  for (const effectiveGroupMemberships of ABSENT_MEMBERSHIP_INPUTS) {
    const refusal = expectRefusal(
      resolveScopedMessageRecipients(
        level1({
          audience: "GROUP",
          requestedGroupId: L1_GROUP_A,
          effectiveGroupMemberships,
        }),
      ),
    );
    assert.equal(refusal.reason, "GROUP_MEMBERSHIP_DATA_MISSING");
  }

  // The property omitted entirely behaves identically.
  const omitted = expectRefusal(
    resolveScopedMessageRecipients({
      roster: roster(L1_ROWS),
      audience: "GROUP",
      requestedGroupId: L1_GROUP_A,
    }),
  );
  assert.equal(omitted.reason, "GROUP_MEMBERSHIP_DATA_MISSING");

  // An EMPTY array is supplied-but-incomplete, not absent: it is the
  // "roster trainee has no membership" case.
  const empty = expectRefusal(
    resolveScopedMessageRecipients(
      level1({
        audience: "GROUP",
        requestedGroupId: L1_GROUP_A,
        effectiveGroupMemberships: [],
      }),
    ),
  );
  assert.equal(empty.reason, "GROUP_MEMBERSHIP_MISSING");
});

test("broken membership data never affects ALL or SPECIFIC", () => {
  for (const [label, memberships] of BROKEN_MEMBERSHIP_CASES) {
    const allIds = expectIds(
      resolveScopedMessageRecipients(
        level1({ audience: "ALL", effectiveGroupMemberships: memberships }),
      ),
    );
    assert.deepEqual(allIds, L1_ALL_IDS, `ALL was affected by ${label}`);

    const specificIds = expectIds(
      resolveScopedMessageRecipients(
        level1({
          audience: "SPECIFIC",
          effectiveGroupMemberships: memberships,
          requestedStudentIds: ["student-2", "student-5"],
        }),
      ),
    );
    assert.deepEqual(specificIds, ["student-2", "student-5"], `SPECIFIC was affected by ${label}`);
  }
});

test("a roster anomaly still refuses every audience with no membership array", () => {
  const anomalous = roster(L1_ROWS, [
    {
      enrollmentId: "enrollment-z",
      studentId: "student-z",
      kind: "MULTIPLE_CURRENT_MEMBERSHIPS",
      currentMembershipCount: 2,
    },
  ]);
  for (const audience of MESSAGE_RECIPIENT_AUDIENCES) {
    const refusal = expectRefusal(
      resolveScopedMessageRecipients({
        roster: anomalous,
        audience,
        requestedGroupId: L1_GROUP_A,
        requestedStudentIds: ["student-1"],
      }),
    );
    assert.equal(refusal.reason, "ROSTER_HAS_ANOMALIES");
  }
});

// ---------------------------------------------------------------------------
// 15. Determinism
// ---------------------------------------------------------------------------

test("identical input produces identical output", () => {
  for (const input of [
    level1({ audience: "ALL" }),
    level1({ audience: "GROUP", requestedGroupId: L1_GROUP_A }),
    level1({ audience: "SPECIFIC", requestedStudentIds: ["student-5", "student-1"] }),
  ]) {
    const first = resolveScopedMessageRecipients(input);
    const second = resolveScopedMessageRecipients(input);
    assert.deepEqual(first, second);
  }
});

test("SPECIFIC output follows ROSTER order, not the caller's order", () => {
  const forward = expectIds(
    resolveScopedMessageRecipients(
      level1({
        audience: "SPECIFIC",
        requestedStudentIds: ["student-1", "student-3", "student-6"],
      }),
    ),
  );
  const shuffled = expectIds(
    resolveScopedMessageRecipients(
      level1({
        audience: "SPECIFIC",
        requestedStudentIds: ["student-6", "student-1", "student-3"],
      }),
    ),
  );
  assert.deepEqual(forward, ["student-1", "student-3", "student-6"]);
  assert.deepEqual(shuffled, forward);
});

// ---------------------------------------------------------------------------
// 16. Level 1 regression
// ---------------------------------------------------------------------------

test("Level 1 regression: ALL reproduces the full active roster", () => {
  const ids = expectIds(resolveScopedMessageRecipients(level1({ audience: "ALL" })));
  assert.equal(ids.length, L1_ROWS.length);
  assert.deepEqual(ids, L1_ALL_IDS);
});

test("Level 1 regression: GROUP reproduces the label-based recipient set", () => {
  // What the pre-existing fan-out selected with `groupName === 'א'` - i.e. both
  // subgroup members and the directly-attached trainee - must still be selected,
  // now via the stable top-level group id.
  const expectedForLabelA = L1_ROWS.filter((row) => row.groupName === "א").map((row) => row.id);
  const ids = expectIds(
    resolveScopedMessageRecipients(level1({ audience: "GROUP", requestedGroupId: L1_GROUP_A })),
  );
  assert.deepEqual(ids, expectedForLabelA);

  const expectedForLabelB = L1_ROWS.filter((row) => row.groupName === "ב").map((row) => row.id);
  const idsB = expectIds(
    resolveScopedMessageRecipients(level1({ audience: "GROUP", requestedGroupId: L1_GROUP_B })),
  );
  assert.deepEqual(idsB, expectedForLabelB);
});

// ---------------------------------------------------------------------------
// Contract shape
// ---------------------------------------------------------------------------

test("the audience tuple is exactly the three persisted audiences", () => {
  assert.deepEqual([...MESSAGE_RECIPIENT_AUDIENCES], ["ALL", "GROUP", "SPECIFIC"]);
  assert.equal(isMessageRecipientAudience("ALL"), true);
  assert.equal(isMessageRecipientAudience("EVERYONE"), false);
  assert.equal(isMessageRecipientAudience(""), false);
});

test("an unknown audience refuses", () => {
  const refusal = expectRefusal(
    resolveScopedMessageRecipients(
      level1({ audience: "EVERYONE" as unknown as MessageRecipientScopeInput["audience"] }),
    ),
  );
  assert.equal(refusal.reason, "UNKNOWN_AUDIENCE");
});

test("every refusal code is declared, and no refusal carries personal data", () => {
  const declared = new Set<string>(MESSAGE_RECIPIENT_REFUSAL_CODES);
  const refusals: MessageRecipientRefusal[] = [
    expectRefusal(resolveScopedMessageRecipients(level1({ audience: "GROUP" }))),
    expectRefusal(
      resolveScopedMessageRecipients(level1({ audience: "SPECIFIC", requestedStudentIds: [] })),
    ),
    expectRefusal(
      resolveScopedMessageRecipients(
        level1({ audience: "SPECIFIC", requestedStudentIds: [OUTSIDE_STUDENT_ID] }),
      ),
    ),
    expectRefusal(
      resolveScopedMessageRecipients(
        level1({
          roster: roster(L1_ROWS, [
            {
              enrollmentId: "e",
              studentId: "s",
              kind: "NO_CURRENT_MEMBERSHIP",
              currentMembershipCount: 0,
            },
          ]),
        }),
      ),
    ),
  ];

  const forbiddenKeys = [
    "fullName",
    "lastName",
    "phone",
    "identityNumber",
    "studentId",
    "studentIds",
    "recipientIds",
    "enrollmentId",
    "names",
  ];
  for (const refusal of refusals) {
    assert.equal(declared.has(refusal.reason), true, `undeclared code: ${refusal.reason}`);
    const serialized = JSON.stringify(refusal);
    for (const key of forbiddenKeys) {
      assert.equal(serialized.includes(key), false, `${refusal.reason} exposed ${key}`);
    }
    for (const row of L1_ROWS) {
      assert.equal(serialized.includes(row.fullName), false);
      assert.equal(serialized.includes(row.lastName), false);
    }
  }
});

// ---------------------------------------------------------------------------
// STRUCTURAL - purity of the core file, and the unwired invariant
// ---------------------------------------------------------------------------

const CORE_RELATIVE_PATH = "./message-recipient-scope-core.ts";
const CORE_MODULE_BASENAME = "message-recipient-scope-core";

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

/** Every module specifier the file imports from. */
function importSpecifiers(source: string): string[] {
  return [...source.matchAll(/\bfrom\s+"([^"]+)"/g)].map((match) => match[1]);
}

test("the core imports exactly one module, type-only", () => {
  const source = readSource(CORE_RELATIVE_PATH);
  assert.deepEqual(importSpecifiers(source), ["./enrollment-view"]);

  const importStatements = [...source.matchAll(/^import[\s\S]*?;$/gm)].map((m) => m[0]);
  assert.equal(importStatements.length, 1);
  assert.equal(importStatements[0].startsWith("import type {"), true);
});

test("the core performs no IO, no clock, no randomness, no environment access", () => {
  const source = readSource(CORE_RELATIVE_PATH);
  const forbidden: [string, RegExp][] = [
    ["a server-action directive", /"use server"/],
    ["a database client", /\bprisma\b/i],
    ["request headers", /next\/headers/],
    ["an auth or session module", /@\/lib\/auth\//],
    ["the message actions", /@\/lib\/actions\/messages/],
    ["the push actions", /@\/lib\/actions\/push/],
    ["the notification actions", /@\/lib\/actions\/notifications/],
    ["a capability reader", /offering-capabilities/],
    ["the clock", /new Date\(|Date\.now\(/],
    ["randomness", /Math\.random\(/],
    ["environment access", /process\.env/],
    ["logging", /console\./],
  ];
  for (const [label, pattern] of forbidden) {
    assert.equal(pattern.test(source), false, `core must not reference ${label}`);
  }
});

test("nothing in the repository imports the core in this slice", () => {
  const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
  const skippedDirs = new Set(["node_modules", ".next", ".git", "generated"]);
  const importers: string[] = [];

  function walk(dir: string, relative: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (skippedDirs.has(entry.name)) continue;
        walk(`${dir}/${entry.name}`, `${relative}${entry.name}/`);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      if (entry.name.startsWith(CORE_MODULE_BASENAME)) continue; // the two new files
      const source = readFileSync(`${dir}/${entry.name}`, "utf8");
      if (source.includes(CORE_MODULE_BASENAME)) {
        importers.push(`${relative}${entry.name}`);
      }
    }
  }

  for (const top of ["lib", "app", "scripts"]) {
    try {
      walk(`${repoRoot}${top}`, `${top}/`);
    } catch {
      // A top-level directory that does not exist is not a failure.
    }
  }

  assert.deepEqual(importers, [], `core must stay unwired, but is referenced by: ${importers}`);
});
