/**
 * MULTI-COURSE W8A-2 - PRODUCTION-ONLY enrollment-scoped horse backfill APPLY.
 *
 * This is the smallest, separately-reviewed entrypoint that actually writes the
 * horse links + enrollment caches to PRODUCTION. It reuses - never re-implements
 * - the tested logic:
 *   - all matching/interval/cache/anomaly rules:
 *     lib/course/horse-enrollment-backfill-plan.ts (pure)
 *   - the read + one-transaction idempotent write:
 *     scripts/backfill-horse-enrollment.apply.ts
 *   - the production confirmation + verification gates:
 *     scripts/backfill-horse-enrollment.prod-apply.plan.ts (pure)
 *
 * It is deliberately NOT the dev runner: the dev runner
 * (backfill-horse-enrollment.ts) REFUSES --apply against production and that
 * guard is untouched. This entrypoint is the ONLY place a production write can
 * originate, and only after EVERY gate below passes:
 *
 *   1. Confirmation guard - requires --apply, --confirm-production=<ref> equal to
 *      the locked production ref and agreeing with the detected DATABASE_URL ref,
 *      and every reviewed expected count (--expected-history-rows,
 *      --expected-enrollments, --expected-link-updates, --expected-cache-updates).
 *      Prisma is not even constructed until this passes.
 *   2. Expected-plan gate - the re-read plan must match the reviewed expected
 *      counts EXACTLY and carry zero anomalies. Any deviation stops BEFORE any
 *      write. (The cache-update count is a reviewed input, never hardcoded.)
 *   3. Post-write verification - a fresh re-read plan must show full convergence.
 *   4. Preservation verification - the history-row and enrollment counts must be
 *      exactly unchanged (only UPDATEs happen; nothing is created/deleted).
 *
 * Any failed gate exits non-zero. Credentials and PII are never printed (only the
 * redacted DB target and safe counts/ids). All writes are one transaction.
 *
 * Usage (DO NOT RUN until explicitly approved):
 *   npx tsx scripts/backfill-horse-enrollment.prod-apply.ts \
 *     --apply \
 *     --confirm-production=yjnjfnesxhmzhzpwrmqy \
 *     --expected-history-rows=41 \
 *     --expected-enrollments=41 \
 *     --expected-link-updates=41 \
 *     --expected-cache-updates=<reviewed dry-run value>
 */
import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { identifyDbTarget } from "./backfill-course-offering.plan";
import { formatHorseEnrollmentAnomalies } from "../lib/course/horse-enrollment-backfill-plan";
import { applyHorseEnrollmentBackfill, readHorseEnrollmentPlan } from "./backfill-horse-enrollment.apply";
import {
  checkExpectedHorsePlan,
  checkHorsePostWrite,
  checkHorsePreservation,
  evaluateHorseProdApplyGuard,
  FAILURE_RECOVERY_POLICY,
} from "./backfill-horse-enrollment.prod-apply.plan";

interface ParsedProdArgs {
  apply: boolean;
  confirmProductionRef: string | null;
  expectedHistoryRows: number | null;
  expectedEnrollments: number | null;
  expectedLinkUpdates: number | null;
  expectedCacheUpdates: number | null;
  unknown: string[];
}

function parseProdArgs(argv: readonly string[]): ParsedProdArgs {
  let apply = false;
  let confirmProductionRef: string | null = null;
  let expectedHistoryRows: number | null = null;
  let expectedEnrollments: number | null = null;
  let expectedLinkUpdates: number | null = null;
  let expectedCacheUpdates: number | null = null;
  const unknown: string[] = [];

  const takeStr = (arg: string, prefix: string): string | null => {
    const v = arg.slice(prefix.length).trim();
    return v.length > 0 ? v : null;
  };
  const takeInt = (arg: string, prefix: string): number | null => {
    const raw = arg.slice(prefix.length).trim();
    const n = raw.length === 0 ? Number.NaN : Number(raw);
    return Number.isInteger(n) && n >= 0 ? n : null;
  };

  for (const arg of argv) {
    if (arg === "--apply") {
      apply = true;
    } else if (arg.startsWith("--confirm-production=")) {
      confirmProductionRef = takeStr(arg, "--confirm-production=");
    } else if (arg.startsWith("--expected-history-rows=")) {
      expectedHistoryRows = takeInt(arg, "--expected-history-rows=");
    } else if (arg.startsWith("--expected-enrollments=")) {
      expectedEnrollments = takeInt(arg, "--expected-enrollments=");
    } else if (arg.startsWith("--expected-link-updates=")) {
      expectedLinkUpdates = takeInt(arg, "--expected-link-updates=");
    } else if (arg.startsWith("--expected-cache-updates=")) {
      expectedCacheUpdates = takeInt(arg, "--expected-cache-updates=");
    } else {
      unknown.push(arg);
    }
  }

  return {
    apply,
    confirmProductionRef,
    expectedHistoryRows,
    expectedEnrollments,
    expectedLinkUpdates,
    expectedCacheUpdates,
    unknown,
  };
}

