/**
 * EXAM EX-S5A-4B — the PURE, dependency-injected ROLE SCOPE core for exam reads.
 *
 * PURE by construction: no database client, no generated database type, no DB,
 * no Next, no React, no clock (`Date.now` / `new Date`), no randomness, no env,
 * no auth/session/cookie module, no capability lookup, no filesystem, no
 * network, no `"use server"`. Every effect — resolving the actor, authorizing
 * the course, loading the plan, resolving display names — arrives as a NARROW
 * INJECTED FUNCTION, so the whole authorization ORDER is unit-testable with
 * plain fakes and no database. The thin real bindings live in
 * `lib/actions/exam-role-readers.ts`.
 *
 * WHAT THIS ANSWERS (and only this): for ONE resolved role, in what ORDER is the
 * caller authorized, and what is the ONLY value that may be returned?
 *
 * ===========================================================================
 * THIS IS THE AUTHORIZATION BOUNDARY
 * ===========================================================================
 * EX-S5A-3 loads a ROLE-NEUTRAL SUPERSET (`ExamPlanPayload`) that carries more
 * than any single viewer may see — every assigned student id including other
 * people's, the stored slot detail, the conflict input, and the live beginner
 * rows' child names, ages, genders, notes and PARENT CONTACT NUMBERS. EX-S5A-4A
 * narrows that superset per role but decides NOTHING about who may call it.
 *
 * This module is the thing between them. Its order is a hard contract:
 *
 *   1. resolve the actor from the signed server session (injected);
 *   2. prove the actor may read THIS course offering in THIS role (injected),
 *      and keep ONLY the DB-VERIFIED offering id the resolver returned;
 *   3. choose the loader's publication options FROM that proven role — they are
 *      constants of this module and are never accepted from a caller;
 *   4. only now call the loader;
 *   5. resolve display names for the ids the narrowing needs;
 *   6. return ONLY the committed builder's result.
 *
 * NO EXPORTED READER RETURNS `ExamPlanPayload`, and none accepts an actor id, a
 * `planId`, a `viewerStudentId` or a publication option. A trainee reader does
 * not even accept a `courseOfferingId`: unrepresentable beats forbidden.
 *
 * ===========================================================================
 * THE TEMPORARY INSTRUCTOR BOUNDARY
 * ===========================================================================
 * There is NO `EXAMS` capability yet — no catalog key, no database row, no
 * reader. Nothing here consults one, and no placeholder for one may be added: a
 * check that always passes reads as enforcement to the next person and would be
 * the only thing standing between an instructor and this data on the day the
 * real capability lands. The CURRENT instructor boundary is therefore exactly
 * "an ACTIVE instructor session PLUS an authorized course offering", supplied by
 * the injected identity and course-resolution dependencies.
 *
 * `SCHEDULE` and `TEACHING_PRACTICE` are deliberately NOT reused. Borrowing an
 * unrelated key would make an exam read silently follow another module's product
 * decisions, and would make the eventual `EXAMS` rollout a behaviour change
 * nobody could reason about. When `EXAMS` is introduced, THIS module — and the
 * bindings beneath it — must be revisited in a separate reviewed slice.
 *
 * `ExamSessionSupervisor` is DISPLAY DATA and never an authorization gate: an
 * instructor's access is decided here, not by appearing on a row.
 *
 * ===========================================================================
 * CROSS-COURSE TEACHING PRACTICE — THE LIMITATION IS NOT SOLVED HERE
 * ===========================================================================
 * `TeachingPracticeLesson` has NO `courseOfferingId`: a lesson is not
 * course-scoped in the database at all. The ONLY thing binding a lesson to a
 * plan is that plan's own explicit `ExamTeachingPracticeSourceDate` selection,
 * which is why no date is ever inferred anywhere in this slice.
 *
 * WHAT THAT MEANS FOR SHIPPING. These readers MUST NOT BE DEPLOYED for two or
 * more offerings whose plans can select the SAME Teaching-Practice source date
 * without a SEPARATE, REVIEWED CONTAINMENT DECISION first — on that date both
 * plans would read the same lessons, so one course's trainees, children and
 * parent contacts would appear under the other course's exam plan. Source dates
 * are the only current containment mechanism. The fix is DATA (a schema-level
 * course binding, a per-plan lesson allow-list, or a product rule that source
 * dates may not be shared) and must not be attempted as a heuristic here.
 *
 * ===========================================================================
 * FAIL CLOSED — BUT NEVER SILENTLY
 * ===========================================================================
 * An authorization DENIAL is an ordinary outcome and becomes the uniform EMPTY
 * DTO for that role, which discloses no plan id, no publication state and not
 * even whether the requested offering exists. Which failures count as denials is
 * decided by the INJECTED `isCourseContextDenial` predicate, bound in the real
 * module to the committed typed course-context errors and to nothing else.
 *
 * Everything else PROPAGATES: a Prisma failure, a loader defect, a broken name
 * lookup and a programming error are not "this plan is empty". Rendering an
 * empty exam schedule because a query failed would be indistinguishable from a
 * plan that genuinely has no sessions, and a trainee would be told with total
 * confidence that they have no exam.
 *
 * The ADMIN path catches NOTHING at all: `requireAdminCourseOffering` redirects
 * an unauthenticated caller and throws a typed not-found for an unknown
 * offering, and those are the project's existing admin conventions — replacing
 * them with an empty page here would be a behaviour change this slice has no
 * mandate for.
 */
