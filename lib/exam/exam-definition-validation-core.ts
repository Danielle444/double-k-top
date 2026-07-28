/**
 * EXAM EX-C2 — PURE exam-definition validation core: the reusable exam
 * CONFIGURATION and the conformance of one block's assignments to it.
 *
 * PURE by construction: no Prisma, no DB, no clock, no randomness, no env, no
 * auth/session/cookie, no filesystem, no network, no Next. Every export is a
 * total, deterministic function of its arguments and never mutates its inputs.
 * The only runtime dependency is the sibling PURE domain core.
 *
 * WHAT THIS ANSWERS (and only this):
 *  - is one `ExamDefinition` internally coherent and SATISFIABLE?
 *  - do one block's assignments carry the fields its definition demands?
 *
 * WHAT THIS DOES NOT DO:
 *  - compute any time (exam-block-timetable-core — this module imports nothing
 *    from it and knows nothing about waves, durations in the clock sense, or
 *    capacity beyond validating that the number is sane);
 *  - detect conflicts (exam-conflict-core) or overlaps (exam-overlap-core);
 *  - re-state any kind-level prohibition already owned by exam-domain-core.
 *
 * ===========================================================================
 * WHY THE "NOT APPLICABLE" RULES EXIST
 * ===========================================================================
 * `requiresInstructedTrainee` and `requiresLessonTopic` may be true ONLY for
 * ADVANCED_INSTRUCTION. This is not new policy — it is forced by rules already
 * committed in exam-domain-core, which raises EX-DOM-INSTRUCTED-FORBIDDEN and
 * EX-DOM-TOPIC-FORBIDDEN for any session of another kind carrying those fields.
 *
 * Without these two checks a manager could save a definition that is
 * UNSATISFIABLE BY CONSTRUCTION: every block built from it would demand a field
 * that the domain core forbids on that kind, with no way to fix the block short
 * of deleting the definition. Catching it once, at definition time, is the
 * entire reason this half of the slice exists.
 *
 * `requiresDiscipline` carries no such restriction: `discipline` is free text
 * introduced with this feature and is constrained by no existing rule.
 *
 * ===========================================================================
 * "NOT REQUIRED" IS NOT "FORBIDDEN"
 * ===========================================================================
 * A false `requires*` flag means the field is OPTIONAL, never that a present
 * value is rejected. Reading an unchecked box as a prohibition would make
 * unchecking it retroactively invalidate every block already built from the
 * definition, turning a display preference into a data-loss trap. Kind-level
 * prohibition remains solely exam-domain-core's, and is not duplicated here.
 */
import type { ExamAssignmentRole, ExamKind } from "./exam-domain-core";
import { isStorableExamKind } from "./exam-domain-core";

// ===========================================================================
// Codes + Hebrew messages
// ===========================================================================

/** Codes describing the definition itself, independent of any block. */
export type ExamDefinitionShapeIssueCode =
  | "EX-DEF-NAME-REQUIRED"
  | "EX-DEF-KIND-NOT-STORABLE"
  | "EX-DEF-INVALID-DURATION"
  | "EX-DEF-INVALID-CAPACITY"
  | "EX-DEF-INSTRUCTED-NOT-APPLICABLE"
  | "EX-DEF-TOPIC-NOT-APPLICABLE";

/** Codes describing one block's assignments against its definition. */
export type ExamDefinitionConformanceIssueCode =
  | "EX-DEF-TRAINEE-REQUIRED"
  | "EX-DEF-HORSE-REQUIRED"
  | "EX-DEF-TOPIC-REQUIRED"
  | "EX-DEF-DISCIPLINE-REQUIRED"
  | "EX-DEF-INSTRUCTED-REQUIRED";

/** Every code this core can emit. The strings are the stable contract. */
export type ExamDefinitionIssueCode =
  | ExamDefinitionShapeIssueCode
  | ExamDefinitionConformanceIssueCode;

/**
 * The authoritative code → Hebrew message table. The exhaustive
 * `Record<ExamDefinitionIssueCode, string>` annotation forces every code —
 * present or future — to carry a message or this file will not compile.
 */
export const EXAM_DEFINITION_MESSAGES: Readonly<
  Record<ExamDefinitionIssueCode, string>
