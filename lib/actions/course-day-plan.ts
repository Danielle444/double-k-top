"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { parseDateKey } from "@/lib/dates";
import type { ActionResult } from "@/lib/actions/students";

export interface DayPlanSlots {
  firstMorningGroup: string | null;
  secondMorningGroup: string | null;
  firstAfterLunchGroup: string | null;
  secondAfterLunchGroup: string | null;
}

export async function setCourseDayPlan(
  dateKeyStr: string,
  slots: DayPlanSlots
): Promise<ActionResult> {
  const date = parseDateKey(dateKeyStr);
  await prisma.courseDayPlan.upsert({
    where: { date },
    update: slots,
    create: { date, ...slots },
  });

  revalidatePath("/admin/day-plan");
  revalidatePath("/admin/weekly-schedule");
  return { success: true };
}
