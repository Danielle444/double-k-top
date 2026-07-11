// Pure grouping/merge logic for the parent-signature status view - no DB
// access, no "use server". Takes already-fetched raw rows (one per child
// assignment, plus that child's ACTIVE signed forms) and produces one
// grouped row per child. Kept separate from lib/actions/parent-signatures.ts
// so the merge rule itself is easy to read/verify on its own, same
// convention as lib/teaching-practice-rotation.ts and
// lib/teaching-practice-schedule-check.ts.

import { requiredParentSignatureFormTypes } from "@/lib/parent-signatures/required-forms";
import { getFormContent, CURRENT_FORM_VERSION, FORM_TYPE_SHORT_LABEL } from "@/lib/parent-signatures/form-definitions";
import type { ParentSignatureFormTypeValue } from "@/lib/parent-signatures/types";
import type { TeachingPracticeTypeValue } from "@/lib/teaching-practice-rotation";

export interface ParentSignatureAssignmentContext {
  lessonId: string;
  date: string; // "YYYY-MM-DD"
  startTime: string; // "HH:MM"
  practiceType: TeachingPracticeTypeValue;
  groupName: string | null;
  // The generated lesson's TeachingPracticeParticipant trainee names, in
  // participant-row creation order - display-only navigation context (see
  // buildTeachingPracticeContexts below), never part of the signed form
  // itself.
  traineeNames: string[];
}

// One ACTIVE TeachingPracticeSignedForm row, narrowed to just what's needed
// to compute status - courseCycle filtering already happened at the query
// level (see lib/actions/parent-signatures.ts), so it's not repeated here.
export interface ParentSignatureActiveFormLookup {
  id: string;
  formType: ParentSignatureFormTypeValue;
  signedAt: Date;
}

export interface ParentSignatureChildInput {
  childId: string;
  childName: string;
  childAge: number | null;
  parentName: string | null;
  parentPhone: string | null;
  assignments: ParentSignatureAssignmentContext[];
  activeSignedForms: ParentSignatureActiveFormLookup[];
}

export interface ParentSignatureRequiredFormStatus {
  formType: ParentSignatureFormTypeValue;
  title: string;
  status: "SIGNED" | "MISSING";
  signedAt: string | null;
  signedFormId: string | null;
}

// One compact "which lesson/trainees" navigation hint for the status list
// (see buildTeachingPracticeContexts below) - display-only, never read by
// the signed form viewer or printed form, which only ever reconstruct from
// TeachingPracticeSignedForm's own stored snapshot fields.
export interface ParentSignatureTeachingPracticeContext {
  label: string;
  practiceType: TeachingPracticeTypeValue;
  firstLessonDate?: string;
  firstLessonStartTime?: string;
  traineeNames: string[];
}

export interface ParentSignatureChildStatusRow {
  childId: string;
  childName: string;
  childAge: number | null;
  parentName: string | null;
  parentPhone: string | null;
  practiceTypes: TeachingPracticeTypeValue[];
  assignments: ParentSignatureAssignmentContext[];
  requiredForms: ParentSignatureRequiredFormStatus[];
  isCleared: boolean;
  missingCount: number;
  teachingPracticeContexts: ParentSignatureTeachingPracticeContext[];
}

// Compact display labels for this one navigation-context string - shorter
// on purpose than TeachingPracticeManager.tsx's own PRACTICE_TYPE_LABELS
// (e.g. "שיעור פרטי מתחילים"), since "מתחילים" is already implied by this
// being the parent-signatures screen and the label sits inline in a dense
// "label · date · time · חניכים: ..." line.
const TEACHING_PRACTICE_CONTEXT_LABELS: Record<TeachingPracticeTypeValue, string> = {
  LUNGE: "לונג׳",
  BEGINNER_PRIVATE: "שיעור פרטני",
  BEGINNER_GROUP: "שיעור קבוצתי",
};

