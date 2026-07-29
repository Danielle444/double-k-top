/**
 * EXAM PLAN P1 — the PURE orchestration of ONE explicit, IDEMPOTENT ExamPlan
 * CREATE.
 *
 * PURE by construction: no Prisma, no DB, no transaction, no clock, no
 * randomness, no env, no auth/session/cookie, no filesystem, no network, no
 * Next, no `server-only`, no `"use server"`. This module imports NOTHING — not
 * even a sibling exam core — so every effect the operation needs arrives through
 * the injected `CreateExamPlanDeps`, and the ORDER in which authorization,
 * lifecycle gating, the existence check and the write happen is stated once,
 * here, and is testable without a database.
 *
 * WHAT THIS ANSWERS (and only this):
 *  - in which EXACT order must a plan create authorize, gate, look and write?
 *  - what does "the plan already exists" mean — and why is it a SUCCESS?
 *  - what happens when two managers press the button at the same moment?
 *
 * ===========================================================================
 * ONE PLAN PER OFFERING, AND CREATION IS EXPLICIT
 * ===========================================================================
 * `ExamPlan.courseOfferingId` is `@unique`: the database permits exactly ONE
 * plan per CourseOffering. This operation is the ONLY way a plan comes into
 * existence, and it is driven by a deliberate manager action.
 *
 * It is therefore NOT a lazy "ensure" helper that a read path may call. A read
 * that finds no plan must report "no plan yet" and stop; it must never write one
 * as a side effect, because a GET that mutates makes the moment of creation
 * untraceable and would let any reader — including an unauthorized one whose
 * refusal happens later — bring a row into being.
 *
 * The distinction is enforced structurally rather than by convention: the write
 * dependency is not reachable except through this exported orchestration, which
 * takes the authorization boundary as its FIRST step.
 *
 * ===========================================================================
 * ALREADY-EXISTS IS A SUCCESS, NOT A REFUSAL
 * ===========================================================================
 * The caller asks for one thing: "let this offering have an exam plan". If a
 * plan is already there, that request is ALREADY SATISFIED, so the outcome is
 * `{ ok: true, planId, created: false }` — the same plan id a fresh create would
 * have produced, with `created` telling the caller which of the two happened.
 *
 * Reporting a conflict instead would be actively harmful: a manager who
 * double-clicks, or who opens the exams page in two tabs, would be shown an
 * error for a situation that is completely fine, and a caller that redirects on
 * success would be stranded on a failure screen while the plan sits there ready.
 *
 * `created` exists so the caller can phrase its own message honestly ("plan
 * created" vs "plan already existed") and so a future audit binding can record
 * only the transition that actually occurred. It is NOT a permission, NOT a
 * lock, and nothing in this module behaves differently because of it.
 *
 * ===========================================================================
 * THE CONCURRENT WRITER, AND WHY THE UNIQUE VIOLATION IS ALSO A SUCCESS
 * ===========================================================================
 * The existence check and the write are two separate statements, so there is a
 * window between them. Two managers acting at the same instant can BOTH see "no
 * plan" and both attempt the create; the database's unique index lets exactly one
 * of them win, and the loser is handed a P2002 on
 * `exam_plans_courseOfferingId_key`.
 *
 * That loser has not failed at anything. The desired end state — this offering
 * has a plan — HOLDS. So the conflict is not surfaced: the plan is RE-READ and
 * reported as `{ ok: true, planId, created: false }`, exactly as if the caller
 * had arrived a second later and taken the already-exists path. Both managers see
 * the same plan, and no duplicate row can exist because the DATABASE prevented
 * it, not because this module checked first.
 *
 * The pre-check is a nicety; THE UNIQUE INDEX IS THE PROTECTION. This module's
 * job on the race path is translation, not prevention.
 *
 * THE RE-READ IS NOT ASSUMED TO SUCCEED. If it finds nothing, something the
 * module's model does not cover has happened — the winner's transaction rolled
 * back after raising the conflict, the row was deleted in the same instant, or
 * the injected conflict classifier accepted an error that was never a
 * courseOfferingId violation at all. Inventing a plan id, retrying in a loop, or
 * reporting a success with no plan behind it would each turn a real anomaly into
 * a silent one, so the outcome is the honest `plan_conflict` — the ONE refusal
 * that says "the state is not what any of the modelled paths describe".
 *
 * There is NO retry loop. `createExamPlanForCourseOffering` is called AT MOST
 * ONCE per invocation, on every path, so a pathological classifier or a flapping
 * database can never be turned into a write storm from here.
 *
 * ===========================================================================
 * THE CALLER SUPPLIES A REQUEST, NEVER A GRANT
 * ===========================================================================
 * The only argument besides the dependency bundle is a REQUESTED
 * `courseOfferingId`. There is no parameter — and no object field — through which
 * a caller could supply a `planId`, an actor id, a publication timestamp, a
 * source date, a `created` flag, a stale-write token or a transaction handle.
 *
 * A plan id is something this operation PRODUCES, never something it accepts: a
 * caller-supplied id would let one offering's plan be attached to another
 * offering, which the unique index alone would not catch.
 *
 * The requested offering id is used for exactly ONE thing — asking the course
 * boundary to verify it — and is never read again. Every later step receives
 * `context.courseOfferingId`, the id the boundary CONFIRMED, so a caller cannot
 * be authorized for one offering while the lookup and the write land on another.
 *
 * ===========================================================================
 * THE LOCKED ORDER, AND WHY EACH STEP PRECEDES THE NEXT
 * ===========================================================================
 *   1. requireCourseContext(requested id)          — admin + exact-offering
 *   2. assertConfigurationAllowed(status)          — course-lifecycle gate
 *   3. findExamPlanByCourseOfferingId(VERIFIED id) — does one already exist?
 *   4. it exists                                   -> ok, created: false
 *   5. createExamPlanForCourseOffering(VERIFIED id)— the single write
 *   6. P2002 on the offering key                   -> re-read, ok, created:false
 *   7. re-read found nothing                       -> plan_conflict
 *   8. narrow success DTO                          -> ok, created: true
 *
 * The consequences are the point:
 *  - NOTHING is looked up for a course the actor may not access, so plan
 *    EXISTENCE cannot be probed by an unauthorized caller: "does this offering
 *    have exams yet?" is not answerable without passing step 1;
 *  - the lifecycle gate runs BEFORE any exam query, so an ARCHIVED offering is
 *    refused without a single exam read and certainly without a write;
 *  - the write is reached ONLY after both gates, so no refusal path can leave a
 *    plan behind.
 *
 * ===========================================================================
 * WHAT THIS DELIBERATELY DOES NOT DO
 * ===========================================================================
 *  - it writes NO `publishedAt`. A newly created plan is UNPUBLISHED, and it
 *    becomes published only through the separate, reviewed publication slice.
 *    Nothing here can set, clear or read that column, and no dependency exposes
 *    it — so "create" can never quietly mean "create and publish";
 *  - it writes NO source date. Which Teaching-Practice dates are exam dates is an
 *    explicit product selection made in its own slice, never a by-product of
 *    creating the plan;
 *  - it creates NO definition and NO session. A new plan is EMPTY. There is no
 *    seeded, defaulted or hardcoded exam name anywhere in this module;
 *  - it DELETES nothing and UPDATES nothing. There is no upsert: an upsert would
 *    make "create" capable of silently overwriting an existing plan's columns,
 *    which is precisely the behaviour the explicit find/create split exists to
 *    prevent;
 *  - it sends NO notification, resolves NO capability, and reads NO other course;
 *  - it PERFORMS NO IO and knows nothing of a client, a transaction, a row or a
 *    query. Every dependency is an opaque promise or a boolean predicate.
 *
 * ===========================================================================
 * ONLY THREE KNOWN FAILURES ARE CLASSIFIED — EVERYTHING ELSE PROPAGATES
 * ===========================================================================
 * Exactly three injected predicates may convert a thrown error into an outcome:
 * the course not-found, the lifecycle denial and the plan's offering-uniqueness
 * conflict. Every other throw — an infrastructure fault, a programming error, a
 * failed lookup, an unexpected write failure — LEAVES THIS MODULE UNCHANGED.
 *
 * There is no `unexpected` code and no catch-all `catch`. That is deliberate: a
 * generic failure code would let a real defect render as an ordinary,
 * unremarkable form error that nobody investigates.
 *
 * CRITICALLY, an admin boundary denies by REDIRECTING (a Next `NEXT_REDIRECT`
 * throw). Because each classifier is asked about one specific error shape and
 * anything unrecognized is re-thrown, a redirect passes straight through and the
 * framework still performs it. A redirect must never be translated into a
 * refusal — an admin who is simply not logged in would then see "not found"
 * instead of the login page.
 */

