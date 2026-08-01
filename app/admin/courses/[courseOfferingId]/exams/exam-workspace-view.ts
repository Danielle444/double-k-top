/**
 * EXAM EX-ADMIN-WORKSPACE-UX — the PURE presentation logic of the admin exams
 * workspace: which section is open, which schedule view is showing, and how the
 * stored rows are arranged into the timetable a manager has to be able to read.
 *
 * PURE by construction. This module has NO IMPORTS AT ALL, so it holds no
 * database client, no clock, no locale, no framework and no server-only
 * dependency. Every export is a total, deterministic function of its arguments
 * and never mutates its inputs, which is what lets the whole workspace be
 * arranged by a Server Component that holds no state of its own.
 *
 * ===========================================================================
 * ONE STORE, SEVERAL VIEWS — NEVER SEVERAL COPIES
 * ===========================================================================
 * The three schedule views are ARRANGEMENTS of the same rows the committed
 * readers returned, produced here and never persisted: the general timetable is
 * that list, the by-type view groups it by `ExamDefinition`, and the by-date
 * view groups it by stored day. No view reads a second source, none stores
 * anything, and none can disagree with another about what exists — a session
 * that is missing from one would have to be missing from the input.
 *
 * The committed day grouping stays the FINAL ordering authority: every function
 * here preserves the arrival order of what it is given and sorts nothing. That
 * is deliberate. A second opinion about order, derived here from a subset of the
 * fields, is exactly how two surfaces of one plan start disagreeing.
 *
 * ===========================================================================
 * THE WAVE IS DERIVED ELSEWHERE, AND THIS MODULE ONLY JOINS IT
 * ===========================================================================
 * A block's personal times are business logic owned by the committed block
 * timetable core, reached through the committed adapter by the admin read
 * pipeline — the same chain the instructor DTO and the trainee day are built
 * from. This module reads the moments that pipeline produced and JOINS the
 * workspace's own examinee rows to them.
 *
 * It performs NO TIME ARITHMETIC OF ANY KIND, and none may be added: no exam
 * duration, no parallel capacity, no wave index, no `HH:MM` parsing or
 * formatting, no addition and no multiplication appear anywhere below. A second
 * derivation would be a second source of truth, and the admin schedule would
 * drift from what everybody else is shown.
 */

// ===========================================================================
// 1. The four workspace sections
// ===========================================================================

/** The four sections, in the order their tabs are rendered. */
export const EXAM_WORKSPACE_TABS = [
  "definitions",
  "schedule",
  "assignments",
  "publication",
] as const;

export type ExamWorkspaceTab = (typeof EXAM_WORKSPACE_TABS)[number];

/** The Hebrew name of each section. Owned here; nothing derives one from a query. */
export const EXAM_WORKSPACE_TAB_LABELS: Readonly<Record<ExamWorkspaceTab, string>> =
  Object.freeze({
    definitions: "סוגי מבחנים",
    schedule: "מופעים וזמנים",
    assignments: "שיבוצים",
    publication: "פרסום",
  });

/** The section a request that names none — or names one that does not exist — gets. */
export const DEFAULT_EXAM_WORKSPACE_TAB: ExamWorkspaceTab = "definitions";

/**
 * Parse the CLOSED section token.
 *
 * Total and closed in both directions: a repeated query key arrives as an ARRAY
 * and must simply not be a recognized token, which is why the `typeof` test is
 * load-bearing rather than decorative. Every unrecognized value falls back to the
 * default section, so a hand-typed value can select a section and can never
 * supply one, reach a reader or influence a scope.
 */
export function parseExamWorkspaceTab(raw: string | string[] | undefined): ExamWorkspaceTab {
  if (typeof raw !== "string") return DEFAULT_EXAM_WORKSPACE_TAB;
  return (EXAM_WORKSPACE_TABS as readonly string[]).includes(raw)
    ? (raw as ExamWorkspaceTab)
    : DEFAULT_EXAM_WORKSPACE_TAB;
}

