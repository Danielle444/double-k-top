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
 * another's to decide who belongs to whom. {@link selectSelfAssignmentRow}
 * likewise reads the SERVER-DERIVED `isSelf` boolean and nothing else, and
 * refuses to answer unless exactly one row carries it. No display name is ever
 * compared for identity anywhere in this file.
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
 * The EARLIEST date in a list, or `null` when there is none.
 *
 * `YYYY-MM-DD` is fixed-width and zero-padded, so plain string comparison is
 * chronological: no `Date` is constructed, no timezone is consulted and no
 * calendar arithmetic happens here — exactly as in the committed exam cores.
 *
 * It is TOTAL. A blank, whitespace-only or non-string entry contributes nothing
 * rather than becoming "the earliest", so a malformed token can never be chosen
 * as a default selection.
 */
export function earliestExamDate(
  dates: readonly string[] | null | undefined,
): string | null {
  let earliest: string | null = null;
  for (const date of asArray(dates)) {
    if (!isPresent(date)) continue;
    if (earliest === null || date < earliest) earliest = date;
  }
  return earliest;
}

/**
 * The minimum a row must carry to be placed on a clock. Structural on purpose,
 * exactly like {@link ExamNavigableRow}: the trainee row and the operational row
 * both satisfy it.
 */
export interface ExamTimedRow {
  readonly startTime: string;
}

/**
 * A sortable key for one `HH:MM` block start.
 *
 * A legible zero-padded time sorts as itself. Anything else — absent, blank,
 * malformed, not a string — sorts LAST under a token no real time can reach, so
 * a defective row is never silently promoted to the top of a schedule and is
 * never dropped either.
 */
function startTimeKey(value: unknown): string {
  return typeof value === "string" && /^\d{2}:\d{2}$/.test(value) ? value : "99:99";
}

/**
 * The rows of ONE day, ordered by block start ascending.
 *
 * ===========================================================================
 * IT AGREES WITH THE SERVER — IT DOES NOT SECOND-GUESS IT
 * ===========================================================================
 * The read pipeline already emits each date's rows in the locked order
 * `startTime`, `orderIndex`, `sessionId`. This is a STABLE sort on the first of
 * those three keys alone, so on a contract that already arrives ordered it is a
 * NO-OP, and on any contract it preserves the server's own order for every pair
 * of rows that share a start time. It therefore cannot invent a second,
 * disagreeing schedule: `orderIndex` and `sessionId` are never read here, and
 * re-deriving them in a browser is exactly what would create one.
 *
 * It performs NO timetable arithmetic and NO pairing: it compares two `HH:MM`
 * strings and nothing else. Live beginner rows and stored blocks are ordered by
 * the same one rule, which is what interleaves them chronologically.
 */
