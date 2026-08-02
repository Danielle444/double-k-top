"use client";

/**
 * EX-TRN-MULTI-SLOT-DETAIL — one NESTED CARD per personal assignment, for the
 * compact personal exam view ("לו״ז שלי") and for "לפי תאריך"'s own personal
 * lines.
 *
 * ===========================================================================
 * WHY EACH ASSIGNMENT GETS ITS OWN CARD
 * ===========================================================================
 * A trainee may legitimately hold several assignments in one session
 * (EX-ASG-MULTIPLICITY): an EXAMINEE slot plus one or more INSTRUCTED_TRAINEE
 * slots for different examinees, or several INSTRUCTED_TRAINEE slots alone. An
 * earlier version rendered every slot's time on its own line and then ALL of
 * the viewer's horses, topics, disciplines and counterparts together in one
 * shared block below them — readable for one assignment, but for two or more
 * there was no way to tell which detail belonged to which time. This component
 * exists to fix exactly that: ONE bordered card per personal slot, each
 * carrying only that slot's own time, role and detail — never a shared block
 * for several.
 *
 * ===========================================================================
 * THE SERVER SAYS WHICH DETAIL ROW IS WHICH SLOT'S
 * ===========================================================================
 * `personalSlots` and `assignments` are resolved by two INDEPENDENT pipelines
 * over the SAME underlying assignment rows (see `exam-read-dto.ts`), so a slot
 * cannot be paired to its detail by role, by time, by name or by position —
 * two legitimate assignments may share any of those. The server-derived
 * `assignmentKey` is the ONLY input `selectAssignmentRowForSlot` (the pure
 * core) reads to pair them, by EXACT equality. It is a SYNTHETIC,
 * non-database token, never rendered as text — used ONLY for that lookup and,
 * where one is needed, as a React list key.
 *
 * ZERO, ONE OR SEVERAL SLOTS — ALL LEGITIMATE, and each renders its own card
 * regardless of count: a trainee with one assignment sees the identical
 * one-card layout a trainee with three does, never a separate "simple" layout.
 *
 * NO DISPLAY NAME IS EVER COMPARED to decide what is "mine": the viewer's name
 * is not a prop, is not representable in the props at all, and is nowhere in
 * the pure core either.
 *
 * ===========================================================================
 * PRIVACY: ONLY APPROVED DISPLAY VALUES ARE RENDERED
 * ===========================================================================
 * Rendered here: the role, the exact personal time, the horse name, the
 * instruction topic, the discipline and the RESOLVED display names of the
 * counterpart participants. NOT rendered, and not representable in the props:
 * any id (including `assignmentKey` itself), `pairingIndex`, any national id,
 * e-mail, phone number, parent or contact detail, note, grade, rating or
 * feedback. There is no `JSON.stringify` and no generic object renderer.
 *
 * READ-ONLY BY CONSTRUCTION: no state, no effect, no handler, no form, no input,
 * no button, no Server Action and no publication concept.
 */
import {
  selectAssignmentRowForSlot,
  type TraineeExamAssignmentRowView,
  type TraineeExamPersonalSlotView,
} from "./exam-schedule-view-core";

/**
 * The viewer's own role, as a card TITLE. Gender-neutral, matching this
 * screen's established wording for "the person themselves" (as opposed to
 * {@link COUNTERPART_LABELS}, which describes the OTHER side of the lesson).
 */
const ROLE_TITLES: Record<"EXAMINEE" | "INSTRUCTED_TRAINEE", string> = {
  EXAMINEE: "נבחן/ת",
  INSTRUCTED_TRAINEE: "חניך/ה מודרך/ת",
};

/**
 * The counterpart label, by the viewer's own role.
 *
 * An EXAMINEE is shown the instructed trainee they teach; an INSTRUCTED_TRAINEE
 * is shown the examinee teaching them. Both sides read the SAME resolved pairing
 * list — only the wording differs, because the relationship is one-to-one and
 * the two ends of it are not the same sentence.
 */
const COUNTERPART_LABELS: Record<"EXAMINEE" | "INSTRUCTED_TRAINEE", string> = {
  EXAMINEE: "חניכים מודרכים",
  INSTRUCTED_TRAINEE: "נבחן/ת שמדריך/ה אותך",
};

const HORSE_LABEL = "סוס";
const TOPIC_LABEL = "נושא";
const DISCIPLINE_LABEL = "תחום";

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
 * ONE nested card: the viewer's role, exact personal time, and — ONLY when the
 * server could pair this slot to its own assignment row — the horse, topic,
 * discipline and counterpart belonging to THIS assignment and no other.
 *
 * `detail` is `null` exactly when `exam-read-dto.ts` could not correlate this
 * slot (see `TraineeExamPersonalSlotView.assignmentKey`): the card still shows
 * the role and the exact time — never a guessed pairing — and simply carries
 * no further chips.
 */
function PersonalSlotCard({
  slot,
  detail,
}: {
  readonly slot: TraineeExamPersonalSlotView;
  readonly detail: TraineeExamAssignmentRowView | null;
}) {
  const roleTitle = slot.role === null ? null : ROLE_TITLES[slot.role];
  const counterpartLabel = detail === null ? null : COUNTERPART_LABELS[detail.role];
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-muted/40 p-2">
      {roleTitle !== null && (
        <p className="text-sm font-bold text-card-foreground">{roleTitle}</p>
      )}
      <p className="text-xs font-semibold text-primary">
        השעה שלך: {slot.startTime} - {slot.endTime}
      </p>

      {detail !== null && (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          <DetailChip label={HORSE_LABEL} value={detail.horseName} />
          <DetailChip label={TOPIC_LABEL} value={detail.instructionTopic} />
          <DetailChip label={DISCIPLINE_LABEL} value={detail.discipline} />
        </div>
      )}

      {/* The other side of the lesson. An empty list renders NOTHING: a bare
          label with no name behind it would suggest a partner the contract
          does not have. The names are separate elements, never one joined
          string. */}
      {detail !== null && detail.pairedParticipantNames.length > 0 && (
        <p className="text-xs text-card-foreground">
          <span className="font-semibold">{counterpartLabel}: </span>
          {detail.pairedParticipantNames.map((name, nameIndex) => (
            <span key={`${nameIndex}-${name}`}>
              {nameIndex > 0 && ", "}
              {name}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

/**
 * ONE nested card per personal slot — or nothing, when the viewer has none.
 *
 * `personalSlots` and `assignments` are the block's whole trainee contract
 * arrays, handed over verbatim: no viewer identity, no marker and no selection
 * hint is passed in, because the arrays already carry the server's answer.
 * Each slot is paired to its own detail row ONLY through the pure core's
 * `selectAssignmentRowForSlot`, by `assignmentKey`, so a detail that is not
 * provably THIS slot's own can never reach that slot's card.
 */
export function ExamPersonalAssignmentDetail({
  personalSlots,
  assignments,
}: {
  readonly personalSlots: readonly TraineeExamPersonalSlotView[];
  readonly assignments: readonly TraineeExamAssignmentRowView[];
}) {
  if (personalSlots.length === 0) return null;

  return (
    <div className="mt-1 flex flex-col gap-2">
      {personalSlots.map((slot, index) => (
        <PersonalSlotCard
          key={slot.assignmentKey ?? `slot-${index}`}
          slot={slot}
          detail={selectAssignmentRowForSlot(assignments, slot.assignmentKey)}
        />
      ))}
    </div>
  );
}
