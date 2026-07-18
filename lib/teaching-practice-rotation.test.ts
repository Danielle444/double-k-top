/**
 * Characterization tests for the pure Teaching Practice rotation math
 * (lib/teaching-practice-rotation.ts). These pin down the CURRENT behavior of
 * computeTeachingPracticeRotation / computePartialTeachingPracticeRotation and
 * the shared constants (TEACHING_PRACTICE_TEAM_SIZE, ROLE_LABELS) - they are
 * not aspirational and encode no desired future behavior.
 *
 * Uses the existing `tsx` runner with Node built-ins `node:test` and
 * `node:assert/strict`. No test framework is installed. Run with:
 *   npx tsx --test lib/teaching-practice-rotation.test.ts
 *
 * Pure: no Prisma, no DB, no Next.js runtime, no clock, plain-data fixtures.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  computeTeachingPracticeRotation,
  computePartialTeachingPracticeRotation,
  TEACHING_PRACTICE_TEAM_SIZE,
  ROLE_LABELS,
  type TeachingPracticeRotationTrainee,
  type TeachingPracticeRoleValue,
} from "./teaching-practice-rotation";

function seat(traineeId: string, rotationOrder: number): TeachingPracticeRotationTrainee {
  return { traineeId, rotationOrder };
}

const LUNGE_TEAM: TeachingPracticeRotationTrainee[] = [seat("a", 0), seat("b", 1)];
const GROUP_TEAM: TeachingPracticeRotationTrainee[] = [seat("a", 0), seat("b", 1), seat("c", 2)];

// 1. team sizes are exactly the current fixed values.
test("TEACHING_PRACTICE_TEAM_SIZE is LUNGE 2, BEGINNER_PRIVATE 2, BEGINNER_GROUP 3", () => {
  assert.equal(TEACHING_PRACTICE_TEAM_SIZE.LUNGE, 2);
  assert.equal(TEACHING_PRACTICE_TEAM_SIZE.BEGINNER_PRIVATE, 2);
  assert.equal(TEACHING_PRACTICE_TEAM_SIZE.BEGINNER_GROUP, 3);
});

// 2. role labels are exactly the current Hebrew wording.
test("ROLE_LABELS match the current Hebrew wording", () => {
  assert.deepEqual(ROLE_LABELS, {
    LEAD_INSTRUCTOR: "מדריך ראשון",
    SECOND_INSTRUCTOR: "מדריך שני",
    ASSISTANT_INSTRUCTOR: "עוזר מדריך",
    EVALUATOR: "ממשב",
  });
});

// 3. LUNGE at occurrenceIndex 0 assigns lead then assistant in rotationOrder order.
test("LUNGE occurrenceIndex 0 assigns LEAD then ASSISTANT by rotationOrder", () => {
  assert.deepEqual(computeTeachingPracticeRotation("LUNGE", LUNGE_TEAM, 0), [
    { traineeId: "a", role: "LEAD_INSTRUCTOR" },
    { traineeId: "b", role: "ASSISTANT_INSTRUCTOR" },
  ]);
});

// 4. LUNGE rotates roles by one position per occurrence and wraps with period 2.
test("LUNGE rotates by one position each occurrence and wraps at 2", () => {
  const occ1 = computeTeachingPracticeRotation("LUNGE", LUNGE_TEAM, 1);
  assert.deepEqual(occ1, [
    { traineeId: "a", role: "ASSISTANT_INSTRUCTOR" },
    { traineeId: "b", role: "LEAD_INSTRUCTOR" },
  ]);
  // occurrenceIndex 2 wraps back to the occurrenceIndex 0 assignment.
  assert.deepEqual(
    computeTeachingPracticeRotation("LUNGE", LUNGE_TEAM, 2),
    computeTeachingPracticeRotation("LUNGE", LUNGE_TEAM, 0)
  );
});

// 5. BEGINNER_GROUP at occurrenceIndex 0 assigns lead/second/evaluator.
test("BEGINNER_GROUP occurrenceIndex 0 assigns LEAD/SECOND/EVALUATOR by rotationOrder", () => {
  assert.deepEqual(computeTeachingPracticeRotation("BEGINNER_GROUP", GROUP_TEAM, 0), [
    { traineeId: "a", role: "LEAD_INSTRUCTOR" },
    { traineeId: "b", role: "SECOND_INSTRUCTOR" },
    { traineeId: "c", role: "EVALUATOR" },
  ]);
});

// 6. BEGINNER_GROUP rotates across three occurrences and wraps with period 3.
test("BEGINNER_GROUP rotates across occurrences and wraps at 3", () => {
  assert.deepEqual(computeTeachingPracticeRotation("BEGINNER_GROUP", GROUP_TEAM, 1), [
    { traineeId: "a", role: "EVALUATOR" },
    { traineeId: "b", role: "LEAD_INSTRUCTOR" },
    { traineeId: "c", role: "SECOND_INSTRUCTOR" },
  ]);
  assert.deepEqual(computeTeachingPracticeRotation("BEGINNER_GROUP", GROUP_TEAM, 2), [
    { traineeId: "a", role: "SECOND_INSTRUCTOR" },
    { traineeId: "b", role: "EVALUATOR" },
    { traineeId: "c", role: "LEAD_INSTRUCTOR" },
  ]);
  assert.deepEqual(
    computeTeachingPracticeRotation("BEGINNER_GROUP", GROUP_TEAM, 3),
    computeTeachingPracticeRotation("BEGINNER_GROUP", GROUP_TEAM, 0)
  );
});

// 7. BEGINNER_PRIVATE never rotates - occurrenceIndex is ignored; rotationOrder
//    0 is LEAD, rotationOrder 1 is ASSISTANT.
test("BEGINNER_PRIVATE does not rotate and ignores occurrenceIndex", () => {
  const team: TeachingPracticeRotationTrainee[] = [seat("lead", 0), seat("assist", 1)];
  const expected = [
    { traineeId: "lead", role: "LEAD_INSTRUCTOR" },
    { traineeId: "assist", role: "ASSISTANT_INSTRUCTOR" },
  ];
  assert.deepEqual(computeTeachingPracticeRotation("BEGINNER_PRIVATE", team, 0), expected);
  assert.deepEqual(computeTeachingPracticeRotation("BEGINNER_PRIVATE", team, 5), expected);
});

// 8. Deterministic: identical input yields identical output.
test("computeTeachingPracticeRotation is deterministic for identical input", () => {
  const first = computeTeachingPracticeRotation("BEGINNER_GROUP", GROUP_TEAM, 1);
  const second = computeTeachingPracticeRotation("BEGINNER_GROUP", GROUP_TEAM, 1);
  assert.deepEqual(first, second);
});

// 9. Each fixed seat rotates through every role position over a full cycle.
test("each seat rotates through all role positions over a full cycle", () => {
  // LUNGE seat at rotationOrder 0 over occurrences 0..1 covers both 2 roles.
  const lungeSeat0 = new Set<TeachingPracticeRoleValue>();
  for (let occ = 0; occ < 2; occ++) {
    const role = computeTeachingPracticeRotation("LUNGE", LUNGE_TEAM, occ).find((r) => r.traineeId === "a")!.role;
    lungeSeat0.add(role);
  }
  assert.deepEqual([...lungeSeat0].sort(), ["ASSISTANT_INSTRUCTOR", "LEAD_INSTRUCTOR"]);

  // BEGINNER_GROUP seat at rotationOrder 0 over occurrences 0..2 covers all 3 roles.
  const groupSeat0 = new Set<TeachingPracticeRoleValue>();
  for (let occ = 0; occ < 3; occ++) {
    const role = computeTeachingPracticeRotation("BEGINNER_GROUP", GROUP_TEAM, occ).find((r) => r.traineeId === "a")!.role;
    groupSeat0.add(role);
  }
  assert.equal(groupSeat0.size, 3);
  assert.ok(groupSeat0.has("LEAD_INSTRUCTOR"));
  assert.ok(groupSeat0.has("SECOND_INSTRUCTOR"));
  assert.ok(groupSeat0.has("EVALUATOR"));
});

// 10. No trainee is lost or duplicated by the rotation mapping.
test("rotation neither loses nor duplicates a trainee", () => {
  for (let occ = 0; occ < 5; occ++) {
    const result = computeTeachingPracticeRotation("BEGINNER_GROUP", GROUP_TEAM, occ);
    assert.equal(result.length, GROUP_TEAM.length);
    const ids = result.map((r) => r.traineeId);
    assert.equal(new Set(ids).size, GROUP_TEAM.length);
    assert.deepEqual([...ids].sort(), ["a", "b", "c"]);
  }
});

// 11. Every produced role is a known ROLE_LABELS key (labels stay consistent
//     with the rotation output).
test("every produced role has a matching ROLE_LABELS entry", () => {
  const all = [
    ...computeTeachingPracticeRotation("LUNGE", LUNGE_TEAM, 0),
    ...computeTeachingPracticeRotation("BEGINNER_GROUP", GROUP_TEAM, 0),
    ...computeTeachingPracticeRotation("BEGINNER_PRIVATE", LUNGE_TEAM, 0),
  ];
  for (const entry of all) {
    assert.ok(entry.role in ROLE_LABELS, `role ${entry.role} missing from ROLE_LABELS`);
    assert.equal(typeof ROLE_LABELS[entry.role], "string");
  }
});

// 12. Wrong team size / missing private lead throw the current error messages.
test("computeTeachingPracticeRotation throws on invalid team shapes", () => {
  assert.throws(
    () => computeTeachingPracticeRotation("LUNGE", [seat("a", 0)], 0),
    /התנסות זו דורשת בדיוק 2 חניכים בצוות/
  );
  assert.throws(
    () => computeTeachingPracticeRotation("BEGINNER_GROUP", LUNGE_TEAM, 0),
    /התנסות מתחילים קבוצתית דורשת בדיוק 3 חניכים בצוות/
  );
  assert.throws(
    () => computeTeachingPracticeRotation("BEGINNER_PRIVATE", [seat("a", 0), seat("b", 1), seat("c", 2)], 0),
    /התנסות זו תומכת בעד 2 חניכים בצוות/
  );
  assert.throws(
    () => computeTeachingPracticeRotation("BEGINNER_PRIVATE", [seat("assist", 1)], 0),
    /מסלול פרטני חסר מדריך\/ה ראשי\/ת/
  );
});

// 13. Partial rotation (exported and used by the full-sync core) matches the
//     full rotation for a complete, dense roster.
test("computePartialTeachingPracticeRotation matches full rotation for a dense roster", () => {
  assert.deepEqual(
    computePartialTeachingPracticeRotation("LUNGE", LUNGE_TEAM, 1),
    computeTeachingPracticeRotation("LUNGE", LUNGE_TEAM, 1)
  );
  assert.deepEqual(
    computePartialTeachingPracticeRotation("BEGINNER_GROUP", GROUP_TEAM, 1),
    computeTeachingPracticeRotation("BEGINNER_GROUP", GROUP_TEAM, 1)
  );
});

// 14. Partial rotation handles an incomplete roster without throwing and keys
//     the role off each trainee's own rotationOrder.
test("computePartialTeachingPracticeRotation keeps a lone LUNGE seat by its own rotationOrder", () => {
  // A lone rotationOrder-1 LUNGE seat at occurrence 0 keeps rotationOrder 1's
  // own role (ASSISTANT), never rotationOrder 0's.
  assert.deepEqual(computePartialTeachingPracticeRotation("LUNGE", [seat("only", 1)], 0), [
    { traineeId: "only", role: "ASSISTANT_INSTRUCTOR" },
  ]);
});

// 15. Partial private rotation: lone lead is kept; a private roster missing the
//     lead (rotationOrder 0) yields no participants, and it never throws.
test("computePartialTeachingPracticeRotation private lead handling", () => {
  assert.deepEqual(computePartialTeachingPracticeRotation("BEGINNER_PRIVATE", [seat("lead", 0)], 0), [
    { traineeId: "lead", role: "LEAD_INSTRUCTOR" },
  ]);
  assert.deepEqual(computePartialTeachingPracticeRotation("BEGINNER_PRIVATE", [seat("assist", 1)], 0), []);
});
