-- CreateEnum
CREATE TYPE "CourseMaterialType" AS ENUM ('FILE', 'LINK');

-- CreateEnum
CREATE TYPE "CourseMaterialVisibility" AS ENUM ('STUDENTS', 'INSTRUCTORS', 'BOTH');

-- CreateTable
CREATE TABLE "course_materials" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "materialType" "CourseMaterialType" NOT NULL,
    "visibility" "CourseMaterialVisibility" NOT NULL,
    "filePath" TEXT,
    "fileName" TEXT,
    "externalUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_materials_pkey" PRIMARY KEY ("id")
);
