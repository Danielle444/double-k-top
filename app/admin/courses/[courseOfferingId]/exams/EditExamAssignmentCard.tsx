"use client";

/**
 * EXAM EX-ADMIN-WORKSPACE-UX — the ONE coherent edit card of ONE already-assigned
 * examinee.
 *
 * Everything a manager can say about a person being examined lives in this one
 * form and is saved by ONE button: the horse, the instruction topic, the branch,
 * and the ONE instructed trainee that this examinee TEACHES. Before this slice
 * those were a read-only row plus a separate pairing form rendered under the
 * instructed trainee's OWN card — which asked the manager to hold the
 * relationship in their head backwards, and to press two save buttons to change
 * one lesson.
 *
 * ===========================================================================
 * THE RELATIONSHIP IS ONE-TO-ONE, AND IT IS OWNED BY THE EXAMINEE'S CARD
 * ===========================================================================
 * The examinee teaches the instructed trainee. That is one link, in one
 * direction, with one partner at each end — so it is ONE `<select>` here rather
 * than a list, and the instructed trainee gets NO card of its own anywhere in
 * the workspace.
 *
 * The OPTIONS are the instructed-trainee rows of THIS EXAM SESSION and of no
 * other. They arrive already narrowed by the page, from a bucket keyed by
 * session id, so "same session only" is a property of the data structure rather
 * than of a comparison somebody could later delete — and the committed pairing
 * backend refuses a cross-session pairing on its own regardless.
 *
 * ===========================================================================
 * ONE SAVE, AND AN HONEST NOTE ABOUT WHAT IS BEHIND IT
 * ===========================================================================
 * ONE submit button, one `<form>`, one Server Action. The manager performs one
 * action and gets one outcome.
 *
 * Behind it the server writes through TWO committed paths, because the stored
 * detail columns and the pairing allocation are owned by two different writers
 * and the pairing one carries every reuse, ambiguity and allocation rule. They
 * are called in sequence and NOT in one transaction. That is a deliberate,
 * stated trade: reimplementing the pairing rules inside the detail writer to buy
 * atomicity would duplicate exactly the business logic this slice was told to
 * reuse. The action reports each leg, so a manager is never told a link was
 * saved when it was not.
 *
 * ===========================================================================
 * WHAT THIS COMPONENT MAY NOT DO
 * ===========================================================================
 * It holds no local copy of the roster, inserts nothing optimistically, runs no
 * `fetch`, no `useEffect`, no router call and no auto-submit, and duplicates no
 * server rule: the horse requirement, the topic and branch requirements, the
 * role rule and every pairing rule are decided server-side. On success the
 * action revalidates and the card is re-read from the database, so what the
 * manager sees afterwards is what was actually stored.
 *
 * It renders NO identity number, phone, parent or guardian contact, group,
 * subgroup or enrolment detail — the props carry none, so it could not render
 * one by mistake. The two ids it does hold are `<input>` and `<option>` VALUES
 * that exist to be submitted back; neither is ever text on the screen and
 * neither appears in an href.
 *
 * There is no ordering control in this file: moving an examinee is a different
 * operation with its own form, and an HTML form may not be nested inside
 * another one.
 */
import { useFormStatus } from "react-dom";

/** ONE instructed trainee of this session, as the page describes it here. */
export interface InstructedTraineeChoice {
  readonly assignmentId: string;
  readonly traineeName: string;
}

/** The submitted value that means "this examinee teaches nobody". */
export const EDIT_CARD_NO_INSTRUCTED_TRAINEE_VALUE = "";

const FIELD_CLASS =
  "w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-card-foreground disabled:cursor-not-allowed disabled:opacity-50";

const SAVE_TEXT = "שמירת הכרטיס";
const SAVING_TEXT = "שומר...";

/** The ONE submit button of the card. Disabled only while its own save is in flight. */
function SaveCardButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? SAVING_TEXT : SAVE_TEXT}
    </button>
  );
}

