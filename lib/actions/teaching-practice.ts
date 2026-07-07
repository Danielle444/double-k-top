"use server";

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/require-admin";
import { dateKey, parseDateKey } from "@/lib/dates";
import type { ActionResult } from "@/lib/actions/students";
import {
  computeTeachingPracticeRotation,
  TEACHING_PRACTICE_TEAM_SIZE,
  type TeachingPracticeRoleValue,
  type TeachingPracticeTypeValue,
} from "@/lib/teaching-practice-rotation";

export type { TeachingPracticeRoleValue, TeachingPracticeTypeValue };

const NOT_FOUND_TRACK = "מסלול ההתנסות לא נמצא";
const NOT_FOUND_LESSON = "שיעור ההתנסות לא נמצא";
const NOT_FOUND_CHILD = "הילד/ה לא נמצא/ת";
const NO_ASSIGNMENT_PERMISSION = "אין הרשאה לניהול שיבוצי התנסויות הדרכה";
const NO_HORSE_PERMISSION = "אין הרשאה לניהול סוסים וציוד להתנסויות הדרכה";

const VALID_PRACTICE_TYPES: TeachingPracticeTypeValue[] = ["LUNGE", "BEGINNER_PRIVATE", "BEGINNER_GROUP"];
const VALID_ROLES: TeachingPracticeRoleValue[] = [
  "LEAD_INSTRUCTOR",
  "SECOND_INSTRUCTOR",
  "ASSISTANT_INSTRUCTOR",
  "EVALUATOR",
];

// Students have no NextAuth session in this app, so ownership/permission is
// always re-verified by re-reading the instructor row and its
// canManageTeachingPracticeAssignments flag - same convention as
// upsertRidingLessonNoteAsInstructor. Shared by every "assignments"-gated
// write action below; the two dual-permission actions (track/lesson child
// fields) inline their own check instead, since they also need to inspect
// canManageTeachingPracticeHorses conditionally.
async function getInstructorForAssignmentWrite(instructorId: string) {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  if (!instructor || !instructor.isActive || !instructor.canManageTeachingPracticeAssignments) {
    return null;
  }
  return instructor;
}

function horseFieldsChanged(
  prevHorseName: string | null,
  prevEquipmentNotes: string | null,
  nextHorseName: string | null,
  nextEquipmentNotes: string | null
): boolean {
  return prevHorseName !== nextHorseName || prevEquipmentNotes !== nextEquipmentNotes;
}

// ---------------------------------------------------------------------------
// Tracks - read
// ---------------------------------------------------------------------------

export interface TeachingPracticeTrackTraineeRow {
  traineeId: string;
  fullName: string;
  groupName: string | null;
  subgroupNumber: number | null;
  rotationOrder: number;
}

export interface TeachingPracticeTrackChildRow {
  childId: string;
  fullName: string;
  isActive: boolean;
  horseName: string | null;
  equipmentNotes: string | null;
}

export interface TeachingPracticeTrackSummary {
  id: string;
  practiceType: TeachingPracticeTypeValue;
  groupName: string | null;
  weekday: number | null;
  defaultStartTime: string;
  defaultEndTime: string;
  defaultLocation: string | null;
  defaultResponsibleInstructorId: string | null;
  defaultResponsibleInstructorName: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  trainees: TeachingPracticeTrackTraineeRow[];
  children: TeachingPracticeTrackChildRow[];
  lessonCount: number;
}

const TRACK_INCLUDE = {
  defaultResponsibleInstructor: { select: { fullName: true } },
  trainees: {
    orderBy: { rotationOrder: "asc" as const },
    include: { trainee: { select: { fullName: true, groupName: true, subgroupNumber: true } } },
  },
  children: {
    include: { child: { select: { fullName: true, isActive: true } } },
  },
  _count: { select: { lessons: true } },
};

type TrackWithIncludes = Awaited<
  ReturnType<typeof prisma.teachingPracticeTrack.findFirstOrThrow<{ include: typeof TRACK_INCLUDE }>>
>;

function toTrackSummary(track: TrackWithIncludes): TeachingPracticeTrackSummary {
  return {
    id: track.id,
    practiceType: track.practiceType,
    groupName: track.groupName,
    weekday: track.weekday,
    defaultStartTime: track.defaultStartTime,
    defaultEndTime: track.defaultEndTime,
    defaultLocation: track.defaultLocation,
    defaultResponsibleInstructorId: track.defaultResponsibleInstructorId,
    defaultResponsibleInstructorName: track.defaultResponsibleInstructor?.fullName ?? null,
    notes: track.notes,
    isActive: track.isActive,
    createdAt: track.createdAt.toISOString(),
    updatedAt: track.updatedAt.toISOString(),
    trainees: track.trainees.map((t) => ({
      traineeId: t.traineeId,
      fullName: t.trainee.fullName,
      groupName: t.trainee.groupName,
      subgroupNumber: t.trainee.subgroupNumber,
      rotationOrder: t.rotationOrder,
    })),
    children: track.children.map((c) => ({
      childId: c.childId,
      fullName: c.child.fullName,
      isActive: c.child.isActive,
      horseName: c.horseName,
      equipmentNotes: c.equipmentNotes,
    })),
    lessonCount: track._count.lessons,
  };
}

async function listTeachingPracticeTracksInternal(): Promise<TeachingPracticeTrackSummary[]> {
  const tracks = await prisma.teachingPracticeTrack.findMany({
    include: TRACK_INCLUDE,
    orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
  });
  return tracks.map(toTrackSummary);
}

export async function listTeachingPracticeTracksForAdmin(): Promise<TeachingPracticeTrackSummary[]> {
  await requireAdmin();
  return listTeachingPracticeTracksInternal();
}

