/**
 * EXAM X0 — PURE interface/riding pairing + one-time seed core.
 *
 * PURE by construction: no Prisma, no DB, no clock, no randomness, no env, no
 * IO. Deterministic; never mutates its inputs. Kind/phase types are erased
 * `import type`s from the domain core.
 *
 * WHAT THIS ANSWERS (and only this):
 *  - is a proposed (interface session, riding session) PAIR valid? Interface and
 *    riding are two SEPARATE `ExamSession` rows (phase INTERFACE and RIDING) of
 *    the SAME `INTERFACE_RIDING` kind, belonging to the SAME plan, where the
 *    riding row links to its interface partner and the interface row carries no
 *    link.
 *  - the OPTIONAL, ONE-TIME seed that copies examinees / horses / supervising
 *    instructors / examiner set from the interface session to a new riding
 *    session. The copied values are INDEPENDENT after creation (divergence is
 *    allowed); this core models a one-shot copy and NEVER a permanent sync — the
 *    seed result shares no mutable reference with the source.
 *
 * It does NOT create sessions, does NOT persist anything, does NOT enforce any
 * ongoing synchronization, and touches no schema/DB/UI.
 */
import type { ExamKind, ExamPhase } from "./exam-domain-core";

// ===========================================================================
// Pairing validation
// ===========================================================================

/** The identity/shape fields of one session relevant to interface/riding
 * pairing. */
export interface PairSessionRef {
  readonly sessionId: string;
  readonly planId: string;
  readonly kind: ExamKind;
  readonly phase: ExamPhase | null;
  /** The interface partner this session links to (RIDING only), else null. */
  readonly interfaceSessionId: string | null;
}

/** Stable, non-PII interface/riding pairing issue codes. */
export type ExamInterfaceRidingIssueCode =
  | "EX-IR-NOT-INTERFACE-RIDING-KIND"
  | "EX-IR-PHASE-DUPLICATE"
  | "EX-IR-CROSS-PLAN"
  | "EX-IR-INTERFACE-HAS-LINK"
  | "EX-IR-RIDING-LINK-MISSING"
  | "EX-IR-RIDING-LINK-TO-NON-INTERFACE";

/** Canonical Hebrew messages. Exhaustive by mapped type. */
export const EXAM_INTERFACE_RIDING_MESSAGES: Readonly<
  Record<ExamInterfaceRidingIssueCode, string>
> = Object.freeze({
  "EX-IR-NOT-INTERFACE-RIDING-KIND": "צימוד ממשק-רכיבה מותר רק לבחינות מסוג ממשק ורכיבה",
  "EX-IR-PHASE-DUPLICATE": "צימוד ממשק-רכיבה מחייב מפגש ממשק אחד ומפגש רכיבה אחד",
  "EX-IR-CROSS-PLAN": "לא ניתן לצמד מפגשים משתי תכניות בחינות שונות",
  "EX-IR-INTERFACE-HAS-LINK": "מפגש הממשק אינו יכול להתקשר למפגש ממשק אחר",
  "EX-IR-RIDING-LINK-MISSING": "מפגש הרכיבה חייב להתקשר למפגש הממשק המצומד",
  "EX-IR-RIDING-LINK-TO-NON-INTERFACE": "קישור מפגש הרכיבה אינו מצביע על מפגש הממשק המצומד",
});

export interface ExamInterfaceRidingIssue {
  readonly code: ExamInterfaceRidingIssueCode;
  readonly message: string;
}

export interface ExamInterfaceRidingValidationResult {
  readonly ok: boolean;
  readonly issues: readonly ExamInterfaceRidingIssue[];
}

function irIssue(code: ExamInterfaceRidingIssueCode): ExamInterfaceRidingIssue {
  return { code, message: EXAM_INTERFACE_RIDING_MESSAGES[code] };
}

function irResult(
  issues: readonly ExamInterfaceRidingIssue[],
): ExamInterfaceRidingValidationResult {
  return Object.freeze({ ok: issues.length === 0, issues: Object.freeze([...issues]) });
}