// ===========================================================================
// The injected boundary
// ===========================================================================

/**
 * The course context a plan create may act on, AFTER the boundary verified it.
 *
 * Deliberately TWO fields. It is not the project's admin course context and not a
 * CourseOffering row: a name, a level, an activity year or a date window would be
 * data this operation has no business reading, and a generated Prisma type here
 * would end this module's purity.
 *
 * `courseOfferingId` is the DB-VERIFIED id — the one the boundary confirmed
 * exists — and is the ONLY id that reaches the lookup and the write. `status` is a
 * plain `string` rather than the generated enum for the same purity reason; the
 * committed policy the gate consults is default-deny, so an unrecognized status is
 * refused rather than waved through.
 */
export interface VerifiedExamPlanCourseContext {
  readonly courseOfferingId: string;
  readonly status: string;
}

/**
 * A plan, as this operation is allowed to see it: its id and NOTHING else.
 *
 * No `publishedAt`, no timestamps, no offering relation, no definitions, no
 * sessions, no source dates. A create must not be able to make a decision from
 * data it should not have read — in particular it must not branch on whether the
 * existing plan is published, because publication is a separate decision and
 * "already exists" is the same answer either way.
 *
 * The SAME shape is returned by the existence lookup and by the write, because
 * the caller genuinely cannot tell — and must not need to tell — which produced
 * it beyond the `created` flag.
 */
