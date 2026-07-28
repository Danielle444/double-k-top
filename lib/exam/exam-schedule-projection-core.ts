/**
 * EXAM EX-C1 — PURE three-view projection core.
 *
 * PURE by construction: no Prisma, no DB, no Next, no clock (`Date.now`/`new
 * Date`), no randomness, no env, no auth/session/cookie, no filesystem, no
 * network. Deterministic; never mutates its inputs. The only runtime dependency
 * is the sibling PURE overlap core (`parseHHMM`) — this module deliberately
 * introduces NO new time arithmetic.
 *
 * WHAT THIS ANSWERS (and only this): given ONE flat set of authoritative
 * `ExamSession` rows, what do the three connected admin views show?
 *
 *   1. לו״ז כללי  — `projectGeneralSchedule`  : compact summary per `ExamKind`
 *   2. לפי תאריך  — `projectByDate`           : one date, every kind, in order
 *   3. לפי מבחן   — `projectByExamKind`       : one kind, every date, in order
 *
 * ONE SOURCE OF TRUTH. All three are READ-ONLY PROJECTIONS over the same input
 * rows. There is deliberately NO per-view model, cached row, aggregate column,
 * materialized view, or synchronisation of any kind — every aggregate below is
 * computed at read time, precisely so editing one `ExamSession` is immediately
 * reflected in all three views without anything to keep in step. Adding a
 * persisted aggregate would create a second source of truth; do not.
 *
 * ORDERING (locked):
 *  - by date : `startTime`, then `orderIndex`, then `sessionId`;
 *  - by kind : `date`, then `startTime`, then `orderIndex`, then `sessionId`.
 * `orderIndex` is load-bearing rather than cosmetic: real exam days routinely
 * hold several sessions sharing one start time, and `sessionId` is the final
 * deterministic tiebreak.
 *
 * `startTime`/`endTime` are zero-padded `HH:MM`, so lexicographic comparison is
 * chronological and `min`/`max` over them are safe.
 *
 * BOTH total-hours readings are exposed — the sum of session durations AND the
 * operational span (first start → last end, summed per date). Which one the
 * general view renders is a deferred EX-C2 DISPLAY decision, not a data one, so
 * this core computes both and decides nothing.
 *
 * It does NOT read or write anything, does NOT paginate, and knows nothing
 * about publication, authorization, or PII gating.
 */
import type { ExamBeginnerFormat, ExamKind } from "./exam-domain-core";
import { EXAM_KINDS } from "./exam-domain-core";
import { parseHHMM } from "./exam-overlap-core";

// ===========================================================================
// Input
// ===========================================================================

/** One authoritative `ExamSession` row as seen by the projections. */
export interface ProjectionSession {
  readonly sessionId: string;
  readonly kind: ExamKind;
  readonly beginnerFormat: ExamBeginnerFormat | null;
  /** Opaque calendar day, `YYYY-MM-DD`. */
  readonly date: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly orderIndex: number;
  /** Student ids assigned as EXAMINEE. */
  readonly examineeStudentIds: readonly string[];
  /** Student ids assigned as INSTRUCTED_TRAINEE. */
  readonly instructedTraineeStudentIds: readonly string[];
  /** Embedded `ExamBeginnerChild` snapshot count. */
  readonly beginnerChildCount: number;
}

// ===========================================================================
// Output
// ===========================================================================

/** Beginner sub-grouping, available for the EX-C2 display decision. */
export interface GeneralScheduleFormatBreakdown {
  readonly beginnerFormat: ExamBeginnerFormat;
  readonly sessionCount: number;
}

/** One compact general-schedule row: one `ExamKind`. */
export interface GeneralScheduleRow {
  readonly kind: ExamKind;
  readonly sessionCount: number;
  /** Distinct dates this kind occupies, ascending. */
  readonly dates: readonly string[];
  readonly firstStartTime: string | null;
  readonly lastEndTime: string | null;
  /** Sum of every session's own duration. */
  readonly totalDurationMinutes: number;
  /** Sum, per date, of (last end − first start). */
  readonly operationalSpanMinutes: number;
  readonly distinctExamineeCount: number;
  readonly distinctInstructedTraineeCount: number;
  readonly beginnerChildCount: number;
  /** Non-empty only where sessions carry a beginner format. */
  readonly formatBreakdown: readonly GeneralScheduleFormatBreakdown[];
}

