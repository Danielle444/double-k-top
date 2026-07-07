-- AlterTable
ALTER TABLE "teaching_practice_tracks" ADD COLUMN     "groupTrackId" TEXT;

-- CreateIndex
CREATE INDEX "teaching_practice_tracks_groupTrackId_idx" ON "teaching_practice_tracks"("groupTrackId");

-- AddForeignKey
ALTER TABLE "teaching_practice_tracks" ADD CONSTRAINT "teaching_practice_tracks_groupTrackId_fkey" FOREIGN KEY ("groupTrackId") REFERENCES "teaching_practice_tracks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
