/**
 * EXAM X0 — PURE conflict-detection core over a set of exam sessions.
 *
 * PURE by construction: no Prisma, no DB, no clock, no randomness, no env, no
 * IO. Deterministic; never mutates its inputs. The only runtime dependency is
 * the sibling PURE overlap core (`intervalsOverlap`); identity types are erased
 * `import type`s from the domain core.
 *
 * WHAT THIS ANSWERS (and only this): given a set of scheduled sessions (each
 * with its interval, participants, supervisors, examiner set, horses, arena, and
 * capacity) plus the ExamPlan's external-candidate registry, which HARD-BLOCK
 * conflicts and which WARNINGS exist?
 *
 * THE AUTHORITATIVE CONFLICT MATRIX (stable numbered codes + Hebrew messages):
 *
 *   HARD BLOCK:
 *    - EX-BLK-01  Same examinee assigned to two overlapping sessions. One
 *                 UNIFIED rule covering both internal trainees and external
 *                 candidates (there is intentionally NO separate external-only
 *                 double-booking code).
 *    - EX-BLK-02  The same internal trainee is an examinee in one session and an
 *                 instructed trainee in another overlapping session.
 *    - EX-BLK-03  The examinee and the instructed trainee are the same person
 *                 within one session.
 *    - EX-BLK-04  Two external-candidate records in the same ExamPlan share the
 *                 same non-empty nationalId / identity key.
 *
 *   WARNING (soft signals — never block):
 *    - EX-WRN-01  Horse overlap between two overlapping sessions.
 *    - EX-WRN-02  Supervising-instructor overlap between two overlapping sessions.
 *    - EX-WRN-03  Same examiner set assigned to two overlapping sessions
 *                 (a WARNING even when the arenas differ — never a block).
 *    - EX-WRN-04  Arena / location overlap between two overlapping sessions.
 *    - EX-WRN-05  Assigned examinee count exceeds planned capacity.
 *    - EX-WRN-06  Possible duplicate external candidate by NORMALIZED FULL NAME
 *                 when no confirmed matching nationalId exists.
 *    - EX-WRN-07  Required staffing incomplete before publication: a missing
 *                 supervising instructor and/or examiner set. ONE warning code
 *                 whose `details` list what is missing (never two codes).
 *
 * Output ordering is STABLE and deterministic, and exact-duplicate conflict
 * entries (same code + subject + session pair) are collapsed to one.
 *
 * It does NOT own scores/results (schedule-only), does not resolve overlaps
 * itself (delegates to overlap-core), and does not model publication.
 */
import type { ParticipantRef } from "./exam-domain-core";
import { participantKey } from "./exam-domain-core";
import { intervalsOverlap, type ExamTimeInterval } from "./exam-overlap-core";

// ===========================================================================
// Stable codes, severities, and Hebrew messages
// ===========================================================================

export type ExamConflictSeverity = "BLOCK" | "WARN";

/** Hard-block conflict codes (the authoritative numbered matrix). */
export type ExamBlockCode = "EX-BLK-01" | "EX-BLK-02" | "EX-BLK-03" | "EX-BLK-04";

/** Warning conflict codes (the authoritative numbered matrix). */
export type ExamWarnCode =
  | "EX-WRN-01"
  | "EX-WRN-02"
  | "EX-WRN-03"
  | "EX-WRN-04"
  | "EX-WRN-05"
  | "EX-WRN-06"
  | "EX-WRN-07";

export type ExamConflictCode = ExamBlockCode | ExamWarnCode;

/** The severity of each code. Exhaustive by mapped type. */
const CODE_SEVERITY: Readonly<Record<ExamConflictCode, ExamConflictSeverity>> = Object.freeze({
  "EX-BLK-01": "BLOCK",
  "EX-BLK-02": "BLOCK",
  "EX-BLK-03": "BLOCK",
  "EX-BLK-04": "BLOCK",
  "EX-WRN-01": "WARN",
  "EX-WRN-02": "WARN",
  "EX-WRN-03": "WARN",
  "EX-WRN-04": "WARN",
  "EX-WRN-05": "WARN",
  "EX-WRN-06": "WARN",
  "EX-WRN-07": "WARN",
});

