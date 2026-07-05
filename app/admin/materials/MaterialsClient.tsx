"use client";

import { FormEvent, useRef, useState, useTransition } from "react";
import { Button } from "@/lib/components/Button";
import { Modal } from "@/lib/components/Modal";
import {
  createLinkMaterial,
  getMaterialsForAdmin,
  setMaterialActive,
  updateMaterial,
  type AdminMaterialRow,
  type CourseMaterialTypeValue,
  type CourseMaterialVisibilityValue,
} from "@/lib/actions/materials";
import { formatHebrewDateTime } from "@/lib/dates";

const TYPE_LABELS: Record<CourseMaterialTypeValue, string> = {
  FILE: "קובץ",
  LINK: "קישור",
};

const VISIBILITY_LABELS: Record<CourseMaterialVisibilityValue, string> = {
  STUDENTS: "תלמידים",
  INSTRUCTORS: "מדריכים",
  BOTH: "כולם",
};

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

  function handleCreateSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (createType === "LINK") {
      startTransition(async () => {
        const result = await createLinkMaterial({
          title,
          description: description || undefined,
          visibility,
          externalUrl,
        });
        if (!result.success) {
          setError(result.error ?? "אירעה שגיאה");
          return;
        }
        await refreshList();
        setIsCreateOpen(false);
      });
      return;
    }

    const formData = new FormData(e.currentTarget);
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
    </div>
  );
}
