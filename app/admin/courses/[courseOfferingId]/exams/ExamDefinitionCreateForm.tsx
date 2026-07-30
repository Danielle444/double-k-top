"use client";

/**
 * EXAM EX-S5B-5C — the create form for ONE ExamDefinition.
 *
 * This is a client component for exactly TWO reasons, both of them pure UX:
 *   1. `useFormStatus()` (which must run INSIDE the `<form>`) disables the
 *      submit button while the action is in flight, so a double click cannot
 *      produce two definitions;
 *   2. two of the three requirement flags are only MEANINGFUL for one exam kind,
 *      and a checkbox that silently does nothing is worse than one that visibly
 *      cannot be ticked.
 *
 * ===========================================================================
 * THE CLIENT STATE IS FORM UX AND NEVER A SOURCE OF TRUTH
 * ===========================================================================
 * The kind held in state drives ONLY which checkboxes are enabled. It grants
 * nothing, proves nothing and is re-derived from scratch by the server: the
 * committed domain rules reject a definition whose flags do not apply to its
 * kind, whatever this component rendered. Disabling the two boxes therefore
 * PREVENTS A POINTLESS ROUND TRIP; it is not the enforcement, and nothing here
 * should ever be read as if it were.
 *
 * A disabled checkbox submits no entry at all, so the server reads it as absent
 * and coerces it to `false` — the same answer this component is showing. The two
 * layers agree by construction rather than by a shared constant.
 *
 * ===========================================================================
 * WHAT THIS FORM CANNOT SUBMIT
 * ===========================================================================
 * There is no course field, no plan field, no order field and no id field — not
 * hidden, not disabled, but absent from the markup. The offering is bound into
 * the action on the SERVER, so the only thing the browser can influence is the
 * seven values below.
 *
 * `BEGINNER_INSTRUCTION` is deliberately NOT offered: beginner exams are a live
 * Teaching Practice projection and must never become a stored definition. Its
 * absence here is a convenience, not a control — the committed domain validator
 * refuses it regardless, and this component is not what makes that true.
 *
 * ===========================================================================
 * NOTHING IS INSERTED OPTIMISTICALLY
 * ===========================================================================
 * The form renders no pending row and holds no local list. On success the action
 * revalidates and redirects, and the definition list is re-read from the
 * database — so what the manager sees afterwards is what was actually stored,
 * never what this component hoped would be.
 *
 * The Hebrew exam-kind labels are spelled out LOCALLY here rather than imported
 * from the shared table, for the containment reason recorded in the sibling
 * page's header. The three options below and that table must be kept in step by
 * hand until the boundary is lifted.
 */
import { useState } from "react";
import { useFormStatus } from "react-dom";

/**
 * The ONLY exam kinds a stored definition may carry, with their Hebrew names.
 *
 * Exactly three, in the order they are offered. The list is `const` so a fourth
 * cannot be appended by accident at a call site, and it is not exported: nothing
 * outside this form has any business rendering a kind picker.
 */
const KIND_OPTIONS = [
  { value: "INTERFACE_RIDING", label: "ממשק ורכיבה" },
  { value: "LUNGE_NO_RIDER", label: "לונג ללא רוכב" },
  { value: "ADVANCED_INSTRUCTION", label: "הדרכת מתקדמים" },
] as const;

/** The one kind for which an instructed trainee and a lesson topic apply. */
const ADVANCED_INSTRUCTION_KIND = "ADVANCED_INSTRUCTION";

const FIELD_CLASS =
  "rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-card-foreground";

function CreateSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "שומר…" : "הוספת מבחן"}
    </button>
  );
}

/**
 * One requirement checkbox.
 *
 * `checked` is forced to `false` whenever the box is disabled, so a box that was
 * ticked for ADVANCED_INSTRUCTION cannot stay visually ticked after the kind
 * changes — the tick and the submitted value can never disagree.
 */
function RequirementCheckbox({
  name,
  label,
  checked,
  disabled,
  onChange,
  hint,
}: {
  name: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  hint?: string;
}) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-border disabled:cursor-not-allowed disabled:opacity-50"
      />
      <span className={disabled ? "text-muted-foreground" : "text-card-foreground"}>
        {label}
        {hint ? (
          <span className="block text-xs text-muted-foreground">{hint}</span>
        ) : null}
      </span>
    </label>
  );
}

export function ExamDefinitionCreateForm({
  action,
}: {
  action: (formData: FormData) => void | Promise<void>;
}) {
  // The kind currently chosen. UX only — see the header.
  const [kind, setKind] = useState<string>(KIND_OPTIONS[0].value);
  const [requiresInstructedTrainee, setRequiresInstructedTrainee] = useState(false);
  const [requiresLessonTopic, setRequiresLessonTopic] = useState(false);
  const [requiresDiscipline, setRequiresDiscipline] = useState(false);

  const isAdvancedInstruction = kind === ADVANCED_INSTRUCTION_KIND;

  /**
   * Changing the kind AWAY from advanced instruction clears both conditional
   * flags in the same update that disables them. Clearing on change rather than
   * only on submit means the manager never sees a ticked box that will not be
   * saved.
   */
  function handleKindChange(nextKind: string): void {
    setKind(nextKind);
    if (nextKind !== ADVANCED_INSTRUCTION_KIND) {
      setRequiresInstructedTrainee(false);
      setRequiresLessonTopic(false);
    }
  }

  return (
    <form action={action} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-card-foreground">שם המבחן</span>
        <input type="text" name="name" required className={FIELD_CLASS} />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-card-foreground">סוג מבחן</span>
        <select
          name="kind"
          required
          value={kind}
          onChange={(event) => handleKindChange(event.target.value)}
          className={FIELD_CLASS}
        >
          {KIND_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-card-foreground">משך לכל נבחן (דקות)</span>
          <input
            type="number"
            name="durationMinutes"
            min={1}
            step={1}
            required
            className={FIELD_CLASS}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-card-foreground">נבחנים במקביל</span>
          <input
            type="number"
            name="parallelCapacity"
            min={1}
            step={1}
            required
            className={FIELD_CLASS}
          />
        </label>
      </div>

      <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-3">
        <legend className="px-1 text-xs text-muted-foreground">דרישות המבחן</legend>

        <RequirementCheckbox
          name="requiresInstructedTrainee"
          label="נדרש חניך מודרך"
          checked={isAdvancedInstruction && requiresInstructedTrainee}
          disabled={!isAdvancedInstruction}
          onChange={setRequiresInstructedTrainee}
          hint={isAdvancedInstruction ? undefined : "רלוונטי רק בהדרכת מתקדמים"}
        />

        <RequirementCheckbox
          name="requiresLessonTopic"
          label="נדרש נושא הדרכה"
          checked={isAdvancedInstruction && requiresLessonTopic}
          disabled={!isAdvancedInstruction}
          onChange={setRequiresLessonTopic}
          hint={isAdvancedInstruction ? undefined : "רלוונטי רק בהדרכת מתקדמים"}
        />

        {/*
          The discipline requirement applies to EVERY storable kind, so it is
          never disabled and never cleared by a kind change. It is listed beside
          the other two only because all three describe the same thing.
        */}
        <RequirementCheckbox
          name="requiresDiscipline"
          label="נדרש ענף"
          checked={requiresDiscipline}
          onChange={setRequiresDiscipline}
        />
      </fieldset>

      <div>
        <CreateSubmitButton />
      </div>
    </form>
  );
}