/**
 * Which section a request should OPEN, given the explicit token and which family
 * of outcome feedback came back with it.
 *
 * A manager who publishes must land on the publication section and read the
 * result there; one who saves an examinee's card must land back among the
 * assignments. The committed Server Actions predate the workspace and redirect
 * with their own outcome tokens and no section, so the section is DERIVED from
 * the family of token that arrived rather than added to ten redirect strings —
 * which keeps every one of those endpoints exactly as it was.
 *
 * PRECEDENCE, and it is fixed: an explicit `tab` the manager clicked wins over
 * everything, because they asked for it in the URL. Otherwise the feedback
 * decides, most specific family first. With neither, the default section opens.
 *
 * Total, and it selects a section only — no read, no affordance and no scope
 * anywhere is influenced by what this returns.
 */
export function resolveExamWorkspaceTab(input: {
  readonly explicit: string | string[] | undefined;
  readonly hasDefinitionFeedback: boolean;
  readonly hasScheduleFeedback: boolean;
  readonly hasAssignmentFeedback: boolean;
  readonly hasPublicationFeedback: boolean;
}): ExamWorkspaceTab {
  if (typeof input.explicit === "string") {
    if ((EXAM_WORKSPACE_TABS as readonly string[]).includes(input.explicit)) {
      return input.explicit as ExamWorkspaceTab;
    }
  }
  if (input.hasAssignmentFeedback) return "assignments";
  if (input.hasScheduleFeedback) return "schedule";
  if (input.hasPublicationFeedback) return "publication";
  if (input.hasDefinitionFeedback) return "definitions";
  return DEFAULT_EXAM_WORKSPACE_TAB;
}

// ===========================================================================
// 2. The three schedule views
// ===========================================================================

/** The three arrangements of one stored schedule. */
export const EXAM_SCHEDULE_VIEWS = ["general", "type", "date"] as const;

export type ExamScheduleView = (typeof EXAM_SCHEDULE_VIEWS)[number];

/** The Hebrew name of each view. */
export const EXAM_SCHEDULE_VIEW_LABELS: Readonly<Record<ExamScheduleView, string>> =
  Object.freeze({
    general: "לו״ז כללי",
    type: "לפי סוג מבחן",
    date: "לפי תאריך",
  });

export const DEFAULT_EXAM_SCHEDULE_VIEW: ExamScheduleView = "general";

/** Parse the CLOSED view token, on exactly the terms the section parser uses. */
export function parseExamScheduleView(raw: string | string[] | undefined): ExamScheduleView {
  if (typeof raw !== "string") return DEFAULT_EXAM_SCHEDULE_VIEW;
  return (EXAM_SCHEDULE_VIEWS as readonly string[]).includes(raw)
    ? (raw as ExamScheduleView)
    : DEFAULT_EXAM_SCHEDULE_VIEW;
}

// ===========================================================================
// 3. The examinee, and the waves the COMMITTED timetable put them in
// ===========================================================================

/**
 * THERE IS NO TIME ARITHMETIC IN THIS MODULE, AND NONE MAY BE ADDED.
 *
 * Wave times, personal times and the block end are business logic with exactly
 * one owner: the committed block timetable core, reached through the committed
 * adapter by the admin read pipeline. This route READS those values and never
 * reproduces them — there is no duration, no parallel capacity, no wave index,
 * no `HH:MM` parsing or formatting and no addition or multiplication anywhere
 * below, because a second derivation would be a second source of truth and the
 * admin schedule would silently drift from what instructors and trainees see.
 *
 * What this module still does is JOIN: the canonical view names the assignment
 * ids of each wave, and the workspace has to put the person the manager edits
 * back beside them. That is a lookup, and it is all it is.
 */

