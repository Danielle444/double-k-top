/**
 * MULTI-COURSE W4 - PRODUCTION-ONLY seed CourseOffering backfill APPLY.
 *
 * This is the smallest, separately-reviewed entrypoint that actually writes the
 * seed offering to PRODUCTION. It reuses - never re-implements - the tested
 * logic:
 *   - all MAPPING/CLASSIFICATION rules: backfill-course-offering.plan.ts (pure)
 *   - the pre-write audit + idempotent write: backfill-course-offering.apply.ts
 *   - the production confirmation + verification gates:
 *     backfill-course-offering.prod-apply.plan.ts (pure)
 *
 * It is deliberately NOT the dev runner: the dev runner
 * (backfill-course-offering.ts) REFUSES --apply against production and that
 * guard is untouched. This entrypoint is the ONLY place a production write can
 * originate, and it does so only after EVERY gate below passes:
 *
 *   1. Confirmation guard - requires --apply, --confirm-production=<ref>,
 *      --offering-name, --activity-year-name, --offering-level, each exactly
 *      equal to the locked seed identity, AND the detected DATABASE_URL ref must
 *      equal the locked production ref and agree with --confirm-production.
 *      Prisma is not even constructed until this passes.
 *   2. Expected-plan gate - the re-run pre-write audit must match the locked
 *      plan exactly (all creates, zero reuse, zero invalid/ungrouped). Any
 *      deviation stops BEFORE a single write.
 *   3. Post-write verification - the created spine must match the expected
 *      counts exactly.
 *   4. Preservation verification - Student / TraineeGroupMembership /
 *      TraineeHorseAssignment counts must be exactly unchanged.
 *
 * Any failed gate exits non-zero. Credentials and PII are never printed (only
 * the redacted DB target). The underlying writes are idempotent and use the
 * existing per-student transaction strategy.
 *
 * Usage (DO NOT RUN until explicitly approved):
 *   npx tsx scripts/backfill-course-offering.prod-apply.ts \
 *     --apply \
 *     --confirm-production=yjnjfnesxhmzhzpwrmqy \
 *     --offering-name="קורס מדריכים ומאמנים – רמה 1" \
 *     --activity-year-name=2026 \
 *     --offering-level=1
 */
import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  buildGroupPlan,
  identifyDbTarget,
  resolveEffectiveFrom,
  toDateKeyUTC,
  type RawStudent,
} from "./backfill-course-offering.plan";
import { applyBackfill, computePreWriteAudit, type ApplyContext } from "./backfill-course-offering.apply";
import {
  checkExpectedPlan,
  checkPostWriteCounts,
  checkPreservationCounts,
  evaluateProductionApplyGuard,
  PARTIAL_FAILURE_RECOVERY_POLICY,
} from "./backfill-course-offering.prod-apply.plan";

interface ParsedProdArgs {
  apply: boolean;
  confirmProductionRef: string | null;
  offeringName: string | null;
  activityYearName: string | null;
  offeringLevel: number | null;
  unknown: string[];
}

function parseProdArgs(argv: readonly string[]): ParsedProdArgs {
  let apply = false;
  let confirmProductionRef: string | null = null;
  let offeringName: string | null = null;
  let activityYearName: string | null = null;
  let offeringLevel: number | null = null;
  const unknown: string[] = [];

  const take = (arg: string, prefix: string): string | null => {
    const v = arg.slice(prefix.length).trim();
    return v.length > 0 ? v : null;
  };

  for (const arg of argv) {
    if (arg === "--apply") {
      apply = true;
    } else if (arg.startsWith("--confirm-production=")) {
      confirmProductionRef = take(arg, "--confirm-production=");
    } else if (arg.startsWith("--offering-name=")) {
      offeringName = take(arg, "--offering-name=");
    } else if (arg.startsWith("--activity-year-name=")) {
      activityYearName = take(arg, "--activity-year-name=");
    } else if (arg.startsWith("--offering-level=")) {
      const raw = take(arg, "--offering-level=");
      const n = raw === null ? Number.NaN : Number(raw);
      offeringLevel = Number.isInteger(n) && n > 0 ? n : null;
    } else {
      unknown.push(arg);
    }
  }

  return { apply, confirmProductionRef, offeringName, activityYearName, offeringLevel, unknown };
}

