/**
 * EXAM EX-S5B-5A — the PURE orchestration of the ADMIN ExamDefinition LIST read.
 *
 * PURE by construction: no database client, no transaction, no clock, no
 * randomness, no environment, no auth/session/cookie, no filesystem, no network,
 * no Next, no `server-only`, no `"use server"`. This module declares NO imports
 * at all. Every effect it needs arrives through the injected
 * {@link ReadExamDefinitionsForAdminDeps}.
 *
 * WHAT THIS ANSWERS (and only this):
 *  - in which EXACT order must the admin definition list authorize, gate,
 *    resolve the plan, read the definitions and count their usage?
 *  - what does a course offering with NO exam plan look like?
 *  - what, precisely, may the resulting view contain?
 *
 * ===========================================================================
 * THIS IS A READ, AND ONLY A READ
 * ===========================================================================
 * No dependency in the injected boundary can create, update, upsert, delete,
 * reorder, publish or unpublish anything, open a transaction, send a
 * notification or resolve a capability. The boundary is FIVE functions: the
 * authorization/verification step, the lifecycle gate, one plan lookup, one
 * definition list and one batched usage count. A future edit that wants to write
 * cannot do it through this module — there is nothing here to write with.
 *
 * ===========================================================================
 * THE LOCKED ORDER
 * ===========================================================================
 *   1. requireCourseContext(requested id)    — admin + exact-offering boundary
 *   2. assertHistoricalReadAllowed(status)   — the course-lifecycle READ gate
 *   3. findExamPlanByCourseOfferingId(id)    — the VERIFIED offering id only
 *   4. no plan                               -> the empty, plan-absent view
 *   5. findDefinitionsByPlanId(plan.id)      — the SERVER-resolved plan id only
 *   6. no definition                         -> the empty, plan-present view,
 *                                               and NO count query at all
 *   7. countSessionsByDefinition(plan.id)    — ONE batched, grouped count
 *   8. the frozen, plain, JSON-safe view
 *
 * Every step after the first two is scoped by a SERVER-DERIVED id. The requested
 * offering id is a REQUEST, never a grant: it reaches the authorization
 * dependency and nothing else, and only the id that dependency VERIFIED reaches
 * the plan lookup. The plan id is then the whole scope of the definition read
 * and of the usage count, so a definition of another course is not "filtered
 * out" — it is never asked for.
 *
 * ===========================================================================
 * NO PER-DEFINITION QUERY, EVER
 * ===========================================================================
 * The usage count arrives as ONE batched, already-grouped list, and is indexed
 * in memory. There is no dependency that takes a `definitionId`, so a caller
 * cannot bind a per-row count even by accident: the shape of the boundary is
 * what forbids the N+1, not a rule someone has to remember. A definition with no
 * grouped row is reported as ZERO — an absent group means "no session refers to
 * this definition", which is exactly zero.
 *
 * ===========================================================================
 * WHAT THIS READ DELIBERATELY CANNOT SEE
 * ===========================================================================
 * The view carries the manager's own configuration of each exam, plus how many
 * sessions use it. It carries NO session row, NO assignment, NO student, NO
 * instructor, NO Teaching-Practice lesson, NO source-lesson detail, NO parent or
 * child detail, NO diagnostics — and no grade, score or evaluation of any kind,
 * which the Exams area does not model at all. None of those is reachable: no
 * dependency returns them, and no field of the result can express them.
 *
 * The plan's `publishedAt` is read, because a manager configuring definitions
 * must be told whether the plan is already published. It is read ONLY as an
 * instant, and this module never changes it.
 *
 * ===========================================================================
 * NAMES ARE CARRIED VERBATIM
 * ===========================================================================
 * A definition's name is the manager's own text and the group label of the "by
 * exam" view. It is NOT trimmed, case-folded, deduplicated, sorted by or
 * substituted here: `@@unique([planId, name])` is what makes two names distinct
 * in one plan, and this reader's job is to show what the database holds. Two
 * definitions carrying the same name are therefore reported as two rows — if the
 * database ever supplies them, the manager sees the truth rather than a silently
 * merged row.
 *
 * ===========================================================================
 * NO REFUSAL CODES — FAILURES PROPAGATE WITH THEIR IDENTITY INTACT
 * ===========================================================================
 * Unlike the write slices, this module classifies NOTHING. It contains no `try`,
 * no `catch` and no error predicate, so the typed "that offering does not exist",
 * the typed lifecycle denial, an infrastructure failure and the authorization
 * boundary's redirect all reach the caller unchanged. A read must never turn a
 * denial into an empty list: "you may not see this" and "there is nothing here"
 * are different sentences, and the surface that eventually renders this view is
 * the layer that decides how to say each one.
 *
 * The ONE absence this module does describe is the honest one: a course offering
 * that has no exam plan yet. That is not a failure, and `planExists: false` is
 * how the future admin page knows to offer "create a plan" rather than "no exams
 * configured".
 *
 * ===========================================================================
 * DATES ARE NUMBERS ABOVE THE IO LINE
 * ===========================================================================
 * Every instant enters this module as EPOCH MILLISECONDS and leaves as epoch
 * milliseconds. No `Date` is constructed, accepted, compared or returned, so the
 * result round-trips through JSON unchanged and no timezone convention is
 * re-derived here.
 */