/**
 * ONE examinee, as the workspace arranges it.
 *
 * The instructed trainee this examinee TEACHES travels inside this entry, as a
 * name and the assignment id its own row carries. The relationship is
 * one-to-one, so it is one optional field and never a list — and the trainee
 * therefore has no entry of its own anywhere in a wave.
 *
 * There is deliberately no `studentId`, no `orderIndex` and NO TIME: the moment
 * belongs to the wave, so a card physically cannot repeat it.
 */
export interface WorkspaceExaminee {
  readonly assignmentId: string;
  readonly traineeName: string;
  readonly horseName: string | null;
  readonly instructionTopic: string | null;
  readonly discipline: string | null;
  readonly instructedTraineeAssignmentId: string | null;
  readonly instructedTraineeName: string | null;
}

/**
 * ONE wave, ready to render: the committed timetable's own moment, and the
 * people the workspace found for the ids it named.
 */
export interface ExamWave {
  /** VERBATIM from the canonical view. Never assembled here. */
  readonly startTime: string;
  /** VERBATIM from the canonical view, or `null`. */
  readonly endTime: string | null;
  readonly examinees: readonly WorkspaceExaminee[];
}

/** The canonical shape this module joins against — structurally, so it stays pure. */
export interface CanonicalWave {
  readonly startTime: string;
  readonly endTime: string | null;
  readonly examineeAssignmentIds: readonly string[];
}

const NO_WAVES: readonly ExamWave[] = Object.freeze([]);
const NO_EXAMINEES: readonly WorkspaceExaminee[] = Object.freeze([]);

/**
 * Put the workspace's own examinee rows beside the ids the canonical wave view
 * named, preserving that view's order in both dimensions.
 *
 * A canonical id the workspace has no row for is SKIPPED rather than rendered as
 * a blank card: the two reads are separate, so a create or a removal landing
 * between them can briefly disagree, and inventing a card for an id nobody can
 * describe would be worse than showing one fewer for a moment. A wave left with
 * nobody is dropped for the same reason — an empty time slot is not information.
 *
 * Never mutates its inputs, reads no clock and computes no time.
 */
export function attachExamineesToWaves(
  waves: readonly CanonicalWave[],
  examineesByAssignmentId: ReadonlyMap<string, WorkspaceExaminee>,
): readonly ExamWave[] {
  const out: ExamWave[] = [];
  const list = Array.isArray(waves) ? waves : [];
  for (const wave of list) {
    if (wave === null || typeof wave !== "object") continue;
    const examinees: WorkspaceExaminee[] = [];
    for (const assignmentId of wave.examineeAssignmentIds) {
      const examinee = examineesByAssignmentId.get(assignmentId);
      if (examinee === undefined) continue;
      examinees.push(examinee);
    }
    if (examinees.length === 0) continue;
    out.push(
      Object.freeze({
        startTime: wave.startTime,
        endTime: wave.endTime,
        examinees: Object.freeze(examinees),
      }),
    );
  }
  return out.length === 0 ? NO_WAVES : Object.freeze(out);
}

/**
 * The examinees the canonical view produced NO wave for, in the workspace's own
 * order — an unresolved block's whole roster, or a row the timetable could not
 * place. They are still SHOWN, under a heading that says the times are
 * unavailable, because a session that hid them would look emptier than it is.
 */
export function collectUntimedExaminees(
  untimedAssignmentIds: readonly string[],
  examineesByAssignmentId: ReadonlyMap<string, WorkspaceExaminee>,
): readonly WorkspaceExaminee[] {
  const out: WorkspaceExaminee[] = [];
  const list = Array.isArray(untimedAssignmentIds) ? untimedAssignmentIds : [];
  for (const assignmentId of list) {
    const examinee = examineesByAssignmentId.get(assignmentId);
    if (examinee === undefined) continue;
    out.push(examinee);
  }
  return out.length === 0 ? NO_EXAMINEES : Object.freeze(out);
}

// ===========================================================================
// 4b. BEGINNER EXAMS — the typed integration point, deliberately empty here
// ===========================================================================

