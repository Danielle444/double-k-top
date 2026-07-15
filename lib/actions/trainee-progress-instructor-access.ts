import { prisma } from "@/lib/prisma";
import type { Instructor } from "@/app/generated/prisma/client";
import { canAccessTraineeProgress } from "@/lib/trainee-progress-permissions";

// Server-only helper (deliberately NOT "use server" - this must never become
// a directly callable server action itself, only ever imported by the
// "use server" action files below). Re-fetches the instructor fresh from the
// DB on every call and never trusts a client-supplied permission flag - same
// discipline as every other requireInstructorWith*Permission helper in this
// app (see student-riding-progress-feedback-instructor.ts's own comment).
//
// Shared (not duplicated per-file) because it backs every new "view the full
// trainee-progress detail page" read action added for this feature
// (general notes, riding/lunge/presentation progress "view all rows", the
// Teaching Practice feedback history read) - all of them gate on the exact
// same OR-permission, unlike the pre-existing per-topic instructor actions
// (which each gate on one specific permission for their own topic's writes).
export async function requireInstructorWithTraineeProgressAccess(
  instructorId: string
): Promise<Instructor | null> {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  if (!instructor || !instructor.isActive || !canAccessTraineeProgress(instructor)) {
    return null;
  }
  return instructor;
}
