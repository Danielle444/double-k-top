-- CreateTable
CREATE TABLE "course_booklet" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "fileName" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_booklet_pkey" PRIMARY KEY ("id")
);
