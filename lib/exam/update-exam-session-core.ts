/**
 * EXAM EX-SES-S3 — the PURE orchestration of ONE stored ExamSession EDIT.
 *
 * PURE by construction: no Prisma, no DB, no transaction, no clock, no
 * randomness, no env, no auth/session/cookie, no capability, no filesystem, no
 * network, no Next, no `server-only`, no `"use server"`. Every effect this
 * operation needs arrives through the injected `UpdateExamSessionDeps`, so the
 * ORDER in which authorization, lifecycle gating, plan resolution, session
 * resolution, token validation, input validation, definition verification, the
 * assignment gate and the conditional write happen is stated once, here, and is
 * testable without a database.
 *
 * WHAT THIS ANSWERS (and only this):
 *  - in which EXACT order must a stored-session edit authorize, gate, resolve,
 *    locate, validate, verify and write?
 *  - which edit is a NO-OP, and what does a no-op cost?
 *  - and which stable, non-echoing outcome describes each way it can fail?
 *
 * WHAT THIS DELIBERATELY DOES NOT DO:
 *  - it OWNS NO INPUT RULE. Every rule about a submitted session's shape belongs
 *    to the committed `normalizeExamSessionEditInput`, and this module CALLS it.
 *    The six accepted fields, the real-calendar date rule, the exact `HH:mm`
 *    rule, the fail-closed optional-text rule and the fixed diagnostic order are
 *    all enforced THERE, and are not restated here where they could drift;
 *  - it OWNS NO POLICY TABLE. Which offering statuses may be configured is the
 *    committed course operation policy's decision, reached through
 *    `assertConfigurationAllowed`;
 *  - it CREATES NOTHING and DELETES NOTHING. No dependency can create a plan, a
 *    definition or a session, and none can remove one — the removal path is its
 *    own pure core;
 *  - it PERFORMS NO IO and knows nothing of Prisma, a transaction client, a row,
 *    a query or a calendar type;
 *  - it DERIVES NOTHING. No end time, no wave layout, no personal slot, no
 *    capacity, no conflict and no timetable is computed, and none is an input;
 *  - it does NOT reorder, publish, unpublish or copy anything, it writes no
 *    assignment, break or supervisor, and it sends no notification. There is no
 *    dependency through which it could.
 *
 * ===========================================================================
 * THE SIX MUTABLE VALUES, AND EVERYTHING THAT IS NOT
 * ===========================================================================
 * An edit may change EXACTLY these, and they are exactly the six fields the
 * committed input core models:
 *
 *     definitionId, date, startTime, arena, title, notes
 *
 * `definitionId` is additionally CONDITIONAL — see the next section.
 *
 * Everything else is not "left alone by convention", it is UNREPRESENTABLE: the
 * normalized edit payload the write dependency receives has no field for
 * `orderIndex`, `planId`, `kind`, `phase`, `beginnerFormat`, `endTime`,
 * `capacity`, `interfaceSessionId`, `sourceTeachingPracticeLessonId`,
 * `copiedAt`, `roleLabelOverrides`, `individualPublishedAt`, `createdAt` or
 * `updatedAt`, so no writer handed one of these payloads has a channel through
 * which any of them could arrive.
 *
 * `orderIndex` in particular is NEVER touched by an edit, not even when the date
 * changes. Re-ordering a day's sessions is its own operation, and silently
 * moving a row to the end of another day because its date was corrected would be
 * a decision nobody asked for. The honest consequence is stated rather than
 * hidden: after a date change the row keeps the position it held on its old day,
 * which may collide with an existing position on the new one. The committed
 * readers sort by `orderIndex` and then `id`, so the result stays deterministic;
 * a later reorder slice is what normalizes it.
 *
 * ===========================================================================
 * CHANGING THE DEFINITION IS CONDITIONAL, AND THE CONDITION IS ASSIGNMENTS
 * ===========================================================================
 * A manager who scheduled a session under the wrong exam must be able to correct
 * it — but the definition is what decides which fields every assignment of that
 * session is required to carry (an instructed trainee, a lesson topic, a
 * discipline). Re-pointing a session that ALREADY HAS assignments would
 * retroactively judge stored rows against rules they were never entered under.
 *
 * So the rule is: the definition may change ONLY while the session has ZERO
 * assignments. A session with assignments refuses the change with
 * `definition_change_not_allowed` and writes NOTHING AT ALL — not even the five
 * other fields, because a partial success would leave the manager believing the
 * exam had been switched.
 *
 * An UNCHANGED `definitionId` never triggers any of this: no definition is
 * verified, no assignment is counted, no assignment condition is attached to the
 * write, and a session with assignments may freely correct its date, time,
 * arena, title and notes.
 *
 * ===========================================================================
 * THE GATE IS ENFORCED BY THE WRITE ITSELF, NOT BY THE PRE-CHECK
 * ===========================================================================
 * The count above is a DIAGNOSTIC: it produces a sentence a manager can act on,
 * early, without attempting a write. It is deliberately NOT the protection, and
 * this module does not rely on it as one.
 *
 * The protection is `requireNoAssignments`, which this module sets for exactly
 * the definition-changing case and which the write binding turns into an ATOMIC
 * CONDITION evaluated inside the update statement itself — the session is
 * rewritten only if, at write time, it still has no assignments. So the classic
 * check-then-act window between the count and the write no longer decides
 * anything: an assignment that appears in that window makes the write match
 * NOTHING, and the operation fails closed.
 *
 * A ZERO WRITE COUNT IS THEN AMBIGUOUS, AND IS RESOLVED BY RE-READING, NEVER BY
 * RETRYING. Three worlds produce it — the row moved, the row vanished, or an
 * assignment appeared — and this module distinguishes them with narrow
 * authoritative re-reads:
 *   - the session is gone            -> stale_write
 *   - its version no longer matches  -> stale_write
 *   - assignments now exist          -> definition_change_not_allowed
 *   - anything else                  -> stale_write
 * The write is NEVER re-attempted: `updateSessionIfCurrent` is invoked exactly
 * once in this module, on every path. A retry would be a second chance for the
 * unsafe write, which is precisely what the atomic condition exists to deny.
 *
 * WHAT REMAINS OPEN, STATED HONESTLY. The condition and the write are now one
 * statement, so no APPLICATION-level window remains. What no lock-free approach
 * can close is the database's own: under READ COMMITTED the statement's
 * assignment sub-condition is evaluated against a snapshot, so an assignment
 * INSERT that commits concurrently with this very statement may not be visible
 * to it. Narrowing that further would need row locking, SERIALIZABLE isolation
 * or a database-level rule — each a separate approved change, and none of them
 * is performed or claimed here.
 *
 * ===========================================================================
 * THE CALLER SUPPLIES A REQUEST, NEVER A GRANT
 * ===========================================================================
 * The only four arguments are a REQUESTED `courseOfferingId`, a `sessionId`, an
 * optimistic-concurrency token and a RAW, untrusted input object. There is no
 * parameter — and no readable field of the raw object — through which a caller
 * could supply a `planId`, an `orderIndex`, an actor id, an assignment count, a
 * publication option or a transaction handle.
 *
 * `planId` is derived SERVER-SIDE from the DB-verified offering id that
 * `requireCourseContext` returned. The requested offering id is used for exactly
 * one thing — asking the course boundary to verify it — and is never read again,
 * so a caller cannot steer the plan lookup at one offering while being
 * authorized for another.
 *
 * The session is then located UNDER THAT SERVER-RESOLVED PLAN, and from that
 * point on it is the STORED row's id — never the requested one — that reaches
 * the assignment count and the write.
 *
 * ===========================================================================
 * THE LOCKED ORDER, AND WHY EACH STEP PRECEDES THE NEXT
 * ===========================================================================
 *   1. requireCourseContext(requested id)   — admin + exact-offering boundary
 *   2. assertConfigurationAllowed(status)   — course-lifecycle gate
 *   3. findExamPlanByCourseOfferingId(id)   — VERIFIED id only
 *   4. no plan                              -> plan_not_found
 *   5. findSessionForUpdate(plan.id, id)    — SERVER plan id only
 *   6. missing / foreign plan               -> session_not_found
 *   7. the concurrency token                -> invalid_input when unusable
 *   8. normalizeExamSessionEditInput(raw)   — the committed input rules
 *   9. invalid                              -> invalid_input + stable issues
 *  10. nothing changed                      -> success, changed:false, NO write
 *      and NO further dependency of any kind
 *  11. definition changed?
 *      a. findDefinitionForPlan(plan.id, submitted)
 *      b. missing / foreign plan            -> definition_not_found
 *      c. countAssignmentsForSession(row id)
 *      d. count > 0                         -> definition_change_not_allowed
 *  12. updateSessionIfCurrent(plan.id, row id, token, value, definitionChanged)
 *      — the flag becomes the write's ATOMIC no-assignments condition
 *  13. nothing matched, definition unchanged -> stale_write
 *  14. nothing matched, definition changed   -> re-read, then classify
 *  15. narrow success DTO, changed:true
 *
 * The consequences are the point:
 *  - NOTHING is validated for a course the actor may not access, so validation
 *    diagnostics can never be used as an oracle over another course;
 *  - NO exam query happens before authorization and the lifecycle gate, so an
 *    ARCHIVED offering costs zero exam reads;
 *  - a NO-OP costs zero definition reads, zero assignment counts and zero
 *    writes;
 *  - an unchanged definition costs zero definition reads and zero assignment
 *    counts;
 *  - no write dependency runs when validation fails, when the definition cannot
 *    be verified, or when the assignment gate refuses.
 *
 * The definition is verified BEFORE the assignment gate, which is the approved
 * order for this slice. The honest consequence: on a session that already has
 * assignments, submitting an unknown definition id answers `definition_not_found`
 * rather than `definition_change_not_allowed`, so a caller learns that the id is
 * not one of this plan's definitions even though the change would have been
 * refused anyway. That is not a leak — the lookup is scoped to the plan of an
 * offering the caller is already an authorized admin of, and it can say nothing
 * about any other course — but it IS a second query on a path that could have
 * refused after one, and it is written down here rather than left to be
 * rediscovered.
 *
 * ===========================================================================
 * A FOREIGN DEFINITION, A FOREIGN SESSION, AND MISSING ONES ARE THE SAME ANSWER
 * ===========================================================================
 * Both lookups are asked for a row under the SERVER-RESOLVED plan. A session (or
 * definition) that does not exist, and one that exists under ANOTHER plan, both
 * come back as `null` and both produce the same refusal. The two are therefore
 * indistinguishable to the caller, which is deliberate: a distinguishable answer
 * would turn this write path into an existence oracle over every other course's
 * exam configuration.
 *
 * The scoping is what makes that true, not a comparison this module performs.
 * There is no dependency that can read a session or a definition WITHOUT a plan
 * id, so a cross-plan edit is unreachable rather than merely rejected.
 *
 * ===========================================================================
 * BEGINNER SESSIONS, AND WHY NO KIND IS INSPECTED HERE
 * ===========================================================================
 * Beginner exams are a LIVE Teaching Practice projection and must never become a
 * stored row. That rule belongs to the committed domain core, which sees the
 * definition's authoritative kind; this slice's verification dependency returns
 * the definition's id and NOTHING ELSE, so this module cannot inspect a kind and
 * does not pretend to.
 *
 * The consequence is stated plainly rather than hidden, exactly as the sibling
 * create core states it: this slice does not itself refuse re-pointing a session
 * at a definition of the live beginner kind. Adding that refusal means giving
 * the verification dependency the definition's kind and binding the committed
 * domain validator, which is a separate approved change.
 *
 * ===========================================================================
 * ONLY TWO KNOWN FAILURES ARE CLASSIFIED — EVERYTHING ELSE PROPAGATES
 * ===========================================================================
 * Exactly two injected predicates may convert a thrown error into a refusal: the
 * course not-found and the lifecycle denial. One dependency reports a
 * non-throwing refusal by returning `null` (nothing matched the conditional
 * write). Every other throw — an infrastructure fault, a programming error, a
 * failed read, an unexpected write failure — LEAVES THIS MODULE UNCHANGED.
 *
 * There is deliberately NO duplicate classifier and NO foreign-key classifier.
 * The stored session table's only unique key is the beginner-copy idempotency
 * key on `(planId, sourceTeachingPracticeLessonId)`, and this slice never writes
 * that column, so no uniqueness violation is reachable. The composite key to the
 * definition is made satisfiable by the plan-scoped verification above; if a
 * manager DELETES that definition in the instant between the verification and
 * the write, the database refuses and that refusal propagates as an unexpected
 * error rather than being laundered into `definition_not_found`. That is the
 * honest outcome: the caller was not wrong about the definition, the world
 * changed underneath them.
 *
 * There is no `unexpected` code and no catch-all `catch`. That is deliberate: a
 * generic failure code would let a real defect render as an ordinary,
 * unremarkable form error that nobody investigates.
 *
 * CRITICALLY, the real admin boundary denies by REDIRECTING (a Next
 * `NEXT_REDIRECT` throw). Because each classifier is asked about one specific
 * error shape and anything unrecognized is re-thrown, a redirect passes straight
 * through and the framework still performs it.
 *
 * ===========================================================================
 * NO CALENDAR TYPE CROSSES THIS BOUNDARY
 * ===========================================================================
 * The committed normalizer produces `date` as a validated `YYYY-MM-DD` STRING,
 * and the AUTHORITATIVE row is handed to this module with its date already in
 * that same string form, so the no-op comparison is a plain string comparison.
 * Nothing here constructs, parses, compares or formats a calendar value, and no
 * dependency signature and no result field carries one. Both conversions — the
 * stored date read OUT as a key, and the submitted key written IN as a column —
 * belong to the server-only write binding, where the repository's existing
 * date-key helpers perform them; putting either here would drag a timezone
 * decision into a pure core.
 *
 * The concurrency token is EPOCH MILLISECONDS, a plain number, for the same
 * reason: a `Date` is not JSON, does not survive a form round trip, and would
 * drag a mutable, timezone-shaped object across the network boundary.
 */
