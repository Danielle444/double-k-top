/**
 * EXAM EX-C2 — PURE exam-block timetable core: the DERIVED individual-trainee
 * timetable of one scheduled parallel exam block.
 *
 * PURE by construction: no Prisma, no DB, no clock, no randomness, no env, no
 * auth/session/cookie, no filesystem, no network, no Next. Every export is a
 * total, deterministic function of its arguments and never mutates its inputs.
 * The only runtime dependency is the sibling PURE overlap core (`parseHHMM`),
 * so this module introduces NO new time arithmetic and NO new time format.
 *
 * WHAT THIS ANSWERS (and only this): given one block's start time, its
 * definition's per-trainee duration and parallel capacity, its ordered
 * examinees and its positional breaks — when does each individual trainee
 * start and end, and when does the block end?
 *
 * NOTHING HERE IS EVER PERSISTED. Individual start/end times, wave numbers and
 * the block end time are DERIVED on every read, precisely so that changing the
 * duration, the capacity, the ordering or a break is reflected immediately with
 * nothing to keep in step. Storing any output of this module would create the
 * second source of truth the exam module exists to prevent — do not.
 *
 * WHAT THIS DOES NOT DO:
 *  - validate the exam definition itself (exam-definition-validation-core);
 *  - detect overlaps (exam-overlap-core) or conflicts (exam-conflict-core);
 *  - know about publication, authorization, PII, or Teaching Practice;
 *  - read or write anything at all.
 *
 * ===========================================================================
 * THE MODEL
 * ===========================================================================
 * A block holds EXAMINEES. `parallelCapacity` is how many examinees may be
 * examined AT THE SAME TIME, so the ordered examinees are chunked into
 * consecutive WAVES of that size. Every examinee in one wave shares one
 * identical start and end time; wave w begins `durationMinutes` after wave
 * w-1, plus any break declared after wave w-1.
 *
 * With duration 15, capacity 2, start 09:00 and six examinees:
 *   wave 0 — examinees 1,2 — 09:00-09:15
 *   wave 1 — examinees 3,4 — 09:15-09:30
 *   wave 2 — examinees 5,6 — 09:30-09:45
 * and the block ends at 09:45.
 *
 * An INSTRUCTED_TRAINEE never occupies a lane and is never part of a wave — it
 * INHERITS the slot of the examinee it is paired with. See
 * `resolveInstructedTraineeSlots` at the bottom of this file.
 *
 * ===========================================================================
 * FAIL CLOSED — NEVER A PARTIAL TIMETABLE
 * ===========================================================================
 * Any structurally invalid input yields `ok: false` with EVERY applicable
 * issue and NO slots, NO waves and a null block end. A half-computed timetable
 * is worse than none: it would be rendered as fact and fed to the conflict
 * engine as fact.
 *
 * The one derived failure, `EX-CALC-MIDNIGHT`, is the same: a block whose last
 * wave would end at or after 24:00 produces nothing. The repository's time
 * contract is a zero-padded `HH:MM` in 00:00-23:59 against ONE opaque calendar
 * day token, so a wrapped end would read as a time EARLIER than the block's own
 * start and would silently corrupt every interval comparison downstream. There
 * is no correct partial answer here, so there is no partial answer.
 */
import { parseHHMM } from "./exam-overlap-core";

// ===========================================================================
// Codes + Hebrew messages
// ===========================================================================

/**
 * Blocking codes. Any one of these means `ok: false` and an EMPTY timetable.
 * The code STRINGS are the stable contract and must not be renamed once
 * consumed downstream.
 */
export type ExamTimetableIssueCode =
  | "EX-CALC-INVALID-START"
  | "EX-CALC-INVALID-DURATION"
  | "EX-CALC-INVALID-CAPACITY"
  | "EX-CALC-INVALID-ORDER"
  | "EX-CALC-INVALID-BREAK"
  | "EX-CALC-DUPLICATE-EXAMINEE"
  | "EX-CALC-MIDNIGHT";

/** Non-blocking codes. The timetable is still computed and still `ok`. */
export type ExamTimetableWarningCode = "EX-CALC-EMPTY-BLOCK" | "EX-CALC-BREAK-ORPHAN";

/**
 * The authoritative blocking code → Hebrew message table. The exhaustive
 * `Record<ExamTimetableIssueCode, string>` annotation forces every code —
 * present or future — to carry a message or this file will not compile.
 */
