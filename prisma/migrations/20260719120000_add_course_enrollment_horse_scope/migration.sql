-- AlterTable
ALTER TABLE "trainee_horse_assignments" ADD COLUMN "courseEnrollmentId" TEXT;

-- AlterTable
ALTER TABLE "course_enrollments" ADD COLUMN "assignedHorseName" TEXT,
ADD COLUMN "hasPrivateHorse" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "privateHorseName" TEXT;

-- CreateIndex
CREATE INDEX "trainee_horse_assignments_courseEnrollmentId_idx" ON "trainee_horse_assignments"("courseEnrollmentId");

-- AddForeignKey
ALTER TABLE "trainee_horse_assignments" ADD CONSTRAINT "trainee_horse_assignments_courseEnrollmentId_fkey" FOREIGN KEY ("courseEnrollmentId") REFERENCES "course_enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