import {
  normalizeExamSessionEditInput,
  type ExamSessionWriteInputIssueCode,
  type NormalizedExamSessionEdit,
} from "./exam-session-write-core";

export type { NormalizedExamSessionEdit } from "./exam-session-write-core";

// ===========================================================================
// The concurrency token
// ===========================================================================

/**
 * The optimistic-concurrency token is EPOCH MILLISECONDS, as a plain number.
 *
 * A token is usable only when it is literally a finite, non-negative integer
 * number. A numeric STRING is refused rather than coerced — `Number("")` is `0`
 * and `Number(" 1 ")` is `1`, so coercion here would silently manufacture a
 * token the client never sent and compare it against a stored row.
 *
 * WHY THIS IS NOT THE DEFINITION SLICE'S PREDICATE. The committed
 * `isExamDefinitionVersionToken` is the same two-line type check today, and it
 * is deliberately not imported: it is the DEFINITION slice's contract, and
 * sessions must not inherit a future change to it. This is a type check, not a
 * domain rule — unlike the real-calendar date rule and the `HH:mm` rule, both of
 * which this slice reuses rather than restates, precisely because they ARE
 * rules.
 *
 * The DELETE sibling imports this one, so the two session operations can never
 * disagree about what a well-formed token is.
 */
export function isExamSessionVersionToken(value: unknown): boolean {
  // `Number.isInteger` already rejects non-numbers, NaN, Infinity and
  // fractions; the sign check rejects a negative instant, which no stored
  // `updatedAt` in this system can be.
  return Number.isInteger(value) && (value as number) >= 0;
}