import {
  buildAdminExamReadDto,
  buildInstructorExamReadDto,
  buildTraineeExamDayDto,
  type AdminExamReadDto,
  type ExamDisplayNameLookup,
  type InstructorExamReadDto,
  type TraineeExamDayDto,
  type TraineeExamSessionDisplayDetail,
  type TraineeExamSessionDisplayDetailLookup,
} from "./exam-read-dto";
import { projectTraineeExamDay, type TraineeExamDayProjection } from "./exam-trainee-view-core";
import { emptyExamPlanPayload } from "./exam-plan-loader-core";
import type {
  ExamPlanLoadInput,
  ExamPlanLoadOptions,
  ExamPlanPayload,
} from "./exam-plan-loader-core";
import type { ProjectionSession } from "./exam-schedule-projection-core";
import type { BeginnerDetail } from "./exam-live-beginner-adapter-core";
import type { ConflictSession } from "./exam-conflict-core";

/**
 * The client-safe role contracts, re-exported so the thin binding module can
 * name its own return types WITHOUT importing the narrowing module. The DTO
 * builders keep exactly ONE production consumer — this file — which is asserted
 * by the committed EX-S5A-4A guard.
 */
export type { AdminExamReadDto, InstructorExamReadDto, TraineeExamDayDto };

// ===========================================================================
// The locked, per-role loader options
// ===========================================================================

/**
 * The ADMIN loader options.
 *
 * `requirePlanPublication: false` and `requireLessonPublication: false` are the
 * DRAFT reading: an admin sees unpublished plans and unpublished
 * Teaching-Practice lessons. They are NEVER self-selected — the wrapper that
 * supplies them is the thing that has already proven the caller is an admin.
 * `viewerStudentId` is `null`: an operational reader has no personal row.
 */
export const ADMIN_EXAM_PLAN_LOAD_OPTIONS: ExamPlanLoadOptions = Object.freeze({
  requirePlanPublication: false,
  requireLessonPublication: false,
  viewerStudentId: null,
});

/**
 * The INSTRUCTOR loader options — identical to the admin's today.
 *
 * They are a SEPARATE constant rather than an alias so a future policy split
 * (an instructor who may not see drafts, say) changes one line here instead of
 * silently changing the admin reading too.
 */
export const INSTRUCTOR_EXAM_PLAN_LOAD_OPTIONS: ExamPlanLoadOptions = Object.freeze({
  requirePlanPublication: false,
  requireLessonPublication: false,
  viewerStudentId: null,
});

/**
 * The TRAINEE loader options: BOTH publication gates ON, and the viewer bound to
 * the AUTHENTICATED student id — the one derived from the signed session, never
 * a client value and never resolved by name.
 *
 * Built per call because it carries that id; the two booleans are constants of
 * this function and are not parameters.
 */
export function traineeExamPlanLoadOptions(
  authenticatedStudentId: string,
): ExamPlanLoadOptions {
  return Object.freeze({
    requirePlanPublication: true,
    requireLessonPublication: true,
    viewerStudentId: authenticatedStudentId,
  });
}

