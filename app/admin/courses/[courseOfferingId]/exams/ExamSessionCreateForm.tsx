"use client";

/**
 * EXAM EX-SES-S4 — the create form for ONE stored ExamSession.
 *
 * NOT WIRED YET. Nothing renders this component: the page that will pass it a
 * bound action and a definition list is a LATER, separately reviewed integration
 * slice, together with the reader and the grouping core that produce the session
 * list. What is committed here is the form and its contract alone.
 *
 * This is a client component for exactly ONE reason, and it is pure UX:
 * `useFormStatus()` (which must run INSIDE the `<form>`) disables the submit
 * button while the action is in flight, so a double click cannot produce two
 * sessions on the same day at the same time.
 *
 * ===========================================================================
 * EVERY VALUE THIS COMPONENT SHOWS COMES FROM ITS PROPS
 * ===========================================================================
 * There is no `fetch`, no `useEffect`, no router call, no client-side data
 * loading and no auto-submit. The definition options are rendered from the
 * `definitions` prop and from nothing else, so this component cannot widen what
 * the server chose to hand it — it cannot discover a definition belonging to
 * another course's plan, because it never asks anyone for one.
 *
 * The prop carries EXACTLY three safe fields per definition — `id`, `name` and
 * `kind` — and no duration, capacity, requirement flag, plan id, offering id or
 * timestamp. A value this form never receives is a value it cannot leak into the
 * page, and the narrow shape also means the eventual page cannot satisfy the
 * prop by passing a raw database row.
 *
 * ===========================================================================
 * THE CHOSEN DEFINITION IS A REQUEST, NEVER A GRANT
 * ===========================================================================
 * The select submits an OPAQUE definition id. It proves nothing: the committed
 * writer re-resolves the offering, derives the plan from it server-side, and then
 * looks the definition up WITHIN that plan — so a hand-edited option value naming
 * another course's definition is reported as "not found", not written. Rendering
 * only the offered definitions is a convenience for the manager; it is not the
 * enforcement, and nothing here should ever be read as if it were.
 *
 * ===========================================================================
 * WHAT THIS FORM CANNOT SUBMIT
 * ===========================================================================
 * There is no course field, no plan field, no order field, no end-time field, no
 * capacity field and no id field — not hidden, not disabled, but ABSENT from the
 * markup. The offering is bound into the action on the SERVER, the plan is
 * derived from it, the position is computed by the writer, and the end time is a
 * property of the definition. The only things the browser can influence are the
 * six values below.
 *
 * ===========================================================================
 * NOTHING IS INSERTED OPTIMISTICALLY, AND NOTHING IS EDITED OR REMOVED
 * ===========================================================================
 * The form renders no pending row and holds no local list. On success the action
 * revalidates and redirects, and the session list is re-read from the database —
 * so what the manager sees afterwards is what was actually stored, never what
 * this component hoped would be.
 *
 * There is no edit control, no delete control and no reorder control anywhere in
 * this file. The committed writers for those operations exist and remain
 * deliberately unreachable from any UI.
 *
 * The Hebrew exam-kind labels are spelled out LOCALLY here rather than imported
 * from the shared table, for the containment reason recorded in the sibling
 * page's header. They must be kept in step by hand until the boundary is lifted.
 */
import { useFormStatus } from "react-dom";

/**
 * ONE definition, as the eventual page may describe it to this form.
 *
 * Three fields, all safe to render: an opaque id, the manager-chosen name, and
 * the kind — which is shown only so two definitions with similar names can be
 * told apart in the picker.
 */
export interface ExamSessionDefinitionOption {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
}

/**
 * The Hebrew name of each exam kind. Local by containment; see the header.
 *
 * `BEGINNER_INSTRUCTION` is listed for TOTALITY, not as an offer: beginner exams
 * are a live Teaching Practice projection and never become a stored definition,
 * so it should never arrive — and if it somehow does, a correct label is better
 * than a raw enum token on the screen.
 */
const EXAM_KIND_TEXT: Readonly<Record<string, string>> = Object.freeze({
  INTERFACE_RIDING: "ממשק ורכיבה",
  LUNGE_NO_RIDER: "לונג ללא רוכב",
  ADVANCED_INSTRUCTION: "הדרכת מתקדמים",
  BEGINNER_INSTRUCTION: "הדרכת מתחילים",
});

