/**
 * RIDING PROGRESS COURSE SCOPE - S3: guarded one-time backfill that scopes the
 * legacy StudentRidingProgressFeedback rows to their CourseOffering.
 *
 * SAFETY MODEL:
 *  - DRY-RUN is the DEFAULT. Without --apply this process issues SELECTs only.
 *  - --offering-id=<id> is REQUIRED in both modes. No offering id is hardcoded
 *    here or in the planner; the target is always the operator's explicit
 *    argument, validated (exists / id matches / level 1 / ACTIVE) before use.
 *  - Fail CLOSED: any refusal from the pure planner aborts with no writes.
 *  - There is NO --force, --yes or confirm-bypass flag, and an unrecognized
 *    argument is a hard error - a typo must never silently drop a guard.
 *  - APPLY recomputes the entire plan INSIDE the write transaction from freshly
 *    read rows, so a dataset that changed between the dry-run and the apply is
 *    caught rather than trusted.
 *  - Every write carries stale-write protection (`AND "courseOfferingId" IS
 *    NULL`) and the total affected-row count must equal the planned count
 *    exactly, or the transaction is rolled back.
 *  - Idempotent: re-running after a successful apply plans 0 updates and reports
 *    all rows as already scoped to the target.
 *
 * It writes exactly ONE column on ONE table - student_riding_progress_feedback.
 * "courseOfferingId" - and never creates, deletes or otherwise edits a row.
 *
 * WHY RAW SQL FOR THE WRITE: the update is issued as parameterized raw SQL
 * rather than through the Prisma model so that `updatedAt` (a client-side
 * @updatedAt field) is NOT bumped. These rows are not being edited by anyone -
 * they are being attributed - so the journal's "last edited" timestamp and the
 * authorship it implies must stay exactly as the instructor left them.
 *
 * ALL business rules live in the PURE, unit-tested module
 * lib/course/riding-progress-course-backfill-core.ts; this file only does IO.
 *
 * Usage (DRY-RUN, read-only):
 *   npx tsx scripts/backfill-riding-progress-course-offering.ts --offering-id=<id>
 *
 * Usage (APPLY - requires its own explicit approval):
 *   npx tsx scripts/backfill-riding-progress-course-offering.ts --offering-id=<id> --apply
 */
import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { identifyDbTarget } from "./backfill-course-offering.plan";
import { utcMidnightToDateKey } from "../lib/trainee-history/israel-date";
import {
  buildRidingProgressCourseBackfillPlan,
  parseRidingProgressBackfillArgs,
  formatRidingProgressBackfillPlan,
  formatRidingProgressBackfillRefusals,
  formatRidingProgressBackfillUpdates,
  type RidingProgressBackfillPlan,
  type RidingProgressBackfillRowInput,
  type RidingProgressBackfillTargetInput,
} from "../lib/course/riding-progress-course-backfill-core";

type Db = Pick<PrismaClient, "courseOffering" | "studentRidingProgressFeedback" | "$executeRaw">;

/**
 * Read the target offering and every feedback row, then build the pure plan.
 * SELECTs only - this function performs no write in either mode.
 */
async function readPlan(db: Db, offeringId: string): Promise<RidingProgressBackfillPlan> {
  const offering = await db.courseOffering.findUnique({
    where: { id: offeringId },
    select: { id: true, level: true, status: true, name: true, activityYearId: true },
  });

  const rows = await db.studentRidingProgressFeedback.findMany({
    select: { id: true, studentId: true, date: true, courseOfferingId: true },
    orderBy: { id: "asc" },
  });

  const target: RidingProgressBackfillTargetInput | null = offering
    ? {
        id: offering.id,
        level: offering.level,
        status: offering.status,
        name: offering.name,
        activityYearId: offering.activityYearId,
      }
    : null;

  const rowInputs: RidingProgressBackfillRowInput[] = rows.map((row) => ({
    id: row.id,
    studentId: row.studentId,
    dateKey: utcMidnightToDateKey(row.date),
    courseOfferingId: row.courseOfferingId,
  }));

  return buildRidingProgressCourseBackfillPlan(offeringId, target, rowInputs);
}

