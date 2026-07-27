/**
 * P-MATERIALS M2C - the PURE + dependency-injected core that scopes a trainee's
 * course-material visibility to the UNION of every CourseOffering the trainee is
 * actively enrolled in, whose offering is ACTIVE, and whose COURSE_MATERIALS
 * capability is effectively ENABLED.
 *
 * WHY A NEW CORE (not resolveTraineeCourseOffering)
 * -------------------------------------------------
 * The committed single-offering resolver deliberately COLLAPSES a dual-enrolled
 * trainee's {Level 1, Level 2} pair to the Level 1 row, so that the many
 * non-selectable Level 1 modules keep working at launch. For MATERIALS that
 * collapse is wrong: a dual-enrolled trainee must see the union of BOTH
 * offerings' materials. So this core reads ALL of the trainee's enrollments and
 * keeps every eligible offering, rather than resolving down to one.
 *
 * The pure decision (`resolveTraineeMaterialsOfferingIdsFromRows`) takes
 * already-read enrollment/capability data and returns the ordered, deduplicated
 * offering ids allowed for trainee material visibility. The DI orchestration
 * (`loadTraineeScopedMaterialsWithDeps`) sequences the real session read,
 * enrollment fetch, per-offering capability resolution and the final scoped
 * material load, so the whole flow is unit-testable without a database.
 *
 * PURE by construction (the decision function): no Prisma, no DB, no clock, no
 * randomness, no env, no cookies, no next/headers, no React. The DI orchestration
 * imports only the typed denial error class for classification; all IO is
 * injected.
 *
 * FAIL-CLOSED. A row is included ONLY when its enrollment is ACTIVE, its offering
 * is ACTIVE, its COURSE_MATERIALS capability is boolean `true`, and its offering
 * id is a non-blank string. Any deviation (INACTIVE/PLANNED/ARCHIVED, a
 * non-`true` capability, a malformed id, a malformed row, a non-array input)
 * EXCLUDES that row - it never throws and never widens access. There is NO
 * null-to-Level-1 fallback, NO single-offering collapse, and NO inference from
 * level, name, date or group.
 */
import { UnauthenticatedActorError } from "@/lib/auth/actor-types";

// ---------------------------------------------------------------------------
// Pure scope decision
// ---------------------------------------------------------------------------

/** Enrollment lifecycle, as read from CourseEnrollment.status. */
export type EnrollmentStatusInput = "ACTIVE" | "INACTIVE";

/** Offering lifecycle, as read from CourseOffering.status. */
export type OfferingStatusInput = "ACTIVE" | "PLANNED" | "ARCHIVED";

/**
 * One already-read enrollment row enriched with the effective COURSE_MATERIALS
 * capability of its offering. `materialsCapabilityEnabled` is the resolved
 * boolean (`getEffectiveCapabilities(...).COURSE_MATERIALS === "ENABLED"`), never
 * a raw status string - the capability lattice decision belongs to the committed
 * capability core, not here.
 */
export interface TraineeMaterialsScopeRow {
  readonly courseOfferingId: string;
  readonly enrollmentStatus: EnrollmentStatusInput;
  readonly offeringStatus: OfferingStatusInput;
  readonly materialsCapabilityEnabled: boolean;
}

export interface TraineeMaterialsScopeInput {
  readonly enrollments: readonly TraineeMaterialsScopeRow[];
}

/**
 * The ordered, deduplicated offering ids a trainee may see materials for.
 *
 * Includes an offering id iff a row exists with: ACTIVE enrollment, ACTIVE
 * offering, `materialsCapabilityEnabled === true` (strict), and a non-blank
 * string id. First-seen order is preserved; exact duplicates collapse. A
 * malformed row (missing/non-object, blank/non-string id, non-boolean capability
 * flag, unexpected status) is silently EXCLUDED - fail-closed, never thrown, so a
 * defect can never grant visibility. The returned array is frozen and the input
 * is never mutated.
 */
export function resolveTraineeMaterialsOfferingIdsFromRows(
  input: TraineeMaterialsScopeInput,
): readonly string[] {
  const rows = input?.enrollments;
  if (!Array.isArray(rows)) {
    return Object.freeze([]);
  }

  const seen = new Set<string>();
  const ids: string[] = [];
  for (const row of rows) {
    if (row === null || typeof row !== "object") continue;
    const { courseOfferingId, enrollmentStatus, offeringStatus, materialsCapabilityEnabled } = row;
    if (typeof courseOfferingId !== "string" || courseOfferingId.trim().length === 0) continue;
    if (enrollmentStatus !== "ACTIVE") continue;
    if (offeringStatus !== "ACTIVE") continue;
    // Strict boolean true only: a truthy non-boolean (e.g. "ENABLED", 1) must NOT
    // pass - the capability decision is upstream and must arrive as a real bool.
    if (materialsCapabilityEnabled !== true) continue;
    if (seen.has(courseOfferingId)) continue;
    seen.add(courseOfferingId);
    ids.push(courseOfferingId);
  }
  return Object.freeze(ids);
}

