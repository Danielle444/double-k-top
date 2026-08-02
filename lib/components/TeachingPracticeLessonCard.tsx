"use client";

import type {
  TeachingPracticeRoleValue,
  TeachingPracticeTypeValue,
} from "@/lib/teaching-practice-rotation";
import type { TeachingPracticeTraineeLessonRow } from "@/lib/actions/teaching-practice-student";
import { formatHebrewDate, formatHebrewWeekday, parseDateKey } from "@/lib/dates";
import { buildTelLink, buildWhatsAppLink } from "@/lib/phone-contact-links";

/**
 * EX-EXAM-TP-CARDS — the trainee "ההתנסויות שלי" lesson card, extracted
 * UNCHANGED from `app/student/StudentTeachingPracticeSection.tsx` (Stage S2's
 * card view) so it can be reused verbatim by BOTH the trainee Teaching-
 * Practice screen and the trainee exam schedule's "לו״ז שלי" view, rather
 * than the two drifting into two independently-maintained cards.
 *
 * This is a straight relocation, not a rewrite: every visible field, every
 * class name and every conditional below is byte-identical to the card that
 * shipped in Stage S2. `PRACTICE_TYPE_LABELS` and `SameParentBadge` are
 * exported (not re-implemented) so `StudentTeachingPracticeSection.tsx`'s own
 * remaining uses of them (the same-parent popup's practice-type label, and
 * `ChildNameCell`'s badge) stay the SAME single source, never a second copy
 * that could disagree with this card's own labels/styling.
 *
 * READ-ONLY BY CONSTRUCTION, exactly as before: no fetch, no Server Action,
 * no write of any kind. `onOpenSameParentPopup` is a plain callback the
 * caller owns; this file holds no popup state itself.
 */

// Read-only trainee surface - deliberately not sharing anything with
// lib/components/TeachingPracticeManager.tsx (the admin/instructor CRUD
// component), since that component's edit/publish affordances must never
// reach a trainee. Labels are duplicated locally rather than imported from
// there for the same reason.
export const PRACTICE_TYPE_LABELS: Record<TeachingPracticeTypeValue, string> = {
  LUNGE: "לונג׳",
  BEGINNER_PRIVATE: "שיעור פרטי מתחילים",
  BEGINNER_GROUP: "שיעור קבוצתי מתחילים",
};

const ROLE_LABELS: Record<TeachingPracticeRoleValue, string> = {
  LEAD_INSTRUCTOR: "מדריך ראשון",
  SECOND_INSTRUCTOR: "מדריך שני",
  ASSISTANT_INSTRUCTOR: "עוזר מדריך",
  EVALUATOR: "ממשב",
};

// Same "אותו הורה" wording/styling as the admin/instructor surface - never
// states siblinghood as fact, and never shows a phone number (names only,
// same as the rest of this card). stopPropagation keeps a badge tap from
// also triggering any future click behavior on the enclosing card/row.
export function SameParentBadge({
  otherNames,
  onClick,
}: {
  otherNames: string[];
  onClick: () => void;
}) {
  if (otherNames.length === 0) return null;
  return (
    <span
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="mr-1 cursor-pointer rounded-full bg-warning-muted px-1.5 py-0.5 text-[10px] font-medium text-warning hover:opacity-80"
      title={`אותו הורה/איש קשר כמו: ${otherNames.join(", ")}`}
    >
      אותו הורה
    </span>
  );
}

// "ההתנסויות שלי" - unchanged Stage S2 card view.
export function TeachingPracticeLessonCard({
  lesson,
  sameParentOtherNamesByChildId,
  onOpenSameParentPopup,
}: {
  lesson: TeachingPracticeTraineeLessonRow;
  sameParentOtherNamesByChildId: Map<string, string[]>;
  onOpenSameParentPopup: (childId: string) => void;
}) {
  return (
    <div className="rounded-xl border-2 border-border p-4">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-1.5">
        <span className="text-base font-semibold text-card-foreground">
          {formatHebrewWeekday(parseDateKey(lesson.date))} · {formatHebrewDate(parseDateKey(lesson.date))}
        </span>
        <span className="rounded-full bg-muted px-3 py-1 text-sm text-muted-foreground">
          {lesson.startTime}-{lesson.endTime}
        </span>
      </div>

      <p className="text-lg font-bold text-card-foreground">
        {PRACTICE_TYPE_LABELS[lesson.practiceType]}
      </p>

      {/* responsibleInstructorName is intentionally not rendered here (Stage
          S2 product decision, display-only) - the field itself is still
          returned by the server action untouched, so this can be
          re-enabled later with no data change. */}
      {lesson.location && (
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
          <span>מיקום: {lesson.location}</span>
        </div>
      )}

      {lesson.participants.length > 0 && (
        <div className="mt-3 border-t border-border pt-2">
          <p className="mb-1 text-sm font-semibold text-muted-foreground">צוות</p>
          <ul className="flex flex-col gap-1">
            {lesson.participants.map((p) => (
              <li
                key={p.traineeId}
                className={`text-sm ${
                  p.isSelf
                    ? "rounded-lg bg-secondary px-2 py-1 font-bold text-secondary-foreground"
                    : "text-card-foreground"
                }`}
              >
                {p.traineeName} - {ROLE_LABELS[p.role]}
                {p.isSelf && " (את/ה)"}
              </li>
            ))}
          </ul>
        </div>
      )}

      {lesson.children.length > 0 && (
        <div className="mt-3 border-t border-border pt-2">
          <p className="mb-1 text-sm font-semibold text-muted-foreground">ילדים</p>
          <ul className="flex flex-col gap-2">
            {lesson.children.map((c) => {
              const telLink = c.parentPhone ? buildTelLink(c.parentPhone) : null;
              const waLink = c.parentPhone ? buildWhatsAppLink(c.parentPhone) : null;
              return (
                <li key={c.childId} className="rounded-lg bg-muted p-2 text-sm text-card-foreground">
                  <p className="font-semibold">
                    {c.firstName}
                    {c.lastName ? ` ${c.lastName}` : ""}
                    {c.age != null || c.gender ? " · " : ""}
                    {c.age != null ? `גיל ${c.age}` : ""}
                    {c.age != null && c.gender ? " · " : ""}
                    {c.gender ?? ""}
                    <SameParentBadge
                      otherNames={sameParentOtherNamesByChildId.get(c.childId) ?? []}
                      onClick={() => onOpenSameParentPopup(c.childId)}
                    />
                  </p>
                  {(c.horseName || c.equipmentNotes) && (
                    <p className="text-muted-foreground">
                      {c.horseName ? `סוס: ${c.horseName}` : ""}
                      {c.horseName && c.equipmentNotes ? " · " : ""}
                      {c.equipmentNotes ? `ציוד: ${c.equipmentNotes}` : ""}
                    </p>
                  )}
                  {(c.parentName || c.parentPhone) && (
                    <p className="text-muted-foreground">
                      {c.parentName ? `הורה: ${c.parentName}` : ""}
                      {c.parentName && c.parentPhone ? " · " : ""}
                      {c.parentPhone ? `טלפון: ${c.parentPhone}` : ""}
                    </p>
                  )}
                  {(telLink || waLink) && (
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {telLink && (
                        <a
                          href={telLink}
                          className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground hover:opacity-80"
                        >
                          התקשר
                        </a>
                      )}
                      {waLink && (
                        <a
                          href={waLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-full bg-success-muted px-2 py-0.5 text-xs font-medium text-success hover:opacity-80"
                        >
                          WhatsApp
                        </a>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
