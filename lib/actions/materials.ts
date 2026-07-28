"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getSupabaseClient, COURSE_MATERIALS_BUCKET } from "@/lib/supabase";
import { createMaterialAddedNotifications } from "@/lib/actions/notifications";
import type { ActionResult } from "@/lib/actions/students";
// SECURITY / LEVEL 2 SLICE L2-M1C + P-MATERIALS M2C - server-derived trainee
// identity and the COURSE_MATERIALS capability gate for the trainee-facing
// getStudentMaterials below, now scoped to the UNION of the trainee's active
// enabled offerings' audiences. getInstructorMaterials and every admin action in
// this file are deliberately untouched and keep their existing behaviour /
// requireAdmin gate.
import { requireCurrentTrainee } from "@/lib/auth/actor";
import { getEffectiveCapabilities } from "@/lib/course/capabilities/offering-capabilities";
import type { CapabilityKey } from "@/lib/course/capabilities/capability-keys";
import { loadTraineeScopedMaterialsWithDeps } from "@/lib/course/trainee-materials-offering-scope-core";
// P-MATERIALS M2B - offering-scoped audience persistence. The identifier-shape
// validation + reconcile diff come from the committed pure M2A core; the
// offering authorization + Prisma bindings from the shared M2B write module.
import {
  normalizeMaterialAudienceOfferingIds,
  MaterialAudienceInputError,
} from "@/lib/course/material-audience-reconcile-core";
import {
  assertOfferingIdsAllowed,
  applyMaterialAudiences,
  resolveCurrentActivityYearIdFromRows,
  NoCurrentActivityYearError,
  OfferingNotAllowedError,
} from "@/lib/course/material-audience-write";
// P-MATERIALS M2D - admin offering picker. The current-year derivation is REUSED
// from the M2B write module above so the picker and the writer authorize exactly
// the same offering set (agreement is cross-checked in the picker-core test).
import {
  buildMaterialOfferingPickerOptions,
  type MaterialOfferingOption,
} from "@/lib/course/material-offering-picker-core";

const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour, matches the booklet's TTL

const materialVisibilitySchema = z.enum(["STUDENTS", "INSTRUCTORS", "BOTH"]);

export type CourseMaterialTypeValue = "FILE" | "LINK";
export type CourseMaterialVisibilityValue = z.infer<typeof materialVisibilitySchema>;

async function signFileUrls(m: {
  materialType: CourseMaterialTypeValue;
  filePath: string | null;
  fileName: string | null;
}): Promise<{ viewUrl: string | null; downloadUrl: string | null }> {
  if (m.materialType !== "FILE" || !m.filePath) return { viewUrl: null, downloadUrl: null };

  const supabase = getSupabaseClient();
  if (!supabase) return { viewUrl: null, downloadUrl: null };

  const [viewResult, downloadResult] = await Promise.all([
    supabase.storage.from(COURSE_MATERIALS_BUCKET).createSignedUrl(m.filePath, SIGNED_URL_TTL_SECONDS),
    supabase.storage
      .from(COURSE_MATERIALS_BUCKET)
      .createSignedUrl(m.filePath, SIGNED_URL_TTL_SECONDS, { download: m.fileName ?? undefined }),
  ]);

  return {
    viewUrl: viewResult.data?.signedUrl ?? null,
    downloadUrl: downloadResult.data?.signedUrl ?? null,
  };
}

export interface RoleMaterialItem {
  id: string;
  title: string;
  description: string | null;
  materialType: CourseMaterialTypeValue;
  externalUrl: string | null;
  fileName: string | null;
  viewUrl: string | null;
  downloadUrl: string | null;
  createdAt: string;
}

