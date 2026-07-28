/**
 * P-MATERIALS M3B - the AUTHORITATIVE snapshot behind MATERIAL_ADDED
 * notification fan-out: it re-reads the persisted CourseMaterial by id and
 * resolves the offering-scoped TRAINEE recipient set from that row alone.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * Before M3B the fan-out decided everything from its CALLER'S parameters
 * (`title`, `visibility`). lib/actions/notifications.ts carries "use server", so
 * createMaterialAddedNotifications is a publicly dispatchable Server Action
 * endpoint: an authenticated admin could POST it directly with an arbitrary
 * `materialId`, an arbitrary `title` and an arbitrary `visibility`, and the
 * fan-out would faithfully push that attacker-chosen text to recipients it
 * selected from those same forged values. Gating the endpoint (M3B-0, commit
 * 4c4d3a2) fixed WHO may call it; it did not make WHAT the call says
 * authoritative. This module does: every notification decision is taken from the
 * persisted row, so a forged parameter can neither widen the audience nor change
 * a single character of the delivered body.
 *
 * READ ONCE. The material, its audience offerings, those offerings' lifecycle
 * and capability verdicts, and the enrollments are loaded in ONE ordered pass and
 * returned as a single snapshot that BOTH fan-out branches consume. The
 * CourseMaterial row is never read twice.
 *
 * SERVER-ONLY BY CONSUMPTION, exactly like lib/course/material-audience-write.ts
 * and lib/course/capabilities/material-notification-fanout.ts: this module holds
 * NO "use server" directive, so its exports are ordinary async helpers that mint
 * no public endpoint. It performs NO authorization of its own - the admin gate
 * lives once, on the Server Action boundary and (equivalently) at the top of the
 * admin upload Route Handler. It reads no cookie, no session and no actor, and it
 * takes NO recipient list from any caller: the only input is a material id.
 *
 * THE AUDIENCE IS READ THROUGH THE `audiences` RELATION, never through the
 * audience model's own Prisma delegate. Direct access to that table is confined
 * by contract to lib/course/material-audience-write.ts
 * (prisma/m0-course-material-audience.contract.test.ts); reading it as a nested
 * relation off CourseMaterial is the precedent already set by the committed
 * readers getMaterialsForAdmin and getTraineeScopedMaterials.
 *
 * THE CAPABILITY KEY IS IMPORTED, NEVER RE-SPELLED. The literal lives once, in
 * the pure core's MATERIAL_NOTIFICATION_CAPABILITY_KEY, typed as CapabilityKey.
 * Re-authoring the string here would create a second place for it to drift and
 * would silently enroll this module in the key's confinement allow-list.
 *
 * EVERY DECISION IS DELEGATED TO THE COMMITTED PURE CORE
 * ------------------------------------------------------
 * This module is an IO shell and nothing more. It compares no capability status
 * beyond the one `=== "ENABLED"` read the committed capability reader is designed
 * to be consumed by, it re-implements no lifecycle rule, and it owns no
 * deduplication: shouldMaterialNotifyTrainees, the offering-eligibility filter
 * and the recipient collapse all come from
 * ./material-notification-recipient-core, which is behaviourally tested without a
 * database. What is left here is sequencing and Prisma binding.
 *
 * DIRECTION OF RESOLUTION (load-bearing)
 * --------------------------------------
 *   persisted material
 *     -> its persisted audience offering ids        <- the OUTER boundary
 *     -> offering ACTIVE + materials capability ENABLED
 *     -> ACTIVE CourseEnrollment
 *     -> active Student
 *     -> deduplicated student ids
 *
 * It NEVER runs in the other direction. Resolving a trainee's own enrollments
 * first and then asking whether the material "looks like" theirs is precisely how
 * a dual-enrolled trainee ends up notified about the other course's material; the
 * material's own audience is the only thing that may open the gate.
 */
import { prisma } from "@/lib/prisma";
import { getEffectiveCapabilities } from "./offering-capabilities";
import {
  MATERIAL_NOTIFICATION_CAPABILITY_KEY,
  resolveEligibleMaterialNotificationOfferingIds,
  resolveMaterialNotificationRecipientIds,
  shouldMaterialNotifyTrainees,
  type MaterialNotificationEnrollmentRow,
  type MaterialNotificationOfferingRow,
} from "./material-notification-recipient-core";

