-- AlterTable
-- Allow a TeachingPracticeTrackChild row to exist with no child selected yet,
-- so horse/equipment can be entered as a placeholder before the child is
-- known/chosen. Additive/relaxing only: no existing data is deleted,
-- changed, or backfilled by this migration.
ALTER TABLE "teaching_practice_track_children" ALTER COLUMN "childId" DROP NOT NULL;

-- CreateIndex
-- Intentional partial unique index, hand-written (Prisma's schema.prisma has
-- no syntax for a WHERE-qualified/partial unique index, so this cannot be
-- generated from the schema and must be preserved by hand in any future
-- migration touching this table).
--
-- The existing (trackId, childId) unique index does NOT by itself limit a
-- track to one childless row: Postgres treats every NULL as distinct for
-- uniqueness purposes, so two rows with the same trackId and childId = NULL
-- would not violate that constraint. This index is the actual guard - it
-- only applies to rows where childId IS NULL, and enforces "at most one
-- childless horse/equipment placeholder row per track."
CREATE UNIQUE INDEX "teaching_practice_track_children_trackId_null_child_key"
  ON "teaching_practice_track_children" ("trackId")
  WHERE "childId" IS NULL;
