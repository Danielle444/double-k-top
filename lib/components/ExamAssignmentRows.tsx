"use client";

/**
 * EX-ROLE-SCHEDULE-REDESIGN — the ONE renderer for a stored exam block's
 * operational schedule.
 *
 * IT IS SHARED BY THE INSTRUCTOR AND THE TRAINEE SCREEN ON PURPOSE. The read
 * layer hands both roles the SAME assignment contract — what differs between
 * them is WHICH ROWS each is given (publication, the selected day, the resolved
 * course), and that is decided server-side long before this file is reached. Two
 * hand-written copies of this layout would be two places for the Hebrew labels,
 * the missing-value rules and the nesting to drift apart, and a drift here reads
 * to a rider as a different schedule. So there is exactly one copy.
 *
 * ===========================================================================
 * IT RENDERS OPERATIONAL REALITY, NOT ONE CARD PER DATABASE ROW
 * ===========================================================================
 * The contract is a FLAT array: one entry per stored assignment, examinees and
 * instructed trainees side by side as equals. Rendered literally that prints the
 * same lesson twice — once from the examinee's row and once from the trainee's —
 * repeats the same time on every card, and leaves the reader to work out who is
 * teaching whom. So the array is reshaped, by the pure sibling core, into what
 * actually happens on the ground:
 *
 *   ONE WAVE  (its time stated exactly ONCE)
 *     ├─ examinee unit — name, horse, topic, discipline, instructed trainee
 *     └─ examinee unit — the parallel one, side by side on a wide screen
 *
 * AN INSTRUCTED TRAINEE NEVER GETS A CARD OF THEIR OWN — IN EITHER STATE. When
 * they are PAIRED they are the person the examinee teaches, so they are rendered
 * INSIDE that examinee's unit. When the read layer paired them with NOBODY they
 * are rendered as a single compact WARNING LINE at the foot of their wave —
 * plain text, no card markup, no unit markup, no grid cell, no role chip and no
 * second visual block beside the examinee cards. They are not erased, because a
 * real person missing from a real schedule is worse than a visible gap; they are
 * simply never presented as a participant in their own right.
 *
 * ===========================================================================
 * IT CALCULATES NOTHING
 * ===========================================================================
 * There is no pairing rule, no timetable rule, no slot arithmetic, no duration,
 * no sort and no name comparison in this file. Every value below is rendered
 * EXACTLY as the committed cores decided it: the role, the horse, the inherited
 * topic and discipline, the exact personal window and the RESOLVED pairing
 * names. The waves themselves come from the pure core, which groups and nests
 * but never reorders.
 *
 * `pairedParticipantNames` is the ONLY pairing field read. The contract also
 * carries `pairedParticipantName`, the single-partner convenience, and it is
 * deliberately ignored: it is DERIVED from the list (it is the list's one entry,
 * or `null`), so reading both would let this file express a pairing the read
 * layer did not. The names are rendered as SEPARATE ELEMENTS and never joined
 * into one string, so nothing downstream could ever need to split them apart.
 *
 * ===========================================================================
 * PRIVACY: ONLY APPROVED DISPLAY VALUES ARE RENDERED
 * ===========================================================================
 * Rendered here: the participant's display name, the Hebrew role label, the
 * wave's exact personal start and end time, the horse name, the instruction
 * topic, the discipline and the resolved paired participants' display names.
 *
 * NOT rendered, and not even representable in the props below: any assignment,
 * student, session, definition, lesson, plan or course id, `pairingIndex`, any
 * national id, e-mail address, phone number, parent or contact detail, any note,
 * any grade and any feedback. The prop type is an EXPLICIT field list rather
 * than the read layer's own DTO, so a field added upstream cannot start
 * appearing on screen by itself, and there is no `JSON.stringify` and no generic
 * object renderer here through which one could leak.
 *
 * ===========================================================================
 * EXTENDING IT LATER
 * ===========================================================================
 * A block that carries no stored assignment renders NOTHING at all — a live
 * beginner row has none today, and a separately reviewed slice will hand this
 * screen beginner rows of its own. That slice adds its own read-only renderer
 * beside this one; nothing here needs to change to make room for it, and nothing
 * here stubs a beginner placeholder in the meantime.
 *
 * READ-ONLY BY CONSTRUCTION: no state, no effect, no event handler, no form, no
 * input, no button, no Server Action and no publication concept. It receives an
 * array and returns markup.
 */