/** Sessions of one kind, grouped by date for presentation only. */
export interface ExamKindDateGroup {
  readonly date: string;
  readonly sessions: readonly ProjectionSession[];
}

export interface ByExamKindProjection {
  readonly kind: ExamKind;
  /** Every session of this kind in the locked order (flat). */
  readonly sessions: readonly ProjectionSession[];
  /** The SAME sessions, grouped by date purely for rendering. */
  readonly groups: readonly ExamKindDateGroup[];
}

// ===========================================================================
// Helpers
// ===========================================================================

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function cmpNum(a: number, b: number): number {
  return a - b;
}

/** Duration in minutes, or 0 when either endpoint is malformed (fail closed). */
function durationMinutes(session: ProjectionSession): number {
  const start = parseHHMM(session.startTime);
  const end = parseHHMM(session.endTime);
  if (start === null || end === null || end <= start) return 0;
  return end - start;
}

/** The locked "by date" comparator: startTime, orderIndex, sessionId. */
function compareWithinDate(a: ProjectionSession, b: ProjectionSession): number {
  return (
    cmp(a.startTime, b.startTime) ||
    cmpNum(a.orderIndex, b.orderIndex) ||
    cmp(a.sessionId, b.sessionId)
  );
}

/** The locked "by kind" comparator: date, then the within-date order. */
function compareAcrossDates(a: ProjectionSession, b: ProjectionSession): number {
  return cmp(a.date, b.date) || compareWithinDate(a, b);
}