// ---------------------------------------------------------------------------
// The rows this shell reads
// ---------------------------------------------------------------------------

/**
 * The persisted material, exactly as the fan-out is allowed to see it.
 *
 * `visibility` is typed `string` deliberately: it is a value read back from the
 * database, and every consumer compares it with a POSITIVE allow-list, so an
 * unexpected, retired or malformed persisted value fails CLOSED instead of
 * slipping through a negative test.
 */
export interface PersistedMaterialRow {
  readonly id: string;
  readonly title: string;
  readonly visibility: string;
  readonly isActive: boolean;
  readonly audiences: readonly { readonly courseOfferingId: string }[];
}

/** One audience offering's lifecycle, as read from CourseOffering.status. */
export interface AudienceOfferingRow {
  readonly id: string;
  readonly status: string;
}

/** One enrollment considered for the fan-out, with the trainee's own live flag. */
export interface TraineeEnrollmentRow {
  readonly studentId: string;
  readonly courseOfferingId: string;
  readonly status: string;
  readonly student: { readonly isActive: boolean } | null;
}

/**
 * The single authoritative answer both fan-out branches consume.
 *
 * `title`, `visibility` and `isActive` are the PERSISTED values - never the
 * caller's. `traineeRecipientIds` is already deduplicated and is empty whenever
 * the material does not address trainees, has no audience, or resolves to nobody.
 */
export interface MaterialNotificationSnapshot {
  readonly materialId: string;
  readonly title: string;
  readonly visibility: string;
  readonly isActive: boolean;
  readonly traineeRecipientIds: readonly string[];
}

// ---------------------------------------------------------------------------
// Dependency-injected orchestration (testable without Prisma)
// ---------------------------------------------------------------------------

/**
 * The injected boundaries of the snapshot read.
 *
 * `loadMaterial` returns `null` for an unknown id. `isMaterialsCapabilityEnabled`
 * resolves ONE offering's effective materials-capability verdict through the
 * committed capability reader - this shell never interprets a capability row
 * itself. `loadEnrollments` is called at most once, with the already-filtered
 * eligible offering ids.
 */
export interface MaterialNotificationSnapshotDeps {
  loadMaterial: (materialId: string) => Promise<PersistedMaterialRow | null>;
  loadOfferings: (offeringIds: readonly string[]) => Promise<readonly AudienceOfferingRow[]>;
  isMaterialsCapabilityEnabled: (courseOfferingId: string) => Promise<boolean>;
  loadEnrollments: (offeringIds: readonly string[]) => Promise<readonly TraineeEnrollmentRow[]>;
}

