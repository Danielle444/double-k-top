/**
 * MULTI-COURSE - shared, side-effect-free write orchestration for the seed
 * CourseOffering backfill.
 *
 * This module exists so the SINGLE implementation of the backfill's DB-write
 * logic (and its pre-write existence audit) is reused by BOTH runners without
 * duplication:
 *   - scripts/backfill-course-offering.ts          (DRY-RUN default; APPLY is
 *                                                    REFUSED against production)
 *   - scripts/backfill-course-offering.prod-apply.ts (guarded production-only
 *                                                    APPLY entrypoint)
 *
 * It has NO top-level execution (importing it never connects to a DB, never
 * writes, never reads argv/env), so both a runner and a test can import it
 * safely. All MAPPING/CLASSIFICATION business rules live in the PURE, unit-
 * tested module backfill-course-offering.plan.ts and are imported here; this
 * module only performs the I/O that turns a plan into rows.
 *
 * Nothing here ever touches Student rows, TraineeGroupMembership, or
 * TraineeHorseAssignment - it only creates ActivityYear/CourseOffering/
 * CourseGroup/CourseEnrollment/GroupMembership rows, idempotently.
 */
import type { PrismaClient } from "../app/generated/prisma/client";
import {
  mapEnrollmentStatus,
  resolveOfferingReuse,
  type GroupPlan,
  type MembershipTarget,
  type RawStudent,
} from "./backfill-course-offering.plan";

type Prisma = PrismaClient;

/**
 * Composite key for the in-memory subgroup id map, keyed by (parentTop, name).
 * The separator is a NUL ("\0") byte - a character that cannot appear in a real
 * group name - so the key stays injective. SINGLE source of the separator so the
 * `set` (spine phase) and `get` (membership phase) can never diverge. Pure.
 */
export function subGroupKey(parentTop: string, name: string): string {
  return `${parentTop}\0${name}`;
}

/** Everything the write/audit steps need, already resolved from I/O. */
export interface ApplyContext {
  activityYearName: string;
  offeringName: string;
  offeringLevel: number;
  offeringStart: Date;
  offeringEnd: Date;
  startKey: string;
  endKey: string;
  effectiveFrom: Date;
  students: RawStudent[];
  groupPlan: GroupPlan;
}

/** The create/reuse counts of a pre-write existence audit (no writes done). */
export interface PreWriteAudit {
  /** 0 = the ActivityYear already exists (reuse), 1 = it would be created. */
  activityYearCreate: number;
  /** 0 = the offering already exists (reuse), 1 = it would be created. */
  offeringCreate: number;
  topCreate: number;
  topReuse: number;
  subCreate: number;
  subReuse: number;
  enrollmentCreate: number;
  enrollmentReuse: number;
  membershipCreate: number;
  membershipReuse: number;
  /** groupPlan.invalid.length (reported, never repaired). */
  invalid: number;
  /** groupPlan.ungrouped.length (no membership). */
  ungrouped: number;
  /** Non-null iff resolveOfferingReuse said STOP (identity conflict). */
  offeringConflict: string | null;
}

/** Structured outcome of applyBackfill, for callers that verify afterwards. */
export interface ApplyResult {
  offeringId: string;
  yearCreated: boolean;
  offeringCreated: boolean;
  offeringWarnings: string[];
  topCreated: number;
  topReused: number;
  subCreated: number;
  subReused: number;
  enrCreated: number;
  enrReused: number;
  enrReconciled: number;
  memCreated: number;
  memReused: number;
  failures: number;
}

/**
 * Read-only pre-write audit: resolve, without writing anything, how many
 * ActivityYear/CourseOffering/CourseGroup/CourseEnrollment/GroupMembership rows
 * an APPLY would CREATE vs REUSE. All decisions use the PURE planner
 * (resolveOfferingReuse) + the already-built groupPlan, so no business rule is
 * re-implemented here. Performs SELECTs only.
 */
export async function computePreWriteAudit(
  prisma: Prisma,
  ctx: ApplyContext,
): Promise<PreWriteAudit> {
  const year = await prisma.activityYear.findUnique({
    where: { name: ctx.activityYearName },
    select: { id: true },
  });
  const activityYearCreate = year ? 0 : 1;

  // Stable identity is (activityYearId, name); NEVER (activityYearId, level).
  let offering: { id: string } | null = null;
  let offeringConflict: string | null = null;
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
      offeringConflict = decision.reason;
    } else if (decision.action === "reuse") {
      offering = { id: decision.offeringId };
    }
  }
  const offeringCreate = offering ? 0 : 1;

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
    topCreate = 0;
    topReuse = 0;
    for (const name of ctx.groupPlan.topGroups) {
      if (topSet.has(name)) topReuse++;
      else topCreate++;
    }
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

  // Enrollments + memberships.
  let enrollmentCreate = 0;
  let enrollmentReuse = 0;
  let membershipCreate = 0;
  let membershipReuse = 0;
  const membershipTargets = new Map(ctx.groupPlan.memberships.map((m) => [m.studentId, m.target]));
  for (const s of ctx.students) {
    let enrollment: { id: string } | null = null;
    if (offering) {
      enrollment = await prisma.courseEnrollment.findUnique({
        where: { studentId_courseOfferingId: { studentId: s.id, courseOfferingId: offering.id } },
        select: { id: true },
      });
    }
    if (enrollment) enrollmentReuse++;
    else enrollmentCreate++;

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
      if (existingMem) membershipReuse++;
      else membershipCreate++;
    } else if (target) {
      membershipCreate++;
    }
  }

  return {
    activityYearCreate,
    offeringCreate,
    topCreate,
    topReuse,
    subCreate,
    subReuse,
    enrollmentCreate,
    enrollmentReuse,
    membershipCreate,
    membershipReuse,
    invalid: ctx.groupPlan.invalid.length,
    ungrouped: ctx.groupPlan.ungrouped.length,
    offeringConflict,
  };
}

