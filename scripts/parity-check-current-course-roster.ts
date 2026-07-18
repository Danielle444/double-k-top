/**
 * MULTI-COURSE W5B0 - READ-ONLY parity check between the enrollment-backed
 * current-course roster and the legacy Student (isActive=true) roster.
 *
 * STRICTLY READ-ONLY: this script only ever calls count()/findMany() and the
 * read-only DAL helpers. It NEVER calls create/update/upsert/delete and NEVER
 * opens a write transaction. It exists to prove, before any pilot is wired
 * (W5B1), that the two roster sources agree.
 *
 * PRIVACY: it prints only safe internal ids, counts, and booleans. It NEVER
 * prints phone numbers, identity numbers, full names, DATABASE_URL, or
 * credentials. The database target is printed via the credential-free
 * identifyDbTarget() helper.
 *
 * Usage (DO NOT RUN in the W5B0 implementation stage):
 *   npx tsx scripts/parity-check-current-course-roster.ts
 *
 * Exit code: 0 when the two rosters match with zero anomalies; 1 otherwise.
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import {
  resolveCurrentCourseOffering,
  NoCurrentCourseOfferingError,
  AmbiguousCourseOfferingError,
  IncompleteCourseOfferingError,
} from "@/lib/course/current-offering";
import { getCurrentCourseEnrollmentRoster } from "@/lib/course/current-enrollments";
import { compareRosters, type LegacyRosterRow } from "@/lib/course/enrollment-view";
import { identifyDbTarget } from "./backfill-course-offering.plan";

/** Cap how many sample ids are printed per mismatch category (safe ids only). */
const SAMPLE_CAP = 10;

function printSample(label: string, ids: readonly string[]): void {
  if (ids.length === 0) return;
  const shown = ids.slice(0, SAMPLE_CAP).join(", ");
  const more = ids.length > SAMPLE_CAP ? ` (+${ids.length - SAMPLE_CAP} more)` : "";
  console.error(`  ${label}: ${shown}${more}`);
}

