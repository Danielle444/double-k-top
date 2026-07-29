/**
 * EXAM EX-C1 — PURE Hebrew label maps for the exam enums.
 *
 * PURE by construction: no Prisma, no DB, no Next, no clock, no randomness, no
 * env, no auth, no IO. Plain frozen constants and total lookup functions.
 *
 * DELIBERATELY NOT a "use server" module. These are synchronous constants and
 * mappers read by server components AND client components alike; putting them
 * behind "use server" would turn every label lookup into an async Server Action
 * boundary, which is both wrong and a needless export surface.
 *
 * Each map is annotated as an EXHAUSTIVE `Record<…, string>` over its enum
 * union, so adding a value to any exam enum without adding its Hebrew label is
 * a COMPILE ERROR, not a runtime blank.
 *
 * There is no THEORY label because there is no THEORY kind: the theory exam is
 * outside this module. There is no DEMO_RIDER label because "rides for the
 * examinee" and "is instructed by the examinee" are the SAME role.
 *
 * EX-S3.5 — there is no phase label map either. The phase model is RETIRED, and
 * `ExamDefinition.name` is the ONLY visible exam name: separate definitions
 * named "ממשק" and "רכיבה" are what distinguish those exams now. Re-exposing
 * "ממשק"/"רכיבה" through a phase label would resurrect a second, competing
 * source of exam identity in the UI, so `EXAM_PHASE_LABELS` is deliberately
 * gone rather than merely deprecated.
 */
import type {
  ExamAssignmentRole,
  ExamBeginnerFormat,
  ExamKind,
} from "./exam-domain-core";
import { isExamKind } from "./exam-domain-core";

/** The four exam kinds, in Hebrew. */
export const EXAM_KIND_LABELS: Readonly<Record<ExamKind, string>> = Object.freeze({
  INTERFACE_RIDING: "ממשק ורכיבה",
  LUNGE_NO_RIDER: "לונג ללא רוכב",
  ADVANCED_INSTRUCTION: "הדרכת מתקדמים",
  BEGINNER_INSTRUCTION: "הדרכת מתחילים",
});

/** The copied beginner-session formats, in Hebrew. */
export const EXAM_BEGINNER_FORMAT_LABELS: Readonly<Record<ExamBeginnerFormat, string>> =
  Object.freeze({
    LUNGE: "לונג",
    BEGINNER_PRIVATE: "מתחילים פרטני",
    BEGINNER_GROUP: "מתחילים קבוצתי",
  });

/**
 * The two assignment roles, in Hebrew. `INSTRUCTED_TRAINEE` is "חניך מודרך" —
 * the single locked label covering both "rides for the examinee" and "is
 * instructed by the examinee".
 */
export const EXAM_ASSIGNMENT_ROLE_LABELS: Readonly<Record<ExamAssignmentRole, string>> =
  Object.freeze({
    EXAMINEE: "נבחן",
    INSTRUCTED_TRAINEE: "חניך מודרך",
  });

/**
 * The Hebrew label for a kind, or `null` for anything outside the domain.
 * Total and fail-closed: an unknown/garbage value never yields a label and
 * never throws, so a bad route segment cannot render as an exam type.
 */
export function examKindLabel(value: unknown): string | null {
  return isExamKind(value) ? EXAM_KIND_LABELS[value] : null;
}
