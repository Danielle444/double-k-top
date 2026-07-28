-- AlterTable
ALTER TABLE "student_riding_progress_feedback" ADD COLUMN     "courseOfferingId" TEXT;

-- CreateIndex
CREATE INDEX "student_riding_progress_feedback_courseOfferingId_idx" ON "student_riding_progress_feedback"("courseOfferingId");

-- CreateIndex
CREATE INDEX "student_riding_progress_feedback_studentId_courseOfferingId_idx" ON "student_riding_progress_feedback"("studentId", "courseOfferingId");

-- AddForeignKey
ALTER TABLE "student_riding_progress_feedback" ADD CONSTRAINT "student_riding_progress_feedback_courseOfferingId_fkey" FOREIGN KEY ("courseOfferingId") REFERENCES "course_offerings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
