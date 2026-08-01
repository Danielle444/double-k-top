/**
 * EXAM EX-ADMIN-WORKSPACE-UX (ATOMIC REPLACEMENT) — setting the ONE instructed
 * trainee an examinee teaches, decided from the EXAMINEE's side, as a single
 * command the write layer applies in ONE transaction.
 *
 * ===========================================================================
 * WHY THE COMMITTED PAIRING WRITER CANNOT DO THIS ALONE
 * ===========================================================================
 * The committed writer is TRAINEE-FIRST: it points ONE instructed trainee at ONE
 * examinee. That is the right shape for the operation it names, and the
 * one-to-one rule it enforces is what makes it safe — but the same rule makes a
 * REPLACEMENT unreachable through it. While trainee A still holds the examinee's
 * index, a request to point trainee B at that examinee is correctly refused as
 * `examinee_already_paired`.
 *
 * Doing it in TWO calls — unpair A, then pair B — is exactly what must not
 * happen. Between them the examinee is COMMITTED as teaching nobody, and if the
 * second call is refused the manager is left with a link they never asked to
 * delete.
 *
 * So this decision names the EXAMINEE, resolves which trainee it currently
 * teaches, and produces ONE command describing BOTH halves of the switch.
 *
 * ===========================================================================
 * IT DUPLICATES NO PAIRING RULE
 * ===========================================================================
 * Every question about whether B may take this examinee — the roles, the shared
 * session, index reuse versus allocation, ambiguity, and the one-to-one rule
 * itself — is answered by the COMMITTED decision, which this module imports and
 * calls. It is called with the session's instructed trainees AS THEY WILL BE
 * once A is cleared, because that is precisely what the transaction does before
 * the pair write lands. The committed rule is therefore applied to the true
 * post-clear state rather than re-implemented against a different one.
 *
 * The ONE rule this module adds is the one the examinee-first direction needs
 * and the trainee-first direction never had to ask: B MUST NOT ALREADY BELONG TO
 * A DIFFERENT EXAMINEE. Pointing B here would otherwise silently take B away
 * from whoever had it — a second person's schedule changing because of an edit
 * nobody made to it.
 *
 * PURE: no Prisma, no DB, no clock, no randomness, no env, no auth, no
 * filesystem, no network, no Next, no `server-only`, no `"use server"`. Its ONE
 * import is the committed pairing decision, which is itself pure — that import
 * is the whole point of the module.
 */
import {
  decideExamInstructedTraineePairing,
  type ExamPairingDecision,
  type ExamPairingExamineeFacts,
  type ExamPairingInstructedTraineeFacts,
} from "./exam-pairing-write-core";

/** ONE assignment, as the plan-scoped read reports it for a replacement. */
export interface ExamReplacementAssignmentFacts {
  readonly assignmentId: string;
  readonly sessionId: string;
  readonly role: string;
  readonly pairingIndex: number | null;
}

/** Every refusal the pure replacement decision can produce. */
export type ExamReplacementDecisionRefusalCode =
  | "invalid_input"
  | "role_not_examinee"
  | "instructed_role_mismatch"
  | "different_sessions"
  | "ambiguous_pairing_index"
  | "instructed_trainee_already_paired"
  | "examinee_already_paired";

/**
 * ONE conditional clear of the trainee being replaced.
 *
 * The expected index is the EXACT value it must still hold, so a clear whose
 * world moved on applies to nothing and the transaction rolls back rather than
 * releasing a pairing somebody else just changed.
 */
export interface ExamReplacementClear {
  readonly instructedTraineeAssignmentId: string;
  readonly expectedPairingIndex: number;
}

/**
 * The decision.
 *
 * `REPLACE` always carries the pair half; `clear` is `null` when the examinee
 * taught nobody, which is a first assignment rather than a replacement. Both
 * halves are CONDITIONAL, and the write layer applies them in ONE transaction.
 */
export type ExamReplacementDecision =
  | { readonly ok: true; readonly kind: "NO_CHANGE" }
  | { readonly ok: true; readonly kind: "UNPAIR"; readonly clear: ExamReplacementClear }
  | {
      readonly ok: true;
      readonly kind: "REPLACE";
      readonly clear: ExamReplacementClear | null;
      /** The COMMITTED pairing decision, evaluated against the POST-CLEAR state. */
      readonly pair: ExamPairingDecision;
    }
  | { readonly ok: false; readonly code: ExamReplacementDecisionRefusalCode };