/** The canonical Hebrew message per code. Exhaustive by mapped type. */
export const EXAM_CONFLICT_MESSAGES: Readonly<Record<ExamConflictCode, string>> = Object.freeze({
  "EX-BLK-01": "הנבחן משובץ בשני מבחנים חופפים בזמן",
  "EX-BLK-02": "החניך משובץ בשני תפקידים במבחנים חופפים",
  "EX-BLK-03": "לא ניתן לשבץ את אותו חניך כנבחן וכחניך מודרך באותו שיבוץ",
  "EX-BLK-04": "נבחן חיצוני עם תעודת זהות זו כבר קיים",
  "EX-WRN-01": "הסוס משובץ במבחן חופף בזמן",
  "EX-WRN-02": "המדריך המשגיח משובץ במבחן חופף",
  "EX-WRN-03": "סט הבוחנים משובץ בשני מבחנים חופפים",
  "EX-WRN-04": "המגרש משובץ למבחן חופף",
  "EX-WRN-05": "מספר הנבחנים חורג מהקיבולת המתוכננת",
  "EX-WRN-06": "קיים נבחן חיצוני בשם זהה",
  "EX-WRN-07": "מומלץ לשבץ מדריך משגיח וסט בוחנים לפני הפרסום",
});

/** What a conflict is "about", for grouping/rendering. */
export type ExamConflictSubjectKind =
  | "TRAINEE"
  | "CANDIDATE"
  | "HORSE"
  | "SUPERVISOR"
  | "EXAMINER_SET"
  | "ARENA"
  | "SESSION";

/** A stable staffing-gap token used in EX-WRN-07 `details`. */
export type ExamStaffingGap = "SUPERVISOR" | "EXAMINER_SET";

/** One detected conflict. `sessionIds` is sorted (2 sessions for a pairwise
 * overlap, 1 for a per-session issue, 0 for a plan-level registry issue).
 * `subjectId` is the shared resource/identity key, or `null`. `details` carries
 * extra structured tokens (e.g. what staffing is missing for EX-WRN-07); it is
 * an empty frozen array for codes that need none. */
export interface ExamConflict {
  readonly code: ExamConflictCode;
  readonly severity: ExamConflictSeverity;
  readonly message: string;
  readonly subjectKind: ExamConflictSubjectKind;
  readonly subjectId: string | null;
  readonly sessionIds: readonly string[];
  readonly details: readonly string[];
}

// ===========================================================================
// Input model
// ===========================================================================

/** The participant role within a session. Compared as a plain string so this
 * core stays decoupled; the recognized values are "EXAMINEE" and
 * "INSTRUCTED_TRAINEE" (see the domain core's `ExamAssignmentRole`). */
export const ROLE_EXAMINEE = "EXAMINEE";
export const ROLE_INSTRUCTED_TRAINEE = "INSTRUCTED_TRAINEE";

/** One participant assignment inside a conflict-input session. */
export interface ConflictAssignment {
  readonly role: string;
  readonly participant: ParticipantRef;
}

/** One session as seen by the conflict engine. */
export interface ConflictSession {
  readonly sessionId: string;
  readonly interval: ExamTimeInterval;
  readonly assignments: readonly ConflictAssignment[];
  readonly supervisorIds: readonly string[];
  readonly examinerSetId: string | null;
  readonly horseIds: readonly string[];
  readonly arenaId: string | null;
  /** Declared examinee capacity, or `null` when uncapped. */
  readonly capacity: number | null;
  /** When true, missing supervisor / examiner set are warned about (EX-WRN-07). */
  readonly expectsStaffing: boolean;
}

/** One external-candidate registry entry for the ExamPlan. */
export interface ExternalCandidateRegistryEntry {
  readonly candidateId: string;
  /** Confirmed nationalId / identity key; null/empty when unknown. Two records
   * sharing this (non-empty) are a hard EX-BLK-04 duplicate. */
  readonly nationalId?: string | null;
  /** Caller-NORMALIZED full name; null/empty when unknown. Two records sharing
   * this — with NO confirmed matching nationalId — raise the EX-WRN-06 warning. */
  readonly normalizedName?: string | null;
}

/** The full input to the conflict engine. Scoped to a single ExamPlan. */
export interface ConflictInput {
  readonly sessions: readonly ConflictSession[];
  readonly externalCandidates?: readonly ExternalCandidateRegistryEntry[];
}

// ===========================================================================
// Helpers
// ===========================================================================

function isPresent(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/** A sorted pair of session ids (stable regardless of input order). */
function sessionPair(a: string, b: string): readonly string[] {
  return a <= b ? [a, b] : [b, a];
}

/** The participant identity keys assigned in a role within a session. */
function keysByRole(session: ConflictSession, role: string): Set<string> {
  const keys = new Set<string>();
  for (const a of session.assignments) {
    if (a.role === role) keys.add(participantKey(a.participant));
  }
  return keys;
}

/** Filter an identity-key set to internal-trainee keys only. */
function internalOnly(keys: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const k of keys) if (k.startsWith("INTERNAL:")) out.add(k);
  return out;
}

