/**
 * MULTI-COURSE W1 - seed CourseOffering + enrollment backfill for the CURRENT
 * course.
 *
 * Turns the single existing course into the first multi-course row set:
 *   ActivityYear (2026)
 *     -> CourseOffering (the current instructors course, level 1)
 *          -> CourseEnrollment (one per existing Student)
 *          -> CourseGroup     (top-level = Student.groupName, sub = subgroupNumber)
 *          -> GroupMembership (one open interval per enrollment with a group)
 *
 * It NEVER touches Student rows (isActive/groupName/subgroupNumber/horse/
 * identity/contact are all read-only here), NEVER touches TraineeGroupMembership
 * /TraineeHorseAssignment, and NEVER modifies runtime readers/writers. All
 * mapping decisions live in the PURE, unit-tested helper module
 * backfill-course-offering.plan.ts; this file is only I/O + idempotent writes.
 *
 * SAFETY MODEL:
 *  - Default mode is DRY-RUN (performs no writes).
 *  - --apply performs writes; APPLY against the production project ref is
 *    REFUSED outright (no production-write mechanism exists in this stage).
 *  - DRY-RUN may read the production DB (read-only inspection only).
 *  - Idempotent: every entity is matched by a stable key and reused if present,
 *    so re-running never creates a duplicate ActivityYear/CourseOffering/
 *    CourseEnrollment/CourseGroup/GroupMembership.
 *  - The offering NAME is a REQUIRED explicit input (--offering-name); it is
 *    never invented and never hardcoded (the product's exact Hebrew course name
 *    is not a stable constant anywhere in the code/data).
 *  - Offering/enrollment dates and the membership effectiveFrom come ONLY from
 *    CourseSettings(id=1); no dates are invented. If CourseSettings is missing,
 *    the script stops.
 *
 * Usage (DRY-RUN):
 *   npx tsx scripts/backfill-course-offering.ts --offering-name="<Hebrew course name>"
 *
 * Usage (APPLY - refused against production; DO NOT run against production):
 *   npx tsx scripts/backfill-course-offering.ts --offering-name="<Hebrew course name>" --apply
 *
 * Optional flags:
 *   --activity-year-name=<name>   (default "2026" - the stable ActivityYear.name identity)
 *   --offering-level=<int>        (default 1 - the seed/current course level)
 */
import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  mapEnrollmentStatus,
  buildGroupPlan,
  reconcile,
  resolveEffectiveFrom,
  resolveOfferingReuse,
  toDateKeyUTC,
  identifyDbTarget,
  type RawStudent,
} from "./backfill-course-offering.plan";
// The APPLY write orchestration lives in a shared, side-effect-free module so
// the guarded production entrypoint reuses the SAME implementation (no
// duplicated business rules). This file keeps its DRY-RUN default and its
// hard REFUSAL of --apply against the production project ref (see main()).
import { applyBackfill } from "./backfill-course-offering.apply";

const USAGE =
  'Usage: tsx scripts/backfill-course-offering.ts --offering-name="<name>" ' +
  "[--offering-level=1] [--activity-year-name=2026] [--apply]";

interface ParsedArgs {
  apply: boolean;
  offeringName: string | null;
  offeringLevel: number;
  activityYearName: string;
  errors: string[];
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  let apply = false;
  let offeringName: string | null = null;
  let offeringLevel = 1;
  let activityYearName = "2026";
  const errors: string[] = [];

  for (const arg of argv) {
    if (arg === "--apply") {
      apply = true;
    } else if (arg.startsWith("--offering-name=")) {
      const v = arg.slice("--offering-name=".length).trim();
      offeringName = v.length > 0 ? v : null;
    } else if (arg.startsWith("--activity-year-name=")) {
      const v = arg.slice("--activity-year-name=".length).trim();
      if (v.length > 0) activityYearName = v;
    } else if (arg.startsWith("--offering-level=")) {
      const raw = arg.slice("--offering-level=".length);
      const n = Number(raw);
      if (!Number.isInteger(n) || n <= 0) {
        errors.push(`--offering-level must be a positive integer, got ${JSON.stringify(raw)}`);
      } else {
        offeringLevel = n;
      }
    } else {
      errors.push(`Unrecognized argument: ${arg}`);
    }
  }

  if (offeringName === null) {
    // Not inventing the product's course name: it must be supplied explicitly.
    errors.push(
      'Missing required --offering-name="<Hebrew course name>" (HOLD: the exact ' +
        "course name is a product value and is never invented by this script)",
    );
  }

  return { apply, offeringName, offeringLevel, activityYearName, errors };
}