// ===========================================================================
// The injected boundary
// ===========================================================================

/**
 * The course context an edit may act on, AFTER the boundary verified it.
 *
 * Deliberately TWO fields. It is not the project's `AdminCourseContext` and not a
 * CourseOffering row: a name, a level, an ActivityYear or a date would be data
 * this operation has no business reading, and a generated Prisma type here would
 * end this module's purity.
 *
 * `courseOfferingId` is the DB-VERIFIED id — the one the boundary confirmed
 * exists — and is the ONLY id that reaches the plan lookup. `status` is a plain
 * `string` rather than the generated enum for the same purity reason; the
 * committed policy the gate consults is default-deny, so an unrecognized status
 * is refused rather than waved through.
 */
export interface VerifiedExamSessionCourseContext {
  readonly courseOfferingId: string;
  readonly status: string;
}

/**
 * The plan the session must live under: its id and nothing else.
 *
 * No `publishedAt`, no source dates, no sessions, no definitions, no offering
 * relation, no timestamps. An edit does not need to know whether the plan is
 * published (publication is a separate, later decision) and must not be able to
 * make a decision from data it should not have read.
 */
export interface ResolvedExamPlanForSessionUpdate {
  readonly id: string;
}

/**
 * The AUTHORITATIVE stored session, read back under the server-resolved plan.
 *
 * Exactly the six mutable values plus the row's id and its version. The six are
 * here because the NO-OP RULE is defined against them; `id` is here because it
 * is the server-verified target of everything that follows; `updatedAt` is here
 * because it is what a successful no-op reports back.
 *
 * Nothing else — no `planId`, no `orderIndex`, no `kind`, no `endTime`, no
 * `createdAt`, no relation, no assignment. A field this module cannot see is a
 * decision it cannot quietly start making.
 *
 * `date` is a `YYYY-MM-DD` STRING, already converted by the IO layer, so this
 * module compares strings and never touches a calendar type.
 */