/**
 * ONE read-only beginner CHILD, as the admin workspace renders it.
 *
 * These are the fields the committed operational beginner detail already
 * publishes to an authorized admin, carried through UNCHANGED. The admin exam
 * workspace is an operational screen — the manager running the day needs to know
 * which child is on which horse and who to call — and the committed reader has
 * already decided that an operational role may see them.
 *
 * `childAssignmentId` is deliberately absent: it is a write target, and there is
 * no beginner write on this route at all.
 */
export interface WorkspaceBeginnerChild {
  readonly fullName: string;
  readonly age: number | null;
  readonly gender: string | null;
  readonly childNotes: string | null;
  readonly parentName: string | null;
  readonly parentPhone: string | null;
  readonly horseName: string | null;
  readonly equipmentNotes: string | null;
  readonly isAbsent: boolean;
}

/**
 * ONE read-only beginner row, as the admin workspace renders it.
 *
 * Every field is a NARROWING of what the committed operational DTO publishes on
 * a row whose `source` is `"BEGINNER"` — that row plus its own `beginner`
 * detail. There is NO second query, NO second reader and NO derivation: the
 * times are the DTO's own, exactly like every other clock on this page.
 *
 * WHICH ROWS EXIST AT ALL is the merged loader's decision and never this
 * route's: beginner Teaching-Practice exams are gated to Level 1 there, so a
 * Level-2 offering simply receives none. This surface adds no second level test
 * — a UI-level check would be a second opinion about a containment rule it does
 * not own, and would go quietly wrong the moment that rule changed.
 */
export interface WorkspaceBeginnerRow {
  readonly sessionId: string;
  readonly date: string;
  readonly startTime: string;
  /** The row's own displayed end, or `null`. VERBATIM from the DTO. */
  readonly displayEndTime: string | null;
  readonly beginnerFormat: string;
  readonly groupName: string | null;
  readonly location: string | null;
  readonly responsibleInstructorName: string | null;
  readonly participantNames: readonly string[];
  readonly participantCount: number;
  readonly children: readonly WorkspaceBeginnerChild[];
  readonly notes: string | null;
  readonly isPublished: boolean;
}

export const NO_BEGINNER_ROWS: readonly WorkspaceBeginnerRow[] = Object.freeze([]);

// ===========================================================================
// 5. The three arrangements of the session list
// ===========================================================================

/**
 * The minimum a session must publish for the three views to arrange it. It is a
 * STRUCTURAL shape rather than an imported one, so this module stays free of any
 * dependency and can be exercised on plain objects.
 */
export interface WorkspaceSchedulableSession {
  readonly sessionId: string;
  readonly definitionId: string;
  readonly definitionName: string;
  /** VERBATIM `HH:MM`, the stored block start. Compared, never computed. */
  readonly startTime: string;
}

/** One day, exactly as the committed grouping core produced it. */
export interface WorkspaceScheduleDay<TSession extends WorkspaceSchedulableSession> {
  readonly dateKey: string;
  readonly dayLabel: string;
  readonly dateLabel: string;
  readonly sessions: readonly TSession[];
}

/** One session, carrying the day it belongs to — the general timeline's row. */
export interface WorkspaceTimelineEntry<TSession extends WorkspaceSchedulableSession> {
  readonly dateKey: string;
  readonly dayLabel: string;
  readonly dateLabel: string;
  readonly session: TSession;
}

/**
 * The GENERAL view: one continuous timeline of every scheduled block, in the
 * committed grouping's own order, each row carrying its own date so the list
 * reads without a header.
 *
 * A flatten and nothing else — no sort, no filter, no slice and no reverse.
 */
export function buildGeneralTimeline<TSession extends WorkspaceSchedulableSession>(
  days: readonly WorkspaceScheduleDay<TSession>[],
): readonly WorkspaceTimelineEntry<TSession>[] {
  const entries: WorkspaceTimelineEntry<TSession>[] = [];
  for (const day of days) {
    for (const session of day.sessions) {
      entries.push({
        dateKey: day.dateKey,
        dayLabel: day.dayLabel,
        dateLabel: day.dateLabel,
        session,
      });
    }
  }
  return Object.freeze(entries);
}

