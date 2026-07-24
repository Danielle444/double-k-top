/**
 * URGENT LEVEL 2 ACCESS - SLICE S2A: the PURE core for COURSE-SCOPED INSTRUCTOR
 * schedule reading.
 *
 * PURE by construction: no Prisma, no DB, no clock, no randomness, no env, no
 * cookies, no next/headers, no React. It only shapes queries, maps already
 * fetched rows, and decides authorization from explicitly supplied arguments -
 * so the whole instructor course-scoping contract is unit-testable without a
 * database (see instructor-schedule-scope-core.test.ts).
 *
 * WHY THIS EXISTS
 * ---------------
 * Before this slice the instructor schedule was the last GLOBAL schedule reader
 * in the app: the week list ran `prisma.weeklySchedule.findMany()` with no
 * predicate at all, the item read looked a week up by bare id, and the caller
 * supplied its own `instructorId` as identity. None of those could tell Level 1
 * from Level 2. This core replaces all three with an offering-scoped contract.
 *
 * WHAT THIS OWNS
 * --------------
 *  1. The EXACT offering-scoped query shapes for the instructor week option
 *     list, the by-id week read, and the today week read.
 *  2. The row -> option / row -> item mappings.
 *  3. The "mine" filter helpers, MOVED VERBATIM from lib/actions/instructor-
 *     schedule.ts so there is a single, testable source of truth and the
 *     existing matching behaviour provably does not drift.
 *  4. Three dependency-injected orchestrations that FIX THE ORDER of the gates,
 *     so the "use server" actions stay thin IO shells.
 *
 * HARD RULES BAKED IN HERE
 * ------------------------
 *  - The instructor is authenticated FIRST, from the signed session. No
 *    parameter anywhere in this module accepts an instructor id: identity is
 *    supplied by an injected boundary that reads the session, never by a caller.
 *  - The requested courseOfferingId is a REQUEST, never a grant. It is
 *    re-validated by the injected resolver, and only the RESOLVED row's id
 *    reaches a query.
 *  - SCHEDULE must be POSITIVELY "ENABLED" for that exact resolved offering.
 *    READ_ONLY, a missing row, a retired catalog entry and a malformed status
 *    all DENY.
 *  - EVERY week query carries `courseOfferingId` as a mandatory predicate. The
 *    by-id read uses a COMPOSITE where (id AND courseOfferingId), so a week
 *    belonging to another course returns null rather than being read and then
 *    checked.
 *  - `courseOfferingId === null` (a pre-spine week) can never match, because the
 *    predicate is always an exact string equality against a resolved cuid.
 *  - Dates NEVER choose a course. The today read picks WHICH WEEK inside an
 *    already-resolved offering; the offering itself is never inferred from a
 *    date, a name, a level, a status, row order or a cookie, and there is no
 *    Level 1 fallback.
 *  - Instructors keep seeing UNPUBLISHED weeks: unlike the trainee core, no
 *    `isPublished` predicate is added anywhere. That is the pre-existing
 *    instructor behaviour and this slice must not regress it.
 *  - Every denial produces the SAME empty result, so a week id can never be
 *    probed across courses.
 */
import { dateKey, formatHebrewDate, formatHebrewWeekday, parseDateKey } from "@/lib/dates";
import { cleanScheduleTitle } from "@/lib/schedule-title";
import {
  MissingInstructorCourseOfferingIdError,
  InstructorCourseOfferingNotAllowedError,
} from "./actor-course-offering-core";
import { UnauthenticatedActorError } from "@/lib/auth/actor-types";
import { pickDefaultWeekId } from "./course-scoped-week-options-core";
import type { CapabilityKey } from "./capabilities/capability-keys";
import type { EffectiveCapabilityStatus } from "./capabilities/effective-capability-core";

// ---------------------------------------------------------------------------
// Public view contracts
//
// MOVED here from lib/actions/instructor-schedule.ts unchanged, field for field,
// so the client component's rendering is untouched by this slice. They live in
// the pure core (not the action) because both the by-id read and the today read
// produce them, and the tests must be able to assert them without importing a
// "use server" module.
// ---------------------------------------------------------------------------

