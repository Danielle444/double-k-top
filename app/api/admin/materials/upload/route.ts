import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { getSupabaseClient, COURSE_MATERIALS_BUCKET } from "@/lib/supabase";

type CourseMaterialVisibility = "STUDENTS" | "INSTRUCTORS" | "BOTH";

// Uploaded here instead of through a Server Action for the same reason as
// the course booklet's upload route: Server Actions have shown to fail on
// real multi-MB multipart bodies, while a plain Route Handler reading
// Request.formData() does not share that limitation.

const PDF_MAGIC_BYTES = "%PDF-";
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // matches the materials bucket's file size limit
const VALID_VISIBILITIES: CourseMaterialVisibility[] = ["STUDENTS", "INSTRUCTORS", "BOTH"];

function isPdfBuffer(buffer: Buffer): boolean {
  return buffer.subarray(0, 5).toString("latin1") === PDF_MAGIC_BYTES;
}

// Keeps only characters safe for a Supabase Storage path segment - strips
// anything that could be interpreted as a path separator or otherwise cause
// issues, rather than trusting the original uploaded filename verbatim.
function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[^\w.\-]+/g, "_").replace(/_+/g, "_");
  return cleaned.slice(-150) || "document.pdf";
}

export async function POST(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ success: false, error: "נדרשת התחברות" }, { status: 401 });
  }

  const adminEmail = await prisma.adminEmail.findUnique({ where: { email } });
  if (!adminEmail || !adminEmail.isActive) {
    return NextResponse.json({ success: false, error: "אין הרשאה לפעולה זו" }, { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { success: false, error: "העלאת הקובץ נכשלה - נסו שוב" },
      { status: 400 }
    );
  }

  const file = formData.get("file");
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const visibility = String(formData.get("visibility") ?? "");
  const materialIdField = formData.get("materialId");
  const materialId = typeof materialIdField === "string" && materialIdField ? materialIdField : null;

  if (!title) {
    return NextResponse.json({ success: false, error: "יש להזין כותרת" }, { status: 400 });
  }
  if (!VALID_VISIBILITIES.includes(visibility as CourseMaterialVisibility)) {
    return NextResponse.json({ success: false, error: "יש לבחור קהל יעד" }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ success: false, error: "לא נבחר קובץ" }, { status: 400 });
  }
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ success: false, error: "יש להעלות קובץ PDF בלבד" }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json(
      { success: false, error: "הקובץ גדול מדי - הגודל המרבי הוא 50MB" },
      { status: 400 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (!isPdfBuffer(buffer)) {
    return NextResponse.json(
      { success: false, error: "הקובץ שהועלה אינו PDF תקין" },
      { status: 400 }
    );
  }

  let existing: { id: string; filePath: string | null; materialType: string } | null = null;
  if (materialId) {
    existing = await prisma.courseMaterial.findUnique({
      where: { id: materialId },
      select: { id: true, filePath: true, materialType: true },
    });
    if (!existing || existing.materialType !== "FILE") {
      return NextResponse.json({ success: false, error: "המסמך לא נמצא" }, { status: 404 });
    }
  }

  const id = existing?.id ?? crypto.randomUUID();
  const storagePath = `${id}/${sanitizeFileName(file.name)}`;

  const supabase = getSupabaseClient();
  if (!supabase) {
    return NextResponse.json(
      { success: false, error: "אחסון הקבצים אינו מוגדר כראוי בשרת (חסרים משתני סביבה)" },
      { status: 500 }
    );
  }

  const { error: uploadError } = await supabase.storage
    .from(COURSE_MATERIALS_BUCKET)
    .upload(storagePath, buffer, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (uploadError) {
    return NextResponse.json(
      { success: false, error: "העלאת הקובץ לאחסון נכשלה" },
      { status: 502 }
    );
  }

  // Best-effort cleanup of the previous file when replacing with a
  // differently-named one - never blocks the response on failure.
  if (existing?.filePath && existing.filePath !== storagePath) {
    await supabase.storage.from(COURSE_MATERIALS_BUCKET).remove([existing.filePath]).catch(() => {});
  }

  if (existing) {
    await prisma.courseMaterial.update({
      where: { id: existing.id },
      data: {
        title,
        description: description || null,
        visibility: visibility as CourseMaterialVisibility,
        filePath: storagePath,
        fileName: file.name,
      },
    });
  } else {
    await prisma.courseMaterial.create({
      data: {
        id,
        title,
        description: description || null,
        materialType: "FILE",
        visibility: visibility as CourseMaterialVisibility,
        filePath: storagePath,
        fileName: file.name,
      },
    });
  }

  revalidatePath("/admin/materials");
  revalidatePath("/student");
  revalidatePath("/instructor");

  return NextResponse.json({ success: true });
}