> = Object.freeze({
  "EX-DEF-NAME-REQUIRED": "חובה להזין שם בחינה",
  "EX-DEF-KIND-NOT-STORABLE": "סוג בחינה זה אינו נשמר כהגדרת בחינה",
  "EX-DEF-INVALID-DURATION": "משך הבחינה לכל נבחן חייב להיות מספר שלם וחיובי",
  "EX-DEF-INVALID-CAPACITY": "מספר הנבחנים במקביל חייב להיות מספר שלם וחיובי",
  "EX-DEF-INSTRUCTED-NOT-APPLICABLE": "רק בבחינת הדרכת מתקדמים ניתן לדרוש חניך מודרך",
  "EX-DEF-TOPIC-NOT-APPLICABLE": "רק בבחינת הדרכת מתקדמים ניתן לדרוש נושא הדרכה",
  "EX-DEF-TRAINEE-REQUIRED": "חובה לשבץ חניך לכל שיבוץ",
  "EX-DEF-HORSE-REQUIRED": "חובה לשבץ סוס לשיבוץ זה",
  "EX-DEF-TOPIC-REQUIRED": "חובה להזין נושא הדרכה לכל נבחן",
  "EX-DEF-DISCIPLINE-REQUIRED": "חובה להזין ענף לכל נבחן",
  "EX-DEF-INSTRUCTED-REQUIRED": "חובה לשבץ חניך מודרך אחד לפחות",
});

/**
 * One issue. `assignmentId` is the authoritative id of the offending
 * assignment for conformance codes, and `null` for definition-shape codes and
 * for the one block-level conformance code (`EX-DEF-INSTRUCTED-REQUIRED`,
 * which is about the block's composition rather than any single row).
 */
export interface ExamDefinitionIssue {
  readonly code: ExamDefinitionIssueCode;
  readonly message: string;
  readonly assignmentId: string | null;
}

/** A validation result: `ok` iff there are no issues. Issues are ordered. */
export interface ExamDefinitionValidationResult {
  readonly ok: boolean;
  readonly issues: readonly ExamDefinitionIssue[];
}

// ===========================================================================
// Input
// ===========================================================================

/** One reusable exam definition. */
export interface ExamDefinitionInput {
  /** The canonical exam name, used for grouping and display. */
  readonly name: string;
  readonly kind: ExamKind;
  /** Minutes per examined trainee. */
  readonly durationMinutes: number;
  /** Examinees examined at once. */
  readonly parallelCapacity: number;
  readonly requiresInstructedTrainee: boolean;
  readonly requiresLessonTopic: boolean;
  readonly requiresDiscipline: boolean;
}

/** One assignment being checked against its block's definition. */
export interface ExamAssignmentConformanceInput {
  readonly assignmentId: string;
  readonly role: ExamAssignmentRole;
  readonly studentId: string | null;
  readonly horseName: string | null;
  readonly instructionTopic: string | null;
  readonly discipline: string | null;
  readonly pairingIndex: number | null;
}

// ===========================================================================
// Helpers
// ===========================================================================

const ROLE_EXAMINEE = "EXAMINEE";
const ROLE_INSTRUCTED_TRAINEE = "INSTRUCTED_TRAINEE";
const KIND_ADVANCED_INSTRUCTION = "ADVANCED_INSTRUCTION";

/** A non-empty, trimmed string; otherwise absent. */
function isPresentText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** A finite integer strictly greater than zero. */
function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/**
 * A flag is honoured only when it is literally `true`.
 *
 * The same strict test is used for BOTH the "not applicable" checks and the
 * conformance checks, deliberately: a flag read one way when deciding whether
 * it is allowed and another way when deciding whether it binds would be
 * incoherent. The backing column is a non-null boolean with a default, so no
 * other value can reach here from the real reader.
 */
function isEnabled(value: unknown): boolean {
  return value === true;
}

function makeIssue(
  code: ExamDefinitionIssueCode,
  assignmentId: string | null = null,
): ExamDefinitionIssue {
  return Object.freeze({
    code,
    message: EXAM_DEFINITION_MESSAGES[code],
    assignmentId,
  });
}

function result(issues: readonly ExamDefinitionIssue[]): ExamDefinitionValidationResult {
  return Object.freeze({
    ok: issues.length === 0,
    issues: Object.freeze([...issues]),
  });
}

// ===========================================================================
// The horse rule
// ===========================================================================

/**
 * Is a horse required on this assignment?
 *
 * TRUE exactly when the role is EXAMINEE and the kind is one of the three
 * storable kinds. Horse is a required base field of every examinee assignment,
 * INCLUDING ADVANCED_INSTRUCTION: there `horseName` is the horse used for the
 * lesson, even though the person physically riding it is the instructed
 * trainee.
 *
 * FALSE for INSTRUCTED_TRAINEE, always. The lesson horse is already recorded
 * once on the examinee assignment; demanding a second one here would duplicate
 * the same fact in two rows that could then disagree.
 *
 * FALSE for a non-storable kind, which fails closed by never demanding a field
 * on a definition that must not exist in the first place.
 */
export function isHorseRequiredFor(kind: ExamKind, role: ExamAssignmentRole): boolean {
  return role === ROLE_EXAMINEE && isStorableExamKind(kind);
}