// All active instructors can view every track, regardless of permission
// flags - matches "view always unrestricted, edit gated" (e.g.
// getRidingSlotStudentNotes).
export async function listTeachingPracticeTracksForInstructor(
  instructorId: string
): Promise<TeachingPracticeTrackSummary[]> {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  if (!instructor || !instructor.isActive) return [];
  return listTeachingPracticeTracksInternal();
}

// ---------------------------------------------------------------------------
// Tracks - create / update / activate
// ---------------------------------------------------------------------------

export interface TeachingPracticeTrackInput {
  practiceType: TeachingPracticeTypeValue;
  groupName?: string | null;
  weekday?: number | null;
  defaultStartTime: string;
  defaultEndTime: string;
  defaultLocation?: string | null;
  defaultResponsibleInstructorId?: string | null;
  notes?: string | null;
}

export interface TeachingPracticeTrackActionResult extends ActionResult {
  trackId?: string;
}

function validateTrackInput(
  input: TeachingPracticeTrackInput
):
  | { error: string }
  | {
      data: {
        practiceType: TeachingPracticeTypeValue;
        groupName: string | null;
        weekday: number | null;
        defaultStartTime: string;
        defaultEndTime: string;
        defaultLocation: string | null;
        notes: string | null;
      };
    } {
  if (!VALID_PRACTICE_TYPES.includes(input.practiceType)) {
    return { error: "סוג התנסות לא תקין" };
  }
  const defaultStartTime = input.defaultStartTime?.trim();
  const defaultEndTime = input.defaultEndTime?.trim();
  if (!defaultStartTime) return { error: "יש להזין שעת התחלה" };
  if (!defaultEndTime) return { error: "יש להזין שעת סיום" };
  if (
    input.weekday != null &&
    (!Number.isInteger(input.weekday) || input.weekday < 0 || input.weekday > 6)
  ) {
    return { error: "יום בשבוע לא תקין" };
  }

  return {
    data: {
      practiceType: input.practiceType,
      groupName: input.groupName?.trim() || null,
      weekday: input.weekday ?? null,
      defaultStartTime,
      defaultEndTime,
      defaultLocation: input.defaultLocation?.trim() || null,
      notes: input.notes?.trim() || null,
    },
  };
}

// Re-checked fresh from the DB on every call (never trusted from the input)
// - a responsible instructor must be a real, currently-active Instructor.
async function validateResponsibleInstructor(
  responsibleInstructorId: string | null | undefined
): Promise<{ error: string } | { id: string | null }> {
  if (!responsibleInstructorId) return { id: null };
  const instructor = await prisma.instructor.findUnique({ where: { id: responsibleInstructorId } });
  if (!instructor || !instructor.isActive) {
    return { error: "המדריך/ה האחראי/ת שנבחר/ה לא נמצא/ת או אינו/ה פעיל/ה" };
  }
  return { id: instructor.id };
}

async function createTeachingPracticeTrackInternal(
  input: TeachingPracticeTrackInput
): Promise<TeachingPracticeTrackActionResult> {
  const validated = validateTrackInput(input);
  if ("error" in validated) return { success: false, error: validated.error };

  const responsible = await validateResponsibleInstructor(input.defaultResponsibleInstructorId);
  if ("error" in responsible) return { success: false, error: responsible.error };

  const track = await prisma.teachingPracticeTrack.create({
    data: { ...validated.data, defaultResponsibleInstructorId: responsible.id },
  });

  return { success: true, trackId: track.id };
}

export async function createTeachingPracticeTrackAsAdmin(
  input: TeachingPracticeTrackInput
): Promise<TeachingPracticeTrackActionResult> {
  await requireAdmin();
  return createTeachingPracticeTrackInternal(input);
}

export async function createTeachingPracticeTrackAsInstructor(
  instructorId: string,
  input: TeachingPracticeTrackInput
): Promise<TeachingPracticeTrackActionResult> {
  const instructor = await getInstructorForAssignmentWrite(instructorId);
  if (!instructor) return { success: false, error: NO_ASSIGNMENT_PERMISSION };
  return createTeachingPracticeTrackInternal(input);
}

async function updateTeachingPracticeTrackInternal(
  trackId: string,
  input: TeachingPracticeTrackInput
): Promise<ActionResult> {
  const track = await prisma.teachingPracticeTrack.findUnique({ where: { id: trackId } });
  if (!track) return { success: false, error: NOT_FOUND_TRACK };

  const validated = validateTrackInput(input);
  if ("error" in validated) return { success: false, error: validated.error };

  const responsible = await validateResponsibleInstructor(input.defaultResponsibleInstructorId);
  if ("error" in responsible) return { success: false, error: responsible.error };

  await prisma.teachingPracticeTrack.update({
    where: { id: trackId },
    data: { ...validated.data, defaultResponsibleInstructorId: responsible.id },
  });

  return { success: true };
}

export async function updateTeachingPracticeTrackAsAdmin(
  trackId: string,
  input: TeachingPracticeTrackInput
): Promise<ActionResult> {
  await requireAdmin();
  return updateTeachingPracticeTrackInternal(trackId, input);
}

export async function updateTeachingPracticeTrackAsInstructor(
  instructorId: string,
  trackId: string,
  input: TeachingPracticeTrackInput
): Promise<ActionResult> {
  const instructor = await getInstructorForAssignmentWrite(instructorId);
  if (!instructor) return { success: false, error: NO_ASSIGNMENT_PERMISSION };
  return updateTeachingPracticeTrackInternal(trackId, input);
}

