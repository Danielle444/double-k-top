/**
 * EX-PAIR-BE-MVP — the PURE decision and orchestration for PAIRING one stored
 * INSTRUCTED_TRAINEE assignment with one stored EXAMINEE assignment of the SAME
 * exam session, and for UNPAIRING it again.
 *
 * PURE by construction: no Prisma, no DB, no transaction, no clock, no
 * randomness, no env, no auth/session/cookie, no capability, no filesystem, no
 * network, no Next, no `server-only`, no `"use server"`. The only import is a
 * TYPE-ONLY one for the committed role vocabulary, which is erased at compile
 * time; every effect this operation needs arrives through the injected
 * dependency bundle, so the ORDER in which authorization, lifecycle gating, plan
 * resolution, assignment verification and the write happen is stated once, here,
 * and is testable without a database.
 *
 * WHAT THIS ANSWERS (and only this):
 *  - may these two stored assignments be paired at all?
 *  - which `pairingIndex` must the pair carry — an index the examinee ALREADY
 *    owns, or a newly allocated one?
 *  - what must the write be CONDITIONAL on, so a concurrent change is refused
 *    rather than silently overwritten?
 *  - and which stable, non-echoing outcome describes each way it can fail?
 *
 * WHAT THIS DELIBERATELY DOES NOT DO:
 *  - it CREATES, EDITS AND DELETES NOTHING. No assignment, session, definition,
 *    plan, supervisor or break is created or removed, and no field other than
 *    `pairingIndex` is ever written — there is no dependency capable of either;
 *  - it OWNS NO POLICY TABLE. Which offering statuses may be configured is the
 *    committed course operation policy's decision, reached through
 *    `assertConfigurationAllowed`;
 *  - it PERFORMS NO IO and knows nothing of a transaction client, a row or a
 *    query. The two write dependencies are opaque promises;
 *  - it DERIVES NO SCHEDULE. No wave layout, no personal slot, no end time, no
 *    break and no conflict is computed, and none is an input;
 *  - it PUBLISHES NOTHING and NOTIFIES NOBODY.
 *
 * ===========================================================================
 * WHY PAIRING EXISTS AT ALL
 * ===========================================================================
 * An advanced-instruction session may hold MORE THAN ONE examinee. The
 * instructed trainee — the person BEING TAUGHT in the block — belongs to exactly
 * ONE of them, and nothing in the stored row says which: the session, the date
 * and the definition are shared by everybody in it.
 *
 * `ExamAssignment.pairingIndex` is that missing statement. Two rows carrying the
 * SAME index within one session are one pair; the number itself is an opaque
 * label with no ordering, timing or display meaning, and it is NOT `orderIndex`
 * — `orderIndex` is the stored position within the session, drives the examinee
 * wave layout, and is never read, written or reused as a pairing label by any
 * statement in this slice.
 *
 * ===========================================================================
 * THE CALLER SUPPLIES A REQUEST, NEVER A GRANT — AND NEVER AN INDEX
 * ===========================================================================
 * The only arguments besides the dependency bundle are a REQUESTED
 * `courseOfferingId`, the id of the instructed-trainee assignment, and either
 * the id of the examinee assignment or `null` to unpair.
 *
 * THE ABSENT PARAMETER IS THE POINT: there is NO `pairingIndex` parameter and no
 * object field through which one could arrive. A client never chooses the
 * number; it is read from the examinee's own row or allocated here, from facts
 * the server read. There is likewise no parameter for a `sessionId`, a `planId`,
 * a `studentId`, a name, a timestamp or an actor id — not "ignored", but ABSENT
 * from every type in this module, so no future caller can pass one.
 *
 * The session is DERIVED: it is the session of the instructed-trainee row the
 * server resolved. The plan is DERIVED: it is the plan of the DB-verified
 * offering. The requested offering id is used for exactly one thing — asking the
 * course boundary to verify it — and is never read again, so a caller cannot be
 * authorized for one offering while the write lands on another.
 *
 * ===========================================================================
 * THE LOCKED ORDER, AND WHY EACH STEP PRECEDES THE NEXT
 * ===========================================================================
 *   1. requireCourseContext(requested id)      — admin + exact-offering boundary
 *   2. assertConfigurationAllowed(status)      — course-lifecycle gate
 *   3. normalize the two id arguments          — fail closed, BEFORE any query
 *   4. findExamPlanByCourseOfferingId(id)      — VERIFIED offering id only
 *   5. no plan                                 -> plan_not_found
 *   6. findAssignmentForPlan(plan, instructed) — PLAN-SCOPED verification
 *   7. no row                                  -> instructed_assignment_not_found
 *   8. findAssignmentForPlan(plan, examinee)   — only when pairing
 *   9. no row                                  -> examinee_assignment_not_found
 *  10. findSessionExaminees(plan, session)     — the session's EXAMINEE facts
 *  11. decide, purely, from those facts alone
 *  12. no change                               -> NO_CHANGE, with ZERO writes
 *  13. the ONE conditional write (pair or unpair)
 *  14. zero rows changed                       -> stale_write, never a retry
 *
 * The consequences are the point:
 *  - NOTHING about an exam is read for a course the actor may not access, so
 *    neither plan, session nor assignment existence can be probed by an
 *    unauthorized caller;
 *  - the lifecycle gate runs BEFORE any exam query, so an ARCHIVED offering is
 *    refused without a single exam read;
 *  - a malformed request reaches no query at all;
 *  - every read is PLAN-SCOPED, so an assignment of another course resolves to
 *    nothing and is refused indistinguishably from an unknown id — a
 *    distinguishable answer would turn this write path into an existence oracle
 *    over every other course's exam schedule;
 *  - no write dependency runs when any verification fails, so a rejected request
 *    leaves no half-written pair.
 *
 * ===========================================================================
 * THE PAIRING INDEX: REUSED WHEN IT EXISTS, ALLOCATED WHEN IT DOES NOT
 * ===========================================================================
 * When pairing to an examinee:
 *
 *  1. if that examinee ALREADY carries a positive `pairingIndex`, and NO OTHER
 *     examinee of the session carries the same one, that index is REUSED — this
 *     is what lets SEVERAL instructed trainees accompany one examinee, which is
 *     an ordinary product case and never a conflict;
 *  2. if that examinee carries NO index, the SMALLEST POSITIVE INTEGER not
 *     currently held by any examinee of the session is allocated, and written to
 *     the examinee and the instructed trainee together;
 *  3. if the examinee's stored index is AMBIGUOUS — shared with another examinee
 *     of the same session, or a non-positive value that this module's allocator
 *     could never have produced — the operation FAILS CLOSED and writes nothing.
 *     Guessing which of two examinees "really" owns an index would silently
 *     author a pairing nobody wrote.
 *
 * ALLOCATION IS SCOPED TO EXAMINEES, and to positive integers only. An
 * instructed trainee's index is a COPY of an examinee's, so counting instructed
 * rows as owners would leak the same number twice for no reason. Indices are
 * never compacted, never renumbered and never reused across sessions: the number
 * is a label within one session and nothing more.
 *
 * A KNOWN, ACCEPTED EDGE, stated rather than discovered later: if an examinee
 * row is deleted (a different slice) while an instructed trainee still carries
 * its index, that index becomes ORPHANED, and a later allocation may hand the
 * same number to a new examinee — at which point the orphan reads as paired to
 * them. Closing that would mean either clearing dependants on delete or
 * allocating against instructed rows too, and both are product decisions beyond
 * this MVP. Nothing here pretends otherwise.
 *
 * ===========================================================================
 * UNPAIRING TOUCHES EXACTLY ONE ROW
 * ===========================================================================
 * Unpairing clears `pairingIndex` on the INSTRUCTED-TRAINEE row only. The
 * examinee's index is deliberately LEFT ALONE: it may still be held by other
 * instructed trainees, it is the examinee's own stable label, and clearing it
 * would silently unpair people this request never named.
 *
 * There is no dependency here that can clear an examinee's index at all, so this
 * is structural rather than a rule someone has to remember.
 *
 * ===========================================================================
 * A NO-OP IS A SUCCESS, AND WRITES NOTHING
 * ===========================================================================
 * Pairing a trainee to the examinee they are ALREADY paired with, and unpairing
 * one who carries no index, are both requests that are ALREADY SATISFIED. Each
 * returns `NO_CHANGE` with the index that is actually stored, and issues ZERO
 * write statements. Reporting a conflict instead would show an error to a
 * manager who merely double-clicked.
 *
 * ===========================================================================
 * THE CONCURRENT WRITER, AND WHY EVERY WRITE IS CONDITIONAL
 * ===========================================================================
 * The reads and the write are separate statements, so there is a window between
 * them. Every write therefore carries the state the decision was made from as a
 * CONDITION: the instructed row is changed only while it still holds the index
 * that was read, and the examinee row is allocated an index only while it still
 * holds none.
 *
 * A zero write count means exactly one thing: another manager changed the
 * pairing in the gap, and this call's decision was made from a view of the world
 * that no longer holds. That is `stale_write`, and it is NOT retried — retrying
 * would overwrite their newer pairing with this call's older decision. The
 * honest answer tells the manager to reload.
 *
 * ===========================================================================
 * ONLY TWO KNOWN FAILURES ARE CLASSIFIED — EVERYTHING ELSE PROPAGATES
 * ===========================================================================
 * Exactly two injected predicates may convert a thrown error into a refusal: the
 * course not-found and the lifecycle denial. Every other throw LEAVES THIS
 * MODULE UNCHANGED. There is no `unexpected` code and no catch-all `catch`: a
 * generic failure code would let a real defect render as an ordinary form error
 * that nobody investigates.
 *
 * CRITICALLY, an admin boundary denies by REDIRECTING (a Next `NEXT_REDIRECT`
 * throw). Because each classifier is asked about one specific error shape and
 * anything unrecognized is re-thrown, a redirect passes straight through and the
 * framework still performs it. A redirect must never be translated into a
 * refusal — an admin who is simply not logged in would then see "not found"
 * instead of the login page.
 *
 * ===========================================================================
 * NO PII, EVER
 * ===========================================================================
 * Nothing in this module models a person. There is no name, no identity number,
 * no phone, no parent contact, no group and no free text in any input, decision
 * or result — not even a `studentId`. The decision runs on opaque assignment
 * ids, a session id, two role strings and a handful of integers, and the result
 * carries a status and a number. A value this module cannot see is a value it
 * cannot leak.
 */
