-- AlterTable: instructor/coach ownership columns on the three trainee
-- progress-journal models - purely additive, nullable, no existing data
-- touched. Every existing row (all admin-created so far) keeps NULL in
-- both columns, which is exactly correct: NULL means "not written by an
-- instructor."
ALTER TABLE "student_riding_progress_feedback" ADD COLUMN     "createdByInstructorId" TEXT,
ADD COLUMN     "updatedByInstructorId" TEXT;

ALTER TABLE "student_lunge_progress_feedback" ADD COLUMN     "createdByInstructorId" TEXT,
ADD COLUMN     "updatedByInstructorId" TEXT;

ALTER TABLE "student_presentation_progress_feedback" ADD COLUMN     "createdByInstructorId" TEXT,
ADD COLUMN     "updatedByInstructorId" TEXT;

-- CreateIndex
CREATE INDEX "student_riding_progress_feedback_createdByInstructorId_idx" ON "student_riding_progress_feedback"("createdByInstructorId");

-- CreateIndex
CREATE INDEX "student_lunge_progress_feedback_createdByInstructorId_idx" ON "student_lunge_progress_feedback"("createdByInstructorId");

-- CreateIndex
CREATE INDEX "student_presentation_progress_feedback_createdByInstructorId_idx" ON "student_presentation_progress_feedback"("createdByInstructorId");

-- AddForeignKey
ALTER TABLE "student_riding_progress_feedback" ADD CONSTRAINT "student_riding_progress_feedback_createdByInstructorId_fkey" FOREIGN KEY ("createdByInstructorId") REFERENCES "instructors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_riding_progress_feedback" ADD CONSTRAINT "student_riding_progress_feedback_updatedByInstructorId_fkey" FOREIGN KEY ("updatedByInstructorId") REFERENCES "instructors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_lunge_progress_feedback" ADD CONSTRAINT "student_lunge_progress_feedback_createdByInstructorId_fkey" FOREIGN KEY ("createdByInstructorId") REFERENCES "instructors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_lunge_progress_feedback" ADD CONSTRAINT "student_lunge_progress_feedback_updatedByInstructorId_fkey" FOREIGN KEY ("updatedByInstructorId") REFERENCES "instructors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_presentation_progress_feedback" ADD CONSTRAINT "student_presentation_progress_feedback_createdByInstructorId_fkey" FOREIGN KEY ("createdByInstructorId") REFERENCES "instructors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_presentation_progress_feedback" ADD CONSTRAINT "student_presentation_progress_feedback_updatedByInstructorId_fkey" FOREIGN KEY ("updatedByInstructorId") REFERENCES "instructors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
