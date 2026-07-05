-- AlterTable
ALTER TABLE "instructors" ADD COLUMN     "canEditHorseAssignments" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "students" ADD COLUMN     "assignedHorseName" TEXT,
ADD COLUMN     "hasPrivateHorse" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "privateHorseName" TEXT;
