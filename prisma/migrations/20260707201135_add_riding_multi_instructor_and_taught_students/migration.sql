-- AlterTable
ALTER TABLE "riding_lesson_notes" ADD COLUMN     "lessonTopic" TEXT;

-- CreateTable
CREATE TABLE "riding_slot_assignment_instructors" (
    "id" TEXT NOT NULL,
    "ridingSlotAssignmentId" TEXT NOT NULL,
    "instructorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "riding_slot_assignment_instructors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "riding_lesson_note_taught_students" (
    "id" TEXT NOT NULL,
    "ridingLessonNoteId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "riding_lesson_note_taught_students_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "riding_slot_assignment_instructors_ridingSlotAssignmentId_i_key" ON "riding_slot_assignment_instructors"("ridingSlotAssignmentId", "instructorId");

-- CreateIndex
CREATE UNIQUE INDEX "riding_lesson_note_taught_students_ridingLessonNoteId_stude_key" ON "riding_lesson_note_taught_students"("ridingLessonNoteId", "studentId");

-- AddForeignKey
ALTER TABLE "riding_slot_assignment_instructors" ADD CONSTRAINT "riding_slot_assignment_instructors_ridingSlotAssignmentId_fkey" FOREIGN KEY ("ridingSlotAssignmentId") REFERENCES "riding_slot_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "riding_slot_assignment_instructors" ADD CONSTRAINT "riding_slot_assignment_instructors_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "instructors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "riding_lesson_note_taught_students" ADD CONSTRAINT "riding_lesson_note_taught_students_ridingLessonNoteId_fkey" FOREIGN KEY ("ridingLessonNoteId") REFERENCES "riding_lesson_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "riding_lesson_note_taught_students" ADD CONSTRAINT "riding_lesson_note_taught_students_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: one join row per existing non-null RidingSlotAssignment.instructorId,
-- so the new join table starts out equivalent to the legacy scalar column.
INSERT INTO "riding_slot_assignment_instructors" ("id", "ridingSlotAssignmentId", "instructorId", "createdAt")
SELECT gen_random_uuid()::text, "id", "instructorId", CURRENT_TIMESTAMP
FROM "riding_slot_assignments"
WHERE "instructorId" IS NOT NULL;
