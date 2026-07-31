/**
 * EX-PUB-BE-MVP — the PURE decision and orchestration for the ONE manager action
 * that PUBLISHES or UNPUBLISHES an ExamPlan.
 *
 * PURE by construction: no Prisma, no DB, no transaction, no clock, no
 * randomness, no env, no auth/session/cookie, no filesystem, no network, no
 * Next, no `server-only`, no `"use server"`. This module imports NOTHING — not
 * even a sibling exam core — so every effect the operation needs arrives through
 * the injected dependency bundle, and the ORDER in which authorization,
 * lifecycle gating, the plan lookup and the conditional write happen is stated
 * once, here, and is testable without a database.
 *
 * IT NEVER READS THE WALL CLOCK. `now` is a caller-supplied epoch-millisecond
 * NUMBER, matching the convention the committed publication-status core and the
 * committed plan loader already use: cores compare numbers, and the IO shell owns
 * every conversion to and from a calendar object. A core that called `Date.now()`
 * could not be tested for the "publish stamps exactly this instant" property at
 * all.
 *
 * ===========================================================================
 * ONE MEANING OF `publishedAt`, AND IT IS THE ONE THAT ALREADY EXISTS
 * ===========================================================================
 * `ExamPlan.publishedAt` is the GENERAL publication of a plan: NULL means the
 * plan has never been published, and a timestamp means it is published. The
 * committed plan loader already gates every trainee-visible content fetch on
 * exactly that — an unpublished plan yields the uniform empty payload before a
 * single definition, session or source date is read.
 *
 * This module writes that same column with that same meaning and introduces NO
 * second one. In particular it does NOT touch the PER-SESSION
 * `individualPublishedAt`: individual publication is a different decision on a
 * different row, the committed status core already owns its UNPUBLISHED /
 * CURRENT / STALE rule, and no dependency here can read or write it.
 *
 * ===========================================================================
 * WHAT THIS MVP DELIBERATELY DOES NOT DECIDE
 * ===========================================================================
 * Publishing here is a pure state transition. It performs NO readiness check of
 * any kind: no pairing check, no supervisor check, no definition or session
 * completeness check, no duplicate detection, no timetable or conflict warning,
 * and no stale-plan comparison. It sends NO notification and computes NO
 * affected-user preview.
 *
 * That is a scope decision, not an oversight: every one of those is a product
 * rule with its own edge cases, and a half-implemented one that silently passes
 * would read as enforcement to the next person who edits this file. A manager who
 * publishes an incomplete plan today publishes an incomplete plan; adding a gate
 * later is a separate, reviewed slice, and this module's dependency bundle has no
 * way to express one, so none can be smuggled in.
 *
 * ===========================================================================
 * A NO-OP IS A SUCCESS, NOT A REFUSAL
 * ===========================================================================
 * The caller asks for one thing: "let this plan be published" (or "not
 * published"). If it is ALREADY in the requested state, that request is ALREADY
 * SATISFIED, so the outcome is a success reporting `NO_CHANGE` together with the
 * publication timestamp that is actually stored.
 *
 * Reporting a conflict instead would be actively harmful: a manager who
 * double-clicks, or who has the exams page open in two tabs, would be shown an
 * error for a situation that is completely fine.
 *
 * A no-op writes NOTHING. Re-publishing an already-published plan does NOT move
 * its timestamp forward: the stored instant is the moment the plan first became
 * visible, and quietly rewriting it would destroy the only record of that, and
 * would also make every future staleness comparison lie.
 *
 * ===========================================================================
 * THE CONCURRENT WRITER, AND WHY THE WRITE IS CONDITIONAL
 * ===========================================================================
 * The plan read and the write are two separate statements, so there is a window
 * between them. The write therefore carries the state the decision was made from
 * as a CONDITION — publish only while the plan is still unpublished, unpublish
 * only while its timestamp is still the exact one that was read.
 *
 * A zero write count therefore means exactly one thing: another manager changed
 * the publication state in the gap, and this call's decision was made from a view
 * of the world that no longer holds. That is the `stale_write` refusal, and it is
 * NOT retried: retrying would silently overwrite a newer publication timestamp
 * with an older decision, which is precisely what the condition exists to
 * prevent. The honest answer tells the manager to reload.
 *
 * ===========================================================================
 * THE CALLER SUPPLIES A REQUEST, NEVER A GRANT
 * ===========================================================================
 * The only arguments besides the dependency bundle are a REQUESTED
 * `courseOfferingId` and the requested operation. There is no parameter — and no
 * object field — through which a caller could supply a `planId`, a publication
 * timestamp, a clock, an actor id or a transaction handle.
 *
 * A CALLER-SUPPLIED TIMESTAMP IS THE MOST IMPORTANT ABSENCE. `now` reaches the
 * decision from an injected dependency the IO binds to the SERVER clock, so a
 * future Server Action cannot let a form field decide when a plan was published —
 * the field does not exist in any signature to be ignored.
 *
 * The requested offering id is used for exactly ONE thing: asking the course
 * boundary to verify it. Every later step receives the id the boundary CONFIRMED,
 * so a caller cannot be authorized for one offering while the lookup and the
 * write land on another, and the plan id is always server-derived.
 *
 * ===========================================================================
 * THE LOCKED ORDER
 * ===========================================================================
 *   1. requireCourseContext(requested id)      — admin + exact-offering
 *   2. assertConfigurationAllowed(status)      — course-lifecycle gate
 *   3. the requested operation is one of the two known ones
 *   4. findPlanPublication(VERIFIED id)        — id + publishedAt, nothing else
 *   5. no plan                                 -> plan_not_found
 *   6. decide, from the STORED state and the SERVER clock
 *   7. no change                               -> ok, NO_CHANGE, ZERO writes
 *   8. setPublicationIfCurrent(...)            — ONE conditional write
 *   9. zero rows                               -> stale_write
 *
 * Nothing about a plan is looked up for a course the actor may not access, so
 * plan existence and publication state cannot be probed by an unauthorized
 * caller. The lifecycle gate runs before any exam query, so an ARCHIVED offering
 * is refused without a single exam read.
 *
 * ===========================================================================
 * ONLY TWO KNOWN FAILURES ARE CLASSIFIED — EVERYTHING ELSE PROPAGATES
 * ===========================================================================
 * Exactly two injected predicates may convert a thrown error into an outcome: the
 * course not-found and the lifecycle denial. Every other throw LEAVES THIS MODULE
 * UNCHANGED. There is no `unexpected` code and no catch-all `catch`: a generic
 * failure code would let a real defect render as an ordinary form error that
 * nobody investigates.
 *
 * CRITICALLY, an admin boundary denies by REDIRECTING (a Next `NEXT_REDIRECT`
 * throw). Because each classifier is asked about one specific error shape and
 * anything unrecognized is re-thrown, a redirect passes straight through and the
 * framework still performs it. A redirect must never be translated into a
 * refusal — an admin who is simply not logged in would then see "not found"
 * instead of the login page.
 */

