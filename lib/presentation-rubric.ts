// Pure, DB-free constants for the פרזנטציה scoring rubric - no "use server",
// no Prisma import, same convention as lib/teaching-practice-rotation.ts /
// lib/teaching-practice-feedback.ts, so this one file is safely importable
// from both the server actions (lib/actions/student-presentation-progress-feedback.ts,
// a "use server" module that may only export async functions itself) and the
// admin UI (app/admin/trainee-progress/TraineeProgressClient.tsx, "use client").
//
// Source: the uploaded presentation exam form - 10 fixed categories, base
// score 70, passing score 66, each category scored one of -1/-0.5/0/+0.5/+1.
// This is the entire rubric definition; it must never be duplicated or
// redefined differently anywhere else in the app.

export const PRESENTATION_BASE_SCORE = 70;
export const PRESENTATION_PASSING_SCORE = 66;

export const PRESENTATION_CATEGORY_KEYS = [
  "standingInFrontOfAudience",
  "appearance",
  "languageVoice",
  "aidsUse",
  "topicPresentation",
  "lectureStructure",
  "professionalKnowledge",
  "timeManagement",
  "interestOriginality",
  "generalImpression",
] as const;

export type PresentationCategoryKey = (typeof PRESENTATION_CATEGORY_KEYS)[number];

export const PRESENTATION_CATEGORY_LABELS: Record<PresentationCategoryKey, string> = {
  standingInFrontOfAudience: "עמידה מול קהל",
  appearance: "הופעה",
  languageVoice: "שפה / קול",
  aidsUse: "שימוש בעזרים",
  topicPresentation: "הצגת הנושא",
  lectureStructure: "מבנה ההרצאה",
  professionalKnowledge: "ידע מקצועי",
  timeManagement: "עמידה בזמנים",
  interestOriginality: "עניין / מקוריות",
  generalImpression: "התרשמות כללית",
};

// The only 5 legal per-category values - never an arbitrary integer/float.
export const PRESENTATION_CATEGORY_SCORE_OPTIONS = [-1, -0.5, 0, 0.5, 1] as const;
export type PresentationCategoryScoreValue = (typeof PRESENTATION_CATEGORY_SCORE_OPTIONS)[number];

// Always exactly the 10 fixed keys above, each with one of the 5 legal
// values - never a free-form category name, never an arbitrary number.
export type PresentationCategoryScores = Record<PresentationCategoryKey, PresentationCategoryScoreValue>;

// Exact-equality membership check - every option (-1, -0.5, 0, 0.5, 1) is
// exactly representable in IEEE754 double precision, so this can never
// misclassify a legal value due to floating-point rounding.
export function isValidPresentationCategoryScoreValue(value: unknown): value is PresentationCategoryScoreValue {
  return typeof value === "number" && (PRESENTATION_CATEGORY_SCORE_OPTIONS as readonly number[]).includes(value);
}

export function defaultPresentationCategoryScores(): PresentationCategoryScores {
  const scores = {} as PresentationCategoryScores;
  for (const key of PRESENTATION_CATEGORY_KEYS) scores[key] = 0;
  return scores;
}

export function sumPresentationCategoryScores(scores: PresentationCategoryScores): number {
  return PRESENTATION_CATEGORY_KEYS.reduce((sum, key) => sum + scores[key], 0);
}