export interface ExistingExamSessionForUpdate {
  readonly id: string;
  readonly definitionId: string;
  /** `YYYY-MM-DD`. */
  readonly date: string;
  readonly startTime: string;
  readonly arena: string | null;
  readonly title: string | null;
  readonly notes: string | null;
  /** Epoch milliseconds. */
  readonly updatedAt: number;
}

/**
 * The verification result for a SUBMITTED, CHANGED definition: its id, and
 * nothing else.
 *
 * No `kind`, no `name`, no duration, no capacity, no `planId`, no `orderIndex`
 * and no timestamp — see the header on beginner sessions for why that narrowness
 * is the safety property rather than an omission.
 */
export interface VerifiedExamDefinitionForSessionUpdate {
  readonly id: string;
}

/**
 * What the conditional write reports back: the id it matched and the version the
 * row now carries. Never the row, never the stored date, never a calendar value.
 */
export interface UpdatedExamSessionRecord {
  readonly id: string;
  /** Epoch milliseconds. */
  readonly updatedAt: number;
}

/**
 * The complete injected boundary.
 *
 * Note what is ABSENT and therefore unrepresentable: there is no dependency that
 * can create or upsert an ExamPlan, create or edit a definition, create or
 * delete a session, reorder sessions, write or delete an assignment, a break or
 * a supervisor, publish anything, send a notification, resolve a capability, or
 * read another course. The operation is structurally incapable of doing anything
 * but rewriting six values of one session of one already-existing plan.
 *
 * The assignment dependency is a COUNT and cannot mutate anything.
 *
 * The two predicates take `unknown` and return a boolean: this module never
 * inspects, unwraps, logs or echoes a raw error, so no database detail and no
 * submitted value can leak into a result through them.
 */
