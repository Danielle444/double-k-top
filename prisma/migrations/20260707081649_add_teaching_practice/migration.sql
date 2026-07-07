-- CreateEnum
CREATE TYPE "TeachingPracticeType" AS ENUM ('LUNGE', 'BEGINNER_PRIVATE', 'BEGINNER_GROUP');

-- CreateEnum
CREATE TYPE "TeachingPracticeRole" AS ENUM ('LEAD_INSTRUCTOR', 'SECOND_INSTRUCTOR', 'ASSISTANT_INSTRUCTOR', 'EVALUATOR');

-- AlterTable
ALTER TABLE "instructors" ADD COLUMN     "canEditTeachingPracticeFeedback" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "canManageTeachingPracticeAssignments" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "canManageTeachingPracticeHorses" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "teaching_practice_tracks" (
    "id" TEXT NOT NULL,
    "practiceType" "TeachingPracticeType" NOT NULL,
    "groupName" TEXT,
    "weekday" INTEGER,
    "defaultStartTime" TEXT NOT NULL,
    "defaultEndTime" TEXT NOT NULL,
    "defaultLocation" TEXT,
    "defaultResponsibleInstructorId" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teaching_practice_tracks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teaching_practice_track_trainees" (
    "id" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "traineeId" TEXT NOT NULL,
    "rotationOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teaching_practice_track_trainees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teaching_practice_track_children" (
    "id" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "horseName" TEXT,
    "equipmentNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teaching_practice_track_children_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teaching_practice_lessons" (
    "id" TEXT NOT NULL,
    "trackId" TEXT,
    "practiceType" "TeachingPracticeType" NOT NULL,
    "date" DATE NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "groupName" TEXT,
    "location" TEXT,
    "responsibleInstructorId" TEXT,
    "notes" TEXT,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teaching_practice_lessons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teaching_practice_participants" (
    "id" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "traineeId" TEXT NOT NULL,
    "role" "TeachingPracticeRole" NOT NULL,
    "isManualOverride" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teaching_practice_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teaching_practice_children" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "age" INTEGER,
    "gender" TEXT,
    "parentName" TEXT,
    "parentPhone" TEXT,
    "notes" TEXT,
    "defaultHorseName" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teaching_practice_children_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teaching_practice_child_assignments" (
    "id" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "horseName" TEXT,
    "equipmentNotes" TEXT,
    "isAbsent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teaching_practice_child_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teaching_practice_feedback" (
    "id" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "feedback" TEXT,
    "ratingHalfPoints" INTEGER,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teaching_practice_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "teaching_practice_track_trainees_trackId_traineeId_key" ON "teaching_practice_track_trainees"("trackId", "traineeId");

-- CreateIndex
CREATE UNIQUE INDEX "teaching_practice_track_trainees_trackId_rotationOrder_key" ON "teaching_practice_track_trainees"("trackId", "rotationOrder");

-- CreateIndex
CREATE UNIQUE INDEX "teaching_practice_track_children_trackId_childId_key" ON "teaching_practice_track_children"("trackId", "childId");

-- CreateIndex
CREATE INDEX "teaching_practice_lessons_date_idx" ON "teaching_practice_lessons"("date");

-- CreateIndex
CREATE UNIQUE INDEX "teaching_practice_participants_lessonId_traineeId_key" ON "teaching_practice_participants"("lessonId", "traineeId");

-- CreateIndex
CREATE UNIQUE INDEX "teaching_practice_child_assignments_lessonId_childId_key" ON "teaching_practice_child_assignments"("lessonId", "childId");

-- CreateIndex
CREATE UNIQUE INDEX "teaching_practice_feedback_participantId_key" ON "teaching_practice_feedback"("participantId");

-- AddForeignKey
ALTER TABLE "teaching_practice_tracks" ADD CONSTRAINT "teaching_practice_tracks_defaultResponsibleInstructorId_fkey" FOREIGN KEY ("defaultResponsibleInstructorId") REFERENCES "instructors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teaching_practice_track_trainees" ADD CONSTRAINT "teaching_practice_track_trainees_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "teaching_practice_tracks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teaching_practice_track_trainees" ADD CONSTRAINT "teaching_practice_track_trainees_traineeId_fkey" FOREIGN KEY ("traineeId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teaching_practice_track_children" ADD CONSTRAINT "teaching_practice_track_children_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "teaching_practice_tracks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teaching_practice_track_children" ADD CONSTRAINT "teaching_practice_track_children_childId_fkey" FOREIGN KEY ("childId") REFERENCES "teaching_practice_children"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teaching_practice_lessons" ADD CONSTRAINT "teaching_practice_lessons_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "teaching_practice_tracks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teaching_practice_lessons" ADD CONSTRAINT "teaching_practice_lessons_responsibleInstructorId_fkey" FOREIGN KEY ("responsibleInstructorId") REFERENCES "instructors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teaching_practice_participants" ADD CONSTRAINT "teaching_practice_participants_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "teaching_practice_lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teaching_practice_participants" ADD CONSTRAINT "teaching_practice_participants_traineeId_fkey" FOREIGN KEY ("traineeId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teaching_practice_child_assignments" ADD CONSTRAINT "teaching_practice_child_assignments_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "teaching_practice_lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teaching_practice_child_assignments" ADD CONSTRAINT "teaching_practice_child_assignments_childId_fkey" FOREIGN KEY ("childId") REFERENCES "teaching_practice_children"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teaching_practice_feedback" ADD CONSTRAINT "teaching_practice_feedback_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "teaching_practice_participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
