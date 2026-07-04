-- CreateTable
CREATE TABLE "students" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "accessCode" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_availability" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "isAvailable" BOOLEAN NOT NULL,

    CONSTRAINT "student_availability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "duty_types" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "defaultRequiredCount" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "duty_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "duty_assignments" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "studentId" TEXT NOT NULL,
    "dutyTypeId" TEXT NOT NULL,
    "isManual" BOOLEAN NOT NULL DEFAULT false,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "duty_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "students_accessCode_key" ON "students"("accessCode");

-- CreateIndex
CREATE INDEX "student_availability_date_idx" ON "student_availability"("date");

-- CreateIndex
CREATE UNIQUE INDEX "student_availability_studentId_date_key" ON "student_availability"("studentId", "date");

-- CreateIndex
CREATE INDEX "duty_assignments_date_idx" ON "duty_assignments"("date");

-- CreateIndex
CREATE INDEX "duty_assignments_dutyTypeId_idx" ON "duty_assignments"("dutyTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "duty_assignments_date_studentId_key" ON "duty_assignments"("date", "studentId");

-- AddForeignKey
ALTER TABLE "student_availability" ADD CONSTRAINT "student_availability_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "duty_assignments" ADD CONSTRAINT "duty_assignments_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "duty_assignments" ADD CONSTRAINT "duty_assignments_dutyTypeId_fkey" FOREIGN KEY ("dutyTypeId") REFERENCES "duty_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;
