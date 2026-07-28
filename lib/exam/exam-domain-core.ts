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
 *    partner; a BEGINNER_INSTRUCTION session carries an `ExamBeginnerFormat` and
 *    MUST embed the participants COPIED from Teaching Practice — see the EX-C1
 *    amendment note below);
 *  - which kind-specific fields are FORBIDDEN on which kind (format, copy
 *    provenance, embedded children, instructed trainees, instruction topic);
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
 *
 * ===========================================================================
 * EX-C1 AMENDMENT — SNAPSHOT/COPY SEMANTICS SUPERSEDE REFERENCE/DERIVE
 * ===========================================================================
 * The original X0 rule "a BEGINNER_INSTRUCTION session embeds NO participants
 * because they derive from Teaching Practice" is **INVERTED** by the approved
 * snapshot/copy design. A beginner exam session is an INDEPENDENT COPY of one
 * `TeachingPracticeLesson`, not a live reference to it, so it MUST embed the
 * participants that were copied into it. `EX-DOM-BEGINNER-HAS-PARTICIPANTS`
 * now fires when a beginner session embeds NONE (its code string is kept
 * stable on purpose — only its meaning and message changed).
 *
 * Teaching Practice remains READ-ONLY INPUT: this core performs no TP access
 * of any kind, and no exam write path ever writes back to a TP model.
 *
 * Seven further FORBIDDEN/REQUIRED rules were added with the same amendment
 * (format, copy provenance, embedded children, instructed trainees,
 * instruction topic, pairing). Every other already-committed X0 rule is
 * preserved unchanged.
 *
 * The kind-specific inputs are all OPTIONAL on `ExamSessionShapeInput`: an
 * omitted field reads as ABSENT, which is the fail-closed reading for every
 * FORBIDDEN rule and correctly trips the REQUIRED rules on a beginner session.
 *
 * ===========================================================================
 * EX-C2-0 AMENDMENT — A STORED BEGINNER SESSION IS FORBIDDEN
 * ===========================================================================
 * The snapshot/copy design above is SUPERSEDED for BEGINNER_INSTRUCTION.
 * Beginner exams are now a LIVE PROJECTION of Teaching Practice: the plan
 * stores only which TP dates it covers (`ExamTeachingPracticeSourceDate`), and
 * every beginner row — lessons, participants, roles, children, parent contacts,
 * horses, equipment, absence, notes, instructor, location — is derived at read
 * time by `exam-live-beginner-adapter-core`. Nothing is copied.
 *
 * `STORED_EXAM_KINDS` / `isStorableExamKind` / `validateStoredExamSession`
 * express that: a write path must reject `BEGINNER_INSTRUCTION` outright with
 * `EX-DOM-BEGINNER-SESSION-FORBIDDEN`.
 *
 * NOTHING ABOVE WAS WEAKENED. `validateExamSessionShape` and
 * `validateBeginnerSessionShape` keep their exact EX-C1 behaviour and every
 * existing issue code is preserved; the beginner rules simply become an
 * unreachable inner defence rather than a live requirement.
 *
 * SCHEDULE-ONLY still holds, and now explicitly: no feedback, rating, grade or
 * result appears in the exam module or in the live projection's inputs.
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

/**
 * The format of a COPIED beginner-instruction session, denormalized from the
 * source `TeachingPracticeLesson.practiceType` at copy time. Only a
 * `BEGINNER_INSTRUCTION` session carries one.
 */
export type ExamBeginnerFormat = "LUNGE" | "BEGINNER_PRIVATE" | "BEGINNER_GROUP";

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