export function EditExamAssignmentCard({
  action,
  assignmentId,
  traineeName,
  horseName,
  instructionTopic,
  discipline,
  requiresLessonTopic,
  requiresDiscipline,
  showInstructedTrainee,
  instructedTraineeOptions,
  currentInstructedTraineeAssignmentId,
}: {
  action: (formData: FormData) => void | Promise<void>;
  assignmentId: string;
  traineeName: string;
  horseName: string | null;
  instructionTopic: string | null;
  discipline: string | null;
  requiresLessonTopic: boolean;
  requiresDiscipline: boolean;
  showInstructedTrainee: boolean;
  instructedTraineeOptions: readonly InstructedTraineeChoice[];
  currentInstructedTraineeAssignmentId: string | null;
}) {
  /**
   * The two free-text fields are offered whenever the exam DEMANDS them OR when
   * something is already stored in them. The second half matters: a historical
   * row may carry a value its exam no longer requires, and hiding the input
   * would leave the manager unable to correct or clear it.
   */
  const showTopic = requiresLessonTopic || instructionTopic !== null;
  const showDiscipline = requiresDiscipline || discipline !== null;

  return (
    <form action={action} className="mt-3 flex flex-col gap-3 border-t border-border pt-3">
      {/*
        WHICH row this card edits. Hidden rather than chosen: the manager already
        picked the person by opening their card, and the committed writer looks
        the id up WITHIN the plan it resolved from the server-bound offering, so
        a forged value reaches a row of another course as "not found".
      */}
      <input type="hidden" name="assignmentId" value={assignmentId} readOnly />

      {/*
        WHO was linked when this card was rendered. The save uses it to clear a
        link the manager replaced, which the pairing writer cannot infer from the
        new selection alone. It is a submitted value and never text on screen.
      */}
      <input
        type="hidden"
        name="previousInstructedTraineeAssignmentId"
        value={currentInstructedTraineeAssignmentId ?? EDIT_CARD_NO_INSTRUCTED_TRAINEE_VALUE}
        readOnly
      />

      <p className="text-sm font-semibold text-card-foreground">{traineeName}</p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-card-foreground">סוס</span>
          {/*
            REQUIRED, and required server-side too: the committed input core
            refuses a blank or whitespace-only horse for an examinee regardless
            of what the browser enforces. The attribute saves a round trip and is
            never the rule.
          */}
          <input
            type="text"
            name="horseName"
            required
            defaultValue={horseName ?? ""}
            className={FIELD_CLASS}
          />
        </label>

        {showTopic ? (
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-card-foreground">נושא הדרכה</span>
            <input
              type="text"
              name="instructionTopic"
              required={requiresLessonTopic}
              defaultValue={instructionTopic ?? ""}
              className={FIELD_CLASS}
            />
          </label>
        ) : null}

        {showDiscipline ? (
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-card-foreground">ענף</span>
            <input
              type="text"
              name="discipline"
              required={requiresDiscipline}
              defaultValue={discipline ?? ""}
              className={FIELD_CLASS}
            />
          </label>
        ) : null}

        {/*
          THE ONE INSTRUCTED TRAINEE THIS EXAMINEE TEACHES.

          Rendered inside the SAME form as the three fields above, so the manager
          presses one button. The current partner is the pre-selected option and
          comes from the committed reader's own resolved answer — never from the
          query string, never from array position and never from a pairing index,
          which this surface cannot see.

          With no instructed trainee assigned to this session there is nothing to
          choose, so a sentence is rendered instead of an empty picker: a control
          whose only option is "nobody" looks like one that does nothing.
        */}
        {showInstructedTrainee ? (
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-card-foreground">החניך המודרך שהנבחן/ת מדריך/ה</span>
            {instructedTraineeOptions.length > 0 ? (
              <select
                name="instructedTraineeAssignmentId"
                defaultValue={
                  currentInstructedTraineeAssignmentId ?? EDIT_CARD_NO_INSTRUCTED_TRAINEE_VALUE
                }
                className={FIELD_CLASS}
              >
                <option value={EDIT_CARD_NO_INSTRUCTED_TRAINEE_VALUE}>ללא חניך מודרך</option>
                {instructedTraineeOptions.map((option) => (
                  <option key={option.assignmentId} value={option.assignmentId}>
                    {option.traineeName}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-xs text-muted-foreground">
                אין חניכים מודרכים במפגש הזה, ולכן אין את מי לשייך.
              </span>
            )}
          </label>
        ) : null}
      </div>

      <div>
        <SaveCardButton />
      </div>
    </form>
  );
}
