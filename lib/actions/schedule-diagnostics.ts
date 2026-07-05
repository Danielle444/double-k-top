"use server";

import { parseDateKey } from "@/lib/dates";
import { buildScheduleDiagnostics, type ScheduleDiagnostics } from "@/lib/schedule-diagnostics";

export async function getScheduleDiagnostics(
  startDateKey: string,
  endDateKey: string
): Promise<ScheduleDiagnostics> {
  return buildScheduleDiagnostics(parseDateKey(startDateKey), parseDateKey(endDateKey));
}
