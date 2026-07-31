/**
 * EX-ROLE-SCHEDULE-REDESIGN — the PURE view core behind the exam schedule
 * screens.
 *
 * PURE by construction: no imports at all, no React, no Prisma, no Next, no
 * clock, no randomness, no env, no IO. Every function below is total and takes
 * everything it needs as an argument, so the whole file is testable in a plain
 * `tsx --test` process with no DOM and no database.
 *
 * ===========================================================================
 * WHY IT EXISTS
 * ===========================================================================
 * The exam read pipeline hands the UI ONE FLAT ARRAY of assignment rows per
 * block — one row per stored database row, examinees and instructed trainees
 * side by side as equals. That is the right SHAPE for a contract and the wrong
 * shape for a schedule: rendered literally it prints the same lesson twice (once
 * from the examinee's row, once from the instructed trainee's), repeats the same
 * time on every card, and leaves a reader to work out by eye which trainee is
 * being taught by which examinee.
 *
 * This module turns that array into the OPERATIONAL shape a rider actually
 * reads — waves of parallel work, each holding examinee units with their
 * instructed trainee nested inside — WITHOUT deciding anything the read layer
 * already decided. It performs no pairing rule, no timetable arithmetic and no
 * sort. It groups, it nests, and it filters on values it is handed.
 *
 * ===========================================================================
 * IT NEVER INFERS IDENTITY FROM A NAME
 * ===========================================================================
 * Nesting is driven by `pairedParticipantNames`, which the committed read layer
 * RESOLVED server-side from the stored pairing — this module reads that list, it
 * does not reconstruct it, and it never compares one participant's name with
 * another's to decide who belongs to whom. {@link selectSelfAssignmentDetail}
 * likewise matches on the SERVER-DERIVED self markers (role and the exact
 * personal window) and refuses to answer when they do not identify exactly one
 * row. No display name is ever compared for identity anywhere in this file.
 */

/**
 * ONE participant of one stored exam block, as the exam screens need them.
 *
 * Structurally identical to the read layer's shared assignment contract, and
 * declared here rather than imported so no client component reaches into the
 * exam read pipeline's modules. TypeScript still checks the two agree at every
 * call site: a caller passes its own rows straight in, so a rename or a type
 * change upstream fails the build rather than silently blanking the screen.
 *
 * It is an EXPLICIT field list, not the upstream DTO: a field added upstream
 * cannot start flowing through this core — or onto a screen — by itself.
 */
export interface ExamAssignmentRowView {
  /** The resolved display name, or `null` when it could not be resolved. */
  readonly participantName: string | null;
  readonly role: "EXAMINEE" | "INSTRUCTED_TRAINEE";
  /** The examinee's horse. Always `null` on an instructed-trainee row. */
  readonly horseName: string | null;
  readonly instructionTopic: string | null;
  readonly discipline: string | null;
  /** The participant's EXACT personal start. Never the block start. */
  readonly personalStartTime: string | null;
  /** The participant's EXACT personal end. Never the block end. */
  readonly personalEndTime: string | null;
  /** Every resolved partner, in the resolved pairing order. */
  readonly pairedParticipantNames: readonly string[];
}

/**
 * ONE examinee, together with the instructed trainee they teach.
 *
 * The relationship is one-to-one in practice, and the nested list is carried as
 * a LIST anyway because that is exactly what the read layer resolved: a block
 * that somehow pairs two trainees with one examinee must show both rather than
 * silently drop one, and a block that pairs none shows none.
 */
export interface ExamExamineeUnitView {
  readonly examinee: ExamAssignmentRowView;
  /** The RESOLVED names of the instructed trainees this examinee teaches. */
  readonly instructedTraineeNames: readonly string[];
}

/**
 * ONE wave: every unit that happens in the SAME personal window.
 *
 * `startTime`/`endTime` are the window the wave is grouped by, and they are the
 * only place it is stated — a unit inside a wave carries no time of its own, so
 * two parallel examinees cannot print the same time twice.
 *
 * BOTH ends are `null` for a wave whose window is not fully known. Such a wave
 * is never merged with another (see {@link groupExamAssignmentsIntoWaves}).
 */
export interface ExamWaveView {
  readonly startTime: string | null;
  readonly endTime: string | null;
  readonly units: readonly ExamExamineeUnitView[];
  /**
   * Instructed-trainee rows the read layer paired with NOBODY.
   *
   * They are carried separately rather than dropped: a paired instructed
   * trainee is already visible nested under their examinee, but an unpaired one
   * is in nobody's unit, and silently omitting them would erase a real person
   * from a real schedule. They are the only case in which an instructed trainee
   * appears outside an examinee unit.
   */
  readonly unpairedInstructedRows: readonly ExamAssignmentRowView[];
}

