"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { resolveCurrentCourseOffering } from "@/lib/course/current-offering";
import {
  createTraineeWithEnrollmentSafe,
  isKnownCurrentOfferingError,
  runTraineeCreateInTx,
} from "@/lib/course/create-trainee-enrollment-core";
import { israelDateKeyFromInstant } from "@/lib/trainee-history/israel-date";
import {
  writeTraineeGroupChange,
  type GroupChangeErrorCode,
} from "@/lib/trainee-history/group-change-service";
import {
  isStagedTraineeActivationBlocked,
  STAGED_TRAINEE_ACTIVATION_BLOCKED_MESSAGE,
  type ActivationEnrollmentInput,
} from "@/lib/course/staged-trainee-activation-core";

// Single safe, generic message for ANY known current-offering structural
// failure (no offering / ambiguous / incomplete). Deliberately reveals no
// offering count, id, dates, class name, or Prisma detail - the manager is told
// only that trainee creation is unavailable and to contact system management.
const CURRENT_OFFERING_UNAVAILABLE_MESSAGE =
  "לא ניתן להוסיף חניך/ה כעת עקב בעיה בהגדרת הקורס הנוכחי. יש לפנות לניהול המערכת";

// G2: the stable, non-PII failure for an UNEXPECTED staged-trainee activation
// guard read failure. It follows the existing "לא בוצעו שינויים" convention and
// is deliberately DISTINCT from STAGED_TRAINEE_ACTIVATION_BLOCKED_MESSAGE: that
// message states a verified Rule C block ("course in preparation"), which would
// be a lie when the guard simply could not read. It reveals no id, no offering
// detail, and no Prisma error text.
const ACTIVATION_GUARD_UNAVAILABLE_MESSAGE =
  "לא ניתן לבדוק כעת את מצב הרישום לקורס. החשבון לא הופעל ולא בוצעו שינויים";

const studentSchema = z.object({
  firstName: z.string().trim().min(1, "יש להזין שם פרטי"),
  lastName: z.string().trim().min(1, "יש להזין שם משפחה"),
  identityNumber: z
    .string()
    .trim()
    .regex(/^\d{5,9}$/, "מספר תעודת זהות לא תקין"),
  groupName: z.string().trim().optional(),
  subgroupNumber: z.coerce.number().int().positive().optional(),
  phone: z.string().trim().optional(),
});

// W6D3: editing an EXISTING trainee no longer edits group/subgroup. The
// authoritative group is the enrollment-scoped GroupMembership, changed ONLY via
// changeTraineeGroup below; the Student.groupName/subgroupNumber mirrors are
// written there. This edit schema deliberately OMITS the two group fields, so
// updateStudent is structurally incapable of writing them (even if a stale
// client still POSTs them). Creation still uses studentSchema (with the group
// fields) and its own atomic flow.
const studentEditSchema = studentSchema.omit({ groupName: true, subgroupNumber: true });

// W6D3 group-change safe, ID-free Hebrew messages. The action maps every
// service error code onto one of these; no id, identity number, or Prisma
// detail is ever surfaced.
const GROUP_CHANGE_MESSAGES = {
  notFound: "החניך/ה לא נמצא/ה בקורס הנוכחי",
  inactive: "החניך/ה אינו/ה פעיל/ה בקורס הנוכחי",
  invalidGroup: "הקבוצה שנבחרה אינה תקינה",
  failed: "שינוי הקבוצה נכשל. לא בוצעו שינויים",
} as const;

function mapGroupChangeError(code: GroupChangeErrorCode): string {
  switch (code) {
    case "TRAINEE_NOT_FOUND":
    case "ENROLLMENT_NOT_FOUND":
      return GROUP_CHANGE_MESSAGES.notFound;
    case "TRAINEE_INACTIVE":
    case "ENROLLMENT_INACTIVE":
      return GROUP_CHANGE_MESSAGES.inactive;
    case "INVALID_TARGET_GROUP":
      return GROUP_CHANGE_MESSAGES.invalidGroup;
    case "MEMBERSHIP_STATE_INVALID":
    case "INVARIANT_FAILURE":
    case "TRANSACTION_FAILURE":
      return GROUP_CHANGE_MESSAGES.failed;
  }
}

export interface ActionResult {
  success: boolean;
  error?: string;
}

function fullNameOf(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.trim();
}

export async function createStudent(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const parsed = studentSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    identityNumber: formData.get("identityNumber"),
    groupName: formData.get("groupName") || undefined,
    subgroupNumber: formData.get("subgroupNumber") || undefined,
    phone: formData.get("phone") || undefined,
  });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "קלט לא תקין" };
  }

  // MULTI-COURSE W6B: a new trainee is created atomically as Student + ACTIVE
  // isPrimary CourseEnrollment in the SERVER-DERIVED current offering + initial
  // subgroup GroupMembership, with the Student compatibility fields kept in
  // sync. The offering is never client-supplied; the testable orchestration and
  // the transaction body live in the non-"use server" core module. All group/
  // offering/duplicate failures return before any write (all-or-nothing).
  const result = await createTraineeWithEnrollmentSafe(
    {
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      identityNumber: parsed.data.identityNumber,
      phone: parsed.data.phone ?? null,
      groupName: parsed.data.groupName ?? null,
      subgroupNumber: parsed.data.subgroupNumber ?? null,
    },
    {
      resolveCurrentCourseOffering: async () => {
        const offering = await resolveCurrentCourseOffering();
        return { id: offering.id, startDate: offering.startDate };
      },
      now: () => new Date(),
      identityNumberExists: async (identityNumber) =>
        (await prisma.student.findUnique({
          where: { identityNumber },
          select: { id: true },
        })) !== null,
      findTopGroupId: async (courseOfferingId, name) =>
        (
          await prisma.courseGroup.findFirst({
            where: { courseOfferingId, parentGroupId: null, name },
            select: { id: true },
          })
        )?.id ?? null,
      findSubGroupId: async (parentGroupId, name) =>
        (
          await prisma.courseGroup.findFirst({
            where: { parentGroupId, name },
            select: { id: true },
          })
        )?.id ?? null,
      createAtomically: (plan) =>
        prisma.$transaction((tx) => runTraineeCreateInTx(tx, plan)),
    },
    CURRENT_OFFERING_UNAVAILABLE_MESSAGE,
  );

  if (!result.success) {
    return result;
  }

  revalidatePath("/admin/students");
  revalidatePath("/admin");
  return { success: true };
}

