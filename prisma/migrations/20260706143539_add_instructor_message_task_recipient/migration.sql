-- CreateTable
CREATE TABLE "instructor_message_task_recipients" (
    "id" TEXT NOT NULL,
    "messageTaskId" TEXT NOT NULL,
    "instructorId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "instructor_message_task_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "instructor_message_task_recipients_instructorId_idx" ON "instructor_message_task_recipients"("instructorId");

-- CreateIndex
CREATE UNIQUE INDEX "instructor_message_task_recipients_messageTaskId_instructor_key" ON "instructor_message_task_recipients"("messageTaskId", "instructorId");

-- AddForeignKey
ALTER TABLE "instructor_message_task_recipients" ADD CONSTRAINT "instructor_message_task_recipients_messageTaskId_fkey" FOREIGN KEY ("messageTaskId") REFERENCES "message_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instructor_message_task_recipients" ADD CONSTRAINT "instructor_message_task_recipients_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "instructors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: give every currently-active instructor a recipient row for
-- every non-archived MessageTask that already existed before this
-- migration, so historical messages/tasks don't all appear as unread once
-- real per-instructor tracking goes live. This is a one-time, point-in-time
-- catch-up only - it does not create an ongoing rule. A brand-new
-- instructor added after this migration will NOT retroactively receive
-- recipient rows for old message history; they only start getting rows for
-- messages sent from that point on, via the app's normal fanout in
-- createMessageTaskInternal.
INSERT INTO "instructor_message_task_recipients" ("id", "messageTaskId", "instructorId", "createdAt")
SELECT gen_random_uuid()::text, mt."id", i."id", now()
FROM "message_tasks" mt
CROSS JOIN "instructors" i
WHERE mt."isArchived" = false
  AND i."isActive" = true
ON CONFLICT ("messageTaskId", "instructorId") DO NOTHING;
