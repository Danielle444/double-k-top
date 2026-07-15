"use client";

import { useState, useTransition } from "react";
import { formatHebrewDateTime } from "@/lib/dates";
import type { ActionResult } from "@/lib/actions/students";
import type { StudentGeneralNoteRow } from "@/lib/actions/student-general-notes";

// Stage N2 - admin UI for StudentGeneralNote (Stage N1's schema/actions).
// Extracted into its own component now, same Stage I2 extraction precedent
// as RidingProgressFeedbackSection/LungeProgressFeedbackSection (see those
// files' own comments) - even though there's no instructor variant yet, this
// keeps the door open for one later with no re-extraction needed. `actions`
// is parameterized the same way those two are.
//
// Unlike every sibling progress-feedback list (each has a date + rating/
// score + several context fields), a general note is just one field
// (content), so the add box here is a single always-visible textarea +
// submit button, not a click-to-reveal multi-field form like
// PresentationProgressEntryForm/LungeProgressEntryForm.

export interface StudentGeneralNotesActions {
  create: (studentId: string, content: string) => Promise<ActionResult>;
  update: (noteId: string, content: string) => Promise<ActionResult>;
  // Optional - the instructor trainee-progress detail view has no delete
  // action for general notes (stays manager-only for this stage, see this
  // stage's implementation report for the smallest-safe-deletion-rule note
  // flagged separately). When omitted, the delete button is hidden entirely
  // rather than rendered pointing at nothing.
  delete?: (noteId: string) => Promise<ActionResult>;
}

// A note only ever gets a distinct "updated" line once it's actually been
// edited after creation - updatedAt is only ever touched by
// updateStudentGeneralNoteAsAdmin (never a no-op resave), so comparing the
// two timestamps is an exact signal, not a heuristic.
function wasEdited(row: StudentGeneralNoteRow): boolean {
  return row.updatedAt !== row.createdAt;
}

export function StudentGeneralNotesSection({
  studentId,
  rows,
  onChanged,
  actions,
}: {
  studentId: string;
  rows: StudentGeneralNoteRow[];
  onChanged: () => void;
  actions: StudentGeneralNotesActions;
}) {
  const [draft, setDraft] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [isAddPending, startAddTransition] = useTransition();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [isEditPending, startEditTransition] = useTransition();

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<{ id: string; message: string } | null>(null);
  const [, startDeleteTransition] = useTransition();

  function handleAdd() {
    const content = draft.trim();
    if (!content) {
      setAddError("יש להזין תוכן להערה");
      return;
    }
    setAddError(null);
    startAddTransition(async () => {
      const result = await actions.create(studentId, content);
      if (!result.success) {
        setAddError(result.error ?? "אירעה שגיאה");
        return;
      }
      setDraft("");
      onChanged();
    });
  }

  function startEdit(row: StudentGeneralNoteRow) {
    setEditingId(row.id);
    setEditDraft(row.content);
    setEditError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditError(null);
  }

  function handleEdit(id: string) {
    const content = editDraft.trim();
    if (!content) {
      setEditError("יש להזין תוכן להערה");
      return;
    }
    setEditError(null);
    startEditTransition(async () => {
      const result = await actions.update(id, content);
      if (!result.success) {
        setEditError(result.error ?? "אירעה שגיאה");
        return;
      }
      setEditingId(null);
      onChanged();
    });
  }

  // Same shape as every sibling list's own handleDelete - window.confirm,
  // clears any open edit form for the same row on success, never touches the
  // Student row or any other feedback record (see the action's own comment).
  function handleDelete(id: string) {
    if (!actions.delete) return;
    if (!window.confirm("למחוק את ההערה הזו? לא ניתן לשחזר את הפעולה.")) return;
    setDeleteError(null);
    setDeletingId(id);
    startDeleteTransition(async () => {
      const result = await actions.delete!(id);
      if (!result.success) {
        setDeleteError({ id, message: result.error ?? "אירעה שגיאה" });
        setDeletingId(null);
        return;
      }
      if (editingId === id) {
        setEditingId(null);
        setEditError(null);
      }
      setDeletingId(null);
      onChanged();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          placeholder="הוספת הערה כללית..."
          className="rounded-lg border border-border px-2 py-1.5 text-sm"
        />
        {addError && <p className="text-xs text-danger">{addError}</p>}
        <button
          type="button"
          disabled={isAddPending}
          onClick={handleAdd}
          className="self-start rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {isAddPending ? "שומר..." : "הוספת הערה"}
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
          עדיין לא נכתבו הערות כלליות לחניך/ה זה/זו.
        </p>
      ) : (
        rows.map((row) =>
          editingId === row.id ? (
            <div
              key={row.id}
              className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3"
            >
              <textarea
                value={editDraft}
                onChange={(e) => setEditDraft(e.target.value)}
                rows={2}
                className="rounded-lg border border-border px-2 py-1.5 text-sm"
              />
              {editError && <p className="text-xs text-danger">{editError}</p>}
              {deleteError?.id === row.id && (
                <p className="text-xs text-danger">{deleteError.message}</p>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={isEditPending}
                  onClick={() => handleEdit(row.id)}
                  className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {isEditPending ? "שומר..." : "שמירה"}
                </button>
                <button
                  type="button"
                  onClick={cancelEdit}
                  className="rounded-lg bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/70"
                >
                  ביטול
                </button>
                {actions.delete && (
                  <button
                    type="button"
                    disabled={deletingId === row.id}
                    onClick={() => handleDelete(row.id)}
                    className="rounded-lg px-3 py-1.5 text-xs font-medium text-danger underline hover:opacity-80 disabled:opacity-50"
                  >
                    {deletingId === row.id ? "מוחק..." : "מחיקה"}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div key={row.id} className="rounded-xl border border-border bg-card p-4">
              <p className="whitespace-pre-wrap text-sm text-card-foreground">{row.content}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                {row.createdByName && `נוצר על ידי: ${row.createdByName} · `}
                נוצר בתאריך: {formatHebrewDateTime(new Date(row.createdAt))}
                {wasEdited(row) && (
                  <>
                    {" · "}
                    {row.updatedByName && `עודכן על ידי: ${row.updatedByName} · `}
                    עודכן בתאריך: {formatHebrewDateTime(new Date(row.updatedAt))}
                  </>
                )}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => startEdit(row)}
                  className="text-xs font-medium text-secondary-foreground underline hover:opacity-80"
                >
                  עריכה
                </button>
                {actions.delete && (
                  <button
                    type="button"
                    disabled={deletingId === row.id}
                    onClick={() => handleDelete(row.id)}
                    className="text-xs font-medium text-danger underline hover:opacity-80 disabled:opacity-50"
                  >
                    {deletingId === row.id ? "מוחק..." : "מחיקה"}
                  </button>
                )}
              </div>
              {deleteError?.id === row.id && (
                <p className="mt-1 text-xs text-danger">{deleteError.message}</p>
              )}
            </div>
          )
        )
      )}
    </div>
  );
}