/**
 * Validate an interface/riding PAIR of two sessions. `first` and `second` may be
 * given in either order — the function identifies which is INTERFACE and which
 * is RIDING by phase. Returns all applicable issues in a stable order.
 *
 * Rules:
 *  - both sessions must be kind `INTERFACE_RIDING`;
 *  - exactly one must be phase INTERFACE and one phase RIDING (two of the same
 *    phase is invalid);
 *  - both must belong to the same `planId` (no cross-plan pairing);
 *  - the INTERFACE session must not carry an `interfaceSessionId`;
 *  - the RIDING session's `interfaceSessionId` must equal the INTERFACE
 *    session's `sessionId` (present, and pointing at the interface partner).
 */
export function validateInterfaceRidingPair(
  first: PairSessionRef,
  second: PairSessionRef,
): ExamInterfaceRidingValidationResult {
  const issues: ExamInterfaceRidingIssue[] = [];

  if (first.kind !== "INTERFACE_RIDING" || second.kind !== "INTERFACE_RIDING") {
    issues.push(irIssue("EX-IR-NOT-INTERFACE-RIDING-KIND"));
  }

  // Identify the interface and riding members by phase.
  let interfaceSession: PairSessionRef | null = null;
  let ridingSession: PairSessionRef | null = null;
  if (first.phase === "INTERFACE") interfaceSession = first;
  else if (first.phase === "RIDING") ridingSession = first;
  if (second.phase === "INTERFACE") {
    if (interfaceSession === null) interfaceSession = second;
  } else if (second.phase === "RIDING") {
    if (ridingSession === null) ridingSession = second;
  }

  if (interfaceSession === null || ridingSession === null) {
    // Not exactly one INTERFACE and one RIDING.
    issues.push(irIssue("EX-IR-PHASE-DUPLICATE"));
  }

  if (first.planId !== second.planId) {
    issues.push(irIssue("EX-IR-CROSS-PLAN"));
  }

  if (interfaceSession !== null && isPresent(interfaceSession.interfaceSessionId)) {
    issues.push(irIssue("EX-IR-INTERFACE-HAS-LINK"));
  }

  if (interfaceSession !== null && ridingSession !== null) {
    if (!isPresent(ridingSession.interfaceSessionId)) {
      issues.push(irIssue("EX-IR-RIDING-LINK-MISSING"));
    } else if (ridingSession.interfaceSessionId !== interfaceSession.sessionId) {
      issues.push(irIssue("EX-IR-RIDING-LINK-TO-NON-INTERFACE"));
    }
  }

  return irResult(issues);
}

function isPresent(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

// ===========================================================================
// One-time seed (interface → riding)
// ===========================================================================

/** The seedable data on the interface session. */
export interface InterfaceSeedSource {
  readonly examineeIds: readonly string[];
  readonly horseIds: readonly string[];
  readonly supervisorIds: readonly string[];
  readonly examinerSetId: string | null;
}

/** Which fields to copy in the one-time seed. Any omitted/false field is NOT
 * copied — the corresponding riding value stays empty/null. */
export interface InterfaceSeedOptions {
  readonly copyExaminees: boolean;
  readonly copyHorses: boolean;
  readonly copySupervisors: boolean;
  readonly copyExaminerSet: boolean;
}

/** The independent, freshly-copied riding seed result. */
export interface RidingSeedResult {
  readonly examineeIds: readonly string[];
  readonly horseIds: readonly string[];
  readonly supervisorIds: readonly string[];
  readonly examinerSetId: string | null;
}

/**
 * Produce a ONE-TIME riding seed from an interface session. Each requested list
 * is COPIED into a brand-new array (via `slice`), so the result shares NO
 * mutable reference with the source: mutating the source afterward cannot affect
 * the seed, and vice versa — there is no permanent synchronization. Non-copied
 * fields are empty/null. Pure; never mutates the source.
 */
export function seedRidingFromInterface(
  source: InterfaceSeedSource,
  options: InterfaceSeedOptions,
): RidingSeedResult {
  return Object.freeze({
    examineeIds: options.copyExaminees ? Object.freeze(source.examineeIds.slice()) : Object.freeze([]),
    horseIds: options.copyHorses ? Object.freeze(source.horseIds.slice()) : Object.freeze([]),
    supervisorIds: options.copySupervisors
      ? Object.freeze(source.supervisorIds.slice())
      : Object.freeze([]),
    examinerSetId: options.copyExaminerSet ? source.examinerSetId : null,
  });
}