// Shared by the student and instructor reads - the only difference between
// the two is which visibility values are included, both always require
// isActive: true and never expose anything beyond a signed view/download URL.
async function getMaterialsForVisibilities(
  visibilities: CourseMaterialVisibilityValue[]
): Promise<RoleMaterialItem[]> {
  const materials = await prisma.courseMaterial.findMany({
    where: { isActive: true, visibility: { in: visibilities } },
    orderBy: { createdAt: "desc" },
  });

  return Promise.all(
    materials.map(async (m) => {
      const { viewUrl, downloadUrl } = await signFileUrls(m);
      return {
        id: m.id,
        title: m.title,
        description: m.description,
        materialType: m.materialType,
        externalUrl: m.externalUrl,
        fileName: m.fileName,
        viewUrl,
        downloadUrl,
        createdAt: m.createdAt.toISOString(),
      };
    })
  );
}

/**
 * The single capability that authorizes any trainee course-material read
 * (L2-M1A/L2-M1C). A DEDICATED canonical key (capability-keys.ts) - no unrelated
 * capability is reused. The CapabilityKey annotation makes a typo a compile
 * error.
 */
const TRAINEE_COURSE_MATERIALS_CAPABILITY_KEY: CapabilityKey = "COURSE_MATERIALS";

// P-MATERIALS M2C - the audience-scoped trainee material query. Runs ONLY after
// the scope gate has resolved a non-empty set of enabled offering ids, so no
// CourseMaterial row is read (and no storage URL signed) for an unauthorized or
// unscoped caller. A material is returned when it is active, its visibility
// addresses trainees (STUDENTS/BOTH), AND it has at least one audience row for
// one of the enabled offering ids. A material shared by two of the
// trainee's enabled offerings still matches ONCE (a single material row). A
// material with zero audience rows can never match -> fail-closed / invisible.
// Order and signed-URL behaviour are unchanged from the previous reader.
async function getTraineeScopedMaterials(
  enabledOfferingIds: readonly string[]
): Promise<RoleMaterialItem[]> {
  const materials = await prisma.courseMaterial.findMany({
    where: {
      isActive: true,
      visibility: { in: ["STUDENTS", "BOTH"] },
      audiences: { some: { courseOfferingId: { in: [...enabledOfferingIds] } } },
    },
    orderBy: { createdAt: "desc" },
  });

  return Promise.all(
    materials.map(async (m) => {
      const { viewUrl, downloadUrl } = await signFileUrls(m);
      return {
        id: m.id,
        title: m.title,
        description: m.description,
        materialType: m.materialType,
        externalUrl: m.externalUrl,
        fileName: m.fileName,
        viewUrl,
        downloadUrl,
        createdAt: m.createdAt.toISOString(),
      };
    })
  );
}

// P-MATERIALS M2C - trainee course materials scoped to the UNION of every
// CourseOffering the trainee is actively enrolled in, whose offering is ACTIVE,
// and whose COURSE_MATERIALS capability is effectively ENABLED. The trainee is
// always derived from the signed session (requireCurrentTrainee rejects
// anonymous, expired, wrong-audience and INACTIVE sessions); no client studentId
// or courseOfferingId is accepted. ALL of the trainee's enrollments are loaded
// and each distinct active offering's COURSE_MATERIALS capability is resolved
// INDEPENDENTLY - there is deliberately no assumption of "only two offerings", no
// inference by level/name/date/group, and the single-offering
// resolveTraineeCourseOffering (which collapses a dual enrollment to Level 1) is
// NOT used.
//
// CURRENT PRODUCTION EFFECT (no capability enabled by this slice): Level 1 has
// COURSE_MATERIALS ENABLED, so a Level-1 trainee sees the Level-1 materials; a
// Level-2-only trainee sees [] until COURSE_MATERIALS is enabled for Level 2; a
// dual-enrolled trainee sees Level-1 materials now and will automatically gain
// Level-2 materials the moment that capability is enabled - no code change.
//
// Every denial - anonymous, expired, wrong audience, inactive trainee, no active
// enabled offering - returns the SAME empty array this action returned when there
// were no materials, so "denied" is indistinguishable from "nothing published"
// and no material metadata leaks. Prisma / storage failures are NOT denials and
// propagate unchanged; signing stays downstream of the scope gate (it only ever
// runs inside getTraineeScopedMaterials, over already-loaded rows).
export async function getStudentMaterials(): Promise<RoleMaterialItem[]> {
  return loadTraineeScopedMaterialsWithDeps<RoleMaterialItem>({
    requireTraineeId: async () => (await requireCurrentTrainee()).id,
    loadEnrollments: async (traineeId) => {
      const rows = await prisma.courseEnrollment.findMany({
        where: { studentId: traineeId },
        select: {
          courseOfferingId: true,
          status: true,
          courseOffering: { select: { status: true } },
        },
      });
      return rows.map((r) => ({
        courseOfferingId: r.courseOfferingId,
        enrollmentStatus: r.status,
        offeringStatus: r.courseOffering.status,
      }));
    },
    isMaterialsCapabilityEnabled: async (courseOfferingId) => {
      const capabilities = await getEffectiveCapabilities(courseOfferingId);
      return capabilities[TRAINEE_COURSE_MATERIALS_CAPABILITY_KEY] === "ENABLED";
    },
    loadMaterials: (enabledOfferingIds) => getTraineeScopedMaterials(enabledOfferingIds),
  });
}