/** The subject kind implied by a participant identity key. */
function subjectKindForKey(key: string): ExamConflictSubjectKind {
  return key.startsWith("INTERNAL:") ? "TRAINEE" : "CANDIDATE";
}

/** The values present in both sets, returned sorted for determinism. */
function sortedIntersection(a: Set<string>, b: Set<string>): string[] {
  const shared: string[] = [];
  for (const v of a) if (b.has(v)) shared.push(v);
  shared.sort();
  return shared;
}

/** The ids present in both arrays, sorted, ignoring blanks. */
function sortedSharedIds(a: readonly string[], b: readonly string[]): string[] {
  const setB = new Set<string>();
  for (const v of b) if (isPresent(v)) setB.add(v);
  const shared = new Set<string>();
  for (const v of a) if (isPresent(v) && setB.has(v)) shared.add(v);
  return [...shared].sort();
}

function makeConflict(
  code: ExamConflictCode,
  subjectKind: ExamConflictSubjectKind,
  subjectId: string | null,
  sessionIds: readonly string[],
  details: readonly string[] = [],
): ExamConflict {
  return {
    code,
    severity: CODE_SEVERITY[code],
    message: EXAM_CONFLICT_MESSAGES[code],
    subjectKind,
    subjectId,
    sessionIds: Object.freeze([...sessionIds]),
    details: Object.freeze([...details]),
  };
}

/** A total-order key for a conflict, for stable sorting AND de-duplication.
 * `details` is metadata and is intentionally excluded (per-code/subject/session
 * identity is unique without it). */
function conflictKey(c: ExamConflict): string {
  const sev = c.severity === "BLOCK" ? "0" : "1";
  return [sev, c.code, c.subjectId ?? "", c.sessionIds.join("|")].join(" ");
}

// ===========================================================================
// The engine
// ===========================================================================

/**
 * Detect all conflicts across a set of sessions. Deterministic and pure.
 * Returns conflicts in a STABLE order (BLOCK before WARN, then by code, subject,
 * and session pair) with exact-duplicate entries collapsed.
 */
