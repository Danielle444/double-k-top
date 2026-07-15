-- AlterTable
ALTER TABLE "riding_slot_complex_plans" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "riding_slot_complex_publications" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "sourceVersion" INTEGER NOT NULL,
    "firstPublishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByInstructorId" TEXT,
    "updatedByAdminEmail" TEXT,
    "updatedByAdminName" TEXT,
    "updatedByName" TEXT NOT NULL,

    CONSTRAINT "riding_slot_complex_publications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "riding_slot_complex_publication_blocks" (
    "id" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "sourceBlockId" TEXT,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "riding_slot_complex_publication_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "riding_slot_complex_publication_stations" (
    "id" TEXT NOT NULL,
    "publicationBlockId" TEXT NOT NULL,
    "sourceStationId" TEXT,
    "instructorId" TEXT,
    "instructorNameSnapshot" TEXT,
    "arena" TEXT,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "riding_slot_complex_publication_stations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "riding_slot_complex_publication_pairs" (
    "id" TEXT NOT NULL,
    "publicationStationId" TEXT NOT NULL,
    "sourcePairId" TEXT,
    "trainee1Id" TEXT,
    "trainee1NameSnapshot" TEXT,
    "trainee2Id" TEXT,
    "trainee2NameSnapshot" TEXT,
    "horseName" TEXT,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "riding_slot_complex_publication_pairs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "riding_slot_complex_publications_planId_key" ON "riding_slot_complex_publications"("planId");

-- CreateIndex
CREATE INDEX "riding_slot_complex_publication_blocks_publicationId_sortOr_idx" ON "riding_slot_complex_publication_blocks"("publicationId", "sortOrder");

-- CreateIndex
CREATE INDEX "riding_slot_complex_publication_stations_publicationBlockId_idx" ON "riding_slot_complex_publication_stations"("publicationBlockId", "sortOrder");

-- CreateIndex
CREATE INDEX "riding_slot_complex_publication_pairs_publicationStationId__idx" ON "riding_slot_complex_publication_pairs"("publicationStationId", "sortOrder");

-- CreateIndex
CREATE INDEX "riding_slot_complex_publication_pairs_trainee1Id_idx" ON "riding_slot_complex_publication_pairs"("trainee1Id");

-- CreateIndex
CREATE INDEX "riding_slot_complex_publication_pairs_trainee2Id_idx" ON "riding_slot_complex_publication_pairs"("trainee2Id");

-- AddForeignKey
ALTER TABLE "riding_slot_complex_publications" ADD CONSTRAINT "riding_slot_complex_publications_planId_fkey" FOREIGN KEY ("planId") REFERENCES "riding_slot_complex_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "riding_slot_complex_publications" ADD CONSTRAINT "riding_slot_complex_publications_updatedByInstructorId_fkey" FOREIGN KEY ("updatedByInstructorId") REFERENCES "instructors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "riding_slot_complex_publication_blocks" ADD CONSTRAINT "riding_slot_complex_publication_blocks_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "riding_slot_complex_publications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "riding_slot_complex_publication_stations" ADD CONSTRAINT "riding_slot_complex_publication_stations_publicationBlockI_fkey" FOREIGN KEY ("publicationBlockId") REFERENCES "riding_slot_complex_publication_blocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "riding_slot_complex_publication_stations" ADD CONSTRAINT "riding_slot_complex_publication_stations_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "instructors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "riding_slot_complex_publication_pairs" ADD CONSTRAINT "riding_slot_complex_publication_pairs_publicationStationId_fkey" FOREIGN KEY ("publicationStationId") REFERENCES "riding_slot_complex_publication_stations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "riding_slot_complex_publication_pairs" ADD CONSTRAINT "riding_slot_complex_publication_pairs_trainee1Id_fkey" FOREIGN KEY ("trainee1Id") REFERENCES "students"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "riding_slot_complex_publication_pairs" ADD CONSTRAINT "riding_slot_complex_publication_pairs_trainee2Id_fkey" FOREIGN KEY ("trainee2Id") REFERENCES "students"("id") ON DELETE SET NULL ON UPDATE CASCADE;
