"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import type { ActionResult } from "@/lib/actions/students";

const messageTaskTypeSchema = z.enum(["MESSAGE", "TASK"]);
const messageAudienceSchema = z.enum(["ALL", "GROUP", "SPECIFIC"]);

export type MessageTaskTypeValue = z.infer<typeof messageTaskTypeSchema>;
export type MessageAudienceValue = z.infer<typeof messageAudienceSchema>;

const createSchema = z.object({
  type: messageTaskTypeSchema,
  title: z.string().trim().min(1, "יש להזין כותרת"),
  body: z.string().trim().min(1, "יש להזין תוכן"),
  audience: messageAudienceSchema,
  groupName: z.string().trim().optional(),
  studentIds: z.array(z.string()).optional(),
});

export interface CreateMessageTaskInput {
  type: MessageTaskTypeValue;
  title: string;
  body: string;
  audience: MessageAudienceValue;
  groupName?: string;
  studentIds?: string[];
}

// Recipients are resolved once here and materialized into MessageTaskRecipient
// rows - later group/roster changes never retroactively change who this was
// sent to.
export async function createMessageTask(input: CreateMessageTaskInput): Promise<ActionResult> {
  const admin = await requireAdmin();

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "קלט לא תקין" };
  }
  const data = parsed.data;

  let recipientIds: string[];
  if (data.audience === "ALL") {
    const students = await prisma.student.findMany({
      where: { isActive: true },
      select: { id: true },
    });
    recipientIds = students.map((s) => s.id);
  } else if (data.audience === "GROUP") {
    if (!data.groupName) {
      return { success: false, error: "יש לבחור קבוצה" };
    }
    const students = await prisma.student.findMany({
      where: { isActive: true, groupName: data.groupName },
      select: { id: true },
    });
    recipientIds = students.map((s) => s.id);
  } else {
    const ids = data.studentIds ?? [];
    if (ids.length === 0) {
      return { success: false, error: "יש לבחור לפחות תלמיד/ה אחד/ת" };
    }
    const students = await prisma.student.findMany({
      where: { isActive: true, id: { in: ids } },
      select: { id: true },
    });
    recipientIds = students.map((s) => s.id);
  }

  if (recipientIds.length === 0) {
    return { success: false, error: "לא נמצאו נמענים מתאימים" };
  }

  await prisma.messageTask.create({
    data: {
      type: data.type,
      title: data.title,
      body: data.body,
      audience: data.audience,
      groupName: data.audience === "GROUP" ? data.groupName : null,
      createdByName: admin.name ?? admin.email,
      recipients: {
        create: recipientIds.map((studentId) => ({ studentId })),
      },
    },
  });

  revalidatePath("/admin/messages");
  return { success: true };
}

export interface MessageTaskListItem {
  id: string;
  type: MessageTaskTypeValue;
  title: string;
  body: string;
  audience: MessageAudienceValue;
  groupName: string | null;
  createdByName: string | null;
  createdAt: string;
  totalCount: number;
  readCount: number;
  completedCount: number;
}

export async function listMessageTasksForAdmin(): Promise<MessageTaskListItem[]> {
  await requireAdmin();

  const items = await prisma.messageTask.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      recipients: { select: { readAt: true, completedAt: true } },
    },
  });

  return items.map((item) => ({
    id: item.id,
    type: item.type,
    title: item.title,
    body: item.body,
    audience: item.audience,
    groupName: item.groupName,
    createdByName: item.createdByName,
    createdAt: item.createdAt.toISOString(),
    totalCount: item.recipients.length,
    readCount: item.recipients.filter((r) => r.readAt !== null).length,
    completedCount: item.recipients.filter((r) => r.completedAt !== null).length,
  }));
}

export interface MessageTaskRecipientRow {
  id: string;
  studentId: string;
  studentFullName: string;
  readAt: string | null;
  completedAt: string | null;
}

export async function getMessageTaskRecipients(
  messageTaskId: string
): Promise<MessageTaskRecipientRow[]> {
  await requireAdmin();

  const recipients = await prisma.messageTaskRecipient.findMany({
    where: { messageTaskId },
    include: { student: { select: { fullName: true } } },
    orderBy: { student: { fullName: "asc" } },
  });

  return recipients.map((r) => ({
    id: r.id,
    studentId: r.studentId,
    studentFullName: r.student.fullName,
    readAt: r.readAt ? r.readAt.toISOString() : null,
    completedAt: r.completedAt ? r.completedAt.toISOString() : null,
  }));
}

export interface StudentMessageItem {
  recipientId: string;
  messageTaskId: string;
  type: MessageTaskTypeValue;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
  completedAt: string | null;
}

// Read-only, no permission gate - same convention as getStudentProfile /
// getHorseAssignments, since students have no NextAuth session in this app.
export async function getStudentMessages(studentId: string): Promise<StudentMessageItem[]> {
  const recipients = await prisma.messageTaskRecipient.findMany({
    where: { studentId },
    include: { messageTask: true },
    orderBy: { createdAt: "desc" },
  });

  return recipients.map((r) => ({
    recipientId: r.id,
    messageTaskId: r.messageTaskId,
    type: r.messageTask.type,
    title: r.messageTask.title,
    body: r.messageTask.body,
    createdAt: r.messageTask.createdAt.toISOString(),
    readAt: r.readAt ? r.readAt.toISOString() : null,
    completedAt: r.completedAt ? r.completedAt.toISOString() : null,
  }));
}

// Students have no NextAuth session in this app (see requireAdmin), so
// ownership is verified by re-reading the recipient row and comparing
// studentId - the same convention already established by markDutyCompleted.
export async function markMessageRead(
  recipientId: string,
  studentId: string
): Promise<ActionResult> {
  const recipient = await prisma.messageTaskRecipient.findUnique({ where: { id: recipientId } });
  if (!recipient || recipient.studentId !== studentId) {
    return { success: false, error: "ההודעה לא נמצאה" };
  }
  if (recipient.readAt) {
    return { success: true };
  }

  await prisma.messageTaskRecipient.update({
    where: { id: recipientId },
    data: { readAt: new Date() },
  });

  revalidatePath("/admin/messages");
  return { success: true };
}

export async function setTaskCompleted(
  recipientId: string,
  studentId: string,
  isCompleted: boolean
): Promise<ActionResult> {
  const recipient = await prisma.messageTaskRecipient.findUnique({ where: { id: recipientId } });
  if (!recipient || recipient.studentId !== studentId) {
    return { success: false, error: "המשימה לא נמצאה" };
  }

  await prisma.messageTaskRecipient.update({
    where: { id: recipientId },
    data: { completedAt: isCompleted ? new Date() : null },
  });

  revalidatePath("/admin/messages");
  return { success: true };
}
