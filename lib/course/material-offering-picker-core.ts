/**
 * P-MATERIALS M2D - the PURE core for the ADMIN course-material offering picker.
 *
 * PURE by construction: no Prisma, no DB, no clock, no randomness, no env, no
 * cookies, no next/headers, no React. It filters/orders already-read offering
 * rows into the selectable picker options and attaches each offering's
 * already-resolved effective COURSE_MATERIALS status, so the whole contract is
 * unit-testable without a database (see material-offering-picker-core.test.ts).
 *
 * AGREEMENT WITH THE WRITER (critical)
 * ------------------------------------
 * The picker MUST offer exactly the set the M2B writer accepts, or an admin
 * could select an offering the write then rejects (or vice-versa). Agreement is
 * kept structurally, not by re-deriving rules:
 *   - CURRENT ActivityYear is derived by the SAME function the writer uses
 *     (resolveCurrentActivityYearIdFromRows in material-audience-write.ts); the
 *     caller passes that id in here.
 *   - SELECTABLE STATUS is ACTIVE or PLANNED - identical to the writer's
 *     assertOfferingIdsAllowedFromRows check. The picker-core test cross-checks
 *     this against the writer helper so the two can never silently diverge.
 * ARCHIVED offerings and offerings from any other ActivityYear are excluded.
 * There is NO name-based identity (id is the only identity) and NO hidden
 * fallback to Level 1.
 *
 * Capability is NOT decided here: `capabilityEnabledById` carries the already-
 * resolved `getEffectiveCapabilities(...).COURSE_MATERIALS === "ENABLED"` boolean
 * per offering. A missing entry is treated as NOT enabled (fail-closed for the
 * "trainees won't see it yet" note), never as enabled.
 */

/** The selectable statuses a picker option may have (ARCHIVED is never offered). */
export type MaterialOfferingStatus = "ACTIVE" | "PLANNED";

/** One already-read CourseOffering row the picker filters over. */
export interface MaterialOfferingPickerRow {
  readonly id: string;
  readonly name: string;
  readonly level: number;
  readonly status: "ACTIVE" | "PLANNED" | "ARCHIVED";
  readonly activityYearId: string;
}

/** One selectable picker option handed to the admin UI. */
export interface MaterialOfferingOption {
  readonly id: string;
  readonly label: string;
  readonly level: number;
  readonly status: MaterialOfferingStatus;
  readonly materialsCapabilityEnabled: boolean;
}

/** ACTIVE offerings sort before PLANNED; ARCHIVED never appears. */
const STATUS_RANK: Record<MaterialOfferingStatus, number> = { ACTIVE: 0, PLANNED: 1 };

function isSelectableStatus(status: string): status is MaterialOfferingStatus {
  return status === "ACTIVE" || status === "PLANNED";
}

/**
 * Build the ordered, filtered picker options.
 *
 * Keeps a row iff its `activityYearId` equals `currentActivityYearId` AND its
 * status is ACTIVE or PLANNED AND its id is a non-blank string. The label is the
 * offering NAME (display only - the id remains the identity). Each option carries
 * the resolved capability flag (missing -> false).
 *
 * Deterministic order: status rank (ACTIVE, then PLANNED), then level ascending,
 * then label ascending, then id ascending. The result and every option object
 * are frozen; the input rows are never mutated.
 */
export function buildMaterialOfferingPickerOptions(
  rows: readonly MaterialOfferingPickerRow[],
  currentActivityYearId: string,
  capabilityEnabledById: ReadonlyMap<string, boolean>,
): readonly MaterialOfferingOption[] {
  if (!Array.isArray(rows) || typeof currentActivityYearId !== "string" || currentActivityYearId.length === 0) {
    return Object.freeze([]);
  }

  const options: MaterialOfferingOption[] = [];
  for (const row of rows) {
    if (row === null || typeof row !== "object") continue;
    if (typeof row.id !== "string" || row.id.trim().length === 0) continue;
    if (row.activityYearId !== currentActivityYearId) continue;
    if (!isSelectableStatus(row.status)) continue;
    options.push(
      Object.freeze({
        id: row.id,
        label: typeof row.name === "string" ? row.name : "",
        level: typeof row.level === "number" ? row.level : 0,
        status: row.status,
        materialsCapabilityEnabled: capabilityEnabledById.get(row.id) === true,
      }),
    );
  }

  options.sort((a, b) => {
    const rank = STATUS_RANK[a.status] - STATUS_RANK[b.status];
    if (rank !== 0) return rank;
    if (a.level !== b.level) return a.level - b.level;
    if (a.label !== b.label) return a.label < b.label ? -1 : 1;
    if (a.id !== b.id) return a.id < b.id ? -1 : 1;
    return 0;
  });

  return Object.freeze(options);
}
