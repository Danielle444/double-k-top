// Pure key builders for the generated Teaching Practice lessons table
// ("התנסויות מתחילים" -> tab "שיעורים"). DB-free, React-free, side-effect-free:
// plain string construction only, so both the component that WRITES a key and
// every cell that READS it back can share one source of truth instead of
// hand-writing the same format twice (see buildLessonInlineCellKey below for
// why that mattered).

// The React key for one display row of a generated lesson.
//
// Deliberately POSITIONAL (lessonId + row index), never identity-based. A
// display row here is a lesson SLOT - "role slot i / child slot i" - not a
// TeachingPracticeChildAssignment entity: every inline handler in the table
// already addresses its data by index (onInlineUpdateChild(lesson, i, ...),
// onInlineUpdateParticipant(lesson, roleSlots, i, ...)), so the index IS the
// row's identity in this table.
//
// This must never be derived from TeachingPracticeChildAssignment.id (or any
// other server-regenerated id). setTeachingPracticeLessonChildAssignmentsInternal
// saves by deleteMany + createMany, so EVERY child assignment on a lesson gets
// a brand-new cuid on every horse / equipment / child-name save. A key built
// from that id therefore changes on each save, which makes React unmount and
// remount the whole row subtree and destroys the focused <input>, any
// uncommitted InlineTextEditCell draft, open SearchableSelect state, and the
// container's scroll offset. Keying on position keeps the row mounted across a
// refresh that returns the same number of rows, so rows are only added/removed
// when the row count itself genuinely changes.
//
// lessonId is included so keys stay unique across the several lessons rendered
// into one shared <tbody>.
export function buildLessonDisplayRowKey(lessonId: string, rowIndex: number): string {
  return `${lessonId}-row-${rowIndex}`;
}

// Which single inline cell of a generated lesson a saving-key refers to.
// `field` is set only for the two free-text child columns that need to disable
// independently of the child-name picker sharing their row.
export type LessonInlineCellTarget =
  | { readonly kind: "startTime" }
  | { readonly kind: "notes" }
  | { readonly kind: "participant"; readonly index: number }
  | {
      readonly kind: "child";
      readonly index: number;
      readonly field?: "horseName" | "equipmentNotes";
    };

// The savingLessonCellKey for one inline cell - the value written when a save
// starts, and the value each cell compares itself against to decide whether IT
// is the cell currently saving.
//
// Every format below is byte-for-byte what the table already used, so this is
// a de-duplication rather than a rename. The one behavior change is that the
// horse and equipment cells now actually receive the key they were already
// reading: the child-assignment handler used to write the un-suffixed
// `lesson-{id}-child-{index}` for all three child columns, which meant a horse
// or equipment save disabled that row's child-name SearchableSelect (blurring
// and closing it if the user had it open) while leaving the free-text input
// that was actually saving fully enabled.
export function buildLessonInlineCellKey(lessonId: string, target: LessonInlineCellTarget): string {
  switch (target.kind) {
    case "startTime":
      return `lesson-${lessonId}-startTime`;
    case "notes":
      return `lesson-${lessonId}-notes`;
    case "participant":
      return `lesson-${lessonId}-participant-${target.index}`;
    case "child":
      return target.field === undefined
        ? `lesson-${lessonId}-child-${target.index}`
        : `lesson-${lessonId}-child-${target.index}-${target.field}`;
  }
}

// The child fields a single inline child edit may carry, in the fixed priority
// the saving-key is resolved by. Explicit and order-independent on purpose:
// deriving "which field is being saved" from Object.keys() order would make the
// disabled cell depend on how the caller happened to build its patch object.
// horseName wins over equipmentNotes only so an unexpected combined patch
// resolves to ONE deterministic key rather than an arbitrary one; the table
// never sends both at once (each InlineTextEditCell commits its own field).
const CHILD_PATCH_FIELD_PRIORITY = ["horseName", "equipmentNotes"] as const;

// Resolves the saving-key for one inline child edit from the patch itself, so
// the key written when the save starts always matches the key the edited cell
// reads back. A patch that touches childId (with or without a text field), or
// an empty patch, resolves to the un-suffixed child key - the child-name
// picker's own cell.
export function resolveLessonChildCellTarget(
  index: number,
  patch: { childId?: string; horseName?: string; equipmentNotes?: string }
): LessonInlineCellTarget {
  if (patch.childId !== undefined) return { kind: "child", index };
  for (const field of CHILD_PATCH_FIELD_PRIORITY) {
    if (patch[field] !== undefined) return { kind: "child", index, field };
  }
  return { kind: "child", index };
}