// TYPE-ONLY, and erased at compile time, so the module's purity is unaffected:
// it exists solely so the two role literals below are checked against the
// committed role vocabulary rather than being stale strings of their own.
import type { ExamAssignmentRole } from "./exam-domain-core";

/**
 * The two roles this operation reasons about, fixed here and never derived from
 * a caller. Typed as the committed union members, so a future rename of the role
 * vocabulary cannot leave a stale literal behind in this file.
 */
const ROLE_INSTRUCTED_TRAINEE = "INSTRUCTED_TRAINEE" satisfies ExamAssignmentRole;
const ROLE_EXAMINEE = "EXAMINEE" satisfies ExamAssignmentRole;

// ===========================================================================
// The normalized facts the decision runs on
// ===========================================================================

/**
 * One stored assignment, as this operation is allowed to see it.
 *
 * Deliberately FOUR fields. There is no `studentId`, no name, no horse, no
 * topic, no discipline, no note, no `orderIndex` and no timestamp: none of them
 * can change the answer, and a field this module cannot read is a decision it
 * cannot quietly start making.
 *
 * `role` is a plain `string` rather than the generated enum, for the same purity
 * reason the course status is: the checks below compare it to the two fixed
 * literals and fail closed on anything else, so an unrecognized role is refused
 * rather than waved through.
 *
 * `pairingIndex` admits `null` because the column does.
 */
