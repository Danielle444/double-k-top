-- CreateEnum
CREATE TYPE "AllocationMode" AS ENUM ('FIXED_COUNT', 'ONE_PER_SUBGROUP');

-- AlterTable
ALTER TABLE "duty_types" ADD COLUMN     "allocationMode" "AllocationMode" NOT NULL DEFAULT 'FIXED_COUNT';

-- AlterTable
ALTER TABLE "students" ADD COLUMN     "subgroupNumber" INTEGER;