/** One exam type, with every block scheduled against it. */
export interface WorkspaceDefinitionGroup<TSession extends WorkspaceSchedulableSession> {
  readonly definitionId: string;
  readonly definitionName: string;
  readonly entries: readonly WorkspaceTimelineEntry<TSession>[];
}

/**
 * The BY-TYPE view: the same timeline, bucketed by `ExamDefinition`.
 *
 * The GROUP order is first appearance in the timeline, and the order WITHIN a
 * group is the timeline's own — so a manager reading one exam type still reads
 * its dates in the same sequence the other two views show them in. Nothing is
 * sorted, and a session is never dropped: an exam type with one block gets a
 * group with one entry.
 *
 * The bucket key is the definition ID and never its NAME: two exam types may
 * legitimately be given the same name, and merging them would silently invent a
 * schedule neither of them has.
 */
export function groupTimelineByDefinition<TSession extends WorkspaceSchedulableSession>(
  timeline: readonly WorkspaceTimelineEntry<TSession>[],
): readonly WorkspaceDefinitionGroup<TSession>[] {
  const groups: {
    definitionId: string;
    definitionName: string;
    entries: WorkspaceTimelineEntry<TSession>[];
  }[] = [];
  const byId = new Map<string, number>();

  for (const entry of timeline) {
    const existing = byId.get(entry.session.definitionId);
    if (existing === undefined) {
      byId.set(entry.session.definitionId, groups.length);
      groups.push({
        definitionId: entry.session.definitionId,
        definitionName: entry.session.definitionName,
        entries: [entry],
      });
      continue;
    }
    groups[existing].entries.push(entry);
  }

  return Object.freeze(
    groups.map((group) =>
      Object.freeze({
        definitionId: group.definitionId,
        definitionName: group.definitionName,
        entries: Object.freeze([...group.entries]),
      }),
    ),
  );
}

// ===========================================================================
// 6. THE ONE ORDERING RULE OF EVERY WORKSPACE VIEW
// ===========================================================================

/**
 * Plain code-point comparison. Deliberately NOT `localeCompare` and not
 * `Intl.Collator`: a locale-aware order can differ between a developer machine,
 * CI and the server, and a schedule that renders in two different orders is a
 * bug report nobody can reproduce.
 *
 * Both keys it is ever given are ZERO-PADDED — `YYYY-MM-DD` and `HH:MM` — so
 * code-point order IS chronological order for them, and no `Date`, no clock and
 * no arithmetic of any kind is involved in putting a schedule in sequence.
 */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * THE ORDERING RULE, stated ONCE for the whole workspace:
 *
 *      DATE ascending, then START TIME ascending, then the order the rows
 *      already arrived in.
 *
 * Every view is arranged by this one comparator — the general overview, the
 * by-type view, the by-date view, the beginner rows and the blocks inside a
 * selected group — so no two surfaces of one plan can present a day in two
 * different sequences.
 *
 * THE THIRD KEY IS THE ARRIVAL INDEX, and that is what makes this SAFE to layer
 * over the committed grouping. That grouping is still the authority on what a tie
 * means: it hands rows over in `orderIndex` order, and this sort is STABLE by
 * construction — the index is compared last and is unique — so two blocks sharing
 * a date and a clock time keep exactly the manager's own stored sequence. Nothing
 * here re-derives that sequence, and nothing sorts by a DISPLAY NAME: a name is
 * not a time, and ordering a day by it would reshuffle the schedule whenever an
 * exam was renamed.
 */
function compareOrderKeys(
  a: { readonly dateKey: string; readonly startTime: string; readonly index: number },
  b: { readonly dateKey: string; readonly startTime: string; readonly index: number },
): number {
  return cmp(a.dateKey, b.dateKey) || cmp(a.startTime, b.startTime) || a.index - b.index;
}