export interface ExamPairingAssignmentFacts {
  readonly assignmentId: string;
  readonly sessionId: string;
  readonly role: string;
  readonly pairingIndex: number | null;
}

/**
 * One EXAMINEE row of the session, reduced to the only two things allocation and
 * ambiguity detection need: which row it is, and which index it holds.
 *
 * The id is what distinguishes "the examinee we are pairing to already holds
 * index 2" from "a DIFFERENT examinee holds index 2" — the first is a reuse, the
 * second is an ambiguity that must fail closed.
 */
export interface ExamPairingExamineeFacts {
  readonly assignmentId: string;
  readonly pairingIndex: number | null;
}

/**
 * Everything the pure decision needs, and nothing else.
 *
 * `examinee === null` IS the unpair request: there is no separate mode flag, so
 * the two operations cannot disagree about which one was asked for.
 *
 * `sessionExaminees` is the complete set of EXAMINEE rows of the instructed
 * trainee's session — unordered, and treated as a set. When unpairing it is
 * irrelevant and may be empty.
 */
export interface ExamPairingDecisionInput {
  readonly instructed: ExamPairingAssignmentFacts;
  readonly examinee: ExamPairingAssignmentFacts | null;
  readonly sessionExaminees: readonly ExamPairingExamineeFacts[];
}

