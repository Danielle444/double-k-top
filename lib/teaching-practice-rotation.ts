// Pure rotation math for Teaching Practice lesson generation - no DB access,
// no "use server". Kept separate from lib/actions/teaching-practice.ts so
// the formula itself is easy to read/verify on its own.

export type TeachingPracticeTypeValue = "LUNGE" | "BEGINNER_PRIVATE" | "BEGINNER_GROUP";

export type TeachingPracticeRoleValue =
  | "LEAD_INSTRUCTOR"
  | "SECOND_INSTRUCTOR"
  | "ASSISTANT_INSTRUCTOR"
  | "EVALUATOR";

// LUNGE/BEGINNER_PRIVATE always need exactly 2 trainees, BEGINNER_GROUP
// always needs exactly 3 - the sizes computeTeachingPracticeRotation and its
// callers both validate against.
export const TEACHING_PRACTICE_TEAM_SIZE: Record<TeachingPracticeTypeValue, number> = {
  LUNGE: 2,
  BEGINNER_PRIVATE: 2,
  BEGINNER_GROUP: 3,
};

const TWO_ROLE_ROTATION: TeachingPracticeRoleValue[] = ["LEAD_INSTRUCTOR", "ASSISTANT_INSTRUCTOR"];
const THREE_ROLE_ROTATION: TeachingPracticeRoleValue[] = [
  "LEAD_INSTRUCTOR",
  "SECOND_INSTRUCTOR",
  "EVALUATOR",
];

export interface TeachingPracticeRotationTrainee {
  traineeId: string;
  rotationOrder: number;
}

export interface TeachingPracticeRotationResult {
  traineeId: string;
  role: TeachingPracticeRoleValue;
}

// occurrenceIndex is 0-based ("how many lessons this track has generated
// already"): 0 = the first lesson, 1 = the second, etc.
//
// Both team sizes use one formula: the trainee at rotationOrder i gets
// roleList[((i - occurrenceIndex) % size + size) % size], where roleList is
// [LEAD, ASSISTANT] for a 2-person team or [LEAD, SECOND, EVALUATOR] for a
// 3-person team. Verified against the product spec's own worked examples -
// see the self-check in the Stage 2 report.
//
// Throws if the trainee count doesn't match what practiceType requires -
// callers are expected to validate team size themselves first (this is a
// safety net, not the primary validation path).
export function computeTeachingPracticeRotation(
  practiceType: TeachingPracticeTypeValue,
  trainees: TeachingPracticeRotationTrainee[],
  occurrenceIndex: number
): TeachingPracticeRotationResult[] {
  const roles = practiceType === "BEGINNER_GROUP" ? THREE_ROLE_ROTATION : TWO_ROLE_ROTATION;
  const expectedSize = TEACHING_PRACTICE_TEAM_SIZE[practiceType];

  if (trainees.length !== expectedSize) {
    throw new Error(
      practiceType === "BEGINNER_GROUP"
        ? "התנסות הדרכה קבוצתית לחניכי מתחילים דורשת בדיוק 3 חניכים בצוות"
        : "התנסות זו דורשת בדיוק 2 חניכים בצוות"
    );
  }

  const sorted = [...trainees].sort((a, b) => a.rotationOrder - b.rotationOrder);
  return sorted.map((trainee, i) => {
    const roleIndex = (((i - occurrenceIndex) % expectedSize) + expectedSize) % expectedSize;
    return { traineeId: trainee.traineeId, role: roles[roleIndex] };
  });
}
