-- FEEDING-VISIBILITY / FEEDING-ROUND Stage 1: reversible horse visibility +
-- shared current-round feeding progress.
--
-- ADDITIVE ONLY. Creates one enum type and two new tables. It alters no
-- existing table, adds no column to any existing table (horse_feeding_meals,
-- students and instructors are all untouched), creates no foreign key, adds no
-- index to any existing table, and contains NO insert, update, delete,
-- truncate, drop, or backfill operation of any kind.
--
-- Both new tables are created EMPTY and that empty state is already the correct
-- initial state for all 49 horses currently on the feeding board - no backfill
-- exists or is needed, because both models represent their default by ROW
-- ABSENCE:
--   * horse_feeding_visibility: a MISSING ROW MEANS VISIBLE. Absence is never
--     read as hidden, so an empty table (and any failed/partial read) can only
--     ever show too much, never silently empty the operational board.
--   * horse_feeding_progress:   a MISSING ROW MEANS PENDING ("not yet marked",
--     never inferred as fed) - the same convention student_attendance already
--     uses for an absent row.
--
-- Nothing in the repository reads or writes either table in this stage: the
-- pure composition core, the authorization gates, the server actions and the
-- board UI are all later, separately approved stages. Applying this migration
-- therefore changes NO application behaviour.
--
-- NO FOREIGN KEY BY DESIGN. horseName is the same free-text natural key already
-- used by horse_feeding_meals."horseName", riding_slot_horse_list_items,
-- riding_lesson_notes."sessionHorseName" and every other horse reference in
-- this database: there is NO horses table and none is introduced. Adding an FK
-- here would require inventing that entity, which is explicitly out of scope.
--
-- COLUMN NAMING: columns are camelCase and only the TABLE names are snake_case
-- (@@map), matching horse_feeding_meals."horseName" and the rest of this
-- schema. The primary key of each table is the horse-name column. Writing these
-- columns as snake_case would silently break the generated Prisma client, which
-- queries "horseName".
--
-- NOTE (no round history): there is deliberately no round id, no date column
-- and no FeedingRound table. "נקה את כל הסימונים" (a later stage) DELETEs every
-- row of horse_feeding_progress inside a single transaction. If per-round
-- history is ever required it must arrive as a new model, never by repurposing
-- these rows.

-- CreateEnum
CREATE TYPE "HorseFeedingProgressState" AS ENUM ('PENDING', 'HAY_DONE', 'COMPLETE');

-- CreateTable
CREATE TABLE "horse_feeding_visibility" (
    "horseName" TEXT NOT NULL,
    "isHidden" BOOLEAN NOT NULL DEFAULT true,
    "updatedByName" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "horse_feeding_visibility_pkey" PRIMARY KEY ("horseName")
);

-- CreateTable
CREATE TABLE "horse_feeding_progress" (
    "horseName" TEXT NOT NULL,
    "state" "HorseFeedingProgressState" NOT NULL,
    "hayMarkedAt" TIMESTAMP(3),
    "hayMarkedByName" TEXT,
    "concentrateMarkedAt" TIMESTAMP(3),
    "concentrateMarkedByName" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "horse_feeding_progress_pkey" PRIMARY KEY ("horseName")
);
