-- CreateTable
CREATE TABLE "exam_teaching_practice_source_dates" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exam_teaching_practice_source_dates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "exam_teaching_practice_source_dates_planId_date_key" ON "exam_teaching_practice_source_dates"("planId", "date");

-- AddForeignKey
ALTER TABLE "exam_teaching_practice_source_dates" ADD CONSTRAINT "exam_teaching_practice_source_dates_planId_fkey" FOREIGN KEY ("planId") REFERENCES "exam_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