export async function updateStudent(
  studentId: string,
  formData: FormData
): Promise<ActionResult> {
  await requireAdmin();
  // W6D3: group/subgroup are intentionally NOT parsed or written here — see
  // studentEditSchema. The authoritative group lives in GroupMembership and is
  // changed only via changeTraineeGroup.
  const parsed = studentEditSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    identityNumber: formData.get("identityNumber"),
    phone: formData.get("phone") || undefined,
  });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "קלט לא תקין" };
  }

  const conflict = await prisma.student.findUnique({
    where: { identityNumber: parsed.data.identityNumber },
  });
  if (conflict && conflict.id !== studentId) {
    return { success: false, error: "כבר קיים/ת חניך/ה עם מספר תעודת זהות זה" };
  }

  await prisma.student.update({
    where: { id: studentId },
    data: {
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      fullName: fullNameOf(parsed.data.firstName, parsed.data.lastName),
      identityNumber: parsed.data.identityNumber,
      phone: parsed.data.phone || null,
    },
  });

  revalidatePath("/admin/students");
  return { success: true };
}

/**
 * W6D3: move an existing trainee to a different LEAF group within the CURRENT
 * offering, effective Israel-local today. Admin-only. The offering is resolved
 * SERVER-SIDE (never client-supplied), and the effective date is a single
 * trusted server "now" (no future, no backdating). The enrollment-scoped
 * GroupMembership is the authority; the Student mirror is updated inside the
 * service's transaction. Every service failure maps to a safe Hebrew message.
 */
export async function changeTraineeGroup(
  studentId: string,
  targetCourseGroupId: string,
): Promise<ActionResult> {
  await requireAdmin();

  let courseOfferingId: string;
  try {
    const offering = await resolveCurrentCourseOffering();
    courseOfferingId = offering.id;
  } catch (err) {
    if (isKnownCurrentOfferingError(err)) {
      return { success: false, error: CURRENT_OFFERING_UNAVAILABLE_MESSAGE };
    }
    throw err;
  }

  const effectiveFrom = israelDateKeyFromInstant(new Date());
  const outcome = await writeTraineeGroupChange({
    studentId,
    courseOfferingId,
    targetCourseGroupId,
    effectiveFrom,
  });
  if (!outcome.ok) {
    return { success: false, error: mapGroupChangeError(outcome.code) };
  }

  revalidatePath("/admin/students");
  revalidatePath("/admin");
  return { success: true };
}

/**
 * G2: the AUTHORITATIVE staged-trainee activation guard. This action is the only
 * place that flips Student.isActive from the general admin trainee screen, so it -
 * not the UI - is what must hold the line: a direct server-action invocation from
 * a stale client, a replayed request, or devtools reaches exactly this code path.
 *
 * The guard is deliberately ASYMMETRIC. Turning a trainee ON is the dangerous
 * direction (it drops them into every isActive-filtered operational reader at once
 * and lets them log in), so it is classified by the committed pure Rule C core.
 * Turning a trainee OFF is always safe and must never be blocked, so the
 * deactivation path performs NO enrollment read and NO classification at all -
 * containment stays available even if the guard read would fail.
 */
export async function setStudentActive(
  studentId: string,
  isActive: boolean
): Promise<ActionResult> {
  await requireAdmin();

  if (isActive === true) {
    // Rule C reads EXACTLY the two lifecycle statuses of this one student's
    // enrollments - no id, no name, no level, no dates, no group mirror - so the
    // core physically cannot be fed anything outside the approved rule.
    let enrollments: ActivationEnrollmentInput[];
    try {
      const rows = await prisma.courseEnrollment.findMany({
        where: { studentId },
        select: {
          status: true,
          courseOffering: {
            select: {
              status: true,
            },
          },
        },
      });
      enrollments = rows.map((row) => ({
        status: row.status,
        offeringStatus: row.courseOffering.status,
      }));
    } catch {
      // FAIL CLOSED: an unreadable affiliation picture must never fall through to
      // the update. The Prisma error itself is swallowed (no driver text, no id,
      // no PII) and the manager gets one stable "nothing was changed" message,
      // deliberately NOT the Rule C message - this is not a verified block.
      return { success: false, error: ACTIVATION_GUARD_UNAVAILABLE_MESSAGE };
    }

    // The transition under consideration is activation of a currently-inactive
    // account; the current state is never taken from the client.
    if (isStagedTraineeActivationBlocked(false, enrollments)) {
      return { success: false, error: STAGED_TRAINEE_ACTIVATION_BLOCKED_MESSAGE };
    }
  }

  await prisma.student.update({ where: { id: studentId }, data: { isActive } });
  revalidatePath("/admin/students");
  revalidatePath("/admin");
  return { success: true };
}