/**
 * Total and fail-visible: a kind the label map does not know renders as an
 * explicit "unrecognized" sentence rather than leaking a raw enum token or
 * silently rendering a blank option.
 */
function kindText(kind: string): string {
  return EXAM_KIND_TEXT[kind] ?? "סוג מבחן לא מזוהה";
}

const FIELD_CLASS =
  "rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-card-foreground disabled:cursor-not-allowed disabled:opacity-50";

/**
 * The submit button.
 *
 * Disabled while the action is in flight AND whenever there is no definition to
 * choose — the two reasons are independent, and either one alone is enough.
 */
function CreateSubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  const isDisabled = pending || disabled;
  return (
    <button
      type="submit"
      disabled={isDisabled}
      aria-disabled={isDisabled}
      className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "שומר…" : "הוספת מועד בחינה"}
    </button>
  );
}

export function ExamSessionCreateForm({
  action,
  definitions,
}: {
  action: (formData: FormData) => void | Promise<void>;
  definitions: readonly ExamSessionDefinitionOption[];
}) {
  /**
   * A session must name a definition, so with none to offer there is nothing
   * this form could legitimately submit. The whole field set is disabled rather
   * than hidden, and the reason is stated in words: a form that vanished would
   * leave the manager guessing, and one that submitted would fail server-side
   * with a diagnostic that describes the same missing prerequisite one round
   * trip later.
   *
   * A disabled `<fieldset>` disables every control inside it, and disabled
   * controls submit no entry at all — so this is not merely a visual state.
   */
  const hasNoDefinitions = definitions.length === 0;

  return (
    <form action={action} className="flex flex-col gap-3">
      {hasNoDefinitions ? (
        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          לא ניתן להוסיף מועד בחינה לפני שהוגדרה לפחות הגדרת מבחן אחת בתוכנית
          המבחנים של הקורס. יש להוסיף הגדרת מבחן תחילה.
        </p>
      ) : null}

      <fieldset disabled={hasNoDefinitions} className="flex flex-col gap-3 border-0 p-0">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-card-foreground">הגדרת המבחן</span>
          <select name="definitionId" required defaultValue="" className={FIELD_CLASS}>
            {/*
              An empty, non-selectable placeholder rather than a pre-selected
              first definition: which exam is being scheduled is a decision the
              manager must make, and defaulting to whichever definition happens
              to sort first would let a distracted submit create the wrong one.
            */}
            <option value="" disabled>
              בחירת הגדרת מבחן
            </option>
            {definitions.map((definition) => (
              <option key={definition.id} value={definition.id}>
                {definition.name} — {kindText(definition.kind)}
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-card-foreground">תאריך</span>
            {/*
              `type="date"` submits the exact `YYYY-MM-DD` the committed
              validator requires, and no default is set: today is never inferred
              for the manager.
            */}
            <input type="date" name="date" required className={FIELD_CLASS} />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-card-foreground">שעת התחלה</span>
            {/*
              `type="time"` submits a zero-padded `HH:mm`. `step={60}` keeps the
              browser from offering seconds, which the committed validator would
              refuse. The end time is NOT asked for: it is derived from the
              definition's duration, server-side.
            */}
            <input
              type="time"
              name="startTime"
              step={60}
              required
              className={FIELD_CLASS}
            />
          </label>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-card-foreground">
            מגרש <span className="text-muted-foreground">(רשות)</span>
          </span>
          <input type="text" name="arena" className={FIELD_CLASS} />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-card-foreground">
            כותרת <span className="text-muted-foreground">(רשות)</span>
          </span>
          <input type="text" name="title" className={FIELD_CLASS} />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-card-foreground">
            הערות <span className="text-muted-foreground">(רשות)</span>
          </span>
          <textarea name="notes" rows={3} className={FIELD_CLASS} />
        </label>
      </fieldset>

      <div>
        <CreateSubmitButton disabled={hasNoDefinitions} />
      </div>
    </form>
  );
}
