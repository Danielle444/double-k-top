/**
 * P-MATERIALS M2B - server-side WRITE helpers for course-material audience
 * scoping, shared by BOTH material write paths (the LINK server action in
 * lib/actions/materials.ts and the FILE upload Route Handler in
 * app/api/admin/materials/upload/route.ts) so the offering-id authorization and
 * the audience persistence are defined ONCE, not duplicated and allowed to
 * drift.
 *
 * SERVER-ONLY by consumption (imported only by a "use server" action and a Route
 * Handler; never by a client component). This module holds NO "use server"
 * directive of its own - its exports are ordinary async helpers, not Server
 * Actions, exactly like the other lib/course/* server IO wrappers
 * (offering-by-id.ts, current-offering.ts). It imports NO global `prisma`
 * client: every function receives the transaction client (or its injected
 * dependencies) from the caller, so the audience write always happens INSIDE the
 * caller's transaction.
 *
 * The identifier-shape validation and the create/delete diff are delegated to
 * the committed PURE M2A core (material-audience-reconcile-core.ts); this module
 * adds only the OFFERING-AUTHORIZATION decision (which offering ids an admin may
 * store) and the thin Prisma bindings.
 *
 * OFFERING AUTHORIZATION (locked M2B decision)
 * --------------------------------------------
 * An offering id may be stored on a material only if it is in the CURRENT
 * ActivityYear and its status is ACTIVE or PLANNED (ARCHIVED is forbidden). The
 * "current ActivityYear" is DERIVED, never guessed: it is the single distinct
 * activityYearId of the ACTIVE offerings. Zero or more than one distinct active
 * year fails CLOSED (NoCurrentActivityYearError) - there is no name lookup, no
 * date-window heuristic, no `?? defaultYear`, and no fallback offering. A
 * requested id that is unknown, in another year, or ARCHIVED fails the WHOLE
 * write (OfferingNotAllowedError) - ids are never silently filtered.
 */
import type { Prisma } from "@/app/generated/prisma/client";
import {
  reconcileMaterialAudiences,
  type MaterialAudienceRow,
} from "@/lib/course/material-audience-reconcile-core";

// ---------------------------------------------------------------------------
// Typed, PII-safe domain errors (cuids only - never a name, never PII)
// ---------------------------------------------------------------------------

/**
 * The current ActivityYear could not be determined: there is not EXACTLY one
 * distinct activityYearId across the ACTIVE offerings. Fails closed - the write
 * is refused rather than defaulting to some year.
 */
export class NoCurrentActivityYearError extends Error {
  readonly distinctActiveYearCount: number;
  constructor(distinctActiveYearCount: number) {
    super(
      `The current ActivityYear is not resolvable: ${distinctActiveYearCount} ` +
        `distinct ACTIVE-offering activity years (need exactly 1). Material ` +
        `audience scoping fails closed and never defaults to a year.`,
    );
    this.name = "NoCurrentActivityYearError";
    this.distinctActiveYearCount = distinctActiveYearCount;
  }
}

/** Why a requested offering id is not allowed to be stored on a material. */
export type OfferingNotAllowedReason = "not-found" | "wrong-activity-year" | "archived-or-not-selectable";

/**
 * A requested offering id is outside the allowed set for the current
 * ActivityYear. Carries only the offending offering cuid (a safe public id, per
 * the repo's error convention) and a code-owned reason - never a name or any
 * PII. The presence of one such id fails the ENTIRE write; no id is dropped.
 */
export class OfferingNotAllowedError extends Error {
  readonly offeringId: string;
  readonly reason: OfferingNotAllowedReason;
  constructor(offeringId: string, reason: OfferingNotAllowedReason) {
    super(
      `CourseOffering ${offeringId} may not be assigned to a material (${reason}); ` +
        `the whole write is refused and no requested offering is silently dropped.`,
    );
    this.name = "OfferingNotAllowedError";
    this.offeringId = offeringId;
    this.reason = reason;
  }
}

// ---------------------------------------------------------------------------
// PURE offering-authorization decisions (DB-free, unit-testable)
// ---------------------------------------------------------------------------

/**
 * Resolve the current ActivityYear id from the ACTIVE offerings' rows. The
 * caller supplies every ACTIVE offering's activityYearId; this returns the
 * single distinct value or throws {@link NoCurrentActivityYearError}. Blank /
 * non-string year ids are ignored for the distinctness count (they can never
 * BECOME the current year, so a malformed row cannot widen the allowed set).
 */
export function resolveCurrentActivityYearIdFromRows(
  activeOfferingRows: readonly { activityYearId: string }[],
): string {
  const distinct = new Set<string>();
  for (const row of activeOfferingRows) {
    const yearId = row?.activityYearId;
    if (typeof yearId === "string" && yearId.trim().length > 0) {
      distinct.add(yearId);
    }
  }
  if (distinct.size !== 1) {
    throw new NoCurrentActivityYearError(distinct.size);
  }
  return [...distinct][0];
}

/** The offering columns the authorization decision consumes. */
export interface AllowedOfferingRow {
  readonly id: string;
  readonly status: string;
  readonly activityYearId: string;
}

/**
 * Assert every requested offering id is allowed for `currentActivityYearId`,
 * given the fetched rows of the requested ids. An id is allowed only when a row
 * exists for it, its activityYearId matches, and its status is ACTIVE or
 * PLANNED. The FIRST disallowed id throws {@link OfferingNotAllowedError}; ids
 * are checked in the caller's order and never filtered.
 */