/** First-seen deduplication of the persisted audience offering ids. */
function distinctAudienceOfferingIds(material: PersistedMaterialRow): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const audience of material.audiences ?? []) {
    const id = audience?.courseOfferingId;
    if (typeof id !== "string" || id.trim().length === 0) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/**
 * Load the authoritative snapshot for one material id, or `null` when no such
 * material exists.
 *
 * A `null` result means "notify nobody at all" - not "fall back to the caller's
 * parameters". The order below is deliberate and each step short-circuits, so an
 * instructor-only, hidden, unassigned or unreachable material costs the minimum
 * number of reads and can never reach a later step that might produce a recipient.
 *
 *  1. the material row (one read; `null` -> whole fan-out refused);
 *  2. the trainee gate - persisted isActive AND persisted trainee visibility;
 *  3. the persisted audience offering ids (empty -> no recipients, fail-closed);
 *  4. those offerings' lifecycle rows;
 *  5. the effective materials-capability verdict, resolved AT MOST ONCE per distinct
 *     audience offering and ONLY for offerings that are actually ACTIVE - a
 *     PLANNED or ARCHIVED offering is already excluded by its lifecycle, so
 *     paying for its capability read would be wasted IO that cannot change the
 *     answer;
 *  6. the enrollments of the eligible offerings only;
 *  7. the pure core collapses them to one id per trainee.
 *
 * A malformed identifier reaching the pure core THROWS (MaterialNotificationIdError,
 * PII-free) and refuses the entire fan-out. That is the committed contract and it
 * is not softened here: a partial send that looks exactly like a correct one is a
 * worse outcome than a loud refusal.
 */
export async function loadMaterialNotificationSnapshotWithDeps(
  materialId: string,
  deps: MaterialNotificationSnapshotDeps,
): Promise<MaterialNotificationSnapshot | null> {
  const material = await deps.loadMaterial(materialId);
  if (material === null || material === undefined) {
    return null;
  }

  const snapshot = {
    materialId: material.id,
    title: material.title,
    visibility: material.visibility,
    isActive: material.isActive === true,
  };

  // The material gate is the pure core's, not a local restatement of it.
  if (!shouldMaterialNotifyTrainees(material.isActive, material.visibility)) {
    return { ...snapshot, traineeRecipientIds: Object.freeze([]) };
  }

  const audienceOfferingIds = distinctAudienceOfferingIds(material);
  if (audienceOfferingIds.length === 0) {
    return { ...snapshot, traineeRecipientIds: Object.freeze([]) };
  }

  const offeringRows = await deps.loadOfferings(audienceOfferingIds);

  const candidates: MaterialNotificationOfferingRow[] = [];
  const seenOffering = new Set<string>();
  for (const offering of offeringRows ?? []) {
    const id = offering?.id;
    if (typeof id !== "string" || id.trim().length === 0) continue;
    if (seenOffering.has(id)) continue;
    seenOffering.add(id);
    const offeringActive = offering.status === "ACTIVE";
    candidates.push({
      courseOfferingId: id,
      offeringActive,
      // Strictly one capability resolution per distinct ACTIVE audience offering.
      materialsCapabilityEnabled:
        offeringActive && (await deps.isMaterialsCapabilityEnabled(id)) === true,
    });
  }

  const eligibleOfferingIds = resolveEligibleMaterialNotificationOfferingIds(candidates);
  if (eligibleOfferingIds.length === 0) {
    return { ...snapshot, traineeRecipientIds: Object.freeze([]) };
  }

  const enrollmentRows = await deps.loadEnrollments(eligibleOfferingIds);
  const enrollments: MaterialNotificationEnrollmentRow[] = (enrollmentRows ?? []).map((row) => ({
    studentId: row?.studentId as string,
    courseOfferingId: row?.courseOfferingId as string,
    enrollmentActive: row?.status === "ACTIVE",
    traineeActive: row?.student?.isActive === true,
  }));

  return {
    ...snapshot,
    traineeRecipientIds: resolveMaterialNotificationRecipientIds(enrollments, eligibleOfferingIds),
  };
}

// ---------------------------------------------------------------------------
// Thin Prisma binding
// ---------------------------------------------------------------------------

/**
 * The production snapshot read.
 *
 * The material and its audience offering ids come from ONE query via the
 * `audiences` relation (see the module docstring for why the relation and not the
 * audience delegate). The enrollment query selects the trainee's `isActive`
 * through the relation rather than issuing a separate global student query - a
 * global student-table query is exactly the widening this slice removes.
 */
export async function loadMaterialNotificationSnapshot(
  materialId: string,
): Promise<MaterialNotificationSnapshot | null> {
  return loadMaterialNotificationSnapshotWithDeps(materialId, {
    loadMaterial: (id) =>
      prisma.courseMaterial.findUnique({
        where: { id },
        select: {
          id: true,
          title: true,
          visibility: true,
          isActive: true,
          audiences: { select: { courseOfferingId: true } },
        },
      }),
    loadOfferings: (offeringIds) =>
      prisma.courseOffering.findMany({
        where: { id: { in: [...offeringIds] } },
        select: { id: true, status: true },
      }),
    isMaterialsCapabilityEnabled: async (courseOfferingId) => {
      const capabilities = await getEffectiveCapabilities(courseOfferingId);
      return capabilities[MATERIAL_NOTIFICATION_CAPABILITY_KEY] === "ENABLED";
    },
    loadEnrollments: (offeringIds) =>
      prisma.courseEnrollment.findMany({
        where: { courseOfferingId: { in: [...offeringIds] } },
        select: {
          studentId: true,
          courseOfferingId: true,
          status: true,
          student: { select: { isActive: true } },
        },
      }),
  });
}
