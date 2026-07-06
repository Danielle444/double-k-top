-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('ATTENDANCE_MARKED', 'MATERIAL_ADDED');

-- CreateEnum
CREATE TYPE "NotificationRecipientRole" AS ENUM ('STUDENT', 'INSTRUCTOR');

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "recipientRole" "NotificationRecipientRole" NOT NULL,
    "studentId" TEXT,
    "instructorId" TEXT,
    "relatedId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_studentId_idx" ON "notifications"("studentId");

-- CreateIndex
CREATE INDEX "notifications_instructorId_idx" ON "notifications"("instructorId");