export function sortExamRowsByStartTime<T extends ExamTimedRow>(
  rows: readonly T[] | null | undefined,
): readonly T[] {
  const out = asArray(rows).filter((row): row is T => row !== null && row !== undefined);
  // Array.prototype.sort is stable, which is what makes the tie-break "the order
  // the contract already had" rather than a second rule stated here.
  return [...out].sort((a, b) => {
    const left = startTimeKey(a.startTime);
    const right = startTimeKey(b.startTime);
    return left < right ? -1 : left > right ? 1 : 0;
  });
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
// The viewer's OWN assignment — the server said which one it is
// ===========================================================================

/**
 * ONE participant of a stored block as the TRAINEE contract carries them: the
 * shared operational row PLUS the server's own answer to "is this me".
 *
 * `isSelf` is decided server-side by EXACT STUDENT-ID EQUALITY, against the
 * identity proven from the signed session, and the id itself never leaves the
 * server. It is present on the trainee contract ONLY — the instructor and admin
 * contracts do not carry it, which is why this is a separate type rather than a
 * widening of {@link ExamAssignmentRowView}.
 */
export interface TraineeExamAssignmentRowView extends ExamAssignmentRowView {
  /** The SERVER's answer, never the browser's guess. */
  readonly isSelf: boolean;
}

/**
 * The ONE assignment row the SERVER marked as the viewer's, or `null`.
 *
 * ===========================================================================
 * IT DECIDES NOTHING — IT READS ONE BOOLEAN
 * ===========================================================================
 * This replaces an earlier browser-side heuristic that matched the viewer's row
 * by `selfRole` + the exact personal start and end. That heuristic was safe but
 * INCOMPLETE: two examinees riding in parallel share a personal window, so it
 * could not tell them apart and gave up, and "לו״ז שלי" lost the horse, topic
 * and discipline for exactly the trainees most likely to be confused about them.
 *
 * The read layer now answers the question itself. So the ONLY input here is
 * `isSelf`, and nothing else in the row may be consulted to identify the viewer:
 * not the display name, not the role, not the personal times, not the horse, the
 * topic, the discipline, the pairing, or the position in the array. Every one of
 * those is something this function READS OUT of the row it was given — never
 * something it uses to choose that row.
 *
 * ===========================================================================
 * FAIL CLOSED AT BOTH ENDS
 * ===========================================================================
 * - NO row marked `isSelf` → `null`. The viewer is not in this block, or the
 *   read layer could not prove they are; either way there is nothing to show.
 * - MORE THAN ONE row marked `isSelf` → `null`. That is a contradiction the
 *   client cannot resolve and must not paper over: showing the first would show
 *   a rider a horse that might be someone else's. A missing detail is a gap;
 *   a guessed one is a wrong schedule.
 *
 * NO NAME IS COMPARED, and no viewer identity is an input: the viewer's name and
 * id are not parameters and are not representable in this signature.
 */
export function selectSelfAssignmentRow(
  rows: readonly TraineeExamAssignmentRowView[] | null | undefined,
): TraineeExamAssignmentRowView | null {
  const matches = asArray(rows).filter(
    (row) => row !== null && row !== undefined && row.isSelf === true,
  );
  return matches.length === 1 ? matches[0] : null;
}

// ===========================================================================
// Live beginner rows — a SECOND kind of row, never a second kind of examinee
// ===========================================================================

/**
 * Where ONE visible row came from.
 *
 * `STORED` is an `ExamSession` an admin built. `BEGINNER` is a LIVE projection
 * of a Teaching-Practice lesson: it has no stored exam assignment, no exam
 * definition and no timetable, and its people are not examinees. Declared here
 * as a local union for the same reason every other type in this file is —
 * so no client component reaches into the exam read pipeline's modules — and
 * TypeScript still checks it agrees with the contract at every call site.
 */
export type ExamRowSourceView = "STORED" | "BEGINNER";

/** The three live Teaching-Practice formats a beginner row can carry. */
export type ExamBeginnerFormatView = "LUNGE" | "BEGINNER_PRIVATE" | "BEGINNER_GROUP";

/**
 * The Hebrew label for each format, EXHAUSTIVE over the union above, so adding a
 * format without adding its label is a compile error rather than a blank on a
 * schedule. The wording matches the committed exam label map.
 */
export const EXAM_BEGINNER_FORMAT_VIEW_LABELS: Readonly<
  Record<ExamBeginnerFormatView, string>
> = Object.freeze({
  LUNGE: "לונג",
  BEGINNER_PRIVATE: "מתחילים פרטני",
  BEGINNER_GROUP: "מתחילים קבוצתי",
});

/**
 * The Hebrew label for a format, or `null` for anything outside the union.
 *
 * FAIL-OPEN ON THE LABEL, NEVER ON THE DATA: an unrecognised token yields no
 * label, and the caller shows the raw value it was given instead of hiding the
 * row. A beginner lesson whose format nobody anticipated must still appear on a
 * schedule.
 */
export function examBeginnerFormatLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return Object.prototype.hasOwnProperty.call(EXAM_BEGINNER_FORMAT_VIEW_LABELS, value)
    ? EXAM_BEGINNER_FORMAT_VIEW_LABELS[value as ExamBeginnerFormatView]
    : null;
}

/**
 * ONE child of a live beginner lesson, as the schedules display them.
 *
 * Child and parent-contact detail is available to EVERY authorized exam-access
 * role, trainees included — that is the committed product decision taken in the
 * read layer, and this file neither re-opens it nor narrows it further. The gate
 * is WHICH ROWS a role is handed, not which fields, so nothing here drops a
 * value the contract chose to carry.
 *
 * `parentPhone` stays VERBATIM: it is not normalized, reformatted, masked or
 * turned into a dial/WhatsApp target anywhere in this file or its renderer.
 */