export interface InstructorScheduleItem {
  id: string;
  dateKey: string;
  dateLabel: string;
  dayLabel: string;
  startTime: string;
  endTime: string;
  title: string;
  description: string | null;
  groupName: string | null;
  instructorName: string | null;
  location: string | null;
}

export interface InstructorScheduleResult {
  hasSchedule: boolean;
  weekName: string | null;
  items: InstructorScheduleItem[];
}

export type InstructorScheduleFilter = "mine" | "all";

/** The one week-option shape the instructor week picker consumes. */
export interface InstructorWeekOption {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
}

export interface InstructorWeekSelection {
  weeks: InstructorWeekOption[];
  defaultWeekId: string | null;
}

/**
 * The uniform denial for the week list. A fresh object per call: the value is
 * handed to a React client that may hold it in state, and a shared frozen
 * singleton would make an accidental mutation cross-request-visible.
 */
export function emptyInstructorWeekSelection(): InstructorWeekSelection {
  return { weeks: [], defaultWeekId: null };
}

/**
 * The uniform denial for both item reads.
 *
 * `hasSchedule: false` is deliberate and matches what the legacy reader already
 * returned for an unknown week id, so the client renders its existing
 * "עדיין לא הועלה לו״ז לשבוע זה" message. A denial is therefore indistinguishable
 * from "this course has no such week" - which is exactly the point.
 */
export function emptyInstructorScheduleResult(): InstructorScheduleResult {
  return { hasSchedule: false, weekName: null, items: [] };
}

// ---------------------------------------------------------------------------
// SCHEDULE capability
// ---------------------------------------------------------------------------

/** The single capability key that authorizes any instructor schedule reading. */
export const INSTRUCTOR_SCHEDULE_CAPABILITY_KEY: CapabilityKey = "SCHEDULE";

/**
 * Positive-ENABLED test, deliberately `=== "ENABLED"` rather than
 * `!== "DISABLED"`: a missing capability row (effective DISABLED under CAP-1), a
 * retired catalog entry, a malformed status and READ_ONLY all DENY. A partial or
 * absent map denies rather than throwing.
 *
 * This intentionally duplicates the one-line trainee predicate in
 * course-scoped-week-options-core rather than sharing it. The trainee symbol is
 * named for its audience and is referenced by a committed contract test;
 * renaming it to share would widen this diff into the trainee schedule path for
 * no behavioural gain. The two are asserted equivalent in the focused tests.
 */
export function isInstructorScheduleCapabilityEnabled(
  capabilities: Partial<Record<CapabilityKey, EffectiveCapabilityStatus>> | null | undefined,
): boolean {
  if (!capabilities) return false;
  return capabilities[INSTRUCTOR_SCHEDULE_CAPABILITY_KEY] === "ENABLED";
}

// ---------------------------------------------------------------------------
// Course-context denial
// ---------------------------------------------------------------------------

/**
 * Is this failure "the caller did not name a course context it may address"
 * (rather than an infrastructure fault or a real data defect)?
 *
 *  - UnauthenticatedActorError: anonymous / wrong-audience / inactive instructor.
 *  - MissingInstructorCourseOfferingIdError: no explicit offering was stated.
 *  - InstructorCourseOfferingNotAllowedError: outside the temporary policy.
 *
 * InstructorCourseOfferingUnavailableError is DELIBERATELY EXCLUDED, matching the
 * reviewed contacts decision: an id that passed the allow-list but has no row
 * means a configured offering is missing from the database. That is a real defect
 * and must fail loudly rather than be laundered into "this course has no weeks".
 * Prisma failures and capability-reader failures likewise propagate unchanged.
 */
export function isInstructorScheduleDenial(error: unknown): boolean {
  return (
    error instanceof UnauthenticatedActorError ||
    error instanceof MissingInstructorCourseOfferingIdError ||
    error instanceof InstructorCourseOfferingNotAllowedError
  );
}

// ---------------------------------------------------------------------------
// Query shapes
// ---------------------------------------------------------------------------

/** The exact columns the week option list projects - no items, no offering id. */
export const INSTRUCTOR_WEEK_OPTION_SELECT = {
  id: true,
  name: true,
  startDate: true,
  endDate: true,
} as const;

