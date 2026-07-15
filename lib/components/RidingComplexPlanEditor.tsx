"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/lib/components/Button";
import { Modal } from "@/lib/components/Modal";
import { SuggestInput } from "@/lib/components/SuggestInput";
import { formatHebrewDate, formatHebrewDateTime, parseDateKey } from "@/lib/dates";
import { cleanScheduleTitle } from "@/lib/schedule-title";
import { groupByGroupAndSubgroup } from "@/lib/attendance-ui";
import {
  getRidingSlotComplexPlanForAdmin,
  getRidingSlotComplexPlanForInstructor,
  saveRidingSlotComplexBlockAsAdmin,
  saveRidingSlotComplexBlockAsInstructor,
  deleteRidingSlotComplexBlockAsAdmin,
  deleteRidingSlotComplexBlockAsInstructor,
  duplicateRidingSlotComplexBlockAsAdmin,
  duplicateRidingSlotComplexBlockAsInstructor,
  reorderRidingSlotComplexBlocksAsAdmin,
  reorderRidingSlotComplexBlocksAsInstructor,
  deleteRidingSlotComplexPlanAsAdmin,
  type RidingSlotComplexPlanForEditing,
  type RidingSlotComplexPlanRow,
  type RidingSlotComplexBlockRow,
  type RidingSlotComplexTraineeCandidate,
  type RidingSlotComplexSaveWarnings,
  type RidingSlotComplexBlockSaveInput,
  type RidingSlotComplexPlanActionResult,
} from "@/lib/actions/riding-slot-complex";

type InstructorOption = { id: string; fullName: string };

// Narrow discriminated actor - lets this editor be reused unchanged by a
// future instructor screen (P3b) without a structural rewrite. Every P2
// operation has an admin/instructor pair with a different parameter shape
// (the instructor variant takes instructorId first) - these five small
// private routing helpers are the only place that difference is handled,
// so the rest of the component (and the JSX below) never branches on actor
// type except for permission/UI gating (canEdit, whole-plan deletion).
export type RidingComplexPlanEditorActor = { type: "admin" } | { type: "instructor"; instructorId: string };

function readComplexPlan(
  actor: RidingComplexPlanEditorActor,
  ridingSlotId: string
): Promise<RidingSlotComplexPlanForEditing | null> {
  return actor.type === "admin"
    ? getRidingSlotComplexPlanForAdmin(ridingSlotId)
    : getRidingSlotComplexPlanForInstructor(actor.instructorId, ridingSlotId);
}

function saveComplexBlock(
  actor: RidingComplexPlanEditorActor,
  input: RidingSlotComplexBlockSaveInput
): Promise<RidingSlotComplexPlanActionResult> {
  return actor.type === "admin"
    ? saveRidingSlotComplexBlockAsAdmin(input)
    : saveRidingSlotComplexBlockAsInstructor(actor.instructorId, input);
}

function deleteComplexBlock(
  actor: RidingComplexPlanEditorActor,
  ridingSlotId: string,
  blockId: string
): Promise<RidingSlotComplexPlanActionResult> {
  return actor.type === "admin"
    ? deleteRidingSlotComplexBlockAsAdmin(ridingSlotId, blockId)
    : deleteRidingSlotComplexBlockAsInstructor(actor.instructorId, ridingSlotId, blockId);
}

function duplicateComplexBlock(
  actor: RidingComplexPlanEditorActor,
  ridingSlotId: string,
  blockId: string
): Promise<RidingSlotComplexPlanActionResult> {
  return actor.type === "admin"
    ? duplicateRidingSlotComplexBlockAsAdmin(ridingSlotId, blockId)
    : duplicateRidingSlotComplexBlockAsInstructor(actor.instructorId, ridingSlotId, blockId);
}

function reorderComplexBlocks(
  actor: RidingComplexPlanEditorActor,
  ridingSlotId: string,
  orderedBlockIds: string[]
): Promise<RidingSlotComplexPlanActionResult> {
  return actor.type === "admin"
    ? reorderRidingSlotComplexBlocksAsAdmin(ridingSlotId, orderedBlockIds)
    : reorderRidingSlotComplexBlocksAsInstructor(actor.instructorId, ridingSlotId, orderedBlockIds);
}

type LoadStatus = "loading" | "loaded" | "not-found" | "error";