async function setTeachingPracticeTrackActiveInternal(
  trackId: string,
  isActive: boolean
): Promise<ActionResult> {
  const track = await prisma.teachingPracticeTrack.findUnique({ where: { id: trackId } });
  if (!track) return { success: false, error: NOT_FOUND_TRACK };
  await prisma.teachingPracticeTrack.update({ where: { id: trackId }, data: { isActive } });
  return { success: true };
}

export async function setTeachingPracticeTrackActiveAsAdmin(
  trackId: string,
  isActive: boolean
): Promise<ActionResult> {
  await requireAdmin();
  return setTeachingPracticeTrackActiveInternal(trackId, isActive);
}

export async function setTeachingPracticeTrackActiveAsInstructor(
  instructorId: string,
  trackId: string,
  isActive: boolean
): Promise<ActionResult> {
  const instructor = await getInstructorForAssignmentWrite(instructorId);
  if (!instructor) return { success: false, error: NO_ASSIGNMENT_PERMISSION };
  return setTeachingPracticeTrackActiveInternal(trackId, isActive);
}

// ---------------------------------------------------------------------------
// Track trainee team management (replace-all)
// ---------------------------------------------------------------------------

async function setTeachingPracticeTrackTraineesInternal(
  trackId: string,
  traineeIdsInRotationOrder: string[]
): Promise<ActionResult> {
  const track = await prisma.teachingPracticeTrack.findUnique({ where: { id: trackId } });
  if (!track) return { success: false, error: NOT_FOUND_TRACK };

  const uniqueIds = new Set(traineeIdsInRotationOrder);
  if (uniqueIds.size !== traineeIdsInRotationOrder.length) {
    return { success: false, error: "לא ניתן לשבץ אותו חניך/ה יותר מפעם אחת בצוות" };
  }

  const expectedSize = TEACHING_PRACTICE_TEAM_SIZE[track.practiceType];
  if (traineeIdsInRotationOrder.length !== expectedSize) {
    return {
      success: false,
      error:
        track.practiceType === "BEGINNER_GROUP"
          ? "התנסות הדרכה קבוצתית לחניכי מתחילים דורשת בדיוק 3 חניכים בצוות"
          : "התנסות זו דורשת בדיוק 2 חניכים בצוות",
    };
  }

  if (traineeIdsInRotationOrder.length > 0) {
    const trainees = await prisma.student.findMany({
      where: { id: { in: traineeIdsInRotationOrder } },
    });
    if (trainees.length !== traineeIdsInRotationOrder.length) {
      return { success: false, error: "אחד או יותר מהחניכים שנבחרו לא נמצאו" };
    }
    if (trainees.some((t) => !t.isActive)) {
      return { success: false, error: "לא ניתן לשבץ חניך/ה שאינו/ה פעיל/ה" };
    }
  }

  await prisma.$transaction([
    prisma.teachingPracticeTrackTrainee.deleteMany({ where: { trackId } }),
    prisma.teachingPracticeTrackTrainee.createMany({
      data: traineeIdsInRotationOrder.map((traineeId, index) => ({
        trackId,
        traineeId,
        rotationOrder: index,
      })),
    }),
  ]);

  return { success: true };
}

export async function setTeachingPracticeTrackTraineesAsAdmin(
  trackId: string,
  traineeIdsInRotationOrder: string[]
): Promise<ActionResult> {
  await requireAdmin();
  return setTeachingPracticeTrackTraineesInternal(trackId, traineeIdsInRotationOrder);
}

export async function setTeachingPracticeTrackTraineesAsInstructor(
  instructorId: string,
  trackId: string,
  traineeIdsInRotationOrder: string[]
): Promise<ActionResult> {
  const instructor = await getInstructorForAssignmentWrite(instructorId);
  if (!instructor) return { success: false, error: NO_ASSIGNMENT_PERMISSION };
  return setTeachingPracticeTrackTraineesInternal(trackId, traineeIdsInRotationOrder);
}

// ---------------------------------------------------------------------------
// Track children / default horse+equipment management (replace-all)
// ---------------------------------------------------------------------------

export interface TeachingPracticeTrackChildInput {
  childId: string;
  horseName?: string | null;
  equipmentNotes?: string | null;
}

async function setTeachingPracticeTrackChildrenInternal(
  trackId: string,
  children: TeachingPracticeTrackChildInput[]
): Promise<ActionResult> {
  const track = await prisma.teachingPracticeTrack.findUnique({ where: { id: trackId } });
  if (!track) return { success: false, error: NOT_FOUND_TRACK };

  const uniqueChildIds = new Set(children.map((c) => c.childId));
  if (uniqueChildIds.size !== children.length) {
    return { success: false, error: "לא ניתן לשבץ אותו ילד/ה יותר מפעם אחת" };
  }

  if (children.length > 0) {
    const foundChildren = await prisma.teachingPracticeChild.findMany({
      where: { id: { in: children.map((c) => c.childId) } },
    });
    if (foundChildren.length !== children.length) {
      return { success: false, error: "אחד או יותר מהילדים שנבחרו לא נמצאו" };
    }
    if (foundChildren.some((c) => !c.isActive)) {
      return { success: false, error: "לא ניתן לשבץ ילד/ה שאינו/ה פעיל/ה" };
    }
  }

  await prisma.$transaction([
    prisma.teachingPracticeTrackChild.deleteMany({ where: { trackId } }),
    prisma.teachingPracticeTrackChild.createMany({
      data: children.map((c) => ({
        trackId,
        childId: c.childId,
        horseName: c.horseName?.trim() || null,
        equipmentNotes: c.equipmentNotes?.trim() || null,
      })),
    }),
  ]);

  return { success: true };
}