export interface UpdateExamSessionDeps {
  /**
   * Authorize the actor and verify the REQUESTED offering exists. May throw the
   * project's typed not-found, and may REDIRECT for an unauthenticated or
   * non-admin caller — the redirect must reach the framework untouched.
   */
  requireCourseContext(
    requestedCourseOfferingId: string,
  ): Promise<VerifiedExamSessionCourseContext>;

  /** Gate the mutation on the VERIFIED offering status. Throws to deny. */
  assertConfigurationAllowed(status: string): void;

  /** Find the plan of the VERIFIED offering. `null` means "no plan exists". */
  findExamPlanByCourseOfferingId(
    verifiedCourseOfferingId: string,
  ): Promise<ResolvedExamPlanForSessionUpdate | null>;

  /**
   * Read the session UNDER the given plan. `null` means "no such session in this
   * plan" — which deliberately covers both "does not exist" and "belongs to
   * another plan".
   */
  findSessionForUpdate(
    planId: string,
    sessionId: string,
  ): Promise<ExistingExamSessionForUpdate | null>;

  /**
   * Verify a CHANGED definition EXISTS UNDER THE GIVEN PLAN.
   *
   * The plan id is the SERVER-RESOLVED one, and there is no variant of this
   * dependency that omits it. `null` covers both a definition that does not
   * exist and one belonging to another plan — the caller may not learn which.
   *
   * Called ONLY when the submitted definition differs from the stored one.
   */
  findDefinitionForPlan(
    planId: string,
    definitionId: string,
  ): Promise<VerifiedExamDefinitionForSessionUpdate | null>;

  /**
   * How many assignments belong to THIS session. The id is the STORED row's, so
   * the count can neither miss a row nor include another session's.
   *
   * Called ONLY when the submitted definition differs from the stored one: once
   * as the early diagnostic, and — if the guarded write then matches nothing —
   * once more to classify why. Never as a decision this module makes INSTEAD of
   * the write's own atomic condition.
   */
  countAssignmentsForSession(sessionId: string): Promise<number>;

  /**
   * The SINGLE write: rewrite the six mutable values of that session ONLY IF its
   * stored version still equals `expectedUpdatedAt` — and, when
   * `requireNoAssignments` is true, ONLY IF the session still has no assignments
   * AT WRITE TIME.
   *
   * `requireNoAssignments` is not advisory and not a hint: the binding must
   * express it as a condition of the write STATEMENT, so the assignment state
   * and the row version are tested atomically together with the write rather
   * than by this module beforehand. It is `true` for exactly one case — a
   * definition change — and `false` for an ordinary edit, which must stay
   * permitted on a session that has assignments.
   *
   * `null` means nothing matched: the row moved, the row vanished, or (when
   * guarded) an assignment appeared. Which of those it was is not this
   * dependency's to say — the caller re-reads to find out, and never retries.
   */
  updateSessionIfCurrent(
    planId: string,
    sessionId: string,
    expectedUpdatedAt: number,
    value: NormalizedExamSessionEdit,
    requireNoAssignments: boolean,
  ): Promise<UpdatedExamSessionRecord | null>;

  /** Is this throw "the requested offering does not exist"? */
  isCourseNotFoundError(error: unknown): boolean;

  /** Is this throw "the offering's lifecycle forbids this operation"? */
  isOperationNotAllowedError(error: unknown): boolean;
}

// ===========================================================================
// Diagnostics
// ===========================================================================

/**
 * The ONE code this module owns.
 *
 * Every other diagnostic it can return is a committed code produced by the
 * committed edit normalizer. This one describes a request whose CONCURRENCY
 * TOKEN is unusable rather than a session whose content is invalid, so no
 * committed code covers it — and it is deliberately a separate code rather than
 * a reuse of the stale-write refusal, because "your form is malformed" and
 * "someone else edited this row" call for different manager actions.
 */
