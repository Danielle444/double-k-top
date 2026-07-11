-- Correction migration: the previously applied migration
-- (20260711160000_add_student_presentation_progress_feedback) created
-- student_presentation_progress_feedback with a generic ratingHalfPoints
-- (1.0-5.0 half-point) column. Product correction: פרזנטציה is scored
-- against the actual uploaded exam form - a fixed base score of 70, 10
-- fixed scoring categories each worth one of -1/-0.5/0/+0.5/+1, and a
-- computed finalScore. ratingHalfPoints cannot be meaningfully converted
-- into that rubric, so this migration does NOT attempt a fake conversion -
-- any existing row instead becomes a neutral rubric row (all 10 categories
-- at 0, finalScore 70.0 = baseScore + 0), while studentId/date/feedback/
-- topic/presentationType/createdByName/updatedByName/createdAt/updatedAt
-- are all preserved untouched.

-- AlterTable: add the rubric-based scoring columns. categoryScores and
-- finalScore get a temporary DEFAULT purely to backfill any already-applied
-- row from Stage P4c's flawed version (see the ALTER COLUMN ... DROP
-- DEFAULT statements below, which remove it again immediately after -
-- neither field has a @default in the Prisma schema, since the application
-- always computes and sends both explicitly on every write).
ALTER TABLE "student_presentation_progress_feedback"
  ADD COLUMN "baseScore" INTEGER NOT NULL DEFAULT 70,
  ADD COLUMN "categoryScores" JSONB NOT NULL DEFAULT '{"standingInFrontOfAudience":0,"appearance":0,"languageVoice":0,"aidsUse":0,"topicPresentation":0,"lectureStructure":0,"professionalKnowledge":0,"timeManagement":0,"interestOriginality":0,"generalImpression":0}',
  ADD COLUMN "finalScore" DECIMAL(5,1) NOT NULL DEFAULT 70.0;

-- Drop the flawed generic rating column - never meaningfully convertible to
-- the rubric (see comment above). Any existing row keeps every other
-- column's real value; only this column is lost, by design.
ALTER TABLE "student_presentation_progress_feedback" DROP COLUMN "ratingHalfPoints";

-- Remove the backfill-only defaults now that every existing row has a
-- value. baseScore's DEFAULT 70 is intentionally kept - it matches the
-- Prisma schema's own @default(70) for that field.
ALTER TABLE "student_presentation_progress_feedback" ALTER COLUMN "categoryScores" DROP DEFAULT;
ALTER TABLE "student_presentation_progress_feedback" ALTER COLUMN "finalScore" DROP DEFAULT;