export async function setTeachingPracticeTrackChildrenAsAdmin(
  trackId: string,
  children: TeachingPracticeTrackChildInput[]
): Promise<ActionResult> {
  await requireAdmin();
  return setTeachingPracticeTrackChildrenInternal(trackId, children);
}

// Child linkage itself needs canManageTeachingPracticeAssignments; the
// horseName/equipmentNotes fields specifically need
// canManageTeachingPracticeHorses too - checked by diffing against what's
// currently stored, so an instructor without the horse permission can still
// freely change *which* children are on the track as long as they leave
// every row's horse/equipment values exactly as they were.
export async function setTeachingPracticeTrackChildrenAsInstructor(
  instructorId: string,
  trackId: string,
  children: TeachingPracticeTrackChildInput[]
): Promise<ActionResult> {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  if (!instructor || !instructor.isActive || !instructor.canManageTeachingPracticeAssignments) {
    return { success: false, error: NO_ASSIGNMENT_PERMISSION };
  }

  if (!instructor.canManageTeachingPracticeHorses) {
    const existing = await prisma.teachingPracticeTrackChild.findMany({ where: { trackId } });
    const existingByChildId = new Map(existing.map((e) => [e.childId, e]));
    const changesHorseFields = children.some((c) => {
      const prev = existingByChildId.get(c.childId);
      const nextHorseName = c.horseName?.trim() || null;
      const nextEquipmentNotes = c.equipmentNotes?.trim() || null;
      return horseFieldsChanged(
        prev?.horseName ?? null,
        prev?.equipmentNotes ?? null,
        nextHorseName,
        nextEquipmentNotes
      );
    });
    if (changesHorseFields) return { success: false, error: NO_HORSE_PERMISSION };
  }

  return setTeachingPracticeTrackChildrenInternal(trackId, children);
}

// ---------------------------------------------------------------------------
// External children - CRUD
// ---------------------------------------------------------------------------

export interface TeachingPracticeChildInput {
  firstName: string;
  lastName: string;
  age?: number | null;
  gender?: string | null;
  parentName?: string | null;
  parentPhone?: string | null;
  notes?: string | null;
  defaultHorseName?: string | null;
}

