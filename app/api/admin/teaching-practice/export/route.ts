import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { formatHebrewDate, parseDateKey } from "@/lib/dates";
import { listTeachingPracticeLessonsDetailForDateAsAdmin } from "@/lib/actions/teaching-practice";
import { buildTeachingPracticeDayWorkbook } from "@/lib/exports/build-teaching-practice-workbook";

const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function formatDateForFilename(date: Date): string {
  const d = String(date.getUTCDate()).padStart(2, "0");
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const y = date.getUTCFullYear();
  return `${d}.${m}.${y}`;
}

// Strips characters that are invalid in file names on Windows/macOS/Linux -
// same helper as app/api/admin/schedule/export/route.ts, duplicated rather
// than shared since it's three small lines and this route otherwise has no
// dependency on that one.
function sanitizeFileNamePart(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, "-").trim().replace(/\s+/g, " ");
}

// A plain `filename="..."` value is technically ASCII-only per the HTTP
// spec, so the Hebrew name needs the RFC 5987/6266 `filename*=UTF-8''...`
// form too - every modern browser prefers that extended form when present,
// with the ASCII fallback only for the rare client that doesn't support it.
function buildContentDisposition(filename: string): string {
  return `attachment; filename="export.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

// Triggered by a normal link click/navigation from an already-authenticated
// admin page (see the export link in TeachingPracticeManager.tsx), so the
// same redirect-on-failure requireAdmin() every admin page already uses
// applies here too - same pattern as app/api/admin/schedule/export/route.ts.
export async function GET(request: Request) {
  await requireAdmin();

  const url = new URL(request.url);
  const dateParam = url.searchParams.get("date");
  if (!dateParam) {
    return NextResponse.json({ error: "חסר תאריך לייצוא" }, { status: 400 });
  }

  const date = parseDateKey(dateParam);
  if (Number.isNaN(date.getTime())) {
    return NextResponse.json({ error: "תאריך לא תקין" }, { status: 400 });
  }

  const lessons = await listTeachingPracticeLessonsDetailForDateAsAdmin(dateParam);
  const title = `התנסויות מתחילים - ${formatHebrewDate(date)}`;
  const buffer = await buildTeachingPracticeDayWorkbook(lessons, title);
  const filename = `${sanitizeFileNamePart(`התנסויות מתחילים - ${formatDateForFilename(date)}`)}.xlsx`;

  return new NextResponse(buffer as BodyInit, {
    headers: {
      "Content-Type": XLSX_CONTENT_TYPE,
      "Content-Disposition": buildContentDisposition(filename),
    },
  });
}
