-- CreateEnum
CREATE TYPE "ExamKind" AS ENUM ('INTERFACE_RIDING', 'LUNGE_NO_RIDER', 'ADVANCED_INSTRUCTION', 'BEGINNER_INSTRUCTION');

-- CreateEnum
CREATE TYPE "ExamPhase" AS ENUM ('INTERFACE', 'RIDING');

-- CreateEnum
CREATE TYPE "ExamBeginnerFormat" AS ENUM ('LUNGE', 'BEGINNER_PRIVATE', 'BEGINNER_GROUP');

-- CreateEnum
CREATE TYPE "ExamAssignmentRole" AS ENUM ('EXAMINEE', 'INSTRUCTED_TRAINEE');

-- CreateTable
CREATE TABLE "exam_plans" (
    "id" TEXT NOT NULL,
    "courseOfferingId" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exam_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_sessions" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "kind" "ExamKind" NOT NULL,
    "phase" "ExamPhase",
    "beginnerFormat" "ExamBeginnerFormat",
    "date" DATE NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "arena" TEXT,
    "title" TEXT,
    "notes" TEXT,
    "capacity" INTEGER,
    "interfaceSessionId" TEXT,
    "sourceTeachingPracticeLessonId" TEXT,
    "copiedAt" TIMESTAMP(3),
    "roleLabelOverrides" JSONB,
    "individualPublishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exam_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_assignments" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "studentId" TEXT,
    "role" "ExamAssignmentRole" NOT NULL,
    "horseName" TEXT,
    "instructionTopic" TEXT,
    "pairingIndex" INTEGER,
    "sourcePracticeRole" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exam_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_beginner_children" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "age" INTEGER,
    "gender" TEXT,
    "notes" TEXT,
    "parentName" TEXT,
    "parentPhone" TEXT,
    "horseName" TEXT,
    "equipmentNotes" TEXT,
    "isAbsent" BOOLEAN NOT NULL DEFAULT false,
    "sourceChildId" TEXT,
    "sourceChildAssignmentId" TEXT,
    "orderIndex" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exam_beginner_children_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_session_supervisors" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "instructorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exam_session_supervisors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "exam_plans_courseOfferingId_key" ON "exam_plans"("courseOfferingId");

-- CreateIndex
CREATE INDEX "exam_sessions_planId_date_orderIndex_idx" ON "exam_sessions"("planId", "date", "orderIndex");

-- CreateIndex
CREATE INDEX "exam_sessions_planId_kind_date_orderIndex_idx" ON "exam_sessions"("planId", "kind", "date", "orderIndex");

-- CreateIndex
CREATE INDEX "exam_sessions_date_idx" ON "exam_sessions"("date");

-- CreateIndex
CREATE UNIQUE INDEX "exam_sessions_planId_sourceTeachingPracticeLessonId_key" ON "exam_sessions"("planId", "sourceTeachingPracticeLessonId");

-- CreateIndex
CREATE INDEX "exam_assignments_studentId_idx" ON "exam_assignments"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "exam_assignments_sessionId_studentId_key" ON "exam_assignments"("sessionId", "studentId");

-- CreateIndex
CREATE INDEX "exam_beginner_children_sessionId_idx" ON "exam_beginner_children"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "exam_beginner_children_sessionId_sourceChildAssignmentId_key" ON "exam_beginner_children"("sessionId", "sourceChildAssignmentId");

-- CreateIndex
CREATE INDEX "exam_session_supervisors_instructorId_idx" ON "exam_session_supervisors"("instructorId");

-- CreateIndex
CREATE UNIQUE INDEX "exam_session_supervisors_sessionId_instructorId_key" ON "exam_session_supervisors"("sessionId", "instructorId");

-- AddForeignKey
ALTER TABLE "exam_plans" ADD CONSTRAINT "exam_plans_courseOfferingId_fkey" FOREIGN KEY ("courseOfferingId") REFERENCES "course_offerings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_sessions" ADD CONSTRAINT "exam_sessions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "exam_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_sessions" ADD CONSTRAINT "exam_sessions_interfaceSessionId_fkey" FOREIGN KEY ("interfaceSessionId") REFERENCES "exam_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_sessions" ADD CONSTRAINT "exam_sessions_sourceTeachingPracticeLessonId_fkey" FOREIGN KEY ("sourceTeachingPracticeLessonId") REFERENCES "teaching_practice_lessons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_assignments" ADD CONSTRAINT "exam_assignments_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "exam_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_assignments" ADD CONSTRAINT "exam_assignments_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_beginner_children" ADD CONSTRAINT "exam_beginner_children_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "exam_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_beginner_children" ADD CONSTRAINT "exam_beginner_children_sourceChildId_fkey" FOREIGN KEY ("sourceChildId") REFERENCES "teaching_practice_children"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_session_supervisors" ADD CONSTRAINT "exam_session_supervisors_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "exam_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_session_supervisors" ADD CONSTRAINT "exam_session_supervisors_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "instructors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