// ===========================================================================
// Injected dependencies
// ===========================================================================

/**
 * The plan loader, injected as ONE narrow function.
 *
 * The real binding is `loadExamPlan(input, examPlanReadDeps)`. Injecting it
 * keeps this module free of the loader's IO contract and makes the exact
 * `ExamPlanLoadInput` — the verified offering id AND the locked options —
 * observable to a test, which is the only way to prove a role cannot be handed
 * somebody else's publication reading.
 */
export type ExamPlanLoadFn = (input: ExamPlanLoadInput) => Promise<ExamPlanPayload>;

/** A batched id → display-name lookup. Called AT MOST ONCE per successful read. */
export type ExamDisplayNameFetch = (
  ids: readonly string[],
) => Promise<ReadonlyMap<string, string>>;

/**
 * The ADMIN dependencies.
 *
 * `requireAdminCourseOffering` is the EXISTING admin course-context helper: it
 * authorizes the admin FIRST and only then looks up exactly the requested
 * offering, returning the DB-verified row. Its typed failures are NOT caught
 * here — see the header.
 */
export interface AdminExamReadDeps {
  readonly requireAdminCourseOffering: (
    courseOfferingId: string,
  ) => Promise<{ readonly id: string }>;
  readonly loadPlan: ExamPlanLoadFn;
  readonly fetchStudentDisplayNames: ExamDisplayNameFetch;
  readonly fetchInstructorDisplayNames: ExamDisplayNameFetch;
}

/**
 * The INSTRUCTOR dependencies.
 *
 * `requireInstructorId` is the server actor step: it resolves the ACTIVE
 * instructor from the signed session and throws for an anonymous, expired,
 * wrong-audience or inactive caller. Its VALUE is deliberately unused — no
 * instructor identity influences which rows are read — but the call itself is
 * the audience gate and runs FIRST, before any course lookup, so a stranger
 * cannot probe which offering ids exist.
 *
 * `resolveInstructorCourseOffering` re-authorizes the EXPLICITLY REQUESTED id
 * server-side and returns the DB-verified offering. The requested string is
 * never used past that point.
 */
export interface InstructorExamReadDeps {
  readonly requireInstructorId: () => Promise<string>;
  readonly resolveInstructorCourseOffering: (
    requestedCourseOfferingId: string,
  ) => Promise<{ readonly id: string }>;
  readonly isCourseContextDenial: (error: unknown) => boolean;
  readonly loadPlan: ExamPlanLoadFn;
  readonly fetchStudentDisplayNames: ExamDisplayNameFetch;
  readonly fetchInstructorDisplayNames: ExamDisplayNameFetch;
}

/**
 * The TRAINEE dependencies.
 *
 * There is deliberately NO instructor-name fetch in this contract. A trainee's
 * only instructor-shaped display value is a beginner lesson's responsible
 * instructor, and the committed narrowing already falls back to the display name
 * the live adapter carries — so the query is not merely skipped, it is
 * UNREACHABLE from this reader. An unknown name stays unresolved; a name is
 * never turned back into an identity.
 *
 * `resolveTraineeCourseOffering` takes NO arguments by design: there is no
 * parameter through which any caller could supply an offering id, and the
 * student id it uses comes from the signed session inside the real binding.
 */
export interface TraineeExamReadDeps {
  readonly requireTraineeId: () => Promise<string>;
  readonly resolveTraineeCourseOffering: () => Promise<{ readonly id: string }>;
  readonly isCourseContextDenial: (error: unknown) => boolean;
  readonly loadPlan: ExamPlanLoadFn;
  readonly fetchStudentDisplayNames: ExamDisplayNameFetch;
}

// ===========================================================================
// Helpers
// ===========================================================================

/** A `YYYY-MM-DD` SHAPE check. Not a calendar check — no `Date` is constructed. */
const DATE_TOKEN = /^\d{4}-\d{2}-\d{2}$/;