// ===========================================================================
// 1. The definition itself
// ===========================================================================

/**
 * Validate one exam definition, independent of any block.
 *
 * ISSUE ORDER (stable, and asserted by the tests): name, kind, duration,
 * capacity, instructed-trainee applicability, lesson-topic applicability. Every
 * applicable issue is returned; validation never stops at the first.
 *
 * The storable-kind test is delegated to `isStorableExamKind`, which already
 * fails closed on non-strings, unknown tokens, inherited prototype keys and
 * BEGINNER_INSTRUCTION. No second membership table is defined here.
 *
 * The two applicability checks compare against ADVANCED_INSTRUCTION directly,
 * so an invalid kind trips them too — a definition with an unusable kind AND a
 * flag that no kind but one may carry has two distinct problems, and reporting
 * both is more useful than hiding one behind the other.
 */
export function validateExamDefinition(
  input: ExamDefinitionInput,
): ExamDefinitionValidationResult {
  const issues: ExamDefinitionIssue[] = [];

  if (!isPresentText(input?.name)) issues.push(makeIssue("EX-DEF-NAME-REQUIRED"));
  if (!isStorableExamKind(input?.kind)) issues.push(makeIssue("EX-DEF-KIND-NOT-STORABLE"));
  if (!isPositiveInteger(input?.durationMinutes)) {
    issues.push(makeIssue("EX-DEF-INVALID-DURATION"));
  }
  if (!isPositiveInteger(input?.parallelCapacity)) {
    issues.push(makeIssue("EX-DEF-INVALID-CAPACITY"));
  }

  const isAdvanced = input?.kind === KIND_ADVANCED_INSTRUCTION;
  if (isEnabled(input?.requiresInstructedTrainee) && !isAdvanced) {
    issues.push(makeIssue("EX-DEF-INSTRUCTED-NOT-APPLICABLE"));
  }
  if (isEnabled(input?.requiresLessonTopic) && !isAdvanced) {
    issues.push(makeIssue("EX-DEF-TOPIC-NOT-APPLICABLE"));
  }
  // requiresDiscipline is valid for every storable kind and is never an issue.

  return result(issues);
}

// ===========================================================================
// 2. One block's assignments against that definition
// ===========================================================================

/**
 * Validate one block's assignments against its definition.
 *
 * Assignments are walked in INPUT ORDER, and within one assignment the codes
 * are emitted in the fixed order trainee, horse, topic, discipline. The single
 * block-level check (`EX-DEF-INSTRUCTED-REQUIRED`) is appended last. Every
 * per-assignment issue carries the authoritative `assignmentId`.
 *
 * A false `requires*` flag is NOT a prohibition — a value present anyway is
 * accepted in silence. See the note at the top of this file.
 */
export function validateAssignmentsAgainstDefinition(
  definition: ExamDefinitionInput,
  assignments: readonly ExamAssignmentConformanceInput[],
): ExamDefinitionValidationResult {
  const issues: ExamDefinitionIssue[] = [];
  const list = Array.isArray(assignments) ? assignments : [];

  const topicRequired = isEnabled(definition?.requiresLessonTopic);
  const disciplineRequired = isEnabled(definition?.requiresDiscipline);
  const instructedRequired = isEnabled(definition?.requiresInstructedTrainee);

  for (const assignment of list) {
    // A blank assignmentId is still reported; the id is attribution metadata,
    // never a precondition for surfacing a real missing field.
    const assignmentId = isPresentText(assignment?.assignmentId)
      ? assignment.assignmentId
      : null;
    const isExaminee = assignment?.role === ROLE_EXAMINEE;

    if (!isPresentText(assignment?.studentId)) {
      issues.push(makeIssue("EX-DEF-TRAINEE-REQUIRED", assignmentId));
    }
    if (
      isHorseRequiredFor(definition?.kind, assignment?.role) &&
      !isPresentText(assignment?.horseName)
    ) {
      issues.push(makeIssue("EX-DEF-HORSE-REQUIRED", assignmentId));
    }
    if (topicRequired && isExaminee && !isPresentText(assignment?.instructionTopic)) {
      issues.push(makeIssue("EX-DEF-TOPIC-REQUIRED", assignmentId));
    }
    if (disciplineRequired && isExaminee && !isPresentText(assignment?.discipline)) {
      issues.push(makeIssue("EX-DEF-DISCIPLINE-REQUIRED", assignmentId));
    }
  }

  if (instructedRequired) {
    const hasInstructed = list.some((a) => a?.role === ROLE_INSTRUCTED_TRAINEE);
    if (!hasInstructed) issues.push(makeIssue("EX-DEF-INSTRUCTED-REQUIRED"));
  }

  return result(issues);
}
