import { prisma } from "@/lib/prisma";
import { dateKey, enumerateDateKeys, parseDateKey, weekKey } from "@/lib/dates";
import { formatSubgroupLabel, subgroupKey } from "@/lib/subgroup-identity";
import type { CourseDayPlan, DutyConstraint, Student } from "@/app/generated/prisma/client";

// Scoring weights - each tier must dominate the ones after it, so a student is
// never picked for a duty they already did this week just to save one point on
// the overall/total tiers. Random is a pure tiebreaker.
const WEEK_REPEAT_WEIGHT = 1_000_000;
const DUTY_OVERALL_REPEAT_WEIGHT = 10_000;
const TOTAL_ASSIGNMENTS_WEIGHT = 100;

interface StudentStats {
  totalAssignments: number;
  dutyOverallCount: Map<string, number>;
  dutyWeekCount: Map<string, Map<string, number>>;
}

export type GenerateMode = "fillMissing" | "regeneratePreserveManual" | "clearAndRegenerate";

export interface GenerateScheduleOptions {
  startDate: Date;
  endDate: Date;
  mode?: GenerateMode;
}

export interface GenerateScheduleResult {
  daysProcessed: number;
  assignedCount: number;
  warnings: string[];
}

function dayPlanSlotValue(dayPlan: CourseDayPlan, slot: DutyConstraint["slot"]): string | null {
  switch (slot) {
    case "FIRST_MORNING":
      return dayPlan.firstMorningGroup;
    case "SECOND_MORNING":
      return dayPlan.secondMorningGroup;
    case "FIRST_AFTER_LUNCH":
      return dayPlan.firstAfterLunchGroup;
    case "SECOND_AFTER_LUNCH":
      return dayPlan.secondAfterLunchGroup;
    default:
      return null;
  }
}