export interface ResolvedExamPlan {
  readonly id: string;
}

/**
 * The complete injected boundary.
 *
 * Note what is ABSENT and therefore unrepresentable: there is no dependency that
 * can update or delete a plan, publish or unpublish one, write a source date,
 * create a definition or a session, send a notification, resolve a capability, or
 * read another course. There is no upsert, and no dependency accepts a plan id.
 * The operation is structurally incapable of doing anything but bringing exactly
 * one empty, unpublished plan into existence for one authorized offering.
 *
 * The three predicates take `unknown` and return a boolean: this module never
 * inspects, unwraps, logs or echoes a raw error, so no database detail can leak
 * into a result through them.
 */
export interface CreateExamPlanDeps {
  /**
   * Authorize the actor and verify the REQUESTED offering exists. May throw the
   * project's typed not-found, and may REDIRECT for an unauthenticated or
   * non-admin caller — the redirect must reach the framework untouched.
   */
  requireCourseContext(
    requestedCourseOfferingId: string,
  ): Promise<VerifiedExamPlanCourseContext>;

  /** Gate the mutation on the VERIFIED offering status. Throws to deny. */
  assertConfigurationAllowed(status: string): void;

  /**
   * Find the plan of the VERIFIED offering. `null` means "no plan exists".
   *
   * Called a SECOND time on the conflict path — and only there — to read back the
   * plan the concurrent winner created. It is the one dependency that may run
   * twice, which is why it must be a pure read that writes nothing.
   */
  findExamPlanByCourseOfferingId(
    verifiedCourseOfferingId: string,
  ): Promise<ResolvedExamPlan | null>;

  /**
   * The SINGLE write: bring one EMPTY, UNPUBLISHED plan into existence for the
   * VERIFIED offering. It takes no plan id (the server assigns one), no
   * publication timestamp and no initial content, and it is called AT MOST ONCE
   * per invocation.
   */
  createExamPlanForCourseOffering(
    verifiedCourseOfferingId: string,
  ): Promise<ResolvedExamPlan>;

