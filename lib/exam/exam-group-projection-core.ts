/**
 * EXAM EX-S4C — PURE definition-grouping core for the "לפי מבחן" view.
 *
 * PURE by construction: no Prisma, no DB, no Next, no clock (`Date.now`/`new
 * Date`), no randomness, no env, no auth/session/cookie, no filesystem, no
 * network. Deterministic; never mutates its inputs.
 *
 * WHAT THIS ANSWERS (and only this): given ONE flat set of authoritative
 * `ProjectionSession` rows, which EXAM does each row belong to, and in what
 * order are those exams and their rows shown?
 *
 * ===========================================================================
 * WHY THIS EXISTS BESIDE `projectByExamKind`
 * ===========================================================================
 * `ExamKind` is an internal BEHAVIOUR category — it decides what a session may
 * carry (a format, children, a topic, an instructed trainee) and it is the
 * primary ordering category. It is NOT the identity of an exam.
 *
 * The stored identity of an exam is `ExamDefinition`. Two separate definitions
 * named "רכיבה" and "ממשק" both legitimately use `INTERFACE_RIDING`, and they
 * are two different exams on the manager's plan. Grouping by kind would merge
 * them into one row and tell trainees the wrong thing, so this core groups by
 * `ExamDefinition.id` and labels only by `ExamDefinition.name`.
 *
 * `projectByExamKind` is deliberately UNTOUCHED and is NOT wrapped, extended or
 * re-exported here. It remains the legacy/internal kind projection; this is a
 * separate, definition-aware grouping that happens to share the same input rows.
 *
 * ===========================================================================
 * THE TWO GROUP SHAPES
 * ===========================================================================
 *  1. DEFINITION — a stored `ExamSession` block. `ExamSession.definitionId` is
 *     REQUIRED in the schema, so a persisted definition-less block is
 *     structurally impossible; there is therefore NO active "unassigned" group,
 *     and one is never invented for a malformed row (see FAIL CLOSED below).
 *  2. BEGINNER   — the LIVE Teaching-Practice beginner rows. They have no
 *     definition at all, so they form EXACTLY ONE synthetic group under the
 *     locked label `EXAM_BEGINNER_GROUP_LABEL`. They are never split by
 *     `beginnerFormat`: the format is a per-lesson attribute, not an exam.
 *
 * ===========================================================================
 * FAIL CLOSED
 * ===========================================================================
 * A row whose identity cannot be established is EXCLUDED and reported as an
 * issue. It is never rescued by falling back to:
 *   - `ExamSession.title` (an optional occurrence subtitle, not an exam name),
 *   - `EXAM_KIND_LABELS` (a category label, not an exam name),
 *   - a synthesized "unassigned"/"other" bucket.
 * Rendering a session under a guessed exam name is worse than not rendering it:
 * trainees act on that label.
 *
 * The same applies to a CONTRADICTION — one `definitionId` appearing with two
 * names or two kinds. There is no defensible way to pick a winner, so the whole
 * group is dropped rather than silently taking the first value. In production
 * this is unreachable (name and kind come from a join on the single
 * `ExamDefinition` row), but a pure core must stay total over malformed input.
 *
 * ORDERING (locked):
 *  - groups   : canonical `EXAM_KINDS` order, then `definitionName`, then
 *               `definitionId` as the final deterministic tiebreak. The beginner
 *               group falls last naturally, because `BEGINNER_INSTRUCTION` is
 *               last in `EXAM_KINDS` — it is not special-cased.
 *  - sessions : `date`, `startTime`, `orderIndex`, `sessionId` — the SAME locked
 *               across-date order the projection core uses. Its comparator is
 *               module-private there, so it is restated here rather than by
 *               modifying that file; the parity is asserted by test.
 *
 * All comparisons are plain code-point string comparisons. Nothing here is
 * locale-sensitive (no `localeCompare`, no `Intl`), so the order cannot vary
 * between a developer machine, CI and the server. Dates and times are compared
 * as opaque `YYYY-MM-DD` / `HH:MM` tokens: no calendar or timezone arithmetic.
 *
 * WHAT IS DELIBERATELY ABSENT. No slots, waves, timetable diagnostics,
 * assignment or child details, contacts, `isSelf`, or UI state. A group holds
 * the SAME authoritative `ProjectionSession` objects it was given — there is no
 * copied, enriched or synchronized session model anywhere in this file.
 */
import type { ExamKind } from "./exam-domain-core";
import { EXAM_KINDS, isStorableExamKind } from "./exam-domain-core";
import type { ProjectionSession } from "./exam-schedule-projection-core";

// ===========================================================================
// Group key
// ===========================================================================

/**
 * The TRUSTED internal identity of one group — a discriminated union, never a
 * bare string, so "a definition id" and "the beginner bucket" cannot be
 * confused, and no caller can hand-craft a group key out of free text.
 */
