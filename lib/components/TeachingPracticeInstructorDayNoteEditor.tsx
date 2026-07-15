"use client";

import { useRef, useState, useTransition } from "react";
import { Button } from "@/lib/components/Button";
import { Modal } from "@/lib/components/Modal";
import { formatHebrewDate, formatHebrewWeekday, parseDateKey } from "@/lib/dates";
import { saveMyTeachingPracticeDayNote } from "@/lib/actions/teaching-practice-instructor-day-notes";
import type { TeachingPracticeTypeValue } from "@/lib/teaching-practice-rotation";

const SECTION_NOTE_TITLES: Record<TeachingPracticeTypeValue, string> = {
  LUNGE: "הערה אישית — לונג׳",
  BEGINNER_PRIVATE: "הערה אישית — שיעורים פרטניים",
  BEGINNER_GROUP: "הערה אישית — שיעורים קבוצתיים",
};

// TP-DAY-NOTES editor - a compact per-(instructor, date, practiceType) note,
// private to the instructor (see TeachingPracticeInstructorDayNote's own
// schema comment). Mounted only while open (TeachingPracticeManager renders
// it conditionally on openNoteType), so every open starts a fresh draft from
// initialContent - a cancelled edit never lingers, and there is nothing to
// reset on close. Unlike TeachingPracticeFeedbackModal, backdrop/X close is
// a plain discard (no forced save-on-close) - these are the instructor's own
// notes, not a shared record other people are waiting to read.
export function TeachingPracticeInstructorDayNoteEditor({
  instructorId,
  date,
  practiceType,
  initialContent,
  onClose,
  onSaved,
}: {
  instructorId: string;
  date: string;
  practiceType: TeachingPracticeTypeValue;
  initialContent: string;
  onClose: () => void;
  onSaved: (practiceType: TeachingPracticeTypeValue, content: string) => void;
}) {
  const [draft, setDraft] = useState(initialContent);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startSaveTransition] = useTransition();
  // Synchronous guard (isSaving from useTransition only updates on the next
  // render) against a duplicate click landing a second save while the first
  // is still in flight - same convention as TeachingPracticeFeedbackModal.
  const isSavingRef = useRef(false);

  const hadInitialContent = initialContent.trim().length > 0;
  const isClearingExistingNote = hadInitialContent && draft.trim().length === 0;

  function handleSave() {
    if (isSavingRef.current) return;
    isSavingRef.current = true;
    setError(null);
    startSaveTransition(async () => {
      // date/practiceType/instructorId are exactly the props this editor was
      // opened with, captured in this closure - never re-read from ambient
      // state, so a date/section switch elsewhere can't retarget this save.
      const result = await saveMyTeachingPracticeDayNote(instructorId, {
        date,
        practiceType,
        content: draft,
      });
      isSavingRef.current = false;
      if (!result.success) {
        setError(result.error ?? "אירעה שגיאה בשמירת ההערה");
        return;
      }
      onSaved(practiceType, draft.trim());
    });
  }

  return (
    <Modal open title={SECTION_NOTE_TITLES[practiceType]} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium text-card-foreground">
          {formatHebrewWeekday(parseDateKey(date))} · {formatHebrewDate(parseDateKey(date))}
        </p>
        <p className="text-xs text-muted-foreground">
          הערה זו אישית ונשארת פרטית עבורך בלבד - היא אינה חלק ממשוב ההתנסות ואינה גלויה לחניכים או למנהלים.
        </p>
        <label className="flex flex-col gap-1 text-sm">
          תוכן ההערה
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={6}
            autoFocus
            disabled={isSaving}
            placeholder="הערה אישית לתאריך ולסעיף זה..."
            className="w-full resize-y whitespace-pre-wrap break-words rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-60"
          />
        </label>
        {error && <p className="whitespace-pre-line break-words text-sm text-danger">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSaving}>
            ביטול
          </Button>
          <Button type="button" onClick={handleSave} disabled={isSaving} className="min-w-24">
            {isSaving ? "שומר..." : isClearingExistingNote ? "מחיקת ההערה" : "שמירה"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
