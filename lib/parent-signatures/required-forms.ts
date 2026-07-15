// Pure mapping from a Teaching Practice practice type to the parent-signature
// forms it requires - no DB access, no "use server". Not wired into any
// UI/action yet (Stage 1 scope) - a later stage uses this to compute each
// child's missing/cleared signature status.

import type { TeachingPracticeTypeValue } from "@/lib/teaching-practice-rotation";
import type { ParentSignatureFormTypeValue } from "@/lib/parent-signatures/types";

// Every Teaching Practice child needs SAFETY_INSTRUCTIONS regardless of
// practiceType; LUNGE/BEGINNER_PRIVATE/BEGINNER_GROUP each additionally
// require the one consent form matching that source document.
export function requiredParentSignatureFormTypes(
  practiceType: TeachingPracticeTypeValue
): ParentSignatureFormTypeValue[] {
  switch (practiceType) {
    case "LUNGE":
      return ["SAFETY_INSTRUCTIONS", "LUNGE_CONSENT"];
    case "BEGINNER_PRIVATE":
    case "BEGINNER_GROUP":
      return ["SAFETY_INSTRUCTIONS", "BEGINNER_LESSON_CONSENT"];
  }
}

// The forms a child is actually REQUIRED to have on file right now, derived
// only from the practice types they're assigned to - used by both the status
// list (lib/parent-signatures/status.ts) and the submit guard
// (lib/actions/parent-signatures.ts) so the two can never drift apart. An
// active child with zero TeachingPracticeChildAssignment rows has no
// required forms yet (practiceTypes: [] correctly flatMaps to []) - see
// optionalParentSignatureFormTypesForChild below for what such a child may
// still collect in advance of scheduling.
export function requiredParentSignatureFormTypesForChild(
  practiceTypes: TeachingPracticeTypeValue[]
): ParentSignatureFormTypeValue[] {
  return Array.from(new Set(practiceTypes.flatMap(requiredParentSignatureFormTypes)));
}

// Every form a child with zero assignments may collect in advance, even
// though none of them are required yet (see requiredParentSignatureFormTypesForChild
// above, which returns [] for such a child). Once the child has any
// assignment, nothing is "optional" anymore - every collectable form is
// either required by requiredParentSignatureFormTypesForChild or not
// applicable, so this returns [] in that case.
const OPTIONAL_PARENT_SIGNATURE_FORM_TYPES_FOR_UNSCHEDULED_CHILD: ParentSignatureFormTypeValue[] = [
  "SAFETY_INSTRUCTIONS",
  "LUNGE_CONSENT",
  "BEGINNER_LESSON_CONSENT",
];

export function optionalParentSignatureFormTypesForChild(
  practiceTypes: TeachingPracticeTypeValue[]
): ParentSignatureFormTypeValue[] {
  return practiceTypes.length === 0 ? OPTIONAL_PARENT_SIGNATURE_FORM_TYPES_FOR_UNSCHEDULED_CHILD : [];
}
