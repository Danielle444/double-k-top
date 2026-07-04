import { prisma } from "@/lib/prisma";
import { dateKey, enumerateDateKeys, parseDateKey } from "@/lib/dates";

// Marks students available inside [availableStart, availableEnd] and
// unavailable everywhere else within the course range. Used for both the
// standalone "apply preset to students" action and the student-import flow's
// "specific range"/"preset" availability choice. The "whole course" choice
// never calls this - no rows are needed since students default to available.
export async function applyDateRangeAvailability(
  studentIds: string[],
  courseStart: Date,
  courseEnd: Date,
  availableStart: Date,
  availableEnd: Date
): Promise<void> {
  if (studentIds.length === 0) return;

  const courseDateKeys = enumerateDateKeys(courseStart, courseEnd);
  const availableStartKey = dateKey(availableStart);
  const availableEndKey = dateKey(availableEnd);

  const operations = [];
  for (const studentId of studentIds) {
    for (const dk of courseDateKeys) {
      const isAvailable = dk >= availableStartKey && dk <= availableEndKey;
      const date = parseDateKey(dk);
      operations.push(
        prisma.studentAvailability.upsert({
          where: { studentId_date: { studentId, date } },
          update: { isAvailable },
          create: { studentId, date, isAvailable },
        })
      );
    }
  }

  await prisma.$transaction(operations);
}