/** True iff the value is a usable display/lookup string. */
function isPresent(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Defensive: a possibly-absent array read as an array, never `undefined`. */
function asArray<T>(value: readonly T[] | null | undefined): readonly T[] {
  return Array.isArray(value) ? value : [];
}

/**
 * The grouping key of one row's personal window, or `null` when it has none.
 *
 * BOTH ends are required. A half-known window ("09:00" with no end) is NOT a
 * window two people can be said to share, so it yields `null` and its row is
 * never merged with anyone. This mirrors the renderer's own rule that a
 * half-known window is shown as "not yet set" rather than as a decided time.
 */
function windowKey(row: ExamAssignmentRowView): string | null {
  if (!isPresent(row.personalStartTime)) return null;
  if (!isPresent(row.personalEndTime)) return null;
  return `${row.personalStartTime}|${row.personalEndTime}`;
}

interface MutableWave {
  startTime: string | null;
  endTime: string | null;
  units: ExamExamineeUnitView[];
  unpairedInstructedRows: ExamAssignmentRowView[];
}

/**
 * Turn ONE block's flat assignment rows into waves of examinee units.
 *
 * ===========================================================================
 * THE THREE RULES, AND NOTHING ELSE
 * ===========================================================================
 * 1. An EXAMINEE row becomes a UNIT. Its nested instructed trainees are its own
 *    `pairedParticipantNames`, verbatim and in the resolved order.
 *
 * 2. An INSTRUCTED_TRAINEE row that carries a pairing is DROPPED, because it is
 *    already rendered inside its examinee's unit — that is the whole point of
 *    the redesign, and it is decided by the row's OWN pairing field, never by
 *    matching its name against an examinee's nested list. One that carries NO
 *    pairing is kept in {@link ExamWaveView.unpairedInstructedRows}, so an
 *    unpaired person is never erased.
 *
 * 3. Rows sharing an identical, fully-known personal window land in the SAME
 *    wave. A row with no such window gets a wave of its own.
 *
 * ===========================================================================
 * IT DOES NOT SORT
 * ===========================================================================
 * Waves appear in the order their FIRST row appeared, and units appear in the
 * order their rows appeared. The contract's order already IS the operational
 * order; re-sorting it would invent a second, disagreeing schedule out of
 * presentation code. Grouping a later parallel row into an earlier wave is the
 * one and only re-arrangement performed, and it is what "parallel" means.
 */
export function groupExamAssignmentsIntoWaves(
  rows: readonly ExamAssignmentRowView[] | null | undefined,
): readonly ExamWaveView[] {
  const waves: MutableWave[] = [];
  const byKey = new Map<string, MutableWave>();

  for (const row of asArray(rows)) {
    if (row === null || row === undefined) continue;

    const key = windowKey(row);
    let wave: MutableWave;
    if (key === null) {
      // No shared window: its own wave, and never registered as a merge target.
      wave = { startTime: null, endTime: null, units: [], unpairedInstructedRows: [] };
      waves.push(wave);
    } else {
      const existing = byKey.get(key);
      if (existing === undefined) {
        wave = {
          startTime: row.personalStartTime,
          endTime: row.personalEndTime,
          units: [],
          unpairedInstructedRows: [],
        };
        waves.push(wave);
        byKey.set(key, wave);
      } else {
        wave = existing;
      }
    }

    if (row.role === "EXAMINEE") {
      wave.units.push({
        examinee: row,
        instructedTraineeNames: asArray(row.pairedParticipantNames).filter(isPresent),
      });
      continue;
    }

    // An instructed trainee. Paired ones are already nested under their
    // examinee; only the unpaired remainder is carried.
    if (asArray(row.pairedParticipantNames).filter(isPresent).length === 0) {
      wave.unpairedInstructedRows.push(row);
    }
  }

  // Drop waves that ended up holding nothing at all — a paired instructed
  // trainee alone in its window contributes no visible content, and an empty
  // time heading would read as a wave with nobody in it.
  return waves.filter(
    (wave) => wave.units.length > 0 || wave.unpairedInstructedRows.length > 0,
  );
}

// ===========================================================================
// Navigation: exam type and date, over rows already in hand
// ===========================================================================

/**
 * The minimum a row must carry to be navigable. Structural on purpose: the
 * instructor contract's row and the trainee contract's row both satisfy it, so
 * one implementation serves both screens without either importing the other's
 * type.
 */
export interface ExamNavigableRow {
  readonly date: string;
  readonly definitionName: string | null;
}

/**
 * The distinct exam-type names present, in FIRST-APPEARANCE order.
 *
 * Rows with no definition name contribute nothing: an "unnamed exam" tab would
 * be a bucket the reader cannot act on, and the rows themselves are still
 * reachable through the general view.
 */
export function listExamDefinitionNames(
  rows: readonly ExamNavigableRow[] | null | undefined,
): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of asArray(rows)) {
    if (row === null || row === undefined) continue;
    if (!isPresent(row.definitionName)) continue;
    const name = row.definitionName;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/** The distinct dates present, in FIRST-APPEARANCE order. Never sorted. */
export function listExamDates(
  rows: readonly ExamNavigableRow[] | null | undefined,
): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of asArray(rows)) {
    if (row === null || row === undefined) continue;
    if (!isPresent(row.date)) continue;
    if (seen.has(row.date)) continue;
    seen.add(row.date);
    out.push(row.date);
  }
  return out;
}