// Readable Hebrew labels for the warnings P2 returns after a block save -
// informational only, never rendered as errors.
function buildWarningMessages(w: RidingSlotComplexSaveWarnings): string[] {
  const messages: string[] = [];
  if (w.noInstructors) messages.push("לא נבחרו מדריכים/ות לבלוק זה");
  if (w.noArena) messages.push("לא הוגדר מגרש לבלוק זה");
  if (w.zeroPairs) messages.push("לא נוספו זוגות לבלוק זה");
  if (w.pairsMissingTrainee2 > 0) messages.push(`${w.pairsMissingTrainee2} זוג/ות ללא חניכ/ה שני/ה`);
  if (w.pairsMissingHorse > 0) messages.push(`${w.pairsMissingHorse} זוג/ות ללא סוס`);
  return messages;
}

// Same incompleteness signal as buildWarningMessages, but computed live from
// a block's own current data (not tied to a save event) - every block card
// in the list shows this, not just the most-recently-saved one.
function blockIncompleteness(block: RidingSlotComplexBlockRow): string[] {
  const badges: string[] = [];
  if (block.instructors.length === 0) badges.push("ללא מדריכ/ה");
  if (!block.arena) badges.push("ללא מגרש");
  if (block.pairs.length === 0) badges.push("ללא זוגות");
  const missingTrainee2 = block.pairs.filter((p) => p.trainee1Id && !p.trainee2Id).length;
  if (missingTrainee2 > 0) badges.push(`${missingTrainee2} ללא חניכ/ה שני/ה`);
  const missingHorse = block.pairs.filter((p) => p.trainee1Id && !p.horseName).length;
  if (missingHorse > 0) badges.push(`${missingHorse} ללא סוס`);
  return badges;
}

