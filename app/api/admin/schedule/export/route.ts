import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { prisma } from "@/lib/prisma";
import { formatHebrewDate, parseDateKey } from "@/lib/dates";
import { buildScheduleDayExport, buildScheduleGridExport } from "@/lib/exports/schedule-export";
import {
  buildScheduleDayWorkbook,
  buildScheduleGridWorkbook,
} from "@/lib/exports/build-schedule-workbook";
import { buildScheduleDiagnostics } from "@/lib/schedule-diagnostics";

const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function formatDateForFilename(date: Date): string {
  const d = String(date.getUTCDate()).padStart(2, "0");
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const y = date.getUTCFullYear();
  return `${d}.${m}.${y}`;
}

// Strips characters that are invalid in file names on Windows/macOS/Linux,
// so an admin-entered week name or range label can never break the download.
function sanitizeFileNamePart(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, "-").trim().replace(/\s+/g, " ");
}

// A plain `filename="..."` value is technically ASCII-only per the HTTP
// spec, so Hebrew names need the RFC 5987/6266 `filename*=UTF-8''...` form
// too - every modern browser prefers that extended form when present, with
// the ASCII fallback only for the rare client that doesn't support it.
function buildContentDisposition(filename: string): string {
  return `attachment; filename="export.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

// Triggered by a normal link click/navigation from an already-authenticated
// admin page, so the same redirect-on-failure requireAdmin() used by every
// admin page applies here too (unlike the course-booklet upload route,
// which is called via fetch() and needs a JSON error instead of a redirect).
export async function GET(request: Request) {
  await requireAdmin();

  const url = new URL(request.url);
  const scope = url.searchParams.get("scope");

  if (scope === "day") {
    const dateParam = url.searchParams.get("date");
    if (!dateParam) {
      return NextResponse.json({ error: "חסר תאריך לייצוא" }, { status: 400 });
    }

    const date = parseDateKey(dateParam);
    const title = `תורנויות יום ${formatHebrewDate(date)}`;
    const data = await buildScheduleDayExport(dateParam, title);
    const buffer = await buildScheduleDayWorkbook(data);
    const filename = `${sanitizeFileNamePart(`שיבוץ תורנויות - ${formatDateForFilename(date)}`)}.xlsx`;

    return new NextResponse(buffer as BodyInit, {
      headers: {
        "Content-Type": XLSX_CONTENT_TYPE,
        "Content-Disposition": buildContentDisposition(filename),
      },
    });
  }

  let startDate: Date;
  let endDate: Date;
  let title: string;
  let filenameLabel: string;

  const weeklyScheduleId = url.searchParams.get("weeklyScheduleId");
  if (weeklyScheduleId) {
    const week = await prisma.weeklySchedule.findUnique({ where: { id: weeklyScheduleId } });
    if (!week) {
      return NextResponse.json({ error: "השבוע לא נמצא" }, { status: 404 });
    }
    startDate = week.startDate;
    endDate = week.endDate;
    title = `${week.name} · ${formatHebrewDate(week.startDate)} - ${formatHebrewDate(week.endDate)}`;
    filenameLabel = week.name;
  } else {
    const startParam = url.searchParams.get("startDate");
    const endParam = url.searchParams.get("endDate");
    if (!startParam || !endParam) {
      return NextResponse.json({ error: "חסר טווח תאריכים לייצוא" }, { status: 400 });
    }
    startDate = parseDateKey(startParam);
    endDate = parseDateKey(endParam);
    const customTitle = url.searchParams.get("title");
    const rangeLabel = `${formatHebrewDate(startDate)} - ${formatHebrewDate(endDate)}`;
    title = customTitle ? `${customTitle} · ${rangeLabel}` : rangeLabel;
    filenameLabel =
      customTitle ?? `${formatDateForFilename(startDate)}-${formatDateForFilename(endDate)}`;
  }

  const [data, diagnostics] = await Promise.all([
    buildScheduleGridExport(startDate, endDate, title),
    buildScheduleDiagnostics(startDate, endDate),
  ]);
  const buffer = await buildScheduleGridWorkbook(data, diagnostics);
  const filename = `${sanitizeFileNamePart(`שיבוץ תורנויות - ${filenameLabel}`)}.xlsx`;

  return new NextResponse(buffer as BodyInit, {
    headers: {
      "Content-Type": XLSX_CONTENT_TYPE,
      "Content-Disposition": buildContentDisposition(filename),
    },
  });
}