export interface InstructorWeekOptionsQuery {
  where: { courseOfferingId: string };
  orderBy: { startDate: "asc" };
  select: typeof INSTRUCTOR_WEEK_OPTION_SELECT;
}

/**
 * Build the offering-scoped week option query.
 *
 * `courseOfferingId` is the ONLY predicate, and it is mandatory. There is
 * deliberately NO `isPublished` filter: instructors have always been able to see
 * unpublished weeks so they can prepare and check them before publication, and
 * this slice preserves that exactly (the trainee reader keeps its own
 * published-only query - see buildTraineeWeekOptionsQuery).
 *
 * A blank offering id is a programming error (the server resolver always yields
 * a real cuid) and building a query from it would silently widen scope to every
 * course, so it throws rather than returning a query.
 */
export function buildInstructorWeekOptionsQuery(
  courseOfferingId: string,
): InstructorWeekOptionsQuery {
  assertResolvedOfferingId(courseOfferingId, "buildInstructorWeekOptionsQuery");
  return {
    where: { courseOfferingId },
    orderBy: { startDate: "asc" },
    select: INSTRUCTOR_WEEK_OPTION_SELECT,
  };
}

/**
 * Only the WHERE lives here. The row PROJECTION (which columns, and the item
 * ordering) is supplied inline by the "use server" shell, because Prisma infers
 * a result type only from a literal select/include at the call site. That split
 * is deliberate and safe: the projection decides what is READ BACK, while this
 * core keeps sole ownership of what is REACHABLE - which is the security
 * property the tests assert.
 */
export interface InstructorWeekReadQuery {
  where: { id: string; courseOfferingId: string };
}

/**
 * Build the COMPOSITE by-id week read.
 *
 * Both predicates are mandatory and neither is caller-configurable. Ownership is
 * enforced IN THE QUERY, not after it: a week belonging to another offering (or
 * a pre-spine week whose courseOfferingId is NULL) simply does not match, so its
 * name and items are never loaded into memory at all and cannot leak through a
 * later mistake.
 */
export function buildInstructorWeekReadQuery(
  weeklyScheduleId: string,
  courseOfferingId: string,
): InstructorWeekReadQuery {
  assertResolvedOfferingId(courseOfferingId, "buildInstructorWeekReadQuery");
  if (typeof weeklyScheduleId !== "string" || weeklyScheduleId.length === 0) {
    throw new Error("buildInstructorWeekReadQuery requires a non-empty weeklyScheduleId");
  }
  return { where: { id: weeklyScheduleId, courseOfferingId } };
}

/** As above: WHERE (plus a deterministic order) here, projection in the shell. */
export interface InstructorTodayWeekQuery {
  where: {
    courseOfferingId: string;
    startDate: { lte: Date };
    endDate: { gte: Date };
  };
  orderBy: { startDate: "asc" };
}

/**
 * Build the "which week of THIS course covers today" read.
 *
 * The date range narrows WHICH WEEK is picked INSIDE an already-resolved
 * offering. It never picks the offering: `courseOfferingId` is a mandatory exact
 * predicate on the same query, so no date can reach across courses. This is the
 * distinction the launch audit required - the old global reader chose a week by
 * date alone across every course, and that behaviour does not survive.
 *
 * `todayKey` is produced by an injected server clock AFTER authorization (see
 * loadInstructorTodayScheduleWithDeps); this function never reads a clock.
 */
export function buildInstructorTodayWeekQuery(
  courseOfferingId: string,
  todayKey: string,
): InstructorTodayWeekQuery {
  assertResolvedOfferingId(courseOfferingId, "buildInstructorTodayWeekQuery");
  const today = parseDateKey(todayKey);
  return {
    where: {
      courseOfferingId,
      startDate: { lte: today },
      endDate: { gte: today },
    },
    orderBy: { startDate: "asc" },
  };
}

function assertResolvedOfferingId(courseOfferingId: string, fn: string): void {
  if (typeof courseOfferingId !== "string" || courseOfferingId.length === 0) {
    throw new Error(`${fn} requires a non-empty, server-resolved courseOfferingId`);
  }
}

// ---------------------------------------------------------------------------
// Row shapes and mapping
// ---------------------------------------------------------------------------