export type UpdateExamSessionOwnIssueCode = "EX-SES-VERSION-INVALID";

/** Every code an edit result can carry. */
export type UpdateExamSessionIssueCode =
  | ExamSessionWriteInputIssueCode
  | UpdateExamSessionOwnIssueCode;

/**
 * One diagnostic. Deliberately carries ONLY a stable code and its message: no
 * submitted value, no field path, no raw object and no id, so a diagnostic can
 * never echo what the client sent back to the client.
 */
export interface UpdateExamSessionIssue {
  readonly code: UpdateExamSessionIssueCode;
  readonly message: string;
}

/** The message table for the code this module owns. */
export const UPDATE_EXAM_SESSION_MESSAGES: Readonly<
  Record<UpdateExamSessionOwnIssueCode, string>
> = Object.freeze({
  "EX-SES-VERSION-INVALID": "בקשת העריכה אינה תקינה. יש לרענן את הדף ולנסות שוב",
});

// ===========================================================================
// The result model
// ===========================================================================

/**
 * The failure codes that need no diagnostics: each is fully described by the
 * code itself.
 */
export type UpdateExamSessionRefusalCode =
  | "offering_not_found"
  | "operation_not_allowed"
  | "plan_not_found"
  | "session_not_found"
  | "definition_not_found"
  | "definition_change_not_allowed"
  | "stale_write";

/**
 * A discriminated, JSON-safe, frozen result.
 *
 * FOUR arms. The two success arms differ only in `changed`, which is a LITERAL
 * on each so a caller can narrow on it; `issues` EXISTS ONLY on `invalid_input`,
 * so no property is ever present-but-`undefined` and the JSON round trip is
 * exact.
 *
 * Nothing in any arm is a calendar value, Map, Set, BigInt, Error or class
 * instance, and nothing carries a plan id, a course offering id, a definition
 * id, an assignment count, a date, a start time, an actor id, a raw error, a
 * database detail or any submitted value.
 *
 * There is deliberately no `unexpected`, `duplicate`, `conflict`,
 * `session_has_assignments` or `plan_published` code: the first would hide
 * defects, and the rest describe operations this slice does not perform or an
 * outcome it cannot reach.
 */
export type UpdateExamSessionResult =
  | {
      readonly ok: true;
      readonly sessionId: string;
      readonly changed: true;
      readonly updatedAt: number;
    }
  | {
      readonly ok: true;
      readonly sessionId: string;
      readonly changed: false;
      readonly updatedAt: number;
    }
  | {
      readonly ok: false;
      readonly code: "invalid_input";
      readonly issues: readonly UpdateExamSessionIssue[];
    }
  | {
      readonly ok: false;
      readonly code: UpdateExamSessionRefusalCode;
    };

function refuse(code: UpdateExamSessionRefusalCode): UpdateExamSessionResult {
  return Object.freeze({ ok: false as const, code });
}

function refuseInput(
  issues: readonly UpdateExamSessionIssue[],
): UpdateExamSessionResult {
  return Object.freeze({
    ok: false as const,
    code: "invalid_input" as const,
    // A fresh frozen copy: the result must not alias an array a caller could
    // later mutate, and the committed core's own issue ORDER is preserved
    // exactly so a form can render diagnostics in a stable sequence.
    issues: Object.freeze([...issues]),
  });
}

function refuseVersionToken(): UpdateExamSessionResult {
  return refuseInput([
    Object.freeze({
      code: "EX-SES-VERSION-INVALID" as const,
      message: UPDATE_EXAM_SESSION_MESSAGES["EX-SES-VERSION-INVALID"],
    }),
  ]);
}

function succeedChanged(updated: UpdatedExamSessionRecord): UpdateExamSessionResult {
  return Object.freeze({
    ok: true as const,
    sessionId: updated.id,
    changed: true as const,
    updatedAt: updated.updatedAt,
  });
}

function succeedUnchanged(
  existing: ExistingExamSessionForUpdate,
): UpdateExamSessionResult {
  return Object.freeze({
    ok: true as const,
    sessionId: existing.id,
    changed: false as const,
    // The AUTHORITATIVE version, unchanged — so a form that re-submits keeps a
    // token the database will still recognize.
    updatedAt: existing.updatedAt,
  });
}

// ===========================================================================
// The no-op rule
// ===========================================================================