/**
 * Put a timeline into the one workspace order.
 *
 * Never mutates the input array: a fresh array is sorted and returned frozen, so
 * a frozen input is fine and an unfrozen one comes back untouched.
 */
export function orderWorkspaceTimeline<TSession extends WorkspaceSchedulableSession>(
  timeline: readonly WorkspaceTimelineEntry<TSession>[],
): readonly WorkspaceTimelineEntry<TSession>[] {
  const list = Array.isArray(timeline) ? timeline : [];
  return Object.freeze(
    list
      .map((entry, index) => ({
        entry,
        dateKey: entry.dateKey,
        startTime: entry.session.startTime,
        index,
      }))
      .sort(compareOrderKeys)
      .map((keyed) => keyed.entry),
  );
}

/** One stored day of the workspace, rebuilt from the ORDERED timeline. */
export interface WorkspaceTimelineDay<TSession extends WorkspaceSchedulableSession> {
  readonly dateKey: string;
  readonly dayLabel: string;
  readonly dateLabel: string;
  readonly entries: readonly WorkspaceTimelineEntry<TSession>[];
}

/**
 * The BY-DATE axis, taken from the ORDERED timeline rather than from a second
 * grouping.
 *
 * One source means the by-date view can never disagree with the general one
 * about which blocks exist or about their sequence — a day is exactly the run of
 * timeline entries carrying its key, in the order the timeline already put them.
 * Day order is first appearance, which the ordering rule above has already made
 * ascending by date.
 */
export function groupTimelineByDate<TSession extends WorkspaceSchedulableSession>(
  timeline: readonly WorkspaceTimelineEntry<TSession>[],
): readonly WorkspaceTimelineDay<TSession>[] {
  const days: {
    dateKey: string;
    dayLabel: string;
    dateLabel: string;
    entries: WorkspaceTimelineEntry<TSession>[];
  }[] = [];
  const byKey = new Map<string, number>();

  for (const entry of timeline) {
    const existing = byKey.get(entry.dateKey);
    if (existing === undefined) {
      byKey.set(entry.dateKey, days.length);
      days.push({
        dateKey: entry.dateKey,
        dayLabel: entry.dayLabel,
        dateLabel: entry.dateLabel,
        entries: [entry],
      });
      continue;
    }
    days[existing].entries.push(entry);
  }

  return Object.freeze(
    days.map((day) =>
      Object.freeze({
        dateKey: day.dateKey,
        dayLabel: day.dayLabel,
        dateLabel: day.dateLabel,
        entries: Object.freeze([...day.entries]),
      }),
    ),
  );
}

// ===========================================================================
// 7. THE SUB-TAB SELECTION, AND THE ADD-ASSIGNMENT DISCLOSURE
// ===========================================================================

/**
 * WHICH group of a by-type or by-date view is open, as a POSITION and never as
 * an id.
 *
 * An ORDINAL is deliberate. The obvious alternative — putting the
 * `ExamDefinition.id` in the sub-tab link — would put a database id in an href
 * on a page whose whole containment claim is that no href carries one. A
 * position names the same group without naming anything internal, and it is
 * meaningless outside the list it indexes.
 *
 * CLOSED AND TOTAL in both directions. A non-string (which is what a REPEATED
 * query key produces), an empty string, a non-integer, a negative, a value past
 * the end of the list and every unrecognized token all fall back to the FIRST
 * group — which, under the ordering rule above, is the earliest date or the first
 * available exam type. A hand-typed value can therefore select a group and can
 * never supply one, reach a reader or influence a scope.
 *
 * A count of zero yields `0`, so a caller with nothing to show still has a total
 * function to call rather than a special case to remember.
 */