import {
  groupExamAssignmentsIntoWaves,
  type ExamAssignmentRowView,
  type ExamExamineeUnitView,
  type ExamWaveView,
} from "./exam-schedule-view-core";

export type { ExamAssignmentRowView } from "./exam-schedule-view-core";

/** The approved Hebrew role labels. */
const ROLE_LABELS: Record<ExamAssignmentRowView["role"], string> = {
  EXAMINEE: "נבחן/ת",
  INSTRUCTED_TRAINEE: "חניך/ה מודרך/ת",
};

/** The label above the instructed trainee nested inside an examinee's unit. */
const INSTRUCTED_TRAINEE_LABEL = "חניכים מודרכים";

/**
 * The WARNING prefix for an instructed trainee the read layer paired with
 * nobody. It is a gap notice, never a participant heading — see {@link Wave}.
 */
const UNPAIRED_TRAINEE_LABEL = "חניך/ה מודרך/ת ללא שיוך";

/**
 * Shown INSTEAD of a name that the read layer could not resolve. It is neutral
 * text, never the id the lookup exists to remove and never an empty line that
 * would read as a person with no name.
 */
const UNNAMED_PARTICIPANT_TEXT = "שם לא זמין";

/**
 * Shown when a wave's window is not fully known. The block's own start and end
 * are NEVER substituted: a rider reading a time must be reading their own
 * assignment, not a layout convenience.
 */
const NO_PERSONAL_TIME_TEXT = "שעה אישית טרם נקבעה";

const HORSE_LABEL = "סוס";
const TOPIC_LABEL = "נושא";
const DISCIPLINE_LABEL = "תחום";

/**
 * The wave's window, or `null` when it is not fully known.
 *
 * BOTH ends are required. A half-known window rendered as "09:00 -" or as a bare
 * "09:00" would read as a decided time, so a missing end demotes the whole line
 * to {@link NO_PERSONAL_TIME_TEXT}. This is a formatting choice over two values
 * the read layer already decided — no time is computed, derived or defaulted.
 */
function waveTimeText(wave: ExamWaveView): string | null {
  if (wave.startTime === null) return null;
  if (wave.endTime === null) return null;
  return `${wave.startTime} - ${wave.endTime}`;
}

/** One "label: value" detail, rendered only when the value is really there. */
function DetailChip({ label, value }: { label: string; value: string | null }) {
  if (value === null || value.trim().length === 0) return null;
  return (
    <span className="text-xs text-muted-foreground">
      <span className="font-semibold">{label}: </span>
      {value}
    </span>
  );
}

/**
 * The horse, topic and discipline of one participant.
 *
 * A wrapping row, so three short details read as one compact line on a wide
 * phone and stack by themselves on a narrow one. Nothing here has a fixed
 * width, so the unit can never overflow sideways. Every optional value is
 * omitted when absent rather than stubbed with a placeholder — a screen full of
 * "לא הוגדר" tells a reader that a value exists and is blank, when in truth the
 * block simply does not carry it yet.
 */
function DetailChips({ row }: { row: ExamAssignmentRowView }) {
  return (
    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
      <DetailChip label={HORSE_LABEL} value={row.horseName} />
      <DetailChip label={TOPIC_LABEL} value={row.instructionTopic} />
      <DetailChip label={DISCIPLINE_LABEL} value={row.discipline} />
    </div>
  );
}

/**
 * ONE examinee unit: the examinee, their horse, topic and discipline, and the
 * instructed trainee they teach — nested INSIDE, never beside.
 *
 * It states NO TIME. The wave above owns the window, so two parallel examinees
 * cannot print the same time twice.
 */