function isPresent(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

// ===========================================================================
// 1. General schedule — compact summary per ExamKind
// ===========================================================================

/**
 * Project the compact general schedule: ONE row per `ExamKind` that actually
 * has sessions, in the canonical frozen `EXAM_KINDS` order. A kind with no
 * sessions yields no row (the view shows what exists, not an empty grid).
 *
 * Trainee counts are DISTINCT across the kind's sessions — never a sum of
 * per-session counts, which would double-count a trainee appearing in several
 * sessions.
 */
export function projectGeneralSchedule(
  sessions: readonly ProjectionSession[],
): readonly GeneralScheduleRow[] {
  const byKind = new Map<ExamKind, ProjectionSession[]>();
  for (const session of sessions) {
    const bucket = byKind.get(session.kind);
    if (bucket === undefined) byKind.set(session.kind, [session]);
    else bucket.push(session);
  }

  const rows: GeneralScheduleRow[] = [];
  for (const kind of EXAM_KINDS) {
    const group = byKind.get(kind);
    if (group === undefined || group.length === 0) continue;

    const dates = [...new Set(group.map((s) => s.date))].sort(cmp);
    const examinees = new Set<string>();
    const instructed = new Set<string>();
    let totalDuration = 0;
    let childCount = 0;
    let firstStart: string | null = null;
    let lastEnd: string | null = null;

    for (const s of group) {
      for (const id of s.examineeStudentIds) if (isPresent(id)) examinees.add(id);
      for (const id of s.instructedTraineeStudentIds) if (isPresent(id)) instructed.add(id);
      totalDuration += durationMinutes(s);
      childCount += typeof s.beginnerChildCount === "number" ? s.beginnerChildCount : 0;
      if (firstStart === null || s.startTime < firstStart) firstStart = s.startTime;
      if (lastEnd === null || s.endTime > lastEnd) lastEnd = s.endTime;
    }

    // The operational span is computed PER DATE and summed: a kind spanning two
    // separate days is two separate working windows, not one long one.
    let spanMinutes = 0;
    for (const date of dates) {
      const onDate = group.filter((s) => s.date === date);
      let minStart: number | null = null;
      let maxEnd: number | null = null;
      for (const s of onDate) {
        const start = parseHHMM(s.startTime);
        const end = parseHHMM(s.endTime);
        if (start !== null && (minStart === null || start < minStart)) minStart = start;
        if (end !== null && (maxEnd === null || end > maxEnd)) maxEnd = end;
      }
      if (minStart !== null && maxEnd !== null && maxEnd > minStart) {
        spanMinutes += maxEnd - minStart;
      }
    }

    // Beginner sub-grouping, for the deferred EX-C2 display choice.
    const formatCounts = new Map<ExamBeginnerFormat, number>();
    for (const s of group) {
      if (s.beginnerFormat === null || s.beginnerFormat === undefined) continue;
      formatCounts.set(s.beginnerFormat, (formatCounts.get(s.beginnerFormat) ?? 0) + 1);
    }
    const formatBreakdown = [...formatCounts.entries()]
      .map(([beginnerFormat, sessionCount]) => ({ beginnerFormat, sessionCount }))
      .sort((a, b) => cmp(a.beginnerFormat, b.beginnerFormat));

    rows.push(
      Object.freeze({
        kind,
        sessionCount: group.length,
        dates: Object.freeze(dates),
        firstStartTime: firstStart,
        lastEndTime: lastEnd,
        totalDurationMinutes: totalDuration,
        operationalSpanMinutes: spanMinutes,
        distinctExamineeCount: examinees.size,
        distinctInstructedTraineeCount: instructed.size,
        beginnerChildCount: childCount,
        formatBreakdown: Object.freeze(formatBreakdown),
      }),
    );
  }

  return Object.freeze(rows);
}

// ===========================================================================
// 2. By date — one date, every kind
// ===========================================================================

/**
 * Every session on ONE exact date, across every kind, in the locked order
 * (`startTime`, `orderIndex`, `sessionId`). Date matching is exact string
 * equality on the opaque `YYYY-MM-DD` token — no calendar arithmetic, no
 * timezone math, no range or fuzzy matching.
 */
export function projectByDate(
  sessions: readonly ProjectionSession[],
  date: string,
): readonly ProjectionSession[] {
  const onDate = sessions.filter((s) => s.date === date);
  onDate.sort(compareWithinDate);
  return Object.freeze(onDate);
}

/** The distinct dates present, ascending — for the date picker. */
export function listExamDates(
  sessions: readonly ProjectionSession[],
): readonly string[] {
  return Object.freeze([...new Set(sessions.map((s) => s.date))].sort(cmp));
}

// ===========================================================================
// 3. By exam type — one kind, every date
// ===========================================================================

/**
 * Every session of ONE `ExamKind` across ALL dates, ordered by `date`, then
 * `startTime`, `orderIndex`, `sessionId`. `groups` re-buckets exactly those
 * same session objects by date for rendering — it is a presentation grouping,
 * never a second query or a different row set.
 */
export function projectByExamKind(
  sessions: readonly ProjectionSession[],
  kind: ExamKind,
): ByExamKindProjection {
  const ofKind = sessions.filter((s) => s.kind === kind);
  ofKind.sort(compareAcrossDates);

  const groups: ExamKindDateGroup[] = [];
  for (const session of ofKind) {
    const last = groups[groups.length - 1];
    if (last !== undefined && last.date === session.date) {
      (last.sessions as ProjectionSession[]).push(session);
    } else {
      groups.push({ date: session.date, sessions: [session] });
    }
  }

  return Object.freeze({
    kind,
    sessions: Object.freeze(ofKind),
    groups: Object.freeze(
      groups.map((g) => Object.freeze({ date: g.date, sessions: Object.freeze(g.sessions) })),
    ),
  });
}

// ===========================================================================
// One-source-of-truth helper
// ===========================================================================

/**
 * The set of session ids a projection references. Used to PROVE that all three
 * views project the same authoritative rows: the union of every by-date
 * projection, the union of every by-kind projection, and the ids summarised by
 * the general schedule must all equal the input set.
 */
export function collectSessionIds(
  sessions: readonly ProjectionSession[],
): readonly string[] {
  return Object.freeze([...new Set(sessions.map((s) => s.sessionId))].sort(cmp));
}