export const EXAM_TIMETABLE_ISSUE_MESSAGES: Readonly<
  Record<ExamTimetableIssueCode, string>
> = Object.freeze({
  "EX-CALC-INVALID-START": "שעת התחלה לא חוקית",
  "EX-CALC-INVALID-DURATION": "משך הבחינה לכל נבחן חייב להיות מספר דקות שלם וחיובי",
  "EX-CALC-INVALID-CAPACITY": "מספר הנבחנים במקביל חייב להיות מספר שלם וחיובי",
  "EX-CALC-INVALID-ORDER": "סדר הנבחנים אינו תקין",
  "EX-CALC-INVALID-BREAK": "הגדרת ההפסקה אינה תקינה",
  "EX-CALC-DUPLICATE-EXAMINEE": "אותו שיבוץ מופיע פעמיים ברשימת הנבחנים",
  "EX-CALC-MIDNIGHT": "הבלוק חורג מחצות ולכן לא ניתן לחשב את הלוח",
});

/** The authoritative warning code → Hebrew message table. Exhaustive. */
export const EXAM_TIMETABLE_WARNING_MESSAGES: Readonly<
  Record<ExamTimetableWarningCode, string>
> = Object.freeze({
  "EX-CALC-EMPTY-BLOCK": "לבלוק אין נבחנים משובצים",
  "EX-CALC-BREAK-ORPHAN": "הפסקה שהוגדרה אחרי הגל האחרון אינה משפיעה על הלוח",
});

/** One blocking issue. `details` carries non-PII structured tokens. */
export interface ExamTimetableIssue {
  readonly code: ExamTimetableIssueCode;
  readonly message: string;
  readonly details: readonly string[];
}

/** One non-blocking warning. `details` carries non-PII structured tokens. */
export interface ExamTimetableWarning {
  readonly code: ExamTimetableWarningCode;
  readonly message: string;
  readonly details: readonly string[];
}

// ===========================================================================
// Input
// ===========================================================================

/**
 * One EXAMINEE assignment competing for a lane. `orderIndex` is the manager's
 * explicit ordering; `assignmentId` is the deterministic final tie-break, which
 * is why a blank one is an ordering error rather than a cosmetic problem.
 */
export interface TimetableExaminee {
  readonly assignmentId: string;
  readonly orderIndex: number;
}

/**
 * One positional break. It occurs AFTER the zero-based `afterWaveIndex` and
 * shifts every later wave. There is deliberately no absolute time and no
 * earliest-start floor: an absolute anchor would reintroduce the manual time
 * this whole design exists to remove, and would silently go wrong the moment
 * the block start moved.
 */
export interface TimetableBreak {
  readonly breakId: string;
  readonly afterWaveIndex: number;
  readonly durationMinutes: number;
}

/** The complete input for one block's timetable. */
export interface ExamBlockTimetableInput {
  /** The block's own start, `HH:MM`. */
  readonly blockStartTime: string;
  /** Minutes per examined trainee, from the block's `ExamDefinition`. */
  readonly durationMinutes: number;
  /** Examinees examined at once, from the block's `ExamDefinition`. */
  readonly parallelCapacity: number;
  readonly examinees: readonly TimetableExaminee[];
  readonly breaks?: readonly TimetableBreak[];
}

// ===========================================================================
// Output
// ===========================================================================

/** One trainee's derived slot. Never persisted. */
export interface ExamTimetableSlot {
  readonly assignmentId: string;
  readonly waveIndex: number;
  /**
   * Zero-based lane within the wave. For an INHERITED instructed-trainee slot
   * this mirrors the paired examinee's lane and does NOT mean the trainee
   * occupies a lane of its own.
   */
  readonly positionInWave: number;
  readonly startTime: string;
  readonly endTime: string;
}

/** One wave: the examinees examined simultaneously, and when. */
export interface ExamTimetableWave {
  readonly waveIndex: number;
  readonly startTime: string;
  readonly endTime: string;
  /** EXAMINEE assignment ids only, in slot order. Never an instructed trainee. */
  readonly assignmentIds: readonly string[];
}

/** The derived timetable of one block. Deeply frozen. */
export interface ExamBlockTimetable {
  readonly ok: boolean;
  readonly issues: readonly ExamTimetableIssue[];
  readonly warnings: readonly ExamTimetableWarning[];
  readonly slots: readonly ExamTimetableSlot[];
  readonly waves: readonly ExamTimetableWave[];
  readonly blockEndTime: string | null;
  readonly waveCount: number;
}

