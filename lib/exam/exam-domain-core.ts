/**
 * EXAM X0 — PURE exam-domain core: foundational domain invariants and
 * structural validation for the greenfield, SCHEDULE-ONLY exam module.
 *
 * PURE by construction: no Prisma client, no DB, no clock (`Date.now`/`new
 * Date`), no randomness, no env, no auth/session/cookie, no filesystem, no
 * network, no Teaching-Practice model access, no `WeeklySchedule`/`ScheduleItem`
 * coupling. Every export is a deterministic function of its arguments and never
 * mutates its inputs. This module pulls in NO runtime code from anywhere.
 *
 * SCHEDULE-ONLY — this module (and the whole exam module in phase 1) models the
 * SCHEDULE ONLY. There is deliberately NO representation of scores, pass/fail,
 * results, or examiner feedback anywhere. Do not add them.
 *
 * WHAT THIS ANSWERS (and only this):
 *  - which `ExamKind` / `ExamPhase` values are valid (type guards);
 *  - the valid `ExamSession` SHAPE by phase/kind (INTERFACE_RIDING carries a
 *    phase; the other kinds do not; only a RIDING phase may link to an interface
 *    partner; a BEGINNER_INSTRUCTION session is overlay-only and embeds no
 *    participants because those derive from Teaching Practice — resolved in X6,
 *    NOT here);
 *  - the participant XOR rule (an `ExamAssignment` references EITHER an internal
 *    examinee OR an `ExternalExamCandidate`, never both, never neither);
 *  - "the instructed trainee cannot equal the examinee" within one session;
 *  - one `ExamPlan` per `CourseOffering` (duplicate-offering detection);
 *  - external candidates are manager-only, create no `Student`, and are
 *    soft-archived (a pure, non-mutating archive transform), never destructively
 *    deleted.
 *
 * WHAT THIS DOES NOT DO:
 *  - resolve, read, or write any Teaching-Practice lesson (that date→TP linking
 *    and reconciliation is X6);
 *  - detect time overlaps (exam-overlap-core) or cross-session conflicts
 *    (exam-conflict-core);
 *  - validate interface/riding PAIRING or the one-time seed
 *    (exam-interface-riding-core);
 *  - compute publication staleness (exam-publication-core);
 *  - touch Prisma, schema, migrations, actions, UI, or any IO.
 *
 * FAIL CLOSED: any structurally invalid input yields an issue, never a silent
 * pass. Membership tests use own-property semantics so inherited keys
 * (`__proto__`, `toString`, …) never validate as a real kind/phase.
 */

// ===========================================================================
// Enums (string-literal unions — the repository's pure-core convention)
// ===========================================================================

/** The four exam kinds. Schedule-only; carries no result semantics. */
export type ExamKind =
  | "INTERFACE_RIDING"
  | "LUNGE_NO_RIDER"
  | "ADVANCED_INSTRUCTION"
  | "BEGINNER_INSTRUCTION";

/** The two phases. Only `INTERFACE_RIDING` sessions are phased. */
export type ExamPhase = "INTERFACE" | "RIDING";

/** The participant role within a single session. */
export type ExamAssignmentRole = "EXAMINEE" | "INSTRUCTED_TRAINEE";

/** Canonical ordered kind list (stable; used for iteration/tests). */
export const EXAM_KINDS: readonly ExamKind[] = Object.freeze([
  "INTERFACE_RIDING",
  "LUNGE_NO_RIDER",
  "ADVANCED_INSTRUCTION",
  "BEGINNER_INSTRUCTION",
]);

/** Canonical ordered phase list. */
export const EXAM_PHASES: readonly ExamPhase[] = Object.freeze(["INTERFACE", "RIDING"]);

/** Canonical ordered assignment-role list. */
export const EXAM_ASSIGNMENT_ROLES: readonly ExamAssignmentRole[] = Object.freeze([
  "EXAMINEE",
  "INSTRUCTED_TRAINEE",
]);