export function parseWorkspaceGroupIndex(
  raw: string | string[] | undefined,
  count: number,
): number {
  if (!Number.isSafeInteger(count) || count <= 0) return 0;
  if (typeof raw !== "string" || raw.length === 0) return 0;
  // `Number` rather than `parseInt`: `parseInt("2abc")` is 2, which would let a
  // malformed token select a group. `Number("2abc")` is `NaN`, which cannot.
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0 || value >= count) return 0;
  return value;
}

/**
 * The ONE query token that means "the manager asked to add somebody".
 *
 * The add-assignment form is CLOSED BY DEFAULT and is opened only by an explicit
 * click, because a form permanently sitting at the bottom of a long page is one
 * a manager has to scroll past on every visit and can submit by accident.
 *
 * Honoured on the EXACT string `"1"` and on nothing else, on exactly the terms
 * every other closed token on this route uses: a repeated query key arrives as an
 * ARRAY, and the `typeof` test is what stops `["1"]` coercing its way to a match.
 * It is a DISCLOSURE and never a permission — the create forms sit behind the
 * same lifecycle gate they always did, and this token cannot open one that gate
 * has closed.
 */
export function parseAddAssignmentDisclosure(raw: string | string[] | undefined): boolean {
  return typeof raw === "string" && raw === "1";
}

// ===========================================================================
// 8. THE GENERAL OVERVIEW — ONE CHRONOLOGY, STORED BLOCKS AND BEGINNER ALIKE
// ===========================================================================

/**
 * ONE row of the general overview.
 *
 * The general view answers ONE question — what does this day look like — so it
 * carries the STRUCTURE of a block and never its people. There is deliberately no
 * examinee, no instructed trainee, no horse, no topic, no branch, no pairing and
 * no assignment id anywhere in either arm: a manager reading the overview is
 * reading a timetable, and the roster belongs to the by-type and by-date views
 * where it can actually be edited.
 *
 * The two arms are DISCRIMINATED rather than merged into one optional-heavy
 * shape, because a beginner row is a live Teaching-Practice projection and a
 * stored block is not — and a surface that could not tell them apart would sooner
 * or later offer an edit control on the one that has none.
 */
export type WorkspaceOverviewEntry<TSession extends WorkspaceSchedulableSession> =
  | {
      readonly kind: "SESSION";
      readonly dateKey: string;
      readonly dayLabel: string;
      readonly dateLabel: string;
      readonly startTime: string;
      readonly session: TSession;
    }
  | {
      readonly kind: "BEGINNER";
      readonly dateKey: string;
      readonly dayLabel: string;
      readonly dateLabel: string;
      readonly startTime: string;
      readonly beginner: WorkspaceBeginnerRow;
    };

/** The two day headings a date key is rendered under. */
export interface WorkspaceDayLabels {
  readonly dayLabel: string;
  readonly dateLabel: string;
}

/**
 * The day headings of every day the stored schedule occupies, keyed by date.
 *
 * Built from the timeline the committed grouping produced, so the labels are that
 * core's own — this module derives none. A beginner date the stored schedule does
 * not also occupy therefore has no label available, and the overview falls back
 * to the raw date key rather than computing a heading of its own: a second
 * calendar in this file would be a second thing to keep in step with the product's
 * Hebrew dates.
 */
export function collectDayLabels<TSession extends WorkspaceSchedulableSession>(
  timeline: readonly WorkspaceTimelineEntry<TSession>[],
): ReadonlyMap<string, WorkspaceDayLabels> {
  const labels = new Map<string, WorkspaceDayLabels>();
  for (const entry of timeline) {
    if (labels.has(entry.dateKey)) continue;
    labels.set(entry.dateKey, { dayLabel: entry.dayLabel, dateLabel: entry.dateLabel });
  }
  return labels;
}