export interface TeachingPracticeChildRow {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  age: number | null;
  gender: string | null;
  parentName: string | null;
  parentPhone: string | null;
  notes: string | null;
  defaultHorseName: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TeachingPracticeChildActionResult extends ActionResult {
  childId?: string;
}

function toChildRow(child: {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  age: number | null;
  gender: string | null;
  parentName: string | null;
  parentPhone: string | null;
  notes: string | null;
  defaultHorseName: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}): TeachingPracticeChildRow {
  return {
    id: child.id,
    firstName: child.firstName,
    lastName: child.lastName,
    fullName: child.fullName,
    age: child.age,
    gender: child.gender,
    parentName: child.parentName,
    parentPhone: child.parentPhone,
    notes: child.notes,
    defaultHorseName: child.defaultHorseName,
    isActive: child.isActive,
    createdAt: child.createdAt.toISOString(),
    updatedAt: child.updatedAt.toISOString(),
  };
}

async function listTeachingPracticeChildrenInternal(): Promise<TeachingPracticeChildRow[]> {
  const children = await prisma.teachingPracticeChild.findMany({ orderBy: { fullName: "asc" } });
  return children.map(toChildRow);
}

export async function listTeachingPracticeChildrenForAdmin(): Promise<TeachingPracticeChildRow[]> {
  await requireAdmin();
  return listTeachingPracticeChildrenInternal();
}

export async function listTeachingPracticeChildrenForInstructor(
  instructorId: string
): Promise<TeachingPracticeChildRow[]> {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  if (!instructor || !instructor.isActive) return [];
  return listTeachingPracticeChildrenInternal();
}

function validateChildInput(
  input: TeachingPracticeChildInput
):
  | { error: string }
  | {
      data: {
        firstName: string;
        lastName: string;
        fullName: string;
        age: number | null;
        gender: string | null;
        parentName: string | null;
        parentPhone: string | null;
        notes: string | null;
        defaultHorseName: string | null;
      };
    } {
  const firstName = input.firstName?.trim();
  const lastName = input.lastName?.trim();
  if (!firstName) return { error: "יש להזין שם פרטי" };
  if (!lastName) return { error: "יש להזין שם משפחה" };
  if (input.age != null && (!Number.isInteger(input.age) || input.age < 0 || input.age > 120)) {
    return { error: "גיל לא תקין" };
  }

  return {
    data: {
      firstName,
      lastName,
      fullName: `${firstName} ${lastName}`.trim(),
      age: input.age ?? null,
      gender: input.gender?.trim() || null,
      parentName: input.parentName?.trim() || null,
      parentPhone: input.parentPhone?.trim() || null,
      notes: input.notes?.trim() || null,
      defaultHorseName: input.defaultHorseName?.trim() || null,
    },
  };
}

async function createTeachingPracticeChildInternal(
  input: TeachingPracticeChildInput
): Promise<TeachingPracticeChildActionResult> {
  const validated = validateChildInput(input);
  if ("error" in validated) return { success: false, error: validated.error };
  const child = await prisma.teachingPracticeChild.create({ data: validated.data });
  return { success: true, childId: child.id };
}

export async function createTeachingPracticeChildAsAdmin(
  input: TeachingPracticeChildInput
): Promise<TeachingPracticeChildActionResult> {
  await requireAdmin();
  return createTeachingPracticeChildInternal(input);
}

// Base identity/contact fields need canManageTeachingPracticeAssignments;
// setting defaultHorseName at creation time additionally needs
// canManageTeachingPracticeHorses.
export async function createTeachingPracticeChildAsInstructor(
  instructorId: string,
  input: TeachingPracticeChildInput
): Promise<TeachingPracticeChildActionResult> {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  if (!instructor || !instructor.isActive || !instructor.canManageTeachingPracticeAssignments) {
    return { success: false, error: NO_ASSIGNMENT_PERMISSION };
  }
  if (input.defaultHorseName?.trim() && !instructor.canManageTeachingPracticeHorses) {
    return { success: false, error: NO_HORSE_PERMISSION };
  }
  return createTeachingPracticeChildInternal(input);
}

async function updateTeachingPracticeChildInternal(
  childId: string,
  input: TeachingPracticeChildInput
): Promise<ActionResult> {
  const child = await prisma.teachingPracticeChild.findUnique({ where: { id: childId } });
  if (!child) return { success: false, error: NOT_FOUND_CHILD };

  const validated = validateChildInput(input);
  if ("error" in validated) return { success: false, error: validated.error };

  await prisma.teachingPracticeChild.update({ where: { id: childId }, data: validated.data });
  return { success: true };
}

export async function updateTeachingPracticeChildAsAdmin(
  childId: string,
  input: TeachingPracticeChildInput
): Promise<ActionResult> {
  await requireAdmin();
  return updateTeachingPracticeChildInternal(childId, input);
}

export async function updateTeachingPracticeChildAsInstructor(
  instructorId: string,
  childId: string,
  input: TeachingPracticeChildInput
): Promise<ActionResult> {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  if (!instructor || !instructor.isActive || !instructor.canManageTeachingPracticeAssignments) {
    return { success: false, error: NO_ASSIGNMENT_PERMISSION };
  }

  if (!instructor.canManageTeachingPracticeHorses) {
    const child = await prisma.teachingPracticeChild.findUnique({ where: { id: childId } });
    if (!child) return { success: false, error: NOT_FOUND_CHILD };
    const nextDefaultHorseName = input.defaultHorseName?.trim() || null;
    if (child.defaultHorseName !== nextDefaultHorseName) {
      return { success: false, error: NO_HORSE_PERMISSION };
    }
  }

  return updateTeachingPracticeChildInternal(childId, input);
}

async function setTeachingPracticeChildActiveInternal(
  childId: string,
  isActive: boolean
): Promise<ActionResult> {
  const child = await prisma.teachingPracticeChild.findUnique({ where: { id: childId } });
  if (!child) return { success: false, error: NOT_FOUND_CHILD };
  await prisma.teachingPracticeChild.update({ where: { id: childId }, data: { isActive } });
  return { success: true };
}

export async function setTeachingPracticeChildActiveAsAdmin(
  childId: string,
  isActive: boolean
): Promise<ActionResult> {
  await requireAdmin();
  return setTeachingPracticeChildActiveInternal(childId, isActive);
}

export async function setTeachingPracticeChildActiveAsInstructor(
  instructorId: string,
  childId: string,
  isActive: boolean
): Promise<ActionResult> {
  const instructor = await getInstructorForAssignmentWrite(instructorId);
  if (!instructor) return { success: false, error: NO_ASSIGNMENT_PERMISSION };
  return setTeachingPracticeChildActiveInternal(childId, isActive);
}

// ---------------------------------------------------------------------------
// Lessons - read
// ---------------------------------------------------------------------------

export interface TeachingPracticeLessonSummary {
  id: string;
  trackId: string | null;
  practiceType: TeachingPracticeTypeValue;
  date: string;
  startTime: string;
  endTime: string;
  groupName: string | null;
  location: string | null;
  responsibleInstructorId: string | null;
  responsibleInstructorName: string | null;
  notes: string | null;
  isPublished: boolean;
  participantCount: number;
  childCount: number;
}

export interface TeachingPracticeParticipantRow {
  participantId: string;
  traineeId: string;
  traineeName: string;
  role: TeachingPracticeRoleValue;
  isManualOverride: boolean;
}

export interface TeachingPracticeChildAssignmentRow {
  id: string;
  childId: string;
  childFullName: string;
  childAge: number | null;
  parentName: string | null;
  parentPhone: string | null;
  horseName: string | null;
  equipmentNotes: string | null;
  isAbsent: boolean;
}

export interface TeachingPracticeLessonDetail extends TeachingPracticeLessonSummary {
  participants: TeachingPracticeParticipantRow[];
  childAssignments: TeachingPracticeChildAssignmentRow[];
}

export interface TeachingPracticeLessonFilters {
  dateFrom?: string;
  dateTo?: string;
  groupName?: string;
  practiceType?: TeachingPracticeTypeValue;
  isPublished?: boolean;
}

interface LessonBase {
  id: string;
  trackId: string | null;
  practiceType: TeachingPracticeTypeValue;
  date: Date;
  startTime: string;
  endTime: string;
  groupName: string | null;
  location: string | null;
  responsibleInstructorId: string | null;
  notes: string | null;
  isPublished: boolean;
}

function toLessonSummary(
  lesson: LessonBase & {
    responsibleInstructor: { fullName: string } | null;
    participantCount: number;
    childCount: number;
  }
): TeachingPracticeLessonSummary {
  return {
    id: lesson.id,
    trackId: lesson.trackId,
    practiceType: lesson.practiceType,
    date: dateKey(lesson.date),
    startTime: lesson.startTime,
    endTime: lesson.endTime,
    groupName: lesson.groupName,
    location: lesson.location,
    responsibleInstructorId: lesson.responsibleInstructorId,
    responsibleInstructorName: lesson.responsibleInstructor?.fullName ?? null,
    notes: lesson.notes,
    isPublished: lesson.isPublished,
    participantCount: lesson.participantCount,
    childCount: lesson.childCount,
  };
}

async function listTeachingPracticeLessonsInternal(
  filters?: TeachingPracticeLessonFilters
): Promise<TeachingPracticeLessonSummary[]> {
  const lessons = await prisma.teachingPracticeLesson.findMany({
    where: {
      ...(filters?.dateFrom || filters?.dateTo
        ? {
            date: {
              ...(filters?.dateFrom ? { gte: parseDateKey(filters.dateFrom) } : {}),
              ...(filters?.dateTo ? { lte: parseDateKey(filters.dateTo) } : {}),
            },
          }
        : {}),
      ...(filters?.groupName ? { groupName: filters.groupName } : {}),
      ...(filters?.practiceType ? { practiceType: filters.practiceType } : {}),
      ...(filters?.isPublished != null ? { isPublished: filters.isPublished } : {}),
    },
    include: {
      responsibleInstructor: { select: { fullName: true } },
      _count: { select: { participants: true, childAssignments: true } },
    },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
  });

  return lessons.map((lesson) =>
    toLessonSummary({
      ...lesson,
      participantCount: lesson._count.participants,
      childCount: lesson._count.childAssignments,
    })
  );
}

export async function listTeachingPracticeLessonsForAdmin(
  filters?: TeachingPracticeLessonFilters
): Promise<TeachingPracticeLessonSummary[]> {
  await requireAdmin();
  return listTeachingPracticeLessonsInternal(filters);
}

export async function listTeachingPracticeLessonsForInstructor(
  instructorId: string,
  filters?: TeachingPracticeLessonFilters
): Promise<TeachingPracticeLessonSummary[]> {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  if (!instructor || !instructor.isActive) return [];
  return listTeachingPracticeLessonsInternal(filters);
}

const LESSON_DETAIL_INCLUDE = {
  responsibleInstructor: { select: { fullName: true } },
  participants: {
    orderBy: { createdAt: "asc" as const },
    include: { trainee: { select: { fullName: true } } },
  },
  childAssignments: {
    include: { child: { select: { fullName: true, age: true, parentName: true, parentPhone: true } } },
  },
};

type LessonWithDetailIncludes = Awaited<
  ReturnType<typeof prisma.teachingPracticeLesson.findFirstOrThrow<{ include: typeof LESSON_DETAIL_INCLUDE }>>
>;

function toLessonDetail(lesson: LessonWithDetailIncludes): TeachingPracticeLessonDetail {
  return {
    ...toLessonSummary({
      ...lesson,
      participantCount: lesson.participants.length,
      childCount: lesson.childAssignments.length,
    }),
    participants: lesson.participants.map((p) => ({
      participantId: p.id,
      traineeId: p.traineeId,
      traineeName: p.trainee.fullName,
      role: p.role,
      isManualOverride: p.isManualOverride,
    })),
    childAssignments: lesson.childAssignments.map((c) => ({
      id: c.id,
      childId: c.childId,
      childFullName: c.child.fullName,
      childAge: c.child.age,
      parentName: c.child.parentName,
      parentPhone: c.child.parentPhone,
      horseName: c.horseName,
      equipmentNotes: c.equipmentNotes,
      isAbsent: c.isAbsent,
    })),
  };
}

async function getTeachingPracticeLessonDetailInternal(
  lessonId: string
): Promise<TeachingPracticeLessonDetail | null> {
  const lesson = await prisma.teachingPracticeLesson.findUnique({
    where: { id: lessonId },
    include: LESSON_DETAIL_INCLUDE,
  });
  return lesson ? toLessonDetail(lesson) : null;
}

export async function getTeachingPracticeLessonDetailForAdmin(
  lessonId: string
): Promise<TeachingPracticeLessonDetail | null> {
  await requireAdmin();
  return getTeachingPracticeLessonDetailInternal(lessonId);
}

export async function getTeachingPracticeLessonDetailForInstructor(
  instructorId: string,
  lessonId: string
): Promise<TeachingPracticeLessonDetail | null> {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  if (!instructor || !instructor.isActive) return null;
  return getTeachingPracticeLessonDetailInternal(lessonId);
}

// ---------------------------------------------------------------------------
// Generate a lesson occurrence from a track
// ---------------------------------------------------------------------------

export interface TeachingPracticeGenerateLessonResult extends ActionResult {
  lesson?: TeachingPracticeLessonDetail;
}

async function generateTeachingPracticeLessonFromTrackInternal(
  trackId: string,
  dateKeyInput: string
): Promise<TeachingPracticeGenerateLessonResult> {
  const track = await prisma.teachingPracticeTrack.findUnique({
    where: { id: trackId },
    include: {
      trainees: { orderBy: { rotationOrder: "asc" } },
      children: true,
    },
  });
  if (!track) return { success: false, error: NOT_FOUND_TRACK };
  if (!track.isActive) return { success: false, error: "לא ניתן ליצור שיעור ממסלול לא פעיל" };

  const parsedDate = parseDateKey(dateKeyInput);
  if (Number.isNaN(parsedDate.getTime())) {
    return { success: false, error: "תאריך לא תקין" };
  }

  const expectedSize = TEACHING_PRACTICE_TEAM_SIZE[track.practiceType];
  if (track.trainees.length !== expectedSize) {
    return {
      success: false,
      error:
        track.practiceType === "BEGINNER_GROUP"
          ? "יש להשלים צוות של 3 חניכים במסלול לפני יצירת שיעור"
          : "יש להשלים צוות של 2 חניכים במסלול לפני יצירת שיעור",
    };
  }

  const occurrenceIndex = await prisma.teachingPracticeLesson.count({ where: { trackId } });

  let roleAssignments: { traineeId: string; role: TeachingPracticeRoleValue }[];
  try {
    roleAssignments = computeTeachingPracticeRotation(
      track.practiceType,
      track.trainees.map((t) => ({ traineeId: t.traineeId, rotationOrder: t.rotationOrder })),
      occurrenceIndex
    );
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "שגיאה בחישוב חלוקת התפקידים" };
  }

