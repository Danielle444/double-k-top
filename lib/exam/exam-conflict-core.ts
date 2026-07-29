/**
 * EXAM X0 / EX-S4A — PURE conflict-detection core over a set of exam sessions.
 *
 * PURE by construction: no Prisma, no DB, no clock, no randomness, no env, no
 * IO. Deterministic; never mutates its inputs. The only runtime dependencies are
 * the sibling PURE cores (`intervalsOverlap`, `participantKey`); every other
 * import is an erased `import type`.
 *
 * WHAT THIS ANSWERS (and only this): given a set of scheduled sessions (each
 * with its interval, participants, supervisors, examiner set, horses, arena, and
 * capacity) plus the ExamPlan's external-candidate registry, which HARD-BLOCK
 * conflicts and which WARNINGS exist?
 *
 * ===========================================================================
 * EX-S4A AMENDMENT — SLOT-AWARE GRANULARITY
 * ===========================================================================
 * An `ExamSession` is ONE PARALLEL BLOCK, not one contiguous appointment. A
 * definition-backed block chunks its examinees into WAVES (see
 * `exam-block-timetable-core`), so a trainee examined in wave 1 is simply NOT
 * present during wave 6. Comparing the whole block interval would report that
 * trainee as double-booked against anything touching the block at all — a false
 * conflict on nearly every real exam day.
 *
 * The conflict matrix is therefore split by GRAIN:
 *
 *   SLOT-GRAINED (compared per DERIVED individual interval):
 *     - EX-BLK-01 examinee double-booking
 *     - EX-BLK-02 cross-role double-booking
 *     - EX-WRN-01 horse overlap
 *
 *   BLOCK-GRAINED (compared per whole-block interval — deliberately NOT
 *   narrowed, because these resources are held for the entire block):
 *     - EX-WRN-02 supervising / responsible instructor
 *     - EX-WRN-03 examiner set
 *     - EX-WRN-04 arena
 *     - EX-WRN-07 staffing completeness
 *
 * An INSTRUCTED_TRAINEE never consumes a wave lane; it INHERITS the slot of the
 * examinee it is paired with, exactly as `resolveInstructedTraineeSlots`
 * resolves it. An UNRESOLVED pairing yields NO slot, and such an individual is
 * excluded from the slot-grained checks rather than silently widened to the
 * whole block — a mis-pairing is surfaced by validation, not guessed at here.
 *
 * LIVE BEGINNER ROWS (`source: "BEGINNER"`) never go near the timetable
 * calculator. They are real Teaching-Practice lessons: every participant, and
 * every horse, occupies the lesson's own start/end interval, and the lesson's
 * `responsibleInstructorId` competes with stored supervisors under EX-WRN-02.
 * A beginner row has no examiner set (EX-WRN-03 never applies to it) and its
 * free-text `location` is NOT an arena id, so it is never compared to a stored
 * arena. Where BOTH sides of a conflict are beginner-owned, the Exams module
 * cannot fix the clash — it lives in Teaching Practice — so a BLOCK is
 * DOWNGRADED to a WARN and tagged `TP_OWNED`, never suppressed.
 *
 * FAIL CLOSED, NEVER FABRICATE: when a definition-backed block's timetable
 * cannot be computed at all, its participants and horses fall back to the
 * EXISTING whole-block interval, tagged `TIMETABLE_UNRESOLVED`. Conflicts are
 * over-reported rather than dropped, and no start or end time is ever invented.
 * That failure is NOT the same as an unresolved pairing: an instructed trainee
 * still paired to exactly one examinee is merely un-TIMED and takes the
 * fallback like everyone else, while one that is absent-, unmatched- or
 * ambiguously-paired is UNPLACED and is excluded. Widening a known participant
 * is safe; inventing the pairing of an unplaced one is not.
 *
 * THE AUTHORITATIVE CONFLICT MATRIX (stable numbered codes + Hebrew messages):
 *
 *   HARD BLOCK:
 *    - EX-BLK-01  Same examinee assigned to two overlapping SLOTS. One UNIFIED
 *                 rule covering both internal trainees and external candidates
 *                 (there is intentionally NO separate external-only code).
 *    - EX-BLK-02  The same internal trainee is an examinee in one slot and an
 *                 instructed trainee in another overlapping slot.
 *    - EX-BLK-03  The examinee and the instructed trainee are the same person
 *                 within one session.
 *    - EX-BLK-04  Two external-candidate records in the same ExamPlan share the
 *                 same non-empty nationalId / identity key.
 *
 *   WARNING (soft signals — never block):
 *    - EX-WRN-01  Horse overlap between two overlapping SLOTS.
 *    - EX-WRN-02  Supervising/responsible-instructor overlap between two
 *                 overlapping BLOCKS.
 *    - EX-WRN-03  Same examiner set assigned to two overlapping BLOCKS (a
 *                 WARNING even when the arenas differ — never a block).
 *                 RESERVED LEGACY: stored blocks only.
 *    - EX-WRN-04  Arena overlap between two overlapping stored BLOCKS.
 *    - EX-WRN-05  LEGACY ONLY — assigned examinee count exceeds planned
 *                 capacity. NEVER fires for a definition-backed block, where
 *                 `parallelCapacity` is examinees PER WAVE and not a maximum
 *                 assignment count. There is deliberately no replacement.
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
 * itself (delegates to overlap-core), does not compute timetables itself
 * (delegates to block-timetable-core), and does not model publication.
 *
 * This contract is deliberately INDEPENDENT of `ProjectionSession`: the view
 * cores and the conflict engine answer different questions and must be free to
 * evolve apart. Do not unify them.
 */