/**
 * APPLY: idempotent writes. Spine (year/offering/groups) in one small tx; each
 * student's enrollment+membership in its own small tx so no single huge fragile
 * transaction is created and partial progress is safely resumable. Returns the
 * structured result; on any per-student failure it ALSO sets process.exitCode=1
 * (preserving the existing runner's behaviour) so a caller that ignores the
 * return value still fails.
 */
export async function applyBackfill(prisma: Prisma, ctx: ApplyContext): Promise<ApplyResult> {
  console.log("\n--- APPLY: writing seed offering (idempotent) ---");

  // Phase 1: spine (bounded, small) in a single transaction.
  const spine = await prisma.$transaction(
    async (tx) => {
      // ActivityYear by stable unique name.
      let year = await tx.activityYear.findUnique({ where: { name: ctx.activityYearName } });
      let yearCreated = false;
      if (!year) {
        year = await tx.activityYear.create({ data: { name: ctx.activityYearName } });
        yearCreated = true;
      }

      // CourseOffering stable identity is (activityYearId, name), enforced by
      // @@unique([activityYearId, name]). NEVER match by (activityYearId, level):
      // a year may hold >1 offering at the same level. Query the unique tuple and
      // let the pure resolver decide create/reuse/stop; on any conflict it throws
      // and this transaction rolls back (year create included) with no writes.
      const candidates = await tx.courseOffering.findMany({
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
        throw new Error(decision.reason);
      }
      let offering: { id: string; name: string };
      let offeringCreated = false;
      const offeringWarnings = decision.action === "reuse" ? decision.warnings : [];
      if (decision.action === "create") {
        const created = await tx.courseOffering.create({
          data: {
            activityYearId: year.id,
            name: ctx.offeringName,
            level: ctx.offeringLevel,
            startDate: ctx.offeringStart,
            endDate: ctx.offeringEnd,
            status: "ACTIVE",
          },
          select: { id: true, name: true },
        });
        offering = created;
        offeringCreated = true;
      } else {
        const found = candidates.find((c) => c.id === decision.offeringId);
        if (!found) throw new Error("internal: resolved offering id not present in candidates");
        // Identity (year, name, level) verified by the resolver; nothing on the
        // existing row is overwritten - date drift is reported, not repaired.
        offering = { id: found.id, name: found.name };
      }

      // CourseGroups: top-level first, then subgroups (need parent ids).
      const topIdByName = new Map<string, string>();
      let topCreated = 0;
      let topReused = 0;
      for (const name of ctx.groupPlan.topGroups) {
        let g = await tx.courseGroup.findFirst({
          where: { courseOfferingId: offering.id, parentGroupId: null, name },
        });
        if (!g) {
          g = await tx.courseGroup.create({
            data: { courseOfferingId: offering.id, parentGroupId: null, name },
          });
          topCreated++;
        } else {
          topReused++;
        }
        topIdByName.set(name, g.id);
      }

      const subIdByKey = new Map<string, string>();
      let subCreated = 0;
      let subReused = 0;
      for (const spec of ctx.groupPlan.subGroups) {
        const parentId = topIdByName.get(spec.parentTop);
        if (!parentId) throw new Error(`internal: missing parent group ${spec.parentTop}`);
        let g = await tx.courseGroup.findFirst({
          where: { courseOfferingId: offering.id, parentGroupId: parentId, name: spec.name },
        });
        if (!g) {
          g = await tx.courseGroup.create({
            data: { courseOfferingId: offering.id, parentGroupId: parentId, name: spec.name },
          });
          subCreated++;
        } else {
          subReused++;
        }
        subIdByKey.set(subGroupKey(spec.parentTop, spec.name), g.id);
      }

      return {
        year,
        yearCreated,
        offering,
        offeringCreated,
        offeringWarnings,
        topIdByName,
        subIdByKey,
        topCreated,
        topReused,
        subCreated,
        subReused,
      };
    },
    { timeout: 60000 },
  );

  console.log(`ActivityYear "${ctx.activityYearName}": ${spine.yearCreated ? "CREATED" : "reused"}`);
  console.log(
    `CourseOffering level ${ctx.offeringLevel}: ${spine.offeringCreated ? "CREATED" : "reused"} ` +
      `(name="${spine.offering.name}")`,
  );
  for (const w of spine.offeringWarnings) {
    console.log(`  NOTE: ${w}`);
  }
  console.log(`CourseGroup top-level: created=${spine.topCreated}, reused=${spine.topReused}`);
  console.log(`CourseGroup subgroups: created=${spine.subCreated}, reused=${spine.subReused}`);

  // Phase 2: enrollments + memberships, one small transaction per student.
  const resolveTargetGroupId = (target: MembershipTarget): string => {
    if (target.kind === "top") {
      const id = spine.topIdByName.get(target.top);
      if (!id) throw new Error(`internal: missing top group ${target.top}`);
      return id;
    }
    const id = spine.subIdByKey.get(subGroupKey(target.top, target.sub));
    if (!id) throw new Error(`internal: missing sub group ${target.top}/${target.sub}`);
    return id;
  };
  const membershipTargets = new Map(ctx.groupPlan.memberships.map((m) => [m.studentId, m.target]));

  let enrCreated = 0;
  let enrReused = 0;
  let enrReconciled = 0;
  let memCreated = 0;
  let memReused = 0;
  let failures = 0;

  for (const s of ctx.students) {
    const wantStatus = mapEnrollmentStatus(s.isActive);
    const target = membershipTargets.get(s.id) ?? null;
    const groupId = target ? resolveTargetGroupId(target) : null;
    try {
      await prisma.$transaction(async (tx) => {
        let enrollment = await tx.courseEnrollment.findUnique({
          where: {
            studentId_courseOfferingId: { studentId: s.id, courseOfferingId: spine.offering.id },
          },
        });
        if (!enrollment) {
          enrollment = await tx.courseEnrollment.create({
            data: {
              studentId: s.id,
              courseOfferingId: spine.offering.id,
              status: wantStatus,
              startDate: ctx.offeringStart,
              endDate: ctx.offeringEnd,
              isPrimary: true, // only seed enrollment per student (decision 10)
            },
          });
          enrCreated++;
        } else {
          enrReused++;
          // Reconcile the seed invariants without inventing anything else.
          if (enrollment.status !== wantStatus || !enrollment.isPrimary) {
            await tx.courseEnrollment.update({
              where: { id: enrollment.id },
              data: { status: wantStatus, isPrimary: true },
            });
            enrReconciled++;
          }
        }

        if (groupId) {
          const existingMem = await tx.groupMembership.findUnique({
            where: {
              courseEnrollmentId_effectiveFrom: {
                courseEnrollmentId: enrollment.id,
                effectiveFrom: ctx.effectiveFrom,
              },
            },
          });
          if (!existingMem) {
            await tx.groupMembership.create({
              data: {
                courseEnrollmentId: enrollment.id,
                courseGroupId: groupId,
                effectiveFrom: ctx.effectiveFrom,
                effectiveTo: null,
              },
            });
            memCreated++;
          } else {
            memReused++;
          }
        }
      });
    } catch (err) {
      failures++;
      console.error(`  FAILED for student ${s.id} (other students unaffected):`, err);
    }
  }

  console.log(`CourseEnrollment: created=${enrCreated}, reused=${enrReused}, reconciled=${enrReconciled}`);
  console.log(`GroupMembership (initial interval): created=${memCreated}, reused=${memReused}`);
  if (failures > 0) {
    console.error(`Per-student failures: ${failures} (idempotent - safe to re-run to resume).`);
    process.exitCode = 1;
  }

  // Final verification counts scoped to this offering.
  const [enrTotal, grpTotal, memTotal] = await Promise.all([
    prisma.courseEnrollment.count({ where: { courseOfferingId: spine.offering.id } }),
    prisma.courseGroup.count({ where: { courseOfferingId: spine.offering.id } }),
    prisma.groupMembership.count({ where: { courseEnrollment: { courseOfferingId: spine.offering.id } } }),
  ]);
  console.log("\n--- Verification counts (this offering) ---");
  console.log(`CourseEnrollment total: ${enrTotal}`);
  console.log(`CourseGroup total:      ${grpTotal}`);
  console.log(`GroupMembership total:  ${memTotal}`);
  console.log("--- End APPLY ---");

  return {
    offeringId: spine.offering.id,
    yearCreated: spine.yearCreated,
    offeringCreated: spine.offeringCreated,
    offeringWarnings: spine.offeringWarnings,
    topCreated: spine.topCreated,
    topReused: spine.topReused,
    subCreated: spine.subCreated,
    subReused: spine.subReused,
    enrCreated,
    enrReused,
    enrReconciled,
    memCreated,
    memReused,
    failures,
  };
}