// ===========================================================================
// The injected boundary
// ===========================================================================

/**
 * The course context this read may act on, AFTER the boundary verified it.
 *
 * Two fields, matching the committed write cores: the DB-VERIFIED offering id
 * (the only id allowed to scope a query) and the offering's status (the only
 * input the lifecycle gate needs). The offering's name, level, ActivityYear and
 * dates are none of this read's business. `status` is deliberately widened to
 * `string` so this module needs no generated database enum.
 */
export interface VerifiedExamDefinitionReadCourseContext {
  readonly courseOfferingId: string;
  readonly status: string;
}

/**
 * The plan of the verified offering: its id, and its publication instant.
 *
 * No source dates, no session, no definition, no offering relation and no
 * `createdAt`/`updatedAt` — a plan-level timestamp is not part of this view.
 */
export interface ResolvedExamPlanForAdminRead {
  readonly id: string;
  /** Epoch milliseconds, or `null` for a DRAFT plan. */
  readonly publishedAt: number | null;
}

/**
 * One stored `ExamDefinition`, as the IO shell reads it.
 *
 * Exactly the manager-authored configuration, its position, and its version
 * stamp. `kind` is a plain `string` here for the same reason `status` is: the
 * pure core is not the place that owns a generated enum. No `planId` field
 * exists — the plan is the caller's scope, not a per-row attribute this view
 * repeats — and no `createdAt`, because nothing displays it.
 */
export interface StoredAdminExamDefinitionRow {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly durationMinutes: number;
  readonly parallelCapacity: number;
  readonly requiresInstructedTrainee: boolean;
  readonly requiresLessonTopic: boolean;
  readonly requiresDiscipline: boolean;
  readonly orderIndex: number;
  /** Epoch milliseconds. The row's version, as the edit slice's token. */
  readonly updatedAt: number;
}

/**
 * ONE grouped usage count, as the batched count query reports it.
 *
 * `planId` is carried so this module can VERIFY that every group belongs to the
 * plan it asked about, rather than trusting the shape of what it was handed. It
 * mirrors the composite foreign key `ExamSession(planId, definitionId) ->
 * ExamDefinition(planId, id)`, which is what makes a cross-plan session ->
 * definition link unrepresentable in the first place.
 *
 * It carries a COUNT and nothing else: no session id, no date, no arena, no
 * assignment and no participant. How many sessions use an exam is a
 * configuration fact; WHICH sessions they are is a different read.
 */
export interface ExamDefinitionSessionCountRow {
  readonly planId: string;
  readonly definitionId: string;
  readonly sessionCount: number;
}

/**
 * The complete injected boundary — five reads, and nothing else.
 *
 * Note what is ABSENT and therefore unrepresentable: no dependency can write,
 * publish, count a SINGLE definition, read a session row, read a student or an
 * instructor, reach Teaching Practice, resolve a capability, open a transaction
 * or read another course.
 */
export interface ReadExamDefinitionsForAdminDeps {
  /**
   * Authorize the actor as an admin and verify the REQUESTED offering exists.
   * May throw the project's typed not-found, and may REDIRECT an
   * unauthenticated or non-admin caller. Runs BEFORE every query.
   */
  requireCourseContext(
    requestedCourseOfferingId: string,
  ): Promise<VerifiedExamDefinitionReadCourseContext>;

  /**
   * Gate the READ on the VERIFIED offering status. Throws to deny. A read gate
   * is not a write gate: an ARCHIVED offering's exam configuration remains
   * readable history, while its definitions may no longer be edited.
   */
  assertHistoricalReadAllowed(status: string): void;

  /** The plan of the VERIFIED offering. `null` means "no plan exists yet". */
  findExamPlanByCourseOfferingId(
    verifiedCourseOfferingId: string,
  ): Promise<ResolvedExamPlanForAdminRead | null>;