import type { ParticipantRef } from "./exam-domain-core";
import { participantKey } from "./exam-domain-core";
import type { ExamTimetableSlot } from "./exam-block-timetable-core";
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

/** The BASE severity of each code. Exhaustive by mapped type. A beginner-owned
 * pair downgrades a BLOCK to a WARN at emission time — see `TP_OWNED`. */
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

/**
 * EX-S4A — the stable `details` tokens a slot-aware conflict may carry.
 *
 *  - `TIMETABLE_UNRESOLVED` — at least one side's individual slot could not be
 *    computed, so the conservative whole-block interval was used instead.
 *  - `TP_OWNED` — BOTH sides are live Teaching-Practice beginner rows, so the
 *    clash cannot be resolved from the Exams module. A BLOCK carrying this token
 *    is emitted at WARN severity.
 */
export type ExamConflictDetailToken = "TIMETABLE_UNRESOLVED" | "TP_OWNED";

export const DETAIL_TIMETABLE_UNRESOLVED: ExamConflictDetailToken = "TIMETABLE_UNRESOLVED";
export const DETAIL_TP_OWNED: ExamConflictDetailToken = "TP_OWNED";

/** The canonical emission order of the S4A detail tokens (stable). */
const DETAIL_TOKEN_ORDER: readonly string[] = Object.freeze([
  DETAIL_TIMETABLE_UNRESOLVED,
  DETAIL_TP_OWNED,
]);

/** One detected conflict. `sessionIds` is sorted (2 sessions for a pairwise
 * overlap, 1 for a per-session issue, 0 for a plan-level registry issue).
 * `subjectId` is the shared resource/identity key, or `null`. `details` carries
 * extra structured tokens (the EX-WRN-07 staffing gaps, or the S4A
 * `ExamConflictDetailToken`s); it is an empty frozen array for codes that need
 * none. */
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

/** Where a conflict-input session came from. `STORED` is a real `ExamSession`
 * row; `BEGINNER` is a live Teaching-Practice projection. Absent reads as
 * `STORED`, which is the legacy behaviour. */
export type ConflictSessionSource = "STORED" | "BEGINNER";

/**
 * Whether a definition-backed block's DERIVED timetable is usable.
 *  - `NOT_APPLICABLE` — no timetable applies (a legacy block, or a beginner row);
 *  - `OK` — `slots` are authoritative;
 *  - `UNRESOLVED` — the timetable failed globally; `slots` are ignored and the
 *    conservative whole-block fallback applies.
 */