// ===========================================================================
// The operation
// ===========================================================================

/** The two — and only two — transitions this module can be asked to perform. */
export type ExamPublicationOperation = "PUBLISH" | "UNPUBLISH";

/**
 * Is this value one of the two known operations?
 *
 * FAIL-CLOSED and exported so the boundary can be proven at runtime rather than
 * only by a TypeScript annotation a future `"use server"` caller would erase: a
 * Server Action receives whatever the network sent, and an unrecognized string
 * must be refused, never defaulted to `PUBLISH`.
 */
export function isExamPublicationOperation(
  value: unknown,
): value is ExamPublicationOperation {
  return value === "PUBLISH" || value === "UNPUBLISH";
}

// ===========================================================================
// The pure decision
// ===========================================================================

/**
 * Everything the decision needs, and nothing else. Non-PII by construction: no
 * course, no trainee, no instructor, no plan id, no actor and no free text.
 */
export interface ExamPublicationDecisionInput {
  readonly operation: ExamPublicationOperation;
  /** The STORED publication instant in epoch ms, or `null` if never published. */
  readonly currentPublishedAt: number | null;
  /** The SERVER clock, in epoch ms. */
  readonly now: number;
}

/**
 * What the caller must do about it.
 *
 *  - `change` — must a write happen at all? `false` is the no-op, and no-op means
 *    NOTHING is written;
 *  - `expectedPublishedAt` — the state the write must be CONDITIONAL on, so a
 *    concurrent change makes the statement match zero rows instead of clobbering
 *    a newer timestamp;
 *  - `nextPublishedAt` — the value to store;
 *  - `resultingPublishedAt` — what the plan's publication instant IS once this
 *    call is done, whether or not anything was written. For an already-published
 *    plan this is the ORIGINAL timestamp, unmoved.
 */
