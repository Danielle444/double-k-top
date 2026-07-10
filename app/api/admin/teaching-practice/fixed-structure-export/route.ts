import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { listTeachingPracticeTracksForAdmin } from "@/lib/actions/teaching-practice";
import { buildTeachingPracticeFixedStructureWorkbook } from "@/lib/exports/build-teaching-practice-fixed-structure-workbook";

const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// Strips characters that are invalid in file names on Windows/macOS/Linux -
// same helper duplicated in every other export route in this app (e.g.
// app/api/admin/teaching-practice/export/route.ts).
function sanitizeFileNamePart(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, "-").trim().replace(/\s+/g, " ");
}

function buildContentDisposition(filename: string): string {
  return `attachment; filename="export.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

// Triggered by a normal link click from an already-authenticated admin page
// (see the export link in TeachingPracticeManager.tsx) - same
// redirect-on-failure requireAdmin() every admin page/export route already
// uses. Read-only: only lists tracks (fixed structure), never touches
// TeachingPracticeLesson/Participant/ChildAssignment/Feedback, and never
// writes/revalidates anything. No query params - always both groups, one
// file, two sheets.
export async function GET() {
  await requireAdmin();

  const tracks = await listTeachingPracticeTracksForAdmin();
  const buffer = await buildTeachingPracticeFixedStructureWorkbook(tracks);
  const filename = `${sanitizeFileNamePart("מבנה קבוע - התנסויות מתחילים")}.xlsx`;

  return new NextResponse(buffer as BodyInit, {
    headers: {
      "Content-Type": XLSX_CONTENT_TYPE,
      "Content-Disposition": buildContentDisposition(filename),
    },
  });
}
