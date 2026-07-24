"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getSupabaseClient, COURSE_MATERIALS_BUCKET } from "@/lib/supabase";
import { createMaterialAddedNotifications } from "@/lib/actions/notifications";
import type { ActionResult } from "@/lib/actions/students";
// SECURITY / LEVEL 2 SLICE L2-M1C - server-derived trainee identity + the
// COURSE_MATERIALS capability gate for the trainee-facing getStudentMaterials
// below. getInstructorMaterials and every admin action in this file are
// deliberately untouched and keep their existing behaviour / requireAdmin gate.
import { requireCurrentTrainee } from "@/lib/auth/actor";
import { resolveTraineeCourseOffering } from "@/lib/course/actor-course-offering";
import { getEffectiveCapabilities } from "@/lib/course/capabilities/offering-capabilities";
import type { CapabilityKey } from "@/lib/course/capabilities/capability-keys";
import {
  loadAuthorizedTraineeModuleRowsWithDeps,
  type TraineeModuleContextDeps,
} from "@/lib/course/trainee-module-containment-core";

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
 * (L2-M1C). A DEDICATED canonical key (capability-keys.ts, added by L2-M1A) - no
 * unrelated capability is reused. The CapabilityKey annotation makes a typo a
 * compile error.
 */
const TRAINEE_COURSE_MATERIALS_CAPABILITY_KEY: CapabilityKey = "COURSE_MATERIALS";

// Real, server-owned dependencies only: the trainee id from the signed session
// via the canonical Actor DAL (requireCurrentTrainee rejects anonymous,
// expired, wrong-audience and INACTIVE sessions), the offering from the
// committed no-argument resolveTraineeCourseOffering(), and that exact
// offering's capabilities. No courseOfferingId parameter, no legacy singleton
// offering resolver, no Level 1 fallback, no inference from date, group, level
// or name.
const TRAINEE_COURSE_MATERIALS_DEPS: TraineeModuleContextDeps = {
  requireTraineeId: async () => (await requireCurrentTrainee()).id,
  resolveTraineeCourseOffering,
  getEffectiveCapabilities,
};

// SECURITY / LEVEL 2 SLICE L2-M1C - CONTAINED. This reader previously had NO
// gate at all: any caller, including an anonymous one, received every
// STUDENTS/BOTH material row together with freshly minted signed storage URLs.
// The caller is now derived from the signed session and the resolved offering's
// COURSE_MATERIALS capability must be positively ENABLED before a single
// CourseMaterial row is fetched - and therefore before any signed URL can be
// generated, since signing only ever happens over already-loaded rows inside
// getMaterialsForVisibilities.
//
// RESIDUAL, ACCEPTED IN THIS SLICE: CourseMaterial has no courseOfferingId
// column, so the library is still GLOBAL. The capability is the offering-level
// containment boundary: an offering without an ENABLED COURSE_MATERIALS row
// (Level 2) sees nothing, and an offering with one (Level 1) sees the whole
// global library exactly as before. Per-offering material OWNERSHIP is a later
// schema slice; no schema field is added here.
//
// Every denial - anonymous, expired, wrong audience, inactive trainee, no
// eligible offering, ambiguous offering, missing capability row, DISABLED,
// READ_ONLY, malformed capability map - returns the SAME empty array this
// action already returned when there were no materials, so a Level 2 trainee
// cannot distinguish "denied" from "nothing published" and no Level 1 material
// metadata is disclosed. Prisma / storage / programming failures are NOT
// denials and propagate unchanged.
export async function getStudentMaterials(): Promise<RoleMaterialItem[]> {
  return loadAuthorizedTraineeModuleRowsWithDeps(
    TRAINEE_COURSE_MATERIALS_CAPABILITY_KEY,
    TRAINEE_COURSE_MATERIALS_DEPS,
    // Unreachable unless every gate passed. The visibility filter is unchanged,
    // so an authorized Level 1 trainee receives exactly the previous rows and
    // signed URLs.
    async () => getMaterialsForVisibilities(["STUDENTS", "BOTH"])
  );
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
}

export async function getMaterialsForAdmin(): Promise<AdminMaterialRow[]> {
  await requireAdmin();

  const materials = await prisma.courseMaterial.findMany({
    orderBy: { createdAt: "desc" },
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
      };
    })
  );
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

  const created = await prisma.courseMaterial.create({
    data: {
      title: parsed.data.title,
      description: parsed.data.description || null,
      materialType: "LINK",
      visibility: parsed.data.visibility,
      externalUrl: parsed.data.externalUrl,
    },
  });

  await createMaterialAddedNotifications({
    materialId: created.id,
    title: created.title,
    visibility: created.visibility,
  });

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

  const material = await prisma.courseMaterial.findUnique({ where: { id: materialId } });
  if (!material) {
    return { success: false, error: "המסמך לא נמצא" };
  }

  await prisma.courseMaterial.update({
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
