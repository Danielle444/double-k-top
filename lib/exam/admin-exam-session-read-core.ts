/**
 * EXAM EX-SES-R1 — the PURE orchestration of the ADMIN stored-ExamSession read.
 *
 * PURE by construction: no database client, no transaction, no clock, no
 * randomness, no environment, no auth/session/cookie, no filesystem, no network,
 * no Next, no `server-only`, no `"use server"`. This module declares NO imports
 * at all. Every effect it needs arrives through the injected
 * {@link ReadAdminExamSessionsDeps}.
 *
 * WHAT THIS ANSWERS (and only this):
 *  - in which EXACT order must the admin session read authorize, gate, resolve
 *    the plan, read the definitions, read the sessions and count assignments?
 *  - what does a course offering with NO exam plan look like?
 *  - in what total order are stored sessions presented?
 *  - what, precisely, may the resulting view contain — and what must it refuse
 *    to say when a stored row cannot be resolved honestly?
 *
 * ===========================================================================
 * THIS IS A READ, AND ONLY A READ
 * ===========================================================================
 * No dependency in the injected boundary can create, update, upsert, delete,
 * reorder, publish, unpublish or copy anything, open a transaction, send a
 * notification or resolve a capability. The boundary is SIX functions: the
 * authorization/verification step, the lifecycle gate, one plan lookup, one
 * definition list, one session list and one batched assignment count. A future
 * edit that wants to write cannot do it through this module — there is nothing
 * here to write with.
 *
 * ===========================================================================
 * THE LOCKED ORDER
 * ===========================================================================
 *   1. requireCourseContext(requested id)    — admin + exact-offering boundary
 *   2. assertHistoricalReadAllowed(status)   — the course-lifecycle READ gate
 *   3. findExamPlanByCourseOfferingId(id)    — the VERIFIED offering id only
 *   4. no plan                               -> the empty, plan-absent view
 *   5. findDefinitionsByPlanId(plan.id)      — the SERVER-resolved plan id only
 *   6. findSessionsByPlanId(plan.id)         — the SERVER-resolved plan id only
 *   7. no renderable session                 -> the empty, plan-present view,
 *                                               and NO count query at all
 *   8. countAssignmentsBySessionId(plan.id)  — ONE batched, grouped count
 *   9. the frozen, plain, JSON-safe view
 *
 * Every step after the first two is scoped by a SERVER-DERIVED id. The requested
 * offering id is a REQUEST, never a grant: it reaches the authorization
 * dependency and nothing else, and only the id that dependency VERIFIED reaches
 * the plan lookup. The plan id is then the whole scope of the definition read,
 * the session read and the assignment count, so a session of another course is
 * not "filtered out" — it is never asked for.
 *
 * ===========================================================================
 * NO PER-SESSION QUERY, EVER
 * ===========================================================================
 * The assignment count arrives as ONE batched, already-grouped list, and is
 * indexed in memory. There is no dependency that takes a `sessionId`, so a
 * caller cannot bind a per-row count even by accident: the shape of the boundary
 * is what forbids the N+1, not a rule someone has to remember. A session with no
 * grouped row is reported as ZERO — an absent group means "nobody is assigned to
 * this session", which is exactly zero.
 *
 * The same is true of the definition lookup. The definitions of the plan are
 * read ONCE, as the list the later UI needs for its picker anyway, and that one
 * list is ALSO the map that resolves each session's exam name and kind. There is
 * no dependency that takes a `definitionId`, so a per-session definition fetch —
 * the other obvious N+1 on this surface — is equally unrepresentable.
 *
 * ===========================================================================
 * WHAT THIS READ DELIBERATELY CANNOT SEE
 * ===========================================================================
 * The view carries the manager's own schedule: which exam, on which day, at
 * which time, in which arena, and HOW MANY people are assigned to it.
 *
 * It carries NO assignment record, NO trainee, NO instructor, NO supervisor, NO
 * break, NO beginner child, NO Teaching-Practice lesson, NO source-lesson detail,
 * NO parent or child detail, NO diagnostics — and no grade, score or evaluation
 * of any kind, which the Exams area does not model at all. None of those is
 * reachable: no dependency returns them, and no field of the result can express
 * them.
 *
 * Nor does it carry the ids the caller has no business holding: no
 * `courseOfferingId` and no `planId` appears anywhere in the result model. Both
 * are server-derived scopes, not row attributes to echo back.
 *
 * The plan's `publishedAt` is read, because a manager reading a schedule must be
 * told whether it is already published. It is read ONLY as an instant, and this
 * module never changes it. The PER-SESSION publication stamp is deliberately
 * absent from the boundary: staggered per-session publication is a separate,
 * unbuilt product decision, and a field nobody may act on yet is a field this
 * read must not hand out.
 *
 * ===========================================================================
 * THE DEPRECATED SESSION COLUMNS ARE NOT MODELLED HERE
 * ===========================================================================
 * `ExamSession` still stores columns the exam module has moved past — the
 * retired phase marker, the interface-riding back-reference, the per-session
 * publication stamp, the beginner-copy provenance pair. None of them has a field
 * in {@link StoredAdminExamSessionRow}, so the IO shell has nowhere to put them
 * even if a future edit selected them by mistake. A column that cannot be
 * represented cannot be leaked by a later mapper, which is stronger than a rule
 * someone must remember.
 *
 * ===========================================================================
 * NAMES ARE CARRIED VERBATIM
 * ===========================================================================
 * A definition's name, and a session's arena, title and notes, are the manager's
 * own text. They are NOT trimmed, case-folded, deduplicated, sorted by or
 * substituted here: this reader's job is to show what the database holds. The
 * ONE normalization applied to the optional text is that a missing value reads
 * as `null` and never as `undefined`, because `undefined` is not JSON.
 *
 * ===========================================================================
 * NO REFUSAL CODES — FAILURES PROPAGATE WITH THEIR IDENTITY INTACT
 * ===========================================================================
 * Unlike the write slices, this module classifies NOTHING. It contains no `try`,
 * no `catch` and no error predicate, so the typed "that offering does not exist",
 * the typed lifecycle denial, an infrastructure failure and the authorization
 * boundary's redirect all reach the caller unchanged. A read must never turn a
 * denial into an empty schedule: "you may not see this" and "there is nothing
 * here" are different sentences, and the surface that eventually renders this
 * view is the layer that decides how to say each one.
 *
 * The ONE absence this module does describe is the honest one: a course offering
 * that has no exam plan yet. That is not a failure, and `planExists: false` is
 * how the future admin page knows to offer "create a plan" rather than "no exams
 * scheduled".
 *
 * ===========================================================================
 * DATES ARE NUMBERS AND KEYS ABOVE THE IO LINE
 * ===========================================================================
 * Every instant enters this module as EPOCH MILLISECONDS and leaves as epoch
 * milliseconds. Every calendar date enters as a `YYYY-MM-DD` key and leaves as
 * one. No `Date` is constructed, accepted, compared or returned, so the result
 * round-trips through JSON unchanged and no timezone convention is re-derived
 * here — the repository's shared date-key helpers own that, at the IO boundary.
 */