function pickEarliestAssignment(
  assignments: ParentSignatureAssignmentContext[]
): ParentSignatureAssignmentContext {
  return assignments.reduce((earliest, a) =>
    a.date < earliest.date || (a.date === earliest.date && a.startTime < earliest.startTime)
      ? a
      : earliest
  );
}

// Builds up to two compact context entries for the status list (never for
// the signed form itself - see the interface doc comment above): one for
// the child's earliest LUNGE lesson (if any LUNGE assignment exists), one
// for the child's earliest BEGINNER_PRIVATE/BEGINNER_GROUP lesson (if
// either exists) - a child enrolled in both gets both entries, one enrolled
// in neither type present (shouldn't happen - every assignment is one of
// the three) gets none. The beginner entry's label/practiceType reflect
// whichever of BEGINNER_PRIVATE/BEGINNER_GROUP that earliest lesson
// actually was, not a generic "beginner" label.
function buildTeachingPracticeContexts(
  assignments: ParentSignatureAssignmentContext[]
): ParentSignatureTeachingPracticeContext[] {
  const contexts: ParentSignatureTeachingPracticeContext[] = [];

  const lungeAssignments = assignments.filter((a) => a.practiceType === "LUNGE");
  if (lungeAssignments.length > 0) {
    const earliest = pickEarliestAssignment(lungeAssignments);
    contexts.push({
      label: TEACHING_PRACTICE_CONTEXT_LABELS.LUNGE,
      practiceType: "LUNGE",
      firstLessonDate: earliest.date,
      firstLessonStartTime: earliest.startTime,
      traineeNames: earliest.traineeNames,
    });
  }

  const beginnerAssignments = assignments.filter(
    (a) => a.practiceType === "BEGINNER_PRIVATE" || a.practiceType === "BEGINNER_GROUP"
  );
  if (beginnerAssignments.length > 0) {
    const earliest = pickEarliestAssignment(beginnerAssignments);
    contexts.push({
      label: TEACHING_PRACTICE_CONTEXT_LABELS[earliest.practiceType],
      practiceType: earliest.practiceType,
      firstLessonDate: earliest.date,
      firstLessonStartTime: earliest.startTime,
      traineeNames: earliest.traineeNames,
    });
  }

  return contexts;
}

// Merges required forms across every one of a child's assignments (e.g. a
// child with both a LUNGE and a BEGINNER_GROUP assignment needs
// SAFETY_INSTRUCTIONS + LUNGE_CONSENT + BEGINNER_LESSON_CONSENT, not the
// same SAFETY_INSTRUCTIONS counted twice) and resolves each against that
// child's ACTIVE signed forms (already pre-filtered to the current
// courseCycle by the caller).
export function buildParentSignatureChildStatus(
  input: ParentSignatureChildInput
): ParentSignatureChildStatusRow {
  const practiceTypes = Array.from(new Set(input.assignments.map((a) => a.practiceType)));
  const requiredTypes = Array.from(new Set(practiceTypes.flatMap(requiredParentSignatureFormTypes)));

  const requiredForms: ParentSignatureRequiredFormStatus[] = requiredTypes.map((formType) => {
    const signed = input.activeSignedForms.find((f) => f.formType === formType) ?? null;
    const content = getFormContent(formType, CURRENT_FORM_VERSION[formType]);
    return {
      formType,
      title: content ? FORM_TYPE_SHORT_LABEL[formType] : formType,
      status: signed ? "SIGNED" : "MISSING",
      signedAt: signed ? signed.signedAt.toISOString() : null,
      signedFormId: signed ? signed.id : null,
    };
  });

  const missingCount = requiredForms.filter((f) => f.status === "MISSING").length;

  return {
    childId: input.childId,
    childName: input.childName,
    childAge: input.childAge,
    parentName: input.parentName,
    parentPhone: input.parentPhone,
    practiceTypes,
    assignments: input.assignments,
    requiredForms,
    isCleared: missingCount === 0,
    missingCount,
    teachingPracticeContexts: buildTeachingPracticeContexts(input.assignments),
  };
}