// A @db.Date value round-trips through Prisma as a JS Date at UTC midnight;
// rebuild one from a validated YYYY-MM-DD key the same way, so the stored
// calendar date is never shifted by a local timezone.
function dateFromKey(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.errors.length > 0) {
    for (const e of args.errors) console.error(e);
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }
  const offeringName = args.offeringName as string;

  const mode = args.apply ? "APPLY (writes enabled)" : "DRY-RUN (no writes)";
  const target = identifyDbTarget(process.env.DATABASE_URL);

  console.log("=== MULTI-COURSE W1 seed offering backfill ===");
  console.log(`Execution mode:    ${mode}`);
  console.log(`Database target:   ${target.display}`);
  console.log(`ActivityYear name: ${args.activityYearName}`);
  console.log(`Offering name:     ${offeringName}`);
  console.log(`Offering level:    ${args.offeringLevel}`);

  // Production write guard - APPLY against production is refused outright. No
  // production-write approval mechanism is added in this stage by design.
  if (args.apply && target.isProduction) {
    console.error(
      "REFUSED: --apply targets the PRODUCTION project ref. Writing the seed " +
        "offering to production requires a later, explicitly-approved mechanism " +
        "that is intentionally NOT part of this stage. Aborting with no writes.",
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
    // --- Derive dates from CourseSettings(id=1) only (never invented). -------
    const settings = await prisma.courseSettings.findUnique({ where: { id: 1 } });
    if (!settings) {
      console.error(
        "STOP: CourseSettings(id=1) not found - the seed offering's start/end " +
          "dates and the membership effectiveFrom are derived from it and are " +
          "never invented. Configure course dates first.",
      );
      process.exitCode = 1;
      return;
    }
    const startKey = toDateKeyUTC(settings.startDate);
    const endKey = toDateKeyUTC(settings.endDate);
    const effectiveFromKey = resolveEffectiveFrom(startKey); // = course start
    const offeringStart = dateFromKey(startKey);
    const offeringEnd = dateFromKey(endKey);
    const effectiveFrom = dateFromKey(effectiveFromKey);
    console.log(`Course dates:      start=${startKey} end=${endKey}`);
    console.log(`Membership effectiveFrom (all seed intervals): ${effectiveFromKey}`);

    // --- Load students (ALL, including inactive) and plan groups. -----------
    const students: RawStudent[] = await prisma.student.findMany({
      select: { id: true, groupName: true, subgroupNumber: true, isActive: true },
    });
    const activeCount = students.filter((s) => s.isActive).length;
    const inactiveCount = students.length - activeCount;
    console.log(`Students inspected: ${students.length} (active=${activeCount}, inactive=${inactiveCount})`);

    const groupPlan = buildGroupPlan(students);
    console.log(
      `Distinct top-level groups: ${groupPlan.topGroups.length} ` +
        `[${groupPlan.topGroups.join(", ")}]`,
    );
    console.log(
      `Distinct subgroups:        ${groupPlan.subGroups.length} ` +
        `[${groupPlan.subGroups.map((s) => `${s.parentTop}/${s.name}`).join(", ")}]`,
    );
    console.log(`Students ungrouped (no group; no membership): ${groupPlan.ungrouped.length}`);
    if (groupPlan.invalid.length > 0) {
      console.log(`Students with INVALID group/subgroup (reported, NOT repaired, no membership): ${groupPlan.invalid.length}`);
      for (const inv of groupPlan.invalid) {
        console.log(`  - student ${inv.studentId}: ${inv.reason}`);
      }
    }

    if (args.apply) {
      await applyBackfill(prisma, {
        activityYearName: args.activityYearName,
        offeringName,
        offeringLevel: args.offeringLevel,
        offeringStart,
        offeringEnd,
        startKey,
        endKey,
        effectiveFrom,
        students,
        groupPlan,
      });
    } else {
      await dryRun(prisma, {
        activityYearName: args.activityYearName,
        offeringName,
        offeringLevel: args.offeringLevel,
        startKey,
        endKey,
        effectiveFrom,
        students,
        groupPlan,
      });
    }
  } catch (error) {
    console.error("Backfill failed.");
    console.error(error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

type Prisma = PrismaClient;
type GroupPlan = ReturnType<typeof buildGroupPlan>;

// --- DRY-RUN: report create/reuse decisions using the same existence checks --
// APPLY would use, but perform NO writes. -----------------------------------
async function dryRun(
  prisma: Prisma,
  ctx: {
    activityYearName: string;
    offeringName: string;
    offeringLevel: number;
    startKey: string;
    endKey: string;
    effectiveFrom: Date;
    students: RawStudent[];
    groupPlan: GroupPlan;
  },
): Promise<void> {
  console.log("\n--- DRY-RUN plan (no writes performed) ---");

  const year = await prisma.activityYear.findUnique({
    where: { name: ctx.activityYearName },
    select: { id: true },
  });
  console.log(`ActivityYear "${ctx.activityYearName}": ${year ? "REUSE (exists)" : "CREATE"}`);

  // Stable identity is (activityYearId, name); NEVER (activityYearId, level).
  // Query by the unique tuple and let the pure resolver decide create/reuse/stop.
  let offering: { id: string; name: string } | null = null;
  if (year) {
    const candidates = await prisma.courseOffering.findMany({
      where: { activityYearId: year.id, name: ctx.offeringName },
      select: { id: true, activityYearId: true, name: true, level: true, startDate: true, endDate: true },
    });
    const decision = resolveOfferingReuse(candidates, {
      activityYearId: year.id,
      name: ctx.offeringName,
      level: ctx.offeringLevel,
      startKey: ctx.startKey,
      endKey: ctx.endKey,
    });
    if (decision.action === "stop") {
      console.error(`STOP: ${decision.reason}`);
      process.exitCode = 1;
      console.log("--- DRY-RUN halted: offering identity conflict (no writes) ---");
      return;
    }
    if (decision.action === "reuse") {
      const found = candidates.find((c) => c.id === decision.offeringId);
      offering = found ? { id: found.id, name: found.name } : null;
      for (const w of decision.warnings) console.log(`  NOTE: ${w}`);
    }
  }
  if (offering) {
    console.log(`CourseOffering (name="${offering.name}"): REUSE (exact activityYearId+name match, level ${ctx.offeringLevel} verified)`);
  } else {
    console.log(`CourseOffering (name="${ctx.offeringName}"): CREATE (level ${ctx.offeringLevel})`);
  }

  // CourseGroups: existence is only meaningful once the offering exists.
  let topCreate = ctx.groupPlan.topGroups.length;
  let topReuse = 0;
  let subCreate = ctx.groupPlan.subGroups.length;
  let subReuse = 0;
  if (offering) {
    const existingTop = await prisma.courseGroup.findMany({
      where: { courseOfferingId: offering.id, parentGroupId: null },
      select: { name: true },
    });
    const topSet = new Set(existingTop.map((g) => g.name));
    const topRec = reconcile(ctx.groupPlan.topGroups, topSet);
    topCreate = topRec.toCreate.length;
    topReuse = topRec.toReuse.length;
    // Subgroups need their parent's id; count reuse where a matching (parent
    // name, sub name) already exists.
    subCreate = 0;
    subReuse = 0;
    for (const spec of ctx.groupPlan.subGroups) {
      const parent = await prisma.courseGroup.findFirst({
        where: { courseOfferingId: offering.id, parentGroupId: null, name: spec.parentTop },
        select: { id: true },
      });
      if (!parent) {
        subCreate++;
        continue;
      }
      const existing = await prisma.courseGroup.findFirst({
        where: { courseOfferingId: offering.id, parentGroupId: parent.id, name: spec.name },
        select: { id: true },
      });
      if (existing) subReuse++;
      else subCreate++;
    }
  }
  console.log(`CourseGroup top-level: create=${topCreate}, reuse=${topReuse}`);
  console.log(`CourseGroup subgroups: create=${subCreate}, reuse=${subReuse}`);

  // Enrollments + memberships.
  let enrCreate = 0;
  let enrReuse = 0;
  let enrConflict = 0;
  let memCreate = 0;
  let memReuse = 0;
  const membershipTargets = new Map(ctx.groupPlan.memberships.map((m) => [m.studentId, m.target]));
  for (const s of ctx.students) {
    let enrollment: { id: string; status: string; isPrimary: boolean } | null = null;
    if (offering) {
      enrollment = await prisma.courseEnrollment.findUnique({
        where: { studentId_courseOfferingId: { studentId: s.id, courseOfferingId: offering.id } },
        select: { id: true, status: true, isPrimary: true },
      });
    }
    const wantStatus = mapEnrollmentStatus(s.isActive);
    if (enrollment) {
      enrReuse++;
      if (enrollment.status !== wantStatus || !enrollment.isPrimary) enrConflict++;
    } else {
      enrCreate++;
    }
    // Membership create/reuse can only be resolved when the enrollment exists.
    const target = membershipTargets.get(s.id);
    if (target && enrollment) {
      const existingMem = await prisma.groupMembership.findUnique({
        where: {
          courseEnrollmentId_effectiveFrom: {
            courseEnrollmentId: enrollment.id,
            effectiveFrom: ctx.effectiveFrom,
          },
        },
        select: { id: true },
      });
      if (existingMem) memReuse++;
      else memCreate++;
    } else if (target) {
      memCreate++;
    }
  }
  console.log(`CourseEnrollment: create=${enrCreate}, reuse=${enrReuse}`);
  if (enrConflict > 0) {
    console.log(
      `  NOTE: ${enrConflict} existing enrollment(s) have a status/isPrimary that ` +
        `differs from the seed mapping (status<-isActive, isPrimary=true) - APPLY ` +
        `would reconcile these.`,
    );
  }
  console.log(`GroupMembership (initial interval): create=${memCreate}, reuse=${memReuse}`);
  console.log("--- End DRY-RUN plan (no writes performed) ---");
}

void main();