export function detectExamConflicts(input: ConflictInput): readonly ExamConflict[] {
  const sessions = input.sessions;
  const out: ExamConflict[] = [];

  // --- per-session issues ---------------------------------------------------
  for (const s of sessions) {
    // EX-BLK-03: the same person is both an examinee AND an instructed trainee
    // within this one session.
    const examinees = keysByRole(s, ROLE_EXAMINEE);
    const instructed = keysByRole(s, ROLE_INSTRUCTED_TRAINEE);
    for (const key of sortedIntersection(examinees, instructed)) {
      out.push(makeConflict("EX-BLK-03", subjectKindForKey(key), key, [s.sessionId]));
    }

    // EX-WRN-05: examinee count over declared capacity.
    if (typeof s.capacity === "number" && Number.isFinite(s.capacity)) {
      const examineeCount = s.assignments.filter((a) => a.role === ROLE_EXAMINEE).length;
      if (examineeCount > s.capacity) {
        out.push(makeConflict("EX-WRN-05", "SESSION", null, [s.sessionId]));
      }
    }

    // EX-WRN-07: incomplete staffing before publication. ONE code; `details`
    // enumerate what is missing (supervisor and/or examiner set).
    if (s.expectsStaffing) {
      const missing: ExamStaffingGap[] = [];
      if (!s.supervisorIds.some(isPresent)) missing.push("SUPERVISOR");
      if (!isPresent(s.examinerSetId)) missing.push("EXAMINER_SET");
      if (missing.length > 0) {
        out.push(makeConflict("EX-WRN-07", "SESSION", null, [s.sessionId], missing));
      }
    }
  }

  // --- pairwise (overlapping) issues ---------------------------------------
  for (let i = 0; i < sessions.length; i++) {
    for (let j = i + 1; j < sessions.length; j++) {
      const a = sessions[i];
      const b = sessions[j];
      if (a.sessionId === b.sessionId) continue;
      if (!intervalsOverlap(a.interval, b.interval)) continue;
      const pair = sessionPair(a.sessionId, b.sessionId);

      const examineesA = keysByRole(a, ROLE_EXAMINEE);
      const examineesB = keysByRole(b, ROLE_EXAMINEE);

      // EX-BLK-01: same examinee (internal OR external) in both sessions.
      for (const key of sortedIntersection(examineesA, examineesB)) {
        out.push(makeConflict("EX-BLK-01", subjectKindForKey(key), key, pair));
      }

      // EX-BLK-02: an internal trainee is an examinee in one session and an
      // instructed trainee in the other (either direction).
      const exIntA = internalOnly(examineesA);
      const exIntB = internalOnly(examineesB);
      const insIntA = internalOnly(keysByRole(a, ROLE_INSTRUCTED_TRAINEE));
      const insIntB = internalOnly(keysByRole(b, ROLE_INSTRUCTED_TRAINEE));
      const crossRole = new Set<string>([
        ...sortedIntersection(exIntA, insIntB),
        ...sortedIntersection(exIntB, insIntA),
      ]);
      for (const key of [...crossRole].sort()) {
        out.push(makeConflict("EX-BLK-02", "TRAINEE", key, pair));
      }

      // EX-WRN-01: shared horse.
      for (const id of sortedSharedIds(a.horseIds, b.horseIds)) {
        out.push(makeConflict("EX-WRN-01", "HORSE", id, pair));
      }
      // EX-WRN-02: shared supervising instructor.
      for (const id of sortedSharedIds(a.supervisorIds, b.supervisorIds)) {
        out.push(makeConflict("EX-WRN-02", "SUPERVISOR", id, pair));
      }
      // EX-WRN-03: shared examiner set (a warning even across different arenas).
      if (isPresent(a.examinerSetId) && a.examinerSetId === b.examinerSetId) {
        out.push(makeConflict("EX-WRN-03", "EXAMINER_SET", a.examinerSetId, pair));
      }
      // EX-WRN-04: shared arena / location.
      if (isPresent(a.arenaId) && a.arenaId === b.arenaId) {
        out.push(makeConflict("EX-WRN-04", "ARENA", a.arenaId, pair));
      }
    }
  }

  // --- external-candidate registry: nationalId dup + name warning ----------
  const registry = input.externalCandidates ?? [];

  // EX-BLK-04: two DISTINCT candidate records share one non-empty nationalId.
  const byNationalId = new Map<string, Set<string>>();
  for (const entry of registry) {
    if (!isPresent(entry.candidateId) || !isPresent(entry.nationalId)) continue;
    const set = byNationalId.get(entry.nationalId) ?? new Set<string>();
    set.add(entry.candidateId);
    byNationalId.set(entry.nationalId, set);
  }
  for (const [nationalId, candidateIds] of byNationalId) {
    if (candidateIds.size > 1) {
      out.push(makeConflict("EX-BLK-04", "CANDIDATE", nationalId, []));
    }
  }

  // EX-WRN-06: two DISTINCT candidate records share one normalized full name
  // AND there is NO confirmed matching nationalId within that name group (i.e.
  // no two of them share a single non-empty nationalId — otherwise that pair is
  // already the EX-BLK-04 hard duplicate and the name warning would be noise).
  const byName = new Map<string, ExternalCandidateRegistryEntry[]>();
  for (const entry of registry) {
    if (!isPresent(entry.candidateId) || !isPresent(entry.normalizedName)) continue;
    const list = byName.get(entry.normalizedName) ?? [];
    list.push(entry);
    byName.set(entry.normalizedName, list);
  }
  for (const [normalizedName, entries] of byName) {
    const distinctCandidates = new Set(entries.map((e) => e.candidateId));
    if (distinctCandidates.size < 2) continue;
    const natToCandidates = new Map<string, Set<string>>();
    for (const e of entries) {
      if (!isPresent(e.nationalId)) continue;
      const set = natToCandidates.get(e.nationalId) ?? new Set<string>();
      set.add(e.candidateId);
      natToCandidates.set(e.nationalId, set);
    }
    const confirmedMatch = [...natToCandidates.values()].some((s) => s.size > 1);
    if (!confirmedMatch) {
      out.push(makeConflict("EX-WRN-06", "CANDIDATE", normalizedName, []));
    }
  }

  // --- stable order + de-duplicate exact entries ---------------------------
  const byKey = new Map<string, ExamConflict>();
  for (const c of out) {
    const key = conflictKey(c);
    if (!byKey.has(key)) byKey.set(key, c);
  }
  const deduped = [...byKey.values()];
  deduped.sort((x, y) => {
    const kx = conflictKey(x);
    const ky = conflictKey(y);
    return kx < ky ? -1 : kx > ky ? 1 : 0;
  });
  return Object.freeze(deduped);
}