  /** Is this throw "the requested offering does not exist"? */
  isCourseNotFoundError(error: unknown): boolean;

  /** Is this throw "the offering's lifecycle forbids this operation"? */
  isOperationNotAllowedError(error: unknown): boolean;

  /**
   * Is this throw the plan's one-per-offering uniqueness conflict — i.e. did a
   * concurrent create win the race?
   */
  isPlanCourseOfferingUniqueConflict(error: unknown): boolean;
}

// ===========================================================================
// The result model
// ===========================================================================

/**
 * Every way this operation can be refused. Each is fully described by the code
 * itself, so no arm carries diagnostics: the operation submits no fields, so
 * there is nothing a per-field issue list could describe, and there is no
 * validation payload of any kind.
 *
 * `plan_conflict` is deliberately NOT "the plan already exists" — that case is a
 * SUCCESS. It means only "the conflict re-read found no plan", which no modelled
 * path produces.
 *
 * There is deliberately no `unexpected`, `stale_write`, `invalid_input`,
 * `plan_not_found`, `already_exists`, `duplicate_name` or `plan_published` code.
 */
export type CreateExamPlanRefusalCode =
  | "offering_not_found"
  | "operation_not_allowed"
  | "plan_conflict";

/**
 * A discriminated, JSON-safe, frozen result.
 *
 * The SUCCESS arm carries the plan id and a boolean saying whether THIS call
 * brought it into existence. Nothing in either arm is a Date, Map, Set, BigInt,
 * Error or class instance, and nothing carries a course offering id, an actor id,
 * a timestamp, a publication state, a raw error or a database detail.
 */
export type CreateExamPlanResult =
  | {
      readonly ok: true;
      readonly planId: string;
      /** `true` only when THIS call performed the write. */
      readonly created: boolean;
    }
  | {
      readonly ok: false;
      readonly code: CreateExamPlanRefusalCode;
    };

function refuse(code: CreateExamPlanRefusalCode): CreateExamPlanResult {
  return Object.freeze({ ok: false as const, code });
}

/**
 * The single success constructor, used by all three success paths, so a fresh
 * create and an already-existing plan are IDENTICAL in shape and differ only in
 * the one field that describes what happened.
 */
function succeed(planId: string, created: boolean): CreateExamPlanResult {
  return Object.freeze({ ok: true as const, planId, created });
}

// ===========================================================================
// The offering-uniqueness classifier (pure, Prisma-free)
// ===========================================================================

/**
 * The database index behind `ExamPlan.courseOfferingId @unique`. Named here as a
 * STRING so this module can recognize the conflict without importing a generated
 * client.
 */
const EXAM_PLAN_OFFERING_INDEX = "exam_plans_courseOfferingId_key";

/** The conflicting column, as it appears in a field-shaped conflict report. */
const EXAM_PLAN_OFFERING_FIELD = "courseOfferingId";

/**
 * Recognize the unique-constraint violation (P2002) that corresponds to
 * `ExamPlan`'s ONE-PLAN-PER-OFFERING rule — structurally, and WITHOUT importing a
 * database client. Lives in this pure core, following the project's existing
 * convention for the committed duplicate-name classifiers, precisely so it can be
 * proven at runtime by a DB-free test instead of only inspected as source text.
 *
 * WHY THE FALLBACK IS SAFE. The bound writer is required to be a single insert
 * into `exam_plans`, a table with exactly two unique keys: the primary key on
 * `id` and this one on `courseOfferingId`. The primary key is a freshly generated
 * cuid, so it cannot realistically collide; a P2002 raised by that statement is
 * therefore the offering conflict. When readable target metadata IS reported this
 * function still VERIFIES it — a target naming only `id` or the primary key is
 * correctly NOT classified and propagates — and only an absent or unreadable
 * target falls back.
 *
 * It is deliberately narrow in the other direction too: a non-object, a different
 * error code, and a framework redirect (which carries a `digest`, not a `code`)
 * are all rejected, so no redirect and no unrelated failure can be laundered into
 * a spurious success. The offending value is never inspected beyond these fields,
 * copied or echoed.
 *
 * WHY MISCLASSIFICATION IS STILL SAFE. Even if this predicate wrongly accepted
 * some other conflict, the caller would not be told a false success: the
 * re-read would find no plan and the outcome would be `plan_conflict`.
 */