// ===========================================================================
// The injected boundary
// ===========================================================================

/**
 * The course context this read may act on, AFTER the boundary verified it.
 *
 * Two fields, matching the committed exam read and write cores: the DB-VERIFIED
 * offering id (the only id allowed to scope a query) and the offering's status
 * (the only input the lifecycle gate needs). The offering's name, level,
 * ActivityYear and dates are none of this read's business. `status` is
 * deliberately widened to `string` so this module needs no generated database
 * enum.
 */
export interface VerifiedExamSessionReadCourseContext {
  readonly courseOfferingId: string;
  readonly status: string;
}

/**
 * The plan of the verified offering: its id, and its publication instant.
 *
 * No source dates, no session, no definition, no offering relation and no
 * `createdAt`/`updatedAt` — a plan-level timestamp is not part of this view.
 */
export interface ResolvedExamPlanForSessionRead {
  readonly id: string;
  /** Epoch milliseconds, or `null` for a DRAFT plan. */
  readonly publishedAt: number | null;
}

/**
 * One stored `ExamDefinition`, as the IO shell reads it for THIS surface.
 *
 * Exactly five columns — deliberately fewer than the admin definition-management
 * read, which is a different surface with a different job. This one needs the
 * identity and label of each exam plus the two numbers a scheduling UI reasons
 * about (how long a wave takes, how many can run at once). The `requires*` flags,
 * `orderIndex`'s siblings and the row's own version stamp are not read, because
 * nothing on a schedule displays them.
 *
 * `orderIndex` IS carried, but only as the presentation order of the picker; it
 * is not published as a field of the option.
 *
 * `kind` is a plain `string` for the same reason `status` is: the pure core is
 * not the place that owns a generated enum. No `planId` field exists — the plan
 * is the caller's scope, not a per-row attribute this view repeats.
 */
