-- MULTI-COURSE W0-CAP-2: capability persistence layer (CAP-1..CAP-3).
--
-- ADDITIVE ONLY. Creates one enum type and two new tables. It alters no
-- existing table, adds no column to any existing table, and contains NO
-- insert, update, delete, drop, or backfill operation of any kind.
--
-- Both new tables are created EMPTY and no seed runs here or anywhere in this
-- stage, so no existing or new data can violate any constraint declared below.
-- Populating capability_catalog is W0-CAP-3's job; until then the catalog is
-- legitimately empty and nothing reads it.
--
-- NOTE (CAP-2): CourseCapabilityStatus has NO 'DISABLED' member BY DESIGN.
-- DISABLED is represented by ROW ABSENCE in course_offering_capabilities.
-- Adding a DISABLED member later would silently break the sparse-storage
-- contract that CAP-1 and CAP-6 depend on.
--
-- NOTE (CAP-3, hard deletion): the ON DELETE RESTRICT on the capabilityKey
-- foreign key protects a catalog row only WHILE referencing rows exist; an
-- unreferenced catalog row could still be deleted directly. The "isActive"
-- column is the persisted retirement representation, and the universal
-- "deprecate, never hard-delete" rule remains an application/write-path
-- invariant for a later layer. No trigger or other enforcement is added here.

-- CreateEnum
CREATE TYPE "CourseCapabilityStatus" AS ENUM ('ENABLED', 'READ_ONLY');

-- CreateTable
CREATE TABLE "capability_catalog" (
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "capability_catalog_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "course_offering_capabilities" (
    "id" TEXT NOT NULL,
    "courseOfferingId" TEXT NOT NULL,
    "capabilityKey" TEXT NOT NULL,
    "status" "CourseCapabilityStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_offering_capabilities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Exactly 63 characters, PostgreSQL's identifier limit: stored in full, NOT
-- truncated. Any later rename lengthening this name must declare an explicit
-- shorter name in both schema.prisma and this SQL.
CREATE UNIQUE INDEX "course_offering_capabilities_courseOfferingId_capabilityKey_key" ON "course_offering_capabilities"("courseOfferingId", "capabilityKey");

-- CreateIndex
CREATE INDEX "course_offering_capabilities_capabilityKey_idx" ON "course_offering_capabilities"("capabilityKey");

-- AddForeignKey
ALTER TABLE "course_offering_capabilities" ADD CONSTRAINT "course_offering_capabilities_courseOfferingId_fkey" FOREIGN KEY ("courseOfferingId") REFERENCES "course_offerings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_offering_capabilities" ADD CONSTRAINT "course_offering_capabilities_capabilityKey_fkey" FOREIGN KEY ("capabilityKey") REFERENCES "capability_catalog"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
