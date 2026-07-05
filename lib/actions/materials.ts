"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getSupabaseClient, COURSE_MATERIALS_BUCKET } from "@/lib/supabase";
import type { ActionResult } from "@/lib/actions/students";

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

// Read-only, no permission gate - same convention as getBookletAccess /
// getStudentContacts, since students/instructors have no NextAuth session in
// this app. The visibility filter is enforced here, server-side, not by the
// UI hiding anything.
export async function getStudentMaterials(): Promise<RoleMaterialItem[]> {
  return getMaterialsForVisibilities(["STUDENTS", "BOTH"]);
}

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

  await prisma.courseMaterial.create({
    data: {
      title: parsed.data.title,
      description: parsed.data.description || null,
      materialType: "LINK",
      visibility: parsed.data.visibility,
      externalUrl: parsed.data.externalUrl,
    },
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