export function isExamPlanOfferingConflictError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  if ((error as { code?: unknown }).code !== "P2002") {
    return false;
  }

  const target = (error as { meta?: { target?: unknown } }).meta?.target;

  // The field-array form, e.g. ["courseOfferingId"].
  if (Array.isArray(target)) {
    return target.some((entry) => typeof entry === "string" && namesTheOfferingKey(entry));
  }

  // The index-name form, e.g. "exam_plans_courseOfferingId_key".
  if (typeof target === "string") {
    return namesTheOfferingKey(target);
  }

  // Unreadable/absent metadata: attributed to the offering conflict for the
  // reason documented above.
  return true;
}

/**
 * Does one target token name the offering column, or the index that enforces it?
 * Checked as an EXACT field name or the EXACT index name, so the sibling primary
 * key — whose only token is `id` — never matches.
 */
function namesTheOfferingKey(token: string): boolean {
  return token === EXAM_PLAN_OFFERING_FIELD || token === EXAM_PLAN_OFFERING_INDEX;
}

// ===========================================================================
// The orchestration
// ===========================================================================

/**
 * Ensure exactly ONE empty, unpublished ExamPlan exists for one authorized,
 * lifecycle-permitted course offering, and report whether THIS call created it.
 *
 * The order is the safety contract, and it is enforced by construction: each
 * step's output is the next step's only input, so no step can be reordered
 * without the verified offering id becoming unavailable.
 *
 * Each `try` wraps EXACTLY ONE dependency call and asks EXACTLY ONE classifier.
 * Nothing is caught broadly, and an unrecognized error is re-thrown with its
 * identity intact — including a `NEXT_REDIRECT` from the authorization boundary.
 */
export async function createExamPlanWithDeps(
  courseOfferingId: string,
  deps: CreateExamPlanDeps,
): Promise<CreateExamPlanResult> {
  // 1. Authorization + exact-offering verification FIRST. Nothing about exams or
  //    plans is touched — not even a read — before this resolves.
  let context: VerifiedExamPlanCourseContext;
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

  // The requested, unverified value is never read again from here on: everything
  // downstream sees the id the boundary CONFIRMED.
  const verifiedCourseOfferingId = context.courseOfferingId;

  // 3. Does a plan already exist for the VERIFIED offering?
  const existing = await deps.findExamPlanByCourseOfferingId(verifiedCourseOfferingId);

  // 4. It does — and that means the caller's request is already satisfied. This
  //    is a SUCCESS with `created: false`, and NO write is attempted. There is no
  //    upsert here on purpose: an existing plan's columns are never touched.
  if (existing) {
    return succeed(existing.id, false);
  }

  // 5. The single write: one empty, unpublished plan for the VERIFIED offering.
  //    No plan id, no publication timestamp and no content are supplied.
  let created: ResolvedExamPlan;
  try {
    created = await deps.createExamPlanForCourseOffering(verifiedCourseOfferingId);
  } catch (error) {
    // 6. THE RACE. Another manager's create landed between step 3 and step 5 and
    //    the unique index refused ours. The desired end state holds, so the
    //    winner's plan is read back and reported as the already-exists outcome.
    //    The create is NOT retried.
    if (!deps.isPlanCourseOfferingUniqueConflict(error)) {
      throw error;
    }

    const winner = await deps.findExamPlanByCourseOfferingId(verifiedCourseOfferingId);

    // 7. No plan behind the conflict: an anomaly none of the modelled paths
    //    describe. Reported honestly rather than retried or invented.
    if (!winner) {
      return refuse("plan_conflict");
    }

    return succeed(winner.id, false);
  }

  // 8. The narrow success DTO: the new plan's id, and the fact that THIS call is
  //    the one that created it.
  return succeed(created.id, true);
}