export interface StoredExamSessionDefinitionRow {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly durationMinutes: number;
  readonly parallelCapacity: number;
  readonly orderIndex: number;
}

/**
 * One stored `ExamSession`, as the IO shell reads it.
 *
 * `dateKey` is already the `YYYY-MM-DD` string: the `@db.Date` column is
 * converted at the IO boundary through the repository's shared helper, so no
 * `Date` and no timezone rule reaches this module.
 *
 * Note what has NO field here and therefore cannot arrive: `planId`, the retired
 * phase marker, the beginner format, the derived `endTime`, `capacity`, the
 * interface-riding back-reference, the beginner-copy provenance pair, the role
 * label overrides, the per-session publication stamp, `createdAt`, and every
 * relation.
 */
export interface StoredAdminExamSessionRow {
  readonly id: string;
  readonly definitionId: string;
  /** `YYYY-MM-DD`. Converted from the stored calendar date at the IO boundary. */
  readonly dateKey: string;
  /** `HH:mm`, zero-padded, exactly as the write slice normalized it. */
  readonly startTime: string;
  readonly arena: string | null;
  readonly title: string | null;
  readonly notes: string | null;
  readonly orderIndex: number;
  /** Epoch milliseconds. The row's version, as a later edit slice's token. */
  readonly updatedAt: number;
}

/**
 * ONE grouped assignment count, as the batched count query reports it.
 *
 * It carries a COUNT and nothing else: no assignment id, no student, no role, no
 * horse, no lesson topic, no discipline, no pairing index and no notes. HOW MANY
 * people are on a session is a schedule fact; WHO they are is a different read
 * behind a different authorization decision, and it is not this one.
 */
export interface ExamSessionAssignmentCountRow {
  readonly sessionId: string;
  readonly assignmentCount: number;
}

/**
 * The complete injected boundary — six reads, and nothing else.
 *
 * Note what is ABSENT and therefore unrepresentable: no dependency can write,
 * publish, count a SINGLE session, resolve a SINGLE definition, read an
 * assignment record, read a student or an instructor, read a supervisor, a break
 * or a beginner child, reach Teaching Practice, resolve a capability, open a
 * transaction or read another course.
 */
export interface ReadAdminExamSessionsDeps {
  /**
   * Authorize the actor as an admin and verify the REQUESTED offering exists.
   * May throw the project's typed not-found, and may REDIRECT an
   * unauthenticated or non-admin caller. Runs BEFORE every query.
   */
  requireCourseContext(
    requestedCourseOfferingId: string,
  ): Promise<VerifiedExamSessionReadCourseContext>;

  /**
   * Gate the READ on the VERIFIED offering status. Throws to deny. A read gate
   * is not a write gate: an ARCHIVED offering's exam schedule remains readable
   * history, while its sessions may no longer be edited.
   */
  assertHistoricalReadAllowed(status: string): void;

