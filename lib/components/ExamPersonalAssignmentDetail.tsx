"use client";

/**
 * EX-ROLE-SCHEDULE-REDESIGN — the viewer's OWN operational detail, for the
 * compact personal exam view ("לו״ז שלי").
 *
 * ===========================================================================
 * WHY IT IS NOT THE FULL SCHEDULE
 * ===========================================================================
 * "לו״ז כולם" is the complete operational schedule of a block: every wave, every
 * examinee, every nested trainee. A trainee looking at their OWN schedule needs
 * one line about themselves, not the whole block reprinted under a different
 * heading. So this component renders exactly what the viewer must act on — their
 * horse, their topic, their discipline, and the ONE person on the other side of
 * their lesson — and nothing else. Everyone else's rows stay in "לו״ז כולם".
 *
 * ===========================================================================
 * THE SERVER SAYS WHICH ROWS ARE THE VIEWER'S
 * ===========================================================================
 * The trainee contract marks the viewer's own assignments with `isSelf`, decided
 * server-side by EXACT STUDENT-ID EQUALITY against the identity proven from the
 * signed session. The id itself never leaves the server. This component hands
 * the block's rows to the pure core, which returns EVERY row carrying that
 * boolean.
 *
 * IT REPLACED A HEURISTIC. An earlier version matched the viewer by `selfRole`
 * plus the exact personal start and end. That was safe but INCOMPLETE: two
 * examinees riding in parallel share a personal window, so it could not tell
 * them apart and gave up — and "לו״ז שלי" lost the horse, topic and discipline
 * for exactly the trainees most likely to be unsure of them. Nothing of that
 * heuristic remains: no role, no time, no horse, no topic, no discipline, no
 * pairing and no array position is consulted to CHOOSE a row. They are only ever
 * read out of the rows the server already chose.
 *
 * ZERO, ONE OR SEVERAL ROWS — ALL LEGITIMATE. A trainee may legitimately hold
 * several assignments in one block (EX-ASG-MULTIPLICITY): an EXAMINEE row plus
 * one or more INSTRUCTED_TRAINEE rows for different examinees, or several
 * INSTRUCTED_TRAINEE rows alone. Every marked row renders its own detail block;
 * none is dropped, and none is picked arbitrarily over the others.
 *
 * NO DISPLAY NAME IS EVER COMPARED to decide what is "mine": the viewer's name
 * is not a prop, is not representable in the props at all, and is nowhere in the
 * pure core either.
 *
 * ===========================================================================
 * PRIVACY: ONLY APPROVED DISPLAY VALUES ARE RENDERED
 * ===========================================================================
 * Rendered here: the horse name, the instruction topic, the discipline and the
 * RESOLVED display names of the counterpart participants. NOT rendered, and not
 * representable in the props: any id, `pairingIndex`, any national id, e-mail,
 * phone number, parent or contact detail, note, grade, rating or feedback. There
 * is no `JSON.stringify` and no generic object renderer.
 *
 * READ-ONLY BY CONSTRUCTION: no state, no effect, no handler, no form, no input,
 * no button, no Server Action and no publication concept.
 */
import {
  selectSelfAssignmentRows,
  type TraineeExamAssignmentRowView,
} from "./exam-schedule-view-core";

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
 * The viewer's own horse, topic, discipline and counterpart, for EVERY
 * assignment that is theirs — or nothing.
 *
 * `assignments` is the block's whole trainee contract array, handed over
 * verbatim, and it is the ONLY prop: no viewer identity, no marker and no
 * selection hint is passed in, because the array already carries the server's
 * answer. The component reads it only through the pure core's selector, so a
 * row that is not provably the viewer's can never reach the markup.
 */
export function ExamPersonalAssignmentDetail({
  assignments,
}: {
  readonly assignments: readonly TraineeExamAssignmentRowView[];
}) {
  const details = selectSelfAssignmentRows(assignments);
  if (details.length === 0) return null;

  return (
    <div className="mt-1 flex flex-col gap-2">
      {details.map((detail, index) => {
        const counterpartLabel = COUNTERPART_LABELS[detail.role];
        return (
          <div key={`${index}-${detail.role}`} className="flex flex-col gap-1">
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              <DetailChip label={HORSE_LABEL} value={detail.horseName} />
              <DetailChip label={TOPIC_LABEL} value={detail.instructionTopic} />
              <DetailChip label={DISCIPLINE_LABEL} value={detail.discipline} />
            </div>

            {/* The other side of the lesson. An empty list renders NOTHING: a
                bare label with no name behind it would suggest a partner the
                contract does not have. The names are separate elements, never
                one joined string. */}
            {detail.pairedParticipantNames.length > 0 && (
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
      })}
    </div>
  );
}