export type ConflictTimetableStatus = "NOT_APPLICABLE" | "OK" | "UNRESOLVED";

/**
 * One DERIVED individual slot, keyed by the assignment it belongs to. Times are
 * `HH:MM` on the owning session's own date; the date is never carried here so a
 * slot can never disagree with its block about which day it is on.
 */
export interface ConflictAssignmentSlot {
  readonly assignmentId: string;
  readonly startTime: string;
  readonly endTime: string;
}

/**
 * Compile-time proof that a DERIVED `ExamTimetableSlot` is directly usable as a
 * `ConflictAssignmentSlot`, so the future reader can hand timetable output
 * straight to this core with no re-shaping. Resolves to `ExamTimetableSlot`, and
 * would become `never` if the two shapes ever diverged.
 */
export type TimetableSlotAsConflictSlot =
  ExamTimetableSlot extends ConflictAssignmentSlot ? ExamTimetableSlot : never;

/** One participant assignment inside a conflict-input session. */
export interface ConflictAssignment {
  readonly role: string;
  readonly participant: ParticipantRef;
  /**
   * The `ExamAssignment.id`, used to match this assignment to its DERIVED
   * timetable slot. Absent (or unmatched) on a definition-backed block means no
   * individual slot — see the fallback rules on `ConflictSession.slots`.
   */
  readonly assignmentId?: string | null;
  /**
   * The horse ridden under THIS assignment — a name or an id, whichever the
   * caller holds. Normalized (trim, whitespace collapse, case-insensitive)
   * before comparison; a blank value never participates. This is the
   * definition-aware horse input and is preferred over `ConflictSession.horseIds`.
   */
  readonly horse?: string | null;
  /**
   * The `ExamAssignment.pairingIndex` — "who teaches whom" within this block.
   * An INSTRUCTED_TRAINEE is paired to the EXAMINEE carrying the SAME index.
   *
   * It is consulted ONLY when the block's timetable is globally unresolved and
   * therefore no derived slot exists for anybody: it is what distinguishes an
   * instructed trainee that is merely un-TIMED (paired, so still known to be in
   * this block, and included in the conservative whole-block fallback) from one
   * that is genuinely UNPLACED (absent / unmatched / ambiguous pairing, and so
   * excluded). When slots exist, the slot is authoritative and this is unused.
   */
  readonly pairingIndex?: number | null;
}

/** One session as seen by the conflict engine. */
export interface ConflictSession {
  readonly sessionId: string;
  readonly interval: ExamTimeInterval;
  readonly assignments: readonly ConflictAssignment[];
  readonly supervisorIds: readonly string[];
  readonly examinerSetId: string | null;
  /**
   * LEGACY FALLBACK ONLY. Session-level horses, compared at whole-block grain.
   * Used only when NO assignment carries a usable `horse`; a definition-aware
   * caller supplies `ConflictAssignment.horse` instead and this stays empty.
   */
  readonly horseIds: readonly string[];
  readonly arenaId: string | null;
  /**
   * LEGACY declared examinee capacity, or `null` when uncapped. Consulted ONLY
   * when `definitionId` is absent — see EX-WRN-05.
   */
  readonly capacity: number | null;
  /** When true, missing supervisor / examiner set are warned about (EX-WRN-07). */
  readonly expectsStaffing: boolean;

  // --- EX-S4A: slot-aware inputs (all OPTIONAL; omitted ⇒ legacy behaviour) ---