// A @db.Date value round-trips through Prisma as a JS Date at UTC midnight;
// rebuild one from a validated YYYY-MM-DD key the same way (mirrors the dev
// runner), so the stored calendar date is never shifted by a local timezone.
function dateFromKey(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

async function main(): Promise<void> {
  const args = parseProdArgs(process.argv.slice(2));
  const target = identifyDbTarget(process.env.DATABASE_URL);

  console.log("=== MULTI-COURSE W4 PRODUCTION seed offering backfill (APPLY) ===");
  // Redacted target only - never the connection string or credentials.
  console.log(`Database target:   ${target.display}`);
  console.log(`--apply:           ${args.apply}`);

  if (args.unknown.length > 0) {
    console.error(`REFUSED: unrecognized argument(s): ${args.unknown.join(", ")}`);
    process.exitCode = 1;
    return;
  }

  // GATE 1: production confirmation guard. No DB connection exists yet, so no
  // write path is reachable before this passes.
  const guard = evaluateProductionApplyGuard({
    apply: args.apply,
    confirmProductionRef: args.confirmProductionRef,
    detectedRef: target.projectRef,
    detectedIsProduction: target.isProduction,
    offeringName: args.offeringName,
    activityYearName: args.activityYearName,
    offeringLevel: args.offeringLevel,
  });
  if (!guard.ok) {
    console.error("REFUSED: production apply confirmation failed:");
    for (const r of guard.reasons) console.error(`  - ${r}`);
    process.exitCode = 1;
    return;
  }

  // Past this point all confirmations matched the locked seed identity, so these
  // are safe non-null values.
  const offeringName = args.offeringName as string;
  const activityYearName = args.activityYearName as string;
  const offeringLevel = args.offeringLevel as number;

  console.log("Confirmation guard: PASSED (locked production ref + seed identity all matched).");

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  try {
    // Derive dates from CourseSettings(id=1) only (never invented) - same source
    // and rules as the dev runner.
    const settings = await prisma.courseSettings.findUnique({ where: { id: 1 } });
    if (!settings) {
      console.error(
        "STOP: CourseSettings(id=1) not found - the seed offering dates and the " +
          "membership effectiveFrom derive from it and are never invented.",
      );
      process.exitCode = 1;
      return;
    }
    const startKey = toDateKeyUTC(settings.startDate);
    const endKey = toDateKeyUTC(settings.endDate);
    const effectiveFromKey = resolveEffectiveFrom(startKey); // = course start

    const students: RawStudent[] = await prisma.student.findMany({
      select: { id: true, groupName: true, subgroupNumber: true, isActive: true },
    });
    const activeCount = students.filter((s) => s.isActive).length;
    const groupPlan = buildGroupPlan(students);

    const ctx: ApplyContext = {
      activityYearName,
      offeringName,
      offeringLevel,
      offeringStart: dateFromKey(startKey),
      offeringEnd: dateFromKey(endKey),
      startKey,
      endKey,
      effectiveFrom: dateFromKey(effectiveFromKey),
      students,
      groupPlan,
    };

    console.log(`Course dates:      start=${startKey} end=${endKey}`);
    console.log(`Students inspected: ${students.length} (active=${activeCount}, inactive=${students.length - activeCount})`);

    // GATE 2: re-run the full pre-write planning audit and require the locked
    // expected plan EXACTLY - otherwise stop before any write.
    const audit = await computePreWriteAudit(prisma, ctx);
    console.log("--- Pre-write audit (no writes performed) ---");
    console.log(
      `ActivityYear create=${audit.activityYearCreate}, CourseOffering create=${audit.offeringCreate}`,
    );
    console.log(`top-level create=${audit.topCreate} reuse=${audit.topReuse}`);
    console.log(`subgroup create=${audit.subCreate} reuse=${audit.subReuse}`);
    console.log(`enrollment create=${audit.enrollmentCreate} reuse=${audit.enrollmentReuse}`);
    console.log(`membership create=${audit.membershipCreate} reuse=${audit.membershipReuse}`);
    console.log(`invalid=${audit.invalid} ungrouped=${audit.ungrouped}`);

    const planCheck = checkExpectedPlan(audit);
    if (!planCheck.ok) {
      console.error("STOP: pre-write plan does not match the locked expected plan (NO writes):");
      for (const m of planCheck.mismatches) console.error(`  - ${m}`);
      process.exitCode = 1;
      return;
    }
    console.log("Expected-plan gate: PASSED (exact locked plan; zero reuse).");

    // GATE PASSED -> perform the idempotent writes (shared implementation,
    // per-student transaction strategy preserved). Phase 1 (spine) is atomic;
    // Phase 2 is one transaction per student. On a PARTIAL Phase 2 failure this
    // script performs NO auto-resume and NO auto-cleanup - the reuse=0 gate above
    // deliberately blocks any retry until the target offering's partial rows are
    // manually cleaned. See PARTIAL_FAILURE_RECOVERY_POLICY (printed below on
    // failure) for the exact manual runbook.
    const result = await applyBackfill(prisma, ctx);

    // GATE 3: post-write verification, scoped to the created seed offering.
    const [activityYear, offering, enrollment, topGroups, subGroups, membership] = await Promise.all([
      prisma.activityYear.count({ where: { name: activityYearName } }),
      prisma.courseOffering.count({ where: { activityYear: { name: activityYearName }, name: offeringName } }),
      prisma.courseEnrollment.count({ where: { courseOfferingId: result.offeringId } }),
      prisma.courseGroup.count({ where: { courseOfferingId: result.offeringId, parentGroupId: null } }),
      prisma.courseGroup.count({ where: { courseOfferingId: result.offeringId, parentGroupId: { not: null } } }),
      prisma.groupMembership.count({ where: { courseEnrollment: { courseOfferingId: result.offeringId } } }),
    ]);
    const postCheck = checkPostWriteCounts({
      activityYear,
      offering,
      enrollment,
      topGroups,
      subGroups,
      membership,
    });

    // GATE 4: existing source data must be exactly preserved.
    const [student, traineeGroupMembership, traineeHorseAssignment] = await Promise.all([
      prisma.student.count(),
      prisma.traineeGroupMembership.count(),
      prisma.traineeHorseAssignment.count(),
    ]);
    const preservationCheck = checkPreservationCounts({
      student,
      traineeGroupMembership,
      traineeHorseAssignment,
    });

    console.log("\n--- Post-write verification (seed offering) ---");
    console.log(`ActivityYear=${activityYear} CourseOffering=${offering} CourseEnrollment=${enrollment}`);
    console.log(`top-level CourseGroups=${topGroups} subgroup CourseGroups=${subGroups} GroupMembership=${membership}`);
    console.log("--- Existing-data preservation ---");
    console.log(
      `Student=${student} TraineeGroupMembership=${traineeGroupMembership} TraineeHorseAssignment=${traineeHorseAssignment}`,
    );

    let failed = false;
    if (result.failures > 0) {
      console.error(`FAIL: ${result.failures} per-student write failure(s).`);
      console.error("\n--- PARTIAL-FAILURE RECOVERY POLICY (no automatic cleanup performed) ---");
      console.error(PARTIAL_FAILURE_RECOVERY_POLICY);
      failed = true;
    }
    if (!postCheck.ok) {
      console.error("FAIL: post-write counts do not match expected:");
      for (const m of postCheck.mismatches) console.error(`  - ${m}`);
      failed = true;
    }
    if (!preservationCheck.ok) {
      console.error("FAIL: existing source-data counts changed (expected untouched):");
      for (const m of preservationCheck.mismatches) console.error(`  - ${m}`);
      failed = true;
    }

    if (failed) {
      process.exitCode = 1;
      console.error("PRODUCTION APPLY completed WITH FAILURES - review the mismatches above.");
    } else {
      console.log("\nPRODUCTION APPLY VERIFIED: seed offering written and all gates passed.");
    }
  } catch (error) {
    console.error("Production backfill failed.");
    console.error(error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
