-- MSG0 FOLLOW-UP CORRECTION: make the TRAINEE audience uniqueness offering-scoped.
--
-- ADDITIVE-EQUIVALENT / INDEX-ONLY. This migration ONLY drops and recreates ONE
-- partial unique index on the existing message_task_audiences table. It creates
-- no table/enum/column/FK/CHECK, changes none of them, and contains NO INSERT /
-- UPDATE / DELETE / backfill of any kind. The table is empty (the MSG0 migration
-- that created it has not been applied to any database yet), so the recreated
-- index has no existing rows to validate against.
--
-- WHY: the original MSG0 index keyed TRAINEE uniqueness on (messageTaskId,
-- studentId) - the GLOBAL person id - so a dual-enrolled trainee explicitly
-- selected under two offerings could not be persisted as two offering-scoped
-- TRAINEE audience rows. That discards the offering context in which the manager
-- made each selection, and made TRAINEE the ONLY audience kind whose uniqueness
-- was not offering-scoped (COURSE is unique by (messageTaskId, courseOfferingId),
-- GROUP by (messageTaskId, courseGroupId)).
--
-- THE FIX: TRAINEE becomes unique by (messageTaskId, courseOfferingId, studentId)
-- WHERE kind='TRAINEE', matching the offering-scoped shape of COURSE and GROUP.
-- A dual trainee may now yield two TRAINEE rows - one per offering - preserving
-- audience-segment offering context.
--
-- RECIPIENT DEDUPLICATION IS UNAFFECTED and remains a SEPARATE layer: one message
-- per person is still enforced by message_task_recipients' own
-- @@unique([messageTaskId, studentId]) (migration
-- 20260705181532_add_message_task_system, unchanged here). Multiple TRAINEE
-- audience rows for one dual trainee still materialize exactly ONE recipient row.
--
-- The kind-shape CHECK and all four foreign keys from the MSG0 migration are
-- deliberately left untouched.

-- DropIndex
DROP INDEX "message_task_audiences_trainee_unique";

-- CreateIndex
CREATE UNIQUE INDEX "message_task_audiences_trainee_unique" ON "message_task_audiences"("messageTaskId", "courseOfferingId", "studentId") WHERE "kind" = 'TRAINEE';