function timeToMinutes(t: string): number {
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

// Single-select, searchable, group/subgroup-grouped trainee picker for one
// pair slot. Deliberately NOT the shared InstructorChecklist pattern from
// RidingSlotModal.tsx (that component keeps its own internal
// open/search/highlight state tied to one specific form shape) - this is a
// new, independent, single-select component, same "don't share a
// stateful checklist across features" convention already documented on
// TaughtStudentsChecklist in InstructorRidingSlotsSection.tsx.
function TraineePicker({
  candidates,
  value,
  onChange,
  placeholder,
}: {
  candidates: RidingSlotComplexTraineeCandidate[];
  value: string;
  onChange: (studentId: string) => void;
  placeholder: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handlePointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  const selected = candidates.find((c) => c.studentId === value) ?? null;
  const filtered = candidates.filter((c) => c.studentName.toLowerCase().includes(search.trim().toLowerCase()));
  const sections = groupByGroupAndSubgroup(filtered);

  return (
    <div ref={containerRef} className="relative min-w-0 flex-1">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="flex w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-right text-sm"
      >
        <span className="min-w-0 flex-1 truncate">
          {selected ? (
            <>
              <span className="font-medium text-card-foreground">{selected.studentName}</span>{" "}
              <span className="text-xs text-muted-foreground">
                {selected.groupName ? `קבוצה ${selected.groupName}` : "ללא קבוצה"}
                {selected.subgroupNumber != null ? ` / ${selected.subgroupNumber}` : ""}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
        </span>
        <span className="shrink-0 text-muted-foreground">▾</span>
      </button>
      {isOpen && (
        <div className="absolute z-10 mt-1 max-h-64 w-full min-w-[14rem] overflow-y-auto rounded-lg border border-border bg-card shadow-lg">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש חניכ/ה..."
            autoFocus
            className="w-full border-b border-border px-3 py-2 text-sm"
          />
          {value && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange("");
                setIsOpen(false);
                setSearch("");
              }}
              className="block w-full px-3 py-2 text-right text-sm text-danger hover:bg-muted"
            >
              נקה בחירה
            </button>
          )}
          {sections.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">לא נמצאו חניכים</p>
          ) : (
            sections.map((section) => (
              <div key={section.groupName ?? "__none__"}>
                <p className="bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
                  {section.groupName ? `קבוצה ${section.groupName}` : "ללא קבוצה"}
                </p>
                {section.subgroups.map((sub) => (
                  <div key={sub.subgroupNumber ?? "__none__"}>
                    {sub.items.map((c) => (
                      <button
                        key={c.studentId}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          onChange(c.studentId);
                          setIsOpen(false);
                          setSearch("");
                        }}
                        className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-right text-sm hover:bg-muted ${
                          c.studentId === value ? "bg-primary/10" : ""
                        }`}
                      >
                        <span className="min-w-0 flex-1 truncate font-medium text-card-foreground">
                          {c.studentName}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {sub.subgroupNumber != null ? `תת-קבוצה ${sub.subgroupNumber}` : ""}
                        </span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// Multi-select instructor checklist, local to this editor only - same
// deliberate non-sharing decision as TraineePicker above (see its own
// comment). Holds no selection state of its own: every checkbox reads
// selectedIds directly and toggling calls straight back out via onToggle.
function InstructorMultiSelect({
  instructors,
  selectedIds,
  onToggle,
}: {
  instructors: InstructorOption[];
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = instructors.filter((i) => i.fullName.toLowerCase().includes(search.trim().toLowerCase()));
  const selected = instructors.filter((i) => selectedIds.includes(i.id));

  return (
    <div className="flex flex-col gap-1.5">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((i) => (
            <span
              key={i.id}
              className="flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground"
            >
              {i.fullName}
              <button
                type="button"
                onClick={() => onToggle(i.id)}
                aria-label={`הסרת ${i.fullName}`}
                className="text-secondary-foreground/70 hover:text-secondary-foreground"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="חיפוש מדריכ/ה"
        className="rounded-lg border border-border px-3 py-2 text-sm"
      />
      <div className="flex max-h-40 flex-col gap-0.5 overflow-y-auto rounded-lg border border-border p-1.5">
        {filtered.length === 0 ? (
          <p className="px-1.5 py-1 text-xs text-muted-foreground">לא נמצאו מדריכים</p>
        ) : (
          filtered.map((i) => (
            <label key={i.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted">
              <input type="checkbox" checked={selectedIds.includes(i.id)} onChange={() => onToggle(i.id)} />
              {i.fullName}
            </label>
          ))
        )}
      </div>
    </div>
  );
}

interface PairDraft {
  key: number;
  trainee1Id: string;
  trainee2Id: string;
  horseName: string;
  note: string;
}

let pairDraftKeySeq = 0;
function newPairDraft(): PairDraft {
  pairDraftKeySeq += 1;
  return { key: pairDraftKeySeq, trainee1Id: "", trainee2Id: "", horseName: "", note: "" };
}

function pairDraftFromRow(row: RidingSlotComplexBlockRow["pairs"][number]): PairDraft {
  pairDraftKeySeq += 1;
  return {
    key: pairDraftKeySeq,
    trainee1Id: row.trainee1Id ?? "",
    trainee2Id: row.trainee2Id ?? "",
    horseName: row.horseName ?? "",
    note: row.note ?? "",
  };
}

// Client-side pre-checks only - mirrors the exact P2 hard-validation rules
// (same Hebrew text) so a mistake is caught before a round trip, but the
// server remains the sole authority; these never block typing/selecting,
// only the Save button (see "block Save, not editing" in the P3a spec).
function computeClientIssues(pairs: PairDraft[], startTime: string, endTime: string): string[] {
  const issues: string[] = [];

  if (timeToMinutes(endTime) <= timeToMinutes(startTime)) {
    issues.push("שעת הסיום חייבת להיות אחרי שעת ההתחלה");
  }

  const hasMalformed = pairs.some(
    (p) => !p.trainee1Id && (p.trainee2Id || p.horseName.trim() || p.note.trim())
  );
  if (hasMalformed) {
    issues.push("יש לבחור חניכ/ה ראשונ/ה לכל זוג שמכיל פרטים (סוס, הערה או חניכ/ה שני/ה)");
  }

  const meaningfulPairs = pairs.filter((p) => p.trainee1Id);

  if (meaningfulPairs.some((p) => p.trainee2Id && p.trainee2Id === p.trainee1Id)) {
    issues.push("לא ניתן לבחור את אותו/ה חניכ/ה פעמיים באותו זוג");
  }

  const traineeCounts = new Map<string, number>();
  for (const p of meaningfulPairs) {
    traineeCounts.set(p.trainee1Id, (traineeCounts.get(p.trainee1Id) ?? 0) + 1);
    if (p.trainee2Id) traineeCounts.set(p.trainee2Id, (traineeCounts.get(p.trainee2Id) ?? 0) + 1);
  }
  if (Array.from(traineeCounts.values()).some((c) => c > 1)) {
    issues.push("אותו/ה חניכ/ה נבחר/ה יותר מפעם אחת באותו בלוק");
  }

  const horseCounts = new Map<string, number>();
  for (const p of meaningfulPairs) {
    const h = p.horseName.trim();
    if (!h) continue;
    const key = h.toLowerCase();
    horseCounts.set(key, (horseCounts.get(key) ?? 0) + 1);
  }
  if (Array.from(horseCounts.values()).some((c) => c > 1)) {
    issues.push("אותו שם סוס נבחר יותר מפעם אחת באותו בלוק");
  }

  return issues;
}

// One pair row - stacks vertically on narrow screens (no wide table), large
// tap targets. Note field only shown expanded when non-empty or explicitly
// toggled, keeping the default row compact.
function PairRowEditor({
  pair,
  candidates,
  knownHorseNames,
  onChange,
  onRemove,
}: {
  pair: PairDraft;
  candidates: RidingSlotComplexTraineeCandidate[];
  knownHorseNames: string[];
  onChange: (next: PairDraft) => void;
  onRemove: () => void;
}) {
  const [showNote, setShowNote] = useState(Boolean(pair.note));

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-2.5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <TraineePicker
          candidates={candidates}
          value={pair.trainee1Id}
          onChange={(id) => onChange({ ...pair, trainee1Id: id })}
          placeholder="חניכ/ה 1"
        />
        <span className="hidden shrink-0 text-muted-foreground sm:inline">+</span>
        <TraineePicker
          candidates={candidates}
          value={pair.trainee2Id}
          onChange={(id) => onChange({ ...pair, trainee2Id: id })}
          placeholder="חניכ/ה 2 (אופציונלי)"
        />
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <SuggestInput
            value={pair.horseName}
            onChange={(v) => onChange({ ...pair, horseName: v })}
            suggestions={knownHorseNames}
            placeholder="סוס"
          />
        </div>
        <Button type="button" variant="ghost" className="!px-2 !py-1 !text-xs" onClick={() => setShowNote((v) => !v)}>
          {showNote ? "הסתרת הערה" : "הוספת הערה"}
        </Button>
        <Button type="button" variant="ghost" className="!px-2 !py-1 !text-xs text-danger" onClick={onRemove}>
          הסרת זוג
        </Button>
      </div>
      {showNote && (
        <input
          type="text"
          value={pair.note}
          onChange={(e) => onChange({ ...pair, note: e.target.value })}
          placeholder="הערה קצרה"
          className="w-full rounded-lg border border-border px-3 py-2 text-sm"
        />
      )}
    </div>
  );
}

// Shared editor for both a brand-new block and an existing one - keyed by
// the parent on editingBlockId, so switching targets always remounts fresh
// (see RidingComplexPlanEditor's own render below) rather than reusing
// stale draft state across two different blocks.
function BlockEditorForm({
  actor,
  ridingSlotId,
  block,
  canEdit,
  instructors,
  candidates,
  knownHorseNames,
  onSaved,
  onCancel,
}: {
  actor: RidingComplexPlanEditorActor;
  ridingSlotId: string;
  block: RidingSlotComplexBlockRow | null;
  // When false, this renders a read-only detail view instead (below) - a
  // read-only viewer only ever reaches this component via "צפייה" on an
  // EXISTING block (BlockCard.canEdit already hides "+ הוספת בלוק" entirely),
  // so `block` is always non-null in that branch.
  canEdit: boolean;
  instructors: InstructorOption[];
  candidates: RidingSlotComplexTraineeCandidate[];
  knownHorseNames: string[];
  onSaved: (plan: RidingSlotComplexPlanRow, warnings: RidingSlotComplexSaveWarnings) => void;
  onCancel: () => void;
}) {
  const [startTime, setStartTime] = useState(block?.startTime ?? "");
  const [endTime, setEndTime] = useState(block?.endTime ?? "");
  const [arena, setArena] = useState(block?.arena ?? "");
  const [instructorIds, setInstructorIds] = useState<string[]>(block?.instructorIds ?? []);
  const [pairs, setPairs] = useState<PairDraft[]>(block ? block.pairs.map(pairDraftFromRow) : []);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, startSaveTransition] = useTransition();
  const isSavingRef = useRef(false);

  function toggleInstructor(id: string) {
    setInstructorIds((current) => (current.includes(id) ? current.filter((v) => v !== id) : [...current, id]));
  }

  function updatePair(key: number, next: PairDraft) {
    setPairs((current) => current.map((p) => (p.key === key ? next : p)));
  }

  function removePair(key: number) {
    setPairs((current) => current.filter((p) => p.key !== key));
  }

  const clientIssues =
    startTime && endTime ? computeClientIssues(pairs, startTime, endTime) : [];
  const canSave = Boolean(startTime) && Boolean(endTime) && clientIssues.length === 0;

  function handleSave() {
    if (!canSave || isSavingRef.current) return;
    isSavingRef.current = true;
    setSaveError(null);
    startSaveTransition(async () => {
      const result = await saveComplexBlock(actor, {
        ridingSlotId,
        blockId: block ? block.id : undefined,
        startTime,
        endTime,
        arena,
        instructorIds,
        pairs: pairs.map((p) => ({
          trainee1Id: p.trainee1Id,
          trainee2Id: p.trainee2Id,
          horseName: p.horseName,
          note: p.note,
        })),
      });
      isSavingRef.current = false;
      if (!result.success || !result.plan) {
        setSaveError(result.error ?? "אירעה שגיאה בשמירה");
        return;
      }
      onSaved(result.plan, result.warnings ?? {
        noInstructors: instructorIds.length === 0,
        noArena: !arena,
        zeroPairs: pairs.filter((p) => p.trainee1Id).length === 0,
        pairsMissingTrainee2: 0,
        pairsMissingHorse: 0,
      });
    });
  }

  // Read-only detail view - same local state as the editable form above
  // (initialized from the same `block`), just rendered as static text with
  // no inputs, no Add/remove-pair, no instructor selection, no Save - only
  // a Close/Back button. This is the one small shared detail mode requested
  // instead of a second editor component; block is always non-null here
  // (see the canEdit prop's own comment above).
  if (!canEdit) {
    const selectedInstructorNames = instructors
      .filter((i) => instructorIds.includes(i.id))
      .map((i) => i.fullName);
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto ps-1 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <p>
              <span className="text-muted-foreground">שעת התחלה: </span>
              {startTime}
            </p>
            <p>
              <span className="text-muted-foreground">שעת סיום: </span>
              {endTime}
            </p>
          </div>
          <p>
            <span className="text-muted-foreground">מגרש: </span>
            {arena || "לא הוגדר מגרש"}
          </p>
          <p>
            <span className="text-muted-foreground">מדריכים/ות אחראים/ות: </span>
            {selectedInstructorNames.length > 0 ? selectedInstructorNames.join(", ") : "לא נבחרו מדריכים"}
          </p>

          <div className="flex flex-col gap-2">
            <p className="font-semibold text-card-foreground">זוגות</p>
            {pairs.length === 0 ? (
              <p className="text-muted-foreground">אין זוגות בבלוק זה</p>
            ) : (
              pairs.map((pair) => {
                const trainee1 = candidates.find((c) => c.studentId === pair.trainee1Id);
                const trainee2 = candidates.find((c) => c.studentId === pair.trainee2Id);
                return (
                  <div key={pair.key} className="flex flex-col gap-1 rounded-lg border border-border bg-card p-2.5">
                    <p className="font-medium text-card-foreground">
                      {trainee1?.studentName ?? "לא נבחר/ה"}
                      {trainee2 ? ` + ${trainee2.studentName}` : ""}
                    </p>
                    <p className="text-muted-foreground">סוס: {pair.horseName || "לא הוגדר"}</p>
                    {pair.note && <p className="text-muted-foreground">הערה: {pair.note}</p>}
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="flex shrink-0 justify-end">
          <Button type="button" variant="secondary" onClick={onCancel}>
            חזרה
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto ps-1">
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-sm">
            שעת התחלה
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="rounded-lg border border-border px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            שעת סיום
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="rounded-lg border border-border px-3 py-2 text-sm"
            />
          </label>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          מגרש
          <input
            type="text"
            value={arena}
            onChange={(e) => setArena(e.target.value)}
            placeholder="למשל: מגרש 1"
            className="rounded-lg border border-border px-3 py-2 text-sm"
          />
        </label>

        <div className="flex flex-col gap-1 text-sm">
          מדריכים/ות אחראים/ות
          <InstructorMultiSelect instructors={instructors} selectedIds={instructorIds} onToggle={toggleInstructor} />
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-card-foreground">זוגות</p>
            <Button
              type="button"
              variant="secondary"
              className="!px-2 !py-1 !text-xs"
              onClick={() => setPairs((current) => [...current, newPairDraft()])}
            >
              + הוספת זוג
            </Button>
          </div>
          {pairs.length === 0 ? (
            <p className="text-sm text-muted-foreground">אין עדיין זוגות בבלוק זה</p>
          ) : (
            <div className="flex flex-col gap-2">
              {pairs.map((pair) => (
                <PairRowEditor
                  key={pair.key}
                  pair={pair}
                  candidates={candidates}
                  knownHorseNames={knownHorseNames}
                  onChange={(next) => updatePair(pair.key, next)}
                  onRemove={() => removePair(pair.key)}
                />
              ))}
            </div>
          )}
        </div>

        {clientIssues.length > 0 && (
          <div className="rounded-lg border border-warning/40 bg-warning-muted/30 p-2.5 text-sm text-warning">
            {clientIssues.map((issue) => (
              <p key={issue}>{issue}</p>
            ))}
          </div>
        )}
        {saveError && <p className="text-sm text-danger">{saveError}</p>}
      </div>

      <div className="flex shrink-0 flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          ביטול
        </Button>
        <Button type="button" disabled={!canSave || isSaving} onClick={handleSave}>
          {isSaving ? "שומר..." : "שמירה"}
        </Button>
      </div>
    </div>
  );
}

function BlockCard({
  block,
  index,
  total,
  canEdit,
  onEdit,
  onDuplicate,
  onDelete,
  onMoveUp,
  onMoveDown,
  pendingDisabled,
}: {
  block: RidingSlotComplexBlockRow;
  index: number;
  total: number;
  // Gates only the mutating actions (duplicate/delete/reorder), which are
  // hidden entirely for a read-only viewer - "עריכה" itself is never
  // permission-gated, it just becomes "צפייה" and opens BlockEditorForm's
  // read-only detail branch instead of the editable one (see canEdit prop
  // on BlockEditorForm below).
  canEdit: boolean;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  // A block-level action already in flight (reorder/duplicate/delete) -
  // never permission-related, only re-entrancy protection.
  pendingDisabled: boolean;
}) {
  const instructorNames =
    block.instructors.length > 0 ? block.instructors.map((i) => i.fullName).join(", ") : "לא נבחרו מאמנים";
  const badges = blockIncompleteness(block);

  return (
    <div className="flex flex-col gap-2 rounded-xl border-2 border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <span className="text-base font-bold text-card-foreground">
          {block.startTime}–{block.endTime}
        </span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {block.pairs.length} זוגות
        </span>
      </div>
      <p className="truncate text-sm text-card-foreground">מגרש: {block.arena || "לא הוגדר מגרש"}</p>
      <p className="truncate text-sm text-muted-foreground">מדריכ/ה: {instructorNames}</p>
      {badges.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {badges.map((b) => (
            <span
              key={b}
              className="rounded-full bg-warning-muted px-2 py-0.5 text-[11px] font-medium text-warning"
            >
              {b}
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button variant="secondary" className="!px-2 !py-1 !text-xs" onClick={onEdit} disabled={pendingDisabled}>
          {canEdit ? "עריכה" : "צפייה"}
        </Button>
        {canEdit && (
          <>
            <Button
              variant="secondary"
              className="!px-2 !py-1 !text-xs"
              onClick={onDuplicate}
              disabled={pendingDisabled}
            >
              שכפול
            </Button>
            <Button variant="danger" className="!px-2 !py-1 !text-xs" onClick={onDelete} disabled={pendingDisabled}>
              מחיקה
            </Button>
            <span className="mx-1 h-5 w-px bg-border" />
            <Button
              variant="ghost"
              className="!px-2 !py-1 !text-xs"
              onClick={onMoveUp}
              disabled={pendingDisabled || index === 0}
              aria-label="הזזה למעלה"
            >
              ↑
            </Button>
            <Button
              variant="ghost"
              className="!px-2 !py-1 !text-xs"
              onClick={onMoveDown}
              disabled={pendingDisabled || index === total - 1}
              aria-label="הזזה למטה"
            >
              ↓
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

// Shared complex-session editor, opened as its own Modal exactly like
// RidingHorseListEditor - entirely self-contained (fetches on open, saves
// via the P2 actions routed through the actor prop) so the caller only
// needs to own the open/close boolean and pass ridingSlotId/instructors/actor.
// Reused unchanged by both the admin RidingSlotModal (P3a) and a future
// instructor screen (P3b) - every operation routes through the five small
// private helpers above; canEdit (server-returned) gates every mutating
// control, and whole-plan deletion stays admin-only regardless of canEdit.
export function RidingComplexPlanEditor({
  open,
  onClose,
  ridingSlotId,
  contextLabel,
  instructors,
  actor,
  onDeleted,
}: {
  open: boolean;
  onClose: () => void;
  ridingSlotId: string;
  contextLabel?: string;
  instructors: InstructorOption[];
  actor: RidingComplexPlanEditorActor;
  onDeleted: () => void;
}) {
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [editing, setEditing] = useState<RidingSlotComplexPlanForEditing | null>(null);
  const [view, setView] = useState<"blockList" | "editBlock">("blockList");
  const [editingBlockId, setEditingBlockId] = useState<string | "new" | null>(null);
  const [lastWarnings, setLastWarnings] = useState<RidingSlotComplexSaveWarnings | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [busyBlockId, setBusyBlockId] = useState<string | null>(null);
  const [isReordering, startReorderTransition] = useTransition();
  const [isDuplicating, startDuplicateTransition] = useTransition();
  const [isDeletingBlock, startDeleteBlockTransition] = useTransition();
  const [isDeletingPlan, startDeletePlanTransition] = useTransition();
  const [deletePlanError, setDeletePlanError] = useState<string | null>(null);

  const anyBlockActionPending = isReordering || isDuplicating || isDeletingBlock;

  // Resets ALL local state every time the modal opens (or targets a
  // different RidingSlot) - same convention as RidingHorseListEditor's own
  // load effect. `cancelled` guards against a stale response landing after
  // the target changed or the modal closed/unmounted.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus("loading");
    setEditing(null);
    setView("blockList");
    setEditingBlockId(null);
    setLastWarnings(null);
    setListError(null);
    setDeletePlanError(null);

    readComplexPlan(actor, ridingSlotId)
      .then((result) => {
        if (cancelled) return;
        if (!result) {
          setStatus("not-found");
          return;
        }
        setEditing(result);
        setStatus("loaded");
      })
      .catch(() => {
        if (cancelled) return;
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
    // actor is not included: it identifies WHO is looking, not WHAT is being
    // looked at - re-fetching only needs to react to open/ridingSlotId, same
    // as every other editor in this app keys its load effect on the target,
    // not the caller's own identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ridingSlotId]);

  function refreshPlan(plan: RidingSlotComplexPlanRow) {
    setEditing((prev) => (prev ? { ...prev, plan } : prev));
  }

  function handleBlockSaved(plan: RidingSlotComplexPlanRow, warnings: RidingSlotComplexSaveWarnings) {
    refreshPlan(plan);
    setLastWarnings(warnings);
    setView("blockList");
    setEditingBlockId(null);
  }

  function handleCancelBlockEdit() {
    setView("blockList");
    setEditingBlockId(null);
  }

  function handleDuplicate(blockId: string) {
    if (anyBlockActionPending) return;
    setListError(null);
    setBusyBlockId(blockId);
    startDuplicateTransition(async () => {
      const result = await duplicateComplexBlock(actor, ridingSlotId, blockId);
      setBusyBlockId(null);
      if (!result.success || !result.plan) {
        setListError(result.error ?? "אירעה שגיאה בשכפול הבלוק");
        return;
      }
      refreshPlan(result.plan);
    });
  }

  function handleDelete(blockId: string) {
    if (anyBlockActionPending) return;
    if (!window.confirm("למחוק את הבלוק הזה? כל הזוגות בבלוק יימחקו. לא ניתן לשחזר את הפעולה.")) return;
    setListError(null);
    setBusyBlockId(blockId);
    startDeleteBlockTransition(async () => {
      const result = await deleteComplexBlock(actor, ridingSlotId, blockId);
      setBusyBlockId(null);
      if (!result.success || !result.plan) {
        setListError(result.error ?? "אירעה שגיאה במחיקת הבלוק");
        return;
      }
      refreshPlan(result.plan);
    });
  }

  function handleMove(blockId: string, direction: "up" | "down") {
    if (anyBlockActionPending || !editing) return;
    const ids = editing.plan.blocks.map((b) => b.id);
    const index = ids.indexOf(blockId);
    const swapWith = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || swapWith < 0 || swapWith >= ids.length) return;
    const reordered = [...ids];
    [reordered[index], reordered[swapWith]] = [reordered[swapWith], reordered[index]];

    setListError(null);
    startReorderTransition(async () => {
      const result = await reorderComplexBlocks(actor, ridingSlotId, reordered);
      if (!result.success || !result.plan) {
        setListError(result.error ?? "אירעה שגיאה בסידור הבלוקים");
        return;
      }
      refreshPlan(result.plan);
    });
  }

  // Admin-only regardless of canEdit - an instructor actor never reaches
  // this (the button itself is never rendered for actor.type === "instructor",
  // see the render below), but the guard is kept here too since the server
  // action itself has no instructor variant to call by mistake.
  function handleDeletePlan() {
    if (actor.type !== "admin" || isDeletingPlan) return;
    if (
      !window.confirm(
        "למחוק את כל תכנון הרכיבה המורכב? כל הבלוקים והזוגות בתכנון זה יימחקו לצמיתות. לא ניתן לשחזר את הפעולה."
      )
    ) {
      return;
    }
    setDeletePlanError(null);
    startDeletePlanTransition(async () => {
      const result = await deleteRidingSlotComplexPlanAsAdmin(ridingSlotId);
      if (!result.success) {
        setDeletePlanError(result.error ?? "אירעה שגיאה במחיקת התכנון");
        return;
      }
      onDeleted();
    });
  }

  const plan = editing?.plan ?? null;
  const scheduleMeta = editing?.scheduleMeta ?? null;
  // Server-returned, never a client-side assumption - always true for admin
  // (see getRidingSlotComplexPlanForAdmin), reflects canEditRidingNotes for
  // an instructor actor. Gates every mutating control below; the P2 actions
  // themselves remain the actual authority regardless of what this hides.
  const canEdit = editing?.canEdit ?? false;

  return (
    <Modal
      open={open}
      title={contextLabel ? `תכנון רכיבה מורכבת - ${contextLabel}` : "תכנון רכיבה מורכבת"}
      size="large"
      onClose={onClose}
    >
      <div className="flex h-full flex-col gap-3">
        {status === "loading" && <p className="text-sm text-muted-foreground">טוען...</p>}
        {status === "not-found" && (
          <p className="text-sm text-danger">רכיבה זו לא נמצאה. ייתכן שנמחקה - סגרו ורעננו את העמוד.</p>
        )}
        {status === "error" && <p className="text-sm text-danger">שגיאה בטעינת התכנון. נסו לרענן.</p>}

        {status === "loaded" && editing && plan && (
          <>
            <div className="shrink-0 rounded-lg bg-secondary p-2.5 text-xs text-secondary-foreground">
              {scheduleMeta && (
                <p className="font-semibold">
                  {cleanScheduleTitle(scheduleMeta.activityTitle)} ·{" "}
                  {formatHebrewDate(parseDateKey(scheduleMeta.dateKey))} · {scheduleMeta.startTime}-
                  {scheduleMeta.endTime}
                </p>
              )}
              <p className="mt-0.5">
                עודכן ע&quot;י {plan.updatedByName} · {formatHebrewDateTime(new Date(plan.updatedAt))}
              </p>
            </div>

            {view === "blockList" && (
              <>
                <div className="flex shrink-0 items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-card-foreground">בלוקים</p>
                  {canEdit && (
                    <Button
                      variant="secondary"
                      className="!px-2 !py-1 !text-xs"
                      onClick={() => {
                        setEditingBlockId("new");
                        setView("editBlock");
                      }}
                      disabled={anyBlockActionPending}
                    >
                      + הוספת בלוק
                    </Button>
                  )}
                </div>

                {lastWarnings && buildWarningMessages(lastWarnings).length > 0 && (
                  <div className="shrink-0 rounded-lg border border-warning/40 bg-warning-muted/30 p-2.5 text-sm text-warning">
                    {buildWarningMessages(lastWarnings).map((m) => (
                      <p key={m}>{m}</p>
                    ))}
                  </div>
                )}
                {listError && <p className="shrink-0 text-sm text-danger">{listError}</p>}

                <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto ps-1">
                  {plan.blocks.length === 0 ? (
                    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border p-6 text-center">
                      <p className="text-sm text-muted-foreground">עדיין לא הוגדרו בלוקים לתכנון זה</p>
                      {canEdit && (
                        <Button
                          onClick={() => {
                            setEditingBlockId("new");
                            setView("editBlock");
                          }}
                        >
                          הוספת בלוק ראשון
                        </Button>
                      )}
                    </div>
                  ) : (
                    plan.blocks.map((block, index) => (
                      <BlockCard
                        key={block.id}
                        block={block}
                        index={index}
                        total={plan.blocks.length}
                        canEdit={canEdit}
                        pendingDisabled={anyBlockActionPending || busyBlockId === block.id}
                        onEdit={() => {
                          setEditingBlockId(block.id);
                          setView("editBlock");
                        }}
                        onDuplicate={() => handleDuplicate(block.id)}
                        onDelete={() => handleDelete(block.id)}
                        onMoveUp={() => handleMove(block.id, "up")}
                        onMoveDown={() => handleMove(block.id, "down")}
                      />
                    ))
                  )}
                </div>

                {actor.type === "admin" && (
                  <div className="shrink-0 border-t border-border pt-3">
                    {deletePlanError && <p className="mb-2 text-sm text-danger">{deletePlanError}</p>}
                    <Button
                      variant="danger"
                      className="!text-xs"
                      onClick={handleDeletePlan}
                      disabled={isDeletingPlan}
                    >
                      {isDeletingPlan ? "מוחק..." : "מחיקת התכנון המורכב"}
                    </Button>
                  </div>
                )}
              </>
            )}

            {view === "editBlock" && (
              <BlockEditorForm
                key={editingBlockId ?? "new"}
                actor={actor}
                ridingSlotId={ridingSlotId}
                block={
                  editingBlockId && editingBlockId !== "new"
                    ? (plan.blocks.find((b) => b.id === editingBlockId) ?? null)
                    : null
                }
                canEdit={canEdit}
                instructors={instructors}
                candidates={editing.candidates}
                knownHorseNames={editing.knownHorseNames}
                onSaved={handleBlockSaved}
                onCancel={handleCancelBlockEdit}
              />
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