/**
 * Is this normalized edit exactly what the stored row already holds?
 *
 * All SIX mutable values are compared, and only those six. `orderIndex`,
 * `planId`, `createdAt` and `updatedAt` are not compared, because they are not
 * editable and comparing them would suggest they could be.
 *
 * Every comparison is EXACT and case-SENSITIVE. The committed normalizer already
 * trimmed each text field and collapsed a blank one to `null`, so anything still
 * different after that is a real edit. `date` and `startTime` are compared as
 * the plain strings they are on both sides — the stored date arrives already
 * rendered as a `YYYY-MM-DD` key by the IO layer, so there is no calendar
 * comparison and no timezone in play.
 *
 * WHY A NO-OP IGNORES A STALE TOKEN. A no-op is decided against the
 * AUTHORITATIVE row, read AFTER authorization, the lifecycle gate and the plan
 * resolution — not against the values the browser was showing. So "the token is
 * old" and "the row already says exactly this" can both be true, and in that
 * case there is nothing to protect: no write is attempted, no other manager's
 * change is overwritten, and the version reported back is the CURRENT one.
 * Refusing with `stale_write` would demand a reload that changes nothing. The
 * token is still REQUIRED to be well-formed, because a malformed one means the
 * request itself is malformed — which is why step 7 precedes step 10.
 */
function isUnchanged(
  existing: ExistingExamSessionForUpdate,
  value: NormalizedExamSessionEdit,
): boolean {
  return (
    existing.definitionId === value.definitionId &&
    existing.date === value.date &&
    existing.startTime === value.startTime &&
    existing.arena === value.arena &&
    existing.title === value.title &&
    existing.notes === value.notes
  );
}

// ===========================================================================
// The orchestration
// ===========================================================================

/**
 * Edit exactly ONE stored ExamSession of the plan of one authorized,
 * lifecycle-permitted course offering.
 *
 * The order is the safety contract, and it is enforced by construction: each
 * step's output is the next step's only input, so no step can be reordered
 * without the code failing to compile or the plan id becoming unavailable.
 *
 * Each `try` wraps EXACTLY ONE dependency call and asks EXACTLY ONE classifier.
 * Nothing is caught broadly, and an unrecognized error is re-thrown with its
 * identity intact — including a `NEXT_REDIRECT` from the authorization boundary.
 *
 * Never mutates `rawInput`; a frozen raw object is fine.
 */
export async function updateExamSessionWithDeps(
  courseOfferingId: string,
  sessionId: string,
  expectedUpdatedAt: number,
  rawInput: unknown,
  deps: UpdateExamSessionDeps,
): Promise<UpdateExamSessionResult> {
  // 1. Authorization + exact-offering verification FIRST. Nothing about exams,
  //    plans, the session or the submitted input is touched before this resolves.
  let context: VerifiedExamSessionCourseContext;
  try {
    context = await deps.requireCourseContext(courseOfferingId);
  } catch (error) {
    if (deps.isCourseNotFoundError(error)) {
      return refuse("offering_not_found");
    }
    throw error;
  }

  // 2. The course-lifecycle gate, on the VERIFIED status. Runs before any exam
  //    query, so an ARCHIVED offering costs zero exam reads.
  try {
    deps.assertConfigurationAllowed(context.status);
  } catch (error) {
    if (deps.isOperationNotAllowedError(error)) {
      return refuse("operation_not_allowed");
    }
    throw error;
  }

  // 3. The plan of the VERIFIED offering. `courseOfferingId` — the requested,
  //    unverified value — is never read again from here on.
  const plan = await deps.findExamPlanByCourseOfferingId(context.courseOfferingId);

  // 4. No plan means no session to edit.
  if (!plan) {
    return refuse("plan_not_found");
  }

  // 5. The session, located UNDER the server-resolved plan. A session of another
  //    plan simply is not found here.
  const existing = await deps.findSessionForUpdate(plan.id, sessionId);

  // 6. Missing, or belonging to another plan — one indistinguishable outcome.
  if (!existing) {
    return refuse("session_not_found");
  }

  // 7. The concurrency token must be well-formed before it is compared against
  //    anything, and before a no-op can be declared.
  if (!isExamSessionVersionToken(expectedUpdatedAt)) {
    return refuseVersionToken();
  }

  // 8. Only NOW is the submitted input examined, and every rule about it belongs
  //    to the committed normalizer.
  const normalized = normalizeExamSessionEditInput(rawInput);

  // 9. Invalid input ends the operation with the committed diagnostics verbatim.
  //    No definition is verified, no assignment is counted, no write is reached.
  if (!normalized.ok) {
    return refuseInput(normalized.issues);
  }

  // 10. Nothing to do: report the CURRENT version and perform no write. Every
  //     remaining dependency — including the definition read and the assignment
  //     count — is skipped entirely.
  if (isUnchanged(existing, normalized.value)) {
    return succeedUnchanged(existing);
  }

  // 11. A CHANGED definition, and only a changed one, must be verified under the
  //     resolved plan and then permitted by the assignment gate. The flag is
  //     computed ONCE and drives both this block and the write's atomic
  //     condition, so the two can never disagree about which case this is.
  const definitionChanged =
    normalized.value.definitionId !== existing.definitionId;

  if (definitionChanged) {
    const definition = await deps.findDefinitionForPlan(
      plan.id,
      normalized.value.definitionId,
    );

    // A missing definition and a foreign one produce the SAME refusal, so this
    // write path is not an existence oracle over another course's plan.
    if (!definition) {
      return refuse("definition_not_found");
    }

    // The EARLY DIAGNOSTIC — not the protection. Re-pointing a session that
    // already has assignments would judge stored rows against rules they were
    // never entered under, and saying so before attempting a write gives the
    // manager a sentence they can act on. The COUNT ITSELF never leaves this
    // module, and NOTHING is written, not even the five other fields.
    const assignmentCount = await deps.countAssignmentsForSession(existing.id);
    if (assignmentCount > 0) {
      return refuse("definition_change_not_allowed");
    }
  }

  // 12. The single write, against the SERVER-RESOLVED plan id, the STORED row's
  //     id and the caller's version token. Whether the token still matches — and,
  //     for a definition change, whether the session is still unassigned — is the
  //     WRITE's decision, made atomically inside one statement, never a decision
  //     made here from the reads above, which could already be out of date.
  const updated = await deps.updateSessionIfCurrent(
    plan.id,
    existing.id,
    expectedUpdatedAt,
    normalized.value,
    definitionChanged,
  );

  // 13-14. Nothing matched. An ordinary edit carried no assignment condition, so
  //        there is only one possible reason and no re-read could add anything.
  //        A definition change carried one, so the reason is genuinely ambiguous
  //        and is resolved by re-reading — never by trying the write again.
  if (!updated) {
    return definitionChanged
      ? await classifyFailedDefinitionChange(plan.id, existing.id, expectedUpdatedAt, deps)
      : refuse("stale_write");
  }

  // 15. The narrow success DTO: the id and the version the row now carries,
  //     nothing else.
  return succeedChanged(updated);
}

