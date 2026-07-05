"use server";

import { parseDateKey } from "@/lib/dates";
import { buildFairnessReport } from "@/lib/schedule-fairness";
import type { FairnessWarning } from "@/lib/schedule-fairness";
import { computeFairnessWarnings } from "@/lib/schedule-fairness";

export async function getFairnessWarnings(
  startDateKey: string,
  endDateKey: string
): Promise<FairnessWarning[]> {
  const report = await buildFairnessReport(parseDateKey(startDateKey), parseDateKey(endDateKey));
  return computeFairnessWarnings(report);
}