async function main(): Promise<void> {
  const args = parseProdArgs(process.argv.slice(2));
  const target = identifyDbTarget(process.env.DATABASE_URL);

  console.log("=== MULTI-COURSE W8A-2 PRODUCTION horse enrollment backfill (APPLY) ===");
  // Redacted target only - never the connection string or credentials.
  console.log(`Database target: ${target.display}`);
  console.log(`--apply:         ${args.apply}`);

  if (args.unknown.length > 0) {
    console.error(`REFUSED: unrecognized argument(s): ${args.unknown.join(", ")}`);
    process.exitCode = 1;
    return;
  }

  // GATE 1: production confirmation guard. No DB connection exists yet, so no
  // write path is reachable before this passes.
  const guard = evaluateHorseProdApplyGuard({
    apply: args.apply,
    confirmProductionRef: args.confirmProductionRef,
    detectedRef: target.projectRef,
    detectedIsProduction: target.isProduction,
    expectedHistoryRows: args.expectedHistoryRows,
    expectedEnrollments: args.expectedEnrollments,
    expectedLinkUpdates: args.expectedLinkUpdates,
    expectedCacheUpdates: args.expectedCacheUpdates,
  });
  if (!guard.ok) {
    console.error("REFUSED: production apply confirmation failed:");
    for (const r of guard.reasons) console.error(`  - ${r}`);
    process.exitCode = 1;
    return;
  }
  const expected = guard.expected;
  console.log("Confirmation guard: PASSED (locked production ref + reviewed expected counts).");

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  try {
    // GATE 2: re-read the data, rebuild the plan, and require the reviewed
    // expected counts EXACTLY with zero anomalies - otherwise stop before writes.
    const now = new Date();
    const { plan } = await readHorseEnrollmentPlan(prisma, now);

    console.log("--- Pre-write plan (no writes performed) ---");
    console.log(`asOf: ${plan.summary.asOf}  offering: ${plan.summary.currentOfferingId}`);
    console.log(
      `history rows=${plan.summary.totalHistoryRows} enrollments=${plan.summary.totalEnrollments}`,
    );
    console.log(
      `link updates=${plan.summary.linkUpdatesRequired} cache updates=${plan.summary.cacheUpdatesRequired} ` +
        `anomalies=${plan.summary.anomalyTotal}`,
    );
    if (plan.anomalies.length > 0) {
      for (const line of formatHorseEnrollmentAnomalies(plan)) console.error(`  - ${line}`);
    }

    const planCheck = checkExpectedHorsePlan(plan.summary, expected);
    if (!planCheck.ok) {
      console.error("STOP: plan does not match the reviewed expected plan (NO writes):");
      for (const m of planCheck.mismatches) console.error(`  - ${m}`);
      process.exitCode = 1;
      return;
    }
    console.log("Expected-plan gate: PASSED (exact reviewed counts; zero anomalies).");

    // GATE PASSED -> perform the idempotent one-transaction writes.
    const result = await applyHorseEnrollmentBackfill(prisma, plan);
    console.log(`Writes: link updates=${result.linkUpdates} cache updates=${result.cacheUpdates}`);

    // GATE 3: post-write verification - a fresh plan must show full convergence.
    const { plan: after } = await readHorseEnrollmentPlan(prisma, now);
    const postCheck = checkHorsePostWrite(after.summary);

    // GATE 4: preservation - nothing created/deleted.
    const [historyRows, enrollments] = await Promise.all([
      prisma.traineeHorseAssignment.count(),
      prisma.courseEnrollment.count({ where: { courseOfferingId: plan.summary.currentOfferingId } }),
    ]);
    const preservationCheck = checkHorsePreservation({ historyRows, enrollments }, expected);

    console.log("\n--- Post-write verification ---");
    console.log(
      `remaining link updates=${after.summary.linkUpdatesRequired} ` +
        `cache updates=${after.summary.cacheUpdatesRequired} anomalies=${after.summary.anomalyTotal}`,
    );
    console.log(`history rows=${historyRows} enrollments=${enrollments}`);

    let failed = false;
    if (!postCheck.ok) {
      console.error("FAIL: post-write plan did not converge:");
      for (const m of postCheck.mismatches) console.error(`  - ${m}`);
      failed = true;
    }
    if (!preservationCheck.ok) {
      console.error("FAIL: history/enrollment counts changed (expected only UPDATEs):");
      for (const m of preservationCheck.mismatches) console.error(`  - ${m}`);
      failed = true;
    }

    if (failed) {
      process.exitCode = 1;
      console.error("\n--- FAILURE RECOVERY POLICY ---");
      console.error(FAILURE_RECOVERY_POLICY);
      console.error("PRODUCTION APPLY completed WITH FAILURES - review the mismatches above.");
    } else {
      console.log("\nPRODUCTION APPLY VERIFIED: links + enrollment caches written; all gates passed.");
    }
  } catch (error) {
    console.error("Production horse enrollment backfill failed.");
    console.error(error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