/** The live Teaching-Practice beginner kind. Compared, never constructed. */
const BEGINNER_KIND = "BEGINNER_INSTRUCTION";

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isPresentId(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/** The trimmed id, or `null` when absent/blank. Whitespace is never identity. */
function idOrNull(v: unknown): string | null {
  return isPresentId(v) ? v.trim() : null;
}

/**
 * The selected day token, or `null`.
 *
 * EXACT `YYYY-MM-DD` only, after trimming. No `Date` is constructed, "today" is
 * never inferred, a range is not accepted, and an illegible token is never
 * widened into "every date" — it selects nothing at all.
 */
export function normalizeSelectedExamDate(selectedDate: unknown): string | null {
  const raw = typeof selectedDate === "string" ? selectedDate.trim() : "";
  return DATE_TOKEN.test(raw) ? raw : null;
}

/** A fresh, never-shared empty name map. A frozen `Map` still accepts `.set`. */
function emptyNameMap(): ReadonlyMap<string, string> {
  return new Map<string, string>();
}

/** A dependency's return value, or a fresh empty map when it is unusable. */
function usableNameMap(value: unknown): ReadonlyMap<string, string> {
  if (value === null || value === undefined) return emptyNameMap();
  if (typeof (value as { get?: unknown }).get !== "function") return emptyNameMap();
  return value as ReadonlyMap<string, string>;
}

/**
 * Normalize a collected id set for IO: trim, drop blanks, DEDUPLICATE and sort.
 *
 * Deterministic on purpose — the same read must issue the same query twice, and
 * a duplicated id must never become a duplicated row or a second query.
 */
function normalizeIdSet(ids: Iterable<string>): readonly string[] {
  const seen = new Set<string>();
  for (const raw of ids) {
    const id = idOrNull(raw);
    if (id !== null) seen.add(id);
  }
  return Object.freeze([...seen].sort(cmp));
}

/**
 * Whether a beginner participant belongs to the VALID LIVE PROJECTION.
 *
 * This RESTATES the committed narrowing's private rule: the Teaching-Practice
 * source adapter decides projection eligibility from the role token and records
 * the verdict as `isProjected`, RETAINING a rejected row as evidence. A
 * participant object that CARRIES the flag must prove `true`; one that OMITS it
 * passes, because the only omitting contract is the live adapter's, whose
 * participant list is projection-only by construction.
 *
 * It is restated rather than imported because the flag is module-private in the
 * committed file, and this slice edits no committed core. The parity is asserted
 * by test instead: a non-projected participant contributes neither an id to the
 * name batch here nor a name or a count to the DTO there.
 */
function isProjectedBeginnerParticipant(participant: unknown): boolean {
  if (participant === null || typeof participant !== "object") return false;
  if (!Object.prototype.hasOwnProperty.call(participant, "isProjected")) return true;
  return (participant as { readonly isProjected?: unknown }).isProjected === true;
}

/** The sibling beginner detail of ONE visible row, or `null` — FAIL CLOSED. */
function beginnerDetailOf(
  beginnerDetails: ReadonlyMap<string, BeginnerDetail> | null | undefined,
  session: ProjectionSession,
): BeginnerDetail | null {
  if (session.kind !== BEGINNER_KIND) return null;
  const sessionId = idOrNull(session.sessionId);
  if (sessionId === null) return null;
  if (beginnerDetails === null || beginnerDetails === undefined) return null;
  if (typeof (beginnerDetails as { get?: unknown }).get !== "function") return null;
  const detail = beginnerDetails.get(sessionId);
  if (detail === null || detail === undefined || typeof detail !== "object") return null;
  // Attaches by EXACT session id and by nothing else.
  return detail.sessionId === sessionId ? detail : null;
}

// ===========================================================================
// Display-id collection
// ===========================================================================

/**
 * Every `Student.id` the narrowing needs a display name for, from the VISIBLE
 * rows only.
 *
 * THREE SOURCES, ONE BATCH:
 *   - the stored blocks' `examineeStudentIds`;
 *   - the stored blocks' `instructedTraineeStudentIds`;
 *   - the PROJECTED participants of the live beginner rows.
 *
 * The third is included deliberately. The committed narrowing resolves beginner
 * participant names through this lookup keyed by `Student.id`; without their ids
 * the batch would leave every beginner participant nameless while still counting
 * them. Resolving them here uses the AUTHORITATIVE `Student.fullName` rather
 * than the denormalized copy the source row carries, costs no extra query, and
 * emits no id — the narrowing drops every key it looked up.
 *
 * A participant the source adapter REJECTED contributes nothing: not an id here,
 * and not a name or a count there. Ids are collected from the sessions the
 * CALLER decided are visible, so a trainee read — whose sessions are already
 * filtered by plan publication, lesson publication and the selected day — never
 * collects an id from a hidden lesson, an unpublished lesson or another date.
 */
export function collectExamStudentDisplayIds(
  sessions: readonly ProjectionSession[] | null | undefined,
  beginnerDetails: ReadonlyMap<string, BeginnerDetail> | null | undefined,
): readonly string[] {
  const ids: string[] = [];
  const list = Array.isArray(sessions) ? sessions : [];
  for (const session of list) {
    if (session === null || typeof session !== "object") continue;
    const examinees = Array.isArray(session.examineeStudentIds)
      ? session.examineeStudentIds
      : [];
    const instructed = Array.isArray(session.instructedTraineeStudentIds)
      ? session.instructedTraineeStudentIds
      : [];
    ids.push(...examinees, ...instructed);

    const detail = beginnerDetailOf(beginnerDetails, session);
    if (detail === null) continue;
    const participants = Array.isArray(detail.participants) ? detail.participants : [];
    for (const participant of participants) {
      if (!isProjectedBeginnerParticipant(participant)) continue;
      const traineeId = idOrNull((participant as { readonly traineeId?: unknown }).traineeId);
      if (traineeId !== null) ids.push(traineeId);
    }
  }
  return normalizeIdSet(ids);
}

/**
 * Every `Instructor.id` an OPERATIONAL narrowing needs a display name for.
 *
 * TWO SOURCES, ONE BATCH:
 *   - the stored blocks' supervisor ids, read from the conflict INPUT and
 *     restricted to the sessions that are actually visible;
 *   - the live beginner rows' authoritative `responsibleInstructorId`.
 *
 * Nothing else of a `ConflictSession` is read — not its assignments (which carry
 * participant identities), not its interval, slots, examiner set, horses,
 * capacity or staffing flag. Supervisors are DISPLAY data here and never an
 * authorization input.
 *
 * The TRAINEE reader does not call this at all: see {@link TraineeExamReadDeps}.
 */
export function collectExamInstructorDisplayIds(
  sessions: readonly ProjectionSession[] | null | undefined,
  conflictSessions: readonly ConflictSession[] | null | undefined,
  beginnerDetails: ReadonlyMap<string, BeginnerDetail> | null | undefined,
): readonly string[] {
  const visible = new Set<string>();
  const sessionList = Array.isArray(sessions) ? sessions : [];
  for (const session of sessionList) {
    if (session === null || typeof session !== "object") continue;
    const sessionId = idOrNull(session.sessionId);
    if (sessionId !== null) visible.add(sessionId);
  }

  const ids: string[] = [];
  const conflictList = Array.isArray(conflictSessions) ? conflictSessions : [];
  for (const entry of conflictList) {
    if (entry === null || typeof entry !== "object") continue;
    const sessionId = idOrNull(entry.sessionId);
    if (sessionId === null || !visible.has(sessionId)) continue;
    const supervisorIds = Array.isArray(entry.supervisorIds) ? entry.supervisorIds : [];
    ids.push(...supervisorIds);
  }

  for (const session of sessionList) {
    if (session === null || typeof session !== "object") continue;
    const detail = beginnerDetailOf(beginnerDetails, session);
    if (detail === null) continue;
    const responsible = idOrNull(detail.responsibleInstructorId);
    if (responsible !== null) ids.push(responsible);
  }

  return normalizeIdSet(ids);
}

// ===========================================================================
// The narrow trainee arena sibling
// ===========================================================================

/**
 * The NARROW stored-arena sibling the trainee narrowing expects.
 *
 * WHY IT IS BUILT HERE. `ProjectionSession` carries no arena, and the only arena
 * value in the internal payload sits on the conflict INPUT — a structure that
 * also holds supervisor ids, per-assignment intervals, slots, horses, examiner
 * sets and staffing state. Handing the trainee builder that structure to reach
 * ONE display string would put all of it one field access away from a client
 * payload. So exactly one scalar is extracted server-side into a shape that
 * CANNOT express anything else, and the map itself never leaves this module.
 *
 * FAIL CLOSED ON AMBIGUITY: if two stored entries claim ONE session id, neither
 * wins and the session gets NO entry — an arena taken from the wrong block is
 * strictly worse than no arena. A blank arena is `null`, never an empty string
 * masquerading as a place. Nothing is inferred from a date, a title or a
 * position.
 */
export function buildTraineeExamArenaLookup(
  conflictSessions: readonly ConflictSession[] | null | undefined,
): TraineeExamSessionDisplayDetailLookup {
  const list = Array.isArray(conflictSessions) ? conflictSessions : [];
  const counts = new Map<string, number>();
  for (const entry of list) {
    if (entry === null || typeof entry !== "object") continue;
    const sessionId = idOrNull(entry.sessionId);
    if (sessionId === null) continue;
    counts.set(sessionId, (counts.get(sessionId) ?? 0) + 1);
  }

  const lookup = new Map<string, TraineeExamSessionDisplayDetail>();
  for (const entry of list) {
    if (entry === null || typeof entry !== "object") continue;
    const sessionId = idOrNull(entry.sessionId);
    if (sessionId === null) continue;
    if ((counts.get(sessionId) ?? 0) > 1) continue;
    lookup.set(
      sessionId,
      Object.freeze({
        sessionId,
        arena: isPresentId(entry.arenaId) ? entry.arenaId.trim() : null,
      }),
    );
  }
  return lookup;
}

// ===========================================================================
// Uniform empty results
// ===========================================================================

/** The empty trainee projection. FRESH on every call — never a shared value. */
function emptyTraineeProjection(): TraineeExamDayProjection {
  return Object.freeze({
    allRows: Object.freeze([]),
    myRows: Object.freeze([]),
    issues: Object.freeze([]),
  });
}

/** The two empty, usable name lookups. Fresh maps, never shared. */
function emptyDisplayNames(): ExamDisplayNameLookup {
  return { studentNames: emptyNameMap(), instructorNames: emptyNameMap() };
}

/**
 * The uniform EMPTY admin reading.
 *
 * Produced by the COMMITTED builder from the committed empty payload, so an
 * empty result is the same SHAPE as a populated one — a denial is
 * indistinguishable from an offering that has no plan, and `planId`,
 * `publishedAt` and every row list are absent rather than nulled selectively.
 */
export function emptyAdminExamReadDto(): AdminExamReadDto {
  return buildAdminExamReadDto(emptyExamPlanPayload(), emptyDisplayNames());
}

/** The uniform EMPTY instructor reading. See {@link emptyAdminExamReadDto}. */
export function emptyInstructorExamReadDto(): InstructorExamReadDto {
  return buildInstructorExamReadDto(emptyExamPlanPayload(), emptyDisplayNames());
}

/**
 * The uniform EMPTY trainee day.
 *
 * It discloses nothing: no plan id, no publication state, no diagnostic and no
 * hint about whether a plan exists, is a draft, or simply has no row on the
 * selected day. Every denial and every empty state returns exactly this.
 */
export function emptyTraineeExamDayDto(): TraineeExamDayDto {
  return buildTraineeExamDayDto(emptyTraineeProjection(), null, null, emptyDisplayNames());
}

// ===========================================================================
// Shared name resolution
// ===========================================================================

/**
 * Resolve the display names an OPERATIONAL reading needs — at most ONE student
 * query and at most ONE instructor query, ALWAYS, for one session or forty.
 *
 * An EMPTY id set issues NO call at all: there is nothing to ask about, and a
 * query with an empty `IN ()` list is a database round trip that can only return
 * nothing. Neither fetch is ever called inside a per-row loop.
 */
async function resolveOperationalDisplayNames(
  payload: ExamPlanPayload,
  deps: {
    readonly fetchStudentDisplayNames: ExamDisplayNameFetch;
    readonly fetchInstructorDisplayNames: ExamDisplayNameFetch;
  },
): Promise<ExamDisplayNameLookup> {
  const sessions = Array.isArray(payload?.sessions) ? payload.sessions : [];
  const studentIds = collectExamStudentDisplayIds(sessions, payload?.beginnerDetails);
  const instructorIds = collectExamInstructorDisplayIds(
    sessions,
    payload?.conflictSessions,
    payload?.beginnerDetails,
  );

  const [studentNames, instructorNames] = await Promise.all([
    studentIds.length === 0 ? emptyNameMap() : deps.fetchStudentDisplayNames(studentIds),
    instructorIds.length === 0
      ? emptyNameMap()
      : deps.fetchInstructorDisplayNames(instructorIds),
  ]);

  return {
    studentNames: usableNameMap(studentNames),
    instructorNames: usableNameMap(instructorNames),
  };
}

// ===========================================================================
// Admin
// ===========================================================================

/**
 * The ADMIN reading of ONE course offering's exam plan.
 *
 * ORDER (a hard contract, asserted by test):
 *   1. `requireAdminCourseOffering` — the EXISTING helper, which authorizes the
 *      admin FIRST and only then looks up exactly the requested offering;
 *   2. the loader, scoped by the DB-VERIFIED id that helper returned — never by
 *      the caller's raw string;
 *   3. one batched student-name lookup and one batched instructor-name lookup;
 *   4. the committed admin narrowing.
 *
 * Nothing is caught: an unauthenticated caller is redirected and an unknown
 * offering throws the project's typed not-found, exactly as on every other admin
 * surface. `courseOfferingId` is the ONLY parameter — there is no `planId`, no
 * actor id and no publication option a caller could supply.
 */
export async function readAdminExamPlanWithDeps(
  courseOfferingId: string,
  deps: AdminExamReadDeps,
): Promise<AdminExamReadDto> {
  // 1. Authorization + the DB-verified offering, in one existing helper.
  const offering = await deps.requireAdminCourseOffering(courseOfferingId);

  const verifiedId = idOrNull(offering?.id);
  if (verifiedId === null) {
    // A context that identifies no offering cannot scope a single query.
    return emptyAdminExamReadDto();
  }

  // 2. Only now: the plan, under the LOCKED admin options.
  const payload = await deps.loadPlan({
    courseOfferingId: verifiedId,
    options: ADMIN_EXAM_PLAN_LOAD_OPTIONS,
  });

  // 3–4. Names, then the committed narrowing. The payload never leaves.
  const names = await resolveOperationalDisplayNames(payload, deps);
  return buildAdminExamReadDto(payload, names);
}

// ===========================================================================
// Instructor
// ===========================================================================

/**
 * The INSTRUCTOR reading of ONE requested course offering's exam plan.
 *
 * ORDER (a hard contract, asserted by test):
 *   1. resolve the ACTIVE instructor from the signed session — the audience
 *      gate, FIRST, so a stranger cannot probe which offering ids exist;
 *   2. re-authorize the EXPLICITLY REQUESTED offering server-side;
 *   3. the loader, scoped by the resolver's DB-VERIFIED id — the requested
 *      string is never used again;
 *   4. one batched student-name lookup and one batched instructor-name lookup;
 *   5. the committed instructor narrowing.
 *
 * DENIAL IS UNIFORM AND SILENT: an anonymous, expired, wrong-audience or
 * INACTIVE instructor, a missing or malformed offering id and a disallowed
 * offering all produce the SAME empty DTO as an offering with no plan — so the
 * result reveals neither whether the offering exists nor whether it has a plan.
 * Zero loader and zero name calls are made on any denied path.
 */
export async function readInstructorExamPlanWithDeps(
  requestedCourseOfferingId: string,
  deps: InstructorExamReadDeps,
): Promise<InstructorExamReadDto> {
  let verifiedId: string | null;
  try {
    // 1. Identity FIRST. The value is intentionally unused: no instructor
    //    identity influences which rows are read — the CALL is the gate.
    await deps.requireInstructorId();
    // 2. The requested id is a REQUEST, re-authorized server-side.
    const offering = await deps.resolveInstructorCourseOffering(requestedCourseOfferingId);
    verifiedId = idOrNull(offering?.id);
  } catch (error) {
    if (deps.isCourseContextDenial(error)) {
      return emptyInstructorExamReadDto();
    }
    // A Prisma failure, a session fault or a programming error is NOT a denial.
    throw error;
  }

  if (verifiedId === null) {
    return emptyInstructorExamReadDto();
  }

  // 3. Only now: the plan, under the LOCKED instructor options.
  const payload = await deps.loadPlan({
    courseOfferingId: verifiedId,
    options: INSTRUCTOR_EXAM_PLAN_LOAD_OPTIONS,
  });

  // 4–5. Names, then the committed narrowing. The payload never leaves.
  const names = await resolveOperationalDisplayNames(payload, deps);
  return buildInstructorExamReadDto(payload, names);
}

// ===========================================================================
// Trainee
// ===========================================================================

/**
 * The TRAINEE reading of ONE selected day.
 *
 * ORDER (a hard contract, asserted by test):
 *   0. normalize `selectedDate`. An illegible token addresses no day, so it
 *      returns the empty DTO with ZERO dependency calls. This is DELIBERATELY
 *      before the identity step: the token is caller input that selects nothing,
 *      and no authorization decision can turn it into a day. It is not a
 *      security ordering — no content is reachable on either side of it — and
 *      the state it produces is byte-identical to every other denial;
 *   1. resolve the trainee from the signed session;
 *   2. resolve that trainee's ONE authorized course through the NON-SELECTABLE
 *      resolver, which takes no arguments — the trainee must hold an ACTIVE
 *      enrollment into an ACTIVE offering or this fails closed;
 *   3. the loader, scoped by the resolver's DB-VERIFIED id, with BOTH
 *      publication gates ON and the viewer bound to the authenticated id;
 *   4. the committed day projection for the exact selected date;
 *   5. one batched student-name lookup — and NEVER an instructor one;
 *   6. the narrow arena sibling;
 *   7. the committed trainee narrowing.
 *
 * The signature accepts a DATE AND NOTHING ELSE: no `courseOfferingId`, no
 * `studentId`, no `planId`, no publication option. Every one of those is
 * unrepresentable rather than merely rejected.
 *
 * An unpublished plan, a missing plan, an unenrolled or ambiguous trainee, an
 * anonymous session and a day with no visible row all return the SAME empty DTO,
 * which carries no plan id and no publication state.
 */
export async function readTraineeExamDayWithDeps(
  selectedDate: string,
  deps: TraineeExamReadDeps,
): Promise<TraineeExamDayDto> {
  // 0. The selected day, or nothing at all.
  const date = normalizeSelectedExamDate(selectedDate);
  if (date === null) {
    return emptyTraineeExamDayDto();
  }

  let studentId: string | null;
  let verifiedId: string | null;
  try {
    // 1. The AUTHENTICATED trainee — the only trustworthy identity here.
    studentId = idOrNull(await deps.requireTraineeId());
    // 2. Their ONE authorized course. No argument exists to influence it.
    const offering = await deps.resolveTraineeCourseOffering();
    verifiedId = idOrNull(offering?.id);
  } catch (error) {
    if (deps.isCourseContextDenial(error)) {
      return emptyTraineeExamDayDto();
    }
    throw error;
  }

  if (studentId === null || verifiedId === null) {
    return emptyTraineeExamDayDto();
  }

  // 3. Only now: the plan, under the LOCKED trainee options. An unpublished plan
  //    produces the empty payload without a single content query.
  const payload = await deps.loadPlan({
    courseOfferingId: verifiedId,
    options: traineeExamPlanLoadOptions(studentId),
  });

  // 4. The committed projection. `isSelf`, the personal role, the exact personal
  //    times, the row order and the exclusion of unresolved/contradictory rows
  //    are ALL its decisions; none of them is re-derived here.
  const projection = projectTraineeExamDay(
    payload.sessions,
    payload.storedDetails,
    date,
    studentId,
  );

  // 5. ONE batched student-name lookup, over the VISIBLE rows of this day only —
  //    so no id of a hidden, unpublished or off-date row is ever asked about.
  const visibleSessions = projection.allRows.map((row) => row.session);
  const studentIds = collectExamStudentDisplayIds(visibleSessions, payload.beginnerDetails);
  const studentNames =
    studentIds.length === 0 ? emptyNameMap() : await deps.fetchStudentDisplayNames(studentIds);

  // 6. The narrow arena sibling — one scalar per stored session, nothing else.
  const arenas = buildTraineeExamArenaLookup(payload.conflictSessions);

  // 7. The committed narrowing. `instructorNames` is EMPTY on purpose: the
  //    responsible instructor's display name falls back to the value the live
  //    adapter already carries, so this reader issues no instructor query.
  return buildTraineeExamDayDto(projection, payload.beginnerDetails, arenas, {
    studentNames: usableNameMap(studentNames),
    instructorNames: emptyNameMap(),
  });
}
