-- P-MATERIALS M0: course-scoped material audience (many-to-many).
--
-- ADDITIVE ONLY. Creates ONE new table with two foreign keys, one composite
-- unique index, and one secondary index. It alters no existing table, adds no
-- column to course_materials or course_offerings, creates no enum, and contains
-- NO insert, update, delete, truncate, drop, or backfill operation of any kind.
--
-- The table is created EMPTY and nothing in the repository writes or reads it in
-- this slice (M0). The trainee reader that enforces visibility is M1/M2, not M0.
--
-- Fail-closed contract: a material with zero rows here is invisible to every
-- trainee. Because the table is created empty, ALL materials are invisible to
-- trainees until the SEPARATELY APPROVED, guarded 11-material Level-1 backfill
-- runs. That backfill is a distinct production data operation and is
-- deliberately NOT part of this schema migration - do not deploy any trainee
-- reader that joins this table before the backfill has populated it.
--
-- onDelete: Cascade on the material edge (audience rows are meaningless without
-- their material); onDelete: Restrict on the offering edge (spine's uniform
-- policy - deleting an offering must never silently erase audience config).

-- CreateTable
CREATE TABLE "course_material_audiences" (
    "id" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "courseOfferingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_material_audiences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "course_material_audiences_materialId_courseOfferingId_key" ON "course_material_audiences"("materialId", "courseOfferingId");

-- CreateIndex
CREATE INDEX "course_material_audiences_courseOfferingId_idx" ON "course_material_audiences"("courseOfferingId");

-- AddForeignKey
ALTER TABLE "course_material_audiences" ADD CONSTRAINT "course_material_audiences_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "course_materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_material_audiences" ADD CONSTRAINT "course_material_audiences_courseOfferingId_fkey" FOREIGN KEY ("courseOfferingId") REFERENCES "course_offerings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
