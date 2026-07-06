// Pure, client-safe CSV builders for the admin weekly feedback results
// dashboard - each takes data already loaded/filtered by
// app/admin/weekly-feedback/WeeklyFeedbackTabs.tsx and returns a CSV string,
// no fetching or server round-trip of its own. Kept separate from that
// component so the row-shaping logic is easy to read on its own.
import { formatHebrewDate, formatHebrewDateTime, parseDateKey } from "@/lib/dates";
import { rowsToCsv, sanitizeFilenamePart } from "@/lib/csv";
import type {
  FeedbackQuestionTypeValue,
  WeeklyFeedbackNotSubmittedTrainee,
  WeeklyFeedbackQuestionResult,
  WeeklyFeedbackResults,
  WeeklyFeedbackSubmittedTrainee,
  WeeklyFeedbackTraineeResponse,
} from "@/lib/actions/weekly-feedback";

// Mirrors WeeklyFeedbackTabs.tsx's own TYPE_LABELS - duplicated rather than
// imported since lib/actions/weekly-feedback.ts is a "use server" module
// (it may only export async functions) and the UI component isn't a
// suitable import target for a pure export helper.
const TYPE_LABELS: Record<FeedbackQuestionTypeValue, string> = {
  RATING_5: "דירוג 1–5",
  COMPARISON_3: "השוואה לשבוע קודם 1–3",
  FREE_TEXT: "טקסט חופשי",
};

function weekRangeLabel(startDate: string, endDate: string): string {
  return `${formatHebrewDate(parseDateKey(startDate))} - ${formatHebrewDate(parseDateKey(endDate))}`;
}

// One row per trainee response, one column per question (in question
// order) - submittedTrainees is used only as a studentId -> group/subgroup
// lookup (traineeResponses itself carries no group/subgroup), so callers
// should pass the same already-filtered lists shown on screen.
export function buildWeeklyFeedbackResponsesCsv(
  results: WeeklyFeedbackResults,
  traineeResponses: WeeklyFeedbackTraineeResponse[],
  submittedTrainees: WeeklyFeedbackSubmittedTrainee[]
): string {
  const infoById = new Map(submittedTrainees.map((t) => [t.studentId, t]));
  const weekLabel = `${results.form.weekName} (${weekRangeLabel(
    results.form.weekStartDate,
    results.form.weekEndDate
  )})`;

  const headers = [
    "כותרת המשוב",
    "שבוע",
    "שם החניך/ה",
    "קבוצה",
    "תת-קבוצה",
    "מועד הגשה",
    ...results.questionResults.map((q) => `${q.section} - ${q.prompt}`),
  ];

  const rows = traineeResponses.map((tr) => {
    const info = infoById.get(tr.studentId);
    const answerValues = results.questionResults.map((q) => {
      const answer = tr.answers.find((a) => a.questionId === q.questionId);
      if (!answer) return "";
      return answer.type === "FREE_TEXT" ? (answer.textValue ?? "") : (answer.ratingValue ?? "");
    });
    return [
      results.form.title,
      weekLabel,
      tr.studentName,
      info?.groupName ?? "",
      info?.subgroupNumber ?? "",
      formatHebrewDateTime(new Date(tr.submittedAt)),
      ...answerValues,
    ];
  });

  return rowsToCsv(headers, rows);
}

// One row per question - distribution columns are always 1-5 wide so every
// row has the same shape; COMPARISON_3 only fills 1-3 (4-5 blank) and
// FREE_TEXT leaves average/distribution entirely blank.
export function buildWeeklyFeedbackQuestionSummaryCsv(
  questionResults: WeeklyFeedbackQuestionResult[]
): string {
  const headers = [
    "מקטע",
    "נוסח השאלה",
    "סוג שאלה",
    "מספר תשובות",
    "ממוצע",
    "דירוג 1",
    "דירוג 2",
    "דירוג 3",
    "דירוג 4",
    "דירוג 5",
  ];

  const rows = questionResults.map((q) => {
    const distributionByValue = new Map((q.ratingDistribution ?? []).map((d) => [d.value, d.count]));
    return [
      q.section,
      q.prompt,
      TYPE_LABELS[q.type],
      q.answerCount,
      q.averageRating != null ? q.averageRating.toFixed(2) : "",
      distributionByValue.get(1) ?? "",
      distributionByValue.get(2) ?? "",
      distributionByValue.get(3) ?? "",
      distributionByValue.get(4) ?? "",
      distributionByValue.get(5) ?? "",
    ];
  });

  return rowsToCsv(headers, rows);
}

// One row per active trainee who hasn't submitted yet.
export function buildWeeklyFeedbackNotSubmittedCsv(
  notSubmittedTrainees: WeeklyFeedbackNotSubmittedTrainee[]
): string {
  const headers = ["שם החניך/ה", "קבוצה", "תת-קבוצה"];
  const rows = notSubmittedTrainees.map((t) => [t.fullName, t.groupName ?? "", t.subgroupNumber ?? ""]);
  return rowsToCsv(headers, rows);
}

// Includes the currently-selected group/subgroup filter in the filename (if
// any) so an admin exporting several filtered slices doesn't overwrite one
// download with the next.
export function buildWeeklyFeedbackExportFilename(
  baseLabel: string,
  formTitle: string,
  groupFilter: string,
  subgroupFilter: string
): string {
  const parts = [baseLabel, formTitle];
  if (groupFilter) parts.push(`קבוצה-${groupFilter}`);
  if (subgroupFilter) parts.push(`תת-קבוצה-${subgroupFilter}`);
  return `${sanitizeFilenamePart(parts.join("_"))}.csv`;
}