export async function generateSchedule({
  startDate,
  endDate,
  mode = "regeneratePreserveManual",
}: GenerateScheduleOptions): Promise<GenerateScheduleResult> {
  const dateKeys = enumerateDateKeys(startDate, endDate);
  const warnings: string[] = [];

  if (dateKeys.length === 0) {
    return { daysProcessed: 0, assignedCount: 0, warnings: ["טווח התאריכים ריק"] };
  }

  const [students, dutyTypes, allAssignments, availabilityRows, dayPlans, constraints, noDutyDates] =
    await Promise.all([
      prisma.student.findMany({ where: { isActive: true } }),
      prisma.dutyType.findMany({ where: { isActive: true } }),
      prisma.dutyAssignment.findMany(),
      prisma.studentAvailability.findMany({
        where: {
          date: {
            gte: parseDateKey(dateKeys[0]),
            lte: parseDateKey(dateKeys[dateKeys.length - 1]),
          },
        },
      }),
      prisma.courseDayPlan.findMany({
        where: {
          date: {
            gte: parseDateKey(dateKeys[0]),
            lte: parseDateKey(dateKeys[dateKeys.length - 1]),
          },
        },
      }),
      prisma.dutyConstraint.findMany({ where: { isActive: true } }),
      prisma.noDutyDate.findMany({
        where: {
          date: {
            gte: parseDateKey(dateKeys[0]),
            lte: parseDateKey(dateKeys[dateKeys.length - 1]),
          },
        },
      }),
    ]);

  const noDutyDateKeys = new Set(noDutyDates.map((n) => dateKey(n.date)));

  if (students.length === 0) {
    return { daysProcessed: 0, assignedCount: 0, warnings: ["אין תלמידים פעילים"] };
  }
  if (dutyTypes.length === 0) {
    return { daysProcessed: 0, assignedCount: 0, warnings: ["אין סוגי תורנות פעילים"] };
  }

  const studentById = new Map<string, Student>();
  for (const s of students) studentById.set(s.id, s);

  const onePerSubgroupDuties = dutyTypes.filter((d) => d.allocationMode === "ONE_PER_SUBGROUP");
  const fixedCountDuties = dutyTypes.filter((d) => d.allocationMode === "FIXED_COUNT");

  const availabilityMap = new Map<string, boolean>();
  for (const row of availabilityRows) {
    availabilityMap.set(`${row.studentId}|${dateKey(row.date)}`, row.isAvailable);
  }
  // A student with no explicit availability record is assumed available by default.
  function isAvailable(studentId: string, dk: string): boolean {
    return availabilityMap.get(`${studentId}|${dk}`) ?? true;
  }

  const dayPlanByDate = new Map<string, CourseDayPlan>();
  for (const dp of dayPlans) dayPlanByDate.set(dateKey(dp.date), dp);

  const constraintsByDutyType = new Map<string, DutyConstraint[]>();
  for (const c of constraints) {
    const list = constraintsByDutyType.get(c.dutyTypeId) ?? [];
    list.push(c);
    constraintsByDutyType.set(c.dutyTypeId, list);
  }

  // Students in a blocked group are removed from the candidate pool entirely
  // for this duty on this date - a hard filter, same tier as availability.
  function blockedGroupsFor(dk: string, dutyTypeId: string): Set<string> {
    const blocked = new Set<string>();
    const dayPlan = dayPlanByDate.get(dk);
    const rules = constraintsByDutyType.get(dutyTypeId);
    if (!dayPlan || !rules) return blocked;
    for (const rule of rules) {
      const group = dayPlanSlotValue(dayPlan, rule.slot);
      if (group) blocked.add(group);
    }
    return blocked;
  }

  const targetDateKeySet = new Set(dateKeys);

  const stats = new Map<string, StudentStats>();
  function getStats(studentId: string): StudentStats {
    let s = stats.get(studentId);
    if (!s) {
      s = {
        totalAssignments: 0,
        dutyOverallCount: new Map(),
        dutyWeekCount: new Map(),
      };
      stats.set(studentId, s);
    }
    return s;
  }
  function applyAssignment(studentId: string, dutyTypeId: string, dk: string) {
    const s = getStats(studentId);
    s.totalAssignments += 1;
    s.dutyOverallCount.set(dutyTypeId, (s.dutyOverallCount.get(dutyTypeId) ?? 0) + 1);
    const wk = weekKey(parseDateKey(dk));
    let weekMap = s.dutyWeekCount.get(wk);
    if (!weekMap) {
      weekMap = new Map();
      s.dutyWeekCount.set(wk, weekMap);
    }
    weekMap.set(dutyTypeId, (weekMap.get(dutyTypeId) ?? 0) + 1);
  }

  // Lower score = better candidate: avoid same duty this week ≫ avoid same
  // duty overall ≫ balance total assignments ≫ random tiebreaker.
  function scoreCandidates(candidates: Student[], dutyTypeId: string, wk: string) {
    const scored = candidates.map((s) => {
      const st = getStats(s.id);
      const weekCount = st.dutyWeekCount.get(wk)?.get(dutyTypeId) ?? 0;
      const overallDutyCount = st.dutyOverallCount.get(dutyTypeId) ?? 0;
      const score =
        weekCount * WEEK_REPEAT_WEIGHT +
        overallDutyCount * DUTY_OVERALL_REPEAT_WEIGHT +
        st.totalAssignments * TOTAL_ASSIGNMENTS_WEIGHT +
        Math.random();
      return { student: s, score };
    });
    scored.sort((a, b) => a.score - b.score);
    return scored;
  }

  // What happens to *existing* assignments in the target range before the
  // fill loop runs depends on the mode:
  // - regeneratePreserveManual: delete non-manual, keep manual as pre-filled.
  // - clearAndRegenerate: delete everything, nothing pre-filled.
  // - fillMissing: delete nothing, everything existing counts as pre-filled.
  const preFilledByDate = new Map<string, { studentId: string; dutyTypeId: string }[]>();
  const idsToDelete: string[] = [];

  for (const a of allAssignments) {
    const dk = dateKey(a.date);
    if (targetDateKeySet.has(dk)) {
      const keepAsPreFilled = mode === "fillMissing" || (mode === "regeneratePreserveManual" && a.isManual);
      if (keepAsPreFilled) {
        applyAssignment(a.studentId, a.dutyTypeId, dk);
        if (!preFilledByDate.has(dk)) preFilledByDate.set(dk, []);
        preFilledByDate.get(dk)!.push({ studentId: a.studentId, dutyTypeId: a.dutyTypeId });
      } else {
        idsToDelete.push(a.id);
      }
    } else {
      // History outside the regenerated range still counts toward fairness.
      applyAssignment(a.studentId, a.dutyTypeId, dk);
    }
  }

  if (idsToDelete.length > 0) {
    await prisma.dutyAssignment.deleteMany({ where: { id: { in: idsToDelete } } });
  }

  const fixedCountTotalDefault = fixedCountDuties.reduce((sum, d) => sum + d.defaultRequiredCount, 0);
  const toCreate: { date: Date; studentId: string; dutyTypeId: string }[] = [];

  for (const dk of dateKeys) {
    if (noDutyDateKeys.has(dk)) {
      warnings.push(`${dk}: יום זה מסומן כ"אין תורנויות ביום זה" - דילוג על ייצור שיבוץ אוטומטי`);
      continue;
    }

    const date = parseDateKey(dk);
    const wk = weekKey(date);
    const availableStudents = students.filter((s) => isAvailable(s.id, dk));

    if (availableStudents.length === 0) {
      warnings.push(`${dk}: אין תלמידים זמינים ביום זה`);
      continue;
    }

    const preFilledToday = preFilledByDate.get(dk) ?? [];
    const assignedTodaySet = new Set(preFilledToday.map((m) => m.studentId));
    const preFilledCountByDuty = new Map<string, number>();
    // Keyed by groupName+subgroupNumber (lib/subgroup-identity.ts), not
    // subgroupNumber alone - the same number repeats across different
    // groups (e.g. group א and group ב can each have a "subgroup 1"), so
    // subgroupNumber alone would wrongly treat those as one subgroup.
    const preFilledSubgroupsByDuty = new Map<string, Set<string>>();
    for (const m of preFilledToday) {
      preFilledCountByDuty.set(m.dutyTypeId, (preFilledCountByDuty.get(m.dutyTypeId) ?? 0) + 1);
      const student = studentById.get(m.studentId);
      if (student?.subgroupNumber != null) {
        const key = subgroupKey(student.groupName, student.subgroupNumber);
        if (!preFilledSubgroupsByDuty.has(m.dutyTypeId)) {
          preFilledSubgroupsByDuty.set(m.dutyTypeId, new Set());
        }
        preFilledSubgroupsByDuty.get(m.dutyTypeId)!.add(key);
      }
    }

    // --- ONE_PER_SUBGROUP duties go first, so "safety-style" duties get
    // priority pick of one representative per active subgroup before the
    // remaining students get proportionally split among fixed-count duties. ---
    const activeSubgroupMap = new Map<
      string,
      { groupName: string | null; subgroupNumber: number }
    >();
    for (const s of availableStudents) {
      if (s.subgroupNumber == null) continue;
      const key = subgroupKey(s.groupName, s.subgroupNumber);
      if (!activeSubgroupMap.has(key)) {
        activeSubgroupMap.set(key, { groupName: s.groupName, subgroupNumber: s.subgroupNumber });
      }
    }
    const activeSubgroups = Array.from(activeSubgroupMap.entries())
      .map(([key, value]) => ({ key, ...value }))
      .sort((a, b) => a.key.localeCompare(b.key));

    for (const dutyType of onePerSubgroupDuties) {
      const alreadyCovered = preFilledSubgroupsByDuty.get(dutyType.id) ?? new Set<string>();
      const blockedGroups = blockedGroupsFor(dk, dutyType.id);

      for (const subgroup of activeSubgroups) {
        if (alreadyCovered.has(subgroup.key)) continue;

        const candidates = students.filter(
          (s) =>
            s.groupName === subgroup.groupName &&
            s.subgroupNumber === subgroup.subgroupNumber &&
            isAvailable(s.id, dk) &&
            !assignedTodaySet.has(s.id) &&
            !(s.groupName && blockedGroups.has(s.groupName))
        );

        if (candidates.length === 0) {
          warnings.push(
            `${dk}: לא נמצא חניך זמין לתת־קבוצה ${formatSubgroupLabel(
              subgroup.groupName,
              subgroup.subgroupNumber
            )} עבור תורנות "${dutyType.name}"`
          );
          continue;
        }

        const [best] = scoreCandidates(candidates, dutyType.id, wk);
        assignedTodaySet.add(best.student.id);
        applyAssignment(best.student.id, dutyType.id, dk);
        toCreate.push({ date, studentId: best.student.id, dutyTypeId: dutyType.id });
      }
    }

    const remainingPool = availableStudents.filter((s) => !assignedTodaySet.has(s.id));
    if (remainingPool.length === 0 || fixedCountTotalDefault === 0) continue;

    // Preserve duty-type proportions when fewer students are available than
    // the full default requirement, using the largest-remainder method so the
    // rounded counts still add up exactly to the total slots to fill. The
    // ceiling is based on what's left after ONE_PER_SUBGROUP duties (and any
    // pre-filled/manual assignments) have already claimed their seats.
    const totalSlotsToFill = Math.min(fixedCountTotalDefault, remainingPool.length);
    const rawShares = fixedCountDuties.map(
      (d) => (d.defaultRequiredCount * totalSlotsToFill) / fixedCountTotalDefault
    );
    const floorShares = rawShares.map(Math.floor);
    let allocated = floorShares.reduce((a, b) => a + b, 0);
    const remainders = fixedCountDuties
      .map((_, i) => ({ i, r: rawShares[i] - floorShares[i] }))
      .sort((a, b) => b.r - a.r);
    let remainderIndex = 0;
    while (allocated < totalSlotsToFill && remainderIndex < remainders.length) {
      floorShares[remainders[remainderIndex].i] += 1;
      allocated += 1;
      remainderIndex += 1;
    }

    // Fill "hardest to fill" duty types first: a duty type blocked by an
    // active constraint today can only draw from a narrower pool (e.g. only
    // one group), so if an unconstrained duty type (open to everyone) goes
    // first and its fairness-based pick happens to take a student from that
    // narrower pool, the constrained duty type can come up short later even
    // though the totals would have worked out fine in a different order.
    // Priority: constrained-today first, then fewest eligible candidates,
    // then larger required count as a final tiebreak (previous behavior).
    function eligibleCandidateCount(dutyTypeId: string): number {
      const blocked = blockedGroupsFor(dk, dutyTypeId);
      return remainingPool.filter((s) => !(s.groupName && blocked.has(s.groupName))).length;
    }

    const dutyOrder = fixedCountDuties
      .map((d, i) => ({ dutyType: d, required: floorShares[i] }))
      .sort((a, b) => {
        const aBlocked = blockedGroupsFor(dk, a.dutyType.id).size > 0;
        const bBlocked = blockedGroupsFor(dk, b.dutyType.id).size > 0;
        if (aBlocked !== bBlocked) return aBlocked ? -1 : 1;

        const aCandidates = eligibleCandidateCount(a.dutyType.id);
        const bCandidates = eligibleCandidateCount(b.dutyType.id);
        if (aCandidates !== bCandidates) return aCandidates - bCandidates;

        return b.required - a.required;
      });

    for (const { dutyType, required: proportionalRequired } of dutyOrder) {
      const alreadyFilled = preFilledCountByDuty.get(dutyType.id) ?? 0;
      const autoRequired = Math.max(0, proportionalRequired - alreadyFilled);
      if (autoRequired === 0) continue;

      const blockedGroups = blockedGroupsFor(dk, dutyType.id);
      const candidates = remainingPool.filter(
        (s) =>
          !assignedTodaySet.has(s.id) && !(s.groupName && blockedGroups.has(s.groupName))
      );
      const scored = scoreCandidates(candidates, dutyType.id, wk);
      const picked = scored.slice(0, autoRequired);
      if (picked.length < autoRequired) {
        warnings.push(
          `${dk}: נדרשו ${autoRequired} תלמידים נוספים לתורנות "${dutyType.name}" אך נמצאו רק ${picked.length} זמינים (לאחר החלת אילוצים)`
        );
      }

      for (const { student } of picked) {
        assignedTodaySet.add(student.id);
        applyAssignment(student.id, dutyType.id, dk);
        toCreate.push({ date, studentId: student.id, dutyTypeId: dutyType.id });
      }
    }
  }

  if (toCreate.length > 0) {
    await prisma.dutyAssignment.createMany({
      data: toCreate.map((a) => ({ ...a, isManual: false })),
    });
  }

  return { daysProcessed: dateKeys.length, assignedCount: toCreate.length, warnings };
}