// Frozen membership tables (own-property lookups only — proto keys never match).
const KIND_SET: Readonly<Record<string, true>> = Object.freeze({
  INTERFACE_RIDING: true,
  LUNGE_NO_RIDER: true,
  ADVANCED_INSTRUCTION: true,
  BEGINNER_INSTRUCTION: true,
});
const PHASE_SET: Readonly<Record<string, true>> = Object.freeze({
  INTERFACE: true,
  RIDING: true,
});
const ROLE_SET: Readonly<Record<string, true>> = Object.freeze({
  EXAMINEE: true,
  INSTRUCTED_TRAINEE: true,
});

/** True only for a key the object owns directly (never an inherited/proto key). */
function hasOwn(target: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(target, key);
}

/** A non-empty, trimmed identifier string; otherwise absent. */
function isPresentId(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/** Type guard: a valid `ExamKind`. Fails closed on non-strings and proto keys. */
export function isExamKind(value: unknown): value is ExamKind {
  return typeof value === "string" && hasOwn(KIND_SET, value);
}

/** Type guard: a valid `ExamPhase`. Fails closed on non-strings and proto keys. */
export function isExamPhase(value: unknown): value is ExamPhase {
  return typeof value === "string" && hasOwn(PHASE_SET, value);
}

/** Type guard: a valid `ExamAssignmentRole`. */
export function isExamAssignmentRole(value: unknown): value is ExamAssignmentRole {
  return typeof value === "string" && hasOwn(ROLE_SET, value);
}

// ===========================================================================
// Stable issue codes + Hebrew messages (audited-plan materialization)
// ===========================================================================

/**
 * Stable, non-PII domain issue codes. These are the X0 materialization of the
 * audited exam-domain invariants; the code STRINGS are the stable contract and
 * must not be renamed once consumed downstream.
 */
export type ExamDomainIssueCode =
  | "EX-DOM-INVALID-KIND"
  | "EX-DOM-INVALID-PHASE"
  | "EX-DOM-PHASE-REQUIRED"
  | "EX-DOM-PHASE-FORBIDDEN"
  | "EX-DOM-LINK-FORBIDDEN"
  | "EX-DOM-BEGINNER-HAS-PARTICIPANTS"
  | "EX-DOM-PARTICIPANT-NEITHER"
  | "EX-DOM-PARTICIPANT-BOTH"
  | "EX-DOM-PLAN-DUPLICATE-OFFERING";

/**
 * The authoritative code → Hebrew message table. The exhaustive
 * `Record<ExamDomainIssueCode, string>` annotation forces every code — present
 * or future — to carry a message or this file will not compile.
 */
export const EXAM_DOMAIN_MESSAGES: Readonly<Record<ExamDomainIssueCode, string>> =
  Object.freeze({
    "EX-DOM-INVALID-KIND": "סוג בחינה לא חוקי",
    "EX-DOM-INVALID-PHASE": "שלב בחינה לא חוקי",
    "EX-DOM-PHASE-REQUIRED": "לבחינת ממשק ורכיבה חובה להגדיר שלב (ממשק או רכיבה)",
    "EX-DOM-PHASE-FORBIDDEN": "לסוג בחינה זה אין שלב",
    "EX-DOM-LINK-FORBIDDEN": "רק מפגש רכיבה יכול להתקשר למפגש ממשק",
    "EX-DOM-BEGINNER-HAS-PARTICIPANTS":
      "בחינת מדריך מתחילים גוזרת משתתפים מהתרגול המעשי ואינה מכילה שיבוצים משלה",
    "EX-DOM-PARTICIPANT-NEITHER": "לשיבוץ אין נבחן פנימי ואין מועמד חיצוני",
    "EX-DOM-PARTICIPANT-BOTH": "לשיבוץ יש גם נבחן פנימי וגם מועמד חיצוני",
    "EX-DOM-PLAN-DUPLICATE-OFFERING": "לכל מחזור קורס מותרת תכנית בחינות אחת בלבד",
  });

/** A single structural issue: a stable code and its Hebrew message. */
export interface ExamDomainIssue {
  readonly code: ExamDomainIssueCode;
  readonly message: string;
}

/** A validation result: `ok` iff there are no issues. Issues are ordered. */
export interface ExamDomainValidationResult {
  readonly ok: boolean;
  readonly issues: readonly ExamDomainIssue[];
}

/** Build an issue from a code, binding its canonical Hebrew message. */
function issue(code: ExamDomainIssueCode): ExamDomainIssue {
  return { code, message: EXAM_DOMAIN_MESSAGES[code] };
}

/** Build a frozen result from an ordered issue list. */
function result(issues: readonly ExamDomainIssue[]): ExamDomainValidationResult {
  return Object.freeze({ ok: issues.length === 0, issues: Object.freeze([...issues]) });
}

// ===========================================================================
// Participant identity + the XOR rule
// ===========================================================================

/** A resolved participant identity: internal trainee XOR external candidate. */
export type ParticipantRef =
  | { readonly kind: "INTERNAL"; readonly studentId: string }
  | { readonly kind: "EXTERNAL"; readonly candidateId: string };

/** The raw participant fields of a single `ExamAssignment`. */
export interface ExamAssignmentParticipantInput {
  readonly internalStudentId?: string | null;
  readonly externalCandidateId?: string | null;
}

/**
 * Resolve the XOR participant identity, or `null` when the input is invalid
 * (neither present, or both present). Empty/whitespace ids count as absent.
 */
export function resolveParticipant(
  input: ExamAssignmentParticipantInput,
): ParticipantRef | null {
  const hasInternal = isPresentId(input.internalStudentId);
  const hasExternal = isPresentId(input.externalCandidateId);
  if (hasInternal === hasExternal) {
    // both present, or both absent — never a valid participant.
    return null;
  }
  return hasInternal
    ? { kind: "INTERNAL", studentId: (input.internalStudentId as string).trim() }
    : { kind: "EXTERNAL", candidateId: (input.externalCandidateId as string).trim() };
}

/** A stable, collision-free identity key for a participant. */
export function participantKey(ref: ParticipantRef): string {
  return ref.kind === "INTERNAL"
    ? `INTERNAL:${ref.studentId}`
    : `EXTERNAL:${ref.candidateId}`;
}

/**
 * Validate the participant XOR rule for one assignment: exactly one of internal
 * examinee / external candidate must be present.
 */
export function validateAssignmentParticipant(
  input: ExamAssignmentParticipantInput,
): ExamDomainValidationResult {
  const hasInternal = isPresentId(input.internalStudentId);
  const hasExternal = isPresentId(input.externalCandidateId);
  if (hasInternal && hasExternal) return result([issue("EX-DOM-PARTICIPANT-BOTH")]);
  if (!hasInternal && !hasExternal) return result([issue("EX-DOM-PARTICIPANT-NEITHER")]);
  return result([]);
}

// NOTE: "the instructed trainee cannot equal the examinee" is a SCHEDULING
// conflict, not a structural domain invariant, so it is owned by the conflict
// core as the single authoritative code EX-BLK-03 (examinee == instructed
// trainee within one session). It is intentionally NOT duplicated here, so the
// rule has exactly one business code. The participant ROLES it needs are the
// exported `ExamAssignmentRole` values above.

// ===========================================================================
// ExamSession structural shape
// ===========================================================================

/**
 * The structural fields of one `ExamSession`, independent of scheduling.
 * `embeddedAssignmentCount` is how many participant assignments the session
 * stores itself (0 for a beginner session, which derives participants from TP).
 */
export interface ExamSessionShapeInput {
  readonly kind: ExamKind;
  readonly phase: ExamPhase | null;
  /** The linked interface partner id — only a RIDING phase may carry one. */
  readonly interfaceSessionId: string | null;
  readonly embeddedAssignmentCount: number;
}

/**
 * Validate the structural shape of one `ExamSession`:
 *  - the kind must be valid;
 *  - INTERFACE_RIDING requires a valid phase; every other kind forbids a phase;
 *  - only an INTERFACE_RIDING session in the RIDING phase may carry an
 *    `interfaceSessionId` link;
 *  - a BEGINNER_INSTRUCTION session must embed no participant assignments (they
 *    derive from Teaching Practice — X6, not X0).
 * Returns ALL applicable issues in a stable order (never throws).
 */
export function validateExamSessionShape(
  input: ExamSessionShapeInput,
): ExamDomainValidationResult {
  const issues: ExamDomainIssue[] = [];

  if (!isExamKind(input.kind)) {
    // Without a valid kind, no phase/link reasoning is meaningful.
    return result([issue("EX-DOM-INVALID-KIND")]);
  }

  const phasePresent = input.phase !== null && input.phase !== undefined;
  if (phasePresent && !isExamPhase(input.phase)) {
    issues.push(issue("EX-DOM-INVALID-PHASE"));
  }

  if (input.kind === "INTERFACE_RIDING") {
    if (!phasePresent) {
      issues.push(issue("EX-DOM-PHASE-REQUIRED"));
    }
  } else if (phasePresent) {
    issues.push(issue("EX-DOM-PHASE-FORBIDDEN"));
  }

  const linkPresent = isPresentId(input.interfaceSessionId);
  const linkAllowed = input.kind === "INTERFACE_RIDING" && input.phase === "RIDING";
  if (linkPresent && !linkAllowed) {
    issues.push(issue("EX-DOM-LINK-FORBIDDEN"));
  }

  if (input.kind === "BEGINNER_INSTRUCTION" && input.embeddedAssignmentCount > 0) {
    issues.push(issue("EX-DOM-BEGINNER-HAS-PARTICIPANTS"));
  }

  return result(issues);
}

/**
 * Validate the NORMALIZED beginner-session shape ONLY (no Teaching-Practice
 * access). A beginner session is overlay-only: kind BEGINNER_INSTRUCTION, no
 * phase, no interface link, and zero embedded participants (participants are
 * derived from the linked TP lessons in X6). Delegates to
 * `validateExamSessionShape`, which already enforces exactly these rules for the
 * beginner kind.
 */
export function validateBeginnerSessionShape(
  input: Omit<ExamSessionShapeInput, "kind">,
): ExamDomainValidationResult {
  return validateExamSessionShape({ ...input, kind: "BEGINNER_INSTRUCTION" });
}

// ===========================================================================
// One ExamPlan per CourseOffering
// ===========================================================================

/** The identity of one `ExamPlan`: its own id and the offering it belongs to. */
export interface ExamPlanRef {
  readonly planId: string;
  readonly courseOfferingId: string;
}

/**
 * Enforce "one `ExamPlan` per `CourseOffering`": given the existing plans and a
 * candidate plan, flag a duplicate when another plan already targets the same
 * offering. Pure; does not mutate inputs.
 */
export function validateExamPlanUniqueness(
  candidate: ExamPlanRef,
  existingPlans: readonly ExamPlanRef[],
): ExamDomainValidationResult {
  for (const plan of existingPlans) {
    if (plan.planId === candidate.planId) continue; // the same plan is not a conflict
    if (plan.courseOfferingId === candidate.courseOfferingId) {
      return result([issue("EX-DOM-PLAN-DUPLICATE-OFFERING")]);
    }
  }
  return result([]);
}

// ===========================================================================
// External candidates — manager-only, no Student, soft-archive only
// ===========================================================================

/**
 * An external exam candidate. Note the deliberate ABSENCE of any `studentId`,
 * login, or account field: external candidates never create a `Student` and have
 * no login. `archived` is the soft-disable flag — external candidates are
 * archived, never destructively deleted.
 */
export interface ExternalExamCandidate {
  readonly candidateId: string;
  readonly displayName: string;
  readonly archived: boolean;
}

/**
 * Soft-archive an external candidate. Returns a NEW candidate object with
 * `archived: true`; the input is never mutated. There is no destructive-delete
 * transform in this module by design.
 */
export function archiveExternalCandidate(
  candidate: ExternalExamCandidate,
): ExternalExamCandidate {
  return { candidateId: candidate.candidateId, displayName: candidate.displayName, archived: true };
}