  const createdLessonId = await prisma.$transaction(async (tx) => {
    const created = await tx.teachingPracticeLesson.create({
      data: {
        trackId: track.id,
        practiceType: track.practiceType,
        date: parsedDate,
        startTime: track.defaultStartTime,
        endTime: track.defaultEndTime,
        groupName: track.groupName,
        location: track.defaultLocation,
        responsibleInstructorId: track.defaultResponsibleInstructorId,
        isPublished: false,
      },
    });

    if (roleAssignments.length > 0) {
      await tx.teachingPracticeParticipant.createMany({
        data: roleAssignments.map((r) => ({
          lessonId: created.id,
          traineeId: r.traineeId,
          role: r.role,
        })),
      });
    }

    if (track.children.length > 0) {
      await tx.teachingPracticeChildAssignment.createMany({
        data: track.children.map((c) => ({
          lessonId: created.id,
          childId: c.childId,
          horseName: c.horseName,
          equipmentNotes: c.equipmentNotes,
        })),
      });
    }

    return created.id;
  });

  const lesson = await getTeachingPracticeLessonDetailInternal(createdLessonId);
  return { success: true, lesson: lesson ?? undefined };
}

export async function generateTeachingPracticeLessonFromTrackAsAdmin(
  trackId: string,
  date: string
): Promise<TeachingPracticeGenerateLessonResult> {
  await requireAdmin();
  return generateTeachingPracticeLessonFromTrackInternal(trackId, date);
}