// ===========================================================================
// The decision
// ===========================================================================

/** Every way the PURE decision — as opposed to the orchestration — can refuse. */
export type ExamPairingDecisionRefusalCode =
  | "invalid_input"
  | "instructed_role_mismatch"
  | "examinee_role_mismatch"
  | "different_sessions"
  | "ambiguous_pairing_index";

/**
 * What the caller must do about it.
 *
 * FIVE arms, so each one carries exactly the fields it needs and no others: a
 * single arm with optional fields would be present-but-`undefined` on most
 * paths, which breaks the JSON round trip the exam module's results are held to
 * and invites a writer to read a field that means nothing on that branch.
 *
 *  - `NO_CHANGE` — the request is already satisfied; write NOTHING;
 *  - `UNPAIR` — clear the instructed row's index, conditional on it still
 *    holding exactly `expectedInstructedPairingIndex`;
 *  - `PAIR_WITH_EXISTING_INDEX` — the examinee already owns the index; write
 *    ONLY the instructed row, and only while the examinee still holds it;
 *  - `PAIR_WITH_NEW_INDEX` — the index was allocated here; write it to BOTH
 *    rows, and only while the examinee still holds none;
 *  - `REFUSE` — a fixed code, and no write of any kind.
 */
export type ExamPairingDecision =
  | {
      readonly kind: "NO_CHANGE";
      readonly pairingIndex: number | null;
    }
  | {
      readonly kind: "UNPAIR";
      readonly expectedInstructedPairingIndex: number;
    }
  | {
      readonly kind: "PAIR_WITH_EXISTING_INDEX";
      readonly pairingIndex: number;
      readonly expectedInstructedPairingIndex: number | null;
      /** The index the examinee must STILL hold for the write to apply. */
      readonly expectedExamineePairingIndex: number;
    }
  | {
      readonly kind: "PAIR_WITH_NEW_INDEX";
      readonly pairingIndex: number;
      readonly expectedInstructedPairingIndex: number | null;
      /** Allocation applies only while the examinee still holds NO index. */
      readonly expectedExamineePairingIndex: null;
    }
  | {
      readonly kind: "REFUSE";
      readonly code: ExamPairingDecisionRefusalCode;
    };

