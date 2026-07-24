"use client";

import { FormEvent, useRef, useState, useTransition } from "react";
import { Button } from "@/lib/components/Button";
import { Modal } from "@/lib/components/Modal";
import { ConfirmModal } from "@/lib/components/ConfirmModal";
import {
  createLinkMaterial,
  getMaterialsForAdmin,
  setMaterialActive,
  updateMaterial,
  type AdminMaterialRow,
  type CourseMaterialTypeValue,
  type CourseMaterialVisibilityValue,
  type CreateLinkMaterialInput,
} from "@/lib/actions/materials";
// LAUNCH-WARNING - this is an accidental-send warning only, not course-scoped
// containment. Remove after message and material notification fanout are wired
// to the roster-authoritative course-scoped resolvers.
import {
  FANOUT_WARNING_CANCEL_LABEL,
  MATERIAL_FANOUT_WARNING_CONFIRM_LABEL,
  MATERIAL_FANOUT_WARNING_TEXT,
  MATERIAL_FANOUT_WARNING_TITLE,
} from "@/lib/course/launch-fanout-warning-text";
import { formatHebrewDateTime } from "@/lib/dates";

const TYPE_LABELS: Record<CourseMaterialTypeValue, string> = {
  FILE: "קובץ",
  LINK: "קישור",
};

const VISIBILITY_LABELS: Record<CourseMaterialVisibilityValue, string> = {
  STUDENTS: "חניכים",
  INSTRUCTORS: "מדריכים",
  BOTH: "כולם",
};

// LAUNCH-WARNING - exactly the two visibilities for which
// createMaterialAddedNotifications fans a MATERIAL_ADDED notification out to
// students. INSTRUCTORS-only creates no student notification at all, so that
// path must stay direct and warning-free rather than training the admin to click
// through a warning that does not apply.
function materialCreateNotifiesStudents(visibility: CourseMaterialVisibilityValue): boolean {
  return visibility === "STUDENTS" || visibility === "BOTH";
}

// LAUNCH-WARNING - a staged, not-yet-performed NEW material creation. The LINK
// payload is a plain snapshot; the FILE payload deliberately is NOT here - a
// FormData must be built synchronously from the live form element and lives in a
// ref (see stagedFileFormDataRef).
type StagedMaterialCreate =
  | { kind: "LINK"; input: CreateLinkMaterialInput }
  | { kind: "FILE" };