// ---------------------------------------------------------------------------
// Dependency-injected orchestration (IO sequenced, testable without a DB)
// ---------------------------------------------------------------------------

/** One trainee enrollment row as loaded from the database (pre-capability). */
export interface TraineeEnrollmentScopeRow {
  readonly courseOfferingId: string;
  readonly enrollmentStatus: EnrollmentStatusInput;
  readonly offeringStatus: OfferingStatusInput;
}

/**
 * The injected boundaries of the trainee scoped-materials read.
 *
 * `requireTraineeId` resolves the trainee from the SIGNED SESSION and throws
 * {@link UnauthenticatedActorError} for anonymous / expired / wrong-audience /
 * inactive callers (that error alone is a denial -> `[]`; every other error
 * propagates). `loadEnrollments` returns ALL of the trainee's enrollments.
 * `isMaterialsCapabilityEnabled` resolves the effective COURSE_MATERIALS
 * capability for one offering. `loadMaterials` runs the final audience-scoped
 * material query for the resolved enabled offering ids.
 */
export interface TraineeScopedMaterialsDeps<TRow> {
  requireTraineeId: () => Promise<string>;
  loadEnrollments: (traineeId: string) => Promise<readonly TraineeEnrollmentScopeRow[]>;
  isMaterialsCapabilityEnabled: (courseOfferingId: string) => Promise<boolean>;
  loadMaterials: (enabledOfferingIds: readonly string[]) => Promise<TRow[]>;
}

/**
 * Resolve the trainee, load every enrollment, resolve COURSE_MATERIALS for each
 * distinct ACTIVE-enrollment + ACTIVE-offering candidate, decide the enabled
 * offering-id union via the pure core, and only THEN load the audience-scoped
 * materials.
 *
 * Order is deliberate and fail-closed:
 *  1. session -> trainee id (UnauthenticatedActorError -> `[]`; else propagate);
 *  2. load all enrollments;
 *  3. per distinct active candidate offering, resolve COURSE_MATERIALS enabled;
 *  4. pure core -> ordered, deduped enabled offering ids;
 *  5. empty -> `[]` WITHOUT touching materials; otherwise load the scoped rows.
 *
 * `loadMaterials` is unreachable unless at least one offering is enabled, so no
 * material row is read (and no storage URL signed) for a trainee with no active
 * enabled offering.
 */
export async function loadTraineeScopedMaterialsWithDeps<TRow>(
  deps: TraineeScopedMaterialsDeps<TRow>,
): Promise<TRow[]> {
  let traineeId: string;
  try {
    traineeId = await deps.requireTraineeId();
  } catch (error) {
    if (error instanceof UnauthenticatedActorError) {
      return [];
    }
    throw error;
  }

  const enrollments = await deps.loadEnrollments(traineeId);

  // Distinct candidate offerings: ACTIVE enrollment into an ACTIVE offering.
  // Capability is resolved only for these (bounded), never for every enrollment.
  const candidateIds: string[] = [];
  const seenCandidate = new Set<string>();
  for (const enrollment of enrollments) {
    if (
      enrollment === null ||
      typeof enrollment !== "object" ||
      typeof enrollment.courseOfferingId !== "string" ||
      enrollment.courseOfferingId.trim().length === 0
    ) {
      continue;
    }
    if (enrollment.enrollmentStatus !== "ACTIVE" || enrollment.offeringStatus !== "ACTIVE") {
      continue;
    }
    if (seenCandidate.has(enrollment.courseOfferingId)) continue;
    seenCandidate.add(enrollment.courseOfferingId);
    candidateIds.push(enrollment.courseOfferingId);
  }

  const scopeRows: TraineeMaterialsScopeRow[] = [];
  for (const courseOfferingId of candidateIds) {
    scopeRows.push({
      courseOfferingId,
      enrollmentStatus: "ACTIVE",
      offeringStatus: "ACTIVE",
      materialsCapabilityEnabled: (await deps.isMaterialsCapabilityEnabled(courseOfferingId)) === true,
    });
  }

  const enabledOfferingIds = resolveTraineeMaterialsOfferingIdsFromRows({ enrollments: scopeRows });
  if (enabledOfferingIds.length === 0) {
    return [];
  }

  return deps.loadMaterials(enabledOfferingIds);
}