/** A usable pairing label: an integer strictly greater than zero. */
function isUsablePairingIndex(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/** A usable opaque id: a non-empty, non-blank string. */
function isUsableId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function refuse(code: ExamReplacementDecisionRefusalCode): ExamReplacementDecision {
  return Object.freeze({ ok: false as const, code });
}

/**
 * Which instructed trainee does this examinee currently teach?
 *
 * The pairing model is an INDEX: a trainee follows the examinee whose index it
 * holds. So the current partner is the session's instructed trainee holding the
 * examinee's own index — and an examinee holding no usable index teaches nobody
 * that this operation may act on.
 *
 * MORE THAN ONE holder is AMBIGUOUS and fails closed rather than picking one:
 * two trainees claiming one examinee is a state this operation must not resolve
 * by guessing, and the committed reader publishes no partner for it either.
 */
function resolveCurrent(
  examineePairingIndex: number | null,
  sessionInstructedTrainees: readonly ExamPairingInstructedTraineeFacts[],
): { ok: true; current: ExamPairingInstructedTraineeFacts | null } | { ok: false } {
  if (!isUsablePairingIndex(examineePairingIndex)) {
    return { ok: true, current: null };
  }
  const holders = sessionInstructedTrainees.filter(
    (row) => row.pairingIndex === examineePairingIndex,
  );
  if (holders.length > 1) return { ok: false };
  return { ok: true, current: holders.length === 1 ? holders[0] : null };
}

/**
 * Decide the WHOLE switch, purely and totally.
 *
 * Never throws, never mutates an input, reads no clock, and returns a frozen,
 * JSON-safe object. Every refusal is reached BEFORE any write is described, so a
 * refused decision cannot be partially applied by a caller that ignores `kind`.
 */
export function decideExamExamineeInstructedTraineeReplacement(input: {
  readonly examinee: ExamReplacementAssignmentFacts;
  readonly next: ExamReplacementAssignmentFacts | null;
  readonly sessionExaminees: readonly ExamPairingExamineeFacts[];
  readonly sessionInstructedTrainees: readonly ExamPairingInstructedTraineeFacts[];
}): ExamReplacementDecision {
  const examinee = input.examinee;
  if (examinee === null || typeof examinee !== "object") return refuse("invalid_input");
  if (!isUsableId(examinee.assignmentId)) return refuse("invalid_input");
  if (!isUsableId(examinee.sessionId)) return refuse("invalid_input");
  if (examinee.role !== "EXAMINEE") return refuse("role_not_examinee");

  const trainees = Array.isArray(input.sessionInstructedTrainees)
    ? input.sessionInstructedTrainees
    : [];
  const examinees = Array.isArray(input.sessionExaminees) ? input.sessionExaminees : [];

  const resolved = resolveCurrent(examinee.pairingIndex, trainees);
  if (!resolved.ok) return refuse("ambiguous_pairing_index");
  const current = resolved.current;

  // ---------------------------------------------------------------------
  // "teach nobody" — the ABSENCE of a next trainee IS the request.
  // ---------------------------------------------------------------------
  if (input.next === null) {
    if (current === null) {
      return Object.freeze({ ok: true as const, kind: "NO_CHANGE" as const });
    }
    return Object.freeze({
      ok: true as const,
      kind: "UNPAIR" as const,
      clear: Object.freeze({
        instructedTraineeAssignmentId: current.assignmentId,
        expectedPairingIndex: current.pairingIndex as number,
      }),
    });
  }

  const next = input.next;
  if (typeof next !== "object") return refuse("invalid_input");
  if (!isUsableId(next.assignmentId)) return refuse("invalid_input");
  // One row cannot be both halves of a pair.
  if (next.assignmentId === examinee.assignmentId) return refuse("invalid_input");
  if (next.role !== "INSTRUCTED_TRAINEE") return refuse("instructed_role_mismatch");
  if (next.sessionId !== examinee.sessionId) return refuse("different_sessions");

  // Already the one being taught: nothing is written.
  if (current !== null && current.assignmentId === next.assignmentId) {
    return Object.freeze({ ok: true as const, kind: "NO_CHANGE" as const });
  }

  // THE ONE RULE THIS MODULE ADDS. B holding a usable index that is NOT this
  // examinee's means B already follows a DIFFERENT examinee.
  if (isUsablePairingIndex(next.pairingIndex) && next.pairingIndex !== examinee.pairingIndex) {
    return refuse("instructed_trainee_already_paired");
  }

  // The COMMITTED decision, asked about the state the transaction will actually
  // produce: the trainee being replaced is GONE from the session's set, because
  // the clear lands first inside that same transaction.
  const postClear =
    current === null
      ? trainees
      : trainees.filter((row) => row.assignmentId !== current.assignmentId);

  const pair = decideExamInstructedTraineePairing({
    instructed: {
      assignmentId: next.assignmentId,
      sessionId: next.sessionId,
      role: next.role,
      pairingIndex: next.pairingIndex,
    },
    examinee: {
      assignmentId: examinee.assignmentId,
      sessionId: examinee.sessionId,
      role: examinee.role,
      pairingIndex: examinee.pairingIndex,
    },
    sessionExaminees: examinees,
    sessionInstructedTrainees: postClear,
  });

  if (pair.kind === "REFUSE") {
    return refuse(pair.code as ExamReplacementDecisionRefusalCode);
  }

  return Object.freeze({
    ok: true as const,
    kind: "REPLACE" as const,
    clear:
      current === null
        ? null
        : Object.freeze({
            instructedTraineeAssignmentId: current.assignmentId,
            expectedPairingIndex: current.pairingIndex as number,
          }),
    pair,
  });
}

// ===========================================================================
// The orchestration
// ===========================================================================

/** The authorization boundary's answer. */
export interface VerifiedExamReplacementContext {
  readonly courseOfferingId: string;
  readonly status: string;
}

/** Every refusal the whole operation can produce. */
export type SetExamExamineeInstructedTraineeRefusalCode =
  | "offering_not_found"
  | "operation_not_allowed"
  | "plan_not_found"
  | "assignment_not_found"
  | "instructed_assignment_not_found"
  | "stale_write"
  | ExamReplacementDecisionRefusalCode;

/** What happened. `PAIRED` covers a first assignment and a replacement alike. */
export type ExamReplacementStatus = "PAIRED" | "UNPAIRED" | "NO_CHANGE";

export type SetExamExamineeInstructedTraineeResult =
  | { readonly ok: true; readonly status: ExamReplacementStatus }
  | { readonly ok: false; readonly code: SetExamExamineeInstructedTraineeRefusalCode };

/** Everything the orchestration needs from the outside world. */
export interface SetExamExamineeInstructedTraineeDeps {
  readonly requireCourseContext: (
    requestedCourseOfferingId: string,
  ) => Promise<VerifiedExamReplacementContext>;
  readonly assertConfigurationAllowed: (status: string) => void;
  readonly findExamPlanByCourseOfferingId: (
    verifiedCourseOfferingId: string,
  ) => Promise<{ readonly id: string } | null>;
  /** ONE assignment, ONLY if it belongs to this plan. */
  readonly findAssignmentForPlan: (
    planId: string,
    assignmentId: string,
  ) => Promise<ExamReplacementAssignmentFacts | null>;
  /** Every EXAMINEE row of that session — the allocation and ambiguity input. */
  readonly listSessionExaminees: (
    sessionId: string,
  ) => Promise<readonly ExamPairingExamineeFacts[]>;
  /** Every INSTRUCTED_TRAINEE row of that session, the edited one included. */
  readonly listSessionInstructedTrainees: (
    sessionId: string,
  ) => Promise<readonly ExamPairingInstructedTraineeFacts[]>;
  /**
   * Apply the whole switch in ONE transaction. Returns `false` when any
   * condition failed, which the caller reports as a stale write — never as a
   * partial success.
   */
  readonly applyReplacement: (command: {
    readonly clear: ExamReplacementClear | null;
    readonly pair: ExamPairingDecision | null;
    readonly examineeAssignmentId: string;
    readonly sessionId: string;
    readonly instructedTraineeAssignmentId: string | null;
  }) => Promise<boolean>;
  readonly isCourseNotFoundError: (error: unknown) => boolean;
  readonly isOperationNotAllowedError: (error: unknown) => boolean;
}

function operationRefusal(
  code: SetExamExamineeInstructedTraineeRefusalCode,
): SetExamExamineeInstructedTraineeResult {
  return Object.freeze({ ok: false as const, code });
}

/**
 * Set the ONE instructed trainee an examinee teaches.
 *
 * ORDER:
 *   1. admin + the EXACT offering;
 *   2. the course-lifecycle WRITE gate on the VERIFIED status;
 *   3. ONE plan lookup on the VERIFIED offering id;
 *   4. ONE PLAN-SCOPED read of the examinee. A row of another course is simply
 *      not found — the scope is the query, not a later comparison;
 *   5. ONE PLAN-SCOPED read of the requested trainee, when one was named;
 *   6. the session's examinee and instructed-trainee sets, read from the
 *      EXAMINEE's own session and never from a submitted one;
 *   7. the pure decision above, which delegates every pairing rule;
 *   8. NO_CHANGE writes nothing at all; otherwise ONE transaction applies both
 *      halves, and a failed condition rolls the whole thing back.
 *
 * Never throws for a modelled outcome. A refusal writes NOTHING, so the pairing
 * the examinee had is still the pairing it has.
 */
export async function setExamExamineeInstructedTraineeWithDeps(
  requestedCourseOfferingId: string,
  examineeAssignmentId: unknown,
  nextInstructedTraineeAssignmentId: unknown,
  deps: SetExamExamineeInstructedTraineeDeps,
): Promise<SetExamExamineeInstructedTraineeResult> {
  let context: VerifiedExamReplacementContext;
  try {
    context = await deps.requireCourseContext(requestedCourseOfferingId);
  } catch (error) {
    if (deps.isCourseNotFoundError(error)) return operationRefusal("offering_not_found");
    throw error;
  }

  try {
    deps.assertConfigurationAllowed(context.status);
  } catch (error) {
    if (deps.isOperationNotAllowedError(error)) {
      return operationRefusal("operation_not_allowed");
    }
    throw error;
  }

  const plan = await deps.findExamPlanByCourseOfferingId(context.courseOfferingId);
  if (plan === null) return operationRefusal("plan_not_found");

  if (!isUsableId(examineeAssignmentId)) return operationRefusal("invalid_input");
  const requestedNext =
    nextInstructedTraineeAssignmentId === null ? null : nextInstructedTraineeAssignmentId;
  if (requestedNext !== null && !isUsableId(requestedNext)) {
    return operationRefusal("invalid_input");
  }

  const examinee = await deps.findAssignmentForPlan(plan.id, examineeAssignmentId);
  if (examinee === null) return operationRefusal("assignment_not_found");

  let next: ExamReplacementAssignmentFacts | null = null;
  if (requestedNext !== null) {
    next = await deps.findAssignmentForPlan(plan.id, requestedNext);
    if (next === null) return operationRefusal("instructed_assignment_not_found");
  }

  // The SESSION comes from the examinee's own row, so this operation cannot be
  // talked into reading or writing a session the manager did not name.
  const [sessionExaminees, sessionInstructedTrainees] = [
    await deps.listSessionExaminees(examinee.sessionId),
    await deps.listSessionInstructedTrainees(examinee.sessionId),
  ];

  const decision = decideExamExamineeInstructedTraineeReplacement({
    examinee,
    next,
    sessionExaminees,
    sessionInstructedTrainees,
  });
  if (!decision.ok) return operationRefusal(decision.code);
  if (decision.kind === "NO_CHANGE") {
    return Object.freeze({ ok: true as const, status: "NO_CHANGE" as const });
  }

  if (decision.kind === "UNPAIR") {
    const applied = await deps.applyReplacement({
      clear: decision.clear,
      pair: null,
      examineeAssignmentId: examinee.assignmentId,
      sessionId: examinee.sessionId,
      instructedTraineeAssignmentId: null,
    });
    return applied
      ? Object.freeze({ ok: true as const, status: "UNPAIRED" as const })
      : operationRefusal("stale_write");
  }

  const applied = await deps.applyReplacement({
    clear: decision.clear,
    pair: decision.pair,
    examineeAssignmentId: examinee.assignmentId,
    sessionId: examinee.sessionId,
    instructedTraineeAssignmentId: next === null ? null : next.assignmentId,
  });
  return applied
    ? Object.freeze({ ok: true as const, status: "PAIRED" as const })
    : operationRefusal("stale_write");
}