  /**
   * EVERY definition of ONE plan, in one query. The IO shell orders them; this
   * module re-imposes the same total order regardless, because `orderIndex`
   * alone is not unique (the committed create binding documents that concurrent
   * appends may share a position).
   */
  findDefinitionsByPlanId(planId: string): Promise<readonly StoredAdminExamDefinitionRow[]>;

  /**
   * The usage of EVERY definition of ONE plan, as ONE batched, grouped count.
   * There is deliberately no `definitionId` parameter: a per-definition count is
   * not expressible through this boundary.
   */
  countSessionsByDefinition(planId: string): Promise<readonly ExamDefinitionSessionCountRow[]>;
}

// ===========================================================================
// The result model
// ===========================================================================

/**
 * ONE definition, as the admin definition-management view shows it.
 *
 * Eleven fields: the ten the manager configured or the server assigned, and the
 * usage count that decides whether removal is offered. Nothing here is a `Date`,
 * a `Map`, a `Set`, a `BigInt`, an `Error` or a class instance, and nothing
 * carries a plan id, a course offering id, an actor id, a session id, a student,
 * an instructor or a raw database error.
 */
export interface AdminExamDefinitionView {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly durationMinutes: number;
  readonly parallelCapacity: number;
  readonly requiresInstructedTrainee: boolean;
  readonly requiresLessonTopic: boolean;
  readonly requiresDiscipline: boolean;
  readonly orderIndex: number;
  /** Epoch milliseconds — the row's version, for a later conditional edit. */
  readonly updatedAt: number;
  /** How many stored sessions of THIS plan use this definition. Never negative. */
  readonly sessionCount: number;
}

/**
 * The whole view: does a plan exist, is it published, and what is on it.
 *
 * `planExists: false` is the ONLY absence this module reports, and it is not a
 * refusal: an authorized admin looking at an offering that has no exam plan yet
 * gets this, with an empty list and no publication instant.
 */
export interface AdminExamDefinitionListView {
  readonly planExists: boolean;
  /** Epoch milliseconds for a PUBLISHED plan; `null` for a draft or no plan. */
  readonly publishedAt: number | null;
  readonly definitions: readonly AdminExamDefinitionView[];
}

/**
 * The single shared empty list. Frozen and never handed out unfrozen, so no
 * caller can append to the array a future call will also receive. Sharing one
 * frozen empty array is safe precisely because it is plain, immutable JSON data.
 */
const NO_DEFINITIONS: readonly AdminExamDefinitionView[] = Object.freeze([]);

/**
 * The view of a course offering that has NO exam plan.
 *
 * Exported so a caller — and this slice's own suite — can name the exact shape
 * rather than re-spelling three fields and hoping they match.
 */
export function emptyAdminExamDefinitionListView(): AdminExamDefinitionListView {
  return Object.freeze({
    planExists: false,
    publishedAt: null,
    definitions: NO_DEFINITIONS,
  });
}

// ===========================================================================
// Normalization — narrow, and only for the JSON promise
// ===========================================================================

/**
 * A version stamp that is safe to serialize.
 *
 * The IO shell is the layer that converts an instant to epoch milliseconds, so
 * this is not a policy — it is the guarantee that the view can never carry
 * `NaN`, `Infinity`, a fraction or a negative instant and still claim to be
 * plain JSON. A value that is not a usable stamp becomes `0`, which is an
 * instant no stored row in this system carries, so a later conditional edit
 * holding it refuses as a stale write instead of matching something.
 */