function ExamineeUnit({ unit }: { unit: ExamExamineeUnitView }) {
  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        <p className="text-sm font-semibold text-card-foreground">
          {unit.examinee.participantName ?? UNNAMED_PARTICIPANT_TEXT}
        </p>
        <p className="text-xs font-semibold text-muted-foreground">
          {ROLE_LABELS[unit.examinee.role]}
        </p>
      </div>

      <DetailChips row={unit.examinee} />

      {/* The nested instructed trainee. An empty list renders NOTHING: a bare
          label with no name behind it would suggest a trainee the contract does
          not have. */}
      {unit.instructedTraineeNames.length > 0 && (
        <p className="mt-1 text-xs text-card-foreground">
          <span className="font-semibold">{INSTRUCTED_TRAINEE_LABEL}: </span>
          {unit.instructedTraineeNames.map((name, index) => (
            <span key={`${index}-${name}`}>
              {index > 0 && ", "}
              {name}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

/**
 * ONE wave: its window stated ONCE, and every unit that happens inside it.
 *
 * The units sit in a grid that is ONE COLUMN on a phone and TWO from the `sm`
 * breakpoint up, so two parallel examinees read side by side on a desktop and
 * stack — still inside the same wave, still under the one time — on mobile.
 *
 * ===========================================================================
 * AN UNPAIRED TRAINEE IS A WARNING, NOT A PARTICIPANT CARD
 * ===========================================================================
 * An instructed trainee NEVER renders as a participant in their own right — not
 * when they are paired (they are nested inside their examinee's unit) and not
 * when the read layer paired them with nobody. An unpaired one is instead a
 * single compact WARNING LINE at the foot of their own wave: no card markup, no
 * unit markup, no grid cell, no role chip, no detail chips, and no second block
 * standing beside the examinee cards. It is deliberately NOT visually equal to
 * an examinee — it is an operational gap somebody has to close, and the only
 * reason it appears at all is that erasing a real person from a real schedule
 * would be worse.
 */
function Wave({ wave }: { wave: ExamWaveView }) {
  const timeText = waveTimeText(wave);
  return (
    <div className="rounded-2xl border border-border bg-card p-3">
      <p
        className={`text-xs font-semibold ${
          timeText === null ? "text-muted-foreground" : "text-card-foreground"
        }`}
      >
        {timeText ?? NO_PERSONAL_TIME_TEXT}
      </p>

      {wave.units.length > 0 && (
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {wave.units.map((unit, index) => (
            <ExamineeUnit key={`${index}-${unit.examinee.participantName ?? ""}`} unit={unit} />
          ))}
        </div>
      )}

      {wave.unpairedInstructedRows.map((row, index) => (
        <p key={`u-${index}-${row.participantName ?? ""}`} className="mt-2 text-xs text-warning">
          {UNPAIRED_TRAINEE_LABEL}: {row.participantName ?? UNNAMED_PARTICIPANT_TEXT}
        </p>
      ))}
    </div>
  );
}

/**
 * The complete operational schedule of ONE exam block, as waves.
 *
 * An EMPTY array renders nothing at all — not a heading, not an empty-state
 * sentence. A block legitimately carries no stored assignment (a live beginner
 * row never has one), and a "no participants" notice on such a block would be a
 * claim this renderer is in no position to make. The surrounding block card,
 * with its own date, name, time and place, still renders exactly as before.
 *
 * The prop is still the flat contract array, unchanged, so both role screens
 * hand over `row.assignments` verbatim and neither of them knows what a wave is.
 */
export function ExamAssignmentRows({
  assignments,
}: {
  assignments: readonly ExamAssignmentRowView[];
}) {
  const waves = groupExamAssignmentsIntoWaves(assignments);
  if (waves.length === 0) return null;
  return (
    <div className="mt-2 flex flex-col gap-2">
      {waves.map((wave, index) => (
        <Wave key={`${index}-${wave.startTime ?? ""}-${wave.endTime ?? ""}`} wave={wave} />
      ))}
    </div>
  );
}