async function run(): Promise<void> {
  console.log("=== READ-ONLY PARITY CHECK: current-course roster (MULTI-COURSE W5B0) ===");
  const target = identifyDbTarget(process.env.DATABASE_URL);
  console.log(`Database target: ${target.display}`);

  // 1. Resolve the singleton current offering (and report the raw count).
  const offeringCount = await prisma.courseOffering.count();
  console.log(`CourseOffering count: ${offeringCount}`);

  let offeringId: string | null = null;
  try {
    const offering = await resolveCurrentCourseOffering();
    offeringId = offering.id;
    console.log(
      `Resolved current offering: id=${offering.id} level=${offering.level} status=${offering.status}`,
    );
  } catch (err) {
    if (err instanceof AmbiguousCourseOfferingError) {
      console.error(
        `RESOLVER: AMBIGUOUS - ${err.offeringIds.length} offerings (ids: ${err.offeringIds.join(", ")})`,
      );
    } else if (err instanceof NoCurrentCourseOfferingError) {
      console.error("RESOLVER: NONE - zero offerings exist");
    } else if (err instanceof IncompleteCourseOfferingError) {
      console.error(`RESOLVER: INCOMPLETE - offering ${err.offeringId} is missing start/end dates`);
    } else {
      console.error("RESOLVER: unexpected error (details suppressed to avoid leaking data)");
    }
  }

  if (offeringId === null) {
    console.error("PARITY RESULT: FAIL (no single current offering to compare against)");
    process.exitCode = 1;
    return;
  }

  // 2. Single captured asOf, then the enrollment-backed roster at that instant.
  const asOf = new Date();
  console.log(`asOf: ${asOf.toISOString()}`);
  const enrollmentRoster = await getCurrentCourseEnrollmentRoster(offeringId, { asOf });

  // 3. Legacy roster: Student where isActive=true, ordered EXACTLY as the real
  //    getStudentContacts() query orders (groupName, subgroupNumber, lastName) -
  //    no extra id tie-breaker - so the ordering observation compares against the
  //    true production baseline (PostgreSQL collation). Only safe fields are
  //    selected (no phone/identity).
  const legacy: LegacyRosterRow[] = await prisma.student.findMany({
    where: { isActive: true },
    orderBy: [{ groupName: "asc" }, { subgroupNumber: "asc" }, { lastName: "asc" }],
    select: { id: true, groupName: true, subgroupNumber: true, lastName: true },
  });

  // 4. Compare (pure) and report safe values only.
  const report = compareRosters(legacy, enrollmentRoster);

  console.log("--- parity report ---");
  console.log(`legacy active Student count:      ${report.legacyCount}`);
  console.log(`enrollment-backed active count:   ${report.enrollmentCount}`);
  console.log(`membership anomalies:             ${report.anomalyCount}`);
  console.log(`isPrimary rows (informational):   ${report.primaryCount}`);
  console.log(`missing from enrollment:          ${report.missingFromEnrollment.length}`);
  console.log(`extra in enrollment:              ${report.extraInEnrollment.length}`);
  console.log(`duplicate legacy ids:             ${report.duplicateLegacyIds.length}`);
  console.log(`duplicate enrollment ids:         ${report.duplicateEnrollmentIds.length}`);
  console.log(`group mismatches:                 ${report.groupMismatches.length}`);
  console.log(`subgroup mismatches:              ${report.subgroupMismatches.length}`);
  console.log(`status (non-ACTIVE) mismatches:   ${report.statusMismatches.length}`);

  if (!report.ok) {
    console.error("--- data-parity mismatch detail (safe ids only) ---");
    printSample("missingFromEnrollment", report.missingFromEnrollment);
    printSample("extraInEnrollment", report.extraInEnrollment);
    printSample("duplicateLegacyIds", report.duplicateLegacyIds);
    printSample("duplicateEnrollmentIds", report.duplicateEnrollmentIds);
    printSample("groupMismatches", report.groupMismatches);
    printSample("subgroupMismatches", report.subgroupMismatches);
    printSample("statusMismatches", report.statusMismatches);
    for (const anomaly of enrollmentRoster.anomalies.slice(0, SAMPLE_CAP)) {
      console.error(
        `  anomaly: kind=${anomaly.kind} enrollmentId=${anomaly.enrollmentId} ` +
          `studentId=${anomaly.studentId} currentMembershipCount=${anomaly.currentMembershipCount}`,
      );
    }
  }

  // Informational reference only - NOT a business rule of the DAL.
  console.log("--- expected current-production reference (informational only) ---");
  console.log(
    "offerings=1 enrollmentRoster=41 legacyRoster=41 anomalies=0 idDiffs=0 groupDiffs=0 subgroupDiffs=0 duplicateIds=0",
  );

  // Conclusion A: the HARD data-parity verdict (drives the exit code).
  console.log(`DATA PARITY RESULT: ${report.ok ? "PASS" : "FAIL"}`);

  // Conclusion B: ordering is an OBSERVATION only, never part of the verdict.
  // Legacy order comes from PostgreSQL collation; the enrollment roster is
  // ordered by JavaScript localeCompare("he"). A difference does NOT mean the
  // course data is wrong - it may be a collation-only divergence that a human
  // must review before the getStudentContacts pilot is wired (W5B1).
  if (report.orderMismatch) {
    console.log("ORDERING OBSERVATION: DIFFERENT");
    console.log(`  first divergence index: ${report.orderFirstDivergenceIndex}`);
    if (report.orderFirstDivergenceIndex !== null) {
      const i = report.orderFirstDivergenceIndex;
      const legacyId = i < legacy.length ? legacy[i].id : "(none)";
      const enrollmentId =
        i < enrollmentRoster.rows.length ? enrollmentRoster.rows[i].id : "(none)";
      console.log(`  legacy id at index:     ${legacyId}`);
      console.log(`  enrollment id at index: ${enrollmentId}`);
    }
    console.log(
      "  NOTE: may result from PostgreSQL-vs-JavaScript(he) collation; requires " +
        "human review before W5B1 wiring. Does NOT affect DATA PARITY RESULT.",
    );
  } else {
    console.log("ORDERING OBSERVATION: MATCH");
  }

  // Exit code follows DATA PARITY ONLY: 1 on data FAIL, 0 when data passes even
  // if ordering differs.
  process.exitCode = report.ok ? 0 : 1;
}

(async (): Promise<void> => {
  try {
    await run();
  } catch {
    console.error("READ-ONLY PARITY CHECK: fatal error (details suppressed to avoid leaking data)");
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();
