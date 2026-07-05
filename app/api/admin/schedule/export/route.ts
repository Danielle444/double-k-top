import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { prisma } from "@/lib/prisma";
import { dateKey, formatHebrewDate, parseDateKey } from "@/lib/dates";
import { buildScheduleDayExport, buildScheduleGridExport } from "@/lib/exports/schedule-export";
import {
  buildScheduleDayWorkbook,
  buildScheduleGridWorkbook,
} from "@/lib/exports/build-schedule-workbook";

const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

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

    const title = `תורנויות יום ${formatHebrewDate(parseDateKey(dateParam))}`;
    const data = await buildScheduleDayExport(dateParam, title);
    const buffer = await buildScheduleDayWorkbook(data);

    return new NextResponse(buffer as BodyInit, {
      headers: {
        "Content-Type": XLSX_CONTENT_TYPE,
        "Content-Disposition": `attachment; filename="toranuyot-${dateParam}.xlsx"`,
      },
    });
  }

  let startDate: Date;
  let endDate: Date;
  let title: string;

  const weeklyScheduleId = url.searchParams.get("weeklyScheduleId");
  if (weeklyScheduleId) {
    const week = await prisma.weeklySchedule.findUnique({ where: { id: weeklyScheduleId } });
    if (!week) {
      return NextResponse.json({ error: "השבוע לא נמצא" }, { status: 404 });
    }
    startDate = week.startDate;
    endDate = week.endDate;
    title = `${week.name} · ${formatHebrewDate(week.startDate)} - ${formatHebrewDate(week.endDate)}`;
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
  }

  const data = await buildScheduleGridExport(startDate, endDate, title);
  const buffer = await buildScheduleGridWorkbook(data);

  return new NextResponse(buffer as BodyInit, {
    headers: {
      "Content-Type": XLSX_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="shibutz-${dateKey(startDate)}-${dateKey(endDate)}.xlsx"`,
    },
  });
}
