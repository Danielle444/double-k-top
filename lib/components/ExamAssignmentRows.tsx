"use client";

/**
 * EX-ROLE-OP-UI-MVP — the ONE renderer for a stored exam block's complete
 * operational assignment rows.
 *
 * IT IS SHARED BY THE INSTRUCTOR AND THE TRAINEE SCREEN ON PURPOSE. The read
 * layer hands both roles the SAME assignment contract — what differs between
 * them is WHICH ROWS each is given (publication, the selected day, the resolved
 * course), and that is decided server-side long before this file is reached. Two
 * hand-written copies of this layout would be two places for the Hebrew labels,
 * the missing-value rules and the pairing wording to drift apart, and a drift
 * here reads to a rider as a different schedule. So there is exactly one copy.
 *
 * ===========================================================================
 * IT CALCULATES NOTHING
 * ===========================================================================
 * There is no pairing rule, no timetable rule, no slot arithmetic, no duration,
 * no sort and no regrouping in this file. Every value below is rendered EXACTLY
 * as the committed cores decided it: the role, the horse, the inherited topic and
 * discipline, the exact personal start and end, and the RESOLVED pairing names.
 * The array is rendered in the order it arrives, because that order already IS
 * the operational order — re-sorting it here would invent a second, disagreeing
 * schedule out of presentation code.
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
 * exact personal start and end time, the horse name, the instruction topic, the
 * discipline and the resolved paired participants' display names.
 *
 * NOT rendered, and not even representable in the props below: any assignment,
 * student, session, definition, lesson, plan or course id, `pairingIndex`, any
 * national id, e-mail address, phone number, parent or contact detail, any note,
 * any grade and any feedback. The prop type is an EXPLICIT field list rather
 * than the read layer's own DTO, so a field added upstream cannot start
 * appearing on screen by itself, and there is no `JSON.stringify` and no generic
 * object renderer here through which one could leak.
 *
 * READ-ONLY BY CONSTRUCTION: no state, no effect, no event handler, no form, no
 * input, no button, no Server Action and no publication concept. It receives an
 * array and returns markup.
 */

/**
 * ONE participant of one stored exam block, as this renderer needs them.
 *
 * Structurally identical to the read layer's shared assignment contract, and
 * declared here rather than imported so no client component reaches into the
 * exam read pipeline's modules. TypeScript still checks the two agree at every
 * call site: a caller passes its own rows straight in, so a rename or a type
 * change upstream fails the build rather than silently blanking the screen.
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

/** The approved Hebrew role labels. */
const ROLE_LABELS: Record<ExamAssignmentRowView["role"], string> = {
  EXAMINEE: "נבחן/ת",
  INSTRUCTED_TRAINEE: "חניך/ה מודרך/ת",
};

/**
 * The pairing line's label, by the role of the participant it sits under: an
 * instructed trainee INSTRUCTS their examinee, an examinee IS instructed by
 * theirs. The list itself is the same resolved pairing read from both sides.
 */
const PAIRED_LABELS: Record<ExamAssignmentRowView["role"], string> = {
  EXAMINEE: "חניכים מודרכים",
  INSTRUCTED_TRAINEE: "מדריך/ה את",
};

/**
 * Shown INSTEAD of a name that the read layer could not resolve. It is neutral
 * text, never the id the lookup exists to remove and never an empty line that
 * would read as a person with no name.
 */
const UNNAMED_PARTICIPANT_TEXT = "שם לא זמין";

/**
 * Shown when the participant's personal window is not fully known. The block's
 * own start and end are NEVER substituted: a rider reading a time must be
 * reading their own assignment, not a layout convenience.
 */
const NO_PERSONAL_TIME_TEXT = "שעה אישית טרם נקבעה";

const HORSE_LABEL = "סוס";
const TOPIC_LABEL = "נושא";
const DISCIPLINE_LABEL = "תחום";

/**
 * The participant's personal window, or `null` when it is not fully known.
 *
 * BOTH ends are required. A half-known window rendered as "09:00 -" or as a bare
 * "09:00" would read as a decided time, so a missing end demotes the whole line
 * to {@link NO_PERSONAL_TIME_TEXT}. This is a formatting choice over two values
 * the read layer already decided — no time is computed, derived or defaulted.
 */
function personalTimeText(row: ExamAssignmentRowView): string | null {
  if (row.personalStartTime === null) return null;
  if (row.personalEndTime === null) return null;
  return `${row.personalStartTime} - ${row.personalEndTime}`;
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
 * ONE assignment row: who, in which role, at exactly which minutes, on which
 * horse, on which topic and discipline, paired with whom.
 *
 * Every optional value is omitted when absent rather than stubbed with a
 * placeholder — a screen full of "לא הוגדר" tells a reader that a value exists
 * and is blank, when in truth the block simply does not carry it yet. The two
 * things that are always stated are the role and, when the personal window is
 * unknown, that it is not yet set.
 */
function AssignmentRow({ row }: { row: ExamAssignmentRowView }) {
  const timeText = personalTimeText(row);
  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        <p className="text-sm font-semibold text-card-foreground">
          {row.participantName ?? UNNAMED_PARTICIPANT_TEXT}
        </p>
        <p className="text-xs font-semibold text-muted-foreground">{ROLE_LABELS[row.role]}</p>
      </div>

      <p
        className={`mt-1 text-xs font-semibold ${
          timeText === null ? "text-muted-foreground" : "text-card-foreground"
        }`}
      >
        {timeText ?? NO_PERSONAL_TIME_TEXT}
      </p>

      {/* A wrapping row, so three short details read as one compact line on a
          wide phone and stack by themselves on a narrow one. Nothing here has a
          fixed width, so the card can never overflow sideways. */}
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
        <DetailChip label={HORSE_LABEL} value={row.horseName} />
        <DetailChip label={TOPIC_LABEL} value={row.instructionTopic} />
        <DetailChip label={DISCIPLINE_LABEL} value={row.discipline} />
      </div>

      {/* The resolved pairing. An empty list renders NOTHING: a bare label with
          no name behind it would suggest a partner the contract does not have. */}
      {row.pairedParticipantNames.length > 0 && (
        <p className="mt-1 text-xs text-card-foreground">
          <span className="font-semibold">{PAIRED_LABELS[row.role]}: </span>
          {row.pairedParticipantNames.map((name, index) => (
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
 * The complete operational assignment rows of ONE exam block.
 *
 * An EMPTY array renders nothing at all — not a heading, not an empty-state
 * sentence. A block legitimately carries no stored assignment (a live beginner
 * row never has one), and a "no participants" notice on such a block would be a
 * claim this renderer is in no position to make. The surrounding block card,
 * with its own date, name, time and place, still renders exactly as before.
 */
export function ExamAssignmentRows({
  assignments,
}: {
  assignments: readonly ExamAssignmentRowView[];
}) {
  if (assignments.length === 0) return null;
  return (
    <div className="mt-2 flex flex-col gap-2">
      {assignments.map((row, index) => (
        <AssignmentRow key={`${index}-${row.participantName ?? ""}`} row={row} />
      ))}
    </div>
  );
}
