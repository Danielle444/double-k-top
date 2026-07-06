-- CreateTable
CREATE TABLE "riding_slot_schedule_items" (
    "id" TEXT NOT NULL,
    "ridingSlotId" TEXT NOT NULL,
    "scheduleItemId" TEXT NOT NULL,

    CONSTRAINT "riding_slot_schedule_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "riding_slot_schedule_items_scheduleItemId_key" ON "riding_slot_schedule_items"("scheduleItemId");

-- CreateIndex
CREATE UNIQUE INDEX "riding_slot_schedule_items_ridingSlotId_scheduleItemId_key" ON "riding_slot_schedule_items"("ridingSlotId", "scheduleItemId");

-- AddForeignKey
ALTER TABLE "riding_slot_schedule_items" ADD CONSTRAINT "riding_slot_schedule_items_ridingSlotId_fkey" FOREIGN KEY ("ridingSlotId") REFERENCES "riding_slots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "riding_slot_schedule_items" ADD CONSTRAINT "riding_slot_schedule_items_scheduleItemId_fkey" FOREIGN KEY ("scheduleItemId") REFERENCES "schedule_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
