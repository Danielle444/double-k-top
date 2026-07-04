-- CreateEnum
CREATE TYPE "CourseSlot" AS ENUM ('FIRST_MORNING', 'SECOND_MORNING', 'FIRST_AFTER_LUNCH', 'SECOND_AFTER_LUNCH');

-- DropIndex
DROP INDEX "students_accessCode_key";

-- AlterTable
ALTER TABLE "duty_assignments" ADD COLUMN     "isPublished" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "students" DROP COLUMN "accessCode",
ADD COLUMN     "firstName" TEXT NOT NULL,
ADD COLUMN     "groupName" TEXT,
ADD COLUMN     "identityNumber" TEXT NOT NULL,
ADD COLUMN     "lastName" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "availability_range_presets" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "availability_range_presets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_day_plans" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "firstMorningGroup" TEXT,
    "secondMorningGroup" TEXT,
    "firstAfterLunchGroup" TEXT,
    "secondAfterLunchGroup" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_day_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "duty_constraints" (
    "id" TEXT NOT NULL,
    "dutyTypeId" TEXT NOT NULL,
    "slot" "CourseSlot" NOT NULL,
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "duty_constraints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_emails" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_emails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weekly_schedules" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "uploadedFileName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "weekly_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_items" (
    "id" TEXT NOT NULL,
    "weeklyScheduleId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "groupName" TEXT,
    "instructorName" TEXT,
    "location" TEXT,
    "rawText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "schedule_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "course_day_plans_date_key" ON "course_day_plans"("date");

-- CreateIndex
CREATE INDEX "duty_constraints_dutyTypeId_idx" ON "duty_constraints"("dutyTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "admin_emails_email_key" ON "admin_emails"("email");

-- CreateIndex
CREATE INDEX "weekly_schedules_startDate_endDate_idx" ON "weekly_schedules"("startDate", "endDate");

-- CreateIndex
CREATE INDEX "schedule_items_date_idx" ON "schedule_items"("date");

-- CreateIndex
CREATE UNIQUE INDEX "students_identityNumber_key" ON "students"("identityNumber");

-- AddForeignKey
ALTER TABLE "duty_constraints" ADD CONSTRAINT "duty_constraints_dutyTypeId_fkey" FOREIGN KEY ("dutyTypeId") REFERENCES "duty_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_items" ADD CONSTRAINT "schedule_items_weeklyScheduleId_fkey" FOREIGN KEY ("weeklyScheduleId") REFERENCES "weekly_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