// ===========================================================================
// Helpers
// ===========================================================================

/** Minutes in one calendar day. 1440 is 24:00, unrepresentable as `HH:MM`. */
const MINUTES_PER_DAY = 1440;

/** A finite integer strictly greater than zero. */
function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/** A finite integer greater than or equal to zero. */
function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** A finite integer of any sign. */
function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

/** A non-empty, trimmed identifier string; otherwise absent. */
function isPresentId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Render minutes-since-midnight as zero-padded `HH:MM`. Callers guarantee
 * `0 <= totalMinutes < MINUTES_PER_DAY`, which the midnight rule enforces. */
function formatHHMM(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function makeIssue(
  code: ExamTimetableIssueCode,
  details: readonly string[] = [],
): ExamTimetableIssue {
  return Object.freeze({
    code,
    message: EXAM_TIMETABLE_ISSUE_MESSAGES[code],
    details: Object.freeze([...details]),
  });
}

function makeWarning(
  code: ExamTimetableWarningCode,
  details: readonly string[] = [],
): ExamTimetableWarning {
  return Object.freeze({
    code,
    message: EXAM_TIMETABLE_WARNING_MESSAGES[code],
    details: Object.freeze([...details]),
  });
}

/** The frozen empty result carrying `issues`. Never a partial timetable. */
function failed(issues: readonly ExamTimetableIssue[]): ExamBlockTimetable {
  return Object.freeze({
    ok: false,
    issues: Object.freeze([...issues]),
    warnings: Object.freeze([] as ExamTimetableWarning[]),
    slots: Object.freeze([] as ExamTimetableSlot[]),
    waves: Object.freeze([] as ExamTimetableWave[]),
    blockEndTime: null,
    waveCount: 0,
  });
}

// ===========================================================================
// The timetable
// ===========================================================================

/**
 * Derive the individual timetable of one exam block.
 *
 * ISSUE ORDER (stable, and asserted by the tests):
 *   1. EX-CALC-INVALID-START
 *   2. EX-CALC-INVALID-DURATION
 *   3. EX-CALC-INVALID-CAPACITY
 *   4. EX-CALC-INVALID-ORDER       — one per offending examinee, input order
 *   5. EX-CALC-DUPLICATE-EXAMINEE  — one per duplicated id, first-detection order
 *   6. EX-CALC-INVALID-BREAK       — one per offending break, input order
 *   7. EX-CALC-MIDNIGHT            — computed, so only ever returned alone
 *
 * WARNING ORDER (stable): `EX-CALC-EMPTY-BLOCK` first (at most one, block
 * level), then `EX-CALC-BREAK-ORPHAN` in the input order of `breaks`.
 *
 * Never throws. Never mutates the input. The result is deeply frozen; the
 * caller's own objects are left exactly as they were.
 */
export function computeExamBlockTimetable(
  input: ExamBlockTimetableInput,
): ExamBlockTimetable {
  const issues: ExamTimetableIssue[] = [];

  // --- 1. block start ------------------------------------------------------
  const startMinutes = parseHHMM(input.blockStartTime);
  if (startMinutes === null) issues.push(makeIssue("EX-CALC-INVALID-START"));

  // --- 2/3. duration and capacity -----------------------------------------
  if (!isPositiveInteger(input.durationMinutes)) {
    issues.push(makeIssue("EX-CALC-INVALID-DURATION"));
  }
  if (!isPositiveInteger(input.parallelCapacity)) {
    issues.push(makeIssue("EX-CALC-INVALID-CAPACITY"));
  }

  // --- 4/5. examinees ------------------------------------------------------
  // A blank or non-string assignmentId is reported as EX-CALC-INVALID-ORDER
  // rather than ignored: the assignmentId IS the ordering tie-break, so without
  // it the sort is not deterministic and no stable timetable exists.
  const examinees = Array.isArray(input.examinees) ? input.examinees : [];
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const examinee of examinees) {
    const idPresent = isPresentId(examinee?.assignmentId);
    if (!idPresent || !isInteger(examinee?.orderIndex)) {
      issues.push(
        makeIssue("EX-CALC-INVALID-ORDER", idPresent ? [examinee.assignmentId] : []),
      );
      continue;
    }
    if (seen.has(examinee.assignmentId)) {
      if (!duplicated.has(examinee.assignmentId)) {
        duplicated.add(examinee.assignmentId);
        issues.push(makeIssue("EX-CALC-DUPLICATE-EXAMINEE", [examinee.assignmentId]));
      }
      continue;
    }
    seen.add(examinee.assignmentId);
  }

  // --- 6. breaks -----------------------------------------------------------
  const breaks = Array.isArray(input.breaks) ? input.breaks : [];
  for (const bre of breaks) {
    if (
      !isPresentId(bre?.breakId) ||
      !isNonNegativeInteger(bre?.afterWaveIndex) ||
      !isNonNegativeInteger(bre?.durationMinutes)
    ) {
      issues.push(
        makeIssue("EX-CALC-INVALID-BREAK", isPresentId(bre?.breakId) ? [bre.breakId] : []),
      );
    }
  }

  if (issues.length > 0) return failed(issues);

  // Every field is validated from here on, so the narrowing casts below are
  // facts rather than assumptions.
  const blockStart = startMinutes as number;
  const duration = input.durationMinutes;
  const capacity = input.parallelCapacity;

  // --- ordering ------------------------------------------------------------
  // A COPY is sorted: the caller's array is never reordered.
  const ordered = [...examinees].sort(
    (a, b) =>
      a.orderIndex - b.orderIndex ||
      (a.assignmentId < b.assignmentId ? -1 : a.assignmentId > b.assignmentId ? 1 : 0),
  );

  const warnings: ExamTimetableWarning[] = [];

  // --- the empty draft -----------------------------------------------------
  // Zero examinees is a legitimate placed-but-unfilled block, not an error. It
  // has no waves and therefore no end time, and every break in it is orphaned.
  const waveCount = Math.ceil(ordered.length / capacity);
  if (waveCount === 0) warnings.push(makeWarning("EX-CALC-EMPTY-BLOCK"));

  // --- break offsets -------------------------------------------------------
  // Breaks declared after the final usable wave shift nothing. They are
  // REPORTED rather than silently dropped: a break that vanishes when a trainee
  // is removed, with no message, is the worst failure mode this core has.
  const breakMinutesAfterWave = new Map<number, number>();
  for (const bre of breaks) {
    if (bre.afterWaveIndex >= waveCount - 1) {
      warnings.push(makeWarning("EX-CALC-BREAK-ORPHAN", [bre.breakId]));
      continue;
    }
    // Two breaks sharing one index SUM. That state is impossible under the
    // planned @@unique([sessionId, afterWaveIndex]), but this core is total
    // over its inputs and must not depend on a constraint it cannot see.
    breakMinutesAfterWave.set(
      bre.afterWaveIndex,
      (breakMinutesAfterWave.get(bre.afterWaveIndex) ?? 0) + bre.durationMinutes,
    );
  }

  // --- waves and slots -----------------------------------------------------
  const slots: ExamTimetableSlot[] = [];
  const waves: ExamTimetableWave[] = [];
  let offset = 0;

  for (let waveIndex = 0; waveIndex < waveCount; waveIndex += 1) {
    if (waveIndex > 0) {
      offset += duration + (breakMinutesAfterWave.get(waveIndex - 1) ?? 0);
    }
    const waveStart = blockStart + offset;
    const waveEnd = waveStart + duration;

    // The midnight rule. Checked per wave so a break-induced crossing is caught
    // exactly like a duration-induced one.
    if (waveEnd >= MINUTES_PER_DAY) return failed([makeIssue("EX-CALC-MIDNIGHT")]);

    const startTime = formatHHMM(waveStart);
    const endTime = formatHHMM(waveEnd);

    // The final wave is legitimately incomplete: it is never padded and its
    // shortness changes no time.
    const members = ordered.slice(waveIndex * capacity, waveIndex * capacity + capacity);
    const assignmentIds: string[] = [];
    for (let position = 0; position < members.length; position += 1) {
      const member = members[position];
      assignmentIds.push(member.assignmentId);
      slots.push(
        Object.freeze({
          assignmentId: member.assignmentId,
          waveIndex,
          positionInWave: position,
          startTime,
          endTime,
        }),
      );
    }

    waves.push(
      Object.freeze({
        waveIndex,
        startTime,
        endTime,
        assignmentIds: Object.freeze(assignmentIds),
      }),
    );
  }

  const lastWave = waves[waves.length - 1];

  return Object.freeze({
    ok: true,
    issues: Object.freeze([] as ExamTimetableIssue[]),
    warnings: Object.freeze(warnings),
    slots: Object.freeze(slots),
    waves: Object.freeze(waves),
    blockEndTime: lastWave === undefined ? null : lastWave.endTime,
    waveCount,
  });
}