  /**
   * The `ExamDefinition` this block is anchored to. Its presence is what makes
   * the block slot-aware AND what disables the legacy capacity warning.
   */
  readonly definitionId?: string | null;
  /** Stored block vs live Teaching-Practice beginner row. Default `STORED`. */
  readonly source?: ConflictSessionSource;
  /**
   * The DERIVED per-assignment slots of this block. Never persisted, always
   * recomputed. Accepts `ExamTimetableSlot` verbatim.
   */
  readonly slots?: readonly ConflictAssignmentSlot[];
  /**
   * Whether `slots` may be trusted. Defaults to `OK` when slots are present and
   * `UNRESOLVED` when a definition-backed block has none — the fail-closed
   * reading, which over-reports rather than dropping conflicts.
   */
  readonly timetableStatus?: ConflictTimetableStatus;
  /**
   * A live beginner row's responsible Teaching-Practice instructor. Occupied for
   * the FULL lesson and compared against stored supervisors under EX-WRN-02.
   */
  readonly responsibleInstructorId?: string | null;
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

const NO_TOKENS: readonly string[] = Object.freeze([]);

function isPresent(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/** A usable participant reference; anything else is skipped rather than thrown on. */
function isParticipantRef(v: unknown): v is ParticipantRef {
  if (typeof v !== "object" || v === null) return false;
  const kind = (v as { kind?: unknown }).kind;
  return kind === "INTERNAL" || kind === "EXTERNAL";
}

/**
 * The comparison key for a horse: trimmed, internal whitespace collapsed to one
 * space, case-insensitive. Deliberately NOTHING else — no fuzzy matching, no
 * punctuation stripping, no digit stripping, no word removal. "סוסה 2" and
 * "סוסה" are different horses and must stay different. A blank value yields
 * `null` and never participates in a comparison.
 */
function normalizeHorse(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const collapsed = value.trim().replace(/\s+/g, " ");
  if (collapsed.length === 0) return null;
  return collapsed.toLowerCase();
}

/** A sorted pair of session ids (stable regardless of input order). */
function sessionPair(a: string, b: string): readonly string[] {
  return a <= b ? [a, b] : [b, a];
}

/** A finite integer of any sign. */
function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

/** A session's assignments, tolerating a malformed/absent list. */
function assignmentsOf(session: ConflictSession): readonly ConflictAssignment[] {
  return Array.isArray(session.assignments) ? session.assignments : [];
}

/** The participant identity keys assigned in a role within a session. */
function keysByRole(session: ConflictSession, role: string): Set<string> {
  const keys = new Set<string>();
  for (const a of assignmentsOf(session)) {
    if (a?.role === role && isParticipantRef(a.participant)) {
      keys.add(participantKey(a.participant));
    }
  }
  return keys;
}

/** True for an internal-trainee identity key. */
function isInternalKey(key: string): boolean {
  return key.startsWith("INTERNAL:");
}

/** The subject kind implied by a participant identity key. */
function subjectKindForKey(key: string): ExamConflictSubjectKind {
  return isInternalKey(key) ? "TRAINEE" : "CANDIDATE";
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

/** De-duplicate and canonically order `details` tokens. */
function orderTokens(tokens: Iterable<string>): string[] {
  const rank = (t: string): number => {
    const i = DETAIL_TOKEN_ORDER.indexOf(t);
    return i === -1 ? DETAIL_TOKEN_ORDER.length : i;
  };
  return [...new Set(tokens)].sort(
    (x, y) => rank(x) - rank(y) || (x < y ? -1 : x > y ? 1 : 0),
  );
}

function makeConflict(
  code: ExamConflictCode,
  subjectKind: ExamConflictSubjectKind,
  subjectId: string | null,
  sessionIds: readonly string[],
  details: readonly string[] = NO_TOKENS,
  severity: ExamConflictSeverity = CODE_SEVERITY[code],
): ExamConflict {
  return {
    code,
    severity,
    message: EXAM_CONFLICT_MESSAGES[code],
    subjectKind,
    subjectId,
    sessionIds: Object.freeze([...sessionIds]),
    details: Object.freeze([...details]),
  };
}

/**
 * The severity to emit for a pairwise conflict. A BLOCK between two live
 * Teaching-Practice beginner rows is DOWNGRADED to a WARN: the Exams module owns
 * neither lesson and cannot fix the clash, so blocking on it would block a
 * publication nobody can unblock. It is never suppressed — the WARN carries
 * `TP_OWNED` so the reader knows where the fix lives.
 */
function pairSeverity(code: ExamConflictCode, bothBeginner: boolean): ExamConflictSeverity {
  const base = CODE_SEVERITY[code];
  return bothBeginner && base === "BLOCK" ? "WARN" : base;
}

/** A total-order key for a conflict, for stable sorting AND de-duplication.
 * `details` is metadata and is intentionally excluded (per-code/subject/session
 * identity is unique without it). */
function conflictKey(c: ExamConflict): string {
  const sev = c.severity === "BLOCK" ? "0" : "1";
  return [sev, c.code, c.subjectId ?? "", c.sessionIds.join("|")].join(" ");
}

// ===========================================================================
// Per-session preparation: individual intervals for the slot-grained rules
// ===========================================================================

/** One participant occupancy: who, in which role, over which real interval. */
interface ParticipantEntry {
  readonly key: string;
  readonly role: string;
  readonly interval: ExamTimeInterval;
  readonly tokens: readonly string[];
}

/** One horse occupancy: the normalized horse over a real interval. */
interface HorseEntry {
  readonly horse: string;
  readonly interval: ExamTimeInterval;
  readonly tokens: readonly string[];
}

/** A session with its occupancy entries resolved once, up front. */
interface PreparedSession {
  readonly session: ConflictSession;
  readonly beginner: boolean;
  readonly participants: readonly ParticipantEntry[];
  readonly horses: readonly HorseEntry[];
  /** Supervisors PLUS a beginner row's responsible instructor. */
  readonly supervisorIds: readonly string[];
}

/**
 * The pairing indices that identify EXACTLY ONE examinee in this block.
 *
 * This mirrors `resolveInstructedTraineeSlots`' uniqueness rule — an index
 * claimed by two examinees identifies neither — WITHOUT calling the timetable
 * calculator, which is deliberate: this core answers the question from plain
 * input data, and by the time it matters the calculator has already failed.
 *
 * It deliberately does NOT require the examinee to carry an `assignmentId`. The
 * calculator needs one because it returns slots keyed by it; here the question
 * is only whether the RELATIONSHIP is unambiguous, so an id the reader happens
 * not to have must not suppress a known participant.
 */
function resolveUniquePairings(session: ConflictSession): Set<number> {
  const seen = new Set<number>();
  const ambiguous = new Set<number>();
  for (const a of assignmentsOf(session)) {
    if (a?.role !== ROLE_EXAMINEE || !isInteger(a.pairingIndex)) continue;
    if (seen.has(a.pairingIndex)) ambiguous.add(a.pairingIndex);
    else seen.add(a.pairingIndex);
  }
  for (const index of ambiguous) seen.delete(index);
  return seen;
}

/**
 * Resolve one session's individual occupancies.
 *
 * A block is SLOT-AWARE iff it is definition-backed and not a beginner row.
 * For such a block:
 *   - an assignment matching a derived slot occupies exactly that slot;
 *   - under `OK`, an assignment with NO matching slot is EXCLUDED if it is an
 *     instructed trainee — the timetable succeeded, so a missing inherited slot
 *     means the pairing itself did not resolve — and otherwise falls back to the
 *     whole block, tagged `TIMETABLE_UNRESOLVED`;
 *   - under `UNRESOLVED` NO slot exists for anybody, so the whole-block fallback
 *     applies to every examinee AND to every instructed trainee whose PAIRING
 *     still resolves uniquely (see `resolveUniquePairings`), all tagged
 *     `TIMETABLE_UNRESOLVED`.
 *
 * A GLOBALLY UNRESOLVED TIMETABLE AND AN UNRESOLVED PAIRING ARE DIFFERENT
 * STATES and are treated differently on purpose. When the calculation fails
 * because a duration, capacity or start time is invalid, an instructed trainee
 * paired to exactly one examinee is still KNOWN to be in this block — only its
 * exact minute is unknown — so dropping it would silently miss a genuine
 * cross-session conflict. An instructed trainee whose pairing is absent,
 * unmatched or ambiguous is a different problem: nothing places it anywhere, so
 * it is excluded from the slot-grained checks (participant AND horse) rather
 * than widened to "somewhere in this block", and pairing validation reports it.
 * Over-reporting a known participant is the safe direction; inventing a pairing
 * is not.
 *
 * A legacy block and a beginner row both occupy their own whole interval — for
 * the beginner row that interval IS the real Teaching-Practice lesson, which is
 * exactly right and is why it never goes near the timetable calculator.
 */
function prepareSession(session: ConflictSession): PreparedSession {
  const beginner = session.source === "BEGINNER";
  const slotAware = !beginner && isPresent(session.definitionId);
  const slots = Array.isArray(session.slots) ? session.slots : [];
  const status: ConflictTimetableStatus = !slotAware
    ? "NOT_APPLICABLE"
    : (session.timetableStatus ?? (slots.length > 0 ? "OK" : "UNRESOLVED"));

  const slotByAssignmentId = new Map<string, ConflictAssignmentSlot>();
  if (status === "OK") {
    for (const slot of slots) {
      if (isPresent(slot?.assignmentId)) slotByAssignmentId.set(slot.assignmentId, slot);
    }
  }

  // Only needed when the timetable failed globally: with no slots at all, the
  // pairing is the only thing left that can place an instructed trainee.
  const uniquePairings =
    status === "UNRESOLVED" ? resolveUniquePairings(session) : new Set<number>();

  const participants: ParticipantEntry[] = [];
  const assignmentHorses: HorseEntry[] = [];

  for (const assignment of assignmentsOf(session)) {
    if (!isParticipantRef(assignment?.participant)) continue;

    let interval: ExamTimeInterval | null = session.interval;
    let tokens: readonly string[] = NO_TOKENS;

    if (slotAware) {
      const slot = isPresent(assignment.assignmentId)
        ? slotByAssignmentId.get(assignment.assignmentId)
        : undefined;
      if (slot !== undefined) {
        // The slot carries clock times only; the day is the block's own day.
        interval = { date: session.interval.date, start: slot.startTime, end: slot.endTime };
      } else if (
        assignment.role === ROLE_INSTRUCTED_TRAINEE &&
        !(
          status === "UNRESOLVED" &&
          isInteger(assignment.pairingIndex) &&
          uniquePairings.has(assignment.pairingIndex)
        )
      ) {
        // UNPLACED: under OK a missing inherited slot IS the unresolved pairing,
        // and under UNRESOLVED an absent/unmatched/ambiguous pairing places this
        // trainee nowhere. Never widened to the block; never given a horse.
        interval = null;
      } else {
        // Un-TIMED but known to be in this block: every examinee, plus an
        // instructed trainee still uniquely paired despite the failed timetable.
        tokens = [DETAIL_TIMETABLE_UNRESOLVED];
      }
    }

    if (interval === null) continue;

    participants.push({
      key: participantKey(assignment.participant),
      role: assignment.role,
      interval,
      tokens,
    });

    const horse = normalizeHorse(assignment.horse);
    if (horse !== null) assignmentHorses.push({ horse, interval, tokens });
  }

  // Assignment-level horses WIN. The session-level list is the legacy input and
  // is only consulted when no assignment carries a horse at all.
  const horses: HorseEntry[] = [...assignmentHorses];
  if (horses.length === 0) {
    const legacy = Array.isArray(session.horseIds) ? session.horseIds : [];
    for (const raw of legacy) {
      const horse = normalizeHorse(raw);
      if (horse !== null) {
        horses.push({ horse, interval: session.interval, tokens: NO_TOKENS });
      }
    }
  }

  // A beginner row's responsible instructor is occupied for the FULL lesson and
  // competes with stored supervisors under the block-grained EX-WRN-02.
  const supervisorIds: string[] = [];
  const rawSupervisors = Array.isArray(session.supervisorIds) ? session.supervisorIds : [];
  for (const id of rawSupervisors) if (isPresent(id)) supervisorIds.push(id);
  if (isPresent(session.responsibleInstructorId)) {
    supervisorIds.push(session.responsibleInstructorId);
  }

  return { session, beginner, participants, horses, supervisorIds };
}

/**
 * Identity keys occupying overlapping intervals across two sessions, mapped to
 * the union of the `details` tokens of the overlapping entries. Touching
 * boundaries are not an overlap — `intervalsOverlap` is strict.
 */
function overlappingParticipantKeys(
  from: readonly ParticipantEntry[],
  fromRole: string,
  to: readonly ParticipantEntry[],
  toRole: string,
  internalOnly: boolean,
): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  for (const a of from) {
    if (a.role !== fromRole) continue;
    if (internalOnly && !isInternalKey(a.key)) continue;
    for (const b of to) {
      if (b.role !== toRole || b.key !== a.key) continue;
      if (!intervalsOverlap(a.interval, b.interval)) continue;
      const tokens = found.get(a.key) ?? new Set<string>();
      for (const t of a.tokens) tokens.add(t);
      for (const t of b.tokens) tokens.add(t);
      found.set(a.key, tokens);
    }
  }
  return found;
}

/** Horses occupying overlapping intervals across two sessions, with tokens. */
function overlappingHorses(
  from: readonly HorseEntry[],
  to: readonly HorseEntry[],
): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  for (const a of from) {
    for (const b of to) {
      if (a.horse !== b.horse) continue;
      if (!intervalsOverlap(a.interval, b.interval)) continue;
      const tokens = found.get(a.horse) ?? new Set<string>();
      for (const t of a.tokens) tokens.add(t);
      for (const t of b.tokens) tokens.add(t);
      found.set(a.horse, tokens);
    }
  }
  return found;
}

/** Merge `source` into `target`, unioning the token sets. */
function mergeKeyTokens(
  target: Map<string, Set<string>>,
  source: Map<string, Set<string>>,
): void {
  for (const [key, tokens] of source) {
    const existing = target.get(key) ?? new Set<string>();
    for (const t of tokens) existing.add(t);
    target.set(key, existing);
  }
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
  const sessions = Array.isArray(input.sessions) ? input.sessions : [];
  const prepared = sessions.map(prepareSession);
  const out: ExamConflict[] = [];

  // --- per-session issues ---------------------------------------------------
  for (const s of sessions) {
    // EX-BLK-03: the same person is both an examinee AND an instructed trainee
    // within this one session. Block-grained by nature — there is no second
    // interval to compare, and a person cannot be their own pupil in any wave.
    const examinees = keysByRole(s, ROLE_EXAMINEE);
    const instructed = keysByRole(s, ROLE_INSTRUCTED_TRAINEE);
    for (const key of sortedIntersection(examinees, instructed)) {
      out.push(makeConflict("EX-BLK-03", subjectKindForKey(key), key, [s.sessionId]));
    }

    // EX-WRN-05: LEGACY ONLY. For a definition-backed block `parallelCapacity`
    // is examinees PER WAVE, not a cap on the assignment count — twelve
    // examinees at capacity two is six waves, which is entirely normal — so
    // comparing the total against it would warn on every well-formed block.
    // There is deliberately NO replacement capacity warning.
    if (
      !isPresent(s.definitionId) &&
      typeof s.capacity === "number" &&
      Number.isFinite(s.capacity)
    ) {
      const examineeCount = assignmentsOf(s).filter((a) => a?.role === ROLE_EXAMINEE).length;
      if (examineeCount > s.capacity) {
        out.push(makeConflict("EX-WRN-05", "SESSION", null, [s.sessionId]));
      }
    }

    // EX-WRN-07: incomplete staffing before publication. ONE code; `details`
    // enumerate what is missing (supervisor and/or examiner set). Block-grained.
    if (s.expectsStaffing) {
      const missing: ExamStaffingGap[] = [];
      const supervisors = Array.isArray(s.supervisorIds) ? s.supervisorIds : [];
      if (!supervisors.some(isPresent)) missing.push("SUPERVISOR");
      if (!isPresent(s.examinerSetId)) missing.push("EXAMINER_SET");
      if (missing.length > 0) {
        out.push(makeConflict("EX-WRN-07", "SESSION", null, [s.sessionId], missing));
      }
    }
  }

  // --- pairwise issues ------------------------------------------------------
  for (let i = 0; i < prepared.length; i++) {
    for (let j = i + 1; j < prepared.length; j++) {
      const A = prepared[i];
      const B = prepared[j];
      if (A.session.sessionId === B.session.sessionId) continue;
      const pair = sessionPair(A.session.sessionId, B.session.sessionId);
      const bothBeginner = A.beginner && B.beginner;
      const extra = bothBeginner ? [DETAIL_TP_OWNED] : [];

      // --- SLOT-GRAINED rules. Deliberately NOT gated on whole-block overlap:
      // each occupancy carries its own real interval, and a derived slot is not
      // required to sit inside the block's stored end time.

      // EX-BLK-01: same examinee (internal OR external) in overlapping slots.
      const sameExaminee = overlappingParticipantKeys(
        A.participants,
        ROLE_EXAMINEE,
        B.participants,
        ROLE_EXAMINEE,
        false,
      );
      for (const key of [...sameExaminee.keys()].sort()) {
        out.push(
          makeConflict(
            "EX-BLK-01",
            subjectKindForKey(key),
            key,
            pair,
            orderTokens([...(sameExaminee.get(key) as Set<string>), ...extra]),
            pairSeverity("EX-BLK-01", bothBeginner),
          ),
        );
      }

      // EX-BLK-02: an internal trainee is an examinee in one slot and an
      // instructed trainee in an overlapping slot (either direction).
      const crossRole = new Map<string, Set<string>>();
      mergeKeyTokens(
        crossRole,
        overlappingParticipantKeys(
          A.participants,
          ROLE_EXAMINEE,
          B.participants,
          ROLE_INSTRUCTED_TRAINEE,
          true,
        ),
      );
      mergeKeyTokens(
        crossRole,
        overlappingParticipantKeys(
          A.participants,
          ROLE_INSTRUCTED_TRAINEE,
          B.participants,
          ROLE_EXAMINEE,
          true,
        ),
      );
      for (const key of [...crossRole.keys()].sort()) {
        out.push(
          makeConflict(
            "EX-BLK-02",
            "TRAINEE",
            key,
            pair,
            orderTokens([...(crossRole.get(key) as Set<string>), ...extra]),
            pairSeverity("EX-BLK-02", bothBeginner),
          ),
        );
      }

      // EX-WRN-01: the same horse in two overlapping slots.
      const sharedHorses = overlappingHorses(A.horses, B.horses);
      for (const horse of [...sharedHorses.keys()].sort()) {
        out.push(
          makeConflict(
            "EX-WRN-01",
            "HORSE",
            horse,
            pair,
            orderTokens([...(sharedHorses.get(horse) as Set<string>), ...extra]),
            pairSeverity("EX-WRN-01", bothBeginner),
          ),
        );
      }

      // --- BLOCK-GRAINED rules. These resources are held for the WHOLE block,
      // so they are compared at block grain and are gated on block overlap.
      if (!intervalsOverlap(A.session.interval, B.session.interval)) continue;

      // EX-WRN-02: shared supervising instructor — including a beginner row's
      // responsible instructor, who is occupied for the full lesson.
      for (const id of sortedSharedIds(A.supervisorIds, B.supervisorIds)) {
        out.push(
          makeConflict(
            "EX-WRN-02",
            "SUPERVISOR",
            id,
            pair,
            orderTokens(extra),
            pairSeverity("EX-WRN-02", bothBeginner),
          ),
        );
      }

      // EX-WRN-03: shared examiner set (a warning even across different arenas).
      // RESERVED LEGACY MODEL, stored blocks only: a live beginner row has no
      // examiner-set concept at all, so it never participates.
      if (
        !A.beginner &&
        !B.beginner &&
        isPresent(A.session.examinerSetId) &&
        A.session.examinerSetId === B.session.examinerSetId
      ) {
        out.push(makeConflict("EX-WRN-03", "EXAMINER_SET", A.session.examinerSetId, pair));
      }

      // EX-WRN-04: shared arena. STORED-vs-STORED only — a beginner row's
      // `location` is free Teaching-Practice text, not an arena identity, and
      // comparing the two would invent an equivalence that does not exist.
      if (
        !A.beginner &&
        !B.beginner &&
        isPresent(A.session.arenaId) &&
        A.session.arenaId === B.session.arenaId
      ) {
        out.push(makeConflict("EX-WRN-04", "ARENA", A.session.arenaId, pair));
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
