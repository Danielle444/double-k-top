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
  practiceType: TeachingPracticeTypeValue;
  groupName: string | null;
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
  };
}