/** Canonical ordered beginner-format list (stable; used for iteration/tests). */
export const EXAM_BEGINNER_FORMATS: readonly ExamBeginnerFormat[] = Object.freeze([
  "LUNGE",
  "BEGINNER_PRIVATE",
  "BEGINNER_GROUP",
]);

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
const BEGINNER_FORMAT_SET: Readonly<Record<string, true>> = Object.freeze({
  LUNGE: true,
  BEGINNER_PRIVATE: true,
  BEGINNER_GROUP: true,
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

/** Type guard: a valid `ExamBeginnerFormat`. Fails closed on proto keys. */
export function isExamBeginnerFormat(value: unknown): value is ExamBeginnerFormat {
  return typeof value === "string" && hasOwn(BEGINNER_FORMAT_SET, value);
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
  | "EX-DOM-PLAN-DUPLICATE-OFFERING"
  // --- EX-C1 amendment: kind-specific field applicability -------------------
  | "EX-DOM-FORMAT-REQUIRED"
  | "EX-DOM-FORMAT-FORBIDDEN"
  | "EX-DOM-COPY-SOURCE-FORBIDDEN"
  | "EX-DOM-CHILDREN-FORBIDDEN"
  | "EX-DOM-INSTRUCTED-FORBIDDEN"
  | "EX-DOM-TOPIC-FORBIDDEN"
  | "EX-DOM-PAIRING-REQUIRED"
  // --- EX-C2-0: beginner exams are a LIVE PROJECTION, never a stored row -----
  | "EX-DOM-BEGINNER-SESSION-FORBIDDEN";

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
    // EX-C1: meaning INVERTED by the snapshot/copy design — the code string is
    // deliberately unchanged, but a beginner session must now EMBED the
    // participants copied from Teaching Practice.
    "EX-DOM-BEGINNER-HAS-PARTICIPANTS":
      "בחינת מדריך מתחילים חייבת לכלול את המשתתפים שהועתקו מהתרגול המעשי",
    "EX-DOM-PARTICIPANT-NEITHER": "לשיבוץ אין נבחן פנימי ואין מועמד חיצוני",
    "EX-DOM-PARTICIPANT-BOTH": "לשיבוץ יש גם נבחן פנימי וגם מועמד חיצוני",
    "EX-DOM-PLAN-DUPLICATE-OFFERING": "לכל מחזור קורס מותרת תכנית בחינות אחת בלבד",
    "EX-DOM-FORMAT-REQUIRED":
      "לבחינת מדריך מתחילים חובה להגדיר מתכונת (לונג, פרטני או קבוצתי)",
    "EX-DOM-FORMAT-FORBIDDEN": "רק לבחינת מדריך מתחילים יש מתכונת",
    "EX-DOM-COPY-SOURCE-FORBIDDEN":
      "רק בחינת מדריך מתחילים יכולה לשאת פרטי מקור העתקה מהתרגול המעשי",
    "EX-DOM-CHILDREN-FORBIDDEN": "רק בחינת מדריך מתחילים יכולה לכלול ילדים",
    "EX-DOM-INSTRUCTED-FORBIDDEN": "רק בחינת הדרכת מתקדמים יכולה לכלול חניך מודרך",
    "EX-DOM-TOPIC-FORBIDDEN": "רק בחינת הדרכת מתקדמים יכולה לכלול נושא הדרכה",
    "EX-DOM-PAIRING-REQUIRED":
      "כאשר יש יותר מנבחן אחד באותו מפגש חובה לשייך כל שיבוץ לזוג הדרכה",
    "EX-DOM-BEGINNER-SESSION-FORBIDDEN":
      "בחינת מדריך מתחילים נקראת ישירות מהתנסויות מתחילים ואינה נשמרת כמפגש בחינה",
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
  /** Total participant assignments the session stores itself. */
  readonly embeddedAssignmentCount: number;

  // --- EX-C1 amendment: kind-specific applicability inputs ------------------
  // All OPTIONAL. Omitted reads as ABSENT, which is the fail-closed reading for
  // every FORBIDDEN rule below and correctly trips the REQUIRED rules.

  /** The copied beginner format. Required on BEGINNER_INSTRUCTION only. */
  readonly beginnerFormat?: ExamBeginnerFormat | null;
  /**
   * True when ANY copy-provenance value is present on the row
   * (`sourceTeachingPracticeLessonId`, `copiedAt`, or `roleLabelOverrides`).
   * Only a BEGINNER_INSTRUCTION session may carry copy provenance.
   */
  readonly copyProvenancePresent?: boolean;
  /** Embedded `ExamBeginnerChild` snapshot rows. Beginner-only. */
  readonly beginnerChildCount?: number;
  /** Assignments with role EXAMINEE. */
  readonly examineeCount?: number;
  /** Assignments with role INSTRUCTED_TRAINEE. ADVANCED_INSTRUCTION only. */
  readonly instructedTraineeCount?: number;
  /** Assignments carrying an `instructionTopic`. ADVANCED_INSTRUCTION only. */
  readonly instructionTopicCount?: number;
  /** Assignments carrying a `pairingIndex`. */
  readonly pairedAssignmentCount?: number;
}

/** A non-negative count, defaulting to 0 for an absent/invalid input. */
function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Validate the structural shape of one `ExamSession`:
 *  - the kind must be valid;
 *  - INTERFACE_RIDING requires a valid phase; every other kind forbids a phase;
 *  - only an INTERFACE_RIDING session in the RIDING phase may carry an
 *    `interfaceSessionId` link;
 *  - BEGINNER_INSTRUCTION requires a valid `beginnerFormat`; every other kind
 *    forbids one;
 *  - a BEGINNER_INSTRUCTION session MUST embed the participants copied from
 *    Teaching Practice (EX-C1 inversion — see the amendment note at the top);
 *  - copy provenance and embedded children are BEGINNER_INSTRUCTION-only;
 *  - instructed trainees and instruction topics are ADVANCED_INSTRUCTION-only;
 *  - an ADVANCED_INSTRUCTION session holding more than one examinee must pair
 *    every assignment, so "who teaches whom" is answerable.
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

  const isBeginner = input.kind === "BEGINNER_INSTRUCTION";
  const isAdvanced = input.kind === "ADVANCED_INSTRUCTION";

  // EX-C1 INVERSION: a beginner session is an independent COPY, so it must
  // embed the participants that were copied into it.
  if (isBeginner && count(input.embeddedAssignmentCount) === 0) {
    issues.push(issue("EX-DOM-BEGINNER-HAS-PARTICIPANTS"));
  }

  // Beginner format: required on beginner (an invalid value counts as missing,
  // failing closed), forbidden everywhere else.
  const formatPresent = input.beginnerFormat !== null && input.beginnerFormat !== undefined;
  if (isBeginner) {
    if (!isExamBeginnerFormat(input.beginnerFormat)) {
      issues.push(issue("EX-DOM-FORMAT-REQUIRED"));
    }
  } else if (formatPresent) {
    issues.push(issue("EX-DOM-FORMAT-FORBIDDEN"));
  }

  // Copy provenance and embedded child snapshots are beginner-only.
  if (!isBeginner && input.copyProvenancePresent === true) {
    issues.push(issue("EX-DOM-COPY-SOURCE-FORBIDDEN"));
  }
  if (!isBeginner && count(input.beginnerChildCount) > 0) {
    issues.push(issue("EX-DOM-CHILDREN-FORBIDDEN"));
  }

  // Instructed trainees and instruction topics are advanced-instruction-only.
  if (!isAdvanced && count(input.instructedTraineeCount) > 0) {
    issues.push(issue("EX-DOM-INSTRUCTED-FORBIDDEN"));
  }
  if (!isAdvanced && count(input.instructionTopicCount) > 0) {
    issues.push(issue("EX-DOM-TOPIC-FORBIDDEN"));
  }

  // Pairing is only meaningful for an instruction exam, and only once a second
  // examinee makes "who teaches whom" ambiguous. Deliberately scoped to
  // ADVANCED_INSTRUCTION: a copied beginner session legitimately holds several
  // examinees and never carries a pairingIndex.
  if (isAdvanced && count(input.examineeCount) > 1) {
    const total = count(input.embeddedAssignmentCount);
    if (count(input.pairedAssignmentCount) < total) {
      issues.push(issue("EX-DOM-PAIRING-REQUIRED"));
    }
  }

  return result(issues);
}

/**
 * Validate the COPIED beginner-session shape ONLY (no Teaching-Practice
 * access — this core never reads TP). A beginner session carries kind
 * BEGINNER_INSTRUCTION, no phase, no interface link, a valid
 * `ExamBeginnerFormat`, and the participants COPIED from its source lesson.
 * Delegates to `validateExamSessionShape`, which enforces exactly these rules
 * for the beginner kind.
 */
export function validateBeginnerSessionShape(
  input: Omit<ExamSessionShapeInput, "kind">,
): ExamDomainValidationResult {
  return validateExamSessionShape({ ...input, kind: "BEGINNER_INSTRUCTION" });
}

// ===========================================================================
// EX-C2-0 — which kinds may exist as STORED rows
// ===========================================================================

/**
 * The kinds that may exist as a stored `ExamSession` row.
 *
 * `BEGINNER_INSTRUCTION` is deliberately ABSENT. Beginner exams are a LIVE
 * PROJECTION of Teaching Practice — the plan stores only which TP dates it
 * covers (`ExamTeachingPracticeSourceDate`), and every beginner row is derived
 * at read time — so materialising one as a row would create the second,
 * divergent source of truth the design exists to prevent.
 */
export const STORED_EXAM_KINDS: readonly ExamKind[] = Object.freeze([
  "INTERFACE_RIDING",
  "LUNGE_NO_RIDER",
  "ADVANCED_INSTRUCTION",
]);

const STORED_KIND_SET: Readonly<Record<string, true>> = Object.freeze({
  INTERFACE_RIDING: true,
  LUNGE_NO_RIDER: true,
  ADVANCED_INSTRUCTION: true,
});

/**
 * True only for a kind that may be STORED as an `ExamSession` row. Fails closed
 * on non-strings, unknown tokens, inherited/prototype keys — and, by design, on
 * `BEGINNER_INSTRUCTION`, which is a valid `ExamKind` but not a storable one.
 */
export function isStorableExamKind(value: unknown): value is ExamKind {
  return typeof value === "string" && hasOwn(STORED_KIND_SET, value) && STORED_KIND_SET[value];
}

/**
 * Validate one session that is about to be STORED (created or updated as a real
 * `ExamSession` row).
 *
 * A `BEGINNER_INSTRUCTION` kind is rejected OUTRIGHT with
 * `EX-DOM-BEGINNER-SESSION-FORBIDDEN` and no further shape reasoning: once the
 * kind is disallowed, the remaining per-kind rules describe a row that must not
 * exist, so reporting them too would only obscure the real problem. Every other
 * kind is delegated UNCHANGED to `validateExamSessionShape`.
 *
 * This deliberately does NOT weaken `validateExamSessionShape` or
 * `validateBeginnerSessionShape`: both keep their exact EX-C1 behaviour and now
 * serve as an inner line of defence for any caller that still reasons about a
 * beginner shape. This function is the outer gate for the WRITE path.
 *
 * The database cannot express this rule without a check constraint the approved
 * migration does not add, which is precisely why it lives here.
 */
export function validateStoredExamSession(
  input: ExamSessionShapeInput,
): ExamDomainValidationResult {
  if (input.kind === "BEGINNER_INSTRUCTION") {
    return result([issue("EX-DOM-BEGINNER-SESSION-FORBIDDEN")]);
  }
  return validateExamSessionShape(input);
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