/** A fetched week option row, exactly as the option query projects it. */
export interface InstructorWeekOptionRow {
  id: string;
  name: string;
  startDate: Date;
  endDate: Date;
}

/** One fetched ScheduleItem, exactly as much of it as the mapping needs. */
export interface InstructorScheduleItemRow {
  id: string;
  date: Date;
  startTime: string;
  endTime: string;
  title: string;
  description: string | null;
  groupName: string | null;
  instructorName: string | null;
  location: string | null;
}

/** A fetched week plus its ordered items. */
export interface InstructorWeekWithItemsRow {
  id: string;
  name: string;
  items: readonly InstructorScheduleItemRow[];
}

/**
 * Map fetched week rows to options. Identical to the mapping the legacy global
 * reader performed (Date -> date key, same field order), so the client-facing
 * option shape is unchanged.
 */
export function toInstructorWeekOptions(
  rows: readonly InstructorWeekOptionRow[],
): InstructorWeekOption[] {
  return rows.map((w) => ({
    id: w.id,
    name: w.name,
    startDate: dateKey(w.startDate),
    endDate: dateKey(w.endDate),
  }));
}

// ---------------------------------------------------------------------------
// The "mine" filter - MOVED VERBATIM from lib/actions/instructor-schedule.ts
//
// Behaviour is unchanged, character for character. It moved so that (a) it is
// covered by DB-free tests, and (b) exactly one implementation exists once the
// legacy global reader is deleted.
// ---------------------------------------------------------------------------