// ===========================================================================
// Instructed-trainee slot inheritance
// ===========================================================================

/** One EXAMINEE, for pairing resolution only. */
export interface TimetablePairedExaminee {
  readonly assignmentId: string;
  readonly pairingIndex: number | null;
}

/** One INSTRUCTED_TRAINEE seeking the slot of the examinee it is paired with. */
export interface TimetableInstructedTrainee {
  readonly assignmentId: string;
  readonly pairingIndex: number | null;
}

/**
 * WHO IS PAIRED WITH WHOM in one block — the pairing question on its own,
 * separated from the slot-inheritance answer that consumes it.
 *
 * Both directions are derived from the SAME per-trainee resolution, so they
 * cannot disagree: `instructedTraineesOfExaminee` is literally the inverse of
 * `examineeOfInstructedTrainee`, never a second walk of the pairing indexes.
 *
 * Only the ASSIGNMENT IDS appear here. A pairing is a relationship between two
 * assignment rows; a student id, a name, a horse, a topic or a time is the
 * caller's business and is never resolved by this core.
 */
export interface ExamBlockPairing {
  /** instructed-trainee `assignmentId` → its paired EXAMINEE `assignmentId`. */
  readonly examineeOfInstructedTrainee: ReadonlyMap<string, string>;
  /**
   * examinee `assignmentId` → the paired INSTRUCTED_TRAINEE `assignmentId`s,
   * in the input order of `instructed`. An examinee with no paired trainee has
   * NO entry rather than an empty one.
   */
  readonly instructedTraineesOfExaminee: ReadonlyMap<string, readonly string[]>;
}