// ===========================================================================
// Classifying a guarded write that matched nothing
// ===========================================================================

/**
 * Why did the atomically-guarded definition change match no row?
 *
 * Reached ONLY after `updateSessionIfCurrent` returned `null` for a write that
 * carried the no-assignments condition. Nothing has been written at this point,
 * and nothing will be: this function performs READS ONLY and never re-attempts
 * the update. That is the whole point — a retry would hand the unsafe write a
 * second chance, which is exactly what the atomic condition exists to deny.
 *
 * The re-reads are narrow and ordered so that each one can actually decide
 * something, rather than being asked and then ignored:
 *
 *  - the session is GONE          -> `stale_write`. Its assignments went with it
 *    (the relation cascades), so counting them could only return zero and could
 *    not change this answer;
 *  - its VERSION no longer matches -> `stale_write`. Another manager committed
 *    first; that alone explains the zero match, whatever the assignment state
 *    now is, and reporting the assignment gate here would misdescribe it;
 *  - assignments now EXIST         -> `definition_change_not_allowed`. The row is
 *    still the one the caller was looking at, so the only remaining explanation
 *    is the condition this operation added, and the manager's real problem is
 *    that someone was assigned;
 *  - anything else                 -> `stale_write`, the FAIL-CLOSED default. The
 *    row appears unchanged and unassigned, so the write "should" have matched;
 *    something moved and moved back, or raced. There is no honest positive claim
 *    to make, and asking the manager to reload is the safe answer.
 *
 * CONSERVATIVE UNDER FURTHER CONCURRENCY, DELIBERATELY. These reads are not in a
 * transaction with the failed write, so a world that keeps changing underneath
 * them can produce a `stale_write` where `definition_change_not_allowed` would
 * have been more informative, or the reverse. Both are refusals, neither writes
 * anything, and the classification only ever chooses which sentence a manager
 * reads — so being approximate here costs a word, never a row.
 */
async function classifyFailedDefinitionChange(
  planId: string,
  sessionId: string,
  expectedUpdatedAt: number,
  deps: UpdateExamSessionDeps,
): Promise<UpdateExamSessionResult> {
  const current = await deps.findSessionForUpdate(planId, sessionId);
  if (!current || current.updatedAt !== expectedUpdatedAt) {
    return refuse("stale_write");
  }

  const assignmentCount = await deps.countAssignmentsForSession(sessionId);
  if (assignmentCount > 0) {
    return refuse("definition_change_not_allowed");
  }

  return refuse("stale_write");
}
