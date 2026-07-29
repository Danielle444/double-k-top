-- AlterTable
ALTER TABLE "exam_sessions" ADD COLUMN     "definitionId" TEXT NOT NULL,
ALTER COLUMN "kind" DROP NOT NULL,
ALTER COLUMN "endTime" DROP NOT NULL;

-- AlterTable
ALTER TABLE "exam_assignments" ADD COLUMN     "discipline" TEXT,
ADD COLUMN     "orderIndex" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "exam_definitions" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ExamKind" NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "parallelCapacity" INTEGER NOT NULL,
    "requiresInstructedTrainee" BOOLEAN NOT NULL DEFAULT false,
    "requiresLessonTopic" BOOLEAN NOT NULL DEFAULT false,
    "requiresDiscipline" BOOLEAN NOT NULL DEFAULT false,
    "orderIndex" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exam_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_session_breaks" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "afterWaveIndex" INTEGER NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exam_session_breaks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "exam_definitions_planId_kind_idx" ON "exam_definitions"("planId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "exam_definitions_planId_name_key" ON "exam_definitions"("planId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "exam_definitions_planId_id_key" ON "exam_definitions"("planId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_session_breaks_sessionId_afterWaveIndex_key" ON "exam_session_breaks"("sessionId", "afterWaveIndex");

-- CreateIndex
CREATE INDEX "exam_sessions_planId_definitionId_date_orderIndex_idx" ON "exam_sessions"("planId", "definitionId", "date", "orderIndex");

-- CreateIndex
CREATE INDEX "exam_assignments_sessionId_orderIndex_idx" ON "exam_assignments"("sessionId", "orderIndex");

-- AddForeignKey
ALTER TABLE "exam_definitions" ADD CONSTRAINT "exam_definitions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "exam_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_session_breaks" ADD CONSTRAINT "exam_session_breaks_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "exam_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_sessions" ADD CONSTRAINT "exam_sessions_planId_definitionId_fkey" FOREIGN KEY ("planId", "definitionId") REFERENCES "exam_definitions"("planId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