/** The examinee side of the pairing question, indexed once per block. */
interface ExamineePairingIndex {
  readonly byPairingIndex: ReadonlyMap<number, string>;
  readonly ambiguous: ReadonlySet<number>;
  /** The block's ONLY examinee, when it has exactly one. Otherwise `null`. */
  readonly soleExamineeAssignmentId: string | null;
}

/**
 * Index the examinees by `pairingIndex`, recording every index that identifies
 * MORE THAN ONE of them.
 *
 * A pairing index shared by two examinees identifies no single examinee, so it
 * is recorded as ambiguous and resolves NOTHING — the first row is never
 * silently preferred.
 */
function indexExamineePairings(
  examinees: readonly TimetablePairedExaminee[],
): ExamineePairingIndex {
  const byPairingIndex = new Map<number, string>();
  const ambiguous = new Set<number>();
  const list = Array.isArray(examinees) ? examinees : [];
  for (const examinee of list) {
    if (!isPresentId(examinee?.assignmentId) || !isInteger(examinee?.pairingIndex)) continue;
    const pairing = examinee.pairingIndex as number;
    if (byPairingIndex.has(pairing)) ambiguous.add(pairing);
    else byPairingIndex.set(pairing, examinee.assignmentId);
  }
  return {
    byPairingIndex,
    ambiguous,
    soleExamineeAssignmentId:
      list.length === 1 && isPresentId(list[0]?.assignmentId) ? list[0].assignmentId : null,
  };
}

/**
 * The EXAMINEE one instructed trainee is paired with, or `null`.
 *
 * THE ONE PLACE the pairing rule is expressed:
 *   1. a stated `pairingIndex` matching EXACTLY ONE examinee resolves to it;
 *   2. NO stated pairing, in a block holding exactly one examinee, resolves to
 *      that examinee — the only unambiguous fallback;
 *   3. anything else resolves to nothing.
 *
 * Case 3 deliberately includes a trainee whose `pairingIndex` matches no
 * examinee, or matches several, EVEN when the block holds exactly one examinee:
 * a stated-but-unmatched pairing is a mis-pairing to be surfaced, not an
 * invitation to guess. Nothing is ever resolved by name or by array position.
 */
function pairedExamineeOf(
  index: ExamineePairingIndex,
  trainee: TimetableInstructedTrainee,
): string | null {
  if (!isInteger(trainee?.pairingIndex)) return index.soleExamineeAssignmentId;
  const pairing = trainee.pairingIndex as number;
  if (index.ambiguous.has(pairing)) return null;
  return index.byPairingIndex.get(pairing) ?? null;
}