// Read-only, no permission gate - unchanged by L2-M1C, which contains the
// TRAINEE surface only. The visibility filter is enforced here, server-side,
// not by the UI hiding anything.
export async function getInstructorMaterials(): Promise<RoleMaterialItem[]> {
  return getMaterialsForVisibilities(["INSTRUCTORS", "BOTH"]);
}

export interface AdminMaterialRow {
  id: string;
  title: string;
  description: string | null;
  materialType: CourseMaterialTypeValue;
  visibility: CourseMaterialVisibilityValue;
  externalUrl: string | null;
  fileName: string | null;
  isActive: boolean;
  createdAt: string;
  viewUrl: string | null;
  // P-MATERIALS M2D - the material's assigned CourseOffering audience, from the
  // SAME audience join the trainee reader uses (no second source). Ids drive the
  // edit form's pre-selection; the {id,label} pairs are directly renderable chips.
  // An empty array = zero audience rows = the admin "לא משויך לאף קורס" warning.
  audienceOfferingIds: readonly string[];
  audienceOfferings: readonly { id: string; label: string }[];
}

export async function getMaterialsForAdmin(): Promise<AdminMaterialRow[]> {
  await requireAdmin();

  const materials = await prisma.courseMaterial.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      audiences: {
        select: { courseOfferingId: true, courseOffering: { select: { name: true } } },
      },
    },
  });

  return Promise.all(
    materials.map(async (m) => {
      const { viewUrl } = await signFileUrls(m);
      return {
        id: m.id,
        title: m.title,
        description: m.description,
        materialType: m.materialType,
        visibility: m.visibility,
        externalUrl: m.externalUrl,
        fileName: m.fileName,
        isActive: m.isActive,
        createdAt: m.createdAt.toISOString(),
        viewUrl,
        audienceOfferingIds: m.audiences.map((a) => a.courseOfferingId),
        audienceOfferings: m.audiences.map((a) => ({
          id: a.courseOfferingId,
          label: a.courseOffering.name,
        })),
      };
    })
  );
}

// P-MATERIALS M2D - the admin CourseOffering picker options for assigning a
// material's audience. Admin-gated. The current ActivityYear is derived by the
// SAME function the M2B writer uses (resolveCurrentActivityYearIdFromRows), so
// the picker offers exactly the set the writer will accept; the status filter
// (ACTIVE/PLANNED, no ARCHIVED, current year only) and its agreement with the
// writer are pinned by the picker-core test. Each option carries the effective
// COURSE_MATERIALS enabled flag so the UI can warn that trainees won't see a
// material assigned to a not-yet-enabled offering. An unresolvable current year
// (0 or >1 ACTIVE-offering years) fails closed to no options - the writer would
// reject any selection anyway. This slice enables NO capability.
export type { MaterialOfferingOption } from "@/lib/course/material-offering-picker-core";