export async function generateTeachingPracticeLessonFromTrackAsInstructor(
  instructorId: string,
  trackId: string,
  date: string
): Promise<TeachingPracticeGenerateLessonResult> {
  const instructor = await getInstructorForAssignmentWrite(instructorId);
  if (!instructor) return { success: false, error: NO_ASSIGNMENT_PERMISSION };
  return generateTeachingPracticeLessonFromTrackInternal(trackId, date);
}

// ---------------------------------------------------------------------------
// Lesson publish/unpublish
// ---------------------------------------------------------------------------

async function setTeachingPracticeLessonPublishedInternal(
  lessonId: string,
  isPublished: boolean
): Promise<ActionResult> {
  const lesson = await prisma.teachingPracticeLesson.findUnique({ where: { id: lessonId } });
  if (!lesson) return { success: false, error: NOT_FOUND_LESSON };
  await prisma.teachingPracticeLesson.update({ where: { id: lessonId }, data: { isPublished } });
  return { success: true };
}

export async function setTeachingPracticeLessonPublishedAsAdmin(
  lessonId: string,
  isPublished: boolean
): Promise<ActionResult> {
  await requireAdmin();
  return setTeachingPracticeLessonPublishedInternal(lessonId, isPublished);
}

export async function setTeachingPracticeLessonPublishedAsInstructor(
  instructorId: string,
  lessonId: string,
  isPublished: boolean
): Promise<ActionResult> {
  const instructor = await getInstructorForAssignmentWrite(instructorId);
  if (!instructor) return { success: false, error: NO_ASSIGNMENT_PERMISSION };
  return setTeachingPracticeLessonPublishedInternal(lessonId, isPublished);
}

// ---------------------------------------------------------------------------
// Lesson participant override (manual role changes)
// ---------------------------------------------------------------------------

export interface TeachingPracticeParticipantInput {
  traineeId: string;
  role: TeachingPracticeRoleValue;
}

async function setTeachingPracticeLessonParticipantsInternal(
  lessonId: string,
  participantRows: TeachingPracticeParticipantInput[]
): Promise<ActionResult> {
  const lesson = await prisma.teachingPracticeLesson.findUnique({
    where: { id: lessonId },
    include: { participants: { include: { feedback: true } } },
  });
  if (!lesson) return { success: false, error: NOT_FOUND_LESSON };

  const uniqueTraineeIds = new Set(participantRows.map((p) => p.traineeId));
  if (uniqueTraineeIds.size !== participantRows.length) {
    return { success: false, error: "לא ניתן לשבץ אותו חניך/ה יותר מפעם אחת בשיעור" };
  }
  if (participantRows.some((p) => !VALID_ROLES.includes(p.role))) {
    return { success: false, error: "תפקיד לא תקין" };
  }

  if (participantRows.length > 0) {
    const trainees = await prisma.student.findMany({
      where: { id: { in: participantRows.map((p) => p.traineeId) } },
    });
    if (trainees.length !== participantRows.length) {
      return { success: false, error: "אחד או יותר מהחניכים שנבחרו לא נמצאו" };
    }
    if (trainees.some((t) => !t.isActive)) {
      return { success: false, error: "לא ניתן לשבץ חניך/ה שאינו/ה פעיל/ה" };
    }
  }

  // Safe-by-default: refuse to drop a participant that already has teaching
  // feedback recorded against them, rather than silently cascading that
  // feedback away. The caller must remove the feedback first (a later-stage
  // action) if they really intend to replace that trainee's role entirely.
  const nextTraineeIds = new Set(participantRows.map((p) => p.traineeId));
  const droppedWithFeedback = lesson.participants.filter(
    (p) => !nextTraineeIds.has(p.traineeId) && p.feedback
  );
  if (droppedWithFeedback.length > 0) {
    return {
      success: false,
      error: "לא ניתן להסיר חניך/ה שכבר נכתב עבורו/ה משוב הדרכה. יש למחוק את המשוב תחילה.",
    };
  }

  const existingByTraineeId = new Map(lesson.participants.map((p) => [p.traineeId, p]));

  await prisma.$transaction(async (tx) => {
    const toDeleteIds = lesson.participants
      .filter((p) => !nextTraineeIds.has(p.traineeId))
      .map((p) => p.id);
    if (toDeleteIds.length > 0) {
      await tx.teachingPracticeParticipant.deleteMany({ where: { id: { in: toDeleteIds } } });
    }

    for (const row of participantRows) {
      const existing = existingByTraineeId.get(row.traineeId);
      if (existing) {
        if (existing.role !== row.role) {
          await tx.teachingPracticeParticipant.update({
            where: { id: existing.id },
            data: { role: row.role, isManualOverride: true },
          });
        }
      } else {
        await tx.teachingPracticeParticipant.create({
          data: { lessonId, traineeId: row.traineeId, role: row.role, isManualOverride: true },
        });
      }
    }
  });

  return { success: true };
}

