-- DropForeignKey
ALTER TABLE "riding_slot_complex_block_instructors" DROP CONSTRAINT "riding_slot_complex_block_instructors_blockId_fkey";

-- DropForeignKey
ALTER TABLE "riding_slot_complex_block_instructors" DROP CONSTRAINT "riding_slot_complex_block_instructors_instructorId_fkey";

-- DropForeignKey
ALTER TABLE "riding_slot_complex_pairs" DROP CONSTRAINT "riding_slot_complex_pairs_blockId_fkey";

-- DropIndex
DROP INDEX "riding_slot_complex_pairs_blockId_sortOrder_idx";

-- AlterTable
ALTER TABLE "riding_slot_complex_blocks" DROP COLUMN "arena";

-- AlterTable
ALTER TABLE "riding_slot_complex_pairs" DROP COLUMN "blockId",
ADD COLUMN     "stationId" TEXT NOT NULL;

-- DropTable
DROP TABLE "riding_slot_complex_block_instructors";

-- CreateTable
CREATE TABLE "riding_slot_complex_stations" (
    "id" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "instructorId" TEXT,
    "arena" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "riding_slot_complex_stations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "riding_slot_complex_stations_blockId_sortOrder_idx" ON "riding_slot_complex_stations"("blockId", "sortOrder");

-- CreateIndex
CREATE INDEX "riding_slot_complex_pairs_stationId_sortOrder_idx" ON "riding_slot_complex_pairs"("stationId", "sortOrder");

-- AddForeignKey
ALTER TABLE "riding_slot_complex_stations" ADD CONSTRAINT "riding_slot_complex_stations_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "riding_slot_complex_blocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "riding_slot_complex_stations" ADD CONSTRAINT "riding_slot_complex_stations_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "instructors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "riding_slot_complex_pairs" ADD CONSTRAINT "riding_slot_complex_pairs_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "riding_slot_complex_stations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

