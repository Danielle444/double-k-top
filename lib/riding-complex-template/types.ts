// Fix 3, Stage 1 - shared plain-data types for the dormant "copy a previous
// complex riding plan as a template" core.
//
// PURE DATA ONLY. This file declares narrow, readonly, plain-data shapes and
// NOTHING else - no functions, no imports, no Prisma-generated types, no
// React/Next/auth/action types. Every field is a primitive or a readonly array
// of these same shapes, so the core that consumes them (resolve-anchor,
// select-source, copy-plan) can stay completely dependency-free and testable in
// isolation.
//
// DORMANT: no runtime code imports these types yet. They exist only so the
// three pure modules in this directory share one vocabulary.
//
// The destination-copy OUTPUT shapes deliberately carry ONLY the create values
// a later integration would need. They structurally exclude every forbidden
// field - no database ids, no plan/slot/parent ids, no createdAt/updatedAt
// timestamps, no version, no actor/audit identity, no publication/snapshot
// fields, and no feedback/attendance/completion fields. Because the interfaces
// list only the allowed keys, an object literal that tries to add any of those
// keys fails TypeScript's excess-property check at the construction site.

// ---------------------------------------------------------------------------
// A. Anchor resolver types (input + discriminated result)
// ---------------------------------------------------------------------------

/**
 * The minimum description of one linked schedule item backing a riding slot.
 * Mirrors the real ScheduleItem fields the anchor cares about (a `dateKey` in
 * strict `YYYY-MM-DD` form, an `HH:MM` `startTime`, and a nullable
 * `groupName`), but is a plain-data projection - never a Prisma row.
 */
export interface LinkedScheduleItemDescriptor {
  readonly id: string;
  /** Strict `YYYY-MM-DD` calendar day for this item. */
  readonly dateKey: string;
  /** `HH:MM` start time; compared as an exact string, never parsed to a clock. */
  readonly startTime: string;
  /** The item's group, or null/empty when unset. Compared by exact equality. */
  readonly groupName: string | null;
}

/**
 * Deterministic start-time metadata for an eligible anchor: the earliest
 * `startTime` among the items sharing the anchor date, plus the id of the
 * single item that deterministically won the anchor tie-break. Both are derived
 * purely from the input; no clock or environment is consulted.
 */
export interface AnchorStartTimeMeta {
  readonly value: string;
  readonly anchorItemId: string;
}

/**
 * A stable, non-PII reason code explaining why a set of linked schedule items
 * cannot anchor a template. Values are opaque identifiers safe to log.
 */
export type AnchorIneligibleReason =
  | "NO_SCHEDULE_ITEMS"
  | "INVALID_DATE_KEY"
  | "MISSING_GROUP"
  | "AMBIGUOUS_GROUP";

/**
 * The discriminated result of resolving an anchor. `eligible` is the tag: when
 * true the caller gets an anchor date, the single resolved group, and
 * deterministic start-time metadata; when false it gets only a stable reason
 * code (never any offending value, id, or PII).
 */
export type AnchorResolution =
  | {
      readonly eligible: true;
      readonly anchorDateKey: string;
      readonly resolvedGroup: string;
      readonly startTime: AnchorStartTimeMeta;
    }
  | {
      readonly eligible: false;
      readonly reason: AnchorIneligibleReason;
    };

// ---------------------------------------------------------------------------
// B. Previous-source selector types
// ---------------------------------------------------------------------------

/**
 * The already-resolved destination slot a template is being selected FOR. Built
 * by the integration from an eligible {@link AnchorResolution} plus the slot's
 * own id. `resolvedGroup` is the single non-null group the destination anchored
 * to; `anchorDateKey` is its anchor date.
 */
export interface DestinationSlotDescriptor {
  readonly slotId: string;
  readonly anchorDateKey: string;
  readonly resolvedGroup: string;
}

/**
 * One candidate previous slot that could serve as the copy source. Carries only
 * what selection needs - notably NO published/unpublished state, by contract.
 * `blockCount` is how many complex blocks the candidate's live plan has.
 */
export interface SourceCandidateDescriptor {
  readonly slotId: string;
  readonly anchorDateKey: string;
  readonly startTime: string;
  readonly resolvedGroup: string;
  readonly blockCount: number;
}

// ---------------------------------------------------------------------------
// C. Copy-plan sanitizer types
// ---------------------------------------------------------------------------

/** A source pair as read from a live complex plan (allow-listed fields only). */
export interface SourcePlanPair {
  readonly trainee1Id?: string | null;
  readonly trainee2Id?: string | null;
  readonly horseName?: string | null;
  readonly note?: string | null;
}

/** A source station as read from a live complex plan (allow-listed fields only). */
export interface SourcePlanStation {
  readonly instructorId?: string | null;
  readonly arena?: string | null;
  readonly pairs: readonly SourcePlanPair[];
}

/** A source block as read from a live complex plan (allow-listed fields only). */
export interface SourcePlanBlock {
  readonly startTime: string;
  readonly endTime: string;
  readonly stations: readonly SourcePlanStation[];
}

/** The narrow source live-plan tree the sanitizer copies FROM. */
export interface SourcePlanTree {
  readonly blocks: readonly SourcePlanBlock[];
}

/**
 * A fresh destination pair create value. Only the four content fields plus a
 * regenerated `sortOrder` - never a source id, timestamp, version, or audit
 * field. `trainee1Id`/`trainee2Id` are already filtered/collapsed against the
 * destination roster; an unfilled position is null.
 */
export interface DestinationPairCreate {
  readonly trainee1Id: string | null;
  readonly trainee2Id: string | null;
  readonly horseName: string | null;
  readonly note: string | null;
  readonly sortOrder: number;
}

/**
 * A fresh destination station create value. `instructorId` is retained only if
 * still active (else null); `arena` is preserved; `sortOrder` is regenerated.
 */
export interface DestinationStationCreate {
  readonly instructorId: string | null;
  readonly arena: string | null;
  readonly sortOrder: number;
  readonly pairs: readonly DestinationPairCreate[];
}

/**
 * A fresh destination block create value. Start/end times are preserved from
 * the source; `sortOrder` is regenerated sequentially.
 */
export interface DestinationBlockCreate {
  readonly startTime: string;
  readonly endTime: string;
  readonly sortOrder: number;
  readonly stations: readonly DestinationStationCreate[];
}

/** The fresh destination plan create tree the sanitizer produces. */
export interface DestinationPlanCreate {
  readonly blocks: readonly DestinationBlockCreate[];
}