export function MaterialsClient({ materials }: { materials: AdminMaterialRow[] }) {
  const [items, setItems] = useState(materials);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createType, setCreateType] = useState<CourseMaterialTypeValue>("LINK");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<CourseMaterialVisibilityValue>("BOTH");
  const [externalUrl, setExternalUrl] = useState("");

  const [editTarget, setEditTarget] = useState<AdminMaterialRow | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editVisibility, setEditVisibility] = useState<CourseMaterialVisibilityValue>("BOTH");
  const [editExternalUrl, setEditExternalUrl] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [isEditPending, startEditTransition] = useTransition();
  const editFileInputRef = useRef<HTMLInputElement>(null);

  // LAUNCH-WARNING - staged NEW-material creation awaiting confirmation. Non-null
  // means the warning is on screen and nothing has been created yet.
  const [pendingCreate, setPendingCreate] = useState<StagedMaterialCreate | null>(null);
  // LAUNCH-WARNING - the FILE create's multipart body. It MUST be built
  // synchronously from e.currentTarget inside handleCreateSubmit (React nulls
  // currentTarget once the handler returns), so it cannot be reconstructed in the
  // confirm callback. It is held here, out of React state, and cleared on both
  // cancel and confirm.
  const stagedFileFormDataRef = useRef<FormData | null>(null);

  async function refreshList() {
    const fresh = await getMaterialsForAdmin();
    setItems(fresh);
  }

  function openCreate() {
    setCreateType("LINK");
    setTitle("");
    setDescription("");
    setVisibility("BOTH");
    setExternalUrl("");
    setError(null);
    // LAUNCH-WARNING - a fresh composer never inherits a previously staged
    // creation, so the warning is always shown again. Nothing is persisted.
    setPendingCreate(null);
    stagedFileFormDataRef.current = null;
    setIsCreateOpen(true);
  }

  function openEdit(material: AdminMaterialRow) {
    setEditTarget(material);
    setEditTitle(material.title);
    setEditDescription(material.description ?? "");
    setEditVisibility(material.visibility);
    setEditExternalUrl(material.externalUrl ?? "");
    setEditError(null);
  }

  // The actual LINK creation - unchanged behaviour, extracted so it can run
  // either directly (INSTRUCTORS-only, no warning) or from the confirm handler.
  function performLinkCreate(input: CreateLinkMaterialInput) {
    startTransition(async () => {
      const result = await createLinkMaterial(input);
      if (!result.success) {
        setError(result.error ?? "אירעה שגיאה");
        return;
      }
      await refreshList();
      setIsCreateOpen(false);
    });
  }

  // The actual FILE creation - unchanged upload behaviour, driven by an
  // already-built FormData (never e.currentTarget, which is gone by confirm time).
  function performFileCreate(formData: FormData) {
    startTransition(async () => {
      try {
        const response = await fetch("/api/admin/materials/upload", {
          method: "POST",
          body: formData,
        });
        const result = await response.json();
        if (!result.success) {
          setError(result.error ?? "אירעה שגיאה בהעלאה");
          return;
        }
        await refreshList();
        setIsCreateOpen(false);
      } catch {
        setError("אירעה שגיאה בהעלאה - בדקו את החיבור ונסו שוב");
      }
    });
  }

  // LAUNCH-WARNING - creating a NEW material. The FormData for a FILE create is
  // built SYNCHRONOUSLY from the live form here, before this handler returns,
  // because React nulls e.currentTarget afterwards. When the chosen visibility
  // does NOT notify students (INSTRUCTORS-only) the create runs immediately with
  // no warning; otherwise it is staged and the warning is opened, and the create
  // Server Action / upload runs only from confirmCreate.
  function handleCreateSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const notifiesStudents = materialCreateNotifiesStudents(visibility);

    if (createType === "LINK") {
      const input: CreateLinkMaterialInput = {
        title,
        description: description || undefined,
        visibility,
        externalUrl,
      };
      if (!notifiesStudents) {
        performLinkCreate(input);
        return;
      }
      setPendingCreate({ kind: "LINK", input });
      return;
    }

    // FILE - capture the multipart body NOW, from the live form element.
    const formData = new FormData(e.currentTarget);
    if (!notifiesStudents) {
      performFileCreate(formData);
      return;
    }
    stagedFileFormDataRef.current = formData;
    setPendingCreate({ kind: "FILE" });
  }

  // LAUNCH-WARNING - the ✕, the backdrop and "ביטול" all land here. Clearing the
  // staged creation and the staged FormData closes the warning and creates
  // nothing.
  function cancelCreate() {
    setPendingCreate(null);
    stagedFileFormDataRef.current = null;
  }

  // LAUNCH-WARNING - the only place a NOTIFYING create is performed. The staged
  // work is captured into locals and cleared FIRST (closing the warning before
  // the transition starts), so a double-click finds no confirm button;
  // disabled={isPending} guards it as a second layer.
  function confirmCreate() {
    const staged = pendingCreate;
    if (!staged) return;
    if (staged.kind === "LINK") {
      setPendingCreate(null);
      stagedFileFormDataRef.current = null;
      setError(null);
      performLinkCreate(staged.input);
      return;
    }
    const formData = stagedFileFormDataRef.current;
    setPendingCreate(null);
    stagedFileFormDataRef.current = null;
    setError(null);
    if (!formData) {
      // Defensive: a staged FILE create with no captured body cannot proceed.
      setError("אירעה שגיאה בהעלאה - נסו שוב");
      return;
    }
    performFileCreate(formData);
  }

  function handleEditSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editTarget) return;
    setEditError(null);
    const materialId = editTarget.id;

    if (editTarget.materialType === "FILE" && editFileInputRef.current?.files?.length) {
      const formData = new FormData();
      formData.set("materialId", materialId);
      formData.set("title", editTitle);
      formData.set("description", editDescription);
      formData.set("visibility", editVisibility);
      formData.set("file", editFileInputRef.current.files[0]);
      startEditTransition(async () => {
        try {
          const response = await fetch("/api/admin/materials/upload", {
            method: "POST",
            body: formData,
          });
          const result = await response.json();
          if (!result.success) {
            setEditError(result.error ?? "אירעה שגיאה בהעלאה");
            return;
          }
          await refreshList();
          setEditTarget(null);
        } catch {
          setEditError("אירעה שגיאה בהעלאה - בדקו את החיבור ונסו שוב");
        }
      });
      return;
    }

    startEditTransition(async () => {
      const result = await updateMaterial(materialId, {
        title: editTitle,
        description: editDescription || undefined,
        visibility: editVisibility,
        externalUrl: editTarget.materialType === "LINK" ? editExternalUrl : undefined,
      });
      if (!result.success) {
        setEditError(result.error ?? "אירעה שגיאה");
        return;
      }
      await refreshList();
      setEditTarget(null);
    });
  }

  function handleToggleActive(material: AdminMaterialRow) {
    startTransition(async () => {
      await setMaterialActive(material.id, !material.isActive);
      await refreshList();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button onClick={openCreate}>+ הוספת מסמך/קישור</Button>
      </div>

      <div className="flex flex-col gap-3">
        {items.length === 0 && (
          <p className="rounded-xl border border-border bg-card p-5 text-center text-muted-foreground">
            עדיין לא נוספו מסמכים או קישורים
          </p>
        )}
        {items.map((m) => (
          <div key={m.id} className="rounded-xl border border-border bg-card p-4">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground">
                  {TYPE_LABELS[m.materialType]}
                </span>
                <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                  {VISIBILITY_LABELS[m.visibility]}
                </span>
                {!m.isActive && (
                  <span className="rounded-full bg-danger-muted px-2.5 py-1 text-xs font-medium text-danger">
                    מוסתר
                  </span>
                )}
                <p className="text-base font-bold text-card-foreground">{m.title}</p>
              </div>
              <p className="text-xs text-muted-foreground">
                {formatHebrewDateTime(new Date(m.createdAt))}
              </p>
            </div>
            {m.description && (
              <p className="mb-2 whitespace-pre-wrap text-sm text-muted-foreground">{m.description}</p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <div className="text-muted-foreground">
                {m.materialType === "LINK" ? (
                  <a
                    href={m.externalUrl ?? "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent underline"
                  >
                    {m.externalUrl}
                  </a>
                ) : (
                  <span className="flex items-center gap-2">
                    {m.fileName}
                    {m.viewUrl && (
                      <a
                        href={m.viewUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent underline"
                      >
                        צפייה
                      </a>
                    )}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" className="!px-2 !py-1" onClick={() => openEdit(m)}>
                  עריכה
                </Button>
                <Button
                  variant={m.isActive ? "danger" : "secondary"}
                  className="!px-2 !py-1"
                  disabled={isPending}
                  onClick={() => handleToggleActive(m)}
                >
                  {m.isActive ? "הסתרה" : "הצגה"}
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <Modal open={isCreateOpen} title="הוספת מסמך/קישור" onClose={() => setIsCreateOpen(false)}>
        <form onSubmit={handleCreateSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="createType"
                value="LINK"
                checked={createType === "LINK"}
                onChange={() => setCreateType("LINK")}
              />
              קישור
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="createType"
                value="FILE"
                checked={createType === "FILE"}
                onChange={() => setCreateType("FILE")}
              />
              קובץ (PDF)
            </label>
          </div>

          <label className="flex flex-col gap-1 text-sm">
            כותרת
            <input
              name="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="rounded-lg border border-border px-3 py-2 text-sm"
              required
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            תיאור (אופציונלי)
            <textarea
              name="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="rounded-lg border border-border px-3 py-2 text-sm"
            />
          </label>

          {createType === "LINK" ? (
            <label key="url-field" className="flex flex-col gap-1 text-sm">
              כתובת URL
              <input
                name="externalUrl"
                value={externalUrl}
                onChange={(e) => setExternalUrl(e.target.value)}
                placeholder="https://..."
                className="rounded-lg border border-border px-3 py-2 text-sm"
                required
              />
            </label>
          ) : (
            <label key="file-field" className="flex flex-col gap-1 text-sm">
              קובץ PDF
              <input
                type="file"
                name="file"
                accept="application/pdf,.pdf"
                required
                className="rounded-lg border border-border px-3 py-2 text-sm"
              />
            </label>
          )}

          <div className="flex flex-col gap-2 text-sm">
            <p className="font-medium text-card-foreground">קהל יעד</p>
            {(Object.keys(VISIBILITY_LABELS) as CourseMaterialVisibilityValue[]).map((key) => (
              <label key={key} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="visibility"
                  value={key}
                  checked={visibility === key}
                  onChange={() => setVisibility(key)}
                />
                {VISIBILITY_LABELS[key]}
              </label>
            ))}
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setIsCreateOpen(false)}>
              ביטול
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "שומר..." : "שמירה"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={editTarget !== null}
        title={editTarget ? `עריכת ${TYPE_LABELS[editTarget.materialType]}` : ""}
        onClose={() => setEditTarget(null)}
      >
        <form onSubmit={handleEditSubmit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            כותרת
            <input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              className="rounded-lg border border-border px-3 py-2 text-sm"
              required
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            תיאור (אופציונלי)
            <textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              rows={3}
              className="rounded-lg border border-border px-3 py-2 text-sm"
            />
          </label>

          {editTarget?.materialType === "LINK" ? (
            <label key="edit-url-field" className="flex flex-col gap-1 text-sm">
              כתובת URL
              <input
                value={editExternalUrl}
                onChange={(e) => setEditExternalUrl(e.target.value)}
                placeholder="https://..."
                className="rounded-lg border border-border px-3 py-2 text-sm"
                required
              />
            </label>
          ) : (
            <label key="edit-file-field" className="flex flex-col gap-1 text-sm">
              החלפת קובץ (אופציונלי) - קובץ נוכחי: {editTarget?.fileName ?? "-"}
              <input
                ref={editFileInputRef}
                type="file"
                accept="application/pdf,.pdf"
                className="rounded-lg border border-border px-3 py-2 text-sm"
              />
            </label>
          )}

          <div className="flex flex-col gap-2 text-sm">
            <p className="font-medium text-card-foreground">קהל יעד</p>
            {(Object.keys(VISIBILITY_LABELS) as CourseMaterialVisibilityValue[]).map((key) => (
              <label key={key} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="editVisibility"
                  value={key}
                  checked={editVisibility === key}
                  onChange={() => setEditVisibility(key)}
                />
                {VISIBILITY_LABELS[key]}
              </label>
            ))}
          </div>

          {editError && <p className="text-sm text-danger">{editError}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setEditTarget(null)}>
              ביטול
            </Button>
            <Button type="submit" disabled={isEditPending}>
              {isEditPending ? "שומר..." : "שמירה"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* LAUNCH-WARNING - shown only for a NEW material whose visibility notifies
          students (STUDENTS/BOTH). Accidental-add warning only, not course-scoped
          containment. */}
      <ConfirmModal
        open={pendingCreate !== null}
        title={MATERIAL_FANOUT_WARNING_TITLE}
        message={MATERIAL_FANOUT_WARNING_TEXT}
        confirmLabel={MATERIAL_FANOUT_WARNING_CONFIRM_LABEL}
        cancelLabel={FANOUT_WARNING_CANCEL_LABEL}
        isPending={isPending}
        onConfirm={confirmCreate}
        onCancel={cancelCreate}
      />
    </div>
  );
}