/** A usable pairing label: an integer strictly greater than zero. */
function isPairingIndex(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/** A usable opaque id: a non-empty, non-blank string. */
function isUsableId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Are these facts structurally usable at all? Fail closed on anything that is
 * not a plain, non-blank id or a storable index.
 *
 * `pairingIndex` must be `null` or an INTEGER here — not necessarily a positive
 * one. A non-positive stored value is a separate question, answered differently
 * for the two roles below: it is still clearable on an instructed row, and it is
 * an ambiguity on an examinee row.
 */
function areFactsUsable(facts: ExamPairingAssignmentFacts): boolean {
  if (!isUsableId(facts.assignmentId)) return false;
  if (!isUsableId(facts.sessionId)) return false;
  if (typeof facts.role !== "string") return false;
  if (facts.pairingIndex === null) return true;
  return typeof facts.pairingIndex === "number" && Number.isInteger(facts.pairingIndex);
}

/**
 * The smallest positive integer no EXAMINEE of the session currently holds.
 *
 * Counts POSITIVE INTEGERS only, so a stray `0`, a negative value or a
 * non-integer can never reserve a label; and it is a linear scan from 1 rather
 * than "max + 1", so a gap left by an earlier pairing is reused instead of the
 * numbers drifting upward forever. A session holds a handful of examinees, so
 * the scan is bounded by that handful plus one.
 */
function allocatePairingIndex(examinees: readonly ExamPairingExamineeFacts[]): number {
  const used = new Set<number>();
  for (const examinee of examinees) {
    if (isPairingIndex(examinee.pairingIndex)) used.add(examinee.pairingIndex);
  }
  let candidate = 1;
  while (used.has(candidate)) candidate += 1;
  return candidate;
}

/**
 * Does an examinee OTHER than `ownerAssignmentId` already hold `index`?
 *
 * This is what makes "two examinees must never share a pairing index" an
 * enforced rule rather than an intention: a shared index is refused, and an
 * index another examinee owns is never allocated.
 */
function isIndexHeldByAnotherExaminee(
  examinees: readonly ExamPairingExamineeFacts[],
  ownerAssignmentId: string,
  index: number,
): boolean {
  return examinees.some(
    (examinee) =>
      examinee.assignmentId !== ownerAssignmentId && examinee.pairingIndex === index,
  );
}

/**
 * Decide, purely and totally. Mutates nothing — not the input, not the examinee
 * array, not one of its entries — reads no clock, and returns a FROZEN,
 * JSON-safe object.
 *
 * Every refusal is reached BEFORE any write is described, so a refused decision
 * cannot be partially applied by a caller that ignores `kind`.
 */
export function decideExamInstructedTraineePairing(
  input: ExamPairingDecisionInput,
): ExamPairingDecision {
  const instructed = input.instructed;

  // Structural usability first: an unusable fact cannot be compared, and cannot
  // become an exact write condition either.
  if (!areFactsUsable(instructed)) {
    return refuseDecision("invalid_input");
  }

  // The row this request names must ACTUALLY be an instructed trainee. Anything
  // else — an examinee, an unknown role string, a renamed vocabulary — is
  // refused: this operation writes the instructed side of a pair and nothing
  // else.
  if (instructed.role !== ROLE_INSTRUCTED_TRAINEE) {
    return refuseDecision("instructed_role_mismatch");
  }

  // ---------------------------------------------------------------------
  // UNPAIR — `examinee === null` is the request itself.
  // ---------------------------------------------------------------------
  if (input.examinee === null) {
    if (instructed.pairingIndex === null) {
      // Already unpaired. Nothing is written.
      return freezeDecision({ kind: "NO_CHANGE" as const, pairingIndex: null });
    }
    return freezeDecision({
      kind: "UNPAIR" as const,
      // The EXACT stored value, so the write applies only while it still holds
      // it. A non-positive stored value is still clearable — it is an index this
      // module would never have written, and leaving it in place would be worse.
      expectedInstructedPairingIndex: instructed.pairingIndex,
    });
  }

  // ---------------------------------------------------------------------
  // PAIR
  // ---------------------------------------------------------------------
  const examinee = input.examinee;

  if (!areFactsUsable(examinee)) {
    return refuseDecision("invalid_input");
  }

  // One row cannot be both halves of a pair. The role checks already make this
  // unreachable through a real reader; it is stated anyway, because the facts
  // are injected and a defect that produced them must not be able to write a
  // self-pairing row.
  if (examinee.assignmentId === instructed.assignmentId) {
    return refuseDecision("invalid_input");
  }

  if (examinee.role !== ROLE_EXAMINEE) {
    return refuseDecision("examinee_role_mismatch");
  }

  // Pairing is scoped to ONE session. Two rows of different sessions are never a
  // pair, however similar their dates or definitions look.
  if (examinee.sessionId !== instructed.sessionId) {
    return refuseDecision("different_sessions");
  }

  // The examinee already owns a usable label: REUSE it, provided it is
  // unambiguous. Reuse is what lets several instructed trainees accompany one
  // examinee.
  if (isPairingIndex(examinee.pairingIndex)) {
    if (
      isIndexHeldByAnotherExaminee(
        input.sessionExaminees,
        examinee.assignmentId,
        examinee.pairingIndex,
      )
    ) {
      return refuseDecision("ambiguous_pairing_index");
    }
    if (instructed.pairingIndex === examinee.pairingIndex) {
      // Already paired with exactly this examinee's index. Nothing is written.
      return freezeDecision({
        kind: "NO_CHANGE" as const,
        pairingIndex: examinee.pairingIndex,
      });
    }
    return freezeDecision({
      kind: "PAIR_WITH_EXISTING_INDEX" as const,
      pairingIndex: examinee.pairingIndex,
      expectedInstructedPairingIndex: instructed.pairingIndex,
      expectedExamineePairingIndex: examinee.pairingIndex,
    });
  }

  // A stored value that is neither `null` nor a positive integer is an index
  // this module could not have written. FAIL CLOSED rather than reusing it or
  // overwriting it: both would be a guess.
  if (examinee.pairingIndex !== null) {
    return refuseDecision("ambiguous_pairing_index");
  }

  // The examinee has no label yet: allocate the smallest positive integer no
  // examinee of this session holds, and write it to BOTH rows.
  const allocated = allocatePairingIndex(input.sessionExaminees);
  return freezeDecision({
    kind: "PAIR_WITH_NEW_INDEX" as const,
    pairingIndex: allocated,
    expectedInstructedPairingIndex: instructed.pairingIndex,
    expectedExamineePairingIndex: null,
  });
}

function refuseDecision(code: ExamPairingDecisionRefusalCode): ExamPairingDecision {
  return Object.freeze({ kind: "REFUSE" as const, code });
}

function freezeDecision(decision: ExamPairingDecision): ExamPairingDecision {
  return Object.freeze(decision);
}

// ===========================================================================
// The injected boundary
// ===========================================================================

/**
 * The course context this operation may act on, AFTER the boundary verified it.
 *
 * Deliberately TWO fields. A name, a level, an activity year or a date window
 * would be data this operation has no business reading, and a generated Prisma
 * type here would end this module's purity. `status` is a plain `string` for the
 * same reason; the committed policy the gate consults is default-deny, so an
 * unrecognized status is refused rather than waved through.
 */
export interface VerifiedExamPairingCourseContext {
  readonly courseOfferingId: string;
  readonly status: string;
}

/**
 * The plan both assignments must live under: its id and nothing else.
 *
 * No publication state, no sessions, no definitions, no offering relation, no
 * timestamps. Pairing does not need to know whether the plan is published, and
 * must not be able to make a decision from data it should not have read.
 */
export interface ResolvedExamPairingPlan {
  readonly id: string;
}

/** The write this module issues to pair two rows. Never built by a caller. */
export interface ExamPairingWriteCommand {
  readonly planId: string;
  readonly sessionId: string;
  readonly instructedAssignmentId: string;
  readonly expectedInstructedPairingIndex: number | null;
  readonly examineeAssignmentId: string;
  /** `null` means "the examinee must still hold NO index" (an allocation). */
  readonly expectedExamineePairingIndex: number | null;
  readonly pairingIndex: number;
}

/** The write this module issues to unpair one row. Never built by a caller. */
export interface ExamUnpairWriteCommand {
  readonly planId: string;
  readonly sessionId: string;
  readonly instructedAssignmentId: string;
  readonly expectedInstructedPairingIndex: number;
}

/**
 * The complete injected boundary.
 *
 * Note what is ABSENT and therefore unrepresentable: there is no dependency that
 * can create, delete or reorder an assignment, write `orderIndex`, `studentId`,
 * `horseName`, `instructionTopic`, `discipline` or `notes`, create or publish a
 * plan or a session, clear an EXAMINEE's index, read a person row, resolve a
 * capability, send a notification or read another course. No dependency accepts
 * a pairing index from the caller, and none accepts a session or plan id the
 * server did not derive.
 *
 * The two predicates take `unknown` and return a boolean: this module never
 * inspects, unwraps, logs or echoes a raw error, so no database detail and no
 * submitted value can leak into a result through them.
 */
export interface SetExamInstructedTraineePairingDeps {
  /**
   * Authorize the actor and verify the REQUESTED offering exists. May throw the
   * project's typed not-found, and may REDIRECT for an unauthenticated or
   * non-admin caller — the redirect must reach the framework untouched.
   */
  requireCourseContext(
    requestedCourseOfferingId: string,
  ): Promise<VerifiedExamPairingCourseContext>;

  /** Gate the mutation on the VERIFIED offering status. Throws to deny. */
  assertConfigurationAllowed(status: string): void;

  /** Find the plan of the VERIFIED offering. `null` means "no plan exists". */
  findExamPlanByCourseOfferingId(
    verifiedCourseOfferingId: string,
  ): Promise<ResolvedExamPairingPlan | null>;

  /**
   * Verify ONE assignment EXISTS UNDER THE GIVEN PLAN and report its facts.
   *
   * The plan id is the SERVER-RESOLVED one, and there is no variant of this
   * dependency that omits it. `null` covers both an assignment that does not
   * exist and one belonging to another plan — the caller may not learn which.
   */
  findAssignmentForPlan(
    planId: string,
    assignmentId: string,
  ): Promise<ExamPairingAssignmentFacts | null>;

  /**
   * Every EXAMINEE row of ONE session under the GIVEN PLAN, reduced to its id
   * and its pairing index. Used for allocation and ambiguity detection only.
   */
  findSessionExaminees(
    planId: string,
    sessionId: string,
  ): Promise<readonly ExamPairingExamineeFacts[]>;

  /**
   * The ATOMIC pairing write: apply the command's index to the instructed row —
   * and, when the command allocates one, to the examinee row as well — with
   * every condition evaluated by the database inside ONE transaction.
   *
   * Returns whether the pair was actually written. `false` means a concurrent
   * writer moved one of the two rows, and the orchestration reports that rather
   * than retrying. Called AT MOST ONCE per invocation.
   */
  pairInstructedTrainee(command: ExamPairingWriteCommand): Promise<boolean>;

  /**
   * The single-row unpair write: clear the instructed row's index, and ONLY
   * while it still holds the expected one. The examinee's index is not an
   * argument and cannot be cleared through this boundary.
   *
   * Returns whether a row was actually changed. Called AT MOST ONCE per
   * invocation.
   */
  unpairInstructedTrainee(command: ExamUnpairWriteCommand): Promise<boolean>;

  /** Is this throw "the requested offering does not exist"? */
  isCourseNotFoundError(error: unknown): boolean;

  /** Is this throw "the offering's lifecycle forbids this operation"? */
  isOperationNotAllowedError(error: unknown): boolean;
}

// ===========================================================================
// The result model
// ===========================================================================

/** Every way this operation can be refused. */
export type SetExamInstructedTraineePairingRefusalCode =
  | "offering_not_found"
  | "operation_not_allowed"
  | "plan_not_found"
  | "invalid_input"
  | "instructed_assignment_not_found"
  | "examinee_assignment_not_found"
  | "instructed_role_mismatch"
  | "examinee_role_mismatch"
  | "different_sessions"
  | "ambiguous_pairing_index"
  | "stale_write";

/** What THIS call did. */
export type ExamPairingStatus = "PAIRED" | "UNPAIRED" | "NO_CHANGE";

/**
 * A discriminated, JSON-safe, frozen result.
 *
 * The SUCCESS arm carries what this call did and the index the instructed row
 * now holds — `null` after an unpair. NOTHING ELSE: no assignment id, no session
 * id, no plan id, no course offering id, no student id, no actor id, no
 * timestamp, no raw error and no database detail. Nothing in either arm is a
 * `Date`, Map, Set, BigInt, Error or class instance.
 */
export type SetExamInstructedTraineePairingResult =
  | {
      readonly ok: true;
      readonly status: ExamPairingStatus;
      readonly pairingIndex: number | null;
    }
  | {
      readonly ok: false;
      readonly code: SetExamInstructedTraineePairingRefusalCode;
    };

function refuse(
  code: SetExamInstructedTraineePairingRefusalCode,
): SetExamInstructedTraineePairingResult {
  return Object.freeze({ ok: false as const, code });
}

function succeed(
  status: ExamPairingStatus,
  pairingIndex: number | null,
): SetExamInstructedTraineePairingResult {
  return Object.freeze({ ok: true as const, status, pairingIndex });
}

// ===========================================================================
// The orchestration
// ===========================================================================

/**
 * Pair ONE already-existing INSTRUCTED_TRAINEE assignment with ONE
 * already-existing EXAMINEE assignment of the SAME session, in the
 * already-existing plan of one authorized, lifecycle-permitted course offering —
 * or, with `examineeAssignmentId === null`, unpair it.
 *
 * The order is the safety contract, and it is enforced by construction: each
 * step's output is the next step's only input, so no step can be reordered
 * without the verified offering id, the plan id or the session id becoming
 * unavailable.
 *
 * Each `try` wraps EXACTLY ONE dependency call and asks EXACTLY ONE classifier.
 * Nothing is caught broadly, and an unrecognized error is re-thrown with its
 * identity intact — including a `NEXT_REDIRECT` from the authorization boundary.
 */
export async function setExamInstructedTraineePairingWithDeps(
  courseOfferingId: string,
  instructedTraineeAssignmentId: unknown,
  examineeAssignmentId: unknown,
  deps: SetExamInstructedTraineePairingDeps,
): Promise<SetExamInstructedTraineePairingResult> {
  // 1. Authorization + exact-offering verification FIRST. Nothing about exams,
  //    plans, sessions or assignments is touched before this resolves.
  let context: VerifiedExamPairingCourseContext;
  try {
    context = await deps.requireCourseContext(courseOfferingId);
  } catch (error) {
    if (deps.isCourseNotFoundError(error)) {
      return refuse("offering_not_found");
    }
    throw error;
  }

  // 2. The course-lifecycle gate, on the VERIFIED status. Runs before any exam
  //    query, so an ARCHIVED offering costs zero exam reads and zero writes.
  try {
    deps.assertConfigurationAllowed(context.status);
  } catch (error) {
    if (deps.isOperationNotAllowedError(error)) {
      return refuse("operation_not_allowed");
    }
    throw error;
  }

  // 3. The two id arguments, FAIL-CLOSED and BEFORE a single exam row is read,
  //    so a malformed request cannot be used to probe which ids exist. A
  //    TypeScript annotation is erased at runtime and a future `"use server"`
  //    caller receives whatever the network sent, so both are re-checked here.
  //
  //    `null` is the ONLY accepted non-string, and it means UNPAIR. `undefined`,
  //    a number, an object or a blank string are refused rather than read as an
  //    accidental unpair request.
  if (!isUsableId(instructedTraineeAssignmentId)) {
    return refuse("invalid_input");
  }
  if (examineeAssignmentId !== null && !isUsableId(examineeAssignmentId)) {
    return refuse("invalid_input");
  }
  const instructedId = instructedTraineeAssignmentId.trim();
  const examineeId = examineeAssignmentId === null ? null : examineeAssignmentId.trim();

  // The requested, unverified offering id is never read again from here on.
  const verifiedCourseOfferingId = context.courseOfferingId;

  // 4. The plan of the VERIFIED offering.
  const plan = await deps.findExamPlanByCourseOfferingId(verifiedCourseOfferingId);

  // 5. No plan means there is nothing to pair. This operation NEVER creates one.
  if (plan === null) {
    return refuse("plan_not_found");
  }

  // 6. The instructed-trainee row, PLAN-SCOPED. The session is derived from it,
  //    never supplied.
  const instructed = await deps.findAssignmentForPlan(plan.id, instructedId);

  // 7. Missing and foreign are the SAME answer, so this path is not an existence
  //    oracle over another course's schedule.
  if (instructed === null) {
    return refuse("instructed_assignment_not_found");
  }

  // 8. The examinee row, PLAN-SCOPED, and only when pairing was requested.
  let examinee: ExamPairingAssignmentFacts | null = null;
  if (examineeId !== null) {
    examinee = await deps.findAssignmentForPlan(plan.id, examineeId);

    // 9. Again the same answer for missing and foreign.
    if (examinee === null) {
      return refuse("examinee_assignment_not_found");
    }
  }

  // 10. The session's EXAMINEE facts, scoped to the plan AND to the session the
  //     instructed row itself belongs to. Read ONLY when pairing: an unpair
  //     needs no allocation and no ambiguity check, so it issues no such query.
  const sessionExaminees =
    examinee === null
      ? []
      : await deps.findSessionExaminees(plan.id, instructed.sessionId);

  // 11. The pure decision, from those facts alone.
  const decision = decideExamInstructedTraineePairing({
    instructed,
    examinee,
    sessionExaminees,
  });

  if (decision.kind === "REFUSE") {
    return refuse(decision.code);
  }

  // 12. Already in the requested state: ZERO statements are issued, and the
  //     stored index is reported as it stands.
  if (decision.kind === "NO_CHANGE") {
    return succeed("NO_CHANGE", decision.pairingIndex);
  }

  // 13a. UNPAIR — one conditional write, on the instructed row only.
  if (decision.kind === "UNPAIR") {
    const cleared = await deps.unpairInstructedTrainee({
      planId: plan.id,
      sessionId: instructed.sessionId,
      instructedAssignmentId: instructed.assignmentId,
      expectedInstructedPairingIndex: decision.expectedInstructedPairingIndex,
    });

    // 14. Zero rows: another manager changed the pairing in the gap. NOT
    //     retried — retrying would overwrite their newer state.
    if (!cleared) {
      return refuse("stale_write");
    }
    return succeed("UNPAIRED", null);
  }

  // 13b. PAIR — one atomic write, conditional on both rows still being what this
  //      decision was made from. `examinee` is non-null on this branch by
  //      construction: only the pairing arms of the decision can be reached with
  //      an examinee present.
  if (examinee === null) {
    return refuse("invalid_input");
  }

  const paired = await deps.pairInstructedTrainee({
    planId: plan.id,
    sessionId: instructed.sessionId,
    instructedAssignmentId: instructed.assignmentId,
    expectedInstructedPairingIndex: decision.expectedInstructedPairingIndex,
    examineeAssignmentId: examinee.assignmentId,
    expectedExamineePairingIndex: decision.expectedExamineePairingIndex,
    pairingIndex: decision.pairingIndex,
  });

  // 14. Same rule for the pairing write, for the same reason.
  if (!paired) {
    return refuse("stale_write");
  }
  return succeed("PAIRED", decision.pairingIndex);
}