export async function getMaterialOfferingOptions(): Promise<MaterialOfferingOption[]> {
  await requireAdmin();

  const activeYearRows = await prisma.courseOffering.findMany({
    where: { status: "ACTIVE" },
    select: { activityYearId: true },
  });

  let currentActivityYearId: string;
  try {
    currentActivityYearId = resolveCurrentActivityYearIdFromRows(activeYearRows);
  } catch (error) {
    if (error instanceof NoCurrentActivityYearError) return [];
    throw error;
  }

  const rows = await prisma.courseOffering.findMany({
    where: { activityYearId: currentActivityYearId, status: { in: ["ACTIVE", "PLANNED"] } },
    select: { id: true, name: true, level: true, status: true, activityYearId: true },
  });

  const capabilityEnabledById = new Map<string, boolean>();
  for (const row of rows) {
    const capabilities = await getEffectiveCapabilities(row.id);
    capabilityEnabledById.set(
      row.id,
      capabilities[TRAINEE_COURSE_MATERIALS_CAPABILITY_KEY] === "ENABLED"
    );
  }

  return [...buildMaterialOfferingPickerOptions(rows, currentActivityYearId, capabilityEnabledById)];
}

const createLinkSchema = z.object({
  title: z.string().trim().min(1, "יש להזין כותרת"),
  description: z.string().trim().optional(),
  visibility: materialVisibilitySchema,
  externalUrl: z.string().trim().url("כתובת URL לא תקינה"),
});

export interface CreateLinkMaterialInput {
  title: string;
  description?: string;
  visibility: CourseMaterialVisibilityValue;
  externalUrl: string;
  // P-MATERIALS M2B - the CourseOffering(s) this material is visible to for
  // trainees. MANDATORY AT RUNTIME (at least one, deduped, only current-year
  // ACTIVE/PLANNED ids; never defaults to all courses) - enforced by
  // normalizeMaterialAudienceOfferingIds, which rejects undefined/empty. The
  // TYPE is optional on purpose so the codebase still compiles before the M2D
  // admin UI is wired to send it; an absent value fails the write at runtime.
  courseOfferingIds?: string[];
}

// P-MATERIALS M2B - map an audience/offering write failure to a user-facing
// ActionResult, or null when the error is not one of these (a real defect, which
// must propagate). Shared by createLinkMaterial and updateMaterial. Kept
// module-private (not exported) so it is never exposed as a Server Action.
function audienceWriteErrorToResult(error: unknown): ActionResult | null {
  if (error instanceof MaterialAudienceInputError) {
    return {
      success: false,
      error: error.code === "EMPTY_SELECTION" ? "יש לבחור לפחות קורס אחד" : "בחירת קורס לא תקינה",
    };
  }
  if (error instanceof OfferingNotAllowedError) {
    return { success: false, error: "אחד הקורסים שנבחרו אינו זמין לשיוך" };
  }
  if (error instanceof NoCurrentActivityYearError) {
    return { success: false, error: "לא ניתן לקבוע את שנת הפעילות הנוכחית" };
  }
  return null;
}

// File materials are created via app/api/admin/materials/upload/route.ts
// instead (multipart upload needs a Route Handler - see that file for why),
// this action only ever creates LINK materials.
export async function createLinkMaterial(input: CreateLinkMaterialInput): Promise<ActionResult> {
  await requireAdmin();

  const parsed = createLinkSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "קלט לא תקין" };
  }

  let offeringIds: readonly string[];
  try {
    offeringIds = normalizeMaterialAudienceOfferingIds(input.courseOfferingIds);
  } catch (error) {
    const mapped = audienceWriteErrorToResult(error);
    if (mapped) return mapped;
    throw error;
  }

  try {
    // Material row + audience rows commit or roll back together; the offering
    // authorization is re-checked INSIDE the transaction so an offering archived
    // mid-write cannot slip through. No audience row is written outside it.
    const created = await prisma.$transaction(async (tx) => {
      await assertOfferingIdsAllowed(tx, offeringIds);
      const material = await tx.courseMaterial.create({
        data: {
          title: parsed.data.title,
          description: parsed.data.description || null,
          materialType: "LINK",
          visibility: parsed.data.visibility,
          externalUrl: parsed.data.externalUrl,
        },
      });
      await applyMaterialAudiences(tx, material.id, offeringIds);
      return material;
    });

    // Notification fan-out runs only AFTER the transaction above has committed,
    // so the material and its audience rows are durable before anyone is told
    // about them. The values passed here are NOT what drives the fan-out: it
    // re-reads the persisted CourseMaterial by id and resolves trainee recipients
    // from that row's persisted CourseOffering audiences (P-MATERIALS M3B), so a
    // wrong or forged argument can neither widen nor alter who is notified.
    await createMaterialAddedNotifications({
      materialId: created.id,
      title: created.title,
      visibility: created.visibility,
    });
  } catch (error) {
    const mapped = audienceWriteErrorToResult(error);
    if (mapped) return mapped;
    throw error;
  }

  revalidatePath("/admin/materials");
  revalidatePath("/student");
  revalidatePath("/instructor");
  return { success: true };
}