/**
 * ONE chronological overview of everything that happens, stored blocks and
 * BEGINNER Teaching-Practice exams together.
 *
 * The beginner rows arrive from the SAME already-loaded admin reading the rest of
 * this page is built from — there is NO second query, no second reader and no
 * duplicated data. Their times are that reading's own, exactly like every other
 * clock on this page, and nothing here derives, adjusts or reformats one.
 *
 * Both kinds are ordered by the ONE workspace rule: date, then start time, then
 * arrival. A beginner lesson at 09:00 therefore reads before a stored block at
 * 10:00 on the same day, which is the entire point of merging them — a manager
 * running the day needs one list, not two they have to interleave in their head.
 *
 * Rows carrying an unusable date or start time are DROPPED rather than placed
 * arbitrarily: a row with no position in a chronology cannot be shown in one
 * honestly, and the by-date and by-type views still list what the plan holds.
 */
export function buildScheduleOverview<TSession extends WorkspaceSchedulableSession>(
  timeline: readonly WorkspaceTimelineEntry<TSession>[],
  beginnerRows: readonly WorkspaceBeginnerRow[],
  labels: ReadonlyMap<string, WorkspaceDayLabels>,
): readonly WorkspaceOverviewEntry<TSession>[] {
  const keyed: {
    entry: WorkspaceOverviewEntry<TSession>;
    dateKey: string;
    startTime: string;
    index: number;
  }[] = [];

  const sessions = Array.isArray(timeline) ? timeline : [];
  for (const entry of sessions) {
    keyed.push({
      entry: {
        kind: "SESSION",
        dateKey: entry.dateKey,
        dayLabel: entry.dayLabel,
        dateLabel: entry.dateLabel,
        startTime: entry.session.startTime,
        session: entry.session,
      },
      dateKey: entry.dateKey,
      startTime: entry.session.startTime,
      index: keyed.length,
    });
  }

  const beginners = Array.isArray(beginnerRows) ? beginnerRows : [];
  for (const row of beginners) {
    if (typeof row.date !== "string" || row.date.length === 0) continue;
    if (typeof row.startTime !== "string" || row.startTime.length === 0) continue;
    const dayLabels = labels.get(row.date);
    keyed.push({
      entry: {
        kind: "BEGINNER",
        dateKey: row.date,
        dayLabel: dayLabels === undefined ? "" : dayLabels.dayLabel,
        dateLabel: dayLabels === undefined ? row.date : dayLabels.dateLabel,
        startTime: row.startTime,
        beginner: row,
      },
      dateKey: row.date,
      startTime: row.startTime,
      index: keyed.length,
    });
  }

  return Object.freeze(
    keyed.sort(compareOrderKeys).map((entry) => Object.freeze(entry.entry)),
  );
}

/**
 * The beginner rows of ONE stored day, in the workspace order.
 *
 * Used by the by-date view, which shows the FULL read-only detail of a beginner
 * lesson beside the stored blocks of the same day. It is a FILTER of the rows
 * already loaded and never a second read.
 */
export function beginnerRowsOnDate(
  beginnerRows: readonly WorkspaceBeginnerRow[],
  dateKey: string,
): readonly WorkspaceBeginnerRow[] {
  const list = Array.isArray(beginnerRows) ? beginnerRows : [];
  const matching = list
    .filter((row) => row.date === dateKey)
    .map((row, index) => ({ row, dateKey: row.date, startTime: row.startTime, index }))
    .sort(compareOrderKeys)
    .map((keyed) => keyed.row);
  return matching.length === 0 ? NO_BEGINNER_ROWS : Object.freeze(matching);
}

/** Every beginner row, in the ONE workspace order. Never a second read. */
export function orderBeginnerRows(
  beginnerRows: readonly WorkspaceBeginnerRow[],
): readonly WorkspaceBeginnerRow[] {
  const list = Array.isArray(beginnerRows) ? beginnerRows : [];
  if (list.length === 0) return NO_BEGINNER_ROWS;
  return Object.freeze(
    list
      .map((row, index) => ({ row, dateKey: row.date, startTime: row.startTime, index }))
      .sort(compareOrderKeys)
      .map((keyed) => keyed.row),
  );
}