export interface ExamBeginnerChildView {
  /**
   * The POSITIONAL display key the read layer assigns — `c0`, `c1`, … in the
   * committed source order.
   *
   * It is deliberately NOT `childAssignmentId`. That is a database primary key
   * and a write target; a renderer needs a stable key, not an identity, and the
   * trainee contract no longer carries the id at all. Nothing in this file may
   * read an id in its place.
   */
  readonly childKey: string;
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
 * ONE live beginner lesson's detail, as BOTH schedules display it.
 *
 * The first block of fields is the TRAINEE contract, verbatim. The three
 * optional fields below it exist only on the ADMIN/INSTRUCTOR contract; a
 * trainee row simply does not carry them, and the renderer additionally refuses
 * to show them unless a caller explicitly asks for the operational view — two
 * independent reasons a trainee can never be shown lesson notes or lesson
 * publication state.
 *
 * There is deliberately NO date and NO time here. A beginner row's day and block
 * window are the ROW's, they are already printed once by the card that owns it,
 * and a second copy inside the detail is how two disagreeing times end up on one
 * screen.
 */
export interface ExamBeginnerDetailView {
  /**
   * TRAINEE contract only — the SERVER's answer to "is this lesson mine".
   *
   * Optional because the admin/instructor contract does not carry it: an
   * operational role has no single viewer to be relevant to. It is read, never
   * computed: this file holds no viewer identity to compare against and no
   * display name is consulted anywhere in it.
   */
  readonly isSelfRelevant?: boolean;
  readonly beginnerFormat: ExamBeginnerFormatView;
  readonly groupName: string | null;
  readonly location: string | null;
  readonly responsibleInstructorName: string | null;
  /** Resolved display names of the PROJECTED participants, in source order. */
  readonly participantNames: readonly string[];
  /** The AUTHORITATIVE projected-participant count. May exceed the names. */
  readonly participantCount: number;
  readonly children: readonly ExamBeginnerChildView[];
  /** ADMIN/INSTRUCTOR only — the raw Teaching-Practice token, verbatim. */
  readonly practiceType?: string;
  /** ADMIN/INSTRUCTOR only — the LESSON's own notes. */
  readonly notes?: string | null;
  /** ADMIN/INSTRUCTOR only — the LESSON's publication flag. */
  readonly isPublished?: boolean;
}

/**
 * The minimum a row must carry for its ORIGIN to be read. Structural, like every
 * other row shape in this file.
 */
export interface ExamSourcedRow {
  readonly source: ExamRowSourceView;
}

/**
 * Is this a LIVE beginner row?
 *
 * Decided by the contract's own `source` field and nothing else. It is never
 * inferred from an empty assignment list, from a missing definition name, from a
 * missing timetable or from the presence of beginner detail: every one of those
 * is also true of some stored block, and guessing would put a Teaching-Practice
 * banner on a real exam.
 */
export function isBeginnerExamRow(row: ExamSourcedRow | null | undefined): boolean {
  return row !== null && row !== undefined && row.source === "BEGINNER";
}

/** How many of these rows are live beginner rows. */
export function countBeginnerRows(
  rows: readonly ExamSourcedRow[] | null | undefined,
): number {
  let total = 0;
  for (const row of asArray(rows)) {
    if (isBeginnerExamRow(row)) total += 1;
  }
  return total;
}

/**
 * The two failures that look identical on screen, told apart.
 *
 * - `NO_BEGINNER_ROWS_RETURNED` — the server sent none. The screen is right; the
 *   question is upstream (the plan carries no Teaching-Practice source date, the
 *   course is not Level 1, the lessons are not published, the day has none).
 * - `BEGINNER_ROWS_NOT_RENDERED` — the server DID send them and the view put
 *   none of them on screen. That is a UI defect, and it is the one this slice
 *   exists to make impossible to mistake for the case above.
 * - `BEGINNER_ROWS_RENDERED` — at least one arrived and at least one is shown.
 */
export type BeginnerRenderingVerdict =
  | "NO_BEGINNER_ROWS_RETURNED"
  | "BEGINNER_ROWS_NOT_RENDERED"
  | "BEGINNER_ROWS_RENDERED";

/**
 * The counts BOTH survive the verdict, so a PARTIAL drop — some rows loaded,
 * fewer rendered — is visible as two unequal numbers rather than being rounded
 * off into a reassuring verdict.
 */
export interface BeginnerRenderingSummary {
  readonly loadedBeginnerCount: number;
  readonly renderedBeginnerCount: number;
  readonly verdict: BeginnerRenderingVerdict;
}

/**
 * Diagnose a screen showing no beginner entries.
 *
 * PURE, and deliberately NOT wired into either screen's output: a user-facing
 * schedule carries no diagnostics, which is a locked property of both exam
 * screens. This is the shape their tests assert against, so "the action returned
 * nothing" and "the UI dropped it" can never again be the same observation.
 *
 * @param loadedRows   the rows the server actually returned.
 * @param renderedRows the rows the view actually put on screen.
 */
export function summarizeBeginnerRendering(
  loadedRows: readonly ExamSourcedRow[] | null | undefined,
  renderedRows: readonly ExamSourcedRow[] | null | undefined,
): BeginnerRenderingSummary {
  const loadedBeginnerCount = countBeginnerRows(loadedRows);
  const renderedBeginnerCount = countBeginnerRows(renderedRows);
  const verdict: BeginnerRenderingVerdict =
    loadedBeginnerCount === 0
      ? "NO_BEGINNER_ROWS_RETURNED"
      : renderedBeginnerCount === 0
        ? "BEGINNER_ROWS_NOT_RENDERED"
        : "BEGINNER_ROWS_RENDERED";
  return Object.freeze({ loadedBeginnerCount, renderedBeginnerCount, verdict });
}