/**
 * Resolve the pairing of one block, in BOTH directions.
 *
 * TIMETABLE-FREE ON PURPOSE. Pairing is a property of the assignment rows and
 * of nothing else, so it is answerable for an UNRESOLVED block too — which is
 * exactly what an operational reader needs, since such a block still has real
 * pairs even though nobody in it has an exact personal time.
 *
 * A duplicated instructed-trainee `assignmentId` resolves ONCE, first entry
 * wins, so the result stays deterministic for malformed input. Never throws,
 * never mutates its inputs; the returned maps and arrays are frozen values that
 * the caller may read but must not extend.
 */
export function resolveExamPairings(
  examinees: readonly TimetablePairedExaminee[],
  instructed: readonly TimetableInstructedTrainee[],
): ExamBlockPairing {
  const index = indexExamineePairings(examinees);
  const instructedList = Array.isArray(instructed) ? instructed : [];

  const examineeOfInstructedTrainee = new Map<string, string>();
  const instructedTraineesOfExaminee = new Map<string, string[]>();
  for (const trainee of instructedList) {
    if (!isPresentId(trainee?.assignmentId)) continue;
    if (examineeOfInstructedTrainee.has(trainee.assignmentId)) continue;
    const examineeAssignmentId = pairedExamineeOf(index, trainee);
    if (examineeAssignmentId === null) continue;
    examineeOfInstructedTrainee.set(trainee.assignmentId, examineeAssignmentId);
    const partners = instructedTraineesOfExaminee.get(examineeAssignmentId);
    if (partners === undefined) {
      instructedTraineesOfExaminee.set(examineeAssignmentId, [trainee.assignmentId]);
    } else {
      partners.push(trainee.assignmentId);
    }
  }

  const inverse = new Map<string, readonly string[]>();
  for (const [examineeAssignmentId, partners] of instructedTraineesOfExaminee) {
    inverse.set(examineeAssignmentId, Object.freeze([...partners]));
  }

  return Object.freeze({
    examineeOfInstructedTrainee: examineeOfInstructedTrainee as ReadonlyMap<string, string>,
    instructedTraineesOfExaminee: inverse as ReadonlyMap<string, readonly string[]>,
  });
}

/**
 * Resolve the slots INHERITED by instructed trainees.
 *
 * An instructed trainee never consumes a parallel lane and never appears in
 * `waves[].assignmentIds` — a lane is an examinee being examined, and the
 * instructed trainee is part of that examinee's exam rather than a second one.
 *
 * WHO a trainee inherits FROM is decided by {@link pairedExamineeOf} and by
 * nothing else, so this function and {@link resolveExamPairings} cannot drift:
 * they share one rule rather than restating it twice. What is added here is
 * only the SLOT lookup — and an unsuccessful timetable resolves nothing at all.
 *
 * Returns a deeply frozen array in the input order of `instructed`, containing
 * only the trainees that resolved.
 */
export function resolveInstructedTraineeSlots(
  timetable: ExamBlockTimetable,
  examinees: readonly TimetablePairedExaminee[],
  instructed: readonly TimetableInstructedTrainee[],
): readonly ExamTimetableSlot[] {
  const empty = Object.freeze([] as ExamTimetableSlot[]);
  if (!timetable.ok) return empty;

  const instructedList = Array.isArray(instructed) ? instructed : [];
  if (instructedList.length === 0) return empty;

  const slotByAssignmentId = new Map<string, ExamTimetableSlot>();
  for (const slot of timetable.slots) slotByAssignmentId.set(slot.assignmentId, slot);

  const index = indexExamineePairings(examinees);

  const resolved: ExamTimetableSlot[] = [];
  for (const trainee of instructedList) {
    if (!isPresentId(trainee?.assignmentId)) continue;

    const sourceAssignmentId = pairedExamineeOf(index, trainee);
    if (sourceAssignmentId === null) continue;

    const source = slotByAssignmentId.get(sourceAssignmentId);
    if (source === undefined) continue;

    resolved.push(
      Object.freeze({
        assignmentId: trainee.assignmentId,
        waveIndex: source.waveIndex,
        positionInWave: source.positionInWave,
        startTime: source.startTime,
        endTime: source.endTime,
      }),
    );
  }

  return Object.freeze(resolved);
}