export async function setTeachingPracticeLessonParticipantsAsAdmin(
  lessonId: string,
  participantRows: TeachingPracticeParticipantInput[]
): Promise<ActionResult> {
  await requireAdmin();
  return setTeachingPracticeLessonParticipantsInternal(lessonId, participantRows);
}

export async function setTeachingPracticeLessonParticipantsAsInstructor(
  instructorId: string,
  lessonId: string,
  participantRows: TeachingPracticeParticipantInput[]
): Promise<ActionResult> {
  const instructor = await getInstructorForAssignmentWrite(instructorId);
  if (!instructor) return { success: false, error: NO_ASSIGNMENT_PERMISSION };
  return setTeachingPracticeLessonParticipantsInternal(lessonId, participantRows);
}

// ---------------------------------------------------------------------------
// Lesson child assignment overrides
// ---------------------------------------------------------------------------

export interface TeachingPracticeChildAssignmentInput {
  childId: string;
  horseName?: string | null;
  equipmentNotes?: string | null;
  isAbsent?: boolean;
}

async function setTeachingPracticeLessonChildAssignmentsInternal(
  lessonId: string,
  rows: TeachingPracticeChildAssignmentInput[]
): Promise<ActionResult> {
  const lesson = await prisma.teachingPracticeLesson.findUnique({ where: { id: lessonId } });
  if (!lesson) return { success: false, error: NOT_FOUND_LESSON };

  const uniqueChildIds = new Set(rows.map((r) => r.childId));
  if (uniqueChildIds.size !== rows.length) {
    return { success: false, error: "לא ניתן לשבץ אותו ילד/ה יותר מפעם אחת בשיעור" };
  }

  if (rows.length > 0) {
    const children = await prisma.teachingPracticeChild.findMany({
      where: { id: { in: rows.map((r) => r.childId) } },
    });
    if (children.length !== rows.length) {
      return { success: false, error: "אחד או יותר מהילדים שנבחרו לא נמצאו" };
    }
    if (children.some((c) => !c.isActive)) {
      return { success: false, error: "לא ניתן לשבץ ילד/ה שאינו/ה פעיל/ה" };
    }
  }

  // No feedback dependency here (unlike participants) - feedback is keyed
  // to TeachingPracticeParticipant, never to a child assignment - so a full
  // replace-all is safe with no extra guard needed.
  await prisma.$transaction([
    prisma.teachingPracticeChildAssignment.deleteMany({ where: { lessonId } }),
    prisma.teachingPracticeChildAssignment.createMany({
      data: rows.map((r) => ({
        lessonId,
        childId: r.childId,
        horseName: r.horseName?.trim() || null,
        equipmentNotes: r.equipmentNotes?.trim() || null,
        isAbsent: r.isAbsent ?? false,
      })),
    }),
  ]);

  return { success: true };
}

export async function setTeachingPracticeLessonChildAssignmentsAsAdmin(
  lessonId: string,
  rows: TeachingPracticeChildAssignmentInput[]
): Promise<ActionResult> {
  await requireAdmin();
  return setTeachingPracticeLessonChildAssignmentsInternal(lessonId, rows);
}

// Same dual-permission split as setTeachingPracticeTrackChildrenAsInstructor:
// childId/isAbsent need canManageTeachingPracticeAssignments,
// horseName/equipmentNotes additionally need canManageTeachingPracticeHorses,
// enforced by diffing against what's currently stored for this lesson.
export async function setTeachingPracticeLessonChildAssignmentsAsInstructor(
  instructorId: string,
  lessonId: string,
  rows: TeachingPracticeChildAssignmentInput[]
): Promise<ActionResult> {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  if (!instructor || !instructor.isActive || !instructor.canManageTeachingPracticeAssignments) {
    return { success: false, error: NO_ASSIGNMENT_PERMISSION };
  }

  if (!instructor.canManageTeachingPracticeHorses) {
    const existing = await prisma.teachingPracticeChildAssignment.findMany({ where: { lessonId } });
    const existingByChildId = new Map(existing.map((e) => [e.childId, e]));
    const changesHorseFields = rows.some((r) => {
      const prev = existingByChildId.get(r.childId);
      const nextHorseName = r.horseName?.trim() || null;
      const nextEquipmentNotes = r.equipmentNotes?.trim() || null;
      return horseFieldsChanged(
        prev?.horseName ?? null,
        prev?.equipmentNotes ?? null,
        nextHorseName,
        nextEquipmentNotes
      );
    });
    if (changesHorseFields) return { success: false, error: NO_HORSE_PERMISSION };
  }

  return setTeachingPracticeLessonChildAssignmentsInternal(lessonId, rows);
}