async function main(): Promise<void> {
  const args = parseRidingProgressBackfillArgs(process.argv.slice(2));
  if (args.errors.length > 0) {
    for (const error of args.errors) console.error(error);
    process.exitCode = 1;
    return;
  }
  const offeringId = args.offeringId as string;

  const target = identifyDbTarget(process.env.DATABASE_URL);
  console.log("=== S3 riding-progress course backfill ===");
  console.log(`Execution mode:  ${args.apply ? "APPLY (writes enabled)" : "DRY RUN"}`);
  console.log(`Database target: ${target.display}`);
  console.log(`Requested offering id: ${offeringId}`);

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  try {
    const plan = await readPlan(prisma, offeringId);

    console.log("\n--- Plan ---");
    for (const line of formatRidingProgressBackfillPlan(plan)) console.log(line);

    if (plan.updates.length > 0) {
      console.log("\n--- Rows selected for update (evidence) ---");
      for (const line of formatRidingProgressBackfillUpdates(plan)) console.log(line);
    }

    if (plan.refusals.length > 0) {
      console.log("\n--- REFUSALS (fail closed) ---");
      for (const line of formatRidingProgressBackfillRefusals(plan)) console.log(line);
    }

    if (!args.apply) {
      console.log("\n*** NO DATA WAS MODIFIED (dry run) ***");
      if (!plan.canApply) {
        console.error("\nUNSAFE: the plan has refusals - re-audit before applying.");
        process.exitCode = 1;
      }
      return;
    }

    if (!plan.canApply) {
      console.error(
        `\nREFUSED: --apply blocked - the plan has ${plan.refusals.length} refusal(s). ` +
          "Fail closed: nothing was written.",
      );
      process.exitCode = 1;
      return;
    }

    if (plan.updates.length === 0) {
      console.log("\nNothing to do - every audited row is already scoped to the target.");
      return;
    }

    console.log("\n--- APPLY: one transaction, stale-write protected ---");
    const written = await prisma.$transaction(async (tx) => {
      // Recompute from freshly read rows INSIDE the transaction: a dataset that
      // drifted since the dry-run must abort, never be trusted.
      const fresh = await readPlan(tx as unknown as Db, offeringId);
      if (!fresh.canApply) {
        throw new Error(
          `Dataset changed since planning - ${fresh.refusals.length} refusal(s). Rolling back.`,
        );
      }
      if (fresh.updates.length !== plan.updates.length) {
        throw new Error(
          `Planned ${plan.updates.length} updates but re-plan found ${fresh.updates.length}. Rolling back.`,
        );
      }

      let affected = 0;
      for (const update of fresh.updates) {
        // Stale-write protection: the row must STILL be unscoped. A row scoped by
        // a concurrent writer matches 0 rows here and trips the count check below,
        // so a non-NULL value can never be overwritten.
        affected += await tx.$executeRaw`
          UPDATE "student_riding_progress_feedback"
             SET "courseOfferingId" = ${update.proposedCourseOfferingId}
           WHERE "id" = ${update.id}
             AND "courseOfferingId" IS NULL
        `;
      }

      if (affected !== fresh.updates.length) {
        throw new Error(
          `Affected ${affected} rows but planned ${fresh.updates.length}. Rolling back - no partial backfill.`,
        );
      }
      return affected;
    });

    console.log(`Rows updated: ${written}`);

    const after = await readPlan(prisma, offeringId);
    console.log("\n--- Post-apply verification ---");
    for (const line of formatRidingProgressBackfillPlan(after)) console.log(line);
    if (after.updates.length !== 0 || after.alreadyScopedToTarget !== written + plan.alreadyScopedToTarget) {
      console.error("\nWARNING: post-apply state is not the expected fully-scoped shape - investigate.");
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