// Collapses whitespace/separators and strips common punctuation so Hebrew
// names compare reliably regardless of commas, slashes, or extra spacing
// introduced by the Excel import.
export function normalizeHebrewName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[,;/|]+/g, " ")
    .replace(/["'`׳״]/g, "")
    .replace(/\s+/g, " ");
}

// The schedule's instructorName column is free text (there is no FK from
// ScheduleItem to Instructor - the Excel import only ever produces a name
// string) and can list multiple instructors, e.g. "דנה, יוסי" or "כולם".
// A lesson is "mine" if the instructor's first name or full name appears
// anywhere in that text, or if the text marks the lesson for everyone.
export function isInstructorMatch(
  instructorName: string | null,
  instructor: { firstName: string; fullName: string },
): boolean {
  if (!instructorName) return false;
  const normalized = normalizeHebrewName(instructorName);
  if (normalized.includes("כולם")) return true;

  const firstName = normalizeHebrewName(instructor.firstName);
  const fullName = normalizeHebrewName(instructor.fullName);
  return (
    (firstName.length > 0 && normalized.includes(firstName)) ||
    (fullName.length > 0 && normalized.includes(fullName))
  );
}

// Meal slots always concern every instructor regardless of who the
// instructorName column names, so they always show up under "מהשיעורים שלי".
// Real schedules abbreviate the meal marker ("א. צהריים", "א. ערב + ...")
// as often as they spell it out ("ארוחת צהריים"/"ארוחת ערב"), so a meal
// marker plus a "צהריים"/"ערב" mention is required together, rather than
// matching the full phrase literally (which would miss the abbreviation).
const MEAL_MARKER_PATTERN = /(ארוחה|ארוחת|א\.)/;
const LUNCH_OR_DINNER_PATTERN = /(צהריים|ערב)/;

export function isMealItem(title: string): boolean {
  const cleaned = cleanScheduleTitle(title);
  return MEAL_MARKER_PATTERN.test(cleaned) && LUNCH_OR_DINNER_PATTERN.test(cleaned);
}

/**
 * Filter + map one already-OWNERSHIP-VERIFIED week into the client result.
 *
 * MOVED VERBATIM from the legacy reader: the same "mine"/meal predicate, the
 * same dayKey narrowing, the same field mapping and the same ordering (the rows
 * arrive pre-ordered by the query, and this never re-sorts).
 *
 * The caller must ONLY pass a row that came back from an offering-scoped query -
 * this function performs no ownership check of its own and must never become the
 * place where one is bolted on.
 */
export function toInstructorScheduleResult(
  week: InstructorWeekWithItemsRow,
  dayKey: string | "all",
  filter: InstructorScheduleFilter,
  instructor: { firstName: string; fullName: string },
): InstructorScheduleResult {
  const items = week.items.filter((i) => {
    if (
      filter === "mine" &&
      !isInstructorMatch(i.instructorName, instructor) &&
      !isMealItem(i.title)
    ) {
      return false;
    }
    if (dayKey !== "all" && dateKey(i.date) !== dayKey) return false;
    return true;
  });

  return {
    hasSchedule: true,
    weekName: week.name,
    items: items.map((i) => ({
      id: i.id,
      dateKey: dateKey(i.date),
      dateLabel: formatHebrewDate(i.date),
      dayLabel: formatHebrewWeekday(i.date),
      startTime: i.startTime,
      endTime: i.endTime,
      title: i.title,
      description: i.description,
      groupName: i.groupName,
      instructorName: i.instructorName,
      location: i.location,
    })),
  };
}

// ---------------------------------------------------------------------------
// Dependency-injected orchestration
//
// These live in the PURE core (not in the "use server" shell) on purpose: they
// perform no IO themselves, only sequence injected boundaries. Keeping them here
// lets the DB-free tests exercise the EXACT gate ordering and query shapes
// without importing Prisma or the next/headers-backed Actor DAL.
// ---------------------------------------------------------------------------

/**
 * The identity boundary. Reads the SIGNED SESSION and returns the authenticated
 * instructor's display names, or THROWS (UnauthenticatedActorError) for an
 * anonymous, wrong-audience, invalid-session or INACTIVE caller.
 *
 * There is deliberately no `id` in the returned shape and no instructor id
 * parameter anywhere in this module: nothing downstream may key off a
 * caller-supplied identity, and the names are used ONLY by the "mine" filter.
 */
export type RequireInstructorIdentity = () => Promise<{
  firstName: string;
  fullName: string;
}>;

/** The offering + capability boundary shared by all three orchestrations. */
export interface InstructorCourseScopeDeps {
  resolveInstructorCourseOffering: (
    requestedCourseOfferingId: string,
  ) => Promise<{ id: string }>;
  getEffectiveCapabilities: (
    courseOfferingId: string,
  ) => Promise<Partial<Record<CapabilityKey, EffectiveCapabilityStatus>>>;
}

/**
 * Authenticate, re-validate the requested offering, and require SCHEDULE.
 *
 * Returns the RESOLVED offering id (the DB-verified primary key, never the
 * requested string) or null when the caller is denied. Throws only for real
 * defects - a missing configured offering, a Prisma fault, a capability-reader
 * fault - which must never be laundered into an empty schedule.
 *
 * Order is a HARD CONTRACT and is asserted by the focused tests:
 *   1. requireInstructorIdentity()   (FIRST awaited operation)
 *   2. resolveInstructorCourseOffering(requested)
 *   3. getEffectiveCapabilities(resolved.id) -> SCHEDULE === "ENABLED"
 * Nothing may be read from the schedule tables before all three pass.
 */
async function authorizeInstructorScheduleScope(
  requestedCourseOfferingId: string,
  requireInstructorIdentity: RequireInstructorIdentity,
  deps: InstructorCourseScopeDeps,
): Promise<{ offeringId: string; instructor: { firstName: string; fullName: string } } | null> {
  let instructor: { firstName: string; fullName: string };
  let resolved: { id: string };
  try {
    instructor = await requireInstructorIdentity();
    resolved = await deps.resolveInstructorCourseOffering(requestedCourseOfferingId);
  } catch (error) {
    if (isInstructorScheduleDenial(error)) {
      return null;
    }
    throw error;
  }

  const capabilities = await deps.getEffectiveCapabilities(resolved.id);
  if (!isInstructorScheduleCapabilityEnabled(capabilities)) {
    return null;
  }
  return { offeringId: resolved.id, instructor };
}

export interface InstructorWeekSelectionDeps extends InstructorCourseScopeDeps {
  requireInstructorIdentity: RequireInstructorIdentity;
  fetchWeekOptionRows: (
    query: InstructorWeekOptionsQuery,
  ) => Promise<readonly InstructorWeekOptionRow[]>;
  todayDateKey: () => string;
}

/**
 * The offering-scoped instructor week list.
 *
 * `pickDefaultWeekId` is the committed, shared implementation and is handed a
 * list that has ALREADY been narrowed to one offering by the query above, so it
 * can never reach across courses on its own. Picking a default week INSIDE the
 * chosen course is not course inference - the course was chosen explicitly by
 * the instructor and proven server-side before this point.
 */
export async function loadInstructorWeekSelectionWithDeps(
  requestedCourseOfferingId: string,
  deps: InstructorWeekSelectionDeps,
): Promise<InstructorWeekSelection> {
  const scope = await authorizeInstructorScheduleScope(
    requestedCourseOfferingId,
    deps.requireInstructorIdentity,
    deps,
  );
  if (scope === null) {
    return emptyInstructorWeekSelection();
  }

  const rows = await deps.fetchWeekOptionRows(
    buildInstructorWeekOptionsQuery(scope.offeringId),
  );
  const weeks = toInstructorWeekOptions(rows);
  return { weeks, defaultWeekId: pickDefaultWeekId(weeks, deps.todayDateKey()) };
}

export interface InstructorScheduleReadDeps extends InstructorCourseScopeDeps {
  requireInstructorIdentity: RequireInstructorIdentity;
  fetchWeekWithItems: (
    query: InstructorWeekReadQuery,
  ) => Promise<InstructorWeekWithItemsRow | null>;
}

/**
 * The offering-scoped instructor week read.
 *
 * A blank weeklyScheduleId is treated as "nothing selected" and denied with the
 * uniform empty result rather than throwing - the client legitimately renders
 * before a week is chosen. A week owned by another offering cannot match the
 * composite query and produces the SAME empty result, so week ids cannot be
 * probed across courses.
 */
export async function loadInstructorScheduleWithDeps(
  requestedCourseOfferingId: string,
  weeklyScheduleId: string | null,
  dayKey: string | "all",
  filter: InstructorScheduleFilter,
  deps: InstructorScheduleReadDeps,
): Promise<InstructorScheduleResult> {
  if (typeof weeklyScheduleId !== "string" || weeklyScheduleId.length === 0) {
    return emptyInstructorScheduleResult();
  }
  const scope = await authorizeInstructorScheduleScope(
    requestedCourseOfferingId,
    deps.requireInstructorIdentity,
    deps,
  );
  if (scope === null) {
    return emptyInstructorScheduleResult();
  }

  const week = await deps.fetchWeekWithItems(
    buildInstructorWeekReadQuery(weeklyScheduleId, scope.offeringId),
  );
  if (week === null) {
    return emptyInstructorScheduleResult();
  }
  return toInstructorScheduleResult(week, dayKey, filter, scope.instructor);
}

export interface InstructorTodayScheduleDeps extends InstructorCourseScopeDeps {
  requireInstructorIdentity: RequireInstructorIdentity;
  fetchTodayWeekWithItems: (
    query: InstructorTodayWeekQuery,
  ) => Promise<InstructorWeekWithItemsRow | null>;
  todayDateKey: () => string;
}

/**
 * The offering-scoped "today" read used by the instructor home card.
 *
 * `todayDateKey()` is called ONLY AFTER the identity, offering and capability
 * gates have all passed, so an unauthorized caller never even causes a clock
 * read, let alone a schedule query. ONE clock reading drives both the week
 * lookup and the item narrowing, so the decision cannot straddle two "now"s.
 */
export async function loadInstructorTodayScheduleWithDeps(
  requestedCourseOfferingId: string,
  filter: InstructorScheduleFilter,
  deps: InstructorTodayScheduleDeps,
): Promise<InstructorScheduleResult> {
  const scope = await authorizeInstructorScheduleScope(
    requestedCourseOfferingId,
    deps.requireInstructorIdentity,
    deps,
  );
  if (scope === null) {
    return emptyInstructorScheduleResult();
  }

  const todayKey = deps.todayDateKey();
  const week = await deps.fetchTodayWeekWithItems(
    buildInstructorTodayWeekQuery(scope.offeringId, todayKey),
  );
  if (week === null) {
    return emptyInstructorScheduleResult();
  }
  return toInstructorScheduleResult(week, todayKey, filter, scope.instructor);
}
