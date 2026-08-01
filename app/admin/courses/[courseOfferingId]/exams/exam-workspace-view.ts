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
 * ONE read-only beginner row, as the admin workspace will render it.
 *
 * THE SHAPE IS THE INTEGRATION POINT, and it is declared now so the follow-up
 * slice changes ONE binding rather than the page's structure. Every field is a
 * NARROWING of what the committed operational DTO already publishes on a row
 * whose `source` is `"BEGINNER"` — that row's own `beginner` detail — so wiring
 * it is a mapping, and never a second query, a second reader or a second
 * derivation.
 *
 * WHAT IS DELIBERATELY ABSENT, and may never be added here:
 *
 *   - the beginner CHILD list. It carries contact detail, and no admin exam
 *     surface has a product reason to render a child's contact;
 *   - the named participants. The COUNT answers "how big is this lesson"; the
 *     names would put other people's identities on a schedule screen that does
 *     not need them;
 *   - the lesson's notes, its id and its raw practice token. Those are Teaching
 *     Practice internals, and a workspace showing them would invite someone to
 *     try to edit the lesson here.
 *
 * The times are the DTO's own derived values, exactly like every other clock on
 * this page: nothing about a beginner row is computed by this route either.
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
  readonly participantCount: number;
}

/**
 * The beginner rows this branch renders: NONE, and not by accident.
 *
 * The committed beginner COURSE-SCOPING rule — beginner Teaching-Practice exams
 * exist only for Level 1, so a Level-2 plan reads none whatever source dates it
 * selected — is NOT present in this branch's base. Reading beginner rows here
 * would therefore project them for every level, and a source date shared by two
 * plans would put one course's trainees, children and parent contacts under
 * another course's exam plan. That is a containment hole rather than a missing
 * feature, so this branch reads nothing and says so on screen.
 *
 * The follow-up rebases onto the scoped pipeline and replaces THIS ONE binding.
 */
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