/**
 * A navigation selection. `null` on either axis means "no constraint" — the
 * general view is simply both axes unconstrained, not a third code path.
 */
export interface ExamScheduleFilter {
  readonly definitionName: string | null;
  readonly date: string | null;
}

/**
 * The rows matching a selection, in the SAME order they arrived.
 *
 * This is a NARROWING of rows already loaded and already authorized. It can only
 * ever hide a row the server sent — it can neither widen a read nor reveal one
 * the server withheld, which is why the screens may switch views without
 * issuing a second request.
 */
export function filterExamRows<T extends ExamNavigableRow>(
  rows: readonly T[] | null | undefined,
  filter: ExamScheduleFilter,
): readonly T[] {
  const wanted = filter ?? { definitionName: null, date: null };
  return asArray(rows).filter((row) => {
    if (row === null || row === undefined) return false;
    if (isPresent(wanted.definitionName) && row.definitionName !== wanted.definitionName) {
      return false;
    }
    if (isPresent(wanted.date) && row.date !== wanted.date) return false;
    return true;
  });
}

// ===========================================================================
// The viewer's OWN assignment, found by the server-derived markers
// ===========================================================================

/**
 * The SERVER-DERIVED markers of the viewer's own place in a block.
 *
 * Every field comes from the trainee contract's `self*` values, which the
 * committed trainee core computed from the SIGNED SESSION. Nothing here is
 * derived in the browser, and there is deliberately no name field: a display
 * name is not an identity.
 */
export interface ExamSelfMarker {
  readonly role: "EXAMINEE" | "INSTRUCTED_TRAINEE" | null;
  readonly startTime: string | null;
  readonly endTime: string | null;
}

/**
 * The ONE assignment row that the viewer's own markers identify, or `null`.
 *
 * ===========================================================================
 * FAIL-CLOSED, AND DELIBERATELY SO
 * ===========================================================================
 * The trainee contract carries the viewer's role and exact personal window, but
 * no id — by design, because an id in a client contract is exactly what the read
 * layer refuses to add. This function therefore locates the viewer's row by
 * those markers and returns it ONLY when they identify it UNAMBIGUOUSLY:
 *
 * - any missing marker → `null`;
 * - no matching row → `null`;
 * - MORE THAN ONE matching row → `null`.
 *
 * The last case is the one that matters. Two examinees riding in parallel share
 * a personal window, so the markers alone cannot tell them apart — and showing
 * one of them would show a rider SOMEONE ELSE'S horse under the heading "yours".
 * Returning nothing is a missing detail; guessing is a wrong schedule.
 *
 * NO NAME IS COMPARED. The viewer's name is not an input and is not
 * representable in {@link ExamSelfMarker}.
 */
export function selectSelfAssignmentDetail(
  rows: readonly ExamAssignmentRowView[] | null | undefined,
  marker: ExamSelfMarker | null | undefined,
): ExamAssignmentRowView | null {
  if (marker === null || marker === undefined) return null;
  if (marker.role !== "EXAMINEE" && marker.role !== "INSTRUCTED_TRAINEE") return null;
  if (!isPresent(marker.startTime)) return null;
  if (!isPresent(marker.endTime)) return null;

  const matches = asArray(rows).filter(
    (row) =>
      row !== null &&
      row !== undefined &&
      row.role === marker.role &&
      row.personalStartTime === marker.startTime &&
      row.personalEndTime === marker.endTime,
  );
  return matches.length === 1 ? matches[0] : null;
}
