"use client";

/**
 * MULTI-COURSE (new-trainee slice N2B) - the minimal client form for creating ONE
 * brand-new, INACTIVE-STAGED trainee inside the exact route CourseOffering.
 *
 * It mirrors the committed EnrollExistingTraineeForm convention: the ONLY reason
 * this is a client component is the "disable duplicate submission while pending"
 * requirement - useFormStatus() (which must run inside the <form>) disables the
 * submit button while the bound server action is in flight. It holds NO other
 * client state, runs NO custom fetch/API call, and performs NO identity lookup.
 *
 * It submits EXACTLY the five approved N2A fields: firstName, lastName,
 * identityNumber, phone and courseGroupId. There is deliberately NO offering
 * selector and NO hidden courseOfferingId input - the offering id is bound into
 * the server action on the SERVER (page: action.bind(null, context.id)) and is not
 * forgeable from the client. There is likewise NO isActive toggle, NO groupName /
 * subgroupNumber, NO isPrimary / enrollment status / date field, NO horse field
 * and NO password or login control: every operational value is server-derived
 * inside N1, which always stages the trainee as inactive.
 *
 * The subgroup options are ONLY the leaf subgroups of the route offering, produced
 * server-side; N1 remains the transaction-local authority for group ownership.
 * The inactive-staging warning is rendered immediately before the submit button so
 * the manager cannot miss that the created trainee cannot log in yet. There is no
 * activation affordance anywhere in this component.
 */
import { useFormStatus } from "react-dom";
import type { SubgroupOption } from "./EnrollExistingTraineeForm";

const FIELD_CLASS =
  "rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-card-foreground";

function NewTraineeSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "יוצר…" : "יצירת חניך"}
    </button>
  );
}

export function NewTraineeForm({
  action,
  subgroups,
}: {
  action: (formData: FormData) => void | Promise<void>;
  subgroups: readonly SubgroupOption[];
}) {
  return (
    <form action={action} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-card-foreground">שם פרטי</span>
        <input type="text" name="firstName" required autoComplete="off" className={FIELD_CLASS} />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-card-foreground">שם משפחה</span>
        <input type="text" name="lastName" required autoComplete="off" className={FIELD_CLASS} />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-card-foreground">תעודת זהות</span>
        <input
          type="text"
          name="identityNumber"
          required
          inputMode="numeric"
          pattern="\d{5,9}"
          autoComplete="off"
          className={FIELD_CLASS}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-card-foreground">טלפון (רשות)</span>
        <input type="tel" name="phone" autoComplete="off" className={FIELD_CLASS} />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-card-foreground">תת־קבוצה</span>
        <select name="courseGroupId" required defaultValue="" className={FIELD_CLASS}>
          <option value="" disabled>
            בחרו תת־קבוצה…
          </option>
          {subgroups.map((subgroup) => (
            <option key={subgroup.id} value={subgroup.id}>
              {subgroup.label}
            </option>
          ))}
        </select>
      </label>

      <p className="rounded-lg bg-warning-muted px-3 py-2 text-sm font-medium text-warning">
        {"החניך יתווסף לקורס במצב הכנה (לא פעיל) ולא יוכל להתחבר למערכת עד להפעלה בשלב מאוחר יותר."}
      </p>

      <div>
        <NewTraineeSubmitButton />
      </div>
    </form>
  );
}