export function assertOfferingIdsAllowedFromRows(
  offeringIds: readonly string[],
  currentActivityYearId: string,
  offeringRows: readonly AllowedOfferingRow[],
): void {
  const byId = new Map(offeringRows.map((row) => [row.id, row]));
  for (const id of offeringIds) {
    const row = byId.get(id);
    if (row === undefined) {
      throw new OfferingNotAllowedError(id, "not-found");
    }
    if (row.activityYearId !== currentActivityYearId) {
      throw new OfferingNotAllowedError(id, "wrong-activity-year");
    }
    if (row.status !== "ACTIVE" && row.status !== "PLANNED") {
      throw new OfferingNotAllowedError(id, "archived-or-not-selectable");
    }
  }
}

// ---------------------------------------------------------------------------
// Dependency-injected orchestration (testable without Prisma)
// ---------------------------------------------------------------------------

/** Injected reads for offering authorization. */
export interface OfferingAuthorizationDeps {
  /** Every ACTIVE offering's activityYearId (used to derive the current year). */
  fetchActiveOfferingYearRows: () => Promise<{ activityYearId: string }[]>;
  /** The rows for exactly the requested offering ids. */
  fetchOfferingRowsByIds: (ids: readonly string[]) => Promise<AllowedOfferingRow[]>;
}

/**
 * Derive the current ActivityYear and assert every requested id is allowed for
 * it. Throws {@link NoCurrentActivityYearError} or {@link OfferingNotAllowedError}
 * on any violation; returns nothing on success. `offeringIds` is expected to be
 * already normalized (non-empty, deduped) by the M2A core.
 */
export async function assertOfferingIdsAllowedWithDeps(
  offeringIds: readonly string[],
  deps: OfferingAuthorizationDeps,
): Promise<void> {
  const activeRows = await deps.fetchActiveOfferingYearRows();
  const currentActivityYearId = resolveCurrentActivityYearIdFromRows(activeRows);
  const rows = await deps.fetchOfferingRowsByIds(offeringIds);
  assertOfferingIdsAllowedFromRows(offeringIds, currentActivityYearId, rows);
}

/** Injected writes for audience reconciliation. */
export interface AudienceWriteDeps {
  loadExistingAudiences: () => Promise<MaterialAudienceRow[]>;
  deleteAudiences: (audienceRowIds: readonly string[]) => Promise<void>;
  createAudiences: (courseOfferingIds: readonly string[]) => Promise<void>;
}

/**
 * Move a material's persisted audience to exactly `desiredOfferingIds`, using the
 * PURE M2A diff. A create is the empty-existing case (everything is created). No
 * delete/create call is issued for an empty side, so unchanged rows are never
 * touched.
 */
export async function applyMaterialAudiencesWithDeps(
  desiredOfferingIds: readonly string[],
  deps: AudienceWriteDeps,
): Promise<void> {
  const existing = await deps.loadExistingAudiences();
  const { toCreate, toDelete } = reconcileMaterialAudiences(desiredOfferingIds, existing);
  if (toDelete.length > 0) {
    await deps.deleteAudiences(toDelete);
  }
  if (toCreate.length > 0) {
    await deps.createAudiences(toCreate);
  }
}

// ---------------------------------------------------------------------------
// Thin Prisma bindings (used inside the caller's transaction)
// ---------------------------------------------------------------------------

/**
 * Authorize the requested offering ids against the current ActivityYear, using
 * the supplied transaction client. Call this INSIDE the write transaction so the
 * check and the write are atomic (an offering archived between check and write
 * cannot slip through).
 */
export async function assertOfferingIdsAllowed(
  tx: Prisma.TransactionClient,
  offeringIds: readonly string[],
): Promise<void> {
  return assertOfferingIdsAllowedWithDeps(offeringIds, {
    fetchActiveOfferingYearRows: () =>
      tx.courseOffering.findMany({
        where: { status: "ACTIVE" },
        select: { activityYearId: true },
      }),
    fetchOfferingRowsByIds: (ids) =>
      tx.courseOffering.findMany({
        where: { id: { in: [...ids] } },
        select: { id: true, status: true, activityYearId: true },
      }),
  });
}

/**
 * Reconcile a material's audience rows to exactly `desiredOfferingIds`, using the
 * supplied transaction client. Deletes only removed rows and inserts only new
 * offering ids (unchanged rows untouched). Deleting an audience row never touches
 * the material or its storage object.
 */
export async function applyMaterialAudiences(
  tx: Prisma.TransactionClient,
  materialId: string,
  desiredOfferingIds: readonly string[],
): Promise<void> {
  return applyMaterialAudiencesWithDeps(desiredOfferingIds, {
    loadExistingAudiences: () =>
      tx.courseMaterialAudience.findMany({
        where: { materialId },
        select: { id: true, courseOfferingId: true },
      }),
    deleteAudiences: async (audienceRowIds) => {
      await tx.courseMaterialAudience.deleteMany({ where: { id: { in: [...audienceRowIds] } } });
    },
    createAudiences: async (courseOfferingIds) => {
      await tx.courseMaterialAudience.createMany({
        data: courseOfferingIds.map((courseOfferingId) => ({ materialId, courseOfferingId })),
      });
    },
  });
}