  /** The plan of the VERIFIED offering. `null` means "no plan exists yet". */
  findExamPlanByCourseOfferingId(
    verifiedCourseOfferingId: string,
  ): Promise<ResolvedExamPlanForSessionRead | null>;

  /**
   * EVERY definition of ONE plan, in one query. Serves BOTH the picker options
   * and the name/kind resolution of every session, which is why there is
   * deliberately no `definitionId` parameter: a per-session definition fetch is
   * not expressible through this boundary.
   */
  findDefinitionsByPlanId(
    planId: string,
  ): Promise<readonly StoredExamSessionDefinitionRow[]>;

  /**
   * EVERY stored session of ONE plan, in one query. The IO shell orders them;
   * this module re-imposes the same total order regardless, because
   * `(date, orderIndex)` alone is not unique — the committed create binding
   * documents that concurrent inserts on one date may share a position.
   */
  findSessionsByPlanId(planId: string): Promise<readonly StoredAdminExamSessionRow[]>;

  /**
   * The assignment load of EVERY session of ONE plan, as ONE batched, grouped
   * count. There is deliberately no `sessionId` parameter: a per-session count
   * is not expressible through this boundary.
   */
  countAssignmentsBySessionId(
    planId: string,
  ): Promise<readonly ExamSessionAssignmentCountRow[]>;
}

// ===========================================================================
// The result model
// ===========================================================================

/**
 * ONE exam a session may be scheduled against, as the later UI's picker needs it.
 *
 * `definitionId` rather than `id`: at the call site this value sits beside a
 * `sessionId`, and two bare `id` fields in one view is exactly how the wrong one
 * gets passed.
 */
export interface AdminExamSessionDefinitionOption {
  readonly definitionId: string;
  readonly name: string;
  readonly kind: string;
  readonly durationMinutes: number;
  readonly parallelCapacity: number;
}

/**
 * ONE stored session, as the general exam schedule shows it.
 *
 * Twelve fields. Nothing here is a `Date`, a `Map`, a `Set`, a `BigInt`, an
 * `Error` or a class instance, and nothing carries a plan id, a course offering
 * id, an actor id, a student, an instructor, an assignment record or a raw
 * database error.
 *
 * The definition's name and kind are DENORMALIZED onto the row on purpose: the
 * schedule renders them on every line, and forcing every consumer to join
 * against `definitions` by hand is how a consumer eventually renders a blank
 * where a name should be.
 */
export interface AdminExamSessionView {
  readonly sessionId: string;
  readonly definitionId: string;
  readonly definitionName: string;
  readonly definitionKind: string;
  /** `YYYY-MM-DD`. */
  readonly dateKey: string;
  /** `HH:mm`. */
  readonly startTime: string;
  readonly arena: string | null;
  readonly title: string | null;
  readonly notes: string | null;
  readonly orderIndex: number;
  /** Epoch milliseconds — the row's version, for a later conditional edit. */
  readonly updatedAt: number;
  /** How many trainees are assigned to THIS session. Never negative. */
  readonly assignmentCount: number;
}

/**
 * The whole view: does a plan exist, is it published, which exams may be
 * scheduled, and what is currently scheduled.
 *
 * `planExists: false` is the ONLY absence this module reports, and it is not a
 * refusal: an authorized admin looking at an offering that has no exam plan yet
 * gets this, with two empty lists and no publication instant.
 */
export interface AdminExamSessionsView {
  readonly planExists: boolean;
  /** Epoch milliseconds for a PUBLISHED plan; `null` for a draft or no plan. */
  readonly publishedAt: number | null;
  readonly definitions: readonly AdminExamSessionDefinitionOption[];
  readonly sessions: readonly AdminExamSessionView[];
}

/**
 * The two shared empty lists. Frozen and never handed out unfrozen, so no caller
 * can append to an array a future call will also receive. Sharing one frozen
 * empty array is safe precisely because it is plain, immutable JSON data.
 */
