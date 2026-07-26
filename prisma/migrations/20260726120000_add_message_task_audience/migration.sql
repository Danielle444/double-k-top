-- MSG0: additive course-scoped message/task audience layer.
--
-- ADDITIVE ONLY. Creates one enum type and one new table. It alters no existing
-- table, adds no column to message_tasks or message_task_recipients, and
-- contains NO insert, update, delete, drop, or backfill operation of any kind.
--
-- The new table is created EMPTY and nothing in the repository writes or reads
-- it in this slice (MSG0). Recipient materialization still runs entirely through
-- the unchanged MessageTaskRecipient layer. Populating message_task_audiences is
-- a later slice's job (MSG1/MSG2); until then the table is legitimately empty.
--
-- NOTE (shape): MessageAudienceSegmentKind has no ALL member BY DESIGN -
-- "everyone in a course" is one COURSE segment per targeted offering. The
-- per-kind column shape (COURSE -> offering only; GROUP -> +group; TRAINEE ->
-- +student) is enforced by the hand-written CHECK below, since schema.prisma has
-- no CHECK syntax.
--
-- NOTE (uniqueness): the discriminating columns are nullable and the unique key
-- differs per kind, so a plain composite UNIQUE cannot express "one segment per
-- kind per message" (PostgreSQL treats each NULL as distinct). The three
-- hand-written PARTIAL unique indexes below carry that invariant instead - same
-- pattern as course_groups_offering_top_level_name_unique.

-- CreateEnum
CREATE TYPE "MessageAudienceSegmentKind" AS ENUM ('COURSE', 'GROUP', 'TRAINEE');

-- CreateTable
CREATE TABLE "message_task_audiences" (
    "id" TEXT NOT NULL,
    "messageTaskId" TEXT NOT NULL,
    "kind" "MessageAudienceSegmentKind" NOT NULL,
    "courseOfferingId" TEXT NOT NULL,
    "courseGroupId" TEXT,
    "studentId" TEXT,
    "labelSnapshot" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_task_audiences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "message_task_audiences_messageTaskId_idx" ON "message_task_audiences"("messageTaskId");

-- CreateIndex
CREATE INDEX "message_task_audiences_courseOfferingId_idx" ON "message_task_audiences"("courseOfferingId");

-- CreateIndex
CREATE INDEX "message_task_audiences_courseGroupId_idx" ON "message_task_audiences"("courseGroupId");

-- CreateIndex
CREATE INDEX "message_task_audiences_studentId_idx" ON "message_task_audiences"("studentId");

-- CreateIndex
-- Hand-written PARTIAL unique indexes (MSG0). Prisma's schema.prisma has no
-- syntax for a WHERE-qualified/partial index, so these are authored directly in
-- SQL - same pattern as course_groups_offering_top_level_name_unique. Each
-- enforces "at most one segment of this kind per message"; scoping each index to
-- a single kind avoids the NULL-distinct hazard that a plain composite UNIQUE
-- over the nullable columns would suffer.
CREATE UNIQUE INDEX "message_task_audiences_course_unique" ON "message_task_audiences"("messageTaskId", "courseOfferingId") WHERE "kind" = 'COURSE';

-- CreateIndex
CREATE UNIQUE INDEX "message_task_audiences_group_unique" ON "message_task_audiences"("messageTaskId", "courseGroupId") WHERE "kind" = 'GROUP';

-- CreateIndex
CREATE UNIQUE INDEX "message_task_audiences_trainee_unique" ON "message_task_audiences"("messageTaskId", "studentId") WHERE "kind" = 'TRAINEE';

-- Hand-written CHECK (MSG0). Column shape per kind - Prisma has no CHECK syntax,
-- so this is authored directly in SQL. Guarantees COURSE carries neither group
-- nor student, GROUP carries a group and no student, TRAINEE carries a student
-- and no group. courseOfferingId is NOT NULL for every kind (table definition).
ALTER TABLE "message_task_audiences" ADD CONSTRAINT "message_task_audiences_kind_shape_check" CHECK (
  ("kind" = 'COURSE'  AND "courseGroupId" IS NULL     AND "studentId" IS NULL) OR
  ("kind" = 'GROUP'   AND "courseGroupId" IS NOT NULL AND "studentId" IS NULL) OR
  ("kind" = 'TRAINEE' AND "courseGroupId" IS NULL     AND "studentId" IS NOT NULL)
);

-- AddForeignKey
ALTER TABLE "message_task_audiences" ADD CONSTRAINT "message_task_audiences_messageTaskId_fkey" FOREIGN KEY ("messageTaskId") REFERENCES "message_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_task_audiences" ADD CONSTRAINT "message_task_audiences_courseOfferingId_fkey" FOREIGN KEY ("courseOfferingId") REFERENCES "course_offerings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_task_audiences" ADD CONSTRAINT "message_task_audiences_courseGroupId_fkey" FOREIGN KEY ("courseGroupId") REFERENCES "course_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_task_audiences" ADD CONSTRAINT "message_task_audiences_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
