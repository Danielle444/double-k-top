import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import {
  getSupabaseClient,
  COURSE_BOOKLET_BUCKET,
  COURSE_BOOKLET_STORAGE_PATH,
} from "@/lib/supabase";

// The booklet PDF (up to 50MB) is uploaded here instead of through a Server
// Action - Server Actions have their own multipart body handling that has
// shown to fail on real multi-MB files ("Unexpected end of form"); a plain
// Route Handler reading the standard Request.formData() does not share that
// limitation and has no artificial body-size cap of its own.

const PDF_MAGIC_BYTES = "%PDF-";
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // matches the Supabase bucket's file size limit

function isPdfBuffer(buffer: Buffer): boolean {
  return buffer.subarray(0, 5).toString("latin1") === PDF_MAGIC_BYTES;
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

  const supabase = getSupabaseClient();
  if (!supabase) {
    return NextResponse.json(
      { success: false, error: "אחסון הקבצים אינו מוגדר כראוי בשרת (חסרים משתני סביבה)" },
      { status: 500 }
    );
  }

  const { error: uploadError } = await supabase.storage
    .from(COURSE_BOOKLET_BUCKET)
    .upload(COURSE_BOOKLET_STORAGE_PATH, buffer, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (uploadError) {
    return NextResponse.json(
      { success: false, error: "העלאת הקובץ לאחסון נכשלה" },
      { status: 502 }
    );
  }

  await prisma.courseBooklet.upsert({
    where: { id: 1 },
    update: {
      fileName: file.name,
      storagePath: COURSE_BOOKLET_STORAGE_PATH,
      uploadedAt: new Date(),
      uploadedBy: email,
    },
    create: {
      id: 1,
      fileName: file.name,
      storagePath: COURSE_BOOKLET_STORAGE_PATH,
      uploadedBy: email,
    },
  });

  revalidatePath("/admin/course-booklet");
  revalidatePath("/student");
  revalidatePath("/instructor");

  return NextResponse.json({ success: true });
}