export type ExamGroupKey =
  | {
      readonly type: "DEFINITION";
      readonly definitionId: string;
    }
  | {
      readonly type: "BEGINNER";
    };

/**
 * A stable serialization for React keys and route tokens:
 *   - `DEFINITION` → `def:<definitionId>`
 *   - `BEGINNER`   → `beginner`
 *
 * NOT AUTHORITY. The returned string is an opaque display/routing token; it is
 * never trusted input and must never be parsed back into a trusted key. A reader
 * that receives one from a URL must re-resolve the definition id against the
 * database (and against the caller's authorization) before using it.
 *
 * Fails closed to `null` on a blank/absent definition id rather than emitting a
 * bare `def:`, which would collide across every malformed key.
 */
export function serializeExamGroupKey(key: ExamGroupKey): string | null {
  if (key === null || typeof key !== "object") return null;
  if (key.type === "BEGINNER") return "beginner";
  if (key.type !== "DEFINITION") return null;
  const id = isPresent(key.definitionId) ? key.definitionId.trim() : null;
  return id === null ? null : `def:${id}`;
}

// ===========================================================================
// Issues
// ===========================================================================

/**
 * Stable, non-PII grouping issue codes. The code STRINGS are the contract and
 * must not be renamed once consumed downstream.
 */
export type ExamGroupIssueCode =
  | "EX-GRP-DEFINITION-ID-REQUIRED"
  | "EX-GRP-DEFINITION-NAME-REQUIRED"
  | "EX-GRP-DEFINITION-KIND-INVALID"
  | "EX-GRP-BEGINNER-DEFINITION-FORBIDDEN"
  | "EX-GRP-DEFINITION-NAME-CONFLICT"
  | "EX-GRP-DEFINITION-KIND-CONFLICT";

/**
 * The authoritative code → Hebrew message table. The exhaustive
 * `Record<ExamGroupIssueCode, string>` annotation forces every code — present or
 * future — to carry a message or this file will not compile.
 */
export const EXAM_GROUP_MESSAGES: Readonly<Record<ExamGroupIssueCode, string>> =
  Object.freeze({
    "EX-GRP-DEFINITION-ID-REQUIRED":
      "למפגש בחינה שמור חובה מזהה הגדרת בחינה — לא ניתן לשייך אותו למבחן",
    "EX-GRP-DEFINITION-NAME-REQUIRED":
      "למפגש בחינה שמור חובה שם הגדרת בחינה — אין להציגו תחת שם משוער",
    "EX-GRP-DEFINITION-KIND-INVALID":
      "סוג הבחינה של המפגש אינו סוג שניתן לשמור כמפגש בחינה",
    "EX-GRP-BEGINNER-DEFINITION-FORBIDDEN":
      "התנסות מתחילים נקראת ישירות מהתרגול המעשי ואינה יכולה לשאת הגדרת בחינה",
    "EX-GRP-DEFINITION-NAME-CONFLICT":
      "אותה הגדרת בחינה הופיעה עם יותר משם אחד — לא ניתן לקבוע את שם המבחן",
    "EX-GRP-DEFINITION-KIND-CONFLICT":
      "אותה הגדרת בחינה הופיעה עם יותר מסוג בחינה אחד — לא ניתן לקבוע את סוג המבחן",
  });

/**
 * One excluded row. Carries the `sessionId` so the row is observable, and the
 * `definitionId` when one was legible. Deliberately NO trainee name, child name,
 * title or any other free text — an issue list is diagnostic, not a PII channel.
 */
export interface ExamGroupIssue {
  readonly code: ExamGroupIssueCode;
  readonly message: string;
  readonly sessionId: string;
  readonly definitionId: string | null;
}

// ===========================================================================
// Output
// ===========================================================================

/** The locked visible label of the single synthetic live-beginner group. */
export const EXAM_BEGINNER_GROUP_LABEL = "התנסויות מתחילים";

/** Sessions of one group on one date — a presentation grouping only. */
export interface ExamScheduleGroupDate {
  /** Opaque calendar day, `YYYY-MM-DD`. */
  readonly date: string;
  readonly sessions: readonly ProjectionSession[];
}

/** One exam: a stored `ExamDefinition`, or the single live-beginner group. */
export interface ExamScheduleGroup {
  readonly key: ExamGroupKey;
  /** `serializeExamGroupKey(key)` — for React keys / route tokens only. */
  readonly serializedKey: string;
  /**
   * The visible group name: `ExamDefinition.name` verbatim for a stored group,
   * `EXAM_BEGINNER_GROUP_LABEL` for the beginner group. Never a title, never a
   * kind label.
   */
  readonly label: string;
  /** The behaviour category — for ordering and rendering, NOT identity. */
  readonly kind: ExamKind;
  /** `null` ONLY for the beginner group. */
  readonly definitionId: string | null;
  /** Every session of this exam in the locked order (flat). */
  readonly sessions: readonly ProjectionSession[];
  /** The SAME session objects, re-bucketed by date purely for rendering. */
  readonly dateGroups: readonly ExamScheduleGroupDate[];
}