const updateSchema = z.object({
  title: z.string().trim().min(1, "יש להזין כותרת"),
  description: z.string().trim().optional(),
  visibility: materialVisibilitySchema,
  externalUrl: z.string().trim().url("כתובת URL לא תקינה").optional(),
});

export interface UpdateMaterialInput {
  title: string;
  description?: string;
  visibility: CourseMaterialVisibilityValue;
  externalUrl?: string;
  // P-MATERIALS M2B - the full desired CourseOffering audience set. Replaces the
  // existing set via a reconcile diff (unchanged rows untouched). MANDATORY AT
  // RUNTIME (at least one, deduped, only current-year ACTIVE/PLANNED ids);
  // optional in the TYPE only so the pre-M2D UI still compiles. An absent value
  // fails the write at runtime.
  courseOfferingIds?: string[];
}

// Title/description/visibility are editable for any material; externalUrl is
// only ever applied when the material is actually a LINK (a FILE material's
// content is only replaced through the upload route, never through here).
export async function updateMaterial(
  materialId: string,
  data: UpdateMaterialInput
): Promise<ActionResult> {
  await requireAdmin();

  const parsed = updateSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "קלט לא תקין" };
  }

  let offeringIds: readonly string[];
  try {
    offeringIds = normalizeMaterialAudienceOfferingIds(data.courseOfferingIds);
  } catch (error) {
    const mapped = audienceWriteErrorToResult(error);
    if (mapped) return mapped;
    throw error;
  }

  const material = await prisma.courseMaterial.findUnique({ where: { id: materialId } });
  if (!material) {
    return { success: false, error: "המסמך לא נמצא" };
  }

  try {
    // Metadata update + audience reconcile in one transaction; offering
    // authorization re-checked inside it. Reconcile deletes only removed rows and
    // creates only new ones - editing the audience never deletes the material or
    // its storage object.
    await prisma.$transaction(async (tx) => {
      await assertOfferingIdsAllowed(tx, offeringIds);
      await tx.courseMaterial.update({
        where: { id: materialId },
        data: {
          title: parsed.data.title,
          description: parsed.data.description || null,
          visibility: parsed.data.visibility,
          ...(material.materialType === "LINK" && parsed.data.externalUrl
            ? { externalUrl: parsed.data.externalUrl }
            : {}),
        },
      });
      await applyMaterialAudiences(tx, materialId, offeringIds);
    });
  } catch (error) {
    const mapped = audienceWriteErrorToResult(error);
    if (mapped) return mapped;
    throw error;
  }

  revalidatePath("/admin/materials");
  revalidatePath("/student");
  revalidatePath("/instructor");
  return { success: true };
}

// Soft hide only - no hard delete in Stage A. Storage objects for FILE
// materials are never removed by this action.
export async function setMaterialActive(materialId: string, isActive: boolean): Promise<ActionResult> {
  await requireAdmin();

  await prisma.courseMaterial.update({
    where: { id: materialId },
    data: { isActive },
  });

  revalidatePath("/admin/materials");
  revalidatePath("/student");
  revalidatePath("/instructor");
  return { success: true };
}
