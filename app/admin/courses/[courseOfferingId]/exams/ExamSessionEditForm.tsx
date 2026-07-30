"use client";

/**
 * EXAM EX-SES-UI-2 — the edit form for ONE stored ExamSession.
 *
 * This is a client component for exactly ONE reason, and it is pure UX:
 * `useFormStatus()` (which must run INSIDE the `<form>`) disables the submit
 * button while the action is in flight, so a double click cannot send two edits
 * against the same version — the second of which would be reported as a stale
 * write and would confuse a manager who only clicked once.
 *
 * ===========================================================================
 * EVERY VALUE THIS COMPONENT SHOWS COMES FROM ITS PROPS
 * ===========================================================================
 * There is no `fetch`, no `useEffect`, no router call, no client-side data
 * loading, no optimistic update and no auto-submit. The current values and the
 * definition options are rendered from props and from nothing else, so this
 * component cannot widen what the server chose to hand it — it cannot discover a
 * definition belonging to another course's plan, because it never asks anyone for
 * one.
 *
 * It holds no state either. Each field is an UNCONTROLLED input with a
 * `defaultValue` taken from the stored row, so what the manager sees when the form
 * opens is exactly what the database last reported, and what they submit is
 * whatever the browser holds at submit time. There is nothing here that could
 * drift from the server's copy without the manager having typed it.
 *
 * ===========================================================================
 * THE TWO HIDDEN FIELDS, AND WHY NEITHER IS A GRANT
 * ===========================================================================
 *   - `sessionId` names the row to edit. It proves nothing: the committed writer
 *     re-resolves the offering from the SERVER-BOUND id, derives the plan from it,
 *     and looks this id up WITHIN that plan — so a hand-edited value naming
 *     another course's session is reported as "not found" and nothing is written.
 *   - `expectedUpdatedAt` is the OPTIMISTIC CONCURRENCY token: the `updatedAt`
 *     epoch-millisecond stamp of the row this form was rendered from. It is
 *     carried as a hidden field and NEVER rendered as text, put in an href, or
 *     transformed here in any way. The committed writer's conditional update
 *     matches on it, so an edit built from a page that has since gone stale
 *     refuses instead of silently overwriting someone else's change.
 *
 * ===========================================================================
 * WHAT THIS FORM CANNOT SUBMIT
 * ===========================================================================
 * There is no course field, no plan field, no order field, no end-time field, no
 * capacity field and no assignment-count field — not hidden, not disabled, but
 * ABSENT from the markup. The offering is bound into the action on the SERVER, the
 * plan is derived from it, the position belongs to a separate reordering slice
 * that does not exist here, and the end time is a property of the definition.
 *
 * The assignment count in particular is not a value this form may express. Whether
 * an edit is permitted — and specifically whether the DEFINITION may be changed —
 * is decided by the committed writer against the database at write time. This
 * component renders an advisory sentence when assignments exist; it does not
 * disable, gate or pre-validate anything on that basis, because ordinary edits to
 * the date, time, field, title and notes remain perfectly legal for an assigned
 * session.
 *
 * The Hebrew exam-kind labels are spelled out LOCALLY here rather than imported
 * from the shared table, for the containment reason recorded in the sibling page's
 * header. They must be kept in step by hand until the boundary is lifted.
 */
import { useFormStatus } from "react-dom";

/**
 * ONE definition, as the page describes it to this form.
 *
 * Three fields, all safe to render: an opaque id, the manager-chosen name, and the
 * kind — which is shown only so two definitions with similar names can be told
 * apart in the picker. No duration, capacity, requirement flag, plan id, offering
 * id or timestamp travels with it.
 */
export interface ExamSessionEditDefinitionOption {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
}

/** The Hebrew name of each exam kind. Local by containment; see the header. */
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
 * An optional stored value, as a form default.
 *
 * The reader reports "nothing stored" as `null`, and an input's `defaultValue`
 * wants a string — so `null` becomes the empty string, which is exactly what the
 * committed normalizer reads back as "store nothing". The round trip is therefore
 * lossless: opening the form and saving it unchanged is a no-op, not a write.
 */
function textDefault(value: string | null): string {
  return value ?? "";
}

/**
 * The submit button. Disabled while the action is in flight, for the
 * double-submit reason in the header.
 */
function EditSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "שומר…" : "שמירת השינויים"}
    </button>
  );
}

export function ExamSessionEditForm({
  action,
  sessionId,
  expectedUpdatedAt,
  definitionId,
  date,
  startTime,
  arena,
  title,
  notes,
  hasAssignments,
  definitions,
}: {
  action: (formData: FormData) => void | Promise<void>;
  sessionId: string;
  expectedUpdatedAt: number;
  definitionId: string;
  date: string;
  startTime: string;
  arena: string | null;
  title: string | null;
  notes: string | null;
  hasAssignments: boolean;
  definitions: readonly ExamSessionEditDefinitionOption[];
}) {
  return (
    <form action={action} className="flex flex-col gap-3">
      {/*
        The row and the version it was read at. Both are hidden fields rather than
        rendered text or href segments, and neither is transformed here.
      */}
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="expectedUpdatedAt" value={expectedUpdatedAt} />

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-card-foreground">הגדרת המבחן</span>
        <select
          name="definitionId"
          required
          defaultValue={definitionId}
          className={FIELD_CLASS}
        >
          {definitions.map((definition) => (
            <option key={definition.id} value={definition.id}>
              {definition.name} — {kindText(definition.kind)}
            </option>
          ))}
        </select>
      </label>

      {/*
        ADVISORY ONLY, and stated exactly. Ordinary edits stay available for a
        session that already has examinees; it is only the CHANGE OF DEFINITION
        that the committed writer refuses in that state. Nothing here is disabled
        on this basis — the sentence explains a server rule, it does not enforce
        one.
      */}
      {hasAssignments ? (
        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          למועד זה כבר משובצים נבחנים. ניתן לעדכן תאריך, שעה, מגרש, כותרת והערות,
          אך לא ניתן להחליף את הגדרת המבחן כל עוד קיימים שיבוצים.
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-card-foreground">תאריך</span>
          {/*
            `type="date"` submits the exact `YYYY-MM-DD` the committed validator
            requires, and the default is the stored day — never today.
          */}
          <input
            type="date"
            name="date"
            required
            defaultValue={date}
            className={FIELD_CLASS}
          />
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
            defaultValue={startTime}
            className={FIELD_CLASS}
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-card-foreground">
          מגרש <span className="text-muted-foreground">(רשות)</span>
        </span>
        <input
          type="text"
          name="arena"
          defaultValue={textDefault(arena)}
          className={FIELD_CLASS}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-card-foreground">
          כותרת <span className="text-muted-foreground">(רשות)</span>
        </span>
        <input
          type="text"
          name="title"
          defaultValue={textDefault(title)}
          className={FIELD_CLASS}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-card-foreground">
          הערות <span className="text-muted-foreground">(רשות)</span>
        </span>
        <textarea
          name="notes"
          rows={3}
          defaultValue={textDefault(notes)}
          className={FIELD_CLASS}
        />
      </label>

      <div>
        <EditSubmitButton />
      </div>
    </form>
  );
}