/** Groups that could be established, plus every row that could not be. */
export interface ExamDefinitionProjection {
  readonly groups: readonly ExamScheduleGroup[];
  readonly issues: readonly ExamGroupIssue[];
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

function isPresent(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/** The trimmed value, or `null` when absent/blank. Whitespace is never identity. */
function normalized(v: unknown): string | null {
  return isPresent(v) ? v.trim() : null;
}

function makeIssue(
  code: ExamGroupIssueCode,
  sessionId: string,
  definitionId: string | null,
): ExamGroupIssue {
  return Object.freeze({
    code,
    message: EXAM_GROUP_MESSAGES[code],
    sessionId: typeof sessionId === "string" ? sessionId : "",
    definitionId,
  });
}

/**
 * The locked across-date session order: `date`, `startTime`, `orderIndex`,
 * `sessionId`. This restates the projection core's module-private comparator —
 * that file is not modified by this slice — and a test asserts the two stay in
 * step. `orderIndex` is load-bearing: exam days routinely hold several sessions
 * sharing one start time, and `sessionId` is the final deterministic tiebreak.
 */
function compareSessions(a: ProjectionSession, b: ProjectionSession): number {
  return (
    cmp(a.date, b.date) ||
    cmp(a.startTime, b.startTime) ||
    cmpNum(a.orderIndex, b.orderIndex) ||
    cmp(a.sessionId, b.sessionId)
  );
}

/** Canonical kind rank. An out-of-domain kind sorts last, deterministically. */
function kindRank(kind: ExamKind): number {
  const index = EXAM_KINDS.indexOf(kind);
  return index === -1 ? EXAM_KINDS.length : index;
}

/** Group order: canonical kind, then label, then definition id. */
function compareGroups(a: ExamScheduleGroup, b: ExamScheduleGroup): number {
  return (
    cmpNum(kindRank(a.kind), kindRank(b.kind)) ||
    cmp(a.label, b.label) ||
    cmp(a.definitionId ?? "", b.definitionId ?? "")
  );
}

/** Issue order: `sessionId`, then code. Independent of input order. */
function compareIssues(a: ExamGroupIssue, b: ExamGroupIssue): number {
  return cmp(a.sessionId, b.sessionId) || cmp(a.code, b.code);
}

/**
 * Re-bucket already-ordered sessions by date. Because the input is sorted by
 * `date` first, equal dates are contiguous, so a single pass is enough and the
 * date groups come out ascending. The SAME session objects are carried through —
 * nothing is copied, spread or re-shaped.
 */
function toDateGroups(
  ordered: readonly ProjectionSession[],
): readonly ExamScheduleGroupDate[] {
  const groups: { date: string; sessions: ProjectionSession[] }[] = [];
  for (const session of ordered) {
    const last = groups[groups.length - 1];
    if (last !== undefined && last.date === session.date) last.sessions.push(session);
    else groups.push({ date: session.date, sessions: [session] });
  }
  return Object.freeze(
    groups.map((g) => Object.freeze({ date: g.date, sessions: Object.freeze(g.sessions) })),
  );
}

// ===========================================================================
// Grouping
// ===========================================================================

/**
 * One definition bucket, accumulated before its identity is confirmed.
 *
 * `name`/`kind` are captured from the FIRST row only so the bucket always has a
 * concrete identity to build from; they are used ONLY after the sets below have
 * proven there was exactly one candidate, so "first" is never a silent choice
 * between competing values.
 */
interface DefinitionBucket {
  readonly name: string;
  readonly kind: ExamKind;
  readonly sessions: ProjectionSession[];
  /** Every DISTINCT name seen for this id — more than one is a contradiction. */
  readonly names: Set<string>;
  /** Every DISTINCT kind seen for this id — more than one is a contradiction. */
  readonly kinds: Set<ExamKind>;
}

/**
 * Group authoritative rows by EXAM.
 *
 * Stored rows group by `definitionId` and are labelled by `definitionName`. Two
 * different definition ids stay two groups even when they share a kind AND a
 * name — the id is the identity, and the schema's per-plan name uniqueness is a
 * database guarantee this pure core must not assume about arbitrary input.
 *
 * Live beginner rows form exactly one group and keep their own relative order.
 *
 * Rows that cannot be identified are EXCLUDED, never guessed at; see the FAIL
 * CLOSED note at the top of this file. This function is TOTAL: it throws for no
 * input and always returns both a group list and an issue list.
 */
export function projectByExamDefinition(
  sessions: readonly ProjectionSession[],
): ExamDefinitionProjection {
  const issues: ExamGroupIssue[] = [];
  const beginnerSessions: ProjectionSession[] = [];
  const buckets = new Map<string, DefinitionBucket>();

  const input = Array.isArray(sessions) ? sessions : [];

  for (const session of input) {
    if (session === null || typeof session !== "object") continue;

    const definitionId = normalized(session.definitionId);
    const definitionName = normalized(session.definitionName);

    // --- live beginner rows ------------------------------------------------
    if (session.kind === "BEGINNER_INSTRUCTION") {
      // A beginner row carrying definition identity is CONTRADICTORY input: the
      // beginner view is a live Teaching-Practice projection and no definition
      // owns it. Accepting it would let a stored-looking exam name attach to a
      // row nothing in the plan actually stores.
      if (definitionId !== null || definitionName !== null) {
        issues.push(
          makeIssue("EX-GRP-BEGINNER-DEFINITION-FORBIDDEN", session.sessionId, definitionId),
        );
        continue;
      }
      beginnerSessions.push(session);
      continue;
    }

    // --- stored, definition-backed rows ------------------------------------
    // `isStorableExamKind` fails closed on garbage AND on BEGINNER_INSTRUCTION,
    // which the branch above has already consumed.
    if (!isStorableExamKind(session.kind)) {
      issues.push(makeIssue("EX-GRP-DEFINITION-KIND-INVALID", session.sessionId, definitionId));
      continue;
    }
    if (definitionId === null) {
      issues.push(makeIssue("EX-GRP-DEFINITION-ID-REQUIRED", session.sessionId, null));
      continue;
    }
    if (definitionName === null) {
      issues.push(
        makeIssue("EX-GRP-DEFINITION-NAME-REQUIRED", session.sessionId, definitionId),
      );
      continue;
    }

    const bucket = buckets.get(definitionId);
    if (bucket === undefined) {
      buckets.set(definitionId, {
        name: definitionName,
        kind: session.kind,
        sessions: [session],
        names: new Set([definitionName]),
        kinds: new Set([session.kind]),
      });
    } else {
      bucket.sessions.push(session);
      bucket.names.add(definitionName);
      bucket.kinds.add(session.kind);
    }
  }

  const groups: ExamScheduleGroup[] = [];

  for (const [definitionId, bucket] of buckets) {
    const nameConflict = bucket.names.size > 1;
    const kindConflict = bucket.kinds.size > 1;

    if (nameConflict || kindConflict) {
      // FAIL CLOSED for the WHOLE group. With two competing identities for one
      // id there is no non-arbitrary winner, and every row in the bucket is
      // equally implicated — so each is reported rather than silently rendered
      // under whichever value happened to arrive first.
      for (const session of bucket.sessions) {
        if (nameConflict) {
          issues.push(
            makeIssue("EX-GRP-DEFINITION-NAME-CONFLICT", session.sessionId, definitionId),
          );
        }
        if (kindConflict) {
          issues.push(
            makeIssue("EX-GRP-DEFINITION-KIND-CONFLICT", session.sessionId, definitionId),
          );
        }
      }
      continue;
    }

    const key: ExamGroupKey = Object.freeze({ type: "DEFINITION" as const, definitionId });
    const serializedKey = serializeExamGroupKey(key);
    // Unreachable: `definitionId` is a non-blank map key. Kept so the group is
    // built without a non-null assertion.
    if (serializedKey === null) continue;

    const ordered = [...bucket.sessions].sort(compareSessions);
    groups.push(
      Object.freeze({
        key,
        serializedKey,
        // Safe by the conflict check above: exactly one name and one kind exist.
        label: bucket.name,
        kind: bucket.kind,
        definitionId,
        sessions: Object.freeze(ordered),
        dateGroups: toDateGroups(ordered),
      }),
    );
  }

  if (beginnerSessions.length > 0) {
    const key: ExamGroupKey = Object.freeze({ type: "BEGINNER" as const });
    const ordered = [...beginnerSessions].sort(compareSessions);
    groups.push(
      Object.freeze({
        key,
        serializedKey: "beginner",
        label: EXAM_BEGINNER_GROUP_LABEL,
        // The beginner group is ranked by the ordinary kind rule, which puts it
        // last because BEGINNER_INSTRUCTION is last in EXAM_KINDS. Nothing
        // special-cases its position.
        kind: "BEGINNER_INSTRUCTION",
        definitionId: null,
        sessions: Object.freeze(ordered),
        dateGroups: toDateGroups(ordered),
      }),
    );
  }

  groups.sort(compareGroups);
  issues.sort(compareIssues);

  return Object.freeze({
    groups: Object.freeze(groups),
    issues: Object.freeze(issues),
  });
}
