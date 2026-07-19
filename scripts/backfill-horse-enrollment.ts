/**
 * MULTI-COURSE W8A-2 - enrollment-scoped horse backfill (DRY-RUN default).
 *
 * Links each existing TraineeHorseAssignment to the Student's single
 * CourseEnrollment in the current CourseOffering, and populates the three
 * CourseEnrollment horse cache fields from the horse history interval current at
 * a single captured asOf date.
 *
 * SAFETY MODEL (mirrors backfill-course-offering.ts):
 *  - Default mode is DRY-RUN (performs no writes).
 *  - --apply performs writes; APPLY against the production project ref is
 *    REFUSED outright (production writes go through the separate, guarded
 *    scripts/backfill-horse-enrollment.prod-apply.ts).
 *  - DRY-RUN may read the production DB (read-only inspection only).
 *  - Fail CLOSED: --apply refuses if the plan has ANY anomaly.
 *  - Idempotent: re-running after a correct apply plans 0 updates.
 *  - It NEVER creates/deletes history rows, NEVER changes a history row's
 *    studentId/horse values/effective dates, and NEVER writes Student.
 *
 * The single captured asOf is the Israel-local calendar day of one trusted
 * instant taken at startup (override with --as-of=YYYY-MM-DD for inspection).
 * All matching / interval / cache / anomaly decisions live in the PURE,
 * unit-tested module lib/course/horse-enrollment-backfill-plan.ts.
 *
 * Usage (DRY-RUN):
 *   npx tsx scripts/backfill-horse-enrollment.ts
 *
 * Usage (APPLY - refused against production; non-prod only):
 *   npx tsx scripts/backfill-horse-enrollment.ts --apply
 */
import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { identifyDbTarget } from "./backfill-course-offering.plan";
import { isValidDateKey } from "../lib/trainee-history/interval-resolver";
import {
  formatHorseEnrollmentAnomalies,
  formatHorseEnrollmentPlanSummary,
} from "../lib/course/horse-enrollment-backfill-plan";
import { applyHorseEnrollmentBackfill, readHorseEnrollmentPlan } from "./backfill-horse-enrollment.apply";

interface ParsedArgs {
  apply: boolean;
  asOf: string | null;
  errors: string[];
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  let apply = false;
  let asOf: string | null = null;
  const errors: string[] = [];

  for (const arg of argv) {
    if (arg === "--apply") {
      apply = true;
    } else if (arg.startsWith("--as-of=")) {
      const v = arg.slice("--as-of=".length).trim();
      if (!isValidDateKey(v)) {
        errors.push(`--as-of must be a valid YYYY-MM-DD date, got ${JSON.stringify(v)}`);
      } else {
        asOf = v;
      }
    } else {
      errors.push(`Unrecognized argument: ${arg}`);
    }
  }

  return { apply, asOf, errors };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.errors.length > 0) {
    for (const e of args.errors) console.error(e);
    process.exitCode = 1;
    return;
  }

  const mode = args.apply ? "APPLY (writes enabled)" : "DRY-RUN (no writes)";
  const target = identifyDbTarget(process.env.DATABASE_URL);

  console.log("=== MULTI-COURSE W8A-2 horse enrollment backfill ===");
  console.log(`Execution mode:  ${mode}`);
  console.log(`Database target: ${target.display}`);

  // Production write guard - APPLY against production is refused outright.
  if (args.apply && target.isProduction) {
    console.error(
      "REFUSED: --apply targets the PRODUCTION project ref. Production writes go " +
        "through the separate, explicitly-guarded scripts/backfill-horse-enrollment." +
        "prod-apply.ts entrypoint. Aborting with no writes.",
    );
    process.exitCode = 1;
    return;
  }
  if (target.isProduction) {
    console.warn(
      "WARNING: DATABASE_URL points at the PRODUCTION project ref. Continuing in " +
        "READ-ONLY DRY-RUN (inspection only, no writes).",
    );
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  try {
    // Single captured instant -> single asOf (override via --as-of for inspection).
    const now = args.asOf ? new Date(`${args.asOf}T12:00:00.000Z`) : new Date();
    const { plan } = await readHorseEnrollmentPlan(prisma, now);

    console.log("\n--- Plan summary (no writes yet) ---");
    console.log(formatHorseEnrollmentPlanSummary(plan));
    if (plan.anomalies.length > 0) {
      console.log("\n--- Anomalies (reported, NEVER repaired) ---");
      for (const line of formatHorseEnrollmentAnomalies(plan)) console.log(`  - ${line}`);
    }

    if (!args.apply) {
      console.log("\n--- End DRY-RUN (no writes performed) ---");
      return;
    }

    if (!plan.canApply) {
      console.error(
        `\nREFUSED: --apply blocked - the plan has ${plan.summary.anomalyTotal} anomaly(ies). ` +
          "Fail closed: resolve every anomaly before applying.",
      );
      process.exitCode = 1;
      return;
    }

    console.log("\n--- APPLY: writing links + enrollment caches (one transaction) ---");
    const result = await applyHorseEnrollmentBackfill(prisma, plan);
    console.log(`Link updates written:  ${result.linkUpdates}`);
    console.log(`Cache updates written: ${result.cacheUpdates}`);

    // Immediate verification: a fresh plan must now show zero remaining work.
    const { plan: after } = await readHorseEnrollmentPlan(prisma, now);
    if (
      after.summary.linkUpdatesRequired !== 0 ||
      after.summary.cacheUpdatesRequired !== 0 ||
      after.summary.anomalyTotal !== 0
    ) {
      console.error("FAIL: post-apply verification still reports outstanding work:");
      console.error(formatHorseEnrollmentPlanSummary(after));
      process.exitCode = 1;
      return;
    }
    console.log("Post-apply verification: 0 link updates, 0 cache updates, 0 anomalies.");
    console.log("--- End APPLY ---");
  } catch (error) {
    console.error("Horse enrollment backfill failed.");
    console.error(error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