export interface ExamPublicationDecision {
  readonly change: boolean;
  readonly expectedPublishedAt: number | null;
  readonly nextPublishedAt: number | null;
  readonly resultingPublishedAt: number | null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Decide, purely and totally. Mutates nothing, reads no clock, and returns a
 * FROZEN, JSON-safe object.
 *
 *  - PUBLISH from unpublished   -> write `now`;
 *  - PUBLISH from published     -> NO-OP, and the ORIGINAL timestamp is reported
 *                                  unchanged (a re-publish never moves it);
 *  - UNPUBLISH from published   -> write `null`, conditional on that exact
 *                                  timestamp;
 *  - UNPUBLISH from unpublished -> NO-OP.
 *
 * TWO FAIL-CLOSED NORMALIZATIONS, both in the safe direction:
 *
 *  - a non-finite `currentPublishedAt` is read as "never published", which is the
 *    same rule the committed loader applies, so a malformed stored value can only
 *    ever make content LESS visible, never more;
 *  - a non-finite `now` cannot become a publication instant, so a PUBLISH that
 *    would have to use one is a NO-OP instead. Storing `NaN`, `Infinity` or a
 *    garbage instant would publish the plan while making every later comparison
 *    against that column meaningless. UNPUBLISH is unaffected: clearing the
 *    column needs no clock at all.
 */
export function decideExamPlanPublication(
  input: ExamPublicationDecisionInput,
): ExamPublicationDecision {
  const current = isFiniteNumber(input.currentPublishedAt)
    ? input.currentPublishedAt
    : null;

  if (input.operation === "PUBLISH") {
    if (current !== null) {
      // Already published: nothing is written, and the stored instant stands.
      return decision(false, current, current, current);
    }
    if (!isFiniteNumber(input.now)) {
      // No usable clock: refuse to invent an instant. Nothing is written.
      return decision(false, null, null, null);
    }
    return decision(true, null, input.now, input.now);
  }

  // UNPUBLISH.
  if (current === null) {
    // Already unpublished: nothing is written.
    return decision(false, null, null, null);
  }
  return decision(true, current, null, null);
}

function decision(
  change: boolean,
  expectedPublishedAt: number | null,
  nextPublishedAt: number | null,
  resultingPublishedAt: number | null,
): ExamPublicationDecision {
  return Object.freeze({
    change,
    expectedPublishedAt,
    nextPublishedAt,
    resultingPublishedAt,
  });
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
export interface VerifiedExamPublicationCourseContext {
  readonly courseOfferingId: string;
  readonly status: string;
}

/**
 * A plan, as this operation is allowed to see it: its id, and the ONE column it
 * exists to change.
 *
 * No definitions, no sessions, no source dates, no `individualPublishedAt`, no
 * `createdAt`, no `updatedAt`, no offering relation. A value this module cannot
 * see is a value it cannot leak into a result or branch on by mistake.
 */
export interface ExamPlanPublicationRow {
  readonly id: string;
  /** Epoch ms, or `null` when the plan has never been published. */
  readonly publishedAt: number | null;
}

/**
 * The complete injected boundary.
 *
 * Note what is ABSENT and therefore unrepresentable: there is no dependency that
 * can create, upsert or delete a plan, write any other plan column, touch a
 * definition, a session, an assignment, a supervisor, a break or a beginner
 * child, read or write `individualPublishedAt`, send a notification, resolve a
 * capability, or read another course. No dependency accepts a plan id from the
 * caller, and none accepts a timestamp from the caller.
 *
 * The two predicates take `unknown` and return a boolean: this module never
 * inspects, unwraps, logs or echoes a raw error, so no database detail can leak
 * into a result through them.
 */
export interface SetExamPlanPublicationDeps {
  /**
   * Authorize the actor and verify the REQUESTED offering exists. May throw the
   * project's typed not-found, and may REDIRECT for an unauthenticated or
   * non-admin caller — the redirect must reach the framework untouched.
   */
  requireCourseContext(
    requestedCourseOfferingId: string,
  ): Promise<VerifiedExamPublicationCourseContext>;

  /** Gate the mutation on the VERIFIED offering status. Throws to deny. */
  assertConfigurationAllowed(status: string): void;

  /**
   * The SERVER clock, in epoch ms. Injected rather than read, so the publish
   * instant is testable and so no caller can supply one.
   */
  now(): number;

  /**
   * Find the plan of the VERIFIED offering, with its publication state. `null`
   * means "this offering has no plan", which this operation REFUSES rather than
   * creating one: bringing a plan into existence is a different, explicit manager
   * action, and a publish that silently created a plan would make the moment of
   * creation untraceable.
   */
  findPlanPublicationByCourseOfferingId(
    verifiedCourseOfferingId: string,
  ): Promise<ExamPlanPublicationRow | null>;

  /**
   * The SINGLE write, and it is CONDITIONAL. Store `nextPublishedAt` on the plan
   * identified by BOTH the verified offering and the server-resolved plan id, and
   * ONLY while its stored publication state still equals `expectedPublishedAt`.
   *
   * Returns whether a row was actually changed. `false` means a concurrent writer
   * moved the state, and the orchestration reports that rather than retrying.
   * Called AT MOST ONCE per invocation, on every path.
   */
  setPublicationIfCurrent(
    verifiedCourseOfferingId: string,
    planId: string,
    expectedPublishedAt: number | null,
    nextPublishedAt: number | null,
  ): Promise<boolean>;

  /** Is this throw "the requested offering does not exist"? */
  isCourseNotFoundError(error: unknown): boolean;

  /** Is this throw "the offering's lifecycle forbids this operation"? */
  isOperationNotAllowedError(error: unknown): boolean;
}

// ===========================================================================
// The result model
// ===========================================================================

/**
 * Every way this operation can be refused.
 *
 * `unknown_operation` is a FAIL-CLOSED input refusal, not a lifecycle one:
 * `operation_not_allowed` means "this offering's lifecycle forbids configuring
 * exams", while `unknown_operation` means "that is not one of the two
 * transitions". Keeping them distinct is what stops a future caller from reading
 * a typo as a permission problem.
 *
 * There is deliberately no `already_published`, `already_unpublished` or
 * `no_change` refusal — those are SUCCESSES — and no `unexpected` code.
 */
export type SetExamPlanPublicationRefusalCode =
  | "offering_not_found"
  | "operation_not_allowed"
  | "unknown_operation"
  | "plan_not_found"
  | "stale_write";

/** What the plan's publication state IS when the call returns. */
export type ExamPlanPublicationStatus = "PUBLISHED" | "UNPUBLISHED" | "NO_CHANGE";

/**
 * A discriminated, JSON-safe, frozen result.
 *
 * The SUCCESS arm carries what THIS call did (`PUBLISHED`, `UNPUBLISHED`, or
 * `NO_CHANGE` when the plan was already in the requested state) and the plan's
 * publication instant in epoch ms — the same numeric convention the committed
 * publication-status core and plan loader use, so no `Date` ever has to survive a
 * Server Action's serialization boundary.
 *
 * Nothing in either arm is a `Date`, Map, Set, BigInt, Error or class instance,
 * and nothing carries a plan id, a course offering id, an actor id, a raw error
 * or a database detail.
 */
export type SetExamPlanPublicationResult =
  | {
      readonly ok: true;
      readonly status: ExamPlanPublicationStatus;
      /** Epoch ms, or `null` when the plan is not published. */
      readonly publishedAt: number | null;
    }
  | {
      readonly ok: false;
      readonly code: SetExamPlanPublicationRefusalCode;
    };

function refuse(
  code: SetExamPlanPublicationRefusalCode,
): SetExamPlanPublicationResult {
  return Object.freeze({ ok: false as const, code });
}

function succeed(
  status: ExamPlanPublicationStatus,
  publishedAt: number | null,
): SetExamPlanPublicationResult {
  return Object.freeze({ ok: true as const, status, publishedAt });
}

// ===========================================================================
// The orchestration
// ===========================================================================

/**
 * Publish or unpublish the ExamPlan of ONE authorized, lifecycle-permitted course
 * offering.
 *
 * The order is the safety contract, and it is enforced by construction: each
 * step's output is the next step's only input, so no step can be reordered
 * without the verified offering id or the stored publication state becoming
 * unavailable.
 *
 * Each `try` wraps EXACTLY ONE dependency call and asks EXACTLY ONE classifier.
 * Nothing is caught broadly, and an unrecognized error is re-thrown with its
 * identity intact — including a `NEXT_REDIRECT` from the authorization boundary.
 */
export async function setExamPlanPublicationWithDeps(
  courseOfferingId: string,
  operation: unknown,
  deps: SetExamPlanPublicationDeps,
): Promise<SetExamPlanPublicationResult> {
  // 1. Authorization + exact-offering verification FIRST. Nothing about exams or
  //    plans is touched — not even a read — before this resolves, so publication
  //    state cannot be probed by an unauthorized caller.
  let context: VerifiedExamPublicationCourseContext;
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

  // 3. Fail closed on anything that is not one of the two transitions, BEFORE a
  //    single exam row is read.
  if (!isExamPublicationOperation(operation)) {
    return refuse("unknown_operation");
  }

  // The requested, unverified value is never read again from here on.
  const verifiedCourseOfferingId = context.courseOfferingId;

  // 4. The plan of the VERIFIED offering, and its publication state.
  const plan = await deps.findPlanPublicationByCourseOfferingId(
    verifiedCourseOfferingId,
  );

  // 5. No plan. This operation NEVER creates one.
  if (plan === null) {
    return refuse("plan_not_found");
  }

  // 6. The pure decision, from the STORED state and the SERVER clock.
  const outcome = decideExamPlanPublication({
    operation,
    currentPublishedAt: plan.publishedAt,
    now: deps.now(),
  });

  // 7. The plan is already in the requested state. NOTHING is written — in
  //    particular an already-published plan does NOT have its timestamp moved
  //    forward — and the stored instant is reported as it stands.
  if (!outcome.change) {
    return succeed("NO_CHANGE", outcome.resultingPublishedAt);
  }

  // 8. The ONE write, conditional on the state the decision was made from.
  const written = await deps.setPublicationIfCurrent(
    verifiedCourseOfferingId,
    plan.id,
    outcome.expectedPublishedAt,
    outcome.nextPublishedAt,
  );

  // 9. Zero rows: another manager changed the publication state in the gap. The
  //    write is NOT retried — retrying would overwrite their newer state with
  //    this call's older decision.
  if (!written) {
    return refuse("stale_write");
  }

  return succeed(
    operation === "PUBLISH" ? "PUBLISHED" : "UNPUBLISHED",
    outcome.resultingPublishedAt,
  );
}
