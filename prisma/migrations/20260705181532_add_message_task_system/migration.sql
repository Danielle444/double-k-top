-- CreateEnum
CREATE TYPE "MessageTaskType" AS ENUM ('MESSAGE', 'TASK');

-- CreateEnum
CREATE TYPE "MessageAudience" AS ENUM ('ALL', 'GROUP', 'SPECIFIC');

-- CreateTable
CREATE TABLE "message_tasks" (
    "id" TEXT NOT NULL,
    "type" "MessageTaskType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "audience" "MessageAudience" NOT NULL,
    "groupName" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_task_recipients" (
    "id" TEXT NOT NULL,
    "messageTaskId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_task_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "message_task_recipients_studentId_idx" ON "message_task_recipients"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "message_task_recipients_messageTaskId_studentId_key" ON "message_task_recipients"("messageTaskId", "studentId");

-- AddForeignKey
ALTER TABLE "message_task_recipients" ADD CONSTRAINT "message_task_recipients_messageTaskId_fkey" FOREIGN KEY ("messageTaskId") REFERENCES "message_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_task_recipients" ADD CONSTRAINT "message_task_recipients_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;