function toVersionStamp(value: number): number {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

/**
 * A publication instant that is safe to serialize.
 *
 * An unusable value reads as `null` — i.e. as a DRAFT. That is the fail-closed
 * direction for publication: claiming a plan is published when the stored stamp
 * is unreadable would be the dangerous answer.
 */
function toPublicationStamp(value: number | null): number | null {
  if (value === null) {
    return null;
  }
  return Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * A usage count that is safe to serialize and safe to reason about. Anything
 * that is not a positive integer counts as `0` — never a negative number, and
 * never `NaN`, either of which could make an unused definition look used or a
 * used one look removable.
 */
function toSessionCount(value: number): number {
  return Number.isInteger(value) && value > 0 ? value : 0;
}

/**
 * Index the grouped counts by definition id, for the ONE plan that was asked
 * about.
 *
 * A group belonging to another plan is DISCARDED rather than trusted: the query
 * is already plan-scoped, so such a row would mean the boundary was misbound,
 * and silently counting it would attribute another course's sessions to this
 * one. A blank definition id is discarded for the same reason — it can match no
 * definition.
 *
 * Two groups naming the same definition cannot occur for a single plan (the
 * grouping key includes both columns), but if they ever did, their counts are
 * SUMMED: that is the only arithmetic that is not a silent loss.
 */
function sessionCountsByDefinitionId(
  planId: string,
  rows: readonly ExamDefinitionSessionCountRow[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.planId !== planId) {
      continue;
    }
    const definitionId = typeof row.definitionId === "string" ? row.definitionId : "";
    if (definitionId.length === 0) {
      continue;
    }
    counts.set(definitionId, (counts.get(definitionId) ?? 0) + toSessionCount(row.sessionCount));
  }
  return counts;
}

/**
 * The locked total order: the manager's position first, then the row id.
 *
 * The id tie-break is not decoration. The committed create binding states that
 * concurrent appends may temporarily produce EQUAL `orderIndex` values, so
 * position alone is not a total order, and a list that reshuffles between two
 * reads would make the reorder screen's stale-order token meaningless. This is
 * the SAME order the reorder path compares against.
 */
function byOrderIndexThenId(
  left: StoredAdminExamDefinitionRow,
  right: StoredAdminExamDefinitionRow,
): number {
  if (left.orderIndex !== right.orderIndex) {
    return left.orderIndex - right.orderIndex;
  }
  if (left.id === right.id) {
    return 0;
  }
  return left.id < right.id ? -1 : 1;
}

/** One frozen row view. The name and the flags are carried VERBATIM. */
function toDefinitionView(
  row: StoredAdminExamDefinitionRow,
  sessionCount: number,
): AdminExamDefinitionView {
  return Object.freeze({
    id: row.id,
    name: row.name,
    kind: row.kind,
    durationMinutes: row.durationMinutes,
    parallelCapacity: row.parallelCapacity,
    requiresInstructedTrainee: row.requiresInstructedTrainee,
    requiresLessonTopic: row.requiresLessonTopic,
    requiresDiscipline: row.requiresDiscipline,
    orderIndex: row.orderIndex,
    updatedAt: toVersionStamp(row.updatedAt),
    sessionCount,
  });
}

// ===========================================================================
// The orchestration
// ===========================================================================

/**
 * Read EVERY ExamDefinition of ONE authorized course offering's exam plan, with
 * each definition's session usage.
 *
 * The order documented at the top of this file is the safety contract, and it is
 * enforced by construction: the authorization dependency is awaited before any
 * other dependency is reachable, the lifecycle gate runs on the VERIFIED status
 * before the first query, and every query thereafter is handed a server-derived
 * id. Nothing is caught, so a denial, a redirect and an infrastructure failure
 * all propagate unchanged.
 *
 * The input rows are never mutated: the list is COPIED before it is sorted.
 */
export async function readExamDefinitionsForAdminWithDeps(
  courseOfferingId: string,
  deps: ReadExamDefinitionsForAdminDeps,
): Promise<AdminExamDefinitionListView> {
  // 1. Authorization + exact-offering verification FIRST. No exam query has been
  //    issued at this point, so an unauthorized caller learns nothing at all.
  const context = await deps.requireCourseContext(courseOfferingId);

  // 2. The course-lifecycle READ gate, on the VERIFIED status.
  deps.assertHistoricalReadAllowed(context.status);

  // 3. The plan of the VERIFIED offering. The requested, unverified id is never
  //    read again from here on.
  const plan = await deps.findExamPlanByCourseOfferingId(context.courseOfferingId);

  // 4. No plan is an honest absence, not a refusal — and it costs no further
  //    query.
  if (!plan) {
    return emptyAdminExamDefinitionListView();
  }

  const publishedAt = toPublicationStamp(plan.publishedAt);

  // 5. Every definition of that plan, scoped by the SERVER-resolved plan id.
  const rows = await deps.findDefinitionsByPlanId(plan.id);

  // The deterministic order, re-imposed on a COPY.
  const ordered = [...rows].sort(byOrderIndexThenId);

  // 6. An EMPTY plan skips the count query entirely. This is safe rather than an
  //    optimization guess: with no definition to attribute a count to, every
  //    grouped row the query could return would be discarded unread.
  if (ordered.length === 0) {
    return Object.freeze({
      planExists: true,
      publishedAt,
      definitions: NO_DEFINITIONS,
    });
  }

  // 7. ONE batched, grouped count for the whole plan, indexed in memory. No
  //    query is issued per definition, because none can be.
  const counts = sessionCountsByDefinitionId(
    plan.id,
    await deps.countSessionsByDefinition(plan.id),
  );

  // 8. The frozen, plain, JSON-safe view. A definition with no grouped row is
  //    reported as zero, never as absent or unknown.
  const definitions = Object.freeze(
    ordered.map((row) => toDefinitionView(row, counts.get(row.id) ?? 0)),
  );

  return Object.freeze({
    planExists: true,
    publishedAt,
    definitions,
  });
}