const NO_DEFINITIONS: readonly AdminExamSessionDefinitionOption[] = Object.freeze([]);
const NO_SESSIONS: readonly AdminExamSessionView[] = Object.freeze([]);

/**
 * The view of a course offering that has NO exam plan.
 *
 * Exported so a caller — and this slice's own suite — can name the exact shape
 * rather than re-spelling four fields and hoping they match.
 */
export function emptyAdminExamSessionsView(): AdminExamSessionsView {
  return Object.freeze({
    planExists: false,
    publishedAt: null,
    definitions: NO_DEFINITIONS,
    sessions: NO_SESSIONS,
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
 * A non-negative whole number, for a count or a configured quantity. Anything
 * that is not one counts as `0` — never a negative number, and never `NaN`,
 * either of which could make an empty session look occupied or an occupied one
 * look removable.
 */
function toNonNegativeInteger(value: number): number {
  return Number.isInteger(value) && value > 0 ? value : 0;
}

/**
 * A position that is safe to serialize and safe to SORT BY. A non-integer
 * position becomes `0`; sorting by `NaN` is what silently produces a different
 * order on every read.
 */
function toOrderIndex(value: number): number {
  return Number.isInteger(value) ? value : 0;
}

/**
 * Optional manager text, carried VERBATIM, with `undefined` collapsed to `null`.
 *
 * No trim, no case fold and no substitution: what the manager typed is what the
 * manager sees. The ONLY transformation is that an absent value is `null`,
 * because `undefined` is not JSON and would vanish from the serialized payload
 * rather than round-trip as "no value".
 */
function toOptionalText(value: string | null | undefined): string | null {
  return typeof value === "string" ? value : null;
}

// ===========================================================================
// The definition map, and the missing-definition invariant
// ===========================================================================

/**
 * Index the plan's definitions by id.
 *
 * A blank id is discarded: it can match no session, and keeping it would let a
 * malformed row shadow the lookup below.
 */
function definitionsById(
  rows: readonly StoredExamSessionDefinitionRow[],
): Map<string, StoredExamSessionDefinitionRow> {
  const byId = new Map<string, StoredExamSessionDefinitionRow>();
  for (const row of rows) {
    const id = typeof row.id === "string" ? row.id : "";
    if (id.length === 0) {
      continue;
    }
    byId.set(id, row);
  }
  return byId;
}

/**
 * Index the grouped assignment counts by session id.
 *
 * Unlike the plan-scoped definition count elsewhere in this module's family, a
 * grouped assignment row carries no plan column to verify against — the grouping
 * key is the session alone. The containment is imposed a step later instead:
 * only sessions the SERVER read for THIS plan are ever looked up in this map, so
 * a group naming any other session is never consulted and cannot be attributed.
 *
 * Two groups naming the same session cannot occur (the grouping key is the
 * session id), but if they ever did, their counts are SUMMED: that is the only
 * arithmetic that is not a silent loss.
 */
function assignmentCountsBySessionId(
  rows: readonly ExamSessionAssignmentCountRow[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const sessionId = typeof row.sessionId === "string" ? row.sessionId : "";
    if (sessionId.length === 0) {
      continue;
    }
    counts.set(sessionId, (counts.get(sessionId) ?? 0) + toNonNegativeInteger(row.assignmentCount));
  }
  return counts;
}

/**
 * THE MISSING-DEFINITION INVARIANT.
 *
 * The database makes an unresolvable session UNREPRESENTABLE. `ExamSession`
 * references its definition through the COMPOSITE foreign key
 * `(planId, definitionId) -> ExamDefinition(planId, id)`, which is `ON DELETE
 * RESTRICT`. A session therefore cannot name a definition of another plan, and a
 * definition still referenced by a session cannot be deleted. Since the
 * definition list and the session list of this read are BOTH scoped by the same
 * server-resolved plan id, every session read here must find its definition.
 *
 * So this predicate should never reject anything. It exists because "should
 * never" is not "cannot": if the constraint were ever dropped, or a future edit
 * narrowed the definition query with a filter the session query does not share,
 * an unresolvable session would appear here.
 *
 * When that happens the row is FAILED CLOSED — omitted from the view — rather
 * than emitted with an invented, blank or placeholder name. A schedule line
 * reading "" or "unknown exam" is a line a manager would act on, and acting on a
 * fabricated exam identity is worse than not seeing the row. The same rule
 * covers a row with no usable date or start time: it cannot be placed on a
 * calendar, so it cannot be shown on one.
 *
 * This is deliberately NOT a thrown error: one corrupt row must not make an
 * entire course's schedule unreadable.
 */
function isRenderable(
  row: StoredAdminExamSessionRow,
  byId: Map<string, StoredExamSessionDefinitionRow>,
): boolean {
  if (typeof row.id !== "string" || row.id.length === 0) {
    return false;
  }
  if (typeof row.dateKey !== "string" || row.dateKey.length === 0) {
    return false;
  }
  if (typeof row.startTime !== "string" || row.startTime.length === 0) {
    return false;
  }
  return byId.has(row.definitionId);
}

// ===========================================================================
// The locked orders
// ===========================================================================

/** Lexicographic compare, used only where the string form IS the sort order. */
function compareText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

/**
 * The locked total order of the schedule: DATE, then POSITION, then TIME, then
 * the row id.
 *
 * `dateKey` and `startTime` are compared as STRINGS, which is exact rather than
 * approximate: `YYYY-MM-DD` and zero-padded `HH:mm` both sort lexicographically
 * in chronological order, so no `Date`, no parsing and no timezone rule is
 * needed to order a calendar.
 *
 * `orderIndex` outranks `startTime` because the manager's explicit arrangement
 * of a day is the product decision, and the clock is the tie-break within it —
 * the committed create binding assigns `orderIndex` per `(plan, date)` for
 * exactly that reason.
 *
 * The id tie-break is not decoration. That same binding states that concurrent
 * inserts on one date may temporarily produce EQUAL `orderIndex` values, so
 * `(date, orderIndex, startTime)` is not a total order, and a schedule that
 * reshuffles between two reads would make a later stale-write token meaningless.
 * The id is used ONLY to break the tie; it is never published as a field of its
 * own beyond the `sessionId` the view already declares.
 */
function bySchedulePosition(
  left: StoredAdminExamSessionRow,
  right: StoredAdminExamSessionRow,
): number {
  const byDate = compareText(left.dateKey, right.dateKey);
  if (byDate !== 0) {
    return byDate;
  }
  const leftPosition = toOrderIndex(left.orderIndex);
  const rightPosition = toOrderIndex(right.orderIndex);
  if (leftPosition !== rightPosition) {
    return leftPosition - rightPosition;
  }
  const byStart = compareText(left.startTime, right.startTime);
  if (byStart !== 0) {
    return byStart;
  }
  return compareText(left.id, right.id);
}

/**
 * The picker's order: the manager's position, then the row id — the SAME total
 * order the committed definition surfaces use, for the same reason.
 */
function byOrderIndexThenId(
  left: StoredExamSessionDefinitionRow,
  right: StoredExamSessionDefinitionRow,
): number {
  const leftPosition = toOrderIndex(left.orderIndex);
  const rightPosition = toOrderIndex(right.orderIndex);
  if (leftPosition !== rightPosition) {
    return leftPosition - rightPosition;
  }
  return compareText(left.id, right.id);
}

// ===========================================================================
// The projections
// ===========================================================================

/** One frozen picker option. The name is carried VERBATIM. */
function toDefinitionOption(
  row: StoredExamSessionDefinitionRow,
): AdminExamSessionDefinitionOption {
  return Object.freeze({
    definitionId: row.id,
    name: row.name,
    kind: row.kind,
    durationMinutes: toNonNegativeInteger(row.durationMinutes),
    parallelCapacity: toNonNegativeInteger(row.parallelCapacity),
  });
}

/**
 * One frozen schedule line.
 *
 * The definition is passed in ALREADY RESOLVED — this function has no map, no
 * fallback branch and no default string, so it cannot invent a name or a kind
 * even if someone later removes the guard that precedes it.
 */
function toSessionView(
  row: StoredAdminExamSessionRow,
  definition: StoredExamSessionDefinitionRow,
  assignmentCount: number,
): AdminExamSessionView {
  return Object.freeze({
    sessionId: row.id,
    definitionId: definition.id,
    definitionName: definition.name,
    definitionKind: definition.kind,
    dateKey: row.dateKey,
    startTime: row.startTime,
    arena: toOptionalText(row.arena),
    title: toOptionalText(row.title),
    notes: toOptionalText(row.notes),
    orderIndex: toOrderIndex(row.orderIndex),
    updatedAt: toVersionStamp(row.updatedAt),
    assignmentCount,
  });
}

// ===========================================================================
// The orchestration
// ===========================================================================

/**
 * Read EVERY stored ExamSession of ONE authorized course offering's exam plan,
 * with each session's exam identity and assignment load, plus the plan's
 * definitions as the later UI's options.
 *
 * The order documented at the top of this file is the safety contract, and it is
 * enforced by construction: the authorization dependency is awaited before any
 * other dependency is reachable, the lifecycle gate runs on the VERIFIED status
 * before the first query, and every query thereafter is handed a server-derived
 * id. Nothing is caught, so a denial, a redirect and an infrastructure failure
 * all propagate unchanged.
 *
 * The input rows are never mutated: each list is COPIED before it is sorted, and
 * no stored row object is ever placed in the result — every published object is
 * built fresh and frozen here.
 */
export async function readAdminExamSessionsWithDeps(
  courseOfferingId: string,
  deps: ReadAdminExamSessionsDeps,
): Promise<AdminExamSessionsView> {
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
    return emptyAdminExamSessionsView();
  }

  const publishedAt = toPublicationStamp(plan.publishedAt);

  // 5. Every definition of that plan, scoped by the SERVER-resolved plan id.
  //    This ONE list is both the picker's options and the session resolver.
  const definitionRows = await deps.findDefinitionsByPlanId(plan.id);
  const byId = definitionsById(definitionRows);
  const definitions = Object.freeze(
    [...definitionRows].sort(byOrderIndexThenId).map(toDefinitionOption),
  );

  // 6. Every stored session of that plan, scoped by the SAME server-resolved id.
  const sessionRows = await deps.findSessionsByPlanId(plan.id);

  // The renderable rows only, in the locked total order, on a COPY.
  const ordered = sessionRows.filter((row) => isRenderable(row, byId)).sort(bySchedulePosition);

  // 7. A plan with nothing renderable skips the count query entirely. This is
  //    safe rather than an optimization guess: with no session to attribute a
  //    count to, every grouped row the query could return would be discarded
  //    unread.
  if (ordered.length === 0) {
    return Object.freeze({
      planExists: true,
      publishedAt,
      definitions,
      sessions: NO_SESSIONS,
    });
  }

  // 8. ONE batched, grouped count for the whole plan, indexed in memory. No
  //    query is issued per session, because none can be.
  const counts = assignmentCountsBySessionId(await deps.countAssignmentsBySessionId(plan.id));

  // 9. The frozen, plain, JSON-safe view. A session with no grouped row is
  //    reported as zero, never as absent or unknown. The non-null assertion is
  //    discharged by `isRenderable`, which already proved the map holds this id.
  const sessions = Object.freeze(
    ordered.map((row) =>
      toSessionView(row, byId.get(row.definitionId)!, counts.get(row.id) ?? 0),
    ),
  );

  return Object.freeze({
    planExists: true,
    publishedAt,
    definitions,
    sessions,
  });
}
